import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: '../.venv/bin/python ../backend/manage.py migrate --noinput && ../.venv/bin/python ../backend/manage.py runserver 127.0.0.1:8000 --noreload',
      url: 'http://127.0.0.1:8000/api/health/',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { DJANGO_DEBUG: 'true' },
    },
    {
      command: 'npm --prefix ../frontend run dev -- --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
