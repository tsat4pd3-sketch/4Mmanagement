/* MtnRepair — ใบแจ้งซ่อม MO (Maintenance Order) 7 ขั้น
   Clone จากระบบ AppSheet เดิม (Jig MTN) มาอยู่ใน ESM · ข้อมูลอยู่ DR project (supabaseDR = anon)
   ครอบคลุมทุกทีมซ่อม: PRODUCTION(Autonomous)/JIG MTN/DIE MTN/MTN
   Workflow: 1 แจ้งซ่อม → 2 รับ/จ่ายงาน(ออกเลข MO) → 3 ซ่อม → 4 ตรวจ → 5 คุณภาพ(เฉพาะงานคุณภาพ)
             → 6 รับมอบ/ติดตาม → 7 อนุมัติปิด (Close MO)
   สิทธิ์ (role_permissions): mtn_repair:report/service/qa/approve/manage_master · ดู docs/PERMISSIONS-DESIGN.md */
import { useState, useEffect, useContext, useMemo, useRef, useCallback } from 'react';
import resizeImg from '../utils/resizeImage';
import { useObjectUrl } from '../utils/useObjectUrl';
import { useNavigate } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { PURPOSES, CAUSE_CATS, needsPlantManager, needsApprovalFirst, laborAmount, partAmount, sumLabor, sumParts, grandTotal, satScore, mtnApprovalState, purposeOfPrint, qaAppliesTo, QA_SKIP_REASON_PURPOSE } from '../utils/mtnMoForm';
import AuditLogViewer from '../components/AuditLogViewer';
import { can, canDelete, isActionSeeded } from '../utils/permissions';
import { MO_STATUS_LABEL, QA_NOT_RELATED, QA_RELATED, QA_SKIP_REASON_STEP4, canBounceBack, canDoStep, canHandoff, canSignMtnApproval, canSkipQa, isMoOpen, isOrderReporter, isQaSkipped, isWaitingQa, moQaState, moStatusLabel, orderInReporterScope, stepDenyHint, stepLabel, stepMeta } from '../utils/mtnStepPerm';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { teamsForUser, teamForSection, teamForItem, sameTeam, filterByTeam, visibleForTeam, seesEverything, teamKeyOf, deptNameOf, teamOptions } from '../utils/mtnTeams';
import { loadPmTeams, pmTeamsSync, DEFAULT_TEAMS } from '../utils/pmTeams';
import { loadDocForms, docFormSync } from '../utils/docForms';
loadDocForms(); // ทะเบียนเอกสาร — printMoReport (sync) อ่านผ่าน docFormSync
import { fmtDateTime } from '../utils/dateFormat';
import tsLogo from '../assets/TS logo.png';
import EventComments from '../components/EventComments';
import ScanModal from '../components/ScanModal';
import { resolveMachine } from '../utils/qrCode';
import { isDie } from '../utils/equipmentKinds';
import SparePartMaster from '../components/SparePartMaster';
import RackMap from '../components/RackMap';
import MachineReliability from '../components/MachineReliability';
import ParetoAbcChart from '../components/ParetoAbcChart';
import PageHeader from '../components/PageHeader';
import useTabParam from '../utils/useTabParam';

import InfoMore from '../components/InfoMore';
import SearchSelect from '../components/SearchSelect';
// picker กลาง (single-source audit 2026-09-07) — ไลน์/เครื่อง/คน/ลูกค้า อ่านจากทะเบียน ห้ามพิมพ์เองเงียบๆ
import LineSelect from '../components/LineSelect';
import MachineSelect from '../components/MachineSelect';
import PersonSelect from '../components/PersonSelect';
import CustomerSelect from '../components/CustomerSelect';
import { useOrgSections, useOrgDepts } from '../utils/useOrgSections';
import useColumnHistory from '../utils/useColumnHistory'; // 📜 ค่าที่เคยบันทึกใน mtn_orders — ทะเบียนไม่มีก็ยังเลือกซ้ำได้ (2026-09-07)
import { LINE_COLUMNS } from '../utils/useProductionLines';
import { liveChannel } from '../utils/liveChannel';
import { LIVE } from '../utils/refreshRates';
import { coalesce } from '../utils/liveRefresh';
import { checkWrite } from '../utils/dbWrite';
import { uploadOpts } from '../utils/storageUpload';
/* ── helpers ─────────────────────────────────────────────── */
// แปลง URL โลโก้ (รวมโลโก้ที่ admin อัปโหลดใน /doc-forms) เป็น dataURL เพื่อฝังในหน้าพิมพ์
// (โลโก้ต่าง origin เช่น Supabase Storage จะพิมพ์ไม่ติดถ้าใช้ <img src=url> ตรงๆ)
async function logoDataUrl(overrideUrl) {
  const url = overrideUrl || (/^https?:/.test(tsLogo) ? tsLogo : location.origin + tsLogo);
  try {
    const res = await fetch(url); const blob = await res.blob();
    return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  } catch { return /^https?:/.test(tsLogo) ? tsLogo : location.origin + tsLogo; }
}

// บีบรูปก่อนอัปโหลด — ตัวจริงอยู่ src/utils/resizeImage.js (ห้ามก๊อปโค้ดบีบรูปซ้ำอีก)
const resizeImage = (file, maxPx = 1024, quality = 0.8) => resizeImg(file, maxPx, quality);
const getWorkDate = () => {
  const now = new Date();
  if (now.getHours() < 8) now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
// ค่า max ของ input datetime-local (เวลาเครื่อง ไม่ใช่ UTC — ห้ามใช้ toISOString ตัด)
/** ISO → ค่าที่ <input type="datetime-local"> ใช้ได้ (เวลาท้องถิ่น) · ว่าง = '' */
const localDt = (v) => { if (!v) return ''; const d = new Date(v); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const localDtNow = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const mtnPath = (url) => { const p = url?.split('/mtn-images/')[1]; return p ? decodeURIComponent(p) : null; };
const removeMtnImg = (url) => { const p = mtnPath(url); if (p) supabaseDR.storage.from('mtn-images').remove([p]).catch(() => {}); };
const uploadMtnImg = async (blob, path) => {
  const { error } = await supabaseDR.storage.from('mtn-images').upload(path, blob, uploadOpts({ upsert: true, contentType: blob.type }));
  if (error) throw error;
  return supabaseDR.storage.from('mtn-images').getPublicUrl(path).data.publicUrl;
};
const minutesBetween = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000)) : null);
const fmtMin = (m) => (m == null ? '—' : m < 60 ? `${m} นาที` : `${Math.floor(m / 60)} ชม. ${m % 60} นาที`);
// echo วันที่ (input ISO YYYY-MM-DD ค.ศ.) → DD/MM/พ.ศ.
const beEcho = (ymd) => { if (!ymd) return ''; const [y, m, d] = ymd.split('-'); return `${d}/${m}/${Number(y) + 543}`; };

// หน่วยงานซ่อม — fallback เท่านั้น (source of truth = mtn_teams ผ่าน pmTeamsSync().dept_name · ดู CLAUDE.md "ทีมช่างซ่อม 4 ส่วน")
// ⚠️ ค่าที่เก็บลง DB = key เสมอ · ชื่อทีมใช้แสดงผลผ่าน deptNameOf() เท่านั้น (ดูกฎใน utils/mtnTeams.js)
const MTN_DEPTS = ['jig_maintenance', 'die_maintenance', 'maintenance', 'production'];
// role ที่ "ควรขึ้นก่อน" ใน PersonSelect (prefer ไม่ใช่ restrict — หยิบข้ามทีมมีจริง) · 2026-09-07
const QA_ROLES = ['qa'];
const MTN_HEAD_ROLES = ['mtn', 'supervisor', 'manager'];
const DEPT_HEAD_ROLES = ['supervisor', 'manager'];
const NO_LINES = [];
// <option> ของทีม — value = key, ข้อความ = ชื่อทีม (ใช้ซ้ำทุก dropdown ในหน้านี้)
const TeamOpts = ({ list }) => (list || []).map(k => <option key={k} value={k}>{deptNameOf(k)}</option>);
// เดา default หน่วยงานจากชนิดอุปกรณ์ — reuse util กลาง (เลิก duplicate logic)
const deptForItem = teamForItem;

/* ⚠️ ใบซ่อมเก็บ "ชื่อ" ของ taxonomy ไว้เป็น snapshot (ตาม pattern เดียวกับ lpa_audit_answers.question_text)
   ข้อดี: ใบเก่ายังอ่านออกเหมือนวันที่แจ้ง · ข้อเสีย: เปลี่ยนชื่อใน master แล้ว KPI/พาเรโต้ (จัดกลุ่มด้วยข้อความ)
   จะแตกเป็น 2 กลุ่ม → ตอนแก้ชื่อจึงถามก่อนว่าจะให้ใบเก่าตามไปด้วยไหม (ไม่เขียนทับประวัติเงียบๆ) */
const NAME_CASCADE = {
  mtn_problem_types: { characteristic: 'problem_characteristic', detail: 'problem_detail' },
  mtn_item_types:    { name: 'item_type' },
  mtn_repair_types:  { name: 'repair_type' },
};

/* สี/ลำดับขั้นของแต่ละสถานะ — **ป้าย (label) ไม่ได้เขียนที่นี่**: มาจาก MO_STATUS_LABEL
   ใน `src/utils/mtnStepPerm.js` ที่เดียว (จอซ่อม/บอร์ด Andon/ผังแม่พิมพ์/สรุป Telegram ต้องพูดตรงกัน) */
const STATUS_META = {
  pending:   { label: MO_STATUS_LABEL.pending,   step: 1, color: '#ef4444', bg: 'rgba(239,68,68,0.14)' },
  assigned:  { label: MO_STATUS_LABEL.assigned,  step: 2, color: '#f59e0b', bg: 'rgba(245,158,11,0.14)' },
  repairing: { label: MO_STATUS_LABEL.repairing, step: 2, color: '#f59e0b', bg: 'rgba(245,158,11,0.14)' },
  repaired:  { label: MO_STATUS_LABEL.repaired,  step: 3, color: '#f59e0b', bg: 'rgba(245,158,11,0.14)' },
  checked:   { label: MO_STATUS_LABEL.checked,   step: 4, color: '#f59e0b', bg: 'rgba(245,158,11,0.14)' },
  qa:        { label: MO_STATUS_LABEL.qa,        step: 5, color: '#f59e0b', bg: 'rgba(245,158,11,0.14)' },
  handover:  { label: MO_STATUS_LABEL.handover,  step: 6, color: '#3b82f6', bg: 'rgba(59,130,246,0.14)' },
  closed:    { label: MO_STATUS_LABEL.closed,    step: 7, color: '#22c55e', bg: 'rgba(34,197,94,0.14)' },
  returned:  { label: MO_STATUS_LABEL.returned,  step: 1, color: '#e0894a', bg: 'rgba(224,137,74,0.14)' },
  rejected:  { label: MO_STATUS_LABEL.rejected,  step: 0, color: '#8b8b96', bg: 'rgba(139,139,150,0.14)' },
};
/* 🔴 ป้ายสถานะต้องบอก "ใครต้องทำต่อ" ให้ตรง — 2026-09-08 → เข้มขึ้น 2026-09-09 (ใบค้างขั้น 6 = 140 ใบ)
   `checked` (ผ่านขั้น 4 แล้ว) เคยใช้ป้ายเดียว "🧪 รอคุณภาพ/รับมอบ" ทั้งที่แยกเป็น 2 ทางคนละคนกด:
     · ขั้น 4 ระบุ "เกี่ยวกับคุณภาพ"    → "🧪 รอตรวจคุณภาพ (ขั้น 5)"  = รอ QA จริง (มีปุ่ม ⏭ ข้าม QA)
     · ขั้น 4 ระบุ "ไม่เกี่ยวกับคุณภาพ" → "🤝 รอรับมอบ (ขั้น 6)"      = ไม่ต้องรอ QA เลย รอฝ่ายที่แจ้ง
   ป้ายรวมทำให้หน้างานอ่านว่า "ยังรอ QA" แล้วไม่มีใครกดขั้น 6 → ใบกองค้าง
   ⚠️ เกณฑ์แยกอยู่ที่ `moStatusLabel()` (mtnStepPerm.js) ที่เดียว **ห้ามอ่าน STATUS_META[o.status].label
      ตรงๆ** และ **ห้ามเพิ่มค่า status ใหม่** เพื่อแยก 2 เคสนี้ (KPI/Andon/ใบพิมพ์/edge อ่าน status ดิบ) */
const statusMetaOf = (o) => {
  const m = STATUS_META[o?.status] || STATUS_META.pending;
  return { ...m, label: moStatusLabel(o) };   // ป้ายมาจาก moStatusLabel() เท่านั้น — สี/ขั้นคงเดิม
};
const SCOPE_OPTS = [{ v: 'in_line', t: 'ซ่อมในไลน์' }, { v: 'off_line', t: 'ซ่อมนอกไลน์' }];
const CHECK_RESULTS = ['ตรวจสอบผ่าน', 'ตรวจสอบไม่ผ่าน'];
const QA_RESULTS = ['ผ่านคุณภาพ', 'ไม่ผ่านคุณภาพ'];
const FOLLOW_OPTS = ['ไม่เกิดปัญหาซ้ำ', 'แจ้งเฝ้าระวัง', 'เกิดปัญหาซ้ำ', 'แก้ไขไม่ได้'];
// ประเมินความพึงพอใจบริการซ่อม (step 6) — KPI ให้หน่วยงานซ่อม · 5 ด้าน × 3 ระดับ
/* ⚠️ ป้าย+สเกลตรงกับฟอร์มกระดาษ FM-MTN (user 2026-09-15 "ใช้รูปแบบใบเดิมเหมือน 100%")
   **คีย์ไม่เปลี่ยน** (quality/response/problem/politeness/readiness) ข้อมูลเก่าจึงยังอ่านได้ */
const SAT_DIMS = [
  { key: 'quality',    label: 'คุณภาพงาน' },
  { key: 'response',   label: 'ความรวดเร็วในการทำงาน' },
  { key: 'problem',    label: 'ความสามารถในการแก้ปัญหา' },
  { key: 'politeness', label: 'ความสุภาพ' },
  { key: 'readiness',  label: 'ความกระตือรือร้น' },
];
const SAT_LEVELS = [
  { v: 1, t: 'พอใช้',   color: '#94a3b8' },
  { v: 2, t: 'ปานกลาง', color: '#f59e0b' },
  { v: 3, t: 'ดี',      color: '#22c55e' },
];
const satLabel = (v) => (SAT_LEVELS.find(l => l.v === Number(v)) || {}).t || '-';
const satAvg = (s) => { if (!s) return null; const vs = SAT_DIMS.map(d => Number(s[d.key])).filter(v => v >= 1 && v <= 3); return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null; };
/* ⚠️ ใบ MTN มี 8 ขั้น — ขั้น 7 = ผจก.แผนกที่แจ้งอนุมัติ (ยังไม่ปิด) ⇒ ใช้ event `mtn_approved`
   ส่วน `mtn_closed` ไปอยู่ขั้น 8 (ผจก.ซ่อมบำรุงปิดจบ) · ฟอร์มอื่นขั้น 7 = ปิดใบเหมือนเดิม */
const STEP_EVENT = { 1: 'mtn_reported', 2: 'mtn_assigned', 3: 'mtn_repaired', 4: 'mtn_checked', 5: 'mtn_qa', 6: 'mtn_handover', 7: 'mtn_closed', 8: 'mtn_closed' };
const stepEventOf = (step, mtnForm) => (mtnForm && step === 7 ? 'mtn_approved' : STEP_EVENT[step]);

/* "ขั้นไหนใครทำ" ย้ายไป src/utils/mtnStepPerm.js (MTN_STEPS/canDoStep) แล้ว — 2026-09-02
   เดิมเป็น STEP_PERM ที่นี่ แล้วเกณฑ์ถูกเขียนซ้ำ 2 ก้อน (ตัวซ่อนปุ่ม + guard ตอนบันทึก)
   ห้ามเอากลับมาเขียนที่นี่อีก · ผูก role ให้ util ผ่าน helper ตัวนี้ */
const stepPerms = (role) => ({ can: (a) => can('mtn_repair', a, role), seeded: (a) => isActionSeeded('mtn_repair', a) });

/* ใบนี้ใช้ฟอร์ม/ขั้นตอนของทีม MTN (FM-MTN-006) ไหม — JIG/DIE/PRODUCTION ใช้ FM-JIG-008 เหมือนเดิม
   ⚠️ เกณฑ์นี้ถูกใช้ 5 ที่ (ฟอร์มแจ้ง · ขั้นตอน · ป้ายขั้น · ด่านอนุมัติ · ใบพิมพ์) — ห้ามเขียนซ้ำในหน้า */
const isMtnFormOrder = (o) => teamKeyOf(o?.mtn_dept || deptForItem(o?.item_type)) === 'maintenance';

const notifyMtn = (payload, event) => {
  // ⚠️ DB เก็บ mtn_dept เป็น "รหัสทีม" แต่ข้อความ Telegram ต้องอ่านออก → ส่งเป็น "ชื่อทีม" ไปใน payload
  //    ถูกต้องทั้งกับ edge เวอร์ชันที่ deploy อยู่ (แสดงค่าที่ส่งไปตรงๆ) และเวอร์ชันใหม่ (normalize ก่อนเสมอ)
  //    routing ไม่กระทบ — edge แปลงเป็น key ด้วย teamKey() ทั้งสองเวอร์ชัน
  const mo = payload?.mtn_dept ? { ...payload, mtn_dept: deptNameOf(payload.mtn_dept) } : payload;
  fetch('https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-mtn-notification', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, mo }),
  }).catch(() => {});
};

const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 4 };
const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' };
const btnPri = { background: 'var(--accent)', color: '#071008', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const btnGhost = { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };

/* ── ลายเซ็น: ใช้ลายเซ็นโปรไฟล์ (ไม่เพิ่มไฟล์ใหม่) หรือเซ็นใหม่ ── */
function SignField({ signatureUrl, existing, onChange }) {
  // ค่าเริ่ม: ถ้ามีลายเซ็นโปรไฟล์ → ใช้เลย · ไม่มีก็บังคับวาด
  const [mode, setMode] = useState(signatureUrl ? 'profile' : 'draw');
  const cvRef = useRef(null); const drawing = useRef(false); const dirty = useRef(false); const last = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (mode === 'profile') { onChange({ mode: 'profile', url: signatureUrl }); }
    else { const c = cvRef.current; if (c) { const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); } dirty.current = false; onChange({ mode: 'draw', blob: null }); }
  }, [mode]); // eslint-disable-line

  const pos = (e) => { const c = cvRef.current, r = c.getBoundingClientRect(), t = e.touches?.[0] || e; return { x: (t.clientX - r.left) * (c.width / r.width), y: (t.clientY - r.top) * (c.height / r.height) }; };
  const down = (e) => { e.preventDefault(); drawing.current = true; last.current = pos(e); };
  const move = (e) => { if (!drawing.current) return; e.preventDefault(); const c = cvRef.current, ctx = c.getContext('2d'), p = pos(e); ctx.strokeStyle = '#111'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last.current = p; dirty.current = true; };
  const up = () => { if (!drawing.current) return; drawing.current = false; if (dirty.current) cvRef.current.toBlob(b => onChange({ mode: 'draw', blob: b }), 'image/png'); };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        {signatureUrl && <button type="button" onClick={() => setMode('profile')} style={{ ...(mode === 'profile' ? btnPri : btnGhost), padding: '5px 12px', fontSize: 12 }}>✔ ใช้ลายเซ็นของฉัน</button>}
        <button type="button" onClick={() => setMode('draw')} style={{ ...(mode === 'draw' ? btnPri : btnGhost), padding: '5px 12px', fontSize: 12 }}>✏️ เซ็นใหม่</button>
        {existing && mode !== 'draw' && !signatureUrl && <span style={{ fontSize: 11, color: 'var(--muted)' }}>ใช้ลายเซ็นเดิม</span>}
      </div>
      {mode === 'profile'
        ? <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 6, background: '#fff', display: 'inline-block' }}><img src={signatureUrl} alt="" style={{ height: 60 }} /></div>
        : <canvas ref={cvRef} width={520} height={140} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
            style={{ width: '100%', height: 120, border: '1px solid var(--border)', borderRadius: 8, background: '#fff', touchAction: 'none', cursor: 'crosshair' }} />}
      {!signatureUrl && mode === 'profile' && <div style={{ fontSize: 11, color: 'var(--accent2)' }}>ยังไม่มีลายเซ็นในโปรไฟล์ — ตั้งได้ที่มุมขวาบน (ไอคอนลายเซ็น) แล้วจะใช้ซ้ำได้ทุกใบ</div>}
    </div>
  );
}

function ImgField({ label, value, onPick, required }) {
  return (
    <div>
      <label style={lbl}>{label}{required && <span style={{ color: '#ef4444' }}> *</span>}</label>
      {value && <img src={value} alt="" style={{ display: 'block', maxHeight: 120, borderRadius: 8, border: '1px solid var(--border)', marginBottom: 6 }} />}
      {/* reset value เสมอ — ไม่งั้นเลือก "รูปเดิม" ซ้ำแล้ว change ไม่ยิง (feedback 2026-09-08 "รูปเดิมก็ลงไม่ได้") */}
      <input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f); }} style={{ fontSize: 12 }} />
    </div>
  );
}
/* ⚠️ backdrop **ไม่มี onClick โดยตั้งใจ** — ฟอร์มขั้น 1-7 ยาว เผลอแตะข้างนอกแล้วปิด = กรอกใหม่ทั้งใบ
   (UI-CONVENTIONS §5 · ห้ามเติม onClick={onClose} ที่ div ชั้นนอก)
   ส่วน ✕ / ยกเลิก เป็นการกดที่ "ตั้งใจ" → ถามยืนยันเมื่อกรอกอะไรไปแล้ว (prop `dirty`) */
function confirmDiscard() {
  return window.confirm('ปิดหน้าต่างนี้? ข้อมูลที่กรอกไว้ยังไม่ได้บันทึก — จะหายทั้งหมด');
}
/** ดึงทุกแถว (แบ่งหน้าทีละ 1000) — ตารางที่โตเกินเพดานของ PostgREST ต้องผ่านตัวนี้เสมอ
 *  order ต้องคงที่ (ใส่ .order('id') ปิดท้าย) ไม่งั้นแถวหลุด/ซ้ำระหว่างหน้า */
async function fetchAllRows(client, table, cols, shape = q => q) {
  const PAGE = 1000, out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await shape(client.from(table).select(cols)).range(from, from + PAGE - 1);
    if (error) return { data: out, error };
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return { data: out, error: null };
}

function ModalShell({ title, onClose, children, wide, dirty }) {
  const askClose = () => { if (dirty && !confirmDiscard()) return; onClose(); };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 3000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '4vh 2vw' }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, width: wide ? 'min(96vw, 1200px)' : 'min(96vw, 640px)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--card)', zIndex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{title}</div>
          <button onClick={askClose} style={{ background: 'none', border: 'none', fontSize: 22, color: 'var(--muted)', cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  );
}
const Field = ({ label, required, children }) => (
  <div><label style={lbl}>{label}{required && <span style={{ color: '#ef4444' }}> *</span>}</label>{children}</div>
);
const DateField = ({ label, value, onChange, required }) => (
  <Field label={label} required={required}>
    <input type="date" value={value || ''} onChange={e => onChange(e.target.value)} style={inp} />
    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>ปฏิทินเป็น ค.ศ.{value ? ` · = ${beEcho(value)} (พ.ศ.)` : ''}</div>
  </Field>
);

