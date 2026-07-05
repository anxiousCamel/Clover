/**
 * Namespace `ast/` — Departamento AST (capacidades de Language Server, camada
 * sintática). Ferramentas de análise estática de **um arquivo** via TypeScript
 * Compiler API (`ts.createSourceFile`). Ver `ast/parse.ts` para o escopo honesto:
 * sintático puro, sem `Program`/`TypeChecker` (logo, sem resolução de tipos nem
 * referências cruzadas — essas exigem índice de workspace, FASE 2.5).
 *
 * Todas são `read` (não passam pelo Governor) e declaram `fs.read` — leem o
 * arquivo pelo chokepoint `sys/fs` (fronteira de workspace).
 */

import type { CapabilityRequest } from '@clover/contracts';
import type { LocalTool } from '@clover/tool-abi';
import { z } from 'zod';

import { defineZodTool } from '../abi.js';
import { readTextGlobal } from '../sys/fs.js';
import {
  analyzeSource,
  findDocumentation,
  findInheritance,
  querySymbol,
  scriptKindFor,
  SUPPORTED_EXTENSIONS,
} from './parse.js';

const FS_READ: CapabilityRequest[] = [{ kind: 'fs.read' }];

/** Garante que a extensão é parseável; erro estruturado (via wrapper) se não. */
function assertSupported(path: string): void {
  if (!scriptKindFor(path)) {
    throw new Error(
      `analyze: extensão não suportada em '${path}'. Suportadas: ${SUPPORTED_EXTENSIONS.join(', ')}`,
    );
  }
}

// ===========================================================================
// Schemas de saída (Zod) — espelham os tipos de `ast/parse.ts`
// ===========================================================================

const ImportSchema = z.object({
  module: z.string(),
  form: z.enum(['default', 'named', 'namespace', 'side-effect']),
  names: z.array(z.string()),
});

const ExportSchema = z.object({
  name: z.string(),
  kind: z.enum(['class', 'interface', 'function', 'variable', 'type', 'enum', 'default', 're-export', 'namespace']),
  reexportFrom: z.string().optional(),
});

const ClassSchema = z.object({
  name: z.string(),
  line: z.number(),
  exported: z.boolean(),
  abstract: z.boolean(),
  extends: z.string().optional(),
  implements: z.array(z.string()),
  decorators: z.array(z.string()),
  methods: z.array(z.string()),
  properties: z.array(z.string()),
});

const InterfaceSchema = z.object({
  name: z.string(),
  line: z.number(),
  exported: z.boolean(),
  extends: z.array(z.string()),
});

const FunctionSchema = z.object({
  name: z.string(),
  line: z.number(),
  exported: z.boolean(),
  async: z.boolean(),
  params: z.array(z.string()),
});

const VariableSchema = z.object({
  name: z.string(),
  line: z.number(),
  exported: z.boolean(),
  kind: z.enum(['const', 'let', 'var']),
});

const EnumSchema = z.object({
  name: z.string(),
  line: z.number(),
  exported: z.boolean(),
  members: z.array(z.string()),
});

const TypeAliasSchema = z.object({
  name: z.string(),
  line: z.number(),
  exported: z.boolean(),
});

const SymbolMatchSchema = z.object({
  name: z.string(),
  kind: z.enum(['class', 'interface', 'function', 'variable', 'type', 'enum', 'method', 'property', 'enum-member']),
  line: z.number(),
  column: z.number(),
  exported: z.boolean(),
  signature: z.string(),
});

// ===========================================================================
// analyze_module
// ===========================================================================

