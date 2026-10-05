/* ══ 🏛️ ObeyaSheet — "แผ่นกระดาษ A4" ชุดกลางของห้อง OBEYA (2026-09-23) ═══════════════════════════
   แยกออกจาก ObeyaSqdcmBoard.jsx ตามคำสั่ง user 23/09: *"tab kpi กับ obeya มันควรจะรูปแบบเดียวกัน"*
   ⇒ แท็บ 📋 บอร์ด KPI ส่วนงาน และ 🖥️ จอ SQDCM วาดจากชิ้นเดียวกัน — ผังกริด A4 (`useSheetGrid`) ·
   แผ่น (`Sheet`) · ไฟสถานะ (`StatusLamp`) · หมายเหตุเตือน (`WarnNote`) · ช่องว่าง (`EmptyChart`)
   🔴 แก้หน้าตาแผ่นที่นี่ที่เดียว ห้าม copy ไปแก้ในหน้าใดหน้าหนึ่ง (ไม่งั้น 2 แท็บจะค่อยๆ หน้าตาต่างกันอีก)
   กติกาของผัง (คณิต A4 · ฟอนต์ขั้นต่ำ 11px · ไฟไม่กระพริบ · เทาต้องบอกว่าเทาเพราะอะไร) → docs/modules/obeya.md §2 */
import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { statusColor } from '../utils/obeyaKpi';
import { A4, GAP, chooseSheetGrid } from '../utils/sheetGrid';

/* คณิตของผัง (A4 · GAP · ตัวเลือกผัง) ย้ายไป `src/utils/sheetGrid.js` แล้ว (pure + มีเทส)
   re-export ไว้เพื่อไม่ต้องไล่แก้ import ของหน้าที่ใช้อยู่ */
export { A4, GAP, MIN_SHEET_W, chooseSheetGrid } from '../utils/sheetGrid';

/* ── ผังกระดาษ: วัดกล่องจริงแล้วเลือกจำนวนคอลัมน์ที่ "เต็มจอพอดีโดยไม่ต้องเลื่อน" ──────
   จอกว้าง (TV/PC) → 5×2 ตามคณิตข้างบน
   จอแคบ (มือถือ/แท็บเล็ตแนวตั้ง) → คืน `fit:false` + ขนาดแผ่นที่ "อ่านออก" (ไม่บีบให้เล็กกว่า 11px)
   🔴 **25/09 เปลี่ยนนโยบาย (คำสั่ง user):** แผ่นที่ลงไม่พอ **ห้ามปล่อยให้เลื่อน** อีกต่อไป
      ให้ผู้เรียกเอา `bh` (ความสูงกล่องที่วัดได้) ไปคำนวณว่าหน้าหนึ่งใส่ได้กี่แถว แล้ว**แบ่งหน้า**
      ด้วย `packPages()` + `<BoardPager>` แทน — ดู `src/utils/boardPager.js` */
export function useSheetGrid(ref, sheets = 10) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const apply = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    apply();
    if (typeof ResizeObserver === 'undefined') {      // เบราว์เซอร์เก่า = ยังต้องได้ขนาด ห้ามจอว่าง
      window.addEventListener('resize', apply);
      return () => window.removeEventListener('resize', apply);
    }
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return useMemo(() => chooseSheetGrid(box.w, box.h, sheets), [box, sheets]);
}
/* ── แผ่นกระดาษ 1 ใบ ──────────────────────────────────────────────────────────────
   หัวแผ่น = ชื่อแกน + ตัวเลขใหญ่ + Δ เทียบเป้า · กลาง = กราฟ · ท้าย = หมายเหตุ/ลิงก์
   ⚠️ ฟอนต์ต่ำสุด 11px เสมอแม้แผ่นเล็ก (กติกาจอ TV) — ถ้าเล็กกว่านั้นให้ลดจำนวนคอลัมน์แทน */
/* ── 🚦 ไฟสถานะบนหัวแผ่น — "เห็นสี แล้วกดเข้าไปดูได้เลย" (2026-09-21 · คำขอ user) ────────
   **วงกลม + ข้อความ** ไม่ใช่วงกลมเปล่า: จอ TV ระยะ 3-4 ม. จุดสีล้วนอ่านไม่ออกว่าหมายถึงอะไร
   และ "เทา" ต้องบอกให้ได้ว่าเทาเพราะ *ยังไม่มีข้อมูล* หรือ *ไม่มีเป้า* (กฎความซื่อสัตย์ของจอ)
   **ไม่กระพริบแม้สีแดง** — Andon §2 สงวนการกระพริบให้ "เหตุที่ยังค้างอยู่ตอนนี้" (เครื่องหยุดจริง)
   KPI หลุดเป้าเป็นสภาพของทั้งงวด ไม่ใช่เหตุการณ์สด · 5-9 ดวงกระพริบพร้อมกันทั้งวันบนจอ TV
   = คนเลิกมอง + รีเพนต์หนักตาม §6 ⇒ แดงใช้ "นิ่ง + เรืองแสง" แทน */