/* ═══════════════════════════════════════════════════════ */
export default function MtnRepair() {
  const { role, lineId, sections: scopeSecs, section: mySection, mtnTeams: userMtnTeams, fullName, signatureUrl } = useContext(UserContext);
  // แท็บผูก ?tab= (แชร์ลิงก์/refresh/Back อยู่แท็บเดิม) — ⚙️ ข้อมูลหลัก อยู่ท้ายสุดและโผล่ตามสิทธิ์
  const TAB_DEFS = [
    { key: 'list', label: '📋 รายการ MO' },
    /* 📊 KPI ช่าง = ที่เดียวจบ (2026-09-15 · คำสั่ง user "KPI กับ MTTR/MTBF/MTTA ควรอยู่ tab เดียวกัน
       เพราะมันคือ KPI ช่าง") — เดิมแยกเป็น 📊 KPI (จากใบซ่อม MO) กับ ⚙️ รายอุปกรณ์ (จาก downtime จริง)
       ทำให้คนต้องสลับแท็บเพื่อตอบคำถามเดียวกัน · `?tab=equip` เก่าถูก redirect มาที่นี่ (ดู useEffect ล่าง) */
    { key: 'kpi', label: '📊 KPI ช่าง' },
    { key: 'spare', label: '🔩 คลังอะไหล่' },   // ทุก role ที่เข้าหน้านี้ได้ (ช่างต้องค้นของ/ดูชั้นวางได้) — แก้/เคลื่อนไหวสต็อกคุมด้วย can() ในตัวคอมโพเนนต์
    { key: 'rack', label: '🗺️ ผังคลัง' },
    ...(can('mtn_repair', 'manage_master', role) ? [{ key: 'master', label: '⚙️ ข้อมูลหลัก' }] : []),
  ];
  // 'equip' = คีย์เก่าที่ยุบเข้า 'kpi' แล้ว — ต้องคงไว้ในลิสต์ ไม่งั้น useTabParam ตีเป็นค่าไม่รู้จัก
  // แล้วเด้งไปแท็บ default (รายการ MO) = บุ๊กมาร์กของทีมช่างพาไปผิดที่เงียบๆ
  const [tab, setTab] = useTabParam([...TAB_DEFS.map(t => t.key), 'equip'], 'list');
  useEffect(() => { if (tab === 'equip') setTab('kpi', { replace: true }); }, [tab, setTab]);
  const [orders, setOrders] = useState([]);
  const [lines, setLines] = useState([]);
  const [machines, setMachines] = useState([]);
  const [techs, setTechs] = useState([]);
  const [parts, setParts] = useState([]);
  const [problemTypes, setProblemTypes] = useState([]);
  const [repairTypes, setRepairTypes] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  const [laborRates, setLaborRates] = useState([]); // ราคามาตรฐานค่าแรงซ่อม (master)
  const [improvements, setImprovements] = useState([]); // โปรเจคปรับปรุงที่กำลังทำ (cross-ref D)
  const [mtnDepts, setMtnDepts] = useState(() => pmTeamsSync().map(t => t.key)); // ทีมช่าง data-driven (mtn_teams) — เก็บ key ไม่ใช่ชื่อ
  const [mtnTeamRows, setMtnTeamRows] = useState(() => pmTeamsSync()); // แถวทีมเต็ม (key/label/icon) — ใช้ตั้ง 'ทีมของ master แต่ละแถว'
  const [supplyByMachineNo, setSupplyByMachineNo] = useState({}); // machine_no → [line_name] (utility/facility จ่ายไลน์ไหน → ผลกระทบเวลาซ่อม/ตัดไฟ)
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const [fStatus, setFStatus] = useState('open');
  const [fLine, setFLine] = useState('');
  const [fDept, setFDept] = useState('');
  const [fText, setFText] = useState('');
  const [showReport, setShowReport] = useState(false);
  const [detail, setDetail] = useState(null);
  const [stepModal, setStepModal] = useState(null); // { step, order, editMode }

  const loadMasters = useCallback(async () => {
    const [{ data: ln }, { data: mc }, { data: tc }, { data: pt }, { data: pp }, { data: rt }, { data: it }, { data: imp }, lr, { data: emps }, sup] = await Promise.all([
      // flow_mode + parallel_stations = จำนวนเครื่องขนาน (N) ของไลน์ — แท็บ ⚙️ รายอุปกรณ์ ใช้ถ่วง DT 1/N
      //   ให้ตรงกับ %A ของ Daily Report (parallelUnitsOf · 2026-09-14) ห้ามถอดออก ไม่งั้นโหมด "มุมไลน์" ตาย
      supabase.from('production_lines').select(`${LINE_COLUMNS}, cost_center, flow_mode, parallel_stations`).order('name'), // LINE_COLUMNS = ครบตามสัญญา <LineSelect> (2026-09-07)
      // equipment_kind = แกนชนิดอุปกรณ์ (machine/die/jig/facility) — ต้องมี ไม่งั้นแยก "แม่พิมพ์" ออกจาก "เครื่องจักร" ไม่ได้
      supabaseDR.from('machines').select('id, line_name, machine_no, machine_name, equipment_kind').eq('is_active', true).order('sort_order'),
      supabaseDR.from('mtn_technicians').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('mtn_problem_types').select('*').eq('is_active', true).order('sort_order'),
      /* ⚠️ ทะเบียนอะไหล่โตเกิน 1000 แถวได้ (หน้างาน: "อะไหล่เป็นพัน") — Supabase ตัดที่ 1000
         ไม่แบ่งหน้า = อะไหล่ที่เกินมา **หายจากลิสต์เงียบๆ** ค้นยังไงก็ไม่เจอ (กฎเดียวกับ role_permissions) */
      fetchAllRows(supabaseDR, 'mtn_spare_parts', '*', q => q.eq('is_active', true).order('sort_order').order('id')),
      supabaseDR.from('mtn_repair_types').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('mtn_item_types').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('improvements').select('id, line_name, machine_no, title').eq('status', 'monitoring'),
      supabaseDR.from('mtn_labor_rates').select('*').eq('is_active', true).order('sort_order').then(r => r).catch(() => ({ data: [] })),
      // ช่าง = พนักงาน (Main) — ทีมมาจาก `employees.mtn_team` (ติ๊กเองที่ /operator) ก่อน แล้วค่อยเดาจากแผนก
      //   ⚠️ tolerant: ยังไม่ apply migration 20260821_production_technician_setup = ไม่มีคอลัมน์ (42703)
      //      → ถอยไป select ชุดเดิม ไม่งั้นทั้งหน้าโหลด master ไม่ขึ้นเลย
      supabase.from('employees').select('id, name, section, department, employee_id_code, mtn_team').eq('is_active', true).order('name')
        .then(r => r.error ? supabase.from('employees').select('id, name, section, department, employee_id_code').eq('is_active', true).order('name') : r),
      // supply route: utility/facility จ่ายให้ไลน์ไหน — ใช้โชว์ผลกระทบตอนซ่อม (best-effort ถ้ายังไม่ apply migration)
      supabaseDR.from('facility_supply_links').select('machine_id, line_name').then(r => r).catch(() => ({ data: [] })),
    ]);
    /* แปลงพนักงานทีมช่างเป็นรูปแบบ tech + รวมกับ mtn_technicians เดิม (พนักงานมาก่อน · กันชื่อซ้ำ)
       ลำดับที่มาของทีม:
         1. `employees.mtn_team` — ติ๊กเองที่ /operator (**ชนะเสมอ**)
            จำเป็นสำหรับ **ช่างฝ่ายผลิต** ซึ่ง `teamForSection` เดาไม่ได้โดยตั้งใจ
            (ส่วนงานผลิตมีหลายชื่อ PD1/PD2/GOR… เดาเหมาจะไปโดน QA/ธุรการด้วย)
            → ก่อนมีคอลัมน์นี้ ช่างฝ่ายผลิต "ไม่มีวันโผล่" ในลิสต์มอบหมายช่าง
         2. เดาจาก department แล้ว section (backward-compat — จับได้แค่ JIG/DIE/MTN) */
    const empTechs = (emps || [])
      .map(e => ({ ...e, team: teamKeyOf(e.mtn_team) || teamForSection(e.department) || teamForSection(e.section) }))
      .filter(e => e.team)
      .map(e => ({ id: `emp_${e.id}`, name: e.name, dept: e.team, from_employee: true, emp_code: e.employee_id_code }));
    const empNames = new Set(empTechs.map(t => t.name.trim()));
    const legacyTechs = (tc || []).filter(t => !empNames.has((t.name || '').trim()));
    setLines(ln || []); setMachines(mc || []); setTechs([...empTechs, ...legacyTechs]);
    setProblemTypes(pt || []); setParts(pp || []); setRepairTypes(rt || []); setItemTypes(it || []);
    setImprovements(imp || []); setLaborRates(lr?.data || []);
    // map machine_id → machine_no → [line_name] เพื่อโชว์ผลกระทบใน DetailDrawer (MO เก็บ machine_no ไม่ใช่ id)
    const noById = {}; (mc || []).forEach(m => { noById[m.id] = m.machine_no; });
    const supMap = {}; (sup?.data || []).forEach(s => { const no = noById[s.machine_id]; if (!no) return; (supMap[no] = supMap[no] || []).push(s.line_name); });
    setSupplyByMachineNo(supMap);
    return ln || [];
  }, []);

  const scopeLines = useMemo(() => {
    if (role === 'admin') return null;
    if (role === 'leader' && lineId) { const self = lines.find(l => String(l.id) === String(lineId)); return self ? new Set(getLineFamilyNames(lines, self.name)) : new Set(); }
    if (scopeSecs?.length) return new Set(lines.filter(l => inSectionScope(scopeSecs, l.section)).map(l => l.name));
    return null;
  }, [lines, role, lineId, scopeSecs]);

  /* 🔒 ขอบเขต "ฝ่ายที่แจ้ง" สำหรับขั้น 4/6/7 — ใช้ scopeLines ชุดเดียวกับที่กรองรายการ (leader = ครอบครัวไลน์ ·
     sections = ไลน์ในส่วนงาน · null = ไม่จำกัด) + ทะเบียนไลน์ทั้งหมดไว้แยก "ไลน์ที่ไม่รู้จัก" ออกจาก "ไลน์ของฝ่ายอื่น"
     เกณฑ์ตัดสินอยู่ที่ orderInReporterScope() ใน mtnStepPerm.js — ห้ามเขียนเงื่อนไขซ้ำที่นี่ */
  const reporterScope = useMemo(() => ({
    scopeLineNames: scopeLines ? [...scopeLines] : null,
    knownLineNames: lines.map(l => l.name),
    sections: scopeSecs || [],
  }), [scopeLines, lines, scopeSecs]);

  // ทีมช่างของ user (จาก profiles.mtn_teams ที่ตั้งใน AddUser · fallback เดาจาก section) — default คิวงาน + default หน่วยงานตอนแจ้ง
  const userTeams = useMemo(() => teamsForUser(userMtnTeams, scopeSecs), [userMtnTeams, scopeSecs]);
  const teamDefaulted = useRef(false);
  useEffect(() => {
    if (teamDefaulted.current || !lines.length) return;
    // สังกัดทีมเดียว (ไม่ใช่ admin) → เปิดหน้ามาเห็นคิวของทีมตัวเองก่อน (ปรับเป็น "ทุกหน่วยงาน" ได้)
    if (role !== 'admin' && userTeams.length === 1) setFDept(userTeams[0]);
    teamDefaulted.current = true;
  }, [userTeams, role, lines.length]);

  const loadOrders = useCallback(async () => {
    const { data } = await supabaseDR.from('mtn_orders').select('*').order('report_at', { ascending: false }).limit(1000);
    setOrders(data || []);
  }, []);

  useEffect(() => {
    loadPmTeams().then(ts => { setMtnDepts(ts.map(t => t.key)); setMtnTeamRows(ts); }); // ทีมช่างจากตาราง mtn_teams (fallback DEFAULT_TEAMS)
    (async () => { setLoading(true); await loadMasters(); await loadOrders(); setLoading(false); })();
    /* 🔴 2026-09-15 — เดิมผูก loadOrders เข้า handler ตรงๆ **ไม่มีเพดานเลย**
       loadOrders = `select('*').limit(1000)` ทั้งตาราง ⇒ ทุกครั้งที่ช่างคนไหนก็ตามขยับใบ
       ทุกเครื่องที่เปิดหน้านี้ดึงใบซ่อมทั้งพันใบใหม่ · ดู src/utils/liveRefresh.js */
    const bump = coalesce(loadOrders, LIVE.PAGE);
    const ch = liveChannel(supabaseDR, 'mtn-orders-rt').on('postgres_changes', { event: '*', schema: 'public', table: 'mtn_orders' }, bump).subscribe();
    return () => { bump.cancel(); supabaseDR.removeChannel(ch); };
  }, [loadMasters, loadOrders]);

  const shown = useMemo(() => {
    let rows = orders;
    if (scopeLines) rows = rows.filter(o => !o.line_name || scopeLines.has(o.line_name));
    if (fStatus === 'open') rows = rows.filter(isMoOpen);   // รวม transferred = จบแล้ว (utils/mtnStepPerm)
    else if (fStatus === 'closed') rows = rows.filter(o => o.status === 'closed');
    else if (fStatus !== 'all') rows = rows.filter(o => o.status === fStatus);
    if (fLine) {
      // กางครอบครัวไลน์เสมอ — MO เก็บชื่อ "ไลน์ลูก" (HDF1/SUB APRON) แต่ dropdown เลือกระดับแม่ (HYDROFORM/LINE APRON ASSY) ได้
      // เทียบตรงตัวทำให้เลือกแม่แล้วใบของลูกหายหมด (feedback หน้างาน 2026-08-25) · fam ว่าง (ไลน์ไม่อยู่ในทะเบียน) = ถอยไปเทียบตรงตัว
      const fam = new Set(getLineFamilyNames(lines, fLine));
      rows = fam.size ? rows.filter(o => fam.has(o.line_name)) : rows.filter(o => o.line_name === fLine);
    }
    if (fDept) rows = rows.filter(o => sameTeam(o.mtn_dept || deptForItem(o.item_type), fDept));
    if (fText.trim()) { const t = fText.trim().toLowerCase(); rows = rows.filter(o => [o.mo_no, o.machine_no, o.item_type, o.problem_characteristic, o.report_note, o.line_name].some(v => (v || '').toLowerCase().includes(t))); }
    return rows;
  }, [orders, scopeLines, fStatus, fLine, fDept, fText, lines]);

  const openCount = useMemo(() => orders.filter(o => isMoOpen(o) && (!scopeLines || !o.line_name || scopeLines.has(o.line_name))).length, [orders, scopeLines]);

  /* 📊 first-response ของช่างฝ่ายผลิต — "เข้าไป action แล้วแก้เองได้กี่ครั้ง / ส่งต่อกี่ครั้ง"
     (คำสั่ง user 2026-09-14: "เก็บเป็นประวัติไว้ว่าเข้าไป action ก่อนแล้วกี่ครั้ง ทำเองได้/ไม่ได้กี่ครั้ง")
     นับเฉพาะใบที่**ลงมือจริงแล้ว** (มี repair_done_at = ผ่านขั้น 3) — ใบที่ยังไม่มีใครแตะไม่ใช่ first-response
     ตัวหารจึงไม่รวมใบที่กำลังทำอยู่ ⇒ % ไม่แกว่งตามงานค้าง */
  const firstResp = useMemo(() => {
    const rows = orders.filter(o => teamKeyOf(o.mtn_dept || deptForItem(o.item_type)) === 'production'
      && (o.repair_done_at || o.status === 'transferred')
      && (!scopeLines || !o.line_name || scopeLines.has(o.line_name)));
    const passed = rows.filter(o => o.status !== 'transferred').length;   // ทำเองจนส่งมอบงานได้
    const sent   = rows.filter(o => o.status === 'transferred').length;   // เกินมือ ส่งต่อ
    const total  = passed + sent;
    return { passed, sent, total, pct: total ? Math.round((passed / total) * 100) : null };
  }, [orders, scopeLines]);
  // ⚠️ hook นี้ต้องอยู่ก่อน `if (loading) return` ด้านล่าง — ไม่งั้น hook count เปลี่ยนตอน loading→loaded = React #310 (จอ error)
  // ไลน์ในฟอร์มแจ้งซ่อม = เฉพาะที่อยู่ใน scope ของผู้แจ้ง (กันเห็นไลน์ข้ามส่วนงาน — pattern มาตรฐาน)
  const scopedLineObjs = useMemo(() => (scopeLines ? lines.filter(l => scopeLines.has(l.name)) : lines), [lines, scopeLines]);

  // เปิดโปรเจคปรับปรุงจากใบ MO (เชื่อม B) — ส่ง prefill ผ่าน sessionStorage แล้วไปหน้า /improvements
  const openImprovementFromMo = (o) => {
    sessionStorage.setItem('imp_prefill', JSON.stringify({
      line_name: o.line_name, machine_no: o.machine_no, item_type: o.item_type,
      problem: o.problem_characteristic, title: `ลดใบซ่อม ${o.problem_characteristic || ''} ${o.machine_no || ''}`.trim(),
    }));
    navigate('/improvements');
  };

  if (loading) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>กำลังโหลด…</div>;

  const cp = { lines: scopedLineObjs, machines, techs, parts, problemTypes, repairTypes, itemTypes, laborRates, mtnDepts, mtnTeams: mtnTeamRows, role, fullName, signatureUrl, improvements, supplyByMachineNo, userTeams, reporterScope, defaultDept: userTeams.length === 1 ? userTeams[0] : '', onOpenImprovement: openImprovementFromMo, onReload: loadOrders, reloadMasters: loadMasters };

  return (
    <div style={{ padding: 'clamp(12px,2.5vw,24px)', maxWidth: 'min(97vw, 1800px)', margin: '0 auto' }}>
      <PageHeader
        title="แจ้งซ่อม MTN (MO)" icon="🛠️"
        sub={<>ค้างดำเนินการ <b style={{ color: openCount ? '#ef4444' : '#22c55e' }}>{openCount}</b> ใบ
          {firstResp.total > 0 && <> · 🔧 ช่างฝ่ายผลิตแก้เองจบ <b style={{ color: firstResp.pct >= 60 ? '#22c55e' : '#f59e0b' }}>{firstResp.pct}%</b>
            <span style={{ color: 'var(--muted)' }}> ({firstResp.passed} ใบ · ส่งต่อช่างเฉพาะทาง {firstResp.sent} ใบ)</span></>}</>}
        tabs={TAB_DEFS} tab={tab} onTab={setTab}
      />

      {tab === 'list' && <>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          {can('mtn_repair', 'report', role) && <button onClick={() => setShowReport(true)} style={{ ...btnPri, padding: '9px 16px' }}>➕ แจ้งซ่อมใหม่</button>}
          <select value={fStatus} onChange={e => setFStatus(e.target.value)} style={{ ...inp, width: 170 }}>
            <option value="open">🔵 ยังไม่ปิด (ทั้งหมด)</option><option value="all">ทุกสถานะ</option>
            {Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
          <select value={fDept} onChange={e => setFDept(e.target.value)} style={{ ...inp, width: 150 }}><option value="">ทุกหน่วยงาน</option><TeamOpts list={mtnDepts} /></select>
          {/* dropdown ไลน์ = <LineSelect> เท่านั้น (UI-CONVENTIONS §5.3 ข้อ 9) — scopedLineObjs กรอง scope ไว้แล้ว · 2026-09-07 */}
          <LineSelect lines={scopedLineObjs} value={fLine} onChange={setFLine} placeholder="ทุกไลน์" style={{ ...inp, width: 180 }} />
          <input value={fText} onChange={e => setFText(e.target.value)} placeholder="ค้นหา เลข MO/เครื่อง/ปัญหา" style={{ ...inp, width: 230 }} />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{shown.length} รายการ</span>
        </div>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}>
          {shown.map(o => <MoCard key={o.id} o={o} onOpen={() => setDetail(o)} />)}
          {!shown.length && <div style={{ color: 'var(--muted)', padding: 24 }}>ไม่มีรายการ</div>}
        </div>
      </>}

      {tab === 'kpi' && <KpiTab orders={orders} scopeLines={scopeLines} lineObjs={scopedLineObjs}
        machines={machines} />}
      {tab === 'spare' && <SparePartMaster parts={parts} reload={loadMasters} fullName={fullName} role={role} myTeams={userTeams} mySection={mySection} />}
      {tab === 'rack' && <RackMap parts={parts} canEdit={can('mtn_repair', 'manage_master', role)} myTeams={userTeams} mySection={mySection} />}
      {tab === 'master' && can('mtn_repair', 'manage_master', role) && <MasterTab {...cp} fullName={fullName} />}

      {showReport && <ReportModal {...cp} onClose={() => setShowReport(false)} onSaved={() => { setShowReport(false); loadOrders(); }} />}
      {detail && <DetailDrawer order={orders.find(x => x.id === detail.id) || detail} {...cp}
        onClose={() => setDetail(null)} onStep={(step, editMode, extra) => setStepModal({ step, editMode, ...(extra || {}), order: orders.find(x => x.id === detail.id) || detail })} />}
      {stepModal && <StepModal {...cp} step={stepModal.step} order={stepModal.order} editMode={stepModal.editMode} skipQa={!!stepModal.skipQa}
        onClose={() => setStepModal(null)} onSaved={() => { setStepModal(null); loadOrders(); }} />}
    </div>
  );
}

function MoCard({ o, onOpen }) {
  const m = statusMetaOf(o);
  const pct = Math.round((o.current_step / 7) * 100);
  const dept = o.mtn_dept || deptForItem(o.item_type);
  return (
    <div className={o.status === 'pending' ? 'mo-card-alert' : ''} onClick={onOpen}
      style={{ background: 'var(--card)', border: `1px solid ${o.status === 'pending' ? '#ef4444' : 'var(--border)'}`, borderRadius: 12, padding: 12, cursor: 'pointer' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)' }}>{o.mo_no || '(ยังไม่ออกเลข MO)'}</div>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: m.color, background: m.bg, borderRadius: 20, padding: '3px 10px', whiteSpace: 'nowrap' }}>{m.label}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>🏢 {deptNameOf(dept)}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 3 }}>🏭 <b>{o.line_name || '—'}</b> · {o.item_type || '—'} {o.machine_no ? `· ${o.machine_no}` : ''}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 3 }}>🛑 {o.problem_characteristic || '—'}</div>
      {o.report_note && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.report_note}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 7, fontSize: 11, color: 'var(--muted)' }}>
        <span>{fmtDateTime(o.report_at)}</span>{o.status !== 'rejected' && <span>ขั้น {o.current_step}/7</span>}
      </div>
      {o.status !== 'rejected' && <div style={{ height: 5, background: 'var(--bg3)', borderRadius: 4, marginTop: 4, overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: o.status === 'closed' ? '#22c55e' : '#f59e0b' }} /></div>}
    </div>
  );
}

/* ── Step 1: แจ้งซ่อม ─────────────────────────────────── */
function ReportModal({ lines, machines, itemTypes, problemTypes, repairTypes = [], mtnDepts = MTN_DEPTS, fullName, defaultDept, onClose, onSaved }) {
  const [f, setF] = useState({
    mtn_dept: teamKeyOf(defaultDept) || 'maintenance', repair_scope: 'in_line', line_name: '', item_type: '', machine_no: '', dept_section: '', work_area: '',
    cost_center: '', model: '', customer: '', code: '', want_at: '', problem_group: '', problem_characteristic: '', problem_detail: '',
    /* ── ช่องเฉพาะฟอร์มกระดาษของทีม MTN (FM-MTN · 2026-09-15) — ทีมอื่นไม่โชว์ ── */
    contact_phone: '', pr_no: '', io_no: '', purpose: 'repair', dept_manager_name: '', plant_manager_name: '',
    report_note: '', is_sample: false, reporter_prod: fullName || '', reporter_qa: '',
    // 2026-09-08 (feedback admin): ผู้แจ้งเลือก BM/PM ได้ตั้งแต่ขั้น 1 (หัวหน้าช่างยังแก้ได้ที่ขั้น 2 ก่อนออกเลข MO)
    //   + occurred_at = "วันเวลาที่เกิดเหตุจริง" สำหรับแจ้งย้อนหลัง — แยกจาก report_at (เวลากดแจ้ง = นาฬิกา KPI/เลข MO) ไม่ทับกัน
    repair_type: '', occurred_at: '',
  });
  const [beforeFile, setBeforeFile] = useState(null);
  const beforeUrl = useObjectUrl(beforeFile);
  const [saving, setSaving] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  // แตะอะไรไปแล้วบ้าง — ใช้ถามยืนยันก่อนปิด (ฟอร์มนี้ยาว กรอกใหม่ทั้งใบเจ็บมาก)
  const [dirty, setDirty] = useState(false);
  const set = (k, v) => { setDirty(true); setF(p => ({ ...p, [k]: v })); };
  const pickBefore = (file) => { setDirty(true); setBeforeFile(file); };
  const tryClose = () => { if (!dirty || confirmDiscard()) onClose(); };
  /* แผนก/ส่วนงาน อ่านจากผังองค์กร (org_nodes) — dept_section เป็นคีย์ scope ของ orderInReporterScope()
     พิมพ์เองผิดตัวเดียว = ใบหลุด/เข้า scope คนอื่นเงียบๆ (audit 2026-09-07) · ผังว่าง = ถอยไป section ของไลน์ */
  const orgSections = useOrgSections();
  const deptsOf = useOrgDepts();
  /* 📜 ค่าที่เคยบันทึกใน mtn_orders (DR) — ทะเบียน machines/profiles/Product Master ไม่มี ก็ยังเลือกค่าเดิมซ้ำได้
     ห้ามล้าง/บล็อกเงียบ (คำสั่ง user 2026-09-07) · เก็บเป็น text เหมือนเดิม (known:false = id null) */
  const machineHist = useColumnHistory(supabaseDR, 'mtn_orders', 'machine_no', { upper: true });
  const reporterHist = useColumnHistory(supabaseDR, 'mtn_orders', 'reporter_prod');
  const customerHist = useColumnHistory(supabaseDR, 'mtn_orders', 'customer');
  const sectionOpts = useMemo(
    () => (orgSections.length ? orgSections : [...new Set(lines.map(l => l.section).filter(Boolean))].sort()),
    [orgSections, lines],
  );
  // ครอบครัวไลน์ที่เลือก — ให้ picker เครื่อง/คน "ขึ้นก่อน" (ไม่ตัดไลน์อื่น: เครื่องลงทะเบียนไว้ที่ไลน์ลูก แต่ใบเปิดที่ไลน์แม่มีจริง)
  const lineFam = useMemo(() => (f.line_name ? getLineFamilyNames(lines, f.line_name) : NO_LINES), [lines, f.line_name]);
  // แผนก + cost center ที่ derive จากไลน์ (ไลน์ลูกไม่มี CC → ใช้ของไลน์แม่) — ใช้ร่วมทั้งเลือกไลน์ / สแกน / เลือกเครื่อง
  const lineDerived = (name) => {
    const l = lines.find(x => x.name === name);
    let cc = l?.cost_center || '';
    if (!cc && l?.parent_line_name) cc = lines.find(x => x.name === l.parent_line_name)?.cost_center || '';
    return { section: l?.section || '', cc };
  };
  // แจ้งซ่อม "แม่พิมพ์" หรือ "เครื่องจักร"? — ตัดสินจากชนิดอุปกรณ์ที่เลือก แล้วค่อยดูทีมที่แจ้งถึง
  //   ⚠️ แม่พิมพ์ผูก line_name เป็น "ชื่อกลุ่มเครื่องปั๊ม" (เช่น LINE A ( 800 Ton )) ซึ่งไม่มีใน production_lines
  //      → กรองด้วยไลน์ที่เลือกในฟอร์มจะไม่มีวันเจอแม่พิมพ์เลย (เจอจริง: เลือก HDF1 แล้วขึ้นแต่ HDF-01)
  //      จึงลิสต์แม่พิมพ์ "ทั้งหมด" ไม่กรองไลน์ — แม่พิมพ์ถอดย้ายเครื่องได้อยู่แล้ว
  const teamRepairTypes = useMemo(() => filterByTeam(repairTypes, f.mtn_dept), [repairTypes, f.mtn_dept]);
  const wantDie = useMemo(
    () => /^DIE\b/i.test(f.item_type || '') || (!f.item_type && teamKeyOf(f.mtn_dept) === 'die_maintenance'),
    [f.item_type, f.mtn_dept],
  );
  const lineMachines = useMemo(() => {
    if (wantDie) return machines.filter(m => isDie(m.equipment_kind));
    // ไม่ใช่งานแม่พิมพ์ → ตัดแม่พิมพ์ออกจากลิสต์เครื่องจักร (262 ตัวอยู่ตารางเดียวกัน เคยปนกันมาตลอด)
    // ไม่ตัดตามไลน์แล้ว — <MachineSelect lines={lineFam}> เรียงเครื่องของไลน์ที่เลือกขึ้นก่อน (2026-09-07)
    return machines.filter(m => !isDie(m.equipment_kind));
  }, [machines, wantDie]);
  const machineKinds = useMemo(() => (wantDie ? ['die'] : ['machine', 'jig', 'facility']), [wantDie]);

  const onLine = (name) => {
    const { section, cc } = lineDerived(name);
    setDirty(true);
    setF(p => ({ ...p, line_name: name, dept_section: section || p.dept_section, cost_center: cc || p.cost_center }));
  };
  /* เลือกเครื่องจาก <MachineSelect> — machine_no เป็น text join key (Andon/DieRegistry/improvements/OrderTrace)
     mtn_orders ไม่มีคอลัมน์ machine_id → เก็บ machine_no อย่างเดียวเหมือนเดิม · เลือกจากทะเบียนแล้วยังไม่ได้เลือกไลน์
     → เติมไลน์/แผนก/CC ให้เหมือนสแกน QR · พิมพ์เองได้ (allowFree) แต่ติดป้าย "ไม่ได้อยู่ในทะเบียน" */
  const onMachinePick = (res) => {
    setDirty(true);
    setF(p => {
      const next = { ...p, machine_no: res.machine_no || '' };
      if (res.opt && res.line_name && !p.line_name && lines.some(x => x.name === res.line_name)) {
        const { section, cc } = lineDerived(res.line_name);
        Object.assign(next, { line_name: res.line_name, dept_section: section || p.dept_section, cost_center: cc || p.cost_center });
      }
      return next;
    });
  };

  // สแกนป้าย QR ที่ติดเครื่อง → เติม "ไลน์ + เลขเครื่อง" ให้พร้อมกัน
  // (ค้นจาก machines ทั้งหมด ไม่ใช่เฉพาะไลน์ที่เลือกไว้ — ป้ายบอกเองว่าเครื่องอยู่ไลน์ไหน)
  const onScanMachine = (parsed) => {
    const mc = resolveMachine(parsed, machines);
    if (!mc) return `ไม่พบเครื่องนี้ในฐานข้อมูล (${parsed.raw}) — ตรวจว่าเครื่องลงทะเบียนแล้วหรือยัง`;
    const { section, cc } = lineDerived(mc.line_name);
    setDirty(true);
    setF(p => ({
      ...p,
      machine_no: mc.machine_no || p.machine_no,
      line_name: mc.line_name || p.line_name,
      dept_section: section || p.dept_section,
      cost_center: cc || p.cost_center,
    }));
    toast.success(`เลือกเครื่อง ${mc.machine_no}${mc.line_name ? ` · ${mc.line_name}` : ''}`);
  };
  // เลือกชนิดอุปกรณ์ → เดาทีมให้เฉพาะตอนที่ยังไม่ได้เลือกทีม (fill-if-empty)
  // ⚠️ ห้ามทับทีมที่ user เลือกแล้ว — เคสจริง (feedback 2026-08-19): เลือกทีม JIG แล้วจิ้มชนิดกลาง 🌐
  //    (CONVEYOR ฯลฯ ที่ fallback เดาเป็น MTN) → ทีมเด้งไป MTN เงียบๆ ลิสต์สลับชุด = "ชนิดอุปกรณ์โชว์มั่ว"
  //    + ใบไปเข้าคิวทีมผิด
  const onItem = (it) => setF(p => ({ ...p, item_type: it, mtn_dept: p.mtn_dept || deptForItem(it, itemTypes) }));
  // ลิสต์ที่กรองตามทีมที่แจ้งถึงแล้ว (แถวที่ไม่ตั้งทีม = 🌐 ใช้ร่วม ติดมาเสมอ)
  /* ลิสต์ที่ "เห็นได้" — ต่างจาก filterByTeam ที่ใช้คุมสิทธิ์แก้
     AM เห็นทุกแถว (เจอปัญหาก่อนใคร) · JIG↔MTN เห็นข้ามกันได้ผ่าน shared_teams · DIE แยกชัด */
  const teamItemTypes = useMemo(() => visibleForTeam(itemTypes, f.mtn_dept), [itemTypes, f.mtn_dept]);
  const teamProblemTypes = useMemo(() => visibleForTeam(problemTypes, f.mtn_dept), [problemTypes, f.mtn_dept]);

  /* ── ลักษณะปัญหา 2 ชั้น: กลุ่มใหญ่ → หัวข้อย่อย (feedback ทีมงาน 2026-08-11) ──
     เดิม dropdown เดียว 29 ตัว "พนักงานเลือกค่อนข้างลำบาก"
     ⚠️ ต้องมีช่องค้นหาข้ามชั้นด้วย — ช่างที่แจ้งทุกวันรู้อยู่แล้วว่าจะเลือกอะไร
        การบังคับเลือกกลุ่มก่อนคือเพิ่มขั้นตอนให้เขา */
  const [probQ, setProbQ] = useState('');
  const NO_GROUP = 'อื่นๆ';
  const probGroups = useMemo(() => {
    const m = new Map();
    for (const p of teamProblemTypes) {
      const g = (p.group_name || '').trim() || NO_GROUP;
      if (!m.has(g)) m.set(g, []);
      m.get(g).push(p);
    }
    // กลุ่ม "อื่นๆ" ไปท้ายเสมอ
    return [...m.entries()].sort((a, b) => (a[0] === NO_GROUP ? 1 : b[0] === NO_GROUP ? -1 : 0));
  }, [teamProblemTypes]);
  const probHits = useMemo(() => {
    const q = probQ.trim().toLowerCase();
    if (!q) return null;
    return teamProblemTypes.filter(p =>
      [p.characteristic, p.detail, p.group_name].some(v => String(v || '').toLowerCase().includes(q)));
  }, [probQ, teamProblemTypes]);
  const subOf = useMemo(() => {
    if (!f.problem_group) return [];
    return teamProblemTypes.filter(p => ((p.group_name || '').trim() || NO_GROUP) === f.problem_group);
  }, [f.problem_group, teamProblemTypes]);

  // เลือกหัวข้อย่อย → เก็บทั้งกลุ่มและหัวข้อลงใบ (พาเรโต้จะได้จัดกลุ่มได้ 2 ระดับ)
  const onChar = (c) => {
    const pt = teamProblemTypes.find(x => x.characteristic === c);
    setF(p => ({ ...p, problem_characteristic: c, problem_group: (pt?.group_name || '').trim() || p.problem_group || '' }));
  };

  const save = async () => {
    if (!f.line_name) return toast.error('เลือกไลน์การผลิต');
    if (!f.item_type) return toast.error('เลือกชนิดอุปกรณ์');
    if (!f.problem_characteristic) return toast.error('เลือกลักษณะปัญหา (เลือกกลุ่มแล้วเลือกหัวข้อย่อยด้วย)');
    const occurredIso = f.occurred_at ? new Date(f.occurred_at).toISOString() : null;
    if (occurredIso && new Date(occurredIso) > new Date()) return toast.error('วันเวลาที่เกิดเหตุเป็นอนาคตไม่ได้');
    setSaving(true);
    try {
      // reported_by_uid: ให้ edge แจ้งกลับ "ผู้แจ้ง" ได้ทุกขั้น (เดิมหน้านี้ไม่เคยส่ง → ผู้แจ้งไม่ถูกแจ้งเลย มีแต่ใบที่เปิดจาก Daily Report)
      const { data: { user } = {} } = await supabase.auth.getUser();
      /* ช่องของฟอร์ม MTN — ทีมอื่นไม่ต้องเก็บ (ฟอร์ม FM-JIG-008 ไม่มีช่องพวกนี้)
         🔴 2026-09-15: ชื่อผู้จัดการ = "ผู้ที่ต้องเซ็น" เท่านั้น **ห้าม stamp เวลาเซ็นตรงนี้**
            เดิมกรอกชื่อแล้วระบบประทับ dept_manager_at ทันที ⇒ ด่านอนุมัติงานปรับปรุง/สร้าง
            จะผ่านเองตั้งแต่ผู้แจ้งพิมพ์ชื่อ (= ลายเซ็นปลอมบนใบพิมพ์) · เวลาเซ็นจริงมาจากปุ่ม
            "✍️ อนุมัติใบ MO" ในใบเท่านั้น (signApproval ใน DetailDrawer) */
      const nowIso2 = new Date().toISOString();
      const mtnForm = teamKeyOf(f.mtn_dept) === 'maintenance' ? {
        contact_phone: f.contact_phone || null, pr_no: f.pr_no || null, io_no: f.io_no || null,
        purpose: f.purpose || 'repair',
        dept_manager_name: f.dept_manager_name || null,
        plant_manager_name: needsPlantManager(f.purpose) ? (f.plant_manager_name || null) : null,
      } : {};
      const { contact_phone, pr_no, io_no, purpose, dept_manager_name, plant_manager_name, ...fRest } = f;  // eslint-disable-line no-unused-vars
      const payload = { ...fRest, ...mtnForm, want_at: f.want_at || null, repair_type: f.repair_type || null, occurred_at: occurredIso, status: 'pending', current_step: 1,
        report_at: nowIso2, work_date: getWorkDate(), reported_by_name: fullName, reported_by_uid: user?.id || null };
      let { data, error } = await supabaseDR.from('mtn_orders').insert(payload).select().single();
      // ยังไม่ apply migration (problem_group / occurred_at) → ตัดคอลัมน์เสริมแล้วลองใหม่ (แจ้งซ่อมต้องไม่พังเพราะฟีเจอร์เสริม)
      if (error?.code === '42703') {
        const { problem_group, occurred_at, contact_phone: _cp, pr_no: _pr, io_no: _io, purpose: _pp,
          dept_manager_name: _dm, plant_manager_name: _pm,
          ...rest } = payload;   // eslint-disable-line no-unused-vars
        ({ data, error } = await supabaseDR.from('mtn_orders').insert(rest).select().single());
        if (!error && occurredIso) toast.error('บันทึกใบแล้ว แต่ "วันเวลาที่เกิดเหตุ" ยังไม่ถูกเก็บ — ฐาน DR ยังไม่มีคอลัมน์ occurred_at (รัน migration 20260908_mtn_orders_occurred_at)');
      }
      if (error) return toast.error(error.message);
      if (beforeFile) { try { const blob = await resizeImage(beforeFile); const url = await uploadMtnImg(blob, `before/${data.id}-${Date.now()}.jpg`); await supabaseDR.from('mtn_orders').update({ before_img: url }).eq('id', data.id); data.before_img = url; } catch (e) { toast.error('อัปโหลดรูปไม่สำเร็จ: ' + e.message); } }
      notifyMtn(data, 'mtn_reported');
      toast.success('แจ้งซ่อมแล้ว รอ MTN รับงาน'); onSaved();
    } finally { setSaving(false); }   // รูปแปลงค้าง/เน็ตหลุด ปุ่มต้องปลดเสมอ (feedback 2026-09-08)
  };

  return (
    <ModalShell title="➕ แจ้งซ่อมใหม่ (Step 1)" onClose={onClose} dirty={dirty} wide>
      <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="แจ้งถึงทีมช่าง" required><select value={f.mtn_dept} onChange={e => set('mtn_dept', e.target.value)} style={{ ...inp, borderColor: 'var(--accent)', fontWeight: 700 }}><TeamOpts list={mtnDepts} /></select></Field>
        <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="ขอบเขตการซ่อม"><select value={f.repair_scope} onChange={e => set('repair_scope', e.target.value)} style={inp}>{SCOPE_OPTS.map(o => <option key={o.v} value={o.v}>{o.t}</option>)}</select></Field>
          <Field label="ประเภทงานซ่อม (BM/PM)">
            <select value={f.repair_type} onChange={e => set('repair_type', e.target.value)} style={inp}>
              <option value="">— ให้หัวหน้าช่างระบุ —</option>
              {teamRepairTypes.map(r => <option key={r.id} value={r.name}>{r.name} ({r.prefix})</option>)}
            </select>
          </Field>
        </div>
        {/* <LineSelect> = ลำดับชั้น + ปลดระวาง + ค่าเก่าไม่หายเงียบ (lines ถูก scope ไว้แล้วจากหน้าหลัก) · 2026-09-07 */}
        <Field label="ไลน์การผลิต" required><LineSelect lines={lines} value={f.line_name} onChange={onLine} placeholder="— เลือก —" style={inp} required /></Field>
        <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {/* ส่วนงาน (แผนกใต้ section) จากผังองค์กร cascade ตามแผนกที่เลือก (§5.3) — ว่างได้ · ค่าเก่านอกผังยังเลือกค้างได้ · 2026-09-07 */}
          <Field label="ส่วนงาน (ASSY)">
            <select value={f.work_area} onChange={e => set('work_area', e.target.value)} style={inp}>
              <option value="">— ไม่ระบุ —</option>
              {f.work_area && !deptsOf(f.dept_section).includes(f.work_area) && <option value={f.work_area}>⚠ {f.work_area} (ไม่มีในผัง)</option>}
              {deptsOf(f.dept_section).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          {/* แผนก = section จากผังองค์กร (default ตามไลน์ · เปลี่ยนได้เฉพาะผ่านตัวเลือก — คีย์ scope ของ mtnStepPerm) · 2026-09-07 */}
          <Field label="แผนก (PD)">
            <select value={f.dept_section} onChange={e => { setDirty(true); setF(p => ({ ...p, dept_section: e.target.value, work_area: '' })); }} style={inp}>
              <option value="">— เลือก —</option>
              {f.dept_section && !sectionOpts.includes(f.dept_section) && <option value={f.dept_section}>⚠ {f.dept_section} (ไม่มีในผัง)</option>}
              {sectionOpts.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <Field label="ชนิดอุปกรณ์" required><select value={f.item_type} onChange={e => onItem(e.target.value)} style={inp}><option value="">— เลือก —</option>{f.mtn_dept
          ? teamItemTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)
          : /* ยังไม่เลือกทีม = เห็นทุกทีมได้ แต่ต้องจัดกลุ่มบอกว่าของทีมไหน (เลือกแล้วระบบเติมทีมให้) */
            (() => {
              const g = new Map();
              teamItemTypes.forEach(t => {
                const k = t.team ? deptNameOf(t.team) : '🌐 ใช้ร่วมทุกทีม';
                if (!g.has(k)) g.set(k, []);
                g.get(k).push(t);
              });
              return [...g.entries()].sort((a, b) => (a[0].startsWith('🌐') ? 1 : b[0].startsWith('🌐') ? -1 : a[0].localeCompare(b[0], 'th')))
                .map(([label, items]) => <optgroup key={label} label={label}>{items.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}</optgroup>);
            })()}</select></Field>
        <Field label={wantDie ? `หมายเลขแม่พิมพ์ (${lineMachines.length} ตัว · ทุกไลน์)` : 'หมายเลขเครื่อง'}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            {/* <MachineSelect> แทน datalist — ค้นเลข/ชื่อ/ไลน์ · เครื่องของไลน์ที่เลือกขึ้นก่อน · พิมพ์เองได้พร้อมป้าย (2026-09-07) */}
            <MachineSelect value={f.machine_no} onChange={onMachinePick} machines={lineMachines} lines={lineFam} kinds={machineKinds} allowFree history={machineHist}
              placeholder={wantDie ? 'ค้นเลขแม่พิมพ์ / สแกน' : 'ค้นเลขเครื่อง / ชื่อ / สแกน'} style={{ flex: 1, minWidth: 0 }} inputStyle={{ background: 'var(--bg)' }} />
            <button type="button" className="tbtn" onClick={() => setScanOpen(true)} title="สแกน QR ที่ติดเครื่อง — เติมไลน์ให้อัตโนมัติ"
              style={{ flexShrink: 0, padding: '0 12px', height: 36, borderRadius: 8, border: '1.5px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: 16, cursor: 'pointer' }}>📷</button>
          </div>
          {wantDie && (
            <div style={{ fontSize: 11.5, color: lineMachines.length ? 'var(--muted)' : '#f59e0b', marginTop: 3 }}>
              {lineMachines.length
                ? '🔨 ลิสต์แม่พิมพ์ทั้งหมด (ไม่กรองตามไลน์ — แม่พิมพ์ถอดย้ายเครื่องได้) · พิมพ์เลขเพื่อค้น'
                : '⚠️ ยังไม่มีแม่พิมพ์ในทะเบียน — ลงข้อมูลที่ /die-registry ก่อน (พิมพ์เลขเองได้)'}
            </div>
          )}
        </Field>
        <Field label="ลักษณะปัญหา — กลุ่ม" required>
          <select value={f.problem_group} onChange={e => setF(p => ({ ...p, problem_group: e.target.value, problem_characteristic: '' }))} style={inp}>
            <option value="">— เลือกกลุ่ม —</option>
            {probGroups.map(([g, list]) => <option key={g} value={g}>{g} ({list.length})</option>)}
          </select>
        </Field>
        <Field label={`หัวข้อย่อย${subOf.length ? ` (${subOf.length})` : ''}`} required>
          <select value={f.problem_characteristic} onChange={e => onChar(e.target.value)} disabled={!f.problem_group} style={{ ...inp, ...(f.problem_group ? null : { background: 'var(--bg2)' }) }}>
            <option value="">{f.problem_group ? '— เลือกหัวข้อย่อย —' : 'เลือกกลุ่มก่อน'}</option>
            {subOf.map(p => <option key={p.id} value={p.characteristic}>{p.characteristic}</option>)}
          </select>
        </Field>
        {/* ค้นหาข้ามชั้น — ช่างที่รู้อยู่แล้วว่าจะเลือกอะไร ไม่ต้องไล่เลือกกลุ่มก่อน */}
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="🔍 หาเร็ว (พิมพ์อาการได้เลย ไม่ต้องเลือกกลุ่ม)">
            <input value={probQ} onChange={e => setProbQ(e.target.value)} placeholder="เช่น ลมรั่ว / พันช์ / เซนเซอร์" style={inp} />
          </Field>
          {probHits && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {probHits.length === 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>ไม่พบ — ลองคำอื่น หรือเลือกจากกลุ่มด้านบน</span>}
              {probHits.slice(0, 12).map(p => (
                <button key={p.id} type="button" onClick={() => { onChar(p.characteristic); setProbQ(''); }}
                  style={{ padding: '5px 10px', borderRadius: 7, fontSize: 12, cursor: 'pointer', border: '1.5px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                  {p.characteristic}<span style={{ color: 'var(--muted)', marginLeft: 5, fontWeight: 400 }}>· {(p.group_name || 'อื่นๆ')}</span>
                </button>))}
              {probHits.length > 12 && <span style={{ fontSize: 11.5, color: 'var(--muted)', alignSelf: 'center' }}>…อีก {probHits.length - 12}</span>}
            </div>
          )}
        </div>
        {/* ── ช่องที่มีเฉพาะบนฟอร์มกระดาษของทีม MTN (user 2026-09-15 "ใช้รูปแบบใบเดิม 100%") ──
            โชว์เฉพาะเมื่อแจ้งถึงทีม MTN — ทีม JIG/DIE ใช้ FM-JIG-008 ที่ไม่มีช่องพวกนี้ */}
        {teamKeyOf(f.mtn_dept) === 'maintenance' && <>
          <Field label="เบอร์ติดต่อ (ผู้แจ้ง)"><input value={f.contact_phone} onChange={e => set('contact_phone', e.target.value)} style={inp} placeholder="เช่น 183" /></Field>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="PR.No."><input value={f.pr_no} onChange={e => set('pr_no', e.target.value.toUpperCase())} maxLength={11} style={{ ...inp, fontFamily: 'monospace' }} /></Field>
            <Field label="I/O."><input value={f.io_no} onChange={e => set('io_no', e.target.value.toUpperCase())} maxLength={11} style={{ ...inp, fontFamily: 'monospace' }} /></Field>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="จุดประสงค์">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {PURPOSES.map(pp => { const on = (f.purpose || 'repair') === pp.key; return (
                  <button key={pp.key} type="button" onClick={() => set('purpose', pp.key)} style={{
                    padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border2)'}`,
                    background: on ? 'var(--accent)' : 'var(--bg2)', color: on ? '#071008' : 'var(--text2)' }}>{pp.label}</button>
                ); })}
              </div>
              {/* จุดประสงค์ไม่ใช่แค่ช่องติ๊กบนใบ — มันเปลี่ยนเส้นทางของใบจริง ต้องบอกผลตั้งแต่ตอนเลือก */}
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5, lineHeight: 1.6 }}>
                {needsApprovalFirst({ purpose: f.purpose || 'repair' })
                  ? <>🔒 <b style={{ color: 'var(--accent2)' }}>งานปรับปรุง/สร้าง</b> — ช่างจะรับงานได้หลังผู้จัดการเซ็นอนุมัติในใบ{needsPlantManager(f.purpose) ? ' (งานสร้างต้องผ่าน ผจก.โรงงานด้วย)' : ''} · ไม่ต้องผ่านการตรวจคุณภาพ (QA) หลังงานเสร็จ</>
                  : <>⚡ <b style={{ color: 'var(--accent)' }}>งานซ่อม/บริการ</b> — ช่างเริ่มงานได้ทันที ไม่ต้องรออนุมัติ (ผู้จัดการเซ็นรับทราบตามหลังได้) · งานเสร็จแล้วต้องผ่าน QA ตามปกติ</>}
              </div>
            </Field>
          </div>
          <Field label="ผู้จัดการต้นสังกัด (ผู้ที่ต้องเซ็นอนุมัติ)"><PersonSelect value={f.dept_manager_name} source="both" section={f.dept_section} onChange={res => set('dept_manager_name', res.name)} inputStyle={{ background: 'var(--bg)' }} placeholder="ค้นชื่อผู้จัดการ" /></Field>
          {needsPlantManager(f.purpose) && (
            <Field label="ผู้จัดการโรงงาน (งานสร้างต้องเซ็นด้วย)"><PersonSelect value={f.plant_manager_name} source="both" onChange={res => set('plant_manager_name', res.name)} inputStyle={{ background: 'var(--bg)' }} placeholder="ค้นชื่อผู้จัดการโรงงาน" /></Field>
          )}
        </>}
        {/* Cost Center derive จากไลน์ (production_lines.cost_center / ไลน์แม่) เท่านั้น — เลิกให้พิมพ์ทับ (2026-09-07) */}
        <Field label="Cost Center (จากฐานข้อมูลไลน์)"><input value={f.cost_center} readOnly style={{ ...inp, background: 'var(--bg2)', color: 'var(--text2)' }} placeholder="auto จากไลน์ — ตั้งที่ /linesetup" title="อ่านจากทะเบียนไลน์ — แก้ที่ตั้งค่าไลน์" /></Field>
        <DateField label="วันที่ต้องการให้เสร็จ" value={f.want_at} onChange={v => set('want_at', v)} />
        <Field label="วันเวลาที่เกิดเหตุ (กรอกเฉพาะแจ้งย้อนหลัง)">
          <input type="datetime-local" value={f.occurred_at} onChange={e => set('occurred_at', e.target.value)} max={localDtNow()} style={inp} />
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>ว่าง = เกิดเหตุตอนนี้ · เวลาที่กดแจ้งยังถูกบันทึกแยกไว้ใช้คิด Response time/เลข MO</div>
        </Field>
        {/* ลูกค้า = <CustomerSelect> (รายชื่อจาก Product Master · พิมพ์ใหม่ได้พร้อมป้าย) · โมเดลไม่มี master — พิมพ์เอง (2026-09-07) */}
        <Field label="โมเดล / ลูกค้า"><div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}><input value={f.model} onChange={e => set('model', e.target.value)} style={{ ...inp, flex: 1, minWidth: 0 }} placeholder="โมเดล" /><CustomerSelect value={f.customer} onChange={res => set('customer', res.customer)} history={customerHist} placeholder="ลูกค้า" style={{ flex: 1, minWidth: 0 }} inputStyle={{ background: 'var(--bg)' }} /></div></Field>
        <div style={{ gridColumn: '1 / -1' }}><Field label="ระบุรายละเอียดปัญหา (พิมพ์เอง)"><textarea value={f.report_note} onChange={e => set('report_note', e.target.value)} style={{ ...inp, minHeight: 60 }} /></Field></div>
        {/* ชื่อคน = <PersonSelect> (profiles + employees · คนของไลน์/แผนกที่เลือกขึ้นก่อน) — เก็บ snapshot ชื่อเหมือนเดิม
            ตัวตนจริงของผู้เปิดใบยังเป็น reported_by_name (stamp ตอนบันทึก) · 2026-09-07 */}
        <Field label="ผู้แจ้ง (ผลิต)"><PersonSelect value={f.reporter_prod} source="both" lines={lineFam} section={f.dept_section} history={reporterHist} onChange={res => set('reporter_prod', res.name)} inputStyle={{ background: 'var(--bg)' }} /></Field>
        <Field label="ผู้แจ้ง (คุณภาพ)"><PersonSelect value={f.reporter_qa} source="both" roles={QA_ROLES} section="QA" onChange={res => set('reporter_qa', res.name)} inputStyle={{ background: 'var(--bg)' }} placeholder="ค้นชื่อ QA (เว้นว่างได้)" /></Field>
        <div style={{ gridColumn: '1 / -1' }}><ImgField label="รูปก่อนซ่อม" value={beforeUrl} onPick={pickBefore} /></div>
        <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)' }}><input type="checkbox" checked={f.is_sample} onChange={e => set('is_sample', e.target.checked)} /> งานตัวอย่าง</label>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={tryClose} style={btnGhost}>ยกเลิก</button>
        <button onClick={save} disabled={saving} style={btnPri}>{saving ? 'บันทึก…' : 'บันทึกใบแจ้งซ่อม'}</button>
      </div>
      {scanOpen && (
        <ScanModal
          title="สแกนเครื่องจักร"
          hint="ส่องกล้องที่ป้าย QR บนเครื่อง หรือยิงด้วยเครื่องสแกน — ระบบจะเติมไลน์ให้เอง"
          onScan={onScanMachine}
          onClose={() => setScanOpen(false)}
        />
      )}
    </ModalShell>
  );
}

