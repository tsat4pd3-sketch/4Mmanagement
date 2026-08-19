import { useState, useEffect } from 'react';
import { toast } from './Toast';
import { DIE_STATUSES, dieStatusMeta, saveDieStatus, MIGRATION_HINT } from '../utils/dieStatus';

/* ═══ DieStatusEditor — ตัวเปลี่ยนสถานะแม่พิมพ์ (ใช้ร่วมแท็บ 🗺️ ผังจัดเก็บ + 📊 สถานะ) ═══
   สถานะ manual เท่านั้น — สถานะ "มีใบซ่อมค้าง" derive จาก MO เสมอ ไม่ให้คนตั้งเองที่นี่
   (die = แถว machines พร้อม .ext) · เขียนสำเร็จแล้วเรียก onSaved(patch) ให้หน้าแม่ update state */
export default function DieStatusEditor({ die, canEdit, fullName, ready, onSaved, compact = false }) {
  const ext = die?.ext || {};
  const [status, setStatus] = useState(ext.die_status || '');
  const [note, setNote] = useState(ext.status_note || '');
  const [saving, setSaving] = useState(false);
  // เปลี่ยนแม่พิมพ์ที่เลือก → รีเซ็ตฟอร์มตามตัวใหม่ (ไม่งั้นค้างค่าของตัวก่อน)
  useEffect(() => { setStatus(ext.die_status || ''); setNote(ext.status_note || ''); }, [die?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const meta = dieStatusMeta(ext.die_status);
  const dirty = (status || '') !== (ext.die_status || '') || (note || '') !== (ext.status_note || '');

  const save = async () => {
    setSaving(true);
    const { error } = await saveDieStatus({ machineId: die.id, status, note, byName: fullName });
    setSaving(false);
    if (error) {
      // 42703/42P01 = migration ยังไม่ apply — ต้องบอกให้ชัด ห้ามเงียบ
      const miss = error.code === '42703' || error.code === '42P01';
      return toast.error(miss ? MIGRATION_HINT : 'บันทึกสถานะไม่สำเร็จ: ' + error.message);
    }
    toast.success('บันทึกสถานะแม่พิมพ์แล้ว');
    onSaved?.({
      die_status: status || null, status_note: note?.trim() || null,
      status_updated_at: new Date().toISOString(), status_updated_by_name: fullName || null,
    });
  };

  const inp = {
    width: '100%', padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--bg)', color: 'var(--text)', fontSize: 12.5, boxSizing: 'border-box',
  };

  if (!canEdit || !ready) {
    return (
      <div style={{ display: 'grid', gap: 4 }}>
        <span style={{
          alignSelf: 'start', justifySelf: 'start', fontSize: 12, fontWeight: 700, padding: '3px 10px',
          borderRadius: 999, color: meta.color, background: meta.bg, border: `1px solid ${meta.color}`,
        }}>{meta.icon} {meta.label}</span>
        {ext.status_note && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>📝 {ext.status_note}</div>}
        {ext.status_updated_at && (
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            อัพเดท {new Date(ext.status_updated_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
            {ext.status_updated_by_name ? ` · ${ext.status_updated_by_name}` : ''}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...inp, borderColor: dieStatusMeta(status || null).color }}>
        <option value="">❔ ยังไม่ระบุสถานะ</option>
        {DIE_STATUSES.map(s => <option key={s.key} value={s.key}>{s.icon} {s.label}</option>)}
      </select>
      {!compact && (
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{dieStatusMeta(status || null).desc}</div>
      )}
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="หมายเหตุ (เช่น ซ่อมคมตัด OP20 / ส่งบริษัท xxx)" style={inp} />
      {ext.status_updated_at && (
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          ล่าสุด {new Date(ext.status_updated_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
          {ext.status_updated_by_name ? ` · ${ext.status_updated_by_name}` : ''}
        </div>
      )}
      {dirty && (
        <button onClick={save} disabled={saving} style={{
          background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8,
          padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', justifySelf: 'start',
          opacity: saving ? 0.6 : 1,
        }}>{saving ? 'กำลังบันทึก…' : '💾 บันทึกสถานะ'}</button>
      )}
    </div>
  );
}
