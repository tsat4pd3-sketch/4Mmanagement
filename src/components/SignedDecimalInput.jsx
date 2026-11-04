/* ±  ช่องกรอกค่าวัดที่ติดลบได้ — ใช้กับค่าที่ "ติดลบได้จริง" (ค่าเบี่ยงจาก nominal ฯลฯ)
 *
 * ทำไมต้องมี (feedback QA 02/11/2026): แป้น `inputMode="decimal"` ของ iOS ไม่มีปุ่ม "-"
 * ⇒ iPhone กรอกค่าติดลบไม่ได้เลย (Android มีปุ่มลบ เลยไม่เจอ)
 * ทางแก้: คงแป้นตัวเลขไว้ (กรอกเร็วเหมือนเดิม) + ปุ่ม ± กลับเครื่องหมาย · พิมพ์ "-" เองก็ยังได้
 * · `type="text"` เพราะ `type="number"` คืน '' ให้ค่าที่ยังพิมพ์ไม่จบอย่าง "-" หรือ "-." ⇒ ค่าหาย
 * · ค่าที่ส่งออก = สตริงที่ผ่านการกรองแล้ว (ตัวเลข · จุดเดียว · ลบนำหน้า) — ผู้ใช้ parse เองเหมือนเดิม
 */
import { cleanSignedDecimal, toggleSign } from '../utils/signedDecimal';

export default function SignedDecimalInput({ value, onChange, style, placeholder, ...rest }) {
  const v = value ?? ''
  return (
    <span style={{ display: 'inline-flex', alignItems: 'stretch', gap: 4 }}>
      <button type="button" className="tbtn" title="กลับเครื่องหมาย + / −" aria-label="กลับเครื่องหมายบวกลบ"
        onClick={() => onChange(toggleSign(v))}
        style={{ minWidth: 34, padding: '0 8px', borderRadius: 8, border: '1px solid var(--border2)',
          background: String(v).startsWith('-') ? 'rgba(239,68,68,0.12)' : 'var(--bg2)',
          color: String(v).startsWith('-') ? '#ef4444' : 'var(--text)', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>±</button>
      <input type="text" inputMode="decimal" autoComplete="off" placeholder={placeholder} value={v}
        onChange={e => onChange(cleanSignedDecimal(e.target.value))} style={style} {...rest} />
    </span>
  )
}
