/* ═══ PE Core Tools — Export PFMEA / Control Plan กลับเป็น .xlsx ตามฟอร์ม TSAT ═══
   layout ถอดจากไฟล์จริง MB3B-8C306-BE (FMEA Rev.16 · CNP Rev.9) — ความกว้างคอลัมน์ / ความสูงแถว /
   merge / ฟอนต์ / เส้นขอบ / ตั้งค่าพิมพ์ ยกมาจากของจริงทั้งชุด · สเปกเต็ม: docs/PE-FORM-SPEC.md

   ⚠️ ความเหมือนที่ตั้งเป้า ~95% ไม่ใช่ 100% — และ 5% ที่ต่างคือของที่ "สร้างจากศูนย์ไม่ได้":
     · กล่องข้อความ/โลโก้ที่วาดทับหัวฟอร์ม (drawing) — ExcelJS สร้าง shape ไม่ได้
     · เส้นขอบที่ในไฟล์จริงถูกแก้มือจนไม่สม่ำเสมอ (มีทั้ง hair/thin/medium ปนในตารางเดียว)
       → ที่นี่ทำให้สม่ำเสมอ: กรอบนอก medium · เส้นคั่นคอลัมน์ thin · เส้นคั่นระหว่าง record thin
   ⚠️ PFC (Process Flow) ไม่รองรับโดยตั้งใจ — เป็นผังที่วาดด้วยรูปทรง ~560 ชิ้น + รูป 59 ไฟล์
      ไม่ใช่ตาราง สร้างใหม่จากข้อมูลในระบบไม่ได้ (ดู PE-FORM-SPEC.md §0)
   ⚠️ exceljs โหลดแบบ dynamic import (lazy chunk) — ห้าม import แบบ static (กฎเดียวกับ pptxgenjs/xlsx) */

/* ⚠️ ทะเบียนเอกสาร (utils/docForms) โหลดแบบ dynamic ใน buildPeWorkbook ไม่ใช่ top-level
   — ไฟล์นี้จะได้ import มาทดสอบนอกเบราว์เซอร์ได้ (docForms ลากทั้ง supabaseClient มาด้วย) */

const THIN = { style: 'thin' };
const MED = { style: 'medium' };

const S = (v) => (v == null ? '' : String(v));
const lines = (v) => S(v).split('\n');

/** จำนวนแถวที่ record นี้ต้องใช้ = บรรทัดมากสุดของช่องข้อความหลายบรรทัด */
const rowSpan = (rec, keys) => Math.max(1, ...keys.map((k) => lines(rec[k]).length));

/** เส้นขอบของเซลล์ในตาราง: กรอบนอก medium · ในตาราง thin · หัว record มีเส้นคั่นบน */
function tableBorder({ col, lastCol, top = false, bottomEdge = false }) {
  return {
    top: top ? THIN : undefined,
    bottom: bottomEdge ? MED : undefined,
    left: col === 1 ? MED : THIN,
    right: col === lastCol ? MED : THIN,
  };
}

function putRow(ws, r, height) {
  const row = ws.getRow(r);
  row.height = height;
  return row;
}

/** เขียนค่า + จัดฟอนต์/ขอบ/จัดวาง ในครั้งเดียว */
function put(ws, addr, value, { font, align, border, merge } = {}) {
  if (merge) ws.mergeCells(merge);
  const cell = ws.getCell(addr);
  if (value !== undefined) cell.value = value;
  if (font) cell.font = font;
  if (align) cell.alignment = align;
  if (border) cell.border = border;
  return cell;
}

/* ══════════ ① PFMEA — FM-PE1-018 ══════════ */

const F_W = [15.5, 25.75, 18.08, 26.83, 3.75, 3.75, 27.75, 21.58, 3.75, 20.25, 3.75, 3.75, 13.33, 14.75, 15.33, 3.75, 3.75, 3.75, 3.75];
const F_LAST = 19; // คอลัมน์ S
const F_HEAD_ROW = 8;
const F_DATA_ROW = 10;

