import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@clover/contracts': p('../../packages/contracts/src/index.ts'),
      '@clover/tui': p('../../packages/tui/src/index.ts'),
      '@clover/blackboard': p('../../packages/blackboard/src/index.ts'),
      '@clover/config': p('../../packages/config/src/index.ts'),
      '@clover/i18n': p('../../packages/i18n/src/index.ts'),
      '@clover/llm': p('../../packages/llm/src/index.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
