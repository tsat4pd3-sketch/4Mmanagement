import { fmtAxis } from '../utils/chartAxis';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from 'recharts';
import { supabaseDR } from '../supabaseClient';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import { checkWrite } from '../utils/dbWrite';
import FilterBar from './FilterBar';
import LineSelect from './LineSelect';
import { pairLoadTotal } from '../utils/pairTotals';
import {
  SEED_PATTERNS, DAY_SOURCE_LABEL, monthDayCounts, capacityRow, oeePair,
} from '../utils/capacityPatterns';

/* ─── 📊 Capacity — แท็บใน /production-plan (2026-09-24) ────────────────────────
   user ส่งสไลด์ `Capacity_TSATP.4_update_June_26.pptx` มาพร้อมภาพหน้านี้ แล้วบอกว่า
   *"capacity โรงงานเราดูกันแบบนี้ แต่ในโปรแกรมเราเป็นแบบนี้ คนจะดูไม่เข้าใจ"*
   ⇒ แท็บนี้ = **ภาษาเดียวกับสไลด์** (2 shift · ActWorkload · RworkOEE · Cap OEE Act · Diff OT OEE)
      ส่วนแท็บ 📆 รายเดือน เดิมยังเป็นภาษาของโปรแกรม (กี่กะ/verdict) — **ตั้งใจให้อยู่คู่กัน ห้ามยุบ**

   🔴 ActWorkload ต้องมาจาก **เวลามาตรฐาน (qty × CT)** ไม่ใช่กำลังผลิตจริง (median)
      ถ้าใช้ median ของจริงแล้วหารด้วย OEE อีก = **คิด OEE ซ้ำสองรอบ** (ของจริงรวมความสูญเสียไปแล้ว)
   🔴 ชิ้น ≠ shot — ยุบคู่ RH/LH ด้วย `pairLoadTotal()` ก่อนเสมอ (กฎเหล็ก CLAUDE.md)
   🔴 เพดาน/สูตรอยู่ `src/utils/capacityPatterns.js` (มีเทส 22 เคส) ห้ามคำนวณเองในไฟล์นี้
   🔴 กราฟแกน Y ข้างเดียว — ทุกเส้น/แท่งเป็น "ชั่วโมง" หน่วยเดียวกัน (UI §6.19 ห้าม dual axis)
   ──────────────────────────────────────────────────────────────────────────── */

const card = { background:'var(--card)', border:'1px solid var(--border)', borderRadius:12, padding:14, boxShadow:'var(--shadow-sm)' };
const th   = { padding:'6px 8px', borderBottom:'1px solid var(--border)', fontSize:11, color:'var(--muted)', whiteSpace:'nowrap', textAlign:'right' };
const td   = { padding:'5px 8px', borderBottom:'1px solid var(--border2)', fontSize:12, textAlign:'right', whiteSpace:'nowrap' };
const btn  = (bg, color='#fff') => ({ padding:'6px 12px', borderRadius:8, border:'none', cursor:'pointer', fontSize:12, fontWeight:700, background:bg, color, fontFamily:'var(--font-body)' });
const hr   = (v) => (v == null ? '—' : Math.round(v).toLocaleString());
const monthLabel = (mk) => {
  const [y, m] = mk.split('-');
  return `${['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][Number(m) - 1]} ${String(Number(y) + 543).slice(-2)}`;
};

