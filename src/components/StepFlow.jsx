/* ══════════════════════════════════════════════════════════════════════════
   <StepFlow> — แถบ "ตอนนี้ถึงขั้นไหน" ✓—✓—⑦—○ (2026-11-12 · user: "เราชอบการแสดงแบบนี้")
   ใช้กับใบงานที่เดินเป็นขั้นตายตัว (RFQ · ต่อไป: ใบขอเดินทาง/ใบอนุมัติหลายชั้น) — UI-CONVENTIONS §6.30

   props:
     steps   = [{ n, label, state: 'done'|'current'|'todo', tone? }]   ← กฎการตัดสินขั้นอยู่ที่ utils ของโมดูล
     waiting = 'ใคร — ทำอะไร' (null = ไม่มีคนต้องทำต่อ)                 ← ข้อความจาก utils เช่นกัน ห้ามแต่งในหน้า
     unknown = true เมื่อสถานะอ่านไม่ออก → เขียนบอก ไม่เดา
   สี: done = good · current = accent (วงหนา) · todo = เส้นขอบ · ขั้นปิดที่มี tone = สีของผล (bad/none)
   ไม่มี animation (UI §2: นิ่ง) · ฟอนต์ป้าย 11px ขั้นต่ำ · ล้นจอ = เลื่อนแนวนอน ไม่บีบป้าย
   ══════════════════════════════════════════════════════════════════════════ */
import { statusColor } from '../utils/statusTone';

const DOT = 26;
function dotStyle(s) {
  const tone = s.tone ? statusColor(s.tone) : null;
  if (s.state === 'done') return { background: tone || statusColor('good'), color: '#fff', border: `2px solid ${tone || statusColor('good')}` };
  if (s.state === 'current') return { background: 'var(--card)', color: 'var(--accent)', border: '3px solid var(--accent)' };
  return { background: 'var(--card)', color: 'var(--muted)', border: '2px solid var(--border)' };
}

export default function StepFlow({ steps = [], waiting = null, unknown = false, style }) {
  const lastDone = steps.reduce((m, s, i) => (s.state === 'done' || s.state === 'current' ? i : m), -1);
  return (
    <div style={{ ...style }}>
      <div style={{ overflowX: 'auto', paddingBottom: 2 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', minWidth: steps.length * 84 }}>
          {steps.map((s, i) => (
            <div key={s.n ?? i} style={{ flex: '1 1 0', minWidth: 84, position: 'relative', textAlign: 'center' }}>
              {i > 0 && (
                <div style={{ position: 'absolute', top: DOT / 2 - 1, left: '-50%', width: '100%', height: 3,
                  background: i <= lastDone ? statusColor('good') : 'var(--border)' }} />
              )}
              <div title={s.label} style={{ position: 'relative', width: DOT, height: DOT, borderRadius: '50%', margin: '0 auto',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, boxSizing: 'border-box', ...dotStyle(s) }}>
                {s.state === 'done' ? '✓' : s.n}
              </div>
              <div style={{ fontSize: 11, marginTop: 4, lineHeight: 1.2, padding: '0 3px',
                color: s.state === 'current' ? 'var(--text)' : s.state === 'done' ? (s.tone ? statusColor(s.tone) : 'var(--text2)') : 'var(--muted)',
                fontWeight: s.state === 'current' ? 800 : 600 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
      {unknown
        ? <div style={{ fontSize: 12, marginTop: 6, color: statusColor('warn') }}>⚠️ สถานะนี้ระบบไม่รู้จัก — ตัดสินขั้นไม่ได้ (ตรวจค่าในฐาน)</div>
        : waiting
          ? <div style={{ fontSize: 12, marginTop: 6, color: 'var(--text2)' }}>⏳ รอ: {waiting}</div>
          : <div style={{ fontSize: 12, marginTop: 6, color: 'var(--muted)' }}>✔ ไม่มีขั้นที่รอใครทำต่อ</div>}
    </div>
  );
}