/** หัวคอลัมน์ 2 ชั้น (แถว 8–9) — [คอลัมน์, ชั้นบน, ชั้นล่าง, หมุน 90°] */
const F_COLS = [
  [1, 'Item ', 'Function', false],
  [2, 'Requirements', null, false],
  [3, 'Potential Failure Mode', null, false],
  [4, 'Potential Effect(s) of Failure', null, false],
  [5, 'Severity', null, true],
  [6, 'Classification', null, true],
  [7, ' Potential  Cause(s)/ of Failure', null, false],
  [8, 'Current  Process', 'Controls  Prevention', false],
  [9, null, 'Occurrence', true],
  [10, null, 'Controls  Detection', false],
  [11, 'Detection', null, true],
  [12, 'RPN', null, true],
  [13, 'Recommended Action', null, false],
  [14, 'Responsibility & Target Completion Date.', null, false],
  [15, 'Action  Results', 'Actions Taken&Effective', false],
  [16, null, 'Severity', true],
  [17, null, 'Occurrence', true],
  [18, null, 'Detection', true],
  [19, null, 'RPN', true],
];

/** ช่องข้อความหลายบรรทัด → [คอลัมน์, ฟิลด์] */
const F_TEXT = [[2, 'requirement'], [3, 'failure_mode'], [4, 'effects'], [7, 'causes'], [8, 'prevention'], [10, 'detection_ctrl'], [13, 'recommended_action'], [14, 'responsibility'], [15, 'action_taken']];
const F_NUM = [[5, 'severity'], [6, 'classification'], [9, 'occurrence'], [11, 'detection'], [16, 'new_severity'], [17, 'new_occurrence'], [18, 'new_detection']];

