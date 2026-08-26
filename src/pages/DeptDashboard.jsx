import { useState, useEffect, useCallback, useMemo, useContext, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { wavg } from '../utils/oee';
import { pairAwareTotal, collapseOps } from '../utils/pairTotals';
import { loadOpInfo, opInfoSync } from '../utils/opItems';
import { fetchByIds, fetchAllPages } from '../utils/fetchByIds';
import useIsMobile from '../utils/useIsMobile';
import { scopedLineNames } from '../utils/sectionScope';
import ParetoAbcChart from '../components/ParetoAbcChart';
// แท็บ KPI รายเดือน — lazy: โหลดข้อมูลทั้งปีเฉพาะตอนถูกเปิด ไม่ถ่วงหน้า "วันนี้"
const KpiMonthly = lazy(() => import('../components/KpiMonthly'));
/* 🚨 จอห้องช่าง — lazy: มี realtime + siren โหลดเฉพาะตอนเปิดจริง */
const MtnAndonBoard = lazy(() => import('../components/MtnAndonBoard'));

/* ══ 📊 Dashboard รายส่วนงาน — หน้าเดียว สลับส่วนงานด้วย ?dept= ══════════════════════════
   ออกแบบเต็มอยู่ที่ `docs/DASHBOARD-DESIGN.md` · เฟส 1: ฝ่ายผลิต · ซ่อมบำรุง · สโตร์ · QA

   หลักการ (ห้ามแหก — ดู docs/ENGINEERING-PRINCIPLES.md):
   • **1 หน้า + config ต่อส่วนงาน** — เพิ่มส่วนงานใหม่ = เพิ่ม entry ใน DEPTS (loader + View)
     ห้ามสร้างหน้า dashboard แยกต่อส่วนงาน (จะได้ 8 หน้าคนละทรงแล้ว drift)
   • **ห้ามคำนวณ KPI เอง** — OEE/เฉลี่ยถ่วงน้ำหนัก ผ่าน utils/oee · ยอดผลิตนับคู่ RH/LH ผ่าน
     pairAwareTotal · NG ยึด defect_logs · Downtime นับเฉพาะ "นอกแผน"
   • **เลย์เอาต์ 4 ชั้นเหมือนกันทุกใบ**: 🚨 ต้องทำตอนนี้ → 📊 KPI → 📈 ชี้เป้าให้แก้ → 🔗 ทางลัด
   • **อ่านอย่างเดียว** ไม่มี insert/update — ทุก action คือลิงก์ไปหน้าที่ทำงานจริง
   • **ข้อมูลไม่ครบต้องพูด** (เช่น "ยังมี N กะไม่ปิด ตัวเลขยังไม่ครบ") ห้ามโชว์เลขที่ดูสมบูรณ์
   • ส่วนงานที่ข้อมูลยังน้อย (ซ่อมบำรุง/QA) แผงหลักคือ "อะไรยังไม่ถูกบันทึก" ไม่ใช่กราฟสถิติ
   ═════════════════════════════════════════════════════════════════════════════════════════ */

/* ── helper กลาง ─────────────────────────────────────────────────────────────────────── */
function getWorkDate() {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/* บวกวันบน 'YYYY-MM-DD' แบบ local — ห้าม toISOString (UTC เพี้ยน 1 วันช่วง 00:00-07:00 ไทย) */
const dayAdd = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtNum = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const fmtDate = (s) => { try { return new Date(`${s}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }); } catch { return s; } };
const oeeCol = (o) => o == null ? 'var(--muted)' : o >= 80 ? '#22c55e' : o >= 65 ? '#f59e0b' : '#ef4444';
const pctCol = (p) => p == null ? 'var(--muted)' : p >= 95 ? '#22c55e' : p >= 80 ? '#f59e0b' : '#ef4444';
const daysSince = (iso) => iso ? Math.floor((Date.now() - new Date(iso)) / 86400000) : null;
const dtMinOf = (d) => d.duration_min != null ? (Number(d.duration_min) || 0)
  : (d.started_at && d.ended_at ? Math.max(0, (new Date(d.ended_at) - new Date(d.started_at)) / 60000) : 0);
const isOpenDT = (d) => !d.ended_at && d.duration_min == null;
/* ลิงก์เข้า "คิวอนุมัติ 4M" ของใบนั้นโดยตรง (ไม่ใช่หน้ารายงานเปล่าๆ) — Report.jsx อ่าน param ชุดนี้:
   status/from = ตั้งตัวกรองให้ใบนั้นอยู่ในรายการ (ใบค้างมักเก่ากว่าช่วง default 7 วัน)
   focus = เน้นแถว + เลื่อนไปหา แล้วกดอนุมัติได้เลย
   ⚠️ ?tab= ของ /report เป็น "เลข index ของ TABS" (สัญญาเดิมของหน้านั้น) — 4 = 🚨 4M Changes
      สลับลำดับแท็บใน Report.jsx เมื่อไหร่ ต้องมาแก้เลขตรงนี้ด้วย (มีคอมเมนต์เตือนไว้ที่ TABS แล้ว) */
const FOURM_TAB = '/report?tab=4';
const fourMLink = (f) => `${FOURM_TAB}&status=${encodeURIComponent(f.status || '')}&from=${f.work_date}&focus=${f.id}`;

/* ขอบเขตไลน์ตามสิทธิ์ — ใช้ helper กลาง `scopedLineNames` (utils/sectionScope.js) เท่านั้น
   เดิมหน้านี้เขียน pattern เองแล้ว **drift จากของกลาง 2 จุด** (audit 2026-08-19):
     1. ไม่มีเงื่อนไข admin / MAINTENANCE_ROLES → mtn/engineer ที่ถูกตั้ง sections จะโดนจำกัด
        ทั้งที่กฎคือ "หน่วยงานช่างเห็นทั้งโรงงาน" (แท็บซ่อมบำรุงของหน้านี้เองก็โดน)
     2. lines ยังไม่โหลด + มี sections → คืน Set ว่าง = เห็น 0 ไลน์ (ของกลางคืน null = ไม่จำกัด) */

/* ── UI atoms (ใช้ร่วมทุกส่วนงาน) ────────────────────────────────────────────────────── */
const cardSt = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 14 };

function Section({ title, sub, children, tone }) {
  const bd = tone === 'alert' ? '#ef4444' : tone === 'warn' ? '#f59e0b' : 'var(--border)';
  return (
    <div style={{ ...cardSt, borderLeft: `4px solid ${bd}` }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: sub ? 2 : 9 }}>{title}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 9 }}>{sub}</div>}
      {children}
    </div>
  );
}

function Kpi({ label, value, unit, sub, color, delta }) {
  return (
    <div className="kpi-lift" style={{
      background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
      padding: '11px 13px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 92,
    }}>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.15, color: color || 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
        {value}{unit && <span style={{ fontSize: 14, fontWeight: 700 }}> {unit}</span>}
        {delta != null && (
          <span style={{ fontSize: 12.5, marginLeft: 7, color: delta > 0 ? '#22c55e' : delta < 0 ? '#ef4444' : 'var(--muted)' }}>
            {delta > 0 ? '▲' : delta < 0 ? '▼' : '='} {Math.abs(delta).toFixed(1)}
          </span>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', minHeight: 15 }}>{sub || ' '}</div>
    </div>
  );
}

/* คิวงานค้าง — ว่างต้องขึ้น "ไม่มีงานค้าง" เสมอ ห้ามซ่อนแผง (ผู้ใช้ต้องรู้ว่าเช็คแล้ว) */
function ActionList({ items, empty = '✅ ไม่มีงานค้าง', onPick, max = 8 }) {
  if (!items.length) return <div style={{ fontSize: 13, color: '#22c55e' }}>{empty}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.slice(0, max).map((it, i) => (
        <button key={i} onClick={() => onPick && onPick(it)} style={{
          display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', cursor: onPick ? 'pointer' : 'default',
          background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '7px 10px', color: 'var(--text)',
        }}>
          <span style={{ fontSize: 15 }}>{it.icon}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
            <b>{it.title}</b>
            {it.detail && <span style={{ color: 'var(--muted)' }}> · {it.detail}</span>}
          </span>
          {it.age != null && <span style={{ fontSize: 11.5, color: it.age >= 3 ? '#ef4444' : 'var(--muted)', whiteSpace: 'nowrap' }}>{it.age} วัน</span>}
          {it.tag && <span style={{ fontSize: 11, fontWeight: 700, color: it.tagColor || 'var(--muted)', whiteSpace: 'nowrap' }}>{it.tag}</span>}
        </button>
      ))}
      {items.length > max && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>…และอีก {items.length - max} รายการ</div>}
    </div>
  );
}

function Links({ items, navigate }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
      {items.map(([to, label, n]) => (
        <button key={to} onClick={() => navigate(to)} style={{
          fontSize: 13, fontWeight: 700, padding: '7px 12px', borderRadius: 999, cursor: 'pointer',
          background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)',
        }}>
          {label}{n ? <span style={{ marginLeft: 6, color: '#f59e0b' }}>{n}</span> : null}
        </button>
      ))}
    </div>
  );
}

const TH = { padding: '7px 8px', fontSize: 12, color: 'var(--muted)', fontWeight: 700, textAlign: 'left', whiteSpace: 'nowrap' };
const THR = { ...TH, textAlign: 'right' };
const TD = { padding: '7px 8px', fontSize: 13, borderTop: '1px solid var(--border)' };
const TDR = { ...TD, textAlign: 'right' };
const tableSt = { width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' };
const KPI_GRID = (isMobile) => ({ display: 'grid', gap: 10, gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))' });

/* ═══════════════════════ 1) ฝ่ายผลิต ═══════════════════════════════════════════════════ */
async function loadProduction(ctx) {
  const { workDate, prevDate, inScope } = ctx;
  const d7 = dayAdd(workDate, -6);
  const [{ data: sess2 }, { data: sess7 }, fourM, logsRes, empRes, { data: staleRaw }] = await Promise.all([
    supabaseDR.from('production_sessions').select('id, line_name, shift, status, oee, shift_min, work_date').in('work_date', [prevDate, workDate]),
    supabaseDR.from('production_sessions').select('id, line_name, work_date, shift').gte('work_date', d7).lte('work_date', workDate),
    supabase.from('four_m_logs').select('id, work_date, line_name, category, description, status, created_by_name').in('status', ['pending', 'pending_qa']).order('work_date', { ascending: true }).limit(100),
    supabase.from('daily_production_logs').select('employee_id, is_present').eq('work_date', workDate),
    supabase.from('employees').select('id, line_id').eq('is_active', true),
    // กะค้างจากวันก่อนที่ยังไม่ปิด/ไม่อนุมัติ — คิว escalation (2026-08-25 · "บีบให้เคลียร์ใน 7 วัน")
    // ⚠️ OEE นับเฉพาะกะปิดแล้ว → กะพวกนี้คือรูโหว่ของรายงานเดือน ไม่ใช่แค่รก
    supabaseDR.from('production_sessions').select('id, line_name, shift, work_date, status, close_requested_by_name')
      .in('status', ['open', 'pending_close']).lt('work_date', workDate).order('work_date', { ascending: true }).limit(400),
  ]);
  const sess = (sess2 || []).filter(s => inScope(s.line_name));
  const ids = sess.map(s => s.id);
  const ids7 = (sess7 || []).filter(s => inScope(s.line_name)).map(s => s.id);
  /* ⚠️ ids7 = 7 วัน ≈ 200 กะ → `.in()` ตรงๆ URL ยาวเกิน + แถวลูกทะลุ 1000 ได้
     → ผ่าน fetchByIds ทุกคิวรีที่ยิงด้วย id list (QC audit 2026-08-20 · T3-14) */
  const [ordRes, dtRes, defRes, { data: prods }, dt7Res] = await Promise.all([
    fetchByIds(ids, c => supabaseDR.from('prod_orders').select('id, session_id, status, qty, qty_ok, qty_actual, qty_target, mat_no').in('session_id', c)),
    fetchByIds(ids, c => supabaseDR.from('downtime_logs').select('id, session_id, duration_min, started_at, ended_at, machine_no, description, dr_downtime_types(name_th, category)').in('session_id', c)),
    fetchByIds(ids, c => supabaseDR.from('defect_logs').select('id, session_id, qty_ng, qty_suspect').in('session_id', c)),
    supabaseDR.from('dr_products').select('mat_no, pair_mat_no'),
    fetchByIds(ids7, c => supabaseDR.from('downtime_logs').select('id, session_id, duration_min, started_at, ended_at, machine_no, description, dr_downtime_types(name_th, category)').in('session_id', c)),
    loadOpInfo(), // map รายการขั้นตอน (OP งานขับนัท) — ตัวสุดท้ายไม่เข้า destructure แค่ให้ cache พร้อม
  ]);
  return { sess, sess7: sess7 || [], orders: ordRes.rows, dts: dtRes.rows, defs: defRes.rows, prods: prods || [], dt7: dt7Res.rows,
    loadErr: !!(ordRes.error || dtRes.error || defRes.error || dt7Res.error),
    stale: (staleRaw || []).filter(s => inScope(s.line_name)),
    fourM: (fourM.data || []).filter(f => !f.line_name || inScope(f.line_name)), logs: logsRes.data || [], emps: empRes.data || [] };
}

function ProductionView({ d, ctx }) {
  const { workDate, prevDate, lines, navigate, isMobile } = ctx;
  const pairOf = useMemo(() => { const m = {}; d.prods.forEach(p => { if (p.pair_mat_no) m[p.mat_no] = p.pair_mat_no; }); return (x) => m[x] || null; }, [d.prods]);

  const per = useMemo(() => {
    const bySess = {}; d.orders.forEach(o => (bySess[o.session_id] ||= []).push(o));
    const dtBy = {}; d.dts.forEach(x => (dtBy[x.session_id] ||= []).push(x));
    const ngBy = {}; d.defs.forEach(x => { ngBy[x.session_id] = (ngBy[x.session_id] || 0) + (+x.qty_ng || 0) + (+x.qty_suspect || 0); });
    const out = {};
    d.sess.forEach(s => {
      const day = s.work_date === workDate ? 'today' : 'prev';
      const o = (out[day] ||= { lines: {}, rows: [] });
      const L = (o.lines[s.line_name] ||= { line: s.line_name, target: 0, actual: 0, dt: 0, ng: 0, planned: 0, open: 0 });
      const os = bySess[s.id] || [];
      const perMat = {};
      os.forEach(od => {
        if (!od.mat_no) return;
        const e = (perMat[od.mat_no] ||= { mat_no: od.mat_no, target: 0, produced: 0 });
        e.target += od.qty_target ?? od.qty ?? 0;
        e.produced += od.status === 'confirmed' ? (od.qty_ok ?? od.qty ?? 0) : (od.qty_actual ?? 0);
      });
      const nulls = os.filter(od => !od.mat_no);
      const pt = pairAwareTotal(collapseOps(Object.values(perMat), opInfoSync()), pairOf);
      L.target += pt.target + nulls.reduce((a, od) => a + (od.qty_target ?? od.qty ?? 0), 0);
      L.actual += pt.produced + nulls.reduce((a, od) => a + (od.status === 'confirmed' ? (od.qty_ok ?? od.qty ?? 0) : (od.qty_actual ?? 0)), 0);
      let planned = 0;
      (dtBy[s.id] || []).forEach(x => { const m = dtMinOf(x); if (x.dr_downtime_types?.category === 'planned') planned += m; else L.dt += m; });
      L.planned += planned;
      L.ng += ngBy[s.id] || 0;
      if (s.status !== 'closed') L.open++;
      o.rows.push({ line: s.line_name, shift: s.shift, oee: s.oee == null ? null : +s.oee, shift_min: s.shift_min || 570, plannedMin: planned, status: s.status });
    });
    return out;
  }, [d, workDate, pairOf]);

  const today = per.today || { lines: {}, rows: [] };
  const prev = per.prev || { lines: {}, rows: [] };
  const sum = (o, f) => Object.values(o.lines).reduce((a, l) => a + (f(l) || 0), 0);
  const oeeToday = wavg(today.rows.filter(r => r.oee != null), r => r.oee, r => Math.max(0, r.shift_min - r.plannedMin));
  const oeePrev = wavg(prev.rows.filter(r => r.oee != null), r => r.oee, r => Math.max(0, r.shift_min - r.plannedMin));
  const tgt = sum(today, l => l.target), act = sum(today, l => l.actual);
  const pct = tgt > 0 ? +(act / tgt * 100).toFixed(1) : null;
  const openSess = today.rows.filter(r => r.status !== 'closed').length;

  // กำลังคนวันนี้ (พนักงานผูกไลน์แม่ → เทียบเฉพาะไลน์ใน scope)
  const manpower = useMemo(() => {
    const nameOf = {}; lines.forEach(l => { nameOf[l.id] = l.name; });
    const present = new Set(d.logs.filter(l => l.is_present).map(l => l.employee_id));
    let head = 0, came = 0;
    d.emps.forEach(e => { const ln = nameOf[e.line_id]; if (!ln || !ctx.inScope(ln)) return; head++; if (present.has(e.id)) came++; });
    return { head, came };
  }, [d, lines, ctx]);

  const openDT = d.dts.filter(isOpenDT);
  const pendingClose = today.rows.filter(r => r.status === 'pending_close');
  /* กะค้างจากวันก่อน — ยุบเป็นแถวเดียว ไม่แตกรายกะ (57 กะจะกลบคิวงานจริง — บทเรียน 4M [Auto]
     323 ใบกลบใบจริง 19 ใบ) · เกิน 7 วัน = แดง · แถวพาไป /daily-report ที่มี banner รายกะเต็มๆ */
  const staleRows = (d.stale || []).map(s => ({ ...s, age: daysSince(`${s.work_date}T08:00:00`) }));
  const staleOver7 = staleRows.filter(s => s.age > 7);
  const actions = [
    ...(staleRows.length ? [{
      icon: '⏰', title: `กะค้างยังไม่ปิด/ไม่อนุมัติ ${staleRows.length} กะ`,
      detail: `${staleOver7.length ? `เกินเป้า 7 วัน ${staleOver7.length} กะ · เก่าสุด ${Math.max(...staleRows.map(s => s.age))} วัน — ` : ''}OEE ของกะพวกนี้ยังไม่เข้ารายงานเดือน`,
      tag: staleOver7.length ? `เกิน 7 วัน (${staleOver7.length})` : 'ค้างจากวันก่อน',
      tagColor: staleOver7.length ? '#ef4444' : '#f59e0b', to: '/daily-report',
    }] : []),
    ...pendingClose.map(r => ({ icon: '📋', title: `คำขอปิดกะ — ${r.line}`, detail: r.shift === 'night' ? 'กะดึก' : 'กะเช้า', tag: 'รออนุมัติ', tagColor: '#f59e0b', to: '/daily-report' })),
    ...openDT.map(x => ({ icon: '🔴', title: `${x.dr_downtime_types?.name_th || 'Downtime'} ยังไม่ปิด`, detail: x.machine_no || x.description || '', tag: 'เครื่องหยุด', tagColor: '#ef4444', to: '/daily-report' })),
    ...d.fourM.map(f => ({ icon: '📝', title: `4M ${f.category} — ${f.line_name || '-'}`, detail: (f.description || '').slice(0, 40), age: daysSince(`${f.work_date}T08:00:00`), tag: f.status === 'pending_qa' ? 'รอ QA' : 'รอ SV', tagColor: '#f59e0b', to: fourMLink(f) })),
  ];

  const lineRows = Object.values(today.lines).map(l => {
    const rs = today.rows.filter(r => r.line === l.line && r.oee != null);
    return { ...l, pct: l.target > 0 ? +(l.actual / l.target * 100).toFixed(1) : null, oee: wavg(rs, r => r.oee, r => Math.max(0, r.shift_min - r.plannedMin)) };
  }).sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999));

  const dtRecords = useMemo(() => {
    const sMap = {}; d.sess7.forEach(s => { sMap[s.id] = s; });
    return d.dt7.filter(x => x.dr_downtime_types?.category !== 'planned').map(x => ({
      cat: x.dr_downtime_types?.name_th || 'ไม่ระบุประเภท', value: dtMinOf(x),
      machine: x.machine_no || '(ไม่ระบุเครื่อง)', line: sMap[x.session_id]?.line_name || '-',
      shift: sMap[x.session_id]?.shift === 'night' ? 'กะดึก' : 'กะเช้า', date: sMap[x.session_id]?.work_date, note: x.description || '',
    })).filter(r => r.value > 0);
  }, [d]);

  return (<>
    {/* "0" กับ "โหลดไม่ได้" ต้องแยกออกจากกัน (กติกาเดียวกับ QaView) */}
    {d.loadErr && (
      <div style={{ ...cardSt, borderColor: '#ef444488', background: '#ef444414', color: '#ef4444', fontSize: 12, fontWeight: 700, padding: '10px 13px' }}>
        🔴 โหลดใบงาน/Downtime/ของเสียไม่สำเร็จบางส่วน — ตัวเลขด้านล่าง<b>ไม่ครบ</b> (ดูรายละเอียดใน console)
      </div>
    )}
    <Section title="🚨 ต้องทำตอนนี้" sub={`คำขอปิดกะ ${pendingClose.length} · กะค้างวันก่อน ${staleRows.length} · เครื่องหยุดค้าง ${openDT.length} · 4M รออนุมัติ ${d.fourM.length}`} tone={actions.length ? 'alert' : null}>
      <ActionList items={actions} onPick={(it) => navigate(it.to)} />
    </Section>

    <div style={KPI_GRID(isMobile)}>
      <Kpi label="📦 ผลิตวันนี้ / เป้า" value={fmtNum(act)} color={pctCol(pct)} sub={`เป้า ${fmtNum(tgt)} · ${pct == null ? '—' : pct + '%'}`} />
      <Kpi label="⚙️ OEE (กะที่ปิดแล้ว)" value={oeeToday == null ? '—' : oeeToday} unit={oeeToday == null ? '' : '%'} color={oeeCol(oeeToday)}
        delta={oeeToday != null && oeePrev != null ? +(oeeToday - oeePrev).toFixed(1) : null}
        sub={oeePrev == null ? 'ไม่มีข้อมูลเมื่อวานให้เทียบ' : `เมื่อวาน ${oeePrev}%`} />
      <Kpi label="🔧 Downtime นอกแผน" value={fmtNum(sum(today, l => l.dt))} unit="นาที" color={sum(today, l => l.dt) > 0 ? '#f59e0b' : undefined}
        sub={`เมื่อวาน ${fmtNum(sum(prev, l => l.dt))} นาที`} />
      <Kpi label="🚫 ของเสียวันนี้" value={fmtNum(sum(today, l => l.ng))} unit="ชิ้น" color={sum(today, l => l.ng) > 0 ? '#ef4444' : undefined}
        sub={`เมื่อวาน ${fmtNum(sum(prev, l => l.ng))} ชิ้น`} />
      <Kpi label="👷 คนเข้างาน" value={`${fmtNum(manpower.came)}/${fmtNum(manpower.head)}`}
        sub={manpower.head ? `${Math.round(manpower.came / manpower.head * 100)}% ของกำลังคน` : '—'} />
      <Kpi label="🕐 กะที่ยังไม่ปิด" value={openSess} unit="กะ" color={openSess ? '#f59e0b' : '#22c55e'}
        sub={openSess ? 'ตัวเลขด้านบนยังไม่ครบทั้งวัน' : 'ปิดครบแล้ว'} />
    </div>

    <Section title="📈 ไลน์ที่ต้องเข้าไปช่วยก่อน" sub={`เรียงจาก % ทำได้น้อยสุด · วันงาน ${fmtDate(workDate)}`}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ ...tableSt, minWidth: 620 }}>
          <thead><tr><th style={TH}>ไลน์</th><th style={THR}>เป้า</th><th style={THR}>ผลิตได้</th><th style={THR}>%</th><th style={THR}>OEE</th><th style={THR}>DT (น.)</th><th style={THR}>NG</th></tr></thead>
          <tbody>
            {lineRows.map(l => (
              <tr key={l.line}>
                <td style={{ ...TD, fontWeight: 700 }}>{l.line}{l.open ? <span style={{ fontSize: 11, color: '#f59e0b' }}> · ยังไม่ปิดกะ</span> : null}</td>
                <td style={TDR}>{fmtNum(l.target)}</td><td style={TDR}>{fmtNum(l.actual)}</td>
                <td style={{ ...TDR, color: pctCol(l.pct), fontWeight: 700 }}>{l.pct == null ? '—' : l.pct + '%'}</td>
                <td style={{ ...TDR, color: oeeCol(l.oee), fontWeight: 700 }}>{l.oee == null ? '—' : l.oee}</td>
                <td style={{ ...TDR, color: l.dt > 0 ? '#f59e0b' : 'var(--muted)' }}>{fmtNum(l.dt)}</td>
                <td style={{ ...TDR, color: l.ng > 0 ? '#ef4444' : 'var(--muted)' }}>{fmtNum(l.ng)}</td>
              </tr>
            ))}
            {!lineRows.length && <tr><td style={TD} colSpan={7}>ยังไม่มีกะที่เปิดในวันนี้</td></tr>}
          </tbody>
        </table>
      </div>
    </Section>

    <ParetoAbcChart title="🔧 Downtime นอกแผน 7 วัน (ABC)" records={dtRecords} unit="นาที"
      dims={[{ key: 'machine', label: '⚙️ เครื่องจักร' }, { key: 'line', label: '🏭 ไลน์' }, { key: 'shift', label: '🕐 กะ' }, { key: 'date', label: '📅 วัน' }, { key: 'note', label: '💬 หมายเหตุ', cluster: true }]}
      sectionStyle={cardSt} emptyText="ไม่มี downtime นอกแผนใน 7 วัน" />

    <Section title="🔗 ทางลัด">
      <Links navigate={navigate} items={[['/daily-report', '📊 Daily Report'], ['/factory-map', '🗺️ ผังรวมโรงงาน'], ['/oee-analytics', '📈 OEE'], ['/morning-meeting', '🌅 ประชุมเช้า'], ['/management', '🔄 จัดการไลน์']]} />
    </Section>
  </>);
}

/* ═══════════════════════ 2) ซ่อมบำรุง ═════════════════════════════════════════════════ */
async function loadMaintenance(ctx) {
  const { workDate, inScope } = ctx;
  const d30 = dayAdd(workDate, -29);
  const [{ data: mo }, { data: plans }, { data: sess30 }] = await Promise.all([
    supabaseDR.from('mtn_orders').select('*').order('report_at', { ascending: false }).limit(500),
    supabaseDR.from('pm_plans').select('id, checklist_id, plan_type, next_due_date, last_done_at, interval_days').eq('is_active', true),
    supabaseDR.from('production_sessions').select('id, line_name, work_date').gte('work_date', d30).lte('work_date', workDate),
  ]);
  const sIds = (sess30 || []).filter(s => inScope(s.line_name)).map(s => s.id);
  /* ⚠️ 30 วัน ≈ 270 กะ — `.in()` ตรงๆ URL ยาวเกินจน proxy ตัด แล้วคืนค่าว่าง "เงียบ"
     (จอช่างจะขึ้น DT 0 นาที / เครื่องหยุดซ้ำ 0 เครื่อง ทั้งที่มีของจริง) → ผ่าน fetchByIds เสมอ */
  const [dt30Res, { data: cls }] = await Promise.all([
    fetchByIds(sIds, c => supabaseDR.from('downtime_logs').select('session_id, machine_no, duration_min, started_at, ended_at, call_mtn, description, dr_downtime_types(name_th, category)').in('session_id', c)),
    supabaseDR.from('checklists').select('id, equipment_id, department').eq('module', 'mtn'),
  ]);
  const eqIds = [...new Set((cls || []).map(c => c.equipment_id).filter(Boolean))];
  const { data: jigs } = eqIds.length
    ? await supabaseDR.from('jigs').select('id, name, jig_no, machine_no, line_name').in('id', eqIds)
    : { data: [] };
  return { mo: (mo || []), plans: plans || [], dt30: dt30Res.rows, sess30: sess30 || [], cls: cls || [], jigs: jigs || [],
    loadErr: !!dt30Res.error };
}

function MaintenanceView({ d, ctx }) {
  const { workDate, navigate, isMobile, inScope } = ctx;
  const openMo = d.mo.filter(o => !['closed', 'rejected'].includes(o.status));
  const scopedMo = openMo.filter(o => !o.line_name || inScope(o.line_name));
  const stale = scopedMo.filter(o => (daysSince(o.report_at) ?? 0) >= 3);

  // PM: แผนที่ถึงกำหนด/เกินกำหนด (ผูกชื่ออุปกรณ์ผ่าน checklist → jigs)
  const pmRows = useMemo(() => {
    const clById = {}; d.cls.forEach(c => { clById[c.id] = c; });
    const jigById = {}; d.jigs.forEach(j => { jigById[j.id] = j; });
    return d.plans.filter(p => p.next_due_date).map(p => {
      const j = jigById[clById[p.checklist_id]?.equipment_id];
      const days = Math.round((new Date(`${p.next_due_date}T00:00:00`) - new Date(`${workDate}T00:00:00`)) / 86400000);
      return { ...p, name: j?.name || j?.jig_no || j?.machine_no || 'อุปกรณ์ (ไม่พบชื่อ)', line: j?.line_name || '', days };
    }).sort((a, b) => a.days - b.days);
  }, [d, workDate]);
  const overdue = pmRows.filter(p => p.days < 0);
  const dueSoon = pmRows.filter(p => p.days >= 0 && p.days <= 14);

  // ⭐ เครื่องที่หยุดซ้ำแต่ไม่มีใบซ่อม — ช่องว่างจริง (downtime หลักพัน vs ใบซ่อมหลักหน่วย)
  const gap = useMemo(() => {
    const sMap = {}; d.sess30.forEach(s => { sMap[s.id] = s; });
    const byMc = {};
    d.dt30.filter(x => x.dr_downtime_types?.category !== 'planned' && x.machine_no).forEach(x => {
      const m = (byMc[x.machine_no] ||= { machine: x.machine_no, times: 0, min: 0, line: sMap[x.session_id]?.line_name || '', last: null, causes: {} });
      m.times++; m.min += dtMinOf(x);
      const c = x.dr_downtime_types?.name_th || 'ไม่ระบุ'; m.causes[c] = (m.causes[c] || 0) + 1;
      const dt = x.started_at || sMap[x.session_id]?.work_date; if (dt && (!m.last || dt > m.last)) m.last = dt;
    });
    const hasMo = new Set(d.mo.filter(o => o.machine_no && (daysSince(o.report_at) ?? 999) <= 30).map(o => o.machine_no));
    return Object.values(byMc).filter(m => m.times >= 2 && !hasMo.has(m.machine)).sort((a, b) => b.min - a.min);
  }, [d]);

  const callMtn = d.dt30.filter(x => x.call_mtn && isOpenDT(x));
  const byStep = {};
  scopedMo.forEach(o => { byStep[o.status] = (byStep[o.status] || 0) + 1; });
  const unplannedMin = d.dt30.filter(x => x.dr_downtime_types?.category !== 'planned').reduce((a, x) => a + dtMinOf(x), 0);

  const actions = [
    ...callMtn.map(x => ({ icon: '📞', title: `เรียกช่างแล้วยังไม่ปิด — ${x.machine_no || 'ไม่ระบุเครื่อง'}`, detail: x.dr_downtime_types?.name_th || x.description || '', tag: 'ด่วน', tagColor: '#ef4444', to: '/mtn-repair' })),
    ...stale.map(o => ({ icon: '🛠️', title: `${o.mo_no || 'ใบซ่อม'} — ${o.machine_no || o.line_name || ''}`, detail: o.problem_characteristic || '', age: daysSince(o.report_at), tag: o.status, tagColor: '#f59e0b', to: '/mtn-repair' })),
    ...overdue.slice(0, 6).map(p => ({ icon: '📅', title: `PM เกินกำหนด — ${p.name}`, detail: `${p.line} · ครบกำหนด ${fmtDate(p.next_due_date)}`, tag: `เกิน ${Math.abs(p.days)} วัน`, tagColor: '#ef4444', to: '/pm?tab=plan' })),
  ];

  return (<>
    <Section title="🚨 ต้องทำตอนนี้" sub={`เรียกช่างค้าง ${callMtn.length} · ใบซ่อมค้างเกิน 3 วัน ${stale.length} · PM เกินกำหนด ${overdue.length}`} tone={actions.length ? 'alert' : null}>
      <ActionList items={actions} onPick={(it) => navigate(it.to)} />
    </Section>

    <div style={KPI_GRID(isMobile)}>
      <Kpi label="🛠️ ใบซ่อมเปิดอยู่" value={scopedMo.length} unit="ใบ" color={scopedMo.length ? '#f59e0b' : '#22c55e'}
        sub={Object.entries(byStep).map(([k, v]) => `${k} ${v}`).join(' · ') || 'ไม่มีใบค้าง'} />
      <Kpi label="⏳ ค้างเกิน 3 วัน" value={stale.length} unit="ใบ" color={stale.length ? '#ef4444' : '#22c55e'} sub="นับจากวันที่แจ้ง" />
      <Kpi label="📅 PM เกินกำหนด" value={overdue.length} unit="แผน" color={overdue.length ? '#ef4444' : '#22c55e'} sub={`ใกล้ครบใน 14 วัน ${dueSoon.length} แผน`} />
      <Kpi label="🔻 DT เครื่องเสีย 30 วัน" value={fmtNum(unplannedMin)} unit="นาที" sub="downtime นอกแผนทุกสาเหตุ" />
      <Kpi label="⚠️ เครื่องหยุดซ้ำ ไม่มีใบซ่อม" value={gap.length} unit="เครื่อง" color={gap.length ? '#ef4444' : '#22c55e'} sub="หยุด ≥2 ครั้งใน 30 วัน" />
      <Kpi label="📋 แผน PM ที่ใช้งาน" value={d.plans.length} unit="แผน" sub={`มีวันครบกำหนด ${pmRows.length}`} />
    </div>

    <Section title="⚠️ เครื่องที่หยุดซ้ำ แต่ยังไม่มีใบแจ้งซ่อม" tone="warn"
      sub="ฝ่ายผลิตลง downtime ไว้แต่ไม่ได้เปิดใบซ่อม → ช่างไม่เห็นงาน · เรียงตามนาทีที่เสียไปมากสุด (30 วัน)">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ ...tableSt, minWidth: 640 }}>
          <thead><tr><th style={TH}>เครื่อง</th><th style={TH}>ไลน์</th><th style={THR}>ครั้ง</th><th style={THR}>รวม (นาที)</th><th style={TH}>สาเหตุที่พบบ่อย</th><th style={TH}></th></tr></thead>
          <tbody>
            {gap.slice(0, 12).map(m => (
              <tr key={m.machine}>
                <td style={{ ...TD, fontWeight: 700 }}>{m.machine}</td>
                <td style={TD}>{m.line || '-'}</td>
                <td style={TDR}>{m.times}</td>
                <td style={{ ...TDR, color: '#f59e0b', fontWeight: 700 }}>{fmtNum(m.min)}</td>
                <td style={{ ...TD, fontSize: 12, color: 'var(--muted)' }}>{Object.entries(m.causes).sort((a, b) => b[1] - a[1])[0]?.[0]}</td>
                <td style={TD}><button onClick={() => navigate('/mtn-repair')} style={{ fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 6, cursor: 'pointer', background: 'var(--bg3)', border: '1px solid var(--accent)', color: 'var(--text)' }}>เปิดใบซ่อม →</button></td>
              </tr>
            ))}
            {!gap.length && <tr><td style={TD} colSpan={6}>✅ ไม่มี — เครื่องที่หยุดซ้ำมีใบซ่อมครบแล้ว</td></tr>}
          </tbody>
        </table>
      </div>
    </Section>

    <Section title="📅 PM ที่ใกล้ครบกำหนด (14 วันข้างหน้า)">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ ...tableSt, minWidth: 520 }}>
          <thead><tr><th style={TH}>อุปกรณ์</th><th style={TH}>ไลน์</th><th style={TH}>ครบกำหนด</th><th style={THR}>เหลือ (วัน)</th></tr></thead>
          <tbody>
            {[...overdue, ...dueSoon].slice(0, 12).map(p => (
              <tr key={p.id}>
                <td style={{ ...TD, fontWeight: 700 }}>{p.name}</td>
                <td style={TD}>{p.line || '-'}</td>
                <td style={TD}>{fmtDate(p.next_due_date)}</td>
                <td style={{ ...TDR, color: p.days < 0 ? '#ef4444' : p.days <= 7 ? '#f59e0b' : 'var(--muted)', fontWeight: 700 }}>
                  {p.days < 0 ? `เกิน ${Math.abs(p.days)}` : p.days}
                </td>
              </tr>
            ))}
            {!overdue.length && !dueSoon.length && <tr><td style={TD} colSpan={4}>ไม่มีแผนที่ครบกำหนดใน 14 วัน</td></tr>}
          </tbody>
        </table>
      </div>
    </Section>

    <Section title="🔗 ทางลัด">
      <Links navigate={navigate} items={[['/dept-dashboard?dept=maintenance&view=andon', '🚨 จอห้องช่าง (Andon)', callMtn.length || null], ['/mtn-repair', '🛠️ แจ้งซ่อม MO', scopedMo.length], ['/pm?tab=plan', '📅 แผน PM', overdue.length], ['/pm?tab=forecast', '🔧 PM ล่วงหน้า'], ['/daily-checker', '✅ Daily Checker'], ['/mtn-layout', '🗺️ ผังเครื่องจักร']]} />
    </Section>
  </>);
}

/* ═══════════════════════ 3) สโตร์ / คลัง ═══════════════════════════════════════════════ */
async function loadStore(ctx) {
  const { workDate, inScope } = ctx;
  const next = dayAdd(workDate, 1);
  const [stk, std, rounds, deliv, pr, ordToday] = await Promise.all([
    // แบ่งหน้า — view โตเกิน 1000 แถวเมื่อไหร่ ยอด on-hand หายเงียบแล้ว Min/Max เตือนผิด (QC flow-audit #30)
    fetchAllPages(() => supabaseDR.from('line_stock_summary')
      .select('line_name, mat_no, part_name, qty_on_hand'), { orderBy: ['line_name', 'mat_no'] }),
    supabaseDR.from('kanban_standards').select('mat_no, part_name, min_qty, max_qty').eq('is_active', true),
    supabaseDR.from('kanban_delivery_rounds').select('line_name, shift, round_no, delivery_time, cutoff_time').eq('is_active', true),
    supabaseDR.from('kanban_deliveries').select('line_name, shift, round_no, confirmed_at, received_status').eq('work_date', workDate),
    supabaseDR.from('purchase_requests').select('mat_no, part_name, dest_line, supplier, status, work_date').in('status', ['pending', 'ordered']),
    supabaseDR.from('customer_shipping_orders').select('*').in('due_date', [workDate, next]),
  ]);
  return {
    stk: (stk.rows || []).filter(s => !s.line_name || inScope(s.line_name)),
    std: std.data || [], rounds: (rounds.data || []).filter(r => inScope(r.line_name)),
    deliv: deliv.data || [], pr: pr.data || [], ord: ordToday.data || [],
  };
}

function StoreView({ d, ctx }) {
  const { workDate, navigate, isMobile } = ctx;
  const stdBy = useMemo(() => { const m = {}; d.std.forEach(s => { m[s.mat_no] = s; }); return m; }, [d.std]);

  // รวม on-hand ต่อ mat แล้วเทียบ Min/Max (กติกาเดียวกับหน้าเฝ้าระวังสต๊อก)
  const matRows = useMemo(() => {
    const by = {};
    d.stk.forEach(s => { const o = (by[s.mat_no] ||= { mat_no: s.mat_no, name: s.part_name, qty: 0 }); o.qty += +s.qty_on_hand || 0; });
    return Object.values(by).map(o => {
      const st = stdBy[o.mat_no] || {};
      const min = +st.min_qty || 0, max = +st.max_qty || 0;
      return { ...o, name: o.name || st.part_name || o.mat_no, min, max, short: min > 0 ? min - o.qty : 0, over: max > 0 ? o.qty - max : 0 };
    });
  }, [d.stk, stdBy]);
  const under = matRows.filter(r => r.min > 0 && r.short > 0).sort((a, b) => b.short - a.short);
  const over = matRows.filter(r => r.max > 0 && r.over > 0).sort((a, b) => b.over - a.over);

  // รอบส่งวันนี้: เลยเวลาแล้วยังไม่ยืนยัน / รับไม่ครบ
  const nowHM = new Date().toTimeString().slice(0, 5);
  const delivKey = (r) => `${r.line_name}|${r.shift}|${r.round_no}`;
  const dMap = useMemo(() => { const m = {}; d.deliv.forEach(x => { m[delivKey(x)] = x; }); return m; }, [d.deliv]);
  const lateRounds = d.rounds.filter(r => {
    const got = dMap[delivKey(r)];
    return r.delivery_time && r.delivery_time < nowHM && !got?.confirmed_at;
  });
  const partial = d.deliv.filter(x => x.received_status && x.received_status !== 'full');
  const prLate = d.pr.filter(p => p.work_date && p.work_date < workDate);

  const shipped = d.ord.filter(o => o.status === 'shipped' || o.shipped_at).length;
  const ordTotal = d.ord.length;

  const actions = [
    ...lateRounds.map(r => ({ icon: '⏰', title: `รอบส่งเลยเวลา — ${r.line_name}`, detail: `รอบ ${r.round_no} · ${r.delivery_time}`, tag: 'ยังไม่ยืนยัน', tagColor: '#ef4444', to: '/heijunka' })),
    ...partial.map(x => ({ icon: '📦', title: `รับไม่ครบ — ${x.line_name}`, detail: `รอบ ${x.round_no}`, tag: x.received_status, tagColor: '#f59e0b', to: '/line-stock' })),
    ...prLate.map(p => ({ icon: '🧾', title: `สั่งซื้อค้าง — ${p.part_name || p.mat_no}`, detail: `${p.supplier || ''} → ${p.dest_line || ''}`, age: daysSince(`${p.work_date}T08:00:00`), tag: p.status, tagColor: '#f59e0b', to: '/line-stock' })),
    ...under.slice(0, 5).map(r => ({ icon: '🟥', title: `ต่ำกว่า Min — ${r.name}`, detail: `คงเหลือ ${fmtNum(r.qty)} · Min ${fmtNum(r.min)}`, tag: `ขาด ${fmtNum(r.short)}`, tagColor: '#ef4444', to: '/store-monitor' })),
  ];

  return (<>
    <Section title="🚨 ต้องทำตอนนี้" sub={`รอบส่งเลยเวลา ${lateRounds.length} · รับไม่ครบ ${partial.length} · สั่งซื้อค้าง ${prLate.length} · ต่ำกว่า Min ${under.length}`} tone={actions.length ? 'alert' : null}>
      <ActionList items={actions} onPick={(it) => navigate(it.to)} />
    </Section>

    <div style={KPI_GRID(isMobile)}>
      <Kpi label="🟥 ต่ำกว่า Min" value={under.length} unit="พาร์ท" color={under.length ? '#ef4444' : '#22c55e'} sub="เทียบ kanban_standards" />
      <Kpi label="🟧 เกิน Max" value={over.length} unit="พาร์ท" color={over.length ? '#f59e0b' : '#22c55e'} sub="สต๊อกค้างเกินจำเป็น" />
      <Kpi label="🚚 รอบส่งวันนี้" value={`${d.rounds.length - lateRounds.length}/${d.rounds.length}`} color={lateRounds.length ? '#f59e0b' : '#22c55e'} sub={`เลยเวลายังไม่ยืนยัน ${lateRounds.length}`} />
      <Kpi label="📤 ออเดอร์ลูกค้าวันนี้" value={`${shipped}/${ordTotal}`} color={ordTotal && shipped < ordTotal ? '#f59e0b' : '#22c55e'} sub="ส่งแล้ว / ทั้งหมด" />
      <Kpi label="🧾 ใบสั่งซื้อค้าง" value={d.pr.length} unit="รายการ" color={prLate.length ? '#ef4444' : undefined} sub={`เลยกำหนด ${prLate.length}`} />
      <Kpi label="🔩 พาร์ทที่มีสต๊อก" value={matRows.length} unit="รายการ" sub={`ตั้ง Min/Max แล้ว ${matRows.filter(r => r.min > 0 || r.max > 0).length}`} />
    </div>

    <Section title="📈 พาร์ทที่ต้องเติมก่อน" sub="เรียงจากขาดมากสุดเทียบ Min">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ ...tableSt, minWidth: 600 }}>
          <thead><tr><th style={TH}>MAT</th><th style={TH}>ชื่อ</th><th style={THR}>คงเหลือ</th><th style={THR}>Min</th><th style={THR}>ขาด</th></tr></thead>
          <tbody>
            {under.slice(0, 12).map(r => (
              <tr key={r.mat_no}>
                <td style={{ ...TD, fontWeight: 700 }}>{r.mat_no}</td>
                <td style={{ ...TD, fontSize: 12 }}>{r.name}</td>
                <td style={TDR}>{fmtNum(r.qty)}</td><td style={TDR}>{fmtNum(r.min)}</td>
                <td style={{ ...TDR, color: '#ef4444', fontWeight: 700 }}>-{fmtNum(r.short)}</td>
              </tr>
            ))}
            {!under.length && <tr><td style={TD} colSpan={5}>✅ ไม่มีพาร์ทต่ำกว่า Min</td></tr>}
          </tbody>
        </table>
      </div>
    </Section>

    <Section title="🔗 ทางลัด">
      <Links navigate={navigate} items={[['/line-stock', '📦 Store'], ['/store-monitor', '🚨 เฝ้าระวังสต๊อก', under.length], ['/heijunka', '🎴 Kanban'], ['/customer-demand', '🚚 Delivery'], ['/rundown-stock', '📉 Rundown']]} />
    </Section>
  </>);
}

/* ═══════════════════════ 4) QA / คุณภาพ ═══════════════════════════════════════════════ */
async function loadQa(ctx) {
  const { workDate, inScope } = ctx;
  const d7 = dayAdd(workDate, -6), d30 = dayAdd(workDate, -29);
  const [{ data: sess }, fourM, lpa] = await Promise.all([
    supabaseDR.from('production_sessions').select('id, line_name, work_date, shift, status, actual_qty').gte('work_date', d7).lte('work_date', workDate),
    supabase.from('four_m_logs').select('id, work_date, line_name, category, description, status').eq('status', 'pending_qa').order('work_date').limit(100),
    supabase.from('lpa_audits').select('id, audit_date, line_name, shift, layer, station, lpa_audit_answers(answer, note, question_text)').gte('audit_date', d30).limit(200),
  ]);
  const scoped = (sess || []).filter(s => inScope(s.line_name));
  const ids = scoped.map(s => s.id);
  /* ⚠️ defect_logs **ไม่มีคอลัมน์ `mat_no`** (mat มาจาก prod_orders) และ dr_defect_types ใช้ `name_th` ไม่ใช่ `name`
     เดิม select ผิดทั้ง 2 จุด → 42703 → `defs = []` เงียบๆ → KPI ของเสีย/PPM/พาเรโตของ QA เป็น 0 มาตลอด
     → เช็ค error ด้วย ไม่งั้นบั๊กชนิดเดียวกันซ่อนตัวได้อีก (supabase-js คืน { error } ไม่ throw) */
  /* ⚠️ 7 วัน ≈ 200 กะ → prod_orders ~700+ แถวและโตตาม adoption — ต้องผ่าน fetchByIds
     (แบ่งก้อน id + แบ่งหน้า) ไม่งั้นตัวส่วน PPM ขาดเงียบ = PPM สูงเกินจริง (QC audit · T3-14) */
  const [defRes, ordRes] = await Promise.all([
    fetchByIds(ids, c => supabaseDR.from('defect_logs').select('id, session_id, qty_ng, qty_suspect, description, prod_orders(mat_no), dr_defect_types(name_th)').in('session_id', c)),
    fetchByIds(ids, c => supabaseDR.from('prod_orders').select('id, session_id, status, qty, qty_ok, qty_actual').in('session_id', c)),
  ]);
  if (defRes.error) console.warn('[deptDashboard/qa] โหลดของเสียไม่สำเร็จ', defRes.error);
  if (ordRes.error) console.warn('[deptDashboard/qa] โหลดใบผลิตไม่สำเร็จ', ordRes.error);
  const defs = defRes.rows, orders = ordRes.rows;
  /* ลูปปิด 8D → PE: CAPA ที่ปิดแล้ว เอกสาร PFMEA/Control Plan ตามแก้หรือยัง (IATF §10.2.3/10.2.4)
     ⚠️ best-effort — ยังไม่ apply migration 20260817 = คอลัมน์/ตารางไม่มี ต้องไม่ทำทั้งหน้าพัง */
  let capa = [], crOpen = 0, claims = [];
  try {
    /* ⚠️ คอลัมน์ของเฟส 4 (eff_*) อาจยังไม่ apply → ลองเต็มก่อน เจอ 42703 ค่อยถอยไปชุดเดิม
       ห้ามให้ column เดียวที่ขาด ทำ KPI ลูปปิดหายทั้งแผง */
    const capaFull = 'id, capa_no, title, status, due_date, pe_review_status, closed_at, d6_effective_from, eff_window_days, eff_verdict';
    const [cpRes, { count: n }, { data: cl }] = await Promise.all([
      supabase.from('qa_capa').select(capaFull).order('created_at', { ascending: false }).limit(200),
      supabase.from('pe_change_requests').select('id', { count: 'exact', head: true }).in('status', ['proposed', 'accepted']),
      supabase.from('qa_customer_claims').select('id, claim_no, claim_date, customer, part_no, defect_desc, status, due_reply_date, replied_at, capa_id').order('claim_date', { ascending: false }).limit(200),
    ]);
    capa = cpRes.data || [];
    if (cpRes.error?.code === '42703') {
      const { data: cp2 } = await supabase.from('qa_capa')
        .select('id, capa_no, title, status, due_date, pe_review_status, closed_at').order('created_at', { ascending: false }).limit(200);
      capa = cp2 || [];
    }
    crOpen = n || 0; claims = cl || [];
  } catch { /* ไม่มีตาราง = ถือว่ายังไม่เปิดใช้ ลูปนี้ */ }
  return { sess: scoped, defs: defs || [], orders: orders || [], capa, crOpen, claims,
    loadErr: !!(defRes.error || ordRes.error),
    fourM: (fourM.data || []).filter(f => !f.line_name || inScope(f.line_name)), lpa: (lpa.data || []).filter(a => inScope(a.line_name)) };
}

function QaView({ d, ctx }) {
  const { workDate, navigate, isMobile } = ctx;
  const sMap = useMemo(() => { const m = {}; d.sess.forEach(s => { m[s.id] = s; }); return m; }, [d.sess]);

  const ng7 = d.defs.reduce((a, x) => a + (+x.qty_ng || 0) + (+x.qty_suspect || 0), 0);
  const ok7 = d.orders.reduce((a, o) => a + (o.status === 'confirmed' ? (o.qty_ok ?? o.qty ?? 0) : (o.qty_actual ?? 0)), 0);
  const ppm = (ok7 + ng7) > 0 ? Math.round(ng7 / (ok7 + ng7) * 1e6) : null;   // กฎ Q: หารด้วยผลิตจริง (ดี+เสีย)

  // ⭐ adoption: ไลน์ที่เดินกะวันนี้ แต่ยังไม่มีบันทึกของเสียเลย (ของดี 100% จริง หรือยังไม่ได้ลง?)
  const todaySess = d.sess.filter(s => s.work_date === workDate);
  const loggedLines = new Set(d.defs.map(x => sMap[x.session_id]?.line_name).filter(Boolean).filter(l =>
    d.defs.some(x => sMap[x.session_id]?.line_name === l && sMap[x.session_id]?.work_date === workDate)));
  const ranLines = [...new Set(todaySess.map(s => s.line_name))];
  const noLog = ranLines.filter(l => !loggedLines.has(l));

  // LPA: ข้อที่ตอบ N/T (พบปัญหา) 30 วัน
  const lpaIssues = useMemo(() => d.lpa.flatMap(a => (a.lpa_audit_answers || [])
    .filter(x => x.answer === 'N' || x.answer === 'T')
    .map(x => ({ ...x, audit_date: a.audit_date, line_name: a.line_name, layer: a.layer, station: a.station }))
  ).sort((a, b) => (a.audit_date < b.audit_date ? 1 : -1)), [d.lpa]);

  /* ── ลูปปิด 8D → เอกสาร PE ── */
  const capa = d.capa || [];
  const capaClosed = capa.filter(c => c.status === 'closed');
  const peDone = capaClosed.filter(c => c.pe_review_status === 'done' || c.pe_review_status === 'na').length;
  const peRate = capaClosed.length ? Math.round(peDone / capaClosed.length * 100) : null;
  const capaOpen = capa.filter(c => c.status !== 'closed');
  /* ปิดปัญหาไปแล้วแต่ยังไม่ตอบเรื่องเอกสาร = ช่องว่างที่ auditor ถามแน่ */
  const capaNoPe = capaClosed.filter(c => (c.pe_review_status || 'pending') === 'pending');

  /* ── ประสิทธิผล (เฟส 4 · IATF §10.2.4) ──
     ปิดใบไปแล้วแต่ตัวเลขจริงบอกว่าของเสียไม่ลด = ปัญหายังอยู่ ต้องเปิดใหม่
     ⚠️ นับเฉพาะใบที่ "วัดได้จริง" — verdict กลุ่ม too_early/no_* คือ "ยังไม่รู้" ไม่ใช่ "ไม่ได้ผล" */
  const capaBadEff = capaClosed.filter(c => c.eff_verdict === 'not_effective' || c.eff_verdict === 'worse');
  const capaMeasured = capaClosed.filter(c => ['effective', 'partial', 'not_effective', 'worse'].includes(c.eff_verdict));
  const effRate = capaMeasured.length
    ? Math.round(capaMeasured.filter(c => c.eff_verdict === 'effective').length / capaMeasured.length * 100) : null;
  /* ใบที่ส่งตรวจประสิทธิผลแล้ว และหน้าต่างวัดผลครบแล้ว = ถึงเวลาสรุป (ไม่ใช่ปล่อยค้าง) */
  const capaDueVerify = capa.filter(c => c.status === 'verify' && c.d6_effective_from
    && dayAdd(c.d6_effective_from, Number(c.eff_window_days) || 30) <= workDate);

  /* ── เคลมลูกค้า — ของเสียที่หลุดออกไปถึงลูกค้าแล้ว (ระดับความเร่งด่วนสูงสุดของ QA) ── */
  const claims = d.claims || [];
  const claimOpen = claims.filter(c => c.status !== 'closed');
  const claimLate = claimOpen.filter(c => c.due_reply_date && c.due_reply_date < workDate && !c.replied_at);
  const claimNo8D = claimOpen.filter(c => !c.capa_id);

  const defRecords = d.defs.map(x => ({
    cat: x.dr_defect_types?.name_th || 'ไม่ระบุประเภท', value: (+x.qty_ng || 0) + (+x.qty_suspect || 0),
    line: sMap[x.session_id]?.line_name || '-', product: x.prod_orders?.mat_no || '(ไม่ระบุ)',
    shift: sMap[x.session_id]?.shift === 'night' ? 'กะดึก' : 'กะเช้า', date: sMap[x.session_id]?.work_date, note: x.description || '',
  })).filter(r => r.value > 0);

  const actions = [
    ...d.fourM.map(f => ({ icon: '📝', title: `4M รออนุมัติ QA — ${f.line_name || '-'}`, detail: (f.description || '').slice(0, 40), age: daysSince(`${f.work_date}T08:00:00`), tag: f.category, tagColor: '#f59e0b', to: fourMLink(f) })),
    ...noLog.map(l => ({ icon: '❔', title: `${l} — ยังไม่มีบันทึกของเสียวันนี้`, detail: 'ของดี 100% จริง หรือยังไม่ได้ลงบันทึก?', tag: 'ตรวจสอบ', tagColor: '#f59e0b', to: '/daily-report' })),
    /* เคลมลูกค้าขึ้นก่อนเสมอ — ลูกค้ารออยู่ */
    ...claimLate.slice(0, 5).map(c => ({ icon: '⏰', title: `เลยกำหนดตอบลูกค้า — ${c.claim_no} (${c.customer})`,
      detail: (c.defect_desc || '').slice(0, 45), age: daysSince(`${c.due_reply_date}T08:00:00`),
      tag: 'ด่วน', tagColor: '#ef4444', to: '/qa?tab=claims' })),
    ...claimNo8D.slice(0, 5).map(c => ({ icon: '📮', title: `${c.claim_no} ยังไม่ได้เปิด 8D`,
      detail: `${c.customer} · ${(c.defect_desc || '').slice(0, 40)}`, age: daysSince(`${c.claim_date}T08:00:00`),
      tag: 'ต้องมี 8D', tagColor: '#f59e0b', to: '/qa?tab=claims' })),
    /* ปิดไปแล้วแต่ของเสียไม่ลด — แรงกว่าเรื่องเอกสาร เพราะปัญหายังเกิดอยู่จริง */
    ...capaBadEff.slice(0, 5).map(c => ({ icon: '📉', title: `${c.capa_no} ปิดแล้ว แต่ของเสีย${c.eff_verdict === 'worse' ? 'เพิ่มขึ้น' : 'ยังไม่ลด'}`,
      detail: `${(c.title || '').slice(0, 40)} — ต้องกลับไปทบทวน D4 สาเหตุราก`, age: c.closed_at ? daysSince(c.closed_at) : null,
      tag: 'ไม่ได้ผล', tagColor: '#ef4444', to: '/qa?tab=capa' })),
    ...capaDueVerify.slice(0, 5).map(c => ({ icon: '⏱️', title: `${c.capa_no} ครบกำหนดวัดผลแล้ว — ยังไม่สรุป`,
      detail: `มาตรการมีผล ${c.d6_effective_from} · ครบ ${c.eff_window_days || 30} วันแล้ว`, age: daysSince(`${c.d6_effective_from}T08:00:00`),
      tag: 'รอสรุปผล', tagColor: '#f59e0b', to: '/qa?tab=capa' })),
    ...capaNoPe.slice(0, 5).map(c => ({ icon: '🔗', title: `${c.capa_no} ปิดแล้ว แต่ยังไม่ทบทวน PFMEA/Control Plan`,
      detail: (c.title || '').slice(0, 45), age: c.closed_at ? daysSince(c.closed_at) : null,
      tag: 'IATF 10.2.4', tagColor: '#ef4444', to: '/qa?tab=capa' })),
    ...(d.crOpen ? [{ icon: '📥', title: `คำขอแก้เอกสาร PE ค้าง ${d.crOpen} รายการ`,
      detail: 'ทีม PE ยังไม่ได้พิจารณา/ออก revision', tag: 'รอ PE', tagColor: '#f59e0b', to: '/pe-docs' }] : []),
    ...lpaIssues.slice(0, 5).map(x => ({ icon: '📋', title: `LPA พบปัญหา — ${x.line_name}`, detail: `${(x.question_text || '').slice(0, 45)}${x.note ? ' · ' + x.note.slice(0, 25) : ''}`, age: daysSince(`${x.audit_date}T08:00:00`), tag: x.answer === 'N' ? 'ไม่ผ่าน' : 'เฝ้าระวัง', tagColor: x.answer === 'N' ? '#ef4444' : '#f59e0b', to: '/daily-checker?tab=lpa' })),
  ];

  return (<>
    {/* "0 ของเสีย" กับ "โหลดไม่ได้" ต้องแยกออกจากกัน — ไม่งั้นจอที่พังอยู่ดูเหมือนจอที่ทุกอย่างปกติ */}
    {d.loadErr && (
      <div style={{ ...cardSt, borderColor: '#ef444488', background: '#ef444414', color: '#ef4444', fontSize: 12, fontWeight: 700, padding: '10px 13px' }}>
        🔴 โหลดข้อมูลของเสีย/ใบผลิตไม่สำเร็จ — ตัวเลขของเสีย · PPM · พาเรโต ด้านล่าง<b>ไม่ครบ</b> (ดูรายละเอียดใน console)
      </div>
    )}
    <Section title="🚨 ต้องทำตอนนี้" sub={`4M รออนุมัติ QA ${d.fourM.length} · ไลน์ที่ยังไม่บันทึกของเสียวันนี้ ${noLog.length} · LPA พบปัญหา 30 วัน ${lpaIssues.length}`} tone={actions.length ? 'alert' : null}>
      <ActionList items={actions} onPick={(it) => navigate(it.to)} />
    </Section>

    <div style={KPI_GRID(isMobile)}>
      <Kpi label="🚫 ของเสีย 7 วัน" value={fmtNum(ng7)} unit="ชิ้น" color={ng7 ? '#ef4444' : '#22c55e'} sub={`ผลิตดี ${fmtNum(ok7)} ชิ้น`} />
      <Kpi label="📉 PPM (7 วัน)" value={ppm == null ? '—' : fmtNum(ppm)} color={ppm == null ? undefined : ppm > 5000 ? '#ef4444' : ppm > 1000 ? '#f59e0b' : '#22c55e'}
        sub="เสีย ÷ (ดี+เสีย) × 1,000,000" />
      <Kpi label="✍️ ไลน์ที่บันทึกของเสียวันนี้" value={`${ranLines.length - noLog.length}/${ranLines.length}`}
        color={noLog.length ? '#f59e0b' : '#22c55e'} sub="ไลน์ที่เดินกะวันนี้" />
      <Kpi label="📝 4M รออนุมัติ QA" value={d.fourM.length} unit="ใบ" color={d.fourM.length ? '#f59e0b' : '#22c55e'} sub="ค้างที่ QA" />
      <Kpi label="📋 LPA พบปัญหา" value={lpaIssues.length} unit="ข้อ" color={lpaIssues.length ? '#f59e0b' : '#22c55e'} sub="ตอบ N/T ใน 30 วัน" />
      <Kpi label="🧾 การตรวจ LPA" value={d.lpa.length} unit="ครั้ง" sub="30 วันล่าสุด" />
      <Kpi label="📮 เคลมลูกค้าที่ยังไม่ปิด" value={claimOpen.length} unit="ใบ"
        color={claimLate.length ? '#ef4444' : claimOpen.length ? '#f59e0b' : '#22c55e'}
        sub={claimLate.length ? `เลยกำหนดตอบ ${claimLate.length} ใบ` : (claimNo8D.length ? `ยังไม่เปิด 8D ${claimNo8D.length} ใบ` : 'ไม่มีค้าง')} />
      <Kpi label="🔗 8D ปิดแล้ว เอกสารตามครบ" value={peRate == null ? '—' : `${peRate}%`}
        color={peRate == null ? undefined : peRate >= 90 ? '#22c55e' : peRate >= 50 ? '#f59e0b' : '#ef4444'}
        sub={capaClosed.length ? `${peDone}/${capaClosed.length} ใบ · IATF §10.2.4` : 'ยังไม่มี 8D ที่ปิด'} />
      <Kpi label="🛠 8D ค้างดำเนินการ" value={capaOpen.length} unit="ใบ" color={capaOpen.length ? '#f59e0b' : '#22c55e'}
        sub={d.crOpen ? `คำขอแก้เอกสารค้าง ${d.crOpen}` : 'ไม่มีคำขอแก้เอกสารค้าง'} />
      {/* วัดจาก defect_logs จริง ไม่ใช่ข้อความที่คนพิมพ์ — ใบที่ยังวัดไม่ได้ ไม่ถูกนับเป็นทั้งได้ผล/ไม่ได้ผล */}
      <Kpi label="📉 8D ที่ของเสียลดจริง" value={effRate == null ? '—' : `${effRate}%`}
        color={effRate == null ? undefined : effRate >= 80 ? '#22c55e' : effRate >= 50 ? '#f59e0b' : '#ef4444'}
        sub={capaMeasured.length
          ? `วัดได้ ${capaMeasured.length} ใบ${capaBadEff.length ? ` · ยังไม่ลด ${capaBadEff.length}` : ''}`
          : 'ยังไม่มีใบที่วัดผลได้ — ต้องกรอกวันที่มาตรการมีผล'} />
    </div>

    <ParetoAbcChart title="🚫 ของเสีย 7 วัน แยกตามประเภท (ABC)" records={defRecords} unit="ชิ้น"
      dims={[{ key: 'line', label: '🏭 ไลน์' }, { key: 'product', label: '📦 ชิ้นงาน' }, { key: 'shift', label: '🕐 กะ' }, { key: 'date', label: '📅 วัน' }, { key: 'note', label: '💬 หมายเหตุ', cluster: true }]}
      sectionStyle={cardSt} emptyText="ไม่มีบันทึกของเสียใน 7 วัน — ตรวจสอบว่าลงบันทึกครบหรือยัง" />

    <Section title="🔗 ทางลัด">
      <Links navigate={navigate} items={[['/qa', '🔍 Quality Control'],
        // คิวอนุมัติ 4M ทั้งก้อน — from = ใบเก่าสุด (d.fourM เรียงวันจากเก่าไปใหม่) ให้เห็นครบทุกใบที่ค้าง
        [`${FOURM_TAB}&status=pending_qa${d.fourM.length ? `&from=${d.fourM[0].work_date}` : ''}`, '📝 4M รออนุมัติ', d.fourM.length],
        ['/qa?tab=claims', '📮 เคลมลูกค้า', claimOpen.length], ['/qa?tab=capa', '🛠 8D / CAPA', capaOpen.length], ['/pe-docs', '📐 PFMEA / Control Plan', d.crOpen],
        ['/qa-setup', '📐 มาตรฐานการตรวจ'], ['/daily-checker?tab=lpa', '📋 LPA', lpaIssues.length], ['/scrap-report', '♻️ ใบรายงานของเสีย'], ['/event-log', '⚡ CQI-15']]} />
    </Section>
  </>);
}

/* ═══ config ส่วนงาน — เพิ่มส่วนงานใหม่ = เพิ่ม entry ตรงนี้ (ห้ามสร้างหน้าใหม่) ═══════ */
/* export ไว้ให้ทดสอบ/ตรวจสอบได้จากภายนอก (smoke render แต่ละ View) */
export const DEPTS = [
  { key: 'production', icon: '🏭', label: 'ฝ่ายผลิต', roles: ['leader', 'supervisor', 'manager', 'admin'], load: loadProduction, View: ProductionView },
  { key: 'maintenance', icon: '🔧', label: 'ซ่อมบำรุง', roles: ['mtn', 'engineer'], load: loadMaintenance, View: MaintenanceView },
  { key: 'store', icon: '📦', label: 'สโตร์', roles: ['planner_store', 'sale'], load: loadStore, View: StoreView },
  { key: 'qa', icon: '✅', label: 'QA / คุณภาพ', roles: ['qa'], load: loadQa, View: QaView },
];

export default function DeptDashboard() {
  const { role, lineId, sections } = useContext(UserContext);
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const defDept = DEPTS.find(x => x.roles.includes(role))?.key || 'production';
  const dept = DEPTS.find(x => x.key === sp.get('dept'))?.key || defDept;
  /* ⚠️ หน้านี้ "ไม่" ใช้ useTabParam เหมือนหน้าอื่นโดยตั้งใจ — ค่า default ของ ?dept= ขึ้นกับ role ของคนดู
     (ช่างเปิดมาเจอซ่อมบำรุง · QA เจอ QA) ถ้าใช้ hook ตัวนั้น แท็บที่เป็น default จะถูกตัดออกจาก URL
     → แชร์ลิงก์ให้คนละ role แล้วเห็นคนละส่วนงาน · ที่นี่จึงเขียน ?dept= ลง URL เสมอทุกครั้ง */
  const setDept = (k) => { const n = new URLSearchParams(sp); n.set('dept', k); setSp(n); };
  // มุมมอง: 'now' = งานวันนี้ (เดิม) · 'kpi' = 📑 KPI รายเดือน (2026-08-24 · คำสั่ง user — แทนแพ็คกระดาษ
  // Internal Defect/OEE รายเดือนที่ปริ้นเซ็นกัน) — ใช้ param แยกจาก ?dept= ตามกฎแท็บซ้อนแท็บ §6.8
  /* 'andon' = จอห้องช่าง (เฉพาะส่วนงานซ่อมบำรุง — จอ TV ในห้องช่างต้องเห็นเครื่องหยุด + มีเสียงเตือน
     ซึ่ง /factory-map ที่เคยเปิดอยู่ให้ไม่ได้ · feedback หน้างาน 2026-08-24) */
  const rawView = sp.get('view');
  const view = rawView === 'kpi' ? 'kpi' : (rawView === 'andon' && dept === 'maintenance') ? 'andon' : 'now';
  const setView = (v) => { const n = new URLSearchParams(sp); if (v === 'now') n.delete('view'); else n.set('view', v); setSp(n); };
  const cfg = DEPTS.find(x => x.key === dept);

  const [lines, setLines] = useState([]);
  /* ⚠️ data ต้องผูกกับส่วนงานที่โหลดมาเสมอ (`{ dept, d }`)
     ตอนสลับแท็บ React จะ render View ของส่วนงานใหม่ "ก่อน" effect โหลดข้อมูลจะวิ่ง
     ถ้าเก็บแต่ก้อนข้อมูลเปล่า View ใหม่จะได้ข้อมูลรูปทรงของส่วนงานเก่า → พังทันที
     (เคสจริง: สลับไปซ่อมบำรุงแล้วเจอ "Cannot read properties of undefined (reading 'forEach')") */
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const workDate = getWorkDate();

  useEffect(() => {
    supabase.from('production_lines').select('id, name, section, parent_line_name')
      .then(({ data }) => setLines(data || []));
  }, []);

  // helper กลางคืน array (null = ไม่จำกัด) → แปลงเป็น Set ตรงนี้เพื่อให้ inScope เช็คเร็ว
  const scopeSet = useMemo(() => {
    const names = scopedLineNames({ role, lineId, sections, lines });
    return names ? new Set(names) : null;
  }, [lines, role, lineId, sections]);
  const inScope = useCallback((name) => !scopeSet || !name || scopeSet.has(name), [scopeSet]);

  const ctx = useMemo(() => ({
    workDate, prevDate: dayAdd(workDate, -1), lines, inScope, navigate, isMobile, role,
  }), [workDate, lines, inScope, navigate, isMobile, role]);

  const load = useCallback(async () => {
    if (!lines.length) return;
    setLoading(true); setErr(null);
    try { const d = await cfg.load(ctx); setData({ dept: cfg.key, d }); }
    catch (e) { setErr(e?.message || 'โหลดข้อมูลไม่สำเร็จ'); setData(null); }
    finally { setLoading(false); }
  }, [cfg, ctx, lines.length]);
  useEffect(() => { load(); }, [load]);

  const scopeText = scopeSet ? `${scopeSet.size} ไลน์ในขอบเขตของคุณ` : 'ทุกไลน์';

  return (
    // จอห้องช่าง (andon) เป็นบอร์ด TV — ไม่ cap 1800px (กติกาเดียวกับ Dashboard/Management ที่ใช้เต็มจอ)
    <div style={{ maxWidth: view === 'andon' ? undefined : 'min(97vw, 1800px)', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between', paddingRight: 52 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: isMobile ? 19 : 23 }}>📊 Dashboard ส่วนงาน</h2>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
            {view === 'andon'
              ? <>จอ TV ห้องช่าง · วันงาน {fmtDate(workDate)} · {scopeText} · อัปเดตเอง มีเสียงเตือนเมื่อมีคนกด “เรียกช่าง”</>
              : <>วันงาน {fmtDate(workDate)} · {scopeText} · อ่านอย่างเดียว (กดที่รายการเพื่อไปหน้าที่ทำงานจริง)</>}
          </div>
        </div>
        <button onClick={load} style={{ padding: '7px 12px', fontSize: 13, fontWeight: 600, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, color: 'var(--text)', cursor: 'pointer' }}>🔄 รีเฟรช</button>
      </div>

      {/* สลับมุมมอง: งานวันนี้ / KPI รายเดือน */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {[{ k: 'now', label: '⚡ งานวันนี้' }, ...(dept === 'maintenance' ? [{ k: 'andon', label: '🚨 จอห้องช่าง' }] : []), { k: 'kpi', label: '📑 KPI รายเดือน' }].map(v => (
          <button key={v.k} onClick={() => setView(v.k)} style={{
            fontSize: 13, fontWeight: 700, padding: '6px 13px', borderRadius: 8, cursor: 'pointer',
            background: view === v.k ? 'var(--bg3)' : 'transparent',
            color: view === v.k ? 'var(--text)' : 'var(--muted)',
            border: `1px solid ${view === v.k ? 'var(--border2)' : 'transparent'}`,
          }}>{v.label}</button>
        ))}
      </div>

      {/* เลือกส่วนงาน — เฉพาะมุมมองงานวันนี้ (KPI มี section picker ของตัวเองยึด org_nodes) */}
      {view !== 'kpi' && (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {DEPTS.map(t => (
          <button key={t.key} onClick={() => setDept(t.key)} style={{
            fontSize: 13.5, fontWeight: 700, padding: '7px 14px', borderRadius: 999, cursor: 'pointer',
            background: dept === t.key ? 'var(--accent)' : 'var(--bg3)',
            color: dept === t.key ? '#08120a' : 'var(--text)',
            border: `1px solid ${dept === t.key ? 'var(--accent)' : 'var(--border2)'}`,
          }}>{t.icon} {t.label}</button>
        ))}
      </div>
      )}

      {view === 'kpi' && (
        <Suspense fallback={<div style={{ ...cardSt, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>กำลังโหลด...</div>}>
          <KpiMonthly lines={lines} scopeSet={scopeSet} isMobile={isMobile} />
        </Suspense>
      )}

      {view === 'andon' && err && <div style={{ ...cardSt, borderColor: '#ef4444', color: '#ef4444', fontSize: 13 }}>โหลดข้อมูลไม่สำเร็จ: {err}</div>}
      {view === 'andon' && loading && <div style={{ ...cardSt, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>กำลังโหลดข้อมูล...</div>}
      {view === 'andon' && !loading && !err && data?.dept === 'maintenance' && (
        <Suspense fallback={<div style={{ ...cardSt, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>กำลังโหลด...</div>}>
          <MtnAndonBoard d={data.d} ctx={ctx} />
        </Suspense>
      )}
      {view === 'now' && loading && <div style={{ ...cardSt, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>กำลังโหลดข้อมูล...</div>}
      {view === 'now' && err && <div style={{ ...cardSt, borderColor: '#ef4444', color: '#ef4444', fontSize: 13 }}>โหลดข้อมูลไม่สำเร็จ: {err}</div>}
      {/* render เฉพาะเมื่อข้อมูลที่ถืออยู่เป็นของส่วนงานที่กำลังดู */}
      {view === 'now' && !loading && !err && data?.dept === dept && <cfg.View d={data.d} ctx={ctx} />}
      {view === 'now' && !loading && !err && data && data.dept !== dept &&
        <div style={{ ...cardSt, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>กำลังเปลี่ยนส่วนงาน...</div>}
    </div>
  );
}
