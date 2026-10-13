/**
 * photoAppendix — "ภาคผนวก: รูปหลักฐาน" ต่อท้ายใบพิมพ์ที่ขึ้นทะเบียนเอกสาร (2026-10-13 · คำสั่ง user)
 *
 * 🔴 ทำไมต้องเป็น "เอกสารแนบ" ไม่ใช่คอลัมน์ในฟอร์ม:
 *   ใบถังเหลือง/แดง · ใบรายงานของเสีย · ใบรายงานปัญหาการผลิต เป็น**ฟอร์มขึ้นทะเบียน**
 *   เลขฟอร์ม/Rev/ช่องลงนาม doc_control เป็นคนคุม — แทรกคอลัมน์ในตาราง = เปลี่ยน layout
 *   ⇒ ต้องขึ้น Rev. ใหม่และให้ doc_control อนุมัติก่อน · อีกทั้งใบถังเหลืองกว้าง 14 คอลัมน์
 *   เต็มหน้า A4 แนวนอนอยู่แล้ว รูปที่ยัดเข้าไปจะเล็กจนดูไม่ออก (= ใส่ไปก็ไม่ได้ใช้)
 *   หน้าภาคผนวกอยู่ "นอกเนื้อฟอร์ม" ⇒ ฟอร์มหน้าแรกยังเป็น Rev. เดิม 100% และถอดออกได้โดยไม่กระทบ
 *
 * 🔴 กติกาที่พลาดแล้วได้กระดาษเปล่า:
 *   · **ห้ามใส่ `loading="lazy"` ในหน้าพิมพ์** — รูปที่ยังไม่ถูกเลื่อนถึงจะไม่ถูกโหลด
 *     แล้วพิมพ์ออกมาเป็นช่องว่าง (กฎ list-thumb-needs-lazy เป็นเรื่องของ "จอรายการ" คนละเรื่องกัน)
 *   · **ต้องรอรูปโหลดครบก่อนสั่ง print** — `window.print()` ไม่รอรูป (ใช้ `waitImgsScript()`)
 *   · รูปโหลดไม่สำเร็จ **ต้องเขียนบนกระดาษว่าโหลดไม่สำเร็จ ห้ามพิมพ์ช่องว่างเฉยๆ**
 *     (กฎความซื่อสัตย์ของจอ — ช่องว่างบนใบที่ยื่นออกไป อ่านได้ว่า "ไม่มีรูป" ซึ่งไม่จริง)
 *   · ไม่มีรูปสักใบ = **ไม่สร้างหน้าภาคผนวกเลย** ห้ามแนบหน้าว่าง
 *
 * ⚠️ egress: แผนนี้ไม่มี image transform — รูป 1 ใบ = โหลดไฟล์เต็ม (~100-200 KB)
 *   หน้าพิมพ์จึงดึงเท่าจำนวนรูปที่มีจริง (คนกดพิมพ์เอง นานๆ ครั้ง) · อย่าเอา pattern นี้ไปใช้กับจอรายการ
 */

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** CSS ของหน้าภาคผนวก — ไม่แตะ @page ของเอกสารแม่ (แนวกระดาษตามใบหลักเสมอ) */
export const PHOTO_APPENDIX_CSS = `
  .appx { page-break-before: always; }
  .appx .appx-hd { display:flex; align-items:center; border:1.4px solid #000; padding:3px 6px; gap:8px; margin-bottom:3mm }
  .appx .appx-hd h2 { flex:1; margin:0; text-align:center; font-size:13px; font-weight:800 }
  .appx .appx-hd .appx-pn { width:70px; text-align:right; font-size:9px; color:#444 }
  .appx .appx-hd .appx-lg { width:56px; flex:0 0 auto }
  .appx .appx-hd .appx-lg img { max-width:100%; max-height:28px }
  .appx-grid { display:grid; gap:3mm }
  .appx-cell { border:1px solid #000; padding:2px; display:flex; flex-direction:column; break-inside:avoid }
  .appx-cap { font-size:8.5px; font-weight:700; line-height:1.25; padding:1px 2px 2px; border-bottom:1px solid #ccc; margin-bottom:2px }
  .appx-cap span { font-weight:400; color:#444 }
  .appx-ph { width:100%; object-fit:contain; background:#f2f2f2; display:block }
  .appx-miss { display:flex; align-items:center; justify-content:center; text-align:center;
               background:#f7f7f7; border:1px dashed #999; color:#a00; font-size:8.5px; padding:4px }
  .appx-note { font-size:8px; color:#555; margin-top:2mm; line-height:1.35 }
`;

