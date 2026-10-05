/* ═══ partGroup — "พาร์ทเดียวกันข้ามลูกค้า" = กลุ่มเดียวกัน (ย้ายออกจาก oee.js 2026-10-05) ═══
   คำสั่ง user 05/10: *"มันต่างแค่ลูกค้าไง แต่ product มันคือตัวเดียวกันเลย
   แค่ต้องแยกเพราะเวลาขายจะต้องแยกบิล แยกรหัส และแยก mat SAP"*
   ⇒ "MAT หลายตัว = สินค้าตัวเดียว" เป็นกฎระดับโดเมน ไม่ใช่ของ OEE อย่างเดียว:
   ชั้น OP (`pairTotals.collapseOps`) ต้องตัดสินด้วยกฎเดียวกัน แต่ `oee.js` import
   `pairTotals.js` อยู่แล้ว ⇒ ให้ pairTotals ดึง oee = วงกลม ⇒ แยกเป็นโมดูล pure ตัวนี้
   🔴 `oee.js` re-export ทั้ง 2 ตัวต่อ — ที่เรียกเดิม (`from '../utils/oee'`) ต้องใช้ได้เหมือนเดิม
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/* ═══ 7) จับกลุ่ม "ชิ้นงานเดียวกัน" — ใช้ตรวจ parallel ใน computeOEE ═══════════════════════
   ปัญหาที่แก้ (2026-09-09 · ทวนสอบกับ Excel หน้างาน ดู docs/OEE-EXCEL-VERIFY-2026-09-09.md):
   พาร์ทตัวเดียวกันที่แตก MAT ตาม **ลูกค้า/เรฟวิชั่น** ถูกตีเป็นคนละ product เพราะจับกลุ่มด้วย
   "ชื่อ product" ซึ่งสะกดไม่ตรงกันในทะเบียน:
     10105769 REINF ASY RAD SUPT LWR(306)(AAT)          RB3B-8C306-BC
     10105770 REINF ASY RAD SUPT LWR(RB3B-8C306-BC)     RB3B-8C306-BC
     10100381 REINF ASY RAD SUPT LWR (FVL)              RB3B-8C306-BB
     20066630 REINF ASY RAD LWR(MB3B-8C306-BA)ก่อนแพ็ก  MB3B - 8C306 - BA
   → 4 กลุ่ม → window ทับกัน → isParallel = true → ตัวหาร %P เปลี่ยน → P เพี้ยน
   (Assy LWR 06/08 กะดึก P 71.8 ที่ควรเป็น ~92.5 · 31/08 กะดึก 71.0 ที่ควรเป็น ~96.6)

   ⭐ กติกา: **ชื่อเดียวกัน "หรือ" เลขพาร์ทแกนกลางเดียวกัน = กลุ่มเดียวกัน (union)**
   ใช้ union ไม่ใช่เปลี่ยนคีย์ เพื่อให้กลุ่ม "หยาบขึ้นได้อย่างเดียว ห้ามละเอียดขึ้น" —
   ทุกคู่ที่เคยรวมกันด้วยชื่อยังรวมเหมือนเดิม (ไม่มีไลน์ไหนพฤติกรรมแย่ลงกว่าเดิม)
   และการรวมกลุ่มกระทบเฉพาะ heuristic `isParallel` เท่านั้น — ตัวหารของไลน์ parallel_machine
   (`Σ g.runMin`) ไม่เปลี่ยนค่า เพราะเป็นผลรวมข้ามทุกกลุ่มอยู่แล้ว

   ⚠️ ห้ามใช้ `family_id` เป็นคีย์ — วัดจริง 09/09: 145 สินค้า / 142 family = family คือ
   "MAT ตัวเดียวกันข้ามเรฟ" (คู่กับ effective_from/superseded_by) ไม่ใช่ "พาร์ทเดียวกันข้ามลูกค้า" */

/** แกนกลางของเลขพาร์ท: 'RB3B-8C306-BC' / 'MB3B - 8C306 - BA' → '8C306'
 *  ตัดตัวคั่นทุกแบบ แล้วเอา token กลาง (prefix รุ่นรถ + suffix เรฟ ต่างกันได้ในพาร์ทเดียวกัน)
 *  เข้าเงื่อนไขเฉพาะเมื่อ token กลางเป็นเลขพาร์ทจริง (≥3 ตัว + มีตัวเลข) ไม่งั้นคืนทั้งก้อน
 *  เพื่อไม่ให้ฟอร์แมตแปลกๆ ('SP-83', 'MB3BE102D04BC') ถูกรวมมั่ว */
export function partCoreOf(pNo) {
  const toks = String(pNo || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (!toks.length) return '';
  if (toks.length >= 3) {
    const mid = toks.slice(1, -1).join('');
    if (mid.length >= 3 && /\d/.test(mid)) return mid;
  }
  return toks.join('');
}

/** rows = [{ matNo, name, pNo }] → { [matNo]: groupKey }
 *  MAT ที่ไม่มีทั้งชื่อและเลขพาร์ท จะอยู่กลุ่มของตัวเอง (พฤติกรรมเดิม) */
export function groupSameProductKeys(rows = []) {
  const parent = {};
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const add = (x) => { if (parent[x] === undefined) parent[x] = x; return x; };

  rows.forEach(r => {
    const self = add(`MAT:${r.matNo}`);
    const nm = String(r.name || '').trim().toUpperCase();
    if (nm) union(self, add(`NM:${nm}`));
    const core = partCoreOf(r.pNo);
    if (core) union(self, add(`PN:${core}`));
  });

  const out = {};
  rows.forEach(r => { out[r.matNo] = find(`MAT:${r.matNo}`); });
  return out;
}