export function StatusLamp({ k, w, stat, onGo }) {
  if (!stat) return null;
  const fs = (n) => Math.max(11, Math.round(n * k));
  const c = statusColor(stat.status);
  const red = stat.status === 'bad';
  const go = typeof onGo === 'function' ? onGo : null;
  /* แผ่นแคบมาก → เหลือดวงไฟอย่างเดียว (tooltip ยังบอกเหตุผลครบ + WarnNote ใต้แผ่นก็บอกอยู่แล้ว)
     วัดจริง 21/09: ป้ายเต็มกินที่จน **ตัวเลขใหญ่** ถูก clip (98.4% เหลือ 34px) — พาดหัวห้ามโดนตัด
     ⚠️ ตัดสินด้วย **ความกว้างจริงของแผ่น** ห้ามใช้ `k` — `k` ถูก clamp ที่ 0.72
        ⇒ แผ่น 172px กับ 217px ได้ k เท่ากัน แยกไม่ออก (เคยเขียนผิดมาแล้วในรอบเดียวกันนี้) */
  const compact = w > 0 && w < 200;
  return (
    <button
      type="button" onClick={go || undefined} disabled={!go}
      title={`${stat.label} — ${stat.why}${go ? ' · กดเพื่อเจาะดู' : ''}`}
      style={{
        display: 'flex', alignItems: 'center', gap: Math.max(4, Math.round(5 * k)),
        padding: `${Math.max(2, Math.round(2.5 * k))}px ${Math.max(6, Math.round(8 * k))}px`,
        borderRadius: 999, flexShrink: 0, whiteSpace: 'nowrap',
        background: 'var(--bg3)', backgroundImage: `linear-gradient(${c}1f, ${c}1f)`,
        border: `1px solid ${c}${red ? 'cc' : '66'}`,
        boxShadow: red ? `0 0 9px 1px ${c}66` : 'none',
        cursor: go ? 'pointer' : 'default',
      }}>
      <span style={{
        width: Math.max(9, Math.round(9 * k)), height: Math.max(9, Math.round(9 * k)),
        borderRadius: '50%', background: c, flexShrink: 0,
        boxShadow: `0 0 ${Math.round(5 * k)}px ${c}`,
      }} />
      {!compact && <span style={{ fontSize: fs(11), fontWeight: 800, color: c }}>{stat.label}</span>}
      {go && <span style={{ fontSize: fs(10.5), fontWeight: 700, color: 'var(--muted)' }}>↗</span>}
    </button>
  );
}

/* ── 🔍 ขยายแผ่น (2026-09-30 · user: "แต่ละกล่องของกราฟน่าจะมีปุ่มซักมุมเพื่อกดดู popup ขยายใหญ่ จะได้เห็นชัดๆ") ──
   ปุ่ม 🔍 มุมขวาบนของ**ทุกแผ่น** (ปิดได้ด้วย `zoom={false}`) → เปิดแผ่นใบเดิมซ้ำใน popup ขนาดเกือบเต็มจอ
   ด้วย `k` ที่ใหญ่ขึ้น (`zoomScale()`) ⇒ หัว/ตัวเลข/ไฟ/ท้ายแผ่นโตตาม ส่วน**กราฟ**:
   · children เป็น **ฟังก์ชัน `(k) => node`** = วาดใหม่ด้วย k ใหญ่ (ฟอนต์แกน/ป้ายโตด้วย — แท็บ KPI ใช้แบบนี้)
   · children เป็น node ธรรมดา = วาดซ้ำในกล่องที่ใหญ่ขึ้น (ResponsiveContainer ยืดให้ · ฟอนต์แกนเท่าเดิม — SQDCM ยังเป็นแบบนี้)
   🔴 modal อยู่ใต้ `document.body` ผ่าน portal (บอร์ด TV มี ancestor ที่ clip/transform) · zIndex 1900 =
   **เหนือเปลือก TV (1010) แต่ใต้ modal หมายเหตุ (2000)** ⇒ กดแท่งในกราฟที่ขยายแล้ว หมายเหตุยังลอยขึ้นมาบนสุดได้ */
