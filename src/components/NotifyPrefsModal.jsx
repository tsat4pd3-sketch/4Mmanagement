/* ══ 🔕 "ตั้งค่าแจ้งเตือนของฉัน" — โมดัลในเมนูโปรไฟล์ (2026-11-03) ══════════════════════
   ข้อเสนอจากหน้างาน: *"ได้การกรองบาง User ที่แจ้งเตือนเฉพาะเกิด Downtime อย่างเดียว"*
   🔴 กฎว่าใครเห็นสวิตช์อะไร อยู่ `utils/notifyPrefs.js` · **ตัวกรองจริงอยู่ฝั่ง DB**
      (`notify_recipients` · migration 20261103) — ไฟล์นี้แค่เขียน/ลบแถว `notification_user_prefs`
   🔴 "งานที่รอเรา" ปิดไม่ได้ — ล็อก 2 ชั้น (ดูหัวไฟล์ notifyPrefs.js) · ตัวที่ล็อกยังโชว์ พร้อมเหตุผล */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import { checkWrite, checkWriteRows } from '../utils/dbWrite';
import { myNotifyRows, groupNotifyRows, mutedSetOf, muteSummary } from '../utils/notifyPrefs';
import InfoMore from './InfoMore';   // 📝 คำอธิบายยาวพับไว้หลัง ⓘ (UI §6.10 · คำสั่ง user 04/11)
import { toneVar, toneDim, toneLine } from '../utils/statusTone';   // 🎨 token พาเลต — ห้ามสีดิบในหน้า (UI §6.17)

const RULE_COLS = 'event_key, label, category, is_enabled, inapp_roles, can_mute, sort_order';

