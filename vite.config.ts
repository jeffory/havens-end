import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5173 },
  // three.js alone is ~550 kB minified (~140 kB gzipped); that is expected, not bloat.
  build: { chunkSizeWarningLimit: 800 },
  test: { include: ['src/**/*.test.ts'] },
});
