/* ══ 🛡️ ทะเบียนคำถาม LPA — ตัวนับปลายทางก่อนลบ + ข้อความเตือน "กำลังลบของใคร" ══════════
   (2026-10-12 · เคสจริง: feedback หน้างาน "Layer ข้อ 22,23 หายไปครับ")

   เกิดอะไรขึ้น (ของจริง วัดจาก audit_log):
     02/10 15:24 มีคนกด 🗑 ลบข้อ common 2 ข้อ (VISUAL / ANDON) ⇒ **หายจากใบตรวจของทุกไลน์**
     12/10 08:36 อีกคนสร้างกลับมาใหม่ (ได้ id ใหม่ ⇒ ใบเก่าไม่ผูกกลับให้เอง)
     ผลพลอยได้ที่เจอตอนไล่: `lpa_audit_answers` **ไม่มี FK** ไป `lpa_questions`
     ⇒ คำตอบกำพร้า **2,444 แถว (17%) กระทบใบตรวจ 581 ใบ** — ข้อมูลไม่หาย (มี `question_text`
       snapshot ครบทุกแถว) แต่จอใบตรวจวาดจาก "ลิสต์คำถามวันนี้" จึงไม่แสดง = ใบเก่าดูเหมือนตรวจน้อยข้อ

   กฎที่ไฟล์นี้เป็นเจ้าของ (ชุดเดียวกับ `costCenterRefs.js` / `orgNodeRefs.js` / `processTypeRefs.js`):
     🔴 **นับปลายทางให้ครบก่อนถาม — นับไม่ได้ = ห้ามลบ (fail-closed)**
     🔴 **มีผลตรวจอ้างอยู่ = ลบไม่ได้เลย ให้ "ปิดใช้งาน" แทน** (ข้อหายจากใบถัดไป · ใบเก่ายังอ่านออก)
     🔴 **ถามยืนยันต้องบอกขอบเขตเสมอ** (คำสั่ง user 12/10 — *"ตอนลบแจ้งเตือนด้วย ว่ากำลังจะลบ
        ของส่วนรวมดีมั้ย หรือลบของส่วนงานอะไร"*) — ข้อ common กระทบทุกไลน์ คนกดมักไม่รู้ตัว
   ═════════════════════════════════════════════════════════════════════════════════════ */

/** ตารางปลายทางที่อ้างคำถาม LPA (ยังไม่มี FK — ต้องไล่นับเอง) */
export const LPA_QUESTION_REF_TABLES = [
  ['lpa_audit_answers', 'คำตอบในใบตรวจ', 'question_id'],
];

/* ตารางยังไม่มี/คอลัมน์ยังไม่มี = นับเป็น 0 ไม่ใช่ "นับไม่ได้" (ยังไม่ apply migration ก็ต้องใช้งานได้) */
const SCHEMA_GAP = ['42P01', '42703'];

/**
 * นับว่าคำถามข้อนี้ถูกอ้างอยู่กี่ที่
 * @returns {{counts:{table,label,n}[], total:number, partial:boolean}}
 *          `partial: true` = นับไม่ครบ ⇒ **ห้ามลบ**
 */
export async function loadLpaQuestionRefs(client, id) {
  const key = String(id ?? '').trim();
  if (!client || !key) return { counts: [], total: 0, partial: true };
  const res = await Promise.all(LPA_QUESTION_REF_TABLES.map(([t, , col]) =>
    client.from(t).select('*', { count: 'exact', head: true }).eq(col, key)
  ));
  const counts = []; let partial = false;
  res.forEach((r, i) => {
    const [table, label] = LPA_QUESTION_REF_TABLES[i];
    if (r.error) { if (!SCHEMA_GAP.includes(r.error.code)) partial = true; return; }
    const n = r.count ?? 0;
    if (n > 0) counts.push({ table, label, n });
  });
  return { counts, total: counts.reduce((s, c) => s + c.n, 0), partial };
}

/**
 * ขอบเขตของข้อนี้ — "ของส่วนรวม" (ทุกไลน์) หรือ "ของไลน์เดียว"
 * `line_name` ว่าง = common · มีค่า = เฉพาะไลน์นั้น
 */
export function lpaQuestionScope(q = {}) {
  const line = String(q.line_name || '').trim();
  const hidden = Array.isArray(q.hidden_for_lines) ? q.hidden_for_lines.filter(Boolean) : [];
  return { common: !line, lineName: line, hiddenCount: hidden.length };
}

/** ป้ายขอบเขตสั้นๆ สำหรับข้อความเตือน */
export function lpaScopeText(q = {}) {
  const s = lpaQuestionScope(q);
  if (!s.common) return `ข้อเฉพาะไลน์ "${s.lineName}"`;
  return s.hiddenCount
    ? `ข้อของส่วนรวม (ใช้ทุกไลน์ · ตอนนี้ซ่อนไว้ ${s.hiddenCount} ไลน์)`
    : 'ข้อของส่วนรวม (ใช้ทุกไลน์)';
}

