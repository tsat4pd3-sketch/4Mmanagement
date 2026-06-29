import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from '../components/Toast';

const KIND_LABEL = { section: 'Section', line: 'ไลน์', team: 'Team' };

export default function OrgSetup() {
  const [nodes, setNodes] = useState([]);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selSection, setSelSection] = useState(null);
  const [selLine, setSelLine] = useState(null);
  const [modal, setModal] = useState(null); // { kind, parentId, editing }
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formRefLineId, setFormRefLineId] = useState('');
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

  const sections = useMemo(() => nodes.filter(n => n.kind === 'section'), [nodes]);
  const linesOf = (sectionId) => nodes.filter(n => n.kind === 'line' && n.parent_id === sectionId);
  const teamsOf = (lineId) => nodes.filter(n => n.kind === 'team' && n.parent_id === lineId);

  useEffect(() => {
    if (!selSection && sections.length) setSelSection(sections[0].id);
  }, [sections]); // eslint-disable-line

  const currentLines = selSection ? linesOf(selSection) : [];
  useEffect(() => {
    if (currentLines.length && !currentLines.some(l => l.id === selLine)) setSelLine(currentLines[0].id);
    if (!currentLines.length) setSelLine(null);
  }, [selSection, nodes]); // eslint-disable-line

  const currentTeams = selLine ? teamsOf(selLine) : [];

  const openCreate = (kind, parentId) => {
    setFormName(''); setFormCode(''); setFormRefLineId('');
    setModal({ kind, parentId, editing: null });
  };
  const openEdit = (node) => {
    setFormName(node.name); setFormCode(node.code || ''); setFormRefLineId(node.ref_line_id ? String(node.ref_line_id) : '');
    setModal({ kind: node.kind, parentId: node.parent_id, editing: node });
  };

  const handleSave = async () => {
    if (!formName.trim()) return toast.error('กรุณากรอกชื่อ');
    setSaving(true);
    const payload = {
      kind: modal.kind,
      name: formName.trim(),
      code: formCode.trim() || null,
      parent_id: modal.parentId,
      ref_line_id: modal.kind === 'line' && formRefLineId ? Number(formRefLineId) : null,
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
    if (!confirm(`ลบ "${node.name}" และโหนดลูกทั้งหมดหรือไม่?`)) return;
    const { error } = await supabase.from('org_nodes').delete().eq('id', node.id);
    if (error) return toast.error('ลบไม่สำเร็จ: ' + error.message);
    toast.success('ลบสำเร็จ');
    if (node.kind === 'section' && selSection === node.id) setSelSection(null);
    if (node.kind === 'line' && selLine === node.id) setSelLine(null);
    fetchAll();
  };

  const colStyle = { flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column' };
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
          จัดการโครงสร้าง Section → ไลน์ → Team (master data ที่หน้าอื่นใช้อ้างอิง)
        </p>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด...</div>
      ) : (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {/* Sections */}
          <div style={colStyle} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ fontSize: 13, color: 'var(--text2)' }}>SECTION ({sections.length})</strong>
              <button onClick={() => openCreate('section', null)} style={addBtnSt}>➕</button>
            </div>
            {sections.map(s => (
              <div key={s.id} style={itemStyle(selSection === s.id)} onClick={() => setSelSection(s.id)}>
                <span style={{ fontSize: 13, color: s.is_active ? 'var(--text)' : 'var(--muted)', textDecoration: s.is_active ? 'none' : 'line-through' }}>
                  {s.name} <span style={{ fontSize: 10, color: 'var(--muted)' }}>({linesOf(s.id).length} ไลน์)</span>
                </span>
                <RowActions node={s} onEdit={openEdit} onToggle={toggleActive} onDelete={handleDelete} />
              </div>
            ))}
            {!sections.length && <Empty text="ยังไม่มี Section" />}
          </div>

          {/* Lines */}
          <div style={colStyle} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ fontSize: 13, color: 'var(--text2)' }}>ไลน์ ({currentLines.length})</strong>
              <button onClick={() => selSection && openCreate('line', selSection)} disabled={!selSection} style={addBtnSt}>➕</button>
            </div>
            {!selSection ? <Empty text="เลือก Section ก่อน" /> : currentLines.map(l => (
              <div key={l.id} style={itemStyle(selLine === l.id)} onClick={() => setSelLine(l.id)}>
                <span style={{ fontSize: 13, color: l.is_active ? 'var(--text)' : 'var(--muted)', textDecoration: l.is_active ? 'none' : 'line-through' }}>
                  {l.name} {!l.ref_line_id && <span style={{ fontSize: 10, color: '#f59e0b' }}>(ไม่ผูก production_lines)</span>}
                </span>
                <RowActions node={l} onEdit={openEdit} onToggle={toggleActive} onDelete={handleDelete} />
              </div>
            ))}
            {selSection && !currentLines.length && <Empty text="ยังไม่มีไลน์ในนี้" />}
          </div>

          {/* Teams */}
          <div style={colStyle} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ fontSize: 13, color: 'var(--text2)' }}>TEAM ({currentTeams.length})</strong>
              <button onClick={() => selLine && openCreate('team', selLine)} disabled={!selLine} style={addBtnSt}>➕</button>
            </div>
            {!selLine ? <Empty text="เลือกไลน์ก่อน" /> : currentTeams.map(t => (
              <div key={t.id} style={itemStyle(false)}>
                <span style={{ fontSize: 13, color: t.is_active ? 'var(--text)' : 'var(--muted)', textDecoration: t.is_active ? 'none' : 'line-through' }}>
                  {t.name}
                </span>
                <RowActions node={t} onEdit={openEdit} onToggle={toggleActive} onDelete={handleDelete} />
              </div>
            ))}
            {selLine && !currentTeams.length && <Empty text="ยังไม่มี Team ในไลน์นี้" />}
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
                <input type="text" value={formName} onChange={e => setFormName(e.target.value)} placeholder="เช่น PD5 / LINE E / Team D" />
              </div>
              <div>
                <label style={labelSt}>Code (ใช้อ้างอิงค่าเดิมในระบบ — ไม่บังคับ)</label>
                <input type="text" value={formCode} onChange={e => setFormCode(e.target.value)} placeholder="เช่น PD5 / A" />
              </div>
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
      <button onClick={() => onEdit(node)} title="แก้ไข" style={iconBtnSt}>✏️</button>
      <button onClick={() => onToggle(node)} title={node.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} style={iconBtnSt}>{node.is_active ? '🟢' : '⚪'}</button>
      <button onClick={() => onDelete(node)} title="ลบ" style={iconBtnSt}>🗑️</button>
    </div>
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
