/* ═══ กราฟแท่งรายวัน — มีแกน Y + ตัวเลขบนแท่ง (UI-CONVENTIONS §5.2) ═══
   2026-08-19 · คำสั่ง user: "กราฟพวกนี้ชอบไม่มีแกนแนวตั้งบอก ไม่มี label ตัวเลข ... มันดูยาก"

   ทำไมต้องมีแกน Y: จอ TV / จอทัชหน้าไลน์ **ไม่มี hover** → ถ้าไม่มีแกนและไม่มีตัวเลข
   คนอ่านได้แค่ "แท่งนี้สูงกว่าแท่งนั้น" ซึ่งตอบคำถามงานไม่ได้สักข้อ

   ⚠️ กฎที่ห้ามแก้ย้อน (ทั้งหมดเป็นบทเรียนจากกราฟที่เคยอ่านไม่ออก):
   1. **แกนวันต่อเนื่อง ห้ามข้ามวันที่ไม่มีข้อมูล** — วันว่าง = ตอเทาเตี้ย (เห็นช่วงหยุดคาตา)
   2. **ตัวเลขบนแท่งต้องมีเสมอ** — แน่นเกินก็เว้นแท่งเว้นเลข **ห้ามลดฟอนต์ต่ำกว่า 11px**
   3. **แกน Y ต้องมีเส้น grid** ไม่ใช่แค่ตัวเลขลอย — ไม่งั้นเทียบความสูงข้ามแท่งไม่ได้
   4. ค่าที่ไม่ใช่ 0 แต่เตี้ยมาก ต้องสูงอย่างน้อย 2px (ไม่งั้นหายไปเลย ดูเหมือนไม่มีของ) */

import { useMemo } from 'react';

const NICE = [1, 2, 2.5, 5, 10];
/** หาสเกลแกน Y ที่อ่านสบาย (ลงท้าย 1/2/2.5/5/10 × 10^n) แล้วคืนเส้น grid
 *  integer = นับเป็นชิ้น → step ต่ำสุด 1 (ไม่งั้นได้แกน 0.25 / 0.5 ซึ่งไม่มีความหมายกับจำนวนชิ้น) */
export function niceTicks(max, want = 4, integer = true) {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  const raw = max / want;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = (NICE.find((n) => n * mag >= raw) || 10) * mag;
  if (integer && step < 1) step = 1;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { top, ticks };
}

const fmtNum = (n) => Number(n || 0).toLocaleString('en-US');

/**
 * @param {Array} data          [{ key, label, empty?, segs:[{v,color,name}], marker?:{v,color,name} }]
 *                              segs = แท่งซ้อน (เรียงล่าง→บน) · marker = เส้นขีดขวางบนแท่ง (เช่น demand)
 * @param {number} height       ความสูงพื้นที่กราฟ (px)
 * @param {string} unit         หน่วยในแกน Y / tooltip
 * @param {function} valueLabel (row) => string|null  ตัวเลขบนหัวแท่ง (null = ไม่โชว์)
 */