function buildFmeaSheet(wb, { set, proc, items, df, header }) {
  const ws = wb.addWorksheet(sheetName(proc.op_no), {
    pageSetup: {
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      horizontalCentered: true, verticalCentered: true, showGridLines: false,
      margins: { left: 0, right: 0, top: 0, bottom: 0, header: 0, footer: 0 },
    },
    views: [{ showGridLines: false }],
  });
  ws.columns = F_W.map((width) => ({ width }));

  const fTitle = { name: 'AngsanaUPC', size: 20 };
  const fCoBig = { name: 'Cordia New', size: 14, bold: true };
  const fCoEn = { name: 'AngsanaUPC', size: 14 };
  const fSub = { name: 'AngsanaUPC', size: 18 };
  const fField = { name: 'Angsana New', size: 16 };
  const fHead = { name: 'AngsanaUPC', size: 18 };
  const fData = { name: 'AngsanaUPC', size: 14 };
  const mid = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const left = { vertical: 'middle', wrapText: false };

  [21.75, 21, 20.25, 21, 21, 21, 21].forEach((h, i) => putRow(ws, i + 1, h));
  putRow(ws, 8, 23.25);
  putRow(ws, 9, 52.5);

  put(ws, 'B1', 'บริษัท ไทยซัมมิท โอโตโมทีฟ จำกัด', { merge: 'B1:C1', font: fCoBig, align: mid });
  put(ws, 'B2', 'THAI SUMMIT AUTOMOTIVE CO.,LTD.', { merge: 'B2:C2', font: fCoEn, align: mid });
  put(ws, 'D1', '                       POTENTIAL FAILURE MODE AND EFFECTS ANALYSIS', { merge: 'D1:S2', font: fTitle, align: { horizontal: 'left', vertical: 'middle' } });
  put(ws, 'A3', 'PROCESS FMEA', { merge: 'A3:R3', font: fSub, align: mid });

  put(ws, 'N4', `FMEA Number: ${S(set.doc_no_fmea)}`, { merge: 'N4:S4', font: fField, align: left });
  put(ws, 'A5', `Item :  ${S(set.part_name)}${set.part_no ? ` (${set.part_no})` : ''}`, { font: fField, align: left });
  put(ws, 'F5', `Key Date: ${S(header.keyDate)}`, { merge: 'F5:M5', font: fField, align: left });
  put(ws, 'N5', `Prepared By : ${S(header.preparedBy)}`, { merge: 'N5:S5', font: fField, align: left });
  put(ws, 'A6', `Model Year(s)/Program(s) : ${S(set.model)}`, { font: fField, align: left });
  put(ws, 'N6', `FMEA Date (Original) : ${S(header.dateOriginal)}`, { merge: 'N6:S6', font: fField, align: left });
  put(ws, 'A7', `Core Team : ${S(header.coreTeam)}`, { merge: 'A7:J7', font: fField, align: left });
  put(ws, 'N7', `Process : OP ${S(proc.op_no)} ${S(proc.name)}`, { merge: 'N7:S7', font: fField, align: left });

  for (const [c, top, bottom, rot] of F_COLS) {
    const a8 = ws.getCell(F_HEAD_ROW, c);
    const a9 = ws.getCell(F_HEAD_ROW + 1, c);
    const al = { ...mid, ...(rot ? { textRotation: 90 } : {}) };
    if (top && !bottom) { ws.mergeCells(F_HEAD_ROW, c, F_HEAD_ROW + 1, c); a8.value = top; }
    else { if (top) a8.value = top; if (bottom) a9.value = bottom; }
    for (const cell of [a8, a9]) {
      cell.font = fHead; cell.alignment = al;
      cell.border = { top: cell.row === F_HEAD_ROW ? MED : undefined, left: c === 1 ? MED : THIN, right: c === F_LAST ? MED : THIN, bottom: cell.row === F_HEAD_ROW + 1 ? THIN : undefined };
    }
  }
  ws.mergeCells(F_HEAD_ROW, 8, F_HEAD_ROW, 10);   // Current Process
  ws.mergeCells(F_HEAD_ROW, 15, F_HEAD_ROW, 19);  // Action Results

  let r = F_DATA_ROW;
  let groupStart = r, groupFunc = null;
  const closeGroup = (endRow) => {
    if (groupFunc !== null && endRow > groupStart) ws.mergeCells(groupStart, 1, endRow, 1);
  };

  for (const it of items) {
    const n = rowSpan(it, F_TEXT.map(([, k]) => k));
    const fn = S(it.item_function);
    if (fn !== groupFunc) { closeGroup(r - 1); groupStart = r; groupFunc = fn; ws.getCell(r, 1).value = fn; }

    for (let i = 0; i < n; i++) {
      const rr = r + i;
      putRow(ws, rr, 18.75);
      for (let c = 1; c <= F_LAST; c++) {
        const cell = ws.getCell(rr, c);
        cell.font = fData;
        cell.alignment = { vertical: 'top', wrapText: true, ...( [5, 6, 9, 11, 12, 16, 17, 18, 19].includes(c) ? { horizontal: 'center' } : {}) };
        cell.border = tableBorder({ col: c, lastCol: F_LAST, top: i === 0 });
      }
      for (const [c, key] of F_TEXT) {
        const ls = lines(it[key]);
        const v = i === n - 1 ? ls.slice(i).join('\n') : (ls[i] ?? '');
        if (v) ws.getCell(rr, c).value = v;
      }
    }
    for (const [c, key] of F_NUM) if (it[key] != null && it[key] !== '') ws.getCell(r, c).value = it[key];
    if (it.severity && it.occurrence && it.detection) ws.getCell(r, 12).value = { formula: `E${r}*I${r}*K${r}`, result: it.severity * it.occurrence * it.detection };
    if (it.new_severity && it.new_occurrence && it.new_detection) ws.getCell(r, 19).value = { formula: `P${r}*Q${r}*R${r}`, result: it.new_severity * it.new_occurrence * it.new_detection };
    r += n;
  }
  closeGroup(r - 1);
  if (!items.length) { putRow(ws, r, 18.75); for (let c = 1; c <= F_LAST; c++) ws.getCell(r, c).border = tableBorder({ col: c, lastCol: F_LAST, top: true }); r += 1; }

  for (let c = 1; c <= F_LAST; c++) {
    const cell = ws.getCell(r - 1, c);
    cell.border = { ...cell.border, bottom: MED };
  }
  putRow(ws, r, 13.5);
  put(ws, `A${r}`, df.fmea.code, { font: { name: 'Angsana New', size: 14 }, align: { vertical: 'middle' } });
  put(ws, `O${r}`, df.fmea.effective_date ? `Effective Date:${df.fmea.effective_date}` : '', { merge: `O${r}:S${r}`, font: { name: 'Angsana New', size: 14 }, align: { horizontal: 'right', vertical: 'middle' } });
  ws.pageSetup.printArea = `A1:S${r}`;
  return ws;
}

