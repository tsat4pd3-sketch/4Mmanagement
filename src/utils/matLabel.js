/* ── matLabel — "เลข MAT ตัวเดียวบนจอ อ่านไม่ออกว่าเป็นชิ้นงานอะไร"  (2026-09-24 · feedback หน้างาน) ──

   ที่มา (feedback 23/09 สองใบในวันเดียว คนละหน้าจอ แต่เป็นอาการเดียวกัน):
     • สุทธวีร์  — /daily-report "Production order ที่เปิดค้างไว้ มองเห็นแค่เลข Material number
                   ทำให้ยากต่อการดูว่าคือชิ้นงานอะไร อยากให้แสดง Part name / Part number"
     • ณัฐวุฒิ   — /daily-report "เรียกชิ้นส่วนจากสโตร์ อยากให้โชว์ Part No. เพิ่มจาก Mat.SAP"

   ทำไมต้องเป็นของกลาง ไม่ใช่ปะ 2 จุด:
   เลข MAT ถูกโชว์เปล่าๆ อยู่ **หลายสิบจุดทั้งระบบ** (ใบผลิต · เรียกของ · ของเสีย · downtime · คิวสโตร์)
   ถ้าแก้ทีละจุดจะได้ 3 รูปแบบใน 3 หน้า แล้วคนถัดไปก็ยังโชว์ MAT เปล่าอยู่ดี
   ⇒ วาดผ่าน `<MatLabel>` (src/components/MatLabel.jsx) ที่กินฟังก์ชันในไฟล์นี้ — **จุดเดียว**

   🔴 ทำไมไม่ backfill คอลัมน์ `prod_orders.part_name` แทน (วัดจริง 24/09 · ใบ 30 วันล่าสุด):
       6,484 ใบ — มี part_name แค่ **927 ใบ (14%)** · เติมจาก master ได้อีก 5,557 ใบ (86%)
       · 6,447 ใบ (99.4%) มี p_no ใน master อยู่แล้ว · มีแค่ 1 ใบที่ไม่มีแถว master เลย
     คอลัมน์บนแถว = **snapshot ตอนเปิดใบ** ถ้า backfill วันนี้ พรุ่งนี้ master เปลี่ยนชื่อ → ค้างเป็นชื่อเก่าเงียบๆ
     ⇒ อ่านสดจากทะเบียน (`useProducts` — cache ก้อนเดียวทั้งแอป 168 แถว) แล้วให้ค่าบนแถวชนะเมื่อมี

   ⚠️ ค่าบนแถวชนะ master เสมอ — ไม่ใช่เพราะใหม่กว่า แต่เพราะมันคือ "ตอนเปิดใบเรียกว่าอะไร"
      (กฎเดียวกับ production_lines: ชื่อของตัวเองชนะไลน์แม่) · ไม่มีค่าบนแถวค่อยตกไป master
*/

/** กุญแจเทียบ MAT — trim + uppercase (MAT ในระบบเป็นเลข SAP/รหัสตัวพิมพ์ใหญ่ ไม่มีตัวคั่น) */
export const matKey = (m) => String(m ?? '').trim().toUpperCase();

/**
 * index จากทะเบียนสินค้า (`dr_products` ผ่าน useProducts) → Map<matKey, {name, p_no, customer}>
 *
 * ⚠️ mat_no ซ้ำได้ในทะเบียน (แถว OP / แถวเลิกใช้) — **แถว is_active ชนะ** แล้วค่อย first-win
 *    ไม่กรอง is_operation ทิ้งเหมือน buildPnIndex เพราะที่นี่ค้นด้วย mat_no (คีย์ของแถวนั้นเอง)
 *    ไม่ใช่ค้นด้วย p_no ที่ OP ไปใช้เลขซ้ำกับพาร์ทจริง ⇒ ไม่มีปัญหาผู้สมัครปลอม
 */
export function buildMatIndex(products) {
  const idx = new Map();
  for (const p of products || []) {
    const k = matKey(p?.mat_no);
    if (!k) continue;
    const prev = idx.get(k);
    if (prev && !(p?.is_active && !prev._active)) continue;   // แถวเดิมดีกว่าหรือเท่ากัน → คงไว้
    idx.set(k, {
      name: String(p?.name || '').trim(),
      p_no: String(p?.p_no || '').trim(),
      customer: String(p?.customer || '').trim(),
      _active: !!p?.is_active,
    });
  }
  return idx;
}

/**
 * รวมค่าที่จะโชว์ข้างเลข MAT
 * @param {string} mat      เลข MAT ที่จะโชว์
 * @param {Map}    index    ผลจาก buildMatIndex (ว่าง/undefined ได้ — ยังโหลดไม่เสร็จ)
 * @param {{name?:string, pNo?:string}} row  ค่าที่ "แถวนั้นเก็บไว้เอง" (เช่น prod_orders.part_name)
 * @returns {{mat:string, name:string, pNo:string, from:'row'|'master'|'mixed'|null}}
 *          from = ชื่อมาจากไหน (ไว้ให้จอ/เทสตรวจได้ว่าไม่ได้เดา) · null = ไม่รู้จัก MAT นี้
 */
export function matInfo(mat, index, row) {
  const m = String(mat ?? '').trim();
  const rowName = String(row?.name || '').trim();
  const rowPno = String(row?.pNo || '').trim();
  const hit = index?.get?.(matKey(m)) || null;

  const name = rowName || hit?.name || '';
  const pNo = rowPno || hit?.p_no || '';
  if (!name && !pNo) return { mat: m, name: '', pNo: '', from: null };

  const nameFrom = rowName ? 'row' : name ? 'master' : null;
  const pnoFrom = rowPno ? 'row' : pNo ? 'master' : null;
  const froms = [nameFrom, pnoFrom].filter(Boolean);
  return { mat: m, name, pNo, from: froms.every(f => f === froms[0]) ? froms[0] : 'mixed' };
}

/**
 * บรรทัดเดียวสำหรับที่ที่วาด JSX ไม่ได้ (toast · confirm · title · export Excel/PDF)
 * รูปแบบเดียวกับที่ `<MatLabel>` วาด: `10100379 · BRACKET RR · [MB3B 8C306 BC]`
 */
export function matText(mat, index, row) {
  const i = matInfo(mat, index, row);
  return [i.mat, i.name, i.pNo && `[${i.pNo}]`].filter(Boolean).join(' · ');
}
