import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/** Resolve um caminho relativo a este pacote para um path absoluto. */
const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/**
 * Aliases para resolver os pacotes @clover/* diretamente do código-fonte
 * (sem precisar de build). Vitest/Vite resolvem .ts on-the-fly via esbuild.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@clover/contracts': p('../contracts/src/index.ts'),
      '@clover/event-bus': p('../event-bus/src/index.ts'),
      '@clover/ir': p('../ir/src/index.ts'),
      '@clover/tool-abi': p('../tool-abi/src/index.ts'),
      '@clover/executor': p('../executor/src/index.ts'),
      '@clover/kernel': p('./src/index.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