/* ขั้นถัดไปของใบ — ป้ายปุ่มมาจาก stepLabel() (mtnStepPerm.js) ห้ามพิมพ์ชื่อขั้นซ้ำที่นี่
   ⚠️ ไม่มี field `perm` แล้ว — สิทธิ์ตัดสินด้วย canDoStep() ซึ่งดูทั้งคีย์/ทีม/ผู้เปิดใบ */
function nextStepFor(order) {
  const mtnForm = isMtnFormOrder(order);
  const S = (step) => ({ step, label: stepLabel(step, { mtnForm }) });
  switch (order.status) {
    case 'pending':   return S(2);
    case 'assigned':
    case 'repairing': return S(3);
    case 'repaired':  return S(4);
    case 'checked':   return isWaitingQa(order) ? S(5) : S(6);   // ขั้น 5 มีเงื่อนไข — ข้ามได้ด้วยปุ่ม ⏭ (canSkipQa)
    case 'qa':        return S(6);
    // ใบ MTN: ขั้น 7 (ผจก.แผนกที่แจ้ง) ไม่ปิดใบ — status คง handover ⇒ แยกขั้นถัดไปด้วย current_step
    case 'handover':  return mtnForm && Number(order.current_step || 0) >= 7 ? S(8) : S(7);
    default:          return null;
  }
}

/* ช่อง "5.คุณภาพ" ในใบพิมพ์: ใบที่ไม่ต้องตรวจ QA ต้องพิมพ์ว่า "ไม่เกี่ยวกับคุณภาพ" ไม่ใช่ปล่อยว่าง
   (ว่าง = ผู้ตรวจสอบอ่านว่า "ยังไม่ได้ตรวจ") · ครอบคลุมทั้งใบที่กด ⏭ และใบที่ขั้น 4 ระบุไม่เกี่ยว */
const qaSkippedPrint = (o) => moQaState(o) === 'skipped';

