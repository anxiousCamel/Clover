/**
 * @clover/tools — Ponte Zod → Tool ABI.
 *
 * O mandato exige **Zod em toda interface pública**. A Tool ABI
 * (`@clover/tool-abi`) fala JSON Schema (`ToolDescriptor.inputSchema`). Este
 * módulo costura os dois: o autor da tool declara `input`/`output` como schemas
 * Zod e recebe, de graça:
 *
 *   1. `inputSchema`/`outputSchema` JSON Schema derivados (para o Planner, que os
 *      injeta no prompt — ver `@clover/planner/prompt.ts`);
 *   2. **validação em runtime** dos argumentos: args fora do schema viram um
 *      `ToolResult` de erro estruturado, nunca uma exceção crua;
 *   3. validação defensiva da **saída** (um output inválido é bug da tool e é
 *      reportado como tal, não propagado).
 *
 * O JSON Schema é mantido enxuto de propósito (`$refStrategy: 'none'`, sem
 * `$schema`): o Planner serializa o `inputSchema` inteiro no prompt e roda em
 * modelos pequenos — schema verboso custa tokens.
 */

import type {
  CapabilityRequest,
  JsonSchema,
  ToolIntent,
  ToolInvocation,
  ToolResult,
} from '@clover/contracts';
import { defineTool, type LocalTool } from '@clover/tool-abi';
import type { ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/** Handler de uma tool: recebe args JÁ validados/tipados e o contexto. */
export type ZodToolRun<I, O> = (args: I, ctx: ToolInvocation) => Promise<O> | O;

export interface ZodToolSpec<I, O> {
  /** Nome único e estável (snake_case, prefixado pelo namespace, ex.: `git_status`). */
  name: string;
  /** Descrição em uma linha — vista pelo Planner. */
  description: string;
  /** Schema dos argumentos de entrada (interface pública). */
  input: ZodType<I>;
  /** Schema da saída estruturada. */
  output: ZodType<O>;
  /** Capabilities exigidas (ex.: `proc.exec` para `git`). Default: nenhuma. */
  capabilities?: CapabilityRequest[];
  /** Idempotente/sem efeito colateral? Default: `false` (a maioria das tools reais não é). */
  pure?: boolean;
  /** Intenção de efeito (default `read`). `write`/`destructive` exigem autorização do Governor. */
  intent?: ToolIntent;
  /** Implementação. Pode lançar — a exceção vira `ToolResult` de erro. */
  run: ZodToolRun<I, O>;
}

/** Converte um schema Zod em JSON Schema enxuto para a Tool ABI/prompt. */
export function toJsonSchema(schema: ZodType): JsonSchema {
  const js = zodToJsonSchema(schema, {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  }) as Record<string, unknown>;
  // Ruído desnecessário no prompt do Planner.
  delete js.$schema;
  delete js.definitions;
  return js as JsonSchema;
}

/** Formata erros do Zod em uma linha legível (`campo: motivo; ...`). */
function formatZodError(err: { issues: Array<{ path: Array<string | number>; message: string }> }): string {
  return err.issues
    .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
    .join('; ');
}

/**
 * Declara uma `LocalTool` a partir de schemas Zod. Este é o construtor canônico
 * de toda ferramenta do arsenal `@clover/tools`.
 */
export function defineZodTool<I, O>(spec: ZodToolSpec<I, O>): LocalTool {
  const inputSchema = toJsonSchema(spec.input);
  const outputSchema = toJsonSchema(spec.output);

  return defineTool(
    {
      name: spec.name,
      description: spec.description,
      inputSchema,
      outputSchema,
      capabilities: spec.capabilities ?? [],
      pure: spec.pure ?? false,
      intent: spec.intent ?? 'read',
    },
    async (rawArgs, ctx): Promise<ToolResult> => {
      const parsed = spec.input.safeParse(rawArgs);
      if (!parsed.success) {
        return {
          success: false,
          output: null,
          error: `args inválidos para '${spec.name}': ${formatZodError(parsed.error)}`,
        };
      }
      let out: O;
      try {
        out = await spec.run(parsed.data, ctx);
      } catch (err) {
        return {
          success: false,
          output: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      const checked = spec.output.safeParse(out);
      if (!checked.success) {
        return {
          success: false,
          output: null,
          error: `output inválido de '${spec.name}': ${formatZodError(checked.error)}`,
        };
      }
      return { success: true, output: checked.data };
    },
  );
}
