/* MtnRepair — ใบแจ้งซ่อม MO (Maintenance Order) 7 ขั้น
   Clone จากระบบ AppSheet เดิม (Jig MTN) มาอยู่ใน ESM · ข้อมูลอยู่ DR project (supabaseDR = anon)
   ครอบคลุมทุกทีมซ่อม: PRODUCTION(Autonomous)/JIG MTN/DIE MTN/MTN
   Workflow: 1 แจ้งซ่อม → 2 รับ/จ่ายงาน(ออกเลข MO) → 3 ซ่อม → 4 ตรวจ → 5 คุณภาพ(เฉพาะงานคุณภาพ)
             → 6 รับมอบ/ติดตาม → 7 อนุมัติปิด (Close MO)
   สิทธิ์ (role_permissions): mtn_repair:report/service/qa/approve/manage_master · ดู docs/PERMISSIONS-DESIGN.md */
import { useState, useEffect, useContext, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { teamsForUser } from '../utils/mtnTeams';
import { loadDocForms, docFormSync } from '../utils/docForms';
loadDocForms(); // ทะเบียนเอกสาร — printMoReport (sync) อ่านผ่าน docFormSync
import { fmtDateTime } from '../utils/dateFormat';
import tsLogo from '../assets/TS logo.png';
import EventComments from '../components/EventComments';

/* ── helpers ─────────────────────────────────────────────── */
// รูปแจ้งซ่อม/หลักฐาน MTN — บีบ 1024px q0.8 (~120KB) สมดุลคม/ประหยัด storage (user เลือก B 2026-07-14)
function resizeImage(file, maxPx = 1024, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('บีบรูปไม่สำเร็จ'))), 'image/jpeg', quality);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('อ่านไฟล์รูปไม่ได้'));
    img.src = URL.createObjectURL(file);
  });
}
const getWorkDate = () => {
  const now = new Date();
  if (now.getHours() < 8) now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const mtnPath = (url) => { const p = url?.split('/mtn-images/')[1]; return p ? decodeURIComponent(p) : null; };
const removeMtnImg = (url) => { const p = mtnPath(url); if (p) supabaseDR.storage.from('mtn-images').remove([p]).catch(() => {}); };
const uploadMtnImg = async (blob, path) => {
  const { error } = await supabaseDR.storage.from('mtn-images').upload(path, blob, { upsert: true, contentType: blob.type });
  if (error) throw error;
  return supabaseDR.storage.from('mtn-images').getPublicUrl(path).data.publicUrl;
};
const minutesBetween = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000)) : null);
const fmtMin = (m) => (m == null ? '—' : m < 60 ? `${m} นาที` : `${Math.floor(m / 60)} ชม. ${m % 60} นาที`);
// echo วันที่ (input ISO YYYY-MM-DD ค.ศ.) → DD/MM/พ.ศ.
const beEcho = (ymd) => { if (!ymd) return ''; const [y, m, d] = ymd.split('-'); return `${d}/${m}/${Number(y) + 543}`; };

// หน่วยงานซ่อม + auto จากชนิดอุปกรณ์
const MTN_DEPTS = ['JIG MTN', 'DIE MTN', 'MTN', 'PRODUCTION'];
const deptForItem = (it) => { const s = (it || '').toUpperCase(); if (s.includes('JIG')) return 'JIG MTN'; if (s.includes('DIE')) return 'DIE MTN'; return 'MTN'; };

const STATUS_META = {
  pending:   { label: '📣 รอรับงาน',        step: 1, color: '#ef4444', bg: 'rgba(239,68,68,0.14)' },
  assigned:  { label: '🔧 รับงานแล้ว/รอซ่อม', step: 2, color: '#f59e0b', bg: 'rgba(245,158,11,0.14)' },
  repairing: { label: '🔧 กำลังซ่อม',        step: 2, color: '#f59e0b', bg: 'rgba(245,158,11,0.14)' },
  repaired:  { label: '🔎 รอตรวจหลังซ่อม',    step: 3, color: '#f59e0b', bg: 'rgba(245,158,11,0.14)' },
  checked:   { label: '🧪 รอคุณภาพ/รับมอบ',   step: 4, color: '#f59e0b', bg: 'rgba(245,158,11,0.14)' },
  qa:        { label: '🤝 รอรับมอบ',          step: 5, color: '#f59e0b', bg: 'rgba(245,158,11,0.14)' },
  handover:  { label: '✍️ รออนุมัติปิด',      step: 6, color: '#3b82f6', bg: 'rgba(59,130,246,0.14)' },
  closed:    { label: '✅ ปิด MO',            step: 7, color: '#22c55e', bg: 'rgba(34,197,94,0.14)' },
  rejected:  { label: '⛔ Reject MO',         step: 0, color: '#8b8b96', bg: 'rgba(139,139,150,0.14)' },
};
const SCOPE_OPTS = [{ v: 'in_line', t: 'ซ่อมในไลน์' }, { v: 'off_line', t: 'ซ่อมนอกไลน์' }];
const CHECK_RESULTS = ['ตรวจสอบผ่าน', 'ตรวจสอบไม่ผ่าน'];
const QUALITY_OPTS = ['ไม่เกี่ยวกับคุณภาพ', 'เกี่ยวกับคุณภาพ'];
const QA_RESULTS = ['ผ่านคุณภาพ', 'ไม่ผ่านคุณภาพ'];
const FOLLOW_OPTS = ['ไม่เกิดปัญหาซ้ำ', 'แจ้งเฝ้าระวัง', 'เกิดปัญหาซ้ำ', 'แก้ไขไม่ได้'];
const STEP_EVENT = { 1: 'mtn_reported', 2: 'mtn_assigned', 3: 'mtn_repaired', 4: 'mtn_checked', 5: 'mtn_qa', 6: 'mtn_handover', 7: 'mtn_closed' };
const STEP_PERM = { 2: 'service', 3: 'service', 4: 'service', 5: 'qa', 6: 'report', 7: 'approve' };

