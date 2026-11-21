// Local replica of the token-radar-01 gate's seven checks, from RULES.txt.
// Run: node validate.mjs <output-dir> <snapshot.json>
// Exits 1 naming the first failed check. This file is a build tool, not part of the
// graded output — the server runs its own scorer; this exists so we never spend a
// submission finding out what we could have checked at home.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-board.ts';

const out = process.argv[2];
const snap = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const results = [];
const check = (id, ok, detail) => results.push({ id, ok, detail });

const PLAIN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
function walk(dir, base = '') {
  const files = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) files.push(...walk(join(dir, e.name), rel));
    else if (e.isFile()) files.push({ rel, name: e.name, size: statSync(join(dir, e.name)).size });
  }
  return files;
}

// 1 dashboard_files
{
  const dir = join(out, 'dashboard');
  const files = existsSync(dir) ? walk(dir) : [];
  const bytes = files.reduce((n, f) => n + f.size, 0);
  let bad = null;
  if (!files.some((f) => f.rel === 'index.html')) bad = 'no index.html';
  if (!files.some((f) => f.name.endsWith('.css'))) bad = 'no .css';
  if (!files.some((f) => f.name.endsWith('.js'))) bad = 'no .js';
  if (files.length > 400) bad = 'over 400 files';
  if (bytes > 4 * 1024 * 1024) bad = 'over 4 MiB';
  for (const f of files) if (!PLAIN.test(f.name)) bad = `bad name ${f.rel}`;
  const urlRe = /https?:\/\//;
  for (const f of files) {
    const text = readFileSync(join(dir, f.rel), 'utf8');
    if (f.name.endsWith('.css') && urlRe.test(text)) bad = `URL in CSS ${f.rel}`;
    if (f.name.endsWith('.js') && /(?:import|export|require|import\()\s*\(?\s*['"]https?:/.test(text)) bad = `URL specifier in JS ${f.rel}`;
    if (f.name.endsWith('.html')) {
      for (const m of text.matchAll(/(?:href|src|action)\s*=\s*"([^"]*)"/g)) if (urlRe.test(m[1])) bad = `URL attribute in ${f.rel}: ${m[1]}`;
      for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) if (urlRe.test(m[1])) bad = `URL in <style> in ${f.rel}`;
    }
  }
  check('dashboard_files', bad === null, bad ?? `${files.length} files, ${bytes} bytes, no network references`);
}

// 2+3+4+5 board checks
const boardRaw = readFileSync(join(out, 'board.json'), 'utf8');
const board = JSON.parse(boardRaw);
const rows = Array.isArray(board) ? board : board.rows;
{
  const slugs = new Set(snap.protocols.map((p) => p.slug));
  let bad = null;
  if (!Array.isArray(rows) || rows.length < 100 || rows.length > 4000) bad = `row count ${rows?.length}`;
  if (Buffer.byteLength(boardRaw) > 8 * 1024 * 1024) bad = 'board over 8 MiB';
  const seen = new Set();
  for (const r of rows) {
    if (!slugs.has(r.slug)) { bad = `invented slug ${r.slug}`; break; }
    if (seen.has(r.slug)) { bad = `duplicate slug ${r.slug}`; break; }
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) { bad = `empty name ${r.slug}`; break; }
    if (!Number.isSafeInteger(r.rank) || r.rank <= 0) { bad = `bad rank ${r.slug}`; break; }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) { bad = `bad implied ${r.slug}`; break; }
    if (!Array.isArray(r.farm_steps)) { bad = `farm_steps not array ${r.slug}`; break; }
  }
  if (rows.every((r) => r.implied_value_usd === rows[0].implied_value_usd)) bad = 'all implied values equal';
  check('board_file', bad === null, bad ?? `${rows.length} rows, all slugs real`);
}
{
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  let bad = null;
  byRank.forEach((r, i) => { if (r.rank !== i + 1 && bad === null) bad = `rank ${i + 1} is ${r.rank}`; });
  for (let i = 1; i < byRank.length; i++) if (byRank[i].implied_value_usd > byRank[i - 1].implied_value_usd) { bad = `implied rises at rank ${byRank[i].rank}`; break; }
  check('sorted_by_value', bad === null, bad ?? 'ranks 1..N, implied non-rising');
}
{
  const have = new Set(rows.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !have.has(s));
  const outside = rows.filter((r) => !snap.watchlist.includes(r.slug)).length;
  check('coverage', missing.length === 0 && outside >= 60, missing.length ? `missing ${missing.slice(0, 3)}` : `watchlist ${snap.watchlist.length}/${snap.watchlist.length}, ${outside} rows outside it`);
}
{
  let bad = null;
  for (const r of rows) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) { bad = `${r.slug}: ${r.farm_steps.length} steps`; break; }
    for (const s of r.farm_steps) { const t = s.trim(); if (t.length < 20 || t.length > 600) { bad = `${r.slug}: step of ${t.length} chars`; break; } }
    if (bad) break;
  }
  check('farm_steps', bad === null, bad ?? 'every row: 7 steps, 20–600 chars');
}

// 6 screenshots (dimensions parsed from the JPEG SOF / PNG IHDR headers)
function imageSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), kind: 'png' };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5), kind: 'jpeg' };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}
{
  const dir = join(out, 'screenshots');
  const names = readdirSync(dir).filter((n) => !n.startsWith('.'));
  let bad = null;
  if (names.length < 3 || names.length > 4) bad = `${names.length} screenshots`;
  for (const n of names) {
    const buf = readFileSync(join(dir, n));
    if (buf.length > 512 * 1024) { bad = `${n} over 512 KiB`; break; }
    const s = imageSize(buf);
    if (!s) { bad = `${n} not a whole PNG/JPEG`; break; }
    const long = Math.max(s.w, s.h), short = Math.min(s.w, s.h);
    if (long > 1440 || short < 800) { bad = `${n} is ${s.w}x${s.h}`; break; }
  }
  check('screenshots', bad === null, bad ?? `${names.length} images within caps`);
}

// 7 dossier_matches
{
  const expected = Buffer.from(buildDossier(out, { text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 } }));
  const actual = readFileSync(join(out, 'dossier.json'));
  const ok = expected.equals(actual) && actual.length <= 1.5 * 1024 * 1024;
  check('dossier_matches', ok, ok ? `byte-identical, ${actual.length} bytes` : `MISMATCH (expected ${expected.length}, got ${actual.length})`);
}

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id} — ${r.detail}`);
  if (!r.ok) failed++;
}
console.log(failed === 0 ? 'GATE 7/7' : `GATE ${7 - failed}/7`);
process.exit(failed === 0 ? 0 : 1);
