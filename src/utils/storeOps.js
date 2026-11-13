/* 🔀 แยก "จอดูสัญญาณ" กับ "จอทำรายการ" ของสโตร์ (2026-11-04 · คำสั่ง user)
   user: *"หน้าตู้ heijunka ยอดงานจะต้องไม่วิ่งผ่านหน้านี้ หน้านี้เป็นแค่ monitor เรื่องสัญญาณ KANBAN"* ·
   *"ย้ายไป line-stock · จัดซื้อแยกแท็บ"*
   · `/heijunka` (HeijunkaKanban mode='monitor') = ดูอย่างเดียว
   · 05/11 (คำสั่ง user) แยกตามทิศ: `/line-stock?tab=out` 📤 ขาออก = สโตร์ → พื้นที่ผลิต ·
     `/line-stock?tab=in` 📥 ขาเข้า = supplier/พื้นที่ผลิต → สโตร์ (ใบขอซื้อ · ใบล็อตผลิต · รอรับเข้า · รับกลับจากร้านชุบ)
     ลิงก์เก่า `?tab=store`/`purchase`/`receipts` พาไปแท็บใหม่ให้ (LineStock LEGACY_TABS)
   ไฟล์นี้แยกจาก HeijunkaKanban เพื่อให้ LineStock lazy-load หน้านั้นได้โดยไม่ดึงทั้งก้อนมาตั้งแต่แรก */
export const OPS_STORES_OUT = ['child', 'ext', 'raw', 'fg', 'open', 'plating', 'rack', 'other'];   // 04/11 เลิกแท็บ 'wip' — ใบไปอยู่ตู้ตามเลขพาร์ท (storeOfMat)   // 'open' = แจ้งล่วงหน้าจากใบที่ไลน์เปิด (อ่านอย่างเดียว · 04/11)
export const OPS_STORES_IN = ['purchase', 'lots', 'receipts', 'plating_in'];

/* 🗂️ ใบเบิก-ส่งพาร์ทเข้าไลน์ ไปอยู่ตู้ไหน — ตามเลขพาร์ท (2026-11-04 · คำสั่ง user)
   user: *"tab คิวเติม WIP ยกเลิกเลย ให้ย้ายไปเข้าแต่ละสโตร์ 2xx ก็ store child part เปลี่ยนคำเป็น store semi part,
          5xx ไป store raw mat และ 3xx เพิ่มไปเข้า tab ใหม่ store purchase part / สโตร์ภายนอก"* · *"1xx งาน FG"*
   🔴 เลขอื่น/ว่าง = 'other' (ตะกร้ารับท้าย — ห้ามหายจากจอ) · ตัดสินที่นี่ที่เดียว ห้ามเทียบ charAt(0) เองในหน้า */
export const MAT_STORE = { 1: 'fg', 2: 'child', 3: 'ext', 5: 'raw' };
export function storeOfMat(mat) {
  const c = String(mat ?? '').trim().charAt(0);
  return MAT_STORE[c] || 'other';
}
/* 🚫 ไม่มี FG เข้าไลน์ (2026-11-13 · คำสั่ง user) — *"FG มันป้อนไลน์ประกอบไม่ได้ … คลังสินค้าเก็บแค่งานสำเร็จรูปพร้อมขาย
   หรืองานก่อนแพ็ค … ไม่มี FG เข้าไลน์"* ⇒ ใบเบิก-ส่งเข้าไลน์ (`wip_replenish_requests`) ห้ามเป็นเลข 1xx
   🔴 ทุกจุดที่ insert ใบเบิกเข้าไลน์ต้องถามตัวนี้ (ขอเอง · สโตร์ออกตามแผน · แตก BOM ตอนเปิดใบผลิต) — มีด่าน regressionGuards
   · ใบ 1xx เก่าที่มีอยู่แล้วไม่แตะ (ด่านนี้กันแค่ใบใหม่) */
export const isFgMat = (mat) => storeOfMat(mat) === 'fg';
export const FG_NO_LINE_REQUEST = 'เลข 1xx คือ FG (งานสำเร็จรูป) เก็บที่คลังสินค้ารอขาย — ไม่มีการเบิกเข้าไลน์ · ถ้าเป็นชิ้นส่วนให้ตรวจเลข MAT';

/** ตู้ที่ "ใบเบิก-ส่งเข้าไลน์" ไปลงได้ (ใช้แทนแท็บ 'wip' เดิม) */
export const WIP_STORES = ['fg', 'child', 'ext', 'raw', 'other'];
