/* 🧩 การ์ดจุดตรวจ 1 จุด — "เปลือก" ที่เหมือนกันทุกระบบ (PM · QA)
   หัวการ์ด: เลขจุด · ปุ่ม 📍 วางตำแหน่ง / ✕ ถอดหมุด · × ลบ  — ท้ายการ์ด: 📷 รูปโคลสอัพของจุด
   ส่วนกลาง (children) = สเปคที่ต้องตรวจ ซึ่งต่างกันตามระบบ (PM: หมวด/วิธีตรวจ/Variable…
   · QA: ชนิด Variable/Attribute · สเปค · Rank · Stage · ความถี่)
   📄 docs/modules/inspection-point-setup.md — **การ์ดจุดตรวจใหม่ทุกระบบใช้เปลือกนี้ ห้ามวาดหัว/ปุ่มเอง** */
import { acceptImageFile } from '../../utils/acceptImageFile'

const smallBtn = {
  padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
  border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--muted)',
}

export default function PointCardShell({
  label, caption = 'จุดตรวจสอบ', pinned, isPinning, canPin, onPinToggle, onUnpin, onDelete,
  extra, closeup, inactive, children,
}) {
  // closeup.onPick(File) ได้ไฟล์ที่ผ่านด่านรับรูปแล้ว (HEIC→JPEG · ไม่ใช่รูป = toast แล้วไม่เรียก)
  const pick = async (e) => {
    const f = await acceptImageFile(e.target.files?.[0])
    e.target.value = ''
    if (f) closeup.onPick(f)
  }
  return (
    <div style={{ background: 'var(--bg3)', border: `1px solid ${isPinning ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, padding: 14, opacity: inactive ? 0.55 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ minWidth: 20, height: 20, padding: '0 4px', borderRadius: 10, background: 'var(--bg2)', color: 'var(--muted)', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{label}</span>
          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>{caption}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {extra}
          {canPin && (
            <button type="button" onClick={onPinToggle} style={{
              ...smallBtn,
              border: `1px solid ${isPinning || pinned ? 'var(--accent)' : 'var(--border2)'}`,
              background: isPinning ? 'var(--accent)' : pinned ? 'var(--accent-dim)' : 'var(--bg3)',
              color: isPinning ? 'var(--accent-ink)' : pinned ? 'var(--accent)' : 'var(--muted)',
            }}>{isPinning ? '📍 แตะที่รูป…' : pinned ? '📍 วางแล้ว (ย้าย)' : '🔘 วางตำแหน่ง'}</button>
          )}
          {/* ถอดหมุด — แตะหมุดบนรูป = ไปที่การ์ด (ไม่ใช่ลบ) */}
          {canPin && pinned && onUnpin && (
            <button type="button" onClick={onUnpin} title="เอาหมุดของจุดนี้ออกจากรูป" style={smallBtn}>✕ ถอดหมุด</button>
          )}
          {onDelete && <button type="button" className="tbtn" onClick={onDelete} title="ลบจุดนี้" aria-label="ลบจุดนี้"
            style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 16, lineHeight: 1, padding: '0 2px', cursor: 'pointer' }}>×</button>}
        </div>
      </div>

      {children}

      {/* 📷 รูปโคลสอัพของจุดนี้ = ตัวที่คนตรวจแตะหมุดแล้วซูมเข้ามาเห็น
          (feedback 2026-08-21: หน้างานไปอัปรูปโคลสอัพเป็น "เฟรม" แยกแทน แล้วดูไม่ออกว่าอยู่ตรงไหน) */}
      {closeup && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {closeup.preview ? (
            <>
              <img src={closeup.preview} alt="" style={{ height: 44, borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg2)' }} />
              <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>🔍 รูปเจาะจุดนี้</span>
              <label style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer' }}>
                <input type="file" accept="image/*" onChange={pick} style={{ display: 'none' }} />เปลี่ยนรูป
              </label>
              <button type="button" onClick={closeup.onClear}
                style={{ fontSize: 11, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer' }}>ลบรูป</button>
            </>
          ) : (
            <label style={{ fontSize: 11, color: 'var(--muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input type="file" accept="image/*" onChange={pick} style={{ display: 'none' }} />
              📷 แนบรูปจุดนี้ (โคลสอัพ) — คนตรวจแตะหมุด 🔍 แล้วซูมดู
            </label>
          )}
        </div>
      )}
    </div>
  )
}
