/**
 * ast/parse — Motor de análise estática **sintática** (SRP: só AST, sem I/O nem
 * Zod). Usa a TypeScript Compiler API via `ts.createSourceFile`.
 *
 * ESCOPO (honesto): análise de **um único arquivo**, puramente sintática. Não há
 * `Program`/`TypeChecker`/resolução de `tsconfig` — logo NÃO resolvemos tipos,
 * referências cruzadas entre arquivos, nem `find_references`/`find_type_definition`
 * semânticos. O que extraímos é o que está **escrito** no arquivo: imports,
 * exports, declarações e assinaturas-como-escritas. Determinístico e sem efeitos.
 *
 * Formas de export cobertas: `export` inline em declaração, `export { a, b }`,
 * `export { a } from './x'`, `export * from './x'`, `export default`. Namespaces
 * (`namespace`/`module`) e `export =` são reportados de forma básica.
 */

import ts from 'typescript';

export interface ImportInfo {
  /** Especificador do módulo (ex.: `node:fs`, `./util`). */
  module: string;
  /** Forma do import. */
  form: 'default' | 'named' | 'namespace' | 'side-effect';
  /** Nomes importados (default/namespace: nome local; named: nomes; side-effect: vazio). */
  names: string[];
}

export interface ExportInfo {
  /** Nome exportado (`default` para export default; `*` para re-export estrela). */
  name: string;
  kind:
    | 'class'
    | 'interface'
    | 'function'
    | 'variable'
    | 'type'
    | 'enum'
    | 'default'
    | 're-export'
    | 'namespace';
  /** Módulo de origem quando é re-export (`export ... from './x'`). */
  reexportFrom?: string;
}

export interface ClassInfo {
  name: string;
  line: number;
  exported: boolean;
  abstract: boolean;
  extends?: string;
  implements: string[];
  decorators: string[];
  methods: string[];
  properties: string[];
}

export interface InterfaceInfo {
  name: string;
  line: number;
  exported: boolean;
  extends: string[];
}

export interface FunctionInfo {
  name: string;
  line: number;
  exported: boolean;
  async: boolean;
  params: string[];
}

export interface VariableInfo {
  name: string;
  line: number;
  exported: boolean;
  kind: 'const' | 'let' | 'var';
}

export interface EnumInfo {
  name: string;
  line: number;
  exported: boolean;
  members: string[];
}

export interface TypeAliasInfo {
  name: string;
  line: number;
  exported: boolean;
}

export interface ModuleAnalysis {
  imports: ImportInfo[];
  exports: ExportInfo[];
  classes: ClassInfo[];
  interfaces: InterfaceInfo[];
  functions: FunctionInfo[];
  variables: VariableInfo[];
  enums: EnumInfo[];
  typeAliases: TypeAliasInfo[];
  /** Nomes distintos de decorators usados no arquivo (ex.: `Injectable`, `Get`). */
  decorators: string[];
}

export interface SymbolMatch {
  name: string;
  kind:
    | 'class'
    | 'interface'
    | 'function'
    | 'variable'
    | 'type'
    | 'enum'
    | 'method'
    | 'property'
    | 'enum-member';
  line: number;
  column: number;
  exported: boolean;
  /** Assinatura como escrita (primeira linha da declaração), aparada e limitada. */
  signature: string;
}

export interface InheritanceInfo {
  name: string;
  kind: 'class' | 'interface';
  /** Supertipos via `extends` (classe: 0–1; interface: 0–N). */
  extends: string[];
  /** Interfaces via `implements` (só classes). */
  implements: string[];
}

export interface DocInfo {
  symbol: string;
  kind: string;
  line: number;
  /** Texto do bloco JSDoc imediatamente acima da declaração, já limpo. */
  doc: string;
}

const SIGNATURE_MAX = 200;

/** Extensões suportadas → ScriptKind do parser (TSX/JSX habilitam JSX). */
const SCRIPT_KIND: Record<string, ts.ScriptKind> = {
  ts: ts.ScriptKind.TS,
  mts: ts.ScriptKind.TS,
  cts: ts.ScriptKind.TS,
  tsx: ts.ScriptKind.TSX,
  js: ts.ScriptKind.JS,
  mjs: ts.ScriptKind.JS,
  cjs: ts.ScriptKind.JS,
  jsx: ts.ScriptKind.JSX,
};

/** Retorna a ScriptKind para uma extensão, ou `undefined` se não suportada. */
export function scriptKindFor(fileName: string): ts.ScriptKind | undefined {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return SCRIPT_KIND[ext];
}

