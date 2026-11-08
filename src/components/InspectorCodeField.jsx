/* ✍️ ช่อง "รหัสพนักงานผู้ตรวจ" (สแกน QR บนบัตร / พิมพ์) — ใช้ร่วมกันทุกใบตรวจ (C1 · ประชุม 02/11 · 05/11)
   ทำไม: เครื่องหน้างานมักใช้บัญชีกลางบัญชีเดียว ⇒ `inspector_id` (บัญชีที่ login) ไม่ใช่ "คนที่ตรวจจริง"
   ตัวตนจริงบนหน้างาน = รหัสพนักงาน (QR บนบัตร = รหัสล้วน ชุดเดียวกับเช็คชื่อ · ผู้รับเหมาไม่มีบัตร = พิมพ์เอง)
   · เครื่องสแกนส่ง Enter ตามท้ายรหัสเสมอ ⇒ Enter = ยืนยันรหัส (blur) ไม่ submit ฟอร์ม
   · ใต้ช่องเขียนชื่อที่พบ + เหตุผลถ้าไม่มีลายเซ็น (`SIGNER_NOTE` · `utils/employeeSignature.js`) — ห้ามเงียบ
   · stale guard: พิมพ์รหัสใหม่ระหว่างโหลด ห้ามเอาผลของรหัสเก่ามาทับ (กฎเหล็ก DB ข้อ 4) */
import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { resolveEmployeeSigner } from '../utils/employeeSignature'

export default function InspectorCodeField({ value, onChange, disabled = false, label = 'รหัสพนักงานผู้ตรวจ (สแกนบัตร / พิมพ์)', style }) {
  const code = String(value || '').trim()
  const [signer, setSigner] = useState(null)
  useEffect(() => {
    let alive = true
    if (!code) { setSigner(null); return undefined }
    resolveEmployeeSigner(supabase, code).then(r => { if (alive) setSigner(r) })
    return () => { alive = false }
  }, [code])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, ...style }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>{label}</label>
      {/* key = remount เมื่อค่าจากภายนอกเปลี่ยน (input uncontrolled ⇒ สแกนรหัสใหม่ทับได้ทันที) */}
      <input key={code} defaultValue={code} disabled={disabled} inputMode="text" autoComplete="off"
        onBlur={e => { const v = e.target.value.trim(); if (v !== code) onChange(v) }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
        placeholder="เช่น 61234 · เว้นว่าง = ใช้บัญชีที่ login"
        style={{ maxWidth: 260, padding: '6px 8px', fontSize: 13 }} />
      {signer && signer.state !== 'no_code' && (
        <div style={{ fontSize: 11.5, lineHeight: 1.4, color: signer.state === 'ok' ? 'var(--muted)' : 'var(--amber)' }}>
          {signer.name ? `👤 ${signer.name}` : ''}
          {signer.note ? `${signer.name ? ' · ' : ''}${signer.note}` : ''}
        </div>
      )}
    </div>
  )
}
