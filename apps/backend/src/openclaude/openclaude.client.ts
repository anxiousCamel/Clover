/**
 * OpenClaude gRPC client — streaming + unary completion calls with auto-reconnect.
 */

import * as grpc from '@grpc/grpc-js';
import { loadOpenClaudeProto } from '@clover/shared/protos/loader.js';
import type {
  CompletionServiceClient,
  OpenClaudePackage,
  ProtoCompletionChunk,
  ProtoCompletionRequest,
  ProtoCompletionResponse,
} from '@clover/shared/protos/generated/index.js';
import type {
  CompletionChunk,
  CompletionRequest,
  Message,
  UsageStats,
} from '@clover/shared';
import { config } from '../config/config.js';

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let proto: OpenClaudePackage | null = null;
let client: CompletionServiceClient | null = null;
let reconnecting = false;

function getAddress(): string {
  return `${config.openclaude.host}:${config.openclaude.port}`;
}

function ensureProto(): OpenClaudePackage {
  if (!proto) {
    proto = loadOpenClaudeProto();
  }
  return proto;
}

function createClient(): CompletionServiceClient {
  const pkg = ensureProto();
  const c = new pkg.CompletionService(
    getAddress(),
    grpc.credentials.createInsecure(),
  );
  watchChannelState(c);
  return c;
}

/** Get (or create) the singleton client. */
function getClient(): CompletionServiceClient {
  if (!client) {
    client = createClient();
  }
  return client;
}

// ---------------------------------------------------------------------------
// Auto-reconnect on channel state change
// ---------------------------------------------------------------------------

function watchChannelState(c: CompletionServiceClient): void {
  const channel = c.getChannel();
  const currentState = channel.getConnectivityState(false);
  tryReconnectOnState(c, currentState);
}

function tryReconnectOnState(
  c: CompletionServiceClient,
  state: grpc.connectivityState,
): void {
  if (
    state === grpc.connectivityState.TRANSIENT_FAILURE ||
    state === grpc.connectivityState.SHUTDOWN
  ) {
    reconnect();
    return;
  }

  // Watch for future state changes
  const deadline = Date.now() + 30_000;
  c.getChannel().watchConnectivityState(state, deadline, (err) => {
    if (err) {
      // Deadline expired — re-watch
      watchChannelState(c);
      return;
    }
    const newState = c.getChannel().getConnectivityState(false);
    tryReconnectOnState(c, newState);
  });
}

function reconnect(): void {
  if (reconnecting) return;
  reconnecting = true;

  try {
    if (client) {
      client.close();
    }
  } catch {
    // ignore close errors
  }

  client = createClient();
  reconnecting = false;
}

// ---------------------------------------------------------------------------
// Proto ↔ shared type mappers
// ---------------------------------------------------------------------------

function toProtoRequest(req: CompletionRequest): ProtoCompletionRequest {
  return {
    messages: req.messages.map((m) => ({
      role: m.role,
      content: m.content,
      tool_name: m.tool_name,
      tool_call_id: m.tool_call_id,
    })),
    tools: (req.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: JSON.stringify(t.inputSchema),
    })),
    model: req.model ?? '',
    stream: req.stream ?? false,
  };
}

function mapChunk(chunk: ProtoCompletionChunk): CompletionChunk {
  const result: CompletionChunk = {
    type: chunk.payload === 'tool_call'
      ? 'tool_call'
      : chunk.payload === 'usage'
        ? 'usage'
        : 'token',
  };

  if (chunk.token !== undefined && chunk.token !== '') {
    result.token = chunk.token;
  }

  if (chunk.tool_call) {
    result.toolCall = {
      id: chunk.tool_call.id,
      name: chunk.tool_call.name,
      arguments: chunk.tool_call.arguments,
    };
  }

  if (chunk.usage) {
    result.usage = {
      inputTokens: chunk.usage.input_tokens,
      outputTokens: chunk.usage.output_tokens,
    };
  }

  return result;
}

function mapResponse(res: ProtoCompletionResponse): {
  message: Message;
  usage: UsageStats;
} {
  return {
    message: {
      role: (res.message?.role as Message['role']) ?? 'assistant',
      content: res.message?.content ?? '',
      tool_name: res.message?.tool_name,
      tool_call_id: res.message?.tool_call_id,
    },
    usage: {
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Stream a completion request. Returns an AsyncIterable that yields
 * CompletionChunk objects as they arrive from the gRPC server.
 */
export async function* streamComplete(
  request: CompletionRequest,
): AsyncGenerator<CompletionChunk> {
  const c = getClient();
  const protoReq = toProtoRequest(request);
  const stream: grpc.ClientReadableStream<ProtoCompletionChunk> =
    c.streamComplete(protoReq);

  // Bridge the Node.js readable stream into an async generator via a queue.
  type QueueItem =
    | { kind: 'data'; value: ProtoCompletionChunk }
    | { kind: 'end' }
    | { kind: 'error'; error: Error };

  const queue: QueueItem[] = [];
  let resolve: (() => void) | null = null;

  function push(item: QueueItem): void {
    queue.push(item);
    if (resolve) {
      resolve();
      resolve = null;
    }
  }

  stream.on('data', (chunk: ProtoCompletionChunk) => push({ kind: 'data', value: chunk }));
  stream.on('end', () => push({ kind: 'end' }));
  stream.on('error', (err: Error) => push({ kind: 'error', error: err }));

  while (true) {
    if (queue.length === 0) {
      await new Promise<void>((r) => {
        resolve = r;
      });
    }

    const item = queue.shift()!;

    if (item.kind === 'end') {
      return;
    }
    if (item.kind === 'error') {
      throw item.error;
    }
    yield mapChunk(item.value);
  }
}

/**
 * Non-streaming (unary) completion call.
 * Returns the full response with message and usage stats.
 */
export function complete(
  request: CompletionRequest,
): Promise<{ message: Message; usage: UsageStats }> {
  const c = getClient();
  const protoReq = toProtoRequest(request);

  return new Promise((resolve, reject) => {
    c.complete(protoReq, (err, response) => {
      if (err) {
        reject(err);
        return;
      }
      if (!response) {
        reject(new Error('OpenClaude returned empty response'));
        return;
      }
      resolve(mapResponse(response));
    });
  });
}

export { getClient, reconnect };