/* ── พิมพ์ใบ MO — เลือก layout ตามทีมช่าง (JIG/DIE = FM-JIG-008 · MTN/PRODUCTION = FM-MTN-006) ── */
function printMoReport(o, dparts = [], logo0, dlabor = []) {
  const teamKey = teamKeyOf(o.mtn_dept || deptForItem(o.item_type));
  // เฉพาะทีม MTN ใช้ฟอร์ม FM-MTN-006 · JIG MTN / DIE MTN / PRODUCTION ใช้ FM-JIG-008 เดิม (คำสั่ง user 2026-07-22)
  if (teamKey === 'maintenance') return printMoReportMtn(o, dparts, logo0, dlabor);
  const dept = deptNameOf(teamKey);   // ใบพิมพ์แสดง "ชื่อทีม" ไม่ใช่ key
  // เลขฟอร์ม/Rev/Effective จากทะเบียนเอกสาร (/doc-forms) — fallback ค่าเดิม
  const dfMo = docFormSync('mo_report', { form_code: 'FM-JIG-008', rev: 'REV.00', effective_date: '05/12/2025', sig_blocks: ['JIG APPROVE', 'QA APPROVE', 'PD APPROVE', 'MGR APPROVE'] });
  const moSig = dfMo.sig_blocks || ['JIG APPROVE', 'QA APPROVE', 'PD APPROVE', 'MGR APPROVE'];
  const beDT = (v) => { if (!v) return ''; const d = new Date(v); const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d); const g = {}; p.forEach(x => g[x.type] = x.value); return `${+g.day}/${+g.month}/${+g.year + 543} ${g.hour === '24' ? '00' : g.hour}:${g.minute}:${g.second}`; };
  const beD = (v) => { if (!v) return ''; const d = new Date(v); const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d); const g = {}; p.forEach(x => g[x.type] = x.value); return `${+g.day}/${+g.month}/${+g.year + 543}`; };
  const esc = (s) => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const L = (k, v) => `<div class="f"><span class="fk">${k}</span> <span class="fv">${esc(v)}</span></div>`;
  const statusTh = statusMetaOf(o).label?.replace(/^[^฀-๿]+/, '').trim() || o.status;
  const logo = logo0 || (/^https?:/.test(tsLogo) ? tsLogo : location.origin + tsLogo);
  // ป้ายหัวช่องเซ็น 4 ช่อง — ไล่เฉดเทาอ่อน→เข้ม ตามฟอร์มกระดาษ (ช่องสุดท้ายพื้นเข้ม ตัวอักษรขาว)
  const SG_BG = ['#d9d9d9', '#b7b7b7', '#999999', '#666666'];
  const SG_W = ['26.4%', '23.8%', '25.5%', '24.3%'];   // ความกว้าง 4 ช่องตามฟอร์มจริง (ไม่ใช่ 25% เป๊ะ)
  const sign = (title, name, url, dt, i) => `<td class="sg" style="width:${SG_W[i]}"><div class="sgh" style="background:${SG_BG[i]}${i === 3 ? ';color:#fff' : ''}">${title}</div><div class="sgimg">${url ? `<img src="${esc(url)}"/>` : ''}</div><div class="sgn">${esc(name || '')}</div><div class="sgd">${dt ? beDT(dt) : ''}</div></td>`;
  // แถวคู่ซ้าย/ขวาในคอลัมน์ (ตารางไร้เส้น) — จุดแบ่งคอลัมน์ย่อย 53% ตามฟอร์มจริง
  const P = (a, b) => `<table class="in"><tr><td style="width:53%">${a}</td><td>${b}</td></tr></table>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>MO ${esc(o.mo_no || '')}</title><style>
    /* ── FM-JIG-008 — พิกัด/สี/ความสูงถอดจากฟอร์มกระดาษต้นฉบับ (หน่วย pt เท่าไฟล์จริง) ── */
    @page{size:A4;margin:37pt 28pt 0}
    *{box-sizing:border-box}
    body{font-family:'Sarabun','Tahoma',sans-serif;color:#000;margin:0;padding:37pt 28pt 0;font-size:8pt}
    table{border-collapse:collapse;width:100%;table-layout:fixed}
    td{border:1px solid #000;vertical-align:top;padding:2pt 3pt}
    table.in,table.in td{border:none;padding:0}
    .sech{background:#b7b7b7;text-align:center;font-weight:700;height:24pt;vertical-align:middle;padding:2pt}
    .sech b{font-size:8.5pt} .sech .en{font-size:8pt;font-weight:700}
    .f{padding:0 0 9.6pt;font-size:8pt;line-height:1.3} .fk{font-weight:700}
    .co{font-size:5.5pt;white-space:nowrap} .ttl{text-align:center;font-size:10.5pt;font-weight:700;background:#b7b7b7;vertical-align:middle}
    .mo{font-size:9.5pt;font-weight:700;vertical-align:middle}
    .hdr td{height:23pt;vertical-align:middle;padding:1pt 3pt}
    .imgcell{height:158pt;text-align:center;padding:2pt;vertical-align:middle} .imgcell img{max-width:100%;max-height:154pt}
    .q td{height:83pt}
    .signs td{text-align:center;padding:0;vertical-align:top}
    .sgh{font-weight:700;font-size:8pt;height:24pt;line-height:24pt;border-bottom:1px solid #000}
    .sgimg{height:64pt;display:flex;align-items:center;justify-content:center} .sgimg img{max-height:60pt;max-width:92%}
    .sgn{font-size:8pt;height:22pt;line-height:22pt;border-top:1px dotted #000;border-bottom:1px solid #000}
    .sgd{font-size:8pt;height:23pt;line-height:23pt}
    .ft{display:flex;justify-content:space-between;font-size:7.5pt;margin-top:9pt}
    @media print{body{padding:0}}
  </style></head><body>
  <table>
    <tr class="hdr">
      <td rowspan="2" style="width:9.85%;vertical-align:middle;text-align:center"><img src="${esc(logo)}" style="max-width:100%;max-height:40pt"/></td>
      <td style="width:25.09%" class="co">บริษัท ไทยซัมมิท โอโตโมทีฟ จำกัด สาขา 1</td>
      <td class="ttl" colspan="2" style="width:32.53%">ใบแจ้งซ่อมและปรับปรุง ${esc(dept)}</td>
      <td class="mo" style="width:32.53%">MO NO: ${esc(o.mo_no || '-')}</td>
    </tr>
    <tr class="hdr">
      <td colspan="2"><span class="fk">แจ้งถึงหน่วยงาน:</span> ${esc(dept)}</td>
      <td colspan="2"><span class="fk">สถานะดำเนินการ:</span> ${esc(statusTh)}</td>
    </tr>
  </table>
  <table>
    <tr><td class="sech" style="width:50.2%"><b>1 [OPEN MO]</b> <span class="en">ส่วนผู้แจ้ง</span></td>
        <td class="sech" style="width:49.8%"><b>2 [ACCEPT/ASSIGN]</b> <span class="en">ส่วนผู้รับงาน</span></td></tr>
    <tr>
      <td rowspan="3">
        ${P(L('ส่วน:', o.work_area), L('แผนก:', o.dept_section))}
        ${P(L('ไลน์การผลิต:', o.line_name), L('Cost Ctr:', o.cost_center))}
        ${P(L('PD:', o.reporter_prod), L('QA:', o.reporter_qa))}
        ${L('MC Name:', o.item_type)}${L('Jig No:', o.machine_no)}
        ${P(L('Customer:', o.customer), L('Model:', o.model))}
        ${P(L('วันที่แจ้ง:', beDT(o.report_at)), L('ต้องการ:', beD(o.want_at)))}${o.occurred_at ? L('เกิดเหตุ:', beDT(o.occurred_at)) : ''}
        ${L('ลักษณะปัญหา:', o.problem_characteristic)}${L('รายละเอียด:', o.report_note || o.problem_detail)}
      </td>
      <td style="height:102pt">${L('วันที่รับงาน:', beDT(o.accept_at))}
        ${P(L('ผู้รับงาน:', o.accepted_by), L('ผู้รับผิดชอบ:', o.assigned_to))}
        ${L('วันที่คาดการณ์เสร็จ:', beDT(o.target_done_at))}${L('ประเภทงานซ่อม:', o.repair_type)}${L('รายละเอียด:', o.assign_note)}${o.reject_reason ? L('เหตุ Reject:', o.reject_reason) : ''}</td>
    </tr>
    <tr><td class="sech" style="height:20pt"><b>3 [REPAIR]</b> <span class="en">ส่วนผู้ซ่อม</span></td></tr>
    <tr><td style="height:99pt">${L('วันที่เสร็จ:', beDT(o.repair_done_at))}
        ${P(L('ผู้ซ่อมหลัก:', o.tech_main), L('ผู้ซ่อมรอง:', o.tech_secondary))}
        ${L('สาเหตุปัญหา:', o.root_cause)}${L('วิธีการแก้ไข:', o.solution)}${dparts.length ? L('อะไหล่:', dparts.map(p => `${p.part_name} ×${p.qty}${p.unit || ''}`).join(', ')) : ''}</td></tr>
  </table>
  <table>
    <tr><td class="sech" style="width:50.2%;height:21pt"><b>[BEFORE IMPROVEMENT]</b> <span class="en">ภาพปัญหาก่อนปรับปรุง</span></td>
        <td class="sech" style="width:49.8%;height:21pt"><b>[AFTER IMPROVEMENT]</b> <span class="en">ภาพปัญหาหลังปรับปรุง</span></td></tr>
    <tr><td class="imgcell">${o.before_img ? `<img src="${esc(o.before_img)}"/>` : ''}</td><td class="imgcell">${o.after_img ? `<img src="${esc(o.after_img)}"/>` : ''}</td></tr>
  </table>
  <table>
    <tr><td class="sech" style="width:50.2%;height:25pt"><b>4&5 [CONFIRM QUALITY]</b> <span class="en">ยืนยันคุณภาพ</span></td>
        <td class="sech" style="width:49.8%;height:25pt"><b>6 [ACCEPT]</b> <span class="en">รับมอบหลังซ่อม</span></td></tr>
    <tr class="q"><td>${L('4.ผลงานหลังแก้ไข:', o.check_result)}${L('4.รายละเอียด:', o.check_note)}${L('5.คุณภาพหลังการแก้ไข:', o.qa_result || (qaSkippedPrint(o) ? 'ไม่เกี่ยวกับคุณภาพ (ไม่ต้องตรวจ QA)' : ''))}${L('5.รายละเอียด', o.qa_note || (qaSkippedPrint(o) ? `${o.qa_skip_reason || QA_SKIP_REASON_STEP4}${o.qa_skipped_by ? ` — ${o.qa_skipped_by}` : ''}` : ''))}</td>
        <td>${L('สถานะ:', o.follow_up)}${L('ผู้แจ้ง:', o.ho_reporter || o.reporter_prod)}${L('รายละเอียด:', '')}</td></tr>
  </table>
  <table class="signs">
    <tr>${sign(moSig[0], o.checker_name, o.checker_sign, o.check_at, 0)}${sign(moSig[1], o.qa_checker, o.qa_sign, o.qa_at, 1)}${sign(moSig[2], o.ho_checker, o.ho_sign, o.ho_at, 2)}${sign(moSig[3], o.approver_name, o.approve_sign, o.approve_at, 3)}</tr>
  </table>
  <div class="ft"><span>${[dfMo.form_code, dfMo.rev].filter(Boolean).join('-')}${dfMo.footer_note ? ' · ' + dfMo.footer_note : ''}</span><span>${dfMo.effective_date ? 'Effective : ' + dfMo.effective_date : ''}</span></div>
  <script>window.onload=function(){setTimeout(function(){window.print()},500)}</script>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast.error('เบราว์เซอร์บล็อกหน้าต่าง — อนุญาต popup แล้วลองใหม่'); return; }
  w.document.write(html); w.document.close();
}

/* ── พิมพ์ใบ MO ทีม MTN — ถอดจากฟอร์มกระดาษจริง 1:1 (2026-09-15) ────────────────────
   คำสั่ง user: "ต้องทำทั้งหมด เพราะ MTN จะใช้รูปแบบใบเดิมเหมือน 100%"
   ต้นฉบับ = ใบ "ใบสั่งงานซ่อมบำรุง M/O" ที่ user ถ่ายมา (MO.No. MTN.2026/06-59)
   เรียงบล็อกตามกระดาษเป๊ะ: หัวใบ → ผู้แจ้ง+ผู้อนุมัติต้นสังกัด → ขั้นตอนดำเนินการ
   → ค่าใช้จ่าย (ค่าแรงรายคน | อะไหล่รายรายการ) → ความพึงพอใจ + ลายเซ็นท้าย → ความคิดเห็น
   ⚠️ รูปก่อน/หลังไม่มีในกระดาษ → ไปหน้า 2 และพิมพ์เฉพาะเมื่อมีรูปจริง (หน้าแรกต้องเหมือนต้นฉบับ)
   ⚠️ สูตรรวมเงิน/คะแนนอ่านจาก `src/utils/mtnMoForm.js` ที่เดียว ห้ามคิดเลขซ้ำที่นี่ */
function printMoReportMtn(o, dparts = [], logo0, dlabor = []) {
  const df = docFormSync('mo_report_mtn', { form_code: 'FM-MTN-006', rev: '', effective_date: '', footer_note: 'MAINTENANCE ORDER MO31 08 2015.xls' });
  const beDT = (v) => { if (!v) return ''; const d = new Date(v); const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d); const g = {}; p.forEach(x => g[x.type] = x.value); return `${+g.day}/${+g.month}/${(+g.year + 543) % 100} ${g.hour === '24' ? '00' : g.hour}:${g.minute}`; };
  const beD = (v) => { if (!v) return ''; const d = new Date(v); const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d); const g = {}; p.forEach(x => g[x.type] = x.value); return `${+g.day} / ${+g.month} / ${(+g.year + 543) % 100}`; };
  const beTime = (v) => { if (!v) return ''; const d = new Date(v); const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d); const g = {}; p.forEach(x => g[x.type] = x.value); return `${g.hour === '24' ? '00' : g.hour}.${g.minute}`; };
  const esc = (s) => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const money = (v) => (v == null ? '' : Number(v).toLocaleString('en-US'));
  const dept = deptNameOf(o.mtn_dept || deptForItem(o.item_type));
  const logo = logo0 || (/^https?:/.test(tsLogo) ? tsLogo : location.origin + tsLogo);
  const done = o.status === 'closed' || o.current_step >= 3;
  const chk = (on) => (on ? '☑' : '☐');
  /* จุดประสงค์: ใช้ค่าที่กรอก · ใบเก่าที่ยังไม่มี purpose ให้เดาจาก repair_type เหมือนเดิม
     ⚠️ ตัวเดา (purposeOfPrint) ใช้ได้เฉพาะช่องติ๊กบนใบ — ด่านอนุมัติ/ด่าน QA ต้องดูค่าดิบเท่านั้น */
  const purpose = purposeOfPrint(o);
  // ช่องกริด PR.No / I/O. — 11 ช่องตามฟอร์ม กระจายตัวอักษรทีละช่อง
  const grid = (v, n = 11) => { const t = String(v || ''); let h = ''; for (let i = 0; i < n; i++) h += `<td class="gx">${esc(t[i] || '')}</td>`; return `<table class="gr"><tr>${h}</tr></table>`; };
  const line = (label, v, w = '') => `<span class="lb">${label}</span><span class="dot" style="${w ? `min-width:${w}` : ''}">${esc(v ?? '')}</span>`;
  // ลายเซ็น: รูปเซ็น (ถ้ามี) + ชื่อ + วันที่ __/__/__
  const sg = (title, name, url, at, note = '') => `<div class="sgb"><div class="sgi">${url ? `<img src="${esc(url)}"/>` : ''}</div><div class="sgt">${esc(title)}</div><div class="sgn">${esc(name || '')}</div><div class="sgd">${at ? esc(beD(at)) : '....../....../......'}</div>${note ? `<div class="sgx">${esc(note)}</div>` : ''}</div>`;

  /* ── ตารางค่าแรง 5 แถวตามฟอร์ม (เกิน 5 ต่อท้ายได้ ไม่ตัดข้อมูลทิ้ง) ── */
  const laborList = (dlabor || []).filter(r => r && (r.worker_name || r.amount != null || r.rate_per_hour != null));
  const laborRowsN = Math.max(5, laborList.length);
  let laborHtml = '';
  for (let i = 0; i < laborRowsN; i++) {
    const r = laborList[i];
    const amt = r ? laborAmount(r) : null;
    laborHtml += `<tr><td class="c">${i + 1}</td><td>${esc(r?.worker_name || '')}</td><td class="c">${r && r.rate_per_hour != null ? `${money(r.rate_per_hour)} x ${r.hours ?? ''}` : ''}</td><td class="r">${money(amt)}</td></tr>`;
  }
  /* ── ตารางอะไหล่ 5 แถวตามฟอร์ม ── */
  const partList = dparts || [];
  const partRowsN = Math.max(5, partList.length);
  let partHtml = '';
  for (let i = 0; i < partRowsN; i++) {
    const p = partList[i];
    partHtml += `<tr><td class="c">${i + 1}</td><td>${esc(p?.part_name || '')}</td><td class="c">${p ? esc(`${p.qty ?? ''} ${p.unit || ''}`.trim()) : ''}</td><td class="r">${money(p ? partAmount(p) : null)}</td></tr>`;
  }
  const sumL = sumLabor(laborList) ?? (o.labor_cost != null ? Number(o.labor_cost) : null);
  const sumP = sumParts(partList) ?? (o.parts_cost != null ? Number(o.parts_cost) : null);
  const sumAll = grandTotal(laborList, partList, o.labor_cost, o.parts_cost);

  /* ── ความพึงพอใจ: สเกล พอใช้(1) ปานกลาง(2) ดี(3) ตามกระดาษ ── */
  const sat = o.satisfaction || {};
  const satHtml = SAT_DIMS.map((d, i) => {
    const v = Number(sat[d.key]);
    return `<tr><td>${i + 1}. ${esc(d.label)}</td><td class="c">${v === 1 ? '✗' : '<span class="g">1</span>'}</td><td class="c">${v === 2 ? '✗' : '<span class="g">2</span>'}</td><td class="c">${v === 3 ? '✗' : '<span class="g">3</span>'}</td></tr>`;
  }).join('');
  const ss = satScore(sat, SAT_DIMS.map(d => d.key));

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>MO ${esc(o.mo_no || '')}</title><style>
    /* ── ถอดสัดส่วนจากฟอร์มกระดาษ (A4 แนวตั้ง 1 หน้า) ── */
    @page{size:A4;margin:10mm 8mm}
    *{box-sizing:border-box}
    body{font-family:'Sarabun','Tahoma',sans-serif;color:#000;margin:0;font-size:10px;line-height:1.45}
    table{border-collapse:collapse;width:100%;table-layout:fixed}
    td{border:1px solid #000;vertical-align:top;padding:2px 4px}
    .nob,.nob td,.gr,.gr td{border:none}
    .nob td{padding:0}
    .lb{font-weight:400}
    .dot{display:inline-block;border-bottom:1px dotted #555;min-width:70px;padding:0 3px;font-weight:700}
    .gr{width:auto;display:inline-table;margin-left:3px}
    .gr td{border:1px solid #000;width:13px;height:13px;text-align:center;font-size:9px;padding:0}
    .c{text-align:center} .r{text-align:right} .g{color:#bbb}
    .sec{background:#fff;text-align:center;font-weight:700;padding:2px}
    .hdco{font-size:11px;font-weight:700} .hden{font-size:9px}
    .mono{font-weight:700;letter-spacing:.3px}
    .tb th{border:1px solid #000;font-weight:700;padding:2px;font-size:9.5px;text-align:center}
    .sgb{text-align:center;padding:1px 2px}
    .sgi{height:26px;display:flex;align-items:flex-end;justify-content:center}
    .sgi img{max-height:26px;max-width:95%}
    .sgt{font-size:9px;border-top:1px dotted #555;padding-top:1px}
    .sgn{font-size:9.5px;font-weight:700;min-height:12px}
    .sgd{font-size:9px}
    .sgx{font-size:8px;color:#333}
    .note{min-height:34px}
    .ft{display:flex;justify-content:space-between;font-size:8.5px;margin-top:3px}
    .ph{page-break-before:always}
    .phc{height:340px;text-align:center;padding:4px} .phc img{max-width:100%;max-height:334px}
    @media print{body{padding:0}}
  </style></head><body>

  <!-- ══ หัวใบ ══ -->
  <table>
    <tr>
      <td style="width:62%;padding:3px 5px">
        <table class="nob"><tr>
          <td style="width:52px"><img src="${esc(logo)}" style="width:46px"/></td>
          <td><div class="hdco">บริษัท ไทยซัมมิท โอโตโมทีฟ จำกัด</div><div class="hden">Thai Summit  Automotive Co.,Ltd</div></td>
        </tr></table>
      </td>
      <td style="width:38%;padding:3px 5px" class="mono">MO.No. <span class="dot" style="min-width:150px">${esc(o.mo_no || '')}</span></td>
    </tr>
  </table>
  <table>
    <tr>
      <td style="width:78%;padding:3px 5px">
        <div>เรียน &nbsp;ผู้จัดการส่วนซ่อมบำรุง</div>
        <div style="margin-top:2px">${line('จากฝ่าย/ส่วน', o.work_area, '95px')} &nbsp;${line('แผนก', o.dept_section, '75px')} &nbsp;${line('เบอร์ติดต่อ', o.contact_phone, '45px')} &nbsp;${line('Cost Center', o.cost_center, '85px')}</div>
        <div style="margin-top:3px">PR.No. ${grid(o.pr_no)} &nbsp;&nbsp; I/O. ${grid(o.io_no)}</div>
        <div style="margin-top:3px">${line('ชื่อเครื่องจักร', o.item_type, '135px')} ${line('เบอร์', o.machine_no, '80px')}
          จุดประสงค์ (${purpose === 'repair' ? '✓' : '&nbsp;'}) ซ่อม (${purpose === 'improve' ? '✓' : '&nbsp;'}) ปรับปรุง (${purpose === 'service' ? '✓' : '&nbsp;'}) บริการ (${purpose === 'build' ? '✓' : '&nbsp;'}) สร้าง</div>
      </td>
      <td style="width:22%;padding:3px 5px">
        <div>${chk(!done)} รอดำเนินการ</div>
        <div style="margin-top:4px">${chk(done)} ดำเนินการแล้ว</div>
      </td>
    </tr>
  </table>

  <!-- ══ ส่วนผู้แจ้ง + อนุมัติต้นสังกัด ══ -->
  <table>
    <tr>
      <td style="width:62%;height:118px">
        <div>รายละเอียด (ผู้แจ้งซ่อม) &nbsp;&nbsp;${line('เป้าหมาย', beD(o.want_at), '95px')} ${line('เวลา', beTime(o.want_at), '45px')}</div>
        <div style="margin-top:4px;font-weight:700">${esc(o.problem_characteristic || '')}</div>
        <div style="white-space:pre-wrap">${esc(o.report_note || o.problem_detail || '')}</div>
      </td>
      <td style="width:19%;padding:0">${sg('ผู้ออก M/O (ตัวบรรจง)', o.reported_by_name || o.reporter_prod, null, o.report_at)}</td>
      <td style="width:19%;padding:0">${sg('ผู้จัดการต้นสังกัด', o.dept_manager_name, o.dept_manager_sign, o.dept_manager_at)}</td>
    </tr>
    <tr>
      <td rowspan="2" style="border-top:none"></td>
      <td colspan="2" style="padding:0">${sg('ผู้จัดการโรงงาน', o.plant_manager_name, o.plant_manager_sign, o.plant_manager_at, 'MO. สร้าง ส่ง ผจก.โรงงานอนุมัติ')}</td>
    </tr>
  </table>

  <!-- ══ ขั้นตอนการดำเนินการและแก้ไข ══ -->
  <table>
    <tr><td class="sec" colspan="2">ขั้นตอนการดำเนินการและแก้ไข (ซ่อมบำรุง)</td></tr>
    <tr>
      <td style="width:62%">
        <div>สาเหตุเกิดจาก
          (${o.cause_category === 'man' ? '✓' : '&nbsp;'}) คน
          (${o.cause_category === 'method' ? '✓' : '&nbsp;'}) วิธีการทำงาน
          (${o.cause_category === 'part_life' ? '✓' : '&nbsp;'}) อายุอะไหล่
          (${o.cause_category === 'other' ? '✓' : '&nbsp;'}) อื่นๆ <span class="dot" style="min-width:60px">${esc(o.cause_other || '')}</span></div>
        <div style="margin-top:4px">${line('รายละเอียด', o.assign_note || o.problem_detail, '330px')}</div>
        <div style="margin-top:4px">${line('สาเหตุ', o.root_cause, '355px')}</div>
        <div style="margin-top:4px">${line('การแก้ไข', o.solution, '345px')}</div>
        <div style="margin-top:4px">${line('วันที่เริ่ม', beD(o.repair_start_at), '75px')} ${line('เวลา', beTime(o.repair_start_at), '40px')}
          ${line('วันที่เสร็จ', beD(o.repair_done_at), '75px')} ${line('เวลา', beTime(o.repair_done_at), '40px')}</div>
      </td>
      <td style="width:38%;padding:0">
        <div style="padding:2px 4px;border-bottom:1px solid #000">${line('วันที่รับแจ้ง', beD(o.report_at), '85px')} ${line('เวลา', beTime(o.report_at), '40px')}</div>
        <table class="nob" style="table-layout:fixed"><tr>
          <td style="width:50%;border-right:1px solid #000">${sg('ผู้รับ MO (ซ่อมบำรุง)', o.accepted_by, null, o.accept_at)}</td>
          <td style="width:50%">${sg('ผู้อนุมัติ (ผจก.ส่วนซ่อมบำรุง)', o.mo_approved_by, o.mo_approve_sign, o.mo_approved_at)}</td>
        </tr></table>
      </td>
    </tr>
  </table>

  <!-- ══ ค่าใช้จ่าย ══ -->
  <table><tr><td class="sec">ค่าใช้จ่ายในการดำเนินการ</td></tr></table>
  <table style="table-layout:fixed"><tr>
    <td style="width:50%;padding:0;border-right:none">
      <table class="tb">
        <tr><th colspan="4">ค่าแรงในการปฏิบัติงาน</th></tr>
        <tr><th style="width:34px">ลำดับ</th><th>ชื่อผู้ปฏิบัติงาน</th><th style="width:74px">ค่าแรง/ชม.</th><th style="width:62px">ราคา</th></tr>
        ${laborHtml}
        <tr><td colspan="3" style="font-size:8.5px">ค่าแรง : วิศวกร = 200 บาท/ช.ม., ช่างเทคนิค = 100 บาท/ช.ม. &nbsp;<b>(1) รวมค่าแรง</b></td><td class="r"><b>${money(sumL)}</b></td></tr>
      </table>
    </td>
    <td style="width:50%;padding:0">
      <table class="tb">
        <tr><th colspan="4">ค่าอะไหล่และอุปกรณ์</th></tr>
        <tr><th style="width:34px">ลำดับ</th><th>รายการ</th><th style="width:74px">จำนวน/หน่วย</th><th style="width:62px">ราคา</th></tr>
        ${partHtml}
        <tr><td colspan="3"><b>(2) รวมค่าอะไหล่และอุปกรณ์</b></td><td class="r"><b>${money(sumP)}</b></td></tr>
      </table>
    </td>
  </tr></table>
  <table><tr><td style="text-align:right;padding:2px 6px"><b>รวมค่าแรงและค่าอะไหล่ &nbsp;(1) + (2) &nbsp;=&nbsp; <span class="dot" style="min-width:90px">${money(sumAll)}</span></b></td></tr></table>

  <!-- ══ ความพึงพอใจ + ลายเซ็นท้ายใบ ══ -->
  <table style="table-layout:fixed"><tr>
    <td style="width:50%">
      <div style="font-weight:700">แบบสำรวจความพึงพอใจหลังการปฏิบัติงานของหน่วยงานซ่อมบำรุง</div>
      <div style="font-size:9px">กรุณาใส่เครื่องหมาย x ลงในช่องคะแนน</div>
      <table class="tb" style="margin-top:2px">
        <tr><th style="text-align:left">ความพึงพอใจ</th><th style="width:46px">พอใช้</th><th style="width:52px">ปานกลาง</th><th style="width:40px">ดี</th></tr>
        ${satHtml}
      </table>
      <div style="margin-top:3px">${line('คะแนนรวม', ss.sum == null ? '' : `${ss.sum}/${ss.max}`, '60px')} ${line('คิดเป็น', ss.pct == null ? '' : `${ss.pct} %`, '55px')} ${line('ลงชื่อผู้ประเมิน', o.satisfaction_by, '85px')}</div>
    </td>
    <td style="width:50%;padding:0">
      <table class="nob" style="table-layout:fixed"><tr>
        <td style="width:50%;border-right:1px solid #000;border-bottom:1px solid #000">${sg('ผู้ตรวจสอบ (หัวหน้าช่าง)', o.checker_name, o.checker_sign, o.check_at)}</td>
        <td style="width:50%;border-bottom:1px solid #000">${sg('รับรองโดย (ผจก.ส่วนซ่อมบำรุง)', o.approver_name, o.approve_sign, o.approve_at)}</td>
      </tr></table>
      <div style="padding:3px 5px">
        <div>${line('ค่าใช้จ่ายทั้งหมดเป็นของหน่วยงาน', o.cost_owner_dept, '110px')}</div>
        <div style="margin-top:2px">และได้รับมอบงานเรียบร้อยแล้ว</div>
      </div>
      <div style="padding:0">${sg('ผู้จัดการ', o.cost_mgr_name, o.cost_mgr_sign, o.cost_mgr_at)}</div>
    </td>
  </tr></table>

  <table><tr><td class="note">${line('ความคิดเห็นเพิ่มเติม', '', '0')}<span style="white-space:pre-wrap">${esc(o.extra_comment || '')}</span></td></tr></table>
  <div class="ft"><span>${[df.form_code, df.rev].filter(Boolean).join('-')}</span><span>${df.footer_note || ''}</span><span>${df.effective_date ? 'Effective : ' + df.effective_date : ''}</span></div>

  ${(o.before_img || o.after_img) ? `<div class="ph"><table>
    <tr><td class="sec" style="width:50%">ภาพก่อนซ่อม/ปรับปรุง</td><td class="sec" style="width:50%">ภาพหลังซ่อม/ปรับปรุง</td></tr>
    <tr><td class="phc">${o.before_img ? `<img src="${esc(o.before_img)}"/>` : ''}</td><td class="phc">${o.after_img ? `<img src="${esc(o.after_img)}"/>` : ''}</td></tr>
    <tr><td colspan="2" style="font-size:9px">แนบท้ายใบ MO ${esc(o.mo_no || '')} — ${esc(dept)}</td></tr>
  </table></div>` : ''}

  <script>window.onload=function(){setTimeout(function(){window.print()},500)}</script>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast.error('เบราว์เซอร์บล็อกหน้าต่าง — อนุญาต popup แล้วลองใหม่'); return; }
  w.document.write(html); w.document.close();
}

/* ── Detail drawer ───────────────────────────────────── */
function DetailDrawer({ order, role, mtnDepts = MTN_DEPTS, fullName, signatureUrl, improvements, supplyByMachineNo, userTeams = [], reporterScope = null, onOpenImprovement, onClose, onStep, onReload }) {
  const o = order;
  const m = statusMetaOf(o);
  const next = nextStepFor(o);
  const dept = o.mtn_dept || deptForItem(o.item_type);
  const openImps = (improvements || []).filter(i => i.line_name === o.line_name && (!i.machine_no || i.machine_no === o.machine_no));
  const affectedLines = (o.machine_no && supplyByMachineNo?.[o.machine_no]) || []; // utility/facility นี้จ่ายไลน์ไหน — ผลกระทบเวลาซ่อม/ตัดไฟ
  const repeatIssue = ['เกิดปัญหาซ้ำ', 'แก้ไขไม่ได้'].includes(o.follow_up);
  const resp = minutesBetween(o.report_at, o.accept_at), ttr = minutesBetween(o.accept_at, o.repair_done_at), bd = minutesBetween(o.report_at, o.repair_done_at);
  const [dparts, setDparts] = useState([]);
  const [dlabor, setDlabor] = useState([]);   // ค่าแรงรายคน (ตาราง 5 แถวบนฟอร์ม MTN)
  useEffect(() => { supabaseDR.from('mtn_order_parts').select('*').eq('order_id', o.id).then(({ data }) => setDparts(data || [])); }, [o.id]);
  useEffect(() => { supabaseDR.from('mtn_order_labor').select('*').eq('order_id', o.id).order('seq').then(({ data }) => setDlabor(data || [])); }, [o.id]);
  /* 🔧 ช่างของทีมนี้ทำขั้น 2-3 ของ "ใบทีมตัวเอง" ได้ (feedback หน้างาน 2026-08-21)
     ที่มา: ช่างฝ่ายผลิตอยู่ระหว่างระดับส่วนกับระดับกลุ่ม — role ที่มีอยู่ไม่มีตัวไหนพอดี
     แทนที่จะเพิ่ม role ใหม่ (กฎเหล็ก: เจอแกนใหม่ให้เพิ่ม attribute) ใช้ 2 ชั้นคู่กัน:
       role ต้องถือ `mtn_repair:service_own_team`  **และ**  ตัวบุคคลต้องถูกตั้ง
       "ทีมช่างซ่อม" (profiles.mtn_teams ที่ /add-user) ให้ตรงกับทีมของใบนั้น
     ⚠️ 2026-09-02 หดขอบเขตจาก "ขั้น 2-4" เหลือ "ขั้น 2-3" — ขั้น 4 คือการ
        ตรวจรับงานของ **ผู้เปิดใบ** ช่างตรวจงานตัวเองไม่ได้อีกต่อไป */
  const orderTeam = teamKeyOf(o.mtn_dept || deptForItem(o.item_type));
  const inOrderTeam = userTeams.some(t => sameTeam(t, orderTeam));
  // 🔒 ขั้น 4/6/7 ทำได้เฉพาะใบของฝ่ายตัวเอง — null = ตัดสินไม่ได้ (ไม่จำกัด/ไลน์ไม่รู้จัก) = ผ่านตามเดิม
  const inReporterScope = orderInReporterScope(o, reporterScope || {});
  /* 🔒 ใบ MTN: งานปรับปรุง/สร้างต้องมีลายเซ็นผู้จัดการก่อนช่างรับงาน · งานซ่อม/บริการเดินได้เลย
     (คำสั่ง user 2026-09-15 — เกณฑ์อยู่ที่ mtnApprovalState() ใน mtnMoForm.js ที่เดียว) */
  const mtnForm = isMtnFormOrder(o);
  const appr = mtnForm ? mtnApprovalState(o) : null;
  const stepCtx = { order: o, fullName, inOrderTeam, inReporterScope, hasTeams: userTeams.length > 0, mtnForm, approvalBlocked: !!appr?.blocked, ...stepPerms(role) };
  // เกณฑ์เดียวกับ guard ตอนกดบันทึกใน StepModal — อยู่ที่ mtnStepPerm.js ที่เดียว
  const canEditStep = (step) => canDoStep(step, stepCtx).ok;
  /* ⏭ ข้าม QA — ใบค้างรอ QA (ขั้น 4 เลือก "เกี่ยวกับคุณภาพ") แต่งานไม่เกี่ยวคุณภาพจริง
     ผู้เปิดใบ/ผู้ถือ accept_work หรือ QA เอง กดข้ามไปรับมอบ (ขั้น 6) ได้ — เกณฑ์อยู่ที่ canSkipQa() */
  const skipQa = canSkipQa(stepCtx);

  /* ── ✍️ ผู้จัดการเซ็นใบ MO (ฟอร์ม MTN) ─────────────────────────────────  2026-09-15
     งานปรับปรุง/สร้าง = ลายเซ็นนี้คือ "ด่านอนุมัติ" ช่างรับงานไม่ได้จนกว่าจะครบ
     งานซ่อม/บริการ    = ลายเซ็นนี้คือ "รับทราบ" ตามหลังได้ ไม่บล็อกงาน (คำสั่ง user)
     ⚠️ เขียนชื่อผู้กดจริงทับชื่อที่ผู้แจ้งระบุไว้ — ลายเซ็นต้องบอกว่า *ใครเซ็น* ไม่ใช่ใครถูกวางตัว */
  const [signBusy, setSignBusy] = useState('');
  const signApproval = async (kind) => {
    const v = canSignMtnApproval(kind, stepCtx);
    if (!v.ok) return toast.error(v.code === 'already_signed' ? 'ใบนี้เซ็นไปแล้ว' : 'เฉพาะผู้จัดการที่ถูกระบุในใบ หรือผู้ถือสิทธิ์อนุมัติปิดใบ (mtn_repair:approve) เท่านั้น');
    setSignBusy(kind);
    const nowIso = new Date().toISOString();
    const upd = kind === 'dept'
      ? { dept_manager_name: fullName || o.dept_manager_name || null, dept_manager_sign: signatureUrl || null, dept_manager_at: nowIso }
      : { plant_manager_name: fullName || o.plant_manager_name || null, plant_manager_sign: signatureUrl || null, plant_manager_at: nowIso };
    // .select('id') + นับแถว — RLS ปฏิเสธ UPDATE = "สำเร็จ 0 แถว ไม่มี error" (กฎเหล็กข้อ 2)
    const res = await supabaseDR.from('mtn_orders').update({ ...upd, updated_at: nowIso }).eq('id', o.id).is(kind === 'dept' ? 'dept_manager_at' : 'plant_manager_at', null).select('id');
    setSignBusy('');
    if (!checkWrite(res, 'เซ็นอนุมัติใบ MO')) return;
    if (!res.data?.length) return toast.error('เซ็นไม่สำเร็จ — ใบนี้อาจถูกเซ็นไปแล้วจากอีกเครื่อง (ปิดแล้วเปิดใหม่)');
    toast.success(kind === 'dept' ? 'เซ็นอนุมัติ (ผู้จัดการต้นสังกัด) แล้ว' : 'เซ็นอนุมัติ (ผู้จัดการโรงงาน) แล้ว');
    onReload && onReload();
  };

  // ── ตีกลับ (returned) → ผู้แจ้งแก้แผนกแล้วส่งใหม่ ──
  const [resubDept, setResubDept] = useState(dept);
  const [resubBusy, setResubBusy] = useState(false);
  const resubmit = async () => {
    if (!resubDept) return toast.error('เลือกแผนกที่ถูกต้อง');
    setResubBusy(true);
    const nowIso = new Date().toISOString();
    const upd = {
      status: 'pending', current_step: 1, mtn_dept: resubDept,
      report_at: nowIso,                                   // รีเซ็ตนาฬิกา — แผนกที่ถูกเริ่มนับใหม่
      first_report_at: o.first_report_at || o.report_at,   // เก็บเวลาเปิดครั้งแรกไว้อ้างอิง
      bounce_count: (o.bounce_count || 0) + 1,
      returned_at: null, reject_reason: null, returned_from_dept: null,
      accept_at: null, accepted_by: null, repair_type: null, assigned_to: null, assign_note: null, target_done_at: null,
      updated_at: nowIso,
    };
    const { error } = await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id).eq('status', 'returned');
    if (error) { setResubBusy(false); return toast.error(error.message); }
    const { data: fresh } = await supabaseDR.from('mtn_orders').select('*').eq('id', o.id).single();
    notifyMtn(fresh, 'mtn_reported');   // แจ้งทีมใหม่ให้มารับงาน
    setResubBusy(false); toast.success(`ส่งใหม่ให้ทีม ${resubDept} แล้ว`); onReload && onReload(); onClose();
  };

  /* ── ➡️ ส่งต่องานให้ทีมช่างที่เกี่ยวข้อง (2026-09-14 · คำสั่ง user — รอบ 2) ─────────────
     "ผลิตเข้าไป take action ก่อนแล้วแก้ไม่ได้ ให้จบเลขของผลิต แล้วส่งต่อไปช่างเฉพาะทาง
      ให้เปิดเลขใหม่ของส่วนงานนั้น แต่ relate กันได้ · เก็บประวัติว่าเข้าไป action กี่ครั้ง
      ทำเองได้/ไม่ได้กี่ครั้ง"

     โมเดล = **1 ปัญหา หลายใบ ผูกกันเป็นสาย** (ไม่ใช่ย้ายใบเดิมอย่างรอบแรก):
       ใบเดิม → `status='transferred'` (จบที่ทีมนี้ · ผลตรวจอยู่ในใบครบ ไม่ล้างอะไรเลย)
       ใบใหม่ → แถวใหม่ของทีมปลายทาง ได้ **เลข MO ของทีมนั้นเอง** ตอนหัวหน้าช่างกดรับงาน (ขั้น 2)
       เชื่อมด้วย `mtn_order_handoffs` (from_order_id → to_order_id) + `transferred_from_mo` บนใบลูก
     ⇒ นับสถิติ first-response ได้: ทีมผลิตแก้เองจบ (closed) กี่ใบ vs ส่งต่อ (transferred) กี่ใบ

     ⚠️ ลำดับเขียนสำคัญ — "งานหายไปเลย" แย่กว่า "มีใบเกิน":
        สร้างใบใหม่ก่อน → ผูกความสัมพันธ์ → ค่อยปิดใบเดิม
        ถ้าปิดใบเดิมพลาด ใบเดิมยังเปิดอยู่ (กดซ้ำได้) และรอบถัดไปจะ **ไม่สร้างใบซ้ำ**
        เพราะเช็ค handoff ที่มีอยู่แล้วก่อนเสมอ */
  const [handoffOut, setHandoffOut] = useState([]);   // ใบนี้ส่งต่อไปใบไหน
  const [handoffIn,  setHandoffIn]  = useState(null); // ใบนี้ถูกส่งต่อมาจากใบไหน (+ ใบต้นทางไว้โชว์ผลตรวจ)
  const [showHandoff, setShowHandoff] = useState(false);
  const [hoDept, setHoDept] = useState('');
  const [hoReason, setHoReason] = useState('');
  const [hoBusy, setHoBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabaseDR.from('mtn_order_handoffs')
        .select('*').or(`from_order_id.eq.${o.id},to_order_id.eq.${o.id}`).order('handed_at');
      if (!alive) return;
      // ฐานยังไม่ apply migration (42P01) = ฟีเจอร์ยังไม่เปิด ไม่ใช่ข้อผิดพลาดของใบ — เงียบได้
      if (error) { if (error.code !== '42P01') console.warn('[handoffs]', error.message); return; }
      const rows = data || [];
      setHandoffOut(rows.filter(h => h.from_order_id === o.id));
      const inRow = rows.find(h => h.to_order_id === o.id) || null;
      if (!inRow) { setHandoffIn(null); return; }
      // ดึงใบต้นทางมาโชว์ "ผลตรวจเบื้องต้น" — อ่านจากใบจริง ไม่ต้อง snapshot (ใบเดิมไม่ถูกล้าง)
      const { data: src } = await supabaseDR.from('mtn_orders')
        .select('id, mo_no, mtn_dept, root_cause, solution, after_img, tech_main, tech_secondary, accept_at, repair_done_at, repair_type')
        .eq('id', inRow.from_order_id).maybeSingle();
      if (alive) setHandoffIn({ ...inRow, src: src || null });
    })();
    return () => { alive = false; };
  }, [o.id]);

  const doHandoff = async () => {
    if (!hoDept || sameTeam(hoDept, orderTeam)) return toast.error('เลือกทีมปลายทาง (ต้องไม่ใช่ทีมเดิม)');
    if (!hoReason.trim()) return toast.error('ระบุเหตุผล — ทีมใหม่ต้องรู้ว่าทีมแรกติดตรงไหน');
    setHoBusy(true);
    const nowIso = new Date().toISOString();
    const toDept = teamKeyOf(hoDept);
    try {
      /* 0) กันสร้างใบซ้ำตอนกดใหม่หลังปิดใบเดิมพลาด — ถ้าเคยสร้างไปแล้วใช้ใบเดิมนั้นต่อ */
      const { data: prior, error: ePrior } = await supabaseDR.from('mtn_order_handoffs')
        .select('id, to_order_id').eq('from_order_id', o.id).limit(1);
      if (ePrior) { setHoBusy(false); return toast.error('ตรวจประวัติการส่งต่อไม่สำเร็จ: ' + ePrior.message); }
      let childId = prior?.[0]?.to_order_id || null;

      /* 1) เปิดใบใหม่ให้ทีมปลายทาง — คัดลอก "ตัวปัญหา" ที่ผู้แจ้งกรอกไว้ (ไม่ใช่ผลงานของทีมเดิม)
            · ไม่ออกเลข MO ตรงนี้ — ออกตอนทีมใหม่กดรับงาน (ขั้น 2) จะได้ prefix ของทีมนั้นจริง
            · report_at = ตอนนี้ (นาฬิกา KPI ของทีมใหม่) · first_report_at = เวลาที่ปัญหาเกิดครั้งแรก */
      if (!childId) {
        const { data: child, error: eChild } = await supabaseDR.from('mtn_orders').insert({
          status: 'pending', current_step: 1, mtn_dept: toDept,
          report_at: nowIso, first_report_at: o.first_report_at || o.report_at,
          occurred_at: o.occurred_at || o.report_at,
          transferred_from_mo: o.mo_no || null,
          line_name: o.line_name, dept_section: o.dept_section, work_area: o.work_area,
          item_type: o.item_type, machine_no: o.machine_no, model: o.model, customer: o.customer,
          code: o.code, cost_center: o.cost_center, repair_scope: o.repair_scope, want_at: o.want_at,
          problem_characteristic: o.problem_characteristic, problem_detail: o.problem_detail,
          problem_group: o.problem_group, before_img: o.before_img, is_sample: o.is_sample,
          reporter_prod: o.reporter_prod, reporter_qa: o.reporter_qa,
          reported_by_name: o.reported_by_name, reported_by_uid: o.reported_by_uid,
          source_downtime_id: o.source_downtime_id, source_inspection_id: o.source_inspection_id,
          report_note: [o.report_note, `[ส่งต่อจาก ${o.mo_no || 'ใบก่อนหน้า'} · ${deptNameOf(orderTeam)}] ${hoReason.trim()}`].filter(Boolean).join('\n'),
        }).select('id, mo_no').single();
        if (eChild || !child) { setHoBusy(false); return toast.error('เปิดใบใหม่ให้ทีมปลายทางไม่สำเร็จ: ' + (eChild?.message || '')); }
        childId = child.id;

        /* 2) ผูกความสัมพันธ์ — ล้มตรงนี้ = มีใบใหม่แต่ไม่รู้ที่มา ต้องบอกดังๆ ห้ามเงียบ
              (ใบเดิมยังไม่ปิด ⇒ กดซ่อมต่อ/กดส่งต่อใหม่ได้ และรอบหน้าจะไม่สร้างใบซ้ำ) */
        const okLink = checkWrite(await supabaseDR.from('mtn_order_handoffs').insert({
          from_order_id: o.id, to_order_id: childId,
          from_dept: orderTeam || null, to_dept: toDept,
          reason: hoReason.trim(), handed_by: fullName || '', handed_at: nowIso,
        }), 'ผูกใบใหม่กับใบเดิม');
        if (!okLink) { setHoBusy(false); return toast.error(`เปิดใบใหม่แล้วแต่ผูกกับใบเดิมไม่ได้ — แจ้งแอดมิน (ใบใหม่ id ${childId})`); }
      }

      /* 3) ปิดใบเดิม — จบที่ทีมนี้ "แก้ไม่ได้ ส่งต่อแล้ว" · ผลตรวจ/ช่าง/รูป ยังอยู่ในใบครบ
            compare-and-swap กัน 2 คนกดพร้อมกันแล้วปิดซ้อน */
      const { data: closed, error: eClose } = await supabaseDR.from('mtn_orders')
        .update({ status: 'transferred', updated_at: nowIso })
        .eq('id', o.id).eq('status', o.status).select('id');
      setHoBusy(false);
      if (eClose) return toast.error('ปิดใบเดิมไม่สำเร็จ: ' + eClose.message);
      if (!closed?.length) return toast.error('ใบนี้ถูกคนอื่นเปลี่ยนสถานะไปแล้ว — รีเฟรชแล้วลองใหม่');

      const { data: fresh } = await supabaseDR.from('mtn_orders').select('*').eq('id', childId).single();
      if (fresh) notifyMtn(fresh, 'mtn_reported');   // ทีมใหม่ได้แจ้งเตือนเหมือนใบแจ้งซ่อมใหม่
      toast.success(`ส่งต่อให้ทีม ${deptNameOf(hoDept)} แล้ว — เปิดใบใหม่ของทีมนั้น (ใบนี้ปิดเป็น "ส่งต่อทีมอื่น")`);
      onReload && onReload(); onClose();
    } catch (e) {
      setHoBusy(false);
      toast.error('ส่งต่อไม่สำเร็จ: ' + (e?.message || e));
    }
  };

  const del = async () => {
    if (!confirm('ลบใบแจ้งซ่อมนี้?')) return;
    [o.before_img, o.after_img, o.qa_img, o.checker_sign, o.qa_sign, o.ho_sign, o.approve_sign].forEach(u => u && removeMtnImg(u));
    const { error } = await supabaseDR.from('mtn_orders').delete().eq('id', o.id);
    if (error) return toast.error(error.message);
    toast.success('ลบแล้ว'); onClose();
  };
  const Row = ({ k, v }) => v ? <div style={{ display: 'flex', gap: 8, fontSize: 12.5, padding: '2px 0' }}><span style={{ color: 'var(--muted)', minWidth: 120 }}>{k}</span><span style={{ color: 'var(--text)', flex: 1 }}>{v}</span></div> : null;
  const Img = ({ label, url }) => url ? <div><div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{label}</div><img src={url} alt="" style={{ maxHeight: 130, borderRadius: 8, border: '1px solid var(--border)' }} /></div> : null;
  /* หัวข้อขั้น + "ใครทำ" มาจาก MTN_STEPS (ขั้น 1 เป็นการเปิดใบ ไม่อยู่ในตารางนั้น)
     เดิมพิมพ์ชื่อขั้นมือ 7 ที่ แล้วไม่ตรงกับปุ่ม/หัวโมดัล — คนอ่านไม่รู้ว่าใครต้องทำต่อ */
  /* `note` = ข้อความที่ต้องเห็น **แม้ขั้นนั้นยังไม่ถูกทำ** — ใช้บอก "ขั้นนี้ไม่ต้องทำแล้ว"
     ให้ต่างจาก "ยังไม่ได้ทำ" (กล่องจางๆ ว่างเปล่า) ซึ่งหน้างานอ่านว่าใบค้าง — 2026-09-08 */
  /* `skipped` = ขั้นนี้ "ไม่ต้องทำ" (ข้ามอย่างเป็นทางการ) — ต่างจาก done (ทำแล้ว) และจาก
     กล่องจางๆ (ยังไม่ได้ทำ) · ห้ามวาดเป็น ✅ เขียว เพราะแปลว่า "มีคนตรวจแล้ว" = โกหกผู้ตรวจสอบ */
  const StepBox = ({ n, done, skipped, note, children }) => {
    const meta = n === 1 ? { title: 'แจ้งซ่อม', who: 'ผู้แจ้ง (ฝ่ายที่พบปัญหา)' } : stepMeta(n, { mtnForm });
    const mark = done ? '✅' : (skipped || note) ? '⏭' : '⬜';
    return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, marginBottom: 8, background: done ? 'var(--bg2)' : 'transparent', opacity: done || note || skipped ? 1 : 0.55 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: done ? 'var(--accent)' : (skipped || note) ? '#f59e0b' : 'var(--muted)' }}>
          {mark} ขั้น {n}: {meta?.title}
          <span style={{ fontWeight: 600, color: 'var(--muted)', marginLeft: 6, fontSize: 11 }}>· {meta?.who}</span>
          {skipped && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: '#f59e0b', background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.45)', borderRadius: 20, padding: '1px 8px', whiteSpace: 'nowrap' }}>⏭ {qaAppliesTo(o) ? 'ข้าม (ไม่เกี่ยวกับคุณภาพ)' : 'ไม่ต้องตรวจ (งานปรับปรุง/สร้าง)'}</span>}
        </div>
        {done && n >= 2 && canEditStep(n) && <button onClick={() => onStep(n, true)} className="tbtn" style={{ ...btnGhost, padding: '3px 9px', fontSize: 11 }}>✏️ แก้ไข</button>}
      </div>
      {note}
      {done && children}
    </div>
  ); };

  /* 🔴 ขั้น 5 ต้องแยก 3 สถานะให้ขาด: ตรวจแล้ว ✅ / **ข้าม** ⏭ / ยังไม่ตรวจ ⬜ — 2026-09-08 → 09-09
     ใบที่ไม่ต้องตรวจ QA (ขั้น 4 เลือก "ไม่เกี่ยวกับคุณภาพ" · กด ⏭ ข้าม QA) **ไม่ขยับ current_step
     ออกจาก 4** ⇒ เกณฑ์เดิม `done = current_step >= 5` ผิด 2 ทางพร้อมกัน:
       · ก่อนรับมอบ = กล่องจางว่างเปล่า อ่านเหมือน "ค้างรอ QA"
       · หลังรับมอบ (current_step ขยับเป็น 6-7) = ขึ้น ✅ เขียว **เหมือน QA ตรวจจริงทั้งที่ไม่มีใครตรวจ**
     → ใช้ `moQaState(o)` (mtnStepPerm.js) เป็นเกณฑ์เดียว แล้ววาดชิป/หมายเหตุ "ข้าม" ค้างไว้ตลอดอายุใบ */
  const qa5 = moQaState(o);
  const qa5Note = qa5 === 'skipped' ? (
    <div style={{ fontSize: 12, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 8, padding: '6px 9px', marginBottom: 6, lineHeight: 1.6 }}>
      ⏭ <b>ไม่ต้องตรวจ QA — {qaAppliesTo(o) ? 'งานนี้ไม่เกี่ยวกับคุณภาพ' : `งาน${PURPOSES.find(x => x.key === o.purpose)?.label || ''} ไม่ต้องผ่านการตรวจคุณภาพ`}</b>
      <div style={{ color: 'var(--text2)' }}>
        {/* 3 ที่มาของ "ข้าม" ต้องแยกให้ออก: QA กดเอง · ใบเก่าที่ขั้น 4 เลือกไว้ · จุดประสงค์ของงาน (2026-09-15) */}
        {isQaSkipped(o)
          ? <>ข้ามโดย {o.qa_skipped_by || '—'} · {fmtDateTime(o.qa_skipped_at)}<div>เหตุผล: {o.qa_skip_reason || QA_SKIP_REASON_STEP4}</div></>
          : !qaAppliesTo(o)
            ? <>{QA_SKIP_REASON_PURPOSE} (กติกาของฟอร์ม ไม่ใช่มีคนกดข้าม — ถ้าอยากให้ตรวจจริง QA ยังบันทึกผลที่ขั้น 5 ได้)</>
            : <>{QA_SKIP_REASON_STEP4} (ใบเก่าก่อนระบบเก็บร่องรอยการข้าม — ไม่มีชื่อผู้กด/เวลา)</>}
        {o.status === 'checked' && <div>→ ขั้นต่อไปคือ <b>ขั้น 6 รับมอบ</b> ของฝ่ายที่แจ้ง (ปุ่ม “⏭ ข้าม QA” ไม่ขึ้นเพราะไม่มีอะไรให้ข้ามแล้ว)</div>}
      </div>
    </div>
  ) : null;

  return (
    <ModalShell title={`${o.mo_no || '(ยังไม่ออกเลข MO)'} · ${m.label} · ${deptNameOf(dept)}`} onClose={onClose} wide>
      {affectedLines.length > 0 && (
        <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.5)', fontSize: 12.5, color: '#ef4444', fontWeight: 700 }}>
          ⚠️ อุปกรณ์นี้จ่ายให้ {affectedLines.length} ไลน์ — หยุดซ่อม/ตัดไฟจะกระทบ: <b>{affectedLines.join(', ')}</b>
        </div>
      )}
      {openImps.length > 0 && (
        <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(124,108,240,0.12)', border: '1px solid rgba(124,108,240,0.4)', fontSize: 12.5, color: '#a78bfa' }}
          title={openImps.map(i => i.title).join('\n')}>
          💡 มีโปรเจคปรับปรุงกำลังทำ {openImps.length} โปรเจคสำหรับเครื่อง/ไลน์นี้
        </div>
      )}
      {repeatIssue && (
        <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.5)', fontSize: 12.5, color: '#f59e0b' }}>
          ⚠️ ติดตามผลได้ว่า "{o.follow_up}" — ควรเปิดโปรเจคปรับปรุงแก้ที่ต้นเหตุ
        </div>
      )}
      {o.status === 'returned' && (
        <div style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 8, background: 'rgba(224,137,74,0.12)', border: '1px solid rgba(224,137,74,0.5)' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#e0894a' }}>↩️ ใบนี้ถูกตีกลับ — ผิดแผนก</div>
          <div style={{ fontSize: 12.5, color: 'var(--text)', margin: '4px 0' }}>เหตุผล: <b>{o.reject_reason || '-'}</b>{o.returned_from_dept ? ` (ตีกลับจากทีม ${deptNameOf(o.returned_from_dept)})` : ''}</div>
          {can('mtn_repair', 'report', role) ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>ส่งใหม่ให้ทีม:</span>
              <select value={resubDept} onChange={e => setResubDept(e.target.value)} style={{ ...inp, width: 160 }}><TeamOpts list={mtnDepts} /></select>
              <button onClick={resubmit} disabled={resubBusy} style={{ ...btnPri, padding: '7px 14px' }}>{resubBusy ? 'กำลังส่ง…' : '✏️ แก้แผนก & ส่งใหม่'}</button>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>เวลาเริ่มนับใหม่ให้แผนกที่ถูก</span>
            </div>
          ) : <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>ผู้แจ้งต้องแก้แผนกแล้วส่งใหม่</div>}
        </div>
      )}
      {o.status !== 'returned' && o.bounce_count > 0 && (
        <div style={{ marginBottom: 10, padding: '6px 10px', borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--border)', fontSize: 11.5, color: '#e0894a' }}>
          ↩️ ใบนี้เคยถูกตีกลับ {o.bounce_count} ครั้ง{o.first_report_at ? ` · เปิดครั้งแรก ${fmtDateTime(o.first_report_at)}` : ''} — เวลา KPI นับจากรอบล่าสุด
        </div>
      )}
      {/* 🔎 ใบนี้ถูกส่งต่อ**มา** — ทีมใหม่ต้องเห็นว่าทีมก่อนหน้าเข้าไปดูอะไรมาแล้ว
          อ่านจากใบต้นทางโดยตรง (ใบเดิมไม่ถูกล้าง) ไม่ต้องพึ่ง snapshot — 2026-09-14 รอบ 2 */}
      {handoffIn && (
        <div style={{ marginBottom: 10, padding: '8px 11px', borderRadius: 8, background: 'rgba(96,165,250,0.09)', border: '1px solid rgba(96,165,250,0.45)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#60a5fa', marginBottom: 3 }}>
            ➡️ ส่งต่อมาจาก {handoffIn.src?.mo_no || o.transferred_from_mo || 'ใบก่อนหน้า'} · ทีม {deptNameOf(handoffIn.from_dept) || '—'}
          </div>
          <div style={{ fontSize: 11.5, lineHeight: 1.7 }}>
            <div style={{ color: 'var(--text)' }}>เหตุผลที่ส่งต่อ: <b>{handoffIn.reason}</b></div>
            <div style={{ color: 'var(--muted)' }}>ส่งโดย {handoffIn.handed_by || '—'} · {fmtDateTime(handoffIn.handed_at)}</div>
            {handoffIn.src?.root_cause && <div style={{ color: 'var(--text2)' }}>🔎 สาเหตุที่ทีมก่อนหน้าตรวจพบ: {handoffIn.src.root_cause}</div>}
            {handoffIn.src?.solution   && <div style={{ color: 'var(--text2)' }}>🛠 สิ่งที่ทำไปแล้ว: {handoffIn.src.solution}</div>}
            {(handoffIn.src?.tech_main || handoffIn.src?.tech_secondary) && <div style={{ color: 'var(--muted)' }}>ช่างที่เข้าดู: {[handoffIn.src.tech_main, handoffIn.src.tech_secondary].filter(Boolean).join(' · ')}</div>}
            {handoffIn.src?.repair_done_at && <div style={{ color: 'var(--muted)' }}>ทีมก่อนหน้าใช้เวลา {minutesBetween(handoffIn.src.accept_at, handoffIn.src.repair_done_at) ?? '—'} นาที ก่อนตัดสินใจส่งต่อ</div>}
            {handoffIn.src?.after_img && <img src={handoffIn.src.after_img} alt="" style={{ maxHeight: 110, borderRadius: 8, border: '1px solid var(--border)', marginTop: 4 }} />}
          </div>
        </div>
      )}
      {/* ใบนี้ส่งต่อ**ไป** แล้ว — ใบนี้จบที่ทีมนี้ ให้ตามงานต่อที่ใบใหม่ */}
      {handoffOut.length > 0 && (
        <div style={{ marginBottom: 10, padding: '8px 11px', borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
          {handoffOut.map(h => (
            <div key={h.id} style={{ fontSize: 11.5, lineHeight: 1.7 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#e0894a' }}>➡️ ใบนี้ส่งต่อให้ทีม {deptNameOf(h.to_dept)} แล้ว — จบที่ทีมนี้</div>
              <div style={{ color: 'var(--text)' }}>เหตุผล: {h.reason}</div>
              <div style={{ color: 'var(--muted)' }}>โดย {h.handed_by || '—'} · {fmtDateTime(h.handed_at)} · งานต่อจากนี้ตามที่ใบใหม่ของทีม {deptNameOf(h.to_dept)}</div>
            </div>
          ))}
        </div>
      )}
      {/* ➡️ ปุ่มส่งต่อ — ทีมที่ถือใบอยู่ (ขั้น 2-3) เท่านั้น · เกณฑ์ = canHandoff() + สิทธิ์ขั้น 3 */}
      {canHandoff(o) && canEditStep(3) && (
        <div style={{ marginBottom: 10, padding: '8px 11px', borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
          {!showHandoff ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', flex: 1, minWidth: 190 }}>
                ดูแล้วเกินมือทีมนี้? <b style={{ color: 'var(--text2)' }}>ส่งต่อให้ช่างเฉพาะทางได้เลย</b> — ระบบปิดใบนี้ให้ แล้วเปิดใบใหม่ของทีมนั้นพร้อมผลตรวจที่ทำมา
              </div>
              <button onClick={() => { setHoDept(''); setHoReason(''); setShowHandoff(true); }} style={{ ...btnGhost, color: '#60a5fa', borderColor: '#60a5fa' }}>➡️ ส่งต่อทีมอื่น</button>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>➡️ ส่งต่อใบนี้ให้ทีมช่างที่เกี่ยวข้อง</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>ทีมปลายทาง</div>
                  <select value={hoDept} onChange={e => setHoDept(e.target.value)} style={{ ...inp, fontSize: 12.5 }}>
                    <option value="">— เลือกทีม —</option>
                    <TeamOpts list={(mtnDepts || []).filter(k => !sameTeam(k, orderTeam))} />
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>ทีมนี้ติดตรงไหน / ทำอะไรไปแล้วบ้าง (ทีมใหม่จะเห็นข้อความนี้)</div>
                <textarea value={hoReason} onChange={e => setHoReason(e.target.value)} placeholder="เช่น ตรวจแล้วเป็นที่บอร์ดคอนโทรล เกินขอบเขตช่างฝ่ายผลิต ต้องให้ MTN ถอดเช็ค" style={{ ...inp, fontSize: 12.5, minHeight: 58 }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, lineHeight: 1.6 }}>
                กดแล้ว: <b style={{ color: 'var(--text2)' }}>ใบนี้ปิดเป็น “ส่งต่อทีมอื่น”</b> (ผลตรวจ/ช่าง/รูป ยังอยู่ในใบครบ ไม่หาย)
                · <b style={{ color: 'var(--text2)' }}>เปิดใบใหม่ให้ทีมปลายทาง ได้เลข MO ของทีมนั้นเอง</b> ตอนหัวหน้าช่างกดรับงาน
                · 2 ใบผูกกันไว้ กดดูย้อนกันได้ · เวลา KPI ของทีมใหม่เริ่มนับจากตอนนี้ (เวลาที่ปัญหาเกิดครั้งแรกยังเก็บไว้)
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => setShowHandoff(false)} style={btnGhost}>ยกเลิก</button>
                <button onClick={doHandoff} disabled={hoBusy} style={{ ...btnPri, padding: '7px 14px' }}>{hoBusy ? 'กำลังส่งต่อ…' : '➡️ ยืนยันส่งต่อ'}</button>
              </div>
            </>
          )}
        </div>
      )}
      {/* ✍️ ลายเซ็นผู้จัดการของใบ MTN — "บล็อกงาน" กับ "รับทราบตามหลัง" ต้องหน้าตาต่างกันชัด
             (งานซ่อมขึ้นกล่องแดงว่ารออนุมัติ = หน้างานจะหยุดรอทั้งที่ไม่ต้องรอ) */}
      {mtnForm && appr && (appr.missing.length > 0 || o.dept_manager_at || o.plant_manager_at) && (
        <div style={{ marginBottom: 10, padding: '8px 11px', borderRadius: 8, background: appr.blocked ? 'rgba(239,68,68,0.10)' : 'var(--bg2)', border: `1px solid ${appr.blocked ? '#ef4444' : 'var(--border)'}` }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: appr.blocked ? '#ef4444' : 'var(--text)' }}>
            {appr.blocked
              ? `🔒 งาน${PURPOSES.find(x => x.key === appr.purpose)?.label || ''} — ต้องอนุมัติก่อนช่างเริ่มงาน`
              : appr.ackPending ? '✍️ รอผู้จัดการเซ็นรับทราบ (ไม่บล็อกงาน — ช่างทำงานต่อได้เลย)' : '✅ ลายเซ็นผู้จัดการครบแล้ว'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 3, lineHeight: 1.7 }}>
            <div>ผู้จัดการต้นสังกัด: {o.dept_manager_at ? <b style={{ color: 'var(--accent)' }}>✔ {o.dept_manager_name || '—'} · {fmtDateTime(o.dept_manager_at)}</b> : <span style={{ color: 'var(--muted)' }}>ยังไม่เซ็น{o.dept_manager_name ? ` (ระบุไว้: ${o.dept_manager_name})` : ''}</span>}</div>
            {appr.needPlant && <div>ผู้จัดการโรงงาน (งานสร้าง): {o.plant_manager_at ? <b style={{ color: 'var(--accent)' }}>✔ {o.plant_manager_name || '—'} · {fmtDateTime(o.plant_manager_at)}</b> : <span style={{ color: 'var(--muted)' }}>ยังไม่เซ็น{o.plant_manager_name ? ` (ระบุไว้: ${o.plant_manager_name})` : ''}</span>}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            {canSignMtnApproval('dept', stepCtx).ok && <button onClick={() => signApproval('dept')} disabled={signBusy === 'dept'} style={{ ...btnPri, padding: '6px 12px', fontSize: 12 }}>{signBusy === 'dept' ? 'กำลังเซ็น…' : '✍️ อนุมัติใบ MO (ผู้จัดการต้นสังกัด)'}</button>}
            {appr.needPlant && canSignMtnApproval('plant', stepCtx).ok && <button onClick={() => signApproval('plant')} disabled={signBusy === 'plant'} style={{ ...btnPri, padding: '6px 12px', fontSize: 12 }}>{signBusy === 'plant' ? 'กำลังเซ็น…' : '✍️ อนุมัติใบ MO (ผจก.โรงงาน)'}</button>}
            {appr.missing.length > 0 && !canSignMtnApproval(appr.missing[0], stepCtx).ok && <span style={{ fontSize: 11.5, color: 'var(--muted)', alignSelf: 'center' }}>เซ็นได้เฉพาะผู้จัดการที่ถูกระบุในใบ หรือผู้ถือสิทธิ์อนุมัติปิดใบ</span>}
            {appr.missing.length > 0 && canSignMtnApproval(appr.missing[0], stepCtx).ok && !signatureUrl && <span style={{ fontSize: 11, color: 'var(--accent2)', alignSelf: 'center' }}>ยังไม่มีลายเซ็นในโปรไฟล์ — จะบันทึกเป็นชื่อ+เวลา (ตั้งลายเซ็นได้ที่มุมขวาบน)</span>}
          </div>
        </div>
      )}
      {/* ผู้เปิดใบตรวจรับ (ขั้น 4) และรับมอบ (ขั้น 6) ของใบตัวเองได้เสมอ — บอกให้รู้ว่าทำไมกดได้ */}
      {isOrderReporter(o, fullName) && o.status !== 'closed' && (
        <div style={{ marginBottom: 10, padding: '6px 10px', borderRadius: 8, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.4)', fontSize: 11.5, color: '#22c55e' }}>
          🙋 คุณเป็น<b>ผู้เปิดใบนี้</b> — ตรวจรับงานหลังซ่อม (ขั้น 4) และรับมอบ/ติดตามผล (ขั้น 6) ได้เอง
        </div>
      )}
      <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <StepBox n={1} done>
            <Row k="วันเวลาที่แจ้ง" v={fmtDateTime(o.report_at)} /><Row k="หน่วยงาน" v={deptNameOf(dept)} />
            {o.occurred_at && <Row k="เกิดเหตุจริง" v={`${fmtDateTime(o.occurred_at)} (แจ้งย้อนหลัง)`} />}
            <Row k="ขอบเขต / ประเภท" v={[SCOPE_OPTS.find(s => s.v === o.repair_scope)?.t, o.current_step < 2 && o.repair_type ? `${o.repair_type} (ผู้แจ้งระบุ)` : null].filter(Boolean).join(' · ')} />
            <Row k="ไลน์ / แผนก" v={`${o.line_name || '—'}${o.dept_section ? ' · ' + o.dept_section : ''}`} />
            <Row k="ส่วนงาน" v={o.work_area} /><Row k="Cost Center" v={o.cost_center} />
            <Row k="อุปกรณ์" v={`${o.item_type || '—'} ${o.machine_no || ''}`} />
            <Row k="ลักษณะปัญหา" v={o.problem_characteristic} /><Row k="รายละเอียด" v={o.problem_detail} /><Row k="ระบุเพิ่มเติม" v={o.report_note} />
            <Row k="ต้องการเสร็จ" v={o.want_at && beEcho(String(o.want_at).slice(0, 10))} />
            <Row k="ผู้แจ้ง (ผลิต/QA)" v={[o.reporter_prod, o.reporter_qa].filter(Boolean).join(' / ')} />
            {canEditStep(1) && <div style={{ marginTop: 4 }}><button onClick={() => onStep(1, true)} className="tbtn" style={{ ...btnGhost, padding: '3px 9px', fontSize: 11 }}>✏️ แก้ไขข้อมูลแจ้งซ่อม</button></div>}
            <div style={{ marginTop: 6 }}><Img label="รูปก่อนซ่อม" url={o.before_img} /></div>
          </StepBox>
          <StepBox n={2} done={o.current_step >= 2 || o.status === 'rejected'}>
            <Row k="เลข MO" v={o.mo_no} /><Row k="ผู้รับงาน" v={o.accepted_by} /><Row k="ประเภทงานซ่อม" v={o.repair_type} /><Row k="มอบหมายช่าง" v={o.assigned_to} />
            <Row k="กำหนดเสร็จ" v={o.target_done_at && beEcho(String(o.target_done_at).slice(0, 10))} /><Row k="เหตุ Reject" v={o.reject_reason} />
          </StepBox>
          <StepBox n={3} done={o.current_step >= 3}>
            <Row k="ซ่อมเสร็จเมื่อ" v={o.repair_done_at && fmtDateTime(o.repair_done_at)} /><Row k="สาเหตุ" v={o.root_cause} /><Row k="วิธีแก้ไข" v={o.solution} />
            <Row k="ช่างหลัก / รอง" v={[o.tech_main, o.tech_secondary].filter(Boolean).join(' / ')} />
            {!!dparts.length && <Row k="อะไหล่ที่ใช้" v={dparts.map(p => `${p.part_name} ×${p.qty}${p.unit || ''}`).join(', ')} />}
            {(o.labor_cost != null || o.parts_cost != null) && <Row k="ค่าใช้จ่าย" v={`ค่าแรง ${(Number(o.labor_cost) || 0).toLocaleString()} + อะไหล่ ${(Number(o.parts_cost) || 0).toLocaleString()} = ${((Number(o.labor_cost) || 0) + (Number(o.parts_cost) || 0)).toLocaleString()} บาท`} />}
            <div style={{ marginTop: 6 }}><Img label="รูปหลังซ่อม" url={o.after_img} /></div>
          </StepBox>
        </div>
        <div>
          <StepBox n={4} done={o.current_step >= 4}>
            <Row k="ผล" v={o.check_result} /><Row k="ต้องให้ QA ตรวจ?" v={o.quality_related === QA_NOT_RELATED ? "ไม่ต้อง — QA ระบุว่าไม่เกี่ยวกับคุณภาพ" : o.quality_related ? "ต้องผ่าน QA" : ""} /><Row k="รายละเอียด" v={o.check_note} /><Row k="ผู้ตรวจ" v={o.checker_name} /><Img label="ลายเซ็นผู้ตรวจ" url={o.checker_sign} />
          </StepBox>
          {/* done = QA ตรวจจริงเท่านั้น (moQaState) — ห้ามกลับไปใช้ current_step >= 5 */}
          <StepBox n={5} done={qa5 === 'done'} skipped={qa5 === 'skipped'} note={qa5Note}>
            {isWaitingQa(o) && !isQaSkipped(o) && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>⏳ รอ QA ตรวจ — ถ้างานนี้ไม่เกี่ยวกับคุณภาพ กด "⏭ ข้าม QA" ด้านล่างเพื่อไปรับมอบได้เลย</div>}
            <Row k="ผลคุณภาพ" v={o.qa_result} /><Row k="รายละเอียด" v={o.qa_note} /><Row k="ผู้ตรวจ QA" v={o.qa_checker} /><Img label="รูปยืนยันคุณภาพ" url={o.qa_img} /><Img label="ลายเซ็น QA" url={o.qa_sign} />
          </StepBox>
          <StepBox n={6} done={o.current_step >= 6}>
            <Row k="ติดตามผล" v={o.follow_up} /><Row k="ผู้ตรวจ" v={o.ho_checker} /><Img label="ลายเซ็น" url={o.ho_sign} />
            {satAvg(o.satisfaction) != null && <div style={{ marginTop: 4 }}>
              <Row k="ความพึงพอใจเฉลี่ย" v={`${satAvg(o.satisfaction).toFixed(2)}/3 (${Math.round(satAvg(o.satisfaction) / 3 * 100)}%)`} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                {SAT_DIMS.filter(d => o.satisfaction?.[d.key]).map(d => { const lv = SAT_LEVELS.find(l => l.v === Number(o.satisfaction[d.key])); return (
                  <span key={d.key} style={{ fontSize: 10.5, padding: '2px 6px', borderRadius: 6, background: 'var(--bg3)', border: `1px solid ${lv?.color || 'var(--border)'}`, color: 'var(--text2)' }}>{d.label}: <b style={{ color: lv?.color }}>{lv?.t}</b></span>
                ); })}
              </div>
            </div>}
          </StepBox>
          <StepBox n={7} done={o.current_step >= 7}>
            {mtnForm
              ? <><Row k="อนุมัติเมื่อ" v={o.cost_mgr_at && fmtDateTime(o.cost_mgr_at)} /><Row k="ผจก.แผนกที่แจ้ง" v={o.cost_mgr_name} /><Img label="ลายเซ็น" url={o.cost_mgr_sign} /><Row k="ความคิดเห็นเพิ่มเติม" v={o.extra_comment} /></>
              : <><Row k="อนุมัติเมื่อ" v={o.approve_at && fmtDateTime(o.approve_at)} /><Row k="ผู้อนุมัติ" v={o.approver_name} /><Img label="ลายเซ็นอนุมัติ" url={o.approve_sign} /></>}
          </StepBox>
          {/* ขั้น 8 มีเฉพาะใบ MTN — ปิดจบโดย ผจก.ส่วนซ่อมบำรุง (ฟอร์มอื่นจบที่ขั้น 7) */}
          {mtnForm && (
            <StepBox n={8} done={o.current_step >= 8}>
              <Row k="ปิดใบเมื่อ" v={o.approve_at && fmtDateTime(o.approve_at)} /><Row k="ผจก.ส่วนซ่อมบำรุง" v={o.approver_name} /><Img label="ลายเซ็นปิดใบ" url={o.approve_sign} />
            </StepBox>
          )}
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, fontSize: 12.5 }}>
            <div style={{ fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>⏱ KPI</div>
            <Row k="เข้าดำเนินการ (Response)" v={fmtMin(resp)} /><Row k="เวลาซ่อม (TTR)" v={fmtMin(ttr)} /><Row k="หยุดรวม (Breakdown)" v={fmtMin(bd)} />
          </div>
        </div>
      </div>
      {/* ⚠️ ปุ่มขั้นถัดไปหายเพราะสิทธิ์ = ต้องบอกเหตุผล ห้ามให้เดาเอง (UI-CONVENTIONS §6.9)
             เคสที่เจอจริง: ช่างฝ่ายผลิตเปิดใบได้แต่กดรับงานไม่ได้ แล้วไม่มีอะไรอธิบาย */}
      {next && !canEditStep(next.step) && (
        <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b', borderRadius: 8, padding: '9px 12px', marginTop: 12, fontSize: 12.5, lineHeight: 1.7 }}>
          🔒 <b>บัญชีนี้ทำขั้นถัดไปไม่ได้</b> — {next.label}
          <div style={{ color: 'var(--text2)', marginTop: 3 }}>
            {(stepDenyHint(next.step, { teamName: deptNameOf(orderTeam), reporterName: o.reported_by_name || o.reporter_prod, outOfScope: canDoStep(next.step, stepCtx).code === 'out_of_scope', otherTeam: canDoStep(next.step, stepCtx).code === 'other_team', orderLine: o.line_name, orderSection: o.dept_section, mtnForm,
              awaitApproval: canDoStep(next.step, stepCtx).code === 'await_mgr_approval' ? { missing: appr.missing, deptName: o.dept_manager_name, plantName: o.plant_manager_name } : null }) || []).map((t, i) => <div key={i}>{t}</div>)}
            {isWaitingQa(o) && (skipQa.ok
              ? <div style={{ color: '#f59e0b', marginTop: 3 }}>⏭ ถ้างานนี้ <b>ไม่เกี่ยวกับคุณภาพ</b> คุณกดข้าม QA ไปรับมอบ (ขั้น 6) ได้เลย — ปุ่มด้านล่าง</div>
              : <div style={{ marginTop: 3 }}>⏭ ถ้างานนี้ไม่เกี่ยวกับคุณภาพ <b>ต้องให้ QA เป็นผู้กด</b> (ขั้น 5) — ฝ่ายที่แจ้ง/ผู้เปิดใบ ข้ามขั้น QA เองไม่ได้แล้ว ตั้งแต่ 14/09/2026</div>)}
            {/* 🔴 ขั้น 6 ต้องบอก "ใครคนนั้น" ไม่ใช่แค่ตำแหน่ง — 2026-09-09 (ใบค้างรอรับมอบ 140 ใบ)
                ก่อนหน้านี้กล่องนี้บอกแค่ "หัวหน้าแผนกของฝ่ายที่แจ้ง" ลอยๆ คนเปิดดูจึงไม่รู้ว่าต้องไปตาม
                ใคร แล้วใบก็ค้างต่อ · ชื่อผู้แจ้งมีอยู่ในใบแล้ว (reported_by_name — stamp ตอนเปิดใบ) */}
            {next.step === 6 && (
              <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px dashed rgba(245,158,11,0.45)', color: 'var(--text)' }}>
                🤝 <b>ฝั่งช่างทำงานเสร็จหมดแล้ว — เหลือขั้นสุดท้ายของฝ่ายที่แจ้ง (รับมอบ/ติดตามผล)</b>
                <div style={{ color: 'var(--text2)', marginTop: 2 }}>
                  คนที่ต้องกด: <b style={{ color: 'var(--text)' }}>{o.reported_by_name || o.reporter_prod || '— (ใบนี้ไม่ได้บันทึกชื่อผู้แจ้ง)'}</b>
                  {[o.line_name, o.dept_section].filter(Boolean).length ? ` · ${[o.line_name, o.dept_section].filter(Boolean).join(' · ')}` : ''}
                  {' '}— หรือหัวหน้าแผนกของฝ่ายนั้น (ผู้ถือสิทธิ์ mtn_repair:handover)
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* 💬 คอมเมนต์ใต้ใบซ่อม — คุยงานติดใบ + 🔔 mention แจ้งเตือนเข้ากระดิ่ง */}
      <EventComments refKind="mtn_order" refId={o.id} contextLabel={`ใบซ่อม ${o.mo_no || `#${o.id}`}${o.machine_no ? ` (${o.machine_no})` : ''}`} />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        {canDelete('mtn_repair', 'manage_master', role) ? <button onClick={del} style={{ ...btnGhost, color: '#ef4444', borderColor: '#ef4444' }}>🗑 ลบใบนี้</button> : <span />}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {can('improvements', 'manage', role) && <button onClick={() => onOpenImprovement(o)} style={{ ...btnGhost, ...(repeatIssue ? { color: '#a78bfa', borderColor: '#7c6cf0' } : {}) }}>💡 เปิดโปรเจคปรับปรุง</button>}
          <button onClick={async () => {
            const dept = o.mtn_dept || deptForItem(o.item_type);
            const key = teamKeyOf(dept) === 'maintenance' ? 'mo_report_mtn' : 'mo_report';
            const logo = await logoDataUrl(docFormSync(key).logo_url);
            printMoReport(o, dparts, logo, dlabor);
          }} style={btnGhost}>🖨️ พิมพ์ / บันทึก PDF</button>
          <button onClick={onClose} style={btnGhost}>ปิด</button>
          {skipQa.ok && <button onClick={() => onStep(5, false, { skipQa: true })} style={{ ...btnGhost, color: '#f59e0b', borderColor: '#f59e0b' }} title="QA ตัดสินว่างานนี้ไม่เกี่ยวกับคุณภาพชิ้นงาน — ไม่ต้องตรวจ ส่งไปรับมอบ/ติดตามผลเลย (เฉพาะ QA กดได้)">⏭ QA ระบุว่าไม่เกี่ยวกับคุณภาพ — ไปขั้น 6</button>}
          {next && canEditStep(next.step) && <button onClick={() => onStep(next.step, false)} style={btnPri}>{next.label}</button>}
        </div>
      </div>
    </ModalShell>
  );
}

/* ── Step 2-7 action modal (รองรับ editMode) ─────────── */
function StepModal({ step, order, editMode, skipQa = false, techs, repairTypes, parts, laborRates = [], lines = NO_LINES, fullName, signatureUrl, role, userTeams = [], reporterScope = null, onClose, onSaved }) {
  // ประเภทงานซ่อม = มุมมองทีม → กรองตามทีมของใบ (แถวไม่ตั้งทีม = 🌐 ใช้ร่วม ติดมาเสมอ)
  const teamRepairTypes = useMemo(() => filterByTeam(repairTypes, order?.mtn_dept), [repairTypes, order?.mtn_dept]);
  /* 👷 ลิสต์มอบหมายช่าง — แยกกลุ่ม "ทีมของใบนี้" ขึ้นก่อน (feedback หน้างาน 2026-08-21:
     "หัวหน้าช่าง MTN ต้องเห็นทีมช่างตัวเอง ไม่ใช่เห็นมั่ว")
     ⚠️ **ไม่ตัดทีมอื่นทิ้ง** — งานข้ามทีมมีจริง (เช่นงาน JIG ที่ MTN รับไปทำ)
        แค่แยกกลุ่มให้ไม่ปนกัน (หลักเดียวกับ optgroup "ในผัง/นอกผัง" ที่อื่นในระบบ) */
  const techGroups = useMemo(() => {
    const tk = teamKeyOf(order?.mtn_dept || '');
    const mine = [], others = [];
    for (const t of techs || []) (tk && sameTeam(t.dept, tk) ? mine : others).push(t);
    return { teamKey: tk, mine, others };
  }, [techs, order?.mtn_dept]);
  // ตัวเลือกช่างแบบจัดกลุ่ม — ใช้ร่วมทุกช่องที่เลือกช่าง (ขั้น 2 มอบหมาย · ขั้น 3 ช่างหลัก/รอง)
  const techOpts = (
    <>
      {techGroups.mine.length > 0 && (
        <optgroup label={`👷 ช่างทีม ${deptNameOf(techGroups.teamKey)} (${techGroups.mine.length})`}>
          {techGroups.mine.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
        </optgroup>
      )}
      {techGroups.others.length > 0 && (
        <optgroup label={`— ทีมอื่น (${techGroups.others.length}) · เลือกได้ถ้ารับงานข้ามทีม —`}>
          {techGroups.others.map(t => <option key={t.id} value={t.name}>{t.name}{t.dept ? ` · ${deptNameOf(t.dept)}` : ''}</option>)}
        </optgroup>
      )}
    </>
  );
  // ครอบครัวไลน์ของใบ — ให้ PersonSelect เรียงคนของฝ่ายที่แจ้งขึ้นก่อน (ไม่ตัดคนอื่น) · 2026-09-07
  const orderFam = useMemo(() => (order?.line_name ? getLineFamilyNames(lines, order.line_name) : NO_LINES), [lines, order?.line_name]);
  // 📜 ชื่อที่เคยบันทึกในช่องเดียวกันของ mtn_orders — คนนอกทะเบียน (profiles/employees) ที่เคยกรอกยังเลือกซ้ำได้ (2026-09-07)
  const checkerHist = useColumnHistory(supabaseDR, 'mtn_orders', 'checker_name');
  const qaCheckerHist = useColumnHistory(supabaseDR, 'mtn_orders', 'qa_checker');
  const hoCheckerHist = useColumnHistory(supabaseDR, 'mtn_orders', 'ho_checker');
  const approverHist = useColumnHistory(supabaseDR, 'mtn_orders', 'approver_name');
  const o = order;
  const isMtnForm = isMtnFormOrder(o);   // ใช้ฟอร์ม/ขั้นตอน FM-MTN-006
  const [f, setF] = useState(() => ({
    accepted_by: o.accepted_by || fullName || '', repair_type: o.repair_type || 'Breakdown Maintenance', assign_note: o.assign_note || '',
    target_done_at: o.target_done_at ? String(o.target_done_at).slice(0, 10) : '', assigned_to: o.assigned_to || '', reject_reason: o.reject_reason || '',
    root_cause: o.root_cause || '', solution: o.solution || '', tech_main: o.tech_main || '', tech_secondary: o.tech_secondary || '',
    labor_cost: o.labor_cost ?? '', parts_cost: o.parts_cost ?? '',
    /* ── ช่องฟอร์มกระดาษทีม MTN (2026-09-15) ── */
    mo_approved_by: o.mo_approved_by || '',
    repair_start_at: o.repair_start_at ? localDt(o.repair_start_at) : '',
    cause_category: o.cause_category || '', cause_other: o.cause_other || '',
    satisfaction_by: o.satisfaction_by || '', cost_owner_dept: o.cost_owner_dept || '',
    cost_mgr_name: o.cost_mgr_name || '', extra_comment: o.extra_comment || '',
    check_result: o.check_result || 'ตรวจสอบผ่าน', check_note: o.check_note || '', checker_name: o.checker_name || fullName || '',
    qa_result: o.qa_result || 'ผ่านคุณภาพ', qa_note: o.qa_note || '', qa_checker: o.qa_checker || fullName || '',
    qa_skip_reason: o.qa_skip_reason || '',
    follow_up: o.follow_up || 'ไม่เกิดปัญหาซ้ำ', ho_checker: o.ho_checker || fullName || '',
    satisfaction: o.satisfaction || {},
    approver_name: o.approver_name || fullName || '',
  }));
  const [afterFile, setAfterFile] = useState(null);
  const [qaFile, setQaFile] = useState(null);
  const afterUrl = useObjectUrl(afterFile), qaUrl = useObjectUrl(qaFile);
  const [sig, setSig] = useState({ mode: signatureUrl ? 'profile' : 'draw', url: signatureUrl, blob: null });
  const [usedParts, setUsedParts] = useState([]);
  /* ตารางค่าแรงรายคนของฟอร์ม MTN (ชื่อ × ค่าแรง/ชม. × ชม.) — เดิมมีแค่ยอดรวมก้อนเดียว
     เปิดแก้ไขขั้น 3 ให้โหลดของเดิมมาแสดง (ไม่งั้นบันทึกซ้ำแล้วค่าแรงหาย) */
  const [laborRows, setLaborRows] = useState([]);
  useEffect(() => {
    if (step !== 3 || !isMtnForm) return;
    let alive = true;
    supabaseDR.from('mtn_order_labor').select('*').eq('order_id', o.id).order('seq')
      .then(({ data }) => { if (alive && data?.length) setLaborRows(data.map(r => ({ worker_name: r.worker_name || '', rate_per_hour: r.rate_per_hour ?? '', hours: r.hours ?? '' }))); });
    return () => { alive = false; };
  }, [step, isMtnForm, o.id]);
  const addLabor = () => { touch(); setLaborRows(r => [...r, { worker_name: '', rate_per_hour: '', hours: 1 }]); };
  const setLabor = (i, k, v) => { touch(); setLaborRows(r => r.map((x, j) => (j === i ? { ...x, [k]: v } : x))); };
  const [saving, setSaving] = useState(false);
  // แตะอะไรไปแล้วบ้าง — ใช้ถามยืนยันก่อนปิด (ขั้น 3 มีทั้งอะไหล่/รูป/ลายเซ็น กรอกใหม่ทั้งขั้นเจ็บมาก)
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);
  const set = (k, v) => { touch(); setF(p => ({ ...p, [k]: v })); };
  const tryClose = () => { if (!dirty || confirmDiscard()) onClose(); };
  const isReject = step === 2 && f.repair_type === 'Reject MO';
  const needSign = [4, 5, 6, 7, 8].includes(step) && !skipQa;   // ข้าม QA = ไม่ใช่การรับรองคุณภาพ ไม่ต้องเซ็น (เก็บชื่อ+เหตุผลแทน)

  const addPart = () => { touch(); setUsedParts(p => [...p, { part_id: '', name: '', qty: 1, unit: '', unit_price: '' }]); };
  const setPart = (i, k, v) => { touch(); setUsedParts(p => p.map((x, j) => j === i ? { ...x, [k]: v } : x)); };
  /* เลือกอะไหล่ผ่าน <SearchSelect> — คืน { id, text, opt }
     เลือกจากทะเบียน = ได้ part_id (หักสต็อกอัตโนมัติ) · พิมพ์เอง = part_id ว่าง เก็บแค่ชื่อ (ไม่หักสต็อก) */
  const pickPart = (i, { id, text, opt }) => {
    touch();
    setUsedParts(p => p.map((x, j) => j === i ? { ...x, part_id: id || '', name: text || '', unit: opt?._unit ?? (id ? x.unit : ''),
      // ราคา default จากทะเบียน (พิมพ์ทับได้) — ฟอร์ม MTN มีคอลัมน์ราคาต่อรายการ
      unit_price: x.unit_price !== '' && x.unit_price != null ? x.unit_price : (parts.find(z => z.id === id)?.unit_price ?? '') } : x));
  };
  /* 🔩 ตัวเลือกอะไหล่ที่ "ค้นได้" (feedback หน้างาน 2026-08-24: อะไหล่หลักพัน <select> เลื่อนหาไม่เจอ)
     จัดกลุ่ม "ทีมของใบนี้" ขึ้นก่อน แต่ **ไม่ตัดทีมอื่นทิ้ง** — หลักเดียวกับลิสต์มอบหมายช่าง
     (ช่างหยิบอะไหล่ข้ามทีมมีจริง เช่นน็อต/แบริ่งที่ใช้ร่วมกัน) */
  const partOpts = useMemo(() => {
    const tk = teamKeyOf(order?.mtn_dept || '');
    const grp = (p) => (tk && p.team && sameTeam(p.team, tk)) ? 0 : (p.team ? 2 : 1);
    const gname = [`🔩 อะไหล่ทีม ${deptNameOf(tk) || ''}`.trim(), '🌐 ใช้ร่วมทุกทีม', '🔩 ทีมอื่น'];
    return (parts || []).map(p => {
      const g = grp(p), st = Number(p.stock_qty) || 0, lo = Number(p.min_qty) || 0;
      return {
        id: p.id, label: p.name || '(ไม่มีชื่อ)',
        sub: [p.code, p.shelf && `ชั้น ${p.shelf}`, p.used_with && `ใช้กับ ${p.used_with}`].filter(Boolean).join(' · '),
        badge: `${st}${p.unit ? ' ' + p.unit : ''}`,
        badgeColor: st <= 0 ? '#ef4444' : (lo > 0 && st <= lo ? '#f59e0b' : 'var(--text2)'),
        group: gname[g],
        keywords: [p.code, p.mat_no, p.part_no, p.shelf, p.used_with, p.supplier].filter(Boolean).join(' '),
        _g: g, _unit: p.unit || '', _stock: st,
      };
    }).sort((a, b) => a._g - b._g);   // sort เสถียร → ในกลุ่มเดียวกันคงลำดับ sort_order เดิม
  }, [parts, order?.mtn_dept]);

  const resolveSign = async (field) => {
    if (sig.mode === 'profile' && sig.url) return sig.url;
    if (sig.mode === 'draw' && sig.blob) return await uploadMtnImg(sig.blob, `sign/${o.id}/${field}-${Date.now()}.png`);
    if (editMode && o[field]) return o[field]; // แก้ไขแต่ไม่เปลี่ยนลายเซ็น → คงเดิม
    return null;
  };

  /* ── เขียนเวลากลับไปที่ "ใบหยุดเครื่อง" ต้นทาง (downtime_logs) ─────────────────────────
     ทำไม: แท็บ ⚙️ รายอุปกรณ์ วัด MTTR ได้แค่ก้อนเดียว (started_at → ended_at = รวมเวลารอช่าง)
     แยก "รอช่าง (MTTA) vs ซ่อมจริง" ไม่ได้ เพราะ `call_mtn_ack_at` **ไม่เคยถูกเขียนเลยสักแถว**
     (วัดจริง 8,429 แถว: call_mtn ใช้ 17 · ack 0 · fix_at 93) ทั้งที่ใบ MO มีเวลาครบอยู่แล้ว
     (90 วัน: accept_at 304 · repair_done_at 298 · ผูก downtime 238 ใบ) — แค่ไม่เคยส่งกลับ
     ⇒ ขั้นรับงาน/ซ่อมเสร็จ ส่งเวลากลับไปด้วย ไม่เพิ่มงานให้ใครเลย
     ⚠️ best-effort: ใบ MO บันทึกสำเร็จไปแล้ว ถ้าตรงนี้ล้ม **ห้ามลากใบล้มตาม** แต่ต้องบอกดังๆ
     ⚠️ `call_mtn_at` เติมเฉพาะตอนที่ยังว่าง (`.is(null)`) — ถ้าหน้างานกดปุ่ม "เรียกช่าง" ไว้แล้ว
        เวลานั้นจริงกว่าเวลาที่ใบถูกเปิด ห้ามทับ */
  const syncDowntimeTimes = async (order, patch, fillCallAt = null) => {
    if (!order?.source_downtime_id) return;
    const { error } = await supabaseDR.from('downtime_logs').update(patch).eq('id', order.source_downtime_id);
    if (error) { toast.error('บันทึกใบ MO แล้ว แต่ส่งเวลากลับไปที่รายการเครื่องหยุดไม่สำเร็จ — ' + error.message); return; }
    if (fillCallAt) {
      await supabaseDR.from('downtime_logs')
        .update({ call_mtn: true, call_mtn_at: fillCallAt })
        .eq('id', order.source_downtime_id).is('call_mtn_at', null);
    }
  };

  const save = async () => {
    if (saving) return;   // กันกดซ้ำรัว — เคสจริง: บันทึกล้มเพราะรูป ช่างกดซ้ำจน toast ซ้อน 13 อัน
    setSaving(true);
    try {
      /* guard ชั้นสอง — ซ่อนปุ่มอย่างเดียวไม่พอ
         RLS ของ mtn_orders ฝั่ง DR เป็น anon เปิดหมด → UI คือด่านเดียวจริงๆ
         (ผู้ถือ manage_master ข้ามได้ตามเดิม = สิทธิ์แก้ย้อนหลังของทุกขั้น) */
      const orderTeam = teamKeyOf(o.mtn_dept || deptForItem(o.item_type));
      const inOrderTeam = userTeams.some(t => sameTeam(t, orderTeam));
      const inReporterScope = orderInReporterScope(o, reporterScope || {});
      // 🔒 ด่านอนุมัติของใบ MTN (งานปรับปรุง/สร้าง) — เกณฑ์เดียวกับตัวซ่อนปุ่มใน DetailDrawer
      const approvalBlocked = isMtnForm && mtnApprovalState(o).blocked;
      const stepCtx = { order: o, fullName, inOrderTeam, inReporterScope, hasTeams: userTeams.length > 0, mtnForm: isMtnForm, approvalBlocked, ...stepPerms(role) };
      if (skipQa) {
        // ข้าม QA — เกณฑ์เดียวกับปุ่มใน DetailDrawer (canSkipQa) · ใบต้องยังค้างรอ QA อยู่จริง ณ ตอนกด
        const vs = canSkipQa(stepCtx);
        if (!vs.ok) { setSaving(false); return toast.error(vs.code === 'not_waiting_qa' ? 'ใบนี้ไม่ได้ค้างรอ QA แล้ว — ปิดแล้วเปิดใหม่' : 'ข้าม QA ได้เฉพาะผู้เปิดใบ / ผู้ถือสิทธิ์ตรวจรับงาน (accept_work) / QA'); }
        if (!f.qa_skip_reason.trim()) { setSaving(false); return toast.error('ระบุเหตุผลที่ไม่ต้องให้ QA ตรวจ'); }
      }
      const verdict = skipQa ? { ok: true } : canDoStep(step, stepCtx);
      if (!verdict.ok) {
        setSaving(false);
        const meta = stepMeta(step, { mtnForm: isMtnForm });
        // บอกให้ตรงเหตุ — "ไม่มีสิทธิ์" เฉยๆ ทำให้หน้างานเดาว่าต้องไปขออะไรกับใคร
        if (verdict.code === 'other_team')
          return toast.error(`ขั้นปิดใบเป็นของผู้จัดการทีม ${deptNameOf(orderTeam)} — บัญชีนี้ถูกตั้งเป็นช่างทีมอื่น`);
        if (verdict.code === 'await_mgr_approval')
          return toast.error('ใบนี้เป็นงานปรับปรุง/สร้าง — ต้องให้ผู้จัดการเซ็นอนุมัติก่อนช่างเริ่มงาน (ปุ่ม “✍️ อนุมัติใบ MO” ในใบ)');
        if (meta?.ownTeam && can('mtn_repair', 'service_own_team', role) && !inOrderTeam)
          return toast.error(`ใบนี้แจ้งถึงทีม ${deptNameOf(orderTeam)} — คุณทำได้เฉพาะใบของทีมตัวเอง`);
        if (verdict.code === 'out_of_scope')
          return toast.error(`ใบนี้เป็นของ ${[o.line_name, o.dept_section].filter(Boolean).join(' · ') || 'ฝ่ายอื่น'} — ขั้นนี้ทำได้เฉพาะใบของส่วนงานตัวเอง (ผู้เปิดใบหรือหัวหน้าฝ่ายนั้นเป็นคนกด)`);
        if (meta?.byReporter)
          return toast.error(`ขั้นนี้เป็นของ${meta.who} — ใบนี้เปิดโดย “${o.reported_by_name || o.reporter_prod || '—'}”`);
        return toast.error(`ขั้นนี้เป็นหน้าที่ของ${meta?.who || 'ผู้มีสิทธิ์'} — บัญชีนี้ทำไม่ได้`);
      }
      const upd = { updated_at: new Date().toISOString() };
      if (skipQa) {
        /* ⏭ ข้าม QA = แก้การตัดสินใจของขั้น 4 ไม่ใช่ขั้นใหม่ — status คง `checked` แล้วพลิก
           quality_related เป็น "ไม่เกี่ยว" → nextStepFor พาไปขั้น 6 เอง (ไม่เพิ่ม status ให้ KPI/Andon/ใบพิมพ์ต้องรู้จัก)
           บันทึกเหตุผล/คน/เวลาไว้เสมอ — ใบพิมพ์/StepBox 5 โชว์ว่า "ข้าม" ไม่ใช่ "QA ยังไม่ตรวจ" */
        const skipFields = { qa_skip_reason: f.qa_skip_reason.trim(), qa_skipped_by: fullName || '', qa_skipped_at: new Date().toISOString() };
        let { error } = await supabaseDR.from('mtn_orders').update({ ...upd, quality_related: QA_NOT_RELATED, ...skipFields }).eq('id', o.id);
        if (error?.code === '42703') {
          // deploy-safe: ยังไม่ apply migration 20260903_mtn_qa_skip (DR) — ให้ใบเดินต่อได้ แต่ต้องบอกดังๆ ว่าเหตุผลไม่ถูกเก็บ
          ({ error } = await supabaseDR.from('mtn_orders').update({ ...upd, quality_related: QA_NOT_RELATED }).eq('id', o.id));
          if (!error) toast.error('ข้าม QA แล้ว แต่ยังบันทึกเหตุผลไม่ได้ — ฐาน DR ยังไม่มีคอลัมน์ qa_skip_reason (รัน migration 20260903_mtn_qa_skip)');
        }
        if (error) throw error;
      } else if (step === 2) {
        if (!f.assigned_to && !isReject) { setSaving(false); return toast.error('มอบหมายช่าง'); }
        if (isReject && !f.reject_reason.trim()) { setSaving(false); return toast.error('ระบุเหตุผลที่ตีกลับ'); }
        Object.assign(upd, { accept_at: editMode ? o.accept_at : new Date().toISOString(), accepted_by: f.accepted_by, repair_type: f.repair_type, assign_note: f.assign_note, target_done_at: f.target_done_at || null, assigned_to: f.assigned_to });
        /* Reject = "ตีกลับให้ผู้แจ้ง" (ผิดแผนก) — เด้งกลับหาผู้แจ้งพร้อมเหตุผล ให้แก้แผนกแล้วส่งใหม่ (ไม่ทิ้งใบ)
           🔴 แก้ 2026-09-08 (feedback หน้างาน "ระบบ Reject MO มันไม่ตีกลับ แต่ก่อนหน้านี้ตีกลับ"):
           เดิมสาขานี้อยู่ใต้ `if (!editMode)` ⇒ กด ✏️ แก้ไขขั้น 2 ของใบที่รับงานไปแล้วแล้วเลือก "Reject MO"
           **บันทึกแค่ `reject_reason` ใบไม่เด้งกลับเลย** ทั้งที่กล่องส้มบนฟอร์มเขียนว่า "ใบจะเด้งกลับหาผู้แจ้ง"
           = โกหกผู้ใช้ (ข้อมูลจริง 08/09: 2 ใบค้าง status=assigned + repair_type='Reject MO' + returned_at ว่าง)
           ตีกลับเป็น "การตัดสินใจของทั้งใบ" ไม่ใช่ฟิลด์ของขั้น 2 → ต้องทำงานทั้งตอนบันทึกครั้งแรกและตอนแก้ไข
           · เกณฑ์ว่าตีกลับได้ไหมอยู่ที่ `canBounceBack()` ใน mtnStepPerm.js ที่เดียว (ใช้ร่วมกับกล่องเตือนบนฟอร์ม)
           · `current_step: 1` ให้ตรงกับตอน resubmit — ใบกลับไปอยู่ที่ผู้แจ้งจริงๆ ไม่ค้างโชว์ว่าผ่านขั้น 2 แล้ว */
        if (isReject) {
          if (!canBounceBack(o)) { setSaving(false); return toast.error(`ใบนี้เดินไปถึงขั้น ${o.current_step} แล้ว — ตีกลับไม่ได้ (ผลงาน/ลายเซ็นขั้น 3 เป็นต้นไปจะหายจากใบ) · ถ้าแจ้งผิดแผนกจริง ให้ปิดใบนี้แล้วเปิดใบใหม่ให้ทีมที่ถูก`); }
          Object.assign(upd, { status: 'returned', current_step: 1, reject_reason: f.reject_reason, returned_at: new Date().toISOString(), returned_from_dept: o.mtn_dept || null });
        } else if (!editMode) { upd.status = 'assigned'; upd.current_step = 2; }
        // ออกเลข MO ก่อนเลื่อนสถานะ — ถ้า RPC ล้ม (เน็ตสะดุด) ใบยังเป็น pending ให้กดสเตป 2 ใหม่ได้
        // (เดิมเลื่อน status→assigned ก่อน แล้ว RPC ล้ม → ใบค้าง assigned + mo_no=null ตลอดกาล ทำสเตป 2 ซ้ำไม่ได้)
        if (!editMode && !isReject) { const prefix = repairTypes.find(r => r.name === f.repair_type)?.prefix || 'BM'; const { error: eMo } = await supabaseDR.rpc('mtn_assign_mo_no', { p_order_id: o.id, p_prefix: prefix }); if (eMo) { setSaving(false); return toast.error('ออกเลข MO ไม่สำเร็จ: ' + eMo.message); } }
        const { error: eUpd } = await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id);
        if (eUpd) { setSaving(false); return toast.error(eUpd.message); }
        /* ฟอร์ม MTN มีลายเซ็น ผจก.ส่วนซ่อมบำรุง กลางใบ (อนุมัติให้เดินงาน) คนละจุดกับ "รับรองโดย" ท้ายใบ */
        if (isMtnForm && f.mo_approved_by && !isReject) {
          checkWrite(await supabaseDR.from('mtn_orders')
            .update({ mo_approved_by: f.mo_approved_by, mo_approved_at: o.mo_approved_at || new Date().toISOString() }).eq('id', o.id),
            'บันทึกผู้อนุมัติ MO (ช่องกลางใบพิมพ์จะว่าง)');
        }
        // เวลารับงาน → ใบหยุดเครื่อง (ได้ MTTA) · ตีกลับไม่นับว่ารับงาน
        if (!isReject && upd.accept_at) await syncDowntimeTimes(o, { call_mtn_ack_at: upd.accept_at }, o.report_at || upd.accept_at);
      } else if (step === 3) {
        Object.assign(upd, { root_cause: f.root_cause, solution: f.solution, tech_main: f.tech_main, tech_secondary: f.tech_secondary,
          labor_cost: f.labor_cost === '' ? null : Number(f.labor_cost), parts_cost: f.parts_cost === '' ? null : Number(f.parts_cost) });
        if (!editMode) { upd.status = 'repaired'; upd.current_step = 3; upd.repair_done_at = new Date().toISOString(); }
        /* ฟอร์ม MTN: วันที่เริ่ม/เสร็จ เป็นคนละจังหวะกับ "รับงาน" — ไม่กรอก = ถือว่าเริ่มตอนรับงาน
           (ค่านี้คือ "ช่างลงมือจริง" ใช้แยก MTTA/MTTR ในแท็บ ⚙️ รายอุปกรณ์ ด้วย) */
        if (isMtnForm) {
          Object.assign(upd, {
            repair_start_at: f.repair_start_at ? new Date(f.repair_start_at).toISOString() : (o.repair_start_at || o.accept_at || null),
            cause_category: f.cause_category || null,
            cause_other: f.cause_category === 'other' ? (f.cause_other || null) : null,
          });
        }
        // ⚠️ รูปพังห้ามลากบันทึกทั้งใบล้ม (feedback 2026-08-21: อ่านไฟล์รูปไม่ได้ →
        //    วิธีการแก้ไข/ช่างหลัก/ช่างรอง ที่พิมพ์มาหายหมด ช่างกดบันทึกซ้ำ 13 ครั้ง)
        //    บันทึกงานซ่อมให้สำเร็จก่อน แล้วเตือนว่ารูปไม่ได้แนบ — ค่อยมาแนบใหม่ด้วยปุ่มแก้ไข
        let imgWarn = null;
        if (afterFile) {
          try { const b = await resizeImage(afterFile); upd.after_img = await uploadMtnImg(b, `after/${o.id}-${Date.now()}.jpg`); }
          catch (e) { imgWarn = `บันทึกการซ่อมแล้ว แต่แนบ "รูปหลังซ่อม" ไม่สำเร็จ — ${e.message || e}`; }
        }
        /* 🔴 ต้องเช็คผลก่อนแตะสต็อก (audit 2026-09-02)
           เดิมไม่เช็ค error เลย ⇒ update ล้ม (RLS/เน็ต/คอลัมน์) แต่โค้ดเดินต่อไป insert อะไหล่
           + เรียก mtn_stock_move → **อะไหล่ถูกตัดสต็อกจริง แต่ใบซ่อมไม่มีบันทึกการซ่อม**
           แล้วช่างเห็นว่าไม่บันทึกจึงกดขั้น 3 ใหม่ → ตัดซ้ำ (RPC ไม่ dedup ด้วย p_ref_order)
           คอมเมนต์เหนือขึ้นไปยืนยันเองว่าเคยมีเคสกดซ้ำ 13 ครั้ง — ตอนนั้นรอดเพราะรูปพังแล้ว throw
           ก่อนถึงสต็อก · พอ error รูปถูก catch ไปต่อ ด่านนั้นก็หายไป */
        const { error: eUpd3 } = await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id);
        if (eUpd3) { setSaving(false); return toast.error('บันทึกการซ่อมไม่สำเร็จ (ยังไม่ตัดสต็อกอะไหล่): ' + eUpd3.message); }
        // เวลาซ่อมเสร็จ → ใบหยุดเครื่อง (แยก "ซ่อมจริง" ออกจาก "กลับมารัน" ได้)
        if (upd.repair_done_at) await syncDowntimeTimes(o, { fix_at: upd.repair_done_at });
        if (imgWarn) toast.error(imgWarn);
        const usable = usedParts.filter(x => x.name && Number(x.qty) > 0);
        for (const p of usable) {
          /* ราคาต่อหน่วย: ใช้ที่กรอก → ไม่กรอกก็ดึงจากทะเบียนอะไหล่ (mtn_spare_parts.unit_price)
             ฟอร์มกระดาษมีคอลัมน์ "ราคา" ต่อแถว — เดิมเก็บแค่ยอดรวมที่พิมพ์มือ */
          const up = p.unit_price !== '' && p.unit_price != null ? Number(p.unit_price)
            : (parts.find(x => x.id === p.part_id)?.unit_price ?? null);
          checkWrite(await supabaseDR.from('mtn_order_parts').insert({ order_id: o.id, part_id: p.part_id || null, part_name: p.name, qty: Number(p.qty), unit: p.unit, tech: f.tech_main, logged_by: fullName, unit_price: up, amount: up != null ? up * Number(p.qty) : null }), 'บันทึกอะไหล่ที่ใช้ (ยอดตัดสต็อกจะไม่ตรงใบ)');
        }
        /* ตารางค่าแรงรายคน (ฟอร์ม MTN) — ลบของเดิมก่อนแล้วเขียนใหม่ทั้งชุด
           🔴 delete ล้ม = ห้าม insert ต่อ (ไม่งั้นค่าแรงซ้อนกัน 2 ชุด ยอดรวมเบิ้ล) */
        if (isMtnForm) {
          const rows = laborRows.filter(r => r.worker_name && (Number(r.rate_per_hour) > 0 || Number(r.hours) > 0));
          const delOk = checkWrite(await supabaseDR.from('mtn_order_labor').delete().eq('order_id', o.id), 'ล้างค่าแรงเดิมของใบนี้');
          if (delOk) {
            for (let i = 0; i < rows.length; i++) {
              const r = rows[i];
              checkWrite(await supabaseDR.from('mtn_order_labor').insert({
                order_id: o.id, seq: i + 1, worker_name: r.worker_name,
                rate_per_hour: r.rate_per_hour === '' ? null : Number(r.rate_per_hour),
                hours: r.hours === '' ? null : Number(r.hours),
                amount: laborAmount({ rate_per_hour: r.rate_per_hour, hours: r.hours }),
                logged_by: fullName,
              }), 'บันทึกค่าแรงรายคน (ใบพิมพ์จะไม่มีตารางค่าแรง)');
            }
            const tot = sumLabor(rows);
            if (tot != null) checkWrite(await supabaseDR.from('mtn_orders').update({ labor_cost: tot }).eq('id', o.id), 'อัปเดตยอดรวมค่าแรง');
          }
        }
        // ตัดสต็อก: รวมยอดต่ออะไหล่ก่อน (กันนับซ้ำเมื่อใส่อะไหล่ตัวเดียวกัน 2 แถวในใบเดียว)
        // แล้วตัดผ่าน RPC `mtn_stock_move` — ล็อกแถว + กันติดลบ + ลง ledger ในทรานแซกชันเดียวฝั่ง DB
        // (เดิม read-modify-write จาก client: 2 เครื่องบันทึกพร้อมกันยอดเพี้ยน + เบิกเกินสต็อกได้)
        const byPart = {};
        usable.filter(p => p.part_id).forEach(p => { byPart[p.part_id] = (byPart[p.part_id] || 0) + Number(p.qty); });
        for (const [pid, totalQty] of Object.entries(byPart)) {
          const { error: eSt } = await supabaseDR.rpc('mtn_stock_move', {
            p_part_id: pid, p_type: 'issue', p_qty: totalQty,
            p_note: `เบิกใช้ ${o.mo_no || ''}`.trim(), p_by_name: fullName, p_ref_order: o.id,
          });
          // สต็อกไม่พอ/อะไหล่ถูกลบ = แจ้งแล้วไปต่อ (บันทึกการซ่อมสำคัญกว่า ห้ามให้ทั้งใบล้มเพราะยอดอะไหล่)
          if (eSt) toast.error(`ตัดสต็อก "${usable.find(x => x.part_id === pid)?.name || ''}" ไม่สำเร็จ: ${eSt.message}`);
        }
      } else if (step === 4) {
        const s = await resolveSign('checker_sign'); if (!s) { setSaving(false); return toast.error('ลงลายเซ็นผู้ตรวจ'); }
        /* `quality_related` ไม่ใช่ "ช่องที่ผู้ตรวจรับเลือก" อีกต่อไป (2026-09-14) — ความหมายใหม่คือ
           **"ใบนี้ยังต้องผ่าน QA ไหม"** ค่าเริ่มต้น = ต้องผ่าน · มีแต่ **QA** เท่านั้นที่พลิกเป็น
           "ไม่เกี่ยวกับคุณภาพ" ได้ (ปุ่ม ⏭ ขั้น 5) ⇒ เป็น default-deny gate ไม่ใช่ความเห็นของผู้แจ้ง
           ⚠️ เส้นทางจริงตัดสินด้วย `qa_skipped_at` (isWaitingQa) ไม่ใช่ช่องนี้ — ที่ยังเขียนไว้เพราะ
              **ใบพิมพ์/แผงรายละเอียดอ่านค่านี้** (แถว "ต้องให้ QA ตรวจ?") ⇒ หยุดเขียน = แถวนั้นว่างในใบใหม่
              (เดิมมีเหตุผลข้อ 2 "เป็นสะพานให้ edge รุ่นเก่าที่อ่าน quality_related" — หมดอายุแล้ว
               `send-mtn-notification` v19+ อ่าน `qa_skipped_at` เอง · deploy 2026-09-15) */
        Object.assign(upd, { check_result: f.check_result, check_note: f.check_note, checker_name: f.checker_name, checker_sign: s, quality_related: QA_RELATED });
        if (!editMode) { upd.status = 'checked'; upd.current_step = 4; upd.check_at = new Date().toISOString(); }
        /* ขั้น 4 ไม่ยุ่งกับ qa_skip_* อีกแล้ว (2026-09-14) — การข้าม QA เป็นของ QA ฝั่งเดียว
           ⚠️ ห้าม "ล้าง" qa_skip_* ตอนแก้ไขขั้น 4 ย้อนหลังด้วย: ใบเก่าที่ QA (หรือกฎเดิม) ตัดสินไปแล้ว
           จะถูกดึงกลับมารอ QA ใหม่ทั้งที่เดินไปขั้น 6-7 แล้ว */
        // ไม่เช็คผล = ขึ้น "บันทึกแล้ว" ทั้งที่ใบยังอยู่ขั้นเดิม + ยิง Telegram ด้วยแถวเก่า (audit 2026-09-02)
        { const { error: eUpdN } = await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id);
          if (eUpdN) { setSaving(false); return toast.error('บันทึกไม่สำเร็จ: ' + eUpdN.message); } }
      } else if (step === 5) {
        const s = await resolveSign('qa_sign'); if (!s) { setSaving(false); return toast.error('ลงลายเซ็น QA'); }
        // QA ตรวจจริง = ยืนยันว่าใบนี้ "เกี่ยวกับคุณภาพ" (ช่องนี้เป็นคำตอบของ QA ตั้งแต่ 2026-09-14
        // ไม่ใช่ตัวกำหนดเส้นทางอีกต่อไป — ใบพิมพ์/แผงรายละเอียดอ่านค่านี้)
        Object.assign(upd, { qa_result: f.qa_result, qa_note: f.qa_note, qa_checker: f.qa_checker, qa_sign: s, quality_related: QA_RELATED });
        // รูป QA ก็ห้ามลากทั้งใบล้มเหมือนกัน (เหตุผลเดียวกับรูปหลังซ่อมในขั้น 3)
        if (qaFile) {
          try { const b = await resizeImage(qaFile); upd.qa_img = await uploadMtnImg(b, `qa/${o.id}-${Date.now()}.jpg`); }
          catch (e) { toast.error(`บันทึกผลคุณภาพแล้ว แต่แนบรูปไม่สำเร็จ — ${e.message || e}`); }
        }
        if (!editMode) { upd.status = 'qa'; upd.current_step = 5; upd.qa_at = new Date().toISOString(); }
        // ไม่เช็คผล = ขึ้น "บันทึกแล้ว" ทั้งที่ใบยังอยู่ขั้นเดิม + ยิง Telegram ด้วยแถวเก่า (audit 2026-09-02)
        { const { error: eUpdN } = await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id);
          if (eUpdN) { setSaving(false); return toast.error('บันทึกไม่สำเร็จ: ' + eUpdN.message); } }
      } else if (step === 6) {
        const s = await resolveSign('ho_sign'); if (!s) { setSaving(false); return toast.error('ลงลายเซ็น'); }
        { const sat = {}; SAT_DIMS.forEach(d => { const v = Number(f.satisfaction?.[d.key]); if (v >= 1 && v <= 3) sat[d.key] = v; });
          Object.assign(upd, { follow_up: f.follow_up, ho_checker: f.ho_checker, ho_reporter: o.reporter_prod || fullName, ho_sign: s, satisfaction: Object.keys(sat).length ? sat : null });
          if (isMtnForm) Object.assign(upd, {
            satisfaction_by: f.satisfaction_by || null,
            cost_owner_dept: f.cost_owner_dept || null,
            // ชื่อ ผจก. = "ผู้ที่ต้องเซ็นขั้น 7" เท่านั้น — เวลาเซ็นจริงมาจากขั้น 7 (เหมือนกฎ dept_manager_at)
            cost_mgr_name: f.cost_mgr_name || null,
          }); }
        if (!editMode) { upd.status = 'handover'; upd.current_step = 6; upd.ho_at = new Date().toISOString(); }
        // ไม่เช็คผล = ขึ้น "บันทึกแล้ว" ทั้งที่ใบยังอยู่ขั้นเดิม + ยิง Telegram ด้วยแถวเก่า (audit 2026-09-02)
        { const { error: eUpdN } = await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id);
          if (eUpdN) { setSaving(false); return toast.error('บันทึกไม่สำเร็จ: ' + eUpdN.message); } }
      } else if (step === 7 && isMtnForm) {
        /* ขั้น 7 ของใบ MTN = **ผจก.ของแผนกที่แจ้งเซ็นอนุมัติ** (ช่อง "ผู้จัดการ" ท้ายใบ = cost_mgr_*)
           ⚠️ ยังไม่ปิดใบ — status คง `handover` แล้วให้ current_step=7 เป็นตัวบอกว่ารอขั้น 8
              (ห้ามเพิ่มค่า status ใหม่ · KPI/Andon/edge อ่าน status ตรงๆ) */
        const s = await resolveSign('cost_mgr_sign'); if (!s) { setSaving(false); return toast.error('ลงลายเซ็น ผจก.แผนกที่แจ้ง'); }
        Object.assign(upd, { cost_mgr_name: f.cost_mgr_name || fullName || null, cost_mgr_sign: s, extra_comment: f.extra_comment || null });
        if (!editMode) { upd.current_step = 7; upd.cost_mgr_at = new Date().toISOString(); }
        { const { error: eUpdN } = await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id);
          if (eUpdN) { setSaving(false); return toast.error('บันทึกไม่สำเร็จ: ' + eUpdN.message); } }
      } else if (step === 8) {
        // ขั้น 8 (เฉพาะใบ MTN) = ผจก.ส่วนซ่อมบำรุงปิดจบ MO — ช่อง "รับรองโดย (ผจก.ส่วนซ่อมบำรุง)"
        const s = await resolveSign('approve_sign'); if (!s) { setSaving(false); return toast.error('ลงลายเซ็น ผจก.ส่วนซ่อมบำรุง'); }
        Object.assign(upd, { approver_name: f.approver_name, approve_sign: s });
        if (!editMode) { upd.status = 'closed'; upd.current_step = 8; upd.approve_at = new Date().toISOString(); }
        { const { error: eUpdN } = await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id);
          if (eUpdN) { setSaving(false); return toast.error('บันทึกไม่สำเร็จ: ' + eUpdN.message); } }
      } else if (step === 7) {
        const s = await resolveSign('approve_sign'); if (!s) { setSaving(false); return toast.error('ลงลายเซ็นผู้อนุมัติ'); }
        Object.assign(upd, { approver_name: f.approver_name, approve_sign: s });
        if (!editMode) { upd.status = 'closed'; upd.current_step = 7; upd.approve_at = new Date().toISOString(); }
        // ไม่เช็คผล = ขึ้น "บันทึกแล้ว" ทั้งที่ใบยังอยู่ขั้นเดิม + ยิง Telegram ด้วยแถวเก่า (audit 2026-09-02)
        { const { error: eUpdN } = await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id);
          if (eUpdN) { setSaving(false); return toast.error('บันทึกไม่สำเร็จ: ' + eUpdN.message); } }
      }
      // ลบไฟล์เก่าที่ถูกแทนที่ (รูปก่อน/หลัง/QA + ลายเซ็นต่อขั้น) — ลบหลัง DB update สำเร็จเท่านั้น + best-effort
      // ไม่งั้นแก้ไขหลังบันทึกทีไร ไฟล์เดิมกำพร้าค้างใน bucket mtn-images ทุกครั้ง (QC audit 2026-08-03)
      // ข้ามลายเซ็นที่เป็นของโปรไฟล์ (signatures/<uid>/profile...) — ใช้ร่วมทั้งระบบ ห้ามลบ
      for (const fld of ['before_img', 'after_img', 'qa_img', 'checker_sign', 'qa_sign', 'ho_sign', 'approve_sign']) {
        const oldUrl = o[fld], newUrl = upd[fld];
        if (oldUrl && newUrl && oldUrl !== newUrl && !oldUrl.includes('/profile')) removeMtnImg(oldUrl);
      }
      // isReject = ตีกลับจริงแล้ว (ทั้งบันทึกครั้งแรกและตอนแก้ไข) → ผู้แจ้งต้องได้รับแจ้งเสมอ ไม่งั้นใบเด้งกลับแบบเงียบ
      if (!editMode || isReject) { const { data: fresh } = await supabaseDR.from('mtn_orders').select('*').eq('id', o.id).single(); const ev = skipQa ? 'mtn_qa_skipped' : isReject ? 'mtn_returned' : stepEventOf(step, isMtnForm); if (ev) notifyMtn(fresh, ev); }
      setSaving(false); toast.success(editMode ? 'แก้ไขแล้ว' : 'บันทึกแล้ว'); onSaved();
    } catch (e) { setSaving(false); toast.error(e.message || 'บันทึกไม่สำเร็จ'); }
  };

  // หัวโมดัล = stepLabel() ตัวเดียวกับปุ่มขั้นถัดไป — ห้ามพิมพ์ชื่อขั้นซ้ำที่นี่ (เคยมี map `titles` แล้ว drift)
  return (
    <ModalShell title={`${o.mo_no || o.item_type || ''} · ${skipQa ? '⏭ ข้าม QA — งานไม่เกี่ยวกับคุณภาพ (ขั้น 5 → 6)' : `${editMode ? '✏️ แก้ไข ' : ''}${stepLabel(step, { mtnForm: isMtnForm })}`}`} onClose={onClose} dirty={dirty}>
      <div style={{ display: 'grid', gap: 12 }}>
        {skipQa && (
          <div style={{ fontSize: 12, color: 'var(--text2)', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 8, padding: '8px 10px', lineHeight: 1.6 }}>
            ⏭ ใบนี้ค้างรอ QA เพราะขั้น 4 ระบุว่า <b>“เกี่ยวกับคุณภาพ”</b> — ถ้างานซ่อมนี้ไม่กระทบคุณภาพชิ้นงานจริง
            กดยืนยันเพื่อข้ามการตรวจ QA แล้วไป <b>รับมอบ / ติดตามผล (ขั้น 6)</b> ทันที · ระบบบันทึกชื่อคุณและเหตุผลไว้ในใบ
          </div>
        )}
        {stepMeta(step, { mtnForm: isMtnForm }) && !skipQa && (
          <div style={{ fontSize: 11.5, color: 'var(--muted)', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
            👤 ขั้นนี้เป็นหน้าที่ของ <b style={{ color: 'var(--text2)' }}>{stepMeta(step, { mtnForm: isMtnForm }).who}</b>
            {stepMeta(step, { mtnForm: isMtnForm }).byReporter && (o.reported_by_name || o.reporter_prod) ? <> · ใบนี้เปิดโดย <b style={{ color: 'var(--text2)' }}>{o.reported_by_name || o.reporter_prod}</b></> : null}
          </div>
        )}
        {step === 2 && <>
          <Field label={`ประเภทงานซ่อม${o.repair_type && !editMode ? ' (ผู้แจ้งระบุมา — แก้ได้ก่อนออกเลข MO)' : ''}`} required><select value={f.repair_type} onChange={e => set('repair_type', e.target.value)} style={inp}>{teamRepairTypes.map(r => <option key={r.id} value={r.name}>{r.name} ({r.prefix})</option>)}</select></Field>
          {isReject ? <><div style={{ fontSize: 11.5, color: canBounceBack(o) ? '#e0894a' : '#ef4444', background: canBounceBack(o) ? 'rgba(224,137,74,0.1)' : 'rgba(239,68,68,0.12)', border: `1px solid ${canBounceBack(o) ? 'rgba(224,137,74,0.3)' : 'rgba(239,68,68,0.5)'}`, borderRadius: 8, padding: '7px 10px' }}>{canBounceBack(o) ? '↩️ ตีกลับให้ผู้แจ้ง — ใบจะเด้งกลับหาผู้แจ้งพร้อมเหตุผล ให้แก้แผนกแล้วส่งใหม่ (ไม่ทิ้งใบ · เวลาเริ่มนับใหม่ให้แผนกที่ถูก)' : `⛔ ใบนี้เดินไปถึงขั้น ${o.current_step} แล้ว — ตีกลับไม่ได้ (ผลงาน/ลายเซ็นขั้น 3 เป็นต้นไปจะหายจากใบ) กดบันทึกจะไม่ผ่าน · ถ้าแจ้งผิดแผนกจริง ให้ปิดใบนี้แล้วเปิดใบใหม่ให้ทีมที่ถูก`}</div><Field label="เหตุผลที่ตีกลับ (เช่น ผิดแผนก — ควรแจ้ง JIG MTN)" required><textarea value={f.reject_reason} onChange={e => set('reject_reason', e.target.value)} style={{ ...inp, minHeight: 60 }} /></Field></> : <>
            {/* หัวหน้าช่าง = <PersonSelect> (role ซ่อมบำรุง/หัวหน้าขึ้นก่อน) — เก็บชื่อ snapshot เหมือนเดิม · 2026-09-07 */}
            <Field label="ผู้รับเรื่อง / จ่ายงาน (หัวหน้าช่าง)"><PersonSelect value={f.accepted_by} source="both" roles={MTN_HEAD_ROLES} onChange={res => set('accepted_by', res.name)} inputStyle={{ background: 'var(--bg)' }} /></Field>
            <Field label={`มอบหมายช่างซ่อม${techGroups.teamKey ? ` (ทีม ${deptNameOf(techGroups.teamKey)})` : ''}`} required>
              <select value={f.assigned_to} onChange={e => set('assigned_to', e.target.value)} style={inp}>
                <option value="">— เลือกช่าง —</option>
                {techOpts}
              </select>
              {/* ⚠️ ไม่มีช่างในทีมของใบเลย = ต้องบอกว่าเพราะอะไรและแก้ที่ไหน ห้ามปล่อยให้ไล่หาเอง
                  เคสที่เจอจริง: ช่างฝ่ายผลิตยังไม่ถูกติ๊ก employees.mtn_team จึงไม่โผล่สักคน */}
              {techGroups.teamKey && techGroups.mine.length === 0 && (
                <div style={{ fontSize: 11.5, color: '#e0894a', background: 'rgba(224,137,74,0.1)', border: '1px solid rgba(224,137,74,0.3)', borderRadius: 8, padding: '7px 10px', marginTop: 6, lineHeight: 1.6 }}>
                  ⚠️ ยังไม่มีใครถูกตั้งเป็นช่างทีม <b>{deptNameOf(techGroups.teamKey)}</b> เลย
                  <div>ไปตั้งที่ <b>ฐานข้อมูลพนักงาน (/operator)</b> → แก้ไขพนักงาน → ช่อง <b>🔧 ทีมช่างซ่อม</b></div>
                  <div style={{ opacity: 0.85 }}>ระหว่างนี้เลือกช่างทีมอื่นไปก่อนได้</div>
                </div>
              )}
            </Field>
            <DateField label="กำหนดเสร็จ" value={f.target_done_at} onChange={v => set('target_done_at', v)} />
            <Field label="ระบุรายละเอียด"><input value={f.assign_note} onChange={e => set('assign_note', e.target.value)} style={inp} /></Field>
            {isMtnForm && (
              <Field label="ผู้อนุมัติ (ผจก.ส่วนซ่อมบำรุง) — ช่องกลางใบ">
                <PersonSelect value={f.mo_approved_by} source="profiles" roles={DEPT_HEAD_ROLES} onChange={res => set('mo_approved_by', res.name)} inputStyle={{ background: 'var(--bg)' }} placeholder="ค้นชื่อ ผจก.ส่วนซ่อมบำรุง" />
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>คนละช่องกับ “รับรองโดย” ท้ายใบ (ขั้น 7) — ฟอร์มกระดาษเซ็น 2 จุดคนละวัน</div>
              </Field>
            )}
            {!editMode && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>💡 เมื่อบันทึก ระบบจะออกเลข MO ให้อัตโนมัติ ({isMtnForm ? 'MTN.ปี/เดือน-ลำดับ (รีเซ็ตทุกเดือน ตามฟอร์มกระดาษ)' : `${repairTypes.find(r => r.name === f.repair_type)?.prefix}-DDMMYY-ลำดับ`})</div>}
          </>}
        </>}
        {step === 3 && <>
          {isMtnForm && <>
            <Field label="วันเวลาที่เริ่มลงมือซ่อม">
              <input type="datetime-local" value={f.repair_start_at} onChange={e => set('repair_start_at', e.target.value)} max={localDtNow()} style={inp} />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                ว่าง = ถือว่าเริ่มตอนรับงาน · ฟอร์มกระดาษแยก “วันที่รับแจ้ง / รับ MO / เริ่มซ่อม” คนละช่อง
                — ค่านี้ทำให้แยก <b>เวลารอช่าง</b> ออกจาก <b>เวลาซ่อมจริง</b> ได้
              </div>
            </Field>
            <Field label="สาเหตุเกิดจาก">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {CAUSE_CATS.map(c => { const on = f.cause_category === c.key; return (
                  <button key={c.key} type="button" onClick={() => set('cause_category', on ? '' : c.key)} style={{
                    padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border2)'}`,
                    background: on ? 'var(--accent)' : 'var(--bg2)', color: on ? '#071008' : 'var(--text2)' }}>{c.label}</button>
                ); })}
              </div>
              {f.cause_category === 'other' && (
                <input value={f.cause_other} onChange={e => set('cause_other', e.target.value)} style={{ ...inp, marginTop: 6 }} placeholder="ระบุสาเหตุอื่นๆ เช่น ปรับปรุง" />
              )}
            </Field>
          </>}
          <Field label="สาเหตุปัญหาที่เกิด"><textarea value={f.root_cause} onChange={e => set('root_cause', e.target.value)} style={{ ...inp, minHeight: 50 }} /></Field>
          <Field label="วิธีการแก้ไข"><textarea value={f.solution} onChange={e => set('solution', e.target.value)} style={{ ...inp, minHeight: 50 }} /></Field>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="ช่างซ่อมหลัก"><select value={f.tech_main} onChange={e => set('tech_main', e.target.value)} style={inp}><option value="">—</option>{techOpts}</select></Field>
            <Field label="ช่างซ่อมรอง"><select value={f.tech_secondary} onChange={e => set('tech_secondary', e.target.value)} style={inp}><option value="">—</option>{techOpts}</select></Field>
          </div>
          <ImgField label="รูปหลังซ่อม" value={afterUrl || (editMode ? o.after_img : null)} onPick={f2 => { touch(); setAfterFile(f2); }} />
          {isMtnForm && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={lbl}>ค่าแรงในการปฏิบัติงาน (รายคน) · วิศวกร 200 บาท/ชม. · ช่างเทคนิค 100 บาท/ชม.</label>
                <button type="button" onClick={addLabor} style={{ ...btnGhost, padding: '4px 10px', fontSize: 12 }}>+ เพิ่มคน</button>
              </div>
              {laborRows.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <PersonSelect value={r.worker_name} source="both" onChange={res => setLabor(i, 'worker_name', res.name)} inputStyle={{ background: 'var(--bg)' }} placeholder="ชื่อผู้ปฏิบัติงาน" />
                  </div>
                  <input type="number" min="0" value={r.rate_per_hour} onChange={e => setLabor(i, 'rate_per_hour', e.target.value)} style={{ ...inp, width: 90, flexShrink: 0 }} placeholder="บาท/ชม." />
                  <span style={{ color: 'var(--muted)' }}>×</span>
                  <input type="number" min="0" step="0.5" value={r.hours} onChange={e => setLabor(i, 'hours', e.target.value)} style={{ ...inp, width: 70, flexShrink: 0 }} placeholder="ชม." />
                  <span style={{ width: 70, textAlign: 'right', fontWeight: 700, flexShrink: 0 }}>{laborAmount(r) == null ? '—' : laborAmount(r).toLocaleString()}</span>
                  <button type="button" onClick={() => { touch(); setLaborRows(x => x.filter((_, j) => j !== i)); }} className="tbtn" style={{ ...btnGhost, padding: '6px 8px', flexShrink: 0 }}>✕</button>
                </div>
              ))}
              {!laborRows.length && <div style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่ได้ลงค่าแรง — กด “+ เพิ่มคน” (ช่องล่างยังกรอกยอดรวมเองได้)</div>}
              {sumLabor(laborRows) != null && <div style={{ fontSize: 12.5, textAlign: 'right', fontWeight: 800, marginTop: 2 }}>(1) รวมค่าแรง {sumLabor(laborRows).toLocaleString()} บาท</div>}
            </div>
          )}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><label style={lbl}>อะไหล่ที่ใช้ · เลือกจากทะเบียน = หักสต็อกให้ · พิมพ์ชื่อเองได้ถ้าไม่มีในคลัง</label><button type="button" onClick={addPart} style={{ ...btnGhost, padding: '4px 10px', fontSize: 12 }}>+ เพิ่ม</button></div>
            {usedParts.map((p, i) => {
              const master = parts.find(x => x.id === p.part_id);
              const over = master && Number(p.qty) > (Number(master.stock_qty) || 0);
              return (
                <div key={i} style={{ marginBottom: 6, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: 7 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <SearchSelect
                      style={{ flex: 1, minWidth: 0 }}
                      value={p.part_id} text={p.name} options={partOpts} allowFree
                      placeholder="ค้นหาอะไหล่ — ชื่อ / รหัส / ชั้นวาง"
                      emptyText="ไม่พบอะไหล่ที่ค้นหาในทะเบียน"
                      freeHint="ไม่หักสต็อก"
                      onChange={(v) => pickPart(i, v)}
                    />
                    <input type="number" min="0" value={p.qty} onChange={e => setPart(i, 'qty', e.target.value)} style={{ ...inp, width: 64, flexShrink: 0 }} />
                    {isMtnForm && (
                      <input type="number" min="0" value={p.unit_price ?? ''} onChange={e => setPart(i, 'unit_price', e.target.value)}
                             style={{ ...inp, width: 86, flexShrink: 0 }} placeholder="ราคา/หน่วย"
                             title="ว่าง = ดึงราคาจากทะเบียนอะไหล่ให้อัตโนมัติ" />
                    )}
                    <span style={{ fontSize: 11, color: 'var(--muted)', width: 34, flexShrink: 0, paddingTop: 9, overflow: 'hidden' }}>{p.unit || ''}</span>
                    <button type="button" onClick={() => { touch(); setUsedParts(x => x.filter((_, j) => j !== i)); }} className="tbtn" style={{ ...btnGhost, padding: '6px 8px', flexShrink: 0 }}>✕</button>
                  </div>
                  {/* ⚠️ เบิกเกินสต็อก — RPC mtn_stock_move กันติดลบอยู่แล้ว บอกก่อนกดบันทึกจะได้ไม่เสียเที่ยว */}
                  {over && (
                    <div style={{ fontSize: 10.5, color: '#f59e0b', marginTop: 4 }}>
                      ⚠ เบิก {p.qty} แต่คงเหลือ {master.stock_qty} {master.unit || ''} — บันทึกไม่ผ่าน ต้องรับเข้าคลังก่อน หรือลดจำนวน
                    </div>
                  )}
                </div>
              );
            })}
            {editMode && <div style={{ fontSize: 11, color: 'var(--muted)' }}>* แก้ไข: เพิ่มอะไหล่ใหม่ได้ (รายการเดิมที่หักสต็อกไปแล้วไม่ถูกลบ)</div>}
          </div>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="(1) ค่าแรงซ่อม (บาท)">
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="number" value={f.labor_cost} onChange={e => set('labor_cost', e.target.value)} placeholder="0" style={{ ...inp, flex: 1 }} />
                {laborRates.length > 0 && <select value="" onChange={e => { if (e.target.value !== '') set('labor_cost', e.target.value); }} style={{ ...inp, width: 150 }} title="เลือกจากราคามาตรฐาน"><option value="">มาตรฐาน…</option>{laborRates.map(r => <option key={r.id} value={r.price}>{r.name} · {r.price} {r.unit}</option>)}</select>}
              </div>
            </Field>
            <Field label="(2) ค่าอะไหล่/อุปกรณ์ (บาท)"><input type="number" value={f.parts_cost} onChange={e => set('parts_cost', e.target.value)} placeholder="0" style={inp} /></Field>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>รวมค่าใช้จ่าย (1)+(2) = <b style={{ color: 'var(--text)' }}>{((Number(f.labor_cost) || 0) + (Number(f.parts_cost) || 0)).toLocaleString()}</b> บาท · ตั้งราคามาตรฐานที่แท็บ ⚙️ ข้อมูลตั้งต้น → 💰 ค่าแรงมาตรฐาน</div>
        </>}
        {step === 4 && <>
          <Field label="ผลตรวจรับ — ฝ่ายที่แจ้งรับงานได้ไหม"><select value={f.check_result} onChange={e => set('check_result', e.target.value)} style={inp}>{CHECK_RESULTS.map(r => <option key={r}>{r}</option>)}</select></Field>
          {/* 🔴 2026-09-14 (คำสั่ง user): ช่อง "กระทบคุณภาพไหม" ถูกถอดออกจากขั้น 4
              เดิมผู้ตรวจรับ (= ฝ่ายที่แจ้ง) เลือกเองได้ว่าไม่ต้องให้ QA ตรวจ = ผู้ถูกตรวจเปิดด่านเอง
              ตอนนี้ทุกใบจอดรอ QA และ **QA เท่านั้น** ที่ตัดสินว่าเกี่ยว/ไม่เกี่ยวกับคุณภาพ (ขั้น 5) */}
          <div style={{ fontSize: 12, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', lineHeight: 1.55 }}>
            🧪 <b>ใบนี้จะถูกส่งให้ QA ตรวจรับ (ขั้น 5) ทุกใบ</b>
            <div style={{ color: 'var(--muted)', marginTop: 2 }}>
              ถ้างานไม่เกี่ยวกับคุณภาพชิ้นงาน <b style={{ color: 'var(--text2)' }}>QA จะเป็นผู้ระบุเองที่ขั้น 5</b> แล้วใบไปรับมอบต่อ —
              ฝ่ายที่แจ้งข้ามขั้น QA เองไม่ได้ (เปลี่ยน 14/09/2026 ตามผังกระบวนการของโรงงาน ที่มี “หน่วยงานคุณภาพตรวจรับงานหลังซ่อม” อยู่ในเส้นทางหลักทุกสาย)
            </div>
          </div>
          <Field label="ระบุรายละเอียด (เช่น ยังเหลืออะไรต้องตามต่อ)"><input value={f.check_note} onChange={e => set('check_note', e.target.value)} style={inp} /></Field>
          {/* ผู้ตรวจรับ = คนของฝ่ายที่แจ้ง (ไลน์/แผนกของใบขึ้นก่อน) ผ่าน <PersonSelect> · 2026-09-07 */}
          <Field label="ชื่อผู้ตรวจรับงาน (ฝ่ายที่แจ้ง)"><PersonSelect value={f.checker_name} source="both" lines={orderFam} section={o.dept_section} history={checkerHist} onChange={res => set('checker_name', res.name)} inputStyle={{ background: 'var(--bg)' }} /></Field>
        </>}
        {skipQa && <>
          <Field label="เหตุผลที่ไม่ต้องให้ QA ตรวจ (เช่น ซ่อมไฟ/ลม/โครงสร้าง ไม่แตะจุดที่กระทบชิ้นงาน)" required><textarea value={f.qa_skip_reason} onChange={e => set('qa_skip_reason', e.target.value)} style={{ ...inp, minHeight: 64 }} /></Field>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>ผู้ยืนยัน: <b style={{ color: 'var(--text2)' }}>{fullName || '—'}</b> · ผลตรวจรับขั้น 4 ({o.check_result || '—'} · {o.checker_name || '—'}) คงเดิม ไม่ต้องเซ็นใหม่</div>
        </>}
        {step === 5 && !skipQa && <>
          <Field label="คุณภาพหลังการแก้ไข"><select value={f.qa_result} onChange={e => set('qa_result', e.target.value)} style={inp}>{QA_RESULTS.map(r => <option key={r}>{r}</option>)}</select></Field>
          <Field label="ระบุรายละเอียด"><input value={f.qa_note} onChange={e => set('qa_note', e.target.value)} style={inp} /></Field>
          {/* เจ้าหน้าที่ QA = <PersonSelect> role qa ขึ้นก่อน · 2026-09-07 */}
          <Field label="ชื่อผู้ตรวจ (เจ้าหน้าที่ QA)"><PersonSelect value={f.qa_checker} source="both" roles={QA_ROLES} section="QA" history={qaCheckerHist} onChange={res => set('qa_checker', res.name)} inputStyle={{ background: 'var(--bg)' }} /></Field>
          <ImgField label="รูปยืนยันคุณภาพ" value={qaUrl || (editMode ? o.qa_img : null)} onPick={f2 => { touch(); setQaFile(f2); }} />
        </>}
        {step === 6 && <>
          <Field label="ผลติดตามหลังใช้งานจริง"><select value={f.follow_up} onChange={e => set('follow_up', e.target.value)} style={inp}>{FOLLOW_OPTS.map(r => <option key={r}>{r}</option>)}</select></Field>
          {/* หัวหน้าแผนกฝ่ายที่แจ้ง = <PersonSelect> profiles role supervisor/manager ของไลน์/แผนกใบขึ้นก่อน · 2026-09-07 */}
          <Field label="ชื่อผู้รับมอบงาน (หัวหน้าแผนกฝ่ายที่แจ้ง)"><PersonSelect value={f.ho_checker} source="profiles" roles={DEPT_HEAD_ROLES} lines={orderFam} section={o.dept_section} history={hoCheckerHist} onChange={res => set('ho_checker', res.name)} inputStyle={{ background: 'var(--bg)' }} /></Field>
          <Field label="ประเมินความพึงพอใจบริการซ่อม (KPI หน่วยงานซ่อม)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {SAT_DIMS.map(d => (
                <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 180px', minWidth: 160, fontSize: 12.5, color: 'var(--text)' }}>{d.label}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {SAT_LEVELS.map(lv => {
                      const on = Number(f.satisfaction?.[d.key]) === lv.v;
                      return <button key={lv.v} type="button" onClick={() => set('satisfaction', { ...f.satisfaction, [d.key]: on ? undefined : lv.v })}
                        style={{ padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          border: `1px solid ${on ? lv.color : 'var(--border)'}`, background: on ? lv.color : 'var(--bg3)', color: on ? '#0b0d14' : 'var(--text2)' }}>{lv.t}</button>;
                    })}
                  </div>
                </div>
              ))}
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>ให้คะแนนโดยหน่วยงานผู้แจ้ง — ไม่บังคับ ข้ามได้ (เว้นว่าง = ไม่ประเมิน)</div>
              {(() => { const ss = satScore(f.satisfaction, SAT_DIMS.map(d => d.key));
                return ss.sum == null ? null : (
                  <div style={{ fontSize: 12.5, fontWeight: 800 }}>คะแนนรวม {ss.sum}/{ss.max} · คิดเป็น {ss.pct}%</div>
                ); })()}
            </div>
          </Field>
          {/* ── ท้ายใบฟอร์ม MTN: ผู้ประเมิน + เจ้าของค่าใช้จ่าย + ผู้จัดการรับมอบ ── */}
          {isMtnForm && <>
            <Field label="ลงชื่อผู้ประเมินความพึงพอใจ"><PersonSelect value={f.satisfaction_by} source="both" section={o.dept_section} onChange={res => set('satisfaction_by', res.name)} inputStyle={{ background: 'var(--bg)' }} placeholder="ค้นชื่อผู้ประเมิน" /></Field>
            <Field label="ค่าใช้จ่ายทั้งหมดเป็นของหน่วยงาน"><input value={f.cost_owner_dept} onChange={e => set('cost_owner_dept', e.target.value)} style={inp} placeholder={o.work_area || o.dept_section || 'ระบุหน่วยงานที่รับผิดชอบค่าใช้จ่าย'} /></Field>
            <Field label="ผจก. ของแผนกที่แจ้ง (ผู้ที่ต้องเซ็นอนุมัติขั้น 7)"><PersonSelect value={f.cost_mgr_name} source="profiles" roles={DEPT_HEAD_ROLES} lines={orderFam} section={o.dept_section} onChange={res => set('cost_mgr_name', res.name)} inputStyle={{ background: 'var(--bg)' }} placeholder="ค้นชื่อผู้จัดการ" /></Field>
          </>}
        </>}
        {/* ── ใบ MTN: ขั้น 7 = ผจก.แผนกที่แจ้งอนุมัติ (ยังไม่ปิด) · ขั้น 8 = ผจก.ซ่อมบำรุงปิดจบ ── */}
        {step === 7 && isMtnForm && <>
          <Field label="ชื่อ ผจก. ของแผนกที่แจ้ง (ผู้อนุมัติ — ช่อง “ผู้จัดการ” ท้ายใบ)"><PersonSelect value={f.cost_mgr_name} source="profiles" roles={DEPT_HEAD_ROLES} lines={orderFam} section={o.dept_section} onChange={res => set('cost_mgr_name', res.name)} inputStyle={{ background: 'var(--bg)' }} placeholder="ค้นชื่อผู้จัดการ" /></Field>
          <Field label="ความคิดเห็นเพิ่มเติม (ท้ายใบ)"><textarea value={f.extra_comment} onChange={e => set('extra_comment', e.target.value)} style={{ ...inp, minHeight: 50 }} /></Field>
          {!editMode && <div style={{ fontSize: 12, color: 'var(--muted)' }}>อนุมัติแล้วใบ<b style={{ color: 'var(--accent2)' }}>ยังไม่ปิด</b> — ส่งต่อให้ <b>ผจก.ส่วนซ่อมบำรุง ปิดจบ MO (ขั้น 8)</b></div>}
        </>}
        {step === 8 && <>
          <Field label="ชื่อผู้ปิดใบ (ผจก.ส่วนซ่อมบำรุง — ช่อง “รับรองโดย”)"><PersonSelect value={f.approver_name} source="profiles" roles={DEPT_HEAD_ROLES} history={approverHist} onChange={res => set('approver_name', res.name)} inputStyle={{ background: 'var(--bg)' }} placeholder="ค้นชื่อผู้จัดการส่วนซ่อมบำรุง" /></Field>
          {!editMode && <div style={{ fontSize: 12, color: 'var(--muted)' }}>ปิดแล้วสถานะจะเป็น <b style={{ color: '#22c55e' }}>Close MO</b></div>}
        </>}
        {step === 7 && !isMtnForm && <>
          {/* ผู้อนุมัติปิดใบ = <PersonSelect> profiles role supervisor/manager ของฝ่ายที่แจ้งขึ้นก่อน · 2026-09-07 */}
          <Field label="ชื่อผู้อนุมัติ (หัวหน้าแผนก/ส่วน/ผจก. ฝ่ายที่แจ้ง)"><PersonSelect value={f.approver_name} source="profiles" roles={DEPT_HEAD_ROLES} lines={orderFam} section={o.dept_section} history={approverHist} onChange={res => set('approver_name', res.name)} inputStyle={{ background: 'var(--bg)' }} /></Field>
          {!editMode && <div style={{ fontSize: 12, color: 'var(--muted)' }}>อนุมัติแล้วสถานะจะเป็น <b style={{ color: '#22c55e' }}>Close MO</b></div>}
        </>}
        {needSign && <Field label="ลายเซ็น" required><SignField signatureUrl={signatureUrl} existing={o[{ 4: 'checker_sign', 5: 'qa_sign', 6: 'ho_sign', 7: isMtnForm ? 'cost_mgr_sign' : 'approve_sign', 8: 'approve_sign' }[step]]} onChange={v => { touch(); setSig(v); }} /></Field>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={tryClose} style={btnGhost}>ยกเลิก</button>
        <button onClick={save} disabled={saving} style={btnPri}>{saving ? 'บันทึก…' : skipQa ? '⏭ ยืนยันข้าม QA ไปขั้น 6' : (editMode ? 'บันทึกการแก้ไข' : 'บันทึก')}</button>
      </div>
    </ModalShell>
  );
}

