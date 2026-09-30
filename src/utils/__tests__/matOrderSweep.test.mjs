/* ══════════════════════════════════════════════════════════════════════════
   🔢 ด่านลำดับการโชว์ชิ้นงาน = **Part No. → Part Name → MAT SAP**   2026-09-30

   คำสั่ง user: *"อยากให้เรียง part no. > part name > mat sap และเช็คทุกหน้าเลยที่โชว์พวกนี้"*

   ทำไมต้องมีด่าน ไม่ใช่แค่ไล่แก้ครั้งเดียว:
   ทั้งระบบมีจุดที่วาด 3 ค่านี้อยู่ **เกือบร้อยจุดใน ~60 ไฟล์** — ไล่แก้รอบเดียวแล้วไม่มีด่าน
   คนถัดไปที่เพิ่มการ์ด/ตารางใหม่ก็จะวาง MAT ไว้หน้าตามนิสัยเดิม แล้วจอในระบบจะเรียงไม่เหมือนกันอีก
   (บทเรียนเดียวกับ dropdown ไลน์ · พาเรโต · แถบช่วงเวลา ที่ต้องมีด่านถึงจะหยุด drift ได้จริง)

   วิธีตรวจ: ไล่อ่าน `src/**` (ยกเว้น `src/lib/` = ใบพิมพ์/export ที่ layout ล็อกตามฟอร์มกระดาษ)
   หา "นิพจน์ที่ถูกวาดออกจอ" `{…mat_no…}` / `{…part_name…}` / `{…p_no…}` ในหน้าต่าง 4 บรรทัด
   แล้วบังคับว่า **ห้ามมี MAT มาก่อน NAME หรือ PNO**

   ⚠️ ไม่ตรวจ:
     · `src/lib/**` — ใบพิมพ์/export ตรงฟอร์มทางการ (เรียงตามกระดาษ ห้ามสลับ · กฎ doc control)
     · prop ของ component (`mat={…}` `name={…}`) — ลำดับ prop ไม่ใช่ลำดับบนจอ
     · บรรทัดที่เป็น logic ไม่ใช่การวาด (`.filter(` · `=> ({` · `onChange={(`)
     · ไฟล์/บรรทัดใน ALLOW ข้างล่าง — ต้องมีเหตุผลเขียนกำกับเสมอ ห้ามยกเว้นลอยๆ
   ══════════════════════════════════════════════════════════════════════════ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (['node_modules', 'dist', '__tests__'].includes(e) || e.startsWith('.')) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(jsx|js)$/.test(e)) out.push(full);
  }
  return out;
}

/* นิพจน์ที่ถูกวาดออกจอ — ตัด prop ของ component ออกด้วย lookbehind (`mat={…}` ไม่นับ) */
const TOKEN = /(?<![A-Za-z0-9_$]=)\{\s*[A-Za-z0-9_$?.[\]]*?\b(mat_no|matNo|part_name|partName|p_no|pNo|part_no|partNo)\b[^}]*\}/g;
/* ชนิด = โทเคน **ตัวแรก** ในนิพจน์ ไม่ใช่ลำดับความสำคัญ — `{a.part_name || a.mat_no}` คือ NAME */
const FIRST = /\b(mat_no|matNo|part_name|partName|p_no|pNo|part_no|partNo)\b/;
const kindOf = (expr) => {
  const m = FIRST.exec(expr)[1];
  return /mat_no|matNo/.test(m) ? 'MAT' : /part_name|partName/.test(m) ? 'NAME' : 'PNO';
};
/* บรรทัดที่เป็น logic ไม่ใช่การวาด */
const NOT_RENDER = /\.filter\(|\.map\(\s*\(?\{|=>\s*\(\{|onChange=\{\(|\.some\(|\.find\(/;

/* ── ข้อยกเว้น: `ไฟล์` → { บรรทัด: เหตุผล } ──────────────────────────────
   ห้ามเพิ่มโดยไม่เขียนเหตุผล · เลขบรรทัดขยับได้ ⇒ ใช้ "ข้อความที่ต้องมีในหน้าต่าง" เป็นตัวจับแทน */
const ALLOW = [
  { file: 'src/components/BomTreeView.jsx', match: '{r.level > 1 &&',
    why: 'คอลัมน์ Component คือ "แกนต้นไม้ BOM" (มี └ + ระยะเยื้องตามชั้น) — ย้ายแล้วลำดับชั้นหายทั้งตาราง' },
  { file: 'src/components/MaterialRequests.jsx', match: '.toLowerCase().includes(q)',
    why: 'สตริงสำหรับ "ค้นหา" ไม่ใช่ข้อความบนจอ' },
  { file: 'src/components/QualityBins.jsx', match: 'setMatLocked(inReg)',
    why: 'handler ตอนเลือกจาก picker — ไม่ใช่การวาด' },
  { file: 'src/components/NpiPartPanel.jsx', match: 'PFC/FMEA/CP',
    why: 'MAT ของพาร์ท กับ part_no ของ "ชุดเอกสาร PE ที่ผูกไว้" เป็นคนละของ ไม่ใช่ป้ายชิ้นงานชุดเดียวกัน' },
  { file: 'src/components/PeRoutingSuggest.jsx', match: 'ผูกกับ MAT SAP:',
    why: 'ประโยคนี้มี MAT เป็นประธานโดยตรง ("ผูกกับ MAT SAP: …") — สลับแล้วอ่านไม่รู้เรื่อง' },
  { file: 'src/pages/ProductMaster.jsx', match: '— ชั้น 1 (ใต้',
    why: 'ข้อความ placeholder ของ <option> ที่อ้างถึงตัวแม่ FG ไม่ใช่ป้ายชิ้นงาน' },
];
const allowed = (rel, win) =>
  ALLOW.some(a => a.file === rel && win.includes(a.match));

test('ทุกจอเรียง Part No. → Part Name → MAT SAP (ห้าม MAT มาก่อน)', () => {
  const bad = [];
  for (const f of walk(join(ROOT, 'src'))) {
    const rel = relative(ROOT, f);
    if (rel.startsWith('src/lib/')) continue;            // ใบพิมพ์/export = layout ฟอร์มทางการ
    const lines = readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const win = lines.slice(i, i + 4).join('\n');
      if (/<(MatLabel|PartCard|QueueCard|ProductSelect|PartSelect)\b/.test(win)) continue;
      if (NOT_RENDER.test(win)) continue;
      const seq = [...win.matchAll(TOKEN)].map(m => kindOf(m[0]));
      const iMat = seq.indexOf('MAT');
      if (iMat === -1) continue;
      const after = seq.slice(iMat + 1);
      if (!after.includes('NAME') && !after.includes('PNO')) continue;
      if (allowed(rel, win)) { i += 3; continue; }
      bad.push(`${rel}:${i + 1}  [${seq.join(' > ')}]`);
      i += 3;
    }
  }
  assert.deepEqual(bad, [],
    '\n🔢 จอที่ยังวาง MAT SAP ไว้หน้า Part No./Part Name:\n' + bad.map(b => '   ' + b).join('\n')
    + '\n\n   กฎ (คำสั่ง user 2026-09-30): ลำดับบนจอต้องเป็น **Part No. → Part Name → MAT SAP**'
    + '\n   เลข MAT เป็นรหัสภายใน (SAP) — คนหน้างาน/ลูกค้าอ่าน Part No. ก่อนเสมอ'
    + '\n   วิธีแก้: ใช้ <MatLabel mat={…} name={…} /> (src/components/MatLabel.jsx) ซึ่งเรียงให้เอง'
    + '\n           · ตาราง = สลับทั้ง <th> และ <td> ให้ตรงกัน'
    + '\n           · MAT **ห้ามตัดทิ้ง** (เป็นคีย์ที่ผูกข้อมูลทั้งระบบ) ย้ายไปท้ายแล้วติดป้าย "MAT " กำกับ'
    + '\n   ยกเว้นจริงๆ ⇒ เพิ่มใน ALLOW ที่หัวไฟล์นี้ **พร้อมเหตุผล**\n');
});

test('ALLOW ทุกข้อต้องยังจับของจริงอยู่ (กันข้อยกเว้นค้างหลังโค้ดถูกแก้)', () => {
  const stale = ALLOW.filter(a => {
    let src;
    try { src = readFileSync(join(ROOT, a.file), 'utf8'); } catch { return true; }
    return !src.includes(a.match);
  }).map(a => `${a.file} :: "${a.match}"`);
  assert.deepEqual(stale, [],
    '\nข้อยกเว้นใน ALLOW ที่ไม่มีของจริงแล้ว — ลบทิ้ง:\n' + stale.join('\n'));
});
