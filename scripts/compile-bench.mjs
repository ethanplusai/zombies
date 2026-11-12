// Serves scripts/ on a local port, opens compile-bench.html in a browser and prints per-program timings.
import { chromium, firefox } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const which = opt('browser', 'chromium'); const name = opt('name', which); const args = (opt('args', '') || '').split(' ').filter(Boolean);
const dir = join(import.meta.dirname);
const srv = createServer((req, res) => { try { const f = req.url.split('?')[0].replace(/^\//, '') || 'compile-bench.html'; res.setHeader('content-type', f.endsWith('.json') ? 'application/json' : 'text/html'); res.end(readFileSync(join(dir, f))); } catch { res.statusCode = 404; res.end(); } });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/compile-bench.html`;
const browser = which === 'firefox' ? await firefox.launch({ headless: true }) : await chromium.launch({ channel: 'chromium', headless: true, args });
const page = await browser.newPage();
await page.goto(url);
const t0 = Date.now();
while (Date.now() - t0 < 45 * 60 * 1000) {
  const s = await Promise.race([page.evaluate(() => ({ done: !!window.__benchDone, n: window.__bench.programs.length })), new Promise((r) => setTimeout(() => r(null), 10000))]).catch(() => null);
  if (s && s.done) break;
  await new Promise((r) => setTimeout(r, 2000));
}
const bench = await Promise.race([page.evaluate(() => window.__bench), new Promise((r) => setTimeout(() => r({ hung: true }), 60000))]);
mkdirSync('probe-out', { recursive: true });
writeFileSync(`probe-out/compile-${name}.json`, JSON.stringify(bench, null, 1));
const ps = (bench.programs || []).slice().sort((a, b) => b.ms - a.ms);
console.log(name, bench.renderer, 'tier', bench.tier, 'programs', ps.length, 'total s', ((bench.total || 0) / 1000).toFixed(1), 'failed', ps.filter((p) => !p.ok).length, bench.error || '');
for (const p of ps.slice(0, 60)) console.log(`  ${p.ms} ms  ${p.chars} chars  ${p.name}  ${p.ok ? '' : 'FAILED ' + p.log.slice(0, 300)}`);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 10000))]); srv.close(); process.exit(0);