export const analyzeModuleTool: LocalTool = defineZodTool({
  name: 'analyze_module',
  description:
    'Análise estática (sintática) de um arquivo TS/JS: imports, exports, classes, interfaces, funções, variáveis, enums, type aliases e decorators. Single-file — não resolve tipos nem referências cross-file.',
  input: z
    .object({
      path: z.string().min(1).describe('Caminho relativo ao workspace (.ts/.tsx/.js/.jsx/.mts/.cts).'),
    })
    .strict(),
  output: z.object({
    path: z.string(),
    imports: z.array(ImportSchema),
    exports: z.array(ExportSchema),
    classes: z.array(ClassSchema),
    interfaces: z.array(InterfaceSchema),
    functions: z.array(FunctionSchema),
    variables: z.array(VariableSchema),
    enums: z.array(EnumSchema),
    typeAliases: z.array(TypeAliasSchema),
    decorators: z.array(z.string()),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (args, ctx) => {
    assertSupported(args.path);
    const text = readTextGlobal(ctx, args.path);
    const a = analyzeSource(args.path, text);
    return { path: args.path, ...a };
  },
});

// ===========================================================================
// query_ast_symbol
// ===========================================================================

export const queryAstSymbolTool: LocalTool = defineZodTool({
  name: 'query_ast_symbol',
  description:
    'Localiza declarações de um símbolo por nome em um arquivo TS/JS (classes, interfaces, funções, variáveis, enums, métodos, propriedades). Retorna kind, linha/coluna, se é exportado e a assinatura como escrita.',
  input: z
    .object({
      path: z.string().min(1).describe('Caminho relativo ao workspace.'),
      name: z.string().min(1).describe('Nome exato do símbolo a localizar.'),
    })
    .strict(),
  output: z.object({
    path: z.string(),
    name: z.string(),
    found: z.boolean(),
    matches: z.array(SymbolMatchSchema),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (args, ctx) => {
    assertSupported(args.path);
    const text = readTextGlobal(ctx, args.path);
    const matches = querySymbol(args.path, text, args.name);
    return { path: args.path, name: args.name, found: matches.length > 0, matches };
  },
});

// ===========================================================================
// find_inheritance
// ===========================================================================

const InheritanceSchema = z.object({
  name: z.string(),
  kind: z.enum(['class', 'interface']),
  extends: z.array(z.string()),
  implements: z.array(z.string()),
});

export const findInheritanceTool: LocalTool = defineZodTool({
  name: 'find_inheritance',
  description:
    'Grafo de herança de um arquivo TS/JS: para cada classe/interface, seus `extends` e `implements` (como escrito). Opcionalmente filtra por nome. Sintático — não resolve a cadeia cross-file.',
  input: z
    .object({
      path: z.string().min(1).describe('Caminho relativo ao workspace.'),
      name: z.string().min(1).optional().describe('Filtra para uma classe/interface específica.'),
    })
    .strict(),
  output: z.object({
    path: z.string(),
    entries: z.array(InheritanceSchema),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (args, ctx) => {
    assertSupported(args.path);
    const text = readTextGlobal(ctx, args.path);
    return { path: args.path, entries: findInheritance(args.path, text, args.name) };
  },
});

// ===========================================================================
// find_documentation
// ===========================================================================

const DocSchema = z.object({
  symbol: z.string(),
  kind: z.string(),
  line: z.number(),
  doc: z.string(),
});

export const findDocumentationTool: LocalTool = defineZodTool({
  name: 'find_documentation',
  description:
    'Extrai o bloco JSDoc imediatamente acima das declarações de um símbolo (por nome) em um arquivo TS/JS. Retorna só entradas que têm documentação.',
  input: z
    .object({
      path: z.string().min(1).describe('Caminho relativo ao workspace.'),
      name: z.string().min(1).describe('Nome exato do símbolo.'),
    })
    .strict(),
  output: z.object({
    path: z.string(),
    name: z.string(),
    found: z.boolean(),
    docs: z.array(DocSchema),
  }),
  capabilities: FS_READ,
  intent: 'read',
  pure: false,
  run: (args, ctx) => {
    assertSupported(args.path);
    const text = readTextGlobal(ctx, args.path);
    const docs = findDocumentation(args.path, text, args.name);
    return { path: args.path, name: args.name, found: docs.length > 0, docs };
  },
});

import { semanticAstTools } from './semantic.js';

export * from './semantic.js';
export { getLanguageService, disposeAllLanguageServices } from './program.js';

/** Todas as tools do namespace ast/ (sintáticas single-file + motor semântico). */
export const astTools: LocalTool[] = [
  analyzeModuleTool,
  queryAstSymbolTool,
  findInheritanceTool,
  findDocumentationTool,
  ...semanticAstTools,
];
