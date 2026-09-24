/* ═══ 📚 คลัง PFMEA กลาง — แท็บใน /pe-docs ═══
   2026-09-15 · กฎ: docs/modules/pe-core-tools.md §คลัง PFMEA
   · ดู = ทุก role · ยืนยัน/แก้ master/ตัดสินข้อเสนอ = pe:approve · (ผูก/ดึง/เสนอ อยู่ในแท็บ Flow/FMEA = pe:edit)
   · master ที่ seed ให้ = confirmed_at null → แถบเหลือง "รอ PE ยืนยันว่าเป็นกระบวนการเดียวกันจริง"
   · รับข้อเสนอ = ค่าใหม่ทับ master + version+1 (applyProposal) · พาร์ทอื่นที่ถือ version เก่าจะเห็นป้าย ⬆️ เอง */
import { useState, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import { fmtDate } from '../utils/dateFormat';
import { rpnOf, applyProposal } from '../utils/peMaster';
import { inp, card, btn, ghost, thSt, tdSt, Field, Pill, Modal, WarnBar } from './NpiUi';
import SearchInput from './SearchInput';

const KIND_LABEL = { process: 'Process', incoming_insp: 'Incoming Insp.', storage: 'Storage', transport: 'Transport', inspection: 'Inspection', rework: 'Rework', warehouse: 'Warehouse', delivery: 'Delivery' };
const rpnColor = (v) => (v == null ? 'var(--muted)' : v >= 100 ? '#ef4444' : v >= 70 ? '#f59e0b' : '#22c55e');

export default function PeMasterLibrary({ masters, masterItems, proposals, usage, sets, canApprove, fullName, onChanged, onOpenSet }) {
  const [sel, setSel] = useState('');
  const [q, setQ] = useState('');
  const [onlyUnconfirmed, setOnlyUnconfirmed] = useState(false);
  const [mpModal, setMpModal] = useState(null);
  const [itemModal, setItemModal] = useState(null);
  const [rejectModal, setRejectModal] = useState(null);
  const [saving, setSaving] = useState(false);

  const list = useMemo(() => (masters || []).filter(m => (!onlyUnconfirmed || !m.confirmed_at) && (!q.trim() || (m.name + ' ' + (m.family_tags || []).join(' ')).toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => (usage[b.id]?.sets || 0) - (usage[a.id]?.sets || 0) || a.name.localeCompare(b.name)), [masters, q, onlyUnconfirmed, usage]);
  const cur = (masters || []).find(m => m.id === sel) || null;
  const items = useMemo(() => (masterItems || []).filter(i => i.master_process_id === sel).sort((a, b) => (a.seq || 0) - (b.seq || 0)), [masterItems, sel]);
  const pending = useMemo(() => (proposals || []).filter(p => p.status === 'proposed'), [proposals]);
  const curPending = pending.filter(p => p.master_process_id === sel);
  const unconfirmed = (masters || []).filter(m => !m.confirmed_at).length;
  const itemById = useMemo(() => Object.fromEntries((masterItems || []).map(i => [i.id, i])), [masterItems]);
  const setById = useMemo(() => Object.fromEntries((sets || []).map(s => [s.id, s])), [sets]);

  const write = async (label, fn) => {
    setSaving(true); const { error } = await fn(); setSaving(false);
    if (error) { toast.error(`${label}ไม่สำเร็จ: ${error.message}`); return false; }
    toast.success(`${label}แล้ว`); onChanged(); return true;
  };
  const confirmMaster = (m) => write('ยืนยันกระบวนการ', () => supabase.from('pe_master_processes').update({ confirmed_by: fullName || 'ไม่ระบุชื่อ', confirmed_at: new Date().toISOString() }).eq('id', m.id));
  const saveMp = async () => {
    const m = mpModal; if (!m.name?.trim()) return toast.error('กรอกชื่อ');
    const row = { name: m.name.trim(), kind: m.kind, process_type: m.process_type?.trim() || null, description: m.description?.trim() || null, is_active: m.is_active !== false,
      family_tags: String(m.tags || '').split(',').map(s => s.trim()).filter(Boolean) };
    const ok = await write('บันทึกกระบวนการ', () => m.id ? supabase.from('pe_master_processes').update(row).eq('id', m.id)
      : supabase.from('pe_master_processes').insert({ ...row, key: `${row.name.toLowerCase().replace(/[^a-z0-9ก-๙]+/g, '_').replace(/^_|_$/g, '')}__${row.kind}`, confirmed_by: fullName || null, confirmed_at: new Date().toISOString(), created_by_name: fullName || null }));
    if (ok) setMpModal(null);
  };
  const saveItem = async () => {
    const it = itemModal; if (!it.failure_mode?.trim()) return toast.error('กรอก Failure Mode');
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const row = { seq: Number(it.seq) || 0, requirement: it.requirement?.trim() || null, failure_mode: it.failure_mode.trim(), effects: it.effects?.trim() || null, severity: num(it.severity), classification: it.classification || null,
      causes: it.causes?.trim() || null, prevention: it.prevention?.trim() || null, occurrence: num(it.occurrence), detection_ctrl: it.detection_ctrl?.trim() || null, detection: num(it.detection), best_practice: it.best_practice?.trim() || null, is_active: it.is_active !== false };
    const ok = await write('บันทึกรายการ', () => it.id ? supabase.from('pe_master_items').update({ ...row, version: (it.version || 1) + 1 }).eq('id', it.id)
      : supabase.from('pe_master_items').insert({ ...row, master_process_id: sel, created_by_name: fullName || null }));
    if (ok) setItemModal(null);
  };
  const delItem = (it) => { if (window.confirm(`ลบ "${it.failure_mode}" ออกจาก master? (แถวในพาร์ทที่ผูกอยู่ไม่ถูกลบ แค่หลุดจาก master)`)) write('ลบรายการ', () => supabase.from('pe_master_items').delete().eq('id', it.id)); };

  /* รับข้อเสนอ = ทับค่า master + version+1 (improve) หรือเพิ่มแถวใหม่ (new_item) แล้วปิดข้อเสนอ */
  const accept = async (p) => {
    if (!canApprove) return;
    setSaving(true);
    let err;
    if (p.kind === 'improve' && p.master_item_id) {
      const m = itemById[p.master_item_id];
      if (!m) { setSaving(false); return toast.error('ไม่พบ master item แล้ว (ถูกลบ?) — ปฏิเสธข้อเสนอนี้แทน'); }
      const next = applyProposal(m, p);
      const { id, master_process_id, created_at, created_by_name, origin_set_id, origin_item_id, updated_at, ...patch } = next; // eslint-disable-line no-unused-vars
      ({ error: err } = await supabase.from('pe_master_items').update(patch).eq('id', m.id));
    } else {
      const a = p.after || {};
      ({ error: err } = await supabase.from('pe_master_items').insert({ master_process_id: p.master_process_id, seq: items.length + 1, requirement: a.requirement || null, failure_mode: a.failure_mode, effects: a.effects || null,
        severity: a.severity ?? null, classification: a.classification || null, causes: a.causes || null, prevention: a.prevention || null, occurrence: a.occurrence ?? null, detection_ctrl: a.detection_ctrl || null, detection: a.detection ?? null,
        best_practice: a.best_practice || null, origin_set_id: p.source_set_id || null, origin_item_id: p.source_item_id || null, created_by_name: fullName || null }));
    }
    if (!err) ({ error: err } = await supabase.from('pe_master_processes').update({ version: ((masters.find(m => m.id === p.master_process_id)?.version) || 1) + 1 }).eq('id', p.master_process_id));
    if (!err) ({ error: err } = await supabase.from('pe_master_proposals').update({ status: 'accepted', decided_by: fullName || 'ไม่ระบุชื่อ', decided_at: new Date().toISOString() }).eq('id', p.id));
    setSaving(false);
    if (err) return toast.error(`รับข้อเสนอไม่สำเร็จ: ${err.message}`);
    toast.success('อัพเดท master แล้ว — พาร์ทอื่นที่ถือเวอร์ชันเก่าจะเห็นป้าย ⬆️'); onChanged();
  };
  const reject = async () => {
    const r = rejectModal; if (!r.reason?.trim()) return toast.error('กรอกเหตุผล');
    const ok = await write('ปฏิเสธข้อเสนอ', () => supabase.from('pe_master_proposals').update({ status: 'rejected', reject_reason: r.reason.trim(), decided_by: fullName || 'ไม่ระบุชื่อ', decided_at: new Date().toISOString() }).eq('id', r.id));
    if (ok) setRejectModal(null);
  };

  const ctlDiff = (p) => {
    const b = p.before || {}, a = p.after || {};
    return ['severity', 'occurrence', 'detection'].map(k => `${k[0].toUpperCase()} ${b[k] ?? '—'}→${a[k] ?? '—'}`).join(' · ');
  };

  return (
    <div>
      {unconfirmed > 0 && <WarnBar color="#f59e0b">ระบบจับกลุ่ม OP ชื่อเดียวกันข้ามพาร์ทให้ {unconfirmed} กระบวนการ ยังรอ PE ยืนยันว่าเป็นกระบวนการเดียวกันจริง — กระบวนการที่ยังไม่ยืนยันดึงไปใช้ได้แต่จะติดป้ายเตือน</WarnBar>}
      {pending.length > 0 && <WarnBar color="#a855f7">📬 มีข้อเสนออัพเดท master ค้าง {pending.length} รายการ{canApprove ? '' : ' (ต้องมี pe:approve จึงตัดสินได้)'}</WarnBar>}
      <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(0, 2fr)', gap: 12, alignItems: 'start' }}>
        {/* ── รายการกระบวนการมาตรฐาน ── */}
        <div style={card}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <SearchInput value={q} onChange={setQ} fields="กระบวนการ / tag" style={{ minWidth: 140 }} />
            <label style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}><input type="checkbox" checked={onlyUnconfirmed} onChange={e => setOnlyUnconfirmed(e.target.checked)} /> รอยืนยัน</label>
            {canApprove && <button style={btn()} onClick={() => setMpModal({ name: '', kind: 'process', process_type: '', tags: '', description: '', is_active: true })}>+ กระบวนการ</button>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{list.length} กระบวนการ · เรียงตามจำนวนพาร์ทที่ใช้</div>
          {!list.length && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>ยังไม่มีกระบวนการมาตรฐาน — apply migration 20260915_pe_fmea_master_main จะ seed จากชุดเอกสารที่มีอยู่ให้</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {list.map(m => {
              const u = usage[m.id] || { sets: 0, ops: 0 };
              const n = (masterItems || []).filter(i => i.master_process_id === m.id).length;
              const pend = pending.filter(p => p.master_process_id === m.id).length;
              return (
                <div key={m.id} onClick={() => setSel(m.id)} style={{ padding: '7px 9px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${sel === m.id ? '#4d9fff' : 'var(--border)'}`, background: sel === m.id ? 'rgba(77,159,255,0.08)' : 'var(--bg2)', opacity: m.is_active ? 1 : 0.55 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 800, fontSize: 12.5 }}>{m.name}</span>
                    <Pill label={KIND_LABEL[m.kind] || m.kind} color="#64748b" small />
                    {!m.confirmed_at && <Pill label="รอยืนยัน" color="#f59e0b" small />}
                    {pend > 0 && <Pill label={`📬 ${pend}`} color="#a855f7" small />}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>v{m.version} · {n} failure mode · ใช้ใน {u.sets} พาร์ท / {u.ops} OP{m.family_tags?.length ? ` · ${m.family_tags.join(', ')}` : ''}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── รายละเอียดกระบวนการที่เลือก ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {!cur ? <div style={{ ...card, color: 'var(--muted)', fontSize: 12.5 }}>เลือกกระบวนการทางซ้ายเพื่อดู failure mode มาตรฐาน · ข้อเสนอ · พาร์ทที่ใช้</div> : (
            <>
              <div style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 900 }}>📚 {cur.name} <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>v{cur.version} · {cur.key}</span></div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>
                      {KIND_LABEL[cur.kind]}{cur.process_type ? ` · ${cur.process_type}` : ''}{cur.family_tags?.length ? ` · ตระกูล: ${cur.family_tags.join(', ')}` : ''}
                      {cur.confirmed_at ? ` · ยืนยันโดย ${cur.confirmed_by} ${fmtDate(cur.confirmed_at)}` : ' · ⚠️ ยังไม่ยืนยัน'}
                    </div>
                    {cur.description && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{cur.description}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {canApprove && !cur.confirmed_at && <button style={btn('#22c55e')} disabled={saving} onClick={() => confirmMaster(cur)}>✅ ยืนยันกระบวนการนี้</button>}
                    {canApprove && <button style={ghost} onClick={() => setMpModal({ ...cur, tags: (cur.family_tags || []).join(', '), process_type: cur.process_type || '', description: cur.description || '' })}>✏️</button>}
                  </div>
                </div>
                {/* พาร์ทที่ใช้ */}
                <div style={{ marginTop: 8, fontSize: 11.5, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ color: 'var(--muted)' }}>ใช้ใน:</span>
                  {(usage[cur.id]?.setIds || []).map(sid => <button key={sid} style={{ ...ghost, padding: '2px 8px', fontSize: 11 }} onClick={() => onOpenSet?.(sid)}>{setById[sid]?.part_no || sid.slice(0, 8)}</button>)}
                  {!(usage[cur.id]?.setIds || []).length && <span style={{ color: 'var(--muted)' }}>ยังไม่มีพาร์ทผูก</span>}
                </div>
              </div>

              {curPending.length > 0 && (
                <div style={{ ...card, borderColor: '#a855f766' }}>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>📬 ข้อเสนออัพเดท master ({curPending.length})</div>
                  {curPending.map(p => (
                    <div key={p.id} style={{ borderTop: '1px solid var(--border)', padding: '8px 0', display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 240 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Pill label={p.kind === 'improve' ? 'ปรับปรุง' : 'รายการใหม่'} color={p.kind === 'improve' ? '#a855f7' : '#3b82f6'} small />
                          <b style={{ fontSize: 12.5 }}>{p.kind === 'improve' ? (itemById[p.master_item_id]?.failure_mode || '(master item หาย)') : p.after?.failure_mode}</b>
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>จาก {setById[p.source_set_id]?.part_no || '—'} · {fmtDate(p.created_at)} · {p.created_by_name || 'ระบบ'}</span>
                        </div>
                        <div style={{ fontSize: 12, marginTop: 3 }}>
                          RPN <b style={{ color: rpnColor(p.rpn_before) }}>{p.rpn_before ?? '—'}</b> → <b style={{ color: rpnColor(p.rpn_after) }}>{p.rpn_after ?? '—'}</b>
                          {p.kind === 'improve' && <span style={{ color: 'var(--muted)' }}> · {ctlDiff(p)}</span>}
                        </div>
                        {p.after?.best_practice && <div style={{ fontSize: 11.5, color: '#22c55e', marginTop: 2 }}>✔ {p.after.best_practice}</div>}
                        {p.after?.prevention && p.before?.prevention !== p.after?.prevention && <div style={{ fontSize: 11, color: 'var(--text2)' }}>Prevention: {p.after.prevention}</div>}
                        {p.after?.detection_ctrl && p.before?.detection_ctrl !== p.after?.detection_ctrl && <div style={{ fontSize: 11, color: 'var(--text2)' }}>Detection: {p.after.detection_ctrl}</div>}
                        {p.note && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.note}</div>}
                      </div>
                      {canApprove && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <button style={btn('#22c55e')} disabled={saving} onClick={() => accept(p)}>✅ รับเข้า master</button>
                          <button style={ghost} onClick={() => setRejectModal({ id: p.id, reason: '' })}>ไม่รับ</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>Failure mode มาตรฐาน ({items.length})</div>
                  {canApprove && <button style={ghost} onClick={() => setItemModal({ seq: items.length + 1, failure_mode: '', requirement: '', effects: '', severity: '', classification: '', causes: '', prevention: '', occurrence: '', detection_ctrl: '', detection: '', best_practice: '', is_active: true })}>+ รายการ</button>}
                </div>
                {!items.length && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>ยังไม่มี — เพิ่มเอง หรือรอข้อเสนอจากพาร์ท</div>}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thSt}>#</th><th style={thSt}>Failure mode / Effects</th><th style={thSt}>Causes · Controls</th><th style={{ ...thSt, textAlign: 'center' }}>S·O·D</th><th style={{ ...thSt, textAlign: 'right' }}>RPN</th><th style={thSt}>v</th><th style={thSt}>ที่มา</th><th style={thSt}></th></tr></thead>
                    <tbody>{items.map(it => (
                      <tr key={it.id} style={{ opacity: it.is_active === false ? 0.5 : 1 }}>
                        <td style={tdSt}>{it.seq}</td>
                        <td style={{ ...tdSt, minWidth: 180 }}><b style={{ color: 'var(--text)' }}>{it.failure_mode}</b>{it.classification && <Pill label={it.classification} color={it.classification === 'CC' ? '#ef4444' : '#f59e0b'} small />}{it.effects && <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>{it.effects}</div>}</td>
                        <td style={{ ...tdSt, minWidth: 200, fontSize: 11.5 }}>{it.causes && <div>⚠ {it.causes}</div>}{it.prevention && <div>🛡 {it.prevention}</div>}{it.detection_ctrl && <div>🔍 {it.detection_ctrl}</div>}{it.best_practice && <div style={{ color: '#22c55e' }}>✔ {it.best_practice}</div>}</td>
                        <td style={{ ...tdSt, textAlign: 'center', whiteSpace: 'nowrap' }}>{it.severity ?? '—'}·{it.occurrence ?? '—'}·{it.detection ?? '—'}</td>
                        <td style={{ ...tdSt, textAlign: 'right', fontWeight: 800, color: rpnColor(rpnOf(it)) }}>{rpnOf(it) ?? '—'}</td>
                        <td style={tdSt}>v{it.version}</td>
                        <td style={{ ...tdSt, fontSize: 11 }}>{it.origin_set_id ? (setById[it.origin_set_id]?.part_no || '—') : '—'}</td>
                        <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>{canApprove && <><button className="tbtn" style={{ ...ghost, padding: '2px 7px' }} onClick={() => setItemModal({ ...it, severity: it.severity ?? '', occurrence: it.occurrence ?? '', detection: it.detection ?? '' })}>✏️</button> <button className="tbtn" style={{ ...ghost, padding: '2px 7px', color: '#ef4444' }} onClick={() => delItem(it)}>🗑</button></>}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {mpModal && (
        <Modal title={mpModal.id ? 'แก้กระบวนการมาตรฐาน' : 'เพิ่มกระบวนการมาตรฐาน'} onClose={() => setMpModal(null)} width={560}
          footer={<><button style={ghost} onClick={() => setMpModal(null)}>ยกเลิก</button><button style={btn()} disabled={saving} onClick={saveMp}>💾 บันทึก</button></>}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'start' }}>
            <Field label="ชื่อกระบวนการ *" span={2}><input style={inp} value={mpModal.name} onChange={e => setMpModal({ ...mpModal, name: e.target.value })} placeholder="PROJECTION WELD NUT" /></Field>
            <Field label="ชนิด"><select style={inp} value={mpModal.kind} onChange={e => setMpModal({ ...mpModal, kind: e.target.value })} disabled={!!mpModal.id}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="process_type (DR)" hint="key ของ process_types"><input style={inp} value={mpModal.process_type} onChange={e => setMpModal({ ...mpModal, process_type: e.target.value })} placeholder="welding / stamping" /></Field>
            <Field label="ตระกูลพาร์ท (คั่นด้วย ,)" span={2}><input style={inp} value={mpModal.tags} onChange={e => setMpModal({ ...mpModal, tags: e.target.value })} placeholder="fender_inner, rad_support" /></Field>
            <Field label="คำอธิบาย" span={2}><textarea style={{ ...inp, minHeight: 50 }} value={mpModal.description} onChange={e => setMpModal({ ...mpModal, description: e.target.value })} /></Field>
            <label style={{ fontSize: 12.5 }}><input type="checkbox" checked={mpModal.is_active !== false} onChange={e => setMpModal({ ...mpModal, is_active: e.target.checked })} /> ใช้งาน</label>
          </div>
        </Modal>
      )}
      {itemModal && (
        <Modal title={itemModal.id ? `แก้ master: ${itemModal.failure_mode}` : 'เพิ่ม failure mode มาตรฐาน'} onClose={() => setItemModal(null)} width={760}
          footer={<><button style={ghost} onClick={() => setItemModal(null)}>ยกเลิก</button><button style={btn()} disabled={saving} onClick={saveItem}>💾 บันทึก{itemModal.id ? ` (→ v${(itemModal.version || 1) + 1})` : ''}</button></>}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, alignItems: 'start' }}>
            <Field label="ลำดับ"><input type="number" style={inp} value={itemModal.seq} onChange={e => setItemModal({ ...itemModal, seq: e.target.value })} /></Field>
            <Field label="Failure mode *" span={2}><input style={inp} value={itemModal.failure_mode} onChange={e => setItemModal({ ...itemModal, failure_mode: e.target.value })} /></Field>
            <Field label="Requirement" span={3}><input style={inp} value={itemModal.requirement || ''} onChange={e => setItemModal({ ...itemModal, requirement: e.target.value })} /></Field>
            <Field label="Effects" span={2}><textarea style={{ ...inp, minHeight: 48 }} value={itemModal.effects || ''} onChange={e => setItemModal({ ...itemModal, effects: e.target.value })} /></Field>
            <Field label="S (1-10)"><input type="number" min={1} max={10} style={inp} value={itemModal.severity} onChange={e => setItemModal({ ...itemModal, severity: e.target.value })} /></Field>
            <Field label="Causes" span={2}><textarea style={{ ...inp, minHeight: 48 }} value={itemModal.causes || ''} onChange={e => setItemModal({ ...itemModal, causes: e.target.value })} /></Field>
            <Field label="O (1-10)"><input type="number" min={1} max={10} style={inp} value={itemModal.occurrence} onChange={e => setItemModal({ ...itemModal, occurrence: e.target.value })} /></Field>
            <Field label="Prevention control" span={2}><textarea style={{ ...inp, minHeight: 48 }} value={itemModal.prevention || ''} onChange={e => setItemModal({ ...itemModal, prevention: e.target.value })} /></Field>
            <Field label="Class"><select style={inp} value={itemModal.classification || ''} onChange={e => setItemModal({ ...itemModal, classification: e.target.value })}><option value="">—</option><option value="CC">CC</option><option value="SC">SC</option></select></Field>
            <Field label="Detection control" span={2}><textarea style={{ ...inp, minHeight: 48 }} value={itemModal.detection_ctrl || ''} onChange={e => setItemModal({ ...itemModal, detection_ctrl: e.target.value })} /></Field>
            <Field label="D (1-10)"><input type="number" min={1} max={10} style={inp} value={itemModal.detection} onChange={e => setItemModal({ ...itemModal, detection: e.target.value })} /></Field>
            <Field label="Best practice (สิ่งที่ทำแล้วดีขึ้น)" span={3}><input style={inp} value={itemModal.best_practice || ''} onChange={e => setItemModal({ ...itemModal, best_practice: e.target.value })} /></Field>
            <label style={{ fontSize: 12.5 }}><input type="checkbox" checked={itemModal.is_active !== false} onChange={e => setItemModal({ ...itemModal, is_active: e.target.checked })} /> ใช้งาน</label>
          </div>
        </Modal>
      )}
      {rejectModal && (
        <Modal title="ไม่รับข้อเสนอ" onClose={() => setRejectModal(null)} width={480}
          footer={<><button style={ghost} onClick={() => setRejectModal(null)}>ยกเลิก</button><button style={btn('#ef4444', '#fff')} disabled={saving} onClick={reject}>ปฏิเสธ</button></>}>
          <Field label="เหตุผล * (auditor ถามว่าทำไมไม่รับ)"><textarea style={{ ...inp, minHeight: 60 }} value={rejectModal.reason} onChange={e => setRejectModal({ ...rejectModal, reason: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}
