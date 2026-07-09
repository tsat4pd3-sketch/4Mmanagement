/**
 * QAInspectionSetup — มาตรฐานการตรวจ & Drawing (/qa-setup)
 *
 * หน้าตั้งค่าฝั่ง QA: สร้าง part master, อัพโหลด drawing (รูป/PDF ลง bucket
 * qa-drawings), วาง balloon จุดตรวจบนแบบด้วยการคลิก แล้วกำหนดมาตรฐานการตรวจ
 * ของแต่ละจุด (variable มีสเปคตัวเลข / attribute OK-NG, วิธีวัด, stage, ความถี่)
 *
 * จุดตรวจชนิด variable ส่งเข้า SPC ได้ด้วยปุ่ม → สร้างแถวใน qa_characteristics
 * แล้วไปบันทึกค่าวัด/ดู Cp-Cpk ต่อที่ Quality Control Center (/qa)
 *
 * ตาราง: qa_parts, qa_inspection_items (MAIN project) — เขียนได้เฉพาะ qa:manage
 */
import { useState, useEffect, useMemo, useCallback, useContext, useRef } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { toast } from '../components/Toast';
import { UserContext } from '../App';
import { usePerms } from '../utils/usePerms';

const fmtDT = s => s ? new Date(s).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

const inputSt = {
  width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)',
};
const btnSt = (bg = 'var(--accent)', color = '#fff') => ({
  padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
  fontWeight: 700, fontSize: 13, background: bg, color,
});
const ghostBtn = {
  padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 12,
  background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)',
};
const cardSt = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 };
const thSt = { padding: '7px 10px', textAlign: 'left', fontSize: 11, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border2)' };
const tdSt = { padding: '7px 10px', fontSize: 12.5, color: 'var(--text)', borderBottom: '1px solid var(--border)', verticalAlign: 'top' };

const STAGE = {
  incoming:    { label: 'รับเข้า (Incoming)',        color: '#a78bfa' },
  setup_first: { label: 'ชิ้นแรกหลังตั้งเครื่อง',     color: '#f59e0b' },
  inprocess:   { label: 'ในกระบวนการ',               color: '#4d9fff' },
  final:       { label: 'ตรวจสุดท้าย (Final)',        color: '#22c55e' },
  patrol:      { label: 'Patrol / รายกะ',            color: '#fb923c' },
};

/* ตามฟอร์ม FM-QA-112: Part Classification + Rank ของจุดตรวจ */
const PART_RANK = {
  safety:    { label: 'Safety part',                 color: '#ef4444' },
  important: { label: 'Important / Regulation part', color: '#f59e0b' },
  general:   { label: 'General part',                color: '#4d9fff' },
};
const PART_KIND = {
  completed:    'Completed part',
  component:    'Component, Child part',
  raw_material: 'Raw material',
};
const RANK = {
  M:  { label: 'M',  color: '#f59e0b' },
  SC: { label: 'SC', color: '#ef4444' },
};

/* เรียง balloon แบบ natural: A1 < A2 < B < D1 < H2 < H10 < 1 < 2 */
const balloonSort = (a, b) =>
  String(a.balloon_no || '').localeCompare(String(b.balloon_no || ''), undefined, { numeric: true, sensitivity: 'base' });