/* ══════════ ② Control Plan — FM-PE1-019 ══════════ */

const C_W = [6.58, 23.75, 23.75, 4, 29, 23.75, 8.58, 8.58, 33.83, 25.58, 8.58, 23.75, 30.75, 26.75];
const C_LAST = 14; // คอลัมน์ N
const C_DATA_ROW = 12;

const C_TEXT = [[5, 'product_char'], [6, 'process_char'], [9, 'spec'], [10, 'method'], [12, 'frequency'], [13, 'control_method'], [14, 'reaction_plan']];
const C_ONE = [[7, 'special_class'], [8, 'person'], [11, 'sample_size']];

function buildCpSheet(wb, { set, proc, items, df, header }) {
  const ws = wb.addWorksheet(sheetName(proc.op_no), {
    pageSetup: {
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      showGridLines: false, margins: { left: 0.39, right: 0, top: 0.39, bottom: 0, header: 0, footer: 0 },
    },
    views: [{ showGridLines: false }],
  });
  ws.columns = C_W.map((width) => ({ width }));

  const fT = { name: 'Angsana New', size: 22, bold: true };
  const fB = { name: 'Angsana New', size: 14, bold: true };
  const fD = { name: 'Angsana New', size: 14 };
  const mid = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const left = { vertical: 'middle', wrapText: true };

  [51, 15, 25.5, 21, 21.75, 19.5, 23.25].forEach((h, i) => putRow(ws, i + 1, h));
  for (let r = 8; r <= 11; r++) putRow(ws, r, 12.75);

  put(ws, 'A1', 'CONTROL  PLAN', { merge: 'A1:N1', font: fT, align: mid });
  for (let c = 1; c <= C_LAST; c++) ws.getCell(1, c).border = { top: MED, left: c === 1 ? MED : undefined, right: c === C_LAST ? MED : undefined };

  /* ติ๊ก Prototype / Pre-Launch / Production ด้วย Wingdings 2 (£ = ช่องว่าง · S = ติ๊ก) — ตามฟอร์มจริง */
  const wd = { name: 'Wingdings 2', size: 14, bold: true };
  ws.getCell('A3').value = {
    richText: [
      { font: wd, text: '  £' }, { font: fB, text: '  Prototype         ' },
      { font: wd, text: '£' }, { font: fB, text: '  Pre - Launch             ' },
      { font: wd, text: 'S' }, { font: fB, text: ' Production' },
    ],
  };
  ws.getCell('A3').alignment = left;

  put(ws, 'F3', `Key Contact / Phone   :  ${S(header.keyContact)}`, { merge: 'F3:J4', font: fB, align: left });
  put(ws, 'K3', `   Date (Original) :  ${S(header.dateOriginal)}`, { merge: 'K3:L4', font: fB, align: left });
  put(ws, 'M3', `Date (Revised) :  ${S(header.dateRevised)}`, { merge: 'M3:N4', font: fB, align: left });
  put(ws, 'A4', `   Control Plan Number : ${S(set.doc_no_cp)}`, { font: fB, align: left });
  put(ws, 'A5', '   Part Number   :', { font: fB, align: left });
  put(ws, 'C5', S(set.part_no), { font: fB, align: left });
  put(ws, 'F5', `Core Team : ${S(header.coreTeam)}`, { font: fB, align: left });
  put(ws, 'K5', '   Customer Eng. Approval / Date  :', { font: fB, align: left });
  put(ws, 'A6', '   Part Name :', { font: fB, align: left });
  put(ws, 'C6', S(set.part_name), { font: fB, align: left });
  put(ws, 'F6', `PE  Approve  : ${S(header.peApprove)}`, { font: fB, align: left });
  put(ws, 'K6', '   Customer Quality Approval / Date  :', { font: fB, align: left });
  put(ws, 'A7', '   EWO No. :', { font: fB, align: left });
  put(ws, 'D7', `  MODEL: ${S(set.model)}`, { font: fB, align: left });
  put(ws, 'F7', `QA  Approve : ${S(header.qaApprove)}`, { font: fB, align: left });
  put(ws, 'K7', '   Other Approval / Date ( If  Require )  :', { font: fB, align: left });

  /* หัวคอลัมน์ 4 ชั้น (แถว 8–11) */
  const H = [
    [1, 8, 11, 'Part / \nProcess\nNumber'], [2, 9, 11, 'Process Name/\nOperation Description'], [3, 8, 11, 'Machine,\nDevice, Jig,\nTools\nFor Mfg.'],
    [4, 9, 11, 'Characteristics\nNo.'], [5, 9, 11, 'Product'], [6, 9, 11, 'Process'],
    [7, 8, 11, 'Special\nChar.\nClass'], [8, 9, 11, 'Person\nIn\nCharge'], [9, 9, 11, 'Product / Process\nSpecification\nTolerance'],
    [10, 9, 11, 'Evaluation\nMeasurement\nTechnique'], [11, 10, 11, 'Sample\nSize'], [12, 10, 11, 'Frequency'],
    [13, 9, 11, 'Control Method'], [14, 8, 11, 'Reaction Plan /\nRelated Documents'],
  ];
  put(ws, 'D8', 'Characteristics', { merge: 'D8:F8', font: fB, align: mid });
  put(ws, 'H8', 'Methods', { merge: 'H8:M8', font: fB, align: mid });
  put(ws, 'K9', 'Sample', { merge: 'K9:L9', font: fB, align: mid });
  for (const [c, r1, r2, text] of H) {
    if (r1 > 8 || c === 1 || c === 3 || c === 7 || c === 14) ws.mergeCells(r1, c, r2, c);
    const cell = ws.getCell(r1, c);
    cell.value = text; cell.font = fB; cell.alignment = mid;
  }
  for (let r = 8; r <= 11; r++) {
    for (let c = 1; c <= C_LAST; c++) {
      const cell = ws.getCell(r, c);
      cell.border = { top: r === 8 ? THIN : undefined, bottom: r === 11 ? THIN : undefined, left: c === 1 ? MED : THIN, right: c === C_LAST ? MED : THIN };
    }
  }

  let r = C_DATA_ROW;
  let gStart = r, gKey = null, gRec = null;
  const closeG = (endRow) => {
    if (gKey !== null && endRow > gStart) { ws.mergeCells(gStart, 1, endRow, 1); ws.mergeCells(gStart, 3, endRow, 3); }
  };

  for (const it of items) {
    const n = rowSpan(it, C_TEXT.map(([, k]) => k));
    const key = `${S(it.sub_op)}|${S(it.sub_name)}|${S(it.machine)}`;
    if (key !== gKey) {
      closeG(r - 1);
      gStart = r; gKey = key; gRec = it;
      ws.getCell(r, 1).value = S(it.sub_op);
      ws.getCell(r, 3).value = S(it.machine);
    }

    for (let i = 0; i < n; i++) {
      const rr = r + i;
      putRow(ws, rr, 12.75);
      for (let c = 1; c <= C_LAST; c++) {
        const cell = ws.getCell(rr, c);
        cell.font = fD;
        cell.alignment = { vertical: 'top', wrapText: true, ...([1, 4, 7, 8, 11].includes(c) ? { horizontal: 'center' } : {}) };
        cell.border = tableBorder({ col: c, lastCol: C_LAST, top: i === 0 });
      }
      for (const [c, key2] of C_TEXT) {
        const ls = lines(it[key2]);
        const v = i === n - 1 ? ls.slice(i).join('\n') : (ls[i] ?? '');
        if (v) ws.getCell(rr, c).value = v;
      }
    }
    /* ชื่อขั้นงาน + child part เขียนไล่บรรทัดลงมาจากแถวแรกของกลุ่ม (ตามฟอร์มจริง ไม่ merge) */
    if (gRec === it) {
      const nameLines = lines(it.sub_name).filter(Boolean);
      nameLines.forEach((ln, i) => {
        const cell = ws.getCell(gStart + i, 2);
        if (gStart + i < r + n) cell.value = cell.value ? `${cell.value}\n${ln}` : ln;
        else ws.getCell(r + n - 1, 2).value = `${ws.getCell(r + n - 1, 2).value || ''}\n${ln}`.trim();
        if (i > 0) cell.font = { name: 'Angsana New', size: 12 };
      });
    }
    if (it.char_no != null) ws.getCell(r, 4).value = it.char_no;
    for (const [c, key2] of C_ONE) if (it[key2]) ws.getCell(r, c).value = S(it[key2]);
    r += n;
  }
  closeG(r - 1);
  if (!items.length) { putRow(ws, r, 12.75); for (let c = 1; c <= C_LAST; c++) ws.getCell(r, c).border = tableBorder({ col: c, lastCol: C_LAST, top: true }); r += 1; }

  for (let c = 1; c <= C_LAST; c++) {
    const cell = ws.getCell(r - 1, c);
    cell.border = { ...cell.border, bottom: MED };
  }
  putRow(ws, r, 13.5);
  put(ws, `A${r}`, df.cp.code, { font: fD, align: { vertical: 'middle' } });
  put(ws, `N${r}`, df.cp.effective_date ? `Effective Date : ${df.cp.effective_date}` : '', { font: fD, align: { horizontal: 'right', vertical: 'middle' } });
  ws.pageSetup.printArea = `A1:N${r}`;
  return ws;
}

