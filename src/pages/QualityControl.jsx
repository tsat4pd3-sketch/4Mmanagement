/**
 * QualityControl — Quality Control Center (QA/QC)
 *
 * โมดูลควบคุมคุณภาพสำหรับงานประกันคุณภาพโรงงานผลิตชิ้นส่วนยานยนต์:
 *   1. Dashboard คุณภาพ — PPM / FTT / Pareto ของเสีย (อ่านจาก DR project ผ่าน supabaseDR)
 *   2. SPC / Cp-Cpk    — X̄-R chart, ค่า process capability ตาม AIAG SPC manual
 *   3. NCR             — ใบรายงานของเสีย + disposition workflow (open→containment→disposition→closed)
 *   4. CAPA / 8D       — corrective action D1-D8 + ติดตามกำหนดปิด + ตรวจประสิทธิผล
 *   5. เครื่องมือวัด    — ทะเบียน + กำหนดสอบเทียบ (แจ้งใกล้ครบกำหนด/เกินกำหนด)
 *
 * ตาราง qa_* อยู่ MAIN project (client `supabase`, authenticated + RLS has_perm)
 * ข้อมูลผลิต/ของเสียรายกะ อยู่ DR project (client `supabaseDR`, อ่านอย่างเดียว)
 * สิทธิ์: qa:record = บันทึกผลวัด/เปิด NCR/CAPA, qa:manage = master + disposition + ปิดรายการ
 */
import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import {
  ResponsiveContainer, ComposedChart, LineChart, BarChart, Line, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceLine, Cell, LabelList,
} from 'recharts';
import { supabase, supabaseDR } from '../supabaseClient';
import { toast } from '../components/Toast';
import { UserContext } from '../App';
import { usePerms } from '../utils/usePerms';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { inSectionScope } from '../utils/sectionScope';
import { nextDocNo } from '../utils/qaDocNo';
import QaCheckSheet from '../components/QaCheckSheet';

/* ── Date helpers (ห้ามใช้ toISOString() หา work date — ดู CLAUDE.md) ─────── */
function localDateStr(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function getWorkDate() {
  const now = new Date();
  if (now.getHours() < 8) { const y = new Date(now); y.setDate(y.getDate() - 1); return localDateStr(y); }
  return localDateStr(now);
}
function getCurrentShift() {
  const h = new Date().getHours();
  return (h >= 8 && h < 20) ? 'day' : 'night';
}
function daysAgoStr(n) { const d = new Date(); d.setDate(d.getDate() - n); return localDateStr(d); }
const fmtD = (s) => s ? new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';

/* ── SPC constants (AIAG SPC manual, subgroup size n = 2..10) ──────────────
   n=1 ใช้ I-MR chart: X limits = X̄ ± 2.66·MR̄ (E2), d2 = 1.128 */
const SPC_CONST = {
  1:  { A2: 2.660, D3: 0,     D4: 3.267, d2: 1.128 },
  2:  { A2: 1.880, D3: 0,     D4: 3.267, d2: 1.128 },
  3:  { A2: 1.023, D3: 0,     D4: 2.574, d2: 1.693 },
  4:  { A2: 0.729, D3: 0,     D4: 2.282, d2: 2.059 },
  5:  { A2: 0.577, D3: 0,     D4: 2.114, d2: 2.326 },
  6:  { A2: 0.483, D3: 0,     D4: 2.004, d2: 2.534 },
  7:  { A2: 0.419, D3: 0.076, D4: 1.924, d2: 2.704 },
  8:  { A2: 0.373, D3: 0.136, D4: 1.864, d2: 2.847 },
  9:  { A2: 0.337, D3: 0.184, D4: 1.816, d2: 2.970 },
  10: { A2: 0.308, D3: 0.223, D4: 1.777, d2: 3.078 },
};

const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const stddev = a => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

/**
 * คำนวณ control chart + capability จาก subgroup rows [{readings:[...], ...}]
 * คืน { points, xbarbar, rbar, uclX, lclX, uclR, lclR, sigmaWithin, sigmaOverall,
 *       cp, cpk, pp, ppk, all, n }
 */
function computeSPC(rows, char) {
  const n = char?.subgroup_size || 1;
  const c = SPC_CONST[Math.min(Math.max(n, 1), 10)];
  const groups = rows.map(r => (r.readings || []).map(Number).filter(v => Number.isFinite(v))).filter(g => g.length);
  if (!groups.length) return null;

  const all = groups.flat();
  const xbars = groups.map(g => mean(g));
  let ranges;
  if (n === 1) {
    // I-MR: moving range ระหว่างจุดติดกัน (จุดแรกไม่มี MR)
    ranges = xbars.map((v, i) => i === 0 ? null : Math.abs(v - xbars[i - 1]));
  } else {
    ranges = groups.map(g => Math.max(...g) - Math.min(...g));
  }
  const validRanges = ranges.filter(v => v != null);
  const xbarbar = mean(xbars);
  const rbar = mean(validRanges);
  const factor = n === 1 ? 2.660 : c.A2;
  const uclX = xbarbar + factor * (rbar ?? 0);
  const lclX = xbarbar - factor * (rbar ?? 0);
  const uclR = rbar != null ? c.D4 * rbar : null;
  const lclR = rbar != null ? c.D3 * rbar : null;
  const sigmaWithin = rbar != null && rbar > 0 ? rbar / c.d2 : null;
  const sigmaOverall = stddev(all);

  const usl = char?.usl != null ? Number(char.usl) : null;
  const lsl = char?.lsl != null ? Number(char.lsl) : null;
  const capa = (sigma) => {
    if (!sigma || sigma <= 0) return { cp: null, cpk: null };
    let cp = null, cpk = null;
    if (usl != null && lsl != null) cp = (usl - lsl) / (6 * sigma);
    const cpu = usl != null ? (usl - xbarbar) / (3 * sigma) : null;
    const cpl = lsl != null ? (xbarbar - lsl) / (3 * sigma) : null;
    if (cpu != null && cpl != null) cpk = Math.min(cpu, cpl);
    else cpk = cpu ?? cpl;
    return { cp, cpk };
  };
  const { cp, cpk } = capa(sigmaWithin);
  const { cp: pp, cpk: ppk } = capa(sigmaOverall);

  // จุดบนกราฟ + ตรวจกฎ: เกิน control limit / run 7 จุดข้างเดียวของ CL
  const points = groups.map((g, i) => ({
    idx: i + 1,
    xbar: +xbars[i].toFixed(4),
    range: ranges[i] != null ? +ranges[i].toFixed(4) : null,
    date: rows[i].work_date,
    oocX: xbars[i] > uclX || xbars[i] < lclX,
    oocR: ranges[i] != null && uclR != null && (ranges[i] > uclR || ranges[i] < lclR),
    run: false,
  }));
  let side = 0, runLen = 0;
  points.forEach(p => {
    const s = p.xbar > xbarbar ? 1 : p.xbar < xbarbar ? -1 : 0;
    if (s !== 0 && s === side) runLen += 1; else { side = s; runLen = 1; }
    if (runLen >= 7) p.run = true;
  });
  const oos = (usl != null || lsl != null)
    ? all.filter(v => (usl != null && v > usl) || (lsl != null && v < lsl)).length
    : 0;

  return {
    points, all, n, xbarbar, rbar, uclX, lclX, uclR, lclR,
    sigmaWithin, sigmaOverall, cp, cpk, pp, ppk, oos, usl, lsl,
  };
}

const cpkColor = v => v == null ? 'var(--muted)' : v >= 1.67 ? '#22c55e' : v >= 1.33 ? '#4d9fff' : v >= 1.0 ? '#f59e0b' : '#ef4444';
const cpkVerdict = v => v == null ? '—' : v >= 1.67 ? 'ดีเยี่ยม' : v >= 1.33 ? 'ผ่านเกณฑ์ (≥1.33)' : v >= 1.0 ? 'เฝ้าระวัง — ต่ำกว่า 1.33' : 'ไม่ผ่าน — ต้องแก้ไข process';
const fmtNum = (v, d = 3) => v == null || !Number.isFinite(v) ? '—' : Number(v).toFixed(d);

/* ── Shared UI atoms ────────────────────────────────────────────────────── */
const inputSt = {
  width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)',
};
const btnSt = (bg = 'var(--accent)', color = '#fff') => ({
  padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
  fontWeight: 700, fontSize: 13, background: bg, color,
});
const ghostBtn = {
  padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 12,
  background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)',
};
const cardSt = {
  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16,
};
const thSt = { padding: '7px 10px', textAlign: 'left', fontSize: 11, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border2)' };
const tdSt = { padding: '7px 10px', fontSize: 12.5, color: 'var(--text)', borderBottom: '1px solid var(--border)', verticalAlign: 'top' };

