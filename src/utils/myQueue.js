/* ═══════════════════════════════════════════════════════════════════════════
   📌 คิวงานของฉัน — "เปิดบัญชีตัวเองแล้วเห็นงานที่รออยู่"      2026-09-25 · คำสั่ง user

   *"เหมือน กดดูบัญชีตัวเองแล้วเห็นงานค้างที่รอเรา"*  +  *"ส่วนใหญ่จะเป็นรอแผนก"*

   ── ทำไมเป็น "ดึง" ไม่ใช่ "ยิง" ───────────────────────────────────────────────
   17/09 เคยลองเปิดผู้รับในแอปเพิ่ม 14 เรื่องแล้ว **ย้อนกลับ** (คำสั่ง user: ชะลอก่อน)
   เพราะห้องแชทกับกระดิ่งส่วนตัวไม่ใช่ช่องทางชนิดเดียวกัน — วัดจริง 25/09:
     กระดิ่ง **19,095 แถว/7 วัน** ถึง 92/94 บัญชี **อ่าน 7.3%**
     `mtn_checked` ใบเดียวเด้ง **31 คน** อ่าน **3%** · เรื่องใบซ่อมรวม = **74%** ของกระดิ่งทั้งระบบ
   ⇒ ไฟล์นี้คือฝั่งตรงข้าม: **ไม่ยิงอะไรเลย** คนเปิดดูเองเมื่ออยากรู้
     (ไม่มีแถวใหม่ · ไม่มี invocation ของ send-push · ไม่เพิ่ม egress ต่อเหตุการณ์)

   ── 🔴 บทเรียนที่ทำให้ไฟล์นี้แบ่ง 3 ชั้น (วัดจริง 25/09 ก่อนเขียน) ─────────────────
   สมมติฐานแรกคือ "ใบที่มีชื่อเราอยู่ = งานของเรา" — **ผิด**
     ใบซ่อมรอตรวจรับ 168 ใบ → ชื่อผู้ตรวจรับมีแค่ **10 ชื่อ · ส่วนงานเดียว**
     = คิวของแผนก ที่บังเอิญมีใครสักคนถูกพิมพ์ชื่อไว้ ไม่ใช่ภาระของคนนั้นคนเดียว
   ⇒ **"รอเรา" กับ "รอหน่วยงานเรา" ต้องแยกกันบนจอ** ความรู้สึกรับผิดชอบคนละระดับ
     และ **ตัวเลขบนไอคอนนับเฉพาะชั้นแรก** — ถ้านับรวมจะได้เลขหลักพัน (ใบขอซื้อค้าง 6,743
     รายการที่ระบบระเบิดความต้องการสร้างเอง) แล้ว**ไม่มีใครกดดูอีกเลย** = พังแบบเดียวกับกระดิ่ง

   ── ไฟล์นี้ pure ─────────────────────────────────────────────────────────────
   ห้าม import supabaseClient — ผู้เรียกโหลดแถวมาให้ แล้วที่นี่ตัดสินอย่างเดียว (เทสได้ตรงๆ)
   "ขั้นนี้รอใคร" อ่านจาก `stepMeta()` (mtnStepPerm.js) เท่านั้น — **ห้ามเขียน `step === 4`**
   (เลขขั้นคนละความหมายระหว่างฟอร์ม JIG/DIE กับ MTN — กฎเหล็กใน CLAUDE.md)
   ═══════════════════════════════════════════════════════════════════════════ */
import { personKey, normPersonName } from './actorStamp.js';
import { moPrBlocked } from './moChase.js';
import {
  canDoStep, moWaitMeta, offLoopWaitOf, approvalWaitsOnMe, sideAllows, STAGE_APPROVE_FIRST,
  canSignMtnApproval,
} from './mtnStepPerm.js';
/* 👥 ชื่อช่างที่มอบหมาย — ของกลางตัวเดียว รองรับทั้ง `assigned_techs` (array) และ `assigned_to`
   (สตริงคั่นจุลภาคที่ทำไว้ให้ใบพิมพ์/Excel/edge อ่าน) · **ห้ามเขียน `.split(',')` ซ้ำที่นี่** */
import { assignedTechsOf } from './mtnPurchase.js';
import { isMtnFormRow, isApprovalBlocked } from './mtnMoForm.js';
import { bkkDateStr } from './workDate.js';
import { binTagAge, ncStep } from './qualityBin.js';   // อายุแท็กถังเหลือง/แดง (WI-PD3-087 §5.6) — ห้ามเขียนเลขวันซ้ำที่นี่
import { tr } from './i18n.js';

/** 3 ชั้นของคิว — ชื่อชั้นใช้ร่วมกับจอ ห้ามพิมพ์สตริงเองในหน้า */
export const TIER = { MINE: 'mine', UNIT: 'unit', FLOOR: 'floor' };

/** แสดงกี่รายการต่อชั้นก่อน "ดูทั้งหมด" — เกินนี้ต้องบอกว่าซ่อนไปกี่รายการ ห้ามตัดเงียบ */
export const CAP = { [TIER.MINE]: 8, [TIER.UNIT]: 6, [TIER.FLOOR]: 6 };

/** เกินกี่วัน = แก่จนต้องติดธง (ใบซ่อมรอตรวจรับค้างเฉลี่ย 9.3 วันตอนวัด 25/09) */
export const OLD_DAYS = 7;

const norm = (s) => String(s ?? '').trim().toLowerCase();

/** วันที่ห่างจากวันนี้ — รับ 'YYYY-MM-DD' หรือ ISO · ค่าที่อ่านไม่ออกคืน null (ไม่ใช่ 0) */
/** วันที่ (YYYY-MM-DD ตามเวลาไทย) ย้อนหลังไป `days` วันจาก `now` — ใช้ส่ง `from=` ให้หน้าปลายทาง
 *  🔴 ต้องไม่พึ่ง timezone ของเครื่อง ⇒ ผ่านของกลาง `bkkDateStr()` (`workDate.js`)
 *     ซึ่งเลื่อน epoch +7 ชม. แล้วอ่านฝั่ง UTC — หลักเดียวกับ `bkkHourKey` */
export function dayKeyBack(days, now = new Date()) {
  return bkkDateStr(now.getTime() - (Number(days) || 0) * 86400000);
}

export function ageDays(dateLike, now = new Date()) {
  if (!dateLike) return null;
  const t = new Date(typeof dateLike === 'string' && dateLike.length === 10
    ? `${dateLike}T00:00:00` : dateLike);
  if (Number.isNaN(t.getTime())) return null;
  const d = Math.floor((now - t) / 86400000);
  return d < 0 ? 0 : d;
}

/**
 * คนคนนี้คือเราหรือเปล่า — **uid ชนะชื่อเสมอ**
 * ไม่มีทั้ง uid และชื่อ → `false` (ไม่รู้ ≠ ใช่ — ห้ามตีว่าเป็นของเรา)
 */
export function isMe({ uid, name }, me) {
  if (uid && me?.uid) return norm(uid) === norm(me.uid);
  const a = personKey(null, name);
  const b = personKey(null, me?.name);
  return !!a && a === b;
}

/**
 * ใบนี้ "รอเรา" ไหม เมื่อขั้นนั้นอาจมีคนรอหลายคน — OR รายคนผ่าน `isMe`
 *
 * 🔴 **ห้ามยุบเป็นสตริงเดียวแล้วเทียบ** — `assigned_to` เก็บชื่อต่อกันด้วยจุลภาคไว้ให้ใบพิมพ์อ่าน
 *    เทียบชื่อเดี่ยวกับ `"ก, ข"` ไม่เคยตรงกับใครเลย · วัดจริง 13/11: ใบขั้น 3 ที่เปิดอยู่ 32 ใบ
 *    **มอบหมาย ≥2 คน 21 ใบ (66%)** และ `tech_main_uid` ว่างทั้ง 32 ใบ ⇒ ทางเทียบ uid ตายด้วย
 *    ⇒ ใบไม่ขึ้นในคิว "รอคุณ" ของช่างคนไหนเลย (ค้าง ≥7 วัน 15 ใบ · เก่าสุด 66 วัน)
 * 🔴 **ห้ามแก้ `isMe` ให้ชื่อสู้ uid ได้** — กฎ "uid ชนะชื่อ" ถูกแล้วในระดับ *คนคนหนึ่ง*
 *    (ชื่อซ้ำกัน 2 คนในโรงงานเป็นเรื่องปกติ) ⇒ ความเป็น "หลายคน" ต้องอยู่ที่ชั้นนี้เท่านั้น
 * ไม่มีรายชื่อเลย = ถอยไปใช้ `who` ตัวเดียว (พฤติกรรมเดิมเป๊ะ)
 */
