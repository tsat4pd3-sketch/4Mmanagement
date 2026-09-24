import { useMemo, useState } from 'react';
import {
  paretoGeometry, pickLabelAngle, labelBandHeight, collapseTail,
  PARETO_CUTOFF, labelWidthPx,
} from '../utils/pareto';

/* ══ 📊 Pareto มาตรฐานสากล — แท่งตั้ง + เส้น % สะสม 2 แกน (2026-09-22 · คำสั่ง user) ════════
   *"ลองดู pareto ที่เป็นระดับสากล เทียบกับ pareto ในเว็บเรา ยังเทียบกันไม่ติดเลย …
     แนวนอนไม่เวิค เป็นแนวตั้งและเอียง text เอา ให้ 90 องศาก็ได้นะ เอียงอ่านก็ยังได้"*

   เดิมทั้งระบบวาด **แท่งนอน ความหนาไม่เท่ากันตามกลุ่ม ABC** ซึ่งไม่ใช่ Pareto ตามตำรา
   (ASQ · Juran · IATF core tools · QI Macros) — คนนอกอ่านไม่ออกว่าเป็นกราฟอะไร

   ── สิ่งที่ยึดตามมาตรฐาน (เทียบกับใบอ้างอิงที่ user ส่งมา 3 ใบ) ──
     · แท่ง**ตั้ง** เรียงมาก→น้อย · **ชิดกันสนิท** (แท่งห่าง = bar chart ธรรมดา ไม่ใช่ Pareto)
     · แกนซ้าย = ค่า **เริ่ม 0 เสมอ** · แกนขวา = % สะสม 0–100
     · เส้นสะสมเริ่มมุมล่างซ้าย → หมุดที่**ขอบขวาของแต่ละแท่ง** → จบ 100% พอดีขอบขวาสุด
     · เส้นประ 80% = เส้นแบ่ง vital few / trivial many
     · ตัวเลขบนหัวแท่ง + % บนหมุด — **จอ TV ไม่มี hover ห้ามซ่อนค่าไว้ใน tooltip อย่างเดียว**

   ── สิ่งที่เก็บไว้จากของเดิม (ไม่ใช่มาตรฐานสากล แต่เป็นของที่โรงงานใช้จริง) ──
     · สี ABC (A แดง = ต้องแก้ก่อน · B ส้ม · C เทา) — ตรงกับ "bars > 20% highlighted" ของ QI Macros
     · คลิกแท่ง = เจาะลึก

   ⚠️ สูตร/พิกัดทั้งหมดอยู่ `utils/pareto.js` (pure · มีเทส) — **ไฟล์นี้วาดอย่างเดียว ห้ามคำนวณเอง**
   ⚠️ เพดานเบราว์เซอร์ Chromium 94 (จอ TV) — ห้าม `color-mix()` ใช้ alpha-hex · ฟอนต์ขั้นต่ำ 11px
   ═══════════════════════════════════════════════════════════════════════════════════════ */