/* ══════════ ③ ชีท cover — ประวัติการแก้ไข ══════════ */

function buildCoverSheet(wb, { set, revisions, docType, df }) {
  const ws = wb.addWorksheet('COVER');
  ws.columns = [{ width: 6 }, { width: 14 }, { width: 20 }, { width: 16 }, { width: 60 }, { width: 18 }, { width: 18 }, { width: 18 }];
  const fB = { name: 'Angsana New', size: 14, bold: true };
  const fD = { name: 'Angsana New', size: 14 };
  const mid = { horizontal: 'center', vertical: 'middle', wrapText: true };

  put(ws, 'A1', `${docType === 'fmea' ? 'PROCESS FMEA' : 'CONTROL PLAN'} — ${S(set.part_name)} (${S(set.part_no)})`, { merge: 'A1:H1', font: { name: 'Angsana New', size: 18, bold: true }, align: mid });
  put(ws, 'A2', `เอกสารเลขที่ : ${S(docType === 'fmea' ? set.doc_no_fmea : set.doc_no_cp)}    Model : ${S(set.model)}    ลูกค้า : ${S(set.customer)}`, { merge: 'A2:H2', font: fD, align: { vertical: 'middle' } });
  putRow(ws, 1, 26); putRow(ws, 2, 20);

  const head = ['Rev.', 'วันที่', 'Part No. Suffix', 'ECN No.', 'รายละเอียดการแก้ไข', 'ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ'];
  putRow(ws, 4, 22);
  head.forEach((h, i) => put(ws, `${String.fromCharCode(65 + i)}4`, h, { font: fB, align: mid, border: { top: MED, bottom: THIN, left: i === 0 ? MED : THIN, right: i === head.length - 1 ? MED : THIN } }));

  let r = 5;
  for (const v of revisions) {
    const vals = [v.rev_no ?? '', v.rev_date || '', v.suffix || '', v.ecn_no || '', v.content || '', v.issued_by || '', v.checked_by || '', v.approved_by || ''];
    vals.forEach((val, i) => put(ws, `${String.fromCharCode(65 + i)}${r}`, val, { font: fD, align: { vertical: 'top', wrapText: true, ...(i === 4 ? {} : { horizontal: 'center' }) }, border: { top: THIN, left: i === 0 ? MED : THIN, right: i === vals.length - 1 ? MED : THIN } }));
    r += 1;
  }
  if (!revisions.length) { put(ws, 'A5', '— ยังไม่มีประวัติการแก้ไขในระบบ —', { merge: 'A5:H5', font: fD, align: mid }); r = 6; }
  for (let c = 1; c <= 8; c++) { const cell = ws.getCell(r - 1, c); cell.border = { ...cell.border, bottom: MED }; }

  put(ws, `A${r + 1}`, docType === 'fmea' ? df.fmea.code : df.cp.code, { font: fD });
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: `A1:H${r + 1}` };
  return ws;
}