export function isMeAmong(w, me) {
  const list = Array.isArray(w?.people) && w.people.length
    ? w.people
    : (w?.who ? [w.who] : []);
  return list.some(p => p && isMe(p, me));
}

/** คนที่ "ฝั่งผู้แจ้ง" ของใบนี้ยึดเป็นเจ้าภาพ — ใช้ร่วมกันระหว่างขั้น byReporter กับใบนอกลูปขั้น */
const reporterWho = (o) => ({
  uid: o?.reporter_prod_uid || o?.reported_by_uid || null,
  name: o?.reporter_prod || o?.reported_by_name || null,
});

/**
 * ใบ MO ใบนี้กำลังรอใคร — คืน `{ step, meta, who, byName, people? }`
 *   who    = { uid, name } ของคนที่ขั้นนี้รอ (รู้ตัวคน) · `null` = รอ "ตำแหน่ง" ไม่ใช่ตัวคน
 *            **ตัวที่เอาไปโชว์/ทำป้าย** — ใบที่มอบหมายหลายคนจะเป็นชื่อต่อกันเหมือนที่เก็บใน DB
 *   people = ทุกคนที่ขั้นนี้รอ (ใบมอบหมายหลายช่าง) — **ใช้เทียบตัวตนเท่านั้น** ผ่าน `isMeAmong()`
 *            ไม่มี key นี้ = ถอยไปเทียบ `who` ตัวเดียว (พฤติกรรมเดิม)
 *   byName = true แปลว่าขั้นนี้ผูกกับตัวบุคคลจริง (ผู้เปิดใบ / ช่างที่รับงาน)
 *   step   = `null` สำหรับใบนอกลูปขั้น (ตีกลับ/ส่งซ่อมนอก) — **ห้ามแปลงเป็น 0** (0 = ขั้นจริง)
 *
 * 🔴 ไม่เดาเลขขั้นเอง — `stepMeta()` เป็นคนบอกว่าขั้นนี้ `byReporter` หรือ `stage === 'service'`
 * 🔴 ขั้นที่ "รอ" มาจาก `nextStepOf()` (ตัดสินจาก status) — **ห้ามอ่าน `current_step` ตรงๆ**
 *    current_step = ขั้นที่ทำเสร็จแล้ว ⇒ เดิมช้าไป 1 ขั้นทุกใบ (workflow audit 05/10: ใบรอ QA 204 ใบ
 *    ไปโผล่เป็น "ตรวจรับงาน" ที่ผู้แจ้งซึ่งเซ็นไปแล้ว · QA ไม่เห็นในคิวเลย)
 */
export function moWaitingOn(o = {}) {
  /* 🔴 "รออะไร" ถามที่ `moWaitMeta()` ที่เดียว — **ห้ามเรียก `nextStepOf()` เองที่นี่อีก**
     ด่านอนุมัติก่อนเริ่มงานไม่มีเลขขั้น (step = null) ถ้าถามจากเลขขั้นจะได้ "รอช่างรับงาน"
     ทั้งที่ช่างกดรับไม่ได้ ⇒ ใบหายเข้ากองของคนอื่น (13/10 · คำสั่ง user) */
  const { step, meta } = moWaitMeta(o);
  /* ↩️📤 ใบนอกลูปขั้น (ตีกลับ / ส่งซ่อมนอก) — `moWaitMeta` คืน meta ว่างโดยเจตนา (ดู `OFF_LOOP_WAIT`)
     🔴 เดิมบรรทัดนี้ตัดทิ้งพร้อมคอมเมนต์ "ใบยังไม่เข้าลูป (ขั้น 1)" ซึ่ง **ไม่จริงสำหรับใบตีกลับ**
        — ใบตีกลับรอผู้แจ้งแก้แผนกแล้วส่งใหม่ (status ขั้น 1 แต่เป็น "งานที่รอคนจริง")
        ⇒ ใบหลุดจากทั้ง 3 ชั้น + badge · วัดจริง 13/11: 9 ใบ เก่าสุด 52 วัน ไม่โผล่ในคิวใครเลย */
  if (!meta) {
    const off = offLoopWaitOf(o);
    if (!off) return { step: step ?? 0, meta: null, who: null, byName: false };
    return off.meta.byReporter
      ? { step: null, meta: off.meta, byName: true, who: reporterWho(o) }
      : { step: null, meta: off.meta, byName: false, who: null };
  }

  if (meta.byReporter) return { step, meta, byName: true, who: reporterWho(o) };
  if (meta.stage === 'service') {
    /* 👥 มอบหมายช่างได้หลายคน (14/10) ⇒ "รอเรา" ต้องเทียบ **ทุกคนในชุด** ไม่ใช่สตริงที่ต่อกันแล้ว
       🔴 `who` คงรูปเดิมเป๊ะ (ตัวที่เอาไปโชว์/ทำป้าย) — เพิ่มแค่ `people` ที่ใช้เทียบตัวตน
          ⇒ **หน้าจอไม่เปลี่ยนแม้พิกเซลเดียว** เปลี่ยนแค่ว่าใบตกถึงใคร (เหตุผลเต็มที่ `isMeAmong`) */
    const who = { uid: o.tech_main_uid || null, name: o.assigned_to || o.tech_main || null };
    const people = [];
    // uid ของช่างหลัก (ถ้ามี) เป็นรายการของตัวเอง — ไม่ผูกกับชื่อลำดับใดในลิสต์ (ไม่มีอะไรรับประกันลำดับ)
    if (o.tech_main_uid) people.push({ uid: o.tech_main_uid, name: o.tech_main || null });
    for (const name of assignedTechsOf(o)) people.push({ uid: null, name });
    return { step, meta, byName: true, who, people: people.length ? people : [who] };
  }
  // ขั้นที่รอ "ตำแหน่ง" (จ่ายงาน / QA / หัวหน้าแผนก / ผจก.) — ไม่มีชื่อเจาะจง
  return { step, meta, who: null, byName: false };
}

/* ── แถวนี้ตกขอบเขตเพราะอะไร ────────────────────────────────────────  2026-10-06
   🔴 "ของหน่วยอื่น" กับ "ใบไม่ระบุส่วนงาน" **คนละเรื่อง ห้ามยุบเป็น false เดียว**
      ของหน่วยอื่น = ถูกแล้วที่ไม่เห็น · ใบไม่ระบุส่วนงาน = **ไม่มีใครเห็นเลยทั้งโรงงาน**
      (วัดจริง 06/10: ใบรอ QA 188 ใบ — 152 ใบผูก PD3 แต่ **36 ใบ `dept_section` ว่าง**
       ⇒ ตกจากคิวของทุกคนเงียบๆ ไม่มีใครรู้ว่ามีอยู่) ⇒ ต้องนับแล้วให้จอเขียนบอก
   คืน 'in' อยู่ในขอบเขต · 'other' ของหน่วยอื่น · 'unknown' แถวไม่ระบุส่วนงาน */
export function scopeStateOf(row, me) {
  const secs = Array.isArray(me?.sections) ? me.sections.filter(Boolean) : [];
  if (!secs.length) return 'in';                    // ไม่จำกัด = เห็นทุกส่วนงาน
  const s = norm(row?.dept_section || row?.section);
  if (!s) return 'unknown';                         // แถวไม่ระบุส่วนงาน = ตอบไม่ได้ว่าของเรา
  return secs.some(x => norm(x) === s) ? 'in' : 'other';
}

/** แถวนี้อยู่ในขอบเขตของเราไหม — `sections: []` = ไม่จำกัด (เห็นทุกส่วนงาน)
 *  ⚠️ พฤติกรรมเหมือนเดิมเป๊ะ (แถวไม่ระบุส่วนงาน = false) — แค่ยืมคำตอบจาก `scopeStateOf` จุดเดียว */
export const inMyScope = (row, me) => scopeStateOf(row, me) === 'in';

/**
 * ✍️ **"ใบนี้รอ *เรา* เซ็นรับทราบ (ผจก.ต้นสังกัด) ไหม"** — เจ้าของกฎที่เดียว
 *
 * 🔴 23/11 (หน้างานแจ้ง): *"แจ้งเตือนที่ 2 บอกมีรอ 1 ใบ กดเข้ามาเจอ 4 ใบ และเป็นใบถูกตีกลับ/รอยกเลิก"*
 *    ต้นเหตุ: ป้ายในคิวนับด้วยกฎ 5 ข้อ (ฟอร์ม MTN · ยังไม่เซ็น · ไม่ใช่ใบที่ลายเซ็นบล็อกงาน ·
 *    อยู่ในขอบเขตเรา · เราเซ็นได้จริง) แต่ **ตัวกรอง `?ack=pending` ในหน้า MO เช็คแค่ 2 ข้อแรก**
 *    ⇒ กดจากป้ายแล้วเจอใบที่ไม่ใช่ของเรา/เซ็นไม่ได้/ใบตีกลับ ปนมาด้วย
 *    **ป้ายกับลิสต์ที่ป้ายพาไป ต้องใช้กฎเดียวกันเสมอ** — ไม่งั้นเลขไม่ตรงและคนเลิกเชื่อป้าย
 * 🔴 ห้ามเขียนเงื่อนไขชุดนี้ซ้ำในหน้า (มีด่าน `ack-queue-single-rule`)
 */
