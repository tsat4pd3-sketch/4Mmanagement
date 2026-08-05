import { useState, useMemo } from 'react';

/* ── Pareto + ABC Analysis + Drill-down (ใช้ร่วมทุกกราฟพาเรโต) — 2026-08-04 คำสั่ง user ────────
   1) ABC: จัดกลุ่มตาม % สะสม (A ≤80% ตัวหลัก · B ≤95% · C หางยาว) — สีตามกลุ่ม ไม่ใช่สีรายประเภท
   2) **ความหนาแท่งไม่เท่ากันตามกลุ่ม** — A หนา+ชื่อเต็ม · B บาง+ชื่อย่อ · C บางมาก (ในโหมดย่อ
      ยุบเป็นแถบเดียว) — ให้สายตาไปที่ A ก่อน · วาดด้วย HTML ไม่ใช่ Recharts เพราะ Recharts
      บังคับทุกแถวสูงเท่ากัน → ข้อมูลเยอะแล้ว **ชื่อบนแกน Y เขียนทับกัน** (บั๊กที่เจอจริง 2026-08-05)
   3) **คลิกแท่ง = เจาะลึก** แยกตามมิติที่เกี่ยวข้อง (เครื่องจักร/ไลน์/ชิ้นงาน/กะ/คน/วัน) + เห็นรายการดิบ
   รับ `records` (แถวดิบ flat) แล้ว component รวมยอดเอง → เจาะได้ทุกมิติโดยไม่ต้อง query ใหม่ */

const ABC = {
  A: { color: '#ef4444', label: 'A', desc: 'ตัวหลัก (80% ของปัญหา)' },
  B: { color: '#f59e0b', label: 'B', desc: 'รอง (80–95%)' },
  C: { color: '#6b7280', label: 'C', desc: 'หางยาว (5% สุดท้าย)' },
};
const OPA = { A: 1, B: 0.75, C: 0.45 };
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// จัดกลุ่ม ABC จาก % สะสม — รายการแรกเป็น A เสมอ (กันเคสรายการเดียวกินเกิน 80% แล้วไม่มี A)
export function classifyAbc(items, valueOf) {
  const sorted = [...items].sort((a, b) => valueOf(b) - valueOf(a));
  const total = sorted.reduce((s, d) => s + (valueOf(d) || 0), 0);
  let run = 0;
  return sorted.map((d, i) => {
    const v = valueOf(d) || 0;
    const prevCum = total > 0 ? run / total * 100 : 0;
    run += v;
    return { ...d, _val: v, _pct: total > 0 ? v / total * 100 : 0, _cum: total > 0 ? run / total * 100 : 0,
      _cls: i === 0 || prevCum < 80 ? 'A' : prevCum < 95 ? 'B' : 'C' };
  });
}

const groupBy = (records, keyOf) => {
  const m = {};
  records.forEach(r => {
    const k = keyOf(r) || '(ไม่ระบุ)';
    (m[k] || (m[k] = { name: k, value: 0, count: 0 })).value += r.value || 0;
    m[k].count++;
  });
  return Object.values(m);
};

