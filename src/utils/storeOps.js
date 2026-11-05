/* 🔀 แยก "จอดูสัญญาณ" กับ "จอทำรายการ" ของสโตร์ (2026-11-04 · คำสั่ง user)
   user: *"หน้าตู้ heijunka ยอดงานจะต้องไม่วิ่งผ่านหน้านี้ หน้านี้เป็นแค่ monitor เรื่องสัญญาณ KANBAN"* ·
   *"ย้ายไป line-stock · จัดซื้อแยกแท็บ"*
   · `/heijunka` (HeijunkaKanban mode='monitor') = ดูอย่างเดียว
   · `/line-stock?tab=store` = ตู้งานสโตร์ (ขากับไลน์ผลิต) · `/line-stock?tab=purchase` = จัดซื้อ (ขา supplier → รับเข้าสโตร์)
   ไฟล์นี้แยกจาก HeijunkaKanban เพื่อให้ LineStock lazy-load หน้านั้นได้โดยไม่ดึงทั้งก้อนมาตั้งแต่แรก */
export const OPS_STORES_WORK = ['child', 'ext', 'raw', 'fg', 'open', 'plating', 'rack', 'other'];   // 04/11 เลิกแท็บ 'wip' — ใบไปอยู่ตู้ตามเลขพาร์ท (storeOfMat)   // 'open' = แจ้งล่วงหน้าจากใบที่ไลน์เปิด (อ่านอย่างเดียว · 04/11)
export const OPS_STORES_BUY = ['purchase'];

/* 🗂️ ใบเบิก-ส่งพาร์ทเข้าไลน์ ไปอยู่ตู้ไหน — ตามเลขพาร์ท (2026-11-04 · คำสั่ง user)
   user: *"tab คิวเติม WIP ยกเลิกเลย ให้ย้ายไปเข้าแต่ละสโตร์ 2xx ก็ store child part เปลี่ยนคำเป็น store semi part,
          5xx ไป store raw mat และ 3xx เพิ่มไปเข้า tab ใหม่ store purchase part / สโตร์ภายนอก"* · *"1xx งาน FG"*
   🔴 เลขอื่น/ว่าง = 'other' (ตะกร้ารับท้าย — ห้ามหายจากจอ) · ตัดสินที่นี่ที่เดียว ห้ามเทียบ charAt(0) เองในหน้า */
export const MAT_STORE = { 1: 'fg', 2: 'child', 3: 'ext', 5: 'raw' };
export function storeOfMat(mat) {
  const c = String(mat ?? '').trim().charAt(0);
  return MAT_STORE[c] || 'other';
}
/** ตู้ที่ "ใบเบิก-ส่งเข้าไลน์" ไปลงได้ (ใช้แทนแท็บ 'wip' เดิม) */
export const WIP_STORES = ['fg', 'child', 'ext', 'raw', 'other'];
