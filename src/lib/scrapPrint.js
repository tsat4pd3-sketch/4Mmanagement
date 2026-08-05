/**
 * scrapPrint — พิมพ์/บันทึก PDF ใบรายงานของเสีย FM-PD2-002 (mirror layout เดียวกับ scrapExportExcel)
 *
 * pattern เดียวกับฟอร์มพิมพ์อื่นในระบบ (LPA/OJT/MO): window.open + print
 * เลขฟอร์ม/Rev/ป้ายช่องลายเซ็น/โลโก้ อ่านจากทะเบียนเอกสารกลาง (doc_key 'scrap_report')
 * — ห้าม hardcode เลขฟอร์ม/Rev/โลโก้ (ดู CLAUDE.md · /doc-forms)
 *
 * เซฟเป็น PDF = เลือก "Save as PDF" ใน dialog พิมพ์ของเบราว์เซอร์
 */
import { getDocForm, fullCode } from '../utils/docForms';
import tsLogoUrl from '../assets/TS logo.png';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function urlToDataUrl(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise(resolve => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve('');
      fr.readAsDataURL(blob);
    });
  } catch { return ''; }
}

const M_KEYS = ['m1', 'm2', 'm3', 'm4', 'm5'];
const CODES = [
  'A = สินค้าสำเร็จรูป (FINISHED GOODS)', 'B = กึ่งสำเร็จรูป (SEMI PRODUCT)',
  'C = วัตถุดิบ/ชิ้นงาน (RAW MATERIAL & PART)', 'D = ชิ้นงานทดลอง/แม่พิมพ์ (TRY-OUT)', 'E = อื่น ๆ',
];

export async function printScrapReport({ report, items }) {
  const df = await getDocForm('scrap_report', {
    form_code: 'FM-PD2-002', rev: 'Rev.06', title: 'ใบรายงานของเสีย (SCRAP REPORT)',
    sig_blocks: ['พนักงาน QC', 'หัวหน้าแผนก', 'ผู้จัดการ QA/QC', 'ผู้จัดการผลิต', 'ผู้จัดการทั่วไป'],
  });
  const sig = (Array.isArray(df.sig_blocks) && df.sig_blocks.length >= 5)
    ? df.sig_blocks : ['พนักงาน QC', 'หัวหน้าแผนก', 'ผู้จัดการ QA/QC', 'ผู้จัดการผลิต', 'ผู้จัดการทั่วไป'];
  const logo = await urlToDataUrl(df.logo_url || tsLogoUrl);

  const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const cats = report.product_categories || [];
  const chk = k => (cats.includes(k) ? '☑' : '☐');

  const sorted = [...items].sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const ROWS = Math.max(27, sorted.length);   // ตรึงจำนวนแถวเหมือนฟอร์มกระดาษ
  const rowsHtml = Array.from({ length: ROWS }, (_, i) => {
    const it = sorted[i];
    // ช่อง M1-M5 = เครื่องหมายติ๊กสาเหตุ (ไม่ใช่จำนวน — จำนวนอยู่คอลัมน์ Q'TY/ยืนยัน)
    const mCells = M_KEYS.map(k => `<td class="c m">${it && it.m_cause === k ? '✓' : ''}</td>`).join('');
    return `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(it?.part_no)}</td>
      <td>${esc(it?.part_name)}</td>
      <td class="c">${esc(it?.mat_no)}</td>
      <td></td>
      <td class="c">${esc(it?.model)}</td>
      <td class="c">${esc(it?.code)}</td>
      <td class="c">${esc(it?.bom_ref)}</td>
      <td class="c">${it && it.qty ? Number(it.qty) : ''}</td>
      ${mCells}
      <td class="c">${it && it.confirm_qty != null && it.confirm_qty !== '' ? Number(it.confirm_qty) : ''}</td>
      <td class="c">${esc(it?.defect_codes)}</td>
    </tr>`;
  }).join('');

  const sumQty = items.reduce((s, x) => s + (Number(x.qty) || 0), 0);
  const sumConfirm = items.reduce((s, x) => s + (Number(x.confirm_qty) || 0), 0);
  // TOTAL ของ M1-M5 = จำนวน "รายการ" ที่ติ๊กสาเหตุนั้น (สอดคล้องกับช่องติ๊กด้านบน)
  const mTotals = M_KEYS.map(k => `<td class="c m b">${items.filter(x => x.m_cause === k).length || ''}</td>`).join('');

  const sigLine = (label, name) => `${esc(label)} ${esc(name || '.......................................')}`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(df.form_code || 'FM-PD2-002')} ${esc(report.doc_no || '')}</title>
