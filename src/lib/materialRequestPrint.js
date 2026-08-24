/**
 * materialRequestPrint — พิมพ์/บันทึก PDF ใบขอเบิก/คืนสินค้าคงคลัง FM-STO-003 Rev.01
 *
 * pattern เดียวกับฟอร์มพิมพ์อื่น (LPA/OJT/MO/Scrap/BBS): window.open + print
 * เลขฟอร์ม/Rev/Effective/ช่องลายเซ็น/โลโก้/footer อ่านจากทะเบียนกลาง doc_key 'material_request'
 * — ห้าม hardcode (แก้ที่ /doc-forms แล้วใบเปลี่ยนตาม)
 *
 * ⚠️ ใบนี้เป็น "เอกสาร" → ห้ามพับข้อความใดๆ ด้วย InfoMore (UI-CONVENTIONS §6.10 ข้อยกเว้น)
 */
import { getDocForm, fullCode, withDocFoot, sigAt } from '../utils/docForms';
import tsLogoUrl from '../assets/TS logo.png';
import { WITHDRAW_MOVES, RETURN_MOVES } from '../utils/materialRequest';

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

/** ช่องกรอกแบบ "กล่องทีละตัวอักษร" เหมือนบนใบกระดาษ */
const boxes = (val, n) => {
  const s = String(val ?? '');
  return `<span class="bx">${Array.from({ length: n }, (_, i) =>
    `<i>${esc(s[i] || '')}</i>`).join('')}</span>`;
};

const tick = (on) => `<span class="tk">${on ? '✓' : ''}</span>`;

/** แถวจำนวนแถวคงที่ตามใบกระดาษ (19 แถว) — เหลือให้เขียนเพิ่มด้วยมือหน้างานได้ */
const MIN_ROWS = 19;

