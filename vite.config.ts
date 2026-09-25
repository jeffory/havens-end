import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

/** The commit being built: from git, or from Cloudflare's build environment. Empty if neither says. */
function commit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return process.env.WORKERS_CI_COMMIT_SHA?.slice(0, 7) ?? '';
  }
}

export default defineConfig({
  server: { port: 5173 },
  // When and from what the game was built, shown in the corner (ui/buildStamp.ts).
  define: { __BUILD__: JSON.stringify({ time: new Date().toISOString(), commit: commit() }) },
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
  test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] },
});