/* ── KPI tab ─────────────────────────────────────────── */
function KpiTab({ orders, scopeLines, lineObjs = [], machines = [] }) {
  const [line, setLine] = useState('');
  const [days, setDays] = useState(30);
  const rows = useMemo(() => {
    const since = new Date(); since.setDate(since.getDate() - Number(days));
    // กางครอบครัวไลน์เหมือนลิสต์หลัก — เลือกไลน์แม่ต้องนับใบของไลน์ลูกด้วย (fam ว่าง = ถอยไปเทียบตรงตัว)
    const fam = line ? new Set(getLineFamilyNames(lineObjs, line)) : null;
    const inLine = (o) => !line || (fam?.size ? fam.has(o.line_name) : o.line_name === line);
    return orders.filter(o => (!scopeLines || !o.line_name || scopeLines.has(o.line_name)) && inLine(o) && new Date(o.report_at) >= since && o.repair_done_at);
  }, [orders, scopeLines, line, days, lineObjs]);
  const stat = useMemo(() => {
    const resp = [], ttr = [], bd = [];
    for (const o of rows) { const r = minutesBetween(o.report_at, o.accept_at); if (r != null) resp.push(r); const t = minutesBetween(o.accept_at, o.repair_done_at); if (t != null) ttr.push(t); const b = minutesBetween(o.report_at, o.repair_done_at); if (b != null) bd.push(b); }
    const avg = a => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null;
    // ความพึงพอใจ (KPI หน่วยงานซ่อม) — เฉลี่ยรวม + รายด้าน จากใบที่มีการประเมิน
    const rated = rows.filter(o => satAvg(o.satisfaction) != null);
    const satOverall = rated.length ? rated.reduce((s, o) => s + satAvg(o.satisfaction), 0) / rated.length : null;
    const satByDim = SAT_DIMS.map(d => { const vs = rated.map(o => Number(o.satisfaction?.[d.key])).filter(v => v >= 1 && v <= 3); return { label: d.label, avg: vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null, n: vs.length }; });
    return { n: rows.length, resp: avg(resp), ttr: avg(ttr), bd: avg(bd), satOverall, satByDim, satN: rated.length };
  }, [rows]);

  /* พาเรโตลักษณะปัญหา — ป้อน "แถวดิบ" ให้ `ParetoAbcChart` (component กลางตาม UI-CONVENTIONS §304)
     1 ใบ = 1 แถว (value 1 = นับใบ) · กราฟจัด ABC + เส้นสะสม + เส้น 80% + เจาะลึกให้เอง
     ⇒ แทนพาเรโต้ 2 ใบที่เคยวาดเอง (กลุ่มใหญ่ + Top 10 หัวข้อ) ซึ่งเป็นแค่แท่งเรียง ไม่มีเส้นสะสม
        และ "Top 10" ยังตัดหางทิ้งจนคิด % สะสมไม่ได้ · การเจาะหัวข้อย่อยย้ายไปเป็นมิติ 🛑 หัวข้อย่อย
     ⚠️ ใบเก่าที่แจ้งก่อนระบบมีการจัดกลุ่ม ไม่มี problem_group → 'ไม่ระบุกลุ่ม'
        ห้ามเดากลุ่มย้อนหลังให้ (ใบเก่าเก็บเป็นข้อความ snapshot ไม่รู้กลุ่มจริง) */
  const paretoRecords = useMemo(() => rows.map(o => ({
    cat: (o.problem_group || '').trim() || 'ไม่ระบุกลุ่ม',
    value: 1,
    sub: o.problem_characteristic || 'อื่นๆ',
    machine: o.machine_no || '(ไม่ระบุเครื่อง)',
    line: o.line_name || '(ไม่ระบุไลน์)',
    item: o.item_type || '(ไม่ระบุชนิด)',
    note: o.report_note || '',
  })), [rows]);
  const PARETO_DIMS = [
    { key: 'sub', label: '🛑 หัวข้อย่อย' },
    { key: 'machine', label: '⚙️ เครื่อง/อุปกรณ์' },
    { key: 'line', label: '🏭 ไลน์' },
    { key: 'item', label: '🔧 ชนิดอุปกรณ์' },
    { key: 'note', label: '💬 อาการที่แจ้ง (จับกลุ่มคำ)', cluster: true },
  ];
  // h = คำแปลของชื่อย่อสากล — ต้องอ่านได้บนจอเลย ห้ามซ่อนใน tooltip อย่างเดียว (จอ TV ไม่มี hover)
  const Card = ({ t, v, c, h }) => <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, flex: 1, minWidth: 170 }}><div style={{ fontSize: 12, color: 'var(--muted)' }}>{t}</div><div style={{ fontSize: 26, fontWeight: 800, color: c || 'var(--text)', marginTop: 2 }}>{v}</div>{h && <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.45 }}>{h}</div>}</div>;
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {/* <LineSelect> — lineObjs ถูก scope จากหน้าหลักแล้ว · 2026-09-07 */}
        <LineSelect lines={lineObjs} value={line} onChange={setLine} placeholder="ทุกไลน์" style={{ ...inp, width: 200 }} />
        <select value={days} onChange={e => setDays(e.target.value)} style={{ ...inp, width: 140 }}>{[7, 30, 60, 90, 180].map(d => <option key={d} value={d}>{d} วันล่าสุด</option>)}</select>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>
        📋 <b style={{ color: 'var(--text2)' }}>นับจากใบแจ้งซ่อม (MO) ที่ปิดแล้ว</b> — วัดการตอบสนองของทีมช่าง
        · ส่วน <b style={{ color: 'var(--text2)' }}>MTTR/MTBF รายอุปกรณ์</b> ที่อยู่ล่างสุดของหน้านี้นับจาก
        <b style={{ color: 'var(--text2)' }}> downtime จริงของเครื่อง</b> — คนละฐาน ตัวเลขไม่เท่ากันเป็นเรื่องปกติ
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <Card t="งานที่ปิด (ในช่วง)" v={stat.n} />
        <Card t="MTTA — เข้าดำเนินการเฉลี่ย" v={fmtMin(stat.resp)} c="#3b82f6" h="Mean Time To Acknowledge = แจ้ง → ช่างรับงาน" />
        <Card t="MTTR — เวลาซ่อมเฉลี่ย" v={fmtMin(stat.ttr)} c="#f59e0b" h="Mean Time To Repair = รับงาน → ซ่อมเสร็จ (ไม่รวมเวลารอช่าง)" />
        <Card t="MDT — หยุดรวมเฉลี่ย" v={fmtMin(stat.bd)} c="#ef4444" h="Mean Down Time = แจ้ง → ซ่อมเสร็จ (MTTA + MTTR)" />
        <Card t={`ความพึงพอใจเฉลี่ย (${stat.satN} ใบ)`} v={stat.satOverall != null ? `${Math.round(stat.satOverall / 3 * 100)}%` : '—'} c={stat.satOverall == null ? 'var(--muted)' : stat.satOverall >= 2.5 ? '#22c55e' : stat.satOverall >= 2 ? '#f59e0b' : '#ef4444'} />
      </div>
      {stat.satN > 0 && <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>ความพึงพอใจบริการซ่อม รายด้าน (KPI หน่วยงานซ่อม)</div>
        {stat.satByDim.map(d => { const pct = d.avg != null ? Math.round(d.avg / 3 * 100) : 0; const col = d.avg == null ? 'var(--muted)' : d.avg >= 2.5 ? '#22c55e' : d.avg >= 2 ? '#f59e0b' : '#ef4444'; return (
          <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <div style={{ width: 200, fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</div>
            <div style={{ flex: 1, height: 16, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: col }} /></div>
            <div style={{ width: 70, textAlign: 'right', fontSize: 12.5, fontWeight: 700, color: col }}>{d.avg != null ? `${d.avg.toFixed(2)}/3` : '—'}</div>
          </div>
        ); })}
      </div>}
      {/* พาเรโตลักษณะปัญหา — component กลาง (ABC + เส้นสะสม % + เส้น 80% + เจาะลึก)
          เดิมวาดเองเป็นแท่งเรียงเฉยๆ 2 ใบ · ตอนนี้เป็น Pareto ตามหลักสากลใบเดียว เจาะหัวข้อย่อยได้ */}
      <ParetoAbcChart
        title="พาเรโตลักษณะปัญหา (ใบซ่อมที่ปิดแล้ว)"
        records={paretoRecords} dims={PARETO_DIMS} unit="ใบ"
        emptyText="ไม่มีใบซ่อมที่ปิดแล้วในช่วงนี้"
        sectionStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}
        titleStyle={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }} />

      {/* ⚙️ ความน่าเชื่อถือรายอุปกรณ์ — เดิมเป็นแท็บแยก ยุบเข้ามาที่นี่ (คำสั่ง user 2026-09-15)
          🔴 คนละฐานกับการ์ดข้างบน: ข้างบนนับจาก "ใบซ่อม MO" · ข้างล่างนับจาก "downtime จริงของเครื่อง"
             ⇒ MTTR 2 ตัวไม่เท่ากันเป็นเรื่องปกติ **ต้องมีป้ายกำกับที่มาเสมอ** ไม่งั้นกลายเป็น
             "จอเดียวกันตอบคนละเลข" (บทเรียนเดิมของโมดูลนี้) */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '2px solid var(--border2)' }}>
        {/* หัวข้อคั่น — ส่วนนี้มีแถบกรองของตัวเอง (ช่วงวัน/ไลน์/ชนิด) คนละชุดกับด้านบน
            ไม่มีหัวข้อคั่น = คนเห็นแถบกรอง 2 ชุดติดกันแล้วงงว่าอันไหนคุมอะไร */}
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 2 }}>
          ⚙️ ความน่าเชื่อถือรายอุปกรณ์ — MTTR / MTBF
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>
          นับจาก <b style={{ color: 'var(--text2)' }}>downtime จริงของเครื่อง</b> ไม่ใช่ใบแจ้งซ่อม — มีตัวกรองของตัวเองด้านล่าง
        </div>
        <MachineReliability machines={machines} lineObjs={lineObjs} scopeLines={scopeLines} />
      </div>
    </div>
  );
}

