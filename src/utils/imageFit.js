/* ── imageFit — วางรูปลงกรอบโดย "คงสัดส่วน" + หาว่าหมุดไหนอยู่บนรูปไหน (2026-11-03 · feedback ประชุม 02/11 ข้อ A7) ──
   อาการที่หน้างานแจ้ง: "รูปในใบตรวจ AM/PM ขนาดผิด (ถูกขยาย) และอยู่ผิดตำแหน่ง"

   ต้นเหตุที่เจอ (อ่านโค้ด — ไม่ใช่ข้อมูลเสีย):
   1. ใบพิมพ์ FM-JIG-003 (PDF `lib/pmExportPDF.js` · Excel `lib/pmExportExcel.js`) **ยืดรูปให้เต็มกรอบเสมอ**
      — `addImage(img, x, y, กว้างกรอบ, สูงกรอบ)` ไม่ดูสัดส่วนรูป ⇒ รูปมือถือแนวตั้ง 3:4 ถูกดึงเป็น 5:1
      ในช่อง Picture · รูปเครื่องถูกยืดเต็มกรอบ 57 มม. ⇒ "ขนาดผิด/ถูกขยาย"
   2. ใบพิมพ์วาดหมุด **ทุกจุด** ลงรูปหลักรูปเดียว ทั้งที่จุดตรวจผูกกับ "เฟรม" ของรูป 360° (`image_id`)
      ⇒ หมุดที่วางบนรูปมุมอื่นไปตกบนรูปหน้า = "อยู่ผิดตำแหน่ง" (จอตรวจกรองเฟรมถูกอยู่แล้ว — `JigSpinCheck`)
   3. รูปย่อในแถวตรวจ (`PointThumb`) ตั้งแค่ความสูง ⇒ รูปกว้าง/พาโนรามาดันชื่อจุดและปุ่ม OK/NG
      แถวละขนาดไม่เท่ากัน ⇒ แก้ที่ตัวกลาง `components/inspect/PointZoom.jsx` (กล่องคงที่ + contain)

   🔴 ไฟล์นี้ pure (ไม่แตะ DOM/ฐาน) — เทส `__tests__/imageFit.test.mjs`
   🔴 จอ/ใบพิมพ์ที่วางรูปลงกรอบตายตัว ใช้ `fitContain()` ตัวนี้ **ห้ามยืดรูปด้วยกว้าง×สูงของกรอบตรงๆ**
      และหมุดบนรูปหลายเฟรมกรองด้วย `pinsOnFrame()` (กติกาเดียวกับจอตรวจ: `image_id` ว่าง = เฟรมแรก) */

/**
 * วางรูป srcW×srcH ลงกรอบ boxW×boxH แบบ contain (ไม่ครอป ไม่ยืด) จัดกึ่งกลาง
 * @param {object} [opt]
 * @param {boolean} [opt.upscale=true] false = รูปเล็กกว่ากรอบไม่ขยาย (รูปย่อในตาราง)
 * @returns {{ w:number, h:number, dx:number, dy:number }|null} `null` เมื่อขนาดอ่านไม่ออก
 *          (ผู้เรียกต้องตัดสินเอง — ห้ามเดาเป็นเต็มกรอบ ซึ่งคือบั๊กเดิม)
 */
export function fitContain(srcW, srcH, boxW, boxH, { upscale = true } = {}) {
  const sw = Number(srcW), sh = Number(srcH), bw = Number(boxW), bh = Number(boxH);
  if (!(sw > 0 && sh > 0 && bw > 0 && bh > 0)) return null;
  let s = Math.min(bw / sw, bh / sh);
  if (!upscale) s = Math.min(s, 1);
  const w = sw * s, h = sh * s;
  return { w, h, dx: (bw - w) / 2, dy: (bh - h) / 2 };
}

/**
 * ขนาดจริงของรูปจากไบต์ (JPEG/PNG) — ใช้ฝั่ง Excel ที่ได้ไฟล์เป็น buffer ไม่มี DOM ให้วัด
 * @param {Uint8Array} b
 * @returns {{ width:number, height:number, kind:'png'|'jpeg' }|null}
 */
export function imageSizeFromBytes(b) {
  if (!b || b.length < 24) return null;
  // PNG: signature 8 ไบต์ แล้ว IHDR — width/height เป็น big-endian ที่ offset 16/20
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const rd = (o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
    const width = rd(16), height = rd(20);
    return width > 0 && height > 0 ? { width, height, kind: 'png' } : null;
  }
  // JPEG: ไล่ marker หา SOFn (C0–CF ยกเว้น C4 DHT · C8 JPG · CC DAC)
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }                    // padding
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }  // ไม่มี length
      const len = (b[i + 2] << 8) + b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        const height = (b[i + 5] << 8) + b[i + 6];
        const width = (b[i + 7] << 8) + b[i + 8];
        return width > 0 && height > 0 ? { width, height, kind: 'jpeg' } : null;
      }
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}

/**
 * จุดตรวจที่มีหมุดอยู่บนเฟรมนี้ — กติกาเดียวกับจอตรวจ (`PMCheckData` · `JigSpinCheck`):
 * `image_id` ว่าง = ผูกเฟรมแรก (backfill) · ไม่มีพิกัด = ไม่มีหมุด
 * @param {object[]} checkpoints
 * @param {string|null} frameId   id ของเฟรมที่วาด
 * @param {string|null} firstId   id ของเฟรมแรก
 * @returns {{ on:object[], offFrame:number }} `offFrame` = หมุดที่อยู่รูปมุมอื่น (ใบพิมพ์ต้องเขียนบอก ห้ามหายเงียบ)
 */
export function pinsOnFrame(checkpoints, frameId, firstId) {
  const on = [];
  let offFrame = 0;
  for (const c of checkpoints || []) {
    if (c?.x_pos == null || c?.y_pos == null) continue;
    if ((c.image_id ?? firstId) === frameId) on.push(c);
    else offFrame++;
  }
  return { on, offFrame };
}
