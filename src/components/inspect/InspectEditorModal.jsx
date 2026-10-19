import { motion } from 'framer-motion'

/* 🪟 โมดัล "ตั้งค่าจุดตรวจ" — กรอบเดียวกันทุกระบบ (PM อุปกรณ์ · QA ชิ้นงาน)
   หัว: ชื่อ + บรรทัดรอง · ตัว: เลื่อนได้ (เป็นตัวที่ sticky เกาะ — ห้ามใส่ overflow ให้กล่องข้างใน)
   ท้าย: ยกเลิก / บันทึก — **แก้ทั้งหมดในโมดัลแล้วกดบันทึกครั้งเดียว** (หลักเดียวกันทุกระบบ)
   📄 docs/modules/inspection-point-setup.md */
const S = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
    zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  modal: {
    background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 12,
    width: '100%', maxWidth: 1000, maxHeight: '92vh', display: 'flex', flexDirection: 'column',
    boxShadow: 'var(--shadow-lg)',
  },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid var(--border)' },
  title: { fontSize: 17, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', margin: 0 },
  body: { flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 },
  foot: { padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 },
  cancel: { flex: 1, padding: '9px 0', borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 600, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)', cursor: 'pointer' },
  save: { flex: 1, padding: '9px 0', borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 700, background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none', cursor: 'pointer' },
}

export default function InspectEditorModal({ title, subtitle, subColor, wide, bodyRef, onClose, onSave, saving, saveLabel = 'บันทึก', saveStyle, children }) {
  return (
    <div style={S.overlay}>
      <motion.div style={{ ...S.modal, maxWidth: wide ? 1340 : 1000 }} onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 16 }} transition={{ duration: 0.18 }}>
        <div style={S.head}>
          <div>
            <h2 style={S.title}>{title}</h2>
            {subtitle && <span style={{ fontSize: 12, color: subColor || 'var(--muted)' }}>{subtitle}</span>}
          </div>
          <button onClick={onClose} aria-label="ปิด" style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div ref={bodyRef} style={S.body}>{children}</div>
        <div style={S.foot}>
          <button onClick={onClose} style={S.cancel}>ยกเลิก</button>
          <button onClick={onSave} disabled={saving} style={{ ...S.save, ...saveStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'กำลังบันทึก...' : saveLabel}</button>
        </div>
      </motion.div>
    </div>
  )
}
