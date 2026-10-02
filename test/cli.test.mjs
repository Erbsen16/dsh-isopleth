import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin/hypsa-isopleth.mjs');

const run = (args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

test('--help 正常退出', () => {
  const r = run(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /hypsa-isopleth/);
  assert.match(r.stdout, /--seed/);
});

test('默认参数出 SVG 到 stdout', () => {
  const r = run(['--size', '320x240']);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.startsWith('<svg'));
  assert.ok(r.stdout.trimEnd().endsWith('</svg>'));
});

test('非法输入以退出码 2 结束并给出提示', () => {
  for (const args of [['--size', 'bad'], ['--levels', '0'], ['--bands', '-1'], ['--style', 'nope'], ['--water', '5']]) {
    const r = run(args);
    assert.equal(r.code, 2, `${args.join(' ')} 应以 2 退出`);
    assert.match(r.stderr, /hypsa-isopleth:/);
  }
});

test('--out 写文件且不污染 stdout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hypsa-cli-'));
  const out = join(dir, 'terrain.svg');
  const r = run(['--size', '320x240', '--out', out, '--style', 'none', '--bands', '0']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.ok(existsSync(out));
  assert.ok(readFileSync(out, 'utf8').startsWith('<svg'));
});

test('--report 写 stderr 而不是 stdout', () => {
  const r = run(['--size', '320x240', '--report']);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.startsWith('<svg'), 'stdout 必须仍是纯 SVG');
  assert.match(r.stderr, /中位间距/);
});
