import { useState, useEffect, useContext, useMemo, useRef } from 'react';
import { LPA_LAYERS } from '../utils/prodRoutine';
import { canWriteLine, writeBlockText } from '../utils/writeScope';
/* 🔴 ด่านชั้น 2 ของ stale-response race — กฎ+ข้อความอยู่ใน utils/staleView.js (pure · มีเทส) */
import { viewKey, isStale, staleBlockText } from '../utils/staleView';
import useIsMobile from '../utils/useIsMobile';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { can, canDelete as canDeleteUtil } from '../utils/permissions';
import { toast } from '../components/Toast';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import LineSelect from '../components/LineSelect';
import PersonSelect from '../components/PersonSelect';
import useColumnHistory from '../utils/useColumnHistory';
import SelectOrFree from '../components/SelectOrFree';
import { loadLinesRes } from '../utils/useProductionLines';
import { loadCompanyCalendar } from '../utils/companyCalendar';
import tsLogoUrl from '../assets/TS logo.png';
import { getDocForm, docFormSync, loadDocForms, fullCode } from '../utils/docForms';
import useTabParam from '../utils/useTabParam';
import { notifyEvent } from '../utils/notifyEvent';
import { uploadOpts } from '../utils/storageUpload';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import FilterBar from '../components/FilterBar';
import Segmented from '../components/Segmented';
import { ALL } from '../utils/filterLabels';
import { DeleteButton } from '../components/IconButton';
/* 🔴 ห้ามถอด — ด่านก่อนลบข้อในทะเบียน + ตัวกู้ข้อที่ถูกถอดออกจากเช็คลิสต์ให้ใบย้อนหลัง
   (เคส 12/10: ลบข้อ common 2 ข้อ = หายจากใบตรวจทุกไลน์ · ดู src/utils/lpaQuestionRefs.js) */
import { loadLpaQuestionRefs, lpaQuestionBlockMessage, lpaDeleteConfirmText, savedOnlyAnswers } from '../utils/lpaQuestionRefs';
/* 🔴 ช่องว่างในตารางตรวจรายวันต้องแยกได้ว่า "ไม่ได้ตรวจ / ไม่ได้ผลิต / ไม่มีแผนตรวจ" (13/10 · คำสั่ง user) */
import { checkDayState, CHECK_DAY_META, CHECK_DAY_LEGEND, summarizeCheckDays, checkDaysNote } from '../utils/dailyCheckDay';
import { loadRunDays, ranOn } from '../utils/runDays';
import { useDraftAutosave, loadDraft, clearDraft } from '../utils/formDraft';   // 📝 ร่างในเครื่อง (มือถือ · 22/10)
import DraftRestoreBar from '../components/DraftRestoreBar';

/* ══════════════════════════════════════════════════════════════
   📋 Layer Process Audit (LPA) — paperless แทนฟอร์มกระดาษ 2 ใบ:
   1) Layer Process Audit Plan   — แผนตรวจรายเดือน ต่อไลน์+กะ (สถานีรายวัน + ชั้นผู้ตรวจ ○●⊗)
   2) Layer Process Audit Report — FM-QMR-008 Rev.01 (checklist Y/N/T/NA รายวัน + W1-4/Monthly/Quarterly)
   ชั้นผู้ตรวจ: Leader ทุกวัน · Supervisor/Engineer รายสัปดาห์ · Manager รายเดือน · GM รายไตรมาส
   ตาราง: lpa_questions / lpa_plans / lpa_plan_days / lpa_audits / lpa_audit_answers (Main)
   migration: 20260720_layer_process_audit.sql
   ══════════════════════════════════════════════════════════════ */

const FORM_NO = 'FM-QMR-008 Rev.01';
const EFFECTIVE = '12/05/2017';

// ชั้นผู้ตรวจ — ที่เดียวทั้งระบบ (จอ TV ฝ่ายผลิตอ่านชุดเดียวกันเพื่อนับ "แผนวันนี้ยังไม่ตรวจ" · 12/10)
const LAYERS = LPA_LAYERS;
const CATEGORIES = [
  { key: 'safety', label: 'Safety & 5ส.', full: 'Safety & 5S Related (ความปลอดภัยและเกี่ยวกับ 5ส.)' },
  { key: 'quality', label: 'Product & Quality', full: 'Product & Quality (เกี่ยวข้องกับการผลิต & ตรวจสอบคุณภาพ)' },
  { key: 'systemic', label: 'Systemic', full: 'Systemic (ระเบียบ/ข้อกำหนด)' },
  { key: 'visual', label: 'Visual Check', full: 'Visual Check' },
  { key: 'special', label: 'เฝ้าระวังปัญหา', full: 'Internal & Customer Problem (ปัญหาภายในและลูกค้า)' },
];
const ANSWERS = [
  { key: 'Y', label: 'Y', color: '#22c55e', desc: 'ปฏิบัติตรงตามมาตรฐาน (YES)' },
  { key: 'N', label: 'N', color: '#ef4444', desc: 'ปฏิบัติไม่ตรงตามมาตรฐาน (NO)' },
  { key: 'T', label: 'T', color: '#f59e0b', desc: 'ยอมรับให้ปฏิบัติต่อได้แบบมีเงื่อนไข (Temporary Accept)' },
  { key: 'NA', label: 'N/A', color: '#94a3b8', desc: 'ไม่เกี่ยวข้อง' },
];
const ansMeta = (k) => ANSWERS.find(a => a.key === k);

const SHIFT_META = { day: 'กะเช้า (Shift 01)', night: 'กะดึก (Shift 02)' };

/* ── date helpers (กฎ work date ตัด 08:00 — ห้าม toISOString) ── */
const pad2 = (n) => String(n).padStart(2, '0');
const localDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const getWorkDate = () => { const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1); return localDateStr(d); };
const getCurrentShift = () => { const h = new Date().getHours(); return h >= 8 && h < 20 ? 'day' : 'night'; };
const thDate = (dstr) => { if (!dstr) return ''; const [y, m, d] = dstr.split('-').map(Number); return `${d}/${m}/${y + 543}`; };
const monthLabel = (mk) => { const [y, m] = mk.split('-').map(Number); const en = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return `${en[m - 1]}-${String(y).slice(2)}`; };
// ไตรมาสของเดือน (Q1 ม.ค-มี.ค / Q2 เม.ย-มิ.ย / Q3 ก.ค-ก.ย / Q4 ต.ค-ธ.ค) + 3 เดือนของไตรมาสนั้น
const quarterOf = (mk) => Math.floor((Number(mk.split('-')[1]) - 1) / 3) + 1;
const quarterMonths = (mk) => { const [y, m] = mk.split('-').map(Number); const qs = Math.floor((m - 1) / 3) * 3 + 1; return [0, 1, 2].map(i => `${y}-${pad2(qs + i)}`); };
const shiftMonth = (mk, delta) => { const [y, m] = mk.split('-').map(Number); const d = new Date(y, m - 1 + delta, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
const daysInMonth = (mk) => { const [y, m] = mk.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const dateOf = (mk, day) => `${mk}-${pad2(day)}`;
const dowOf = (dstr) => { const [y, m, d] = dstr.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
const DOW_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const weekOfDay = (day) => Math.min(4, Math.ceil(day / 7)); // 1-7 W1 · 8-14 W2 · 15-21 W3 · 22+ W4

async function urlToDataUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
  } catch { return null; }
}

/* ── แผ่นเซ็นชื่อ (canvas → PNG) — pattern เดียวกับ OjtTraining ── */
function SignPadModal({ title, onCancel, onDone }) {
  const cvRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const dirty = useRef(false);
  useEffect(() => { const c = cvRef.current; if (c) { const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); } }, []);
  const pos = (e) => { const c = cvRef.current, r = c.getBoundingClientRect(), t = e.touches?.[0] || e; return { x: (t.clientX - r.left) * (c.width / r.width), y: (t.clientY - r.top) * (c.height / r.height) }; };
  const down = (e) => { e.preventDefault(); drawing.current = true; last.current = pos(e); };
  const move = (e) => { if (!drawing.current) return; e.preventDefault(); const c = cvRef.current, ctx = c.getContext('2d'), p = pos(e); ctx.strokeStyle = '#111'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last.current = p; dirty.current = true; };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = cvRef.current, ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); dirty.current = false; };
  const done = () => { if (!dirty.current) { toast.error('ยังไม่ได้เซ็น'); return; } cvRef.current.toBlob(b => b && onDone(b), 'image/png'); };
  return (
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 3200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, width: 'min(96vw, 620px)' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 10 }}>✍️ {title}</div>
        <canvas ref={cvRef} width={560} height={180} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
          style={{ width: '100%', height: 160, border: '1px dashed var(--border2)', borderRadius: 10, background: '#fff', touchAction: 'none', cursor: 'crosshair', display: 'block' }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={clear} style={btnGray}>🗑️ ล้าง</button>
          <button onClick={onCancel} style={btnGray}>ยกเลิก</button>
          <button onClick={done} style={btnAccent}>✔ ใช้ลายเซ็นนี้</button>
        </div>
      </div>
    </div>
  );
}

/** ภาพรวมคำตอบ+สถานีของใบ LPA เป็นสตริง — เทียบว่า "แก้แล้วยังไม่บันทึก" ไหม (ร่างในเครื่อง) */
const lpaSnap = (answers, station) => JSON.stringify([
  Object.entries(answers || {}).filter(([, v]) => v?.answer || v?.note).map(([k, v]) => [k, v.answer || '', v.note || '']).sort(),
  station || '',
]);

