/**
 * kpiExportExcel — export KPI รายเดือนเป็น Excel 3 ชีทตามโครงไฟล์ KPI จริงของบริษัท (2026-08-24)
 *   ชีท 1: KPI Appraisal        (FM-HRM-6-022) — ตาราง No/KPI/Commitment/Target/Result/Weight แยก 4 หมวด
 *   ชีท 2: Monitoring FM-HRM-6-024(01) — Item/TOPIC/Formula/Scope/Commitment/Target/ม.ค.–ธ.ค./เฉลี่ย-รวม/Y-N
 *   ชีท 3: Action FM-HRM-6-025(01)     — TOPIC/Commitment/Target/IMPROVEMENT ACTIVITY/RESPONSIBILITY
 *
 * กติกา:
 * - exceljs ต้อง dynamic import เสมอ (~930KB — กฎเดียวกับ pptxgenjs/xlsx)
 * - เลขฟอร์ม/Rev อ่านจากทะเบียน doc_forms (doc_key: kpi_monthly) — ห้าม hardcode
 * - โครง 3 ชีทถอดจากไฟล์จริง FY2023 (คอลัมน์/ลำดับหมวด) — เนื้อหามาจากข้อมูลในระบบ + KPI กรอกมือ
 *   ช่องที่ระบบไม่มีข้อมูล (PM CODE/ชื่อผู้ถือ KPI/Appraisal คะแนน) ปล่อยว่างให้กรอก ห้ามเดา
 *
 * rows: [{ category, name, formula, scope, commitment, target, monthVals[12] (null=ไม่มีข้อมูล),
 *          summary, summaryLabel, ynVals[12]|null, weight, actionPlan, actionOwner, sectionTag }]
 */

