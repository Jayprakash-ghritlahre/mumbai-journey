// Renders the running dev server in headless Chrome (real GPU) and saves screenshots.
// Usage:
//   node tools/screenshot.mjs --query "mode=explore&hud=0" --out shot.png
//   node tools/screenshot.mjs --shots shots.json --outdir dir
// A shots file is a JSON array of { name, cam:[x,y,z,yawDeg,pitchDeg], hour?, wait? }.
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]] : acc), []),
);
const base = args.base ?? 'http://127.0.0.1:5173/';
const width = Number(args.w ?? 1600);
const height = Number(args.h ?? 900);
const query = args.query ?? 'hud=0';

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=gl', `--window-size=${width},${height}`, '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width, height, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', async (m) => {
  let t = m.text();
  if (t.includes('JSHandle@')) t = (await Promise.all(m.args().map((a) => a.evaluate((v) => (v instanceof Error ? v.stack : String(v))).catch(() => '?')))).join(' ');
  if (!/Download the React DevTools|\[vite\]/.test(t)) logs.push(`[${m.type()}] ${t}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
const t0 = Date.now();
await page.goto(base + '?' + query, { waitUntil: 'domcontentloaded', timeout: 120000 });
try {
  await page.waitForFunction(() => window.__mj && window.__mj.ready(), { timeout: Number(args.timeout ?? 180000), polling: 250 });
} catch (e) {
  console.log('TIMEOUT waiting for ready');
  console.log(logs.join('\n'));
  console.log(await page.evaluate(() => document.querySelector('pre')?.textContent ?? ''));
  await page.screenshot({ path: args.out ?? 'timeout.png' });
  await browser.close();
  process.exit(1);
}
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const shots = args.shots ? JSON.parse(readFileSync(args.shots, 'utf8')) : [{ name: args.out ?? 'shot.png', wait: Number(args.wait ?? 1500) }];
const outdir = args.outdir ?? '.';
mkdirSync(outdir, { recursive: true });
for (const s of shots) {
  if (s.hour !== undefined) await page.evaluate((h) => window.__mj.setHour(h), s.hour);
  if (s.cam) await page.evaluate((c) => window.__mj.setCamera(...c), s.cam);
  if (s.eval) await page.evaluate(s.eval);
  await new Promise((r) => setTimeout(r, s.wait ?? 1200));
  const file = s.name.includes('/') ? s.name : join(outdir, s.name.endsWith('.png') ? s.name : s.name + '.png');
  await page.screenshot({ path: file });
  const stats = await page.evaluate(() => window.__mj.stats());
  const audio = await page.evaluate(() => (window.__mj.audio ? window.__mj.audio() : null));
  if (audio) console.log('audio', JSON.stringify(audio));
  if (args.profile) console.log('profile', JSON.stringify(await page.evaluate(() => window.__mj.profile())));
  console.log(`${file}  people=${stats.people} fps=${stats.fps.toFixed(1)} ms=${stats.frameMs.toFixed(1)} cpu=${stats.cpuUpdate?.toFixed(1)}+${stats.cpuRender?.toFixed(1)}ms draws=${stats.drawCalls} tris=${(stats.triangles / 1000).toFixed(0)}k pr=${stats.pixelRatio}`);
}
if (logs.length) console.log('--- console ---\n' + logs.slice(0, 60).join('\n'));
await browser.close();
