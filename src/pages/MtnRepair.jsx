/* MtnRepair — ใบแจ้งซ่อม MO (Maintenance Order) 7 ขั้น
   Clone จากระบบ AppSheet เดิม (Jig MTN) มาอยู่ใน ESM · ข้อมูลอยู่ DR project (supabaseDR = anon)
   Workflow: 1 แจ้งซ่อม → 2 รับ/จ่ายงาน(ออกเลข MO) → 3 ซ่อม → 4 ตรวจ → 5 คุณภาพ(เฉพาะงานคุณภาพ)
             → 6 รับมอบ/ติดตาม → 7 อนุมัติปิด (Close MO)
   สิทธิ์ (role_permissions): mtn_repair:report/service/qa/approve/manage_master · ดู docs/PERMISSIONS-DESIGN.md */
import { useState, useEffect, useContext, useMemo, useRef, useCallback } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { fmtDateTime } from '../utils/dateFormat';

/* ── helpers ─────────────────────────────────────────────── */
function resizeImage(file, maxPx = 1280, quality = 0.85) {
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

// สถานะรวม MO → ป้าย/สี (Andon: แดงเฉพาะค้างจริง, เหลืองรอดำเนินการ, เขียวเสร็จ)
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

const notifyMtn = (payload, event) => {
  fetch('https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-mtn-notification', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, mo: payload }),
  }).catch(() => {});
};

