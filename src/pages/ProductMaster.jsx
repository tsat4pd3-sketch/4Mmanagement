import { useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import ImageCropModal from '../components/ImageCropModal';

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

const BLANK = () => ({ name: '', code: '', mat_no: '', p_no: '', customer: '', line_name: '', cycle_time_sec: '', target_per_shift: '', process_type: 'welding_assembly', is_active: true, effective_from: '', image_url: '', pair_mat_no: '' });

/* ── Quick-link chips to connected modules ── */
function RelatedLinks({ matNo, productId }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
      <Link to="/heijunka" title="ดู Heijunka Kanban demand" style={{ fontSize: 10, padding: '2px 9px', borderRadius: 10, background: 'rgba(245,158,11,0.1)', color: '#f59e0b', textDecoration: 'none', fontWeight: 700 }}>🎴 Kanban</Link>
      <Link to="/daily-report" title="บันทึกการผลิต" style={{ fontSize: 10, padding: '2px 9px', borderRadius: 10, background: 'rgba(14,165,233,0.1)', color: '#38bdf8', textDecoration: 'none', fontWeight: 700 }}>📊 Daily Report</Link>
    </div>
  );
}

export default function ProductMaster() {
  const { role, fullName } = useContext(UserContext);
  const canEdit  = ['admin', 'manager', 'supervisor'].includes(role);
  const [mainTab, setMainTab] = useState('products');

  /* ── state ── */
  const [items,   setItems]   = useState([]);
  const [lines,   setLines]   = useState([]);
  const [kanbanStds, setKanbanStds] = useState([]);
  const [familyTotals, setFamilyTotals] = useState({});
  const [bomCounts, setBomCounts] = useState({});          // product_id → bom count

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
    const [{ data: pr }, { data: ln }, { data: stds }, { data: boms }, { data: sessions }] = await Promise.all([
      supabaseDR.from('dr_products').select('*').order('name').order('effective_from', { ascending: false }),
      supabase.from('production_lines').select('id, name').order('name'),
      supabaseDR.from('kanban_standards').select('*').order('mat_no'),
      supabaseDR.from('bom_items').select('product_id').eq('is_active', true),
      supabaseDR.from('production_sessions').select('product_id, qty_ok, dr_products(family_id)'),
    ]);
    setItems(pr || []);
    setLines(ln || []);
    setKanbanStds(stds || []);

    const bc = {};
    (boms || []).forEach(b => { bc[b.product_id] = (bc[b.product_id] || 0) + 1; });
    setBomCounts(bc);

    const totals = {};
    (sessions || []).forEach(s => {
      const fid = s.dr_products?.family_id;
      if (!fid) return;
      totals[fid] = (totals[fid] || 0) + (s.qty_ok || 0);
    });
    setFamilyTotals(totals);
  }, []);

  useEffect(() => { load(); }, [load]);

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
      process_type: item.process_type || 'welding_assembly', is_active: item.is_active, effective_from: item.effective_from || '',
      image_url: item.image_url || sharedImage || '', pair_mat_no: item.pair_mat_no || '',
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
      process_type: item.process_type || 'welding_assembly', is_active: true,
      effective_from: new Date().toISOString().slice(0, 10),
      image_url: item.image_url || '',
    });
  };

  const handleSave = async () => {
    if (!form.name) { toast.error('กรอกชื่อสินค้า'); return; }
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
        is_active: form.is_active,
        effective_from: form.effective_from || null,
        image_url: imageUrl,
        pair_mat_no: form.pair_mat_no || null,
      };
      let savedId = editing;
      if (editing === 'new') {
        if (ecSource) payload.family_id = ecSource.family_id;
        const { data: inserted, error } = await supabaseDR.from('dr_products').insert(payload).select().single();
        if (error) { toast.error(error.message); return; }
        savedId = inserted.id;
        if (ecSource) {
          await supabaseDR.from('dr_products').update({
            is_active: false,
            superseded_at: form.effective_from || new Date().toISOString().slice(0, 10),
            superseded_by: inserted.id,
          }).eq('id', ecSource.id);
        }
      } else {
        const { error } = await supabaseDR.from('dr_products').update(payload).eq('id', editing);
        if (error) { toast.error(error.message); return; }
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
          .ilike('name', payload.name).neq('id', savedId);
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

  const handleDelete = async (id) => {
    if (!window.confirm('ลบสินค้านี้?')) return;
    const { error } = await supabaseDR.from('dr_products').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
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

  /* ── group into families ── */
  const families = useMemo(() => {
    const map = new Map();
    [...items].sort((a, b) => a.name.localeCompare(b.name, 'th')).forEach(item => {
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
      const payload = toImport.map(r => ({
        mat_no: r.mat_no, part_name: r.part_name,
        part_no: r.part_no || null, uom: r.uom || 'EA',
        qty_per_pkg: r.qty_per_pkg ? Number(r.qty_per_pkg) : null,
        supplier: r.supplier || null, note: r.note || null, is_active: true,
      }));
      const { error } = await supabaseDR.from('parts_master').upsert(payload, { onConflict: 'mat_no', ignoreDuplicates: false });
      if (error) { toast.error(error.message); return; }
      toast.success(`นำเข้า ${payload.length} รายการสำเร็จ`);
    }
    setCsvPreview(null);
    load();
    if (type === 'parts') setPartsReloadKey(k => k + 1);
  };

  return (
    <div style={{ padding: 'clamp(12px, 2vw, 24px)', maxWidth: 1200, margin: '0 auto' }}>
      {/* ── Main Tab Bar ── */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--bg2)', borderRadius: 8, padding: 4, marginBottom: 20, width: 'fit-content' }}>
        {[{ key:'products', label:'🔩 Products' }, { key:'bom', label:'📦 BOM' }, { key:'parts', label:'🗂 Parts Master' }, { key:'kanban', label:'🎴 Kanban Std' }, { key:'export', label:'📤 Export' }].map(t => (
          <button key={t.key} onClick={() => setMainTab(t.key)}
            style={{ padding:'6px 18px', borderRadius:6, border:'none', cursor:'pointer', fontSize:13, fontWeight:600,
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
          {' '}(300xxxxx · 500xxxxx) เพิ่มได้ที่ tab{' '}
          <strong style={{ color: 'var(--text)' }}>🗂 Parts Master</strong>
          {' '}— หน้านี้รองรับเฉพาะ <strong>100xxxxx</strong> (FG ส่งลูกค้า) และ <strong>200xxxxx</strong> (Child Part ผลิตเอง)
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
        {canEdit && <>
          <button onClick={downloadProductTemplate} style={{ ...btnSecondary, fontSize: 12 }}>⬇️ CSV Template</button>
          <button onClick={() => csvInputRef.current?.click()} disabled={csvImporting}
            style={{ ...btnSecondary, fontSize: 12, opacity: csvImporting ? 0.6 : 1 }}>
            {csvImporting ? '⏳ กำลังนำเข้า...' : '⬆️ นำเข้า CSV'}
          </button>
          <input ref={csvInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleProductCsvUpload} />
        </>}
        {canEdit && <button onClick={() => openEdit()} style={btnPrimary}>+ เพิ่มสินค้า</button>}
      </div>

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
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: item.process_type === 'metal_forming' ? 'rgba(251,191,36,0.15)' : 'rgba(34,197,94,0.12)', color: item.process_type === 'metal_forming' ? '#fbbf24' : '#22c55e' }}>
                          {item.process_type === 'metal_forming' ? '⚙ Metal Forming' : '🔥 Welding/Assy'}
                        </span>
                        {members.length > 1 && <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 20, background: 'rgba(168,85,247,0.12)', color: '#a855f7', fontWeight: 700 }}>🔄 {members.length} revisions</span>}
                        {!active && <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 20, background: 'rgba(107,114,128,0.15)', color: '#6b7280', fontWeight: 700 }}>ปิดใช้งาน</span>}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
                      {item.mat_no && <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: '#0ea5e9' }}>{item.mat_no}</span>}
                      {item.p_no   && <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text2)' }}>P.NO: {item.p_no}</span>}
                      {item.customer && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: 'rgba(59,130,246,0.1)', color: '#60a5fa' }}>{item.customer}</span>}
                      {item.code && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: 'var(--bg2)', color: 'var(--muted)' }}>{item.code}</span>}
                      {members.length > 1 && indented && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 10, background: 'rgba(168,85,247,0.12)', color: '#a855f7', fontWeight: 700 }}>🔄 {members.length} rev</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {[item.line_name && `📍 ${item.line_name}`, item.cycle_time_sec && `CT ${item.cycle_time_sec}s`, item.target_per_shift && `Target ${item.target_per_shift}/กะ`, !indented && item.effective_from && `ใช้ตั้งแต่ ${item.effective_from}`].filter(Boolean).join(' · ')}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {totalQty > 0 && <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 700 }}>📦 ยอดสะสม {totalQty.toLocaleString()} ชิ้น</span>}
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: totalBom > 0 ? 'rgba(61,214,92,0.1)' : 'rgba(107,114,128,0.08)', color: totalBom > 0 ? 'var(--accent)' : 'var(--muted)', fontWeight: 700 }}>📦 BOM: {totalBom > 0 ? `${totalBom} พาร์ท` : 'ยังไม่มี'}</span>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: stds.filter(s => s.is_active).length > 0 ? 'rgba(245,158,11,0.1)' : 'rgba(107,114,128,0.08)', color: stds.filter(s => s.is_active).length > 0 ? '#f59e0b' : 'var(--muted)', fontWeight: 700 }}>🎴 Kanban: {stds.filter(s => s.is_active).length > 0 ? `${stds.filter(s => s.is_active).length} mat` : 'ยังไม่มี'}</span>
                    </div>
                    <RelatedLinks matNo={item.mat_no} productId={item.id} />
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'flex-start' }}>
                      {active && <button onClick={() => openEC(active)} title="Engineering Change" style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: '#a855f7', fontWeight: 700 }}>🔄 EC</button>}
                      <button onClick={() => openEdit(item)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>
                      <button onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}>✕</button>
                    </div>
                  )}
                </div>
                {showHistory && archived.length > 0 && (
                  <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg2)', padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, marginBottom: 2 }}>📋 ประวัติ Revision</div>
                    {archived.map(rev => (
                      <div key={rev.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, color: 'var(--muted)', opacity: 0.75 }}>
                        <span style={{ fontFamily: 'monospace', color: '#64748b' }}>{rev.mat_no || '—'}</span>
                        {rev.p_no && <span style={{ color: '#475569' }}>P.NO: {rev.p_no}</span>}
                        <span>{rev.effective_from || '?'} → {rev.superseded_at || '?'}</span>
                        <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 10, background: 'rgba(107,114,128,0.15)', color: '#6b7280' }}>superseded</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ borderTop: '1px solid var(--border)' }}>
                  <button onClick={() => setExpandedFamilies(prev => ({ ...prev, [family_id]: !isExpandedKanban }))}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: 'var(--bg2)', border: 'none', cursor: 'pointer', color: 'var(--text2)', fontSize: 12, fontWeight: 700 }}>
                    <span>🎴 Kanban Standards ({stds.length})</span>
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>{isExpandedKanban ? '▲' : '▼'}</span>
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
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: repItem.process_type === 'metal_forming' ? 'rgba(251,191,36,0.15)' : 'rgba(34,197,94,0.12)', color: repItem.process_type === 'metal_forming' ? '#fbbf24' : '#22c55e' }}>
                        {repItem.process_type === 'metal_forming' ? '⚙ Metal Forming' : '🔥 Welding/Assy'}
                      </span>
                      <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 20, background: 'rgba(59,130,246,0.12)', color: '#60a5fa', fontWeight: 700 }}>👥 {nameFamilies.length} ลูกค้า</span>
                      {totalBomAll > 0 && <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 20, background: 'rgba(61,214,92,0.1)', color: 'var(--accent)', fontWeight: 700 }}>📦 BOM: {totalBomAll}</span>}
                      <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 20, background: stds.filter(s => s.is_active).length > 0 ? 'rgba(245,158,11,0.1)' : 'rgba(107,114,128,0.08)', color: stds.filter(s => s.is_active).length > 0 ? '#f59e0b' : 'var(--muted)', fontWeight: 700 }}>🎴 Kanban: {stds.filter(s => s.is_active).length > 0 ? `${stds.filter(s => s.is_active).length} mat` : 'ยังไม่มี'}</span>
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
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', color: '#60a5fa', fontWeight: 700, flexShrink: 0 }}>{v.customer || '—'}</span>
                        <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'monospace', color: '#0ea5e9' }}>{v.mat_no}</span>
                        {v.p_no && <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text2)' }}>P.NO: {v.p_no}</span>}
                        {v.line_name && <span style={{ fontSize: 11, color: 'var(--muted)' }}>📍 {v.line_name}</span>}
                        {v.revCount > 1 && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 10, background: 'rgba(168,85,247,0.12)', color: '#a855f7', fontWeight: 700 }}>🔄 {v.revCount} rev</span>}
                        <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: (bomCounts[v.id] || 0) > 0 ? 'rgba(61,214,92,0.1)' : 'rgba(107,114,128,0.08)', color: (bomCounts[v.id] || 0) > 0 ? 'var(--accent)' : 'var(--muted)', fontWeight: 700 }}>📦 {(bomCounts[v.id] || 0) > 0 ? `${bomCounts[v.id]} พาร์ท` : 'ไม่มี BOM'}</span>
                        {canEdit && (
                          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', flexShrink: 0 }}>
                            <button onClick={() => openEC(v)} title="Engineering Change" style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#a855f7', fontWeight: 700 }}>🔄 EC</button>
                            <button onClick={() => openEdit(v)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>
                            <button onClick={() => handleDelete(v.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 13 }}>✕</button>
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
                      <span style={{ fontSize: 10, color: 'var(--muted)' }}>{isExpandedKanban ? '▲' : '▼'}</span>
                    </button>
                    {isExpandedKanban && (
                      <div style={{ padding: '8px 12px', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {stds.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 4px' }}>ยังไม่มี Kanban Standard</div>}
                        {stds.map(std => {
                          const v = variantById.get(std.product_id);
                          return (
                            <div key={std.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 7, opacity: std.is_active ? 1 : 0.5 }}>
                              {v?.customer && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', color: '#60a5fa', fontWeight: 700, flexShrink: 0 }}>{v.customer}</span>}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'monospace', color: '#0ea5e9' }}>{std.mat_no}</span>
                                {!std.is_active && <span style={{ fontSize: 9, color: '#ef4444', marginLeft: 6 }}>ปิด</span>}
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
                        {canEdit && allVariants.filter(v => !stds.some(s => s.product_id === v.id)).map(v => (
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg3)', border: `1px solid ${ecSource ? 'rgba(168,85,247,0.5)' : 'var(--border2)'}`, borderRadius: 14, padding: 24, width: 'min(95vw,480px)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
              {ecSource ? '🔄 Engineering Change' : editing === 'new' ? '+ เพิ่มสินค้า' : 'แก้ไขสินค้า'}
            </div>
            {ecSource && (
              <div style={{ fontSize: 12, color: '#a855f7', marginBottom: 16, padding: '8px 12px', background: 'rgba(168,85,247,0.08)', borderRadius: 8, border: '1px solid rgba(168,85,247,0.2)' }}>
                ต่อจาก: <strong>{ecSource.mat_no}</strong> {ecSource.p_no && `/ ${ecSource.p_no}`}<br />
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>MAT.NO เดิมจะถูก mark เป็น superseded อัตโนมัติ</span>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="ชื่อสินค้า / Model *">
                <input autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputSt} />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label={ecSource ? 'MAT.NO ใหม่ (SAP) *' : 'MAT.NO (SAP)'}>
                  <input value={form.mat_no} onChange={e => setForm(f => ({ ...f, mat_no: e.target.value.toUpperCase() }))} placeholder="เช่น 10100399" style={{ ...inputSt, fontFamily: 'monospace', fontWeight: 700, borderColor: ecSource ? 'rgba(168,85,247,0.5)' : undefined }} />
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Customer"><input value={form.customer} onChange={e => setForm(f => ({ ...f, customer: e.target.value }))} placeholder="เช่น FORD" style={inputSt} /></Field>
                <Field label="รหัสสินค้า (Code)"><input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="เช่น HDF-001" style={inputSt} /></Field>
              </div>
              <Field label="ประเภทกระบวนการ *">
                <select value={form.process_type} onChange={e => setForm(f => ({ ...f, process_type: e.target.value }))} style={inputSt}>
                  <option value="welding_assembly">🔥 Welding / Assembly</option>
                  <option value="metal_forming">⚙ Metal Forming</option>
                </select>
              </Field>
              <Field label="ไลน์ผลิตหลัก">
                <select value={form.line_name} onChange={e => setForm(f => ({ ...f, line_name: e.target.value }))} style={inputSt}>
                  <option value="">ไม่ระบุ</option>
                  {lines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                </select>
              </Field>
              <Field label="MAT.NO คู่ (RH/LH) — เปิด/ปิด Order พร้อมกันอัตโนมัติ">
                <select value={form.pair_mat_no} onChange={e => setForm(f => ({ ...f, pair_mat_no: e.target.value }))} style={inputSt}>
                  <option value="">ไม่มีคู่</option>
                  {items.filter(i => i.mat_no && i.mat_no !== form.mat_no && i.is_active).map(i => (
                    <option key={i.id} value={i.mat_no}>{i.mat_no} — {i.name}</option>
                  ))}
                </select>
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg3)', border: '1px solid rgba(14,165,233,0.4)', borderRadius: 14, padding: 24, width: 'min(95vw,380px)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 20, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
              {kanbanEditing === 'new' ? '+ เพิ่ม Kanban Standard' : 'แก้ไข Kanban Standard'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="MAT.NO *">
                  <input autoFocus value={kanbanForm.mat_no} onChange={e => setKanbanForm(f => ({ ...f, mat_no: e.target.value.toUpperCase() }))} placeholder="เช่น 10100335" style={{ ...inputSt, fontFamily: 'monospace', fontWeight: 700 }} />
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
      </>)}

      {mainTab === 'bom'   && <BOMPanel canEdit={canEdit} fullName={fullName} />}
      {mainTab === 'parts' && <PartsMasterPanel canEdit={canEdit} fullName={fullName} setCsvPreview={setCsvPreview} reloadKey={partsReloadKey} />}
      {mainTab === 'kanban' && <KanbanStdPanel canEdit={canEdit} fullName={fullName} />}
      {mainTab === 'export' && <ExportPanel items={items} kanbanStds={kanbanStds} bomCounts={bomCounts} />}

      {/* ════ CSV Preview / Duplicate Detection Modal ════ */}
      {csvPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
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
const EMPTY_BOM = { qty_per_unit: 1, qty_per_pkg: '', note: '' };

const TH = ({ children, w }) => (
  <th style={{ padding: '8px 10px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', width: w }}>{children}</th>
);
const TD = ({ children, style }) => (
  <td style={{ padding: '8px 10px', fontSize: 13, color: 'var(--text)', borderTop: '1px solid var(--border)', ...style }}>{children}</td>
);

function BOMPanel({ canEdit, fullName }) {
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
    const [{ data: prods }, { data: boms }, { data: parts }] = await Promise.all([
      supabaseDR.from('dr_products').select('id, name, code, mat_no, p_no, customer, line_name').eq('is_active', true).order('line_name').order('name'),
      supabaseDR.from('bom_items').select('product_id').eq('is_active', true),
      supabaseDR.from('parts_master').select('*').eq('is_active', true).order('part_name'),
    ]);
    setProducts(prods || []);
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

  const openPicker = () => { setPickerQ(''); setPickerSel([]); setShowPicker(true); };
  const openEdit_  = (it) => { setEditItem(it); setForm({ qty_per_unit: it.qty_per_unit, qty_per_pkg: it.qty_per_pkg || '', note: it.note || '' }); setShowEdit(true); };

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
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 300px) 1fr', gap: 16, alignItems: 'start' }}>
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
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 10, flexShrink: 0, background: n > 0 ? 'rgba(61,214,92,0.15)' : 'rgba(255,255,255,0.06)', color: n > 0 ? 'var(--accent)' : 'var(--muted)' }}>{n > 0 ? `${n} พาร์ท` : 'ยังไม่มี'}</span>
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
              {canEdit && (
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
                ยังไม่มีพาร์ทย่อยใน BOM นี้{canEdit && ' — กด "+ เพิ่มพาร์ทย่อย" เพื่อเริ่ม'}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg2)' }}>
                      <TH>Part Name</TH><TH>Part No.</TH><TH>Mat SAP</TH><TH w={90}>ใช้/ชิ้น</TH><TH w={90}>Qty/Pkg</TH><TH w={60}>หน่วย</TH><TH>Supplier</TH>
                      {canEdit && <TH w={90}> </TH>}
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
                        <TD style={{ color: 'var(--muted)', fontSize: 12 }}>{it.supplier || '—'}</TD>
                        {canEdit && (
                          <TD>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => openEdit_(it)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', cursor: 'pointer', fontSize: 12 }}>✏️</button>
                              <button onClick={() => handleDelete(it)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>🗑</button>
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
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
                        <label style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>QTY/ชิ้น</label>
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
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
    const headers = ['mat_no','part_name','part_no','uom','qty_per_pkg','supplier','note','is_active'];
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
            Columns: mat_no, part_name, part_no, uom, qty_per_pkg, supplier, note, is_active
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
   mat_no prefix:
     100xxxxx = FG (ส่งลูกค้า)
     200xxxxx = child part ผลิตในบริษัท
     300xxxxx = child part ซื้อนอก
     500xxxxx = raw material
═══════════════════════════════════════════════════════════════ */
const EMPTY_PART = {
  mat_no: '', part_name: '', part_no: '', uom: 'EA',
  qty_per_pkg: '', supplier: '', note: '', is_active: true, image_url: '',
};

const MAT_PREFIXES = [
  { prefix: '100', label: '100xxxxx — FG (ส่งลูกค้า)', color: '#22c55e' },
  { prefix: '200', label: '200xxxxx — Child Part (ผลิตเอง)', color: '#3b82f6' },
  { prefix: '300', label: '300xxxxx — Child Part (ซื้อนอก)', color: '#f59e0b' },
  { prefix: '500', label: '500xxxxx — Raw Material', color: '#a78bfa' },
];

function matColor(mat_no = '') {
  if (mat_no.startsWith('1')) return '#22c55e';
  if (mat_no.startsWith('2')) return '#3b82f6';
  if (mat_no.startsWith('3')) return '#f59e0b';
  if (mat_no.startsWith('5')) return '#a78bfa';
  return 'var(--muted)';
}

function matTypeLabel(mat_no = '') {
  if (mat_no.startsWith('1')) return 'FG';
  if (mat_no.startsWith('2')) return 'Child (ผลิต)';
  if (mat_no.startsWith('3')) return 'Child (ซื้อ)';
  if (mat_no.startsWith('5')) return 'Raw Mat';
  return '';
}

function PartsMasterPanel({ canEdit, fullName, setCsvPreview, reloadKey }) {
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

  const PARTS_CSV_HEADER = 'mat_no,part_name,part_no,uom,qty_per_pkg,supplier,note';
  const PARTS_CSV_EXAMPLE = [
    'EXAMPLE-300001234,[ตัวอย่าง-ลบแถวนี้ก่อนนำเข้าจริง] NUT WELD M8,NW-M8-001,EA,500,THAI SUMMIT PARTS,สำหรับ APRON ASSY',
    'EXAMPLE-500009876,[ตัวอย่าง-ลบแถวนี้ก่อนนำเข้าจริง] STEEL PLATE 1.0MM,SP-1.0-A,KG,,ABC STEEL,',
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
    if (prefixFilter) r = r.filter(p => p.mat_no?.startsWith(prefixFilter));
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
      };
      let err;
      if (editPart) {
        ({ error: err } = await supabaseDR.from('parts_master').update(payload).eq('id', editPart.id));
      } else {
        ({ error: err } = await supabaseDR.from('parts_master').insert(payload));
      }
      if (err) { toast.error(err.message); return; }
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
          {MAT_PREFIXES.map(m => <option key={m.prefix} value={m.prefix}>{m.prefix}xxxxx</option>)}
        </select>
        {canEdit && <>
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
        <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead style={{ background: 'var(--bg2)' }}>
              <tr>
                <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left' }}></th>
                <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' }}>Mat SAP</th>
                <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left' }}>ชื่อพาร์ท</th>
                <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left' }}>Part No.</th>
                <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left' }}>UOM</th>
                <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'right' }}>Qty/Pkg</th>
                <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left' }}>Supplier</th>
                <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'center' }}>สถานะ</th>
                {canEdit && <th style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)' }}></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={canEdit ? 9 : 8} style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
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
                      {matTypeLabel(p.mat_no) && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: `${matColor(p.mat_no)}22`, color: matColor(p.mat_no), fontWeight: 700 }}>{matTypeLabel(p.mat_no)}</span>}
                    </div>
                  </td>
                  <td style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text)', fontWeight: 600, borderTop: '1px solid var(--border)' }}>{p.part_name}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text2)', fontFamily: 'monospace', borderTop: '1px solid var(--border)' }}>{p.part_no || '-'}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>{p.uom}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text2)', textAlign: 'right', fontFamily: 'monospace', borderTop: '1px solid var(--border)' }}>{p.qty_per_pkg ?? '-'}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text2)', borderTop: '1px solid var(--border)' }}>{p.supplier || '-'}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, fontWeight: 700, background: p.is_active ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: p.is_active ? '#22c55e' : '#ef4444' }}>
                      {p.is_active ? 'ใช้งาน' : 'ปิดใช้'}
                    </span>
                  </td>
                  {canEdit && (
                    <td style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => openEdit(p)} style={{ ...btnSecondary, padding: '4px 10px', fontSize: 12 }}>✏️</button>
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(480px,100%)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)', marginBottom: 16 }}>
              {editPart ? '✏️ แก้ไขพาร์ท' : '➕ เพิ่มพาร์ทใหม่'}
            </div>

            {/* prefix hint */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {MAT_PREFIXES.map(m => (
                <button key={m.prefix} onClick={() => setForm(f => ({ ...f, mat_no: f.mat_no.startsWith(m.prefix) ? f.mat_no : m.prefix }))}
                  style={{ fontSize: 10, padding: '2px 10px', borderRadius: 10, border: `1px solid ${m.color}`, background: form.mat_no.startsWith(m.prefix) ? `${m.color}22` : 'transparent', color: m.color, cursor: 'pointer', fontWeight: 700 }}>
                  {m.prefix}…
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
const EMPTY_KBS = { mat_no: '', qty_per_kanban: '' };

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
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.mat_no.trim()) { toast.error('กรอก Mat No.'); return; }
    const qty = parseFloat(form.qty_per_kanban);
    if (!qty || qty <= 0) { toast.error('กรอก Qty/Kanban ให้ถูกต้อง'); return; }
    setSaving(true);
    const { error } = await supabaseDR.from('kanban_standards').upsert({
      mat_no: form.mat_no.trim().toUpperCase(),
      qty_per_kanban: qty,
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
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg2)' }}>
                {['Mat No.', 'Part Name', 'Supplier', 'UOM', 'Qty/Pkg', 'Qty/Kanban', 'อัปเดต'].map(h => (
                  <th key={h} style={{ padding: '9px 14px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap', textTransform: 'uppercase' }}>{h}</th>
                ))}
                {canEdit && <th style={{ padding: '9px 14px', width: 80 }}></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={canEdit ? 8 : 7} style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>ไม่พบข้อมูล — เพิ่มพาร์ทใน Parts Master ก่อน</td></tr>
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
                    <td style={{ padding: '9px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--muted)' }}>
                      {row.ks ? (
                        <span title={row.ks.updated_by || ''}>
                          {row.ks.updated_at ? new Date(row.ks.updated_at).toLocaleDateString('th-TH') : '—'}
                          {row.ks.updated_by ? <span style={{ display: 'block', fontSize: 10 }}>{row.ks.updated_by}</span> : null}
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setShowModal(false)}>
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
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                UOM: <strong style={{ color: 'var(--text)' }}>{parts.find(p => p.mat_no === form.mat_no)?.uom || '—'}</strong> (จาก Parts Master)
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
