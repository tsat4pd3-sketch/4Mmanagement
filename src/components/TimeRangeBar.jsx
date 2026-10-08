import { useMemo } from 'react';
import {
  TIME_SCALES, TIME_PERIODS, LOOKBACK_DAYS, scaleOf, matchPreset, matchPeriod,
  rangeDays, scaleWarning, periodRange, presetRange, nextBucket, stepBucket, capBucket,
  bucketIndex, autoBucket,
} from '../utils/timeRange';

/* ══ ⏱️ TimeRangeBar — แถบกรองช่วงเวลามาตรฐาน ใช้เหมือนกันทุกหน้า (2026-09-23 · คำสั่ง user) ══
 *
 * *"ระบบการกรองช่วงเวลา อยากไห้เป็นมาตรฐานเดียวกัน มีเหมือนกันทุกหน้า คือ เลือกสเกลที่จะดู
 *   รายวัน สัปดาห์ เดือน ปี และกรอบเวลา และ scope 30วันย้อนหลัง 60 90 120"*
 *
 * เรียงซ้าย→ขวาตามลำดับที่คนคิด: **ดูช่วงไหน → ย้อนหลังเท่าไหร่ → วันเป๊ะๆ → ของเฉพาะหน้า → โหลด**
 *   [วันนี้|สัปดาห์นี้|เดือนนี้|ปีนี้|หลายปี] [30|60|90|120 ย้อนหลัง] [จาก]–[ถึง] {children} [🔄]
 *   แถวล่าง: แท่งละ [− ละเอียดขึ้น] «1 วัน» [หยาบลง +]   + คำเตือน/เพดานของจอนี้
 *
 * ── 🪜 บันไดความละเอียด (23/09) ────────────────────────────────────────────────────
 * *"อยากดูแบบเจาะวันโชว์สเกลชั่วโมง ดูสัปดาห์หรือเดือนสเกลรายวัน ดูรายปีสเกลเดือน"*
 * ปุ่มช่วง = "ดูช่วงไหน" · ขนาดแท่งไล่ลงมาเอง 1 ขั้น (สูตรอยู่ `utils/timeRange.js` ห้ามคิดในหน้า)
 *   · **ออโต้เป็นค่าเริ่มต้น แต่กด ละเอียดขึ้น/หยาบลง ทับได้** แล้วออโต้จะไม่มาทับซ้ำ (`nextBucket`)
 *   · **จอต้องเขียนว่าตอนนี้แท่งละอะไร** ไม่งั้นคนอ่านกราฟผิดโดยไม่รู้ตัว
 *   · `finest` = เพดานความละเอียดของ *ข้อมูลหน้านั้น* — จอที่ข้อมูลไม่มีเวลา (OEE = work_date+กะ)
 *     ส่ง `finest="day"` ⇒ ปุ่ม "วันนี้" ถูกซ่อน เพราะจะได้แท่งเดียว = กราฟหลอก
 *   · `multiYear` = เปิดปุ่ม "หลายปี" ได้**เฉพาะจอที่มี RPC rollup ฝั่งเซิร์ฟเวอร์แล้ว**
 *     (กฎเหล็ก CLAUDE.md: โหมดปีห้ามโหลดแถวดิบ · ปิดอยู่ = โชว์เทาพร้อมเหตุผล ไม่ใช่ซ่อน)
 *
 * ── กติกาที่ฝังไว้ อย่าไปรื้อ ────────────────────────────────────────────────────────
 * 1. **ปุ่มช่วง/ปุ่มย้อนหลังไม่ใช่ "โหมด"** — กดแล้วเติมวันลงช่อง จากนั้นคนแก้วันต่อได้ทันที
 *    ไฮไลต์แค่ตอนที่ช่วงตรงเป๊ะ (`matchPreset`/`matchPeriod`) ⇒ พอแก้วันเอง ปุ่มก็เลิกไฮไลต์เอง
 *    **ห้ามทำเป็น state แยก** (จะเกิดคำถาม "ทำไมกดวันแล้วเด้งกลับ")
 * 2. **สเกลที่ไม่เข้ากับช่วง = เตือน ไม่บล็อก** (`scaleWarning`) — บางทีคนตั้งใจดูแท่งเดียว
 *    แต่ต้องเขียนบนจอ **ห้ามวาดกราฟแท่งเดียวเฉยๆ แล้วปล่อยให้เข้าใจว่านั่นคือแนวโน้ม**
 * 3. **ส่วนที่หน้านั้นไม่ได้ใช้ ให้ซ่อน** (`scales={null}` / `presets={[]}`) —
 *    หน้าที่ไม่ได้แบ่งถังเวลา เอาปุ่มขนาดแท่งมาโชว์ = ปุ่มตาย ซึ่งแย่กว่าไม่มีปุ่ม
 * 4. ช่อง `<input type="date">` **ต้องกำหนด width เอง** — `index.css` ตั้ง `input{width:100%}`
 *    ทั้งแอป ไม่กำหนดแล้วมันกินเต็มแถวแล้วดันปุ่มแตกบรรทัด (กับดักที่เคยกัดหลายหน้า)
 * 5. จำนวนวันที่เลือกอยู่ **เขียนให้เห็นเสมอ** — คนอ่าน "25/06 ถึง 23/09" แล้วบอกไม่ได้ว่ากี่วัน
 * 6. **`onView` ไม่ส่ง = ปุ่มช่วง/ขนาดแท่งไม่โผล่** (ต้องเขียน URL ทีเดียวทั้ง from+to+scale
 *    ไม่งั้นได้ประวัติ 2 ชั้น = กด Back ครั้งเดียวไม่กลับ) — หน้าเก่ายังทำงานเหมือนเดิมทุกอย่าง
 */

