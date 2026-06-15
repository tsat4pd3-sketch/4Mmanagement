import { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';

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

const BLANK = () => ({ name: '', code: '', mat_no: '', p_no: '', customer: '', line_name: '', cycle_time_sec: '', target_per_shift: '', process_type: 'welding_assembly', is_active: true, effective_from: '' });

/* ── Quick-link chips to connected modules ── */
function RelatedLinks({ matNo, productId }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
      <Link to="/bom" title="ดู/แก้ไข BOM ของ product นี้" style={{ fontSize: 10, padding: '2px 9px', borderRadius: 10, background: 'rgba(61,214,92,0.1)', color: 'var(--accent)', textDecoration: 'none', fontWeight: 700 }}>📦 BOM</Link>
      <Link to="/heijunka" title="ดู Heijunka Kanban demand" style={{ fontSize: 10, padding: '2px 9px', borderRadius: 10, background: 'rgba(245,158,11,0.1)', color: '#f59e0b', textDecoration: 'none', fontWeight: 700 }}>🎴 Kanban</Link>
      <Link to="/daily-report" title="บันทึกการผลิต" style={{ fontSize: 10, padding: '2px 9px', borderRadius: 10, background: 'rgba(14,165,233,0.1)', color: '#38bdf8', textDecoration: 'none', fontWeight: 700 }}>📊 Daily Report</Link>
    </div>
  );
}

