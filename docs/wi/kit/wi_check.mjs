// ตรวจรายสัปดาห์: คู่มือ WI เล่มไหน "ล้าสมัย" เพราะโค้ดเปลี่ยน
// ใช้: node docs/wi/kit/wi_check.mjs [HEAD=origin/main]   (รันจากราก repo)
// อ่าน base ของแต่ละเล่มจาก docs/wi/books.json → ไล่ 2 อย่าง:
//   ① ป้ายปุ่ม/แท็บที่คู่มือชี้ (spec.json marks + click) ยังมีใน src ไหม — หาย = ขั้นตอนในคู่มือผิดแน่ (🔴)
//      (ค้นบนข้อความที่ถอด tr() + ตัดคอมเมนต์แล้ว · ป้ายที่ประกอบตอนรันเช่น importLabel() ยังต้องดูจากภาพ)
//   ② commit ที่แตะไฟล์หน้าในเล่ม + component ที่หน้านั้น import (2 ชั้น) — ให้คนอ่าน subject/diff แล้วตัดสิน
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const HEAD = process.argv[2] || 'origin/main';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 });
const books = JSON.parse(fs.readFileSync('docs/wi/books.json', 'utf8'));
const _show = new Map();
const show = (rev, f) => {
  const k = rev + ':' + f; if (_show.has(k)) return _show.get(k);
  let v; try { v = execFileSync('git', ['show', k], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { v = null; }
  _show.set(k, v); return v;
};
function deps(rev, file, depth, seen) {
  if (seen.has(file) || depth < 0) return; const src = show(rev, file); if (src == null) return; seen.add(file);
  // 27/11: ตาม lazy(() => import('./X')) ด้วย — หน้าย่อยของ Daily Checker (AM/LPA/Poka-Yoke/BBS) โหลดแบบนี้ ไม่ตาม = มองไม่เห็นทั้งหน้า
  for (const m of src.matchAll(/(?:from\s+|import\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const base = path.normalize(path.join(path.dirname(file), m[1]));
    if (!/^src\/(components|pages)\//.test(base)) continue;          // utils/lib = กฎกลาง — ไม่นับว่า "หน้าตาเปลี่ยน"
    for (const ext of ['', '.jsx', '.js']) if (show(rev, base + ext) != null) { deps(rev, base + ext, depth - 1, seen); break; }
  }
}
/* 27/11: เทียบป้ายกับ "ข้อความที่จอโชว์จริง" ของ "หน้าในเล่ม" — 3 กับดักที่เจอในรอบตรวจ:
   ① งานแปลภาษาแยกข้อความ `จัดการที่ Rack Center` → `{tr("จัดการที่")} Rack Center` ⇒ grep ดิบฟ้องว่าหาย (หลอก)
      ⇒ ถอดตัวห่อ tr()/trI18n()/{…} ออกก่อนค้น
   ② ปุ่มเปลี่ยนชื่อแต่คำเก่ายังค้างในคอมเมนต์ / en.js / ไฟล์เทส / หน้าอื่น (`อัพโหลด e-SMART` · `Export Excel`)
      ⇒ grep ทั้ง src บอกว่ายังอยู่ (พลาด) ⇒ ค้นเฉพาะไฟล์หน้า+component ของเล่ม (ชุดเดียวกับ ②) และตัดคอมเมนต์ทิ้ง
   ③ หน้าย่อยที่โหลดด้วย lazy(() => import()) ไม่ถูกนับ ⇒ deps() ตาม import() ด้วย
   ป้ายที่ประกอบตอนรัน (importLabel() · ข้อมูล mock) ยังค้นไม่เจอ — ไม่ถูกฟ้องเพราะไม่เคยอยู่ในไฟล์ตอนทำเล่ม ต้องดูจากภาพที่ถ่ายใหม่ */
const norm = (t) => String(t).replace(/\s+/g, ' ').trim();
const unwrap = (_, q, x) => x.replace(/\\(.)/g, '$1');
const visibleText = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, ' ')                                        // /* … */ และ {/* … */}
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')                                   // // … (เว้น http:// ในสตริง)
  .replace(/\$?\{\s*(?:tr|trI18n)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*\)\s*\}/g, unwrap)    // {tr("x")} / ${tr("x")} → x
  .replace(/\b(?:tr|trI18n)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*\)/g, unwrap);              // tr("x") → x
const _corpus = new Map();
function corpus(rev, files) {
  const k = rev + '|' + files.join(',');
  if (!_corpus.has(k)) _corpus.set(k, norm(files.map(f => visibleText(show(rev, f) || '')).join('\n')));
  return _corpus.get(k);
}
let out = [`# WI check — ${HEAD} (${git('rev-parse', '--short', HEAD).trim()})\n`];
for (const [key, b] of Object.entries(books)) {
  const spec = JSON.parse(fs.readFileSync(`docs/wi/books/${key}/spec.json`, 'utf8'));
  const pages = [...new Set(spec.map(s => s.p))];
  const files = new Set(); for (const p of pages) for (const rev of [b.base, HEAD]) deps(rev, `src/pages/${p}.jsx`, 2, files);
  const labels = [...new Set(spec.flatMap(s => [...(s.marks || []), ...(s.click ? [].concat(s.click) : [])]).filter(x => typeof x === 'string').map(x => x.replace(/^[=@]/, '').trim()).filter(Boolean))];
  /* ป้ายบางตัวอยู่ใน utils ที่หน้าดึงไปใช้ (เช่น ชื่อแท็บย้ายไป src/utils/navSubTabs.js) — นับเป็นที่อยู่ของป้ายด้วย
     แต่ไม่นับเป็น "commit ที่แตะเล่ม" (utils = กฎกลาง) */
  const labelFiles = new Set(files);
  for (const f of files) for (const rev of [b.base, HEAD]) {
    const src = show(rev, f); if (!src) continue;
    for (const m of src.matchAll(/(?:from\s+|import\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const base = path.normalize(path.join(path.dirname(f), m[1]));
      if (!/^src\/(utils|lib)\//.test(base)) continue;
      for (const ext of ['', '.js', '.jsx']) if (show(rev, base + ext) != null) { labelFiles.add(base + ext); break; }
    }
  }
  const bookFiles = [...labelFiles].filter(f => !/__tests__|\/i18n\//.test(f)).sort();
  const has = (rev, l) => corpus(rev, bookFiles).includes(norm(l));
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
