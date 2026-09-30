/* ══ 📖 แบ่งบอร์ดเป็น "หน้า" แทนการเลื่อน (2026-09-25 · คำสั่ง user) ════════════════════
   *"OBEYA DASHBOARD / KPI DASHBOARD ต้องไม่เป็น overflow ดูจบได้ในหน้าเดียวไม่มีการเลื่อน
     scroll ขึ้นลง แต่ให้ใช้หลักการ กดเปลี่ยนหน้า คล้ายๆ ตัวประชุมแถวเช้า"*

   เหตุผลที่ "เลื่อน" ใช้ไม่ได้กับบอร์ดห้อง OBEYA:
   - บอร์ดพวกนี้ขึ้นจอ TV/โปรเจคเตอร์ที่**ไม่มีเมาส์** — เลื่อนไม่ได้ ของที่อยู่ล่างจอ = ไม่มีใครเห็น
   - คนยืนประชุมหน้าบอร์ดอ่านพร้อมกัน ถ้าต้องเลื่อนแปลว่าแต่ละคนเห็นคนละส่วน
   - บอร์ดกระดาษของจริงคือผนังแผ่นเดียว มองเห็นหมดในพริบตา — เลื่อน = เสียคุณสมบัตินี้ไป

   🔴 กฎ: แผ่นที่ลงไม่พอในจอ **ห้ามดันให้เลื่อน** ให้ตัดขึ้นหน้าใหม่แล้วกดเปลี่ยนหน้าแทน
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/**
 * แบ่งรายการแผ่นเป็นหน้า โดยนับ "ช่องในกริด" ไม่ใช่จำนวนแผ่น
 * — แผ่นที่กว้าง 2 ช่อง (`span: 2` เช่น OEE / ACTION BOARD) กิน 2 ช่อง
 *   และ **ห้ามถูกผ่าครึ่งคาหน้า** ⇒ ถ้าช่องที่เหลือไม่พอ ให้ขึ้นหน้าใหม่ทั้งใบ
 *
 * @param {Array<{span?:number}>} items  แผ่นตามลำดับที่จะวาง
 * @param {number} perPage               จำนวนช่องต่อหน้า (= cols × rows ของกริด)
 * @returns {Array<Array>}               อาเรย์ของหน้า · ไม่มีของ = [] (ไม่ใช่ [[]])
 */
export function packPages(items, perPage) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return [];
  const cap = Math.max(1, Math.floor(Number(perPage) || 0) || 1);

  const pages = [];
  let page = [];
  let used = 0;
  for (const it of list) {
    // span ใหญ่กว่าหน้าทั้งหน้า = ยัดลงหน้าเดียวตามลำพัง (กันลูปไม่รู้จบ · จอจะบีบให้เองตอนวาด)
    const span = Math.max(1, Math.min(cap, Math.floor(Number(it?.span) || 1)));
    if (used + span > cap && page.length) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(it);
    used += span;
  }
  if (page.length) pages.push(page);
  return pages;
}

/** จำนวนช่องที่หน้านี้ใช้จริง — ใช้เช็คว่าเหลือช่องว่างกี่ช่อง (จอจะได้ไม่ยืดแผ่นผิดสัดส่วน) */
export const cellsUsed = (page) =>
  (page || []).reduce((n, it) => n + Math.max(1, Math.floor(Number(it?.span) || 1)), 0);

/**
 * หน้าปัจจุบันที่ปลอดภัยเสมอ — ข้อมูลเปลี่ยน (เลือกขอบเขตใหม่/เปลี่ยนเดือน) แล้วจำนวนหน้าลดลง
 * ถ้าปล่อยไว้จอจะว่างเพราะ index ค้างเกินจำนวนหน้า ⇒ หนีบกลับเข้ากรอบเสมอ
 */
export const clampPage = (i, total) => {
  const n = Math.max(1, Math.floor(Number(total) || 0) || 1);
  const v = Math.floor(Number(i) || 0);
  return Math.max(0, Math.min(n - 1, v));
};

/** ชื่อหน้าแบบสั้นสำหรับแถบเปลี่ยนหน้า — เอาชื่อแผ่นแรกของหน้ามาเป็นป้าย (คนจะได้รู้ว่าหน้านี้มีอะไร) */
export function pageLabels(pages, titleOf = (x) => x?.title) {
  return (pages || []).map((pg, i) => {
    const first = titleOf(pg?.[0]);
    const last = pg?.length > 1 ? titleOf(pg[pg.length - 1]) : null;
    if (!first) return `หน้า ${i + 1}`;
    return last && last !== first ? `${first} → ${last}` : String(first);
  });
}
