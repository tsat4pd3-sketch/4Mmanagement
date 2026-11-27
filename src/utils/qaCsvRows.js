/* ══ qaCsvRows — แถวข้อมูลของ CSV "ผลตรวจ QA" (pure · มีเทส) ══════════════════════════════
   (2026-11-16 · feedback ประชุม 16/11: *"หน้า QA พวกการตรวจสอบและทุกๆการตรวจสอบ export data
    พวกผลตรวจ เป็น CSV ทั้งดาต้ารายพาร์ทและ SPC"*)

   ทำไมแยกไฟล์: ตัวประกอบแถว/ป้าย/การปัดเลข เป็นตรรกะที่พลาดแล้วเจ็บ (ค่าว่างกลายเป็น 0 =
   กราฟควบคุมใน Excel เพี้ยนทั้งใบ) แต่ `QaCheckSheet.jsx`/`QualityControl.jsx` แตะ DOM + ฐาน
   ⇒ `node --test` โหลดไม่ได้ · ย้ายส่วนที่ "คิดเอง ไม่แตะฐาน" มาที่นี่ (pattern เดียวกับ
   `utils/csvCore.js` · `utils/qaPrintRows.js`)

   🔴 กฎที่ห้ามหลุด:
   1. **ค่าที่ไม่มี/วัดไม่ได้ = ช่องว่าง ห้ามเป็น 0** — 0 บน CSV อ่านว่า "วัดได้ศูนย์"
      (Cpk/Mean/ค่าล่าสุดที่คิดไม่ได้ = ว่าง · จำนวนที่นับได้จริงเท่านั้นที่เป็นเลข)
   2. **ห้ามใส่บรรทัดเลขฟอร์ม/หัวเรื่องในเนื้อไฟล์** — แถวแรก = หัวตารางเสมอ
      (เลขฟอร์ม/Rev อยู่ที่ "ชื่อไฟล์" ผ่าน `utils/csvDoc.js` · CLAUDE.md §doc-forms)
   3. **จุดที่กด "ข้าม" (`judgement='na'`) ไม่ใช่ค่าวัด** ⇒ ไม่เข้าไฟล์ SPC (กฎเดียวกับ
      `utils/qaSpcSource.js` ที่จอ SPC ใช้) แต่ **ยังอยู่ในไฟล์ผลตรวจรายพาร์ท** (เป็นข้อเท็จจริงว่าไม่ได้ตรวจ)
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import { stageLabel } from './qaStages.js';   // ⚠️ ต้องมี `.js` — ไฟล์นี้ถูก `node --test` โหลดตรงๆ (ไม่ผ่าน vite resolver)
import { tr } from './i18n.js';

export const SHIFT_TH = { day: 'เช้า', night: 'ดึก' };
export const JUDGE_TH = { ok: 'ผ่าน', ng: 'ไม่ผ่าน', na: 'ข้าม (ไม่ได้ตรวจ)' };
export const SHEET_STATUS_TH = { open: 'กำลังตรวจ', done: 'ปิดใบแล้ว' };
export const SHEET_RESULT_TH = { pass: 'ผ่าน', fail: 'ไม่ผ่าน' };

/** เลขที่ "มีจริง" เท่านั้น — null/''/NaN = ช่องว่าง (ห้ามกลายเป็น 0) */
const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** ช่องตัวเลขของ CSV — ว่างถ้าไม่มีค่า · ปัดทศนิยมแล้วคืนเป็น "ตัวเลข" ให้ Excel คิดสูตรต่อได้ */
const cellNum = (v, digits = null) => {
  const n = num(v);
  if (n == null) return '';
  return digits == null ? n : Number(n.toFixed(digits));
};
const txt = (v) => (v == null ? '' : String(v));
const shiftOrder = (s) => (s === 'day' ? 0 : s === 'night' ? 1 : 9);
const balloonCmp = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true });

/* ════════════════════════════════════════════════════════════════════════════
   1) ผลตรวจรายพาร์ท — 1 แถว = 1 จุดตรวจในใบตรวจ 1 รอบ
   ════════════════════════════════════════════════════════════════════════════ */
export const QA_RESULT_HEADERS = [
  'วันงาน', 'กะ', 'รอบที่', 'ช่วงตรวจ', 'Part No.', 'ชื่อพาร์ท', 'ไลน์', 'Lot', 'เครื่อง',
  'ผู้ตรวจ', 'รหัสผู้ตรวจ', 'สถานะใบ', 'ผลสรุปใบ',
  'บอลลูน', 'จุดตรวจ', 'ชนิดจุด', 'สเปคที่ใช้ตัดสิน', 'ผลตัดสิน',
  'ค่าที่วัด (ทุกชิ้น)', 'จำนวนที่ตรวจ', 'จำนวน NG', 'เปิด NCR', 'หมายเหตุ', 'บันทึกโดย', 'บันทึกเมื่อ',
];