/* ── SignaturePad (canvas → PNG blob) ───────────────────── */
function SignaturePad({ onChange, initialUrl }) {
  const cvRef = useRef(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const [hasInit, setHasInit] = useState(!!initialUrl);

  const clear = useCallback(() => {
    const c = cvRef.current; if (!c) return;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    dirty.current = false; setHasInit(false); onChange?.(null);
  }, [onChange]);

  useEffect(() => { clear(); }, [clear]);

  const pos = (e) => {
    const c = cvRef.current, r = c.getBoundingClientRect();
    const t = e.touches?.[0] || e;
    return { x: (t.clientX - r.left) * (c.width / r.width), y: (t.clientY - r.top) * (c.height / r.height) };
  };
  const down = (e) => { e.preventDefault(); drawing.current = true; last.current = pos(e); };
  const move = (e) => {
    if (!drawing.current) return; e.preventDefault();
    const c = cvRef.current, ctx = c.getContext('2d'), p = pos(e);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p; dirty.current = true; setHasInit(true);
  };
  const up = () => {
    if (!drawing.current) return; drawing.current = false;
    if (dirty.current) cvRef.current.toBlob(b => onChange?.(b), 'image/png');
  };
  return (
    <div>
      <canvas ref={cvRef} width={520} height={150}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        style={{ width: '100%', height: 130, border: '1px solid var(--border)', borderRadius: 8, background: '#fff', touchAction: 'none', cursor: 'crosshair' }} />
      <button type="button" onClick={clear} style={{ marginTop: 4, fontSize: 12, background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer' }}>ล้างลายเซ็น</button>
      {!hasInit && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)' }}>เซ็นในกรอบ (จำเป็น)</span>}
    </div>
  );
}

/* ── รูปช่องอัปโหลด ───────────────────────────────────── */
function ImgField({ label, value, onPick, required }) {
  return (
    <div>
      <label style={lbl}>{label}{required && <span style={{ color: '#ef4444' }}> *</span>}</label>
      {value && <img src={value} alt="" style={{ display: 'block', maxHeight: 120, borderRadius: 8, border: '1px solid var(--border)', marginBottom: 6 }} />}
      <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && onPick(e.target.files[0])} style={{ fontSize: 12 }} />
    </div>
  );
}

const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 4 };
const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' };
const btnPri = { background: 'var(--accent)', color: '#071008', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const btnGhost = { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };

/* ═══════════════════════════════════════════════════════ */
export default function MtnRepair() {
  const { role, lineId, sections: scopeSecs, fullName, user } = useContext(UserContext);
  const [tab, setTab] = useState('list');           // list | kpi | master
  const [orders, setOrders] = useState([]);
  const [lines, setLines] = useState([]);
  const [machines, setMachines] = useState([]);
  const [techs, setTechs] = useState([]);
  const [parts, setParts] = useState([]);
  const [problemTypes, setProblemTypes] = useState([]);
  const [repairTypes, setRepairTypes] = useState([]);
  const [itemTypes, setItemTypes] = useState([]);
  const [loading, setLoading] = useState(true);

  const [fStatus, setFStatus] = useState('open');   // open | all | closed | <status>
  const [fLine, setFLine] = useState('');
  const [fText, setFText] = useState('');

  const [showReport, setShowReport] = useState(false);
  const [detail, setDetail] = useState(null);        // order object for detail drawer
  const [stepModal, setStepModal] = useState(null);  // { step, order }

  const loadMasters = useCallback(async () => {
    const [{ data: ln }, { data: mc }, { data: tc }, { data: pt }, { data: pp }, { data: rt }, { data: it }] = await Promise.all([
      supabase.from('production_lines').select('id, name, section, parent_line_name').order('name'),
      supabaseDR.from('machines').select('id, line_name, machine_no, machine_name').eq('is_active', true).order('sort_order'),
      supabaseDR.from('mtn_technicians').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('mtn_problem_types').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('mtn_spare_parts').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('mtn_repair_types').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('mtn_item_types').select('*').eq('is_active', true).order('sort_order'),
    ]);
    setLines(ln || []); setMachines(mc || []); setTechs(tc || []);
    setProblemTypes(pt || []); setParts(pp || []); setRepairTypes(rt || []); setItemTypes(it || []);
    return ln || [];
  }, []);

  // ── scope: leader → family ไลน์ตัวเอง · role อื่น → section scope (pattern มาตรฐาน) ──
  const scopeLines = useMemo(() => {
    if (role === 'admin') return null;
    if (role === 'leader' && lineId) {
      const self = lines.find(l => l.id === lineId);
      return self ? new Set(getLineFamilyNames(lines, self.name)) : new Set();
    }
    if (scopeSecs?.length) return new Set(lines.filter(l => inSectionScope(scopeSecs, l.section)).map(l => l.name));
    return null; // ไม่จำกัด
  }, [lines, role, lineId, scopeSecs]);

  const loadOrders = useCallback(async () => {
    let q = supabaseDR.from('mtn_orders').select('*').order('report_at', { ascending: false }).limit(1000);
    const { data } = await q;
    setOrders(data || []);
  }, []);

  useEffect(() => {
    (async () => { setLoading(true); await loadMasters(); await loadOrders(); setLoading(false); })();
    const ch = supabaseDR.channel('mtn-orders-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mtn_orders' }, () => loadOrders())
      .subscribe();
    return () => { supabaseDR.removeChannel(ch); };
  }, [loadMasters, loadOrders]);

  // filter + scope
  const shown = useMemo(() => {
    let rows = orders;
    if (scopeLines) rows = rows.filter(o => !o.line_name || scopeLines.has(o.line_name));
    if (fStatus === 'open') rows = rows.filter(o => !['closed', 'rejected'].includes(o.status));
    else if (fStatus === 'closed') rows = rows.filter(o => o.status === 'closed');
    else if (fStatus !== 'all') rows = rows.filter(o => o.status === fStatus);
    if (fLine) rows = rows.filter(o => o.line_name === fLine);
    if (fText.trim()) {
      const t = fText.trim().toLowerCase();
      rows = rows.filter(o => [o.mo_no, o.machine_no, o.item_type, o.problem_characteristic, o.report_note, o.line_name]
        .some(v => (v || '').toLowerCase().includes(t)));
    }
    return rows;
  }, [orders, scopeLines, fStatus, fLine, fText]);

  const openCount = useMemo(() => orders.filter(o => !['closed', 'rejected'].includes(o.status)
    && (!scopeLines || !o.line_name || scopeLines.has(o.line_name))).length, [orders, scopeLines]);

  const lineOpts = useMemo(() => {
    let ls = lines;
    if (scopeLines) ls = ls.filter(l => scopeLines.has(l.name));
    return ls.map(l => l.name);
  }, [lines, scopeLines]);

  if (loading) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>กำลังโหลด…</div>;

  const commonProps = { lines, machines, techs, parts, problemTypes, repairTypes, itemTypes, role, fullName, user, onReload: loadOrders, reloadMasters: loadMasters };

  return (
    <div style={{ padding: 'clamp(12px,2.5vw,24px)', maxWidth: 'min(97vw, 1800px)', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
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
          {can('mtn_repair', 'report', role) &&
            <button onClick={() => setShowReport(true)} style={{ ...btnPri, padding: '9px 16px' }}>➕ แจ้งซ่อมใหม่</button>}
          <select value={fStatus} onChange={e => setFStatus(e.target.value)} style={{ ...inp, width: 170 }}>
            <option value="open">🔵 ยังไม่ปิด (ทั้งหมด)</option>
            <option value="all">ทุกสถานะ</option>
            {Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            <option value="closed">✅ ปิดแล้ว</option>
          </select>
          <select value={fLine} onChange={e => setFLine(e.target.value)} style={{ ...inp, width: 190 }}>
            <option value="">ทุกไลน์</option>
            {lineOpts.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <input value={fText} onChange={e => setFText(e.target.value)} placeholder="ค้นหา เลข MO/เครื่อง/ปัญหา" style={{ ...inp, width: 240 }} />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{shown.length} รายการ</span>
        </div>

        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}>
          {shown.map(o => <MoCard key={o.id} o={o} onOpen={() => setDetail(o)} />)}
          {!shown.length && <div style={{ color: 'var(--muted)', padding: 24 }}>ไม่มีรายการ</div>}
        </div>
      </>}

      {tab === 'kpi' && <KpiTab orders={orders} scopeLines={scopeLines} lineOpts={lineOpts} />}
      {tab === 'master' && can('mtn_repair', 'manage_master', role) &&
        <MasterTab {...commonProps} techs={techs} parts={parts} problemTypes={problemTypes} itemTypes={itemTypes} repairTypes={repairTypes} />}

      {showReport && <ReportModal {...commonProps} onClose={() => setShowReport(false)}
        onSaved={() => { setShowReport(false); loadOrders(); }} />}

      {detail && <DetailDrawer order={orders.find(x => x.id === detail.id) || detail} {...commonProps}
        onClose={() => setDetail(null)} onStep={(step) => setStepModal({ step, order: orders.find(x => x.id === detail.id) || detail })} />}

      {stepModal && <StepModal {...commonProps} step={stepModal.step} order={stepModal.order}
        onClose={() => setStepModal(null)} onSaved={() => { setStepModal(null); loadOrders(); }} />}
    </div>
  );
}

/* ── การ์ด MO ในรายการ ──────────────────────────────── */
function MoCard({ o, onOpen }) {
  const m = STATUS_META[o.status] || STATUS_META.pending;
  const pct = Math.round((o.current_step / 7) * 100);
  const blink = o.status === 'pending'; // รอรับงาน = แดง (ตาม Andon แดงเฉพาะค้างจริง)
  return (
    <div className={blink ? 'dt-alarm-blink' : ''} onClick={onOpen}
      style={{ background: 'var(--card)', border: `1px solid ${o.status === 'pending' ? '#ef4444' : 'var(--border)'}`, borderRadius: 12, padding: 12, cursor: 'pointer' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)' }}>{o.mo_no || '(ยังไม่ออกเลข MO)'}</div>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: m.color, background: m.bg, borderRadius: 20, padding: '3px 10px', whiteSpace: 'nowrap' }}>{m.label}</span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 5 }}>
        🏭 <b>{o.line_name || '—'}</b> · {o.item_type || '—'} {o.machine_no ? `· ${o.machine_no}` : ''}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 3 }}>🛑 {o.problem_characteristic || '—'}</div>
      {o.report_note && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.report_note}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 7, fontSize: 11, color: 'var(--muted)' }}>
        <span>{fmtDateTime(o.report_at)}</span>
        {o.status !== 'rejected' && <span>ขั้น {o.current_step}/7</span>}
      </div>
      {o.status !== 'rejected' && <div style={{ height: 5, background: 'var(--bg3)', borderRadius: 4, marginTop: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: o.status === 'closed' ? '#22c55e' : '#f59e0b' }} /></div>}
    </div>
  );
}