export async function printMaterialRequest({ req, items = [], section = null }) {
  const df = await getDocForm('material_request', {
    form_code: 'FM-STO-003', rev: 'Rev.01', effective_date: '01/08/2023',
    title: 'แบบฟอร์มการขอเบิก/คืนสินค้าคงคลัง',
    sig_blocks: ['จัดทำโดย', 'อนุมัติโดย', 'รับ/คืนสินค้าคงคลังโดย', 'บันทึกโดย', 'ตรวจสอบโดย'],
  }, section ? { section } : {});

  const logo = await urlToDataUrl(df.logo_url || tsLogoUrl);
  const code = fullCode(df);

  // ลายเซ็น 5 ช่อง — ชื่อ/รูป/วันที่ เก็บบนหัวใบ (snapshot ตอนบันทึก)
  const sigDefs = [
    { k: 'made_by', i: 0 }, { k: 'approved_by', i: 1 }, { k: 'received_by', i: 2 },
    { k: 'recorded_by', i: 3 }, { k: 'checked_by', i: 4 },
  ];
  const sigImgs = await Promise.all(sigDefs.map(d => urlToDataUrl(req?.[`${d.k}_sig_url`])));

  const isW = req?.kind !== 'return';
  const mv = (kind, c) => (isW === (kind === 'w') && req?.move_code === c);

  const rows = Array.from({ length: Math.max(MIN_ROWS, items.length) }, (_, i) => {
    const it = items[i];
    return `<tr>
      <td class="c">${i + 1}</td>
      <td class="m">${esc(it?.mat_no || '')}</td>
      <td class="d">${esc(it?.description || '')}</td>
      <td class="c">${it?.qty != null && it?.qty !== '' ? esc(it.qty) : ''}</td>
      <td class="u">${esc(it ? (it.unit || '') : '')}</td>
      <td class="c">${it?.qty_issued != null && it?.qty_issued !== '' ? esc(it.qty_issued) : ''}</td>
      <td class="c">${esc(it?.produced_date || '')}</td>
      <td class="c">${esc(it?.batch_no || '')}</td>
    </tr>`;
  }).join('');

  const sigCell = (d, idx) => {
    const s = sigAt(df, d.i);
    const img = sigImgs[idx];
    return `<td class="sg">
      <div class="sl">${esc(s.label || '')}</div>
      <div class="si">${img ? `<img src="${img}" alt="">` : ''}</div>
      <div class="sn">${esc(req?.[`${d.k}_name`] || s.name || '')}</div>
      <div class="sd">${esc(req?.[`${d.k}_date`] || '')}</div>
    </td>`;
  };

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(df.form_code || 'FM-STO-003')} ${esc(req?.doc_no || '')}</title>
<style>
  @page { size: ${df.paper_size || 'A4'} ${df.orientation || 'portrait'}; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun', Tahoma, sans-serif; font-size: 10px; color: #000; margin: 0; }
  table { border-collapse: collapse; width: 100%; }
  .ol { border: 1.4px solid #000; }
  .hd { display: flex; align-items: center; border-bottom: 1.4px solid #000; }
  .hd .lg { padding: 4px 6px; border-right: 1.4px solid #000; }
  .hd .lg img { height: 30px; }
  .hd .ti { flex: 1; padding: 3px 8px; }
  .hd .ti .c1 { font-size: 11.5px; font-weight: 700; }
  .hd .ti .c2 { font-size: 13px; font-weight: 700; margin-top: 2px; }
  .hd .dn { width: 300px; border-left: 1.4px solid #000; }
  .hd .dn .top { background: #ddd; text-align: center; font-size: 9px; border-bottom: 1px solid #000; padding: 2px; }
  .hd .dn .bot { padding: 3px 6px; font-size: 9.5px; display: flex; align-items: center; gap: 4px; }
  .sec { border-bottom: 1.4px solid #000; padding: 5px 8px; }
  .row { display: flex; gap: 14px; flex-wrap: wrap; align-items: baseline; }
  .f { display: flex; align-items: baseline; gap: 4px; }
  .f .k { white-space: nowrap; }
  .f .v { border-bottom: 1px dotted #333; min-width: 90px; padding: 0 4px; font-weight: 700; }
  .bx i { display: inline-block; width: 13px; height: 15px; border: 1px solid #000; border-left: 0;
          text-align: center; font-style: normal; font-size: 9px; line-height: 15px; vertical-align: middle; }
  .bx i:first-child { border-left: 1px solid #000; }
  .tk { display: inline-block; width: 11px; height: 11px; border: 1px solid #000;
        text-align: center; line-height: 10px; font-size: 9px; margin-right: 3px; vertical-align: middle; }
  .gt { font-weight: 700; margin-bottom: 3px; }
  .opt { display: flex; align-items: center; gap: 4px; margin-bottom: 2px; }
  .cols { display: flex; gap: 10px; }
  .cols > div { flex: 1; }
  table.it th, table.it td { border: 1px solid #000; padding: 2px 3px; font-size: 9px; }
  table.it th { background: #eee; text-align: center; font-weight: 700; }
  table.it td.c { text-align: center; }
  table.it td.u { text-align: center; width: 32px; }
  table.it td.m { width: 88px; }
  table.it td.d { }
  table.it td:nth-child(1) { width: 26px; }
  table.it td:nth-child(6) { width: 70px; }
  table.it td:nth-child(7) { width: 56px; }
  table.it td:nth-child(8) { width: 60px; }
  table.sig td { border: 1px solid #000; vertical-align: top; }
  td.sg { text-align: center; padding: 3px 2px; }
  td.sg .sl { font-size: 9px; }
  td.sg .si { height: 34px; display: flex; align-items: center; justify-content: center; }
  td.sg .si img { max-height: 34px; max-width: 100%; }
  td.sg .sn { border-top: 1px dotted #555; font-size: 9px; padding-top: 1px; }
  td.sg .sd { font-size: 8.5px; color: #333; }
  .gh { background: #eee; text-align: center; font-weight: 700; font-size: 9.5px; padding: 2px; }
  .ft { display: flex; justify-content: space-between; font-size: 9.5px; margin-top: 5px; }
</style></head><body>
<div class="ol">
  <div class="hd">
    <div class="lg">${logo ? `<img src="${logo}" alt="">` : ''}</div>
    <div class="ti">
      <div class="c1">บริษัท ไทยซัมมิท โอโตโมทีฟ จำกัด (สาขา1)</div>
      <div class="c2">${esc(df.title || 'แบบฟอร์มการขอเบิก/คืนสินค้าคงคลัง')}</div>
    </div>
    <div class="dn">
      <div class="top">สำหรับเจ้าหน้าที่คลังสินค้า / สโตร์เท่านั้น</div>
      <div class="bot"><span>เลขที่เอกสาร<br><span style="font-size:8px">Material Document No.</span></span>
        ${boxes(req?.doc_no, 10)}</div>
    </div>
  </div>

  <div class="sec">
    <div class="row">
      <div class="f"><span class="k">ชื่อผู้ขอเบิก :</span><span class="v">${esc(req?.requester_name || '')}</span></div>
      <div class="f"><span class="k">หน่วยงาน/ตำแหน่ง :</span><span class="v">${esc(req?.requester_dept || '')}</span></div>
    </div>
    <div class="row" style="margin-top:3px">
      <div class="f"><span class="k">วันที่เบิก :</span><span class="v">${esc(req?.request_date || '')}</span></div>
      <div class="f"><span class="k">วันที่ต้องการสินค้า :</span><span class="v">${esc(req?.need_date || '')}</span></div>
    </div>
  </div>

  <div class="sec">
    <div class="cols">
      <div>
        <div class="gt">ประเภทของการเบิก</div>
        ${WITHDRAW_MOVES.map(m => `<div class="opt">${tick(mv('w', m.code))}<span>${esc(m.label)}</span></div>`).join('')}
      </div>
      <div style="max-width:330px">
        <div class="opt" style="margin-top:14px">Storage Location ปลายทาง : ${boxes(isW ? req?.dest_storage_location : '', 4)}</div>
        <div class="opt">Order : ${boxes(isW ? req?.order_no : '', 10)}</div>
        <div class="opt">Cost Center : ${boxes(isW ? req?.cost_center : '', 10)}</div>
      </div>
    </div>
    <div class="cols" style="margin-top:6px">
      <div>
        <div class="gt">ประเภทของการคืน</div>
        ${RETURN_MOVES.map(m => `<div class="opt">${tick(mv('r', m.code))}<span>${esc(m.label)}</span></div>`).join('')}
      </div>
      <div style="max-width:330px">
        <div class="opt" style="margin-top:14px">Storage Location ปลายทาง : ${boxes(!isW ? req?.dest_storage_location : '', 4)}</div>
        <div class="opt">Cost Center : ${boxes(!isW ? req?.cost_center : '', 10)}</div>
      </div>
    </div>
  </div>

  <div class="sec">
    <div class="row">
      <span>ต้องการสินค้าคงคลังจาก / คืนเข้า</span>
      <div class="f"><span class="k">รหัสโรงงาน :</span>${boxes(req?.plant_code, 4)}<span style="font-size:8px">(Plant)</span></div>
      <div class="f"><span class="k">รหัสคลังสินค้า / สโตร์ :</span>${boxes(req?.storage_location, 4)}<span style="font-size:8px">(Storage Location)</span></div>
    </div>
    <div class="f" style="margin-top:3px"><span class="k">รายละเอียด</span>
      <span class="v" style="flex:1">${esc(req?.detail || '')}</span></div>
  </div>

  <table class="it">
    <thead><tr>
      <th>ลำดับ<br>ที่</th><th>รหัสสินค้าคงคลัง</th><th>รายละเอียด</th>
      <th colspan="2">จำนวนที่<br>ขอเบิก/คืน</th><th>จำนวน<br>ที่จ่าย/รับคืน</th>
      <th>วันที่ผลิต</th><th>Batch No.</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <table class="sig">
    <tr><td class="gh" colspan="3">ผู้เบิก / คืน</td><td class="gh" colspan="2">ผู้จ่ายสินค้าคงคลัง</td></tr>
    <tr>${sigDefs.map((d, i) => sigCell(d, i)).join('')}</tr>
  </table>
</div>

<div class="ft">
  <span>${esc(code)}</span>
  <span>${df.effective_date ? `Effective Date : ${esc(df.effective_date)}` : ''}</span>
</div>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(withDocFoot(html, 'material_request', section ? { section } : {}));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
  return true;
}