function Chip({ label, color }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      color, background: `${color}1f`, border: `1px solid ${color}55`, whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

function KpiCard({ label, value, sub, color = 'var(--text)' }) {
  return (
    <div style={{ ...cardSt, padding: '13px 16px', minWidth: 130, flex: '1 1 130px' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color, lineHeight: 1.1 }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Modal({ title, onClose, children, width = 560 }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '5vh 12px', overflowY: 'auto',
      }}
      /* ตั้งใจไม่ปิดเมื่อคลิกพื้นหลัง — กันเผลอกดแล้วข้อมูลในฟอร์มหาย ปิดได้จากปุ่ม ✕/ยกเลิกเท่านั้น */
    >
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 14,
        width: `min(${width}px, 96vw)`, boxShadow: 'var(--shadow-lg)', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: 18, overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, span }) {
  return (
    <div style={{ gridColumn: span ? '1 / -1' : undefined }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

/* running number เช่น NCR-202607-003 — ย้ายไป src/utils/qaDocNo.js (2026-08-04)
   ให้แท็บใบตรวจเรียกใช้ตัวเดียวกันได้โดยไม่เกิด circular import */

/* ════════════════════════════════════════════════════════════════════════
   TAB 1 — Dashboard คุณภาพ (PPM / FTT / Pareto จาก DR project)
   ════════════════════════════════════════════════════════════════════════ */
const RANGE_OPTS = [{ v: 7, label: '7 วัน' }, { v: 30, label: '30 วัน' }, { v: 90, label: '90 วัน' }];
const prodQty = o => o.qty_ok ?? o.qty_actual ?? o.qty ?? 0;   // ยอดผลิตจริงต่อใบงาน

function QualityDashboard() {
  const { role, lineId, sections } = useContext(UserContext);
  const [allLines, setAllLines] = useState([]);
  // ขอบเขตไลน์ของภาพรวมผลิต/ของเสีย: leader → เฉพาะครอบครัวไลน์ตัวเอง (ไม่ให้เห็นทั้งโรงงานจนงง) ·
  // role ที่ถูกจำกัด sections → เฉพาะส่วนงาน · qa/manager/admin (sections ว่าง) → ทั้งโรงงานเหมือนเดิม
  const scopedLineNames = useMemo(() => {
    if (role === 'leader' && lineId) {
      const myLine = allLines.find(l => String(l.id) === String(lineId));
      return myLine ? getLineFamilyNames(allLines, myLine.name) : [];
    }
    if (sections && sections.length) return allLines.filter(l => inSectionScope(sections, l.section)).map(l => l.name);
    return null; // ไม่จำกัด
  }, [role, lineId, sections, allLines]);
  useEffect(() => { supabase.from('production_lines').select('id, name, section, parent_line_name').then(({ data }) => setAllLines(data || [])); }, []);
  const [from, setFrom] = useState(() => daysAgoStr(30));
  const [to, setTo]     = useState(() => getWorkDate());
  const [lineFilter, setLineFilter] = useState('');    // '' = ทุกไลน์
  const [productFilter, setProductFilter] = useState(''); // '' = ทุก product (คีย์ = mat_no)
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [orders, setOrders] = useState([]);            // prod_orders ในช่วง (ต่อ product)
  const [defects, setDefects] = useState([]);
  const [ncrOpen, setNcrOpen] = useState(0);
  const [capaOverdue, setCapaOverdue] = useState(0);

  const setRange = (n) => { setFrom(daysAgoStr(n)); setTo(getWorkDate()); };

  const sessById = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions]);

  // กะที่แสดง (กรองไลน์) + product ที่อยู่ในกะเหล่านั้น
  const shownSessions = useMemo(
    () => lineFilter ? sessions.filter(s => s.line_name === lineFilter) : sessions,
    [sessions, lineFilter]
  );
  const shownSessIds = useMemo(() => new Set(shownSessions.map(s => s.id)), [shownSessions]);

  const lineOptions = useMemo(
    () => [...new Set(sessions.map(s => s.line_name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [sessions]
  );
  // ตัวเลือก product = mat_no ของใบงานในกะที่แสดง (label = ชื่อชิ้นงาน)
  const productOptions = useMemo(() => {
    const m = new Map();
    orders.forEach(o => {
      if (!shownSessIds.has(o.session_id)) return;
      const key = o.mat_no || o.part_name;
      if (key && !m.has(key)) m.set(key, o.part_name || o.mat_no);
    });
    return [...m.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [orders, shownSessIds]);

  // เปลี่ยนไลน์แล้ว product ที่เลือกไม่อยู่ในลิสต์ → ล้าง
  useEffect(() => {
    if (productFilter && !productOptions.some(p => p.key === productFilter)) setProductFilter('');
  }, [productOptions, productFilter]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      if (scopedLineNames && scopedLineNames.length === 0) { setSessions([]); setOrders([]); setDefects([]); setLoading(false); return; }
      let ssQ = supabaseDR.from('production_sessions')
        .select('id, work_date, line_name, shift, actual_qty, qty_ok, qty_ng, oee_q')
        .eq('status', 'closed').gte('work_date', from).lte('work_date', to);
      if (scopedLineNames) ssQ = ssQ.in('line_name', scopedLineNames);
      const { data: ss } = await ssQ.order('work_date');
      const ids = (ss || []).map(s => s.id);
      const [{ data: oo }, { data: dd }] = ids.length ? await Promise.all([
        supabaseDR.from('prod_orders').select('id, session_id, mat_no, part_name, qty, qty_ok, qty_actual').in('session_id', ids),
        supabaseDR.from('defect_logs').select('session_id, prod_order_id, qty_ng, qty_suspect, qty_repair, dr_defect_types(name_th, color)').in('session_id', ids),
      ]) : [{ data: [] }, { data: [] }];
      // นับ NCR ค้างให้ตรงกับ scope ของ leader (ตัวเลข KPI จะได้ตรงกับรายการในแท็บ NCR)
      let ncrCountQ = supabase.from('qa_ncr').select('id', { count: 'exact', head: true }).neq('status', 'closed');
      if (scopedLineNames) ncrCountQ = ncrCountQ.in('line_name', scopedLineNames);
      const [{ count: nOpen }, { data: capas }] = await Promise.all([
        ncrCountQ,
        supabase.from('qa_capa').select('id, due_date, status').neq('status', 'closed'),
      ]);
      if (!alive) return;
      setSessions(ss || []);
      setOrders(oo || []);
      setDefects(dd || []);
      setNcrOpen(nOpen || 0);
      const today = getWorkDate();
      setCapaOverdue((capas || []).filter(c => c.due_date && c.due_date < today).length);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [from, to, scopedLineNames]);

  const stat = useMemo(() => {
    const byDate = new Map(), byLine = new Map(), byType = new Map();
    const addDate = (k, t, g) => { const c = byDate.get(k) || { total: 0, ng: 0 }; c.total += t; c.ng += g; byDate.set(k, c); };
    const addLine = (k, t, g) => { const c = byLine.get(k) || { total: 0, ng: 0 }; c.total += t; c.ng += g; byLine.set(k, c); };
    const addType = (d) => {
      const name = d.dr_defect_types?.name_th || 'ไม่ระบุ';
      const cur = byType.get(name) || { qty: 0, color: d.dr_defect_types?.color || '#6b7280' };
      cur.qty += (d.qty_ng || 0) + (d.qty_suspect || 0); byType.set(name, cur);
    };
    let total = 0, ng = 0;

    if (productFilter) {
      // ── ระดับ product: ยอดผลิตจากใบงานของ product นั้น · NG จาก defect ที่ผูกใบงาน ──
      const oInScope = orders.filter(o => shownSessIds.has(o.session_id) && (o.mat_no || o.part_name) === productFilter);
      const orderIds = new Set(oInScope.map(o => o.id));
      oInScope.forEach(o => {
        const s = sessById.get(o.session_id); if (!s) return;
        const t = prodQty(o); total += t;
        addDate(s.work_date, t, 0); addLine(s.line_name || '—', t, 0);
      });
      defects.forEach(d => {
        if (!d.prod_order_id || !orderIds.has(d.prod_order_id)) return;
        const s = sessById.get(d.session_id); const g = d.qty_ng || 0; ng += g;
        if (s) { addDate(s.work_date, 0, g); addLine(s.line_name || '—', 0, g); }
        addType(d);
      });
    } else {
      // ── ระดับกะ (เดิม): actual_qty + qty_ng ของ session + defect logs ──
      const shownDefects = lineFilter ? defects.filter(d => shownSessIds.has(d.session_id)) : defects;
      // NG ยึด defect_logs เป็นหลัก (คอลัมน์ session.qty_ng คือ rollup ของ defect_logs ที่ stamp ตอนปิดกะ
      // — บวกทั้งสองเข้าด้วยกัน = นับซ้ำ 2 เท่า ทำให้ PPM สูงเกินจริง/FTT ต่ำเกินจริง · แก้ 2026-08-05)
      // นับ qty_suspect ด้วยให้ตรงกับพาเรโตในหน้าเดียวกัน + กฎ Q ที่ต้นทาง (computeOEE นับ suspect เป็นของเสีย)
      const defBySession = new Map();
      shownDefects.forEach(d => { defBySession.set(d.session_id, (defBySession.get(d.session_id) || 0) + (d.qty_ng || 0) + (d.qty_suspect || 0)); addType(d); });
      shownSessions.forEach(s => {
        const t = s.actual_qty || 0;
        const g = defBySession.has(s.id) ? defBySession.get(s.id) : (s.qty_ng || 0);
        total += t; ng += g;
        addDate(s.work_date, t, g); addLine(s.line_name || '—', t, g);
      });
    }

    const ppmTrend = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({ date: fmtD(date), ppm: (v.total + v.ng) ? Math.round(v.ng / (v.total + v.ng) * 1e6) : null, ng: v.ng }));
    const lineRows = [...byLine.entries()]
      .map(([line, v]) => ({ line, ng: v.ng, ppm: (v.total + v.ng) ? Math.round(v.ng / (v.total + v.ng) * 1e6) : 0 }))
      .sort((a, b) => b.ng - a.ng).slice(0, 12);
    let pareto = [...byType.entries()].map(([name, v]) => ({ name, qty: v.qty, color: v.color }))
      .filter(p => p.qty > 0).sort((a, b) => b.qty - a.qty).slice(0, 10);
    const paretoTotal = pareto.reduce((s, p) => s + p.qty, 0);
    let cum = 0;
    pareto = pareto.map(p => { cum += p.qty; return { ...p, cum: paretoTotal ? +(cum / paretoTotal * 100).toFixed(1) : 0 }; });
    return {
      total, ng,
      // total = ยอดสแกน = "ของดี" ล้วน · ผลิตจริงทั้งหมด = total + ng → PPM/FTT ต้องหารด้วยผลิตจริง ไม่ใช่ของดี
      // (กฎ Q "การ์ดที่สแกน=ของดีล้วน" 2026-08-02 · เดิม ng/total ทำ PPM สูงเกินจริง, (total−ng)/total ทำ FTT ต่ำเกินจริง)
      ppm: (total + ng) ? Math.round(ng / (total + ng) * 1e6) : null,
      ftt: (total + ng) ? +(total / (total + ng) * 100).toFixed(2) : null,
      ppmTrend, lineRows, pareto,
    };
  }, [shownSessions, shownSessIds, sessById, orders, defects, lineFilter, productFilter]);

  const dateSt = { ...inputSt, width: 148 };
  const activeRangeDays = useMemo(() => {
    if (to !== getWorkDate()) return null;
    const hit = RANGE_OPTS.find(o => daysAgoStr(o.v) === from);
    return hit ? hit.v : null;
  }, [from, to]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>ช่วงข้อมูล:</span>
        {RANGE_OPTS.map(o => (
          <button key={o.v} onClick={() => setRange(o.v)}
            style={{ ...ghostBtn, ...(activeRangeDays === o.v ? { background: 'var(--accent-dim)', color: 'var(--accent)', borderColor: 'var(--accent)' } : {}) }}>
            {o.label}
          </button>
        ))}
        <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} style={dateSt} />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>ถึง</span>
        <input type="date" value={to} min={from} max={getWorkDate()} onChange={e => setTo(e.target.value)} style={dateSt} />
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700, marginLeft: 6 }}>ไลน์:</span>
        <select value={lineFilter} onChange={e => setLineFilter(e.target.value)} style={{ ...inputSt, width: 'auto', minWidth: 150 }}>
          <option value="">ทุกไลน์ ({lineOptions.length})</option>
          {lineOptions.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>ชิ้นงาน:</span>
        <select value={productFilter} onChange={e => setProductFilter(e.target.value)} style={{ ...inputSt, width: 'auto', minWidth: 180, maxWidth: 280 }}>
          <option value="">ทุกชิ้นงาน ({productOptions.length})</option>
          {productOptions.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        {(lineFilter || productFilter) && <button style={ghostBtn} onClick={() => { setLineFilter(''); setProductFilter(''); }}>ล้างตัวกรอง</button>}
        {loading && <span style={{ fontSize: 12, color: 'var(--muted)' }}>กำลังโหลด…</span>}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <KpiCard label="ยอดผลิตรวม (ชิ้น)" value={stat.total.toLocaleString()}
          sub={productFilter ? `ชิ้นงาน: ${productOptions.find(p => p.key === productFilter)?.label || productFilter}` : `${shownSessions.length} กะที่ปิดแล้ว${lineFilter ? ` · ${lineFilter}` : ''}`} />
        <KpiCard label="ของเสียรวม (NG)" value={stat.ng.toLocaleString()} color={stat.ng > 0 ? '#ef4444' : '#22c55e'} />
        <KpiCard label="PPM" value={stat.ppm != null ? stat.ppm.toLocaleString() : '—'}
          color={stat.ppm == null ? undefined : stat.ppm <= 500 ? '#22c55e' : stat.ppm <= 3000 ? '#f59e0b' : '#ef4444'}
          sub="defective parts per million" />
        <KpiCard label="FTT (First Time Through)" value={stat.ftt != null ? `${stat.ftt}%` : '—'}
          color={stat.ftt == null ? undefined : stat.ftt >= 99 ? '#22c55e' : stat.ftt >= 97 ? '#f59e0b' : '#ef4444'} />
        <KpiCard label="NCR เปิดค้าง" value={ncrOpen} color={ncrOpen > 0 ? '#f59e0b' : '#22c55e'} sub="ยังไม่ปิดรายการ" />
        <KpiCard label="CAPA เกินกำหนด" value={capaOverdue} color={capaOverdue > 0 ? '#ef4444' : '#22c55e'} sub="เลย due date" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', gap: 14 }}>
        <div style={cardSt}>
          <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 10 }}>📈 แนวโน้ม PPM รายวัน</div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={stat.ppmTrend} margin={{ top: 6, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }} />
              <Line type="monotone" dataKey="ppm" name="PPM" stroke="#ef4444" strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={cardSt}>
          <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 10 }}>📊 Pareto ของเสียตามประเภท (NG + Suspect)</div>
          {stat.pareto.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 12, padding: 30, textAlign: 'center' }}>ไม่มีข้อมูลของเสียในช่วงนี้</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={stat.pareto} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted)' }} interval={0} angle={-18} textAnchor="end" height={52} />
                <YAxis yAxisId="l" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted)' }} unit="%" />
                <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }} />
                <Bar yAxisId="l" dataKey="qty" name="จำนวน (ชิ้น)" radius={[3, 3, 0, 0]}>
                  {stat.pareto.map((p, i) => <Cell key={i} fill={p.color} />)}
                </Bar>
                <Line yAxisId="r" type="monotone" dataKey="cum" name="สะสม %" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                <ReferenceLine yAxisId="r" y={80} stroke="#f59e0b" strokeDasharray="4 4" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        <div style={cardSt}>
          <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 10 }}>🏭 ของเสียรายไลน์ (Top 12)</div>
          {stat.lineRows.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 12, padding: 30, textAlign: 'center' }}>ไม่มีข้อมูล</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={stat.lineRows} margin={{ top: 14, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="line" tick={{ fontSize: 11, fill: 'var(--muted)' }} interval={0} angle={-18} textAnchor="end" height={52} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }}
                  formatter={(v, name) => [name === 'PPM' ? Number(v).toLocaleString() : v, name]} />
                <Bar dataKey="ng" name="NG (ชิ้น)" fill="#ef4444" opacity={0.85} radius={[3, 3, 0, 0]}>
                  <LabelList dataKey="ppm" position="top" formatter={v => v ? `${Number(v).toLocaleString()} ppm` : ''} style={{ fontSize: 11, fill: 'var(--muted)' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   TAB 2 — SPC / Process Capability
   ════════════════════════════════════════════════════════════════════════ */
const EMPTY_CHAR = { part_no: '', part_name: '', line_name: '', characteristic: '', unit: 'mm', nominal: '', usl: '', lsl: '', subgroup_size: 5, gauge: '', control_method: '' };

function SPCTab({ lines, canRecord, canManage }) {
  const { fullName } = useContext(UserContext);
  const [chars, setChars] = useState([]);
  const [selId, setSelId] = useState(null);
  const [rows, setRows] = useState([]);          // measurements ของ characteristic ที่เลือก
  const [limitN, setLimitN] = useState(25);      // จำนวน subgroup ล่าสุดที่ใช้คำนวณ
  const [charModal, setCharModal] = useState(null); // null | { ...form }
  const [readings, setReadings] = useState([]);  // ค่าที่กำลังกรอก
  const [loading, setLoading] = useState(false);

  const sel = chars.find(c => c.id === selId) || null;

  const loadChars = useCallback(async () => {
    const { data } = await supabase.from('qa_characteristics').select('*').order('part_no').order('characteristic');
    setChars(data || []);
    setSelId(prev => prev && (data || []).some(c => c.id === prev) ? prev : (data?.[0]?.id ?? null));
  }, []);
  useEffect(() => { loadChars(); }, [loadChars]);

  const loadRows = useCallback(async (charId, n) => {
    if (!charId) { setRows([]); return; }
    setLoading(true);
    const { data } = await supabase.from('qa_measurements')
      .select('id, work_date, shift, readings, operator_name, note, created_at')
      .eq('characteristic_id', charId)
      .order('work_date', { ascending: false }).order('created_at', { ascending: false })
      .limit(n);
    setRows((data || []).reverse()); // เรียงเก่า→ใหม่สำหรับกราฟ
    setLoading(false);
  }, []);
  useEffect(() => { loadRows(selId, limitN); }, [selId, limitN, loadRows]);

  useEffect(() => {
    setReadings(Array(sel?.subgroup_size || 1).fill(''));
  }, [selId, sel?.subgroup_size]);

  const spc = useMemo(() => sel ? computeSPC(rows, sel) : null, [rows, sel]);

  const hist = useMemo(() => {
    if (!spc || spc.all.length < 2) return [];
    const lo = Math.min(...spc.all, ...(spc.lsl != null ? [spc.lsl] : []));
    const hi = Math.max(...spc.all, ...(spc.usl != null ? [spc.usl] : []));
    if (hi <= lo) return [];
    const bins = 12, w = (hi - lo) / bins;
    const arr = Array.from({ length: bins }, (_, i) => ({
      x: +(lo + (i + 0.5) * w).toFixed(3), from: lo + i * w, to: lo + (i + 1) * w, count: 0,
    }));
    spc.all.forEach(v => {
      const i = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / w)));
      arr[i].count += 1;
    });
    return arr;
  }, [spc]);

  const saveChar = async () => {
    const f = charModal;
    if (!f.part_no.trim() || !f.characteristic.trim()) { toast.error('กรอก Part No. และชื่อจุดควบคุม'); return; }
    if (f.usl !== '' && f.lsl !== '' && Number(f.usl) <= Number(f.lsl)) { toast.error('USL ต้องมากกว่า LSL'); return; }
    const payload = {
      part_no: f.part_no.trim(), part_name: f.part_name.trim() || null, line_name: f.line_name || null,
      characteristic: f.characteristic.trim(), unit: f.unit.trim() || null,
      nominal: f.nominal === '' ? null : Number(f.nominal),
      usl: f.usl === '' ? null : Number(f.usl),
      lsl: f.lsl === '' ? null : Number(f.lsl),
      subgroup_size: Number(f.subgroup_size) || 1,
      gauge: f.gauge.trim() || null, control_method: f.control_method.trim() || null,
    };
    const { error } = f.id
      ? await supabase.from('qa_characteristics').update(payload).eq('id', f.id)
      : await supabase.from('qa_characteristics').insert({ ...payload, created_by: fullName || null });
    if (error) { toast.error(`บันทึกไม่สำเร็จ: ${error.message}`); return; }
    toast.success('บันทึกจุดควบคุมแล้ว ✓');
    setCharModal(null);
    loadChars();
  };

  const saveMeasurement = async () => {
    if (!sel) return;
    const vals = readings.map(v => Number(v));
    if (readings.some(v => v === '' || !Number.isFinite(Number(v)))) { toast.error(`กรอกค่าวัดให้ครบ ${sel.subgroup_size} ค่า`); return; }
    const { error } = await supabase.from('qa_measurements').insert({
      characteristic_id: sel.id, work_date: getWorkDate(), shift: getCurrentShift(),
      readings: vals, operator_name: fullName || null, created_by: fullName || null,
    });
    if (error) { toast.error(`บันทึกไม่สำเร็จ: ${error.message}`); return; }
    toast.success('บันทึกผลวัดแล้ว ✓');
    setReadings(Array(sel.subgroup_size).fill(''));
    loadRows(sel.id, limitN);
  };

  const delMeasurement = async (id) => {
    if (!window.confirm('ลบผลวัดชุดนี้?')) return;
    const { error } = await supabase.from('qa_measurements').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('ลบแล้ว');
    loadRows(selId, limitN);
  };

  const dot = (key) => (props) => {
    const { cx, cy, payload } = props;
    const bad = key === 'xbar' ? (payload.oocX || payload.run) : payload.oocR;
    return <circle key={props.index} cx={cx} cy={cy} r={bad ? 4.5 : 2.8} fill={bad ? '#ef4444' : '#4d9fff'} stroke={bad ? '#fff' : 'none'} strokeWidth={bad ? 1 : 0} />;
  };

  const violations = spc ? spc.points.filter(p => p.oocX || p.oocR || p.run) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* เลือกจุดควบคุม */}
      <div style={{ ...cardSt, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="จุดควบคุม (Part / Characteristic)">
          <select value={selId || ''} onChange={e => setSelId(e.target.value || null)} style={{ ...inputSt, minWidth: 'min(320px, 100%)' }}>
            {chars.length === 0 && <option value="">— ยังไม่มีจุดควบคุม กด "+ เพิ่มจุดควบคุม" —</option>}
            {chars.map(c => (
              <option key={c.id} value={c.id}>
                {c.part_no} · {c.characteristic}{c.unit ? ` (${c.unit})` : ''}{c.is_active ? '' : ' [ปิดใช้งาน]'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="ใช้ subgroup ล่าสุด">
          <select value={limitN} onChange={e => setLimitN(Number(e.target.value))} style={inputSt}>
            {[25, 50, 100].map(n => <option key={n} value={n}>{n} กลุ่ม</option>)}
          </select>
        </Field>
        {canManage && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btnSt()} onClick={() => setCharModal({ ...EMPTY_CHAR })}>+ เพิ่มจุดควบคุม</button>
            {sel && <button style={ghostBtn} onClick={() => setCharModal({
              ...sel,
              nominal: sel.nominal ?? '', usl: sel.usl ?? '', lsl: sel.lsl ?? '',
              part_name: sel.part_name || '', line_name: sel.line_name || '', unit: sel.unit || '',
              gauge: sel.gauge || '', control_method: sel.control_method || '',
            })}>✏️ แก้ไข</button>}
          </div>
        )}
      </div>

      {sel && (
        <>
          {/* สรุป spec + capability */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <KpiCard label="Spec" value={`${sel.lsl ?? '—'} / ${sel.nominal ?? '—'} / ${sel.usl ?? '—'}`} sub={`LSL / Nominal / USL ${sel.unit ? `(${sel.unit})` : ''} · n=${sel.subgroup_size}`} />
            <KpiCard label="Mean (X̄̄)" value={fmtNum(spc?.xbarbar)} sub={`σ within ${fmtNum(spc?.sigmaWithin, 4)} · σ overall ${fmtNum(spc?.sigmaOverall, 4)}`} />
            <KpiCard label="Cp" value={fmtNum(spc?.cp, 2)} color={cpkColor(spc?.cp)} />
            <KpiCard label="Cpk" value={fmtNum(spc?.cpk, 2)} color={cpkColor(spc?.cpk)} sub={cpkVerdict(spc?.cpk)} />
            <KpiCard label="Pp / Ppk" value={`${fmtNum(spc?.pp, 2)} / ${fmtNum(spc?.ppk, 2)}`} color={cpkColor(spc?.ppk)} sub="performance (overall σ)" />
            <KpiCard label="ค่าออกนอก Spec" value={spc ? `${spc.oos} / ${spc.all.length}` : '—'} color={spc?.oos ? '#ef4444' : '#22c55e'} sub="จำนวนค่าวัดเกิน USL/LSL" />
          </div>

          {violations.length > 0 && (
            <div style={{ ...cardSt, borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.06)' }}>
              <div style={{ fontWeight: 800, fontSize: 13, color: '#ef4444', marginBottom: 4 }}>⚠️ พบสัญญาณผิดปกติบน control chart {violations.length} จุด</div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                {violations.slice(0, 6).map(p =>
                  `กลุ่ม #${p.idx} (${fmtD(p.date)}): ${[p.oocX && 'X̄ เกิน control limit', p.oocR && 'R เกิน control limit', p.run && 'run ≥7 จุดข้างเดียวของ CL'].filter(Boolean).join(', ')}`
                ).join(' · ')}{violations.length > 6 ? ` · และอีก ${violations.length - 6} จุด` : ''}
                {' — ตรวจสอบ process แล้วบันทึก NCR/CAPA หากยืนยันความผิดปกติ'}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))', gap: 14 }}>
            {/* X-bar chart */}
            <div style={cardSt}>
              <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 8 }}>{sel.subgroup_size === 1 ? '📉 Individuals (I) Chart' : '📉 X̄ Chart'}</div>
              {spc ? (
                <ResponsiveContainer width="100%" height={230}>
                  <LineChart data={spc.points} margin={{ top: 6, right: 42, left: -4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="idx" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                    <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={v => Number(v).toFixed(2)} />
                    <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }}
                      labelFormatter={i => `กลุ่ม #${i}`} />
                    <ReferenceLine y={spc.uclX} stroke="#ef4444" strokeDasharray="5 3" label={{ value: `UCL ${fmtNum(spc.uclX)}`, fontSize: 11, fill: '#ef4444', position: 'right' }} />
                    <ReferenceLine y={spc.xbarbar} stroke="#22c55e" label={{ value: `CL ${fmtNum(spc.xbarbar)}`, fontSize: 11, fill: '#22c55e', position: 'right' }} />
                    <ReferenceLine y={spc.lclX} stroke="#ef4444" strokeDasharray="5 3" label={{ value: `LCL ${fmtNum(spc.lclX)}`, fontSize: 11, fill: '#ef4444', position: 'right' }} />
                    {spc.usl != null && <ReferenceLine y={spc.usl} stroke="#f59e0b" strokeDasharray="2 3" label={{ value: 'USL', fontSize: 11, fill: '#f59e0b', position: 'right' }} />}
                    {spc.lsl != null && <ReferenceLine y={spc.lsl} stroke="#f59e0b" strokeDasharray="2 3" label={{ value: 'LSL', fontSize: 11, fill: '#f59e0b', position: 'right' }} />}
                    <Line type="monotone" dataKey="xbar" name={sel.subgroup_size === 1 ? 'X' : 'X̄'} stroke="#4d9fff" strokeWidth={2} dot={dot('xbar')} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <div style={{ color: 'var(--muted)', fontSize: 12, padding: 30, textAlign: 'center' }}>{loading ? 'กำลังโหลด…' : 'ยังไม่มีผลวัด'}</div>}
            </div>

            {/* R chart */}
            <div style={cardSt}>
              <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 8 }}>{sel.subgroup_size === 1 ? '📉 Moving Range (MR) Chart' : '📉 R Chart'}</div>
              {spc ? (
                <ResponsiveContainer width="100%" height={230}>
                  <LineChart data={spc.points} margin={{ top: 6, right: 42, left: -4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="idx" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                    <YAxis domain={[0, 'auto']} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={v => Number(v).toFixed(2)} />
                    <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }}
                      labelFormatter={i => `กลุ่ม #${i}`} />
                    {spc.uclR != null && <ReferenceLine y={spc.uclR} stroke="#ef4444" strokeDasharray="5 3" label={{ value: `UCL ${fmtNum(spc.uclR)}`, fontSize: 11, fill: '#ef4444', position: 'right' }} />}
                    {spc.rbar != null && <ReferenceLine y={spc.rbar} stroke="#22c55e" label={{ value: `CL ${fmtNum(spc.rbar)}`, fontSize: 11, fill: '#22c55e', position: 'right' }} />}
                    <Line type="monotone" dataKey="range" name="R" stroke="#a78bfa" strokeWidth={2} dot={dot('range')} isAnimationActive={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              ) : <div style={{ color: 'var(--muted)', fontSize: 12, padding: 30, textAlign: 'center' }}>—</div>}
            </div>

            {/* Histogram */}
            <div style={cardSt}>
              <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 8 }}>📊 Histogram เทียบ Spec</div>
              {hist.length ? (
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={hist} margin={{ top: 6, right: 12, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="x" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                    <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }}
                      formatter={(v) => [v, 'จำนวนค่า']}
                      labelFormatter={(x, p) => p?.[0] ? `${fmtNum(p[0].payload.from, 3)} – ${fmtNum(p[0].payload.to, 3)}` : x} />
                    <Bar dataKey="count" name="จำนวนค่า" radius={[3, 3, 0, 0]}>
                      {hist.map((b, i) => {
                        const bad = (spc.usl != null && b.from >= spc.usl) || (spc.lsl != null && b.to <= spc.lsl);
                        return <Cell key={i} fill={bad ? '#ef4444' : '#4d9fff'} opacity={0.85} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <div style={{ color: 'var(--muted)', fontSize: 12, padding: 30, textAlign: 'center' }}>ต้องมีผลวัดอย่างน้อย 2 ค่า</div>}
            </div>

            {/* บันทึกผลวัด + ตาราง */}
            <div style={cardSt}>
              <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 8 }}>✍️ บันทึกผลวัด (subgroup ใหม่ · n={sel.subgroup_size})</div>
              {canRecord ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
                  {readings.map((v, i) => (
                    <input key={i} type="number" step="any" value={v} placeholder={`ค่า ${i + 1}`}
                      onChange={e => setReadings(r => r.map((x, j) => j === i ? e.target.value : x))}
                      style={{ ...inputSt, width: 86 }} />
                  ))}
                  <button style={btnSt()} onClick={saveMeasurement}>บันทึก</button>
                </div>
              ) : <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>คุณไม่มีสิทธิ์บันทึกผลวัด (qa:record)</div>}

              <div style={{ maxHeight: 250, overflowY: 'auto', overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: 460, borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={thSt}>วันที่</th><th style={thSt}>กะ</th><th style={thSt}>ค่าวัด</th>
                    <th style={thSt}>X̄</th><th style={thSt}>ผู้วัด</th>{canManage && <th style={thSt}></th>}
                  </tr></thead>
                  <tbody>
                    {[...rows].reverse().map(r => {
                      const vals = (r.readings || []).map(Number);
                      return (
                        <tr key={r.id}>
                          <td style={tdSt}>{fmtD(r.work_date)}</td>
                          <td style={tdSt}>{r.shift === 'night' ? '🌙' : '☀️'}</td>
                          <td style={{ ...tdSt, fontFamily: 'monospace', fontSize: 11.5 }}>{vals.join(', ')}</td>
                          <td style={{ ...tdSt, fontWeight: 700 }}>{fmtNum(mean(vals))}</td>
                          <td style={tdSt}>{r.operator_name || '—'}</td>
                          {canManage && <td style={tdSt}>
                            <button className="tbtn" onClick={() => delMeasurement(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 12 }}>🗑</button>
                          </td>}
                        </tr>
                      );
                    })}
                    {rows.length === 0 && <tr><td style={tdSt} colSpan={6}><span style={{ color: 'var(--muted)' }}>ยังไม่มีผลวัด</span></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {charModal && (
        <Modal title={charModal.id ? '✏️ แก้ไขจุดควบคุม' : '➕ เพิ่มจุดควบคุม SPC'} onClose={() => setCharModal(null)}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Part No. *"><input style={inputSt} value={charModal.part_no} onChange={e => setCharModal(f => ({ ...f, part_no: e.target.value }))} /></Field>
            <Field label="Part Name"><input style={inputSt} value={charModal.part_name} onChange={e => setCharModal(f => ({ ...f, part_name: e.target.value }))} /></Field>
            <Field label="จุดควบคุม / Characteristic *" span><input style={inputSt} placeholder="เช่น ความกว้างร่อง A หลังตัด" value={charModal.characteristic} onChange={e => setCharModal(f => ({ ...f, characteristic: e.target.value }))} /></Field>
            <Field label="ไลน์ผลิต">
              <select style={inputSt} value={charModal.line_name} onChange={e => setCharModal(f => ({ ...f, line_name: e.target.value }))}>
                <option value="">— ไม่ระบุ —</option>
                {lines.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
            <Field label="หน่วย"><input style={inputSt} value={charModal.unit} onChange={e => setCharModal(f => ({ ...f, unit: e.target.value }))} /></Field>
            <Field label="LSL"><input style={inputSt} type="number" step="any" value={charModal.lsl} onChange={e => setCharModal(f => ({ ...f, lsl: e.target.value }))} /></Field>
            <Field label="Nominal"><input style={inputSt} type="number" step="any" value={charModal.nominal} onChange={e => setCharModal(f => ({ ...f, nominal: e.target.value }))} /></Field>
            <Field label="USL"><input style={inputSt} type="number" step="any" value={charModal.usl} onChange={e => setCharModal(f => ({ ...f, usl: e.target.value }))} /></Field>
            <Field label="ขนาด subgroup (n)">
              <select style={inputSt} value={charModal.subgroup_size} onChange={e => setCharModal(f => ({ ...f, subgroup_size: e.target.value }))}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n}{n === 1 ? ' (I-MR)' : ''}</option>)}
              </select>
            </Field>
            <Field label="เครื่องมือวัด"><input style={inputSt} placeholder="เช่น Vernier VC-001" value={charModal.gauge} onChange={e => setCharModal(f => ({ ...f, gauge: e.target.value }))} /></Field>
            <Field label="อ้างอิง Control Plan" span><input style={inputSt} placeholder="เช่น CP-HDF-001 ข้อ 12" value={charModal.control_method} onChange={e => setCharModal(f => ({ ...f, control_method: e.target.value }))} /></Field>
            {charModal.id && (
              <Field label="สถานะ">
                <select style={inputSt} value={charModal.is_active ? '1' : '0'} onChange={e => setCharModal(f => ({ ...f, is_active: e.target.value === '1' }))}>
                  <option value="1">ใช้งาน</option><option value="0">ปิดใช้งาน</option>
                </select>
              </Field>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button style={ghostBtn} onClick={() => setCharModal(null)}>ยกเลิก</button>
            <button style={btnSt()} onClick={saveChar}>บันทึก</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   TAB 3 — NCR (Nonconformance Report)
   ════════════════════════════════════════════════════════════════════════ */
const NCR_STATUS = {
  open:        { label: 'เปิดใหม่',        color: '#ef4444' },
  containment: { label: 'กักกันแล้ว',      color: '#f59e0b' },
  disposition: { label: 'ตัดสินแล้ว',      color: '#4d9fff' },
  closed:      { label: 'ปิดรายการ',       color: '#22c55e' },
};
const NCR_SOURCE = { incoming: 'รับเข้า (Incoming)', inprocess: 'ในกระบวนการ', final: 'ตรวจสุดท้าย (Final)', customer: 'ลูกค้าเคลม' };
const NCR_SEV = { minor: { label: 'Minor', color: '#4d9fff' }, major: { label: 'Major', color: '#f59e0b' }, critical: { label: 'Critical', color: '#ef4444' } };
const DISPO = { use_as_is: 'ใช้ตามสภาพ (Use as-is)', rework: 'ซ่อมแก้ (Rework)', sort: 'คัดแยก (Sort)', scrap: 'ทำลาย (Scrap)', return_supplier: 'คืน Supplier' };
const EMPTY_NCR = { report_date: '', line_name: '', part_no: '', part_name: '', source: 'inprocess', severity: 'minor', defect_desc: '', qty_found: '', qty_ng: '' };

function NCRTab({ lines, canRecord, canManage, onOpenCapa }) {
  const { fullName, role, lineId, sections } = useContext(UserContext);
  const [list, setList] = useState([]);
  const [filter, setFilter] = useState('active'); // active | all | closed
  const [createModal, setCreateModal] = useState(null);
  const [detail, setDetail] = useState(null);   // NCR ที่เปิดดู
  const [edit, setEdit] = useState({});          // field แก้ไขใน detail
  const [allLines, setAllLines] = useState([]);

  // leader → เห็น NCR เฉพาะครอบครัวไลน์ตัวเอง · role จำกัด sections → เฉพาะส่วนงาน · qa/mgr/admin → ทั้งหมด
  const scopedLineNames = useMemo(() => {
    if (role === 'leader' && lineId) {
      const myLine = allLines.find(l => String(l.id) === String(lineId));
      return myLine ? getLineFamilyNames(allLines, myLine.name) : [];
    }
    if (sections && sections.length) return allLines.filter(l => inSectionScope(sections, l.section)).map(l => l.name);
    return null;
  }, [role, lineId, sections, allLines]);
  useEffect(() => { supabase.from('production_lines').select('id, name, section, parent_line_name').then(({ data }) => setAllLines(data || [])); }, []);

  const load = useCallback(async () => {
    if (scopedLineNames && scopedLineNames.length === 0) { setList([]); return; }
    let q = supabase.from('qa_ncr').select('*').order('created_at', { ascending: false }).limit(300);
    if (filter === 'active') q = q.neq('status', 'closed');
    if (filter === 'closed') q = q.eq('status', 'closed');
    if (scopedLineNames) q = q.in('line_name', scopedLineNames);   // จำกัดตามไลน์ของ leader
    const { data } = await q;
    setList(data || []);
  }, [filter, scopedLineNames]);
  useEffect(() => { load(); }, [load]);

  const createNCR = async () => {
    const f = createModal;
    if (!f.defect_desc.trim()) { toast.error('กรอกรายละเอียดของเสีย'); return; }
    const ncr_no = await nextDocNo('qa_ncr', 'ncr_no', 'NCR');
    const { error } = await supabase.from('qa_ncr').insert({
      ncr_no, report_date: f.report_date || getWorkDate(),
      line_name: f.line_name || null, part_no: f.part_no.trim() || null, part_name: f.part_name.trim() || null,
      source: f.source, severity: f.severity, defect_desc: f.defect_desc.trim(),
      qty_found: parseInt(f.qty_found) || 0, qty_ng: parseInt(f.qty_ng) || 0,
      created_by: fullName || null,
    });
    if (error) { toast.error(`สร้าง NCR ไม่สำเร็จ: ${error.message}`); return; }
    toast.success(`เปิด ${ncr_no} แล้ว ✓`);
    setCreateModal(null);
    load();
  };

  const updateNCR = async (id, patch, msg) => {
    const { error } = await supabase.from('qa_ncr').update(patch).eq('id', id);
    if (error) { toast.error(error.message); return false; }
    toast.success(msg);
    await load();
    const { data } = await supabase.from('qa_ncr').select('*').eq('id', id).single();
    setDetail(data);
    return true;
  };

  const openDetail = (n) => {
    setDetail(n);
    setEdit({ containment: n.containment || '', root_cause: n.root_cause || '', disposition: n.disposition || '', disposition_note: n.disposition_note || '' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {[['active', 'ค้างดำเนินการ'], ['closed', 'ปิดแล้ว'], ['all', 'ทั้งหมด']].map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)}
            style={{ ...ghostBtn, ...(filter === v ? { background: 'var(--accent-dim)', color: 'var(--accent)', borderColor: 'var(--accent)' } : {}) }}>{l}</button>
        ))}
        <div style={{ flex: 1 }} />
        {canRecord && <button style={btnSt('#ef4444')} onClick={() => setCreateModal({ ...EMPTY_NCR, report_date: getWorkDate() })}>🚨 เปิด NCR ใหม่</button>}
      </div>

      <div className="table-sticky" style={{ ...cardSt, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead><tr>
            <th style={thSt}>เลขที่</th><th style={thSt}>วันที่</th><th style={thSt}>ไลน์</th><th style={thSt}>Part</th>
            <th style={thSt}>ปัญหา</th><th style={thSt}>NG</th><th style={thSt}>ที่มา</th><th style={thSt}>ระดับ</th><th style={thSt}>สถานะ</th>
          </tr></thead>
          <tbody>
            {list.map(n => (
              <tr key={n.id} onClick={() => openDetail(n)} style={{ cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ ...tdSt, fontWeight: 700, whiteSpace: 'nowrap' }}>{n.ncr_no}</td>
                <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>{fmtD(n.report_date)}</td>
                <td style={tdSt}>{n.line_name || '—'}</td>
                <td style={tdSt}>{n.part_no || '—'}</td>
                <td style={{ ...tdSt, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.defect_desc}</td>
                <td style={{ ...tdSt, fontWeight: 700, color: n.qty_ng ? '#ef4444' : undefined }}>{n.qty_ng}</td>
                <td style={tdSt}>{NCR_SOURCE[n.source] || n.source}</td>
                <td style={tdSt}><Chip label={NCR_SEV[n.severity]?.label || n.severity} color={NCR_SEV[n.severity]?.color || '#6b7280'} /></td>
                <td style={tdSt}><Chip label={NCR_STATUS[n.status]?.label || n.status} color={NCR_STATUS[n.status]?.color || '#6b7280'} /></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td style={tdSt} colSpan={9}><span style={{ color: 'var(--muted)' }}>ไม่มีรายการ</span></td></tr>}
          </tbody>
        </table>
      </div>

      {createModal && (
        <Modal title="🚨 เปิด NCR ใหม่" onClose={() => setCreateModal(null)} width={960}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="วันที่พบ"><input type="date" style={inputSt} value={createModal.report_date} onChange={e => setCreateModal(f => ({ ...f, report_date: e.target.value }))} /></Field>
            <Field label="ไลน์ผลิต">
              <select style={inputSt} value={createModal.line_name} onChange={e => setCreateModal(f => ({ ...f, line_name: e.target.value }))}>
                <option value="">— ไม่ระบุ —</option>
                {(scopedLineNames ? lines.filter(l => scopedLineNames.includes(l)) : lines).map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
            <Field label="Part No."><input style={inputSt} value={createModal.part_no} onChange={e => setCreateModal(f => ({ ...f, part_no: e.target.value }))} /></Field>
            <Field label="Part Name"><input style={inputSt} value={createModal.part_name} onChange={e => setCreateModal(f => ({ ...f, part_name: e.target.value }))} /></Field>
            <Field label="ที่มา">
              <select style={inputSt} value={createModal.source} onChange={e => setCreateModal(f => ({ ...f, source: e.target.value }))}>
                {Object.entries(NCR_SOURCE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="ระดับความรุนแรง">
              <select style={inputSt} value={createModal.severity} onChange={e => setCreateModal(f => ({ ...f, severity: e.target.value }))}>
                {Object.entries(NCR_SEV).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="จำนวนที่ตรวจพบ/กักกัน (ชิ้น)"><input type="number" style={inputSt} value={createModal.qty_found} onChange={e => setCreateModal(f => ({ ...f, qty_found: e.target.value }))} /></Field>
            <Field label="จำนวน NG (ชิ้น)"><input type="number" style={inputSt} value={createModal.qty_ng} onChange={e => setCreateModal(f => ({ ...f, qty_ng: e.target.value }))} /></Field>
            <Field label="รายละเอียดของเสีย / สิ่งที่ไม่เป็นไปตามข้อกำหนด *" span>
              <textarea rows={3} style={{ ...inputSt, resize: 'vertical' }} value={createModal.defect_desc} onChange={e => setCreateModal(f => ({ ...f, defect_desc: e.target.value }))} />
            </Field>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button style={ghostBtn} onClick={() => setCreateModal(null)}>ยกเลิก</button>
            <button style={btnSt('#ef4444')} onClick={createNCR}>เปิด NCR</button>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal title={`📄 ${detail.ncr_no}`} onClose={() => setDetail(null)} width={640}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <Chip label={NCR_STATUS[detail.status]?.label || detail.status} color={NCR_STATUS[detail.status]?.color || '#6b7280'} />
            <Chip label={NCR_SEV[detail.severity]?.label || detail.severity} color={NCR_SEV[detail.severity]?.color || '#6b7280'} />
            <Chip label={NCR_SOURCE[detail.source] || detail.source} color="#a78bfa" />
          </div>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13, marginBottom: 12 }}>
            <div><b>วันที่พบ:</b> {fmtD(detail.report_date)}</div>
            <div><b>ไลน์:</b> {detail.line_name || '—'}</div>
            <div><b>Part:</b> {detail.part_no || '—'} {detail.part_name || ''}</div>
            <div><b>พบ/NG:</b> {detail.qty_found} / <span style={{ color: '#ef4444', fontWeight: 700 }}>{detail.qty_ng}</span> ชิ้น</div>
            <div style={{ gridColumn: '1 / -1' }}><b>ปัญหา:</b> {detail.defect_desc}</div>
            <div style={{ gridColumn: '1 / -1', color: 'var(--muted)', fontSize: 11.5 }}>เปิดโดย {detail.created_by || '—'}{detail.closed_at ? ` · ปิดเมื่อ ${fmtD(detail.closed_at.slice(0, 10))} โดย ${detail.closed_by || '—'}` : ''}</div>
          </div>

          {detail.status !== 'closed' && canRecord ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="1) มาตรการกักกันชั่วคราว (Containment)">
                <textarea rows={2} style={{ ...inputSt, resize: 'vertical' }} value={edit.containment} onChange={e => setEdit(x => ({ ...x, containment: e.target.value }))} />
              </Field>
              <Field label="2) สาเหตุเบื้องต้น (Root Cause)">
                <textarea rows={2} style={{ ...inputSt, resize: 'vertical' }} value={edit.root_cause} onChange={e => setEdit(x => ({ ...x, root_cause: e.target.value }))} />
              </Field>
              {canManage && (
                <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="3) Disposition (เฉพาะ qa:manage)">
                    <select style={inputSt} value={edit.disposition} onChange={e => setEdit(x => ({ ...x, disposition: e.target.value }))}>
                      <option value="">— เลือก —</option>
                      {Object.entries(DISPO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </Field>
                  <Field label="หมายเหตุ disposition">
                    <input style={inputSt} value={edit.disposition_note} onChange={e => setEdit(x => ({ ...x, disposition_note: e.target.value }))} />
                  </Field>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button style={ghostBtn} onClick={() => onOpenCapa(detail)}>🛠 เปิด 8D CAPA จาก NCR นี้</button>
                <button style={btnSt('#f59e0b')} onClick={() => {
                  if (!edit.containment.trim()) { toast.error('กรอกมาตรการกักกันก่อน'); return; }
                  updateNCR(detail.id, {
                    containment: edit.containment.trim(), root_cause: edit.root_cause.trim() || null,
                    status: detail.status === 'open' ? 'containment' : detail.status,
                  }, 'บันทึกมาตรการกักกันแล้ว ✓');
                }}>บันทึกกักกัน</button>
                {canManage && (
                  <>
                    <button style={btnSt('#4d9fff')} onClick={() => {
                      if (!edit.disposition) { toast.error('เลือก disposition ก่อน'); return; }
                      updateNCR(detail.id, {
                        containment: edit.containment.trim() || null, root_cause: edit.root_cause.trim() || null,
                        disposition: edit.disposition, disposition_note: edit.disposition_note.trim() || null,
                        disposition_by: fullName || null, status: 'disposition',
                      }, 'บันทึก disposition แล้ว ✓');
                    }}>บันทึก Disposition</button>
                    <button style={btnSt('#22c55e')} onClick={() => {
                      if (!detail.disposition && !edit.disposition) { toast.error('ต้องมี disposition ก่อนปิดรายการ'); return; }
                      updateNCR(detail.id, {
                        status: 'closed', closed_at: new Date().toISOString(), closed_by: fullName || null,
                        ...(edit.disposition ? { disposition: edit.disposition, disposition_note: edit.disposition_note.trim() || null, disposition_by: fullName || null } : {}),
                        containment: edit.containment.trim() || null, root_cause: edit.root_cause.trim() || null,
                      }, `ปิด ${detail.ncr_no} แล้ว ✓`);
                    }}>✅ ปิด NCR</button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              <div><b>กักกัน:</b> {detail.containment || '—'}</div>
              <div><b>Root cause:</b> {detail.root_cause || '—'}</div>
              <div><b>Disposition:</b> {DISPO[detail.disposition] || '—'} {detail.disposition_note ? `(${detail.disposition_note})` : ''} {detail.disposition_by ? `· โดย ${detail.disposition_by}` : ''}</div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   TAB 4 — CAPA / 8D
   ════════════════════════════════════════════════════════════════════════ */
const CAPA_STATUS = {
  open:        { label: 'เปิดใหม่',          color: '#ef4444' },
  in_progress: { label: 'กำลังดำเนินการ',    color: '#f59e0b' },
  verify:      { label: 'รอตรวจประสิทธิผล',  color: '#4d9fff' },
  closed:      { label: 'ปิดแล้ว',            color: '#22c55e' },
};
const D_FIELDS = [
  ['d1_team',        'D1 — ทีมงาน (Team)'],
  ['d2_problem',     'D2 — อธิบายปัญหา (Problem Description)'],
  ['d3_containment', 'D3 — มาตรการชั่วคราว (Interim Containment)'],
  ['d4_root_cause',  'D4 — วิเคราะห์สาเหตุราก (Root Cause: 5-Why / Fishbone)'],
  ['d5_corrective',  'D5 — มาตรการแก้ไขถาวร (Permanent Corrective Action)'],
  ['d6_implement',   'D6 — การนำไปปฏิบัติและติดตามผล (Implement & Validate)'],
  ['d7_prevent',     'D7 — การป้องกันการเกิดซ้ำ (Prevent Recurrence: อัปเดต FMEA/Control Plan/WI)'],
  ['d8_closure',     'D8 — สรุปปิดและขอบคุณทีม (Closure)'],
];

function CAPATab({ canRecord, canManage, prefill, onPrefillDone }) {
  const { fullName } = useContext(UserContext);
  const [list, setList] = useState([]);
  const [filter, setFilter] = useState('active');
  const [detail, setDetail] = useState(null); // { ...capa } (id=null = สร้างใหม่)

  const load = useCallback(async () => {
    let q = supabase.from('qa_capa').select('*, qa_ncr(ncr_no)').order('created_at', { ascending: false }).limit(300);
    if (filter === 'active') q = q.neq('status', 'closed');
    if (filter === 'closed') q = q.eq('status', 'closed');
    const { data } = await q;
    setList(data || []);
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  // เปิดจากปุ่มใน NCR
  useEffect(() => {
    if (!prefill) return;
    setDetail({
      id: null, capa_no: '', ncr_id: prefill.id, ncr_no: prefill.ncr_no,
      title: `แก้ไขปัญหา ${prefill.defect_desc?.slice(0, 60) || ''} (${prefill.ncr_no})`,
      owner_name: fullName || '', due_date: '',
      d1_team: '', d2_problem: prefill.defect_desc || '', d3_containment: prefill.containment || '',
      d4_root_cause: prefill.root_cause || '', d5_corrective: '', d6_implement: '', d7_prevent: '', d8_closure: '',
      effectiveness: '', status: 'open',
    });
    onPrefillDone();
  }, [prefill, onPrefillDone, fullName]);

  const save = async (extra = {}, msg = 'บันทึกแล้ว ✓') => {
    const f = { ...detail, ...extra };
    if (!f.title?.trim()) { toast.error('กรอกหัวข้อ CAPA'); return; }
    const payload = {
      ncr_id: f.ncr_id || null, title: f.title.trim(),
      owner_name: f.owner_name?.trim() || null, due_date: f.due_date || null,
      d1_team: f.d1_team?.trim() || null, d2_problem: f.d2_problem?.trim() || null,
      d3_containment: f.d3_containment?.trim() || null, d4_root_cause: f.d4_root_cause?.trim() || null,
      d5_corrective: f.d5_corrective?.trim() || null, d6_implement: f.d6_implement?.trim() || null,
      d7_prevent: f.d7_prevent?.trim() || null, d8_closure: f.d8_closure?.trim() || null,
      effectiveness: f.effectiveness?.trim() || null, status: f.status,
      ...(f.status === 'closed' && !f.closed_at ? { closed_at: new Date().toISOString() } : {}),
    };
    let error;
    if (f.id) {
      ({ error } = await supabase.from('qa_capa').update(payload).eq('id', f.id));
    } else {
      const capa_no = await nextDocNo('qa_capa', 'capa_no', 'CAPA');
      ({ error } = await supabase.from('qa_capa').insert({ ...payload, capa_no, created_by: fullName || null }));
    }
    if (error) { toast.error(`บันทึกไม่สำเร็จ: ${error.message}`); return; }
    toast.success(msg);
    setDetail(null);
    load();
  };

  const today = getWorkDate();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {[['active', 'ค้างดำเนินการ'], ['closed', 'ปิดแล้ว'], ['all', 'ทั้งหมด']].map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)}
            style={{ ...ghostBtn, ...(filter === v ? { background: 'var(--accent-dim)', color: 'var(--accent)', borderColor: 'var(--accent)' } : {}) }}>{l}</button>
        ))}
        <div style={{ flex: 1 }} />
        {canRecord && <button style={btnSt()} onClick={() => setDetail({
          id: null, capa_no: '', ncr_id: null, title: '', owner_name: fullName || '', due_date: '',
          d1_team: '', d2_problem: '', d3_containment: '', d4_root_cause: '', d5_corrective: '',
          d6_implement: '', d7_prevent: '', d8_closure: '', effectiveness: '', status: 'open',
        })}>🛠 เปิด CAPA ใหม่</button>}
      </div>

      <div className="table-sticky" style={{ ...cardSt, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead><tr>
            <th style={thSt}>เลขที่</th><th style={thSt}>หัวข้อ</th><th style={thSt}>NCR อ้างอิง</th>
            <th style={thSt}>ผู้รับผิดชอบ</th><th style={thSt}>กำหนดปิด</th><th style={thSt}>สถานะ</th>
          </tr></thead>
          <tbody>
            {list.map(c => {
              const overdue = c.status !== 'closed' && c.due_date && c.due_date < today;
              return (
                <tr key={c.id} onClick={() => setDetail({ ...c, ncr_no: c.qa_ncr?.ncr_no })} style={{ cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ ...tdSt, fontWeight: 700, whiteSpace: 'nowrap' }}>{c.capa_no}</td>
                  <td style={{ ...tdSt, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</td>
                  <td style={tdSt}>{c.qa_ncr?.ncr_no || '—'}</td>
                  <td style={tdSt}>{c.owner_name || '—'}</td>
                  <td style={{ ...tdSt, whiteSpace: 'nowrap', color: overdue ? '#ef4444' : undefined, fontWeight: overdue ? 800 : 400 }}>
                    {fmtD(c.due_date)}{overdue ? ' ⚠️' : ''}
                  </td>
                  <td style={tdSt}><Chip label={CAPA_STATUS[c.status]?.label || c.status} color={CAPA_STATUS[c.status]?.color || '#6b7280'} /></td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td style={tdSt} colSpan={6}><span style={{ color: 'var(--muted)' }}>ไม่มีรายการ</span></td></tr>}
          </tbody>
        </table>
      </div>

      {detail && (
        <Modal title={detail.id ? `🛠 ${detail.capa_no}` : '🛠 เปิด CAPA / 8D ใหม่'} onClose={() => setDetail(null)} width={1400}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <Field label="หัวข้อ *"><input style={inputSt} value={detail.title} onChange={e => setDetail(f => ({ ...f, title: e.target.value }))} disabled={!canRecord} /></Field>
            <Field label="ผู้รับผิดชอบ"><input style={inputSt} value={detail.owner_name || ''} onChange={e => setDetail(f => ({ ...f, owner_name: e.target.value }))} disabled={!canRecord} /></Field>
            <Field label="กำหนดปิด (due date)"><input type="date" style={inputSt} value={detail.due_date || ''} onChange={e => setDetail(f => ({ ...f, due_date: e.target.value }))} disabled={!canRecord} /></Field>
          </div>
          {detail.ncr_no && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>อ้างอิง NCR: <b>{detail.ncr_no}</b></div>}

          {/* D1-D8 เรียง 2 คอลัมน์บนจอกว้าง (UI-CONVENTIONS §5 — เดิมคอลัมน์เดียวสูงยืดต้อง scroll) */}
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: 10 }}>
            {D_FIELDS.map(([key, label]) => (
              <Field key={key} label={label}>
                <textarea rows={3} style={{ ...inputSt, resize: 'vertical' }} value={detail[key] || ''}
                  onChange={e => setDetail(f => ({ ...f, [key]: e.target.value }))} disabled={!canRecord || detail.status === 'closed'} />
              </Field>
            ))}
            <Field label="ผลตรวจติดตามประสิทธิผล (Effectiveness Verification)">
              <textarea rows={2} style={{ ...inputSt, resize: 'vertical' }} value={detail.effectiveness || ''}
                onChange={e => setDetail(f => ({ ...f, effectiveness: e.target.value }))} disabled={!canManage || detail.status === 'closed'} />
            </Field>
          </div>

          {detail.status !== 'closed' && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
              <button style={ghostBtn} onClick={() => setDetail(null)}>ยกเลิก</button>
              {canRecord && <button style={btnSt('#f59e0b')} onClick={() => save({ status: detail.id ? (detail.status === 'open' ? 'in_progress' : detail.status) : 'open' })}>💾 บันทึก</button>}
              {canRecord && detail.id && detail.status !== 'verify' && (
                <button style={btnSt('#4d9fff')} onClick={() => {
                  if (!detail.d5_corrective?.trim()) { toast.error('กรอก D5 มาตรการแก้ไขถาวรก่อนส่งตรวจ'); return; }
                  save({ status: 'verify' }, 'ส่งตรวจประสิทธิผลแล้ว ✓');
                }}>ส่งตรวจประสิทธิผล</button>
              )}
              {canManage && detail.id && (
                <button style={btnSt('#22c55e')} onClick={() => {
                  if (!detail.effectiveness?.trim()) { toast.error('กรอกผลตรวจประสิทธิผลก่อนปิด'); return; }
                  save({ status: 'closed' }, `ปิด ${detail.capa_no} แล้ว ✓`);
                }}>✅ ปิด CAPA</button>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   TAB 5 — ทะเบียนเครื่องมือวัด + กำหนดสอบเทียบ
   ════════════════════════════════════════════════════════════════════════ */
const EMPTY_INST = { code: '', name: '', inst_type: '', brand: '', serial_no: '', range_spec: '', resolution: '', location: '', line_name: '', cal_freq_months: 12, last_calibrated: '', cal_by: '', cert_no: '', status: 'active', remark: '' };

function nextDue(inst) {
  if (!inst.last_calibrated) return null;
  const d = new Date(inst.last_calibrated + 'T00:00:00');
  d.setMonth(d.getMonth() + (inst.cal_freq_months || 12));
  return localDateStr(d);
}
function calState(inst) {
  if (inst.status !== 'active') return { label: inst.status === 'repair' ? 'ส่งซ่อม' : 'ยกเลิกใช้', color: '#6b7280' };
  const due = nextDue(inst);
  if (!due) return { label: 'ยังไม่สอบเทียบ', color: '#ef4444' };
  const today = localDateStr();
  if (due < today) return { label: 'เกินกำหนด!', color: '#ef4444' };
  const soon = new Date(); soon.setDate(soon.getDate() + 30);
  if (due <= localDateStr(soon)) return { label: 'ใกล้ครบกำหนด', color: '#f59e0b' };
  return { label: 'ปกติ', color: '#22c55e' };
}

function InstrumentTab({ lines, canManage }) {
  const [list, setList] = useState([]);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('qa_instruments').select('*').order('code');
    setList(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const f = modal;
    if (!f.code.trim() || !f.name.trim()) { toast.error('กรอกรหัสและชื่อเครื่องมือ'); return; }
    const payload = {
      code: f.code.trim(), name: f.name.trim(), inst_type: f.inst_type.trim() || null,
      brand: f.brand.trim() || null, serial_no: f.serial_no.trim() || null,
      range_spec: f.range_spec.trim() || null, resolution: f.resolution.trim() || null,
      location: f.location.trim() || null, line_name: f.line_name || null,
      cal_freq_months: parseInt(f.cal_freq_months) || 12,
      last_calibrated: f.last_calibrated || null, cal_by: f.cal_by.trim() || null,
      cert_no: f.cert_no.trim() || null, status: f.status, remark: f.remark.trim() || null,
    };
    const { error } = f.id
      ? await supabase.from('qa_instruments').update(payload).eq('id', f.id)
      : await supabase.from('qa_instruments').insert(payload);
    if (error) { toast.error(`บันทึกไม่สำเร็จ: ${error.message}`); return; }
    toast.success('บันทึกแล้ว ✓');
    setModal(null);
    load();
  };

  const shown = list.filter(i => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [i.code, i.name, i.inst_type, i.location, i.line_name].some(v => (v || '').toLowerCase().includes(q));
  });
  const counts = useMemo(() => {
    const c = { ok: 0, soon: 0, overdue: 0 };
    list.filter(i => i.status === 'active').forEach(i => {
      const s = calState(i);
      if (s.color === '#22c55e') c.ok += 1;
      else if (s.color === '#f59e0b') c.soon += 1;
      else c.overdue += 1;
    });
    return c;
  }, [list]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <KpiCard label="สอบเทียบปกติ" value={counts.ok} color="#22c55e" />
        <KpiCard label="ใกล้ครบกำหนด (≤30 วัน)" value={counts.soon} color="#f59e0b" />
        <KpiCard label="เกินกำหนด / ยังไม่สอบเทียบ" value={counts.overdue} color="#ef4444" />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input style={{ ...inputSt, maxWidth: 280 }} placeholder="🔍 ค้นหา รหัส/ชื่อ/ตำแหน่ง…" value={search} onChange={e => setSearch(e.target.value)} />
        <div style={{ flex: 1 }} />
        {canManage && <button style={btnSt()} onClick={() => setModal({ ...EMPTY_INST })}>+ เพิ่มเครื่องมือวัด</button>}
      </div>

      <div className="table-sticky" style={{ ...cardSt, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead><tr>
            <th style={thSt}>รหัส</th><th style={thSt}>ชื่อเครื่องมือ</th><th style={thSt}>ชนิด</th><th style={thSt}>Range / Res.</th>
            <th style={thSt}>ตำแหน่ง</th><th style={thSt}>สอบเทียบล่าสุด</th><th style={thSt}>ครบกำหนด</th><th style={thSt}>สถานะ</th>
            {canManage && <th style={thSt}></th>}
          </tr></thead>
          <tbody>
            {shown.map(i => {
              const s = calState(i);
              return (
                <tr key={i.id}>
                  <td style={{ ...tdSt, fontWeight: 700 }}>{i.code}</td>
                  <td style={tdSt}>{i.name}{i.serial_no ? <span style={{ color: 'var(--muted)', fontSize: 11 }}> · S/N {i.serial_no}</span> : ''}</td>
                  <td style={tdSt}>{i.inst_type || '—'}</td>
                  <td style={tdSt}>{i.range_spec || '—'}{i.resolution ? ` / ${i.resolution}` : ''}</td>
                  <td style={tdSt}>{[i.location, i.line_name].filter(Boolean).join(' · ') || '—'}</td>
                  <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>{fmtD(i.last_calibrated)}</td>
                  <td style={{ ...tdSt, whiteSpace: 'nowrap', fontWeight: 700, color: s.color }}>{fmtD(nextDue(i))}</td>
                  <td style={tdSt}><Chip label={s.label} color={s.color} /></td>
                  {canManage && <td style={tdSt}>
                    <button className="tbtn" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }} onClick={() => setModal({
                      ...EMPTY_INST, ...i,
                      inst_type: i.inst_type || '', brand: i.brand || '', serial_no: i.serial_no || '',
                      range_spec: i.range_spec || '', resolution: i.resolution || '', location: i.location || '',
                      line_name: i.line_name || '', last_calibrated: i.last_calibrated || '', cal_by: i.cal_by || '',
                      cert_no: i.cert_no || '', remark: i.remark || '',
                    })}>✏️</button>
                  </td>}
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td style={tdSt} colSpan={9}><span style={{ color: 'var(--muted)' }}>ไม่มีเครื่องมือวัดในทะเบียน</span></td></tr>}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title={modal.id ? `✏️ ${modal.code}` : '➕ เพิ่มเครื่องมือวัด'} onClose={() => setModal(null)} width={620}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="รหัส *"><input style={inputSt} value={modal.code} onChange={e => setModal(f => ({ ...f, code: e.target.value }))} /></Field>
            <Field label="ชื่อเครื่องมือ *"><input style={inputSt} value={modal.name} onChange={e => setModal(f => ({ ...f, name: e.target.value }))} /></Field>
            <Field label="ชนิด"><input style={inputSt} placeholder="caliper / micrometer / torque" value={modal.inst_type} onChange={e => setModal(f => ({ ...f, inst_type: e.target.value }))} /></Field>
            <Field label="ยี่ห้อ"><input style={inputSt} value={modal.brand} onChange={e => setModal(f => ({ ...f, brand: e.target.value }))} /></Field>
            <Field label="Serial No."><input style={inputSt} value={modal.serial_no} onChange={e => setModal(f => ({ ...f, serial_no: e.target.value }))} /></Field>
            <Field label="Range"><input style={inputSt} placeholder="0-150 mm" value={modal.range_spec} onChange={e => setModal(f => ({ ...f, range_spec: e.target.value }))} /></Field>
            <Field label="Resolution"><input style={inputSt} placeholder="0.01 mm" value={modal.resolution} onChange={e => setModal(f => ({ ...f, resolution: e.target.value }))} /></Field>
            <Field label="ตำแหน่ง/แผนก"><input style={inputSt} value={modal.location} onChange={e => setModal(f => ({ ...f, location: e.target.value }))} /></Field>
            <Field label="ไลน์">
              <select style={inputSt} value={modal.line_name} onChange={e => setModal(f => ({ ...f, line_name: e.target.value }))}>
                <option value="">— ไม่ระบุ —</option>
                {lines.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
            <Field label="รอบสอบเทียบ (เดือน)"><input type="number" min="1" style={inputSt} value={modal.cal_freq_months} onChange={e => setModal(f => ({ ...f, cal_freq_months: e.target.value }))} /></Field>
            <Field label="สอบเทียบล่าสุด"><input type="date" style={inputSt} value={modal.last_calibrated} onChange={e => setModal(f => ({ ...f, last_calibrated: e.target.value }))} /></Field>
            <Field label="หน่วยงานสอบเทียบ"><input style={inputSt} value={modal.cal_by} onChange={e => setModal(f => ({ ...f, cal_by: e.target.value }))} /></Field>
            <Field label="เลขที่ Certificate"><input style={inputSt} value={modal.cert_no} onChange={e => setModal(f => ({ ...f, cert_no: e.target.value }))} /></Field>
            <Field label="สถานะ">
              <select style={inputSt} value={modal.status} onChange={e => setModal(f => ({ ...f, status: e.target.value }))}>
                <option value="active">ใช้งาน</option><option value="repair">ส่งซ่อม</option><option value="retired">ยกเลิกใช้</option>
              </select>
            </Field>
            <Field label="หมายเหตุ" span><input style={inputSt} value={modal.remark} onChange={e => setModal(f => ({ ...f, remark: e.target.value }))} /></Field>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button style={ghostBtn} onClick={() => setModal(null)}>ยกเลิก</button>
            <button style={btnSt()} onClick={save}>บันทึก</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   หน้าหลัก
   ════════════════════════════════════════════════════════════════════════ */
const TABS = [
  { key: 'dashboard',   icon: '📊', label: 'Dashboard คุณภาพ' },
  // ใบตรวจ = หน้า "ใช้งาน" ของมาตรฐานที่ตั้งไว้ใน /qa-setup (2026-08-04) — วางถัดจาก Dashboard
  // เพราะเป็นงานประจำวันที่ QC เปิดบ่อยสุด ส่วน SPC/NCR/CAPA เป็นงานตามหลัง
  { key: 'sheet',       icon: '✅', label: 'ใบตรวจ (Check Sheet)' },
  { key: 'spc',         icon: '📐', label: 'SPC / Cp-Cpk' },
  { key: 'ncr',         icon: '🚨', label: 'NCR ของเสีย' },
  { key: 'capa',        icon: '🛠', label: 'CAPA / 8D' },
  { key: 'instruments', icon: '📏', label: 'เครื่องมือวัด' },
];

export default function QualityControl() {
  const { can } = usePerms();
  const { role, lineId, sections } = useContext(UserContext);
  const canRecord = can('qa', 'record');
  const canManage = can('qa', 'manage');
  const [tab, setTab] = useState('dashboard');
  const [allLines, setAllLines] = useState([]);
  const [capaPrefill, setCapaPrefill] = useState(null); // NCR → เปิด 8D

  useEffect(() => {
    supabase.from('production_lines').select('id, name, section, parent_line_name').order('name')
      .then(({ data }) => setAllLines(data || []));
  }, []);
  // ลิสต์ไลน์ที่ส่งให้ทุกแท็บ (SPC/NCR/Instrument) ต้อง scope ด้วย — ไม่งั้น leader/supervisor
  // เลือกไลน์นอกส่วนงานแล้วสร้าง NCR/characteristic ข้ามส่วนงานได้ (กฎ dropdown-scope · QC audit 2026-08-03)
  const lines = useMemo(() => {
    if (role === 'leader' && lineId) {
      const myLine = allLines.find(l => String(l.id) === String(lineId));
      return myLine ? getLineFamilyNames(allLines, myLine.name) : [];
    }
    if (sections?.length) return allLines.filter(l => inSectionScope(sections, l.section)).map(l => l.name);
    return allLines.map(l => l.name);
  }, [allLines, role, lineId, sections]);

  const openCapaFromNcr = useCallback((ncr) => {
    setCapaPrefill(ncr);
    setTab('capa');
  }, []);

  return (
    <div style={{ padding: '0 18px 30px', maxWidth: 1500, margin: '0 auto' }}>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 20, fontWeight: 900, margin: 0, fontFamily: 'var(--font-display)' }}>
          🔍 Quality Control Center
        </h1>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
          ใบตรวจตามมาตรฐาน · SPC · Process Capability · NCR · 8D CAPA · เครื่องมือวัด — งานประกันคุณภาพตามแนวทาง IATF 16949
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              ...ghostBtn, padding: '8px 16px', fontSize: 13,
              ...(tab === t.key ? { background: 'var(--accent-dim)', color: 'var(--accent)', borderColor: 'var(--accent)', fontWeight: 800 } : {}),
            }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <QualityDashboard />}
      {tab === 'sheet' && <QaCheckSheet canRecord={canRecord} />}
      {tab === 'spc' && <SPCTab lines={lines} canRecord={canRecord} canManage={canManage} />}
      {tab === 'ncr' && <NCRTab lines={lines} canRecord={canRecord} canManage={canManage} onOpenCapa={openCapaFromNcr} />}
      {tab === 'capa' && <CAPATab canRecord={canRecord} canManage={canManage} prefill={capaPrefill} onPrefillDone={() => setCapaPrefill(null)} />}
      {tab === 'instruments' && <InstrumentTab lines={lines} canManage={canManage} />}
    </div>
  );
}
