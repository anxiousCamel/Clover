# Convenções de Código

Para manter a consistência do Clover, seguimos estas diretrizes de desenvolvimento.

## Estrutura de Pastas (Monorepo)

- `apps/backend/src`: Lógica central em TypeScript.
    - `/agents`: Definições e prompts dos agentes.
    - `/pipeline`: Implementação dos estágios do pipeline.
    - `/tools`: Plugins de ferramentas.
    - `/memory`: Integração com LanceDB.
- `apps/ui/src`: Interface React.
    - `/components`: UI Atômica e componentes de Chat.
    - `/api`: Clientes HTTP e WebSocket.
- `shared/`: Tipos Zod e interfaces compartilhadas entre front e back.

## Nomenclatura

- **Arquivos:** `kebab-case.ts` (ex: `execute-command.tool.ts`).
- **Interfaces:** `PascalCase` (ex: `AgentContext`).
- **Funções:** `camelCase` (ex: `classifyIntent`).
- **Variáveis de Ambiente:** `UPPER_SNAKE_CASE` (ex: `CLOVER_WORKSPACE`).

## Padrões de Código

1. **Segurança de Filesystem:** Nunca use `fs` diretamente nos agentes. Sempre use os plugins de ferramentas que passam pelo `ExecutionRouter`.
2. **Tipagem:** Toda ferramenta deve ter um schema `Zod` para entrada de dados.
3. **Erros:** Use as classes de erro customizadas (ex: `WorkspaceBoundaryError`) para que a UI possa renderizar mensagens amigáveis.
4. **Assincronismo:** Use `async/await` em detrimento de callbacks ou `.then()`.

## Como adicionar uma nova ferramenta
1. Crie o arquivo em `apps/backend/src/tools/plugins/[nome].tool.ts`.
2. Implemente a interface `ToolPlugin`.
3. Registre o nome da ferramenta no enum `TOOL_NAMES` em `shared/types`.
4. Adicione a lógica de extração de parâmetros no `ParamExtractor` se necessário.
