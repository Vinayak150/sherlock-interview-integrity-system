import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(__dirname, '..');
const outputDir = path.resolve(dashboardRoot, '..', 'docs', 'images');
const baseUrl = 'http://127.0.0.1:4173';

async function waitForServer(url, attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server did not start at ${url}`);
}

const preview = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4173'], {
  cwd: dashboardRoot,
  stdio: 'inherit',
  shell: true,
});

try {
  await waitForServer(baseUrl);
  await mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(baseUrl);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outputDir, 'landing-page.png'), fullPage: true });

  await page.getByRole('button', { name: /launch dashboard/i }).first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outputDir, 'dashboard.png'), fullPage: true });

  await page.getByRole('button', { name: /reviewer workspace/i }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outputDir, 'reviewer-workspace.png'), fullPage: true });

  await page.getByRole('button', { name: /aggregate analytics/i }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outputDir, 'aggregate-dashboard.png'), fullPage: true });

  await page.getByRole('button', { name: /toggle theme/i }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outputDir, 'dark-mode.png'), fullPage: true });

  await browser.close();
  console.log(`Screenshots written to ${outputDir}`);
} finally {
  preview.kill('SIGTERM');
}