export default function NotifyPrefsModal({ role, onClose }) {
  const [rules, setRules] = useState([]);
  const [muted, setMuted] = useState(() => new Set());
  const [state, setState] = useState('loading');   // loading | ok | error
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setState('loading'); setErr('');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) { setErr('ไม่รู้ว่าคุณคือใคร (เซสชันหมดอายุ?) — ออกแล้วเข้าใหม่'); setState('error'); return; }
    const [rr, pr] = await Promise.all([
      supabase.from('notification_rules').select(RULE_COLS).order('category').order('sort_order'),
      supabase.from('notification_user_prefs').select('event_key, muted').eq('user_id', user.id),
    ]);
    /* 🔴 ลิสต์ว่างมี 2 ความหมาย — "ไม่มีเรื่องให้ตั้ง" กับ "โหลดไม่ติด" ⇒ ต้องแยกให้เห็น
       (กฎเขียน DB ข้อ 12 · ยังไม่ได้ apply migration = `can_mute` ไม่มี ⇒ error ตรงนี้ ไม่ใช่เงียบ) */
    if (rr.error || pr.error) { setErr(rr.error?.message || pr.error?.message || 'โหลดไม่สำเร็จ'); setState('error'); return; }
    setRules(rr.data || []);
    setMuted(mutedSetOf(pr.data || []));
    setState('ok');
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => myNotifyRows(rules, role), [rules, role]);
  const groups = useMemo(() => groupNotifyRows(rows), [rows]);
  const sum = useMemo(() => muteSummary(rows, muted), [rows, muted]);

  /* เปิด/ปิด 1 เรื่อง — ปิด = upsert แถว (muted) · เปิด = ลบแถวทิ้ง (ไม่มีแถว = รับตามปกติ)
     🔴 ลบต้องนับแถว (RLS ปฏิเสธ DELETE = 0 แถว ไม่มี error · กฎเขียน DB ข้อ 2)
     🔴 เขียนไม่ติด = ห้ามขยับสวิตช์บนจอ ไม่งั้นจอบอกว่าปิดแล้วแต่ของจริงยังส่งอยู่ */
  const toggle = async (ev, nextMuted) => {
    setBusy(ev);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return toast.error('เซสชันหมดอายุ — ออกแล้วเข้าใหม่');
      if (nextMuted) {
        const res = await supabase.from('notification_user_prefs')
          .upsert({ user_id: user.id, event_key: ev, muted: true, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,event_key' });
        if (!checkWrite(res, 'ปิดแจ้งเตือนเรื่องนี้')) return;
      } else {
        const res = await supabase.from('notification_user_prefs')
          .delete().eq('user_id', user.id).eq('event_key', ev).select('event_key');
        if (!checkWriteRows(res, 'เปิดแจ้งเตือนเรื่องนี้',
          { zeroMsg: 'เรื่องนี้เปิดอยู่แล้ว (ไม่มีรายการปิดค้างไว้) — รีเฟรชแล้วลองใหม่' })) return;
      }
      setMuted(prev => { const n = new Set(prev); if (nextMuted) n.add(ev); else n.delete(ev); return n; });
    } finally { setBusy(''); }
  };

  const lb = { fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 };
  return (
    /* `modal-scroll` = กติกากลาง (index.css) — overlay เลื่อนเอง + `> * { margin:auto }`
       ⚠️ ห้ามใส่ max-height/overflow ที่ตัวกล่อง · ไม่ปิดจากการคลิก backdrop */
    <div className="modal-scroll"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 3200, display: 'flex', padding: '4vh 3vw' }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, width: 'min(96vw, 560px)', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>🔕 ตั้งค่าแจ้งเตือนของฉัน</div>
          <button onClick={onClose} aria-label="ปิด" style={{ background: 'none', border: 'none', fontSize: 21, color: 'var(--muted)', cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* 📝 เหลือบรรทัดเดียวบนจอ ที่เหลือพับหลัง ⓘ (UI §6.10 — ห้ามกำแพงข้อความ)
              🔴 ไม่พับ "คำเตือนสถานะจริง" (แถบโหลดไม่สำเร็จ · ป้าย 🔒 รายแถว) ตามกฎของ InfoMore */}
          <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.65 }}>
            <InfoMore id="notifyprefs_help" lead="ปิดเรื่องที่ไม่อยากให้เด้ง — มีผลกับของคุณคนเดียว">
              สวิตช์นี้คุม <b>กระดิ่ง เสียง และการเด้งเข้ามือถือ</b> ของบัญชีคุณเท่านั้น
              คนอื่นในหน่วยงานยังได้รับตามปกติ · ปิดแล้วเรื่องนั้นจะไม่สร้างแจ้งเตือนใหม่ให้คุณ
              แต่ของเก่าที่เคยเด้งแล้วยังอยู่ในกระดิ่งเหมือนเดิม
              <div style={{ marginTop: 4 }}>
                🔒 <b>งานที่รอคุณลงมือ ปิดไม่ได้</b> — ใบที่ส่งถึงตัวคุณโดยตรง และคิวงานของหน่วยงานคุณ
                จะเด้งเสมอ ไม่ว่าตั้งอะไรไว้ (เรื่องพวกนั้นจะขึ้นป้าย 🔒 ในลิสต์ข้างล่าง)
              </div>
            </InfoMore>
          </div>

          {state === 'loading' && <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: 10 }}>กำลังโหลด…</div>}
          {state === 'error' && (
            <div role="alert" style={{ fontSize: 12, color: toneVar('bad'), background: toneDim('bad'), border: `1px solid ${toneLine('bad')}`, borderRadius: 8, padding: '8px 10px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 180 }}>โหลดรายการแจ้งเตือนไม่สำเร็จ ({err}) — ยังตั้งค่าไม่ได้</span>
              <button onClick={load} style={{ padding: '3px 10px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', fontSize: 12, cursor: 'pointer' }}>โหลดใหม่</button>
            </div>
          )}

          {state === 'ok' && !rows.length && (
            <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: 10, lineHeight: 1.6 }}>
              ตอนนี้ยังไม่มีเรื่องแจ้งเตือนที่ส่งถึงสิทธิ์ของคุณ (<b>{role || '—'}</b>) จึงไม่มีอะไรให้ปิด
              <div>ถ้าคิดว่าควรได้รับบางเรื่อง ให้แอดมินตั้งผู้รับที่หน้า “ตั้งค่าการแจ้งเตือน”</div>
            </div>
          )}

          {state === 'ok' && rows.length > 0 && (<>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>
              ปิดอยู่ {sum.muted} จาก {sum.total} เรื่องที่ปิดได้{sum.locked ? ` · ล็อกไว้ ${sum.locked} เรื่อง` : ''}
            </div>
            {groups.map(g => (
              <div key={g.category}>
                <div style={{ ...lb, marginBottom: 5 }}>{g.label}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {g.rows.map(r => {
                    const off = muted.has(r.event_key);
                    const working = busy === r.event_key;
                    return (
                      <label key={r.event_key} title={r.locked ? 'เรื่องนี้เป็นงานที่รอคุณ — ปิดไม่ได้' : undefined}
                        style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '6px 9px', borderRadius: 8,
                          background: 'var(--bg3)', border: '1px solid var(--border)', cursor: r.locked || working ? 'default' : 'pointer', opacity: working ? 0.6 : 1 }}>
                        <input type="checkbox" checked={!r.locked && !off} disabled={r.locked || working}
                          onChange={e => toggle(r.event_key, !e.target.checked)}
                          style={{ width: 'auto', marginTop: 2, flexShrink: 0 }} />
                        <span style={{ fontSize: 12.5, color: r.locked ? 'var(--muted)' : 'var(--text)', lineHeight: 1.5, minWidth: 0 }}>
                          {r.label}
                          {r.locked && <span style={{ fontSize: 11, color: toneVar('warn'), fontWeight: 700 }}> · 🔒 งานที่รอคุณ ปิดไม่ได้</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </>)}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '11px 16px', borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>เสร็จแล้ว</button>
        </div>
      </div>
    </div>
  );
}
