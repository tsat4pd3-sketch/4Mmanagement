import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { wavg, wLoad, sumDefectQty } from '../utils/oee';
import { defectUnitCost } from '../utils/costSaving';
import { getDocForm, withDocFoot, loadDocForms, fullCode } from '../utils/docForms';
import { usePerms } from '../utils/usePerms';
import ReadOnlyNote from './ReadOnlyNote';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, ReferenceLine, LabelList, Cell,
} from 'recharts';

/* ═══ 📑 KPI รายเดือน (เฟส 1 · 2026-08-24 — เฟส 2 กรอกมือ + Excel 3 ชีท + drill-down · คำสั่ง user) ═══
   แทน "แพ็คกระดาษรายเดือน" ที่ปริ้นเซ็นกัน (Internal Defect Report ราย section + OEE รายเดือน)
   ซึ่งเป็นหลักฐานเบื้องหลังฟอร์ม KPI Monitoring FM-HRM-6-024

   เฟส 1 — KPI ที่คำนวณอัตโนมัติได้: ยอดผลิต · ของเสีย · PPM · Cost of defect · OEE (เทียบเป้า) · DT นอกแผน
   เฟส 2 (2026-08-24):
   - KPI นอกระบบกรอกมือ (DL/OH/Satisfaction/Safety/HR) — ตาราง kpi_definitions + kpi_manual_entries (Main)
     สิทธิ์กรอก/จัดการ = kpi:manage (RLS ผ่าน has_perm ด้วย) · นิยามผูก (year, section) · section null = ทุกส่วนงาน
   - export Excel 3 ชีทตามโครงไฟล์จริง (Appraisal FM-HRM-6-022 / Monitoring FM-HRM-6-024 / Action FM-HRM-6-025)
     ผ่าน src/lib/kpiExportExcel.js (exceljs dynamic import)
   - drill-down ส่วน → กลุ่มไลน์ (top-level group) — cascade ล้างกลุ่มเมื่อเปลี่ยนส่วน (§5.3)
     ⚠️ KPI กรอกมือผูกกับ "ส่วนงาน" — เลือกกลุ่มไลน์แล้วตัวเลขอัตโนมัติกรองตาม แต่ KPI กรอกมือไม่กรอง (บอกบนจอ)

   กติกาที่ยึด (ห้ามละเมิด):
   - OEE เดือน = wavg(oee ที่ stamp, ถ่วง wLoad = shift_min − plannedMin) — ห้าม mean-of-percentages
   - NG ยึด defect_logs (qty_ng + qty_suspect) แบบ line-mode (ไม่รวมงานทดลอง — มาตรฐานเดียวกับ %Q/FTT/PPM ทุกจอ)
   - PPM = NG ÷ (ยอดผลิต + NG) × 1e6 — ยอดสแกน = ของดีล้วน (ต่างจากสูตรใบเดิม NG÷ยอดผลิต ~0.03% ที่ระดับ PPM ต่ำ
     เทียบใบเก่าได้ต่อเนื่อง — เขียนกำกับสูตรบนจอ/ใบพิมพ์แล้ว)
   - ยอดผลิต = Σ actual_qty ของกะปิดแล้ว "รายชิ้น" (LH/RH แยกชิ้น — ตรงกับใบเดิมที่นับต่อไลน์ต่อชิ้น
     · PPM ต้องหารด้วยชิ้นอยู่แล้ว จึงไม่ใช้ pairAwareTotal ที่นับคู่สำหรับยอดภาพใหญ่)
   - Cost of defect ผ่าน defectUnitCost (standard ชนะ → material) · ตีมูลค่าไม่ได้ = รายงานจำนวน ห้ามเดา
   - นับเฉพาะกะที่ปิดแล้ว — เดือนปัจจุบันติดป้าย "ยังไม่จบ" · กะเปิดค้างไม่ถูกนับ (บอกบนจอ)
   - โหลดครั้งเดียวตอนเปิด/เปลี่ยนปี ไม่ poll (กฎ egress)
   - ตารางกรอกมือยังไม่ apply migration (42P01) = แถบเตือนชัดๆ ห้ามเงียบ (rollback safety)
   - update นิยาม KPI ต้องนับแถวที่เขียนจริง (.select('id')) — กฎ RLS-เงียบ */

const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const DEFAULT_APQ = { a: 90, p: 90, q: 99 }; // ค่ามาตรฐานเมื่อกรุ๊ปยังไม่ตั้ง target (กฎ oee_targets)
const CATS = [
  { key: 'financial', label: '💰 Financial' },
  { key: 'customer', label: '🤝 Customer' },
  { key: 'internal', label: '🏭 Internal Process' },
  { key: 'learning', label: '📚 Learning & Growth' },
];
const catLabel = k => CATS.find(c => c.key === k)?.label || k;

/* ดึงทุกแถวแบบแบ่งหน้า — กับดัก Supabase ตัด 1000 แถว/query */
async function pageAll(buildQuery, onProg) {
  const out = [];
  for (let i = 0; ; i++) {
    const { data, error } = await buildQuery().range(i * 1000, i * 1000 + 999);
    if (error) throw error;
    out.push(...(data || []));
    onProg?.(out.length);
    if (!data || data.length < 1000) return out;
  }
}
const chunk = (arr, n = 120) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

/* ── มินิกราฟ 12 เดือนท้ายแถว (inline SVG — 10+ แถว ลาก Recharts มาทุกแถวไม่คุ้ม · pattern เดียวกับ Spark ของ FactoryMap)
   กติกาที่ตกลงกับ user (2026-08-25 "กราฟแบบไหนเหมาะ"):
   - ปริมาณรายเดือน (ยอดผลิต/ของเสีย/DT/Cost) = แท่ง — ผลรวมของช่วงเวลา เส้นจะชวนตีความว่ามีค่าระหว่างเดือน
   - อัตรา/% เทียบเป้า (OEE/PPM/KPI กรอกมือ) = เส้น + เส้นเป้าประ
   - แกนเดือนต่อเนื่อง ม.ค.–ธ.ค. เสมอ (เดือนไม่มีข้อมูล = เว้น ไม่ข้ามเดือน)
   - เดือนปัจจุบัน "ยังไม่จบ" = โปร่ง/จาง ห้ามดูเหมือนเดือนจบแล้ว
   - สี: มีเป้า+ทิศทาง → เดือนผ่านเป้าเขียว/พลาดแดง · ไม่มีเป้า → สีกลางเดียว */
