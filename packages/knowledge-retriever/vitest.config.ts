import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@clover/ast-index': p('../ast-index/src/index.ts'),
      '@clover/knowledge-graph': p('../knowledge-graph/src/index.ts'),
      '@clover/knowledge-retriever': p('./src/index.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
