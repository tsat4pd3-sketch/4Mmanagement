/* ══ 🧹 ClearFiltersBtn — ปุ่ม "ล้างตัวกรอง" มาตรฐาน ═══════════  2026-10-22 · คำสั่ง user
   *"ขอปุ่มล้างตัวกรองด้วยได้มั้ย และควรจะมีทุกหน้านะที่มีระบบกรอง"*

   🔴 **ห้ามวาดปุ่มนี้เองในหน้า** — ฝังอยู่ใน <FilterBar> และ <TimeRangeBar> แล้ว ทุกหน้าได้ฟรี
   🔴 ไม่มีตัวกรองค้าง = ไม่วาดปุ่ม (ปุ่มที่กดแล้วไม่เกิดอะไร ทำให้คนเลิกเชื่อปุ่ม)
   🔴 ไม่แตะพารามิเตอร์ "ดูอะไรอยู่" (`?tab=` `?mo=` …) — กฎอยู่ `utils/filterReset.js` ที่เดียว
   ⚠️ หน้าที่เก็บตัวกรองไว้ใน React state (ไม่ขึ้น URL) ส่ง `onClear` มาเพิ่มเพื่อรีเซ็ต state ด้วย */
import { useLocation, useNavigate } from 'react-router-dom';
import { clearableParams, resetSearch } from '../utils/filterReset';

export default function ClearFiltersBtn({ keep, onClear, label = 'ล้างตัวกรอง' }) {
  const loc = useLocation();
  const nav = useNavigate();
  const hit = clearableParams(loc.search, keep);
  // `onClear` = หน้ามีตัวกรองใน state ด้วย ⇒ ต้องโชว์ปุ่มแม้ URL ไม่มีอะไรค้าง
  if (!hit.length && !onClear) return null;
  return (
    <button
      type="button"
      className="tbtn"
      onClick={() => {
        if (hit.length) nav({ pathname: loc.pathname, search: resetSearch(loc.search, keep) }, { replace: true });
        onClear?.();
      }}
      title={hit.length ? `ล้าง: ${hit.join(' · ')}` : label}
      style={{
        height: 'var(--ctl-h)', padding: '0 10px', fontSize: 'var(--ctl-fs)',
        borderRadius: 8, border: '1px solid var(--border)',
        background: 'var(--bg2)', color: 'var(--text2)', cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >🧹 {label}</button>
  );
}
