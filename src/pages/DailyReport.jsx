import { useState, useEffect, useContext, useCallback, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { fmtDate, fmtDateTime, fmtDateTimeFull, fmtTime } from '../utils/dateFormat';
import { toast } from '../components/Toast';
import { printProdProblemReport, buildProblemReport, dtNeedsFix, countPendingFix, PROBLEM_MIN_MINUTES } from '../lib/prodProblemReport';
import { loadProcessTypes, activeProcessTypes, procDisplay, procColor } from '../utils/processTypes';
loadProcessTypes(); // master กระบวนการ (data-driven) — dropdown/ป้ายในหน้านี้อ่านผ่าน sync cache
import tsLogoUrl from '../assets/TS logo.png';
import { can, canAccessPage } from '../utils/permissions';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { fetchByIds } from '../utils/fetchByIds';
import { parallelUnitsOf, flowModeOf } from '../utils/lineTypes';
import { MTN_TEAMS, teamForItem, teamKeyOf, deptNameOf } from '../utils/mtnTeams';
import useIsMobile from '../utils/useIsMobile';
import { pairAwareTotal, collapseOps } from '../utils/pairTotals';
import { loadOpInfo, opInfoSync } from '../utils/opItems';
import { getDocForm, fullCode } from '../utils/docForms';
import EventComments from '../components/EventComments';
import ProblemFixModal from '../components/ProblemFixModal';
import QualityBinLinkModal from '../components/QualityBinLinkModal';
import StoreLotQueue from '../components/StoreLotQueue';
import LineWipPanel from '../components/LineWipPanel';
import LinePartCallPanel from '../components/LinePartCallPanel';
import ProcessTypeSetup from '../components/ProcessTypeSetup';
import { strictOee, strictGap, STRICT_WARN_SHARE_PCT, policyBreakOverlapMin, buildCtMap, ctForMat, SIX_BIG_LOSSES, EIGHT_WASTES, sumDefectQty, isTrialDefect, splitDefectQty } from '../utils/oee';
import ScanModal from '../components/ScanModal';
import SearchSelect from '../components/SearchSelect';
import { resolveMachine, normCode } from '../utils/qrCode';
import { pickUnusedColor } from '../utils/colorPick';
import PageHeader from '../components/PageHeader';
import useTabParam from '../utils/useTabParam';
import LineSelect from '../components/LineSelect';
import useProductionLines from '../utils/useProductionLines';
import { notifyEvent } from '../utils/notifyEvent';
import useStaleSessions, { STALE_SESSION_DAYS, sessionAgeDays, ballSideText } from '../utils/staleSessions';
import { liveChannel } from '../utils/liveChannel';

// โหลดโลโก้บริษัทเป็น base64 ครั้งเดียวต่อ URL สำหรับฝัง PDF
// รับ url เพื่อรองรับโลโก้ที่อัปโหลดทับในทะเบียนเอกสาร (doc_forms.logo_url) — ไม่ส่ง = โลโก้ TS ทางการ
const logoDataUrlCache = new Map();
function getTsLogoDataUrl(url = tsLogoUrl) {
  const key = url || tsLogoUrl;
  if (!logoDataUrlCache.has(key)) {
    logoDataUrlCache.set(key, fetch(key)
      .then(r => r.blob())
      .then(blob => new Promise(resolve => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      }))
      .catch(() => null));
  }
  return logoDataUrlCache.get(key);
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
    // color-scheme ตามธีมกลางใน index.css แล้ว — ห้าม hardcode 'dark' (จะกลับด้านพังใน light mode)
    borderRadius: 6, padding: '6px 8px', ...style,
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
// เกณฑ์/สูตร "กะค้าง" ย้ายไป src/utils/staleSessions.js (ใช้ร่วมกับแท็บ ⏰ กะค้าง) — ห้ามนิยามซ้ำที่นี่
/* คีย์ sentinel ของถัง "กะค้างจากวันก่อน" ใน sessGroupCollapsed
   ⚠️ ความหมายกลับด้านกับกลุ่มไลน์: มีคีย์ = "ผู้ใช้กางเอง" (ถังนี้ค่าเริ่มต้นคือพับ)
   ตั้งชื่อขึ้นต้น __ กันชนกับชื่อไลน์จริง */
const STALE_BUCKET_KEY = '__stale_bucket__';
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
  const { role, lineId: userLineId, sections: scopeSecs = [] } = useContext(UserContext);
  const canSetup = can('daily_report', 'setup', role);
  const [tabRaw, setTab] = useTabParam(['live', 'stale', 'history', 'export', 'setup'], 'live');
  const tab = tabRaw === 'setup' && !canSetup ? 'live' : tabRaw;   // ลิงก์เข้าแท็บที่ไม่มีสิทธิ์ = ตกกลับแท็บแรก
  /* ⏰ กะค้าง = แท็บของตัวเอง (2026-08-26 · user "live กะนี้ ไม่ควรโชว์กะค้าง — แยกแท็บไล่ปิดให้หัวหน้าแผนก")
     เดิม banner 37 กะกินครึ่งจอบนแท็บ Live จนกะที่กำลังทำงานอยู่ถูกดันลงไปข้างล่าง
     โหลดที่หน้าแม่เพราะ badge ต้องเห็นจากทุกแท็บ (ไม่งั้นสลับไปแท็บอื่นแล้วงานค้างหายไปจากสายตา) */
  const stale = useStaleSessions({ role, lineId: userLineId, sections: scopeSecs });
  const staleOver = stale.rows.filter(o => o.age > STALE_SESSION_DAYS).length;
  // กดกะจากแท็บกะค้าง → สลับไป Live แล้วเลือกกะนั้นให้เลย (ไม่งั้นต้องไปไล่หาในลิสต์ 51 กะเอง)
  const [focusSess, setFocusSess] = useState(null);

  return (
    <div style={{ padding: 'clamp(12px,3vw,28px)', maxWidth: 'min(96vw, 2000px)', margin: '0 auto' }}>
      <PageHeader
        title="Daily Production Report" icon="📊"
        sub="บันทึกผลผลิตและ Downtime แบบ Real-time รายกะ"
        tabs={[
          { key: 'live', label: '⚡ Live กะนี้' },
          // ไม่มีกะค้าง = ไม่ต้องมีแท็บให้รก · โหลดไม่สำเร็จก็ต้องโชว์ (จะได้เข้าไปเห็นสาเหตุ ห้ามเงียบ)
          ...((stale.rows.length || stale.error) ? [{
            key: 'stale',
            label: stale.error ? '⏰ กะค้าง ⚠' : `⏰ กะค้าง ${stale.rows.length}${staleOver ? ` · เกิน ${STALE_SESSION_DAYS} วัน ${staleOver}` : ''}`,
          }] : []),
          { key: 'history', label: '📋 ประวัติ' },
          { key: 'export', label: '📤 Export' },
          ...(canSetup ? [{ key: 'setup', label: '⚙️ ตั้งค่า' }] : []),
        ]}
        tab={tab} onTab={setTab}
      />

      {tab === 'live'    && <LiveTab role={role} stale={stale} onGoStale={() => setTab('stale')}
                              focusSessionId={focusSess} onFocusDone={() => setFocusSess(null)} />}
      {tab === 'stale'   && <StaleTab stale={stale} role={role} onOpenSession={(id) => { setFocusSess(id); setTab('live'); }} />}
      {tab === 'history' && <HistoryTab role={role} />}
      {tab === 'export'  && <ExportTab />}
      {tab === 'setup'   && canSetup && <SetupTab role={role} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   LIVE TAB
═══════════════════════════════════════════════════════════════ */
function LiveTab({ role, stale, onGoStale, focusSessionId, onFocusDone }) {
  const { fullName, lineId: userLineId, sections: scopeSecs = [] } = useContext(UserContext);
  const isMobile = useIsMobile(); // ≤768px: sidebar รายชื่อกะยุบมาซ้อนบนเนื้อหา (desktop ไม่เปลี่ยน)
  const wide1100 = !useIsMobile(1099); // ≥1100px → modal แผ่ 2 คอลัมน์ (reactive แทน innerWidth ครั้งเดียว)
  const navigate = useNavigate();
  const [lines, setLines]           = useState([]);
  const [lineMap, setLineMap]       = useState({});
  const [products, setProducts]     = useState([]);
  const [dtTypes, setDtTypes]       = useState([]);
  const [sessions, setSessions]     = useState([]);
  // กะค้างย้ายไปแท็บ "⏰ กะค้าง" แล้ว — แท็บนี้เหลือแค่ชิปสรุปบรรทัดเดียว (ข้อมูลมาจากหน้าแม่)
  const overdueAlert = stale?.rows || [];
  // ของที่ load() ต้องใช้แต่ห้ามอยู่ใน deps (identity เปลี่ยนทุก render ของหน้าแม่ → load วนซ้ำ)
  const staleRef = useRef(stale); staleRef.current = stale;
  const focusRef = useRef(focusSessionId); focusRef.current = focusSessionId;
  const onFocusDoneRef = useRef(onFocusDone); onFocusDoneRef.current = onFocusDone;
  const [dtLogs, setDtLogs]         = useState([]);
  const [dtCmOpen, setDtCmOpen]     = useState(null); // id ของ DT ที่กางแผงคอมเมนต์อยู่
  // 🛠 ลงวิธีแก้ไข/ผลตรวจติดตามของปัญหา 1 รายการ — { kind:'downtime'|'defect', row, title }
  const [fixTarget, setFixTarget]   = useState(null);
  // 🗑️ ส่งของเสียเข้าถังเหลือง/แดง — { [defect_log_id]: { yellow, red } } จำนวนที่ลงถังไปแล้ว
  const [binTarget, setBinTarget]   = useState(null);
  const [binLinks, setBinLinks]     = useState({});
  const [selSession, setSelSession] = useState(null);
  // §139 ย่อ/ขยายกลุ่มไลน์ในลิสต์กะ — กะค้างไม่ปิดสะสมทำให้ลิสต์ยาวมาก (เจอจริง 34 กะ) · จำใน localStorage
  const [sessGroupCollapsed, setSessGroupCollapsed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('dr_sess_group_collapse') || '[]')); } catch { return new Set(); }
  });
  const persistSessGroups = (next) => {
    try { localStorage.setItem('dr_sess_group_collapse', JSON.stringify([...next])); } catch { /* ignore */ }
    setSessGroupCollapsed(next);
  };
  const toggleSessGroup = (name) => {
    const next = new Set(sessGroupCollapsed);
    next.has(name) ? next.delete(name) : next.add(name);
    persistSessGroups(next);
  };
  const [loading, setLoading]       = useState(true);
  // CT overage history — keyed by mat_no: { checked, overCount, ctSec, avgObservedCt } จากกะปิดล่าสุดของไลน์เดียวกัน
  const [ctOverage, setCtOverage]   = useState({});

  const [parentChildrenMap, setParentChildrenMap] = useState({}); // { 'HYDROFORM': ['HDF1','HDF2',...] }

  const [showOpen, setShowOpen] = useState(false);
  const [openForm, setOpenForm] = useState(() => { const s = currentShift(); return { work_date: workDate(), line_name: '', shift: s, product_id: '', start_time: shiftStart(s) }; });
  const [lineFlow, setLineFlow] = useState({});   // line_name → { flow_mode, parallel_stations } (best-effort — ไลน์เครื่องขนาน)
  const [openMachineNo, setOpenMachineNo] = useState(''); // เครื่องที่จะผูกกับใบที่เปิดถัดไป (เฉพาะไลน์ parallel_machine)

  const [showDT, setShowDT]   = useState(false);
  const [moDtPick, setMoDtPick] = useState(null); // { d, team } — เลือกทีมช่างก่อนเปิดใบซ่อมจาก downtime
  const [dtForm, setDtForm]   = useState({ id: null, downtime_type_id: '', mode: 'start_end', start_time: '', end_time: '', duration_min: '', machine_no: '', mat_no: '', description: '' });
  const [dtScanOpen, setDtScanOpen] = useState(false);   // สแกน QR เลือกเครื่องในฟอร์ม Downtime
  const [savingDT, setSavingDT] = useState(false);

  // Prod Orders
  const [prodOrders, setProdOrders]       = useState([]);
  const [carryOrders, setCarryOrders]     = useState([]); // pending carry-over from prev session
  const [kanbanStds, setKanbanStds]       = useState([]);
  // minimize/expand แต่ละ section ใหญ่บนแท็บ Live — จำสถานะใน localStorage (dr_live_collapse_<section>)
  // ค่า default = กางเหมือนเดิม ยกเว้น section ที่ว่างเปล่าเริ่มแบบพับ (autoCollapsed)
  const [liveCollapse, setLiveCollapse] = useState(() => {
    const out = {};
    ['prod_orders', 'defects', 'downtime', 'mat_breakdown', 'overdue'].forEach(k => {
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
  const [defectForm, setDefectForm]     = useState({ id: null, mat_no: '', defect_type_id: '', qty_ng: '0', qty_suspect: '0', qty_repair: '0', description: '', is_trial: false });
  /* ใบสแกนใบไหนกางช่อง "ทำได้กี่ชิ้น" อยู่ — ค่าเริ่มต้นพับหมด
     เหตุผล: ระบบดึง (kanban) เปิดค้างทีละ 20-30 ใบได้ แต่ "ใบที่ทำค้างจริง" มีไม่กี่ใบ
     ที่เหลือคือยังไม่เริ่ม (ยกเต็มใบ) หรือเดี๋ยวสแกนปิดเต็มใบ → กางช่องทุกใบ = จอรก
     และชวนให้เข้าใจผิดว่าต้องกรอกครบทุกใบ (หัวหน้าแผนกทักจริง 2026-08-20) */
  const [qtyEditIds, setQtyEditIds]     = useState(() => new Set());
  const openQtyEdit = (id) => setQtyEditIds(prev => new Set(prev).add(id));
  const [savingDefect, setSavingDefect] = useState(false);

  // SV review-before-approve modal for pending_close requests
  const [showApproveReview, setShowApproveReview] = useState(false);
  const [approveNote, setApproveNote] = useState(''); // remark ของ SV ตอนอนุมัติปิดกะ (optional — คำขอ user 2026-07-24)
  // SV reject-with-remark modal (บอกหัวหน้ากลุ่มว่าต้องกลับไปแก้อะไร)
  const [showRejectModal, setShowRejectModal] = useState(false);
  // ใบรายงานปัญหาการผลิต — ช่อง "ปัญหา :" บนหัวใบ ระบบเสนอค่าให้ คนแก้/ล้างได้ก่อนพิมพ์
  const [problemSheet, setProblemSheet] = useState(null);   // { title } | null

  const [rejectReason, setRejectReason]       = useState('');
  const [savingReject, setSavingReject]       = useState(false);

  // Close Shift modal (OEE)
  const [showCloseShift, setShowCloseShift] = useState(false);
  // หมายเหตุของหัวหน้ากลุ่ม (ผู้ขอปิดกะ) — คู่กับ close_approve_note/close_reject_reason ฝั่ง SV
  const [closeNote, setCloseNote]           = useState('');
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
  const canDeleteSession = can('daily_report', 'delete_session', role); // ลบกะ (seed: admin — ปรับที่ /permissions)
  // leader แก้ไข/ลบ order, defect, downtime ได้เฉพาะตอนกะยังเปิดอยู่ (ยังไม่ส่งขออนุมัติปิดกะ) —
  // ถ้าส่งขอปิดกะแล้ว (pending_close) ต้องรอ SV อนุมัติ/ปฏิเสธก่อน ถ้าโดนปฏิเสธ สถานะจะกลับเป็น open ให้แก้ไขได้อีก
  const canEditRecords   = canManage || (role === 'leader' && selSession?.status === 'open');

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: ln }, { data: pr }, { data: dt }, { data: ks }, { data: bp }, { data: mc }, { data: dft }] = await Promise.all([
      supabase.from('production_lines').select('id, name, section, parent_line_name').order('name'),
      supabaseDR.from('dr_products').select('*').eq('is_active', true).order('name'),
      supabaseDR.from('dr_downtime_types').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('kanban_standards').select('*, dr_products(id, name, line_name, cycle_time_sec, process_type, p_no)').eq('is_active', true).order('mat_no'),
      supabaseDR.from('break_policies').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('machines').select('*').eq('is_active', true).order('line_name').order('sort_order'),
      supabaseDR.from('dr_defect_types').select('*').eq('is_active', true).order('sort_order'),
      loadOpInfo(), // map รายการขั้นตอน (OP งานขับนัท) — ตัวที่ 8 ไม่เข้า destructure แค่ให้ cache พร้อม
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
    // โหมดการไหลงานต่อไลน์ (flow_mode) best-effort — ไลน์ parallel_machine ให้เลือกเครื่องตอนเปิด Order
    supabase.from('production_lines').select('name, flow_mode, parallel_stations').then(({ data }) => {
      if (!data) return;
      const fm = {}; data.forEach(l => { fm[l.name] = { flow_mode: l.flow_mode, parallel_stations: l.parallel_stations }; });
      setLineFlow(fm);
    }, () => {});
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

    /* กะค้าง (open/pending_close ของวันก่อนๆ) โหลดที่หน้าแม่ผ่าน useStaleSessions — ไม่ query ซ้ำที่นี่
       แต่ต้องสั่งรีเฟรชด้วย เพราะ load() ถูกเรียกทุกครั้งที่กะเปลี่ยน (ปิดกะ/อนุมัติ/realtime)
       ⚠️ อ่านผ่าน ref ไม่ใส่ใน deps — reload เปลี่ยน identity เมื่อไหร่ load จะวนซ้ำ */
    staleRef.current?.reload?.();

    setSessions(ss || []);
    if (ss?.length) {
      /* deep-link ?line=NAME (จากปุ่ม "📊 Daily Report" ในหน้าจัดการไลน์)
         → เลือกกะของไลน์นั้นให้เลย ไม่ต้องมาไล่หาใน sidebar อีกรอบ
         เคารพ scope: ไลน์ที่ไม่มีกะเปิดใน scope = ตกไปค่าเริ่มต้นปกติ (ห้ามจอว่าง) */
      const qp = new URLSearchParams(window.location.search);
      const wantLine = qp.get('line');
      const hit = wantLine ? (ss.find(x => x.line_name === wantLine) || null) : null;
      if (wantLine) {
        // ล้างเฉพาะ line — ห้ามล้างทั้ง search (จะพา ?tab= ของ useTabParam หายไปด้วย)
        qp.delete('line');
        const q = qp.toString();
        window.history.replaceState({}, '', window.location.pathname + (q ? `?${q}` : ''));
      }
      // มาจากแท็บ "⏰ กะค้าง" (focusSessionId) = เลือกกะนั้นให้เลย ไม่ต้องไปไล่หาในลิสต์เอง
      const focus = focusRef.current && ss.find(x => x.id === focusRef.current);
      if (hit) setSelSession(hit);
      else if (focus) { setSelSession(focus); onFocusDoneRef.current?.(); }
      // ⚠️ ห้ามลืม branch นี้ — ไม่มี = ไม่มีกะไหนถูกเลือกเลย จอหลักว่างทั้งหน้า (เคยหลุดตอน rebase)
      else setSelSession(s => s?.id ? (ss.find(x => x.id === s.id) || ss[0]) : ss[0]);
    } else {
      setSelSession(null);
    }
    setLoading(false);
  }, [role, scopeSecs, userLineId]);

  /* ── แยก "กะที่กำลังทำอยู่" ออกจาก "กะค้างจากวันก่อน" (2026-08-26 · feedback "ปวดหัวกับกะที่รก ค้างจังเลย")
     ข้อมูลจริงที่หน้างานเจอ: sidebar ขึ้น 49 กะ ในนั้น 37 กะเป็นของวันก่อนที่ยังไม่ปิด
     → กะของวันนี้ (สิ่งที่ต้องกรอกตอนนี้) จมอยู่ในกำแพงการ์ด
     ⚠️ กะค้าง "ห้ามซ่อนหาย" — ยุบเป็นถังพับไว้ + ตัวนับบนหัว + banner เดิมยังนับครบเหมือนเดิม */
  const [freshSessions, staleSessions] = useMemo(() => {
    const wd = workDate();
    const fresh = [], stale = [];
    (sessions || []).forEach(s => ((s.work_date || '') >= wd ? fresh : stale).push(s));
    return [fresh, stale];
  }, [sessions]);

  // ไลน์ที่เปิดกะได้ตาม scope (leader→family · role อื่น→sections · admin/qa→null=ทั้งหมด) — กันเปิดกะไลน์ข้ามส่วนงาน
  const openScopeLineNames = useMemo(() => {
    if (role === 'leader' && userLineId) return new Set(getLineFamilyNames(lines, Number(userLineId) || userLineId));
    if (scopeSecs.length) return new Set(lines.filter(l => inSectionScope(scopeSecs, l.section)).map(l => l.name));
    return null; // ไม่จำกัด
  }, [role, userLineId, scopeSecs, lines]);

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
      .select('*, dr_defect_types(name_th, color, excl_from_q), prod_orders(prod_no, mat_no, part_name)')
      .eq('session_id', sessionId)
      .order('logged_at', { ascending: false });
    setDefectLogs(data || []);

    // ของเสียแถวไหนถูกส่งลงถังเหลือง/แดงไปแล้วบ้าง (ยิงรวมครั้งเดียว ไม่ยิงรายแถว)
    const ids = (data || []).map(d => d.id);
    if (!ids.length) { setBinLinks({}); return; }
    const { data: bins, error: binErr } = await supabaseDR.from('quality_bin_records')
      .select('bin, qty, defect_log_id').in('defect_log_id', ids).eq('is_active', true);
    if (binErr) { console.warn('[bin links]', binErr.message); setBinLinks({}); return; }
    const m = {};
    (bins || []).forEach(r => {
      if (!m[r.defect_log_id]) m[r.defect_log_id] = { yellow: 0, red: 0 };
      m[r.defect_log_id][r.bin] += Number(r.qty) || 0;
    });
    setBinLinks(m);
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
    const ch = liveChannel(supabaseDR, 'live-dr')
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
      // NG เข้าสูตร Q ต้องไม่รวมงานทดลอง (เหมือน handleCloseSession)
      const { A, P, Q, oee, shiftMin, totalProduced } = computeOEE(sumDefectQty(defectLogs, 'line'), closeEndTime, closeStartTime);
      const startChanged = closeStartTime && closeStartTime !== selSession.start_time;
      const endChanged   = closeEndTime   && closeEndTime   !== selSession.end_time;
      // กะไม่มีผลผลิต → A/Q ไม่มีความหมาย (กันเลข 100/0 รั่วเข้าค่าเฉลี่ย %A/%Q — ดูหมายเหตุใน handleCloseSession)
      const noProduction = totalProduced === 0 && P == null;
      const update = {
        shift_min: shiftMin,
        oee_a: noProduction ? null : parseFloat((A * 100).toFixed(2)),
        oee_p: P != null ? parseFloat((P * 100).toFixed(2)) : null,
        oee_q: noProduction ? null : parseFloat((Q * 100).toFixed(2)),
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
    // เครื่องจักร + ชิ้นงาน ไม่บังคับทุกประเภท — downtime หลายอย่าง (5ส/ประชุม/รอวัตถุดิบ/QA recheck)
    // เป็นการหยุดระดับไลน์ ไม่ผูกเครื่อง/ชิ้นงานเฉพาะ · ผูกได้ถ้าต้องการ (machine_no/mat_no nullable)
    const { startedAt, endedAt, durMin } = computeDtTimes();
    if (!startedAt && !durMin) { toast.error('กรอกเวลาหรือระยะเวลาอย่างน้อย 1 อย่าง'); return; }
    // ประเภท "อื่นๆ" เปล่าๆ บอกอะไรไม่ได้ในสรุปประชุมเช้า/รายงาน — บังคับระบุสาเหตุจริงเสมอ
    const dtTypeName = dtTypes.find(t => t.id === dtForm.downtime_type_id)?.name_th || '';
    if (dtTypeName.includes('อื่น') && !dtForm.description?.trim()) {
      toast.error('ประเภท "อื่นๆ" ต้องระบุรายละเอียด/สาเหตุด้วย — เพื่อให้รายงานและประชุมเช้าอ่านรู้เรื่อง');
      return;
    }
    // นอกแผน (เครื่องเสีย) ส่วนใหญ่ควรระบุเครื่อง — ไม่บังคับ (พาร์ทหมด/ไฟดับทั้งโรงงานลงเครื่องไม่ได้)
    // แต่ไม่ปล่อยข้ามเงียบ: ถ้า unplanned แล้วไม่เลือกเครื่อง เด้งถามยืนยันก่อน (planned ไม่ผูกเครื่องอยู่แล้ว ไม่ถาม)
    const dtCat = dtTypes.find(t => t.id === dtForm.downtime_type_id)?.category;
    if (dtCat !== 'planned' && !dtForm.machine_no) {
      /* หน้างานมักพิมพ์เลขเครื่องลงช่อง "รายละเอียด" แทนการเลือกจากลิสต์ (เจอจริง "Robot 103 …")
         → ถ้าข้อความมีเลขที่ **ตรงกับทะเบียนจริง** ให้บอกไปเลยว่าน่าจะหมายถึงเครื่องไหน
         ⚠️ เสนอเท่านั้น ห้ามเติมให้เอง — เดาผิดแล้วประวัติเครื่องเพี้ยนย้อนยาก
         ⚠️ เทียบเฉพาะเลขยาว ≥3 ตัวอักษร (หลัง normCode) กัน false positive จากรหัสสั้นๆ */
      const noteHits = (() => {
        const n = normCode(dtForm.description || '');
        if (n.length < 3) return [];
        return (machines || [])
          .filter(m => m.machine_no && normCode(m.machine_no).length >= 3 && n.includes(normCode(m.machine_no)))
          .map(m => m.machine_no);
      })();
      const hint = noteHits.length
        ? `\n\n💡 หมายเหตุที่พิมพ์ไว้มีเลขเครื่อง: ${noteHits.slice(0, 3).join(', ')}\n   ถ้าใช่ กด "ยกเลิก" แล้วเลือกในช่องเครื่องจักร (ค้นหาได้ทั้งทะเบียน)`
        : '\n\n(ช่องเครื่องจักรค้นหาได้ทั้งทะเบียน — พิมพ์เลขเครื่องแล้วเลือกจากลิสต์)';
      const ok = window.confirm(
        'Downtime นอกแผนนี้ยังไม่ได้เลือกเครื่องจักร\n' +
        'ไม่ระบุเครื่อง = ต่อใบซ่อม / คิด OEE รายเครื่อง / จัดคิวให้ทีมช่างที่ถูก ไม่ได้' + hint +
        '\n\nยืนยันบันทึกโดยไม่เลือกเครื่อง? — เช่น พาร์ทหมด / ไฟดับทั้งโรงงาน');
      if (!ok) return;
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
  // CT ต่อ MAT — single source ที่ src/utils/oee.js (ทุกจอต้องใช้ตัวเดียวกัน ไม่งั้น P คนละชุด)
  const ctForMatNo = (matNo) => ctForMat(matNo, { kanbanStds, products });

  // นาที Downtime ที่ทับซ้อนกับช่วงเวลา [startMs, endMs] — ใช้หักจาก "เวลาที่ MAT.NO นี้วิ่งจริง" ก่อนเทียบ %P
  // เทียบด้วยช่วงเวลาจริง (started_at/ended_at) ไม่ใช่แค่ d.mat_no ตรงกัน เพราะ Downtime ของไลน์ร่วม (ไม่ระบุ MAT.NO)
  // ก็กระทบ MAT.NO ที่วิ่งซ้อนอยู่ในช่วงนั้นด้วย — ถ้าไม่หัก จะนับเวลาผลิตจริงเกิน ทำให้ %P เพี้ยน (เช่นเกิน 100%)
  const dtOverlapMin = (startMs, endMs, pred = () => true, logs = dtLogs, weightFn = () => 1) => {
    if (!startMs || !endMs || endMs <= startMs) return 0;
    return logs.filter(pred).reduce((sum, d) => {
      if (!d.started_at) return sum;
      const s0 = new Date(d.started_at).getTime();
      const e0 = d.ended_at ? new Date(d.ended_at).getTime() : s0 + (d.duration_min || 0) * 60000;
      const s = Math.max(s0, startMs), e = Math.min(e0, endMs);
      return e > s ? sum + ((e - s) / 60000) * weightFn(d) : sum;
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

  // ทุก process ที่มีอยู่จริงในกะนี้ (ไลน์ผสม เช่น LWR = laser (metal_forming) + Stationary (welding) —
  // เดิมใช้เสียงข้างมากตัวเดียว ทำให้ประเภท DT/งานเสียของอีก process มองไม่เห็น · คำสั่ง user 2026-07-22)
  // ใช้กับ "dropdown เลือกประเภท" เท่านั้น — break policy ยังใช้ sessionProcessType() (majority) กันหักเวลาพักซ้ำ
  const sessionProcessTypesAll = () => {
    const set = new Set();
    // ⚠️ ต้องกวาดทั้ง "ครอบครัวไลน์" (แม่+ลูกทั้งหมด) ไม่ใช่ชื่อไลน์ตรงเป๊ะ — กะมักเปิดบนไลน์ลูก (เช่น Laser LWB)
    // แต่เครื่อง welding (Stationary) ลงทะเบียนใต้ไลน์พี่น้อง/ไลน์แม่ → เทียบตรงตัวแล้วมองไม่เห็น (บั๊กจริง 2026-07-24)
    if (selSession?.line_name) {
      const famNames = new Set(getLineFamilyNames(lines, selSession.line_name).map(n => (n || '').trim().toLowerCase()));
      machines.filter(m => m.process_type && famNames.has((m.line_name || '').trim().toLowerCase())).forEach(m => set.add(m.process_type));
    }
    prodOrders.forEach(o => {
      const pt = kanbanStds.find(st => st.mat_no === o.mat_no)?.dr_products?.process_type;
      if (pt) set.add(pt);
    });
    if (!set.size) set.add(sessionProcessType());
    return set;
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

  // ผูกเครื่องกับใบ (ไลน์ parallel_machine) — เขียนแยก best-effort กันพังถ้ายังไม่ apply migration prod_orders.machine_no
  // ⚠️ supabase-js คืน { error } ไม่ throw — try/catch เปล่าคือกลืน error ทิ้ง (กฎเหล็ก 2026-08-10)
  //    ใบเปิดสำเร็จแล้ว การผูกเครื่องพลาดห้ามทำ flow หลักพัง แต่ต้องบอกผู้ใช้ (บอร์ดเลนจะจัดใบผิดเลน)
  const attachMachine = async (orderId) => {
    if (!orderId || !openMachineNo) return;
    const { error } = await supabaseDR.from('prod_orders').update({ machine_no: openMachineNo }).eq('id', orderId);
    if (error) {
      console.warn('attachMachine failed', error);
      toast.error(`เปิดใบสำเร็จ แต่ผูกเครื่อง ${openMachineNo} ไม่ได้ — ${error.code === '42703' ? 'ยังไม่ apply migration 20260723_prod_orders_machine.sql (แจ้ง admin)' : error.message}`);
    }
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
    // กันเปิดใบซ้ำจาก 2 เครื่องพร้อมกัน — dup check ฝั่ง client (state) มีหน้าต่าง race ~1-2 วิ
    // ด่านจริงคือ partial unique index (session_id, prod_no) ฝั่ง DB (migration 20260825) → แปลง 23505 เป็นภาษาคน
    if (error?.code === '23505') {
      return { error: { ...error, message: `PROD.NO ${prodNo} ถูกเปิดโดยเครื่องอื่นแล้วในกะนี้ — รีเฟรชรายการก่อน` }, data: null };
    }
    if (!error && status === 'open' && data?.id) await attachMachine(data.id);
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
      // กันกรอกเวลา "อนาคต" — เคยเจอจริง: ปิดใบ 04:35 แต่กรอกเวลาเริ่มย้อนหลัง 05:17 → ใบปิดก่อนเปิด 42 นาที
      const iso = backfillIsoFromTime(openProdForm.backfill_time);
      if (iso && new Date(iso) > new Date()) {
        toast.error(`เวลา ${openProdForm.backfill_time} ยังมาไม่ถึง — ยิงย้อนหลังต้องเป็นเวลาที่ผ่านมาแล้วเท่านั้น`);
        return;
      }
    }

    const dup = prodOrders.find(o => o.prod_no === prodNo);
    if (dup) {
      toast.error(`PROD.NO ${prodNo} เปิดไปแล้วในกะนี้ (${dup.status === 'confirmed' ? 'ปิดแล้ว' : 'กำลังผลิต'})`);
      return;
    }

    const std    = kanbanStds.find(s => s.mat_no === matNo);
    /* ⚠️ มีมาตรฐานคัมบัง = ใช้ค่ามาตรฐานเสมอ ไม่อ่านจากช่องกรอก
       ช่องถูกล็อก readOnly อยู่แล้ว แต่ state อาจค้างค่าเก่าได้ถ้ามีคนพิมพ์ MAT เองแล้วสลับไปมา
       จำนวนต่อใบเป็นข้อเท็จจริงของมาตรฐาน ไม่ใช่ค่าที่ฟอร์มถือ (คำสั่ง user 2026-08-24) */
    const qty    = std?.qty_per_kanban > 0 ? Number(std.qty_per_kanban) : parseInt(openProdForm.qty);
    const ctSec  = ctForMatNo(matNo);

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

  // ── ถอยใบที่สแกนปิดไปแล้ว (confirmed → open) ──────────────────
  // เคสจริง: หัวหน้ากลุ่มสแกนปิดเกินยอดที่ผลิตได้ / ปิดผิดใบ — ต้องย้อนได้ก่อนปิดกะ
  // ต้องถอน stock ที่ trigger trg_post_confirmed_output โพสต์อัตโนมัติตอนปิดใบด้วย
  // (ลบแถว ref_order_id + created_by='auto' — ตัวกันโพสต์ซ้ำของ trigger เช็คจากแถวนี้
  //  ลบแล้วสแกนปิดใหม่ trigger จะโพสต์ให้ใหม่ถูกต้อง) · อนุญาตเฉพาะกะที่ยังเปิดอยู่
  // เพราะหลังปิดกะ ยอด/OEE ถูก stamp ลง session แล้ว ถอยใบจะทำตัวเลขไม่ตรงกัน
  const handleRevertOrder = async (o) => {
    if (selSession?.status !== 'open') { toast.error('กะนี้ปิด/ส่งขออนุมัติปิดแล้ว — ถอยใบไม่ได้ (ยอดถูกสรุปไปแล้ว)'); return; }
    if (!window.confirm(
      `↩️ ถอยใบ ${o.prod_no} (${o.mat_no} · ${coalesceQty(o)} ชิ้น) กลับเป็น "กำลังผลิต"?\n\n` +
      `• ยอดที่รับเข้า stock อัตโนมัติตอนปิดใบจะถูกถอนออก\n` +
      `• ผลิตจบจริงแล้วค่อยสแกนปิดใหม่\n` +
      `• ระบบบันทึกไว้ว่าใครถอยใบนี้ (ตรวจย้อนหลังได้)`)) return;
    const upd = {
      status: 'open', confirmed_by: null, confirmed_at: null, qty_ok: null,
      reopened_by: fullName, reopened_at: new Date().toISOString(), reopen_count: (o.reopen_count || 0) + 1,
    };
    // ใบ manual: ตอนปิดใบ qty ถูกแทนด้วยยอดจริง — ถอยแล้วคืนเป้าเดิม (ยอดสะสม qty_actual คงไว้)
    if (o.is_manual) upd.qty = o.qty_target ?? o.qty;
    const { error } = await supabaseDR.from('prod_orders')
      .update(upd).eq('id', o.id).eq('status', 'confirmed'); // guard กันถอยซ้ำ/ชนกันสองเครื่อง
    if (error) { toast.error(error.message); return; }
    const { error: se } = await supabaseDR.from('line_stock_transactions')
      .delete().eq('ref_order_id', o.id).eq('type', 'issue').eq('created_by', 'auto');
    if (se) toast.error(`⚠️ ถอยใบแล้ว แต่ถอนยอด stock ไม่สำเร็จ: ${se.message} — แจ้ง Store ตรวจยอด ${o.mat_no}`);
    else toast.success(`↩️ ถอยใบ ${o.prod_no} กลับเป็น "กำลังผลิต" แล้ว (ถอนยอด stock ให้เรียบร้อย)`);
    loadProdOrders(selSession.id, selSession.line_name);
  };
  // ยอดชิ้นของใบไว้โชว์ใน confirm dialog (ใบสแกน = qty ตายตัวจาก kanban · manual = ยอดจริงที่ปิด)
  const coalesceQty = (o) => o.qty_ok ?? o.qty;

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
    // เลข order manual: MANUAL-YYMMDD-HHmmss-XX
    //   YYMMDD = วันงานของกะ (selSession.work_date ตัด 08:00 อยู่แล้ว) — กันเลขซ้ำข้ามวัน
    //   HHmmss = เวลานาฬิกาตอนกดเปิด · XX = สุ่ม 2 ตัว (กันชนกรณี 2 ไลน์กดวินาทีเดียวกัน)
    //   (prod_no ไม่ unique ในตารางโดยตั้งใจ — ยกยอดข้ามกะสร้างแถวใหม่ด้วย prod_no เดิม · ห้ามใส่ unique index)
    const p2 = n => n.toString().padStart(2, '0');
    const ymd = (selSession?.work_date || workDate()).replace(/-/g, '').slice(2);
    const rnd2 = Array.from({ length: 2 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
    const prodNo = `MANUAL-${ymd}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}-${rnd2}`;
    const backfillIso = manualForm.is_backfill && manualForm.backfill_time ? backfillIsoFromTime(manualForm.backfill_time) : null;
    if (backfillIso && new Date(backfillIso) > new Date()) {
      toast.error(`เวลา ${manualForm.backfill_time} ยังมาไม่ถึง — เปิดย้อนหลังต้องเป็นเวลาที่ผ่านมาแล้วเท่านั้น`);
      setSavingManual(false);
      return;
    }
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
    if (created?.id) await attachMachine(created.id);
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
    // ใบสแกนมีจำนวนตายตัวตาม kanban card — ทำเกินใบไม่ได้ (ใบ manual เป็นเป้าที่ตั้งเอง เกินได้)
    if (!o.is_manual && v > o.qty) {
      toast.error(`ใบนี้มี ${o.qty} ชิ้น กรอกเกินไม่ได้ — ถ้าทำครบแล้วให้สแกนปิดใบ`);
      return;
    }
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
      is_trial:         !!defectForm.is_trial,
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
    if (!defectForm.id) notifyEvent({
      event: 'defect_recorded', type: 'error', ref_table: 'defect_logs',
      line_name: selSession.line_name, actor: fullName,
      lines: [
        `🏭 ไลน์: ${selSession.line_name} · ${selSession.shift === 'day' ? 'กะเช้า' : 'กะดึก'} · 📅 ${selSession.work_date}`,
        `🚫 ${defectTypes.find(t => t.id === defectForm.defect_type_id)?.name_th || '(ไม่ระบุประเภท)'}${defectForm.is_trial ? ' 🧪 งานทดลอง' : ''}`,
        `🔩 ${defectForm.mat_no || '(ไม่ระบุชิ้นงาน)'} · ${label}`,
        defectForm.description ? `📝 ${defectForm.description}` : '',
      ],
    });
    toast.success(defectForm.id ? `แก้ไขงานเสีย: ${label} ✓` : `บันทึกงานเสีย: ${label} ✓`);
    setShowDefect(false);
    setDefectForm({ id: null, mat_no: '', defect_type_id: '', qty_ng: '0', qty_suspect: '0', qty_repair: '0', description: '', is_trial: false });
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
        // ⚠️ ธงใบ manual ต้องตามใบยกยอดไปด้วย (QC flow-audit #13) — เดิมหายเงียบ:
        //    ใบ manual ที่ยกมาถูกมองเป็นใบสแกน → ปุ่ม "✓ ปิดใบนี้ (ยอดจริง)" หาย
        //    ต้องพิมพ์ MANUAL-... ปิดแบบสแกน = qty_ok ถูกตั้งเป็นเป้าแทนยอดจริง
        ...(o.is_manual ? { is_manual: true, qty_target: remainQty } : {}),
        qty_actual:   0,
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

  /* wrapper บาง ๆ ครอบ policyBreakOverlapMin (utils/oee §3) — สูตรพักนโยบายมี "ที่เดียว"
     (QC audit 2026-08-20 · รอบ 5: เดิมไฟล์นี้ถือสูตรเอง 1 ชุด ขณะที่แท็บประวัติ
     (histBreakOverlapMin) ครอบ util กลางอยู่แล้ว = ไฟล์เดียว 2 มาตรฐาน → ยุบเหลือกลาง)
     ⚠️ ต่างจากของเดิม 1 จุดโดยตั้งใจ: policy ที่ process_type = null/'' นับด้วย
     (null = ไม่ระบุ = ใช้ทุกกระบวนการ — มาตรฐานเดียวกับแท็บประวัติ/OEE Analytics/FactoryMap
     ของเดิมตัด null ทิ้ง = ไฟล์เดียวกันตอบเวลาพักไม่เท่ากันระหว่างจอปิดกะกับจอประวัติ) */
  const computePolicyBreakMin = (openedAt, closedAt, sessionShift, processType) =>
    policyBreakOverlapMin({
      policies: breakPolicies,
      startMs: openedAt ? openedAt.getTime() : 0,
      endMs: closedAt ? closedAt.getTime() : 0,
      workDate: selSession?.work_date || (openedAt ? workDate(openedAt) : null),
      shift: sessionShift,
      processType,
    });

  // dtLogsOverride: ใช้ตอนปิดกะที่เพิ่งปิด/ตัดยอด Downtime เปิดค้างไปใน call เดียวกัน — state dtLogs ยังเป็นค่าเก่า
  const computeOEE = (ngQtyOverride, endTimeOverride, startTimeOverride, dtLogsOverride) => {
    const dtl = dtLogsOverride || dtLogs;
    const confirmedQty = prodOrders.filter(o => o.status === 'confirmed').reduce((s, o) => s + o.qty, 0);
    /* ยอดของใบที่ "ไม่ปิด" — ตอนปิดกะใบยังเป็น open + ค่าอยู่ใน state carryQtyActual
       แต่ตอน "✏️ แก้เวลากะ" (กะปิดไปแล้ว) ใบกลายเป็น carry_over/cancelled และ state ว่าง
       → ต้อง fallback ไป o.qty_actual ไม่งั้นยอดที่ยกยอดหายจากการคำนวณทั้งก้อน
       เคสหนัก: กะที่ผลิตไม่จบสักใบ → totalProduced = 0 → noProduction → stamp A/Q/OEE เป็น null ทั้งกะ */
    const carryActualQty = prodOrders
      .filter(o => ['open', 'carry_over', 'cancelled'].includes(o.status))
      .reduce((s, o) => s + (parseInt(carryQtyActual[o.id]) || Number(o.qty_actual) || 0), 0);
    const totalProduced  = confirmedQty + carryActualQty;
    // ⚠️ Q ไม่นับ "งานทดลอง" (is_trial / ประเภทที่ตั้ง excl_from_q) — ของเสียจากการลองแม่พิมพ์/ลองงานใหม่
    // ไม่ควรลงโทษ OEE ของไลน์ · ยอดเต็มยังอยู่ครบใน defect_logs ให้เอาไปคิดมูลค่าของเสีย
    const ngQty = ngQtyOverride !== undefined ? ngQtyOverride : sumDefectQty(defectLogs, 'line');
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
    // ไลน์เครื่องขนาน (เช่น LASER-345/789 เลเซอร์ 3 ตัว): DT ที่ผูกเครื่อง = เครื่องเดียวหยุด
    // อีก N-1 ตัวยังวิ่ง → หักเวลาไลน์แค่ 1/N ของนาทีที่ลง · DT ไม่ระบุเครื่อง (ไฟดับ/รอวัตถุดิบ
    // ทั้งไลน์) = หยุดทั้งไลน์ หักเต็มเหมือนเดิม — เคสจริง 2026-08-04: DT รายเครื่อง 3 ตัวถูกบวกรวม
    // แล้วหักจากเวลาไลน์เดียว → %A โดนกดเป็น 0 ทั้งที่ของออก 400 ชิ้น
    // N มาจาก parallel_stations (ตั้งที่ LineSetup) ซึ่งแยกจาก flow_mode แล้ว (2026-08-05):
    // ไลน์งานคู่ LH/RH อย่าง LASER-345/789 เป็น one_piece_flow บนบอร์ด (ไม่ dispatch ผูกเครื่อง)
    // แต่ยังหัก DT 1/3 ได้ · parallel_machine ที่ไม่ตั้ง stations = fallback นับเครื่อง active ของไลน์
    const lf = lineFlow[selSession?.line_name] || {};
    const parallelN = parallelUnitsOf(lf,
      new Set(machines.filter(m => m.line_name === selSession?.line_name && m.is_active !== false).map(m => m.machine_no)).size);
    const dtW = d => (parallelN > 1 && d.machine_no) ? 1 / parallelN : 1;
    const loggedPlannedDT  = dtl.filter(d => d.dr_downtime_types?.category === 'planned').reduce((s, d) => s + (d.duration_min || 0) * dtW(d), 0);
    const loggedUnplannedDT = dtl.filter(d => d.dr_downtime_types?.category !== 'planned').reduce((s, d) => s + (d.duration_min || 0) * dtW(d), 0);
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
      const matLoggedPlanned   = dtOverlapMin(matStartMs, matEndMs, d => d.dr_downtime_types?.category === 'planned', dtl, dtW);
      const matLoggedUnplanned = dtOverlapMin(matStartMs, matEndMs, d => d.dr_downtime_types?.category !== 'planned', dtl, dtW);
      const matNetAvail = Math.max(0, windowMin - matPolicyBreakMin - matLoggedPlanned);
      const matRunMin   = Math.max(0, matNetAvail - matLoggedUnplanned);
      totalNetAvailByMat += matNetAvail;
      totalRunMinByMat   += matRunMin;
      matRunMinMap[matNo] = matRunMin; // เก็บ run ต่อ MAT.NO — ใช้เป็น denominator ของ P ตอน parallel
    });
    // DT ที่กรอกแค่จำนวนนาที (ไม่มีเวลาเริ่ม) — dtOverlapMin จับไม่ได้ → เคยหายเงียบจาก %A แบบแยกตาม MAT
    // (เคสจริง 2026-07-24: หยุดนอกแผน 20 นาทีแต่ %A = 100) — หักที่ยอดรวมแทน (รวมก่อนหาร ไม่ต้องรู้ตกช่วง MAT ไหน)
    const untimedPlanned   = dtl.filter(d => !d.started_at && d.dr_downtime_types?.category === 'planned').reduce((s, d) => s + (d.duration_min || 0) * dtW(d), 0);
    const untimedUnplanned = dtl.filter(d => !d.started_at && d.dr_downtime_types?.category !== 'planned').reduce((s, d) => s + (d.duration_min || 0) * dtW(d), 0);
    if (totalNetAvailByMat > 0 && (untimedPlanned || untimedUnplanned)) {
      totalNetAvailByMat = Math.max(0, totalNetAvailByMat - untimedPlanned);
      totalRunMinByMat   = Math.max(0, totalRunMinByMat - untimedPlanned - untimedUnplanned);
    }
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
      // ต้องนับใบที่ไม่ปิดเหมือนกับ totalProduced ข้างบน (ไม่งั้น %P ของ MAT นั้นหายตอนแก้เวลากะ)
      const qty = orders.filter(o => o.status === 'confirmed').reduce((s, o) => s + o.qty, 0)
                + orders.filter(o => ['open', 'carry_over', 'cancelled'].includes(o.status))
                        .reduce((s, o) => s + (parseInt(carryQtyActual[o.id]) || Number(o.qty_actual) || 0), 0);
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

    // ── ตรวจ parallel ระดับ "product" ไม่ใช่ระดับ MAT.NO (user ชี้ 2026-07-14) ──
    // MAT ที่เป็น product เดียวกันแตกตามลูกค้า (เช่น FVL/FTM/AAT — ชื่อชิ้นงานเดียวกัน) คืองานตัวเดียวกัน
    // แค่ส่งแยกลูกค้า → ขึ้น parallel กันเองไม่ได้ ให้รวมเป็นสายเดียวก่อน แล้วค่อยเช็ค overlap ระหว่าง
    // "คนละ product จริงๆ" (ซึ่ง parallel ได้ถ้าวิ่งคนละเครื่อง/สถานี) · เกณฑ์ overlap ต้องมีนัยยะ:
    // > 15 นาที และ > 20% ของ window ที่สั้นกว่า — จังหวะสแกนปิดชุดเก่าคาบเกี่ยวเปิดชุดใหม่ไม่นับ
    // เคยพัง 2026-07-13: Line 60 กะดึก 2 MAT (product เดียวกันคนละลูกค้า) window ทับ 2 นาที → P ตกเหลือ 44%
    const prodNameOf = (matNo) => (kanbanStds.find(s => s.mat_no === matNo)?.dr_products?.name || matNo || '').trim().toUpperCase();
    const prodGroupMap = {};
    matPData.forEach(d => {
      const k = prodNameOf(d.matNo);
      const g = (prodGroupMap[k] ||= { stdSec: 0, runMin: 0, ws: null, we: null });
      g.stdSec += d.qty * d.ctSec;
      g.runMin += matRunMinMap[d.matNo] ?? 0;
      if (d.winStart != null) g.ws = g.ws == null ? d.winStart : Math.min(g.ws, d.winStart);
      if (d.winEnd != null) g.we = g.we == null ? d.winEnd : Math.max(g.we, d.winEnd);
    });
    const prodGroups = Object.values(prodGroupMap);
    const overlapOf = (a, b) => Math.max(0, (Math.min(a.we, b.we) - Math.max(a.ws, b.ws)) / 60000);
    const isParallel = prodGroups.length > 1 && prodGroups.some((a, i) =>
      prodGroups.slice(i + 1).some(b => {
        if (a.ws == null || a.we == null || b.ws == null || b.we == null) return false;
        const ov = overlapOf(a, b);
        const minDurMin = Math.min(a.we - a.ws, b.we - b.ws) / 60000;
        return ov > 15 && ov > 0.2 * minDurMin;
      })
    );

    /* ⚠️ ไลน์เครื่องขนาน (parallel_machine เช่น SUB APRON): CT เป็น "ต่อเครื่อง" งานกระจายอยู่หลายเครื่อง
       → ตัวหารต้องเป็น "เวลาเครื่อง" ไม่ใช่ "เวลาไลน์" · ต้องใช้สาย parallel เสมอ ห้ามพึ่ง heuristic
       isParallel (ทับกัน >15 นาที + >20%) ซึ่งเป็น all-or-nothing: บางกะเข้าเงื่อนไข บางกะไม่เข้า
       → P พลิกไปมา 52/76/89/100 แล้ว cap 100 เงียบ (SUB APRON 14 กะ ชนเพดาน 6 กะ · 2026-08-13)
       ไลน์ผลิตต่อเนื่อง (one_piece_flow เช่น LASER-345/789) CT เป็นของทั้งไลน์อยู่แล้ว → ห้ามแตะ
       (เช็คแล้ว หารจำนวนเครื่องจะทำ P ร่วงจาก 63-98% เหลือ 21-33%) */
    const perMachineCt = flowModeOf(lf.flow_mode) === 'parallel_machine';
    let P = null, pRawRatio = null;   // pRawRatio = ค่าก่อน cap 100% — ใช้เตือนเมื่องาน > เวลาเครื่องที่มี
    if (runSec > 0 && matPData.length > 0) {
      const totalStdSec = matPData.reduce((s, d) => s + d.qty * d.ctSec, 0);
      if (isParallel || perMachineCt) {
        // Parallel (คนละ product วิ่งพร้อมกันคนละสถานี): denominator = Σ run ต่อ product group
        // = ถ่วงน้ำหนัก P ตามเวลารันจริงของแต่ละสถานี — ห้ามใช้ mean เท่าๆ กัน
        // (เคยพัง 2026-07-13: งานแทรก 10 ชิ้น/10 นาที window ทับงานหลัก → mean ลาก P ทั้งกะ
        //  จาก ~93% เหลือ 48% ทั้งที่งานแทรกวิ่งเต็มประสิทธิภาพในช่วงของมันเอง)
        // clamp [runSec, N×runSec]: ต่ำกว่าเวลาไลน์ = P เฟ้อ · สูงกว่า N เท่า = อ้างว่ามีเครื่องมากกว่าที่มีจริง
        const rawDenom = prodGroups.reduce((s, g) => s + g.runMin * 60, 0) || runSec;
        const denomSec = perMachineCt
          ? Math.min(Math.max(rawDenom, runSec), runSec * Math.max(1, parallelN))
          : rawDenom;
        pRawRatio = totalStdSec / denomSec;
        P = Math.min(1, pRawRatio);
      } else {
        // Sequential: standard time รวมหารด้วย run_time ทั้งกะ (จับ idle ระหว่าง MAT.NO ด้วย)
        pRawRatio = totalStdSec / runSec;
        P = Math.min(1, pRawRatio);
      }
    }
    // Q = ของดี / ผลิตจริง(ดี+เสีย) — การ์ดที่สแกนปิด = "ของดีล้วน" (ผลิตครบเป้าของดี · ของเสียผลิตเพิ่มต่างหาก
    // แล้วลง NG แยก · user ยืนยัน 2026-08-02) ดังนั้น totalProduced = ของดี, ผลิตจริงทั้งหมด = ของดี + NG
    // ห้ามใช้ (ดี−NG)/ดี ที่หักซ้ำ → เคยทำ %Q ต่ำเกินจริง (เช่น ดี10 NG1 ได้ 90% ที่ถูกคือ 10/11=90.9%,
    // เคสหนักดี100 NG50 ได้ 50% ที่ถูก 66.7%)
    const Q = totalProduced > 0 ? totalProduced / (totalProduced + ngQty) : 1;
    const oee = P != null ? A * P * Q : null;
    /* pOver = P ทะลุ 100% ก่อนโดน cap → งานมาตรฐานที่บันทึกมากกว่าเวลาเครื่องที่มีจริง
       แปลว่ามีอะไรผิดในข้อมูล (CT / ยอดที่กรอก / เวลาเปิด-ปิดใบ / จำนวนเครื่องขนาน)
       ต้องเตือนตอนปิดกะ ห้าม cap เงียบ — ถ้ามี guard นี้แต่แรกจะจับได้ตั้งแต่กะแรก
       แทนที่จะปล่อยจน OEE ของทั้งไลน์อ่านไม่ได้ 14 กะโดยไม่มีใครรู้ (2026-08-13) */
    return { A, P, Q, oee, shiftMin, netAvail, runMin, policyBreakMin, plannedDT, totalProduced, ngQty, knownQty, unknownQty,
      pOver: pRawRatio != null && pRawRatio > 1.001, pRawPct: pRawRatio == null ? null : Math.round(pRawRatio * 1000) / 10 };
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
      // และแจ้งเฉพาะรายการที่ "เคยถูกแจ้ง" แล้วเท่านั้น (open_alerted_at/call_mtn) —
      // รายการที่ไม่เคยดังก็เงียบ ไม่รก (กฎ downtime overhaul 2026-07-14 — เหมือน guard ใน handleAddDT)
      if (decision === 'close' && (d.open_alerted_at || d.call_mtn)) {
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
        // ⚠️ ใบ manual ทำ "เกินเป้า" ได้ (guard จำนวนยกเว้น is_manual) — เขียนทับด้วยเป้า (order.qty)
        //    = ยอดจริงส่วนเกินหาย + เข้าคลังต่ำกว่าจริง (QC flow-audit #15) → ใช้ยอดจริงแบบ handleManualClose
        //    ใบสแกนปกติ qty = จำนวนการ์ดคัมบัง (ของดีตายตัว) คงพฤติกรรมเดิม
        const isManual = !!order.is_manual;
        const finalQty = isManual ? Math.max(qActual, order.qty_actual || 0, order.qty || 0) : order.qty;
        await supabaseDR.from('prod_orders').update({
          status:       'confirmed',
          qty_actual:   finalQty,
          ...(isManual ? { qty: finalQty, qty_ok: finalQty } : {}),
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
    // ยอดดี = ยอดผลิต (การ์ดที่สแกน = ของดีล้วน · NG/suspect/repair คือของที่ผลิตเพิ่มต่างหาก ไม่หักซ้ำ · 2026-08-02)
    const totalQtyOk      = totalProducedFinal;

    /* ⚠️ NG ที่เข้าสูตร Q ต้อง "ไม่รวมงานทดลอง" — ใช้ sumDefectQty(...,'line') เท่านั้น
       เดิมส่ง totalQtyNg + totalQtySuspect (ผลรวมดิบทุกแถว) → ธง is_trial/excl_from_q
       ไม่เคยมีผลกับค่าที่ stamp เลย ขณะที่จอสด (FactoryMap/Dashboard) กรองถูก = Q คนละตัวระหว่าง 2 จอ
       ส่วน qty_ng/qty_suspect ที่เขียนลง production_sessions ยังเป็น "ผลรวมดิบ" ตามเดิม
       (เป็นยอดรายงานของเสียทั้งหมด ไม่ใช่ตัวคิด Q — ห้ามกรอง ตามกฎ oee.js §7) */
    const { A, P, Q, oee, shiftMin } = computeOEE(sumDefectQty(defectLogs, 'line'), closeEndTime, closeStartTime, updatedDtLogs);
    // กะที่ไม่มีผลผลิตเลย (เปิดผิด/นับสต๊อก) — A/Q ไม่มีความหมายกับ OEE (P/OEE เป็น null อยู่แล้ว)
    // ต้อง stamp oee_a/oee_q เป็น null ด้วย ไม่งั้นเลข 100/0 รั่วเข้าค่าเฉลี่ย %A/%Q ในกราฟเทรนด์
    // (สอดคล้อง cleanup migration 20260715_oee_null_noproduction_cleanup.sql — กันไม่ให้ค้างตั้งแต่ปิดกะ)
    const noProduction = totalProducedFinal === 0 && P == null;
    const oeeA = noProduction ? null : parseFloat((A * 100).toFixed(2));
    const oeeP = P != null ? parseFloat((P * 100).toFixed(2)) : null;
    const oeeQ = noProduction ? null : parseFloat((Q * 100).toFixed(2));
    const oeeV = oee != null ? parseFloat((oee * 100).toFixed(2)) : null;
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
      oee_a:                   oeeA,
      oee_p:                   oeeP,
      oee_q:                   oeeQ,
      oee:                     oeeV,
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
      oee_a:           oeeA,
      oee_p:           oeeP,
      oee_q:           oeeQ,
      oee:             oeeV,
    };

    const { error } = await supabaseDR.from('production_sessions').update(payload).eq('id', selSession.id);
    setSavingClose(false);
    if (error) { toast.error(error.message); return; }

    // หมายเหตุของผู้ขอปิดกะ + เคลียร์ร่องรอยการถูกปฏิเสธรอบก่อน (ส่งขอใหม่แล้ว = ไม่ค้างสถานะถูกตีกลับ
    // ไม่งั้นไอคอน ✕ ในลิสต์กะค้างอยู่ทั้งที่แก้แล้ว) — update แยก best-effort เหมือน close_approve_note
    // ยังไม่ apply migration = ปิดกะได้ปกติ แค่ยังไม่เก็บ/ยังไม่เคลียร์ข้อความ
    // ⚠️ supabase-js "คืน" { error } ไม่ได้ throw → try/catch เฉยๆ จะกลืน error ทิ้งเงียบ
    // ต้องเช็ค error เองแล้วบอกผู้ใช้ ไม่งั้นหมายเหตุหายโดยไม่มีใครรู้ (กฎ: ห้ามล้มเหลวเงียบ)
    try {
      const { error: noteErr } = await supabaseDR.from('production_sessions').update({
        close_request_note:   closeNote.trim() || null,
        close_reject_reason:  null,
        close_reject_by_name: null,
        close_reject_at:      null,
      }).eq('id', selSession.id);
      if (noteErr) {
        console.warn('[close] เก็บหมายเหตุ/เคลียร์สถานะปฏิเสธไม่สำเร็จ', noteErr);
        if (closeNote.trim()) toast.error('ปิดกะเรียบร้อย แต่ "หมายเหตุ" ยังบันทึกไม่ได้ — ยังไม่ได้ apply migration close_request_note (แจ้ง admin)');
      }
    } catch (e) { console.warn('[close] note update exception', e); }

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
    // remark ผู้อนุมัติ (optional) — update แยก best-effort: ยังไม่ apply migration close_approve_note = อนุมัติได้ปกติ
    if (approveNote.trim()) {
      // เช็ค error เอง — supabase-js คืน { error } ไม่ throw (try/catch เฉยๆ กลืนทิ้ง)
      try {
        const { error: apErr } = await supabaseDR.from('production_sessions').update({ close_approve_note: approveNote.trim() }).eq('id', selSession.id);
        if (apErr) {
          console.warn('[approve] เก็บหมายเหตุผู้อนุมัติไม่สำเร็จ', apErr);
          toast.error('อนุมัติปิดกะแล้ว แต่ "หมายเหตุ" ยังบันทึกไม่ได้ — ยังไม่ได้ apply migration close_approve_note (แจ้ง admin)');
        }
      } catch (e) { console.warn('[approve] note update exception', e); }
    }
    setApproveNote('');

    // Line Stock หักโดย DB trigger บน prod_orders (backflush ตอน confirmed) — ไม่หักซ้ำที่นี่

    toast.success(`อนุมัติปิดกะแล้ว ✓ (ขอโดย ${selSession.close_requested_by_name || '—'})`);
    notifyProdClose({
      status: 'closed_approved', line_name: selSession.line_name, shift: selSession.shift,
      work_date: selSession.work_date, actor: fullName,
      approve_note: approveNote.trim() || null, // หมายเหตุผู้อนุมัติ → โชว์ใน Telegram ด้วย (2026-07-24)
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
    const reason = rejectReason.trim();
    if (!reason) { toast.error('กรุณาระบุสิ่งที่ต้องกลับไปแก้ไข (remark) ให้หัวหน้ากลุ่มทราบ'); return; }
    setSavingReject(true);
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
    if (error) { setSavingReject(false); toast.error(error.message); return; }
    // เก็บ remark แยกเป็น update best-effort — ถ้ายังไม่ได้ apply migration (คอลัมน์ยังไม่มี) การปฏิเสธยังทำงานปกติ
    // แค่ยังไม่บันทึกข้อความ (ค่อยเก็บได้หลัง migration) — ไม่ให้ feature ใหม่ทำ flow หลักพัง
    // ⚠️ supabase-js คืน { error } ไม่ throw — ต้องเช็คเอง ไม่งั้นเหตุผลที่ SV พิมพ์หายเงียบ
    // (หัวหน้ากลุ่มจะเห็นแบนเนอร์เปล่าๆ ไม่รู้ว่าต้องแก้อะไร + ไอคอน ✕ ในลิสต์กะจะไม่ขึ้น)
    try {
      const { error: rejErr } = await supabaseDR.from('production_sessions').update({
        close_reject_reason:  reason,
        close_reject_by_name: fullName,
        close_reject_at:      new Date().toISOString(),
      }).eq('id', selSession.id);
      if (rejErr) {
        console.warn('[reject] เก็บเหตุผลปฏิเสธไม่สำเร็จ', rejErr);
        toast.error('ปฏิเสธคำขอแล้ว แต่ "เหตุผล" ยังบันทึกไม่ได้ — ยังไม่ได้ apply migration close_reject_reason (แจ้ง admin) · กรุณาแจ้งหัวหน้ากลุ่มด้วยวิธีอื่น');
      }
    } catch (e) { console.warn('[reject] reason update exception', e); }
    setSavingReject(false);
    setShowRejectModal(false);
    setRejectReason('');
    toast.info('ปฏิเสธคำขอปิดกะ — ส่งให้หัวหน้ากลุ่มกลับไปแก้ไข');
    notifyProdClose({
      status: 'closed_rejected', line_name: selSession.line_name, shift: selSession.shift,
      work_date: selSession.work_date, actor: fullName,
      requested_by: selSession.close_requested_by_name,
      reject_reason: reason,
    });
    load();
    setSelSession(prev => ({ ...prev, status: 'open', close_requested_by_name: null,
      close_reject_reason: reason, close_reject_by_name: fullName }));
  };

  // ลบกะที่เปิดผิด (เปล่า — ไม่มี Order/Downtime/Defect) ได้จากจอ Live เลย ไม่ต้องปิดกะแล้วไปลบที่ประวัติ
  const handleDeleteEmptySession = async () => {
    if (!selSession) return;
    // กันเหนียว: ลบได้เฉพาะกะที่ไม่มีข้อมูลจริง (กันลบกะที่มีการผลิต/บันทึกไปแล้ว)
    if (prodOrders.length > 0 || dtLogs.length > 0 || defectLogs.length > 0) {
      toast.error('กะนี้มีข้อมูลแล้ว (Order/Downtime/Defect) — ลบไม่ได้ ต้องปิดกะแล้วลบที่แท็บประวัติ');
      return;
    }
    if (!window.confirm(`ลบกะ ${selSession.line_name} ${selSession.shift === 'day' ? 'กะเช้า' : 'กะดึก'} ${fmtDate(selSession.work_date)} ?\n(กะเปล่าที่เปิดผิด — ไม่มีข้อมูลการผลิต)`)) return;
    const { error } = await supabaseDR.from('production_sessions').delete().eq('id', selSession.id);
    if (error) { toast.error('ลบไม่สำเร็จ: ' + error.message); return; }
    toast.success('ลบกะที่เปิดผิดเรียบร้อย');
    setSelSession(null);
    load();
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
      id: d.id, // ให้ send-notification จำ message_id ผูกรายการนี้ — reply ใน Telegram = คอมเมนต์
      line_name: selSession.line_name, shift: selSession.shift, work_date: selSession.work_date,
      machine_no: d.machine_no, machine_name: mcName,
      type_name: dtType?.name_th || '', category: dtType?.category || '',
      start_time: d.started_at ? fmtTime(new Date(d.started_at)) : null,
      description: d.description || null, reported_by: fullName,
    }, 'downtime_call_mtn');
    toast.success('📞 เรียกช่าง MTN แล้ว — แจ้งเตือนทันที');
    loadDT(selSession.id);
  };

  // เปิดใบแจ้งซ่อม MO จากรายการ Downtime (เชื่อมกับหน้าแจ้งซ่อม MTN) — prefill เครื่อง/ไลน์/อาการ
  // เปิด picker เลือกทีมช่างก่อน (แจกให้ถูกทีม) — เดา default จากชื่อเครื่อง (JIG/DIE)
  const openMoPicker = async (d) => {
    const { data: exist } = await supabaseDR.from('mtn_orders').select('id, mo_no').eq('source_downtime_id', d.id).maybeSingle();
    if (exist) { toast.info(`มีใบแจ้งซ่อมของรายการนี้แล้ว${exist.mo_no ? ` (${exist.mo_no})` : ''}`); return; }
    setMoDtPick({ d, team: teamForItem(d.machine_no) });
  };

  const handleCreateMoFromDt = async (d, team) => {
    const dtType = dtTypes.find(t => t.id === d.downtime_type_id);
    const payload = {
      status: 'pending', current_step: 1, report_at: new Date().toISOString(), work_date: selSession.work_date,
      repair_scope: 'in_line', line_name: selSession.line_name, dept_section: selSession.section || null,
      mtn_dept: teamKeyOf(team) || 'maintenance', machine_no: d.machine_no || null, problem_characteristic: 'อื่นๆ',
      report_note: `[จาก Downtime] ${dtType?.name_th || ''}${d.description ? ` — ${d.description}` : ''}`.trim(),
      reporter_prod: fullName, reported_by_name: fullName, source_downtime_id: d.id,
    };
    const { data, error } = await supabaseDR.from('mtn_orders').insert(payload).select().single();
    if (error) { toast.error(error.message); return; }
    fetch('https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-mtn-notification', {
      // ส่ง "ชื่อทีม" ไปในข้อความแจ้งเตือน (DB เก็บรหัส) — ดูเหตุผลที่ notifyMtn ใน MtnRepair.jsx
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'mtn_reported', mo: { ...data, mtn_dept: deptNameOf(data.mtn_dept) } }),
    }).catch(() => {});
    setMoDtPick(null);
    toast.success(`📝 เปิดใบแจ้งซ่อม MO → แจ้งถึงทีม ${deptNameOf(team) || 'MTN'} แล้ว — ไปดำเนินการต่อที่หน้า “แจ้งซ่อม MTN”`);
  };

  const totalDT      = dtLogs.reduce((s, d) => s + (d.duration_min || 0), 0);
  const unplannedDT  = dtLogs.filter(d => d.dr_downtime_types?.category === 'unplanned').reduce((s, d) => s + (d.duration_min || 0), 0);

  if (loading) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>กำลังโหลด...</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: (sessions.length > 1 && !isMobile) ? '220px 1fr' : 'minmax(0, 1fr)', gap: 16 }}>
      {sessions.length > 1 && (
        // §137: sidebar sticky ค้างในจอ + list เลื่อนในตัว — ขอบล่างชิดขอบจอเสมอ (ไม่ตัดกลางอากาศตอนเลื่อนหน้า)
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'sticky', top: 12, alignSelf: 'start', maxHeight: 'calc(100vh - 24px)', minWidth: 0 }}>
          {(() => {
            const groupNames = [...new Set(freshSessions.map(s => lineMap[s.line_name]?.parent_line_name || s.line_name))];
            const allCollapsed = groupNames.length > 0 && groupNames.every(n => sessGroupCollapsed.has(n));
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexShrink: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                  กะที่เปิดอยู่ ({freshSessions.length}{staleSessions.length ? ` + ค้าง ${staleSessions.length}` : ''})
                </div>
                {groupNames.length > 1 && (
                  // ⚠️ คง STALE_BUCKET_KEY ไว้เสมอ — ปุ่มนี้คุม "กลุ่มไลน์" ไม่ใช่ถังกะค้าง (ถังมีปุ่มของตัวเอง)
                  <button onClick={() => { const keep = sessGroupCollapsed.has(STALE_BUCKET_KEY) ? [STALE_BUCKET_KEY] : [];
                    persistSessGroups(new Set(allCollapsed ? keep : [...groupNames, ...keep])); }}
                    title={allCollapsed ? 'กางทุกกลุ่ม' : 'ย่อทุกกลุ่ม'}
                    style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 7px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer' }}>
                    {allCollapsed ? '▼ กางทั้งหมด' : '▶ ย่อทั้งหมด'}
                  </button>
                )}
              </div>
            );
          })()}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
          {(() => {
            // จัดกลุ่มตามไลน์แม่ (ไลน์เดี่ยว = เป็นกลุ่มของตัวเอง)
            const renderGroups = (list) => {
            const groups = {};
            list.forEach(s => {
              const parent = lineMap[s.line_name]?.parent_line_name || s.line_name;
              if (!groups[parent]) groups[parent] = [];
              groups[parent].push(s);
            });
            return Object.entries(groups).map(([groupName, groupSessions]) => {
              /* ⚠️ หัวกลุ่มต้องขึ้น "ทุกกลุ่ม" — เดิมโชว์เฉพาะกลุ่มที่มีสมาชิกเป็นไลน์ลูก
                 → ไลน์เดี่ยว (เช่น LINE ASSY TSRA ที่ไม่มีไลน์แม่) ไม่มีหัวข้อของตัวเอง
                   เลยไหลไปต่อท้ายหัวข้อของกลุ่มก่อนหน้า ดูเหมือนเป็นไลน์ลูกของกลุ่มนั้น (user ทัก) */
              /* ⚠️ กลุ่มที่มี "กะที่เลือกอยู่" ต้องย่อได้ด้วย (user 2026-08-26 · เจอจริง 51 กะ:
                 HYDROFORM 18 · LWR BAR 10 — เดิมล็อกไม่ให้ย่อกลุ่มที่กำลังเลือก กลุ่มนั้นเลยกางค้าง
                 เบียดกลุ่มอื่นตกจอ หาไลน์ถัดไปไม่เจอ)
                 แต่เจตนาเดิม "กะที่เลือกต้องไม่หายจากสายตา" ยังต้องอยู่
                 → ย่อแล้วเหลือ **แถวเดียวคือกะที่เลือก** + บอกจำนวนที่ซ่อน (ห้ามซ่อนเงียบ) */
              const hasSel = groupSessions.some(s => s.id === selSession?.id);
              const collapsed = sessGroupCollapsed.has(groupName);
              const shownSessions = collapsed ? groupSessions.filter(s => s.id === selSession?.id) : groupSessions;
              const hiddenInGroup = groupSessions.length - shownSessions.length;
              return (
              <div key={groupName}>
                <button onClick={() => toggleSessGroup(groupName)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 11, fontWeight: 800, color: 'var(--muted)', padding: '6px 4px 2px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                  <span style={{ fontSize: 9 }}>{collapsed ? '▶' : '▼'}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{groupName}</span>
                  {/* ย่อแล้วแต่ยังโชว์กะที่เลือก → บอกให้ชัดว่าตัวเลขคือ "ทั้งกลุ่ม" ไม่ใช่จำนวนที่เห็น */}
                  <span style={{ fontWeight: 600 }}>{collapsed && hasSel ? `1/${groupSessions.length}` : groupSessions.length}</span>
                </button>
                {shownSessions.map(s => (
                  <button key={s.id} onClick={() => setSelSession(s)}
                    style={{ display: 'block', width: '100%', marginBottom: 4, padding: lineMap[s.line_name]?.parent_line_name ? '8px 10px 8px 16px' : '10px 12px',
                      borderRadius: 8, border: `2px solid ${selSession?.id === s.id ? 'var(--accent)' : 'var(--border)'}`,
                      background: selSession?.id === s.id ? 'var(--accent-dim)' : 'var(--card)', cursor: 'pointer', textAlign: 'left' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                      {/* ชื่อไลน์ยาว (LINE ASSY TSRA) ต้องหดได้ ไม่งั้นดันชิปสถานะตกขอบ sidebar 220px */}
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.line_name}</div>
                      {/* ⏳ = ส่งไปแล้ว "รอ SV" (ลูกบอลอยู่ฝั่งเขา) — เป็นสถานะที่เจอเยอะสุด จึงเอาแค่ไอคอน */}
                      {s.status === 'pending_close' && <span title="ส่งขอปิดกะแล้ว — รอ SV อนุมัติ" style={{ fontSize: 11, fontWeight: 800, padding: '2px 5px', borderRadius: 10, background: 'rgba(245,158,11,0.2)', color: '#f59e0b' }}>⏳</span>}
                      {/* ถูกตีกลับ = "ลูกบอลอยู่ฝั่งเรา ต้องกลับไปแก้" — ต้องแยกจาก ⏳ ให้ขาด
                          ⚠️ ห้ามใช้ ✕ (ในหน้าเดียวกัน "✕ ปฏิเสธ" คือปุ่มกด คนจะนึกว่ากดแล้วลบ/ปิด)
                          ⚠️ ห้ามใช้ ↩️ (หน้านี้ใช้เป็น "ถอยใบ" ของ order ไปแล้ว)
                          → ใช้ชิปข้อความสั้น อ่านออกทันทีไม่ต้องเดาความหมายไอคอน · แดงนิ่ง ไม่กระพริบ (ไม่ใช่ alarm) */}
                      {s.status === 'open' && s.close_reject_at && (
                        <span title={`ถูกตีกลับโดย ${s.close_reject_by_name || '—'}${s.close_reject_reason ? ` — "${s.close_reject_reason}"` : ''} · แก้แล้วกดขอปิดกะใหม่`}
                          style={{ fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 10, whiteSpace: 'nowrap', background: 'rgba(239,68,68,0.18)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.45)' }}>✏️ ต้องแก้</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span>{s.shift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก'} · {fmtDate(s.work_date)}</span>
                      {/* ชิปอายุกะค้าง — เหลืองนิ่ง ≥3 วัน · แดงนิ่งเกิน STALE_SESSION_DAYS (งานค้าง ไม่ใช่ alarm ห้ามกระพริบ) */}
                      {(() => { const age = sessionAgeDays(s.work_date); if (age < 3) return null;
                        const late = age > STALE_SESSION_DAYS;
                        return <span title={late ? `ค้างเกินเป้า ${STALE_SESSION_DAYS} วัน — OEE ของกะนี้ยังไม่เข้ารายงานเดือน` : 'ค้างจากวันก่อน — ปิด/อนุมัติให้ครบ'}
                          style={{ fontSize: 9.5, fontWeight: 800, padding: '1px 5px', borderRadius: 8, whiteSpace: 'nowrap',
                            background: late ? 'rgba(239,68,68,0.18)' : 'rgba(245,158,11,0.15)',
                            color: late ? '#ef4444' : '#f59e0b',
                            border: `1px solid ${late ? 'rgba(239,68,68,0.45)' : 'rgba(245,158,11,0.4)'}` }}>⏰ {age}ว</span>;
                      })()}
                    </div>
                  </button>
                ))}
                {/* ย่อแล้วเหลือกะที่เลือกใบเดียว — ต้องบอกจำนวนที่ซ่อน + กดกางกลับได้ (ห้ามซ่อนเงียบ) */}
                {collapsed && hasSel && hiddenInGroup > 0 && (
                  <button onClick={() => toggleSessGroup(groupName)}
                    style={{ display: 'block', width: '100%', marginBottom: 6, padding: '4px 10px 6px 16px', background: 'none', border: 'none',
                      textAlign: 'left', cursor: 'pointer', fontSize: 10.5, color: 'var(--muted)' }}>
                    +{hiddenInGroup} กะในกลุ่มนี้ถูกย่อไว้ — กางดู
                  </button>
                )}
              </div>
              );
            });
            };

            /* กะค้าง = ถังพับ (ค่าเริ่มต้นพับ) — กางเองเมื่อกะที่เลือกอยู่ในถัง ไม่งั้นคลิกจาก banner แล้วหาการ์ดไม่เจอ */
            const staleHasSel = staleSessions.some(s => s.id === selSession?.id);
            // เก็บ flag เป็น "ผู้ใช้กางเอง" (ไม่ใช่ "ย่อ") เพราะค่าเริ่มต้นของถังนี้คือ "พับ"
            const staleOpen   = sessGroupCollapsed.has(STALE_BUCKET_KEY) || staleHasSel;
            return (
              <>
                {renderGroups(freshSessions)}
                {freshSessions.length === 0 && staleSessions.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', padding: '8px 4px', lineHeight: 1.5 }}>
                    ยังไม่มีกะของวันนี้ — เหลือแต่กะค้างด้านล่าง
                  </div>
                )}
                {staleSessions.length > 0 && (
                  <div style={{ marginTop: freshSessions.length ? 10 : 4, paddingTop: freshSessions.length ? 8 : 0, borderTop: freshSessions.length ? '1px dashed var(--border2)' : 'none' }}>
                    <button onClick={() => toggleSessGroup(STALE_BUCKET_KEY)}
                      title="กะของวันก่อนที่ยังไม่ปิด — เปิดกะใหม่ของวันนี้ได้ตามปกติ ไม่ต้องรอ"
                      style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', textAlign: 'left', cursor: 'pointer',
                        fontSize: 11, fontWeight: 800, padding: '6px 8px', borderRadius: 8, letterSpacing: '0.3px',
                        background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', color: '#f59e0b' }}>
                      <span style={{ fontSize: 9 }}>{staleOpen ? '▼' : '▶'}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>⏰ ค้างจากวันก่อน</span>
                      <span style={{ fontWeight: 700 }}>{staleSessions.length}</span>
                    </button>
                    {staleOpen && <div style={{ marginTop: 4 }}>{renderGroups(staleSessions)}</div>}
                  </div>
                )}
              </>
            );
          })()}
          </div>
        </div>
      )}

      <div>
        {/* ⏰ กะค้าง — ย้ายไปแท็บของตัวเองแล้ว (2026-08-26 · user "live กะนี้ ไม่ควรโชว์กะค้าง")
            เดิมลิสต์ 37 กะกินครึ่งจอบน แท็บนี้เลยไม่ได้ทำหน้าที่ "กะที่กำลังทำงานอยู่"
            ที่นี่เหลือชิปบรรทัดเดียว — **ห้ามตัดทิ้งทั้งหมด** สัญญาณต้องยังเห็นจากหน้าทำงานจริง */}
        {overdueAlert.length > 0 && (() => {
          const over7 = overdueAlert.filter(o => o.age > STALE_SESSION_DAYS);
          const oldest = overdueAlert[0]?.age || 0;
          return (
            <button onClick={onGoStale}
              title="เปิดแท็บ ⏰ กะค้าง — ไล่ปิด/อนุมัติทีละกะ"
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', flexWrap: 'wrap', cursor: 'pointer',
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 10, padding: '8px 14px', marginBottom: 14,
                fontSize: 12.5, fontWeight: 800, color: '#ef4444' }}>
              ⏰ กะค้างยังไม่ปิด {overdueAlert.length} กะ
              {over7.length > 0 && (
                <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: 'rgba(239,68,68,0.22)', border: '1px solid rgba(239,68,68,0.55)' }}>
                  เกิน {STALE_SESSION_DAYS} วัน {over7.length} กะ · เก่าสุด {oldest} วัน
                </span>
              )}
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>ไม่เกี่ยวกับกะที่กำลังทำอยู่ — เริ่มกะใหม่ได้ตามปกติ</span>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 800 }}>ไปไล่ปิด →</span>
            </button>
          );
        })()}

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
                  {/* 🔄 ไปจัดกำลังคน "ของไลน์นี้" — พาบริบทไปด้วย (?line=) แล้วมีปุ่มกลับที่ส่ง line กลับมา
                      = สลับ 2 หน้าโดยไม่ต้องเลือกไลน์ใหม่ทุกครั้ง (ไม่รวมเป็นหน้าเดียว: คนละ layout — บอร์ดจอ TV vs หน้ากรอกข้อมูล)
                      ⚠️ เช็คสิทธิ์ก่อนเสมอ ไม่มีสิทธิ์ = ไม่โชว์ปุ่ม (ห้ามพาไปแล้วโดนเด้ง) */}
                  {canAccessPage('/management', role) && (
                    <button onClick={() => navigate(`/management?line=${encodeURIComponent(selSession.line_name)}&from=daily-report`)}
                      title={`จัดกำลังคน / ผังไลน์ ของ ${selSession.line_name}`}
                      style={{ ...cancelBtnStyle, fontWeight: 700 }}>🔄 จัดกำลังคน</button>
                  )}
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
                      <button onClick={() => { setRejectReason(''); setShowRejectModal(true); }}
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
                    <button onClick={() => {
                      setCloseEndTime(guessCloseEndTime()); setCloseStartTime(selSession.start_time || '');
                      setDtCarryDecisions({}); setDtCloseTimes({}); setCloseNote('');
                      // ใบที่กรอกยอดไว้ระหว่างกะแล้ว — เติมให้ในช่อง "ยอดที่ทำได้จริง" เลย ไม่ต้องพิมพ์ซ้ำ (แก้ทับได้)
                      setCarryQtyActual(m => {
                        const next = { ...m };
                        prodOrders.filter(o => o.status === 'open' && (o.qty_actual || 0) > 0)
                          .forEach(o => { if ((next[o.id] ?? '') === '') next[o.id] = String(o.qty_actual); });
                        return next;
                      });
                      setShowCloseShift(true);
                    }}
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

                  {/* ใบรายงานปัญหาการผลิต — ดึง downtime/ของเสียของกะนี้มาเติมให้ (ไม่ต้องเขียนมือ)
                      หน้างานออกใบนี้ทุกครั้งที่หยุด/คุณภาพ/รอ เกิน 30 นาที (feedback 2026-08-19) */}
                  {(dtLogs.length > 0 || defectLogs.length > 0) && (() => {
                    const pend = countPendingFix({ downtimes: dtLogs, defects: defectLogs });
                    return (
                      <button onClick={() => {
                        // เปิดช่อง "ปัญหา :" ให้ตรวจ/แก้ก่อนพิมพ์ — เดิมช่องนี้ออกมาว่างทุกใบ
                        // (feedback หน้างาน 2026-08-28: "ปัญหาลงตรงไหนได้บ้าง" — ไม่มีที่ให้ลงจริงๆ)
                        const R = buildProblemReport({ downtimes: dtLogs, defects: defectLogs, minMinutes: PROBLEM_MIN_MINUTES });
                        setProblemSheet({ title: R.headline || '' });
                      }}
                        style={{ ...cancelBtnStyle, borderColor: '#f59e0b', color: '#f59e0b', fontWeight: 700 }}
                        title={pend.total
                          ? `พิมพ์ใบรายงานปัญหาการผลิต — ยังมี ${pend.total} รายการที่ยังไม่ลงวิธีแก้ไข (ช่องนั้นจะว่างต้องเขียนมือ)`
                          : 'พิมพ์ใบรายงานปัญหาการผลิต โดยดึงปัญหาของกะนี้มาเติมให้อัตโนมัติ'}>
                        📝 ใบรายงานปัญหา
                        {/* งานค้าง = ป้ายนิ่ง ไม่กระพริบ (ไม่ใช่ alarm) — บอกว่าใบจะออกมาไม่ครบ */}
                        {pend.total > 0 && (
                          <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 800, padding: '1px 6px',
                            borderRadius: 20, background: '#f59e0b', color: '#fff' }}>
                            🛠 {pend.total}
                          </span>
                        )}
                      </button>
                    );
                  })()}

                  {/* กะเปิดผิด (เปล่า ไม่มี Order/Downtime/Defect) — ลบได้จากจอ Live เลย ไม่ต้องปิดกะแล้วไปลบที่ประวัติ */}
                  {canDeleteSession && ['open', 'pending_close'].includes(selSession.status)
                    && prodOrders.length === 0 && dtLogs.length === 0 && defectLogs.length === 0 && (
                    <button onClick={handleDeleteEmptySession}
                      style={{ ...cancelBtnStyle, borderColor: '#ef4444', color: '#ef4444', fontWeight: 700 }}>
                      🗑 ลบกะเปล่า
                    </button>
                  )}
                </div>
              </div>

              {/* คำขอปิดกะถูกปฏิเสธ — โชว์ remark ให้หัวหน้ากลุ่มรู้ว่าต้องกลับไปแก้อะไร (static ไม่กระพริบ) */}
              {selSession.status === 'open' && selSession.close_reject_reason && (
                <div style={{ marginTop: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.45)', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#ef4444', marginBottom: 4 }}>
                    ✕ คำขอปิดกะถูกปฏิเสธ — กรุณาแก้ไขแล้วส่งขอปิดกะใหม่
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    📝 {selSession.close_reject_reason}
                  </div>
                  {selSession.close_reject_by_name && (
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>— โดย {selSession.close_reject_by_name}</div>
                  )}
                </div>
              )}
            </div>

            {/* Per-product breakdown — กะเดียวอาจผลิตหลาย MAT.NO จึงต้องแยกสรุปรายชิ้นงาน ไม่รวมเป็นก้อนเดียว */}
            {(() => {
              // ยอดชิ้นจริงรวม (สำหรับ INPUT/material — ต้องเบิกตามจำนวนชิ้นจริง ไม่ใช่คู่)
              const totalTargetPieces = prodOrders.reduce((s, o) => s + o.qty, 0);
              const totalNg = defectLogs.reduce((s, d) => s + (d.qty_ng || 0) + (d.qty_suspect || 0), 0);
              const totalInputNeeded = totalTargetPieces + totalNg;

              const matNos = Array.from(new Set(prodOrders.map(o => o.mat_no))).filter(Boolean);
              const productRows = matNos.map(matNo => {
                const orders    = prodOrders.filter(o => o.mat_no === matNo);
                const orderIds  = new Set(orders.map(o => o.id));
                const target    = orders.reduce((s, o) => s + o.qty, 0);
                // ใบที่ยังเปิด (manual + สแกนที่กรอกยอดระหว่างทาง) นับยอดที่ทำไปแล้วด้วย —
                // ต้องนับให้ตรงกับ FactoryMap/OEE/MorningMeeting ที่ใช้สูตร confirmed ? qty_ok : qty_actual อยู่แล้ว
                // ใบสแกนที่ยังไม่กรอก qty_actual = null → บวก 0 เหมือนเดิม (พฤติกรรมเดิมไม่เปลี่ยน)
                const confirmed = orders.filter(o => o.status === 'confirmed').reduce((s, o) => s + o.qty, 0)
                  + orders.filter(o => o.status === 'open').reduce((s, o) => s + (o.qty_actual || 0), 0)
                  // ใบที่ยกยอดออกไปกะถัดไป — ผลิตจริงส่วนหนึ่ง (qty_actual) นับเป็นผลิตได้ของกะนี้ (ที่เหลือไปทำต่อกะหน้า)
                  + orders.filter(o => o.status === 'carry_over').reduce((s, o) => s + (o.qty_actual || 0), 0);
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

              // สรุปภาพใหญ่: นับงานคู่ RH/LH เป็น 1 คู่/stroke (max ของสองข้าง) ไม่บวกชิ้นซ้ำ · พาร์ทเดี่ยว = บวกปกติ
              // + collapseOps: รายการขั้นตอน (OP งานขับนัท) ยุบเข้าพาร์ทจริง ไม่นับซ้ำ (แถวรายพาร์ทยังแยกโชว์ครบ)
              const pairOf = (mat) => products.find(p => p.mat_no === mat)?.pair_mat_no || null;
              const pt = pairAwareTotal(collapseOps(productRows.map(r => ({ mat_no: r.matNo, target: r.target, produced: r.confirmed })), opInfoSync()), pairOf);
              const nullMat = prodOrders.filter(o => !o.mat_no);
              const totalTarget    = pt.target + nullMat.reduce((s, o) => s + o.qty, 0);
              const totalConfirmed = pt.produced
                + nullMat.filter(o => o.status === 'confirmed').reduce((s, o) => s + o.qty, 0)
                + nullMat.filter(o => o.status === 'open').reduce((s, o) => s + (o.qty_actual || 0), 0)
                + nullMat.filter(o => o.status === 'carry_over').reduce((s, o) => s + (o.qty_actual || 0), 0);
              const pct = totalTarget > 0 ? Math.min(100, Math.round((totalConfirmed / totalTarget) * 100)) : 0;
              const barClr = pct >= 100 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#4d9fff';

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
                                  {(() => { // 🔩 รายการขั้นตอน (OP) — ยอดไม่ถูกนับซ้ำในสรุปรวม (ผูกพาร์ทจริงแล้ว) · ยังไม่ผูก = เตือน
                                    const op = opInfoSync()[r.matNo];
                                    if (!op) return null;
                                    return (
                                      <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: op.parent ? 'rgba(14,165,233,0.12)' : 'rgba(245,158,11,0.15)', color: op.parent ? '#0ea5e9' : '#f59e0b', fontWeight: 700 }}
                                        title={op.parent ? 'รายการขั้นตอน — ยอดรวมภาพใหญ่นับที่พาร์ทจริง ไม่บวกซ้ำ' : 'รายการขั้นตอนที่ยังไม่ผูกพาร์ทจริง — ผูกได้ที่ Product Master'}>
                                        🔩 OP{op.seq ? ` ${op.seq}` : ''}{op.parent ? ` · ของ ${op.parent}` : ' · ยังไม่ผูกพาร์ทจริง'}
                                      </span>
                                    );
                                  })()}
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
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>📊 ภาพรวมทั้งกะ
                    {pt.hasPair && <span style={{ textTransform: 'none', fontWeight: 500, color: 'var(--muted)', marginLeft: 6 }}>· งานคู่ RH/LH นับเป็น 1 คู่ (1 ปั๊ม) ไม่บวกชิ้นซ้ำ</span>}
                  </div>
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

            {/* คิวสั่งผลิตจากสโตร์ (ไลน์ปั๊ม/พาร์ทลูก) — วางเหนือ Prod Orders โดยตั้งใจ:
                "สโตร์อยากได้อะไร" ต้องมาก่อน "เราเปิดใบอะไรไปแล้ว"
                ไลน์ที่ไม่มีคิว + ไม่มีของค้าง component จะไม่ render อะไรเลย (ไม่รกจอไลน์ประกอบ) */}
            {/* 🔩 คิวสั่งผลิตจากสโตร์ (ไลน์ปั๊ม) · 📦 เรียกชิ้นส่วนจากสโตร์ (ไลน์ประกอบ)
                2 แผงนี้เป็นคนละทิศของลูปเดียวกัน — ไลน์ไหนไม่เกี่ยวจะไม่ render อะไรเลย */}
            <StoreLotQueue lineName={selSession.line_name} lines={lines} role={role} />
            <LinePartCallPanel lineName={selSession.line_name} lines={lines} role={role} fullName={fullName} />

            {/* 📦 WIP ที่ไลน์ — สโตร์ส่งมาเท่าไหร่ · ตัดเป็น FG เท่าไหร่ · ค้างเท่าไหร่ (user 2026-09-01)
                ⚠️ ค้าง = "คำนวณ" (รับเข้า − ผลิต×BOM) ไม่ใช่ qty_on_hand ในระบบ
                   backflush ยังไม่ทำงาน ยอดในระบบจึงสูงกว่าความจริงเสมอ — ดู utils/lineWipLedger.js
                ไลน์ที่ไม่มีทั้ง ledger และการใช้ของ component จะไม่ render อะไรเลย */}
            <LineWipPanel lineName={selSession.line_name} workDate={selSession.work_date} lines={lines} />

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
                      setDefectForm({ id: null, mat_no: activeMatNos.length === 1 ? activeMatNos[0] : '', defect_type_id: '', qty_ng: '0', qty_suspect: '0', qty_repair: '0', description: '', is_trial: false });
                    }}
                      style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                      🔴 บันทึกงานเสีย
                    </button>
                  </div>
                )}
              </div>

              {prodOrdersOpen && (<>
              {/* ไลน์เครื่องขนาน (parallel_machine — dispatch ผูกเครื่อง เช่น SUB APRON) — เลือกเครื่องก่อนเปิด Order
                  เพื่อผูกใบกับเครื่อง (แยกเลนบนบอร์ด) · ไลน์งานคู่ LH/RH (LASER-345/789) เป็น one_piece_flow ไม่โชว์แผงนี้
                  รายชื่อเครื่อง = เฉพาะที่ลงทะเบียนใต้ไลน์ที่เปิดกะจริง (เคยดึงทั้ง family → เครื่อง HYDROFORM
                  30+ ตัวโผล่ปนจนใช้ไม่ได้ · fallback ไป family เฉพาะเมื่อไลน์ไม่มีเครื่องของตัวเอง) */}
              {canScan && lineFlow[selSession?.line_name]?.flow_mode === 'parallel_machine' && (() => {
                const dedupe = (arr) => { const seen = new Set(); return arr.filter(m => m.machine_no && !seen.has(m.machine_no) && seen.add(m.machine_no)); };
                const sessLine = (selSession.line_name || '').toLowerCase();
                let lineMachines = dedupe(machines.filter(m => (m.line_name || '').toLowerCase() === sessLine && m.is_active !== false));
                if (!lineMachines.length) {
                  const famNames = new Set(getLineFamilyNames(lines, selSession.line_name).map(n => (n || '').toLowerCase()));
                  lineMachines = dedupe(machines.filter(m => famNames.has((m.line_name || '').toLowerCase()) && m.is_active !== false));
                }
                return (
                  <div style={{ marginBottom: 10, padding: '8px 12px', background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.35)', borderRadius: 9, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa' }}>⚙️ ไลน์เครื่องขนาน — เปิด Order ถัดไปที่เครื่อง:</span>
                    <select value={openMachineNo} onChange={e => setOpenMachineNo(e.target.value)}
                      style={{ width: 220, fontSize: 12, fontWeight: 600 }}>
                      <option value="">— ไม่ระบุเครื่อง (กระจายอัตโนมัติ) —</option>
                      {lineMachines.map(m => <option key={m.machine_no} value={m.machine_no}>{m.machine_no}{m.machine_name ? ` · ${m.machine_name}` : ''}</option>)}
                    </select>
                    {lineMachines.length === 0 && <span style={{ fontSize: 11, color: 'var(--muted)' }}>(ยังไม่มีเครื่องในทะเบียน — เพิ่มที่ Machine Database)</span>}
                  </div>
                );
              })()}
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

              {/* สรุป "จะส่งต่อกะหน้า" — คู่กับแบนเนอร์ "รับยอดจากกะก่อน" ด้านบน
                  เดิมมีแต่ตัวเลขรายใบ ต้องไล่บวกเอง/ไปเปิดดูกะถัดไปถึงรู้ว่ากะนี้ส่งต่อเท่าไหร่ */}
              {(() => {
                const outOpen  = prodOrders.filter(o => o.status === 'open');
                const outCarry = prodOrders.filter(o => o.status === 'carry_over');
                if (!outOpen.length && !outCarry.length) return null;
                const remainOf   = (o) => Math.max(0, (o.qty_target ?? o.qty) - (o.qty_actual || 0));
                const settledQty = outCarry.reduce((s, o) => s + remainOf(o), 0);
                const openQty    = outOpen.reduce((s, o) => s + remainOf(o), 0);
                const unfilled   = outOpen.filter(o => !(o.qty_actual > 0)).length;
                const total      = settledQty + openQty;
                if (!total) return null;
                return (
                  <div style={{ marginBottom: 10, padding: '10px 14px', background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 9 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa' }}>
                      ⏭ จะส่งต่อกะหน้า {unfilled > 0 ? '~' : ''}{total} ชิ้น
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                      {outCarry.length > 0 && <>ยืนยันยกยอดแล้ว <b style={{ color: 'var(--text2)' }}>{settledQty}</b> ชิ้น ({outCarry.length} ใบ){outOpen.length > 0 ? ' · ' : ''}</>}
                      {outOpen.length > 0 && <>ใบที่ยังไม่ปิด <b style={{ color: 'var(--text2)' }}>{openQty}</b> ชิ้น ({outOpen.length} ใบ)</>}
                    </div>
                    {unfilled > 0 && (
                      /* เดิมเขียนว่า "N ใบยังไม่ได้กรอกยอด" → อ่านแล้วเหมือนต้องไล่กรอกให้ครบทุกใบ
                         ความจริงคือใบที่ทำค้างมีไม่กี่ใบ ที่เหลือยกเต็มใบซึ่งถูกอยู่แล้ว (2026-08-20) */
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                        นับเต็มใบไว้ก่อน {unfilled} ใบ — <b style={{ color: 'var(--text2)' }}>ถ้ามีใบที่ทำค้างอยู่ กรอกเฉพาะใบนั้น</b>
                        {' '}(ปุ่ม ✏️ ในการ์ด) · ใบที่ยังไม่เริ่ม/จะสแกนปิดเต็มใบ ไม่ต้องกรอก
                      </div>
                    )}
                  </div>
                );
              })()}

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
                  // ใบสแกน (kanban card) ที่ยังไม่ปิด — กรอกยอดสะสมได้เหมือนใบ manual (ไม่บังคับ)
                  // เพื่อให้เห็นตั้งแต่ระหว่างกะว่า "ถ้าปิดกะตอนนี้จะยกไปกะหน้ากี่ชิ้น"
                  // ก่อนหน้านี้เห็นแค่เป้า (เช่น 35) จนกว่าจะปิดกะ ต้องไปเปิดดูกะถัดไปถึงรู้
                  const scanOpen    = !isManual && o.status === 'open';
                  const scanPartial = scanOpen && (o.qty_actual || 0) > 0;
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
                          {o.machine_no && (
                            <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: 'rgba(148,163,184,0.18)', color: '#94a3b8', fontWeight: 700 }}
                              title="เครื่องที่ใบนี้วิ่ง (ไลน์เครื่องขนาน)">⚙️ {o.machine_no}</span>
                          )}
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
                          {/* ร่องรอยการถอยใบ — โชว์เสมอให้หัวหน้าแผนกตรวจย้อนหลังได้ว่าใครถอย */}
                          {(o.reopen_count || 0) > 0 && (
                            <span title={`ใบนี้เคยถูกถอยจาก "ปิดแล้ว" กลับมาผลิตต่อ ${o.reopen_count} ครั้ง · ล่าสุดโดย ${o.reopened_by || '-'}`}
                              style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: 'rgba(245,158,11,0.13)', color: '#f59e0b', fontWeight: 700 }}>
                              ↩️ เคยถอยใบ {o.reopen_count} ครั้ง · {o.reopened_by}
                            </span>
                          )}
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
                        ) : carryOver ? (
                          // ยกยอดออกไปกะถัดไป — ต้องโชว์ให้ชัดว่าผลิตจริงเท่าไหร่ ยกไปเท่าไหร่ (ไม่ใช่โชว์เป้าเฉยๆ = ดูเหมือนผลิตครบ)
                          <>
                            <div style={{ fontSize: 18, fontWeight: 900, color: '#22c55e', lineHeight: 1 }}>
                              {o.qty_actual || 0}<span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>/{o.qty_target ?? o.qty}</span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>ผลิตจริง/เป้า</div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', marginTop: 2 }}>➡ ยกไป {Math.max(0, (o.qty_target ?? o.qty) - (o.qty_actual || 0))} ชิ้น</div>
                          </>
                        ) : cancelled ? (
                          <>
                            <div style={{ fontSize: 18, fontWeight: 900, color: statusColor, lineHeight: 1 }}>
                              {o.qty_actual || 0}<span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>/{o.qty_target ?? o.qty}</span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>ทำได้/เป้า</div>
                          </>
                        ) : scanPartial ? (
                          // ใบสแกนที่กรอกยอดระหว่างทางแล้ว — โชว์เหมือนฝั่งรับ (ทำได้/เป้า + จะยกไปเท่าไหร่)
                          // ไม่ต้องรอปิดกะ ไม่ต้องไปเปิดดูกะถัดไป
                          <>
                            <div style={{ fontSize: 18, fontWeight: 900, color: '#22c55e', lineHeight: 1 }}>
                              {o.qty_actual}<span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>/{o.qty}</span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>ทำได้/เป้า</div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', marginTop: 2 }}>
                              ➡ ปิดกะตอนนี้ ยกไป {Math.max(0, o.qty - o.qty_actual)} ชิ้น
                            </div>
                          </>
                        ) : (
                          // confirmed = ผลิตจริง · open ปกติ/carried-in = เป้าที่ต้องทำ (แยก label ให้ไม่กำกวมกับผลิตจริง)
                          <>
                            <div style={{ fontSize: 20, fontWeight: 900, color: statusColor, lineHeight: 1 }}>{o.qty}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                              {confirmed ? 'ผลิตจริง (ชิ้น)' : isCarried ? 'ยังต้องทำ (ชิ้น)' : 'เป้า (ชิ้น)'}
                              {isManual && !confirmed && (o.qty_target ?? null) !== null ? ` · เป้า ${o.qty_target}` : ''}
                            </div>
                            {isCarried && (() => {
                              const m = (o.carry_over_note || '').match(/(\d+)\s*\/\s*(\d+)/);
                              return m ? <div style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', marginTop: 2 }}>เป้าเดิม {m[2]} · กะก่อนทำ {m[1]}</div> : null;
                            })()}
                          </>
                        )}
                      </div>
                      {/* ออเดอร์ที่ confirmed ห้ามลบเด็ดขาด (เป็นยอดผลิตจริงที่ปิดแล้ว) — ส่วนออเดอร์ที่ยกยอด (carry_over)
                          ปกติ leader แก้ไม่ได้แล้วเพราะตัดสินใจไปแล้วตอนปิดกะ แต่ถ้าตกค้างผิดปกติ (เช่นกะเก่าปิดไม่สำเร็จ)
                          SV/Manager/Admin ต้องลบแก้ไขได้เพื่อเคลียร์ข้อมูลค้าง ไม่งั้นจะไม่มีทางแก้เลย */}
                      {!confirmed && (canManage || (canEditRecords && !carryOver)) && (
                        <button className="tbtn" onClick={() => handleDeleteProdOrder(o.id)}
                          style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}>✕</button>
                      )}
                      {/* ถอยใบที่สแกนปิดเกิน/ปิดผิดใบ — เฉพาะกะที่ยังเปิดอยู่ (หลังปิดกะยอดถูกสรุปแล้ว ถอยไม่ได้) */}
                      {confirmed && canEditRecords && selSession?.status === 'open' && (
                        <button onClick={() => handleRevertOrder(o)}
                          title="ถอยใบ — สแกนปิดเกินยอดที่ผลิตได้/ปิดผิดใบ ย้อนกลับเป็นกำลังผลิต (ระบบถอนยอดที่รับเข้า stock อัตโนมัติให้ด้วย)"
                          style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.45)', borderRadius: 7, padding: '5px 11px', fontSize: 11, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          ↩️ ถอยใบ
                        </button>
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
                      {/* แถวอัพเดทยอดสะสม — ใบ manual กรอกทุกช่วงเบรคตาม break policy (บังคับ)
                          ใบสแกน กรอกได้แบบไม่บังคับ เพื่อให้รู้ยอดที่จะส่งต่อกะหน้าก่อนถึงตอนปิดกะ
                          (ใบสแกนยังปิดด้วยการสแกนเหมือนเดิม — ไม่มีปุ่มปิดด้วยมือ กันเสีย traceability) */}
                      {/* ใบสแกนที่ยังไม่กาง = โชว์แค่ปุ่มเล็ก ไม่กินที่ (กรอกเฉพาะใบที่ทำค้างจริง) */}
                      {scanOpen && canScan && !qtyEditIds.has(o.id) && !(o.qty_actual > 0) && (
                        <div style={{ paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
                          <button onClick={() => openQtyEdit(o.id)}
                            title="ใบนี้ทำค้างอยู่? กรอกยอดที่ทำได้ เพื่อให้ยอดส่งต่อกะหน้าแม่นขึ้น (ไม่บังคับ)"
                            style={{ background: 'none', border: '1px dashed var(--border)', borderRadius: 7, padding: '3px 10px',
                              fontSize: 11, fontWeight: 700, color: 'var(--muted)', cursor: 'pointer' }}>
                            ✏️ ใบนี้ทำค้าง — กรอกยอด
                          </button>
                        </div>
                      )}
                      {(manualOpen || (scanOpen && (qtyEditIds.has(o.id) || o.qty_actual > 0))) && canScan && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>
                            {manualOpen ? 'ยอดสะสมตอนนี้:' : 'ทำได้แล้วกี่ชิ้น:'}
                          </span>
                          {/* width กัน index.css input{width:100%} ดันปุ่มแตกแถว (กับดัก CSS ใน CLAUDE.md) */}
                          <input type="number" min={0} inputMode="numeric" value={manualQtyDraft[o.id] ?? ''}
                            placeholder={`${o.qty_actual || 0}`}
                            onChange={e => setManualQtyDraft(d => ({ ...d, [o.id]: e.target.value }))}
                            style={{ width: 100, padding: '6px 10px', fontSize: 13, fontWeight: 700, borderRadius: 7, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
                          <button onClick={() => handleManualQtyUpdate(o)}
                            style={{ background: '#60a5fa', color: '#08131f', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                            💾 อัพเดทยอด
                          </button>
                          {manualOpen && (
                            <button onClick={() => handleManualClose(o)}
                              style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.5)', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                              ✓ ปิดใบนี้ (ยอดจริง)
                            </button>
                          )}
                          {scanOpen && (
                            <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>ปิดใบยังใช้สแกนเหมือนเดิม</span>
                          )}
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
                  {/* flexWrap ที่แถว: ปุ่ม action ท้ายแถว (🗑️/🛠/✎/✕) เป็น nowrap ทั้งหมด — จอมือถือแถวไม่ wrap = ปุ่มตกขอบจอกดไม่ได้
                      (feedback หน้างาน 2026-08-25: "เข้าแก้ไขเวลาเสร็จในดาวน์ไทม์ในมือถือไม่ได้") */}
                  {defectLogs.map(d => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '8px 12px', background: 'var(--bg2)', borderRadius: 8, borderLeft: `3px solid ${d.dr_defect_types?.color || '#ef4444'}` }}>
                      {/* flex-basis 240: จอแคบให้ปุ่มตกบรรทัดใหม่แทนการบีบข้อความจนอ่านไม่ออก · จอกว้าง = แถวเดียวเหมือนเดิม */}
                      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
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
                          {/* งานทดลองต้องเห็นในลิสต์เสมอ (เป็นของเสียจริง) แค่ไม่ถูกนับเข้า %Q */}
                          {isTrialDefect(d) && (
                            <span title="งานทดลอง — ไม่นับเข้า %Q แต่ยังนับเป็นมูลค่าของเสีย"
                              style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 20, background: 'rgba(168,85,247,0.15)', color: '#a855f7', fontWeight: 700 }}>
                              🧪 งานทดลอง
                            </span>
                          )}
                        </div>
                        {d.description && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{d.description}</div>}
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                          {fmtTime(new Date(d.logged_at))}
                          {d.reported_by_name && ` · ${d.reported_by_name}`}
                        </div>
                      </div>
                      {/* 🗑️ ส่งของเสีย/งานต้องสงสัย เข้าถังแดง/ถังเหลือง — ไม่ต้องคีย์ใบใหม่ทั้งใบ
                          feedback หัวหน้ากลุ่ม 2026-08-19: "ถ้าเป็นงานเสียขอผูกกับเอกสารตัวนี้ รวมถึงงานต้องสงสัยด้วย"
                          ⚠️ ไม่สร้างใบให้อัตโนมัติ — "เอาของลงถัง" เป็นการกระทำจริงหน้างาน ต้องมีคนกดยืนยัน */}
                      {canScan && ((d.qty_ng || 0) > 0 || (d.qty_suspect || 0) > 0) && (() => {
                        const lk = binLinks[d.id];
                        const done = !!lk && (lk.yellow > 0 || lk.red > 0);
                        return (
                          <button onClick={() => setBinTarget({ defect: d, existing: lk })}
                            title={done
                              ? `ลงถังแล้ว${lk.yellow ? ` · 🟡 ${lk.yellow} ชิ้น` : ''}${lk.red ? ` · 🔴 ${lk.red} ชิ้น` : ''} — กดเพื่อลงเพิ่ม`
                              : 'ส่งเข้าถังเหลือง (ต้องสงสัย) / ถังแดง (เสีย) โดยไม่ต้องคีย์ใบใหม่'}
                            style={{ fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap', cursor: 'pointer',
                              borderRadius: 20, padding: '3px 10px',
                              color: done ? '#22c55e' : '#e05252',
                              background: done ? 'rgba(34,197,94,0.12)' : 'rgba(224,82,82,0.12)',
                              border: `1px solid ${done ? 'rgba(34,197,94,0.35)' : 'rgba(224,82,82,0.4)'}` }}>
                            {done
                              ? `🗑️ ลงถังแล้ว${lk.yellow ? ` 🟡${lk.yellow}` : ''}${lk.red ? ` 🔴${lk.red}` : ''}`
                              : '🗑️ ลงถัง'}
                          </button>
                        );
                      })()}
                      {/* 🛠 ของเสียทุกรายการเข้าใบรายงานปัญหา (ไม่มีเกณฑ์เวลา) → ต้องลงวิธีแก้ไขทุกแถว */}
                      {canScan && (() => {
                        const done = !!String(d.fix_action || '').trim();
                        return (
                          <button onClick={() => setFixTarget({ kind: 'defect', row: d,
                            title: `${d.dr_defect_types?.name_th || 'ของเสีย'}${d.prod_orders?.mat_no ? ` · ${d.prod_orders.mat_no}` : ''}${d.qty_ng ? ` · NG ${d.qty_ng}` : ''}` })}
                            title={done
                              ? `ลงวิธีแก้ไขแล้ว${d.fix_by ? ` โดย ${d.fix_by}` : ''}${String(d.followup_result || '').trim() ? ' · มีผลตรวจติดตาม' : ' — ยังไม่ลงผลตรวจติดตาม'}`
                              : 'ลงวิธีแก้ไข + ผลตรวจติดตาม (เติมลงใบรายงานปัญหาให้อัตโนมัติ)'}
                            style={{ fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap', cursor: 'pointer',
                              borderRadius: 20, padding: '3px 10px',
                              color: done ? '#22c55e' : '#f59e0b',
                              background: done ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                              border: `1px solid ${done ? 'rgba(34,197,94,0.35)' : 'rgba(245,158,11,0.4)'}` }}>
                            {done ? '🛠 แก้ไขแล้ว' : '🛠 ลงวิธีแก้ไข'}
                          </button>
                        );
                      })()}
                      {canEditRecords && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="tbtn" onClick={() => { setDefectForm({ id: d.id, mat_no: d.prod_orders?.mat_no || '', defect_type_id: d.defect_type_id || '', qty_ng: String(d.qty_ng||0), qty_suspect: String(d.qty_suspect||0), qty_repair: String(d.qty_repair||0), description: d.description || '', is_trial: d.is_trial === true }); setShowDefect(true); }}
                            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, padding: '0 4px' }}>✎</button>
                          <button className="tbtn" onClick={() => handleDeleteDefectLog(d.id)}
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
                    <div key={d.id}>
                    {/* flexWrap: แถวนี้มีปุ่ม nowrap ต่อท้ายถึง 6 ตัว (📞/📝/🛠/💬/✎/✕) — จอมือถือไม่ wrap = ปุ่ม ✎ ตกขอบจอ
                        แก้เวลาเสร็จ downtime บนมือถือไม่ได้ (feedback หน้างาน 2026-08-25) · จอกว้าง = แถวเดียวเหมือนเดิม */}
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '10px 12px', background: 'var(--bg2)', borderRadius: 8, borderLeft: `3px solid ${d.dr_downtime_types?.color || '#aaa'}` }}>
                      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 2 }}>
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
                      {/* เรียกช่าง MTN — เฉพาะรายการที่ยังเปิดค้าง (เครื่องยังหยุดอยู่) และไม่ใช่ DT ในแผน */}
                      {canScan && d.duration_min == null && !d.ended_at && d.dr_downtime_types?.category !== 'planned' && (
                        d.call_mtn
                          ? <span title={`เรียกช่างแล้ว${d.call_mtn_by ? ` โดย ${d.call_mtn_by}` : ''}`} style={{ fontSize: 11, fontWeight: 700, color: '#22c55e', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: 20, padding: '3px 9px', whiteSpace: 'nowrap' }}>📞 เรียกช่างแล้ว</span>
                          : <button onClick={() => handleCallMtn(d)} title="แจ้งช่าง MTN ให้เข้าหน้างานทันที" style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: '#e05c4a', border: 'none', borderRadius: 20, padding: '4px 11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>📞 เรียกช่าง</button>
                      )}
                      {/* เปิดใบแจ้งซ่อม MO จาก downtime — เฉพาะ "นอกแผน" (ในแผน เช่น Set up/รอ QA/5ส. ไม่ใช่เหตุเครื่องเสีย — คำสั่ง user 2026-07-24) */}
                      {canScan && can('mtn_repair', 'report', role) && d.dr_downtime_types?.category !== 'planned' && (
                        <button onClick={() => openMoPicker(d)} title="เปิดใบแจ้งซ่อม MO (7 ขั้น) จากรายการนี้" style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: '#7c6cf0', border: 'none', borderRadius: 20, padding: '4px 11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>📝 เปิดใบซ่อม</button>
                      )}
                      {/* 🛠 วิธีแก้ไข + ผลตรวจติดตาม — โผล่เมื่อรายการนี้ยาวถึงเกณฑ์ใบรายงานปัญหา (นอกแผน ≥30 นาที)
                          feedback หัวหน้ากลุ่ม 2026-08-19: "ถ้าเกิน 30 นาที ให้มีไอคอนขึ้นมาให้ลงวิธีแก้ไข"
                          ยังไม่ลง = ส้มเตือน (นิ่ง ไม่กระพริบ — เป็นงานค้าง ไม่ใช่ alarm) · ลงแล้ว = เขียวเงียบ */}
                      {canScan && dtNeedsFix(d) && (() => {
                        const done = !!String(d.fix_action || '').trim();
                        return (
                          <button onClick={() => setFixTarget({ kind: 'downtime', row: d,
                            title: `${d.dr_downtime_types?.name_th || 'Downtime'}${d.machine_no ? ` · ${d.machine_no}` : ''} · ${fmtMin(d.duration_min)}` })}
                            title={done
                              ? `ลงวิธีแก้ไขแล้ว${d.fix_by ? ` โดย ${d.fix_by}` : ''}${String(d.followup_result || '').trim() ? ' · มีผลตรวจติดตาม' : ' — ยังไม่ลงผลตรวจติดตาม'}`
                              : `หยุดเกิน ${PROBLEM_MIN_MINUTES} นาที — ต้องลงวิธีแก้ไข + ผลตรวจติดตาม`}
                            style={{ fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap', cursor: 'pointer',
                              borderRadius: 20, padding: '4px 11px',
                              color: done ? '#22c55e' : '#fff',
                              background: done ? 'rgba(34,197,94,0.12)' : '#f59e0b',
                              border: done ? '1px solid rgba(34,197,94,0.35)' : 'none' }}>
                            {done ? '🛠 แก้ไขแล้ว' : '🛠 ลงวิธีแก้ไข'}
                          </button>
                        );
                      })()}
                      {/* 💬 คอมเมนต์ใต้รายการ downtime — คุยหน้างาน/ส่งต่อกะ + mention แจ้งเตือน */}
                      <button className="tbtn" onClick={() => setDtCmOpen(v => v === d.id ? null : d.id)}
                        title="คอมเมนต์/ส่งต่อข้อมูลรายการนี้"
                        style={{ fontSize: 12, background: dtCmOpen === d.id ? 'var(--accent-dim)' : 'none', border: `1px solid ${dtCmOpen === d.id ? 'var(--accent)' : 'var(--border2)'}`, borderRadius: 20, color: dtCmOpen === d.id ? 'var(--accent)' : 'var(--muted)', cursor: 'pointer', padding: '3px 10px', whiteSpace: 'nowrap' }}>
                        💬
                      </button>
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
                            className="tbtn" style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, padding: '0 4px' }}>✎</button>
                          <button className="tbtn" onClick={() => handleDeleteDT(d.id)}
                            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}>✕</button>
                        </div>
                      )}
                    </div>
                    {dtCmOpen === d.id && (
                      <EventComments refKind="downtime" refId={d.id}
                        contextLabel={`Downtime ${d.dr_downtime_types?.name_th || ''}${d.machine_no ? ` (${d.machine_no})` : ''}`} />
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

        {/* 🛠 ลงวิธีแก้ไข + ผลตรวจติดตาม ของรายการปัญหา 1 แถว */}
        {fixTarget && (
          <ProblemFixModal
            kind={fixTarget.kind} row={fixTarget.row} title={fixTarget.title}
            actorName={fullName}
            onClose={() => setFixTarget(null)}
            onSaved={() => {
              if (fixTarget.kind === 'downtime') loadDT(selSession.id);
              else loadDefectLogs(selSession.id);
            }}
          />
        )}

        {/* 🗑️ ส่งของเสีย/งานต้องสงสัย ลงถังเหลือง-แดง */}
        {binTarget && (
          <QualityBinLinkModal
            defect={binTarget.defect} session={selSession} actorName={fullName}
            existing={binTarget.existing}
            onClose={() => setBinTarget(null)}
            onSaved={() => loadDefectLogs(selSession.id)}
          />
        )}

        {/* Open session modal */}
        {moDtPick && (
          <div className="overlay" style={{ zIndex: 2100 }} onClick={() => setMoDtPick(null)}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 22, width: 'min(95vw,420px)' }}>
              <div style={{ fontSize: 15.5, fontWeight: 800, marginBottom: 6, color: 'var(--text)' }}>📝 เปิดใบแจ้งซ่อม — แจ้งถึงทีมช่างไหน?</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
                🏭 {selSession?.line_name} · {moDtPick.d.machine_no || 'ไม่ระบุเครื่อง'} — ใบซ่อมจะถูกส่งเข้าคิว + แจ้งเตือน Telegram ของทีมที่เลือก
              </div>
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                {MTN_TEAMS.map(t => (
                  <button key={t} onClick={() => setMoDtPick(p => ({ ...p, team: t }))} style={{
                    padding: '12px 8px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer',
                    border: `2px solid ${moDtPick.team === t ? '#7c6cf0' : 'var(--border)'}`,
                    background: moDtPick.team === t ? 'rgba(124,108,240,0.14)' : 'var(--card)',
                    color: moDtPick.team === t ? '#7c6cf0' : 'var(--text2)',
                  }}>{deptNameOf(t)}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setMoDtPick(null)} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg2)', color: 'var(--muted)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>ยกเลิก</button>
                <button onClick={() => handleCreateMoFromDt(moDtPick.d, moDtPick.team)} style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: '#7c6cf0', color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>📝 เปิดใบซ่อม → {moDtPick.team}</button>
              </div>
            </div>
          </div>
        )}
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
                    {lines.filter(l => !l.parent_line_name && !parentChildrenMap[l.name] && (!openScopeLineNames || openScopeLineNames.has(l.name))).map(l => (
                      <option key={l.id} value={l.name}>{l.name}</option>
                    ))}
                    {Object.entries(parentChildrenMap).map(([parent, children]) => {
                      const kids = children.filter(cn => !openScopeLineNames || openScopeLineNames.has(cn));
                      if (!kids.length) return null;
                      return (
                        <optgroup key={parent} label={`▸ ${parent}`}>
                          {kids.map(cn => {
                            const cl = lines.find(l => l.name === cn);
                            return cl ? <option key={cl.id} value={cl.name}>{cl.name}</option> : null;
                          })}
                        </optgroup>
                      );
                    })}
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
        {/* Reject-with-remark modal — SV ระบุสิ่งที่ต้องกลับไปแก้ให้หัวหน้ากลุ่มทราบ */}
        {/* ใบรายงานปัญหาการผลิต — ยืนยันหัวเรื่อง "ปัญหา :" ก่อนพิมพ์
            ระบบเสนอจากรายการที่หนักสุดของกะ (สืบกลับได้ว่ามาจากแถวไหน) แต่คนเป็นคนตัดสิน */}
        {problemSheet && selSession && (() => {
          const doPrint = async () => {
            const title = problemSheet.title;
            setProblemSheet(null);
            const ok = await printProdProblemReport({
              session: selSession, downtimes: dtLogs, defects: defectLogs,
              section: lineMap?.[selSession.line_name]?.section || null,
              extra: { problem: title },
            });
            if (!ok) toast.error('เบราว์เซอร์บล็อก popup — อนุญาต popup ของเว็บนี้ก่อน');
          };
          return (
          <div className="overlay" style={{ zIndex: 2200 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '2px solid rgba(245,158,11,0.5)', borderRadius: 14, padding: 22, width: 'min(94vw,520px)' }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4, color: '#f59e0b' }}>📝 ใบรายงานปัญหาการผลิต</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
                {selSession.line_name} · {selSession.shift === 'day' ? 'กะเช้า' : 'กะดึก'} · {fmtDate(selSession.work_date)}
              </div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>ปัญหา (หัวเรื่องบนหัวใบ)</label>
              <input value={problemSheet.title} autoFocus
                onChange={e => setProblemSheet(v => ({ ...v, title: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') doPrint(); }}
                placeholder="เว้นว่างได้ ถ้าจะเขียนมือบนกระดาษ"
                style={{ width: '100%', marginTop: 6, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }} />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, marginBottom: 14, lineHeight: 1.6 }}>
                ระบบเสนอจากรายการที่กินเวลา/จำนวนมากสุดของกะนี้ — แก้ทับหรือล้างทิ้งได้ ช่องอื่นในใบดึงจากที่บันทึกไว้แล้วอัตโนมัติ
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button onClick={() => setProblemSheet(null)} style={cancelBtnStyle}>ยกเลิก</button>
                <button onClick={doPrint} style={{ ...saveBtnStyle, background: '#f59e0b', fontWeight: 700 }}>
                  🖨 พิมพ์ใบรายงาน
                </button>
              </div>
            </div>
          </div>
          );
        })()}

        {showRejectModal && selSession && (
          <div className="overlay" style={{ zIndex: 2200 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '2px solid rgba(239,68,68,0.5)', borderRadius: 14, padding: 22, width: 'min(94vw,480px)' }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4, color: '#ef4444' }}>✕ ปฏิเสธคำขอปิดกะ</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
                {selSession.line_name} · {selSession.shift === 'day' ? 'กะเช้า' : 'กะดึก'} · {fmtDate(selSession.work_date)} · ขอโดย {selSession.close_requested_by_name || '—'}
              </div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>ระบุสิ่งที่ต้องกลับไปแก้ไข (remark) *</label>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} autoFocus rows={4}
                placeholder="เช่น ยอด NG ไม่ตรงกับที่บันทึก / ลืมปิด Downtime เครื่อง / เวลาปิดกะผิด — หัวหน้ากลุ่มจะเห็นข้อความนี้"
                style={{ width: '100%', marginTop: 6, marginBottom: 14, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button onClick={() => { setShowRejectModal(false); setRejectReason(''); }} style={cancelBtnStyle}>ยกเลิก</button>
                <button onClick={handleRejectClose} disabled={savingReject || !rejectReason.trim()}
                  style={{ ...saveBtnStyle, background: '#ef4444', fontWeight: 700, opacity: (savingReject || !rejectReason.trim()) ? 0.5 : 1 }}>
                  {savingReject ? 'กำลังส่ง...' : '✕ ยืนยันปฏิเสธ + ส่งกลับแก้ไข'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showApproveReview && selSession && (() => {
          const oeeColor = selSession.oee == null ? 'var(--muted)' : selSession.oee >= 85 ? '#22c55e' : selSession.oee >= 65 ? '#f59e0b' : '#ef4444';
          const confirmedOrders  = prodOrders.filter(o => o.status === 'confirmed');
          const carryOrdersList  = prodOrders.filter(o => o.status === 'carry_over');
          const cancelledOrders  = prodOrders.filter(o => o.status === 'cancelled');
          // จอ landscape กว้าง → แผ่เนื้อหาเป็น 2 คอลัมน์แทนการยืดสูงจน scroll (layout อย่างเดียว ไม่แตะ logic)
          const twoCol = wide1100 && (defectLogs.length > 0 || dtLogs.length > 0) && prodOrders.length > 0;
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
                  {/* หมายเหตุที่หัวหน้ากลุ่มเขียนมา — SV ต้องเห็นก่อนตัดสินใจอนุมัติ/ปฏิเสธ */}
                  {selSession.close_request_note && (
                    <div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 8, padding: '8px 10px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)', whiteSpace: 'pre-wrap' }}>
                      📝 หมายเหตุจากหัวหน้ากลุ่ม: <b>{selSession.close_request_note}</b>
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(90px,1fr))', gap: 10, marginBottom: 14 }}>
                  {[
                    { label: 'เวลากะ',   value: fmtMin(selSession.shift_min),            color: 'var(--text)' },
                    { label: 'ผลิตได้',  value: `${selSession.actual_qty ?? 0} ชิ้น`,     color: '#22c55e' },
                    { label: 'ดี',       value: `${selSession.qty_ok ?? 0} ชิ้น`,         color: '#22c55e' },
                    { label: 'NG',       value: `${selSession.qty_ng ?? 0} ชิ้น`,         color: '#ef4444' },
                    { label: 'สงสัย',    value: `${selSession.qty_suspect ?? 0} ชิ้น`,    color: '#f59e0b' },
                    { label: 'ซ่อม',     value: `${selSession.qty_repair ?? 0} ชิ้น`,     color: '#a78bfa' },
                    // %A %P %Q ก่อน OEE — เกณฑ์สีเดียวกับหน้า OEE Analytics
                    { label: '%A', value: selSession.oee_a != null ? `${Number(selSession.oee_a).toFixed(1)}%` : 'N/A',
                      color: selSession.oee_a == null ? 'var(--muted)' : selSession.oee_a >= 90 ? '#22c55e' : selSession.oee_a >= 75 ? '#f59e0b' : '#ef4444' },
                    { label: '%P', value: selSession.oee_p != null ? `${Number(selSession.oee_p).toFixed(1)}%` : 'N/A',
                      color: selSession.oee_p == null ? 'var(--muted)' : selSession.oee_p >= 85 ? '#22c55e' : selSession.oee_p >= 70 ? '#f59e0b' : '#ef4444' },
                    { label: '%Q', value: selSession.oee_q != null ? `${Number(selSession.oee_q).toFixed(1)}%` : 'N/A',
                      color: selSession.oee_q == null ? 'var(--muted)' : selSession.oee_q >= 99 ? '#22c55e' : selSession.oee_q >= 95 ? '#f59e0b' : '#ef4444' },
                    { label: 'OEE',      value: selSession.oee != null ? `${selSession.oee}%` : 'N/A', color: oeeColor },
                  ].map(k => (
                    <div key={k.label} style={{ background: 'var(--bg2)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>{k.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.value}</div>
                    </div>
                  ))}
                </div>

                {/* จอกว้าง: งานเสีย+Downtime คอลัมน์ซ้าย · สรุปแยกตามชิ้นงาน คอลัมน์ขวา — จอแคบเรียงลงเหมือนเดิม */}
                <div style={{ display: 'grid', gridTemplateColumns: twoCol ? '1fr 1fr' : 'minmax(0, 1fr)', gap: twoCol ? 14 : 0, alignItems: 'start' }}>
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
                    // หักเวลา Downtime ที่ทับซ้อนช่วงวิ่งของ MAT.NO นี้ + "พักตามนโยบาย" ออกก่อน — ให้ฐานเวลา
                    // ตรงกับ P รวมใน computeOEE() ที่หักทั้งคู่ (เคยหักแค่ DT → "ควรได้" เกินจริง %P พาร์ทต่ำกว่า
                    // P รวมทั้งที่รันงานตัวเดียว เช่นกะดึกพักรวม 120 นาที ทำให้เพี้ยน ~15% — user ชี้ 2026-07-14)
                    const winMin = (actualStart && winEndMs) ? Math.max(0, (winEndMs - actualStart.getTime()) / 60000
                      - dtOverlapMin(actualStart.getTime(), winEndMs)
                      - computePolicyBreakMin(actualStart, new Date(winEndMs), selSession?.shift || 'day', sessionProcessType())) : null;
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
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(280px, 100%), 1fr))', gap: 6 }}>
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
                        <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 6 }}>⚠ มี Downtime บางรายการไม่ได้ระบุเวลาเริ่ม/จบ จึงไม่แสดงในไทม์ไลน์ (นับรวมในยอด Downtime และหักใน %A แล้ว)</div>
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

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button onClick={() => setShowApproveReview(false)} style={cancelBtnStyle}>ปิด</button>
                  <button onClick={() => { setShowApproveReview(false); setRejectReason(''); setShowRejectModal(true); }} style={{ ...cancelBtnStyle, borderColor: '#ef4444', color: '#ef4444', fontWeight: 700 }}>✕ ปฏิเสธ</button>
                  <input type="text" value={approveNote} onChange={e => setApproveNote(e.target.value)}
                    placeholder="📝 หมายเหตุผู้อนุมัติ (ไม่บังคับ) — เช่น ข้อสังเกต/สิ่งที่ให้ไปแก้กะหน้า"
                    style={{ flex: '1 1 260px', fontSize: 12, padding: '8px 10px', borderRadius: 8 }} />
                  <button onClick={() => { setShowApproveReview(false); handleApproveClose(); }} style={{ ...saveBtnStyle, background: '#22c55e', fontWeight: 700 }}>✅ ยืนยันอนุมัติ</button>
                </div>
              </div>
            </div>
          );
        })()}

        {showCloseShift && selSession && (() => {
          /* ⚠️ NG ของ OEE preview ต้องมาจาก defect_logs จริง (ไม่รวมงานทดลอง) ให้ตรงกับที่ปิดกะจะ stamp
             เดิมอ่าน state `closeNg` ซึ่งถูกเซ็ตเป็น '0' ที่เดียวและไม่มี input ผูกอยู่เลย
             → Q = 100% ตลอด · SV เห็น OEE สูงเกินจริงก่อนกดอนุมัติ แล้วค่าที่บันทึกไม่ตรงกับที่เห็น */
          const ng = sumDefectQty(defectLogs, 'line');
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
          const { A, P, Q, oee, shiftMin, netAvail, runMin, policyBreakMin, totalProduced, knownQty, unknownQty, pOver, pRawPct } = computeOEE(ng, closeEndTime, closeStartTime, previewDtLogs);
          const oeeColor = oee == null ? 'var(--muted)' : oee >= 0.85 ? '#22c55e' : oee >= 0.65 ? '#f59e0b' : '#ef4444';
          // จอ landscape กว้าง → แผ่เนื้อหาเป็น 2 คอลัมน์แทนการยืดสูงจน scroll (layout อย่างเดียว ไม่แตะ logic/การคำนวณ)
          const twoCol = wide1100;
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
                {/* %P ตันเพดาน — งานที่บันทึกมากกว่าเวลาเครื่องที่มีจริง แปลว่าข้อมูลมีอะไรผิด
                    ห้าม cap เงียบแล้วปล่อยผ่าน (เตือนอย่างเดียว ไม่บล็อกการปิดกะ — หน้างานต้องเดินต่อได้) */}
                {pOver && (
                  <div style={{ fontSize: 12, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.45)', borderRadius: 8, padding: '8px 12px', marginBottom: 14, color: '#f59e0b', fontWeight: 600 }}>
                    ⚠ %P คำนวณได้ {pRawPct}% (เกิน 100% เลยถูกตัดเหลือ 100%) — งานตามมาตรฐานมากกว่าเวลาเครื่องที่มีในกะนี้
                    <div style={{ fontWeight: 400, color: 'var(--text2)', marginTop: 3 }}>
                      ปิดกะได้ตามปกติ แต่ควรตรวจ: CT ของชิ้นงาน (Product Master) · ยอดที่กรอก · เวลาเปิด-ปิดใบ · จำนวนเครื่องขนานของไลน์ (LineSetup)
                    </div>
                  </div>
                )}

                <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                  <Field label="เวลาเริ่มกะจริง (แก้ได้ถ้าตอนเปิดกะ/auto-เดาเวลาผิด)">
                    <TimeInput24 value={closeStartTime} onChange={e => setCloseStartTime(e.target.value)} style={{ fontSize: 16 }} />
                  </Field>
                  <Field label="เวลาปิดกะจริง (ใช้คำนวณ OEE — แก้ได้ถ้าทำรายการย้อนหลัง)">
                    <TimeInput24 value={closeEndTime} onChange={e => setCloseEndTime(e.target.value)} style={{ fontSize: 16 }} />
                  </Field>
                </div>

                {/* จอกว้าง: Downtime เปิดค้าง (ต้องตัดสินใจ) คอลัมน์ซ้าย · สรุปตัวเลขกะ คอลัมน์ขวา — จอแคบเรียงลงเหมือนเดิม */}
                <div style={{ display: 'grid', gridTemplateColumns: hasOpenDTCol ? '1fr 1fr' : 'minmax(0, 1fr)', gap: hasOpenDTCol ? 14 : 0, alignItems: 'start' }}>
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
                  /* ⚠️ ห้ามใช้ `ดี − NG` — ยอดที่สแกนปิดใบ = ของดีล้วนอยู่แล้ว (กฎ Q · 2026-08-02)
                     สูตรเดิม `max(0, prod−ng−sus−rep)` ขัดกับ qty_ok ที่ stamp (= ยอดสแกนเต็ม)
                     และ max(0,...) ยังกลบเคสติดลบ (NG > ยอดสแกน) ซึ่งเป็นสัญญาณข้อมูลผิดที่ควรเห็น */
                  const tok   = prod;
                  return (
                    <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>🔴 สรุปงานเสีย ({defectLogs.length} รายการ)</div>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        {tng  > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>🔴 NG: {tng}</span>}
                        {tsus > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b' }}>🟡 สงสัย: {tsus}</span>}
                        {trep > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa' }}>🔧 ซ่อม: {trep}</span>}
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }} title="ยอดที่สแกนปิดใบ = ของดีล้วน (ของเสียถูกผลิตเพิ่มต่างหาก ไม่หักจากยอดนี้)">✅ ยอดสแกน (ของดี): {tok}</span>
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
                    // หักเวลา Downtime ที่ทับซ้อนช่วงวิ่งของ MAT.NO นี้ + "พักตามนโยบาย" ออกก่อน — ให้ฐานเวลา
                    // ตรงกับ P รวมใน computeOEE() ที่หักทั้งคู่ (เคยหักแค่ DT → "ควรได้" เกินจริง %P พาร์ทต่ำกว่า
                    // P รวมทั้งที่รันงานตัวเดียว เช่นกะดึกพักรวม 120 นาที ทำให้เพี้ยน ~15% — user ชี้ 2026-07-14)
                    const winMin = (actualStart && winEndMs) ? Math.max(0, (winEndMs - actualStart.getTime()) / 60000
                      - dtOverlapMin(actualStart.getTime(), winEndMs)
                      - computePolicyBreakMin(actualStart, new Date(winEndMs), selSession?.shift || 'day', sessionProcessType())) : null;
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
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(280px, 100%), 1fr))', gap: 6 }}>
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
                        <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 6 }}>⚠ มี Downtime บางรายการไม่ได้ระบุเวลาเริ่ม/จบ จึงไม่แสดงในไทม์ไลน์ (นับรวมในยอด Downtime และหักใน %A แล้ว)</div>
                      )}
                    </div>
                  );
                })()}

                {/* จอกว้าง: รายการตัดสินใจ Order ที่ยังไม่ปิด คอลัมน์ซ้าย · OEE preview คอลัมน์ขวา (เห็นผลจากการตัดสินใจข้างๆ กันทันที) */}
                <div style={{ display: 'grid', gridTemplateColumns: hasOpenOrdersCol ? '1fr 1fr' : 'minmax(0, 1fr)', gap: hasOpenOrdersCol ? 14 : 0, alignItems: 'start' }}>
                <div style={{ minWidth: 0 }}>
                {/* Carry-over: handle open orders */}
                {(() => {
                  const openOrders = prodOrders.filter(o => o.status === 'open');
                  if (!openOrders.length) return null;
                  // ยอดยกต้องมาจากของจริงที่ leader กรอกเองเท่านั้น ห้ามให้ระบบประมาณเวลาที่ "น่าจะ" ผลิตได้มาเติมให้
                  // (ของเดิมเคยเดาจากเวลาที่เหลือ ทำให้ดูเหมือนผลิตครบทั้งที่ยังไม่ได้ทำ)
                  // ข้อยกเว้นเดียว: ยอดที่ "คนกรอกเอง" ไว้ระหว่างกะ (qty_actual) ถูกเติมให้ตอนเปิด modal — แก้ทับได้
                  // ที่เหลือเริ่มที่ 0 เสมอ บังคับให้กรอกเอง
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

                {/* หมายเหตุของหัวหน้ากลุ่ม (ผู้ขอปิดกะ) — เดิมมีแต่ช่องหมายเหตุฝั่ง SV (อนุมัติ/ปฏิเสธ)
                    คนขอไม่มีที่อธิบายว่าทำไมยอดไม่ถึง/เกิดอะไรขึ้น · ไม่บังคับ */}
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 5 }}>
                    📝 {role === 'leader' ? 'หมายเหตุถึงผู้อนุมัติ' : 'หมายเหตุปิดกะ'} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(ไม่บังคับ)</span>
                  </div>
                  <textarea value={closeNote} onChange={e => setCloseNote(e.target.value)} rows={2}
                    placeholder="เช่น ยอดไม่ถึงเป้าเพราะรอ material ตั้งแต่ 14:00 · เครื่องเสียช่วงบ่าย รอช่าง"
                    style={{ width: '100%', padding: '8px 10px', fontSize: 12.5, borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit' }} />
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

        {/* ── EDIT TIMES modal — แก้เวลากะ + per-MAT.NO สำหรับกะที่ปิดแล้ว ─── */}
        {showEditTimes && selSession && (() => {
          const matNos = Array.from(new Set(prodOrders.map(o => o.mat_no))).filter(Boolean);
          return (
            <div className="overlay" style={{ zIndex: 2000 }}>
              <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '2px solid rgba(99,102,241,0.5)', borderRadius: 14, padding: 24, width: 'min(95vw, 900px)', maxHeight: '90vh', overflowY: 'auto' }}>
                <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 2, color: '#6366f1' }}>✏️ แก้เวลากะ + คำนวณ OEE ใหม่</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
                  {selSession.line_name} · {selSession.shift === 'day' ? 'กะเช้า' : 'กะดึก'} · {fmtDate(selSession.work_date)}
                </div>
                <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 16 }}>
                  ⚠ เวลาที่แก้ไม่เกี่ยวกับเวลาสแกนกัมบัง — ใช้เฉพาะคำนวณ %A, %P, OEE เท่านั้น
                </div>

                {/* เวลาเริ่ม-จบกะ */}
                <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
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
                        {lineStds.map(s => {
                          /* ชื่อสินค้าซ้ำกันเป๊ะ = พนักงานเลือกผิดใบได้ (หน้างานแจ้ง 2026-08-14:
                             10105769 กับ 10105770 ชื่อเดียวกันทั้งคู่) → ต่อท้ายด้วยเลขพาร์ทลูกค้า
                             ที่พอแยกออก + ติดธง ⚠ ให้เห็นว่าคู่ไหนกำกวม (แก้จริงต้องไปตั้งชื่อ
                             ให้ต่างกันที่ Product Master — ระบบไม่เดาชื่อให้) */
                          const nm = s.dr_products?.name || s.part_name || '';
                          const dup = nm && lineStds.filter(x => (x.dr_products?.name || x.part_name || '') === nm).length > 1;
                          return (
                            <option key={s.id} value={s.mat_no}>
                              {s.mat_no}{nm ? ` · ${nm}` : ''}
                              {dup && s.dr_products?.p_no ? ` · [${s.dr_products.p_no}]` : ''}
                              {dup ? ' ⚠ชื่อซ้ำ' : ''} ({s.qty_per_kanban} ชิ้น/ใบ)
                            </option>
                          );
                        })}
                      </select>
                      {(() => {
                        const names = lineStds.map(s => s.dr_products?.name || s.part_name || '').filter(Boolean);
                        const dupN = names.filter((n, i) => names.indexOf(n) !== i).length;
                        if (!dupN) return null;
                        return (
                          <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>
                            ⚠ มีชื่อสินค้าซ้ำกัน {dupN} คู่ในไลน์นี้ — เสี่ยงเปิดผิดใบ · แก้ชื่อให้ต่างกัน (เช่นใส่ลูกค้า AAT/FTM) หรือปิดใช้งานตัวเก่าที่ Product Master
                          </div>
                        );
                      })()}
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

                {/* ⚠️ จำนวนต่อ Tag Card = มาตรฐาน SAP/คัมบัง **ห้ามแก้** (คำสั่ง user 2026-08-24)
                    1 ใบ = จำนวนที่ตั้งไว้ใน kanban_standards.qty_per_kanban เสมอ — ไม่ใช่ค่าที่คนกรอกเอง
                    เดิมเปิดให้พิมพ์ทับ → มีการแก้เยอะมากทั้งที่เป็นการสแกนใบตามมาตรฐาน
                    = ยอดผลิต/สต็อก/backflush เพี้ยนตามแบบไล่ย้อนไม่ได้ว่าใบไหนถูกแก้
                    ยังไม่มีมาตรฐาน (พาร์ทใหม่/ยังไม่ตั้ง) = ยังต้องพิมพ์ได้ ไม่งั้นเปิดใบไม่ได้เลย */}
                <Field label={openProdStd ? `Qty ต่อ Tag Card — 🔒 ล็อกตามมาตรฐาน (${openProdStd.qty_per_kanban} ชิ้น/ใบ)` : 'Qty ต่อ Tag Card (ชิ้น) *'}>
                  <input id="open-qty-input" type="number" min="1" value={openProdForm.qty}
                    readOnly={!!openProdStd}
                    title={openProdStd ? 'จำนวนต่อใบมาจากมาตรฐานคัมบัง แก้ที่ Product Master → 🎴 Kanban Std' : undefined}
                    onChange={e => { if (!openProdStd) setOpenProdForm(f => ({ ...f, qty: e.target.value })); }}
                    onKeyDown={e => { if (e.key === 'Enter') handleScanOpen(); }}
                    style={{ ...inputStyle, fontSize: 22, fontWeight: 900, textAlign: 'center',
                      background: openProdStd ? 'rgba(34,197,94,0.08)' : 'var(--bg)',
                      color: openProdStd ? '#22c55e' : 'var(--text)',
                      cursor: openProdStd ? 'not-allowed' : undefined }} />
                  {openProdStd
                    ? <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
                        ใบนี้เป็นการสแกนตามมาตรฐาน — จำนวนต่อใบแก้ที่นี่ไม่ได้
                        {' '}· ถ้าจำนวนจริงไม่ตรง ให้แก้มาตรฐานที่ <b>Product Master → 🎴 Kanban Std</b>
                        {' '}· ผลิตไม่ครบใบให้กรอก <b>ยอดที่ทำได้</b> บนการ์ดใบแทน
                      </div>
                    : <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4, lineHeight: 1.5 }}>
                        ⚠️ พาร์ทนี้ยังไม่ได้ตั้งจำนวนต่อใบ (Kanban Std) — กรอกเองได้ครั้งนี้
                        {' '}แต่ควรไปตั้งที่ <b>Product Master → 🎴 Kanban Std</b> ให้เรียบร้อย
                      </div>}
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
                    const pts = sessionProcessTypesAll();
                    const filtered = defectTypes.filter(t => !t.process_type || t.process_type === 'common' || pts.has(t.process_type));
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

                {/* 🧪 งานทดลอง — ของเสียจากลองแม่พิมพ์/ลองงานใหม่ ไม่ควรลงโทษ %Q ของไลน์
                    แต่ยอดยังถูกเก็บครบเพื่อคิดมูลค่าของเสีย (2026-08-17 · คำสั่ง user) */}
                {(() => {
                  const byType = defectTypes.find(t => t.id === defectForm.defect_type_id)?.excl_from_q === true;
                  const on = byType || defectForm.is_trial;
                  return (
                    <div style={{ marginTop: 10, padding: '9px 12px', borderRadius: 8,
                      border: `1px solid ${on ? '#a855f7' : 'var(--border)'}`,
                      background: on ? 'rgba(168,85,247,0.10)' : 'var(--bg2)' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: byType ? 'default' : 'pointer' }}>
                        <input type="checkbox" checked={on} disabled={byType}
                          onChange={e => setDefectForm(f => ({ ...f, is_trial: e.target.checked }))}
                          style={{ width: 'auto', margin: 0 }} />
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: on ? '#a855f7' : 'var(--text2)' }}>
                          🧪 งานทดลอง (Try-out) — ไม่นับเข้า %Q
                        </span>
                      </label>
                      <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4, lineHeight: 1.6 }}>
                        {byType
                          ? 'ประเภทนี้ถูกตั้งเป็นงานทดลองไว้แล้วที่ ⚙️ ตั้งค่า — ติ๊กให้อัตโนมัติ'
                          : 'เช่น ลองแม่พิมพ์ใหม่ / ลองงานใหม่ — ยอดยังถูกเก็บครบเพื่อคิดมูลค่าของเสีย แค่ไม่ฉุด OEE ของไลน์'}
                      </div>
                    </div>
                  );
                })()}
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
          // เครื่องจักร + ชิ้นงาน เป็น optional ทุกประเภท downtime — หลายอย่าง (5ส/ประชุม/รอวัตถุดิบ/QA recheck)
          // เป็นการหยุดระดับไลน์ ไม่ผูกเครื่อง/ชิ้นงานเฉพาะ (machine_no/mat_no nullable · OEE แยกด้วย category)
          const dtMachineOptional = true;
          /* ตัวเลือก "ชิ้นงาน" ของฟอร์ม Downtime — 3 แหล่งรวมกัน (dedupe ด้วย mat_no)
             ⚠️ เดิมดึงจาก kanban_standards + ชื่อไลน์ "ตรงเป๊ะ" อย่างเดียว → ไลน์ที่สินค้า
             ไม่ได้อยู่ในระบบคัมบัง หรือสินค้าผูกกับไลน์แม่/ไลน์พี่น้อง จะขึ้น
             "ไม่มีชิ้นงานในไลน์นี้" ทั้งที่กำลังผลิตอยู่จริง (หน้างานเลเซอร์แจ้งเข้ามา 2026-08-14)
             → เอา "ใบงานที่เปิดในกะนี้" มาก่อน (ตรงประเด็นสุด — คือของที่วิ่งอยู่จริง)
               แล้วเสริมด้วยสินค้า/คัมบังของ "ครอบครัวไลน์" (กฎเดียวกับ sessionProcessTypesAll) */
          const dtMatOptions = (() => {
            const fam = new Set(getLineFamilyNames(lines, selSession?.line_name || '').map(n => (n || '').trim().toLowerCase()));
            const inFam = (ln) => fam.has((ln || '').trim().toLowerCase());
            const seen = new Map();
            const add = (mat, name, src) => { if (mat && !seen.has(mat)) seen.set(mat, { mat_no: mat, name: name || '', src }); };
            prodOrders.filter(o => !['cancelled', 'imported'].includes(o.status))
              .forEach(o => add(o.mat_no, o.part_name || products.find(p => p.mat_no === o.mat_no)?.name, 'order'));
            products.filter(p => inFam(p.line_name)).forEach(p => add(p.mat_no, p.name, 'line'));
            kanbanStds.filter(s => inFam(s.dr_products?.line_name)).forEach(s => add(s.mat_no, s.dr_products?.name || s.part_name, 'kanban'));
            return [...seen.values()];
          })();
          /* ตัวเลือก "เครื่องจักร" ของฟอร์ม Downtime — บั๊กเดียวกับ dtMatOptions ข้างบน แต่ตกสำรวจ
             ⚠️ เดิมกรอง `m.line_name === selSession.line_name` **ตรงเป๊ะ** → เครื่องที่ลงทะเบียน
                ไว้ใต้ไลน์แม่/ไลน์พี่น้อง **ไม่โผล่ในลิสต์เลย** (กะมักเปิดที่ไลน์ลูก)
                ⇒ หน้างานไม่มีทางเลือกเครื่อง เลยไปพิมพ์เลขเครื่องลงช่อง "รายละเอียด" แทน
                  แล้ว `machine_no` เป็น null → จอห้องช่างจัดเป็น "ไม่ระบุเครื่อง" ต่อทีมไม่ได้
                  (เจอจริง 2026-08-26: Assy LWR ลง "Robot 103 …" ในหมายเหตุ · กฎเดียวกับ
                   machineOpts ของ /improvements ที่แก้ไปแล้ว 2026-08-19)
             กติกา: ไลน์นี้ก่อน → ครอบครัวไลน์ → เครื่องอื่นทั้งโรงงาน → แม่พิมพ์ท้ายสุด
                    **ไม่ตัดอะไรทิ้ง** (ค้นเจอได้หมด) แต่เรียงให้ตัวที่น่าจะใช่อยู่บนสุด */
          const dtMachineOptions = (() => {
            const line = (selSession?.line_name || '').trim().toLowerCase();
            const fam = new Set(getLineFamilyNames(lines, selSession?.line_name || '').map(n => (n || '').trim().toLowerCase()));
            const G = ['🏭 เครื่องในไลน์นี้', '🔗 เครื่องในกลุ่มไลน์', '🏢 เครื่องอื่นในโรงงาน', '🔨 แม่พิมพ์'];
            const rank = (m) => {
              if (m.equipment_kind === 'die') return 3;      // แม่พิมพ์ผูกชื่อกลุ่มเครื่องปั๊ม ไม่ใช่ไลน์ผลิต
              const s = (m.line_name || '').trim().toLowerCase();
              if (s && s === line) return 0;
              if (s && fam.has(s)) return 1;
              return 2;
            };
            return (machines || [])
              .map((m, i) => {
                const r = rank(m);
                return {
                  id: m.machine_no, _r: r, _i: i, group: G[r],
                  label: `${m.machine_no}${m.machine_name ? ` · ${m.machine_name}` : ''}`,
                  sub: r === 0 ? '' : (m.line_name || 'ไม่ระบุไลน์'),
                  keywords: `${m.machine_name || ''} ${m.line_name || ''} ${m.machine_type || ''}`,
                };
              })
              .filter(o => o.id)
              .sort((a, b) => a._r - b._r || a._i - b._i);   // _i = ลำดับจาก DB (line_name, sort_order)
          })();
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
                      const pts = sessionProcessTypesAll();
                      const filtered = dtTypes.filter(t => !t.process_type || t.process_type === 'common' || pts.has(t.process_type));
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
                  <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: dtForm.mode === 'start_end' ? '1fr 1fr' : '1fr 1fr', gap: 10 }}>
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

                  <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Field label={`เครื่องจักร ${dtMachineOptional ? '(ถ้ามี)' : '*'}`}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                        {/* ค้นได้ทั้งทะเบียน (เครื่องจักร 500+ ตัว) — ห้ามกลับไปเป็น <select> ที่กรองไลน์ตรงเป๊ะ
                            พิมพ์เองยังได้ (เครื่องที่ยังไม่ลงทะเบียน) แต่ SearchSelect ติดป้ายบอกว่าอยู่นอกทะเบียน */}
                        <SearchSelect
                          value={machines.some(m => m.machine_no === dtForm.machine_no) ? dtForm.machine_no : ''}
                          text={dtForm.machine_no}
                          options={dtMachineOptions}
                          allowFree
                          placeholder="ค้นหาเครื่อง — เลขเครื่อง / ชื่อ / ไลน์"
                          emptyText="ไม่พบเครื่องนี้ในทะเบียน"
                          freeHint="ไม่ได้อยู่ในทะเบียน — ต่อใบซ่อม/ประวัติเครื่องไม่ได้"
                          inputStyle={inputStyle}
                          onChange={({ id, text }) => setDtForm(f => ({ ...f, machine_no: id || text }))}
                        />
                        </div>
                        {/* สแกน QR ที่ติดเครื่อง — เครื่องเสียต้องรีบ ไม่ต้องไล่หาในลิสต์ */}
                        <button type="button" className="tbtn" onClick={() => setDtScanOpen(true)} title="สแกน QR บนเครื่อง"
                          style={{ flexShrink: 0, padding: '0 12px', borderRadius: 8, border: '1.5px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: 16, cursor: 'pointer' }}>📷</button>
                      </div>
                    </Field>
                    <Field label={`ชิ้นงาน (แยก OEE/Downtime ตามชิ้นงาน) ${dtMachineOptional ? '(ถ้ามี)' : '*'}`}>
                      {!dtMatOptions.length ? (
                        /* ว่างจริง = ยังไม่มีใบงานในกะ และไม่มีสินค้าผูกกับไลน์เลย → บอกทางแก้ ห้ามปล่อยเป็นทางตัน */
                        <div style={{ ...inputStyle, color: 'var(--muted)', display: 'flex', alignItems: 'center', fontSize: 12 }}>
                          — ยังไม่มีชิ้นงานให้เลือก (เปิดใบงาน หรือผูกสินค้ากับไลน์ที่ Product Master) · ข้ามได้
                        </div>
                      ) : (
                        <select value={dtForm.mat_no} onChange={e => setDtForm(f => ({ ...f, mat_no: e.target.value }))} style={inputStyle}>
                          <option value="">เลือกชิ้นงาน...</option>
                          {dtMatOptions.map(o => (
                            <option key={o.mat_no} value={o.mat_no}>
                              {o.src === 'order' ? '▶ ' : ''}{o.mat_no}{o.name ? ` · ${o.name}` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                  </div>
                  <Field label="รายละเอียด">
                    <input type="text" value={dtForm.description} onChange={e => setDtForm(f => ({ ...f, description: e.target.value }))} placeholder="สาเหตุ..." style={inputStyle} />
                  </Field>
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
                  <button onClick={() => setShowDT(false)} style={cancelBtnStyle}>ยกเลิก</button>
                  {(() => {
                    const dtInvalid = !dtForm.downtime_type_id || !hasResult || (!dtMachineOptional && !dtForm.machine_no) || (!dtMachineOptional && dtMatOptions.length > 0 && !dtForm.mat_no);
                    return (
                      <button onClick={handleAddDT} disabled={savingDT || dtInvalid}
                        style={{ ...saveBtnStyle, background: '#ef4444', opacity: (dtInvalid || savingDT) ? 0.5 : 1 }}>
                        {savingDT ? '...' : (dtForm.id ? 'บันทึกการแก้ไข' : 'บันทึก Downtime')}
                      </button>
                    );
                  })()}
                </div>
                {dtScanOpen && (
                  <ScanModal
                    title="สแกนเครื่องจักร"
                    hint="ส่องกล้องที่ป้าย QR บนเครื่อง หรือยิงด้วยเครื่องสแกน"
                    onScan={(parsed) => {
                      // ค้นทั้งโรงงานก่อน แล้วค่อยดูว่าอยู่ในครอบครัวไลน์เดียวกันไหม
                      const mc = resolveMachine(parsed, machines);
                      if (!mc) return `ไม่พบเครื่องนี้ในฐานข้อมูล (${parsed.raw})`;
                      /* ⚠️ เดิม **บล็อก** เมื่อ line_name ไม่ตรงเป๊ะ → สแกน QR ที่ติดอยู่บนเครื่องตรงหน้า
                         แล้วโดนปฏิเสธ เพราะเครื่องลงทะเบียนไว้ใต้ไลน์แม่/ไลน์พี่น้อง
                         กติกา: อยู่ในครอบครัวไลน์ = รับเลย · นอกครอบครัว = **เตือนแล้วให้ยืนยัน ไม่บล็อก**
                         (เครื่องกลาง/utility ที่จ่ายหลายไลน์มีจริง — บล็อกแล้วลง downtime ไม่ได้เลย) */
                      const fam = new Set(getLineFamilyNames(lines, selSession.line_name).map(n => (n || '').trim().toLowerCase()));
                      const mcLine = (mc.line_name || '').trim().toLowerCase();
                      if (mcLine && !fam.has(mcLine)) {
                        const ok = window.confirm(`เครื่อง ${mc.machine_no} ลงทะเบียนไว้ที่ไลน์ "${mc.line_name}"\nไม่ใช่ "${selSession.line_name}" ที่เปิดกะอยู่\n\nยืนยันเลือกเครื่องนี้?`);
                        if (!ok) return `ยกเลิก — เครื่อง ${mc.machine_no} อยู่ไลน์ ${mc.line_name}`;
                      }
                      setDtForm(f => ({ ...f, machine_no: mc.machine_no || f.machine_no }));
                      toast.success(`เลือกเครื่อง ${mc.machine_no}`);
                    }}
                    onClose={() => setDtScanOpen(false)}
                  />
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ⏰ STALE TAB — ไล่ปิดกะที่ค้าง (2026-08-26 · คำสั่ง user)
   แยกออกจาก Live เพราะเป็นงานคนละจังหวะ: Live = กะที่กำลังเดินอยู่ตอนนี้ ·
   แท็บนี้ = ตามเก็บงานค้างของหัวหน้าแผนก (คิวที่ต้องเคลียร์ให้หมด)
   ⚠️ อ่านอย่างเดียว + พาไปที่กะนั้นในแท็บ Live — **ห้ามใส่ปุ่มปิด/อนุมัติรวบทีเดียวที่นี่**
      ปิดกะต้องยืนยันยอดผลิต/OEE รายกะ (modal ปิดกะ) · กดรวบ = stamp ตัวเลขที่ไม่มีคนดู
═══════════════════════════════════════════════════════════════ */
function StaleTab({ stale, onOpenSession, role }) {
  const rows = stale?.rows || [];
  const [q, setQ] = useState('');
  const [side, setSide] = useState('all');   // all | sv (รอ SV อนุมัติ) | leader (ยังไม่ขอปิด)

  /* 🧹 เคลียร์ "กะเปล่า" ทีเดียว — ส่วนหนึ่งของกะค้างคือกะที่เปิดผิด/เปิดทิ้งไว้ ไม่มีข้อมูลเลย
     แล้วไม่มีใครกล้าแตะเพราะต้องเข้าไปกดลบทีละกะ
     ⚠️ ลบได้เฉพาะกะที่ "ไม่มี Order/Downtime/ของเสีย เลย" — ลบกะเปล่าไม่ได้สร้างข้อมูลเท็จอะไร
        ต่างจาก auto-close ที่ต้อง stamp OEE จากยอดที่ไม่มีคนยืนยัน (ยังห้ามทำตามกฎเดิม)
     ⚠️ ยิงคิวรีเฉพาะตอนกดปุ่ม ไม่ใช่ตอนเปิดแท็บ (กฎ egress)
     ⚠️ ผ่าน fetchByIds เสมอ · error/truncated ห้ามกลืน — โหลดไม่ครบแล้วเดาว่า "เปล่า" = ลบกะที่มีข้อมูลทิ้ง */
  const [emptyScan, setEmptyScan] = useState(null);   // null=ยังไม่ตรวจ · { busy, ids, err }
  const scanEmpty = async () => {
    const ids = rows.map(o => o.id);
    if (!ids.length) return;
    setEmptyScan({ busy: true, ids: [], err: null });
    const has = new Set();
    for (const t of ['prod_orders', 'downtime_logs', 'defect_logs']) {
      const r = await fetchByIds(ids, chunk =>
        supabaseDR.from(t).select('session_id').in('session_id', chunk).order('session_id'));
      if (r.error || r.truncated) { setEmptyScan({ busy: false, ids: [], err: r.error?.message || 'โหลดข้อมูลไม่ครบ' }); return; }
      (r.rows || []).forEach(x => has.add(x.session_id));
    }
    setEmptyScan({ busy: false, ids: ids.filter(id => !has.has(id)), err: null });
  };
  const deleteEmpty = async () => {
    const ids = emptyScan?.ids || [];
    if (!ids.length) return;
    const names = rows.filter(o => ids.includes(o.id))
      .map(o => `• ${o.line_name} · ${o.shift === 'day' ? 'กะเช้า' : 'กะดึก'} · ${fmtDate(o.work_date)}`);
    if (!window.confirm(`ลบกะเปล่า ${ids.length} กะ ?\n(ไม่มี Order / Downtime / ของเสีย เลยสักรายการ)\n\n${names.slice(0, 15).join('\n')}${names.length > 15 ? `\n… และอีก ${names.length - 15} กะ` : ''}`)) return;
    setEmptyScan(e => ({ ...e, busy: true }));
    const { error } = await supabaseDR.from('production_sessions').delete().in('id', ids);
    if (error) { toast.error('ลบไม่สำเร็จ: ' + error.message); setEmptyScan(e => ({ ...e, busy: false })); return; }
    toast.success(`ลบกะเปล่าที่ค้าง ${ids.length} กะเรียบร้อย`);
    setEmptyScan(null);
    stale.reload?.();
  };

  const shown = rows.filter(o => {
    if (side === 'sv' && o.status !== 'pending_close') return false;
    if (side === 'leader' && o.status === 'pending_close') return false;
    const k = q.trim().toLowerCase();
    return !k || `${o.line_name} ${o.group || ''} ${o.close_requested_by_name || ''}`.toLowerCase().includes(k);
  });
  const over = rows.filter(o => o.age > STALE_SESSION_DAYS);
  const waitSv = rows.filter(o => o.status === 'pending_close');
  const waitLeader = rows.length - waitSv.length;

  if (stale?.loading) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>กำลังโหลด...</div>;
  // โหลดไม่สำเร็จ ต้องบอกตรงๆ ห้ามโชว์ "ไม่มีกะค้าง" (0 กับ อ่านไม่ได้ คนละเรื่อง)
  if (stale?.error) return (
    <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '14px 18px', color: '#ef4444', fontSize: 13, fontWeight: 700 }}>
      ⚠ โหลดรายการกะค้างไม่สำเร็จ — {stale.error.message || 'ไม่ทราบสาเหตุ'}
      <button onClick={() => stale.reload?.()} style={{ marginLeft: 12, ...saveBtnStyle, padding: '4px 12px', fontSize: 12 }}>↻ ลองใหม่</button>
    </div>
  );

  const chip = (on, label, onClick) => (
    <button onClick={onClick} style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
      border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent-dim)' : 'var(--bg3)', color: on ? 'var(--accent)' : 'var(--text2)' }}>{label}</button>
  );

  return (
    <div>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 12, padding: '14px 18px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>⏰ กะค้างยังไม่ปิด {rows.length} กะ</div>
          {over.length > 0 && (
            <span style={{ fontSize: 11.5, fontWeight: 800, padding: '3px 10px', borderRadius: 10, background: 'rgba(239,68,68,0.18)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.5)' }}>
              เกินเป้า {STALE_SESSION_DAYS} วัน {over.length} กะ · เก่าสุด {rows[0]?.age} วัน
            </span>
          )}
          <button onClick={() => stale.reload?.()} style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer' }}>↻ รีเฟรช</button>
        </div>
        <div style={{ fontSize: 11.5, color: '#ef4444', lineHeight: 1.6 }}>
          กะที่ไม่ปิด = OEE/ยอดผลิตของวันนั้น<b>หายจากรายงานเดือน</b> (ระบบนับเฉพาะกะที่ปิดแล้ว) · เป้าหมาย: เคลียร์ภายใน {STALE_SESSION_DAYS} วัน
          <span style={{ color: 'var(--muted)' }}> · เริ่มกะใหม่ของวันนี้ได้ตามปกติ ไม่ต้องรอเคลียร์</span>
        </div>

        {/* 🧹 กะเปล่า = เปิดผิด/เปิดทิ้งไว้ ลบทิ้งได้โดยไม่กระทบรายงาน — กะที่มีข้อมูลจริงยังต้องให้คนปิดเองเสมอ */}
        {can('daily_report', 'delete_session', role) && rows.length > 0 && (
          <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px dashed var(--border2)', display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            {!emptyScan ? (
              <>
                <button onClick={scanEmpty}
                  style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)' }}>
                  🔎 ตรวจหากะเปล่า
                </button>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  กะที่ไม่มี Order / Downtime / ของเสีย เลย = เปิดผิดหรือเปิดทิ้งไว้ — ลบทีเดียวได้ ไม่ต้องไล่ทีละกะ
                </span>
              </>
            ) : emptyScan.busy ? (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>⏳ กำลังตรวจ…</span>
            ) : emptyScan.err ? (
              /* โหลดไม่ครบ = ห้ามบอกว่า "ไม่มีกะเปล่า" (จะกลายเป็นตีกะที่มีข้อมูลว่าเปล่าแล้วลบทิ้ง) */
              <span style={{ fontSize: 12, color: '#f59e0b' }}>
                ⚠ ตรวจไม่สำเร็จ — {emptyScan.err} · ยังลบไม่ได้
                <button onClick={() => setEmptyScan(null)} style={{ marginLeft: 8, fontSize: 11.5, padding: '3px 9px', borderRadius: 7, cursor: 'pointer', background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)' }}>ลองใหม่</button>
              </span>
            ) : emptyScan.ids.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>
                ✓ ไม่มีกะเปล่า — ทั้ง {rows.length} กะมีข้อมูลจริง ต้องปิด/อนุมัติเอง
              </span>
            ) : (
              <>
                <button onClick={deleteEmpty}
                  style={{ fontSize: 12, fontWeight: 800, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', background: 'rgba(239,68,68,0.9)', border: '1px solid #ef4444', color: '#fff' }}>
                  🗑 ลบกะเปล่า {emptyScan.ids.length} กะ
                </button>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  อีก {rows.length - emptyScan.ids.length} กะมีข้อมูลจริง — ต้องปิด/อนุมัติเอง (ระบบไม่ปิดให้)
                </span>
              </>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {chip(side === 'all', `ทั้งหมด ${rows.length}`, () => setSide('all'))}
        {chip(side === 'sv', `⏳ รอ SV อนุมัติ ${waitSv.length}`, () => setSide('sv'))}
        {chip(side === 'leader', `✏️ หัวหน้ากลุ่มยังไม่ขอปิด ${waitLeader}`, () => setSide('leader'))}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาไลน์ / ชื่อผู้ขอปิด"
          style={{ width: 220, padding: '6px 10px', borderRadius: 8, fontSize: 12.5 }} />
        {shown.length !== rows.length && (
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>แสดง {shown.length} จาก {rows.length} กะ</span>
        )}
      </div>

      {rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>ไม่มีกะค้าง — ปิดครบทุกกะแล้ว</div>
        </div>
      ) : shown.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '36px 20px', color: 'var(--muted)', fontSize: 13 }}>ไม่มีกะที่ตรงกับตัวกรอง</div>
      ) : (
        <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
          {shown.map(o => {
            const late = o.age > STALE_SESSION_DAYS;
            return (
              <button key={o.id} onClick={() => onOpenSession(o.id)}
                title="เปิดกะนี้ในแท็บ Live เพื่อปิด/อนุมัติ"
                style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', width: '100%', textAlign: 'left', cursor: 'pointer',
                  background: 'var(--card)', border: `1px solid ${late ? 'rgba(239,68,68,0.45)' : 'var(--border2)'}`, borderLeft: `4px solid ${late ? '#ef4444' : '#f59e0b'}`,
                  borderRadius: 10, padding: '11px 14px' }}>
                <span style={{ fontSize: 12, fontWeight: 900, minWidth: 78, color: late ? '#ef4444' : '#f59e0b', fontVariantNumeric: 'tabular-nums' }}>⏰ ค้าง {o.age} วัน</span>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)' }}>{o.line_name}</span>
                {o.group && o.group !== o.line_name && <span style={{ fontSize: 11, color: 'var(--muted)' }}>({o.group})</span>}
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{o.shift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก'} · {fmtDate(o.work_date)}</span>
                {/* ลูกบอลอยู่ฝั่งใคร — ไม่บอก คนก็โทษกันไปมา */}
                <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 9, whiteSpace: 'nowrap',
                  background: o.status === 'pending_close' ? 'rgba(245,158,11,0.15)' : 'var(--bg3)',
                  color: o.status === 'pending_close' ? '#f59e0b' : 'var(--text2)' }}>
                  {o.status === 'pending_close' ? '⏳ ' : '✏️ '}{ballSideText(o)}
                </span>
                {/* เคยถูกตีกลับ = หัวหน้ากลุ่มต้องกลับไปแก้ก่อน ไม่ใช่ SV ดอง */}
                {o.status === 'open' && o.close_reject_at && (
                  <span title={`ถูกตีกลับโดย ${o.close_reject_by_name || '—'}${o.close_reject_reason ? ` — "${o.close_reject_reason}"` : ''}`}
                    style={{ fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 9, background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.4)' }}>↩ เคยถูกตีกลับ</span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800, color: 'var(--accent)' }}>เปิดกะนี้ →</span>
              </button>
            );
          })}
        </div>
      )}
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
  const allLines = useProductionLines();   // ทะเบียนไลน์ (ให้ dropdown มีลำดับชั้น)
  const [expanded, setExpanded]   = useState(null);
  const [dtMap, setDtMap]         = useState({});
  const [defectMap, setDefectMap] = useState({});
  const [orderMap, setOrderMap]   = useState({});
  const [deleting, setDeleting]   = useState(null);
  const [ordersMinimized, setOrdersMinimized] = useState({});
  const [ctByMat, setCtByMat]     = useState({});  // mat_no → cycle_time_sec (สำหรับ %P รายชิ้น)
  const [histBreaks, setHistBreaks] = useState([]); // break_policies — หักพักตามนโยบายจากช่วงวิ่งของพาร์ท

  const canDeleteSession = can('daily_report', 'delete_session', role);

  // ── %P รายชิ้นในประวัติ — สูตรเดียวกับ modal ตรวจสอบคำขอปิดกะ (หัก DT + พักนโยบายจาก window) ──
  const histDtOverlapMin = (startMs, endMs, logs) => {
    if (!startMs || !endMs || endMs <= startMs) return 0;
    return (logs || []).reduce((sum, d) => {
      if (!d.started_at) return sum;
      const ds = new Date(d.started_at).getTime();
      const de = d.ended_at ? new Date(d.ended_at).getTime() : (d.duration_min != null ? ds + d.duration_min * 60000 : null);
      if (de == null) return sum;
      return sum + Math.max(0, (Math.min(de, endMs) - Math.max(ds, startMs)) / 60000);
    }, 0);
  };
  // เวลาพักตามนโยบายในช่วงที่สนใจ — ใช้ util กลาง (src/utils/oee.js) ตัวเดียวกับตอนปิดกะ/OEE Analytics
  // เดิมสูตรนี้ไม่กรอง process_type (query ก็ไม่ได้ select มา) → นับพักเกินจริงในไลน์ที่มีนโยบายเฉพาะ process
  // ทำให้ %P รายชิ้น + OEE จริง ในแท็บประวัติ ไม่ตรงกับหน้าอื่น (รวมเป็นตัวเดียว 2026-08-05)
  const histBreakOverlapMin = (startMs, endMs, workDateStr, shift, processType = null) =>
    policyBreakOverlapMin({ policies: histBreaks, startMs, endMs, workDate: workDateStr, shift, processType });


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

  // CT ต่อ MAT.NO + break policies — โหลดครั้งเดียว ใช้คำนวณ %P รายชิ้นตอน expand
  // CT ผ่าน buildCtMap (fallback kanban_standards → dr_products ตัวเดียวกับตอนปิดกะ) —
  // เดิมดึง kanban อย่างเดียว → MAT ที่ kanban ลิงก์ product ที่ CT ว่าง จะไม่มี %P ให้ดู (แก้ 2026-08-05)
  // break_policies ต้อง select process_type ด้วย ไม่งั้นกรองนโยบายเฉพาะ process ไม่ได้ (นับพักเกิน)
  useEffect(() => {
    Promise.all([
      supabaseDR.from('kanban_standards').select('mat_no, dr_products(cycle_time_sec)').eq('is_active', true),
      supabaseDR.from('dr_products').select('mat_no, cycle_time_sec'),
    ]).then(([k, p]) => setCtByMat(buildCtMap({ kanbanStds: k.data || [], products: p.data || [] })));
    supabaseDR.from('break_policies').select('shift, process_type, start_time, duration_min').eq('is_active', true)
      .then(({ data }) => setHistBreaks(data || []));
  }, []);

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
        <LineSelect lines={allLines.filter(l => lineNames.includes(l.name))} value={filter.line_name}
          placeholder="ทุกไลน์" style={{ ...inputStyle, width: 200 }}
          onChange={v => setFilter(f => ({ ...f, line_name: v }))} />
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
                  {/* หมายเหตุของหัวหน้ากลุ่ม (ผู้ขอปิดกะ) — เขียนตอนส่งขอปิดกะ */}
                  {s.close_request_note && (
                    <div style={{ fontSize: 12, color: '#c4b5fd', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 8, padding: '8px 12px', whiteSpace: 'pre-wrap' }}>
                      📝 หมายเหตุหัวหน้ากลุ่ม ({s.close_requested_by_name || '—'}): <b>{s.close_request_note}</b>
                    </div>
                  )}
                  {/* หมายเหตุผู้อนุมัติปิดกะ (ถ้ามี — SV กรอกตอนกดอนุมัติ) */}
                  {s.close_approve_note && (
                    <div style={{ fontSize: 12, color: '#93c5fd', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 8, padding: '8px 12px' }}>
                      📝 หมายเหตุผู้อนุมัติ ({s.closed_by_name || '—'}): <b>{s.close_approve_note}</b>
                    </div>
                  )}
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

                  {/* OEE จริง — นับ Downtime "ในแผน" เป็นการสูญเสียด้วย (กันการติ๊กในแผนเพื่อดัน OEE)
                      ฐาน = เวลากะ − พักตามนโยบาย · ดู src/utils/oee.js */}
                  {s.oee != null && (() => {
                    const shiftStartMs = s.start_time ? new Date(`${s.work_date}T${s.start_time.slice(0, 5)}:00`).getTime() : null;
                    let shiftEndMs = s.end_time ? new Date(`${s.work_date}T${s.end_time.slice(0, 5)}:00`).getTime() : null;
                    if (shiftStartMs && shiftEndMs && shiftEndMs <= shiftStartMs) shiftEndMs += 86400000;
                    const breakMin = shiftStartMs && shiftEndMs ? histBreakOverlapMin(shiftStartMs, shiftEndMs, s.work_date, s.shift) : 0;
                    const plannedDtMin = dts.filter(d => d.dr_downtime_types?.category === 'planned').reduce((a, d) => a + (d.duration_min || 0), 0);
                    const st = strictOee({ shiftMin: s.shift_min, breakMin, plannedDtMin, a: s.oee_a, p: s.oee_p, q: s.oee_q });
                    if (!st || st.oee == null) return null;
                    const gap = strictGap(s.oee, st.oee);
                    const warn = st.plannedSharePct >= STRICT_WARN_SHARE_PCT;
                    const c = st.oee >= 85 ? '#22c55e' : st.oee >= 65 ? '#f59e0b' : '#ef4444';
                    return (
                      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', borderRadius: 8,
                        background: warn ? 'rgba(245,158,11,0.08)' : 'var(--bg3)', border: `1px solid ${warn ? 'rgba(245,158,11,0.35)' : 'var(--border)'}` }}>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>OEE จริง (นับหยุดในแผนเป็นการสูญเสีย)</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                            ฐาน = เวลากะ {s.shift_min} น. − พัก {Math.round(breakMin)} น. = {st.baseMin} น.
                            {plannedDtMin > 0 ? ` · หยุดในแผน ${Math.round(plannedDtMin)} น. — สูตรมาตรฐานกันออกจากฐาน (เหลือ ${st.loadMin} น.) แต่ตัวนี้นับเป็นสูญเสีย` : ' · ไม่มีหยุดในแผน = เท่ากับ OEE'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 16, marginLeft: 'auto', alignItems: 'center' }}>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>A จริง</div>
                            <div style={{ fontSize: 15, fontWeight: 800, color: st.a >= 85 ? '#22c55e' : st.a >= 65 ? '#f59e0b' : '#ef4444' }}>{st.a.toFixed(1)}%</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>OEE จริง</div>
                            <div style={{ fontSize: 22, fontWeight: 900, color: c }}>{st.oee.toFixed(1)}%</div>
                          </div>
                        </div>
                        {gap > 0.05 && (
                          <div style={{ width: '100%', fontSize: 11, color: warn ? '#f59e0b' : 'var(--muted)' }}>
                            {warn ? '⚠️ ' : ''}ต่ำกว่า OEE ที่รายงาน {gap.toFixed(1)} จุด — มาจากหยุด "ในแผน" {Math.round(plannedDtMin)} นาที ({st.plannedSharePct.toFixed(1)}% ของฐาน)
                            {warn ? ' · ตรวจว่าประเภท Downtime เหล่านี้ควรเป็น "ในแผน" จริงหรือไม่' : ''}
                          </div>
                        )}
                      </div>
                    );
                  })()}

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
                      // %P รายชิ้น (สูตรเดียวกับ modal ตรวจสอบคำขอปิดกะ): window ของพาร์ท − DT ทับซ้อน − พักนโยบาย
                      const openedTimes = matOrders.map(o => o.opened_at).filter(Boolean).map(t => new Date(t).getTime());
                      const closedTimes = matOrders.map(o => o.confirmed_at || o.stopped_at).filter(Boolean).map(t => new Date(t).getTime());
                      const winStart = openedTimes.length ? Math.min(...openedTimes) : null;
                      const winEnd   = closedTimes.length ? Math.max(...closedTimes) : null;
                      const ctSec = ctByMat[matNo] || 0;
                      let achievable = null, pPct = null, winLabel = null;
                      if (winStart && winEnd && winEnd > winStart) {
                        const fmtT = ms => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
                        winLabel = `${fmtT(winStart)}–${fmtT(winEnd)}`;
                        if (ctSec > 0) {
                          const runMin = Math.max(0, (winEnd - winStart) / 60000
                            - histDtOverlapMin(winStart, winEnd, dts)
                            - histBreakOverlapMin(winStart, winEnd, s.work_date, s.shift));
                          achievable = Math.floor(runMin * 60 / ctSec);
                          if (achievable > 0) pPct = Math.min(100, Math.round(qty / achievable * 100));
                        }
                      }
                      return { matNo, partName: matOrders[0]?.part_name, qty, ng, dt, winLabel, achievable, pPct };
                    }).sort((a, b) => b.qty - a.qty);
                    return (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>📦 สรุปแยกตามชิ้นงาน ({rows.length} รายการ) — %P รายชิ้นคิดจากช่วงเวลาที่พาร์ทวิ่งจริง (หัก DT + พักนโยบาย)</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {rows.map(r => (
                            <div key={r.matNo} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: 'var(--card)', borderRadius: 6, border: '1px solid var(--border)', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace' }}>{r.matNo}</span>
                              {r.partName && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{r.partName}</span>}
                              {r.winLabel && <span style={{ fontSize: 11, color: '#4d9fff' }}>🕐 {r.winLabel}</span>}
                              <span style={{ flex: 1 }} />
                              <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e' }}>ผลิต {r.qty}</span>
                              {r.achievable != null && <span style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa' }}>ควรได้ {r.achievable}</span>}
                              {r.pPct != null && (
                                <span style={{ fontSize: 11, fontWeight: 800, padding: '1px 8px', borderRadius: 20,
                                  color: r.pPct >= 85 ? '#22c55e' : r.pPct >= 70 ? '#f59e0b' : '#ef4444',
                                  background: r.pPct >= 85 ? 'rgba(34,197,94,0.12)' : r.pPct >= 70 ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)' }}>
                                  %P ≈ {r.pPct}%
                                </span>
                              )}
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
  const allLines = useProductionLines();   // ทะเบียนไลน์ (ให้ dropdown มีลำดับชั้น)
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
    // NG ยึด defect_logs (session.qty_ng เป็น rollup ตัวเดียวกัน — บวกซ้ำ = 2 เท่า · แก้ 2026-08-05)
    const dfRows      = s.defect_logs || [];
    const ngQty       = dfRows.length ? dfRows.reduce((a, d) => a + (d.qty_ng || 0) + (d.qty_suspect || 0), 0) : (s.qty_ng || 0);
    // ยอดดี = ยอดสแกน ห้ามลบ NG ซ้ำ (กฎ Q 2026-08-02 — การ์ดที่สแกนปิดคือของดีล้วน)
    const okQty       = s.qty_ok ?? (s.actual_qty || 0);
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
      const dfR2     = s.defect_logs || [];   // NG ยึด defect_logs — บวก session.qty_ng ซ้ำ = 2 เท่า (แก้ 2026-08-05)
      const ngQty    = dfR2.length ? dfR2.reduce((a, d) => a + (d.qty_ng || 0) + (d.qty_suspect || 0), 0) : (s.qty_ng || 0);
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

    // รายงานภายใน (ไม่มี layout ฟอร์มทางการ) — อย่างน้อยต้องมีแถบเลขฟอร์มจากทะเบียนกลาง
    // ไม่ตั้งเลขฟอร์มในทะเบียน = ไม่มีแถบ (หน้าตาเดิมเป๊ะ)
    const dfRep = await getDocForm('daily_report_export', {});
    const repCode = [fullCode(dfRep), dfRep.effective_date ? `Effective: ${dfRep.effective_date}` : ''].filter(Boolean).join(' · ');

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

    if (repCode || dfRep.footer_note) {
      const n = doc.getNumberOfPages();
      doc.setFontSize(7).setFont('Sarabun', 'normal');
      for (let p = 1; p <= n; p++) {
        doc.setPage(p);
        if (dfRep.footer_note) doc.text(dfRep.footer_note, 10, 203);
        if (repCode) doc.text(repCode, 287, 203, { align: 'right' });
      }
    }

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
    // เลขฟอร์ม/Rev/หัวเรื่อง/ป้ายช่องลายเซ็น/โลโก้ อ่านจากทะเบียนเอกสารกลาง (/doc-forms) — fallback = ค่าเดิมในโค้ด
    const df = await getDocForm('daily_production_report', {
      title: 'DAILY PRODUCTION REPORT',
      sig_blocks: ['ผู้ผลิต (Operator)', 'หัวหน้างาน (Supervisor)', 'QA / ผู้ตรวจสอบ'],
    });
    const dfCode = [fullCode(df), df.effective_date ? `Effective: ${df.effective_date}` : ''].filter(Boolean).join(' · ');
    const logoDataUrl = await getTsLogoDataUrl(df.logo_url || tsLogoUrl);

    sessions.forEach((s, idx) => {
      if (idx > 0) doc.addPage();
      let y = MARGIN;

      // ── Header (โลโก้บริษัทเดียวกับหน้าเว็บ) ──────────────────
      if (logoDataUrl) doc.addImage(logoDataUrl, 'PNG', MARGIN, y - 2, 10, 11.6);
      doc.setFontSize(13).setFont('Sarabun', 'bold');
      doc.text('Thai Summit Group', MARGIN + (logoDataUrl ? 13 : 0), y + 4);
      doc.setFontSize(15);
      doc.text(df.title || 'DAILY PRODUCTION REPORT', PAGE_W / 2, y + 4, { align: 'center' });
      doc.setFontSize(9).setFont('Sarabun', 'normal');
      doc.text(`ใบรายงานการผลิตประจำกะ`, PAGE_W / 2, y + 9, { align: 'center' });
      y += 15;
      doc.setLineWidth(0.5);
      doc.line(MARGIN, y, PAGE_W - MARGIN, y);
      y += 5;

      // ── Info grid (ไลน์ / วันที่ / กะ / สินค้า / เวลา / ผู้เปิด-ปิด) ──
      const shiftLabel = s.shift === 'day' ? 'กะเช้า (Day)' : 'กะดึก (Night)';
      // NG ยึด defect_logs · ยอดดี = ยอดสแกน ห้ามลบ NG ซ้ำ (กฎ Q · แก้ 2026-08-05)
      const dfR = s.defect_logs || [];
      const ngQty = dfR.length ? dfR.reduce((a, d) => a + (d.qty_ng || 0) + (d.qty_suspect || 0), 0) : (s.qty_ng || 0);
      const okQty = s.qty_ok ?? (s.actual_qty || 0);
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
      // จำนวนช่องลายเซ็นต้องเท่า layout เดิม (3 ช่อง) — ทะเบียนเปลี่ยนได้เฉพาะข้อความ
      const sigCols = [
        { role: 'ผู้ผลิต (Operator)', name: s.opened_by_name || '' },
        { role: 'หัวหน้างาน (Supervisor)', name: s.closed_by_name || s.close_requested_by_name || '' },
        { role: 'QA / ผู้ตรวจสอบ', name: '' },
      ].map((c, i) => ({ ...c, role: df.sig_blocks?.[i] ?? c.role }));
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
      // ทะเบียนยังไม่ตั้งเลขฟอร์ม = ไม่มีแถบนี้ (หน้าตาเดิมเป๊ะ)
      if (dfCode) doc.text(dfCode, PAGE_W - MARGIN, 290, { align: 'right' });
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
          {/* minWidth:0 บังคับให้ flex item ยอมหด — ไม่งั้นกว้างตาม option ที่ยาวที่สุด (ชื่อไลน์ยาว) แล้วดันล้นจอ */}
          <div style={{ minWidth: 0, flex: '1 1 160px' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>ไลน์</div>
            <LineSelect lines={allLines.filter(l => lineNames.includes(l.name))} value={filter.line_name}
              placeholder="ทุกไลน์" style={{ ...sel, width: '100%', minWidth: 0 }}
              onChange={v => setFilter(f => ({ ...f, line_name: v }))} />
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
          { key: 'process',   label: '🏭 กระบวนการ' },
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
      {subTab === 'process'  && <ProcessTypeSetup role={role} />}
    </div>
  );
}

/* ── Defect Type Setup ── */
/* ── จัดการ master กระบวนการ (process types — data-driven, คำสั่ง user 2026-07-23) ──
   key ผูกกับค่าที่ tag ไว้ใน machines/dr_products/ประเภท DT-งานเสีย/นโยบายพัก — สร้างแล้วห้ามแก้ key
   เพิ่มกระบวนการใหม่ (เช่น Laser, Bending) → ไป tag เครื่อง/สินค้า → dropdown ทุกจุดเห็นเอง */
// ProcessTypeSetup ย้ายไป src/components/ProcessTypeSetup.jsx (ใช้ร่วม Daily Report ⚙️ + /process-setup)

function DefectTypeSetup({ role }) {
  const canEdit = can('daily_report', 'setup', role);
  const [items, setItems]     = useState([]);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving]   = useState(false);
  const emptyForm = { name_th: '', color: '#ef4444', process_type: '', sort_order: 0, is_active: true, excl_from_q: false };
  const [form, setForm]       = useState(emptyForm);

  const load = useCallback(async () => {
    const { data } = await supabaseDR.from('dr_defect_types').select('*').order('sort_order');
    setItems(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openEdit = (item = null) => {
    setEditing(item?.id || 'new');
    setForm(item
      ? { name_th: item.name_th, color: item.color, process_type: item.process_type || '', sort_order: item.sort_order, is_active: item.is_active, excl_from_q: item.excl_from_q === true }
      // สร้างใหม่ default สีที่ยังไม่ซ้ำกับประเภทที่มี (ผู้ใช้เปลี่ยนทับได้)
      : { ...emptyForm, color: pickUnusedColor(items.map(i => i.color)), sort_order: items.length + 1 });
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
        ...activeProcessTypes().map(pt => ({ key: pt.key, label: `${pt.icon || ''} ${pt.label}`.trim(), color: pt.color || '#6b7280' })),
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
                    {item.excl_from_q && <div style={{ fontSize: 10.5, color: '#a855f7', fontWeight: 700 }}>🧪 งานทดลอง — ไม่นับเข้า %Q</div>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>#{item.sort_order}</div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => openEdit(item)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>
                      <button className="tbtn" onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 15 }}>✕</button>
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
                  {activeProcessTypes().map(pt => <option key={pt.key} value={pt.key}>{`${pt.icon || ''} ${pt.label}`.trim()}</option>)}
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
              {/* งานทดลอง — ของเสียจากลองแม่พิมพ์/ลองงานใหม่ ไม่ควรฉุด OEE ของไลน์ (2026-08-17) */}
              <div style={{ padding: '9px 11px', borderRadius: 8, border: `1px solid ${form.excl_from_q ? '#a855f7' : 'var(--border)'}`,
                background: form.excl_from_q ? 'rgba(168,85,247,0.10)' : 'var(--bg2)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.excl_from_q} onChange={e => setForm(f => ({ ...f, excl_from_q: e.target.checked }))} style={{ width: 'auto', margin: 0 }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: form.excl_from_q ? '#a855f7' : 'var(--text)' }}>🧪 งานทดลอง — ไม่นับเข้า %Q</span>
                </label>
                <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4, lineHeight: 1.6 }}>
                  ติ๊กแล้ว ของเสียประเภทนี้จะไม่ถูกนับใน %Q ของ OEE ทุกจอ แต่ยังนับใน "มูลค่าของเสียทั้งหมด"
                  <br />ประเภททั่วไปไม่ต้องติ๊ก — พนักงานติ๊ก 🧪 รายครั้งในฟอร์มบันทึกงานเสียได้อยู่แล้ว
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
  const PROC_LABEL = new Proxy({}, { get: (_, k) => procDisplay(k) }); // data-driven — master กระบวนการ

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
                <button className="tbtn" onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 15 }}>✕</button>
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
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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
                  {activeProcessTypes().map(pt => <option key={pt.key} value={pt.key}>{`${pt.icon || ''} ${pt.label} เท่านั้น`.trim()}</option>)}
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
                      background: `${procColor(item.process_type, '#22c55e')}26`,
                      color: procColor(item.process_type, '#22c55e') }}>
                      {procDisplay(item.process_type)}
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
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Customer"><input value={form.customer} onChange={e => setForm(f => ({ ...f, customer: e.target.value }))} placeholder="เช่น FORD" style={inputStyle} /></Field>
                <Field label="รหัสสินค้า (Code)"><input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="เช่น HDF-001" style={inputStyle} /></Field>
              </div>
              <Field label="ประเภทกระบวนการ *">
                <select value={form.process_type} onChange={e => setForm(f => ({ ...f, process_type: e.target.value }))} style={inputStyle}>
                  {activeProcessTypes().map(pt => <option key={pt.key} value={pt.key}>{`${pt.icon || ''} ${pt.label}`.trim()}</option>)}
                </select>
              </Field>
              <Field label="ไลน์ผลิตหลัก">
                <LineSelect lines={lines} value={form.line_name} placeholder="ไม่ระบุ" style={inputStyle}
                  onChange={v => setForm(f => ({ ...f, line_name: v }))} />
              </Field>
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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
  const [form, setForm]     = useState({ name_th: '', name_en: '', category: 'unplanned', process_type: 'welding_assembly', color: '#ef4444', sort_order: 0, is_active: true, six_big_loss: '', waste_type: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabaseDR.from('dr_downtime_types').select('*').order('category').order('sort_order');
    setItems(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = (item = null) => {
    setEditing(item?.id || 'new');
    setForm(item
      ? { name_th: item.name_th, name_en: item.name_en || '', category: item.category, process_type: item.process_type || 'welding_assembly', color: item.color, sort_order: item.sort_order, is_active: item.is_active, six_big_loss: item.six_big_loss || '', waste_type: item.waste_type || '' }
      // สร้างใหม่ default สีที่ยังไม่ซ้ำกับประเภทที่มี (ผู้ใช้เปลี่ยนทับได้)
      : { name_th: '', name_en: '', category: 'unplanned', process_type: 'welding_assembly', color: pickUnusedColor(items.map(i => i.color)), sort_order: items.length + 1, is_active: true, six_big_loss: '', waste_type: '' });
  };

  const handleSave = async () => {
    if (!form.name_th) { toast.error('กรอกชื่อประเภท'); return; }
    setSaving(true);
    // ค่าว่าง = ยังไม่จัดหมวด Lean → เก็บเป็น null (ห้ามเก็บ '' — จะกลายเป็นถังใหม่ในหน้าวิเคราะห์)
    const payload = { ...form, six_big_loss: form.six_big_loss || null, waste_type: form.waste_type || null };
    const { error } = editing === 'new'
      ? await supabaseDR.from('dr_downtime_types').insert(payload)
      : await supabaseDR.from('dr_downtime_types').update(payload).eq('id', editing);
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
    ...activeProcessTypes().map(pt => ({ key: pt.key, label: `${pt.icon || ''} ${pt.label}`.trim(), color: pt.color || '#6b7280' })),
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
                  {activeProcessTypes().map(pt => <option key={pt.key} value={pt.key}>{`${pt.icon || ''} ${pt.label}`.trim()}</option>)}
                  <option value="common">🔗 Common (ทุกกระบวนการ)</option>
                </select>
              </Field>
              <Field label="หมวดหมู่ (ใช้คิด OEE)">
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={inputStyle}>
                  <option value="unplanned">⚠ นอกแผน (Unplanned)</option>
                  <option value="planned">📋 ในแผน (Planned)</option>
                </select>
              </Field>
              {/* แกน Lean — แยกจาก category ที่ใช้คิด OEE โดยตั้งใจ (ดู src/utils/oee.js §6)
                  ตอบคนละคำถาม: "เวลาที่เสียไปเป็นความสูญเปล่าประเภทไหน แก้ด้วยเครื่องมืออะไร" */}
              <Field label="6 Big Losses (TPM) — สำหรับวิเคราะห์ ไม่กระทบ OEE">
                <select value={form.six_big_loss} onChange={e => setForm(f => ({ ...f, six_big_loss: e.target.value }))} style={inputStyle}>
                  <option value="">— ยังไม่จัดหมวด —</option>
                  {SIX_BIG_LOSSES.map(l => <option key={l.key} value={l.key}>{l.icon} {l.label} (กระทบ {l.oee})</option>)}
                </select>
              </Field>
              <Field label="8 Wastes (Lean) — สำหรับวิเคราะห์ ไม่กระทบ OEE">
                <select value={form.waste_type} onChange={e => setForm(f => ({ ...f, waste_type: e.target.value }))} style={inputStyle}>
                  <option value="">— ยังไม่จัดหมวด —</option>
                  {EIGHT_WASTES.map(w => <option key={w.key} value={w.key}>{w.icon} {w.label}</option>)}
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
