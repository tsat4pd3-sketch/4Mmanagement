/* planlab — ตรวจตาไทม์ไลน์แผนที่ไหลข้ามกะ/ข้ามวัน (2026-09-30)
   crashsweep เปิดหน้าจริงก็จริง แต่จะมีงานล้นกะหรือไม่ขึ้นกับ mock ⇒ เทียบเคสข้างกันไม่ได้
   เปิดที่ http://localhost:5199/audit/planlab.html */
import React from 'react'
import { createRoot } from 'react-dom/client'
import PlanTimeline from '../src/components/PlanTimeline'
import { buildHorizon } from '../src/utils/planHorizon'
import '../src/index.css'

const CT = { M1: 60, M2: 45, M3: 90 }
const ctOf = (m) => CT[m] ?? null
const lot = (id, seq, mat, qty) => ({ id, seq, mat_no: mat, qty_plan: qty, status: 'planned' })

/* ค่าเดียวกับจอจริงของ user: ไลน์ B 6 ล็อต 12:24 ชม. ในกะ 12 ชม. */
const REAL = [
  lot('1', 1, 'M1', 105), lot('2', 2, 'M2', 190), lot('3', 3, 'M1', 93),
  lot('4', 4, 'M2', 82),  lot('5', 5, 'M3', 96),  lot('6', 6, 'M1', 181),
]
const trial = (id, seq, hrs, o = {}) => ({
  id, seq, source: 'trial', mat_no: null, qty_plan: 50, status: 'planned',
  trial_part_no: 'MB3B-99Z999-AA', trial_part_name: 'BRKT NEW MODEL', est_min: hrs * 60, ...o,
})
const CASES = [
  ['① เดิม — กรอบกะเดียว (ไม่ส่ง segments) = งานล้นทะลุขอบขวาแล้วจบ', '2026-10-01', 1, REAL],
  ['② ใหม่ — 2 กะต่อกัน: งานที่ล้น 20:00 ไหลลงกะดึกเอง', '2026-10-01', 2, REAL],
  ['③ งานเกิน 1 วัน = ไหลไปวันถัดไป (4 กะ)', '2026-10-01', 4,
   [lot('a', 1, 'M1', 900), lot('b', 2, 'M2', 1200), lot('c', 3, 'M3', 700)]],
  ['④ คร่อมวันหยุด — เริ่มศุกร์ 02/10 คิวข้ามเสาร์-อาทิตย์ไปจันทร์', '2026-10-02', 4,
   [lot('a', 1, 'M1', 1400), lot('b', 2, 'M2', 900)]],
  ['⑤ มีล็อตไม่มี CT — กล่องลายทแยง + เวลาหลังจากนั้นเชื่อไม่ได้', '2026-10-01', 2,
   [lot('a', 1, 'M1', 400), lot('z', 2, 'ZZ', 50), lot('c', 3, 'M2', 300)]],
  ['⑥ 🧪 จองเครื่องทดลองงานใหม่ — เวลามาจาก "ที่ขอ" (4 ชม.) ไม่ใช่ qty×CT · ล้นไปกะดึก', '2026-10-01', 2,
   [lot('a', 1, 'M1', 400), trial('t1', 2, 4), lot('c', 3, 'M2', 500), trial('t2', 4, 3, { trial_part_no: 'N1WB-17E850-R', trial_reason: 'Run@Rate' })]],
]

createRoot(document.getElementById('root')).render(
  <div style={{ padding: 16, background: 'var(--bg)', minHeight: '100vh' }}>
    {CASES.map(([title, start, segs, lots], i) => {
      const h = buildHorizon({ startDate: start, startShift: 'day', maxSegments: segs })
      return (
        <div key={i} style={{ marginBottom: 20, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8, color: 'var(--text)' }}>{title}</div>
          <PlanTimeline
            lots={lots} ctOf={ctOf} startMs={h.startMs} endMs={h.endMs}
            closed={h.closed} segments={i === 0 ? [] : h.segments} skipped={h.skipped}
            editable nameOfMat={() => ''} onReorder={() => {}}
          />
        </div>
      )
    })}
  </div>)
