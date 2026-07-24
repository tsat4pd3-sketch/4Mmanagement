/**
 * scrapExportExcel — export ใบรายงานของเสียให้ตรงฟอร์ม FM-PD2-002 Rev.06 (100%)
 *
 * โครงตาราง (คอลัมน์ A..S):
 *   A ลำดับ · B PART NO. · C PART NAME · D MAT'L SAP · E รูป · F MODEL
 *   G CODE · H BOM · I Q'TY · J-N สาเหตุ M1-M5 · O ยืนยันจำนวน · P-S รหัสงานเสีย
 * หัว/ท้าย/สายอนุมัติ mirror ฟอร์มกระดาษ
 */
import ExcelJS from 'exceljs';
import { getDocForm, fullCode } from '../utils/docForms';

const M_COL = { m1: 'J', m2: 'K', m3: 'L', m4: 'M', m5: 'N' };
const thin = { style: 'thin' };
const allBorder = { top: thin, bottom: thin, left: thin, right: thin };

function box(ws, ref, value, opt = {}) {
  const c = ws.getCell(ref);
  c.value = value ?? '';
  const font = { size: opt.size ?? 9 };
  if (opt.bold) font.bold = true;
  if (opt.color) font.color = { argb: opt.color };
  c.font = font;
  c.alignment = { horizontal: opt.align || 'left', vertical: 'middle', wrapText: !!opt.wrap };
  if (opt.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opt.fill } };
  if (opt.border) c.border = allBorder;
}
const merge = (ws, r) => { try { ws.mergeCells(r); } catch { /* already merged */ } };

