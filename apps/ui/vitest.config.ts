import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
    environment: 'node',
    environmentMatchGlobs: [
      ['**/components/**/*.test.tsx', 'jsdom'],
    ],
  },
});
