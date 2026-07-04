/**
 * @clover/ast-index — Índice estrutural de código (RAP §7, §9; Fase 4).
 *
 * O Clover opera sobre **AST**, não texto: símbolos (funções, classes, métodos,
 * interfaces, tipos, enums, variáveis) e imports são extraídos estruturalmente.
 * É a base para recuperação estrutural (em vez de despejar arquivos crus no LLM)
 * e para o Knowledge Graph.
 *
 * Backend default: **TypeScript Compiler API** (já instalado, zero dependência
 * nativa) — cobre TS/JS/TSX/JSX, as linguagens do próprio monorepo. Um backend
 * `TreeSitterAstParser` (multi-linguagem, gramáticas WASM) entra atrás da mesma
 * interface `AstParser` — adiado pelo mesmo motivo de asset/build nativo do
 * sandbox Tier 1/2 (ver PROGRESS.md). A troca não muda o índice nem o KG.
 */

import ts from 'typescript';

export type SymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable';

export interface AstSymbol {
  name: string;
  kind: SymbolKind;
  filePath: string;
  /** Linha 1-based. */
  line: number;
  /** Última linha da declaração (1-based) — base para métricas de tamanho. */
  endLine?: number;
  exported: boolean;
  /** Container (ex.: nome da classe para métodos). */
  container?: string;
}

export interface AstImport {
  filePath: string;
  /** Módulo importado (module specifier). */
  from: string;
  /** Identificadores importados (default/namespace/named). */
  names: string[];
  line: number;
}

export interface FileAst {
  filePath: string;
  symbols: AstSymbol[];
  imports: AstImport[];
}

/** Backend de parsing plugável (TS Compiler hoje; tree-sitter depois). */
export interface AstParser {
  readonly languages: string[];
  canParse(filePath: string): boolean;
  parse(filePath: string, source: string): FileAst;
}

function scriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function hasExport(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const mods = ts.getModifiers(node);
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

/** Parser baseado na TypeScript Compiler API. */
export class TypeScriptAstParser implements AstParser {
  readonly languages = ['typescript', 'javascript', 'tsx', 'jsx'];

  canParse(filePath: string): boolean {
    return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filePath);
  }

  parse(filePath: string, source: string): FileAst {
    const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind(filePath));
    const symbols: AstSymbol[] = [];
    const imports: AstImport[] = [];
    const lineOf = (node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const endLineOf = (node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;

    const add = (name: string, kind: SymbolKind, node: ts.Node, exported: boolean, container?: string): void => {
      symbols.push({ name, kind, filePath, line: lineOf(node), endLine: endLineOf(node), exported, container });
    };

    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        add(node.name.text, 'function', node, hasExport(node));
      } else if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.text;
        add(className, 'class', node, hasExport(node));
        for (const member of node.members) {
          if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
            add(member.name.text, 'method', member, false, className);
          }
        }
      } else if (ts.isInterfaceDeclaration(node)) {
        add(node.name.text, 'interface', node, hasExport(node));
      } else if (ts.isTypeAliasDeclaration(node)) {
        add(node.name.text, 'type', node, hasExport(node));
      } else if (ts.isEnumDeclaration(node)) {
        add(node.name.text, 'enum', node, hasExport(node));
      } else if (ts.isVariableStatement(node)) {
        const exported = hasExport(node);
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) add(decl.name.text, 'variable', decl, exported);
        }
      } else if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push({
          filePath,
          from: node.moduleSpecifier.text,
          names: importedNames(node),
          line: lineOf(node),
        });
      }
      ts.forEachChild(node, visit);
    };

    visit(sf);
    return { filePath, symbols, imports };
  }
}

function importedNames(node: ts.ImportDeclaration): string[] {
  const clause = node.importClause;
  if (!clause) return [];
  const names: string[] = [];
  if (clause.name) names.push(clause.name.text); // default
  const bindings = clause.namedBindings;
  if (bindings) {
    if (ts.isNamespaceImport(bindings)) {
      names.push(`* as ${bindings.name.text}`);
    } else {
      for (const el of bindings.elements) names.push(el.name.text);
    }
  }
  return names;
}

/** Índice de ASTs por arquivo + consultas estruturais. */
export class AstIndex {
  private readonly files = new Map<string, FileAst>();

  constructor(private readonly parser: AstParser = new TypeScriptAstParser()) {}

  /** Indexa (ou reindexa) um arquivo. Ignora extensões não suportadas. */
  indexFile(filePath: string, source: string): FileAst | undefined {
    if (!this.parser.canParse(filePath)) return undefined;
    const ast = this.parser.parse(filePath, source);
    this.files.set(filePath, ast);
    return ast;
  }

  removeFile(filePath: string): void {
    this.files.delete(filePath);
  }

  outline(filePath: string): FileAst | undefined {
    return this.files.get(filePath);
  }

  allFiles(): FileAst[] {
    return [...this.files.values()];
  }

  allSymbols(): AstSymbol[] {
    return this.allFiles().flatMap((f) => f.symbols);
  }

  /** Símbolos com um dado nome (definições). */
  findSymbol(name: string): AstSymbol[] {
    return this.allSymbols().filter((s) => s.name === name);
  }

  get fileCount(): number {
    return this.files.size;
  }
}
