import { useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { loadProcessTypes, activeProcessTypes, procDisplay, procColor } from '../utils/processTypes';
loadProcessTypes(); // master กระบวนการ data-driven
import ImageCropModal from '../components/ImageCropModal';
import { can } from '../utils/permissions';
import useIsMobile from '../utils/useIsMobile';
import RoutingPanel from '../components/RoutingPanel';
import { MAT_CLASSES, matClassOf, matColor, matLabel, matMatches } from '../utils/matPrefix';
import { loadOpInfo } from '../utils/opItems';

// วันที่ local (ห้าม toISOString — UTC เพี้ยนก่อน 07:00 ไทย)
const localDateStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

// แปล error DB ตอนเซฟสินค้าเป็นภาษาคน — เคสจริง: สร้างรายการ OP แล้วใส่เลขพาร์ทจริงในช่อง MAT.NO
// (2026-08-17 user เจอ "duplicate key ... dr_products_mat_no_key" แล้วอ่านไม่ออกว่าต้องแก้ยังไง)
const friendlySaveError = (error, matNo, isOperation) => {
  if (error?.code === '23505' && String(error.message || '').includes('mat_no')) {
    return isOperation
      ? `MAT.NO "${matNo}" มีสินค้าอยู่แล้ว — รายการขั้นตอน (OP) ต้องตั้งเลข/ชื่อของขั้นเองไม่ซ้ำใคร (เช่น "332 ขับนัท M6") ส่วนเลขพาร์ทจริงใส่เฉพาะช่อง "เป็นขั้นของพาร์ทจริง (MAT)"`
      : `MAT.NO "${matNo}" มีสินค้าอยู่แล้วในระบบ — ค้นหาแล้วแก้ไขตัวเดิมแทน (สินค้าที่ปิดใช้งานอยู่ก็นับ)`;
  }
  return error?.message || 'เกิดข้อผิดพลาด';
};

/* ─── PRODUCT MASTER ─────────────────────────────────────────────────────────
   ฐานข้อมูลกลางของ Product/Model ที่ใช้ร่วมกันในทุกโมดูล
   - Daily Report  → เลือก product ตอนเปิดกะ
   - BOM           → แตก subcomponent ต่อ product
   - Heijunka      → คำนวณ demand พาร์ทย่อยตามแผนผลิต
   - OEE Analytics → ดึง cycle_time_sec, target_per_shift
   - Dashboard     → KPI target vs actual
   ─────────────────────────────────────────────────────────────────────────── */

function Field({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

const inputSt = {
  width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
  fontFamily: 'var(--font-body)',
};
const btnPrimary = {
  background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8,
  padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-body)',
};
const btnSecondary = {
  background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-body)',
};

const BLANK = () => ({ name: '', code: '', mat_no: '', p_no: '', customer: '', line_name: '', cycle_time_sec: '', target_per_shift: '', process_type: 'welding_assembly', posting_mode: 'immediate', lot_accumulate_threshold: '', is_active: true, effective_from: '', image_url: '', pair_mat_no: '', is_operation: false, op_parent_mat: '', op_seq: '' });

/* ── ช่องเลือก MAT แบบพิมพ์ค้นหา (แทน <select> ยาวเป็นร้อยตัวที่ user ทัก "ตาลาย" 2026-08-17) ──
   พิมพ์เลข/ชื่อบางส่วน → กรองลิสต์ให้ · คลิกเลือก · ล้างช่อง = ไม่เลือก
   pattern เดียวกับช่องเครื่องจักรใน PmCoordination (input+ลิสต์กรอง) — ไม่ใช้ datalist เพราะ
   บาง browser ไม่กรองจาก label (ชื่อสินค้า) และบังคับพิมพ์ค่าเป๊ะ */
function MatSearchField({ value, onChange, options, placeholder, hint }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  // เรียงตาม rank ก่อน (option ไม่มี rank = 0 เท่ากันหมด → ได้พฤติกรรมเรียงเลขเดิม) แล้วค่อยตามเลข
  const sorted = useMemo(
    () => [...options].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)
      || String(a.mat_no).localeCompare(String(b.mat_no), undefined, { numeric: true })),
    [options]);
  // จัดอันดับผลค้น: เลขขึ้นต้นตรง → เลขมีคำนั้น → ชื่อมีคำนั้น (2026-08-17 — user พิมพ์ "30"
  // แล้วเจอแต่ตัวที่ชื่อมี "306" ขึ้นก่อน ส่วนเบอร์ 30xxxxx จมท้ายลิสต์จนคิดว่า "หาพาร์ทไม่เจอ")
  const nq = q.trim().toLowerCase();
  let filtered = sorted;
  if (nq) {
    const starts = [], inMat = [], inName = [];
    for (const o of sorted) {
      const m = String(o.mat_no).toLowerCase();
      if (m.startsWith(nq)) starts.push(o);
      else if (m.includes(nq)) inMat.push(o);
      else if (String(o.name || '').toLowerCase().includes(nq)) inName.push(o);
    }
    filtered = [...starts, ...inMat, ...inName];
  }
  const sel = value ? options.find(o => o.mat_no === value) : null;
  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {sel ? (
        <div style={{ ...inputSt, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <b style={{ fontFamily: 'monospace' }}>{sel.mat_no}</b> — {sel.name}
          </span>
          <button type="button" onClick={() => { onChange(''); setQ(''); setOpen(true); }}
            style={{ border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, padding: 0, flexShrink: 0 }}
            title="ล้าง — เลือกใหม่">✕</button>
        </div>
      ) : (
        <input value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          placeholder={placeholder || 'พิมพ์เลข MAT หรือชื่อ เพื่อค้นหา…'} style={inputSt} />
      )}
      {open && !sel && (
        <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, marginTop: 4, maxHeight: 260, overflowY: 'auto', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
          {filtered.length === 0 && <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--muted)' }}>ไม่พบ "{q}" ในลิสต์</div>}
          {filtered.slice(0, 60).map(o => (
            <div key={o.mat_no} onClick={() => { onChange(o.mat_no); setOpen(false); setQ(''); }}
              style={{ padding: '7px 12px', fontSize: 12.5, cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg2)'}
              onMouseLeave={e => e.currentTarget.style.background = ''}>
              <b style={{ fontFamily: 'monospace', flexShrink: 0 }}>{o.mat_no}</b>
              <span style={{ color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{o.name}</span>
              {o.tag && <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>{o.tag}</span>}
            </div>
          ))}
          {filtered.length > 60 && <div style={{ padding: '7px 12px', fontSize: 11, color: 'var(--muted)' }}>…อีก {filtered.length - 60} รายการ — พิมพ์เพิ่มเพื่อกรอง</div>}
        </div>
      )}
      {hint && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

/* ── Quick-link chips to connected modules ── */
function RelatedLinks({ matNo, productId }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
      <Link to="/heijunka" title="ดู Heijunka Kanban demand" style={{ fontSize: 11, padding: '2px 9px', borderRadius: 10, background: 'rgba(245,158,11,0.1)', color: '#f59e0b', textDecoration: 'none', fontWeight: 700 }}>🎴 Kanban</Link>
      <Link to="/daily-report" title="บันทึกการผลิต" style={{ fontSize: 11, padding: '2px 9px', borderRadius: 10, background: 'rgba(14,165,233,0.1)', color: '#38bdf8', textDecoration: 'none', fontWeight: 700 }}>📊 Daily Report</Link>
    </div>
  );
}

/* ── Picker เลือกจากทะเบียนกลาง Parts Master ──
   โมเดล material master: parts_master = ทะเบียนตัวตนทุก mat (1/2/3/5)
   มุมมองอื่น (Product = มุมผลิต · Kanban = มุมการดึง) เลือกจากทะเบียนนี้ ไม่พิมพ์เลขใหม่เอง */
function PartsPickModal({ parts, onPick, onClose }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = !s ? parts : parts.filter(p =>
      (p.mat_no || '').toLowerCase().includes(s) ||
      (p.part_name || '').toLowerCase().includes(s) ||
      (p.part_no || '').toLowerCase().includes(s) ||
      (p.supplier || '').toLowerCase().includes(s));
    return base.slice(0, 120);
  }, [parts, q]);
  return (
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 20, width: 'min(95vw,540px)', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>🗂 เลือกจากทะเบียนกลาง Parts Master</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>ตัวตนสินค้า (MAT/ชื่อ) มาจากทะเบียนกลางที่เดียว — ไม่มีในลิสต์ = ไปเพิ่มที่ tab 🗂 Parts Master ก่อน</div>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 ค้นหา MAT / ชื่อ / P.NO / supplier..." style={{ ...inputSt, marginBottom: 10 }} />
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 120, border: '1px solid var(--border)', borderRadius: 8 }}>
          {filtered.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>ไม่พบพาร์ทที่ตรงเงื่อนไข — เพิ่มได้ที่ tab 🗂 Parts Master</div>
          )}
          {filtered.map(p => (
            <div key={p.id} onClick={() => onPick(p)}
              style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center' }}>
              {p.image_url
                ? <img src={p.image_url} alt="" loading="lazy" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', flexShrink: 0 }} />
                : <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg2)', border: '1px solid var(--border)', flexShrink: 0 }} />}
              <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: '#0ea5e9', flexShrink: 0 }}>{p.mat_no}</span>
              <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.part_name}</span>
              {p.qty_per_pkg > 0 && <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>📦 {p.qty_per_pkg}/pkg</span>}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onClose} style={btnSecondary}>ปิด</button>
        </div>
      </div>
    </div>
  );
}

