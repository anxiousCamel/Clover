# Plano de Implementação: Telemetria Estruturada

Rastreia e analisa a performance e as decisões dos agentes.

## 1. Requisitos
- Registrar cada estágio do pipeline (`Gate`, `Classifier`, `Extractor`, `Router`).
- Logar o tempo gasto em cada chamada de LLM.
- Persistir logs de erros detalhados para depuração offline.

## 2. Design
- **Telemetry Bus:** Um Singleton baseado em `EventEmitter` que centraliza todos os eventos de sistema.
- **Persistence:** Uma nova tabela `telemetry_logs` no SQLite.
- **Tracing:** Gerar um `traceId` único por mensagem do usuário que ligue todos os passos internos.

## 3. Tarefas
- [ ] Criar o módulo `telemetry.bus.ts`.
- [ ] Criar a migration para a tabela de telemetria no SQLite.
- [ ] Injetar chamadas de telemetria nos estágios do `runPipeline`.
- [ ] Implementar um logger de latência para requisições Ollama/OpenClaude.
- [ ] Criar uma rota de API `/api/telemetry` para consulta de logs via UI.
