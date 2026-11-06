// Recreate README screenshots from the real browser-only demo and synthetic data.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(path.join(root, 'e2e/package.json'));
const { chromium } = require('@playwright/test');
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5174', '--strictPort'], {
  cwd: path.join(root, 'frontend'),
  env: { ...process.env, VITE_DEMO: 'true', VITE_BASE_PATH: '/' },
  stdio: 'pipe',
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { ready = (await fetch('http://127.0.0.1:5174')).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error('Demo server did not start.');
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:5174');
  await page.getByRole('button', { name: 'Import meeting', exact: true }).waitFor();
  await page.getByRole('article').first().waitFor();
  const directory = path.join(root, 'docs/screenshots');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, 'overview.png'), fullPage: true });
  await page.getByRole('link', { name: /^Meeting inbox/ }).click();
  await page.getByRole('form').first().waitFor();
  await page.screenshot({ path: path.join(directory, 'review.png'), fullPage: true });
  console.log('Captured real demo screenshots under docs/screenshots/.');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
