// Shared setup for the headless browser tests: serve the built site, open the
// game with ?debug (which exposes window.__game), and wait for a city to load.
//
//   npx vite build && node tools/tests/robot.mjs
//
// The pre-installed Chromium renders with SwiftShader, which is slow, so tests
// step the simulation directly instead of waiting for real frames.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// Playwright is installed globally on the test machine (require() finds it, import doesn't).
const { chromium } = createRequire(import.meta.url)('playwright');

const PORT = Number(process.env.PORT || 4173);
export const BASE = `http://127.0.0.1:${PORT}/`;

async function up() {
  try {
    return (await fetch(BASE)).ok;
  } catch {
    return false;
  }
}

/** Start `vite preview` unless something already serves the site. */
export async function serve() {
  if (await up()) return () => {};
  const p = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
  return () => {
    try {
      process.kill(-p.pid);
    } catch {}
  };
}

export async function launch(viewport = { width: 1100, height: 700 }) {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  return { browser, page };
}

/**
 * Open the PSG1 build (dist-psg1/, from `npm run build:psg1`) the way the PSG1
 * app does: served from https://appassets.androidplatform.net/ with every other
 * address blocked, as on a device with no internet.
 */
export async function openApp(page, query = '', { online = false } = {}) {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist-psg1');
  const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', jpg: 'image/jpeg', png: 'image/png' };
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.host !== 'appassets.androidplatform.net') return online ? route.continue() : route.abort('internetdisconnected');
    try {
      const body = await readFile(path.join(root, decodeURIComponent(u.pathname)));
      await route.fulfill({ status: 200, body, contentType: types[u.pathname.split('.').pop()] || 'application/octet-stream' });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  if (!online) await page.context().setOffline(true); // navigator.onLine = false (the routes above still serve the app's files)
  await page.goto(`https://appassets.androidplatform.net/index.html?debug&${query}`);
  await page.waitForFunction(() => window.__game?.world?.colliders && document.getElementById('loading').hidden, null, { timeout: 180000 });
  await page.waitForTimeout(500);
}

/** Open the game in a city and wait until its map is built. */
export async function openGame(page, query = '') {
  await page.goto(`${BASE}?debug&${query}`);
  await page.waitForFunction(() => window.__game?.world?.colliders && document.getElementById('loading').hidden, null, { timeout: 180000 });
  await page.waitForTimeout(500);
}

let failures = 0;
export function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}
export const failed = () => failures;