export function ackWaitsOnMe(o, me = {}) {
  if (!o || !isMtnFormRow(o) || o.dept_manager_at) return false;
  if (isApprovalBlocked(o)) return false;          // ใบที่ลายเซ็นนี้บล็อกงานจริง = ขึ้นเป็นรายการของตัวเองแล้ว
  if (scopeStateOf(o, me) !== 'in') return false;  // ผจก.เห็นเฉพาะใบของส่วนงานตัวเอง
  return canSignMtnApproval('dept', {
    order: o, fullName: me.name || '', can: me.can || (() => false), isShared: !!me.isShared,
  }).ok;
}

/**
 * ✍️ **"ใบนี้รอ *เรา* เซ็น (ขั้นที่ล็อกตำแหน่ง) ไหม"** — เจ้าของกฎที่เดียว
 *
 * 🔴 27/11 (หน้างานแจ้ง): *"ทำไมแจ้งเตือนงานที่รออนุมัติ พอกดเข้ามายังเจองานที่ยังติด loop PR อยู่
 *    มันยังอนุมัติไม่ได้นิ"*
 *    ต้นเหตุ: ป้าย "รอคุณเซ็น N ใบ" นับถูกแล้ว (ตัดใบที่ติดลูป PR ออกตั้งแต่ 23/11)
 *    **แต่ลิงก์ของป้ายพาไป `?wait=<stage>`** ซึ่งแปลว่า "ใบที่ค้างอยู่ขั้นนี้" เฉยๆ
 *    ⇒ ไม่รู้จักทั้งกฎ "รอเราจริง" และกฎ PR ⇒ ป้ายบอก 4 กดเข้าไปเจอ 14 ปนใบที่กดไม่ได้
 *    **คลาสเดียวกับ `ackWaitsOnMe` (23/11) เป๊ะ — ป้ายกับลิสต์ที่ป้ายพาไป ต้องใช้กฎเดียวกันเสมอ**
 * 🔴 `prs` = ใบขอซื้อของใบนี้ · **`null` = ไม่รู้ ⇒ ไม่ตัดทิ้ง** (พฤติกรรมเดิมเป๊ะ)
 * 🔴 `stage` ใส่มาเพื่อกรองเฉพาะขั้นนั้น (ป้ายแยกบรรทัดต่อขั้น) · ไม่ใส่ = ทุกขั้นที่รอเรา
 * 🔴 ห้ามเขียนเงื่อนไขชุดนี้ซ้ำในหน้า (ด่าน `sign-queue-single-rule`)
 */
export function signWaitsOnMe(o, me = {}, prs = null, stage = null) {
  if (!o) return false;
  const w = moWaitingOn(o);
  if (!w?.meta || w.byName) return false;
  if (stage && (w.meta.stage || `step${w.step}`) !== stage) return false;
  if (!soleSignerFor(o, w, me)) return false;
  if (scopeStateOf(o, me) !== 'in') return false;
  return !moPrBlocked(o, prs);
}

/* ── ขั้นที่ "ตำแหน่งเดียวเซ็นได้" — นับเป็นงานรอคุณ (2026-10-13 · คำสั่ง user) ──────────────
   *"อย่างอนุมัติ MO สำหรับช่องที่คนเซ็นคือ ผู้จัดการฝ่ายผู้แจ้ง ต้องอนุมัติและอนุมัติได้คนเดียว
     ก็ต้องเตือนแค่ user นั้น และสำคัญกว่าแจ้งเตือนอื่นๆ ของหน่วยงาน"*
   ⇒ ขั้นที่ **ล็อกตำแหน่ง** (`meta.minRank` มีค่า · ไม่ใช่ขั้นผู้เปิดใบ) เช่น ผจก.ฝ่ายผู้แจ้งปิดใบ ·
     ผจก.ซ่อมบำรุง = เข้าชั้น `mine` **เฉพาะคนที่เซ็นช่องนั้นได้จริง** (ติดธง `sign` + ขึ้นก่อนทุกรายการ)
   · ตัดสินด้วย `canDoStep()` **ตัวเดียวกับปุ่มเซ็นในหน้า /mtn-repair** — ห้ามเขียนเกณฑ์ใหม่
   · 🔴 **ต้องรู้ฝั่งและตำแหน่งจริง** (`actorSide`/`posRank` จากโปรไฟล์) — ไม่รู้ = ไม่นับ (ไม่รู้ ≠ ใช่)
     และ **ไม่นับสิทธิ์ `manage_master`** (หัวหน้าระบบแก้ย้อนหลังได้ทุกขั้น ≠ คนที่ช่องนี้รอ)
     ไม่งั้น admin จะได้ใบรออนุมัติทั้งโรงงานเป็น "รอคุณ" = badge เลขสูงค้างถาวร (ซ้ำรอยกระดิ่งเดิม)
   · ขั้นที่หลายคนถือสิทธิ์ได้ (QA · จ่ายงาน — ไม่มี minRank) ยังเป็นคิวหน่วยงานตามเดิม */
export function soleSignerFor(o, w, me = {}) {
  const m = w?.meta;
  if (!m || w.byName || m.minRank == null) return false;
  /* 🔒 ด่านอนุมัติก่อนเริ่มงาน = ช่องลายเซ็นนอกลำดับขั้น (ไม่มี `step` ให้ `canDoStep` ตัดสิน)
     ⇒ เกณฑ์ผู้เซ็นอยู่ที่ `approvalWaitsOnMe()` (mtnStepPerm.js) — กติกาเดียวกับข้างล่างทุกข้อ */
  if (m.stage === STAGE_APPROVE_FIRST) return approvalWaitsOnMe(o, me);
  /* 🔴 ไม่รู้ฝั่ง = ไม่นับ (ต่างจาก canDoStep ที่ "ไม่รู้ = ไม่บล็อก" โดยตั้งใจ — ที่นั่นตอบว่า
     "กดได้ไหม" ที่นี่ตอบว่า "ใบนี้รอคุณอยู่จริงไหม" ซึ่งต้องแน่ใจกว่า) · 'both' = ทีม AM ผ่านได้ */
  if (!me.actorSide || me.actorSide === 'unknown' || !sideAllows(me.actorSide, m.side)) return false;
  if (me.posRank == null || me.posRank < m.minRank) return false;
  /* 🔴 ตัด `manage_master` ออกจาก can() ตอนถาม — **ไม่ใช่** ตอนอ่านคำตอบ (แก้ 2026-10-16)
     เดิมอ่านคำตอบแล้วทิ้ง code 'manage_master' ⇒ ผจก.ที่เป็น "คนที่ช่องนี้รออยู่จริง" ถูกตัดทิ้งไปด้วย
     เพราะ canDoStep คืน 'manage_master' ตั้งแต่บรรทัดแรกก่อนจะไปถึงด่านสิทธิ์ของขั้นนั้น
     (วัดจริง 16/10: ผจก.ฝ่ายผลิตทั้ง 4 คน ไม่เคยเห็นใบ "รออนุมัติปิด" ในคิวตัวเองเลย)
     ⇒ ถามใหม่โดยปิดคีย์หัวหน้า = ได้คำตอบว่า "ถ้าไม่มีคีย์หัวหน้า คนนี้ยังเซ็นช่องนี้ได้ไหม"
     เจตนาเดิมยังอยู่ครบ: คนที่ถือ **แค่** `manage_master` (admin) ยังไม่เข้าคิว */
  const canNoBoss = (a) => a !== 'manage_master' && !!(me.can || (() => false))(a);
  const r = canDoStep(w.step, {
    order: o, fullName: me.name || '', can: canNoBoss, seeded: me.seeded || (() => true),
    inOrderTeam: typeof me.inTeam === 'function' ? !!me.inTeam(o) : false,
    hasTeams: !!me.hasTeams, mtnForm: isMtnFormRow(o),
    actorSide: me.actorSide, posRank: me.posRank, isShared: !!me.isShared,
  });
  return !!r.ok && (r.code === 'perm' || r.code === 'fallback');
}

/* ── ตัวแปลงแถวดิบ → รายการบนจอ ─────────────────────────────────────────────
   ทุกตัวคืนรูปเดียวกัน: { key, icon, title, detail, age, tier, tag, to }
   `to` = ลิงก์ที่**พาไปถึงใบนั้นจริง** (ไม่ใช่หน้ารวม) — คนกดแล้วต้องทำงานต่อได้ทันที */