const missTarget = (v, target, dir) => {
  if (v == null || target == null || !dir) return null;
  return dir === 'up' ? v < target : v > target;
};
function MiniChart({ vals, kind, target, dir, curIdx }) {
  const W = 150, H = 30, PAD = 2, n = 12, step = W / n;
  const nums = vals.filter(v => v != null && Number.isFinite(v));
  if (!nums.length) return <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>·</span>;
  const isBar = kind === 'bar';
  const lo = isBar ? 0 : Math.min(...nums, target ?? Infinity);
  const hi = Math.max(...nums, target ?? -Infinity, isBar ? 1 : -Infinity);
  const span = hi - lo || 1;
  const y = v => H - PAD - ((v - lo) / span) * (H - PAD * 2);
  const colorOf = (v) => { const m = missTarget(v, target, dir); return m == null ? 'var(--accent)' : m ? '#ef4444' : '#22c55e'; };
  const pts = vals.map((v, i) => (v == null ? null : { x: i * step + step / 2, y: y(v), v, i })).filter(Boolean);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }} aria-hidden>
      {target != null && <line x1={0} y1={y(target)} x2={W} y2={y(target)} stroke="#f59e0b" strokeWidth="1" strokeDasharray="4 3" opacity="0.8" />}
      {isBar
        ? pts.map(p => (
          <rect key={p.i} x={p.i * step + 2} y={p.y} width={step - 4} height={Math.max(1.5, H - PAD - p.y)} rx="1.5"
            fill={colorOf(p.v)} fillOpacity={p.i === curIdx ? 0.35 : 0.9}
            stroke={p.i === curIdx ? colorOf(p.v) : 'none'} strokeDasharray={p.i === curIdx ? '2 2' : undefined} strokeWidth="1" />))
        : (<>
          <polyline points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" opacity="0.75" />
          {pts.map(p => <circle key={p.i} cx={p.x} cy={p.y} r={p.i === curIdx ? 2.6 : 2} fill={p.i === curIdx ? 'transparent' : colorOf(p.v)} stroke={colorOf(p.v)} strokeWidth={p.i === curIdx ? 1.2 : 0} />)}
        </>)}
    </svg>
  );
}

