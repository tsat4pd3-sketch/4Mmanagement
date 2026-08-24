/**
 * bbsPrint — พิมพ์/บันทึก PDF แบบฟอร์มสังเกตพฤติกรรมความปลอดภัย (BBS)
 *
 * pattern เดียวกับฟอร์มพิมพ์อื่น (LPA/OJT/MO/Scrap/PFC): window.open + print
 * เลขฟอร์ม/Rev/ช่องลายเซ็น/โลโก้/footer อ่านจากทะเบียนกลาง doc_key 'bbs_observation'
 * — ห้าม hardcode (แก้ที่ /doc-forms แล้วใบเปลี่ยนตาม)
 *
 * ⚠️ ข้อความบังคับบนใบ: "ช่องที่เติมอัตโนมัติมาจากผลตรวจ PPE ครอบ N ข้อจากทั้งหมด M ข้อ"
 *    ห้ามถอด — ไม่งั้นใบอ้างเกินจริงว่าสังเกตครบทุกข้อทั้งที่ระบบเติมให้แค่เรื่อง PPE
 */
import { getDocForm, fullCode, withDocFoot, sigAt } from '../utils/docForms';
import tsLogoUrl from '../assets/TS logo.png';
import { MARKS, markGlyph } from '../utils/bbsMarks';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function urlToDataUrl(url) {
  if (!url) return '';
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve('');
      fr.readAsDataURL(blob);
    });
  } catch { return ''; }
}

/**
 * @param {object} p
 * @param {object} p.sheet      หัวใบ (month_key/line_name/section/dept/shift/inspector_*)
 * @param {number} p.days       จำนวนวันในเดือน
 * @param {Array}  p.employees  [{ id, employee_id_code, name }]
 * @param {object} p.cells      { `${empId}|${day}`: { mark, agreement_seq, source } }
 * @param {object} p.rowNotes   { [empId]: 'หมายเหตุท้ายแถว' } — คอลัมน์สุดท้ายของใบกระดาษ
 * @param {Array}  p.agreements [{ seq, text, auto_source }]
 * @param {number} p.autoCount  จำนวนข้อที่ระบบเติมให้ได้ (มี auto_source)
 */