/**
 * ลบได้ไหม — คืน "ข้อความที่ต้องขึ้นเตือน" ถ้าลบไม่ได้ · คืน `null` ถ้าลบได้
 * ⚠️ เรียกก่อน `window.confirm` เสมอ — ถามแล้วค่อยปฏิเสธ = คนกดยืนยันไปแล้วแต่ไม่เกิดอะไร
 */
export function lpaQuestionBlockMessage(q = {}, refs) {
  if (!refs) return 'ยังตรวจการใช้งานไม่เสร็จ — ลองอีกครั้ง';
  if (refs.partial) return 'ยังลบไม่ได้ — ตรวจไม่ครบว่ามีใบตรวจไหนอ้างข้อนี้อยู่ (คิวรีนับล้ม) · ลองใหม่อีกครั้ง';
  if (!refs.counts.length) return null;
  const parts = refs.counts.map(c => `${c.label} ${c.n.toLocaleString()} รายการ`);
  return `ลบไม่ได้: ${lpaScopeText(q)} นี้ถูกใช้ไปแล้ว — ${parts.join(' · ')}`
       + ' · ลบแล้วใบตรวจย้อนหลังจะอ่านไม่ครบ ให้กด "⏸ ปิดใช้งาน" แทน'
       + ' (ข้อจะหายจากใบตรวจครั้งถัดไป แต่ใบเก่ายังอ่านออก)';
}

/**
 * ข้อความ confirm ตอนลบได้จริง — **ต้องบอกเสมอว่ากำลังลบของใคร**
 * (ข้อ common กระทบทุกไลน์ · คนกดในมุมมอง "ทุกไลน์" มักนึกว่าลบแค่ของตัวเอง)
 */
export function lpaDeleteConfirmText(q = {}) {
  const s = lpaQuestionScope(q);
  const text = String(q.question || '').slice(0, 80);
  if (s.common) {
    return `⚠️ กำลังลบ "ข้อของส่วนรวม" — ใช้กับทุกไลน์\n\n`
         + `ข้อ ${q.seq ?? '-'}: ${text}\n\n`
         + `ลบแล้ว ทุกไลน์จะไม่เห็นข้อนี้ในใบตรวจครั้งถัดไป\n`
         + (s.hiddenCount ? `(ตอนนี้ซ่อนไว้ ${s.hiddenCount} ไลน์ — ไลน์ที่เหลือยังใช้ข้อนี้อยู่)\n` : '')
         + `ถ้าอยากเอาออกแค่ไลน์เดียว ให้ใช้ปุ่ม 🚫 ซ่อนเฉพาะไลน์นี้ แทน\n\n`
         + `ยืนยันลบ?`;
  }
  return `กำลังลบข้อเฉพาะไลน์ "${s.lineName}" (ไลน์อื่นไม่กระทบ)\n\n`
       + `ข้อ ${q.seq ?? '-'}: ${text}\n\n`
       + `ยืนยันลบ?`;
}

/**
 * คำตอบที่บันทึกไว้แล้ว แต่ "ไม่มีคำถามในเช็คลิสต์วันนี้" (ข้อที่ถูกลบ/ปิดใช้/ซ่อนไลน์ไปทีหลัง)
 *
 * 🔴 ใบตรวจที่บันทึกแล้ว = **บันทึก** ไม่ใช่ใบที่ generate ใหม่ (กฎเดียวกับฟอร์มที่ยื่นออกไปแล้ว)
 *    ⇒ ต้องวาดจากคำตอบที่เก็บไว้ ไม่ใช่จากลิสต์คำถามปัจจุบัน ไม่งั้นใบเก่าหายไปเงียบๆ
 *    และตอน save ต้องเขียนกลับด้วย (ของเดิม delete-then-insert เฉพาะข้อที่ยังอยู่ = ลบทิ้งซ้ำรอบสอง)
 *
 * @param answers {Object} draft.answers — { [question_id]: { answer, note, text } }
 * @param liveQuestions {Array} คำถามที่เช็คลิสต์วันนี้ใช้อยู่
 */
export function savedOnlyAnswers(answers = {}, liveQuestions = []) {
  const live = new Set((liveQuestions || []).map(q => q?.id).filter(Boolean));
  return Object.entries(answers || {})
    .filter(([qid, a]) => qid && !live.has(qid) && a && (a.answer || a.note))
    .map(([qid, a]) => ({
      question_id: qid,
      question_text: String(a.text || '').trim(),
      answer: a.answer || '',
      note: a.note || '',
    }));
}