/* ── Modal shell (ฟอร์ม: ปิดจากปุ่มเท่านั้น ไม่ปิดจาก backdrop) ── */
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

/* ── Step 1: แจ้งซ่อมใหม่ ─────────────────────────────── */
function ReportModal({ lines, machines, itemTypes, problemTypes, fullName, user, onClose, onSaved }) {
  const [f, setF] = useState({
    repair_scope: 'in_line', line_name: '', item_type: '', machine_no: '', dept_section: '', work_area: '',
    cost_center: '', model: '', customer: '', code: '', want_at: '', problem_characteristic: '', problem_detail: '',
    report_note: '', is_sample: false, reporter_prod: fullName || '', reporter_qa: '',
  });
  const [beforeFile, setBeforeFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const lineMachines = useMemo(() => machines.filter(m => !f.line_name || m.line_name === f.line_name), [machines, f.line_name]);
  const onLine = (name) => {
    const l = lines.find(x => x.name === name);
    setF(p => ({ ...p, line_name: name, dept_section: l?.section || p.dept_section }));
  };
  const onChar = (c) => {
    const pt = problemTypes.find(x => x.characteristic === c);
    setF(p => ({ ...p, problem_characteristic: c, problem_detail: pt?.detail || '' }));
  };

  const save = async () => {
    if (!f.line_name) return toast.error('เลือกไลน์การผลิต');
    if (!f.item_type) return toast.error('เลือกชนิดอุปกรณ์');
    if (!f.problem_characteristic) return toast.error('เลือกลักษณะปัญหา');
    setSaving(true);
    const payload = {
      ...f, want_at: f.want_at || null, status: 'pending', current_step: 1,
      report_at: new Date().toISOString(), work_date: getWorkDate(),
      reported_by_name: fullName, reported_by_uid: user?.id || null,
    };
    const { data, error } = await supabaseDR.from('mtn_orders').insert(payload).select().single();
    if (error) { setSaving(false); return toast.error(error.message); }
    if (beforeFile) {
      try {
        const blob = await resizeImage(beforeFile);
        const url = await uploadMtnImg(blob, `before/${data.id}-${Date.now()}.jpg`);
        await supabaseDR.from('mtn_orders').update({ before_img: url }).eq('id', data.id);
        data.before_img = url;
      } catch (e) { toast.error('อัปโหลดรูปไม่สำเร็จ: ' + e.message); }
    }
    notifyMtn(data, 'mtn_reported');
    setSaving(false); toast.success('แจ้งซ่อมแล้ว รอ MTN รับงาน'); onSaved();
  };

  return (
    <ModalShell title="➕ แจ้งซ่อมใหม่ (Step 1)" onClose={onClose} wide>
      <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="ประเภทการซ่อม"><select value={f.repair_scope} onChange={e => set('repair_scope', e.target.value)} style={inp}>{SCOPE_OPTS.map(o => <option key={o.v} value={o.v}>{o.t}</option>)}</select></Field>
        <Field label="วันที่ต้องการให้เสร็จ"><input type="datetime-local" value={f.want_at} onChange={e => set('want_at', e.target.value)} style={inp} /></Field>
        <Field label="ไลน์การผลิต" required><select value={f.line_name} onChange={e => onLine(e.target.value)} style={inp}><option value="">— เลือก —</option>{lines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}</select></Field>
        <Field label="ส่วนงาน/แผนก"><input value={f.dept_section} onChange={e => set('dept_section', e.target.value)} style={inp} placeholder="เช่น PD4" /></Field>
        <Field label="ชนิดอุปกรณ์" required><select value={f.item_type} onChange={e => set('item_type', e.target.value)} style={inp}><option value="">— เลือก —</option>{itemTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}</select></Field>
        <Field label="หมายเลขเครื่อง"><input list="mtn-mc-list" value={f.machine_no} onChange={e => set('machine_no', e.target.value)} style={inp} placeholder="เลือก/พิมพ์" />
          <datalist id="mtn-mc-list">{lineMachines.map(m => <option key={m.id} value={m.machine_no}>{m.machine_name}</option>)}</datalist></Field>
        <Field label="ลักษณะปัญหา" required><select value={f.problem_characteristic} onChange={e => onChar(e.target.value)} style={inp}><option value="">— เลือก —</option>{problemTypes.map(p => <option key={p.id} value={p.characteristic}>{p.characteristic}</option>)}</select></Field>
        <Field label="รายละเอียดปัญหา (auto)"><input value={f.problem_detail} onChange={e => set('problem_detail', e.target.value)} style={inp} /></Field>
        <Field label="Cost Center"><input value={f.cost_center} onChange={e => set('cost_center', e.target.value)} style={inp} /></Field>
        <Field label="โมเดล / ลูกค้า"><div style={{ display: 'flex', gap: 6 }}><input value={f.model} onChange={e => set('model', e.target.value)} style={inp} placeholder="โมเดล" /><input value={f.customer} onChange={e => set('customer', e.target.value)} style={inp} placeholder="ลูกค้า" /></div></Field>
        <div style={{ gridColumn: '1 / -1' }}><Field label="ระบุรายละเอียดปัญหา (พิมพ์เอง)"><textarea value={f.report_note} onChange={e => set('report_note', e.target.value)} style={{ ...inp, minHeight: 60 }} /></Field></div>
        <Field label="ผู้แจ้ง (ผลิต)"><input value={f.reporter_prod} onChange={e => set('reporter_prod', e.target.value)} style={inp} /></Field>
        <Field label="ผู้แจ้ง (คุณภาพ)"><input value={f.reporter_qa} onChange={e => set('reporter_qa', e.target.value)} style={inp} /></Field>
        <div style={{ gridColumn: '1 / -1' }}><ImgField label="รูปก่อนซ่อม" value={beforeFile ? URL.createObjectURL(beforeFile) : null} onPick={setBeforeFile} /></div>
        <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)' }}>
          <input type="checkbox" checked={f.is_sample} onChange={e => set('is_sample', e.target.checked)} /> งานตัวอย่าง</label>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btnGhost}>ยกเลิก</button>
        <button onClick={save} disabled={saving} style={btnPri}>{saving ? 'บันทึก…' : 'บันทึกใบแจ้งซ่อม'}</button>
      </div>
    </ModalShell>
  );
}

