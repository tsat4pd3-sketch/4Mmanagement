/* ── <MatLabel> — เลข MAT + ชื่องาน + Part No. รูปแบบเดียวกันทั้งระบบ  (2026-09-24 · feedback หน้างาน) ──

   ใช้แทนการวาด `{row.mat_no}` เปล่าๆ ทุกที่ที่หน้างานต้องรู้ว่า "เลขนี้คือชิ้นงานอะไร"
   เหตุผล/ตัวเลขที่วัดได้ + กฎ "ค่าบนแถวชนะ master" → `src/utils/matLabel.js`

   🔴 ลำดับตายตัวทั้งระบบ = **Part No. → Part Name → MAT SAP** (2026-09-30 · คำสั่ง user)
       MB3B 8C306 BC · BRACKET RR · MAT 10100379
       └ เด่นสุด (mono)  └ ชื่องาน    └ รหัสภายใน (มีป้าย MAT กำกับ ห้ามโชว์เลขเปล่า)
   เหตุผล + กฎ "ค่าบนแถวชนะ master" → `src/utils/matLabel.js`

   ⚠️ ทะเบียนโหลดไม่ทัน / ไม่รู้จัก MAT นี้ = โชว์เลข MAT เฉยๆ (พฤติกรรมเดิมเป๊ะ) **ห้ามโชว์ "-" หรือซ่อนเลข**
   ⚠️ **ห้ามตัด MAT ออกเพราะ "ย้ายไปท้ายแล้วดูไม่สำคัญ"** — เป็นคีย์ที่ผูกข้อมูลทั้งระบบ
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
 * @param {number} [size]     ฟอนต์ของตัวเด่น (Part No. · default 12 · ขั้นต่ำจอ TV 11 ตาม UI §4)
 * @param {boolean} [showPartNo] ปิดได้เมื่อที่แคบจริงๆ (default true)
 * @param {object} [style]    style เพิ่มของกล่องนอก
 */
export default function MatLabel({ mat, name, pNo, size = 12, showPartNo = true, style }) {
  const index = useMatIndex();
  const i = matInfo(mat, index, { name, pNo });
  if (!i.mat) return null;
  const small = Math.max(11, size - 0.5);
  /* ตัวแรกที่ได้โชว์ = ตัวเด่น (ฟอนต์เต็ม + เข้ม) — ปกติคือ Part No.
     ไม่มี Part No. (หรือถูกปิดด้วย showPartNo) ⇒ ชื่องานขึ้นเป็นตัวเด่นแทน แล้ว MAT ต่อท้ายเหมือนเดิม
     **ห้ามให้บรรทัดว่าง** — MAT โชว์เสมอ */
  const lead = showPartNo && i.pNo ? 'pNo' : (i.name ? 'name' : 'mat');
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap', minWidth: 0, ...style }}>
      {showPartNo && i.pNo && (
        <span title="Part No. ของลูกค้า" style={{ fontSize: size, fontFamily: 'monospace', fontWeight: 700, color: 'var(--text2)' }}>{i.pNo}</span>
      )}
      {i.name && (
        <span style={{ fontSize: lead === 'name' ? size : small, fontWeight: lead === 'name' ? 700 : 400, color: lead === 'name' ? 'var(--text2)' : 'var(--muted)' }}>
          {lead === 'name' ? '' : '· '}{i.name}
        </span>
      )}
      <span title="เลข MAT (SAP) — รหัสภายในที่ใช้ผูกข้อมูลทั้งระบบ"
        style={{ fontSize: lead === 'mat' ? size : small, fontFamily: 'monospace',
          fontWeight: lead === 'mat' ? 700 : 400, color: lead === 'mat' ? 'var(--text2)' : 'var(--muted)',
          opacity: lead === 'mat' ? 1 : 0.85 }}>
        {lead === 'mat' ? '' : '· '}MAT {i.mat}
      </span>
    </span>
  );
}
