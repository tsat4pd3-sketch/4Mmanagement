import { useState, useEffect, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { toast } from '../components/Toast';
import { loadDocForms, docFormSync, docFormScopes } from '../utils/docForms';
import { buildDocFormPreviewHtml } from '../lib/docFormPreview';
import tsLogoUrl from '../assets/TS logo.png';

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
  const [sections, setSections] = useState([]);   // ส่วนงานจากผังองค์กร (org_nodes kind='section')
  const [scopes, setScopes] = useState([]);       // ชุดช่องเซ็นเฉพาะส่วนงานของฟอร์มที่กำลังแก้
  const [scopeEdit, setScopeEdit] = useState(null); // scope ที่กำลังแก้ (null = ไม่ได้เปิด)
  const [previewScope, setPreviewScope] = useState(''); // ส่วนงานที่จะใช้ตอนกดดูตัวอย่าง
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
    // ส่วนงานยึดผังองค์กรเสมอ (กฎ CLAUDE.md — ห้ามเดาจาก production_lines.section)
    supabase.from('org_nodes').select('id, code, name, kind').eq('kind', 'section').order('sort_order', { nullsFirst: false })
      .then(({ data }) => setSections(data || []));
  }, []);

  // ── ชุดช่องเซ็นเฉพาะส่วนงาน (doc_form_scopes) — ยังไม่ apply migration = ว่าง ไม่ล้ม ──
  const loadScopes = async (docKey) => {
    try {
      const { data } = await supabase.from('doc_form_scopes').select('*').eq('doc_key', docKey).order('section');
      setScopes(data || []);
    } catch { setScopes([]); }
  };

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
    setScopeEdit(null); setPreviewScope('');
    loadRevisions(r.doc_key);
    loadScopes(r.doc_key);
  };

  // ── ทดลองพิมพ์/บันทึก PDF จากทะเบียน (specimen — มีลายน้ำ ไม่ใช่เอกสารจริง) ──
  const preview = async (row, section = '') => {
    await loadDocForms(true);   // ใช้ค่าล่าสุดในทะเบียนเสมอ
    const df = docFormSync(row.doc_key, {}, { section });
    const sec = sections.find(x => (x.code || x.name) === section);
    const html = buildDocFormPreviewHtml(df, {
      logoUrl: df.logo_url || tsLogoUrl,
      route: row.used_route || '(ยังไม่ระบุหน้าที่ใช้งาน)',
      scopeLabel: section ? (sec ? `${sec.code || ''} ${sec.name || ''}`.trim() : section) : '',
      issuedName: profiles.find(p => p.id === df.issued_by)?.full_name || '',
      revisions: await (async () => {
        try {
          const { data } = await supabase.from('doc_form_revisions')
            .select('seq, record_date, rev, issued_date, description, responsible, approved_name')
            .eq('doc_key', row.doc_key).order('seq');
          return data || [];
        } catch { return []; }
      })(),
    });
    const w = window.open('', '_blank');
    if (!w) { toast.error('เบราว์เซอร์บล็อก popup — อนุญาต popup ของเว็บนี้ก่อน'); return; }
    w.document.write(html); w.document.close();
  };

  // ── บันทึกชุดช่องเซ็นเฉพาะส่วนงาน ──
  const baseBlocks = (r) => (Array.isArray(r?.sig_blocks) ? r.sig_blocks : []);
  const openScope = (row, sc) => setScopeEdit({
    id: sc?.id || null, doc_key: row.doc_key, section: sc?.section || '',
    // ป้าย/ชื่อ ยาวเท่าจำนวนช่องฐานเสมอ — layout ฟอร์มตายตัว เพิ่ม/ลดช่องไม่ได้
    labels: baseBlocks(row).map((b, i) => sc?.sig_blocks?.[i] ?? b ?? ''),
    names: baseBlocks(row).map((_, i) => sc?.sig_names?.[i] ?? ''),
    footer_note: sc?.footer_note || '', legend: sc?.legend || '', issued_by: sc?.issued_by || '',
  });
  const saveScope = async () => {
    if (!scopeEdit.section) { toast.error('เลือกส่วนงานก่อน'); return; }
    const payload = {
      doc_key: scopeEdit.doc_key, section: scopeEdit.section,
      // ป้ายที่ไม่ได้แก้จากฐาน = ไม่ต้องเก็บ (ฐานเปลี่ยนแล้วตามเอง)
      sig_blocks: scopeEdit.labels.some((v, i) => v !== (baseBlocks(editing)[i] || '')) ? scopeEdit.labels : null,
      sig_names: scopeEdit.names.some(v => (v || '').trim()) ? scopeEdit.names.map(v => (v || '').trim()) : null,
      footer_note: scopeEdit.footer_note.trim() || null,
      legend: scopeEdit.legend.trim() || null,
      issued_by: scopeEdit.issued_by || null,
      updated_at: new Date().toISOString(),
    };
    const q = scopeEdit.id
      ? supabase.from('doc_form_scopes').update(payload).eq('id', scopeEdit.id)
      : supabase.from('doc_form_scopes').insert([payload]);
    const { error } = await q;
    if (error) {
      toast.error(error.code === '42P01'
        ? 'ยังไม่ได้ apply migration doc_form_scopes — ใบพิมพ์ยังใช้ชุดกลางได้ปกติ'
        : 'บันทึกไม่สำเร็จ: ' + error.message);
      return;
    }
    toast.success('บันทึกชุดของส่วนงานแล้ว');
    setScopeEdit(null); loadScopes(scopeEdit.doc_key); loadDocForms(true);
  };
  const removeScope = async (sc) => {
    if (!window.confirm(`ลบชุดของส่วนงาน "${sc.section}"? (กลับไปใช้ชุดกลาง)`)) return;
    await supabase.from('doc_form_scopes').delete().eq('id', sc.id);
    loadScopes(sc.doc_key); loadDocForms(true);
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
        paper_size: editing.paper_size || null,
        orientation: editing.orientation || null,
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
                  <td style={{ textAlign: 'center', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {r.paper_size ? `${r.paper_size} ${r.orientation === 'landscape' ? 'แนวนอน' : 'แนวตั้ง'}` : (r.paper || '—')}
                    {r.layout_locked === false && <div style={{ fontSize: 10, color: 'var(--accent)' }}>ปรับแนวได้</div>}
                  </td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {r.used_route
                      ? <a href={r.used_route} style={{ fontSize: 12, color: '#4d9fff', textDecoration: 'none' }}>{r.used_route}</a>
                      : '—'}
                  </td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <button className="tbtn" onClick={() => preview(r)} title="ทดลองพิมพ์ / บันทึกเป็น PDF (ตัวอย่าง มีลายน้ำ)"
                      style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', marginRight: 6 }}>🖨️ ตัวอย่าง</button>
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
                <div>
                  <div style={lb}>ขนาด / แนวกระดาษ</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select value={editing.paper_size || 'A4'} onChange={e => setF('paper_size', e.target.value)} style={{ width: 90 }}>
                      {['A4', 'A3', 'Letter'].map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                    <select value={editing.orientation || 'portrait'} onChange={e => setF('orientation', e.target.value)}
                      disabled={editing.layout_locked !== false} style={{ flex: 1 }}>
                      <option value="portrait">แนวตั้ง (portrait)</option>
                      <option value="landscape">แนวนอน (landscape)</option>
                    </select>
                  </div>
                  <div style={{ fontSize: 11, color: editing.layout_locked !== false ? 'var(--muted)' : 'var(--accent)', marginTop: 3, lineHeight: 1.5 }}>
                    {editing.layout_locked !== false
                      ? '🔒 ฟอร์มนี้ layout ออกแบบมาตายตัวกับแนวกระดาษ (ตารางกว้างตามจำนวนวัน/คอลัมน์) — เปลี่ยนแนวแล้วใบพัง จึงล็อกไว้ ค่าที่แสดงใช้กับใบตัวอย่างเท่านั้น'
                      : '✅ รายงานภายใน — เปลี่ยนแนวแล้วมีผลกับใบพิมพ์จริงทันที'}
                  </div>
                </div>
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

              {/* ── ชุดช่องเซ็นเฉพาะส่วนงาน — ฐานกลาง 1 ชุด + override ต่อส่วนงาน ─────────────────
                   เลขฟอร์ม/Rev เป็นของบริษัท (ชุดเดียว) · ชื่อคนเซ็นเป็นของแผนก → แยกที่ชั้นนี้
                   ไม่มีแถว = ใช้ชุดกลาง (pattern เดียวกับ lpa_questions.line_name null = common) */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>
                    ✍️ ชุดช่องลายเซ็นเฉพาะส่วนงาน <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({scopes.length})</span>
                  </div>
                  {canManage && (
                    <button onClick={() => openScope(editing, null)}
                      style={{ padding: '4px 11px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--accent)', border: '1px solid var(--border2)' }}>+ เพิ่มส่วนงาน</button>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', margin: '3px 0 7px', lineHeight: 1.6 }}>
                  ส่วนงานที่ไม่ได้ตั้งไว้ = ใช้ช่องเซ็นชุดกลางด้านบน · ตั้งได้เฉพาะ <b>ข้อความป้าย</b> กับ <b>ชื่อผู้เซ็นประจำ</b> (จำนวนช่องเปลี่ยนไม่ได้ — ผูกกับ layout ฟอร์ม)
                </div>
                {scopes.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>ยังไม่มี — ทุกส่วนงานใช้ชุดกลาง</div>
                ) : (
                  <div style={{ display: 'grid', gap: 5 }}>
                    {scopes.map(sc => (
                      <div key={sc.id} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <b style={{ fontSize: 12.5, color: 'var(--accent)' }}>{sc.section}</b>
                        <span style={{ fontSize: 11.5, color: 'var(--text2)', flex: 1, minWidth: 160 }}>
                          {(sc.sig_names || []).filter(Boolean).length
                            ? (sc.sig_names || []).map((n, i) => n ? `${(sc.sig_blocks || editing.sig_blocks || [])[i] || ''}: ${n}` : null).filter(Boolean).join(' · ')
                            : <span style={{ color: 'var(--muted)' }}>เปลี่ยนเฉพาะป้ายช่อง</span>}
                        </span>
                        <button onClick={() => preview(editing, sc.section)} style={sbtn}>🖨️ ตัวอย่าง</button>
                        {canManage && <button onClick={() => openScope(editing, sc)} style={sbtn}>✏️</button>}
                        {canManage && <button onClick={() => removeScope(sc)} style={{ ...sbtn, color: '#e05252' }}>🗑</button>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── ทดลองพิมพ์ ── */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' }}>🖨️ ทดลองพิมพ์ / บันทึก PDF</span>
                <select value={previewScope} onChange={e => setPreviewScope(e.target.value)} style={{ width: 220, fontSize: 12.5 }}>
                  <option value="">— ชุดกลาง (ทุกส่วนงาน) —</option>
                  {scopes.map(sc => <option key={sc.id} value={sc.section}>{sc.section}</option>)}
                </select>
                <button onClick={() => preview(editing, previewScope)}
                  style={{ padding: '5px 13px', borderRadius: 7, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>เปิดตัวอย่าง</button>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>ใบตัวอย่างมีลายน้ำ “ตัวอย่าง” — เซฟ PDF จากหน้าต่างพิมพ์ของเบราว์เซอร์ · บันทึกทะเบียนก่อนถึงจะเห็นค่าล่าสุด</span>
              </div>

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

      {/* modal ชุดช่องเซ็นของส่วนงานเดียว (ซ้อนบน modal ทะเบียน) */}
      {scopeEdit && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 3100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, width: 'min(96vw, 700px)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--text)' }}>✍️ ชุดช่องลายเซ็นของส่วนงาน</div>
              <button onClick={() => setScopeEdit(null)} style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={lb}>ส่วนงาน (จากผังองค์กร)</div>
                <select value={scopeEdit.section} onChange={e => setScopeEdit(v => ({ ...v, section: e.target.value }))}
                  disabled={!!scopeEdit.id} style={{ width: '100%' }}>
                  <option value="">— เลือกส่วนงาน —</option>
                  {sections.map(sc => {
                    const code = sc.code || sc.name;
                    const used = scopes.some(x => x.section === code && x.id !== scopeEdit.id);
                    return <option key={sc.id} value={code} disabled={used}>{code}{sc.name && sc.name !== code ? ` — ${sc.name}` : ''}{used ? ' (ตั้งไว้แล้ว)' : ''}</option>;
                  })}
                </select>
                {!!scopeEdit.id && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>เปลี่ยนส่วนงานไม่ได้ — ถ้าผิดให้ลบแล้วเพิ่มใหม่</div>}
              </div>
              <div>
                <div style={lb}>ช่องลายเซ็น — ป้าย + ชื่อผู้เซ็นประจำ</div>
                {scopeEdit.labels.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>ฟอร์มนี้ยังไม่ได้ตั้งช่องลายเซ็นในชุดกลาง — ตั้งที่ช่อง “ช่องลายเซ็นหัวเอกสาร” ก่อน</div>
                ) : scopeEdit.labels.map((lbl, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '24px 1fr 1fr', gap: 6, alignItems: 'center', marginBottom: 5 }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>{i + 1}</span>
                    <input type="text" value={lbl} placeholder="ป้ายช่อง" style={{ width: '100%', fontSize: 12.5 }}
                      onChange={e => setScopeEdit(v => ({ ...v, labels: v.labels.map((x, j) => j === i ? e.target.value : x) }))} />
                    <input type="text" list="doc-scope-people" value={scopeEdit.names[i] || ''} placeholder="ชื่อผู้เซ็นประจำ (เว้นว่าง = เซ็นสด)" style={{ width: '100%', fontSize: 12.5 }}
                      onChange={e => setScopeEdit(v => ({ ...v, names: v.names.map((x, j) => j === i ? e.target.value : x) }))} />
                  </div>
                ))}
                <datalist id="doc-scope-people">{profiles.map(p => <option key={p.id} value={p.full_name || ''} />)}</datalist>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, lineHeight: 1.6 }}>
                  ⚠️ จำนวนช่องล็อกตาม layout ฟอร์ม · ป้ายที่ไม่แก้ = ตามชุดกลาง (ชุดกลางเปลี่ยนแล้วตามเอง) · ชื่อที่กรอกจะพิมพ์ใต้เส้นลงชื่อ
                </div>
              </div>
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div><div style={lb}>footer เฉพาะส่วนงาน (เว้นว่าง = ใช้ของกลาง)</div>
                  <input type="text" value={scopeEdit.footer_note} onChange={e => setScopeEdit(v => ({ ...v, footer_note: e.target.value }))} style={{ width: '100%' }} /></div>
                <div><div style={lb}>ผู้ออกเอกสารเฉพาะส่วนงาน</div>
                  <select value={scopeEdit.issued_by || ''} onChange={e => setScopeEdit(v => ({ ...v, issued_by: e.target.value }))} style={{ width: '100%' }}>
                    <option value="">— ใช้ของกลาง —</option>
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select></div>
              </div>
              <div><div style={lb}>Legend เฉพาะส่วนงาน (เว้นว่าง = ใช้ของกลาง)</div>
                <textarea rows={2} value={scopeEdit.legend} onChange={e => setScopeEdit(v => ({ ...v, legend: e.target.value }))} style={{ width: '100%', fontSize: 12.5 }} /></div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={() => setScopeEdit(null)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}>ยกเลิก</button>
                <button onClick={saveScope} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>💾 บันทึก</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const sbtn = { padding: '3px 9px', borderRadius: 6, fontSize: 11.5, cursor: 'pointer', background: 'var(--bg)', color: 'var(--text2)', border: '1px solid var(--border2)' };
const lb = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 };
