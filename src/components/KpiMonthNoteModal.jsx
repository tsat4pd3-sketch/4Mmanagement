/* ══ 📝 หมายเหตุรายเดือนบนแผ่น KPI — remark / action / note (2026-09-30 · คำสั่ง user) ═══════════
   *"กราฟแท่งแต่ละเดือน แต่ละแท่งสามารถคลิกใส่ remark, action, noted เพื่อไว้กดเปิดดูเวลานำเสนอได้ว่าเกิดอะไรขึ้น"*
   · เปิดจากการกดแท่งเดือนบนบอร์ด KPI (ทั้งโหมดปกติ/โหมดจอ TV) · ตาราง `kpi_month_notes` (MAIN)
   · คีย์ = ปี+เดือน+ขอบเขตที่ดู+แผ่น (`row_key`) — โน้ตของ PD4 ไม่ปนกับ PD3 · ลบ = soft (`is_active=false`)
   · เขียนได้เมื่อ `can('kpi','manage')` (คีย์เดียวกับ RLS) · อ่านได้ทุกคน — จอนำเสนอกดดูอย่างเดียว
   · ทุก write ผ่าน checkWrite + นับแถว (กฎเหล็ก DB ข้อ 1-2) */
import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { checkWrite } from '../utils/dbWrite';
import { toast } from './Toast';
import { DeleteButton } from './IconButton';

export const NOTE_KINDS = [
  { key: 'remark', icon: '💬', label: 'Remark',  hint: 'เกิดอะไรขึ้นเดือนนี้' },
  { key: 'action', icon: '🛠', label: 'Action',  hint: 'ทำอะไรไปแล้ว / จะทำอะไร' },
  { key: 'note',   icon: '📌', label: 'Note',    hint: 'ข้อสังเกตอื่นๆ' },
];
export const noteKindMeta = (k) => NOTE_KINDS.find(x => x.key === k) || NOTE_KINDS[0];

const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export default function KpiMonthNoteModal({ title, icon, monthText, valueText, notes = [], canEdit, ctx, onClose, onChanged }) {
  const [kind, setKind] = useState('remark');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const t = text.trim();
    if (!t) { toast.error('พิมพ์ข้อความก่อนบันทึก'); return; }
    setBusy(true);
    const res = await supabase.from('kpi_month_notes').insert({
      year: ctx.year, month: ctx.month, scope_kind: ctx.scopeKind, scope_value: ctx.scopeValue || '',
      row_key: ctx.rowKey, kind, text: t, created_by_name: ctx.fullName || null,
    }).select('id');
    setBusy(false);
    if (!checkWrite(res, 'บันทึกหมายเหตุ')) return;
    if (!res.data?.length) { toast.error('บันทึกหมายเหตุไม่สำเร็จ — ไม่มีสิทธิ์ (ต้องมี kpi:manage)'); return; }
    setText('');
    toast.success('บันทึกหมายเหตุแล้ว');
    onChanged?.();
  };
  const remove = async (n) => {
    if (!window.confirm(`ลบหมายเหตุนี้?\n"${n.text.slice(0, 80)}"`)) return;
    const res = await supabase.from('kpi_month_notes').update({ is_active: false }).eq('id', n.id).select('id');
    if (!checkWrite(res, 'ลบหมายเหตุ')) return;
    if (!res.data?.length) { toast.error('ลบไม่สำเร็จ — ไม่มีสิทธิ์ (ต้องมี kpi:manage)'); return; }
    onChanged?.();
  };

  const box = { background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 10, width: 'min(560px, 100%)', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', maxHeight: '90vh' };
  const chip = (active, color) => ({ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${active ? color : 'var(--border2)'}`, background: active ? `${color}22` : 'var(--bg3)', color: active ? color : 'var(--text2)' });
  return (
    <div className="modal-scroll" /* ปิดจาก backdrop ได้เฉพาะตอนยังไม่พิมพ์อะไร (UI-CONVENTIONS §5) */
      onClick={() => { if (!text.trim()) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
      <div style={box} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{icon} {title} · {monthText}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>ค่าเดือนนี้ {valueText || '—'} · หมายเหตุ {notes.length} รายการ · ขอบเขต {ctx.scopeText}</div>
          </div>
          <button onClick={onClose} style={{ cursor: 'pointer', background: 'none', border: 'none', fontSize: 18, color: 'var(--muted)' }} title="ปิด">✕</button>
        </div>
        <div style={{ padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 }}>
          {notes.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '18px 8px' }}>
              ยังไม่มีหมายเหตุของเดือนนี้{canEdit ? ' — พิมพ์ด้านล่างเพื่อบันทึกว่าเกิดอะไรขึ้น / ทำอะไรไปแล้ว' : ''}
            </div>
          )}
          {notes.map((n) => {
            const m = noteKindMeta(n.kind);
            return (
              <div key={n.id} style={{ display: 'flex', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--bg3)', borderLeft: `3px solid ${n.kind === 'action' ? '#f59e0b' : n.kind === 'note' ? '#38bdf8' : '#a78bfa'}` }}>
                <div style={{ fontSize: 16, lineHeight: 1 }} title={m.label}>{m.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{n.text}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{m.label} · {n.created_by_name || 'ไม่ระบุผู้บันทึก'} · {fmtWhen(n.created_at)}</div>
                </div>
                {canEdit && <DeleteButton onClick={() => remove(n)} title="ลบ" />}
              </div>
            );
          })}
        </div>
        {canEdit ? (
          <div style={{ padding: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {NOTE_KINDS.map(k => (
                <button key={k.key} onClick={() => setKind(k.key)} title={k.hint}
                  style={chip(kind === k.key, k.key === 'action' ? '#f59e0b' : k.key === 'note' ? '#38bdf8' : '#a78bfa')}>{k.icon} {k.label}</button>
              ))}
            </div>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder={noteKindMeta(kind).hint}
              style={{ width: '100%', resize: 'vertical', fontSize: 13.5 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={onClose} style={{ fontSize: 13, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)' }}>ปิด</button>
              <button onClick={add} disabled={busy} style={{ fontSize: 13, fontWeight: 700, padding: '6px 14px', borderRadius: 8, cursor: 'pointer', background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none' }}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
            </div>
          </div>
        ) : (
          <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 11.5, color: 'var(--muted)' }}>ดูอย่างเดียว — เพิ่ม/ลบหมายเหตุต้องมีสิทธิ์ kpi:manage</div>
        )}
      </div>
    </div>
  );
}
