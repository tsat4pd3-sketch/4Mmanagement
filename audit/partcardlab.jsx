/* partcardlab — ตรวจตาหัวการ์ด <PartCard> ทั้ง 3 สาขาของ `info.lead` (2026-09-30)
   ทำไมต้องมีแยกจาก crashsweep: crashsweep เปิด "ทุกหน้า" แต่หน้าไหนจะได้พาร์ทแบบไหน
   ขึ้นกับ mock ⇒ เทียบสาขาข้างกันบนความกว้างการ์ดจริงไม่ได้
   · อ่านทะเบียนผ่าน hook จริง (`useMatIndex` → `parts_master` ใน mockSupabase) ไม่ใช่ index ปลอม
   · เปิดที่ http://localhost:5199/audit/partcardlab.html                                        */
import React from 'react'
import { createRoot } from 'react-dom/client'
import PartCard, { partCardGrid } from '../src/components/PartCard'
import '../src/index.css'

/* MAT พวกนี้มาจาก TABLE_ROWS.parts_master ใน audit/mockSupabase.js — แก้ mock แล้วแก้ที่นี่ด้วย */
const CASES = [
  ['ชิ้นส่วน 3xx — Part No. นำ (lead=pno)', '30047001'],
  ['วัตถุดิบ 5xx — part_no เป็นคำบรรยายยาว มีไทยปน (lead=name)', '50026002'],
  ['ชิ้นส่วน 2xx — Part No. นำ (lead=pno)', '20057003'],
  ['ทะเบียนไม่รู้จัก MAT นี้ (lead=mat)', '99999999'],
]

createRoot(document.getElementById('root')).render(
  <div style={{ padding: 16, background: 'var(--bg)', minHeight: '100vh' }}>
    {CASES.map(([title, mat]) => (
      <div key={mat} style={{ marginBottom: 14 }}>
        <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 5 }}>{title}</div>
        <div style={{ ...partCardGrid(), maxWidth: 720 }}>
          <PartCard code={mat} status={{ label: '⬜ รอ' }}
            metric={{ label: 'จำนวนที่ต้องส่ง', value: 240, unit: 'ชิ้น' }}
            aside={{ label: 'ปลายทาง', value: 'LINE APRON ASSY / HYDROFORM' }}
            rows={[{ k: 'ชั้นวาง', v: 'A-03-2' }]} />
        </div>
      </div>
    ))}
  </div>)
