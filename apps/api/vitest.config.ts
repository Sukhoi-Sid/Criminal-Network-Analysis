import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 20000,
    hookTimeout: 20000,
    // Integration tests hit a real Postgres (DATABASE_URL) — run serially
    // to avoid cross-test data races on shared tables.
    fileParallelism: false,
  },
});