export default function ParetoAbcChart({
  title, records = [], dims = [], unit, height = 240,
  emptyText = 'ไม่มีข้อมูล', sectionStyle, titleStyle,
}) {
  const [open, setOpen] = useState(false);
  const [drill, setDrill] = useState(null);           // ชื่อประเภทที่กำลังเจาะ
  const [dimKey, setDimKey] = useState(dims[0]?.key || null);

  const rows = useMemo(() => classifyAbc(groupBy(records, r => r.cat), d => d.value), [records]);
  const total = rows.reduce((s, d) => s + d._val, 0);
  const groups = useMemo(() => {
    const g = { A: [], B: [], C: [] };
    rows.forEach(r => g[r._cls].push(r));
    return g;
  }, [rows]);

  // ── ข้อมูลของประเภทที่เจาะ ──
  const drillRecs = useMemo(() => (drill ? records.filter(r => (r.cat || '(ไม่ระบุ)') === drill) : []), [records, drill]);
  const drillRows = useMemo(() => (dimKey ? classifyAbc(groupBy(drillRecs, r => r[dimKey]), d => d.value) : []), [drillRecs, dimKey]);
  const drillTotal = drillRows.reduce((s, d) => s + d._val, 0);

  const openDrill = (name) => { setDrill(name); if (!dimKey && dims[0]) setDimKey(dims[0].key); };

  const tip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload; const m = ABC[d._cls];
    return (
      <div style={{ background: 'var(--bg3)', border: `1px solid ${m.color}66`, borderLeft: `3px solid ${m.color}`, borderRadius: 7, padding: '8px 11px', fontSize: 12, maxWidth: 290 }}>
        <div style={{ fontWeight: 800, color: 'var(--text)', marginBottom: 3 }}>{d.name}</div>
        <div style={{ color: m.color, fontWeight: 700 }}>กลุ่ม {m.label} · {m.desc}</div>
        <div style={{ color: 'var(--text2)', marginTop: 3 }}>{fmt(d._val)} {unit} · <b>{d._pct.toFixed(1)}%</b> ของทั้งหมด · {d.count} ครั้ง</div>
        <div style={{ color: 'var(--muted)' }}>สะสมถึงรายการนี้ {d._cum.toFixed(1)}%</div>
        {dims.length > 0 && <div style={{ color: 'var(--accent)', marginTop: 4, fontWeight: 700 }}>🔍 คลิกเพื่อเจาะลึก</div>}
      </div>
    );
  };

  // แกน Y: ชื่อเฉพาะกลุ่ม A · ที่เหลือเป็นจุด
  const yTick = ({ x, y, payload }) => {
    const d = rows[payload.index]; if (!d) return null;
    const isA = d._cls === 'A';
    return (
      <text x={x} y={y} dy={4} textAnchor="end" fill={isA ? 'var(--text)' : 'var(--muted)'}
        fontSize={isA ? 11 : 13} fontWeight={isA ? 700 : 400}>
        {isA ? (d.name.length > 22 ? d.name.slice(0, 21) + '…' : d.name) : '·'}
      </text>
    );
  };

  // ── แท่ง HTML: ความหนา/ขนาดตัวอักษรต่างกันตามกลุ่ม ABC (Recharts ทำไม่ได้ — ทุก band สูงเท่ากัน) ──
  const BAR = { A: { h: 20, font: 12, name: true }, B: { h: 11, font: 11, name: true }, C: { h: 6, font: 10.5, name: false } };
  const maxVal = Math.max(1, ...rows.map(d => d._val));

  const barRow = (d, i, { showName, compact }) => {
    const m = ABC[d._cls]; const cfg = BAR[d._cls];
    const nameShown = showName || cfg.name;
    return (
      <div key={i} onClick={() => dims.length && openDrill(d.name)}
        title={`${d.name} · ${fmt(d._val)} ${unit} (${d._pct.toFixed(1)}%) · ${d.count} ครั้ง · สะสม ${d._cum.toFixed(1)}%`}
        style={{ display: 'grid', gridTemplateColumns: nameShown ? `minmax(0, ${compact ? '38%' : '30%'}) 1fr auto` : '1fr auto',
          alignItems: 'center', gap: 8, cursor: dims.length ? 'pointer' : 'default',
          padding: d._cls === 'A' ? '3px 0' : '1.5px 0' }}>
        {nameShown && (
          <span style={{ fontSize: cfg.font, fontWeight: d._cls === 'A' ? 700 : 500,
            color: d._cls === 'A' ? 'var(--text)' : 'var(--text2)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right' }}>{d.name}</span>
        )}
        <span style={{ display: 'block', background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden', height: cfg.h }}>
          <span style={{ display: 'block', height: '100%', width: `${Math.max(1.5, d._val / maxVal * 100)}%`,
            background: m.color, opacity: OPA[d._cls], borderRadius: 3 }} />
        </span>
        <span style={{ fontSize: d._cls === 'A' ? 11.5 : 10.5, fontWeight: d._cls === 'A' ? 800 : 600,
          color: d._cls === 'A' ? m.color : 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {fmt(d._val)}{d._cls === 'A' ? ` (${d._pct.toFixed(0)}%)` : ''}
        </span>
      </div>
    );
  };

  // โหมดย่อ: A+B แสดงเป็นแท่ง · C ยุบเป็นแถบเดียว (ไม่มีชื่อ ไม่กินที่ — กดขยายดูได้)
  const chartCompact = () => {
    const cSum = groups.C.reduce((s2, d) => s2 + d._val, 0);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {[...groups.A, ...groups.B].map((d, i) => barRow(d, i, { compact: true }))}
        {groups.C.length > 0 && (
          <div onClick={() => setOpen(true)} title={`กลุ่ม C ${groups.C.length} รายการ · ${fmt(cSum)} ${unit} — กดดูรายละเอียด`}
            style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 38%) 1fr auto', alignItems: 'center', gap: 8, cursor: 'pointer', paddingTop: 3 }}>
            <span style={{ fontSize: 10.5, color: 'var(--muted)', textAlign: 'right' }}>C · {groups.C.length} รายการ (หางยาว)</span>
            <span style={{ display: 'block', background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden', height: 6 }}>
              <span style={{ display: 'block', height: '100%', width: `${Math.max(1.5, cSum / maxVal * 100)}%`, background: ABC.C.color, opacity: OPA.C }} />
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmt(cSum)}</span>
          </div>
        )}
      </div>
    );
  };

  // โหมดขยาย: ทุกรายการมีชื่อ (C ก็เห็น) ความหนายังต่างกันตามกลุ่ม
  const chartFull = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {rows.map((d, i) => barRow(d, i, { showName: true }))}
    </div>
  );

  const strip = (
    <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', background: 'var(--bg3)', marginBottom: 8 }}>
      {['A', 'B', 'C'].map(k => {
        const sum = groups[k].reduce((s, d) => s + d._val, 0);
        return sum > 0 ? <div key={k} style={{ width: `${sum / total * 100}%`, background: ABC[k].color, opacity: OPA[k] }}
          title={`${k}: ${groups[k].length} รายการ · ${fmt(sum)} ${unit}`} /> : null;
      })}
    </div>
  );

  if (!rows.length) {
    return (
      <div style={sectionStyle}>
        <div style={titleStyle}>{title}</div>
        <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 13 }}>{emptyText}</div>
      </div>
    );
  }

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={titleStyle}>{title}</div>
        <button onClick={() => setOpen(true)} title="ขยายดูทุกรายการ"
          style={{ flexShrink: 0, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 7, color: 'var(--text2)', fontSize: 11.5, fontWeight: 700, padding: '3px 9px', cursor: 'pointer' }}>⤢ ขยาย</button>
      </div>
      {strip}
      {chartCompact()}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 10.5, color: 'var(--muted)', marginTop: 6 }}>
        {['A', 'B', 'C'].map(k => groups[k].length > 0 && (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: ABC[k].color, opacity: OPA[k] }} />
            {k} · {groups[k].length} รายการ ({(groups[k].reduce((s, d) => s + d._val, 0) / total * 100).toFixed(0)}%)
          </span>
        ))}
        {dims.length > 0 && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>🔍 คลิกแท่ง/ชิป = เจาะลึก</span>}
      </div>
      {/* เน้นกลุ่ม A — ตัวที่ต้องแก้ก่อน (คลิกเจาะได้) */}
      <div style={{ marginTop: 9, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: ABC.A.color }}>เน้นแก้กลุ่ม A →</span>
        {groups.A.map((d, i) => (
          <span key={i} onClick={() => dims.length && openDrill(d.name)}
            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: `${ABC.A.color}1e`, border: `1px solid ${ABC.A.color}55`, color: ABC.A.color, fontWeight: 700, cursor: dims.length ? 'pointer' : 'default' }}>
            {d.name}: {fmt(d._val)} {unit} ({d._pct.toFixed(0)}%)
          </span>
        ))}
      </div>

      {/* ── popup ขยาย: เห็นครบทุกรายการ + ตาราง (คลิกแถวเจาะได้) ── */}
      {open && (
        <div onClick={() => setOpen(false)} style={ovl(1250)}>
          <div onClick={e => e.stopPropagation()} style={{ ...panel, maxWidth: 980 }}>
            <div style={head}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                  ABC Analysis · รวม {fmt(total)} {unit} · {rows.length} รายการ — <b style={{ color: ABC.A.color }}>กลุ่ม A {groups.A.length} รายการ = {(groups.A.reduce((s, d) => s + d._val, 0) / total * 100).toFixed(0)}%</b>
                </div>
              </div>
              <button onClick={() => setOpen(false)} style={closeBtn}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '14px 20px 20px' }}>
              {chartFull()}
              <div style={{ overflowX: 'auto', marginTop: 14 }}>
                <table style={tbl}>
                  <thead><tr style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                    <th style={thL}>#</th><th style={thL}>รายการ</th><th style={thC}>กลุ่ม</th>
                    <th style={thR}>{unit}</th><th style={thR}>ครั้ง</th><th style={thR}>%</th><th style={thR}>สะสม %</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((d, i) => (
                      <tr key={i} onClick={() => dims.length && openDrill(d.name)}
                        style={{ borderBottom: '1px solid var(--border2)', color: 'var(--text)', background: d._cls === 'A' ? `${ABC.A.color}0d` : undefined, cursor: dims.length ? 'pointer' : 'default' }}>
                        <td style={{ padding: '6px 7px', color: 'var(--muted)' }}>{i + 1}</td>
                        <td style={{ padding: '6px 7px', fontWeight: d._cls === 'A' ? 700 : 400 }}>{d.name}</td>
                        <td style={{ padding: '6px 7px', textAlign: 'center' }}><span style={clsChip(d._cls)}>{d._cls}</span></td>
                        <td style={{ padding: '6px 7px', textAlign: 'right', fontWeight: 700 }}>{fmt(d._val)}</td>
                        <td style={{ padding: '6px 7px', textAlign: 'right', color: 'var(--muted)' }}>{d.count}</td>
                        <td style={{ padding: '6px 7px', textAlign: 'right' }}>{d._pct.toFixed(1)}%</td>
                        <td style={{ padding: '6px 7px', textAlign: 'right', color: 'var(--muted)' }}>{d._cum.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, lineHeight: 1.7 }}>
                <b style={{ color: ABC.A.color }}>A</b> = สะสมถึง 80% แรก — แก้กลุ่มนี้ได้ผลมากที่สุด · <b style={{ color: ABC.B.color }}>B</b> = 80–95% · <b style={{ color: ABC.C.color }}>C</b> = 5% สุดท้าย
                {dims.length > 0 && ' · คลิกแถวเพื่อเจาะลึก'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── popup เจาะลึก: แยกตามมิติ (เครื่อง/ไลน์/ชิ้นงาน/กะ/คน/วัน) + รายการดิบ ── */}
      {drill && (
        <div onClick={() => setDrill(null)} style={ovl(1270)}>
          <div onClick={e => e.stopPropagation()} style={{ ...panel, maxWidth: 900 }}>
            <div style={head}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>🔍 เจาะลึก · {title}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{drill}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                  {fmt(drillTotal)} {unit} · {drillRecs.length} ครั้ง · {(drillTotal / total * 100).toFixed(1)}% ของทั้งหมด
                </div>
              </div>
              <button onClick={() => setDrill(null)} style={closeBtn}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '12px 20px 20px' }}>
              {/* เลือกมิติที่จะแยก */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                {dims.map(dm => (
                  <button key={dm.key} onClick={() => setDimKey(dm.key)}
                    style={{ padding: '5px 11px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      border: `1px solid ${dimKey === dm.key ? 'var(--accent)' : 'var(--border2)'}`,
                      background: dimKey === dm.key ? 'var(--accent-dim)' : 'var(--bg3)',
                      color: dimKey === dm.key ? 'var(--accent)' : 'var(--text2)' }}>{dm.label}</button>
                ))}
              </div>

              {/* สัดส่วนตามมิติที่เลือก — แถบ + ตัวเลข (ABC เหมือนกัน) */}
              {drillRows.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--muted)', padding: 16, textAlign: 'center' }}>ไม่มีข้อมูลในมิตินี้</div>
              ) : (
                <div style={{ display: 'grid', gap: 5 }}>
                  {drillRows.map((d, i) => (
                    <div key={i} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '7px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={clsChip(d._cls)}>{d._cls}</span>
                        <span style={{ minWidth: 0, flex: 1, fontSize: 12.5, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: ABC[d._cls].color, whiteSpace: 'nowrap' }}>{fmt(d._val)} {unit}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', width: 76, textAlign: 'right' }}>{d._pct.toFixed(1)}% · {d.count} ครั้ง</span>
                      </div>
                      <div style={{ height: 5, borderRadius: 3, background: 'var(--bg)', marginTop: 5, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${d._pct}%`, background: ABC[d._cls].color, opacity: OPA[d._cls] }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* รายการดิบ (มากสุดก่อน) — เห็นหมายเหตุพนักงานจริง */}
              <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text2)', margin: '16px 0 7px', paddingBottom: 5, borderBottom: '1px solid var(--border)' }}>
                รายการจริง ({drillRecs.length})
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                {[...drillRecs].sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 40).map((r, i) => (
                  <div key={i} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 7, padding: '6px 9px', fontSize: 11.5 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <b style={{ color: ABC.A.color, whiteSpace: 'nowrap' }}>{fmt(r.value)} {unit}</b>
                      {dims.map(dm => r[dm.key] ? (
                        <span key={dm.key} style={{ color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                          <span style={{ color: 'var(--muted)' }}>{dm.label}</span> {r[dm.key]}
                        </span>
                      ) : null)}
                    </div>
                    {r.note && <div style={{ color: 'var(--muted)', marginTop: 3 }}>💬 {r.note}</div>}
                  </div>
                ))}
                {drillRecs.length > 40 && <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: 6 }}>… และอีก {drillRecs.length - 40} รายการ</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── styles ── */
const ovl = (z) => ({ position: 'fixed', inset: 0, zIndex: z, background: 'rgba(0,0,0,0.68)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 });
const panel = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, width: '100%', maxHeight: '92vh', display: 'flex', flexDirection: 'column' };
const head = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, padding: '16px 20px 10px', borderBottom: '1px solid var(--border)' };
const closeBtn = { background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: 'var(--text2)', fontSize: 15, flexShrink: 0 };
const tbl = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 520, fontVariantNumeric: 'tabular-nums' };
// index.css มี `th { text-align: left }` (rule ตรงชนะ inherit) → ต้องสั่ง textAlign ที่ th เอง
const thL = { textAlign: 'left', padding: '5px 7px' };
const thR = { textAlign: 'right', padding: '5px 7px' };
const thC = { textAlign: 'center', padding: '5px 7px' };
const clsChip = (c) => ({ fontSize: 10.5, fontWeight: 800, color: ABC[c].color, background: `${ABC[c].color}1e`, border: `1px solid ${ABC[c].color}55`, borderRadius: 20, padding: '1px 7px', flexShrink: 0 });
