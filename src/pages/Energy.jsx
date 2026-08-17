/* ⚡ พลังงานไฟฟ้า (เฟส 1) — กรอกหน่วยไฟรายเดือนต่อไลน์/โซน แล้วไปโชว์บนผังรวมโรงงาน
   ที่มา: ทีมสรุปกันว่า "show ค่า kWh บริเวณ Line บนผัง ก่อน · Phase แรกขอ Input รายเดือนได้ก่อน"
   → หน้านี้ทำหน้าที่ "ป้อนข้อมูล + สรุป" ส่วน "ภาพที่เอาไปพรีเซนต์" อยู่ที่ /factory-map (metric ⚡ พลังงาน)

   ⚠️ เฟสนี้ไฟฟ้าอย่างเดียว · ค่าที่กรอกมือต้องติดป้ายที่มาเสมอ ห้ามแสดงเหมือนค่าที่วัดจริง
   ⚠️ สูตรทั้งหมดอยู่ src/utils/energy.js — ห้ามคำนวณเองในไฟล์นี้ */
import { useState, useEffect, useMemo, useContext, useCallback } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import PageHeader from '../components/PageHeader';
import useTabParam from '../utils/useTabParam';
import {
  monthKeyOf, shiftMonth, monthLabel, fmtKwh, fmtBaht, deltaPct,
  bahtPerUnit, RATE_SANE_MIN, RATE_SANE_MAX, sourceMeta, sumRows,
} from '../utils/energy';