/**
 * @param {Array} sheets   แถว qa_inspection_sheets (หัวใบ)
 * @param {Array} results  แถว qa_inspection_results (ผลรายจุด · ผูกด้วย sheet_id)
 * @returns {Array<Array>} แถวข้อมูล (ไม่รวมหัวตาราง) เรียง วันงาน → กะ → รอบ → บอลลูน
 *
 * ใบที่ไม่มีผลสักจุด = ไม่มีแถว (ยังไม่มีผลตรวจให้ส่งออก — ห้ามแต่งแถวว่างให้ดูเหมือนตรวจแล้ว)
 */
export function qaResultCsvRows(sheets, results) {
  const byId = new Map((sheets || []).filter(s => s?.id).map(s => [s.id, s]));
  const rows = [];
  for (const r of results || []) {
    const s = byId.get(r?.sheet_id);
    if (!s) continue;                       // ผลที่หาหัวใบไม่เจอ = ข้อมูลไม่ครบ ผู้เรียกเป็นคนเตือนบนจอ
    const vals = Array.isArray(r.values_json) ? r.values_json.filter(v => v !== '' && v != null) : [];
    rows.push({
      _k: [txt(s.work_date), shiftOrder(s.shift), Number(s.round_no) || 0, txt(r.balloon_no)],
      row: [
        txt(s.work_date), SHIFT_TH[s.shift] || txt(s.shift), cellNum(s.round_no), stageLabel(s.stage),
        txt(s.part_no), txt(s.part_name), txt(s.line_name), txt(s.lot_no), txt(s.machine_no),
        txt(s.inspector_name), txt(s.inspector_code),
        SHEET_STATUS_TH[s.status] || txt(s.status), SHEET_RESULT_TH[s.result] || txt(s.result),
        txt(r.balloon_no), txt(r.characteristic), txt(r.item_type), txt(r.spec_text),
        JUDGE_TH[r.judgement] || txt(r.judgement),
        vals.join(' | '),
        cellNum(r.qty_checked),
        // qty_ng เป็น not-null default 0 ⇒ 0 คือ "นับแล้วได้ศูนย์" เป็นเลขจริง ไม่ใช่ค่าที่ไม่มี
        cellNum(r.qty_ng ?? 0),
        r.ncr_id ? 'เปิดแล้ว' : '',
        txt(r.note), txt(r.recorded_by), txt(r.recorded_at),
      ],
    });
  }
  rows.sort((a, b) =>
    String(a._k[0]).localeCompare(String(b._k[0]))
    || a._k[1] - b._k[1]
    || a._k[2] - b._k[2]
    || balloonCmp(a._k[3], b._k[3]));
  return rows.map(x => x.row);
}

/* ════════════════════════════════════════════════════════════════════════════
   2) SPC — ค่าวัดรายค่า (1 แถว = 1 ค่าวัด · เอาไปทำ control chart ใน Excel ได้ตรงๆ)
   ════════════════════════════════════════════════════════════════════════════ */
export const QA_SPC_VALUE_HEADERS = [
  'Part No.', 'ชื่อพาร์ท', 'ไลน์', 'บอลลูน', 'จุดวัด', 'หน่วย', 'LSL', 'Nominal', 'USL',
  'ลำดับที่ (ในจุดนี้)', 'วันงาน', 'กะ', 'รอบที่', 'ชิ้นที่', 'ค่าที่วัด', 'หลุด spec', 'ผลตัดสินของจุด', 'ผู้ตรวจ',
];

/**
 * แตะ "แถวค่าวัด" (รูปเดียวกับที่ `computeSPC` กิน: `{ readings:[…] }`) ให้เป็นค่าเดี่ยวต่อแถว
 * — ใช้ได้ทั้งค่าจากใบตรวจ (`qaSpcSource.sheetResultsToRows` · readings 1 ค่า + piece_no)
 *   และจุดควบคุมที่ตั้งเอง (`qa_measurements.readings` = subgroup n ค่า)
 * 🔴 ค่าว่าง/ไม่ใช่ตัวเลข = ไม่ใช่ค่าวัด ⇒ ตัดออก (ห้ามเดาเป็น 0)
 */
export function spcValuesFrom(rows) {
  const out = [];
  for (const r of rows || []) {
    const vals = Array.isArray(r?.readings) ? r.readings : [];
    vals.forEach((v, i) => {
      const n = num(v);
      if (n == null) return;
      out.push({
        work_date: r.work_date ?? null, shift: r.shift ?? null, round_no: r.round_no ?? null,
        piece_no: r.piece_no ?? i + 1, value: n,
        judgement: r.judgement ?? null, operator_name: r.operator_name ?? null,
      });
    });
  }
  return out;
}

/** ค่านี้หลุด spec ไหม — ไม่มี limit = ตอบไม่ได้ (null) ห้ามตอบ "ไม่หลุด" */
export function outOfSpec(value, point) {
  const v = num(value), lsl = num(point?.lsl), usl = num(point?.usl);
  if (v == null || (lsl == null && usl == null)) return null;
  return (lsl != null && v < lsl) || (usl != null && v > usl);
}

