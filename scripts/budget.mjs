// Measures what a visitor downloads before interacting, from the built dist/ folder.
// First-load JS = the page's entry script and its static imports, plus the chunks the entry loads
// on idle without any interaction (reveal + GSAP, and the hero island). Islands that boot only when
// scrolled near, and the tracer's WebAssembly, are listed separately.
// Usage: npm run build && node scripts/budget.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dist = path.resolve('dist');
const gz = (buf) => zlib.gzipSync(buf, { level: 9 }).length;
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const read = (rel) => fs.readFileSync(path.join(dist, rel.replace(/^\//, '')));

function graph(start) {
  const seen = new Set();
  const dyn = new Set();
  const walk = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = read(rel).toString();
    const dir = path.posix.dirname(rel);
    for (const m of src.matchAll(/(?:import|export)\s*(?:[^'"()]*?from\s*)?["'](\.{1,2}\/[^"']+\.js)["']/g)) walk(path.posix.join(dir, m[1]));
    for (const m of src.matchAll(/import\(\s*["'`](\.{1,2}\/[^"'`]+\.js)["'`]\s*\)/g)) dyn.add(path.posix.join(dir, m[1]));
  };
  walk(start);
  return { files: seen, dynamic: dyn };
}

const pages = ['index.html', 'projects/linguaspy/index.html', 'projects/raytracer/index.html', 'projects/titaninfer/index.html'];
for (const page of pages) {
  const html = read(page).toString();
  const entry = html.match(/<script type="module" src="([^"]+)"/)?.[1]?.replace(/^\//, '');
  const css = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1].replace(/^\//, ''));
  const htmlGz = gz(Buffer.from(html));
  const cssGz = css.reduce((s, f) => s + gz(read(f)), 0);
  const first = new Set();
  const lazy = new Set();
  if (entry) {
    const g = graph(entry);
    g.files.forEach((f) => first.add(f));
    for (const d of g.dynamic) {
      const name = path.posix.basename(d);
      const idle = /^(reveal|hero)\./.test(name) && (name.startsWith('reveal') || html.includes('data-island="hero"'));
      const sub = graph(d);
      for (const f of sub.files) (idle ? first : lazy).add(f);
      if (idle) for (const dd of sub.dynamic) {
        const n = path.posix.basename(dd);
        const sub2 = graph(dd);
        // reveal -> gsap-kit -> gsap, ScrollTrigger, SplitText, CustomEase load together on idle
        const eager = /^(gsap|ScrollTrigger|SplitText|CustomEase)\./.test(n);
        for (const f of sub2.files) (eager ? first : lazy).add(f);
      }
    }
  }
  for (const f of first) lazy.delete(f);
  const firstGz = [...first].reduce((s, f) => s + gz(read(f)), 0);
  console.log(`\n${page}`);
  console.log(`  HTML ${kb(htmlGz)} gz, CSS ${kb(cssGz)} gz (${css.length} files)`);
  console.log(`  First-load JS ${kb(firstGz)} gz:`);
  for (const f of [...first].sort()) console.log(`    ${path.posix.basename(f).padEnd(56)} ${kb(gz(read(f)))}`);
  const lazyGz = [...lazy].reduce((s, f) => s + gz(read(f)), 0);
  console.log(`  Loaded later (scroll or interaction): ${kb(lazyGz)} gz across ${lazy.size} chunks`);
}

const assets = fs.readdirSync(path.join(dist, '_astro'));
const wasm = assets.find((f) => f.endsWith('.wasm'));
if (wasm) console.log(`\nTracer wasm (lazy, desktop idle or tap): ${kb(gz(read('_astro/' + wasm)))} gz`);
const fonts = assets.filter((f) => f.endsWith('.woff2') && /latin-(opsz|wght)/.test(f) && !f.includes('-ext-'));
console.log(`Fonts used by Latin text: ${fonts.map((f) => f.split('.')[0] + ' ' + kb(fs.statSync(path.join(dist, '_astro', f)).size)).join(', ')}`);
const hero = assets.filter((f) => f.startsWith('hero_materials') && f.endsWith('.avif'));
console.log(`Hero AVIF (LCP) sizes: ${hero.map((f) => kb(fs.statSync(path.join(dist, '_astro', f)).size)).join(', ')}`);
