// Runs a JS expression inside the running dev app (headless Chrome) and prints the JSON result.
// Usage: node tools/probe.mjs --query "mode=explore&hud=0" --file expr.js
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]] : acc), []),
);
const base = args.base ?? 'http://127.0.0.1:5173/';
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  protocolTimeout: 900000,
  args: ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=gl', '--window-size=960,540'],
  defaultViewport: { width: 960, height: 540, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(base + '?' + (args.query ?? 'mode=explore&hud=0'), { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__mj && window.__mj.ready(), { timeout: 180000, polling: 250 });
if (args.wait) await new Promise((r) => setTimeout(r, Number(args.wait)));
const src = readFileSync(args.file, 'utf8');
const out = await page.evaluate(`(async () => { ${src} })()`);
console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
if (args.logs) console.log(logs.slice(0, 40).join('\n'));
await browser.close();
