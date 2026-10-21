/**
 * mtnMachineHistoryExcel — Export "ใบบันทึกประวัติการซ่อมและการทำ PM MACHINE" (FM-MTN-005) ของเครื่องเดียว
 *
 * ที่มา (user 20/10): ส่งฟอร์มกระดาษจริงมา "ดูเรื่อง export ประวัติ ต้องได้แบบนี้"
 * ⇒ หน้าตาเหมือนใบกระดาษ: A4 แนวนอน · หัวฟอร์ม (โลโก้ · ชื่อบริษัท TH/EN · ชื่อใบ · หน้า/เลขที่เอกสาร/ออกครั้งที่/
 *   วันที่ออกใช้/แก้ไขครั้งที่ · M/C Number/Name/Brand/Model/Location/Class/Setting) + ตาราง 14 คอลัมน์ ·
 *   **1 หน้า = 15 แถว** แต่ละหน้ามีหัวฟอร์มของตัวเอง + "หน้า x/y" · ท้ายหน้า "ประวัติการซ่อม"
 *
 * 🔴 ช่องไหนใส่อะไร = `machineHistoryRows()` (src/utils/machineHistoryForm.js · มีเทส) — ไฟล์นี้วาดอย่างเดียว
 * 🔴 Doc Control: เลขฟอร์ม/Rev/วันที่ออกใช้/ออกครั้งที่ อ่านจาก /doc-forms (doc_key `mtn_machine_history`)
 *    ค่าใน FALLBACK = ค่าบนใบกระดาษที่ user ส่งมา (ใช้เมื่อทะเบียนล่มเท่านั้น)
 */
import { getDocForm } from '../utils/docForms';
import { paginate, ROWS_PER_PAGE } from '../utils/machineHistoryForm';
import tsLogo from '../assets/TS logo.png';
import { absAssetUrl } from '../utils/assetUrl';

export const DOC_KEY = 'mtn_machine_history';
const FALLBACK = { form_code: 'FM-MTN-005', rev: '02', effective_date: '31/08/2015', notes: 'ออกครั้งที่ A' };

const thin = { style: 'thin' };
const allBorder = { top: thin, bottom: thin, left: thin, right: thin };
const COLS = 'ABCDEFGHIJKLMN'.split('');
// ความกว้างไล่ตามสัดส่วนใบกระดาษ (ว/ด/ป · เวลา ×3 · ชม./นาที · ปัญหา · สาเหตุ · การแก้ไข · อะไหล่ · ผู้ซ่อม · MO · หมายเหตุ)
const WIDTHS = [10.5, 6, 10.5, 6, 10.5, 6, 8.5, 22, 18, 18, 14, 13, 19, 14];

/** "ออกครั้งที่" ไม่มีคอลัมน์ในทะเบียน — อ่านจาก notes รูป "ออกครั้งที่ X" */
const issueOf = (df) => (String(df?.notes || '').match(/ออกครั้งที่\s*([^\s·,]+)/) || [])[1] || '';

function put(ws, ref, value, o = {}) {
  const c = ws.getCell(ref);
  c.value = value ?? '';
  c.font = { name: 'Tahoma', size: o.size ?? 9, bold: !!o.bold, color: o.color ? { argb: o.color } : undefined };
  c.alignment = { horizontal: o.align || 'left', vertical: o.valign || 'middle', wrapText: o.wrap !== false };
}
const box = (ws, r1, r2) => {
  for (let r = r1; r <= r2; r++) for (const col of COLS) ws.getCell(`${col}${r}`).border = allBorder;
};
const merge = (ws, a, b) => { try { ws.mergeCells(`${a}:${b}`); } catch { /* ซ้ำ */ } };

