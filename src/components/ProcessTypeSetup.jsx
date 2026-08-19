import { useState, useEffect } from 'react';
import { supabaseDR } from '../supabaseClient';
import { can } from '../utils/permissions';
import { loadProcessTypes } from '../utils/processTypes';
import { toast } from './Toast';
import EmojiPicker from './EmojiPicker';
import { pickUnusedColor } from '../utils/colorPick';

/* ── ProcessTypeSetup — ตัวจัดการ master กระบวนการผลิต (process_types, DR) ─────────────
   component เดียว ใช้ได้หลายจุด (Daily Report ⚙️ + หน้า /process-setup ในหมวดตั้งค่าฯ)
   process_type เป็น master กลาง — แก้ที่นี่แล้วทุกจุดที่ tag เครื่อง/สินค้า/ประเภท DT ใช้ทันที
   (ห้าม hardcode รายชื่อกระบวนการที่อื่น อ่านผ่าน src/utils/processTypes.js เสมอ)
*/
const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
};
const saveBtnStyle = { background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const cancelBtnStyle = { background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' };
const Field = ({ label, children }) => (
  <div>
    <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>{label}</label>
    {children}
  </div>
);

export default function ProcessTypeSetup({ role }) {
  const canEdit = can('daily_report', 'setup', role);
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null); // 'new' | key
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => setItems([...await loadProcessTypes(true)]);
  useEffect(() => { load(); }, []);

  const slug = (t) => String(t || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const openEdit = (item) => {
    setEditing(item ? item.key : 'new');
    // สร้างใหม่ default สีที่ยังไม่ซ้ำกับกระบวนการที่มี (ผู้ใช้เปลี่ยนทับได้)
    setForm(item ? { ...item } : { key: '', label: '', icon: '🏭', color: pickUnusedColor(items.map(i => i.color)), sort_order: items.length + 1, is_active: true });
  };
  const handleSave = async () => {
    if (!form.label?.trim()) { toast.error('กรอกชื่อกระบวนการ'); return; }
    const key = editing === 'new' ? (slug(form.key) || slug(form.label)) : form.key;
    if (!key) { toast.error('กรอก key ภาษาอังกฤษ (เช่น laser_cutting)'); return; }
    if (editing === 'new' && items.some(i => i.key === key)) { toast.error(`key "${key}" มีอยู่แล้ว`); return; }
    setSaving(true);
    const { error } = await supabaseDR.from('process_types').upsert({
      key, label: form.label.trim(), icon: form.icon || null, color: form.color || null,
      sort_order: Number(form.sort_order) || 0, is_active: !!form.is_active,
    }, { onConflict: 'key' });
    setSaving(false);
    if (error) { toast.error('บันทึกไม่สำเร็จ: ' + error.message + ' (ยัง apply migration process_types ไม่ครบ?)'); return; }
    toast.success('บันทึกกระบวนการแล้ว — มีผลทุกจุดที่ใช้ทันที');
    setEditing(null); load();
  };
  const handleDelete = async (it) => {
    if (!window.confirm(`ลบกระบวนการ "${it.label}"?\nเครื่องจักร/สินค้า/ประเภทที่ tag ค่านี้ไว้จะกลายเป็น "ยังไม่กำหนด" — แนะนำใช้ปิดใช้งานแทนถ้าเคยมีข้อมูล`)) return;
    const { error } = await supabaseDR.from('process_types').delete().eq('key', it.key);
    if (error) { toast.error(error.message); return; }
    toast.success('ลบแล้ว'); load();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>{items.length} กระบวนการ</div>
        {canEdit && <button onClick={() => openEdit()} style={saveBtnStyle}>+ เพิ่มกระบวนการ</button>}
      </div>
      <div style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#a78bfa' }}>
        🏭 กระบวนการที่ตั้งไว้ที่นี่ถูกใช้ร่วมกันทั้งระบบ: tag เครื่องจักร (ตั้งค่าผังไลน์) · สินค้า (Product Master) ·
        ประเภท Downtime/งานเสีย/นโยบายพัก — ไลน์เห็นประเภทตามกระบวนการของเครื่อง/สินค้าที่มีจริงในไลน์
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map(it => (
          <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 9, opacity: it.is_active !== false ? 1 : 0.45 }}>
            <span style={{ fontSize: 20 }}>{it.icon || '🏭'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: it.color || 'var(--text)' }}>{it.label}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8, fontFamily: 'monospace' }}>{it.key}</span>
              {it.is_active === false && <span style={{ fontSize: 11, color: '#ef4444', marginLeft: 8 }}>ปิดใช้งาน</span>}
            </div>
            {canEdit && <>
              <button onClick={() => openEdit(it)} className="tbtn" style={{ ...cancelBtnStyle, padding: '5px 12px' }}>✏️</button>
              <button onClick={() => handleDelete(it)} className="tbtn" style={{ ...cancelBtnStyle, padding: '5px 12px', color: '#ef4444' }}>🗑</button>
            </>}
          </div>
        ))}
      </div>

      {editing && form && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, width: 'min(96vw, 560px)' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 12 }}>{editing === 'new' ? '➕ เพิ่มกระบวนการ' : `✏️ แก้ไข ${form.label}`}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                <Field label="ชื่อกระบวนการ *">
                  <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="เช่น Laser Cutting" style={inputStyle} />
                </Field>
                <Field label="ไอคอน (emoji)">
                  <EmojiPicker value={form.icon || ''} onChange={v => setForm(f => ({ ...f, icon: v }))} style={inputStyle} />
                </Field>
              </div>
              <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
                <Field label={editing === 'new' ? 'key (อังกฤษ — เว้นว่าง = สร้างจากชื่อ)' : 'key (แก้ไม่ได้ — ผูกกับข้อมูลที่ tag แล้ว)'}>
                  <input value={form.key || ''} onChange={e => setForm(f => ({ ...f, key: e.target.value }))} disabled={editing !== 'new'}
                    placeholder="laser_cutting" style={{ ...inputStyle, fontFamily: 'monospace', opacity: editing !== 'new' ? 0.55 : 1 }} />
                </Field>
                <Field label="สี">
                  <input type="color" value={form.color || '#8b5cf6'} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} style={{ ...inputStyle, padding: 2, height: 36 }} />
                </Field>
                <Field label="ลำดับ">
                  <input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} style={inputStyle} />
                </Field>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text)' }}>
                <input type="checkbox" checked={form.is_active !== false} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} style={{ width: 'auto' }} />
                ใช้งานอยู่
              </label>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button onClick={() => setEditing(null)} style={cancelBtnStyle}>ยกเลิก</button>
                <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>{saving ? '⏳...' : '💾 บันทึก'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
