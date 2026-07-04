import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@clover/contracts': p('../contracts/src/index.ts'),
      '@clover/tool-abi': p('../tool-abi/src/index.ts'),
      '@clover/sandbox': p('../sandbox/src/index.ts'),
      '@clover/tools': p('./src/index.ts'),
      // Necessários para o teste e2e (Planner→Kernel→Sandbox) com token cunhado.
      '@clover/event-bus': p('../event-bus/src/index.ts'),
      '@clover/ir': p('../ir/src/index.ts'),
      '@clover/capability': p('../capability/src/index.ts'),
      '@clover/executor': p('../executor/src/index.ts'),
      '@clover/kernel': p('../kernel/src/index.ts'),
      '@clover/resource-manager': p('../resource-manager/src/index.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
