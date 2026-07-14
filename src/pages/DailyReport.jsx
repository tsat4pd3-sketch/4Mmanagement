import { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { fmtDate, fmtDateTime, fmtDateTimeFull, fmtTime } from '../utils/dateFormat';
import { toast } from '../components/Toast';
import tsLogoUrl from '../assets/TS logo.png';
import { can } from '../utils/permissions';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import useIsMobile from '../utils/useIsMobile';

// โหลดโลโก้บริษัท (เหมือนหน้าเว็บ) เป็น base64 ครั้งเดียวสำหรับฝัง PDF
let tsLogoDataUrlPromise = null;
function getTsLogoDataUrl() {
  if (!tsLogoDataUrlPromise) {
    tsLogoDataUrlPromise = fetch(tsLogoUrl)
      .then(r => r.blob())
      .then(blob => new Promise(resolve => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      }))
      .catch(() => null);
  }
  return tsLogoDataUrlPromise;
}

function notifyProdClose(payload) {
  fetch(`https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-notification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
    body: JSON.stringify({ event: 'prod_close', session: payload }),
  }).catch(() => {});
}

// แจ้งเตือน Telegram ทันทีที่พนักงานบันทึก Downtime — fire-and-forget ไม่บล็อกการบันทึก
// event: 'downtime' (เครื่องหยุดใหม่) | 'downtime_recovered' (ปิดรายการที่เปิดค้าง = เครื่องกลับมารันได้)
function notifyDowntime(payload, event = 'downtime') {
  fetch(`https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-notification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
    body: JSON.stringify({ event, downtime: payload }),
  }).catch(() => {});
}

// สรุปชิ้นงาน/Downtime ของกะ สำหรับแนบในข้อความแจ้งเตือนปิดกะ (Telegram)
// entries: [{ mat_no, part_name, qty, carry }] — carry = ยอดยกไปกะถัดไป
function summarizeParts(entries) {
  const map = {};
  entries.forEach(e => {
    if (!e || (!e.qty && !e.carry)) return;
    const key = e.mat_no || e.part_name || '-';
    const p = (map[key] ||= { mat_no: key, name: e.part_name || '', qty: 0, carry_qty: 0 });
    if (e.carry) p.carry_qty += e.qty || 0; else p.qty += e.qty || 0;
  });
  return Object.values(map).filter(p => p.qty > 0 || p.carry_qty > 0);
}

function summarizeDowntimes(dtLogs) {
  const map = {};
  (dtLogs || []).forEach(d => {
    const key = d.dr_downtime_types?.name_th || 'ไม่ระบุสาเหตุ';
    const a = (map[key] ||= { name: key, min: 0, count: 0, machines: [] });
    a.min += d.duration_min || 0;
    a.count += 1;
    if (d.machine_no && !a.machines.includes(d.machine_no)) a.machines.push(d.machine_no);
  });
  return Object.values(map)
    .map(a => ({ ...a, min: Math.round(a.min), machines: a.machines.slice(0, 3) }))
    .sort((x, y) => y.min - x.min);
}

/* ─── TimeInput24 — native time picker (spinner arrows + clock UI) ───
   พนักงานคลิกลูกศรขึ้น/ลงข้างตัวเลข หรือคลิกไอคอนนาฬิกาเพื่อเลือกเวลา
   ปุ่ม "ตอนนี้" เติมเวลาปัจจุบันให้ทันที ───────────────────────── */
function TimeInput24({ value = '', onChange, style = {} }) {
  const inputStyleLocal = {
    fontFamily: 'monospace', fontWeight: 700, fontSize: style.fontSize || 18,
    background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)',
    borderRadius: 6, padding: '6px 8px', colorScheme: 'dark', ...style,
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input type="time" value={value || ''} step="60"
        onChange={e => onChange?.({ target: { value: e.target.value } })}
        style={inputStyleLocal} />
      <button type="button" title="ใช้เวลาปัจจุบัน"
        onClick={() => onChange?.({ target: { value: nowTime() } })}
        style={{ fontSize: 12, fontWeight: 700, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
        🕐 ตอนนี้
      </button>
    </div>
  );
}

/* ─── Helpers ────────────────────────────────────────────────── */
// ✅ local Thai date — never toISOString() which returns UTC
const localDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today = () => localDateStr(new Date());
// work date ตามกฎ CLAUDE.md: ก่อน 08:00 = วันก่อนหน้า (กะดึกข้ามวัน) — ใช้กับทุกจุดที่เป็น work_date semantics
// ส่ง Date เข้าไปได้เพื่อหา work date ของเวลานั้นๆ (default = ตอนนี้)
const workDate = (at = new Date()) => {
  const d = new Date(at);
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return localDateStr(d);
};
const nowTime = () => new Date().toTimeString().slice(0, 5);
// กะเช้าเริ่ม 08:00, กะดึกเริ่ม 20:00 — ใช้เป็น default start_time เสมอ
const shiftStart = (shift) => shift === 'night' ? '20:00' : '08:00';
const currentShift = () => { const h = new Date().getHours(); return (h >= 20 || h < 8) ? 'night' : 'day'; };
const fmtMin = (min) => {
  if (!min && min !== 0) return '—';
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${m} นาที`;
};

const CAT_META = {
  unplanned: { label: 'นอกแผน', color: '#ef4444', bg: 'rgba(239,68,68,0.10)' },
  planned:   { label: 'ในแผน',  color: '#22c55e', bg: 'rgba(34,197,94,0.10)' },
};

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════════════ */
export default function DailyReport() {
  const { role } = useContext(UserContext);
  const [tab, setTab] = useState('live');

  const canSetup = can('daily_report', 'setup', role);

  return (
    <div style={{ padding: 'clamp(12px,3vw,28px)', maxWidth: 'min(96vw, 2000px)', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 'clamp(18px,3vw,26px)', fontWeight: 800, color: 'var(--text)', margin: 0 }}>
            📊 Daily Production Report
          </h1>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            บันทึกผลผลิตและ Downtime แบบ Real-time รายกะ
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg2)', borderRadius: 10, padding: 4 }}>
          {[
            { key: 'live',    label: '⚡ Live กะนี้' },
            { key: 'history', label: '📋 ประวัติ' },
            { key: 'export',  label: '📤 Export' },
            ...(canSetup ? [{ key: 'setup', label: '⚙️ ตั้งค่า' }] : []),
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                background: tab === t.key ? 'var(--accent)' : 'transparent',
                color: tab === t.key ? '#fff' : 'var(--muted)' }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'live'    && <LiveTab role={role} />}
      {tab === 'history' && <HistoryTab role={role} />}
      {tab === 'export'  && <ExportTab />}
      {tab === 'setup'   && canSetup && <SetupTab role={role} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   LIVE TAB
═══════════════════════════════════════════════════════════════ */
function LiveTab({ role }) {
  const { fullName, lineId: userLineId, sections: scopeSecs = [] } = useContext(UserContext);
  const isMobile = useIsMobile(); // ≤768px: sidebar รายชื่อกะยุบมาซ้อนบนเนื้อหา (desktop ไม่เปลี่ยน)
  const [lines, setLines]           = useState([]);
  const [lineMap, setLineMap]       = useState({});
  const [products, setProducts]     = useState([]);
  const [dtTypes, setDtTypes]       = useState([]);
  const [sessions, setSessions]     = useState([]);
  const [overdueAlert, setOverdueAlert] = useState([]);
  const [dtLogs, setDtLogs]         = useState([]);
  const [selSession, setSelSession] = useState(null);
  const [loading, setLoading]       = useState(true);
  // CT overage history — keyed by mat_no: { checked, overCount, ctSec, avgObservedCt } จากกะปิดล่าสุดของไลน์เดียวกัน
  const [ctOverage, setCtOverage]   = useState({});

  const [parentChildrenMap, setParentChildrenMap] = useState({}); // { 'HYDROFORM': ['HDF1','HDF2',...] }

  const [showOpen, setShowOpen] = useState(false);
  const [openForm, setOpenForm] = useState(() => { const s = currentShift(); return { work_date: workDate(), line_name: '', shift: s, product_id: '', start_time: shiftStart(s) }; });

  const [showDT, setShowDT]   = useState(false);
  const [dtForm, setDtForm]   = useState({ id: null, downtime_type_id: '', mode: 'start_end', start_time: '', end_time: '', duration_min: '', machine_no: '', mat_no: '', description: '' });
  const [savingDT, setSavingDT] = useState(false);

  // Prod Orders
  const [prodOrders, setProdOrders]       = useState([]);
  const [carryOrders, setCarryOrders]     = useState([]); // pending carry-over from prev session
  const [kanbanStds, setKanbanStds]       = useState([]);
  // minimize/expand แต่ละ section ใหญ่บนแท็บ Live — จำสถานะใน localStorage (dr_live_collapse_<section>)
  // ค่า default = กางเหมือนเดิม ยกเว้น section ที่ว่างเปล่าเริ่มแบบพับ (autoCollapsed)
  const [liveCollapse, setLiveCollapse] = useState(() => {
    const out = {};
    ['prod_orders', 'defects', 'downtime', 'mat_breakdown'].forEach(k => {
      try { const v = localStorage.getItem(`dr_live_collapse_${k}`); if (v != null) out[k] = v === '1'; } catch { /* localStorage ปิดใช้งาน — ใช้ default */ }
    });
    return out;
  });
  const liveCollapsed = (key, autoCollapsed = false) => liveCollapse[key] ?? autoCollapsed;
  const toggleLiveCollapse = (key, autoCollapsed = false) => setLiveCollapse(c => {
    const next = !(c[key] ?? autoCollapsed);
    try { localStorage.setItem(`dr_live_collapse_${key}`, next ? '1' : '0'); } catch { /* localStorage ปิดใช้งาน */ }
    return { ...c, [key]: next };
  });
  const prodOrdersOpen = !liveCollapsed('prod_orders'); // minimize/expand ทั้ง board (ว่างก็กางไว้ — มีปุ่ม Scan/hint ในตัว)
  const [showClosedOrders, setShowClosedOrders] = useState(false); // แยกซ่อน/แสดง order ที่ปิดแล้ว/ยกเลิก

  // Scan Open modal
  const [showScanOpen, setShowScanOpen]   = useState(false);
  const [openProdForm, setOpenProdForm]   = useState({ prod_no: '', mat_no: '', qty: '', is_backfill: false, backfill_time: '' });
  const [openProdStd, setOpenProdStd]     = useState(null);
  const openProdInputRef = useRef(null);
  const closeProdInputRef = useRef(null);
  const [savingProdOpen, setSavingProdOpen] = useState(false);
  const [pendingPairId, setPendingPairId] = useState(null); // order id ที่รอสแกนคู่ RH/LH ต่อ
  // Overflow confirmation modal
  const [overflowInfo, setOverflowInfo]   = useState(null); // { prodNo, matNo, qty, std, overMin, remainMin, newOrderMin }

  // ออเดอร์ manual — ไลน์ไม่มี kanban card (SAP ไม่ gen barcode) เช่น HDF1 → LASER CUT 123
  // leader เปิด "เป้า" เอง แล้วพนักงานอัพเดทยอดสะสมทุกช่วงเบรค ปิดใบด้วยยอดจริงไม่ต้องสแกน
  const [showManualOpen, setShowManualOpen] = useState(false);
  const [manualForm, setManualForm]         = useState({ mat_no: '', qty: '', is_backfill: false, backfill_time: '' });
  const [savingManual, setSavingManual]     = useState(false);
  const [manualQtyDraft, setManualQtyDraft] = useState({}); // order id -> ค่าที่พิมพ์ในช่องอัพเดทยอด
  const [qtyUpdatesByOrder, setQtyUpdatesByOrder] = useState({}); // order id -> [{qty_accum, qty_delta, logged_at, is_final}]

  // Scan Close modal
  const [showScanClose, setShowScanClose] = useState(false);
  const [closeProdNo, setCloseProdNo]     = useState('');
  const [closeMatch, setCloseMatch]       = useState(null);
  const [savingProdClose, setSavingProdClose] = useState(false);
  // Defect log
  const [defectTypes, setDefectTypes]   = useState([]);
  const [defectLogs, setDefectLogs]     = useState([]);
  const [showDefect, setShowDefect]     = useState(false);
  const [defectForm, setDefectForm]     = useState({ id: null, mat_no: '', defect_type_id: '', qty_ng: '0', qty_suspect: '0', qty_repair: '0', description: '' });
  const [savingDefect, setSavingDefect] = useState(false);

  // SV review-before-approve modal for pending_close requests
  const [showApproveReview, setShowApproveReview] = useState(false);

  // Close Shift modal (OEE)
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [closeNg, setCloseNg]               = useState('0');
  const [closeEndTime, setCloseEndTime]     = useState(nowTime());
  const [closeStartTime, setCloseStartTime] = useState('');
  const [savingClose, setSavingClose]       = useState(false);
  const [breakPolicies, setBreakPolicies]   = useState([]);
  const [machines, setMachines]             = useState([]);
  // Carry-over step: map of prod_order.id → 'carry' | 'cancel' | null
  const [carryOverDecisions, setCarryOverDecisions] = useState({});
  // Downtime เปิดค้างตอนปิดกะ: ต่อรายการ dtId → 'close' (เครื่องกลับมาแล้ว กรอกเวลาจบ) | 'carry' (ยังซ่อมอยู่ ตัดยอดข้ามกะ)
  const [dtCarryDecisions, setDtCarryDecisions] = useState({});
  const [dtCloseTimes,     setDtCloseTimes]     = useState({}); // dtId → 'HH:MM' เวลาที่เครื่องกลับมา
  // qty_actual produced this shift for each open order (before carry-over)
  const [carryQtyActual, setCarryQtyActual] = useState({});
  // เวลาหยุดผลิตจริงต่อออเดอร์ (ใช้แทนเวลาปิดกะรวมตอนคำนวณสรุปแยกตามชิ้นงาน เผื่อพาร์ทนี้หยุดไม่ตรงกับเวลาปิดกะ)
  const [carryStopTime, setCarryStopTime] = useState({});
  // แก้เวลาเริ่ม-หยุดจริงต่อ MAT.NO (เฉพาะ MAT.NO ที่ confirmed ครบแล้ว ไม่มีออเดอร์เปิดค้าง) — { [matNo]: { start, end } } เป็น "HH:MM"
  const [matTimeOverride, setMatTimeOverride] = useState({});
  // modal แก้เวลาย้อนหลัง (สำหรับกะที่ปิดแล้ว — ใช้คำนวณ OEE ใหม่)
  const [showEditTimes, setShowEditTimes] = useState(false);
  const [savingTimes, setSavingTimes]     = useState(false);

  const canManage        = can('daily_report', 'close_shift', role);
  const canOpen          = can('daily_report', 'open_shift', role);    // open new shift
  const canRequestClose  = can('daily_report', 'request_close', role); // request or direct-close
  const canApproveClose  = can('daily_report', 'approve_close', role); // approve pending_close
  const canScan          = can('daily_report', 'record', role);        // scan open/close, defects, downtime
  // leader แก้ไข/ลบ order, defect, downtime ได้เฉพาะตอนกะยังเปิดอยู่ (ยังไม่ส่งขออนุมัติปิดกะ) —
  // ถ้าส่งขอปิดกะแล้ว (pending_close) ต้องรอ SV อนุมัติ/ปฏิเสธก่อน ถ้าโดนปฏิเสธ สถานะจะกลับเป็น open ให้แก้ไขได้อีก
  const canEditRecords   = canManage || (role === 'leader' && selSession?.status === 'open');

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: ln }, { data: pr }, { data: dt }, { data: ks }, { data: bp }, { data: mc }, { data: dft }] = await Promise.all([
      supabase.from('production_lines').select('id, name, section, parent_line_name').order('name'),
      supabaseDR.from('dr_products').select('*').eq('is_active', true).order('name'),
      supabaseDR.from('dr_downtime_types').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('kanban_standards').select('*, dr_products(id, name, line_name, cycle_time_sec, process_type)').eq('is_active', true).order('mat_no'),
      supabaseDR.from('break_policies').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('machines').select('*').eq('is_active', true).order('line_name').order('sort_order'),
      supabaseDR.from('dr_defect_types').select('*').eq('is_active', true).order('sort_order'),
    ]);

    const lm = {};
    (ln || []).forEach(l => { lm[l.name] = l; });
    const pcm = {};
    (ln || []).forEach(l => {
      if (l.parent_line_name) {
        if (!pcm[l.parent_line_name]) pcm[l.parent_line_name] = [];
        pcm[l.parent_line_name].push(l.name);
      }
    });
    setLines(ln || []);
    setLineMap(lm);
    setParentChildrenMap(pcm);
    setProducts(pr || []);
    setDtTypes(dt || []);
    setKanbanStds(ks || []);
    setBreakPolicies(bp || []);
    setMachines(mc || []);
    setDefectTypes(dft || []);

    // Filter available lines for open-session form
    // Fetch sessions — filter by role
    // หมายเหตุ: ไม่ filter section ที่ DB query เพราะ production_sessions.section เป็นค่าที่ copy ไว้ตอนเปิดกะ (denormalized)
    // ถ้า production_lines.section เปลี่ยนทีหลัง หรือสะกด/เคสตัวอักษรต่างกันแม้แต่ตัวเดียว (เช่น "PD4" vs "Pd4 ")
    // กะที่เปิดไว้จะหายไปจากสายตาหัวหน้างานทันทีแบบไม่มี error ให้เห็น — จึงเทียบแบบ normalize (trim+lowercase)
    // และเทียบกับ section ปัจจุบันของไลน์ (lineMap) เป็นหลัก ไม่ใช่ค่าเก่าที่ค้างใน session
    const normSection = (s) => (s || '').trim().toLowerCase();
    let sq = supabaseDR.from('production_sessions')
      .select('*, dr_products(name, cycle_time_sec, target_per_shift, process_type)')
      .in('status', ['open', 'pending_close'])
      .order('created_at', { ascending: false });

    if (role === 'leader' && userLineId) {
      const myLine = (ln || []).find(l => l.id === userLineId);
      if (myLine) {
        const children = pcm[myLine.name];
        if (children?.length) {
          sq = sq.in('line_name', [myLine.name, ...children]);
        } else {
          sq = sq.eq('line_name', myLine.name);
        }
      }
    }

    let { data: ss } = await sq;
    if (role !== 'leader' && scopeSecs.length) {
      // role ที่ถูกจำกัดขอบเขตส่วนงาน (supervisor เดิม + manager/qa ที่กำหนด sections)
      ss = (ss || []).filter(s => {
        const liveSection = lm[s.line_name]?.section;
        return inSectionScope(scopeSecs, liveSection) || inSectionScope(scopeSecs, s.section);
      });
    }

    // Check overdue: open/pending_close sessions from previous dates
    const { data: overdue } = await supabaseDR.from('production_sessions')
      .select('id, line_name, shift, work_date, section')
      .in('status', ['open', 'pending_close'])
      .lt('work_date', workDate()); // เทียบกับ work date (ตัด 08:00) — ไม่งั้นกะดึกหลังเที่ยงคืนโดนแจ้ง "ค้างปิดกะ" ทั้งที่ยังรันอยู่
    setOverdueAlert((overdue || []).filter(o => {
      if (role === 'admin') return true;
      if (role === 'leader') {
        const myLine = (ln || []).find(l => l.id === userLineId);
        return myLine && o.line_name === myLine.name;
      }
      if (scopeSecs.length) {
        const liveSection = lm[o.line_name]?.section;
        return inSectionScope(scopeSecs, liveSection) || inSectionScope(scopeSecs, o.section);
      }
      // ไม่มี scope: manager เห็นหมดเหมือนเดิม / supervisor ที่ไม่มี section = เห็นหมด (พฤติกรรมเดิม)
      return role === 'manager' || role === 'supervisor';
    }));

    setSessions(ss || []);
    if (ss?.length) {
      setSelSession(s => s?.id ? (ss.find(x => x.id === s.id) || ss[0]) : ss[0]);
    } else {
      setSelSession(null);
    }
    setLoading(false);
  }, [role, scopeSecs, userLineId]);

  const loadDT = useCallback(async (sessionId) => {
    if (!sessionId) return;
    const { data } = await supabaseDR.from('downtime_logs')
      .select('*, dr_downtime_types(name_th, color, category)')
      .eq('session_id', sessionId)
      .order('started_at', { ascending: false });
    setDtLogs(data || []);
  }, []);

  const loadProdOrders = useCallback(async (sessionId, lineName) => {
    if (!sessionId) return;
    // Current session orders
    const { data } = await supabaseDR.from('prod_orders')
      .select('*')
      .eq('session_id', sessionId)
      .order('opened_at');
    setProdOrders(data || []);

    // ประวัติการอัพเดทยอดสะสมของใบ manual — โชว์เป็นช่วงเวลา (10:00 → 200, 12:00 → +280)
    const manualIds = (data || []).filter(o => o.is_manual).map(o => o.id);
    if (manualIds.length) {
      const { data: upd } = await supabaseDR.from('prod_order_qty_updates')
        .select('order_id, qty_accum, qty_delta, is_final, logged_at, logged_by')
        .in('order_id', manualIds)
        .order('logged_at');
      const byOrder = {};
      (upd || []).forEach(u => { (byOrder[u.order_id] ||= []).push(u); });
      setQtyUpdatesByOrder(byOrder);
    } else {
      setQtyUpdatesByOrder({});
    }

    // Fetch carry-over orders from previous sessions of same line (not yet imported)
    if (lineName) {
      // ยอดยกถูกบันทึกถาวรตั้งแต่หัวหน้ากะ "ส่งขอปิดกะ" แล้ว (ไม่ต้องรอ SV อนุมัติ) — SV มีหน้าที่ตรวจ
      // NG/Downtime/OEE เท่านั้น ไม่เกี่ยวกับยอดยก จึงรับ pending_close ด้วย ไม่ต้องรอ closed
      const { data: prevSessions } = await supabaseDR.from('production_sessions')
        .select('id')
        .eq('line_name', lineName)
        .in('status', ['closed', 'pending_close'])
        .neq('id', sessionId)
        .order('created_at', { ascending: false })
        .limit(5);
      if (prevSessions?.length) {
        const prevIds = prevSessions.map(s => s.id);
        // Also pick up 'open' orders left in closed sessions (old-code sessions)
        // 'imported' is excluded because it's not in the in() list
        const { data: carried } = await supabaseDR.from('prod_orders')
          .select('*')
          .in('session_id', prevIds)
          .in('status', ['carry_over', 'open'])
          .order('opened_at', { ascending: false });
        // Dedupe: order เดิมอาจถูกยกยอดต่อกันหลายกะ → เอาเฉพาะใบล่าสุดต่อ prod_no
        // และตัดใบที่ถูกรับเข้ากะนี้แล้วออก
        const currentProdNos = new Set((data || []).map(o => o.prod_no));
        const seen = new Set();
        const deduped = (carried || []).filter(o => {
          if (currentProdNos.has(o.prod_no)) return false;
          if (seen.has(o.prod_no)) return false;
          // ออเดอร์ที่ผลิตครบเป้าแล้ว (qty_actual >= qty) ไม่ถือเป็นยอดค้าง — ถ้ายังยกมาจะกลายเป็น
          // "ผีค้าง 1 ชิ้น" ไปเรื่อยๆ ทุกกะเพราะโค้ดเก่าบังคับขั้นต่ำ 1 ชิ้นแม้ผลิตครบแล้ว
          if ((o.qty_actual || 0) >= o.qty) return false;
          seen.add(o.prod_no);
          return true;
        });
        setCarryOrders(deduped);
      } else {
        setCarryOrders([]);
      }
    }
  }, []);

  const loadDefectLogs = useCallback(async (sessionId) => {
    if (!sessionId) return;
    const { data } = await supabaseDR.from('defect_logs')
      .select('*, dr_defect_types(name_th, color), prod_orders(prod_no, mat_no, part_name)')
      .eq('session_id', sessionId)
      .order('logged_at', { ascending: false });
    setDefectLogs(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (selSession) {
      loadDT(selSession.id);
      loadProdOrders(selSession.id, selSession.line_name);
      loadDefectLogs(selSession.id);
    }
  }, [selSession, loadDT, loadProdOrders, loadDefectLogs]);

  // Realtime — debounce 600ms to avoid burst fetches during rapid barcode scanning
  useEffect(() => {
    const timers = {};
    const debounce = (key, fn, ms = 600) => {
      clearTimeout(timers[key]);
      timers[key] = setTimeout(fn, ms);
    };
    const ch = supabaseDR.channel('live-dr')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_sessions' }, () => debounce('sess', () => load()))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prod_orders' },         () => debounce('ord',  () => { if (selSession) loadProdOrders(selSession.id, selSession.line_name); }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'downtime_logs' },       () => debounce('dt',   () => { if (selSession) loadDT(selSession.id); }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'defect_logs' },         () => debounce('def',  () => { if (selSession) loadDefectLogs(selSession.id); }))
      .subscribe();
    return () => { Object.values(timers).forEach(clearTimeout); supabaseDR.removeChannel(ch); };
  }, [selSession, load, loadDT, loadProdOrders, loadDefectLogs]);

  const handleOpenSession = async () => {
    if (!openForm.line_name) { toast.error('เลือกไลน์ก่อน'); return; }

    // กันเปิดกะซ้ำ: ถ้าไลน์/กะ/วันที่นี้มี session ที่ยังไม่ปิดอยู่แล้ว ห้ามเปิดใหม่ทับ
    // (สาเหตุที่บอร์ด Heijunka/Dashboard มีแถว "Live" ค้างซ้ำกันจนล้น)
    const { data: dup } = await supabaseDR.from('production_sessions')
      .select('id, opened_by_name')
      .eq('work_date', openForm.work_date)
      .eq('line_name', openForm.line_name)
      .eq('shift', openForm.shift)
      .in('status', ['open', 'pending_close'])
      .limit(1);
    if (dup?.length) {
      toast.error(`ไลน์นี้มีกะ${openForm.shift === 'day' ? 'เช้า' : 'ดึก'}เปิดอยู่แล้ว (เปิดโดย ${dup[0].opened_by_name || '-'}) — กรุณาปิดกะเดิมก่อน`);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const lineSection = lineMap[openForm.line_name]?.section || null;
    const { data, error } = await supabaseDR.from('production_sessions').insert({
      work_date:      openForm.work_date,
      line_name:      openForm.line_name,
      section:        lineSection,
      shift:          openForm.shift,
      product_id:     openForm.product_id || null,
      start_time:     openForm.start_time,
      opened_by_name: fullName,
      opened_by_uid:  user?.id,
      status:         'open',
    }).select('*, dr_products(name, cycle_time_sec, target_per_shift, process_type)').single();
    if (error) { toast.error('เปิดกะไม่สำเร็จ: ' + error.message); return; }
    toast.success('เปิดกะสำเร็จ');

    // ── รับ Downtime ที่ตัดยอดข้ามกะจากกะล่าสุดของไลน์นี้ (เครื่องยังซ่อมไม่เสร็จ) มาเปิดต่ออัตโนมัติ ──
    // ดูเฉพาะ session ล่าสุด 1 กะ — carry เก่ากว่านั้นถือว่าจบไปแล้ว ไม่ปลุกขึ้นมาใหม่
    try {
      const { data: prevSess } = await supabaseDR.from('production_sessions')
        .select('id').eq('line_name', openForm.line_name).neq('id', data.id)
        .order('created_at', { ascending: false }).limit(1);
      if (prevSess?.length) {
        const { data: carryDts } = await supabaseDR.from('downtime_logs')
          .select('*, dr_downtime_types(name_th)')
          .eq('session_id', prevSess[0].id).eq('carry_over', true);
        if (carryDts?.length) {
          // ข้ามรายการที่มีตัวต่อเนื่องแล้ว (กันสร้างซ้ำถ้าเปิดกะ→ลบกะ→เปิดใหม่)
          const { data: conts } = await supabaseDR.from('downtime_logs')
            .select('carried_from_id').in('carried_from_id', carryDts.map(d => d.id));
          const done = new Set((conts || []).map(c => c.carried_from_id));
          const pending = carryDts.filter(d => !done.has(d.id));
          if (pending.length) {
            const startISO = new Date(`${openForm.work_date}T${(openForm.start_time || '08:00').slice(0, 5)}:00`).toISOString();
            const { error: contErr } = await supabaseDR.from('downtime_logs').insert(pending.map(d => ({
              session_id:       data.id,
              downtime_type_id: d.downtime_type_id,
              machine_no:       d.machine_no,
              mat_no:           d.mat_no,
              description:      d.description,
              started_at:       startISO,
              carried_from_id:  d.id,
              reported_by_name: fullName,
              reported_by_uid:  user?.id,
            })));
            if (!contErr) toast.info(`⏩ รับ Downtime ต่อเนื่องจากกะก่อน ${pending.length} รายการ — เครื่องยังซ่อมไม่เสร็จ`);
          }
        }
      }
    } catch { /* การรับ DT ต่อเนื่องล้มเหลวต้องไม่ล้มการเปิดกะ */ }

    setShowOpen(false);
    setSessions(s => [data, ...s]);
    setSelSession(data);
    setDtLogs([]);
    setProdOrders([]);
    loadDT(data.id);
  };

  const handleSaveQty = async () => {
    if (!selSession) return;
    setSavingQty(true);
    const { error } = await supabaseDR.from('production_sessions').update({
      actual_qty: parseInt(qtyEdit.actual_qty) || 0,
      qty_ng_rh:  parseInt(qtyEdit.qty_ng_rh)  || 0,
      qty_ng_lh:  parseInt(qtyEdit.qty_ng_lh)  || 0,
    }).eq('id', selSession.id);
    setSavingQty(false);
    if (error) { toast.error(error.message); return; }
    toast.success('อัปเดตยอดผลิตแล้ว');
    setSelSession(s => ({ ...s, ...qtyEdit }));
  };

  // Build datetime string from session work_date + HH:MM time, handling overnight (night shift)
  const buildDT = (timeStr) => {
    if (!timeStr || !selSession) return null;
    const workDate = selSession.work_date;
    const dt = new Date(`${workDate}T${timeStr}:00`);
    // If session is night shift and time < 08:00, it's next day
    if (selSession.shift === 'night' && parseInt(timeStr.split(':')[0]) < 8) {
      dt.setDate(dt.getDate() + 1);
    }
    return dt;
  };

  // เดาเวลาปิดกะที่ "น่าจะ" ถูก จากเวลาจริงตอนกดขอปิดกะ — เทียบกับเวลาเลิกงานมาตรฐาน
  // กะเช้า: ถ้ากดก่อนเวลาเลิกงานมาตรฐาน +1 ชม. → ไม่มี OT ใช้เวลาเลิกงานมาตรฐาน (17:30)
  //         ถ้ากดช้ากว่านั้น → สันนิษฐานว่ามี OT ใช้เวลาสิ้นสุด OT มาตรฐาน (20:00, แก้ไขเองได้เสมอ)
  // กะดึก: เลิกงานเสมอที่ 08:00 — OT ของกะดึกคือ "เข้าเร็วขึ้น" (20:00 แทน 22:30) ไม่ใช่เลิกช้าลง
  //         ห้ามเดาเวลาเลิกเกิน 08:00 เพราะแทบไม่มีจริง (จะทำให้เวลากะรวมผิดเพี้ยนมาก เช่น 14 ชม.)
  const openEditTimes = () => {
    setCloseStartTime(selSession?.start_time || '');
    setCloseEndTime(selSession?.end_time || '');
    setMatTimeOverride({});
    setShowEditTimes(true);
  };

  const handleSaveTimes = async () => {
    if (!selSession) return;
    setSavingTimes(true);
    try {
      // อัปเดต opened_at / confirmed_at ต่อ MAT.NO (เดียวกับตอนปิดกะ)
      for (const [matNo, ov] of Object.entries(matTimeOverride)) {
        if (!ov || (!ov.start && !ov.end) || !selSession.work_date) continue;
        const orders = prodOrders.filter(o => o.mat_no === matNo);
        if (!orders.length || orders.some(o => o.status === 'open')) continue;
        if (ov.start) {
          const firstOrder = orders.reduce((a, b) => (!a.opened_at || (b.opened_at && new Date(b.opened_at) < new Date(a.opened_at))) ? b : a);
          const ms = new Date(`${selSession.work_date}T${ov.start.slice(0, 5)}:00`).getTime();
          await supabaseDR.from('prod_orders').update({ opened_at: new Date(ms).toISOString() }).eq('id', firstOrder.id);
        }
        if (ov.end) {
          const confirmedOds = orders.filter(o => o.status === 'confirmed' && o.confirmed_at);
          if (confirmedOds.length) {
            const lastOrder = confirmedOds.reduce((a, b) => (new Date(b.confirmed_at) > new Date(a.confirmed_at)) ? b : a);
            let ms = new Date(`${selSession.work_date}T${ov.end.slice(0, 5)}:00`).getTime();
            if (lastOrder.opened_at && ms < new Date(lastOrder.opened_at).getTime()) ms += 86400000;
            await supabaseDR.from('prod_orders').update({ confirmed_at: new Date(ms).toISOString() }).eq('id', lastOrder.id);
          }
        }
      }
      // คำนวณ OEE ใหม่ด้วยเวลาที่แก้
      const totalQtyNg = defectLogs.reduce((s, d) => s + (d.qty_ng || 0) + (d.qty_suspect || 0), 0);
      const { A, P, Q, oee, shiftMin } = computeOEE(totalQtyNg, closeEndTime, closeStartTime);
      const startChanged = closeStartTime && closeStartTime !== selSession.start_time;
      const endChanged   = closeEndTime   && closeEndTime   !== selSession.end_time;
      const update = {
        shift_min: shiftMin,
        oee_a: parseFloat((A * 100).toFixed(2)),
        oee_p: P != null ? parseFloat((P * 100).toFixed(2)) : null,
        oee_q: parseFloat((Q * 100).toFixed(2)),
        oee:   oee != null ? parseFloat((oee * 100).toFixed(2)) : null,
        ...(startChanged ? { start_time: closeStartTime } : {}),
        ...(endChanged   ? { end_time:   closeEndTime   } : {}),
      };
      await supabaseDR.from('production_sessions').update(update).eq('id', selSession.id);
      toast.success('บันทึกเวลาและคำนวณ OEE ใหม่สำเร็จ');
      setShowEditTimes(false);
      setMatTimeOverride({});
      load();
    } catch (e) {
      toast.error('เกิดข้อผิดพลาด: ' + e.message);
    } finally {
      setSavingTimes(false);
    }
  };

  const guessCloseEndTime = () => {
    if (!selSession) return nowTime();
    if (selSession.shift === 'night') return '08:00';
    const std = '17:30';
    const ot  = '20:00';
    const stdDT = buildDT(std);
    if (!stdDT) return nowTime();
    const noOtCutoff = new Date(stdDT.getTime() + 60 * 60000);
    return new Date() <= noOtCutoff ? std : ot;
  };

  const computeDtTimes = () => {
    const { mode, start_time, end_time, duration_min } = dtForm;
    const dur = parseFloat(duration_min);
    if (mode === 'start_end') {
      const s = buildDT(start_time);
      const e = buildDT(end_time);
      if (s && e && e > s) return { startedAt: s, endedAt: e, durMin: (e - s) / 60000 };
      if (s) return { startedAt: s, endedAt: null, durMin: null };
    } else if (mode === 'start_dur') {
      const s = buildDT(start_time);
      if (s && dur > 0) return { startedAt: s, endedAt: new Date(s.getTime() + dur * 60000), durMin: dur };
      if (s) return { startedAt: s, endedAt: null, durMin: null };
    } else { // end_dur
      const e = buildDT(end_time);
      if (e && dur > 0) return { startedAt: new Date(e.getTime() - dur * 60000), endedAt: e, durMin: dur };
    }
    return { startedAt: null, endedAt: null, durMin: dur > 0 ? dur : null };
  };

  const handleAddDT = async () => {
    if (!selSession || !dtForm.downtime_type_id) { toast.error('เลือกประเภท Downtime'); return; }
    if (!dtForm.machine_no) { toast.error('เลือกเครื่องจักร'); return; }
    const lineStds = kanbanStds.filter(s => s.dr_products?.line_name === selSession.line_name);
    if (lineStds.length && !dtForm.mat_no) { toast.error('เลือกชิ้นงาน'); return; }
    const { startedAt, endedAt, durMin } = computeDtTimes();
    if (!startedAt && !durMin) { toast.error('กรอกเวลาหรือระยะเวลาอย่างน้อย 1 อย่าง'); return; }
    // ประเภท "อื่นๆ" เปล่าๆ บอกอะไรไม่ได้ในสรุปประชุมเช้า/รายงาน — บังคับระบุสาเหตุจริงเสมอ
    const dtTypeName = dtTypes.find(t => t.id === dtForm.downtime_type_id)?.name_th || '';
    if (dtTypeName.includes('อื่น') && !dtForm.description?.trim()) {
      toast.error('ประเภท "อื่นๆ" ต้องระบุรายละเอียด/สาเหตุด้วย — เพื่อให้รายงานและประชุมเช้าอ่านรู้เรื่อง');
      return;
    }
    setSavingDT(true);
    const { data: { user } } = await supabase.auth.getUser();

    const payload = {
      downtime_type_id: dtForm.downtime_type_id,
      started_at:       startedAt?.toISOString() || null,
      ended_at:         endedAt?.toISOString()   || null,
      duration_min:     durMin,
      machine_no:       dtForm.machine_no || null,
      mat_no:           dtForm.mat_no || null,
      description:      dtForm.description || null,
    };
    const { error } = dtForm.id
      ? await supabaseDR.from('downtime_logs').update(payload).eq('id', dtForm.id)
      : await supabaseDR.from('downtime_logs').insert({
          ...payload,
          session_id:       selSession.id,
          reported_by_name: fullName,
          reported_by_uid:  user?.id,
        });
    setSavingDT(false);
    if (error) { toast.error(error.message); return; }

    // แจ้งเตือน Telegram:
    //   - รายการใหม่ → 🚨 เครื่อง Downtime (แก้ไขทั่วไปไม่แจ้งซ้ำ ไม่ให้ข้อความรกกลุ่ม)
    //   - แก้ไขรายการที่เปิดค้างอยู่ (ยังไม่มีเวลาจบ/ระยะเวลา) แล้วครั้งนี้ปิดรายการ → ✅ เครื่องกลับมารันได้
    const dtType = dtTypes.find(t => t.id === dtForm.downtime_type_id);
    const mcName = machines.find(m => m.machine_no === dtForm.machine_no && m.line_name === selSession.line_name)?.machine_name
      || machines.find(m => m.machine_no === dtForm.machine_no)?.machine_name || '';
    const fmtHM = (d) => d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : null;
    const notifyBase = {
      line_name:    selSession.line_name,
      shift:        selSession.shift,
      work_date:    selSession.work_date,
      machine_no:   dtForm.machine_no,
      machine_name: mcName,
      type_name:    dtType?.name_th || '',
      category:     dtType?.category || '',
      start_time:   fmtHM(startedAt),
      end_time:     fmtHM(endedAt),
      duration_min: durMin != null ? Math.round(durMin) : null,
      mat_no:       dtForm.mat_no || null,
      description:  dtForm.description || null,
      reported_by:  fullName,
    };
    // แจ้งเตือน v2 (2026-07-14) — ลดสัญญาณรบกวน:
    //   • บันทึกใหม่ = ไม่แจ้งทันที (ปิดแล้ว→สรุปตอนปิดกะ · เปิดค้าง→scanner แจ้งเมื่อเกินเกณฑ์นาที)
    //   • ปิดรายการที่ "เคยถูกแจ้ง" (open_alerted_at หรือ call_mtn) → ✅ เครื่องกลับมารันได้ (ไม่งั้นเงียบ)
    if (dtForm.id) {
      const orig = dtLogs.find(x => x.id === dtForm.id);
      const wasOpen   = orig && !orig.ended_at && orig.duration_min == null;
      const nowClosed = endedAt != null || durMin != null;
      const wasAlerted = orig && (orig.open_alerted_at || orig.call_mtn);
      if (wasOpen && nowClosed && wasAlerted) {
        notifyDowntime({
          ...notifyBase,
          description: [dtForm.description, orig.carried_from_id ? '(ต่อเนื่องจากกะก่อน)' : ''].filter(Boolean).join(' ') || null,
        }, 'downtime_recovered');
      }
    }

    toast.success(dtForm.id ? 'แก้ไข Downtime แล้ว' : 'บันทึก Downtime แล้ว');
    setShowDT(false);
    setDtForm({ id: null, downtime_type_id: '', mode: 'start_end', start_time: '', end_time: '', duration_min: '', machine_no: '', mat_no: '', description: '' });
    loadDT(selSession.id);
  };

  // ── Scan OPEN handler ──────────────────────────────────────────
  const handleOpenProdMatNoChange = (val) => {
    const upper = val.toUpperCase();
    const std = kanbanStds.find(s => s.mat_no === upper) || null;
    setOpenProdStd(std);
    setOpenProdForm(f => ({
      ...f,
      mat_no: upper,
      qty:    std ? String(std.qty_per_kanban) : f.qty,
    }));
  };

  // Auto-select MAT.NO when scan modal opens — if line has only 1 option
  useEffect(() => {
    if (!showScanOpen || !selSession || kanbanStds.length === 0) return;
    const lineName = selSession.line_name;
    const lineStds = kanbanStds.filter(s => s.dr_products?.line_name === lineName);
    if (lineStds.length === 1 && !openProdForm.mat_no) {
      handleOpenProdMatNoChange(lineStds[0].mat_no);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showScanOpen, kanbanStds, selSession]);

  // หา Cycle Time (วินาที) ของ MAT.NO หนึ่งใบ จาก Kanban Standard → Product Master
  // ทำแบบ per-order เพราะกะเดียวอาจผลิตได้หลาย MAT.NO/สินค้า ไม่ใช่สินค้าเดียวตาม session.product_id
  // (session.product_id ไม่ได้ถูกตั้งค่าจาก UI เปิดกะ เลยเป็น null เสมอ — ใช้ mat_no ของแต่ละใบงานแทน)
  const ctForMatNo = (matNo) => kanbanStds.find(s => s.mat_no === matNo)?.dr_products?.cycle_time_sec || 0;

  // นาที Downtime ที่ทับซ้อนกับช่วงเวลา [startMs, endMs] — ใช้หักจาก "เวลาที่ MAT.NO นี้วิ่งจริง" ก่อนเทียบ %P
  // เทียบด้วยช่วงเวลาจริง (started_at/ended_at) ไม่ใช่แค่ d.mat_no ตรงกัน เพราะ Downtime ของไลน์ร่วม (ไม่ระบุ MAT.NO)
  // ก็กระทบ MAT.NO ที่วิ่งซ้อนอยู่ในช่วงนั้นด้วย — ถ้าไม่หัก จะนับเวลาผลิตจริงเกิน ทำให้ %P เพี้ยน (เช่นเกิน 100%)
  const dtOverlapMin = (startMs, endMs, pred = () => true, logs = dtLogs) => {
    if (!startMs || !endMs || endMs <= startMs) return 0;
    return logs.filter(pred).reduce((sum, d) => {
      if (!d.started_at) return sum;
      const s0 = new Date(d.started_at).getTime();
      const e0 = d.ended_at ? new Date(d.ended_at).getTime() : s0 + (d.duration_min || 0) * 60000;
      const s = Math.max(s0, startMs), e = Math.min(e0, endMs);
      return e > s ? sum + (e - s) / 60000 : sum;
    }, 0);
  };

  // เช็คย้อนหลัง: MAT.NO นี้ผลิตเกิน CT ที่ตั้งไว้ซ้ำๆ ในกะที่ปิดไปแล้วของไลน์เดียวกันหรือไม่ (8 กะล่าสุด)
  // ถ้าเกินบ่อย แสดงว่า CT ใน Product Master น่าจะตั้งช้ากว่าความเป็นจริง ควรปรับ ไม่ใช่ปัญหาแค่กะเดียว
  useEffect(() => {
    if (!showCloseShift && !showApproveReview) return;
    if (!selSession?.line_name || !prodOrders.length) { setCtOverage({}); return; }
    const matNos = Array.from(new Set(prodOrders.map(o => o.mat_no).filter(Boolean)));
    if (!matNos.length) { setCtOverage({}); return; }
    let cancelled = false;
    (async () => {
      const { data: prevSessions } = await supabaseDR.from('production_sessions')
        .select('id')
        .eq('line_name', selSession.line_name)
        .eq('status', 'closed')
        .neq('id', selSession.id)
        .order('closed_at', { ascending: false })
        .limit(8);
      if (cancelled || !prevSessions?.length) { if (!cancelled) setCtOverage({}); return; }
      const prevIds = prevSessions.map(s => s.id);
      const [{ data: histOrders }, { data: histDt }] = await Promise.all([
        supabaseDR.from('prod_orders').select('*').in('session_id', prevIds).in('mat_no', matNos).eq('status', 'confirmed'),
        supabaseDR.from('downtime_logs').select('session_id, started_at, ended_at, duration_min').in('session_id', prevIds),
      ]);
      if (cancelled) return;
      const result = {};
      matNos.forEach(matNo => {
        const ctSec = ctForMatNo(matNo);
        if (ctSec <= 0) return;
        let checked = 0, overCount = 0;
        const observedCts = [];
        prevIds.forEach(sid => {
          const orders = (histOrders || []).filter(o => o.session_id === sid && o.mat_no === matNo);
          if (!orders.length) return;
          const qty = orders.reduce((s, o) => s + o.qty, 0);
          const openedTimes = orders.map(o => o.opened_at).filter(Boolean).map(t => new Date(t).getTime());
          const closedTimes = orders.filter(o => o.confirmed_at).map(o => new Date(o.confirmed_at).getTime());
          if (!openedTimes.length || !closedTimes.length) return;
          const startMs = Math.min(...openedTimes), endMs = Math.max(...closedTimes);
          if (endMs <= startMs) return;
          const dtOverlap = (histDt || []).filter(d => d.session_id === sid).reduce((sum, d) => {
            if (!d.started_at) return sum;
            const s0 = new Date(d.started_at).getTime();
            const e0 = d.ended_at ? new Date(d.ended_at).getTime() : s0 + (d.duration_min || 0) * 60000;
            const s = Math.max(s0, startMs), e = Math.min(e0, endMs);
            return e > s ? sum + (e - s) / 60000 : sum;
          }, 0);
          const winMin = Math.max(0, (endMs - startMs) / 60000 - dtOverlap);
          const achievable = Math.floor(winMin * 60 / ctSec);
          checked++;
          if (qty > achievable) {
            overCount++;
            if (winMin > 0) observedCts.push(winMin * 60 / qty);
          }
        });
        if (checked > 0) {
          result[matNo] = {
            checked, overCount, ctSec,
            avgObservedCt: observedCts.length ? observedCts.reduce((s, v) => s + v, 0) / observedCts.length : null,
          };
        }
      });
      setCtOverage(result);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCloseShift, showApproveReview, selSession?.id, selSession?.line_name, prodOrders]);

  // หา process_type ของกะนี้ — อิงจากไลน์เป็นหลัก (เครื่องจักรของไลน์ HYDROFORM ถูก tag เป็น metal_forming ไว้แล้วใน
  // ตั้งค่า > เครื่องจักร และไม่ขึ้นกับว่าเปิด Order ไปแล้วหรือยัง) ถ้าไลน์ไม่มีเครื่องจักร tag ไว้ ค่อย fallback ไปดูสินค้าที่กำลังผลิต
  const sessionProcessType = () => {
    const lineMachines = machines.filter(m => m.line_name === selSession?.line_name && m.process_type);
    if (lineMachines.length) {
      const counts = {};
      lineMachines.forEach(m => { counts[m.process_type] = (counts[m.process_type] || 0) + 1; });
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (top) return top[0];
    }
    const counts = {};
    prodOrders.forEach(o => {
      const pt = kanbanStds.find(s => s.mat_no === o.mat_no)?.dr_products?.process_type;
      if (pt) counts[pt] = (counts[pt] || 0) + 1;
    });
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return entries[0]?.[0] || selSession?.dr_products?.process_type || 'common';
  };

  // คำนวณ net available time ของกะ (นาที) หลังหักพักเบรค
  const calcNetAvailMin = () => {
    if (!selSession?.start_time) return null;
    const SHIFT_MIN = 720; // 12 ชั่วโมงต่อกะ (default)
    const wDate = selSession.work_date;
    const [sh, sm] = selSession.start_time.split(':').map(Number);
    const shiftStartMs = new Date(`${wDate}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00`).getTime();
    const breakMin = breakPolicies
      .filter(p => p.shift === 'both' || p.shift === selSession.shift)
      .filter(p => p.process_type === 'common' || p.process_type === sessionProcessType())
      .reduce((sum, p) => {
        const [ph, pm] = (p.start_time || '00:00').split(':').map(Number);
        let pStartMs = new Date(`${wDate}T${String(ph).padStart(2,'0')}:${String(pm).padStart(2,'0')}:00`).getTime();
        // ถ้าพักก่อนกะเริ่ม (กะดึกข้ามวัน) เลื่อนวันถัดไป
        if (pStartMs < shiftStartMs) pStartMs += 86400000;
        const pEndMs = pStartMs + p.duration_min * 60000;
        const shiftEndMs = shiftStartMs + SHIFT_MIN * 60000;
        return sum + Math.max(0, (Math.min(pEndMs, shiftEndMs) - Math.max(pStartMs, shiftStartMs)) / 60000);
      }, 0);
    return SHIFT_MIN - breakMin;
  };

  // คำนวณเวลาที่ commit ไปแล้วในกะนี้ (นาที) จากทุก order ที่ยังไม่ cancelled/carry_over — ใช้ CT ของแต่ละ MAT.NO
  // carry_over คือ order ที่ตัดสินใจส่งไปกะถัดไปแล้ว ไม่ควรนับเป็นภาระของกะนี้อีก ไม่งั้นจะค้างกินความจุไปตลอด
  const calcCommittedMin = () => {
    return prodOrders
      .filter(o => !['cancelled', 'imported', 'carry_over'].includes(o.status))
      .reduce((sum, o) => sum + (o.qty || 0) * ctForMatNo(o.mat_no) / 60, 0);
  };

  // แปลง HH:mm ที่กรอกย้อนหลัง → ISO จริง: anchor กับ work_date ของกะนี้ และเลื่อนวันถัดไปถ้าเป็นกะดึกที่ข้ามเที่ยงคืน
  // (ไม่งั้นถ้าไม่ระบุเวลา DB จะ default เป็นเวลาปัจจุบัน ทำให้ Heijunka ขึ้นที่ "ตอนนี้" ไม่ใช่ตอนที่ผลิตจริง)
  // ใช้ร่วมกันทั้งใบสแกน (backfillOpenedAt) และใบ manual (handleManualOpen)
  const backfillIsoFromTime = (hhmm) => {
    if (!hhmm || !selSession) return null;
    const [h, m] = hhmm.split(':').map(Number);
    let d = new Date(`${selSession.work_date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
    if (selSession.shift === 'night' && h < 8) d = new Date(d.getTime() + 86400000);
    return d.toISOString();
  };
  const backfillOpenedAt = () => {
    if (!openProdForm.is_backfill) return null;
    return backfillIsoFromTime(openProdForm.backfill_time);
  };

  // เดาเวลาเริ่มผลิตจริงให้ตอนติ๊ก "ยิงย้อนหลัง" — ใบแรกของกะ = เวลาเริ่มกะ, ใบต่อไป = เวลาปิดจริง (confirmed_at)
  // ของใบก่อนหน้าถ้ามี ไม่งั้นประมาณด้วย CT (opened_at + qty/CT) เพื่อลดโอกาสเวลาซ้อนกันระหว่าง 2 ใบ
  const guessBackfillTime = () => {
    if (!selSession) return '';
    // คุมให้เวลาที่เดา อยู่ในกรอบกะเสมอ (กะเช้า 08:00–19:59 · กะดึก 20:00–07:59) กัน guess หลุดไปคนละกะ
    const clampToShift = (hhmm) => {
      if (!hhmm) return hhmm;
      const h = Number(hhmm.split(':')[0]);
      const inDay = h >= 8 && h < 20;
      if (selSession.shift === 'day'   && !inDay) return (selSession.start_time || '08:00').slice(0, 5);
      if (selSession.shift === 'night' && inDay)  return (selSession.start_time || '20:00').slice(0, 5);
      return hhmm;
    };
    const prev = [...prodOrders].sort((a, b) => new Date(b.opened_at) - new Date(a.opened_at))[0];
    if (!prev) return (selSession.start_time || '').slice(0, 5);
    if (prev.confirmed_at) return clampToShift(new Date(prev.confirmed_at).toTimeString().slice(0, 5));
    const ctSec = ctForMatNo(prev.mat_no);
    if (ctSec > 0) {
      const estMs = new Date(prev.opened_at).getTime() + (prev.qty || 0) * ctSec * 1000;
      return clampToShift(new Date(estMs).toTimeString().slice(0, 5));
    }
    return (selSession.start_time || '').slice(0, 5);
  };

  // insert จริง (ใช้ทั้งจาก handleScanOpen และ handleOverflowForce)
  const doInsertProdOrder = async (prodNo, matNo, qty, std, status = 'open') => {
    const opened_at = backfillOpenedAt();
    const { data, error } = await supabaseDR.from('prod_orders').insert({
      session_id:  selSession.id,
      prod_no:     prodNo,
      mat_no:      matNo,
      part_name:   std?.part_name || openProdStd?.part_name || null,
      p_no:        std?.p_no      || openProdStd?.p_no      || null,
      customer:    std?.customer  || openProdStd?.customer  || null,
      qty,
      status,
      is_backfill: openProdForm.is_backfill,
      opened_by:   fullName,
      ...(opened_at ? { opened_at } : {}),
    }).select().single();
    return { error, data };
  };

  const handleScanOpen = async () => {
    const prodNo = openProdForm.prod_no.trim();
    const matNo  = openProdForm.mat_no.trim();
    if (!prodNo) { toast.error('สแกนหรือกรอก PROD.NO ก่อน'); return; }
    if (!matNo)  { toast.error('สแกนหรือกรอก MAT.NO ก่อน');  return; }
    if (!openProdForm.qty || parseInt(openProdForm.qty) < 1) { toast.error('ระบุจำนวนชิ้น'); return; }
    if (openProdForm.is_backfill && !openProdForm.backfill_time) { toast.error('ระบุเวลาที่เริ่มผลิตจริงก่อน (บังคับสำหรับยิงย้อนหลัง)'); return; }
    // กันเวลา backfill หลุดกรอบกะ (เช่น กะเช้าเผลอกรอก 23:0x → การ์ดเด้งไปกะกลางคืนใน Heijunka)
    if (openProdForm.is_backfill && openProdForm.backfill_time && selSession) {
      const bh = Number(openProdForm.backfill_time.split(':')[0]);
      const inDay = bh >= 8 && bh < 20;   // กะเช้า 08:00–19:59 · กะดึก 20:00–07:59
      if ((selSession.shift === 'day' && !inDay) || (selSession.shift === 'night' && inDay)) {
        toast.error(`เวลา ${openProdForm.backfill_time} อยู่นอกกรอบกะ${selSession.shift === 'day' ? 'เช้า (08:00–20:00)' : 'ดึก (20:00–08:00)'} — ตรวจเวลาที่เริ่มผลิตอีกครั้ง`);
        return;
      }
    }

    const dup = prodOrders.find(o => o.prod_no === prodNo);
    if (dup) {
      toast.error(`PROD.NO ${prodNo} เปิดไปแล้วในกะนี้ (${dup.status === 'confirmed' ? 'ปิดแล้ว' : 'กำลังผลิต'})`);
      return;
    }

    const qty    = parseInt(openProdForm.qty);
    const ctSec  = ctForMatNo(matNo);
    const std    = kanbanStds.find(s => s.mat_no === matNo);

    // ── Capacity check ──────────────────────────────────────────────
    if (ctSec > 0) {
      const netAvailMin   = calcNetAvailMin();
      const committedMin  = calcCommittedMin();
      const newOrderMin   = qty * ctSec / 60;
      if (netAvailMin !== null && (committedMin + newOrderMin) > netAvailMin) {
        const remainMin = Math.max(0, netAvailMin - committedMin);
        setOverflowInfo({ prodNo, matNo, qty, std, overMin: Math.round(committedMin + newOrderMin - netAvailMin), remainMin: Math.round(remainMin), newOrderMin: Math.round(newOrderMin) });
        return; // หยุดรอ user เลือก
      }
    }

    setSavingProdOpen(true);
    const { error, data } = await doInsertProdOrder(prodNo, matNo, qty, std, 'open');
    setSavingProdOpen(false);
    if (error) { toast.error(error.message); return; }

    // ── RH/LH auto pairing ──────────────────────────────────────────
    // ทั้ง 2 ข้างมีเลข SAP order เป็นของตัวเองเสมอ ต้องสแกนคู่ 2 ครั้งจริง — ไม่มีกรณี order ข้างเดียวแล้ว
    const partnerMatNo = products.find(p => p.mat_no === matNo)?.pair_mat_no || null;
    let nextMatNo = openProdForm.mat_no;

    if (pendingPairId) {
      // separate_order: นี่คือการสแกนคู่ RH/LH ใบที่สอง — ผูกกลับไปยังใบแรกที่รออยู่
      // sync opened_at ให้ตรงกับใบแรก เพราะผลิตพร้อมกันจริงแม้สแกนคนละเวลา
      const firstOrder = prodOrders.find(o => o.id === pendingPairId);
      await supabaseDR.from('prod_orders').update({ paired_order_id: data.id }).eq('id', pendingPairId);
      await supabaseDR.from('prod_orders').update({
        paired_order_id: pendingPairId,
        ...(firstOrder?.opened_at ? { opened_at: firstOrder.opened_at } : {}),
      }).eq('id', data.id);
      setPendingPairId(null);
      toast.success(`เปิด Order คู่ RH/LH พร้อมกัน ✓ (${prodNo})`);
    } else if (partnerMatNo) {
      const existingPartner = prodOrders.find(o => o.mat_no === partnerMatNo && o.status === 'open' && !o.paired_order_id);
      if (existingPartner) {
        await supabaseDR.from('prod_orders').update({ paired_order_id: data.id }).eq('id', existingPartner.id);
        await supabaseDR.from('prod_orders').update({
          paired_order_id: existingPartner.id,
          ...(existingPartner.opened_at ? { opened_at: existingPartner.opened_at } : {}),
        }).eq('id', data.id);
        toast.success(`เปิด Order ${prodNo} ✓ และผูกคู่กับ ${existingPartner.prod_no} (RH/LH) อัตโนมัติ`);
      } else {
        setPendingPairId(data.id);
        nextMatNo = partnerMatNo;
        toast.info(`เปิด ${prodNo} แล้ว — สแกน PROD.NO ของคู่ RH/LH (MAT.NO ${partnerMatNo}) ต่อได้เลย`);
      }
    } else {
      toast.success(`เปิด Order ${prodNo} · ${matNo} · ${qty} ชิ้น ✓`);
    }
    // โหมดยิงย้อนหลังต้อง sticky — ยิงเติมทีละหลายใบ ถ้ารีเซ็ต checkbox เงียบๆ ใบถัดไปจะถูกบันทึกเป็น "เวลาตอนนี้"
    // โดยไม่รู้ตัว (เคยพัง: บอร์ดการ์ดไปกองที่เวลาสแกนแทนเวลาผลิตจริง) — เลื่อนเวลาให้อัตโนมัติ = เวลาใบนี้ + qty×CT
    let nextBackfillTime = '';
    if (openProdForm.is_backfill) {
      const ctSec2 = ctForMatNo(matNo);
      const baseMs = new Date(data?.opened_at || Date.now()).getTime();
      if (ctSec2 > 0) {
        const est = new Date(baseMs + qty * ctSec2 * 1000).toTimeString().slice(0, 5);
        const eh = Number(est.split(':')[0]);
        const inDay = eh >= 8 && eh < 20;
        // เวลาที่เดาเกินกรอบกะ = ปล่อยว่างให้กรอกเอง (กันหลุดกะเหมือน guard ตอนบันทึก)
        nextBackfillTime = ((selSession.shift === 'day' && inDay) || (selSession.shift === 'night' && !inDay)) ? est : '';
      } else {
        nextBackfillTime = openProdForm.backfill_time;
      }
    }
    setOpenProdForm(f => ({ prod_no: '', mat_no: nextMatNo, qty: f.qty, is_backfill: f.is_backfill, backfill_time: nextBackfillTime }));
    loadProdOrders(selSession.id, selSession.line_name);
    setTimeout(() => openProdInputRef.current?.focus(), 80);
  };

  // ผู้ใช้เลือก "ส่งกะถัดไป" — save เป็น carry_over ทันที
  const handleOverflowNextShift = async () => {
    if (!overflowInfo) return;
    const { prodNo, matNo, qty, std } = overflowInfo;
    setSavingProdOpen(true);
    const { error } = await doInsertProdOrder(prodNo, matNo, qty, std, 'carry_over');
    setSavingProdOpen(false);
    setOverflowInfo(null);
    if (error) { toast.error(error.message); return; }
    toast.info(`บันทึก ${prodNo} เป็นยอดค้างกะถัดไป ✓`);
    setOpenProdForm(f => ({ prod_no: '', mat_no: f.mat_no, qty: f.qty, is_backfill: false, backfill_time: '' }));
    loadProdOrders(selSession.id, selSession.line_name);
  };

  // ผู้ใช้เลือก "เปิดกะนี้ต่อ" — force open ปกติ
  const handleOverflowForce = async () => {
    if (!overflowInfo) return;
    const { prodNo, matNo, qty, std } = overflowInfo;
    setSavingProdOpen(true);
    const { error } = await doInsertProdOrder(prodNo, matNo, qty, std, 'open');
    setSavingProdOpen(false);
    setOverflowInfo(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`เปิด Order ${prodNo} · ${qty} ชิ้น ✓ (เกินเวลากะ)`);
    setOpenProdForm(f => ({ prod_no: '', mat_no: f.mat_no, qty: f.qty, is_backfill: false, backfill_time: '' }));
    loadProdOrders(selSession.id, selSession.line_name);
  };

  // ── Scan CLOSE handler ─────────────────────────────────────────
  const handleCloseProdNoChange = (val) => {
    // barcode scanner appends \n — strip and auto-confirm
    const hasEnter = val.includes('\n') || val.includes('\r');
    const v = val.replace(/[\r\n]/g, '').trim();
    setCloseProdNo(v);
    const found = prodOrders.find(o => o.prod_no === v && o.status === 'open');
    setCloseMatch(found || null);
    if (hasEnter && found) {
      // slight delay to let state settle before calling confirm
      setTimeout(() => handleScanCloseImmediate(found), 30);
    }
  };

  // หมายเหตุ: เคยมี guard เตือน "ปิดข้ามคิว" ถ้าใบที่เปิดก่อนหน้ายังไม่ปิด แต่ตัดออกแล้ว
  // เพราะพนักงานมองงานเป็น lot/batch ไม่ได้ไล่ปิดทีละใบตามเลขที่เปิด — เปลี่ยนไปใช้การจัดกลุ่มเป็น "รอบ" (ทุก 2 ชม.)
  // ในการแสดงผลที่ Dashboard แทน ไม่บังคับลำดับปิดในระดับใบย่อยอีกต่อไป
  const doConfirmCloseOrder = async (match) => {
    setSavingProdClose(true);
    const { error } = await supabaseDR.from('prod_orders').update({
      status:       'confirmed',
      confirmed_by: fullName,
      confirmed_at: new Date().toISOString(),
      qty_ok:       match.qty,
    }).eq('id', match.id);
    if (error) { setSavingProdClose(false); toast.error(error.message); return; }
    setSavingProdClose(false);

    // หมายเหตุ: เคย auto-close คู่ RH/LH ที่ผูกกันพร้อมกัน แต่ตัดออกแล้ว
    // เพราะแต่ละข้างผลิตจบไม่พร้อมกันจริง การ force ปิดคู่ทำให้ qty_ok ผิดและ dashboard
    // แสดงสถานะสับสน (ข้างที่ยังไม่จบถูกตีว่าเสร็จ) — ตอนนี้ปิดอิสระต่อข้าง
    // paired_order_id ยังใช้แค่โชว์ label ว่าเป็นคู่กัน ไม่กระทบสถานะ
    const partnerOpenNo = match.paired_order_id
      ? prodOrders.find(o => o.id === match.paired_order_id && o.status === 'open')?.prod_no
      : null;
    toast.success(partnerOpenNo
      ? `ปิด Order ${match.prod_no} · ${match.qty} ชิ้น ✓ (คู่ RH/LH ${partnerOpenNo} ยังเปิดอยู่ ต้องสแกนปิดแยก)`
      : `ปิด Order ${match.prod_no} · ${match.qty} ชิ้น ✓`);
    setCloseProdNo('');
    setCloseMatch(null);
    loadProdOrders(selSession.id, selSession.line_name);
    setTimeout(() => closeProdInputRef.current?.focus(), 80);
  };

  const handleScanCloseImmediate = async (match) => {
    if (!match) return;
    await doConfirmCloseOrder(match);
  };

  const handleScanClose = async () => {
    if (!closeMatch) { toast.error('ไม่พบ PROD.NO นี้ หรือปิดไปแล้ว'); return; }
    await doConfirmCloseOrder(closeMatch);
  };

  // ── ออเดอร์ manual (ไลน์ไม่มี kanban card) ─────────────────────
  const handleManualOpen = async () => {
    const matNo = manualForm.mat_no;
    const qty = parseInt(manualForm.qty);
    if (!matNo) { toast.error('เลือกสินค้าก่อน'); return; }
    if (!qty || qty < 1) { toast.error('ระบุเป้าหมายผลิต (ชิ้น)'); return; }
    // เปิดเป้าย้อนหลัง — กติกาเดียวกับใบสแกน: บังคับกรอกเวลา + กันเวลาหลุดกรอบกะ
    if (manualForm.is_backfill && !manualForm.backfill_time) { toast.error('ระบุเวลาที่เริ่มผลิตจริงก่อน (บังคับสำหรับเปิดย้อนหลัง)'); return; }
    if (manualForm.is_backfill && manualForm.backfill_time && selSession) {
      const bh = Number(manualForm.backfill_time.split(':')[0]);
      const inDay = bh >= 8 && bh < 20;   // กะเช้า 08:00–19:59 · กะดึก 20:00–07:59
      if ((selSession.shift === 'day' && !inDay) || (selSession.shift === 'night' && inDay)) {
        toast.error(`เวลา ${manualForm.backfill_time} อยู่นอกกรอบกะ${selSession.shift === 'day' ? 'เช้า (08:00–20:00)' : 'ดึก (20:00–08:00)'} — ตรวจเวลาที่เริ่มผลิตอีกครั้ง`);
        return;
      }
    }
    setSavingManual(true);
    const std = kanbanStds.find(s => s.mat_no === matNo);
    const prod = products.find(p => p.mat_no === matNo);
    const now = new Date();
    const prodNo = `MANUAL-${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
    const backfillIso = manualForm.is_backfill && manualForm.backfill_time ? backfillIsoFromTime(manualForm.backfill_time) : null;
    const { data: created, error } = await supabaseDR.from('prod_orders').insert({
      session_id: selSession.id,
      prod_no:    prodNo,
      mat_no:     matNo,
      part_name:  std?.part_name || prod?.name || null,
      p_no:       std?.p_no || prod?.p_no || null,
      customer:   std?.customer || prod?.customer || null,
      qty,
      qty_target: qty,
      qty_actual: 0,
      is_manual:  true,
      is_backfill: manualForm.is_backfill,
      status:     'open',
      opened_by:  fullName,
      ...(backfillIso ? { opened_at: backfillIso } : {}),
    }).select().single();
    setSavingManual(false);
    if (error) { toast.error(error.message); return; }
    toast.success(manualForm.is_backfill
      ? `เปิดเป้า ${matNo} · ${qty} ชิ้น ✓ (ย้อนหลังตั้งแต่ ${manualForm.backfill_time}) — อัพเดทยอดสะสมได้เลย`
      : `เปิดเป้า ${matNo} · ${qty} ชิ้น ✓ — ให้พนักงานอัพเดทยอดสะสมทุกช่วงเบรค`);

    // ── งานคู่ RH/LH — สินค้ามี pair_mat_no ต้องเปิดเป้าคู่ด้วย (เหมือนใบสแกนที่ต้องเปิดทั้งสองข้าง)
    // คู่บางตัวอยู่คนละไลน์ (เช่น LH ที่ HDF1 · RH ที่ LASER123) → เปิดเข้า session ที่เปิดอยู่ของไลน์นั้นให้เลย
    const pairMat = prod?.pair_mat_no || null;
    if (pairMat && created) {
      const pairProd = products.find(p => p.mat_no === pairMat);
      const pairStd  = kanbanStds.find(s => s.mat_no === pairMat);
      const pairLine = (pairProd?.line_name || '').trim();
      const famNames = new Set(getLineFamilyNames(lines, selSession.line_name).map(n => n.trim().toLowerCase()));
      let pairSession = selSession;
      if (pairLine && !famNames.has(pairLine.toLowerCase())) {
        const { data: ps } = await supabaseDR.from('production_sessions')
          .select('id, line_name')
          .eq('line_name', pairLine).eq('work_date', selSession.work_date)
          .eq('shift', selSession.shift).eq('status', 'open')
          .order('created_at', { ascending: false }).limit(1);
        pairSession = ps?.[0] || null;
      }
      if (!pairSession) {
        toast.info(`⚠️ สินค้านี้มีคู่ RH/LH (${pairMat} · ไลน์ ${pairLine}) แต่ไลน์นั้นยังไม่เปิดกะ — เปิดกะแล้วค่อยเปิดเป้าคู่เอง`);
      } else if (window.confirm(`สินค้านี้มีคู่ RH/LH: ${pairMat}${pairSession.id !== selSession.id ? ` (ไลน์ ${pairLine})` : ''}\nเปิดเป้าคู่ ${qty} ชิ้นให้พร้อมกันเลยมั้ย?`)) {
        const { data: pairCreated, error: pe } = await supabaseDR.from('prod_orders').insert({
          session_id: pairSession.id,
          prod_no:    `${prodNo}P`,
          mat_no:     pairMat,
          part_name:  pairStd?.part_name || pairProd?.name || null,
          p_no:       pairStd?.p_no || pairProd?.p_no || null,
          customer:   pairStd?.customer || pairProd?.customer || null,
          qty, qty_target: qty, qty_actual: 0,
          is_manual: true, is_backfill: manualForm.is_backfill,
          status: 'open', opened_by: fullName,
          paired_order_id: created.id,
          // ผลิตพร้อมกันจริง — sync เวลาเริ่มกับใบแรก (กติกาเดียวกับคู่ใบสแกน)
          opened_at: backfillIso || created.opened_at,
        }).select().single();
        if (pe) {
          toast.error(`เปิดเป้าคู่ไม่สำเร็จ: ${pe.message}`);
        } else {
          await supabaseDR.from('prod_orders').update({ paired_order_id: pairCreated.id }).eq('id', created.id);
          toast.success(`เปิดเป้าคู่ ${pairMat} · ${qty} ชิ้น ✓${pairSession.id !== selSession.id ? ` (ไลน์ ${pairLine} — ไปอัพเดทยอดที่หน้ากะของไลน์นั้น)` : ''}`);
        }
      }
    }

    setShowManualOpen(false);
    setManualForm({ mat_no: '', qty: '', is_backfill: false, backfill_time: '' });
    loadProdOrders(selSession.id, selSession.line_name);
  };

  const handleManualQtyUpdate = async (o) => {
    const v = parseInt(manualQtyDraft[o.id]);
    if (isNaN(v) || v < 0) { toast.error('กรอกยอดสะสม (ชิ้น) ก่อน'); return; }
    const delta = v - (o.qty_actual || 0);
    const { error } = await supabaseDR.from('prod_orders')
      .update({ qty_actual: v, qty_updated_at: new Date().toISOString() }).eq('id', o.id);
    if (error) { toast.error(error.message); return; }
    // log ประวัติต่อช่วง (best-effort — ประวัติพังไม่ทำให้ยอดหลักพัง)
    await supabaseDR.from('prod_order_qty_updates')
      .insert({ order_id: o.id, qty_accum: v, qty_delta: delta, logged_by: fullName }).then(() => {}, () => {});
    toast.success(`อัพเดทยอด ${o.mat_no}: ${v}/${o.qty_target ?? o.qty} ชิ้น (${delta >= 0 ? '+' : ''}${delta} จากครั้งก่อน) ✓`);
    setManualQtyDraft(d => ({ ...d, [o.id]: '' }));
    loadProdOrders(selSession.id, selSession.line_name);
  };

  // ปิดใบ manual ด้วยยอดผลิตจริง (แทนการสแกนปิด) — qty ถูกแทนด้วยยอดจริงเพื่อให้
  // OEE/รายงาน/stock (trigger ใช้ coalesce(qty_ok, qty)) นับจากของที่ผลิตได้จริง
  const handleManualClose = async (o) => {
    const draft = parseInt(manualQtyDraft[o.id]);
    const finalQty = !isNaN(draft) ? draft : (o.qty_actual || 0);
    if (!window.confirm(`ปิดใบ ${o.prod_no} (${o.mat_no}) ด้วยยอดผลิตจริง ${finalQty} ชิ้น?\nเป้าที่ตั้งไว้ ${o.qty_target ?? o.qty} ชิ้น`)) return;
    const nowIso = new Date().toISOString();
    const { error } = await supabaseDR.from('prod_orders').update({
      status: 'confirmed', confirmed_by: fullName, confirmed_at: nowIso,
      qty: finalQty, qty_ok: finalQty, qty_actual: finalQty, qty_updated_at: nowIso,
    }).eq('id', o.id);
    if (error) { toast.error(error.message); return; }
    // log แถวปิดใบ — เก็บส่วนต่างช่วงสุดท้ายไว้ในประวัติด้วย
    await supabaseDR.from('prod_order_qty_updates')
      .insert({ order_id: o.id, qty_accum: finalQty, qty_delta: finalQty - (o.qty_actual || 0), is_final: true, logged_by: fullName }).then(() => {}, () => {});
    toast.success(`ปิดใบ ${o.prod_no} · ${finalQty} ชิ้น ✓`);
    setManualQtyDraft(d => ({ ...d, [o.id]: '' }));
    loadProdOrders(selSession.id, selSession.line_name);
  };

  // ── บันทึกงานเสีย handler ──────────────────────────────────────
  const handleAddDefectLog = async () => {
    if (!selSession || !defectForm.defect_type_id) { toast.error('เลือกประเภทงานเสีย'); return; }
    // ไลน์เดียวอาจผลิตได้หลาย MAT.NO พร้อมกัน — ถ้าไลน์นี้มี MAT.NO ที่ผลิตอยู่ ต้องเลือกก่อนทุกครั้ง
    // เพื่อไม่ให้งานเสียถูกลงรวมเป็นของไลน์ทั้งไลน์ทั้งที่เสียแค่ MAT.NO เดียว
    const matNoOptions = Array.from(new Set(prodOrders.filter(o => o.status !== 'cancelled').map(o => o.mat_no))).filter(Boolean);
    if (matNoOptions.length && !defectForm.mat_no) { toast.error('เลือก MAT.NO ที่เสียก่อน'); return; }
    const ng      = parseInt(defectForm.qty_ng)      || 0;
    const suspect = parseInt(defectForm.qty_suspect) || 0;
    const repair  = parseInt(defectForm.qty_repair)  || 0;
    if (ng + suspect + repair === 0) { toast.error('กรอกจำนวนงานเสียอย่างน้อย 1 ช่อง'); return; }
    // ประเภท "อื่นๆ" เปล่าๆ บอกอะไรไม่ได้ — บังคับระบุอาการ/สาเหตุจริงเสมอ (เหมือนกฎฝั่ง Downtime)
    const defTypeName = defectTypes.find(t => t.id === defectForm.defect_type_id)?.name_th || '';
    if (defTypeName.includes('อื่น') && !defectForm.description?.trim()) {
      toast.error('ประเภท "อื่นๆ" ต้องระบุรายละเอียด/อาการด้วย — เพื่อให้รายงานและประชุมเช้าอ่านรู้เรื่อง');
      return;
    }
    setSavingDefect(true);
    const { data: { user } } = await supabase.auth.getUser();
    const matchedOrder = defectForm.mat_no
      ? (prodOrders.find(o => o.mat_no === defectForm.mat_no && o.status === 'open')
         || prodOrders.filter(o => o.mat_no === defectForm.mat_no).sort((a, b) => new Date(b.opened_at) - new Date(a.opened_at))[0])
      : null;
    const payload = {
      prod_order_id:    matchedOrder?.id || null,
      defect_type_id:   defectForm.defect_type_id,
      qty_ng:           ng,
      qty_suspect:      suspect,
      qty_repair:       repair,
      description:      defectForm.description || null,
    };
    const { error } = defectForm.id
      ? await supabaseDR.from('defect_logs').update(payload).eq('id', defectForm.id)
      : await supabaseDR.from('defect_logs').insert({
          ...payload,
          session_id:       selSession.id,
          reported_by_name: fullName,
          reported_by_uid:  user?.id,
        });
    setSavingDefect(false);
    if (error) { toast.error(error.message); return; }
    const label = [ng ? `NG ${ng}` : '', suspect ? `สงสัย ${suspect}` : '', repair ? `ซ่อม ${repair}` : ''].filter(Boolean).join(' · ');
    toast.success(defectForm.id ? `แก้ไขงานเสีย: ${label} ✓` : `บันทึกงานเสีย: ${label} ✓`);
    setShowDefect(false);
    setDefectForm({ id: null, mat_no: '', defect_type_id: '', qty_ng: '0', qty_suspect: '0', qty_repair: '0', description: '' });
    loadDefectLogs(selSession.id);
  };

  const handleDeleteDefectLog = async (id) => {
    if (!window.confirm('ลบรายการงานเสียนี้?')) return;
    const { error } = await supabaseDR.from('defect_logs').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    loadDefectLogs(selSession.id);
  };

  const handleDeleteProdOrder = async (id) => {
    if (!window.confirm('ลบ Prod Order นี้?')) return;
    const { error } = await supabaseDR.from('prod_orders').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    loadProdOrders(selSession.id, selSession.line_name);
  };

  // หา opened_at สำหรับ order ที่ยกยอดเข้ามา — anchor กับ "เวลาเริ่มกะ" ของ session ใหม่เสมอ
  // (ไม่ใช่เวลาที่กดปุ่ม import จริง) เพื่อให้ Heijunka จัดออเดอร์นี้ไว้ที่ต้นแถวของกะใหม่ ไม่ใช่ลอยไปอยู่
  // ช่วงเวลาปัจจุบันตามนาฬิกาจริง ซึ่งอาจยังอยู่ในครึ่งวันของกะเก่า ทำให้การ์ดไม่ถูกจัดเรียงเข้าแถวกะใหม่
  const carryImportOpenedAt = () => {
    if (!selSession?.work_date || !selSession?.start_time) return null;
    const [h, m] = selSession.start_time.split(':').map(Number);
    let d = new Date(`${selSession.work_date}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`);
    if (selSession.shift === 'night' && h < 8) d = new Date(d.getTime() + 86400000);
    return d.toISOString();
  };

  // Import carry-over orders into current session
  const handleImportCarryOrders = async () => {
    if (!selSession || !carryOrders.length) return;
    let imported = 0;
    const opened_at = carryImportOpenedAt();
    for (const o of carryOrders) {
      const dup = prodOrders.find(p => p.prod_no === o.prod_no);
      if (dup) {
        // มีในกะนี้แล้ว — mark ต้นทางทุกใบ (รวมใบซ้ำในกะเก่าๆ) เป็น imported เพื่อให้ banner เคลียร์ออก
        await supabaseDR.from('prod_orders').update({ status: 'imported' })
          .eq('prod_no', o.prod_no).in('status', ['carry_over', 'open']).neq('session_id', selSession.id);
        continue;
      }
      const remainQty = o.qty - (o.qty_actual || 0);
      if (remainQty <= 0) {
        // ผลิตครบเป้าแล้ว ไม่ต้องยกยอด — แค่ปิดต้นทางไม่ให้ขึ้นเตือนค้างอีก
        await supabaseDR.from('prod_orders').update({ status: 'imported' })
          .eq('prod_no', o.prod_no).in('status', ['carry_over', 'open']).neq('session_id', selSession.id);
        continue;
      }
      const { error } = await supabaseDR.from('prod_orders').insert({
        session_id:   selSession.id,
        prod_no:      o.prod_no,
        mat_no:       o.mat_no,
        part_name:    o.part_name,
        p_no:         o.p_no,
        customer:     o.customer,
        qty:          remainQty,
        status:       'open',
        opened_by:    fullName,
        carry_over_from_session_id: o.session_id,
        carry_over_note: o.carry_over_note || `ค้างจากกะก่อน (ทำได้ ${o.qty_actual || 0}/${o.qty} ชิ้น)`,
        ...(opened_at ? { opened_at } : {}),
      });
      if (!error) {
        imported++;
        // Mark original orders (ทุกใบที่ prod_no ตรงกันในกะเก่า) as 'imported'
        await supabaseDR.from('prod_orders').update({ status: 'imported' })
          .eq('prod_no', o.prod_no).in('status', ['carry_over', 'open']).neq('session_id', selSession.id);
      }
    }
    toast.success(`รับยอดค้างมาแล้ว ${imported} Order`);
    loadProdOrders(selSession.id, selSession.line_name);
  };

  const computePolicyBreakMin = (openedAt, closedAt, sessionShift, processType) => {
    if (!openedAt) return 0;
    const matchShift = (p) => p.shift === 'both' || p.shift === sessionShift;
    const matchProc  = (p) => p.process_type === 'common' || p.process_type === processType;
    return breakPolicies.filter(p => matchShift(p) && matchProc(p)).reduce((sum, p) => {
      // Build policy window anchored to the session's work date
      const sessWorkDate = selSession?.work_date || workDate(openedAt);
      const [ph, pm] = (p.start_time || '00:00').split(':').map(Number);
      let pStart = new Date(`${sessWorkDate}T${String(ph).padStart(2,'0')}:${String(pm).padStart(2,'0')}:00`);
      let pEnd = new Date(pStart.getTime() + p.duration_min * 60000);
      // For night shift break that crosses midnight, shift the whole window forward a day if it ended before session start
      if (pEnd < openedAt) {
        pStart = new Date(pStart.getTime() + 86400000);
        pEnd   = new Date(pEnd.getTime() + 86400000);
      }
      const overlapStart = Math.max(pStart.getTime(), openedAt.getTime());
      const overlapEnd   = Math.min(pEnd.getTime(), closedAt.getTime());
      const overlapMin   = Math.max(0, (overlapEnd - overlapStart) / 60000);
      return sum + overlapMin;
    }, 0);
  };

  // dtLogsOverride: ใช้ตอนปิดกะที่เพิ่งปิด/ตัดยอด Downtime เปิดค้างไปใน call เดียวกัน — state dtLogs ยังเป็นค่าเก่า
  const computeOEE = (ngQtyOverride, endTimeOverride, startTimeOverride, dtLogsOverride) => {
    const dtl = dtLogsOverride || dtLogs;
    const confirmedQty = prodOrders.filter(o => o.status === 'confirmed').reduce((s, o) => s + o.qty, 0);
    // Also count qty_actual from open orders being carried over
    const carryActualQty = prodOrders.filter(o => o.status === 'open').reduce((s, o) => s + (parseInt(carryQtyActual[o.id]) || 0), 0);
    const totalProduced  = confirmedQty + carryActualQty;
    const ngQty = ngQtyOverride !== undefined ? ngQtyOverride
      : defectLogs.reduce((s, d) => s + (d.qty_ng || 0) + (d.qty_suspect || 0), 0);
    // ใช้ work_date + start_time (เวลาเริ่มกะที่ตั้งไว้จริง) เป็นจุดเริ่ม — ไม่ใช่ created_at ที่อาจคลาดเคลื่อนจากเวลาที่หัวหน้าเช็คชื่อ/เปิดระบบ
    // start_time แก้ได้ตอนปิดกะ (startTimeOverride) เผื่อตอนเปิดกะ/auto-open เดาเวลาผิด
    const workDate    = selSession?.work_date;
    const startTimeStr = startTimeOverride || selSession?.start_time;
    const openedAt  = (workDate && startTimeStr) ? new Date(`${workDate}T${startTimeStr.slice(0,5)}:00`) : null;
    // เวลาปิดกะใช้ "เวลาปิดกะจริง" ที่กรอกในฟอร์ม (endTimeOverride) แทนเวลาที่กดปุ่มจริง เพราะการขอ/อนุมัติปิดกะอาจทำย้อนหลังได้
    let closedAt = new Date();
    if (workDate && endTimeOverride) {
      closedAt = new Date(`${workDate}T${endTimeOverride.slice(0,5)}:00`);
      if (openedAt && closedAt < openedAt) closedAt = new Date(closedAt.getTime() + 86400000); // กะดึกข้ามวัน
    }
    const shiftMin  = openedAt ? Math.round((closedAt - openedAt) / 60000) : 0;
    const loggedPlannedDT  = dtl.filter(d => d.dr_downtime_types?.category === 'planned').reduce((s, d) => s + (d.duration_min || 0), 0);
    const loggedUnplannedDT = dtl.filter(d => d.dr_downtime_types?.category !== 'planned').reduce((s, d) => s + (d.duration_min || 0), 0);
    const sessionShift  = selSession?.shift || 'day';
    const processType   = sessionProcessType();
    const policyBreakMin = computePolicyBreakMin(openedAt, closedAt, sessionShift, processType);
    // Net available = shift - policy breaks - logged planned; run = net available - unplanned
    const plannedDT   = loggedPlannedDT + policyBreakMin;
    const netAvail    = Math.max(0, shiftMin - plannedDT);
    const runMin      = Math.max(0, netAvail - loggedUnplannedDT);

    // Availability: ถ้ากะนี้มีหลาย MAT.NO/product วิ่งคนละช่วงเวลากัน (เช่นไลน์ร่วม APRON ASSY) ให้แยกคำนวณ
    // netAvail/runMin ตามช่วงเวลาเปิด-ปิดของแต่ละ MAT.NO เอง แล้วถ่วงเฉลี่ยตามเวลาที่รัน (runMin) กลับเป็นค่าไลน์
    // เดียว — ไม่ใช้ช่วงเวลาทั้งกะตัวเดียวคำนวณรวม เพราะ MAT.NO หนึ่งอาจหยุดวิ่งไปแล้วก่อนเวลาปิดกะจริง
    // เวลาที่หัวหน้ากะแก้เองต่อ MAT.NO (เฉพาะ MAT.NO ที่ confirmed ครบแล้ว) — แก้ทับช่วงที่ระบบจับเวลาอัตโนมัติไว้
    const applyMatTimeOverride = (matNo, hasOpenOrders, startMs, endMs) => {
      if (hasOpenOrders) return { startMs, endMs };
      const ov = matTimeOverride[matNo];
      if (!ov || !workDate) return { startMs, endMs };
      let s = startMs, e = endMs;
      if (ov.start) s = new Date(`${workDate}T${ov.start.slice(0,5)}:00`).getTime();
      if (ov.end) {
        e = new Date(`${workDate}T${ov.end.slice(0,5)}:00`).getTime();
        if (s != null && e < s) e += 86400000;
      }
      return { startMs: s, endMs: e };
    };
    let totalNetAvailByMat = 0, totalRunMinByMat = 0;
    const matRunMinMap = {};
    const matNosForA = Array.from(new Set(prodOrders.map(o => o.mat_no)));
    matNosForA.forEach(matNo => {
      const orders = prodOrders.filter(o => o.mat_no === matNo);
      const hasOpenOrders = orders.some(o => o.status === 'open');
      const openedTimes = orders.map(o => o.opened_at).filter(Boolean).map(t => new Date(t).getTime());
      const closedTimes = orders.filter(o => o.status === 'confirmed' && o.confirmed_at).map(o => new Date(o.confirmed_at).getTime());
      // ออเดอร์ที่ยังเปิดแต่ตัดสินใจ (ยกยอด/ยกเลิก) แล้วและกรอก "เวลาหยุดผลิตจริง" ไว้ — ใช้เวลานั้นปิดช่วงของ MAT.NO นี้
      const openStopTimes = orders.filter(o => o.status === 'open' && carryOverDecisions[o.id]).map(o => {
        const stopStr = carryStopTime[o.id] ?? endTimeOverride;
        if (!stopStr || !workDate) return null;
        let ms = new Date(`${workDate}T${stopStr.slice(0,5)}:00`).getTime();
        if (o.opened_at && ms < new Date(o.opened_at).getTime()) ms += 86400000;
        return ms;
      }).filter(Boolean);
      let matStartMs = openedTimes.length ? Math.min(...openedTimes) : null;
      let matEndMs   = (closedTimes.length || openStopTimes.length) ? Math.max(...closedTimes, ...openStopTimes) : null;
      ({ startMs: matStartMs, endMs: matEndMs } = applyMatTimeOverride(matNo, hasOpenOrders, matStartMs, matEndMs));
      if (matStartMs == null || matEndMs == null || matEndMs <= matStartMs) return;
      const windowMin = (matEndMs - matStartMs) / 60000;
      const matPolicyBreakMin = computePolicyBreakMin(new Date(matStartMs), new Date(matEndMs), sessionShift, processType);
      const matLoggedPlanned   = dtOverlapMin(matStartMs, matEndMs, d => d.dr_downtime_types?.category === 'planned', dtl);
      const matLoggedUnplanned = dtOverlapMin(matStartMs, matEndMs, d => d.dr_downtime_types?.category !== 'planned', dtl);
      const matNetAvail = Math.max(0, windowMin - matPolicyBreakMin - matLoggedPlanned);
      const matRunMin   = Math.max(0, matNetAvail - matLoggedUnplanned);
      totalNetAvailByMat += matNetAvail;
      totalRunMinByMat   += matRunMin;
      matRunMinMap[matNo] = matRunMin; // เก็บ run ต่อ MAT.NO — ใช้เป็น denominator ของ P ตอน parallel
    });
    // ถ้าแยกตาม MAT.NO ไม่ได้เลย (เช่นกะมีแต่ Downtime ไม่มี Order) ให้ fallback กลับไปใช้ช่วงเวลาทั้งกะแบบเดิม
    const A = totalNetAvailByMat > 0 ? Math.min(1, totalRunMinByMat / totalNetAvailByMat)
      : (netAvail > 0 ? Math.min(1, runMin / netAvail) : 0);

    // Performance: วัดประสิทธิภาพของไลน์ผลิต ไม่ใช่ของแต่ละ order
    // สูตร OEE มาตรฐาน: P = standard_time_produced / run_time
    //   standard_time = Σ(qty_i × CT_i)  ← เวลาที่ "ควรใช้" ถ้าวิ่งด้วย CT มาตรฐาน
    //   run_time = runMin × 60 วินาที    ← เวลาที่ไลน์วิ่งจริงทั้งกะ (หัก break + DT แล้ว)
    // Sequential (ทำทีละ MAT.NO): P = Σ(qty_i × CT_i) / run_time_sec
    // Parallel (หลาย MAT.NO วิ่งพร้อมกันคนละสถานี): P = mean(P_i) โดย P_i = (qty_i × CT_i) / run_time_sec
    //   → ใช้ order time window เพื่อ detect parallel เท่านั้น ไม่ใช่เป็น denominator
    const runSec = runMin * 60;
    const matNosForP = Array.from(new Set(prodOrders.map(o => o.mat_no)));
    const matPData = []; // { matNo, qty, ctSec, winStart, winEnd }
    let unknownQty = 0;
    matNosForP.forEach(matNo => {
      const orders = prodOrders.filter(o => o.mat_no === matNo);
      const qty = orders.filter(o => o.status === 'confirmed').reduce((s, o) => s + o.qty, 0)
                + orders.filter(o => o.status === 'open').reduce((s, o) => s + (parseInt(carryQtyActual[o.id]) || 0), 0);
      if (!qty) return;
      const ctSec = ctForMatNo(matNo);
      if (ctSec <= 0) { unknownQty += qty; return; }
      // window ใช้สำหรับ detect parallel เท่านั้น
      const openedTimes = orders.map(o => o.opened_at).filter(Boolean).map(t => new Date(t).getTime());
      const closedTimes = orders.filter(o => o.status === 'confirmed' && o.confirmed_at).map(o => new Date(o.confirmed_at).getTime());
      const stopTimes   = orders.filter(o => o.status === 'open' && carryOverDecisions[o.id]).map(o => {
        const s = carryStopTime[o.id] ?? endTimeOverride;
        if (!s || !workDate) return null;
        let ms = new Date(`${workDate}T${s.slice(0, 5)}:00`).getTime();
        if (o.opened_at && ms < new Date(o.opened_at).getTime()) ms += 86400000;
        return ms;
      }).filter(Boolean);
      const winStart = openedTimes.length ? Math.min(...openedTimes) : null;
      const allEnd   = [...closedTimes, ...stopTimes];
      const winEnd   = allEnd.length ? Math.max(...allEnd) : null;
      matPData.push({ matNo, qty, ctSec, winStart, winEnd });
    });
    const knownQty = matPData.reduce((s, d) => s + d.qty, 0);

    // ตรวจ parallel: window ต้องทับกัน "อย่างมีนัยยะ" (> 15 นาที และ > 20% ของ window ที่สั้นกว่า)
    // — เดิมทับกันแค่ไม่กี่นาที (จังหวะสแกนปิดชุดเก่าคาบเกี่ยวเปิดชุดใหม่) ก็ถูกตีเป็น parallel
    // เคยพัง 2026-07-13: Line 60 กะดึก 2 MAT ต่อคิวกันแต่ window ทับ 2 นาที → P ตกจาก ~83% เหลือ 44%
    const overlapOf = (a, b) => Math.max(0, (Math.min(a.winEnd, b.winEnd) - Math.max(a.winStart, b.winStart)) / 60000);
    const isParallel = matPData.length > 1 && matPData.some((a, i) =>
      matPData.slice(i + 1).some(b => {
        if (a.winStart == null || a.winEnd == null || b.winStart == null || b.winEnd == null) return false;
        const ov = overlapOf(a, b);
        const minDurMin = Math.min(a.winEnd - a.winStart, b.winEnd - b.winStart) / 60000;
        return ov > 15 && ov > 0.2 * minDurMin;
      })
    );

    let P = null;
    if (runSec > 0 && matPData.length > 0) {
      const totalStdSec = matPData.reduce((s, d) => s + d.qty * d.ctSec, 0);
      if (isParallel) {
        // Parallel (คนละสถานีวิ่งพร้อมกัน): denominator = Σ run ต่อ MAT.NO (เวลาของแต่ละสถานีรวมกัน)
        // = ถ่วงน้ำหนัก P ตามเวลารันจริงของแต่ละสถานี — ห้ามใช้ mean เท่าๆ กัน
        // (เคยพัง 2026-07-13: Line 61 มีงานแทรก 10 ชิ้น/10 นาที window ทับงานหลัก → mean ลาก P ทั้งกะ
        //  จาก ~93% เหลือ 48% ทั้งที่งานแทรกวิ่งเต็มประสิทธิภาพในช่วงของมันเอง)
        const denomSec = matPData.reduce((s, d) => s + (matRunMinMap[d.matNo] ?? 0) * 60, 0) || runSec;
        P = Math.min(1, totalStdSec / denomSec);
      } else {
        // Sequential: standard time รวมหารด้วย run_time ทั้งกะ (จับ idle ระหว่าง MAT.NO ด้วย)
        P = Math.min(1, totalStdSec / runSec);
      }
    }
    const Q = totalProduced > 0 ? Math.max(0, (totalProduced - ngQty) / totalProduced) : 1;
    const oee = P != null ? A * P * Q : null;
    return { A, P, Q, oee, shiftMin, netAvail, runMin, policyBreakMin, plannedDT, totalProduced, ngQty, knownQty, unknownQty };
  };
  // NOTE: การหัก Line Stock (child parts) ทำโดย DB trigger trg_explode_child_demand
  // บน prod_orders — backflush ตอน order เปลี่ยนเป็น 'confirmed' (ระเบิด BOM → หัก
  // least(on_hand, gross) จาก mini-store ของไลน์ → ส่วนขาดเข้า accumulator → ถึง lot
  // สั่งผลิต child 200 + เบิก raw 500 + packaging). ไม่หักที่หน้าปิดกะอีกแล้ว เพื่อไม่ให้
  // order ที่ confirmed ถูกหักซ้ำ (order ที่ยกยอดจะถูก backflush เมื่อ confirmed ในกะถัดไป).

  const handleCloseSession = async () => {
    if (!selSession) return;

    // Check open orders that haven't been decided yet
    const openOrders = prodOrders.filter(o => o.status === 'open');
    const undecided  = openOrders.filter(o => !carryOverDecisions[o.id]);
    if (undecided.length > 0) {
      toast.error(`มี ${undecided.length} Order ที่ยังไม่ได้ตัดสินใจ (ผลิตครบแล้ว / ยกยอด / ยกเลิก)`);
      return;
    }
    // ครบเป้าแล้วแต่ยังเลือก "ยกยอดต่อ" — ไม่มีอะไรเหลือให้ยก ต้องใช้ "ผลิตครบแล้ว" แทน
    const invalidCarry = openOrders.filter(o => carryOverDecisions[o.id] === 'carry' && (parseInt(carryQtyActual[o.id]) || 0) >= o.qty);
    if (invalidCarry.length > 0) {
      toast.error(`มี ${invalidCarry.length} Order ที่ผลิตครบเป้าแล้วแต่เลือก "ยกยอดต่อ" — กรุณาเปลี่ยนเป็น "ผลิตครบแล้ว"`);
      return;
    }

    // Downtime ที่ยังเปิดค้าง (เริ่มไว้แต่ยังไม่ปิดรายการ) — ต้องตัดสินใจต่อรายการก่อนปิดกะ:
    //   'close' = เครื่องกลับมาแล้ว กรอกเวลาจบจริง | 'carry' = ยังซ่อมอยู่ ตัดยอดด้วยเวลาปิดกะแล้วเปิดต่อกะถัดไป
    // ไม่งั้นช่วงเวลานั้นจะไม่ถูกหักออกจาก Availability ตอนคำนวณ OEE (duration_min เป็น null = นับเป็น 0 นาที)
    const openDT = dtLogs.filter(d => d.duration_min == null);
    const dtUndecided = openDT.filter(d => !dtCarryDecisions[d.id] || (dtCarryDecisions[d.id] === 'close' && !dtCloseTimes[d.id]));
    if (dtUndecided.length > 0) {
      toast.error(`มี Downtime เปิดค้าง ${dtUndecided.length} รายการ — เลือก "เครื่องกลับมาแล้ว" (พร้อมเวลาจบ) หรือ "ยังซ่อมอยู่ ตัดยอดข้ามกะ" ในหัวข้อ Downtime เปิดค้างก่อน`);
      return;
    }

    // เตือนถ้ากะนี้ไม่มีข้อมูลการผลิตเลย — เผื่อพนักงานลืม Scan เปิด Order / บันทึก Downtime ก่อนปิดกะ
    if (prodOrders.length === 0 && dtLogs.length === 0) {
      if (!window.confirm('กะนี้ยังไม่มี Prod Order และไม่มี Downtime เลย — ยืนยันจะปิดกะหรือไม่?')) return;
    } else if (prodOrders.length === 0) {
      if (!window.confirm('กะนี้ยังไม่มี Prod Order เลย (มีแต่ Downtime) — ยืนยันจะปิดกะหรือไม่?')) return;
    }

    setSavingClose(true);

    // ── ปิด/ตัดยอด Downtime ที่เปิดค้าง ก่อนคำนวณ OEE (นาทีต้องเข้าไปหักใน %A ของกะนี้) ──
    const closeEndStr = closeEndTime || nowTime();
    let updatedDtLogs = dtLogs;
    for (const d of openDT) {
      if (!d.started_at) continue; // รายการเปิดค้างต้องมีเวลาเริ่มเสมอ (validation ตอนบันทึกบังคับ) — กันพังเฉยๆ
      const decision = dtCarryDecisions[d.id];
      const endStr   = decision === 'carry' ? closeEndStr : dtCloseTimes[d.id];
      const startMs  = new Date(d.started_at).getTime();
      let endMs = new Date(`${selSession.work_date}T${endStr.slice(0, 5)}:00`).getTime();
      if (endMs < startMs) endMs += 86400000; // ข้ามเที่ยงคืน (กะดึก)
      const dur = Math.max(1, Math.round((endMs - startMs) / 60000));
      const patch = { ended_at: new Date(endMs).toISOString(), duration_min: dur, carry_over: decision === 'carry' };
      const { error: dtErr } = await supabaseDR.from('downtime_logs').update(patch).eq('id', d.id);
      if (dtErr) { toast.error('ปิดรายการ Downtime ไม่สำเร็จ: ' + dtErr.message); setSavingClose(false); return; }
      updatedDtLogs = updatedDtLogs.map(x => x.id === d.id ? { ...x, ...patch } : x);
      // เครื่องกลับมาจริง → แจ้ง ✅ / ตัดยอดข้ามกะ = เครื่องยังไม่กลับมา ห้ามแจ้ง recovered
      if (decision === 'close') {
        const hm = (ms) => { const t = new Date(ms); return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`; };
        notifyDowntime({
          line_name: selSession.line_name, shift: selSession.shift, work_date: selSession.work_date,
          machine_no: d.machine_no,
          machine_name: machines.find(m => m.machine_no === d.machine_no)?.machine_name || '',
          type_name: d.dr_downtime_types?.name_th || '',
          start_time: hm(startMs), end_time: hm(endMs), duration_min: dur,
          mat_no: d.mat_no || null, description: d.description || null, reported_by: fullName,
        }, 'downtime_recovered');
      }
    }
    if (openDT.length) setDtLogs(updatedDtLogs);

    // Process carry-over decisions
    const { data: { user } } = await supabase.auth.getUser();
    for (const order of openOrders) {
      const decision  = carryOverDecisions[order.id];
      const qActual   = parseInt(carryQtyActual[order.id]) || 0;
      // เวลาหยุดผลิตจริงของออเดอร์นี้ — ใช้ที่กรอกไว้ ถ้าไม่ได้แก้ก็ใช้เวลาปิดกะรวมเป็น default
      const stopTimeStr = carryStopTime[order.id] ?? closeEndTime;
      let stoppedAt = null;
      if (stopTimeStr && selSession.work_date) {
        let ms = new Date(`${selSession.work_date}T${stopTimeStr.slice(0,5)}:00`).getTime();
        if (order.opened_at && ms < new Date(order.opened_at).getTime()) ms += 86400000; // กะดึกข้ามวัน
        stoppedAt = new Date(ms).toISOString();
      }
      if (decision === 'carry') {
        // หมายเหตุ: ไม่เซ็ต carry_over_from_session_id ที่นี่ — field นี้ใช้บอกว่า order นี้ "ถูกรับมาจากกะก่อน"
        // (ใส่ตอน import เท่านั้น ที่ handleImportCarryOrders) ถ้าเซ็ตที่นี่จะกลายเป็น order ตัวเองชี้กลับมาตัวเอง
        // ทำให้ขึ้นป้าย "ยกยอดมา" ผิดๆทั้งที่ยังไม่เคยถูกรับมาจากไหนเลย แค่กำลังจะถูกยกออกไปกะถัดไปเป็นครั้งแรก
        await supabaseDR.from('prod_orders').update({
          status:      'carry_over',
          qty_actual:  qActual,
          stopped_at:  stoppedAt,
          carry_over_note: `ยกยอด: ทำได้ ${qActual}/${order.qty} ชิ้น จาก${selSession.shift === 'day' ? 'กะเช้า' : 'กะดึก'} ${fmtDate(selSession.work_date)}`,
        }).eq('id', order.id);
      } else if (decision === 'confirm') {
        await supabaseDR.from('prod_orders').update({
          status:       'confirmed',
          qty_actual:   order.qty,
          stopped_at:   stoppedAt,
          confirmed_at: stoppedAt,
          confirmed_by: fullName,
        }).eq('id', order.id);
      } else if (decision === 'cancel') {
        await supabaseDR.from('prod_orders').update({ status: 'cancelled', qty_actual: qActual, stopped_at: stoppedAt }).eq('id', order.id);
      }
    }

    // บันทึกเวลาเริ่ม-หยุดจริงที่แก้เองต่อ MAT.NO (เฉพาะ MAT.NO ที่ confirmed ครบแล้ว) — แก้ opened_at ของออเดอร์ที่เปิดก่อนสุด
    // และ confirmed_at ของออเดอร์ที่ปิดล่าสุด เพื่อให้ช่วงเวลาที่หน้าอื่น (SV review, OEEAnalytics) อ่านย้อนหลังตรงกับที่แก้ไว้
    for (const [matNo, ov] of Object.entries(matTimeOverride)) {
      if (!ov || (!ov.start && !ov.end) || !selSession.work_date) continue;
      const orders = prodOrders.filter(o => o.mat_no === matNo);
      if (!orders.length || orders.some(o => o.status === 'open')) continue;
      if (ov.start) {
        const firstOrder = orders.reduce((a, b) => (!a.opened_at || (b.opened_at && new Date(b.opened_at) < new Date(a.opened_at))) ? b : a);
        const ms = new Date(`${selSession.work_date}T${ov.start.slice(0,5)}:00`).getTime();
        await supabaseDR.from('prod_orders').update({ opened_at: new Date(ms).toISOString() }).eq('id', firstOrder.id);
      }
      if (ov.end) {
        const confirmedOrders = orders.filter(o => o.status === 'confirmed' && o.confirmed_at);
        if (confirmedOrders.length) {
          const lastOrder = confirmedOrders.reduce((a, b) => (new Date(b.confirmed_at) > new Date(a.confirmed_at)) ? b : a);
          let ms = new Date(`${selSession.work_date}T${ov.end.slice(0,5)}:00`).getTime();
          if (lastOrder.opened_at && ms < new Date(lastOrder.opened_at).getTime()) ms += 86400000;
          await supabaseDR.from('prod_orders').update({ confirmed_at: new Date(ms).toISOString() }).eq('id', lastOrder.id);
        }
      }
    }

    // Quality totals from defect_logs
    const totalQtyNg      = defectLogs.reduce((s, d) => s + (d.qty_ng      || 0), 0);
    const totalQtySuspect = defectLogs.reduce((s, d) => s + (d.qty_suspect || 0), 0);
    const totalQtyRepair  = defectLogs.reduce((s, d) => s + (d.qty_repair  || 0), 0);
    const confirmed       = prodOrders.filter(o => o.status === 'confirmed');
    const carryActual     = openOrders.reduce((s, o) => s + (parseInt(carryQtyActual[o.id]) || 0), 0);
    const totalProducedFinal = confirmed.reduce((s, o) => s + o.qty, 0) + carryActual;
    const totalQtyOk      = Math.max(0, totalProducedFinal - totalQtyNg - totalQtySuspect - totalQtyRepair);

    const { A, P, Q, oee, shiftMin } = computeOEE(totalQtyNg + totalQtySuspect, closeEndTime, closeStartTime, updatedDtLogs);
    const startTimeChanged = closeStartTime && closeStartTime !== selSession.start_time;
    // Leader → request close (pending_close), SV+ → close directly
    const isLeaderRequest = role === 'leader';
    const payload = isLeaderRequest ? {
      status:                  'pending_close',
      close_requested_by_name: fullName,
      close_requested_by_uid:  user?.id,
      close_requested_at:      new Date().toISOString(),
      end_time:                closeEndTime || nowTime(),
      ...(startTimeChanged ? { start_time: closeStartTime } : {}),
      ng_qty:                  totalQtyNg,
      actual_qty:              totalProducedFinal,
      qty_ok:                  totalQtyOk,
      qty_ng:                  totalQtyNg,
      qty_suspect:             totalQtySuspect,
      qty_repair:              totalQtyRepair,
      shift_min:               shiftMin,
      oee_a:                   parseFloat((A * 100).toFixed(2)),
      oee_p:                   P != null ? parseFloat((P * 100).toFixed(2)) : null,
      oee_q:                   parseFloat((Q * 100).toFixed(2)),
      oee:                     oee != null ? parseFloat((oee * 100).toFixed(2)) : null,
    } : {
      status:          'closed',
      closed_by_name:  fullName,
      closed_by_uid:   user?.id,
      closed_at:       new Date().toISOString(),
      end_time:        closeEndTime || nowTime(),
      ...(startTimeChanged ? { start_time: closeStartTime } : {}),
      ng_qty:          totalQtyNg,
      actual_qty:      totalProducedFinal,
      qty_ok:          totalQtyOk,
      qty_ng:          totalQtyNg,
      qty_suspect:     totalQtySuspect,
      qty_repair:      totalQtyRepair,
      shift_min:       shiftMin,
      oee_a:           parseFloat((A * 100).toFixed(2)),
      oee_p:           P != null ? parseFloat((P * 100).toFixed(2)) : null,
      oee_q:           parseFloat((Q * 100).toFixed(2)),
      oee:             oee != null ? parseFloat((oee * 100).toFixed(2)) : null,
    };

    const { error } = await supabaseDR.from('production_sessions').update(payload).eq('id', selSession.id);
    setSavingClose(false);
    if (error) { toast.error(error.message); return; }

    // Line Stock ถูกหักโดย DB trigger บน prod_orders (backflush ตอน confirmed) — ดูหมายเหตุด้านบน

    const oeeLabel = oee != null ? `${(oee * 100).toFixed(1)}%` : 'N/A (ไม่มี Cycle Time)';
    if (isLeaderRequest) {
      toast.info(`ส่งคำขอปิดกะแล้ว — รอ SV อนุมัติ · OEE Preview ${oeeLabel}`);
    } else {
      toast.success(`ปิดกะสำเร็จ · OEE ${oeeLabel} · ดี ${totalQtyOk} / NG ${totalQtyNg} / สงสัย ${totalQtySuspect}`);
    }
    notifyProdClose({
      status: isLeaderRequest ? 'pending_close' : 'closed',
      line_name: selSession.line_name, shift: selSession.shift, work_date: selSession.work_date,
      actor: fullName, qty_ok: totalQtyOk, qty_ng: totalQtyNg, qty_suspect: totalQtySuspect,
      oee: oee != null ? parseFloat((oee * 100).toFixed(1)) : null,
      // รายละเอียดเพิ่มเติม — ให้ข้อความ Telegram ครอบคลุมเท่าหน้าสรุปปิดกะ
      start_time:   (closeStartTime || selSession.start_time || '').slice(0, 5) || null,
      end_time:     (closeEndTime || '').slice(0, 5) || null,
      shift_min:    shiftMin,
      qty_repair:   totalQtyRepair,
      total_qty:    totalProducedFinal,
      oee_a:        parseFloat((A * 100).toFixed(1)),
      oee_p:        P != null ? parseFloat((P * 100).toFixed(1)) : null,
      oee_q:        parseFloat((Q * 100).toFixed(1)),
      parts: summarizeParts([
        ...confirmed.map(o => ({ mat_no: o.mat_no, part_name: o.part_name, qty: o.qty })),
        ...openOrders.map(o => carryOverDecisions[o.id] === 'confirm'
          ? { mat_no: o.mat_no, part_name: o.part_name, qty: o.qty }
          : { mat_no: o.mat_no, part_name: o.part_name, qty: parseInt(carryQtyActual[o.id]) || 0, carry: true }),
      ]),
      downtimes:    summarizeDowntimes(updatedDtLogs),
      dt_total_min: Math.round(updatedDtLogs.reduce((s, d) => s + (d.duration_min || 0), 0)),
      dt_count:     updatedDtLogs.length,
      dt_carry:     openDT.filter(d => dtCarryDecisions[d.id] === 'carry')
        .map(d => ({ machine_no: d.machine_no, type_name: d.dr_downtime_types?.name_th || '' })),
    });
    setShowCloseShift(false);
    setCarryOverDecisions({});
    setCarryQtyActual({});
    setCarryStopTime({});
    setMatTimeOverride({});
    setDtCarryDecisions({});
    setDtCloseTimes({});
    load();
    setSelSession(null);
    setDtLogs([]);
    setProdOrders([]);
  };

  // SV approves pending_close → finalize to 'closed'
  const handleApproveClose = async () => {
    if (!selSession || selSession.status !== 'pending_close') return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabaseDR.from('production_sessions').update({
      status:         'closed',
      closed_by_name: fullName,
      closed_by_uid:  user?.id,
      closed_at:      new Date().toISOString(),
    }).eq('id', selSession.id);
    if (error) { toast.error(error.message); return; }

    // Line Stock หักโดย DB trigger บน prod_orders (backflush ตอน confirmed) — ไม่หักซ้ำที่นี่

    toast.success(`อนุมัติปิดกะแล้ว ✓ (ขอโดย ${selSession.close_requested_by_name || '—'})`);
    notifyProdClose({
      status: 'closed_approved', line_name: selSession.line_name, shift: selSession.shift,
      work_date: selSession.work_date, actor: fullName,
      requested_by: selSession.close_requested_by_name,
      qty_ok: selSession.qty_ok, qty_ng: selSession.qty_ng, oee: selSession.oee,
      // รายละเอียดเพิ่มเติม — อ่านจากค่าที่บันทึกไว้ตอนขอปิดกะ + ข้อมูลกะที่โหลดอยู่
      start_time:   (selSession.start_time || '').slice(0, 5) || null,
      end_time:     (selSession.end_time || '').slice(0, 5) || null,
      shift_min:    selSession.shift_min,
      qty_suspect:  selSession.qty_suspect,
      qty_repair:   selSession.qty_repair,
      total_qty:    selSession.actual_qty,
      oee_a:        selSession.oee_a,
      oee_p:        selSession.oee_p,
      oee_q:        selSession.oee_q,
      parts: summarizeParts(prodOrders.map(o => o.status === 'confirmed'
        ? { mat_no: o.mat_no, part_name: o.part_name, qty: o.qty }
        : o.status === 'carry_over'
          ? { mat_no: o.mat_no, part_name: o.part_name, qty: o.qty_actual || 0, carry: true }
          : null).filter(Boolean)),
      downtimes:    summarizeDowntimes(dtLogs),
      dt_total_min: Math.round(dtLogs.reduce((s, d) => s + (d.duration_min || 0), 0)),
      dt_count:     dtLogs.length,
    });
    load();
    setSelSession(null);
    setDtLogs([]);
    setProdOrders([]);
  };

  // SV rejects pending_close → revert to 'open'
  const handleRejectClose = async () => {
    if (!selSession || selSession.status !== 'pending_close') return;
    // ยอดยกของกะนี้เปิดให้กะถัดไปรับได้ทันทีที่ขอปิดกะ (ไม่รอ SV) — ถ้ากะถัดไปรับไปแล้ว (status: 'imported')
    // ห้ามปฏิเสธ เพราะข้อมูลถูกใช้ไปแล้ว ย้อนกลับเป็น open เฉยๆจะทำให้ของซ้ำซ้อน/ขัดแย้งกับกะถัดไป
    const { data: alreadyImported } = await supabaseDR.from('prod_orders')
      .select('id').eq('session_id', selSession.id).eq('status', 'imported').limit(1);
    if (alreadyImported?.length) {
      toast.error('ไม่สามารถปฏิเสธได้ — มียอดยกของกะนี้ถูกกะถัดไปรับไปแล้ว กรุณาแก้ไขร่วมกับหัวหน้ากะถัดไปก่อน');
      return;
    }
    if (!window.confirm('ปฏิเสธคำขอปิดกะ? กะจะกลับสู่สถานะ "กำลังผลิต"')) return;
    // คืนสถานะ order ที่เคยถูกยกยอด/ยกเลิกไว้ตอนขอปิดกะ กลับเป็น open เพื่อให้ leader แก้ไขใหม่ได้
    await supabaseDR.from('prod_orders').update({
      status:                      'open',
      carry_over_note:             null,
      carry_over_from_session_id:  null,
      qty_actual:                  0,
    }).eq('session_id', selSession.id).in('status', ['carry_over', 'cancelled']);
    const { error } = await supabaseDR.from('production_sessions').update({
      status:                  'open',
      close_requested_by_name: null,
      close_requested_by_uid:  null,
      close_requested_at:      null,
      end_time:                null,
      actual_qty:              0, qty_ok: 0, qty_ng: 0, qty_suspect: 0, qty_repair: 0, ng_qty: 0,
      oee_a: null, oee_p: null, oee_q: null, oee: null,
    }).eq('id', selSession.id);
    if (error) { toast.error(error.message); return; }
    toast.info('ปฏิเสธคำขอปิดกะ — กะกลับสู่ "กำลังผลิต"');
    notifyProdClose({
      status: 'closed_rejected', line_name: selSession.line_name, shift: selSession.shift,
      work_date: selSession.work_date, actor: fullName,
      requested_by: selSession.close_requested_by_name,
    });
    load();
    setSelSession(prev => ({ ...prev, status: 'open', close_requested_by_name: null }));
  };

  const handleDeleteDT = async (id) => {
    if (!window.confirm('ลบ Downtime นี้?')) return;
    const { error } = await supabaseDR.from('downtime_logs').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    loadDT(selSession.id);
  };

  // เรียกช่าง MTN เข้าหน้างาน — แจ้ง Telegram ทันที + เสียงไซเรนดังหน้า Maintenance (ผ่าน realtime call_mtn)
  const handleCallMtn = async (d) => {
    if (d.call_mtn) return;
    const { error } = await supabaseDR.from('downtime_logs')
      .update({ call_mtn: true, call_mtn_at: new Date().toISOString(), call_mtn_by: fullName }).eq('id', d.id);
    if (error) { toast.error(error.message); return; }
    const dtType = dtTypes.find(t => t.id === d.downtime_type_id);
    const mcName = machines.find(m => m.machine_no === d.machine_no)?.machine_name || '';
    notifyDowntime({
      line_name: selSession.line_name, shift: selSession.shift, work_date: selSession.work_date,
      machine_no: d.machine_no, machine_name: mcName,
      type_name: dtType?.name_th || '', category: dtType?.category || '',
      start_time: d.started_at ? fmtTime(new Date(d.started_at)) : null,
      description: d.description || null, reported_by: fullName,
    }, 'downtime_call_mtn');
    toast.success('📞 เรียกช่าง MTN แล้ว — แจ้งเตือนทันที');
    loadDT(selSession.id);
  };

  const totalDT      = dtLogs.reduce((s, d) => s + (d.duration_min || 0), 0);
  const unplannedDT  = dtLogs.filter(d => d.dr_downtime_types?.category === 'unplanned').reduce((s, d) => s + (d.duration_min || 0), 0);

  if (loading) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>กำลังโหลด...</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: (sessions.length > 1 && !isMobile) ? '220px 1fr' : '1fr', gap: 16 }}>
      {sessions.length > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>กะที่เปิดอยู่</div>
          {(() => {
            // Group sessions by parent line (or self if no parent)
            const groups = {};
            sessions.forEach(s => {
              const parent = lineMap[s.line_name]?.parent_line_name || s.line_name;
              if (!groups[parent]) groups[parent] = [];
              groups[parent].push(s);
            });
            return Object.entries(groups).map(([groupName, groupSessions]) => (
              <div key={groupName}>
                {groupSessions.some(s => lineMap[s.line_name]?.parent_line_name) && (
                  <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', padding: '6px 4px 2px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                    {groupName}
                  </div>
                )}
                {groupSessions.map(s => (
                  <button key={s.id} onClick={() => setSelSession(s)}
                    style={{ display: 'block', width: '100%', marginBottom: 4, padding: lineMap[s.line_name]?.parent_line_name ? '8px 10px 8px 16px' : '10px 12px',
                      borderRadius: 8, border: `2px solid ${selSession?.id === s.id ? 'var(--accent)' : 'var(--border)'}`,
                      background: selSession?.id === s.id ? 'var(--accent-dim)' : 'var(--card)', cursor: 'pointer', textAlign: 'left' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{s.line_name}</div>
                      {s.status === 'pending_close' && <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 5px', borderRadius: 10, background: 'rgba(245,158,11,0.2)', color: '#f59e0b' }}>⏳</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.shift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก'} · {fmtDate(s.work_date)}</div>
                  </button>
                ))}
              </div>
            ));
          })()}
        </div>
      )}

      <div>
        {/* Overdue alert */}
        {overdueAlert.length > 0 && (
          <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#ef4444', marginBottom: 6 }}>⚠ มีกะที่ยังไม่ปิด ({overdueAlert.length} กะ)</div>
            {overdueAlert.map(o => (
              <div key={o.id} style={{ fontSize: 12, color: 'var(--text)', marginBottom: 2 }}>
                • {o.line_name} · {o.shift === 'day' ? 'กะเช้า' : 'กะดึก'} · วันที่ {fmtDate(o.work_date)}
              </div>
            ))}
            <div style={{ fontSize: 11, color: '#ef4444', marginTop: 6 }}>กะเหล่านี้ค้างจากวันก่อน กรุณาปิด/อนุมัติให้ครบ (เริ่มกะใหม่ของวันนี้ได้ตามปกติ ไม่ต้องรอ)</div>
          </div>
        )}

        {sessions.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🏭</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>ยังไม่มีกะที่เปิดอยู่</div>
            <div style={{ fontSize: 13, marginBottom: 24 }}>เปิดกะเพื่อเริ่มบันทึกผลผลิตและ Downtime</div>
            {canOpen && (
              <button onClick={() => { const s = currentShift(); setOpenForm(f => ({ ...f, shift: s, start_time: shiftStart(s) })); setShowOpen(true); }} style={saveBtnStyle}>+ เปิดกะใหม่</button>
            )}
          </div>
        )}

        {selSession && (
          <>
            {/* Session header */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 12, padding: '16px 20px', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    {selSession.status === 'pending_close' ? (
                      <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>⏳ รออนุมัติปิดกะ</span>
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>● LIVE</span>
                    )}
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {selSession.shift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก'} · {fmtDate(selSession.work_date)} · เริ่ม {selSession.start_time}
                    </span>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{selSession.line_name}</div>
                  {selSession.dr_products?.name && (
                    <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                      🔩 {selSession.dr_products.name}
                      {selSession.dr_products.cycle_time_sec && ` · CT ${selSession.dr_products.cycle_time_sec}s`}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {/* เปิดกะใหม่ได้เสมอไม่ว่ากะที่เลือกอยู่จะสถานะไหน — กะรออนุมัติ SV (pending_close)
                      ไม่ควรบล็อกการเริ่มกะถัดไป เพราะ SV ทำงานแค่กะเช้าแต่ไลน์ผลิตทำงาน 24 ชม.
                      (handleOpenSession เช็คซ้ำเฉพาะไลน์+กะ+วันที่เดียวกันอยู่แล้ว ป้องกันเปิดทับกะเดิมจริงๆ) */}
                  {canOpen && (
                    <button onClick={() => { const s = currentShift(); setOpenForm(f => ({ ...f, shift: s, start_time: shiftStart(s) })); setShowOpen(true); }} style={saveBtnStyle}>+ เปิดกะใหม่</button>
                  )}

                  {/* pending_close — SV sees approve/reject */}
                  {selSession.status === 'pending_close' && canApproveClose && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 6, padding: '4px 10px' }}>
                        ⏳ รออนุมัติปิดกะ · ขอโดย {selSession.close_requested_by_name || '—'}
                      </div>
                      <button onClick={() => setShowApproveReview(true)}
                        style={{ ...saveBtnStyle, background: '#22c55e', fontWeight: 700 }}>
                        🔍 ตรวจสอบ & อนุมัติ
                      </button>
                      <button onClick={handleRejectClose}
                        style={{ ...cancelBtnStyle, borderColor: '#ef4444', color: '#ef4444', fontWeight: 700 }}>
                        ✕ ปฏิเสธ
                      </button>
                    </>
                  )}

                  {/* pending_close — leader sees waiting status */}
                  {selSession.status === 'pending_close' && !canApproveClose && (
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 6, padding: '4px 10px' }}>
                      ⏳ รอ SV อนุมัติปิดกะ...
                    </div>
                  )}

                  {/* open — request/direct close button */}
                  {selSession.status === 'open' && canRequestClose && (
                    <button onClick={() => { setCloseNg('0'); setCloseEndTime(guessCloseEndTime()); setCloseStartTime(selSession.start_time || ''); setDtCarryDecisions({}); setDtCloseTimes({}); setShowCloseShift(true); }}
                      style={{ ...cancelBtnStyle, borderColor: '#ef4444', color: '#ef4444', fontWeight: 700 }}>
                      {role === 'leader' ? '📋 ขอปิดกะ' : '🔒 ปิดกะ'}
                    </button>
                  )}

                  {/* closed/pending_close — SV+/leader แก้เวลาและคำนวณ OEE ใหม่ */}
                  {(canManage || role === 'leader') && ['closed', 'pending_close'].includes(selSession.status) && (
                    <button onClick={openEditTimes}
                      style={{ ...cancelBtnStyle, borderColor: '#6366f1', color: '#6366f1', fontWeight: 700 }}>
                      ✏️ แก้เวลากะ
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Per-product breakdown — กะเดียวอาจผลิตหลาย MAT.NO จึงต้องแยกสรุปรายชิ้นงาน ไม่รวมเป็นก้อนเดียว */}
            {(() => {
              const totalTarget    = prodOrders.reduce((s, o) => s + o.qty, 0);
              // ผลิตได้ = ใบที่ปิดแล้ว + ยอดสะสมของใบ manual ที่ยังเปิดอยู่ (พนักงานอัพเดททุกเบรค — ไม่นับ = เห็น 0 ทั้งกะ)
              const manualRunning  = prodOrders.filter(o => o.is_manual && o.status === 'open').reduce((s, o) => s + (o.qty_actual || 0), 0);
              const totalConfirmed = prodOrders.filter(o => o.status === 'confirmed').reduce((s, o) => s + o.qty, 0) + manualRunning;
              const pct = totalTarget > 0 ? Math.min(100, Math.round((totalConfirmed / totalTarget) * 100)) : 0;
              // ของเสีย/สงสัย ต้องเบิก input ทดแทนเพิ่มเพื่อให้ได้ยอดดีครบเป้า (ซ่อมได้ไม่ต้องเบิกใหม่)
              const totalNg = defectLogs.reduce((s, d) => s + (d.qty_ng || 0) + (d.qty_suspect || 0), 0);
              const totalInputNeeded = totalTarget + totalNg;
              const barClr = pct >= 100 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#4d9fff';

              const matNos = Array.from(new Set(prodOrders.map(o => o.mat_no))).filter(Boolean);
              const productRows = matNos.map(matNo => {
                const orders    = prodOrders.filter(o => o.mat_no === matNo);
                const orderIds  = new Set(orders.map(o => o.id));
                const target    = orders.reduce((s, o) => s + o.qty, 0);
                const confirmed = orders.filter(o => o.status === 'confirmed').reduce((s, o) => s + o.qty, 0)
                  + orders.filter(o => o.is_manual && o.status === 'open').reduce((s, o) => s + (o.qty_actual || 0), 0);
                const openCnt   = orders.filter(o => o.status === 'open').length;
                const closedCnt = orders.filter(o => o.status === 'confirmed').length;
                const ng  = defectLogs.filter(d => orderIds.has(d.prod_order_id)).reduce((s, d) => s + (d.qty_ng || 0) + (d.qty_suspect || 0), 0);
                const dt  = dtLogs.filter(d => d.mat_no === matNo).reduce((s, d) => s + (d.duration_min || 0), 0);
                const ct  = ctForMatNo(matNo);
                const name = kanbanStds.find(s => s.mat_no === matNo)?.dr_products?.name || '';
                const rowPct = target > 0 ? Math.min(100, Math.round((confirmed / target) * 100)) : 0;
                // เวลาทำงานจริงของพาร์ทนี้ — บางพาร์ทในไลน์เดียวกันอาจเริ่ม/เลิกต่างกัน
                // เช่น คนเข้า OT มาช่วยพาร์ทหนึ่งตั้งแต่ 20:00 แต่อีกพาร์ทเริ่มตามกำลังคนปกติ 22:30
                const openedTimes = orders.map(o => o.opened_at).filter(Boolean).map(t => new Date(t).getTime());
                const closedTimes = orders.filter(o => o.status === 'confirmed' && o.confirmed_at).map(o => new Date(o.confirmed_at).getTime());
                const actualStart = openedTimes.length ? new Date(Math.min(...openedTimes)) : null;
                const actualEnd   = closedTimes.length ? new Date(Math.max(...closedTimes)) : null;
                return { matNo, name, target, confirmed, openCnt, closedCnt, ng, dt, ct, rowPct, actualStart, actualEnd };
              }).sort((a, b) => b.target - a.target);

              const unassignedDT = dtLogs.filter(d => !d.mat_no).reduce((s, d) => s + (d.duration_min || 0), 0);

              return (
                <>
                  {productRows.length > 0 && (() => {
                    const matOpen = !liveCollapsed('mat_breakdown');
                    return (
                    <div style={{ marginBottom: 16 }}>
                      <div onClick={() => toggleLiveCollapse('mat_breakdown')}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: matOpen ? 8 : 0, cursor: 'pointer', userSelect: 'none' }}>
                        <span style={{ fontSize: 11, color: 'var(--muted)', transform: matOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>▶</span>
                        🔩 แยกตามชิ้นงาน ({productRows.length} MAT.NO)
                      </div>
                      {matOpen && (<>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {productRows.map(r => {
                          const rowClr = r.rowPct >= 100 ? '#22c55e' : r.rowPct >= 60 ? '#f59e0b' : '#4d9fff';
                          return (
                            <div key={r.matNo} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>{r.matNo}</span>
                                  {r.name && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{r.name}</span>}
                                  {r.ct > 0 && <span style={{ fontSize: 11, color: 'var(--muted)' }}>· CT {r.ct}s</span>}
                                  {r.actualStart && (
                                    <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: 'rgba(77,159,255,0.12)', color: '#4d9fff', fontWeight: 700 }}>
                                      🕐 {fmtTime(r.actualStart)}–{r.actualEnd ? fmtTime(r.actualEnd) : '...'}
                                    </span>
                                  )}
                                  <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', fontWeight: 700 }}>เปิด {r.openCnt}</span>
                                  <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: 'rgba(34,197,94,0.12)', color: '#22c55e', fontWeight: 700 }}>ปิด {r.closedCnt}</span>
                                  {r.ng > 0 && <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontWeight: 700 }}>🔴 NG {r.ng}</span>}
                                  {r.dt > 0 && <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: 'rgba(168,85,247,0.12)', color: '#a855f7', fontWeight: 700 }}>⏱ {fmtMin(r.dt)}</span>}
                                </div>
                                <span style={{ fontSize: 13, fontWeight: 800, color: rowClr }}>{r.confirmed} / {r.target} ชิ้น ({r.rowPct}%)</span>
                              </div>
                              <div style={{ height: 7, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${r.rowPct}%`, background: rowClr, borderRadius: 99, transition: 'width 0.5s ease' }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {unassignedDT > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>⏱ Downtime ที่ไม่ระบุชิ้นงาน: {fmtMin(unassignedDT)}</div>
                      )}
                      </>)}
                    </div>
                    );
                  })()}

                  {/* ภาพรวมทั้งกะ (รวมทุกชิ้นงาน) */}
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>📊 ภาพรวมทั้งกะ</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 12, marginBottom: 16 }}>
                    {[
                      { label: 'เปิด Order', value: prodOrders.filter(o => o.status === 'open').length, unit: 'ใบ', color: '#f59e0b' },
                      { label: 'ปิดแล้ว',   value: prodOrders.filter(o => o.status === 'confirmed').length, unit: 'ใบ', color: '#22c55e' },
                      { label: 'เป้ารวม',   value: totalTarget,    unit: 'ชิ้น', color: '#4d9fff' },
                      { label: 'ผลิตได้',   value: totalConfirmed, unit: 'ชิ้น', color: '#22c55e' },
                      { label: 'Input ต้องเบิก', value: totalInputNeeded, unit: totalNg > 0 ? `ชิ้น (รวม NG ${totalNg})` : 'ชิ้น', color: '#f59e0b' },
                      { label: 'Downtime',  value: fmtMin(totalDT), unit: '',    color: '#a855f7', small: true },
                      { label: 'นอกแผน',   value: fmtMin(unplannedDT), unit: '', color: '#ef4444', small: true },
                    ].map(k => (
                      <div key={k.label} style={{ background: 'var(--card)', border: `1px solid ${k.color}25`, borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>{k.label}</div>
                        <div style={{ fontSize: k.small ? 13 : 22, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value ?? 0}</div>
                        {k.unit && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{k.unit}</div>}
                      </div>
                    ))}
                    {/* Overall progress bar */}
                    {prodOrders.length > 0 && (
                      <div style={{ gridColumn: '1/-1', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
                          <span style={{ color: 'var(--muted)' }}>ความคืบหน้ากะนี้ (รวมทุกชิ้นงาน)</span>
                          <span style={{ fontWeight: 800, color: barClr }}>{totalConfirmed} / {totalTarget} ชิ้น ({pct}%)</span>
                        </div>
                        <div style={{ height: 10, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: barClr, borderRadius: 99, transition: 'width 0.5s ease' }} />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}

            {/* Prod Orders panel */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: prodOrdersOpen ? 12 : 0, flexWrap: 'wrap', gap: 8 }}>
                <div onClick={() => toggleLiveCollapse('prod_orders')} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--text)', cursor: 'pointer', userSelect: 'none' }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', transform: prodOrdersOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>▶</span>
                  📦 Prod Orders ({prodOrders.length} ใบ)
                </div>
                {canScan && prodOrdersOpen && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => { setShowScanOpen(true); setOpenProdForm({ prod_no: '', mat_no: '', qty: '' }); setOpenProdStd(null); }}
                      style={{ background: '#f59e0b', color: '#000', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                      📥 Scan เปิด Order
                    </button>
                    <button onClick={() => { setShowManualOpen(true); setManualForm({ mat_no: '', qty: '' }); }}
                      title="ไลน์ที่ไม่มี kanban card / SAP ไม่ gen barcode — เปิดเป้าเองแล้วอัพเดทยอดสะสม"
                      style={{ background: 'rgba(96,165,250,0.15)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.5)', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                      ✍️ เปิดเป้า (ไม่มีบาร์โค้ด)
                    </button>
                    <button onClick={() => { setShowScanClose(true); setCloseProdNo(''); setCloseMatch(null); }}
                      style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                      📤 Scan ปิด / Confirm
                    </button>
                    <button onClick={() => {
                      const activeMatNos = Array.from(new Set(prodOrders.filter(o => o.status === 'open').map(o => o.mat_no))).filter(Boolean);
                      setShowDefect(true);
                      setDefectForm({ id: null, mat_no: activeMatNos.length === 1 ? activeMatNos[0] : '', defect_type_id: '', qty_ng: '0', qty_suspect: '0', qty_repair: '0', description: '' });
                    }}
                      style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                      🔴 บันทึกงานเสีย
                    </button>
                  </div>
                )}
              </div>

              {prodOrdersOpen && (<>
              {/* Carry-over banner */}
              {carryOrders.length > 0 && canScan && (
                <div style={{ marginBottom: 10, padding: '10px 14px', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.4)', borderRadius: 9 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa' }}>➡ มียอดค้างจากกะก่อน {carryOrders.length} Order (เหลือ {carryOrders.reduce((s,o) => s + Math.max(0, o.qty - (o.qty_actual || 0)), 0)} ชิ้น)</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{carryOrders.map(o => o.prod_no).join(', ')}</div>
                    </div>
                    <button onClick={handleImportCarryOrders}
                      style={{ background: '#a78bfa', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      📥 รับยอดต่อ
                    </button>
                  </div>
                </div>
              )}

              {prodOrders.length === 0 && carryOrders.length === 0 && (
                <div style={{ textAlign: 'center', padding: '24px 16px', color: 'var(--muted)', fontSize: 13 }}>
                  ยังไม่มี Prod Order — กด <b>📥 Scan เปิด Order</b> เพื่อเริ่มสแกน Tag Card
                </div>
              )}

              {(() => {
                const renderOrderRow = (o) => {
                  const confirmed   = o.status === 'confirmed';
                  const carryOver   = o.status === 'carry_over';
                  const cancelled   = o.status === 'cancelled';
                  const isCarried   = !!o.carry_over_from_session_id;
                  const isManual    = !!o.is_manual;
                  const manualOpen  = isManual && o.status === 'open';
                  // ใบ manual ที่ไม่ถูกอัพเดทยอดนาน (> 2 ชม.ครึ่ง = เลยรอบเบรคไปแล้ว) เตือนเหลืองนิ่ง
                  const lastUpd     = manualOpen ? new Date(o.qty_updated_at || o.opened_at) : null;
                  const manualStale = manualOpen && (Date.now() - lastUpd.getTime()) > 150 * 60000;
                  const statusColor = confirmed ? '#22c55e' : carryOver ? '#a78bfa' : cancelled ? '#666' : '#f59e0b';
                  const statusLabel = confirmed ? '✓ ปิดแล้ว' : carryOver ? '➡ ยกยอด' : cancelled ? '✕ ยกเลิก' : '● ผลิต';
                  return (
                    <div key={o.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '9px 14px', background: 'var(--bg2)', borderRadius: 8,
                      border: `1px solid ${manualStale ? '#f59e0b' : `${statusColor}40`}`, borderLeft: `4px solid ${statusColor}`,
                      boxShadow: manualStale ? '0 0 8px 1px rgba(245,158,11,0.4)' : 'none',
                      opacity: cancelled ? 0.45 : 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>{o.prod_no}</span>
                          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{o.mat_no}</span>
                          {o.part_name && <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {o.part_name}</span>}
                          {o.customer && <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: 'rgba(59,130,246,0.12)', color: '#60a5fa', fontWeight: 700 }}>{o.customer}</span>}
                          {isManual && (
                            <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: 'rgba(96,165,250,0.15)', color: '#60a5fa', fontWeight: 700 }}
                              title="ออเดอร์ manual — ไลน์ไม่มี kanban card เปิดเป้าเองไม่ได้สแกน">
                              ✍️ manual
                            </span>
                          )}
                          {isCarried && (
                            <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: 'rgba(167,139,250,0.15)', color: '#a78bfa', fontWeight: 700 }}
                              title={o.carry_over_note || 'ยกยอดมาจากกะก่อน'}>
                              ➡ ยกยอดมา {o.carry_over_note ? `(${o.carry_over_note.match(/\d+\/\d+/)?.[0] || ''})` : ''}
                            </span>
                          )}
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 700, background: `${statusColor}20`, color: statusColor }}>
                            {statusLabel}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          เปิด {fmtTime(new Date(o.opened_at))} {o.opened_by && `· ${o.opened_by}`}
                          {confirmed && o.confirmed_at && ` · ปิด ${fmtTime(new Date(o.confirmed_at))} · ${o.confirmed_by}`}
                          {manualOpen && ` · อัพเดทยอดล่าสุด ${fmtTime(lastUpd)}`}
                          {manualStale && <span style={{ color: '#f59e0b', fontWeight: 700 }}> ⚠ เกิน 2.5 ชม.แล้ว — อัพเดทยอดด้วย</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        {manualOpen ? (
                          <>
                            <div style={{ fontSize: 18, fontWeight: 900, color: statusColor, lineHeight: 1 }}>
                              {o.qty_actual || 0}<span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>/{o.qty_target ?? o.qty}</span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>ทำได้/เป้า</div>
                          </>
                        ) : (
                          <>
                            <div style={{ fontSize: 20, fontWeight: 900, color: statusColor, lineHeight: 1 }}>{o.qty}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>ชิ้น{isManual && (o.qty_target ?? null) !== null ? ` (เป้า ${o.qty_target})` : ''}</div>
                          </>
                        )}
                      </div>
                      {/* ออเดอร์ที่ confirmed ห้ามลบเด็ดขาด (เป็นยอดผลิตจริงที่ปิดแล้ว) — ส่วนออเดอร์ที่ยกยอด (carry_over)
                          ปกติ leader แก้ไม่ได้แล้วเพราะตัดสินใจไปแล้วตอนปิดกะ แต่ถ้าตกค้างผิดปกติ (เช่นกะเก่าปิดไม่สำเร็จ)
                          SV/Manager/Admin ต้องลบแก้ไขได้เพื่อเคลียร์ข้อมูลค้าง ไม่งั้นจะไม่มีทางแก้เลย */}
                      {!confirmed && (canManage || (canEditRecords && !carryOver)) && (
                        <button onClick={() => handleDeleteProdOrder(o.id)}
                          style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}>✕</button>
                      )}
                      </div>
                      {/* ประวัติยอดต่อช่วง — 10:00 กรอก 200 = ช่วงแรก 200 · 12:00 กรอก 480 = +280 */}
                      {isManual && (qtyUpdatesByOrder[o.id]?.length > 0) && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
                          {qtyUpdatesByOrder[o.id].map((u, ui) => (
                            <span key={ui} title={`ยอดสะสม ${u.qty_accum} ชิ้น · ${u.logged_by || ''}`} style={{
                              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                              background: u.is_final ? 'rgba(34,197,94,0.13)' : 'rgba(96,165,250,0.12)',
                              color: u.is_final ? '#22c55e' : '#60a5fa',
                              border: `1px solid ${u.is_final ? 'rgba(34,197,94,0.4)' : 'rgba(96,165,250,0.35)'}`,
                            }}>
                              {u.is_final ? '✓ ' : ''}{fmtTime(new Date(u.logged_at))} · สะสม {u.qty_accum}
                              <span style={{ opacity: 0.75 }}> ({u.qty_delta >= 0 ? '+' : ''}{u.qty_delta})</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {/* แถวอัพเดทยอดสะสมของใบ manual — พนักงานกรอกทุกช่วงเบรคตาม break policy */}
                      {manualOpen && canScan && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>ยอดสะสมตอนนี้:</span>
                          {/* width กัน index.css input{width:100%} ดันปุ่มแตกแถว (กับดัก CSS ใน CLAUDE.md) */}
                          <input type="number" min={0} inputMode="numeric" value={manualQtyDraft[o.id] ?? ''}
                            placeholder={`${o.qty_actual || 0}`}
                            onChange={e => setManualQtyDraft(d => ({ ...d, [o.id]: e.target.value }))}
                            style={{ width: 100, padding: '6px 10px', fontSize: 13, fontWeight: 700, borderRadius: 7, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
                          <button onClick={() => handleManualQtyUpdate(o)}
                            style={{ background: '#60a5fa', color: '#08131f', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                            💾 อัพเดทยอด
                          </button>
                          <button onClick={() => handleManualClose(o)}
                            style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.5)', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                            ✓ ปิดใบนี้ (ยอดจริง)
                          </button>
                        </div>
                      )}
                    </div>
                  );
                };

                const activeOrders = prodOrders.filter(o => o.status === 'open');
                const closedOrders = prodOrders.filter(o => o.status !== 'open');

                return (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {activeOrders.map(renderOrderRow)}
                    </div>

                    {closedOrders.length > 0 && (
                      <div style={{ marginTop: activeOrders.length > 0 ? 10 : 0 }}>
                        <div onClick={() => setShowClosedOrders(s => !s)}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 4px', cursor: 'pointer', userSelect: 'none', fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>
                          <span style={{ fontSize: 11, transform: showClosedOrders ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>▶</span>
                          ปิดแล้ว / ยกเลิก ({closedOrders.length} ใบ)
                        </div>
                        {showClosedOrders && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {closedOrders.map(renderOrderRow)}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
              </>)}
            </div>

            {/* Defect Logs panel */}
            {defectLogs.length > 0 && (() => {
              const defOpen = !liveCollapsed('defects');
              return (
              <div style={{ background: 'var(--card)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: defOpen ? 10 : 0 }}>
                  <div onClick={() => toggleLiveCollapse('defects')} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#ef4444', cursor: 'pointer', userSelect: 'none' }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)', transform: defOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>▶</span>
                    🔴 บันทึกงานเสีย ({defectLogs.length} รายการ)
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>
                      NG: {defectLogs.reduce((s,d)=>s+(d.qty_ng||0),0)} · สงสัย: {defectLogs.reduce((s,d)=>s+(d.qty_suspect||0),0)} · ซ่อม: {defectLogs.reduce((s,d)=>s+(d.qty_repair||0),0)}
                    </span>
                  </div>
                </div>
                {defOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {defectLogs.map(d => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg2)', borderRadius: 8, borderLeft: `3px solid ${d.dr_defect_types?.color || '#ef4444'}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{d.dr_defect_types?.name_th || '—'}</span>
                          {d.prod_orders?.mat_no && (
                            <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: 'rgba(14,165,233,0.15)', color: '#0ea5e9', fontWeight: 700, fontFamily: 'monospace' }}>
                              {d.prod_orders.mat_no}
                            </span>
                          )}
                          {d.prod_orders?.prod_no && (
                            <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: 'rgba(74,222,128,0.1)', color: '#22c55e', fontWeight: 700, fontFamily: 'monospace' }}>
                              {d.prod_orders.prod_no}
                            </span>
                          )}
                          {d.qty_ng     > 0 && <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 700 }}>NG {d.qty_ng}</span>}
                          {d.qty_suspect > 0 && <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>สงสัย {d.qty_suspect}</span>}
                          {d.qty_repair  > 0 && <span style={{ fontSize: 11, color: '#a78bfa', fontWeight: 700 }}>ซ่อม {d.qty_repair}</span>}
                        </div>
                        {d.description && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{d.description}</div>}
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                          {fmtTime(new Date(d.logged_at))}
                          {d.reported_by_name && ` · ${d.reported_by_name}`}
                        </div>
                      </div>
                      {canEditRecords && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => { setDefectForm({ id: d.id, mat_no: d.prod_orders?.mat_no || '', defect_type_id: d.defect_type_id || '', qty_ng: String(d.qty_ng||0), qty_suspect: String(d.qty_suspect||0), qty_repair: String(d.qty_repair||0), description: d.description || '' }); setShowDefect(true); }}
                            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, padding: '0 4px' }}>✎</button>
                          <button onClick={() => handleDeleteDefectLog(d.id)}
                            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}>✕</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                )}
              </div>
              );
            })()}

            {/* Downtime list */}
            {(() => {
              const dtOpen = !liveCollapsed('downtime', dtLogs.length === 0);
              return (
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: dtOpen ? 12 : 0, flexWrap: 'wrap', gap: 8 }}>
                <div onClick={() => toggleLiveCollapse('downtime', dtLogs.length === 0)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--text)', cursor: 'pointer', userSelect: 'none' }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', transform: dtOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>▶</span>
                  ⏱ Downtime ({dtLogs.length} รายการ)
                </div>
                {dtOpen && (
                <button onClick={() => { setShowDT(true); setDtForm({ id: null, downtime_type_id: '', mode: 'start_end', start_time: '', end_time: '', duration_min: '', machine_no: '', mat_no: '', description: '' }); }}
                  style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  + บันทึก Downtime
                </button>
                )}
              </div>
              {dtOpen && (<>
              {dtLogs.length === 0 && <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มี Downtime ในกะนี้</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {dtLogs.map(d => {
                  const cat = CAT_META[d.dr_downtime_types?.category] || CAT_META.unplanned;
                  return (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--bg2)', borderRadius: 8, borderLeft: `3px solid ${d.dr_downtime_types?.color || '#aaa'}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: cat.bg, color: cat.color }}>{cat.label}</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{d.dr_downtime_types?.name_th || '—'}</span>
                          {d.machine_no && <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {d.machine_no}</span>}
                          {d.mat_no && <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: 'rgba(14,165,233,0.15)', color: '#0ea5e9' }}>{d.mat_no}</span>}
                          {d.carry_over && <span title="เครื่องยังซ่อมไม่เสร็จตอนปิดกะ — เปิดต่อในกะถัดไปอัตโนมัติ" style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>🔁 ยกข้ามกะ</span>}
                          {d.carried_from_id && <span title="รายการต่อเนื่องจาก Downtime ที่ตัดยอดมาจากกะก่อน" style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>⏩ ต่อจากกะก่อน</span>}
                        </div>
                        {d.description && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{d.description}</div>}
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          {fmtTime(new Date(d.started_at))}
                          {d.ended_at && ` – ${fmtTime(new Date(d.ended_at))}`}
                          {d.reported_by_name && ` · ${d.reported_by_name}`}
                        </div>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: d.dr_downtime_types?.color || '#aaa', minWidth: 64, textAlign: 'right' }}>
                        {fmtMin(d.duration_min)}
                      </div>
                      {/* เรียกช่าง MTN — เฉพาะรายการที่ยังเปิดค้าง (เครื่องยังหยุดอยู่) */}
                      {canScan && d.duration_min == null && !d.ended_at && (
                        d.call_mtn
                          ? <span title={`เรียกช่างแล้ว${d.call_mtn_by ? ` โดย ${d.call_mtn_by}` : ''}`} style={{ fontSize: 11, fontWeight: 700, color: '#22c55e', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: 20, padding: '3px 9px', whiteSpace: 'nowrap' }}>📞 เรียกช่างแล้ว</span>
                          : <button onClick={() => handleCallMtn(d)} title="แจ้งช่าง MTN ให้เข้าหน้างานทันที" style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: '#e05c4a', border: 'none', borderRadius: 20, padding: '4px 11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>📞 เรียกช่าง</button>
                      )}
                      {canEditRecords && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => {
                            const sAt = d.started_at ? new Date(d.started_at) : null;
                            const eAt = d.ended_at ? new Date(d.ended_at) : null;
                            setDtForm({
                              id: d.id,
                              downtime_type_id: d.downtime_type_id || '',
                              mode: 'start_end',
                              start_time: sAt ? sAt.toTimeString().slice(0,5) : '',
                              end_time:   eAt ? eAt.toTimeString().slice(0,5) : '',
                              duration_min: d.duration_min != null ? String(d.duration_min) : '',
                              machine_no: d.machine_no || '',
                              mat_no:     d.mat_no || '',
                              description: d.description || '',
                            });
                            setShowDT(true);
                          }}
                            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, padding: '0 4px' }}>✎</button>
                          <button onClick={() => handleDeleteDT(d.id)}
                            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}>✕</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              </>)}
            </div>
              );
            })()}
          </>
        )}

        {/* Open session modal */}
        {showOpen && (
          <div className="overlay" style={{ zIndex: 2000 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(95vw,480px)' }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 20, color: 'var(--text)' }}>🏭 เปิดกะผลิตใหม่</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label="วันที่ผลิต">
                  <input type="date" value={openForm.work_date} onChange={e => setOpenForm(f => ({ ...f, work_date: e.target.value }))} style={inputStyle} />
                </Field>
                <Field label="ไลน์การผลิต">
                  <select value={openForm.line_name} onChange={e => setOpenForm(f => ({ ...f, line_name: e.target.value }))} style={inputStyle}>
                    <option value="">เลือกไลน์...</option>
                    {lines.filter(l => !l.parent_line_name && !parentChildrenMap[l.name]).map(l => (
                      <option key={l.id} value={l.name}>{l.name}</option>
                    ))}
                    {Object.entries(parentChildrenMap).map(([parent, children]) => (
                      <optgroup key={parent} label={`▸ ${parent}`}>
                        {children.map(cn => {
                          const cl = lines.find(l => l.name === cn);
                          return cl ? <option key={cl.id} value={cl.name}>{cl.name}</option> : null;
                        })}
                      </optgroup>
                    ))}
                  </select>
                </Field>
                <Field label="กะทำงาน">
                  <select value={openForm.shift} onChange={e => setOpenForm(f => ({ ...f, shift: e.target.value, start_time: shiftStart(e.target.value) }))} style={inputStyle}>
                    <option value="day">☀️ กะเช้า (08:00–20:00)</option>
                    <option value="night">🌙 กะดึก (20:00–08:00)</option>
                  </select>
                </Field>

                <Field label="เวลาเริ่มต้น">
                  <TimeInput24 value={openForm.start_time} onChange={e => setOpenForm(f => ({ ...f, start_time: e.target.value }))} style={{ fontSize: 16 }} />
                </Field>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowOpen(false)} style={cancelBtnStyle}>ยกเลิก</button>
                <button onClick={handleOpenSession} disabled={!openForm.line_name}
                  style={{ ...saveBtnStyle, opacity: !openForm.line_name ? 0.5 : 1 }}>เปิดกะ</button>
              </div>
            </div>
          </div>
        )}

        {/* ── CLOSE SHIFT / OEE modal ─────────────────────────── */}
        {/* SV review-before-approve — show exactly what the leader submitted before deciding */}
        {showApproveReview && selSession && (() => {
          const oeeColor = selSession.oee == null ? 'var(--muted)' : selSession.oee >= 85 ? '#22c55e' : selSession.oee >= 65 ? '#f59e0b' : '#ef4444';
          const confirmedOrders  = prodOrders.filter(o => o.status === 'confirmed');
          const carryOrdersList  = prodOrders.filter(o => o.status === 'carry_over');
          const cancelledOrders  = prodOrders.filter(o => o.status === 'cancelled');
          // จอ landscape กว้าง → แผ่เนื้อหาเป็น 2 คอลัมน์แทนการยืดสูงจน scroll (layout อย่างเดียว ไม่แตะ logic)
          const twoCol = typeof window !== 'undefined' && window.innerWidth >= 1100 && (defectLogs.length > 0 || dtLogs.length > 0) && prodOrders.length > 0;
          return (
            <div className="overlay" style={{ zIndex: 2100 }}>
              <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '2px solid rgba(245,158,11,0.5)', borderRadius: 14, padding: 24, width: 'min(96vw,1500px)', maxHeight: '94vh', overflowY: 'auto' }}>
                <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4, color: '#f59e0b' }}>🔍 ตรวจสอบคำขอปิดกะ</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
                  {selSession.line_name} · {selSession.shift === 'day' ? 'กะเช้า' : 'กะดึก'} · {fmtDate(selSession.work_date)}
                </div>

                <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b' }}>📋 ขอโดย {selSession.close_requested_by_name || '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    เวลาที่ขอ: {selSession.close_requested_at ? fmtDateTime(selSession.close_requested_at) : '—'} · เริ่มกะ {selSession.start_time} · ปิดกะ {selSession.end_time}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(90px,1fr))', gap: 10, marginBottom: 14 }}>
                  {[
                    { label: 'เวลากะ',   value: fmtMin(selSession.shift_min),            color: 'var(--text)' },
                    { label: 'ผลิตได้',  value: `${selSession.actual_qty ?? 0} ชิ้น`,     color: '#22c55e' },
                    { label: 'ดี',       value: `${selSession.qty_ok ?? 0} ชิ้น`,         color: '#22c55e' },
                    { label: 'NG',       value: `${selSession.qty_ng ?? 0} ชิ้น`,         color: '#ef4444' },
                    { label: 'สงสัย',    value: `${selSession.qty_suspect ?? 0} ชิ้น`,    color: '#f59e0b' },
                    { label: 'ซ่อม',     value: `${selSession.qty_repair ?? 0} ชิ้น`,     color: '#a78bfa' },
                    { label: 'OEE',      value: selSession.oee != null ? `${selSession.oee}%` : 'N/A', color: oeeColor },
                  ].map(k => (
                    <div key={k.label} style={{ background: 'var(--bg2)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>{k.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.value}</div>
                    </div>
                  ))}
                </div>

                {/* จอกว้าง: งานเสีย+Downtime คอลัมน์ซ้าย · สรุปแยกตามชิ้นงาน คอลัมน์ขวา — จอแคบเรียงลงเหมือนเดิม */}
                <div style={{ display: 'grid', gridTemplateColumns: twoCol ? '1fr 1fr' : '1fr', gap: twoCol ? 14 : 0, alignItems: 'start' }}>
                <div style={{ minWidth: 0 }}>
                {defectLogs.length > 0 && (
                  <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>🔴 รายการงานเสีย ({defectLogs.length})</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {defectLogs.map(d => (
                        <div key={d.id} style={{ fontSize: 12, color: 'var(--text2)' }}>
                          • {d.dr_defect_types?.name_th || 'ไม่ระบุชนิด'} — NG {d.qty_ng || 0} / สงสัย {d.qty_suspect || 0} / ซ่อม {d.qty_repair || 0}
                          {d.description && <span style={{ color: 'var(--muted)' }}> ({d.description})</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {dtLogs.length > 0 && (
                  <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>⏱ Downtime ({dtLogs.length} รายการ, รวม {fmtMin(totalDT)})</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {dtLogs.map(d => (
                        <div key={d.id} style={{ fontSize: 12, color: 'var(--text2)' }}>
                          • {d.dr_downtime_types?.name_th || 'ไม่ระบุสาเหตุ'} — {fmtMin(d.duration_min || 0)}
                          {d.description && <span style={{ color: 'var(--muted)' }}> ({d.description})</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                </div>{/* /คอลัมน์ซ้าย */}
                <div style={{ minWidth: 0 }}>
                {/* Per-product breakdown — เหมือนหน้าที่ leader เห็นตอนขอปิดกะ ใช้ end_time ของกะที่บันทึกไว้แล้ว (ไม่มี order สถานะ open เหลือแล้วตอนนี้) */}
                {(() => {
                  const matNos = Array.from(new Set(prodOrders.map(o => o.mat_no)));
                  if (!matNos.length) return null;
                  const rows = matNos.map(matNo => {
                    const orders = prodOrders.filter(o => o.mat_no === matNo);
                    const target = orders.reduce((s, o) => s + o.qty, 0);
                    // นับยอด confirmed เต็มเป้า + qty_actual ของ carry_over/cancelled (กรอกเองโดย leader ตอนปิดกะ)
                    // ให้ตรงกับยอดรวม selSession.actual_qty ด้านบน ไม่งั้นจะเห็นเป็น 0 ทั้งที่ความจริงผลิตไปแล้ว
                    const qty = orders.reduce((s, o) => s + (o.status === 'confirmed' ? o.qty : (o.qty_actual || 0)), 0);
                    const orderIds = new Set(orders.map(o => o.id));
                    const ng = defectLogs.filter(d => orderIds.has(d.prod_order_id)).reduce((s, d) => s + (d.qty_ng || 0) + (d.qty_suspect || 0), 0);
                    const dt = dtLogs.filter(d => d.mat_no === matNo).reduce((s, d) => s + (d.duration_min || 0), 0);
                    const openedTimes = orders.map(o => o.opened_at).filter(Boolean).map(t => new Date(t).getTime());
                    // เวลาปิดของ order — confirmed ใช้ confirmed_at, ยกยอด/ยกเลิกใช้ stopped_at ที่กรอกไว้ตอนปิดกะ (แยกตามพาร์ทได้)
                    const closedTimes = orders.filter(o => (o.status === 'confirmed' && o.confirmed_at) || ((o.status === 'carry_over' || o.status === 'cancelled') && o.stopped_at))
                      .map(o => new Date(o.confirmed_at || o.stopped_at).getTime());
                    const actualStart = openedTimes.length ? new Date(Math.min(...openedTimes)) : null;
                    const actualEnd   = closedTimes.length ? new Date(Math.max(...closedTimes)) : null;
                    const ctSec = ctForMatNo(matNo);
                    const winEndMs = actualEnd ? actualEnd.getTime() : (selSession.end_time && selSession?.work_date ? (() => {
                      let e = new Date(`${selSession.work_date}T${selSession.end_time.slice(0,5)}:00`).getTime();
                      if (actualStart && e < actualStart.getTime()) e += 86400000;
                      return e;
                    })() : null);
                    // หักเวลา Downtime ที่ทับซ้อนช่วงวิ่งของ MAT.NO นี้ออกก่อน ไม่งั้น "ควรได้" จะคิดจากเวลาทั้งหมด
                    // (รวมเวลาหยุด) ทำให้ %P ต่ำเกินจริง และไม่ตรงกับ P รวมที่คำนวณใน computeOEE()
                    const winMin = (actualStart && winEndMs) ? Math.max(0, (winEndMs - actualStart.getTime()) / 60000 - dtOverlapMin(actualStart.getTime(), winEndMs)) : null;
                    const achievable = (ctSec > 0 && winMin != null) ? Math.floor(winMin * 60 / ctSec) : null;
                    // ผลิตได้จริง > ควรได้ (ตาม CT ที่ตั้งไว้) แปลว่า CT ใน Product Master ตั้งไว้ช้ากว่าความเป็นจริง
                    // ย้อนคำนวณ CT จริงที่สังเกตได้จากกะนี้ไว้เตือน ไม่ใช่ปล่อยให้ %P ติดเพดาน 100% เฉยๆ
                    const observedCtSec = (winMin != null && winMin > 0 && qty > 0) ? (winMin * 60 / qty) : null;
                    const overCt = ctSec > 0 && achievable != null && qty > achievable;
                    return { matNo, partName: orders[0]?.part_name, target, qty, ng, dt, actualStart, actualEnd, achievable, ctSec, observedCtSec, overCt };
                  }).sort((a, b) => b.qty - a.qty);
                  const dtNoMat = dtLogs.filter(d => !d.mat_no).reduce((s, d) => s + (d.duration_min || 0), 0);
                  return (
                    <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>📦 สรุปแยกตามชิ้นงาน ({rows.length} MAT.NO) — เป้าหมาย vs ควรได้ (เต็มเวลา) vs ผลิตได้จริง</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 6 }}>
                        {rows.map(r => {
                          const overage = ctOverage[r.matNo];
                          return (
                          <div key={r.matNo} style={{ padding: '8px 10px', background: 'var(--bg)', borderRadius: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: '#0ea5e9' }}>{r.matNo}</div>
                                {r.partName && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.partName}</div>}
                                {r.actualStart && (
                                  <div style={{ fontSize: 11, color: '#4d9fff', marginTop: 1 }}>🕐 {fmtTime(r.actualStart)}–{r.actualEnd ? fmtTime(r.actualEnd) : '...'}</div>
                                )}
                              </div>
                              <div style={{ textAlign: 'center', minWidth: 40 }}>
                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>NG</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: r.ng > 0 ? '#ef4444' : 'var(--muted)' }}>{r.ng}</div>
                              </div>
                              <div style={{ textAlign: 'center', minWidth: 60 }}>
                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Downtime</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: r.dt > 0 ? '#f59e0b' : 'var(--muted)' }}>{fmtMin(Math.round(r.dt))}</div>
                              </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
                              <div style={{ textAlign: 'center', padding: '4px 0', background: 'var(--bg2)', borderRadius: 6 }}>
                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>เป้าหมาย</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{r.target}</div>
                              </div>
                              <div style={{ textAlign: 'center', padding: '4px 0', background: 'rgba(168,85,247,0.1)', borderRadius: 6 }}>
                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>ควรได้ (เต็มเวลา)</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: '#a78bfa' }}>{r.achievable != null ? r.achievable : '—'}</div>
                              </div>
                              <div style={{ textAlign: 'center', padding: '4px 0', background: 'rgba(34,197,94,0.1)', borderRadius: 6 }}>
                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>ผลิตได้จริง</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: '#22c55e' }}>{r.qty}</div>
                              </div>
                            </div>
                            {r.achievable > 0 && (
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, textAlign: 'right' }}>
                                %P พาร์ทนี้ ≈ {Math.min(100, Math.round(r.qty / r.achievable * 100))}%
                              </div>
                            )}
                            {r.overCt && r.observedCtSec != null && (
                              <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4, padding: '4px 6px', background: 'rgba(245,158,11,0.1)', borderRadius: 6 }}>
                                ⚠ ผลิตเกิน CT ที่ตั้งไว้ ({r.ctSec} วิ) — CT จริงที่สังเกตได้กะนี้ ≈ {r.observedCtSec.toFixed(1)} วิ/ชิ้น
                              </div>
                            )}
                            {overage && overage.overCount >= 3 && (
                              <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4, padding: '4px 6px', background: 'rgba(239,68,68,0.1)', borderRadius: 6, fontWeight: 700 }}>
                                🔁 เกิน CT ซ้ำ {overage.overCount}/{overage.checked} กะล่าสุด — แนะนำปรับ CT ใน Product Master เป็น ~{overage.avgObservedCt?.toFixed(1)} วิ/ชิ้น
                              </div>
                            )}
                          </div>
                          );
                        })}
                      </div>
                      {dtNoMat > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                          + Downtime ไม่ได้ระบุชิ้นงาน (ทั้งไลน์): {fmtMin(Math.round(dtNoMat))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                </div>{/* /คอลัมน์ขวา */}
                </div>{/* /grid 2 คอลัมน์ */}

                {/* Timeline: machine run / policy break / planned-unplanned downtime — รายละเอียดของ %A, ใช้เวลาเริ่ม-ปิดกะที่บันทึกไว้แล้ว (full-width) */}
                {(() => {
                  if (!selSession?.work_date || !selSession.start_time) return null;
                  const winStart = new Date(`${selSession.work_date}T${selSession.start_time.slice(0,5)}:00`).getTime();
                  const endTimeStr = selSession.end_time || nowTime();
                  let winEnd = new Date(`${selSession.work_date}T${endTimeStr.slice(0,5)}:00`).getTime();
                  if (winEnd <= winStart) winEnd += 86400000; // กะดึกข้ามวัน
                  if (winEnd <= winStart) return null;

                  const sessionShift = selSession.shift || 'day';
                  const processType = sessionProcessType();
                  const blocks = [];
                  breakPolicies
                    .filter(p => (p.shift === 'both' || p.shift === sessionShift) && (p.process_type === 'common' || p.process_type === processType))
                    .forEach(p => {
                      const [ph, pm] = (p.start_time || '00:00').split(':').map(Number);
                      let pStart = new Date(`${selSession.work_date}T${String(ph).padStart(2,'0')}:${String(pm).padStart(2,'0')}:00`).getTime();
                      let pEnd = pStart + (p.duration_min || 0) * 60000;
                      if (pEnd < winStart) { pStart += 86400000; pEnd += 86400000; }
                      const s = Math.max(pStart, winStart), e = Math.min(pEnd, winEnd);
                      if (e > s) blocks.push({ start: s, end: e, label: p.label || p.name || 'พักตามนโยบาย', color: '#4d9fff' });
                    });
                  dtLogs.forEach(d => {
                    if (!d.started_at) return;
                    const s0 = new Date(d.started_at).getTime();
                    const e0 = d.ended_at ? new Date(d.ended_at).getTime() : s0 + (d.duration_min || 0) * 60000;
                    const s = Math.max(s0, winStart), e = Math.min(e0, winEnd);
                    if (e > s) {
                      const planned = d.dr_downtime_types?.category === 'planned';
                      blocks.push({ start: s, end: e, label: d.dr_downtime_types?.name_th || 'Downtime', color: planned ? '#f59e0b' : '#ef4444' });
                    }
                  });
                  blocks.sort((a, b) => a.start - b.start);
                  const segments = [];
                  let cursor = winStart;
                  blocks.forEach(b => {
                    const s = Math.max(b.start, cursor);
                    if (s > cursor) segments.push({ start: cursor, end: s, label: 'Run', color: '#22c55e' });
                    if (b.end > cursor) { segments.push({ ...b, start: s }); cursor = Math.max(cursor, b.end); }
                  });
                  if (cursor < winEnd) segments.push({ start: cursor, end: winEnd, label: 'Run', color: '#22c55e' });
                  const totalMs = winEnd - winStart;

                  return (
                    <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>📈 Timeline เครื่องจักร — รายละเอียดของ %A</div>
                      <div style={{ display: 'flex', height: 28, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                        {segments.map((s, i) => (
                          <div key={i} title={`${s.label} · ${fmtTime(new Date(s.start))}–${fmtTime(new Date(s.end))}`}
                            style={{ width: `${(s.end - s.start) / totalMs * 100}%`, background: s.color, minWidth: 2 }} />
                        ))}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                        <span>{fmtTime(new Date(winStart))}</span>
                        <span>{fmtTime(new Date(winEnd))}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
                        {[
                          { label: 'วิ่งงาน', color: '#22c55e' },
                          { label: 'พักตามนโยบาย', color: '#4d9fff' },
                          { label: 'หยุดในแผน', color: '#f59e0b' },
                          { label: 'หยุดนอกแผน', color: '#ef4444' },
                        ].map(k => (
                          <div key={k.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
                            <span style={{ width: 9, height: 9, borderRadius: 2, background: k.color, display: 'inline-block' }} />
                            {k.label}
                          </div>
                        ))}
                      </div>
                      {dtLogs.some(d => !d.started_at) && (
                        <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 6 }}>⚠ มี Downtime บางรายการไม่ได้ระบุเวลาเริ่ม/จบ จึงไม่แสดงในไทม์ไลน์ (นับรวมในยอด Downtime ด้านบนแล้ว)</div>
                      )}
                    </div>
                  );
                })()}

                {(carryOrdersList.length > 0 || cancelledOrders.length > 0) && (
                  <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>➡ การตัดสินใจ Order ที่ยังไม่ปิด</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {carryOrdersList.map(o => (
                        <div key={o.id} style={{ fontSize: 12, color: '#a78bfa' }}>• {o.prod_no} ({o.mat_no}) — ยกยอดต่อ {o.qty_actual ?? 0}/{o.qty} ชิ้น</div>
                      ))}
                      {cancelledOrders.map(o => (
                        <div key={o.id} style={{ fontSize: 12, color: '#666' }}>• {o.prod_no} ({o.mat_no}) — ยกเลิก ({o.qty_actual ?? 0}/{o.qty} ชิ้น)</div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
                  ✓ Order ที่ปิดสำเร็จ: {confirmedOrders.length} ใบ ({confirmedOrders.reduce((s,o) => s+o.qty, 0)} ชิ้น)
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button onClick={() => setShowApproveReview(false)} style={cancelBtnStyle}>ปิด</button>
                  <button onClick={() => { setShowApproveReview(false); handleRejectClose(); }} style={{ ...cancelBtnStyle, borderColor: '#ef4444', color: '#ef4444', fontWeight: 700 }}>✕ ปฏิเสธ</button>
                  <button onClick={() => { setShowApproveReview(false); handleApproveClose(); }} style={{ ...saveBtnStyle, background: '#22c55e', fontWeight: 700 }}>✅ ยืนยันอนุมัติ</button>
                </div>
              </div>
            </div>
          );
        })()}

        {showCloseShift && selSession && (() => {
          const ng = parseInt(closeNg) || 0;
          // Downtime เปิดค้าง: ถ้าตัดสินใจแล้ว ให้ OEE preview คิดนาทีตามการตัดสินใจทันที (ยังไม่เขียน DB จนกดปิดกะ)
          const modalOpenDT = dtLogs.filter(d => d.duration_min == null);
          const previewDtLogs = !modalOpenDT.length ? dtLogs : dtLogs.map(d => {
            if (d.duration_min != null || !d.started_at) return d;
            const decision = dtCarryDecisions[d.id];
            const endStr = decision === 'carry' ? closeEndTime : (decision === 'close' ? dtCloseTimes[d.id] : null);
            if (!endStr) return d;
            const startMs = new Date(d.started_at).getTime();
            let endMs = new Date(`${selSession.work_date}T${endStr.slice(0, 5)}:00`).getTime();
            if (endMs < startMs) endMs += 86400000;
            return { ...d, ended_at: new Date(endMs).toISOString(), duration_min: Math.max(1, Math.round((endMs - startMs) / 60000)) };
          });
          const { A, P, Q, oee, shiftMin, netAvail, runMin, policyBreakMin, totalProduced, knownQty, unknownQty } = computeOEE(ng, closeEndTime, closeStartTime, previewDtLogs);
          const oeeColor = oee == null ? 'var(--muted)' : oee >= 0.85 ? '#22c55e' : oee >= 0.65 ? '#f59e0b' : '#ef4444';
          // จอ landscape กว้าง → แผ่เนื้อหาเป็น 2 คอลัมน์แทนการยืดสูงจน scroll (layout อย่างเดียว ไม่แตะ logic/การคำนวณ)
          const twoCol = typeof window !== 'undefined' && window.innerWidth >= 1100;
          const hasOpenOrdersCol = twoCol && prodOrders.some(o => o.status === 'open');
          const hasOpenDTCol = twoCol && modalOpenDT.length > 0;
          return (
            <div className="overlay" style={{ zIndex: 2000 }}>
              <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '2px solid rgba(239,68,68,0.4)', borderRadius: 14, padding: 24, width: 'min(96vw,1500px)', maxHeight: '94vh', overflowY: 'auto' }}>
                <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 2, color: '#ef4444' }}>
                  {role === 'leader' ? '📋 ขอปิดกะ — สรุปผลและ OEE' : '🔒 ปิดกะ — สรุปผลและ OEE'}
                </div>
                {role === 'leader' && (
                  <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600, marginBottom: 4 }}>
                    ⚠ กรอกข้อมูลให้ครบแล้วกด "ส่งขอปิดกะ" — SV จะอนุมัติขั้นสุดท้าย
                  </div>
                )}
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
                  {selSession.line_name} · {selSession.shift === 'day' ? 'กะเช้า' : 'กะดึก'} · {fmtDate(selSession.work_date)} · เริ่ม {selSession.start_time}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                  <Field label="เวลาเริ่มกะจริง (แก้ได้ถ้าตอนเปิดกะ/auto-เดาเวลาผิด)">
                    <TimeInput24 value={closeStartTime} onChange={e => setCloseStartTime(e.target.value)} style={{ fontSize: 16 }} />
                  </Field>
                  <Field label="เวลาปิดกะจริง (ใช้คำนวณ OEE — แก้ได้ถ้าทำรายการย้อนหลัง)">
                    <TimeInput24 value={closeEndTime} onChange={e => setCloseEndTime(e.target.value)} style={{ fontSize: 16 }} />
                  </Field>
                </div>

                {/* จอกว้าง: Downtime เปิดค้าง (ต้องตัดสินใจ) คอลัมน์ซ้าย · สรุปตัวเลขกะ คอลัมน์ขวา — จอแคบเรียงลงเหมือนเดิม */}
                <div style={{ display: 'grid', gridTemplateColumns: hasOpenDTCol ? '1fr 1fr' : '1fr', gap: hasOpenDTCol ? 14 : 0, alignItems: 'start' }}>
                <div style={{ minWidth: 0 }}>
                {/* Downtime เปิดค้าง — ต้องตัดสินใจต่อรายการก่อนปิดกะ (เครื่องกลับมาแล้ว / ยังซ่อมอยู่ ตัดยอดข้ามกะ) */}
                {modalOpenDT.length > 0 && (
                  <div style={{ marginBottom: 16, padding: '12px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#ef4444', marginBottom: 4 }}>
                      🚨 Downtime เปิดค้าง {modalOpenDT.length} รายการ — ต้องตัดสินใจก่อนปิดกะ
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
                      ถ้าเครื่องยังซ่อมไม่เสร็จ เลือก "ตัดยอดข้ามกะ" — ระบบจะปิดรายการของกะนี้ด้วยเวลาปิดกะ แล้วเปิดรายการต่อเนื่องให้อัตโนมัติเมื่อกะถัดไปของไลน์นี้เปิด (OEE ถูกต้องทั้งสองกะ)
                    </div>
                    {modalOpenDT.map(d => {
                      const decision = dtCarryDecisions[d.id];
                      return (
                        <div key={d.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg2)', borderRadius: 8, marginBottom: 6 }}>
                          <div style={{ minWidth: 160, flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>⚙️ {d.machine_no || '-'} · {d.dr_downtime_types?.name_th || 'Downtime'}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>เริ่มหยุด {d.started_at ? fmtTime(d.started_at) : '-'}{d.description ? ` — ${d.description}` : ''}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <button onClick={() => setDtCarryDecisions(p => ({ ...p, [d.id]: 'close' }))}
                              style={{
                                fontSize: 11, fontWeight: 700, padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                                border: decision === 'close' ? '1px solid #22c55e' : '1px solid var(--border)',
                                background: decision === 'close' ? 'rgba(34,197,94,0.15)' : 'var(--bg)',
                                color: decision === 'close' ? '#22c55e' : 'var(--text2)',
                              }}>
                              ✅ เครื่องกลับมาแล้ว
                            </button>
                            {decision === 'close' && (
                              <TimeInput24 value={dtCloseTimes[d.id] || ''} onChange={e => setDtCloseTimes(p => ({ ...p, [d.id]: e.target.value }))} style={{ fontSize: 13 }} />
                            )}
                            <button onClick={() => setDtCarryDecisions(p => ({ ...p, [d.id]: 'carry' }))}
                              style={{
                                fontSize: 11, fontWeight: 700, padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                                border: decision === 'carry' ? '1px solid #ef4444' : '1px solid var(--border)',
                                background: decision === 'carry' ? 'rgba(239,68,68,0.15)' : 'var(--bg)',
                                color: decision === 'carry' ? '#ef4444' : 'var(--text2)',
                              }}>
                              🔁 ยังซ่อมอยู่ — ตัดยอดข้ามกะ
                            </button>
                          </div>
                          {decision === 'carry' && (
                            <div style={{ width: '100%', fontSize: 11, color: '#f59e0b' }}>
                              ปิดรายการของกะนี้ด้วยเวลาปิดกะ ({closeEndTime || '-'}) → เปิดต่อในกะถัดไปอัตโนมัติ · ไม่แจ้ง "เครื่องกลับมารันได้" จนกว่าจะปิดจริง
                            </div>
                          )}
                          {decision === 'close' && !dtCloseTimes[d.id] && (
                            <div style={{ width: '100%', fontSize: 11, color: '#ef4444' }}>กรอกเวลาที่เครื่องกลับมาทำงานด้วย</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                </div>{/* /คอลัมน์ซ้าย (DT เปิดค้าง) */}
                <div style={{ minWidth: 0 }}>
                {/* Summary stats — แยกหยุดในแผน(เพิ่มเติมจากนโยบาย)/นอกแผนออกจากกัน ให้บวกกันแล้วเท่ากับเวลากะเป๊ะๆ
                    (เวลากะ = หยุดนโยบาย + หยุดในแผน + หยุดนอกแผน + Run Time) ไม่งั้นจะดูเหมือนเวลารวมเกิน 12 ชม. */}
                {(() => {
                  const loggedPlannedDT   = previewDtLogs.filter(d => d.dr_downtime_types?.category === 'planned').reduce((s, d) => s + (d.duration_min || 0), 0);
                  const loggedUnplannedDT = previewDtLogs.reduce((s, d) => s + (d.duration_min || 0), 0) - loggedPlannedDT;
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(90px,1fr))', gap: 10, marginBottom: 16 }}>
                      {[
                        { label: 'เวลากะ',       value: fmtMin(shiftMin),        color: 'var(--text)' },
                        { label: 'หยุดนโยบาย',   value: fmtMin(Math.round(policyBreakMin)), color: '#22c55e' },
                        { label: 'หยุดในแผน',     value: fmtMin(Math.round(loggedPlannedDT)), color: '#f59e0b' },
                        { label: 'หยุดนอกแผน',    value: fmtMin(Math.round(loggedUnplannedDT)), color: '#ef4444' },
                        { label: 'Run Time',      value: fmtMin(runMin),          color: '#4d9fff' },
                        { label: 'Order ที่ปิด', value: `${prodOrders.filter(o => o.status === 'confirmed').length} ใบ`, color: '#22c55e' },
                        { label: 'ผลิตได้',     value: `${totalProduced} ชิ้น`, color: '#22c55e' },
                        { label: 'NG',           value: `${ng} ชิ้น`,        color: '#f97316' },
                      ].map(k => (
                        <div key={k.label} style={{ background: 'var(--bg2)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>{k.label}</div>
                          <div style={{ fontSize: 14, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.value}</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Quality summary from defect_logs */}
                {(() => {
                  const tng  = defectLogs.reduce((s,d) => s+(d.qty_ng||0), 0);
                  const tsus = defectLogs.reduce((s,d) => s+(d.qty_suspect||0), 0);
                  const trep = defectLogs.reduce((s,d) => s+(d.qty_repair||0), 0);
                  if (!defectLogs.length) return null;
                  const prod  = prodOrders.filter(o => o.status === 'confirmed').reduce((s,o) => s+o.qty, 0);
                  const tok   = Math.max(0, prod - tng - tsus - trep);
                  return (
                    <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>🔴 สรุปงานเสีย ({defectLogs.length} รายการ)</div>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        {tng  > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>🔴 NG: {tng}</span>}
                        {tsus > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b' }}>🟡 สงสัย: {tsus}</span>}
                        {trep > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa' }}>🔧 ซ่อม: {trep}</span>}
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }}>✅ ดี (ประมาณ): {tok}</span>
                      </div>
                    </div>
                  );
                })()}

                </div>{/* /คอลัมน์ขวา (สรุปตัวเลข) */}
                </div>{/* /grid 2 คอลัมน์ ชุดบน */}

                {/* Per-product breakdown — separates shared lines (e.g. APRON ASSY) that run multiple MAT.NO at once (full-width) */}
                {(() => {
                  const matNos = Array.from(new Set(prodOrders.filter(o => o.status === 'confirmed' || o.status === 'open').map(o => o.mat_no)));
                  if (!matNos.length) return null;
                  const rows = matNos.map(matNo => {
                    const orders = prodOrders.filter(o => o.mat_no === matNo);
                    const target = orders.reduce((s, o) => s + o.qty, 0);
                    const confirmedQty = orders.filter(o => o.status === 'confirmed').reduce((s, o) => s + o.qty, 0);
                    const openQty = orders.filter(o => o.status === 'open').reduce((s, o) => s + (parseInt(carryQtyActual[o.id]) || 0), 0);
                    const orderIds = new Set(orders.map(o => o.id));
                    const ng = defectLogs.filter(d => orderIds.has(d.prod_order_id)).reduce((s, d) => s + (d.qty_ng || 0) + (d.qty_suspect || 0), 0);
                    const dt = dtLogs.filter(d => d.mat_no === matNo).reduce((s, d) => s + (d.duration_min || 0), 0);
                    const hasOpenOrders = orders.some(o => o.status === 'open');
                    const openedTimes = orders.map(o => o.opened_at).filter(Boolean).map(t => new Date(t).getTime());
                    const closedTimes = orders.filter(o => o.status === 'confirmed' && o.confirmed_at).map(o => new Date(o.confirmed_at).getTime());
                    // ออเดอร์ที่ยังเปิด แต่ตัดสินใจ (ยกยอด/ยกเลิก) และกรอก "เวลาหยุดผลิตจริง" ไว้แล้ว — ใช้เวลานั้น
                    // แทนเวลาปิดกะรวมของไลน์ เผื่อพาร์ทนี้หยุดวิ่งไปแล้วก่อนเวลาปิดกะ (กรณีมีหลาย MAT.NO วิ่งพร้อมกัน)
                    const openStopTimes = orders.filter(o => o.status === 'open' && carryOverDecisions[o.id]).map(o => {
                      const stopStr = carryStopTime[o.id] ?? closeEndTime;
                      if (!stopStr || !selSession?.work_date) return null;
                      let ms = new Date(`${selSession.work_date}T${stopStr.slice(0,5)}:00`).getTime();
                      if (o.opened_at && ms < new Date(o.opened_at).getTime()) ms += 86400000;
                      return ms;
                    }).filter(Boolean);
                    const baseStartMs = openedTimes.length ? Math.min(...openedTimes) : null;
                    const baseEndMs   = (closedTimes.length || openStopTimes.length) ? Math.max(...closedTimes, ...openStopTimes) : null;
                    // แก้เวลาเริ่ม-หยุดจริงเอง ได้เฉพาะ MAT.NO ที่ confirmed ครบแล้ว (ไม่มีออเดอร์เปิดค้าง) — เผื่อระบบจับเวลาอัตโนมัติ
                    // (opened_at/confirmed_at) ไม่ตรงกับเวลาที่เครื่องวิ่งจริง
                    const editableTime = !hasOpenOrders;
                    const ov = editableTime ? (matTimeOverride[matNo] || {}) : {};
                    const overrideStartMs = (ov.start && selSession?.work_date)
                      ? new Date(`${selSession.work_date}T${ov.start.slice(0,5)}:00`).getTime() : null;
                    const overrideEndMs = (ov.end && selSession?.work_date) ? (() => {
                      let ms = new Date(`${selSession.work_date}T${ov.end.slice(0,5)}:00`).getTime();
                      const refStart = overrideStartMs ?? baseStartMs;
                      if (refStart != null && ms < refStart) ms += 86400000;
                      return ms;
                    })() : null;
                    const actualStart = overrideStartMs != null ? new Date(overrideStartMs) : (baseStartMs != null ? new Date(baseStartMs) : null);
                    const actualEnd   = overrideEndMs != null ? new Date(overrideEndMs) : (baseEndMs != null ? new Date(baseEndMs) : null);
                    // ควรผลิตได้ "ถ้าวิ่งเต็มเวลา" จาก opened_at ถึง confirmed_at จริง (ไม่หัก downtime) — ใช้เทียบ %P
                    // ไม่ใช่เวลากะทั้งหมด เพราะพาร์ทนี้อาจเริ่ม/เลิกไม่ตรงกับเวลากะ (เช่น OT บางส่วนของไลน์)
                    const ctSec = ctForMatNo(matNo);
                    const winEndMs = actualEnd ? actualEnd.getTime() : (closeEndTime && selSession?.work_date ? (() => {
                      let e = new Date(`${selSession.work_date}T${closeEndTime.slice(0,5)}:00`).getTime();
                      if (actualStart && e < actualStart.getTime()) e += 86400000;
                      return e;
                    })() : null);
                    // หักเวลา Downtime ที่ทับซ้อนช่วงวิ่งของ MAT.NO นี้ออกก่อน ไม่งั้น "ควรได้" จะคิดจากเวลาทั้งหมด
                    // (รวมเวลาหยุด) ทำให้ %P ต่ำเกินจริง และไม่ตรงกับ P รวมที่คำนวณใน computeOEE()
                    const winMin = (actualStart && winEndMs) ? Math.max(0, (winEndMs - actualStart.getTime()) / 60000 - dtOverlapMin(actualStart.getTime(), winEndMs)) : null;
                    const achievable = (ctSec > 0 && winMin != null) ? Math.floor(winMin * 60 / ctSec) : null;
                    const qty = confirmedQty + openQty;
                    // ผลิตได้จริง > ควรได้ (ตาม CT ที่ตั้งไว้) แปลว่า CT ใน Product Master ตั้งไว้ช้ากว่าความเป็นจริง
                    // ย้อนคำนวณ CT จริงที่สังเกตได้จากกะนี้ไว้เตือน ไม่ใช่ปล่อยให้ %P ติดเพดาน 100% เฉยๆ
                    const observedCtSec = (winMin != null && winMin > 0 && qty > 0) ? (winMin * 60 / qty) : null;
                    const overCt = ctSec > 0 && achievable != null && qty > achievable;
                    return { matNo, partName: orders[0]?.part_name, target, qty, ng, dt, actualStart, actualEnd, achievable, ctSec, observedCtSec, overCt, editableTime };
                  }).sort((a, b) => b.qty - a.qty);
                  const dtNoMat = dtLogs.filter(d => !d.mat_no).reduce((s, d) => s + (d.duration_min || 0), 0);
                  return (
                    <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>📦 สรุปแยกตามชิ้นงาน ({rows.length} MAT.NO) — เป้าหมาย vs ควรได้ (เต็มเวลา) vs ผลิตได้จริง</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 6 }}>
                        {rows.map(r => {
                          const overage = ctOverage[r.matNo];
                          return (
                          <div key={r.matNo} style={{ padding: '8px 10px', background: 'var(--bg)', borderRadius: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: '#0ea5e9' }}>{r.matNo}</div>
                                {r.partName && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.partName}</div>}
                                {r.actualStart && (
                                  r.editableTime ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                                      <span style={{ fontSize: 11 }}>🕐</span>
                                      <TimeInput24
                                        value={matTimeOverride[r.matNo]?.start ?? fmtTime(r.actualStart)}
                                        onChange={e => setMatTimeOverride(m => ({ ...m, [r.matNo]: { ...m[r.matNo], start: e.target.value } }))}
                                        style={{ fontSize: 11, padding: '1px 3px', width: 64 }} />
                                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>–</span>
                                      <TimeInput24
                                        value={matTimeOverride[r.matNo]?.end ?? (r.actualEnd ? fmtTime(r.actualEnd) : '')}
                                        onChange={e => setMatTimeOverride(m => ({ ...m, [r.matNo]: { ...m[r.matNo], end: e.target.value } }))}
                                        style={{ fontSize: 11, padding: '1px 3px', width: 64 }} />
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: 11, color: '#4d9fff', marginTop: 1 }}>🕐 {fmtTime(r.actualStart)}–{r.actualEnd ? fmtTime(r.actualEnd) : '...'}</div>
                                  )
                                )}
                              </div>
                              <div style={{ textAlign: 'center', minWidth: 40 }}>
                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>NG</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: r.ng > 0 ? '#ef4444' : 'var(--muted)' }}>{r.ng}</div>
                              </div>
                              <div style={{ textAlign: 'center', minWidth: 60 }}>
                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Downtime</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: r.dt > 0 ? '#f59e0b' : 'var(--muted)' }}>{fmtMin(Math.round(r.dt))}</div>
                              </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
                              <div style={{ textAlign: 'center', padding: '4px 0', background: 'var(--bg2)', borderRadius: 6 }}>
                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>เป้าหมาย</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{r.target}</div>
                              </div>
                              <div style={{ textAlign: 'center', padding: '4px 0', background: 'rgba(168,85,247,0.1)', borderRadius: 6 }}>
                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>ควรได้ (เต็มเวลา)</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: '#a78bfa' }}>{r.achievable != null ? r.achievable : '—'}</div>
                              </div>
                              <div style={{ textAlign: 'center', padding: '4px 0', background: 'rgba(34,197,94,0.1)', borderRadius: 6 }}>
                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>ผลิตได้จริง</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: '#22c55e' }}>{r.qty}</div>
                              </div>
                            </div>
                            {r.achievable > 0 && (
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, textAlign: 'right' }}>
                                %P พาร์ทนี้ ≈ {Math.min(100, Math.round(r.qty / r.achievable * 100))}%
                              </div>
                            )}
                            {r.overCt && r.observedCtSec != null && (
                              <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4, padding: '4px 6px', background: 'rgba(245,158,11,0.1)', borderRadius: 6 }}>
                                ⚠ ผลิตเกิน CT ที่ตั้งไว้ ({r.ctSec} วิ) — CT จริงที่สังเกตได้กะนี้ ≈ {r.observedCtSec.toFixed(1)} วิ/ชิ้น
                              </div>
                            )}
                            {overage && overage.overCount >= 3 && (
                              <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4, padding: '4px 6px', background: 'rgba(239,68,68,0.1)', borderRadius: 6, fontWeight: 700 }}>
                                🔁 เกิน CT ซ้ำ {overage.overCount}/{overage.checked} กะล่าสุด — แนะนำปรับ CT ใน Product Master เป็น ~{overage.avgObservedCt?.toFixed(1)} วิ/ชิ้น
                              </div>
                            )}
                          </div>
                          );
                        })}
                        {dtNoMat > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                            + Downtime ไม่ได้ระบุชิ้นงาน (ทั้งไลน์): {fmtMin(Math.round(dtNoMat))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Timeline: machine run / policy break / planned-unplanned downtime — รายละเอียดของ %A */}
                {(() => {
                  if (!selSession?.work_date) return null;
                  const startTimeStr = closeStartTime || selSession.start_time;
                  if (!startTimeStr) return null;
                  const winStart = new Date(`${selSession.work_date}T${startTimeStr.slice(0,5)}:00`).getTime();
                  const endTimeStr = closeEndTime || nowTime();
                  let winEnd = new Date(`${selSession.work_date}T${endTimeStr.slice(0,5)}:00`).getTime();
                  if (winEnd <= winStart) winEnd += 86400000; // กะดึกข้ามวัน
                  if (winEnd <= winStart) return null;

                  const sessionShift = selSession.shift || 'day';
                  const processType = sessionProcessType();
                  const blocks = [];
                  breakPolicies
                    .filter(p => (p.shift === 'both' || p.shift === sessionShift) && (p.process_type === 'common' || p.process_type === processType))
                    .forEach(p => {
                      const [ph, pm] = (p.start_time || '00:00').split(':').map(Number);
                      let pStart = new Date(`${selSession.work_date}T${String(ph).padStart(2,'0')}:${String(pm).padStart(2,'0')}:00`).getTime();
                      let pEnd = pStart + (p.duration_min || 0) * 60000;
                      if (pEnd < winStart) { pStart += 86400000; pEnd += 86400000; }
                      const s = Math.max(pStart, winStart), e = Math.min(pEnd, winEnd);
                      if (e > s) blocks.push({ start: s, end: e, label: p.label || p.name || 'พักตามนโยบาย', color: '#4d9fff' });
                    });
                  dtLogs.forEach(d => {
                    if (!d.started_at) return;
                    const s0 = new Date(d.started_at).getTime();
                    const e0 = d.ended_at ? new Date(d.ended_at).getTime() : s0 + (d.duration_min || 0) * 60000;
                    const s = Math.max(s0, winStart), e = Math.min(e0, winEnd);
                    if (e > s) {
                      const planned = d.dr_downtime_types?.category === 'planned';
                      blocks.push({ start: s, end: e, label: d.dr_downtime_types?.name_th || 'Downtime', color: planned ? '#f59e0b' : '#ef4444' });
                    }
                  });
                  blocks.sort((a, b) => a.start - b.start);
                  const segments = [];
                  let cursor = winStart;
                  blocks.forEach(b => {
                    const s = Math.max(b.start, cursor);
                    if (s > cursor) segments.push({ start: cursor, end: s, label: 'Run', color: '#22c55e' });
                    if (b.end > cursor) { segments.push({ ...b, start: s }); cursor = Math.max(cursor, b.end); }
                  });
                  if (cursor < winEnd) segments.push({ start: cursor, end: winEnd, label: 'Run', color: '#22c55e' });
                  const totalMs = winEnd - winStart;

                  return (
                    <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>📈 Timeline เครื่องจักร — รายละเอียดของ %A</div>
                      <div style={{ display: 'flex', height: 28, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                        {segments.map((s, i) => (
                          <div key={i} title={`${s.label} · ${fmtTime(new Date(s.start))}–${fmtTime(new Date(s.end))}`}
                            style={{ width: `${(s.end - s.start) / totalMs * 100}%`, background: s.color, minWidth: 2 }} />
                        ))}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                        <span>{fmtTime(new Date(winStart))}</span>
                        <span>{fmtTime(new Date(winEnd))}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
                        {[
                          { label: 'วิ่งงาน', color: '#22c55e' },
                          { label: 'พักตามนโยบาย', color: '#4d9fff' },
                          { label: 'หยุดในแผน', color: '#f59e0b' },
                          { label: 'หยุดนอกแผน', color: '#ef4444' },
                        ].map(k => (
                          <div key={k.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
                            <span style={{ width: 9, height: 9, borderRadius: 2, background: k.color, display: 'inline-block' }} />
                            {k.label}
                          </div>
                        ))}
                      </div>
                      {dtLogs.some(d => !d.started_at) && (
                        <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 6 }}>⚠ มี Downtime บางรายการไม่ได้ระบุเวลาเริ่ม/จบ จึงไม่แสดงในไทม์ไลน์ (นับรวมในยอด Downtime ด้านบนแล้ว)</div>
                      )}
                    </div>
                  );
                })()}

                {/* จอกว้าง: รายการตัดสินใจ Order ที่ยังไม่ปิด คอลัมน์ซ้าย · OEE preview คอลัมน์ขวา (เห็นผลจากการตัดสินใจข้างๆ กันทันที) */}
                <div style={{ display: 'grid', gridTemplateColumns: hasOpenOrdersCol ? '1fr 1fr' : '1fr', gap: hasOpenOrdersCol ? 14 : 0, alignItems: 'start' }}>
                <div style={{ minWidth: 0 }}>
                {/* Carry-over: handle open orders */}
                {(() => {
                  const openOrders = prodOrders.filter(o => o.status === 'open');
                  if (!openOrders.length) return null;
                  // ยอดยกต้องมาจากของจริงที่ leader กรอกเองเท่านั้น ห้ามให้ระบบประมาณเวลาที่ "น่าจะ" ผลิตได้มาเติมให้
                  // (ของเดิมเคยเดาจากเวลาที่เหลือ ทำให้ดูเหมือนผลิตครบทั้งที่ยังไม่ได้ทำ) — เริ่มที่ 0 เสมอ บังคับให้กรอกเอง
                  const invalidCarry = openOrders.filter(o => {
                    const dec = carryOverDecisions[o.id];
                    if (dec !== 'carry') return false;
                    const qA = parseInt(carryQtyActual[o.id]) || 0;
                    return qA >= o.qty; // ผลิตครบ/เกินเป้าแล้ว แต่ยังเลือก "ยกยอดต่อ" — ไม่มีอะไรเหลือให้ยก
                  });
                  const allDecided = openOrders.every(o => carryOverDecisions[o.id]) && invalidCarry.length === 0;
                  return (
                    <div style={{ marginBottom: 14, padding: '12px 14px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', marginBottom: 10 }}>
                        ⚠ มี {openOrders.length} Order ที่ยังไม่ปิด — ต้องตัดสินใจก่อนปิดกะ
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {openOrders.map(o => {
                          const dec     = carryOverDecisions[o.id];
                          const qActual = carryQtyActual[o.id] ?? '';
                          const qA      = parseInt(qActual) || 0;
                          const remaining = Math.max(0, o.qty - qA);
                          return (
                            <div key={o.id} style={{ padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, border: `1px solid ${dec ? (dec === 'carry' ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.3)') : 'var(--border)'}` }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)' }}>{o.prod_no}</div>
                                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{o.mat_no} · เป้า {o.qty} ชิ้น</div>
                                </div>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button onClick={() => {
                                      setCarryOverDecisions(d => ({ ...d, [o.id]: 'confirm' }));
                                      setCarryQtyActual(m => ({ ...m, [o.id]: String(o.qty) }));
                                    }}
                                    style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${dec === 'confirm' ? '#22c55e' : 'var(--border)'}`, background: dec === 'confirm' ? 'rgba(34,197,94,0.2)' : 'var(--bg2)', color: dec === 'confirm' ? '#22c55e' : 'var(--muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                                    ✅ ผลิตครบแล้ว
                                  </button>
                                  <button onClick={() => setCarryOverDecisions(d => ({ ...d, [o.id]: 'carry' }))}
                                    style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${dec === 'carry' ? '#a78bfa' : 'var(--border)'}`, background: dec === 'carry' ? 'rgba(167,139,250,0.2)' : 'var(--bg2)', color: dec === 'carry' ? '#a78bfa' : 'var(--muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                                    ➡ ยกยอดต่อ
                                  </button>
                                  <button onClick={() => setCarryOverDecisions(d => ({ ...d, [o.id]: 'cancel' }))}
                                    style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${dec === 'cancel' ? '#ef4444' : 'var(--border)'}`, background: dec === 'cancel' ? 'rgba(239,68,68,0.15)' : 'var(--bg2)', color: dec === 'cancel' ? '#ef4444' : 'var(--muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                                    ✕ ยกเลิก
                                  </button>
                                </div>
                              </div>
                              {/* ผลิตครบแล้ว = ปิดยอดเต็มเป้าทันที ไม่ต้องกรอกอะไรเพิ่ม / ยกยอด-ยกเลิก ต้องกรอกยอดที่ทำได้จริงเอง (ห้ามเดาให้) */}
                              {dec === 'confirm' && (
                                <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 700 }}>
                                  ✓ ปิดยอด {o.qty} / {o.qty} ชิ้น (ครบเป้า) — ไม่มียอดยกไปกะถัดไป
                                </div>
                              )}
                              {(dec === 'carry' || dec === 'cancel') && (
                                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                                  <div style={{ flex: 1, minWidth: 90 }}>
                                    <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 3 }}>
                                      ✏️ ยอดที่ทำได้จริงในกะนี้ (ชิ้น) — กรอกเองตามของจริง
                                    </div>
                                    <input type="number" min="0" max={o.qty} value={qActual}
                                      placeholder="0"
                                      onChange={e => setCarryQtyActual(m => ({ ...m, [o.id]: e.target.value }))}
                                      style={{ ...inputStyle, fontSize: 16, fontWeight: 800, textAlign: 'center', width: 100,
                                        borderColor: qA > 0 ? '#22c55e' : 'var(--border)',
                                        color:       qA > 0 ? '#22c55e' : 'var(--text)' }} />
                                  </div>
                                  <div style={{ minWidth: 110 }}>
                                    <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 3 }}>
                                      ⏱ เวลาหยุดผลิตจริง
                                    </div>
                                    <TimeInput24
                                      value={carryStopTime[o.id] ?? closeEndTime}
                                      onChange={e => setCarryStopTime(m => ({ ...m, [o.id]: e.target.value }))}
                                      style={{ fontSize: 14 }} />
                                  </div>
                                  {dec === 'carry' && qA >= 0 && (
                                    <div style={{ fontSize: 11, fontWeight: 700, color: qA >= o.qty ? '#ef4444' : '#a78bfa' }}>
                                      {qA >= o.qty ? '⚠ ครบเป้าแล้ว ไม่มีอะไรเหลือให้ยก — กดปุ่ม "ผลิตครบแล้ว" แทน' : <>→ กะหน้ารับต่อ <strong>{remaining}</strong> ชิ้น</>}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {!allDecided && (
                        <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 8 }}>
                          ⚠ ต้องเลือก "ผลิตครบแล้ว" / "ยกยอดต่อ" / "ยกเลิก" ทุก Order ก่อนปิดกะ {invalidCarry.length > 0 && '(บาง Order เลือก "ยกยอดต่อ" ทั้งที่ครบเป้าแล้ว — กรุณาแก้)'}
                        </div>
                      )}
                    </div>
                  );
                })()}

                </div>{/* /คอลัมน์ซ้าย (ตัดสินใจ Order) */}
                <div style={{ minWidth: 0 }}>
                {/* OEE live preview */}
                <div style={{ padding: '14px 16px', background: `${oeeColor}18`, border: `1px solid ${oeeColor}40`, borderRadius: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontWeight: 700 }}>OEE PREVIEW (APQ)</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 16 }}>
                      {[
                        { label: 'A (Avail.)', value: `${(A * 100).toFixed(1)}%` },
                        { label: 'P (Perf.)',  value: P != null ? `${(P * 100).toFixed(1)}%` : 'N/A' },
                        { label: 'Q (Qual.)',  value: `${(Q * 100).toFixed(1)}%` },
                      ].map(k => (
                        <div key={k.label} style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{k.label}</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{k.value}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>OEE รวม</div>
                      <div style={{ fontSize: 36, fontWeight: 900, color: oeeColor, lineHeight: 1 }}>{oee != null ? `${(oee * 100).toFixed(1)}%` : 'N/A'}</div>
                    </div>
                  </div>
                  {knownQty === 0 && unknownQty > 0 && (
                    <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 6 }}>⚠ ไม่มี Cycle Time ใน Product Master ของ MAT.NO ที่ผลิตในกะนี้เลย — P/OEE คำนวณไม่ได้ (จะถูกบันทึกเป็น N/A ไม่ใช่ 100%)</div>
                  )}
                  {knownQty > 0 && unknownQty > 0 && (
                    <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 6 }}>⚠ มี {unknownQty} ชิ้น จาก MAT.NO ที่ไม่มี Cycle Time ใน Product Master — P/OEE คำนวณจาก standard time ของ {knownQty} ชิ้นที่มี CT หารด้วย run time ทั้งกะ (ค่าจริงจะต่ำกว่าถ้านับ MAT.NO ที่ขาด CT ด้วย)</div>
                  )}
                </div>

                </div>{/* /คอลัมน์ขวา (OEE preview) */}
                </div>{/* /grid 2 คอลัมน์ ชุดล่าง */}

                <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                  <button onClick={() => { setShowCloseShift(false); setCarryOverDecisions({}); }} style={cancelBtnStyle}>ยกเลิก</button>
                  <button onClick={handleCloseSession} disabled={savingClose || prodOrders.filter(o => o.status === 'open').some(o => !carryOverDecisions[o.id])}
                    style={{ ...saveBtnStyle, background: '#ef4444',
                      opacity: (savingClose || prodOrders.filter(o => o.status === 'open').some(o => !carryOverDecisions[o.id])) ? 0.5 : 1 }}>
                    {savingClose ? '...' : role === 'leader' ? '📋 ส่งขอปิดกะ' : '🔒 ยืนยันปิดกะ'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── EDIT TIMES modal — แก้เวลากะ + per-MAT.NO สำหรับกะที่ปิดแล้ว ─── */}
        {showEditTimes && selSession && (() => {
          const matNos = Array.from(new Set(prodOrders.map(o => o.mat_no))).filter(Boolean);
          return (
            <div className="overlay" style={{ zIndex: 2000 }}>
              <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '2px solid rgba(99,102,241,0.5)', borderRadius: 14, padding: 24, width: 'min(95vw,640px)', maxHeight: '90vh', overflowY: 'auto' }}>
                <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 2, color: '#6366f1' }}>✏️ แก้เวลากะ + คำนวณ OEE ใหม่</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
                  {selSession.line_name} · {selSession.shift === 'day' ? 'กะเช้า' : 'กะดึก'} · {fmtDate(selSession.work_date)}
                </div>
                <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 16 }}>
                  ⚠ เวลาที่แก้ไม่เกี่ยวกับเวลาสแกนกัมบัง — ใช้เฉพาะคำนวณ %A, %P, OEE เท่านั้น
                </div>

                {/* เวลาเริ่ม-จบกะ */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
                  <Field label="เวลาเริ่มกะ (เริ่มเครื่อง)">
                    <TimeInput24 value={closeStartTime} onChange={e => setCloseStartTime(e.target.value)} style={{ fontSize: 16 }} />
                  </Field>
                  <Field label="เวลาปิดกะ (หยุดเครื่อง)">
                    <TimeInput24 value={closeEndTime} onChange={e => setCloseEndTime(e.target.value)} style={{ fontSize: 16 }} />
                  </Field>
                </div>

                {/* เวลาเริ่ม-หยุดต่อ MAT.NO */}
                {matNos.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>
                      🕐 เวลาเริ่ม–หยุดผลิตต่อ MAT.NO (ใช้คำนวณ %P รายชิ้นงาน)
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {matNos.map(matNo => {
                        const orders = prodOrders.filter(o => o.mat_no === matNo);
                        const openedTimes  = orders.map(o => o.opened_at).filter(Boolean).map(t => new Date(t).getTime());
                        const closedTimes  = orders
                          .filter(o => (o.status === 'confirmed' && o.confirmed_at) || ((o.status === 'carry_over' || o.status === 'cancelled') && o.stopped_at))
                          .map(o => new Date(o.confirmed_at || o.stopped_at).getTime());
                        const actualStart  = openedTimes.length ? new Date(Math.min(...openedTimes)) : null;
                        const actualEnd    = closedTimes.length ? new Date(Math.max(...closedTimes)) : null;
                        const partName     = prodOrders.find(o => o.mat_no === matNo)?.part_name || '';
                        return (
                          <div key={matNo} style={{ background: 'var(--bg2)', borderRadius: 8, padding: '8px 12px' }}>
                            <div style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: '#0ea5e9', marginBottom: 4 }}>
                              {matNo}{partName && <span style={{ color: 'var(--muted)', fontWeight: 400, fontFamily: 'inherit' }}> · {partName}</span>}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>เริ่ม:</span>
                              <TimeInput24
                                value={matTimeOverride[matNo]?.start ?? (actualStart ? fmtTime(actualStart) : '')}
                                onChange={e => setMatTimeOverride(m => ({ ...m, [matNo]: { ...m[matNo], start: e.target.value } }))}
                                style={{ fontSize: 12 }} />
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>หยุด:</span>
                              <TimeInput24
                                value={matTimeOverride[matNo]?.end ?? (actualEnd ? fmtTime(actualEnd) : '')}
                                onChange={e => setMatTimeOverride(m => ({ ...m, [matNo]: { ...m[matNo], end: e.target.value } }))}
                                style={{ fontSize: 12 }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button onClick={() => { setShowEditTimes(false); setMatTimeOverride({}); }} style={cancelBtnStyle}>ยกเลิก</button>
                  <button onClick={handleSaveTimes} disabled={savingTimes}
                    style={{ ...saveBtnStyle, background: '#6366f1', opacity: savingTimes ? 0.6 : 1 }}>
                    {savingTimes ? '...' : '💾 บันทึก + คำนวณ OEE ใหม่'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── OVERFLOW CONFIRMATION modal ─────────────────────── */}
        {overflowInfo && (
          <div className="overlay" style={{ zIndex: 2100 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '2px solid rgba(239,68,68,0.5)', borderRadius: 14, padding: 28, width: 'min(95vw,420px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#ef4444' }}>⚠️ คิวผลิตเกินเวลากะนี้</div>
              <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 700 }}>
                  {overflowInfo.prodNo} · {overflowInfo.qty} ชิ้น
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  ใบนี้ต้องใช้เวลา <b style={{ color: 'var(--text)' }}>{overflowInfo.newOrderMin} นาที</b>
                  {' '}แต่กะนี้เหลือความจุอีก <b style={{ color: '#f59e0b' }}>{overflowInfo.remainMin} นาที</b>
                </div>
                <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 700 }}>
                  จะเกินเวลาไป {overflowInfo.overMin} นาที
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                ต้องการทำอย่างไรกับ Order นี้?
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={handleOverflowNextShift}
                  disabled={savingProdOpen}
                  style={{ flex: 1, padding: '12px 8px', borderRadius: 10, border: '2px solid rgba(77,159,255,0.5)', background: 'rgba(77,159,255,0.1)', color: '#4d9fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  📦 ส่งเป็นยอดค้างกะถัดไป
                </button>
                <button
                  onClick={handleOverflowForce}
                  disabled={savingProdOpen}
                  style={{ flex: 1, padding: '12px 8px', borderRadius: 10, border: '1px solid var(--border2)', background: 'var(--bg2)', color: 'var(--text)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                  ⚡ เปิดกะนี้ต่อ (OT)
                </button>
              </div>
              <button onClick={() => setOverflowInfo(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>
                ยกเลิก
              </button>
            </div>
          </div>
        )}

        {/* ── SCAN OPEN modal ─────────────────────────────────── */}
        {/* ── เปิดเป้า manual — ไลน์ไม่มี kanban card (เช่น HDF1 → LASER CUT 123) ── */}
        {showManualOpen && (
          <div className="overlay" style={{ zIndex: 2000 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '2px solid rgba(96,165,250,0.45)', borderRadius: 14, padding: 24, width: 'min(95vw,460px)' }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 2, color: '#60a5fa' }}>✍️ เปิดเป้าผลิต (ไม่มีบาร์โค้ด)</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
                สำหรับไลน์ที่ SAP ไม่ gen order ให้สแกน — leader ตั้งเป้า แล้วพนักงาน<b>อัพเดทยอดสะสมทุกช่วงเบรค</b> ปิดใบด้วยยอดจริงตอนจบ
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label="สินค้า (MAT.NO) — เฉพาะที่ register กับไลน์นี้ *">
                  {(() => {
                    // เฉพาะสินค้าของ family ไลน์นี้ (ไลน์ตัวเอง + แม่ + ลูก เผื่อ register ไว้ที่ระดับไลน์หลัก)
                    // ห้าม fallback โชว์ทุกสินค้า — เคยหลุดแล้ว user ทัก (2026-07-12)
                    const fam = new Set(getLineFamilyNames(lines, selSession?.line_name || '').map(n => n.trim().toLowerCase()));
                    const lineProds = products.filter(p => p.mat_no && fam.has((p.line_name || '').trim().toLowerCase()));
                    return (
                      <select value={manualForm.mat_no} onChange={e => setManualForm(f => ({ ...f, mat_no: e.target.value }))}>
                        <option value="">{lineProds.length ? '— เลือกสินค้า —' : '— ไลน์นี้ยังไม่มีสินค้า register (เพิ่มที่ Product Master ก่อน) —'}</option>
                        {lineProds.map(p => (
                          <option key={p.id} value={p.mat_no}>{p.mat_no} · {p.name}</option>
                        ))}
                      </select>
                    );
                  })()}
                </Field>
                <Field label="เป้าหมายผลิตของกะนี้ (ชิ้น) *">
                  <input type="number" min={1} inputMode="numeric" value={manualForm.qty}
                    onChange={e => setManualForm(f => ({ ...f, qty: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') handleManualOpen(); }} />
                </Field>
                {/* เปิดย้อนหลัง — กติกา/หน้าตาเดียวกับใบสแกน (ลืมเปิดเป้าตอนต้นกะ เริ่มผลิตไปแล้ว) */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 12px', background: manualForm.is_backfill ? 'rgba(107,114,128,0.15)' : 'rgba(107,114,128,0.06)', border: `1px solid ${manualForm.is_backfill ? 'rgba(107,114,128,0.5)' : 'rgba(107,114,128,0.2)'}`, borderRadius: 8 }}>
                  <input type="checkbox" checked={manualForm.is_backfill}
                    onChange={e => setManualForm(f => ({ ...f, is_backfill: e.target.checked, backfill_time: e.target.checked ? (f.backfill_time || guessBackfillTime()) : '' }))}
                    style={{ width: 16, height: 16, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>⏪ เปิดย้อนหลัง — เริ่มผลิตไปแล้ว ลืมเปิดเป้าตอนต้น</span>
                </label>
                {manualForm.is_backfill && (
                  <Field label="เวลาที่เริ่มผลิตจริง *">
                    {/* width กัน index.css input{width:100%} (กับดัก CSS ใน CLAUDE.md) */}
                    <input type="time" value={manualForm.backfill_time}
                      onChange={e => setManualForm(f => ({ ...f, backfill_time: e.target.value }))}
                      style={{ width: 140, display: 'block' }} />
                  </Field>
                )}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button disabled={savingManual} onClick={handleManualOpen}
                    style={{ flex: 2, padding: 12, background: '#60a5fa', color: '#08131f', border: 'none', borderRadius: 8, fontWeight: 800, fontSize: 14, cursor: 'pointer', opacity: savingManual ? 0.6 : 1 }}>
                    {savingManual ? 'กำลังบันทึก...' : '✍️ เปิดเป้า'}
                  </button>
                  <button onClick={() => setShowManualOpen(false)}
                    style={{ flex: 1, padding: 12, background: 'var(--bg2)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                    ยกเลิก
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showScanOpen && (
          <div className="overlay" style={{ zIndex: 2000 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '2px solid rgba(245,158,11,0.4)', borderRadius: 14, padding: 24, width: 'min(95vw,460px)' }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 2, color: '#f59e0b' }}>📥 Scan เปิด Prod Order</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
                สแกน PROD.NO → กด Enter → บันทึกอัตโนมัติ — ไม่ต้องคลิกปุ่ม
              </div>

              {pendingPairId && (
                <div style={{ padding: '8px 12px', background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 8, fontSize: 12, color: '#a855f7', fontWeight: 600, marginBottom: 12 }}>
                  🔗 รอสแกนคู่ RH/LH (MAT.NO {openProdForm.mat_no}) — เปิดเสร็จจะผูกคู่กับใบแรกอัตโนมัติ
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label="PROD.NO (สแกน barcode ตัวล่าง Sender/ID บน Tag Card) *">
                  <input ref={openProdInputRef} autoFocus value={openProdForm.prod_no}
                    onChange={e => setOpenProdForm(f => ({ ...f, prod_no: e.target.value }))}
                    onKeyDown={e => {
                      if (e.key !== 'Enter') return;
                      if (openProdForm.mat_no && openProdForm.qty && openProdForm.prod_no && !prodOrders.find(o => o.prod_no === openProdForm.prod_no.trim())) {
                        handleScanOpen();
                      } else {
                        document.getElementById('open-mat-select')?.focus();
                      }
                    }}
                    placeholder="สแกน PROD.NO..."
                    style={{ ...inputStyle, fontFamily: 'monospace', fontWeight: 700, fontSize: 15 }} />
                  <ScanLenHint value={openProdForm.prod_no} />
                </Field>

                {(() => {
                  const lineName = selSession?.line_name;
                  const lineStds = kanbanStds.filter(s => s.dr_products?.line_name === lineName);
                  if (lineStds.length === 0) {
                    return (
                      <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, fontSize: 12, color: '#ef4444', fontWeight: 600 }}>
                        ⚠ ไลน์นี้ ({lineName}) ยังไม่มี Kanban Standard ผูกไว้เลย — ไปเพิ่มที่ Product Setup ก่อน
                      </div>
                    );
                  }
                  return (
                    <Field label={`MAT.NO (${lineStds.length} รายการของไลน์นี้) *`}>
                      <select
                        id="open-mat-select"
                        value={openProdForm.mat_no}
                        onChange={e => handleOpenProdMatNoChange(e.target.value)}
                        style={{ ...inputStyle, fontFamily: 'monospace', fontWeight: 700, fontSize: 14 }}
                      >
                        <option value="">— เลือก MAT.NO —</option>
                        {lineStds.map(s => (
                          <option key={s.id} value={s.mat_no}>
                            {s.mat_no}{s.dr_products?.name ? ` · ${s.dr_products.name}` : s.part_name ? ` · ${s.part_name}` : ''} ({s.qty_per_kanban} ชิ้น/ใบ)
                          </option>
                        ))}
                      </select>
                    </Field>
                  );
                })()}

                {openProdStd && (
                  <div style={{ padding: '8px 12px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--muted)' }}>
                    <span style={{ color: '#22c55e', fontWeight: 700 }}>✓ {openProdStd.qty_per_kanban} ชิ้น / Kanban ใบ </span>
                    {(openProdStd.dr_products?.name || openProdStd.part_name) && <span style={{ color: 'var(--text)', fontWeight: 600 }}> · {openProdStd.dr_products?.name || openProdStd.part_name}</span>}
                    {openProdStd.customer && <span> · {openProdStd.customer}</span>}
                    {openProdStd.p_no && <span> · P.NO: {openProdStd.p_no}</span>}
                  </div>
                )}

                <Field label={openProdStd ? `Qty (auto จาก Standard: ${openProdStd.qty_per_kanban} ชิ้น)` : 'Qty ต่อ Tag Card (ชิ้น) *'}>
                  <input id="open-qty-input" type="number" min="1" value={openProdForm.qty}
                    onChange={e => setOpenProdForm(f => ({ ...f, qty: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') handleScanOpen(); }}
                    style={{ ...inputStyle, fontSize: 22, fontWeight: 900, textAlign: 'center',
                      background: openProdStd ? 'rgba(34,197,94,0.08)' : 'var(--bg)',
                      color: openProdStd ? '#22c55e' : 'var(--text)' }} />
                </Field>

                {/* Duplicate warning */}
                {openProdForm.prod_no && prodOrders.find(o => o.prod_no === openProdForm.prod_no) && (
                  <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, fontSize: 12, color: '#ef4444', fontWeight: 600 }}>
                    ⚠ PROD.NO นี้เปิดไปแล้วในกะนี้
                  </div>
                )}
              </div>

              {/* Backfill toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 12px', marginTop: 10, background: openProdForm.is_backfill ? 'rgba(107,114,128,0.15)' : 'rgba(107,114,128,0.06)', border: `1px solid ${openProdForm.is_backfill ? 'rgba(107,114,128,0.5)' : 'rgba(107,114,128,0.2)'}`, borderRadius: 8 }}>
                <input type="checkbox" checked={openProdForm.is_backfill}
                  onChange={e => setOpenProdForm(f => ({ ...f, is_backfill: e.target.checked, backfill_time: e.target.checked ? (f.backfill_time || guessBackfillTime()) : '' }))}
                  style={{ width: 16, height: 16, cursor: 'pointer' }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>ยิงย้อนหลัง / เติมข้อมูล</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>order นี้ผลิตไปแล้ว — ไม่นับ delay บน Heijunka</div>
                </div>
              </label>
              {openProdForm.is_backfill && (
                <Field label="เวลาที่เริ่มผลิตจริง * (บังคับใส่ — ระบบเดาให้แล้ว เช็คอีกครั้งก่อนบันทึก)">
                  <input type="time" value={openProdForm.backfill_time}
                    onChange={e => setOpenProdForm(f => ({ ...f, backfill_time: e.target.value }))}
                    style={inputStyle} />
                </Field>
              )}

              {/* Running count */}
              {prodOrders.filter(o => o.status === 'open').length > 0 && (
                <div style={{ marginTop: 12, padding: '6px 12px', background: 'rgba(245,158,11,0.1)', borderRadius: 8, fontSize: 12, color: '#f59e0b', fontWeight: 700 }}>
                  เปิดในกะนี้แล้ว {prodOrders.filter(o => o.status === 'open').length} ใบ · {prodOrders.filter(o => o.status === 'open').reduce((s, o) => s + o.qty, 0)} ชิ้น
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                <button onClick={() => { setShowScanOpen(false); setPendingPairId(null); }} style={cancelBtnStyle}>ปิด</button>
                <button onClick={handleScanOpen}
                  disabled={savingProdOpen || !openProdForm.prod_no || !openProdForm.mat_no || !openProdForm.qty || (openProdForm.is_backfill && !openProdForm.backfill_time) || !!prodOrders.find(o => o.prod_no === openProdForm.prod_no)}
                  style={{ ...saveBtnStyle, background: '#f59e0b', color: '#000', fontSize: 14,
                    opacity: (savingProdOpen || !openProdForm.prod_no || !openProdForm.mat_no || !openProdForm.qty || (openProdForm.is_backfill && !openProdForm.backfill_time)) ? 0.5 : 1 }}>
                  {savingProdOpen ? '...' : '📥 เปิด Order'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── SCAN CLOSE modal ────────────────────────────────── */}
        {showScanClose && (
          <div className="overlay" style={{ zIndex: 2000 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '2px solid rgba(34,197,94,0.4)', borderRadius: 14, padding: 24, width: 'min(95vw,460px)' }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 2, color: '#22c55e' }}>📤 Scan ปิด / Confirm</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
                สแกน PROD.NO → Confirm อัตโนมัติทันที — ไม่ต้องคลิกปุ่ม
              </div>

              <Field label="PROD.NO (สแกน barcode ตัวล่าง Sender/ID บน Tag Card)">
                <input ref={closeProdInputRef} autoFocus value={closeProdNo}
                  onChange={e => handleCloseProdNoChange(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && closeMatch) handleScanCloseImmediate(closeMatch); }}
                  placeholder="สแกน PROD.NO..."
                  style={{ ...inputStyle, fontFamily: 'monospace', fontWeight: 700, fontSize: 15 }} />
                <ScanLenHint value={closeProdNo} />
              </Field>

              {/* Match preview */}
              {closeProdNo && (
                <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 8,
                  background: closeMatch ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                  border: `1px solid ${closeMatch ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
                  {closeMatch ? (
                    <>
                      <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 700, marginBottom: 8 }}>✓ พบ Order</div>
                      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{closeMatch.mat_no}</div>
                          {closeMatch.part_name && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{closeMatch.part_name}</div>}
                        </div>
                        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                          <div style={{ fontSize: 28, fontWeight: 900, color: '#22c55e', lineHeight: 1 }}>{closeMatch.qty}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>ชิ้น</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)', background: 'rgba(34,197,94,0.06)', borderRadius: 6, padding: '6px 10px' }}>
                        ✅ ยืนยัน <strong style={{ color: '#22c55e' }}>{closeMatch.qty} ชิ้น</strong> เป็น OK ทั้งหมด
                        · หากมีงานเสียให้กด <strong>🔴 บันทึกงานเสีย</strong> แยกต่างหาก
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>
                      {prodOrders.find(o => o.prod_no === closeProdNo && o.status === 'confirmed')
                        ? '⚠ PROD.NO นี้ปิดไปแล้ว'
                        : '✕ ไม่พบ PROD.NO นี้ในกะปัจจุบัน'}
                    </div>
                  )}
                </div>
              )}

              {/* Running count */}
              {prodOrders.filter(o => o.status === 'confirmed').length > 0 && (
                <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(34,197,94,0.1)', borderRadius: 8, fontSize: 12 }}>
                  <div style={{ color: '#22c55e', fontWeight: 700 }}>
                    ปิดแล้ว {prodOrders.filter(o => o.status === 'confirmed').length} ใบ · {prodOrders.filter(o => o.status === 'confirmed').reduce((s, o) => s + o.qty, 0)} ชิ้น
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowScanClose(false)} style={cancelBtnStyle}>ปิด</button>
                <button onClick={handleScanClose} disabled={savingProdClose || !closeMatch}
                  style={{ ...saveBtnStyle, background: '#22c55e', fontSize: 14, opacity: (!closeMatch || savingProdClose) ? 0.5 : 1 }}>
                  {savingProdClose ? '...' : '📤 Confirm ปิด Order'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── DEFECT LOG MODAL ─────────────────────────────────── */}
        {showDefect && selSession && (
          <div className="overlay" style={{ zIndex: 2000 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '2px solid rgba(239,68,68,0.4)', borderRadius: 14, padding: 24, width: 'min(95vw,480px)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#ef4444' }}>🔴 {defectForm.id ? 'แก้ไขงานเสีย' : 'บันทึกงานเสีย'}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
                  <div style={{ color: '#4d9fff', fontWeight: 700 }}>{selSession.line_name}</div>
                  <div>{selSession.shift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก'} · {fmtDate(selSession.work_date)}</div>
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
                บันทึกได้ตลอดเวลา แยกตามประเภทของเสีย
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {(() => {
                  const matNoOptions = Array.from(new Set(prodOrders.filter(o => o.status !== 'cancelled').map(o => o.mat_no))).filter(Boolean);
                  if (!matNoOptions.length) return null;
                  return (
                    <Field label="MAT.NO ที่เสีย *">
                      <select autoFocus value={defectForm.mat_no} onChange={e => setDefectForm(f => ({ ...f, mat_no: e.target.value }))} style={inputStyle}>
                        <option value="">เลือก MAT.NO...</option>
                        {matNoOptions.map(mn => {
                          const o = prodOrders.find(o => o.mat_no === mn);
                          return <option key={mn} value={mn}>{mn}{o?.part_name ? ` · ${o.part_name}` : ''}</option>;
                        })}
                      </select>
                    </Field>
                  );
                })()}

                <Field label="ประเภทงานเสีย *">
                  {(() => {
                    const pt = sessionProcessType();
                    const filtered = defectTypes.filter(t => !t.process_type || t.process_type === pt || t.process_type === 'common');
                    return (
                      <select value={defectForm.defect_type_id} onChange={e => setDefectForm(f => ({ ...f, defect_type_id: e.target.value }))} style={inputStyle}>
                        <option value="">เลือกประเภท...</option>
                        {filtered.map(t => (
                          <option key={t.id} value={t.id}>{t.name_th}</option>
                        ))}
                      </select>
                    );
                  })()}
                </Field>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                  {[
                    { key: 'qty_ng',      label: '🔴 NG / เสีย',    color: '#ef4444' },
                    { key: 'qty_suspect', label: '🟡 ต้องสงสัย',    color: '#f59e0b' },
                    { key: 'qty_repair',  label: '🔧 ซ่อม/Rework',  color: '#a78bfa' },
                  ].map(q => (
                    <div key={q.key}>
                      <div style={{ fontSize: 11, color: q.color, fontWeight: 700, marginBottom: 3 }}>{q.label}</div>
                      <input type="number" min="0" value={defectForm[q.key]}
                        onChange={e => setDefectForm(f => ({ ...f, [q.key]: e.target.value }))}
                        style={{ ...inputStyle, textAlign: 'center', fontWeight: 800, fontSize: 18,
                          borderColor: parseInt(defectForm[q.key]) > 0 ? q.color : 'var(--border)',
                          color:       parseInt(defectForm[q.key]) > 0 ? q.color : 'var(--text)' }} />
                    </div>
                  ))}
                </div>

                <Field label="รายละเอียด / สาเหตุ">
                  <input type="text" value={defectForm.description} onChange={e => setDefectForm(f => ({ ...f, description: e.target.value }))} placeholder="เช่น มิติไม่ได้เพราะแม่พิมพ์สึก..." style={inputStyle} />
                </Field>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowDefect(false)} style={cancelBtnStyle}>ยกเลิก</button>
                <button onClick={handleAddDefectLog} disabled={savingDefect || !defectForm.defect_type_id}
                  style={{ ...saveBtnStyle, background: '#ef4444', opacity: (!defectForm.defect_type_id || savingDefect) ? 0.5 : 1 }}>
                  {savingDefect ? '...' : (defectForm.id ? 'บันทึกการแก้ไข' : 'บันทึกงานเสีย')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add downtime modal */}
        {showDT && selSession && (() => {
          const { startedAt, endedAt, durMin } = computeDtTimes();
          const hasResult = startedAt || durMin;
          const MODES = [
            { key: 'start_end', label: 'เริ่ม → จบ',   desc: 'กรอกเวลาเริ่มหยุด + เวลากลับมา → คำนวณนาทีอัตโนมัติ' },
            { key: 'start_dur', label: 'เริ่ม + นาที',  desc: 'กรอกเวลาเริ่มหยุด + จำนวนนาที → คำนวณเวลากลับมา' },
            { key: 'end_dur',   label: 'จบ + นาที',     desc: 'กรอกเวลากลับมา + จำนวนนาที → คำนวณเวลาเริ่มหยุด' },
          ];
          const fmtTimeLocal = (dt) => dt ? fmtTime(dt) : '—';
          const fmtDateLabel = (dt) => { if (!dt) return ''; return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}`; };
          const workDate = new Date(`${fmtDate(selSession.work_date)}T12:00:00`);
          const isNextDay = (dt) => dt && dt.toDateString() !== workDate.toDateString();
          return (
            <div className="overlay" style={{ zIndex: 2000 }}>
              <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(95vw,500px)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>⏱ {dtForm.id ? 'แก้ไข Downtime' : 'บันทึก Downtime'}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
                    <div style={{ color: '#4d9fff', fontWeight: 700 }}>{selSession.line_name}</div>
                    <div>{selSession.shift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก'} · {fmtDate(selSession.work_date)}</div>
                  </div>
                </div>

                {/* Mode selector */}
                <div style={{ display: 'flex', gap: 4, background: 'var(--bg2)', borderRadius: 8, padding: 4, marginBottom: 16 }}>
                  {MODES.map(m => (
                    <button key={m.key} onClick={() => setDtForm(f => ({ ...f, mode: m.key }))}
                      style={{ flex: 1, padding: '6px 4px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                        background: dtForm.mode === m.key ? '#ef4444' : 'transparent',
                        color: dtForm.mode === m.key ? '#fff' : 'var(--muted)' }}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
                  {MODES.find(m => m.key === dtForm.mode)?.desc}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Downtime type */}
                  <Field label="ประเภท Downtime *">
                    {(() => {
                      const pt = sessionProcessType();
                      const filtered = dtTypes.filter(t => t.process_type === pt || t.process_type === 'common');
                      return (
                        <select autoFocus value={dtForm.downtime_type_id} onChange={e => setDtForm(f => ({ ...f, downtime_type_id: e.target.value }))} style={inputStyle}>
                          <option value="">เลือกประเภท...</option>
                          {['unplanned', 'planned'].map(cat => (
                            <optgroup key={cat} label={cat === 'unplanned' ? '⚠ นอกแผน' : '📋 ในแผน'}>
                              {filtered.filter(t => t.category === cat).map(t => (
                                <option key={t.id} value={t.id}>{t.name_th}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      );
                    })()}
                  </Field>

                  {/* Time inputs depending on mode */}
                  <div style={{ display: 'grid', gridTemplateColumns: dtForm.mode === 'start_end' ? '1fr 1fr' : '1fr 1fr', gap: 10 }}>
                    {/* Start time — shown in start_end and start_dur modes */}
                    {(dtForm.mode === 'start_end' || dtForm.mode === 'start_dur') && (
                      <Field label="🔴 เวลาเริ่มหยุด">
                        <TimeInput24 value={dtForm.start_time}
                          onChange={e => setDtForm(f => ({ ...f, start_time: e.target.value }))}
                          style={{ fontSize: 18 }} />
                      </Field>
                    )}
                    {/* End time — shown in start_end and end_dur modes */}
                    {(dtForm.mode === 'start_end' || dtForm.mode === 'end_dur') && (
                      <Field label="🟢 เวลากลับมาทำงาน">
                        <TimeInput24 value={dtForm.end_time}
                          onChange={e => setDtForm(f => ({ ...f, end_time: e.target.value }))}
                          style={{ fontSize: 18 }} />
                      </Field>
                    )}
                    {/* Duration — shown in start_dur and end_dur modes */}
                    {(dtForm.mode === 'start_dur' || dtForm.mode === 'end_dur') && (
                      <Field label="⏱ จำนวนนาที">
                        <input type="number" min="0.5" step="0.5" value={dtForm.duration_min}
                          onChange={e => setDtForm(f => ({ ...f, duration_min: e.target.value }))}
                          placeholder="เช่น 30" style={{ ...inputStyle, fontSize: 18, fontWeight: 800, textAlign: 'center' }} />
                      </Field>
                    )}
                  </div>

                  {/* Auto-calculated result preview */}
                  {hasResult && (
                    <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 9 }}>
                      <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>🔴 เริ่มหยุด</div>
                          <div style={{ fontSize: 18, fontWeight: 900, color: '#ef4444', lineHeight: 1.1 }}>{fmtTime(startedAt)}</div>
                          {isNextDay(startedAt) && <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>+1 วัน · {fmtDate(startedAt)}</div>}
                        </div>
                        <div style={{ fontSize: 18, color: 'var(--muted)' }}>→</div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>🟢 กลับมา</div>
                          <div style={{ fontSize: 18, fontWeight: 900, color: '#22c55e', lineHeight: 1.1 }}>{fmtTime(endedAt)}</div>
                          {isNextDay(endedAt) && <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>+1 วัน · {fmtDate(endedAt)}</div>}
                        </div>
                        <div style={{ marginLeft: 'auto', textAlign: 'center' }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>รวม</div>
                          <div style={{ fontSize: 22, fontWeight: 900, color: '#f59e0b' }}>{durMin ? `${Math.round(durMin * 10) / 10} นาที` : '—'}</div>
                        </div>
                      </div>
                      {(isNextDay(startedAt) || isNextDay(endedAt)) && (
                        <div style={{ marginTop: 8, fontSize: 11, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', borderRadius: 6, padding: '4px 8px' }}>
                          ⚠ เวลาข้ามคืน — บันทึกเป็นวันถัดไปอัตโนมัติ (กะดึกเริ่ม {fmtDate(selSession.work_date)})
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Field label="เครื่องจักร *">
                      {(() => {
                        const lineMachines = machines.filter(m => m.line_name === selSession.line_name);
                        if (!lineMachines.length) {
                          return <input type="text" value={dtForm.machine_no} onChange={e => setDtForm(f => ({ ...f, machine_no: e.target.value }))} placeholder="เช่น MC-01" style={inputStyle} />;
                        }
                        return (
                          <select value={dtForm.machine_no} onChange={e => setDtForm(f => ({ ...f, machine_no: e.target.value }))} style={inputStyle}>
                            <option value="">เลือกเครื่องจักร...</option>
                            {lineMachines.map(m => (
                              <option key={m.id} value={m.machine_no}>
                                {m.machine_no}{m.machine_name ? ` · ${m.machine_name}` : ''}
                              </option>
                            ))}
                          </select>
                        );
                      })()}
                    </Field>
                    <Field label="ชิ้นงาน (แยก OEE/Downtime ตามชิ้นงาน) *">
                      {(() => {
                        const lineStds = kanbanStds.filter(s => s.dr_products?.line_name === selSession.line_name);
                        if (!lineStds.length) return <div style={{ ...inputStyle, color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>— ไม่มีชิ้นงานในไลน์นี้ —</div>;
                        return (
                          <select value={dtForm.mat_no} onChange={e => setDtForm(f => ({ ...f, mat_no: e.target.value }))} style={inputStyle}>
                            <option value="">เลือกชิ้นงาน...</option>
                            {lineStds.map(s => (
                              <option key={s.id} value={s.mat_no}>
                                {s.mat_no}{s.dr_products?.name ? ` · ${s.dr_products.name}` : s.part_name ? ` · ${s.part_name}` : ''}
                              </option>
                            ))}
                          </select>
                        );
                      })()}
                    </Field>
                  </div>
                  <Field label="รายละเอียด">
                    <input type="text" value={dtForm.description} onChange={e => setDtForm(f => ({ ...f, description: e.target.value }))} placeholder="สาเหตุ..." style={inputStyle} />
                  </Field>
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
                  <button onClick={() => setShowDT(false)} style={cancelBtnStyle}>ยกเลิก</button>
                  {(() => {
                    const lineStdsForBtn = kanbanStds.filter(s => s.dr_products?.line_name === selSession?.line_name);
                    const dtInvalid = !dtForm.downtime_type_id || !hasResult || !dtForm.machine_no || (lineStdsForBtn.length > 0 && !dtForm.mat_no);
                    return (
                      <button onClick={handleAddDT} disabled={savingDT || dtInvalid}
                        style={{ ...saveBtnStyle, background: '#ef4444', opacity: (dtInvalid || savingDT) ? 0.5 : 1 }}>
                        {savingDT ? '...' : (dtForm.id ? 'บันทึกการแก้ไข' : 'บันทึก Downtime')}
                      </button>
                    );
                  })()}
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   HISTORY TAB
═══════════════════════════════════════════════════════════════ */
function HistoryTab({ role }) {
  const { lineId: userLineId, sections: scopeSecs = [] } = useContext(UserContext);
  const [sessions, setSessions]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState({ date: '', line_name: '' });
  const [lineNames, setLineNames] = useState([]);
  const [expanded, setExpanded]   = useState(null);
  const [dtMap, setDtMap]         = useState({});
  const [defectMap, setDefectMap] = useState({});
  const [orderMap, setOrderMap]   = useState({});
  const [deleting, setDeleting]   = useState(null);
  const [ordersMinimized, setOrdersMinimized] = useState({});

  const canDeleteSession = can('daily_report', 'delete_session', role);

  const handleDelete = async (s) => {
    if (!window.confirm(`ลบกะ ${s.line_name} ${s.shift === 'day' ? 'กะเช้า' : 'กะดึก'} วันที่ ${fmtDate(s.work_date)} ?\n(ข้อมูล Order, Downtime, Defect จะถูกลบทั้งหมด)`)) return;
    setDeleting(s.id);
    const { error } = await supabaseDR.from('production_sessions').delete().eq('id', s.id);
    setDeleting(null);
    if (error) { toast.error('ลบไม่สำเร็จ: ' + error.message); return; }
    toast.success('ลบกะเรียบร้อย');
    setSessions(prev => prev.filter(x => x.id !== s.id));
  };

  const load = useCallback(async () => {
    setLoading(true);
    const { data: ln } = await supabase.from('production_lines').select('id, name, section, parent_line_name').order('name');
    const lm = {};
    (ln || []).forEach(l => { lm[l.name] = l; });
    const pcm = {};
    (ln || []).forEach(l => { if (l.parent_line_name) (pcm[l.parent_line_name] ||= []).push(l.name); });
    const normSection = (s) => (s || '').trim().toLowerCase();

    // ไลน์ที่ role นี้มีสิทธิ์เห็นประวัติ — leader/supervisor เห็นเฉพาะของตัวเอง เหมือน LiveTab
    let allowedLineNames = null;
    if (role === 'leader' && userLineId) {
      const myLine = (ln || []).find(l => l.id === userLineId);
      allowedLineNames = myLine ? [myLine.name, ...(pcm[myLine.name] || [])] : [];
    } else if (role !== 'admin' && scopeSecs.length) {
      allowedLineNames = (ln || []).filter(l => inSectionScope(scopeSecs, l.section)).map(l => l.name);
    }

    let q = supabaseDR.from('production_sessions')
      .select('*, dr_products(name)')
      .eq('status', 'closed')
      .order('work_date', { ascending: false })
      .limit(100);
    if (filter.date)      q = q.eq('work_date', filter.date);
    if (filter.line_name) q = q.eq('line_name', filter.line_name);
    if (allowedLineNames) q = q.in('line_name', allowedLineNames.length ? allowedLineNames : ['__none__']);
    const { data: ss } = await q;
    setSessions(ss || []);
    setLineNames(allowedLineNames ?? (ln || []).map(l => l.name));
    setLoading(false);
  }, [filter, role, scopeSecs, userLineId]);

  useEffect(() => { load(); }, [load]);

  const loadDetail = async (sessionId) => {
    if (dtMap[sessionId]) return; // already loaded
    const [{ data: dts }, { data: defects }, { data: orders }] = await Promise.all([
      supabaseDR.from('downtime_logs')
        .select('*, dr_downtime_types(name_th, color, category)')
        .eq('session_id', sessionId).order('started_at'),
      supabaseDR.from('defect_logs')
        .select('*, dr_defect_types(name_th, color), prod_orders(prod_no)')
        .eq('session_id', sessionId).order('logged_at'),
      supabaseDR.from('prod_orders')
        .select('*')
        .eq('session_id', sessionId).order('opened_at'),
    ]);
    setDtMap(m     => ({ ...m,      [sessionId]: dts     || [] }));
    setDefectMap(m => ({ ...m,      [sessionId]: defects || [] }));
    setOrderMap(m  => ({ ...m,      [sessionId]: orders  || [] }));
  };

  const handleExpand = (id) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    loadDetail(id);
  };

  if (loading) return <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>กำลังโหลด...</div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input type="date" value={filter.date} onChange={e => setFilter(f => ({ ...f, date: e.target.value }))} style={{ ...inputStyle, width: 160 }} />
        <select value={filter.line_name} onChange={e => setFilter(f => ({ ...f, line_name: e.target.value }))} style={{ ...inputStyle, width: 200 }}>
          <option value="">ทุกไลน์</option>
          {lineNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <button onClick={() => setFilter({ date: '', line_name: '' })} style={cancelBtnStyle}>ล้าง</button>
      </div>

      {sessions.length === 0 && <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>ไม่พบข้อมูล</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sessions.map(s => {
          const dts      = dtMap[s.id]     || [];
          const defects  = defectMap[s.id] || [];
          const orders   = orderMap[s.id]  || [];
          const totalDT  = dts.reduce((acc, d) => acc + (d.duration_min || 0), 0);
          // NG% from qty_ng saved at close (from defect_logs total)
          const ngQty    = s.qty_ng || 0;
          const defRate  = s.actual_qty > 0 ? ((ngQty / s.actual_qty) * 100).toFixed(1) : '0.0';
          const oeeVal   = s.oee;
          const oeeColor = oeeVal >= 85 ? '#22c55e' : oeeVal >= 65 ? '#f59e0b' : '#ef4444';
          return (
            <div key={s.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <div onClick={() => handleExpand(s.id)} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', cursor: 'pointer' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{s.line_name}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{s.shift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก'} · {fmtDate(s.work_date)}</span>
                    {s.dr_products?.name && <span style={{ fontSize: 11, color: '#4d9fff' }}>· {s.dr_products.name}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
                  <Stat label="ผลิต"  value={s.actual_qty || 0}    color="#4d9fff" />
                  <Stat label="NG%"   value={`${defRate}%`}         color={parseFloat(defRate) > 1 ? '#ef4444' : '#22c55e'} />
                  <Stat label="DT"    value={fmtMin(totalDT)}       color="#a855f7" small />
                  {oeeVal != null && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>OEE</div>
                      <div style={{ fontSize: 15, fontWeight: 900, color: oeeColor }}>{oeeVal.toFixed(1)}%</div>
                    </div>
                  )}
                  <span style={{ color: 'var(--muted)', fontSize: 16 }}>{expanded === s.id ? '▲' : '▼'}</span>
                  {canDeleteSession && (
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(s); }}
                      disabled={deleting === s.id}
                      style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 700, opacity: deleting === s.id ? 0.5 : 1 }}>
                      {deleting === s.id ? '...' : 'ลบ'}
                    </button>
                  )}
                </div>
              </div>
              {expanded === s.id && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', background: 'var(--bg2)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* OEE detail row */}
                  {s.oee != null && (
                    <div style={{ display: 'flex', gap: 20, padding: '8px 12px', background: `${oeeColor}10`, borderRadius: 8, border: `1px solid ${oeeColor}30`, flexWrap: 'wrap' }}>
                      {[
                        { label: 'Availability', value: s.oee_a },
                        { label: 'Performance',  value: s.oee_p },
                        { label: 'Quality',      value: s.oee_q },
                      ].map(k => {
                        const c = (k.value||0) >= 85 ? '#22c55e' : (k.value||0) >= 65 ? '#f59e0b' : '#ef4444';
                        return (
                          <div key={k.label} style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{k.label}</div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: c }}>{k.value != null ? `${k.value.toFixed(1)}%` : '—'}</div>
                          </div>
                        );
                      })}
                      <div style={{ textAlign: 'center', marginLeft: 'auto' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>OEE</div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: oeeColor }}>{s.oee.toFixed(1)}%</div>
                      </div>
                    </div>
                  )}

                  {/* Per-MAT.NO breakdown */}
                  {(() => {
                    const matNos = Array.from(new Set(orders.map(o => o.mat_no).filter(Boolean)));
                    if (!matNos.length) return null;
                    const rows = matNos.map(matNo => {
                      const matOrders = orders.filter(o => o.mat_no === matNo);
                      // ยอด "ผลิต" = confirmed เต็มเป้า + qty_actual ของ carry_over/cancelled — ให้ตรงกับ actual_qty
                      // ที่หัว session เสมอ (qty_actual ตอนนี้ต้องกรอกเองทุกครั้ง ไม่มี auto-estimate แล้ว จึงเชื่อถือได้)
                      const qty = matOrders.reduce((sum, o) => sum + (o.status === 'confirmed' ? (o.qty || 0) : (o.qty_actual || 0)), 0);
                      const orderIds = new Set(matOrders.map(o => o.id));
                      const ng = defects.filter(d => orderIds.has(d.prod_order_id)).reduce((sum, d) => sum + (d.qty_ng || 0) + (d.qty_suspect || 0), 0);
                      const dt = dts.filter(d => d.mat_no === matNo).reduce((sum, d) => sum + (d.duration_min || 0), 0);
                      return { matNo, partName: matOrders[0]?.part_name, qty, ng, dt };
                    }).sort((a, b) => b.qty - a.qty);
                    return (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>📦 สรุปแยกตามชิ้นงาน ({rows.length} รายการ)</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {rows.map(r => (
                            <div key={r.matNo} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: 'var(--card)', borderRadius: 6, border: '1px solid var(--border)' }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace' }}>{r.matNo}</span>
                              {r.partName && <span style={{ fontSize: 11, color: 'var(--muted)', flex: 1 }}>{r.partName}</span>}
                              {!r.partName && <span style={{ flex: 1 }} />}
                              <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e' }}>ผลิต {r.qty}</span>
                              {r.ng > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444' }}>NG {r.ng}</span>}
                              {r.dt > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#a855f7' }}>DT {fmtMin(r.dt)}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Prod orders */}
                  {orders.length > 0 && (() => {
                    const minimized = ordersMinimized[s.id] ?? true;
                    return (
                    <div>
                      <div
                        onClick={() => setOrdersMinimized(m => ({ ...m, [s.id]: !minimized }))}
                        style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' }}>
                        <span style={{ fontSize: 11 }}>{minimized ? '▶' : '▼'}</span>
                        📋 Prod Orders ({orders.length} ใบ)
                      </div>
                      {!minimized && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {orders.map(o => {
                          const statusColor = o.status === 'confirmed' ? '#22c55e' : o.status === 'carry_over' ? '#a78bfa' : o.status === 'cancelled' ? '#666' : '#f59e0b';
                          const statusLabel = o.status === 'confirmed' ? '✓ ปิดแล้ว' : o.status === 'carry_over' ? '➡ ยกยอด' : o.status === 'cancelled' ? '✕ ยกเลิก' : '● ผลิต';
                          return (
                            <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: 'var(--card)', borderRadius: 6, borderLeft: `3px solid ${statusColor}`, opacity: o.status === 'cancelled' ? 0.5 : 1 }}>
                              <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>{o.prod_no}</span>
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{o.mat_no}</span>
                              {o.part_name && <span style={{ fontSize: 11, color: 'var(--muted)', flex: 1 }}>· {o.part_name}</span>}
                              {!o.part_name && <span style={{ flex: 1 }} />}
                              <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: `${statusColor}20`, color: statusColor, fontWeight: 700 }}>{statusLabel}</span>
                              <span style={{ fontSize: 12, fontWeight: 800, color: statusColor, minWidth: 40, textAlign: 'right' }}>{o.qty}</span>
                            </div>
                          );
                        })}
                      </div>
                      )}
                    </div>
                    );
                  })()}

                  {/* Defect logs */}
                  {defects.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', marginBottom: 6 }}>🔴 งานเสีย ({defects.length} รายการ)</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {defects.map(d => (
                          <div key={d.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 10px', background: 'var(--card)', borderRadius: 6, borderLeft: `3px solid ${d.dr_defect_types?.color || '#ef4444'}` }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', flex: 1 }}>{d.dr_defect_types?.name_th || '—'}</span>
                              {d.prod_orders?.prod_no && (
                                <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: 'rgba(74,222,128,0.1)', color: '#22c55e', fontWeight: 700, fontFamily: 'monospace' }}>
                                  {d.prod_orders.prod_no}
                                </span>
                              )}
                              {d.qty_ng      > 0 && <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 700 }}>NG {d.qty_ng}</span>}
                              {d.qty_suspect > 0 && <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>สงสัย {d.qty_suspect}</span>}
                              {d.qty_repair  > 0 && <span style={{ fontSize: 11, color: '#a78bfa', fontWeight: 700 }}>ซ่อม {d.qty_repair}</span>}
                            </div>
                            {d.description && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{d.description}</div>}
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                              {fmtTime(new Date(d.logged_at))}{d.reported_by_name && ` · ${d.reported_by_name}`}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Downtime logs */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>⏱ Downtime ({dts.length} รายการ)</div>
                    {dts.length === 0 ? (
                      <div style={{ color: 'var(--muted)', fontSize: 12 }}>ไม่มี Downtime</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {dts.map(d => {
                          const cat = CAT_META[d.dr_downtime_types?.category] || CAT_META.unplanned;
                          return (
                            <div key={d.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 10px', background: 'var(--card)', borderRadius: 6, borderLeft: `3px solid ${d.dr_downtime_types?.color || '#aaa'}` }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: cat.bg, color: cat.color, fontWeight: 700 }}>{cat.label}</span>
                                <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{d.dr_downtime_types?.name_th}</span>
                                {d.machine_no && <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {d.machine_no}</span>}
                                {d.mat_no && <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: 'rgba(14,165,233,0.15)', color: '#0ea5e9' }}>{d.mat_no}</span>}
                                <span style={{ fontSize: 12, fontWeight: 700, color: d.dr_downtime_types?.color || '#aaa' }}>{fmtMin(d.duration_min)}</span>
                              </div>
                              {d.description && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{d.description}</div>}
                              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                                {d.started_at && fmtTime(new Date(d.started_at))}
                                {d.ended_at && ` – ${fmtTime(new Date(d.ended_at))}`}
                                {d.reported_by_name && ` · ${d.reported_by_name}`}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   EXPORT TAB
═══════════════════════════════════════════════════════════════ */
function ExportTab() {
  const { role, lineId: userLineId, sections: scopeSecs = [] } = useContext(UserContext);
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const firstOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };

  const [filter, setFilter]       = useState({ date_from: firstOfMonth(), date_to: today(), line_name: '' });
  const [lineNames, setLineNames] = useState([]);
  const [allowedLineNames, setAllowedLineNames] = useState(null); // null = ไม่จำกัด (admin/manager/qa/...)
  const [loading, setLoading]     = useState(false);
  const [preview, setPreview]     = useState(null); // { type, rows, cols }

  useEffect(() => {
    supabase.from('production_lines').select('id, name, section, parent_line_name').order('name')
      .then(({ data }) => {
        const ln = data || [];
        const normSection = (s) => (s || '').trim().toLowerCase();
        const pcm = {};
        ln.forEach(l => { if (l.parent_line_name) (pcm[l.parent_line_name] ||= []).push(l.name); });
        let allowed = null;
        if (role === 'leader' && userLineId) {
          const myLine = ln.find(l => l.id === userLineId);
          allowed = myLine ? [myLine.name, ...(pcm[myLine.name] || [])] : [];
        } else if (role !== 'admin' && scopeSecs.length) {
          allowed = ln.filter(l => inSectionScope(scopeSecs, l.section)).map(l => l.name);
        }
        setAllowedLineNames(allowed);
        setLineNames(allowed ?? ln.map(l => l.name));
      });
  }, [role, scopeSecs, userLineId]);

  // ── fetch all raw data ──────────────────────────────────────────
  const fetchData = async () => {
    setLoading(true);
    let q = supabaseDR.from('production_sessions')
      .select(`*, dr_products(name, cycle_time_sec, target_per_shift),
               prod_orders(*),
               downtime_logs(*, dr_downtime_types(name_th, category)),
               defect_logs(*, dr_defect_types(name_th))`)
      .eq('status', 'closed')
      .gte('work_date', filter.date_from)
      .lte('work_date', filter.date_to)
      .order('work_date', { ascending: true })
      .order('shift', { ascending: true });
    if (filter.line_name) q = q.eq('line_name', filter.line_name);
    if (allowedLineNames) q = q.in('line_name', allowedLineNames.length ? allowedLineNames : ['__none__']);
    const { data, error } = await q;
    setLoading(false);
    if (error) { toast.error(error.message); return null; }
    return data || [];
  };

  // ── build datasets ─────────────────────────────────────────────
  const buildKanban = (sessions) => sessions.flatMap(s =>
    (s.prod_orders || []).map(o => ({
      'วันที่': fmtDate(s.work_date),
      'ไลน์': s.line_name,
      'กะ': s.shift === 'day' ? 'เช้า' : 'ดึก',
      'PROD.NO': o.prod_no || '',
      'MAT.NO': o.mat_no || '',
      'Part Name': o.part_name || '',
      'P.NO': o.p_no || '',
      'Customer': o.customer || '',
      'Qty แผน': o.qty || 0,
      'Qty OK': o.qty_ok ?? '',
      'สถานะ': o.status === 'confirmed' ? 'ปิดแล้ว' : o.status === 'carry_over' ? 'ยกยอด' : o.status === 'open' ? 'กำลังผลิต' : o.status,
      'ยิงย้อนหลัง': o.is_backfill ? 'ใช่' : '',
      'เปิดโดย': o.opened_by || '',
      'เวลาเปิด': o.opened_at ? fmtDateTimeFull(new Date(o.opened_at)) : '',
      'เวลาปิด': o.confirmed_at ? fmtDateTimeFull(new Date(o.confirmed_at)) : '',
    }))
  );

  const buildOutput = (sessions) => sessions.map(s => {
    const totalDT     = (s.downtime_logs || []).reduce((a, d) => a + (d.duration_min || 0), 0);
    const unplanDT    = (s.downtime_logs || []).filter(d => d.dr_downtime_types?.category !== 'planned').reduce((a, d) => a + (d.duration_min || 0), 0);
    const planDT      = totalDT - unplanDT;
    const ngQty       = (s.defect_logs || []).reduce((a, d) => a + (d.qty_ng || 0), 0) + (s.qty_ng || 0);
    const okQty       = s.qty_ok || Math.max(0, (s.actual_qty || 0) - ngQty);
    return {
      'วันที่': fmtDate(s.work_date),
      'ไลน์': s.line_name,
      'กะ': s.shift === 'day' ? 'เช้า' : 'ดึก',
      'สินค้า': s.dr_products?.name || '',
      'เวลาเริ่ม': s.start_time || '',
      'เวลาสิ้นสุด': s.end_time || '',
      'ยอดผลิตรวม': s.actual_qty || 0,
      'ยอดดี (OK)': okQty,
      'ยอดเสีย (NG)': ngQty,
      'Downtime รวม (นาที)': +totalDT.toFixed(1),
      'Unplanned DT (นาที)': +unplanDT.toFixed(1),
      'Planned DT (นาที)': +planDT.toFixed(1),
      'OEE (%)': s.oee != null ? +Number(s.oee).toFixed(1) : '',
      'A (%)': s.oee_a != null ? +Number(s.oee_a).toFixed(1) : '',
      'P (%)': s.oee_p != null ? +Number(s.oee_p).toFixed(1) : '',
      'Q (%)': s.oee_q != null ? +Number(s.oee_q).toFixed(1) : '',
      'เปิดกะโดย': s.opened_by_name || '',
      'ปิดกะโดย': s.closed_by_name || '',
    };
  });

  // หมายเหตุ: A/P/Q/OEE ใช้ค่าที่บันทึกไว้แล้วใน production_sessions (oee_a/oee_p/oee_q/oee)
  // ซึ่งคำนวณตอนปิดกะจาก computeOEE() — คิดรวมเวลาเปิด-ปิดกะจริง, break policy, และ CT ต่อ MAT.NO แล้ว
  // ห้าม recalculate ที่นี่ด้วยสมมติฐานกะ 12 ชม. คงที่ ไม่งั้นจะได้เลขไม่ตรงกับหน้า Output/Dashboard/OEEAnalytics
  const buildOEE = (sessions) => {
    const rows = [];
    for (const s of sessions) {
      const dts = s.downtime_logs || [];
      const unplanDT = dts.filter(d => d.dr_downtime_types?.category !== 'planned').reduce((a, d) => a + (d.duration_min || 0), 0);
      const planDT   = dts.filter(d => d.dr_downtime_types?.category === 'planned').reduce((a, d) => a + (d.duration_min || 0), 0);
      const ngQty    = (s.defect_logs || []).reduce((a, d) => a + (d.qty_ng || 0), 0) + (s.qty_ng || 0);
      const totalQty = s.actual_qty || 0;
      const ctSec    = s.dr_products?.cycle_time_sec || 0;

      // Main OEE row
      rows.push({
        'วันที่': fmtDate(s.work_date),
        'ไลน์': s.line_name,
        'กะ': s.shift === 'day' ? 'เช้า' : 'ดึก',
        'สินค้า': s.dr_products?.name || '',
        'Cycle Time (วิ)': ctSec || '',
        'Unplanned DT (นาที)': +unplanDT.toFixed(1),
        'Planned DT (นาที)': +planDT.toFixed(1),
        'ยอดผลิต': totalQty,
        'NG': ngQty,
        'A (%)': s.oee_a != null ? +Number(s.oee_a).toFixed(1) : '',
        'P (%)': s.oee_p != null ? +Number(s.oee_p).toFixed(1) : '',
        'Q (%)': s.oee_q != null ? +Number(s.oee_q).toFixed(1) : '',
        'OEE (%)': s.oee != null ? +Number(s.oee).toFixed(1) : '',
      });

      // Downtime detail rows (indented)
      for (const d of dts) {
        rows.push({
          'วันที่': '',
          'ไลน์': '',
          'กะ': '  └ DT',
          'สินค้า': d.dr_downtime_types?.name_th || 'ไม่ระบุ',
          'Cycle Time (วิ)': d.dr_downtime_types?.category === 'planned' ? 'Planned' : 'Unplanned',
          'Unplanned DT (นาที)': '',
          'Planned DT (นาที)': '',
          'ยอดผลิต': '',
          'NG': '',
          'A (%)': '',
          'P (%)': '',
          'Q (%)': d.duration_min != null ? +Number(d.duration_min).toFixed(1) + ' นาที' : '',
          'OEE (%)': d.description || '',
        });
      }
    }
    return rows;
  };

  const buildDowntime = (sessions) => sessions.flatMap(s =>
    (s.downtime_logs || []).map(d => ({
      'วันที่': fmtDate(s.work_date),
      'ไลน์': s.line_name,
      'กะ': s.shift === 'day' ? 'เช้า' : 'ดึก',
      'ประเภท': d.dr_downtime_types?.name_th || 'ไม่ระบุ',
      'หมวด': d.dr_downtime_types?.category === 'planned' ? 'ในแผน' : 'นอกแผน',
      'ระยะเวลา (นาที)': d.duration_min != null ? +Number(d.duration_min).toFixed(1) : '',
      'เครื่องจักร': d.machine_no || '',
      'รายละเอียด': d.description || '',
      'เวลาเริ่ม': d.started_at ? fmtDateTimeFull(new Date(d.started_at)) : '',
      'เวลาสิ้นสุด': d.ended_at   ? fmtDateTimeFull(new Date(d.ended_at)) : '',
    }))
  );

  // ── CSV export ─────────────────────────────────────────────────
  const exportCSV = (rows, filename) => {
    if (!rows.length) { toast.error('ไม่มีข้อมูล'); return; }
    const headers = Object.keys(rows[0]);
    const lines   = [headers.join(','), ...rows.map(r =>
      headers.map(h => {
        const v = r[h] ?? '';
        return String(v).includes(',') || String(v).includes('"') || String(v).includes('\n')
          ? `"${String(v).replace(/"/g, '""')}"` : String(v);
      }).join(',')
    )];
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename + '.csv';
    a.click(); URL.revokeObjectURL(url);
  };

  // ── PDF export via jsPDF + autoTable ──────────────────────────
  const exportPDF = async (rows, title, filename) => {
    if (!rows.length) { toast.error('ไม่มีข้อมูล'); return; }
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const { registerThaiFont } = await import('../lib/pdfThaiFont');

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    registerThaiFont(doc);
    const headers = Object.keys(rows[0]);

    // Title
    doc.setFontSize(14);
    doc.text(title, 14, 14);
    doc.setFontSize(9);
    doc.text(`ช่วงวันที่: ${filter.date_from} ถึง ${filter.date_to}${filter.line_name ? '  ไลน์: ' + filter.line_name : ''}`, 14, 21);
    doc.text(`Export: ${fmtDateTimeFull(new Date())}`, 14, 27);

    autoTable(doc, {
      startY: 32,
      head: [headers],
      body: rows.map(r => headers.map(h => r[h] ?? '')),
      styles: { font: 'Sarabun', fontSize: 7, cellPadding: 1.5, overflow: 'linebreak' },
      headStyles: { font: 'Sarabun', fillColor: [30, 60, 40], textColor: 255, fontStyle: 'bold', fontSize: 7 },
      alternateRowStyles: { fillColor: [245, 248, 245] },
      margin: { left: 10, right: 10 },
    });

    doc.save(filename + '.pdf');
  };

  // ── Shift Report Form PDF — one page per session, mimics paper DPR form ──
  // เผื่อยังไม่มีไฟล์ฟอร์มจริงอ้างอิง ใช้ layout มาตรฐานโรงงานไปก่อน (หัวกระดาษ/กรอบข้อมูล/ตาราง/ช่องเซ็นชื่อ)
  // ปรับ layout ตรงนี้ได้ทันทีที่ได้รับไฟล์ฟอร์มจริง
  const exportShiftFormPDF = async (sessions) => {
    if (!sessions.length) { toast.error('ไม่มีข้อมูล'); return; }
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const { registerThaiFont } = await import('../lib/pdfThaiFont');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    registerThaiFont(doc);
    const PAGE_W = 210, MARGIN = 12, CONTENT_W = PAGE_W - MARGIN * 2;
    const logoDataUrl = await getTsLogoDataUrl();

    sessions.forEach((s, idx) => {
      if (idx > 0) doc.addPage();
      let y = MARGIN;

      // ── Header (โลโก้บริษัทเดียวกับหน้าเว็บ) ──────────────────
      if (logoDataUrl) doc.addImage(logoDataUrl, 'PNG', MARGIN, y - 2, 10, 11.6);
      doc.setFontSize(13).setFont('Sarabun', 'bold');
      doc.text('Thai Summit Group', MARGIN + (logoDataUrl ? 13 : 0), y + 4);
      doc.setFontSize(15);
      doc.text('DAILY PRODUCTION REPORT', PAGE_W / 2, y + 4, { align: 'center' });
      doc.setFontSize(9).setFont('Sarabun', 'normal');
      doc.text(`ใบรายงานการผลิตประจำกะ`, PAGE_W / 2, y + 9, { align: 'center' });
      y += 15;
      doc.setLineWidth(0.5);
      doc.line(MARGIN, y, PAGE_W - MARGIN, y);
      y += 5;

      // ── Info grid (ไลน์ / วันที่ / กะ / สินค้า / เวลา / ผู้เปิด-ปิด) ──
      const shiftLabel = s.shift === 'day' ? 'กะเช้า (Day)' : 'กะดึก (Night)';
      const ngQty = (s.defect_logs || []).reduce((a, d) => a + (d.qty_ng || 0), 0) + (s.qty_ng || 0);
      const okQty = s.qty_ok || Math.max(0, (s.actual_qty || 0) - ngQty);
      autoTable(doc, {
        startY: y,
        theme: 'grid',
        styles: { font: 'Sarabun', fontSize: 9, cellPadding: 2 },
        body: [
          ['ไลน์ผลิต',        s.line_name || '-',          'วันที่',         fmtDate(s.work_date)],
          ['กะ',              shiftLabel,                    'สินค้า',        s.dr_products?.name || '-'],
          ['เวลาเริ่มกะ',      s.start_time || '-',          'เวลาสิ้นสุดกะ',  s.end_time || '-'],
          ['ผู้เปิดกะ',        s.opened_by_name || '-',      'ผู้ปิดกะ',       s.closed_by_name || '-'],
        ],
        columnStyles: {
          0: { fontStyle: 'bold', fillColor: [240,240,240], cellWidth: 28 },
          1: { cellWidth: 67 },
          2: { fontStyle: 'bold', fillColor: [240,240,240], cellWidth: 28 },
          3: { cellWidth: 'auto' },
        },
        margin: { left: MARGIN, right: MARGIN },
      });
      y = doc.lastAutoTable.finalY + 6;

      // ── ยอดผลิต / OEE summary box ──────────────────────────
      doc.setFontSize(10).setFont('Sarabun', 'bold');
      doc.text('สรุปยอดผลิตและ OEE', MARGIN, y);
      y += 3;
      autoTable(doc, {
        startY: y,
        theme: 'grid',
        styles: { font: 'Sarabun', fontSize: 9, cellPadding: 2.5, halign: 'center' },
        head: [['ยอดผลิตรวม', 'ดี (OK)', 'เสีย (NG)', 'A (%)', 'P (%)', 'Q (%)', 'OEE (%)']],
        body: [[
          s.actual_qty || 0, okQty, ngQty,
          s.oee_a != null ? Number(s.oee_a).toFixed(1) : '-',
          s.oee_p != null ? Number(s.oee_p).toFixed(1) : '-',
          s.oee_q != null ? Number(s.oee_q).toFixed(1) : '-',
          s.oee   != null ? Number(s.oee).toFixed(1)   : '-',
        ]],
        headStyles: { font: 'Sarabun', fillColor: [30,60,40], textColor: 255, fontStyle: 'bold' },
        margin: { left: MARGIN, right: MARGIN },
      });
      y = doc.lastAutoTable.finalY + 6;

      // ── Kanban / PROD.NO records ──────────────────────────
      const orders = s.prod_orders || [];
      doc.setFontSize(10).setFont('Sarabun', 'bold');
      doc.text('รายการผลิต (Kanban / PROD.NO)', MARGIN, y);
      y += 3;
      autoTable(doc, {
        startY: y,
        theme: 'grid',
        styles: { font: 'Sarabun', fontSize: 8, cellPadding: 1.8 },
        head: [['PROD.NO', 'MAT.NO', 'Part Name', 'Qty แผน', 'Qty OK', 'สถานะ']],
        body: orders.length ? orders.map(o => [
          o.prod_no || '-', o.mat_no || '-', o.part_name || '-', o.qty || 0, o.qty_ok ?? '-',
          o.status === 'confirmed' ? 'ปิดแล้ว' : o.status === 'carry_over' ? 'ยกยอด' : o.status === 'open' ? 'กำลังผลิต' : o.status,
        ]) : [['-', '-', 'ไม่มีรายการ', '-', '-', '-']],
        headStyles: { font: 'Sarabun', fillColor: [60,60,60], textColor: 255, fontStyle: 'bold', fontSize: 8 },
        margin: { left: MARGIN, right: MARGIN },
      });
      y = doc.lastAutoTable.finalY + 6;

      // ── Downtime ─────────────────────────────────────────
      const dts = s.downtime_logs || [];
      if (y > 230) { doc.addPage(); y = MARGIN; }
      doc.setFontSize(10).setFont('Sarabun', 'bold');
      doc.text('Downtime', MARGIN, y);
      y += 3;
      autoTable(doc, {
        startY: y,
        theme: 'grid',
        styles: { font: 'Sarabun', fontSize: 8, cellPadding: 1.8 },
        head: [['ประเภท', 'หมวด', 'ระยะเวลา (นาที)', 'เครื่องจักร', 'รายละเอียด']],
        body: dts.length ? dts.map(d => [
          d.dr_downtime_types?.name_th || '-',
          d.dr_downtime_types?.category === 'planned' ? 'ในแผน' : 'นอกแผน',
          d.duration_min != null ? Number(d.duration_min).toFixed(1) : '-',
          d.machine_no || '-', d.description || '-',
        ]) : [['-', '-', '-', '-', 'ไม่มี Downtime']],
        headStyles: { font: 'Sarabun', fillColor: [60,60,60], textColor: 255, fontStyle: 'bold', fontSize: 8 },
        margin: { left: MARGIN, right: MARGIN },
      });
      y = doc.lastAutoTable.finalY + 6;

      // ── Defects ───────────────────────────────────────────
      const defs = s.defect_logs || [];
      if (y > 230) { doc.addPage(); y = MARGIN; }
      doc.setFontSize(10).setFont('Sarabun', 'bold');
      doc.text('งานเสีย / NG', MARGIN, y);
      y += 3;
      autoTable(doc, {
        startY: y,
        theme: 'grid',
        styles: { font: 'Sarabun', fontSize: 8, cellPadding: 1.8 },
        head: [['ประเภท NG', 'จำนวน NG', 'สงสัย', 'ซ่อมได้']],
        body: defs.length ? defs.map(d => [
          d.dr_defect_types?.name_th || '-', d.qty_ng || 0, d.qty_suspect || 0, d.qty_repair || 0,
        ]) : [['-', '-', '-', 'ไม่มีงานเสีย']],
        headStyles: { font: 'Sarabun', fillColor: [60,60,60], textColor: 255, fontStyle: 'bold', fontSize: 8 },
        margin: { left: MARGIN, right: MARGIN },
      });
      y = doc.lastAutoTable.finalY + 14;

      // ── Signature row ─────────────────────────────────────
      if (y > 255) { doc.addPage(); y = MARGIN; }
      const sigCols = [
        { role: 'ผู้ผลิต (Operator)', name: s.opened_by_name || '' },
        { role: 'หัวหน้างาน (Supervisor)', name: s.closed_by_name || s.close_requested_by_name || '' },
        { role: 'QA / ผู้ตรวจสอบ', name: '' },
      ];
      const colW = CONTENT_W / 3;
      doc.setFontSize(9).setFont('Sarabun', 'normal');
      sigCols.forEach((c, i) => {
        const x0 = MARGIN + i * colW;
        doc.line(x0 + 6, y + 12, x0 + colW - 6, y + 12);
        doc.text('ลงชื่อ ____________________', x0 + 4, y + 12, { baseline: 'bottom' });
        doc.text(`(${c.name || '............................'})`, x0 + colW / 2, y + 18, { align: 'center' });
        doc.text(c.role, x0 + colW / 2, y + 23, { align: 'center' });
      });

      doc.setFontSize(7);
      doc.text(`พิมพ์เมื่อ: ${fmtDateTimeFull(new Date())}`, MARGIN, 290);
    });

    doc.save(`shift_form_${filter.date_from}_${filter.date_to}${filter.line_name ? '_' + filter.line_name : ''}.pdf`);
  };

  // ── preview data ───────────────────────────────────────────────
  const handlePreview = async (type) => {
    const sessions = await fetchData();
    if (!sessions) return;
    const builders = { kanban: buildKanban, output: buildOutput, oee: buildOEE, downtime: buildDowntime };
    const rows = builders[type](sessions);
    setPreview({ type, rows, cols: rows.length ? Object.keys(rows[0]) : [] });
  };

  const REPORT_TYPES = [
    { key: 'kanban',   icon: '🏷',  label: 'Kanban Records',        desc: 'PROD.NO · MAT.NO · Qty · สถานะทุกใบ' },
    { key: 'output',   icon: '📦',  label: 'Output / ผลผลิต',       desc: 'ยอดผลิต · NG · Downtime สรุปรายกะ' },
    { key: 'oee',      icon: '📈',  label: 'OEE รายละเอียด',        desc: 'A · P · Q · OEE% + รายละเอียด Downtime แต่ละกะ' },
    { key: 'downtime', icon: '⏱',  label: 'Downtime Log',           desc: 'ประเภท · ระยะเวลา · เครื่องจักร · รายละเอียด' },
  ];

  // ใบรายงานการผลิตประจำกะ — ฟอร์ม PDF แยกพิเศษ (1 หน้า/กะ พร้อมช่องเซ็นชื่อ)
  const handleExportShiftForm = async () => {
    const sessions = await fetchData();
    if (!sessions) return;
    await exportShiftFormPDF(sessions);
  };

  const labelFor = key => REPORT_TYPES.find(r => r.key === key)?.label || key;

  // width:'auto' กัน trap index.css input{width:100%} ยืดช่องใน filter bar (pattern เดียวกับ OEEAnalytics)
  const sel = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text)', fontSize: 13, width: 'auto' };
  const btnSm = (color) => ({ padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, background: color, color: '#fff' });

  return (
    <div style={{ maxWidth: 900 }}>
      {/* Filters */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12, color: 'var(--text)' }}>📤 Export ข้อมูล Daily Report</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>วันที่เริ่ม</div>
            <input type="date" value={filter.date_from} onChange={e => setFilter(f => ({ ...f, date_from: e.target.value }))} style={sel} />
          </div>
          <div style={{ paddingTop: 18, color: 'var(--muted)' }}>—</div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>วันที่สิ้นสุด</div>
            <input type="date" value={filter.date_to} onChange={e => setFilter(f => ({ ...f, date_to: e.target.value }))} style={sel} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>ไลน์</div>
            <select value={filter.line_name} onChange={e => setFilter(f => ({ ...f, line_name: e.target.value }))} style={{ ...sel, minWidth: 160 }}>
              <option value="">ทุกไลน์</option>
              {lineNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          {loading && <div style={{ paddingTop: 18, fontSize: 12, color: 'var(--muted)' }}>⏳ กำลังโหลด...</div>}
        </div>
      </div>

      {/* Report type cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 14, marginBottom: 24 }}>
        {REPORT_TYPES.map(r => (
          <div key={r.key} style={{ background: 'var(--card)', border: `1px solid ${preview?.type === r.key ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>{r.icon}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>{r.label}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>{r.desc}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button style={btnSm('#6b7280')} onClick={() => handlePreview(r.key)} disabled={loading}>
                👁 ดูตัวอย่าง
              </button>
              <button style={btnSm('#16a34a')} onClick={async () => {
                const sessions = await fetchData();
                if (!sessions) return;
                const rows = { kanban: buildKanban, output: buildOutput, oee: buildOEE, downtime: buildDowntime }[r.key](sessions);
                const fn = `${r.key}_${filter.date_from}_${filter.date_to}${filter.line_name ? '_' + filter.line_name : ''}`;
                exportCSV(rows, fn);
              }} disabled={loading}>⬇ CSV</button>
              <button style={btnSm('#dc2626')} onClick={async () => {
                const sessions = await fetchData();
                if (!sessions) return;
                const rows = { kanban: buildKanban, output: buildOutput, oee: buildOEE, downtime: buildDowntime }[r.key](sessions);
                const fn = `${r.key}_${filter.date_from}_${filter.date_to}${filter.line_name ? '_' + filter.line_name : ''}`;
                await exportPDF(rows, r.label + ` (${filter.date_from} – ${filter.date_to})`, fn);
              }} disabled={loading}>⬇ PDF</button>
            </div>
          </div>
        ))}

        {/* ใบรายงานการผลิตประจำกะ — ฟอร์มจริง 1 หน้า/กะ พร้อมช่องเซ็นชื่อ */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--accent)', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>📄</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>ใบรายงานการผลิตประจำกะ (Form)</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
            1 หน้า/กะ — หัวกระดาษ, ยอดผลิต+OEE, Kanban, Downtime, NG, ช่องเซ็นชื่อ
          </div>
          <button style={btnSm('#dc2626')} onClick={handleExportShiftForm} disabled={loading}>⬇ PDF ฟอร์ม</button>
        </div>
      </div>

      {/* Preview table */}
      {preview && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>ตัวอย่าง — {labelFor(preview.type)}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 10 }}>{preview.rows.length} แถว</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={btnSm('#16a34a')} onClick={() => {
                const fn = `${preview.type}_${filter.date_from}_${filter.date_to}`;
                exportCSV(preview.rows, fn);
              }}>⬇ CSV</button>
              <button style={btnSm('#dc2626')} onClick={async () => {
                const fn = `${preview.type}_${filter.date_from}_${filter.date_to}`;
                await exportPDF(preview.rows, labelFor(preview.type), fn);
              }}>⬇ PDF</button>
              <button style={{ ...btnSm('#374151'), background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)' }} onClick={() => setPreview(null)}>✕</button>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  {preview.cols.map(c => (
                    <th key={c} style={{ padding: '6px 8px', textAlign: 'left', background: 'var(--bg2)', borderBottom: '2px solid var(--border)', color: 'var(--text)', fontWeight: 700, whiteSpace: 'nowrap', fontSize: 11 }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 50).map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 ? 'var(--bg2)' : 'transparent' }}>
                    {preview.cols.map(c => (
                      <td key={c} style={{ padding: '5px 8px', color: 'var(--text)', whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {String(row[c] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.rows.length > 50 && (
              <div style={{ textAlign: 'center', padding: 10, fontSize: 12, color: 'var(--muted)' }}>
                แสดง 50 แถวแรก จาก {preview.rows.length} แถว — Export CSV/PDF เพื่อดูทั้งหมด
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SETUP TAB
═══════════════════════════════════════════════════════════════ */
function SetupTab({ role }) {
  const [subTab, setSubTab] = useState('downtime');
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, background: 'var(--bg2)', borderRadius: 8, padding: 4, marginBottom: 20, width: 'fit-content', flexWrap: 'wrap' }}>
        {[
          { key: 'downtime',  label: '⏱ ประเภท Downtime' },
          { key: 'defects',   label: '🔴 ประเภทงานเสีย' },
          { key: 'breaks',    label: '☕ นโยบายหยุดพัก' },
        ].map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: subTab === t.key ? 'var(--accent)' : 'transparent',
              color: subTab === t.key ? '#fff' : 'var(--muted)' }}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
        ⚙️ การเพิ่ม/แก้ไขเครื่องจักรของไลน์ ย้ายไปอยู่ที่หน้า <b>ตั้งค่าผังไลน์ → เครื่องจักร</b> แล้ว
      </div>
      {subTab === 'downtime' && <DowntimeTypeSetup role={role} />}
      {subTab === 'defects'  && <DefectTypeSetup role={role} />}
      {subTab === 'breaks'   && <BreakPolicySetup role={role} />}
    </div>
  );
}

/* ── Defect Type Setup ── */
function DefectTypeSetup({ role }) {
  const canEdit = can('daily_report', 'setup', role);
  const [items, setItems]     = useState([]);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving]   = useState(false);
  const emptyForm = { name_th: '', color: '#ef4444', process_type: '', sort_order: 0, is_active: true };
  const [form, setForm]       = useState(emptyForm);

  const load = useCallback(async () => {
    const { data } = await supabaseDR.from('dr_defect_types').select('*').order('sort_order');
    setItems(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openEdit = (item = null) => {
    setEditing(item?.id || 'new');
    setForm(item
      ? { name_th: item.name_th, color: item.color, process_type: item.process_type || '', sort_order: item.sort_order, is_active: item.is_active }
      : { ...emptyForm, sort_order: items.length + 1 });
  };

  const handleSave = async () => {
    if (!form.name_th) { toast.error('กรอกชื่อประเภท'); return; }
    setSaving(true);
    const payload = { ...form, process_type: form.process_type || null, sort_order: parseInt(form.sort_order) || 0 };
    const { error } = editing === 'new'
      ? await supabaseDR.from('dr_defect_types').insert(payload)
      : await supabaseDR.from('dr_defect_types').update(payload).eq('id', editing);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('บันทึกสำเร็จ');
    setEditing(null);
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('ลบประเภทนี้?')) return;
    const { error } = await supabaseDR.from('dr_defect_types').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>{items.length} ประเภท</div>
        {canEdit && <button onClick={() => openEdit()} style={saveBtnStyle}>+ เพิ่มประเภทงานเสีย</button>}
      </div>

      <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#f87171' }}>
        🔴 ประเภทงานเสียนี้จะใช้เมื่อกด <strong>บันทึกงานเสีย</strong> ในหน้า Live — แยกจาก Downtime เพื่อให้ติดตามคุณภาพได้ละเอียด
      </div>

      {items.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีประเภทงานเสีย</div>}

      {[
        { key: 'welding_assembly', label: '🔥 Welding / Assembly', color: '#f97316' },
        { key: 'metal_forming',   label: '⚙ Metal Forming',       color: '#3b82f6' },
        { key: 'common',          label: '🔗 Common (ทุกกระบวนการ)', color: '#6b7280' },
        { key: null,              label: '❔ ยังไม่กำหนดกระบวนการ',   color: '#9ca3af' },
      ].map(pg => {
        const pgItems = items.filter(i => (i.process_type || null) === pg.key);
        if (pgItems.length === 0) return null;
        return (
          <div key={pg.key || 'none'} style={{ marginBottom: 16, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '8px 14px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: pg.color }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{pg.label}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>{pgItems.length} รายการ</span>
            </div>
            <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {pgItems.map(item => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 9, borderLeft: `4px solid ${item.color}`, opacity: item.is_active ? 1 : 0.45 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{item.name_th}</div>
                    {!item.is_active && <div style={{ fontSize: 11, color: '#ef4444' }}>(ปิดใช้)</div>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>#{item.sort_order}</div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => openEdit(item)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>
                      <button onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 15 }}>✕</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {editing && (
        <div className="overlay" style={{ zIndex: 2000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(95vw,380px)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 20, color: 'var(--text)' }}>
              {editing === 'new' ? '+ เพิ่มประเภทงานเสีย' : 'แก้ไขประเภทงานเสีย'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="ชื่อประเภท *">
                <input autoFocus value={form.name_th} onChange={e => setForm(f => ({ ...f, name_th: e.target.value }))} placeholder="เช่น มิติไม่ได้" style={inputStyle} />
              </Field>
              <Field label="กระบวนการ">
                <select value={form.process_type} onChange={e => setForm(f => ({ ...f, process_type: e.target.value }))} style={inputStyle}>
                  <option value="">❔ ยังไม่กำหนด (แสดงทุกไลน์)</option>
                  <option value="welding_assembly">🔥 Welding / Assembly</option>
                  <option value="metal_forming">⚙ Metal Forming</option>
                  <option value="common">🔗 Common (ทุกกระบวนการ)</option>
                </select>
              </Field>
              <Field label="สี">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                    style={{ width: 44, height: 36, borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', background: 'none' }} />
                  <input value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} placeholder="#ef4444" style={{ ...inputStyle, flex: 1 }} />
                </div>
              </Field>
              <Field label="ลำดับ">
                <input type="number" min="0" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} style={inputStyle} />
              </Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                <span style={{ fontSize: 13, color: 'var(--text)' }}>ใช้งานอยู่</span>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditing(null)} style={cancelBtnStyle}>ยกเลิก</button>
              <button onClick={handleSave} disabled={saving} style={{ ...saveBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? '...' : 'บันทึก'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Break Policy Setup ── */
function BreakPolicySetup({ role }) {
  const canEdit = can('daily_report', 'setup', role);
  const [items, setItems]   = useState([]);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const emptyForm = { name_th: '', name_en: '', shift: 'both', start_time: '08:00', duration_min: 10, process_type: 'common', sort_order: 0, is_active: true };
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    const { data } = await supabaseDR.from('break_policies').select('*').order('sort_order');
    setItems(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openEdit = (item = null) => {
    setEditing(item?.id || 'new');
    setForm(item
      ? { name_th: item.name_th, name_en: item.name_en || '', shift: item.shift, start_time: (item.start_time || '08:00').slice(0,5), duration_min: item.duration_min, process_type: item.process_type, sort_order: item.sort_order, is_active: item.is_active }
      : { ...emptyForm, sort_order: items.length + 1 });
  };

  const handleSave = async () => {
    if (!form.name_th) { toast.error('กรอกชื่อ'); return; }
    if (!form.duration_min || form.duration_min < 1) { toast.error('ระยะเวลาต้องมากกว่า 0'); return; }
    setSaving(true);
    const payload = { ...form, duration_min: parseInt(form.duration_min), sort_order: parseInt(form.sort_order) || 0, updated_at: new Date().toISOString() };
    const { error } = editing === 'new'
      ? await supabaseDR.from('break_policies').insert(payload)
      : await supabaseDR.from('break_policies').update(payload).eq('id', editing);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('บันทึกสำเร็จ');
    setEditing(null);
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('ลบนโยบายนี้?')) return;
    const { error } = await supabaseDR.from('break_policies').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const SHIFT_LABEL = { day: '☀️ กะเช้า', night: '🌙 กะดึก', both: '⏰ ทั้งสองกะ' };
  const PROC_LABEL  = { welding_assembly: '🔥 Welding/Assembly', metal_forming: '⚙ Metal Forming', common: '🔗 ทุกกระบวนการ' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>{items.length} นโยบาย</div>
        {canEdit && <button onClick={() => openEdit()} style={saveBtnStyle}>+ เพิ่มนโยบาย</button>}
      </div>

      <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#34d399' }}>
        ☕ นโยบายหยุดพักเหล่านี้จะถูก<strong>หักออกจากเวลากะอัตโนมัติ</strong>เมื่อคำนวณ OEE — ช่วยให้ค่า Availability สะท้อนเวลาทำงานจริง ไม่รวมเวลาพักที่วางแผนไว้
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีนโยบาย</div>}
        {items.map(item => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 9, opacity: item.is_active ? 1 : 0.45 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{item.name_th}</span>
                {item.name_en && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{item.name_en}</span>}
                <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, background: 'rgba(245,158,11,0.15)', color: '#f59e0b', fontWeight: 700 }}>{SHIFT_LABEL[item.shift]}</span>
                <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, background: 'rgba(99,102,241,0.15)', color: '#a78bfa', fontWeight: 700 }}>{PROC_LABEL[item.process_type]}</span>
                {!item.is_active && <span style={{ fontSize: 11, color: '#ef4444' }}>(ปิดใช้)</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                เริ่ม {(item.start_time || '').slice(0,5)} น. · <strong style={{ color: '#22c55e' }}>{item.duration_min} นาที</strong>
              </div>
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => openEdit(item)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>
                <button onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 15 }}>✕</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <div className="overlay" style={{ zIndex: 2000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(95vw,440px)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 20, color: 'var(--text)' }}>
              {editing === 'new' ? '+ เพิ่มนโยบายหยุดพัก' : 'แก้ไขนโยบาย'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="ชื่อภาษาไทย *"><input autoFocus value={form.name_th} onChange={e => setForm(f => ({ ...f, name_th: e.target.value }))} placeholder="เช่น พักกินข้าว" style={inputStyle} /></Field>
              <Field label="ชื่อภาษาอังกฤษ"><input value={form.name_en} onChange={e => setForm(f => ({ ...f, name_en: e.target.value }))} placeholder="เช่น Lunch Break" style={inputStyle} /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="เวลาเริ่ม (HH:MM)">
                  <TimeInput24 value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} style={{ fontSize: 16 }} />
                </Field>
                <Field label="ระยะเวลา (นาที)">
                  <input type="number" min="1" value={form.duration_min} onChange={e => setForm(f => ({ ...f, duration_min: e.target.value }))} style={{ ...inputStyle, fontWeight: 800, fontSize: 16, textAlign: 'center' }} />
                </Field>
              </div>
              <Field label="ใช้กับกะ">
                <select value={form.shift} onChange={e => setForm(f => ({ ...f, shift: e.target.value }))} style={inputStyle}>
                  <option value="both">⏰ ทั้งสองกะ</option>
                  <option value="day">☀️ กะเช้าเท่านั้น</option>
                  <option value="night">🌙 กะดึกเท่านั้น</option>
                </select>
              </Field>
              <Field label="ใช้กับกระบวนการ">
                <select value={form.process_type} onChange={e => setForm(f => ({ ...f, process_type: e.target.value }))} style={inputStyle}>
                  <option value="common">🔗 ทุกกระบวนการ</option>
                  <option value="welding_assembly">🔥 Welding / Assembly เท่านั้น</option>
                  <option value="metal_forming">⚙ Metal Forming เท่านั้น</option>
                </select>
              </Field>
              <Field label="ลำดับ">
                <input type="number" min="0" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} style={inputStyle} />
              </Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                <span style={{ fontSize: 13, color: 'var(--text)' }}>ใช้งานอยู่</span>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditing(null)} style={cancelBtnStyle}>ยกเลิก</button>
              <button onClick={handleSave} disabled={saving} style={{ ...saveBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? '...' : 'บันทึก'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Product Setup (includes inline Kanban Standards) ── */
function ProductSetup({ role }) {
  const [items, setItems]     = useState([]);
  const [lines, setLines]     = useState([]);
  const [editing, setEditing] = useState(null);   // product id | 'new'
  const [ecSource, setEcSource] = useState(null); // product being EC'd
  const [form, setForm]       = useState({});
  const [saving, setSaving]   = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [familyTotals, setFamilyTotals] = useState({});
  // kanban state
  const [kanbanStds, setKanbanStds]       = useState([]);   // all kanban_standards
  const [kanbanEditing, setKanbanEditing] = useState(null); // std id | 'new'
  const [kanbanForm, setKanbanForm]       = useState({ product_id: '', mat_no: '', qty_per_kanban: 1, is_active: true });
  const [kanbanSaving, setKanbanSaving]   = useState(false);
  const [expandedFamilies, setExpandedFamilies] = useState({}); // family_id → bool

  const blankForm = () => ({ name: '', code: '', mat_no: '', p_no: '', customer: '', line_name: '', cycle_time_sec: '', target_per_shift: '', process_type: 'welding_assembly', is_active: true, effective_from: '' });

  const load = useCallback(async () => {
    const [{ data: pr }, { data: ln }, { data: stds }] = await Promise.all([
      supabaseDR.from('dr_products').select('*').order('name').order('effective_from', { ascending: false }),
      supabase.from('production_lines').select('id, name').order('name'),
      supabaseDR.from('kanban_standards').select('*').order('mat_no'),
    ]);
    setItems(pr || []);
    setLines(ln || []);
    setKanbanStds(stds || []);

    // cumulative qty_ok per family across all sessions
    const { data: sessions } = await supabaseDR
      .from('production_sessions')
      .select('product_id, qty_ok, dr_products(family_id)');
    if (sessions) {
      const totals = {};
      sessions.forEach(s => {
        const fid = s.dr_products?.family_id;
        if (!fid) return;
        totals[fid] = (totals[fid] || 0) + (s.qty_ok || 0);
      });
      setFamilyTotals(totals);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = (item = null) => {
    setEcSource(null);
    setEditing(item?.id || 'new');
    setForm(item
      ? { name: item.name, code: item.code || '', mat_no: item.mat_no || '', p_no: item.p_no || '', customer: item.customer || '', line_name: item.line_name || '', cycle_time_sec: item.cycle_time_sec || '', target_per_shift: item.target_per_shift || '', process_type: item.process_type || 'welding_assembly', is_active: item.is_active, effective_from: item.effective_from || '' }
      : blankForm());
  };

  // Open EC modal: inherit everything from source, clear MAT/PNO for new revision
  const openEC = (item) => {
    setEcSource(item);
    setEditing('new');
    setForm({ name: item.name, code: item.code || '', mat_no: '', p_no: '', customer: item.customer || '', line_name: item.line_name || '', cycle_time_sec: item.cycle_time_sec || '', target_per_shift: item.target_per_shift || '', process_type: item.process_type || 'welding_assembly', is_active: true, effective_from: today() });
  };

  const handleSave = async () => {
    if (!form.name) { toast.error('กรอกชื่อสินค้า'); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      code: form.code.trim() || null,
      mat_no: form.mat_no.trim().toUpperCase() || null,
      p_no: form.p_no.trim() || null,
      customer: form.customer.trim() || null,
      line_name: form.line_name || null,
      cycle_time_sec: form.cycle_time_sec ? parseFloat(form.cycle_time_sec) : null,
      target_per_shift: form.target_per_shift ? parseInt(form.target_per_shift) : null,
      process_type: form.process_type || 'welding_assembly',
      is_active: form.is_active,
      effective_from: form.effective_from || null,
    };

    if (editing === 'new') {
      // If this is an EC, inherit family_id from source; otherwise new family
      if (ecSource) payload.family_id = ecSource.family_id;
      const { data: inserted, error } = await supabaseDR.from('dr_products').insert(payload).select().single();
      if (error) { setSaving(false); toast.error(error.message); return; }
      // Mark old product as superseded
      if (ecSource) {
        await supabaseDR.from('dr_products').update({
          is_active: false,
          superseded_at: form.effective_from || today(),
          superseded_by: inserted.id,
        }).eq('id', ecSource.id);
      }
    } else {
      const { error } = await supabaseDR.from('dr_products').update(payload).eq('id', editing);
      if (error) { setSaving(false); toast.error(error.message); return; }
    }

    setSaving(false);
    toast.success(ecSource ? '🔄 Engineering Change บันทึกสำเร็จ' : 'บันทึกสำเร็จ');
    setEditing(null);
    setEcSource(null);
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('ลบสินค้านี้?')) return;
    const { error } = await supabaseDR.from('dr_products').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const canEdit = can('daily_report', 'setup', role);

  // ── Kanban CRUD ──────────────────────────────────────────────
  const openKanbanEdit = (std = null, defaultProductId = '') => {
    setKanbanEditing(std?.id || 'new');
    setKanbanForm(std
      ? { product_id: std.product_id || '', mat_no: std.mat_no || '', qty_per_kanban: std.qty_per_kanban || 1, is_active: std.is_active }
      : { product_id: defaultProductId, mat_no: '', qty_per_kanban: 1, is_active: true });
  };

  const handleKanbanSave = async () => {
    if (!kanbanForm.mat_no.trim()) { toast.error('กรอก MAT.NO ก่อน'); return; }
    if (!kanbanForm.qty_per_kanban || Number(kanbanForm.qty_per_kanban) < 1) { toast.error('Qty ต้องมากกว่า 0'); return; }
    setKanbanSaving(true);
    const payload = {
      product_id: kanbanForm.product_id || null,
      mat_no: kanbanForm.mat_no.trim().toUpperCase(),
      qty_per_kanban: parseInt(kanbanForm.qty_per_kanban),
      is_active: kanbanForm.is_active,
    };
    const { error } = kanbanEditing === 'new'
      ? await supabaseDR.from('kanban_standards').insert(payload)
      : await supabaseDR.from('kanban_standards').update(payload).eq('id', kanbanEditing);
    setKanbanSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('บันทึกสำเร็จ');
    setKanbanEditing(null);
    load();
  };

  const handleKanbanDelete = async (id) => {
    if (!window.confirm('ลบ Kanban Standard นี้?')) return;
    const { error } = await supabaseDR.from('kanban_standards').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  // Group by family_id
  const families = [];
  const seen = new Set();
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name, 'th'));
  sorted.forEach(item => {
    if (!seen.has(item.family_id)) {
      seen.add(item.family_id);
      families.push({ family_id: item.family_id, members: [] });
    }
    families.find(f => f.family_id === item.family_id).members.push(item);
  });
  // Each family: sort by effective_from desc (latest first)
  families.forEach(f => f.members.sort((a, b) => (b.effective_from || '0000') > (a.effective_from || '0000') ? 1 : -1));

  const visibleFamilies = showHistory ? families : families.filter(f => f.members.some(m => m.is_active));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>{families.length} รายการ ({items.filter(i => i.is_active).length} ใช้งาน)</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--muted)' }}>
            <input type="checkbox" checked={showHistory} onChange={e => setShowHistory(e.target.checked)} />
            แสดงประวัติ EC
          </label>
        </div>
        {canEdit && <button onClick={() => openEdit()} style={saveBtnStyle}>+ เพิ่มสินค้า</button>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {visibleFamilies.map(({ family_id, members }) => {
          const active   = members.find(m => m.is_active && !m.superseded_by);
          const archived = members.filter(m => !m.is_active || m.superseded_by);
          const totalQty = familyTotals[family_id] || 0;
          const item = active || members[0];
          return (
            <div key={family_id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              {/* Active revision header */}
              <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{item.name}</div>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                      background: item.process_type === 'metal_forming' ? 'rgba(251,191,36,0.15)' : 'rgba(34,197,94,0.12)',
                      color: item.process_type === 'metal_forming' ? '#fbbf24' : '#22c55e' }}>
                      {item.process_type === 'metal_forming' ? '⚙ Metal Forming' : '🔥 Welding/Assy'}
                    </span>
                    {members.length > 1 && (
                      <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, background: 'rgba(168,85,247,0.12)', color: '#a855f7', fontWeight: 700 }}>
                        🔄 {members.length} revisions
                      </span>
                    )}
                    {!active && <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, background: 'rgba(107,114,128,0.15)', color: '#6b7280', fontWeight: 700 }}>ปิดใช้งาน</span>}
                  </div>

                  {/* Current MAT.NO / P.NO */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
                    {item.mat_no && <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: '#0ea5e9' }}>{item.mat_no}</span>}
                    {item.p_no   && <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text2)' }}>P.NO: {item.p_no}</span>}
                    {item.customer && <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: 'rgba(59,130,246,0.1)', color: '#60a5fa' }}>{item.customer}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {item.line_name && `📍 ${item.line_name}`}
                    {item.cycle_time_sec && ` · CT ${item.cycle_time_sec}s`}
                    {item.target_per_shift && ` · Target ${item.target_per_shift}/กะ`}
                    {item.effective_from && ` · ใช้ตั้งแต่ ${item.effective_from}`}
                  </div>

                  {/* Family cumulative total */}
                  {totalQty > 0 && (
                    <div style={{ marginTop: 6, fontSize: 12, color: '#22c55e', fontWeight: 700 }}>
                      📦 ยอดสะสมทั้ง family: {totalQty.toLocaleString()} ชิ้น
                    </div>
                  )}
                </div>

                {canEdit && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {active && (
                      <button onClick={() => openEC(active)} title="Engineering Change — สร้าง revision ใหม่" style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: '#a855f7', fontWeight: 700 }}>🔄 EC</button>
                    )}
                    <button onClick={() => openEdit(item)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>
                    <button onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}>✕</button>
                  </div>
                )}
              </div>

              {/* Revision history (archived) */}
              {showHistory && archived.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg2)', padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 2 }}>📋 ประวัติ Revision</div>
                  {archived.map(rev => (
                    <div key={rev.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, color: 'var(--muted)', opacity: 0.75 }}>
                      <span style={{ fontFamily: 'monospace', color: '#64748b' }}>{rev.mat_no || '—'}</span>
                      {rev.p_no && <span style={{ color: '#475569' }}>P.NO: {rev.p_no}</span>}
                      <span style={{ color: '#374151' }}>{rev.effective_from || '?'} → {rev.superseded_at || '?'}</span>
                      <span style={{ fontSize: 11, padding: '1px 5px', borderRadius: 10, background: 'rgba(107,114,128,0.15)', color: '#6b7280' }}>superseded</span>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Kanban Standards (inline) ── */}
              {(() => {
                const familyProductIds = new Set(members.map(m => m.id));
                const stds = kanbanStds.filter(s => s.product_id && familyProductIds.has(s.product_id));
                const isExpanded = expandedFamilies[family_id] !== false; // default open
                return (
                  <div style={{ borderTop: '1px solid var(--border)' }}>
                    <button
                      onClick={() => setExpandedFamilies(prev => ({ ...prev, [family_id]: !isExpanded }))}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: 'var(--bg2)', border: 'none', cursor: 'pointer', color: 'var(--text2)', fontSize: 12, fontWeight: 700 }}>
                      <span>📦 Kanban Standards ({stds.length})</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{isExpanded ? '▲' : '▼'}</span>
                    </button>
                    {isExpanded && (
                      <div style={{ padding: '8px 12px', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {stds.length === 0 && (
                          <div style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 4px' }}>ยังไม่มี Kanban Standard</div>
                        )}
                        {stds.map(std => {
                          const linkedProd = members.find(m => m.id === std.product_id);
                          const isOldRev = linkedProd && !linkedProd.is_active;
                          return (
                            <div key={std.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 7, opacity: std.is_active ? 1 : 0.5 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'monospace', color: isOldRev ? 'var(--muted)' : '#0ea5e9' }}>{std.mat_no}</span>
                                  {isOldRev && <span style={{ fontSize: 11, padding: '1px 5px', borderRadius: 10, background: 'rgba(107,114,128,0.12)', color: '#6b7280' }}>rev เก่า</span>}
                                  {!std.is_active && <span style={{ fontSize: 11, color: '#ef4444' }}>ปิด</span>}
                                </div>
                              </div>
                              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                <span style={{ fontSize: 18, fontWeight: 900, color: '#0ea5e9', lineHeight: 1 }}>{std.qty_per_kanban}</span>
                                <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 3 }}>ชิ้น/ใบ</span>
                              </div>
                              {canEdit && (
                                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                  <button onClick={() => openKanbanEdit(std)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>
                                  <button onClick={() => handleKanbanDelete(std.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 13 }}>✕</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {canEdit && (
                          <button
                            onClick={() => openKanbanEdit(null, active?.id || members[0]?.id || '')}
                            style={{ alignSelf: 'flex-start', marginTop: 2, background: 'rgba(14,165,233,0.08)', border: '1px dashed rgba(14,165,233,0.4)', borderRadius: 6, padding: '4px 12px', fontSize: 11, color: '#0ea5e9', cursor: 'pointer', fontWeight: 700 }}>
                            + เพิ่ม MAT.NO
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* Add / Edit / EC modal */}
      {editing && (
        <div className="overlay" style={{ zIndex: 2000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: `1px solid ${ecSource ? 'rgba(168,85,247,0.5)' : 'var(--border2)'}`, borderRadius: 14, padding: 24, width: 'min(95vw,480px)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4, color: 'var(--text)' }}>
              {ecSource ? '🔄 Engineering Change' : editing === 'new' ? '+ เพิ่มสินค้า' : 'แก้ไขสินค้า'}
            </div>
            {ecSource && (
              <div style={{ fontSize: 12, color: '#a855f7', marginBottom: 16, padding: '8px 12px', background: 'rgba(168,85,247,0.08)', borderRadius: 8, border: '1px solid rgba(168,85,247,0.2)' }}>
                ต่อจาก: <strong>{ecSource.mat_no}</strong> {ecSource.p_no && `/ ${ecSource.p_no}`}<br/>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>MAT.NO เดิมจะถูก mark เป็น superseded อัตโนมัติ</span>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="ชื่อสินค้า / Model *"><input autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label={ecSource ? 'MAT.NO ใหม่ (SAP) *' : 'MAT.NO (SAP)'}>
                  <input value={form.mat_no} onChange={e => setForm(f => ({ ...f, mat_no: e.target.value.toUpperCase() }))} placeholder="เช่น 10100399" style={{ ...inputStyle, fontFamily: 'monospace', fontWeight: 700, borderColor: ecSource ? 'rgba(168,85,247,0.5)' : undefined }} />
                </Field>
                <Field label={ecSource ? 'P.NO ใหม่ *' : 'P.NO'}>
                  <input value={form.p_no} onChange={e => setForm(f => ({ ...f, p_no: e.target.value }))} placeholder="เช่น RC3B16E061BB" style={{ ...inputStyle, borderColor: ecSource ? 'rgba(168,85,247,0.5)' : undefined }} />
                </Field>
              </div>
              {ecSource && (
                <Field label="วันที่มีผล (effective_from) *">
                  <input type="date" value={form.effective_from} onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))} style={inputStyle} />
                </Field>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Customer"><input value={form.customer} onChange={e => setForm(f => ({ ...f, customer: e.target.value }))} placeholder="เช่น FORD" style={inputStyle} /></Field>
                <Field label="รหัสสินค้า (Code)"><input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="เช่น HDF-001" style={inputStyle} /></Field>
              </div>
              <Field label="ประเภทกระบวนการ *">
                <select value={form.process_type} onChange={e => setForm(f => ({ ...f, process_type: e.target.value }))} style={inputStyle}>
                  <option value="welding_assembly">🔥 Welding / Assembly</option>
                  <option value="metal_forming">⚙ Metal Forming</option>
                </select>
              </Field>
              <Field label="ไลน์ผลิตหลัก">
                <select value={form.line_name} onChange={e => setForm(f => ({ ...f, line_name: e.target.value }))} style={inputStyle}>
                  <option value="">ไม่ระบุ</option>
                  {lines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                </select>
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Cycle Time (วินาที)"><input type="number" min="0" step="0.1" value={form.cycle_time_sec} onChange={e => setForm(f => ({ ...f, cycle_time_sec: e.target.value }))} placeholder="เช่น 45.5" style={inputStyle} /></Field>
                <Field label="Target ต่อกะ (ชิ้น)"><input type="number" min="0" value={form.target_per_shift} onChange={e => setForm(f => ({ ...f, target_per_shift: e.target.value }))} placeholder="เช่น 500" style={inputStyle} /></Field>
              </div>
              {!ecSource && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                  <span style={{ fontSize: 13, color: 'var(--text)' }}>ใช้งานอยู่</span>
                </label>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => { setEditing(null); setEcSource(null); }} style={cancelBtnStyle}>ยกเลิก</button>
              <button onClick={handleSave} disabled={saving} style={{ ...saveBtnStyle, opacity: saving ? 0.6 : 1, background: ecSource ? '#7c3aed' : undefined }}>
                {saving ? '...' : ecSource ? '🔄 บันทึก EC' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Kanban Standard modal ── */}
      {kanbanEditing && (
        <div className="overlay" style={{ zIndex: 2100 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid rgba(14,165,233,0.4)', borderRadius: 14, padding: 24, width: 'min(95vw,380px)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 20, color: 'var(--text)' }}>
              {kanbanEditing === 'new' ? '+ เพิ่ม MAT.NO / Kanban Standard' : 'แก้ไข Kanban Standard'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="MAT.NO *">
                  <input autoFocus value={kanbanForm.mat_no} onChange={e => setKanbanForm(f => ({ ...f, mat_no: e.target.value.toUpperCase() }))}
                    placeholder="เช่น 10100335" style={{ ...inputStyle, fontFamily: 'monospace', fontWeight: 700 }} />
                </Field>
                <Field label="Qty / Kanban Card *">
                  <input type="number" min="1" value={kanbanForm.qty_per_kanban}
                    onChange={e => setKanbanForm(f => ({ ...f, qty_per_kanban: e.target.value }))}
                    style={{ ...inputStyle, fontSize: 18, fontWeight: 800, textAlign: 'center' }} />
                </Field>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={kanbanForm.is_active} onChange={e => setKanbanForm(f => ({ ...f, is_active: e.target.checked }))} />
                <span style={{ fontSize: 13, color: 'var(--text)' }}>ใช้งานอยู่</span>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => setKanbanEditing(null)} style={cancelBtnStyle}>ยกเลิก</button>
              <button onClick={handleKanbanSave} disabled={kanbanSaving || !kanbanForm.mat_no}
                style={{ ...saveBtnStyle, opacity: (kanbanSaving || !kanbanForm.mat_no) ? 0.5 : 1 }}>
                {kanbanSaving ? '...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Downtime Type Setup ── */
function DowntimeTypeSetup({ role }) {
  const [items, setItems]   = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm]     = useState({ name_th: '', name_en: '', category: 'unplanned', process_type: 'welding_assembly', color: '#ef4444', sort_order: 0, is_active: true });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabaseDR.from('dr_downtime_types').select('*').order('category').order('sort_order');
    setItems(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = (item = null) => {
    setEditing(item?.id || 'new');
    setForm(item
      ? { name_th: item.name_th, name_en: item.name_en || '', category: item.category, process_type: item.process_type || 'welding_assembly', color: item.color, sort_order: item.sort_order, is_active: item.is_active }
      : { name_th: '', name_en: '', category: 'unplanned', process_type: 'welding_assembly', color: '#ef4444', sort_order: items.length + 1, is_active: true });
  };

  const handleSave = async () => {
    if (!form.name_th) { toast.error('กรอกชื่อประเภท'); return; }
    setSaving(true);
    const { error } = editing === 'new'
      ? await supabaseDR.from('dr_downtime_types').insert(form)
      : await supabaseDR.from('dr_downtime_types').update(form).eq('id', editing);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('บันทึกสำเร็จ');
    setEditing(null);
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('ลบประเภทนี้?')) return;
    const { error } = await supabaseDR.from('dr_downtime_types').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const canEdit = can('daily_report', 'setup', role);

  const processGroups = [
    { key: 'welding_assembly', label: '🔥 Welding / Assembly', color: '#f97316' },
    { key: 'metal_forming',   label: '⚙ Metal Forming',       color: '#3b82f6' },
    { key: 'common',          label: '🔗 Common (ทุกประเภท)', color: '#6b7280' },
  ];

  function DowntimeRow({ item }) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, borderLeft: `4px solid ${item.color}`, opacity: item.is_active ? 1 : 0.5 }}>
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{item.name_th}</div>
          {item.name_en && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{item.name_en}</div>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', background: item.category === 'unplanned' ? 'rgba(239,68,68,0.12)' : 'rgba(59,130,246,0.12)', borderRadius: 4, padding: '2px 6px' }}>
          {item.category === 'unplanned' ? '⚠ นอกแผน' : '📋 ในแผน'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>#{item.sort_order}</div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => openEdit(item)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>
            <button onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}>✕</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, color: 'var(--muted)' }}>{items.length} ประเภท</div>
        {canEdit && <button onClick={() => openEdit()} style={saveBtnStyle}>+ เพิ่มประเภท</button>}
      </div>

      {processGroups.map(pg => {
        const pgItems = items.filter(i => i.process_type === pg.key);
        if (pgItems.length === 0) return null;
        const upItems = pgItems.filter(i => i.category === 'unplanned');
        const plItems = pgItems.filter(i => i.category === 'planned');
        return (
          <div key={pg.key} style={{ marginBottom: 24, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: pg.color }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{pg.label}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>{pgItems.length} รายการ</span>
            </div>
            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {upItems.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>⚠ นอกแผน ({upItems.length})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{upItems.map(i => <DowntimeRow key={i.id} item={i} />)}</div>
                </div>
              )}
              {plItems.length > 0 && (
                <div style={{ marginTop: upItems.length > 0 ? 10 : 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#3b82f6', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>📋 ในแผน ({plItems.length})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{plItems.map(i => <DowntimeRow key={i.id} item={i} />)}</div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {editing && (
        <div className="overlay" style={{ zIndex: 2000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(95vw,440px)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 20, color: 'var(--text)' }}>{editing === 'new' ? '+ เพิ่มประเภท Downtime' : 'แก้ไขประเภท'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="ชื่อไทย *"><input value={form.name_th} onChange={e => setForm(f => ({ ...f, name_th: e.target.value }))} style={inputStyle} /></Field>
              <Field label="ชื่ออังกฤษ"><input value={form.name_en} onChange={e => setForm(f => ({ ...f, name_en: e.target.value }))} style={inputStyle} /></Field>
              <Field label="กระบวนการ">
                <select value={form.process_type} onChange={e => setForm(f => ({ ...f, process_type: e.target.value }))} style={inputStyle}>
                  <option value="welding_assembly">🔥 Welding / Assembly</option>
                  <option value="metal_forming">⚙ Metal Forming</option>
                  <option value="common">🔗 Common (ทุกกระบวนการ)</option>
                </select>
              </Field>
              <Field label="หมวดหมู่">
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={inputStyle}>
                  <option value="unplanned">⚠ นอกแผน (Unplanned)</option>
                  <option value="planned">📋 ในแผน (Planned)</option>
                </select>
              </Field>
              <Field label="สี">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                    style={{ width: 44, height: 36, borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', background: 'none' }} />
                  <input value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} placeholder="#ef4444" style={{ ...inputStyle, flex: 1 }} />
                </div>
              </Field>
              <Field label="ลำดับ">
                <input type="number" min="0" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))} style={inputStyle} />
              </Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                <span style={{ fontSize: 13, color: 'var(--text)' }}>ใช้งานอยู่</span>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditing(null)} style={cancelBtnStyle}>ยกเลิก</button>
              <button onClick={handleSave} disabled={saving} style={{ ...saveBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? '...' : 'บันทึก'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── (KanbanStandardSetup merged into ProductSetup) ─── */
function _KanbanStandardSetup_REMOVED({ role }) {
  const [items, setItems]       = useState([]);
  const [products, setProducts] = useState([]);
  const [editing, setEditing]   = useState(null);
  const [form, setForm]         = useState({ product_id: '', mat_no: '', qty_per_kanban: 1, is_active: true });
  const [saving, setSaving]     = useState(false);
  const [search, setSearch]     = useState('');

  const load = useCallback(async () => {
    const [{ data: stds }, { data: prods }] = await Promise.all([
      supabaseDR.from('kanban_standards').select('*, dr_products(id,name,code,mat_no,p_no,customer)').order('mat_no'),
      supabaseDR.from('dr_products').select('id,name,code,mat_no,p_no,customer').eq('is_active', true).order('name'),
    ]);
    setItems(stds || []);
    setProducts(prods || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = (item = null) => {
    setEditing(item?.id || 'new');
    setForm(item
      ? { product_id: item.product_id || '', mat_no: item.mat_no || '', qty_per_kanban: item.qty_per_kanban, is_active: item.is_active }
      : { product_id: '', mat_no: '', qty_per_kanban: 1, is_active: true });
  };

  const handleProductChange = (productId) => {
    const prod = products.find(p => p.id === productId);
    setForm(f => ({
      ...f,
      product_id: productId,
      mat_no: prod?.mat_no || prod?.code || f.mat_no,
    }));
  };

  const handleSave = async () => {
    if (!form.mat_no) { toast.error('กรอก MAT.NO ก่อน'); return; }
    if (!form.qty_per_kanban || form.qty_per_kanban < 1) { toast.error('Qty/Kanban ต้องมากกว่า 0'); return; }
    setSaving(true);
    const payload = {
      product_id: form.product_id || null,
      mat_no: form.mat_no.trim().toUpperCase(),
      qty_per_kanban: parseInt(form.qty_per_kanban),
      is_active: form.is_active,
      updated_at: new Date().toISOString(),
    };
    const { error } = editing === 'new'
      ? await supabaseDR.from('kanban_standards').insert(payload)
      : await supabaseDR.from('kanban_standards').update(payload).eq('id', editing);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('บันทึกสำเร็จ');
    setEditing(null);
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('ลบ Standard นี้?')) return;
    const { error } = await supabaseDR.from('kanban_standards').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const canEdit = can('daily_report', 'setup', role);

  const getItemDisplay = (item) => {
    const prod = item.dr_products;
    return {
      name: prod?.name || item.part_name || '-',
      customer: prod?.customer || item.customer || '',
      pno: prod?.p_no || item.p_no || '',
      matno: item.mat_no,
    };
  };

  const filtered = items.filter(i => {
    if (!search) return true;
    const s = search.toLowerCase();
    const d = getItemDisplay(i);
    return (i.mat_no || '').toLowerCase().includes(s)
      || d.name.toLowerCase().includes(s)
      || d.customer.toLowerCase().includes(s);
  });

  const selectedProduct = products.find(p => p.id === form.product_id);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, flex: 1, minWidth: 200 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหา MAT.NO / ชื่อ / Customer..."
            style={{ ...inputStyle, maxWidth: 300 }} />
          <div style={{ fontSize: 13, color: 'var(--muted)', alignSelf: 'center', whiteSpace: 'nowrap' }}>{filtered.length} รายการ</div>
        </div>
        {canEdit && <button onClick={() => openEdit()} style={saveBtnStyle}>+ เพิ่ม Standard</button>}
      </div>

      <div style={{ background: 'rgba(14,165,233,0.1)', border: '1px solid rgba(14,165,233,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#38bdf8' }}>
        📌 ตั้งค่า Qty/Kanban ของแต่ละ MAT.NO ไว้ที่นี่ — เมื่อหัวหน้าเพิ่มเป้าหมาย ระบบจะดึงข้อมูลมาอัตโนมัติ ลด Human Error
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีข้อมูล</div>}
        {filtered.map(item => {
          const d = getItemDisplay(item);
          return (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 9, opacity: item.is_active ? 1 : 0.5 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', fontFamily: 'monospace' }}>{d.matno}</span>
                  {item.dr_products && (
                    <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: 'rgba(16,185,129,0.15)', color: '#34d399', fontWeight: 700 }}>🔗 linked</span>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{d.name}</span>
                  {d.customer && (
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'rgba(59,130,246,0.12)', color: '#60a5fa', fontWeight: 700 }}>{d.customer}</span>
                  )}
                  {!item.is_active && <span style={{ fontSize: 11, color: '#ef4444' }}>(ปิดใช้งาน)</span>}
                </div>
                {d.pno && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>P.NO: {d.pno}</div>}
              </div>
              <div style={{ textAlign: 'center', minWidth: 80 }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: '#0ea5e9', lineHeight: 1 }}>{item.qty_per_kanban}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>ชิ้น / Kanban</div>
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => openEdit(item)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>
                  <button onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 15 }}>✕</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editing && (
        <div className="overlay" style={{ zIndex: 2000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(95vw,460px)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 20, color: 'var(--text)' }}>
              {editing === 'new' ? '+ เพิ่ม Kanban Standard' : 'แก้ไข Kanban Standard'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="เชื่อมกับ Product (ไม่บังคับ)">
                <select value={form.product_id} onChange={e => handleProductChange(e.target.value)} style={inputStyle}>
                  <option value="">— ไม่ระบุ Product —</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name}{p.mat_no ? ` [${p.mat_no}]` : ''}{p.customer ? ` · ${p.customer}` : ''}</option>
                  ))}
                </select>
              </Field>
              {selectedProduct && (
                <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                  <div style={{ color: '#34d399', fontWeight: 700, marginBottom: 4 }}>🔗 Product ที่เชื่อมอยู่</div>
                  <div style={{ color: 'var(--text)' }}>{selectedProduct.name}</div>
                  {selectedProduct.mat_no && <div style={{ color: 'var(--muted)' }}>MAT.NO: {selectedProduct.mat_no}</div>}
                  {selectedProduct.p_no && <div style={{ color: 'var(--muted)' }}>P.NO: {selectedProduct.p_no}</div>}
                  {selectedProduct.customer && <div style={{ color: 'var(--muted)' }}>Customer: {selectedProduct.customer}</div>}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="MAT.NO *">
                  <input autoFocus value={form.mat_no} onChange={e => setForm(f => ({ ...f, mat_no: e.target.value }))}
                    placeholder="เช่น 10100335" style={{ ...inputStyle, fontFamily: 'monospace', fontWeight: 700 }} />
                </Field>
                <Field label="Qty / Kanban Card *">
                  <input type="number" min="1" value={form.qty_per_kanban} onChange={e => setForm(f => ({ ...f, qty_per_kanban: e.target.value }))}
                    style={{ ...inputStyle, fontSize: 18, fontWeight: 800, textAlign: 'center' }} />
                </Field>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                <span style={{ fontSize: 13, color: 'var(--text)' }}>ใช้งานอยู่</span>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditing(null)} style={cancelBtnStyle}>ยกเลิก</button>
              <button onClick={handleSave} disabled={saving || !form.mat_no || !form.qty_per_kanban}
                style={{ ...saveBtnStyle, opacity: (saving || !form.mat_no || !form.qty_per_kanban) ? 0.5 : 1 }}>
                {saving ? '...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Shared UI helpers ──────────────────────────────────────── */
function Field({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

// แสดงจำนวนหลักที่สแกน/พิมพ์เข้ามาจริง ไว้ดูประกอบเฉย ๆ — ไม่บังคับความยาว ไม่บล็อก
function ScanLenHint({ value }) {
  const v = (value || '').replace(/[\r\n\s]/g, '');
  if (!v) return null;
  return (
    <div style={{ marginTop: 5, fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>
      รับมา {v.length} หลัก
    </div>
  );
}

function Stat({ label, value, color, small }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: small ? 12 : 16, fontWeight: 800, color }}>{value ?? 0}</div>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
};
const saveBtnStyle = {
  background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8,
  padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
};
const cancelBtnStyle = {
  background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer',
};
