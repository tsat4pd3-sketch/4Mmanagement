import PointJumpBar from './PointJumpBar'
import { JUMP_MIN } from '../../utils/cpJump'

/* 📌 ผังจอ "รูปอ้างอิง + การ์ดจุดตรวจ" — ใช้ร่วม PM + QA (2026-10-15 · ระบบเดียว เรียนครั้งเดียว)
   จอกว้าง (twoCol): รูปซ้าย `sticky` · การ์ดเลื่อนขวา · จอแคบ: รูปตรึงบนหัว (พื้นทึบ full-bleed)
   🔴 sticky เกาะ body ของโมดัล (overflowY:auto) — ห้ามใส่ overflow ให้กล่องในนี้
      ไม่งั้นกลายเป็น scroll container ซ้อนแล้ว "ขัง" sticky ไว้ข้างใน (กับดักใน CLAUDE.md)
   board = <SpinAnnotator …/> หรือ null (โหมดรายการ ไม่มีรูป)
   jump  = { points, labels, onJump, flashKey, onTop } — โชว์เมื่อจุด ≥ JUMP_MIN */
const label = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 0 }
const addBtn = { padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', cursor: 'pointer' }

export default function PinWorkspace({ twoCol, stickyRef, board, boardTitle, boardBadge, boardFooter, listTitle, onAdd, jump, children }) {
  const showJump = jump && jump.points.length >= JUMP_MIN
  const compact = !!board && !twoCol
  const bar = showJump && <PointJumpBar {...jump} compact={compact} />
  return (
    <div style={twoCol
      ? { display: 'grid', gridTemplateColumns: 'minmax(360px, 1fr) minmax(380px, 560px)', gap: 20, alignItems: 'start' }
      : { display: 'flex', flexDirection: 'column', gap: 16 }}>
      {board && (
        <div ref={twoCol ? undefined : stickyRef} style={twoCol
          ? { position: 'sticky', top: 0, alignSelf: 'start' }
          : { position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg2)',
              margin: '0 -24px', padding: '0 24px 8px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
            <span style={label}>{boardTitle}</span>
            {boardBadge && <span style={{ fontSize: 11, color: 'var(--accent)' }}>{boardBadge}</span>}
          </div>
          {board}
          {boardFooter}
          {compact && bar}
        </div>
      )}
      <div>
        {/* หัวคอลัมน์จุดตรวจ — ตรึงไว้เมื่อมีแถบ "ไปที่จุด" (ยกเว้นจอแคบ+รูป ที่แถบไปอยู่ใต้รูปแล้ว) */}
        <div ref={showJump && !compact ? stickyRef : undefined}
          style={showJump && !compact
            /* top:-20 = ทับ padding บนของ body ด้วย — top:0 เหลือช่อง 20px ให้การ์ดเลื่อนโผล่เหนือแถบ */
            ? { position: 'sticky', top: -20, zIndex: 4, background: 'var(--bg2)', margin: '0 0 10px', padding: '20px 0 8px', borderBottom: '1px solid var(--border)' }
            : { marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={label}>{listTitle}</span>
            {onAdd && <button type="button" onClick={onAdd} style={addBtn}>+ เพิ่มจุดตรวจ</button>}
          </div>
          {!compact && bar}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
      </div>
    </div>
  )
}