/* ── Master tab (ช่าง / อะไหล่+stock / taxonomy / ชนิดอุปกรณ์) ── */
/* ── 📜 ประวัติการแก้ไข master ของทีมช่าง (อ่านจาก audit_log ฝั่ง DR) ──────────
   ตอบคำถาม "ใครไปเปลี่ยนหัวข้อของทีมเรา" — trigger fn_audit เขียนไว้อยู่แล้ว
   แต่ไม่เคยมีหน้าจอให้ดู · actor ฝั่ง DR มาจาก `updated_by_name` ที่ wrapper
   ใน supabaseClient.js ฝังให้อัตโนมัติ (DR เป็น anon ไม่มี auth.uid) */
const AUDIT_TABLES = {
  mtn_item_types:      '⚙️ ชนิดอุปกรณ์',
  mtn_problem_types:   '🛑 ลักษณะปัญหา',
  mtn_repair_types:    '🔧 ประเภทงานซ่อม',
  mtn_spare_categories:'🏷️ หมวดอะไหล่',
  mtn_spare_parts:     '🔩 อะไหล่',
  mtn_technicians:     '👷 ช่าง',
  mtn_labor_rates:     '💰 ค่าแรงมาตรฐาน',
  equipment_die:       '🔨 แม่พิมพ์ (สถานะ/ตำแหน่ง/สเปค)',
  die_storage_areas:   '🗺️ ผังจัดเก็บแม่พิมพ์',
};

