// demo 页验收：起本地静态服务器 -> 真浏览器加载 -> 断言库 API 在浏览器里跑通。
// 这是「浏览器路径」（CompressionStream 编码器 + 原生 ESM）的端到端检查。
//
//   node tools/verify-demo.mjs
//
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { serve } from './serve-demo.mjs';

// 注意：必须用异步 spawn，不能用 spawnSync。
// 静态服务器跑在本进程里，spawnSync 会把事件循环整个堵住，浏览器来取页面时服务器无法响应 → 死锁。
function runBrowser(browser, args) {
  return new Promise((ok) => {
    const child = spawn(browser, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill(), 180000);
    child.on('close', () => { clearTimeout(timer); ok(out); });
    child.on('error', () => { clearTimeout(timer); ok(''); });
  });
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'out/demo-verify');
mkdirSync(OUT, { recursive: true });

const CANDIDATES = [
  process.env.DSH_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const browser = CANDIDATES.find((c) => existsSync(c));
if (!browser) {
  console.error('找不到浏览器；设置 DSH_BROWSER 指向 chrome/msedge。CI 里可跳过本脚本（逻辑层由 npm test 覆盖）。');
  process.exit(0); // 不阻塞：逻辑正确性由 node --test 保证
}

const { server, port } = await serve(0);
const url = `http://127.0.0.1:${port}/examples/demo.html`;
const scratch = join(tmpdir(), 'hypsa-isopleth-browser');
mkdirSync(scratch, { recursive: true });
const common = [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', `--user-data-dir=${scratch}`,
  '--window-size=1440,1000', '--virtual-time-budget=30000',
];

const dom = await runBrowser(browser, [...common, '--dump-dom', url]);
const html = dom || '';
const attr = (n) => {
  const m = html.match(new RegExp(`data-${n}="([^"]*)"`));
  return m ? m[1] : null;
};

const png = join(OUT, 'demo.png');
await runBrowser(browser, [...common, `--screenshot=${png}`, url]);
server.close();

const report = {
  browser: browser.split(/[\\/]/).pop(),
  url,
  ready: attr('ready'),
  error: attr('error'),
  seed: attr('seed'),
  style: attr('style'),
  generateMs: attr('ms'),
  svgBytes: attr('bytes'),
  backgroundSet: attr('background-set'),
  screenshot: existsSync(png) ? png : null,
};
report.pass = report.ready === '1' && !report.error && report.backgroundSet === '1' && Number(report.svgBytes) > 1000;

writeFileSync(join(OUT, 'verify-demo.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
