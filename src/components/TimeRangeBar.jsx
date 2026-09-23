import { useMemo } from 'react';
import {
  TIME_SCALES, LOOKBACK_DAYS, scaleOf, matchPreset, rangeDays, scaleWarning,
} from '../utils/timeRange';

/* ══ ⏱️ TimeRangeBar — แถบกรองช่วงเวลามาตรฐาน ใช้เหมือนกันทุกหน้า (2026-09-23 · คำสั่ง user) ══
 *
 * *"ระบบการกรองช่วงเวลา อยากไห้เป็นมาตรฐานเดียวกัน มีเหมือนกันทุกหน้า คือ เลือกสเกลที่จะดู
 *   รายวัน สัปดาห์ เดือน ปี และกรอบเวลา และ scope 30วันย้อนหลัง 60 90 120"*
 *
 * เรียงซ้าย→ขวาตามลำดับที่คนคิด: **ดูละเอียดแค่ไหน → ดูช่วงไหน → ของเฉพาะหน้า → โหลด**
 *   [รายวัน|รายสัปดาห์|รายเดือน|รายปี]  [30|60|90|120 วันย้อนหลัง]  [จาก]ถึง[ถึง]  {children}  [🔄]
 *
 * ── กติกาที่ฝังไว้ อย่าไปรื้อ ────────────────────────────────────────────────────────
 * 1. **ปุ่มย้อนหลังไม่ใช่ "โหมด"** — กดแล้วเติมวันลงช่อง จากนั้นคนแก้วันต่อได้ทันที
 *    ไฮไลต์ปุ่มแค่ตอนที่ช่วงตรงเป๊ะ (`matchPreset`) ⇒ พอแก้วันเอง ปุ่มก็เลิกไฮไลต์เอง
 *    **ห้ามทำเป็น state แยก** (จะเกิดคำถาม "ทำไมกดวันแล้วเด้งกลับ")
 * 2. **สเกลที่ไม่เข้ากับช่วง = เตือน ไม่บล็อก** (`scaleWarning`) — บางทีคนตั้งใจดูแท่งเดียว
 *    แต่ต้องเขียนบนจอ **ห้ามวาดกราฟแท่งเดียวเฉยๆ แล้วปล่อยให้เข้าใจว่านั่นคือแนวโน้ม**
 * 3. **ส่วนที่หน้านั้นไม่ได้ใช้ ให้ซ่อน** (`scales={null}` / `presets={[]}`) —
 *    หน้าที่ไม่ได้แบ่งถังเวลา เอาปุ่มสเกลมาโชว์ = ปุ่มตาย ซึ่งแย่กว่าไม่มีปุ่ม
 * 4. ช่อง `<input type="date">` **ต้องกำหนด width เอง** — `index.css` ตั้ง `input{width:100%}`
 *    ทั้งแอป ไม่กำหนดแล้วมันกินเต็มแถวแล้วดันปุ่มแตกบรรทัด (กับดักที่เคยกัดหลายหน้า)
 * 5. จำนวนวันที่เลือกอยู่ **เขียนให้เห็นเสมอ** — คนอ่าน "25/06 ถึง 23/09" แล้วบอกไม่ได้ว่ากี่วัน
 */

const btnBase = {
  padding: '5px 11px', borderRadius: 8, fontSize: 12.5, fontWeight: 700,
  cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: 1.5,
};

export default function TimeRangeBar({
  scale, from, to, today,
  onScale, onFrom, onTo, onPreset,
  scales = TIME_SCALES.map(s => s.key),
  presets = LOOKBACK_DAYS,
  onReload, loading = false, note, children, style,
}) {
  const days = rangeDays(from, to);
  const active = useMemo(() => matchPreset(from, to, today, presets), [from, to, today, presets]);
  const warn = useMemo(() => (scales?.length ? scaleWarning(scale, from, to) : null), [scales, scale, from, to]);

  const on = (isOn) => ({
    ...btnBase,
    background: isOn ? 'var(--accent)' : 'var(--bg3)',
    color: isOn ? '#fff' : 'var(--text)',
    border: `1px solid ${isOn ? 'var(--accent)' : 'var(--border2)'}`,
  });
  const dateSt = {
    width: 148, padding: '5px 8px', fontSize: 12.5, borderRadius: 8,
    background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)',
  };

  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
      padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, ...style,
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {scales?.length > 0 && (
          <div style={{ display: 'flex', gap: 4 }} role="group" aria-label="สเกลเวลา">
            {TIME_SCALES.filter(s => scales.includes(s.key)).map(s => (
              <button key={s.key} onClick={() => onScale?.(s.key)} style={on(scale === s.key)}
                title={`รวมข้อมูลเป็นถังละ 1 ${s.short}`}>{s.label}</button>
            ))}
          </div>
        )}

        {presets?.length > 0 && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} role="group" aria-label="ช่วงย้อนหลัง">
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>ย้อนหลัง</span>
            {presets.map(d => (
              <button key={d} onClick={() => onPreset?.(d)} style={{ ...on(active === d), padding: '5px 9px' }}
                title={`ตั้งกรอบเวลาเป็น ${d} วันล่าสุด (นับถึงวันทำงานวันนี้) — แก้วันต่อเองได้`}>{d}</button>
            ))}
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>วัน</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="date" value={from || ''} max={to || undefined}
            onChange={e => onFrom?.(e.target.value)} style={dateSt} aria-label="ตั้งแต่วันที่" />
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>ถึง</span>
          <input type="date" value={to || ''} min={from || undefined}
            onChange={e => onTo?.(e.target.value)} style={dateSt} aria-label="ถึงวันที่" />
          {days != null && (
            <span style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              ({days.toLocaleString()} วัน)
            </span>
          )}
        </div>

        {children}

        {onReload && (
          <button onClick={onReload} disabled={loading}
            style={{ ...btnBase, background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)', opacity: loading ? 0.6 : 1 }}>
            {loading ? '⏳ กำลังโหลด…' : '🔄 โหลด'}
          </button>
        )}
      </div>

      {/* เตือนเท่านั้น — ไม่บล็อก ไม่แก้สเกลให้เอง (ข้อ 2 ด้านบน) */}
      {warn && (
        <div style={{ fontSize: 11.5, color: '#f59e0b', lineHeight: 1.6 }}>⚠️ {warn}</div>
      )}
      {note && <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>{note}</div>}
    </div>
  );
}

/** ป้ายสรุปช่วงที่เลือก — เอาไปใส่หัวกราฟ/หัวรายงานให้ตรงกันทุกหน้า */
export function rangeText(scale, from, to) {
  const n = rangeDays(from, to);
  const s = scaleOf(scale);
  return `${from} ถึง ${to}${n != null ? ` (${n.toLocaleString()} วัน)` : ''}${s ? ` · ${s.label}` : ''}`;
}