/* ── next-step config ────────────────────────────────── */
function nextStepFor(order) {
  switch (order.status) {
    case 'pending':  return { step: 2, perm: 'service', label: '🔧 รับงาน / จ่ายงาน (Step 2)' };
    case 'assigned':
    case 'repairing':return { step: 3, perm: 'service', label: '🛠 บันทึกการซ่อม (Step 3)' };
    case 'repaired': return { step: 4, perm: 'service', label: '🔎 ตรวจสอบหลังซ่อม (Step 4)' };
    case 'checked':  return order.quality_related === 'เกี่ยวกับคุณภาพ'
                       ? { step: 5, perm: 'qa', label: '🧪 ตรวจคุณภาพ (Step 5)' }
                       : { step: 6, perm: 'report', label: '🤝 รับมอบ/ติดตาม (Step 6)' };
    case 'qa':       return { step: 6, perm: 'report', label: '🤝 รับมอบ/ติดตาม (Step 6)' };
    case 'handover': return { step: 7, perm: 'approve', label: '✅ อนุมัติปิด MO (Step 7)' };
    default:         return null;
  }
}

/* ── Detail drawer ───────────────────────────────────── */
function DetailDrawer({ order, role, fullName, onClose, onStep, onReload }) {
  const o = order;
  const m = STATUS_META[o.status] || STATUS_META.pending;
  const next = nextStepFor(o);
  const resp = minutesBetween(o.report_at, o.accept_at);
  const ttr = minutesBetween(o.accept_at, o.repair_done_at);
  const bd = minutesBetween(o.report_at, o.repair_done_at);
  const [dparts, setDparts] = useState([]);
  useEffect(() => { supabaseDR.from('mtn_order_parts').select('*').eq('order_id', o.id).then(({ data }) => setDparts(data || [])); }, [o.id]);

  const del = async () => {
    if (!confirm('ลบใบแจ้งซ่อมนี้?')) return;
    [o.before_img, o.after_img, o.qa_img, o.checker_sign, o.qa_sign, o.ho_sign, o.approve_sign].forEach(u => u && removeMtnImg(u));
    const { error } = await supabaseDR.from('mtn_orders').delete().eq('id', o.id);
    if (error) return toast.error(error.message);
    toast.success('ลบแล้ว'); onClose(); onReload();
  };

  const Row = ({ k, v }) => v ? <div style={{ display: 'flex', gap: 8, fontSize: 12.5, padding: '2px 0' }}><span style={{ color: 'var(--muted)', minWidth: 120 }}>{k}</span><span style={{ color: 'var(--text)', flex: 1 }}>{v}</span></div> : null;
  const Img = ({ label, url }) => url ? <div><div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{label}</div><img src={url} alt="" style={{ maxHeight: 130, borderRadius: 8, border: '1px solid var(--border)' }} /></div> : null;
  const StepBox = ({ n, title, done, children }) => (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, marginBottom: 8, background: done ? 'var(--bg2)' : 'transparent', opacity: done ? 1 : 0.55 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: done ? 'var(--accent)' : 'var(--muted)', marginBottom: 4 }}>{done ? '✅' : '⬜'} Step {n}: {title}</div>
      {done && children}
    </div>
  );

  return (
    <ModalShell title={`${o.mo_no || '(ยังไม่ออกเลข MO)'} · ${m.label}`} onClose={onClose} wide>
      <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <StepBox n={1} title="แจ้งซ่อม" done>
            <Row k="วันเวลาที่แจ้ง" v={fmtDateTime(o.report_at)} />
            <Row k="ประเภท" v={SCOPE_OPTS.find(s => s.v === o.repair_scope)?.t} />
            <Row k="ไลน์ / แผนก" v={`${o.line_name || '—'}${o.dept_section ? ' · ' + o.dept_section : ''}`} />
            <Row k="อุปกรณ์" v={`${o.item_type || '—'} ${o.machine_no || ''}`} />
            <Row k="ลักษณะปัญหา" v={o.problem_characteristic} />
            <Row k="รายละเอียด" v={o.problem_detail} />
            <Row k="ระบุเพิ่มเติม" v={o.report_note} />
            <Row k="ผู้แจ้ง (ผลิต/QA)" v={[o.reporter_prod, o.reporter_qa].filter(Boolean).join(' / ')} />
            <div style={{ marginTop: 6 }}><Img label="รูปก่อนซ่อม" url={o.before_img} /></div>
          </StepBox>
          <StepBox n={2} title="รับ/จ่ายงาน" done={o.current_step >= 2 || o.status === 'rejected'}>
            <Row k="เลข MO" v={o.mo_no} /><Row k="ผู้รับงาน" v={o.accepted_by} />
            <Row k="ประเภทงานซ่อม" v={o.repair_type} /><Row k="มอบหมายช่าง" v={o.assigned_to} />
            <Row k="กำหนดเสร็จ" v={o.target_done_at && fmtDateTime(o.target_done_at)} />
            <Row k="เหตุ Reject" v={o.reject_reason} />
          </StepBox>
          <StepBox n={3} title="ดำเนินการซ่อม" done={o.current_step >= 3}>
            <Row k="ซ่อมเสร็จเมื่อ" v={o.repair_done_at && fmtDateTime(o.repair_done_at)} />
            <Row k="สาเหตุ" v={o.root_cause} /><Row k="วิธีแก้ไข" v={o.solution} />
            <Row k="ช่างหลัก / รอง" v={[o.tech_main, o.tech_secondary].filter(Boolean).join(' / ')} />
            {!!dparts.length && <Row k="อะไหล่ที่ใช้" v={dparts.map(p => `${p.part_name} ×${p.qty}${p.unit || ''}`).join(', ')} />}
            <div style={{ marginTop: 6 }}><Img label="รูปหลังซ่อม" url={o.after_img} /></div>
          </StepBox>
        </div>
        <div>
          <StepBox n={4} title="ตรวจสอบหลังซ่อม" done={o.current_step >= 4}>
            <Row k="ผล" v={o.check_result} /><Row k="เกี่ยวคุณภาพ?" v={o.quality_related} />
            <Row k="รายละเอียด" v={o.check_note} /><Row k="ผู้ตรวจ" v={o.checker_name} />
            <Img label="ลายเซ็นผู้ตรวจ" url={o.checker_sign} />
          </StepBox>
          <StepBox n={5} title="คุณภาพหลังซ่อม" done={o.current_step >= 5}>
            <Row k="ผลคุณภาพ" v={o.qa_result} /><Row k="รายละเอียด" v={o.qa_note} /><Row k="ผู้ตรวจ QA" v={o.qa_checker} />
            <Img label="รูปยืนยันคุณภาพ" url={o.qa_img} /><Img label="ลายเซ็น QA" url={o.qa_sign} />
          </StepBox>
          <StepBox n={6} title="รับมอบ/ติดตาม" done={o.current_step >= 6}>
            <Row k="ติดตามผล" v={o.follow_up} /><Row k="ผู้ตรวจ" v={o.ho_checker} /><Img label="ลายเซ็น" url={o.ho_sign} />
          </StepBox>
          <StepBox n={7} title="อนุมัติปิด" done={o.current_step >= 7}>
            <Row k="อนุมัติเมื่อ" v={o.approve_at && fmtDateTime(o.approve_at)} /><Row k="ผู้อนุมัติ" v={o.approver_name} /><Img label="ลายเซ็นอนุมัติ" url={o.approve_sign} />
          </StepBox>
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, fontSize: 12.5 }}>
            <div style={{ fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>⏱ KPI</div>
            <Row k="เข้าดำเนินการ (Response)" v={fmtMin(resp)} />
            <Row k="เวลาซ่อม (TTR)" v={fmtMin(ttr)} />
            <Row k="หยุดรวม (Breakdown)" v={fmtMin(bd)} />
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        {can('mtn_repair', 'manage_master', role)
          ? <button onClick={del} style={{ ...btnGhost, color: '#ef4444', borderColor: '#ef4444' }}>🗑 ลบใบนี้</button> : <span />}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={btnGhost}>ปิด</button>
          {next && can('mtn_repair', next.perm, role) &&
            <button onClick={() => onStep(next.step)} style={btnPri}>{next.label}</button>}
        </div>
      </div>
    </ModalShell>
  );
}