const ABC_COLOR = { A: '#ef4444', B: '#f59e0b', C: '#9ca3af' };
const LINE_COLOR = '#2563eb';
const fmtV = (n) => (Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-US') : String(Math.round(n * 10) / 10));

export default function ParetoChart({
  rows = [],                 // ผ่าน classifyAbc มาแล้ว (เรียง + มี _val/_cum/_cls)
  unit = '',
  height = 340,
  width = 860,               // viewBox — จอจริงยืดตาม (preserveAspectRatio)
  maxBars = 12,              // เกินนี้ยุบหางยาวเป็นแท่งเดียวตามมาตรฐาน ("Other bar")
  angle,                     // บังคับมุมป้าย (0 / -45 / -90) — ไม่ส่ง = เลือกให้อัตโนมัติ
  onPick,                    // คลิกแท่ง → เจาะลึก
  cutoff = PARETO_CUTOFF,
  showTailToggle = true,
}) {
  const [showAll, setShowAll] = useState(false);
  const [angOverride, setAngOverride] = useState(null);

  const { rows: shown, tail } = useMemo(
    () => (showAll ? { rows, tail: null } : collapseTail(rows, maxBars)),
    [rows, maxBars, showAll],
  );

  const FONT = 11.5;
  const labels = shown.map(r => r.name);
  const geo0 = paretoGeometry(shown, { width, height, padBottom: 40 });
  const ang = angOverride ?? angle ?? pickLabelAngle(labels, geo0.barW, FONT);
  /* ⚠️ ป้ายเอียงกินที่ด้านล่างเยอะ — **ขยายความสูง viewBox แทนการบีบพื้นที่กราฟ**
     (บีบพื้นที่ = แท่งเตี้ยจนเทียบกันไม่ออก + ป้ายยังโดนตัดอยู่ดี — เจอจริงรอบแรก 22/09) */
  /* ⚠️ ป้าย -45° ของ **แท่งแรก** ยื่นไปทางซ้ายเกินขอบกราฟ แล้วโดนกล่องแม่ตัดหัวทิ้ง
     (เจอจริง 22/09: "JIG มีปัญหา (ชำรุด/ปรับแก้)" หายไปครึ่งคำ)
     ⇒ เผื่อขอบซ้ายตามความยาวป้ายจริง · เผื่อมากเกินไป (กราฟแคบลง) ให้สลับเป็น 90° แทน
        ซึ่งกินแนวนอนแค่ความสูงฟอนต์ — user อนุญาตไว้แล้ว ("ให้ 90 องศาก็ได้นะ") */
  const leftNeed = Math.cos(Math.PI / 4) * labelWidthPx(labels[0] || '', FONT) - geo0.barW / 2 + 8;
  const autoTo90 = ang === -45 && angOverride == null && angle == null && leftNeed > 150;
  const ang2 = autoTo90 ? -90 : ang;
  const padLeft = ang2 === -45 ? Math.min(Math.max(56, leftNeed), 150) : 56;

  const band = labelBandHeight(labels, ang2, FONT);
  const padBottom = band + 12;
  const vbH = Math.max(height, 26 + 190 + padBottom);
  const g = paretoGeometry(shown, { width, height: vbH, padBottom, padLeft, cutoff });

  if (!shown.length) return null;
  /* แท่งที่เตี้ยกว่า ~1 พิกเซล — ต้องบอกบนจอว่า "ไม่ใช่ 0" ไม่งั้นคนอ่านสรุปผิด
     (กฎความซื่อสัตย์ของจอ: ข้อมูลที่จอแสดงไม่ได้ ต้องเขียนว่าแสดงไม่ได้ ห้ามปล่อยให้ดูเหมือน 0) */
  const tiny = g.bars.filter(b => b.value > 0 && b.h < 1);
  const tinyMin = tiny.length ? Math.min(...tiny.map(b => b.value)) : 0;
  const axis = 'var(--border2)', txt = 'var(--text2)', mut = 'var(--muted)';
  const showBarVal = g.barW >= 26;
  // % บนหมุด: แสดงทุกจุดถ้าที่พอ · ไม่พอแสดงเฉพาะกลุ่ม A + จุดสุดท้าย (กันเลขทับกัน)
  const roomy = g.barW >= 46;

  return (
    <div>
      {/* ⚠️ ห้ามล็อก height เป็น px คู่กับ viewBox — `meet` จะตีกรอบแล้วเหลือที่ว่างซ้าย-ขวาเป็นแถบใหญ่
          (รอบแรก 22/09 กราฟกินความกว้างจริงแค่ ~60%) · ให้กว้าง 100% แล้วสูงตามสัดส่วนเอง */}
      <svg viewBox={`0 0 ${width} ${vbH}`} preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible' }}>
        {/* เส้นกริดแนวนอน + แกนขวา (% สะสม) */}
        {g.rightTicks.map(t => (
          <g key={`r${t.pct}`}>
            <line x1={g.padLeft} x2={g.padLeft + g.plotW} y1={t.y} y2={t.y} stroke={axis} strokeWidth="1" opacity="0.5" />
            <text x={g.padLeft + g.plotW + 7} y={t.y + 4} fontSize={FONT} fill={LINE_COLOR}>{t.pct}%</text>
          </g>
        ))}
        {/* แกนซ้าย (ค่า) — เริ่ม 0 เสมอ ห้ามตัดฐาน */}
        {g.leftTicks.map(t => (
          <text key={`l${t.value}`} x={g.padLeft - 7} y={t.y + 4} fontSize={FONT} fill={txt} textAnchor="end">{fmtV(t.value)}</text>
        ))}
        <line x1={g.padLeft} x2={g.padLeft} y1={g.padTop} y2={g.base} stroke={axis} strokeWidth="1.5" />
        <line x1={g.padLeft + g.plotW} x2={g.padLeft + g.plotW} y1={g.padTop} y2={g.base} stroke={LINE_COLOR} strokeWidth="1.5" opacity="0.55" />
        <line x1={g.padLeft} x2={g.padLeft + g.plotW} y1={g.base} y2={g.base} stroke={axis} strokeWidth="1.5" />

        {/* เส้นประ 80% = vital few / trivial many */}
        <line x1={g.padLeft} x2={g.padLeft + g.plotW} y1={g.cutoffY} y2={g.cutoffY}
          stroke="#ef4444" strokeWidth="1.3" strokeDasharray="6 4" opacity="0.8" />
        {/* วางขวา+ใต้เส้น: ฝั่งซ้ายเป็นแท่งสูง (แดงทับแดงอ่านไม่ออก) และชนเลขบนหัวแท่งที่ 1 */}
        <text x={g.padLeft + g.plotW - 6} y={g.cutoffY + 14} fontSize={FONT} fill="#ef4444"
          fontWeight="700" textAnchor="end">เส้น {cutoff}%</text>

        {/* แท่ง — ชิดกันสนิทตามมาตรฐาน (เส้นขอบขาวบางคั่นให้แยกแท่งออก ไม่ใช่ช่องว่าง) */}
        {g.bars.map(b => {
          return (
          <g key={b.i} onClick={onPick && !b.row._tail ? () => onPick(b.row) : undefined}
            style={{ cursor: onPick && !b.row._tail ? 'pointer' : 'default' }}>
            {/* 🔴 พื้นขั้นต่ำ 2 หน่วย: เพดานแกน = ยอดรวม ⇒ รายการหางยาวสูงไม่ถึง 1 พิกเซล
                ปล่อยตามจริง = **ตาเห็นเป็น 0 ทั้งที่ไม่ใช่** (user ถาม 22/09 "ท้ายๆ นี่ค่าเป็น 0 รึป่าว"
                ข้อมูลจริง: รายการท้ายสุด 10 นาที = 0.004% ของยอดรวม = ~1/40 พิกเซล)
                ⚠️ พื้นขั้นต่ำทำให้แท่งจิ๋วดู "เท่ากัน" ⇒ **ต้องมีข้อความบอกใต้กราฟด้วย** (ดู tinyNote) */}
            {/* 🔴 พื้นที่คลิก = ทั้งคอลัมน์จากบนลงล่าง **ไม่ใช่ตัวแท่ง**
                เพดานแกน = ยอดรวม ⇒ แท่งสูงไม่กี่พิกเซล ⇒ เล็งคลิกแทบไม่โดน
                (user แจ้ง 23/09 "กราฟคลิกเจาะเข้าไปดูรายละเอียดไม่ได้")
                วาดก่อนแท่งและ fill โปร่งใส เพื่อไม่บังสีแท่ง */}
            {onPick && !b.row._tail && (
              <rect x={b.x} y={g.padTop} width={b.w} height={g.plotH} fill="transparent">
                <title>{`${b.row.name} — ${fmtV(b.value)} ${unit} · คลิกเพื่อเจาะลึก`}</title>
              </rect>
            )}
            <rect x={b.x} y={b.y} width={b.w} height={Math.max(b.h, b.value > 0 ? 2 : 0)}
              fill={ABC_COLOR[b.cls] || ABC_COLOR.C} stroke="var(--card)" strokeWidth="1"
              style={{ pointerEvents: 'none' }} />
          </g>
          );
        })}

        {/* เส้น % สะสม — เริ่มมุมล่างซ้าย ปักหมุดขอบขวาของแต่ละแท่ง */}
        {/* เส้นรองสีพื้นการ์ด = ขอบให้เส้นสะสมอ่านออกตอนพาดทับแท่งสีแดง/ส้ม (ไม่ใช้ filter — จอ TV Cr94) */}
        <polyline points={g.line.map(p => `${p.x},${p.y}`).join(' ')}
          fill="none" stroke="var(--card)" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={g.line.map(p => `${p.x},${p.y}`).join(' ')}
          fill="none" stroke={LINE_COLOR} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        {g.line.filter(p => !p.origin).map(p => (
          <g key={`p${p.i}`}>
            <rect x={p.x - 3.5} y={p.y - 3.5} width="7" height="7" fill={LINE_COLOR} stroke="var(--card)" strokeWidth="1.2" />
            {/* หมุด i อยู่ระดับ "ยอดสะสมถึงแท่ง i" ⇒ หมุดแรก = หัวแท่งแรกพอดี (ดู pareto.js)
                ป้าย % จึงชนเลขค่าของแท่งนั้นแน่นอน — ยกป้ายแรกขึ้นอีกขั้น */}
            {(roomy || p.row?._cls === 'A' || p.i === g.line.length - 2) && (
              <text x={p.x} y={p.y - (p.i === 0 ? 22 : 10)} fontSize={FONT} textAnchor="middle" fontWeight="700"
                fill={LINE_COLOR} stroke="var(--card)" strokeWidth="3" paintOrder="stroke">
                {p.pct.toFixed(1)}%
              </text>
            )}
          </g>
        ))}

        {/* เลขค่าบนหัวแท่ง — **วาดหลังเส้นสะสม** เพื่อให้ขอบสีพื้นการ์ดกินเส้นที่พาดผ่าน
            (วาดก่อนเส้น = เส้นทับเลข · เจอจริง 22/09 เลข "24" ของแท่งที่ 2 หายไปใต้เส้น)
            เพดานแกนซ้าย = ยอดรวม ⇒ แท่งเตี้ยกว่าพื้นที่กราฟเป็นปกติ ที่ว่างด้านบนคือที่ของเส้นสะสม */}
        {showBarVal && g.bars.map(b => b.h > 0 && (
          <text key={`v${b.i}`} x={b.x + b.w / 2} y={b.y - 6} fontSize={FONT} textAnchor="middle"
            fontWeight="700" fill={txt} stroke="var(--card)" strokeWidth="3.5" paintOrder="stroke">
            {fmtV(b.value)}
          </text>
        ))}

        {/* ป้ายแกน X — เอียงตามพื้นที่ (0 / -45 / -90) ห้ามตัดคำทิ้งเงียบ */}
        {g.bars.map(b => {
          const cx = b.x + b.w / 2, cy = g.base + 12;
          const anchor = ang2 === 0 ? 'middle' : 'end';
          const x = ang2 === 0 ? cx : cx + (ang2 === -90 ? 4 : 2);
          return (
            <text key={`x${b.i}`} x={x} y={cy} fontSize={FONT} fill={b.row._tail ? mut : txt}
              textAnchor={anchor} transform={ang2 ? `rotate(${ang2}, ${x}, ${cy})` : undefined}>
              {b.row.name}
            </text>
          );
        })}

        {/* ชื่อแกน */}
        <text x={14} y={g.padTop + g.plotH / 2} fontSize={FONT} fill={mut} textAnchor="middle"
          transform={`rotate(-90, 14, ${g.padTop + g.plotH / 2})`}>{unit || 'จำนวน'}</text>
        <text x={width - 12} y={g.padTop + g.plotH / 2} fontSize={FONT} fill={LINE_COLOR} textAnchor="middle"
          transform={`rotate(90, ${width - 12}, ${g.padTop + g.plotH / 2})`}>% สะสม</text>
      </svg>

      {/* คำอธิบาย + ปุ่มปรับมุมป้าย (จอ TV ไม่มีเมาส์ → ต้องกดได้ ไม่ใช่ hover) */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, color: mut, marginTop: 6 }}>
        {shown.some(r => r._cls === 'A') && <Key c={ABC_COLOR.A} t="A — ต้องแก้ก่อน (สะสมถึง 80%)" />}
        {shown.some(r => r._cls === 'B') && <Key c={ABC_COLOR.B} t="B — รอง (80–95%)" />}
        {shown.some(r => r._cls === 'C') && <Key c={ABC_COLOR.C} t="C — หางยาว" />}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke={LINE_COLOR} strokeWidth="2" /></svg>
          % สะสม (อ่านแกนขวา)
        </span>
        {/* ⚠️ ข้อความนี้ต้องอยู่ **ในไฟล์นี้** เท่านั้น — หน้าแม่ไม่รู้ว่าตอนนี้กางหางยาวอยู่หรือย่ออยู่
            (เดิมอยู่ใน ParetoAbcChart แล้วเขียนว่า "แสดง 11 อันดับแรกจาก 46" ทั้งที่จอกางครบ 46 แท่งแล้ว) */}
        {tail && (
          <span style={{ color: 'var(--muted)' }}>
            แสดง {shown.length - 1} อันดับแรกจาก {rows.length} · ที่เหลือยุบเป็นแท่ง “หางยาว”
          </span>
        )}
        {showAll && (
          <span style={{ color: 'var(--muted)' }}>แสดงครบทั้ง {rows.length} รายการ</span>
        )}
        {tiny.length > 0 && (
          <span style={{ color: '#f59e0b', fontWeight: 700 }}>
            ⚠️ {tiny.length} แท่งท้ายเตี้ยกว่า 1 พิกเซล (ต่ำสุด {fmtV(tinyMin)} {unit}) — <u>ไม่ใช่ 0</u>
            {showAll ? ' · กด “ย่อหางยาว” เพื่อรวมเป็นแท่งเดียว' : ''}
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
          {tail && showTailToggle && (
            <button type="button" onClick={() => setShowAll(true)} style={miniBtn}>
              ▸ กางหางยาว {tail.length} รายการ
            </button>
          )}
          {showAll && rows.length > maxBars && (
            <button type="button" onClick={() => setShowAll(false)} style={miniBtn}>◂ ย่อหางยาว</button>
          )}
          <span style={{ opacity: 0.8 }}>ป้าย:</span>
          {[0, -45, -90].map(a => (
            <button key={a} type="button" onClick={() => setAngOverride(a)} style={{
              ...miniBtn,
              borderColor: ang2 === a ? 'var(--accent)' : 'var(--border)',
              color: ang2 === a ? 'var(--text)' : 'var(--muted)',
            }}>{a === 0 ? 'นอน' : `${Math.abs(a)}°`}</button>
          ))}
        </span>
      </div>
    </div>
  );
}

const Key = ({ c, t }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
    <span style={{ width: 11, height: 11, background: c, borderRadius: 2, display: 'inline-block' }} />{t}
  </span>
);

const miniBtn = {
  fontSize: 11, padding: '2px 8px', borderRadius: 6, cursor: 'pointer',
  background: 'var(--bg3)', color: 'var(--muted)', border: '1px solid var(--border)',
};
