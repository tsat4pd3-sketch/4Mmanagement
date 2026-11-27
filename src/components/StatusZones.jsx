import { groupByZone, textOn } from '../utils/statusZones';
import { partCardGrid, CardLayoutContext, PART_ROW_COLS, PART_ROW_MIN_W } from './PartCard';

import { tr } from '../utils/i18n';
/* ═══ 🗂️ StatusZones — คิวการ์ดแบ่งโซนตามสถานะ (2026-10-02 · UI §6.23.1)

   แต่ละโซน = กรอบของตัวเอง + หัวโซนแถบสีหนา (ชื่อขั้น · จำนวนใบ · ต้องทำอะไรต่อ) + กริดการ์ด
   · สีของขั้นอยู่ที่หัวโซน — พื้นการ์ดข้างในยังเป็นกลาง (§6.23 ข้อ 1)
   · โซนว่างเขียน "ไม่มีใบในขั้นนี้" ห้ามซ่อน (จำนวน 0 ก็เป็นข้อเท็จจริง)
   · สีพื้นโซนใช้ alpha-hex ไม่ใช้ color-mix (เพดาน Chromium 94 จอ TV) */
/* 📋 19/11 — แบบตาราง (`layout="table"`): 1 แถว = 1 ใบ · โซน = แถวหัวกลุ่มสีเดียวกับโซนการ์ด
   การ์ดข้างในวาดเป็นแถวผ่าน CardLayoutContext (PartCard แบบ row) · ผู้เรียกไม่ต้องแก้ renderCard
   🔴 มือถือให้ผู้เรียกส่ง `cards` (แถวกว้าง ~1,080px อ่านไม่ได้บนจอ 390px) */
const HEAD = ['พาร์ท / รายการ', 'ไป / มาจาก', 'จำนวน', 'รายละเอียด', 'สถานะ', ''];
export function RowTable({ children, head = HEAD }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflowX: 'auto', background: 'var(--card-surf)', boxShadow: 'var(--shadow-sm)' }}>
      <div role="table" style={{ minWidth: PART_ROW_MIN_W }}>
        <div role="row" style={{ display: 'grid', gridTemplateColumns: PART_ROW_COLS, gap: 12, padding: '7px 12px 7px 16px',
          background: 'var(--bg2)', borderBottom: '1px solid var(--border)' }}>
          {head.map((h, i) => <span key={i} role="columnheader" style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', whiteSpace: 'nowrap', textAlign: i === 2 ? 'right' : 'left' }}>{tr(h)}</span>)}
        </div>
        <CardLayoutContext.Provider value="row">{children}</CardLayoutContext.Provider>
      </div>
    </div>
  );
}

export default function StatusZones({ rows, zones, statusOf, renderCard, emptyText = 'ไม่มีใบในขั้นนี้', layout = 'cards' }) {
  const groups = groupByZone(rows, zones, statusOf);
  if (layout === 'table') return (
    <RowTable>
      {groups.map(z => (
        <section key={z.key} aria-label={`${z.label} ${z.rows.length} ${tr("ใบ")}`}>
          <header style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '7px 12px',
            borderLeft: `6px solid ${z.color}`, borderBottom: '1px solid var(--border)',
            background: 'var(--card)', backgroundImage: `linear-gradient(${z.color}1f, ${z.color}1f)` }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', whiteSpace: 'nowrap' }}>{tr(z.label)}</span>
            <span style={{ minWidth: 26, textAlign: 'center', padding: '0 8px', borderRadius: 'var(--r-pill)', background: z.color,
              color: textOn(z.color), fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{z.rows.length}</span>
            {z.hint && <span style={{ fontSize: 13.5, color: 'var(--text2)' }}>{tr(z.hint)}</span>}
          </header>
          {z.rows.length === 0
            ? <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>{emptyText}</div>
            : z.rows.map(renderCard)}
        </section>
      ))}
    </RowTable>
  );
  return (
    <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
      {groups.map(z => (
        <section key={z.key} aria-label={`${z.label} ${z.rows.length} ${tr("ใบ")}`} style={{
          border: `1px solid ${z.color}66`, borderRadius: 'var(--radius-lg)', overflow: 'hidden',
          background: 'var(--bg2-surf)', boxShadow: 'var(--shadow-sm)',
        }}>
          <header style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '10px 14px', borderLeft: `8px solid ${z.color}`,
            background: 'var(--card)', backgroundImage: `linear-gradient(${z.color}26, ${z.color}26)`,
            borderBottom: `1px solid ${z.color}66`,
          }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', whiteSpace: 'nowrap' }}>{tr(z.label)}</span>
            <span style={{
              minWidth: 32, textAlign: 'center', padding: '2px 10px', borderRadius: 'var(--r-pill)',
              background: z.color, color: textOn(z.color), fontSize: 15, fontWeight: 800,
              fontVariantNumeric: 'tabular-nums',
            }}>{z.rows.length}</span>
            {z.hint && <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>{tr(z.hint)}</span>}
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