export function zoomScale(vw = window.innerWidth, vh = window.innerHeight) {
  return Math.max(1, Math.min(1.8, vw / 720, vh / 470));
}
function SheetZoom({ onClose, children }) {
  useEffect(() => {
    /* Esc ปิดเฉพาะเมื่อเราอยู่บนสุด — ถ้ามี modal ที่ zIndex สูงกว่า (เช่น หมายเหตุ 2000) เปิดอยู่ ให้มันปิดก่อน */
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const above = [...document.querySelectorAll('.modal-scroll')].some(m => Number(getComputedStyle(m).zIndex) > 1900);
      if (!above) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-scroll" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1900, background: 'rgba(0,0,0,0.6)', display: 'flex', padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(1280px, 96vw)', height: 'min(800px, 92vh)', display: 'grid', margin: 'auto', minHeight: 0 }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
/* 🔴 `inline-flex` ไม่ใช่ `inline-block` (2026-10-05) — ปุ่มนี้มีอีโมจิ (🔍/✕) เป็นเนื้อหา
   อีโมจิมาจากฟอนต์สำรองที่ความกว้างจริงกว้างกว่า `font-size` ที่ตั้งไว้ ⇒ กล่องปุ่มแคบกว่าตัวอักษร
   แล้วส่วนเกินล้นออกนอกแถวหัวแผ่น (flex row · nowrap · ไม่มี overflow) = **แถวล้นแต่ปัดไม่ได้**
   วัดจริง @390px: แถวกว้าง 346 เนื้อหา 352 · ปุ่ม w=29 แต่ sw=33 (จับได้จาก audit/mobilesweep.mjs)
   `inline-flex` ทำให้อีโมจิเป็น flex item ⇒ ความกว้างปุ่มคิดจาก max-content ของมันจริงๆ */
const SheetIconBtn = ({ fs, title, onClick, children }) => (
  <button type="button" onClick={onClick} title={title} aria-label={title} style={{
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: fs(11), lineHeight: 1, padding: '3px 6px', borderRadius: 4, flexShrink: 0, cursor: 'pointer',
    background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)',
  }}><span aria-hidden="true" style={{ display: 'block' }}>{children}</span></button>
);

/* `bigNote` (30/09 · user: "ตัวเลขที่โชว์คืออะไร ไม่มี text บอก") = ป้ายเล็กติดตัวเลขใหญ่ว่าเป็นค่าของอะไร (เช่น "ก.ย." = ค่าเดือนที่เลือก) */
export function Sheet({ k, cw = 0, span = 1, icon, title, sub, big, unit, bigNote, delta, stat, foot, link, onLink, zoom = true, onClose, children }) {
  const fs = (n) => Math.max(11, Math.round(n * k));
  const status = stat?.status;
  const sheetW = cw * span + GAP * (span - 1);          // ความกว้างจริงของแผ่นใบนี้
  const [zoomed, setZoomed] = useState(false);
  const zk = useMemo(() => (zoomed ? zoomScale() : 1), [zoomed]);
  const body = typeof children === 'function' ? children(k, cw) : children;   // cw = ความกว้างแผ่น (popup = 1200) ให้กราฟตัดสินความหนาแน่นของป้าย
  const footNode = typeof foot === 'function' ? foot(k) : foot;     // foot ก็รับ `(k) => node` ได้ (ให้บรรทัดท้ายโตตามใน popup)
  return (<>
    <div style={{
      gridColumn: `span ${span}`,
      /* ❌ ไม่มีแถบสีบนหัวแผ่นอีกแล้ว (คำสั่ง user 21/09 "สีสันของเส้นแต่ละ box ไม่เอา")
         สีบนแผ่นเหลือความหมายเดียว = **สถานะ** (ไฟดวงบนหัว + สีแท่งกราฟ) ไม่ใช่ "สีประจำแกน"
         — แถบสีประจำแกนแย่งความสนใจกับไฟสถานะ ทำให้แผ่นที่ปกติกับแผ่นที่มีปัญหาดูเด่นเท่ากัน */
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 6, boxShadow: 'var(--shadow-sm)',   // แผ่น KPI = การ์ดแบนบนกริด ไม่ได้ลอย
      display: 'flex', flexDirection: 'column', overflow: 'clip', minWidth: 0, minHeight: 0,
    }}>
      <div style={{ padding: `${Math.round(8 * k)}px ${Math.round(10 * k)}px 0`, flexShrink: 0 }}>
        {/* ⚠️ ไฟสถานะ **ห้ามอยู่แถวเดียวกับชื่อแผ่น** — วัดจริง 21/09 ที่ 900px: ป้ายไฟกินที่
            จนชื่อ "S ความปลอดภัย" ถูก clip เหลือ 72px (แผ่นไม่รู้ว่าตัวเองเป็นแกนอะไร)
            ⇒ วางไว้ท้ายแถวตัวเลขใหญ่แทน — แถวนั้นที่ว่างเยอะ และไฟอยู่ติดกับเลขที่มันตัดสินพอดี */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: fs(13), fontWeight: 800, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'clip' }}>
            {icon} {title}
          </div>
          {onClose
            ? <SheetIconBtn fs={fs} title="ปิด (Esc)" onClick={onClose}>✕</SheetIconBtn>
            : (zoom && <SheetIconBtn fs={fs} title="ขยายดูใหญ่" onClick={() => setZoomed(true)}>🔍</SheetIconBtn>)}
        </div>
        {sub && <div style={{ fontSize: fs(10.5), color: 'var(--muted)', marginTop: 1 }}>{sub}</div>}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between',
          marginTop: Math.round(3 * k), minHeight: Math.round(22 * k),
        }}>
          {big !== undefined ? (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, flexShrink: 0 }}>
              <div style={{ fontSize: fs(34), fontWeight: 900, lineHeight: 1, color: status ? statusColor(status) : 'var(--text)' }}>
                {big}
              </div>
              {unit && <div style={{ fontSize: fs(13), fontWeight: 700, color: 'var(--muted)' }}>{unit}</div>}
              {bigNote && <div style={{ fontSize: fs(10.5), fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{bigNote}</div>}
            </div>
          ) : <span />}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            {delta != null && (
              <div style={{ fontSize: fs(11.5), fontWeight: 800, color: delta >= 0 ? '#22c55e' : '#ef4444', whiteSpace: 'nowrap' }}>
                {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}
              </div>
            )}
            <StatusLamp k={k} w={sheetW} stat={stat} onGo={onLink} />
          </div>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: `${Math.round(4 * k)}px ${Math.round(4 * k)}px 0` }}>{body}</div>
      {(footNode || link) && (
        <div style={{ padding: `${Math.round(5 * k)}px ${Math.round(9 * k)}px ${Math.round(7 * k)}px`, flexShrink: 0 }}>
          {footNode && <div style={{ fontSize: fs(10.5), lineHeight: 1.35, color: 'var(--muted)' }}>{footNode}</div>}
          {link && (
            <button onClick={onLink} style={{
              marginTop: 4, fontSize: fs(10.5), fontWeight: 700, padding: '2px 8px', borderRadius: 999,
              background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', cursor: 'pointer',
            }}>{link} ↗</button>
          )}
        </div>
      )}
    </div>
    {zoomed && (
      <SheetZoom onClose={() => setZoomed(false)}>
        <Sheet k={zk} cw={1200} icon={icon} title={title} sub={sub} big={big} unit={unit} bigNote={bigNote}
          delta={delta} stat={stat} foot={foot} link={link} onLink={onLink} zoom={false} onClose={() => setZoomed(false)}>
          {children}
        </Sheet>
      </SheetZoom>
    )}
  </>);
}

/* หมายเหตุ "ข้อมูลยังไม่พร้อม" — ต้องเห็นชัดบนแผ่น ไม่ใช่ตัวจิ๋วมุมล่าง (กฎความซื่อสัตย์ของจอ) */
export const WarnNote = ({ k, text, tone = '#f59e0b' }) => (
  <div style={{
    fontSize: Math.max(11, Math.round(10.5 * k)), lineHeight: 1.3, color: tone, fontWeight: 600,
    background: 'var(--bg3)', backgroundImage: `linear-gradient(${tone}14, ${tone}14)`,
    border: `1px solid ${tone}55`, borderRadius: 4, padding: '3px 6px',
  }}>⚠️ {text}</div>
);

export const EmptyChart = ({ k, text }) => (
  <div style={{
    height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
    fontSize: Math.max(11, Math.round(11.5 * k)), color: 'var(--muted)', padding: 10,
  }}>{text}</div>
);

