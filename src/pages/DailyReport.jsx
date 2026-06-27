import { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { fmtDate, fmtDateTime, fmtDateTimeFull, fmtTime } from '../utils/dateFormat';
import { toast } from '../components/Toast';
import tsLogoUrl from '../assets/TS logo.png';

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
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
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

  const canSetup = ['admin', 'manager', 'supervisor'].includes(role);

  return (
    <div style={{ padding: 'clamp(12px,3vw,28px)', maxWidth: 1200, margin: '0 auto' }}>
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
  const { fullName, section: userSection, lineId: userLineId } = useContext(UserContext);
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

  const [showOpen, setShowOpen] = useState(false);
  const [openForm, setOpenForm] = useState(() => { const s = currentShift(); return { work_date: today(), line_name: '', shift: s, product_id: '', start_time: shiftStart(s) }; });

  const [showDT, setShowDT]   = useState(false);
  const [dtForm, setDtForm]   = useState({ id: null, downtime_type_id: '', mode: 'start_end', start_time: '', end_time: '', duration_min: '', machine_no: '', mat_no: '', description: '' });
  const [savingDT, setSavingDT] = useState(false);

  // Prod Orders
  const [prodOrders, setProdOrders]       = useState([]);
  const [carryOrders, setCarryOrders]     = useState([]); // pending carry-over from prev session
  const [kanbanStds, setKanbanStds]       = useState([]);
  const [prodOrdersOpen, setProdOrdersOpen] = useState(true); // minimize/expand ทั้ง board
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
  // qty_actual produced this shift for each open order (before carry-over)
  const [carryQtyActual, setCarryQtyActual] = useState({});
  // เวลาหยุดผลิตจริงต่อออเดอร์ (ใช้แทนเวลาปิดกะรวมตอนคำนวณสรุปแยกตามชิ้นงาน เผื่อพาร์ทนี้หยุดไม่ตรงกับเวลาปิดกะ)
  const [carryStopTime, setCarryStopTime] = useState({});
  // แก้เวลาเริ่ม-หยุดจริงต่อ MAT.NO (เฉพาะ MAT.NO ที่ confirmed ครบแล้ว ไม่มีออเดอร์เปิดค้าง) — { [matNo]: { start, end } } เป็น "HH:MM"
  const [matTimeOverride, setMatTimeOverride] = useState({});

  const canManage        = ['admin', 'manager', 'supervisor'].includes(role);
  const canOpen          = ['admin', 'manager', 'supervisor', 'leader'].includes(role); // open new shift
  const canRequestClose  = ['admin', 'manager', 'supervisor', 'leader'].includes(role); // request or direct-close
  const canApproveClose  = ['admin', 'manager', 'supervisor'].includes(role);           // approve pending_close
  const canScan          = ['admin', 'manager', 'supervisor', 'leader'].includes(role);
  // leader แก้ไข/ลบ order, defect, downtime ได้เฉพาะตอนกะยังเปิดอยู่ (ยังไม่ส่งขออนุมัติปิดกะ) —
  // ถ้าส่งขอปิดกะแล้ว (pending_close) ต้องรอ SV อนุมัติ/ปฏิเสธก่อน ถ้าโดนปฏิเสธ สถานะจะกลับเป็น open ให้แก้ไขได้อีก
  const canEditRecords   = canManage || (role === 'leader' && selSession?.status === 'open');

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: ln }, { data: pr }, { data: dt }, { data: ks }, { data: bp }, { data: mc }, { data: dft }] = await Promise.all([
      supabase.from('production_lines').select('id, name, section').order('name'),
      supabaseDR.from('dr_products').select('*').eq('is_active', true).order('name'),
      supabaseDR.from('dr_downtime_types').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('kanban_standards').select('*, dr_products(id, name, line_name, cycle_time_sec, process_type)').eq('is_active', true).order('mat_no'),
      supabaseDR.from('break_policies').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('machines').select('*').eq('is_active', true).order('line_name').order('sort_order'),
      supabaseDR.from('dr_defect_types').select('*').eq('is_active', true).order('sort_order'),
    ]);

    const lm = {};
    (ln || []).forEach(l => { lm[l.name] = l; });
    setLines(ln || []);
    setLineMap(lm);
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
      if (myLine) sq = sq.eq('line_name', myLine.name);
    }

    let { data: ss } = await sq;
    if (role === 'supervisor' && userSection) {
      ss = (ss || []).filter(s => {
        const liveSection = lm[s.line_name]?.section;
        return normSection(liveSection) === normSection(userSection) || normSection(s.section) === normSection(userSection);
      });
    }

    // Check overdue: open/pending_close sessions from previous dates
    const { data: overdue } = await supabaseDR.from('production_sessions')
      .select('id, line_name, shift, work_date, section')
      .in('status', ['open', 'pending_close'])
      .lt('work_date', today());
    setOverdueAlert((overdue || []).filter(o => {
      if (role === 'admin' || role === 'manager') return true;
      if (role === 'supervisor') {
        if (!userSection) return true;
        const liveSection = lm[o.line_name]?.section;
        return normSection(liveSection) === normSection(userSection) || normSection(o.section) === normSection(userSection);
      }
      if (role === 'leader') {
        const myLine = (ln || []).find(l => l.id === userLineId);
        return myLine && o.line_name === myLine.name;
      }
      return false;
    }));

    setSessions(ss || []);
    if (ss?.length) {
      setSelSession(s => s?.id ? (ss.find(x => x.id === s.id) || ss[0]) : ss[0]);
    } else {
      setSelSession(null);
    }
    setLoading(false);
  }, [role, userSection, userLineId]);

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
    setShowOpen(false);
    setSessions(s => [data, ...s]);
    setSelSession(data);
    setDtLogs([]);
    setProdOrders([]);
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
  const dtOverlapMin = (startMs, endMs, pred = () => true) => {
    if (!startMs || !endMs || endMs <= startMs) return 0;
    return dtLogs.filter(pred).reduce((sum, d) => {
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

  // หาเวลา opened_at จริงของ order ย้อนหลัง — anchor กับ work_date ของกะนี้ และเลื่อนวันถัดไปถ้าเป็นกะดึกที่ข้ามเที่ยงคืน
  // (ไม่งั้นถ้าไม่ระบุเวลา DB จะ default เป็นเวลาปัจจุบัน ทำให้ Heijunka ขึ้นที่ "ตอนนี้" ไม่ใช่ตอนที่ผลิตจริง)
  const backfillOpenedAt = () => {
    if (!openProdForm.is_backfill || !openProdForm.backfill_time || !selSession) return null;
    const workDate = selSession.work_date;
    const [h, m] = openProdForm.backfill_time.split(':').map(Number);
    let d = new Date(`${workDate}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`);
    if (selSession.shift === 'night' && h < 8) d = new Date(d.getTime() + 86400000);
    return d.toISOString();
  };

  // เดาเวลาเริ่มผลิตจริงให้ตอนติ๊ก "ยิงย้อนหลัง" — ใบแรกของกะ = เวลาเริ่มกะ, ใบต่อไป = เวลาปิดจริง (confirmed_at)
  // ของใบก่อนหน้าถ้ามี ไม่งั้นประมาณด้วย CT (opened_at + qty/CT) เพื่อลดโอกาสเวลาซ้อนกันระหว่าง 2 ใบ
  const guessBackfillTime = () => {
    if (!selSession) return '';
    const prev = [...prodOrders].sort((a, b) => new Date(b.opened_at) - new Date(a.opened_at))[0];
    if (!prev) return (selSession.start_time || '').slice(0, 5);
    if (prev.confirmed_at) return new Date(prev.confirmed_at).toTimeString().slice(0, 5);
    const ctSec = ctForMatNo(prev.mat_no);
    if (ctSec > 0) {
      const estMs = new Date(prev.opened_at).getTime() + (prev.qty || 0) * ctSec * 1000;
      return new Date(estMs).toTimeString().slice(0, 5);
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
    const partnerMatNo = products.find(p => p.mat_no === matNo)?.pair_mat_no || null;
    let nextMatNo = openProdForm.mat_no;
    if (pendingPairId) {
      // นี่คือการสแกนคู่ RH/LH ใบที่สอง — ผูกกลับไปยังใบแรกที่รออยู่
      await supabaseDR.from('prod_orders').update({ paired_order_id: data.id }).eq('id', pendingPairId);
      await supabaseDR.from('prod_orders').update({ paired_order_id: pendingPairId }).eq('id', data.id);
      setPendingPairId(null);
      toast.success(`เปิด Order คู่ RH/LH พร้อมกัน ✓ (${prodNo})`);
    } else if (partnerMatNo) {
      const existingPartner = prodOrders.find(o => o.mat_no === partnerMatNo && o.status === 'open' && !o.paired_order_id);
      if (existingPartner) {
        await supabaseDR.from('prod_orders').update({ paired_order_id: data.id }).eq('id', existingPartner.id);
        await supabaseDR.from('prod_orders').update({ paired_order_id: existingPartner.id }).eq('id', data.id);
        toast.success(`เปิด Order ${prodNo} ✓ และผูกคู่กับ ${existingPartner.prod_no} (RH/LH) อัตโนมัติ`);
      } else {
        setPendingPairId(data.id);
        nextMatNo = partnerMatNo;
        toast.info(`เปิด ${prodNo} แล้ว — สแกน PROD.NO ของคู่ RH/LH (MAT.NO ${partnerMatNo}) ต่อได้เลย`);
      }
    } else {
      toast.success(`เปิด Order ${prodNo} · ${matNo} · ${qty} ชิ้น ✓`);
    }
    setOpenProdForm(f => ({ prod_no: '', mat_no: nextMatNo, qty: f.qty, is_backfill: false, backfill_time: '' }));
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

    // ── RH/LH auto pairing: ปิดคู่พร้อมกันถ้าผูกไว้และยังเปิดอยู่ ──
    let pairedClosedNo = null;
    if (match.paired_order_id) {
      const partner = prodOrders.find(o => o.id === match.paired_order_id && o.status === 'open');
      if (partner) {
        await supabaseDR.from('prod_orders').update({
          status:       'confirmed',
          confirmed_by: fullName,
          confirmed_at: new Date().toISOString(),
          qty_ok:       partner.qty,
        }).eq('id', partner.id);
        pairedClosedNo = partner.prod_no;
      }
    }
    setSavingProdClose(false);
    toast.success(pairedClosedNo
      ? `ปิด Order ${match.prod_no} และคู่ RH/LH ${pairedClosedNo} พร้อมกัน ✓`
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
      const workDate = selSession?.work_date || openedAt.toISOString().split('T')[0];
      const [ph, pm] = (p.start_time || '00:00').split(':').map(Number);
      let pStart = new Date(`${workDate}T${String(ph).padStart(2,'0')}:${String(pm).padStart(2,'0')}:00`);
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

  const computeOEE = (ngQtyOverride, endTimeOverride, startTimeOverride) => {
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
    const loggedPlannedDT  = dtLogs.filter(d => d.dr_downtime_types?.category === 'planned').reduce((s, d) => s + (d.duration_min || 0), 0);
    const loggedUnplannedDT = dtLogs.filter(d => d.dr_downtime_types?.category !== 'planned').reduce((s, d) => s + (d.duration_min || 0), 0);
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
      const matLoggedPlanned   = dtOverlapMin(matStartMs, matEndMs, d => d.dr_downtime_types?.category === 'planned');
      const matLoggedUnplanned = dtOverlapMin(matStartMs, matEndMs, d => d.dr_downtime_types?.category !== 'planned');
      const matNetAvail = Math.max(0, windowMin - matPolicyBreakMin - matLoggedPlanned);
      const matRunMin   = Math.max(0, matNetAvail - matLoggedUnplanned);
      totalNetAvailByMat += matNetAvail;
      totalRunMinByMat   += matRunMin;
    });
    // ถ้าแยกตาม MAT.NO ไม่ได้เลย (เช่นกะมีแต่ Downtime ไม่มี Order) ให้ fallback กลับไปใช้ช่วงเวลาทั้งกะแบบเดิม
    const A = totalNetAvailByMat > 0 ? Math.min(1, totalRunMinByMat / totalNetAvailByMat)
      : (netAvail > 0 ? Math.min(1, runMin / netAvail) : 0);

    // Performance: เทียบยอดผลิตจริงกับ "ควรได้ถ้าวิ่งเต็มเวลา" ของแต่ละ MAT.NO แยกกัน (ช่วงเวลาเปิด-ปิดของใบงานนั้นๆ หักด้วย
    // Downtime ที่ทับซ้อนช่วงนั้น) แล้วรวมยอด — ต้องแยกตาม MAT.NO เพราะไลน์ร่วม (เช่น APRON ASSY) อาจผลิตหลาย MAT.NO
    // พร้อมกันคนละสถานี ถ้ารวม producedMin ของทุก MAT.NO แล้วหารด้วย runMin เดียวของทั้งกะ จะนับเวลาซ้ำซ้อน ทำให้ P เพี้ยน
    // (เคยเจอ P ติดเพดาน 100% ทั้งที่ผลิตได้น้อยกว่าควรได้ของแต่ละ MAT.NO ตอนแยกดู)
    let knownQty = 0, unknownQty = 0, totalAchievable = 0;
    const matNosForP = Array.from(new Set(prodOrders.map(o => o.mat_no)));
    matNosForP.forEach(matNo => {
      const orders = prodOrders.filter(o => o.mat_no === matNo);
      const qty = orders.filter(o => o.status === 'confirmed').reduce((s, o) => s + o.qty, 0)
                + orders.filter(o => o.status === 'open').reduce((s, o) => s + (parseInt(carryQtyActual[o.id]) || 0), 0);
      if (!qty) return;
      const ctSec = ctForMatNo(matNo);
      if (ctSec <= 0) { unknownQty += qty; return; }
      const hasOpenOrders = orders.some(o => o.status === 'open');
      const openedTimes = orders.map(o => o.opened_at).filter(Boolean).map(t => new Date(t).getTime());
      const closedTimes = orders.filter(o => o.status === 'confirmed' && o.confirmed_at).map(o => new Date(o.confirmed_at).getTime());
      let startMs = openedTimes.length ? Math.min(...openedTimes) : (openedAt ? openedAt.getTime() : null);
      let endMs   = closedTimes.length ? Math.max(...closedTimes) : closedAt.getTime();
      ({ startMs, endMs } = applyMatTimeOverride(matNo, hasOpenOrders, startMs, endMs));
      if (startMs == null || endMs <= startMs) { unknownQty += qty; return; }
      const runWinMin = Math.max(0, (endMs - startMs) / 60000 - dtOverlapMin(startMs, endMs));
      totalAchievable += Math.floor(runWinMin * 60 / ctSec);
      knownQty += qty;
    });

    // ctSec ไม่รู้เลยสักใบ (ไม่มี Cycle Time ใน Product Master ของทุก MAT.NO ที่ผลิต) → P คำนวณไม่ได้จริง ห้าม default เป็น 100%
    const P = knownQty > 0 ? (totalAchievable > 0 ? Math.min(1, knownQty / totalAchievable) : 0) : null;
    const Q = totalProduced > 0 ? Math.max(0, (totalProduced - ngQty) / totalProduced) : 1;
    const oee = P != null ? A * P * Q : null;
    return { A, P, Q, oee, shiftMin, netAvail, runMin, policyBreakMin, plannedDT, totalProduced, ngQty, knownQty, unknownQty };
  };

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

    // Downtime ที่ยังไม่ระบุระยะเวลา (เริ่มไว้แต่ยังไม่กดปิด) ต้องปิดให้ครบก่อน
    // ไม่งั้นช่วงเวลานั้นจะไม่ถูกหักออกจาก Availability ตอนคำนวณ OEE (duration_min เป็น null = นับเป็น 0 นาที)
    const openDT = dtLogs.filter(d => d.duration_min == null);
    if (openDT.length > 0) {
      toast.error(`มี Downtime ${openDT.length} รายการที่ยังไม่ระบุระยะเวลา/เวลาสิ้นสุด กรุณาปิดให้ครบก่อนปิดกะ`);
      return;
    }

    // เตือนถ้ากะนี้ไม่มีข้อมูลการผลิตเลย — เผื่อพนักงานลืม Scan เปิด Order / บันทึก Downtime ก่อนปิดกะ
    if (prodOrders.length === 0 && dtLogs.length === 0) {
      if (!window.confirm('กะนี้ยังไม่มี Prod Order และไม่มี Downtime เลย — ยืนยันจะปิดกะหรือไม่?')) return;
    } else if (prodOrders.length === 0) {
      if (!window.confirm('กะนี้ยังไม่มี Prod Order เลย (มีแต่ Downtime) — ยืนยันจะปิดกะหรือไม่?')) return;
    }

    setSavingClose(true);

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

    const { A, P, Q, oee, shiftMin } = computeOEE(totalQtyNg + totalQtySuspect, closeEndTime, closeStartTime);
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

    // ── Auto-consume Line Stock ────────────────────────────────────────────
    // เมื่อปิดกะจริง (SV+ close โดยตรง) ให้หัก stock พาร์ทย่อยตาม BOM × qty_ok
    if (!isLeaderRequest && totalQtyOk > 0 && selSession.product_id) {
      const { data: bomItems } = await supabaseDR
        .from('bom_items').select('mat_no, part_name, qty_per_unit')
        .eq('product_id', selSession.product_id).eq('is_active', true);
      if (bomItems?.length) {
        const consumeRows = bomItems.map(b => ({
          line_name:      selSession.line_name,
          mat_no:         b.mat_no,
          part_name:      b.part_name,
          qty:            parseFloat((totalQtyOk * Number(b.qty_per_unit)).toFixed(4)),
          type:           'consume',
          ref_session_id: selSession.id,
          work_date:      selSession.work_date,
          note:           `Auto: close กะ ${selSession.shift === 'day' ? 'เช้า' : 'ดึก'} qty_ok=${totalQtyOk}`,
          created_by:     fullName,
        }));
        await supabaseDR.from('line_stock_transactions').insert(consumeRows);
      }
    }
    // ────────────────────────────────────────────────────────────────────────

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
    });
    setShowCloseShift(false);
    setCarryOverDecisions({});
    setCarryQtyActual({});
    setCarryStopTime({});
    setMatTimeOverride({});
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

    // Auto-consume เมื่อ SV approve close
    const qtyOk = selSession.qty_ok || 0;
    if (qtyOk > 0 && selSession.product_id) {
      const { data: bomItems } = await supabaseDR
        .from('bom_items').select('mat_no, part_name, qty_per_unit')
        .eq('product_id', selSession.product_id).eq('is_active', true);
      if (bomItems?.length) {
        await supabaseDR.from('line_stock_transactions').insert(
          bomItems.map(b => ({
            line_name: selSession.line_name, mat_no: b.mat_no, part_name: b.part_name,
            qty: parseFloat((qtyOk * Number(b.qty_per_unit)).toFixed(4)),
            type: 'consume', ref_session_id: selSession.id,
            work_date: selSession.work_date,
            note: `Auto: SV อนุมัติปิดกะ qty_ok=${qtyOk}`, created_by: fullName,
          }))
        );
      }
    }

    toast.success(`อนุมัติปิดกะแล้ว ✓ (ขอโดย ${selSession.close_requested_by_name || '—'})`);
    notifyProdClose({
      status: 'closed_approved', line_name: selSession.line_name, shift: selSession.shift,
      work_date: selSession.work_date, actor: fullName,
      requested_by: selSession.close_requested_by_name,
      qty_ok: selSession.qty_ok, qty_ng: selSession.qty_ng, oee: selSession.oee,
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

  const totalDT      = dtLogs.reduce((s, d) => s + (d.duration_min || 0), 0);
  const unplannedDT  = dtLogs.filter(d => d.dr_downtime_types?.category === 'unplanned').reduce((s, d) => s + (d.duration_min || 0), 0);

  if (loading) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>กำลังโหลด...</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: sessions.length > 1 ? '220px 1fr' : '1fr', gap: 16 }}>
      {sessions.length > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>กะที่เปิดอยู่</div>
          {sessions.map(s => (
            <button key={s.id} onClick={() => { setSelSession(s); }}
              style={{ padding: '10px 12px', borderRadius: 8, border: `2px solid ${selSession?.id === s.id ? 'var(--accent)' : 'var(--border)'}`,
                background: selSession?.id === s.id ? 'var(--accent-dim)' : 'var(--card)', cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{s.line_name}</div>
                {s.status === 'pending_close' && <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 10, background: 'rgba(245,158,11,0.2)', color: '#f59e0b' }}>⏳ รออนุมัติ</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.shift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก'} · {fmtDate(s.work_date)}</div>
            </button>
          ))}
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
            <div style={{ fontSize: 11, color: '#ef4444', marginTop: 6 }}>กรุณา SV ทำการปิดกะให้ครบก่อนเริ่มกะใหม่</div>
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
                      <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: 'rgba(245,158,11,0.15)', color: '#f59e0b', animation: 'pulse 2s infinite' }}>⏳ รออนุมัติปิดกะ</span>
                    ) : (
                      <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>● LIVE</span>
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
                  {canOpen && selSession.status === 'open' && (
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
                    <button onClick={() => { setCloseNg('0'); setCloseEndTime(guessCloseEndTime()); setCloseStartTime(selSession.start_time || ''); setShowCloseShift(true); }}
                      style={{ ...cancelBtnStyle, borderColor: '#ef4444', color: '#ef4444', fontWeight: 700 }}>
                      {role === 'leader' ? '📋 ขอปิดกะ' : '🔒 ปิดกะ'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Per-product breakdown — กะเดียวอาจผลิตหลาย MAT.NO จึงต้องแยกสรุปรายชิ้นงาน ไม่รวมเป็นก้อนเดียว */}
            {(() => {
              const totalTarget    = prodOrders.reduce((s, o) => s + o.qty, 0);
              const totalConfirmed = prodOrders.filter(o => o.status === 'confirmed').reduce((s, o) => s + o.qty, 0);
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
                const confirmed = orders.filter(o => o.status === 'confirmed').reduce((s, o) => s + o.qty, 0);
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
                  {productRows.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
                        🔩 แยกตามชิ้นงาน ({productRows.length} MAT.NO)
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {productRows.map(r => {
                          const rowClr = r.rowPct >= 100 ? '#22c55e' : r.rowPct >= 60 ? '#f59e0b' : '#4d9fff';
                          return (
                            <div key={r.matNo} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>{r.matNo}</span>
                                  {r.name && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{r.name}</span>}
                                  {r.ct > 0 && <span style={{ fontSize: 10, color: 'var(--muted)' }}>· CT {r.ct}s</span>}
                                  {r.actualStart && (
                                    <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 20, background: 'rgba(77,159,255,0.12)', color: '#4d9fff', fontWeight: 700 }}>
                                      🕐 {fmtTime(r.actualStart)}–{r.actualEnd ? fmtTime(r.actualEnd) : '...'}
                                    </span>
                                  )}
                                  <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 20, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', fontWeight: 700 }}>เปิด {r.openCnt}</span>
                                  <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 20, background: 'rgba(34,197,94,0.12)', color: '#22c55e', fontWeight: 700 }}>ปิด {r.closedCnt}</span>
                                  {r.ng > 0 && <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 20, background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontWeight: 700 }}>🔴 NG {r.ng}</span>}
                                  {r.dt > 0 && <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 20, background: 'rgba(168,85,247,0.12)', color: '#a855f7', fontWeight: 700 }}>⏱ {fmtMin(r.dt)}</span>}
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
                    </div>
                  )}

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
                        <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>{k.label}</div>
                        <div style={{ fontSize: k.small ? 13 : 22, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value ?? 0}</div>
                        {k.unit && <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>{k.unit}</div>}
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
                <div onClick={() => setProdOrdersOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--text)', cursor: 'pointer', userSelect: 'none' }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', transform: prodOrdersOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>▶</span>
                  📦 Prod Orders ({prodOrders.length} ใบ)
                </div>
                {canScan && prodOrdersOpen && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => { setShowScanOpen(true); setOpenProdForm({ prod_no: '', mat_no: '', qty: '' }); setOpenProdStd(null); }}
                      style={{ background: '#f59e0b', color: '#000', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                      📥 Scan เปิด Order
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
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{carryOrders.map(o => o.prod_no).join(', ')}</div>
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
                  const statusColor = confirmed ? '#22c55e' : carryOver ? '#a78bfa' : cancelled ? '#666' : '#f59e0b';
                  const statusLabel = confirmed ? '✓ ปิดแล้ว' : carryOver ? '➡ ยกยอด' : cancelled ? '✕ ยกเลิก' : '● ผลิต';
                  return (
                    <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: 'var(--bg2)', borderRadius: 8,
                      border: `1px solid ${statusColor}40`, borderLeft: `4px solid ${statusColor}`,
                      opacity: cancelled ? 0.45 : 1 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>{o.prod_no}</span>
                          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{o.mat_no}</span>
                          {o.part_name && <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {o.part_name}</span>}
                          {o.customer && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: 'rgba(59,130,246,0.12)', color: '#60a5fa', fontWeight: 700 }}>{o.customer}</span>}
                          {isCarried && (
                            <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: 'rgba(167,139,250,0.15)', color: '#a78bfa', fontWeight: 700 }}
                              title={o.carry_over_note || 'ยกยอดมาจากกะก่อน'}>
                              ➡ ยกยอดมา {o.carry_over_note ? `(${o.carry_over_note.match(/\d+\/\d+/)?.[0] || ''})` : ''}
                            </span>
                          )}
                          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 700, background: `${statusColor}20`, color: statusColor }}>
                            {statusLabel}
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                          เปิด {fmtTime(new Date(o.opened_at))} {o.opened_by && `· ${o.opened_by}`}
                          {confirmed && o.confirmed_at && ` · ปิด ${fmtTime(new Date(o.confirmed_at))} · ${o.confirmed_by}`}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 20, fontWeight: 900, color: statusColor, lineHeight: 1 }}>{o.qty}</div>
                        <div style={{ fontSize: 9, color: 'var(--muted)' }}>ชิ้น</div>
                      </div>
                      {/* ออเดอร์ที่ confirmed ห้ามลบเด็ดขาด (เป็นยอดผลิตจริงที่ปิดแล้ว) — ส่วนออเดอร์ที่ยกยอด (carry_over)
                          ปกติ leader แก้ไม่ได้แล้วเพราะตัดสินใจไปแล้วตอนปิดกะ แต่ถ้าตกค้างผิดปกติ (เช่นกะเก่าปิดไม่สำเร็จ)
                          SV/Manager/Admin ต้องลบแก้ไขได้เพื่อเคลียร์ข้อมูลค้าง ไม่งั้นจะไม่มีทางแก้เลย */}
                      {!confirmed && (canManage || (canEditRecords && !carryOver)) && (
                        <button onClick={() => handleDeleteProdOrder(o.id)}
                          style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}>✕</button>
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
                          <span style={{ fontSize: 10, transform: showClosedOrders ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>▶</span>
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
            {defectLogs.length > 0 && (
              <div style={{ background: 'var(--card)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>
                    🔴 บันทึกงานเสีย ({defectLogs.length} รายการ)
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>
                      NG: {defectLogs.reduce((s,d)=>s+(d.qty_ng||0),0)} · สงสัย: {defectLogs.reduce((s,d)=>s+(d.qty_suspect||0),0)} · ซ่อม: {defectLogs.reduce((s,d)=>s+(d.qty_repair||0),0)}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {defectLogs.map(d => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg2)', borderRadius: 8, borderLeft: `3px solid ${d.dr_defect_types?.color || '#ef4444'}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{d.dr_defect_types?.name_th || '—'}</span>
                          {d.prod_orders?.mat_no && (
                            <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: 'rgba(14,165,233,0.15)', color: '#0ea5e9', fontWeight: 700, fontFamily: 'monospace' }}>
                              {d.prod_orders.mat_no}
                            </span>
                          )}
                          {d.prod_orders?.prod_no && (
                            <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: 'rgba(74,222,128,0.1)', color: '#22c55e', fontWeight: 700, fontFamily: 'monospace' }}>
                              {d.prod_orders.prod_no}
                            </span>
                          )}
                          {d.qty_ng     > 0 && <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 700 }}>NG {d.qty_ng}</span>}
                          {d.qty_suspect > 0 && <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>สงสัย {d.qty_suspect}</span>}
                          {d.qty_repair  > 0 && <span style={{ fontSize: 11, color: '#a78bfa', fontWeight: 700 }}>ซ่อม {d.qty_repair}</span>}
                        </div>
                        {d.description && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{d.description}</div>}
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>
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
              </div>
            )}

            {/* Downtime list */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>⏱ Downtime ({dtLogs.length} รายการ)</div>
                <button onClick={() => { setShowDT(true); setDtForm({ id: null, downtime_type_id: '', mode: 'start_end', start_time: '', end_time: '', duration_min: '', machine_no: '', mat_no: '', description: '' }); }}
                  style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  + บันทึก Downtime
                </button>
              </div>
              {dtLogs.length === 0 && <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มี Downtime ในกะนี้</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {dtLogs.map(d => {
                  const cat = CAT_META[d.dr_downtime_types?.category] || CAT_META.unplanned;
                  return (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--bg2)', borderRadius: 8, borderLeft: `3px solid ${d.dr_downtime_types?.color || '#aaa'}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: cat.bg, color: cat.color }}>{cat.label}</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{d.dr_downtime_types?.name_th || '—'}</span>
                          {d.machine_no && <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {d.machine_no}</span>}
                          {d.mat_no && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: 'rgba(14,165,233,0.15)', color: '#0ea5e9' }}>{d.mat_no}</span>}
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
            </div>
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
                    {lines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
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
          return (
            <div className="overlay" style={{ zIndex: 2100 }}>
              <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '2px solid rgba(245,158,11,0.5)', borderRadius: 14, padding: 24, width: 'min(95vw,820px)', maxHeight: '90vh', overflowY: 'auto' }}>
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
                      <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>{k.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.value}</div>
                    </div>
                  ))}
                </div>

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
                                  <div style={{ fontSize: 10, color: '#4d9fff', marginTop: 1 }}>🕐 {fmtTime(r.actualStart)}–{r.actualEnd ? fmtTime(r.actualEnd) : '...'}</div>
                                )}
                              </div>
                              <div style={{ textAlign: 'center', minWidth: 40 }}>
                                <div style={{ fontSize: 9, color: 'var(--muted)' }}>NG</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: r.ng > 0 ? '#ef4444' : 'var(--muted)' }}>{r.ng}</div>
                              </div>
                              <div style={{ textAlign: 'center', minWidth: 60 }}>
                                <div style={{ fontSize: 9, color: 'var(--muted)' }}>Downtime</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: r.dt > 0 ? '#f59e0b' : 'var(--muted)' }}>{fmtMin(Math.round(r.dt))}</div>
                              </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
                              <div style={{ textAlign: 'center', padding: '4px 0', background: 'var(--bg2)', borderRadius: 6 }}>
                                <div style={{ fontSize: 9, color: 'var(--muted)' }}>เป้าหมาย</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{r.target}</div>
                              </div>
                              <div style={{ textAlign: 'center', padding: '4px 0', background: 'rgba(168,85,247,0.1)', borderRadius: 6 }}>
                                <div style={{ fontSize: 9, color: 'var(--muted)' }}>ควรได้ (เต็มเวลา)</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: '#a78bfa' }}>{r.achievable != null ? r.achievable : '—'}</div>
                              </div>
                              <div style={{ textAlign: 'center', padding: '4px 0', background: 'rgba(34,197,94,0.1)', borderRadius: 6 }}>
                                <div style={{ fontSize: 9, color: 'var(--muted)' }}>ผลิตได้จริง</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: '#22c55e' }}>{r.qty}</div>
                              </div>
                            </div>
                            {r.achievable > 0 && (
                              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, textAlign: 'right' }}>
                                %P พาร์ทนี้ ≈ {Math.min(100, Math.round(r.qty / r.achievable * 100))}%
                              </div>
                            )}
                            {r.overCt && r.observedCtSec != null && (
                              <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 4, padding: '4px 6px', background: 'rgba(245,158,11,0.1)', borderRadius: 6 }}>
                                ⚠ ผลิตเกิน CT ที่ตั้งไว้ ({r.ctSec} วิ) — CT จริงที่สังเกตได้กะนี้ ≈ {r.observedCtSec.toFixed(1)} วิ/ชิ้น
                              </div>
                            )}
                            {overage && overage.overCount >= 3 && (
                              <div style={{ fontSize: 10, color: '#ef4444', marginTop: 4, padding: '4px 6px', background: 'rgba(239,68,68,0.1)', borderRadius: 6, fontWeight: 700 }}>
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

                {/* Timeline: machine run / policy break / planned-unplanned downtime — รายละเอียดของ %A, ใช้เวลาเริ่ม-ปิดกะที่บันทึกไว้แล้ว */}
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
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--muted)', marginTop: 3 }}>
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
                          <div key={k.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--muted)' }}>
                            <span style={{ width: 9, height: 9, borderRadius: 2, background: k.color, display: 'inline-block' }} />
                            {k.label}
                          </div>
                        ))}
                      </div>
                      {dtLogs.some(d => !d.started_at) && (
                        <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 6 }}>⚠ มี Downtime บางรายการไม่ได้ระบุเวลาเริ่ม/จบ จึงไม่แสดงในไทม์ไลน์ (นับรวมในยอด Downtime ด้านบนแล้ว)</div>
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
          const { A, P, Q, oee, shiftMin, netAvail, runMin, policyBreakMin, totalProduced, knownQty, unknownQty } = computeOEE(ng, closeEndTime, closeStartTime);
          const oeeColor = oee == null ? 'var(--muted)' : oee >= 0.85 ? '#22c55e' : oee >= 0.65 ? '#f59e0b' : '#ef4444';
          return (
            <div className="overlay" style={{ zIndex: 2000 }}>
              <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '2px solid rgba(239,68,68,0.4)', borderRadius: 14, padding: 24, width: 'min(95vw,820px)', maxHeight: '90vh', overflowY: 'auto' }}>
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

                {/* Summary stats — แยกหยุดในแผน(เพิ่มเติมจากนโยบาย)/นอกแผนออกจากกัน ให้บวกกันแล้วเท่ากับเวลากะเป๊ะๆ
                    (เวลากะ = หยุดนโยบาย + หยุดในแผน + หยุดนอกแผน + Run Time) ไม่งั้นจะดูเหมือนเวลารวมเกิน 12 ชม. */}
                {(() => {
                  const loggedPlannedDT   = dtLogs.filter(d => d.dr_downtime_types?.category === 'planned').reduce((s, d) => s + (d.duration_min || 0), 0);
                  const loggedUnplannedDT = totalDT - loggedPlannedDT;
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
                          <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>{k.label}</div>
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

                {/* Per-product breakdown — separates shared lines (e.g. APRON ASSY) that run multiple MAT.NO at once */}
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
                                      <span style={{ fontSize: 10, color: 'var(--muted)' }}>–</span>
                                      <TimeInput24
                                        value={matTimeOverride[r.matNo]?.end ?? (r.actualEnd ? fmtTime(r.actualEnd) : '')}
                                        onChange={e => setMatTimeOverride(m => ({ ...m, [r.matNo]: { ...m[r.matNo], end: e.target.value } }))}
                                        style={{ fontSize: 11, padding: '1px 3px', width: 64 }} />
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: 10, color: '#4d9fff', marginTop: 1 }}>🕐 {fmtTime(r.actualStart)}–{r.actualEnd ? fmtTime(r.actualEnd) : '...'}</div>
                                  )
                                )}
                              </div>
                              <div style={{ textAlign: 'center', minWidth: 40 }}>
                                <div style={{ fontSize: 9, color: 'var(--muted)' }}>NG</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: r.ng > 0 ? '#ef4444' : 'var(--muted)' }}>{r.ng}</div>
                              </div>
                              <div style={{ textAlign: 'center', minWidth: 60 }}>
                                <div style={{ fontSize: 9, color: 'var(--muted)' }}>Downtime</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: r.dt > 0 ? '#f59e0b' : 'var(--muted)' }}>{fmtMin(Math.round(r.dt))}</div>
                              </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
                              <div style={{ textAlign: 'center', padding: '4px 0', background: 'var(--bg2)', borderRadius: 6 }}>
                                <div style={{ fontSize: 9, color: 'var(--muted)' }}>เป้าหมาย</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{r.target}</div>
                              </div>
                              <div style={{ textAlign: 'center', padding: '4px 0', background: 'rgba(168,85,247,0.1)', borderRadius: 6 }}>
                                <div style={{ fontSize: 9, color: 'var(--muted)' }}>ควรได้ (เต็มเวลา)</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: '#a78bfa' }}>{r.achievable != null ? r.achievable : '—'}</div>
                              </div>
                              <div style={{ textAlign: 'center', padding: '4px 0', background: 'rgba(34,197,94,0.1)', borderRadius: 6 }}>
                                <div style={{ fontSize: 9, color: 'var(--muted)' }}>ผลิตได้จริง</div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: '#22c55e' }}>{r.qty}</div>
                              </div>
                            </div>
                            {r.achievable > 0 && (
                              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, textAlign: 'right' }}>
                                %P พาร์ทนี้ ≈ {Math.min(100, Math.round(r.qty / r.achievable * 100))}%
                              </div>
                            )}
                            {r.overCt && r.observedCtSec != null && (
                              <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 4, padding: '4px 6px', background: 'rgba(245,158,11,0.1)', borderRadius: 6 }}>
                                ⚠ ผลิตเกิน CT ที่ตั้งไว้ ({r.ctSec} วิ) — CT จริงที่สังเกตได้กะนี้ ≈ {r.observedCtSec.toFixed(1)} วิ/ชิ้น
                              </div>
                            )}
                            {overage && overage.overCount >= 3 && (
                              <div style={{ fontSize: 10, color: '#ef4444', marginTop: 4, padding: '4px 6px', background: 'rgba(239,68,68,0.1)', borderRadius: 6, fontWeight: 700 }}>
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
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--muted)', marginTop: 3 }}>
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
                          <div key={k.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--muted)' }}>
                            <span style={{ width: 9, height: 9, borderRadius: 2, background: k.color, display: 'inline-block' }} />
                            {k.label}
                          </div>
                        ))}
                      </div>
                      {dtLogs.some(d => !d.started_at) && (
                        <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 6 }}>⚠ มี Downtime บางรายการไม่ได้ระบุเวลาเริ่ม/จบ จึงไม่แสดงในไทม์ไลน์ (นับรวมในยอด Downtime ด้านบนแล้ว)</div>
                      )}
                    </div>
                  );
                })()}

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
                                    <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, marginBottom: 3 }}>
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
                                    <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, marginBottom: 3 }}>
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
                          <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700 }}>{k.label}</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{k.value}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700 }}>OEE รวม</div>
                      <div style={{ fontSize: 36, fontWeight: 900, color: oeeColor, lineHeight: 1 }}>{oee != null ? `${(oee * 100).toFixed(1)}%` : 'N/A'}</div>
                    </div>
                  </div>
                  {knownQty === 0 && unknownQty > 0 && (
                    <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 6 }}>⚠ ไม่มี Cycle Time ใน Product Master ของ MAT.NO ที่ผลิตในกะนี้เลย — P/OEE คำนวณไม่ได้ (จะถูกบันทึกเป็น N/A ไม่ใช่ 100%)</div>
                  )}
                  {knownQty > 0 && unknownQty > 0 && (
                    <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 6 }}>⚠ มี {unknownQty} ชิ้น จาก MAT.NO ที่ยังไม่ตั้ง Cycle Time ใน Product Master — P/OEE คำนวณจากเฉพาะ {knownQty} ชิ้นที่มี CT</div>
                  )}
                </div>

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
                <Field label="PROD.NO (สแกน barcode PROD.NO บน Tag Card) *">
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

              <Field label="PROD.NO (สแกน barcode PROD.NO บน Tag Card)">
                <input ref={closeProdInputRef} autoFocus value={closeProdNo}
                  onChange={e => handleCloseProdNoChange(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && closeMatch) handleScanCloseImmediate(closeMatch); }}
                  placeholder="สแกน PROD.NO..."
                  style={{ ...inputStyle, fontFamily: 'monospace', fontWeight: 700, fontSize: 15 }} />
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
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>ชิ้น</div>
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
                      <div style={{ fontSize: 9, color: q.color, fontWeight: 700, marginBottom: 3 }}>{q.label}</div>
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
                          <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700 }}>🔴 เริ่มหยุด</div>
                          <div style={{ fontSize: 18, fontWeight: 900, color: '#ef4444', lineHeight: 1.1 }}>{fmtTime(startedAt)}</div>
                          {isNextDay(startedAt) && <div style={{ fontSize: 9, color: '#f59e0b', fontWeight: 700 }}>+1 วัน · {fmtDate(startedAt)}</div>}
                        </div>
                        <div style={{ fontSize: 18, color: 'var(--muted)' }}>→</div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700 }}>🟢 กลับมา</div>
                          <div style={{ fontSize: 18, fontWeight: 900, color: '#22c55e', lineHeight: 1.1 }}>{fmtTime(endedAt)}</div>
                          {isNextDay(endedAt) && <div style={{ fontSize: 9, color: '#f59e0b', fontWeight: 700 }}>+1 วัน · {fmtDate(endedAt)}</div>}
                        </div>
                        <div style={{ marginLeft: 'auto', textAlign: 'center' }}>
                          <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700 }}>รวม</div>
                          <div style={{ fontSize: 22, fontWeight: 900, color: '#f59e0b' }}>{durMin ? `${Math.round(durMin * 10) / 10} นาที` : '—'}</div>
                        </div>
                      </div>
                      {(isNextDay(startedAt) || isNextDay(endedAt)) && (
                        <div style={{ marginTop: 8, fontSize: 10, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', borderRadius: 6, padding: '4px 8px' }}>
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

  const isAdmin = role === 'admin';

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
    let q = supabaseDR.from('production_sessions')
      .select('*, dr_products(name)')
      .eq('status', 'closed')
      .order('work_date', { ascending: false })
      .limit(100);
    if (filter.date)      q = q.eq('work_date', filter.date);
    if (filter.line_name) q = q.eq('line_name', filter.line_name);
    const [{ data: ss }, { data: ln }] = await Promise.all([
      q,
      supabase.from('production_lines').select('name').order('name'),
    ]);
    setSessions(ss || []);
    setLineNames((ln || []).map(l => l.name));
    setLoading(false);
  }, [filter]);

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
                      <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>OEE</div>
                      <div style={{ fontSize: 15, fontWeight: 900, color: oeeColor }}>{oeeVal.toFixed(1)}%</div>
                    </div>
                  )}
                  <span style={{ color: 'var(--muted)', fontSize: 16 }}>{expanded === s.id ? '▲' : '▼'}</span>
                  {isAdmin && (
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
                            <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700 }}>{k.label}</div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: c }}>{k.value != null ? `${k.value.toFixed(1)}%` : '—'}</div>
                          </div>
                        );
                      })}
                      <div style={{ textAlign: 'center', marginLeft: 'auto' }}>
                        <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700 }}>OEE</div>
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
                        <span style={{ fontSize: 10 }}>{minimized ? '▶' : '▼'}</span>
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
                              <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: `${statusColor}20`, color: statusColor, fontWeight: 700 }}>{statusLabel}</span>
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
                                <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: 'rgba(74,222,128,0.1)', color: '#22c55e', fontWeight: 700, fontFamily: 'monospace' }}>
                                  {d.prod_orders.prod_no}
                                </span>
                              )}
                              {d.qty_ng      > 0 && <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 700 }}>NG {d.qty_ng}</span>}
                              {d.qty_suspect > 0 && <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>สงสัย {d.qty_suspect}</span>}
                              {d.qty_repair  > 0 && <span style={{ fontSize: 11, color: '#a78bfa', fontWeight: 700 }}>ซ่อม {d.qty_repair}</span>}
                            </div>
                            {d.description && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{d.description}</div>}
                            <div style={{ fontSize: 10, color: 'var(--muted)' }}>
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
                                <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: cat.bg, color: cat.color, fontWeight: 700 }}>{cat.label}</span>
                                <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{d.dr_downtime_types?.name_th}</span>
                                {d.machine_no && <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {d.machine_no}</span>}
                                {d.mat_no && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: 'rgba(14,165,233,0.15)', color: '#0ea5e9' }}>{d.mat_no}</span>}
                                <span style={{ fontSize: 12, fontWeight: 700, color: d.dr_downtime_types?.color || '#aaa' }}>{fmtMin(d.duration_min)}</span>
                              </div>
                              {d.description && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{d.description}</div>}
                              <div style={{ fontSize: 10, color: 'var(--muted)' }}>
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
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const firstOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };

  const [filter, setFilter]       = useState({ date_from: firstOfMonth(), date_to: today(), line_name: '' });
  const [lineNames, setLineNames] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [preview, setPreview]     = useState(null); // { type, rows, cols }

  useEffect(() => {
    supabase.from('production_lines').select('name').order('name')
      .then(({ data }) => setLineNames((data || []).map(l => l.name)));
  }, []);

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

  const sel = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text)', fontSize: 13 };
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
  const [subTab, setSubTab] = useState('machines');
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, background: 'var(--bg2)', borderRadius: 8, padding: 4, marginBottom: 20, width: 'fit-content', flexWrap: 'wrap' }}>
        {[
          { key: 'machines',  label: '⚙️ เครื่องจักร' },
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
      {subTab === 'machines' && <MachineSetup role={role} />}
      {subTab === 'downtime' && <DowntimeTypeSetup role={role} />}
      {subTab === 'defects'  && <DefectTypeSetup role={role} />}
      {subTab === 'breaks'   && <BreakPolicySetup role={role} />}
    </div>
  );
}