<style>
  @page { size: A4 portrait; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun', Tahoma, sans-serif; font-size: 9px; color: #000; margin: 0; }
  .hd { text-align: center; }
  .hd .co { font-size: 12px; font-weight: 800; }
  .hd .en { font-size: 9px; }
  .hd .ad { font-size: 8px; }
  .logo { position: absolute; left: 8mm; top: 6mm; height: 42px; }
  .title { font-size: 15px; font-weight: 800; text-align: center; line-height: 1.25; }
  table { border-collapse: collapse; width: 100%; }
  .meta td { font-size: 9px; padding: 1px 3px; border: none; }
  .grid th, .grid td { border: 1px solid #000; padding: 1px 3px; font-size: 8px; height: 15px; }
  .grid th { font-weight: 700; text-align: center; }
  .c { text-align: center; }
  .b { font-weight: 800; }
  .m { width: 16px; font-size: 10px; font-weight: 800; }
  .note { font-size: 8px; margin: 3px 0; }
  .foot { font-size: 8px; margin-top: 6px; }
  .foot td { padding: 2px 4px; vertical-align: top; border: none; }
  .code-no { text-align: right; font-size: 8px; margin-top: 4px; }
</style></head><body>
  ${logo ? `<img class="logo" src="${logo}" />` : ''}
  <div class="hd">
    <div class="co">บริษัท ไทยซัมมิท โอโตโมทีฟ จำกัด (สาขา1)</div>
    <div class="en">THAI SUMMIT AUTOMOTIVE CO.,LTD. (Branch1)</div>
    <div class="ad">500/82 หมู่ 3 ตำบลตาสิทธิ์ อำเภอปลวกแดง จังหวัดระยอง 21140</div>
  </div>

  <table class="meta" style="margin-top:6px">
    <tr>
      <td style="width:46%" rowspan="3"><div class="title">ใบรายงานของเสีย<br/>SCRAP&nbsp;&nbsp;REPORT</div></td>
      <td style="width:9%">วันที่</td><td style="width:16%">${esc(fmtD(report.report_date))}</td>
      <td style="width:9%">เลขที่</td><td>${esc(report.doc_no || '')}</td>
    </tr>
    <tr><td>แผนก</td><td>${esc(report.dept || '')}</td><td>ส่วน</td><td>${esc(report.section || '')}</td></tr>
    <tr><td>ฝ่าย</td><td>${esc(report.division || 'TSAT4')}</td><td>ไลน์</td><td>${esc(report.line_name || '')}</td></tr>
  </table>

  <table class="meta" style="margin-top:4px">
    <tr>
      <td style="width:34%">เรียน ผู้จัดการส่วนอาคารและสถานที่ฝ่าย HRM</td>
      <td>ประเภทชิ้นงาน&nbsp; ${chk('FG')} FG&nbsp;&nbsp; ${chk('SEMI')} SEMI&nbsp;&nbsp; ${chk('RM')} RM&nbsp;&nbsp; ${chk('TR')} TR&nbsp;&nbsp; ${chk('OTHER')} อื่นๆ</td>
      <td style="text-align:right">Storage: ${esc(report.storage_location || '')}</td>
    </tr>
  </table>
  <div class="note">M1=จากคน&nbsp;&nbsp; M2=จากเครื่องจักร/อุปกรณ์&nbsp;&nbsp; M3=จากวัตถุดิบ/ชิ้นส่วน&nbsp;&nbsp; M4=จากวิธีการทำงาน&nbsp;&nbsp; M5=จากการสะสาง</div>

  <table class="grid">
    <thead>
      <tr>
        <th rowspan="3" style="width:22px">ลำดับ</th>
        <th colspan="3">ชื่อชิ้นงาน</th>
        <th rowspan="3" style="width:46px">รูป<br/>(PICTURE)</th>
        <th rowspan="3" style="width:38px">รุ่น<br/>(MODEL)</th>
        <th rowspan="3" style="width:30px">CODE</th>
        <th rowspan="3" style="width:36px">BOM</th>
        <th rowspan="3" style="width:34px">จำนวน<br/>(Q'TY)</th>
        <th colspan="5">สาเหตุที่เสีย (CAUSE OF DEFECT)</th>
        <th rowspan="3" style="width:44px">ยืนยัน<br/>จำนวน</th>
        <th rowspan="3" style="width:70px">สาเหตุ/ลักษณะงานเสีย<br/>(รหัสประเภทงานเสีย)</th>
      </tr>
      <tr><th colspan="5" style="font-size:7px">เสียในกระบวนการผลิต / เสียหลังจบการผลิต</th></tr>
      <tr>${M_KEYS.map((_, i) => `<th class="m">M${i + 1}</th>`).join('')}</tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr>
        <td class="c b" colspan="8">TOTAL</td>
        <td class="c b">${sumQty || ''}</td>
        ${mTotals}
        <td class="c b">${sumConfirm || ''}</td>
        <td></td>
      </tr>
    </tbody>
  </table>

  <table class="foot">
    <tr>
      <td style="width:40%">
        <b>ข้อกำหนด</b><br/>
        &nbsp;&nbsp;1.ทำลายสภาพก่อนนำไปทิ้ง<br/>
        &nbsp;&nbsp;2.ให้ทิ้งภายในเวลา 08.00-16.30 น.ในวันทำงานปกติ<br/><br/>
        <b>รหัสประเภทชิ้นงาน (CODE)</b><br/>
        ${CODES.map(t => `&nbsp;&nbsp;${esc(t)}`).join('<br/>')}
      </td>
      <td style="width:30%">
        ผู้ตรวจสอบ ${sigLine('', report.inspector_name)}<br/>(${esc(sig[0])})<br/><br/>
        ผู้อนุมัติ ${sigLine('', report.approver_qa_name)}<br/>(${esc(sig[2])})<br/><br/>
        ผู้อนุมัติ ${sigLine('', report.approver_gm_name)}<br/>(${esc(sig[4])})
      </td>
      <td style="width:30%">
        ผู้ขออนุมัติ ${sigLine('', report.requester_name)}<br/>(${esc(sig[1])})<br/><br/>
        ผู้อนุมัติ ${sigLine('', report.approver_pd_name)}<br/>(${esc(sig[3])})
      </td>
    </tr>
    <tr><td colspan="3">สำเนา : ฝ่ายบัญชี BU TSAT4&nbsp;&nbsp;&nbsp; ผู้ส่งของ ${esc(report.sender_name || '..................')}&nbsp;&nbsp;&nbsp; ผู้รับของ (HRM) ${esc(report.receiver_name || '..................')}</td></tr>
  </table>
  <div class="code-no">${esc(fullCode(df))}</div>
<script>window.onload = () => window.print();</script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}
