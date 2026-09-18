/* ═══ 862 ต้องไม่ทับรอบที่ e-SMART ยืนยันไปแล้ว ══════════════════════════════════════
   🔴 ที่มา (เกิดจริง 2026-09-18 · user: *"ของ AAT ก็ไปขึ้นย้อนหลัง ถูกมั้ย ทั้งที่ e-smart ส่งไปแล้ว"*)

   ลำดับเหตุการณ์จริงของวันนั้น (AAT/GRBNA dock B5 · 3 พาร์ท):
     08:07 e-SMART สร้างใบรอบ 09:00 → 08:35 กดส่ง (ของออกจริง)
     10:10 e-SMART สร้างใบรอบ 11:00 → 10:38 กดส่ง
     12:41 e-SMART สร้างใบรอบ 14:00 → 13:01 กดส่ง
     13:53 อัพไฟล์ 862 → **สร้างใบรอบ 08:00 / 10:00 / 13:00 เพิ่มอีกชุด**
     13:55 คนกดส่งรวดเดียวทั้ง 9 ใบ → **หักสต็อกซ้ำ 515 ชิ้น**

   862 กับ e-SMART เดินคนละกริดเวลาแต่เป็น**เที่ยวรถเดียวกัน** (คู่ที่วัดไว้: 08:00↔09:00 ·
   10:00↔11:00 · 13:00↔14:00) — ตัวนำเข้า 862 เดิมกัน "ใบที่ทำไปแล้ว" ด้วย
   `customer|customer_part_no|due_date|ship_time` **ตรงตัวเป๊ะ** ซึ่งพลาดทั้ง 2 ทาง:
     ① เลขพาร์ทสะกดคนละแบบ — e-SMART เก็บ `RB3B-16E060-BA` · 862 เก็บ `RB3B 16E060 BA`
     ② เวลาคนละกริด — 08:00 ไม่มีทางเท่ากับ 09:00
   ⇒ ไม่เคย match ⇒ สร้างใบใหม่ทับทุกครั้ง = **ยอดนับ 2 เท่า + สต็อกหักซ้ำ**

   ⇒ กฎ: ใบที่ **"ทำไปแล้ว" (ไม่ใช่ pending)** = ความจริงของเที่ยวนั้น — 862 ห้ามสร้างซ้ำ
      เทียบด้วย **MAT (หรือเลขพาร์ท normalize) + dock + เที่ยวที่ใกล้กัน** ไม่ใช่สตริงตรงตัว
   ═══════════════════════════════════════════════════════════════════════════════════ */

/** normalize เลขพาร์ท/MAT ให้เทียบข้ามแหล่งได้ (ตัดขีด/ช่องว่าง/ตัวพิมพ์) */
export const normKey = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const dockKey = (s) => String(s ?? '').trim().toUpperCase();

/** สถานะที่ถือว่า "ทำไปแล้ว" — ห้ามให้ 862 สร้างใบซ้ำของเที่ยวนี้ */
export const DONE_STATUSES = ['confirmed', 'prepared', 'loaded', 'shipped'];

/* ระยะที่นับว่า "เที่ยวเดียวกัน" เมื่อมองจากเวลาในไฟล์ 862
   e-SMART = เวลารถมารับจริง ซึ่ง **ช้ากว่า** กริดของ 862 ⇒ มองไปข้างหน้าไกลกว่า
   (กลับด้านกับ MATCH_BACK/FWD ใน pullSignal.js ที่มองจากฝั่ง e-SMART) */
export const FWD_MS  = 150 * 60000;   // 862 08:00 → e-SMART 09:00/10:30 ยังนับเป็นเที่ยวเดียวกัน
export const BACK_MS =  45 * 60000;   // เผื่อกรณี 862 มาช้ากว่านิดหน่อย (15:30 ↔ 15:00)

/** เวลาส่งจริงเป็น ms — ก่อน 08:00 = กะดึกของวันงานนั้น ⇒ ตกวันถัดไปตามปฏิทิน
 *  (กติกาเดียวกับ `orderShipAt` ใน pullSignal.js — ห้ามเทียบเป็น "นาทีบนหน้าปัด") */
export function shipAtMs(dueDate, shipTime) {
  const d = String(dueDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = String(shipTime || '').match(/^(\d{1,2}):(\d{2})/);
  if (!d || !t) return null;
  const at = new Date(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  if (+t[1] < 8) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/**
 * มีใบที่ "ทำไปแล้ว" ครอบคลุมรายการ 862 บรรทัดนี้อยู่แล้วไหม
 * @param {{shipTo,part,mat_no,date,time,dock}} rec  แถวจากไฟล์ 862
 * @param {Array} done  ใบสถานะ DONE_STATUSES ของ ship-to นั้น (ทุก source)
 * @returns {object|null} ใบที่ครอบคลุมอยู่ (ไว้รายงานบนจอ) · null = ยังไม่มี สร้างได้
 */
export function findDoneCover(rec, done) {
  const at = shipAtMs(rec.date, rec.time);
  if (at == null) return null;                 // ไม่รู้เวลา = ไม่เดา ปล่อยให้สร้างตามเดิม
  const rk = normKey(rec.mat_no), pk = normKey(rec.part), dk = dockKey(rec.dock);
  let best = null, bestGap = Infinity;
  for (const o of done || []) {
    if (o.due_date !== rec.date && shipAtMs(o.due_date, o.ship_time) == null) continue;
    /* ต้องเป็นของชิ้นเดียวกันจริง — MAT ตรงก่อน · ไม่มี MAT ค่อยเทียบเลขพาร์ทลูกค้า */
    const sameItem = (rk && normKey(o.mat_no) === rk)
      || (!rk && pk && normKey(o.customer_part_no) === pk);
    if (!sameItem) continue;
    /* dock ต่างกัน = คนละท่า คนละเที่ยว · ใบที่ไม่ระบุ dock ถือว่าเข้ากันได้ */
    const ok = dockKey(o.dock_code);
    if (dk && ok && dk !== ok) continue;
    const oAt = shipAtMs(o.due_date, o.ship_time);
    if (oAt == null) continue;
    const gap = oAt - at;
    if (gap < -BACK_MS || gap > FWD_MS) continue;
    if (Math.abs(gap) < bestGap) { bestGap = Math.abs(gap); best = o; }
  }
  return best;
}

/**
 * คัดรายการ 862 ที่ควร insert จริง + รายการที่ถูกข้ามเพราะมีใบที่ทำไปแล้วครอบคลุม
 * @returns {{insert: Array, covered: Array<{rec, by}>}}
 */
export function splitAlreadyDone(records, done) {
  const insert = [], covered = [];
  for (const rec of records || []) {
    const by = findDoneCover(rec, done);
    if (by) covered.push({ rec, by }); else insert.push(rec);
  }
  return { insert, covered };
}
