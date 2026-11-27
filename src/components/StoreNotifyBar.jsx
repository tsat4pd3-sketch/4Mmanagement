import { tr } from '../utils/i18n';
/* 📦 แถบ "รอแจ้งสโตร์" — ไม่บังจอ (19/11 · คำสั่ง user)
   user: *"มันทำงานช้าลงเพราะเปิดออเดอร์ต่อกันไม่ได้ · จะแก้ยังไง แต่ไม่ใช่ตัดออก"*
   เดิมเปิดใบผลิตแล้วเด้ง popup ยืนยันทันที ⇒ บังช่องสแกน PROD.NO ต้องกดปิดก่อนยิงใบถัดไป
   ตอนนี้: เปิดใบ ⇒ คิดเงียบๆ (`previewLineDemand`) ⇒ ขึ้นแถบนี้ · เปิดหลายใบติดกัน = รวมในแถบเดียว
   กด "ดู / แจ้งสโตร์" ⇒ คิดใหม่สด + ถามยืนยัน (popup เดิม) — การแจ้งสโตร์ยังต้องผ่านคนกดเหมือนเดิม
   · ไม่มีอะไรต้องแจ้ง + ไม่มีคำเตือน = ไม่ขึ้นแถบ · มีคำเตือน (ไม่มี BOM ฯลฯ) = ขึ้นแถบเหลือง ห้ามเงียบ
   state อยู่ที่หน้าแม่ (DailyReport) — คอมโพเนนต์นี้วาดอย่างเดียว */

/**
 * @param {{ bar: null | { lineName, mats: string[], loading?: boolean, res?: object, err?: string },
 *           busy?: boolean, onOpen: () => void, onDismiss: () => void, onRetry?: () => void }} p
 */
export default function StoreNotifyBar({ bar, busy = false, onOpen, onDismiss, onRetry }) {
  if (!bar) return null;
  const { mats = [], loading, res, err } = bar;
  const send = res?.sendCount || 0;
  const warn = res?.warnCount || 0;
  const tone = err ? 'red' : 'amber';
  const matTxt = mats.length ? ` · ${tr("จากใบผลิตที่เพิ่งเปิด")} ${mats.slice(0, 4).join(', ')}${mats.length > 4 ? ` +${mats.length - 4}` : ''}` : '';
  let text;
  if (err) text = `⚠️ ${tr("คิดรายการแจ้งสโตร์ไม่สำเร็จ")} — ${err}`;
  else if (loading && !res) text = '📦 กำลังคิดของที่ต้องแจ้งสโตร์…';
  else if (send) text = `📦 ${tr("รอแจ้งสโตร์")} ${send} ${tr("รายการ")}${warn ? ` · ⚠️ ${tr("มีคำเตือน")} ${warn} ${tr("รายการ")}` : ''}${matTxt}`;
  else text = `⚠️ ${tr("มีคำเตือน")} ${warn} ${tr("รายการ (เช่น ใบผลิตไม่มี BOM) — ยังไม่ได้ขอของให้")}${matTxt}`;
  const btn = (label, onClick, primary) => (
    <button type="button" onClick={onClick} disabled={busy}
      style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 'var(--r-md)', cursor: busy ? 'wait' : 'pointer',
        border: `1px solid var(--${tone}-line)`, background: primary ? `var(--${tone})` : 'transparent',
        color: primary ? '#000' : `var(--${tone})`, opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap' }}>
      {label}
    </button>
  );
  return (
    <div role="status" aria-live="polite" data-testid="store-notify-bar"
      style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 12px', marginTop: 10,
        borderRadius: 'var(--r-md)', border: `1px solid var(--${tone}-line)`, background: `var(--${tone}-dim)` }}>
      <div style={{ flex: '1 1 220px', fontSize: 12, fontWeight: 700, color: `var(--${tone})`, lineHeight: 1.45 }}>
        {text}{loading && res ? tr(" · กำลังคิดใหม่…") : ''}
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        {err
          ? <>{onRetry && btn('ลองใหม่', onRetry, true)}{btn('ปิด', onDismiss)}</>
          : (!loading || res) && <>{btn(send ? 'ดู / แจ้งสโตร์' : 'ดูรายละเอียด', onOpen, true)}{btn('ไว้ทีหลัง', onDismiss)}</>}
      </div>
    </div>
  );
}
