# Plano de Implementação: Suporte a MCP (Model Context Protocol)

Este plano descreve como integrar o Clover com o protocolo MCP para permitir a conexão com servidores de ferramentas externos.

## 1. Requisitos
- Ser capaz de configurar uma lista de servidores MCP no `default.config.json`.
- Descobrir ferramentas dinamicamente ao iniciar o servidor.
- Executar ferramentas MCP passando os argumentos extraídos pelo `ParamExtractor`.
- Suportar autenticação básica quando exigido pelo servidor MCP.

## 2. Design
- **MCP Connector:** Um novo serviço em `apps/backend/src/mcp/connector.ts` que gerencia a conexão com os servidores (via stdio ou SSE).
- **Dynamic Tool Provider:** Uma extensão do `ToolRegistry` que aceita ferramentas injetadas em tempo de execução.
- **Protocolo:** Utilizar a biblioteca oficial `@modelcontextprotocol/sdk`.

## 3. Tarefas
- [ ] Instalar o SDK oficial do MCP.
- [ ] Criar o módulo `mcp.connector.ts` para gerenciar o ciclo de vida das conexões.
- [ ] Atualizar o `tool-registry.ts` para permitir o registro de ferramentas externas.
- [ ] Implementar um adaptador que converte o schema de ferramentas MCP para o formato interno do Clover (Zod).
- [ ] Adicionar suporte a múltiplos servidores no arquivo de configuração.