/**
 * @param {Array} groups [{ point, values }] — `point` = จุดวัด · `values` = ผลจาก spcValuesFrom() เรียงเก่า→ใหม่
 * @returns {Array<Array>} แถวข้อมูล (ไม่รวมหัวตาราง)
 */
export function qaSpcValueRows(groups) {
  const rows = [];
  for (const g of groups || []) {
    const p = g?.point || {};
    (g?.values || []).forEach((v, i) => {
      const oos = outOfSpec(v.value, p);
      rows.push([
        txt(p.part_no), txt(p.part_name), txt(p.line_name), txt(p.balloon_no), txt(p.characteristic), txt(p.unit),
        cellNum(p.lsl), cellNum(p.nominal), cellNum(p.usl),
        i + 1, txt(v.work_date), SHIFT_TH[v.shift] || txt(v.shift), cellNum(v.round_no), cellNum(v.piece_no),
        v.value,
        oos == null ? '' : (oos ? 'หลุด' : ''),      // ไม่หลุด = ว่าง (ให้ filter "หลุด" ใน Excel ได้ทันที)
        JUDGE_TH[v.judgement] || txt(v.judgement),
        txt(v.operator_name),
      ]);
    });
  }
  return rows;
}

/* ════════════════════════════════════════════════════════════════════════════
   3) SPC — สรุปความสามารถของกระบวนการรายจุด (ตารางเดียวกับที่จอ SPC โชว์)
   ════════════════════════════════════════════════════════════════════════════ */
export const QA_SPC_SUMMARY_HEADERS = [
  'Part No.', 'ชื่อพาร์ท', 'ไลน์', 'บอลลูน', 'จุดวัด', 'หน่วย', 'LSL', 'Nominal', 'USL',
  'จำนวนค่าที่ใช้คิด (n)', 'Mean', 'σ within', 'σ overall', 'Cp', 'Cpk', 'Pp', 'Ppk',
  'จำนวนค่าหลุด spec', 'ค่าล่าสุด', 'วันของค่าล่าสุด', 'สถานะ',
];

/** เกณฑ์เดียวกับจอ SPC (`utils/qaSpcSource.CPK_OK`) — แยกออกมาให้ไฟล์นี้ pure ไม่ต้องพึ่งกัน */
export const CPK_OK = 1.33;

/**
 * ป้ายสถานะของจุด — "ไม่รู้" ต้องอ่านออกว่าไม่รู้ ห้ามเขียนว่า "ปกติ"
 * @param {{n:number, cpk:number|null, oos:number}} st
 */
export function spcPointVerdict(st) {
  if (!st?.n) return 'ยังไม่มีค่าวัด';
  if (st.oos > 0) return 'มีค่าหลุด spec';
  if (st.cpk == null) return 'คิด Cpk ไม่ได้ (ค่าน้อยไป / ค่าเท่ากันหมด / ไม่มี spec)';
  return st.cpk < CPK_OK ? `Cpk < ${CPK_OK}` : tr("ปกติ");
}

/**
 * @param {Array} stats [{ point, n, mean, sigmaWithin, sigmaOverall, cp, cpk, pp, ppk, oos, last, lastDate }]
 *   — จุดที่ยังไม่มีค่าก็ต้องอยู่ในไฟล์ (ช่องว่าง + สถานะ "ยังไม่มีค่าวัด") เพราะ "ไม่มีค่า" เป็นคำตอบ
 */
export function qaSpcSummaryRows(stats) {
  return (stats || []).map(st => {
    const p = st?.point || {};
    return [
      txt(p.part_no), txt(p.part_name), txt(p.line_name), txt(p.balloon_no), txt(p.characteristic), txt(p.unit),
      cellNum(p.lsl), cellNum(p.nominal), cellNum(p.usl),
      st?.n ? st.n : '',                        // ยังไม่มีค่า = ว่าง ไม่ใช่ 0
      cellNum(st?.mean, 4), cellNum(st?.sigmaWithin, 5), cellNum(st?.sigmaOverall, 5),
      cellNum(st?.cp, 3), cellNum(st?.cpk, 3), cellNum(st?.pp, 3), cellNum(st?.ppk, 3),
      st?.n ? (Number(st.oos) || 0) : '',       // นับได้จริงเมื่อมีค่าเท่านั้น
      cellNum(st?.last), txt(st?.lastDate),
      spcPointVerdict({ n: st?.n || 0, cpk: st?.cpk ?? null, oos: Number(st?.oos) || 0 }),
    ];
  });
}

/** ชื่อไฟล์เดิม (legacy name) — ตัวอักษรที่ตั้งชื่อไฟล์ไม่ได้ถูกล้างใน `csvCore.docFileNameFrom` อยู่แล้ว */
export const csvStamp = (parts) => parts.filter(x => x !== '' && x != null).join('_');
