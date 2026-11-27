/* ══ 📊 OeeHeadline — "หัวแดชบอร์ด OEE" วงแหวน + A/P/Q ชุดเดียวทั้งระบบ (2026-11-27) ═══════════

   user ส่งรูปแท็บ "ภาพรวมวันนี้" มาเทียบกับแท็บ "รายพาร์ท" แล้วบอก
   *"OEE รายพาร์ท ต้องโชว์เป็น dashboard แบบนี้สิ ไม่ควรแยกหน้า แต่แค่กรองด้วยฟิลเตอร์"*
   ⇒ ก้อนวงแหวน+A/P/Q เดิมเขียนอยู่ใน `OEEAnalytics.jsx` ที่เดียว ย้ายมาเป็นของกลาง
   (กฎ CLAUDE.md 26/11 · UI §0.1: *pattern ที่ใช้หลายหน้า แก้ที่ของกลางเท่านั้น*)

   🔴 **ไม่มีสูตรในไฟล์นี้** — รับค่าที่คิดเสร็จแล้วมาวาดอย่างเดียว
      (ค่าทั้งหมดเป็น % 0..100 หรือ `null` = ไม่รู้ ⇒ วาด "—" **ห้ามวาด 0** · กฎจอซื่อสัตย์)
   🔴 เกณฑ์สีมาจาก `statusOf(ค่า, เป้า)` ของกลาง — **ห้ามตั้งเกณฑ์ตายตัวในไฟล์นี้**
   🔴 `trend` ไม่ส่ง = ไม่วาดแท่ง (ไม่ใช่วาดแท่งว่าง) — จอที่ยังไม่มีประวัติรายวันต้องเงียบ ไม่ใช่โกหก  */
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, LabelList,
} from 'recharts';
import { chartAnim } from '../utils/motion';
import { tr as trI18n } from '../utils/i18n';
import { statusColor, statusOf } from '../utils/statusTone';

/** ป้ายหัวคอลัมน์ A/P/Q — ตัวพิมพ์ใหญ่เหมือนบอร์ดโรงงาน (ไม่แปลภาษา: เป็นศัพท์มาตรฐาน OEE) */
const METRIC_LABEL = { a: 'AVAILABILITY (A)', p: 'PERFORMANCE (P)', q: 'QUALITY (Q)' };
/* สีประจำเส้น/แท่งของแต่ละ metric = **สีของข้อมูล** (พาเลตกราฟ UI §6.9) ไม่ใช่สีสถานะ
   ⇒ อยู่นอกพาเลต 5 สีได้ · colorsweep ข้าม `<svg>` อยู่แล้ว */
export const METRIC_COLOR = { a: '#22c55e', p: '#f59e0b', q: '#a78bfa' };
/** สีของตัวเลข OEE รวม — เกณฑ์สากล 80/60 (ใช้กับวงแหวนและตัวเลขกลางวง)
 *  🔴 **token เท่านั้น** (27/11) — เดิมเป็น hex ดิบ `#22c55e/#f59e0b/#ef4444` ⇒ เขียวคนละเฉดกับ
 *  ตัวเลข A/P/Q ที่อยู่ข้างๆ (ตัวนั้นใช้ `statusColor()` ที่เป็น token อยู่แล้ว) + ธีมสว่างไม่เปลี่ยนตาม
 *  · `var()` ใน attribute ของ SVG ใช้ได้ (มีของเดิมในหน้าใช้ `color="var(--blue)"` กับ GaugeRing อยู่แล้ว) */
export const oeeColor = (v) => (v >= 80 ? 'var(--green)' : v >= 60 ? 'var(--amber)' : 'var(--red)');

