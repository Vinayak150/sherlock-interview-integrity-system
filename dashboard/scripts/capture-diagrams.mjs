import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outputDir = path.join(repoRoot, 'docs', 'images');

const DIAGRAMS = [
  {
    file: 'architecture.png',
    title: 'System Architecture',
    mermaid: await readFile(path.join(repoRoot, 'docs', 'architecture-diagram-overall.md'), 'utf8').then(
      (content) => content.match(/```mermaid\n([\s\S]*?)```/)?.[1] ?? 'flowchart LR\n  A[Orchestrator] --> B[Dashboard]',
    ),
  },
  {
    file: 'deployment.png',
    title: 'Deployment Architecture',
    mermaid: await readFile(path.join(repoRoot, 'docs', 'architecture-diagram-deployment.md'), 'utf8').then(
      (content) => content.match(/```mermaid\n([\s\S]*?)```/)?.[1] ?? 'flowchart TB\n  GH[GitHub] --> RD[Railway]',
    ),
  },
];

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

for (const diagram of DIAGRAMS) {
  await page.setContent(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
    <style>
      body { margin: 0; font-family: Inter, sans-serif; background: #fafafa; color: #111; }
      .wrap { padding: 32px; }
      h1 { font-size: 20px; margin: 0 0 20px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>${diagram.title}</h1>
      <pre class="mermaid">${diagram.mermaid}</pre>
    </div>
    <script>mermaid.initialize({ startOnLoad: true, theme: 'neutral' });</script>
  </body>
</html>`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outputDir, diagram.file), fullPage: true });
}

await browser.close();
console.log('Diagram screenshots written to docs/images');
