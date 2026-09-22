import { useState } from 'react';
import {
  histogram, controlChartXmR, scatter, fishbone, checkSheet, stratify, runChart, BONES,
} from '../utils/qc7';

/* ══ QC 7 Tools — ชิ้นส่วนกราฟที่ใช้ซ้ำได้ (2026-09-22) ═══════════════════════════════════
   สูตรทั้งหมดอยู่ `src/utils/qc7.js` (pure + มีเทส) — ที่นี่วาดอย่างเดียว ห้ามคิดเลขเอง
   (บทเรียนเดียวกับ ParetoAbcChart ที่สูตรเคยฝังใน .jsx แล้วไม่เคยถูกเทสเลย)

   🔴 กฎความซื่อสัตย์ของจอ (CLAUDE.md): ช่องที่ข้อมูลไม่พอ **ต้องเขียนบนจอว่าไม่พอ**
      ห้ามโชว์ 0 ห้ามซ่อนแผง ⇒ ทุกกราฟที่นี่รับผล `{ok:false, reason}` แล้ววาดกล่องเหตุผล

   ⚠️ เพดานเบราว์เซอร์ = Chromium 94 (จอ TV LG webOS 23) — ห้าม `color-mix()` / `dvh` /
      `@container` / CSS nesting · ใช้ alpha-hex (`${c}22`) แทนเสมอ
   ⚠️ ฟอนต์ขั้นต่ำ 11px (UI-CONVENTIONS) — จอบอร์ดหน้างานอ่านจากระยะไกล
   ═════════════════════════════════════════════════════════════════════════════════════════ */

const CARD = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 };
const H = { fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 2 };
const SUB = { fontSize: 11.5, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 };
const fmt = (n, d = 0) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d }));

