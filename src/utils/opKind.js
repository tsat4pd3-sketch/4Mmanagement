/* ═══ 🔩 ชนิดของ "ขั้นตอน (OP)" — กฎกลาง (pure · มีเทส) ═══════════════════════════════
   ที่มา (user 2026-09-16 · วาดรูปมืออธิบายมาให้):
     🔁 sequence  Part A + nut ×3 → "Part A ที่มีนัทแล้ว"   (no mat SAP, just OP)
                  ของที่ออกมา **ยังเป็น Part A ตัวเดิม** ⇒ ตอบได้ว่าเป็นขั้นของใคร
                  ⇒ ต้องมี `op_parent_mat` ไม่งั้น `collapseOps` ยุบยอดไม่ได้ = นับซ้ำ
     🧩 assembly  Part B + Part C → ของใหม่ 1 ชิ้น          (no mat SAP, just OP)
                  ของที่ออกมา **ไม่ใช่ทั้ง B และ C** ⇒ คำถาม "เป็นขั้นของใคร" ไม่มีคำตอบ
                  ⇒ `op_parent_mat` ต้องว่าง · ยอดนับตรงๆ ไม่ยุบเข้าใคร

   🔴 เหตุผลที่ต้องแยก ไม่ใช่แค่เรื่องคำพูด:
      `collapseOps` (pairTotals.js) มี `if (present.has(parent)) return;` ⇒ ขั้นที่ชี้ parent ผิด
      จะ **ถูกทิ้งยอดทั้งก้อนเงียบๆ** ทันทีที่พาร์ทที่ชี้ไปมีใบผลิตของตัวเอง
      (เคสจริง `FENDER`/291+088 ชี้ไป `30052451` ซึ่งเป็นแค่ 1 ใน 2 พาร์ทขาเข้าของมันเอง — 45 ใบ)

   ⚠️ **ห้ามเดาชนิดจากข้อมูล** — "parent เป็นชิ้นส่วนใน BOM ของขั้นตัวเอง" เป็นเรื่อง**ปกติ**
      ของ sequence (ขั้นกิน Part A เข้าไปแล้วคาย Part A ที่มีนัท · 8/18 ขั้นเป็นแบบนี้)
      สิ่งที่แยก 2 แบบคือ "มีพาร์ทจริงกี่ตัวเป็นขาเข้า" ซึ่งระบบแยก nut ออกจากพาร์ทไม่ได้ ⇒ ให้คนเลือก
   ═══════════════════════════════════════════════════════════════════════════════════════ */

const norm = (s) => (s ?? '').toString().trim().toUpperCase();

export const OP_KIND = { SEQ: 'sequence', ASM: 'assembly' };

export const OP_KIND_META = {
  [OP_KIND.SEQ]: {
    icon: '🔁', label: 'ขั้นต่อเนื่องบนพาร์ทเดิม',
    hint: 'ของที่ออกมายังเป็นพาร์ทตัวเดิม แค่ถูกทำอะไรเพิ่ม (ขับนัท/เชื่อมสตั๊ด/ดัด) — ต้องระบุว่าเป็นขั้นของพาร์ทไหน',
  },
  [OP_KIND.ASM]: {
    icon: '🧩', label: 'ขั้นประกอบหลายชิ้นเป็นของใหม่',
    hint: 'เอาพาร์ทตั้งแต่ 2 ตัวมาประกอบจนได้ของใหม่ที่ยังไม่มีเลข SAP — ไม่ต้องระบุพาร์ทแม่ (สูตรอยู่ใน BOM ของขั้นนี้)',
  },
};

/** ขั้นแบบนี้ต้องมี op_parent_mat ไหม */
export const kindNeedsParent = (kind) => kind !== OP_KIND.ASM;

/**
 * ขั้นนี้ยัง "ค้างให้คนมาเลือก" ไหม — ใช้คุม worklist
 * assembly = ตั้งใจไม่มี parent แล้ว ห้ามเตือนต่อ (ไม่งั้นแถบเตือนไม่มีวันหาย คนเลิกเชื่อแถบเตือน)
 */
export function opNeedsParentPick(item) {
  if (!item?.is_operation) return false;
  if (item.op_kind === OP_KIND.ASM) return false;
  return !norm(item.op_parent_mat);
}

/**
 * ตรวจความขัดแย้งของขั้น 1 ตัว — คืน [] = ไม่มีปัญหา
 * @param {object} item        { is_operation, op_kind, op_parent_mat, mat_no }
 * @param {string[]} ownBomMats mat ของ component ในสูตรของขั้นนี้ ([] = ยังไม่ผูก/ไม่รู้)
 * @returns {Array<{level:'crit'|'warn', text:string}>}
 */
export function opKindIssues(item, ownBomMats = []) {
  if (!item?.is_operation) return [];
  const out = [];
  const parent = norm(item.op_parent_mat);
  const kind = item.op_kind || null;

  if (kind === OP_KIND.ASM && parent) {
    out.push({ level: 'crit', text:
      `ขั้นประกอบไม่ควรมีพาร์ทแม่ แต่ยังชี้ไป ${item.op_parent_mat} — ยอดของขั้นนี้เสี่ยงถูกยุบหายเข้าพาร์ทนั้น` });
  }
  if (kind === OP_KIND.SEQ && !parent) {
    out.push({ level: 'crit', text:
      'ขั้นต่อเนื่องต้องระบุพาร์ทแม่ — ไม่งั้นยอดผลิตของชิ้นเดียวกันถูกนับซ้ำทุกขั้น' });
  }
  /* parent ที่ "ไม่ได้อยู่ในสูตรของขั้นตัวเอง" = ขั้นอ้างว่าทำงานบนพาร์ทที่มันไม่ได้กินเข้าไป
     เตือนอย่างเดียว ไม่ฟันธง — สูตรอาจยังกรอกไม่ครบ (ownBomMats ว่าง = ข้ามไปเลย) */
  if (kind === OP_KIND.SEQ && parent && ownBomMats.length &&
      !ownBomMats.some(m => norm(m) === parent)) {
    out.push({ level: 'warn', text:
      `พาร์ทแม่ ${item.op_parent_mat} ไม่อยู่ในสูตรของขั้นนี้ — ปกติขั้นต่อเนื่องต้องกินพาร์ทแม่เข้าไปด้วย` });
  }
  return out;
}
