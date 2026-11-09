/* 🤖 ประเภท Downtime → เครื่องที่เกี่ยวข้อง (2026-11-09 · คำสั่ง user)
   *"ลงปัญหาโรบอทเบรคดาวน์ เครื่องจักรที่ขึ้นให้เลือกก็ควรเป็นโรบอท ให้สอดคล้องกัน ไม่ใช่ขึ้นทุกเครื่องของไลน์"*
   ทะเบียน (คนติ๊กเองที่ /daily-report แท็บตั้งค่า → ประเภท Downtime) มี 2 ช่อง — **OR กัน**:
     · `dr_downtime_types.machine_type_ids` — ประเภทเครื่อง (`machines.machine_type_id`) เช่น Robot / Jig fixture
     · `dr_downtime_types.equipment_kinds`  — ชนิดอุปกรณ์ (`machines.equipment_kind` · `kindOf()`) เช่น แม่พิมพ์
       (แม่พิมพ์ 270/276 ตัวไม่มีประเภทเครื่อง ⇒ ต้องผูกด้วยชนิด)
   🔴 ว่างทั้งคู่ = ไม่จำกัด (เกิดได้กับทุกเครื่อง) = พฤติกรรมเดิม · **ห้ามเดาจากคำในชื่อ**
   🔴 เครื่องที่ไม่เข้าเกณฑ์ (เช่น ยังไม่ระบุประเภท) ไม่ขึ้นในลิสต์ที่กรอง — จอต้องมีทาง "แสดงทุกเครื่อง" เสมอ */
import { kindOf } from './equipmentKinds.js';

/** กฎของประเภท DT นี้ — null = ไม่จำกัด · { ids:Set, kinds:Set } */
export function dtMachineRule(dtType) {
  const ids = Array.isArray(dtType?.machine_type_ids) ? dtType.machine_type_ids.filter(Boolean).map(String) : [];
  const kinds = Array.isArray(dtType?.equipment_kinds) ? dtType.equipment_kinds.filter(Boolean).map(String) : [];
  return ids.length || kinds.length ? { ids: new Set(ids), kinds: new Set(kinds) } : null;
}

/** เครื่องนี้เข้ากับประเภท DT ไหม (rule = ผลจาก dtMachineRule) */
export function machineFitsDtType(machine, rule) {
  if (!rule) return true;
  if (machine?.machine_type_id != null && rule.ids.has(String(machine.machine_type_id))) return true;
  return rule.kinds.size > 0 && rule.kinds.has(kindOf(machine?.equipment_kind));
}

/** ค่าที่จะเก็บลงฐานจากช่องติ๊ก — ไม่ติ๊กเลย = null (ไม่จำกัด) ห้ามเก็บ [] */
export function idsForDb(list) {
  const ids = [...new Set((list || []).filter(Boolean).map(String))];
  return ids.length ? ids : null;
}