export default function LayerProcessAudit() {
  const { role, lineId: userLineId, sections: scopeSecs = [], fullName,
          section: homeSection, allUnits, respCostCenters, scopeIdx } = useContext(UserContext);
  /* 🔐 ทะเบียนคำถาม LPA — ข้อที่ `line_name` ว่าง = **ข้อกลางใช้ทุกไลน์ทั้งโรงงาน**
     ⇒ แก้/ปิด/ลบ ต้องมีใบผ่าน `scope:all_units` (audit 15/10) · ข้อของไลน์ = ตามส่วนงานไลน์นั้น
     เดิมมุมมอง "🌐 ทะเบียนกลาง" ให้ใครก็ได้ที่ถือ lpa:manage ลบข้อกลางทิ้งได้ = หายจากใบตรวจทุกไลน์ */
  const qCtx = { role, section: homeSection, sections: scopeSecs, allUnits, respCostCenters, scopeIdx };
  const qWrite = (q) => canWriteLine(qCtx, q?.line_name, lines, { unknownTarget: 'block' });
  /* 🔐 ชั้นที่ 3 ของ "ใบตรวจ + แผนเดือน/ไตรมาส" — เดิมมีด่านเฉพาะทะเบียนคำถาม (audit 20/10)
     ⇒ ใบตรวจ/แผนของไลน์ส่วนงานอื่น เปิด `?line=` แล้วบันทึกทับได้ (เอกสาร ISO ของหน่วยงานเขา)
     · วัดจากข้อมูลจริง 843 ใบ: ทุกใบคนเขียนอยู่ส่วนงานเดียวกับไลน์ (หรือถือใบผ่านข้ามหน่วย)
       ⇒ ด่านนี้ไม่กระทบงานที่ทำกันอยู่จริงเลย · ไลน์ไม่รู้ส่วนงาน = ไม่บล็อก (ตัดสินไม่ได้) */
  const qGuard = (q, what) => {
    const w = qWrite(q);
    if (w.ok) return true;
    toast.error(q?.line_name ? writeBlockText(w, { what }) 
      : 'ข้อนี้เป็น "ข้อกลาง" ใช้ทุกไลน์ทั้งโรงงาน — แก้/ลบได้เฉพาะผู้ที่มีสิทธิ์ข้ามหน่วยงาน (ขอจากแอดมิน)');
    return false;
  };
  const canRecord = can('lpa', 'record', role);
  const canManage = can('lpa', 'manage', role);
  const isMobile = useIsMobile();   // 📱 ปุ่มตอบใหญ่เต็มแถว + ปุ่มบันทึกเกาะล่าง (15/10 · MOBILE-UX-STANDARD §4 ชนิด A)
  /* 🖥️🔴 ต้องผ่าน `canDelete()` ของกลาง (utils/permissions.js) — เดิมประกาศตัวแปรชื่อ `canDelete`
     ทับ util แล้วเรียกแค่ `can(...)` ⇒ อ่านโค้ดเหมือนมีด่าน แต่ **ด่าน "บัญชีกลางห้ามลบ" ไม่ทำงาน**
     (ออดิท 13/10 เจอแบบนี้ 5 หน้า) · เปลี่ยนชื่อตัวแปรเป็น `mayDelete` + เรียก util ผ่าน alias
     ⚠️ ห้ามตั้งชื่อตัวแปรท้องถิ่นว่า `canDelete` อีก — มีด่าน `no-shadow-candelete` */
  const mayDelete = canDeleteUtil('lpa', 'manage', role);
  // 📜 ชื่อที่เคยบันทึกไว้ (Main lpa_*) — ผู้ตรวจ/4 ชั้นที่ไม่มีใน profiles (ย้ายจากกระดาษ) ยังเลือกซ้ำได้ (2026-09-07)
  const auditorHist = useColumnHistory(supabase, 'lpa_audits', 'auditor_name');
  const layerHist = {
    leader_name: useColumnHistory(supabase, 'lpa_plans', 'leader_name'),
    supervisor_name: useColumnHistory(supabase, 'lpa_plans', 'supervisor_name'),
    manager_name: useColumnHistory(supabase, 'lpa_plans', 'manager_name'),
    gm_name: useColumnHistory(supabase, 'lpa_plans', 'gm_name'),
  };

  // ⚠️ param `sub` ไม่ใช่ `tab` — หน้านี้ถูกฝังในแท็บ LPA ของ /daily-checker ซึ่งจอง ?tab= ไปแล้ว
  const [tabRaw, setTab] = useTabParam(['audit', 'plan', 'report', 'questions'], 'audit', 'sub');
  const tab = tabRaw === 'questions' && !canManage ? 'audit' : tabRaw;   // ลิงก์เข้าแท็บที่ไม่มีสิทธิ์ = ตกกลับแท็บแรก
  const [lines, setLines] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [myProfile, setMyProfile] = useState(null);
  const [calReady, setCalReady] = useState(false);

  const [selLine, setSelLine] = useState('');
  const lineWrite = canWriteLine(qCtx, selLine, lines);
  const lineGuard = (what) => {
    if (lineWrite.ok) return true;
    toast.error(writeBlockText(lineWrite, { what }));
    return false;
  };
  const [selShift, setSelShift] = useState(getCurrentShift());
  const [selMonth, setSelMonth] = useState(getWorkDate().slice(0, 7));

  /* plan */
  const [plan, setPlan] = useState(null);           // แถว lpa_plans ของ (line, shift, month)
  const [planDays, setPlanDays] = useState({});     // { day: {station, plan_leader, ...} }
  /* วันที่ไลน์นี้ "เปิดกะจริง" ในเดือนที่ดูอยู่ — `null` = อ่านไม่สำเร็จ (⇒ ช่องเป็น ❔ ห้ามเดาว่าไม่ผลิต) */
  const [runs, setRuns] = useState(null);
  const [monthAudits, setMonthAudits] = useState([]); // audits+answers ของเดือนที่เลือก
  /* 🔴 อ่านใบ/แผนของเดือนไม่สำเร็จ = ตารางต้องเป็น "ไม่รู้" ทั้งเดือน **ห้ามบีบเป็น "ขาดตรวจ"** */
  const [monthErr, setMonthErr] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);
  /* แท็บแผน = มองทีละไตรมาส (3 เดือน) — คำสั่ง user 2026-07-20 */
  const [qData, setQData] = useState({});   // { 'YYYY-MM': { plan: row|null, days: {day: pd} } }
  const [qAudits, setQAudits] = useState([]); // audits ทั้งไตรมาส (ใช้ทำสถานะ ● ตรวจแล้ว)
  /* 🔴 อ่านใบ/แผนไตรมาสไม่สำเร็จ = ห้ามทำเป็น "⊗ เลยกำหนด ยังไม่ตรวจ" (ใบนี้พิมพ์ไปเซ็น FM-QMR-008) */
  const [qErr, setQErr] = useState('');
  const [qHeader, setQHeader] = useState({ leader_name: '', supervisor_name: '', manager_name: '', gm_name: '', stations: '' });

  /* audit record */
  const [auditDate, setAuditDate] = useState(getWorkDate());
  const [auditLayer, setAuditLayer] = useState(role === 'manager' ? 'manager' : role === 'supervisor' ? 'supervisor' : role === 'engineer' || role === 'qa' ? 'supervisor' : 'leader');
  const [draft, setDraft] = useState(null);          // { id?, station, auditor_name, auditor_sig_url, answers: {qid:{answer,note}} }
  /* 🔴 อ่านใบเดิมไม่สำเร็จ = **ห้ามเดาว่า "ยังไม่มีใบ"** (ดูในเอฟเฟกต์โหลดใบ) — เก็บเหตุผลไว้เขียนบนจอ */
  const [draftErr, setDraftErr] = useState('');
  /* 📝 ร่างในเครื่อง (มือถือ · 22/10 · audit handheld ข้อ 4) — ใบตรวจบันทึกทีเดียวตอนท้าย ⇒ เน็ตหลุด/รีโหลด/
     เตะออกหมดกะ/สลับไลน์-กะ-วัน-ชั้น = คำตอบที่ติ๊กไว้หายทั้งใบ · เก็บร่างต่อชุด line|shift|date|layer|คนกรอก
     แล้วถามกู้คืนตอนเปิดชุดเดิม (utils/formDraft.js) · `loadedSnapRef` = คำตอบที่โหลดจากฐาน (ไว้ดูว่า "แก้แล้วยังไม่บันทึก" ไหม) */
  const loadedSnapRef = useRef('');
  const [pendingDraft, setPendingDraft] = useState(null);
  const [auditPlanStations, setAuditPlanStations] = useState([]); // สถานีในแผนเดือนที่ตรวจ — ตัวเลือกช่อง "Station ที่ตรวจ"
  const [wsNames, setWsNames] = useState([]);        // จุดงาน (workstations) ของครอบครัวไลน์ที่เลือก — ตัวเลือกสถานี (2026-09-07)
  const [savingAudit, setSavingAudit] = useState(false);
  const [showSignPad, setShowSignPad] = useState(false);

  /* ══ 🔴 กันคำตอบของคิวรีเก่ามาทับจอ — stale-response race (QC audit ข้อ ④ · 2026-10-19) ══════
     คิวรีที่ยิงไปแล้ว **ยกเลิกไม่ได้** ⇒ ต้อง "ทิ้งคำตอบที่มาช้า" ทีหลัง ไม่ใช่หวังว่ามันจะมาตามลำดับ
     (กฎเหล็กการเขียน DB ข้อ 4 · ของเดิมใน `fetchStationNames` ทำถูกอยู่แล้ว — ที่เหลือไม่มีด่าน)

     🔴 ทำไมหน้านี้ร้ายกว่าจออื่น: คำถาม `common` (`line_name = null`) **ใช้ `question_id` ร่วมกันทุกไลน์**
        ⇒ ใบร่างของไลน์ A ที่มาช้าทับจอที่กำลังเลือกไลน์ B แล้วกดบันทึก = **คำตอบของไลน์ A ไปลงเป็นของไลน์ B
        แบบไม่มี error** (ส่วนข้อเฉพาะไลน์จะชน PK แล้วเด้ง error งงๆ) · LPA เป็นบันทึก audit ตามระบบคุณภาพ
        ⇒ เขียนผิดใบ = แก้ไม่ได้ และคนตรวจไม่รู้ตัว
     🔴 อีกอาการที่เงียบกว่า: ใบร่างที่มาช้า **ทับคำตอบที่คนกำลังติ๊กอยู่** (กดไปแล้ว 10 ข้อ หายหมด)

     กันเป็น 2 ชั้น (ชั้นเดียวไม่พอ — ชั้นแรกกันไม่ให้เพี้ยน ชั้นสองกันไม่ให้ "เพี้ยนแล้วเขียนลง DB"):
       ① ทุกจุดที่ `setState` หลัง `await` เทียบ "คีย์ที่ยิงไป" กับ "คีย์ที่จออยู่ตอนนี้" — ไม่ตรง = ทิ้ง
       ② `draft` พก `key` ของตัวเองมาด้วย · `saveAudit`/`deleteAudit` **ปฏิเสธถ้าคีย์ไม่ตรงจอ** (fail-closed) */
  const monthKey = viewKey(selLine, selShift, selMonth);
  const draftKey = viewKey(selLine, selShift, auditDate, auditLayer);
  const monthKeyRef = useRef(monthKey);
  const draftKeyRef = useRef(draftKey);
  /* คีย์ของ "ข้อมูลที่โหลดมาแล้วและกำลังแก้อยู่" — แผนเดือน (`plan`/`planDays`) และแผนไตรมาส (`qData`)
     ก็ผสม "id ที่โหลดมา" กับ "ไลน์ที่เลือกอยู่" เวลา upsert เหมือนใบตรวจ ⇒ ต้องมีด่านชั้น 2 เหมือนกัน */
  const [monthLoadedKey, setMonthLoadedKey] = useState('');
  const [qLoadedKey, setQLoadedKey] = useState('');
  monthKeyRef.current = monthKey;   // เขียนทุก render โดยตั้งใจ = "คีย์ที่จอกำลังแสดงอยู่ตอนนี้"
  draftKeyRef.current = draftKey;

  /* questions master */
  const [qEditing, setQEditing] = useState(null);
  const [qScope, setQScope] = useState(''); // หน้า ⚙️ คำถาม: '' = ทะเบียนกลาง (common) · ชื่อไลน์ = จัดการเฉพาะไลน์นั้น
  /* 🔴 เปิดแท็บ ⚙️ มา ต้องลงที่ "ไลน์ของตัวเอง" ก่อนเสมอ ไม่ใช่ทะเบียนกลาง (2026-10-12 · คำสั่ง user)
     เคสจริง 02/10: คนตั้งใจเอาข้อออกจากไลน์ตัวเอง แต่จอเปิดมาที่ทะเบียนกลาง เลยกดลบของส่วนรวมทิ้ง
     `qScopePicked` = เคยเลือกเองหรือยัง — เลือกแล้วห้าม auto เปลี่ยนทับ (รวมถึงตอนเลือก "ทะเบียนกลาง" เอง) */
  const [qScopePicked, setQScopePicked] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [docReady, setDocReady] = useState(false); // ทะเบียนเอกสารโหลดแล้ว → subtitle/ปุ่มดึงเลขฟอร์มจาก registry

  /* ── scope มาตรฐาน: leader → family ไลน์ตัวเอง · role อื่นตาม sections ── */
  const visibleLines = useMemo(() => {
    let arr = lines;
    if (role === 'leader' && userLineId) {
      const fam = getLineFamilyNames(lines, Number(userLineId) || userLineId);
      arr = lines.filter(l => fam.includes(l.name));
    } else if (scopeSecs.length) {
      arr = lines.filter(l => inSectionScope(scopeSecs, l.section));
    }
    return [...arr].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [lines, role, userLineId, scopeSecs]);

  useEffect(() => {
    (async () => {
      const [{ data: ln }, { data: qs }, { data: profs }, { data: { user } }] = await Promise.all([
        loadLinesRes(),   // ครบ is_active ให้ <LineSelect> (2026-09-07)
        supabase.from('lpa_questions').select('*').order('seq'),
        supabase.from('profiles').select('id, full_name, signature_url').order('full_name'),
        supabase.auth.getUser(),
      ]);
      setLines(ln || []);
      setQuestions(qs || []);
      setProfiles(profs || []);
      setMyProfile((profs || []).find(p => p.id === user?.id) || null);
      calMapRef.current = await loadCompanyCalendar();
      setCalReady(true);
      await loadDocForms();
      setDocReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!selLine && visibleLines.length) setSelLine(visibleLines[0].name);
  }, [visibleLines, selLine]);

  // วันหยุด (ตรรกะเดียวกับ countWorkingDays ฝั่ง kanban): มาร์คในปฏิทิน → day_type != working
  // ไม่มาร์ค → เสาร์/อาทิตย์ = หยุด, จ-ศ = ทำงาน (เสาร์/อาทิตย์ที่มาร์ค working = วันทำงาน)
  const calMapRef = useRef(null);
  const isHoliday = (dstr) => {
    const t = calMapRef.current?.get(dstr);
    if (t) return t !== 'working';
    const dow = dowOf(dstr);
    return dow === 0 || dow === 6;
  };

  /* ── ดึงรายชื่อ "จุดงาน (workstations)" ของไลน์ (รวมไลน์ย่อยในครอบครัว) ──
     LPA = audit กระบวนการ/คนที่จุดงาน ไม่ใช่ตรวจทุกเครื่องจักร → ใช้จุดงานเป็นสถานีตรวจตั้งต้น
     (คำสั่ง user 2026-07-20) · workstations อยู่ Main project · user แก้เพิ่ม/ลบเองได้ */
  // จุดหัวหน้างาน (Leader/Supervisor) = คนตรวจ ไม่ใช่จุดที่ถูก audit → ตัดออกจากสถานีตรวจ (คำสั่ง user 2026-07-20)
  const isLeaderStation = (nm) => /leader|หัวหน้า|supervisor|\bsv\b|\bspv\b|foreman|หน\.กลุ่ม|หน\.ไลน์/i.test(nm);
  const fetchStationNames = async () => {
    const lineObj = lines.find(l => l.name === selLine);
    const famNames = lineObj ? getLineFamilyNames(lines, lineObj.id) : [];
    const names = famNames.length ? famNames : [selLine];
    const { data, error } = await supabase.from('workstations')
      .select('station_name, line_name').in('line_name', names).order('id');
    if (error) return { list: [], error };
    const list = []; const seen = new Set();
    (data || []).forEach(w => {
      const nm = (w.station_name || '').trim();
      if (nm && !seen.has(nm) && !isLeaderStation(nm)) { seen.add(nm); list.push(nm); }
    });
    return { list };
  };
  // โหลดจุดงานของไลน์ที่เลือกไว้เป็นตัวเลือกสถานี (แผนรายวัน + ผลตรวจ) — set state หลัง await เท่านั้น + guard เปลี่ยนไลน์ระหว่างรอ
  useEffect(() => {
    let alive = true;
    const p = (!selLine || !lines.length) ? Promise.resolve({ list: [] }) : fetchStationNames();
    p.then(({ list }) => { if (alive) setWsNames(list || []); });
    return () => { alive = false; };
  }, [selLine, lines]); // eslint-disable-line react-hooks/exhaustive-deps
  const fillStationsFromWorkstations = async () => {
    if (!lineGuard('แผนตรวจ LPA ของไลน์นี้')) return;
    const key = monthKeyRef.current;
    const { list, error } = await fetchStationNames();
    if (monthKeyRef.current !== key) return;   // เปลี่ยนไลน์ระหว่างรอ = จุดงานของไลน์เก่า ห้ามเททับหัวแผนใหม่
    if (error) { toast.error('ดึงจุดงานไม่สำเร็จ: ' + error.message); return; }
    if (!list.length) { toast.info('ไลน์นี้ยังไม่มีจุดงานในผัง — ตั้งจุดงานที่หน้า Line Setup ก่อน'); return; }
    setQHeader(prev => ({ ...prev, stations: list.join('\n') }));
    toast.success(`ดึง ${list.length} จุดงานมาเป็นสถานีตรวจแล้ว — แก้ไข/เพิ่มเองได้`);
  };

  /* ── โหลดแผน + ผลตรวจของเดือน เมื่อเปลี่ยน line/shift/month ── */
  const loadMonth = async () => {
    if (!selLine) return;
    const key = monthKey;   // คีย์ที่ "คิวรีชุดนี้" ถามไป — เทียบกับจอตอนคำตอบกลับมา
    const first = dateOf(selMonth, 1);
    const last = dateOf(selMonth, daysInMonth(selMonth));
    const [plRes, audRes, runRes] = await Promise.all([
      supabase.from('lpa_plans').select('*, lpa_plan_days(*)').eq('line_name', selLine).eq('shift', selShift).eq('month_key', selMonth).maybeSingle(),
      supabase.from('lpa_audits').select('*, lpa_audit_answers(*)').eq('line_name', selLine).eq('shift', selShift).gte('audit_date', first).lte('audit_date', last).order('audit_date'),
      // ตารางกะอยู่ **คนละ project (DR)** — ล้มแล้วต้องเป็น "ไม่รู้" ไม่ใช่ "ไม่ได้ผลิต"
      loadRunDays({ lineNames: [selLine], from: first, to: last }),
    ]);
    if (monthKeyRef.current !== key) return;   // 🔴 เปลี่ยนไลน์/กะ/เดือนไปแล้ว = ทิ้งคำตอบชุดนี้
    setMonthLoadedKey(key);
    /* 🔴🔴 ฝั่ง DR (ตารางกะ) ระวังไว้ดีแล้วด้วย `loadRunDays` — แต่**ฝั่ง Main ที่ตอบว่า "ตรวจแล้วหรือยัง"
       เดิมแกะแต่ `{ data }` ทิ้ง error** (QC audit 20/10) ⇒ คิวรีล้มครั้งเดียว = ทั้งเดือนขึ้น "ขาดตรวจ"
       และตัวหาร % คิดจากใบ 0 ใบ = **จอกล่าวหาหน้างานว่าไม่ตรวจ** (ทิศที่อันตรายที่สุดของจอนี้) */
    const { data: pl } = plRes, { data: aud } = audRes;
    setMonthErr(audRes.error ? `โหลดใบตรวจของเดือนไม่สำเร็จ: ${audRes.error.message}`
      : plRes.error ? `โหลดแผนตรวจของเดือนไม่สำเร็จ: ${plRes.error.message}` : '');
    setRuns(runRes);
    setPlan(pl || null);
    const dm = {};
    (pl?.lpa_plan_days || []).forEach(d => { dm[d.day] = d; });
    setPlanDays(dm);
    setMonthAudits(aud || []);
  };
  useEffect(() => { loadMonth(); }, [selLine, selShift, selMonth]);

  // ข้อ common (line_name null) ถูกซ่อนเฉพาะไลน์นี้ไหม (hidden_for_lines[] — ตั้งจากหน้า ⚙️ รายไลน์)
  const hiddenForLine = (q, lineName) => !q.line_name && Array.isArray(q.hidden_for_lines) && q.hidden_for_lines.includes(lineName);
  /* คำถามที่ใช้กับไลน์+วันที่ (common fallback + ข้อเฉพาะไลน์ − ข้อ common ที่ไลน์นี้ซ่อน · special เฉพาะช่วงเฝ้าระวัง) */
  const questionsFor = (lineName, dstr) => questions.filter(q => {
    if (!q.is_active) return false;
    if (q.line_name && q.line_name !== lineName) return false;
    if (hiddenForLine(q, lineName)) return false;
    if (q.category === 'special' && dstr) {
      if (q.issue_start && dstr < q.issue_start) return false;
      if (q.issue_end && dstr > q.issue_end) return false;
    }
    return true;
  });
  // สำหรับรายงานทั้งเดือน: special ที่ช่วงคาบเกี่ยวเดือนนี้
  const questionsForMonth = (lineName, mk) => {
    const first = dateOf(mk, 1), last = dateOf(mk, daysInMonth(mk));
    return questions.filter(q => {
      if (!q.is_active) return false;
      if (q.line_name && q.line_name !== lineName) return false;
      if (hiddenForLine(q, lineName)) return false;
      if (q.category === 'special') {
        if (q.issue_start && last < q.issue_start) return false;
        if (q.issue_end && first > q.issue_end) return false;
      }
      return true;
    });
  };

  const auditFor = (dstr, layer) => monthAudits.find(a => a.audit_date === dstr && a.layer === layer);
  const answerOf = (audit, qid) => audit?.lpa_audit_answers?.find(x => x.question_id === qid);

  /* ═════════ TAB: แผน ═════════ */
  const setPlanDay = (day, patch) => setPlanDays(prev => ({ ...prev, [day]: { ...(prev[day] || { day, station: '', plan_leader: false, plan_supervisor: false, plan_manager: false, plan_gm: false }), ...patch } }));
  const setPlanF = (k, v) => setPlan(prev => ({ ...(prev || { line_name: selLine, shift: selShift, month_key: selMonth }), [k]: v }));

  const autoFillPlan = () => {
    const stationList = (plan?.stations || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (!stationList.length) { toast.error('กรอกรายชื่อสถานีตรวจ (Station) ก่อน — บรรทัดละชื่อ'); return; }
    const nDays = daysInMonth(selMonth);
    const working = [];
    for (let d = 1; d <= nDays; d++) if (!isHoliday(dateOf(selMonth, d))) working.push(d);
    // supervisor = วันทำงานแรกของแต่ละสัปดาห์บล็อก (1-7 / 8-14 / 15-21 / 22+) · manager = วันทำงานที่สองของบล็อก 8-14
    const blocks = [[1, 7], [8, 14], [15, 21], [22, 31]];
    const svDays = blocks.map(([a, b]) => working.find(d => d >= a && d <= b)).filter(Boolean);
    const wk2 = working.filter(d => d >= 8 && d <= 14);
    const mgrDay = wk2[1] || wk2[0] || working[Math.floor(working.length / 2)];
    const next = {};
    let si = 0;
    for (let d = 1; d <= nDays; d++) {
      if (isHoliday(dateOf(selMonth, d))) continue;
      next[d] = {
        day: d, station: stationList[si % stationList.length],
        plan_leader: true, plan_supervisor: svDays.includes(d), plan_manager: d === mgrDay, plan_gm: planDays[d]?.plan_gm || false,
      };
      si++;
    }
    setPlanDays(next);
    toast.success(`เติมแผนอัตโนมัติแล้ว: Leader ${working.length} วัน · SV ${svDays.length} ครั้ง · MGR วันที่ ${mgrDay}`);
  };

  /** 🔴 ชั้นที่ 2 ของแผน — ข้อมูลที่กำลังแก้เป็นของ (ไลน์/กะ/เดือน) ที่เลือกอยู่จริงไหม
   *  ไม่ตรง = **ห้ามเขียน** (เพราะ `row` ผสม `id` ที่โหลดมา กับ `line_name: selLine` ที่เลือกอยู่
   *  ⇒ เขียนทับแผนของไลน์อื่น หรือชน PK แล้วเด้ง error งงๆ) */
  const monthMismatch = (loadedKey) => (isStale(loadedKey, monthKey)
    ? staleBlockText({ what: 'แผนที่แสดงอยู่', unitWord: 'ไลน์/กะ/เดือน' })
    : null);

  const savePlan = async () => {
    if (!canManage) return;
    if (!lineGuard('แผนตรวจ LPA ของไลน์นี้')) return;
    const mis = monthMismatch(monthLoadedKey);
    if (mis) { toast.error(mis); return; }
    setSavingPlan(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const row = {
        ...(plan?.id ? { id: plan.id } : {}),
        line_name: selLine, shift: selShift, month_key: selMonth,
        leader_name: plan?.leader_name || null, supervisor_name: plan?.supervisor_name || null,
        manager_name: plan?.manager_name || null, gm_name: plan?.gm_name || null,
        stations: plan?.stations || null,
        created_by: plan?.created_by || user?.id || null,
        updated_at: new Date().toISOString(),
      };
      const { data: saved, error } = await supabase.from('lpa_plans').upsert(row, { onConflict: 'line_name,shift,month_key' }).select().single();
      if (error) throw error;
      const { error: delErr } = await supabase.from('lpa_plan_days').delete().eq('plan_id', saved.id);
      if (delErr) throw delErr;
      const rows = Object.values(planDays).filter(d => d.station || d.plan_leader || d.plan_supervisor || d.plan_manager || d.plan_gm)
        .map(d => ({ plan_id: saved.id, day: d.day, station: d.station || null, plan_leader: !!d.plan_leader, plan_supervisor: !!d.plan_supervisor, plan_manager: !!d.plan_manager, plan_gm: !!d.plan_gm }));
      if (rows.length) {
        const { error: insErr } = await supabase.from('lpa_plan_days').insert(rows);
        if (insErr) throw insErr;
      }
      toast.success('บันทึกแผน LPA เรียบร้อย');
      loadMonth();
    } catch (e) { toast.error('บันทึกแผนไม่สำเร็จ: ' + e.message); }
    finally { setSavingPlan(false); }
  };

  // สถานะต่อวัน+ชั้น: ● ตรวจแล้ว / ⊗ วางแผนแต่เลยวันแล้วไม่ตรวจ / ○ วางแผน (ยังไม่ถึง/วันนี้)
  const statusSymbol = (day, layerKey, planKey) => {
    const dstr = dateOf(selMonth, day);
    const planned = planDays[day]?.[planKey];
    const done = auditFor(dstr, layerKey);
    if (done) return { sym: '●', color: '#22c55e', title: `ตรวจแล้ว · ${done.auditor_name || ''}` };
    if (planned && dstr < getWorkDate()) return { sym: '⊗', color: '#ef4444', title: 'เลยกำหนด — ยังไม่ตรวจ' };
    if (planned) return { sym: '○', color: 'var(--text2)', title: 'วางแผนตรวจ' };
    return null;
  };

  /* ═════════ TAB: แผน (ราย "ไตรมาส" — 3 เดือน) ═════════ */
  const qMonths = useMemo(() => quarterMonths(selMonth), [selMonth]);
  const loadQuarter = async () => {
    if (!selLine) return;
    const key = monthKey;
    const mks = quarterMonths(selMonth);
    const first = dateOf(mks[0], 1), last = dateOf(mks[2], daysInMonth(mks[2]));
    const [plsRes, audsRes] = await Promise.all([
      supabase.from('lpa_plans').select('*, lpa_plan_days(*)').eq('line_name', selLine).eq('shift', selShift).in('month_key', mks),
      supabase.from('lpa_audits').select('id, audit_date, layer, auditor_name').eq('line_name', selLine).eq('shift', selShift).gte('audit_date', first).lte('audit_date', last),
    ]);
    /* 🔴 อ่านไม่สำเร็จ ≠ "ยังไม่ตรวจ" — ใบไตรมาสนี้ถูกพิมพ์ไปเซ็น ⇒ ช่อง ⊗ ที่มาจากคิวรีล่ม
       = กล่าวหาหน้างานบนกระดาษที่ยื่นออกไปแล้ว (คลาสเดียวกับตารางเดือน · QC audit 20/10) */
    const { data: pls } = plsRes, { data: auds } = audsRes;
    const qe = audsRes.error ? `โหลดผลตรวจของไตรมาสไม่สำเร็จ: ${audsRes.error.message}`
      : plsRes.error ? `โหลดแผนตรวจของไตรมาสไม่สำเร็จ: ${plsRes.error.message}` : '';
    const map = {};
    mks.forEach(mk => {
      const pl = (pls || []).find(p => p.month_key === mk) || null;
      const days = {};
      (pl?.lpa_plan_days || []).forEach(d => { days[d.day] = d; });
      map[mk] = { plan: pl, days };
    });
    if (monthKeyRef.current !== key) return;   // 🔴 ทิ้งคำตอบที่มาช้า (ไม่งั้นแผนไตรมาสของไลน์เก่าค้างบนจอไลน์ใหม่)
    setQLoadedKey(key);
    setQErr(qe);
    setQData(map);
    setQAudits(auds || []);
    const firstPl = mks.map(mk => map[mk].plan).find(Boolean);
    let stations = firstPl?.stations || '';
    if (!stations && canManage) { const { list } = await fetchStationNames(); stations = list.join('\n'); }
    if (monthKeyRef.current !== key) return;   // await รอบที่ 2 (ดึงจุดงาน) ⇒ ต้องเทียบอีกครั้ง
    setQHeader({
      leader_name: firstPl?.leader_name || '', supervisor_name: firstPl?.supervisor_name || '',
      manager_name: firstPl?.manager_name || '', gm_name: firstPl?.gm_name || '', stations,
    });
  };
  useEffect(() => { if (tab === 'plan') loadQuarter(); }, [selLine, selShift, selMonth, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const setQHeaderF = (k, v) => setQHeader(prev => ({ ...prev, [k]: v }));
  const setQDay = (mk, day, patch) => setQData(prev => {
    const md = prev[mk] || { plan: null, days: {} };
    const pd = md.days[day] || { day, station: '', plan_leader: false, plan_supervisor: false, plan_manager: false, plan_gm: false };
    return { ...prev, [mk]: { ...md, days: { ...md.days, [day]: { ...pd, ...patch } } } };
  });
  const qAuditFor = (dstr, layer) => qAudits.find(a => a.audit_date === dstr && a.layer === layer);
  const qStatus = (mk, day, layerKey, planKey) => {
    const dstr = dateOf(mk, day);
    const planned = qData[mk]?.days?.[day]?.[planKey];
    if (qAuditFor(dstr, layerKey)) return { sym: '●', color: '#22c55e', title: 'ตรวจแล้ว' };
    /* 🔴 อ่านผลตรวจไม่ได้ = "ไม่รู้" ห้ามขึ้น ⊗ (เลยกำหนด) — จอ/ใบพิมพ์จะกล่าวหาคนจากคิวรีที่ล่ม */
    if (qErr && planned) return { sym: '?', color: 'var(--amber)', title: 'อ่านผลตรวจไม่ได้ — ยังบอกไม่ได้ว่าตรวจแล้วหรือยัง' };
    if (planned && dstr < getWorkDate()) return { sym: '⊗', color: '#ef4444', title: 'เลยกำหนด — ยังไม่ตรวจ' };
    if (planned) return { sym: '○', color: 'var(--text2)', title: 'วางแผนตรวจ' };
    return null;
  };

  // เติมแผนอัตโนมัติทั้งไตรมาส — ครอบทุกจุดงาน "ภายในแต่ละเดือน" (แจกหลายสถานี/วันถ้าจุดงาน > วันทำงาน)
  const autoFillQuarter = () => {
    const stationList = (qHeader.stations || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (!stationList.length) { toast.error('กรอก/ดึงรายชื่อสถานี (Station) ก่อน'); return; }
    const next = { ...qData };
    qMonths.forEach((mk, mi) => {
      const nDays = daysInMonth(mk);
      const working = [];
      for (let d = 1; d <= nDays; d++) if (!isHoliday(dateOf(mk, d))) working.push(d);
      if (!working.length) { next[mk] = { ...(next[mk] || { plan: null }), days: {} }; return; }
      // ครบทุกจุดงานภายในเดือน → สถานี/วัน = ceil(จำนวนจุดงาน ÷ วันทำงาน)
      const perDay = Math.max(1, Math.ceil(stationList.length / working.length));
      const blocks = [[1, 7], [8, 14], [15, 21], [22, 31]];
      const svDays = blocks.map(([a, b]) => working.find(d => d >= a && d <= b)).filter(Boolean);
      const wk2 = working.filter(d => d >= 8 && d <= 14);
      const mgrDay = wk2[1] || wk2[0] || working[Math.floor(working.length / 2)];
      const gmDay = mi === 0 ? (working.find(d => d >= 15) || working[Math.floor(working.length / 2)]) : null; // GM รายไตรมาส = ครั้งเดียว เดือนแรก
      const days = {};
      let si = 0;
      working.forEach(d => {
        const stns = [];
        for (let k = 0; k < perDay && si < stationList.length; k++) { stns.push(stationList[si]); si++; }
        if (!stns.length) stns.push(stationList[(si + d) % stationList.length]); // แจกครบแล้ว วันที่เหลือให้ตรวจซ้ำ
        days[d] = {
          day: d, station: stns.join(', '),
          plan_leader: true, plan_supervisor: svDays.includes(d),
          plan_manager: d === mgrDay, plan_gm: gmDay ? d === gmDay : false,
        };
      });
      next[mk] = { ...(next[mk] || { plan: null }), days };
    });
    setQData(next);
    toast.success(`เติมแผนทั้งไตรมาสแล้ว — ครบ ${stationList.length} จุดงานในทุกเดือน (แก้ไขได้)`);
  };

  const saveQuarter = async () => {
    if (!lineGuard('แผนตรวจรายไตรมาสของไลน์นี้')) return;
    const misQ = monthMismatch(qLoadedKey);
    if (misQ) { toast.error(misQ); return; }
    if (!canManage) return;
    setSavingPlan(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      for (const mk of qMonths) {
        const md = qData[mk] || { plan: null, days: {} };
        const row = {
          ...(md.plan?.id ? { id: md.plan.id } : {}),
          line_name: selLine, shift: selShift, month_key: mk,
          leader_name: qHeader.leader_name || null, supervisor_name: qHeader.supervisor_name || null,
          manager_name: qHeader.manager_name || null, gm_name: qHeader.gm_name || null,
          stations: qHeader.stations || null,
          created_by: md.plan?.created_by || user?.id || null, updated_at: new Date().toISOString(),
        };
        const { data: saved, error } = await supabase.from('lpa_plans').upsert(row, { onConflict: 'line_name,shift,month_key' }).select().single();
        if (error) throw error;
        const { error: wErr432 } = await supabase.from('lpa_plan_days').delete().eq('plan_id', saved.id);
        if (wErr432) { toast.error('ล้างแผนรายวันเดิม (ยังไม่เขียนชุดใหม่ กันซ้ำ)ไม่สำเร็จ: ' + wErr432.message); return; }
        const rows = Object.values(md.days).filter(d => d.station || d.plan_leader || d.plan_supervisor || d.plan_manager || d.plan_gm)
          .map(d => ({ plan_id: saved.id, day: d.day, station: d.station || null, plan_leader: !!d.plan_leader, plan_supervisor: !!d.plan_supervisor, plan_manager: !!d.plan_manager, plan_gm: !!d.plan_gm }));
        if (rows.length) { const { error: e2 } = await supabase.from('lpa_plan_days').insert(rows); if (e2) throw e2; }
      }
      toast.success('บันทึกแผน LPA ทั้งไตรมาสเรียบร้อย');
      loadQuarter(); loadMonth();
    } catch (e) { toast.error('บันทึกแผนไม่สำเร็จ: ' + e.message); }
    finally { setSavingPlan(false); }
  };

  /* ── แท็บ ⚙️ หัวข้อตรวจ: ลงที่ไลน์ของตัวเองก่อนเสมอ + สรุปที่มาของเช็คลิสต์ ── */
  useEffect(() => {
    if (tab === 'questions' && !qScopePicked && selLine) setQScope(selLine);
  }, [tab, qScopePicked, selLine]);

  /* "เช็คลิสต์ของไลน์นี้ประกอบจากอะไรบ้าง" — ดึงจากทะเบียนกลางกี่ข้อ ปิดไว้กี่ข้อ ของตัวเองกี่ข้อ */
  const qScopeStats = useMemo(() => {
    if (!qScope) return null;
    const act = questions.filter(q => q.is_active);
    const master = act.filter(q => !q.line_name);
    const off = master.filter(q => (q.hidden_for_lines || []).includes(qScope)).length;
    return { off, used: master.length - off, own: act.filter(q => q.line_name === qScope).length };
  }, [questions, qScope]);

  /* ═════════ TAB: บันทึกผลตรวจ ═════════ */
  const auditQuestions = useMemo(() => questionsFor(selLine, auditDate), [questions, selLine, auditDate]);
  /* ข้อที่ "ตรวจไปแล้วแต่วันนี้ไม่อยู่ในเช็คลิสต์" (ถูกลบ/ปิดใช้/ซ่อนไลน์ทีหลัง) — ต้องยังโชว์ในใบเดิม
     🔴 ใบที่บันทึกแล้ว = บันทึก ไม่ใช่ใบที่ generate ใหม่ · อ่านอย่างเดียว (แก้ไม่ได้ เพราะไม่มีข้อให้อ้างแล้ว) */
  const removedAnswers = useMemo(() => savedOnlyAnswers(draft?.answers, auditQuestions), [draft?.answers, auditQuestions]);

  useEffect(() => {
    if (!selLine || tab !== 'audit') return;
    const key = draftKey;   // ใบร่างนี้เป็นของ line|shift|date|layer ชุดไหน
    (async () => {
      const [exRes, plRes] = await Promise.all([
        supabase.from('lpa_audits').select('*, lpa_audit_answers(*)').eq('line_name', selLine).eq('shift', selShift).eq('audit_date', auditDate).eq('layer', auditLayer).maybeSingle(),
        supabase.from('lpa_plans').select('id, lpa_plan_days(day, station)').eq('line_name', selLine).eq('shift', selShift).eq('month_key', auditDate.slice(0, 7)).maybeSingle(),
      ]);
      const { data: existing } = exRes, { data: pl } = plRes;
      /* 🔴 ทิ้งคำตอบที่มาช้า — ไม่งั้นใบร่างของไลน์ก่อนหน้าทับจอ แล้วคำตอบข้อ common ไปลงผิดไลน์เงียบๆ
         (และทับคำตอบที่คนกำลังติ๊กอยู่ด้วย) */
      if (draftKeyRef.current !== key) return;
      /* 🔴🔴 **อ่านใบเดิมล้ม ≠ "ยังไม่มีใบ"** (QC audit 20/10) — เดิมแกะแต่ `{ data }` ทิ้ง error
         ⇒ เน็ตสะดุดครั้งเดียว = ได้ใบร่างเปล่า `answers: {}` · กดบันทึก = `upsert` ลงแถวเดิม
           (onConflict คุมให้) แล้ว `delete` คำตอบทั้งใบทิ้ง แล้ว insert แค่ชุดใหม่
         = **คำตอบที่ตรวจไปแล้วหายถาวร** — คลาสเดียวกับที่ `savedOnlyAnswers` ตั้งใจกันไว้
         ⇒ fail-closed: ไม่ตั้ง draft เลย (`draftMismatch()` บล็อกการบันทึกให้อยู่แล้ว) + เขียนบนจอว่าทำไม */
      if (exRes.error) {
        setDraftErr('โหลดใบตรวจเดิมไม่สำเร็จ: ' + exRes.error.message);
        setDraft(null); return;
      }
      setDraftErr('');
      const planStation = pl?.lpa_plan_days?.find(d => d.day === Number(auditDate.slice(8, 10)))?.station || '';
      setAuditPlanStations([...new Set((pl?.lpa_plan_days || []).map(d => (d.station || '').trim()).filter(Boolean))]);
      if (existing) {
        const ans = {};
        /* เก็บ `question_text` ที่ snapshot ไว้ตอนตรวจด้วย — ข้อที่ถูกลบ/ปิดใช้ทีหลังจะไม่มีคำถาม
           ให้ดูอีกแล้ว ถ้าไม่พกข้อความมา ใบเก่าจะหายไปเงียบๆ (ดู savedOnlyAnswers) */
        (existing.lpa_audit_answers || []).forEach(a => { if (a.question_id) ans[a.question_id] = { answer: a.answer, note: a.note || '', text: a.question_text || '' }; });
        setDraft({ key, id: existing.id, station: existing.station || planStation, auditor_name: existing.auditor_name || fullName || '', auditor_sig_url: existing.auditor_sig_url || null, answers: ans });
        loadedSnapRef.current = lpaSnap(ans, existing.station || planStation);
      } else {
        setDraft({ key, id: null, station: planStation, auditor_name: fullName || '', auditor_sig_url: myProfile?.signature_url || null, answers: {} });
        loadedSnapRef.current = lpaSnap({}, planStation);
      }
      const saved = isMobile ? loadDraft(`lpa:${key}:${fullName || ''}`) : null;
      setPendingDraft(saved && lpaSnap(saved.data?.answers, saved.data?.station) !== loadedSnapRef.current ? saved : null);
    })();
  }, [selLine, selShift, auditDate, auditLayer, tab, myProfile, fullName]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** 🔴 ชั้นที่ 2 — ใบร่างบนจอเป็นของ "ที่เลือกอยู่ตอนนี้" จริงไหม (ยังโหลด = ยังไม่ให้เขียน)
   *  คืนข้อความเหตุผล หรือ `null` เมื่อตรงกัน · **ห้ามเขียน DB ตอนไม่ตรง** (fail-closed)
   *  ป้องกันกรณีที่ใบร่างเพี้ยนมาแล้วก่อนด่านชั้นแรก (เช่นเปิดจอทิ้งไว้แล้วเน็ตสะดุด) */
  const draftMismatch = () => {
    if (!draft) return 'ใบตรวจยังโหลดไม่เสร็จ — รอสักครู่แล้วลองอีกครั้ง';
    return isStale(draft.key, draftKey)
      ? staleBlockText({ what: 'ใบที่แสดงอยู่', unitWord: 'ไลน์/กะ/วันที่/ชั้น' })
      : null;
  };

  const lpaDraftKey = isMobile && draft && draft.key === draftKey ? `lpa:${draft.key}:${fullName || ''}` : null;
  const lpaDirty = !!lpaDraftKey && !pendingDraft && lpaSnap(draft.answers, draft.station) !== loadedSnapRef.current;
  useDraftAutosave(lpaDraftKey, { answers: draft?.answers || {}, station: draft?.station || '' }, lpaDirty);
  const restoreLpaDraft = () => {
    const d = pendingDraft?.data; if (!d) return;
    setDraft(prev => (prev ? { ...prev, answers: { ...prev.answers, ...(d.answers || {}) }, station: d.station || prev.station } : prev));
    setPendingDraft(null);
  };

  const setAnswer = (qid, answer) => setDraft(prev => ({ ...prev, answers: { ...prev.answers, [qid]: { ...(prev.answers[qid] || {}), answer } } }));
  const setAnsNote = (qid, note) => setDraft(prev => ({ ...prev, answers: { ...prev.answers, [qid]: { ...(prev.answers[qid] || {}), note } } }));
  const setAllY = () => setDraft(prev => {
    const ans = { ...prev.answers };
    auditQuestions.forEach(q => { if (!ans[q.id]?.answer) ans[q.id] = { ...(ans[q.id] || {}), answer: 'Y' }; });
    return { ...prev, answers: ans };
  });

  const handleSignDone = async (blob) => {
    if (!lineGuard('ใบตรวจ LPA ของไลน์นี้')) return;
    const keyAtSign = draftKeyRef.current;
    setShowSignPad(false);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) { toast.error('เซสชันหมดอายุ — กรุณา login ใหม่'); return; }
      const path = `${user.id}/lpa_${Date.now()}.png`;
      const { error } = await supabase.storage.from('signatures').upload(path, blob, uploadOpts({ contentType: 'image/png' }));
      if (error) { toast.error('อัปโหลดลายเซ็นไม่สำเร็จ: ' + error.message); return; }
      const url = supabase.storage.from('signatures').getPublicUrl(path).data.publicUrl;
      // ลบไฟล์เซ็นเฉพาะกิจอันเก่า (เฉพาะโฟลเดอร์ตัวเอง — ไม่ลบลายเซ็นโปรไฟล์)
      const old = draft?.auditor_sig_url;
      if (old?.includes('/signatures/') && old.includes('/lpa_') && old !== myProfile?.signature_url) {
        const oldPath = decodeURIComponent(old.split('/signatures/')[1] || '').split('?')[0];
        if (oldPath.startsWith(`${user.id}/`)) supabase.storage.from('signatures').remove([oldPath]).catch(() => {});
      }
      /* ใบร่างเปลี่ยนไปแล้วระหว่างอัปโหลด = ลายเซ็นนี้ไม่ใช่ของใบที่เห็นอยู่ ห้ามแปะทับ */
      if (draftKeyRef.current !== keyAtSign) { toast.info('เปลี่ยนใบตรวจระหว่างบันทึกลายเซ็น — เซ็นใหม่ในใบที่ต้องการ'); return; }
      setDraft(prev => ({ ...prev, auditor_sig_url: url }));
      toast.success('บันทึกลายเซ็นแล้ว');
    } catch (e) { toast.error('เกิดข้อผิดพลาด: ' + e.message); }
  };

  const saveAudit = async () => {
    if (!canRecord) return;
    if (!lineGuard('ใบตรวจ LPA ของไลน์นี้')) return;
    const mis = draftMismatch();
    if (mis) { toast.error(mis); return; }
    const unanswered = auditQuestions.filter(q => !draft.answers[q.id]?.answer);
    if (unanswered.length) { toast.error(`ยังตอบไม่ครบ ${unanswered.length} ข้อ (ข้อแรก: ${unanswered[0].seq}. ${unanswered[0].question.slice(0, 40)}...)`); return; }
    const needNote = auditQuestions.filter(q => ['N', 'T'].includes(draft.answers[q.id]?.answer) && !draft.answers[q.id]?.note?.trim());
    if (needNote.length) { toast.error(`ข้อที่ตอบ N/T ต้องกรอกรายละเอียดปัญหา (ข้อ ${needNote.map(q => q.seq).join(', ')})`); return; }
    setSavingAudit(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const row = {
        ...(draft.id ? { id: draft.id } : {}),
        line_name: selLine, shift: selShift, audit_date: auditDate, layer: auditLayer,
        station: draft.station || null, auditor_name: draft.auditor_name || null, auditor_sig_url: draft.auditor_sig_url || null,
        updated_at: new Date().toISOString(),
        ...(draft.id ? {} : { created_by: user?.id || null, created_by_name: fullName || null }),
      };
      const { data: saved, error } = await supabase.from('lpa_audits').upsert(row, { onConflict: 'line_name,shift,audit_date,layer' }).select().single();
      if (error) throw error;
      const { error: delErr } = await supabase.from('lpa_audit_answers').delete().eq('audit_id', saved.id);
      if (delErr) throw delErr;
      /* 🔴 ต้องเขียนกลับ "ข้อที่ถูกถอดออกจากเช็คลิสต์ไปแล้ว" ด้วย — ของเดิม delete-then-insert
         เฉพาะข้อที่ยังอยู่ ⇒ แค่กดบันทึกซ้ำใบเก่า คำตอบของข้อที่ถูกลบจะหายถาวรรอบสอง */
      const { error: insErr } = await supabase.from('lpa_audit_answers').insert([
        ...auditQuestions.map(q => ({
          audit_id: saved.id, question_id: q.id, question_text: q.question,
          answer: draft.answers[q.id].answer, note: draft.answers[q.id].note?.trim() || null,
        })),
        ...removedAnswers.map(a => ({
          audit_id: saved.id, question_id: a.question_id, question_text: a.question_text,
          answer: a.answer, note: a.note?.trim() || null,
        })),
      ]);
      if (insErr) throw insErr;
      // แจ้งเฉพาะ "เจอข้อบกพร่อง" (ตอบ N/T) — ตรวจผ่านล้วนไม่ต้องรบกวนใคร
      const finds = auditQuestions.filter(q => ['N', 'T'].includes(draft.answers[q.id]?.answer));
      if (finds.length) notifyEvent({
        event: 'lpa_finding', type: 'error', ref_table: 'lpa_audits', ref_id: saved.id,
        line_name: selLine, actor: draft.auditor_name || fullName,
        lines: [
          `🏭 ไลน์: ${selLine} · ${SHIFT_META[selShift]} · 📅 ${thDate(auditDate)}`,
          `🔍 ชั้น ${LAYERS.find(l => l.key === auditLayer)?.label || auditLayer}${draft.station ? ` · จุด ${draft.station}` : ''}`,
          `❗ พบ ${finds.length} ข้อ จากทั้งหมด ${auditQuestions.length} ข้อ`,
          ...finds.slice(0, 5).map(q => `  • [${draft.answers[q.id].answer}] ข้อ ${q.seq} ${q.question.slice(0, 70)} — ${draft.answers[q.id].note?.trim() || ''}`),
          finds.length > 5 ? `  • …และอีก ${finds.length - 5} ข้อ` : '',
        ],
      });
      toast.success(`บันทึกผลตรวจ LPA ${thDate(auditDate)} เรียบร้อย`);
      setDraft(prev => ({ ...prev, id: saved.id }));
      loadedSnapRef.current = lpaSnap(draft.answers, draft.station);   // บันทึกแล้ว = ไม่มีของค้าง ⇒ ร่างถูกล้างเอง
      if (lpaDraftKey) clearDraft(lpaDraftKey);
      loadMonth();
    } catch (e) { toast.error('บันทึกไม่สำเร็จ: ' + e.message); }
    finally { setSavingAudit(false); }
  };

  const deleteAudit = async () => {
    if (!draft?.id || !mayDelete) return;
    if (!lineGuard('ใบตรวจ LPA ของไลน์นี้')) return;
    const mis = draftMismatch();
    if (mis) { toast.error(mis); return; }
    if (!window.confirm(`ลบผลตรวจ ${thDate(auditDate)} ${SHIFT_META[selShift]} ชั้น ${LAYERS.find(l => l.key === auditLayer)?.label}?`)) return;
    const { error } = await supabase.from('lpa_audits').delete().eq('id', draft.id);
    if (error) { toast.error('ลบไม่สำเร็จ: ' + error.message); return; }
    toast.success('ลบแล้ว');
    setDraft(prev => ({ ...prev, id: null, answers: {} }));
    loadMonth();
  };

  /* ═════════ TAB: คำถาม master ═════════ */
  const saveQuestion = async () => {
    if (!qGuard(qEditing, 'คำถามของไลน์นี้')) return;
    if (!qEditing.question?.trim()) { toast.error('กรอกคำถาม'); return; }
    const row = {
      ...(qEditing.id ? { id: qEditing.id } : {}),
      category: qEditing.category, seq: Number(qEditing.seq) || 0, question: qEditing.question.trim(),
      line_name: qEditing.line_name || null,
      issue_start: qEditing.category === 'special' ? (qEditing.issue_start || null) : null,
      issue_end: qEditing.category === 'special' ? (qEditing.issue_end || null) : null,
      is_active: qEditing.is_active !== false,
    };
    const { error } = await supabase.from('lpa_questions').upsert(row, { onConflict: 'id' });
    if (error) { toast.error('บันทึกไม่สำเร็จ: ' + error.message); return; }
    toast.success('บันทึกคำถามแล้ว');
    setQEditing(null);
    const { data: qs } = await supabase.from('lpa_questions').select('*').order('seq');
    setQuestions(qs || []);
  };
  const toggleQuestion = async (q) => {
    if (!qGuard(q, 'คำถามของไลน์นี้')) return;
    // ปิดใช้งานข้อ = ถอดออกจาก checklist ทุกใบตรวจถัดไป → ยืนยันก่อน (UI-CONVENTIONS §5.4) · เปิดกลับไม่ต้องถาม
    if (q.is_active && !window.confirm(`ปิดใช้งานข้อ "${q.question}" ?\n\nข้อนี้จะไม่ขึ้นในใบตรวจ LPA ครั้งถัดไป (เปิดกลับได้ภายหลัง)`)) return;
    const { error } = await supabase.from('lpa_questions').update({ is_active: !q.is_active }).eq('id', q.id);
    if (error) { toast.error(error.message); return; }
    setQuestions(prev => prev.map(x => x.id === q.id ? { ...x, is_active: !q.is_active } : x));
  };
  // ซ่อน/แสดงข้อ common เฉพาะไลน์ (เขียน hidden_for_lines[]) — ต้อง apply migration 20260723 ก่อน (best-effort)
  const toggleHideForLine = async (q, line) => {
    if (!qGuard(q, 'คำถามของไลน์นี้')) return;
    const cur = Array.isArray(q.hidden_for_lines) ? q.hidden_for_lines : [];
    const next = cur.includes(line) ? cur.filter(x => x !== line) : [...cur, line];
    const { error } = await supabase.from('lpa_questions').update({ hidden_for_lines: next.length ? next : null }).eq('id', q.id);
    if (error) { toast.error('บันทึกไม่สำเร็จ (ต้อง apply migration hidden_for_lines ก่อน): ' + error.message); return; }
    setQuestions(prev => prev.map(x => x.id === q.id ? { ...x, hidden_for_lines: next } : x));
  };
  const [qBusy, setQBusy] = useState(false);
  const deleteQuestion = async (q) => {
    if (!qGuard(q, 'คำถามของไลน์นี้')) return;
    /* 🔴 นับปลายทางก่อนถาม — ถามแล้วค่อยปฏิเสธ = คนกดยืนยันไปแล้วแต่ไม่เกิดอะไร
       นับไม่ได้/โยน = **ไม่ลบ** (fail-closed) · มีผลตรวจอ้างอยู่ = ให้ "⏸ ปิดใช้งาน" แทน */
    setQBusy(true);
    let refs = null;
    try { refs = await loadLpaQuestionRefs(supabase, q.id); } catch { refs = null; }
    setQBusy(false);
    const block = lpaQuestionBlockMessage(q, refs);
    if (block) { toast.error(block); return; }
    // ยืนยันต้องบอกขอบเขตเสมอ (common = กระทบทุกไลน์ · คนกดมักไม่รู้ตัว — คำสั่ง user 12/10)
    if (!window.confirm(lpaDeleteConfirmText(q))) return;
    const { error } = await supabase.from('lpa_questions').delete().eq('id', q.id);
    if (error) { toast.error(error.message); return; }
    setQuestions(prev => prev.filter(x => x.id !== q.id));
    toast.success('ลบแล้ว');
  };

  /* ═════════ PRINT: ใบแผน (Layer Process Audit Plan) ═════════ */
  const printPlan = async () => {
    setPrinting(true);
    try {
      const dfp = await getDocForm('lpa_plan', {});
      const logo = await urlToDataUrl(dfp.logo_url || tsLogoUrl);
      const nDays = daysInMonth(selMonth);
      const days = Array.from({ length: nDays }, (_, i) => i + 1);
      const hol = (d) => isHoliday(dateOf(selMonth, d));
      const holBg = 'background:#2e7d32;';
      const sym = (d, layerKey, planKey) => {
        const s = statusSymbol(d, layerKey, planKey);
        if (!s) return '';
        const c = s.sym === '●' ? '#000' : s.sym === '⊗' ? '#000' : '#000';
        return `<span style="font-size:13px;color:${c}">${s.sym}</span>`;
      };
      const dayHead = days.map(d => `<td style="border:1px solid #000;text-align:center;font-size:9px;width:22px;${hol(d) ? holBg + 'color:#fff;' : ''}">${d}</td>`).join('');
      const stationRow = days.map(d => `<td style="border:1px solid #000;text-align:center;vertical-align:bottom;padding:2px 0;${hol(d) ? holBg : ''}">
        <div style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:9px;margin:0 auto;white-space:nowrap;max-height:110px;overflow:hidden">${planDays[d]?.station || ''}</div></td>`).join('');
      const layerRow = (layerKey, planKey, label) => `<tr>
        <td style="border:1px solid #000;padding:2px 6px;font-size:11px;font-weight:bold">${label}</td>
        ${days.map(d => `<td style="border:1px solid #000;text-align:center;height:22px;${hol(d) ? holBg : ''}">${hol(d) ? '' : sym(d, layerKey, planKey)}</td>`).join('')}
      </tr>`;
      const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/>
<title>Layer Process Audit Plan ${selLine} ${monthLabel(selMonth)}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Sarabun',sans-serif;font-size:11px;color:#000;background:#fff;padding:8mm}
table{border-collapse:collapse}
@media print{@page{size:A4 landscape;margin:6mm}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:0}}
</style></head><body>
<div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:6px">
  ${logo ? `<img src="${logo}" style="width:54px"/>` : ''}
  <div style="font-size:17px;font-weight:bold">Layer Process Audit Plan</div>
</div>
<table style="width:100%;margin-bottom:6px"><tr>
  <td style="width:23%;vertical-align:top">
    <table style="width:100%"><tr>
      <td style="border:1px solid #000;padding:2px 8px;font-size:11px">Shift : <b>${selShift === 'day' ? '01' : '02'}</b></td>
    </tr><tr>
      <td style="border:1px solid #000;padding:2px 8px">${plan?.gm_name || ''} <span style="float:right;color:#333">GM Plant</span></td>
    </tr></table>
  </td>
  <td style="width:23%;vertical-align:top;padding-left:8px">
    <table style="width:100%"><tr>
      <td style="border:1px solid #000;padding:2px 8px">Line : <b>${selLine}</b></td>
    </tr><tr>
      <td style="border:1px solid #000;padding:2px 8px">${plan?.manager_name || ''} <span style="float:right;color:#333">Manager</span></td>
    </tr></table>
  </td>
  <td style="width:26%;vertical-align:top;padding-left:8px">
    <table style="width:100%"><tr>
      <td style="border:1px solid #000;padding:2px 8px;background:#e8e8e8">${plan?.leader_name || ''} <span style="float:right;color:#333">Leader</span></td>
    </tr><tr>
      <td style="border:1px solid #000;padding:2px 8px">${plan?.supervisor_name || ''} <span style="float:right;color:#333">Supervisor</span></td>
    </tr></table>
  </td>
  <td style="vertical-align:top;padding-left:10px;font-size:10px">
    <div><span style="display:inline-block;width:13px;height:13px;border:1.5px solid #000;border-radius:50%;vertical-align:middle"></span> Audit Plan</div>
    <div style="margin-top:2px"><span style="display:inline-block;width:13px;height:13px;border:1.5px solid #000;border-radius:50%;background:#000;vertical-align:middle"></span> Audit is Completed</div>
    <div style="margin-top:2px"><span style="font-size:14px;vertical-align:middle">⊗</span> Audit Not Completed</div>
  </td>
</tr></table>
<table style="width:100%">
  <tr><td style="border:1px solid #000"></td><td colspan="${nDays}" style="border:1px solid #000;text-align:center;font-weight:bold;font-size:13px">${monthLabel(selMonth)}</td></tr>
  <tr><td style="border:1px solid #000;padding:2px 6px;font-size:11px;font-weight:bold;width:120px">Position</td>${dayHead}</tr>
  <tr><td style="border:1px solid #000;padding:2px 6px;font-size:11px;height:118px">Station for audit.</td>${stationRow}</tr>
  ${layerRow('leader', 'plan_leader', 'Leader')}
  ${layerRow('supervisor', 'plan_supervisor', 'Supervisor')}
  ${layerRow('manager', 'plan_manager', 'Manager')}
  ${layerRow('gm', 'plan_gm', 'GM')}
</table>
<div style="display:flex;justify-content:space-between;margin-top:3px;font-size:9px"><span>${fullCode(dfp)}${dfp.footer_note ? ' · ' + dfp.footer_note : ''}</span><span>${dfp.effective_date ? 'Effective Date : ' + dfp.effective_date : ''}</span></div>
<script>window.onload = () => window.print();</script>
</body></html>`;
      const w = window.open('', '_blank');
      if (!w) { toast.error('เบราว์เซอร์บล็อก popup — อนุญาต popup แล้วลองใหม่'); return; }
      w.document.write(html);
      w.document.close();
    } finally { setPrinting(false); }
  };

  /* ═════════ PRINT: ใบรายงาน FM-QMR-008 ═════════ */
  const printReport = async () => {
    setPrinting(true);
    try {
      // เลขฟอร์ม/Rev/Effective จากทะเบียนเอกสาร (/doc-forms) — fallback ค่าเดิม
      const df = await getDocForm('lpa_report', { form_code: 'FM-QMR-008', rev: 'Rev.01', effective_date: EFFECTIVE });
      const logo = await urlToDataUrl(df.logo_url || tsLogoUrl);
      const nDays = daysInMonth(selMonth);
      const days = Array.from({ length: nDays }, (_, i) => i + 1);
      const hol = (d) => isHoliday(dateOf(selMonth, d));
      const holBg = 'background:#2e7d32;';
      const qs = questionsForMonth(selLine, selMonth);
      const leaderAud = {}; days.forEach(d => { leaderAud[d] = auditFor(dateOf(selMonth, d), 'leader'); });
      const svAud = [1, 2, 3, 4].map(w => monthAudits.find(a => a.layer === 'supervisor' && weekOfDay(Number(a.audit_date.slice(8, 10))) === w));
      const mgrAud = monthAudits.find(a => a.layer === 'manager');
      const gmAud = monthAudits.find(a => a.layer === 'gm');
      const sigDataUrls = {};
      await Promise.all(monthAudits.filter(a => a.auditor_sig_url).map(async a => { sigDataUrls[a.id] = await urlToDataUrl(a.auditor_sig_url); }));

      const ansCell = (audit, qid, extra = '') => {
        const a = answerOf(audit, qid);
        const letter = a?.answer === 'NA' ? 'N/A' : (a?.answer || '');
        const color = a?.answer === 'N' ? 'color:#c00;font-weight:bold;' : a?.answer === 'T' ? 'color:#b07600;font-weight:bold;' : '';
        return `<td style="border:1px solid #000;text-align:center;font-size:8px;${color}${extra}">${letter}</td>`;
      };
      const catRows = [];
      CATEGORIES.forEach(cat => {
        const catQs = qs.filter(q => q.category === cat.key);
        if (!catQs.length) return;
        catQs.forEach((q, qi) => {
          const isSpecial = cat.key === 'special';
          const issueTxt = isSpecial && (q.issue_start || q.issue_end) ? `<span style="font-size:7px"> Issue Date: ${q.issue_start ? thDate(q.issue_start) : ''} - ${q.issue_end ? thDate(q.issue_end) : ''}</span>` : '';
          catRows.push(`<tr>
            ${qi === 0 ? `<td rowspan="${catQs.length}" style="border:1px solid #000;text-align:center;vertical-align:middle;width:26px"><div style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:8px;margin:0 auto;white-space:nowrap">${cat.full}</div></td>` : ''}
            <td style="border:1px solid #000;text-align:center;font-size:8px;width:18px">${q.seq}</td>
            <td style="border:1px solid #000;padding:1px 4px;font-size:8px;${isSpecial ? 'color:#c00;' : ''}">${q.question}${issueTxt}</td>
            ${days.map(d => hol(d) ? `<td style="border:1px solid #000;${holBg}"></td>` : ansCell(leaderAud[d], q.id)).join('')}
            ${svAud.map(a => ansCell(a, q.id, 'background:#c9e4c5;')).join('')}
            ${ansCell(mgrAud, q.id, 'background:#e0e0e0;')}
            ${ansCell(gmAud, q.id, 'background:#f3e8a0;')}
          </tr>`);
        });
      });
      const stationRow = days.map(d => `<td style="border:1px solid #000;text-align:center;vertical-align:bottom;${hol(d) ? holBg : ''}"><div style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:7px;margin:0 auto;white-space:nowrap;max-height:70px;overflow:hidden">${leaderAud[d]?.station || ''}</div></td>`).join('');
      // ลายเซ็น "ตะแคงแนวดิ่ง" ตามฟอร์มกระดาษเดิมที่เซ็นกันมา (คำสั่งทีมงาน 2026-08-06) —
      // ช่องวันกว้างแค่ ~20px แต่สูง 56px ถ้าวางลายเซ็นแนวนอนจะถูกย่อจนอ่านไม่ออก
      // transform ไม่เปลี่ยนกล่อง layout → ต้องวาง img แบบ absolute กลางช่องก่อนแล้วค่อยหมุน
      // -90° = อ่านจากล่างขึ้นบน ทิศเดียวกับข้อความ vertical-rl ที่ใช้ทั้งใบ (สถานี/หมวด/Monthly)
      const sigCell = (a, extra = '') => `<td style="border:1px solid #000;text-align:center;vertical-align:middle;${extra}">${a
        ? (sigDataUrls[a.id]
          ? `<div style="position:relative;width:18px;height:50px;margin:0 auto"><img src="${sigDataUrls[a.id]}" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-90deg);max-height:18px;max-width:50px;object-fit:contain"/></div>`
          : `<div style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:6px;white-space:nowrap;max-height:50px;overflow:hidden;margin:0 auto">${(a.auditor_name || '').slice(0, 14)}</div>`)
        : ''}</td>`;
      const sigRow = days.map(d => hol(d) ? `<td style="border:1px solid #000;${holBg}"></td>` : sigCell(leaderAud[d])).join('');
      const issues = [];
      monthAudits.forEach(a => (a.lpa_audit_answers || []).forEach(x => { if (['N', 'T'].includes(x.answer)) issues.push({ date: a.audit_date, layer: a.layer, q: x.question_text, ans: x.answer, note: x.note }); }));
      issues.sort((a, b) => a.date.localeCompare(b.date));
      const issuesHtml = issues.length ? `<div style="margin-top:5px;font-size:9px"><b><u>บันทึกปัญหาที่พบ (N / T)</u></b>
        ${issues.map(i => `<div>· ${thDate(i.date)} [${i.ans}] ${i.q} — <b>${i.note || ''}</b> (${LAYERS.find(l => l.key === i.layer)?.label})</div>`).join('')}</div>` : '';

      const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/>
<title>Layer Process Audit Report ${selLine} ${monthLabel(selMonth)}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Sarabun',sans-serif;font-size:10px;color:#000;background:#fff;padding:6mm}
table{border-collapse:collapse;width:100%}
@media print{@page{size:A3 landscape;margin:5mm}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:0}}
</style></head><body>
<table style="margin-bottom:4px"><tr>
  <td style="width:90px">${logo ? `<img src="${logo}" style="width:64px"/>` : '<b>TS</b>'}</td>
  <td style="text-align:center"><div style="font-size:18px;font-weight:bold">Layer Process Audit Report</div></td>
  <td style="width:200px;font-size:11px">Month / Year : <b>${monthLabel(selMonth)}</b></td>
</tr></table>
<div style="font-size:11px;margin-bottom:3px">Audit Area : <b>LINE ${selLine}</b> ( ${plan?.leader_name || monthAudits.find(a => a.layer === 'leader')?.auditor_name || ''} ) · ${SHIFT_META[selShift]}</div>
<table>
  <tr>
    <td rowspan="3" style="border:1px solid #000;text-align:center;font-size:9px;font-weight:bold;width:26px">Description</td>
    <td rowspan="3" colspan="2" style="border:1px solid #000;text-align:center;font-size:9px;font-weight:bold">Audit Checklist / Question</td>
    <td colspan="${nDays}" style="border:1px solid #000;text-align:center;font-size:9px;font-weight:bold">Audit Result (ผลการตรวจสอบ Y, N, T, N/A)</td>
    <td colspan="4" style="border:1px solid #000;text-align:center;font-size:8px;font-weight:bold;background:#c9e4c5">Weekly</td>
    <td rowspan="2" style="border:1px solid #000;text-align:center;vertical-align:middle;width:20px;background:#e0e0e0"><div style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:8px;font-weight:bold;margin:0 auto">Monthly</div></td>
    <td rowspan="2" style="border:1px solid #000;text-align:center;vertical-align:middle;width:20px;background:#f3e8a0"><div style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:8px;font-weight:bold;margin:0 auto">Quarterly</div></td>
  </tr>
  <tr><td colspan="${nDays}" style="border:1px solid #000;text-align:center;font-size:8px">Date</td></tr>
  <tr>
    ${days.map(d => `<td style="border:1px solid #000;text-align:center;font-size:8px;width:20px;${hol(d) ? holBg + 'color:#fff;' : ''}">${d}</td>`).join('')}
    ${[1, 2, 3, 4].map(w => `<td style="border:1px solid #000;text-align:center;font-size:8px;width:20px;background:#c9e4c5">W${w}</td>`).join('')}
    <td style="border:1px solid #000;background:#e0e0e0"></td><td style="border:1px solid #000;background:#f3e8a0"></td>
  </tr>
  ${catRows.join('')}
  <tr>
    <td colspan="3" style="border:1px solid #000;text-align:right;padding:1px 6px;font-size:8px;font-weight:bold;height:74px;vertical-align:middle">Work Station (ระบุ Station ที่ทำการตรวจ)</td>
    ${stationRow}
    ${svAud.map(a => `<td style="border:1px solid #000;text-align:center;vertical-align:bottom;background:#c9e4c5"><div style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:7px;margin:0 auto;white-space:nowrap;max-height:70px;overflow:hidden">${a?.station || ''}</div></td>`).join('')}
    <td style="border:1px solid #000;text-align:center;vertical-align:bottom;background:#e0e0e0"><div style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:7px;margin:0 auto;white-space:nowrap;max-height:70px;overflow:hidden">${mgrAud?.station || ''}</div></td>
    <td style="border:1px solid #000;text-align:center;vertical-align:bottom;background:#f3e8a0"><div style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:7px;margin:0 auto;white-space:nowrap;max-height:70px;overflow:hidden">${gmAud?.station || ''}</div></td>
  </tr>
  <tr>
    <td colspan="3" style="border:1px solid #000;text-align:right;padding:1px 6px;font-size:8px;font-weight:bold;height:56px;vertical-align:middle">ลงชื่อ ผู้ตรวจสอบ</td>
    ${sigRow}
    ${svAud.map(a => sigCell(a, 'background:#c9e4c5;')).join('')}
    ${sigCell(mgrAud, 'background:#e0e0e0;')}
    ${sigCell(gmAud, 'background:#f3e8a0;')}
  </tr>
  <tr>
    <td colspan="3" style="border:1px solid #000"></td>
    <td colspan="${nDays}" style="border:1px solid #000;text-align:center;font-size:8px">Operator / Technical / Leader</td>
    <td colspan="4" style="border:1px solid #000;text-align:center;font-size:7px;background:#c9e4c5">Supervisor/Engineer</td>
    <td style="border:1px solid #000;text-align:center;font-size:7px;background:#e0e0e0">MGR</td>
    <td style="border:1px solid #000;text-align:center;font-size:7px;background:#f3e8a0">GM</td>
  </tr>
</table>
<div style="display:flex;gap:18px;margin-top:4px;font-size:8px;flex-wrap:wrap">
  <div><b>หมายเหตุ :</b> Y หมายถึง การปฏิบัติตรงตามมาตรฐาน (YES)</div>
  <div>N หมายถึง การปฏิบัติไม่ตรงตามมาตรฐาน (NO)</div>
  <div>T หมายถึง การยอมรับให้ปฏิบัติงานต่อได้ แต่มีเงื่อนไข และต้องไม่ส่งผลต่อคุณภาพชิ้นงาน (Temporary Accept)</div>
  <div>N/A หมายถึง ไม่เกี่ยวข้อง</div>
</div>
<div style="display:flex;gap:18px;margin-top:2px;font-size:8px;flex-wrap:wrap">
  <div><span style="display:inline-block;width:24px;height:9px;background:#c9e4c5;border:1px solid #999;vertical-align:middle"></span> Weekly : Cross-Functional ทำการตรวจทุกสัปดาห์ โดยทำการสุ่มตรวจ</div>
  <div><span style="display:inline-block;width:24px;height:9px;background:#e0e0e0;border:1px solid #999;vertical-align:middle"></span> Monthly : Manager ทำการตรวจทุกเดือน โดยทำการสุ่มตรวจ</div>
  <div><span style="display:inline-block;width:24px;height:9px;background:#f3e8a0;border:1px solid #999;vertical-align:middle"></span> Quarterly : GM Plant ทำการตรวจทุก 3 เดือน โดยสุ่มตรวจ</div>
</div>
${issuesHtml}
<div style="display:flex;justify-content:space-between;margin-top:3px;font-size:9px"><div>${fullCode(df)}${df.footer_note ? ' · ' + df.footer_note : ''}</div><div>${df.effective_date ? 'Effective Date : ' + df.effective_date : ''}</div></div>
<script>window.onload = () => window.print();</script>
</body></html>`;
      const w = window.open('', '_blank');
      if (!w) { toast.error('เบราว์เซอร์บล็อก popup — อนุญาต popup แล้วลองใหม่'); return; }
      w.document.write(html);
      w.document.close();
    } finally { setPrinting(false); }
  };

  /* ═════════ RENDER ═════════ */
  // UI-STANDARD 2026-09-24 — แถบเลือกไลน์/กะ/เดือน = FilterBar · กะ 2 ตัวเลือก = Segmented
  const selectorBar = (
    <FilterBar style={{ marginBottom: 14 }}>
      <span className="filter-label">ไลน์ / พื้นที่ตรวจ</span>
      {/* <LineSelect> — ลำดับชั้น/ตัดไลน์ปลดระวาง/ค่าเดิมไม่หายเงียบ (visibleLines กรอง scope ไว้แล้ว · 2026-09-07) */}
      <LineSelect lines={visibleLines} value={selLine} placeholder={null} onChange={setSelLine} />
      <Segmented value={selShift} onChange={setSelShift} label="กะ"
        options={[{ value: 'day', label: SHIFT_META.day }, { value: 'night', label: SHIFT_META.night }]} />
      <span className="filter-label">เดือน</span>
      <input type="month" value={selMonth} onChange={e => e.target.value && setSelMonth(e.target.value)} />
    </FilterBar>
  );

  const nDays = daysInMonth(selMonth);
  const daysArr = Array.from({ length: nDays }, (_, i) => i + 1);

  // เลขฟอร์มบน subtitle/ปุ่มพิมพ์ ดึงจากทะเบียนเอกสาร (doc_key เดียวกับ print path) — fallback = FORM_NO
  const lpaDoc = docReady ? docFormSync('lpa_report', { form_code: 'FM-QMR-008', rev: 'Rev.01' }) : { form_code: 'FM-QMR-008', rev: 'Rev.01' };
  const lpaFormNo = fullCode(lpaDoc) || FORM_NO;
  const lpaFormCode = lpaDoc.form_code || FORM_NO.split(' ')[0];

  return (
    <Page>
      <PageHeader title="Layer Process Audit (LPA)" icon="📋"
        sub={`แผนตรวจ + บันทึกผล + รายงาน ${lpaFormNo} — Leader ทุกวัน · Supervisor รายสัปดาห์ · Manager รายเดือน · GM รายไตรมาส`}
        tabs={[
          { key: 'audit', label: '✅ บันทึกผลตรวจ' },
          { key: 'plan', label: '📅 แผนตรวจ' },
          { key: 'report', label: '📊 รายงาน' },
          canManage && { key: 'questions', label: '⚙️ คำถาม' },
        ]}
        tab={tab} onTab={setTab} />

      {selectorBar}

      {/* 🔒 ไลน์ที่เลือกอยู่นอกส่วนงานเรา — ดูได้ แต่บันทึกไม่ได้ · ซ่อนปุ่มได้ ห้ามซ่อนเหตุผล (UI §6.9) */}
      {!lineWrite.ok && selLine && (
        <div className="card" style={{ padding: '9px 12px', marginBottom: 10, fontSize: 12, color: 'var(--text2)',
          background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)' }}>
          🔒 {writeBlockText(lineWrite, { what: `ใบตรวจ/แผน LPA ของไลน์ "${selLine}"` })}
        </div>
      )}

      {/* ═════════ แผนตรวจ — มองทีละไตรมาส (3 เดือน) ═════════ */}
      {tab === 'plan' && (
        <div className="card" style={{ padding: 16 }}>
          {/* หัวไตรมาส + ปุ่มเลื่อนไตรมาส */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <button onClick={() => setSelMonth(shiftMonth(qMonths[0], -3))} style={btnGhost}>◀ ไตรมาสก่อน</button>
            <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>ไตรมาส Q{quarterOf(selMonth)} · {monthLabel(qMonths[0])} – {monthLabel(qMonths[2])}</div>
            <button onClick={() => setSelMonth(shiftMonth(qMonths[0], 3))} style={btnGhost}>ไตรมาสถัดไป ▶</button>
          </div>
          {qErr && (
            <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, fontSize: 12.5,
              background: 'var(--card)', border: '1px solid #ef4444', color: '#ef4444' }}>
              ⚠ {qErr} — ช่องที่วางแผนไว้แสดงเป็น <b>?</b> (ยังบอกไม่ได้ว่าตรวจแล้วหรือยัง) <b>อย่าเพิ่งพิมพ์ใบนี้ไปเซ็น</b>
            </div>
          )}
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 12 }}>
            {[['leader_name', 'Leader'], ['supervisor_name', 'Supervisor'], ['manager_name', 'Manager'], ['gm_name', 'GM Plant']].map(([k, label]) => (
              <div key={k}>
                <div style={lb}>{label}</div>
                {/* 4 ชั้นผู้ตรวจ = user ระบบ (พิมพ์ลง FM-QMR-008) — PersonSelect profiles แทน datalist ที่รับทุกสะกด (2026-09-07) */}
                <PersonSelect value={qHeader[k] || ''} history={layerHist[k]} onChange={r => setQHeaderF(k, r.name)} disabled={!canManage} placeholder={`เลือก ${label}…`} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
            <div style={{ flex: '1 1 340px' }}>
              <div style={lb}>รายชื่อสถานีตรวจ (Station for audit — บรรทัดละชื่อ หรือคั่นด้วย , · ดึงจากจุดงานในไลน์อัตโนมัติ แก้ไข/เพิ่มเองได้ · ใช้ทั้งไตรมาส)</div>
              <textarea rows={3} value={qHeader.stations || ''} onChange={e => setQHeaderF('stations', e.target.value)} disabled={!canManage}
                placeholder={'ปืนยิงBoat\nSTAMP MARK\nJig-01\nJig-02 ...'} style={{ width: '100%', fontSize: 13 }} />
            </div>
            {canManage && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={fillStationsFromWorkstations} style={btnTeal} title="ดึงรายชื่อจุดงานทั้งหมดในไลน์นี้ (รวมไลน์ย่อย) มาเป็นสถานีตรวจตั้งต้น — LPA ตรวจกระบวนการที่จุดงาน ไม่ใช่ทุกเครื่องจักร">📍 ดึงจุดงานในไลน์</button>
                <button onClick={autoFillQuarter} style={btnAmber} title="กระจายจุดงานให้ครบทุกจุดภายในแต่ละเดือน (Leader ทุกวัน · SV ต้นสัปดาห์ · MGR รายเดือน · GM รายไตรมาส)">⚡ เติมแผนทั้งไตรมาส</button>
                <button onClick={saveQuarter} disabled={savingPlan} style={btnAccent}>{savingPlan ? '⏳...' : '💾 บันทึกแผนไตรมาส'}</button>
                <button onClick={printPlan} disabled={printing} style={btnBlue} title={`พิมพ์ใบแผนของเดือน ${monthLabel(selMonth)} (บันทึกก่อนพิมพ์)`}>🖨️ พิมพ์ ({monthLabel(selMonth)})</button>
              </div>
            )}
            {!canManage && <button onClick={printPlan} disabled={printing} style={btnBlue}>🖨️ พิมพ์ ({monthLabel(selMonth)})</button>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            <span style={{ color: 'var(--text2)' }}>○ วางแผน</span> · <span style={{ color: '#22c55e' }}>● ตรวจแล้ว</span> · <span style={{ color: '#ef4444' }}>⊗ เลยกำหนดยังไม่ตรวจ</span> · แถวเขียว = วันหยุด · หลายสถานี/วัน = คั่นด้วย ,
          </div>

          {/* 3 เดือนของไตรมาส */}
          {qMonths.map(mk => {
            const nD = daysInMonth(mk);
            const isFocus = mk === selMonth;
            return (
              <div key={mk} style={{ marginTop: 12, border: isFocus ? '1px solid var(--accent)' : '1px solid var(--border2)', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '7px 12px', background: isFocus ? 'rgba(34,197,94,0.12)' : 'var(--bg3)', fontWeight: 800, fontSize: 14, color: isFocus ? 'var(--accent)' : 'var(--text)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  📅 {monthLabel(mk)}
                  {isFocus ? <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)' }}>(เดือนที่เลือก — ใช้พิมพ์/รายงาน)</span>
                    : <button onClick={() => setSelMonth(mk)} style={{ ...btnGhost, padding: '2px 8px', fontSize: 11 }}>เลือกเดือนนี้</button>}
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', minWidth: 720 }}>
                    <thead>
                      <tr style={{ fontSize: 12 }}>
                        <th style={{ width: 90 }}>วันที่</th>
                        <th style={{ textAlign: 'left' }}>Station for audit</th>
                        {LAYERS.map(l => <th key={l.key} style={{ width: 96, textAlign: 'center' }}>{l.label}<div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>{l.freq}</div></th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: nD }, (_, i) => i + 1).map(d => {
                        const dstr = dateOf(mk, d);
                        const holiday = isHoliday(dstr);
                        const pd = qData[mk]?.days?.[d] || {};
                        return (
                          <tr key={d} style={holiday ? { background: 'rgba(46,125,50,0.16)' } : undefined}>
                            <td style={{ whiteSpace: 'nowrap', fontSize: 12, fontWeight: 700, color: holiday ? '#4caf50' : 'var(--text)' }}>
                              {d} <span style={{ fontSize: 11, color: 'var(--muted)' }}>({DOW_TH[dowOf(dstr)]})</span>
                            </td>
                            <td>
                              {holiday ? <span style={{ fontSize: 11, color: '#4caf50' }}>วันหยุด</span> : (
                                <SelectOrFree value={pd.station || ''} onChange={v => setQDay(mk, d, { station: v })} disabled={!canManage} placeholder="— เลือกสถานี —" compact
                                  options={[...(qHeader.stations || '').split(/[\n,]+/), ...wsNames]} style={{ width: 'min(100%, 320px)' }} />
                              )}
                            </td>
                            {LAYERS.map(l => {
                              const s = qStatus(mk, d, l.key, l.planKey);
                              return (
                                <td key={l.key} style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                  {!holiday && (
                                    <label style={{ cursor: canManage ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                      <input type="checkbox" checked={!!pd[l.planKey]} disabled={!canManage}
                                        onChange={e => setQDay(mk, d, { [l.planKey]: e.target.checked })} style={{ width: 'auto' }} />
                                      {s && <span title={s.title} style={{ fontSize: 15, color: s.color, fontWeight: 700 }}>{s.sym}</span>}
                                    </label>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═════════ บันทึกผลตรวจ ═════════ */}
      {tab === 'audit' && (
        <div className="card" style={{ padding: 16 }}>
          {/* 🔴 โหลดใบเดิมไม่ได้ = บอกตรงๆ + ห้ามให้ฟอร์มเปล่าเดินต่อ (ห้ามเงียบ · กฎความซื่อสัตย์ของจอ) */}
          {draftErr && (
            <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, fontSize: 12.5,
              background: 'var(--card)', border: '1px solid #ef4444', color: '#ef4444' }}>
              ⚠ {draftErr} — <b>ยังบันทึกไม่ได้</b> (ถ้าบันทึกทับตอนนี้ คำตอบที่เคยตรวจไว้จะหาย) · ลองเปลี่ยนวัน/ไลน์แล้วกลับมาใหม่
            </div>
          )}
          <DraftRestoreBar draft={pendingDraft} what="ใบตรวจ LPA ชุดนี้" onRestore={restoreLpaDraft}
            onDiscard={() => { if (lpaDraftKey) clearDraft(lpaDraftKey); setPendingDraft(null); }} />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
            <div>
              <div style={lb}>วันที่ตรวจ</div>
              <input type="date" value={auditDate} onChange={e => e.target.value && setAuditDate(e.target.value)} style={{ width: 150, padding: '6px 10px', borderRadius: 7, fontSize: 13 }} />
            </div>
            <div>
              <div style={lb}>ชั้นผู้ตรวจ (Layer)</div>
              <select value={auditLayer} onChange={e => setAuditLayer(e.target.value)} style={{ width: 190, padding: '7px 10px', borderRadius: 7, fontSize: 13 }}>
                {LAYERS.map(l => <option key={l.key} value={l.key}>{l.label} · {l.freq}</option>)}
              </select>
            </div>
            <div>
              <div style={lb}>Station ที่ตรวจ</div>
              {/* สถานีจากแผนเดือนนี้ ∪ จุดงานในผังไลน์ + ระบุเอง (lpa_audits.station เดิมพิมพ์เอง · 2026-09-07) */}
              <SelectOrFree value={draft?.station || ''} onChange={v => setDraft(prev => ({ ...prev, station: v }))} placeholder="— เลือกสถานี —" compact
                options={[...auditPlanStations, ...wsNames]} style={{ width: 190, padding: '6px 10px', borderRadius: 7, fontSize: 13 }} />
            </div>
            <div>
              <div style={lb}>ผู้ตรวจ</div>
              {/* ผู้ตรวจจาก profiles → ลายเซ็นตามคนที่เลือก (ไม่ใช่แค่โปรไฟล์ตัวเอง) · พิมพ์เองยังได้ (2026-09-07) */}
              <PersonSelect value={draft?.auditor_name || ''} history={auditorHist} style={{ width: 200 }}
                onChange={r => setDraft(prev => ({ ...prev, auditor_name: r.name, auditor_sig_url: r.kind === 'free' ? prev?.auditor_sig_url || null : (r.signature_url || null) }))} />
            </div>
            <div>
              <div style={lb}>ลายเซ็น</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {draft?.auditor_sig_url
                  ? <img src={draft.auditor_sig_url} alt="" style={{ height: 30, background: '#fff', borderRadius: 4, padding: 2 }} />
                  : <span style={{ fontSize: 11, color: 'var(--muted)' }}>ยังไม่มี</span>}
                {canRecord && <button onClick={() => setShowSignPad(true)} style={{ ...btnGray, padding: '5px 10px', fontSize: 12 }}>✍️ เซ็นใหม่</button>}
              </div>
            </div>
          </div>

          {draft?.id && (
            <div style={{ fontSize: 12, color: '#22c55e', marginBottom: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              ✅ วันนี้บันทึกผลตรวจชั้นนี้ไว้แล้ว — แก้ไขแล้วกดบันทึกทับได้
              {mayDelete && <button onClick={deleteAudit} style={{ ...btnGray, color: '#ef4444', border: '1px solid rgba(239,68,68,0.4)', fontSize: 12, padding: '4px 10px' }}>🗑 ลบผลตรวจนี้</button>}
            </div>
          )}

          {canRecord && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <button onClick={setAllY} style={btnGray}>✔ ข้อที่ยังไม่ตอบ = Y ทั้งหมด</button>
              <div style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
                ตอบแล้ว {auditQuestions.filter(q => draft?.answers[q.id]?.answer).length}/{auditQuestions.length} ข้อ · N/T ต้องกรอกรายละเอียดปัญหา
              </div>
            </div>
          )}

          {CATEGORIES.map(cat => {
            const catQs = auditQuestions.filter(q => q.category === cat.key);
            if (!catQs.length) return null;
            return (
              <div key={cat.key} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: cat.key === 'special' ? '#ef4444' : 'var(--text)', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>{cat.full}</div>
                {catQs.map(q => {
                  const a = draft?.answers[q.id];
                  return (
                    <div key={q.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px dashed var(--border)', flexWrap: 'wrap' }}>
                      <div style={{ flex: '1 1 380px', fontSize: 13, color: cat.key === 'special' ? '#f87171' : 'var(--text)' }}>
                        <b>{q.seq}.</b> {q.question}
                        {q.category === 'special' && (q.issue_start || q.issue_end) && (
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}> (เฝ้าระวัง {thDate(q.issue_start)} - {thDate(q.issue_end)})</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 5, ...(isMobile ? { flex: '1 1 100%' } : null) }}>
                        {ANSWERS.map(an => (
                          <button key={an.key} disabled={!canRecord} onClick={() => setAnswer(q.id, an.key)}
                            style={{
                              ...(isMobile ? { flex: 1, minHeight: 44 } : null),
                              minWidth: 40, padding: '6px 8px', borderRadius: 7, fontWeight: 800, fontSize: 13, cursor: canRecord ? 'pointer' : 'default',
                              border: '1.5px solid ' + (a?.answer === an.key ? an.color : 'var(--border2)'),
                              background: a?.answer === an.key ? an.color : 'var(--bg3)',
                              color: a?.answer === an.key ? '#fff' : 'var(--text2)',
                            }} title={an.desc}>{an.label}</button>
                        ))}
                      </div>
                      {['N', 'T'].includes(a?.answer) && (
                        <input type="text" value={a?.note || ''} onChange={e => setAnsNote(q.id, e.target.value)} disabled={!canRecord}
                          placeholder="รายละเอียดปัญหา / เงื่อนไข (บังคับ)" style={{ flex: '1 1 240px', fontSize: 12, padding: '6px 8px', border: '1px solid ' + ansMeta(a.answer).color, borderRadius: 7 }} />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* 📦 ข้อที่ตรวจไปแล้ว แต่วันนี้ไม่อยู่ในเช็คลิสต์ (ถูกลบ/ปิดใช้/ซ่อนไลน์ทีหลัง)
              🔴 ห้ามซ่อน — ใบที่บันทึกแล้วต้องอ่านได้ครบตามที่ตรวจจริง ไม่งั้นใบเก่าดูเหมือนตรวจน้อยข้อ
                 (เคส 12/10: ลบข้อ common 2 ข้อ ⇒ คำตอบกำพร้า 2,444 แถว ใน 581 ใบ หายจากจอทันที)
              อ่านอย่างเดียว: ข้อถูกถอดไปแล้ว แก้คำตอบไม่ได้ แต่ข้อความ/คำตอบเดิมยังอยู่ครบ */}
          {removedAnswers.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                📦 ข้อที่ถอดออกจากเช็คลิสต์แล้ว — เก็บไว้จากตอนตรวจ ({removedAnswers.length} ข้อ)
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', padding: '4px 0' }}>
                ข้อเหล่านี้ถูกลบ/ปิดใช้งาน/ซ่อนของไลน์นี้ไปหลังวันที่ตรวจ — แสดงไว้ให้ใบตรวจอ่านครบตามที่ตรวจจริง (แก้ไม่ได้)
              </div>
              {removedAnswers.map(a => {
                const m = ansMeta(a.answer);
                return (
                  <div key={a.question_id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px dashed var(--border)', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 380px', fontSize: 13, color: 'var(--text2)' }}>
                      {a.question_text || <i style={{ color: 'var(--muted)' }}>(ไม่ได้เก็บข้อความคำถามไว้)</i>}
                      {a.note && <div style={{ fontSize: 11, color: 'var(--muted)' }}>↳ {a.note}</div>}
                    </div>
                    <span style={{
                      minWidth: 40, textAlign: 'center', padding: '6px 8px', borderRadius: 7, fontWeight: 800, fontSize: 13,
                      border: '1.5px solid ' + (m?.color || 'var(--border2)'), background: m?.color || 'var(--bg3)', color: m ? '#fff' : 'var(--text2)',
                    }}>{m?.label || a.answer || '-'}</span>
                  </div>
                );
              })}
            </div>
          )}

          {canRecord && !isMobile && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              <button onClick={saveAudit} disabled={savingAudit} style={{ ...btnAccent, padding: '10px 26px' }}>
                {savingAudit ? '⏳ กำลังบันทึก...' : '💾 บันทึกผลตรวจ'}
              </button>
            </div>
          )}
          {/* 📱 มือถือ: ปุ่มบันทึกเกาะล่างจอ + บอกว่าตอบไปกี่ข้อ (ข้อเยอะ ปุ่มท้ายฟอร์มอยู่ไกลหลายจอ) */}
          {canRecord && isMobile && (
            <div className="m-savebar">
              <span className="m-savebar-sum">ตอบแล้ว {auditQuestions.filter(q => draft?.answers[q.id]?.answer).length}/{auditQuestions.length} ข้อ</span>
              <button type="button" onClick={saveAudit} disabled={savingAudit}>{savingAudit ? '⏳ กำลังบันทึก...' : '💾 บันทึกผลตรวจ'}</button>
            </div>
          )}
          {!canRecord && <div style={{ fontSize: 12, color: 'var(--muted)' }}>คุณมีสิทธิ์ดูอย่างเดียว (บันทึกผลได้เฉพาะ role ที่มีสิทธิ์ lpa:record)</div>}
        </div>
      )}

      {/* ═════════ รายงาน ═════════ */}
      {tab === 'report' && (() => {
        const qs = questionsForMonth(selLine, selMonth);
        const leaderAud = {}; daysArr.forEach(d => { leaderAud[d] = auditFor(dateOf(selMonth, d), 'leader'); });
        const svAud = [1, 2, 3, 4].map(w => monthAudits.find(a => a.layer === 'supervisor' && weekOfDay(Number(a.audit_date.slice(8, 10))) === w));
        const mgrAud = monthAudits.find(a => a.layer === 'manager');
        const gmAud = monthAudits.find(a => a.layer === 'gm');
        const cellStyle = { border: '1px solid var(--border)', textAlign: 'center', fontSize: 11, minWidth: 24, padding: '2px 1px' };
        const ansTd = (audit, qid, extra = {}, key) => {
          const a = answerOf(audit, qid);
          const m = a?.answer ? ansMeta(a.answer) : null;
          return <td key={key} style={{ ...cellStyle, color: m?.color || 'var(--muted)', fontWeight: a?.answer && a.answer !== 'Y' ? 800 : 500, ...extra }} title={a?.note || ''}>{a?.answer === 'NA' ? 'N/A' : a?.answer || ''}</td>;
        };
        /* 🔴 ช่องว่างในตารางนี้เคยปน 4 ความหมาย — แยกให้ชัดตาม `utils/dailyCheckDay.js` (13/10)
           · ชั้นที่ตรวจ "ทุกวัน" คือ leader ⇒ สถานะรายวันตัดสินจากใบของ leader
           · ไม่มีแผนของเดือนนี้เลย = บอกไม่ได้ว่าวันไหนต้องตรวจ ⇒ ถือว่า `not_planned` ทั้งเดือน
             แล้วขึ้นแถบบอก (เดาเป็น "ต้องตรวจทุกวัน" = ทาแดงทั้งเดือนให้ไลน์ที่ยังไม่ได้วางแผน) */
        const todayStr = getWorkDate();
        const dayStateOf = (d) => {
          const ds = dateOf(selMonth, d);
          /* 🔴 อ่านใบ/แผนของเดือนไม่ได้ = ส่ง `planned`/`ran` เป็น null ⇒ `checkDayState` คืน `unknown`
             (วันหยุด/วันอนาคตยังรู้อยู่ จึงปล่อยให้ตัดสินตามเดิม) — ห้ามกลายเป็น "ขาดตรวจ" */
          return checkDayState({
            hasResult: monthErr ? false : !!leaderAud[d],
            isFuture:  ds > todayStr,
            isOff:     isHoliday(ds),
            planned:   monthErr ? null : (plan ? !!planDays[d]?.plan_leader : false),
            ran:       monthErr ? null : ranOn(runs, ds, selShift),
          });
        };
        const dayStates = daysArr.map(dayStateOf);
        const sum = summarizeCheckDays(dayStates);

        const issues = [];
        monthAudits.forEach(a => (a.lpa_audit_answers || []).forEach(x => { if (['N', 'T'].includes(x.answer)) issues.push({ date: a.audit_date, layer: a.layer, q: x.question_text, ans: x.answer, note: x.note }); }));
        issues.sort((a, b) => a.date.localeCompare(b.date));
        return (
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                ตรวจแล้วเดือนนี้: <b style={{ color: 'var(--text)' }}>{monthAudits.length}</b> ครั้ง
                (Leader {monthAudits.filter(a => a.layer === 'leader').length} · SV {monthAudits.filter(a => a.layer === 'supervisor').length} · MGR {monthAudits.filter(a => a.layer === 'manager').length} · GM {monthAudits.filter(a => a.layer === 'gm').length})
                {issues.length > 0 && <span style={{ color: '#ef4444', fontWeight: 700 }}> · พบปัญหา N/T {issues.length} รายการ</span>}
                {/* 🔴 "ตรวจแล้ว N ครั้ง" ลอยๆ ตอบไม่ได้ว่าขาดกี่วัน — ต้องมีตัวหาร (ดู utils/dailyCheckDay.js) */}
                <div style={{ marginTop: 3, fontSize: 12, color: sum.missed ? 'var(--red)' : 'var(--muted)' }}>
                  {checkDaysNote(sum)}{sum.pct != null && <> · ความครบ <b>{sum.pct}%</b></>}
                </div>
                {monthErr && (
                  <div style={{ marginTop: 3, fontSize: 11.5, color: '#ef4444', fontWeight: 700 }}>
                    ⚠ {monthErr} — ตารางเดือนนี้แสดงเป็น "ไม่รู้" ทั้งเดือน (ไม่ได้แปลว่าขาดตรวจ)
                  </div>
                )}
                {!plan && !monthErr && (
                  <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--amber)' }}>
                    ⚠️ เดือนนี้ยังไม่มีแผนตรวจของ {selLine} ({SHIFT_META[selShift]}) — บอกไม่ได้ว่าวันไหนต้องตรวจ
                    จึงยังไม่นับวันขาดตรวจ · ไปตั้งที่แท็บ <b>แผนตรวจ</b>
                  </div>
                )}
              </div>
              <button onClick={printReport} disabled={printing} style={btnBlue}>{printing ? '...' : `🖨️ พิมพ์รายงาน ${lpaFormCode}`}</button>
            </div>
            {/* 🔴 คำอธิบายสัญลักษณ์ 2 ชุด แยกให้เห็นว่าเป็นคนละชั้นข้อมูล (คำสั่ง user 13/10)
                — "คำตอบ" = ไปตรวจแล้วเจออะไร · "สถานะวัน" = วันนั้นต้องตรวจไหม/มีใครไปตรวจไหม */}
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
              <span>
                <b style={{ color: 'var(--text2)' }}>คำตอบในช่อง:</b>{' '}
                {ANSWERS.map(a => (
                  <span key={a.key} style={{ marginRight: 8 }}>
                    <b style={{ color: a.color }}>{a.label}</b> {a.desc.replace(/\s*\(.*\)$/, '')}
                  </span>
                ))}
              </span>
              <span style={{ borderLeft: '1px solid var(--border)', paddingLeft: 14 }}>
                <b style={{ color: 'var(--text2)' }}>สถานะวัน (แถวบนสุด):</b>{' '}
                {CHECK_DAY_LEGEND.map(k => {
                  const m = CHECK_DAY_META[k];
                  return (
                    <span key={k} style={{ marginRight: 8 }}>
                      <span style={{ display: 'inline-block', padding: '0 3px', borderRadius: 4, border: `1px solid ${m.color}`, background: m.tint || undefined, color: m.color, fontWeight: 700 }}>{m.mark}</span>{' '}
                      {m.label}
                    </span>
                  );
                })}
                · <span style={{ display: 'inline-block', width: 11, height: 11, background: 'rgba(46,125,50,0.25)', border: '1px solid var(--border)', verticalAlign: -1 }} /> วันหยุดโรงงาน
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: 1100 }}>
                <thead>
                  <tr style={{ fontSize: 11 }}>
                    <th style={{ ...cellStyle, minWidth: 40 }}>ข้อ</th>
                    <th style={{ ...cellStyle, minWidth: 260, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--card)', zIndex: 2 }}>Audit Checklist / Question</th>
                    {daysArr.map(d => <th key={d} style={{ ...cellStyle, background: isHoliday(dateOf(selMonth, d)) ? 'rgba(46,125,50,0.25)' : undefined }}>{d}</th>)}
                    {[1, 2, 3, 4].map(w => <th key={w} style={{ ...cellStyle, background: 'rgba(34,197,94,0.15)' }}>W{w}</th>)}
                    <th style={{ ...cellStyle, background: 'rgba(148,163,184,0.15)' }}>M</th>
                    <th style={{ ...cellStyle, background: 'rgba(245,158,11,0.15)' }}>Q</th>
                  </tr>
                  {/* 🔴 แถว "สถานะวัน" — ตอบให้ได้ว่าช่องว่างข้างล่างแปลว่าอะไร
                      (ขาด = ต้องตรวจแต่ไม่ได้ตรวจ · NP = ไม่ได้เปิดกะ/ไม่ได้ผลิต · ? = ไม่รู้ว่าผลิตไหม
                       · · = ไม่มีแผนตรวจวันนั้น · ว่าง = ตรวจแล้ว ให้ดูคำตอบข้างล่าง)
                      🔴 ห้ามใช้ ✗ / – / N/A — ชนพจนานุกรมคำตอบ (ดูกฎข้อ 4 ใน utils/dailyCheckDay.js)
                      กันอ่านสลับ 3 ชั้น: คำย่อไม่ซ้ำคำตอบ + ใส่กรอบ chip (คำตอบไม่มีกรอบ)
                      + ทา `tint` ทั้งคอลัมน์ (คำตอบไม่เคยทาทั้งคอลัมน์) */}
                  <tr style={{ fontSize: 11 }}>
                    <th style={{ ...cellStyle, minWidth: 40 }} />
                    <th style={{ ...cellStyle, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--card)', zIndex: 2, fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
                      สถานะวัน
                    </th>
                    {daysArr.map((d, i) => {
                      const st = dayStates[i];
                      const meta = CHECK_DAY_META[st];
                      return (
                        <th key={d} title={meta.label}
                          style={{ ...cellStyle, fontSize: 11, fontWeight: 700, color: meta.color,
                            padding: '3px 1px', background: meta.tint || undefined }}>
                          {meta.mark && (
                            <span style={{ display: 'inline-block', padding: '0 3px', borderRadius: 4,
                              border: `1px solid ${meta.color}`, lineHeight: '14px', fontSize: 11 }}>{meta.mark}</span>
                          )}
                        </th>
                      );
                    })}
                    {[1, 2, 3, 4].map(w => <th key={w} style={cellStyle} />)}
                    <th style={cellStyle} /><th style={cellStyle} />
                  </tr>
                </thead>
                <tbody>
                  {CATEGORIES.map(cat => {
                    const catQs = qs.filter(q => q.category === cat.key);
                    if (!catQs.length) return null;
                    return [
                      <tr key={cat.key + '_h'}><td colSpan={2 + nDays + 6} style={{ ...cellStyle, textAlign: 'left', fontWeight: 800, fontSize: 12, color: cat.key === 'special' ? '#ef4444' : 'var(--text)', background: 'var(--bg3)' }}>{cat.full}</td></tr>,
                      ...catQs.map(q => (
                        <tr key={q.id}>
                          <td style={cellStyle}>{q.seq}</td>
                          <td style={{ ...cellStyle, textAlign: 'left', fontSize: 12, color: cat.key === 'special' ? '#f87171' : 'var(--text2)', position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 }}>{q.question}</td>
                          {daysArr.map((d, di) => isHoliday(dateOf(selMonth, d))
                            ? <td key={d} style={{ ...cellStyle, background: 'rgba(46,125,50,0.25)' }}></td>
                            : ansTd(leaderAud[d], q.id, { background: CHECK_DAY_META[dayStates[di]].tint || undefined }, d))}
                          {svAud.map((a, i) => ansTd(a, q.id, { background: 'rgba(34,197,94,0.1)' }, 'w' + i))}
                          {ansTd(mgrAud, q.id, { background: 'rgba(148,163,184,0.1)' })}
                          {ansTd(gmAud, q.id, { background: 'rgba(245,158,11,0.1)' })}
                        </tr>
                      )),
                    ];
                  })}
                </tbody>
              </table>
            </div>
            {issues.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#ef4444', marginBottom: 6 }}>🚩 บันทึกปัญหาที่พบ (N / T)</div>
                {issues.map((i, idx) => (
                  <div key={idx} style={{ fontSize: 12, color: 'var(--text2)', padding: '4px 0', borderBottom: '1px dashed var(--border)' }}>
                    <b style={{ color: ansMeta(i.ans).color }}>[{i.ans}]</b> {thDate(i.date)} · {i.q} — <b style={{ color: 'var(--text)' }}>{i.note || '-'}</b>
                    <span style={{ color: 'var(--muted)' }}> ({LAYERS.find(l => l.key === i.layer)?.label})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ═════════ คำถาม master — จัดการรายไลน์ (common = ฐาน backfall) ═════════ */}
      {tab === 'questions' && canManage && (
        <div className="card" style={{ padding: 16 }}>
          {/* เลือกขอบเขต: ทุกไลน์ (common) หรือรายไลน์ */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
            <div>
              <div style={lb}>จัดการคำถามของ</div>
              <LineSelect lines={visibleLines} value={qScope} onChange={(v) => { setQScopePicked(true); setQScope(v); }} style={{ minWidth: 220 }}
                placeholder="🌐 ทะเบียนกลาง (ใช้ร่วมทุกไลน์)" />
            </div>
            <button
              onClick={() => setQEditing({ category: 'safety', seq: (Math.max(0, ...questions.map(q => q.seq)) + 1), question: '', line_name: qScope || '', issue_start: '', issue_end: '', is_active: true })}
              style={btnAccent}>➕ เพิ่มคำถาม{qScope ? ` (เฉพาะไลน์ ${qScope})` : ' (เข้าทะเบียนกลาง — ทุกไลน์เห็น)'}</button>
          </div>
          {/* 🔴 ป้าย "ตอนนี้คุณกำลังแก้ของใคร" — ห้ามถอด (2026-10-12 · feedback user)
              เคสจริง: มีคนกดลบข้อ common 2 ข้อจากมุมมอง "ทุกไลน์" ⇒ หายจากใบตรวจทุกไลน์
              จอเดิมบอกขอบเขตด้วยตัวเล็กสีเทาบรรทัดเดียว คนอ่านผ่าน = นึกว่าลบแค่ของตัวเอง */}
          <div style={{
            marginBottom: 10, padding: '8px 11px', borderRadius: 8, lineHeight: 1.55, fontSize: 12,
            border: '1px solid ' + (qScope ? 'var(--accent)' : '#f59e0b'),
            background: qScope ? 'var(--accent-dim)' : 'rgba(245,158,11,0.12)',
          }}>
            {qScope ? (
              <>
                <b style={{ fontSize: 13, color: 'var(--accent)' }}>🏭 กำลังแก้หัวข้อตรวจของไลน์ "{qScope}"</b>
                <div style={{ color: 'var(--text2)', marginTop: 2 }}>
                  ข้อที่ติดป้าย <b>🌐 ทะเบียนกลาง</b> = ของส่วนรวม แก้เนื้อหา/ลบที่นี่ไม่ได้ —
                  ไม่อยากใช้ข้อไหนที่ไลน์นี้ กด <b>ไม่ใช้ที่ไลน์นี้</b> (ไลน์อื่นไม่กระทบ) ·
                  ข้อที่ติดป้าย <b>เฉพาะไลน์นี้</b> เป็นของไลน์คุณเอง เพิ่ม/แก้/ลบได้เต็มที่
                </div>
                {qScopeStats && (
                  <div style={{ marginTop: 5, fontSize: 12, color: 'var(--text)' }}>
                    เช็คลิสต์ของไลน์นี้ = <b>ดึงจากทะเบียนกลาง {qScopeStats.used}</b>
                    {qScopeStats.off > 0 && <span style={{ color: 'var(--muted)' }}> (ปิดไว้ {qScopeStats.off})</span>}
                    {' '}+ <b>ของไลน์นี้เอง {qScopeStats.own}</b> = <b>{qScopeStats.used + qScopeStats.own} ข้อ</b>
                  </div>
                )}
              </>
            ) : (
              <>
                <b style={{ fontSize: 13, color: '#f59e0b' }}>🌐 กำลังแก้ “ทะเบียนกลาง” — ทุกไลน์ใช้ร่วมกัน</b>
                <div style={{ color: 'var(--text2)', marginTop: 2 }}>
                  แก้/ลบที่นี่ <b>กระทบใบตรวจของทุกไลน์พร้อมกัน</b> ·
                  ถ้าจะเพิ่ม/เอาออกเฉพาะแผนกตัวเอง ให้เลือกไลน์จากช่อง “จัดการคำถามของ” ด้านบนก่อน ·
                  ข้อที่เคยถูกตรวจไปแล้ว <b>ลบไม่ได้</b> (ใบย้อนหลังจะอ่านไม่ครบ) ให้กด ⏸ ปิดใช้งานแทน
                </div>
              </>
            )}
          </div>
          {CATEGORIES.map(cat => {
            // ทุกไลน์: เฉพาะ common (null) · รายไลน์: common (null) + ของไลน์นั้น
            const catQs = questions.filter(q => q.category === cat.key && (qScope ? (!q.line_name || q.line_name === qScope) : !q.line_name)).sort((a, b) => a.seq - b.seq);
            if (!catQs.length) return null;
            return (
              <div key={cat.key} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: cat.key === 'special' ? '#ef4444' : 'var(--text)', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>{cat.full}</div>
                {catQs.map(q => {
                  const isCommon = !q.line_name;
                  const hiddenHere = qScope && isCommon && (q.hidden_for_lines || []).includes(qScope);
                  const lineOwn = qScope && !isCommon; // ข้อเฉพาะไลน์ที่กำลังดู
                  return (
                    <div key={q.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px dashed var(--border)', opacity: (q.is_active && !hiddenHere) ? 1 : 0.45 }}>
                      <div style={{ flex: 1, fontSize: 13, color: cat.key === 'special' ? '#f87171' : 'var(--text2)' }}>
                        <b>{q.seq}.</b> {q.question}
                        {/* ป้ายขอบเขตต้องขึ้น**ทั้ง 2 มุมมอง** — เดิมมุมมอง "ทุกไลน์" ไม่มีป้ายเลย
                            คนกดจึงไม่รู้ว่าแถวที่กำลังลบเป็นของส่วนรวม (เคส 12/10) */}
                        {isCommon && <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', background: 'rgba(245,158,11,0.12)', border: '1px solid #f59e0b', borderRadius: 4, padding: '0 5px', marginLeft: 6 }}>🌐 ทะเบียนกลาง</span>}
                        {lineOwn && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid var(--accent)', borderRadius: 4, padding: '0 5px', marginLeft: 6 }}>เฉพาะไลน์นี้</span>}
                        {!qScope && q.line_name && <span style={{ fontSize: 11, color: 'var(--muted)' }}> · ไลน์ {q.line_name}</span>}
                        {(q.issue_start || q.issue_end) && <span style={{ fontSize: 11, color: 'var(--muted)' }}> · {thDate(q.issue_start)} - {thDate(q.issue_end)}</span>}
                        {hiddenHere && <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444' }}> · 🚫 ไลน์นี้ไม่ใช้ข้อนี้</span>}
                        {!q.is_active && <span style={{ fontSize: 11, color: '#ef4444' }}> · ปิดใช้งาน</span>}
                      </div>
                      {qScope && isCommon ? (
                        // ข้อ common ในมุมมองรายไลน์ → ซ่อน/แสดงเฉพาะไลน์นี้ (แก้เนื้อหาไปทำที่ "ทุกไลน์")
                        /* ป้ายปุ่มต้องบอก "ผลที่จะเกิด" ไม่ใช่ศัพท์ซ่อน/แสดง — คนอ่านแล้วนึกว่าซ่อนจากทุกคน */
                        <button className="tbtn" onClick={() => toggleHideForLine(q, qScope)}
                          title={hiddenHere ? `เอาข้อนี้กลับมาใช้ที่ไลน์ ${qScope}` : `เลิกใช้ข้อนี้เฉพาะไลน์ ${qScope} (ไลน์อื่นและทะเบียนกลางไม่กระทบ)`}
                          style={{ ...btnGray, color: hiddenHere ? 'var(--accent)' : '#ef4444', padding: '4px 10px', fontSize: 12, whiteSpace: 'nowrap' }}>
                          {hiddenHere ? '✓ ใช้ที่ไลน์นี้' : '🚫 ไม่ใช้ที่ไลน์นี้'}
                        </button>
                      ) : (
                        // ข้อ common (มุมมองทุกไลน์) หรือข้อเฉพาะไลน์ → แก้/ปิด/ลบเต็มที่
                        <>
                          <button className="tbtn" onClick={() => setQEditing({ ...q })} style={{ ...btnGray, padding: '4px 10px', fontSize: 12 }}>✏️</button>
                          <button className="tbtn" onClick={() => toggleQuestion(q)} style={{ ...btnGray, padding: '4px 10px', fontSize: 12 }}>{q.is_active ? '⏸' : '▶'}</button>
                          <DeleteButton onClick={() => deleteQuestion(q)} disabled={qBusy} title={q.line_name ? `ลบข้อเฉพาะไลน์ ${q.line_name}` : 'ลบข้อของส่วนรวม (ทุกไลน์)'} />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* modal แก้คำถาม (มีฟอร์ม — ไม่ปิดจาก backdrop) */}
      {qEditing && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, width: 'min(96vw, 640px)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{qEditing.id ? '✏️ แก้ไข' : '➕ เพิ่ม'}คำถาม</div>
              <button onClick={() => setQEditing(null)} style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 10 }}>
                <div>
                  <div style={lb}>หมวด</div>
                  <select value={qEditing.category} onChange={e => setQEditing(p => ({ ...p, category: e.target.value }))} style={{ width: '100%' }}>
                    {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.full}</option>)}
                  </select>
                </div>
                <div><div style={lb}>ลำดับ</div><input type="number" value={qEditing.seq} onChange={e => setQEditing(p => ({ ...p, seq: e.target.value }))} style={{ width: '100%' }} /></div>
              </div>
              <div><div style={lb}>คำถาม</div><textarea rows={2} value={qEditing.question} onChange={e => setQEditing(p => ({ ...p, question: e.target.value }))} style={{ width: '100%', fontSize: 13 }} /></div>
              <div>
                <div style={lb}>ใช้กับไลน์ (เว้นว่าง = ทุกไลน์)</div>
                <LineSelect lines={visibleLines} value={qEditing.line_name || ''} placeholder={ALL.line} style={{ width: '100%' }}
                  onChange={v => setQEditing(p => ({ ...p, line_name: v }))} />
              </div>
              {qEditing.category === 'special' && (
                <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div><div style={lb}>เฝ้าระวังตั้งแต่ (Issue Date)</div><input type="date" value={qEditing.issue_start || ''} onChange={e => setQEditing(p => ({ ...p, issue_start: e.target.value }))} style={{ width: '100%' }} /></div>
                  <div><div style={lb}>ถึงวันที่</div><input type="date" value={qEditing.issue_end || ''} onChange={e => setQEditing(p => ({ ...p, issue_end: e.target.value }))} style={{ width: '100%' }} /></div>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button onClick={() => setQEditing(null)} style={btnGray}>ยกเลิก</button>
                <button onClick={saveQuestion} style={btnAccent}>💾 บันทึก</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSignPad && <SignPadModal title={`${draft?.auditor_name || ''} — เซ็นผู้ตรวจ`} onCancel={() => setShowSignPad(false)} onDone={handleSignDone} />}
    </Page>
  );
}

const lb = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 };
const btnGray = { padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 };
const btnAccent = { padding: '7px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 700, cursor: 'pointer', fontSize: 13 };
const btnAmber = { padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.12)', color: '#f59e0b', fontWeight: 700, cursor: 'pointer', fontSize: 13 };
const btnBlue = { padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(77,159,255,0.35)', background: 'rgba(77,159,255,0.12)', color: '#4d9fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 };
const btnTeal = { padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(45,212,191,0.4)', background: 'rgba(45,212,191,0.12)', color: '#2dd4bf', fontWeight: 700, cursor: 'pointer', fontSize: 13 };
const btnGhost = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', fontWeight: 700, cursor: 'pointer', fontSize: 12 };