export default function ProductMaster() {
  const { role } = useContext(UserContext);
  const canEdit  = ['admin', 'manager', 'supervisor'].includes(role);

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

  const [kanbanEditing, setKanbanEditing] = useState(null);
  const [kanbanForm,    setKanbanForm]    = useState({ product_id: '', mat_no: '', qty_per_kanban: 1, is_active: true });
  const [kanbanSaving,  setKanbanSaving]  = useState(false);

  const [search,      setSearch]      = useState('');
  const [lineFilter,  setLineFilter]  = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [expandedFamilies, setExpandedFamilies] = useState({});

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
    setForm(item ? {
      name: item.name, code: item.code || '', mat_no: item.mat_no || '', p_no: item.p_no || '',
      customer: item.customer || '', line_name: item.line_name || '',
      cycle_time_sec: item.cycle_time_sec || '', target_per_shift: item.target_per_shift || '',
      process_type: item.process_type || 'welding_assembly', is_active: item.is_active, effective_from: item.effective_from || '',
    } : BLANK());
  };

  const openEC = (item) => {
    setEcSource(item);
    setEditing('new');
    setForm({
      name: item.name, code: item.code || '', mat_no: '', p_no: '',
      customer: item.customer || '', line_name: item.line_name || '',
      cycle_time_sec: item.cycle_time_sec || '', target_per_shift: item.target_per_shift || '',
      process_type: item.process_type || 'welding_assembly', is_active: true,
      effective_from: new Date().toISOString().slice(0, 10),
    });
  };

  const handleSave = async () => {
    if (!form.name) { toast.error('กรอกชื่อสินค้า'); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(), code: form.code.trim() || null,
      mat_no: form.mat_no.trim().toUpperCase() || null, p_no: form.p_no.trim() || null,
      customer: form.customer.trim() || null, line_name: form.line_name || null,
      cycle_time_sec: form.cycle_time_sec ? parseFloat(form.cycle_time_sec) : null,
      target_per_shift: form.target_per_shift ? parseInt(form.target_per_shift) : null,
      process_type: form.process_type || 'welding_assembly',
      is_active: form.is_active,
      effective_from: form.effective_from || null,
    };
    if (editing === 'new') {
      if (ecSource) payload.family_id = ecSource.family_id;
      const { data: inserted, error } = await supabaseDR.from('dr_products').insert(payload).select().single();
      if (error) { setSaving(false); toast.error(error.message); return; }
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
    setEditing(null); setEcSource(null);
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('ลบสินค้านี้?')) return;
    const { error } = await supabaseDR.from('dr_products').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  /* ── kanban CRUD ── */
  const openKanbanEdit = (std = null, defaultProductId = '') => {
    setKanbanEditing(std?.id || 'new');
    setKanbanForm(std
      ? { product_id: std.product_id || '', mat_no: std.mat_no || '', qty_per_kanban: std.qty_per_kanban || 1, is_active: std.is_active }
      : { product_id: defaultProductId, mat_no: '', qty_per_kanban: 1, is_active: true });
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

  return (
    <div style={{ padding: 'clamp(12px, 2vw, 24px)', maxWidth: 1200, margin: '0 auto' }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(18px, 2.5vw, 24px)', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
          🔩 Product Master
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
          ฐานข้อมูลกลาง Product/Model · เชื่อมกับ{' '}
          <Link to="/daily-report" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Daily Report</Link>,{' '}
          <Link to="/bom" style={{ color: 'var(--accent)', textDecoration: 'none' }}>BOM</Link>,{' '}
          <Link to="/heijunka" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Heijunka Kanban</Link> และ{' '}
          <Link to="/oee-analytics" style={{ color: 'var(--accent)', textDecoration: 'none' }}>OEE Analytics</Link>
        </p>
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
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{families.length} model · {activeCount} ใช้งาน</span>
        {canEdit && <button onClick={() => openEdit()} style={btnPrimary}>+ เพิ่มสินค้า</button>}
      </div>

      {/* ── Family cards ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {visibleFamilies.length === 0 && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 14, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12 }}>
            ไม่พบ product ที่ตรงเงื่อนไข
          </div>
        )}
        {visibleFamilies.map(({ family_id, members }) => {
          const active   = members.find(m => m.is_active && !m.superseded_by);
          const archived = members.filter(m => !m.is_active || m.superseded_by);
          const item     = active || members[0];
          const totalQty = familyTotals[family_id] || 0;
          const isExpandedKanban = expandedFamilies[family_id] !== false;

          const familyProductIds = new Set(members.map(m => m.id));
          const stds = kanbanStds.filter(s => s.product_id && familyProductIds.has(s.product_id));
          const totalBom = members.reduce((s, m) => s + (bomCounts[m.id] || 0), 0);

          return (
            <div key={family_id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              {/* Active revision row */}
              <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{item.name}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                      background: item.process_type === 'metal_forming' ? 'rgba(251,191,36,0.15)' : 'rgba(34,197,94,0.12)',
                      color: item.process_type === 'metal_forming' ? '#fbbf24' : '#22c55e' }}>
                      {item.process_type === 'metal_forming' ? '⚙ Metal Forming' : '🔥 Welding/Assy'}
                    </span>
                    {members.length > 1 && <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 20, background: 'rgba(168,85,247,0.12)', color: '#a855f7', fontWeight: 700 }}>🔄 {members.length} revisions</span>}
                    {!active && <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 20, background: 'rgba(107,114,128,0.15)', color: '#6b7280', fontWeight: 700 }}>ปิดใช้งาน</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
                    {item.mat_no && <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: '#0ea5e9' }}>{item.mat_no}</span>}
                    {item.p_no   && <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text2)' }}>P.NO: {item.p_no}</span>}
                    {item.customer && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: 'rgba(59,130,246,0.1)', color: '#60a5fa' }}>{item.customer}</span>}
                    {item.code && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: 'var(--bg2)', color: 'var(--muted)' }}>{item.code}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {[
                      item.line_name && `📍 ${item.line_name}`,
                      item.cycle_time_sec && `CT ${item.cycle_time_sec}s`,
                      item.target_per_shift && `Target ${item.target_per_shift}/กะ`,
                      item.effective_from && `ใช้ตั้งแต่ ${item.effective_from}`,
                    ].filter(Boolean).join(' · ')}
                  </div>

                  {/* Cross-module indicators */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {totalQty > 0 && <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 700 }}>📦 ยอดสะสม {totalQty.toLocaleString()} ชิ้น</span>}
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: totalBom > 0 ? 'rgba(61,214,92,0.1)' : 'rgba(107,114,128,0.08)', color: totalBom > 0 ? 'var(--accent)' : 'var(--muted)', fontWeight: 700 }}>
                      📦 BOM: {totalBom > 0 ? `${totalBom} พาร์ท` : 'ยังไม่มี'}
                    </span>
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: stds.filter(s => s.is_active).length > 0 ? 'rgba(245,158,11,0.1)' : 'rgba(107,114,128,0.08)', color: stds.filter(s => s.is_active).length > 0 ? '#f59e0b' : 'var(--muted)', fontWeight: 700 }}>
                      🎴 Kanban: {stds.filter(s => s.is_active).length > 0 ? `${stds.filter(s => s.is_active).length} mat` : 'ยังไม่มี'}
                    </span>
                  </div>
                  <RelatedLinks matNo={item.mat_no} productId={item.id} />
                </div>

                {canEdit && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'flex-start' }}>
                    {active && (
                      <button onClick={() => openEC(active)} title="Engineering Change — สร้าง revision ใหม่" style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: '#a855f7', fontWeight: 700 }}>🔄 EC</button>
                    )}
                    <button onClick={() => openEdit(item)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>
                    <button onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}>✕</button>
                  </div>
                )}
              </div>

              {/* Revision history */}
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

              {/* Kanban Standards inline */}
              <div style={{ borderTop: '1px solid var(--border)' }}>
                <button
                  onClick={() => setExpandedFamilies(prev => ({ ...prev, [family_id]: !isExpandedKanban }))}
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
                      <button onClick={() => openKanbanEdit(null, active?.id || members[0]?.id || '')}
                        style={{ alignSelf: 'flex-start', marginTop: 2, background: 'rgba(14,165,233,0.08)', border: '1px dashed rgba(14,165,233,0.4)', borderRadius: 6, padding: '4px 12px', fontSize: 11, color: '#0ea5e9', cursor: 'pointer', fontWeight: 700 }}>
                        + เพิ่ม MAT.NO
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ════ Add / Edit / EC modal ════ */}
      {editing && (
        <div onClick={() => { setEditing(null); setEcSource(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: `1px solid ${ecSource ? 'rgba(168,85,247,0.5)' : 'var(--border2)'}`, borderRadius: 14, padding: 24, width: 'min(95vw,480px)', maxHeight: '90vh', overflowY: 'auto' }}>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Cycle Time (วินาที)"><input type="number" min="0" step="0.1" value={form.cycle_time_sec} onChange={e => setForm(f => ({ ...f, cycle_time_sec: e.target.value }))} placeholder="เช่น 45.5" style={inputSt} /></Field>
                <Field label="Target ต่อกะ (ชิ้น)"><input type="number" min="0" value={form.target_per_shift} onChange={e => setForm(f => ({ ...f, target_per_shift: e.target.value }))} placeholder="เช่น 500" style={inputSt} /></Field>
              </div>
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
                {saving ? '...' : ecSource ? '🔄 บันทึก EC' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════ Kanban Standard modal ════ */}
      {kanbanEditing && (
        <div onClick={() => setKanbanEditing(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid rgba(14,165,233,0.4)', borderRadius: 14, padding: 24, width: 'min(95vw,380px)' }}>
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
    </div>
  );
}
