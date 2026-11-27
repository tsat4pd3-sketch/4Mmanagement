/* ══ 🔌 "เครื่องนี้ใช้งานได้ไหม" — ตอบที่เดียว ═══════════════════════════  2026-11-19
   คำสั่ง user (18/11 · เคาะ 3 สถานะ 19/11):
   *"ใบแจ้งซ่อมที่แจ้งซ่อมเครื่องที่เป็น supply บางทีเค้าซ่อมไม่ได้ แต่แก้ไขเบื้องต้นให้ใช้ได้
     ระหว่างรอของมาเปลี่ยน · อยากมีปุ่มเปิดปิดเครื่อง เพื่อทำให้สถานะตรงกับหน้างาน"*

   ── ปัญหาที่แก้ (วัดจริง 19/11) ───────────────────────────────────────────────
   ผังโรงงานตัดสิน "ไลน์เสี่ยง" จาก **"เครื่อง supply นี้มีใบ MO เปิดอยู่ไหม"** อย่างเดียว
   ⇒ **"ใบยังเปิด" = "เครื่องใช้ไม่ได้"** ซึ่งไม่จริง · ของจริงวันนั้น:
     CT-03 (จ่าย 13 ไลน์) ซ่อมเสร็จ 13/11 08:44 · AB-01 13/11 11:38 · AB-02 13/11 11:42
     ทั้ง 3 ใบยังเปิด (รออะไหล่/รอเซ็น) ⇒ ผังทาไลน์ปลายทางเป็น "เสี่ยง" **7 วัน** ทั้งที่เครื่องเดินปกติ
     (AB-03 ยังไม่ซ่อมเสร็จจริง — อันนั้นควรแดง)

   ── 🔴 กฎของไฟล์นี้ ───────────────────────────────────────────────────────────
   1. **2 ชั้น · ของที่คนประกาศชนะของที่ระบบเดาเสมอ**
      ชั้น ① `machines.usability` = ช่างกดปุ่มประกาศเอง (ข้อเท็จจริงหน้างาน)
      ชั้น ② ยังไม่มีใครประกาศ → เดาจากใบซ่อมที่เปิดอยู่ (ดีกว่าเดาว่า "ใช้ได้")
   2. 🔴 **`null` ≠ `ok`** — ยังไม่มีใครประกาศ ไม่ใช่ "ยืนยันว่าใช้ได้" ⇒ ต้องถอยไปชั้น ②
      และ `source` ต้องบอกได้เสมอว่าคำตอบนี้มาจากไหน (จอต้องเขียนให้คนอ่านรู้)
   3. 🔴 **ใบที่ "ซ่อมเสร็จแล้วแต่ยังไม่ปิด" ไม่ใช่เครื่องเสีย** — นั่นคือลูปเอกสาร
      ⇒ ชั้น ② ดู `repair_done_at` ไม่ใช่แค่ "มีใบเปิด" (นี่คือจุดที่แก้บั๊ก 7 วัน)
   4. 🔴 **เหลือง/แดง ต้องมีเหตุผล** (CHECK ฝั่ง DB ด้วย) — ปุ่มที่กดดับไฟเตือนเปล่าๆ = สวิตช์โกหก
   5. 🔴 **กระพริบเฉพาะแดง · เหลืองนิ่ง** (Andon ของระบบ · UI-CONVENTIONS) ห้ามแต่งสีเอง  */

/* เส้นทางซ่อมที่ยังต้องรอของ — ทะเบียนเดียวกับปุ่มเส้นทางในใบ MO (ห้ามเทียบคีย์เองที่นี่) */
import { repairPathMeta } from './mtnPurchase.js'

/** 3 สถานะที่ช่างกดได้ — เรียงจากดีไปแย่ · สีใช้ token เท่านั้น */
export const MACHINE_USABILITY = Object.freeze([
  { key: 'ok',   label: 'ใช้ได้',            short: 'ใช้ได้',        color: 'var(--green)', blink: false, needNote: false },
  { key: 'temp', label: 'ใช้ได้ชั่วคราว',     short: 'ชั่วคราว',      color: 'var(--amber)', blink: false, needNote: true,
    hint: 'แก้เบื้องต้นแล้ว ใช้งานได้ระหว่างรอของมาเปลี่ยน' },
  { key: 'down', label: 'ใช้ไม่ได้',          short: 'ใช้ไม่ได้',     color: 'var(--red)',   blink: true,  needNote: true,
    hint: 'เครื่องหยุด ใช้งานไม่ได้' },
]);

export const usabilityMeta = (key) =>
  MACHINE_USABILITY.find(x => x.key === key) || MACHINE_USABILITY[0];

/** สถานะนี้ต้องกรอกเหตุผลไหม — `true` = ห้ามบันทึกถ้าไม่มีข้อความ */
export const usabilityNeedsNote = (key) => !!MACHINE_USABILITY.find(x => x.key === key)?.needNote;

const txt = (v) => String(v ?? '').trim();

/**
 * เครื่องนี้ใช้งานได้ไหม (คำตอบเดียวของทั้งระบบ)
 *
 * @param {object} machine แถวทะเบียนเครื่อง (`usability` · `usability_note` · `usability_at` · `usability_by`)
 * @param {object[]} openMos ใบ MO ที่ยังไม่ปิดของเครื่องนี้ — ต้องมี `repair_done_at` ด้วย
 *        **ไม่ส่งมา = ไม่รู้** ⇒ ถ้าช่างยังไม่ประกาศ จะตอบ `ok` พร้อม `source:'none'`
 * @returns {{ state:'ok'|'temp'|'down', source:'declared'|'mo'|'none',
 *             note:string, by:string, at:string|null, text:string }}
 */