function MasterAuditLog({ teams = [] }) {
  // จอเดียวกับหน้า /audit-log (component กลาง) — ที่นี่จำกัดเฉพาะตารางของทีมช่าง
  // ดูของทั้งระบบ (สิทธิ์/พนักงาน/สินค้า/เครื่องจักร ฯลฯ) ที่ ตั้งค่าโปรแกรม → 📜 ประวัติการแก้ไขข้อมูล
  const teamName = (k) => (k ? (teams.find(t => teamKeyOf(t.key) === teamKeyOf(k))?.dept_name || deptNameOf(k) || k) : '🌐 ใช้ร่วมทุกทีม');
  return (
    <AuditLogViewer
      client={supabaseDR}
      tables={Object.keys(AUDIT_TABLES)}
      fmtValue={(f, v) => ((f === 'team' || f === 'dept') && v !== undefined ? teamName(v) : undefined)}
      intro={<>📜 ใครแก้อะไรใน<b>ข้อมูลตั้งต้นของทีมช่าง</b> — เรียงใหม่สุดก่อน · บันทึกอัตโนมัติทุกครั้งที่เพิ่ม/แก้/ลบ
        <br /><span style={{ opacity: 0.85 }}>อยากดูของทั้งระบบ (สิทธิ์ · พนักงาน · สินค้า · เครื่องจักร …) ไปที่ <b>ตั้งค่าโปรแกรม,ฐานข้อมูล → 📜 ประวัติการแก้ไขข้อมูล</b></span></>}
    />
  );
}