/* 2026-09-24 UI-STANDARD §2: สูงเท่าช่องกรองอื่น (--ctl-h) · ตัว/มุมจาก token เดียวกัน
   เดิมช่องวันที่ของแถบนี้สูง 29px วางข้าง dropdown ของหน้า 33–35px = แถบเดียวสูงไม่เท่ากัน */
const btnBase = {
  height: 'var(--ctl-h)', padding: '0 11px', borderRadius: 'var(--ctl-r)', fontSize: 'var(--ctl-fs)', fontWeight: 700,
  cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: 1,
};

export default function TimeRangeBar({
  scale, from, to, today,
  onScale, onFrom, onTo, onPreset, onView,
  scales = TIME_SCALES.map(s => s.key),
  presets = LOOKBACK_DAYS,
  finest = 'day', coarsest = 'year', multiYear = false, multiYearNote,
  periods, onReload, loading = false, note, children, style,
}) {
  const days = rangeDays(from, to);
  const active = useMemo(() => matchPreset(from, to, today, presets), [from, to, today, presets]);
  const showBucket = scales?.length > 0 && !!onView;
  const curPeriod = useMemo(() => (onView ? matchPeriod(from, to, today) : null), [onView, from, to, today]);
  const warn = useMemo(() => (scales?.length ? scaleWarning(scale, from, to) : null), [scales, scale, from, to]);

  /* ปุ่มช่วงที่ "แท่งของมันละเอียดกว่าเพดานของจอนี้" = กดแล้วได้แท่งเดียว ⇒ ซ่อน ไม่ใช่โชว์ปุ่มหลอก
     (เช่น OEE ข้อมูลละเอียดสุดคือรายวัน ⇒ "วันนี้" ที่ควรได้ 24 แท่งชั่วโมง จะเหลือแท่งเดียว) */
  const periodList = useMemo(() => (onView ? TIME_PERIODS.filter(p => (periods
    ? periods.includes(p.key)
    : bucketIndex(p.bucket) >= bucketIndex(finest))) : []), [onView, periods, finest]);

  const on = (isOn) => ({
    ...btnBase,
    background: isOn ? 'var(--accent)' : 'var(--bg3)',
    color: isOn ? 'var(--accent-ink)' : 'var(--text)',
    border: `1px solid ${isOn ? 'var(--accent)' : 'var(--border2)'}`,
  });

  /** เปลี่ยนช่วง → ขนาดแท่งตามบันได (ออโต้เฉพาะตอนที่ค่าเดิมยังเป็นค่าออโต้อยู่) */
  const applyRange = (nf, nt, period = null) => {
    if (!onView) { if (nf !== from) onFrom?.(nf); if (nt !== to) onTo?.(nt); return; }
    const patch = { from: nf, to: nt };
    if (showBucket) {
      patch.scale = nextBucket({
        curBucket: scale, prevFrom: from, prevTo: to, from: nf, to: nt, period, finest, coarsest,
      });
    }
    onView(patch);
  };
  const setBucket = (dir) => {
    const nb = stepBucket(scale, dir, { finest, coarsest });
    if (nb !== scale) (onView || onScale)?.(onView ? { scale: nb } : nb);
  };

  const capped = capBucket(autoBucket(from, to), finest, coarsest) !== autoBucket(from, to);
  const finestLabel = scaleOf(finest)?.short;

  return (
    <div className="filter-bar trb" style={style}>
      <div className="trb-row">
        {periodList.length > 0 && (
          <div style={{ display: 'flex', gap: 4 }} role="group" aria-label="ช่วงที่ดู">
            {periodList.map(p => {
              const locked = p.heavy && !multiYear;
              return (
                <button key={p.key} disabled={locked}
                  onClick={() => { const r = periodRange(p.key, today); if (r) applyRange(r.from, r.to, p.key); }}
                  style={{ ...on(curPeriod === p.key), opacity: locked ? 0.45 : 1, cursor: locked ? 'not-allowed' : 'pointer' }}
                  title={locked
                    ? (multiYearNote || 'ยังไม่เปิด — จอนี้ยังไม่มีตัวสรุปฝั่งเซิร์ฟเวอร์ (RPC rollup) '
                      + 'การดึงข้อมูลดิบหลายปีลงเบราว์เซอร์ทำให้โควต้าข้อมูลบานปลาย')
                    : `ดู${p.label} — แท่งละ 1 ${scaleOf(capBucket(p.bucket, finest, coarsest))?.short}`}>
                  {locked ? `🔒 ${p.label}` : p.label}
                </button>
              );
            })}
          </div>
        )}

        {presets?.length > 0 && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} role="group" aria-label="ช่วงย้อนหลัง">
            <span className="filter-label">ย้อนหลัง</span>
            {presets.map(d => (
              <button key={d}
                onClick={() => {
                  /* ปุ่มย้อนหลังก็ไล่บันไดเหมือนกัน (90 วัน → แท่งรายสัปดาห์ 13 แท่ง)
                     แต่ไม่มี "ชื่อช่วง" ⇒ ส่ง period=null ให้ `autoBucket` ตัดสินจากจำนวนวัน */
                  const r = presetRange(d, today);
                  if (r && onView) applyRange(r.from, r.to); else onPreset?.(d);
                }}
                style={{ ...on(active === d), padding: '5px 9px' }}
                title={`ตั้งกรอบเวลาเป็น ${d} วันล่าสุด (นับถึงวันทำงานวันนี้) — แก้วันต่อเองได้`}>{d}</button>
            ))}
            <span className="filter-label">วัน</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="date" value={from || ''} max={to || undefined}
            onChange={e => applyRange(e.target.value, to)} aria-label="ตั้งแต่วันที่" />
          <span className="filter-label">ถึง</span>
          <input type="date" value={to || ''} min={from || undefined}
            onChange={e => applyRange(from, e.target.value)} aria-label="ถึงวันที่" />
          {days != null && (
            <span className="filter-count">
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

      {showBucket && (
        <div className="trb-row">
          <span className="filter-label">แท่งละ</span>
          <button onClick={() => setBucket(-1)} disabled={scale === finest}
            style={{ ...btnBase, height: 28, padding: '0 9px', background: 'var(--bg3)', color: 'var(--text)',
              border: '1px solid var(--border2)', opacity: scale === finest ? 0.4 : 1 }}
            title="ละเอียดขึ้น 1 ขั้น">− ละเอียดขึ้น</button>
          <span style={{
            fontSize: 12.5, fontWeight: 700, color: 'var(--accent)', minWidth: 74, textAlign: 'center',
          }}>1 {scaleOf(scale)?.short || '—'}</span>
          <button onClick={() => setBucket(1)} disabled={scale === coarsest}
            style={{ ...btnBase, height: 28, padding: '0 9px', background: 'var(--bg3)', color: 'var(--text)',
              border: '1px solid var(--border2)', opacity: scale === coarsest ? 0.4 : 1 }}
            title="หยาบลง 1 ขั้น">หยาบลง +</button>
          {/* กฎความซื่อสัตย์: ละเอียดกว่านี้ไม่ได้ ต้องบอกว่าทำไม ห้ามให้คนกดแล้วงงว่าปุ่มเสีย */}
          {capped && finest !== 'hour' && (
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              · จอนี้ละเอียดสุดได้ราย{finestLabel} (ข้อมูลต้นทางไม่ได้เก็บเวลาที่ละเอียดกว่านี้)
            </span>
          )}
        </div>
      )}

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