/** Extensões de arquivo que este motor sabe parsear. */
export const SUPPORTED_EXTENSIONS = Object.keys(SCRIPT_KIND);

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function hasAbstractModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.AbstractKeyword);
}

function hasAsyncModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
}

function decoratorNames(node: ts.Node): string[] {
  if (!ts.canHaveDecorators(node)) return [];
  const decs = ts.getDecorators(node) ?? [];
  return decs.map((d) => {
    const expr = d.expression;
    // `@Foo` → Foo; `@Foo(...)` → Foo; `@ns.Foo(...)` → ns.Foo
    const callee = ts.isCallExpression(expr) ? expr.expression : expr;
    return callee.getText();
  });
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function posOf(sf: ts.SourceFile, node: ts.Node): { line: number; column: number } {
  const lc = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { line: lc.line + 1, column: lc.character + 1 };
}

function firstLine(sf: ts.SourceFile, node: ts.Node): string {
  const text = node.getText(sf).split('\n')[0]!.trim();
  return text.length > SIGNATURE_MAX ? `${text.slice(0, SIGNATURE_MAX)}…` : text;
}

/** `const|let|var` a partir das flags do `VariableDeclarationList`. */
function varKind(list: ts.VariableDeclarationList): 'const' | 'let' | 'var' {
  if (list.flags & ts.NodeFlags.Const) return 'const';
  if (list.flags & ts.NodeFlags.Let) return 'let';
  return 'var';
}

function paramTexts(node: ts.SignatureDeclarationBase): string[] {
  return node.parameters.map((p) => p.name.getText());
}

/**
 * Analisa o texto de um módulo TS/JS. `fileName` só determina a ScriptKind
 * (JSX/TSX). Puro: mesma entrada → mesma saída, sem tocar disco.
 */
export function analyzeSource(fileName: string, text: string): ModuleAnalysis {
  const kind = scriptKindFor(fileName) ?? ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, /*setParentNodes*/ true, kind);

  const analysis: ModuleAnalysis = {
    imports: [],
    exports: [],
    classes: [],
    interfaces: [],
    functions: [],
    variables: [],
    enums: [],
    typeAliases: [],
    decorators: [],
  };
  const decoratorSet = new Set<string>();

  const collectDecorators = (node: ts.Node): string[] => {
    const names = decoratorNames(node);
    for (const n of names) decoratorSet.add(n);
    return names;
  };

  for (const stmt of sf.statements) {
    // --- imports ---------------------------------------------------------
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const module = stmt.moduleSpecifier.text;
      const clause = stmt.importClause;
      if (!clause) {
        analysis.imports.push({ module, form: 'side-effect', names: [] });
      } else {
        if (clause.name) {
          analysis.imports.push({ module, form: 'default', names: [clause.name.text] });
        }
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          analysis.imports.push({ module, form: 'namespace', names: [bindings.name.text] });
        } else if (bindings && ts.isNamedImports(bindings)) {
          analysis.imports.push({
            module,
            form: 'named',
            names: bindings.elements.map((e) => e.name.text),
          });
        }
      }
      continue;
    }

    // --- export declarations (export {}, export * from, export {} from) --
    if (ts.isExportDeclaration(stmt)) {
      const from =
        stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
          ? stmt.moduleSpecifier.text
          : undefined;
      if (!stmt.exportClause) {
        // export * from './x'
        analysis.exports.push({ name: '*', kind: 're-export', reexportFrom: from });
      } else if (ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          analysis.exports.push(
            from
              ? { name: el.name.text, kind: 're-export', reexportFrom: from }
              : { name: el.name.text, kind: 'variable' },
          );
        }
      } else if (ts.isNamespaceExport(stmt.exportClause)) {
        // export * as ns from './x'
        analysis.exports.push({ name: stmt.exportClause.name.text, kind: 're-export', reexportFrom: from });
      }
      continue;
    }

    // --- export default / export = --------------------------------------
    if (ts.isExportAssignment(stmt)) {
      analysis.exports.push({
        name: stmt.isExportEquals ? stmt.expression.getText() : 'default',
        kind: 'default',
      });
      continue;
    }

    // --- class -----------------------------------------------------------
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      const exported = hasExportModifier(stmt);
      const decorators = collectDecorators(stmt);
      let ext: string | undefined;
      const impls: string[] = [];
      for (const clause of stmt.heritageClauses ?? []) {
        if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
          ext = clause.types[0]?.expression.getText();
        } else if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
          for (const t of clause.types) impls.push(t.expression.getText());
        }
      }
      const methods: string[] = [];
      const properties: string[] = [];
      for (const member of stmt.members) {
        collectDecorators(member); // decorators de métodos/props (ex.: @Get())
        const mname = member.name && ts.isIdentifier(member.name) ? member.name.text
          : member.name?.getText();
        if (!mname) continue;
        if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) {
          methods.push(ts.isConstructorDeclaration(member) ? 'constructor' : mname);
        } else if (ts.isPropertyDeclaration(member)) {
          properties.push(mname);
        } else if (ts.isGetAccessor(member) || ts.isSetAccessor(member)) {
          methods.push(mname);
        }
      }
      analysis.classes.push({
        name: stmt.name.text,
        line: lineOf(sf, stmt),
        exported,
        abstract: hasAbstractModifier(stmt),
        extends: ext,
        implements: impls,
        decorators,
        methods,
        properties,
      });
      if (exported) analysis.exports.push({ name: stmt.name.text, kind: 'class' });
      continue;
    }

    // --- interface -------------------------------------------------------
    if (ts.isInterfaceDeclaration(stmt)) {
      const exported = hasExportModifier(stmt);
      const ext: string[] = [];
      for (const clause of stmt.heritageClauses ?? []) {
        if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
          for (const t of clause.types) ext.push(t.expression.getText());
        }
      }
      analysis.interfaces.push({ name: stmt.name.text, line: lineOf(sf, stmt), exported, extends: ext });
      if (exported) analysis.exports.push({ name: stmt.name.text, kind: 'interface' });
      continue;
    }

    // --- function --------------------------------------------------------
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const exported = hasExportModifier(stmt);
      analysis.functions.push({
        name: stmt.name.text,
        line: lineOf(sf, stmt),
        exported,
        async: hasAsyncModifier(stmt),
        params: paramTexts(stmt),
      });
      if (exported) analysis.exports.push({ name: stmt.name.text, kind: 'function' });
      continue;
    }

    // --- enum ------------------------------------------------------------
    if (ts.isEnumDeclaration(stmt)) {
      const exported = hasExportModifier(stmt);
      analysis.enums.push({
        name: stmt.name.text,
        line: lineOf(sf, stmt),
        exported,
        members: stmt.members.map((m) => m.name.getText()),
      });
      if (exported) analysis.exports.push({ name: stmt.name.text, kind: 'enum' });
      continue;
    }

    // --- type alias ------------------------------------------------------
    if (ts.isTypeAliasDeclaration(stmt)) {
      const exported = hasExportModifier(stmt);
      analysis.typeAliases.push({ name: stmt.name.text, line: lineOf(sf, stmt), exported });
      if (exported) analysis.exports.push({ name: stmt.name.text, kind: 'type' });
      continue;
    }

    // --- variables (const/let/var), inclui arrow/fn atribuídas ----------
    if (ts.isVariableStatement(stmt)) {
      const exported = hasExportModifier(stmt);
      const kind = varKind(stmt.declarationList);
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue; // ignora desestruturação
        const name = decl.name.text;
        const init = decl.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          analysis.functions.push({
            name,
            line: lineOf(sf, stmt),
            exported,
            async: hasAsyncModifier(init),
            params: paramTexts(init),
          });
          if (exported) analysis.exports.push({ name, kind: 'function' });
        } else {
          analysis.variables.push({ name, line: lineOf(sf, stmt), exported, kind });
          if (exported) analysis.exports.push({ name, kind: 'variable' });
        }
      }
      continue;
    }
  }

  analysis.decorators = [...decoratorSet].sort();
  return analysis;
}

