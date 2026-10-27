/* ══ MobilePushPrompt — แถบชวนเปิดแจ้งเตือนเข้ามือถือ (เฉพาะจอมือถือ · 2026-10-20) ════════
   ที่มา: feedback 20/10 *"มือถือ ไม่มีการแจ้งเตือนใบแจ้งซ่อมมา 2-3 วัน"* — ไล่แล้วไม่ใช่เรื่องสิทธิ์
   ปุ่มเปิด push **มีอยู่แล้ว** แต่ซ่อนในกระดิ่งที่ต้องกดเปิดเอง ⇒ วัด 20/10: ผู้รับแจ้งเตือน 7 วัน
   102 คน **มีเครื่องผูกไว้แค่ 28** — คนที่เหลือไม่เคยรู้ว่าตัวเองยังไม่ได้เปิด
   ⇒ แถบนี้ทำให้ "ยังไม่เปิด" มองเห็นได้เองโดยไม่ต้องไปกดหา

   🔴 **ห้ามเปลี่ยนจอคอมแม้แต่พิกเซลเดียว** (คำสั่ง user 15/10) ⇒ `useIsMobile()` ไม่ใช่มือถือ = คืน null
      ก่อน hook อื่นจะทำงาน · พิสูจน์ด้วย `node audit/desktopdiff.mjs` (ต้องต่าง 0)
   🔴 วางเป็น **แถบในเนื้อหา ไม่ใช่ fixed/sticky** — ของชิดล่างต้องบวก `var(--mnav-h)` และ sticky
      มีประวัติทับเนื้อหา ⇒ เลี่ยงทั้งคู่ไปเลย (mobilesweep จะได้ไม่มีอะไรให้จับ)
   🔴 สถานะอ่านจาก `utils/webpush.js` ที่เดียว **ห้ามเขียนตรรกะสถานะซ้ำที่นี่**
      — `check-failed` = ตรวจไม่ได้ **ห้ามบอกว่า "ยังไม่เปิด"** (จอโกหก) · `subscribed` = ไม่วาดอะไร
   ⏱️ กด "ไว้ก่อน" = พัก 3 วัน (เก็บใน localStorage ต่อเครื่อง · อ่าน/เขียนใน try-catch —
      โหมดส่วนตัว/บล็อก storage ต้องไม่ทำให้แถบพัง) **ไม่มีทางปิดถาวร** เพราะเป้าคือคนกลุ่มที่ยังไม่เปิด */
import { useCallback, useEffect, useState } from 'react';
import useIsMobile from '../utils/useIsMobile';
import { getPushState, subscribePush } from '../utils/webpush';
import { pushPromptCopy, snoozeUntil, isSnoozed } from '../utils/pushPrompt';
import { toast } from './Toast';

export default function MobilePushPrompt({ userId }) {
  const isMobile = useIsMobile();
  const [state, setState] = useState(null);
  const [busy,  setBusy]  = useState(false);
  const [snoozed, setSnoozed] = useState(() => isSnoozed());

  const refresh = useCallback(() => {
    let alive = true;                       // กัน stale-response (กฎเหล็กข้อ 4)
    if (!isMobile) { setState(null); return () => { alive = false; }; }
    getPushState(userId)
      .then(st => { if (alive) setState(st); })
      .catch(() => { if (alive) setState('check-failed'); });
    return () => { alive = false; };
  }, [isMobile, userId]);
  useEffect(() => refresh(), [refresh]);

  const enable = async () => {
    setBusy(true);
    try {
      const ok = await subscribePush(userId);
      if (ok) toast.success('เปิดแจ้งเตือนเข้ามือถือแล้ว 📲 — กดกระดิ่งแล้วกด "ทดสอบส่ง" เพื่อเช็คว่าเด้งถึงเครื่องนี้');
      else if (Notification.permission === 'denied') toast.error('เบราว์เซอร์บล็อกการแจ้งเตือน — เปิดสิทธิ์ในตั้งค่าเบราว์เซอร์');
      else toast.info('ยังไม่ได้อนุญาต — กด "อนุญาต" ในกล่องที่เบราว์เซอร์ถาม');
    } catch (e) { toast.error(e?.message || 'เปิดไม่สำเร็จ'); }
    finally { setBusy(false); refresh(); }
  };

  const snooze = () => { snoozeUntil(); setSnoozed(true); };

  if (!isMobile || snoozed) return null;
  const c = pushPromptCopy(state);
  if (!c) return null;

  const accent = c.tone === 'warn' ? 'var(--accent2)' : 'var(--accent)';
  return (
    <div style={{
      margin: '0 12px 10px', padding: '8px 10px', borderRadius: 10,
      border: `1px solid ${accent}`, background: 'var(--bg2)',
      fontSize: 11.5, lineHeight: 1.55, color: 'var(--text)',
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
    }}>
      <span style={{ flex: '1 1 180px', minWidth: 0 }}>{c.text}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
        {c.cta && (
          <button onClick={enable} disabled={busy}
            style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--accent-ink)', background: 'var(--accent)',
                     border: 'none', borderRadius: 7, padding: '5px 12px', cursor: busy ? 'default' : 'pointer' }}>
            {busy ? 'กำลังเปิด…' : c.cta}
          </button>
        )}
        <button onClick={snooze}
          style={{ fontSize: 11, color: 'var(--muted)', background: 'none', border: 'none',
                   cursor: 'pointer', padding: 0, textDecoration: 'underline', whiteSpace: 'nowrap' }}>
          ไว้ก่อน
        </button>
      </span>
    </div>
  );
}
