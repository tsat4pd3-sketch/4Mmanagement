import { useState } from 'react';
import useIsMobile from '../utils/useIsMobile';

/* ─── Internal Time Board — บอร์ดเวลาสไตล์ Shipping Chart สำหรับงานส่งภายในโรงงาน ──
   ปลายทาง = ไลน์/จุดภายใน · กรอบวันงาน 08:00 → 08:00 · เต็ม 24 ชม.ในจอเดียว
   เวลาชนกันแยกเลนอัตโนมัติ · คลิกบล็อกส่ง callback ให้หน้าแม่เปิด popup
   คลิกชื่อปลายทางเพื่อย่อ/ขยาย (โหมดย่อเหลือจุดสถานะ)
   มาตรฐานเดียวกับบอร์ด Heijunka: playhead ชมพู (.now-line) + ป้ายเวลา (.now-chip)
   + แถบลายเฉียงช่วงเวลาพัก

   props:
   - groups: [{ key, label, sub, items: [{ id, timeMin, color, text, title, data }] }]
     timeMin = นาทีบนกรอบวันงาน (08:00 = 480, ก่อนตี 8 บวก 1440 แล้ว)
   - nowMin: นาทีปัจจุบันบนกรอบเดียวกัน (null = ไม่ใช่วันงานปัจจุบัน ไม่วาดเส้น/ป้าย)
   - breaks: [{ s, e, label }] ช่วงเวลาพักบนกรอบเดียวกัน (จาก breaksToFrame ใน utils/timeFrame)
   - onItemClick(data, x, y)
   - hint: ข้อความช่วยเหลือมุมขวา */
// มือถือ ≤768px: จอแคบเกินกว่าจะอัด 24 ชม.ในจอเดียว → บอร์ดเลื่อนแนวนอนได้ (minWidth ~780px = 1 ชม.≈28px)
// + ป้ายปลายทาง sticky ซ้าย · desktop ยังเต็มจอเดียวไม่มี scroll ตาม UI-CONVENTIONS §6 เหมือนเดิมเป๊ะ
const FRAME_START = 8 * 60;
const SPAN = 1440;
const SPAN_MIN = 40;
const LANE_H = 28;
const LEFT_W = 130;

