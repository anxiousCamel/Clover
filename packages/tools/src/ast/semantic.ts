/**
 * ast/semantic — Tools do Motor Semântico (FASE 2): resolução por **binding**
 * via TypeChecker/LanguageService, não por comparação de strings. Um `save()`
 * na classe A JAMAIS é confundido com `save()` na classe B — o símbolo é
 * resolvido semanticamente (testado).
 *
 * Alvo: `{ path, name, line? }`. Com múltiplas ocorrências do identificador no
 * arquivo e sem `line`, a tool retorna erro ESTRUTURADO listando os candidatos
 * (linha/coluna) — desambiguação explícita, nunca escolha silenciosa.
 *
 * `rename_symbol` APLICA a renomeação em todos os arquivos afetados,
 * respeitando a mecânica de backup da fundação FS: cada arquivo modificado
 * ganha `<arquivo>.bak` com o conteúdo original ANTES da escrita.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';

import type { CapabilityRequest, ToolInvocation } from '@clover/contracts';
import type { LocalTool } from '@clover/tool-abi';
import ts from 'typescript';
import { z } from 'zod';

import { defineZodTool } from '../abi.js';
import { baseDir, resolveGlobal } from '../sys/fs.js';
import { findTsProjectRoot } from '../sys/context.js';
import { getLanguageService, locateIdentifier } from './program.js';

const FS_READ: CapabilityRequest[] = [{ kind: 'fs.read' }];
const FS_WRITE: CapabilityRequest[] = [{ kind: 'fs.write' }];

const TargetInput = {
  path: z.string().min(1).describe('Arquivo (relativo ao workspace) onde o símbolo aparece.'),
  name: z.string().min(1).describe('Nome exato do identificador.'),
  line: z.number().int().min(1).optional().describe('Linha 1-based p/ desambiguar múltiplas ocorrências.'),
};

interface Target {
  service: ts.LanguageService;
  absRoot: string;
  absFile: string;
  position: number;
}

/**
 * Resolve o alvo (workspace → LS → posição do identificador) com erros claros.
 * Múltiplas ocorrências só exigem `line` se resolverem para SÍMBOLOS DISTINTOS
 * (checker identity, aliases resolvidos) — declaração + usos do MESMO símbolo
 * não pedem desambiguação.
 */
function resolveTarget(ctx: ToolInvocation, path: string, name: string, line?: number): Target {
  const absRoot = baseDir(ctx);
  // Guarda de contexto: motor semântico exige projeto TS. Sem tsconfig.json, o
  // Program não resolve tipos — guia o LLM de volta às FS tools.
  if (findTsProjectRoot(absRoot) === null) {
    throw new Error(
      `Not a TS project (no tsconfig.json in ${absRoot} or ancestors). Use basic FS tools (list_directory / read_file_paginated) instead.`,
    );
  }
  const absFile = resolveGlobal(ctx, path);
  const service = getLanguageService(absRoot);
  const sites = locateIdentifier(service, absFile, name, line);
  if (sites.length === 0) {
    throw new Error(
      `símbolo '${name}' não encontrado em '${path}'${line ? ` na linha ${line}` : ''} (o arquivo está no workspace e compila?)`,
    );
  }
  if (sites.length > 1 && line === undefined) {
    const checker = service.getProgram()?.getTypeChecker();
    const distinct = new Set(
      sites.map((s) => {
        const sym = checker?.getSymbolAtLocation(s.node);
        if (!sym) return s; // não resolvível → conta como distinto (conservador)
        return sym.flags & ts.SymbolFlags.Alias ? checker!.getAliasedSymbol(sym) : sym;
      }),
    );
    if (distinct.size > 1) {
      const cands = sites.map((s) => `linha ${s.line}, col ${s.column}`).join('; ');
      throw new Error(
        `símbolo '${name}' tem ${sites.length} ocorrências de símbolos DIFERENTES em '${path}' — desambigue com 'line'. Candidatos: ${cands}`,
      );
    }
  }
  return { service, absRoot, absFile, position: sites[0]!.position };
}

