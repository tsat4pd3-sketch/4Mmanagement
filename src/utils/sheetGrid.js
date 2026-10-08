/* ══ 📐 ผังกระดาษ A4 ของบอร์ด OBEYA — pure ทั้งไฟล์ มีเทส (แยกจาก ObeyaSheet.jsx 25/09) ═══
   แยกออกมาเพราะตัวเลือกผังเป็น "คณิตศาสตร์ล้วน" ที่ต้องล็อกด้วยเทส — เดิมฝังใน .jsx
   ซึ่งตัวรันเทสของโปรเจคเก็บไม่ได้ (บทเรียนเดียวกับสูตรพาเรโตที่เคยฝังใน .jsx แล้วไม่เคยถูกเทส)
   ═════════════════════════════════════════════════════════════════════════════════════ */

export const A4 = 1 / Math.SQRT2;          // 0.7071 — กว้าง ÷ สูง ของกระดาษ A4 แนวตั้ง
export const GAP = 10;                     // ช่องไฟระหว่างแผ่น (px) — เหมือนเว้นขอบกระดาษที่ติดบอร์ด
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** แผ่นแคบ/เตี้ยกว่านี้ = ป้ายไฟหาย · ตัวเลขใหญ่โดนตัด · กราฟอ่านไม่ออก
 *  (เส้นแบ่ง `compact` ของ StatusLamp = 200px ⇒ ตั้ง 210 ให้พ้นเส้นนั้น)
 *  🔴 ยอม "แบ่งหน้าเพิ่ม" ดีกว่า "บีบแผ่นจนอ่านไม่ออก" (คำสั่ง user 25/09) */
export const MIN_SHEET_W = 210;
export const MIN_SHEET_H = 150;

/**
 * เลือกผังกระดาษจากกล่องที่วัดได้ — pure ทั้งก้อน มีเทส
 *
 * แต่ละผัง cols×rows มีได้ 2 ทรง:
 *   ก) **ทรง A4** (ของเดิม) — ความสูงมาจากจำนวนแถว แล้วกว้าง = สูง × A4 · หน้าตาบอร์ดที่ใช้อยู่
 *   ข) **ทรงเตี้ย** — กว้างเต็มคอลัมน์ สูงเท่าที่มี · ใช้เมื่อจอเตี้ยจน A4 จะแคบเกินอ่าน
 *
 * ลำดับการเลือก (สำคัญ — เรียงตามสิ่งที่ user ขอ):
 *   1) ผังที่ **ใส่ครบทุกแผ่นในหน้าเดียว** (ไม่ต้องกดเปลี่ยนหน้าเลยถ้าทำได้)
 *   2) ผังที่ **ใส่ได้มากสุดต่อหน้า** (หน้าน้อยที่สุด)
 *   3) เท่ากัน → เอา **ทรง A4** ก่อน แล้วค่อยดูขนาดแผ่น
 * แผ่นต้องผ่าน MIN_SHEET_W/H เสมอ — ไม่มีผังไหนผ่าน = ใส่ใบเดียวเต็มกล่อง (จอจิ๋ว)
 */
export function chooseSheetGrid(w, h, sheets = 10) {
  if (!w || !h) return { cols: 5, rows: 2, cw: 0, ch: 0, fit: true, k: 1, bw: 0, bh: 0 };
  const want = Math.max(1, Number(sheets) || 1);
  let best = null;
  const consider = (cols, rows, cw, ch, a4) => {
    if (!(cw > 0) || !(ch > 0)) return;
    if (cw < MIN_SHEET_W || ch < MIN_SHEET_H) return;
    const cells = cols * rows;
    const cand = { cols, rows, cw, ch, cells, a4, area: cw * ch, fits: cells >= want };
    if (!best) { best = cand; return; }
    /* ⚠️ พอ "ใส่ครบหน้าเดียว" ได้แล้ว **จำนวนช่องไม่สำคัญอีกต่อไป** — ต้องเอาแผ่นใหญ่ที่สุด
       ถ้าเอาช่องเยอะไว้ก่อนจะได้ผัง 6×4 = 24 ช่องใส่ 10 แผ่น ⇒ แผ่นเล็กลงโดยไม่ได้อะไรเลย
       🔴 30/09 (user: "สเกลเพี้ยนตอนเปลี่ยนเดือน"): เดิม "ทรง A4 ชนะเสมอถ้าผ่านเกณฑ์" ⇒ กล่องสูงขึ้นแค่ 20px
       (แถบเตือน "กะยังไม่ปิด" หายไปเมื่อดูเดือนก่อน) แผ่นสลับจากกว้าง 340 → แคบ 216 ทั้งบอร์ด
       วัดจริง 1740px กว้าง: h=600 → cw 340 · h=620 → cw 216 · ⇒ ตัดสินด้วย **พื้นที่แผ่น** ก่อนเสมอ (ทรง A4 = แค่ตัวตัดสินเสมอ)
       ผลคือแผ่นกว้างเต็มคอลัมน์ทุกความสูง สูงเปลี่ยนตามที่มี (ไม่เกินสัดส่วน A4) — ไม่มีจุดสลับทรง */
    const better = cand.fits !== best.fits ? cand.fits
      : cand.fits
        ? (cand.area !== best.area ? cand.area > best.area : cand.a4)
        : (cand.cells !== best.cells ? cand.cells > best.cells
          : cand.area !== best.area ? cand.area > best.area : cand.a4);
    if (better) best = cand;
  };
  for (let cols = 1; cols <= 6; cols++) {
    const cwFull = (w - GAP * (cols - 1)) / cols;          // กว้างเต็มคอลัมน์
    for (let rows = 1; rows <= 6; rows++) {
      const chRow = (h - GAP * (rows - 1)) / rows;         // สูงเท่าที่แถวนี้มี
      if (chRow <= 0) continue;
      const cwA4 = Math.min(cwFull, chRow * A4);           // ก) ทรง A4
      consider(cols, rows, cwA4, Math.min(chRow, cwA4 / A4), true);
      consider(cols, rows, cwFull, Math.min(chRow, cwFull / A4), false);   // ข) ทรงเตี้ย
    }
  }
  if (!best) best = { cols: 1, rows: 1, cw: w, ch: h, cells: 1, fits: want <= 1 };
  return {
    cols: best.cols, rows: best.rows, cw: best.cw, ch: best.ch,
    fit: best.cells >= want, k: clamp(best.cw / 330, 0.72, 2.4), bw: w, bh: h,
  };
}
