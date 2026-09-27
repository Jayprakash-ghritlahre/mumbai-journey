// Renders docs/route-map.png: OpenStreetMap data (© OpenStreetMap contributors, ODbL)
// around Churchgate → Marine Drive with the walking route and footage frame positions.
// Usage: node tools/route-map.mjs   (needs Google Chrome for SVG → PNG)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const geo = JSON.parse(readFileSync(new URL('../public/data/south-mumbai.geo.json', import.meta.url), 'utf8'));
const BEARING = 351;
const K = Math.PI / 180;
// Local frame → true-north frame (x east, y south) so the map has north up.
const cb = Math.cos(BEARING * K);
const sb = Math.sin(BEARING * K);
const toMap = (x, z) => [x * cb - z * sb, x * sb + z * cb];

const W = 1800;
const H = 1100;
const view = { x0: -520, x1: 40, y0: -190, y1: 185 };
const S = Math.min(W / (view.x1 - view.x0), H / (view.y1 - view.y0));
const P = (x, z) => {
  const [e, s] = toMap(x, z);
  return [((e - view.x0) * S).toFixed(1), ((s - view.y0) * S).toFixed(1)];
};
const path = (p, close) => {
  let d = '';
  for (let i = 0; i < p.length; i += 2) d += (i ? 'L' : 'M') + P(p[i], p[i + 1]).join(',');
  return d + (close ? 'Z' : '');
};

let body = '';
for (const a of geo.areas) {
  const fill = a.k === 'platform' ? '#e9d8a6' : a.k === 'stadium' || a.k === 'pitch' ? '#cfe3b5' : a.k === 'water' ? '#9cc7e4' : ['park', 'garden', 'grass', 'recreation_ground'].includes(a.k) ? '#d4e7c5' : a.k === 'pedestrian' ? '#e8e3da' : 'none';
  if (fill !== 'none') body += `<path d="${path(a.p, true)}" fill="${fill}" stroke="#b9b3a6" stroke-width="0.6"/>`;
}
for (const r of geo.roads) {
  const foot = ['footway', 'pedestrian', 'path', 'steps'].includes(r.k);
  const w = foot ? 1.2 : Math.max(2, r.w * S * 0.95);
  const col = foot ? '#b8a9d6' : r.k === 'primary' ? '#f2b27a' : r.k === 'secondary' ? '#f6cf8f' : '#ffffff';
  body += `<path d="${path(r.p)}" fill="none" stroke="${foot ? col : '#9a948a'}" stroke-width="${foot ? w : w + 1.5}" stroke-linecap="round"/>`;
  if (!foot) body += `<path d="${path(r.p)}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`;
}
for (const b of geo.buildings) body += `<path d="${path(b.fp, true)}" fill="${b.t === 'train_station' ? '#d8b4b4' : '#d9d4cb'}" stroke="#8f887c" stroke-width="0.7"/>`;
for (const r of geo.rails) if (r.k === 'rail') body += `<path d="${path(r.p)}" fill="none" stroke="#555" stroke-width="1.4" stroke-dasharray="6,3"/>`;

// Sea: fill west of the coastline to the map edge, then draw the shoreline.
{
  const pts = [];
  for (const c of geo.coast) for (let i = 0; i < c.p.length; i += 2) pts.push([c.p[i], c.p[i + 1]]);
  const near = pts.filter(([x, z]) => z > -700 && z < 700 && x < -250 && x > -900).sort((a, b) => a[1] - b[1]);
  if (near.length > 1) {
    let d = near.map(([x, z], i) => (i ? 'L' : 'M') + P(x, z).join(',')).join('');
    d += `L${P(-2000, near[near.length - 1][1]).join(',')}L${P(-2000, near[0][1]).join(',')}Z`;
    body = `<path d="${d}" fill="#bcd9ef"/>` + body;
  }
  for (const c of geo.coast) body += `<path d="${path(c.p)}" fill="none" stroke="#5b9bd5" stroke-width="3"/>`;
}