/* ══════════ ④ ประกอบไฟล์ ══════════ */

/** ชื่อชีทที่ Excel รับได้ (ห้าม []:*?/\ · ยาวไม่เกิน 31) */
const sheetName = (s) => (S(s).replace(/[[\]:*?/\\]/g, '-').slice(0, 31) || 'Sheet');

/**
 * ค่าที่ฟอร์มมีช่องให้กรอกแต่ระบบยังไม่มีคอลัมน์เก็บ — เดาเท่าที่พิสูจน์ได้จากประวัติ revision
 * ที่เหลือปล่อยว่าง **ห้ามเดา** แล้วรายงานกลับไปให้ผู้ใช้รู้ว่าต้องเติมเองในไฟล์
 */
function deriveHeader(revisions, docType) {
  const rs = revisions.filter((v) => v.doc_type === docType && v.rev_date).sort((a, b) => String(a.rev_date).localeCompare(String(b.rev_date)));
  const first = rs[0], last = rs[rs.length - 1];
  const blanks = [];
  const h = {
    dateOriginal: first?.rev_date || '',
    dateRevised: last?.rev_date || '',
    preparedBy: last?.issued_by || '',
    peApprove: last?.approved_by || '',
    qaApprove: last?.checked_by || '',
    keyDate: '', coreTeam: '', keyContact: '',
  };
  if (!h.dateOriginal) blanks.push('วันที่ออกเอกสารครั้งแรก');
  if (!h.preparedBy) blanks.push('ผู้จัดทำ');
  blanks.push('Key Date', 'Core Team');
  if (docType === 'cp') blanks.push('Key Contact / Phone');
  return { header: h, blanks };
}