/* ── Step 2-7 action modal ───────────────────────────── */
function StepModal({ step, order, techs, repairTypes, parts, fullName, onClose, onSaved }) {
  const o = order;
  const [f, setF] = useState(() => ({
    accepted_by: fullName || '', repair_type: 'Breakdown Maintenance', assign_note: '', target_done_at: '', assigned_to: '', reject_reason: '',
    root_cause: '', solution: '', tech_main: '', tech_secondary: '',
    check_result: 'ตรวจสอบผ่าน', check_note: '', quality_related: 'ไม่เกี่ยวกับคุณภาพ', checker_name: fullName || '',
    qa_result: 'ผ่านคุณภาพ', qa_note: '', qa_checker: fullName || '',
    follow_up: 'ไม่เกิดปัญหาซ้ำ', ho_checker: fullName || '',
    approver_name: fullName || '',
  }));
  const [afterFile, setAfterFile] = useState(null);
  const [qaFile, setQaFile] = useState(null);
  const [sign, setSign] = useState(null);        // blob for the step signature
  const [usedParts, setUsedParts] = useState([]); // [{part_id,name,qty,unit}]
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const isReject = step === 2 && f.repair_type === 'Reject MO';

  const addPart = () => setUsedParts(p => [...p, { part_id: '', name: '', qty: 1, unit: '' }]);
  const setPart = (i, k, v) => setUsedParts(p => p.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const pickPart = (i, id) => { const pt = parts.find(p => p.id === id); setUsedParts(p => p.map((x, j) => j === i ? { ...x, part_id: id, name: pt?.name || '', unit: pt?.unit || '' } : x)); };

  const save = async () => {
    setSaving(true);
    try {
      let upd = { updated_at: new Date().toISOString() };
      if (step === 2) {
        if (!f.assigned_to && !isReject) { setSaving(false); return toast.error('มอบหมายช่าง'); }
        if (isReject && !f.reject_reason.trim()) { setSaving(false); return toast.error('ระบุเหตุผล Reject'); }
        upd = { ...upd, accept_at: new Date().toISOString(), accepted_by: f.accepted_by, repair_type: f.repair_type,
          assign_note: f.assign_note, target_done_at: f.target_done_at || null, assigned_to: f.assigned_to };
        if (isReject) { upd.status = 'rejected'; upd.reject_reason = f.reject_reason; }
        else { upd.status = 'assigned'; upd.current_step = 2; }
        await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id);
        if (!isReject) {
          const prefix = repairTypes.find(r => r.name === f.repair_type)?.prefix || 'BM';
          await supabaseDR.rpc('mtn_assign_mo_no', { p_order_id: o.id, p_prefix: prefix });
          const { data: fresh } = await supabaseDR.from('mtn_orders').select('*').eq('id', o.id).single();
          notifyMtn(fresh, 'mtn_assigned');
        }
      } else if (step === 3) {
        upd = { ...upd, status: 'repaired', current_step: 3, repair_done_at: new Date().toISOString(),
          root_cause: f.root_cause, solution: f.solution, tech_main: f.tech_main, tech_secondary: f.tech_secondary };
        if (afterFile) { const b = await resizeImage(afterFile); upd.after_img = await uploadMtnImg(b, `after/${o.id}-${Date.now()}.jpg`); }
        await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id);
        for (const p of usedParts.filter(x => x.name && Number(x.qty) > 0)) {
          await supabaseDR.from('mtn_order_parts').insert({ order_id: o.id, part_id: p.part_id || null, part_name: p.name, qty: Number(p.qty), unit: p.unit, tech: f.tech_main, logged_by: fullName });
          if (p.part_id) { const cur = parts.find(x => x.id === p.part_id); if (cur) await supabaseDR.from('mtn_spare_parts').update({ stock_qty: Number(cur.stock_qty) - Number(p.qty) }).eq('id', p.part_id); }
        }
      } else if (step === 4) {
        if (!sign) { setSaving(false); return toast.error('ลงลายเซ็นผู้ตรวจ'); }
        upd = { ...upd, status: 'checked', current_step: 4, check_at: new Date().toISOString(),
          check_result: f.check_result, check_note: f.check_note, quality_related: f.quality_related, checker_name: f.checker_name };
        upd.checker_sign = await uploadMtnImg(sign, `sign/${o.id}/s4-${Date.now()}.png`);
        await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id);
      } else if (step === 5) {
        if (!sign) { setSaving(false); return toast.error('ลงลายเซ็น QA'); }
        upd = { ...upd, status: 'qa', current_step: 5, qa_at: new Date().toISOString(),
          qa_result: f.qa_result, qa_note: f.qa_note, qa_checker: f.qa_checker };
        if (qaFile) { const b = await resizeImage(qaFile); upd.qa_img = await uploadMtnImg(b, `qa/${o.id}-${Date.now()}.jpg`); }
        upd.qa_sign = await uploadMtnImg(sign, `sign/${o.id}/s5-${Date.now()}.png`);
        await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id);
      } else if (step === 6) {
        if (!sign) { setSaving(false); return toast.error('ลงลายเซ็น'); }
        upd = { ...upd, status: 'handover', current_step: 6, ho_at: new Date().toISOString(),
          follow_up: f.follow_up, ho_checker: f.ho_checker, ho_reporter: o.reporter_prod || fullName };
        upd.ho_sign = await uploadMtnImg(sign, `sign/${o.id}/s6-${Date.now()}.png`);
        await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id);
      } else if (step === 7) {
        if (!sign) { setSaving(false); return toast.error('ลงลายเซ็นผู้อนุมัติ'); }
        upd = { ...upd, status: 'closed', current_step: 7, approve_at: new Date().toISOString(), approver_name: f.approver_name };
        upd.approve_sign = await uploadMtnImg(sign, `sign/${o.id}/s7-${Date.now()}.png`);
        await supabaseDR.from('mtn_orders').update(upd).eq('id', o.id);
        const { data: fresh } = await supabaseDR.from('mtn_orders').select('*').eq('id', o.id).single();
        notifyMtn(fresh, 'mtn_closed');
      }
      setSaving(false); toast.success('บันทึกแล้ว'); onSaved();
    } catch (e) { setSaving(false); toast.error(e.message || 'บันทึกไม่สำเร็จ'); }
  };

  const titles = { 2: '🔧 รับ/จ่ายงานซ่อม (Step 2)', 3: '🛠 ดำเนินการซ่อม (Step 3)', 4: '🔎 ตรวจสอบหลังซ่อม (Step 4)', 5: '🧪 คุณภาพหลังซ่อม (Step 5)', 6: '🤝 รับมอบ/ติดตาม (Step 6)', 7: '✅ อนุมัติปิด MO (Step 7)' };

  return (
    <ModalShell title={`${o.mo_no || o.item_type || ''} · ${titles[step]}`} onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        {step === 2 && <>
          <Field label="ประเภทงานซ่อม" required><select value={f.repair_type} onChange={e => set('repair_type', e.target.value)} style={inp}>{repairTypes.map(r => <option key={r.id} value={r.name}>{r.name} ({r.prefix})</option>)}</select></Field>
          {isReject
            ? <Field label="เหตุผล Reject" required><textarea value={f.reject_reason} onChange={e => set('reject_reason', e.target.value)} style={{ ...inp, minHeight: 60 }} /></Field>
            : <>
              <Field label="ผู้รับปัญหางาน"><input value={f.accepted_by} onChange={e => set('accepted_by', e.target.value)} style={inp} /></Field>
              <Field label="มอบหมายช่างซ่อม" required><select value={f.assigned_to} onChange={e => set('assigned_to', e.target.value)} style={inp}><option value="">— เลือกช่าง —</option>{techs.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}</select></Field>
              <Field label="กำหนดเสร็จ"><input type="datetime-local" value={f.target_done_at} onChange={e => set('target_done_at', e.target.value)} style={inp} /></Field>
              <Field label="ระบุรายละเอียด"><input value={f.assign_note} onChange={e => set('assign_note', e.target.value)} style={inp} /></Field>
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>💡 เมื่อบันทึก ระบบจะออกเลข MO ให้อัตโนมัติ ({repairTypes.find(r => r.name === f.repair_type)?.prefix}-DDMMYY-ลำดับ)</div>
            </>}
        </>}
        {step === 3 && <>
          <Field label="สาเหตุปัญหาที่เกิด"><textarea value={f.root_cause} onChange={e => set('root_cause', e.target.value)} style={{ ...inp, minHeight: 50 }} /></Field>
          <Field label="วิธีการแก้ไข"><textarea value={f.solution} onChange={e => set('solution', e.target.value)} style={{ ...inp, minHeight: 50 }} /></Field>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="ช่างซ่อมหลัก"><select value={f.tech_main} onChange={e => set('tech_main', e.target.value)} style={inp}><option value="">—</option>{techs.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}</select></Field>
            <Field label="ช่างซ่อมรอง"><select value={f.tech_secondary} onChange={e => set('tech_secondary', e.target.value)} style={inp}><option value="">—</option>{techs.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}</select></Field>
          </div>
          <ImgField label="รูปหลังซ่อม" value={afterFile ? URL.createObjectURL(afterFile) : null} onPick={setAfterFile} />
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><label style={lbl}>อะไหล่ที่ใช้ (เบิก)</label>
              <button type="button" onClick={addPart} style={{ ...btnGhost, padding: '4px 10px', fontSize: 12 }}>+ เพิ่ม</button></div>
            {usedParts.map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 5, alignItems: 'center' }}>
                <select value={p.part_id} onChange={e => pickPart(i, e.target.value)} style={{ ...inp, flex: 2 }}><option value="">อะไหล่…</option>{parts.map(pp => <option key={pp.id} value={pp.id}>{pp.name} (สต็อก {pp.stock_qty})</option>)}</select>
                <input value={p.name} onChange={e => setPart(i, 'name', e.target.value)} placeholder="หรือพิมพ์ชื่อ" style={{ ...inp, flex: 2 }} />
                <input type="number" value={p.qty} onChange={e => setPart(i, 'qty', e.target.value)} style={{ ...inp, width: 70 }} />
                <button type="button" onClick={() => setUsedParts(x => x.filter((_, j) => j !== i))} className="tbtn" style={{ ...btnGhost, padding: '6px 8px' }}>✕</button>
              </div>
            ))}
          </div>
        </>}
        {step === 4 && <>
          <Field label="ผลงานหลังซ่อม"><select value={f.check_result} onChange={e => set('check_result', e.target.value)} style={inp}>{CHECK_RESULTS.map(r => <option key={r}>{r}</option>)}</select></Field>
          <Field label="ประเภทงานซ่อม (เกี่ยวคุณภาพ?)"><select value={f.quality_related} onChange={e => set('quality_related', e.target.value)} style={inp}>{QUALITY_OPTS.map(r => <option key={r}>{r}</option>)}</select></Field>
          <Field label="ระบุรายละเอียด"><input value={f.check_note} onChange={e => set('check_note', e.target.value)} style={inp} /></Field>
          <Field label="ชื่อผู้ตรวจสอบ"><input value={f.checker_name} onChange={e => set('checker_name', e.target.value)} style={inp} /></Field>
          <Field label="ลายเซ็นผู้ตรวจ" required><SignaturePad onChange={setSign} /></Field>
          {f.quality_related === 'เกี่ยวกับคุณภาพ' && <div style={{ fontSize: 11.5, color: '#f59e0b' }}>⚠️ งานเกี่ยวคุณภาพ → ขั้นถัดไปต้องผ่านการตรวจคุณภาพ (QA)</div>}
        </>}
        {step === 5 && <>
          <Field label="คุณภาพหลังการแก้ไข"><select value={f.qa_result} onChange={e => set('qa_result', e.target.value)} style={inp}>{QA_RESULTS.map(r => <option key={r}>{r}</option>)}</select></Field>
          <Field label="ระบุรายละเอียด"><input value={f.qa_note} onChange={e => set('qa_note', e.target.value)} style={inp} /></Field>
          <Field label="ชื่อผู้ตรวจสอบ (QA)"><input value={f.qa_checker} onChange={e => set('qa_checker', e.target.value)} style={inp} /></Field>
          <ImgField label="รูปยืนยันคุณภาพ" value={qaFile ? URL.createObjectURL(qaFile) : null} onPick={setQaFile} />
          <Field label="ลายเซ็นผู้ตรวจ QA" required><SignaturePad onChange={setSign} /></Field>
        </>}
        {step === 6 && <>
          <Field label="ติดตามหลังซ่อม"><select value={f.follow_up} onChange={e => set('follow_up', e.target.value)} style={inp}>{FOLLOW_OPTS.map(r => <option key={r}>{r}</option>)}</select></Field>
          <Field label="ชื่อผู้ตรวจสอบ"><input value={f.ho_checker} onChange={e => set('ho_checker', e.target.value)} style={inp} /></Field>
          <Field label="ลงชื่อผู้ตรวจสอบ" required><SignaturePad onChange={setSign} /></Field>
        </>}
        {step === 7 && <>
          <Field label="ชื่อผู้อนุมัติ"><input value={f.approver_name} onChange={e => set('approver_name', e.target.value)} style={inp} /></Field>
          <Field label="ลงชื่อผู้อนุมัติ" required><SignaturePad onChange={setSign} /></Field>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>อนุมัติแล้วสถานะจะเป็น <b style={{ color: '#22c55e' }}>Close MO</b></div>
        </>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={btnGhost}>ยกเลิก</button>
        <button onClick={save} disabled={saving} style={btnPri}>{saving ? 'บันทึก…' : 'บันทึก'}</button>
      </div>
    </ModalShell>
  );
}