export async function printBbsSheet({ sheet, days, employees = [], cells = {}, rowNotes = {}, agreements = [], autoCount = 0 }) {
  const df = await getDocForm('bbs_observation', {
    title: 'แบบฟอร์มสังเกตพฤติกรรมความปลอดภัย (BBS)',
    sig_blocks: ['ผู้ตรวจสอบ'],
  }, sheet?.section ? { section: sheet.section } : {});

  const logo = await urlToDataUrl(df.logo_url || tsLogoUrl);
  const sigImg = await urlToDataUrl(sheet?.inspector_sig_url);
  const code = fullCode(df);
  const sig0 = sigAt(df, 0);

  const dayCols = Array.from({ length: days }, (_, i) => i + 1);
  const shiftLabel = sheet?.shift === 'day' ? 'กะเช้า' : sheet?.shift === 'night' ? 'กะดึก' : 'ทั้งวัน';
  const [yy, mm] = String(sheet?.month_key || '').split('-');
  const monthLabel = yy && mm
    ? `${['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'][+mm] || mm} ${+yy + 543}`
    : '—';

  const rows = employees.map((e, i) => {
    const tds = dayCols.map(d => {
      const c = cells[`${e.id}|${d}`];
      const g = c ? markGlyph(c) : '';
      const cls = c ? `m-${c.mark}` : '';
      return `<td class="d ${cls}">${esc(g)}</td>`;
    }).join('');
    return `<tr><td class="n">${i + 1}</td><td class="c">${esc(e.employee_id_code || '')}</td>`
      + `<td class="nm">${esc(e.name || '')}</td>${tds}`
      + `<td class="rm">${esc(rowNotes[e.id] || '')}</td></tr>`;
  }).join('');

  // ตารางต้องมีแถวเท่าฟอร์มกระดาษเป็นอย่างน้อย (14 แถว) เพื่อให้เขียนเพิ่มด้วยมือได้
  const blanks = Array.from({ length: Math.max(0, 14 - employees.length) }, (_, i) =>
    `<tr><td class="n">${employees.length + i + 1}</td><td class="c"></td><td class="nm"></td>`
    + dayCols.map(() => '<td class="d"></td>').join('') + '<td class="rm"></td></tr>').join('');

  const agreeHtml = agreements.length
    ? agreements.map(a => `<div class="ag"><b>${a.seq}.</b> ${esc(a.text)}`
        + `${a.auto_source ? ' <span class="au">◆</span>' : ''}</div>`).join('')
    : '<div class="ag" style="color:#b45309">— ยังไม่ได้บันทึกข้อตกลงด้านความปลอดภัยในระบบ —</div>';

  const legend = MARKS.map(m => `<span class="lg"><b>${esc(m.glyph)}</b> ${esc(m.label)}</span>`).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>BBS ${esc(sheet?.line_name || '')} ${esc(sheet?.month_key || '')}</title>
<style>
  @page { size: ${df.paper_size || 'A4'} ${df.orientation || 'landscape'}; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun', Tahoma, sans-serif; font-size: 9px; color: #111; margin: 0; }
  .hd { display: flex; align-items: flex-start; gap: 8px; border: 1px solid #000; padding: 4px 6px; }
  .hd img { height: 26px; }
  .hd .mid { flex: 1; text-align: center; }
  .hd .t { font-size: 13px; font-weight: 700; }
  .hd .sub { font-size: 9.5px; margin-top: 1px; }
  .hd .rt { min-width: 150px; font-size: 8.5px; line-height: 1.5; border-left: 1px solid #000; padding-left: 6px; }
  .hd .rt .lbl { color: #555; }
  table.g { width: 100%; border-collapse: collapse; margin-top: 4px; table-layout: fixed; }
  table.g th, table.g td { border: 1px solid #000; text-align: center; padding: 0; height: 15px; overflow: hidden; }
  table.g th { background: #eee; font-size: 8px; font-weight: 700; }
  td.n, th.n { width: 16px; }
  td.c, th.c { width: 42px; font-size: 8px; }
  td.nm, th.nm { width: 92px; text-align: left; padding-left: 3px; font-size: 8px; white-space: nowrap; }
  td.rm, th.rm { width: 74px; text-align: left; padding-left: 3px; font-size: 7.5px; }
  td.d, th.d { font-size: 8.5px; font-weight: 700; }
  td.m-ng { color: #b91c1c; }
  td.m-na { color: #777; }
  td.m-fixed { color: #1d4ed8; }
  .bot { display: flex; gap: 8px; margin-top: 5px; align-items: flex-start; }
  .box { border: 1px solid #000; padding: 4px 6px; flex: 1; }
  .box h4 { margin: 0 0 3px; font-size: 9.5px; }
  .ag { font-size: 8px; line-height: 1.45; }
  .au { color: #15803d; }
  .lg { display: inline-block; margin-right: 10px; font-size: 8.5px; }
  .sig { width: 190px; text-align: center; border: 1px solid #000; padding: 4px; }
  .sig .im { height: 34px; display: flex; align-items: center; justify-content: center; }
  .sig .im img { max-height: 34px; max-width: 100%; }
  .sig .ln { border-top: 1px dotted #555; margin-top: 2px; padding-top: 2px; font-size: 8.5px; }
  .warn { border: 1px solid #b45309; background: #fffbeb; color: #7c2d12; font-size: 8px;
          padding: 3px 6px; margin-top: 4px; line-height: 1.5; }
</style></head><body>
<div class="hd">
  ${logo ? `<img src="${logo}" alt="">` : ''}
  <div class="mid">
    <div class="t">${esc(df.title || 'แบบฟอร์มสังเกตพฤติกรรมความปลอดภัย (BBS)')}</div>
    <div class="sub">ประจำเดือน ${esc(monthLabel)}</div>
    <div class="sub">แผนก ${esc(sheet?.dept || '-')} · ส่วนงาน ${esc(sheet?.section || '-')}
      · พื้นที่ ${esc(sheet?.line_name || '-')} · ${esc(shiftLabel)}</div>
  </div>
  <div class="rt">
    <div><span class="lbl">บันทึกข้อมูลโดย</span></div>
    <div><span class="lbl">ชื่อ-สกุล:</span> ${esc(sheet?.inspector_name || '')}</div>
    <div><span class="lbl">รหัสพนักงาน:</span> ${esc(sheet?.inspector_code || '')}</div>
    ${code ? `<div><span class="lbl">ฟอร์ม:</span> ${esc(code)}</div>` : ''}
  </div>
</div>

<table class="g">
  <thead><tr>
    <th class="n">ที่</th><th class="c">รหัส</th><th class="nm">ชื่อ-สกุล</th>
    ${dayCols.map(d => `<th class="d">${d}</th>`).join('')}
    <th class="rm">หมายเหตุ</th>
  </tr></thead>
  <tbody>${rows}${blanks}</tbody>
</table>

<div class="bot">
  <div class="box">
    <h4>ข้อตกลงด้านความปลอดภัยในการปฏิบัติงาน (สิ่งที่ควรทำ)</h4>
    ${agreeHtml}
  </div>
  <div class="box" style="max-width:230px">
    <h4>สัญลักษณ์</h4>
    ${legend}
  </div>
  <div class="sig">
    <div style="font-size:8.5px">${esc(sig0.label || 'ผู้ตรวจสอบ')}</div>
    <div class="im">${sigImg ? `<img src="${sigImg}" alt="">` : ''}</div>
    <div class="ln">${esc(sheet?.inspector_name || sig0.name || '')}</div>
  </div>
</div>

<div class="warn">
  ◆ = ข้อที่ระบบเติมให้อัตโนมัติจาก<b>ผลตรวจ PPE รายวัน</b> (${autoCount} ข้อ จากทั้งหมด ${agreements.length} ข้อ)
  — ข้อที่เหลือมาจากการสังเกตของผู้ตรวจเท่านั้น ใบนี้จึงไม่ได้ยืนยันว่าตรวจครบทุกข้อทุกวัน
</div>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(withDocFoot(html, 'bbs_observation',
    sheet?.section ? { section: sheet.section } : {}));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
  return true;
}
