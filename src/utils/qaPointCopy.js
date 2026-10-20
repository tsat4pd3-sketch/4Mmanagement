/* 📋 แปลงจุดตรวจ QA ต้นทาง → แถวที่จะ insert ให้พาร์ทปลายทาง (2026-10-19 · pure — ใช้ใน `src/lib/qaPointsCopy.js`)
   หลักเดียวกับฝั่ง PM `utils/pmCheckpointCopy.js` (คัดลอกข้ามเครื่อง) — 📄 docs/modules/inspection-point-setup.md

   🔴 ตำแหน่งหมุด (`pos_x`/`pos_y`/`label_dx`/`label_dy`/`drawing_id`) ผูกกับ "แผ่นแบบของพาร์ทต้นทาง"
      ⇒ ปลายทางไม่ได้ใช้แผ่นชุดเดียวกัน = **ล้างหมุดทิ้ง** ให้ QA ปักใหม่บนแบบของพาร์ทนั้น
      (คงไว้ = หมุดลอยตรงตำแหน่งไม่มีความหมาย หรือหาแผ่นไม่เจอแล้วหายจากใบตรวจ)
   · คัดลอกแผ่นแบบไปด้วย (`drawingMap` = id แผ่นต้นทาง → id แผ่นใหม่) = แบบเดียวกัน ⇒ เก็บหมุดไว้
     — จุดเก่าที่ `drawing_id` ว่าง = อยู่แผ่นแรก (พฤติกรรมเดิม) ซึ่งก็คือแผ่นแรกที่เพิ่งคัดลอก ⇒ คงว่างได้
   · รูปโคลสอัพ: ตัวเรียกคัดลอกไฟล์เข้าโฟลเดอร์ของพาร์ทปลายทางแล้วส่ง path ใหม่มา
     **ห้ามแชร์ path ข้ามพาร์ท** — ลบพาร์ทต้นทาง = ลบทั้งโฟลเดอร์ `parts/<id>` (`QAInspectionSetup.delPart`)
     และโมดัลแก้ไขลบไฟล์ของจุดที่ถูกเอาออก ⇒ แชร์ = รูปของอีกพาร์ทหายตาม */
import { remapCalc } from './inspectCalc.js'

export const QA_PIN_FIELDS = ['pos_x', 'pos_y', 'label_dx', 'label_dy', 'drawing_id']

/* 🧮 `idMap` (id ต้นทาง → id ใหม่ที่ตั้งไว้ก่อน insert) — จุดคำนวณ A − B ต้องชี้จุดของปลายทาง
   ไม่ส่ง = ไม่ตั้ง id และตัดสูตรทิ้ง (ห้ามชี้ id ของพาร์ทต้นทาง) */
export function qaItemCopyRow(item, { targetPartId, drawingMap = null, imagePath = null, idMap = null } = {}) {
  // eslint-disable-next-line no-unused-vars
  const { id, created_at, part_id, image_path, ...rest } = item || {}
  const row = { ...rest, part_id: targetPartId, image_path: imagePath || null }
  if (idMap?.[id]) row.id = idMap[id]
  if ('calc' in row) row.calc = remapCalc(row.calc, idMap)
  const keepPins = !!drawingMap && (row.drawing_id == null || drawingMap[row.drawing_id] != null)
  if (keepPins) {
    if (row.drawing_id != null) row.drawing_id = drawingMap[row.drawing_id]
  } else {
    for (const k of QA_PIN_FIELDS) row[k] = null
  }
  return row
}

/** path ใหม่ในโฟลเดอร์ของพาร์ทปลายทาง — คงชื่อไฟล์เดิม (รู้ที่มา) + ป้าย `tag` กันชนกับไฟล์ที่มีอยู่ */
export function qaCopyPath(srcPath, targetPartId, tag) {
  const base = String(srcPath || '').split('/').pop()
  if (!base || !targetPartId) return null
  return `parts/${targetPartId}/c${tag}-${base}`
}

/** เหตุผลที่ข้าม — ข้อความเดียวกันทุกจอ (ห้ามสรุปรวมเป็น "สำเร็จ" ก้อนเดียว) */
export const QA_COPY_SKIP = {
  same: 'พาร์ทต้นทาง',
  empty: 'ต้นทางไม่มีจุดตรวจ',
  target_has_points: 'มีจุดตรวจอยู่แล้ว',
  error: 'ผิดพลาด',
}