function moItem(o, w, tier) {
  const age = ageDays(o.work_date);
  return {
    key: `mo:${o.id}`,
    icon: w.meta?.icon || '🔧',
    title: `${o.mo_no || 'ใบซ่อม'} — ${w.meta?.title || `ขั้น ${w.step}`}`,
    detail: [o.line_name, o.machine_no].filter(Boolean).join(' · ') || o.dept_section || '',
    age, tier,
    tag: tier === TIER.MINE ? null : (w.meta?.whoShort || null),
    to: `/mtn-repair?mo=${encodeURIComponent(o.id)}`,   // MtnRepair อ่าน `?mo=` แล้วเปิด drawer ของใบนั้นให้
  };
}

/**
 * ประกอบคิวจากแถวที่ผู้เรียกโหลดมา
 *
 * @param {object} src  แถวดิบ — ขาดก้อนไหนให้ส่ง `undefined` **ห้ามส่ง []** (ดู `missing`)
 * @param {object} me   { uid, name, sections, actorSide?, posRank?, can?, seeded?, inTeam?, hasTeams? }
 *                      (4 ตัวหลัง = เกณฑ์ช่องเซ็นตามตำแหน่ง · ไม่ส่ง = ไม่มีใบรอเซ็นเข้า `mine` ตามเดิม)
 * @returns {{ mine, unit, floor, counts, missing, partial }}
 *
 * 🔴 `missing` = ก้อนที่โหลดไม่สำเร็จ ⇒ `partial === true` ⇒ **จอต้องเขียนว่าตัวเลขไม่ครบ**
 *    (กฎ "ห้ามล้มเหลวเงียบ" — จอที่ขึ้น "ไม่มีงานค้าง" ทั้งที่คิวรีล่ม คือจอโกหก)
 */
