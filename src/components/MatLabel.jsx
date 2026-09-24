/* ── <MatLabel> — เลข MAT + ชื่องาน + Part No. รูปแบบเดียวกันทั้งระบบ  (2026-09-24 · feedback หน้างาน) ──

   ใช้แทนการวาด `{row.mat_no}` เปล่าๆ ทุกที่ที่หน้างานต้องรู้ว่า "เลขนี้คือชิ้นงานอะไร"
   เหตุผล/ตัวเลขที่วัดได้ + กฎ "ค่าบนแถวชนะ master" → `src/utils/matLabel.js`

   รูปแบบ (ตรงกับที่ SearchSelect เลือก MAT.NO ใน DailyReport ใช้อยู่แล้ว — ห้ามคิดใหม่):
       10100379 · BRACKET RR · [MB3B 8C306 BC]
       └ mono      └ ชื่องาน     └ Part No. ลูกค้า ในวงเล็บเหลี่ยม

   ⚠️ ทะเบียนโหลดไม่ทัน / ไม่รู้จัก MAT นี้ = โชว์เลข MAT เฉยๆ (พฤติกรรมเดิมเป๊ะ) **ห้ามโชว์ "-" หรือซ่อนเลข**
*/
import { useMemo } from 'react';
import useProducts from '../utils/useProducts';
import { buildMatIndex, matInfo } from '../utils/matLabel';

/* index ผูกกับ "ก้อน products" ที่ cachedMaster คืนมา (reference เดียวทั้งแอป)
   ⇒ สร้างจริงครั้งเดียว ต่อให้ component นี้ถูก mount เป็นร้อยตัวในลิสต์เดียว */
const INDEX_CACHE = new WeakMap();
function indexOf(products) {
  if (!products?.length) return null;
  let idx = INDEX_CACHE.get(products);
  if (!idx) { idx = buildMatIndex(products); INDEX_CACHE.set(products, idx); }
  return idx;
}

/** hook สำหรับหน้าที่ต้องใช้ข้อความ MAT ในที่ที่วาด JSX ไม่ได้ (toast/confirm/export) */
export function useMatIndex() {
  const { products } = useProducts();
  return useMemo(() => indexOf(products), [products]);
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
      <span style={{ fontSize: size, fontFamily: 'monospace', fontWeight: 700, color: 'var(--text2)' }}>{i.mat}</span>
      {i.name && <span style={{ fontSize: small, color: 'var(--muted)' }}>· {i.name}</span>}
      {showPartNo && i.pNo && (
        <span title="Part No. ของลูกค้า" style={{ fontSize: small, fontFamily: 'monospace', color: 'var(--muted)', opacity: 0.85 }}>· [{i.pNo}]</span>
      )}
    </span>
  );
}
