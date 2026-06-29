/**
 * @clover/tool-abi — Contrato uniforme de ferramentas + Registry + Bridge.
 *
 * Toda ferramenta — local, MCP, WASM ou remota — é apresentada pela mesma ABI
 * (RAP §11.12). Na Fatia 1 implementamos o caminho `local`; MCP/WASM/remote
 * entram como bridges adicionais sem tocar o Kernel.
 */

import type {
  ToolDescriptor,
  ToolInvocation,
  ToolResult,
} from '@clover/contracts';

/** Handler de execução de uma tool local. */
export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolInvocation,
) => Promise<ToolResult> | ToolResult;

/** Uma tool local = descritor + handler. */
export interface LocalTool {
  descriptor: ToolDescriptor;
  handler: ToolHandler;
}

/** Erro de registro (nome duplicado, etc.). */
export class ToolRegistryError extends Error {}

/** Registry in-memory de tools locais, indexado por nome. */
export class ToolRegistry {
  private readonly tools = new Map<string, LocalTool>();

  register(tool: LocalTool): void {
    const name = tool.descriptor.name;
    if (this.tools.has(name)) {
      throw new ToolRegistryError(`tool já registrada: ${name}`);
    }
    this.tools.set(name, tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): LocalTool | undefined {
    return this.tools.get(name);
  }

  list(): ToolDescriptor[] {
    return [...this.tools.values()].map((t) => t.descriptor);
  }
}

/**
 * Bridge: ponto único de invocação que o Executor usa. Abstrai a origem da
 * tool (local agora; MCP/WASM/remote depois).
 */
export interface ToolBridge {
  list(): ToolDescriptor[];
  has(name: string): boolean;
  describe(name: string): ToolDescriptor | undefined;
  invoke(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolInvocation,
  ): Promise<ToolResult>;
}

/** Bridge para tools locais registradas em um ToolRegistry. */
export class LocalToolBridge implements ToolBridge {
  constructor(private readonly registry: ToolRegistry) {}

  list(): ToolDescriptor[] {
    return this.registry.list();
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  describe(name: string): ToolDescriptor | undefined {
    return this.registry.get(name)?.descriptor;
  }

  async invoke(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolInvocation,
  ): Promise<ToolResult> {
    const tool = this.registry.get(name);
    if (!tool) {
      return { success: false, output: null, error: `tool não encontrada: ${name}` };
    }
    try {
      return await tool.handler(args, ctx);
    } catch (err) {
      return {
        success: false,
        output: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/** Helper para declarar uma tool local com defaults sensatos. */
export function defineTool(
  descriptor: Omit<ToolDescriptor, 'origin'> & { origin?: ToolDescriptor['origin'] },
  handler: ToolHandler,
): LocalTool {
  return {
    descriptor: { origin: 'local', ...descriptor },
    handler,
  };
}
