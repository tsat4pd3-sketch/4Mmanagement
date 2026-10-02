import { groupByZone, textOn } from '../utils/statusZones';
import { partCardGrid } from './PartCard';

/* ═══ 🗂️ StatusZones — คิวการ์ดแบ่งโซนตามสถานะ (2026-10-02 · UI §6.23.1)

   แต่ละโซน = กรอบของตัวเอง + หัวโซนแถบสีหนา (ชื่อขั้น · จำนวนใบ · ต้องทำอะไรต่อ) + กริดการ์ด
   · สีของขั้นอยู่ที่หัวโซน — พื้นการ์ดข้างในยังเป็นกลาง (§6.23 ข้อ 1)
   · โซนว่างเขียน "ไม่มีใบในขั้นนี้" ห้ามซ่อน (จำนวน 0 ก็เป็นข้อเท็จจริง)
   · สีพื้นโซนใช้ alpha-hex ไม่ใช้ color-mix (เพดาน Chromium 94 จอ TV) */
export default function StatusZones({ rows, zones, statusOf, renderCard, emptyText = 'ไม่มีใบในขั้นนี้' }) {
  const groups = groupByZone(rows, zones, statusOf);
  return (
    <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
      {groups.map(z => (
        <section key={z.key} aria-label={`${z.label} ${z.rows.length} ใบ`} style={{
          border: `1px solid ${z.color}66`, borderRadius: 'var(--radius-lg)', overflow: 'hidden',
          background: 'var(--bg2)', boxShadow: 'var(--shadow-sm)',
        }}>
          <header style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '10px 14px', borderLeft: `8px solid ${z.color}`,
            background: 'var(--card)', backgroundImage: `linear-gradient(${z.color}26, ${z.color}26)`,
            borderBottom: `1px solid ${z.color}66`,
          }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', whiteSpace: 'nowrap' }}>{z.label}</span>
            <span style={{
              minWidth: 32, textAlign: 'center', padding: '2px 10px', borderRadius: 999,
              background: z.color, color: textOn(z.color), fontSize: 15, fontWeight: 800,
              fontVariantNumeric: 'tabular-nums',
            }}>{z.rows.length}</span>
            {z.hint && <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>{z.hint}</span>}
          </header>
          <div style={{ padding: 12 }}>
            {z.rows.length === 0
              ? <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '4px 2px' }}>{emptyText}</div>
              : <div style={partCardGrid()}>{z.rows.map(renderCard)}</div>}
          </div>
        </section>
      ))}
    </div>
  );
}
