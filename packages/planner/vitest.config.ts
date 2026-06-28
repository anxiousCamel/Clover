import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/** Resolve todos os @clover/* a partir do código-fonte (sem build). */
export default defineConfig({
  resolve: {
    alias: {
      '@clover/contracts': p('../contracts/src/index.ts'),
      '@clover/event-bus': p('../event-bus/src/index.ts'),
      '@clover/ir': p('../ir/src/index.ts'),
      '@clover/tool-abi': p('../tool-abi/src/index.ts'),
      '@clover/executor': p('../executor/src/index.ts'),
      '@clover/llm': p('../llm/src/index.ts'),
      '@clover/planner': p('./src/index.ts'),
      '@clover/kernel': p('../kernel/src/index.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
