/* ══ 🔎 InsightList — รายการ "สรุปว่าเกิดอะไรขึ้น" ในป็อปอัพกราฟ (2026-11-16 · คำสั่ง user) ═══════
   user: *"popup graph kpi ที่กดแว่นขยาย ดู insight ไม่เกิน 3-4 บรรทัดพอ บางหน้า insight เยอะ จน กราฟหาย
           ต้องรักษาความชัดเจนของกราฟไห้ได้ insight เป็นส่วนเสริม"*

   ┌─ หลักออกแบบ 3 ข้อ (ห้ามถอดข้อไหน) ───────────────────────────────────────────────┐
   │ 1. **กราฟคือพระเอก** — โชว์แค่ 3 ข้อแรก × ≤2 บรรทัด (+ปุ่มกาง) ⇒ ความสูงกล่องคงที่           │
   │    insight 2 ข้อหรือ 12 ข้อ กราฟได้พื้นที่เท่ากันเสมอ · ผู้เรียกต้องครอบกล่องนี้ด้วยพื้นที่ที่มีเพดาน  │
   │    (รางขวาใน popup 🔍 หรือชั้นล่างเพดาน 30%) แล้วปล่อยให้ "กาง" เลื่อนในนั้น                   │
   │ 2. **ส่วนเกินห้ามหายเงียบ** (กฎความซื่อสัตย์ของจอ) — ซ่อนกี่ข้อต้องเขียนบนปุ่ม                  │
   │    และถ้าข้อที่โชว์ถูกตัดท้าย (…) ต้องบอกด้วยว่า "ดูข้อความเต็ม" ได้                           │
   │ 3. **สำคัญก่อน** — ลำดับมาจาก `INSIGHT_PRIO` ใน `src/utils/kpiInsight.js` (เรียงมาแล้ว)        │
   │    กล่องนี้ **ไม่เรียง ไม่ตัดสิน ไม่แต่งข้อความ** — วาดตามที่ได้มาเท่านั้น                        │
   └────────────────────────────────────────────────────────────────────────────────────┘
   🔴 ตัวตัด = `-webkit-line-clamp` (default 2 บรรทัด/ข้อ · Chrome 6+ ⇒ ผ่านเพดาน Chromium 94)
      **ห้ามใช้ `whiteSpace:'nowrap'`** — ประโยคไทยถูกตัดกลางคำที่ ~45 ตัวอักษร พาดหัว "เกินเป้าเท่าไหร่" หายไปครึ่ง
   🔴 ฟอนต์พื้น 11px (จอ TV · ด่าน font-min-11) — แน่นเกินให้ลดจำนวนข้อ **ห้ามลดฟอนต์**
   📄 UI-CONVENTIONS §6.38 */
import { useState, useRef, useLayoutEffect } from 'react';
import { toneVar } from '../utils/statusTone';
import { tr } from '../utils/i18n';

/** จำนวนข้อที่โชว์ตอนย่อ — 3 ข้อ (เพดานที่ user สั่งไว้ 16/11 "ไม่เกิน 3-4 บรรทัดพอ") */
export const INSIGHT_SHOWN = 3;

export default function InsightList({ k = 1, items = [], max = INSIGHT_SHOWN, lines = 2, empty = null, label = null }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const [clipped, setClipped] = useState(false);
  const fs = (n) => Math.max(11, Math.round(n * k));
  const sig = items.map((x) => `${x.icon}${x.text}`).join('¦');   // 🔴 dep ต้องเป็น primitive (array ใน deps = วัดใหม่ทุกเฟรม)

  /* ข้อที่โชว์ถูกตัดท้ายจริงไหม — วัดของที่วาดแล้ว ไม่เดาจากความยาวตัวอักษร (ความกว้างกล่องต่างกันทุกจอ) */
  useLayoutEffect(() => {
    if (open) { setClipped(false); return; }
    const el = boxRef.current;
    if (!el) return;
    setClipped([...el.querySelectorAll('[data-ins-txt]')].some((s) => s.scrollHeight > s.clientHeight + 1));
  }, [open, sig, k, lines]);

  if (!items.length) {
    return empty ? <div style={{ fontSize: fs(11), lineHeight: 1.4, color: 'var(--muted)' }}>{empty}</div> : null;
  }
  const shown = open ? items : items.slice(0, max);
  const rest = items.length - shown.length;
  const more = rest > 0 || clipped;
  return (
    <div style={{ display: 'grid', gap: Math.max(2, Math.round(3 * k)), alignContent: 'start', minWidth: 0 }}>
      {label && (
        <div style={{ fontSize: fs(10.5), fontWeight: 800, color: 'var(--muted)', letterSpacing: .2 }}>
          {label} {items.length > max && <span style={{ fontWeight: 700 }}>({open || max === 0 ? items.length : `${max}/${items.length}`})</span>}
        </div>
      )}
      <div ref={boxRef} style={{ display: 'grid', gap: Math.max(2, Math.round(3 * k)), alignContent: 'start', minWidth: 0 }}>
        {shown.map((l, i) => (
          <div key={`${l.icon}${i}`} title={l.text}
            style={{ display: 'flex', gap: 6, fontSize: fs(11.5), lineHeight: 1.4, minWidth: 0 }}>
            <span style={{ flexShrink: 0 }}>{l.icon}</span>
            <span data-ins-txt="1" style={{
              /* 🔴 โทน 'none' = "ไม่ได้ตัดสินว่าดี/แย่" ⇒ สีตัวหนังสือรอง **ไม่ใช่ `--muted`**
                 (ข้อความยาวสีจางอ่านไม่ออกบนจอ TV · สี good/warn/bad ยังมาจาก token ของสถานะเหมือนเดิม) */
              color: l.tone && l.tone !== 'none' ? toneVar(l.tone) : 'var(--text2)',
              fontWeight: l.tone === 'bad' ? 700 : 600, minWidth: 0, overflowWrap: 'anywhere',
              ...(open ? null : { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
            }}>{l.text}</span>
          </div>
        ))}
      </div>
      {(more || open) && (
        /* 🔴 ซ่อนแล้วต้องบอกว่าซ่อนอะไร — "อีก N ข้อ" (ข้อที่ไม่ได้โชว์) + "ข้อความเต็ม" (ข้อที่ถูกตัดท้าย) */
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
          title={open ? tr('ย่อให้เหลือข้อสำคัญ') : tr('กางดูรายละเอียดทั้งหมด (เลื่อนในกล่องนี้)')}
          style={{
            justifySelf: 'start', fontSize: fs(10.5), fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--r-md)',
            background: 'var(--bg3-surf)', color: 'var(--text2)', border: '1px solid var(--border2)', cursor: 'pointer',
          }}>
          {open ? `▴ ${tr('ย่อ')}` : `▾ ${rest > 0 ? `${tr('อีก')} ${rest} ${tr('ข้อ')}` : tr('ข้อความเต็ม')}${rest > 0 && clipped ? ` + ${tr('ข้อความเต็ม')}` : ''}`}
        </button>
      )}
    </div>
  );
}
