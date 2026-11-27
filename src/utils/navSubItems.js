/* ══ 📍 รายการของ "Detail Bar" ใต้ breadcrumb — รายการที่หน้ารู้ตอนรัน (2026-11-24 รอบ 4 · คำสั่ง user: S401/S403… อยู่ Detail Bar) ══
   แท็บ = ทะเบียนตายตัว `navSubTabs.js` (ข้อย่อยในแผงเมนู) · Detail Bar มาจากข้อมูลจริงของหน้า (เช่นพื้นที่ SAP ที่มีของในขอบเขตที่เห็น)
   ⇒ หน้าที่เปิดอยู่ประกาศผ่าน `useNavSubItems()` · `PageHeader` อ่านด้วย `useNavSubItemsStore()` แล้ววาดแถบ · หน้าปิด = ล้างเอง
   · ไม่ได้เปิดหน้านั้น = ไม่มีชั้นที่ 3 (ไม่เดารายการ) · item = { key, label } · กด = ตั้ง `?<query>=<key>` ที่หน้านั้น */
import { useEffect, useSyncExternalStore } from 'react';

let state = {};                 // `${path}|${tab}` → { query, items }
const subs = new Set();
const emit = () => subs.forEach(fn => fn());

export function setNavSubItems(path, tab, query, items, opts) {
  const k = `${path}|${tab}`;
  if (!items) { if (!(k in state)) return; const { [k]: _drop, ...rest } = state; state = rest; emit(); return; }
  // `all:false` (25/11 หน้ากิจกรรม) = รายการเป็น "ส่วนของหน้า" ไม่ใช่ตัวกรอง ⇒ ไม่มีปุ่ม "ทั้งหมด" · ไม่เลือก = ตัวแรก
  state = { ...state, [k]: { query, items, all: opts?.all !== false } };
  emit();
}

export function useNavSubItemsStore() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn); }, () => state, () => state);
}

/* `items` ต้องเป็นค่าที่ useMemo แล้ว · ส่ง null = ไม่มีชั้นที่ 3 ตอนนี้ */
export function useNavSubItems(path, tab, query, items, opts) {
  const sig = items ? items.map(i => `${i.key}\u0001${i.label}`).join('\u0002') : null;
  useEffect(() => {
    setNavSubItems(path, tab, query, items, opts);
    return () => setNavSubItems(path, tab, query, null);
  }, [path, tab, query, sig, opts?.all]);   // eslint-disable-line react-hooks/exhaustive-deps
}
