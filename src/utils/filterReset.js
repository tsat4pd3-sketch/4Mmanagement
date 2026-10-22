/* ═══ 🧹 ล้างตัวกรอง — กฎกลางของปุ่ม "ล้างตัวกรอง" ทุกหน้า ═══════════  2026-10-22 · คำสั่ง user
   *"ขอปุ่มล้างตัวกรองด้วยได้มั้ย และควรจะมีทุกหน้านะที่มีระบบกรอง"*

   🔴 แยก 2 อย่างให้ขาด — พารามิเตอร์ใน URL มี 2 ชนิด **ล้างพร้อมกันไม่ได้**:
     · "ดูอะไรอยู่"  (`?tab=` `?die=` `?fx=` `?asset=` `?dept=` `?mo=`) = **ตัวเลือกหน้า/ระเบียน**
       ล้างทิ้ง = เด้งไปหน้าอื่น/ปิด drawer ที่เปิดอยู่ = ไม่ใช่สิ่งที่คนกดปุ่มนี้ต้องการ ⇒ **เก็บไว้**
     · ที่เหลือ = **ตัวกรอง** (ช่วงเวลา · ไลน์ · ขอบเขต · สถานะ · คำค้น ฯลฯ) ⇒ ล้างได้
   🔴 ไม่มีอะไรให้ล้าง = **ไม่วาดปุ่ม** (ปุ่มที่กดแล้วไม่เกิดอะไรทำให้คนเลิกเชื่อปุ่ม)
   ⚠️ หน้าที่เก็บตัวกรองไว้ใน React state (ไม่ขึ้น URL) ต้องส่ง `onClear` มาเองเพิ่ม —
      กฎนี้ตอบได้แค่ส่วนที่อยู่ใน URL */

/** พารามิเตอร์ที่บอกว่า "กำลังดูอะไร" ไม่ใช่ "กรองยังไง" — ปุ่มล้างต้องไม่แตะ */
export const VIEW_PARAMS = ['tab', 'die', 'fx', 'asset', 'dept', 'mo'];

const names = (search) => {
  try { return [...new URLSearchParams(search || '').keys()]; } catch { return []; }
};

/**
 * ชื่อพารามิเตอร์ที่ปุ่มนี้จะล้าง (ไม่ซ้ำ · เรียงตามที่เจอ)
 * @param {string} search  เช่น `?tab=list&wait=close&from=2026-10-01`
 * @param {string[]} keep  ชื่อเพิ่มเติมที่หน้านั้นขอให้เก็บไว้
 */
export function clearableParams(search, keep = []) {
  const safe = new Set([...VIEW_PARAMS, ...(Array.isArray(keep) ? keep : [])]);
  const out = [];
  for (const k of names(search)) if (!safe.has(k) && !out.includes(k)) out.push(k);
  return out;
}

/** มีตัวกรองค้างอยู่ไหม — ใช้ตัดสินว่าจะวาดปุ่มหรือเปล่า */
export const hasActiveFilters = (search, keep = []) => clearableParams(search, keep).length > 0;

/**
 * สตริง search ใหม่หลังล้างตัวกรอง (คงพารามิเตอร์ "ดูอะไรอยู่" ไว้ครบ รวมค่าซ้ำ)
 * คืน `''` เมื่อไม่เหลืออะไร — ผู้เรียกเอาไปต่อท้าย pathname ได้ตรงๆ
 */
export function resetSearch(search, keep = []) {
  const safe = new Set([...VIEW_PARAMS, ...(Array.isArray(keep) ? keep : [])]);
  let sp;
  try { sp = new URLSearchParams(search || ''); } catch { return ''; }
  const next = new URLSearchParams();
  for (const [k, v] of sp.entries()) if (safe.has(k)) next.append(k, v);
  const s = next.toString();
  return s ? `?${s}` : '';
}
