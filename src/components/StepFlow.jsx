/* ══════════════════════════════════════════════════════════════════════════
   <StepFlow> — แถบ "ตอนนี้ถึงขั้นไหน" ✓—✓—⑦—○ (2026-11-12 · user: "เราชอบการแสดงแบบนี้")
   ใช้กับใบงานที่เดินเป็นขั้นตายตัว (RFQ · ต่อไป: ใบขอเดินทาง/ใบอนุมัติหลายชั้น) — UI-CONVENTIONS §6.30

   props:
     steps   = [{ n, label, state: 'done'|'current'|'todo'|'skipped', tone?, who? }]  ← กฎการตัดสินขั้นอยู่ที่ utils ของโมดูล
               skipped = ขั้นนี้ "ไม่ต้องทำ" อย่างเป็นทางการ (เช่น ข้าม QA) → ⏭ เหลือง **ห้ามวาด ✓ เขียว** (= โกหกว่ามีคนตรวจ)
     compact = วงเล็ก ไม่มีป้ายใต้ (ป้ายอยู่ใน title) — ใช้ในแถวตาราง/การ์ดเล็ก · บรรทัด "รอ" ยังวาดเมื่อส่ง waiting
     waiting = 'ใคร — ทำอะไร' (null = ไม่มีคนต้องทำต่อ)                 ← ข้อความจาก utils เช่นกัน ห้ามแต่งในหน้า
     unknown = true เมื่อสถานะอ่านไม่ออก → เขียนบอก ไม่เดา
   สี: done = good · current = accent (วงหนา) · todo = เส้นขอบ · skipped = warn · ขั้นปิดที่มี tone = สีของผล (bad/none)
   ไม่มี animation (UI §2: นิ่ง) · ฟอนต์ป้าย 11px ขั้นต่ำ · ล้นจอ = เลื่อนแนวนอน ไม่บีบป้าย
   ══════════════════════════════════════════════════════════════════════════ */
import { statusColor } from '../utils/statusTone';

function dotStyle(s) {
  const tone = s.tone ? statusColor(s.tone) : null;
  if (s.state === 'done') return { background: tone || statusColor('good'), color: '#fff', border: `2px solid ${tone || statusColor('good')}` };
  if (s.state === 'current') return { background: 'var(--card)', color: 'var(--accent)', border: '3px solid var(--accent)' };
  if (s.state === 'skipped') return { background: 'var(--card)', color: statusColor('warn'), border: `2px solid ${statusColor('warn')}` };
  return { background: 'var(--card)', color: 'var(--muted)', border: '2px solid var(--border)' };
}
const MARK = { done: '✓', skipped: '⏭' };

export default function StepFlow({ steps = [], waiting = null, unknown = false, compact = false, style }) {
  const DOT = compact ? 18 : 26;
  const COL = compact ? 26 : 84;
  const lastDone = steps.reduce((m, s, i) => (s.state === 'done' || s.state === 'current' || s.state === 'skipped' ? i : m), -1);
  const titleOf = (s) => [`${s.n}. ${s.label}`, s.who ? `· ${s.who}` : '', s.state === 'skipped' ? '(ข้าม — ไม่ต้องทำ)' : s.state === 'current' ? '(ขั้นปัจจุบัน)' : ''].filter(Boolean).join(' ');
  return (
    <div style={{ ...style }}>
      <div style={{ overflowX: compact ? 'visible' : 'auto', paddingBottom: compact ? 0 : 2 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', minWidth: compact ? 0 : steps.length * COL, width: compact ? steps.length * COL : undefined }}>
          {steps.map((s, i) => (
            <div key={s.n ?? i} style={{ flex: '1 1 0', minWidth: COL, position: 'relative', textAlign: 'center' }}>
              {i > 0 && (
                <div style={{ position: 'absolute', top: DOT / 2 - 1, left: '-50%', width: '100%', height: compact ? 2 : 3,
                  background: i <= lastDone ? statusColor('good') : 'var(--border)' }} />
              )}
              <div title={titleOf(s)} style={{ position: 'relative', width: DOT, height: DOT, borderRadius: '50%', margin: '0 auto',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: compact ? 11 : 12, fontWeight: 800, boxSizing: 'border-box', ...dotStyle(s) }}>
                {MARK[s.state] || s.n}
              </div>
              {!compact && (
                <div style={{ fontSize: 11, marginTop: 4, lineHeight: 1.2, padding: '0 3px',
                  color: s.state === 'current' ? 'var(--text)' : s.state === 'done' ? (s.tone ? statusColor(s.tone) : 'var(--text2)') : s.state === 'skipped' ? statusColor('warn') : 'var(--muted)',
                  fontWeight: s.state === 'current' ? 800 : 600 }}>
                  {s.label}{s.state === 'skipped' ? ' (ข้าม)' : ''}
                  {s.who && s.state === 'current' && <div style={{ fontWeight: 600, color: 'var(--muted)' }}>{s.who}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {unknown
        ? <div style={{ fontSize: compact ? 11 : 12, marginTop: compact ? 3 : 6, color: statusColor('warn') }}>⚠️ สถานะนี้ระบบไม่รู้จัก — ตัดสินขั้นไม่ได้</div>
        : waiting
          ? <div style={{ fontSize: compact ? 11 : 12, marginTop: compact ? 3 : 6, color: 'var(--text2)' }}>⏳ รอ: {waiting}</div>
          : compact ? null : <div style={{ fontSize: 12, marginTop: 6, color: 'var(--muted)' }}>✔ ไม่มีขั้นที่รอใครทำต่อ</div>}
    </div>
  );
}