const rel = (absRoot: string, absFile: string): string =>
  relative(absRoot, absFile).replace(/\\/g, '/');

function lineColOf(service: ts.LanguageService, fileName: string, start: number): { line: number; column: number } {
  const sf = service.getProgram()?.getSourceFile(fileName);
  if (!sf) return { line: 0, column: 0 };
  const lc = sf.getLineAndCharacterOfPosition(start);
  return { line: lc.line + 1, column: lc.character + 1 };
}

// ===========================================================================
// find_references (semântico)
// ===========================================================================

const ReferenceSchema = z.object({
  path: z.string(),
  line: z.number(),
  column: z.number(),
  isDefinition: z.boolean(),
  isWriteAccess: z.boolean(),
});

export const findReferencesSemanticTool: LocalTool = defineZodTool({
  name: 'find_references',
  description:
    'Encontra TODAS as utilizações exatas de um símbolo no workspace por resolução SEMÂNTICA de binding (TypeChecker) — métodos homônimos em classes diferentes NÃO se confundem. Alvo: arquivo + nome (+ line p/ desambiguar).',
  input: z.object(TargetInput).strict(),
  output: z.object({
    name: z.string(),
    found: z.boolean(),
    references: z.array(ReferenceSchema),
    total: z.number(),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (args, ctx) => {
    const t = resolveTarget(ctx, args.path, args.name, args.line);
    const groups = t.service.findReferences(t.absFile, t.position) ?? [];
    const references = groups
      .flatMap((g) => g.references)
      .map((r) => ({
        path: rel(t.absRoot, r.fileName),
        ...lineColOf(t.service, r.fileName, r.textSpan.start),
        isDefinition: r.isDefinition ?? false,
        isWriteAccess: r.isWriteAccess ?? false,
      }))
      .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column);
    return { name: args.name, found: references.length > 0, references, total: references.length };
  },
});

// ===========================================================================
// find_callers / find_callees (call hierarchy)
// ===========================================================================

const CallSiteSchema = z.object({
  name: z.string(),
  path: z.string(),
  line: z.number(),
  callLines: z.array(z.number()),
});

export const findCallersTool: LocalTool = defineZodTool({
  name: 'find_callers',
  description:
    'Rastreia QUEM CHAMA uma função/método específico (call hierarchy semântica do TypeScript — incoming calls). Alvo: arquivo + nome da função/método.',
  input: z.object(TargetInput).strict(),
  output: z.object({
    name: z.string(),
    callers: z.array(CallSiteSchema),
    total: z.number(),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (args, ctx) => {
    const t = resolveTarget(ctx, args.path, args.name, args.line);
    const prepared = t.service.prepareCallHierarchy(t.absFile, t.position);
    if (!prepared) {
      throw new Error(`'${args.name}' não é um alvo de call hierarchy (é função/método/classe?)`);
    }
    const item = Array.isArray(prepared) ? prepared[0]! : prepared;
    const incoming = t.service.provideCallHierarchyIncomingCalls(item.file, item.selectionSpan.start);
    const callers = incoming
      .map((c) => ({
        name: c.from.name,
        path: rel(t.absRoot, c.from.file),
        line: lineColOf(t.service, c.from.file, c.from.selectionSpan.start).line,
        callLines: c.fromSpans
          .map((s) => lineColOf(t.service, c.from.file, s.start).line)
          .sort((a, b) => a - b),
      }))
      .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    return { name: args.name, callers, total: callers.length };
  },
});

export const findCalleesTool: LocalTool = defineZodTool({
  name: 'find_callees',
  description:
    'Lista TODAS as funções/métodos invocados dentro de uma função específica (call hierarchy semântica — outgoing calls). Alvo: arquivo + nome da função.',
  input: z.object(TargetInput).strict(),
  output: z.object({
    name: z.string(),
    callees: z.array(CallSiteSchema),
    total: z.number(),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (args, ctx) => {
    const t = resolveTarget(ctx, args.path, args.name, args.line);
    const prepared = t.service.prepareCallHierarchy(t.absFile, t.position);
    if (!prepared) {
      throw new Error(`'${args.name}' não é um alvo de call hierarchy (é função/método/classe?)`);
    }
    const item = Array.isArray(prepared) ? prepared[0]! : prepared;
    const outgoing = t.service.provideCallHierarchyOutgoingCalls(item.file, item.selectionSpan.start);
    const callees = outgoing
      .map((c) => ({
        name: c.to.name,
        path: rel(t.absRoot, c.to.file),
        line: lineColOf(t.service, c.to.file, c.to.selectionSpan.start).line,
        callLines: c.fromSpans
          .map((s) => lineColOf(t.service, item.file, s.start).line)
          .sort((a, b) => a - b),
      }))
      .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    return { name: args.name, callees, total: callees.length };
  },
});

// ===========================================================================
// rename_symbol (semântico, APLICA com backup .bak)
// ===========================================================================

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export const renameSymbolSemanticTool: LocalTool = defineZodTool({
  name: 'rename_symbol',
  description:
    'Renomeia um símbolo com SEGURANÇA SEMÂNTICA (TypeChecker) e APLICA em todos os arquivos afetados — identificadores homônimos não relacionados NÃO são tocados. Cada arquivo modificado ganha backup .bak antes da escrita. dryRun=true só lista. Operação de ESCRITA.',
  input: z
    .object({
      ...TargetInput,
      newName: z.string().min(1).describe('Novo identificador (válido em TS/JS).'),
      dryRun: z.boolean().optional().describe('Só lista as mudanças, sem aplicar.'),
    })
    .strict(),
  output: z.object({
    name: z.string(),
    newName: z.string(),
    applied: z.boolean(),
    files: z.array(z.object({ path: z.string(), replacements: z.number(), backup: z.string().nullable() })),
    totalReplacements: z.number(),
  }),
  capabilities: FS_WRITE,
  intent: 'write',
  pure: false,
  run: (args, ctx) => {
    if (!IDENT_RE.test(args.newName)) {
      throw new Error(`rename_symbol: '${args.newName}' não é um identificador TS/JS válido`);
    }
    const t = resolveTarget(ctx, args.path, args.name, args.line);
    const locations = t.service.findRenameLocations(t.absFile, t.position, false, false, {}) ?? [];
    if (locations.length === 0) {
      throw new Error(`rename_symbol: nenhum local de renomeação para '${args.name}' (símbolo externo à workspace?)`);
    }

    // Agrupa por arquivo; aplica de trás pra frente (offsets estáveis).
    const byFile = new Map<string, ts.RenameLocation[]>();
    for (const loc of locations) {
      const list = byFile.get(loc.fileName) ?? [];
      list.push(loc);
      byFile.set(loc.fileName, list);
    }

    const files: Array<{ path: string; replacements: number; backup: string | null }> = [];
    for (const [fileName, locs] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const relPath = rel(t.absRoot, fileName);
      if (args.dryRun) {
        files.push({ path: relPath, replacements: locs.length, backup: null });
        continue;
      }
      const original = readFileSync(fileName, 'utf8');
      // Backup OBRIGATÓRIO do original antes de sobrescrever (fundação FS).
      writeFileSync(`${fileName}.bak`, original, 'utf8');
      let content = original;
      for (const loc of [...locs].sort((a, b) => b.textSpan.start - a.textSpan.start)) {
        content =
          content.slice(0, loc.textSpan.start) +
          args.newName +
          content.slice(loc.textSpan.start + loc.textSpan.length);
      }
      writeFileSync(fileName, content, 'utf8');
      files.push({ path: relPath, replacements: locs.length, backup: `${relPath}.bak` });
    }

    return {
      name: args.name,
      newName: args.newName,
      applied: !args.dryRun,
      files,
      totalReplacements: locations.length,
    };
  },
});

/** Tools semânticas do departamento AST (FASE 2 — motor com TypeChecker). */
export const semanticAstTools: LocalTool[] = [
  findReferencesSemanticTool,
  findCallersTool,
  findCalleesTool,
  renameSymbolSemanticTool,
];
