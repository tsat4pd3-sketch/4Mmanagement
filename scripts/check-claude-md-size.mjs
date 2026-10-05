// ด่านกัน context บวม — ของที่ Claude Code โหลดเข้า memory "ทุก session" ต้องเล็กเสมอ
// (2026-09-03 เคยถึง 1.45 MB = 550k tokens = 55% ของ context ก่อนเริ่มงาน)
//
// ตรวจ 3 ช่องทางที่ทำให้บวม — ครบทุกทางที่ Claude Code ดูดไฟล์เข้า memory อัตโนมัติ:
//   1. ขนาด CLAUDE.md
//   2. `@path` import  ← ต้นเหตุจริงของ 550k (ดูด docs ทั้งไฟล์เข้า memory ทุก session)
//   3. CLAUDE.md ซ้อนในโฟลเดอร์ย่อย (โหลดเพิ่มเองเมื่อทำงานในโฟลเดอร์นั้น)
//
// + กฎรับเข้า (2026-10-05 · คำสั่ง user "ตั้งกฎว่าอะไรมีสิทธิ์อยู่ใน CLAUDE.md")
//   เพดานขนาดอย่างเดียวไม่พอ — 30/09 มี session รีดลงเหลือ 103.8 KB แล้ว**โตกลับเต็มใน 2 วัน**
//   เพราะกฎ "ประวัติ/ผลรันจริงห้ามใส่ CLAUDE.md" เขียนไว้แต่**ไม่มีใครตรวจ** (ผมเองก็เพิ่งละเมิด 2 ครั้ง)
//   ⇒ เติมด่านที่ grep ได้แม่น 2 ข้อ (4, 5) + คำเตือนล่วงหน้า (6) ก่อนจะชนเพดาน
//   🔴 ด่านพวกนี้ตรวจ "รูป" ของกฎ ไม่ได้ตรวจเนื้อหา — ของที่ตัดสินด้วยภาษาคน อยู่ในกฎรับเข้าใน CLAUDE.md
import { statSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const LIMIT_KB = 120;
const WARN_KB = 110;        // เตือนล่วงหน้า — เหลือที่ให้กฎใหม่ ~10 KB ก่อนชนเพดาน
const SECTION_KB = 9;       // เพดานต่อหัวข้อ `##`
// ทำไม 9: วัด 05/10 — 42 จาก 74 หัวข้อเป็น pointer สั้น (<0.7 KB) · หัวข้อใหญ่สุด 8.1 KB (หัวข้อกฎการทำงาน
// ซึ่งโดยธรรมชาติเก็บกฎมากที่สุด) · อันดับ 2-5 = 8.0 / 7.6 / 7.5 / 6.4 KB ⇒ 9 KB ให้ที่หายใจ ~1 KB
// แล้วกัดทันทีถ้าหัวข้อโมดูลเริ่มพอก · 🔴 **เพดานนี้ห้ามขยายเพื่อให้ build ผ่าน** — ให้รีดเนื้อหาแทน
// (เพดานรวม 120 KB ยังเป็น backstop)
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

// ── 4. เพดานต่อหัวข้อ ────────────────────────────────────────────────────
// หัวข้อที่โตเกินนี้ = มีรายละเอียดระดับโมดูลปนอยู่ (กฎข้าม session จริงๆ สั้นกว่านี้เสมอ)
// วัด 05/10: 42 จาก 74 หัวข้อเป็น pointer สั้น (<0.7 KB) อยู่แล้ว — ตัวที่โตคือ ~15 หัวข้อที่พอกทุก session
const sections = [];
{
  let cur = { head: '(หัวไฟล์)', body: [], line: 1 };
  md.split('\n').forEach((ln, i) => {
    if (ln.startsWith('## ')) { sections.push(cur); cur = { head: ln.slice(3).trim(), body: [], line: i + 1 }; }
    else cur.body.push(ln);
  });
  sections.push(cur);
}
const sizeOf = (sec) => Buffer.byteLength(sec.body.join('\n')) / 1024;
const fat = sections.filter(s => sizeOf(s) > SECTION_KB).sort((a, b) => sizeOf(b) - sizeOf(a));
if (fat.length) {
  fail.push(
    `หัวข้อใน CLAUDE.md ที่เกิน ${SECTION_KB} KB ${fat.length} หัวข้อ — มีรายละเอียดระดับโมดูลปนอยู่\n` +
    fat.map(s => `   ${sizeOf(s).toFixed(1)} KB · บรรทัด ${s.line}: ${s.head.slice(0, 60)}`).join('\n') +
    `\n   → ย้ายตัวเลข/ประวัติ/เคสจริง ไป docs/modules/<module>.md เหลือเฉพาะ "กฎ + ชื่อไฟล์เจ้าของกฎ + 📄 pointer"`
  );
}

// ── 5. กฎทุกข้อต้องชี้ได้ว่า "อยู่ไฟล์ไหน" ───────────────────────────────
// กฎ 🔴 ที่ไม่บอกว่าสูตร/ด่านอยู่ไฟล์ไหน = session ถัดไปหาไม่เจอ แล้วไปเขียนสูตรซ้ำในหน้า
// (คลาสบั๊กที่โปรเจคนี้เจอซ้ำที่สุด — สูตรเดียวกันถูกก๊อป 7 ที่แล้ว drift กันจริง)
// นับเป็น "บล็อก" ไม่ใช่รายบรรทัด — หัวข้อกฎมักไม่มี backtick แต่เนื้อข้างล่างมี
{
  const blocks = [];
  let cur = null;
  for (const ln of md.split('\n')) {
    if (ln.startsWith('## ') || /^>\s*###\s/.test(ln)) { if (cur) blocks.push(cur); cur = [ln]; }
    else if (cur) cur.push(ln);
  }
  if (cur) blocks.push(cur);
  const orphan = blocks.filter(b => b.some(l => l.includes('🔴')) && !b.some(l => l.includes('`')));
  if (orphan.length) {
    fail.push(
      `บล็อกกฎ 🔴 ที่ไม่ได้บอกว่าอยู่ไฟล์ไหน ${orphan.length} บล็อก — session ถัดไปหาของไม่เจอ\n` +
      orphan.map(b => `   ${b[0].trim().slice(0, 70)}`).join('\n') +
      `\n   → ใส่ \`path/ของไฟล์\` หรือ \`ชื่อฟังก์ชัน()\` ที่เป็นเจ้าของกฎในบล็อกนั้น`
    );
  }
}

// ── 6. เตือนล่วงหน้า (ไม่บล็อก) ──────────────────────────────────────────
// ชนเพดานกลางงานแล้วค่อยรีด = รีดแบบรีบ ตัดของที่ยังต้องใช้ ⇒ บอกตั้งแต่ยังมีที่เหลือ
if (kb > WARN_KB && kb <= LIMIT_KB) {
  const top = [...sections].sort((a, b) => sizeOf(b) - sizeOf(a)).slice(0, 5);
  const evidence = md.split('\n').filter(l =>
    /เคยเกิด|เคยทำพัง|เคสจริง|วัดจริง|เดิมก๊อป|เดิมเดา/.test(l)
    || /\d[\d,.]*\s*(%|ใบ|แถว|นาที|ชม\.|tokens)/.test(l)).length;
  console.warn(
    `\n⚠️  เหลือที่ ${(LIMIT_KB - kb).toFixed(1)} KB ก่อนชนเพดาน — เริ่มรีดตั้งแต่ตอนนี้ (ยังไม่บล็อก)\n` +
    `   บรรทัดที่มีตัวเลขผลรัน/ประวัติ (ย้ายไปโมดูลได้): ~${evidence} บรรทัด\n` +
    top.map(s => `   ${sizeOf(s).toFixed(1)} KB · ${s.head.slice(0, 58)}`).join('\n') + '\n'
  );
}

if (fail.length) {
  console.error(`\n❌ ด่าน context บวม ไม่ผ่าน ${fail.length} ข้อ:\n`);
  fail.forEach((m, i) => console.error(`${i + 1}. ${m}\n`));
  process.exit(1);
}
console.log('✅ ผ่าน — ไม่มี @import · ไม่มี CLAUDE.md ซ้อน');