/** กล่อง "ทำไมยังดูไม่ได้" — ต้องบอกเหตุผลเสมอ ห้ามปล่อยพื้นที่ว่างให้คนเดาว่าจอพัง */
export function NotEnough({ reason, hint }) {
  return (
    <div style={{
      fontSize: 12, color: 'var(--muted)', background: 'var(--bg2)', border: '1px dashed var(--border2)',
      borderRadius: 8, padding: '14px 12px', textAlign: 'center', lineHeight: 1.7,
    }}>
      📭 <b style={{ color: 'var(--text2)' }}>ยังวิเคราะห์ไม่ได้</b>
      <div>{reason}</div>
      {hint && <div style={{ fontSize: 11, marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

export function Panel({ title, sub, right, children }) {
  return (
    <section style={CARD}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={H}>{title}</div>
          {sub && <div style={SUB}>{sub}</div>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/* ═══ ④ ฮิสโตแกรม ═══════════════════════════════════════════════════════════ */
export function Histogram({ values, unit = 'นาที', valOf, minN = 5 }) {
  const h = histogram(values, valOf ? { valOf, minN } : { minN });
  if (!h.ok) return <NotEnough reason={h.reason} hint="ฮิสโตแกรมตอบว่า “ปัญหากองอยู่ช่วงไหน” — ต้องมีเหตุการณ์พอสมควรจึงจะเห็นรูปทรง" />;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 150, marginTop: 4 }}>
        {h.bins.map((b, i) => {
          const pct = h.peak > 0 ? (b.count / h.peak) * 100 : 0;
          const c = b.overflow ? '#a855f7' : '#3b82f6';
          return (
            <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', height: '100%' }}
              title={`${fmt(b.from, 2)}–${fmt(b.to, 2)} ${unit} · ${b.count} ครั้ง${b.overflow ? ' (ค่าสุดโต่ง)' : ''}`}>
              <div style={{ fontSize: 10.5, color: 'var(--text2)', fontWeight: 700 }}>{b.count || ''}</div>
              <div style={{ width: '100%', height: `${Math.max(pct, b.count ? 3 : 0)}%`, background: c, borderRadius: '4px 4px 0 0', border: `1px solid ${c}` }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 3, marginTop: 3 }}>
        {h.bins.map((b, i) => (
          <div key={i} style={{ flex: 1, minWidth: 0, fontSize: 9.5, color: 'var(--muted)', textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {b.overflow ? `>${fmt(b.from)}` : fmt(b.from, h.step < 1 ? 2 : 0)}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 8, lineHeight: 1.7 }}>
        n = <b>{h.n}</b> · เฉลี่ย <b>{fmt(h.mean, 1)}</b> · มัธยฐาน <b>{fmt(h.median, 1)}</b> · P95 <b>{fmt(h.p95, 1)}</b> {unit}
        {h.sd != null && <> · SD {fmt(h.sd, 1)}</>}
        {/* ค่าสุดโต่งคือสิ่งที่ต้องไปตามต่อ — ห้ามกลบด้วยการรวมเข้าถังปกติ */}
        {h.outliers > 0 && (
          <div style={{ color: '#a855f7', fontWeight: 700 }}>
            ⚠️ มีค่าสุดโต่ง {h.outliers} ครั้ง (สูงสุด {fmt(h.max)} {unit}) แยกไว้ในแท่งม่วงขวาสุด — ไม่ได้ถูกกลบรวมกับถังปกติ
          </div>
        )}
      </div>
    </>
  );
}

/* ═══ ⑥ กราฟควบคุม XmR ══════════════════════════════════════════════════════ */
export function ControlChart({ points, unit = 'นาที', minN = 8 }) {
  const c = controlChartXmR(points, { minN });
  if (!c.ok) return <NotEnough reason={c.reason} hint="กราฟควบคุมตอบว่า “ที่เห็นวันนี้ผิดปกติ หรือเป็นความผันแปรปกติของงาน”" />;
  const hi = Math.max(c.ucl, ...c.rows.map(r => r.value)) * 1.08 || 1;
  const y = (v) => 100 - (v / hi) * 100;
  const sigAt = new Set(c.signals.map(s => s.i));
  return (
    <>
      <div style={{ position: 'relative', height: 170, marginTop: 4 }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
          <line x1="0" y1={y(c.ucl)} x2="100" y2={y(c.ucl)} stroke="#ef4444" strokeWidth="0.4" strokeDasharray="2 1.5" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1={y(c.cl)} x2="100" y2={y(c.cl)} stroke="#22c55e" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
          {!c.lclClamped && <line x1="0" y1={y(c.lcl)} x2="100" y2={y(c.lcl)} stroke="#ef4444" strokeWidth="0.4" strokeDasharray="2 1.5" vectorEffect="non-scaling-stroke" />}
          <polyline fill="none" stroke="#3b82f6" strokeWidth="0.5" vectorEffect="non-scaling-stroke"
            points={c.rows.map((r, i) => `${c.rows.length > 1 ? (i / (c.rows.length - 1)) * 100 : 50},${y(r.value)}`).join(' ')} />
          {c.rows.map((r, i) => (
            <circle key={i} cx={c.rows.length > 1 ? (i / (c.rows.length - 1)) * 100 : 50} cy={y(r.value)} r="2.4"
              fill={sigAt.has(i) ? '#ef4444' : '#3b82f6'} vectorEffect="non-scaling-stroke">
              <title>{`${r.label}: ${fmt(r.value, 1)} ${unit}`}</title>
            </circle>
          ))}
        </svg>
        <div style={{ position: 'absolute', right: 2, top: `${y(c.ucl)}%`, transform: 'translateY(-100%)', fontSize: 10, color: '#ef4444', fontWeight: 700 }}>UCL {fmt(c.ucl, 1)}</div>
        <div style={{ position: 'absolute', right: 2, top: `${y(c.cl)}%`, transform: 'translateY(-100%)', fontSize: 10, color: '#22c55e', fontWeight: 700 }}>CL {fmt(c.cl, 1)}</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: 'var(--muted)', marginTop: 2 }}>
        <span>{c.rows[0]?.label}</span><span>{c.rows[c.rows.length - 1]?.label}</span>
      </div>
      <div style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.8 }}>
        {c.inControl
          ? <span style={{ color: '#22c55e', fontWeight: 700 }}>✅ อยู่ในการควบคุม — ความผันแปรที่เห็นเป็นระดับปกติของงานนี้ (อย่าไล่แก้ทีละจุด ให้แก้ทั้งระบบถ้าอยากให้ดีขึ้น)</span>
          : <div style={{ color: '#ef4444', fontWeight: 700 }}>
              🚨 พบสัญญาณผิดปกติ {c.signals.length} จุด — จุดพวกนี้มี “สาเหตุเฉพาะ” ให้ไปตามหา
              <ul style={{ margin: '4px 0 0 18px', padding: 0, fontWeight: 600, color: 'var(--text2)' }}>
                {c.signals.slice(0, 5).map((s, i) => <li key={i}>{s.text}</li>)}
              </ul>
            </div>}
        {/* LCL ที่ถูกตัดเป็น 0 ต้องบอก ไม่งั้นคนอ่านว่า "ยังลดได้อีกติดลบ" ซึ่งไม่มีความหมาย */}
        {c.lclClamped && <div style={{ color: 'var(--muted)' }}>ขีดควบคุมล่างคำนวณได้ติดลบ → ตัดที่ 0 (ค่าที่วัดติดลบไม่ได้) จึงไม่มีเส้นล่างบนกราฟ</div>}
      </div>
    </>
  );
}

/* ═══ ⑤ ผังกระจาย ═══════════════════════════════════════════════════════════ */
export function ScatterPlot({ records, xOf, yOf, labelOf, xLabel, yLabel, minN = 5 }) {
  const s = scatter(records, { xOf, yOf, labelOf, minN });
  if (!s.ok) return <NotEnough reason={s.reason} hint="ผังกระจายตอบว่า “2 อย่างนี้ไปด้วยกันไหม” เช่น ซ่อมบ่อย ↔ เสียเวลามาก" />;
  const px = (v) => (s.xMax === s.xMin ? 50 : ((v - s.xMin) / (s.xMax - s.xMin)) * 92 + 4);
  const py = (v) => (s.yMax === s.yMin ? 50 : 96 - ((v - s.yMin) / (s.yMax - s.yMin)) * 92);
  return (
    <>
      <div style={{ height: 190, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg2)', marginTop: 4 }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
          {s.points.map((p, i) => (
            <circle key={i} cx={px(p.x)} cy={py(p.y)} r="2" fill="#3b82f6" fillOpacity="0.75" vectorEffect="non-scaling-stroke">
              <title>{`${p.label || ''}\n${xLabel}: ${fmt(p.x, 1)}\n${yLabel}: ${fmt(p.y, 1)}`}</title>
            </circle>
          ))}
        </svg>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
        <span>{xLabel} →</span><span>↑ {yLabel}</span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 6, lineHeight: 1.7 }}>
        n = <b>{s.n}</b> จุด · r = <b>{s.r == null ? '—' : s.r.toFixed(2)}</b> ({s.rText})
        {/* r ไม่ใช่เหตุผล — ต้องเขียนกำกับเสมอ ไม่งั้นคนเอาไปสรุปเป็นสาเหตุ */}
        <div style={{ color: 'var(--muted)' }}>⚠️ ค่านี้บอกแค่ว่า “ไปด้วยกัน” ไม่ได้บอกว่า “อันหนึ่งทำให้เกิดอีกอัน” — ต้องไปพิสูจน์หน้างาน</div>
      </div>
    </>
  );
}

/* ═══ ③ ผังก้างปลา 4M/6M ════════════════════════════════════════════════════ */
export function Fishbone({ records, categoryOf, textOf, labelOf, effect = 'ปัญหา' }) {
  const [open, setOpen] = useState(null);
  const fb = fishbone(records, { categoryOf, textOf, labelOf });
  if (!fb.n) return <NotEnough reason="ยังไม่มีเหตุการณ์ในช่วงนี้" />;
  const max = Math.max(...fb.bones.map(b => b.count), 1);
  const cur = fb.bones.find(b => b.key === open);
  return (
    <>
      {/* ⚠️ ผังนี้ส่วนใหญ่ "เดา" แกนมาจากข้อความ — ต้องบอกสัดส่วนไว้บนจอเสมอ ห้ามทำเป็นว่ารู้แน่ */}
      {fb.guessRate != null && fb.guessRate > 0 && (
        <div style={{ fontSize: 11.5, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 8, padding: '6px 9px', marginBottom: 8, lineHeight: 1.6 }}>
          ⚠️ <b>{Math.round(fb.guessRate * 100)}% ของรายการ ระบบเดาแกนให้จากข้อความ</b> (ไม่ได้มีคนเลือกหมวดสาเหตุไว้)
          <div style={{ color: 'var(--text2)' }}>ให้ช่างเลือก “สาเหตุเกิดจาก” ตอนบันทึกขั้นลงมือซ่อม แล้วผังนี้จะแม่นขึ้นเอง</div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8, alignContent: 'start' }}>
        {fb.bones.map(b => {
          const on = open === b.key;
          const dim = b.count === 0;
          return (
            <button key={b.key} type="button" onClick={() => setOpen(on ? null : b.key)} disabled={dim}
              style={{
                textAlign: 'left', cursor: dim ? 'default' : 'pointer', opacity: dim ? 0.45 : 1,
                background: on ? 'var(--bg3)' : 'var(--bg2)', color: 'var(--text)',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, padding: '8px 10px',
              }}>
              <div style={{ fontSize: 12.5, fontWeight: 800 }}>{b.icon} {b.label}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <div style={{ flex: 1, height: 8, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${(b.count / max) * 100}%`, height: '100%', background: b.key === 'unknown' ? '#6b7280' : 'var(--accent)' }} />
                </div>
                <b style={{ fontSize: 12.5 }}>{b.count}</b>
              </div>
              {b.guessed > 0 && <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>ในนี้เดามา {b.guessed}</div>}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
        ปลายก้าง = <b style={{ color: 'var(--text2)' }}>{effect}</b> · รวม {fb.n} รายการ · กดที่แกนเพื่อดูรายการในแกนนั้น
      </div>
      {cur && cur.items.length > 0 && (
        <div style={{ marginTop: 8, border: '1px solid var(--border)', borderRadius: 8, maxHeight: 220, overflow: 'auto' }}>
          {cur.items.slice(0, 60).map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, padding: '5px 9px', borderTop: i ? '1px solid var(--border)' : 'none', fontSize: 11.5 }}>
              <span style={{ color: 'var(--muted)', minWidth: 96, flexShrink: 0 }}>{it.label || '—'}</span>
              <span style={{ color: 'var(--text2)', flex: 1, minWidth: 0 }}>{it.text || '(ไม่ได้ระบุสาเหตุ)'}</span>
              {it.guessed && <span style={{ fontSize: 10, color: '#f59e0b', flexShrink: 0 }}>เดา</span>}
            </div>
          ))}
          {cur.items.length > 60 && <div style={{ padding: '5px 9px', fontSize: 11, color: 'var(--muted)' }}>… อีก {cur.items.length - 60} รายการ</div>}
        </div>
      )}
    </>
  );
}

/* ═══ ① ใบตรวจสอบ (ตารางนับไขว้) ═══════════════════════════════════════════ */
export function CheckSheet({ records, rowOf, colOf, rowLabel = 'อุปกรณ์', colLabel = 'กลุ่มปัญหา', maxRows = 12, maxCols = 8 }) {
  const cs = checkSheet(records, { rowOf, colOf, maxRows, maxCols });
  if (!cs.total) return <NotEnough reason="ยังไม่มีเหตุการณ์ในช่วงนี้" />;
  const hot = Math.max(...cs.rows.flatMap(r => cs.cols.map(c => cs.cell[r]?.[c] || 0)), 1);
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 11.5, width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--muted)', fontWeight: 700, position: 'sticky', left: 0, background: 'var(--card)' }}>{rowLabel} \ {colLabel}</th>
              {cs.cols.map(c => <th key={c} style={{ padding: '4px 6px', color: 'var(--text2)', fontWeight: 700, whiteSpace: 'nowrap' }}>{c}</th>)}
              <th style={{ padding: '4px 6px', color: 'var(--text)', fontWeight: 800 }}>รวม</th>
            </tr>
          </thead>
          <tbody>
            {cs.rows.map(r => (
              <tr key={r}>
                <td style={{ padding: '4px 6px', color: 'var(--text)', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'var(--card)' }}>{r}</td>
                {cs.cols.map(c => {
                  const v = cs.cell[r]?.[c] || 0;
                  // เข้มตามความถี่ — alpha-hex ไม่ใช่ color-mix() (Chromium 94 ทิ้งทั้งบรรทัด)
                  const a = v ? Math.round((v / hot) * 200 + 25).toString(16).padStart(2, '0') : null;
                  return (
                    <td key={c} style={{ padding: '4px 6px', textAlign: 'center', background: a ? `#ef4444${a}` : 'transparent', color: v ? 'var(--text)' : 'var(--muted)', fontWeight: v ? 800 : 400 }}>{v || '·'}</td>
                  );
                })}
                <td style={{ padding: '4px 6px', textAlign: 'center', fontWeight: 800, color: 'var(--text)' }}>{cs.rowTot[r]}</td>
              </tr>
            ))}
            <tr>
              <td style={{ padding: '4px 6px', fontWeight: 800, color: 'var(--text)', position: 'sticky', left: 0, background: 'var(--card)' }}>รวม</td>
              {cs.cols.map(c => <td key={c} style={{ padding: '4px 6px', textAlign: 'center', fontWeight: 800, color: 'var(--text)' }}>{cs.colTot[c]}</td>)}
              <td style={{ padding: '4px 6px', textAlign: 'center', fontWeight: 800, color: 'var(--accent)' }}>{cs.total}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {/* ตัดหางเงียบ = ตารางโกหกยอดรวม — ต้องบอกเสมอว่าซ่อนไปเท่าไหร่ */}
      {(cs.hiddenRows > 0 || cs.hiddenCols > 0) && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
          แสดงเฉพาะที่มากที่สุด — ซ่อน {cs.hiddenRows > 0 ? `${rowLabel} อีก ${cs.hiddenRows} รายการ` : ''}
          {cs.hiddenRows > 0 && cs.hiddenCols > 0 ? ' · ' : ''}
          {cs.hiddenCols > 0 ? `${colLabel} อีก ${cs.hiddenCols} รายการ` : ''} (ยอดรวมด้านล่างนับครบทั้งหมด)
        </div>
      )}
    </>
  );
}

/* ═══ ⑦ แบ่งชั้น (Stratification) ═══════════════════════════════════════════ */
export function Stratify({ records, keyOf, valOf, unit = 'ครั้ง', top = 10, onPick }) {
  const s = stratify(records, { keyOf, valOf, top });
  if (!s.total) return <NotEnough reason="ยังไม่มีเหตุการณ์ในช่วงนี้" />;
  const max = Math.max(...s.list.map(g => g.value), 1);
  return (
    <>
      {s.list.map(g => (
        <div key={g.name} onClick={onPick ? () => onPick(g) : undefined}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', cursor: onPick ? 'pointer' : 'default' }}>
          <span style={{ fontSize: 11.5, color: 'var(--text2)', minWidth: 130, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.name}>{g.name}</span>
          <div style={{ flex: 1, height: 12, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden', minWidth: 40 }}>
            <div style={{ width: `${(g.value / max) * 100}%`, height: '100%', background: 'var(--accent)' }} />
          </div>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text)', minWidth: 62, textAlign: 'right' }}>{fmt(g.value, 1)} {unit}</span>
          <span style={{ fontSize: 10.5, color: 'var(--muted)', minWidth: 38, textAlign: 'right' }}>{g.pct == null ? '' : `${g.pct.toFixed(0)}%`}</span>
        </div>
      ))}
      {s.hidden > 0 && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>… อีก {s.hidden} รายการ (รวมทั้งหมด {fmt(s.total, 1)} {unit} จาก {s.groups} รายการ)</div>}
    </>
  );
}

/* ═══ ⑦ กราฟแนวโน้ม (Run chart) ═════════════════════════════════════════════ */
export function RunChart({ records, keyOf, valOf, keys, unit = 'ครั้ง' }) {
  const rc = runChart(records, { keyOf, valOf, keys });
  if (!rc.n) return <NotEnough reason="ยังไม่มีช่วงเวลาให้เทียบ" />;
  const max = Math.max(rc.max || 0, 1);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120 }}>
        {rc.points.map(p => (
          <div key={p.label} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', height: '100%' }} title={`${p.label}: ${fmt(p.value, 1)} ${unit}`}>
            <div style={{ fontSize: 10, color: 'var(--text2)', fontWeight: 700 }}>{p.value ? fmt(p.value) : ''}</div>
            <div style={{ width: '100%', height: `${(p.value / max) * 100}%`, background: p.value ? 'var(--accent)' : 'transparent', borderRadius: '3px 3px 0 0', minHeight: p.value ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 3, marginTop: 3 }}>
        {rc.points.map(p => <div key={p.label} style={{ flex: 1, minWidth: 0, fontSize: 9.5, color: 'var(--muted)', textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>{p.label.slice(-5)}</div>)}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 6 }}>
        รวม <b>{fmt(rc.total, 1)}</b> {unit} · เฉลี่ยช่วงละ <b>{fmt(rc.mean, 1)}</b>
        {/* ช่วงที่ไม่มีเหตุการณ์ = 0 จริง ไม่ใช่ "ไม่มีข้อมูล" — แท่งว่างต้องอยู่บนกราฟ */}
        <span style={{ color: 'var(--muted)' }}> · ช่วงที่ไม่มีแท่ง = ไม่มีเหตุการณ์จริง (ไม่ใช่ข้อมูลหาย)</span>
      </div>
    </>
  );
}

export { BONES };
