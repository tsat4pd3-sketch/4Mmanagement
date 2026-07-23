import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from '../components/Toast';
import { laborMeta } from '../utils/laborType';

const KIND_LABEL = { section: 'Section / ส่วน', department: 'Department / แผนก', line: 'Group / กลุ่ม' };
const COST_CENTER_REQUIRED = ['section', 'department', 'line'];

export default function OrgSetup() {
  const [nodes, setNodes] = useState([]);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selSection, setSelSection] = useState(null);
  const [selDept, setSelDept] = useState(null);
  const [modal, setModal] = useState(null); // { kind, parentId, editing }
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formCostCenter, setFormCostCenter] = useState('');
  const [formRefLineId, setFormRefLineId] = useState('');
  const [formLaborType, setFormLaborType] = useState('direct'); // section: direct/indirect
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: orgData }, { data: lineData }] = await Promise.all([
      supabase.from('org_nodes').select('*').order('sort_order'),
      supabase.from('production_lines').select('id, name').order('name'),
    ]);
    setNodes(orgData || []);
    setLines(lineData || []);
    setLoading(false);
  };

  const ORPHAN = '__ORPHAN__';
  const sections = useMemo(() => nodes.filter(n => n.kind === 'section'), [nodes]);
  const allDepts = useMemo(() => nodes.filter(n => n.kind === 'department'), [nodes]);
  const orphanDepts = useMemo(() => nodes.filter(n => n.kind === 'department' && !n.parent_id), [nodes]);
  const deptsOf = (sectionId) => sectionId === ORPHAN
    ? orphanDepts
    : nodes.filter(n => n.kind === 'department' && n.parent_id === sectionId);
  const linesOf = (deptId) => nodes.filter(n => n.kind === 'line' && n.parent_id === deptId);

  const parentOptionsFor = (kind) => {
    if (kind === 'department') return sections.map(s => ({ id: s.id, label: s.name }));
    if (kind === 'line') return allDepts.map(d => {
      const sec = sections.find(s => s.id === d.parent_id);
      return { id: d.id, label: `${sec ? sec.name : 'ขึ้นตรงฝ่าย'} > ${d.name}` };
    });
    return [];
  };
  const PARENT_LABEL = { department: 'อยู่ภายใต้ Section', line: 'อยู่ภายใต้ Department' };

  useEffect(() => {
    if (!selSection && sections.length) setSelSection(sections[0].id);
  }, [sections]); // eslint-disable-line

  const currentDepts = selSection ? deptsOf(selSection) : [];
  useEffect(() => {
    if (currentDepts.length && !currentDepts.some(d => d.id === selDept)) setSelDept(currentDepts[0].id);
    if (!currentDepts.length) setSelDept(null);
  }, [selSection, nodes]); // eslint-disable-line

  const currentLines = selDept ? linesOf(selDept) : [];

  const openCreate = (kind, parentId) => {
    setFormName(''); setFormCode(''); setFormCostCenter(''); setFormRefLineId('');
    setFormLaborType('direct');
    setModal({ kind, parentId, editing: null });
  };
  const openEdit = (node) => {
    setFormName(node.name); setFormCode(node.code || ''); setFormCostCenter(node.cost_center || '');
    setFormRefLineId(node.ref_line_id ? String(node.ref_line_id) : '');
    setFormLaborType(node.labor_type || 'direct');
    setModal({ kind: node.kind, parentId: node.parent_id, editing: node });
  };

  const handleSave = async () => {
    if (!formName.trim()) return toast.error('กรุณากรอกชื่อ');
    if (COST_CENTER_REQUIRED.includes(modal.kind) && !formCostCenter.trim()) {
      return toast.error('กรุณากรอก Cost Center');
    }
    if (formCostCenter.trim()) {
      const dup = nodes.find(n =>
        n.is_active && n.cost_center && n.cost_center.trim() === formCostCenter.trim() && n.id !== modal.editing?.id
      );
      if (dup) return toast.error(`Cost Center นี้ถูกใช้แล้วที่ "${dup.name}" — กรุณาเปลี่ยนเลข`);
    }
    setSaving(true);
    const payload = {
      kind: modal.kind,
      name: formName.trim(),
      code: formCode.trim() || null,
      cost_center: formCostCenter.trim() || null,
      parent_id: modal.parentId || null, // department เลือก "ขึ้นตรงฝ่าย" ได้ = parent_id null
      ref_line_id: modal.kind === 'line' && formRefLineId ? Number(formRefLineId) : null,
      // ประเภทแรงงาน — ตั้งได้ทั้ง section และ department (ช่างส่วนใหญ่อยู่ระดับแผนก)
      // พนักงาน derive จาก department ก่อน แล้ว section
      ...(['section', 'department'].includes(modal.kind) ? { labor_type: formLaborType } : {}),
    };
    const { error } = modal.editing
      ? await supabase.from('org_nodes').update(payload).eq('id', modal.editing.id)
      : await supabase.from('org_nodes').insert({ ...payload, sort_order: nodes.length + 1 });
    setSaving(false);
    if (error) return toast.error('บันทึกไม่สำเร็จ: ' + error.message);
    toast.success(modal.editing ? 'แก้ไขสำเร็จ' : 'เพิ่มสำเร็จ');
    setModal(null);
    fetchAll();
  };

  const toggleActive = async (node) => {
    const { error } = await supabase.from('org_nodes').update({ is_active: !node.is_active }).eq('id', node.id);
    if (error) return toast.error(error.message);
    fetchAll();
  };

  const handleDelete = async (node) => {
    // กันลบทั้งที่ยังมีลูก — เดิม confirm บอก "ลบลูกทั้งหมด" แต่โค้ดลบแค่ node เดียว (พึ่ง cascade)
    // ถ้าไม่มี cascade ลูกจะกำพร้า parent_id ค้าง · ให้ย้าย/ลบลูกก่อน หรือกด "ปิดใช้งาน" แทน
    const childCount = nodes.filter(n => n.parent_id === node.id).length;
    if (childCount > 0) return toast.error(`ลบไม่ได้: "${node.name}" ยังมีหน่วยงานลูก ${childCount} รายการ — ย้าย/ลบลูกก่อน หรือกด "ปิดใช้งาน" แทน`);
    if (!confirm(`ลบ "${node.name}" ?\n\n(ถ้าเคยผูกกับข้อมูลอื่นแนะนำ "ปิดใช้งาน" แทนการลบ)`)) return;
    const { error } = await supabase.from('org_nodes').delete().eq('id', node.id);
    if (error) return toast.error('ลบไม่สำเร็จ: ' + error.message);
    toast.success('ลบสำเร็จ');
    if (node.kind === 'section' && selSection === node.id) setSelSection(null);
    if (node.kind === 'department' && selDept === node.id) setSelDept(null);
    fetchAll();
  };

  const colStyle = { flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column' };
  const itemStyle = (active) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '9px 12px', borderRadius: 8, cursor: 'pointer', marginBottom: 4,
    background: active ? 'rgba(77,159,255,0.12)' : 'var(--bg2)',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border2)'}`,
  });

  return (
    <div className="page-content">
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(16px,3vw,22px)', color: 'var(--text)' }}>
          🏢 แผนผังองค์กร
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
          จัดการโครงสร้าง Section/ส่วน → Department/แผนก → Group/กลุ่ม พร้อม Cost Center (master data ที่หน้าอื่นใช้อ้างอิง)
        </p>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด...</div>
      ) : (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {/* Sections */}
          <div style={colStyle} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ fontSize: 13, color: 'var(--text2)' }}>SECTION / ส่วน ({sections.length})</strong>
              <button className="tbtn" onClick={() => openCreate('section', null)} style={addBtnSt}>➕</button>
            </div>
            <div style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
            {sections.map(s => (
              <div key={s.id} style={itemStyle(selSection === s.id)} onClick={() => setSelSection(s.id)}>
                <span style={{ fontSize: 13, color: s.is_active ? 'var(--text)' : 'var(--muted)', textDecoration: s.is_active ? 'none' : 'line-through' }}>
                  {s.name}
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}> ({deptsOf(s.id).length} แผนก)</span>
                  {s.cost_center && <CostBadge code={s.cost_center} />}
                  <LaborBadge type={s.labor_type} />
                </span>
                <RowActions node={s} onEdit={openEdit} onToggle={toggleActive} onDelete={handleDelete} />
              </div>
            ))}
            {!sections.length && <Empty text="ยังไม่มี Section" />}
            <div style={itemStyle(selSection === ORPHAN)} onClick={() => setSelSection(ORPHAN)}>
              <span style={{ fontSize: 13, color: 'var(--text2)' }}>
                🏛️ ขึ้นตรงฝ่าย (ไม่มี Section)
                <span style={{ fontSize: 11, color: 'var(--muted)' }}> ({orphanDepts.length} แผนก)</span>
              </span>
            </div>
            </div>
          </div>

          {/* Departments */}
          <div style={colStyle} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ fontSize: 13, color: 'var(--text2)' }}>DEPARTMENT / แผนก ({currentDepts.length})</strong>
              <button className="tbtn" onClick={() => selSection && openCreate('department', selSection === ORPHAN ? null : selSection)} disabled={!selSection} style={addBtnSt}>➕</button>
            </div>
            {!selSection ? <Empty text="เลือก Section ก่อน" /> : currentDepts.map(d => (
              <div key={d.id} style={itemStyle(selDept === d.id)} onClick={() => setSelDept(d.id)}>
                <span style={{ fontSize: 13, color: d.is_active ? 'var(--text)' : 'var(--muted)', textDecoration: d.is_active ? 'none' : 'line-through' }}>
                  {d.name}
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}> ({linesOf(d.id).length} กลุ่ม)</span>
                  {d.cost_center && <CostBadge code={d.cost_center} />}
                  <LaborBadge type={d.labor_type} />
                </span>
                <RowActions node={d} onEdit={openEdit} onToggle={toggleActive} onDelete={handleDelete} />
              </div>
            ))}
            {selSection && !currentDepts.length && <Empty text="ยังไม่มีแผนกในนี้" />}
          </div>

          {/* Lines */}
          <div style={colStyle} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ fontSize: 13, color: 'var(--text2)' }}>GROUP / กลุ่ม ({currentLines.length})</strong>
              <button className="tbtn" onClick={() => selDept && openCreate('line', selDept)} disabled={!selDept} style={addBtnSt}>➕</button>
            </div>
            {!selDept ? <Empty text="เลือกแผนกก่อน" /> : currentLines.map(l => (
              <div key={l.id} style={itemStyle(false)}>
                <span style={{ fontSize: 13, color: l.is_active ? 'var(--text)' : 'var(--muted)', textDecoration: l.is_active ? 'none' : 'line-through' }}>
                  {l.name} {!l.ref_line_id && <span style={{ fontSize: 11, color: '#f59e0b' }}>(ไม่ผูก production_lines)</span>}
                  {l.cost_center && <CostBadge code={l.cost_center} />}
                </span>
                <RowActions node={l} onEdit={openEdit} onToggle={toggleActive} onDelete={handleDelete} />
              </div>
            ))}
            {selDept && !currentLines.length && <Empty text="ยังไม่มีกลุ่มในแผนกนี้" />}
          </div>
        </div>
      )}

      {modal && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: 420 }}>
            <h3 style={{ marginTop: 0, marginBottom: 16, fontFamily: 'var(--font-display)', color: 'var(--text)', fontSize: 16 }}>
              {modal.editing ? `✏️ แก้ไข ${KIND_LABEL[modal.kind]}` : `➕ เพิ่ม ${KIND_LABEL[modal.kind]}`}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={labelSt}>ชื่อ</label>
                <input type="text" value={formName} onChange={e => setFormName(e.target.value)} placeholder="เช่น PD5 / HYDROFORM LASERCUT / LINE E / Team D" />
              </div>
              {modal.kind !== 'section' && (
                <div>
                  <label style={labelSt}>{PARENT_LABEL[modal.kind]}</label>
                  <select value={modal.parentId ?? ''} onChange={e => setModal(m => ({ ...m, parentId: e.target.value || null }))}>
                    {modal.kind === 'department' && <option value="">🏛️ ขึ้นตรงฝ่าย — ไม่อยู่ใต้ Section ใด</option>}
                    {parentOptionsFor(modal.kind).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label style={labelSt}>Code (ใช้อ้างอิงค่าเดิมในระบบ — ไม่บังคับ)</label>
                <input type="text" value={formCode} onChange={e => setFormCode(e.target.value)} placeholder="เช่น PD5 / A" />
              </div>
              <div>
                <label style={labelSt}>
                  Cost Center {COST_CENTER_REQUIRED.includes(modal.kind) ? '(บังคับ)' : '(ไม่บังคับ)'}
                </label>
                <input type="text" value={formCostCenter} onChange={e => setFormCostCenter(e.target.value)} placeholder="เช่น 2140662101" />
              </div>
              {['section', 'department'].includes(modal.kind) && (
                <div>
                  <label style={labelSt}>ประเภทแรงงาน (Direct/Indirect)</label>
                  <select value={formLaborType} onChange={e => setFormLaborType(e.target.value)}>
                    <option value="direct">🔧 Direct — ฝ่ายผลิต (operator ทำงานผลิตโดยตรง)</option>
                    <option value="indirect">🗂️ Indirect — สนับสนุน (ช่างซ่อมบำรุง/QA/ธุรการ/ขาย)</option>
                  </select>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    พนักงานใน{modal.kind === 'section' ? 'ส่วน' : 'แผนก'}นี้จะถูกจัดเป็นประเภทนี้อัตโนมัติ{modal.kind === 'section' ? ' (แผนกตั้งทับได้)' : ' (ช่างส่วนใหญ่อยู่ระดับแผนก)'}
                  </div>
                </div>
              )}
              {modal.kind === 'line' && (
                <div>
                  <label style={labelSt}>ผูกกับไลน์ผลิตจริง (production_lines)</label>
                  <select value={formRefLineId} onChange={e => setFormRefLineId(e.target.value)}>
                    <option value="">— ไม่ผูก —</option>
                    {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button onClick={handleSave} disabled={saving} style={{ flex: 2, padding: 11, background: saving ? 'var(--muted)' : 'var(--amber)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
                  {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                <button onClick={() => setModal(null)} style={{ flex: 1, padding: 11, background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 8, cursor: 'pointer' }}>
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RowActions({ node, onEdit, onToggle, onDelete }) {
  return (
    <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
      <button className="tbtn" onClick={() => onEdit(node)} title="แก้ไข" style={iconBtnSt}>✏️</button>
      <button className="tbtn" onClick={() => onToggle(node)} title={node.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} style={iconBtnSt}>{node.is_active ? '🟢' : '⚪'}</button>
      <button className="tbtn" onClick={() => onDelete(node)} title="ลบ" style={iconBtnSt}>🗑️</button>
    </div>
  );
}

function CostBadge({ code }) {
  return (
    <span style={{ marginLeft: 6, fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'var(--bg3)', color: 'var(--muted)', border: '1px solid var(--border2)' }}>
      💰{code}
    </span>
  );
}

function LaborBadge({ type }) {
  if (!type) return null;
  const m = laborMeta(type);
  return (
    <span style={{ marginLeft: 6, fontSize: 11, padding: '1px 6px', borderRadius: 4, background: `${m.color}18`, color: m.color, border: `1px solid ${m.color}44`, fontWeight: 600 }}>
      {m.icon}{m.short}
    </span>
  );
}

function Empty({ text }) {
  return <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{text}</div>;
}

const addBtnSt = { padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg3)', cursor: 'pointer', fontSize: 13 };
const iconBtnSt = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 2 };
const labelSt = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--text2)', marginBottom: 6,
  letterSpacing: '0.05em', textTransform: 'uppercase',
};
