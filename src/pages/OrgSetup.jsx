import { useState, useEffect, useMemo, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from '../components/Toast';
import { loadDivisions, divisionsSync, divisionOfNode } from '../utils/orgDivisions';
import { laborMeta } from '../utils/laborType';
import { can } from '../utils/permissions';
import { UserContext } from '../App';
import CostCenterRatePanel from '../components/CostCenterRatePanel';
import LineSelect from '../components/LineSelect';

import InfoMore from '../components/InfoMore';
const KIND_LABEL = { section: 'Section / ส่วน', department: 'Department / แผนก', line: 'Group / กลุ่ม' };
const COST_CENTER_REQUIRED = ['section', 'department', 'line'];

export default function OrgSetup() {
  const { role } = useContext(UserContext);
  const canDivisions = can('org', 'manage_divisions', role);
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
  const [formDivision, setFormDivision] = useState('');        // ฝ่าย — ติดที่ node ระดับบนสุด ลูกตกทอด
  const [divReady, setDivReady] = useState(0);
  const [saving, setSaving] = useState(false);
  // ผู้เซ็น/อนุมัติใบค่าฝีมือ ราย section (ย้ายมาจาก LineSetup) — เก็บใน section_signers keyed by production_lines.section
  const [signersMap, setSignersMap] = useState({});   // sectionKey → {manager_name, ta_name, hrm_name}
  const [plSecSet, setPlSecSet]     = useState(new Set()); // ค่าจริงของ production_lines.section (ไว้ resolve key ให้ตรงกับใบค่าฝีมือ)
  const [sgManager, setSgManager]   = useState('');
  const [sgTA, setSgTA]             = useState('');
  const [sgHRM, setSgHRM]           = useState('');
  const [sgSaving, setSgSaving]     = useState(false);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: orgData }, { data: lineData }, { data: signerRows }] = await Promise.all([
      supabase.from('org_nodes').select('*').order('sort_order'),
      supabase.from('production_lines').select('id, name, section, cost_center').order('name'),
      supabase.from('section_signers').select('*'),
    ]);
    setNodes(orgData || []);
    setLines(lineData || []);
    setPlSecSet(new Set((lineData || []).map(l => l.section).filter(Boolean)));
    const sm = {}; (signerRows || []).forEach(r => { sm[r.section] = r; });
    setSignersMap(sm);
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
  // single source: cost center ระดับไลน์มาจาก production_lines (ตั้งที่หน้าจัดการไลน์) — org group node ที่ผูก ref_line_id ไม่เก็บซ้ำ
  const lineById = useMemo(() => Object.fromEntries(lines.map(l => [String(l.id), l])), [lines]);
  const lineCostCenter = (node) => {
    if (node?.kind === 'line' && node.ref_line_id) { const pl = lineById[String(node.ref_line_id)]; if (pl) return pl.cost_center || ''; }
    return node?.cost_center || '';
  };
  const isLinkedLine = (node) => node?.kind === 'line' && !!node?.ref_line_id;

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

  // key ของ section_signers = ค่าที่ production_lines.section ใช้ (= ค่าที่ใบค่าฝีมืออ้างถึง)
  // resolve จาก node.code / node.name โดยเทียบกับค่าจริงใน production_lines กันคีย์ผิดจนข้อมูลกำพร้า
  const secKeyOf = (node) => {
    if (!node) return '';
    if (node.code && plSecSet.has(node.code)) return node.code;
    if (node.name && plSecSet.has(node.name)) return node.name;
    return node.code || node.name || '';
  };
  // โหลดชื่อผู้เซ็นของ section ที่เลือกเข้าฟอร์ม
  useEffect(() => {
    const node = sections.find(s => s.id === selSection);
    const row = signersMap[secKeyOf(node)] || {};
    setSgManager(row.manager_name || ''); setSgTA(row.ta_name || ''); setSgHRM(row.hrm_name || '');
  }, [selSection, signersMap, plSecSet, sections]); // eslint-disable-line
  const saveSigners = async () => {
    const node = sections.find(s => s.id === selSection);
    const key = secKeyOf(node);
    if (!key) return toast.error('ส่วนงานนี้ยังไม่มี Code/ชื่อ — ตั้งก่อนบันทึกผู้เซ็น');
    setSgSaving(true);
    const row = { section: key, manager_name: sgManager || null, ta_name: sgTA || null, hrm_name: sgHRM || null, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('section_signers').upsert(row, { onConflict: 'section' });
    if (error) toast.error('Error: ' + error.message);
    else { setSignersMap(m => ({ ...m, [key]: row })); toast.success('บันทึกผู้เซ็นแล้ว'); }
    setSgSaving(false);
  };

  useEffect(() => { loadDivisions().then(() => setDivReady(v => v + 1)); }, []);

  const openCreate = (kind, parentId) => {
    setFormName(''); setFormCode(''); setFormCostCenter(''); setFormRefLineId('');
    setFormLaborType('direct'); setFormDivision('');
    setModal({ kind, parentId, editing: null });
  };
  const openEdit = (node) => {
    setFormName(node.name); setFormCode(node.code || ''); setFormCostCenter(lineCostCenter(node));
    setFormRefLineId(node.ref_line_id ? String(node.ref_line_id) : '');
    setFormLaborType(node.labor_type || 'direct'); setFormDivision(node.division || '');
    setModal({ kind: node.kind, parentId: node.parent_id, editing: node });
  };

  const handleSave = async () => {
    if (!formName.trim()) return toast.error('กรุณากรอกชื่อ');
    // group/line node ที่ผูก production_lines → cost center มาจาก production_lines (single source) ไม่บังคับ/ไม่เช็คซ้ำ
    const linkedLine = modal.kind === 'line' && !!formRefLineId;
    const linkedCC = linkedLine ? (lineById[String(formRefLineId)]?.cost_center || '') : '';
    if (COST_CENTER_REQUIRED.includes(modal.kind) && !linkedLine && !formCostCenter.trim()) {
      return toast.error('กรุณากรอก Cost Center');
    }
    if (!linkedLine && formCostCenter.trim()) {
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
      cost_center: linkedLine ? (linkedCC || null) : (formCostCenter.trim() || null),
      parent_id: modal.parentId || null, // department เลือก "ขึ้นตรงฝ่าย" ได้ = parent_id null
      ref_line_id: modal.kind === 'line' && formRefLineId ? Number(formRefLineId) : null,
      // ประเภทแรงงาน — ตั้งได้ทั้ง section และ department (ช่างส่วนใหญ่อยู่ระดับแผนก)
      // พนักงาน derive จาก department ก่อน แล้ว section
      ...(['section', 'department'].includes(modal.kind) ? { labor_type: formLaborType } : {}),
      // ฝ่าย — ติดที่ node ระดับบนสุดพอ ลูกตกทอดขึ้นไปหาเอง (ดู divisionOfNode)
      ...(['section', 'department'].includes(modal.kind) && canDivisions ? { division: formDivision || null } : {}),
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
    // ยืนยันเฉพาะตอน "ปิดใช้งาน" (กระทบ dropdown/การอ้างอิงทั้งระบบ) — เปิดกลับไม่ต้องถาม
    if (node.is_active && !confirm(`ปิดใช้งาน "${node.name}" ?\n\nจะหายจาก dropdown/การเลือกในหน้าอื่น (ข้อมูลเดิมยังอยู่ เปิดกลับได้)`)) return;
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
                  <DivBadge node={s} nodes={nodes} />
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
                  <DivBadge node={d} nodes={nodes} />
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
                  {lineCostCenter(l) && <CostBadge code={lineCostCenter(l)} />}
                </span>
                <RowActions node={l} onEdit={openEdit} onToggle={toggleActive} onDelete={handleDelete} />
              </div>
            ))}
            {selDept && !currentLines.length && <Empty text="ยังไม่มีกลุ่มในแผนกนี้" />}
          </div>

          {/* ✍️ ผู้เซ็น/อนุมัติใบค่าฝีมือ ราย section (ย้ายมาจาก LineSetup — เป็นข้อมูลราย "ส่วนงาน") */}
          {selSection && selSection !== ORPHAN && (() => {
            const node = sections.find(s => s.id === selSection);
            if (!node) return null;
            const key = secKeyOf(node);
            return (
              <div className="card" style={{ flexBasis: '100%', width: '100%', padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
                  <strong style={{ fontSize: 13, color: 'var(--text2)' }}>✍️ ผู้เซ็น/อนุมัติใบค่าฝีมือ — ส่วน {node.name}{key ? ` (${key})` : ''}</strong>
                  <button onClick={saveSigners} disabled={sgSaving || !key}
                    style={{ padding: '7px 18px', background: sgSaving || !key ? 'var(--muted)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: sgSaving || !key ? 'default' : 'pointer' }}>
                    {sgSaving ? 'กำลังบันทึก...' : '💾 บันทึก'}
                  </button>
                </div>
                <InfoMore size={11} style={{ marginBottom: 10 }} id="org_signers"
                  lead={<>ใช้ดึงชื่อลงช่องลายเซ็น “ใบสรุปค่าฝีมือ” อัตโนมัติ</>}>
                  ตั้งครั้งเดียวต่อส่วนงาน ใช้ร่วมทุกไลน์ในส่วนนี้
                  (หัวหน้างานรายไลน์ตั้งที่หน้าจัดการไลน์)
                </InfoMore>
                {!key && <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 8 }}>⚠ ส่วนนี้ยังไม่มี Code/ชื่อที่ตรงกับ production_lines.section — ใบค่าฝีมืออาจดึงไม่เจอ</div>}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                  <div><label style={labelSt}>ผู้จัดการต้นสังกัด</label><input type="text" value={sgManager} onChange={e => setSgManager(e.target.value)} style={{ marginTop: 4 }} /></div>
                  <div><label style={labelSt}>เจ้าหน้าที่ TA</label><input type="text" value={sgTA} onChange={e => setSgTA(e.target.value)} style={{ marginTop: 4 }} /></div>
                  <div><label style={labelSt}>ผู้จัดการส่วน HRM</label><input type="text" value={sgHRM} onChange={e => setSgHRM(e.target.value)} style={{ marginTop: 4 }} /></div>
                </div>
              </div>
            );
          })()}

          {/* 💰 Activity Rate ต่อ Cost Center (DL/OH/DP บาท/ชม.) — ใช้คิด cost saving ในโปรเจคปรับปรุง (2026-08-11) */}
          <div style={{ flexBasis: '100%', width: '100%' }}>
            <CostCenterRatePanel nodes={nodes} lines={lines} />
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
                  Cost Center {modal.kind === 'line' && formRefLineId ? '(จากไลน์ที่ผูก)' : COST_CENTER_REQUIRED.includes(modal.kind) ? '(บังคับ)' : '(ไม่บังคับ)'}
                </label>
                {modal.kind === 'line' && formRefLineId ? (
                  <>
                    <input type="text" value={lineById[String(formRefLineId)]?.cost_center || ''} readOnly disabled
                      placeholder="— ยังไม่ได้ตั้งที่หน้าจัดการไลน์ —" style={{ opacity: 0.7, cursor: 'not-allowed' }} />
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>🔗 single source — cost center ของไลน์มาจากหน้า <strong>จัดการไลน์</strong> (แก้ที่นั่นที่เดียว)</div>
                  </>
                ) : (
                  <input type="text" value={formCostCenter} onChange={e => setFormCostCenter(e.target.value)} placeholder="เช่น 2140662101" />
                )}
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
              {['section', 'department'].includes(modal.kind) && (
                <div>
                  <label style={labelSt}>ฝ่าย (Division)</label>
                  {/* gate ด้วย org:manage_divisions — คีย์นี้ถูกลงทะเบียนใน permission_catalog
                      + ใช้เป็น RLS ของตาราง org_divisions อยู่แล้ว แต่ไม่เคยมีโค้ดฝั่ง UI เรียก
                      = ติ๊กใน /permissions แล้วไม่มีผล (กฎ: ห้ามลงทะเบียน key ที่โค้ดไม่ใช้) */}
                  <select value={formDivision} disabled={!canDivisions}
                    onChange={e => setFormDivision(e.target.value)}>
                    <option value="">— ตกทอดจากตัวแม่ / ยังไม่ระบุ —</option>
                    {divisionsSync().map(d => <option key={d.code} value={d.code}>{d.icon} {d.label}</option>)}
                  </select>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    ใช้แยก “สกิลของฝ่ายไหน” — ติดที่ตัวบนสุดพอ ตัวลูกตกทอดเอง
                    {modal.parentId ? ' (ตัวนี้มีแม่อยู่แล้ว ปล่อยว่างได้)' : ''}
                    {!canDivisions && ' · 🔒 ต้องมีสิทธิ์ org:manage_divisions ถึงแก้ได้'}
                  </div>
                </div>
              )}
              {modal.kind === 'line' && (
                <div>
                  <label style={labelSt}>ผูกกับไลน์ผลิตจริง (production_lines)</label>
                  <LineSelect lines={lines} value={formRefLineId} valueKey="id"
                    placeholder="— ไม่ผูก —" onChange={setFormRefLineId} />
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

/** ป้ายฝ่าย — ตัวที่ไม่ได้ติดเองจะโชว์ค่าที่ตกทอดจากแม่แบบจาง (ให้เห็นว่าผลลัพธ์จริงคืออะไร) */
function DivBadge({ node, nodes }) {
  const own = node.division || null;
  const eff = own || divisionOfNode(node.id, nodes);
  if (!eff) return null;
  const m = divisionsSync().find(d => d.code === eff);
  return (
    <span title={own ? 'ติดป้ายที่ตัวนี้เอง' : 'ตกทอดจากตัวแม่'}
      style={{
        marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 999,
        border: `1px solid ${(m?.color || 'var(--border)')}${own ? '' : '55'}`,
        color: m?.color || 'var(--muted)', opacity: own ? 1 : 0.6,
      }}>
      {m?.icon} {m?.label || eff}{own ? '' : ' (ตกทอด)'}
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
