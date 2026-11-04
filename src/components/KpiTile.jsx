/* ══ 📊 KpiTile — การ์ดตัวเลขโครงเดียวทั้งระบบ (2026-11-04 · UI-CONVENTIONS §6.35) ═══════════
   โครงตายตัว (บนลงล่าง): ชื่อ → ตัวเลขใหญ่ + หน่วยเล็ก → บรรทัดบริบท (เทา · ติดสีเฉพาะเมื่อมีความหมาย)
   · ตัวเลขเป็นสีเดียวทั้งแถว (**ไม่ทาสีตัวเลขตามหมวด** — เดิม 7 ใบ 5 สี = อ่านไม่ออกว่าอะไรผิดปกติ)
   · สีอยู่ที่บรรทัด `note` ผ่าน `tone`: 'ok' | 'warn' | 'bad' | undefined (เทา) — UI §6.17 สี = ความหมาย
   · ข้อมูลไม่มี = ส่ง `value={null}` ⇒ วาด "—" ห้ามโชว์ 0 (กฎความซื่อสัตย์ของจอ)
   · ขนาดตัวเลข ≥ 22px · ป้าย 12px (จอ TV ขั้นต่ำ 11px)

   ใช้:
     <KpiTile label="ผลิตได้" value={1679} unit="ชิ้น" note="94% ของเป้า 1,786" tone="ok" />
   `onClick` = การ์ดกดได้ (ไปหน้าที่ลงรายละเอียด) · `title` = tooltip */
const TONE = { ok: 'var(--green)', warn: 'var(--amber)', bad: 'var(--red)', info: 'var(--blue)' };

const fmt = (v) => (typeof v === 'number' ? v.toLocaleString() : v);

export default function KpiTile({ label, value, unit, note, tone, onClick, title, style, compact = false }) {
  const empty = value == null || value === '';
  const Tag = onClick ? 'button' : 'div';
  // ค่าที่เป็นข้อความยาว (เช่น "4 ชม. 34 นาที") ลดขนาดลงหนึ่งขั้น ไม่ให้ตัดเป็น 2 บรรทัด (วัดจริง 04/11: 26px ล้นที่การ์ดกว้าง 160px)
  const long = typeof value === 'string' && value.length > 6;
  const vSize = compact ? 20 : (long ? 20 : 26);
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} title={title} className="kpi-tile"
      style={{ cursor: onClick ? 'pointer' : 'default', minHeight: compact ? 72 : 86, ...style }}>
      <div className="kpi-tile-k">{label}</div>
      <div className="kpi-tile-v" style={{ fontSize: vSize, whiteSpace: 'nowrap' }}>
        {empty ? <span style={{ color: 'var(--muted)' }}>—</span> : fmt(value)}
        {unit && !empty && <small>{unit}</small>}
      </div>
      {note != null && note !== '' && (
        <div className="kpi-tile-d" style={{ color: tone && TONE[tone] ? TONE[tone] : 'var(--muted)' }}>{note}</div>
      )}
    </Tag>
  );
}
