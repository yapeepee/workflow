#!/usr/bin/env node
// Design-token guard (reshaped from agent-harnesses v3.1 token enforcement).
// Flags raw design values that bypass the token system, including the Angular/Tailwind escape routes:
// hex colors, color functions, inline style attributes, [style.*]/[ngStyle] bindings,
// Tailwind arbitrary values like bg-[#ff0000] or p-[13px], and CSS/markup inside Angular `template:`/`styles:` literals.
// Custom property definitions (--brand: #123456) are token definitions and are allowed anywhere.
// Escape hatch: a "token-guard-ignore: <reason>" comment on the line, the line before, or before a CSS rule.
//
//   node .solo/engine/token-guard.mjs <files...>     (CLI; exit 1 when violations are found)
import fs from 'node:fs';
import path from 'node:path';
import { isMain, loadConfig, matchAny, repoRoot, toRel } from './lib.mjs';

const RULES = {
  hexColor: {
    re: /(^|[^\w&#/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g,
    msg: 'hard-coded hex color — use a design token (CSS variable / @theme token / utility class)',
    in: ['css', 'markup'],
  },
  colorFunction: {
    re: /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/g,
    msg: 'raw color function — use a design token',
    in: ['css', 'markup'],
  },
  inlineStyle: {
    re: /\sstyle\s*=\s*["'{]/g,
    msg: 'inline style attribute — use a class/utility backed by tokens',
    in: ['markup'],
  },
  styleBinding: {
    re: /\[(?:style(?:\.[\w-]+)*|ngStyle)\]\s*=/g,
    msg: 'Angular style binding — toggle a class instead',
    in: ['markup'],
  },
  arbitraryValue: {
    re: /\b[a-z][\w:-]*-\[(?:#|-?\d+(?:\.\d+)?px|rgba?\(|hsla?\(|oklch\()/g,
    msg: 'Tailwind arbitrary value with a raw color/px — add a token to @theme and use it',
    in: ['markup'],
  },
};

const NAV_BEFORE_HASH = /(href|to|routerLink|fragment|id|for|xlink:href)\s*=\s*["']?$/i;
const isComment = (l) => /^\s*(\/\/|\/\*|\*|<!--)/.test(l);
const TOKEN_DEF = /--[\w-]+\s*:[^;{}]*;?/g;

function kindOf(rel) {
  const ext = path.extname(rel).toLowerCase();
  if (['.css', '.scss', '.sass', '.less'].includes(ext)) return 'css';
  if (['.html', '.htm', '.vue', '.svelte'].includes(ext)) return 'markup';
  if (['.tsx', '.jsx'].includes(ext)) return 'jsx';
  if (['.ts', '.js', '.mjs'].includes(ext)) return 'script';
  return null;
}

// Remove comment text so "// #abc" or "/* rgb(...) */" never counts as a violation.
const stripComments = (l, ctx) =>
  ctx === 'css' ? l.replace(/\/\*.*?\*\//g, '').replace(/(^|\s)\/\/.*$/, '') : l.replace(/<!--.*?-->/g, '');

function scanLine(line, ctx, enabled, lineNo, found) {
  if (!ctx || isComment(line)) return;
  // custom property definitions (--brand: #0055ff) ARE the tokens, wherever they appear on the line
  const code = ctx === 'css' ? stripComments(line, ctx).replace(TOKEN_DEF, '') : stripComments(line, ctx);
  for (const [name, rule] of Object.entries(RULES)) {
    if (!enabled[name] || !rule.in.includes(ctx)) continue;
    rule.re.lastIndex = 0;
    for (const m of code.matchAll(rule.re)) {
      if (name === 'hexColor') {
        const hashAt = m.index + m[1].length;
        if (NAV_BEFORE_HASH.test(code.slice(Math.max(0, hashAt - 16), hashAt))) continue;
      }
      found.push({ line: lineNo, rule: name, text: line.trim().slice(0, 120), msg: rule.msg });
      break; // one report per rule per line is enough
    }
  }
}

// "token-guard-ignore" works like eslint-disable: on the offending line, on the line before it,
// or as a standalone comment before a CSS rule (then it covers that whole rule block, which
// survives Prettier moving comments around).
export function scanText(text, rel, tg) {
  const enabled = tg.rules || {};
  const kind = kindOf(rel);
  const found = [];
  if (!kind) return found;
  const lines = text.split(/\r?\n/);
  let block = null; // 'markup' | 'css' while inside an Angular template/styles literal
  let depth = 0; // CSS brace depth (css files only)
  let ignoreBlockAt = -1; // depth at which an ignored CSS block started
  let pendingBlockIgnore = false;
  const MARK = 'token-guard-ignore';

  lines.forEach((line, i) => {
    const n = i + 1;
    const prev = i > 0 ? lines[i - 1] : '';
    const marked = line.includes(MARK) || prev.includes(MARK);

    if (kind === 'css') {
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      if (isComment(line) && line.includes(MARK)) pendingBlockIgnore = true;
      if (pendingBlockIgnore && opens > 0) {
        ignoreBlockAt = depth;
        pendingBlockIgnore = false;
      }
      const inIgnoredBlock = ignoreBlockAt >= 0;
      depth += opens - closes;
      if (inIgnoredBlock && depth <= ignoreBlockAt) ignoreBlockAt = -1;
      if (!inIgnoredBlock && !marked) scanLine(line, 'css', enabled, n, found);
      return;
    }
    if (marked) return;
    if (kind === 'markup') {
      // <style> blocks inside HTML are CSS: token definitions allowed, raw values flagged as CSS
      let rest = line;
      if (!block && /<style\b[^>]*>/i.test(rest)) {
        const m = rest.match(/<style\b[^>]*>/i);
        scanLine(rest.slice(0, m.index), 'markup', enabled, n, found);
        rest = rest.slice(m.index + m[0].length);
        block = 'css';
      }
      if (block === 'css') {
        const end = rest.search(/<\/style>/i);
        scanLine(end >= 0 ? rest.slice(0, end) : rest, 'css', enabled, n, found);
        if (end >= 0) block = null;
        return;
      }
      return scanLine(rest, 'markup', enabled, n, found);
    }

    if (kind === 'jsx' && /\b(className|style|class)\s*=/.test(line)) scanLine(line, 'markup', enabled, n, found);

    // Angular inline template/styles in .ts files
    let rest = line;
    if (!block) {
      const open = rest.match(/\b(template|styles)\s*:\s*\[?\s*`/);
      if (!open) return;
      block = open[1] === 'template' ? 'markup' : 'css';
      rest = rest.slice(open.index + open[0].length);
    }
    const close = rest.indexOf('`');
    scanLine(close >= 0 ? rest.slice(0, close) : rest, block, enabled, n, found);
    if (close >= 0) block = null;
  });
  return found;
}

export function formatViolations(rel, found, { shared = false } = {}) {
  const head = `token-guard: ${found.length} violation(s) in ${rel}`;
  const body = found.slice(0, 15).map((v) => `  L${v.line} ${v.rule}: ${v.text}\n      → ${v.msg}`);
  const more = found.length > 15 ? [`  … ${found.length - 15} more`] : [];
  const advice = shared
    ? 'Fix now with the project\'s existing tokens/variables. This repo is shared: do not add token-guard-ignore or any other kit comment to the code. If a raw value is intentional, keep it and mention it in your summary (it will not be reported again this session).'
    : 'Fix now. If a raw value is intentional, put a "token-guard-ignore: <reason>" comment on the line above it (or above the CSS rule).';
  return [head, ...body, ...more, advice].join('\n');
}

function main() {
  const root = repoRoot();
  const cfg = loadConfig(root);
  const tg = cfg.tokenGuard;
  let total = 0;
  for (const f of process.argv.slice(2)) {
    const rel = toRel(root, path.resolve(f));
    if (!rel || matchAny(tg.allow, rel) || !fs.existsSync(f)) continue;
    const found = scanText(fs.readFileSync(f, 'utf8'), rel, tg);
    if (found.length) {
      total += found.length;
      console.log(formatViolations(rel, found, { shared: cfg.shared }));
    }
  }
  console.log(total ? `RESULT: FAIL (${total} token violation(s))` : 'RESULT: PASS');
  return total ? 1 : 0;
}

if (isMain(import.meta.url)) {
  process.exitCode = main();
}
