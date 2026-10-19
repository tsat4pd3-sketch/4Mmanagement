/* 🗂️ ตัวกรองจอแผน PM (`/pm?tab=schedule` ปฏิทินแผน · `/pm?tab=forecast` PM ล่วงหน้า) — 2026-10-19 audit หน้า PM
   pure · กติกาเดียวกับลิสต์อุปกรณ์ในจอตั้งค่า (`pmEquipList.js`) แต่รับแถวหน้าตาไหนก็ได้ผ่าน getter

   🔴 แถวที่ไลน์ว่าง/ไม่อยู่ในทะเบียน **ห้ามหายเงียบ** (CLAUDE.md "ตะกร้ารับท้ายลิสต์")
      เลือกกรองไลน์อยู่ = หลุดจากผลกรอง ⇒ คืน `droppedNoLine` ให้จอเขียนว่าหลุดกี่แผน */

const norm = (v) => String(v ?? '').trim().toLowerCase()

/**
 * @param rows
 * @param opt.q          คำค้น — เทียบกับทุกค่าที่ `getText(row)` คืน (array)
 * @param opt.scopeNames ชื่อไลน์ในขอบเขตที่เลือก (จาก <LineScopeSelect> รวมไลน์ลูกแล้ว) · null/ว่าง = ไม่กรองไลน์
 * @param opt.known      Set ของชื่อไลน์ในทะเบียน (norm แล้ว — ใช้ `lineKnownSet` จาก pmEquipList.js)
 * @param opt.getLine    row → ชื่อไลน์
 * @param opt.getText    row → [ข้อความที่ค้นได้]
 * @param opt.keep       row → boolean (ตัวกรองสถานะของหน้า) · ไม่ส่ง = ผ่านหมด
 * @returns { rows, droppedNoLine }
 */
export function filterPlanRows(rows, { q = '', scopeNames = null, known = null, getLine, getText, keep } = {}) {
  const needle = norm(q)
  const scope = scopeNames && scopeNames.length ? new Set(scopeNames.map(norm)) : null
  let droppedNoLine = 0
  const out = (rows || []).filter(r => {
    if (keep && !keep(r)) return false
    if (needle && !(getText ? getText(r) : []).some(v => norm(v).includes(needle))) return false
    if (scope) {
      const ln = norm(getLine ? getLine(r) : '')
      if (!scope.has(ln)) {
        if (!ln || (known && !known.has(ln))) droppedNoLine++
        return false
      }
    }
    return true
  })
  return { rows: out, droppedNoLine }
}
