/* ═══ ➕ สร้างชุดเอกสาร PE (PFC/FMEA/CP) ใหม่จากกระบวนการมาตรฐาน — ใช้ทั้ง /pe-docs และ /npi ═══
   2026-09-15 · เลือกกระบวนการตามลำดับผลิต → ได้ OP 10,20,30… + แถว FMEA สำเนาจาก master ทันที (สิทธิ์ pe:edit)
   · Control Plan ไม่มีใน master (คนละหน่วย — จุดควบคุมขึ้นกับพาร์ท) ต้องเติมเอง/นำเข้า Excel
   · ล้มกลางทาง: ลบชุดที่เพิ่งสร้างทิ้ง (cascade) แล้วบอก — ห้ามทิ้งชุดครึ่งเดียวไว้เงียบๆ */
import { useState, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import { buildSetFromMaster } from '../utils/peMaster';
import LineSelect from './LineSelect';
import { inp, btn, ghost, Field, Pill, Modal, WarnBar } from './NpiUi';

export default function PeSetFromMasterModal({ masters, masterItems, lines, role, lineId, sections, fullName, initial = {}, onClose, onCreated }) {
  const [form, setForm] = useState({ part_no: '', part_name: '', model: '', customer: '', line_name: '', doc_no_pfc: '', doc_no_fmea: '', doc_no_cp: '', ...initial });
  const [chosen, setChosen] = useState([]);       // [{ id, op_no }]
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const active = useMemo(() => (masters || []).filter(m => m.is_active !== false), [masters]);
  const filtered = active.filter(m => !q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase()));
  const byProc = useMemo(() => { const o = {}; (masterItems || []).forEach(i => (o[i.master_process_id] ||= []).push(i)); return o; }, [masterItems]);
  const count = (id) => (byProc[id] || []).filter(i => i.is_active !== false).length;

  const add = (m) => setChosen(c => c.some(x => x.id === m.id) ? c : [...c, { id: m.id, op_no: String((c.length + 1) * 10) }]);
  const move = (i, d) => setChosen(c => { const n = [...c]; const j = i + d; if (j < 0 || j >= n.length) return c; [n[i], n[j]] = [n[j], n[i]]; return n; });

  const create = async () => {
    if (!form.part_no?.trim()) return toast.error('กรอก Part No.');
    if (!chosen.length) return toast.error('เลือกกระบวนการอย่างน้อย 1');
    setSaving(true);
    const { data: set, error: e1 } = await supabase.from('pe_doc_sets').insert({
      part_no: form.part_no.trim(), part_name: form.part_name?.trim() || null, model: form.model?.trim() || null, customer: form.customer?.trim() || null,
      line_name: form.line_name || null, doc_no_pfc: form.doc_no_pfc?.trim() || null, doc_no_fmea: form.doc_no_fmea?.trim() || null, doc_no_cp: form.doc_no_cp?.trim() || null,
      status: 'active', remark: `สร้างจากคลัง PFMEA กลาง ${chosen.length} กระบวนการ`, created_by_name: fullName || null,
    }).select().single();
    if (e1) { setSaving(false); return toast.error(`สร้างชุดไม่สำเร็จ: ${e1.message}`); }
    const selected = chosen.map(c => ({ ...active.find(m => m.id === c.id), op_no: c.op_no, line_name: form.line_name || null }));
    const { procs, items } = buildSetFromMaster(selected, byProc, { setId: set.id });
    const { data: pRows, error: e2 } = await supabase.from('pe_processes').insert(procs.map(({ _key, ...p }) => p)).select('id, master_process_id'); // eslint-disable-line no-unused-vars
    let e3 = null;
    if (!e2 && items.length) {
      const pidByMaster = Object.fromEntries((pRows || []).map(p => [p.master_process_id, p.id]));
      const rows = items.map(({ _procKey, ...r }) => ({ ...r, process_id: pidByMaster[_procKey] })).filter(r => r.process_id);
      ({ error: e3 } = await supabase.from('pe_fmea_items').insert(rows));
    }
    if (e2 || e3) {
      await supabase.from('pe_doc_sets').delete().eq('id', set.id);   // ห้ามทิ้งชุดครึ่งเดียว
      setSaving(false);
      return toast.error(`สร้าง OP/FMEA ไม่สำเร็จ (ยกเลิกชุดแล้ว): ${(e2 || e3).message}`);
    }
    setSaving(false);
    toast.success(`สร้างชุด ${set.part_no}: ${procs.length} OP · ${items.length} failure mode`);
    onCreated?.(set); onClose();
  };

  return (
    <Modal title="➕ สร้างชุด PFC/FMEA/CP จากคลัง PFMEA กลาง" onClose={onClose} width={860}
      footer={<><button style={ghost} onClick={onClose}>ยกเลิก</button><button style={btn()} disabled={saving} onClick={create}>{saving ? 'กำลังสร้าง…' : `💾 สร้างชุด (${chosen.length} OP)`}</button></>}>
      {!active.length && <WarnBar color="#f59e0b">คลังยังว่าง — apply migration 20260915_pe_fmea_master_main หรือเพิ่มกระบวนการที่แท็บ 📚 คลัง PFMEA ก่อน</WarnBar>}
      <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, alignItems: 'start', marginBottom: 12 }}>
        <Field label="Part No. *"><input style={{ ...inp, fontFamily: 'monospace' }} value={form.part_no} onChange={e => setForm({ ...form, part_no: e.target.value })} placeholder="MB3B-16E060-CH" /></Field>
        <Field label="ชื่อพาร์ท" span={2}><input style={inp} value={form.part_name} onChange={e => setForm({ ...form, part_name: e.target.value })} /></Field>
        <Field label="Model"><input style={inp} value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} /></Field>
        <Field label="ลูกค้า"><input style={inp} value={form.customer} onChange={e => setForm({ ...form, customer: e.target.value })} /></Field>
        <Field label="ไลน์"><LineSelect lines={lines || []} value={form.line_name} onChange={v => setForm({ ...form, line_name: v })} role={role} lineId={lineId} sections={sections} style={inp} placeholder="— ยังไม่กำหนด —" /></Field>
        <Field label="Doc No. PFC"><input style={inp} value={form.doc_no_pfc} onChange={e => setForm({ ...form, doc_no_pfc: e.target.value })} /></Field>
        <Field label="Doc No. FMEA"><input style={inp} value={form.doc_no_fmea} onChange={e => setForm({ ...form, doc_no_fmea: e.target.value })} /></Field>
        <Field label="Doc No. CP"><input style={inp} value={form.doc_no_cp} onChange={e => setForm({ ...form, doc_no_cp: e.target.value })} /></Field>
      </div>
      <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 4 }}>คลังกระบวนการ ({filtered.length})</div>
          <input style={{ ...inp, marginBottom: 6 }} placeholder="ค้น…" value={q} onChange={e => setQ(e.target.value)} />
          <div style={{ maxHeight: '38vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {filtered.map(m => (
              <button key={m.id} onClick={() => add(m)} disabled={chosen.some(c => c.id === m.id)} style={{ ...ghost, textAlign: 'left', display: 'flex', gap: 6, alignItems: 'center', opacity: chosen.some(c => c.id === m.id) ? 0.45 : 1 }}>
                <span style={{ flex: 1 }}>{m.name}</span>{!m.confirmed_at && <Pill label="รอยืนยัน" color="#f59e0b" small />}<span style={{ fontSize: 11, color: 'var(--muted)' }}>{count(m.id)} FM</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 4 }}>ลำดับ OP ของพาร์ทใหม่ ({chosen.length})</div>
          {!chosen.length && <div style={{ fontSize: 12, color: 'var(--muted)' }}>กดกระบวนการทางซ้ายตามลำดับผลิต</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {chosen.map((c, i) => {
              const m = active.find(x => x.id === c.id);
              return (
                <div key={c.id} style={{ display: 'flex', gap: 6, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px' }}>
                  <input style={{ ...inp, width: 64, padding: '3px 6px', fontFamily: 'monospace' }} value={c.op_no} onChange={e => setChosen(cs => cs.map(x => x.id === c.id ? { ...x, op_no: e.target.value } : x))} />
                  <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700 }}>{m?.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{count(c.id)} FM</span>
                  <button className="tbtn" style={{ ...ghost, padding: '2px 6px' }} onClick={() => move(i, -1)}>↑</button>
                  <button className="tbtn" style={{ ...ghost, padding: '2px 6px' }} onClick={() => move(i, 1)}>↓</button>
                  <button className="tbtn" style={{ ...ghost, padding: '2px 6px', color: '#ef4444' }} onClick={() => setChosen(cs => cs.filter(x => x.id !== c.id))}>✕</button>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>ได้ PFC (รายการ OP) + PFMEA สำเนาจาก master · Control Plan ต้องเติมเองหรือนำเข้า Excel (จุดควบคุมขึ้นกับพาร์ท)</div>
        </div>
      </div>
    </Modal>
  );
}
