# @clover/tools — Arsenal de ferramentas do CloverOS

Ferramentas reais organizadas por **namespaces/departamentos**. Cada tool é uma
`LocalTool` (`@clover/tool-abi`) pronta para registro no Kernel — o que a torna
automaticamente visível ao Planner e ao Context Builder
(`Agent → kernel.listTools() → ToolSearch → ContextBuilder → Planner`).

## Estado atual (fatia)

| Namespace | Tools | Status |
|-----------|-------|--------|
| `git/` | `git_status`, `git_current_branch`, `git_log`, `git_diff`, `git_branch_list`, `git_show_file`, `git_blame` | ✅ implementado (leitura) |
| `sys/` | `runBinary`, `detectBinary` (primitivas, não são tools de Planner) | ✅ implementado |

Departamentos seguintes (`dev/`, `build/`, `qa/`, `security/`, ...) seguem o
mesmo padrão desta fatia; ver `TOOLS.md` na raiz para o roadmap.

## O padrão (como escrever uma tool)

Toda tool nasce de `defineZodTool` — a ponte **Zod → Tool ABI**:

```ts
export const minhaToolExemplo = defineZodTool({
  name: 'ns_acao',                       // snake_case, prefixo do namespace
  description: 'O que faz, em uma linha.',// vista pelo Planner
  input: z.object({ /* ... */ }).strict(),// interface pública (Zod)
  output: z.object({ /* ... */ }),        // saída estruturada
  capabilities: [{ kind: 'proc.exec', scopeHint: 'git' }], // menor privilégio
  pure: false,                            // tools reais dependem de estado
  run: async (args, ctx) => { /* impl */ },
});
```

`defineZodTool` entrega de graça:

1. **`inputSchema`/`outputSchema` JSON Schema** derivados dos schemas Zod
   (enxutos: sem `$schema`/`definitions`, pois o Planner os serializa no prompt);
2. **validação de runtime** dos argumentos — args fora do schema viram um
   `ToolResult` de erro estruturado, nunca uma exceção crua;
3. **validação defensiva da saída** — output inválido é reportado como bug da
   tool.

## Modelo de segurança

- **Nenhuma tool importa `node:child_process`.** Toda execução de binário passa
  por `sys/exec.runBinary`, que delega ao **Sandbox Tier 3** (`@clover/sandbox`):
  argv como array (sem shell), fronteira de workspace canônica, gate de
  capability `proc.exec` (argv[0] na allowlist do token) e timeout + SIGKILL.
- **Menor privilégio.** A tool declara `capabilities`; o `CapabilityResolver`
  cunha um token que só concede o que foi declarado. O `git_status` só pode
  executar `git`, nada mais.
- **Injeção de opção.** O Sandbox só valida `argv[0]`. Por isso as tools git
  validam refs/pathspecs do usuário (`assertSafeRef` rejeita valores começando
  com `-`) e colocam todo pathspec após `--`.
- **Formatos à prova de máquina.** As tools nunca parseiam saída "humana" do
  git; usam `--porcelain=v2 -z`, `--pretty=format:...%x1f...`, `--name-status
  -z`, `--line-porcelain`, `--no-color`, `core.quotepath=false`.
- **Graceful degradation.** `detectBinary` reporta ausência/versão do binário
  sem quebrar o REPL. Saídas grandes marcam `truncated` (o Sandbox corta em
  `maxBuffer`).

## Limitações conhecidas / follow-ups

- **ResourceManager.** Nesta fatia a execução vai `tool → runBinary → Sandbox`.
  O `ResourceManager` (concorrência/timeout/orçamento) ainda não envelopa essa
  chamada — o Executor invoca `bridge.invoke` direto. Integrar o RM como
  envelope de toda execução de tool é follow-up (registrado no `PROGRESS.md`).
- **Git de escrita.** `commit`, `add`, `merge`, `rebase`, `cherry_pick`, `stash`
  e PR (`gh`) NÃO estão nesta fatia (que é de leitura). Entram em fatia seguinte,
  com o mesmo padrão + confirmação no modo `step`.

## Testes

```bash
pnpm --filter @clover/tools run test
```

- `test/git-parse.test.ts` — parsers puros (sem git, determinístico).
- `test/abi.test.ts` — validação de entrada/saída e emissão de schema.
- `test/git-tools.test.ts` — integração real contra um repositório git temporário
  (pulada se não houver `git` no PATH).
