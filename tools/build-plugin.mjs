// 迷你打包器：把 plugin/entry.mjs 的 ESM 依赖图摊平成**一个自包含文件**。
//
// 目标形态对齐宿主现有做法（platform-purple/dracula-map.js）：单个可直接注入的脚本，
// 无 import / export / 无打包器依赖。产出同时兼作 ESM 与经典脚本（只挂 globalThis）。
//
// 只支持本项目用到的语法子集，遇到不支持的写法会**直接报错退出**，不静默产出坏包：
//   import { a, b } from './x.mjs';        （必须单行）
//   export function / export const / export let / export class
//   export { a, b };
//
// 并做顶层标识符冲突检查：两个模块声明同名顶层变量就报错，避免摊平后互相覆盖。
//
//   node tools/build-plugin.mjs
//
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = resolve(ROOT, 'plugin/entry.mjs');
const OUT = resolve(ROOT, 'dist/dsh-isopleth.plugin.js');

const IMPORT_RE = /^[ \t]*import\s+([^'"]*?)from\s+['"]([^'"]+)['"][ \t]*;?[ \t]*$/gm;
const SIDE_EFFECT_IMPORT_RE = /^[ \t]*import\s+['"]([^'"]+)['"][ \t]*;?[ \t]*$/gm;
const DECL_RE = /^(?:export\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST_RE = /^[ \t]*export\s*\{([^}]*)\}[ \t]*;?[ \t]*$/gm;
const EXPORT_DECL_RE = /^[ \t]*export\s+(?=(?:async\s+)?(?:const|let|var|function|class)\s)/gm;

const modules = new Map();

function load(file) {
  if (modules.has(file)) return modules.get(file);
  if (!file.endsWith('.mjs')) throw new Error(`不支持的依赖类型（只支持 .mjs）：${relative(ROOT, file)}`);

  const code = readFileSync(file, 'utf8');
  const record = { file, code, deps: [], exports: [], decls: [] };
  modules.set(file, record);

  let m;
  const deps = [];
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(code))) deps.push({ spec: m[2], names: m[1].trim() });
  SIDE_EFFECT_IMPORT_RE.lastIndex = 0;
  while ((m = SIDE_EFFECT_IMPORT_RE.exec(code))) deps.push({ spec: m[1], names: '' });

  for (const d of deps) {
    if (!d.spec.startsWith('.')) throw new Error(`${relative(ROOT, file)} 引用了非相对模块：${d.spec}`);
    if (/[{}*]/.test(d.names) && !/^\{[\s\S]*\}$/.test(d.names)) {
      throw new Error(`${relative(ROOT, file)} 用了不支持的 import 形式：${d.names}（只支持具名导入）`);
    }
    if (/^[A-Za-z_$][\w$]*$/.test(d.names)) {
      throw new Error(`${relative(ROOT, file)} 用了默认导入，本项目统一具名导入：${d.names}`);
    }
    const target = resolve(dirname(file), d.spec);
    record.deps.push(target);
    load(target);
  }

  EXPORT_DECL_RE.lastIndex = 0;
  while ((m = EXPORT_DECL_RE.exec(code))) {
    const rest = code.slice(m.index).match(/^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/);
    if (rest) record.exports.push(rest[1]);
  }
  EXPORT_LIST_RE.lastIndex = 0;
  while ((m = EXPORT_LIST_RE.exec(code))) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) record.exports.push(name);
    }
  }
  return record;
}

/** 拓扑排序：被依赖的先展开。 */
function order(entryFile) {
  const seen = new Set();
  const out = [];
  const visit = (file, stack) => {
    if (seen.has(file)) return;
    if (stack.includes(file)) throw new Error(`循环依赖：${relative(ROOT, file)}`);
    const rec = modules.get(file);
    for (const d of rec.deps) visit(d, [...stack, file]);
    seen.add(file);
    out.push(rec);
  };
  visit(entryFile, []);
  return out;
}

