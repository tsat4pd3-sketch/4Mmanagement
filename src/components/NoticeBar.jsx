/* ══ ⚠️ NoticeBar — แถบแจ้งเหนือเนื้อหา "บรรทัดเดียว + ทางไปทำ" (2026-11-04 · UI-CONVENTIONS §6.35) ═══
   เดิมแต่ละหน้าซ้อนแถบเตือน 2–4 ชั้น (แดงเต็มพื้น + กล่องส้ม + ป้ายฟ้า) ก่อนถึงเนื้อหา ⇒ คนเลิกอ่าน
   กติกา: หนึ่งเรื่อง = หนึ่งแถบ · ข้อความสั้นบรรทัดเดียว (`children`) · มี `action` ถ้ามีที่ให้ไปแก้
   · `tone`: 'warn' (เหลือง · งานค้าง/ข้อมูลไม่ครบ) | 'bad' (แดง · ต้องหยุดทำ) | 'info' (ฟ้า · บอกเฉยๆ)
   · ไม่กระพริบ (กระพริบสงวนให้ Andon แดง · UI §2) · ขอบซ้ายสี 3px พื้นการ์ดปกติ ไม่ทาพื้นเต็มแถบ

   ใช้:
     <NoticeBar tone="warn" action={{ label: 'ไปไล่ปิด →', onClick: onGoStale, title: '…' }}>
       <b>กะค้างยังไม่ปิด 15 กะ</b> · เกิน 7 วัน 15 กะ — ไม่เกี่ยวกับกะที่กำลังทำอยู่
     </NoticeBar> */
const TONE = { warn: 'var(--amber)', bad: 'var(--red)', info: 'var(--blue)', ok: 'var(--green)' };
const ICON = { warn: '⚠', bad: '⛔', info: 'ⓘ', ok: '✓' };

export default function NoticeBar({ tone = 'warn', icon, action, children, style }) {
  const c = TONE[tone] || TONE.warn;
  return (
    <div role="status" className="notice-bar" style={{ borderLeftColor: c, ...style }}>
      <span aria-hidden="true" style={{ color: c, fontWeight: 700, flexShrink: 0 }}>{icon ?? ICON[tone] ?? ICON.warn}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      {action && (
        <button type="button" className="notice-bar-act" onClick={action.onClick} title={action.title}>{action.label}</button>
      )}
    </div>
  );
}