// ── Gauge ring (SVG, no deps) ─────────────────────────────────────
export function GaugeRing({ value, size = 168, stroke = 15, color = 'var(--green)' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const offset = c * (1 - pct / 100);
  return (
    <svg width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
    </svg>
  );
}

// Tooltip ย่อของ sparkline — แตะ/ชี้แท่งเพื่อดูวัน + ค่าจริง (จอทัชแตะได้)
function MiniTrendTip({ active, payload, label, dataKey, metric }) {
  if (!active || !payload?.length) return null;
  const v = payload.find(p => p.dataKey === dataKey)?.value;
  return (
    <div style={{ background: 'var(--card-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '4px 8px', fontSize: 11, boxShadow: 'var(--shadow-float)' }}>
      <div style={{ color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontWeight: 800 }}>{metric} {v != null ? `${v}%` : trI18n("ไม่มีข้อมูล")}</div>
    </div>
  );
}

/* Sparkline เทรนด์ต่อ metric (A/P/Q) — มี caption + แกนวัน + tooltip ให้อ่านออกโดยไม่ต้องเดา
   (UI-CONVENTIONS §กราฟแท่งรายวัน: caption + แกนวันต่อเนื่อง + วันว่าง = ตอเทา) */
export function MiniTrend({ data, dataKey, color, target, metric, caption }) {
  const hasData = (data || []).some(d => d[dataKey] != null);
  if (!hasData) return <div style={{ height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--muted)' }}>{trI18n('ไม่มีข้อมูล 10 วันล่าสุด')}</div>;
  // วันไม่มีข้อมูล = ตอเทาเตี้ย (ไม่ปล่อยว่างจนดูเหมือนวันหาย) + tooltip บอก "ไม่มีข้อมูล"
  const rows = data.map(d => ({ ...d, _stub: d[dataKey] == null ? 2 : null }));
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{caption || trI18n('เทรนด์ 10 วันล่าสุด')}</div>
      {/* ⚠️ ต้องมีแกน Y + ตัวเลขบนแท่ง (UI-CONVENTIONS §5.2) — YAxis hide + ไม่มี label
          = อ่านค่าไม่ได้เลยถ้าไม่ hover (จอ TV/จอทัชไม่มี hover) */}
      <ResponsiveContainer width="100%" height={96}>
        <BarChart data={rows} margin={{ top: 14, right: 4, left: 0, bottom: 0 }} barCategoryGap={1}>
          <ReferenceLine y={target} stroke={color} strokeDasharray="3 3" strokeOpacity={0.7} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} interval="preserveStartEnd" axisLine={false} tickLine={false} height={16} />
          <YAxis domain={[0, 100]} width="auto" ticks={[0, 50, 100]} tickFormatter={(v) => `${v}%`}
            tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: 'var(--bg3)', opacity: 0.4 }} content={<MiniTrendTip dataKey={dataKey} metric={metric} />} />
          <Bar dataKey="_stub" stackId="v" fill="var(--border)" radius={[2, 2, 0, 0]} {...chartAnim()} />
          <Bar {...chartAnim()} dataKey={dataKey} stackId="v" fill={color} radius={[2, 2, 0, 0]} opacity={0.85}>
            <LabelList dataKey={dataKey} position="top" offset={4}
              formatter={(v) => (v == null ? '' : Math.round(v))}
              style={{ fontSize: 11, fontWeight: 700, fill: 'var(--text2)' }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * หัวแดชบอร์ด OEE — วงแหวน OEE + ตัวเลข A/P/Q (+ เทรนด์รายวันถ้ามี)
 * @param {number|null} oee,a,p,q  ค่าเป็น % 0..100 · `null` = ไม่รู้ ⇒ "—" (ห้ามส่ง 0 แทน)
 * @param {object} target          `{ oee, a, p, q, configured }` — เป้าที่ใช้ตัดสินสี + เส้นประในแท่ง
 * @param {Array}  [trend]         `[{ label, a, p, q }]` ไม่ส่ง = ไม่วาดแท่งเลย
 * @param {string} centerLabel     ข้อความเล็กเหนือตัวเลขกลางวง (เช่น "OEE รวมวันนี้")
 * @param {string} [trendCaption]  ป้ายเหนือแท่ง (ดีฟอลต์ "เทรนด์ 10 วันล่าสุด")
 * @param {node}   [note]          บรรทัดเล็กใต้หัวข้อ (เช่น "🟢 รวมค่าสดของ N กะ")
 */
export default function OeeHeadline({ oee, a, p, q, target, trend, centerLabel,
  trendCaption, targetTitle, note, size = 168 }) {
  const vals = { a, p, q };
  return (
    <>
      {note}
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
          <GaugeRing value={oee} size={size} color={oeeColor(oee ?? 0)} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{centerLabel}</div>
            <div style={{ fontSize: 34, fontWeight: 900, color: oee != null ? oeeColor(oee) : 'var(--muted)' }}>{oee ?? '—'}{oee != null ? '%' : ''}</div>
            {target?.oee != null && (
              <div style={{ fontSize: 11, color: 'var(--muted)' }} title={targetTitle}>
                TARGET {target.oee}%{target.configured === false ? ' *' : ''}
              </div>
            )}
          </div>
        </div>
        {['a', 'p', 'q'].map(k => (
          <div key={k} style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{METRIC_LABEL[k]}</div>
            {/* 🚦 เทียบ `target[k]` = เป้าเดียวกับเส้นประในแท่งข้างล่าง (23/09)
                เกณฑ์ตายตัวทำให้ตัวเลขเขียวทั้งที่ยังไม่ถึงเส้นประข้างๆ */}
            <div style={{ fontSize: 26, fontWeight: 900, color: statusColor(statusOf(vals[k], target?.[k])) }}>{vals[k] ?? '—'}{vals[k] != null ? '%' : ''}</div>
            {trend && <MiniTrend data={trend} dataKey={k} color={METRIC_COLOR[k]} target={target?.[k]} metric={k.toUpperCase()} caption={trendCaption} />}
            {target?.[k] != null && (
              /* ป้ายบอกว่าเส้นประในแท่งคืออะไร — **วาดเป็น `<svg>` ไม่ใช่ตัวอักษร `╌╌`**
                 เพราะสีของมันคือ "สีเส้นในกราฟ" (พาเลตกราฟ) ไม่ใช่สีข้อความ ⇒ ถ้าเป็นตัวอักษร
                 จะนับเป็นสีนอกพาเลตใน `audit/colorsweep.mjs` (ซึ่งข้าม `<svg>` อยู่แล้ว) */
              <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
                <svg width="16" height="7" aria-hidden="true" style={{ verticalAlign: 'middle' }}>
                  <line x1="0" y1="3.5" x2="16" y2="3.5" stroke={METRIC_COLOR[k]} strokeWidth="2" strokeDasharray="3 2" />
                </svg>{' '}
                {trI18n("เส้นประ = เป้า")} {target[k]}%
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
