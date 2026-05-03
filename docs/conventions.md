# Convenções do Projeto Clover

## 1. Nomenclatura e Estrutura
- **Agentes:** `*.agent.ts` em `apps/backend/src/agents/`. Devem ter um `system-prompt.md` associado.
- **Tools:** `*.tool.ts` em `apps/backend/src/tools/plugins/`. Devem usar schemas Zod.
- **Pipeline:** Lógica de roteamento em `apps/backend/src/pipeline/`.

## 2. Tratamento de Caminhos (OS Abstraction)
- **Sempre** usar `node:path` para manipulação de caminhos.
- **Normalização:** Todos os paths extraídos do pipeline devem passar por `path.normalize()`.
- **Raiz:** Usar `os.homedir()` para resolver `Desktop`, `Documents`, etc.
- **Workspace:** Respeitar a variável de ambiente `CLOVER_WORKSPACE` quando disponível.

## 3. Validação de Execução
- Nenhuma ferramenta de escrita deve agir sobre um diretório.
- Plugins de ferramentas devem validar schemas Zod no início da execução.
- O `ExecutionRouter` deve bloquear execuções com `confidence < 0.5`.

## 4. Pipeline de Intenção
O fluxo de entrada segue estritamente:
`Gate -> Classify -> Extract -> Route -> Execute`

### Prioridade de Parâmetros
1. Valor explícito na mensagem.
2. Nome de arquivo natural ("arquivo config json").
3. Localização conhecida ("desktop").
4. Contexto recente (lastFilePath) — somente se houver termo deítico.
