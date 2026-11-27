import { tr } from '../utils/i18n';
/* ══ 📊 KpiTile — การ์ดตัวเลขโครงเดียวทั้งระบบ (2026-11-04 · UI-CONVENTIONS §6.35) ═══════════
   โครงตายตัว (บนลงล่าง): ชื่อ → ตัวเลขใหญ่ + หน่วยเล็ก → (sparkline) → บรรทัดบริบท (เทา · ติดสีเฉพาะเมื่อมีความหมาย)
   · ตัวเลขเป็นสีเดียวทั้งแถว (**ไม่ทาสีตัวเลขตามหมวด** — เดิม 7 ใบ 5 สี = อ่านไม่ออกว่าอะไรผิดปกติ)
   · สีอยู่ที่บรรทัด `note` ผ่าน `tone`: 'ok' | 'warn' | 'bad' | undefined (เทา) — UI §6.17 สี = ความหมาย
   · ข้อมูลไม่มี = ส่ง `value={null}` ⇒ วาด "—" ห้ามโชว์ 0 (กฎความซื่อสัตย์ของจอ)
   · ขนาดตัวเลข ≥ 22px · ป้าย 12px (จอ TV ขั้นต่ำ 11px)

   18/11 (user: ก๊อป ERP ที่เห็น — เลขใหญ่ขึ้น · sparkline · ใบพระเอก):
   · ตัวเลข 26 → 30px (compact 22) · padding 12/14 → 16/18 (ที่ว่างในการ์ดคือสิ่งที่ทำให้ดู "แพง")
   · `spark={[…]}` = เส้นแนวโน้มบางๆ ใต้ตัวเลข (≥ 2 จุด · ไม่มีแกน ไม่มีตัวเลข — เป็น "รูปร่าง" ไม่ใช่กราฟ)
     **ไม่มีข้อมูลย้อนหลัง = ไม่ส่ง** ห้ามเดาเส้น · สีเทาตาม `--muted` (hero = accent) ไม่ทาสีตามสถานะ
   · `hero` = ใบพระเอก **1 ใบต่อแถว** (พื้น `--accent-dim` + ขอบ accent — token เดิม ไม่เพิ่มสี) ใช้กับใบที่
     "มีเกณฑ์ตัดสิน" เท่านั้น (brief 23/09 "One primary, the rest secondary")

   ใช้:
     <KpiTile label={tr('ผลิตได้')} value={1679} unit="ชิ้น" note="94% ของเป้า 1,786" tone="ok" spark={[1500,1600,1679]} />
   `onClick` = การ์ดกดได้ (ไปหน้าที่ลงรายละเอียด) · `title` = tooltip */
const TONE = { ok: 'var(--green)', good: 'var(--green)', warn: 'var(--amber)', bad: 'var(--red)', info: 'var(--blue)' };   // 'good' = คีย์ของ statusTone.js

const fmt = (v) => (typeof v === 'number' ? v.toLocaleString() : v);

/* เส้นแนวโน้ม 100% × 22px — polyline เดียว ไม่มี fill · non-scaling-stroke ให้เส้นหนาเท่ากันทุกความกว้าง */
function Spark({ data, color }) {
  const pts = (data || []).filter(v => typeof v === 'number' && Number.isFinite(v));
  if (pts.length < 2) return null;
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const W = 100, H = 22, P = 2;
  const d = pts.map((v, i) => `${(i / (pts.length - 1)) * W},${H - P - ((v - min) / span) * (H - P * 2)}`).join(' ');
  return (
    <svg className="kpi-tile-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function KpiTile({ label, value, unit, note, tone, onClick, title, style, compact = false, spark, hero = false }) {
  const empty = value == null || value === '';
  const Tag = onClick ? 'button' : 'div';
  // ค่าที่เป็นข้อความยาว (เช่น "4 ชม. 34 นาที") ลดขนาดลงหนึ่งขั้น ไม่ให้ตัดเป็น 2 บรรทัด (วัดจริง 04/11: 26px ล้นที่การ์ดกว้าง 160px)
  const long = typeof value === 'string' && value.length > 6;
  const vSize = compact ? 22 : (long ? 22 : 30);
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} title={title} className={`kpi-tile${hero ? ' hero' : ''}`}
      style={{ cursor: onClick ? 'pointer' : 'default', minHeight: compact ? 76 : 96, ...style }}>
      <div className="kpi-tile-k">{label}</div>
      <div className="kpi-tile-v" style={{ fontSize: vSize, whiteSpace: 'nowrap' }}>
        {empty ? <span style={{ color: 'var(--muted)' }}>—</span> : fmt(value)}
        {unit && !empty && <small>{unit}</small>}
      </div>
      {!empty && <Spark data={spark} color={hero ? 'var(--accent)' : 'var(--muted)'} />}
      {/* 📐 25/11 (user: "คำอธิบายทำเป็น hover · ตำแหน่งตัวเลขเน้นเท่ากันทุกการ์ด"): บรรทัดบริบท 1 บรรทัดตัดท้าย … ข้อความเต็มอยู่ใน title ของบรรทัด */}
      {note != null && note !== '' && (
        <div className="kpi-tile-d" title={typeof note === 'string' ? note : undefined}
          style={{ color: tone && TONE[tone] ? TONE[tone] : 'var(--muted)', whiteSpace: 'nowrap', overflow: 'clip', textOverflow: 'ellipsis', maxWidth: '100%' }}>{note}</div>
      )}
    </Tag>
  );
}
