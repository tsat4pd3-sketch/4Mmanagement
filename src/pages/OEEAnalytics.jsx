import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import {
  LineChart, Line, BarChart, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine, LabelList,
} from 'recharts';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { can } from '../utils/permissions';
import { toast } from '../components/Toast';
import useIsMobile from '../utils/useIsMobile';
import OeeInsightPanel from '../components/OeeInsightPanel';
import ParetoAbcChart from '../components/ParetoAbcChart';
import { pairAwareTotal } from '../utils/pairTotals';
import { lazy, Suspense } from 'react';

const MonthlyReviewExport = lazy(() => import('../components/MonthlyReviewExport'));

// ── Colour helpers ───────────────────────────────────────────────
const oeeColor  = v => v >= 80 ? '#22c55e' : v >= 60 ? '#f59e0b' : '#ef4444';
const aColor    = v => v >= 90 ? '#22c55e' : v >= 75 ? '#f59e0b' : '#ef4444';
const pColor    = v => v >= 85 ? '#22c55e' : v >= 70 ? '#f59e0b' : '#ef4444';
const qColor    = v => v >= 99 ? '#22c55e' : v >= 95 ? '#f59e0b' : '#ef4444';


// เป้าหมายมาตรฐาน (fallback) — ใช้เมื่อกรุ๊ปใน scope ยังไม่ถูกตั้ง target ในตาราง oee_targets
// ตั้งได้เฉพาะ A/P/Q — เป้า OEE ไม่ตั้งเอง คำนวณจาก A×P×Q เสมอ (คำสั่ง user 2026-07-13)
// target จริงตั้งรายกรุ๊ปจากปุ่ม 🎯 · ระดับ section = ค่าเฉลี่ยของกรุ๊ปใน section (ไม่เก็บใน DB)
const TARGET = { a: 90, p: 90, q: 99 };
TARGET.oee = Math.round(TARGET.a * TARGET.p * TARGET.q / 10000 * 10) / 10; // 80.2
const METRIC_COLOR = { a: '#22c55e', p: '#f59e0b', q: '#a78bfa' };
const METRIC_LABEL = { a: 'AVAILABILITY (A)', p: 'PERFORMANCE (P)', q: 'QUALITY (Q)' };
const METRIC_COLOR_FN = { a: aColor, p: pColor, q: qColor };

// ── OEE calculation helpers ──────────────────────────────────────
// หมายเหตุ: A/P/Q/OEE คำนวณและบันทึกไว้แล้วใน production_sessions (oee_a/oee_p/oee_q/oee)
// ตอนปิดกะจาก DailyReport.jsx ซึ่งคิดรวม break_policies และ CT ต่อ MAT.NO อย่างถูกต้องแล้ว
// ห้ามคำนวณซ้ำด้วยสูตรอย่างง่ายที่นี่ เพราะจะได้ตัวเลขคนละชุดกับหน้า Daily Report
function calcOEE(sessions, downtimes, defects) {
  const results = [];
  for (const s of sessions) {
    const sessionDT = downtimes.filter(d => d.session_id === s.id);
    const sessionDefects = defects.filter(d => d.session_id === s.id);

    const plannedMin   = sessionDT.filter(d => d.dr_downtime_types?.category === 'planned').reduce((a, d) => a + (d.duration_min || 0), 0);
    const unplannedMin = sessionDT.filter(d => d.dr_downtime_types?.category !== 'planned').reduce((a, d) => a + (d.duration_min || 0), 0);

    const ngQty = sessionDefects.reduce((a, d) => a + (d.qty_ng || 0), 0) + (s.qty_ng || 0);
    const totalQty = s.actual_qty || 0;
    const okQty = s.qty_ok || totalQty; // การ์ดที่สแกน = ของดีล้วน → fallback ยอดดี = ยอดผลิต (ไม่หัก NG ซ้ำ)

    results.push({
      ...s,
      calcA: s.oee_a != null ? +Number(s.oee_a).toFixed(1) : null,
      calcP: s.oee_p != null ? +Number(s.oee_p).toFixed(1) : null,
      calcQ: s.oee_q != null ? +Number(s.oee_q).toFixed(1) : null,
      calcOEE: s.oee  != null ? +Number(s.oee).toFixed(1)  : null,
      unplannedMin: +unplannedMin.toFixed(1),
      plannedMin:   +plannedMin.toFixed(1),
      dtBreakdown: sessionDT,
      defectBreakdown: sessionDefects,
      ngQty, okQty, totalQty,
    });
  }
  return results;
}

/* ── OOE / TEEP — ต่างจาก OEE ที่ "ฐานเวลา" อย่างเดียว (2026-08-04 · คำสั่ง user) ────────────
   OEE  = ฐาน "เวลารับภาระ" (เวลากะ − พักนโยบาย − หยุดตามแผน)  → ตอนที่ตั้งใจเดิน เดินดีแค่ไหน
   OOE  = ฐาน "เวลากะทั้งหมด" (รวมพัก + หยุดตามแผน)            → เวลาที่โรงงานเปิด ใช้คุ้มแค่ไหน
   TEEP = ฐาน "เวลาปฏิทิน 24 ชม./วัน"                          → กำลังผลิตที่มีทั้งหมด ใช้ไปกี่ %
   ค่าจะเรียง TEEP ≤ OOE ≤ OEE เสมอ (ฐานใหญ่ขึ้น เลขเล็กลง)
   คิดจาก OEE ที่ stamp ไว้แล้วคูณสัดส่วนฐาน — ไม่คำนวณ A/P/Q ใหม่ (กันได้ตัวเลขคนละชุดกับ Daily Report) */
const SHIFT_START_MIN = { day: 8 * 60, night: 20 * 60 };
// เวลาพักตามนโยบายบริษัทที่ตกอยู่ในกรอบกะนั้น (นาที) — นับเฉพาะช่วงที่ทับกับกะจริง
function policyBreakMin(shift, shiftMin, policies) {
  const startMin = SHIFT_START_MIN[shift] ?? SHIFT_START_MIN.day;
  const endMin = startMin + (Number(shiftMin) || 0);
  let total = 0;
  for (const p of policies || []) {
    if (!(p.shift === 'both' || p.shift === shift)) continue;
    if (p.process_type && p.process_type !== 'common') continue; // นโยบายเฉพาะ process — ข้าม (ไม่รู้ process ของกะที่นี่)
    const [h, m] = String(p.start_time || '00:00').split(':').map(Number);
    let bs = h * 60 + m;
    if (bs < startMin) bs += 1440;                                // พักหลังเที่ยงคืน (กะดึกข้ามวัน)
    const ov = Math.min(bs + (Number(p.duration_min) || 0), endMin) - Math.max(bs, startMin);
    if (ov > 0) total += ov;
  }
  return total;
}

// ── ค่าเฉลี่ยถ่วงน้ำหนักตามตำรา OEE ───────────────────────────────
// A/OEE ถ่วงด้วย "เวลารับภาระ" (loading time = shift − planned DT) · P ถ่วงด้วย "เวลาเดินเครื่อง"
// (loading × A) · Q ถ่วงด้วย "จำนวนที่ผลิต" (ดี + เสีย) — กะเล็กไม่ถ่วงเท่ากะใหญ่ (เดิมเฉลี่ยธรรมดา
// mean-of-percentages ทำให้กะผลิต 10 ชิ้นครึ่งชม.มีน้ำหนักเท่ากะทั้งวัน · แก้ 2026-08-02)
// รับ field ได้ทั้งแบบเต็ม (calcA/plannedMin/totalQty จาก calcOEE) และแบบ history (oee_a/actual_qty/qty_ng)
const wLoad = it => Math.max(0, (Number(it.shift_min) || 0) - (Number(it.plannedMin) || 0));
const wRun  = it => wLoad(it) * (((it.calcA != null ? it.calcA : (it.oee_a != null ? +it.oee_a : 100))) / 100);
const wProd = it => (Number(it.totalQty != null ? it.totalQty : it.actual_qty) || 0) + (Number(it.ngQty != null ? it.ngQty : it.qty_ng) || 0);
// ถ่วงน้ำหนัก + fallback เป็นเฉลี่ยธรรมดาเมื่อไม่มีน้ำหนัก (กันหารศูนย์ — เช่นกะไม่มี shift_min/ผลผลิต)
function wavg(items, valFn, wFn) {
  let sw = 0, swv = 0, n = 0, sum = 0;
  for (const it of items) {
    const v = valFn(it);
    if (v == null) continue;
    n++; sum += v;
    const w = wFn(it);
    if (w > 0) { sw += w; swv += v * w; }
  }
  if (!n) return null;
  return +((sw > 0 ? swv / sw : sum / n)).toFixed(1);
}

// ── Date helpers ─────────────────────────────────────────────────
// ⚠️ ห้ามใช้ toISOString() เพื่อคำนวณวันที่ local — จะเพี้ยนข้ามวันเพราะ UTC offset (ดู CLAUDE.md)
const fmtMonthKey = d => d.slice(0, 7);          // YYYY-MM
const fmtYearKey  = d => d.slice(0, 4);          // YYYY
const thMonths = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const fmtMonthLabel = k => { const [y, m] = k.split('-'); return `${thMonths[+m - 1]} ${(+y + 543).toString().slice(-2)}`; };
const fmtDayLabel   = d => { const [,m,dd] = d.split('-'); return `${+dd}/${+m}`; };
const fmtThaiDate   = d => { if (!d) return '—'; const [y,m,dd] = d.split('-').map(Number); return `${dd} ${thMonths[m-1]} ${y+543}`; };

function getWorkDateStr(date = new Date()) {
  const h = date.getHours();
  const d = new Date(date);
  if (h < 8) d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function dateStrAdd(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// ── KPI Card ─────────────────────────────────────────────────────
const KpiCard = ({ label, value, color, sub }) => (
  <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px', minWidth: 110, flex: 1 }}>
    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 28, fontWeight: 900, color: color || 'var(--text)', lineHeight: 1 }}>{value ?? '—'}{value != null ? '%' : ''}</div>
    {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
  </div>
);

// ── Custom tooltip ───────────────────────────────────────────────
const OEETooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color }}>{p.name}: {p.value?.toFixed(1)}%</div>
      ))}
    </div>
  );
};

// ── Gauge ring (SVG, no deps) ─────────────────────────────────────
function GaugeRing({ value, size = 168, stroke = 15, color = '#22c55e' }) {
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

// ── Mini sparkline bar (under A/P/Q kpi) ──────────────────────────
// Tooltip ย่อของ sparkline — แตะ/ชี้แท่งเพื่อดูวัน + ค่าจริง (จอทัชแตะได้)
function MiniTrendTip({ active, payload, label, dataKey, metric }) {
  if (!active || !payload?.length) return null;
  const v = payload.find(p => p.dataKey === dataKey)?.value;
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 11, boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
      <div style={{ color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontWeight: 800 }}>{metric} {v != null ? `${v}%` : 'ไม่มีข้อมูล'}</div>
    </div>
  );
}

