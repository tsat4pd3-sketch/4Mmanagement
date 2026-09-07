/*
  ชิปกรอง "ฝั่งงาน" ขาเข้า / ขาออก — component กลาง ใช้ร่วมทุกหน้าที่ลิสต์พาร์ทปนกัน
  ═══════════════════════════════════════════════════════════════════════════════
  ที่มา (2026-09-03 · feedback หน้างาน "รายละเอียดด้านในมันปนกันมั่วไปหมด"):
  จอสโตร์ลิสต์ทุกเลข MAT ปนกันในตารางเดียว (ข้อมูลจริง /line-stock 106 แถว = FG 16 +
  child 73 + raw 14 + เลขลูกค้า 3) ทั้งที่ **คนละแผนกดูแล**
    📥 ขาเข้า = Store (2xx/3xx/5xx)   📤 ขาออก = Warehouse+Delivery (FG 1xx)

  ⚠️ ห้ามเขียนชิปกรองฝั่งเองซ้ำในหน้าใดๆ — เกณฑ์การจัดฝั่งอยู่ที่ src/utils/logisticSide.js
     ถ้าแต่ละหน้าตีความเองจะ drift ทันที (บทเรียนเดียวกับ matPrefix ที่เคยกระจาย 3 ไฟล์)

  ⚠️ "ไม่ระบุฝั่ง" ต้องโชว์เป็นชิปของตัวเองเมื่อมีของจริง ห้ามซ่อน/ห้ามยัดเข้าฝั่งใดฝั่งหนึ่ง
     (เลข 9xx และเลขพาร์ทลูกค้าที่ยังไม่ resolve — คนต้องเห็นว่ามีค้างอยู่กี่รายการ)
*/
import { SIDES, UNKNOWN_SIDE } from '../utils/logisticSide';

/**
 * value    — '' (ทั้งหมด) | 'inbound' | 'outbound' | 'unknown'
 * counts   — { inbound, outbound, unknown } จำนวนรายการต่อฝั่ง (จาก splitBySide)
 * total    — จำนวนทั้งหมด (ไม่ส่ง = บวกจาก counts)
 * unit     — หน่วยที่ต่อท้ายตัวเลข เช่น 'รายการ' (default 'รายการ')
 */
export default function SideFilterChips({ value, onChange, counts = {}, total, unit = 'รายการ' }) {
  const n = { inbound: 0, outbound: 0, unknown: 0, ...counts };
  const all = total ?? (n.inbound + n.outbound + n.unknown);
  // ฝั่งที่ถือของจริง (control = Sales/Planner/Billing ไม่ได้ถือของ จึงไม่มีในตัวกรองพาร์ท)
  const matSides = SIDES.filter(s => s.key !== 'control');
  const chips = [
    { key: '', icon: '📋', short: 'ทั้งหมด', color: 'var(--text2)', count: all, desc: `ทุกฝั่งรวมกัน ${all} ${unit}` },
    ...matSides.map(s => ({ key: s.key, icon: s.icon, short: s.short, color: s.color, count: n[s.key], desc: `${s.owner} — ${s.desc}` })),
    // โชว์เฉพาะเมื่อมีของค้างจริง (ปกติควรเป็น 0)
    ...(n.unknown > 0
      ? [{ key: 'unknown', icon: UNKNOWN_SIDE.icon, short: UNKNOWN_SIDE.short, color: UNKNOWN_SIDE.color, count: n.unknown, desc: UNKNOWN_SIDE.desc }]
      : []),
  ];

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)' }}>ฝั่งงาน:</span>
      {chips.map(c => {
        const on = value === c.key;
        const dim = c.count === 0 && c.key !== '';
        return (
          <button key={c.key || 'all'} type="button" onClick={() => onChange(c.key)} title={c.desc}
            style={{
              padding: '5px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 800,
              fontFamily: 'var(--font-body)', whiteSpace: 'nowrap',
              background: on ? `${c.color}22` : 'var(--bg2)',
              color: on ? c.color : dim ? 'var(--muted)' : 'var(--text2)',
              border: `1px solid ${on ? c.color : 'var(--border)'}`,
              opacity: dim ? 0.55 : 1,
            }}>
            {c.icon} {c.short} <span style={{ fontWeight: 900 }}>{c.count}</span>
          </button>
        );
      })}
    </div>
  );
}