export default function InternalTimeBoard({ title, hint, groups, nowMin, breaks = [], onItemClick }) {
  const [collapsed, setCollapsed] = useState({});
  const isMobile = useIsMobile();
  const leftW = isMobile ? 96 : LEFT_W;
  const stickyLabel = (bg) => isMobile ? { position: 'sticky', left: 0, zIndex: 2, background: bg } : null;
  const hourMarks = Array.from({ length: 25 }, (_, i) => FRAME_START + i * 60);
  const showNow = nowMin != null && nowMin >= FRAME_START && nowMin <= FRAME_START + SPAN;
  const pct = (m) => ((m - FRAME_START) / SPAN) * 100;

  const lanesOf = (items) => {
    const laneEnd = [];
    const map = {};
    [...items].sort((a, b) => a.timeMin - b.timeMin).forEach(it => {
      let li = laneEnd.findIndex(end => it.timeMin >= end);
      if (li < 0) { li = laneEnd.length; laneEnd.push(0); }
      laneEnd[li] = it.timeMin + SPAN_MIN;
      map[it.id] = li;
    });
    return { map, count: Math.max(1, laneEnd.length) };
  };

  const breakBands = (breaks || []).map((b, i) => {
    const leftPct = Math.max(0, pct(b.s));
    const widthPct = Math.min(100 - leftPct, ((b.e - b.s) / SPAN) * 100);
    if (widthPct <= 0) return null;
    return (
      <div key={`brk-${i}`} title={`${b.label} — เวลาพัก`}
        style={{
          position: 'absolute', top: 0, bottom: 0, left: `${leftPct}%`, width: `${widthPct}%`,
          background: 'repeating-linear-gradient(45deg, rgba(148,163,184,0.18) 0px, rgba(148,163,184,0.18) 4px, transparent 4px, transparent 8px)',
          borderLeft: '1px dashed rgba(148,163,184,0.6)', borderRight: '1px dashed rgba(148,163,184,0.6)',
          zIndex: 0, pointerEvents: 'none',
        }}
      />
    );
  });

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>{title}</span>
        {hint && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{hint}</span>}
      </div>
      <div style={isMobile ? { overflowX: 'auto', WebkitOverflowScrolling: 'touch' } : undefined}>
      <div style={isMobile ? { minWidth: 780 } : undefined}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border2)', background: 'var(--bg2)', position: 'relative' }}>
        <div style={{ width: leftW, flexShrink: 0, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', borderRight: '1px solid var(--border2)', ...stickyLabel('var(--bg2)') }}>ปลายทาง · คลิกเพื่อย่อ/ขยาย</div>
        <div style={{ flex: 1, position: 'relative', height: 22 }}>
          {hourMarks.map((m, i) => (i % 2 === 0 &&
            <span key={m} style={{ position: 'absolute', left: `${pct(m)}%`, fontSize: 11, color: (m % 1440) === 480 || (m % 1440) === 1200 ? 'var(--text2)' : 'var(--muted)', fontWeight: (m % 1440) === 480 || (m % 1440) === 1200 ? 800 : 500, transform: m === FRAME_START + SPAN ? 'translateX(-100%)' : 'translateX(-50%)', top: 4, whiteSpace: 'nowrap' }}>
              {String(Math.floor(m / 60) % 24).padStart(2, '0')}:00
            </span>
          ))}
        </div>
        {/* ป้ายเวลาปัจจุบัน — มาตรฐานเดียวกับบอร์ด Heijunka */}
        {showNow && (
          <div className="now-chip" style={{ left: `calc(${leftW}px + (100% - ${leftW}px) * ${(nowMin - FRAME_START) / SPAN})` }}>
            ⏱ {String(Math.floor(nowMin / 60) % 24).padStart(2, '0')}:{String(nowMin % 60).padStart(2, '0')}
          </div>
        )}
      </div>
      {groups.length === 0 && (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>ไม่มีรายการในวันงานนี้</div>
      )}
      {groups.map(g => {
        const isCol = !!collapsed[g.key];
        const lanes = lanesOf(g.items);
        const rowH = isCol ? 26 : 10 + lanes.count * LANE_H;
        return (
          <div key={g.key} style={{ display: 'flex', borderTop: '1px solid var(--border)' }}>
            <div onClick={() => setCollapsed(m => ({ ...m, [g.key]: !m[g.key] }))}
              title={isCol ? 'คลิกเพื่อขยาย' : 'คลิกเพื่อย่อ'}
              style={{ width: leftW, flexShrink: 0, padding: '4px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text2)', borderRight: '1px solid var(--border2)', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center', cursor: 'pointer', userSelect: 'none', ...stickyLabel('var(--card)') }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ color: 'var(--muted)', marginRight: 4 }}>{isCol ? '▸' : '▾'}</span>{g.label}
              </span>
              {g.sub && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{g.sub}</span>}
            </div>
            <div style={{ flex: 1, position: 'relative', height: rowH }}>
              {hourMarks.map(m => (
                <div key={m} style={{ position: 'absolute', top: 0, bottom: 0, left: `${pct(m)}%`, width: 1, background: (m % 1440) === 1200 ? 'var(--border2)' : 'var(--border)' }} />
              ))}
              {breakBands}
              {g.items.map(it => {
                const left = pct(it.timeMin);
                if (isCol) {
                  return (
                    <div key={it.id} onClick={e => onItemClick?.(it.data, e.clientX, e.clientY)} title={it.title}
                      style={{ position: 'absolute', top: 8, width: 9, height: 9, borderRadius: '50%', left: `${Math.min(Math.max(left, 0), 98.5)}%`, background: it.color, border: '1.5px solid rgba(0,0,0,0.25)', cursor: onItemClick ? 'pointer' : 'default', zIndex: 1 }} />
                  );
                }
                return (
                  <div key={it.id} onClick={e => onItemClick?.(it.data, e.clientX, e.clientY)} title={it.title}
                    style={{
                      position: 'absolute', top: 5 + (lanes.map[it.id] || 0) * LANE_H, height: LANE_H - 6,
                      left: `${Math.min(Math.max(left, 0), 97)}%`, width: `${(SPAN_MIN / SPAN) * 100}%`, minWidth: 48,
                      background: `${it.color}22`, border: `1.5px solid ${it.color}cc`, borderRadius: 5, zIndex: 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                      cursor: onItemClick ? 'pointer' : 'default', boxSizing: 'border-box',
                    }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: it.color, whiteSpace: 'nowrap', lineHeight: 1 }}>{it.text}</span>
                  </div>
                );
              })}
              {/* Now marker — playhead ชมพูมาตรฐาน */}
              {showNow && <div className="now-line" style={{ left: `${pct(nowMin)}%` }} />}
            </div>
          </div>
        );
      })}
      </div>
      </div>
    </div>
  );
}
