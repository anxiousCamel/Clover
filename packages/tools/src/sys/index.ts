/** Namespace `sys/` — primitivas de sistema (execução de binários, disco, ...). */
export {
  runBinary,
  detectBinary,
  type RunBinaryOptions,
  type RunBinaryResult,
  type BinaryInfo,
} from './exec.js';
export {
  resolveInWorkspace,
  readLinesPaginated,
  readTextInWorkspace,
  writeTextInWorkspace,
  FsBoundaryError,
  type NumberedLine,
  type PaginatedLines,
} from './fs.js';
