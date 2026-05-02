/**
 * Hand-written TypeScript types matching shared/protos/openclaude.proto.
 *
 * These types are used with @grpc/proto-loader dynamic loading.
 * The proto file is loaded at runtime; these types provide compile-time safety.
 */

// ─── Proto message types ─────────────────────────────────

export interface ProtoMessage {
  role: string;
  content: string;
  tool_name?: string;
  tool_call_id?: string;
}

export interface ProtoTool {
  name: string;
  description: string;
  input_schema: string; // JSON-encoded schema
}

export interface ProtoToolCall {
  id: string;
  name: string;
  arguments: string; // JSON-encoded arguments
}

export interface ProtoUsageStats {
  input_tokens: number;
  output_tokens: number;
}

export interface ProtoCompletionRequest {
  messages: ProtoMessage[];
  tools: ProtoTool[];
  model: string;
  stream: boolean;
}

export interface ProtoCompletionChunk {
  payload: 'token' | 'tool_call' | 'usage';
  token?: string;
  tool_call?: ProtoToolCall;
  usage?: ProtoUsageStats;
}

export interface ProtoCompletionResponse {
  message: ProtoMessage;
  usage: ProtoUsageStats;
}

// ─── gRPC service client types ───────────────────────────

import type * as grpc from '@grpc/grpc-js';

/** Callback-style client for CompletionService. */
export interface CompletionServiceClient extends grpc.Client {
  streamComplete(
    request: ProtoCompletionRequest,
    metadata?: grpc.Metadata,
  ): grpc.ClientReadableStream<ProtoCompletionChunk>;

  complete(
    request: ProtoCompletionRequest,
    callback: grpc.requestCallback<ProtoCompletionResponse>,
  ): grpc.ClientUnaryCall;

  complete(
    request: ProtoCompletionRequest,
    metadata: grpc.Metadata,
    callback: grpc.requestCallback<ProtoCompletionResponse>,
  ): grpc.ClientUnaryCall;
}

/** Constructor type returned by proto-loader + grpc-js. */
export interface CompletionServiceConstructor {
  new (
    address: string,
    credentials: grpc.ChannelCredentials,
    options?: Partial<grpc.ChannelOptions>,
  ): CompletionServiceClient;

  service: grpc.ServiceDefinition;
}

/** Package definition shape after loading the proto. */
export interface OpenClaudePackage {
  CompletionService: CompletionServiceConstructor;
}