export default function DailyBars({ data, height = 150, unit = '', valueLabel, minBar = 16, maxBar = 54 }) {
  const rows = data || [];
  const max = useMemo(() => Math.max(
    0,
    ...rows.map((r) => Math.max(
      (r.segs || []).reduce((a, s) => a + (Number(s.v) || 0), 0),
      Number(r.marker?.v) || 0,
    )),
  ), [rows]);
  const { top, ticks } = useMemo(() => niceTicks(max), [max]);

  /* ตัวเลขบนแท่งแน่นเกินไป → เว้นแท่งเว้นเลข (ห้ามลดฟอนต์ — กฎข้อ 2)
     ~34px ต่อเลข 1 ตัว จากการวัดจริงกับเลข 4-5 หลัก */
  const everyN = rows.length <= 16 ? 1 : rows.length <= 34 ? 2 : rows.length <= 60 ? 3 : 5;

  if (!rows.length) return null;

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {/* ── แกน Y ── */}
      <div style={{ width: 46, height: height + 18, position: 'relative', flex: '0 0 auto' }}>
        {ticks.map((t) => (
          <div key={t} style={{
            position: 'absolute', right: 4, bottom: (t / top) * height - 7,
            fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', lineHeight: '14px',
          }}>{fmtNum(t)}</div>
        ))}
      </div>

      {/* ── พื้นที่กราฟ (เลื่อนแนวนอนเองได้ตามกฎของกว้าง §6) ── */}
      <div style={{ flex: 1, minWidth: 0, overflowX: 'auto' }}>
        <div style={{ position: 'relative', minWidth: rows.length * minBar }}>
          {/* เส้น grid — ต้องมี ไม่งั้นเทียบความสูงข้ามแท่งไม่ได้ */}
          <div style={{ position: 'absolute', inset: `0 0 18px 0`, pointerEvents: 'none' }}>
            {ticks.map((t) => (
              <div key={t} style={{
                position: 'absolute', left: 0, right: 0, bottom: (t / top) * height,
                borderTop: `1px ${t === 0 ? 'solid' : 'dashed'} var(--border)`, opacity: t === 0 ? 1 : 0.5,
              }} />
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height, position: 'relative' }}>
            {rows.map((r, i) => {
              const totalV = (r.segs || []).reduce((a, s) => a + (Number(s.v) || 0), 0);
              const lbl = valueLabel ? valueLabel(r) : (r.empty ? null : fmtNum(totalV));
              const tip = [r.label,
                ...(r.segs || []).filter((s) => s.v > 0).map((s) => `${s.name}: ${fmtNum(s.v)}${unit}`),
                r.marker?.v ? `${r.marker.name}: ${fmtNum(r.marker.v)}${unit}` : null,
                r.empty ? 'ไม่มีการผลิต' : null].filter(Boolean).join('\n');
              return (
                <div key={r.key} title={tip} style={{
                  flex: `1 0 ${minBar}px`, maxWidth: maxBar, height: '100%',
                  display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', position: 'relative',
                }}>
                  {lbl && i % everyN === 0 && (
                    <div style={{
                      position: 'absolute', bottom: `${Math.min(96, (totalV / top) * 100)}%`, left: '50%',
                      transform: 'translateX(-50%)', fontSize: 11, fontWeight: 700, color: 'var(--text2)',
                      whiteSpace: 'nowrap', marginBottom: 2, pointerEvents: 'none',
                    }}>{lbl}</div>
                  )}
                  {/* แท่งซ้อน — เรียงบนลงล่างใน DOM แต่ข้อมูลเรียงล่าง→บน จึง reverse */}
                  {[...(r.segs || [])].reverse().filter((s) => Number(s.v) > 0).map((s, k, arr) => (
                    <div key={s.name} style={{
                      background: s.color, height: `${Math.max(2, (Number(s.v) / top) * 100)}%`,
                      borderRadius: k === 0 ? '3px 3px 0 0' : 0,
                    }} />
                  ))}
                  {r.empty && <div style={{ background: 'var(--border2)', height: 3 }} />}
                  {/* เส้นขีดเป้า/ความต้องการ — ไม่ใช่แท่ง เพื่อไม่ให้สับสนกับของที่ผลิตจริง */}
                  {r.marker?.v > 0 && (
                    <div style={{
                      position: 'absolute', left: 0, right: 0, bottom: `${Math.min(100, (r.marker.v / top) * 100)}%`,
                      borderTop: `2px solid ${r.marker.color}`, pointerEvents: 'none',
                    }} />
                  )}
                </div>
              );
            })}
          </div>

          {/* ── ป้ายวัน (≥11px · แน่นก็เว้นแท่งเว้นป้าย ห้ามลดฟอนต์) ── */}
          <div style={{ display: 'flex', gap: 3, height: 18 }}>
            {rows.map((r, i) => (
              <div key={r.key} style={{
                flex: `1 0 ${minBar}px`, maxWidth: maxBar, fontSize: 11, color: 'var(--muted)',
                textAlign: 'center', whiteSpace: 'nowrap', overflow: 'visible', marginTop: 2,
              }}>{i % everyN === 0 ? r.label : ''}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