/**
 * สคริปต์รอรูปโหลดให้ครบก่อนพิมพ์ — ประกาศ `window.__waitImgs(cb)`
 * · ไม่มีรูป = เรียก cb ทันที · โหลดพัง/ช้าเกิน timeout = ติดป้ายบนช่องนั้นแล้วพิมพ์ต่อ
 * 🔴 ห้ามปล่อยให้รอไม่จบ — ผู้ใช้กดพิมพ์แล้วจอค้างโดยไม่มีอะไรเกิดขึ้น แย่กว่าใบที่รูปขาด 1 ช่อง
 */
export const waitImgsScript = (timeoutMs = 8000) => `
  window.__waitImgs = function (cb) {
    var imgs = [].slice.call(document.images || []);
    if (!imgs.length) return cb();
    var left = imgs.length, done = false;
    function fin() { if (!done) { done = true; cb(); } }
    function one(img, ok) {
      if (!ok) {
        var box = document.createElement('div');
        box.className = 'appx-miss';
        box.style.height = img.style.height || '60mm';
        box.textContent = 'โหลดรูปไม่สำเร็จ — เปิดดูรูปในระบบแทน';
        if (img.parentNode) img.parentNode.replaceChild(box, img);
      }
      if (--left <= 0) fin();
    }
    imgs.forEach(function (img) {
      if (img.complete) return one(img, img.naturalWidth > 0);
      img.addEventListener('load', function () { one(img, true); });
      img.addEventListener('error', function () { one(img, false); });
    });
    setTimeout(function () {
      imgs.forEach(function (img) { if (!img.complete || !img.naturalWidth) one(img, false); });
      fin();
    }, ${Number(timeoutMs) || 8000});
  };
`;

/**
 * สร้าง HTML หน้าภาคผนวก
 * @param entries  [{ url, no, label, sub }] — `no` = เลขแถวในใบหลัก · `label` = เช่น "รูปตอนพบ"
 * @param opts.cols      ช่องต่อแถว (แนวนอน 4 · แนวตั้ง 3)
 * @param opts.rows      แถวต่อหน้า
 * @param opts.imgH      ความสูงช่องรูป (CSS length)
 * @returns '' ถ้าไม่มีรูปเลย — ตั้งใจให้ผู้เรียกต่อสตริงได้โดยไม่ต้องเช็คซ้ำ
 */
export function photoAppendixHtml(entries, {
  title = 'ภาคผนวก : รูปหลักฐาน', logo = '', code = '', note = '',
  cols = 4, rows = 2, imgH = '62mm',
} = {}) {
  const list = (entries || []).filter(e => e && e.url);
  if (!list.length) return '';
  const per = Math.max(1, cols * rows);
  const pages = [];
  for (let i = 0; i < Math.ceil(list.length / per); i++) pages.push(list.slice(i * per, (i + 1) * per));

  const cell = (e) => `
    <div class="appx-cell">
      <div class="appx-cap">${e.no != null ? `No.${esc(e.no)} · ` : ''}${esc(e.label || 'รูป')}${
        e.sub ? `<br><span>${esc(e.sub)}</span>` : ''}</div>
      <img class="appx-ph" src="${esc(e.url)}" alt="" style="height:${imgH}">
    </div>`;

  return pages.map((ph, i) => `
  <section class="pg appx">
    <div class="appx-hd">
      <div class="appx-lg">${logo ? `<img src="${logo}" alt="">` : ''}</div>
      <h2>${esc(title)}</h2>
      <div class="appx-pn">${pages.length > 1 ? `ภาคผนวก ${i + 1}/${pages.length}` : 'เอกสารแนบ'}</div>
    </div>
    <div class="appx-grid" style="grid-template-columns:repeat(${cols},1fr)">
      ${ph.map(cell).join('')}
    </div>
    <div class="appx-note">${esc(note || 'หน้านี้เป็นเอกสารแนบ ไม่ใช่เนื้อฟอร์ม — เลขฟอร์ม/Rev. ของใบหลักไม่เปลี่ยน')}${
      code ? ` · อ้างอิงใบ ${esc(code)}` : ''}</div>
  </section>`).join('');
}
