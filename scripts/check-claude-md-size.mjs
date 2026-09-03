// ด่านกัน context บวม — ของที่ Claude Code โหลดเข้า memory "ทุก session" ต้องเล็กเสมอ
// (2026-09-03 เคยถึง 1.45 MB = 550k tokens = 55% ของ context ก่อนเริ่มงาน)
//
// ตรวจ 3 ช่องทางที่ทำให้บวม — ครบทุกทางที่ Claude Code ดูดไฟล์เข้า memory อัตโนมัติ:
//   1. ขนาด CLAUDE.md
//   2. `@path` import  ← ต้นเหตุจริงของ 550k (ดูด docs ทั้งไฟล์เข้า memory ทุก session)
//   3. CLAUDE.md ซ้อนในโฟลเดอร์ย่อย (โหลดเพิ่มเองเมื่อทำงานในโฟลเดอร์นั้น)
import { statSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const LIMIT_KB = 120;
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.claude']);
const fail = [];

// ── 1. ขนาด ──────────────────────────────────────────────────────────────
const kb = statSync(join(ROOT, 'CLAUDE.md')).size / 1024;
console.log(`CLAUDE.md = ${kb.toFixed(1)} KB (เพดาน ${LIMIT_KB} KB)`);
if (kb > LIMIT_KB) {
  fail.push(
    `CLAUDE.md ${kb.toFixed(1)} KB เกินเพดาน ${LIMIT_KB} KB\n` +
    `   → ย้ายรายละเอียดโมดูล/ประวัติ/ผลรันจริง ไป docs/modules/<module>.md แล้วเหลือ pointer ไว้`
  );
}

// ── 2. @ import ──────────────────────────────────────────────────────────
// `@path` ทำให้ Claude Code โหลดไฟล์นั้นเป็น memory ทุก session — ต่อให้ CLAUDE.md เล็ก
// context ก็บวมตามไฟล์ที่ถูก import (อ้างด้วย path ธรรมดาแทน แล้วให้เปิดอ่านเฉพาะตอนต้องใช้)
const md = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
const imports = md
  .split('\n')
  .map((line, i) => [i + 1, line])
  .filter(([, line]) => /^\s*@[\w./-]+/.test(line));
if (imports.length) {
  fail.push(
    `CLAUDE.md มี @import ${imports.length} จุด — ดูดไฟล์เข้า memory ทุก session\n` +
    imports.map(([n, l]) => `   บรรทัด ${n}: ${l.trim()}`).join('\n') +
    `\n   → เปลี่ยนเป็น path ธรรมดา (\`docs/modules/x.md\`) ไม่ต้องมี @`
  );
}

// ── 3. CLAUDE.md ซ้อน ────────────────────────────────────────────────────
const nested = [];
(function walk(dir, rel = '') {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, `${rel}${e.name}/`);
    else if (e.name === 'CLAUDE.md' && rel) {
      nested.push([`${rel}CLAUDE.md`, statSync(p).size / 1024]);
    }
  }
})(ROOT);
if (nested.length) {
  fail.push(
    `เจอ CLAUDE.md ซ้อนในโฟลเดอร์ย่อย ${nested.length} ไฟล์ — Claude Code โหลดเพิ่มเองเมื่อทำงานในโฟลเดอร์นั้น\n` +
    nested.map(([p, k]) => `   ${p} (${k.toFixed(1)} KB)`).join('\n') +
    `\n   → ถ้าไม่ได้ตั้งใจ ให้ย้ายเนื้อหาไป docs/modules/ แทน`
  );
}

if (fail.length) {
  console.error(`\n❌ ด่าน context บวม ไม่ผ่าน ${fail.length} ข้อ:\n`);
  fail.forEach((m, i) => console.error(`${i + 1}. ${m}\n`));
  process.exit(1);
}
console.log('✅ ผ่าน — ไม่มี @import · ไม่มี CLAUDE.md ซ้อน');
