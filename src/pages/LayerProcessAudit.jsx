import { useState, useEffect, useContext, useMemo, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { toast } from '../components/Toast';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { loadCompanyCalendar } from '../utils/companyCalendar';
import tsLogoUrl from '../assets/TS logo.png';
import { getDocForm, fullCode } from '../utils/docForms';

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

const LAYERS = [
  { key: 'leader', label: 'Leader', freq: 'ทุกวัน', planKey: 'plan_leader' },
  { key: 'supervisor', label: 'Supervisor', freq: 'รายสัปดาห์', planKey: 'plan_supervisor' },
  { key: 'manager', label: 'Manager', freq: 'รายเดือน', planKey: 'plan_manager' },
  { key: 'gm', label: 'GM', freq: 'รายไตรมาส', planKey: 'plan_gm' },
];
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 3200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
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

export default function LayerProcessAudit() {
  const { role, lineId: userLineId, sections: scopeSecs = [], fullName } = useContext(UserContext);
  const canRecord = can('lpa', 'record', role);
  const canManage = can('lpa', 'manage', role);
  const canDelete = can('lpa', 'delete', role);

  const [tab, setTab] = useState('audit');
  const [lines, setLines] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [myProfile, setMyProfile] = useState(null);
  const [calReady, setCalReady] = useState(false);

  const [selLine, setSelLine] = useState('');
  const [selShift, setSelShift] = useState(getCurrentShift());
  const [selMonth, setSelMonth] = useState(getWorkDate().slice(0, 7));

  /* plan */
  const [plan, setPlan] = useState(null);           // แถว lpa_plans ของ (line, shift, month)
  const [planDays, setPlanDays] = useState({});     // { day: {station, plan_leader, ...} }
  const [monthAudits, setMonthAudits] = useState([]); // audits+answers ของเดือนที่เลือก
  const [savingPlan, setSavingPlan] = useState(false);

  /* audit record */
  const [auditDate, setAuditDate] = useState(getWorkDate());
  const [auditLayer, setAuditLayer] = useState(role === 'manager' ? 'manager' : role === 'supervisor' ? 'supervisor' : role === 'engineer' || role === 'qa' ? 'supervisor' : 'leader');
  const [draft, setDraft] = useState(null);          // { id?, station, auditor_name, auditor_sig_url, answers: {qid:{answer,note}} }
  const [savingAudit, setSavingAudit] = useState(false);
  const [showSignPad, setShowSignPad] = useState(false);

  /* questions master */
  const [qEditing, setQEditing] = useState(null);
  const [printing, setPrinting] = useState(false);

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
        supabase.from('production_lines').select('id, name, section, parent_line_name').order('name'),
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

  /* ── โหลดแผน + ผลตรวจของเดือน เมื่อเปลี่ยน line/shift/month ── */
  const loadMonth = async () => {
    if (!selLine) return;
    const first = dateOf(selMonth, 1);
    const last = dateOf(selMonth, daysInMonth(selMonth));
    const [{ data: pl }, { data: aud }] = await Promise.all([
      supabase.from('lpa_plans').select('*, lpa_plan_days(*)').eq('line_name', selLine).eq('shift', selShift).eq('month_key', selMonth).maybeSingle(),
      supabase.from('lpa_audits').select('*, lpa_audit_answers(*)').eq('line_name', selLine).eq('shift', selShift).gte('audit_date', first).lte('audit_date', last).order('audit_date'),
    ]);
    setPlan(pl || null);
    const dm = {};
    (pl?.lpa_plan_days || []).forEach(d => { dm[d.day] = d; });
    setPlanDays(dm);
    setMonthAudits(aud || []);
  };
  useEffect(() => { loadMonth(); }, [selLine, selShift, selMonth]);

  /* คำถามที่ใช้กับไลน์+วันที่ (special เฉพาะช่วงเฝ้าระวัง) */
  const questionsFor = (lineName, dstr) => questions.filter(q => {
    if (!q.is_active) return false;
    if (q.line_name && q.line_name !== lineName) return false;
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

  const savePlan = async () => {
    if (!canManage) return;
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

  /* ═════════ TAB: บันทึกผลตรวจ ═════════ */
  const auditQuestions = useMemo(() => questionsFor(selLine, auditDate), [questions, selLine, auditDate]);

  useEffect(() => {
    if (!selLine || tab !== 'audit') return;
    (async () => {
      const [{ data: existing }, { data: pl }] = await Promise.all([
        supabase.from('lpa_audits').select('*, lpa_audit_answers(*)').eq('line_name', selLine).eq('shift', selShift).eq('audit_date', auditDate).eq('layer', auditLayer).maybeSingle(),
        supabase.from('lpa_plans').select('id, lpa_plan_days(day, station)').eq('line_name', selLine).eq('shift', selShift).eq('month_key', auditDate.slice(0, 7)).maybeSingle(),
      ]);
      const planStation = pl?.lpa_plan_days?.find(d => d.day === Number(auditDate.slice(8, 10)))?.station || '';
      if (existing) {
        const ans = {};
        (existing.lpa_audit_answers || []).forEach(a => { if (a.question_id) ans[a.question_id] = { answer: a.answer, note: a.note || '' }; });
        setDraft({ id: existing.id, station: existing.station || planStation, auditor_name: existing.auditor_name || fullName || '', auditor_sig_url: existing.auditor_sig_url || null, answers: ans });
      } else {
        setDraft({ id: null, station: planStation, auditor_name: fullName || '', auditor_sig_url: myProfile?.signature_url || null, answers: {} });
      }
    })();
  }, [selLine, selShift, auditDate, auditLayer, tab, myProfile, fullName]);

  const setAnswer = (qid, answer) => setDraft(prev => ({ ...prev, answers: { ...prev.answers, [qid]: { ...(prev.answers[qid] || {}), answer } } }));
  const setAnsNote = (qid, note) => setDraft(prev => ({ ...prev, answers: { ...prev.answers, [qid]: { ...(prev.answers[qid] || {}), note } } }));
  const setAllY = () => setDraft(prev => {
    const ans = { ...prev.answers };
    auditQuestions.forEach(q => { if (!ans[q.id]?.answer) ans[q.id] = { ...(ans[q.id] || {}), answer: 'Y' }; });
    return { ...prev, answers: ans };
  });

  const handleSignDone = async (blob) => {
    setShowSignPad(false);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) { toast.error('เซสชันหมดอายุ — กรุณา login ใหม่'); return; }
      const path = `${user.id}/lpa_${Date.now()}.png`;
      const { error } = await supabase.storage.from('signatures').upload(path, blob, { contentType: 'image/png' });
      if (error) { toast.error('อัปโหลดลายเซ็นไม่สำเร็จ: ' + error.message); return; }
      const url = supabase.storage.from('signatures').getPublicUrl(path).data.publicUrl;
      // ลบไฟล์เซ็นเฉพาะกิจอันเก่า (เฉพาะโฟลเดอร์ตัวเอง — ไม่ลบลายเซ็นโปรไฟล์)
      const old = draft?.auditor_sig_url;
      if (old?.includes('/signatures/') && old.includes('/lpa_') && old !== myProfile?.signature_url) {
        const oldPath = decodeURIComponent(old.split('/signatures/')[1] || '').split('?')[0];
        if (oldPath.startsWith(`${user.id}/`)) supabase.storage.from('signatures').remove([oldPath]).catch(() => {});
      }
      setDraft(prev => ({ ...prev, auditor_sig_url: url }));
      toast.success('บันทึกลายเซ็นแล้ว');
    } catch (e) { toast.error('เกิดข้อผิดพลาด: ' + e.message); }
  };

  const saveAudit = async () => {
    if (!canRecord) return;
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
      const { error: insErr } = await supabase.from('lpa_audit_answers').insert(
        auditQuestions.map(q => ({
          audit_id: saved.id, question_id: q.id, question_text: q.question,
          answer: draft.answers[q.id].answer, note: draft.answers[q.id].note?.trim() || null,
        }))
      );
      if (insErr) throw insErr;
      toast.success(`บันทึกผลตรวจ LPA ${thDate(auditDate)} เรียบร้อย`);
      setDraft(prev => ({ ...prev, id: saved.id }));
      loadMonth();
    } catch (e) { toast.error('บันทึกไม่สำเร็จ: ' + e.message); }
    finally { setSavingAudit(false); }
  };

  const deleteAudit = async () => {
    if (!draft?.id || !canDelete) return;
    if (!window.confirm(`ลบผลตรวจ ${thDate(auditDate)} ${SHIFT_META[selShift]} ชั้น ${LAYERS.find(l => l.key === auditLayer)?.label}?`)) return;
    const { error } = await supabase.from('lpa_audits').delete().eq('id', draft.id);
    if (error) { toast.error('ลบไม่สำเร็จ: ' + error.message); return; }
    toast.success('ลบแล้ว');
    setDraft(prev => ({ ...prev, id: null, answers: {} }));
    loadMonth();
  };

  /* ═════════ TAB: คำถาม master ═════════ */
  const saveQuestion = async () => {
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
    const { error } = await supabase.from('lpa_questions').update({ is_active: !q.is_active }).eq('id', q.id);
    if (error) { toast.error(error.message); return; }
    setQuestions(prev => prev.map(x => x.id === q.id ? { ...x, is_active: !q.is_active } : x));
  };
  const deleteQuestion = async (q) => {
    if (!window.confirm(`ลบคำถาม "${q.question.slice(0, 50)}"? (ผลตรวจเก่าเก็บข้อความ snapshot ไว้แล้ว ไม่หาย)`)) return;
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
      const sigCell = (a, extra = '') => `<td style="border:1px solid #000;text-align:center;vertical-align:middle;${extra}">${a ? (sigDataUrls[a.id] ? `<img src="${sigDataUrls[a.id]}" style="max-height:16px;max-width:20px;object-fit:contain"/>` : `<div style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:6px;white-space:nowrap;max-height:40px;overflow:hidden;margin:0 auto">${(a.auditor_name || '').slice(0, 12)}</div>`) : ''}</td>`;
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
    <td colspan="3" style="border:1px solid #000;text-align:right;padding:1px 6px;font-size:8px;font-weight:bold;height:44px;vertical-align:middle">ลงชื่อ ผู้ตรวจสอบ</td>
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
  const TabBtn = ({ id, icon, label }) => (
    <button onClick={() => setTab(id)}
      style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid ' + (tab === id ? 'var(--accent)' : 'var(--border2)'), background: tab === id ? 'rgba(34,197,94,0.12)' : 'var(--bg3)', color: tab === id ? 'var(--accent)' : 'var(--text2)', fontWeight: 700, cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' }}>
      {icon} {label}
    </button>
  );

  const selectorBar = (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
      <div>
        <div style={lb}>ไลน์ / พื้นที่ตรวจ</div>
        <select value={selLine} onChange={e => setSelLine(e.target.value)} style={{ width: 210, padding: '7px 10px', borderRadius: 7, fontSize: 13 }}>
          {visibleLines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
        </select>
      </div>
      <div>
        <div style={lb}>กะ</div>
        <select value={selShift} onChange={e => setSelShift(e.target.value)} style={{ width: 150, padding: '7px 10px', borderRadius: 7, fontSize: 13 }}>
          <option value="day">{SHIFT_META.day}</option>
          <option value="night">{SHIFT_META.night}</option>
        </select>
      </div>
      <div>
        <div style={lb}>เดือน</div>
        <input type="month" value={selMonth} onChange={e => e.target.value && setSelMonth(e.target.value)} style={{ width: 150, padding: '6px 10px', borderRadius: 7, fontSize: 13 }} />
      </div>
    </div>
  );

  const nDays = daysInMonth(selMonth);
  const daysArr = Array.from({ length: nDays }, (_, i) => i + 1);

  return (
    <div className="page-content" style={{ maxWidth: 'min(97vw, 1800px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(16px,3vw,22px)', color: 'var(--text)' }}>📋 Layer Process Audit (LPA)</h2>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>แผนตรวจ + บันทึกผล + รายงาน {FORM_NO} — Leader ทุกวัน · Supervisor รายสัปดาห์ · Manager รายเดือน · GM รายไตรมาส</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <TabBtn id="audit" icon="✅" label="บันทึกผลตรวจ" />
          <TabBtn id="plan" icon="📅" label="แผนตรวจ" />
          <TabBtn id="report" icon="📊" label="รายงาน" />
          {canManage && <TabBtn id="questions" icon="⚙️" label="คำถาม" />}
        </div>
      </div>

      {selectorBar}

      {/* ═════════ แผนตรวจ ═════════ */}
      {tab === 'plan' && (
        <div className="card" style={{ padding: 16 }}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 12 }}>
            {[['leader_name', 'Leader'], ['supervisor_name', 'Supervisor'], ['manager_name', 'Manager'], ['gm_name', 'GM Plant']].map(([k, label]) => (
              <div key={k}>
                <div style={lb}>{label}</div>
                <input type="text" list="lpa-profiles" value={plan?.[k] || ''} onChange={e => setPlanF(k, e.target.value)} disabled={!canManage}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 7, fontSize: 13 }} />
              </div>
            ))}
          </div>
          <datalist id="lpa-profiles">{profiles.filter(p => p.full_name).map(p => <option key={p.id} value={p.full_name} />)}</datalist>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
            <div style={{ flex: '1 1 340px' }}>
              <div style={lb}>รายชื่อสถานีตรวจ (Station for audit — บรรทัดละชื่อ หรือคั่นด้วย , · ใช้เติมแผนอัตโนมัติวนตามลำดับ)</div>
              <textarea rows={3} value={plan?.stations || ''} onChange={e => setPlanF('stations', e.target.value)} disabled={!canManage}
                placeholder={'ปืนยิงBoat\nSTAMP MARK\nJig-01\nJig-02 ...'} style={{ width: '100%', fontSize: 13 }} />
            </div>
            {canManage && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={autoFillPlan} style={btnAmber}>⚡ เติมแผนอัตโนมัติ</button>
                <button onClick={savePlan} disabled={savingPlan} style={btnAccent}>{savingPlan ? '⏳...' : '💾 บันทึกแผน'}</button>
                <button onClick={printPlan} disabled={printing} style={btnBlue}>🖨️ พิมพ์ใบแผน</button>
              </div>
            )}
            {!canManage && <button onClick={printPlan} disabled={printing} style={btnBlue}>🖨️ พิมพ์ใบแผน</button>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            <span style={{ color: 'var(--text2)' }}>○ วางแผน</span> · <span style={{ color: '#22c55e' }}>● ตรวจแล้ว</span> · <span style={{ color: '#ef4444' }}>⊗ เลยกำหนดยังไม่ตรวจ</span> · แถวเขียว = วันหยุด
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 720 }}>
              <thead>
                <tr style={{ fontSize: 12 }}>
                  <th style={{ width: 90 }}>วันที่</th>
                  <th style={{ textAlign: 'left' }}>Station for audit</th>
                  {LAYERS.map(l => <th key={l.key} style={{ width: 96, textAlign: 'center' }}>{l.label}<div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>{l.freq}</div></th>)}
                </tr>
              </thead>
              <tbody>
                {daysArr.map(d => {
                  const dstr = dateOf(selMonth, d);
                  const holiday = isHoliday(dstr);
                  const pd = planDays[d] || {};
                  return (
                    <tr key={d} style={holiday ? { background: 'rgba(46,125,50,0.16)' } : undefined}>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 12, fontWeight: 700, color: holiday ? '#4caf50' : 'var(--text)' }}>
                        {d} <span style={{ fontSize: 11, color: 'var(--muted)' }}>({DOW_TH[dowOf(dstr)]})</span>
                      </td>
                      <td>
                        {holiday ? <span style={{ fontSize: 11, color: '#4caf50' }}>วันหยุด</span> : (
                          <input type="text" value={pd.station || ''} onChange={e => setPlanDay(d, { station: e.target.value })} disabled={!canManage}
                            style={{ width: 'min(100%, 260px)', fontSize: 12, padding: '4px 8px' }} />
                        )}
                      </td>
                      {LAYERS.map(l => {
                        const s = statusSymbol(d, l.key, l.planKey);
                        return (
                          <td key={l.key} style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {!holiday && (
                              <label style={{ cursor: canManage ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                <input type="checkbox" checked={!!pd[l.planKey]} disabled={!canManage}
                                  onChange={e => setPlanDay(d, { [l.planKey]: e.target.checked })} style={{ width: 'auto' }} />
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
      )}

      {/* ═════════ บันทึกผลตรวจ ═════════ */}
      {tab === 'audit' && (
        <div className="card" style={{ padding: 16 }}>
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
              <input type="text" value={draft?.station || ''} onChange={e => setDraft(prev => ({ ...prev, station: e.target.value }))}
                placeholder="ตามแผน / ระบุเอง" style={{ width: 190, padding: '6px 10px', borderRadius: 7, fontSize: 13 }} />
            </div>
            <div>
              <div style={lb}>ผู้ตรวจ</div>
              <input type="text" value={draft?.auditor_name || ''} onChange={e => setDraft(prev => ({ ...prev, auditor_name: e.target.value }))}
                style={{ width: 180, padding: '6px 10px', borderRadius: 7, fontSize: 13 }} />
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
              {canDelete && <button onClick={deleteAudit} style={{ ...btnGray, color: '#ef4444', border: '1px solid rgba(239,68,68,0.4)', fontSize: 12, padding: '4px 10px' }}>🗑 ลบผลตรวจนี้</button>}
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
                      <div style={{ display: 'flex', gap: 5 }}>
                        {ANSWERS.map(an => (
                          <button key={an.key} disabled={!canRecord} onClick={() => setAnswer(q.id, an.key)}
                            style={{
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

          {canRecord && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              <button onClick={saveAudit} disabled={savingAudit} style={{ ...btnAccent, padding: '10px 26px' }}>
                {savingAudit ? '⏳ กำลังบันทึก...' : '💾 บันทึกผลตรวจ'}
              </button>
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
              </div>
              <button onClick={printReport} disabled={printing} style={btnBlue}>{printing ? '...' : `🖨️ พิมพ์รายงาน ${FORM_NO.split(' ')[0]}`}</button>
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
                          {daysArr.map(d => isHoliday(dateOf(selMonth, d))
                            ? <td key={d} style={{ ...cellStyle, background: 'rgba(46,125,50,0.25)' }}></td>
                            : ansTd(leaderAud[d], q.id, {}, d))}
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

      {/* ═════════ คำถาม master ═════════ */}
      {tab === 'questions' && canManage && (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>คำถามมาตรฐานใช้ทุกไลน์ · ข้อ "เฝ้าระวังปัญหา" (special) ผูกไลน์ + ช่วงวันที่ แสดงเฉพาะช่วงเฝ้าระวัง</div>
            <button onClick={() => setQEditing({ category: 'special', seq: (Math.max(0, ...questions.map(q => q.seq)) + 1), question: '', line_name: selLine, issue_start: getWorkDate(), issue_end: '', is_active: true })} style={btnAccent}>➕ เพิ่มคำถาม</button>
          </div>
          {CATEGORIES.map(cat => {
            const catQs = questions.filter(q => q.category === cat.key).sort((a, b) => a.seq - b.seq);
            if (!catQs.length) return null;
            return (
              <div key={cat.key} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: cat.key === 'special' ? '#ef4444' : 'var(--text)', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>{cat.full}</div>
                {catQs.map(q => (
                  <div key={q.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px dashed var(--border)', opacity: q.is_active ? 1 : 0.45 }}>
                    <div style={{ flex: 1, fontSize: 13, color: cat.key === 'special' ? '#f87171' : 'var(--text2)' }}>
                      <b>{q.seq}.</b> {q.question}
                      {q.line_name && <span style={{ fontSize: 11, color: 'var(--muted)' }}> · ไลน์ {q.line_name}</span>}
                      {(q.issue_start || q.issue_end) && <span style={{ fontSize: 11, color: 'var(--muted)' }}> · {thDate(q.issue_start)} - {thDate(q.issue_end)}</span>}
                      {!q.is_active && <span style={{ fontSize: 11, color: '#ef4444' }}> · ปิดใช้งาน</span>}
                    </div>
                    <button className="tbtn" onClick={() => setQEditing({ ...q })} style={{ ...btnGray, padding: '4px 10px', fontSize: 12 }}>✏️</button>
                    <button className="tbtn" onClick={() => toggleQuestion(q)} style={{ ...btnGray, padding: '4px 10px', fontSize: 12 }}>{q.is_active ? '⏸' : '▶'}</button>
                    <button className="tbtn" onClick={() => deleteQuestion(q)} style={{ ...btnGray, color: '#ef4444', padding: '4px 10px', fontSize: 12 }}>🗑</button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* modal แก้คำถาม (มีฟอร์ม — ไม่ปิดจาก backdrop) */}
      {qEditing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
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
                <select value={qEditing.line_name || ''} onChange={e => setQEditing(p => ({ ...p, line_name: e.target.value }))} style={{ width: '100%' }}>
                  <option value="">— ทุกไลน์ —</option>
                  {visibleLines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                </select>
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
    </div>
  );
}

const lb = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 };
const btnGray = { padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 };
const btnAccent = { padding: '7px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 };
const btnAmber = { padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.12)', color: '#f59e0b', fontWeight: 700, cursor: 'pointer', fontSize: 13 };
const btnBlue = { padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(77,159,255,0.35)', background: 'rgba(77,159,255,0.12)', color: '#4d9fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 };