/* ── Machine Setup ── */
function MachineSetup({ role }) {
  const canEdit = ['admin', 'manager', 'supervisor'].includes(role);
  const [items, setItems]     = useState([]);
  const [lines, setLines]     = useState([]);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving]   = useState(false);
  const [filterLine, setFilterLine] = useState('');
  const emptyForm = { line_name: '', machine_no: '', machine_name: '', process_type: 'welding_assembly', sort_order: 0, is_active: true };
  const [form, setForm]       = useState(emptyForm);

  const load = useCallback(async () => {
    const [{ data: mc }, { data: ln }] = await Promise.all([
      supabaseDR.from('machines').select('*').order('line_name').order('sort_order'),
      supabase.from('production_lines').select('name').order('name'),
    ]);
    setItems(mc || []);
    setLines((ln || []).map(l => l.name));
  }, []);
  useEffect(() => { load(); }, [load]);

  const openEdit = (item = null) => {
    setEditing(item?.id || 'new');
    setForm(item
      ? { line_name: item.line_name, machine_no: item.machine_no, machine_name: item.machine_name || '', process_type: item.process_type, sort_order: item.sort_order, is_active: item.is_active }
      : { ...emptyForm, line_name: filterLine || '', sort_order: items.length + 1 });
  };

  const handleSave = async () => {
    if (!form.line_name) { toast.error('เลือกไลน์'); return; }
    if (!form.machine_no) { toast.error('กรอกหมายเลขเครื่อง'); return; }
    setSaving(true);
    const payload = { ...form, machine_no: form.machine_no.trim().toUpperCase(), sort_order: parseInt(form.sort_order) || 0, updated_at: new Date().toISOString() };
    const { error } = editing === 'new'
      ? await supabaseDR.from('machines').insert(payload)
      : await supabaseDR.from('machines').update(payload).eq('id', editing);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('บันทึกสำเร็จ');
    setEditing(null);
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('ลบเครื่องจักรนี้?')) return;
    const { error } = await supabaseDR.from('machines').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const PROC_LABEL = { welding_assembly: '🔥 Welding/Assembly', metal_forming: '⚙ Metal Forming', common: '🔗 ทุกกระบวนการ' };

  // Group by line
  const displayLines = filterLine ? [filterLine] : [...new Set(items.map(i => i.line_name))];
  const filteredItems = filterLine ? items.filter(i => i.line_name === filterLine) : items;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
          <select value={filterLine} onChange={e => setFilterLine(e.target.value)} style={{ ...inputStyle, maxWidth: 200 }}>
            <option value="">— ทุกไลน์ —</option>
            {lines.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{filteredItems.length} เครื่อง</div>
        </div>
        {canEdit && <button onClick={() => openEdit()} style={saveBtnStyle}>+ เพิ่มเครื่องจักร</button>}
      </div>

      {displayLines.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีข้อมูลเครื่องจักร</div>
      )}

      {displayLines.map(lineName => {
        const lineItems = items.filter(i => i.line_name === lineName);
        return (
          <div key={lineName} style={{ marginBottom: 20, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>⚙️ {lineName}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>{lineItems.length} เครื่อง</span>
              {canEdit && !filterLine && (
                <button onClick={() => { setFilterLine(lineName); openEdit({ line_name: lineName, machine_no: '', machine_name: '', process_type: 'welding_assembly', sort_order: lineItems.length + 1, is_active: true }); }}
                  style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 5, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  + เพิ่ม
                </button>
              )}
            </div>
            <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {lineItems.map(item => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, opacity: item.is_active ? 1 : 0.5 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>{item.machine_no}</span>
                      {item.machine_name && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{item.machine_name}</span>}
                      <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, background: 'rgba(99,102,241,0.12)', color: '#a78bfa', fontWeight: 700 }}>{PROC_LABEL[item.process_type]}</span>
                      {!item.is_active && <span style={{ fontSize: 10, color: '#ef4444' }}>(ปิดใช้)</span>}
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
          </div>
        );
      })}

      {editing && (
        <div className="overlay" style={{ zIndex: 2000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(95vw,420px)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 20, color: 'var(--text)' }}>
              {editing === 'new' ? '+ เพิ่มเครื่องจักร' : 'แก้ไขเครื่องจักร'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="ไลน์การผลิต *">
                <select value={form.line_name} onChange={e => setForm(f => ({ ...f, line_name: e.target.value }))} style={inputStyle}>
                  <option value="">— เลือกไลน์ —</option>
                  {lines.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="หมายเลขเครื่อง *">
                  <input autoFocus value={form.machine_no} onChange={e => setForm(f => ({ ...f, machine_no: e.target.value.toUpperCase() }))} placeholder="เช่น MC-01" style={{ ...inputStyle, fontFamily: 'monospace', fontWeight: 700 }} />
                </Field>
                <Field label="ชื่อเครื่อง / รุ่น">
                  <input value={form.machine_name} onChange={e => setForm(f => ({ ...f, machine_name: e.target.value }))} placeholder="เช่น CO2 Welder" style={inputStyle} />
                </Field>
              </div>
              <Field label="ประเภทกระบวนการ">
                <select value={form.process_type} onChange={e => setForm(f => ({ ...f, process_type: e.target.value }))} style={inputStyle}>
                  <option value="welding_assembly">🔥 Welding / Assembly</option>
                  <option value="metal_forming">⚙ Metal Forming</option>
                  <option value="common">🔗 ทั่วไป</option>
                </select>
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="ลำดับ">
                  <input type="number" min="0" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} style={inputStyle} />
                </Field>
                <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                    <span style={{ fontSize: 13, color: 'var(--text)' }}>ใช้งานอยู่</span>
                  </label>
                </div>
              </div>
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

/* ── Defect Type Setup ── */
function DefectTypeSetup({ role }) {
  const canEdit = ['admin', 'manager', 'supervisor'].includes(role);
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
                    {!item.is_active && <div style={{ fontSize: 10, color: '#ef4444' }}>(ปิดใช้)</div>}
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
  const canEdit = ['admin', 'manager', 'supervisor'].includes(role);
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
                <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, background: 'rgba(245,158,11,0.15)', color: '#f59e0b', fontWeight: 700 }}>{SHIFT_LABEL[item.shift]}</span>
                <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, background: 'rgba(99,102,241,0.15)', color: '#a78bfa', fontWeight: 700 }}>{PROC_LABEL[item.process_type]}</span>
                {!item.is_active && <span style={{ fontSize: 10, color: '#ef4444' }}>(ปิดใช้)</span>}
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
    setForm({ name: item.name, code: item.code || '', mat_no: '', p_no: '', customer: item.customer || '', line_name: item.line_name || '', cycle_time_sec: item.cycle_time_sec || '', target_per_shift: item.target_per_shift || '', process_type: item.process_type || 'welding_assembly', is_active: true, effective_from: new Date().toISOString().slice(0, 10) });
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
          superseded_at: form.effective_from || new Date().toISOString().slice(0, 10),
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

  const canEdit = ['admin', 'manager', 'supervisor'].includes(role);

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
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                      background: item.process_type === 'metal_forming' ? 'rgba(251,191,36,0.15)' : 'rgba(34,197,94,0.12)',
                      color: item.process_type === 'metal_forming' ? '#fbbf24' : '#22c55e' }}>
                      {item.process_type === 'metal_forming' ? '⚙ Metal Forming' : '🔥 Welding/Assy'}
                    </span>
                    {members.length > 1 && (
                      <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 20, background: 'rgba(168,85,247,0.12)', color: '#a855f7', fontWeight: 700 }}>
                        🔄 {members.length} revisions
                      </span>
                    )}
                    {!active && <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 20, background: 'rgba(107,114,128,0.15)', color: '#6b7280', fontWeight: 700 }}>ปิดใช้งาน</span>}
                  </div>

                  {/* Current MAT.NO / P.NO */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
                    {item.mat_no && <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: '#0ea5e9' }}>{item.mat_no}</span>}
                    {item.p_no   && <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text2)' }}>P.NO: {item.p_no}</span>}
                    {item.customer && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: 'rgba(59,130,246,0.1)', color: '#60a5fa' }}>{item.customer}</span>}
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
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, marginBottom: 2 }}>📋 ประวัติ Revision</div>
                  {archived.map(rev => (
                    <div key={rev.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, color: 'var(--muted)', opacity: 0.75 }}>
                      <span style={{ fontFamily: 'monospace', color: '#64748b' }}>{rev.mat_no || '—'}</span>
                      {rev.p_no && <span style={{ color: '#475569' }}>P.NO: {rev.p_no}</span>}
                      <span style={{ color: '#374151' }}>{rev.effective_from || '?'} → {rev.superseded_at || '?'}</span>
                      <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 10, background: 'rgba(107,114,128,0.15)', color: '#6b7280' }}>superseded</span>
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
                      <span style={{ fontSize: 10, color: 'var(--muted)' }}>{isExpanded ? '▲' : '▼'}</span>
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
                                  {isOldRev && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 10, background: 'rgba(107,114,128,0.12)', color: '#6b7280' }}>rev เก่า</span>}
                                  {!std.is_active && <span style={{ fontSize: 9, color: '#ef4444' }}>ปิด</span>}
                                </div>
                              </div>
                              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                <span style={{ fontSize: 18, fontWeight: 900, color: '#0ea5e9', lineHeight: 1 }}>{std.qty_per_kanban}</span>
                                <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 3 }}>ชิ้น/ใบ</span>
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

  const canEdit = ['admin', 'manager', 'supervisor'].includes(role);

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
        <div style={{ fontSize: 10, color: 'var(--muted)', background: item.category === 'unplanned' ? 'rgba(239,68,68,0.12)' : 'rgba(59,130,246,0.12)', borderRadius: 4, padding: '2px 6px' }}>
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

  const canEdit = ['admin', 'manager', 'supervisor'].includes(role);

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
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(16,185,129,0.15)', color: '#34d399', fontWeight: 700 }}>🔗 linked</span>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{d.name}</span>
                  {d.customer && (
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(59,130,246,0.12)', color: '#60a5fa', fontWeight: 700 }}>{d.customer}</span>
                  )}
                  {!item.is_active && <span style={{ fontSize: 10, color: '#ef4444' }}>(ปิดใช้งาน)</span>}
                </div>
                {d.pno && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>P.NO: {d.pno}</div>}
              </div>
              <div style={{ textAlign: 'center', minWidth: 80 }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: '#0ea5e9', lineHeight: 1 }}>{item.qty_per_kanban}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>ชิ้น / Kanban</div>
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

function Stat({ label, value, color, small }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
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