function MasterTab({ techs, parts, problemTypes, itemTypes, repairTypes = [], laborRates = [], mtnDepts = MTN_DEPTS, mtnTeams = [], fullName, role, userTeams = [], reloadMasters }) {
  const [sub, setSub] = useState('tech');
  const reload = () => reloadMasters();
  const addRow = async (table, payload) => { const { error } = await supabaseDR.from(table).insert(payload); if (error) return toast.error(error.message); reload(); };
  const updRow = async (table, id, payload) => { const { error } = await supabaseDR.from(table).update(payload).eq('id', id); if (error) return toast.error(error.message); reload(); };
  // เปลี่ยนชื่อใน master → ถามว่าจะให้ใบซ่อมที่บันทึกชื่อเดิมไว้ตามไปด้วยไหม
  const cascadeRename = async (col, oldV, newV) => {
    if (!oldV || !newV || oldV === newV) return;
    // ดึงทีมของใบที่จะโดนด้วย — เขียนทับประวัติข้ามทีมเป็นความเสี่ยงที่แรงที่สุดของหน้านี้
    // ต้องบอกให้เห็นว่าไปแตะใบของทีมไหนบ้าง ห้ามถามลอยๆ แค่จำนวนใบ
    const { data } = await supabaseDR.from('mtn_orders').select('mtn_dept').eq(col, oldV);
    const rows = data || [];
    const count = rows.length;
    if (!count) return;
    const byTeam = {};
    for (const r of rows) { const k = teamKeyOf(r.mtn_dept) || ''; byTeam[k] = (byTeam[k] || 0) + 1; }
    const brk = Object.entries(byTeam).sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `   · ${k ? (deptNameOf(k) || k) : 'ไม่ระบุทีม'} ${n} ใบ`).join('\n');
    const okGo = confirm(
      `มีใบแจ้งซ่อม ${count} ใบที่บันทึกค่าเดิมไว้ว่า "${oldV}"\n${brk}\n\n` +
      (Object.keys(byTeam).length > 1 ? `⚠️ ใบเหล่านี้อยู่หลายทีม — แก้แล้วประวัติของทุกทีมข้างบนเปลี่ยนตาม\n\n` : '') +
      `[ตกลง] = แก้ใบเหล่านั้นเป็น "${newV}" ด้วย → KPI/พาเรโต้รวมเป็นกลุ่มเดียว\n` +
      `[ยกเลิก] = เก็บใบเดิมไว้ตามที่บันทึกวันนั้น → พาเรโต้จะแยกเป็น 2 กลุ่ม`);
    if (!okGo) return;
    const { error } = await supabaseDR.from('mtn_orders').update({ [col]: newV }).eq(col, oldV);
    if (error) toast.error(error.message); else toast.success(`อัปเดตใบซ่อม ${count} ใบตามชื่อใหม่แล้ว`);
  };

  const delRow = async (table, id) => { if (!confirm('ลบรายการนี้?')) return; const { error } = await supabaseDR.from(table).update({ is_active: false }).eq('id', id); if (error) return toast.error(error.message); reload(); };

  // ── ช่าง (มี dept) — ช่าง = พนักงานทีมช่าง (จากฐาน employees, แก้ที่หน้าพนักงาน) + ช่างเฉพาะกิจเดิม (mtn_technicians) ──
  const [ntech, setNtech] = useState({ name: '', dept: 'maintenance' });
  const legacyCount = techs.filter(t => !t.from_employee).length;
  const TechList = () => (
    <div>
      <InfoMore style={{ marginBottom: 8 }} id="mtn_tech"
        lead={<>💡 ช่างมาจาก<b>ฐานข้อมูลพนักงาน</b> — เพิ่ม/แก้ที่หน้านั้น</>}>
        ช่าง = พนักงานที่ section เป็นทีมช่าง (MTN/JIG/DIE) · มีสกิลได้เหมือน operator
        <br />ด้านล่างเพิ่มได้เฉพาะ "ช่างเฉพาะกิจ" ที่ไม่ได้อยู่ในฐานพนักงาน
      </InfoMore>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <input value={ntech.name} onChange={e => setNtech(p => ({ ...p, name: e.target.value }))} placeholder="ชื่อช่างเฉพาะกิจ (นอกฐานพนักงาน)" style={{ ...inp, width: 260 }} />
        <select value={ntech.dept} onChange={e => setNtech(p => ({ ...p, dept: e.target.value }))} style={{ ...inp, width: 150 }}><TeamOpts list={mtnDepts} /></select>
        <button onClick={() => { if (!ntech.name) return; addRow('mtn_technicians', { name: ntech.name, dept: ntech.dept, sort_order: legacyCount + 1 }); setNtech({ name: '', dept: ntech.dept }); }} style={btnPri}>+ เพิ่มช่างเฉพาะกิจ</button>
      </div>
      {mtnDepts.map(dep => { const list = techs.filter(t => sameTeam(t.dept || 'maintenance', dep)); if (!list.length) return null; return (
        <div key={dep} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--accent2)', marginBottom: 4 }}>🏢 {dep} ({list.length})</div>
          <div style={{ display: 'grid', gap: 6 }}>{list.map(it => it.from_employee ? (
            <div key={it.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', opacity: 0.9 }}>
              <span style={{ flex: '2 1 180px', fontSize: 13 }}>{it.name}{it.emp_code ? <span style={{ color: 'var(--muted)', fontSize: 11 }}> · {it.emp_code}</span> : null}</span>
              <span style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 4, background: 'rgba(77,159,255,0.12)', color: '#4d9fff', border: '1px solid rgba(77,159,255,0.3)', fontWeight: 700, marginLeft: 'auto' }}>👤 จากฐานพนักงาน</span>
            </div>
          ) : (
            <div key={it.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
              <input defaultValue={it.name} onBlur={e => e.target.value !== it.name && updRow('mtn_technicians', it.id, { name: e.target.value })} style={{ ...inp, flex: '2 1 180px', width: 'auto' }} />
              <select defaultValue={teamKeyOf(it.dept) || 'maintenance'} onChange={e => updRow('mtn_technicians', it.id, { dept: e.target.value })} style={{ ...inp, flex: '1 1 120px', width: 'auto' }}><TeamOpts list={mtnDepts} /></select>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>เฉพาะกิจ</span>
              <button onClick={() => delRow('mtn_technicians', it.id)} className="tbtn" style={{ ...btnGhost, color: '#ef4444', padding: '6px 10px', marginLeft: 'auto' }}>🗑</button>
            </div>))}</div>
        </div>); })}
    </div>
  );

  // ── อะไหล่: ย้ายไปแท็บ "🔩 คลังอะไหล่" (SparePartMaster) แล้ว — ที่นี่เหลือแค่ทางลัด
  //    เดิมมีตัวแก้อะไหล่แบบย่อซ้ำอยู่ตรงนี้ (prompt + read-modify-write) — ลบทิ้งกันแก้กัน 2 ที่คนละกติกา

  // ── ค่าแรงมาตรฐาน (standard price ค่าแรงซ่อม) ──
  const [nrate, setNrate] = useState({ name: '', unit: 'บาท/ชม.', price: '', dept: '' });
  const LaborList = () => (
    <div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>ราคามาตรฐานค่าแรงซ่อม — ช่างกรอกไว้ที่นี่ แล้วเลือกมาใส่ในใบ MO ขั้นซ่อม (พิมพ์ลงฟอร์ม FM-MTN-006 ช่องค่าซ่อม)</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <input value={nrate.name} onChange={e => setNrate(p => ({ ...p, name: e.target.value }))} placeholder="ประเภทงาน/ระดับช่าง" style={{ ...inp, width: 240 }} />
        <input type="number" value={nrate.price} onChange={e => setNrate(p => ({ ...p, price: e.target.value }))} placeholder="ราคา" style={{ ...inp, width: 100 }} />
        <input value={nrate.unit} onChange={e => setNrate(p => ({ ...p, unit: e.target.value }))} placeholder="หน่วย" style={{ ...inp, width: 110 }} />
        <select value={nrate.dept} onChange={e => setNrate(p => ({ ...p, dept: e.target.value }))} style={{ ...inp, width: 140 }}><option value="">ทุกทีม</option><TeamOpts list={mtnDepts} /></select>
        <button onClick={() => { if (!nrate.name) return; addRow('mtn_labor_rates', { name: nrate.name, price: Number(nrate.price) || 0, unit: nrate.unit, dept: nrate.dept || null, sort_order: laborRates.length + 1 }); setNrate({ name: '', unit: nrate.unit, price: '', dept: '' }); }} style={btnPri}>+ เพิ่มราคา</button>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {laborRates.map(r => (
          <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
            <input defaultValue={r.name} onBlur={e => e.target.value !== r.name && updRow('mtn_labor_rates', r.id, { name: e.target.value })} style={{ ...inp, flex: '2 1 200px', width: 'auto' }} />
            <input type="number" defaultValue={r.price} onBlur={e => Number(e.target.value) !== Number(r.price) && updRow('mtn_labor_rates', r.id, { price: Number(e.target.value) || 0 })} style={{ ...inp, width: 100 }} />
            <input defaultValue={r.unit || ''} onBlur={e => e.target.value !== (r.unit || '') && updRow('mtn_labor_rates', r.id, { unit: e.target.value })} style={{ ...inp, width: 100 }} />
            <select defaultValue={teamKeyOf(r.dept) || ''} onChange={e => updRow('mtn_labor_rates', r.id, { dept: e.target.value || null })} style={{ ...inp, width: 130 }}><option value="">ทุกทีม</option><TeamOpts list={mtnDepts} /></select>
            <button onClick={() => delRow('mtn_labor_rates', r.id)} className="tbtn" style={{ ...btnGhost, color: '#ef4444', padding: '6px 10px', marginLeft: 'auto' }}>🗑</button>
          </div>))}
        {!laborRates.length && <div style={{ color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีราคามาตรฐาน — เพิ่มด้านบน</div>}
      </div>
    </div>
  );

  /* SimpleList — master list ที่ "แยกมุมมองตามทีมช่างได้"
     ทีมของแถว: null/ว่าง = 🌐 ใช้ร่วมทุกทีม · ตั้งเป็นทีมใดทีมหนึ่ง = เห็นเฉพาะทีมนั้น
     ⚠️ ที่แยกคือ "มุมมอง" เท่านั้น — ตัวตนอุปกรณ์ (machine/jig id) เป็นของกลาง ห้ามแตกตามทีม */
  const SimpleList = ({ table, items, fields, addLabel, teamed = true, shared = false }) => {
    const [nw, setNw] = useState({});
    const [nwTeam, setNwTeam] = useState('');
    const [fTeam, setFTeam] = useState('');
    const shown = teamed ? filterByTeam(items, fTeam) : items;
    const teamOpts = mtnTeams.length ? mtnTeams : DEFAULT_TEAMS;
    const hiddenN = items.length - shown.length;

    /* ── ล็อกตามเจ้าของ (คำสั่ง user 2026-08-11) ─────────────────────────
       เดิมใครมีสิทธิ์ manage_master ก็แก้ของทุกทีมได้ → MTN เข้าไปเปลี่ยนชื่อของ
       DIE MTN ได้ และแถว 🌐 ของกลางแก้ทีเดียวกระทบทุกทีม (แบบเดียวกับที่เคย
       "แย่งกันตั้งเลข MAT") · กติกา:
         · แถวของทีมตัวเอง        → แก้/ลบได้
         · แถวของทีมอื่น          → อ่านอย่างเดียว
         · แถว 🌐 ใช้ร่วมทุกทีม   → เฉพาะ admin/manager (แก้ทีเดียวกระทบทุกทีม)
       ⚠️ fallback สำคัญ: user ที่ยังไม่ได้ตั้ง `profiles.mtn_teams` = ไม่ล็อก
          ไม่งั้นวันที่ deploy ช่างที่ยังไม่ถูกตั้งทีมจะแก้อะไรไม่ได้ทั้งระบบ */
    const isBoss = role === 'admin' || role === 'manager';
    const myKeys = (userTeams || []).map(teamKeyOf).filter(Boolean);
    const unscoped = myKeys.length === 0;
    const teamNameOf = (k) => (k ? (teamOpts.find(t => teamKeyOf(t.key) === teamKeyOf(k))?.dept_name || deptNameOf(k) || k) : '🌐 ใช้ร่วมทุกทีม');
    const canEditRow = (r) => {
      if (!teamed || isBoss || unscoped) return true;
      const t = teamKeyOf(r?.team);
      return t ? myKeys.includes(t) : false;      // ไม่มีทีม = ของกลาง → หัวหน้าเท่านั้น
    };
    const lockNote = (r) => {
      const t = teamKeyOf(r?.team);
      return t ? `รายการนี้เป็นของทีม ${teamNameOf(t)} — แก้ได้เฉพาะทีมนั้นหรือหัวหน้า`
        : 'รายการนี้ทุกทีมใช้ร่วมกัน — แก้ได้เฉพาะหัวหน้า (แก้ทีเดียวกระทบทุกทีม)';
    };
    // เปลี่ยนทีมของแถว = ของหายจากลิสต์ทีมเดิมทันที → ต้องบอกก่อนเสมอ ห้ามเงียบ
    const changeTeam = (it, v) => {
      const from = teamKeyOf(it.team), to = teamKeyOf(v) || null;
      if (from === to) return;
      const msg = !from
        ? `ตอนนี้ "${it[fields[0].k]}" ทุกทีมใช้ร่วมกัน\n\nเปลี่ยนเป็นของทีม "${teamNameOf(to)}" แล้ว\n→ ทีมอื่นจะไม่เห็นรายการนี้ในฟอร์มแจ้งซ่อมอีก`
        : to
          ? `ย้าย "${it[fields[0].k]}"\nจากทีม "${teamNameOf(from)}" → "${teamNameOf(to)}"\n\n→ ทีมเดิมจะไม่เห็นรายการนี้อีก`
          : `เปลี่ยน "${it[fields[0].k]}" เป็นของกลาง (ทุกทีมใช้ร่วมกัน)\n\n→ ทุกทีมจะเห็นรายการนี้ และแก้ได้เฉพาะหัวหน้า`;
      if (!confirm(msg + '\n\nยืนยัน?')) return;
      updRow(table, it.id, { team: to });
    };
    return (
      <div>
        {teamed && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' }}>ทีมช่าง:</span>
            <select value={fTeam} onChange={e => setFTeam(e.target.value)} style={{ ...inp, width: 210 }}>
              <option value="">ทุกทีม (เห็นทั้งหมด)</option>
              {teamOpts.map(t => <option key={t.key} value={t.key}>{t.icon || ''} {t.dept_name || t.label}</option>)}
            </select>
            {!!hiddenN && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>ซ่อน {hiddenN} รายการของทีมอื่น</span>}
            <span style={{ fontSize: 11.5, color: 'var(--muted)', marginLeft: 'auto' }}>🌐 = ใช้ร่วมทุกทีม</span>
          </div>
        )}
        {teamed && !isBoss && (
          <div style={{ fontSize: 11.5, color: 'var(--muted)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 7, padding: '7px 10px', marginBottom: 10 }}>
            {unscoped
              ? '⚠️ บัญชีนี้ยังไม่ได้ตั้ง "ทีมช่างซ่อม" ที่หน้าจัดการผู้ใช้งาน — ตอนนี้จึงยังแก้ได้ทุกรายการ · ตั้งทีมแล้วระบบจะล็อกให้แก้ได้เฉพาะของทีมตัวเอง'
              : <>🔒 แก้ได้เฉพาะรายการของทีม <b>{myKeys.map(teamNameOf).join(' · ')}</b> — ของทีมอื่นและรายการ 🌐 ใช้ร่วมทุกทีม ดูได้อย่างเดียว (แก้ทีเดียวกระทบทุกทีม ต้องให้หัวหน้าแก้)</>}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {fields.map(fl => <input key={fl.k} value={nw[fl.k] || ''} onChange={e => setNw(p => ({ ...p, [fl.k]: e.target.value }))} placeholder={fl.ph} style={{ ...inp, width: fl.w || 200 }} />)}
          {teamed && (
            /* เพิ่มของกลาง (🌐) ได้เฉพาะหัวหน้า — คนทีมเดียวเพิ่มได้แต่ของทีมตัวเอง */
            <select value={nwTeam || fTeam} onChange={e => setNwTeam(e.target.value)} style={{ ...inp, width: 190 }}>
              {(isBoss || unscoped) && <option value="">🌐 ใช้ร่วมทุกทีม</option>}
              {teamOpts.filter(t => isBoss || unscoped || myKeys.includes(teamKeyOf(t.key)))
                .map(t => <option key={t.key} value={t.key}>{t.icon || ''} {t.dept_name || t.label}</option>)}
            </select>
          )}
          <button onClick={() => {
            if (!nw[fields[0].k]) return;
            // ทีมของแถวใหม่: ที่เลือกในช่อง หรือ default = ทีมที่กำลังกรองอยู่ (เพิ่มของทีมตัวเองได้เลย)
            const payload = { ...nw, sort_order: items.length + 1 };
            if (teamed) {
              let t = (nwTeam || fTeam) || null;
              // ไม่ใช่หัวหน้า + สังกัดทีมเดียว → บังคับเป็นของทีมตัวเอง (กันเผลอสร้างเป็นของกลาง)
              if (!isBoss && !unscoped && !myKeys.includes(teamKeyOf(t))) t = myKeys.length === 1 ? myKeys[0] : null;
              if (!isBoss && !unscoped && !t) return toast.error('เลือกทีมของรายการก่อน — เพิ่มรายการ 🌐 ใช้ร่วมทุกทีม ได้เฉพาะหัวหน้า');
              payload.team = t;
            }
            addRow(table, payload); setNw({}); setNwTeam('');
          }} style={btnPri}>+ {addLabel}</button>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>{shown.map(it => {
          const ok = canEditRow(it);
          const ro = { background: 'var(--bg2)', color: 'var(--text2)', cursor: 'default' };
          return (
          <div key={it.id} title={ok ? undefined : lockNote(it)}
            style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', opacity: ok ? 1 : 0.72 }}>
            {fields.map(fl => <input key={fl.k} defaultValue={it[fl.k] || ''} readOnly={!ok} onBlur={ok ? async e => {
              const nv = e.target.value, ov = it[fl.k] || '';
              if (nv === ov) return;
              await updRow(table, it.id, { [fl.k]: nv });
              const col = NAME_CASCADE[table]?.[fl.k];   // ชื่อนี้ถูกคัดลอกไปเก็บในใบซ่อมด้วยไหม
              if (col) await cascadeRename(col, ov, nv);
            } : undefined} style={{ ...inp, ...(ok ? null : ro), flex: `1 1 ${fl.w || 200}px`, width: 'auto', minWidth: 120 }} />)}
            {teamed && (
              <select value={it.team || ''} disabled={!ok} onChange={e => changeTeam(it, e.target.value)}
                title={ok ? 'ทีมที่ใช้รายการนี้' : lockNote(it)} style={{ ...inp, ...(ok ? null : ro), width: 180, flex: '0 0 auto' }}>
                <option value="">🌐 ใช้ร่วมทุกทีม</option>
                {teamOpts.map(t => <option key={t.key} value={t.key}>{t.icon || ''} {t.dept_name || t.label}</option>)}
              </select>
            )}
            {/* 👁 ทีมอื่นที่ "เห็น" รายการนี้ด้วย — คนละเรื่องกับเจ้าของ (ที่แก้ได้)
                ใช้กับเคสงานทับซ้อน JIG MTN ↔ MTN · AM เห็นทุกแถวอยู่แล้วไม่ต้องติ๊ก */}
            {shared && teamed && (() => {
              const cur = Array.isArray(it.shared_teams) ? it.shared_teams.map(teamKeyOf) : [];
              const pickable = teamOpts.filter(t => !seesEverything(t.key) && teamKeyOf(t.key) !== teamKeyOf(it.team));
              return (
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }} title="ทีมอื่นที่เห็นรายการนี้ด้วย (เห็นได้ แต่แก้ไม่ได้)">
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>👁</span>
                  {pickable.map(t => {
                    const on = cur.includes(teamKeyOf(t.key));
                    return (
                      <button key={t.key} type="button" disabled={!ok}
                        onClick={() => updRow(table, it.id, { shared_teams: on ? cur.filter(x => x !== teamKeyOf(t.key)) : [...cur, teamKeyOf(t.key)] })}
                        style={{ padding: '3px 7px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: ok ? 'pointer' : 'not-allowed',
                          border: `1px solid ${on ? 'var(--accent)' : 'var(--border2)'}`, background: on ? 'var(--accent-dim)' : 'var(--bg3)',
                          color: on ? 'var(--accent)' : 'var(--muted)', opacity: ok ? 1 : 0.6 }}>
                        {t.icon || ''}{(t.dept_name || t.label || '').replace(' MTN', '')}
                      </button>);
                  })}
                </div>);
            })()}
            {ok
              ? <button onClick={() => delRow(table, it.id)} className="tbtn" style={{ ...btnGhost, color: '#ef4444', padding: '6px 10px', marginLeft: 'auto' }}>🗑</button>
              : <span title={lockNote(it)} style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>🔒 ดูอย่างเดียว</span>}
          </div>); })}
          {!shown.length && <div style={{ color: 'var(--muted)', fontSize: 13, padding: 12 }}>
            ไม่มีรายการของทีมนี้ — เพิ่มด้านบน (หรือเลือก "ทุกทีม" เพื่อดูของทีมอื่น)
          </div>}
        </div>
      </div>
    );
  };

  // ── เลขรัน MO ต่อทีม (ตั้งรหัสทีม + เลขเริ่มต้น เพื่อต่อจากระบบเดิม) ──
  const [moRows, setMoRows] = useState([]);
  const [moErr, setMoErr] = useState(false);
  const ymdToday = (() => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: '2-digit' }).formatToParts(new Date()); const g = t => p.find(x => x.type === t).value; return `${g('day')}${g('month')}${g('year')}`; })();
  const loadMoSeq = async () => {
    try {
      const [{ data: teams, error: e1 }, { data: seqs }] = await Promise.all([
        supabaseDR.from('mtn_teams').select('id, dept_name, mo_code, sort_order').eq('is_active', true).order('sort_order'),
        supabaseDR.from('mtn_mo_seq').select('team_code, last_seq'),
      ]);
      if (e1) throw e1;
      const byCode = {}; (seqs || []).forEach(s => { byCode[s.team_code] = s.last_seq; });
      setMoRows((teams || []).map(t => ({ ...t, last_seq: byCode[t.mo_code] ?? 0 }))); setMoErr(false);
    } catch { setMoErr(true); }
  };
  useEffect(() => { if (sub === 'mo') loadMoSeq(); }, [sub]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveMoCode = async (t, code) => { const c = (code || '').trim().toUpperCase(); if (!c) return; const { error } = await supabaseDR.from('mtn_teams').update({ mo_code: c }).eq('id', t.id); if (error) return toast.error(error.message); toast.success('บันทึกรหัสทีมแล้ว'); loadMoSeq(); };
  const saveMoSeq = async (code, val) => { const n = Math.max(0, parseInt(val, 10) || 0); const { error } = await supabaseDR.from('mtn_mo_seq').upsert({ team_code: code, last_seq: n, updated_at: new Date().toISOString() }, { onConflict: 'team_code' }); if (error) return toast.error(error.message); toast.success('บันทึกเลขล่าสุดแล้ว'); loadMoSeq(); };
  const MoSeqList = () => (
    <div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.7 }}>
        เลข MO ออกตอน <b>รับงาน (ขั้น 2)</b> รูปแบบ <code>รหัสทีม-ประเภท-วันเดือนปี-เลขรัน</code> เช่น <b style={{ color: 'var(--accent)' }}>MTN-BM-{ymdToday}-0678</b><br />
        เลขรัน<b>นับต่อเนื่องต่อทีม</b> (ไม่รีเซ็ตรายวัน) · ตั้ง "เลขล่าสุด" เพื่อ<b>ต่อจากระบบเดิม</b> — เช่น MTN เคยออกถึง 677 → ใส่ <b>677</b> ใบถัดไปจะเป็น 0678
      </div>
      {moErr ? <div style={{ color: 'var(--muted)', padding: 16, background: 'var(--bg2)', borderRadius: 8 }}>⚠️ ยังไม่ได้ apply migration เลข MO ต่อทีม (<code>20260724_mtn_mo_per_team.sql</code>) — apply ก่อนถึงจะตั้งค่าได้</div> :
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {moRows.map(t => (
            <div key={t.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
              <b style={{ flex: '1 1 120px', fontSize: 13 }}>{t.dept_name}</b>
              <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>รหัส <input defaultValue={t.mo_code || ''} onBlur={e => e.target.value.trim().toUpperCase() !== (t.mo_code || '') && saveMoCode(t, e.target.value)} style={{ ...inp, width: 74, marginLeft: 4, textTransform: 'uppercase', fontWeight: 700 }} /></label>
              <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>เลขล่าสุด <input type="number" min="0" defaultValue={t.last_seq} onBlur={e => Number(e.target.value) !== t.last_seq && saveMoSeq(t.mo_code, e.target.value)} style={{ ...inp, width: 96, marginLeft: 4 }} /></label>
              <span style={{ fontSize: 11.5, color: 'var(--accent)' }}>ถัดไป: {t.mo_code}-BM-{ymdToday}-{String((t.last_seq || 0) + 1).padStart(4, '0')}</span>
            </div>
          ))}
          {!moRows.length && <div style={{ color: 'var(--muted)' }}>ยังไม่มีทีมในตาราง mtn_teams</div>}
        </div>}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {[['tech', '👷 ช่าง (ทุกทีม)'], ['labor', '💰 ค่าแรงมาตรฐาน'], ['mo', '🔢 เลขรัน MO'], ['prob', '🛑 ลักษณะปัญหา'], ['item', '⚙️ ชนิดอุปกรณ์'], ['repair', '🔧 ประเภทงานซ่อม'], ['audit', '📜 ประวัติการแก้ไข']].map(([k, t]) =>
          <button key={k} onClick={() => setSub(k)} style={{ ...(sub === k ? btnPri : btnGhost), padding: '7px 14px', fontSize: 12.5 }}>{t}</button>)}
      </div>
      {sub === 'tech' && TechList()}
      {sub === 'labor' && LaborList()}
      {sub === 'mo' && MoSeqList()}
      {sub === 'audit' && <MasterAuditLog teams={mtnTeams.length ? mtnTeams : DEFAULT_TEAMS} />}
      {sub === 'prob' && <SimpleList table="mtn_problem_types" items={problemTypes} addLabel="เพิ่มปัญหา" shared
        fields={[{ k: 'group_name', ph: 'กลุ่มใหญ่ (เช่น ระบบลม)', w: 190 }, { k: 'characteristic', ph: 'หัวข้อย่อย', w: 220 }, { k: 'detail', ph: 'คำอธิบาย', w: 260 }]} />}
      {sub === 'item' && <SimpleList table="mtn_item_types" items={itemTypes} addLabel="เพิ่มชนิด" shared fields={[{ k: 'name', ph: 'ชนิดอุปกรณ์', w: 240 }]} />}
      {sub === 'repair' && (<>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
          ⚠️ รหัสย่อถูกใช้เป็นส่วนหนึ่งของเลข MO (เช่น <code>MTN-<b>BM</b>-060826-0001</code>) — เปลี่ยนแล้วมีผลกับใบที่ออกเลขใหม่เท่านั้น ใบเก่าคงเดิม
        </div>
        <SimpleList table="mtn_repair_types" items={repairTypes} addLabel="เพิ่มประเภท"
          fields={[{ k: 'name', ph: 'ประเภทงานซ่อม (เช่น Breakdown)', w: 260 }, { k: 'prefix', ph: 'รหัสย่อ BM/CM/PM', w: 150 }]} />
      </>)}
    </div>
  );
}

export { STATUS_META };