export function buildQueue(src = {}, me = {}, now = new Date()) {
  const mine = []; const unit = []; const floor = [];
  const missing = [];
  const need = (k, v) => { if (v === undefined || v === null) { missing.push(k); return []; } return v; };
  /* 🔴 ตัวโหลดชนเพดานแถว = "โหลดไม่ครบ" เหมือนคิวรีล่ม ⇒ ต้องติด `partial` ให้จอเขียนบอก (22/10)
     เคสจริง: ใบ MO เปิดอยู่ 693 ใบ แต่คิวโหลด 300 ใบเก่าสุด ⇒ ใบใหม่ 393 ใบหายจากคิวทุกคนเงียบๆ
     แล้วแผงยืนยันว่า "ไม่มีงานที่รอคุณอยู่" ทั้งที่ ผจก.ฝ่ายที่แจ้งมี 51 ใบรออนุมัติปิด
     ⚠️ ตัดเงียบแย่กว่าตัวเลขไม่ครบ — badgeCount() คืน 0 ตอน partial อยู่แล้ว (ไม่หลอกว่ามีงานน้อย) */
  if (src?.moTruncated) missing.push('mo_truncated');
  /* 🔴 คิวถังเหลืองชนเพดานของตัวโหลด = ตัวเลขต่ำกว่าจริง ⇒ จอต้องเขียนบอกว่าไม่ครบ (09/11) */
  if (src?.binsTruncated) missing.push('bins_truncated');
  /* 🔴 แถวที่ "ชี้ส่วนงานไม่ได้" — ตกจากคิวของทุกคน ⇒ ต้องนับไว้ให้จอเขียนบอก ห้ามหายเงียบ */
  let unattributed = 0;
  const keep = (row) => {
    const st = scopeStateOf(row, me);
    if (st === 'unknown') { unattributed += 1; return false; }
    return st === 'in';
  };

  /* 🔴 ขั้นที่ "รอตำแหน่ง" (QA · จ่ายงาน · หัวหน้าแผนก · ผจก.) ไม่มีเจ้าภาพรายใบ (2026-10-06)
     ⇒ เข้าชั้น `mine` ไม่ได้ (ไม่ได้รอ "เรา" เป็นตัวบุคคล) และกฎ badge นับเฉพาะ `mine`
     ⇒ **ไม่มีสัญญาณเลยว่ามีงานค้าง** · วัดจริง 06/10: รอ QA 188 ใบ (ค้างเกิน 7 วัน 169) ไม่มีใครเห็นตัวเลข
     ⇒ สรุปเป็น **บรรทัดเดียวต่อขั้น ในชั้น `floor`** (ของทั้งโรงงานที่ไม่มีเจ้าภาพ — กติกาเดิมของชั้นนี้)
     🔴 **ห้ามแตกรายตัวในชั้นนี้ · ห้ามให้ขึ้น badge** (ยัดเข้า `mine` = badge เลขสูงค้างถาวรกับคนหลายคน
        = ซ้ำรอยกระดิ่งเดิมที่วัดได้ 19,095 แถว/7 วัน อ่าน 7.3%)
     · นับ **ทั้งโรงงาน ไม่กรองขอบเขต** (ตอบคำถาม "กองนี้ใหญ่แค่ไหน") — ใบของหน่วยเราเองยังโชว์รายตัว
       ในชั้น `unit` ตามเดิม ⇒ 2 ชั้นตอบคนละคำถาม ไม่ใช่ตัวเลขซ้อนกัน */
  /* 🔴 คีย์ด้วย **`meta.stage` ไม่ใช่เลขขั้น** — เลขขั้นเดียวกันคนละความหมายระหว่าง 2 ฟอร์ม
     (ขั้น 5 = QA ของ JIG/DIE แต่ = รับมอบ ของ MTN · กฎ `stageOf` ใน CLAUDE.md)
     คีย์ด้วยเลขขั้น = 2 กองยุบเป็นบรรทัดเดียว แล้วใบ MTN ที่รอรับมอบถูกป้ายว่า "รอ QA"
     (เกิดจริงในคอมมิทแรกของฟีเจอร์นี้ 06/10 — เทสด้านล่างกันไว้แล้ว) */
  const byPos = new Map();   // `stage` → { stage, step, meta, count, oldest }
  const signByStage = new Map();   // `stage` → ใบที่ "รอเราเซ็น" ของขั้นนั้น (ทำป้ายคาไว้)
  /* ✍️ ช่อง "ผจก.ต้นสังกัดรับทราบ" ของใบ MTN — **ไม่บล็อกงาน แต่ต้องเซ็น** (24/10 · คำสั่ง user)
     🔴 ช่องนี้อยู่ **นอกลำดับขั้น** ⇒ `moWaitMeta()` คืนด่านอนุมัติเฉพาะตอน `isApprovalBlocked()`
        (= งานปรับปรุง/สร้างเท่านั้น) ⇒ ใบซ่อมปกติ **ช่องนี้ไม่โผล่ในจอไหนเลย** ไม่มีใครรู้ว่าค้าง
     วัดจริง 24/10: ใบทีม MTN 61 ใบ — **ผจก.ยังไม่เซ็น 52 ใบ (85%)** · เดินข้ามขั้น 2 ไปแล้ว 49 ใบ
     · **ปิดใบไปแล้วทั้งที่ช่องว่าง 10 ใบ** (เอกสารควบคุมที่ลายเซ็นไม่ครบ)
     ⇒ นับแยกเป็นป้ายของตัวเอง ไม่ยุ่งกับ "ขั้นที่ใบรออยู่" (ใบไม่ได้รอช่องนี้ — งานเดินต่อได้) */
  let ackCount = 0; let ackOldest = null;

  /* ── 🔢 ยอดจริงของแต่ละกอง — แยกชุดข้อมูลออกจากชุดที่เอาไปวาดรายการ (2026-10-22) ──────────
     ที่มา (คำสั่ง user หลังตรวจงาน QA 21/10): บรรทัดสรุปชั้น `floor` เคยนับจาก `src.mo` ซึ่งผู้เรียก
     ตัดมาแค่ 300 แถวแรก (เรียงวันที่เก่าสุด) ⇒ วัดจริง 22/10: ใบเปิดค้าง 672 ใบ · หน้าต่างจบที่ 08/10
     **ใบรอ QA จริง 92 ใบ แต่แผงนับได้ 26** และจอไม่เคยบอกว่านับไม่ครบ
     ⇒ ผู้เรียกส่ง `moAll` = แถวคอลัมน์บาง **ทั้งหมด** มาให้นับกองโดยเฉพาะ (รายการยังวาดจาก `mo` เหมือนเดิม)
     🔴 ไม่ส่ง `moAll` = ถอยไปนับจาก `mo` แบบเดิมเป๊ะ แต่ต้องติดธง `countsCapped` ให้จอเขียนบอก
        (ห้ามเงียบ — กฎ "โหลดไม่ครบต้องเขียนบนจอ" ในหัวไฟล์ MyQueuePanel)
     ⚠️ ชุดนับต้องผ่าน `moWaitMeta()` ตัวเดียวกับรายการ — ห้ามนับด้วย `status` ดิบ
        (ขั้นที่รออยู่ขึ้นกับฟอร์ม/ด่านอนุมัติด้วย ไม่ใช่สถานะอย่างเดียว) */
  const moForCount = src.moAll ?? src.mo ?? [];   // ก้อนที่โหลดไม่ได้ ติด partial ที่ need('mo') ข้างล่างอยู่แล้ว
  const countsCapped = !src.moAll || !!src.moAllCapped;

  for (const o of moForCount) {
    const w = moWaitingOn(o);
    /* รอคนระบุชื่อ = ไม่ใช่กองของ "ตำแหน่ง"
       🔴 ใบนอกลูปขั้นก็ไม่เข้ากองนี้ — บรรทัดสรุปชั้น `floor` ลิงก์ไป `?wait=<stage>` ของหน้า MO
          ซึ่งรู้จักแต่ stage ของลูปขั้น ⇒ ยัดเข้ามา = กดแล้วได้ลิสต์ว่าง = จอโกหก (ใบพวกนี้
          ขึ้นรายตัวในชั้น `mine`/`unit` อยู่แล้ว) */
    if (!w.meta || w.byName || w.meta.offLoop) continue;
    const sk = w.meta.stage || `step${w.step}`;
    const cur = byPos.get(sk) || { stage: sk, step: w.step, meta: w.meta, count: 0, oldest: null };
    cur.count += 1;
    const age = ageDays(o.work_date, now);
    if (age != null && (cur.oldest == null || age > cur.oldest)) cur.oldest = age;
    byPos.set(sk, cur);
  }

  // ── ใบซ่อม MO (ชุดที่เอาไปวาดรายการ) ──────────────────────────────────────
  for (const o of need('mo', src.mo)) {
    /* ✍️ นับช่องรับทราบก่อนด่าน `!w.meta` — ใบที่ปิดแล้วก็ยังค้างช่องนี้ได้ (10 ใบ · ย้อนเซ็นได้)
       เกณฑ์ผู้เซ็น = `canSignMtnApproval()` **ตัวเดียวกับปุ่มในใบ** ⇒ ขึ้นในคิว = กดเซ็นได้จริง
       + ต้องอยู่ในขอบเขตเรา ⇒ ผจก.เห็นเฉพาะใบของส่วนงานตัวเอง (แบบ ก · คำสั่ง user 24/10) */
    /* 🔴 ใบที่ลายเซ็นนี้ **บล็อกงานจริง** (งานปรับปรุง/สร้าง) ไม่เข้าป้ายนี้ — มันขึ้นเป็นรายการ
       ของตัวเองอยู่แล้วผ่าน moWaitMeta/approvalWaitsOnMe · นับซ้ำ = badge เกินจริง
       และป้ายนี้เขียนว่า "ไม่บล็อกงาน" ซึ่งจะกลายเป็นคำโกหกสำหรับใบที่บล็อกอยู่ */
    if (ackWaitsOnMe(o, me)) {
      ackCount += 1;
      const aAge = ageDays(o.work_date, now);
      if (aAge != null && (ackOldest == null || aAge > ackOldest)) ackOldest = aAge;
    }
    const w = moWaitingOn(o);
    // ไม่มี meta = ไม่มีใครต้องทำต่อจริงๆ (ใบปิด/ยกเลิก) — ใบนอกลูปขั้นมี meta ของตัวเองแล้ว (16/11)
    if (!w.meta) continue;
    if (w.byName && isMeAmong(w, me)) { mine.push(moItem(o, w, TIER.MINE)); continue; }
    // ขั้นล็อกตำแหน่งที่เราเซ็นได้คนเดียว (ในขอบเขตเรา) ⇒ รอคุณ + ขึ้นก่อน (soleSignerFor ข้างบน)
    /* 🛒 23/11 (หน้างาน: *"รอเรา 7 ใบ แต่เป็นใบอยู่ loop pr ซึ่งมันไม่ได้รอเราไง"*)
       ใบที่ลูปจัดซื้อยังไม่จบ = **กดอนุมัติไม่ได้จริง** (ด่าน `moCloseGate` บล็อกตอนกด)
       ⇒ ห้ามนับเป็น "รอคุณเซ็น" · คนที่ต้องลงมือคือช่าง/จัดซื้อ ไม่ใช่ ผจก.
       🔴 ใช้ `moPrBlocked()` ตัวเดียวกับป้ายสถานะในหน้า MO — ห้ามเทียบ PR เองที่นี่
       🔴 ไม่ได้ส่ง `prOf` มา (ผู้เรียกไม่มีข้อมูล PR) = พฤติกรรมเดิมเป๊ะ ไม่ตัดอะไรทิ้ง */
    /* 🔴 ใช้ `signWaitsOnMe()` ตัวเดียวกับตัวกรอง `?sign=` ในหน้า MO — ห้ามเขียนเงื่อนไขซ้ำที่นี่
       (27/11: ป้ายกับลิสต์ที่ป้ายพาไปเคยใช้คนละกฎ ⇒ ป้ายบอก 4 กดเข้าไปเจอ 14) */
    if (signWaitsOnMe(o, me, src.prOf ? src.prOf(o) : null)) {
      mine.push({ ...moItem(o, w, TIER.MINE), sign: true, tag: '✍️ รอคุณเซ็น' });
      /* สะสมไว้ทำ "ป้ายคาไว้" บรรทัดเดียวต่อขั้น (คำสั่ง user 22/10) — ดู signRollup ข้างล่าง */
      const sk = w.meta.stage || `step${w.step}`;
      const cur = signByStage.get(sk) || { stage: sk, meta: w.meta, count: 0, oldest: null };
      cur.count += 1;
      const sAge = ageDays(o.work_date, now);
      if (sAge != null && (cur.oldest == null || sAge > cur.oldest)) cur.oldest = sAge;
      signByStage.set(sk, cur);
      continue;
    }
    /* กองของ "ตำแหน่ง" นับไปแล้วในลูปข้างบน (ชุด moAll) — ที่นี่เหลือแค่รายการของหน่วยเรา */
    if (keep(o)) unit.push(moItem(o, w, TIER.UNIT));
  }

  // ── กะที่ขอปิด รอหัวหน้าอนุมัติ ────────────────────────────────────────────
  for (const s of need('sessions', src.sessions)) {
    if (!keep(s)) continue;
    unit.push({
      key: `ses:${s.id}`, icon: '📋', tier: TIER.UNIT,
      title: `คำขอปิดกะ — ${s.line_name || '-'}`,
      detail: s.shift === 'night' ? 'กะดึก' : tr("กะเช้า"),
      age: ageDays(s.work_date, now), tag: 'รอหัวหน้าอนุมัติ',
      to: `/daily-report?date=${s.work_date || ''}`,
    });
  }

  // ── 4M รออนุมัติ ─────────────────────────────────────────────────────────
  for (const f of need('fourM', src.fourM)) {
    if (!keep(f)) continue;
    unit.push({
      key: `4m:${f.id}`, icon: '📝', tier: TIER.UNIT,
      title: `4M ${f.category || ''} — ${f.line_name || '-'}`.trim(),
      detail: String(f.description || '').slice(0, 48),
      age: ageDays(f.work_date, now),
      tag: f.status === 'pending_qa' ? 'รอ QA' : 'รอหัวหน้า',
      /* ลิงก์เดียวกับคิวงานค้างใน DeptDashboard — ใบค้างมักเก่ากว่าช่วง default 7 วัน จึงต้องส่ง from= ไปด้วย */
      to: `/report?tab=4&status=${encodeURIComponent(f.status || '')}&from=${f.work_date || ''}&focus=${f.id}`,
    });
  }

  /* ── 🟡 ถังเหลืองรอพิจารณา — "ซ่อมกลับมาดีได้ หรือเสียแน่" (2026-11-09) ──────────────
     ที่มา: เปิดแท็กเหลืองอัตโนมัติตอนลงงานเสียไปเมื่อ 05/11 ⇒ **วัดจริง 4 วันแรก: ตั้งแท็ก 14 ใบ
     ตัดสินแล้ว 0 ใบ** · กองโตวันละ 3-4 ใบ โดยไม่มีใครถูกดึงไปเคลียร์ (จอมี แต่ต้องเปิดหน้าถึงเห็น)
     🔴 **2 ชั้น ห้ามใช้ชั้นเดียว** — คนตัดสินคือ QA ซึ่ง `sections` ไม่ตรงกับไลน์ผลิต
        ⇒ มีแต่ชั้น `unit` = QA ไม่เห็นอะไรเลย · มีแต่ `floor` = หน่วยเจ้าของไม่รู้ว่าใบไหนของตัวเอง
     🔴 ผู้เรียกต้องเติม `section` ของไลน์มาให้ (ตารางถังไม่มีคอลัมน์ส่วนงาน) — ไม่เติม = `unknown`
        แล้วตกเป็น "ชี้ส่วนงานไม่ได้" ที่จอเขียนบอกอยู่แล้ว ห้ามเดาให้ */
  const bins = need('bins', src.bins);
  const todayKey = bkkDateStr(now.getTime());
  const binAgg = (rows) => {
    let n = 0; let pcs = 0; let oldest = null; let over = 0;
    for (const b of rows) {
      n += 1; pcs += Number(b.qty) || 0;
      const age = ageDays(b.work_date, now);
      if (age != null && (oldest == null || age > oldest)) oldest = age;
      if (binTagAge({ ...b, bin: 'yellow' }, todayKey)?.over) over += 1;
    }
    return { n, pcs, oldest, over };
  };
  const binDetail = (g, where) => [where,
    `${g.pcs.toLocaleString()} ชิ้น`,
    g.oldest != null ? `เก่าสุด ${g.oldest.toLocaleString()} วัน` : null,
    g.over ? `⏱ เกินอายุแท็ก ${g.over.toLocaleString()}` : null].filter(Boolean).join(' · ');

  /* 🔴 **สรุปบรรทัดเดียวทั้ง 2 ชั้น ห้ามแตกรายตัว** — ชั้น unit มีเพดาน 6 แถว (CAP)
     14 ใบ (ยอดจริง 09/11) จะดันใบซ่อม/4M ของหน่วยงานตกจอหมด · หลักเดียวกับคำขอขึ้นขั้นทักษะ
     รายตัวดูที่หน้าถังอยู่แล้ว และแถวในคิวก็ลิงก์ไปหน้าเดียวกันทุกแถว (ไม่มี deep-link รายใบ) */
  /* 🔢 แยกตามเจ้าของขั้น (แบบใบ MO · 10/11) — `ncStep()` ตัดสินที่เดียว · ผู้เรียกส่งแถวที่ยังไม่ปิดมาแล้ว */
  const ownerOf = (b) => ncStep({ ...b, bin: 'yellow', is_active: true }).owner;
  const mineBins = bins.filter(b => keep(b));
  const gUnit = binAgg(mineBins);
  if (gUnit.n) {
    const nProd = mineBins.filter(b => ownerOf(b) === 'prod').length;
    const nQa = mineBins.filter(b => ownerOf(b) === 'qa').length;
    unit.push({
      key: 'binpend_unit', icon: '🟡', tier: TIER.UNIT, count: gUnit.n,
      title: `ถังเหลืองค้างในสาย ${gUnit.n.toLocaleString()} รายการ`,
      detail: [binDetail(gUnit, 'หน่วยงานของคุณ'), `รอ QA ${nQa} · รอฝ่ายผลิต (ซ่อม/ย้ายแดง) ${nProd}`].join(' · '),
      age: gUnit.oldest,
      tag: nProd ? 'ฝ่ายผลิต: ลงผลซ่อม / ย้ายลงถังแดง' : (gUnit.over ? 'เกินอายุแท็กแล้ว' : 'รอ QA ตัดสิน/ตรวจรับ'),
      to: '/scrap-report?tab=bins',
    });
  }
  /* ✍️ คนที่ตัดสินได้ (QA · `qa:bin_decide`) = งานรอ "ตำแหน่งเรา" ทั้งโรงงาน — เหมือนช่องเซ็นของใบ MO
     🔴 เข้าชั้น `mine` เฉพาะคนที่ถือสิทธิ์จริง (ส่งมาจากตัวโหลด) — ไม่ใช่ทุกคนในโรงงาน (badge เด้งค้าง) */
  if (me?.canBinDecide) {
    const qaRows = bins.filter(b => ownerOf(b) === 'qa');
    if (qaRows.length) {
      const g = binAgg(qaRows);
      const nAccept = qaRows.filter(b => ncStep({ ...b, bin: 'yellow', is_active: true }).step === 4).length;
      mine.push({
        key: 'binqa_mine', icon: '🔎', tier: TIER.MINE, count: qaRows.length,
        title: `ถังเหลืองรอ QA ${qaRows.length.toLocaleString()} รายการ`,
        detail: [`ตัดสิน ${qaRows.length - nAccept} · ตรวจรับงานซ่อม ${nAccept}`, `${g.pcs.toLocaleString()} ชิ้น`,
          g.over ? `⏱ เกินอายุแท็ก ${g.over.toLocaleString()}` : null].filter(Boolean).join(' · '),
        age: g.oldest, tag: 'รอ QA', to: '/qa?tab=bins',
      });
    }
  }
  /* บรรทัดของทั้งโรงงาน — กองนี้ไม่มีเจ้าภาพรายใบ (กติกาเดิมของชั้น `floor`)
     🔴 ห้ามให้ขึ้น badge (badge นับเฉพาะชั้น `mine`) */
  const gAll = binAgg(bins);
  if (gAll.n) {
    floor.push({
      key: 'binpend', icon: '🟡', tier: TIER.FLOOR, count: gAll.n,
      title: `ถังเหลืองรอพิจารณา ${gAll.n.toLocaleString()} รายการ`,
      detail: binDetail(gAll, 'ทั้งโรงงาน · QA/หัวหน้าตัดสิน'),
      age: null, to: '/scrap-report?tab=bins',
    });
  }

  /* ── 🔴 ถังแดงยังไม่ออกใบรายงานของเสีย — หัวหน้าแผนกทวงหัวหน้าไลน์ (2026-11-10 · คำสั่ง user) ──
     แท็กแดงมีอายุ 1 วัน (WI-PD3-087 §5.6) แต่ไม่มีใครถูกดึงไปออกใบ ⇒ วัด 10/11: ค้าง 74 รายการ · ผูกใบ 0
     🔴 ชั้น `unit` เท่านั้น (หน่วยเจ้าของไลน์ = คนที่ต้องออกใบ) · สรุปบรรทัดเดียว ห้ามแตกรายตัว (CAP unit)
     ⚠️ `redBins` ไม่ส่งมา = ไม่ได้โหลด ⇒ ข้ามทั้งก้อน (ไม่ติด partial — ตัวโหลดเก่าที่ไม่รู้จักก้อนนี้ยังใช้ได้)
        ส่ง null = โหลดล่ม ⇒ partial */
  if (src.redBins !== undefined) {
    const reds = need('redBins', src.redBins);
    if (src?.redBinsTruncated) missing.push('red_bins_truncated');
    const mineRed = reds.filter(b => keep(b));
    if (mineRed.length) {
      let pcs = 0; let oldest = null; let over = 0;
      for (const b of mineRed) {
        pcs += Number(b.qty) || 0;
        const age = ageDays(b.work_date, now);
        if (age != null && (oldest == null || age > oldest)) oldest = age;
        if (binTagAge({ ...b, bin: 'red' }, todayKey)?.over) over += 1;
      }
      unit.push({
        key: 'binred_unit', icon: '🔴', tier: TIER.UNIT, count: mineRed.length,
        title: `ถังแดงยังไม่ออกใบรายงานของเสีย ${mineRed.length.toLocaleString()} รายการ`,
        detail: ['หน่วยงานของคุณ', `${pcs.toLocaleString()} ชิ้น`,
          oldest != null ? `เก่าสุด ${oldest.toLocaleString()} วัน` : null,
          over ? `⏱ เกินอายุแท็ก ${over.toLocaleString()}` : null].filter(Boolean).join(' · '),
        age: oldest,
        tag: 'หัวหน้าแผนก: ทวงหัวหน้าไลน์ออกใบขออนุมัติทำลาย',
        to: '/scrap-report?tab=bins',
      });
    }
  }

  // ── งานที่ถูกมอบหมายชื่อเราตรงๆ (ใบติดตามงานแก้ไข) ──────────────────────────
  for (const a of need('actions', src.actions)) {
    const it = {
      key: `act:${a.id}`, icon: '🎯',
      title: String(a.problem || 'งานติดตาม').slice(0, 48),
      detail: [a.line_name, a.section].filter(Boolean).join(' · '),
      age: ageDays(a.due_date || a.meeting_date, now),
      tag: a.status === 'doing' ? 'กำลังทำ' : 'ยังไม่เริ่ม',
      to: '/morning-meeting',
      tier: TIER.MINE,
    };
    if (isMe({ uid: a.assignee_uid, name: a.assignee }, me)) mine.push(it);
    else if (keep(a)) unit.push({ ...it, tier: TIER.UNIT, tag: a.assignee || 'ยังไม่มีผู้รับผิดชอบ' });
  }

  // ── ⬆️ คำขอขึ้นขั้นทักษะรออนุมัติ (2026-10-13 · คำสั่ง user) ───────────────────────
  //    ตรวจจริง 13/10: ค้าง 132 คำขอ เก่าสุด 24/08 — **ไม่เคยโผล่ในคิวของใครเลย** ⇒ คะแนนค้างใต้ขั้น (49/74/99)
  //    แล้วจอ "ฝีมือตรงจุดไหม" (Manpower Board) ฟ้องว่าฝีมือไม่ถึงทั้งที่ได้ขั้นแล้ว
  //    · โหลด/นับเฉพาะคนที่ **อนุมัติได้จริง** (`me.canLevelUp` < 100 · `me.canLevelUp100` ขั้น 100 — คีย์เดียวกับปุ่มใน /operator)
  //    · ชั้น `unit` **บรรทัดเดียวต่อขอบเขต** ห้ามแตกรายคำขอ (132 แถวท่วมคิว = ไม่มีใครอ่าน · บทเรียนกระดิ่ง)
  //    · ไม่ขึ้น badge (ไม่ใช่งานที่รอ "ตัวเรา" คนเดียว — หัวหน้าหลายคนกดได้)
  /* ── 📐 RFQ รอ IEC ประเมินความเป็นไปได้ (เฟส 2a · 13/11) ─────────────────────────────
     · ผู้รับ = ทุกคนที่มีสิทธิ์ rfq:assess (IEC ทั้งทีม · คำสั่ง user) ⇒ ชั้น `unit` รายใบ ไม่ขึ้น badge (ไม่ได้รอ "เรา" คนเดียว)
     · RFQ ไม่มีส่วนงาน/ไลน์ ⇒ **ไม่ผ่าน keep()** โดยตั้งใจ (Marketing/IEC อยู่นอกผังส่วนงานผลิต) · อายุนับจากวันที่ MKT ส่งมา */
  if (me.canRfqAssess) {
    for (const r of need('rfqAssess', src.rfqAssess)) {
      unit.push({
        key: `rfqassess:${r.id}`, icon: '📐', tier: TIER.UNIT,
        title: `RFQ ${r.rfq_no || '-'} — ${[r.customer, r.model].filter(Boolean).join(' ') || r.title || ''}`.trim(),
        detail: `รอ IEC ประเมินความเป็นไปได้ (รอบ ${r.round ?? 1})${r.due_date ? ` · ส่งใบเสนอราคา ${r.due_date}` : ''}`,
        age: ageDays(r.requested_at, now),
        tag: r.priority === 'urgent' ? '🔴 ด่วน' : 'รอ IEC',
        to: `/rfq?rfq=${r.rfq_id}`,
      });
    }
  }

  /* ── ✍️ ใบตรวจ AM รออนุมัติ (A5 · 2026-11-24 · คำสั่ง user) ────────────────────────────
     วัดจริง 24/11: ค้าง 326 ใบ 10 ไลน์ เก่าสุด 10/08 — ไม่เคยโผล่ในคิวใคร
     · โหลด/นับเฉพาะคนที่อนุมัติ AM ได้ (`me.canAmApprove`) · ชั้น `unit` **บรรทัดเดียวต่อไลน์** (ห้ามแตกรายใบ)
     · ไม่ขึ้น badge (หัวหน้าหลายคนกดได้ ไม่ได้รอ "เรา" คนเดียว) · ไลน์นอกทะเบียน = นับเป็น "ชี้ส่วนงานไม่ได้" */
  if (me.canAmApprove) {
    if (src?.amPendingTruncated) missing.push('am_pending_truncated');
    const byLine = new Map();
    for (const r of need('amPending', src.amPending)) {
      if (!keep(r)) continue;
      const k = r.line_name || '-';
      const g = byLine.get(k) || { line: k, n: 0, oldest: null };
      g.n += 1;
      const a = ageDays(r.inspected_at, now);
      if (a != null && (g.oldest == null || a > g.oldest)) g.oldest = a;
      byLine.set(k, g);
    }
    for (const g of byLine.values()) {
      unit.push({
        key: `amappr:${g.line}`, icon: '✍️', tier: TIER.UNIT, count: g.n,
        title: `ใบตรวจ AM รออนุมัติ ${g.n} ใบ — ${g.line}`,
        detail: 'หัวหน้ากลุ่ม/หัวหน้าแผนกรับทราบผลตรวจ', age: g.oldest, tag: 'รออนุมัติ',
        to: '/daily-checker?tab=amcheck',
      });
    }
  }

  /* ── ✍️ งาน e-Workflow ที่รอฉัน (25/11) — ใบรอบเอกสาร (Poka-Yoke ฯลฯ) + ใบฟอร์ม ──────────────
     · งานถูกมอบ "ถึงตัว" แล้ว (wf_tasks.assignee_id = ฉัน) แต่หลายคนกดได้ ⇒ ชั้น `unit` ไม่ขึ้น badge
     · บรรทัดเดียวต่อใบงาน (นิยาม) ห้ามแตกรายใบ · ไม่ส่ง = ไม่ได้โหลด (ไม่ใช่ partial) */
  if (me.uid && src.wfTasks !== undefined) {
    const byDef = new Map();
    for (const t of need('wfTasks', src.wfTasks)) {
      const g = byDef.get(t.def) || { def: t.def, n: 0, oldest: null, bound: t.bound };
      g.n += 1;
      const a = ageDays(t.created_at, now);
      if (a != null && (g.oldest == null || a > g.oldest)) g.oldest = a;
      byDef.set(t.def, g);
    }
    for (const g of byDef.values()) {
      unit.push({
        key: `wf:${g.def}`, icon: '✍️', tier: TIER.UNIT, count: g.n,
        title: `${g.def} — รอคุณเซ็น ${g.n} ใบ`,
        detail: g.bound ? 'ใบรอบเอกสาร (e-Workflow)' : 'ใบงาน e-Workflow', age: g.oldest, tag: 'รอเซ็น',
        to: '/workflows?tab=inbox',
      });
    }
  }

  if (me.canLevelUp || me.canLevelUp100) {
    const lu = need('levelUps', src.levelUps).filter(r => (Number(r.to_level) >= 100 ? me.canLevelUp100 : me.canLevelUp) && keep(r));
    if (lu.length) {
      const byLv = {};
      let oldest = null;
      for (const r of lu) {
        byLv[r.to_level] = (byLv[r.to_level] || 0) + 1;
        const a = ageDays(r.requested_at, now);
        if (a != null && (oldest == null || a > oldest)) oldest = a;
      }
      unit.push({
        key: 'levelup', icon: '⬆️', tier: TIER.UNIT, count: lu.length,
        title: `คำขอขึ้นขั้นทักษะรออนุมัติ ${lu.length.toLocaleString()} รายการ`,
        detail: Object.keys(byLv).sort((a, b) => b - a).map(k => `ขั้น ${k}: ${byLv[k]}`).join(' · '),
        age: oldest, tag: 'รอหัวหน้าอนุมัติ',
        to: '/operator?tab=levelup',
      });
    }
  }

  // ── ชั้น 3: ของทั้งโรงงานที่ไม่มีเจ้าภาพ — **สรุปบรรทัดเดียว ห้ามแตกรายตัว** ──────
  //    ใบขอซื้อค้าง 6,743 รายการมาจากตัวระเบิดความต้องการ ไม่ใช่ "งานที่คนหนึ่งต้องทำทีละใบ"
  //    ใบ MO ที่รอ "ตำแหน่ง" ก็เข้าชั้นนี้ด้วย (ดูคอมเมนต์ที่ `byPos` ข้างบน)
  [...byPos.values()].sort((a, b) => b.count - a.count).forEach((g) => {
    floor.push({
      key: `mowait:${g.stage}`, icon: g.meta.icon || '🔧', tier: TIER.FLOOR, count: g.count,
      /* ชื่อขั้น/ผู้รับผิดชอบ อ่านจาก `stepMeta()` เท่านั้น — ห้ามพิมพ์ชื่อขั้นซ้ำที่นี่
         (อีโมจิอยู่ `meta.icon` ไม่ได้อยู่ใน `meta.title` ⇒ ต่อ title ตรงๆ ได้) */
      title: `ใบซ่อมรอ${g.meta.title} ${g.count.toLocaleString()} ใบ`,
      capped: countsCapped,          // 🔴 นับไม่ครบ = จอต้องเขียนบอก ห้ามโชว์เลขเฉยๆ
      detail: ['ทั้งโรงงาน', g.meta.whoShort || g.meta.who || 'ผู้รับผิดชอบ',
        g.oldest != null ? `เก่าสุด ${g.oldest.toLocaleString()} วัน` : null,
        countsCapped ? 'อย่างน้อย (นับได้ไม่ครบ)' : null].filter(Boolean).join(' · '),
      /* 🔴 ลิงก์ต้องพาไปถึง "กองนั้น" จริง (06/10) — `?wait=<stage>` กรองขั้นที่รออยู่
         + `from=` ถอยขอบล่างให้ครอบใบที่เก่าสุดของกอง ไม่งั้นตัวกรองวันที่ default ซ่อนใบค้างหมด
         (กับดักเดียวกับคิว 4M: "ใบค้างมักเก่ากว่าช่วง default") · ไม่รู้อายุ = ไม่ส่ง from ให้หน้าใช้ค่าเดิม */
      age: null,
      to: `/mtn-repair?tab=list&wait=${encodeURIComponent(g.stage)}`
        + (g.oldest != null ? `&from=${dayKeyBack(g.oldest, now)}` : ''),
    });
  });

  for (const s of (src.summaries || [])) {
    if (!s || !Number(s.count)) continue;
    floor.push({ key: `sum:${s.key}`, icon: s.icon || '📦', tier: TIER.FLOOR,
      title: s.title, detail: s.detail || '', count: Number(s.count), age: null, to: s.to });
  }

  /* ✍️ "ป้ายคาไว้" — บรรทัดเดียวต่อขั้น บอกว่ามีกี่ใบรอเราเซ็น กดแล้วเปิดหน้า MO ที่กรองมาให้แล้ว
     (คำสั่ง user 22/10: *"ไม่ต้องซ้ำรายใบก็ได้ แต่ต้องมีแจ้งเตือนคาไว้ว่ามีงานรอเราอยู่กี่ใบที่ต้องเข้าไปเซ็น
       พอคลิกก็เปิดหน้า mo ขึ้นมาเลยพร้อมกรองที่รอเราอนุมัติ"*)
     🔴 `rollup: true` = **ไม่นับเข้า badge** (badge ต้องเท่าจำนวนใบจริง ไม่ใช่บวกบรรทัดสรุปเข้าไปอีก)
     🔴 มีใบเดียวไม่ต้องสรุป — แถวของใบนั้นพาไปถึงใบได้ตรงกว่า (สรุป 1 ใบ = บรรทัดซ้ำเปล่าๆ)
     🔴 `from=` ถอยขอบล่างให้ครอบใบเก่าสุด ไม่งั้นตัวกรองวันที่ default ซ่อนใบค้างหมด (กับดักเดิมของชั้น floor) */
  [...signByStage.values()].filter(g => g.count >= 2).forEach(g => {
    mine.push({
      key: `sign:${g.stage}`, icon: '✍️', tier: TIER.MINE, sign: true, rollup: true,
      title: `รอคุณเซ็น ${g.count.toLocaleString()} ใบ — ${g.meta?.title || g.stage}`,
      detail: ['กดเพื่อเปิดรายการที่รอคุณอนุมัติ',
        g.oldest != null ? `เก่าสุด ${g.oldest.toLocaleString()} วัน` : null].filter(Boolean).join(' · '),
      count: g.count, age: null,
      /* 🔴 27/11 — ต้องพาไปตัวกรอง `?sign=<stage>` ที่ใช้ `signWaitsOnMe()` **กฎเดียวกับที่นับป้ายนี้**
         เดิมพาไป `?wait=<stage>` = "ใบที่ค้างขั้นนี้" เฉยๆ ⇒ เลขไม่ตรง + ปนใบที่กดอนุมัติไม่ได้ */
      to: `/mtn-repair?tab=list&sign=${encodeURIComponent(g.stage)}`
        + (g.oldest != null ? `&from=${dayKeyBack(g.oldest, now)}` : ''),
    });
  });

  /* ✍️ ป้าย "รอคุณเซ็นรับทราบ" — แยกจากป้ายขั้นที่ใบรออยู่ **ต้องเขียนว่าไม่บล็อกงาน**
     ไม่งั้นหน้างานอ่านว่าใบค้างรออนุมัติแล้วหยุดรอ ทั้งที่ช่างทำงานต่อได้เลย */
  if (ackCount > 0) {
    mine.push({
      key: 'sign:ack_dept', icon: '✍️', tier: TIER.MINE, sign: true, rollup: true,
      title: `รอคุณเซ็นรับทราบ ${ackCount.toLocaleString()} ใบ — ผู้จัดการต้นสังกัด`,
      detail: ['ไม่บล็อกงาน — เซ็นตอนว่างได้', 'กดเพื่อเปิดรายการ',
        ackOldest != null ? `เก่าสุด ${ackOldest.toLocaleString()} วัน` : null].filter(Boolean).join(' · '),
      count: ackCount, age: null,
      to: `/mtn-repair?tab=list&ack=pending${ackOldest != null ? `&from=${dayKeyBack(ackOldest, now)}` : ''}`,
    });
  }

  const byAge = (a, b) => (b.age ?? -1) - (a.age ?? -1);      // เก่าสุดขึ้นก่อน · ไม่รู้อายุไปท้าย
  // ✍️ ช่องที่รอเราเซ็นคนเดียวขึ้นก่อนทุกอย่าง (คำสั่ง user 13/10 "สำคัญกว่าแจ้งเตือนอื่นๆ")
  mine.sort((a, b) => ((b.rollup ? 1 : 0) - (a.rollup ? 1 : 0))
    || ((b.sign ? 1 : 0) - (a.sign ? 1 : 0)) || byAge(a, b)); unit.sort(byAge);

  return {
    mine, unit, floor,
    /* 🔴 badge = จำนวน "ใบ" จริง — บรรทัดสรุป (`rollup`) ไม่นับ ไม่งั้นเลขเกินจำนวนงานจริง */
    /* 🔴 แถวสรุป (คิวถังเหลือง · คำขอขึ้นขั้นทักษะ) ถือ `count` ของกองไว้ — นับเป็น 1 แถว
       จะได้ตัวเลขชั้นหน่วยงาน **ต่ำกว่างานจริง** (QC audit 09/11) ⇒ นับด้วย `count` ถ้ามี */
    counts: {
      mine: mine.filter(x => !x.rollup).length,
      unit: unit.reduce((n, u) => n + (Number(u.count) || 1), 0),
      floor: floor.reduce((n, f) => n + (f.count || 0), 0),
    },
    missing,
    partial: missing.length > 0,
    /* จำนวนแถวที่ระบุส่วนงานไม่ได้ ⇒ ไม่เข้าคิวของใครเลย — **จอต้องเขียนบอก** (ไม่ใช่ `partial`
       เพราะคิวรีไม่ได้ล่ม · ข้อมูลไม่ครบที่ต้นทาง) · 0 = ไม่ต้องเขียน */
    unattributed,
  };
}