/**
 * Localiza declarações de topo (e membros de classe/enum) cujo nome bate com
 * `symbolName`. Puramente sintático; retorna todas as ocorrências (um nome pode
 * aparecer como interface + função, overloads, etc.).
 */
export function querySymbol(fileName: string, text: string, symbolName: string): SymbolMatch[] {
  const kind = scriptKindFor(fileName) ?? ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const matches: SymbolMatch[] = [];

  const push = (node: ts.Node, name: string, k: SymbolMatch['kind'], exported: boolean) => {
    if (name !== symbolName) return;
    const { line, column } = posOf(sf, node);
    matches.push({ name, kind: k, line, column, exported, signature: firstLine(sf, node) });
  };

  for (const stmt of sf.statements) {
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      const exported = hasExportModifier(stmt);
      push(stmt, stmt.name.text, 'class', exported);
      for (const member of stmt.members) {
        const mname = member.name && ts.isIdentifier(member.name) ? member.name.text : undefined;
        if (!mname) continue;
        if (ts.isMethodDeclaration(member) || ts.isGetAccessor(member) || ts.isSetAccessor(member)) {
          push(member, mname, 'method', exported);
        } else if (ts.isPropertyDeclaration(member)) {
          push(member, mname, 'property', exported);
        }
      }
    } else if (ts.isInterfaceDeclaration(stmt)) {
      push(stmt, stmt.name.text, 'interface', hasExportModifier(stmt));
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      push(stmt, stmt.name.text, 'function', hasExportModifier(stmt));
    } else if (ts.isEnumDeclaration(stmt)) {
      const exported = hasExportModifier(stmt);
      push(stmt, stmt.name.text, 'enum', exported);
      for (const m of stmt.members) push(m, m.name.getText(), 'enum-member', exported);
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      push(stmt, stmt.name.text, 'type', hasExportModifier(stmt));
    } else if (ts.isVariableStatement(stmt)) {
      const exported = hasExportModifier(stmt);
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const init = decl.initializer;
        const isFn = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
        push(decl, decl.name.text, isFn ? 'function' : 'variable', exported);
      }
    }
  }
  return matches;
}