const CAT_ORDER = ['financial', 'customer', 'internal', 'learning'];
const CAT_LABEL = {
  financial: 'Financial Perspective',
  customer: 'Customer Perspective',
  internal: 'Internal Process Perspective',
  learning: 'Learning and Growth Perspective',
};
const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const thin = { style: 'thin', color: { argb: 'FF888888' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
const CAT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };

function styleHeader(row) {
  row.eachCell(c => { c.border = BORDER; c.fill = HEAD_FILL; c.font = { bold: true, size: 10 }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
}
function styleBody(row, { numFrom = 0 } = {}) {
  row.eachCell({ includeEmpty: true }, (c, col) => {
    c.border = BORDER; c.font = { size: 10 };
    c.alignment = { vertical: 'middle', wrapText: true, horizontal: numFrom && col >= numFrom ? 'right' : 'left' };
  });
}
const num = v => (v == null || !Number.isFinite(v) ? '' : Math.round(v * 100) / 100);

export async function exportKpiExcel({ year, sectionLabel, rows, formCode, note }) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const byCat = CAT_ORDER.map(c => ({ cat: c, items: rows.filter(r => r.category === c) })).filter(g => g.items.length);
  const titleTail = `${sectionLabel || 'ทุกส่วนงาน'} · ปี ${year + 543}${formCode ? ` · ${formCode}` : ''}`;

  /* ═ ชีท 1: KPI Appraisal (FM-HRM-6-022) ═ */
  {
    const ws = wb.addWorksheet('KPI Appraisal', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.columns = [{ width: 5 }, { width: 46 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 9 }, { width: 11 }, { width: 9 }];
    ws.addRow([`KPI Appraisal Form (FM-HRM-6-022) — ${titleTail}`]).font = { bold: true, size: 13 };
    ws.mergeCells('A1:H1');
    // header block ตามฟอร์มจริง — ช่องข้อมูลบุคคลปล่อยว่างให้กรอก (ระบบไม่มีข้อมูลผู้ถือ KPI ห้ามเดา)
    ws.addRow(['PM CODE :', '', 'Company :', 'TSAT', 'Department :', sectionLabel || '', '', '']);
    ws.addRow(['Name :', '', 'Position :', '', 'Cost center :', '', '', '']);
    ws.addRow([]);
    const head = ws.addRow(['No', 'KPI Description', 'Commitment', 'Target', 'Result', 'Weight', 'Appraisal', 'Points']);
    styleHeader(head);
    let no = 0, weightSum = 0;
    byCat.forEach(g => {
      const cr = ws.addRow(['', CAT_LABEL[g.cat]]);
      ws.mergeCells(`B${cr.number}:H${cr.number}`);
      cr.eachCell({ includeEmpty: true }, c => { c.border = BORDER; c.fill = CAT_FILL; c.font = { bold: true, size: 10 }; });
      g.items.forEach(r => {
        no += 1; weightSum += Number(r.weight) || 0;
        const rr = ws.addRow([no, r.name + (r.sectionTag ? ` (${r.sectionTag})` : ''), r.commitment || '', r.target || '',
          num(r.summary), r.weight ?? '', '', '']);
        styleBody(rr, { numFrom: 5 });
      });
    });
    const tw = ws.addRow(['', 'Total Weight', '', '', '', weightSum || '', '', '']);
    styleBody(tw); tw.getCell(2).font = { bold: true, size: 10 }; tw.getCell(6).font = { bold: true, size: 10 };
    ws.addRow([]);
    ws.addRow(['', 'Reviewed by ______________________', '', '', 'Approved by ______________________']);
  }

  /* ═ ชีท 2: Monitoring FM-HRM-6-024(01) ═ */
  {
    const ws = wb.addWorksheet('Monitoring FM-HRM-6-024(01)', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.columns = [{ width: 5 }, { width: 34 }, { width: 26 }, { width: 16 }, { width: 13 }, { width: 13 },
      ...Array.from({ length: 12 }, () => ({ width: 9 })), { width: 12 }, { width: 6 }];
    ws.addRow([`KPI Monitoring (FM-HRM-6-024) — ${titleTail}`]).font = { bold: true, size: 13 };
    ws.mergeCells('A1:T1');
    if (note) { const nr = ws.addRow([note]); nr.font = { size: 9, color: { argb: 'FF666666' } }; ws.mergeCells(`A${nr.number}:T${nr.number}`); }
    const head = ws.addRow(['Item', 'TOPIC', 'Formula', 'Scope', 'Commitment', 'Target', ...TH_M, 'เฉลี่ย/รวม', 'Y/N']);
    styleHeader(head);
    let no = 0;
    byCat.forEach(g => {
      const cr = ws.addRow(['', CAT_LABEL[g.cat]]);
      ws.mergeCells(`B${cr.number}:T${cr.number}`);
      cr.eachCell({ includeEmpty: true }, c => { c.border = BORDER; c.fill = CAT_FILL; c.font = { bold: true, size: 10 }; });
      g.items.forEach(r => {
        no += 1;
        const ynTot = r.ynTotal == null ? '' : (r.ynTotal ? 'Y' : 'N');
        const rr = ws.addRow([no, r.name + (r.sectionTag ? ` (${r.sectionTag})` : ''), r.formula || '', r.scope || '',
          r.commitment || '', r.target || '', ...r.monthVals.map(num), num(r.summary), ynTot]);
        styleBody(rr, { numFrom: 7 });
        if (r.ynVals) r.ynVals.forEach((y, i) => {
          if (y == null) return;
          const c = rr.getCell(7 + i);
          c.font = { size: 10, color: { argb: y ? 'FF15803D' : 'FFB91C1C' } };
        });
      });
    });
  }

  /* ═ ชีท 3: Action FM-HRM-6-025(01) ═ */
  {
    const ws = wb.addWorksheet('Action FM-HRM-6-025(01)', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.columns = [{ width: 5 }, { width: 34 }, { width: 16 }, { width: 16 }, { width: 52 }, { width: 20 }];
    ws.addRow([`KPI Action Plan (FM-HRM-6-025) — ${titleTail}`]).font = { bold: true, size: 13 };
    ws.mergeCells('A1:F1');
    const head = ws.addRow(['ITEM', 'TOPIC', 'Commitment', 'Target', 'IMPROVEMENT ACTIVITY', 'RESPONSIBILITY']);
    styleHeader(head);
    const withPlan = rows.filter(r => r.actionPlan || r.actionOwner);
    if (!withPlan.length) {
      const rr = ws.addRow(['', 'ยังไม่มี KPI ที่กรอก IMPROVEMENT ACTIVITY — กรอกได้ที่ปุ่ม ⚙️ จัดการ KPI กรอกมือ']);
      ws.mergeCells(`B${rr.number}:F${rr.number}`); styleBody(rr);
    }
    withPlan.forEach((r, i) => {
      const rr = ws.addRow([i + 1, r.name, r.commitment || '', r.target || '', r.actionPlan || '', r.actionOwner || '']);
      styleBody(rr);
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `KPI_${year + 543}_${(sectionLabel || 'ALL').replace(/[\\/:*?"<>|\s]+/g, '_')}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
