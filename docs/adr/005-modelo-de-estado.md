# ADR 005: Modelo de Estado (Event Sourcing + Snapshots + Projeções)

- **Status:** Aceito (proposta CloverOS)
- **Data:** 2026-06-28
- **Relacionado:** [RAP §5.3, §15](../architecture/cloveros-rap.md)

## Contexto

O estado atual usa `sql.js` (SQLite em WASM) que **exporta o banco inteiro a disco a
cada write** (`storage/sqlite.store.ts`). Isso é O(n) por evento, não escala para
"milhares de tarefas" e arrisca corrupção. Estado operacional importante (pipeline
context) é **volátil** (perdido em restart), e a orquestração é fire-and-forget — um
crash perde tasks em voo. A visão de CloverOS exige **replay, time-travel,
checkpoints, recovery e tarefas duráveis de horas/dias**.

## Decisão

Adotar **um único modelo híbrido**: **Event Sourcing (journal append-only) +
Snapshots periódicos + projeções materializadas em SQLite nativo**
(`better-sqlite3`/libSQL, **substituindo `sql.js`**).

- **Event Journal (append-only):** **fonte única da verdade**. Append O(1). Imutável.
  É também a trilha de auditoria.
- **Snapshots:** checkpoints periódicos do estado para recovery/resume rápido (evita
  replay do log inteiro).
- **Projeções (SQLite):** read-models materializados, **descartáveis** (reconstruíveis
  por replay), otimizados para query da UI/CLI.

```
Comando → Aggregate (decide) → append(Event) no Journal
                                   ├→ Projectors → SQLite (read-model)
                                   └→ Snapshots (checkpoints)
Recovery: snapshot + replay(eventos > offset) → reconstrói projeções e retoma tasks
```

## Alternativas Consideradas

| Abordagem | Por que NÃO (sozinha) |
|---|---|
| **KV store puro** | Sem histórico/auditoria; replay impossível |
| **SQLite só com estado atual** | Sem time-travel/recovery granular; é o modelo atual (e a causa de P2). Mantido **apenas como projeção** |
| **Event Sourcing sem snapshots** | Reconstrução custosa; recovery lento |
| **Snapshotting puro** | Perde granularidade entre snapshots; sem auditoria fina |
| **CRDT** | Resolve convergência multi-writer concorrente — que **não existe** num host local single-writer. Complexidade prematura; **adiado** para o cenário distribuído (RAP §19) |

## Consequências

- **Prós:** entrega de uma só vez **replay, auditoria, checkpoints, recovery e
  durabilidade** (resolve P2, P7, P10). Projeções podem evoluir sem migração destrutiva
  (basta reprojetar do journal).
- **Contras:** mais armazenamento (journal cresce); necessidade de política de
  retenção/compactação; projetar eventos como contratos versionados.
- **Riscos:** evolução de schema de eventos. **Mitigação:** eventos versionados +
  upcasters; snapshots para limitar custo de replay; testes baseados em replay
  garantem que projeções antigas continuam reconstrutíveis.

## Notas de implementação

- **Journal:** arquivo append-only por workspace (ou tabela append-only no SQLite com
  índice por `offset`/`taskId`), com fsync controlado.
- **Snapshots:** por task (estado do plano + offset do journal) e global periódico.
- **Projeções:** `sessions`, `messages`, `tasks`, `tool_executions`, `telemetry` (como
  hoje) tornam-se **derivadas** do journal, não a verdade.
- **Migração de `sql.js`:** trocar por driver nativo elimina o export-on-write; os
  dados atuais podem ser importados como um lote de eventos seed.
