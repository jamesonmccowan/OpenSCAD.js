import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.mjs', fullyParallel: true,
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  use: { baseURL: 'http://127.0.0.1:4189', headless: true, trace: 'retain-on-failure' },
  webServer: { command: 'python3 -m http.server 4189 --bind 127.0.0.1', cwd: fileURLToPath(new URL('../', import.meta.url)), url: 'http://127.0.0.1:4189', reuseExistingServer: !process.env.CI && !process.env.OPENSCAD_RELEASE_CHECK },
});