/* ── KPI tab ─────────────────────────────────────────── */
function KpiTab({ orders, scopeLines, lineOpts }) {
  const [line, setLine] = useState('');
  const [days, setDays] = useState(30);
  const rows = useMemo(() => {
    const since = new Date(); since.setDate(since.getDate() - Number(days));
    return orders.filter(o => (!scopeLines || !o.line_name || scopeLines.has(o.line_name))
      && (!line || o.line_name === line) && new Date(o.report_at) >= since && o.repair_done_at);
  }, [orders, scopeLines, line, days]);
  const stat = useMemo(() => {
    const resp = [], ttr = [], bd = [];
    for (const o of rows) {
      const r = minutesBetween(o.report_at, o.accept_at); if (r != null) resp.push(r);
      const t = minutesBetween(o.accept_at, o.repair_done_at); if (t != null) ttr.push(t);
      const b = minutesBetween(o.report_at, o.repair_done_at); if (b != null) bd.push(b);
    }
    const avg = a => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null;
    const byChar = {}; rows.forEach(o => { const k = o.problem_characteristic || 'อื่นๆ'; byChar[k] = (byChar[k] || 0) + 1; });
    const pareto = Object.entries(byChar).sort((a, b) => b[1] - a[1]).slice(0, 10);
    return { n: rows.length, resp: avg(resp), ttr: avg(ttr), bd: avg(bd), pareto };
  }, [rows]);
  const Card = ({ t, v, c }) => (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: c || 'var(--text)', marginTop: 2 }}>{v}</div>
    </div>
  );
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <select value={line} onChange={e => setLine(e.target.value)} style={{ ...inp, width: 200 }}><option value="">ทุกไลน์</option>{lineOpts.map(n => <option key={n}>{n}</option>)}</select>
        <select value={days} onChange={e => setDays(e.target.value)} style={{ ...inp, width: 140 }}>{[7, 30, 60, 90, 180].map(d => <option key={d} value={d}>{d} วันล่าสุด</option>)}</select>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <Card t="งานที่ปิด (ในช่วง)" v={stat.n} />
        <Card t="เข้าดำเนินการเฉลี่ย (Response)" v={fmtMin(stat.resp)} c="#3b82f6" />
        <Card t="เวลาซ่อมเฉลี่ย (TTR)" v={fmtMin(stat.ttr)} c="#f59e0b" />
        <Card t="Breakdown เฉลี่ย" v={fmtMin(stat.bd)} c="#ef4444" />
      </div>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>พาเรโต้ ลักษณะปัญหา (Top 10)</div>
        {stat.pareto.map(([k, n]) => {
          const max = stat.pareto[0][1];
          return <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <div style={{ width: 190, fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</div>
            <div style={{ flex: 1, height: 16, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: `${(n / max) * 100}%`, height: '100%', background: '#f59e0b' }} /></div>
            <div style={{ width: 34, textAlign: 'right', fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{n}</div>
          </div>;
        })}
        {!stat.pareto.length && <div style={{ color: 'var(--muted)', fontSize: 13 }}>ไม่มีข้อมูลในช่วงนี้</div>}
      </div>
    </div>
  );
}

/* ── Master tab (ช่าง / อะไหล่ / taxonomy / ชนิดอุปกรณ์) ── */
function MasterTab({ techs, parts, problemTypes, itemTypes, reloadMasters }) {
  const [sub, setSub] = useState('tech');
  const reload = () => reloadMasters();

  const addRow = async (table, payload) => { const { error } = await supabaseDR.from(table).insert(payload); if (error) return toast.error(error.message); reload(); };
  const updRow = async (table, id, payload) => { const { error } = await supabaseDR.from(table).update(payload).eq('id', id); if (error) return toast.error(error.message); reload(); };
  const delRow = async (table, id) => { if (!confirm('ลบรายการนี้?')) return; const { error } = await supabaseDR.from(table).update({ is_active: false }).eq('id', id); if (error) return toast.error(error.message); reload(); };

  const SimpleList = ({ table, items, fields, addLabel }) => {
    const [nw, setNw] = useState({});
    return (
      <div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {fields.map(fl => <input key={fl.k} value={nw[fl.k] || ''} onChange={e => setNw(p => ({ ...p, [fl.k]: e.target.value }))} placeholder={fl.ph} style={{ ...inp, width: fl.w || 200 }} />)}
          <button onClick={() => { if (!nw[fields[0].k]) return; addRow(table, { ...nw, sort_order: (items.length + 1) }); setNw({}); }} style={btnPri}>+ {addLabel}</button>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {items.map(it => (
            <div key={it.id} style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
              {fields.map(fl => <input key={fl.k} defaultValue={it[fl.k] || ''} onBlur={e => e.target.value !== (it[fl.k] || '') && updRow(table, it.id, { [fl.k]: e.target.value })} style={{ ...inp, width: fl.w || 200 }} />)}
              <button onClick={() => delRow(table, it.id)} className="tbtn" style={{ ...btnGhost, color: '#ef4444', padding: '6px 10px', marginLeft: 'auto' }}>🗑</button>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {[['tech', '👷 ช่าง'], ['parts', '🔩 อะไหล่'], ['prob', '🛑 ลักษณะปัญหา'], ['item', '⚙️ ชนิดอุปกรณ์']].map(([k, t]) =>
          <button key={k} onClick={() => setSub(k)} style={{ ...(sub === k ? btnPri : btnGhost), padding: '7px 14px', fontSize: 12.5 }}>{t}</button>)}
      </div>
      {sub === 'tech' && <SimpleList table="mtn_technicians" items={techs} addLabel="เพิ่มช่าง" fields={[{ k: 'name', ph: 'ชื่อช่าง', w: 280 }]} />}
      {sub === 'parts' && <SimpleList table="mtn_spare_parts" items={parts} addLabel="เพิ่มอะไหล่" fields={[{ k: 'code', ph: 'รหัส', w: 120 }, { k: 'name', ph: 'ชื่ออะไหล่', w: 240 }, { k: 'unit', ph: 'หน่วย', w: 90 }, { k: 'stock_qty', ph: 'สต็อก', w: 90 }]} />}
      {sub === 'prob' && <SimpleList table="mtn_problem_types" items={problemTypes} addLabel="เพิ่มปัญหา" fields={[{ k: 'characteristic', ph: 'ลักษณะปัญหา', w: 240 }, { k: 'detail', ph: 'รายละเอียด', w: 320 }]} />}
      {sub === 'item' && <SimpleList table="mtn_item_types" items={itemTypes} addLabel="เพิ่มชนิด" fields={[{ k: 'name', ph: 'ชนิดอุปกรณ์', w: 240 }]} />}
    </div>
  );
}

export { STATUS_META };
