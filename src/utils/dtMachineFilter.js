/* 🤖 ประเภท Downtime → ประเภทเครื่องที่เกี่ยวข้อง (2026-11-09 · คำสั่ง user)
   *"ลงปัญหาโรบอทเบรคดาวน์ เครื่องจักรที่ขึ้นให้เลือกก็ควรเป็นโรบอท ให้สอดคล้องกัน ไม่ใช่ขึ้นทุกเครื่องของไลน์"*
   ทะเบียน = `dr_downtime_types.machine_type_ids` (คนติ๊กเองที่ /daily-report แท็บตั้งค่า → ประเภท Downtime)
   🔴 ว่าง/null = ไม่จำกัด (เกิดได้กับทุกเครื่อง) = พฤติกรรมเดิม · **ห้ามเดาจากคำในชื่อ**
   🔴 เครื่องที่ยังไม่ระบุประเภท (`machine_type_id` ว่าง) ไม่เข้ากลุ่มที่กรอง — จอต้องมีทาง "แสดงทุกเครื่อง" เสมอ */

/** ชุด id ประเภทเครื่องของประเภท DT นี้ — null = ไม่จำกัด */
export function dtMachineTypeIds(dtType) {
  const ids = Array.isArray(dtType?.machine_type_ids) ? dtType.machine_type_ids.filter(Boolean).map(String) : [];
  return ids.length ? new Set(ids) : null;
}

/** เครื่องนี้เข้ากับประเภท DT ไหม (ids = ผลจาก dtMachineTypeIds) */
export function machineFitsDtType(machine, ids) {
  if (!ids) return true;
  return machine?.machine_type_id != null && ids.has(String(machine.machine_type_id));
}

/** ค่าที่จะเก็บลงฐานจากช่องติ๊ก — ไม่ติ๊กเลย = null (ไม่จำกัด) ห้ามเก็บ [] */
export function machineTypeIdsForDb(list) {
  const ids = [...new Set((list || []).filter(Boolean).map(String))];
  return ids.length ? ids : null;
}
