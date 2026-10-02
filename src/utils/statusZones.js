/* ═══ 🗂️ แบ่งคิวงานเป็น "โซนตามสถานะ" (2026-10-02 · feedback หน้างานสโตร์)

   *"แถบสีบ่งชี้ดูยาก และ box status เรียกแล้ว, กำลังเตรียม ก็ไม่สะดุดตาเท่าไหร่
     อยากให้แยกโซนเลยด้วยซ้ำถ้ามันเหมาะสมกว่า"*

   เดิมคิว (คิวเติม WIP / Store Child / Raw Mat) เรียงการ์ดทุกสถานะปนกันในกริดเดียว
   ⇒ สถานะอ่านได้จากแถบซ้าย 3px + ป้ายเล็ก **ต่อใบ** · คนต้องอ่านทีละใบว่าใบไหนอยู่ขั้นไหน
   ⇒ แยกเป็นโซน = ตอบ "ขั้นนี้มีกี่ใบ · ต้องทำอะไรต่อ" ได้ด้วยการมองครั้งเดียว

   กติกา:
   1. **ห้ามทิ้งแถวเงียบ** — สถานะที่ไม่อยู่ในโซนไหน ตกโซน `__other` ("สถานะอื่น") ไม่ใช่หายไป
   2. ลำดับโซน = ลำดับที่ผู้เรียกส่งมา (ผู้เรียกตัดสินว่างานในมือมาก่อนงานใหม่)
   3. pure — ไม่แตะ DB/React · เทส `__tests__/statusZones.test.mjs`
   ═══════════════════════════════════════════════════════════════════════════════ */

export const OTHER_ZONE = '__other';

/**
 * @param {Array} rows
 * @param {Array<{key:string, statuses:string[], label:string, color:string, hint?:string}>} zones
 * @param {(row:any)=>string} statusOf
 * @returns {Array<{key, label, color, hint, rows:Array}>} ทุกโซนที่ส่งมา (ว่างได้) + โซนสถานะอื่นเมื่อมีแถวตก
 */
export function groupByZone(rows, zones = [], statusOf = (r) => r?.status) {
  const out = zones.map(z => ({ ...z, rows: [] }));
  const at = new Map();
  out.forEach((z, i) => (z.statuses || []).forEach(s => { if (!at.has(s)) at.set(s, i); }));
  const other = [];
  for (const r of rows || []) {
    const i = at.get(statusOf(r));
    if (i == null) other.push(r); else out[i].rows.push(r);
  }
  if (other.length) {
    out.push({ key: OTHER_ZONE, statuses: [], label: '❔ สถานะอื่น', color: '#64748b',
      hint: 'สถานะที่บอร์ดนี้ไม่รู้จัก — แจ้งผู้ดูแลระบบ', rows: other });
  }
  return out;
}

/** สีตัวอักษรบนพื้นสีทึบ — คิดจากความสว่างของสีพื้น (#rrggbb) · อ่านไม่ออก = ขาว */
export function textOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // จุดตัดที่ทำให้ความต่างกับดำ = ความต่างกับขาว (≈0.179)
  return L > 0.179 ? '#0b1220' : '#ffffff';
}
