/* ═══ 📈 SPC อุปกรณ์ — ค่าตัวเลขจากใบตรวจ AM/PM + ค่าชิม (2026-11-26 · คำสั่ง user) ═════════════════════════
   user เลือก 26/11: แท็บใน PM hub + ปุ่ม 📈 ที่ข้อ · ทุกข้อตัวเลขขึ้นอัตโนมัติ ปิดรายข้อได้ (`jig_checkpoints.spc_enabled`) ·
                     เส้นควบคุมคิดจากข้อมูล ครบ 20 จุดค่อยตัดสิน · หลุดการควบคุม = แสดงบนจอ (ยังไม่แจ้งเตือน)
   สูตร X̄-R / I-MR / Cp-Cpk = `computeSPC()` (src/utils/spcCalc.js) ตัวเดียวกับ SPC ของ QA — ไฟล์นี้แค่แปลงแถวผลตรวจเป็น subgroup
   🔴 pure — ตัวโหลดอยู่ `src/lib/equipSpcLoad.js`
   📄 docs/modules/equipment-spc.md */
import { computeSPC } from './spcCalc.js'

/** จำนวนจุดขั้นต่ำก่อน "ตัดสิน" (เส้นควบคุม/Cpk ถือเป็นค่าจริง) — ต่ำกว่านี้ = ชั่วคราว (user 26/11) */
export const SPC_MIN_POINTS = 20

/** ข้อนี้ขึ้นจอ SPC ไหม — ชนิดตัวเลข (variable/measure) + ไม่ถูกปิด */
export const isSpcCp = (cp) => !!cp && (cp.type === 'variable' || cp.type === 'measure') && cp.spc_enabled !== false

/** ค่าที่วัดของแถวผลตรวจหนึ่งแถว (subgroup) — variable = ค่า 1–3 ครั้งที่กรอก · measure = ค่าเดียว · ไม่มีค่า = [] */
export function readingsOf(cp, r) {
  if (!r) return []
  const nums = (arr) => arr.map(v => (v == null || v === '' ? null : Number(v))).filter(v => v != null && Number.isFinite(v))
  if (cp?.type === 'variable') return nums([r.value_1, r.value_2, r.value_3])
  return nums([r.value_numeric ?? r.value_1])
}

/** ขนาด subgroup ที่ใช้ = จำนวนค่าที่พบบ่อยสุด (เสมอกัน = ตัวมากกว่า) — แถวที่ขนาดไม่ตรงถูกตัดและนับใน `excluded` (กติกา computeSPC) */
export function subgroupSizeOf(rows = []) {
  const freq = {}
  for (const r of rows) { const k = r.readings.length; if (k) freq[k] = (freq[k] || 0) + 1 }
  let best = 0, bestN = 0
  for (const [k, n] of Object.entries(freq)) if (n > bestN || (n === bestN && Number(k) > best)) { best = Number(k); bestN = n }
  return best || 1
}

/**
 * ผลตรวจของข้อเดียว → ผล SPC + สถานะตัดสิน
 * @param {object} cp  จุดตรวจ (lsl/usl/type)
 * @param {{readings:number[], work_date:string, at?:string}[]} rows  เรียงเก่า→ใหม่
 * @returns {null | (ReturnType<computeSPC> & { provisional:boolean, nPoints:number, minPoints:number, subgroup:number, oocN:number })}
 *   provisional = จุดยังไม่ถึง 20 ⇒ จอห้ามตัดสิน in/out of control และห้ามโชว์ Cpk เป็นตัวเลขตัดสิน
 */
export function equipSpc(cp, rows = []) {
  const usable = (rows || []).filter(r => r.readings?.length)
  if (!usable.length) return null
  const n = subgroupSizeOf(usable)
  const res = computeSPC(usable, { subgroup_size: n, lsl: cp?.lsl ?? null, usl: cp?.usl ?? null })
  if (!res || res.allExcluded) return res
  const nPoints = res.points.length
  const provisional = nPoints < SPC_MIN_POINTS
  const oocN = provisional ? 0 : res.points.filter(p => p.oocX || p.oocR || p.run).length
  return { ...res, provisional, nPoints, minPoints: SPC_MIN_POINTS, subgroup: n, oocN }
}

/** ค่าชิม (`fixture_shim_events.shim_after_mm` = ชิมรวมหลังทำ) ของจุดเดียว → แถว I-MR เรียงตาม `event_at` · เพดานชิม = USL */
export function shimRows(events = []) {
  const at = (e) => e.event_at || e.created_at || ''
  return (events || [])
    .filter(e => e && e.shim_after_mm != null && Number.isFinite(Number(e.shim_after_mm)))
    .sort((a, b) => String(at(a)).localeCompare(String(at(b))))
    .map(e => ({ readings: [Number(e.shim_after_mm)], work_date: String(at(e)).slice(0, 10), at: at(e) }))
}