/**
 * สร้างไฟล์ .xlsx ของชุดเอกสาร
 * @param {'fmea'|'cp'} docType
 * @param {{set, processes, items}} data  items = แถว FMEA หรือ CP ทั้งชุด (มี process_id)
 * @param {{df?}} opts  df = ทะเบียนเอกสารที่เตรียมมาแล้ว (ใช้ตอนเทสนอกเบราว์เซอร์ · ปกติไม่ต้องส่ง)
 * @returns {{ blob, filename, notes, sheets }}
 */
export async function buildPeWorkbook(docType, { set, processes = [], items = [], revisions = [] }, opts = {}) {
  if (docType !== 'fmea' && docType !== 'cp') throw new Error(`ยังไม่รองรับการ export ชนิด "${docType}"`);

  /* เลขฟอร์ม/Rev/Effective อ่านจากทะเบียนเอกสาร (/doc-forms) — ห้าม hardcode ในโค้ด
     fallback = ค่าที่พิมพ์อยู่บนฟอร์มกระดาษจริง ใช้เมื่อทะเบียนยังไม่ถูก seed */
  const df = opts.df || await (async () => {
    const { getDocForm, fullCode } = await import('../utils/docForms');
    const [f, c] = await Promise.all([
      getDocForm('pe_fmea', { form_code: 'FM-PE1-018', rev: 'Rev.01', effective_date: '24/07/2015' }),
      getDocForm('pe_cp', { form_code: 'FM-PE1-019', rev: 'Rev.01', effective_date: '24/07/2015' }),
    ]);
    return { fmea: { ...f, code: fullCode(f) }, cp: { ...c, code: fullCode(c) } };
  })();

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ESM — Enterprise Shopfloor Management';
  wb.created = new Date();

  const revs = revisions.filter((v) => v.doc_type === docType);
  const { header, blanks } = deriveHeader(revisions, docType);

  buildCoverSheet(wb, { set, revisions: revs, docType, df });

  const byProc = new Map();
  for (const it of items) {
    if (!byProc.has(it.process_id)) byProc.set(it.process_id, []);
    byProc.get(it.process_id).push(it);
  }
  const sorted = [...processes].sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0) || String(a.op_no).localeCompare(String(b.op_no), undefined, { numeric: true }));

  const notes = [];
  let sheets = 0, empty = 0;
  for (const proc of sorted) {
    const rows = (byProc.get(proc.id) || []).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0) || (a.char_no || 0) - (b.char_no || 0));
    if (!rows.length) { empty += 1; continue; }
    const args = { set, proc, items: rows, df, header };
    if (docType === 'fmea') buildFmeaSheet(wb, args); else buildCpSheet(wb, args);
    sheets += 1;
  }

  if (!sheets) throw new Error(docType === 'fmea' ? 'ชุดนี้ยังไม่มีแถว PFMEA — ไม่มีอะไรให้ export' : 'ชุดนี้ยังไม่มีจุดควบคุม — ไม่มีอะไรให้ export');
  if (empty) notes.push(`ข้าม ${empty} OP ที่ยังไม่มีข้อมูล (ไม่สร้างชีทเปล่า)`);
  if (blanks.length) notes.push(`ช่องที่ระบบยังไม่มีข้อมูลเก็บ ปล่อยว่างไว้ให้เติมในไฟล์เอง: ${blanks.join(' · ')}`);
  notes.push('กล่องข้อความ/โลโก้ที่วาดทับหัวฟอร์มในไฟล์เดิม (drawing) สร้างใหม่ไม่ได้ — ตัวตาราง/หัวเรื่อง/ตั้งค่าพิมพ์ ตรงกับฟอร์มเดิม');

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const code = docType === 'fmea' ? 'FMEA' : 'CNP';
  const d = new Date();  /* วันที่เครื่อง (local) — ห้ามใช้ toISOString() ที่เป็น UTC */
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const filename = `${code}_${S(set.part_no).replace(/[^\w-]/g, '') || 'PART'}_${stamp}.xlsx`;
  return { blob, filename, notes, sheets };
}

/** สร้างแล้วสั่งดาวน์โหลดเลย */
export async function downloadPeWorkbook(docType, data) {
  const { blob, filename, notes, sheets } = await buildPeWorkbook(docType, data);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { filename, notes, sheets };
}
