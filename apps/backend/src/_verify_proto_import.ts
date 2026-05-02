/**
 * Temporary verification: ensure proto types are importable from backend.
 * Delete after verification.
 */
import type {
  ProtoMessage,
  ProtoCompletionRequest,
  ProtoCompletionChunk,
  ProtoCompletionResponse,
  CompletionServiceClient,
  OpenClaudePackage,
} from '@clover/shared/protos/generated/index.js';

// Type-level usage to confirm imports resolve
const _msg: ProtoMessage = { role: 'user', content: 'hello' };
const _req: ProtoCompletionRequest = {
  messages: [_msg],
  tools: [],
  model: 'llama3',
  stream: true,
};

// Confirm chunk oneof shape
const _chunk: ProtoCompletionChunk = {
  payload: 'token',
  token: 'hi',
};

const _resp: ProtoCompletionResponse = {
  message: _msg,
  usage: { input_tokens: 10, output_tokens: 5 },
};

// These are type-only — just verifying resolution
type _Client = CompletionServiceClient;
type _Pkg = OpenClaudePackage;

console.log('Proto types imported successfully');