// Sparkline เทรนด์ 10 วันล่าสุดต่อ metric (A/P/Q) — มี caption + แกนวัน + tooltip ให้อ่านออกโดยไม่ต้องเดา
// (กฎ UI-CONVENTIONS §กราฟแท่งรายวัน: ต้องมี caption อธิบายความหมาย + แกนวันต่อเนื่อง + วันว่าง = ตอเทา)
function MiniTrend({ data, dataKey, color, target, metric }) {
  const hasData = data.some(d => d[dataKey] != null);
  if (!hasData) return <div style={{ height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--muted)' }}>ไม่มีข้อมูล 10 วันล่าสุด</div>;
  // วันไม่มีข้อมูล = ตอเทาเตี้ย (ไม่ปล่อยว่างจนดูเหมือนวันหาย) + tooltip บอก "ไม่มีข้อมูล"
  const rows = data.map(d => ({ ...d, _stub: d[dataKey] == null ? 2 : null }));
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>เทรนด์ 10 วันล่าสุด</div>
      <ResponsiveContainer width="100%" height={58}>
        <BarChart data={rows} margin={{ top: 2, right: 2, left: 2, bottom: 0 }} barCategoryGap={1}>
          <ReferenceLine y={target} stroke={color} strokeDasharray="3 3" strokeOpacity={0.7} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} interval="preserveStartEnd" axisLine={false} tickLine={false} height={16} />
          <YAxis hide domain={[0, 100]} />
          <Tooltip cursor={{ fill: 'var(--bg3)', opacity: 0.4 }} content={<MiniTrendTip dataKey={dataKey} metric={metric} />} />
          <Bar dataKey="_stub" stackId="v" fill="var(--border)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
          <Bar dataKey={dataKey} stackId="v" fill={color} radius={[2, 2, 0, 0]} opacity={0.85} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Vertical metric bar (Live session card) ───────────────────────
function MetricColumn({ label, value, target, color }) {
  const H = 130;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const barH = (pct / 100) * H;
  const targetTop = H - (target / 100) * H;
  return (
    <div style={{ textAlign: 'center', width: 70 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ position: 'relative', width: 44, height: H, margin: '0 auto', background: 'var(--bg2)', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: barH, background: color, transition: 'height .5s ease' }} />
        <div style={{ position: 'absolute', left: -1, right: -1, top: targetTop, borderTop: '2px dashed rgba(255,255,255,0.55)' }} />
      </div>
      <div style={{ marginTop: 6, fontWeight: 900, fontSize: 15, color }}>{value != null ? value.toFixed(1) : '—'}%</div>
    </div>
  );
}

const STATUS_BADGE = {
  open:          { label: '● RUNNING',    bg: 'rgba(34,197,94,0.15)',  color: '#22c55e' },
  pending_close: { label: '◐ รออนุมัติปิด', bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
  closed:        { label: '■ ปิดกะแล้ว',   bg: 'rgba(148,163,184,0.15)', color: '#94a3b8' },
};

// ── Main Component ───────────────────────────────────────────────
export default function OEEAnalytics() {
  const { role, lineId: userLineId, sections: scopeSecs = [], fullName } = useContext(UserContext);
  const isMobile = useIsMobile(); // ≤768px: grid วิเคราะห์ยุบเป็นคอลัมน์เดียว กันกราฟถูกตัด (desktop ไม่เปลี่ยน)
  const [viewTab, setViewTab] = useState('today'); // today | trend | insight
  // break_policies — ใช้คิดเวลาพักนโยบายสำหรับ OOE/TEEP (ต้องประกาศก่อน tdKpi/kpi ที่เรียกใช้)
  const [breakPols, setBreakPols] = useState([]);
  useEffect(() => {
    supabaseDR.from('break_policies').select('shift, process_type, start_time, duration_min').eq('is_active', true)
      .then(r => setBreakPols(r.data || []), () => setBreakPols([]));
  }, []);
  const canSetTarget = can('oee', 'set_target', role);
  const canExportReview = can('oee', 'export_review', role);
  const [showReviewExport, setShowReviewExport] = useState(false);

  // ── Target OEE/A/P/Q รายกรุ๊ป (ตาราง oee_targets ฝั่ง Main) ──
  const [oeeTargets, setOeeTargets] = useState({});          // { group_name: row }
  const [showTargetModal, setShowTargetModal] = useState(false);
  const loadTargets = useCallback(async () => {
    const { data } = await supabase.from('oee_targets').select('*');
    const m = {};
    (data || []).forEach(r => { m[r.group_name] = r; });
    setOeeTargets(m);
  }, []);
  useEffect(() => { loadTargets(); }, [loadTargets]);

  // mandatory scope (แบบเดียวกับ DailyReport): leader → ครอบครัวไลน์ตัวเอง ·
  // role ที่ถูกจำกัด sections → เฉพาะไลน์ในส่วนงาน scope — filter อิสระของหน้า apply ทับอีกที
  const isScoped = (role === 'leader' && !!userLineId) || scopeSecs.length > 0;

  // ══════════════════════════ Shared line/org data ══════════════════════════
  const [linesFull, setLinesFull] = useState([]); // [{id,name,section,parent_line_name}] — ถูก scope แล้ว
  const [parentChildrenMap, setParentChildrenMap] = useState({}); // { 'HYDROFORM': ['HDF1','HDF2',...] }

  useEffect(() => {
    supabase.from('production_lines').select('id, name, section, parent_line_name').order('name').then(({ data }) => {
      let rows = data || [];
      if (role === 'leader' && userLineId) {
        const myLine = rows.find(l => String(l.id) === String(userLineId));
        const norm = (s) => (s || '').trim().toLowerCase();
        const famSet = new Set((myLine ? getLineFamilyNames(rows, myLine.name) : []).map(norm));
        rows = rows.filter(l => famSet.has(norm(l.name)));
      } else if (scopeSecs.length) {
        rows = rows.filter(l => inSectionScope(scopeSecs, l.section));
      }
      setLinesFull(rows);
      const pcm = {};
      rows.forEach(l => {
        if (l.parent_line_name) {
          if (!pcm[l.parent_line_name]) pcm[l.parent_line_name] = [];
          pcm[l.parent_line_name].push(l.name);
        }
      });
      setParentChildrenMap(pcm);
    });
  }, []);

  /* ══════════════════════════════════════════════════════════════════════
     TAB: TODAY — real-time single-day monitoring dashboard
     ══════════════════════════════════════════════════════════════════════ */
  const [tdDate,   setTdDate]   = useState(() => getWorkDateStr());
  const [tdShift,  setTdShift]  = useState('');
  const [tdSection,setTdSection]= useState('');
  const [tdDept,   setTdDept]   = useState('');
  const [tdLine,   setTdLine]   = useState('');
  const [tdTeam,   setTdTeam]   = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate,  setLastUpdate]  = useState(null);

  const [tdSessions,  setTdSessions]  = useState([]);
  const [tdDowntimes, setTdDowntimes] = useState([]);
  const [tdDefects,   setTdDefects]   = useState([]);
  const [tdHistory,   setTdHistory]   = useState([]); // last 10 days, closed sessions, lightweight
  const [tdProductsByMat, setTdProductsByMat] = useState({}); // mat_no -> part name
  const [tdOrdersBySession, setTdOrdersBySession] = useState({}); // session_id -> prod_orders[] (สำหรับนับงานคู่ RH/LH เป็น 1 คู่)
  const [tdPairMat, setTdPairMat] = useState({}); // mat_no -> pair_mat_no
  const [shiftSchedMap, setShiftSchedMap] = useState({}); // line_id -> day_team
  const [tdLoading, setTdLoading] = useState(false);

  // Cascading Section → Department(group) → Line options
  const sectionOptions = useMemo(() => [...new Set(linesFull.map(l => l.section).filter(Boolean))].sort(), [linesFull]);

  const deptOptions = useMemo(() => {
    const inSection = tdSection ? linesFull.filter(l => l.section === tdSection) : linesFull;
    const parents = [...new Set(inSection.filter(l => parentChildrenMap[l.name]).map(l => l.name))];
    const standalone = inSection.filter(l => !l.parent_line_name && !parentChildrenMap[l.name]).map(l => l.name);
    return { parents: parents.sort(), standalone: standalone.sort() };
  }, [tdSection, linesFull, parentChildrenMap]);

  const lineOptions = useMemo(() => {
    if (!tdDept) return [];
    if (parentChildrenMap[tdDept]) return parentChildrenMap[tdDept];
    return [];
  }, [tdDept, parentChildrenMap]);

  const tdScopeLines = useMemo(() => {
    if (tdLine) return [tdLine];
    if (tdDept) return parentChildrenMap[tdDept] ? [tdDept, ...parentChildrenMap[tdDept]] : [tdDept];
    if (tdSection) return linesFull.filter(l => l.section === tdSection).map(l => l.name);
    // ไม่เลือก filter: role ที่ถูก scope → จำกัดที่ไลน์ใน scope เสมอ (linesFull ถูก scope แล้ว) · ไม่ scope → ทุกไลน์
    return isScoped ? linesFull.map(l => l.name) : null;
  }, [tdLine, tdDept, tdSection, linesFull, parentChildrenMap, isScoped]);

  const tdScopeLabel = tdLine || tdDept || tdSection || 'ทุกไลน์';

  // ── Target ตาม scope ที่เลือก ──
  // กรุ๊ปของไลน์ = parent_line_name (ไลน์เดี่ยวไม่มีแม่ = ตัวมันเอง)
  const groupOfLine = useCallback((lineName) => {
    const row = linesFull.find(l => l.name === lineName);
    return row?.parent_line_name || lineName;
  }, [linesFull]);

  // กรุ๊ปทั้งหมดใน scope (ใช้ทั้ง modal ตั้งค่า และการเฉลี่ยระดับ section/ทุกไลน์)
  const allGroups = useMemo(() => {
    const seen = new Set(); const out = [];
    linesFull.forEach(l => {
      const g = l.parent_line_name || l.name;
      if (seen.has(g)) return;
      seen.add(g);
      const gRow = linesFull.find(x => x.name === g) || l;
      out.push({ name: g, section: gRow.section || '' });
    });
    return out.sort((a, b) => (a.section || '').localeCompare(b.section || '') || a.name.localeCompare(b.name));
  }, [linesFull]);

  // เฉลี่ย target ของหลายกรุ๊ป (กรุ๊ปที่ไม่ตั้งค่า metric นั้นใช้ค่ามาตรฐานแทน)
  // เป้า OEE ไม่ตั้งเอง — คำนวณจาก A×P×Q ของแต่ละกรุ๊ปเสมอ แล้วค่อยเฉลี่ยข้ามกรุ๊ป
  const targetOf = useCallback((groupNames) => {
    const effs = groupNames.map(g => {
      const t = oeeTargets[g] || {};
      return {
        a: t.target_a != null ? Number(t.target_a) : null,
        p: t.target_p != null ? Number(t.target_p) : null,
        q: t.target_q != null ? Number(t.target_q) : null,
      };
    });
    const out = { configured: effs.some(e => e.a != null || e.p != null || e.q != null) };
    for (const k of ['a', 'p', 'q']) {
      const vals = effs.map(e => e[k]).filter(v => v != null);
      out[k] = vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 10) / 10 : TARGET[k];
    }
    const oees = effs.length
      ? effs.map(e => ((e.a ?? TARGET.a) * (e.p ?? TARGET.p) * (e.q ?? TARGET.q)) / 10000)
      : [(TARGET.a * TARGET.p * TARGET.q) / 10000];
    out.oee = Math.round(oees.reduce((s, v) => s + v, 0) / oees.length * 10) / 10;
    return out;
  }, [oeeTargets]);

  // แท็บวันนี้: เลือกกรุ๊ป → เป้ากรุ๊ป · เลือกไลน์ → เป้ากรุ๊ปของไลน์ · เลือก section →
  // เฉลี่ยกรุ๊ปใน section · ทุกไลน์ → เฉลี่ยทุกกรุ๊ปใน scope (เช่น PD3 = เฉลี่ย APRON ASSY + HYDROFORM)
  const tdTarget = useMemo(() => {
    if (tdLine) return targetOf([groupOfLine(tdLine)]);
    if (tdDept) return targetOf([tdDept]);
    const pool = tdSection ? allGroups.filter(g => g.section === tdSection) : allGroups;
    return targetOf(pool.map(g => g.name));
  }, [tdLine, tdDept, tdSection, allGroups, targetOf, groupOfLine]);

  const loadToday = useCallback(async () => {
    // scope แล้วแต่รายชื่อไลน์ยังไม่มา (หรือไม่มีไลน์ใน scope) — ห้าม query แบบไม่กรอง
    if (isScoped && !(tdScopeLines || []).length) { setTdSessions([]); setTdDowntimes([]); setTdDefects([]); return; }
    setTdLoading(true);
    try {
      let q = supabaseDR.from('production_sessions')
        .select('*, dr_products(name, mat_no)')
        .eq('work_date', tdDate)
        .in('status', ['open', 'pending_close', 'closed'])
        .order('created_at', { ascending: false })
        .limit(500);
      if (tdScopeLines?.length === 1) q = q.eq('line_name', tdScopeLines[0]);
      else if (tdScopeLines?.length > 1) q = q.in('line_name', tdScopeLines);
      if (tdShift) q = q.eq('shift', tdShift);
      const { data: sess } = await q;

      const sessionIds = (sess || []).map(s => s.id);
      const [{ data: dt }, { data: def }, { data: ord }] = await Promise.all([
        sessionIds.length
          ? supabaseDR.from('downtime_logs').select('*, dr_downtime_types(name_th, category, color)').in('session_id', sessionIds)
          : Promise.resolve({ data: [] }),
        sessionIds.length
          ? supabaseDR.from('defect_logs').select('*, dr_defect_types(name_th, color), prod_orders(mat_no, part_name)').in('session_id', sessionIds)
          : Promise.resolve({ data: [] }),
        sessionIds.length
          ? supabaseDR.from('prod_orders').select('session_id, mat_no, status, qty, qty_target, qty_ok, qty_actual').in('session_id', sessionIds)
          : Promise.resolve({ data: [] }),
      ]);

      setTdSessions(sess || []);
      setTdDowntimes(dt || []);
      setTdDefects(def || []);
      const obs = {};
      (ord || []).forEach(o => { (obs[o.session_id] || (obs[o.session_id] = [])).push(o); });
      setTdOrdersBySession(obs);
      // pair_mat_no ของ mat ที่มีในกะวันนี้ (นับงานคู่ RH/LH เป็น 1 คู่/stroke — ดู pairTotals.js)
      const mats = [...new Set((ord || []).map(o => o.mat_no).filter(Boolean))];
      if (mats.length) {
        const { data: prod } = await supabaseDR.from('dr_products').select('mat_no, pair_mat_no').in('mat_no', mats);
        const pm = {};
        (prod || []).forEach(p => { if (p.pair_mat_no) pm[p.mat_no] = p.pair_mat_no; });
        setTdPairMat(pm);
      } else setTdPairMat({});
      setLastUpdate(new Date());

      // เก็บ mat_no → part name ไว้ map ให้ downtime_logs.mat_no (free text, ไม่ใช่ FK)
      const matMap = {};
      (sess || []).forEach(s => { if (s.dr_products?.mat_no) matMap[s.dr_products.mat_no] = s.dr_products.name; });
      setTdProductsByMat(prev => ({ ...prev, ...matMap }));
    } finally {
      setTdLoading(false);
    }
  }, [tdDate, tdShift, tdScopeLines, isScoped]);

  const loadTdHistory = useCallback(async () => {
    if (isScoped && !(tdScopeLines || []).length) { setTdHistory([]); return; }
    const startStr = dateStrAdd(tdDate, -9);
    let q = supabaseDR.from('production_sessions')
      .select('work_date, oee, oee_a, oee_p, oee_q, status, line_name, shift, shift_min, actual_qty, qty_ng')
      .eq('status', 'closed')
      .gte('work_date', startStr).lte('work_date', tdDate)
      .limit(3000);
    if (tdScopeLines?.length === 1) q = q.eq('line_name', tdScopeLines[0]);
    else if (tdScopeLines?.length > 1) q = q.in('line_name', tdScopeLines);
    if (tdShift) q = q.eq('shift', tdShift);
    const { data } = await q;
    setTdHistory(data || []);
  }, [tdDate, tdShift, tdScopeLines, isScoped]);

  // ทีมตามตาราง shift_schedules (A/B สลับกันตามวัน, C กะเช้าตลอด) — best effort, ถ้าไม่มีข้อมูลจะไม่ระบุ
  useEffect(() => {
    if (!tdDate || !linesFull.length) return;
    const ids = linesFull.map(l => l.id);
    supabase.from('shift_schedules').select('line_id, day_team').eq('work_date', tdDate).in('line_id', ids)
      .then(({ data }) => {
        const m = {};
        (data || []).forEach(r => { m[r.line_id] = r.day_team; });
        setShiftSchedMap(m);
      });
  }, [tdDate, linesFull]);

  const lineIdByName = useMemo(() => Object.fromEntries(linesFull.map(l => [l.name, l.id])), [linesFull]);
  const resolveTeam = useCallback((lineName, shift) => {
    const id = lineIdByName[lineName];
    const dayTeam = id != null ? shiftSchedMap[id] : undefined;
    if (!dayTeam) return null;
    if (shift === 'day') return dayTeam;
    if (dayTeam === 'C') return null; // Team C ไม่มีกะดึก
    return dayTeam === 'A' ? 'B' : 'A';
  }, [lineIdByName, shiftSchedMap]);

  useEffect(() => { loadToday(); }, [loadToday]);
  useEffect(() => { loadTdHistory(); }, [loadTdHistory]);

  // Auto refresh ทุก 60 วิ เฉพาะตอนอยู่ tab วันนี้ + เปิด auto refresh
  useEffect(() => {
    if (viewTab !== 'today' || !autoRefresh) return;
    const t = setInterval(() => { loadToday(); loadTdHistory(); }, 60000);
    return () => clearInterval(t);
  }, [viewTab, autoRefresh, loadToday, loadTdHistory]);

  const tdSessionsTeamFiltered = useMemo(() => {
    if (!tdTeam) return tdSessions;
    return tdSessions.filter(s => resolveTeam(s.line_name, s.shift) === tdTeam);
  }, [tdSessions, tdTeam, resolveTeam]);

  const tdSessionIdSet = useMemo(() => new Set(tdSessionsTeamFiltered.map(s => s.id)), [tdSessionsTeamFiltered]);
  const tdDowntimesScoped = useMemo(() => tdTeam ? tdDowntimes.filter(d => tdSessionIdSet.has(d.session_id)) : tdDowntimes, [tdDowntimes, tdTeam, tdSessionIdSet]);
  const tdDefectsScoped   = useMemo(() => tdTeam ? tdDefects.filter(d => tdSessionIdSet.has(d.session_id)) : tdDefects,   [tdDefects, tdTeam, tdSessionIdSet]);

  const tdRows = useMemo(() => calcOEE(tdSessionsTeamFiltered, tdDowntimesScoped, tdDefectsScoped), [tdSessionsTeamFiltered, tdDowntimesScoped, tdDefectsScoped]);

  const tdKpi = useMemo(() => {
    // งานคู่ RH/LH (pair_mat_no) นับเป็น 1 คู่/stroke — เฉพาะกะที่มีคู่จริงถึงคำนวณจาก prod_orders ที่เหลือใช้ค่า stamped เดิม
    const hasPairIn = os => os.some(o => o.mat_no && tdPairMat[o.mat_no] && os.some(x => x.mat_no === tdPairMat[o.mat_no]));
    const pairSum = (os, pick) => {
      const perMat = {}; let nullSum = 0;
      os.forEach(o => { const v = pick(o); if (!o.mat_no) { nullSum += v; return; }
        (perMat[o.mat_no] || (perMat[o.mat_no] = { mat_no: o.mat_no, target: 0 })).target += v; });
      return pairAwareTotal(Object.values(perMat), m => tdPairMat[m] || null).target + nullSum;
    };
    const sessTarget = r => {
      const os = (tdOrdersBySession[r.id] || []).filter(o => !['cancelled','imported','carry_over'].includes(o.status));
      if (hasPairIn(os)) return pairSum(os, o => o.qty_target ?? o.qty ?? 0);
      return r.target_qty || 0;
    };
    const sessActual = r => {
      const os = tdOrdersBySession[r.id] || [];
      if (hasPairIn(os)) return pairSum(os, o => o.qty_ok ?? o.qty_actual ?? 0);
      return r.totalQty || 0;
    };
    // OOE/TEEP ของวันนี้ — ฐาน: OOE = เวลากะทั้งหมด · TEEP = ปฏิทิน 24 ชม. ของไลน์ที่เปิดกะวันนี้
    const tdOee = wavg(tdRows, r => r.calcOEE, wLoad);
    const tdValid = tdRows.filter(r => r.calcOEE != null && (Number(r.shift_min) || 0) > 0);
    let tdNet = 0, tdShift = 0, tdBreak = 0, tdPlanned = 0;
    const tdLineSet = new Set();
    tdValid.forEach(r => {
      const sm = Number(r.shift_min) || 0;
      const brk = policyBreakMin(r.shift, sm, breakPols);
      const pl = Number(r.plannedMin) || 0;
      tdShift += sm; tdBreak += brk; tdPlanned += pl; tdNet += Math.max(0, sm - brk - pl);
      tdLineSet.add(r.line_name);
    });
    const tdCal = tdLineSet.size * 1440;   // วันเดียว = 1,440 นาที/ไลน์
    const tdR1 = v => (v == null ? null : +v.toFixed(1));
    return {
      oee: tdOee, a: wavg(tdRows, r => r.calcA, wLoad),
      p: wavg(tdRows, r => r.calcP, wRun), q: wavg(tdRows, r => r.calcQ, wProd),
      ooe:  tdOee != null && tdShift > 0 ? tdR1(tdOee * (tdNet / tdShift)) : null,
      teep: tdOee != null && tdCal   > 0 ? tdR1(tdOee * (tdNet / tdCal))   : null,
      netAvailMin: Math.round(tdNet), shiftMinSum: Math.round(tdShift),
      breakMinTotal: Math.round(tdBreak), plannedMinTotal: Math.round(tdPlanned), teepLines: tdLineSet.size,
      totalQty: tdRows.reduce((s, r) => s + sessActual(r), 0),
      targetQty: tdRows.reduce((s, r) => s + sessTarget(r), 0),
      totalDT: tdDowntimesScoped.reduce((s, d) => s + (d.duration_min || 0), 0),
      totalShiftMin: tdSessionsTeamFiltered.reduce((s, r) => s + (r.shift_min || 0), 0),
    };
  }, [tdRows, tdDowntimesScoped, tdSessionsTeamFiltered, tdOrdersBySession, tdPairMat, breakPols]);

  const tdHistoryGrouped = useMemo(() => {
    const map = {};
    for (const r of tdHistory) { (map[r.work_date] ||= []).push(r); }
    const days = [];
    for (let i = 9; i >= 0; i--) {
      const key = dateStrAdd(tdDate, -i);
      const items = map[key] || [];
      days.push({
        key, label: fmtDayLabel(key),
        oee: wavg(items, i => i.oee   != null ? +i.oee   : null, wLoad),
        a:   wavg(items, i => i.oee_a != null ? +i.oee_a : null, wLoad),
        p:   wavg(items, i => i.oee_p != null ? +i.oee_p : null, wRun),
        q:   wavg(items, i => i.oee_q != null ? +i.oee_q : null, wProd),
      });
    }
    return days;
  }, [tdHistory, tdDate]);

  // Live/latest session card
  const tdLiveSession = useMemo(() => {
    const running = tdSessionsTeamFiltered.filter(s => s.status === 'open' || s.status === 'pending_close')
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    if (running.length) return running[0];
    const closed = [...tdSessionsTeamFiltered].sort((a, b) => (b.closed_at || b.created_at || '').localeCompare(a.closed_at || a.created_at || ''));
    return closed[0] || null;
  }, [tdSessionsTeamFiltered]);

  const tdLiveRow = useMemo(() => tdLiveSession ? tdRows.find(r => r.id === tdLiveSession.id) : null, [tdLiveSession, tdRows]);
  // target ของการ์ด live = เป้ากรุ๊ปของไลน์ที่กำลังผลิตจริง (เจาะจงกว่า filter รวม)
  const liveTarget = useMemo(
    () => tdLiveSession ? targetOf([groupOfLine(tdLiveSession.line_name)]) : null,
    [tdLiveSession, targetOf, groupOfLine]
  );

  // Downtime donut (โดยประเภท)
  // จัดอันดับสาเหตุ (pareto) — สีตาม "ประเภท" เท่านั้น: นอกแผน = ม่วง (เด่น) / ในแผน = เทา (จาง)
  // ห้ามกลับไปไล่สีตามลำดับแถว (hue-cycling อ่านไม่ออกว่าสีสื่ออะไร — เคยเป็นโดนัท 25 สี)
  const [tdDtShowAll, setTdDtShowAll] = useState(false);
  const tdDtByCause = useMemo(() => {
    const map = {};
    for (const d of tdDowntimesScoped) {
      const name = d.dr_downtime_types?.name_th || 'ไม่ระบุ';
      const cat  = d.dr_downtime_types?.category || 'unplanned';
      if (!map[name]) map[name] = { name, min: 0, category: cat };
      map[name].min += d.duration_min || 0;
    }
    const rows = Object.values(map).sort((a, b) => b.min - a.min);
    const total = rows.reduce((s, d) => s + d.min, 0);
    const max = rows.length ? rows[0].min : 0;
    return {
      total: +total.toFixed(1),
      plannedMin:   +rows.filter(d => d.category === 'planned').reduce((s, d) => s + d.min, 0).toFixed(1),
      unplannedMin: +rows.filter(d => d.category !== 'planned').reduce((s, d) => s + d.min, 0).toFixed(1),
      rows: rows.map(d => ({
        ...d, min: +d.min.toFixed(1),
        pct: total > 0 ? +(d.min / total * 100).toFixed(1) : 0,
        barPct: max > 0 ? (d.min / max * 100) : 0,
      })),
    };
  }, [tdDowntimesScoped]);

  // Top 10 downtime แยกตามพาร์ท (mat_no ที่บันทึกไว้ตอน log downtime)
  // นับเฉพาะ "นอกแผน" — ในแผน (นับสต๊อก/ไม่มีแผนผลิต) ไม่ผูก mat_no แล้วเคยครองอันดับ 1 เป็น
  // "ไม่ระบุ MAT.NO 81.9%" ซึ่งไม่ใช่ความเสียหายจริง กลบพาร์ทที่มีปัญหาจริง (2026-07-15)
  const tdDtByPart = useMemo(() => {
    const map = {};
    for (const d of tdDowntimesScoped) {
      if (d.dr_downtime_types?.category === 'planned') continue;
      const mat = d.mat_no || 'ไม่ระบุ MAT.NO';
      if (!map[mat]) map[mat] = { mat, part: tdProductsByMat[mat] || mat, min: 0 };
      map[mat].min += d.duration_min || 0;
    }
    const arr = Object.values(map).sort((a, b) => b.min - a.min).slice(0, 10);
    const max = arr.length ? arr[0].min : 0;
    const total = Object.values(map).reduce((s, d) => s + d.min, 0);
    return arr.map(d => ({ ...d, min: +d.min.toFixed(1), pct: total > 0 ? +(d.min / total * 100).toFixed(1) : 0, barPct: max > 0 ? (d.min / max * 100) : 0 }));
  }, [tdDowntimesScoped, tdProductsByMat]);

  /* ══════════════════════════════════════════════════════════════════════
     TAB: TREND — historical range analytics (เดิม)
     ══════════════════════════════════════════════════════════════════════ */
  const [sessions,   setSessions]   = useState([]);
  const [downtimes,  setDowntimes]  = useState([]);
  const [defects,    setDefects]    = useState([]);
  const [dtTypes,    setDtTypes]    = useState([]);
  const [defectTypes,setDefectTypes]= useState([]);
  const [lines,      setLines]      = useState([]);
  const [loading,    setLoading]    = useState(true);

  // Filters
  const [period,     setPeriod]     = useState('monthly'); // daily|monthly|yearly
  const [selLine,    setSelLine]    = useState('');
  const [selShift,   setSelShift]   = useState('');
  const [dateFrom,   setDateFrom]   = useState(() => dateStrAdd(getWorkDateStr(), -90));
  const [dateTo,     setDateTo]     = useState(() => getWorkDateStr());

  // Target ของแท็บแนวโน้ม: เลือกกรุ๊ป/ไลน์ → เป้ากรุ๊ปนั้น · ทุกไลน์ → เฉลี่ยทุกกรุ๊ปใน scope
  const trTarget = useMemo(() => {
    if (selLine) return targetOf([groupOfLine(selLine)]);
    return targetOf(allGroups.map(g => g.name));
  }, [selLine, allGroups, targetOf, groupOfLine]);

  // ── Load data ──────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const pcm = parentChildrenMap; // pre-loaded by shared effect above

      // Expand selLine: if it's a parent, include all its children
      // ไม่เลือกไลน์: role ที่ถูก scope → จำกัดที่ไลน์ใน scope เสมอ (linesFull ถูก scope แล้ว)
      const expandedLines = selLine
        ? (pcm[selLine] ? [selLine, ...pcm[selLine]] : [selLine])
        : (isScoped ? linesFull.map(l => l.name) : null);
      if (isScoped && !expandedLines?.length) {
        setSessions([]); setDowntimes([]); setDefects([]); setLoading(false); return;
      }

      let q = supabaseDR.from('production_sessions')
        .select('*')
        .eq('status', 'closed')
        .gte('work_date', dateFrom)
        .lte('work_date', dateTo)
        .order('work_date', { ascending: true })
        .limit(5000);
      if (expandedLines?.length === 1) q = q.eq('line_name', expandedLines[0]);
      else if (expandedLines?.length > 1) q = q.in('line_name', expandedLines);
      if (selShift) q = q.eq('shift', selShift);
      const { data: sess } = await q;

      const sessionIds = (sess || []).map(s => s.id);

      const [{ data: dt }, { data: def }, { data: dtt }, { data: deft }, { data: linesData }] = await Promise.all([
        sessionIds.length
          ? supabaseDR.from('downtime_logs').select('*, dr_downtime_types(name_th, category, color)').in('session_id', sessionIds)
          : Promise.resolve({ data: [] }),
        sessionIds.length
          ? supabaseDR.from('defect_logs').select('*, dr_defect_types(name_th, color), prod_orders(mat_no, part_name)').in('session_id', sessionIds)
          : Promise.resolve({ data: [] }),
        supabaseDR.from('dr_downtime_types').select('*').eq('is_active', true).order('sort_order'),
        supabaseDR.from('dr_defect_types').select('*').eq('is_active', true).order('sort_order'),
        supabaseDR.from('production_sessions').select('line_name').eq('status', 'closed'),
      ]);

      setSessions(sess || []);
      setDowntimes(dt || []);
      setDefects(def || []);
      setDtTypes(dtt || []);
      setDefectTypes(deft || []);

      // dropdown ไลน์ของแท็บ trend มาจากชื่อไลน์ใน sessions — ต้องกรองตาม scope ด้วย
      const normLn = (s) => (s || '').trim().toLowerCase();
      const allowedSet = isScoped ? new Set(linesFull.map(l => normLn(l.name))) : null;
      const uniqueLines = [...new Set((linesData || []).map(r => r.line_name).filter(Boolean))]
        .filter(n => !allowedSet || allowedSet.has(normLn(n)))
        .sort();
      setLines(uniqueLines);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, selLine, selShift, parentChildrenMap, isScoped, linesFull]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Computed rows ──────────────────────────────────────────────
  const rows = useMemo(() => calcOEE(sessions, downtimes, defects), [sessions, downtimes, defects]);

  // ── Group by period ────────────────────────────────────────────
  const grouped = useMemo(() => {
    const map = {};
    for (const r of rows) {
      const key = period === 'daily'
        ? r.work_date
        : period === 'monthly'
        ? fmtMonthKey(r.work_date)
        : fmtYearKey(r.work_date);
      if (!map[key]) map[key] = [];
      map[key].push(r);
    }
    const out = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).map(([key, items]) => {
      return {
        key,
        label: period === 'daily' ? fmtDayLabel(key) : period === 'monthly' ? fmtMonthLabel(key) : `${+key + 543}`,
        oee:   wavg(items, i => i.calcOEE, wLoad),
        a:     wavg(items, i => i.calcA, wLoad),
        p:     wavg(items, i => i.calcP, wRun),
        q:     wavg(items, i => i.calcQ, wProd),
        totalQty:   items.reduce((s, i) => s + (i.totalQty || 0), 0),
        ngQty:      items.reduce((s, i) => s + (i.ngQty || 0), 0),
        unplannedMin: items.reduce((s, i) => s + i.unplannedMin, 0),
        count: items.length,
      };
    });

    // แกนวันต่อเนื่อง — วันที่ไม่มีการผลิตต้องมีช่องของตัวเอง (ค่าเป็น null = ตอว่าง)
    // ไม่งั้นกราฟ "ข้ามวัน" ทำให้ระยะห่างบนแกนไม่ตรงเวลาจริง อ่านเทรนด์ผิด
    // (UI-CONVENTIONS · pattern เดียวกับกราฟรายวันใน /product-history · QC audit 2026-08-03)
    // เติมเฉพาะช่องว่างระหว่างวันแรก-วันสุดท้ายที่มีข้อมูล (ไม่ pad หัว-ท้ายช่วงที่เลือก) · cap 400 วันกันช่วงยาวผิดปกติ
    if (period !== 'daily' || out.length < 2) return out;
    const dayMs = 86400000;
    const first = new Date(`${out[0].key}T00:00:00`), last = new Date(`${out[out.length - 1].key}T00:00:00`);
    const span = Math.round((last - first) / dayMs) + 1;
    if (!(span > out.length) || span > 400) return out;
    const byKey = Object.fromEntries(out.map(g => [g.key, g]));
    const filled = [];
    for (let t = first.getTime(); t <= last.getTime(); t += dayMs) {
      const d = new Date(t);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      filled.push(byKey[key] || {
        key, label: fmtDayLabel(key), empty: true,
        oee: null, a: null, p: null, q: null,
        totalQty: 0, ngQty: 0, unplannedMin: 0, count: 0,
      });
    }
    return filled;
  }, [rows, period]);

  // ── Overall KPIs ───────────────────────────────────────────────
  const kpi = useMemo(() => {
    // ถ่วงน้ำหนักตรงจากทุกกะใน scope (ไม่ใช่เฉลี่ยของค่าเฉลี่ยรายวันอีกชั้น — mean-of-means ทำให้
    // วันที่ผลิตน้อยถ่วงเท่าวันที่ผลิตเยอะ) · A/OEE ถ่วงเวลารับภาระ, P ถ่วงเวลาเดินเครื่อง, Q ถ่วงจำนวนผลิต
    const oee = wavg(rows, r => r.calcOEE, wLoad);
    // ── ฐานเวลาสำหรับ OOE/TEEP — นับเฉพาะกะที่มี OEE (กะไม่มีผลผลิตไม่ถ่วง) ──
    const valid = rows.filter(r => r.calcOEE != null && (Number(r.shift_min) || 0) > 0);
    let sumNetAvail = 0, sumShift = 0, sumBreak = 0, sumPlanned = 0;
    const lineSet = new Set();
    valid.forEach(r => {
      const shiftMin = Number(r.shift_min) || 0;
      const brk = policyBreakMin(r.shift, shiftMin, breakPols);
      const plan = Number(r.plannedMin) || 0;
      sumShift += shiftMin; sumBreak += brk; sumPlanned += plan;
      sumNetAvail += Math.max(0, shiftMin - brk - plan);
      lineSet.add(r.line_name);
    });
    // TEEP: ฐาน = เวลาปฏิทินทั้งหมดในช่วงที่เลือก × จำนวนไลน์ — **ต้องรวมวันที่ไม่ได้เปิดกะด้วย**
    // (ตามตำรา "Not Scheduled Time / ไม่มีแผนเปิดกะ" อยู่ในฐาน TEEP — ถ้านับเฉพาะวันที่เปิดกะ TEEP จะสูงเกินจริง)
    const dayCount = Math.max(1, Math.round((new Date(`${dateTo}T00:00:00`) - new Date(`${dateFrom}T00:00:00`)) / 86400000) + 1);
    const calMin = lineSet.size * dayCount * 1440;
    const r1 = (v) => (v == null ? null : +v.toFixed(1));
    return {
      oee, a: wavg(rows, r => r.calcA, wLoad),
      p: wavg(rows, r => r.calcP, wRun), q: wavg(rows, r => r.calcQ, wProd),
      // OOE/TEEP = OEE × สัดส่วนฐานเวลา → เรียง TEEP ≤ OOE ≤ OEE เสมอ และอธิบายได้ตรงๆ
      ooe:  oee != null && sumShift > 0 ? r1(oee * (sumNetAvail / sumShift)) : null,
      teep: oee != null && calMin  > 0 ? r1(oee * (sumNetAvail / calMin))   : null,
      netAvailMin: Math.round(sumNetAvail), shiftMinTotal: Math.round(sumShift),
      breakMinTotal: Math.round(sumBreak), plannedMinTotal: Math.round(sumPlanned), calMin,
      teepLines: lineSet.size, teepDays: dayCount,
      sessions: rows.length, total: rows.reduce((s, r) => s + r.totalQty, 0),
    };
  }, [rows, breakPols, dateFrom, dateTo]);

  // ── Downtime Pareto ────────────────────────────────────────────
  // แถวดิบสำหรับ Pareto + เจาะลึก (ParetoAbcChart รวมยอด/จัด ABC/เจาะมิติเอง)
  //   session → ไลน์/กะ/วัน · downtime_logs → เครื่อง/ชิ้นงาน/ผู้บันทึก/หมายเหตุ
  const sessById = useMemo(() => Object.fromEntries(rows.map(r => [r.id, r])), [rows]);
  const dtRecords = useMemo(() => downtimes.map(d => {
    const s = sessById[d.session_id] || {};
    return {
      cat: d.dr_downtime_types?.name_th || 'ไม่ระบุ',
      value: Number(d.duration_min) || 0,
      machine: d.machine_no || '', line: s.line_name || '',
      product: d.mat_no || '', shift: s.shift === 'day' ? 'กะเช้า' : s.shift === 'night' ? 'กะดึก' : '',
      man: d.reported_by_name || '', date: s.work_date || '',
      note: d.description || '',
    };
  }), [downtimes, sessById]);
  const defRecords = useMemo(() => defects.map(d => {
    const s = sessById[d.session_id] || {};
    return {
      cat: d.dr_defect_types?.name_th || 'ไม่ระบุ',
      value: (d.qty_ng || 0) + (d.qty_suspect || 0),
      product: d.prod_orders?.mat_no || '', line: s.line_name || '',
      shift: s.shift === 'day' ? 'กะเช้า' : s.shift === 'night' ? 'กะดึก' : '',
      man: d.reported_by_name || '', date: s.work_date || '',
      note: d.description || '',
    };
  }), [defects, sessById]);
  const DT_DIMS = [
    { key: 'machine', label: '⚙️ เครื่องจักร' }, { key: 'line', label: '🏭 ไลน์' },
    { key: 'product', label: '📦 ชิ้นงาน' }, { key: 'shift', label: '🕐 กะ' },
    { key: 'man', label: '👤 ผู้บันทึก' }, { key: 'date', label: '📅 วัน' },
  ];
  const DEF_DIMS = [
    { key: 'product', label: '📦 ชิ้นงาน' }, { key: 'line', label: '🏭 ไลน์' },
    { key: 'shift', label: '🕐 กะ' }, { key: 'man', label: '👤 ผู้บันทึก' }, { key: 'date', label: '📅 วัน' },
  ];

  // ── Styles ─────────────────────────────────────────────────────
  const s = {
    page:    { padding: '20px 24px', maxWidth: 'min(96vw, 2000px)', margin: '0 auto' },
    section: { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', marginBottom: 16 },
    title:   { fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 12 },
    sel:     { width: 'auto', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text)', fontSize: 13 }, // width:auto กัน index.css input/select {width:100%} ยืดเต็ม filter bar
    tab:     active => ({ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                background: active ? 'var(--accent)' : 'var(--bg2)', color: active ? '#000' : 'var(--text)' }),
  };

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={{ display: 'flex', paddingRight: 52, justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)' }}>📈 OEE Analytics</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>วิเคราะห์ประสิทธิภาพการผลิต — Availability · Performance · Quality</div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={s.tab(viewTab === 'today')}  onClick={() => setViewTab('today')}>⚡ ภาพรวมวันนี้</button>
          <button style={s.tab(viewTab === 'trend')}  onClick={() => setViewTab('trend')}>📊 แนวโน้ม/ประวัติ</button>
          <button style={s.tab(viewTab === 'insight')} onClick={() => setViewTab('insight')}>🧠 วิเคราะห์สาเหตุ</button>
          {canSetTarget && (
            <button style={{ ...s.tab(false), color: '#f59e0b', border: '1px solid rgba(245,158,11,0.4)' }}
              onClick={() => setShowTargetModal(true)} title="ตั้ง Target A/P/Q รายกรุ๊ป (OEE = A×P×Q อัตโนมัติ) — ระดับส่วนคำนวณจากค่าเฉลี่ยของกรุ๊ป">
              🎯 ตั้ง Target
            </button>
          )}
          {canExportReview && (
            <button style={{ ...s.tab(false), border: '1px solid var(--border2)' }}
              onClick={() => setShowReviewExport(true)} title="สร้างเด็ค Monthly Performance Review (.pptx) ตาม template TSG จากข้อมูลเดือนที่เลือก">
              📽️ รายงานเดือน
            </button>
          )}
        </div>
      </div>

      {viewTab === 'today' ? (
        <>
          {/* ── Filter bar ── */}
          <div style={{ ...s.section, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <input type="date" value={tdDate} onChange={e => setTdDate(e.target.value)} style={s.sel} />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtThaiDate(tdDate)}</span>

            <select style={s.sel} value={tdShift} onChange={e => setTdShift(e.target.value)}>
              <option value="">ALL SHIFT (ทุกกะ)</option>
              <option value="day">กะเช้า</option>
              <option value="night">กะดึก</option>
            </select>

            <select style={s.sel} value={tdSection} onChange={e => { setTdSection(e.target.value); setTdDept(''); setTdLine(''); }}>
              <option value="">ทุกส่วนงาน</option>
              {sectionOptions.map(sec => <option key={sec} value={sec}>{sec}</option>)}
            </select>

            <select style={s.sel} value={tdDept} onChange={e => { setTdDept(e.target.value); setTdLine(''); }}>
              <option value="">ทุกแผนก/กลุ่มไลน์</option>
              {deptOptions.parents.map(p => <option key={p} value={p}>▸ {p}</option>)}
              {deptOptions.standalone.map(l => <option key={l} value={l}>{l}</option>)}
            </select>

            {lineOptions.length > 0 && (
              <select style={s.sel} value={tdLine} onChange={e => setTdLine(e.target.value)}>
                <option value="">{tdDept} (ทั้งหมด)</option>
                {lineOptions.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            )}

            <select style={s.sel} value={tdTeam} onChange={e => setTdTeam(e.target.value)}>
              <option value="">ทุกทีม</option>
              <option value="A">Team A</option>
              <option value="B">Team B</option>
              <option value="C">Team C</option>
            </select>

            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              LAST UPDATE : {lastUpdate ? lastUpdate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
            </span>
            <button onClick={() => { loadToday(); loadTdHistory(); }} style={{ ...s.tab(false) }}>🔄</button>
            <button onClick={() => setAutoRefresh(v => !v)} style={s.tab(autoRefresh)}>
              {/* จุดเขียวนิ่ง — กระพริบสงวนให้สถานะแดง (Andon) เท่านั้น ตาม UI-CONVENTIONS */}
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: autoRefresh ? '#22c55e' : 'var(--muted)', marginRight: 6, boxShadow: autoRefresh ? '0 0 5px 1px rgba(34,197,94,0.6)' : 'none' }} />
              AUTO REFRESH
            </button>
            {tdLoading && <span style={{ fontSize: 12, color: 'var(--muted)' }}>กำลังโหลด...</span>}
          </div>

          {/* 1. OEE Overview */}
          <div style={s.section}>
            <div style={s.title}>1. OEE OVERVIEW — {tdScopeLabel}</div>
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ position: 'relative', width: 168, height: 168, flexShrink: 0 }}>
                <GaugeRing value={tdKpi.oee} color={oeeColor(tdKpi.oee ?? 0)} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>OEE รวมวันนี้</div>
                  <div style={{ fontSize: 34, fontWeight: 900, color: tdKpi.oee != null ? oeeColor(tdKpi.oee) : 'var(--muted)' }}>{tdKpi.oee ?? '—'}{tdKpi.oee != null ? '%' : ''}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }} title={tdTarget.configured ? 'เป้าจากการตั้งค่ารายกรุ๊ป (section = เฉลี่ยของกรุ๊ป)' : 'ค่ามาตรฐาน — ยังไม่ตั้ง target กรุ๊ปใน scope นี้'}>
                    TARGET {tdTarget.oee}%{tdTarget.configured ? '' : ' *'}
                  </div>
                </div>
              </div>
              {['a', 'p', 'q'].map(k => (
                <div key={k} style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{METRIC_LABEL[k]}</div>
                  <div style={{ fontSize: 26, fontWeight: 900, color: tdKpi[k] != null ? METRIC_COLOR_FN[k](tdKpi[k]) : 'var(--muted)' }}>{tdKpi[k] ?? '—'}{tdKpi[k] != null ? '%' : ''}</div>
                  <MiniTrend data={tdHistoryGrouped} dataKey={k} color={METRIC_COLOR[k]} target={tdTarget[k]} metric={k.toUpperCase()} />
                  <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}><span style={{ color: METRIC_COLOR[k] }}>╌╌</span> เส้นประ = เป้า {tdTarget[k]}%</div>
                </div>
              ))}
            </div>

            {/* ── OOE / TEEP วันนี้ — ต่างจาก OEE ที่ "ฐานเวลา" (2026-08-04) ── */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <div style={{ flex: '1 1 150px', minWidth: 140 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>OOE — ใช้เวลากะคุ้มแค่ไหน</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: tdKpi.ooe != null ? oeeColor(tdKpi.ooe) : 'var(--muted)' }}>{tdKpi.ooe ?? '—'}{tdKpi.ooe != null ? '%' : ''}</div>
                <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>ฐาน = เวลากะทั้งหมด (รวมพัก + หยุดตามแผน)</div>
              </div>
              <div style={{ flex: '1 1 150px', minWidth: 140 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>TEEP — ใช้กำลังผลิตที่มีกี่ %</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: tdKpi.teep != null ? oeeColor(tdKpi.teep) : 'var(--muted)' }}>{tdKpi.teep ?? '—'}{tdKpi.teep != null ? '%' : ''}</div>
                <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>ฐาน = ปฏิทิน 24 ชม. · {tdKpi.teepLines} ไลน์</div>
              </div>
              <div style={{ flex: '2 1 260px', minWidth: 230 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 4 }}>เวลาที่หายไปก่อนถึง OEE (ในกะ)</div>
                {tdKpi.shiftMinSum > 0 ? (<>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
                    <span>☕ พัก <b style={{ color: 'var(--text)' }}>{tdKpi.breakMinTotal.toLocaleString()}</b> น.</span>
                    <span>🗓️ หยุดตามแผน <b style={{ color: '#f59e0b' }}>{tdKpi.plannedMinTotal.toLocaleString()}</b> น.</span>
                    <span>= <b style={{ color: '#f59e0b' }}>{((tdKpi.breakMinTotal + tdKpi.plannedMinTotal) / tdKpi.shiftMinSum * 100).toFixed(1)}%</b> ของเวลากะ</span>
                  </div>
                  <div style={{ display: 'flex', height: 9, borderRadius: 5, overflow: 'hidden', background: 'var(--bg3)', marginTop: 8 }}>
                    <div style={{ width: `${tdKpi.ooe ?? 0}%`, background: '#22c55e' }} title="สร้างของดี" />
                    <div style={{ width: `${Math.max(0, (tdKpi.netAvailMin / tdKpi.shiftMinSum * 100) - (tdKpi.ooe ?? 0))}%`, background: '#a855f7' }} title="เสียตอนเดินเครื่อง" />
                    <div style={{ flex: 1, background: '#f59e0b' }} title="พัก + หยุดตามแผน" />
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 5 }}>🟩 สร้างของดี · 🟪 เสียตอนเดินเครื่อง · 🟧 พัก+หยุดตามแผน (OEE ไม่เห็นส่วนนี้)</div>
                </>) : <div style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มีกะปิด</div>}
              </div>
            </div>
          </div>

          {/* Row: Live session + Production qty gauge */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.4fr 1fr', gap: 16, marginBottom: 16 }}>
            {/* 1.1 Live session */}
            <div style={{ ...s.section, marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={s.title}>1.1 OEE รายการล่าสุด (กำลังผลิตงานอยู่)</div>
                {tdLiveSession && (() => { const b = STATUS_BADGE[tdLiveSession.status] || STATUS_BADGE.closed; return (
                  <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: b.bg, color: b.color }}>{b.label}</span>
                ); })()}
              </div>
              {!tdLiveSession ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>ไม่มีข้อมูลกะในวันที่เลือก</div>
              ) : (
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ minWidth: 140 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>LINE</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>{tdLiveSession.line_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>PART</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{tdLiveSession.dr_products?.name || tdLiveSession.dr_products?.mat_no || '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>OEE</div>
                    <div style={{ fontSize: 28, fontWeight: 900, color: tdLiveRow?.calcOEE != null ? oeeColor(tdLiveRow.calcOEE) : 'var(--muted)' }}>
                      {tdLiveRow?.calcOEE ?? '—'}{tdLiveRow?.calcOEE != null ? '%' : ''}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>TARGET {(liveTarget || tdTarget).oee}%</div>
                  </div>
                  <div style={{ display: 'flex', gap: 14 }}>
                    <MetricColumn label="A" value={tdLiveRow?.calcA} target={(liveTarget || tdTarget).a} color={METRIC_COLOR.a} />
                    <MetricColumn label="P" value={tdLiveRow?.calcP} target={(liveTarget || tdTarget).p} color={METRIC_COLOR.p} />
                    <MetricColumn label="Q" value={tdLiveRow?.calcQ} target={(liveTarget || tdTarget).q} color={METRIC_COLOR.q} />
                  </div>
                </div>
              )}
            </div>

            {/* 3. Production qty gauge — เป้ากะ (target_qty) ปัจจุบันไม่ได้ตั้งในระบบ (=0 ทุกกะ)
                target 0 = ไม่มีเป้าให้เทียบ ห้ามโชว์ "0%" (ดูเป็นพลาดเป้าทั้งที่ผลิตได้จริง) — โชว์ "ยังไม่ตั้งเป้า" (2026-07-15) */}
            {(() => { const hasTarget = tdKpi.targetQty > 0; const achievePct = hasTarget ? Math.round(Math.min(100, tdKpi.totalQty / tdKpi.targetQty * 100)) : 0; return (
            <div style={{ ...s.section, marginBottom: 0 }}>
              <div style={s.title}>3. จำนวนชิ้นงานที่ผลิตรวมของวันนี้</div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>เป้าหมาย</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: hasTarget ? 'var(--text)' : 'var(--muted)' }}>
                    {hasTarget ? <>{tdKpi.targetQty.toLocaleString()} <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>ชิ้น</span></> : <span style={{ fontSize: 14, fontWeight: 700 }}>ยังไม่ตั้งเป้ากะ</span>}
                  </div>
                  <div style={{ height: 10 }} />
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>ผลิตได้แล้ว</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: '#4d9fff' }}>{tdKpi.totalQty.toLocaleString()} <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>ชิ้น</span></div>
                  {hasTarget && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>คงเหลืออีก {Math.max(0, tdKpi.targetQty - tdKpi.totalQty).toLocaleString()} ชิ้น</div>}
                </div>
                <div style={{ position: 'relative', width: 140, height: 140, flexShrink: 0 }}>
                  <GaugeRing value={achievePct} color={hasTarget ? '#4d9fff' : 'var(--border)'} size={140} stroke={13} />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    {hasTarget ? (
                      <><div style={{ fontSize: 24, fontWeight: 900, color: '#4d9fff' }}>{achievePct}%</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>เทียบเป้าหมาย</div></>
                    ) : (
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textAlign: 'center', padding: '0 12px' }}>ไม่มีเป้า<br/>ให้เทียบ</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            ); })()}
          </div>

          {/* 1.2 Daily OEE chart */}
          <div style={s.section}>
            <div style={s.title}>1.2 OEE แสดงค่าของแต่ละวัน (10 วันล่าสุด)</div>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={tdHistoryGrouped} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted)' }} unit="%" />
                <Tooltip content={<OEETooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={tdTarget.oee} stroke="#22c55e" strokeDasharray="4 4" strokeWidth={1} label={{ value: `TARGET ${tdTarget.oee}%`, fill: '#22c55e', fontSize: 11, position: 'insideTopRight' }} />
                <Bar dataKey="oee" name="OEE %" fill="#22c55e" opacity={0.85} radius={[3, 3, 0, 0]}>
                  <LabelList dataKey="oee" position="top" formatter={v => v != null ? `${v}%` : ''} style={{ fontSize: 11, fill: 'var(--text)' }} />
                </Bar>
                <Line type="monotone" dataKey="a" name="A%" stroke="#22c55e" strokeWidth={1.5} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="p" name="P%" stroke="#f59e0b" strokeWidth={1.5} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="q" name="Q%" stroke="#a78bfa" strokeWidth={1.5} dot={{ r: 3 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* 2. Downtime — pareto bars สีตามประเภท (นอกแผนเด่น/ในแผนจาง) แทนโดนัทหลายสี + ตารางยาว */}
          <div style={s.section}>
            <div style={s.title}>2. DOWNTIME</div>
            <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '260px 1.5fr 1.2fr', gap: 14, alignItems: 'stretch' }}>

              {/* 2.1 Total — โชว์ "นอกแผน" เป็นตัวเลขหลัก (ความเสียหายจริง) · ในแผน (ไม่มีแผนผลิต/นับสต๊อก)
                  ไม่ใช่ loss ห้ามเอามาคิด % หลัก/โป่งตัวเลข (เคยโชว์รวม 5,512น. · 38.68% ทั้งที่ 4,684น. คือ
                  ไม่มีแผนผลิต — user: "ไม่มีแผนผลิตไม่ควรเป็นอันดับ1 นอกแผนสำคัญกว่า" 2026-07-15) */}
              <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 12 }}>2.1 Downtime นอกแผนของวันนี้</div>
                <div style={{ position: 'relative', width: 130, height: 130, margin: '2px auto 0' }}>
                  <GaugeRing value={tdKpi.totalShiftMin > 0 ? Math.min(100, tdDtByCause.unplannedMin / tdKpi.totalShiftMin * 100) : 0} color="#a855f7" size={130} stroke={11} />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 900, color: '#a855f7' }}>{tdDtByCause.unplannedMin.toLocaleString()}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>นาที · นอกแผน</div>
                  </div>
                </div>
                <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text2)', marginTop: 10 }}>
                  <b style={{ color: '#a855f7' }}>{tdKpi.totalShiftMin > 0 ? (tdDtByCause.unplannedMin / tdKpi.totalShiftMin * 100).toFixed(2) : '0.00'}%</b> ของเวลาผลิตทั้งหมด
                </div>
                {/* บริบท: รวมทั้งหมด + ในแผน (จาง 📅) — ให้เห็นภาพเต็มโดยไม่ให้ในแผนกลบตัวเลขหลัก */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 'auto', paddingTop: 12 }}>
                  <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>ในแผน 📅</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text2)' }}>{tdDtByCause.plannedMin.toLocaleString()} <span style={{ fontSize: 11, fontWeight: 600 }}>นาที</span></div>
                  </div>
                  <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>รวมทั้งหมด</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text2)' }}>{tdDtByCause.total.toLocaleString()} <span style={{ fontSize: 11, fontWeight: 600 }}>นาที</span></div>
                  </div>
                </div>
              </div>

              {/* 2.2 Pareto by cause */}
              <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>2.2 Downtime แยกตามสาเหตุ</div>
                  <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--muted)' }}>
                    <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#a855f7', marginRight: 4, verticalAlign: 'middle' }} />นอกแผน</span>
                    <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--muted2)', marginRight: 4, verticalAlign: 'middle' }} />ในแผน 📅</span>
                  </div>
                </div>
                {tdDtByCause.rows.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 13 }}>ไม่มีข้อมูล Downtime</div>
                ) : (() => {
                  const TOP_N = 8;
                  const shown = tdDtShowAll ? tdDtByCause.rows : tdDtByCause.rows.slice(0, TOP_N);
                  const rest = tdDtByCause.rows.slice(TOP_N);
                  const restMin = +rest.reduce((s, d) => s + d.min, 0).toFixed(1);
                  const restPct = +rest.reduce((s, d) => s + d.pct, 0).toFixed(1);
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {shown.map(d => {
                        const planned = d.category === 'planned';
                        return (
                          <div key={d.name} title={`${d.name} — ${d.min} นาที (${d.pct}%)`}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontSize: 12, marginBottom: 3 }}>
                              <span style={{ color: planned ? 'var(--muted)' : 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                                {d.name}{planned && <span style={{ marginLeft: 5, fontSize: 11 }}>📅</span>}
                              </span>
                              <span style={{ color: planned ? 'var(--muted)' : 'var(--text2)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                                <b style={{ color: planned ? 'var(--muted)' : 'var(--text)' }}>{d.min.toLocaleString()}</b> นาที · {d.pct}%
                              </span>
                            </div>
                            <div style={{ height: 7, borderRadius: 4, background: 'var(--bg3)', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${Math.max(1.5, d.barPct)}%`, background: planned ? 'var(--muted2)' : '#a855f7', borderRadius: 4 }} />
                            </div>
                          </div>
                        );
                      })}
                      {rest.length > 0 && (
                        <button onClick={() => setTdDtShowAll(v => !v)}
                          style={{ marginTop: 2, padding: '6px 10px', borderRadius: 7, border: '1px dashed var(--border2)', background: 'transparent', color: 'var(--muted)', fontSize: 11.5, cursor: 'pointer', textAlign: 'center' }}>
                          {tdDtShowAll ? '▲ ย่อเหลือ Top 8' : `▼ อื่นๆ อีก ${rest.length} สาเหตุ · ${restMin.toLocaleString()} นาที (${restPct}%)`}
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* 2.3 Top 10 by part */}
              <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 12 }}>2.3 Top 10 Downtime รายพาร์ท <span style={{ fontWeight: 500, fontSize: 11 }}>(เฉพาะนอกแผน)</span></div>
                {tdDtByPart.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 13 }}>ไม่มีข้อมูล</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {tdDtByPart.map((d, i) => (
                      <div key={d.mat} title={`${d.part} — ${d.min} นาที (${d.pct}%)`}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontSize: 12, marginBottom: 3 }}>
                          <span style={{ color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                            <span style={{ color: 'var(--muted)', fontWeight: 700, marginRight: 6, fontVariantNumeric: 'tabular-nums' }}>{i + 1}.</span>{d.part}
                          </span>
                          <span style={{ color: 'var(--text2)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                            <b style={{ color: 'var(--text)' }}>{d.min.toLocaleString()}</b> นาที · {d.pct}%
                          </span>
                        </div>
                        <div style={{ height: 7, borderRadius: 4, background: 'var(--bg3)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.max(1.5, d.barPct)}%`, background: '#a855f7', borderRadius: 4 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : viewTab === 'insight' ? (
        <OeeInsightPanel lines={linesFull} />
      ) : (
      <>
      {/* Filters */}
      <div style={{ ...s.section, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {['daily','monthly','yearly'].map(p => (
            <button key={p} style={s.tab(period === p)} onClick={() => setPeriod(p)}>
              {p === 'daily' ? 'รายวัน' : p === 'monthly' ? 'รายเดือน' : 'รายปี'}
            </button>
          ))}
        </div>
        <select style={s.sel} value={selLine} onChange={e => setSelLine(e.target.value)}>
          <option value="">ทุกไลน์</option>
          {/* Leaf lines (no parent, no children in session list) */}
          {lines.filter(l => !Object.values(parentChildrenMap).flat().includes(l) && !parentChildrenMap[l]).map(l => (
            <option key={l} value={l}>{l}</option>
          ))}
          {/* Parent lines: show as group + individual sub-lines */}
          {Object.entries(parentChildrenMap).filter(([p]) => lines.includes(p) || lines.some(l => parentChildrenMap[p]?.includes(l))).map(([parent, children]) => (
            <optgroup key={parent} label={`▸ ${parent}`}>
              <option value={parent}>{parent} (ทั้งหมด)</option>
              {children.filter(c => lines.includes(c)).map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <select style={s.sel} value={selShift} onChange={e => setSelShift(e.target.value)}>
          <option value="">ทุกกะ</option>
          <option value="day">กะเช้า</option>
          <option value="night">กะดึก</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={s.sel} />
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>ถึง</span>
        <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   style={s.sel} />
        <button onClick={loadData} style={{ ...s.tab(false), paddingLeft: 12, paddingRight: 12 }}>🔄 โหลด</button>
        {loading && <span style={{ fontSize: 12, color: 'var(--muted)' }}>กำลังโหลด...</span>}
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <KpiCard label="OEE เฉลี่ย"     value={kpi.oee} color={kpi.oee != null ? oeeColor(kpi.oee) : undefined} sub={`${kpi.sessions} กะ · เป้า ≥ ${trTarget.oee}%`} />
        <KpiCard label="Availability (A)" value={kpi.a}   color={kpi.a   != null ? aColor(kpi.a)   : undefined} sub={`เป้า ≥ ${trTarget.a}% · % เวลาที่เครื่องพร้อม`} />
        <KpiCard label="Performance (P)"  value={kpi.p}   color={kpi.p   != null ? pColor(kpi.p)   : undefined} sub={`เป้า ≥ ${trTarget.p}% · % ความเร็วผลิต`} />
        <KpiCard label="Quality (Q)"      value={kpi.q}   color={kpi.q   != null ? qColor(kpi.q)   : undefined} sub={`เป้า ≥ ${trTarget.q}% · % ชิ้นงานดี`} />
        <KpiCard label="ผลิตรวม" value={null} sub={`${kpi.total.toLocaleString()} ชิ้น`}
          color="var(--text)" />
      </div>

      {/* ── OOE / TEEP — ต่างจาก OEE ที่ "ฐานเวลา" · เห็นเวลาที่หายไปกับแผน/ไม่ได้เปิดกะ (2026-08-04) ── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16, alignItems: 'stretch' }}>
        <KpiCard label="OOE (Overall Operations Effectiveness)" value={kpi.ooe}
          color={kpi.ooe != null ? oeeColor(kpi.ooe) : undefined}
          sub="ฐาน = เวลากะทั้งหมด (รวมพัก + หยุดตามแผน)" />
        <KpiCard label="TEEP (Total Effective Equipment Performance)" value={kpi.teep}
          color={kpi.teep != null ? oeeColor(kpi.teep) : undefined}
          sub={`ฐาน = ปฏิทิน 24 ชม. · ${kpi.teepLines} ไลน์ × ${kpi.teepDays} วัน`} />
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px', flex: '2 1 320px', minWidth: 260 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>เวลาที่หายไปก่อนถึง OEE (ในกะ)</div>
          {kpi.shiftMinTotal > 0 ? (<>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5 }}>
              <span>☕ พักนโยบาย <b style={{ color: 'var(--text)' }}>{kpi.breakMinTotal.toLocaleString()}</b> น.</span>
              <span>🗓️ หยุดตามแผน <b style={{ color: '#f59e0b' }}>{kpi.plannedMinTotal.toLocaleString()}</b> น.</span>
              <span>= <b style={{ color: '#f59e0b' }}>{((kpi.breakMinTotal + kpi.plannedMinTotal) / kpi.shiftMinTotal * 100).toFixed(1)}%</b> ของเวลากะ</span>
            </div>
            {/* แถบสัดส่วน: เดินได้จริง (OEE) / เสียในเวลารับภาระ / พัก+หยุดตามแผน */}
            <div style={{ display: 'flex', height: 9, borderRadius: 5, overflow: 'hidden', background: 'var(--bg3)', marginTop: 9 }}>
              <div style={{ width: `${(kpi.ooe ?? 0)}%`, background: '#22c55e' }} title="เวลาที่สร้างของดีจริง" />
              <div style={{ width: `${Math.max(0, (kpi.netAvailMin / kpi.shiftMinTotal * 100) - (kpi.ooe ?? 0))}%`, background: '#a855f7' }} title="เสียในเวลารับภาระ (เครื่องเสีย/ช้า/ของเสีย)" />
              <div style={{ flex: 1, background: '#f59e0b' }} title="พักนโยบาย + หยุดตามแผน" />
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 6, lineHeight: 1.6 }}>
              🟩 สร้างของดี · 🟪 เสียตอนเดินเครื่อง · 🟧 พัก+หยุดตามแผน (OEE มองไม่เห็นส่วนนี้ — OOE เห็น)
            </div>
          </>) : <div style={{ fontSize: 12, color: 'var(--muted)' }}>ไม่มีข้อมูล</div>}
        </div>
      </div>

      {/* OEE Trend Chart */}
      <div style={s.section}>
        <div style={s.title}>แนวโน้ม OEE · A · P · Q</div>
        {grouped.length === 0
          ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>{loading ? 'กำลังโหลด...' : 'ไม่มีข้อมูล'}</div>
          : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={grouped} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted)' }} unit="%" />
                <Tooltip content={<OEETooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={trTarget.oee} stroke="#22c55e" strokeDasharray="4 4" strokeWidth={1} label={{ value: `TARGET ${trTarget.oee}%`, fill: '#22c55e', fontSize: 11 }} />
                <Line type="monotone" dataKey="oee" name="OEE" stroke="#4d9fff" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="a"   name="A%"  stroke="#22c55e" strokeWidth={1.5} dot={false} strokeDasharray="5 3" connectNulls />
                <Line type="monotone" dataKey="p"   name="P%"  stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="5 3" connectNulls />
                <Line type="monotone" dataKey="q"   name="Q%"  stroke="#a78bfa" strokeWidth={1.5} dot={false} strokeDasharray="5 3" connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )
        }
      </div>

      {/* Downtime Pareto + Defect side-by-side */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Downtime Pareto — ABC Analysis (ชื่อบนแกนเฉพาะกลุ่ม A · ที่เหลือดูที่ tooltip/ปุ่มขยาย) */}
        <ParetoAbcChart title="Pareto — Downtime รายประเภท (นาที)" records={dtRecords} dims={DT_DIMS} unit="นาที"
          emptyText="ไม่มีข้อมูล Downtime" sectionStyle={s.section} titleStyle={s.title} />

        {/* Quality Breakdown — ABC Analysis + เจาะลึก */}
        <ParetoAbcChart title="Pareto — ของเสียรายประเภท (ชิ้น)" records={defRecords} dims={DEF_DIMS} unit="ชิ้น"
          emptyText="ไม่มีข้อมูลของเสีย" sectionStyle={s.section} titleStyle={s.title} />
      </div>

      {/* A/P/Q Bar comparison by period */}
      <div style={s.section}>
        <div style={s.title}>เปรียบเทียบ A · P · Q</div>
        {grouped.length === 0
          ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>{loading ? 'กำลังโหลด...' : 'ไม่มีข้อมูล'}</div>
          : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={grouped} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted)' }} unit="%" />
                <Tooltip content={<OEETooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="a" name="A%" fill="#22c55e" opacity={0.8} radius={[2, 2, 0, 0]} />
                <Bar dataKey="p" name="P%" fill="#f59e0b" opacity={0.8} radius={[2, 2, 0, 0]} />
                <Bar dataKey="q" name="Q%" fill="#a78bfa" opacity={0.8} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )
        }
      </div>

      {/* Data Table */}
      <div style={s.section}>
        <div style={s.title}>ตารางสรุป</div>
        <div className="table-sticky" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--muted)' }}>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>ช่วงเวลา</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>กะ</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>ผลิตรวม</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>DT (นาที)</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>A%</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>P%</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Q%</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>OEE%</th>
              </tr>
            </thead>
            <tbody>
              {/* ตารางโชว์เฉพาะวันที่มีข้อมูลจริง — วันตอว่างที่เติมให้แกนกราฟต่อเนื่อง (empty) ไม่ต้องขึ้นเป็นแถว */}
              {grouped.filter(g => !g.empty).map((g, i) => (
                <tr key={g.key} style={{ borderBottom: '1px solid var(--border)', background: i % 2 ? 'var(--bg2)' : 'transparent' }}>
                  <td style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--text)' }}>{period === 'daily' ? g.key : g.label}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--muted)' }}>{g.count}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right' }}>{g.totalQty.toLocaleString()}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: g.unplannedMin > 60 ? '#ef4444' : 'var(--text)' }}>{g.unplannedMin.toLocaleString()}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: g.a != null ? aColor(g.a) : 'var(--muted)', fontWeight: 700 }}>{g.a ?? '—'}{g.a != null ? '%' : ''}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: g.p != null ? pColor(g.p) : 'var(--muted)', fontWeight: 700 }}>{g.p ?? '—'}{g.p != null ? '%' : ''}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: g.q != null ? qColor(g.q) : 'var(--muted)', fontWeight: 700 }}>{g.q ?? '—'}{g.q != null ? '%' : ''}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: g.oee != null ? oeeColor(g.oee) : 'var(--muted)', fontWeight: 900, fontSize: 14 }}>{g.oee ?? '—'}{g.oee != null ? '%' : ''}</td>
                </tr>
              ))}
              {grouped.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>{loading ? 'กำลังโหลด...' : 'ไม่มีข้อมูล'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {showTargetModal && canSetTarget && (
        <OeeTargetModal
          groups={allGroups}
          targets={oeeTargets}
          fullName={fullName}
          onClose={() => setShowTargetModal(false)}
          onSaved={() => { loadTargets(); setShowTargetModal(false); }}
        />
      )}

      {showReviewExport && canExportReview && (
        <Suspense fallback={null}>
          <MonthlyReviewExport onClose={() => setShowReviewExport(false)} />
        </Suspense>
      )}
    </div>
  );
}

/* ── Modal ตั้ง Target OEE/A/P/Q รายกรุ๊ป ─────────────────────────────
   เก็บเฉพาะระดับกรุ๊ปในตาราง oee_targets (Main) — ระดับ section เป็นค่าเฉลี่ยของกรุ๊ป
   คำนวณสดให้ดูในหัวข้อ section · ช่องว่าง = ไม่ตั้ง (ใช้ค่ามาตรฐาน และไม่ถูกนำไปเฉลี่ย)
   modal มีฟอร์ม → ห้ามปิดจากคลิก backdrop (UI-CONVENTIONS §5) */
function OeeTargetModal({ groups, targets, fullName, onClose, onSaved }) {
  // ตั้งได้เฉพาะ A/P/Q — OEE ไม่ใช่ช่องกรอก คำนวณจาก A×P×Q ให้อัตโนมัติ (ช่องว่างใช้ค่ามาตรฐานแทนในสูตร)
  const METRICS = [
    { key: 'target_a', label: 'A', def: TARGET.a },
    { key: 'target_p', label: 'P', def: TARGET.p },
    { key: 'target_q', label: 'Q', def: TARGET.q },
  ];
  const [draft, setDraft] = useState(() => {
    const d = {};
    groups.forEach(g => {
      const t = targets[g.name] || {};
      d[g.name] = { target_a: t.target_a ?? '', target_p: t.target_p ?? '', target_q: t.target_q ?? '' };
    });
    return d;
  });
  const [saving, setSaving] = useState(false);

  const setVal = (g, k, v) => setDraft(prev => ({ ...prev, [g]: { ...prev[g], [k]: v } }));

  const bySection = useMemo(() => {
    const m = {};
    groups.forEach(g => { const sec = g.section || '(ไม่ระบุส่วน)'; (m[sec] = m[sec] || []).push(g); });
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  }, [groups]);

  // OEE ของกรุ๊ปจาก draft = A×P×Q (metric ที่เว้นว่างใช้ค่ามาตรฐานในสูตร) — สูตรเดียวกับหน้า OEE
  const num = (v, def) => { const n = Number(v); return v !== '' && v != null && !isNaN(n) ? n : def; };
  const groupOee = (g) => {
    const d = draft[g.name] || {};
    return Math.round(num(d.target_a, TARGET.a) * num(d.target_p, TARGET.p) * num(d.target_q, TARGET.q) / 10000 * 10) / 10;
  };

  // ค่าเฉลี่ยระดับ section จาก draft (โชว์สด — ตรงกับที่หน้า OEE จะคำนวณตอนเลือก section)
  const secAvg = (list, key) => {
    const vals = list.map(g => draft[g.name]?.[key]).filter(v => v !== '' && v != null).map(Number).filter(v => !isNaN(v));
    return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 10) / 10 : null;
  };
  const secOee = (list) => {
    const vals = list.map(groupOee);
    return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 10) / 10 : null;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const toUpsert = [];
      const toDelete = [];
      for (const g of groups) {
        const d = draft[g.name];
        const nums = {};
        let hasAny = false, bad = false;
        for (const m of METRICS) {
          const raw = d[m.key];
          if (raw === '' || raw == null) { nums[m.key] = null; continue; }
          const n = Number(raw);
          if (isNaN(n) || n < 0 || n > 100) { bad = true; break; }
          nums[m.key] = n; hasAny = true;
        }
        if (bad) { toast.error(`ค่า target ของ ${g.name} ต้องเป็นตัวเลข 0–100`); setSaving(false); return; }
        if (hasAny) {
          // target_oee ไม่เก็บแล้ว (คำนวณจาก A×P×Q ในแอปเสมอ) — เขียน null ล้างค่าเก่าที่เคยกรอกไว้
          toUpsert.push({ group_name: g.name, ...nums, target_oee: null, updated_by: userData?.user?.id || null, updated_by_name: fullName || null, updated_at: new Date().toISOString() });
        } else if (targets[g.name]) {
          toDelete.push(g.name); // เคลียร์ทุกช่อง = ลบ target ของกรุ๊ป (กลับไปใช้ค่ามาตรฐาน)
        }
      }
      if (toUpsert.length) {
        const { error } = await supabase.from('oee_targets').upsert(toUpsert, { onConflict: 'group_name' });
        if (error) throw error;
      }
      if (toDelete.length) {
        const { error } = await supabase.from('oee_targets').delete().in('group_name', toDelete);
        if (error) throw error;
      }
      toast.success('บันทึก Target เรียบร้อย');
      onSaved();
    } catch (e) {
      toast.error('บันทึกไม่สำเร็จ: ' + e.message);
      setSaving(false);
    }
  };

  const inSt = { width: 64, padding: '4px 6px', borderRadius: 6, fontSize: 12, textAlign: 'right', background: 'var(--bg)', border: '1px solid var(--border2)', color: 'var(--text)' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 16 }}>
      <div style={{ background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)', width: 'min(96vw, 760px)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>🎯 ตั้ง Target A / P / Q รายกรุ๊ป — OEE = A×P×Q</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              ตั้งเฉพาะ A / P / Q — <strong>เป้า OEE คำนวณจาก A×P×Q ให้อัตโนมัติ</strong> · ระดับส่วน (section) ไม่ต้องตั้ง คำนวณเป็นค่าเฉลี่ยของกรุ๊ป · ช่องว่าง = ใช้ค่ามาตรฐาน (A {TARGET.a} / P {TARGET.p} / Q {TARGET.q} → OEE {TARGET.oee})
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '2px 9px', fontSize: 14, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 18px' }}>
          {bySection.map(([sec, list]) => (
            <div key={sec} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px dashed var(--border)' }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)' }}>{sec}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  เป้ารวมของส่วน (เฉลี่ยจากกรุ๊ป): {' '}
                  {METRICS.map(m => `${m.label} ${secAvg(list, m.key) ?? '—'}`).join(' · ')}
                  {' · '}<strong style={{ color: '#22c55e' }}>OEE {secOee(list) ?? '—'}</strong>
                </span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ fontSize: 11, color: 'var(--muted)' }}>
                    <th style={{ textAlign: 'left', padding: '6px 4px' }}>กรุ๊ป / ไลน์หลัก</th>
                    {METRICS.map(m => <th key={m.key} style={{ textAlign: 'right', padding: '6px 4px', width: 76 }}>{m.label} ≥ %</th>)}
                    <th style={{ textAlign: 'right', padding: '6px 4px', width: 90 }} title="คำนวณจาก A×P×Q อัตโนมัติ — ไม่ต้องกรอก">OEE = A×P×Q</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map(g => (
                    <tr key={g.name} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '5px 4px', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{g.name}</td>
                      {METRICS.map(m => (
                        <td key={m.key} style={{ padding: '5px 4px', textAlign: 'right' }}>
                          <input type="number" min="0" max="100" step="0.1" inputMode="decimal"
                            value={draft[g.name]?.[m.key] ?? ''}
                            onChange={e => setVal(g.name, m.key, e.target.value)}
                            placeholder={String(m.def)}
                            style={inSt} />
                        </td>
                      ))}
                      <td style={{ padding: '5px 4px', textAlign: 'right', fontSize: 13, fontWeight: 800, color: '#22c55e', whiteSpace: 'nowrap' }}>
                        {groupOee(g)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {!groups.length && <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีข้อมูลกรุ๊ปไลน์</div>}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 18px', borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}>ยกเลิก</button>
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? '⏳ กำลังบันทึก...' : '💾 บันทึก Target'}
          </button>
        </div>
      </div>
    </div>
  );
}