/**
 * ตัวเลขบนรูปโปรไฟล์ — **นับเฉพาะชั้น "รอเราจริงๆ"**
 * คืน 0 = **ไม่ต้องวาด badge เลย** (ไม่ใช่วาดวงกลมที่มีเลข 0)
 * ⚠️ โหลดไม่ครบ (`partial`) → คืน 0 เช่นกัน — ตัวเลขที่อาจผิดแย่กว่าไม่มีตัวเลข
 *    (รายการข้างในยังโชว์พร้อมคำเตือนว่าไม่ครบ)
 */
export function badgeCount(q) {
  if (!q || q.partial) return 0;
  return q.counts?.mine || 0;
}

/** ตัดรายการตาม CAP แล้วบอกว่าซ่อนไปกี่อัน — ห้ามตัดเงียบ */
export function capped(list, tier) {
  const cap = CAP[tier] ?? 6;
  const arr = Array.isArray(list) ? list : [];
  return { shown: arr.slice(0, cap), hidden: Math.max(0, arr.length - cap) };
}

/** ข้อความตอนไม่มีงาน — **ต้องโชว์เสมอ ห้ามซ่อนแผง**
 *  (กฎเดียวกับคิวงานค้างใน DeptDashboard: ผู้ใช้ต้องแยกออกว่า "เคลียร์หมด" ≠ "จอพัง") */
export const EMPTY_TEXT = {
  [TIER.MINE]: '✅ ไม่มีงานที่รอคุณอยู่',
  [TIER.UNIT]: '✅ ไม่มีงานค้างในหน่วยงานของคุณ',
  [TIER.FLOOR]: '',
};

export const TIER_TITLE = {
  [TIER.MINE]: '🙋 รอคุณโดยตรง',
  [TIER.UNIT]: '🏭 คิวของหน่วยงานคุณ',
  [TIER.FLOOR]: '🗂 ค้างทั้งโรงงาน (ยังไม่มีเจ้าภาพ)',
};

/** ชื่อคนแบบย่อสำหรับป้ายกำกับ — ใช้ตัวเทียบชุดเดียวกับทั้งระบบ */
export const shortName = (s) => normPersonName(s).split(' ')[0] || '';
