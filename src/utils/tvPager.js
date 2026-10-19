/* ══════════════════════════════════════════════════════════════════════════
   📺 tvPager — จอภาพรวม/จอ TV "ห้ามมี scroll" ⇒ เนื้อหายาวเกินจอ = แบ่งหน้าแล้วหมุนเอง (2026-10-19)

   user 19/10: *"ถ้าออกแบบไว้เป็นจอภาพรวมเปิดโชว์ มันจะไม่ควรต้องมี scroll เลื่อนขึ้นลง"*
   · ตัดหน้า**ตามขอบชิ้นงาน** (`[data-tv-item]` = บอร์ดไลน์ 1 ไลน์ / การ์ด 1 ใบ) ไม่ตัดกลางบอร์ด
   · ชิ้นที่ไม่อยู่ในหน้าปัจจุบัน = `visibility:hidden` (ยังกินที่ ⇒ พิกัดไม่ขยับระหว่างหมุน)
   · ชิ้นเดียวสูงเกินจอ (บอร์ดไลน์ที่มีหลายพาร์ท) = **เลื่อนต่อในชิ้นเดิมหลายหน้า** (ซ้อนกัน `OVERLAP` px ให้อ่านต่อได้)
     ธง `part`/`parts` ให้จอเขียน "ต่อ 2/3" · ห้ามซ่อนส่วนท้ายถาวร
   · หน้าแรกเริ่มที่ 0 เสมอ — หัวบอร์ด/คำอธิบายสีที่อยู่ก่อนชิ้นแรกต้องเห็นในหน้าแรก
   ไฟล์นี้ pure (คำนวณหน้า) · hook ที่วัด DOM/หมุนหน้า = `utils/useTvPager.js`
   ══════════════════════════════════════════════════════════════════════════ */

export const OVERLAP = 48;

/**
 * @param {{top:number,bottom:number}[]} items  พิกัดชิ้นงาน (px จากหัวกล่อง · เรียงตามลำดับเอกสาร)
 * @param {number} viewH  ความสูงที่มองเห็นได้
 * @returns {{start:number, items:number[], part?:number, parts?:number}[]}  หน้า (index ของชิ้นในหน้านั้น)
 */
export function tvPages(items = [], viewH = 0) {
  if (!(viewH > 0) || !items.length) return [{ start: 0, items: items.map((_, i) => i) }];
  const order = items.map((it, i) => ({ ...it, i })).sort((a, b) => a.top - b.top || a.i - b.i);
  const pages = [];
  let start = 0;
  let rest = order;
  while (rest.length) {
    const end = start + viewH;
    const inPage = rest.filter(it => it.bottom <= end + 0.5);
    let page;
    if (inPage.length) page = inPage;
    else {
      // ชิ้นแรกที่เหลือสูงเกินจอ = หน้าเดี่ยว แล้วเลื่อนต่อในชิ้นเดิมจนเห็นครบ
      page = rest.filter(it => it.top === rest[0].top);
      const bottom = Math.max(...page.map(it => it.bottom));
      const step = Math.max(1, viewH - OVERLAP);
      const parts = 1 + Math.ceil(Math.max(0, bottom - (start + viewH)) / step);
      for (let k = 0; k < parts; k++) {
        const st = k === parts - 1 ? Math.max(start, bottom - viewH) : start + k * step;
        pages.push({ start: st, items: page.map(it => it.i), part: k + 1, parts });
      }
    }
    const ids = new Set(page.map(it => it.i));
    if (inPage.length) pages.push({ start, items: page.map(it => it.i) });
    rest = rest.filter(it => !ids.has(it.i));
    if (rest.length) start = rest[0].top;
  }
  return pages;
}
