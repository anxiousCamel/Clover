# ADR 004: Intermediate Representation (IR) vs. Geração Direta de Código

- **Status:** Aceito (proposta CloverOS)
- **Data:** 2026-06-28
- **Relacionado:** [RAP §6](../architecture/cloveros-rap.md)

## Contexto

O ponto de maior dor do Clover com modelos pequenos (~8B) é o **tool calling em JSON
livre**: loops de erro de formatação, recusas e alucinação de resultados
(`agent-engine.ts`, parsing gRPC e "JSON-in-content" do Ollama). Duas arquiteturas
estavam em disputa para como o LLM expressa ações:

- **Opção A:** `LLM → gera TypeScript → executor`.
- **Opção B:** `LLM → Intermediate Representation → Validator → Optimizer → Execution Engine`.

## Decisão

Adotar a **Opção B** e **descartar a Opção A**. O modelo **autora uma IR tipada e
declarativa** (um DAG de invocações de tool + bindings + controle limitado), **nunca**
código executável.

Além disso — e mais importante que a IR em si — adotar **constrained decoding
(gramática GBNF / structured outputs)**: o decoder do modelo é restrito pela gramática
da IR, token a token, de modo que um 8B **não consegue** emitir estrutura inválida.
Essa é a correção de causa-raiz do problema de formatação.

A IR é **declarativa e não Turing-completa** (sem loops/recursão arbitrários),
garantindo que possa ser validada, otimizada e cacheada.

## Comparação

| Critério | A: LLM→TS | B: LLM→IR |
|---|---|---|
| **Previsibilidade** | Baixa (espaço infinito, efeitos arbitrários) | **Alta** (gramática fechada) |
| **Cacheabilidade** | Baixa (texto não-canônico) | **Alta** (IR canonicalizável, content-addressable) |
| **Otimização** | Difícil (analisar TS arbitrário) | **Alta** (CSE, dead-node elimination, paralelização) |
| **Testabilidade** | Difícil (testar geração de código) | **Alta** (IR é dado: golden/property/fuzz) |
| **Manutenção/Segurança** | Perigosa (`eval` de código do modelo) | **Alta** (só IR validada é executada) |

## Por que isso supera a hipótese "gerar scripts" (Programmatic Tool Calling)

A hipótese original de gerar scripts buscava expressividade. A IR entrega a **mesma
expressividade de orquestração** (fan-out, condicionais, sub-planos, bindings) sem o
risco de executar código autorado por modelo. A IR **compila para** um plano executável
em sandbox (RAP §5.2). Ganha-se "programmatic" sem `eval`.

O risco de "apenas trocar o inferno do JSON pelo inferno da IR" é eliminado por:
1. **Constrained decoding** (o modelo não consegue produzir IR malformada);
2. **IR pequena e declarativa** (menos formas de errar do que JSON livre).

## Alternativas Consideradas

- **Manter JSON tool-calling + prompt engineering:** insuficiente — é exatamente o que
  falha hoje; não ataca a causa-raiz.
- **Fine-tuning do modelo para JSON:** custo alto, frágil entre modelos, e o ADR-002
  já o descartou por rodar localmente.
- **Gramática sobre JSON tool-calls (sem IR):** melhora a formatação, mas perde
  otimização/paralelização/cache que a IR como DAG habilita.

## Consequências

- **Prós:** elimina a dor central (P1); habilita cache, otimização e durabilidade
  (checkpoints por nó); execução testável e auditável.
- **Contras:** custo de projetar/manter a gramática e o `Validator`/`Optimizer`;
  depende de o provider de LLM suportar constrained decoding (Ollama/llama.cpp via
  GBNF; APIs com structured outputs).
- **Mitigação:** IR versionada (`version: '1'`) e pequena; fuzzing do validator para
  garantir que IR inválida nunca passa; fallback para modelos sem grammar = validar e
  re-pedir (degradação graciosa), nunca executar IR inválida.
