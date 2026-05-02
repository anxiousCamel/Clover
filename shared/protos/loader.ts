/**
 * Runtime proto loader using @grpc/proto-loader + @grpc/grpc-js.
 *
 * Usage (from backend):
 *   import { loadOpenClaudeProto } from '@clover/shared/protos/loader.js';
 *   const pkg = loadOpenClaudeProto();
 *   const client = new pkg.CompletionService(addr, creds);
 */

import * as path from 'node:path';
import * as url from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type { OpenClaudePackage } from './generated/openclaude.js';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

const PROTO_PATH = path.resolve(__dirname, 'openclaude.proto');

const LOADER_OPTIONS: protoLoader.Options = {
  keepCase: true,
  longs: Number,
  enums: String,
  defaults: true,
  oneofs: true,
};

/**
 * Load the openclaude.proto definition and return the typed package object.
 * The returned `CompletionService` can be instantiated as a gRPC client.
 */
export function loadOpenClaudeProto(): OpenClaudePackage {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, LOADER_OPTIONS);
  const proto = grpc.loadPackageDefinition(packageDefinition);
  return proto.openclaude as unknown as OpenClaudePackage;
}
