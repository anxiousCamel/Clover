/**
 * ast/program — Ciclo de vida do motor semântico (SRP: só gestão do
 * LanguageService; sem Zod).
 *
 * Estratégia anti-OOM exigida pelo mandato: em vez de `ts.createProgram` a cada
 * chamada, um **`ts.LanguageService` por workspace, lazy e cacheado**:
 *
 *   - `getScriptVersion` = mtime do arquivo → o DocumentRegistry do TS reusa a
 *     AST de arquivos INALTERADOS entre chamadas e reparsa só o que mudou
 *     (mesma filosofia de invalidação incremental do Workspace Index);
 *   - `getScriptFileNames` re-varre o disco a cada consulta (arquivos novos
 *     entram sem reconstruir o serviço) reusando o walk do indexer (DRY);
 *   - cache limitado a `MAX_SERVICES` workspaces — o excedente é `dispose()`d
 *     (LRU simples), evitando acúmulo de Programs em memória.
 */

import { readFileSync, statSync } from 'node:fs';

import ts from 'typescript';

import { walkFiles } from '../index/indexer.js';
import { scriptKindFor } from './parse.js';

const MAX_SERVICES = 2;

const COMPILER_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  checkJs: false,
  target: ts.ScriptTarget.Latest,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
  noEmit: true,
};

/** LRU mínimo: Map preserva ordem de inserção; get re-insere. */
const services = new Map<string, ts.LanguageService>();

function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const abs of walkFiles(root)) {
    if (scriptKindFor(abs) !== undefined) out.push(abs);
  }
  return out.sort();
}

/** LanguageService lazy/cacheado para um workspace (raiz ABSOLUTA). */
export function getLanguageService(absRoot: string): ts.LanguageService {
  const cached = services.get(absRoot);
  if (cached) {
    // LRU: re-insere no fim.
    services.delete(absRoot);
    services.set(absRoot, cached);
    return cached;
  }
  if (services.size >= MAX_SERVICES) {
    const oldest = services.keys().next().value as string;
    services.get(oldest)?.dispose();
    services.delete(oldest);
  }

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => listSourceFiles(absRoot),
    getScriptVersion: (f) => {
      try {
        return String(statSync(f).mtimeMs);
      } catch {
        return '0';
      }
    },
    getScriptSnapshot: (f) => {
      try {
        return ts.ScriptSnapshot.fromString(readFileSync(f, 'utf8'));
      } catch {
        return undefined;
      }
    },
    getCurrentDirectory: () => absRoot,
    getCompilationSettings: () => COMPILER_OPTIONS,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };

  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  services.set(absRoot, service);
  return service;
}

/** Descarta todos os serviços (testes/limpeza de memória). */
export function disposeAllLanguageServices(): void {
  for (const s of services.values()) s.dispose();
  services.clear();
}

export interface IdentifierSite {
  /** Offset absoluto no arquivo (posição para o LS). */
  position: number;
  line: number;
  column: number;
  /** Nó do identificador (válido enquanto o Program atual viver). */
  node: ts.Node;
}

/**
 * Localiza ocorrências do identificador `name` em um arquivo (via AST do
 * próprio serviço — sem reparse). `line` filtra; sem `line` e com múltiplas
 * ocorrências, o caller decide (as tools exigem desambiguação explícita).
 */
export function locateIdentifier(
  service: ts.LanguageService,
  absFile: string,
  name: string,
  line?: number,
): IdentifierSite[] {
  const sf = service.getProgram()?.getSourceFile(absFile);
  if (!sf) return [];
  const sites: IdentifierSite[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) && node.text === name) {
      const lc = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      const site = { position: node.getStart(sf), line: lc.line + 1, column: lc.character + 1, node };
      if (line === undefined || site.line === line) sites.push(site);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}
