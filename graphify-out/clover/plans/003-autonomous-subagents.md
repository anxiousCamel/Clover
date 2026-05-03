# Plano de Implementação: Subagentes Autônomos

Permite que um agente "pai" delegue tarefas para agentes "filhos" especializados.

## 1. Requisitos
- Ferramenta `spawn-subagent` que recebe um `goal` e um `agentType`.
- O subagente deve ter seu próprio histórico de chat mas compartilhar o acesso à memória (LanceDB).
- O agente pai deve pausar a execução e aguardar o resultado do subagente.

## 2. Design
- **Recursive Orchestration:** O `Orchestrator` deve ser capaz de criar contextos de execução aninhados.
- **Communication Bridge:** O resultado final do subagente é injetado como um `ToolResult` no contexto do agente pai.
- **UI:** A interface deve ser capaz de mostrar visualmente a hierarquia de agentes (ex: uma árvore de execução).

## 3. Tarefas
- [ ] Refatorar o `Orchestrator` para suportar múltiplas sessões simultâneas ligadas.
- [ ] Criar a ferramenta `spawn-subagent.tool.ts`.
- [ ] Implementar o limite de profundidade (recursion limit) para evitar loops infinitos de agentes.
- [ ] Adicionar suporte a "Delegated Context" no `AgentEngine`.
- [ ] Atualizar a UI para mostrar logs de subagentes em colapsáveis ou abas.
