// Browser end-to-end tests (npm run test:e2e). Playwright starts the app on its own port with a fresh database
// in Development (so the 4 test users exist), then drives a real Chromium. Files: test/e2e/*.spec.ts
// (named .spec.ts so `npm test`, which runs *.test.ts with node:test, leaves them alone).

import { defineConfig } from '@playwright/test';

const port = 5181;

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '*.spec.ts',
  timeout: 30_000,
  use: { baseURL: `http://localhost:${port}`, browserName: 'chromium' },
  webServer: {
    // A throw-away database: deleted, migrated, then the server starts (and seeds the test users).
    command: 'node test/e2e/start-server.ts',
    url: `http://localhost:${port}/health`,
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1', DATABASE_PATH: 'data/e2e.db', LOG_LEVEL: 'warn', PUBLIC_URL: `http://localhost:${port}`,
      // A throw-away Owner account for the admin tests (this database is deleted before every run).
      ADMIN_USER_NAME: 'Szef', ADMIN_EMAIL: 'szef@example.com', ADMIN_PASSWORD: 'gracz',
    },
  },
});
