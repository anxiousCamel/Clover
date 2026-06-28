/**
 * Demo runnable do walking skeleton: `pnpm --filter @clover/kernel demo`
 * (ou `tsx src/demo.ts`). Imprime a timeline de eventos e o resultado.
 */

import type { EventEnvelope, PlanIR } from '@clover/contracts';

import { createKernel } from './index.js';
import { demoTools } from './tools.js';

const plan: PlanIR = {
  version: '1',
  goalId: 'demo-goal',
  nodes: [
    { kind: 'tool_call', id: 'n1', tool: 'echo', args: { text: 'hello' } },
    {
      kind: 'tool_call',
      id: 'n2',
      tool: 'concat',
      args: { a: { kind: 'ref', nodeId: 'n1', path: 'text' }, b: ' world' },
    },
  ],
  edges: [],
  outputs: [{ kind: 'ref', nodeId: 'n2', path: 'text' }],
};

async function main(): Promise<void> {
  const kernel = createKernel(demoTools);

  kernel.events.subscribe('*', (e: EventEnvelope) => {
    // Timeline simples das decisões/execução (RAP §18).
    console.log(`[${new Date(e.ts).toISOString()}] ${e.source} :: ${e.topic}`);
  });

  const result = await kernel.submitPlan(plan);
  console.log('\n=== RESULTADO ===');
  console.log('status :', result.status);
  console.log('outputs:', JSON.stringify(result.outputs));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
