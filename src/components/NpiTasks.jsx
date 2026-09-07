/* ═══ NpiTasks — งานที่มอบหมายในโปรเจครุ่นใหม่ (ผูกพาร์ท/เฟส/รายการเอกสารได้) ═══
   มอบหมายให้ user ในระบบ → แจ้งเข้ากระดิ่ง 🔔 ของคนนั้นตรง (pattern เดียวกับ mention ใน EventComments)
   ผู้รับที่ไม่ใช่ user ระบบ (ชื่อพิมพ์เอง) = บันทึกได้ แต่ไม่มีแจ้งเตือน — บอกบนจอ */
import { useState, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import { fmtDate } from '../utils/dateFormat';
import { TASK_STATUS } from '../utils/npi';
import SearchSelect from './SearchSelect';
import { inp, card, btn, ghost, thSt, tdSt, Field, Pill, LightDot, MetaSelect, Modal } from './NpiUi';

export default function NpiTasks({ project, parts, tplPhases, delivs, tasks, users, canEdit, fullName, today, onChanged }) {
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [mine, setMine] = useState(false);

  const rows = useMemo(() => tasks.filter(t => (showDone || (t.status !== 'done' && t.status !== 'cancelled')) && (!mine || t.assignee_name === fullName)), [tasks, showDone, mine, fullName]);
  const hidden = tasks.length - rows.length;
  const userOpts = useMemo(() => users.map(u => ({ id: u.id, label: u.full_name, keywords: u.role })), [users]);
  const light = (t) => t.status === 'done' ? 'green' : t.status === 'cancelled' ? 'grey' : t.due_date && t.due_date < today ? 'red' : t.status === 'doing' ? 'amber' : 'grey';

  const save = async () => {
    const m = modal;
    if (!m.title?.trim()) return toast.error('กรอกชื่องาน');
    setSaving(true);
    const row = { title: m.title.trim(), detail: m.detail?.trim() || null, part_id: m.part_id || null, phase_code: m.phase_code || null, deliverable_id: m.deliverable_id || null,
      assignee_name: m.assignee_name?.trim() || null, assignee_uid: m.assignee_uid || null, due_date: m.due_date || null, status: m.status,
      done_at: m.status === 'done' ? (m.done_at || new Date().toISOString()) : null };
    let res;
    if (m.id) res = await supabase.from('npi_tasks').update(row).eq('id', m.id).select().single();
    else res = await supabase.from('npi_tasks').insert({ ...row, project_id: project.id, created_by_name: fullName || null }).select().single();
    setSaving(false);
    if (res.error) return toast.error(`บันทึกไม่สำเร็จ: ${res.error.message}`);
    // แจ้งผู้รับมอบหมาย (เฉพาะ user ระบบ + เปลี่ยนคน) — best-effort
    if (row.assignee_uid && row.assignee_uid !== m._orig_uid) {
      const { data: { user } } = await supabase.auth.getUser();
      if (row.assignee_uid !== user?.id) {
        const p = parts.find(x => x.id === row.part_id);
        supabase.from('notifications').insert({ user_id: row.assignee_uid, type: 'info',
          title: `✅ ${fullName || 'เพื่อนร่วมงาน'} มอบหมายงาน NPI: ${row.title}`,
          body: [project.name, p ? `พาร์ท ${p.part_no}` : '', row.due_date ? `กำหนด ${fmtDate(row.due_date)}` : ''].filter(Boolean).join(' · '),
          ref_table: 'npi_tasks', ref_id: res.data?.id || null,
        }).then(({ error }) => { if (error) toast.info(`บันทึกงานแล้ว แต่ส่งแจ้งเตือนไม่สำเร็จ: ${error.message}`); });
      }
    }
    toast.success('บันทึกงานแล้ว'); setModal(null); onChanged();
  };
  const quick = async (t, status) => {
    const { error } = await supabase.from('npi_tasks').update({ status, done_at: status === 'done' ? new Date().toISOString() : null }).eq('id', t.id);
    if (error) return toast.error(error.message);
    onChanged();
  };
  const del = async (t) => {
    if (!window.confirm(`ลบงาน "${t.title}"?`)) return;
    const { error } = await supabase.from('npi_tasks').delete().eq('id', t.id);
    if (error) return toast.error(error.message);
    onChanged();
  };

  const partDelivs = useMemo(() => delivs.filter(d => d.part_id === modal?.part_id), [delivs, modal?.part_id]);

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>✅ งานในโปรเจค ({rows.length}{hidden ? ` · ซ่อน ${hidden}` : ''})</div>
          <label style={{ fontSize: 12 }}><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> แสดงที่เสร็จ/ยกเลิก</label>
          <label style={{ fontSize: 12 }}><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> เฉพาะของฉัน</label>
        </div>
        {canEdit && <button style={btn()} onClick={() => setModal({ title: '', detail: '', part_id: '', phase_code: '', deliverable_id: '', assignee_name: '', assignee_uid: '', due_date: '', status: 'open' })}>+ งาน</button>}
      </div>
      {!rows.length ? <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>{tasks.length ? 'ไม่มีงานตามตัวกรอง' : 'ยังไม่มีงาน'}</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thSt}></th><th style={thSt}>งาน</th><th style={thSt}>พาร์ท/เฟส</th><th style={thSt}>ผู้รับ</th><th style={thSt}>กำหนด</th><th style={thSt}>สถานะ</th><th style={thSt}></th></tr></thead>
            <tbody>
              {rows.map(t => {
                const p = parts.find(x => x.id === t.part_id);
                const dv = delivs.find(d => d.id === t.deliverable_id);
                const lt = light(t);
                return (
                  <tr key={t.id}>
                    <td style={tdSt}><LightDot light={lt} /></td>
                    <td style={{ ...tdSt, minWidth: 220 }}><div style={{ fontWeight: 700, color: 'var(--text)' }}>{t.title}</div>{t.detail && <div style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>{t.detail}</div>}{dv && <div style={{ fontSize: 11, color: '#4d9fff' }}>📄 {dv.label}</div>}</td>
                    <td style={tdSt}>{p?.part_no || <span style={{ color: 'var(--muted)' }}>ทั้งโปรเจค</span>}{t.phase_code && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{tplPhases.find(x => x.code === t.phase_code)?.label || t.phase_code}</div>}</td>
                    <td style={tdSt}>{t.assignee_name || <span style={{ color: '#f59e0b' }}>ยังไม่มอบหมาย</span>}{t.assignee_name && !t.assignee_uid && <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>ไม่ใช่ user ระบบ — ไม่มีแจ้งเตือน</div>}</td>
                    <td style={{ ...tdSt, color: lt === 'red' ? '#ef4444' : undefined, fontWeight: lt === 'red' ? 800 : 400 }}>{t.due_date ? fmtDate(t.due_date) : '—'}</td>
                    <td style={tdSt}><Pill label={TASK_STATUS[t.status]?.label} color={TASK_STATUS[t.status]?.color} /></td>
                    <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>
                      {canEdit && t.status !== 'done' && t.status !== 'cancelled' && <>
                        {t.status === 'open' && <button style={{ ...ghost, padding: '2px 8px', fontSize: 11 }} onClick={() => quick(t, 'doing')}>▶ เริ่ม</button>}{' '}
                        <button style={{ ...btn('#22c55e'), padding: '2px 8px', fontSize: 11 }} onClick={() => quick(t, 'done')}>✓ เสร็จ</button>{' '}
                      </>}
                      {canEdit && <><button className="tbtn" style={{ ...ghost, padding: '2px 7px' }} onClick={() => setModal({ ...t, _orig_uid: t.assignee_uid, part_id: t.part_id || '', phase_code: t.phase_code || '', deliverable_id: t.deliverable_id || '', assignee_name: t.assignee_name || '', assignee_uid: t.assignee_uid || '', due_date: t.due_date || '', detail: t.detail || '' })}>✏️</button> <button className="tbtn" style={{ ...ghost, padding: '2px 7px', color: '#ef4444' }} onClick={() => del(t)}>🗑</button></>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal.id ? 'แก้ไขงาน' : 'มอบหมายงาน'} onClose={() => setModal(null)} width={620}
          footer={<><button style={ghost} onClick={() => setModal(null)}>ยกเลิก</button><button style={btn()} disabled={saving} onClick={save}>{saving ? 'กำลังบันทึก…' : '💾 บันทึก'}</button></>}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'start' }}>
            <Field label="ชื่องาน *" span={2}><input style={inp} value={modal.title} onChange={e => setModal({ ...modal, title: e.target.value })} /></Field>
            <Field label="รายละเอียด" span={2}><textarea style={{ ...inp, minHeight: 56 }} value={modal.detail || ''} onChange={e => setModal({ ...modal, detail: e.target.value })} /></Field>
            <Field label="พาร์ท"><select style={inp} value={modal.part_id} onChange={e => setModal({ ...modal, part_id: e.target.value, deliverable_id: '' })}><option value="">ทั้งโปรเจค</option>{parts.map(p => <option key={p.id} value={p.id}>{p.part_no}</option>)}</select></Field>
            <Field label="เฟส"><select style={inp} value={modal.phase_code} onChange={e => setModal({ ...modal, phase_code: e.target.value })}><option value="">—</option>{tplPhases.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}</select></Field>
            <Field label="รายการเอกสารที่เกี่ยว" span={2}><select style={inp} value={modal.deliverable_id} onChange={e => { const d = partDelivs.find(x => x.id === e.target.value); setModal({ ...modal, deliverable_id: e.target.value, phase_code: d?.phase_code || modal.phase_code }); }} disabled={!modal.part_id}><option value="">{modal.part_id ? '—' : 'เลือกพาร์ทก่อน'}</option>{partDelivs.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></Field>
            <Field label="ผู้รับมอบหมาย" hint="user ระบบ = แจ้งเตือนเข้ากระดิ่ง · พิมพ์ชื่อเองก็ได้">
              <SearchSelect value={modal.assignee_uid} text={modal.assignee_name} options={userOpts} allowFree placeholder="ค้นชื่อ…"
                onChange={({ id, text }) => setModal({ ...modal, assignee_uid: id || '', assignee_name: text })} />
            </Field>
            <Field label="กำหนดเสร็จ"><input type="date" style={inp} value={modal.due_date} onChange={e => setModal({ ...modal, due_date: e.target.value })} /></Field>
            <Field label="สถานะ"><MetaSelect value={modal.status} onChange={v => setModal({ ...modal, status: v })} meta={TASK_STATUS} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
