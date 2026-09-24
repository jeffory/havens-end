import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5173 },
  build: {
    // three.js alone is ~550 kB minified (~140 kB gzipped); that is expected, not bloat.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        // Libraries in their own chunks: they change far less often than the game, so they stay cached.
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
  test: { include: ['src/**/*.test.ts'] },
});