export async function exportScrapReportExcel({ report, items, defectTypes }) {
  // เลขฟอร์ม/Rev/ป้ายช่องลายเซ็น อ่านจากทะเบียนเอกสาร (/doc-forms) — fallback = ค่าเดิมในโค้ดเสมอ
  const df = await getDocForm('scrap_report', {
    form_code: 'FM-PD2-002', rev: 'Rev.06', title: 'ใบรายงานของเสีย (SCRAP REPORT)',
    sig_blocks: ['พนักงาน QC', 'หัวหน้าแผนก', 'ผู้จัดการ QA/QC', 'ผู้จัดการผลิต', 'ผู้จัดการทั่วไป'],
  });
  const sig = (Array.isArray(df.sig_blocks) && df.sig_blocks.length >= 5)
    ? df.sig_blocks : ['พนักงาน QC', 'หัวหน้าแผนก', 'ผู้จัดการ QA/QC', 'ผู้จัดการผลิต', 'ผู้จัดการทั่วไป'];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ESM Scrap Report';
  const ws = wb.addWorksheet('FM-PD2-002', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
  });
  // ความกว้างคอลัมน์ A..S (19 คอลัมน์)
  [4, 14, 20, 11, 8, 7, 6, 7, 7, 4, 4, 4, 4, 4, 9, 5, 5, 5, 5]
    .forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.properties.defaultRowHeight = 15;

  // ── หัวบริษัท ──
  merge(ws, 'A1:S1'); box(ws, 'A1', 'บริษัท ไทยซัมมิท โอโตโมทีฟ จำกัด (สาขา1)', { bold: true, size: 11, align: 'center' });
  merge(ws, 'A2:S2'); box(ws, 'A2', 'THAI SUMMIT AUTOMOTIVE CO.,LTD. (Branch1)', { size: 9, align: 'center' });
  merge(ws, 'A3:S3'); box(ws, 'A3', '500/82 หมู่ 3 ตำบลตาสิทธิ์ อำเภอปลวกแดง จังหวัดระยอง 21140', { size: 8, align: 'center' });

  merge(ws, 'A5:G7'); box(ws, 'A5', 'ใบรายงานของเสีย\nSCRAP  REPORT', { bold: true, size: 14, align: 'center', wrap: true });
  const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  box(ws, 'H5', 'วันที่'); box(ws, 'I5', fmtD(report.report_date), { size: 9 });
  box(ws, 'L5', 'เลขที่'); merge(ws, 'M5:S5'); box(ws, 'M5', report.doc_no || '', { size: 9 });
  box(ws, 'H6', 'แผนก'); box(ws, 'I6', report.dept || '', { size: 9 });
  box(ws, 'L6', 'ส่วน'); merge(ws, 'M6:S6'); box(ws, 'M6', report.section || '', { size: 9 });
  box(ws, 'H7', 'ฝ่าย'); box(ws, 'I7', report.division || 'TSAT4', { size: 9 });
  box(ws, 'L7', 'ไลน์'); merge(ws, 'M7:S7'); box(ws, 'M7', report.line_name || '', { size: 9 });

  merge(ws, 'A9:E9'); box(ws, 'A9', 'เรียน ผู้จัดการส่วนอาคารและสถานที่ฝ่าย HRM', { size: 9 });
  const cats = report.product_categories || [];
  const chk = k => (cats.includes(k) ? '☑' : '☐');
  merge(ws, 'F9:O9');
  box(ws, 'F9', `ประเภทชิ้นงาน  ${chk('FG')} FG   ${chk('SEMI')} SEMI   ${chk('RM')} RM   ${chk('TR')} TR   ${chk('OTHER')} อื่นๆ`, { size: 9 });
  merge(ws, 'P9:S9'); box(ws, 'P9', `Storage: ${report.storage_location || ''}`, { size: 8 });
  merge(ws, 'A10:S10');
  box(ws, 'A10', 'M1=จากคน   M2=จากเครื่องจักร/อุปกรณ์   M3=จากวัตถุดิบ/ชิ้นส่วน   M4=จากวิธีการทำงาน   M5=จากการสะสาง', { size: 8 });

  // ── หัวตาราง (แถว 11-15) ──
  const H = { A: 'ลำดับ', E: 'รูป\n(PICTURE)', F: 'รุ่น\n(MODEL)', G: 'CODE', H: 'BOM', I: "จำนวน\n(Q'TY)", O: 'ยืนยัน\nจำนวน' };
  merge(ws, 'A11:A15'); box(ws, 'A11', H.A, { bold: true, size: 8, align: 'center', wrap: true, border: true });
  merge(ws, 'B11:D11'); box(ws, 'B11', 'ชื่อชิ้นงาน', { bold: true, size: 8, align: 'center', border: true });
  merge(ws, 'B12:B15'); box(ws, 'B12', 'PART NO.', { bold: true, size: 8, align: 'center', wrap: true, border: true });
  merge(ws, 'C12:C15'); box(ws, 'C12', 'PART NAME', { bold: true, size: 8, align: 'center', wrap: true, border: true });
  merge(ws, 'D12:D15'); box(ws, 'D12', "MAT'L SAP", { bold: true, size: 8, align: 'center', wrap: true, border: true });
  merge(ws, 'E11:E15'); box(ws, 'E11', H.E, { bold: true, size: 8, align: 'center', wrap: true, border: true });
  merge(ws, 'F11:F15'); box(ws, 'F11', H.F, { bold: true, size: 8, align: 'center', wrap: true, border: true });
  merge(ws, 'G11:G15'); box(ws, 'G11', H.G, { bold: true, size: 8, align: 'center', wrap: true, border: true });
  merge(ws, 'H11:H15'); box(ws, 'H11', H.H, { bold: true, size: 8, align: 'center', wrap: true, border: true });
  merge(ws, 'I11:I15'); box(ws, 'I11', H.I, { bold: true, size: 8, align: 'center', wrap: true, border: true });
  merge(ws, 'J11:N11'); box(ws, 'J11', 'สาเหตุที่เสีย', { bold: true, size: 8, align: 'center', border: true });
  merge(ws, 'J12:N12'); box(ws, 'J12', '(CAUSE OF DEFECT)', { bold: true, size: 7, align: 'center', border: true });
  merge(ws, 'J13:N14'); box(ws, 'J13', 'เสียในกระบวนการผลิต / เสียหลังจบการผลิต', { size: 7, align: 'center', wrap: true, border: true });
  ['J', 'K', 'L', 'M', 'N'].forEach((c, i) => box(ws, `${c}15`, `M${i + 1}`, { bold: true, size: 8, align: 'center', border: true }));
  merge(ws, 'O11:O15'); box(ws, 'O11', H.O, { bold: true, size: 8, align: 'center', wrap: true, border: true });
  merge(ws, 'P11:S15'); box(ws, 'P11', 'สาเหตุ/ลักษณะงานเสีย\n(รหัสประเภทงานเสีย)', { bold: true, size: 8, align: 'center', wrap: true, border: true });

  // ── แถวข้อมูล (16..) — ตรึง 27 แถวเหมือนฟอร์ม ──
  const ROWS = Math.max(27, items.length);
  let r = 16;
  const sorted = [...items].sort((a, b) => (a.seq || 0) - (b.seq || 0));
  for (let i = 0; i < ROWS; i++, r++) {
    const it = sorted[i];
    ws.getRow(r).height = 16;
    box(ws, `A${r}`, i + 1, { size: 8, align: 'center', border: true });
    box(ws, `B${r}`, it?.part_no, { size: 8, border: true });
    box(ws, `C${r}`, it?.part_name, { size: 8, wrap: true, border: true });
    box(ws, `D${r}`, it?.mat_no, { size: 8, align: 'center', border: true });
    box(ws, `E${r}`, '', { border: true });
    box(ws, `F${r}`, it?.model, { size: 8, align: 'center', border: true });
    box(ws, `G${r}`, it?.code, { size: 8, align: 'center', border: true });
    box(ws, `H${r}`, it?.bom_ref, { size: 8, align: 'center', border: true });
    box(ws, `I${r}`, it && it.qty ? Number(it.qty) : '', { size: 8, align: 'center', border: true });
    ['J', 'K', 'L', 'M', 'N'].forEach(c => box(ws, `${c}${r}`, '', { size: 8, align: 'center', border: true }));
    if (it && it.m_cause && M_COL[it.m_cause]) box(ws, `${M_COL[it.m_cause]}${r}`, Number(it.qty) || '', { size: 8, align: 'center', border: true });
    box(ws, `O${r}`, it && it.confirm_qty != null ? Number(it.confirm_qty) : '', { size: 8, align: 'center', border: true });
    merge(ws, `P${r}:S${r}`); box(ws, `P${r}`, it?.defect_codes, { size: 8, align: 'center', border: true });
  }
  // TOTAL
  const totalRow = r;
  merge(ws, `A${totalRow}:H${totalRow}`); box(ws, `A${totalRow}`, 'TOTAL', { bold: true, size: 9, align: 'center', border: true });
  const sumQty = items.reduce((s, x) => s + (Number(x.qty) || 0), 0);
  const sumConfirm = items.reduce((s, x) => s + (Number(x.confirm_qty) || 0), 0);
  box(ws, `I${totalRow}`, sumQty || '', { bold: true, size: 9, align: 'center', border: true });
  ['J', 'K', 'L', 'M', 'N'].forEach((c, i) => {
    const mk = `m${i + 1}`;
    const s = items.filter(x => x.m_cause === mk).reduce((a, x) => a + (Number(x.qty) || 0), 0);
    box(ws, `${c}${totalRow}`, s || '', { bold: true, size: 8, align: 'center', border: true });
  });
  box(ws, `O${totalRow}`, sumConfirm || '', { bold: true, size: 9, align: 'center', border: true });
  merge(ws, `P${totalRow}:S${totalRow}`); box(ws, `P${totalRow}`, '', { border: true });

  // ── ท้ายฟอร์ม: ข้อกำหนด + CODE legend + สายอนุมัติ ──
  let f = totalRow + 2;
  box(ws, `A${f}`, 'ข้อกำหนด', { bold: true, size: 8 });
  merge(ws, `H${f}:M${f}`); box(ws, `H${f}`, `ผู้ตรวจสอบ  ${report.inspector_name || '.......................................'} (${sig[0]})`, { size: 8 });
  merge(ws, `N${f}:S${f}`); box(ws, `N${f}`, `ผู้ขออนุมัติ  ${report.requester_name || '.......................................'} (${sig[1]})`, { size: 8 });
  f++;
  box(ws, `A${f}`, '  1.ทำลายสภาพก่อนนำไปทิ้ง', { size: 8 });
  f++;
  box(ws, `A${f}`, '  2.ให้ทิ้งภายในเวลา 08.00-16.30 น.ในวันทำงานปกติ', { size: 8 });
  merge(ws, `H${f}:M${f}`); box(ws, `H${f}`, `ผู้อนุมัติ  ${report.approver_qa_name || '.......................................'} (${sig[2]})`, { size: 8 });
  merge(ws, `N${f}:S${f}`); box(ws, `N${f}`, `ผู้อนุมัติ  ${report.approver_pd_name || '.......................................'} (${sig[3]})`, { size: 8 });
  f++;
  const CODES = [
    'A = สินค้าสำเร็จรูป (FINISHED GOODS)', 'B = กึ่งสำเร็จรูป (SEMI PRODUCT)',
    'C = วัตถุดิบ/ชิ้นงาน (RAW MATERIAL & PART)', 'D = ชิ้นงานทดลอง/แม่พิมพ์ (TRY-OUT)', 'E = อื่น ๆ',
  ];
  box(ws, `A${f}`, 'รหัสประเภทชิ้นงาน (CODE)', { bold: true, size: 8 });
  merge(ws, `N${f}:S${f}`); box(ws, `N${f}`, `ผู้อนุมัติ  ${report.approver_gm_name || '.......................................'} (${sig[4]})`, { size: 8 });
  f++;
  CODES.forEach((t) => { merge(ws, `A${f}:G${f}`); box(ws, `A${f}`, t, { size: 8 }); f++; });
  merge(ws, `A${f}:S${f}`); box(ws, `A${f}`, `สำเนา : ฝ่ายบัญชี BU TSAT4    ผู้ส่งของ ${report.sender_name || '..................'}    ผู้รับของ (HRM) ${report.receiver_name || '..................'}`, { size: 8 });
  f++;
  // เลขฟอร์มมุมล่างขวา (อ่านจากทะเบียนเอกสาร)
  merge(ws, `P${f}:S${f}`); box(ws, `P${f}`, fullCode(df), { size: 8, align: 'right' });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Scrap_${report.line_name || 'report'}_${report.report_date}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