export default function CapacityBoard({ role, scope, lines, months, calMap, demandByMonth, ctOf, lineOfMat, pairOf, lineOee }) {
  const canEdit = can('production_plan', 'edit', role) || can('master_data', 'manage', role);
  const [patterns, setPatterns] = useState(SEED_PATTERNS);
  const [patErr, setPatErr]     = useState(false);   // โหลดทะเบียนไม่ได้ = ใช้ค่า seed แต่ต้องบอกบนจอ
  const [showReg, setShowReg]   = useState(false);
  const [oeeMode, setOeeMode]   = useState('actual'); // 'actual' | 'target' — ตัวเลขในตารางยึดเส้นไหน
  const [lineName, setLineName] = useState('');
  const [targets, setTargets]   = useState({});      // group_name → แถว oee_targets
  const [draft, setDraft]       = useState({});      // key → { hours_per_day, day_source }
  const [saving, setSaving]     = useState(false);

  const load = useCallback(async () => {
    const [pat, tg] = await Promise.all([
      supabaseDR.from('capacity_shift_patterns')
        .select('key, label, hours_per_day, day_source, sort_order, color, is_active, note')
        .eq('is_active', true).order('sort_order'),
      supabaseDR.from('oee_targets').select('group_name, target_a, target_p, target_q'),
    ]);
    // ทะเบียนยังไม่ได้ apply / โหลดไม่ได้ → ถอยไปใช้ค่า seed (จอไม่พัง) **แต่ต้องขึ้นจอบอก ห้ามเงียบ**
    if (pat.error || !pat.data?.length) { setPatterns(SEED_PATTERNS); setPatErr(true); }
    else { setPatterns(pat.data); setPatErr(false); }
    setTargets(Object.fromEntries((tg.data || []).map(r => [r.group_name, r])));
  }, []);
  useEffect(() => { load(); }, [load]);

  // ไลน์ที่มีความต้องการจริงในช่วงนี้ — ไม่มี forecast = ไม่มีอะไรให้ดู
  const linesWithDemand = useMemo(() => {
    const has = new Set();
    Object.values(demandByMonth || {}).forEach(matQty => {
      Object.entries(matQty).forEach(([mat, q]) => { if (q > 0) has.add(lineOfMat(mat)); });
    });
    return (lines || []).filter(l => has.has(l.name));
  }, [lines, demandByMonth, lineOfMat]);

  const activeLine = useMemo(
    () => linesWithDemand.find(l => l.name === lineName) || linesWithDemand[0] || null,
    [linesWithDemand, lineName]);

  /* OEE 2 เส้น — จริง (median 60 วัน) กับเป้า (A×P×Q) · คำสั่ง user: "โชว์ทั้งสองเส้นให้เทียบ"
     เป้าอ่านจากกรุ๊ปของไลน์ (ไลน์แม่) ก่อน แล้วค่อยชื่อไลน์ตัวเอง */
  const oee = useMemo(() => {
    if (!activeLine) return { actual: null, target: null, hasActual: false };
    const tg = targets[activeLine.name] || targets[activeLine.parent_line_name] || null;
    return oeePair(lineOee?.[activeLine.name], tg);
  }, [activeLine, targets, lineOee]);
  const usedOee = oeeMode === 'target' ? oee.target : oee.actual;

  /* ── 12 เดือนข้างหน้า ── */
  const rows = useMemo(() => {
    if (!activeLine) return [];
    return (months || []).map(mk => {
      const matQty = demandByMonth?.[mk] || {};
      const loadByMat = {};     // ชั่วโมงมาตรฐานต่อ mat — ยุบคู่ทีหลัง บวกทันทีคือนับ 2 เท่า
      let pcs = 0, noCt = 0;
      Object.entries(matQty).forEach(([mat, qty]) => {
        if (lineOfMat(mat) !== activeLine.name || !(qty > 0)) return;
        pcs += qty;
        const ct = ctOf(mat);
        if (ct > 0) loadByMat[mat] = (loadByMat[mat] || 0) + (qty * ct) / 3600;
        else noCt += qty;      // ไม่มี CT = คิดภาระไม่ได้ ห้ามเงียบ
      });
      const workloadHr = pairLoadTotal(loadByMat, pairOf);
      const dayCounts = monthDayCounts(mk, calMap);
      return { mk, pcs, noCt, dayCounts, ...capacityRow({ workloadHr, oee: usedOee, patterns, dayCounts }) };
    });
  }, [activeLine, months, demandByMonth, calMap, ctOf, lineOfMat, pairOf, patterns, usedOee]);

  const chartData = useMemo(() => rows.map(r => ({
    name: monthLabel(r.mk),
    ActWorkload: Math.round(r.workloadHr),
    RworkOEE: r.rworkOee == null ? null : Math.round(r.rworkOee),
  })), [rows]);

  // เส้นเพดานวาดจากเดือนแรกที่มีข้อมูล (สไลด์ก็วาดเส้นระดับเดียวทั้งกราฟ)
  const refLines = useMemo(() => (rows[0]?.ceilings || []), [rows]);

  const saveReg = async () => {
    const dirty = Object.entries(draft);
    if (!dirty.length) { toast.info('ยังไม่ได้แก้อะไร'); return; }
    setSaving(true);
    let ok = true;
    for (const [key, patch] of dirty) {
      if (!ok) break;
      const hours = parseFloat(patch.hours_per_day);
      if (!(hours > 0 && hours <= 24)) { toast.error(`${key}: ชั่วโมง/วัน ต้องอยู่ระหว่าง 0–24`); ok = false; break; }
      // RLS ปฏิเสธ UPDATE = "สำเร็จ 0 แถว ไม่มี error" ⇒ ต้อง .select() แล้วนับแถว
      const res = await supabaseDR.from('capacity_shift_patterns')
        .update({ hours_per_day: hours, day_source: patch.day_source, updated_at: new Date().toISOString() })
        .eq('key', key).select('key');
      ok = checkWrite(res, 'บันทึกรูปแบบกะ');
      if (ok && !res.data?.length) { toast.error(`${key}: บันทึกไม่สำเร็จ (0 แถว) — ตรวจสิทธิ์`); ok = false; }
    }
    setSaving(false);
    if (ok) { toast.success('✅ บันทึกทะเบียนรูปแบบกะแล้ว'); setDraft({}); load(); }
  };

  if (!linesWithDemand.length) {
    return <div style={{ ...card, color:'var(--muted)', fontSize:13 }}>ยังไม่มี forecast ของไลน์ใน scope — แท็บนี้คิดเพดานจากความต้องการรายเดือน</div>;
  }

  return (
    <div style={{ display:'grid', gap:14, alignContent:'start' }}>

      <FilterBar>
        <LineSelect lines={linesWithDemand} value={activeLine?.name || ''} onChange={setLineName} {...scope} placeholder={null} />
        <select value={oeeMode} onChange={e => setOeeMode(e.target.value)}>
          <option value="actual">OEE จริง (median 60 วัน)</option>
          <option value="target">OEE เป้า (A×P×Q)</option>
        </select>
        <span className="spacer" />
        <button style={btn('var(--bg3)', 'var(--text)')} onClick={() => setShowReg(v => !v)}>
          {showReg ? '▲ ปิดทะเบียนรูปแบบกะ' : '⚙️ ทะเบียนรูปแบบกะ'}
        </button>
      </FilterBar>

      {/* ── OEE 2 เส้น เทียบกันเสมอ ─────────────────────────────────────── */}
      <div style={{ ...card, display:'flex', flexWrap:'wrap', gap:18, alignItems:'center' }}>
        <div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>OEE จริง (median 60 วัน)</div>
          <div style={{ fontSize:20, fontWeight:800, color: oee.hasActual ? '#22c55e' : 'var(--muted)' }}>
            {oee.hasActual ? `${(oee.actual * 100).toFixed(1)}%` : 'ยังไม่มีประวัติ'}
          </div>
        </div>
        <div style={{ fontSize:18, color:'var(--muted)' }}>vs</div>
        <div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>OEE เป้า (A×P×Q)</div>
          <div style={{ fontSize:20, fontWeight:800, color:'#f59e0b' }}>{(oee.target * 100).toFixed(1)}%</div>
        </div>
        {oee.hasActual && (
          <div style={{ fontSize:12, color: oee.actual >= oee.target ? '#22c55e' : '#ef4444', fontWeight:700 }}>
            {oee.actual >= oee.target ? '▲ ถึงเป้า' : `▼ ต่ำกว่าเป้า ${((oee.target - oee.actual) * 100).toFixed(1)} จุด`}
          </div>
        )}
        <div style={{ fontSize:11, color:'var(--muted)', marginLeft:'auto', maxWidth:340, lineHeight:1.6 }}>
          ตัวเลขในตาราง/กราฟด้านล่างคิดจาก <b>{oeeMode === 'target' ? 'OEE เป้า' : 'OEE จริง'}</b> — สลับได้ที่แถบบน
          {!oee.hasActual && oeeMode === 'actual' && (
            <div style={{ color:'#f59e0b' }}>⚠️ ไลน์นี้ยังไม่มีประวัติ OEE — ช่องที่ต้องใช้ OEE จะว่าง สลับไปโหมดเป้าเพื่อดูภาพได้</div>
          )}
        </div>
      </div>

      {/* ── ⚙️ ทะเบียนรูปแบบกะ (แก้ได้เอง ไม่ต้องแก้โค้ด) ───────────────── */}
      {showReg && (
        <div style={card}>
          <div style={{ fontSize:14, fontWeight:800, marginBottom:4 }}>⚙️ ทะเบียนรูปแบบกะ — เพดานกำลังผลิต</div>
          <div style={{ fontSize:11, color:'var(--muted)', lineHeight:1.65, marginBottom:10 }}>
            ค่าเริ่มต้นถอดจากสไลด์ <b>Capacity_TSATP.4_update_June_26</b> — ทุกไลน์ในสไลด์ใช้ <b>2 shift = วันทำงาน × 15.5 ชม.</b> ⇒ 1 กะ = 7.75 ชม. (465 นาที)
            <br />
            ⚠️ ตัวเลขนี้ <b>ตั้งใจให้ต่าง</b> จาก 490 นาที/กะ ที่แท็บรายวันใช้ (08:00–17:30 หักพัก 80 นาที) —
            490 = เวลาเดินเครื่องได้ · 465 = เวลาที่ฝ่ายวางแผนใช้คิดเพดานรายเดือน
            <br />
            🔴 เพดานต่างกันที่ <b>จำนวนวัน</b> ด้วย ไม่ใช่แค่ชั่วโมง/วัน (“+ ทำเสาร์” เอาเสาร์มานับเพิ่ม · “Max” = ทุกวันในเดือน)
          </div>
          {patErr && (
            <div style={{ fontSize:12, color:'#f59e0b', marginBottom:8 }}>
              ⚠️ อ่านทะเบียนจากฐานไม่ได้ — กำลังใช้ค่าเริ่มต้นในโค้ด (แก้แล้วจะบันทึกไม่ได้ · แจ้ง admin ว่ายังไม่ได้ apply migration 20260924_capacity_shift_patterns)
            </div>
          )}
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', minWidth:620 }}>
              <thead><tr>
                <th style={{ ...th, textAlign:'left' }}>รูปแบบกะ</th>
                <th style={th}>ชั่วโมง/วัน</th>
                <th style={{ ...th, textAlign:'left' }}>นับวันจาก</th>
                <th style={th}>เพดานเดือนนี้ (ชม.)</th>
                <th style={{ ...th, textAlign:'left' }}>หมายเหตุ</th>
              </tr></thead>
              <tbody>
                {patterns.map(p => {
                  const d = draft[p.key] || {};
                  const cur = { ...p, ...d };
                  return (
                    <tr key={p.key}>
                      <td style={{ ...td, textAlign:'left', fontWeight:700 }}>
                        <span style={{ display:'inline-block', width:10, height:10, borderRadius:3, background:p.color || 'var(--muted)', marginRight:6 }} />
                        {p.label}
                      </td>
                      <td style={td}>
                        {canEdit && !patErr ? (
                          <input type="number" step="0.25" min="0.25" max="24" style={{ width: 92 }}
                            value={cur.hours_per_day}
                            onChange={e => setDraft(x => ({ ...x, [p.key]: { ...cur, hours_per_day: e.target.value } }))} />
                        ) : Number(p.hours_per_day)}
                      </td>
                      <td style={{ ...td, textAlign:'left' }}>
                        {canEdit && !patErr ? (
                          <select value={cur.day_source}
                            onChange={e => setDraft(x => ({ ...x, [p.key]: { ...cur, day_source: e.target.value } }))}>
                            {Object.entries(DAY_SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        ) : DAY_SOURCE_LABEL[p.day_source]}
                      </td>
                      <td style={{ ...td, fontWeight:700 }}>{hr(rows[0]?.ceilings.find(c => c.key === p.key)?.hours)}</td>
                      <td style={{ ...td, textAlign:'left', color:'var(--muted)', fontSize:11, whiteSpace:'normal' }}>{p.note || ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canEdit && !patErr && (
            <button style={{ ...btn('var(--accent)'), marginTop:10, opacity: saving || !Object.keys(draft).length ? 0.5 : 1 }}
              disabled={saving || !Object.keys(draft).length} onClick={saveReg}>
              {saving ? 'กำลังบันทึก…' : `💾 บันทึก (${Object.keys(draft).length})`}
            </button>
          )}
        </div>
      )}

      {/* ── กราฟ: แท่งภาระงาน + เส้นเพดานแต่ละรูปแบบกะ (หน่วยเดียวกันหมด = ชม.) ── */}
      <div style={card}>
        <div style={{ fontSize:14, fontWeight:800 }}>📊 ภาระงาน vs เพดานกำลังผลิต — {activeLine?.name}</div>
        <div style={{ fontSize:11, color:'var(--muted)', marginBottom:8 }}>
          หน่วย = ชั่วโมง · <b>ActWorkload</b> = เวลามาตรฐานที่ต้องใช้ (จำนวนชิ้น × CT) ·
          <b> RworkOEE</b> = เวลาจริงที่ต้องใช้เมื่อคิด OEE ({usedOee ? `${(usedOee * 100).toFixed(1)}%` : '—'}) ·
          เส้นแนวนอน = เพดานของแต่ละรูปแบบกะ
        </div>
        <div style={{ width:'100%', height:340 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top:8, right:16, left:0, bottom:4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" />
              <XAxis dataKey="name" tick={{ fontSize:11, fill:'var(--muted)' }} />
              <YAxis tickFormatter={fmtAxis} width="auto" tick={{ fontSize:11, fill:'var(--muted)' }} label={{ value:'ชม.', angle:-90, position:'insideLeft', fontSize:11, fill:'var(--muted)' }} />
              <Tooltip formatter={(v) => `${Number(v).toLocaleString()} ชม.`}
                contentStyle={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:8, fontSize:12 }} />
              <Legend wrapperStyle={{ fontSize:11 }} />
              {refLines.map(p => (
                <ReferenceLine key={p.key} y={p.hours} stroke={p.color || 'var(--muted)'} strokeDasharray="4 4"
                  label={{ value: p.label, position:'right', fontSize:10, fill:p.color || 'var(--muted)' }} />
              ))}
              <Bar dataKey="ActWorkload" name="ภาระงาน (ActWorkload)" fill="#3b82f6" />
              <Bar dataKey="RworkOEE"    name="ต้องใช้จริงเมื่อคิด OEE (RworkOEE)" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── ตาราง 12 เดือน — ศัพท์ตรงกับสไลด์ ────────────────────────────── */}
      <div style={card}>
        <div style={{ fontSize:14, fontWeight:800, marginBottom:8 }}>📅 12 เดือนข้างหน้า</div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', minWidth:860 }}>
            <thead><tr>
              <th style={{ ...th, textAlign:'left' }}>เดือน</th>
              <th style={th}>วันทำงาน</th>
              <th style={th}>จำนวนชิ้น</th>
              <th style={th}>2 shift<div style={{ fontWeight:400, fontSize:10 }}>เพดาน (ชม.)</div></th>
              <th style={th}>ActWorkload<div style={{ fontWeight:400, fontSize:10 }}>ภาระงาน (ชม.)</div></th>
              <th style={th}>RworkOEE<div style={{ fontWeight:400, fontSize:10 }}>ต้องใช้จริง (ชม.)</div></th>
              <th style={th}>Cap OEE Act<div style={{ fontWeight:400, fontSize:10 }}>เพดาน×OEE</div></th>
              <th style={th}>Diff OT OEE<div style={{ fontWeight:400, fontSize:10 }}>เหลือ/ขาด</div></th>
              <th style={{ ...th, textAlign:'left' }}>ต้องเปิดกะแบบไหน</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.mk}>
                  <td style={{ ...td, textAlign:'left', fontWeight:700 }}>{monthLabel(r.mk)}</td>
                  <td style={{ ...td, color:'var(--muted)' }}>{r.dayCounts.working}</td>
                  <td style={td}>
                    {r.pcs.toLocaleString()}
                    {r.noCt > 0 && (
                      <div style={{ fontSize:10, color:'#f59e0b' }} title="พาร์ทที่ยังไม่มี CT — คิดภาระงานไม่ได้">
                        ⚠️ {r.noCt.toLocaleString()} ชิ้นไม่มี CT
                      </div>
                    )}
                  </td>
                  <td style={td}>{hr(r.baseHours)}</td>
                  <td style={{ ...td, fontWeight:700 }}>{hr(r.workloadHr)}</td>
                  <td style={td}>{hr(r.rworkOee)}</td>
                  <td style={td}>{hr(r.capOeeAct)}</td>
                  <td style={{ ...td, fontWeight:800, color: r.diffOtOee == null ? 'var(--muted)' : r.diffOtOee >= 0 ? '#22c55e' : '#ef4444' }}>
                    {r.diffOtOee == null ? '—' : `${r.diffOtOee >= 0 ? '+' : ''}${hr(r.diffOtOee)}`}
                  </td>
                  <td style={{ ...td, textAlign:'left' }}>
                    {!r.workloadHr ? <span style={{ color:'var(--muted)' }}>—</span>
                      : !r.fitPattern ? <span style={{ color:'#ef4444', fontWeight:800 }}>🚨 เกินทุกรูปแบบ — ต้องเพิ่มไลน์/คน</span>
                      : <span style={{ color:r.fitPattern.color, fontWeight:800 }}>{r.fitPattern.label}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize:11, color:'var(--muted)', marginTop:8, lineHeight:1.7 }}>
          🔴 <b>ActWorkload คิดจากเวลามาตรฐาน (ชิ้น × CT)</b> ไม่ใช่กำลังผลิตจริง — ถ้าใช้ของจริงแล้วหารด้วย OEE อีก จะคิด OEE ซ้ำสองรอบ
          <br />
          🔴 งานคู่ RH/LH ถูกยุบเป็น shot เดียวแล้ว (ปั๊มทีเดียวได้ 2 ชิ้น — บวกทั้งสองข้าง = ภาระ 2 เท่า)
        </div>
      </div>
    </div>
  );
}
