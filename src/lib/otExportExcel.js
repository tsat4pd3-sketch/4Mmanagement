/**
 * otExportExcel — ไฟล์สรุป "OT รายบุคคล" ต่อเดือน สำหรับส่งกลับ HR/ฝ่ายบุคคล
 *
 * รูปคอลัมน์ล้อไฟล์ที่ HR ส่งมาถามทุกเดือน (TSAT4-ข้อมูล OT รายบุคคล):
 *   A ลำดับ · B รหัสพนักงาน · C ชื่อ-นามสกุล · D ตำแหน่ง · E ส่วน · F ฝ่าย
 *   G OT วันทำงาน · H OT วันหยุด · I Total (วัน) · J หมายเหตุ (เหตุผล)
 * เปิดแล้วก๊อปทับไฟล์ของ HR ได้ทันที ไม่ต้องจัดคอลัมน์ใหม่
 *
 * กฎ Doc Control (CLAUDE.md): เอกสาร export ใหม่ทุกตัวต้อง register ใน /doc-forms —
 * doc_key = 'ot_monthly_summary' (seed ไว้แบบ form_code=null · migration 20260915_doc_form_ot_monthly.sql)
 * ห้าม hardcode เลขฟอร์ม/Rev ในไฟล์นี้ — อ่านผ่าน getDocForm + fallback ค่าเดิมเสมอ
 */
import { getDocForm, fullCode } from '../utils/docForms';

const TH_MONTH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

export function thaiMonthLabel(monthKey) {
  const [y, m] = String(monthKey || '').split('-').map(Number);
  if (!y || !m) return monthKey || '';
  return `${TH_MONTH[m - 1] || m} ${y + 543}`;
}

const thin = { style: 'thin' };
const allBorder = { top: thin, bottom: thin, left: thin, right: thin };

function put(ws, ref, value, opt = {}) {
  const c = ws.getCell(ref);
  c.value = value ?? '';
  c.font = { size: opt.size ?? 10, bold: !!opt.bold, name: 'Tahoma' };
  c.alignment = { horizontal: opt.align || 'left', vertical: 'middle', wrapText: !!opt.wrap };
  if (opt.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opt.fill } };
  if (opt.border !== false) c.border = allBorder;
}
const mergeSafe = (ws, r) => { try { ws.mergeCells(r); } catch { /* merged already */ } };

/**
 * @param {object} p
 * @param {string} p.monthKey  'YYYY-MM'
 * @param {number} p.threshold เกณฑ์วัน (ระบายสีแถวที่ถึง/เกิน)
 * @param {Array}  p.rows      [{ code, name, position, section, department, working, holiday, total, reason }]
 * @param {string} [p.note]    บรรทัดหมายเหตุแหล่งข้อมูล/ความครบถ้วน (ช่องโหว่ข้อมูล — ต้องติดไปกับไฟล์เสมอ)
 */
export async function exportOtMonthlyExcel({ monthKey, threshold = 20, rows = [], note = '' }) {
  const df = await getDocForm('ot_monthly_summary', {
    title: 'ข้อมูลสรุปจำนวน OT พนักงานรายบุคคล',
  });
  const ExcelJS = (await import('exceljs')).default;   // lazy — ก้อน ~960KB ใช้ร่วมกับ export ตัวอื่น
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ESM';
  const ws = wb.addWorksheet(`OT ${monthKey}`, {
    pageSetup: {
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  });
  [6, 13, 26, 18, 16, 16, 12, 12, 11, 52].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const code = fullCode(df);
  mergeSafe(ws, 'A1:J1');
  put(ws, 'A1', `${df.title || 'ข้อมูลสรุปจำนวน OT พนักงานรายบุคคล'} เดือน ${thaiMonthLabel(monthKey)}`,
    { bold: true, size: 13, align: 'center', border: false });
  mergeSafe(ws, 'A2:J2');
  put(ws, 'A2', `เกณฑ์ที่คัดมา: ทำ OT ตั้งแต่ ${threshold} วันขึ้นไป · จำนวน ${rows.length} คน${code ? ` · ${code}` : ''}`,
    { size: 10, align: 'center', border: false });

  const HEAD = ['ลำดับ', 'รหัสพนักงาน', 'ชื่อ - นามสกุล', 'ตำแหน่ง', 'ส่วน', 'ฝ่าย',
    'OT วันทำงาน', 'OT วันหยุด', 'Total (วัน)', 'หมายเหตุ (เหตุผลการทำ OT)'];
  HEAD.forEach((h, i) => put(ws, `${String.fromCharCode(65 + i)}4`, h,
    { bold: true, align: 'center', fill: 'FFD9E1F2', wrap: true }));
  ws.getRow(4).height = 30;

  rows.forEach((r, i) => {
    const rowN = 5 + i;
    const over = (r.total ?? 0) >= threshold;
    const fill = over ? 'FFF8CBCB' : undefined;
    put(ws, `A${rowN}`, i + 1, { align: 'center' });
    put(ws, `B${rowN}`, r.code || '', { align: 'center' });
    put(ws, `C${rowN}`, r.name || '');
    put(ws, `D${rowN}`, r.position || '');
    put(ws, `E${rowN}`, r.section || '');
    put(ws, `F${rowN}`, r.department || '');
    put(ws, `G${rowN}`, r.working ?? 0, { align: 'center' });
    put(ws, `H${rowN}`, r.holiday ?? 0, { align: 'center' });
    put(ws, `I${rowN}`, r.total ?? 0, { align: 'center', bold: true, fill });
    put(ws, `J${rowN}`, r.reason || '', { wrap: true, size: 9 });
  });

  // หมายเหตุแหล่งข้อมูล + ช่องโหว่ (ถ้ามี) — ติดไปกับไฟล์เสมอ ห้ามส่งตัวเลขลอยๆ
  if (note) {
    const nRow = 6 + rows.length;
    mergeSafe(ws, `A${nRow}:J${nRow + 1}`);
    put(ws, `A${nRow}`, note, { size: 9, wrap: true, border: false });
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `OT-รายบุคคล-${monthKey}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