const notifyMtn = (payload, event) => {
  fetch('https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-mtn-notification', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, mo: payload }),
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
      <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && onPick(e.target.files[0])} style={{ fontSize: 12 }} />
    </div>
  );
}
function ModalShell({ title, onClose, children, wide }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 3000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '4vh 2vw' }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, width: wide ? 'min(96vw, 1200px)' : 'min(96vw, 640px)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--card)', zIndex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: 'var(--muted)', cursor: 'pointer', lineHeight: 1 }}>✕</button>
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
  const { role, lineId, sections: scopeSecs, fullName, signatureUrl } = useContext(UserContext);
  const [tab, setTab] = useState('list');
  const [orders, setOrders] = useState([]);
  const [lines, setLines] = useState([]);
  const [machines, setMachines] = useState([]);
  const [techs, setTechs] = useState([]);
  const [parts, setParts] = useState([]);
  const [problemTypes, setProblemTypes] = useState([]);
  const [repairTypes, setRepairTypes] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  const [improvements, setImprovements] = useState([]); // โปรเจคปรับปรุงที่กำลังทำ (cross-ref D)
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
    const [{ data: ln }, { data: mc }, { data: tc }, { data: pt }, { data: pp }, { data: rt }, { data: it }, { data: imp }] = await Promise.all([
      supabase.from('production_lines').select('id, name, section, parent_line_name, cost_center').order('name'),
      supabaseDR.from('machines').select('id, line_name, machine_no, machine_name').eq('is_active', true).order('sort_order'),
      supabaseDR.from('mtn_technicians').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('mtn_problem_types').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('mtn_spare_parts').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('mtn_repair_types').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('mtn_item_types').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('improvements').select('id, line_name, machine_no, title').eq('status', 'monitoring'),
    ]);
    setLines(ln || []); setMachines(mc || []); setTechs(tc || []);
    setProblemTypes(pt || []); setParts(pp || []); setRepairTypes(rt || []); setItemTypes(it || []);
    setImprovements(imp || []);
    return ln || [];
  }, []);

  const scopeLines = useMemo(() => {
    if (role === 'admin') return null;
    if (role === 'leader' && lineId) { const self = lines.find(l => l.id === lineId); return self ? new Set(getLineFamilyNames(lines, self.name)) : new Set(); }
    if (scopeSecs?.length) return new Set(lines.filter(l => inSectionScope(scopeSecs, l.section)).map(l => l.name));
    return null;
  }, [lines, role, lineId, scopeSecs]);

  // ทีมช่างของ user (จาก section) — ใช้ default คิวงาน + default หน่วยงานตอนแจ้ง
  const userTeams = useMemo(() => teamsForUser(scopeSecs), [scopeSecs]);
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
    (async () => { setLoading(true); await loadMasters(); await loadOrders(); setLoading(false); })();
    const ch = supabaseDR.channel('mtn-orders-rt').on('postgres_changes', { event: '*', schema: 'public', table: 'mtn_orders' }, () => loadOrders()).subscribe();
    return () => { supabaseDR.removeChannel(ch); };
  }, [loadMasters, loadOrders]);

  const shown = useMemo(() => {
    let rows = orders;
    if (scopeLines) rows = rows.filter(o => !o.line_name || scopeLines.has(o.line_name));
    if (fStatus === 'open') rows = rows.filter(o => !['closed', 'rejected'].includes(o.status));
    else if (fStatus === 'closed') rows = rows.filter(o => o.status === 'closed');
    else if (fStatus !== 'all') rows = rows.filter(o => o.status === fStatus);
    if (fLine) rows = rows.filter(o => o.line_name === fLine);
    if (fDept) rows = rows.filter(o => (o.mtn_dept || deptForItem(o.item_type)) === fDept);
    if (fText.trim()) { const t = fText.trim().toLowerCase(); rows = rows.filter(o => [o.mo_no, o.machine_no, o.item_type, o.problem_characteristic, o.report_note, o.line_name].some(v => (v || '').toLowerCase().includes(t))); }
    return rows;
  }, [orders, scopeLines, fStatus, fLine, fDept, fText]);

  const openCount = useMemo(() => orders.filter(o => !['closed', 'rejected'].includes(o.status) && (!scopeLines || !o.line_name || scopeLines.has(o.line_name))).length, [orders, scopeLines]);
  const lineOpts = useMemo(() => (scopeLines ? lines.filter(l => scopeLines.has(l.name)) : lines).map(l => l.name), [lines, scopeLines]);

  // เปิดโปรเจคปรับปรุงจากใบ MO (เชื่อม B) — ส่ง prefill ผ่าน sessionStorage แล้วไปหน้า /improvements
  const openImprovementFromMo = (o) => {
    sessionStorage.setItem('imp_prefill', JSON.stringify({
      line_name: o.line_name, machine_no: o.machine_no, item_type: o.item_type,
      problem: o.problem_characteristic, title: `ลดใบซ่อม ${o.problem_characteristic || ''} ${o.machine_no || ''}`.trim(),
    }));
    navigate('/improvements');
  };

  if (loading) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>กำลังโหลด…</div>;

  const cp = { lines, machines, techs, parts, problemTypes, repairTypes, itemTypes, role, fullName, signatureUrl, improvements, defaultDept: userTeams.length === 1 ? userTeams[0] : '', onOpenImprovement: openImprovementFromMo, onReload: loadOrders, reloadMasters: loadMasters };

  return (
    <div style={{ padding: 'clamp(12px,2.5vw,24px)', maxWidth: 'min(97vw, 1800px)', margin: '0 auto' }}>
      <div style={{ display: 'flex', paddingRight: 52, alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <h1 style={{ fontSize: 'clamp(18px,3vw,26px)', fontWeight: 800, color: 'var(--text)', margin: 0 }}>🛠️ แจ้งซ่อม MTN (MO)</h1>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>ค้างดำเนินการ <b style={{ color: openCount ? '#ef4444' : '#22c55e' }}>{openCount}</b> ใบ</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {[['list', '📋 รายการ MO'], ['kpi', '📊 KPI'], ...(can('mtn_repair', 'manage_master', role) ? [['master', '⚙️ ข้อมูลหลัก']] : [])].map(([k, t]) => (
            <button key={k} onClick={() => setTab(k)} style={{ ...(tab === k ? btnPri : btnGhost), padding: '7px 14px', fontSize: 12.5 }}>{t}</button>
          ))}
        </div>
      </div>

      {tab === 'list' && <>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          {can('mtn_repair', 'report', role) && <button onClick={() => setShowReport(true)} style={{ ...btnPri, padding: '9px 16px' }}>➕ แจ้งซ่อมใหม่</button>}
          <select value={fStatus} onChange={e => setFStatus(e.target.value)} style={{ ...inp, width: 170 }}>
            <option value="open">🔵 ยังไม่ปิด (ทั้งหมด)</option><option value="all">ทุกสถานะ</option>
            {Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}<option value="closed">✅ ปิดแล้ว</option>
          </select>
          <select value={fDept} onChange={e => setFDept(e.target.value)} style={{ ...inp, width: 150 }}><option value="">ทุกหน่วยงาน</option>{MTN_DEPTS.map(d => <option key={d}>{d}</option>)}</select>
          <select value={fLine} onChange={e => setFLine(e.target.value)} style={{ ...inp, width: 180 }}><option value="">ทุกไลน์</option>{lineOpts.map(n => <option key={n} value={n}>{n}</option>)}</select>
          <input value={fText} onChange={e => setFText(e.target.value)} placeholder="ค้นหา เลข MO/เครื่อง/ปัญหา" style={{ ...inp, width: 230 }} />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{shown.length} รายการ</span>
        </div>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}>
          {shown.map(o => <MoCard key={o.id} o={o} onOpen={() => setDetail(o)} />)}
          {!shown.length && <div style={{ color: 'var(--muted)', padding: 24 }}>ไม่มีรายการ</div>}
        </div>
      </>}

      {tab === 'kpi' && <KpiTab orders={orders} scopeLines={scopeLines} lineOpts={lineOpts} />}
      {tab === 'master' && can('mtn_repair', 'manage_master', role) && <MasterTab {...cp} fullName={fullName} />}

      {showReport && <ReportModal {...cp} onClose={() => setShowReport(false)} onSaved={() => { setShowReport(false); loadOrders(); }} />}
      {detail && <DetailDrawer order={orders.find(x => x.id === detail.id) || detail} {...cp}
        onClose={() => setDetail(null)} onStep={(step, editMode) => setStepModal({ step, editMode, order: orders.find(x => x.id === detail.id) || detail })} />}
      {stepModal && <StepModal {...cp} step={stepModal.step} order={stepModal.order} editMode={stepModal.editMode}
        onClose={() => setStepModal(null)} onSaved={() => { setStepModal(null); loadOrders(); }} />}
    </div>
  );
}

