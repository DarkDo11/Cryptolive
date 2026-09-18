// Static sanity checks that catch the mistakes our tooling has actually produced:
//  - syntax errors in any server/public JS module (node --check)
//  - inline event handlers in HTML/JS templates (blocked by the CSP: script-src 'self')
//  - escaped template literals (\` / \${) that would render literally
//  - i18n keys used in JS/HTML that are missing from en.js, and dictionary coverage vs en.js
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

async function walk(dir, exts) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') out.push(...await walk(full, exts)); }
    else if (exts.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const js = [...await walk(path.join(root, 'server'), ['.js']), ...await walk(path.join(root, 'public'), ['.js']), ...await walk(path.join(root, 'test'), ['.js'])];
const html = await walk(path.join(root, 'public'), ['.html']);

for (const file of js) {
  try { await exec(process.execPath, ['--check', file]); }
  catch (err) { problems.push(`${path.relative(root, file)}: syntax error\n${err.stderr}`); }
}

for (const file of [...js, ...html]) {
  const text = await readFile(file, 'utf8');
  const rel = path.relative(root, file);
  text.split('\n').forEach((line, i) => {
    if (/<[a-z][^>]*\son[a-z]+\s*=\s*["']/i.test(line)) problems.push(`${rel}:${i + 1}: inline event handler`);
    if (file.endsWith('.js') && /\\`|\\\$\{/.test(line) && !rel.startsWith('scripts/')) problems.push(`${rel}:${i + 1}: escaped template literal`);
  });
}

// Arrow/function parameters named `t` that shadow the i18n `t()` inside a block that calls t(...).
function findShadowedT(text) {
  const hits = [];
  const re = /(?:\(\s*t\s*(?:,\s*\w+\s*)*\)|\bt)\s*=>\s*\{|function\s*\w*\s*\(\s*t\s*(?:,[^)]*)?\)\s*\{/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 0, i = text.indexOf('{', m.index);
    const start = i;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) break; }
    }
    const body = text.slice(start, i);
    if (/[^\w.]t\(\s*['"`]/.test(body)) hits.push(text.slice(0, m.index).split('\n').length);
  }
  return hits;
}
for (const file of js.filter(f => f.includes('/public/'))) {
  const text = await readFile(file, 'utf8');
  if (!/import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*['"][^'"]*i18n\.js['"]/.test(text)) continue;
  for (const line of findShadowedT(text)) problems.push(`${path.relative(root, file)}:${line}: parameter 't' shadows i18n t() inside a block that calls t(...)`);
}

// i18n coverage
const i18nDir = path.join(root, 'public/js/i18n');
const dictionaryFiles = (await readdir(i18nDir)).filter(file => file.endsWith('.js')).sort();
const dictionaries = new Map();
for (const file of dictionaryFiles) {
  dictionaries.set(file, (await import(pathToFileURL(path.join(i18nDir, file)))).default);
}
const en = dictionaries.get('en.js');
const i18nSource = await readFile(path.join(root, 'public/js/i18n.js'), 'utf8');
const langsBlock = i18nSource.match(/export\s+const\s+LANGS\s*=\s*\[([\s\S]*?)\];/)?.[1] || '';
const langCodes = new Set([...langsBlock.matchAll(/\bcode\s*:\s*['"]([^'"]+)['"]/g)].map(match => match[1]));
const placeholderSet = value => new Set(typeof value === 'string'
  ? [...value.matchAll(/\{([^{}]+)\}/g)].map(match => match[1])
  : []);
const sameSet = (a, b) => a.size === b.size && [...a].every(value => b.has(value));

for (const [file, dictionary] of dictionaries) {
  const code = path.basename(file, '.js');
  const imported = new RegExp(`import\\s+${code}\\s+from\\s+['"]\\./i18n/${file}['"]`).test(i18nSource);
  if (!imported || !langCodes.has(code)) problems.push(`i18n: ${code} not registered in public/js/i18n.js`);
  if (file === 'en.js') continue;
  for (const key of Object.keys(en)) {
    if (!(key in dictionary)) problems.push(`i18n: ${file} is missing '${key}'`);
    else if (!sameSet(placeholderSet(en[key]), placeholderSet(dictionary[key]))) {
      problems.push(`i18n: ${file} '${key}' placeholders differ`);
    }
  }
  for (const key of Object.keys(dictionary)) if (!(key in en)) problems.push(`i18n: ${file} has extra key '${key}'`);
}
for (const code of langCodes) {
  if (!dictionaries.has(`${code}.js`)) problems.push(`i18n: ${code} has no dictionary file`);
}
const keyRe = /\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g;
const attrRe = /data-i18n(?:-[a-z]+)?="([a-zA-Z0-9_.]+)"/g;
for (const file of [...js.filter(f => f.includes('/public/') && !f.endsWith('/i18n.js')), ...html]) {
  const text = await readFile(file, 'utf8');
  const rel = path.relative(root, file);
  for (const re of [keyRe, attrRe]) {
    for (const m of text.matchAll(re)) {
      if (!(m[1] in en) && !m[1].startsWith('fng.')) problems.push(`${rel}: unknown i18n key '${m[1]}'`);
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`ok: ${js.length} JS files, ${html.length} HTML files, ${Object.keys(en).length} i18n keys`);