export default function ProductMaster() {
  const { role, fullName, isDeptAdmin } = useContext(UserContext);
  // อ้าง isDeptAdmin เพื่อผูก re-render — can() อ่าน flag จาก module var (_deptAdmin) ที่โหลด async
  // ถ้าไม่ consume ค่านี้จาก context ปุ่มแก้ไขจะไม่โผล่จนกว่าจะ re-render ด้วยเหตุอื่น (แอดมินหน่วยงานติ๊กแล้วแต่แก้ไม่ได้)
  void isDeptAdmin;
  const canCreate = can('products', 'create', role);
  const canEdit   = can('products', 'edit', role);
  const canDelete = can('products', 'delete', role);
  const [mainTab, setMainTab] = useState('products');

  /* ── state ── */
  const [items,   setItems]   = useState([]);
  const [lines,   setLines]   = useState([]);
  const [kanbanStds, setKanbanStds] = useState([]);
  const [familyTotals, setFamilyTotals] = useState({});
  const [bomCounts, setBomCounts] = useState({});          // product_id → bom count
  const [bomRows, setBomRows] = useState([]);              // {product_id, mat_no} — ใช้จัดอันดับตัวเลือก parent ของ OP ตาม BOM ของไลน์

  const [editing,  setEditing]  = useState(null);          // id | 'new' | null
  const [ecSource, setEcSource] = useState(null);
  const [form,     setForm]     = useState(BLANK());
  const [saving,   setSaving]   = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [cropFile, setCropFile] = useState(null);
  const [imageUploading, setImageUploading] = useState(false);

  const [kanbanEditing, setKanbanEditing] = useState(null);
  const [kanbanForm,    setKanbanForm]    = useState({ product_id: '', mat_no: '', qty_per_kanban: 1, is_active: true });
  const [kanbanSaving,  setKanbanSaving]  = useState(false);

  // ทะเบียนกลาง Parts Master — โมเดล material master: ตัวตนสินค้า (mat_no/ชื่อ/UOM) อยู่ parts_master ที่เดียว
  // ฟอร์มมุมมองอื่น (Product/Kanban) "เลือก" จากทะเบียน ไม่พิมพ์เลขใหม่เอง
  const [pmParts, setPmParts] = useState([]);
  const [partsPickFor, setPartsPickFor] = useState(null); // 'product' | 'kanban' | null

  const [search,      setSearch]      = useState('');
  const [lineFilter,  setLineFilter]  = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [expandedFamilies, setExpandedFamilies] = useState({});
  const [expandedNameGroups, setExpandedNameGroups] = useState({});
  const [csvImporting, setCsvImporting] = useState(false);
  const csvInputRef = useRef(null);
  const [csvPreview, setCsvPreview] = useState(null);
  const [partsReloadKey, setPartsReloadKey] = useState(0);
  // { type: 'products'|'parts', newRows: [], dupRows: [{row, existing, include}], invalidRows: [], overwriteAll: false }

  /* ── load ── */
  const load = useCallback(async () => {
    const [{ data: pr }, { data: ln }, { data: stds }, { data: boms }, { data: sessions }, { data: pm }] = await Promise.all([
      supabaseDR.from('dr_products').select('*').order('name').order('effective_from', { ascending: false }),
      supabase.from('production_lines').select('id, name').order('name'),
      supabaseDR.from('kanban_standards').select('*').order('mat_no'),
      supabaseDR.from('bom_items').select('product_id, mat_no').eq('is_active', true),
      supabaseDR.from('production_sessions').select('product_id, qty_ok, dr_products(family_id)'),
      // ทะเบียนกลาง Parts Master (material master) — ใช้เป็น picker + เช็คเลขหลุดทะเบียนในฟอร์มสินค้า/kanban
      supabaseDR.from('parts_master').select('id, mat_no, part_name, part_no, uom, qty_per_pkg, supplier, image_url').eq('is_active', true).order('mat_no'),
    ]);
    setItems(pr || []);
    setLines(ln || []);
    setKanbanStds(stds || []);
    setPmParts(pm || []);

    const bc = {};
    (boms || []).forEach(b => { bc[b.product_id] = (bc[b.product_id] || 0) + 1; });
    setBomRows(boms || []);
    setBomCounts(bc);

    const totals = {};
    (sessions || []).forEach(s => {
      const fid = s.dr_products?.family_id;
      if (!fid) return;
      totals[fid] = (totals[fid] || 0) + (s.qty_ok || 0);
    });
    setFamilyTotals(totals);
  }, []);

  useEffect(() => { load(); }, [load, partsReloadKey]); // เพิ่มพาร์ทใน tab Parts Master แล้ว picker เห็นทันที

  /* ── ทะเบียนกลาง: เช็ค mat อยู่ใน parts_master มั้ย + เลือกจากทะเบียนมาเติมฟอร์ม ── */
  const pmMatSet = useMemo(() => new Set(pmParts.map(p => (p.mat_no || '').trim().toUpperCase())), [pmParts]);
  const matInRegistry = (m) => !m || pmMatSet.has(String(m).trim().toUpperCase());
  const handlePartPick = (p) => {
    const mat = (p.mat_no || '').trim().toUpperCase();
    if (partsPickFor === 'product') {
      // parts_master เป็นเจ้าของ "ชื่อ + รูป" — เลือกแล้วเติมชื่อจากทะเบียนทับเสมอ (กันชื่อ drift)
      // รูปเติมเฉพาะเมื่อฟอร์มยังไม่มี (ไม่ทับรูปที่ผู้ใช้เพิ่งเลือก)
      setForm(f => ({ ...f, mat_no: mat, name: p.part_name || f.name, image_url: f.image_url || p.image_url || '' }));
      toast.info('เติม MAT + ชื่อจากทะเบียนกลางแล้ว — กรอกรายละเอียดฝั่งผลิต (ไลน์/CT/ลูกค้า) ต่อได้เลย');
    } else if (partsPickFor === 'kanban') {
      setKanbanForm(f => ({
        ...f, mat_no: mat,
        // ค่าตั้งต้น 1 ใบ Kanban = 1 packaging (qty_per_pkg) — ถ้าผู้ใช้กรอกค่าอื่นไว้แล้วไม่ทับ
        qty_per_kanban: (!f.qty_per_kanban || Number(f.qty_per_kanban) === 1) && p.qty_per_pkg > 0 ? p.qty_per_pkg : f.qty_per_kanban,
      }));
    }
    setPartsPickFor(null);
  };

  /* ── product CRUD ── */
  const openEdit = (item = null) => {
    setEcSource(null);
    setEditing(item?.id || 'new');
    setImageFile(null);
    // ชิ้นงานเดียวกัน (ชื่อตรงกัน) ต่างแค่ customer/mat — ใช้รูปร่วมกัน ไม่ต้องอัปโหลดซ้ำ
    const sharedImage = item && !item.image_url
      ? items.find(i => i.id !== item.id && i.image_url && i.name?.trim().toUpperCase() === item.name?.trim().toUpperCase())?.image_url
      : null;
    setForm(item ? {
      name: item.name, code: item.code || '', mat_no: item.mat_no || '', p_no: item.p_no || '',
      customer: item.customer || '', line_name: item.line_name || '',
      cycle_time_sec: item.cycle_time_sec || '', target_per_shift: item.target_per_shift || '',
      process_type: item.process_type || 'welding_assembly',
      posting_mode: item.posting_mode || 'immediate', lot_accumulate_threshold: item.lot_accumulate_threshold || '',
      is_active: item.is_active, effective_from: item.effective_from || '',
      image_url: item.image_url || sharedImage || '', pair_mat_no: item.pair_mat_no || '',
      is_operation: !!item.is_operation, op_parent_mat: item.op_parent_mat || '', op_seq: item.op_seq ?? '',
    } : BLANK());
  };

  const openEC = (item) => {
    setEcSource(item);
    setEditing('new');
    setImageFile(null);
    setForm({
      name: item.name, code: item.code || '', mat_no: '', p_no: '',
      customer: item.customer || '', line_name: item.line_name || '',
      cycle_time_sec: item.cycle_time_sec || '', target_per_shift: item.target_per_shift || '',
      process_type: item.process_type || 'welding_assembly',
      posting_mode: item.posting_mode || 'immediate', lot_accumulate_threshold: item.lot_accumulate_threshold || '',
      is_active: true,
      effective_from: localDateStr(),
      image_url: item.image_url || '',
      is_operation: !!item.is_operation, op_parent_mat: item.op_parent_mat || '', op_seq: item.op_seq ?? '',
    });
  };

  const handleSave = async () => {
    if (!form.name) { toast.error('กรอกชื่อสินค้า'); return; }
    if (form.posting_mode === 'lot_accumulate' && !(Number(form.lot_accumulate_threshold) > 0)) {
      toast.error('กรอกจำนวนสะสมขั้นต่ำ (เช่น 800, 1000) สำหรับโหมดสะสม lot'); return;
    }
    setSaving(true);
    try {
      let imageUrl = form.image_url || null;
      if (imageFile) {
        setImageUploading(true);
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabaseDR.storage.from('product-images').upload(fileName, imageFile);
        setImageUploading(false);
        if (uploadError) { toast.error(`อัปโหลดรูปไม่สำเร็จ: ${uploadError.message}`); return; }
        const { data: pub } = supabaseDR.storage.from('product-images').getPublicUrl(fileName);
        imageUrl = pub.publicUrl;
      }
      const payload = {
        name: form.name.trim(), code: (form.code || '').trim() || null,
        mat_no: (form.mat_no || '').trim().toUpperCase() || null, p_no: (form.p_no || '').trim() || null,
        customer: (form.customer || '').trim() || null, line_name: form.line_name || null,
        cycle_time_sec: form.cycle_time_sec ? parseFloat(form.cycle_time_sec) : null,
        target_per_shift: form.target_per_shift ? parseInt(form.target_per_shift) : null,
        process_type: form.process_type || 'welding_assembly',
        posting_mode: form.posting_mode || 'immediate',
        lot_accumulate_threshold: form.posting_mode === 'lot_accumulate' && form.lot_accumulate_threshold
          ? parseInt(form.lot_accumulate_threshold) : null,
        is_active: form.is_active,
        effective_from: form.effective_from || null,
        image_url: imageUrl,
        pair_mat_no: form.pair_mat_no || null,
      };
      let savedId = editing;
      if (editing === 'new') {
        if (ecSource) payload.family_id = ecSource.family_id;
        const { data: inserted, error } = await supabaseDR.from('dr_products').insert(payload).select().single();
        if (error) { toast.error(friendlySaveError(error, payload.mat_no, form.is_operation)); return; }
        savedId = inserted.id;
        if (ecSource) {
          await supabaseDR.from('dr_products').update({
            is_active: false,
            superseded_at: form.effective_from || localDateStr(),
            superseded_by: inserted.id,
          }).eq('id', ecSource.id);
          // EC = พาร์ทเดิม revision ใหม่ → ลงทะเบียน MAT ใหม่เข้าทะเบียนกลาง parts_master ให้อัตโนมัติ
          // สืบทอดเฉพาะ "คุณสมบัติทางกายภาพ" จากเลขเดิม (uom/จำนวนต่อกล่อง/supplier/รูป) —
          // ต้นทุน (material/standard) ไม่สืบทอด: rev ใหม่ต้นทุนเปลี่ยนได้ ให้บัญชีเติมเอง ห้ามเดา
          if (payload.mat_no) {
            try {
              const effDate = form.effective_from || localDateStr();
              const { data: exist } = await supabaseDR.from('parts_master').select('id').eq('mat_no', payload.mat_no).limit(1);
              if (!exist?.length) {
                let oldPm = null;
                if (ecSource.mat_no) {
                  const { data } = await supabaseDR.from('parts_master').select('*').eq('mat_no', ecSource.mat_no).limit(1);
                  oldPm = data?.[0] || null;
                }
                const { error: pmErr } = await supabaseDR.from('parts_master').insert({
                  mat_no: payload.mat_no, part_name: payload.name, part_no: payload.p_no,
                  uom: oldPm?.uom || null, qty_per_pkg: oldPm?.qty_per_pkg ?? null, supplier: oldPm?.supplier || null,
                  image_url: imageUrl || oldPm?.image_url || null, is_active: true,
                  note: `EC ต่อจาก ${ecSource.mat_no || ecSource.name} · มีผล ${effDate}` + (oldPm ? ' · สืบทอด uom/จำนวนต่อกล่อง/supplier จากเลขเดิม — ต้นทุนให้บัญชีเติม' : ''),
                });
                if (pmErr) toast.error('ลงทะเบียน Parts Master ไม่สำเร็จ: ' + pmErr.message + ' — ไปเพิ่มเองที่ tab 🗂');
                else if (oldPm) toast.info('🗂 ลงทะเบียน MAT ใหม่ใน Parts Master แล้ว (สืบทอดข้อมูลจากเลขเดิม · ต้นทุนให้บัญชีเติม)');
                else toast.info('🗂 ลงทะเบียน MAT ใหม่ใน Parts Master แล้ว — เลขเดิมไม่มีในทะเบียน ไปเติม จำนวนต่อกล่อง/supplier/ต้นทุน ที่ tab 🗂');
                // ฝากรอยไว้ที่แถวทะเบียนของเลขเดิม ให้คนเปิดทะเบียนเห็นว่าถูกแทนแล้ว (best-effort · ไม่ปิด is_active —
                // ของ rev เก่ายังไหลอยู่ในคลัง/รอบส่งช่วงเปลี่ยนผ่าน การเลิกใช้ในทะเบียนเป็นการตัดสินใจของคน)
                if (oldPm) {
                  const tag = `ถูกแทนโดย EC → ${payload.mat_no} มีผล ${effDate}`;
                  await supabaseDR.from('parts_master').update({ note: oldPm.note ? `${oldPm.note} · ${tag}` : tag }).eq('id', oldPm.id);
                }
              }
            } catch (e) { console.warn('EC → parts_master:', e); }
          }
        }
      } else {
        const { error } = await supabaseDR.from('dr_products').update(payload).eq('id', editing);
        if (error) { toast.error(friendlySaveError(error, payload.mat_no, form.is_operation)); return; }
      }
      // อัปโหลดรูปใหม่ + DB update สำเร็จแล้ว ค่อยลบไฟล์รูปเดิมทิ้ง กันไฟล์กำพร้าสะสมใน storage (best-effort)
      // ลบเฉพาะเมื่อ URL เดิมชี้ bucket product-images และไม่มีสินค้าอื่นใช้รูปเดียวกันอยู่ (สินค้าชื่อเดียวกันแชร์รูปกัน)
      if (imageFile && editing !== 'new') {
        const oldUrl = items.find(i => i.id === editing)?.image_url;
        if (oldUrl && oldUrl !== imageUrl && oldUrl.includes('/product-images/')) {
          const stillUsed = items.some(i => i.id !== editing && i.image_url === oldUrl);
          const oldPath = decodeURIComponent(oldUrl.split('/product-images/')[1] || '');
          if (!stillUsed && oldPath) {
            // URL รูปแชร์ข้ามตารางกับทะเบียนกลาง parts_master ได้ (backfill/sync 2026-08-06) — เช็คอีกฝั่งก่อนลบไฟล์เสมอ
            supabaseDR.from('parts_master').select('id', { count: 'exact', head: true }).eq('image_url', oldUrl)
              .then(({ count }) => { if (!count) supabaseDR.storage.from('product-images').remove([oldPath]).catch(() => {}); });
          }
        }
      }
      // 🔩 ฟิลด์ชั้น Operation (รายการขั้นตอน เช่นงานขับนัท) — เขียนแยก best-effort เพราะคอลัมน์มาจาก
      // migration 20260817_operation_items_dr ที่อาจยังไม่ apply (ห้ามยัดลง payload หลัก = save พังทั้งฟอร์ม)
      // อัพเดทเฉพาะเมื่อเกี่ยวข้อง (ติ๊กอยู่ / เคยติ๊ก) — ไม่งั้นทุก save จะเด้ง error ตอน migration ยังไม่มา
      const wasOp = editing !== 'new' && !!items.find(i => i.id === editing)?.is_operation;
      if (form.is_operation || wasOp) {
        const { error: opErr } = await supabaseDR.from('dr_products').update({
          is_operation: !!form.is_operation,
          op_parent_mat: form.is_operation ? ((form.op_parent_mat || '').trim().toUpperCase() || null) : null,
          op_seq: form.is_operation && form.op_seq !== '' && form.op_seq != null ? parseInt(form.op_seq) : null,
        }).eq('id', savedId);
        if (opErr) toast.error('บันทึกสินค้าสำเร็จ แต่ฟิลด์ "รายการขั้นตอน (OP)" ยังไม่ถูกบันทึก — ยังไม่ได้ apply migration 20260817_operation_items_dr (แจ้ง admin)');
      }
      // ผูกคู่ RH/LH สองทาง — ถ้าเปลี่ยน/ยกเลิกคู่เดิม ให้เลิกผูกฝั่งคู่เดิมด้วย
      const oldPairMatNo = editing !== 'new' ? items.find(i => i.id === editing)?.pair_mat_no : null;
      if (oldPairMatNo && oldPairMatNo !== payload.pair_mat_no) {
        await supabaseDR.from('dr_products').update({ pair_mat_no: null }).eq('mat_no', oldPairMatNo);
      }
      if (payload.pair_mat_no) {
        await supabaseDR.from('dr_products').update({ pair_mat_no: payload.mat_no }).eq('mat_no', payload.pair_mat_no);
      }
      // ชิ้นงานเดียวกัน (ชื่อตรงกัน) ต่างแค่ customer/mat — sync รูปให้ทุก variant อัตโนมัติ
      if (imageFile && payload.name) {
        await supabaseDR.from('dr_products').update({ image_url: imageUrl })
          .eq('name', payload.name).neq('id', savedId);  // eq ไม่ใช่ ilike — กันชื่อที่มี % _ ไปแมตช์ผิดตัว
      }
      // รูป = ตัวตนพาร์ท (โมเดลทะเบียนกลาง) — เติมเข้า parts_master เมื่อทะเบียนยังไม่มีรูปของ mat นี้ (ไม่ทับของเดิม)
      if (imageFile && imageUrl && payload.mat_no) {
        const { data: pmRows } = await supabaseDR.from('parts_master').select('id, image_url').eq('mat_no', payload.mat_no).limit(1);
        if (pmRows?.[0] && !pmRows[0].image_url) {
          await supabaseDR.from('parts_master').update({ image_url: imageUrl }).eq('id', pmRows[0].id);
        }
      }
      toast.success(ecSource ? '🔄 Engineering Change บันทึกสำเร็จ' : 'บันทึกสำเร็จ');
      setEditing(null); setEcSource(null);
      load();
    } catch (err) {
      toast.error('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
      setSaving(false);
      setImageUploading(false);
    }
  };

  // "ลบ" = ปิดใช้งาน (soft-delete) ไม่ลบถาวร — dr_products.id ถูกอ้างโดยประวัติผลิต
  // (production_sessions/prod_orders/kanban_standards/bom_items) ถ้าลบจริงประวัติจะกำพร้า/ดึงชื่อ-รูปไม่ได้
  // ปิดใช้งานแล้วซ่อนจากรายการ (โผล่เมื่อกด "แสดงประวัติ") + เปิดกลับได้ · เก็บรูปไว้ (สินค้ายังอยู่)
  const handleDelete = async (id) => {
    if (!window.confirm('ปิดใช้งานสินค้านี้?\n\nสินค้าจะถูกซ่อนจากรายการ แต่เก็บประวัติไว้ (เปิดกลับได้จากปุ่ม "แสดงประวัติ")')) return;
    const { error } = await supabaseDR.from('dr_products').update({ is_active: false }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('ปิดใช้งานสินค้าแล้ว');
    load();
  };

  const handleReactivate = async (id) => {
    const { error } = await supabaseDR.from('dr_products').update({ is_active: true }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('เปิดใช้งานสินค้าแล้ว');
    load();
  };

  /* ── kanban CRUD ── */
  const openKanbanEdit = (std = null, defaultProductId = '', defaultMatNo = '') => {
    setKanbanEditing(std?.id || 'new');
    setKanbanForm(std
      ? { product_id: std.product_id || '', mat_no: std.mat_no || '', qty_per_kanban: std.qty_per_kanban || 1, is_active: std.is_active }
      // ดึง MAT.NO มาจาก product เดิม (เลขเดียวกันอยู่แล้ว) กันพิมพ์ผิดซ้ำเวลาเพิ่ม kanban standard ใหม่
      : { product_id: defaultProductId, mat_no: defaultMatNo || '', qty_per_kanban: 1, is_active: true });
  };
  const handleKanbanSave = async () => {
    if (!kanbanForm.mat_no.trim()) { toast.error('กรอก MAT.NO ก่อน'); return; }
    if (Number(kanbanForm.qty_per_kanban) < 1) { toast.error('Qty ต้องมากกว่า 0'); return; }
    setKanbanSaving(true);
    const payload = { product_id: kanbanForm.product_id || null, mat_no: kanbanForm.mat_no.trim().toUpperCase(), qty_per_kanban: parseInt(kanbanForm.qty_per_kanban), is_active: kanbanForm.is_active };
    // upsert on mat_no (unique key) แทน insert ตรงๆ — MAT.NO อาจมีแถวค้างอยู่แล้วจาก
    // Kanban Auto-Calc (Planner&Sales) ที่ product_id=null (ไม่โชว์ในลิสต์สินค้าเพราะกรอง product_id)
    // insert เฉยๆ จะชน unique constraint → "duplicate key" ทั้งที่จอโชว์ (0) · upsert = adopt แถวเดิม + ผูก product_id
    const { error } = kanbanEditing === 'new'
      ? await supabaseDR.from('kanban_standards').upsert(payload, { onConflict: 'mat_no' })
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

  /* ── group into families ── */
  const families = useMemo(() => {
    const map = new Map();
    [...items].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th')).forEach(item => {
      const fid = item.family_id || item.id;
      if (!map.has(fid)) map.set(fid, { family_id: fid, members: [] });
      map.get(fid).members.push(item);
    });
    map.forEach(f => f.members.sort((a, b) => (b.effective_from || '0000') > (a.effective_from || '0000') ? 1 : -1));
    return [...map.values()];
  }, [items]);

  /* ── filtered ── */
  const visibleFamilies = useMemo(() => {
    const q = search.trim().toLowerCase();
    return families
      .filter(f => showHistory || f.members.some(m => m.is_active))
      .filter(f => !lineFilter || f.members.some(m => m.line_name === lineFilter))
      .filter(f => {
        if (!q) return true;
        return f.members.some(m =>
          (m.name || '').toLowerCase().includes(q) ||
          (m.mat_no || '').toLowerCase().includes(q) ||
          (m.p_no || '').toLowerCase().includes(q) ||
          (m.customer || '').toLowerCase().includes(q) ||
          (m.code || '').toLowerCase().includes(q));
      });
  }, [families, search, lineFilter, showHistory]);

  const activeCount = items.filter(i => i.is_active).length;
  const uniqueLines = [...new Set(items.map(i => i.line_name).filter(Boolean))].sort();

  /* ── group visibleFamilies by part name to collapse same-name/diff-customer ── */
  const visibleGroups = useMemo(() => {
    const map = new Map();
    visibleFamilies.forEach(fam => {
      const rep = fam.members.find(m => m.is_active && !m.superseded_by) || fam.members[0];
      const key = rep?.name?.trim().toUpperCase() || fam.family_id;
      if (!map.has(key)) map.set(key, { key, name: rep?.name || '', families: [] });
      map.get(key).families.push(fam);
    });
    return [...map.values()];
  }, [visibleFamilies]);

  /* ── CSV helpers ── */
  const PRODUCT_CSV_COLS = ['name','code','mat_no','p_no','customer','line_name','cycle_time_sec','target_per_shift','process_type','qty_per_kanban'];
  const PRODUCT_CSV_HEADER = 'name,code,mat_no,p_no,customer,line_name,cycle_time_sec,target_per_shift,process_type,qty_per_kanban';
  const PRODUCT_CSV_EXAMPLE = [
    '[ตัวอย่าง-ลบแถวนี้ก่อนนำเข้าจริง] REINF FRT SD BDY INR RH,RH-001,EXAMPLE-10100384,RB3B-16E060-BA,FORD,LINE APRON ASSY,45,800,welding_assembly,20',
    '[ตัวอย่าง-ลบแถวนี้ก่อนนำเข้าจริง] REINF FRT SD BDY INR LH,LH-001,EXAMPLE-10100335,RB3B-16E061-BA,FORD,LINE APRON ASSY,45,800,welding_assembly,20',
  ].join('\n');

  const downloadProductTemplate = () => {
    const bom = `﻿${PRODUCT_CSV_HEADER}\n${PRODUCT_CSV_EXAMPLE}`;
    const blob = new Blob([bom], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'product_template.csv'; a.click();
  };

  const handleProductCsvUpload = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setCsvImporting(true);
    const text = await file.text();
    const rawLines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
    const header = rawLines[0].split(',').map(h => h.trim().replace(/^﻿/, ''));
    const allRows = rawLines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const obj = {};
      header.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
      return obj;
    });
    setCsvImporting(false);

    if (!allRows.length) { toast.error('ไม่พบข้อมูลในไฟล์ หรือ format ไม่ถูกต้อง'); return; }

    const exampleCount = allRows.filter(r => r.mat_no?.startsWith('EXAMPLE-')).length;
    const rows = allRows.filter(r => !r.mat_no?.startsWith('EXAMPLE-'));
    if (exampleCount) toast.info(`ข้ามแถวตัวอย่าง ${exampleCount} รายการอัตโนมัติ`);
    if (!rows.length) { toast.error('ไม่พบข้อมูลจริงในไฟล์ (มีแต่แถวตัวอย่าง)'); return; }

    const existingMatNos = new Set(items.map(i => i.mat_no).filter(Boolean));
    const newRows = [], dupRows = [], invalidRows = [];
    rows.forEach(r => {
      if (!r.name || !r.mat_no) { invalidRows.push(r); return; }
      if (existingMatNos.has(r.mat_no)) {
        const existing = items.find(i => i.mat_no === r.mat_no);
        dupRows.push({ row: r, existing, include: true });
      } else {
        newRows.push(r);
      }
    });
    setCsvPreview({ type: 'products', newRows, dupRows, invalidRows, overwriteAll: false });
  };

  const confirmCsvImport = async () => {
    if (!csvPreview) return;
    const { type, newRows, dupRows, invalidRows: _iv, overwriteAll } = csvPreview;
    const selectedDups = dupRows.filter(d => overwriteAll || d.include).map(d => d.row);
    const toImport = [...newRows, ...selectedDups];
    if (!toImport.length) { toast.error('ไม่มีรายการที่จะนำเข้า'); return; }

    if (type === 'products') {
      const payload = toImport.map(r => ({
        name: r.name, code: r.code || null, mat_no: r.mat_no || null,
        p_no: r.p_no || null, customer: r.customer || null, line_name: r.line_name || null,
        cycle_time_sec: r.cycle_time_sec ? Number(r.cycle_time_sec) : null,
        target_per_shift: r.target_per_shift ? Number(r.target_per_shift) : null,
        process_type: r.process_type || 'welding_assembly', is_active: true,
      }));
      const { data: savedProducts, error } = await supabaseDR.from('dr_products')
        .upsert(payload, { onConflict: 'mat_no', ignoreDuplicates: false }).select('id, mat_no');
      if (error) { toast.error(error.message); return; }

      const kanbanRows = toImport.filter(r => r.qty_per_kanban && Number(r.qty_per_kanban) > 0);
      if (kanbanRows.length) {
        const idByMatNo = new Map((savedProducts || []).map(p => [p.mat_no, p.id]));
        const kanbanPayload = kanbanRows.map(r => ({
          product_id: idByMatNo.get(r.mat_no) || null,
          mat_no: r.mat_no, qty_per_kanban: Math.trunc(Number(r.qty_per_kanban)), is_active: true,
        }));
        const { error: kanbanError } = await supabaseDR.from('kanban_standards')
          .upsert(kanbanPayload, { onConflict: 'mat_no', ignoreDuplicates: false });
        if (kanbanError) { toast.error(`บันทึก Kanban Standard ไม่สำเร็จ: ${kanbanError.message}`); }
      }
      toast.success(`นำเข้า ${payload.length} รายการสำเร็จ`);
    } else {
      // ต้นทุน/ชิ้น: ไฟล์ไม่มีคอลัมน์/เซลล์ว่าง = คงค่าเดิม (upsert ทับทั้งแถว — ต้องเติมค่าเดิมกลับเอง)
      // ⚠️ PostgREST บังคับทุก object ใน bulk upsert มี key ชุดเดียวกัน — ห้าม spread รายแถวตามเซลล์
      const existingByMat = new Map(dupRows.map(d => [d.row.mat_no, d.existing]));
      const costVal = (cell, oldVal) => (cell !== undefined && cell !== '' ? (Number(cell) || null) : (oldVal ?? null));
      const payload = toImport.map(r => {
        const ex = existingByMat.get(r.mat_no);
        return {
          mat_no: r.mat_no, part_name: r.part_name,
          part_no: r.part_no || null, uom: r.uom || 'EA',
          qty_per_pkg: r.qty_per_pkg ? Number(r.qty_per_pkg) : null,
          supplier: r.supplier || null, note: r.note || null, is_active: true,
          material_cost: costVal(r.material_cost, ex?.material_cost),
          standard_cost: costVal(r.standard_cost, ex?.standard_cost),
        };
      });
      const { error } = await supabaseDR.from('parts_master').upsert(payload, { onConflict: 'mat_no', ignoreDuplicates: false });
      if (error) { toast.error(error.message); return; }
      toast.success(`นำเข้า ${payload.length} รายการสำเร็จ`);
    }
    setCsvPreview(null);
    load();
    if (type === 'parts') setPartsReloadKey(k => k + 1);
  };

  return (
    <div style={{ padding: 'clamp(12px, 2vw, 24px)', maxWidth: 'min(96vw, 2000px)', margin: '0 auto' }}>
      {/* ── Main Tab Bar ── */}
      {/* overflowX + maxWidth: จอแคบเลื่อนแท็บแนวนอนได้ (desktop กว้างพอ ไม่มี scrollbar — เหมือนเดิม) */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--bg2)', borderRadius: 8, padding: 4, marginBottom: 20, width: 'fit-content', maxWidth: '100%', overflowX: 'auto' }}>
        {[{ key:'products', label:'🔩 Products' }, { key:'bom', label:'📦 BOM' }, { key:'packaging', label:'📦 Packaging' }, { key:'parts', label:'🗂 Parts Master' }, { key:'kanban', label:'🎴 Kanban Std' }, { key:'routing', label:'🔀 Routing' }, { key:'export', label:'📤 Export' }].map(t => (
          <button key={t.key} onClick={() => setMainTab(t.key)}
            style={{ padding:'6px 18px', borderRadius:6, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, whiteSpace:'nowrap', flexShrink:0,
              background: mainTab===t.key ? 'var(--accent)' : 'transparent',
              color: mainTab===t.key ? '#08130a' : 'var(--muted)', fontFamily:'var(--font-body)' }}>
            {t.label}
          </button>
        ))}
      </div>

      {mainTab === 'products' && (<>
      {/* ── Header ── */}
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(18px, 2.5vw, 24px)', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
          🔩 Product Master
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
          ฐานข้อมูลกลาง Product/Model · เชื่อมกับ{' '}
          <Link to="/daily-report" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Daily Report</Link>,{' '}
          <Link to="/heijunka" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Heijunka Kanban</Link> และ{' '}
          <Link to="/oee-analytics" style={{ color: 'var(--accent)', textDecoration: 'none' }}>OEE Analytics</Link>
        </p>
      </div>

      {/* ── Callout: แนะนำ Parts Master สำหรับ 300/500 ── */}
      <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--text2)', flex: 1 }}>
          <span style={{ fontWeight: 700, color: '#f59e0b' }}>📦 ชิ้นส่วนที่ซื้อจาก Supplier</span>
          {' '}(ขึ้นต้น <strong>3</strong> · <strong>5</strong>) เพิ่มได้ที่ tab{' '}
          <strong style={{ color: 'var(--text)' }}>🗂 Parts Master</strong>
          {' '}— หน้านี้รองรับเฉพาะเลขขึ้นต้น <strong>1</strong> (FG ส่งลูกค้า) และ <strong>2</strong> (Child Part ผลิตเอง)
        </div>
        <button onClick={() => setMainTab('parts')} style={{ ...btnPrimary, background: '#f59e0b', fontSize: 12, padding: '6px 14px', whiteSpace: 'nowrap' }}>
          ไปที่ Parts Master →
        </button>
      </div>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <input
          style={{ ...inputSt, maxWidth: 280, padding: '8px 12px' }}
          placeholder="🔍 ชื่อ / MAT.NO / P.NO / ลูกค้า..."
          value={search} onChange={e => setSearch(e.target.value)}
        />
        <select value={lineFilter} onChange={e => setLineFilter(e.target.value)} style={{ ...inputSt, width: 'auto', padding: '8px 10px' }}>
          <option value="">ทุกไลน์</option>
          {uniqueLines.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--muted)' }}>
          <input type="checkbox" checked={showHistory} onChange={e => setShowHistory(e.target.checked)} />
          แสดงประวัติ EC
        </label>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{visibleGroups.length} part · {visibleFamilies.length} variant · {activeCount} ใช้งาน</span>
        {canCreate && <>
          <button onClick={downloadProductTemplate} style={{ ...btnSecondary, fontSize: 12 }}>⬇️ CSV Template</button>
          <button onClick={() => csvInputRef.current?.click()} disabled={csvImporting}
            style={{ ...btnSecondary, fontSize: 12, opacity: csvImporting ? 0.6 : 1 }}>
            {csvImporting ? '⏳ กำลังนำเข้า...' : '⬆️ นำเข้า CSV'}
          </button>
          <input ref={csvInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleProductCsvUpload} />
        </>}
        {canCreate && <button onClick={() => openEdit()} style={btnPrimary}>+ เพิ่มสินค้า</button>}
      </div>

      {/* 🔩 worklist — รายการขั้นตอน (OP) ที่ยังไม่ผูกพาร์ทจริง = ยอดรวมยังนับซ้ำได้ (ห้ามซ่อน — pattern แถบ ⚠️ ข้อมูลไม่ตรงผัง) */}
      {(() => {
        const opNoParent = items.filter(i => i.is_active && i.is_operation && !i.op_parent_mat);
        if (!opNoParent.length) return null;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px', marginBottom: 12, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 10 }}>
            <span style={{ fontSize: 13, color: '#f59e0b', fontWeight: 700 }}>
              🔩 รายการขั้นตอน (OP) ที่ยังไม่ผูกพาร์ทจริง {opNoParent.length} รายการ
            </span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              ยอดผลิตของรายการเหล่านี้ยังถูกนับซ้ำในยอดรวมได้ — กด "แก้ไข" ที่รายการแล้วเลือก "เป็นขั้นของพาร์ทจริง (MAT)"
              {' '}(พาร์ทจริงยังไม่มีในระบบ = ไปเพิ่มพาร์ท 2xxx ก่อน)
            </span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>({opNoParent.map(i => i.mat_no).join(' · ')})</span>
          </div>
        );
      })()}

      {/* ── Name Groups → Family cards ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {visibleGroups.length === 0 && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 14, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12 }}>
            ไม่พบ product ที่ตรงเงื่อนไข
          </div>
        )}
        {visibleGroups.map(({ key: nameKey, name: partName, families: nameFamilies }) => {
          const isMulti   = nameFamilies.length > 1;
          const isExpGroupExpanded = expandedNameGroups[nameKey] !== false;
          const repItem   = (nameFamilies[0].members.find(m => m.is_active && !m.superseded_by) || nameFamilies[0].members[0]);
          const totalBomAll = isMulti ? nameFamilies.reduce((s, fam) => s + fam.members.reduce((ss, m) => ss + (bomCounts[m.id] || 0), 0), 0) : 0;

          /* helper — renders one family's detail card */
          const FamilyCard = ({ family_id, members, indented }) => {
            const active   = members.find(m => m.is_active && !m.superseded_by);
            const archived = members.filter(m => !m.is_active || m.superseded_by);
            const item     = active || members[0];
            const totalQty = familyTotals[family_id] || 0;
            const isExpandedKanban = expandedFamilies[family_id] !== false;
            const familyProductIds = new Set(members.map(m => m.id));
            const stds = kanbanStds.filter(s => s.product_id && familyProductIds.has(s.product_id));
            const totalBom = members.reduce((s, m) => s + (bomCounts[m.id] || 0), 0);
            return (
              <div style={{ background: 'var(--card)', border: `1px solid var(--border)`, borderRadius: indented ? 8 : 12, overflow: 'hidden', marginLeft: indented ? 16 : 0, marginRight: indented ? 16 : 0, marginBottom: indented ? 8 : 0 }}>
                <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  {item.image_url && (
                    <img src={item.image_url} alt="" loading="lazy" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {!indented && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{item.name}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: `${procColor(item.process_type, '#22c55e')}26`, color: procColor(item.process_type, '#22c55e') }}>
                          {procDisplay(item.process_type)}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: item.posting_mode === 'lot_accumulate' ? 'rgba(168,85,247,0.15)' : 'rgba(56,189,248,0.12)', color: item.posting_mode === 'lot_accumulate' ? '#a855f7' : '#38bdf8' }}>
                          {item.posting_mode === 'lot_accumulate' ? `📥 สะสม Lot ≥${item.lot_accumulate_threshold ?? '?'}` : '📌 มีกัมบังก็ผลิต'}
                        </span>
                        {members.length > 1 && <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, background: 'rgba(168,85,247,0.12)', color: '#a855f7', fontWeight: 700 }}>🔄 {members.length} revisions</span>}
                        {!active && <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, background: 'rgba(107,114,128,0.15)', color: '#6b7280', fontWeight: 700 }}>ปิดใช้งาน</span>}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
                      {item.mat_no && <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: '#0ea5e9' }}>{item.mat_no}</span>}
                      {item.is_operation && (
                        <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: item.op_parent_mat ? 'rgba(14,165,233,0.12)' : 'rgba(245,158,11,0.15)', color: item.op_parent_mat ? '#0ea5e9' : '#f59e0b', fontWeight: 700 }}
                          title={item.op_parent_mat ? 'รายการขั้นตอน — ยอดรวมภาพใหญ่นับที่พาร์ทจริง ไม่บวกซ้ำ' : 'รายการขั้นตอนที่ยังไม่ผูกพาร์ทจริง — ยอดยังนับซ้ำได้ กดแก้ไขแล้วเลือกพาร์ทจริง'}>
                          🔩 OP{item.op_seq ? ` ${item.op_seq}` : ''}{item.op_parent_mat ? ` · ของ ${item.op_parent_mat}` : ' · ยังไม่ผูกพาร์ทจริง'}
                        </span>
                      )}
                      {item.p_no   && <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text2)' }}>P.NO: {item.p_no}</span>}
                      {item.customer && <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: 'rgba(59,130,246,0.1)', color: '#60a5fa' }}>{item.customer}</span>}
                      {item.code && <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 20, background: 'var(--bg2)', color: 'var(--muted)' }}>{item.code}</span>}
                      {members.length > 1 && indented && <span style={{ fontSize: 11, padding: '1px 5px', borderRadius: 10, background: 'rgba(168,85,247,0.12)', color: '#a855f7', fontWeight: 700 }}>🔄 {members.length} rev</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {[item.line_name && `📍 ${item.line_name}`, item.cycle_time_sec && `CT ${item.cycle_time_sec}s`, item.target_per_shift && `Target ${item.target_per_shift}/กะ`, !indented && item.effective_from && `ใช้ตั้งแต่ ${item.effective_from}`].filter(Boolean).join(' · ')}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {totalQty > 0 && <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 700 }}>📦 ยอดสะสม {totalQty.toLocaleString()} ชิ้น</span>}
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: totalBom > 0 ? 'rgba(61,214,92,0.1)' : 'rgba(107,114,128,0.08)', color: totalBom > 0 ? 'var(--accent)' : 'var(--muted)', fontWeight: 700 }}>📦 BOM: {totalBom > 0 ? `${totalBom} พาร์ท` : 'ยังไม่มี'}</span>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: stds.filter(s => s.is_active).length > 0 ? 'rgba(245,158,11,0.1)' : 'rgba(107,114,128,0.08)', color: stds.filter(s => s.is_active).length > 0 ? '#f59e0b' : 'var(--muted)', fontWeight: 700 }}>🎴 Kanban: {stds.filter(s => s.is_active).length > 0 ? `${stds.filter(s => s.is_active).length} mat` : 'ยังไม่มี'}</span>
                    </div>
                    <RelatedLinks matNo={item.mat_no} productId={item.id} />
                  </div>
                  {(canEdit || canDelete) && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'flex-start' }}>
                      {canEdit && active && <button onClick={() => openEC(active)} title="Engineering Change" style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: '#a855f7', fontWeight: 700 }}>🔄 EC</button>}
                      {canEdit && <button onClick={() => openEdit(item)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>}
                      {/* สินค้าที่ปิดใช้งาน (ไม่ใช่ superseded โดย EC) → ปุ่มเปิดกลับ · สินค้าที่ยัง active → ✕ ปิดใช้งาน */}
                      {canDelete && !item.is_active && !item.superseded_by && <button onClick={() => handleReactivate(item.id)} title="เปิดใช้งานสินค้ากลับ" style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: '#22c55e', fontWeight: 700 }}>♻️ เปิดใช้งาน</button>}
                      {canDelete && item.is_active && <button className="tbtn" onClick={() => handleDelete(item.id)} title="ปิดใช้งานสินค้า (เก็บประวัติ)" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}>✕</button>}
                    </div>
                  )}
                </div>
                {showHistory && archived.length > 0 && (
                  <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg2)', padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 2 }}>📋 ประวัติ Revision</div>
                    {archived.map(rev => (
                      <div key={rev.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, color: 'var(--muted)', opacity: 0.75 }}>
                        <span style={{ fontFamily: 'monospace', color: '#64748b' }}>{rev.mat_no || '—'}</span>
                        {rev.p_no && <span style={{ color: '#475569' }}>P.NO: {rev.p_no}</span>}
                        <span>{rev.effective_from || '?'} → {rev.superseded_at || '?'}</span>
                        <span style={{ fontSize: 11, padding: '1px 5px', borderRadius: 10, background: 'rgba(107,114,128,0.15)', color: '#6b7280' }}>superseded</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ borderTop: '1px solid var(--border)' }}>
                  <button onClick={() => setExpandedFamilies(prev => ({ ...prev, [family_id]: !isExpandedKanban }))}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: 'var(--bg2)', border: 'none', cursor: 'pointer', color: 'var(--text2)', fontSize: 12, fontWeight: 700 }}>
                    <span>🎴 Kanban Standards ({stds.length})</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{isExpandedKanban ? '▲' : '▼'}</span>
                  </button>
                  {isExpandedKanban && (
                    <div style={{ padding: '8px 12px', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {stds.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 4px' }}>ยังไม่มี Kanban Standard</div>}
                      {stds.map(std => {
                        const linkedProd = members.find(m => m.id === std.product_id);
                        const isOldRev   = linkedProd && !linkedProd.is_active;
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
                            {(canEdit || canDelete) && (
                              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                {canEdit && <button onClick={() => openKanbanEdit(std)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>}
                                {canDelete && <button className="tbtn" onClick={() => handleKanbanDelete(std.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 13 }}>✕</button>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {canCreate && (
                        <button onClick={() => openKanbanEdit(null, active?.id || members[0]?.id || '', item.mat_no || '')}
                          style={{ alignSelf: 'flex-start', marginTop: 2, background: 'rgba(14,165,233,0.08)', border: '1px dashed rgba(14,165,233,0.4)', borderRadius: 6, padding: '4px 12px', fontSize: 11, color: '#0ea5e9', cursor: 'pointer', fontWeight: 700 }}>
                          + เพิ่ม MAT.NO
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          };

          /* ── multi-customer group card ──
             1 part = 1 การ์ด แม้จะแยก MAT.NO ตามลูกค้า (AAT/FTM/FVL) — ตัวแปรลูกค้าแสดงเป็นรายการ
             ในรายละเอียดของการ์ดเดียว และ Kanban Standards รวมเป็นรายการเดียวแท็กลูกค้า ไม่แยกเป็นการ์ดย่อยซ้ำ */
          if (isMulti) {
            const allVariants = nameFamilies.map(fam => {
              const m = fam.members.find(x => x.is_active && !x.superseded_by) || fam.members[0];
              const revCount = fam.members.length;
              return { ...m, family_id: fam.family_id, revCount };
            });
            const familyProductIds = new Set(nameFamilies.flatMap(fam => fam.members.map(m => m.id)));
            const variantById = new Map(allVariants.map(v => [v.id, v]));
            const stds = kanbanStds.filter(s => s.product_id && familyProductIds.has(s.product_id));
            const isExpandedKanban = expandedFamilies[nameKey] !== false;
            const heroImage = repItem.image_url || allVariants.find(v => v.image_url)?.image_url;
            return (
              <div key={nameKey} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                {/* Compact group header */}
                <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  {heroImage && (
                    <img src={heroImage} alt="" loading="lazy" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{partName}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: `${procColor(repItem.process_type, '#22c55e')}26`, color: procColor(repItem.process_type, '#22c55e') }}>
                        {procDisplay(repItem.process_type)}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: repItem.posting_mode === 'lot_accumulate' ? 'rgba(168,85,247,0.15)' : 'rgba(56,189,248,0.12)', color: repItem.posting_mode === 'lot_accumulate' ? '#a855f7' : '#38bdf8' }}>
                        {repItem.posting_mode === 'lot_accumulate' ? `📥 สะสม Lot ≥${repItem.lot_accumulate_threshold ?? '?'}` : '📌 มีกัมบังก็ผลิต'}
                      </span>
                      <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, background: 'rgba(59,130,246,0.12)', color: '#60a5fa', fontWeight: 700 }}>👥 {nameFamilies.length} ลูกค้า</span>
                      {totalBomAll > 0 && <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, background: 'rgba(61,214,92,0.1)', color: 'var(--accent)', fontWeight: 700 }}>📦 BOM: {totalBomAll}</span>}
                      <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, background: stds.filter(s => s.is_active).length > 0 ? 'rgba(245,158,11,0.1)' : 'rgba(107,114,128,0.08)', color: stds.filter(s => s.is_active).length > 0 ? '#f59e0b' : 'var(--muted)', fontWeight: 700 }}>🎴 Kanban: {stds.filter(s => s.is_active).length > 0 ? `${stds.filter(s => s.is_active).length} mat` : 'ยังไม่มี'}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {[repItem.line_name && `📍 ${repItem.line_name}`, repItem.cycle_time_sec && `CT ${repItem.cycle_time_sec}s`, repItem.target_per_shift && `Target ${repItem.target_per_shift}/กะ`].filter(Boolean).join(' · ')}
                    </div>
                    <RelatedLinks matNo={repItem.mat_no} productId={repItem.id} />
                  </div>
                  <button onClick={() => setExpandedNameGroups(p => ({ ...p, [nameKey]: !isExpGroupExpanded }))}
                    style={{ ...btnSecondary, fontSize: 11, padding: '4px 10px', flexShrink: 0 }}>
                    {isExpGroupExpanded ? '▲ ย่อ' : '▼ ขยาย'}
                  </button>
                </div>

                {isExpGroupExpanded && <>
                  {/* ตัวแปรตามลูกค้า / MAT.NO — รายการเดียว ไม่ใช่การ์ดซ้อนการ์ด */}
                  <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>👥 ตัวแปรตามลูกค้า / MAT.NO ({allVariants.length})</div>
                    {allVariants.map(v => (
                      <div key={v.family_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'var(--bg)', borderRadius: 8, flexWrap: 'wrap' }}>
                        {v.image_url
                          ? <img src={v.image_url} alt="" loading="lazy" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', flexShrink: 0 }} />
                          : <div style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', flexShrink: 0 }} />}
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', color: '#60a5fa', fontWeight: 700, flexShrink: 0 }}>{v.customer || '—'}</span>
                        <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'monospace', color: '#0ea5e9' }}>{v.mat_no}</span>
                        {v.p_no && <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text2)' }}>P.NO: {v.p_no}</span>}
                        {v.line_name && <span style={{ fontSize: 11, color: 'var(--muted)' }}>📍 {v.line_name}</span>}
                        {v.revCount > 1 && <span style={{ fontSize: 11, padding: '1px 5px', borderRadius: 10, background: 'rgba(168,85,247,0.12)', color: '#a855f7', fontWeight: 700 }}>🔄 {v.revCount} rev</span>}
                        <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: (bomCounts[v.id] || 0) > 0 ? 'rgba(61,214,92,0.1)' : 'rgba(107,114,128,0.08)', color: (bomCounts[v.id] || 0) > 0 ? 'var(--accent)' : 'var(--muted)', fontWeight: 700 }}>📦 {(bomCounts[v.id] || 0) > 0 ? `${bomCounts[v.id]} พาร์ท` : 'ไม่มี BOM'}</span>
                        {(canEdit || canDelete) && (
                          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', flexShrink: 0 }}>
                            {canEdit && <button onClick={() => openEC(v)} title="Engineering Change" style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#a855f7', fontWeight: 700 }}>🔄 EC</button>}
                            {canEdit && <button onClick={() => openEdit(v)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>}
                            {canDelete && <button className="tbtn" onClick={() => handleDelete(v.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 13 }}>✕</button>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Kanban Standards รวมทุกลูกค้าไว้รายการเดียว แท็กลูกค้าต่อแถว */}
                  <div style={{ borderTop: '1px solid var(--border)' }}>
                    <button onClick={() => setExpandedFamilies(prev => ({ ...prev, [nameKey]: !isExpandedKanban }))}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: 'var(--bg2)', border: 'none', cursor: 'pointer', color: 'var(--text2)', fontSize: 12, fontWeight: 700 }}>
                      <span>🎴 Kanban Standards ({stds.length})</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{isExpandedKanban ? '▲' : '▼'}</span>
                    </button>
                    {isExpandedKanban && (
                      <div style={{ padding: '8px 12px', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {stds.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 4px' }}>ยังไม่มี Kanban Standard</div>}
                        {stds.map(std => {
                          const v = variantById.get(std.product_id);
                          return (
                            <div key={std.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 7, opacity: std.is_active ? 1 : 0.5 }}>
                              {v?.customer && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', color: '#60a5fa', fontWeight: 700, flexShrink: 0 }}>{v.customer}</span>}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'monospace', color: '#0ea5e9' }}>{std.mat_no}</span>
                                {!std.is_active && <span style={{ fontSize: 11, color: '#ef4444', marginLeft: 6 }}>ปิด</span>}
                              </div>
                              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                <span style={{ fontSize: 18, fontWeight: 900, color: '#0ea5e9', lineHeight: 1 }}>{std.qty_per_kanban}</span>
                                <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 3 }}>ชิ้น/ใบ</span>
                              </div>
                              {(canEdit || canDelete) && (
                                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                  {canEdit && <button onClick={() => openKanbanEdit(std)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>}
                                  {canDelete && <button className="tbtn" onClick={() => handleKanbanDelete(std.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 13 }}>✕</button>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {canCreate && allVariants.filter(v => !stds.some(s => s.product_id === v.id)).map(v => (
                          <button key={v.id} onClick={() => openKanbanEdit(null, v.id, v.mat_no)}
                            style={{ alignSelf: 'flex-start', marginTop: 2, background: 'rgba(14,165,233,0.08)', border: '1px dashed rgba(14,165,233,0.4)', borderRadius: 6, padding: '4px 12px', fontSize: 11, color: '#0ea5e9', cursor: 'pointer', fontWeight: 700 }}>
                            + เพิ่ม MAT.NO ({v.customer || v.mat_no})
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>}
              </div>
            );
          }

          /* ── single customer — render full card directly ── */
          const { family_id, members } = nameFamilies[0];
          return <FamilyCard key={family_id} family_id={family_id} members={members} indented={false} />;
        })}
      </div>

      {/* ════ Add / Edit / EC modal ════ */}
      {editing && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg3)', border: `1px solid ${ecSource ? 'rgba(168,85,247,0.5)' : 'var(--border2)'}`, borderRadius: 14, padding: 24, width: 'min(95vw,560px)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
              {ecSource ? '🔄 Engineering Change' : editing === 'new' ? '+ เพิ่มสินค้า' : 'แก้ไขสินค้า'}
            </div>
            {ecSource && (
              <div style={{ fontSize: 12, color: '#a855f7', marginBottom: 16, padding: '8px 12px', background: 'rgba(168,85,247,0.08)', borderRadius: 8, border: '1px solid rgba(168,85,247,0.2)' }}>
                ต่อจาก: <strong>{ecSource.mat_no}</strong> {ecSource.p_no && `/ ${ecSource.p_no}`}<br />
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>MAT.NO เดิมถูก mark เป็น superseded อัตโนมัติ · MAT ใหม่ถูกลงทะเบียน Parts Master ให้เอง (สืบทอด uom/จำนวนต่อกล่อง/supplier — ต้นทุนให้บัญชีเติม)</span>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="ชื่อสินค้า / Model *">
                <input autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputSt} />
              </Field>
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label={ecSource ? 'MAT.NO ใหม่ (SAP) *' : form.is_operation ? 'เลข/ชื่อของขั้น (ตั้งเอง — ไม่ใช่เลข SAP)' : 'MAT.NO (SAP)'}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input value={form.mat_no} onChange={e => setForm(f => ({ ...f, mat_no: e.target.value.toUpperCase() }))} placeholder={form.is_operation ? 'เช่น 332 ขับนัท M6' : 'เช่น 10100399'} style={{ ...inputSt, flex: 1, minWidth: 0, fontFamily: 'monospace', fontWeight: 700, borderColor: ecSource ? 'rgba(168,85,247,0.5)' : undefined }} />
                    <button type="button" onClick={() => setPartsPickFor('product')} title="เลือกจากทะเบียนกลาง Parts Master"
                      style={{ ...btnSecondary, padding: '6px 10px', flexShrink: 0 }}>🗂</button>
                  </div>
                  {/* คำใบ้เคส OP (user ขอ 2026-08-17): SAP ไม่มีตัวตนของขั้น — ตั้งชื่อเอง ห้ามใช้เลขพาร์ทจริงซ้ำ */}
                  {form.is_operation && (
                    <div style={{ fontSize: 11, color: '#0ea5e9', marginTop: 4 }}>
                      🔩 รายการ OP ไม่ใช้เลข MAT SAP — ตั้งเลข/ชื่อของขั้นเองไม่ซ้ำใคร (เลขพาร์ทจริงใส่ช่อง "เป็นขั้นของพาร์ทจริง" ด้านล่างเท่านั้น)
                    </div>
                  )}
                  {/* เตือนเลขซ้ำตั้งแต่ตอนพิมพ์ — ไม่ต้องรอชน unique constraint ตอนกดบันทึก */}
                  {form.mat_no && items.some(i => i.mat_no === form.mat_no.trim() && i.id !== editing) && (
                    <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4, fontWeight: 700 }}>
                      ⚠ เลขนี้มีสินค้าอยู่แล้วในระบบ — บันทึกไม่ผ่านแน่นอน{form.is_operation ? ' · รายการ OP ต้องตั้งเลข/ชื่อใหม่ของตัวเอง' : ' · ค้นหาแล้วแก้ไขตัวเดิมแทน'}
                    </div>
                  )}
                  {form.mat_no && !form.is_operation && pmParts.length > 0 && !matInRegistry(form.mat_no) && (
                    ecSource ? (
                      <div style={{ fontSize: 11, color: '#a855f7', marginTop: 4 }}>
                        🗂 MAT ใหม่ — ระบบจะลงทะเบียน Parts Master ให้อัตโนมัติตอนบันทึก EC
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>
                        ⚠ MAT นี้ยังไม่มีในทะเบียนกลาง Parts Master — แนะนำเพิ่มที่ tab 🗂 ก่อน กันเลขหลุดทะเบียน
                      </div>
                    )
                  )}
                </Field>
                <Field label={ecSource ? 'P.NO ใหม่ *' : 'P.NO'}>
                  <input value={form.p_no} onChange={e => setForm(f => ({ ...f, p_no: e.target.value }))} placeholder="เช่น RC3B16E061BB" style={{ ...inputSt, borderColor: ecSource ? 'rgba(168,85,247,0.5)' : undefined }} />
                </Field>
              </div>
              {ecSource && (
                <Field label="วันที่มีผล (effective_from) *">
                  <input type="date" value={form.effective_from} onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))} style={inputSt} />
                </Field>
              )}
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Customer"><input value={form.customer} onChange={e => setForm(f => ({ ...f, customer: e.target.value }))} placeholder="เช่น FORD" style={inputSt} /></Field>
                <Field label="รหัสสินค้า (Code)"><input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="เช่น HDF-001" style={inputSt} /></Field>
              </div>
              <Field label="ประเภทกระบวนการ *">
                <select value={form.process_type} onChange={e => setForm(f => ({ ...f, process_type: e.target.value }))} style={inputSt}>
                  {activeProcessTypes().map(pt => <option key={pt.key} value={pt.key}>{`${pt.icon || ''} ${pt.label}`.trim()}</option>)}
                </select>
              </Field>
              <Field label="รูปแบบขึ้นกัมบัง *">
                <select value={form.posting_mode} onChange={e => setForm(f => ({ ...f, posting_mode: e.target.value }))} style={inputSt}>
                  <option value="immediate">📌 มีกัมบังก็ผลิต (ขึ้น Order ทุกครั้งที่ scan)</option>
                  <option value="lot_accumulate">📥 สะสม Lot ก่อนขึ้น Order (Lot Post)</option>
                </select>
              </Field>
              {form.posting_mode === 'lot_accumulate' && (
                <Field label="จำนวนสะสมขั้นต่ำก่อนขึ้น Order (ชิ้น) *">
                  <input type="number" min="1" value={form.lot_accumulate_threshold}
                    onChange={e => setForm(f => ({ ...f, lot_accumulate_threshold: e.target.value }))}
                    placeholder="เช่น 800, 1000" style={inputSt} />
                </Field>
              )}
              <Field label="ไลน์ผลิตหลัก">
                <select value={form.line_name} onChange={e => setForm(f => ({ ...f, line_name: e.target.value }))} style={inputSt}>
                  <option value="">ไม่ระบุ</option>
                  {lines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                </select>
              </Field>
              <Field label="MAT.NO คู่ (RH/LH) — สแกนคู่ 2 ครั้ง เปิด/ปิดอิสระต่อข้าง">
                <MatSearchField value={form.pair_mat_no} onChange={v => setForm(f => ({ ...f, pair_mat_no: v }))}
                  options={items.filter(i => i.mat_no && i.mat_no !== form.mat_no && i.is_active)}
                  placeholder="พิมพ์เลข MAT หรือชื่อ เพื่อค้นหาคู่… (ว่าง = ไม่มีคู่)"
                  hint="ลิสต์เรียงตามเลข · แสดงเฉพาะสินค้าที่ใช้งานอยู่" />
              </Field>
              {/* 🔩 ชั้น Operation — รายการที่เป็น "ขั้นตอน" ของพาร์ทจริง (เช่นงานขับนัท SUB APRON 1 รายการ/1 OP)
                  ใบงานยังเปิด/ปิดรายเครื่องได้ตามเดิม (หัวหน้าไลน์มอนิเตอร์รายขั้น) แต่ยอดรวมภาพใหญ่
                  จะนับที่พาร์ทจริงตัวเดียว ไม่บวกซ้ำ (collapseOps · migration 20260817_operation_items_dr) */}
              <div style={{ border: '1px solid rgba(14,165,233,0.35)', borderRadius: 8, padding: '10px 12px', background: 'rgba(14,165,233,0.05)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!form.is_operation} onChange={e => setForm(f => ({ ...f, is_operation: e.target.checked }))} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#0ea5e9' }}>🔩 รายการขั้นตอน (OP) — ไม่ใช่พาร์ทจริง</span>
                </label>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  เช่น งานขับนัทแต่ละสเต็ปของชิ้นเดียวกัน · ช่องบนสุดตั้งเลข/ชื่อของขั้นเอง (ไม่ใช้เลข SAP) · ยอดรวมภาพใหญ่จะนับที่พาร์ทจริง ไม่บวกซ้ำ · ห้ามเอารายการ OP เข้า BOM/คัมบัง
                </div>
                {form.is_operation && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                    <Field label="เป็นขั้นของพาร์ทจริง (MAT) *">
                      {/* parent เป็นได้ทั้งสินค้าที่ผลิตในไลน์ และพาร์ทซื้อนอก (เบอร์ 3/5) จากทะเบียนกลาง —
                          เคสจริง: ขั้นขับนัทบนพาร์ทซื้อนอกที่ตัวตนยังเป็นเลขเดิม (user ทัก 2026-08-17 "เบอร์ 3 หาไม่เจอ") */}
                      <MatSearchField value={form.op_parent_mat} onChange={v => setForm(f => ({ ...f, op_parent_mat: v }))}
                        options={(() => {
                          // จัดอันดับจากข้อมูลที่ระบบรู้ (user ขอ 2026-08-17 "ควรดูจาก BOM"):
                          // ① พาร์ทจริงในไลน์เดียวกับ OP ตัวนี้ ② พาร์ทใน BOM ของสินค้าไลน์นี้ (ของที่ถูกส่งเข้าไลน์)
                          // ③ พาร์ทจริงไลน์อื่น ④ ทะเบียน Parts Master (ซื้อนอก) ที่เหลือ
                          const norm = (m) => (m || '').trim().toUpperCase();
                          const lineProdIds = new Set(items.filter(i => i.line_name && i.line_name === form.line_name).map(i => i.id));
                          const bomMats = new Set(bomRows.filter(b => lineProdIds.has(b.product_id)).map(b => norm(b.mat_no)));
                          const real = items.filter(i => i.mat_no && i.id !== editing && i.is_active && !i.is_operation)
                            .map(i => ({ mat_no: i.mat_no, name: i.name,
                              rank: i.line_name === form.line_name ? 0 : bomMats.has(norm(i.mat_no)) ? 1 : 2,
                              tag: i.line_name === form.line_name ? '🏭ไลน์นี้' : bomMats.has(norm(i.mat_no)) ? '📦BOMไลน์นี้' : null }));
                          const seen = new Set(real.map(o => norm(o.mat_no)));
                          const bought = pmParts
                            .filter(p => p.mat_no && !seen.has(norm(p.mat_no)))
                            .map(p => ({ mat_no: p.mat_no, name: `${p.part_name || ''} · ทะเบียน/ซื้อนอก`,
                              rank: bomMats.has(norm(p.mat_no)) ? 1 : 3,
                              tag: bomMats.has(norm(p.mat_no)) ? '📦BOMไลน์นี้' : '🗂ทะเบียน' }));
                          return [...real, ...bought];
                        })()}
                        placeholder="พิมพ์เลข MAT หรือชื่อพาร์ทจริง เพื่อค้นหา… (ว่าง = ยังไม่ผูก ยอดนับซ้ำ)"
                        hint="เรียงตามความเกี่ยวข้อง: 🏭ไลน์นี้ → 📦ตาม BOM ของไลน์ → ที่เหลือ · รายการ OP ด้วยกัน + ของที่ปิดใช้งาน ไม่อยู่ในลิสต์โดยตั้งใจ" />
                    </Field>
                    <Field label="ลำดับขั้น (เลข OP ตาม Process Flow เช่น 190, 200 — ไม่รู้ปล่อยว่าง ห้ามเดา)">
                      <input type="number" min="0" value={form.op_seq} onChange={e => setForm(f => ({ ...f, op_seq: e.target.value }))} placeholder="เช่น 190" style={inputSt} />
                    </Field>
                  </div>
                )}
              </div>
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Cycle Time (วินาที)"><input type="number" min="0" step="0.1" value={form.cycle_time_sec} onChange={e => setForm(f => ({ ...f, cycle_time_sec: e.target.value }))} placeholder="เช่น 45.5" style={inputSt} /></Field>
                <Field label="Target ต่อกะ (ชิ้น)"><input type="number" min="0" value={form.target_per_shift} onChange={e => setForm(f => ({ ...f, target_per_shift: e.target.value }))} placeholder="เช่น 500" style={inputSt} /></Field>
              </div>
              <Field label="รูปภาพ Product (แสดงที่ตู้ Kanban)">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {(imageFile ? URL.createObjectURL(imageFile) : form.image_url) && (
                    <img src={imageFile ? URL.createObjectURL(imageFile) : form.image_url} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                  )}
                  <input type="file" accept="image/*" onChange={e => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) setCropFile(f);
                  }} style={{ fontSize: 12, color: 'var(--text2)' }} />
                </div>
              </Field>
              {cropFile && (
                <ImageCropModal file={cropFile} aspect={1} shape="rect" outputSize={480}
                  title="จัดตำแหน่งรูป Product ให้ตรงกรอบ"
                  onCancel={() => setCropFile(null)}
                  onConfirm={f => { setImageFile(f); setCropFile(null); }} />
              )}
              {!ecSource && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                  <span style={{ fontSize: 13, color: 'var(--text)' }}>ใช้งานอยู่</span>
                </label>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => { setEditing(null); setEcSource(null); }} style={btnSecondary}>ยกเลิก</button>
              <button onClick={handleSave} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1, background: ecSource ? '#7c3aed' : undefined }}>
                {saving ? (imageUploading ? 'กำลังอัปโหลดรูป...' : '...') : ecSource ? '🔄 บันทึก EC' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════ Kanban Standard modal ════ */}
      {kanbanEditing && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg3)', border: '1px solid rgba(14,165,233,0.4)', borderRadius: 14, padding: 24, width: 'min(95vw,380px)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 20, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
              {kanbanEditing === 'new' ? '+ เพิ่ม Kanban Standard' : 'แก้ไข Kanban Standard'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="MAT.NO *">
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input autoFocus value={kanbanForm.mat_no} onChange={e => setKanbanForm(f => ({ ...f, mat_no: e.target.value.toUpperCase() }))} placeholder="เช่น 10100335" style={{ ...inputSt, flex: 1, minWidth: 0, fontFamily: 'monospace', fontWeight: 700 }} />
                    <button type="button" onClick={() => setPartsPickFor('kanban')} title="เลือกจากทะเบียนกลาง Parts Master"
                      style={{ ...btnSecondary, padding: '6px 10px', flexShrink: 0 }}>🗂</button>
                  </div>
                  {kanbanForm.mat_no && pmParts.length > 0 && !matInRegistry(kanbanForm.mat_no) && (
                    <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>⚠ ยังไม่มีในทะเบียนกลาง Parts Master</div>
                  )}
                </Field>
                <Field label="Qty / Kanban Card *">
                  <input type="number" min="1" value={kanbanForm.qty_per_kanban} onChange={e => setKanbanForm(f => ({ ...f, qty_per_kanban: e.target.value }))} style={{ ...inputSt, fontSize: 18, fontWeight: 800, textAlign: 'center' }} />
                </Field>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={kanbanForm.is_active} onChange={e => setKanbanForm(f => ({ ...f, is_active: e.target.checked }))} />
                <span style={{ fontSize: 13, color: 'var(--text)' }}>ใช้งานอยู่</span>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => setKanbanEditing(null)} style={btnSecondary}>ยกเลิก</button>
              <button onClick={handleKanbanSave} disabled={kanbanSaving || !kanbanForm.mat_no} style={{ ...btnPrimary, opacity: (kanbanSaving || !kanbanForm.mat_no) ? 0.5 : 1 }}>
                {kanbanSaving ? '...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* picker ทะเบียนกลาง — ลอยเหนือ modal สินค้า/kanban (zIndex 2300) */}
      {partsPickFor && <PartsPickModal parts={pmParts} onPick={handlePartPick} onClose={() => setPartsPickFor(null)} />}
      </>)}

      {mainTab === 'bom'   && <BOMPanel canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} fullName={fullName} />}
      {mainTab === 'packaging' && <PackagingPanel canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} fullName={fullName} />}
      {mainTab === 'parts' && <PartsMasterPanel canCreate={canCreate} canEdit={canEdit} fullName={fullName} setCsvPreview={setCsvPreview} reloadKey={partsReloadKey} />}
      {mainTab === 'kanban' && <KanbanStdPanel canEdit={canEdit} fullName={fullName} />}
      {mainTab === 'routing' && <RoutingPanel canEdit={can('routing','manage',role) || canEdit} lines={lines} />}
      {mainTab === 'export' && <ExportPanel items={items} kanbanStds={kanbanStds} bomCounts={bomCounts} />}

      {/* ════ CSV Preview / Duplicate Detection Modal ════ */}
      {csvPreview && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, width: 'min(600px,100%)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            {/* header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', marginBottom: 8 }}>
                📋 ตรวจสอบข้อมูลก่อนนำเข้า
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>
                  ✅ ใหม่ {csvPreview.newRows.length} รายการ
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
                  ⚠️ ซ้ำ {csvPreview.dupRows.length} รายการ
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>
                  ❌ ไม่สมบูรณ์ {csvPreview.invalidRows.length} รายการ
                </span>
              </div>
            </div>

            {/* overwrite toggle */}
            {csvPreview.dupRows.length > 0 && (
              <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={csvPreview.overwriteAll}
                    onChange={e => setCsvPreview(p => ({ ...p, overwriteAll: e.target.checked }))} />
                  <span style={{ color: 'var(--text)', fontWeight: 600 }}>เขียนทับรายการซ้ำทั้งหมด</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>(ถ้าปิด จะข้ามรายการซ้ำ เว้นแต่เลือกแต่ละรายการด้านล่าง)</span>
                </label>
              </div>
            )}

            {/* scrollable body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* new rows */}
              {csvPreview.newRows.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#22c55e', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>ใหม่ — จะ INSERT</div>
                  {csvPreview.newRows.map((r, i) => (
                    <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', marginBottom: 4, fontSize: 12, display: 'flex', flexWrap: 'wrap', gap: 6, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0ea5e9', flexShrink: 0 }}>{r.mat_no}</span>
                      <span style={{ color: 'var(--text2)' }}>{r.name || r.part_name}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* dup rows */}
              {csvPreview.dupRows.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#f59e0b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>ซ้ำ — จะ UPDATE ถ้าเลือก</div>
                  {csvPreview.dupRows.map((d, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '20px 1fr', columnGap: 8, width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', marginBottom: 6 }}>
                      <input type="checkbox" checked={d.include}
                        onChange={e => setCsvPreview(p => ({ ...p, dupRows: p.dupRows.map((x, xi) => xi === i ? { ...x, include: e.target.checked } : x) }))}
                        style={{ marginTop: 2, cursor: 'pointer' }} />
                      <div style={{ width: '100%', overflow: 'hidden' }}>
                        <div style={{ fontSize: 12, marginBottom: 4 }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0ea5e9' }}>{d.row.mat_no}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, wordBreak: 'break-word' }}>
                          <div>ปัจจุบัน: <span style={{ color: 'var(--text2)' }}>{d.existing?.name || d.existing?.part_name || '—'}</span></div>
                          <div>ใหม่: <span style={{ color: '#f59e0b' }}>{d.row.name || d.row.part_name}</span></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {/* invalid rows */}
              {csvPreview.invalidRows.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#ef4444', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>ไม่สมบูรณ์ — จะถูกข้าม</div>
                  {csvPreview.invalidRows.map((r, i) => (
                    <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', marginBottom: 4, fontSize: 12, color: 'var(--muted)' }}>
                      {r.mat_no || '(ไม่มี mat_no)'} — {r.name || r.part_name || '(ไม่มีชื่อ)'}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* footer */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setCsvPreview(null)} style={btnSecondary}>ยกเลิก</button>
              <button onClick={confirmCsvImport} style={btnPrimary}>
                {(() => {
                  const selectedDups = csvPreview.dupRows.filter(d => csvPreview.overwriteAll || d.include).length;
                  const total = csvPreview.newRows.length + selectedDups;
                  return `นำเข้า ${total} รายการ`;
                })()}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   BOM PANEL — ฝัง tab ใน Product Master
   Add mode: picker จาก parts_master → กรอกแค่ qty_per_unit
   Edit mode: แก้ qty_per_unit / qty_per_pkg ของ bom row
═══════════════════════════════════════════════════════════════ */
const EMPTY_BOM = { qty_per_unit: 1, qty_per_pkg: '', note: '', source_line: '' };

const TH = ({ children, w }) => (
  <th style={{ padding: '8px 10px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', width: w }}>{children}</th>
);
const TD = ({ children, style }) => (
  <td style={{ padding: '8px 10px', fontSize: 13, color: 'var(--text)', borderTop: '1px solid var(--border)', ...style }}>{children}</td>
);

function BOMPanel({ canCreate, canEdit, canDelete, fullName }) {
  const isMobile = useIsMobile(); // ≤768px: two-pane ยุบเป็นคอลัมน์เดียว (desktop ไม่เปลี่ยน)
  const [products, setProducts]     = useState([]);
  const [selProduct, setSelProduct] = useState(null);
  const [items, setItems]           = useState([]);
  const [counts, setCounts]         = useState({});
  const [partsMaster, setPartsMaster] = useState([]);   // catalog กลาง
  const [search, setSearch]         = useState('');
  const [loading, setLoading]       = useState(false);
  const [showPicker, setShowPicker] = useState(false);  // modal เลือกพาร์ท
  const [pickerQ, setPickerQ]       = useState('');     // ค้นหาใน picker
  const [pickerSel, setPickerSel]   = useState([]);     // รายการที่เลือก [{part, qty_per_unit}]
  const [showEdit, setShowEdit]     = useState(false);  // modal แก้ไข bom row
  const [editItem, setEditItem]     = useState(null);
  const [form, setForm]             = useState(EMPTY_BOM);
  const [saving, setSaving]         = useState(false);
  const [showCopyBom, setShowCopyBom] = useState(false);
  const [copySource, setCopySource]   = useState('');
  const [copying, setCopying]         = useState(false);

  const loadAll = useCallback(async () => {
    const [{ data: prods }, { data: boms }, { data: parts }, opMap] = await Promise.all([
      supabaseDR.from('dr_products').select('id, name, code, mat_no, p_no, customer, line_name').eq('is_active', true).order('line_name').order('name'),
      supabaseDR.from('bom_items').select('product_id').eq('is_active', true),
      supabaseDR.from('parts_master').select('*').eq('is_active', true).order('part_name'),
      loadOpInfo(),
    ]);
    // 🔩 รายการขั้นตอน (OP งานขับนัท) ไม่ใช่พาร์ทจริง — ห้ามมี BOM ของตัวเอง จึงไม่โผล่ในลิสต์นี้
    setProducts((prods || []).filter(p => !opMap[p.mat_no]));
    setPartsMaster(parts || []);
    const c = {};
    (boms || []).forEach(b => { c[b.product_id] = (c[b.product_id] || 0) + 1; });
    setCounts(c);
  }, []);

  const loadItems = useCallback(async (productId) => {
    if (!productId) { setItems([]); return; }
    setLoading(true);
    const { data, error } = await supabaseDR.from('bom_items')
      .select('*').eq('product_id', productId).eq('is_active', true).order('mat_no');
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setItems(data || []);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadItems(selProduct?.id); }, [selProduct, loadItems]);

  // picker: filter parts_master
  const pickerFiltered = useMemo(() => {
    const q = pickerQ.trim().toLowerCase();
    const usedMats = new Set(items.map(i => i.mat_no));
    const base = partsMaster.filter(p => !usedMats.has(p.mat_no));   // ซ่อนที่มีใน BOM แล้ว
    if (!q) return base;
    return base.filter(p =>
      p.mat_no.toLowerCase().includes(q) ||
      p.part_name.toLowerCase().includes(q) ||
      (p.part_no || '').toLowerCase().includes(q) ||
      (p.supplier || '').toLowerCase().includes(q));
  }, [partsMaster, pickerQ, items]);

  const togglePick = (part) => setPickerSel(prev => {
    const has = prev.find(x => x.part.id === part.id);
    return has ? prev.filter(x => x.part.id !== part.id) : [...prev, { part, qty_per_unit: 1 }];
  });
  const setPickQty = (partId, qty) => setPickerSel(prev => prev.map(x => x.part.id === partId ? { ...x, qty_per_unit: qty } : x));

  const lineNames = useMemo(() => [...new Set((products || []).map(p => p.line_name).filter(Boolean))].sort(), [products]);

  const openPicker = () => { setPickerQ(''); setPickerSel([]); setShowPicker(true); };
  const openEdit_  = (it) => { setEditItem(it); setForm({ qty_per_unit: it.qty_per_unit, qty_per_pkg: it.qty_per_pkg || '', note: it.note || '', source_line: it.source_line || '' }); setShowEdit(true); };

  const handlePickerSave = async () => {
    if (!pickerSel.length) { toast.error('เลือกพาร์ทอย่างน้อย 1 รายการ'); return; }
    const invalid = pickerSel.find(x => !parseFloat(x.qty_per_unit) || parseFloat(x.qty_per_unit) <= 0);
    if (invalid) { toast.error(`QTY ของ ${invalid.part.part_name} ต้องมากกว่า 0`); return; }
    setSaving(true);
    // re-fetch existing mat_nos to avoid stale state duplicates
    const { data: existing } = await supabaseDR.from('bom_items')
      .select('mat_no').eq('product_id', selProduct.id);
    const usedMats = new Set((existing || []).map(r => r.mat_no));
    const rows = pickerSel
      .filter(x => !usedMats.has(x.part.mat_no))
      .map(x => ({
        product_id:   selProduct.id,
        mat_no:       x.part.mat_no,
        part_name:    x.part.part_name,
        part_no:      x.part.part_no || null,
        qty_per_unit: parseFloat(x.qty_per_unit),
        qty_per_pkg:  x.part.qty_per_pkg || null,
        uom:          x.part.uom || 'pcs',
        supplier:     x.part.supplier || null,
        created_by:   fullName,
        updated_at:   new Date().toISOString(),
        is_active:    true,
      }));
    if (!rows.length) { setSaving(false); toast.info('พาร์ทที่เลือกมีอยู่ใน BOM แล้วทั้งหมด'); return; }
    const { error } = await supabaseDR.from('bom_items').insert(rows);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`เพิ่ม ${rows.length} พาร์ทใน BOM แล้ว`);
    setShowPicker(false);
    loadItems(selProduct.id);
    loadAll();
  };

  const handleEditSave = async () => {
    const qty = parseFloat(form.qty_per_unit);
    if (!qty || qty <= 0) { toast.error('QTY ต้องมากกว่า 0'); return; }
    setSaving(true);
    const { error } = await supabaseDR.from('bom_items').update({
      qty_per_unit: qty,
      qty_per_pkg:  form.qty_per_pkg ? parseFloat(form.qty_per_pkg) : null,
      note:         form.note.trim() || null,
      source_line:  form.source_line.trim() || null,
      updated_at:   new Date().toISOString(),
    }).eq('id', editItem.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('แก้ไขแล้ว');
    setShowEdit(false);
    loadItems(selProduct.id);
  };

  const handleDelete = async (it) => {
    if (!window.confirm(`ลบ ${it.mat_no} · ${it.part_name} ออกจาก BOM?`)) return;
    const { error } = await supabaseDR.from('bom_items').delete().eq('id', it.id);
    if (error) { toast.error(error.message); return; }
    toast.success('ลบพาร์ทแล้ว');
    loadItems(selProduct.id);
    loadAll();
  };

  const handleCopyBom = async () => {
    if (!copySource) { toast.error('เลือก product ต้นฉบับก่อน'); return; }
    setCopying(true);
    try {
      const { data: srcItems, error: e1 } = await supabaseDR.from('bom_items')
        .select('*').eq('product_id', copySource).eq('is_active', true);
      if (e1) throw e1;
      if (!srcItems || srcItems.length === 0) { toast.error('Product ต้นฉบับไม่มีพาร์ทใน BOM'); return; }
      const usedMats = new Set(items.map(i => i.mat_no));
      const toInsert = srcItems
        .filter(i => !usedMats.has(i.mat_no))
        .map(({ id, created_at, ...rest }) => ({
          ...rest,
          product_id: selProduct.id,
          created_by: fullName,
          updated_at: new Date().toISOString(),
        }));
      if (toInsert.length === 0) { toast.info('ทุกพาร์ทมีอยู่ใน BOM นี้แล้ว'); return; }
      const { error: e2 } = await supabaseDR.from('bom_items').insert(toInsert);
      if (e2) throw e2;
      toast.success(`คัดลอก ${toInsert.length} พาร์ทเข้า BOM แล้ว`);
      setShowCopyBom(false);
      setCopySource('');
      loadItems(selProduct.id);
      loadAll();
    } catch(e) { toast.error(e?.message || 'เกิดข้อผิดพลาด'); }
    finally { setCopying(false); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.mat_no || '').toLowerCase().includes(q) ||
      (p.customer || '').toLowerCase().includes(q) ||
      (p.line_name || '').toLowerCase().includes(q));
  }, [products, search]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(240px, 300px) 1fr', gap: 16, alignItems: 'start' }}>
      {/* left: product list */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 12 }}>
        <input style={inputSt} placeholder="🔍 ค้นหา product / mat no. / ลูกค้า..." value={search} onChange={e => setSearch(e.target.value)} />
        <div style={{ marginTop: 10, maxHeight: '65vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(p => {
            const active = selProduct?.id === p.id;
            const n = counts[p.id] || 0;
            return (
              <div key={p.id} onClick={() => setSelProduct(p)} style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer', background: active ? 'rgba(61,214,92,0.1)' : 'var(--bg2)', border: `1px solid ${active ? 'rgba(61,214,92,0.4)' : 'var(--border)'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: active ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 7px', borderRadius: 10, flexShrink: 0, background: n > 0 ? 'rgba(61,214,92,0.15)' : 'rgba(255,255,255,0.06)', color: n > 0 ? 'var(--accent)' : 'var(--muted)' }}>{n > 0 ? `${n} พาร์ท` : 'ยังไม่มี'}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{[p.mat_no, p.line_name, p.customer].filter(Boolean).join(' · ')}</div>
              </div>
            );
          })}
          {filtered.length === 0 && <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>ไม่พบ product</div>}
        </div>
      </div>

      {/* right: BOM detail */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
        {!selProduct ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>← เลือก product เพื่อดู / แก้ไข BOM</div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>{selProduct.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{[selProduct.mat_no && `Mat: ${selProduct.mat_no}`, selProduct.p_no && `P/No: ${selProduct.p_no}`, selProduct.line_name, selProduct.customer].filter(Boolean).join(' · ')}</div>
              </div>
              {canCreate && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={openPicker} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#08130a', fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-body)' }}>+ เพิ่มพาร์ทย่อย</button>
                  <button onClick={() => { setCopySource(''); setShowCopyBom(true); }} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-body)' }}>📋 คัดลอก BOM จาก...</button>
                </div>
              )}
            </div>
            {loading ? (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>กำลังโหลด...</div>
            ) : items.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13, background: 'var(--bg2)', borderRadius: 8, border: '1px dashed var(--border)' }}>
                ยังไม่มีพาร์ทย่อยใน BOM นี้{canCreate && ' — กด "+ เพิ่มพาร์ทย่อย" เพื่อเริ่ม'}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg2)' }}>
                      <TH>Part Name</TH><TH>Part No.</TH><TH>Mat SAP</TH><TH w={90}>ใช้/ชิ้น</TH><TH w={90}>Qty/Pkg</TH><TH w={60}>หน่วย</TH><TH>ผลิตที่ไลน์</TH><TH>Supplier</TH>
                      {(canEdit || canDelete) && <TH w={90}> </TH>}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(it => (
                      <tr key={it.id}>
                        <TD style={{ fontWeight: 600 }}>{it.part_name}</TD>
                        <TD style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text2)' }}>{it.part_no || '—'}</TD>
                        <TD style={{ fontWeight: 700, fontFamily: 'monospace', color: '#0ea5e9' }}>{it.mat_no}</TD>
                        <TD style={{ fontWeight: 800, color: 'var(--accent)', textAlign: 'right' }}>{Number(it.qty_per_unit)}</TD>
                        <TD style={{ fontWeight: 700, color: '#f59e0b', textAlign: 'right' }}>{it.qty_per_pkg ? Number(it.qty_per_pkg) : '—'}</TD>
                        <TD style={{ color: 'var(--muted)' }}>{it.uom}</TD>
                        <TD>{it.source_line
                          ? <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'rgba(59,130,246,0.12)', color: '#3b82f6' }}>🏭 {it.source_line}</span>
                          : <span style={{ color: 'var(--muted)' }}>—</span>}</TD>
                        <TD style={{ color: 'var(--muted)', fontSize: 12 }}>{it.supplier || '—'}</TD>
                        {(canEdit || canDelete) && (
                          <TD>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {canEdit && <button className="tbtn" onClick={() => openEdit_(it)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', cursor: 'pointer', fontSize: 12 }}>✏️</button>}
                              {canDelete && <button className="tbtn" onClick={() => handleDelete(it)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>🗑</button>}
                            </div>
                          </TD>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* ══ PICKER MODAL — เลือกพาร์ทจาก Parts Master ══ */}
      {showPicker && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, width: 'min(700px,100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
            {/* header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', marginBottom: 2 }}>➕ เพิ่มพาร์ทย่อยใน BOM</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{selProduct?.name} · เลือกหลายรายการได้ แล้วกรอก QTY ก่อนกด "เพิ่ม"</div>
            </div>

            {/* search */}
            <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <input autoFocus style={{ ...inputSt, background: 'var(--bg2)' }} placeholder="🔍 ค้นหา Part Name / Mat SAP / Part No. / Supplier..." value={pickerQ} onChange={e => setPickerQ(e.target.value)} />
            </div>

            {/* list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {pickerFiltered.length === 0 && (
                <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                  {partsMaster.length === 0 ? 'ยังไม่มีพาร์ทใน Parts Master — ไปเพิ่มที่ tab 🗂 Parts Master ก่อน' : 'ไม่พบพาร์ทที่ตรงเงื่อนไข'}
                </div>
              )}
              {pickerFiltered.map(p => {
                const sel = pickerSel.find(x => x.part.id === p.id);
                return (
                  <div key={p.id} onClick={() => togglePick(p)} style={{
                    padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                    background: sel ? 'rgba(61,214,92,0.08)' : 'var(--bg2)',
                    border: `1px solid ${sel ? 'rgba(61,214,92,0.45)' : 'var(--border)'}`,
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}>
                    <div style={{ width: 20, height: 20, borderRadius: 4, border: `2px solid ${sel ? 'var(--accent)' : 'var(--border)'}`, background: sel ? 'var(--accent)' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#08130a' }}>{sel ? '✓' : ''}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{p.part_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                        <span style={{ fontFamily: 'monospace', color: '#0ea5e9', fontWeight: 700 }}>{p.mat_no}</span>
                        {p.part_no && <span> · {p.part_no}</span>}
                        {p.supplier && <span> · {p.supplier}</span>}
                        <span> · {p.uom}</span>
                        {p.qty_per_pkg && <span> · {p.qty_per_pkg}/pkg</span>}
                      </div>
                    </div>
                    {sel && (
                      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>QTY/ชิ้น</label>
                        <input type="number" min="0.001" step="any" value={sel.qty_per_unit}
                          onChange={e => setPickQty(p.id, e.target.value)}
                          style={{ ...inputSt, width: 72, textAlign: 'center', fontSize: 14, fontWeight: 800, padding: '4px 8px', background: 'var(--bg)' }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* selected summary + action */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {pickerSel.length > 0
                  ? <span style={{ color: 'var(--accent)', fontWeight: 700 }}>✓ เลือกแล้ว {pickerSel.length} รายการ</span>
                  : 'คลิกพาร์ทเพื่อเลือก'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowPicker(false)} style={btnSecondary}>ยกเลิก</button>
                <button onClick={handlePickerSave} disabled={saving || !pickerSel.length}
                  style={{ ...btnPrimary, opacity: (saving || !pickerSel.length) ? 0.5 : 1 }}>
                  {saving ? '...' : `เพิ่ม ${pickerSel.length || ''} พาร์ท`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ EDIT MODAL — แก้ QTY ของ BOM row ══ */}
      {showEdit && editItem && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(380px,100%)' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', marginBottom: 2 }}>✏️ แก้ไข BOM</div>
            <div style={{ fontSize: 12, color: '#0ea5e9', fontFamily: 'monospace', fontWeight: 700, marginBottom: 4 }}>{editItem.mat_no}</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>{editItem.part_name}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>QTY / ชิ้นงาน *</label>
                <input autoFocus type="number" min="0.001" step="any" style={{ ...inputSt, fontSize: 22, fontWeight: 900, textAlign: 'center' }} value={form.qty_per_unit} onChange={e => setForm(f => ({ ...f, qty_per_unit: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>QTY / Packaging</label>
                <input type="number" min="1" step="any" style={inputSt} value={form.qty_per_pkg} onChange={e => setForm(f => ({ ...f, qty_per_pkg: e.target.value }))} placeholder="จำนวนต่อกล่อง/แพ็ค" />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>ผลิตที่ไลน์ (source line — พาร์ทผลิตเอง 200)</label>
                <input style={inputSt} list="bom-source-lines" value={form.source_line} onChange={e => setForm(f => ({ ...f, source_line: e.target.value }))} placeholder="เว้นว่าง = ของซื้อ/วัตถุดิบ (ดึงจากสโตร์)" />
                <datalist id="bom-source-lines">
                  {lineNames.map(l => <option key={l} value={l} />)}
                </datalist>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>หมายเหตุ</label>
                <input style={inputSt} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button onClick={() => setShowEdit(false)} style={btnSecondary}>ยกเลิก</button>
              <button onClick={handleEditSave} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? '...' : '💾 บันทึก'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ COPY BOM MODAL ══ */}
      {showCopyBom && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(420px,100%)' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', marginBottom: 4 }}>📋 คัดลอก BOM จาก Product อื่น</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
              คัดลอกพาร์ทจาก BOM ของ product ที่เลือก เข้ามาใน <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{selProduct?.name}</span>
              <br/>(พาร์ทที่มีอยู่แล้วจะถูกข้าม)
            </div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>เลือก Product ต้นฉบับ</label>
            <select style={{ ...inputSt, marginBottom: 20 }} value={copySource} onChange={e => setCopySource(e.target.value)}>
              <option value="">— เลือก product —</option>
              {products
                .filter(p => p.id !== selProduct?.id && (counts[p.id] || 0) > 0)
                .map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.customer ? ` [${p.customer}]` : ''}{p.line_name ? ` · ${p.line_name}` : ''} — {counts[p.id]} พาร์ท
                  </option>
                ))}
            </select>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setShowCopyBom(false)} style={btnSecondary}>ยกเลิก</button>
              <button onClick={handleCopyBom} disabled={copying || !copySource} style={{ ...btnPrimary, opacity: (copying || !copySource) ? 0.5 : 1 }}>
                {copying ? '...' : '📋 คัดลอก BOM'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── CSV download helper ─────────────────────────────────────── */
function downloadCsv(filename, headers, rows) {
  const lines = [headers.join(','), ...rows.map(r => headers.map(h => {
    const v = String(r[h] ?? '');
    return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(','))];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

/* ═══════════════════════════════════════════════════════════════
   EXPORT PANEL
═══════════════════════════════════════════════════════════════ */
function ExportPanel({ items, kanbanStds, bomCounts }) {
  const [parts, setParts] = useState([]);
  const [partsLoaded, setPartsLoaded] = useState(false);

  useEffect(() => {
    supabaseDR.from('parts_master').select('*').order('mat_no').then(({ data }) => {
      setParts(data || []);
      setPartsLoaded(true);
    });
  }, []);

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).replace(/-/g, '');

  const exportProducts = () => {
    const headers = ['name','code','mat_no','p_no','customer','line_name','cycle_time_sec','target_per_shift','process_type','is_active'];
    downloadCsv(`products_${today}.csv`, headers, items);
  };

  const exportParts = () => {
    const headers = ['mat_no','part_name','part_no','uom','qty_per_pkg','supplier','note','material_cost','standard_cost','is_active'];
    downloadCsv(`parts_master_${today}.csv`, headers, parts);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>📤 Export ข้อมูล</div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* Products card */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, flex: '1 1 240px', minWidth: 240 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>🔩 Product List</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
            ส่งออก dr_products ทั้งหมด {items.length} รายการ<br />
            Columns: name, code, mat_no, p_no, customer, line_name, cycle_time_sec, target_per_shift, process_type, is_active
          </div>
          <button onClick={exportProducts} style={{ ...btnPrimary, width: '100%', textAlign: 'center' }}>
            ⬇️ ดาวน์โหลด Products.csv
          </button>
        </div>
        {/* Parts card */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, flex: '1 1 240px', minWidth: 240 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>🗂 Parts Master</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
            ส่งออก parts_master {partsLoaded ? `${parts.length} รายการ` : '(กำลังโหลด...)'}<br />
            Columns: mat_no, part_name, part_no, uom, qty_per_pkg, supplier, note, material_cost, standard_cost, is_active
          </div>
          <button onClick={exportParts} disabled={!partsLoaded} style={{ ...btnPrimary, width: '100%', textAlign: 'center', opacity: partsLoaded ? 1 : 0.6 }}>
            ⬇️ ดาวน์โหลด Parts.csv
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PARTS MASTER PANEL — ฐานข้อมูลกลางของพาร์ทย่อย
   ประเภทพาร์ทแยกด้วย "เลขตัวแรก" ของ MAT SAP — นิยามอยู่ที่ src/utils/matPrefix.js
   (1=FG · 2=Child ผลิตเอง · 3=Child ซื้อนอก · 5=Raw · 9=เลขภายใน)
   ⚠️ ห้ามกลับไปเทียบ 3 ตัวแรก — เลข FG รันทะลุ 100xxxxx ไปเป็น 101xxxxx แล้ว
═══════════════════════════════════════════════════════════════ */
const EMPTY_PART = {
  mat_no: '', part_name: '', part_no: '', uom: 'EA',
  qty_per_pkg: '', supplier: '', note: '', is_active: true, image_url: '',
  // ต้นทุน/ชิ้น (cost saving ใน /improvements · 2026-08-11): standard_cost (บช. รวม mat+DL+OH+DP) ชนะ material_cost เสมอ
  material_cost: '', standard_cost: '',
};

const MAT_PREFIXES = MAT_CLASSES.map(c => ({ prefix: c.digit, label: `${c.digit}xxxxxxx — ${c.label}`, color: c.color }));

function PartsMasterPanel({ canCreate, canEdit, fullName, setCsvPreview, reloadKey }) {
  const [parts, setParts]         = useState([]);
  const [search, setSearch]       = useState('');
  const [prefixFilter, setPFilter] = useState('');
  const [loading, setLoading]     = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editPart, setEditPart]   = useState(null);
  const [form, setForm]           = useState(EMPTY_PART);
  const [saving, setSaving]       = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [cropFile, setCropFile] = useState(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [csvImporting, setCsvImporting] = useState(false);
  const csvRef = useRef(null);

  // material_cost/standard_cost (บาท/ชิ้น — cost saving ใน /improvements): ไฟล์เก่าที่ไม่มี 2 คอลัมน์นี้ยังนำเข้าได้
  // และจะไม่ล้างค่าต้นทุนเดิม (อัพเดทเฉพาะฟิลด์ที่มีค่าในไฟล์)
  const PARTS_CSV_HEADER = 'mat_no,part_name,part_no,uom,qty_per_pkg,supplier,note,material_cost,standard_cost';
  const PARTS_CSV_EXAMPLE = [
    'EXAMPLE-300001234,[ตัวอย่าง-ลบแถวนี้ก่อนนำเข้าจริง] NUT WELD M8,NW-M8-001,EA,500,THAI SUMMIT PARTS,สำหรับ APRON ASSY,0.85,1.2',
    'EXAMPLE-500009876,[ตัวอย่าง-ลบแถวนี้ก่อนนำเข้าจริง] STEEL PLATE 1.0MM,SP-1.0-A,KG,,ABC STEEL,,32.5,',
  ].join('\n');

  const downloadPartsTemplate = () => {
    const content = `﻿${PARTS_CSV_HEADER}\n${PARTS_CSV_EXAMPLE}`;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'parts_master_template.csv'; a.click();
  };

  const handlePartsCsvUpload = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setCsvImporting(true);
    const text = await file.text();
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
    const header = lines[0].split(',').map(h => h.trim().replace(/^﻿/, ''));
    const allRows = lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const obj = {};
      header.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
      return obj;
    });
    setCsvImporting(false);

    if (!allRows.length) { toast.error('ไม่พบข้อมูลในไฟล์ หรือ format ไม่ถูกต้อง'); return; }

    const exampleCount = allRows.filter(r => r.mat_no?.startsWith('EXAMPLE-')).length;
    const rows = allRows.filter(r => !r.mat_no?.startsWith('EXAMPLE-'));
    if (exampleCount) toast.info(`ข้ามแถวตัวอย่าง ${exampleCount} รายการอัตโนมัติ`);
    if (!rows.length) { toast.error('ไม่พบข้อมูลจริงในไฟล์ (มีแต่แถวตัวอย่าง)'); return; }

    const existingMatNos = new Set(parts.map(p => p.mat_no).filter(Boolean));
    const newRows = [], dupRows = [], invalidRows = [];
    rows.forEach(r => {
      if (!r.part_name || !r.mat_no) { invalidRows.push(r); return; }
      if (existingMatNos.has(r.mat_no)) {
        const existing = parts.find(p => p.mat_no === r.mat_no);
        dupRows.push({ row: r, existing, include: true });
      } else {
        newRows.push(r);
      }
    });
    setCsvPreview({ type: 'parts', newRows, dupRows, invalidRows, overwriteAll: false });
  };

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabaseDR.from('parts_master').select('*').order('mat_no');
    setParts(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let r = parts;
    if (prefixFilter) r = r.filter(p => matMatches(p.mat_no, prefixFilter));
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(p =>
        p.part_name?.toLowerCase().includes(q) ||
        p.mat_no?.toLowerCase().includes(q) ||
        p.part_no?.toLowerCase().includes(q) ||
        p.supplier?.toLowerCase().includes(q)
      );
    }
    return r;
  }, [parts, search, prefixFilter]);

  function openNew() { setEditPart(null); setForm(EMPTY_PART); setImageFile(null); setShowModal(true); }
  function openEdit(p) { setEditPart(p); setForm({ ...EMPTY_PART, ...p }); setImageFile(null); setShowModal(true); }

  async function handleSave() {
    if (!form.mat_no.trim() || !form.part_name.trim()) { toast.error('กรอก Mat SAP และ Part Name'); return; }
    setSaving(true);
    try {
      let imageUrl = form.image_url || null;
      if (imageFile) {
        setImageUploading(true);
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabaseDR.storage.from('product-images').upload(fileName, imageFile);
        setImageUploading(false);
        if (uploadError) { toast.error(`อัปโหลดรูปไม่สำเร็จ: ${uploadError.message}`); return; }
        const { data: pub } = supabaseDR.storage.from('product-images').getPublicUrl(fileName);
        imageUrl = pub.publicUrl;
      }
      const payload = {
        mat_no: form.mat_no.trim(), part_name: form.part_name.trim(),
        part_no: (form.part_no || '').trim() || null, uom: (form.uom || '').trim() || 'EA',
        qty_per_pkg: form.qty_per_pkg !== '' ? Number(form.qty_per_pkg) : null,
        supplier: (form.supplier || '').trim() || null, note: (form.note || '').trim() || null,
        is_active: form.is_active, image_url: imageUrl,
        material_cost: form.material_cost !== '' && form.material_cost != null ? Number(form.material_cost) : null,
        standard_cost: form.standard_cost !== '' && form.standard_cost != null ? Number(form.standard_cost) : null,
      };
      let err;
      if (editPart) {
        ({ error: err } = await supabaseDR.from('parts_master').update(payload).eq('id', editPart.id));
      } else {
        ({ error: err } = await supabaseDR.from('parts_master').insert(payload));
      }
      if (err) { toast.error(err.message); return; }
      // อัปโหลดรูปใหม่ + DB update สำเร็จแล้ว ค่อยลบไฟล์รูปเดิมทิ้ง กันไฟล์กำพร้าใน storage (best-effort)
      if (imageFile && editPart?.image_url && editPart.image_url !== imageUrl && editPart.image_url.includes('/product-images/')) {
        const stillUsed = parts.some(p => p.id !== editPart.id && p.image_url === editPart.image_url);
        const oldPath = decodeURIComponent(editPart.image_url.split('/product-images/')[1] || '');
        if (!stillUsed && oldPath) {
          // URL รูปแชร์ข้ามตารางกับ dr_products ได้ (backfill/sync 2026-08-06) — เช็คฝั่ง product ก่อนลบไฟล์เสมอ
          supabaseDR.from('dr_products').select('id', { count: 'exact', head: true }).eq('image_url', editPart.image_url)
            .then(({ count }) => { if (!count) supabaseDR.storage.from('product-images').remove([oldPath]).catch(() => {}); });
        }
      }
      // ทะเบียนกลางเป็นเจ้าของรูป — เติมให้ product ของ mat เดียวกันที่ยังไม่มีรูป (ไม่ทับรูปที่ product ตั้งไว้เอง)
      if (imageFile && imageUrl && payload.mat_no) {
        const { data: dps } = await supabaseDR.from('dr_products').select('id, image_url').eq('mat_no', payload.mat_no);
        const emptyIds = (dps || []).filter(d => !d.image_url).map(d => d.id);
        if (emptyIds.length) await supabaseDR.from('dr_products').update({ image_url: imageUrl }).in('id', emptyIds);
      }
      toast.success(editPart ? 'อัปเดตสำเร็จ' : 'เพิ่มพาร์ทสำเร็จ');
      setShowModal(false);
      load();
    } catch (err) {
      toast.error('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
      setSaving(false);
      setImageUploading(false);
    }
  }

  async function toggleActive(p) {
    // ยืนยันเฉพาะตอน "ปิดใช้งาน" พาร์ท — เปิดกลับไม่ต้องถาม
    if (p.is_active && !confirm(`ปิดใช้งานพาร์ท "${p.part_no || p.mat_no || ''}" ?\n\nจะหายจากการเลือกใช้ (ข้อมูลเดิมยังอยู่ เปิดกลับได้)`)) return;
    await supabaseDR.from('parts_master').update({ is_active: !p.is_active }).eq('id', p.id);
    load();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* legend */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '10px 14px', background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)', fontSize: 11 }}>
        {MAT_PREFIXES.map(m => (
          <span key={m.prefix} style={{ padding: '2px 10px', borderRadius: 12, background: `${m.color}22`, color: m.color, fontWeight: 700, fontFamily: 'monospace' }}>{m.label}</span>
        ))}
      </div>

      {/* toolbar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...inputSt, flex: 1, minWidth: 200, background: 'var(--bg2)' }}
          placeholder="🔍 ค้นหา Part Name / Mat SAP / Part No. / Supplier..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <select style={{ ...inputSt, width: 'auto', background: 'var(--bg2)' }}
          value={prefixFilter} onChange={e => setPFilter(e.target.value)}>
          <option value="">ทุกประเภท</option>
          {MAT_PREFIXES.map(m => <option key={m.prefix} value={m.prefix}>{m.label}</option>)}
        </select>
        {canCreate && <>
          <button onClick={downloadPartsTemplate} style={{ ...btnSecondary, fontSize: 12 }}>⬇️ CSV Template</button>
          <button onClick={() => csvRef.current?.click()} disabled={csvImporting}
            style={{ ...btnSecondary, fontSize: 12, opacity: csvImporting ? 0.6 : 1 }}>
            {csvImporting ? '⏳ กำลังนำเข้า...' : '⬆️ นำเข้า CSV'}
          </button>
          <input ref={csvRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handlePartsCsvUpload} />
          <button onClick={openNew} style={btnPrimary}>➕ เพิ่มพาร์ท</button>
        </>}
      </div>

      {loading && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 30 }}>⏳ กำลังโหลด...</div>}

      {/* table */}
      {!loading && (
        <div className="table-sticky" style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead style={{ background: 'var(--bg2)' }}>
              <tr>
                <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left' }}></th>
                <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' }}>Mat SAP</th>
                <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left' }}>ชื่อพาร์ท</th>
                <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left' }}>Part No.</th>
                <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left' }}>UOM</th>
                <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'right' }}>Qty/Pkg</th>
                <th title="Material Cost บาท/ชิ้น (raw mat)" style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>Mat ฿</th>
                <th title="Standard Cost บาท/ชิ้น จากบัญชี (รวม mat+DL+OH+DP) — ใช้คิด cost saving" style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>Std ฿</th>
                <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left' }}>Supplier</th>
                <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'center' }}>สถานะ</th>
                {canEdit && <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)' }}></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={canEdit ? 11 : 10} style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                  {parts.length === 0 ? 'ยังไม่มีข้อมูล — กด ➕ เพิ่มพาร์ท เพื่อเริ่มต้น' : 'ไม่พบรายการที่ตรงเงื่อนไข'}
                </td></tr>
              )}
              {filtered.map(p => (
                <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.45, background: 'var(--card)' }}>
                  <td style={{ padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
                    {p.image_url
                      ? <img src={p.image_url} alt="" loading="lazy" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                      : <div style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--bg2)', border: '1px solid var(--border)' }} />
                    }
                  </td>
                  <td style={{ padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 800, color: matColor(p.mat_no) }}>{p.mat_no}</span>
                      {matClassOf(p.mat_no) && <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, background: `${matColor(p.mat_no)}22`, color: matColor(p.mat_no), fontWeight: 700 }}>{matLabel(p.mat_no)}</span>}
                    </div>
                  </td>
                  <td style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text)', fontWeight: 600, borderTop: '1px solid var(--border)' }}>{p.part_name}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text2)', fontFamily: 'monospace', borderTop: '1px solid var(--border)' }}>{p.part_no || '-'}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>{p.uom}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text2)', textAlign: 'right', fontFamily: 'monospace', borderTop: '1px solid var(--border)' }}>{p.qty_per_pkg ?? '-'}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text2)', textAlign: 'right', fontFamily: 'monospace', borderTop: '1px solid var(--border)' }}>{p.material_cost != null ? Number(p.material_cost).toLocaleString() : '-'}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: p.standard_cost != null ? 'var(--accent)' : 'var(--text2)', fontWeight: p.standard_cost != null ? 700 : 400, textAlign: 'right', fontFamily: 'monospace', borderTop: '1px solid var(--border)' }}>{p.standard_cost != null ? Number(p.standard_cost).toLocaleString() : '-'}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text2)', borderTop: '1px solid var(--border)' }}>{p.supplier || '-'}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, fontWeight: 700, background: p.is_active ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: p.is_active ? '#22c55e' : '#ef4444' }}>
                      {p.is_active ? 'ใช้งาน' : 'ปิดใช้'}
                    </span>
                  </td>
                  {canEdit && (
                    <td style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="tbtn" onClick={() => openEdit(p)} style={{ ...btnSecondary, padding: '4px 10px', fontSize: 12 }}>✏️</button>
                        <button onClick={() => toggleActive(p)} title={p.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                          style={{ ...btnSecondary, padding: '4px 10px', fontSize: 12, color: p.is_active ? '#ef4444' : '#22c55e' }}>
                          {p.is_active ? '🚫' : '✅'}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
        แสดง {filtered.length} / {parts.length} รายการ
      </div>

      {/* ══ ADD / EDIT MODAL ══ */}
      {showModal && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(560px,100%)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', marginBottom: 16 }}>
              {editPart ? '✏️ แก้ไขพาร์ท' : '➕ เพิ่มพาร์ทใหม่'}
            </div>

            {/* prefix hint */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {MAT_PREFIXES.map(m => (
                <button key={m.prefix} onClick={() => setForm(f => ({ ...f, mat_no: f.mat_no.startsWith(m.prefix) ? f.mat_no : m.prefix }))}
                  style={{ fontSize: 11, padding: '2px 10px', borderRadius: 10, border: `1px solid ${m.color}`, background: form.mat_no.startsWith(m.prefix) ? `${m.color}22` : 'transparent', color: m.color, cursor: 'pointer', fontWeight: 700 }}>
                  {m.prefix}…
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Mat SAP *</label>
                  <input style={{ ...inputSt, fontFamily: 'monospace', color: matColor(form.mat_no) }}
                    value={form.mat_no} onChange={e => setForm(f => ({ ...f, mat_no: e.target.value }))}
                    placeholder="เช่น 300001234" />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Part No.</label>
                  <input style={{ ...inputSt, fontFamily: 'monospace' }}
                    value={form.part_no} onChange={e => setForm(f => ({ ...f, part_no: e.target.value }))}
                    placeholder="Drawing / Internal No." />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Part Name *</label>
                <input autoFocus={!editPart} style={inputSt}
                  value={form.part_name} onChange={e => setForm(f => ({ ...f, part_name: e.target.value }))}
                  placeholder="ชื่อพาร์ท" />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>รูปภาพพาร์ท</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {(imageFile ? URL.createObjectURL(imageFile) : form.image_url) && (
                    <img src={imageFile ? URL.createObjectURL(imageFile) : form.image_url} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                  )}
                  <input type="file" accept="image/*" onChange={e => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) setCropFile(f);
                  }} style={{ fontSize: 12, color: 'var(--text2)' }} />
                </div>
              </div>
              {cropFile && (
                <ImageCropModal file={cropFile} aspect={1} shape="rect" outputSize={480}
                  title="จัดตำแหน่งรูปพาร์ทให้ตรงกรอบ"
                  onCancel={() => setCropFile(null)}
                  onConfirm={f => { setImageFile(f); setCropFile(null); }} />
              )}
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>UOM</label>
                  <select style={inputSt} value={form.uom} onChange={e => setForm(f => ({ ...f, uom: e.target.value }))}>
                    {['EA', 'PC', 'KG', 'M', 'SET', 'BOX', 'ROLL'].map(u => <option key={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Qty / Packaging</label>
                  <input type="number" min="1" step="any" style={inputSt}
                    value={form.qty_per_pkg} onChange={e => setForm(f => ({ ...f, qty_per_pkg: e.target.value }))}
                    placeholder="จำนวนต่อกล่อง" />
                </div>
              </div>
              {/* ต้นทุน/ชิ้น — ใช้คิด cost saving ของเสียใน /improvements (standard ชนะ material เสมอ) */}
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Material Cost (บาท/ชิ้น)</label>
                  <input type="number" min="0" step="any" style={inputSt}
                    value={form.material_cost ?? ''} onChange={e => setForm(f => ({ ...f, material_cost: e.target.value }))}
                    placeholder="ต้นทุนวัตถุดิบ (raw mat)" />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Standard Cost (บาท/ชิ้น)</label>
                  <input type="number" min="0" step="any" style={inputSt}
                    value={form.standard_cost ?? ''} onChange={e => setForm(f => ({ ...f, standard_cost: e.target.value }))}
                    placeholder="จากบัญชี (รวม mat+DL+OH+DP)" />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Supplier</label>
                <input style={inputSt}
                  value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))}
                  placeholder="ชื่อ Supplier / ผู้ผลิต" />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>หมายเหตุ</label>
                <input style={inputSt}
                  value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                เปิดใช้งาน
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setShowModal(false)} style={btnSecondary}>ยกเลิก</button>
              <button onClick={handleSave} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? (imageUploading ? 'กำลังอัปโหลดรูป...' : '...') : '💾 บันทึก'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   PANEL: KANBAN STD
   ใช้ parts_master เป็นแหล่งข้อมูลเดียวสำหรับ UOM (ไม่เก็บ uom ซ้ำใน kanban_standards)
   qty_per_kanban เริ่มต้น = parts_master.qty_per_pkg (1 ใบ Kanban = 1 packaging)
   ───────────────────────────────────────────────────────────────────────────── */
const EMPTY_KBS = { mat_no: '', qty_per_kanban: '', min_qty: '', max_qty: '', lot_size: '' };

/* ─────────────────────────────────────────────────────────────────────────────
   PANEL: PACKAGING — master กล่อง/พาเลท + link ต่อ product (เบิกจาก Rack Center)
   ───────────────────────────────────────────────────────────────────────────── */
const EMPTY_PKG_LINK = { packaging_code: '', packaging_name: '', pcs_per_pkg: 1, note: '' };
const PKG_CATEGORIES = ['BOX', 'RACK', 'BASKET', 'PALLETTE', 'Other'];
const EMPTY_PKG_MASTER = { code: '', name: '', category: 'BOX', supplier: '' };
const cardSt = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16 };

function PackagingPanel({ canCreate, canEdit, canDelete, fullName }) {
  const isMobile = useIsMobile(); // ≤768px: two-pane ยุบเป็นคอลัมน์เดียว (desktop ไม่เปลี่ยน)
  const [products, setProducts]   = useState([]);
  const [selProduct, setSelProduct] = useState(null);
  const [links, setLinks]         = useState([]);
  const [counts, setCounts]       = useState({});
  const [masters, setMasters]     = useState([]);
  const [search, setSearch]       = useState('');
  const [loading, setLoading]     = useState(false);
  const [showLink, setShowLink]   = useState(false);
  const [editLink, setEditLink]   = useState(null);
  const [linkForm, setLinkForm]   = useState(EMPTY_PKG_LINK);
  const [showMaster, setShowMaster] = useState(false);
  const [masterForm, setMasterForm] = useState(EMPTY_PKG_MASTER);
  const [editMaster, setEditMaster] = useState(null);
  const [saving, setSaving]       = useState(false);

  const loadAll = useCallback(async () => {
    const [{ data: prods }, { data: lk }, { data: ms }] = await Promise.all([
      supabaseDR.from('dr_products').select('id, name, mat_no, line_name').eq('is_active', true).order('line_name').order('name'),
      supabaseDR.from('product_packaging').select('product_id').eq('is_active', true),
      supabaseDR.from('container_types').select('*').eq('is_active', true).order('code'),
    ]);
    setProducts(prods || []); setMasters(ms || []);
    const c = {}; (lk || []).forEach(r => { c[r.product_id] = (c[r.product_id] || 0) + 1; }); setCounts(c);
  }, []);
  const loadLinks = useCallback(async (pid) => {
    if (!pid) { setLinks([]); return; }
    setLoading(true);
    const { data } = await supabaseDR.from('product_packaging').select('*').eq('product_id', pid).eq('is_active', true).order('packaging_code');
    setLoading(false); setLinks(data || []);
  }, []);
  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadLinks(selProduct?.id); }, [selProduct, loadLinks]);

  const openAddLink  = () => { setEditLink(null); setLinkForm(EMPTY_PKG_LINK); setShowLink(true); };
  const openEditLink = (it) => { setEditLink(it); setLinkForm({ packaging_code: it.packaging_code, packaging_name: it.packaging_name || '', pcs_per_pkg: it.pcs_per_pkg, note: it.note || '' }); setShowLink(true); };
  const saveLink = async () => {
    if (!linkForm.packaging_code) { toast.error('เลือก packaging ก่อน'); return; }
    const pcs = parseInt(linkForm.pcs_per_pkg);
    if (!pcs || pcs < 1) { toast.error('จำนวนชิ้น/บรรจุภัณฑ์ ต้อง ≥ 1'); return; }
    setSaving(true);
    const payload = { packaging_code: linkForm.packaging_code, packaging_name: linkForm.packaging_name || masters.find(m => m.code === linkForm.packaging_code)?.name || null, pcs_per_pkg: pcs, note: linkForm.note.trim() || null };
    const { error } = editLink
      ? await supabaseDR.from('product_packaging').update(payload).eq('id', editLink.id)
      : await supabaseDR.from('product_packaging').insert({ ...payload, product_id: selProduct.id, created_by: fullName });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editLink ? 'แก้ไขแล้ว' : 'ผูก packaging แล้ว'); setShowLink(false); loadLinks(selProduct.id); loadAll();
  };
  const delLink = async (it) => { if (!window.confirm(`ลบ ${it.packaging_code} ออกจาก product นี้?`)) return; await supabaseDR.from('product_packaging').update({ is_active: false }).eq('id', it.id); loadLinks(selProduct.id); loadAll(); };

  const saveMaster = async () => {
    if (!masterForm.code.trim() || !masterForm.name.trim()) { toast.error('กรอก code + ชื่อ'); return; }
    setSaving(true);
    const payload = { code: masterForm.code.trim().toUpperCase(), name: masterForm.name.trim(), category: masterForm.category || null, supplier: masterForm.supplier.trim() || null };
    const { error } = editMaster
      ? await supabaseDR.from('container_types').update(payload).eq('id', editMaster.id)
      : await supabaseDR.from('container_types').insert({ ...payload, is_active: true });
    setSaving(false);
    if (error) { toast.error(error.code === '23505' ? `code ${payload.code} ซ้ำ` : error.message); return; }
    toast.success('บันทึกภาชนะแล้ว'); setMasterForm(EMPTY_PKG_MASTER); setEditMaster(null); loadAll();
  };
  const delMaster = async (m) => { if (!window.confirm(`ลบ ${m.code}?`)) return; await supabaseDR.from('container_types').update({ is_active: false }).eq('id', m.id); loadAll(); };

  const filtered = useMemo(() => { const q = search.trim().toLowerCase(); if (!q) return products; return products.filter(p => (p.name || '').toLowerCase().includes(q) || (p.mat_no || '').toLowerCase().includes(q) || (p.line_name || '').toLowerCase().includes(q)); }, [products, search]);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'clamp(16px,2vw,20px)', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>📦 Packaging</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>ผูกภาชนะกับ product · พอ FG ผลิต → ยิงใบเบิกภาชนะไป Rack Center อัตโนมัติ · ใช้ฐานภาชนะเดียวกับ Rack Center</p>
        </div>
        {canEdit && <button onClick={() => setShowMaster(true)} style={{ ...btnSecondary }}>🗃 จัดการภาชนะ (Container Types) ({masters.length})</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(240px, 320px) 1fr', gap: 16, alignItems: 'start' }}>
        {/* product list */}
        <div style={{ ...cardSt, padding: 12 }}>
          <input style={inputSt} placeholder="🔍 ค้นหา product..." value={search} onChange={e => setSearch(e.target.value)} />
          <div style={{ marginTop: 10, maxHeight: '70vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map(p => {
              const active = selProduct?.id === p.id; const n = counts[p.id] || 0;
              return (
                <div key={p.id} onClick={() => setSelProduct(p)} style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer', background: active ? 'rgba(61,214,92,0.1)' : 'var(--bg2)', border: `1px solid ${active ? 'rgba(61,214,92,0.4)' : 'var(--border)'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: active ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 7px', borderRadius: 10, flexShrink: 0, background: n > 0 ? 'rgba(61,214,92,0.15)' : 'rgba(255,255,255,0.06)', color: n > 0 ? 'var(--accent)' : 'var(--muted)' }}>{n > 0 ? `${n} pkg` : 'ยังไม่ผูก'}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{[p.mat_no, p.line_name].filter(Boolean).join(' · ')}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* links */}
        <div style={cardSt}>
          {!selProduct ? (
            <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>← เลือก product เพื่อผูก packaging</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{selProduct.name}</div>
                {canCreate && <button onClick={openAddLink} style={{ ...btnPrimary }}>+ ผูก Packaging</button>}
              </div>
              {loading ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>กำลังโหลด...</div>
                : links.length === 0 ? <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13, background: 'var(--bg2)', borderRadius: 8, border: '1px dashed var(--border)' }}>ยังไม่ผูก packaging{canCreate && ' — กด "+ ผูก Packaging"'}</div>
                : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ background: 'var(--bg2)' }}><TH>Code</TH><TH>ชื่อ</TH><TH w={140}>ชิ้น/บรรจุภัณฑ์</TH><TH>หมายเหตุ</TH>{(canEdit || canDelete) && <TH w={90}> </TH>}</tr></thead>
                    <tbody>
                      {links.map(it => (
                        <tr key={it.id}>
                          <TD style={{ fontFamily: 'monospace', fontWeight: 700, color: '#f59e0b' }}>{it.packaging_code}</TD>
                          <TD>{it.packaging_name || '—'}</TD>
                          <TD style={{ fontWeight: 800, color: 'var(--accent)' }}>{it.pcs_per_pkg}</TD>
                          <TD style={{ color: 'var(--muted)', fontSize: 12 }}>{it.note || '—'}</TD>
                          {(canEdit || canDelete) && <TD><div style={{ display: 'flex', gap: 6 }}>
                            {canEdit && <button className="tbtn" onClick={() => openEditLink(it)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', cursor: 'pointer', fontSize: 12 }}>✏️</button>}
                            {canDelete && <button className="tbtn" onClick={() => delLink(it)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>🗑</button>}
                          </div></TD>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </>
          )}
        </div>
      </div>

      {/* link modal */}
      {showLink && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(420px,100%)' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 16, fontFamily: 'var(--font-display)' }}>{editLink ? '✏️ แก้ไข' : '➕ ผูก'} Packaging</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>ภาชนะ *</label>
                <select style={inputSt} value={linkForm.packaging_code} disabled={!!editLink}
                  onChange={e => { const m = masters.find(x => x.code === e.target.value); setLinkForm(f => ({ ...f, packaging_code: e.target.value, packaging_name: m?.name || '' })); }}>
                  <option value="">— เลือกภาชนะ (Container Types) —</option>
                  {masters.map(m => <option key={m.id} value={m.code}>{m.code} · {m.name}{m.category ? ` (${m.category})` : ''}</option>)}
                </select>
                {masters.length === 0 && <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>ยังไม่มีภาชนะ — กด "🗃 จัดการภาชนะ" เพิ่มก่อน</div>}
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>จำนวนชิ้น FG ต่อ 1 บรรจุภัณฑ์ *</label>
                <input type="number" min="1" step="1" style={{ ...inputSt, textAlign: 'center', fontWeight: 900, fontSize: 16 }} value={linkForm.pcs_per_pkg} onChange={e => setLinkForm(f => ({ ...f, pcs_per_pkg: e.target.value }))} />
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>เช่น 100 = 1 กล่องใส่ได้ 100 ชิ้น → ผลิต 200 ชิ้น เบิก 2 กล่อง</div>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>หมายเหตุ</label>
                <input style={inputSt} value={linkForm.note} onChange={e => setLinkForm(f => ({ ...f, note: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button onClick={() => setShowLink(false)} style={btnSecondary}>ยกเลิก</button>
              <button onClick={saveLink} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? '...' : '💾 บันทึก'}</button>
            </div>
          </div>
        </div>
      )}

      {/* master manager modal — ภาชนะ (container_types) ฐานเดียวกับ Rack Center */}
      {showMaster && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(760px,100%)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 4, fontFamily: 'var(--font-display)' }}>🗃 ภาชนะ (Container Types)</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>ฐานข้อมูลเดียวกับที่ Rack Center ใช้</div>
            {canEdit && (
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr 1fr auto', gap: 8, alignItems: 'end', marginBottom: 14 }}>
                <div><label style={{ fontSize: 11, color: 'var(--muted)' }}>Code *</label><input style={inputSt} value={masterForm.code} onChange={e => setMasterForm(f => ({ ...f, code: e.target.value }))} placeholder="BOX-A" /></div>
                <div><label style={{ fontSize: 11, color: 'var(--muted)' }}>ชื่อ *</label><input style={inputSt} value={masterForm.name} onChange={e => setMasterForm(f => ({ ...f, name: e.target.value }))} /></div>
                <div><label style={{ fontSize: 11, color: 'var(--muted)' }}>ประเภท</label>
                  <select style={inputSt} value={masterForm.category} onChange={e => setMasterForm(f => ({ ...f, category: e.target.value }))}>
                    {PKG_CATEGORIES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select></div>
                <div><label style={{ fontSize: 11, color: 'var(--muted)' }}>Supplier</label><input style={inputSt} value={masterForm.supplier} onChange={e => setMasterForm(f => ({ ...f, supplier: e.target.value }))} /></div>
                <button onClick={saveMaster} disabled={saving} style={{ ...btnPrimary, padding: '8px 14px' }}>{editMaster ? '💾' : '+'}</button>
              </div>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: 'var(--bg2)' }}><TH>Code</TH><TH>ชื่อ</TH><TH>ประเภท</TH><TH>Supplier</TH>{canEdit && <TH w={80}> </TH>}</tr></thead>
              <tbody>
                {masters.length === 0 && <tr><td colSpan={canEdit ? 5 : 4} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีภาชนะ</td></tr>}
                {masters.map(m => (
                  <tr key={m.id}>
                    <TD style={{ fontFamily: 'monospace', fontWeight: 700, color: '#f59e0b' }}>{m.code}</TD>
                    <TD>{m.name}</TD><TD style={{ color: 'var(--muted)' }}>{m.category || '—'}</TD>
                    <TD style={{ color: 'var(--muted)' }}>{m.supplier || '—'}</TD>
                    {canEdit && <TD><div style={{ display: 'flex', gap: 6 }}>
                      <button className="tbtn" onClick={() => { setEditMaster(m); setMasterForm({ code: m.code, name: m.name, category: m.category || 'BOX', supplier: m.supplier || '' }); }} style={{ padding: '3px 7px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', cursor: 'pointer', fontSize: 11 }}>✏️</button>
                      <button className="tbtn" onClick={() => delMaster(m)} style={{ padding: '3px 7px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', cursor: 'pointer', fontSize: 11 }}>🗑</button>
                    </div></TD>}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => { setShowMaster(false); setEditMaster(null); setMasterForm(EMPTY_PKG_MASTER); }} style={btnSecondary}>ปิด</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function KanbanStdPanel({ canEdit, fullName }) {
  const [parts,     setParts]     = useState([]);
  const [standards, setStandards] = useState([]);
  const [search,    setSearch]    = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form,      setForm]      = useState(EMPTY_KBS);
  const [saving,    setSaving]    = useState(false);

  const load = useCallback(async () => {
    const [{ data: pm }, { data: ks }] = await Promise.all([
      supabaseDR.from('parts_master').select('mat_no, part_name, uom, qty_per_pkg, supplier').eq('is_active', true).order('mat_no'),
      supabaseDR.from('kanban_standards').select('*').eq('is_active', true),
    ]);
    setParts(pm || []);
    setStandards(ks || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const merged = useMemo(() => {
    const ksMap = {};
    standards.forEach(s => { ksMap[s.mat_no] = s; });
    return parts.map(p => ({ ...p, ks: ksMap[p.mat_no] || null }));
  }, [parts, standards]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return merged;
    return merged.filter(r => r.mat_no.includes(q) || (r.part_name || '').toUpperCase().includes(q) || (r.supplier || '').toUpperCase().includes(q));
  }, [merged, search]);

  const openEdit = (row) => {
    setForm({
      mat_no: row.mat_no,
      qty_per_kanban: row.ks ? String(row.ks.qty_per_kanban) : (row.qty_per_pkg != null ? String(row.qty_per_pkg) : ''),
      min_qty: row.ks?.min_qty != null ? String(row.ks.min_qty) : '',
      max_qty: row.ks?.max_qty != null ? String(row.ks.max_qty) : '',
      lot_size: row.ks?.lot_size != null ? String(row.ks.lot_size) : '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.mat_no.trim()) { toast.error('กรอก Mat No.'); return; }
    const qty = parseFloat(form.qty_per_kanban);
    if (!qty || qty <= 0) { toast.error('กรอก Qty/Kanban ให้ถูกต้อง'); return; }
    const minQ = form.min_qty === '' ? null : parseInt(form.min_qty);
    const maxQ = form.max_qty === '' ? null : parseInt(form.max_qty);
    if (minQ != null && maxQ != null && maxQ < minQ) { toast.error('Max ต้อง ≥ Min'); return; }
    setSaving(true);
    const { error } = await supabaseDR.from('kanban_standards').upsert({
      mat_no: form.mat_no.trim().toUpperCase(),
      qty_per_kanban: qty,
      min_qty: minQ,
      max_qty: maxQ,
      lot_size: form.lot_size === '' ? null : parseInt(form.lot_size),
      is_active: true,
      updated_by: fullName,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'mat_no' });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('บันทึก Kanban Std แล้ว');
    setShowModal(false);
    load();
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'clamp(16px,2vw,20px)', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
            🎴 Kanban Std — มาตรฐาน Qty/Kanban รายพาร์ท
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            UOM และข้อมูลพาร์ทดึงจาก 🗂 Parts Master โดยตรง (ไม่เก็บซ้ำ) · Qty/Kanban ตั้งต้นจาก Qty/Pkg (1 ใบ Kanban = 1 packaging)
          </p>
        </div>
        <input
          style={{ ...inputSt, width: 220 }}
          placeholder="ค้นหา Mat No. / Part Name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 0, overflow: 'hidden' }}>
        <div className="table-sticky" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg2)' }}>
                {['Mat No.', 'Part Name', 'Supplier', 'UOM', 'Qty/Pkg', 'Qty/Kanban', 'Min', 'Max', 'Lot size', 'อัปเดต'].map(h => (
                  <th key={h} style={{ padding: '9px 14px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap', textTransform: 'uppercase' }}>{h}</th>
                ))}
                {canEdit && <th style={{ padding: '9px 14px', width: 80 }}></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={canEdit ? 11 : 10} style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>ไม่พบข้อมูล — เพิ่มพาร์ทใน Parts Master ก่อน</td></tr>
              )}
              {filtered.map(row => {
                const mismatch = row.ks && row.qty_per_pkg != null && Number(row.ks.qty_per_kanban) !== Number(row.qty_per_pkg);
                return (
                  <tr key={row.mat_no} style={{ opacity: row.ks ? 1 : 0.55 }}>
                    <td style={{ padding: '9px 14px', borderTop: '1px solid var(--border)', fontFamily: 'monospace', fontWeight: 700, color: '#0ea5e9', fontSize: 13 }}>{row.mat_no}</td>
                    <td style={{ padding: '9px 14px', borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--text)' }}>{row.part_name || '—'}</td>
                    <td style={{ padding: '9px 14px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text2)' }}>{row.supplier || '—'}</td>
                    <td style={{ padding: '9px 14px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)' }}>{row.uom || '—'}</td>
                    <td style={{ padding: '9px 14px', borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--text2)' }}>{row.qty_per_pkg != null ? row.qty_per_pkg.toLocaleString() : '—'}</td>
                    <td style={{ padding: '9px 14px', borderTop: '1px solid var(--border)', fontWeight: 900, fontSize: 15, color: mismatch ? '#f59e0b' : row.ks ? 'var(--accent)' : 'var(--muted)' }}>
                      {row.ks ? row.ks.qty_per_kanban.toLocaleString() : '—'}
                      {mismatch && <span title="ไม่ตรงกับ Qty/Pkg ใน Parts Master" style={{ marginLeft: 4 }}>⚠️</span>}
                    </td>
                    <td style={{ padding: '9px 14px', borderTop: '1px solid var(--border)', fontSize: 13, color: row.ks?.min_qty != null ? 'var(--text2)' : 'var(--muted)' }}>{row.ks?.min_qty != null ? row.ks.min_qty.toLocaleString() : '—'}</td>
                    <td style={{ padding: '9px 14px', borderTop: '1px solid var(--border)', fontSize: 13, color: row.ks?.max_qty != null ? 'var(--text2)' : 'var(--muted)' }}>{row.ks?.max_qty != null ? row.ks.max_qty.toLocaleString() : '—'}</td>
                    <td style={{ padding: '9px 14px', borderTop: '1px solid var(--border)', fontSize: 13, fontWeight: 700, color: row.ks?.lot_size != null ? '#7c3aed' : 'var(--muted)' }}>{row.ks?.lot_size != null ? row.ks.lot_size.toLocaleString() : '—'}</td>
                    <td style={{ padding: '9px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--muted)' }}>
                      {row.ks ? (
                        <span title={row.ks.updated_by || ''}>
                          {row.ks.updated_at ? new Date(row.ks.updated_at).toLocaleDateString('th-TH') : '—'}
                          {row.ks.updated_by ? <span style={{ display: 'block', fontSize: 11 }}>{row.ks.updated_by}</span> : null}
                        </span>
                      ) : '—'}
                    </td>
                    {canEdit && (
                      <td style={{ padding: '8px 14px', borderTop: '1px solid var(--border)' }}>
                        <button onClick={() => openEdit(row)}
                          style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed', padding: '4px 10px', fontSize: 11, border: '1px solid rgba(124,58,237,0.3)', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                          ✏️ แก้ไข
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(420px,100%)', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 16, fontFamily: 'var(--font-display)' }}>
              🎴 แก้ไข Kanban Std — {form.mat_no}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Qty / Kanban *</label>
                <input type="number" min="1" step="1"
                  style={{ ...inputSt, fontSize: 18, fontWeight: 900, textAlign: 'center' }}
                  value={form.qty_per_kanban}
                  onChange={e => setForm(f => ({ ...f, qty_per_kanban: e.target.value }))}
                  placeholder="0"
                  autoFocus
                />
              </div>
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Min (สต็อกขั้นต่ำสโตร์)</label>
                  <input type="number" min="0" step="1" style={{ ...inputSt, textAlign: 'center', fontWeight: 700 }}
                    value={form.min_qty} onChange={e => setForm(f => ({ ...f, min_qty: e.target.value }))} placeholder="เว้นว่าง = ไม่คุม" />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Max (เติมขึ้นถึง)</label>
                  <input type="number" min="0" step="1" style={{ ...inputSt, textAlign: 'center', fontWeight: 700 }}
                    value={form.max_qty} onChange={e => setForm(f => ({ ...f, max_qty: e.target.value }))} placeholder="เว้นว่าง = ไม่คุม" />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', display: 'block', marginBottom: 4 }}>Lot size (สะสม demand ครบเท่านี้ → ยิงใบสั่งผลิต + ใบเบิกวัตถุดิบ อัตโนมัติ)</label>
                <input type="number" min="1" step="1" style={{ ...inputSt, textAlign: 'center', fontWeight: 900, fontSize: 16 }}
                  value={form.lot_size} onChange={e => setForm(f => ({ ...f, lot_size: e.target.value }))} placeholder="เว้นว่าง = ไม่สะสมเป็นล็อต" />
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                UOM: <strong style={{ color: 'var(--text)' }}>{parts.find(p => p.mat_no === form.mat_no)?.uom || '—'}</strong> (จาก Parts Master)
                · Min-Max คุมการเติมที่สโตร์ · Lot size = เกณฑ์ยิงใบสั่งผลิตพาร์ทย่อย
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setShowModal(false)} style={btnSecondary}>ยกเลิก</button>
              <button onClick={handleSave} disabled={saving} style={{ ...btnPrimary, background: '#7c3aed', opacity: saving ? 0.6 : 1 }}>
                {saving ? '...' : '💾 บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
