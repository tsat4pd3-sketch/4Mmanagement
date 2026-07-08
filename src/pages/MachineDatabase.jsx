import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';

/* ─── shared little UI bits ─────────────────────────────────── */
function Field({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
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

const emptyMachine = { id: null, line_name: '', machine_no: '', machine_name: '', machine_type_id: '', sort_order: 0, is_active: true };
const emptyType    = { id: null, label: '', color: '#4d9fff', icon: '', sort_order: 0, is_active: true };
const TYPE_COLORS  = ['#4d9fff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#06b6d4', '#84cc16', '#6b7280'];

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════════════ */
export default function MachineDatabase() {
  const { role } = useContext(UserContext);
  const canCreate = can('machines', 'create', role);
  const canEdit   = can('machines', 'edit', role);
  const canDelete = can('machines', 'delete', role);

  const [machines, setMachines]     = useState([]);
  const [lines, setLines]           = useState([]);
  const [types, setTypes]           = useState([]);
  const [loading, setLoading]       = useState(true);

  const [search, setSearch]         = useState('');
  const [filterLine, setFilterLine] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const [editing, setEditing]       = useState(null); // machine form object, or null
  const [saving, setSaving]         = useState(false);
  const [showTypeManager, setShowTypeManager] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: mc }, { data: ln }, { data: mt }] = await Promise.all([
      supabaseDR.from('machines').select('*, machine_types(id, label, color, icon)').order('line_name').order('sort_order'),
      supabase.from('production_lines').select('id, name, section, parent_line_name').order('name'),
      supabaseDR.from('machine_types').select('*').order('sort_order'),
    ]);
    setMachines(mc || []);
    setLines(ln || []);
    setTypes(mt || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const parentChildrenMap = useMemo(() => {
    const pcm = {};
    lines.forEach(l => {
      if (l.parent_line_name) {
        if (!pcm[l.parent_line_name]) pcm[l.parent_line_name] = [];
        pcm[l.parent_line_name].push(l.name);
      }
    });
    return pcm;
  }, [lines]);

  const filtered = useMemo(() => machines
    .filter(m => showInactive || m.is_active)
    .filter(m => !filterLine || m.line_name === filterLine)
    .filter(m => !filterType || m.machine_type_id === filterType)
    .filter(m => !search.trim() || [m.machine_no, m.machine_name].some(v => (v || '').toLowerCase().includes(search.trim().toLowerCase())))
  , [machines, showInactive, filterLine, filterType, search]);

  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach(m => { (map[m.line_name] ||= []).push(m); });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  /* ── machine CRUD ── */
  const openEdit = (item = null) => {
    setEditing(item
      ? { id: item.id, line_name: item.line_name, machine_no: item.machine_no, machine_name: item.machine_name || '', machine_type_id: item.machine_type_id || '', sort_order: item.sort_order ?? 0, is_active: item.is_active }
      : { ...emptyMachine, line_name: filterLine || '', sort_order: machines.length + 1 });
  };

  const handleSave = async () => {
    if (!editing.line_name)  { toast.error('เลือกไลน์'); return; }
    if (!editing.machine_no.trim()) { toast.error('กรอกหมายเลขเครื่อง'); return; }
    setSaving(true);
    const payload = {
      line_name:        editing.line_name,
      machine_no:        editing.machine_no.trim().toUpperCase(),
      machine_name:      editing.machine_name || null,
      machine_type_id:   editing.machine_type_id || null,
      sort_order:        parseInt(editing.sort_order) || 0,
      is_active:         editing.is_active,
      updated_at:        new Date().toISOString(),
    };
    const { error } = editing.id
      ? await supabaseDR.from('machines').update(payload).eq('id', editing.id)
      : await supabaseDR.from('machines').insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('บันทึกสำเร็จ');
    setEditing(null);
    load();
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`ลบเครื่องจักร "${item.machine_no}" ?\n\nจุดบนผังไลน์และประวัติ Downtime ที่อ้างอิงเครื่องนี้จะยังอยู่ แต่จะเลือกเครื่องนี้ใหม่ไม่ได้`)) return;
    const { error } = await supabaseDR.from('machines').delete().eq('id', item.id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  if (loading) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>กำลังโหลด...</div>;

  return (
    <div style={{ padding: 'clamp(12px,3vw,28px)', maxWidth: 'min(96vw, 2000px)', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 'clamp(18px,3vw,26px)', fontWeight: 800, color: 'var(--text)', margin: 0 }}>
            🏭 ฐานข้อมูลเครื่องจักร
          </h1>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            รายการเครื่องจักรทุกไลน์ · {machines.filter(m => m.is_active).length} เครื่องที่ใช้งานอยู่
          </div>
        </div>
        {(canEdit || canCreate) && (
          <div style={{ display: 'flex', gap: 8 }}>
            {canEdit && <button onClick={() => setShowTypeManager(true)} style={cancelBtnStyle}>🏷️ จัดการประเภทเครื่องจักร</button>}
            {canCreate && <button onClick={() => openEdit()} style={saveBtnStyle}>+ เพิ่มเครื่องจักร</button>}
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <input placeholder="🔍 ค้นหาหมายเลข/ชื่อเครื่อง" value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, width: 220 }} />
        <select value={filterLine} onChange={e => setFilterLine(e.target.value)} style={{ ...inputStyle, width: 180 }}>
          <option value="">— ทุกไลน์ —</option>
          {lines.filter(l => !l.parent_line_name && !parentChildrenMap[l.name]).map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
          {Object.entries(parentChildrenMap).map(([parent, children]) => (
            <optgroup key={parent} label={`▸ ${parent}`}>
              <option value={parent}>{parent}</option>
              {children.map(c => <option key={c} value={c}>{c}</option>)}
            </optgroup>
          ))}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ ...inputStyle, width: 180 }}>
          <option value="">— ทุกประเภท —</option>
          {types.map(t => <option key={t.id} value={t.id}>{t.icon || ''} {t.label}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          แสดงที่ปิดใช้งาน
        </label>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>{filtered.length} เครื่อง</div>
      </div>

      {grouped.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)', fontSize: 13 }}>ไม่พบเครื่องจักร</div>
      )}

      {grouped.map(([lineName, items]) => (
        <div key={lineName} style={{ marginBottom: 18, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>⚙️ {lineName}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>{items.length} เครื่อง</span>
          </div>
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map(item => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, opacity: item.is_active ? 1 : 0.5 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>{item.machine_no}</span>
                    {item.machine_name && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{item.machine_name}</span>}
                    {item.machine_types && (
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: `${item.machine_types.color}22`, color: item.machine_types.color, fontWeight: 700 }}>
                        {item.machine_types.icon || ''} {item.machine_types.label}
                      </span>
                    )}
                    {!item.machine_type_id && <span style={{ fontSize: 10, color: '#f59e0b' }}>ยังไม่ระบุประเภท</span>}
                    {!item.is_active && <span style={{ fontSize: 10, color: '#ef4444' }}>(ปิดใช้)</span>}
                  </div>
                </div>
                {(canEdit || canDelete) && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {canEdit && <button onClick={() => openEdit(item)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>}
                    {canDelete && <button onClick={() => handleDelete(item)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 15 }}>✕</button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Add/Edit machine modal */}
      {editing && (
        <div className="overlay" style={{ zIndex: 2000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(95vw,420px)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 20, color: 'var(--text)' }}>
              {editing.id ? 'แก้ไขเครื่องจักร' : '+ เพิ่มเครื่องจักร'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="ไลน์การผลิต *">
                <select value={editing.line_name} onChange={e => setEditing(f => ({ ...f, line_name: e.target.value }))} style={inputStyle}>
                  <option value="">— เลือกไลน์ —</option>
                  {lines.filter(l => !l.parent_line_name && !parentChildrenMap[l.name]).map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                  {Object.entries(parentChildrenMap).map(([parent, children]) => (
                    <optgroup key={parent} label={`▸ ${parent}`}>
                      {children.map(c => <option key={c} value={c}>{c}</option>)}
                    </optgroup>
                  ))}
                </select>
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="หมายเลขเครื่อง *">
                  <input autoFocus value={editing.machine_no} onChange={e => setEditing(f => ({ ...f, machine_no: e.target.value.toUpperCase() }))} placeholder="เช่น HDF-01" style={{ ...inputStyle, fontFamily: 'monospace', fontWeight: 700 }} />
                </Field>
                <Field label="ชื่อเครื่อง / รุ่น">
                  <input value={editing.machine_name} onChange={e => setEditing(f => ({ ...f, machine_name: e.target.value }))} placeholder="เช่น CO2 Welder" style={inputStyle} />
                </Field>
              </div>
              <Field label="ประเภทเครื่องจักร">
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={editing.machine_type_id} onChange={e => setEditing(f => ({ ...f, machine_type_id: e.target.value }))} style={inputStyle}>
                    <option value="">— ไม่ระบุ —</option>
                    {types.map(t => <option key={t.id} value={t.id}>{t.icon || ''} {t.label}</option>)}
                  </select>
                  <button type="button" onClick={() => setShowTypeManager(true)}
                    style={{ ...cancelBtnStyle, padding: '8px 12px', whiteSpace: 'nowrap' }}>
                    + ประเภทใหม่
                  </button>
                </div>
              </Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={editing.is_active} onChange={e => setEditing(f => ({ ...f, is_active: e.target.checked }))} />
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

      {/* Machine type manager modal */}
      {showTypeManager && (
        <MachineTypeManager
          types={types}
          canEdit={canEdit}
          onClose={() => setShowTypeManager(false)}
          onChange={load}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MACHINE TYPE MANAGER — user-defined taxonomy, no hardcoded enum
═══════════════════════════════════════════════════════════════ */
function MachineTypeManager({ types, canEdit, onClose, onChange }) {
  const [form, setForm] = useState(emptyType);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const startAdd = () => { setForm({ ...emptyType, sort_order: types.length + 1 }); setEditingId('new'); };
  const startEdit = (t) => { setForm({ id: t.id, label: t.label, color: t.color, icon: t.icon || '', sort_order: t.sort_order, is_active: t.is_active }); setEditingId(t.id); };
  const cancelEdit = () => { setEditingId(null); setForm(emptyType); };

  const handleSave = async () => {
    if (!form.label.trim()) { toast.error('กรอกชื่อประเภท'); return; }
    setSaving(true);
    const payload = { label: form.label.trim(), color: form.color, icon: form.icon.trim() || null, sort_order: parseInt(form.sort_order) || 0, is_active: form.is_active };
    const { error } = editingId === 'new'
      ? await supabaseDR.from('machine_types').insert(payload)
      : await supabaseDR.from('machine_types').update(payload).eq('id', editingId);
    setSaving(false);
    if (error) { toast.error(error.message.includes('duplicate') ? 'มีชื่อประเภทนี้อยู่แล้ว' : error.message); return; }
    toast.success('บันทึกสำเร็จ');
    cancelEdit();
    onChange();
  };

  const handleDelete = async (t) => {
    if (!window.confirm(`ลบประเภท "${t.label}" ?\n\nเครื่องจักรที่ใช้ประเภทนี้จะกลายเป็น "ไม่ระบุประเภท"`)) return;
    const { error } = await supabaseDR.from('machine_types').delete().eq('id', t.id);
    if (error) { toast.error(error.message); return; }
    onChange();
  };

  return (
    <div className="overlay" style={{ zIndex: 2100 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(95vw,460px)', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>🏷️ ประเภทเครื่องจักร</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
          สร้างประเภทเองได้ไม่จำกัด เช่น แยก "Robot" ออกเป็น "Robot - Arc Welding" / "Robot - Handling"
        </div>

        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
          {types.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ width: 12, height: 12, borderRadius: 4, background: t.color, flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>{t.icon || ''} {t.label}</span>
              {canEdit && (
                <>
                  <button onClick={() => startEdit(t)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 9px', fontSize: 11, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>
                  <button onClick={() => handleDelete(t)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}>🗑️</button>
                </>
              )}
            </div>
          ))}
          {types.length === 0 && <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--muted)', fontSize: 12 }}>ยังไม่มีประเภทเครื่องจักร</div>}
        </div>

        {canEdit && (
          editingId ? (
            <div style={{ background: 'var(--bg2)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input autoFocus placeholder="ชื่อประเภท เช่น Robot - Arc Welding" value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))} style={inputStyle} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input placeholder="ไอคอน (emoji)" value={form.icon} maxLength={4}
                  onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} style={{ ...inputStyle, width: 90 }} />
                <div style={{ display: 'flex', gap: 5 }}>
                  {TYPE_COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                      style={{ width: 20, height: 20, borderRadius: 5, background: c, border: form.color === c ? '2px solid var(--text)' : '2px solid transparent', cursor: 'pointer' }} />
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleSave} disabled={saving} style={{ ...saveBtnStyle, flex: 1, opacity: saving ? 0.6 : 1 }}>{saving ? '...' : 'บันทึก'}</button>
                <button onClick={cancelEdit} style={cancelBtnStyle}>ยกเลิก</button>
              </div>
            </div>
          ) : (
            <button onClick={startAdd} style={{ ...saveBtnStyle, width: '100%' }}>+ เพิ่มประเภทใหม่</button>
          )
        )}
      </div>
    </div>
  );
}
