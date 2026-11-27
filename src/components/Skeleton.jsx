/* ══ 🩶 Skeleton — บล็อกเทาวิบๆ คั่นตอนโหลด (2026-11-24 · ของกลาง · รีล CRM Dashboard V10) ═══════
   แทน "กำลังโหลด..." ตัวอักษรลอยๆ ในที่ที่รู้ว่าเนื้อหาจะเป็นการ์ด/แถว — คนเห็น "โครง" ก่อนแล้วค่อยเห็นของจริง
   · สี = token พื้นเดิม (`--bg3` / `--bg2`) ไม่มีสีใหม่ · shimmer = CSS `.skel` ใน index.css (นิ่งบนจอ TV lite / reduced-motion)
   · `rows` = จำนวนแถว · `cards` = วาดเป็นกริดการ์ด N ใบ (ใช้กับบอร์ด KPI) · ห้ามใช้แทนข้อความ "ไม่มีข้อมูล" — นี่คือ "ยังไม่มา" เท่านั้น */
export default function Skeleton({ rows = 3, cards = 0, height = 14, style }) {
  if (cards > 0) {
    return (
      <div aria-busy="true" aria-live="polite" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, alignContent: 'start', ...style }}>
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="skel-card">
            <div className="skel" style={{ width: '55%', height: 12 }} />
            <div className="skel" style={{ width: '40%', height: 26, marginTop: 10 }} />
            <div className="skel" style={{ width: '80%', height: 10, marginTop: 12 }} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div aria-busy="true" aria-live="polite" style={{ display: 'grid', gap: 10, ...style }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skel" style={{ height, width: `${[92, 70, 84, 60, 76][i % 5]}%` }} />
      ))}
    </div>
  );
}
