import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/noto-sans/400.css';
import '@fontsource/noto-sans/700.css';
import '@fontsource/noto-sans-devanagari/400.css';
import '@fontsource/noto-sans-devanagari/700.css';
import './ui/style.css';
import { App } from './app/App';

const container = document.getElementById('app')!;
const app = new App(container);
app.start().catch((err) => {
  console.error(err);
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;inset:20px;color:#f88;white-space:pre-wrap;font:12px monospace;z-index:99';
  pre.textContent = String(err?.stack ?? err);
  document.body.appendChild(pre);
});
