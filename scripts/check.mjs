// Static sanity checks that catch the mistakes our tooling has actually produced:
//  - syntax errors in any server/public JS module (node --check)
//  - inline event handlers in HTML/JS templates (blocked by the CSP: script-src 'self')
//  - escaped template literals (\` / \${) that would render literally
//  - i18n keys used in JS/HTML that are missing from en.js, and ru.js keys missing vs en.js
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

// i18n coverage
const en = (await import(pathToFileURL(path.join(root, 'public/js/i18n/en.js')))).default;
const ru = (await import(pathToFileURL(path.join(root, 'public/js/i18n/ru.js')))).default;
for (const key of Object.keys(en)) if (!(key in ru)) problems.push(`i18n: ru.js is missing '${key}'`);
for (const key of Object.keys(ru)) if (!(key in en)) problems.push(`i18n: ru.js has extra key '${key}'`);
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
