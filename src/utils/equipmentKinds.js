// ชนิดอุปกรณ์ (equipment kind) — แกนที่บอกว่า "ของชิ้นนี้คืออะไร" (2026-08-10)
//
// ⚠️ อ่านก่อนแก้: ทำไมไม่แยกเป็น 3 ตาราง (machines / jigs / dies)
//   `machines` เป็น "ตารางตัวตนของอุปกรณ์" อยู่แล้ว — machine_no unique · MO / downtime /
//   prod_orders / QR / ผังเครื่องจักร อ้างด้วยเลขนี้ทั้งหมด (12+ ตาราง)
//   แยกเป็นหลายตาราง = ทุกตารางที่อ้างอุปกรณ์ต้อง polymorphic + QR ต้องเพิ่ม prefix ต่อชนิด
//   และทำลายหัวใจของระบบซ่อมบำรุงรวมคือ "เปิดอุปกรณ์ตัวนี้ เห็นประวัติทั้งหมด"
//   → ใช้ **1 ตัวตน + แกนชนิด + ตารางส่วนขยายต่อชนิด** (โมเดลเดียวกับ SAP PM / Maximo)
//     รายละเอียดเชิงลึกของแม่พิมพ์อยู่ `equipment_die` · ของชนิดอื่นเพิ่มตารางส่วนขยายแบบเดียวกัน
//   **แยก "หน้าจอ" ได้เต็มที่ — แยกหน้าจอ ≠ แยกฐานข้อมูล**
//
// ⚠️ คนละแกนกับ `equipment_category` (production / facility = ที่ตั้ง/การใช้งาน)
//   เครื่องจักรอยู่ facility ได้ · แม่พิมพ์อยู่ production — สองแกนนี้ตัดกัน ห้ามยุบรวม

export const EQUIPMENT_KINDS = [
  { key: 'machine',  icon: '🏭', label: 'เครื่องจักร',       desc: 'เครื่องที่ตั้งอยู่กับที่ในไลน์ผลิต' },
  { key: 'die',      icon: '🔨', label: 'แม่พิมพ์',          desc: 'ทูลลิ่งที่เอาไปติดบนเครื่องปั๊ม — มีชุด/OP/นับ shot' },
  { key: 'jig',      icon: '🧩', label: 'จิ๊ก / ฟิกเจอร์',   desc: 'อุปกรณ์จับยึดชิ้นงานที่สถานี' },
  { key: 'facility', icon: '🔧', label: 'Facility / Utility', desc: 'ระบบสาธารณูปโภค — ลม น้ำ ไฟ ความเย็น' },
]
export const KIND_META = Object.fromEntries(EQUIPMENT_KINDS.map(k => [k.key, k]))
/** null/ไม่รู้จัก = เครื่องจักร (ค่าเดิมก่อนมีแกนนี้ — backward-compatible) */
export const kindOf = (v) => (KIND_META[String(v || '').trim()] ? String(v).trim() : 'machine')
export const kindLabel = (v) => KIND_META[kindOf(v)].label
export const kindIcon  = (v) => KIND_META[kindOf(v)].icon
export const isDie = (v) => kindOf(v) === 'die'

/** machines.equipment_kind → jigs.equipment_type ของ "แถวเงา"
 *  ⚠️ ตาราง jigs รับได้แค่ jig/die/machine (constraint) — "อยู่ในโซน facility"
 *     บอกด้วย equipment_category แยกต่างหาก สองแกนนี้ตัดกัน ห้ามยัดรวม
 *  ⚠️ แถวเงาเป็น **สำเนา** ของเครื่องจริง ห้ามตั้ง equipment_type อิสระ
 *     (เคยตั้งเองแล้วเพี้ยน: เครื่องอัดลม/คูลลิ่งทาวเวอร์ 9 ตัวกลายเป็น 'jig') */
export const jigEquipTypeOf = (equipmentKind) => {
  const k = kindOf(equipmentKind)
  return k === 'die' || k === 'jig' ? k : 'machine'
}

// ── แม่พิมพ์: รูปแบบของชุด ────────────────────────────────────────────────
// tandem     = 1 พาร์ทใช้หลายแม่พิมพ์ เรียง OP10/OP20/... คนละเครื่องปั๊ม  ← "1/4 2/4 3/4 4/4"
// progressive= บล็อกเดียว หลาย station ป้อนม้วนเหล็ก 1 stroke ทุก station ทำงานพร้อมกัน
// transfer   = เครื่องปั๊มเดียว หลาย station มีแขนย้ายชิ้นงาน
// single     = OP เดียวจบ
export const DIE_SET_KINDS = [
  { key: 'tandem',      label: 'Tandem (ชุดเรียง OP)',   desc: 'หลายแม่พิมพ์ เรียง OP คนละเครื่องปั๊ม' },
  { key: 'progressive', label: 'Progressive (ต่อเนื่อง)', desc: 'บล็อกเดียว หลาย station ป้อนม้วนเหล็ก' },
  { key: 'transfer',    label: 'Transfer',                desc: 'เครื่องเดียว หลาย station มีแขนย้ายชิ้น' },
  { key: 'single',      label: 'Single (OP เดียว)',       desc: 'จบในแม่พิมพ์ตัวเดียว' },
]
export const dieSetKindLabel = (v) =>
  DIE_SET_KINDS.find(k => k.key === v)?.label || v || '—'

/** ป้าย OP ของแม่พิมพ์ในชุด เช่น "2/4" — ไม่รู้ลำดับ/ไม่ใช่ tandem = null */
export const opBadge = (opSeq, opTotal) => {
  if (opSeq == null) return null
  // op_seq ในข้อมูลจริงเป็นเลข OP (10/20/30/40) ไม่ใช่ลำดับ — แปลงเป็นลำดับตอนแสดง
  return opTotal ? `${Math.max(1, Math.round(opSeq / 10))}/${opTotal}` : `OP${opSeq}`
}
