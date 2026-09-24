import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './scripts/test-env';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    env: { DATABASE_URL: testDatabaseUrl() },
    testTimeout: 20000,
    hookTimeout: 20000,
    // Integration tests hit a real Postgres (DATABASE_URL) — run serially
    // to avoid cross-test data races on shared tables.
    fileParallelism: false,
    // Avoid intermittent fork-worker IPC closure on Windows/Node 24.
    // Thread isolation remains enabled; DB test files still execute serially.
    pool: 'threads',
    maxWorkers: 1,
  },
});