const inp = { width: '100%', padding: '7px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' };
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 };
const th = { textAlign: 'left', fontSize: 11.5, color: 'var(--muted)', fontWeight: 700, padding: '7px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const td = { padding: '5px 8px', borderBottom: '1px solid var(--border)', fontSize: 12.5 };

export default function Energy() {
  const { role, lineId, sections: scopeSecs } = useContext(UserContext);
  const canEdit = can('energy', 'record', role);
  const [tab, setTab] = useTabParam(['input', 'summary'], 'input');
  const [month, setMonth] = useState(() => monthKeyOf());
  const [lines, setLines] = useState([]);
  const [zones, setZones] = useState([]);
  const [rows, setRows] = useState([]);        // เดือนที่เลือก
  const [prevRows, setPrevRows] = useState([]); // เดือนก่อน (ไว้เทียบ)
  const [loading, setLoading] = useState(true);

  /* ── scope มาตรฐาน: leader = family ไลน์ตัวเอง · role อื่น = ตาม sections ── */
  const scopedLines = useMemo(() => {
    if (role === 'leader' && lineId) {
      const me = lines.find(l => l.id === lineId);
      const fam = me ? getLineFamilyNames(lines, me.name) : null;
      return fam ? lines.filter(l => fam.includes(l.name)) : lines;
    }
    if (scopeSecs?.length) return lines.filter(l => inSectionScope(scopeSecs, l.section));
    return lines;
  }, [lines, role, lineId, scopeSecs]);

  // จุดที่กรอกได้ = ไลน์บนสุด (ไม่ลงลูก — พลังงานวัดกันระดับกลุ่ม) + โซน facility
  const points = useMemo(() => ([
    ...scopedLines.filter(l => !l.parent_line_name).map(l => ({ kind: 'line', name: l.name, section: l.section })),
    ...zones.map(z => ({ kind: 'zone', name: z, section: null })),
  ]), [scopedLines, zones]);

  const load = useCallback(async () => {
    setLoading(true);
    const prev = shiftMonth(month, -1);
    const [{ data: ln }, { data: areas }, { data: facMc }, { data: cur }, { data: pv }] = await Promise.all([
      supabase.from('production_lines').select('id, name, section, parent_line_name').order('name'),
      supabaseDR.from('pm_facility_areas').select('name').order('name'),
      supabaseDR.from('machines').select('line_name').eq('equipment_category', 'facility').eq('is_active', true),
      supabaseDR.from('energy_monthly').select('*').eq('month_key', month).eq('utility', 'electric'),
      supabaseDR.from('energy_monthly').select('*').eq('month_key', prev).eq('utility', 'electric'),
    ]);
    setLines(ln || []);
    // โซน facility = พื้นที่ที่ตั้งไว้ + ชื่อกลุ่มของเครื่อง facility (ตรงกับที่ผังรวมใช้ตีกรอบ)
    const zs = new Set([...(areas || []).map(a => a.name), ...(facMc || []).map(m => m.line_name)].filter(Boolean));
    setZones([...zs].sort());
    setRows(cur || []);
    setPrevRows(pv || []);
    setLoading(false);
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const keyOf = (p) => `${p.kind}::${p.name}`;
  const byKey = useMemo(() => Object.fromEntries((rows || []).map(r => [`${r.scope_kind}::${r.scope_name}`, r])), [rows]);
  const prevByKey = useMemo(() => Object.fromEntries((prevRows || []).map(r => [`${r.scope_kind}::${r.scope_name}`, r])), [prevRows]);

  /* บันทึกทีละช่อง (upsert) — ไม่มีปุ่ม save รวม กรอกแล้วเซฟเลยเหมือนหน้ากรอกอื่นในระบบ */
  const saveCell = async (p, patch) => {
    if (!canEdit) return;
    const k = keyOf(p), old = byKey[k];
    const payload = {
      scope_kind: p.kind, scope_name: p.name, month_key: month, utility: 'electric',
      qty: old?.qty ?? null, cost: old?.cost ?? null, source: old?.source || 'manual', note: old?.note ?? null,
      ...patch,
    };
    // ทุกช่องว่างหมด = ลบแถวทิ้ง (ไม่เก็บแถวเปล่าให้รก)
    if (payload.qty == null && payload.cost == null && !payload.note) {
      if (old?.id) { await supabaseDR.from('energy_monthly').delete().eq('id', old.id); load(); }
      return;
    }
    const { error } = await supabaseDR.from('energy_monthly')
      .upsert(payload, { onConflict: 'scope_kind,scope_name,month_key,utility' });
    if (error) return toast.error(error.message);
    load();
  };
  const numOrNull = (v) => (String(v).trim() === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

  /* ── สรุป ── */
  const plant = byKey['plant::PLANT'];
  const plantPrev = prevByKey['plant::PLANT'];
  const lineRows = points.filter(p => p.kind === 'line').map(p => byKey[keyOf(p)]).filter(Boolean);
  const zoneRows = points.filter(p => p.kind === 'zone').map(p => byKey[keyOf(p)]).filter(Boolean);
  const sumAll = sumRows([...lineRows, ...zoneRows]);
  const sumPrev = sumRows(points.map(p => prevByKey[keyOf(p)]).filter(Boolean));
  const dAll = deltaPct(sumAll.qty, sumPrev.qty);
  // ผลรวมรายจุด vs ยอดจากบิล — ห่างกันมาก = ยังกรอกไม่ครบ/ปันส่วนเพี้ยน (ห้ามเงียบ)
  const gap = (plant?.qty != null && sumAll.qty != null) ? deltaPct(sumAll.qty, plant.qty) : null;

  const Kpi = ({ label, value, sub, tone }) => (
    <div style={{ ...card, flex: '1 1 190px', minWidth: 170 }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: tone || 'var(--text)', marginTop: 3 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
  const deltaChip = (d) => d == null ? <span style={{ color: 'var(--muted)' }}>—</span>
    : <span style={{ color: d <= -5 ? '#22c55e' : d > 10 ? '#ef4444' : 'var(--text2)', fontWeight: 700 }}>{d > 0 ? '+' : ''}{d}%</span>;

  return (
    <div style={{ padding: 16, maxWidth: 1400, margin: '0 auto' }}>
      <PageHeader title="พลังงานไฟฟ้า" icon="⚡" sub={`${monthLabel(month)} · เฟส 1 กรอกรายเดือน`}
        tabs={[{ key: 'input', label: '📝 กรอกรายเดือน' }, { key: 'summary', label: '📊 สรุป' }]}
        tab={tab} onTab={setTab}
        actions={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={() => setMonth(m => shiftMonth(m, -1))} style={{ ...inp, width: 36, cursor: 'pointer' }}>◀</button>
            <input type="month" value={month} max={monthKeyOf()} onChange={e => e.target.value && setMonth(e.target.value)} style={{ ...inp, width: 150 }} />
            <button onClick={() => setMonth(m => shiftMonth(m, 1))} disabled={month >= monthKeyOf()}
              style={{ ...inp, width: 36, cursor: month >= monthKeyOf() ? 'not-allowed' : 'pointer', opacity: month >= monthKeyOf() ? 0.4 : 1 }}>▶</button>
          </div>}
      />

      {/* ที่มาของตัวเลข — ห้ามให้ดูเหมือนค่าที่วัดได้จริง */}
      <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12.5, color: 'var(--text2)' }}>
        ✍️ <b>เฟส 1 — ตัวเลขมาจากการกรอกมือ</b> ยังไม่ได้ต่อมิเตอร์อัตโนมัติ · ใช้ดูแนวโน้มและเทียบเดือนได้
        แต่ยังไม่ใช่ค่าที่วัดได้แบบ realtime · ค่าที่กรอกจะไปแสดงบนผังรวมโรงงาน (เลือก metric <b>⚡ พลังงาน</b>)
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <Kpi label="หน่วยรวม (kWh)" value={fmtKwh(sumAll.qty)} sub={<>เทียบ {monthLabel(shiftMonth(month, -1))} {deltaChip(dAll)}</>} />
        <Kpi label="ค่าไฟรวม (บาท)" value={fmtBaht(sumAll.cost)} sub={`${sumAll.filled}/${points.length} จุดที่กรอกแล้ว`} />
        <Kpi label="ยอดจากบิลทั้งโรงงาน" value={fmtKwh(plant?.qty)}
          sub={plantPrev?.qty != null ? <>เทียบเดือนก่อน {deltaChip(deltaPct(plant?.qty, plantPrev?.qty))}</> : 'กรอกที่แถว "ทั้งโรงงาน"'} />
        <Kpi label="บาท/หน่วย" value={bahtPerUnit(sumAll.cost, sumAll.qty) ?? '—'} sub="ปกติ 3.5–5 บาท/kWh" />
      </div>

      {gap != null && Math.abs(gap) > 10 && (
        <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12.5 }}>
          ⚠️ ผลรวมรายจุด ({fmtKwh(sumAll.qty)}) ต่างจากยอดบิลทั้งโรงงาน ({fmtKwh(plant.qty)}) อยู่ <b>{gap > 0 ? '+' : ''}{gap}%</b>
          — ปกติผลรวมรายจุดควรน้อยกว่าบิลเล็กน้อย (มีส่วนกลางที่ยังไม่ได้แยก) ถ้าต่างมากแปลว่ายังกรอกไม่ครบหรือกรอกผิดหลัก
        </div>
      )}

      {loading ? <div style={{ color: 'var(--muted)', padding: 20 }}>กำลังโหลด…</div> : tab === 'input' ? (
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead><tr>
              <th style={th}>พื้นที่</th><th style={th}>หน่วย (kWh)</th><th style={th}>ค่าไฟ (บาท)</th>
              <th style={th}>บาท/หน่วย</th><th style={th}>เทียบเดือนก่อน</th><th style={th}>ที่มา</th><th style={th}>หมายเหตุ</th>
            </tr></thead>
            <tbody>
              {/* ทั้งโรงงาน (จากบิล) — แถวแรกเสมอ ใช้เป็นตัวตรวจสอบผลรวม */}
              {[{ kind: 'plant', name: 'PLANT', label: '🏭 ทั้งโรงงาน (จากบิลค่าไฟ)' }, ...points.map(p => ({
                ...p, label: `${p.kind === 'zone' ? '🔧' : '🏭'} ${p.name}`,
              }))].map(p => {
                const k = `${p.kind}::${p.name}`, r = byKey[k], pr = prevByKey[k];
                const d = deltaPct(r?.qty, pr?.qty);
                const rate = bahtPerUnit(r?.cost, r?.qty);
                const rateOdd = rate != null && (rate < RATE_SANE_MIN || rate > RATE_SANE_MAX);
                const sm = sourceMeta(r?.source);
                return (
                  <tr key={k} style={p.kind === 'plant' ? { background: 'var(--bg3)' } : null}>
                    <td style={{ ...td, fontWeight: p.kind === 'plant' ? 800 : 600 }}>{p.label}
                      {p.section && <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}> · {p.section}</span>}</td>
                    <td style={td}><input type="number" defaultValue={r?.qty ?? ''} readOnly={!canEdit} placeholder="—"
                      onBlur={e => { const v = numOrNull(e.target.value); if (v !== (r?.qty ?? null)) saveCell(p, { qty: v }); }}
                      style={{ ...inp, width: 110, ...(canEdit ? null : { background: 'var(--bg2)' }) }} /></td>
                    <td style={td}><input type="number" defaultValue={r?.cost ?? ''} readOnly={!canEdit} placeholder="—"
                      onBlur={e => { const v = numOrNull(e.target.value); if (v !== (r?.cost ?? null)) saveCell(p, { cost: v }); }}
                      style={{ ...inp, width: 110, ...(canEdit ? null : { background: 'var(--bg2)' }) }} /></td>
                    <td style={{ ...td, color: rateOdd ? '#f59e0b' : 'var(--text2)', fontWeight: rateOdd ? 700 : 400 }}
                      title={rateOdd ? 'ผิดปกติ — ปกติ 3.5-5 บาท/kWh ลองตรวจว่ากรอกผิดหลักไหม' : ''}>
                      {rate ?? '—'}{rateOdd ? ' ⚠' : ''}</td>
                    <td style={td}>{deltaChip(d)}</td>
                    <td style={td}>
                      <select value={r?.source || 'manual'} disabled={!canEdit || !r}
                        onChange={e => saveCell(p, { source: e.target.value })}
                        style={{ ...inp, width: 118, color: sm.color }}>
                        <option value="manual">✍️ กรอกมือ</option>
                        <option value="meter">🔌 จากมิเตอร์</option>
                        <option value="estimated">≈ ประมาณการ</option>
                      </select></td>
                    <td style={td}><input defaultValue={r?.note ?? ''} readOnly={!canEdit} placeholder="—"
                      onBlur={e => { const v = e.target.value.trim() || null; if (v !== (r?.note ?? null)) saveCell(p, { note: v }); }}
                      style={{ ...inp, minWidth: 140, ...(canEdit ? null : { background: 'var(--bg2)' }) }} /></td>
                  </tr>);
              })}
            </tbody>
          </table>
          {!canEdit && <div style={{ padding: 10, fontSize: 12, color: 'var(--muted)' }}>🔒 ไม่มีสิทธิ์กรอก — ดูอย่างเดียว</div>}
        </div>
      ) : (
        <div style={{ ...card }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>อันดับผู้ใช้ไฟสูงสุด · {monthLabel(month)}</div>
          {(() => {
            const ranked = points.map(p => ({ p, r: byKey[keyOf(p)], pr: prevByKey[keyOf(p)] }))
              .filter(x => x.r?.qty != null).sort((a, b) => b.r.qty - a.r.qty);
            if (!ranked.length) return <div style={{ color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีข้อมูลเดือนนี้ — ไปกรอกที่แท็บ 📝</div>;
            const max = ranked[0].r.qty || 1;
            return ranked.map(({ p, r, pr }) => {
              const d = deltaPct(r.qty, pr?.qty);
              return (
                <div key={keyOf(p)} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 8, fontSize: 12.5, marginBottom: 3 }}>
                    <span style={{ fontWeight: 700 }}>{p.kind === 'zone' ? '🔧' : '🏭'} {p.name}</span>
                    <span style={{ marginLeft: 'auto', color: 'var(--text2)' }}>{fmtKwh(r.qty)} kWh</span>
                    <span style={{ width: 56, textAlign: 'right' }}>{deltaChip(d)}</span>
                  </div>
                  <div style={{ height: 8, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.round(r.qty / max * 100)}%`, height: '100%', background: d != null && d > 10 ? '#ef4444' : 'var(--accent)' }} />
                  </div>
                </div>);
            });
          })()}
        </div>
      )}
    </div>
  );
}
