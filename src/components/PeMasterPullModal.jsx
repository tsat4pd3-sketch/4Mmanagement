/* ═══ 📚 ดึง failure mode จาก master เข้า OP ของพาร์ท (สำเนา + ถือ master_item_id/version) ═══
   2026-09-15 · ข้าม failure mode ที่ OP มีอยู่แล้ว (pullRows) · ต้องดูรายการก่อนยืนยันเสมอ · สิทธิ์ pe:edit */
import { useState, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import { pullRows, rpnOf } from '../utils/peMaster';
import { inp, btn, ghost, Pill, Modal, WarnBar } from './NpiUi';

export default function PeMasterPullModal({ procs, fmea, masters, masterItems, initialProcId, onClose, onDone }) {
  const linked = useMemo(() => (procs || []).filter(p => p.master_process_id), [procs]);
  const [procId, setProcId] = useState(initialProcId && linked.some(p => p.id === initialProcId) ? initialProcId : (linked[0]?.id || ''));
  const proc = linked.find(p => p.id === procId) || null;
  const master = (masters || []).find(m => m.id === proc?.master_process_id) || null;
  const { rows, skipped } = useMemo(() => proc ? pullRows((masterItems || []).filter(i => i.master_process_id === proc.master_process_id), proc.id, (fmea || []).filter(f => f.process_id === proc.id)) : { rows: [], skipped: 0 }, [proc, masterItems, fmea]);
  const [picked, setPicked] = useState(null);   // null = ทั้งหมด
  const [saving, setSaving] = useState(false);
  const chosen = rows.filter(r => !picked || picked.has(r.master_item_id));

  const run = async () => {
    if (!chosen.length) return;
    setSaving(true);
    const { error } = await supabase.from('pe_fmea_items').insert(chosen);
    setSaving(false);
    if (error) return toast.error(`ดึงไม่สำเร็จ: ${error.message}`);
    toast.success(`เพิ่ม ${chosen.length} failure mode จาก master เข้า OP ${proc.op_no} แล้ว`);
    onDone?.(); onClose();
  };

  return (
    <Modal title="📚 เติม failure mode จาก master" onClose={onClose} width={760}
      footer={<><button style={ghost} onClick={onClose}>ยกเลิก</button><button style={btn()} disabled={saving || !chosen.length} onClick={run}>{saving ? 'กำลังเพิ่ม…' : `➕ เพิ่ม ${chosen.length} รายการ`}</button></>}>
      {!linked.length ? <WarnBar color="#f59e0b">ยังไม่มี OP ไหนผูกกระบวนการมาตรฐาน — ไปที่แท็บ Flow → ✏️ OP → เลือก "กระบวนการมาตรฐาน" ก่อน</WarnBar> : (
        <>
          <select style={{ ...inp, marginBottom: 8 }} value={procId} onChange={e => { setProcId(e.target.value); setPicked(null); }}>
            {linked.map(p => <option key={p.id} value={p.id}>OP {p.op_no} · {p.name} → 📚 {(masters || []).find(m => m.id === p.master_process_id)?.name || '?'}</option>)}
          </select>
          {master && !master.confirmed_at && <WarnBar color="#f59e0b">กระบวนการมาตรฐานนี้ยังไม่ผ่านการยืนยันจาก PE (seed จากชื่อ OP) — ดึงได้ แต่ควรตรวจว่าใช่กระบวนการเดียวกันจริง</WarnBar>}
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>
            ดึงได้ {rows.length} รายการ{skipped ? ` · ข้าม ${skipped} ที่ OP นี้มี failure mode เดียวกันอยู่แล้ว` : ''} · ค่า S/O/D และ controls จะเป็นค่าตั้งต้น แก้ในพาร์ทได้อิสระ
          </div>
          {!rows.length && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>ไม่มีรายการใหม่ให้ดึง</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: '50vh', overflowY: 'auto' }}>
            {rows.map(r => {
              const on = !picked || picked.has(r.master_item_id);
              return (
                <label key={r.master_item_id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 8, background: on ? 'var(--bg2)' : 'transparent', cursor: 'pointer' }}>
                  <input type="checkbox" checked={on} onChange={e => setPicked(prev => { const n = new Set(prev || rows.map(x => x.master_item_id)); e.target.checked ? n.add(r.master_item_id) : n.delete(r.master_item_id); return n; })} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <b style={{ fontSize: 12.5 }}>{r.failure_mode}</b>{r.classification && <Pill label={r.classification} color={r.classification === 'CC' ? '#ef4444' : '#f59e0b'} small />}
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>S{r.severity ?? '—'}·O{r.occurrence ?? '—'}·D{r.detection ?? '—'} · RPN {rpnOf(r) ?? '—'} · v{r.master_version}</span>
                    </div>
                    {(r.prevention || r.detection_ctrl) && <div style={{ fontSize: 11, color: 'var(--text2)' }}>{r.prevention ? `🛡 ${r.prevention} ` : ''}{r.detection_ctrl ? `🔍 ${r.detection_ctrl}` : ''}</div>}
                    {r.recommended_action && <div style={{ fontSize: 11, color: '#22c55e' }}>✔ best practice: {r.recommended_action}</div>}
                  </div>
                </label>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}