export function machineUsability(machine, openMos = []) {
  /* ── ชั้น ① ช่างประกาศไว้ — ชนะเสมอ (กฎข้อ 1) ── */
  const declared = txt(machine?.usability);
  if (declared && MACHINE_USABILITY.some(x => x.key === declared)) {
    const m = usabilityMeta(declared);
    const note = txt(machine?.usability_note);
    const by = txt(machine?.usability_by);
    return {
      state: declared, source: 'declared', note, by, at: machine?.usability_at || null,
      text: [m.label, note || null, by ? `โดย ${by}` : null].filter(Boolean).join(' — '),
    };
  }

  /* ── ชั้น ② ยังไม่มีใครประกาศ → เดาจากใบซ่อมที่เปิดอยู่ (กฎข้อ 2-3) ── */
  const live = (openMos || []).filter(Boolean);
  /* 🔴 "ซ่อมเสร็จแล้วแต่ใบยังไม่ปิด" = ลูปเอกสาร ไม่ใช่เครื่องเสีย (บั๊ก 7 วันอยู่ตรงนี้) */
  const fixing = live.filter(o => !o.repair_done_at);
  if (fixing.length) {
    return {
      state: 'down', source: 'mo', note: '', by: '', at: null,
      text: `มีใบซ่อมที่ยังซ่อมไม่เสร็จ ${fixing.length} ใบ — ยังไม่มีใครกดยืนยันสถานะเครื่อง`,
    };
  }
  if (live.length) {
    /* ซ่อมเสร็จหมดแล้ว เหลือแต่เอกสาร ⇒ เครื่องใช้ได้ **แต่ต้องเขียนบนจอว่าใบยังไม่ปิด** */
    return {
      state: 'ok', source: 'mo', note: '', by: '', at: null,
      text: `ซ่อมเสร็จแล้ว (ใบ MO ยังไม่ปิด ${live.length} ใบ — รอเอกสาร ไม่ใช่เครื่องเสีย)`,
    };
  }
  return { state: 'ok', source: 'none', note: '', by: '', at: null, text: '' };
}

/**
 * ❓ **"ใบนี้ควร *ทวง* ให้กดยืนยันสถานะเครื่องไหม"** — 27/11 · คำสั่ง user
 *
 * *"ทำไมยังต้องมีให้กดยืนยัน เคสแบบนี้สเตปถึงรออนุมัติแล้ว …
 *   ที่จะขึ้นมาให้ยืนยันแค่เรื่องที่ซ่อมชั่วคราวรอ PR"*
 *
 * ของเดิมขึ้น "(ยังไม่มีใครกดยืนยัน)" **ทุกใบทุกขั้น** ⇒ ใบที่ซ่อมจบแล้วรอแค่ลายเซ็น
 * ก็ยังทวงให้ประกาศสถานะ ทั้งที่ไม่มีอะไรต้องประกาศ = ทวงจนคนเลิกสนใจ (คลาสเดียวกับกระดิ่งท่วม)
 *
 * 🔴 ทวงเฉพาะเคสที่ฟีเจอร์นี้ถูกสร้างมาเพื่อมันจริงๆ — **"แก้เบื้องต้นให้ใช้ได้ ระหว่างรอของมาเปลี่ยน"**
 *    = เส้นทางซ่อมที่ยังต้องรอของ (`needsPr`: ตัดอะไหล่แล้วเปิด PR · ส่งซ่อมนอก · รออะไหล่/Vendor)
 *    เคสพวกนี้ "เครื่องใช้ได้ไหม" **ตอบจากใบไม่ได้** ต้องให้คนหน้างานประกาศ
 * 🔴 **ประกาศไว้แล้ว = ไม่ทวง** (แต่แผงยังต้องโชว์ของที่ประกาศ + แก้ได้ — นั่นคือข้อเท็จจริง ห้ามซ่อน)
 * 🔴 **ไม่ทวง ≠ ปิดปุ่ม** — ช่างยังต้องตั้งสถานะเองได้ทุกเมื่อ (ยุบไว้ ไม่ใช่เอาออก)
 */
export function usabilityNeedsAsk(u, { repairPath } = {}) {
  if (!u || u.source === 'declared') return false;
  return !!repairPathMeta(repairPath)?.needsPr;
}

/** ค่าที่จะเขียนลงทะเบียน — คืน `null` เมื่อยังกรอกไม่ครบ (ผู้เรียกต้องไม่บันทึก) */
export function usabilityPatch(key, note, byName, now = Date.now()) {
  if (!MACHINE_USABILITY.some(x => x.key === key)) return null;
  const n = txt(note);
  if (usabilityNeedsNote(key) && !n) return null;          // กฎข้อ 4 — เหลือง/แดงต้องมีเหตุผล
  return {
    usability: key,
    usability_note: n || null,
    usability_by: txt(byName) || null,
    usability_at: new Date(now).toISOString(),
  };
}

export default { MACHINE_USABILITY, usabilityMeta, usabilityNeedsNote, machineUsability, usabilityPatch };
