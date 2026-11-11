// npm run perf -- [--q high] [--shot wide] [--zombies 24] [--frames 300] [--size 1920x1080] [--runs 3] [--uncapped]
//   [--device phone|tablet] [--dpr n] [--throttle <cpu slowdown, e.g. 4>]
// --device runs under mobile emulation (touch, DPR, mobile UA); pass touch=1 and q=mobile yourself.
// --throttle slows the CPU through CDP (4 is roughly a mid-range phone against this laptop; the GPU is not slowed).
// Each run ends with a table of draw calls and triangles by pass for the last frame (window.__passStats()).
// Frame rate on a staged shot with a crowd alive, rain on and the camera moving (a slow dolly and
// pan around the shot's own camera). Reports __stats().fps sampled every 60 frames, and the frame
// intervals seen by requestAnimationFrame. --uncapped lifts the display's 60 Hz cap (headroom).
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { pageUrl, watchPage, contextOptions } from './lib.mjs';

const { values: a } = parseArgs({
  options: {
    q: { type: 'string', default: 'high' }, shot: { type: 'string', default: 'wide' }, zombies: { type: 'string', default: '24' },
    frames: { type: 'string', default: '300' }, size: { type: 'string' }, device: { type: 'string' }, dpr: { type: 'string' }, throttle: { type: 'string' }, runs: { type: 'string', default: '3' },
    uncapped: { type: 'boolean', default: false }, params: { type: 'string', default: '' },
  },
});
const args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'];
if (a.uncapped) args.push('--disable-frame-rate-limit', '--disable-gpu-vsync');
let code = 0;
for (let run = 1; run <= Number(a.runs); run++) {
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args });
  try {
    const page = await browser.newPage(contextOptions({ device: a.device, size: a.size, dpr: a.dpr, version: browser.version() }));
    if (a.throttle) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: Number(a.throttle) });
    const extra = watchPage(page);
    await page.goto(pageUrl(`shot=${a.shot}&spawn=${a.zombies}&q=${a.q}&god=1${a.params ? `&${a.params}` : ''}`));
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    await page.waitForTimeout(3000); // shaders linked, lights settled, eye adapted
    const r = await page.evaluate((frames) => new Promise((resolve) => {
      const G = window.__G;
      const base = G.shotCam.cam.slice();
      const fps = []; const dts = []; const alive = []; const calls = [];
      let n = 0; let last = performance.now();
      const tick = (now) => {
        const k = n / 60;
        // dolly 3 m side to side and 1.5 m in and out, pan +-12 degrees
        const yaw = base[3] + 0.21 * Math.sin(k * 1.3);
        const sx = Math.cos(base[3]), sz = -Math.sin(base[3]);
        const fx = -Math.sin(base[3]), fz = -Math.cos(base[3]);
        const side = 1.5 * Math.sin(k * 0.9), fwd = 0.75 * Math.sin(k * 0.6);
        window.__setShot({ cam: [base[0] + sx * side + fx * fwd, base[1], base[2] + sz * side + fz * fwd, yaw, base[4]] });
        if (n > 0) dts.push(now - last);
        last = now;
        if (n > 0 && n % 60 === 0) { const s = window.__stats(); fps.push(s.fps); alive.push(s.alive); calls.push(s.drawCalls); }
        if (++n <= frames) requestAnimationFrame(tick);
        else {
          dts.sort((p, q) => p - q);
          const mean = dts.reduce((s, v) => s + v, 0) / dts.length;
          const s = window.__stats();
          resolve({
            fps, meanFps: +(1000 / mean).toFixed(1), meanMs: +mean.toFixed(2), p95Ms: +dts[Math.floor(dts.length * 0.95)].toFixed(2), maxMs: +dts[dts.length - 1].toFixed(2),
            alive, drawCalls: calls, triangles: s.triangles, cpuFrameMs: s.frameMs, tier: G.quality.tier || G.quality.name || G.quality.preset, errors: (window.__errors || []).length,
            size: [G.renderer.domElement.width, G.renderer.domElement.height],
          });
        }
      };
      requestAnimationFrame(tick);
    }), Number(a.frames));
    // the same dolly with no display refresh between frames: what a frame really costs (CPU + GPU)
    r.bench = await page.evaluate((frames) => {
      const base = window.__G.shotCam.cam.slice();
      return window.__bench(frames, (n) => {
        const k = n / 60;
        const sx = Math.cos(base[3]), sz = -Math.sin(base[3]), fx = -Math.sin(base[3]), fz = -Math.cos(base[3]);
        const side = 1.5 * Math.sin(k * 0.9), fwd = 0.75 * Math.sin(k * 0.6);
        window.__setShot({ cam: [base[0] + sx * side + fx * fwd, base[1], base[2] + sz * side + fz * fwd, base[3] + 0.21 * Math.sin(k * 1.3), base[4]] });
      });
    }, Number(a.frames));
    console.log(`[perf] run ${run} q=${a.q}${a.uncapped ? ' uncapped' : ''} ${JSON.stringify(r)}`);
    const passes = await page.evaluate(() => window.__passStats());
    console.log(`[perf] passes (last frame)\n${['pass'.padEnd(14) + 'calls'.padStart(7) + 'triangles'.padStart(12), ...passes.map((p) => p.pass.padEnd(14) + String(p.calls).padStart(7) + String(p.triangles).padStart(12))].map((l) => `  ${l}`).join('\n')}`);
    if (r.errors || extra.length) { console.log(`[perf] errors: ${extra.join(' | ')}`); code = 1; }
  } finally { await browser.close(); }
}
process.exit(code);
