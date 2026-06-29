import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@clover/contracts': p('../contracts/src/index.ts'),
      '@clover/capability': p('../capability/src/index.ts'),
      '@clover/event-bus': p('../event-bus/src/index.ts'),
      '@clover/ir': p('../ir/src/index.ts'),
      '@clover/tool-abi': p('../tool-abi/src/index.ts'),
      '@clover/executor': p('../executor/src/index.ts'),
      '@clover/kernel': p('../kernel/src/index.ts'),
      '@clover/state': p('../state/src/index.ts'),
      '@clover/scheduler': p('../scheduler/src/index.ts'),
      '@clover/llm': p('../llm/src/index.ts'),
      '@clover/planner': p('../planner/src/index.ts'),
      '@clover/context-builder': p('../context-builder/src/index.ts'),
      '@clover/tool-search': p('../tool-search/src/index.ts'),
      '@clover/resource-manager': p('../resource-manager/src/index.ts'),
      '@clover/agent-runtime': p('../agent-runtime/src/index.ts'),
      '@clover/ast-index': p('../ast-index/src/index.ts'),
      '@clover/knowledge-graph': p('../knowledge-graph/src/index.ts'),
      '@clover/knowledge-retriever': p('../knowledge-retriever/src/index.ts'),
      '@clover/agent': p('./src/index.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
