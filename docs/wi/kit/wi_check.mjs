// ตรวจรายสัปดาห์: คู่มือ WI เล่มไหน "ล้าสมัย" เพราะโค้ดเปลี่ยน
// ใช้: node docs/wi/kit/wi_check.mjs [HEAD=origin/main]   (รันจากราก repo)
// อ่าน base ของแต่ละเล่มจาก docs/wi/books.json → ไล่ 2 อย่าง:
//   ① ป้ายปุ่ม/แท็บที่คู่มือชี้ (spec.json marks + click) ยังมีใน src ไหม — หาย = ขั้นตอนในคู่มือผิดแน่ (🔴)
//   ② commit ที่แตะไฟล์หน้าในเล่ม + component ที่หน้านั้น import (2 ชั้น) — ให้คนอ่าน subject/diff แล้วตัดสิน
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const HEAD = process.argv[2] || 'origin/main';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 });
const books = JSON.parse(fs.readFileSync('docs/wi/books.json', 'utf8'));
const show = (rev, f) => { try { return execFileSync('git', ['show', `${rev}:${f}`], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
function deps(rev, file, depth, seen) {
  if (seen.has(file) || depth < 0) return; const src = show(rev, file); if (src == null) return; seen.add(file);
  for (const m of src.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const base = path.normalize(path.join(path.dirname(file), m[1]));
    if (!/^src\/(components|pages)\//.test(base)) continue;          // utils/lib = กฎกลาง — ไม่นับว่า "หน้าตาเปลี่ยน"
    for (const ext of ['', '.jsx', '.js']) if (show(rev, base + ext) != null) { deps(rev, base + ext, depth - 1, seen); break; }
  }
}
let out = [`# WI check — ${HEAD} (${git('rev-parse', '--short', HEAD).trim()})\n`];
for (const [key, b] of Object.entries(books)) {
  const spec = JSON.parse(fs.readFileSync(`docs/wi/books/${key}/spec.json`, 'utf8'));
  const pages = [...new Set(spec.map(s => s.p))];
  const files = new Set(); for (const p of pages) for (const rev of [b.base, HEAD]) deps(rev, `src/pages/${p}.jsx`, 2, files);
  const labels = [...new Set(spec.flatMap(s => [...(s.marks || []), ...(s.click ? [].concat(s.click) : [])]).filter(x => typeof x === 'string').map(x => x.replace(/^=/, '').trim()).filter(Boolean))];
  const has = (rev, l) => { try { execFileSync('git', ['grep', '-qF', l, rev, '--', 'src'], { stdio: 'ignore' }); return true; } catch { return false; } };
  // นับเฉพาะป้ายที่ "มีในโค้ดตอนทำคู่มือ แต่หายตอนนี้" — ป้ายที่เป็นข้อมูล mock/ตัวเลขนับ ไม่เคยอยู่ใน src อยู่แล้ว ไม่ใช่การเปลี่ยน
  const missing = labels.filter(l => has(b.base, l) && !has(HEAD, l));
  const log = git('log', '--no-merges', '--format=%h %ad %s', '--date=short', `${b.base}..${HEAD}`, '--', ...files).trim();
  const n = log ? log.split('\n').length : 0;
  out.push(`## ${key} · ${b.title}  (base ${b.base})`);
  out.push(`- ป้ายที่คู่มือชี้ ${labels.length} ป้าย · **มีตอนทำคู่มือแต่หายตอนนี้ ${missing.length}**${missing.length ? ': ' + missing.map(m => '`' + m + '`').join(', ') : ''}`);
  out.push(`- commit ที่แตะ ${files.size} ไฟล์ของเล่มนี้: **${n}**`);
  if (n) out.push(log.split('\n').slice(0, 40).map(l => '  - ' + l).join('\n') + (n > 40 ? `\n  - … อีก ${n - 40}` : ''));
  out.push('');
}
console.log(out.join('\n'));
