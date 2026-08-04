import { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

/* ── Pareto + ABC Analysis (ใช้ร่วมทุกกราฟพาเรโต) — 2026-08-04 คำสั่ง user ─────────────────
   ปัญหาเดิม: แกน Y โชว์ชื่อ "ทุกรายการ" → ดูเหมือนสำคัญเท่ากันหมด อ่านไม่ออกว่าต้องแก้อะไรก่อน
   แก้: จัดกลุ่ม ABC ตาม % สะสม (A ≤80% = ตัวหลักต้องแก้ · B ≤95% · C ที่เหลือ = หางยาว)
     - แกน Y โชว์ชื่อ **เฉพาะกลุ่ม A** · B/C ดูชื่อได้ที่ tooltip / ปุ่มขยาย
     - แถบสีตามกลุ่ม (A เข้ม → C จาง) ไม่ใช่สีรายประเภทที่ไม่มีลำดับความสำคัญ
     - ปุ่ม ⤢ ขยาย = popup เต็มจอ เห็นครบทุกรายการ + ตาราง %/‰สะสม
   ใช้กับ: Downtime pareto, ของเสียรายประเภท (และกราฟพาเรโตใหม่ๆ ให้ reuse ตัวนี้) */

const ABC = {
  A: { color: '#ef4444', label: 'A', desc: 'ตัวหลัก (80% ของปัญหา)' },
  B: { color: '#f59e0b', label: 'B', desc: 'รอง (80–95%)' },
  C: { color: '#6b7280', label: 'C', desc: 'หางยาว (5% สุดท้าย)' },
};

// จัดกลุ่ม ABC จาก % สะสม — รายการแรกเป็น A เสมอ (กันเคสรายการเดียวกินเกิน 80% แล้วไม่มี A)
export function classifyAbc(items, valueOf) {
  const sorted = [...items].sort((a, b) => valueOf(b) - valueOf(a));
  const total = sorted.reduce((s, d) => s + (valueOf(d) || 0), 0);
  let run = 0;
  return sorted.map((d, i) => {
    const v = valueOf(d) || 0;
    const prevCum = total > 0 ? run / total * 100 : 0;
    run += v;
    const cum = total > 0 ? run / total * 100 : 0;
    const cls = i === 0 || prevCum < 80 ? 'A' : prevCum < 95 ? 'B' : 'C';
    return { ...d, _val: v, _pct: total > 0 ? v / total * 100 : 0, _cum: cum, _cls: cls };
  });
}

const fmt = (n) => Math.round(n).toLocaleString('en-US');

export default function ParetoAbcChart({ title, data, valueKey, unit, height = 240, emptyText = 'ไม่มีข้อมูล', sectionStyle, titleStyle }) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => classifyAbc(data || [], d => d[valueKey]), [data, valueKey]);
  const total = rows.reduce((s, d) => s + d._val, 0);
  const groups = useMemo(() => {
    const g = { A: [], B: [], C: [] };
    rows.forEach(r => g[r._cls].push(r));
    return g;
  }, [rows]);

  const tip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    const m = ABC[d._cls];
    return (
      <div style={{ background: 'var(--bg3)', border: `1px solid ${m.color}66`, borderLeft: `3px solid ${m.color}`, borderRadius: 7, padding: '8px 11px', fontSize: 12, maxWidth: 280 }}>
        <div style={{ fontWeight: 800, color: 'var(--text)', marginBottom: 3 }}>{d.name}</div>
        <div style={{ color: m.color, fontWeight: 700 }}>กลุ่ม {m.label} · {m.desc}</div>
        <div style={{ color: 'var(--text2)', marginTop: 3 }}>
          {fmt(d._val)} {unit} · <b>{d._pct.toFixed(1)}%</b> ของทั้งหมด
        </div>
        <div style={{ color: 'var(--muted)' }}>สะสมถึงรายการนี้ {d._cum.toFixed(1)}%</div>
      </div>
    );
  };

  // แกน Y: โชว์ชื่อเฉพาะกลุ่ม A (ที่เหลือเป็นจุด — กันภาพรก + ไม่ให้ดูสำคัญเท่ากันหมด)
  const yTick = ({ x, y, payload }) => {
    const d = rows[payload.index];
    if (!d) return null;
    const isA = d._cls === 'A';
    const txt = isA ? (d.name.length > 22 ? d.name.slice(0, 21) + '…' : d.name) : '·';
    return (
      <text x={x} y={y} dy={4} textAnchor="end" fill={isA ? 'var(--text)' : 'var(--muted)'}
        fontSize={isA ? 11 : 13} fontWeight={isA ? 700 : 400}>{txt}</text>
    );
  };

  const chart = (h, showAllLabels) => (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={rows} layout="vertical" margin={{ left: 10, right: 34, top: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
        <YAxis dataKey="name" type="category" width={showAllLabels ? 210 : 140}
          tick={showAllLabels ? { fontSize: 11, fill: 'var(--text2)' } : yTick} interval={0} />
        <Tooltip content={tip} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar dataKey={valueKey} radius={[0, 4, 4, 0]}>
          {rows.map((d, i) => <Cell key={i} fill={ABC[d._cls].color} fillOpacity={d._cls === 'A' ? 1 : d._cls === 'B' ? 0.75 : 0.45} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );

  // แถบสัดส่วน A/B/C
  const strip = (
    <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', background: 'var(--bg3)', marginBottom: 8 }}>
      {['A', 'B', 'C'].map(k => {
        const sum = groups[k].reduce((s, d) => s + d._val, 0);
        return sum > 0 ? <div key={k} style={{ width: `${sum / total * 100}%`, background: ABC[k].color, opacity: k === 'A' ? 1 : k === 'B' ? 0.75 : 0.45 }} title={`${k}: ${groups[k].length} รายการ · ${fmt(sum)} ${unit}`} /> : null;
      })}
    </div>
  );

  const legend = (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 10.5, color: 'var(--muted)', marginTop: 6 }}>
      {['A', 'B', 'C'].map(k => groups[k].length > 0 && (
        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: ABC[k].color, opacity: k === 'A' ? 1 : k === 'B' ? 0.75 : 0.45 }} />
          {ABC[k].label} · {groups[k].length} รายการ ({(groups[k].reduce((s, d) => s + d._val, 0) / total * 100).toFixed(0)}%)
        </span>
      ))}
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
          style={{ flexShrink: 0, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 7, color: 'var(--text2)', fontSize: 11.5, fontWeight: 700, padding: '3px 9px', cursor: 'pointer' }}>
          ⤢ ขยาย
        </button>
      </div>
      {strip}
      {chart(height, false)}
      {legend}
      {/* เน้นกลุ่ม A — ตัวที่ต้องแก้ก่อน */}
      <div style={{ marginTop: 9, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: ABC.A.color }}>เน้นแก้กลุ่ม A →</span>
        {groups.A.map((d, i) => (
          <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: `${ABC.A.color}1e`, border: `1px solid ${ABC.A.color}55`, color: ABC.A.color, fontWeight: 700 }}>
            {d.name}: {fmt(d._val)} {unit} ({d._pct.toFixed(0)}%)
          </span>
        ))}
      </div>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1250, background: 'rgba(0,0,0,0.68)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, width: '100%', maxWidth: 980, maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px 10px', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                  ABC Analysis · รวม {fmt(total)} {unit} · {rows.length} รายการ — <b style={{ color: ABC.A.color }}>กลุ่ม A {groups.A.length} รายการ = {(groups.A.reduce((s, d) => s + d._val, 0) / total * 100).toFixed(0)}% ของทั้งหมด</b>
                </div>
              </div>
              <button onClick={() => setOpen(false)} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: 'var(--text2)', fontSize: 15 }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '14px 20px 20px' }}>
              {chart(Math.max(280, rows.length * 26), true)}
              <div style={{ overflowX: 'auto', marginTop: 14 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 460, fontVariantNumeric: 'tabular-nums' }}>
                  <thead><tr style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '5px 7px' }}>#</th>
                    <th style={{ textAlign: 'left', padding: '5px 7px' }}>รายการ</th>
                    <th style={{ textAlign: 'center', padding: '5px 7px' }}>กลุ่ม</th>
                    <th style={{ textAlign: 'right', padding: '5px 7px' }}>{unit}</th>
                    <th style={{ textAlign: 'right', padding: '5px 7px' }}>%</th>
                    <th style={{ textAlign: 'right', padding: '5px 7px' }}>สะสม %</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((d, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border2)', color: 'var(--text)', background: d._cls === 'A' ? `${ABC.A.color}0d` : undefined }}>
                        <td style={{ padding: '6px 7px', color: 'var(--muted)' }}>{i + 1}</td>
                        <td style={{ padding: '6px 7px', fontWeight: d._cls === 'A' ? 700 : 400 }}>{d.name}</td>
                        <td style={{ padding: '6px 7px', textAlign: 'center' }}>
                          <span style={{ fontSize: 10.5, fontWeight: 800, color: ABC[d._cls].color, background: `${ABC[d._cls].color}1e`, border: `1px solid ${ABC[d._cls].color}55`, borderRadius: 20, padding: '1px 7px' }}>{d._cls}</span>
                        </td>
                        <td style={{ padding: '6px 7px', textAlign: 'right', fontWeight: 700 }}>{fmt(d._val)}</td>
                        <td style={{ padding: '6px 7px', textAlign: 'right' }}>{d._pct.toFixed(1)}%</td>
                        <td style={{ padding: '6px 7px', textAlign: 'right', color: 'var(--muted)' }}>{d._cum.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, lineHeight: 1.7 }}>
                <b style={{ color: ABC.A.color }}>A</b> = สะสมถึง 80% แรก — แก้กลุ่มนี้ได้ผลมากที่สุด ·
                <b style={{ color: ABC.B.color }}> B</b> = 80–95% ·
                <b style={{ color: ABC.C.color }}> C</b> = 5% สุดท้าย (หางยาว ไม่คุ้มลงแรงก่อน)
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
