/* ═══ NpiTemplates — แม่แบบเฟส + รายการเอกสารต่อลูกค้า (data-driven · gate npi:manage_templates) ═══
   ⚠️ แก้แม่แบบไม่ย้อนแก้พาร์ทที่สร้างไปแล้ว (snapshot) — พาร์ทกด 🔄 sync เพื่อเติมรายการที่ขาด
   ⚠️ code ของเฟส/รายการ = คีย์จับคู่ตอน sync · เปลี่ยน code แล้วรายการเดิมในพาร์ทจะถูกมองว่า "คนละรายการ" */
import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import { DOC_KIND, OWNER_ROLE } from '../utils/npi';
import { inp, card, btn, ghost, thSt, tdSt, Field, Pill, Modal } from './NpiUi';

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

export default function NpiTemplates({ templates, onChanged }) {
  const [tplId, setTplId] = useState(templates[0]?.id || '');
  const [tplModal, setTplModal] = useState(null);
  const [phModal, setPhModal] = useState(null);
  const [dvModal, setDvModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const tpl = templates.find(t => t.id === tplId) || templates[0] || null;
  const phases = [...(tpl?.phases || [])].sort((a, b) => a.seq - b.seq);
  const delivs = [...(tpl?.delivs || [])].sort((a, b) => (phases.findIndex(p => p.code === a.phase_code) - phases.findIndex(p => p.code === b.phase_code)) || a.seq - b.seq);

  const run = async (label, fn) => {
    setSaving(true);
    const { error } = await fn();
    setSaving(false);
    if (error) return toast.error(`${label}ไม่สำเร็จ: ${error.message}${error.code === '23505' ? ' (code ซ้ำ)' : ''}`);
    toast.success(`${label}แล้ว`); onChanged();
    return true;
  };

  const saveTpl = async () => {
    const m = tplModal;
    if (!m.label?.trim()) return toast.error('กรอกชื่อแม่แบบ');
    const row = { label: m.label.trim(), customer: m.customer?.trim() || null, description: m.description?.trim() || null, is_active: m.is_active !== false, sort: Number(m.sort) || 0 };
    const ok = await run('บันทึกแม่แบบ', () => m.id ? supabase.from('npi_templates').update(row).eq('id', m.id)
      : supabase.from('npi_templates').insert({ ...row, code: slug(m.code || m.label) || `tpl_${Date.now().toString(36)}` }));
    if (ok) setTplModal(null);
  };
  const savePhase = async () => {
    const m = phModal;
    if (!m.label?.trim()) return toast.error('กรอกชื่อเฟส');
    const row = { label: m.label.trim(), seq: Number(m.seq) || 0, color: m.color || null, description: m.description?.trim() || null };
    const ok = await run('บันทึกเฟส', () => m.id ? supabase.from('npi_template_phases').update(row).eq('id', m.id)
      : supabase.from('npi_template_phases').insert({ ...row, template_id: tpl.id, code: slug(m.code || m.label) || `ph_${Date.now().toString(36)}` }));
    if (ok) setPhModal(null);
  };
  const saveDeliv = async () => {
    const m = dvModal;
    if (!m.label?.trim()) return toast.error('กรอกชื่อรายการ');
    if (!m.phase_code) return toast.error('เลือกเฟส');
    const row = { label: m.label.trim(), phase_code: m.phase_code, seq: Number(m.seq) || 0, doc_kind: m.doc_kind || 'other', required: m.required !== false, ppap_element: !!m.ppap_element, owner_role: m.owner_role || null, is_active: m.is_active !== false };
    const ok = await run('บันทึกรายการ', () => m.id ? supabase.from('npi_template_deliverables').update(row).eq('id', m.id)
      : supabase.from('npi_template_deliverables').insert({ ...row, template_id: tpl.id, code: slug(m.code || m.label) || `dv_${Date.now().toString(36)}` }));
    if (ok) setDvModal(null);
  };
  const delPhase = (p) => {
    const n = delivs.filter(d => d.phase_code === p.code).length;
    if (!window.confirm(`ลบเฟส "${p.label}"? ${n ? `รายการ ${n} รายการในเฟสนี้จะไม่มีเฟส (ไปกลุ่ม "ไม่อยู่ในเฟส")` : ''}\nพาร์ทที่สร้างไปแล้วไม่ถูกแตะ`)) return;
    run('ลบเฟส', () => supabase.from('npi_template_phases').delete().eq('id', p.id));
  };
  const delDeliv = (d) => { if (window.confirm(`ลบรายการ "${d.label}" ออกจากแม่แบบ? (พาร์ทที่สร้างไปแล้วไม่ถูกแตะ)`)) run('ลบรายการ', () => supabase.from('npi_template_deliverables').delete().eq('id', d.id)); };

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>⚙️ แม่แบบเฟส / รายการเอกสาร</div>
          <select value={tpl?.id || ''} onChange={e => setTplId(e.target.value)} style={{ ...inp, width: 'auto', minWidth: 240 }}>
            {templates.map(t => <option key={t.id} value={t.id}>{t.label}{t.customer ? ` (${t.customer})` : ''}{t.is_active ? '' : ' · ปิดใช้'}</option>)}
          </select>
          {tpl && <button style={ghost} onClick={() => setTplModal({ ...tpl })}>✏️ แม่แบบ</button>}
        </div>
        <button style={btn()} onClick={() => setTplModal({ code: '', label: '', customer: '', description: '', is_active: true, sort: (templates.length + 1) * 10 })}>+ แม่แบบ</button>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>แก้แม่แบบไม่ย้อนแก้พาร์ทที่สร้างไปแล้ว — พาร์ทกด 🔄 sync แม่แบบ เพื่อเติมรายการที่ขาด · code ใช้จับคู่ตอน sync (สร้างแล้วไม่ควรเปลี่ยน)</div>

      {tpl && (
        <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, alignItems: 'start' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 800 }}>เฟส ({phases.length})</div>
              <button style={{ ...ghost, padding: '3px 9px' }} onClick={() => setPhModal({ code: '', label: '', seq: (phases[phases.length - 1]?.seq || 0) + 1, color: '', description: '' })}>+ เฟส</button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={thSt}>#</th><th style={thSt}>เฟส</th><th style={thSt}>code</th><th style={thSt}></th></tr></thead>
              <tbody>{phases.map(p => (
                <tr key={p.id}>
                  <td style={tdSt}>{p.seq}</td>
                  <td style={tdSt}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: p.color || 'var(--border)', marginRight: 6 }} /><b>{p.label}</b>{p.description && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.description}</div>}</td>
                  <td style={{ ...tdSt, fontFamily: 'monospace', fontSize: 11 }}>{p.code}</td>
                  <td style={{ ...tdSt, whiteSpace: 'nowrap' }}><button className="tbtn" style={{ ...ghost, padding: '2px 7px' }} onClick={() => setPhModal({ ...p, color: p.color || '', description: p.description || '' })}>✏️</button> <button className="tbtn" style={{ ...ghost, padding: '2px 7px', color: '#ef4444' }} onClick={() => delPhase(p)}>🗑</button></td>
                </tr>
              ))}</tbody>
            </table>
            {!phases.length && <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 700 }}>ยังไม่มีเฟส — พาร์ทที่ใช้แม่แบบนี้จะไม่มีเฟส/รายการ</div>}
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 800 }}>รายการเอกสารส่งมอบ ({delivs.length} · PPAP {delivs.filter(d => d.ppap_element).length})</div>
              <button style={{ ...ghost, padding: '3px 9px' }} onClick={() => setDvModal({ code: '', label: '', phase_code: phases[0]?.code || '', seq: 10, doc_kind: 'other', required: true, ppap_element: false, owner_role: '', is_active: true })} disabled={!phases.length}>+ รายการ</button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thSt}>เฟส</th><th style={thSt}>#</th><th style={thSt}>รายการ</th><th style={thSt}>ชนิด</th><th style={thSt}>เจ้าของ</th><th style={thSt}>บังคับ</th><th style={thSt}>PPAP</th><th style={thSt}></th></tr></thead>
                <tbody>{delivs.map(d => (
                  <tr key={d.id} style={{ opacity: d.is_active === false ? 0.5 : 1 }}>
                    <td style={tdSt}>{phases.find(p => p.code === d.phase_code)?.label || <span style={{ color: '#f59e0b' }}>{d.phase_code} (ไม่มีเฟส)</span>}</td>
                    <td style={tdSt}>{d.seq}</td>
                    <td style={tdSt}><b style={{ color: 'var(--text)' }}>{d.label}</b><div style={{ fontFamily: 'monospace', fontSize: 10.5, color: 'var(--muted)' }}>{d.code}</div></td>
                    <td style={tdSt}>{DOC_KIND[d.doc_kind]?.icon} {DOC_KIND[d.doc_kind]?.label}</td>
                    <td style={tdSt}>{OWNER_ROLE[d.owner_role] || d.owner_role || '—'}</td>
                    <td style={tdSt}>{d.required ? '✓' : '—'}</td>
                    <td style={tdSt}>{d.ppap_element && <Pill label="PPAP" color="#a855f7" small />}</td>
                    <td style={{ ...tdSt, whiteSpace: 'nowrap' }}><button className="tbtn" style={{ ...ghost, padding: '2px 7px' }} onClick={() => setDvModal({ ...d, owner_role: d.owner_role || '' })}>✏️</button> <button className="tbtn" style={{ ...ghost, padding: '2px 7px', color: '#ef4444' }} onClick={() => delDeliv(d)}>🗑</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {!templates.length && <div style={{ color: '#f59e0b', fontSize: 12.5, fontWeight: 700 }}>ยังไม่มีแม่แบบ — apply migration 20260907_npi_apqp_main จะได้ APQP (AIAG) + Toyota SPTT มาให้</div>}

      {tplModal && (
        <Modal title={tplModal.id ? 'แก้ไขแม่แบบ' : 'สร้างแม่แบบ (ลูกค้าใหม่)'} onClose={() => setTplModal(null)} width={560}
          footer={<><button style={ghost} onClick={() => setTplModal(null)}>ยกเลิก</button><button style={btn()} disabled={saving} onClick={saveTpl}>💾 บันทึก</button></>}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'start' }}>
            <Field label="ชื่อแม่แบบ *" span={2}><input style={inp} value={tplModal.label} onChange={e => setTplModal({ ...tplModal, label: e.target.value })} placeholder="Isuzu NPD / Honda NMS" /></Field>
            {!tplModal.id && <Field label="code" hint="เว้นว่าง = สร้างจากชื่อ"><input style={inp} value={tplModal.code || ''} onChange={e => setTplModal({ ...tplModal, code: e.target.value })} /></Field>}
            {tplModal.id && <Field label="code"><input style={inp} value={tplModal.code} disabled /></Field>}
            <Field label="ลูกค้า" hint="ว่าง = ทั่วไป"><input style={inp} value={tplModal.customer || ''} onChange={e => setTplModal({ ...tplModal, customer: e.target.value })} /></Field>
            <Field label="คำอธิบาย" span={2}><input style={inp} value={tplModal.description || ''} onChange={e => setTplModal({ ...tplModal, description: e.target.value })} /></Field>
            <Field label="ลำดับ"><input type="number" style={inp} value={tplModal.sort ?? 0} onChange={e => setTplModal({ ...tplModal, sort: e.target.value })} /></Field>
            <label style={{ fontSize: 12.5, paddingTop: 22 }}><input type="checkbox" checked={tplModal.is_active !== false} onChange={e => setTplModal({ ...tplModal, is_active: e.target.checked })} /> เปิดใช้ (เลือกได้ตอนสร้างโปรเจค)</label>
          </div>
        </Modal>
      )}
      {phModal && (
        <Modal title={phModal.id ? 'แก้ไขเฟส' : 'เพิ่มเฟส'} onClose={() => setPhModal(null)} width={520}
          footer={<><button style={ghost} onClick={() => setPhModal(null)}>ยกเลิก</button><button style={btn()} disabled={saving} onClick={savePhase}>💾 บันทึก</button></>}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'start' }}>
            <Field label="ชื่อเฟส *" span={2}><input style={inp} value={phModal.label} onChange={e => setPhModal({ ...phModal, label: e.target.value })} /></Field>
            <Field label="code" hint={phModal.id ? 'เปลี่ยนไม่ได้' : 'ว่าง = จากชื่อ'}><input style={inp} value={phModal.code || ''} disabled={!!phModal.id} onChange={e => setPhModal({ ...phModal, code: e.target.value })} /></Field>
            <Field label="ลำดับ"><input type="number" style={inp} value={phModal.seq} onChange={e => setPhModal({ ...phModal, seq: e.target.value })} /></Field>
            <Field label="สี"><input type="color" style={{ ...inp, width: 60, padding: 2 }} value={phModal.color || '#3b82f6'} onChange={e => setPhModal({ ...phModal, color: e.target.value })} /></Field>
            <Field label="คำอธิบาย"><input style={inp} value={phModal.description || ''} onChange={e => setPhModal({ ...phModal, description: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
      {dvModal && (
        <Modal title={dvModal.id ? 'แก้ไขรายการ' : 'เพิ่มรายการเอกสาร'} onClose={() => setDvModal(null)} width={600}
          footer={<><button style={ghost} onClick={() => setDvModal(null)}>ยกเลิก</button><button style={btn()} disabled={saving} onClick={saveDeliv}>💾 บันทึก</button></>}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'start' }}>
            <Field label="ชื่อรายการ *" span={2}><input style={inp} value={dvModal.label} onChange={e => setDvModal({ ...dvModal, label: e.target.value })} /></Field>
            <Field label="code" hint={dvModal.id ? 'เปลี่ยนไม่ได้' : 'ว่าง = จากชื่อ'}><input style={inp} value={dvModal.code || ''} disabled={!!dvModal.id} onChange={e => setDvModal({ ...dvModal, code: e.target.value })} /></Field>
            <Field label="เฟส *"><select style={inp} value={dvModal.phase_code} onChange={e => setDvModal({ ...dvModal, phase_code: e.target.value })}>{phases.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}</select></Field>
            <Field label="ลำดับในเฟส"><input type="number" style={inp} value={dvModal.seq} onChange={e => setDvModal({ ...dvModal, seq: e.target.value })} /></Field>
            <Field label="ชนิดเอกสาร"><select style={inp} value={dvModal.doc_kind} onChange={e => setDvModal({ ...dvModal, doc_kind: e.target.value })}>{Object.entries(DOC_KIND).map(([k, m]) => <option key={k} value={k}>{m.icon} {m.label}</option>)}</select></Field>
            <Field label="ทีมเจ้าของ (default)"><select style={inp} value={dvModal.owner_role} onChange={e => setDvModal({ ...dvModal, owner_role: e.target.value })}><option value="">—</option>{Object.entries(OWNER_ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 18, fontSize: 12.5 }}>
              <label><input type="checkbox" checked={dvModal.required !== false} onChange={e => setDvModal({ ...dvModal, required: e.target.checked })} /> บังคับ</label>
              <label><input type="checkbox" checked={!!dvModal.ppap_element} onChange={e => setDvModal({ ...dvModal, ppap_element: e.target.checked })} /> อยู่ในชุด PPAP</label>
              <label><input type="checkbox" checked={dvModal.is_active !== false} onChange={e => setDvModal({ ...dvModal, is_active: e.target.checked })} /> ใช้งาน</label>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