// Labels for named buildings near the route.
const labels = [];
const cen = (fp) => {
  let x = 0;
  let z = 0;
  const n = fp.length / 2;
  for (let i = 0; i < n; i++) {
    x += fp[i * 2];
    z += fp[i * 2 + 1];
  }
  return [x / n, z / n];
};
const show = /Churchgate railway|IMC|Parekh|Nagin|Raj Mahal|Chateau|Ambassador|Manek|Sunder|Soona|Stadium House|Express Building|Resham|InterContinental|Western Railways/;
for (const b of geo.buildings) {
  if (!b.n || !show.test(b.n)) continue;
  const [x, z] = cen(b.fp);
  const [px, py] = P(x, z);
  labels.push(`<text x="${px}" y="${py}" font-size="12" text-anchor="middle" fill="#3b3630" font-family="sans-serif">${b.n.replace('Chamber of Commerce and Industry', 'building').replace(/&/g, '&amp;')}</text>`);
}

// Walking route (local coordinates, see CHURCHGATE_TO_MARINE_DRIVE.md).
const route = [-20, 5.5, -27, 5.6, -29.5, 20, -29, 60, -32, 84, -41, 93, -52, 92, -74, 86, -112, 77, -153, 63, -191, 50, -228, 39, -268, 28, -305, 16, -344, 3, -372, -7, -380, -11, -395, -16, -410, -20, -419, -23];
body += `<path d="${path(route)}" fill="none" stroke="#e8590c" stroke-width="5" stroke-linejoin="round" stroke-opacity="0.9"/>`;
const frames = [
  ['01', -25, 5.5], ['02', -29, 35], ['03', -45, 94], ['04–06', -60, 90], ['07–09', -74, 86], ['10–12', -103, 80],
  ['13–14', -135, 68], ['15–16', -163, 58], ['17–18', -200, 47], ['19', -232, 38], ['20', -290, 21], ['21–22', -322, 10],
  ['23,25,26', -377, -8], ['24,27', -396, -16], ['28–29', -413, -21], ['30–31', -419, -25],
];
for (const [n, x, z] of frames) {
  const [px, py] = P(x, z);
  body += `<circle cx="${px}" cy="${py}" r="7" fill="#fff" stroke="#e8590c" stroke-width="2.5"/>`;
  labels.push(`<text x="${+px + 10}" y="${+py - 8}" font-size="15" font-weight="700" fill="#b8420a" font-family="sans-serif">#${n}</text>`);
}
const mark = (x, z, t, dy = 0) => {
  const [px, py] = P(x, z);
  labels.push(`<text x="${px}" y="${+py + dy}" font-size="15" font-weight="700" fill="#1d4f9c" font-family="sans-serif" text-anchor="middle">${t}</text>`);
};
mark(-200, 80, 'VEER NARIMAN ROAD');
mark(-500, -40, 'ARABIAN SEA', 0);
mark(-395, -150, 'MARINE DRIVE');
mark(-40, 150, 'Eros', 0);
mark(-260, 150, 'Brabourne Stadium (CCI)');

const legend = `<g font-family="sans-serif" font-size="14" fill="#333">
  <rect x="16" y="${H - 116}" width="430" height="100" fill="#fff" fill-opacity="0.9" stroke="#bbb"/>
  <line x1="30" y1="${H - 94}" x2="70" y2="${H - 94}" stroke="#e8590c" stroke-width="5"/><text x="80" y="${H - 89}">Walking route (~500 m, ~6–7 min)</text>
  <circle cx="50" cy="${H - 66}" r="7" fill="#fff" stroke="#e8590c" stroke-width="2.5"/><text x="80" y="${H - 61}">Footage frame position (approximate)</text>
  <text x="30" y="${H - 32}" font-size="12" fill="#666">Map data © OpenStreetMap contributors (ODbL). North is up.</text>
</g>`;
const north = `<g transform="translate(${W - 60},60)"><polygon points="0,-30 10,5 0,-2 -10,5" fill="#333"/><text x="0" y="24" text-anchor="middle" font-family="sans-serif" font-size="16" font-weight="700">N</text></g>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#f3f0ea">
<rect width="${W}" height="${H}" fill="#f3f0ea"/>${body}${labels.join('')}${legend}${north}</svg>`;

mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
const tmp = join(tmpdir(), 'route-map.html');
writeFileSync(tmp, `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;overflow:hidden">${svg}</body></html>`);
const out = new URL('../docs/route-map.png', import.meta.url).pathname;
execFileSync('google-chrome', ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--screenshot=${out}`, `--window-size=${W},${H + 200}`, `file://${tmp}`], { stdio: 'ignore' });
execFileSync('python3', ['-c', `from PIL import Image; im = Image.open('${out}'); im.crop((0, 0, ${W}, ${H})).save('${out}')`]);
console.log('wrote', out);
