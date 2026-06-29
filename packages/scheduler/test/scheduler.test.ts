/**
 * Durable Scheduler — prova de resume incremental por checkpoint.
 *
 * 1) Mesmo processo: um nó falha; depois de "consertar" a condição, o resume
 *    re-executa SOMENTE o nó restante (o concluído não roda de novo).
 * 2) Crash recovery: um orquestrador totalmente novo, com APENAS o journal em
 *    disco, retoma a task até o fim — provando que o estado é recuperável sem
 *    nenhum objeto vivo.
 */

import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { PlanIR } from '@clover/contracts';
import { defineTool, type LocalTool } from '@clover/tool-abi';
import { createKernel } from '@clover/kernel';
import { EventStore } from '@clover/state';
import { DurableScheduler } from '@clover/scheduler';

// --- ferramentas instrumentadas -------------------------------------------

interface Counter {
  n: number;
}
interface Gate {
  open: boolean;
}

function countingEcho(counter: Counter): LocalTool {
  return defineTool(
    {
      name: 'echo',
      description: 'echo (conta chamadas)',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      capabilities: [],
      pure: true,
    },
    (args) => {
      counter.n++;
      return { success: true, output: { text: String(args.text ?? '') } };
    },
  );
}

function gatedTool(gate: Gate, counter: Counter): LocalTool {
  return defineTool(
    {
      name: 'gate',
      description: 'falha enquanto o gate estiver fechado',
      inputSchema: { type: 'object' },
      capabilities: [],
    },
    () => {
      counter.n++;
      if (!gate.open) return { success: false, output: null, error: 'gate fechado' };
      return { success: true, output: { text: 'ok' } };
    },
  );
}

function plan(): PlanIR {
  return {
    version: '1',
    goalId: 'g',
    nodes: [
      { kind: 'tool_call', id: 'n1', tool: 'echo', args: { text: 'hello' } },
      // depende de n1 (ref) → ordem garantida n1 antes de n2
      { kind: 'tool_call', id: 'n2', tool: 'gate', args: { x: { kind: 'ref', nodeId: 'n1', path: 'text' } } },
    ],
    edges: [],
    outputs: [{ kind: 'ref', nodeId: 'n2', path: 'text' }],
  };
}

const tmpFiles: string[] = [];
function tmpFile(): string {
  const f = join(tmpdir(), `clover-sched-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  tmpFiles.push(f);
  return f;
}
afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    try {
      rmSync(f, { force: true });
    } catch {
      /* ignore */
    }
  }
});

describe('durable scheduler: incremental resume', () => {
  it('re-executes only the remaining node on resume (same process)', async () => {
    const echoC: Counter = { n: 0 };
    const gateC: Counter = { n: 0 };
    const gate: Gate = { open: false };

    const kernel = createKernel([countingEcho(echoC), gatedTool(gate, gateC)]);
    const store = new EventStore();
    const scheduler = new DurableScheduler(kernel, store);

    const handle = await scheduler.submit(plan());
    expect(handle.result.status).toBe('failed');
    expect(echoC.n).toBe(1);
    expect(gateC.n).toBe(1);

    // Conserta a condição e retoma.
    gate.open = true;
    const resumed = await scheduler.resume(handle.taskId);

    expect(resumed.status).toBe('done');
    expect(resumed.outputs).toEqual(['ok']);
    expect(echoC.n).toBe(1); // n1 NÃO re-executado (pulado via journal)
    expect(gateC.n).toBe(2); // só o nó restante rodou de novo
  });

  it('recovers from a fresh orchestrator using only the on-disk journal', async () => {
    const file = tmpFile();

    // Instância A: roda e falha; o journal vai para o disco.
    const echoA: Counter = { n: 0 };
    const gateAC: Counter = { n: 0 };
    const handleTaskId = await (async () => {
      const kA = createKernel([countingEcho(echoA), gatedTool({ open: false }, gateAC)]);
      const sA = new DurableScheduler(kA, new EventStore({ filePath: file }));
      const h = await sA.submit(plan());
      expect(h.result.status).toBe('failed');
      expect(echoA.n).toBe(1);
      return h.taskId;
    })();

    // "Restart": tudo novo; só o journal em disco sobrevive; gate agora aberto.
    const echoB: Counter = { n: 0 };
    const gateBC: Counter = { n: 0 };
    const kB = createKernel([countingEcho(echoB), gatedTool({ open: true }, gateBC)]);
    const storeB = new EventStore({ filePath: file }); // recarrega o journal do disco
    const sB = new DurableScheduler(kB, storeB);

    const result = await sB.resume(handleTaskId);

    expect(result.status).toBe('done');
    expect(result.outputs).toEqual(['ok']);
    expect(echoB.n).toBe(0); // echo NUNCA rodou em B — saída veio do journal
    expect(gateBC.n).toBe(1); // apenas o nó restante executou
  });

  it('throws when resuming an unknown task', async () => {
    const kernel = createKernel([countingEcho({ n: 0 }), gatedTool({ open: true }, { n: 0 })]);
    const scheduler = new DurableScheduler(kernel, new EventStore());
    await expect(scheduler.resume('does-not-exist')).rejects.toThrow(/não encontrado/);
  });
});