/**
 * Extrai o grafo de herança (classes e interfaces) do arquivo. Reusa
 * `analyzeSource` (DRY) — `extends`/`implements` já são capturados lá. Filtra por
 * `name` quando fornecido.
 */
export function findInheritance(fileName: string, text: string, name?: string): InheritanceInfo[] {
  const a = analyzeSource(fileName, text);
  const out: InheritanceInfo[] = [];
  for (const c of a.classes) {
    out.push({ name: c.name, kind: 'class', extends: c.extends ? [c.extends] : [], implements: c.implements });
  }
  for (const i of a.interfaces) {
    out.push({ name: i.name, kind: 'interface', extends: i.extends, implements: [] });
  }
  return name ? out.filter((e) => e.name === name) : out;
}

/** Limpa um bloco de comentário JSDoc bruto em texto de uma ou mais linhas. */
function cleanJsDoc(raw: string): string {
  return raw
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*?\s?/, '').trimEnd())
    .join('\n')
    .trim();
}

/** JSDoc imediatamente acima de `node` (última faixa de comentário JSDoc), ou ''. */
function leadingJsDoc(fullText: string, node: ts.Node): string {
  const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart()) ?? [];
  const doc = [...ranges].reverse().find((r) => fullText.slice(r.pos, r.pos + 3) === '/**');
  return doc ? cleanJsDoc(fullText.slice(doc.pos, doc.end)) : '';
}

/**
 * Localiza a documentação JSDoc de um símbolo (declarações de topo + membros de
 * classe) por nome. Sintático: lê o bloco JSDoc imediatamente acima da
 * declaração. Retorna só entradas COM doc (nome sem JSDoc não polui a saída).
 */
export function findDocumentation(fileName: string, text: string, symbolName: string): DocInfo[] {
  const kind = scriptKindFor(fileName) ?? ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const out: DocInfo[] = [];

  const take = (node: ts.Node, name: string, k: string) => {
    if (name !== symbolName) return;
    const doc = leadingJsDoc(text, node);
    if (doc) out.push({ symbol: name, kind: k, line: lineOf(sf, node), doc });
  };

  for (const stmt of sf.statements) {
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      take(stmt, stmt.name.text, 'class');
      for (const member of stmt.members) {
        const mname = member.name && ts.isIdentifier(member.name) ? member.name.text : undefined;
        if (!mname) continue;
        if (ts.isMethodDeclaration(member)) take(member, mname, 'method');
        else if (ts.isPropertyDeclaration(member)) take(member, mname, 'property');
      }
    } else if (ts.isInterfaceDeclaration(stmt)) {
      take(stmt, stmt.name.text, 'interface');
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      take(stmt, stmt.name.text, 'function');
    } else if (ts.isEnumDeclaration(stmt)) {
      take(stmt, stmt.name.text, 'enum');
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      take(stmt, stmt.name.text, 'type');
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        // JSDoc de `const x` fica acima do VariableStatement, não do declarator.
        if (ts.isIdentifier(decl.name)) take(stmt, decl.name.text, 'variable');
      }
    }
  }
  return out;
}
