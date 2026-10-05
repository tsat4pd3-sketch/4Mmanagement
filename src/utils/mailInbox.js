/* ═══ 📬 เมล EDI ที่หัวเรื่องบอกว่ามีไฟล์ แต่ไฟล์ไม่มาถึง (2026-10-05)

   user: *"ตัวออโต้ดึงจากเมลไม่ทำงานหรอ"* — ตัวดึงทำงาน (05/10 08:28 รับไฟล์เข้าคิว) แต่เมล
   "FTM_AAT_ 830 & 862_05.10.2026" ส่งมาถึงระบบ**แค่ไฟล์ 830** ⇒ 862 ของวันนั้นไม่มีในระบบ
   แผง 📬 โชว์แค่ไฟล์ที่มี ⇒ คนไม่รู้ว่าขาด ⇒ บอร์ด Delivery ยังถือแผนเก่าเงียบๆ
   ⇒ เทียบ "ชนิดที่หัวเรื่องประกาศ" (830/862) กับ "ชนิดของไฟล์ที่มาถึง" ต่อเมล · ขาด = เขียนบนจอ

   pure — ไม่แตะ DB/React · เทส `__tests__/mailInbox.test.mjs`
   ═══════════════════════════════════════════════════════════════════════════════ */

/** ชนิดไฟล์จากชื่อ (`830_…` / `862 …`) · ไม่รู้ = null */
export const mailFileKind = (name) => (String(name || '').match(/^(830|862)[_ .-]/) || [])[1] || null;

/** ชนิดที่หัวเรื่องประกาศ — "830 & 862_05.10.2026" ⇒ ['830','862'] (ตัวเลขที่ติดตัวเลขอื่นไม่นับ) */
export const subjectKinds = (subject) => {
  const out = new Set();
  for (const m of String(subject || '').matchAll(/(?<!\d)(830|862)(?!\d)/g)) out.add(m[1]);
  return [...out];
};

/**
 * เมลไหนขาดไฟล์ที่หัวเรื่องบอก
 * @param {Array<{message_id, subject, file_name, received_at}>} rows แถวคิวทุกสถานะ (ช่วงที่สนใจ)
 * @returns {Array<{message_id, subject, received_at, missing: string[], got: string[]}>} ใหม่ → เก่า
 */
export function mailsMissingFiles(rows = []) {
  const by = new Map();
  for (const r of rows || []) {
    const k = r?.message_id || `${r?.subject}|${r?.received_at}`;
    const g = by.get(k) || { message_id: r?.message_id ?? null, subject: r?.subject || '', received_at: r?.received_at || null, got: new Set() };
    const kind = mailFileKind(r?.file_name);
    if (kind) g.got.add(kind);
    by.set(k, g);
  }
  const out = [];
  for (const g of by.values()) {
    const missing = subjectKinds(g.subject).filter(k => !g.got.has(k));
    if (missing.length) out.push({ message_id: g.message_id, subject: g.subject, received_at: g.received_at, missing, got: [...g.got] });
  }
  return out.sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));
}