function Chip({ label, color }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      color, background: `${color}1f`, border: `1px solid ${color}55`, whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

function Modal({ title, onClose, children, width = 560 }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '5vh 12px', overflowY: 'auto',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 14,
        width: `min(${width}px, 96vw)`, boxShadow: 'var(--shadow-lg)', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: 18, overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, span }) {
  return (
    <div style={{ gridColumn: span ? '1 / -1' : undefined }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

const EMPTY_PART = {
  part_no: '', part_name: '', customer: '', model: '', line_name: '',
  dwg_no: '', drawing_rev: '', concern_no: '', part_rank: '', part_kind: '',
};
const EMPTY_ITEM = {
  balloon_no: '', item_type: 'variable', characteristic: '', spec_text: '',
  nominal: '', usl: '', lsl: '', unit: 'mm', method: '', stage: 'inprocess',
  frequency: '', sample_size: '5', rank: '', remark: '',
};

export default function QAInspectionSetup() {
  const { fullName } = useContext(UserContext);
  const { can } = usePerms();
  const canManage = can('qa', 'manage');

  const [parts, setParts] = useState([]);
  const [lines, setLines] = useState([]);
  const [selId, setSelId] = useState(null);
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [partModal, setPartModal] = useState(null);   // { ...form, id? }
  const [bomOptions, setBomOptions] = useState(null); // null = ยังไม่โหลด (โหลดครั้งแรกที่เปิด modal)
  const [bomSearch, setBomSearch] = useState('');
  const [itemModal, setItemModal] = useState(null);   // { ...form, id?, pos_x?, pos_y? }
  const [placingId, setPlacingId] = useState(null);   // item id ที่กำลังรอคลิกวางตำแหน่ง
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const sel = parts.find(p => p.id === selId) || null;
  const isPdf = sel?.drawing_url?.toLowerCase().includes('.pdf');

  const loadParts = useCallback(async () => {
    const { data } = await supabase.from('qa_parts').select('*').order('part_no');
    setParts(data || []);
    setSelId(prev => prev && (data || []).some(p => p.id === prev) ? prev : (data?.[0]?.id ?? null));
  }, []);
  useEffect(() => { loadParts(); }, [loadParts]);

  useEffect(() => {
    supabase.from('production_lines').select('name').order('name')
      .then(({ data }) => setLines((data || []).map(l => l.name)));
  }, []);

  const loadItems = useCallback(async (partId) => {
    if (!partId) { setItems([]); return; }
    const { data } = await supabase.from('qa_inspection_items').select('*')
      .eq('part_id', partId);
    setItems((data || []).sort(balloonSort));
  }, []);
  useEffect(() => { loadItems(selId); setPlacingId(null); }, [selId, loadItems]);

  /* ตัวเลือกพาร์ทจากฐานข้อมูล BOM ฝั่ง DR (dr_products + bom_items) —
     อ่านอย่างเดียวผ่าน supabaseDR (anon), โหลด lazy ครั้งแรกที่เปิด modal เพิ่ม Part */
  useEffect(() => {
    if (!partModal || bomOptions !== null) return;
    let alive = true;
    (async () => {
      const [{ data: prods }, { data: boms }] = await Promise.all([
        supabaseDR.from('dr_products').select('id, name, code, mat_no, p_no, customer, line_name').eq('is_active', true).order('name'),
        supabaseDR.from('bom_items').select('id, product_id, mat_no, part_no, part_name, supplier').eq('is_active', true).order('part_name'),
      ]);
      if (!alive) return;
      const prodById = Object.fromEntries((prods || []).map(p => [p.id, p]));
      const opts = [
        ...(prods || []).map(p => ({
          key: `p-${p.id}`, tag: 'Product',
          part_no: p.p_no || p.mat_no || p.code || '', part_name: p.name || '',
          customer: p.customer || '', line_name: p.line_name || '',
          sub: [p.mat_no, p.line_name].filter(Boolean).join(' · '),
        })),
        ...(boms || []).map(b => {
          const parent = prodById[b.product_id];
          return {
            key: `b-${b.id}`, tag: 'BOM',
            part_no: b.part_no || b.mat_no || '', part_name: b.part_name || '',
            customer: parent?.customer || '', line_name: parent?.line_name || '',
            sub: `ใน BOM: ${parent?.name || '—'}${b.supplier ? ` · ${b.supplier}` : ''}`,
          };
        }),
      ].filter(o => o.part_no || o.part_name);
      setBomOptions(opts);
    })();
    return () => { alive = false; };
  }, [partModal, bomOptions]);

  const bomMatches = useMemo(() => {
    const q = bomSearch.trim().toLowerCase();
    if (!bomOptions || q.length < 2) return [];
    return bomOptions
      .filter(o => [o.part_no, o.part_name, o.sub].some(v => (v || '').toLowerCase().includes(q)))
      .slice(0, 8);
  }, [bomOptions, bomSearch]);

  const pickBomOption = (o) => {
    setPartModal(f => ({
      ...f,
      part_no: o.part_no || f.part_no,
      part_name: o.part_name || f.part_name,
      customer: o.customer || f.customer,
      line_name: lines.includes(o.line_name) ? o.line_name : f.line_name,
    }));
    setBomSearch('');
  };

  const shownParts = parts.filter(p => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [p.part_no, p.part_name, p.customer, p.model].some(v => (v || '').toLowerCase().includes(q));
  });

  /* เดา balloon ถัดไป: ถ้าล่าสุดลงท้ายด้วยตัวเลข (H35, A1, 7) → เพิ่มเลขต่อท้าย 1 */
  const nextBalloon = useMemo(() => {
    if (!items.length) return '1';
    const last = [...items].sort(balloonSort).at(-1);
    const m = String(last.balloon_no || '').match(/^(.*?)(\d+)$/);
    return m ? `${m[1]}${parseInt(m[2], 10) + 1}` : '';
  }, [items]);

  /* ── Part CRUD ── */
  const savePart = async () => {
    const f = partModal;
    if (!f.part_no.trim()) { toast.error('กรอก Part No.'); return; }
    const payload = {
      part_no: f.part_no.trim(), part_name: f.part_name.trim() || null,
      customer: f.customer.trim() || null, model: f.model.trim() || null,
      line_name: f.line_name || null,
      dwg_no: f.dwg_no.trim() || null, drawing_rev: f.drawing_rev.trim() || null,
      concern_no: f.concern_no.trim() || null,
      part_rank: f.part_rank || null, part_kind: f.part_kind || null,
      ...(f.id ? { is_active: f.is_active } : {}),
    };
    const { data, error } = f.id
      ? await supabase.from('qa_parts').update(payload).eq('id', f.id).select().single()
      : await supabase.from('qa_parts').insert({ ...payload, created_by: fullName || null }).select().single();
    if (error) { toast.error(error.code === '23505' ? `Part No. ${f.part_no} มีอยู่แล้ว` : `บันทึกไม่สำเร็จ: ${error.message}`); return; }
    toast.success('บันทึก Part แล้ว ✓');
    setPartModal(null);
    await loadParts();
    setSelId(data.id);
  };

  const delPart = async () => {
    if (!sel) return;
    if (!window.confirm(`ลบ ${sel.part_no} พร้อมจุดตรวจทั้งหมด ${items.length} จุด?`)) return;
    const { error } = await supabase.from('qa_parts').delete().eq('id', sel.id);
    if (error) { toast.error(error.message); return; }
    toast.success('ลบแล้ว');
    setSelId(null);
    loadParts();
  };

  /* ── Drawing upload ── */
  const uploadDrawing = async (file) => {
    if (!sel || !file) return;
    if (!/^image\/|application\/pdf$/.test(file.type)) { toast.error('รองรับเฉพาะไฟล์รูปภาพหรือ PDF'); return; }
    if (file.size > 20 * 1024 * 1024) { toast.error('ไฟล์ใหญ่เกิน 20MB'); return; }
    setUploading(true);
    const ext = file.name.split('.').pop().toLowerCase();
    const path = `parts/${sel.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('qa-drawings').upload(path, file, { upsert: true });
    if (upErr) { toast.error(`อัพโหลดไม่สำเร็จ: ${upErr.message}`); setUploading(false); return; }
    const { data: { publicUrl } } = supabase.storage.from('qa-drawings').getPublicUrl(path);
    const rev = window.prompt('Revision ของแบบ (เช่น Rev.C) — เว้นว่างได้', sel.drawing_rev || '');
    const { error } = await supabase.from('qa_parts').update({
      drawing_url: publicUrl, drawing_rev: (rev || '').trim() || sel.drawing_rev || null,
      drawing_updated_at: new Date().toISOString(),
    }).eq('id', sel.id);
    setUploading(false);
    if (error) { toast.error(error.message); return; }
    toast.success('อัพโหลด Drawing แล้ว ✓');
    loadParts();
  };

  /* ── Item CRUD ── */
  const saveItem = async () => {
    const f = itemModal;
    if (!f.characteristic.trim()) { toast.error('กรอกชื่อจุดตรวจ'); return; }
    if (f.item_type === 'variable' && f.usl !== '' && f.lsl !== '' && Number(f.usl) <= Number(f.lsl)) { toast.error('USL ต้องมากกว่า LSL'); return; }
    const payload = {
      part_id: sel.id,
      balloon_no: String(f.balloon_no).trim() || nextBalloon || '1',
      pos_x: f.pos_x ?? null, pos_y: f.pos_y ?? null,
      item_type: f.item_type, characteristic: f.characteristic.trim(),
      spec_text: f.spec_text.trim() || null,
      nominal: f.item_type === 'variable' && f.nominal !== '' ? Number(f.nominal) : null,
      usl: f.item_type === 'variable' && f.usl !== '' ? Number(f.usl) : null,
      lsl: f.item_type === 'variable' && f.lsl !== '' ? Number(f.lsl) : null,
      unit: f.item_type === 'variable' ? (f.unit.trim() || null) : null,
      method: f.method.trim() || null, stage: f.stage,
      frequency: f.frequency.trim() || null,
      sample_size: f.sample_size === '' ? null : parseInt(f.sample_size),
      rank: f.rank || null,
      control_item: !!f.rank,  // M/SC = จุดควบคุมพิเศษ
      remark: f.remark.trim() || null,
      ...(f.id ? { is_active: f.is_active } : {}),
    };
    const { error } = f.id
      ? await supabase.from('qa_inspection_items').update(payload).eq('id', f.id)
      : await supabase.from('qa_inspection_items').insert(payload);
    if (error) { toast.error(`บันทึกไม่สำเร็จ: ${error.message}`); return; }
    toast.success('บันทึกจุดตรวจแล้ว ✓');
    setItemModal(null);
    loadItems(sel.id);
  };

  const delItem = async (it) => {
    if (!window.confirm(`ลบจุดตรวจ #${it.balloon_no} ${it.characteristic}?`)) return;
    const { error } = await supabase.from('qa_inspection_items').delete().eq('id', it.id);
    if (error) { toast.error(error.message); return; }
    toast.success('ลบแล้ว');
    loadItems(sel.id);
  };

  /* สร้างจุดควบคุม SPC จาก item ชนิด variable → ไปวัด/ดู Cp-Cpk ที่หน้า /qa */
  const sendToSPC = async (it) => {
    const { error } = await supabase.from('qa_characteristics').insert({
      part_no: sel.part_no, part_name: sel.part_name || null, line_name: sel.line_name || null,
      characteristic: it.characteristic, unit: it.unit || null,
      nominal: it.nominal, usl: it.usl, lsl: it.lsl,
      subgroup_size: 5, gauge: it.method || null,
      control_method: `Dwg ${sel.dwg_no || sel.drawing_rev || ''} balloon #${it.balloon_no}`.replace(/\s+/g, ' ').trim(),
      created_by: fullName || null,
    });
    if (error) { toast.error(`สร้างไม่สำเร็จ: ${error.message}`); return; }
    toast.success(`สร้างจุดควบคุม SPC "${it.characteristic}" แล้ว — บันทึกค่าวัดที่ Quality Control Center ✓`);
  };

  /* คลิกบน drawing: วางตำแหน่ง balloon (โหมดวาง) หรือเพิ่มจุดตรวจใหม่ตรงนั้น */
  const onDrawingClick = async (e) => {
    if (!canManage || isPdf) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = +((e.clientX - rect.left) / rect.width * 100).toFixed(2);
    const y = +((e.clientY - rect.top) / rect.height * 100).toFixed(2);
    if (placingId) {
      const { error } = await supabase.from('qa_inspection_items').update({ pos_x: x, pos_y: y }).eq('id', placingId);
      if (error) { toast.error(error.message); return; }
      setPlacingId(null);
      toast.success('วางตำแหน่ง balloon แล้ว ✓');
      loadItems(sel.id);
    } else {
      setItemModal({ ...EMPTY_ITEM, balloon_no: nextBalloon, pos_x: x, pos_y: y });
    }
  };

  const openEditItem = (it) => setItemModal({
    ...EMPTY_ITEM, ...it,
    balloon_no: it.balloon_no ?? '', nominal: it.nominal ?? '', usl: it.usl ?? '', lsl: it.lsl ?? '',
    unit: it.unit || '', spec_text: it.spec_text || '', method: it.method || '',
    frequency: it.frequency || '', sample_size: it.sample_size ?? '', rank: it.rank || '', remark: it.remark || '',
  });

  return (
    <div style={{ padding: '0 18px 30px', maxWidth: 1500, margin: '0 auto' }}>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 20, fontWeight: 900, margin: 0, fontFamily: 'var(--font-display)' }}>
          📐 มาตรฐานการตรวจ & Drawing
        </h1>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
          อัพโหลดแบบชิ้นงาน วาง balloon จุดตรวจ และกำหนดมาตรฐานการตรวจสอบต่อ part — จุด variable ส่งเข้า SPC (หน้า Quality Control Center) ได้
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(230px, 290px) 1fr', gap: 14, alignItems: 'start' }}>
        {/* ── ซ้าย: รายการ part ── */}
        <div style={{ ...cardSt, padding: 12, position: 'sticky', top: 70 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <input style={{ ...inputSt, flex: 1 }} placeholder="🔍 ค้นหา part…" value={search} onChange={e => setSearch(e.target.value)} />
            {canManage && <button style={{ ...btnSt(), padding: '8px 12px' }} title="เพิ่ม Part" onClick={() => setPartModal({ ...EMPTY_PART })}>＋</button>}
          </div>
          <div style={{ maxHeight: '65vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {shownParts.map(p => (
              <button key={p.id} onClick={() => setSelId(p.id)}
                style={{
                  textAlign: 'left', padding: '9px 10px', borderRadius: 8, cursor: 'pointer',
                  background: p.id === selId ? 'var(--accent-dim)' : 'transparent',
                  border: `1px solid ${p.id === selId ? 'var(--accent)' : 'transparent'}`,
                  opacity: p.is_active ? 1 : 0.5,
                }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: p.id === selId ? 'var(--accent)' : 'var(--text)' }}>
                  {p.part_no}{p.drawing_url ? ' 📎' : ''}{p.is_active ? '' : ' (ปิด)'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[p.part_name, p.customer].filter(Boolean).join(' · ') || '—'}
                </div>
              </button>
            ))}
            {shownParts.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12, padding: 16, textAlign: 'center' }}>ยังไม่มี part{canManage ? ' — กด ＋ เพื่อเพิ่ม' : ''}</div>}
          </div>
        </div>

        {/* ── ขวา: รายละเอียด part ── */}
        {!sel ? (
          <div style={{ ...cardSt, textAlign: 'center', color: 'var(--muted)', padding: 60 }}>เลือก part จากรายการด้านซ้าย</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            {/* header */}
            <div style={{ ...cardSt, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 900, fontSize: 17, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {sel.part_no} <span style={{ fontWeight: 500, color: 'var(--text2)' }}>{sel.part_name || ''}</span>
                  {sel.part_rank && <Chip label={PART_RANK[sel.part_rank]?.label || sel.part_rank} color={PART_RANK[sel.part_rank]?.color || '#6b7280'} />}
                  {sel.part_kind && <Chip label={PART_KIND[sel.part_kind] || sel.part_kind} color="#a78bfa" />}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {[sel.customer && `ลูกค้า: ${sel.customer}`, sel.model && `Model: ${sel.model}`, sel.line_name && `ไลน์: ${sel.line_name}`,
                    sel.dwg_no && `Dwg.No: ${sel.dwg_no}`, sel.drawing_rev && `Rev: ${sel.drawing_rev}`,
                    sel.concern_no && `Concern No: ${sel.concern_no}`,
                    sel.drawing_updated_at && `อัพเดต ${fmtDT(sel.drawing_updated_at)}`]
                    .filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              {canManage && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
                    onChange={e => { uploadDrawing(e.target.files?.[0]); e.target.value = ''; }} />
                  <button style={btnSt('#4d9fff')} disabled={uploading} onClick={() => fileRef.current?.click()}>
                    {uploading ? '⏳ กำลังอัพโหลด…' : (sel.drawing_url ? '🔄 เปลี่ยน Drawing' : '📎 อัพโหลด Drawing')}
                  </button>
                  <button style={ghostBtn} onClick={() => setPartModal({
                    ...EMPTY_PART, ...sel,
                    part_name: sel.part_name || '', customer: sel.customer || '', model: sel.model || '',
                    line_name: sel.line_name || '', dwg_no: sel.dwg_no || '', drawing_rev: sel.drawing_rev || '',
                    concern_no: sel.concern_no || '', part_rank: sel.part_rank || '', part_kind: sel.part_kind || '',
                  })}>✏️ แก้ไข Part</button>
                  <button style={{ ...ghostBtn, color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' }} onClick={delPart}>🗑 ลบ</button>
                </div>
              )}
            </div>

            {/* drawing + balloons */}
            <div style={cardSt}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5 }}>🖼 Drawing {sel.drawing_rev ? `(${sel.drawing_rev})` : ''}</div>
                {canManage && sel.drawing_url && !isPdf && (
                  <div style={{ fontSize: 11.5, color: placingId ? '#f59e0b' : 'var(--muted)', fontWeight: placingId ? 800 : 400 }}>
                    {placingId
                      ? '👆 คลิกบนแบบเพื่อวางตำแหน่ง balloon ที่เลือก (Esc/คลิกปุ่มอีกครั้งเพื่อยกเลิก)'
                      : 'คลิกบนแบบ = เพิ่มจุดตรวจใหม่ตรงตำแหน่งนั้น · คลิก balloon = แก้ไขจุดตรวจ'}
                  </div>
                )}
              </div>
              {!sel.drawing_url ? (
                <div style={{ padding: 46, textAlign: 'center', color: 'var(--muted)', fontSize: 13, border: '2px dashed var(--border2)', borderRadius: 10 }}>
                  ยังไม่มี drawing — {canManage ? 'กด "📎 อัพโหลด Drawing" (รูปภาพหรือ PDF ≤20MB)' : 'รอ QA อัพโหลด'}
                </div>
              ) : isPdf ? (
                <div>
                  <iframe src={sel.drawing_url} title="drawing" style={{ width: '100%', height: 520, border: '1px solid var(--border2)', borderRadius: 10, background: '#fff' }} />
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
                    ไฟล์ PDF วาง balloon บนแบบไม่ได้ — ถ้าต้องการ balloon ให้อัพโหลดเป็นรูปภาพ (PNG/JPG) · <a href={sel.drawing_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>เปิดเต็มจอ ↗</a>
                  </div>
                </div>
              ) : (
                <div
                  onClick={onDrawingClick}
                  style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', cursor: canManage ? 'crosshair' : 'default', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border2)' }}>
                  <img src={sel.drawing_url} alt={sel.part_no} style={{ display: 'block', maxWidth: '100%' }} />
                  {items.filter(i => i.pos_x != null && i.pos_y != null).map(i => (
                    <div key={i.id}
                      title={`#${i.balloon_no} ${i.characteristic}${i.spec_text ? ` · ${i.spec_text}` : ''}`}
                      onClick={e => { e.stopPropagation(); if (canManage) openEditItem(i); }}
                      style={{
                        position: 'absolute', left: `${i.pos_x}%`, top: `${i.pos_y}%`, transform: 'translate(-50%, -50%)',
                        minWidth: 26, height: 26, padding: '0 5px', borderRadius: 999,
                        background: i.id === placingId ? '#f59e0b' : (i.rank ? RANK[i.rank]?.color : '#4d9fff'),
                        color: '#fff', fontWeight: 900, fontSize: 11,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: '2px solid #fff', boxShadow: '0 1px 5px rgba(0,0,0,0.45)',
                        cursor: 'pointer', opacity: i.is_active ? 1 : 0.45, whiteSpace: 'nowrap',
                      }}>
                      {i.balloon_no}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ตารางจุดตรวจ */}
            <div style={{ ...cardSt, padding: 0 }}>
              <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5 }}>
                  📋 มาตรฐานการตรวจ ({items.length} จุด
                  {items.some(i => i.rank) ? ` · Rank M ${items.filter(i => i.rank === 'M').length} / SC ${items.filter(i => i.rank === 'SC').length}` : ''})
                </div>
                {canManage && <button style={btnSt()} onClick={() => setItemModal({ ...EMPTY_ITEM, balloon_no: nextBalloon })}>+ เพิ่มจุดตรวจ</button>}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
                  <thead><tr>
                    <th style={thSt}>No.</th><th style={thSt}>Inspection item</th><th style={thSt}>ชนิด</th>
                    <th style={thSt}>Quality standard</th><th style={thSt}>Inspection equipment</th>
                    <th style={thSt}>Rank</th><th style={thSt}>Stage</th><th style={thSt}>ความถี่ / n</th>
                    {canManage && <th style={thSt}></th>}
                  </tr></thead>
                  <tbody>
                    {items.map(it => (
                      <tr key={it.id} style={{ opacity: it.is_active ? 1 : 0.45 }}>
                        <td style={{ ...tdSt, fontWeight: 900, whiteSpace: 'nowrap' }}>
                          <span style={{ color: it.rank ? RANK[it.rank]?.color : '#4d9fff' }}>{it.rank ? '◆' : '●'} {it.balloon_no}</span>
                          {it.pos_x == null && <span title="ยังไม่วางบน drawing" style={{ marginLeft: 4, fontSize: 10, color: 'var(--muted)' }}>∅</span>}
                        </td>
                        <td style={tdSt}>{it.characteristic}{it.remark ? <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{it.remark}</div> : null}</td>
                        <td style={tdSt}><Chip label={it.item_type === 'variable' ? 'Variable' : 'Attribute'} color={it.item_type === 'variable' ? '#4d9fff' : '#a78bfa'} /></td>
                        <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>
                          {it.spec_text || (it.item_type === 'variable'
                            ? [it.lsl != null ? `LSL ${it.lsl}` : null, it.nominal != null ? `${it.nominal}` : null, it.usl != null ? `USL ${it.usl}` : null].filter(Boolean).join(' / ') || '—'
                            : 'GO / NOGO')}
                          {it.unit ? ` ${it.unit}` : ''}
                        </td>
                        <td style={tdSt}>{it.method || '—'}</td>
                        <td style={tdSt}>{it.rank ? <Chip label={it.rank} color={RANK[it.rank]?.color || '#6b7280'} /> : '—'}</td>
                        <td style={tdSt}><Chip label={STAGE[it.stage]?.label || it.stage} color={STAGE[it.stage]?.color || '#6b7280'} /></td>
                        <td style={tdSt}>{[it.frequency, it.sample_size != null ? `n=${it.sample_size}` : null].filter(Boolean).join(' · ') || '—'}</td>
                        {canManage && (
                          <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>
                            {!isPdf && sel.drawing_url && (
                              <button title="วาง/ย้ายตำแหน่งบน drawing" onClick={() => setPlacingId(p => p === it.id ? null : it.id)}
                                style={{ background: placingId === it.id ? '#f59e0b' : 'none', border: 'none', cursor: 'pointer', fontSize: 13, borderRadius: 5, padding: '2px 4px' }}>📍</button>
                            )}
                            <button title="แก้ไข" onClick={() => openEditItem(it)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>✏️</button>
                            {it.item_type === 'variable' && (
                              <button title="สร้างจุดควบคุม SPC จากจุดตรวจนี้" onClick={() => sendToSPC(it)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--accent)', fontWeight: 800 }}>→SPC</button>
                            )}
                            <button title="ลบ" onClick={() => delItem(it)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#ef4444' }}>🗑</button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {items.length === 0 && (
                      <tr><td style={tdSt} colSpan={9}>
                        <span style={{ color: 'var(--muted)' }}>ยังไม่มีจุดตรวจ{canManage ? ' — กด "+ เพิ่มจุดตรวจ" หรือคลิกบน drawing' : ''}</span>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Part modal ── */}
      {partModal && (
        <Modal title={partModal.id ? `✏️ แก้ไข ${partModal.part_no}` : '➕ เพิ่ม Part'} onClose={() => { setPartModal(null); setBomSearch(''); }}>
          {/* เลือกจากฐานข้อมูล BOM / Product Master → เติมฟอร์มให้ (แก้ทับได้) */}
          <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: 'var(--bg3)', border: '1px dashed var(--border2)' }}>
            <Field label="🔍 เลือกจากฐานข้อมูล BOM / Product Master">
              <input style={inputSt} value={bomSearch} onChange={e => setBomSearch(e.target.value)}
                placeholder={bomOptions === null ? 'กำลังโหลดฐานข้อมูล…' : `พิมพ์ค้นหา Part No. / ชื่อพาร์ท / MAT.NO (${bomOptions.length.toLocaleString()} รายการ)`} />
            </Field>
            {bomSearch.trim().length >= 2 && (
              <div style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {bomMatches.map(o => (
                  <button key={o.key} onClick={() => pickBomOption(o)}
                    style={{
                      textAlign: 'left', padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                      background: 'var(--card)', border: '1px solid var(--border)',
                      display: 'flex', gap: 8, alignItems: 'center',
                    }}>
                    <Chip label={o.tag} color={o.tag === 'BOM' ? '#f59e0b' : '#4d9fff'} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)' }}>{o.part_no || '—'} <span style={{ fontWeight: 500, color: 'var(--text2)' }}>{o.part_name}</span></div>
                      {o.sub && <div style={{ fontSize: 10.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.sub}</div>}
                    </div>
                  </button>
                ))}
                {bomMatches.length === 0 && bomOptions !== null && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 2px' }}>ไม่พบ — กรอกเองด้านล่างได้เลย</div>
                )}
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Part No. *"><input style={inputSt} value={partModal.part_no} onChange={e => setPartModal(f => ({ ...f, part_no: e.target.value }))} /></Field>
            <Field label="Part Name"><input style={inputSt} value={partModal.part_name} onChange={e => setPartModal(f => ({ ...f, part_name: e.target.value }))} /></Field>
            <Field label="ลูกค้า"><input style={inputSt} value={partModal.customer} onChange={e => setPartModal(f => ({ ...f, customer: e.target.value }))} /></Field>
            <Field label="Model"><input style={inputSt} value={partModal.model} onChange={e => setPartModal(f => ({ ...f, model: e.target.value }))} /></Field>
            <Field label="ไลน์ผลิต">
              <select style={inputSt} value={partModal.line_name} onChange={e => setPartModal(f => ({ ...f, line_name: e.target.value }))}>
                <option value="">— ไม่ระบุ —</option>
                {lines.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
            <Field label="Dwg. No."><input style={inputSt} placeholder="เช่น 97/3" value={partModal.dwg_no} onChange={e => setPartModal(f => ({ ...f, dwg_no: e.target.value }))} /></Field>
            <Field label="Revision"><input style={inputSt} placeholder="เช่น 01" value={partModal.drawing_rev} onChange={e => setPartModal(f => ({ ...f, drawing_rev: e.target.value }))} /></Field>
            <Field label="Concern No."><input style={inputSt} placeholder="เช่น C14225724" value={partModal.concern_no} onChange={e => setPartModal(f => ({ ...f, concern_no: e.target.value }))} /></Field>
            <Field label="Part Classification">
              <select style={inputSt} value={partModal.part_rank} onChange={e => setPartModal(f => ({ ...f, part_rank: e.target.value }))}>
                <option value="">— ไม่ระบุ —</option>
                {Object.entries(PART_RANK).map(([v, r]) => <option key={v} value={v}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="ชนิด Part">
              <select style={inputSt} value={partModal.part_kind} onChange={e => setPartModal(f => ({ ...f, part_kind: e.target.value }))}>
                <option value="">— ไม่ระบุ —</option>
                {Object.entries(PART_KIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            {partModal.id && (
              <Field label="สถานะ">
                <select style={inputSt} value={partModal.is_active ? '1' : '0'} onChange={e => setPartModal(f => ({ ...f, is_active: e.target.value === '1' }))}>
                  <option value="1">ใช้งาน</option><option value="0">ปิดใช้งาน</option>
                </select>
              </Field>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button style={ghostBtn} onClick={() => setPartModal(null)}>ยกเลิก</button>
            <button style={btnSt()} onClick={savePart}>บันทึก</button>
          </div>
        </Modal>
      )}

      {/* ── Item modal ── */}
      {itemModal && (
        <Modal title={itemModal.id ? `✏️ จุดตรวจ #${itemModal.balloon_no}` : `➕ เพิ่มจุดตรวจ #${itemModal.balloon_no}`} onClose={() => setItemModal(null)} width={620}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="No. (balloon)"><input style={inputSt} placeholder="เช่น H35, A1, 7" value={itemModal.balloon_no} onChange={e => setItemModal(f => ({ ...f, balloon_no: e.target.value }))} /></Field>
            <Field label="ชนิด">
              <select style={inputSt} value={itemModal.item_type} onChange={e => setItemModal(f => ({ ...f, item_type: e.target.value }))}>
                <option value="variable">Variable (ค่าตัวเลข)</option>
                <option value="attribute">Attribute (GO/NOGO)</option>
              </select>
            </Field>
            <Field label="Rank (◆ M / SC)">
              <select style={inputSt} value={itemModal.rank} onChange={e => setItemModal(f => ({ ...f, rank: e.target.value }))}>
                <option value="">— ไม่ระบุ —</option>
                <option value="M">M</option>
                <option value="SC">SC (Significant Characteristic)</option>
              </select>
            </Field>
            <Field label="ชื่อจุดตรวจ / Characteristic *" span>
              <input style={inputSt} placeholder="เช่น ความกว้างร่อง A / ไม่มีครีบบริเวณขอบตัด" value={itemModal.characteristic} onChange={e => setItemModal(f => ({ ...f, characteristic: e.target.value }))} />
            </Field>
            <Field label="Quality standard (ข้อความตามแบบ)" span>
              <input style={inputSt} placeholder='เช่น "5 ± 1.5", "0 ≤ 0.3" หรือ "GO / NOGO"' value={itemModal.spec_text} onChange={e => setItemModal(f => ({ ...f, spec_text: e.target.value }))} />
            </Field>
            {itemModal.item_type === 'variable' && (
              <>
                <Field label="LSL"><input type="number" step="any" style={inputSt} value={itemModal.lsl} onChange={e => setItemModal(f => ({ ...f, lsl: e.target.value }))} /></Field>
                <Field label="Nominal"><input type="number" step="any" style={inputSt} value={itemModal.nominal} onChange={e => setItemModal(f => ({ ...f, nominal: e.target.value }))} /></Field>
                <Field label="USL"><input type="number" step="any" style={inputSt} value={itemModal.usl} onChange={e => setItemModal(f => ({ ...f, usl: e.target.value }))} /></Field>
                <Field label="หน่วย"><input style={inputSt} value={itemModal.unit} onChange={e => setItemModal(f => ({ ...f, unit: e.target.value }))} /></Field>
              </>
            )}
            <Field label="วิธี / เครื่องมือตรวจ">
              <input style={inputSt} placeholder="Vernier / CF / Visual" value={itemModal.method} onChange={e => setItemModal(f => ({ ...f, method: e.target.value }))} />
            </Field>
            <Field label="Stage การตรวจ">
              <select style={inputSt} value={itemModal.stage} onChange={e => setItemModal(f => ({ ...f, stage: e.target.value }))}>
                {Object.entries(STAGE).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="ความถี่"><input style={inputSt} placeholder='เช่น "5 ชิ้น/กะ"' value={itemModal.frequency} onChange={e => setItemModal(f => ({ ...f, frequency: e.target.value }))} /></Field>
            <Field label="Sample size (n)"><input type="number" min="1" style={inputSt} value={itemModal.sample_size} onChange={e => setItemModal(f => ({ ...f, sample_size: e.target.value }))} /></Field>
            <Field label="หมายเหตุ" span><input style={inputSt} value={itemModal.remark} onChange={e => setItemModal(f => ({ ...f, remark: e.target.value }))} /></Field>
            {itemModal.id && (
              <Field label="สถานะ">
                <select style={inputSt} value={itemModal.is_active ? '1' : '0'} onChange={e => setItemModal(f => ({ ...f, is_active: e.target.value === '1' }))}>
                  <option value="1">ใช้งาน</option><option value="0">ปิดใช้งาน</option>
                </select>
              </Field>
            )}
          </div>
          {itemModal.pos_x != null && !itemModal.id && (
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10 }}>📍 จะวาง balloon ที่ตำแหน่ง ({itemModal.pos_x}%, {itemModal.pos_y}%) บน drawing</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button style={ghostBtn} onClick={() => setItemModal(null)}>ยกเลิก</button>
            <button style={btnSt()} onClick={saveItem}>บันทึก</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
