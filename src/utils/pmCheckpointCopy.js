/* 📋 แปลงจุดตรวจต้นทาง → แถวที่จะ insert ให้ปลายทาง (2026-10-14 · pure — ใช้ใน `src/lib/pmChecklists.js`)

   🔴 ตำแหน่งหมุด (`x_pos`/`y_pos`/`label_dx`/`label_dy`/`image_id`) ผูกกับ "รูปของเครื่องต้นทาง"
      ⇒ คัดลอก **ข้ามเครื่อง** ต้องล้างทิ้ง ให้ช่างปักใหม่บนรูปของเครื่องปลายทาง
      (เดิมก๊อปไปด้วย: จอตั้งค่าโชว์หมุดบนรูปแรกของเครื่องใหม่ตรงตำแหน่งไม่มีความหมาย ·
       จอตรวจ `PMCheckData` หาเฟรมไม่เจอ = หมุดหายไปเลย · วัดจริง 14/10: 9 จุดบน 1 เครื่อง)
   · คัดลอก **ข้ามแผนกบนเครื่องเดิม** (`samePhotos`) = รูปชุดเดียวกัน ⇒ เก็บหมุดไว้ตามเดิม
   · `jig_id` = เครื่องเจ้าของจุดตรวจ ⇒ ต้องเป็นเครื่องปลายทาง (เดิมติดเลขเครื่องต้นทางมา)
   · รูปโคลสอัพรายจุด (`image_path`) ยังแชร์ path เดิม — การลบไฟล์ต้องผ่าน `orphanImagePaths()` อยู่แล้ว */
import { remapCalc } from './inspectCalc.js'

export const PIN_FIELDS = ['x_pos', 'y_pos', 'label_dx', 'label_dy', 'image_id']

/* 🧮 `idMap` (id ต้นทาง → id ใหม่ที่ตั้งไว้ก่อน insert) — จุดคำนวณ A − B ต้องชี้จุดของปลายทาง
   ไม่ส่ง = ไม่ตั้ง id และตัดสูตรทิ้ง (ห้ามชี้ id ของ checklist ต้นทาง) */
export function checkpointCopyRow(cp, { targetChecklistId, targetEquipmentId = null, samePhotos = false, idMap = null } = {}) {
  // eslint-disable-next-line no-unused-vars
  const { id, created_at, updated_at, updated_by_name, updated_by_uid, checklist_id, ...rest } = cp || {}
  const row = { ...rest, checklist_id: targetChecklistId }
  if (idMap?.[id]) row.id = idMap[id]
  if ('calc' in row) row.calc = remapCalc(row.calc, idMap)
  if (targetEquipmentId) row.jig_id = targetEquipmentId
  if (!samePhotos) for (const k of PIN_FIELDS) if (k in row) row[k] = null
  return row
}