function strip(rec) {
  let code = rec.code;
  code = code.replace(IMPORT_RE, '');
  code = code.replace(SIDE_EFFECT_IMPORT_RE, '');
  code = code.replace(EXPORT_LIST_RE, '');
  code = code.replace(EXPORT_DECL_RE, '');
  if (/^\s*export\s+default\b/m.test(code)) throw new Error(`${relative(ROOT, rec.file)} 使用了 export default，不支持`);
  if (/^\s*export\b/m.test(code)) throw new Error(`${relative(ROOT, rec.file)} 还有未处理的 export 语句`);
  return code.trim();
}

function collectDecls(rec, code) {
  const names = [];
  DECL_RE.lastIndex = 0;
  let m;
  while ((m = DECL_RE.exec(code))) names.push(m[1]);
  return names;
}

// ---- 主流程 ----
const entry = load(ENTRY);
const ordered = order(ENTRY);

const owner = new Map();
const bodies = [];
const report = [];
let sourceChars = 0;

for (const rec of ordered) {
  const code = strip(rec);
  const decls = collectDecls(rec, code);
  for (const name of decls) {
    if (owner.has(name)) {
      throw new Error(
        `顶层标识符冲突：${name} 同时出现在 ${relative(ROOT, owner.get(name))} 与 ${relative(ROOT, rec.file)}；` +
          '摊平到同一作用域前必须先改名',
      );
    }
    owner.set(name, rec.file);
  }
  sourceChars += code.length;
  bodies.push(`// ---- ${relative(ROOT, rec.file).replace(/\\/g, '/')} ----\n${code}`);
  report.push({ file: relative(ROOT, rec.file).replace(/\\/g, '/'), chars: code.length, decls: decls.length });
}

const api = [...new Set(entry.exports)];
if (api.length === 0) throw new Error('入口没有导出任何东西');

// 打包产物必须在渲染进程里能跑：出现任何 Node-only 全局就直接失败，不产出坏包。
// 扫描前先去掉注释，避免文档里提到 Buffer 之类造成误报。
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const NODE_ONLY = [
  [/\bprocess\s*\./, 'process.'],
  [/\brequire\s*\(/, 'require('],
  [/\bBuffer\s*[.(]/, 'Buffer'],
  [/\b__dirname\b/, '__dirname'],
  [/\b__filename\b/, '__filename'],
  [/from\s+['"]node:/, 'node: 内置模块'],
];
const offending = [];
for (const body of bodies) {
  const scanned = stripComments(body);
  for (const [re, label] of NODE_ONLY) if (re.test(scanned)) offending.push(label);
}
if (offending.length) {
  throw new Error(`产物里出现 Node-only 全局：${[...new Set(offending)].join(', ')}；浏览器路径必须零 Node 依赖`);
}

const banner = `/*!
 * dsh-isopleth plugin — 程序化地形底纹（自包含单文件，无依赖）
 * 由 tools/build-plugin.mjs 从 plugin/entry.mjs 生成，请勿手改。
 * 用法：
 *   <script src="dsh-isopleth.plugin.js"></script>
 *   const plugin = DSH_ISOPLETH.createIsoplethPlugin({ seed: 'isopleth-01' });
 *   await plugin.apply(document.querySelector('#stage'));
 */`;

const bundle = `${banner}
(function (global) {
  'use strict';
${bodies.join('\n\n')}

  global.DSH_ISOPLETH = { ${api.join(', ')} };
})(typeof globalThis !== 'undefined' ? globalThis : self);
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, bundle, 'utf8');

const sha = createHash('sha256').update(bundle).digest('hex').slice(0, 16);
console.log(`built ${relative(ROOT, OUT).replace(/\\/g, '/')}`);
console.log(`  modules   ${ordered.length}`);
console.log(`  src chars ${sourceChars}`);
console.log(`  out bytes ${statSync(OUT).size}`);
console.log(`  sha256    ${sha}`);
console.log(`  api       ${api.join(', ')}`);
for (const r of report) console.log(`  - ${r.file.padEnd(28)} ${String(r.chars).padStart(6)} chars  ${r.decls} decls`);
