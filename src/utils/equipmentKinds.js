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
/* 🔴 2026-10-05 — รายชื่อรูปแบบชุดย้ายไปทะเบียน DR `die_set_kinds` แล้ว (คำสั่ง user:
   ทีมแม่พิมพ์ต้องเพิ่ม HYDROFORM DIE / BEND DIE เอง + "ศัพท์ทางการ user หน้างานไม่เข้าใจ")
   · โหลดผ่าน `useDieSetKinds()` (src/utils/useDieSetKinds.js) · จัดการที่ /equipment?tab=die แผง ⚙️
   · `DIE_SET_KINDS` ด้านล่าง = **ค่าสำรองตอนยังไม่ apply migration เท่านั้น** ห้ามเอาไปวาด dropdown ตรงๆ อีก
     (มีด่าน `die-set-kinds-from-registry` ใน regressionGuards) — เพิ่มรูปแบบใหม่ = เพิ่มแถวในทะเบียน ไม่ใช่แก้ไฟล์นี้
   tandem = หลายแม่พิมพ์ เรียง OP10/OP20/... คนละเครื่องปั๊ม ← "1/4 2/4 3/4 4/4" · progressive = บล็อกเดียว หลาย station
   transfer = เครื่องเดียว หลาย station มีแขนย้ายชิ้น · single = OP เดียวจบ */
export const DIE_SET_KINDS = [
  { key: 'tandem',      label: 'Tandem (ชุดเรียง OP)',   desc: 'หลายแม่พิมพ์ เรียง OP คนละเครื่องปั๊ม', mo_item_type: 'DIE TANDEM' },
  { key: 'progressive', label: 'Progressive (ต่อเนื่อง)', desc: 'บล็อกเดียว หลาย station ป้อนม้วนเหล็ก', mo_item_type: 'DIE PROGRESSIVE' },
  { key: 'transfer',    label: 'Transfer',                desc: 'เครื่องเดียว หลาย station มีแขนย้ายชิ้น', mo_item_type: 'DIE TRANSFER' },
  { key: 'single',      label: 'Single (OP เดียว)',       desc: 'จบในแม่พิมพ์ตัวเดียว', mo_item_type: 'DIE SINGLE' },
]

/** แถวทะเบียน (DB: description) → รูปเดียวกับค่าสำรอง (desc) */
export const normDieSetKind = (r) => ({
  key: r.key, label: r.label || r.key, desc: r.desc ?? r.description ?? '',
  mo_item_type: r.mo_item_type || null, is_active: r.is_active !== false, sort_order: r.sort_order ?? 100,
})

/** ป้ายของรูปแบบชุด — ไม่รู้จัก key = โชว์ key ดิบ (ไม่หายเงียบ) · ว่าง = '—'
 *  kinds ไม่ส่ง = ใช้ค่าสำรอง (ที่เรียกแบบเดิม dieSetKindLabel(v) ยังทำงาน) */
export const dieSetKindLabel = (v, kinds = DIE_SET_KINDS) =>
  (kinds || []).find(k => k.key === v)?.label || v || '—'

/** ตัวเลือก dropdown รูปแบบชุด — เฉพาะที่เปิดใช้ + **ค่าปัจจุบันของชุดเสมอ แม้ถูกปิดใช้/ไม่มีในทะเบียน**
 *  (select ที่ value ไม่อยู่ใน option จะโชว์ตัวแรกแล้ว "บันทึกทับเงียบ" — กันไว้ที่นี่) */
export function dieSetKindOptions(kinds, current) {
  const list = (kinds || []).filter(k => k.is_active !== false)
  if (current && !list.some(k => k.key === current)) {
    const hit = (kinds || []).find(k => k.key === current)
    list.push({ key: current, label: hit ? `${hit.label} (ปิดใช้แล้ว)` : `⚠ ${current} (ไม่มีในทะเบียน)`, desc: hit?.desc || '', stale: true })
  }
  return list
}

/** key ของรูปแบบชุดใหม่ — สร้างจากชื่อให้อัตโนมัติ (คนหน้างานไม่ต้องคิดรหัส)
 *  "HYDROFORM DIE" → "hydroform_die" · ชื่อไทยล้วนแปลงไม่ได้ → "k_<เวลา base36>" (ไม่ซ้ำ ไม่ต้องสวย — คนเห็นแต่ label)
 *  ⚠️ key = ค่าที่ die_sets.kind เก็บ ⇒ สร้างครั้งเดียวตอนเพิ่ม ห้ามเปลี่ยนตาม label ทีหลัง */
export function dieSetKindKey(row, now = Date.now()) {
  const slug = String(row?.label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  return slug || `k_${Number(now).toString(36)}`
}

/** ใบแจ้งซ่อมแม่พิมพ์: เลขแม่พิมพ์ → "ชนิดอุปกรณ์" (mtn_item_types.name) จากทะเบียน
 *  2 ชั้น (06/10 · คอมเมนต์ทีม DIE): **ประเภท OP ของแม่พิมพ์รายตัว ชนะ รูปแบบชุด**
 *    เพราะ HDF 1 ชุด (Single) มีแม่พิมพ์ HYDRO/BENDING/PREFORM — ชนิดเป็นของ "ตัว" ไม่ใช่ของ "ชุด"
 *    1) equipment_die.op_type → die_op_types.mo_item_type
 *    2) equipment_die.die_set_id → die_sets.kind → die_set_kinds.mo_item_type
 *  คืน null เมื่อชี้ไม่ได้ทั้ง 2 ชั้น — **ห้ามเดา** ให้ผู้แจ้งเลือกเองตามเดิม · เทียบเลขแบบ trim+uppercase
 *  @param links    [{ machine_no, kind, op_type }]
 *  @param kinds    แถว die_set_kinds (normDieSetKind) · @param opTypes แถว die_op_types {key,label,mo_item_type} */
export function buildDieItemTypeMap(links, kinds, opTypes = []) {
  const byKey = new Map((kinds || []).map(k => [k.key, k]))
  const byOp = new Map((opTypes || []).map(o => [o.key, o]))
  const out = new Map()
  for (const l of links || []) {
    const no = String(l?.machine_no ?? '').trim().toUpperCase()
    if (!no || (!l.kind && !l.op_type)) continue
    const k = l.kind ? byKey.get(l.kind) : null
    const op = l.op_type ? byOp.get(l.op_type) : null
    const fromOp = op?.mo_item_type || null
    out.set(no, {
      kindKey: l.kind || null, kindLabel: l.kind ? (k?.label || l.kind) : null,
      opKey: l.op_type || null, opLabel: l.op_type ? (op?.label || l.op_type) : null,
      itemType: fromOp || k?.mo_item_type || null,
      source: fromOp ? 'op' : (k?.mo_item_type ? 'set' : null),
    })
  }
  return out
}
export const dieItemTypeOf = (map, machineNo) =>
  map?.get(String(machineNo ?? '').trim().toUpperCase()) || null

/** ป้าย OP ของแม่พิมพ์ในชุด เช่น "2/4" — ไม่รู้ลำดับ/ไม่ใช่ tandem = null */
export const opBadge = (opSeq, opTotal) => {
  if (opSeq == null) return null
  // op_seq ในข้อมูลจริงเป็นเลข OP (10/20/30/40) ไม่ใช่ลำดับ — แปลงเป็นลำดับตอนแสดง
  return opTotal ? `${Math.max(1, Math.round(opSeq / 10))}/${opTotal}` : `OP${opSeq}`
}
