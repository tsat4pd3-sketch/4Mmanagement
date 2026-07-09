import { useState } from 'react';

/* ─── Internal Time Board — บอร์ดเวลาสไตล์ Shipping Chart สำหรับงานส่งภายในโรงงาน ──
   ปลายทาง = ไลน์/จุดภายใน · กรอบวันงาน 08:00 → 08:00 · เต็ม 24 ชม.ในจอเดียว
   เวลาชนกันแยกเลนอัตโนมัติ · คลิกบล็อกส่ง callback ให้หน้าแม่เปิด popup
   คลิกชื่อปลายทางเพื่อย่อ/ขยาย (โหมดย่อเหลือจุดสถานะ)

   props:
   - groups: [{ key, label, sub, items: [{ id, timeMin, color, text, title, data }] }]
     timeMin = นาทีบนกรอบวันงาน (08:00 = 480, ก่อนตี 8 บวก 1440 แล้ว)
   - nowMin: นาทีปัจจุบันบนกรอบเดียวกัน (null = ไม่ใช่วันงานปัจจุบัน ไม่วาดเส้น)
   - onItemClick(data, x, y)
   - hint: ข้อความช่วยเหลือมุมขวา */
const FRAME_START = 8 * 60;
const SPAN = 1440;
const SPAN_MIN = 40;
const LANE_H = 28;

export default function InternalTimeBoard({ title, hint, groups, nowMin, onItemClick }) {
  const [collapsed, setCollapsed] = useState({});
  const hourMarks = Array.from({ length: 25 }, (_, i) => FRAME_START + i * 60);

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

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>{title}</span>
        {hint && <span style={{ fontSize: 10, color: 'var(--muted)' }}>{hint}</span>}
      </div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border2)', background: 'var(--bg2)' }}>
        <div style={{ width: 130, flexShrink: 0, padding: '3px 10px', fontSize: 9, fontWeight: 700, color: 'var(--muted)', borderRight: '1px solid var(--border2)' }}>ปลายทาง · คลิกเพื่อย่อ/ขยาย</div>
        <div style={{ flex: 1, position: 'relative', height: 16 }}>
          {hourMarks.map((m, i) => (i % 2 === 0 &&
            <span key={m} style={{ position: 'absolute', left: `${((m - FRAME_START) / SPAN) * 100}%`, fontSize: 8, color: (m % 1440) === 480 || (m % 1440) === 1200 ? 'var(--text2)' : 'var(--muted)', fontWeight: (m % 1440) === 480 || (m % 1440) === 1200 ? 800 : 500, transform: 'translateX(-50%)', top: 3, whiteSpace: 'nowrap' }}>
              {String(Math.floor(m / 60) % 24).padStart(2, '0')}
            </span>
          ))}
        </div>
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
              style={{ width: 130, flexShrink: 0, padding: '4px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text2)', borderRight: '1px solid var(--border2)', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center', cursor: 'pointer', userSelect: 'none' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ color: 'var(--muted)', marginRight: 4 }}>{isCol ? '▸' : '▾'}</span>{g.label}
              </span>
              {g.sub && <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 600 }}>{g.sub}</span>}
            </div>
            <div style={{ flex: 1, position: 'relative', height: rowH }}>
              {hourMarks.map(m => (
                <div key={m} style={{ position: 'absolute', top: 0, bottom: 0, left: `${((m - FRAME_START) / SPAN) * 100}%`, width: 1, background: (m % 1440) === 1200 ? 'var(--border2)' : 'var(--border)' }} />
              ))}
              {nowMin != null && nowMin >= FRAME_START && nowMin <= FRAME_START + SPAN && (
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${((nowMin - FRAME_START) / SPAN) * 100}%`, width: 1.5, background: 'rgba(77,159,255,0.8)', zIndex: 2, pointerEvents: 'none' }} />
              )}
              {g.items.map(it => {
                const left = ((it.timeMin - FRAME_START) / SPAN) * 100;
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
                      left: `${Math.min(Math.max(left, 0), 97)}%`, width: `${(SPAN_MIN / SPAN) * 100}%`, minWidth: 44,
                      background: `${it.color}22`, border: `1.5px solid ${it.color}cc`, borderRadius: 5, zIndex: 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                      cursor: onItemClick ? 'pointer' : 'default', boxSizing: 'border-box',
                    }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: it.color, whiteSpace: 'nowrap', lineHeight: 1 }}>{it.text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
