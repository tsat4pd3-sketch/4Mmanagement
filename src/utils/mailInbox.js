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

/* 📅 รอบของไฟล์แต่ละชนิด (06/10 · คำสั่ง user)
   หัวเรื่องของ Sales เป็นแม่แบบตายตัว "830 & 862_<วันที่>" ทุกวัน แต่ *"830 ปกติจะเมลมาให้แค่ต้นสัปดาห์
   … หลังจากไฟล์แรกของสัปดาห์ ถ้าไม่ได้ 830 แต่ได้ 862 ก็ปกติ"*
   ⇒ ชนิดที่ "ขาด" ไม่เตือน ถ้ามีไฟล์ชนิดนั้น (ทางเมล หรือ คนนำเข้าเอง) อยู่ในรอบเดียวกันแล้ว:
      830 = สัปดาห์เดียวกัน (จันทร์ 00:00 เวลาไทย) · 862 = วันเดียวกัน (เวลาไทย) · ทั้งก่อนและหลังเมล
      (ไฟล์ตามมาทีหลังในรอบเดียวกันก็ล้างแถบได้ · 862 ของวันถัดไปไม่นับ — คนละรอบ release)
      · เมลแรกของสัปดาห์ไม่มี 830 = ยังเตือน */
export const MAIL_KIND_PERIOD = { '830': 'week', '862': 'day' };
const DAY_MS = 86400000;
const BKK_MS = 7 * 3600000;
/** จุดเริ่มรอบ (ms) ของเวลา t ตามเวลาไทย — 'day' = เที่ยงคืน · 'week' = จันทร์เที่ยงคืน */
export function periodStartMs(t, period) {
  const local = t + BKK_MS;
  const day0 = local - (((local % DAY_MS) + DAY_MS) % DAY_MS);
  const back = period === 'week' ? ((new Date(day0).getUTCDay() + 6) % 7) * DAY_MS : 0;
  return day0 - back - BKK_MS;
}

/**
 * เมลไหนขาดไฟล์ที่หัวเรื่องบอก
 * @param {Array<{message_id, subject, file_name, received_at}>} rows แถวคิวทุกสถานะ (ช่วงที่สนใจ)
 * @returns {Array<{message_id, subject, received_at, missing: string[], got: string[]}>} ใหม่ → เก่า
 */
export function mailsMissingFiles(rows = [], { imports = [] } = {}) {
  /* เวลาทุกครั้งที่ "ได้ไฟล์ชนิดนั้น" — ไฟล์ในเมล + การนำเข้า (imports: [{kind:'830'|'862', at}]) */
  const seen = { '830': [], '862': [] };
  for (const r of rows || []) {
    const k = mailFileKind(r?.file_name); const t = Date.parse(r?.received_at || '');
    if (k && Number.isFinite(t)) seen[k].push(t);
  }
  for (const i of imports || []) {
    const t = Date.parse(i?.at || ''); if (seen[i?.kind] && Number.isFinite(t)) seen[i.kind].push(t);
  }
  const covered = (kind, at) => {
    const t = Date.parse(at || ''); if (!Number.isFinite(t)) return false;
    const period = MAIL_KIND_PERIOD[kind] || 'day';
    const from = periodStartMs(t, period);
    const to = from + (period === 'week' ? 7 : 1) * DAY_MS;
    return (seen[kind] || []).some(x => x >= from && x < to);
  };
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
    const missing = subjectKinds(g.subject).filter(k => !g.got.has(k) && !covered(k, g.received_at));
    if (missing.length) out.push({ message_id: g.message_id, subject: g.subject, received_at: g.received_at, missing, got: [...g.got] });
  }
  return out.sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));
}
