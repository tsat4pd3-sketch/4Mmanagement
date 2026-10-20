/* 🔐 NPI ชั้นสิทธิ์ที่ 3 — "แถวนี้เป็นของไลน์ในขอบเขตเราไหม" (กฎเดียว · แผงลูกห้ามคิดเอง)
   พาร์ท NPI ผูกไลน์ที่ `npi_parts.line_name` ⇒ ตัวตัดสินจริงคือ `canWriteLine` ของหน้าแม่
   ที่ส่งลงมาเป็น `partWriteOf(lineName)` (หน้าแม่รู้ ctx + ทะเบียนไลน์อยู่แล้ว ไม่ต้องส่ง 2 ก้อน)

   🔴 ไม่ส่ง `partWriteOf` มา / แถวไม่ผูกพาร์ท / พาร์ทไม่ระบุไลน์ = **ตัดสินไม่ได้ ⇒ ไม่บล็อก**
      (คงพฤติกรรมเดิม · `canWriteLine` คืน `unknown_target` ซึ่ง ok = true โดยดีไซน์)
   🔴 ลบโปรเจค = ลบพาร์ท/เอกสาร/ECI/tooling ทั้งก้อน (FK cascade) ⇒ ต้องแก้ได้ **ทุกพาร์ท**
      และ **นับพาร์ทไม่ได้ = ห้ามลบ** (fail-closed · กฎเขียน DB ข้อ 2 "ลบได้หลังนับปลายทางครบ") */
import { writeBlockText } from './writeScope.js';

/** ไลน์ของพาร์ท (ref = id หรือแถวที่มี part_id/id) · หาไม่เจอ = null (ไม่เดา) */
export function npiLineOfPart(parts, ref) {
  const id = (ref && typeof ref === 'object') ? (ref.part_id ?? ref.id) : ref;
  if (id === null || id === undefined || id === '') return null;
  const row = (parts || []).find(p => String(p?.id) === String(id));
  return row?.line_name ?? null;
}

/** ข้อความบล็อกของแถวที่ผูกไลน์นี้ · ผ่าน = null */
export function npiBlock(partWriteOf, lineName, what = 'พาร์ทของไลน์นี้') {
  if (typeof partWriteOf !== 'function') return null;
  const w = partWriteOf(lineName ?? null);
  return (w && !w.ok) ? writeBlockText(w, { what }) : null;
}

/** ข้อความบล็อกของแถวที่อ้างพาร์ท (ไล่หาไลน์จากทะเบียนพาร์ทก่อน) · ผ่าน = null */
export const npiBlockForPart = (partWriteOf, parts, ref, what) =>
  npiBlock(partWriteOf, npiLineOfPart(parts, ref), what);

/** ลบโปรเจคได้ไหม — ต้องแก้ได้ทุกพาร์ทใต้โปรเจค · `countable:false` (อ่านพาร์ทไม่สำเร็จ) = ห้ามลบ */
export function npiProjectDeleteBlock(partWriteOf, parts, { countable = true } = {}) {
  if (!countable) {
    return 'ยังลบโปรเจคไม่ได้ — ระบบอ่านรายการพาร์ทในโปรเจคนี้ไม่สำเร็จ จึงตัดสินไม่ได้ว่าทุกพาร์ท'
      + 'อยู่ในขอบเขตที่คุณรับผิดชอบไหม · โหลดหน้าใหม่แล้วลองอีกครั้ง';
  }
  if (typeof partWriteOf !== 'function') return null;
  const bad = (parts || []).filter(p => {
    const w = partWriteOf(p?.line_name ?? null);
    return w && !w.ok;
  });
  if (!bad.length) return null;
  const names = [...new Set(bad.map(p => p.line_name).filter(Boolean))].slice(0, 3).join(', ');
  return `ลบโปรเจคนี้ไม่ได้ — มีพาร์ท ${bad.length} รายการที่อยู่นอกขอบเขตของคุณ`
    + `${names ? ` (ไลน์ ${names})` : ''} · ให้เจ้าของไลน์นั้นลบพาร์ทของเขาก่อน`
    + ' หรือเปลี่ยนสถานะโปรเจคเป็น "ยกเลิก" แทน (เก็บประวัติไว้)';
}
