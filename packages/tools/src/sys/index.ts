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
  resolveGlobal,
  baseDir,
  readLinesPaginated,
  readTextInWorkspace,
  writeTextInWorkspace,
  readTextGlobal,
  writeTextGlobal,
  FsBoundaryError,
  type NumberedLine,
  type PaginatedLines,
} from './fs.js';
export {
  session,
  findGitRoot,
  findTsProjectRoot,
  findUpwards,
} from './context.js';
export {
  listAvailableToolsTool,
  setCatalog,
} from './list-tools.js';
