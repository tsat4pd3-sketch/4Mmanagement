/* ── <MatLabel> — เลข MAT + ชื่องาน + Part No. รูปแบบเดียวกันทั้งระบบ  (2026-09-24 · feedback หน้างาน) ──

   ใช้แทนการวาด `{row.mat_no}` เปล่าๆ ทุกที่ที่หน้างานต้องรู้ว่า "เลขนี้คือชิ้นงานอะไร"
   เหตุผล/ตัวเลขที่วัดได้ + กฎ "ค่าบนแถวชนะ master" → `src/utils/matLabel.js`

   🔴 ลำดับ (2026-09-30 · คำสั่ง user "เอาให้ฟอร์แมทเดียวกัน") — **Part No. → Part Name → MAT SAP**:
       MB3B 8C306 BC · BRACKET RR · MAT 10100379
       └ Part No. ลูกค้า  └ ชื่องาน    └ เลข SAP (mono · มีคำว่า MAT นำ)
   เหตุผล: Part No. คือเลขที่ใช้ร่วมกันทั้งลูกค้า/แบบ/PE/ผลิต · MAT SAP ยังต้องอยู่ครบและเป็น mono
   เพราะ**บาร์โค้ดบนกล่อง/บัตรคัมบังคือ mat_no** (ด่านสแกนใน PickScanModal เทียบ mat_no)
   ⇒ ห้ามตัด MAT ทิ้ง และห้ามเรียงสลับเฉพาะบางหน้า — ลำดับนี้ต้องเหมือนกันทุกจอ รวม `matText()`

   ⚠️ ทะเบียนโหลดไม่ทัน / ไม่รู้จัก MAT นี้ = โชว์เลข MAT เฉยๆ (พฤติกรรมเดิมเป๊ะ) **ห้ามโชว์ "-" หรือซ่อนเลข**
*/
import { useMemo } from 'react';
import useProducts from '../utils/useProducts';
import useChildParts from '../utils/useChildParts';
import { buildMatIndex, matInfo } from '../utils/matLabel';

/* index ผูกกับ "ก้อน products" + "ก้อน parts_master" ที่ cachedMaster คืนมา (reference เดียวทั้งแอป)
   ⇒ สร้างจริงครั้งเดียว ต่อให้ component นี้ถูก mount เป็นร้อยตัวในลิสต์เดียว
   ใช้ WeakMap ซ้อน 2 ชั้น (products → childParts → index) เพราะคีย์เป็น "อาร์เรย์ 2 ก้อน"
   — ก้อนไหนถูกโหลดใหม่ ชั้นนั้นก็หลุด cache เอง ไม่ต้องล้างมือ */
const INDEX_CACHE = new WeakMap();
const EMPTY = Object.freeze([]);   // reference คงที่ ใช้เป็นคีย์ตอนยังโหลดไม่เสร็จ
function indexOf(products, childParts) {
  const a = products?.length ? products : EMPTY;
  const b = childParts?.length ? childParts : EMPTY;
  if (a === EMPTY && b === EMPTY) return null;
  let inner = INDEX_CACHE.get(a);
  if (!inner) { inner = new WeakMap(); INDEX_CACHE.set(a, inner); }
  let idx = inner.get(b);
  if (!idx) { idx = buildMatIndex(a, b); inner.set(b, idx); }
  return idx;
}

/** hook สำหรับหน้าที่ต้องใช้ข้อความ MAT ในที่ที่วาด JSX ไม่ได้ (toast/confirm/export) */
export function useMatIndex() {
  const { products } = useProducts();
  // พาร์ทลูก (2xx/3xx/5xx) อยู่ `parts_master` คนละทะเบียน — ไม่รวมเข้ามา = ฝั่งสโตร์ไม่มี Part No. เลย
  const childParts = useChildParts();
  return useMemo(() => indexOf(products, childParts), [products, childParts]);
}

/**
 * @param {string} mat        เลข MAT
 * @param {string} [name]     ชื่อที่ "แถวนั้นเก็บไว้เอง" (เช่น prod_orders.part_name) — ชนะทะเบียน
 * @param {string} [pNo]      Part No. ที่แถวเก็บไว้เอง (เช่น bom_items.part_no)
 * @param {number} [size]     ฟอนต์ของเลข MAT (default 12 · ขั้นต่ำจอ TV 11 ตาม UI §4)
 * @param {boolean} [showPartNo] ปิดได้เมื่อที่แคบจริงๆ (default true)
 * @param {object} [style]    style เพิ่มของกล่องนอก
 */
export default function MatLabel({ mat, name, pNo, size = 12, showPartNo = true, style }) {
  const index = useMatIndex();
  const i = matInfo(mat, index, { name, pNo });
  if (!i.mat) return null;
  const small = Math.max(11, size - 0.5);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap', minWidth: 0, ...style }}>
      {showPartNo && i.pNo && (
        <span title="Part No. ของลูกค้า" style={{ fontSize: size, fontFamily: 'monospace', fontWeight: 700, color: 'var(--text2)' }}>{i.pNo}</span>
      )}
      {i.name && <span style={{ fontSize: small, color: 'var(--muted)' }}>{(showPartNo && i.pNo) ? `· ${i.name}` : i.name}</span>}
      {/* MAT SAP อยู่ท้าย แต่ **ห้ามตัดทิ้ง** — เป็นเลขบนบาร์โค้ดกล่อง/บัตรคัมบังที่ด่านสแกนเทียบ */}
      <span title="เลข MAT (SAP)" style={{ fontSize: small, fontFamily: 'monospace', color: 'var(--muted)', opacity: 0.85 }}>
        {(i.pNo || i.name) ? '· ' : ''}MAT {i.mat}
      </span>
    </span>
  );
}
