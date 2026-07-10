import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';

function initTheme(): void {
  const stored = window.localStorage.getItem('sherlock-dashboard-theme');
  const mode = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

initTheme();

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('#root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