/* กราฟใหญ่ (คลิกจากแถว) — Recharts เต็มแกน + เส้นเป้า · ตัวเลขชุดเดียวกับตาราง ห้ามคำนวณใหม่ */
function ChartModal({ c, curIdx, onClose }) {
  const data = TH_M.map((m, i) => ({ m: m.replace('.', ''), v: c.vals[i] != null && Number.isFinite(c.vals[i]) ? +Number(c.vals[i]).toFixed(c.dec ?? 0) : null, i }));
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 14, padding: '16px 18px', width: 'min(860px, 96vw)' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <b style={{ fontSize: 14.5, color: 'var(--text)' }}>📈 {c.title}</b>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 16, cursor: 'pointer' }}>✕</button>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={data} margin={{ top: 22, left: 0, right: 12, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="m" tick={{ fontSize: 12, fill: 'var(--text2)' }} />
            <YAxis tick={{ fontSize: 11.5, fill: 'var(--text2)' }} width={62} domain={c.kind === 'line' ? ['auto', 'auto'] : [0, 'auto']} />
            {c.target != null && (
              <ReferenceLine y={c.target} stroke="#f59e0b" strokeDasharray="6 4"
                label={{ value: `เป้า ${c.dir === 'down' ? '≤' : '≥'} ${Number(c.target).toLocaleString(undefined, { maximumFractionDigits: 1 })}`, position: 'insideTopRight', fill: '#f59e0b', fontSize: 12, fontWeight: 800 }} />
            )}
            {c.kind === 'bar' ? (
              <Bar dataKey="v" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                <LabelList dataKey="v" position="top" formatter={v => (v == null ? '' : Number(v).toLocaleString())} style={{ fontSize: 10.5, fontWeight: 700, fill: 'var(--text2)' }} />
                {data.map(d => {
                  const m = missTarget(d.v, c.target, c.dir);
                  return <Cell key={d.i} fill={m == null ? 'var(--accent)' : m ? '#ef4444' : '#22c55e'} fillOpacity={d.i === curIdx ? 0.4 : 0.9} />;
                })}
              </Bar>
            ) : (
              <Line dataKey="v" type="monotone" stroke="var(--accent)" strokeWidth={2.4} connectNulls
                isAnimationActive={false} dot={{ r: 3.5 }} label={{ position: 'top', fontSize: 10.5, fill: 'var(--text2)' }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
          ตัวเลขชุดเดียวกับตาราง (นับเฉพาะกะปิดแล้ว){curIdx >= 0 ? ` · ${TH_M[curIdx]} ยังไม่จบเดือน (แสดงจาง)` : ''}
          {c.target != null && c.dir ? ` · ${c.dir === 'up' ? 'เขียว = ≥ เป้า' : 'เขียว = ≤ เป้า'} · แดง = พลาดเป้า` : ''}
        </div>
      </div>
    </div>
  );
}

/* ช่องกรอกค่ารายเดือน — local state + commit ตอน blur/Enter (ไม่ยิง DB ทุก keystroke) */
function CellInput({ value, onCommit, disabled }) {
  const [v, setV] = useState(value == null ? '' : String(value));
  useEffect(() => { setV(value == null ? '' : String(value)); }, [value]);
  return (
    <input
      value={v} disabled={disabled}
      onChange={e => setV(e.target.value)}
      onBlur={() => onCommit(v.trim())}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
      style={{ width: 64, padding: '3px 5px', fontSize: 12, textAlign: 'right', borderRadius: 6,
        background: disabled ? 'transparent' : 'var(--bg2)', border: disabled ? '1px solid transparent' : '1px solid var(--border)',
        color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}
    />
  );
}

export default function KpiMonthly({ lines, scopeSet, isMobile }) {
  const nowYear = new Date().getFullYear();
  const { can, role } = usePerms();
  const canManage = can('kpi', 'manage');
  const [year, setYear] = useState(nowYear);
  const [section, setSection] = useState('');
  const [group, setGroup] = useState(''); // drill-down กลุ่มไลน์ (top-level)
  const [orgSections, setOrgSections] = useState(null); // null = ยังโหลด · [] = ผังว่าง → fallback
  const [loading, setLoading] = useState(false);
  const [prog, setProg] = useState('');
  const [err, setErr] = useState(null);
  const [data, setData] = useState(null); // { key, sessions, dtBySession, dtUnpBySession, defects, partCost, targets }
  // ── KPI กรอกมือ (เฟส 2) ──
  const [defs, setDefs] = useState(null);          // null = ยังโหลด
  const [entries, setEntries] = useState({});      // kpi_id -> { month: value }
  const [kpiMissing, setKpiMissing] = useState(false); // ตารางยังไม่ apply migration
  const [editDef, setEditDef] = useState(null);    // null | {} (ใหม่) | def (แก้)

  /* ตัวเลือกส่วนงานยึด org_nodes (kind='section') ตามกฎ — fallback เดาจาก production_lines เมื่อผังว่าง */
  useEffect(() => {
    supabase.from('org_nodes').select('code, name, sort_order').eq('kind', 'section').order('sort_order')
      .then(({ data: d, error }) => setOrgSections(error ? [] : (d || [])));
  }, []);
  const sectionOpts = useMemo(() => {
    const inScopeSecs = new Set(lines.filter(l => !scopeSet || scopeSet.has(l.name)).map(l => l.section).filter(Boolean));
    const fromOrg = (orgSections || []).map(s => s.code || s.name).filter(s => inScopeSecs.has(s));
    return fromOrg.length ? fromOrg : [...inScopeSecs].sort();
  }, [orgSections, lines, scopeSet]);

  /* กลุ่มไลน์บนสุด (parent หรือไลน์เดี่ยว) ในขอบเขต+ส่วนที่เลือก */
  const groupOpts = useMemo(() => {
    let ls = lines.filter(l => !scopeSet || scopeSet.has(l.name));
    if (section) ls = ls.filter(l => (l.section || '') === section);
    return [...new Set(ls.map(l => l.parent_line_name || l.name))].sort();
  }, [lines, scopeSet, section]);
  useEffect(() => { if (group && !groupOpts.includes(group)) setGroup(''); }, [group, groupOpts]);

  /* ไลน์ในขอบเขตที่เลือก (scope ก่อน → section → กลุ่มไลน์ทับ — pattern มาตรฐาน) */
  const targetLineNames = useMemo(() => {
    let ls = lines.filter(l => !scopeSet || scopeSet.has(l.name));
    if (section) ls = ls.filter(l => (l.section || '') === section);
    if (group) ls = ls.filter(l => (l.parent_line_name || l.name) === group);
    return ls.map(l => l.name);
  }, [lines, scopeSet, section, group]);

  const load = useCallback(async () => {
    if (!lines.length) return;
    const key = `${year}|${section}|${group}|${targetLineNames.length}`;
    setLoading(true); setErr(null); setProg('');
    try {
      // 1) กะปิดแล้วทั้งปี (slim)
      const sessions = await pageAll(() => {
        let q = supabaseDR.from('production_sessions')
          .select('id, line_name, work_date, shift_min, oee, actual_qty')
          .eq('status', 'closed').gte('work_date', `${year}-01-01`).lte('work_date', `${year}-12-31`)
          .order('id');
        if (targetLineNames.length) q = q.in('line_name', targetLineNames);
        return q;
      }, n => setProg(`โหลดกะ ${n} แถว...`));

      const ids = sessions.map(s => s.id);
      // 2) Downtime ของกะพวกนั้น (chunk .in 120 ต่อคิว — กฎ URL ยาว) → plannedMin ต่อกะ (ตัวถ่วง wLoad) + นาทีนอกแผน
      const dtPlanned = {}, dtUnplanned = {};
      let dtSeen = 0;
      for (const c of chunk(ids)) {
        const { data: rows, error } = await supabaseDR.from('downtime_logs')
          .select('session_id, duration_min, dr_downtime_types(category)').in('session_id', c);
        if (error) throw error;
        rows.forEach(r => {
          const m = Number(r.duration_min) || 0;
          if (r.dr_downtime_types?.category === 'planned') dtPlanned[r.session_id] = (dtPlanned[r.session_id] || 0) + m;
          else dtUnplanned[r.session_id] = (dtUnplanned[r.session_id] || 0) + m;
        });
        dtSeen += rows.length; setProg(`โหลด Downtime ${dtSeen} แถว...`);
      }
      // 3) ของเสีย (line-mode ต้องรู้ is_trial + excl_from_q + mat สำหรับคิดเงิน)
      const defects = [];
      for (const c of chunk(ids)) {
        const { data: rows, error } = await supabaseDR.from('defect_logs')
          .select('session_id, qty_ng, qty_suspect, is_trial, prod_orders(mat_no), dr_defect_types(excl_from_q)')
          .in('session_id', c);
        if (error) throw error;
        defects.push(...rows);
      }
      // 4) ต้นทุน/ชิ้น + เป้า OEE
      const [{ data: parts, error: e4 }, { data: targets, error: e5 }] = await Promise.all([
        supabaseDR.from('parts_master').select('mat_no, material_cost, standard_cost'),
        supabase.from('oee_targets').select('group_name, target_a, target_p, target_q'),
      ]);
      if (e4) throw e4;
      if (e5) throw e5;
      const partCost = Object.fromEntries((parts || []).map(p => [p.mat_no, p]));
      setData({ key, sessions, dtPlanned, dtUnplanned, defects, partCost, targets: targets || [] });
    } catch (e) {
      setErr(e?.message || 'โหลดข้อมูลไม่สำเร็จ'); setData(null);
    } finally { setLoading(false); setProg(''); }
  }, [lines.length, year, section, group, targetLineNames]);
  useEffect(() => { load(); }, [load]);

  /* ── โหลดนิยาม KPI กรอกมือ + ค่ารายเดือน (tolerant — ยังไม่ apply migration ต้องไม่พังทั้งแท็บ) ── */
  const loadDefs = useCallback(async () => {
    const { data: d, error } = await supabase.from('kpi_definitions').select('*')
      .eq('year', year).eq('is_active', true)
      .order('category').order('seq').order('created_at');
    if (error) {
      setKpiMissing((error.code || '') === '42P01');
      setDefs([]); setEntries({});
      return;
    }
    setKpiMissing(false);
    // section null = ทุกส่วนงาน · เลือกส่วนแล้วเห็น common + ของส่วนนั้น · ไม่เลือก = เห็นทั้งหมด (ติดป้ายส่วน)
    const rows = (d || []).filter(x => !section || !x.section || x.section === section);
    setDefs(rows);
    if (!rows.length) { setEntries({}); return; }
    const map = {};
    for (const c of chunk(rows.map(r => r.id))) {
      const { data: es, error: e2 } = await supabase.from('kpi_manual_entries')
        .select('kpi_id, month, value').in('kpi_id', c);
      if (e2) { toast.error('โหลดค่า KPI กรอกมือไม่สำเร็จ: ' + e2.message); return; }
      (es || []).forEach(e => { (map[e.kpi_id] = map[e.kpi_id] || {})[e.month] = e.value != null ? Number(e.value) : null; });
    }
    setEntries(map);
  }, [year, section]);
  useEffect(() => { loadDefs(); }, [loadDefs]);

  const saveCell = async (kpiId, month, raw) => {
    const value = raw === '' ? null : Number(raw);
    if (raw !== '' && !Number.isFinite(value)) { toast.error('กรอกเป็นตัวเลขเท่านั้น'); return; }
    const prev = entries[kpiId]?.[month] ?? null;
    if (prev === value) return;
    const { error } = await supabase.from('kpi_manual_entries')
      .upsert({ kpi_id: kpiId, month, value }, { onConflict: 'kpi_id,month' });
    if (error) {
      toast.error((error.code === '42501' ? 'ไม่มีสิทธิ์กรอก KPI (ต้องมี kpi:manage) — ' : 'บันทึกไม่สำเร็จ: ') + error.message);
      setEntries(p => ({ ...p })); // trigger sync กลับค่าเดิม
      return;
    }
    setEntries(p => ({ ...p, [kpiId]: { ...(p[kpiId] || {}), [month]: value } }));
  };

  const manualYn = (def, v) => {
    if (v == null || def.target_value == null || !def.direction) return null;
    return def.direction === 'up' ? v >= Number(def.target_value) : v <= Number(def.target_value);
  };
  const manualAvg = def => {
    const vs = Array.from({ length: 12 }, (_, i) => entries[def.id]?.[i + 1]).filter(v => v != null);
    return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null;
  };

  /* เป้า OEE ของขอบเขต = เฉลี่ยของกรุ๊ป (ไลน์บนสุด) ในขอบเขต — กฎ oee_targets: section ไม่เก็บใน DB */
  const targetOee = useMemo(() => {
    if (!data) return null;
    const tops = new Set(lines.filter(l => targetLineNames.includes(l.name)).map(l => l.parent_line_name || l.name));
    const tByGroup = Object.fromEntries(data.targets.map(t => [t.group_name, t]));
    const vals = [...tops].map(g => {
      const t = tByGroup[g] || {};
      const a = Number(t.target_a) || DEFAULT_APQ.a, p = Number(t.target_p) || DEFAULT_APQ.p, q = Number(t.target_q) || DEFAULT_APQ.q;
      return a * p * q / 10000;
    });
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  }, [data, lines, targetLineNames]);

  /* รวมรายเดือน */
  const months = useMemo(() => {
    if (!data) return null;
    const defBySession = {};
    data.defects.forEach(d => (defBySession[d.session_id] = defBySession[d.session_id] || []).push(d));
    const out = Array.from({ length: 12 }, () => ({ produce: 0, ng: 0, cost: 0, costMissQty: 0, dtMin: 0, sess: [], n: 0 }));
    data.sessions.forEach(s => {
      const mi = Number(s.work_date?.slice(5, 7)) - 1;
      if (mi < 0 || mi > 11) return;
      const m = out[mi];
      m.n += 1;
      m.produce += Number(s.actual_qty) || 0;
      m.dtMin += data.dtUnplanned[s.id] || 0;
      m.sess.push({ oee: s.oee != null ? Number(s.oee) : null, shift_min: s.shift_min, plannedMin: data.dtPlanned[s.id] || 0 });
      const defs2 = defBySession[s.id] || [];
      m.ng += sumDefectQty(defs2, 'line');
      defs2.forEach(d => {
        if (d.is_trial || d.dr_defect_types?.excl_from_q) return; // ฐานเดียวกับ PPM (line-mode)
        const qty = (Number(d.qty_ng) || 0) + (Number(d.qty_suspect) || 0);
        if (!qty) return;
        const mat = d.prod_orders?.mat_no || null;
        const { unit } = defectUnitCost(mat ? data.partCost[mat] : null);
        if (unit == null) m.costMissQty += qty;
        else m.cost += qty * unit;
      });
    });
    out.forEach(m => {
      m.oee = m.sess.length ? wavg(m.sess, x => x.oee, wLoad) : null;
      m.ppm = (m.produce + m.ng) > 0 ? (m.ng / (m.produce + m.ng)) * 1e6 : null;
    });
    const allSess = out.flatMap(m => m.sess);
    const tot = {
      produce: out.reduce((s, m) => s + m.produce, 0),
      ng: out.reduce((s, m) => s + m.ng, 0),
      cost: out.reduce((s, m) => s + m.cost, 0),
      costMissQty: out.reduce((s, m) => s + m.costMissQty, 0),
      dtMin: out.reduce((s, m) => s + m.dtMin, 0),
      n: out.reduce((s, m) => s + m.n, 0),
      oee: allSess.length ? wavg(allSess, x => x.oee, wLoad) : null,
    };
    tot.ppm = (tot.produce + tot.ng) > 0 ? (tot.ng / (tot.produce + tot.ng)) * 1e6 : null;
    return { out, tot };
  }, [data]);

  const curMonthIdx = year === nowYear ? new Date().getMonth() : -1;
  const nf = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 }));

  /* แถวของตาราง — เพิ่ม KPI ใหม่ = เพิ่ม entry ตรงนี้
     kind: bar = ปริมาณต่อเดือน · line = อัตรา/% (มินิกราฟ+กราฟใหญ่เลือกทรงตามนี้) */
  const ROWS = useMemo(() => [
    { key: 'produce', label: 'ยอดผลิต (ชิ้น)', get: m => nf(m.produce), val: m => (m.n ? m.produce : null), kind: 'bar' },
    { key: 'ng',      label: 'ของเสีย (ชิ้น · ไม่รวมงานทดลอง)', get: m => nf(m.ng), warnPos: true, val: m => (m.n ? m.ng : null), kind: 'bar' },
    { key: 'ppm',     label: 'Internal defect (PPM)', get: m => nf(m.ppm), warnPos: true, val: m => (m.n ? m.ppm : null), kind: 'line', dec: 0 },
    { key: 'cost',    label: 'Cost of defect (บาท)', get: m => nf(m.cost), warnPos: true, val: m => (m.n ? m.cost : null), kind: 'bar' },
    { key: 'oee',     label: `OEE (%)${targetOee != null ? ` · เป้า ≥ ${targetOee.toFixed(1)}` : ''}`, get: m => nf(m.oee, 1),
      yn: m => (m.oee == null || targetOee == null ? null : m.oee >= targetOee),
      val: m => (m.n ? m.oee : null), kind: 'line', target: targetOee, dir: 'up', dec: 1 },
    { key: 'dt',      label: 'Downtime นอกแผน (นาที)', get: m => nf(m.dtMin), warnPos: true, val: m => (m.n ? m.dtMin : null), kind: 'bar' },
  ], [targetOee]);
  const [chart, setChart] = useState(null); // payload กราฟใหญ่ { title, vals, kind, target, dir, dec }
  const openRowChart = r => setChart({ title: r.label, vals: months.out.map(r.val), kind: r.kind, target: r.target ?? null, dir: r.dir ?? null, dec: r.dec });
  const openDefChart = d2 => setChart({
    title: d2.name + (d2.commitment ? ` (เป้า ${d2.commitment})` : ''), kind: 'line', dec: 2,
    vals: Array.from({ length: 12 }, (_, i) => entries[d2.id]?.[i + 1] ?? null),
    target: d2.target_value != null ? Number(d2.target_value) : null, dir: d2.direction || null,
  });

  const scopeLabel = section
    ? section + (group ? ` › ${group}` : '')
    : (group ? group : 'ทุกส่วนงานในขอบเขต');

  /* พิมพ์ — รายงานภายในห่อ withDocFoot ตามกฎทะเบียนเอกสาร (doc_key: kpi_monthly) */
  const handlePrint = async () => {
    await loadDocForms(); // component ร่วม/lazy chunk ต้องโหลดเอง ห้ามพึ่งหน้าแม่ (กับดัก docFormSync)
    const df = await getDocForm('kpi_monthly', {});
    const th = 'border:1px solid #999;padding:4px 6px;font-size:11px;background:#eee;text-align:center';
    const td = 'border:1px solid #999;padding:4px 6px;font-size:11px;text-align:right';
    const rows = ROWS.map(r => `<tr><td style="${td};text-align:left;font-weight:bold">${r.label}</td>${
      months.out.map((m, i) => `<td style="${td}">${m.n ? r.get(m) : ''}${r.yn && m.n && r.yn(m) != null ? ` <b>${r.yn(m) ? '✓' : '✗'}</b>` : ''}${i === curMonthIdx ? '<div style="font-size:8px;color:#b45309">ยังไม่จบ</div>' : ''}</td>`).join('')
    }<td style="${td};font-weight:bold">${r.get(months.tot)}</td></tr>`).join('');
    const manRows = (defs || []).map(d2 => {
      const cells = Array.from({ length: 12 }, (_, i) => {
        const v = entries[d2.id]?.[i + 1];
        return `<td style="${td}">${v == null ? '' : v.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>`;
      }).join('');
      const avg = manualAvg(d2);
      return `<tr><td style="${td};text-align:left">${d2.name}${d2.section ? ` (${d2.section})` : ''}<div style="font-size:8px;color:#777">${d2.scope_text || ''}</div></td>${cells}<td style="${td};font-weight:bold">${avg == null ? '' : avg.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td></tr>`;
    }).join('');
    const html = `
      <h2 style="margin:0 0 2px">สรุป KPI รายเดือน ${year + 543} — ${scopeLabel}</h2>
      <div style="font-size:11px;color:#555;margin-bottom:8px">
        จากกะที่ปิดแล้ว ${months.tot.n.toLocaleString()} กะ · OEE ถ่วงน้ำหนักเวลารับภาระ ·
        PPM = ของเสีย ÷ (ยอดผลิต + ของเสีย) × 10⁶ (ไม่รวมงานทดลอง) · พิมพ์ ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
      </div>
      <table style="border-collapse:collapse;width:100%">
        <tr><th style="${th};text-align:left">KPI</th>${TH_M.map(m => `<th style="${th}">${m}</th>`).join('')}<th style="${th}">รวม/เฉลี่ย</th></tr>
        ${rows}
        ${manRows ? `<tr><td colspan="14" style="${td};text-align:left;background:#f4f4f4;font-weight:bold">📝 KPI กรอกมือ (นอกระบบ)${group ? ' — ระดับส่วนงาน ไม่กรองตามกลุ่มไลน์' : ''}</td></tr>${manRows}` : ''}
      </table>
      ${months.tot.costMissQty > 0 ? `<div style="font-size:10px;color:#b45309;margin-top:6px">⚠ ของเสีย ${months.tot.costMissQty.toLocaleString()} ชิ้นยังตีมูลค่าไม่ได้ (พาร์ทไม่มีต้นทุน/ชิ้นใน Parts Master) — Cost of defect จึงต่ำกว่าจริง</div>` : ''}
      <table style="margin-top:26px;width:60%"><tr>${(Array.isArray(df?.sig_blocks) && df.sig_blocks.length ? df.sig_blocks : ['Issued', 'Checked', 'Approved']).map(s2 => `<td style="text-align:center;font-size:11px;padding-top:30px;border-top:1px solid #999">${typeof s2 === 'string' ? s2 : s2?.label || ''}</td>`).join('')}</tr></table>`;
    const w = window.open('', '_blank');
    if (!w) { toast.error('เบราว์เซอร์บล็อก popup — อนุญาต popup ก่อนพิมพ์'); return; }
    w.document.write(withDocFoot(html, 'kpi_monthly'));
    w.document.close(); w.focus();
    setTimeout(() => w.print(), 350);
  };

  /* Excel 3 ชีทตามฟอร์มเดิม (FM-HRM-6-022/024/025) */
  const handleExcel = async () => {
    try {
      await loadDocForms();
      const df = await getDocForm('kpi_monthly', {});
      const autoRows = [
        { key: 'produce', name: 'ยอดผลิต (ชิ้น)', formula: 'Σ ยอดผลิตจริงของกะที่ปิดแล้ว', val: m => (m.n ? m.produce : null), sum: months.tot.produce },
        { key: 'ng', name: 'ของเสีย (ชิ้น · ไม่รวมงานทดลอง)', formula: 'Σ defect_logs (qty_ng + qty_suspect)', val: m => (m.n ? m.ng : null), sum: months.tot.ng },
        { key: 'ppm', name: 'Internal defect (PPM)', formula: 'ของเสีย ÷ (ยอดผลิต + ของเสีย) × 10⁶', val: m => (m.n ? m.ppm : null), sum: months.tot.ppm },
        { key: 'cost', name: 'Cost of defect (บาท)', formula: 'Σ ของเสีย × ต้นทุน/ชิ้น (standard → material)', val: m => (m.n ? m.cost : null), sum: months.tot.cost },
        { key: 'oee', name: 'OEE (%)', formula: 'OEE stamp ถ่วงน้ำหนักเวลารับภาระ',
          commitment: targetOee != null ? `≥ ${targetOee.toFixed(1)}%` : '', target: targetOee != null ? `≥ ${targetOee.toFixed(1)}%` : '',
          val: m => (m.n ? m.oee : null), sum: months.tot.oee,
          yn: m => (m.n && m.oee != null && targetOee != null ? m.oee >= targetOee : null),
          ynTotal: months.tot.oee != null && targetOee != null ? months.tot.oee >= targetOee : null },
        { key: 'dt', name: 'Downtime นอกแผน (นาที)', formula: 'Σ downtime นอกแผนของกะที่ปิดแล้ว', val: m => (m.n ? m.dtMin : null), sum: months.tot.dtMin },
      ].map(r => ({
        category: 'internal', name: r.name, formula: r.formula, scope: 'คำนวณอัตโนมัติจาก ESM',
        commitment: r.commitment || '', target: r.target || '',
        monthVals: months.out.map(r.val), summary: r.sum,
        ynVals: r.yn ? months.out.map(r.yn) : null, ynTotal: r.ynTotal ?? null,
        weight: null, actionPlan: '', actionOwner: '', sectionTag: '',
      }));
      const manualRows = (defs || []).map(d2 => {
        const monthVals = Array.from({ length: 12 }, (_, i) => entries[d2.id]?.[i + 1] ?? null);
        const avg = manualAvg(d2);
        return {
          category: d2.category, name: d2.name, formula: d2.formula_text || '', scope: d2.scope_text || '',
          commitment: d2.commitment || '', target: d2.target || '',
          monthVals, summary: avg,
          ynVals: monthVals.map(v => manualYn(d2, v)), ynTotal: manualYn(d2, avg),
          weight: d2.weight, actionPlan: d2.action_plan || '', actionOwner: d2.action_owner || '',
          sectionTag: !section && d2.section ? d2.section : '',
        };
      });
      const { exportKpiExcel } = await import('../lib/kpiExportExcel');
      await exportKpiExcel({
        year, sectionLabel: scopeLabel, rows: [...manualRows, ...autoRows],
        formCode: fullCode(df || {}),
        note: `จากกะที่ปิดแล้ว ${months.tot.n.toLocaleString()} กะ · PPM = ของเสีย ÷ (ยอดผลิต+ของเสีย) × 10⁶ (ไม่รวมงานทดลอง) · export ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}${group ? ` · ตัวเลขอัตโนมัติกรองกลุ่ม ${group} — KPI กรอกมือเป็นระดับส่วนงาน` : ''}`,
      });
    } catch (e) {
      toast.error('export Excel ไม่สำเร็จ: ' + (e?.message || e));
    }
  };

  /* บันทึกนิยาม KPI (insert/update — update ต้องนับแถว กฎ RLS-เงียบ) */
  const saveDef = async form => {
    const payload = {
      year, section: form.section || null, category: form.category || 'internal',
      seq: Number(form.seq) || 0, name: (form.name || '').trim(),
      formula_text: form.formula_text || null, scope_text: form.scope_text || null,
      commitment: form.commitment || null, target: form.target || null,
      target_value: form.target_value === '' || form.target_value == null ? null : Number(form.target_value),
      direction: form.direction || null, weight: form.weight === '' || form.weight == null ? null : Number(form.weight),
      action_plan: form.action_plan || null, action_owner: form.action_owner || null,
    };
    if (!payload.name) { toast.error('กรอกชื่อ KPI ก่อน'); return false; }
    if (payload.target_value != null && !payload.direction) { toast.error('ตั้งค่าเป้าตัวเลขแล้วต้องเลือกทิศทาง (≥/≤) ด้วย ไม่งั้นตัดสิน Y/N ไม่ได้'); return false; }
    if (form.id) {
      const { data: d, error } = await supabase.from('kpi_definitions').update(payload).eq('id', form.id).select('id');
      if (error || !d?.length) { toast.error('บันทึกไม่สำเร็จ' + (error ? ': ' + error.message : ' (ไม่มีสิทธิ์ kpi:manage)')); return false; }
    } else {
      const { error } = await supabase.from('kpi_definitions').insert(payload);
      if (error) { toast.error('เพิ่มไม่สำเร็จ: ' + error.message); return false; }
    }
    toast.success('บันทึก KPI แล้ว');
    loadDefs();
    return true;
  };
  const removeDef = async d2 => {
    if (!window.confirm(`ปิดใช้งาน KPI "${d2.name}"?\nค่าที่กรอกไว้ยังอยู่ (soft delete) เปิดคืนได้จากฐานข้อมูล`)) return;
    const { data: r, error } = await supabase.from('kpi_definitions').update({ is_active: false }).eq('id', d2.id).select('id');
    if (error || !r?.length) { toast.error('ปิดใช้งานไม่สำเร็จ' + (error ? ': ' + error.message : ' (ไม่มีสิทธิ์)')); return; }
    loadDefs();
  };

  const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' };
  const thSt = { padding: '6px 8px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', whiteSpace: 'nowrap', textAlign: 'right', borderBottom: '1px solid var(--border2)' };
  const tdSt = { padding: '6px 8px', fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap', textAlign: 'right', borderBottom: '1px solid var(--border)', fontVariantNumeric: 'tabular-nums' };
  const selSt = w => ({ width: w, padding: '5px 8px', fontSize: 13, borderRadius: 7, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)' });
  const btnSt = { padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>📑 KPI รายเดือน</span>
        {/* width กัน index.css input/select width:100% */}
        <select value={year} onChange={e => setYear(+e.target.value)} style={selSt(110)}>
          {[nowYear, nowYear - 1, nowYear - 2].map(y => <option key={y} value={y}>{y + 543}</option>)}
        </select>
        <select value={section} onChange={e => { setSection(e.target.value); setGroup(''); }} style={selSt(190)}>
          <option value="">ทุกส่วนงานในขอบเขต</option>
          {sectionOpts.map(s2 => <option key={s2} value={s2}>{s2}</option>)}
        </select>
        <select value={group} onChange={e => setGroup(e.target.value)} style={selSt(210)}>
          <option value="">ทุกกลุ่มไลน์{section ? `ใน ${section}` : ''}</option>
          {groupOpts.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        {months && !loading && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={handleExcel} style={btnSt}>⬇️ Excel 3 ชีท</button>
            <button onClick={handlePrint} style={btnSt}>🖨️ พิมพ์ / PDF</button>
          </div>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
        นับเฉพาะ<b>กะที่ปิดแล้ว</b> — กะที่เปิดค้างยังไม่ถูกนับ · OEE = ค่า stamp ถ่วงน้ำหนักเวลารับภาระ ·
        PPM = ของเสีย ÷ (ยอดผลิต + ของเสีย) × 10⁶ ไม่รวมงานทดลอง (ต่างจากสูตรใบเดิม ของเสีย ÷ ยอดผลิต ~0.03% ที่ระดับ PPM ปัจจุบัน) ·
        Excel export ตามโครง 3 ชีทของฟอร์ม FM-HRM-6-022/024/025
      </div>

      {loading && <div style={{ ...card, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>กำลังโหลดข้อมูลทั้งปี... {prog}</div>}
      {err && <div style={{ ...card, borderColor: '#ef4444', color: '#ef4444', fontSize: 13 }}>โหลดไม่สำเร็จ: {err} <button onClick={load} style={{ marginLeft: 8, cursor: 'pointer' }}>ลองใหม่</button></div>}

      {!loading && !err && months && (
        <div style={{ ...card, overflowX: 'auto' }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>
            🤖 KPI คำนวณอัตโนมัติ — {scopeLabel}
          </div>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1060 }}>
            <thead>
              <tr>
                <th style={{ ...thSt, textAlign: 'left' }}>KPI</th>
                {TH_M.map((m, i) => (
                  <th key={m} style={{ ...thSt, color: i === curMonthIdx ? 'var(--accent)' : 'var(--muted)' }}>
                    {m}{i === curMonthIdx && <div style={{ fontSize: 9, fontWeight: 600 }}>ยังไม่จบ</div>}
                  </th>
                ))}
                <th style={{ ...thSt, color: 'var(--text)' }}>รวม/เฉลี่ย</th>
                <th style={{ ...thSt, textAlign: 'center' }}>เทรนด์ (คลิกดูใหญ่)</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(r => (
                <tr key={r.key}>
                  <td style={{ ...tdSt, textAlign: 'left', fontWeight: 700, color: 'var(--text)' }}>{r.label}</td>
                  {months.out.map((m, i) => {
                    const yn = r.yn && m.n ? r.yn(m) : null;
                    return (
                      <td key={i} style={{ ...tdSt, opacity: m.n ? 1 : 0.35 }}>
                        {m.n ? r.get(m) : '·'}
                        {yn != null && <b style={{ marginLeft: 4, color: yn ? '#22c55e' : '#ef4444' }}>{yn ? 'Y' : 'N'}</b>}
                      </td>
                    );
                  })}
                  <td style={{ ...tdSt, fontWeight: 800, color: 'var(--text)' }}>
                    {r.get(months.tot)}
                    {r.yn && months.tot.n ? (() => { const yn = r.yn(months.tot); return yn == null ? null : <b style={{ marginLeft: 4, color: yn ? '#22c55e' : '#ef4444' }}>{yn ? 'Y' : 'N'}</b>; })() : null}
                  </td>
                  <td style={{ ...tdSt, padding: '3px 8px', cursor: 'pointer' }} title="คลิกดูกราฟใหญ่พร้อมเส้นเป้า"
                    onClick={() => openRowChart(r)}>
                    <MiniChart vals={months.out.map(r.val)} kind={r.kind} target={r.target ?? null} dir={r.dir ?? null} curIdx={curMonthIdx} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8 }}>
            จากกะที่ปิดแล้ว {months.tot.n.toLocaleString()} กะ
            {months.tot.costMissQty > 0 && (
              <span style={{ color: '#f59e0b' }}> · ⚠ ของเสีย {months.tot.costMissQty.toLocaleString()} ชิ้นยังตีมูลค่าไม่ได้
                (กรอกต้นทุน/ชิ้นที่ Product Master → 🗂 Parts Master) — Cost of defect ต่ำกว่าจริง</span>
            )}
          </div>
        </div>
      )}

      {/* ═ KPI กรอกมือ (เฟส 2) ═ */}
      {kpiMissing && (
        <div style={{ ...card, borderColor: '#f59e0b', color: '#f59e0b', fontSize: 12.5 }}>
          ⚠ KPI กรอกมือยังใช้ไม่ได้ — ยังไม่ได้ apply migration <code>20260824_kpi_definitions_main.sql</code> (Main) · แจ้ง admin
        </div>
      )}
      {!kpiMissing && defs && (
        <div style={{ ...card, overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)' }}>
              📝 KPI นอกระบบ (กรอกมือ) — DL/OH % · Satisfaction · Safety · HR
            </span>
            {canManage && (
              <button onClick={() => setEditDef({})} style={{ ...btnSt, padding: '4px 10px', fontSize: 12 }}>＋ เพิ่ม KPI</button>
            )}
            {group && (
              <span style={{ fontSize: 11.5, color: '#f59e0b' }}>
                ⚠ KPI กรอกมือผูกกับ "ส่วนงาน" — ไม่กรองตามกลุ่มไลน์ที่เลือก
              </span>
            )}
          </div>
          <ReadOnlyNote show={!canManage} role={role} compact
            what="กรอก/แก้ KPI นอกระบบ" permKey="kpi:manage" />
          {!defs.length ? (
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              ยังไม่มี KPI กรอกมือของปี {year + 543}{section ? ` (ส่วน ${section} + ส่วนกลาง)` : ''}
              {canManage ? ' — กด ＋ เพิ่ม KPI (เช่น DL ≤ 1.452% · Customer Satisfaction ≥ 95%)' : ''}
            </div>
          ) : (
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1160 }}>
              <thead>
                <tr>
                  <th style={{ ...thSt, textAlign: 'left' }}>KPI</th>
                  {TH_M.map(m => <th key={m} style={thSt}>{m}</th>)}
                  <th style={{ ...thSt, color: 'var(--text)' }}>เฉลี่ย</th>
                  <th style={{ ...thSt, textAlign: 'center' }}>เทรนด์</th>
                  {canManage && <th style={thSt} />}
                </tr>
              </thead>
              <tbody>
                {CATS.filter(c => defs.some(d2 => d2.category === c.key)).map(c => (
                  [
                    <tr key={c.key}>
                      <td colSpan={16 + (canManage ? 1 : 0)} style={{ ...tdSt, textAlign: 'left', fontWeight: 800, color: 'var(--text)', background: 'var(--bg2)' }}>{c.label}</td>
                    </tr>,
                    ...defs.filter(d2 => d2.category === c.key).map(d2 => {
                      const avg = manualAvg(d2);
                      const ynT = manualYn(d2, avg);
                      return (
                        <tr key={d2.id}>
                          <td style={{ ...tdSt, textAlign: 'left', whiteSpace: 'normal', minWidth: 190 }}>
                            <b style={{ color: 'var(--text)' }}>{d2.name}</b>
                            {!section && d2.section && <span style={{ marginLeft: 5, fontSize: 10, color: 'var(--muted)' }}>({d2.section})</span>}
                            <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                              {[d2.commitment && `เป้า ${d2.commitment}`, d2.scope_text].filter(Boolean).join(' · ')}
                            </div>
                          </td>
                          {Array.from({ length: 12 }, (_, i) => {
                            const v = entries[d2.id]?.[i + 1] ?? null;
                            const yn = manualYn(d2, v);
                            return (
                              <td key={i} style={{ ...tdSt, padding: '3px 4px' }}>
                                <CellInput value={v} disabled={!canManage} onCommit={raw => saveCell(d2.id, i + 1, raw)} />
                                {yn != null && <b style={{ marginLeft: 2, color: yn ? '#22c55e' : '#ef4444', fontSize: 10 }}>{yn ? 'Y' : 'N'}</b>}
                              </td>
                            );
                          })}
                          <td style={{ ...tdSt, fontWeight: 800, color: 'var(--text)' }}>
                            {avg == null ? '—' : avg.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            {ynT != null && <b style={{ marginLeft: 4, color: ynT ? '#22c55e' : '#ef4444' }}>{ynT ? 'Y' : 'N'}</b>}
                          </td>
                          <td style={{ ...tdSt, padding: '3px 8px', cursor: 'pointer' }} title="คลิกดูกราฟใหญ่พร้อมเส้นเป้า"
                            onClick={() => openDefChart(d2)}>
                            <MiniChart vals={Array.from({ length: 12 }, (_, i) => entries[d2.id]?.[i + 1] ?? null)} kind="line"
                              target={d2.target_value != null ? Number(d2.target_value) : null} dir={d2.direction || null} curIdx={curMonthIdx} />
                          </td>
                          {canManage && (
                            <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>
                              <button onClick={() => setEditDef(d2)} title="แก้นิยาม KPI" style={{ cursor: 'pointer', background: 'none', border: 'none', fontSize: 13 }}>✏️</button>
                              <button onClick={() => removeDef(d2)} title="ปิดใช้งาน" style={{ cursor: 'pointer', background: 'none', border: 'none', fontSize: 13 }}>🗑</button>
                            </td>
                          )}
                        </tr>
                      );
                    }),
                  ]
                ))}
              </tbody>
            </table>
          )}
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            กรอกแล้วบันทึกทันทีตอนออกจากช่อง (Enter/คลิกที่อื่น) · ลบค่า = เว้นว่าง ·
            Y/N ตัดสินจากเป้าตัวเลข + ทิศทาง (≥/≤) ที่ตั้งในนิยาม KPI
          </div>
        </div>
      )}

      {chart && <ChartModal c={chart} curIdx={curMonthIdx} onClose={() => setChart(null)} />}

      {editDef && (
        <DefModal
          init={editDef} year={year} section={section} sectionOpts={sectionOpts}
          onClose={() => setEditDef(null)}
          onSave={async f => { if (await saveDef(f)) setEditDef(null); }}
        />
      )}
    </div>
  );
}

/* ── โมดัลนิยาม KPI (เพิ่ม/แก้) ── */
function DefModal({ init, year, section, sectionOpts, onClose, onSave }) {
  const [f, setF] = useState(() => ({
    id: init.id || null,
    section: init.id ? (init.section || '') : (section || ''),
    category: init.category || 'internal',
    seq: init.seq ?? 0,
    name: init.name || '',
    formula_text: init.formula_text || '',
    scope_text: init.scope_text || '',
    commitment: init.commitment || '',
    target: init.target || '',
    target_value: init.target_value ?? '',
    direction: init.direction || '',
    weight: init.weight ?? '',
    action_plan: init.action_plan || '',
    action_owner: init.action_owner || '',
  }));
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const inp = { width: '100%', padding: '6px 8px', fontSize: 13, borderRadius: 7, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)' };
  const lbl = { fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 14, padding: 18, width: 'min(680px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 12 }}>
          {f.id ? '✏️ แก้นิยาม KPI' : '＋ เพิ่ม KPI กรอกมือ'} — ปี {year + 543}
        </div>
        <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignContent: 'start' }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={lbl}>ชื่อ KPI *</div>
            <input style={inp} value={f.name} onChange={e => set('name', e.target.value)} placeholder="เช่น DL cost ต่อยอดขาย (%)" />
          </div>
          <div>
            <div style={lbl}>หมวด (ตามใบ Appraisal)</div>
            <select style={inp} value={f.category} onChange={e => set('category', e.target.value)}>
              {CATS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <div style={lbl}>ส่วนงาน (ว่าง = ทุกส่วนงาน)</div>
            <select style={inp} value={f.section} onChange={e => set('section', e.target.value)}>
              <option value="">🌐 ทุกส่วนงาน</option>
              {sectionOpts.map(s2 => <option key={s2} value={s2}>{s2}</option>)}
            </select>
          </div>
          <div>
            <div style={lbl}>Commitment (ข้อความ เช่น ≤ 1.452%)</div>
            <input style={inp} value={f.commitment} onChange={e => set('commitment', e.target.value)} />
          </div>
          <div>
            <div style={lbl}>Target (ข้อความ)</div>
            <input style={inp} value={f.target} onChange={e => set('target', e.target.value)} />
          </div>
          <div>
            <div style={lbl}>เป้าตัวเลข (ใช้ตัดสิน Y/N)</div>
            <input style={inp} type="number" step="any" value={f.target_value} onChange={e => set('target_value', e.target.value)} />
          </div>
          <div>
            <div style={lbl}>ทิศทาง</div>
            <select style={inp} value={f.direction} onChange={e => set('direction', e.target.value)}>
              <option value="">— ไม่ตัดสิน Y/N —</option>
              <option value="up">ยิ่งมากยิ่งดี (≥ เป้า = Y)</option>
              <option value="down">ยิ่งน้อยยิ่งดี (≤ เป้า = Y)</option>
            </select>
          </div>
          <div>
            <div style={lbl}>Weight (ใบ Appraisal)</div>
            <input style={inp} type="number" step="any" value={f.weight} onChange={e => set('weight', e.target.value)} />
          </div>
          <div>
            <div style={lbl}>ลำดับในหมวด</div>
            <input style={inp} type="number" value={f.seq} onChange={e => set('seq', e.target.value)} />
          </div>
          <div>
            <div style={lbl}>Formula (คอลัมน์ในชีท Monitoring)</div>
            <input style={inp} value={f.formula_text} onChange={e => set('formula_text', e.target.value)} placeholder="เช่น DL ÷ ยอดขาย × 100" />
          </div>
          <div>
            <div style={lbl}>Scope / ที่มาข้อมูล</div>
            <input style={inp} value={f.scope_text} onChange={e => set('scope_text', e.target.value)} placeholder="เช่น Data from Acc / QSM / HRM" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={lbl}>IMPROVEMENT ACTIVITY (ชีท Action FM-HRM-6-025)</div>
            <textarea style={{ ...inp, minHeight: 54, resize: 'vertical' }} value={f.action_plan} onChange={e => set('action_plan', e.target.value)} />
          </div>
          <div>
            <div style={lbl}>RESPONSIBILITY</div>
            <input style={inp} value={f.action_owner} onChange={e => set('action_owner', e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}>ยกเลิก</button>
          <button onClick={() => onSave(f)} style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#08130a', fontWeight: 800, cursor: 'pointer', fontSize: 13 }}>💾 บันทึก</button>
        </div>
      </div>
    </div>
  );
}
