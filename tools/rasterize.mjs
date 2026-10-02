// SVG -> PNG preview rasteriser via the locally installed Edge (headless).
// The SVG is wrapped in a zero-margin HTML page sized exactly to the viewport, so the
// captured PNG is 1:1 with the SVG viewBox.

import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const CANDIDATES = [
  process.env.DSH_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

export function findBrowser() {
  for (const c of CANDIDATES) if (existsSync(c)) return c;
  throw new Error('no headless browser found');
}

export function rasterizeSvg(svgPath, pngPath, width, height, { browser = findBrowser(), dpr = 1 } = {}) {
  const scratch = join(tmpdir(), 'dsh-isopleth-scratch');
  mkdirSync(scratch, { recursive: true });
  const htmlPath = join(scratch, `${basename(pngPath, '.png')}.html`);
  const svgUrl = pathToFileURL(svgPath).href;
  writeFileSync(
    htmlPath,
    `<!doctype html><meta charset="utf-8"><title>preview</title>` +
      `<style>html,body{margin:0;padding:0;background:#000;overflow:hidden}` +
      `img{display:block;width:${width}px;height:${height}px}</style>` +
      `<img src="${svgUrl}">`,
    'utf8',
  );

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--force-device-scale-factor=${dpr}`,
    `--user-data-dir=${join(tmpdir(), 'dsh-isopleth-browser')}`,
    `--window-size=${width},${height}`,
    `--screenshot=${pngPath}`,
    pathToFileURL(htmlPath).href,
  ];

  const res = spawnSync(browser, args, { stdio: 'ignore', timeout: 60000 });
  if (res.error) throw res.error;
  if (!existsSync(pngPath)) throw new Error(`screenshot failed (status ${res.status})`);
  return pngPath;
}
