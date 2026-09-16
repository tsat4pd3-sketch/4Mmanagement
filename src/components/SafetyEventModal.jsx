import { useState, useContext, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from './Toast';
import { SAFETY_KINDS, safetyKind } from '../utils/obeya';
import { notifyEvent } from '../utils/notifyEvent';

/* ══ 🛡️ บันทึกเหตุการณ์ความปลอดภัย (OBEYA แกน S) · 2026-08-27 ═══════════════════
   ระบบเดิม "ไม่มีที่เก็บอุบัติเหตุเลย" — ตรวจ 2026-08-27: ไม่มีตาราง accident/incident/injury
   ตัวนี้คือทางเข้าเดียวของตาราง safety_events

   กฎที่ยึด:
   • **ห้ามปิดจากการคลิกพื้นหลัง** — เป็นฟอร์มกรอกข้อมูล เผลอแตะแล้วของหาย (UI-CONVENTIONS §5)
     ปิดได้ทาง ✕ / ยกเลิก เท่านั้น และถามยืนยันเมื่อกรอกไปแล้ว
   • **ลบ = soft delete** (is_active=false) — บันทึกความปลอดภัยห้ามหายจากประวัติ
   • **update ต้องนับแถวที่เขียนจริง** (.select('id')) — RLS ปฏิเสธ update = 0 แถว ไม่ error (กฎ RLS-เงียบ)
   • ชนิดเหตุการณ์อ่านจาก SAFETY_KINDS (utils/obeya) — ค่าเดิมที่ไม่อยู่ในลิสต์ต้องยังโชว์ได้
     ไม่งั้นเปิดแก้ไขแล้วชนิดหายเงียบ
   ═════════════════════════════════════════════════════════════════════════════ */

export default function SafetyEventModal({ init, section, date, lineOpts = [], sectionOpts = [], onClose, onSaved }) {
  const { fullName } = useContext(UserContext);
  const editing = !!init?.id;
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [f, setF] = useState(() => ({
    event_date: init?.event_date || date || '',
    kind: init?.kind || 'near_miss',
    section: init?.section ?? (section || ''),
    line_name: init?.line_name || '',
    shift: init?.shift || '',
    employee_name: init?.employee_name || '',
    employee_code: init?.employee_code || '',
    description: init?.description || '',
    body_part: init?.body_part || '',
    lost_days: init?.lost_days ?? 0,
    cause: init?.cause || '',
    countermeasure: init?.countermeasure || '',
    status: init?.status || 'open',
  }));
  const set = (k, v) => { setF(p => ({ ...p, [k]: v })); setDirty(true); };

  const kindMeta = safetyKind(f.kind);
  /* ค่าเดิมที่ไม่อยู่ในลิสต์มาตรฐาน ต้องยังเลือก/แสดงได้ ห้ามหายเงียบ */
  const kindList = useMemo(() => {
    const base = SAFETY_KINDS;
    return base.some(k => k.key === f.kind) ? base : [...base, safetyKind(f.kind)];
  }, [f.kind]);

  const close = () => {
    if (dirty && !window.confirm('ยังไม่ได้บันทึก — ปิดแล้วข้อมูลที่กรอกจะหาย ยืนยันปิด?')) return;
    onClose?.();
  };

  const save = async () => {
    if (!f.event_date) { toast.error('เลือกวันที่เกิดเหตุก่อน'); return; }
    if (!f.description.trim()) { toast.error('กรอกรายละเอียดเหตุการณ์ก่อน — เหตุการณ์ที่ไม่มีรายละเอียดเอาไปใช้ต่อไม่ได้'); return; }
    setBusy(true);
    const payload = {
      event_date: f.event_date,
      kind: f.kind,
      section: f.section || null,
      line_name: f.line_name || null,
      shift: f.shift || null,
      employee_name: f.employee_name.trim() || null,
      employee_code: f.employee_code.trim() || null,
      description: f.description.trim(),
      body_part: f.body_part.trim() || null,
      lost_days: Number(f.lost_days) || 0,
      cause: f.cause.trim() || null,
      countermeasure: f.countermeasure.trim() || null,
      status: f.status,
      closed_at: f.status === 'closed' ? (init?.closed_at || new Date().toISOString()) : null,
    };
    try {
      if (editing) {
        const { data, error } = await supabase.from('safety_events').update(payload).eq('id', init.id).select('id');
        if (error) throw error;
        if (!data?.length) { toast.error('บันทึกไม่สำเร็จ — บัญชีนี้ไม่มีสิทธิ์ safety:record'); return; }
      } else {
        const { data, error } = await supabase.from('safety_events')
          .insert({ ...payload, reported_by_name: fullName || null }).select('id').single();
        if (error) throw error;
        /* แจ้งเตือน — ยิงตอน "บันทึกใหม่" เท่านั้น ห้ามยิงตอนแก้ไข (แก้ typo ทีนึงเด้งใหม่ทุกครั้ง)
           fire-and-forget: แจ้งเตือนพลาดห้ามทำให้การบันทึกของผู้ใช้พัง */
        notifyEvent({
          event: 'safety_event',
          title: `${kindMeta.icon} ${kindMeta.label}`,
          section: payload.section || undefined,
          line_name: payload.line_name || undefined,
          actor: fullName || undefined,
          type: kindMeta.severity >= 2 ? 'error' : 'info',
          ref_table: 'safety_events', ref_id: data?.id,
          lines: [
            `📅 ${payload.event_date}${payload.shift ? ` · ${payload.shift === 'night' ? 'กะดึก' : 'กะเช้า'}` : ''}`,
            `🏭 ${payload.section || 'ไม่ระบุส่วนงาน'}${payload.line_name ? ` · ${payload.line_name}` : ''}`,
            `📝 ${payload.description}`,
            payload.employee_name ? `👤 ${payload.employee_name}${payload.body_part ? ` · ${payload.body_part}` : ''}` : '',
            payload.lost_days > 0 ? `🚑 หยุดงาน ${payload.lost_days} วัน` : '',
            kindMeta.resetsStreak ? '🔴 ตัวนับ "วันปลอดอุบัติเหตุ" ของส่วนงานนี้ถูกรีเซ็ต' : '',
          ],
        });
      }
      toast.success(editing ? 'แก้ไขเหตุการณ์แล้ว' : 'บันทึกเหตุการณ์แล้ว');
      onSaved?.();
    } catch (e) {
      toast.error(
        e?.code === '42P01' ? 'ยังไม่ได้ apply migration safety_events (Main) — แจ้ง admin'
          : e?.code === '42501' ? 'ไม่มีสิทธิ์บันทึก (ต้องมี safety:record)'
            : 'บันทึกไม่สำเร็จ: ' + (e?.message || e));
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm('ซ่อนเหตุการณ์นี้ออกจากบอร์ด?\nระบบไม่ลบทิ้ง (เก็บไว้ในประวัติ) แต่จะไม่ถูกนับใน KPI อีก')) return;
    setBusy(true);
    const { data, error } = await supabase.from('safety_events')
      .update({ is_active: false }).eq('id', init.id).select('id');
    setBusy(false);
    if (error || !data?.length) { toast.error('ทำไม่สำเร็จ' + (error ? ': ' + error.message : ' (ไม่มีสิทธิ์)')); return; }
    toast.success('ซ่อนออกจากบอร์ดแล้ว');
    onSaved?.();
  };

  const inp = { width: '100%', padding: '6px 8px', fontSize: 13, borderRadius: 7, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)' };
  const lbl = { fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 };

  return (
    /* ⚠️ ไม่มี onClick ที่ backdrop โดยตั้งใจ — ฟอร์มกรอกข้อมูลห้ามปิดจากการเผลอแตะ */
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 14, padding: 18, width: 'min(720px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, gap: 8 }}>
          <b style={{ fontSize: 15, color: 'var(--text)' }}>
            {editing ? '✏️ แก้ไขเหตุการณ์ความปลอดภัย' : '🛡️ บันทึกเหตุการณ์ความปลอดภัย'}
          </b>
          <button onClick={close} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 17, cursor: 'pointer' }}>✕</button>
        </div>

        <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignContent: 'start' }}>
          <div>
            <div style={lbl}>วันที่เกิดเหตุ *</div>
            <input type="date" style={inp} value={f.event_date} onChange={e => set('event_date', e.target.value)} />
          </div>
          <div>
            <div style={lbl}>กะ</div>
            <select style={inp} value={f.shift} onChange={e => set('shift', e.target.value)}>
              <option value="">— ไม่ระบุ —</option>
              <option value="day">กะเช้า</option>
              <option value="night">กะดึก</option>
            </select>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <div style={lbl}>ระดับเหตุการณ์ *</div>
            <select style={inp} value={f.kind} onChange={e => set('kind', e.target.value)}>
              {kindList.map(k => <option key={k.key} value={k.key}>{k.icon} {k.label}</option>)}
            </select>
            <div style={{ fontSize: 11, color: kindMeta.resetsStreak ? '#ef4444' : 'var(--muted)', marginTop: 3 }}>
              {kindMeta.resetsStreak
                ? '🔴 ระดับนี้จะ "รีเซ็ตตัวนับวันปลอดอุบัติเหตุ" ของส่วนงานนี้'
                : 'ระดับนี้ไม่รีเซ็ตตัวนับวันปลอดอุบัติเหตุ (นับเฉพาะถึงขั้นหยุดงาน)'}
            </div>
          </div>

          <div>
            <div style={lbl}>ส่วนงาน</div>
            <select style={inp} value={f.section} onChange={e => set('section', e.target.value)}>
              <option value="">— ไม่ระบุ —</option>
              {sectionOpts.map(s => <option key={s} value={s}>{s}</option>)}
              {f.section && !sectionOpts.includes(f.section) && <option value={f.section}>{f.section} (นอกขอบเขต)</option>}
            </select>
          </div>
          <div>
            <div style={lbl}>ไลน์ (ถ้าเกิดในไลน์)</div>
            <select style={inp} value={f.line_name} onChange={e => set('line_name', e.target.value)}>
              <option value="">— ไม่ระบุ / นอกไลน์ —</option>
              {lineOpts.map(l => <option key={l} value={l}>{l}</option>)}
              {f.line_name && !lineOpts.includes(f.line_name) && <option value={f.line_name}>{f.line_name} (นอกขอบเขต)</option>}
            </select>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <div style={lbl}>เกิดอะไรขึ้น *</div>
            <textarea style={{ ...inp, minHeight: 62, resize: 'vertical' }} value={f.description}
              onChange={e => set('description', e.target.value)}
              placeholder="เช่น พนักงานยกกล่องแล้วมุมกล่องกระแทกหน้าแข้งขวา ที่ทางเดินหน้าไลน์" />
          </div>

          <div>
            <div style={lbl}>ชื่อผู้ประสบเหตุ</div>
            <input style={inp} value={f.employee_name} onChange={e => set('employee_name', e.target.value)} />
          </div>
          <div>
            <div style={lbl}>รหัสพนักงาน</div>
            <input style={inp} value={f.employee_code} onChange={e => set('employee_code', e.target.value)} />
          </div>

          <div>
            <div style={lbl}>อวัยวะที่บาดเจ็บ</div>
            <input style={inp} value={f.body_part} onChange={e => set('body_part', e.target.value)} placeholder="เช่น หน้าแข้งขวา" />
          </div>
          <div>
            <div style={lbl}>จำนวนวันหยุดงาน</div>
            <input type="number" min="0" style={inp} value={f.lost_days} onChange={e => set('lost_days', e.target.value)} />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <div style={lbl}>สาเหตุ (เติมทีหลังได้)</div>
            <textarea style={{ ...inp, minHeight: 46, resize: 'vertical' }} value={f.cause} onChange={e => set('cause', e.target.value)} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={lbl}>มาตรการแก้ไข / ป้องกันซ้ำ</div>
            <textarea style={{ ...inp, minHeight: 46, resize: 'vertical' }} value={f.countermeasure} onChange={e => set('countermeasure', e.target.value)} />
          </div>

          <div>
            <div style={lbl}>สถานะ</div>
            <select style={inp} value={f.status} onChange={e => set('status', e.target.value)}>
              <option value="open">ยังไม่ปิด (ยังต้องตามแก้)</option>
              <option value="closed">ปิดแล้ว (แก้ไข + ป้องกันซ้ำเรียบร้อย)</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {editing && (
            <button onClick={remove} disabled={busy}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 12.5 }}>
              🗑 ซ่อนออกจากบอร์ด
            </button>
          )}
          <button onClick={close} disabled={busy}
            style={{ marginLeft: 'auto', padding: '7px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}>
            ยกเลิก
          </button>
          <button onClick={save} disabled={busy}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#08130a', fontWeight: 800, cursor: busy ? 'wait' : 'pointer', fontSize: 13 }}>
            {busy ? 'กำลังบันทึก...' : '💾 บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}