function MoCard({ o, onOpen }) {
  const m = STATUS_META[o.status] || STATUS_META.pending;
  const pct = Math.round((o.current_step / 7) * 100);
  const dept = o.mtn_dept || deptForItem(o.item_type);
  return (
    <div className={o.status === 'pending' ? 'mo-card-alert' : ''} onClick={onOpen}
      style={{ background: 'var(--card)', border: `1px solid ${o.status === 'pending' ? '#ef4444' : 'var(--border)'}`, borderRadius: 12, padding: 12, cursor: 'pointer' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)' }}>{o.mo_no || '(ยังไม่ออกเลข MO)'}</div>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: m.color, background: m.bg, borderRadius: 20, padding: '3px 10px', whiteSpace: 'nowrap' }}>{m.label}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>🏢 {dept}</div>
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
function ReportModal({ lines, machines, itemTypes, problemTypes, fullName, defaultDept, onClose, onSaved }) {
  const [f, setF] = useState({
    mtn_dept: defaultDept || 'MTN', repair_scope: 'in_line', line_name: '', item_type: '', machine_no: '', dept_section: '', work_area: '',
    cost_center: '', model: '', customer: '', code: '', want_at: '', problem_characteristic: '', problem_detail: '',
    report_note: '', is_sample: false, reporter_prod: fullName || '', reporter_qa: '',
  });
  const [beforeFile, setBeforeFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const lineMachines = useMemo(() => machines.filter(m => !f.line_name || m.line_name === f.line_name), [machines, f.line_name]);

  const onLine = (name) => {
    const l = lines.find(x => x.name === name);
    let cc = l?.cost_center || '';
    if (!cc && l?.parent_line_name) cc = lines.find(x => x.name === l.parent_line_name)?.cost_center || '';
    setF(p => ({ ...p, line_name: name, dept_section: l?.section || p.dept_section, cost_center: cc || p.cost_center }));
  };
  const onItem = (it) => setF(p => ({ ...p, item_type: it, mtn_dept: deptForItem(it) }));
  const onChar = (c) => { const pt = problemTypes.find(x => x.characteristic === c); setF(p => ({ ...p, problem_characteristic: c, problem_detail: pt?.detail || '' })); };

  const save = async () => {
    if (!f.line_name) return toast.error('เลือกไลน์การผลิต');
    if (!f.item_type) return toast.error('เลือกชนิดอุปกรณ์');
    if (!f.problem_characteristic) return toast.error('เลือกลักษณะปัญหา');
    setSaving(true);
    const payload = { ...f, want_at: f.want_at || null, status: 'pending', current_step: 1, report_at: new Date().toISOString(), work_date: getWorkDate(), reported_by_name: fullName };
    const { data, error } = await supabaseDR.from('mtn_orders').insert(payload).select().single();
    if (error) { setSaving(false); return toast.error(error.message); }
    if (beforeFile) { try { const blob = await resizeImage(beforeFile); const url = await uploadMtnImg(blob, `before/${data.id}-${Date.now()}.jpg`); await supabaseDR.from('mtn_orders').update({ before_img: url }).eq('id', data.id); data.before_img = url; } catch (e) { toast.error('อัปโหลดรูปไม่สำเร็จ: ' + e.message); } }
    notifyMtn(data, 'mtn_reported');
    setSaving(false); toast.success('แจ้งซ่อมแล้ว รอ MTN รับงาน'); onSaved();
  };

  return (
    <ModalShell title="➕ แจ้งซ่อมใหม่ (Step 1)" onClose={onClose} wide>
      <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="แจ้งถึงทีมช่าง" required><select value={f.mtn_dept} onChange={e => set('mtn_dept', e.target.value)} style={{ ...inp, borderColor: 'var(--accent)', fontWeight: 700 }}>{MTN_DEPTS.map(d => <option key={d}>{d}</option>)}</select></Field>
        <Field label="ประเภทการซ่อม"><select value={f.repair_scope} onChange={e => set('repair_scope', e.target.value)} style={inp}>{SCOPE_OPTS.map(o => <option key={o.v} value={o.v}>{o.t}</option>)}</select></Field>
        <Field label="ไลน์การผลิต" required><select value={f.line_name} onChange={e => onLine(e.target.value)} style={inp}><option value="">— เลือก —</option>{lines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}</select></Field>
        <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="ส่วนงาน (ASSY)"><input value={f.work_area} onChange={e => set('work_area', e.target.value)} style={inp} /></Field>
          <Field label="แผนก (PD)"><input value={f.dept_section} onChange={e => set('dept_section', e.target.value)} style={inp} /></Field>
        </div>
        <Field label="ชนิดอุปกรณ์" required><select value={f.item_type} onChange={e => onItem(e.target.value)} style={inp}><option value="">— เลือก —</option>{itemTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}</select></Field>
        <Field label="หมายเลขเครื่อง"><input list="mtn-mc-list" value={f.machine_no} onChange={e => set('machine_no', e.target.value)} style={inp} placeholder="เลือก/พิมพ์" /><datalist id="mtn-mc-list">{lineMachines.map(m => <option key={m.id} value={m.machine_no}>{m.machine_name}</option>)}</datalist></Field>
        <Field label="ลักษณะปัญหา" required><select value={f.problem_characteristic} onChange={e => onChar(e.target.value)} style={inp}><option value="">— เลือก —</option>{problemTypes.map(p => <option key={p.id} value={p.characteristic}>{p.characteristic}</option>)}</select></Field>
        <Field label="รายละเอียดปัญหา (auto)"><input value={f.problem_detail} onChange={e => set('problem_detail', e.target.value)} style={inp} /></Field>
        <Field label="Cost Center (จากฐานข้อมูลไลน์)"><input value={f.cost_center} onChange={e => set('cost_center', e.target.value)} style={{ ...inp, background: 'var(--bg2)' }} placeholder="auto จากไลน์" /></Field>
        <DateField label="วันที่ต้องการให้เสร็จ" value={f.want_at} onChange={v => set('want_at', v)} />
        <Field label="โมเดล / ลูกค้า"><div style={{ display: 'flex', gap: 6 }}><input value={f.model} onChange={e => set('model', e.target.value)} style={inp} placeholder="โมเดล" /><input value={f.customer} onChange={e => set('customer', e.target.value)} style={inp} placeholder="ลูกค้า" /></div></Field>
        <div style={{ gridColumn: '1 / -1' }}><Field label="ระบุรายละเอียดปัญหา (พิมพ์เอง)"><textarea value={f.report_note} onChange={e => set('report_note', e.target.value)} style={{ ...inp, minHeight: 60 }} /></Field></div>
        <Field label="ผู้แจ้ง (ผลิต)"><input value={f.reporter_prod} onChange={e => set('reporter_prod', e.target.value)} style={inp} /></Field>
        <Field label="ผู้แจ้ง (คุณภาพ)"><input value={f.reporter_qa} onChange={e => set('reporter_qa', e.target.value)} style={inp} /></Field>
        <div style={{ gridColumn: '1 / -1' }}><ImgField label="รูปก่อนซ่อม" value={beforeFile ? URL.createObjectURL(beforeFile) : null} onPick={setBeforeFile} /></div>
        <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)' }}><input type="checkbox" checked={f.is_sample} onChange={e => set('is_sample', e.target.checked)} /> งานตัวอย่าง</label>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btnGhost}>ยกเลิก</button>
        <button onClick={save} disabled={saving} style={btnPri}>{saving ? 'บันทึก…' : 'บันทึกใบแจ้งซ่อม'}</button>
      </div>
    </ModalShell>
  );
}

function nextStepFor(order) {
  switch (order.status) {
    case 'pending':   return { step: 2, perm: 'service', label: '🔧 รับงาน / จ่ายงาน (Step 2)' };
    case 'assigned':
    case 'repairing': return { step: 3, perm: 'service', label: '🛠 บันทึกการซ่อม (Step 3)' };
    case 'repaired':  return { step: 4, perm: 'service', label: '🔎 ตรวจสอบหลังซ่อม (Step 4)' };
    case 'checked':   return order.quality_related === 'เกี่ยวกับคุณภาพ' ? { step: 5, perm: 'qa', label: '🧪 ตรวจคุณภาพ (Step 5)' } : { step: 6, perm: 'report', label: '🤝 รับมอบ/ติดตาม (Step 6)' };
    case 'qa':        return { step: 6, perm: 'report', label: '🤝 รับมอบ/ติดตาม (Step 6)' };
    case 'handover':  return { step: 7, perm: 'approve', label: '✅ อนุมัติปิด MO (Step 7)' };
    default:          return null;
  }
}

/* ── พิมพ์ใบ MO — layout 100% ตามฟอร์มเดิม FM-JIG-008 ── */
function printMoReport(o, dparts = []) {
  // เลขฟอร์ม/Rev/Effective จากทะเบียนเอกสาร (/doc-forms) — fallback ค่าเดิม
  const dfMo = docFormSync('mo_report', { form_code: 'FM-JIG-008', rev: 'REV.00', effective_date: '05/12/2025', sig_blocks: ['JIG/MTN APPROVE', 'QA APPROVE', 'PD APPROVE', 'MGR APPROVE'] });
  const moSig = dfMo.sig_blocks || ['JIG/MTN APPROVE', 'QA APPROVE', 'PD APPROVE', 'MGR APPROVE'];
  const beDT = (v) => { if (!v) return ''; const d = new Date(v); const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d); const g = {}; p.forEach(x => g[x.type] = x.value); return `${+g.day}/${+g.month}/${+g.year + 543} ${g.hour === '24' ? '00' : g.hour}:${g.minute}:${g.second}`; };
  const beD = (v) => { if (!v) return ''; const d = new Date(v); const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d); const g = {}; p.forEach(x => g[x.type] = x.value); return `${+g.day}/${+g.month}/${+g.year + 543}`; };
  const esc = (s) => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const L = (k, v) => `<div class="f"><span class="fk">${k}</span> <span class="fv">${esc(v)}</span></div>`;
  const dept = o.mtn_dept || deptForItem(o.item_type);
  const statusTh = (STATUS_META[o.status] || {}).label?.replace(/^[^฀-๿]+/, '').trim() || o.status;
  const logo = /^https?:/.test(tsLogo) ? tsLogo : location.origin + tsLogo;
  const sign = (title, name, url, dt, dark) => `<td class="sg"><div class="sgh${dark ? ' dk' : ''}">${title}</div><div class="sgimg">${url ? `<img src="${esc(url)}"/>` : ''}</div><div class="sgn">${esc(name || '')}</div><div class="sgd">${dt ? beDT(dt) : ''}</div></td>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>MO ${esc(o.mo_no || '')}</title><style>
    *{box-sizing:border-box} body{font-family:'Sarabun','Tahoma',sans-serif;color:#000;margin:0;padding:8px;font-size:11px}
    table{border-collapse:collapse;width:100%;table-layout:fixed} td{border:1px solid #000;vertical-align:top;padding:5px 7px}
    .sech{background:#d4d4d4;text-align:center;font-weight:700;padding:3px;border:1px solid #000}
    .sech b{font-size:11.5px} .sech .en{font-size:11px}
    .f{padding:2px 0;font-size:11px;line-height:1.5} .fk{font-weight:700} .fv{}
    .co{font-size:11px} .ttl{text-align:center;font-size:14px;font-weight:700} .mo{font-size:13px;font-weight:700}
    .hdr td{padding:4px 7px}
    .imgcell{height:230px;text-align:center;padding:4px} .imgcell img{max-width:100%;max-height:220px}
    .signs td{width:25%;height:120px;text-align:center;padding:0}
    .sgh{background:#d4d4d4;font-weight:700;font-size:11px;padding:3px;border-bottom:1px solid #000} .sgh.dk{background:#8a8a8a;color:#fff}
    .sgimg{height:56px;display:flex;align-items:center;justify-content:center} .sgimg img{max-height:52px;max-width:90%}
    .sgn{font-size:11px;border-top:1px solid #999;padding:2px} .sgd{font-size:10px;color:#333}
    .ft{display:flex;justify-content:space-between;font-size:10px;margin-top:4px}
    @media print{body{padding:0}}
  </style></head><body>
  <table>
    <tr class="hdr">
      <td style="width:26%"><table style="border:none"><tr><td style="border:none;width:52px;padding:0"><img src="${esc(logo)}" style="width:46px"/></td><td style="border:none;padding:0 6px" class="co">บริษัท ไทยซัมมิท โอโตโมทีฟ จำกัด สาขา 1</td></tr></table></td>
      <td class="ttl" style="width:44%">ใบแจ้งซ่อมและปรับปรุง <b>${esc(dept)}</b></td>
      <td class="mo" style="width:30%">MO NO: ${esc(o.mo_no || '-')}</td>
    </tr>
    <tr><td style="width:26%"><span class="fk">แจ้งถึงหน่วยงาน:</span> ${esc(dept)}</td>
        <td colspan="2"><span class="fk">สถานะดำเนินการ:</span> ${esc(statusTh)}</td></tr>
  </table>
  <table>
    <tr><td class="sech" style="width:50%"><b>1 [OPEN MO]</b> <span class="en">ส่วนผู้แจ้ง</span></td>
        <td class="sech" style="width:50%"><b>2 [ACCEPT/ASSIGN]</b> <span class="en">ส่วนผู้รับงาน</span></td></tr>
    <tr>
      <td rowspan="3">
        <table style="border:none"><tr><td style="border:none;width:50%;padding:0">${L('ส่วน:', o.work_area)}</td><td style="border:none;padding:0">${L('แผนก:', o.dept_section)}</td></tr></table>
        <table style="border:none"><tr><td style="border:none;width:50%;padding:0">${L('ไลน์การผลิต:', o.line_name)}</td><td style="border:none;padding:0">${L('Cost Ctr:', o.cost_center)}</td></tr></table>
        <table style="border:none"><tr><td style="border:none;width:50%;padding:0">${L('PD:', o.reporter_prod)}</td><td style="border:none;padding:0">${L('QA:', o.reporter_qa)}</td></tr></table>
        ${L('MC Name:', o.item_type)}${L('Jig No:', o.machine_no)}
        <table style="border:none"><tr><td style="border:none;width:50%;padding:0">${L('Customer:', o.customer)}</td><td style="border:none;padding:0">${L('Model:', o.model)}</td></tr></table>
        <table style="border:none"><tr><td style="border:none;width:50%;padding:0">${L('วันที่แจ้ง:', beDT(o.report_at))}</td><td style="border:none;padding:0">${L('ต้องการ:', beD(o.want_at))}</td></tr></table>
        ${L('ลักษณะปัญหา:', o.problem_characteristic)}${L('รายละเอียด:', o.report_note || o.problem_detail)}
      </td>
      <td>${L('วันที่รับงาน:', beDT(o.accept_at))}
        <table style="border:none"><tr><td style="border:none;width:50%;padding:0">${L('ผู้รับงาน:', o.accepted_by)}</td><td style="border:none;padding:0">${L('ผู้รับผิดชอบ:', o.assigned_to)}</td></tr></table>
        ${L('วันที่คาดการณ์เสร็จ:', beDT(o.target_done_at))}${L('ประเภทงานซ่อม:', o.repair_type)}${L('รายละเอียด:', o.assign_note)}${o.reject_reason ? L('เหตุ Reject:', o.reject_reason) : ''}</td>
    </tr>
    <tr><td class="sech"><b>3 [REPAIR]</b> <span class="en">ส่วนผู้ซ่อม</span></td></tr>
    <tr><td>${L('วันที่เสร็จ:', beDT(o.repair_done_at))}
        <table style="border:none"><tr><td style="border:none;width:50%;padding:0">${L('ผู้ซ่อมหลัก:', o.tech_main)}</td><td style="border:none;padding:0">${L('ผู้ซ่อมรอง:', o.tech_secondary)}</td></tr></table>
        ${L('สาเหตุปัญหา:', o.root_cause)}${L('วิธีการแก้ไข:', o.solution)}${dparts.length ? L('อะไหล่:', dparts.map(p => `${p.part_name} ×${p.qty}${p.unit || ''}`).join(', ')) : ''}</td></tr>
  </table>
  <table>
    <tr><td class="sech" style="width:50%"><b>[BEFORE IMPROVEMENT]</b> <span class="en">ภาพปัญหาก่อนปรับปรุง</span></td>
        <td class="sech" style="width:50%"><b>[AFTER IMPROVEMENT]</b> <span class="en">ภาพปัญหาหลังปรับปรุง</span></td></tr>
    <tr><td class="imgcell">${o.before_img ? `<img src="${esc(o.before_img)}"/>` : ''}</td><td class="imgcell">${o.after_img ? `<img src="${esc(o.after_img)}"/>` : ''}</td></tr>
  </table>
  <table>
    <tr><td class="sech" style="width:50%"><b>4&5 [CONFIRM QUALITY]</b> <span class="en">ยืนยันคุณภาพ</span></td>
        <td class="sech" style="width:50%"><b>6 [ACCEPT]</b> <span class="en">รับมอบหลังซ่อม</span></td></tr>
    <tr><td>${L('4.ผลงานหลังแก้ไข:', o.check_result)}${L('4.รายละเอียด:', o.check_note)}${L('5.คุณภาพหลังการแก้ไข:', o.qa_result)}${L('5.รายละเอียด:', o.qa_note)}</td>
        <td>${L('สถานะ:', o.follow_up)}${L('ผู้แจ้ง:', o.ho_reporter || o.reporter_prod)}${L('รายละเอียด:', '')}</td></tr>
  </table>
  <table class="signs">
    <tr>${sign(moSig[0], o.checker_name, o.checker_sign, o.check_at)}${sign(moSig[1], o.qa_checker, o.qa_sign, o.qa_at)}${sign(moSig[2], o.ho_checker, o.ho_sign, o.ho_at)}${sign(moSig[3], o.approver_name, o.approve_sign, o.approve_at, true)}</tr>
  </table>
  <div class="ft"><span>${[dfMo.form_code, dfMo.rev].filter(Boolean).join('-')}${dfMo.footer_note ? ' · ' + dfMo.footer_note : ''}</span><span>${dfMo.effective_date ? 'Effective : ' + dfMo.effective_date : ''}</span></div>
  <script>window.onload=function(){setTimeout(function(){window.print()},500)}</script>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast.error('เบราว์เซอร์บล็อกหน้าต่าง — อนุญาต popup แล้วลองใหม่'); return; }
  w.document.write(html); w.document.close();
}

/* ── Detail drawer ───────────────────────────────────── */
function DetailDrawer({ order, role, improvements, onOpenImprovement, onClose, onStep }) {
  const o = order;
  const m = STATUS_META[o.status] || STATUS_META.pending;
  const next = nextStepFor(o);
  const dept = o.mtn_dept || deptForItem(o.item_type);
  const openImps = (improvements || []).filter(i => i.line_name === o.line_name && (!i.machine_no || i.machine_no === o.machine_no));
  const repeatIssue = ['เกิดปัญหาซ้ำ', 'แก้ไขไม่ได้'].includes(o.follow_up);
  const resp = minutesBetween(o.report_at, o.accept_at), ttr = minutesBetween(o.accept_at, o.repair_done_at), bd = minutesBetween(o.report_at, o.repair_done_at);
  const [dparts, setDparts] = useState([]);
  useEffect(() => { supabaseDR.from('mtn_order_parts').select('*').eq('order_id', o.id).then(({ data }) => setDparts(data || [])); }, [o.id]);
  // แก้ไขได้: หัวหน้า (manage_master) หรือผู้มีสิทธิ์ทำสเตปนั้น
  const canEditStep = (step) => can('mtn_repair', 'manage_master', role) || (STEP_PERM[step] && can('mtn_repair', STEP_PERM[step], role)) || (step === 1 && can('mtn_repair', 'report', role));

  const del = async () => {
    if (!confirm('ลบใบแจ้งซ่อมนี้?')) return;
    [o.before_img, o.after_img, o.qa_img, o.checker_sign, o.qa_sign, o.ho_sign, o.approve_sign].forEach(u => u && removeMtnImg(u));
    const { error } = await supabaseDR.from('mtn_orders').delete().eq('id', o.id);
    if (error) return toast.error(error.message);
    toast.success('ลบแล้ว'); onClose();
  };
  const Row = ({ k, v }) => v ? <div style={{ display: 'flex', gap: 8, fontSize: 12.5, padding: '2px 0' }}><span style={{ color: 'var(--muted)', minWidth: 120 }}>{k}</span><span style={{ color: 'var(--text)', flex: 1 }}>{v}</span></div> : null;
  const Img = ({ label, url }) => url ? <div><div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{label}</div><img src={url} alt="" style={{ maxHeight: 130, borderRadius: 8, border: '1px solid var(--border)' }} /></div> : null;
  const StepBox = ({ n, title, done, children }) => (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, marginBottom: 8, background: done ? 'var(--bg2)' : 'transparent', opacity: done ? 1 : 0.55 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: done ? 'var(--accent)' : 'var(--muted)' }}>{done ? '✅' : '⬜'} Step {n}: {title}</div>
        {done && n >= 2 && canEditStep(n) && <button onClick={() => onStep(n, true)} className="tbtn" style={{ ...btnGhost, padding: '3px 9px', fontSize: 11 }}>✏️ แก้ไข</button>}
      </div>
      {done && children}
    </div>
  );

  return (
    <ModalShell title={`${o.mo_no || '(ยังไม่ออกเลข MO)'} · ${m.label} · ${dept}`} onClose={onClose} wide>
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
      <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <StepBox n={1} title="แจ้งซ่อม" done>
            <Row k="วันเวลาที่แจ้ง" v={fmtDateTime(o.report_at)} /><Row k="หน่วยงาน" v={dept} />
            <Row k="ประเภท" v={SCOPE_OPTS.find(s => s.v === o.repair_scope)?.t} />
            <Row k="ไลน์ / แผนก" v={`${o.line_name || '—'}${o.dept_section ? ' · ' + o.dept_section : ''}`} />
            <Row k="ส่วนงาน" v={o.work_area} /><Row k="Cost Center" v={o.cost_center} />
            <Row k="อุปกรณ์" v={`${o.item_type || '—'} ${o.machine_no || ''}`} />
            <Row k="ลักษณะปัญหา" v={o.problem_characteristic} /><Row k="รายละเอียด" v={o.problem_detail} /><Row k="ระบุเพิ่มเติม" v={o.report_note} />
            <Row k="ต้องการเสร็จ" v={o.want_at && beEcho(String(o.want_at).slice(0, 10))} />
            <Row k="ผู้แจ้ง (ผลิต/QA)" v={[o.reporter_prod, o.reporter_qa].filter(Boolean).join(' / ')} />
            {canEditStep(1) && <div style={{ marginTop: 4 }}><button onClick={() => onStep(1, true)} className="tbtn" style={{ ...btnGhost, padding: '3px 9px', fontSize: 11 }}>✏️ แก้ไขข้อมูลแจ้งซ่อม</button></div>}
            <div style={{ marginTop: 6 }}><Img label="รูปก่อนซ่อม" url={o.before_img} /></div>
          </StepBox>
          <StepBox n={2} title="รับ/จ่ายงาน" done={o.current_step >= 2 || o.status === 'rejected'}>
            <Row k="เลข MO" v={o.mo_no} /><Row k="ผู้รับงาน" v={o.accepted_by} /><Row k="ประเภทงานซ่อม" v={o.repair_type} /><Row k="มอบหมายช่าง" v={o.assigned_to} />
            <Row k="กำหนดเสร็จ" v={o.target_done_at && beEcho(String(o.target_done_at).slice(0, 10))} /><Row k="เหตุ Reject" v={o.reject_reason} />
          </StepBox>
          <StepBox n={3} title="ดำเนินการซ่อม" done={o.current_step >= 3}>
            <Row k="ซ่อมเสร็จเมื่อ" v={o.repair_done_at && fmtDateTime(o.repair_done_at)} /><Row k="สาเหตุ" v={o.root_cause} /><Row k="วิธีแก้ไข" v={o.solution} />
            <Row k="ช่างหลัก / รอง" v={[o.tech_main, o.tech_secondary].filter(Boolean).join(' / ')} />
            {!!dparts.length && <Row k="อะไหล่ที่ใช้" v={dparts.map(p => `${p.part_name} ×${p.qty}${p.unit || ''}`).join(', ')} />}
            <div style={{ marginTop: 6 }}><Img label="รูปหลังซ่อม" url={o.after_img} /></div>
          </StepBox>
        </div>
        <div>
          <StepBox n={4} title="ตรวจสอบหลังซ่อม" done={o.current_step >= 4}>
            <Row k="ผล" v={o.check_result} /><Row k="เกี่ยวคุณภาพ?" v={o.quality_related} /><Row k="รายละเอียด" v={o.check_note} /><Row k="ผู้ตรวจ" v={o.checker_name} /><Img label="ลายเซ็นผู้ตรวจ" url={o.checker_sign} />
          </StepBox>
          <StepBox n={5} title="คุณภาพหลังซ่อม" done={o.current_step >= 5}>
            <Row k="ผลคุณภาพ" v={o.qa_result} /><Row k="รายละเอียด" v={o.qa_note} /><Row k="ผู้ตรวจ QA" v={o.qa_checker} /><Img label="รูปยืนยันคุณภาพ" url={o.qa_img} /><Img label="ลายเซ็น QA" url={o.qa_sign} />
          </StepBox>
          <StepBox n={6} title="รับมอบ/ติดตาม" done={o.current_step >= 6}>
            <Row k="ติดตามผล" v={o.follow_up} /><Row k="ผู้ตรวจ" v={o.ho_checker} /><Img label="ลายเซ็น" url={o.ho_sign} />
          </StepBox>
          <StepBox n={7} title="อนุมัติปิด" done={o.current_step >= 7}>
            <Row k="อนุมัติเมื่อ" v={o.approve_at && fmtDateTime(o.approve_at)} /><Row k="ผู้อนุมัติ" v={o.approver_name} /><Img label="ลายเซ็นอนุมัติ" url={o.approve_sign} />
          </StepBox>
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, fontSize: 12.5 }}>
            <div style={{ fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>⏱ KPI</div>
            <Row k="เข้าดำเนินการ (Response)" v={fmtMin(resp)} /><Row k="เวลาซ่อม (TTR)" v={fmtMin(ttr)} /><Row k="หยุดรวม (Breakdown)" v={fmtMin(bd)} />
          </div>
        </div>
      </div>
      {/* 💬 คอมเมนต์ใต้ใบซ่อม — คุยงานติดใบ + 🔔 mention แจ้งเตือนเข้ากระดิ่ง */}
      <EventComments refKind="mtn_order" refId={o.id} contextLabel={`ใบซ่อม ${o.mo_no || `#${o.id}`}${o.machine_no ? ` (${o.machine_no})` : ''}`} />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        {can('mtn_repair', 'manage_master', role) ? <button onClick={del} style={{ ...btnGhost, color: '#ef4444', borderColor: '#ef4444' }}>🗑 ลบใบนี้</button> : <span />}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {can('improvements', 'manage', role) && <button onClick={() => onOpenImprovement(o)} style={{ ...btnGhost, ...(repeatIssue ? { color: '#a78bfa', borderColor: '#7c6cf0' } : {}) }}>💡 เปิดโปรเจคปรับปรุง</button>}
          <button onClick={() => printMoReport(o, dparts)} style={btnGhost}>🖨️ พิมพ์ / บันทึก PDF</button>
          <button onClick={onClose} style={btnGhost}>ปิด</button>
          {next && can('mtn_repair', next.perm, role) && <button onClick={() => onStep(next.step, false)} style={btnPri}>{next.label}</button>}
        </div>
      </div>
    </ModalShell>
  );
}

/* ── Step 2-7 action modal (รองรับ editMode) ─────────── */
function StepModal({ step, order, editMode, techs, repairTypes, parts, fullName, signatureUrl, onClose, onSaved }) {
  const o = order;
  const [f, setF] = useState(() => ({
    accepted_by: o.accepted_by || fullName || '', repair_type: o.repair_type || 'Breakdown Maintenance', assign_note: o.assign_note || '',
    target_done_at: o.target_done_at ? String(o.target_done_at).slice(0, 10) : '', assigned_to: o.assigned_to || '', reject_reason: o.reject_reason || '',
    root_cause: o.root_cause || '', solution: o.solution || '', tech_main: o.tech_main || '', tech_secondary: o.tech_secondary || '',
    check_result: o.check_result || 'ตรวจสอบผ่าน', check_note: o.check_note || '', quality_related: o.quality_related || 'ไม่เกี่ยวกับคุณภาพ', checker_name: o.checker_name || fullName || '',
    qa_result: o.qa_result || 'ผ่านคุณภาพ', qa_note: o.qa_note || '', qa_checker: o.qa_checker || fullName || '',
    follow_up: o.follow_up || 'ไม่เกิดปัญหาซ้ำ', ho_checker: o.ho_checker || fullName || '',
    approver_name: o.approver_name || fullName || '',
  }));
  const [afterFile, setAfterFile] = useState(null);
  const [qaFile, setQaFile] = useState(null);
  const [sig, setSig] = useState({ mode: signatureUrl ? 'profile' : 'draw', url: signatureUrl, blob: null });
  const [usedParts, setUsedParts] = useState([]);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const isReject = step === 2 && f.repair_type === 'Reject MO';
  const needSign = [4, 5, 6, 7].includes(step);

  const addPart = () => setUsedParts(p => [...p, { part_id: '', name: '', qty: 1, unit: '' }]);
  const setPart = (i, k, v) => setUsedParts(p => p.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const pickPart = (i, id) => { const pt = parts.find(p => p.id === id); setUsedParts(p => p.map((x, j) => j === i ? { ...x, part_id: id, name: pt?.name || '', unit: pt?.unit || '' } : x)); };

  const resolveSign = async (field) => {
    if (sig.mode === 'profile' && sig.url) return sig.url;
    if (sig.mode === 'draw' && sig.blob) return await uploadMtnImg(sig.blob, `sign/${o.id}/${field}-${Date.now()}.png`);
    if (editMode && o[field]) return o[field]; // แก้ไขแต่ไม่เปลี่ยนลายเซ็น → คงเดิม
    return null;
  };

  const save = async () => {
    setSaving(true);
    try {
      const upd = { updated_at: new Date().toISOString() };
      if (step === 2) {
        if (!f.assigned_to && !isReject) { setSaving(false); return toast.error('มอบหมายช่าง'); }
        if (isReject && !f.reject_reason.trim()) { setSaving(false); return toast.error('ระบุเหตุผล Reject'); }
        Object.assign(upd, { accept_at: editMode ? o.accept_at : new Date().toISOString(), accepted_by: f.accepted_by, repair_type: f.repair_type, assign_note: f.assign_note, target_done_at: f.target_done_at || null, assigned_to: f.assigned_to });
        if (!editMode) { if (isReject) { upd.status = 'rejected'; upd.reject_reason = f.reject_reason; } else { upd.status = 'assigned'; upd.current_step = 2; } }
        else if (isReject) upd.reject_reason = f.reject_reason;
        // ออกเลข MO ก่อนเลื่อนสถานะ — ถ้า RPC ล้ม (เน็ตสะดุด) ใบยังเป็น pending ให้กดสเตป 2 ใหม่ได้
        // (เดิมเลื่อน status→assigned ก่อน แล้ว RPC ล้ม → ใบค้าง assigned + mo_no=null ตลอดกาล ทำสเตป 2 ซ้ำไม่ได้)
        if (!editMode && !isReject) { const prefix = repairTypes.find(r => r.name === f.repair_type)?.prefix || 'BM'; const { error: eMo } = await supabaseDR.rpc('mtn_assign_mo_no', { p_order_id: o.id, p_prefix: prefix }); if (eMo) { setSaving(false); return toast.error('ออกเลข MO ไม่สำเร็จ: ' + eMo.message); } }
        const { error: eUpd } = await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id);
        if (eUpd) { setSaving(false); return toast.error(eUpd.message); }
      } else if (step === 3) {
        Object.assign(upd, { root_cause: f.root_cause, solution: f.solution, tech_main: f.tech_main, tech_secondary: f.tech_secondary });
        if (!editMode) { upd.status = 'repaired'; upd.current_step = 3; upd.repair_done_at = new Date().toISOString(); }
        if (afterFile) { const b = await resizeImage(afterFile); upd.after_img = await uploadMtnImg(b, `after/${o.id}-${Date.now()}.jpg`); }
        await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id);
        const usable = usedParts.filter(x => x.name && Number(x.qty) > 0);
        for (const p of usable) {
          await supabaseDR.from('mtn_order_parts').insert({ order_id: o.id, part_id: p.part_id || null, part_name: p.name, qty: Number(p.qty), unit: p.unit, tech: f.tech_main, logged_by: fullName });
        }
        // ตัดสต็อก: รวมยอดต่ออะไหล่ก่อน (กันนับซ้ำเมื่อใส่อะไหล่ตัวเดียวกัน 2 แถวในใบเดียว) แล้วอ่านสต็อก "สด"
        // ณ ตอนตัด (ไม่ใช้ค่า cache ตอนโหลดหน้า ซึ่งอาจเก่า) — ลดโอกาสตัดสต็อกเพี้ยนจาก read-modify-write
        // NOTE: ยังไม่ atomic เต็มตัวข้ามผู้ใช้พร้อมกัน — วิธีที่ถูกต้องสุดคือ RPC ตัดสต็อกฝั่ง DB (update ... returning)
        const byPart = {};
        usable.filter(p => p.part_id).forEach(p => { byPart[p.part_id] = (byPart[p.part_id] || 0) + Number(p.qty); });
        for (const [pid, totalQty] of Object.entries(byPart)) {
          const { data: fresh } = await supabaseDR.from('mtn_spare_parts').select('stock_qty').eq('id', pid).maybeSingle();
          if (!fresh) continue;
          const nb = Number(fresh.stock_qty || 0) - totalQty;
          const { error: eSt } = await supabaseDR.from('mtn_spare_parts').update({ stock_qty: nb }).eq('id', pid);
          if (eSt) { toast.error('ตัดสต็อกอะไหล่ไม่สำเร็จ: ' + eSt.message); continue; }
          await supabaseDR.from('mtn_stock_txns').insert({ part_id: pid, type: 'consume', qty: -totalQty, balance: nb, ref_order_id: o.id, by_name: fullName, note: `เบิกใช้ ${o.mo_no || ''}` });
        }
      } else if (step === 4) {
        const s = await resolveSign('checker_sign'); if (!s) { setSaving(false); return toast.error('ลงลายเซ็นผู้ตรวจ'); }
        Object.assign(upd, { check_result: f.check_result, check_note: f.check_note, quality_related: f.quality_related, checker_name: f.checker_name, checker_sign: s });
        if (!editMode) { upd.status = 'checked'; upd.current_step = 4; upd.check_at = new Date().toISOString(); }
        await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id);
      } else if (step === 5) {
        const s = await resolveSign('qa_sign'); if (!s) { setSaving(false); return toast.error('ลงลายเซ็น QA'); }
        Object.assign(upd, { qa_result: f.qa_result, qa_note: f.qa_note, qa_checker: f.qa_checker, qa_sign: s });
        if (qaFile) { const b = await resizeImage(qaFile); upd.qa_img = await uploadMtnImg(b, `qa/${o.id}-${Date.now()}.jpg`); }
        if (!editMode) { upd.status = 'qa'; upd.current_step = 5; upd.qa_at = new Date().toISOString(); }
        await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id);
      } else if (step === 6) {
        const s = await resolveSign('ho_sign'); if (!s) { setSaving(false); return toast.error('ลงลายเซ็น'); }
        Object.assign(upd, { follow_up: f.follow_up, ho_checker: f.ho_checker, ho_reporter: o.reporter_prod || fullName, ho_sign: s });
        if (!editMode) { upd.status = 'handover'; upd.current_step = 6; upd.ho_at = new Date().toISOString(); }
        await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id);
      } else if (step === 7) {
        const s = await resolveSign('approve_sign'); if (!s) { setSaving(false); return toast.error('ลงลายเซ็นผู้อนุมัติ'); }
        Object.assign(upd, { approver_name: f.approver_name, approve_sign: s });
        if (!editMode) { upd.status = 'closed'; upd.current_step = 7; upd.approve_at = new Date().toISOString(); }
        await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id);
      }
      if (!editMode) { const { data: fresh } = await supabaseDR.from('mtn_orders').select('*').eq('id', o.id).single(); const ev = isReject ? null : STEP_EVENT[step]; if (ev) notifyMtn(fresh, ev); }
      setSaving(false); toast.success(editMode ? 'แก้ไขแล้ว' : 'บันทึกแล้ว'); onSaved();
    } catch (e) { setSaving(false); toast.error(e.message || 'บันทึกไม่สำเร็จ'); }
  };

  const titles = { 2: '🔧 รับ/จ่ายงานซ่อม (Step 2)', 3: '🛠 ดำเนินการซ่อม (Step 3)', 4: '🔎 ตรวจสอบหลังซ่อม (Step 4)', 5: '🧪 คุณภาพหลังซ่อม (Step 5)', 6: '🤝 รับมอบ/ติดตาม (Step 6)', 7: '✅ อนุมัติปิด MO (Step 7)' };
  return (
    <ModalShell title={`${o.mo_no || o.item_type || ''} · ${editMode ? '✏️ แก้ไข ' : ''}${titles[step]}`} onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        {step === 2 && <>
          <Field label="ประเภทงานซ่อม" required><select value={f.repair_type} onChange={e => set('repair_type', e.target.value)} style={inp}>{repairTypes.map(r => <option key={r.id} value={r.name}>{r.name} ({r.prefix})</option>)}</select></Field>
          {isReject ? <Field label="เหตุผล Reject" required><textarea value={f.reject_reason} onChange={e => set('reject_reason', e.target.value)} style={{ ...inp, minHeight: 60 }} /></Field> : <>
            <Field label="ผู้รับปัญหางาน"><input value={f.accepted_by} onChange={e => set('accepted_by', e.target.value)} style={inp} /></Field>
            <Field label="มอบหมายช่างซ่อม" required><select value={f.assigned_to} onChange={e => set('assigned_to', e.target.value)} style={inp}><option value="">— เลือกช่าง —</option>{techs.map(t => <option key={t.id} value={t.name}>{t.name}{t.dept ? ` · ${t.dept}` : ''}</option>)}</select></Field>
            <DateField label="กำหนดเสร็จ" value={f.target_done_at} onChange={v => set('target_done_at', v)} />
            <Field label="ระบุรายละเอียด"><input value={f.assign_note} onChange={e => set('assign_note', e.target.value)} style={inp} /></Field>
            {!editMode && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>💡 เมื่อบันทึก ระบบจะออกเลข MO ให้อัตโนมัติ ({repairTypes.find(r => r.name === f.repair_type)?.prefix}-DDMMYY-ลำดับ)</div>}
          </>}
        </>}
        {step === 3 && <>
          <Field label="สาเหตุปัญหาที่เกิด"><textarea value={f.root_cause} onChange={e => set('root_cause', e.target.value)} style={{ ...inp, minHeight: 50 }} /></Field>
          <Field label="วิธีการแก้ไข"><textarea value={f.solution} onChange={e => set('solution', e.target.value)} style={{ ...inp, minHeight: 50 }} /></Field>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="ช่างซ่อมหลัก"><select value={f.tech_main} onChange={e => set('tech_main', e.target.value)} style={inp}><option value="">—</option>{techs.map(t => <option key={t.id} value={t.name}>{t.name}{t.dept ? ` · ${t.dept}` : ''}</option>)}</select></Field>
            <Field label="ช่างซ่อมรอง"><select value={f.tech_secondary} onChange={e => set('tech_secondary', e.target.value)} style={inp}><option value="">—</option>{techs.map(t => <option key={t.id} value={t.name}>{t.name}{t.dept ? ` · ${t.dept}` : ''}</option>)}</select></Field>
          </div>
          <ImgField label="รูปหลังซ่อม" value={afterFile ? URL.createObjectURL(afterFile) : (editMode ? o.after_img : null)} onPick={setAfterFile} />
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><label style={lbl}>อะไหล่ที่ใช้ (เบิก — หักสต็อกอัตโนมัติ)</label><button type="button" onClick={addPart} style={{ ...btnGhost, padding: '4px 10px', fontSize: 12 }}>+ เพิ่ม</button></div>
            {usedParts.map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={p.part_id} onChange={e => pickPart(i, e.target.value)} style={{ ...inp, flex: '2 1 140px' }}><option value="">อะไหล่…</option>{parts.map(pp => <option key={pp.id} value={pp.id}>{pp.name} (สต็อก {pp.stock_qty})</option>)}</select>
                <input value={p.name} onChange={e => setPart(i, 'name', e.target.value)} placeholder="หรือพิมพ์ชื่อ" style={{ ...inp, flex: '2 1 120px' }} />
                <input type="number" value={p.qty} onChange={e => setPart(i, 'qty', e.target.value)} style={{ ...inp, width: 70 }} />
                <button type="button" onClick={() => setUsedParts(x => x.filter((_, j) => j !== i))} className="tbtn" style={{ ...btnGhost, padding: '6px 8px' }}>✕</button>
              </div>
            ))}
            {editMode && <div style={{ fontSize: 11, color: 'var(--muted)' }}>* แก้ไข: เพิ่มอะไหล่ใหม่ได้ (รายการเดิมที่หักสต็อกไปแล้วไม่ถูกลบ)</div>}
          </div>
        </>}
        {step === 4 && <>
          <Field label="ผลงานหลังซ่อม"><select value={f.check_result} onChange={e => set('check_result', e.target.value)} style={inp}>{CHECK_RESULTS.map(r => <option key={r}>{r}</option>)}</select></Field>
          <Field label="ประเภทงานซ่อม (เกี่ยวคุณภาพ?)"><select value={f.quality_related} onChange={e => set('quality_related', e.target.value)} style={inp}>{QUALITY_OPTS.map(r => <option key={r}>{r}</option>)}</select></Field>
          <Field label="ระบุรายละเอียด"><input value={f.check_note} onChange={e => set('check_note', e.target.value)} style={inp} /></Field>
          <Field label="ชื่อผู้ตรวจสอบ"><input value={f.checker_name} onChange={e => set('checker_name', e.target.value)} style={inp} /></Field>
        </>}
        {step === 5 && <>
          <Field label="คุณภาพหลังการแก้ไข"><select value={f.qa_result} onChange={e => set('qa_result', e.target.value)} style={inp}>{QA_RESULTS.map(r => <option key={r}>{r}</option>)}</select></Field>
          <Field label="ระบุรายละเอียด"><input value={f.qa_note} onChange={e => set('qa_note', e.target.value)} style={inp} /></Field>
          <Field label="ชื่อผู้ตรวจสอบ (QA)"><input value={f.qa_checker} onChange={e => set('qa_checker', e.target.value)} style={inp} /></Field>
          <ImgField label="รูปยืนยันคุณภาพ" value={qaFile ? URL.createObjectURL(qaFile) : (editMode ? o.qa_img : null)} onPick={setQaFile} />
        </>}
        {step === 6 && <>
          <Field label="ติดตามหลังซ่อม"><select value={f.follow_up} onChange={e => set('follow_up', e.target.value)} style={inp}>{FOLLOW_OPTS.map(r => <option key={r}>{r}</option>)}</select></Field>
          <Field label="ชื่อผู้ตรวจสอบ"><input value={f.ho_checker} onChange={e => set('ho_checker', e.target.value)} style={inp} /></Field>
        </>}
        {step === 7 && <>
          <Field label="ชื่อผู้อนุมัติ"><input value={f.approver_name} onChange={e => set('approver_name', e.target.value)} style={inp} /></Field>
          {!editMode && <div style={{ fontSize: 12, color: 'var(--muted)' }}>อนุมัติแล้วสถานะจะเป็น <b style={{ color: '#22c55e' }}>Close MO</b></div>}
        </>}
        {needSign && <Field label="ลายเซ็น" required><SignField signatureUrl={signatureUrl} existing={o[{ 4: 'checker_sign', 5: 'qa_sign', 6: 'ho_sign', 7: 'approve_sign' }[step]]} onChange={setSig} /></Field>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btnGhost}>ยกเลิก</button>
        <button onClick={save} disabled={saving} style={btnPri}>{saving ? 'บันทึก…' : (editMode ? 'บันทึกการแก้ไข' : 'บันทึก')}</button>
      </div>
    </ModalShell>
  );
}

/* ── KPI tab ─────────────────────────────────────────── */
function KpiTab({ orders, scopeLines, lineOpts }) {
  const [line, setLine] = useState('');
  const [days, setDays] = useState(30);
  const rows = useMemo(() => { const since = new Date(); since.setDate(since.getDate() - Number(days)); return orders.filter(o => (!scopeLines || !o.line_name || scopeLines.has(o.line_name)) && (!line || o.line_name === line) && new Date(o.report_at) >= since && o.repair_done_at); }, [orders, scopeLines, line, days]);
  const stat = useMemo(() => {
    const resp = [], ttr = [], bd = [];
    for (const o of rows) { const r = minutesBetween(o.report_at, o.accept_at); if (r != null) resp.push(r); const t = minutesBetween(o.accept_at, o.repair_done_at); if (t != null) ttr.push(t); const b = minutesBetween(o.report_at, o.repair_done_at); if (b != null) bd.push(b); }
    const avg = a => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null;
    const byChar = {}; rows.forEach(o => { const k = o.problem_characteristic || 'อื่นๆ'; byChar[k] = (byChar[k] || 0) + 1; });
    return { n: rows.length, resp: avg(resp), ttr: avg(ttr), bd: avg(bd), pareto: Object.entries(byChar).sort((a, b) => b[1] - a[1]).slice(0, 10) };
  }, [rows]);
  const Card = ({ t, v, c }) => <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, flex: 1, minWidth: 160 }}><div style={{ fontSize: 12, color: 'var(--muted)' }}>{t}</div><div style={{ fontSize: 26, fontWeight: 800, color: c || 'var(--text)', marginTop: 2 }}>{v}</div></div>;
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <select value={line} onChange={e => setLine(e.target.value)} style={{ ...inp, width: 200 }}><option value="">ทุกไลน์</option>{lineOpts.map(n => <option key={n}>{n}</option>)}</select>
        <select value={days} onChange={e => setDays(e.target.value)} style={{ ...inp, width: 140 }}>{[7, 30, 60, 90, 180].map(d => <option key={d} value={d}>{d} วันล่าสุด</option>)}</select>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <Card t="งานที่ปิด (ในช่วง)" v={stat.n} /><Card t="เข้าดำเนินการเฉลี่ย (Response)" v={fmtMin(stat.resp)} c="#3b82f6" /><Card t="เวลาซ่อมเฉลี่ย (TTR)" v={fmtMin(stat.ttr)} c="#f59e0b" /><Card t="Breakdown เฉลี่ย" v={fmtMin(stat.bd)} c="#ef4444" />
      </div>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>พาเรโต้ ลักษณะปัญหา (Top 10)</div>
        {stat.pareto.map(([k, n]) => { const max = stat.pareto[0][1]; return <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}><div style={{ width: 190, fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</div><div style={{ flex: 1, height: 16, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: `${(n / max) * 100}%`, height: '100%', background: '#f59e0b' }} /></div><div style={{ width: 34, textAlign: 'right', fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{n}</div></div>; })}
        {!stat.pareto.length && <div style={{ color: 'var(--muted)', fontSize: 13 }}>ไม่มีข้อมูลในช่วงนี้</div>}
      </div>
    </div>
  );
}

/* ── Master tab (ช่าง / อะไหล่+stock / taxonomy / ชนิดอุปกรณ์) ── */
function MasterTab({ techs, parts, problemTypes, itemTypes, fullName, reloadMasters }) {
  const [sub, setSub] = useState('tech');
  const reload = () => reloadMasters();
  const addRow = async (table, payload) => { const { error } = await supabaseDR.from(table).insert(payload); if (error) return toast.error(error.message); reload(); };
  const updRow = async (table, id, payload) => { const { error } = await supabaseDR.from(table).update(payload).eq('id', id); if (error) return toast.error(error.message); reload(); };
  const delRow = async (table, id) => { if (!confirm('ลบรายการนี้?')) return; const { error } = await supabaseDR.from(table).update({ is_active: false }).eq('id', id); if (error) return toast.error(error.message); reload(); };

  // ── ช่าง (มี dept) ──
  const [ntech, setNtech] = useState({ name: '', dept: 'MTN' });
  const TechList = () => (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <input value={ntech.name} onChange={e => setNtech(p => ({ ...p, name: e.target.value }))} placeholder="ชื่อช่าง" style={{ ...inp, width: 260 }} />
        <select value={ntech.dept} onChange={e => setNtech(p => ({ ...p, dept: e.target.value }))} style={{ ...inp, width: 150 }}>{MTN_DEPTS.map(d => <option key={d}>{d}</option>)}</select>
        <button onClick={() => { if (!ntech.name) return; addRow('mtn_technicians', { name: ntech.name, dept: ntech.dept, sort_order: techs.length + 1 }); setNtech({ name: '', dept: ntech.dept }); }} style={btnPri}>+ เพิ่มช่าง</button>
      </div>
      {MTN_DEPTS.map(dep => { const list = techs.filter(t => (t.dept || 'MTN') === dep); if (!list.length) return null; return (
        <div key={dep} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--accent2)', marginBottom: 4 }}>🏢 {dep} ({list.length})</div>
          <div style={{ display: 'grid', gap: 6 }}>{list.map(it => (
            <div key={it.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
              <input defaultValue={it.name} onBlur={e => e.target.value !== it.name && updRow('mtn_technicians', it.id, { name: e.target.value })} style={{ ...inp, flex: '2 1 180px', width: 'auto' }} />
              <select defaultValue={it.dept || 'MTN'} onChange={e => updRow('mtn_technicians', it.id, { dept: e.target.value })} style={{ ...inp, flex: '1 1 120px', width: 'auto' }}>{MTN_DEPTS.map(d => <option key={d}>{d}</option>)}</select>
              <button onClick={() => delRow('mtn_technicians', it.id)} className="tbtn" style={{ ...btnGhost, color: '#ef4444', padding: '6px 10px', marginLeft: 'auto' }}>🗑</button>
            </div>))}</div>
        </div>); })}
    </div>
  );

  // ── อะไหล่ + stock control ──
  const [npart, setNpart] = useState({ code: '', name: '', unit: 'ชิ้น', stock_qty: 0, min_qty: 0 });
  const stockMove = async (part, type) => {
    const q = Number(prompt(type === 'in' ? `รับเข้าอะไหล่ "${part.name}" จำนวนเท่าไร?` : `ปรับยอด "${part.name}" (+เพิ่ม / -ลด)`, type === 'in' ? '1' : '0'));
    if (!Number.isFinite(q) || q === 0) return;
    // อ่านสต็อกสดก่อนบวก แทนใช้ค่าจาก cache (part.stock_qty อาจเก่า) — ลดโอกาสยอดเพี้ยนจากการปรับพร้อมกัน
    const { data: fresh } = await supabaseDR.from('mtn_spare_parts').select('stock_qty').eq('id', part.id).maybeSingle();
    const nb = Number(fresh?.stock_qty ?? part.stock_qty ?? 0) + q;
    const { error } = await supabaseDR.from('mtn_spare_parts').update({ stock_qty: nb }).eq('id', part.id);
    if (error) return toast.error(error.message);
    await supabaseDR.from('mtn_stock_txns').insert({ part_id: part.id, type, qty: q, balance: nb, by_name: fullName, note: type === 'in' ? 'รับเข้า' : 'ปรับยอด' });
    toast.success(`${type === 'in' ? 'รับเข้า' : 'ปรับ'} ${part.name} → คงเหลือ ${nb}`); reload();
  };
  const PartList = () => (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <input value={npart.code} onChange={e => setNpart(p => ({ ...p, code: e.target.value }))} placeholder="รหัส" style={{ ...inp, width: 110 }} />
        <input value={npart.name} onChange={e => setNpart(p => ({ ...p, name: e.target.value }))} placeholder="ชื่ออะไหล่" style={{ ...inp, width: 220 }} />
        <input value={npart.unit} onChange={e => setNpart(p => ({ ...p, unit: e.target.value }))} placeholder="หน่วย" style={{ ...inp, width: 80 }} />
        <input type="number" value={npart.stock_qty} onChange={e => setNpart(p => ({ ...p, stock_qty: e.target.value }))} placeholder="สต็อกเริ่ม" style={{ ...inp, width: 90 }} />
        <input type="number" value={npart.min_qty} onChange={e => setNpart(p => ({ ...p, min_qty: e.target.value }))} placeholder="ขั้นต่ำ" style={{ ...inp, width: 80 }} />
        <button onClick={() => { if (!npart.name) return; addRow('mtn_spare_parts', { ...npart, stock_qty: Number(npart.stock_qty) || 0, min_qty: Number(npart.min_qty) || 0, sort_order: parts.length + 1 }); setNpart({ code: '', name: '', unit: 'ชิ้น', stock_qty: 0, min_qty: 0 }); }} style={btnPri}>+ เพิ่มอะไหล่</button>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {parts.map(p => { const low = Number(p.stock_qty) <= Number(p.min_qty || 0); return (
          <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--card)', border: `1px solid ${low ? '#ef4444' : 'var(--border)'}`, borderRadius: 8, padding: '8px 10px', flexWrap: 'wrap' }}>
            <input defaultValue={p.code || ''} onBlur={e => e.target.value !== (p.code || '') && updRow('mtn_spare_parts', p.id, { code: e.target.value })} style={{ ...inp, width: 100 }} placeholder="รหัส" />
            <input defaultValue={p.name} onBlur={e => e.target.value !== p.name && updRow('mtn_spare_parts', p.id, { name: e.target.value })} style={{ ...inp, width: 220 }} />
            <span style={{ fontSize: 13, fontWeight: 800, color: low ? '#ef4444' : '#22c55e', minWidth: 90 }}>คงเหลือ {p.stock_qty} {p.unit}</span>
            <input defaultValue={p.min_qty || 0} onBlur={e => Number(e.target.value) !== Number(p.min_qty || 0) && updRow('mtn_spare_parts', p.id, { min_qty: Number(e.target.value) || 0 })} style={{ ...inp, width: 70 }} title="ขั้นต่ำ" />
            <button onClick={() => stockMove(p, 'in')} style={{ ...btnGhost, padding: '6px 10px', fontSize: 12, color: '#22c55e' }}>➕ รับเข้า</button>
            <button onClick={() => stockMove(p, 'adjust')} style={{ ...btnGhost, padding: '6px 10px', fontSize: 12 }}>ปรับ</button>
            <button onClick={() => delRow('mtn_spare_parts', p.id)} className="tbtn" style={{ ...btnGhost, color: '#ef4444', padding: '6px 10px', marginLeft: 'auto' }}>🗑</button>
          </div>); })}
        {!parts.length && <div style={{ color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีอะไหล่ — เพิ่มด้านบน แล้วเบิกได้ตอนขั้นซ่อม (หักสต็อกอัตโนมัติ)</div>}
      </div>
    </div>
  );

  const SimpleList = ({ table, items, fields, addLabel }) => {
    const [nw, setNw] = useState({});
    return (
      <div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {fields.map(fl => <input key={fl.k} value={nw[fl.k] || ''} onChange={e => setNw(p => ({ ...p, [fl.k]: e.target.value }))} placeholder={fl.ph} style={{ ...inp, width: fl.w || 200 }} />)}
          <button onClick={() => { if (!nw[fields[0].k]) return; addRow(table, { ...nw, sort_order: items.length + 1 }); setNw({}); }} style={btnPri}>+ {addLabel}</button>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>{items.map(it => (
          <div key={it.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
            {fields.map(fl => <input key={fl.k} defaultValue={it[fl.k] || ''} onBlur={e => e.target.value !== (it[fl.k] || '') && updRow(table, it.id, { [fl.k]: e.target.value })} style={{ ...inp, flex: `1 1 ${fl.w || 200}px`, width: 'auto', minWidth: 120 }} />)}
            <button onClick={() => delRow(table, it.id)} className="tbtn" style={{ ...btnGhost, color: '#ef4444', padding: '6px 10px', marginLeft: 'auto' }}>🗑</button>
          </div>))}</div>
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {[['tech', '👷 ช่าง (ทุกทีม)'], ['parts', '🔩 อะไหล่ + สต็อก'], ['prob', '🛑 ลักษณะปัญหา'], ['item', '⚙️ ชนิดอุปกรณ์']].map(([k, t]) =>
          <button key={k} onClick={() => setSub(k)} style={{ ...(sub === k ? btnPri : btnGhost), padding: '7px 14px', fontSize: 12.5 }}>{t}</button>)}
      </div>
      {sub === 'tech' && TechList()}
      {sub === 'parts' && PartList()}
      {sub === 'prob' && <SimpleList table="mtn_problem_types" items={problemTypes} addLabel="เพิ่มปัญหา" fields={[{ k: 'characteristic', ph: 'ลักษณะปัญหา', w: 240 }, { k: 'detail', ph: 'รายละเอียด', w: 320 }]} />}
      {sub === 'item' && <SimpleList table="mtn_item_types" items={itemTypes} addLabel="เพิ่มชนิด" fields={[{ k: 'name', ph: 'ชนิดอุปกรณ์', w: 240 }]} />}
    </div>
  );
}

export { STATUS_META };
