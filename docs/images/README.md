# Sherlock screenshots

Product screenshots for the README and portfolio.

| File | Description |
|------|-------------|
| `landing-page.png` | Marketing landing page |
| `dashboard.png` | Reviewer dashboard overview |
| `reviewer-workspace.png` | Session workspace with panels |
| `aggregate-dashboard.png` | Aggregate analytics charts |
| `dark-mode.png` | Dashboard in dark theme |
| `architecture.png` | System architecture (from Mermaid export) |
| `deployment.png` | Railway deployment diagram |

## Regenerate with Playwright

From the repository root:

```bash
cd dashboard
npm run build
npx playwright install chromium
npm run screenshots
npm run screenshots:diagrams
```

The script starts `vite preview`, captures each view, and writes PNGs to `docs/images/`.

## Manual capture

If Playwright is unavailable:

1. `npm run dev --workspace=@sherlock/dashboard`
2. Open `http://localhost:5173`
3. Capture landing page, launch dashboard, toggle dark mode, and aggregate section
4. Save files using the names above into `docs/images/`

## Placeholders

Placeholder images are committed when Playwright cannot run in CI. Replace them
after a local capture for portfolio-quality README visuals.
