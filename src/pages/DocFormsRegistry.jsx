import { useState, useEffect, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { toast } from '../components/Toast';
import { loadDocForms } from '../utils/docForms';

/* ══════════════════════════════════════════════════════════════
   📄 ทะเบียนเอกสาร & ฟอร์ม (Document Master) — หน้า /doc-forms
   รวมฟอร์มพิมพ์ทุกตัวในระบบ: เลขฟอร์ม / Rev / Effective Date / ช่องลายเซ็น / footer
   document_control แก้ได้เองไม่ต้องแก้โค้ด — ฟังก์ชันพิมพ์อ่านผ่าน src/utils/docForms.js
   (fallback ค่าเดิมในโค้ดเสมอ — แถวหาย/ค่าว่าง = ฟอร์มพิมพ์ได้เหมือนเดิม)
   ⚠️ doc_key คือคีย์ที่โค้ดอ้าง — แก้ไม่ได้จาก UI
   ══════════════════════════════════════════════════════════════ */

export default function DocFormsRegistry() {
  const { role } = useContext(UserContext);
  const canManage = can('doc_forms', 'manage', role);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [profiles, setProfiles] = useState([]);   // ผู้ออกเอกสาร (Issued)
  const [revisions, setRevisions] = useState([]); // Revision History ของฟอร์มที่กำลังแก้
  const emptyRev = { record_date: '', rev: '', issued_date: '', description: '', responsible: '', approved_name: '' };
  const [newRev, setNewRev] = useState(emptyRev);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('doc_forms').select('*').order('form_code', { nullsFirst: false });
    setRows(data || []);
    setLoading(false);
  };
  useEffect(() => {
    load();
    supabase.from('profiles').select('id, full_name').order('full_name').then(({ data }) => setProfiles(data || []));
  }, []);

  // Revision History ต่อ doc_key (โหลดตอนเปิด modal — ตารางยังไม่มี = ว่าง ไม่ล้ม)
  const loadRevisions = async (docKey) => {
    try {
      const { data } = await supabase.from('doc_form_revisions')
        .select('id, seq, record_date, rev, issued_date, description, responsible, approved_name')
        .eq('doc_key', docKey).order('seq');
      setRevisions(data || []);
    } catch { setRevisions([]); }
  };
  const openEdit = (r) => {
    setEditing({ ...r, _sigText: Array.isArray(r.sig_blocks) ? r.sig_blocks.join('\n') : '' });
    setNewRev(emptyRev);
    loadRevisions(r.doc_key);
  };
  const addRevision = async () => {
    if (!newRev.rev.trim()) { toast.error('กรุณาระบุ Rev'); return; }
    const { error } = await supabase.from('doc_form_revisions').insert([{
      doc_key: editing.doc_key, seq: Math.max(0, ...revisions.map(r => r.seq || 0)) + 1,
      record_date: newRev.record_date || null, rev: newRev.rev.trim(), issued_date: newRev.issued_date || null,
      description: newRev.description.trim() || null, responsible: newRev.responsible.trim() || null,
      approved_name: newRev.approved_name.trim() || null,
    }]);
    if (error) { toast.error('เกิดข้อผิดพลาด: ' + error.message); return; }
    setNewRev(emptyRev);
    loadRevisions(editing.doc_key);
  };
  const removeRevision = async (r) => {
    if (!window.confirm(`ลบ Rev "${r.rev}"?`)) return;
    await supabase.from('doc_form_revisions').delete().eq('id', r.id);
    loadRevisions(editing.doc_key);
  };

  const setF = (k, v) => setEditing(prev => ({ ...prev, [k]: v }));

  const save = async () => {
    if (!canManage) return;
    setSaving(true);
    try {
      const sig = (editing._sigText || '').split('\n').map(s => s.trim()).filter(Boolean);
      const { error } = await supabase.from('doc_forms').update({
        form_code: editing.form_code?.trim() || null,
        title: editing.title?.trim() || null,
        rev: editing.rev?.trim() || null,
        effective_date: editing.effective_date?.trim() || null,
        paper: editing.paper?.trim() || null,
        sig_blocks: sig.length ? sig : null,
        footer_note: editing.footer_note?.trim() || null,
        notes: editing.notes?.trim() || null,
        legend: editing.legend?.trim() || null,
        issued_by: editing.issued_by || null,
        is_active: editing.is_active !== false,
        updated_at: new Date().toISOString(),
      }).eq('id', editing.id);
      if (error) throw error;
      toast.success('บันทึกทะเบียนเอกสารแล้ว — ใบพิมพ์รอบถัดไปใช้ค่าใหม่ทันที');
      setEditing(null);
      await loadDocForms(true); // refresh cache ให้ฟังก์ชันพิมพ์ในแท็บนี้เห็นค่าใหม่
      load();
    } catch (e) { toast.error('บันทึกไม่สำเร็จ: ' + e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="page-content">
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(16px,3vw,22px)', color: 'var(--text)' }}>📄 ทะเบียนเอกสาร & ฟอร์ม</h2>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
          Document Master — เลขฟอร์ม / Rev / Effective Date ของฟอร์มพิมพ์ทุกตัวในระบบ · แก้ที่นี่แล้วใบพิมพ์ใช้ค่าใหม่ทันที ไม่ต้องแก้โปรแกรม
          {!canManage && ' · คุณมีสิทธิ์ดูอย่างเดียว'}
        </div>
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>กำลังโหลด...</div> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 860 }}>
            <thead>
              <tr style={{ fontSize: 12 }}>
                <th style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>เลขฟอร์ม</th>
                <th style={{ textAlign: 'left', minWidth: 260 }}>ชื่อเอกสาร</th>
                <th>Rev</th>
                <th style={{ whiteSpace: 'nowrap' }}>Effective Date</th>
                <th style={{ whiteSpace: 'nowrap' }}>กระดาษ</th>
                <th style={{ whiteSpace: 'nowrap' }}>ใช้ที่หน้า</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.45 }}>
                  <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{r.form_code || <span style={{ color: 'var(--muted)', fontWeight: 400 }}>— ไม่มีเลข —</span>}</td>
                  <td style={{ fontSize: 13 }}>{r.title || '—'}
                    {r.notes && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.notes}</div>}
                  </td>
                  <td style={{ textAlign: 'center', fontSize: 12 }}>{r.rev || '—'}</td>
                  <td style={{ textAlign: 'center', fontSize: 12, whiteSpace: 'nowrap' }}>{r.effective_date || '—'}</td>
                  <td style={{ textAlign: 'center', fontSize: 12, whiteSpace: 'nowrap' }}>{r.paper || '—'}</td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {r.used_route
                      ? <a href={r.used_route} style={{ fontSize: 12, color: '#4d9fff', textDecoration: 'none' }}>{r.used_route}</a>
                      : '—'}
                  </td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {canManage && (
                      <button className="tbtn" onClick={() => openEdit(r)}
                        style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)' }}>✏️ แก้ไข</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
        💡 ฟอร์มใหม่จะถูกเพิ่มเข้าทะเบียนโดยทีมพัฒนาเมื่อสร้างฟอร์มในระบบ (คีย์อ้างอิงผูกกับโค้ด) — หน้านี้แก้ เลขฟอร์ม/Rev/Effective/ช่องลายเซ็น/หมายเหตุ ได้เอง
      </div>

      {/* modal แก้ไข (มีฟอร์ม — ไม่ปิดจาก backdrop) */}
      {editing && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, width: 'min(96vw, 940px)', maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>✏️ แก้ไขทะเบียน — <span style={{ color: 'var(--accent)' }}>{editing.doc_key}</span></div>
              <button onClick={() => setEditing(null)} style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div><div style={lb}>เลขฟอร์ม</div><input type="text" value={editing.form_code || ''} onChange={e => setF('form_code', e.target.value)} placeholder="FM-XXX-000" style={{ width: '100%' }} /></div>
                <div><div style={lb}>Rev</div><input type="text" value={editing.rev || ''} onChange={e => setF('rev', e.target.value)} placeholder="Rev.01" style={{ width: '100%' }} /></div>
                <div><div style={lb}>Effective Date (ตามที่พิมพ์บนฟอร์ม)</div><input type="text" value={editing.effective_date || ''} onChange={e => setF('effective_date', e.target.value)} placeholder="12/05/2017" style={{ width: '100%' }} /></div>
              </div>
              <div><div style={lb}>ชื่อเอกสาร</div><input type="text" value={editing.title || ''} onChange={e => setF('title', e.target.value)} style={{ width: '100%' }} /></div>
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div><div style={lb}>ขนาด/แนวกระดาษ (แสดงในทะเบียน)</div><input type="text" value={editing.paper || ''} onChange={e => setF('paper', e.target.value)} style={{ width: '100%' }} /></div>
                <div>
                  <div style={lb}>ใช้งาน</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text)', cursor: 'pointer', paddingTop: 6 }}>
                    <input type="checkbox" checked={editing.is_active !== false} onChange={e => setF('is_active', e.target.checked)} style={{ width: 'auto' }} />
                    เปิดใช้ (ปิด = ฟอร์มใช้ค่า default ในโค้ด)
                  </label>
                </div>
              </div>
              <div>
                <div style={lb}>ช่องลายเซ็นหัวเอกสาร (บรรทัดละช่อง — เว้นว่าง = ใช้ default ของฟอร์ม)</div>
                <textarea rows={3} value={editing._sigText} onChange={e => setF('_sigText', e.target.value)} placeholder={'ผู้จัดทำ\nระดับจัดการอนุมัติ\nผู้รับทราบ'} style={{ width: '100%', fontSize: 13 }} />
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>⚠️ จำนวนช่องต้องเท่าเดิมตาม layout ฟอร์ม (เปลี่ยนได้เฉพาะข้อความ)</div>
              </div>
              <div><div style={lb}>ข้อความท้ายฟอร์มเพิ่มเติม (footer)</div><input type="text" value={editing.footer_note || ''} onChange={e => setF('footer_note', e.target.value)} style={{ width: '100%' }} /></div>
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div style={lb}>Legend / คำอธิบายสัญลักษณ์บนฟอร์ม (ถ้ามี)</div>
                  <textarea rows={2} value={editing.legend || ''} onChange={e => setF('legend', e.target.value)} style={{ width: '100%', fontSize: 13, resize: 'vertical' }} />
                </div>
                <div>
                  <div style={lb}>ผู้ออกเอกสาร (Issued — ใช้ชื่อ+ลายเซ็นบนฟอร์มที่รองรับ)</div>
                  <select value={editing.issued_by || ''} onChange={e => setF('issued_by', e.target.value)} style={{ width: '100%' }}>
                    <option value="">— ไม่ระบุ —</option>
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                </div>
              </div>
              <div><div style={lb}>หมายเหตุ (แสดงเฉพาะในทะเบียน)</div><input type="text" value={editing.notes || ''} onChange={e => setF('notes', e.target.value)} style={{ width: '100%' }} /></div>

              {/* Revision History — เขียนตรงเข้า doc_form_revisions ทันที (ไม่รอปุ่มบันทึกหลัก) */}
              <div style={{ borderTop: '1px solid var(--border2)', paddingTop: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>📜 ประวัติการแก้ไขเอกสาร (Revision History) <span style={{ color: 'var(--muted)', fontWeight: 600 }}>({revisions.length})</span></div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', minWidth: 700, fontSize: 12 }}>
                    <thead><tr style={{ fontSize: 11, color: 'var(--muted)' }}>
                      <th>#</th><th>วันที่บันทึก</th><th>Rev</th><th>Issued date</th><th style={{ textAlign: 'left' }}>Description</th><th>Responsible</th><th>Approved</th><th></th>
                    </tr></thead>
                    <tbody>
                      {revisions.map(r => (
                        <tr key={r.id}>
                          <td style={{ textAlign: 'center' }}>{r.seq}</td>
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{r.record_date || '—'}</td>
                          <td style={{ textAlign: 'center' }}>{r.rev || '—'}</td>
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{r.issued_date || '—'}</td>
                          <td>{r.description || '—'}</td>
                          <td style={{ textAlign: 'center' }}>{r.responsible || '—'}</td>
                          <td style={{ textAlign: 'center' }}>{r.approved_name || '—'}</td>
                          <td style={{ textAlign: 'center' }}>
                            <button className="tbtn" onClick={() => removeRevision(r)} title="ลบ"
                              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 13 }}>🗑</button>
                          </td>
                        </tr>
                      ))}
                      {!revisions.length && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 8 }}>ยังไม่มีประวัติการแก้ไข</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '110px 70px 110px 1fr 110px 110px auto', gap: 6, marginTop: 8, alignItems: 'center' }}>
                  <input type="date" value={newRev.record_date} onChange={e => setNewRev(v => ({ ...v, record_date: e.target.value }))} title="วันที่บันทึก" style={{ width: '100%' }} />
                  <input type="text" value={newRev.rev} onChange={e => setNewRev(v => ({ ...v, rev: e.target.value }))} placeholder="Rev" style={{ width: '100%' }} />
                  <input type="date" value={newRev.issued_date} onChange={e => setNewRev(v => ({ ...v, issued_date: e.target.value }))} title="Issued date" style={{ width: '100%' }} />
                  <input type="text" value={newRev.description} onChange={e => setNewRev(v => ({ ...v, description: e.target.value }))} placeholder="Description" style={{ width: '100%' }} />
                  <input type="text" value={newRev.responsible} onChange={e => setNewRev(v => ({ ...v, responsible: e.target.value }))} placeholder="Responsible" style={{ width: '100%' }} />
                  <input type="text" value={newRev.approved_name} onChange={e => setNewRev(v => ({ ...v, approved_name: e.target.value }))} placeholder="Approved" style={{ width: '100%' }} />
                  <button onClick={addRevision} style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}>+ เพิ่ม</button>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button onClick={() => setEditing(null)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}>ยกเลิก</button>
                <button onClick={save} disabled={saving} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13, opacity: saving ? 0.6 : 1 }}>
                  {saving ? '⏳...' : '💾 บันทึก'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const lb = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 };