async function logoBuffer() {
  try {
    const res = await fetch(absAssetUrl(tsLogo));
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch { return null; }
}

/** วาดหัวฟอร์ม 1 ชุด เริ่มที่แถว r0 (7 แถว: หัว 5 + หัวตาราง 2) */
function drawHeader(ws, r0, { df, mc, page, pages, logoId }) {
  const R = (n) => r0 + n;   // n = 0..6
  for (let i = 0; i < 5; i++) ws.getRow(R(i)).height = 17;
  merge(ws, `A${R(0)}`, `B${R(4)}`);
  if (logoId != null) ws.addImage(logoId, { tl: { col: 0.25, row: R(0) - 1 + 0.15 }, ext: { width: 92, height: 80 } });
  merge(ws, `C${R(0)}`, `I${R(1)}`); put(ws, `C${R(0)}`, 'บริษัท ไทยซัมมิท โอโตโมทีฟ จำกัด ( สาขา 1 )', { bold: true, size: 13, align: 'center' });
  merge(ws, `C${R(2)}`, `I${R(2)}`); put(ws, `C${R(2)}`, 'THAI SUMMIT AUTOMOTIVE CO., LTD. ( Branch 1 )', { bold: true, size: 11, align: 'center' });
  merge(ws, `C${R(3)}`, `I${R(4)}`); put(ws, `C${R(3)}`, 'ใบบันทึกประวัติการซ่อมและการทำ PM MACHINE', { bold: true, size: 13, align: 'center' });
  const meta = [['หน้า', `${page}/${pages}`], ['เลขที่เอกสาร', df.form_code || ''], ['ออกครั้งที่', issueOf(df)], ['วันที่ออกใช้', df.effective_date || ''], ['แก้ไขครั้งที่', df.rev || '']];
  meta.forEach(([k, v], i) => { put(ws, `J${R(i)}`, k, { bold: true, align: 'center' }); put(ws, `K${R(i)}`, v, { bold: true, align: 'center' }); });
  merge(ws, `L${R(0)}`, `N${R(0)}`); put(ws, `L${R(0)}`, `M/C Number : ${mc.machine_no || ''}`);
  merge(ws, `L${R(1)}`, `N${R(1)}`); put(ws, `L${R(1)}`, `M/C Name : ${mc.machine_name || ''}`);
  merge(ws, `L${R(2)}`, `M${R(2)}`); put(ws, `L${R(2)}`, `M/C Brand Name : ${mc.brand || ''}`); put(ws, `N${R(2)}`, `Model : ${mc.model || ''}`);
  merge(ws, `L${R(3)}`, `M${R(3)}`); put(ws, `L${R(3)}`, `Location : ${mc.line_name || ''}`); put(ws, `N${R(3)}`, `Class : ${mc.class || ''}`);
  merge(ws, `L${R(4)}`, `N${R(4)}`); put(ws, `L${R(4)}`, `Setting : ${mc.setting || ''}`);
  // หัวตาราง 2 ชั้น
  ws.getRow(R(5)).height = 18; ws.getRow(R(6)).height = 18;
  const g = (a, b, t) => { merge(ws, a, b); put(ws, a, t, { align: 'center', bold: true }); };
  g(`A${R(5)}`, `B${R(5)}`, 'วันที่รับแจ้งซ่อม'); g(`C${R(5)}`, `D${R(5)}`, 'เริ่มซ่อม'); g(`E${R(5)}`, `F${R(5)}`, 'ซ่อมเสร็จ');
  put(ws, `G${R(5)}`, 'เวลาที่ใช้', { align: 'center', bold: true }); put(ws, `H${R(5)}`, 'ปัญหาที่พบ', { align: 'center', bold: true });
  [['I', 'สาเหตุ'], ['J', 'การแก้ไข'], ['K', 'อะไหล่'], ['L', 'ผู้ซ่อม'], ['M', 'ลำดับที่ MO'], ['N', 'หมายเหตุ']]
    .forEach(([c, t]) => g(`${c}${R(5)}`, `${c}${R(6)}`, t));
  ['ว / ด / ป', 'เวลา', 'ว / ด / ป', 'เวลา', 'ว / ด / ป', 'เวลา', 'ชั่วโมง/นาที', '(ระบุรายละเอียด)']
    .forEach((t, i) => put(ws, `${COLS[i]}${R(6)}`, t, { align: 'center' }));
  box(ws, R(0), R(6));
}

/**
 * @param {object} p
 * @param {object} p.machine  { machine_no, machine_name, brand, line_name, model?, class?, setting? }
 * @param {Array}  p.rows     ผลของ machineHistoryRows()
 */
export async function exportMachineHistoryExcel({ machine, rows }) {
  const df = await getDocForm(DOC_KEY, FALLBACK);
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ประวัติการซ่อม', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.5, header: 0.2, footer: 0.25 } },
    headerFooter: { oddFooter: '&C&"Tahoma,Bold"&11ประวัติการซ่อม' },
  });
  WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const buf = await logoBuffer();
  const logoId = buf ? wb.addImage({ buffer: buf, extension: 'png' }) : null;

  const pages = paginate(rows, ROWS_PER_PAGE);
  let r = 1;
  pages.forEach((pageRows, pi) => {
    drawHeader(ws, r, { df, mc: machine || {}, page: pi + 1, pages: pages.length, logoId });
    r += 7;
    for (let i = 0; i < ROWS_PER_PAGE; i++) {
      const x = pageRows[i];
      ws.getRow(r).height = 30;
      if (x) {
        [x.rep.d, x.rep.t, x.start.d, x.start.t, x.done.d, x.done.t, x.used, x.problem, x.cause, x.fix, x.parts, x.techs, x.moNo, x.note]
          .forEach((v, ci) => put(ws, `${COLS[ci]}${r}`, v, { align: ci <= 6 || ci === 12 ? 'center' : 'left', size: 8.5 }));
      }
      for (const col of COLS) ws.getCell(`${col}${r}`).border = allBorder;
      r++;
    }
    if (pi < pages.length - 1) ws.getRow(r - 1).addPageBreak();
  });

  const out = await wb.xlsx.writeBuffer();
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  // 🔴 เลขฟอร์มอยู่ที่ชื่อไฟล์ (กฎ Doc Control)
  a.download = `${df.form_code || 'FM-MTN-005'}_ประวัติซ่อม_${String(machine?.machine_no || 'machine').replace(/[\\/:*?"<>|]/g, '-')}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  return { pages: pages.length, rows: rows.length };
}
