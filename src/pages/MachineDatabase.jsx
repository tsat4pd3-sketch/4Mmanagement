import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { loadMachineTraits, activeAutomationLevels, activeOperationModes, automationDisplay, operationDisplay } from '../utils/machineTraits';

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

const emptyMachine = { id: null, line_name: '', machine_no: '', machine_name: '', machine_type_id: '', sort_order: 0, is_active: true, equipment_category: 'production', automation_level: '', operation_mode: '', gang_count: '' };
// หมวดอุปกรณ์ในฐานเครื่องจักร — Facility/Utility ไม่ผูกไลน์ผลิต (ระบบน้ำ/ลม/High Pressure ฯลฯ)
const EQUIP_CATS = [
  { v: 'production', t: '🏭 ไลน์ผลิต' },
  { v: 'facility',   t: '🔧 Facility' },
  { v: 'utility',    t: '⚡ Utility' },
];
const emptyType    = { id: null, label: '', color: '#4d9fff', icon: '', sort_order: 0, is_active: true };
const TYPE_COLORS  = ['#4d9fff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#06b6d4', '#84cc16', '#6b7280'];

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════════════ */
export default function MachineDatabase() {
  const { role, lineId: userLineId, sections: scopeSecs } = useContext(UserContext);
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
  const [facilityAreas, setFacilityAreas] = useState([]); // ชื่อโซน facility (จาก pm_facility_areas) — ตัวเลือก/suggest
  const [supplyLines, setSupplyLines] = useState([]);     // Supply route: facility/utility นี้จ่ายให้ไลน์ไหนบ้าง (ในฟอร์มแก้ไข)
  const [supplyByMachine, setSupplyByMachine] = useState({}); // machine_id → [line_name] (โชว์ในลิสต์)

  // โหลด supply route ของ facility/utility ที่กำลังแก้ (utility นี้จ่ายไลน์ไหน)
  useEffect(() => {
    const isFac = editing?.equipment_category && editing.equipment_category !== 'production';
    if (!editing?.id || !isFac) { setSupplyLines([]); return; }
    supabaseDR.from('facility_supply_links').select('line_name').eq('machine_id', editing.id)
      .then(({ data }) => setSupplyLines((data || []).map(r => r.line_name))).catch(() => setSupplyLines([]));
  }, [editing?.id, editing?.equipment_category]);
  const [showTypeManager, setShowTypeManager] = useState(false);
  const [traitsVer, setTraitsVer] = useState(0); // bump เมื่อโหลด traits เสร็จ (re-render dropdown)

  useEffect(() => { loadMachineTraits().then(() => setTraitsVer(v => v + 1)); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: mc }, { data: ln }, { data: mt }, fa] = await Promise.all([
      supabaseDR.from('machines').select('*, machine_types(id, label, color, icon)').order('line_name').order('sort_order'),
      supabase.from('production_lines').select('id, name, section, parent_line_name').order('name'),
      supabaseDR.from('machine_types').select('*').order('sort_order'),
      supabaseDR.from('pm_facility_areas').select('name').order('sort_order').then(r => r).catch(() => ({ data: [] })),
    ]);
    setMachines(mc || []);
    setLines(ln || []);
    setTypes(mt || []);
    setFacilityAreas((fa?.data || []).map(a => a.name).filter(Boolean));
    // supply route map (facility/utility → ไลน์ที่จ่าย) — best-effort ถ้าตารางยังไม่ apply
    supabaseDR.from('facility_supply_links').select('machine_id, line_name')
      .then(({ data }) => { const m = {}; (data || []).forEach(r => { (m[r.machine_id] ||= []).push(r.line_name); }); setSupplyByMachine(m); })
      .catch(() => setSupplyByMachine({}));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // mandatory scope filter (คำสั่ง user 2026-07-12) — leader = family ไลน์ตัวเอง, มี sections = เฉพาะ section ตัวเอง
  // user ไม่มี scope เห็นหมดเหมือนเดิม · กรองก่อน filter อิสระเสมอ (pattern มาตรฐาน CLAUDE.md)
  const scopedLines = useMemo(() => {
    if (role === 'leader' && userLineId) {
      // เทียบ id ด้วย String() — lineId จาก profile อาจเป็นคนละ type กับ production_lines.id (pattern เดียวกับ EventLog)
      const myLine = lines.find(l => String(l.id) === String(userLineId));
      const fam = new Set(myLine ? getLineFamilyNames(lines, myLine.name) : []);
      return fam.size ? lines.filter(l => fam.has(l.name)) : lines;
    }
    if (scopeSecs?.length) return lines.filter(l => inSectionScope(scopeSecs, l.section));
    return lines;
  }, [lines, role, userLineId, scopeSecs]);
  const scopedLineNames = useMemo(() => new Set(scopedLines.map(l => l.name)), [scopedLines]);
  const scopeActive = scopedLines.length !== lines.length;

  const parentChildrenMap = useMemo(() => {
    const pcm = {};
    scopedLines.forEach(l => {
      if (l.parent_line_name) {
        if (!pcm[l.parent_line_name]) pcm[l.parent_line_name] = [];
        pcm[l.parent_line_name].push(l.name);
      }
    });
    return pcm;
  }, [scopedLines]);

  const filtered = useMemo(() => {
    // เลือกไลน์หลัก (parent) = เห็นเครื่องของไลน์ย่อยทั้งกลุ่มด้วย (ไม่งั้นได้ 0 เพราะเครื่องอยู่ที่ไลน์ย่อย)
    const kids = parentChildrenMap[filterLine];
    const inLine = (m) => !filterLine || m.line_name === filterLine || (kids && kids.includes(m.line_name));
    return machines
      .filter(m => !scopeActive || scopedLineNames.has(m.line_name)) // mandatory scope ก่อน filter อิสระเสมอ
      .filter(m => showInactive || m.is_active)
      .filter(inLine)
      .filter(m => !filterType || m.machine_type_id === filterType)
      .filter(m => !search.trim() || [m.machine_no, m.machine_name].some(v => (v || '').toLowerCase().includes(search.trim().toLowerCase())));
  }, [machines, scopeActive, scopedLineNames, showInactive, filterLine, filterType, search, parentChildrenMap]);

  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach(m => { (map[m.line_name] ||= []).push(m); });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  /* ── machine CRUD ── */
  const openEdit = (item = null) => {
    setEditing(item
      ? { id: item.id, line_name: item.line_name, machine_no: item.machine_no, machine_name: item.machine_name || '', machine_type_id: item.machine_type_id || '', sort_order: item.sort_order ?? 0, is_active: item.is_active, equipment_category: item.equipment_category || 'production', automation_level: item.automation_level || '', operation_mode: item.operation_mode || '', gang_count: item.gang_count != null ? String(item.gang_count) : '' }
      : { ...emptyMachine, line_name: filterLine || '', sort_order: machines.length + 1 });
  };

  const handleSave = async () => {
    const isFac = editing.equipment_category && editing.equipment_category !== 'production';
    if (!editing.line_name)  { toast.error(isFac ? 'กรอกชื่อระบบ/พื้นที่ facility' : 'เลือกไลน์'); return; }
    if (!editing.machine_no.trim()) { toast.error('กรอกหมายเลขเครื่อง'); return; }
    setSaving(true);
    const payload = {
      line_name:        editing.line_name,
      machine_no:        editing.machine_no.trim().toUpperCase(),
      machine_name:      editing.machine_name || null,
      machine_type_id:   editing.machine_type_id || null,
      equipment_category: editing.equipment_category || 'production',
      // ลักษณะเครื่องจักร (data-driven) — เฉพาะเครื่องผลิต
      automation_level:  (editing.equipment_category || 'production') === 'production' ? (editing.automation_level || null) : null,
      operation_mode:    (editing.equipment_category || 'production') === 'production' ? (editing.operation_mode || null) : null,
      gang_count:        editing.operation_mode === 'gang' && parseInt(editing.gang_count) > 0 ? parseInt(editing.gang_count) : null,
      sort_order:        parseInt(editing.sort_order) || 0,
      is_active:         editing.is_active,
      updated_at:        new Date().toISOString(),
    };
    const doSave = (p) => editing.id
      ? supabaseDR.from('machines').update(p).eq('id', editing.id)
      : supabaseDR.from('machines').insert(p);
    let { error } = await doSave(payload);
    // ทน migration ยังไม่ apply: ถ้าไม่มีคอลัมน์ใหม่ → ตัดออกแล้วบันทึกแบบเดิม
    if (error && /equipment_category|automation_level|operation_mode|gang_count/.test(error.message || '')) {
      const { equipment_category, automation_level, operation_mode, gang_count, ...rest } = payload;
      void equipment_category; void automation_level; void operation_mode; void gang_count;
      ({ error } = await doSave(rest));
    }
    if (error) { setSaving(false); toast.error(error.message); return; }
    // Supply route: sync ไลน์ที่ facility/utility นี้จ่าย (เฉพาะเครื่องที่มี id แล้ว) — best-effort
    if (editing.id && (editing.equipment_category || 'production') !== 'production') {
      try {
        await supabaseDR.from('facility_supply_links').delete().eq('machine_id', editing.id);
        if (supplyLines.length) await supabaseDR.from('facility_supply_links').insert(supplyLines.map(ln => ({ machine_id: editing.id, line_name: ln })));
      } catch { /* ตารางยังไม่ apply — ข้าม */ }
    }
    setSaving(false);
    toast.success('บันทึกสำเร็จ');
    setEditing(null);
    load();
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`ปิดใช้งานเครื่องจักร "${item.machine_no}" ?\n\nจุดบนผังไลน์และประวัติ Downtime ที่อ้างอิงเครื่องนี้จะยังอยู่ แต่จะเลือกเครื่องนี้ใหม่ไม่ได้ (เปิดใช้กลับได้ภายหลัง)`)) return;
    const { error } = await supabaseDR.from('machines').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', item.id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  if (loading) return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>กำลังโหลด...</div>;

  return (
    <div style={{ padding: 'clamp(12px,3vw,28px)', maxWidth: 'min(96vw, 2000px)', margin: '0 auto' }}>
      <div style={{ display: 'flex', paddingRight: 52, alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
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
          {scopedLines.filter(l => !l.parent_line_name && !parentChildrenMap[l.name]).map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
          {Object.entries(parentChildrenMap).map(([parent, children]) => (
            <optgroup key={parent} label={`▸ ${parent}`}>
              <option value={parent}>{parent} — ทั้งกลุ่ม</option>
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

      {/* §137: ครอบรายการเครื่อง (จัดกลุ่มตามไลน์) ด้วยความสูงจำกัด + เลื่อนในตัว กันล้นจอเมื่อเครื่องเยอะ */}
      <div style={{ maxHeight: 'calc(100vh - 230px)', overflowY: 'auto', paddingRight: 4 }}>
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
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: `${item.machine_types.color}22`, color: item.machine_types.color, fontWeight: 700 }}>
                        {item.machine_types.icon || ''} {item.machine_types.label}
                      </span>
                    )}
                    {item.automation_level && <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 20, background: 'var(--bg2)', color: 'var(--text2)', fontWeight: 700 }}>{automationDisplay(item.automation_level)}</span>}
                    {item.operation_mode && <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 20, background: 'var(--bg2)', color: 'var(--text2)', fontWeight: 700 }}>{operationDisplay(item.operation_mode)}{item.operation_mode === 'gang' && item.gang_count ? ` ×${item.gang_count}` : ''}</span>}
                    {item.equipment_category === 'facility' && <span style={{ fontSize: 11, color: '#f59a3f' }}>🔧 Facility</span>}
                    {item.equipment_category === 'utility' && <span style={{ fontSize: 11, color: '#9b8de8' }}>⚡ Utility</span>}
                    {!item.machine_type_id && item.equipment_category === 'production' && <span style={{ fontSize: 11, color: '#f59e0b' }}>ยังไม่ระบุประเภท</span>}
                    {(supplyByMachine[item.id]?.length > 0) && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'rgba(74,144,224,0.15)', color: '#4a90e0', fontWeight: 700 }} title={`จ่ายให้: ${supplyByMachine[item.id].join(', ')}`}>🔗 จ่าย {supplyByMachine[item.id].length} ไลน์</span>}
                    {!item.is_active && <span style={{ fontSize: 11, color: '#ef4444' }}>(ปิดใช้)</span>}
                  </div>
                </div>
                {(canEdit || canDelete) && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {canEdit && <button className="tbtn" onClick={() => openEdit(item)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>}
                    {canDelete && <button className="tbtn" onClick={() => handleDelete(item)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 15 }}>✕</button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      </div>

      {/* Add/Edit machine modal */}
      {editing && (
        <div className="overlay" style={{ zIndex: 2000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(95vw,420px)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 20, color: 'var(--text)' }}>
              {editing.id ? 'แก้ไขเครื่องจักร' : '+ เพิ่มเครื่องจักร'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="หมวดอุปกรณ์">
                <div style={{ display: 'flex', gap: 6 }}>
                  {EQUIP_CATS.map(c => {
                    const on = (editing.equipment_category || 'production') === c.v;
                    return <button key={c.v} type="button" onClick={() => setEditing(f => ({ ...f, equipment_category: c.v, line_name: '' }))}
                      style={{ flex: 1, padding: '7px 6px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                        border: `1px solid ${on ? 'var(--accent)' : 'var(--border2)'}`, background: on ? 'var(--accent)' : 'var(--bg2)', color: on ? '#071008' : 'var(--text2)' }}>{c.t}</button>;
                  })}
                </div>
              </Field>
              {(editing.equipment_category || 'production') === 'production' ? (
                <Field label="ไลน์การผลิต *">
                  <select value={editing.line_name} onChange={e => setEditing(f => ({ ...f, line_name: e.target.value }))} style={inputStyle}>
                    <option value="">— เลือกไลน์ —</option>
                    {scopedLines.filter(l => !l.parent_line_name && !parentChildrenMap[l.name]).map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                    {Object.entries(parentChildrenMap).map(([parent, children]) => (
                      <optgroup key={parent} label={`▸ ${parent}`}>
                        {/* ไลน์ใหญ่เลือกได้ด้วย — บางโรงงานใช้ผังไลน์ใหญ่เป็นผังจริงที่วางเครื่อง (เช่น HYDROFORM) */}
                        <option value={parent}>{parent} (ไลน์หลัก)</option>
                        {children.map(c => <option key={c} value={c}>{c}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="ระบบ / พื้นที่ facility *">
                  <input list="fac-areas" value={editing.line_name} onChange={e => setEditing(f => ({ ...f, line_name: e.target.value }))} placeholder="เช่น ระบบน้ำ 1, ลม 2, High Pressure, UTILITY STEEL" style={inputStyle} />
                  <datalist id="fac-areas">{facilityAreas.map(n => <option key={n} value={n} />)}</datalist>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>ไม่ต้องผูกไลน์ผลิต · พิมพ์ชื่อระบบใหม่ได้เลย หรือเลือกจากโซนที่มี</div>
                </Field>
              )}
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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
              {/* ลักษณะเครื่องจักร (data-driven · คนละแกนกับประเภท/กระบวนการ) — เฉพาะเครื่องผลิต */}
              {(editing.equipment_category || 'production') === 'production' && (() => {
                void traitsVer; // อ้างถึงเพื่อ re-render เมื่อ traits โหลดเสร็จ
                return (
                  <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Field label="Automation level">
                      <select value={editing.automation_level} onChange={e => setEditing(f => ({ ...f, automation_level: e.target.value }))} style={inputStyle}>
                        <option value="">— not set —</option>
                        {activeAutomationLevels().map(a => <option key={a.key} value={a.key}>{a.icon || ''} {a.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Operation mode">
                      <select value={editing.operation_mode} onChange={e => setEditing(f => ({ ...f, operation_mode: e.target.value, gang_count: e.target.value === 'gang' ? f.gang_count : '' }))} style={inputStyle}>
                        <option value="">— not set —</option>
                        {activeOperationModes().map(o => <option key={o.key} value={o.key}>{o.icon || ''} {o.label}</option>)}
                      </select>
                    </Field>
                    {editing.operation_mode === 'gang' && (
                      <Field label="Gang count (pieces / stroke)">
                        <input type="number" min={1} value={editing.gang_count} onChange={e => setEditing(f => ({ ...f, gang_count: e.target.value }))} placeholder="e.g. 4" style={inputStyle} />
                      </Field>
                    )}
                  </div>
                );
              })()}
              {(editing.equipment_category || 'production') !== 'production' && (
                <Field label="🔗 จ่ายให้ไลน์ (Supply Route)">
                  {!editing.id ? (
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>บันทึกเครื่องก่อน แล้วเปิดแก้ไขอีกครั้งเพื่อตั้งไลน์ที่จ่าย</div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>utility นี้จ่ายให้ไลน์ไหนบ้าง — ถ้าตัดไฟ/มีปัญหาจะรู้ว่ากระทบไลน์ไหน</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 130, overflowY: 'auto', padding: 4, border: '1px solid var(--border)', borderRadius: 8 }}>
                        {scopedLines.filter(l => !parentChildrenMap[l.name]).map(l => {
                          const on = supplyLines.includes(l.name);
                          return <button key={l.id} type="button" onClick={() => setSupplyLines(p => on ? p.filter(x => x !== l.name) : [...p, l.name])}
                            style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                              border: `1px solid ${on ? 'var(--accent)' : 'var(--border2)'}`, background: on ? 'var(--accent)' : 'var(--bg2)', color: on ? '#071008' : 'var(--text2)' }}>{on ? '✓ ' : ''}{l.name}</button>;
                        })}
                      </div>
                      {supplyLines.length > 0 && <div style={{ fontSize: 11.5, color: 'var(--accent2)', marginTop: 4 }}>กระทบ {supplyLines.length} ไลน์เมื่อ utility นี้หยุด</div>}
                    </div>
                  )}
                </Field>
              )}
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
                  <button className="tbtn" onClick={() => startEdit(t)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 9px', fontSize: 11, cursor: 'pointer', color: 'var(--text)' }}>แก้ไข</button>
                  <button className="tbtn" onClick={() => handleDelete(t)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}>🗑️</button>
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
