/**
 * mtnMoExportExcel — Export ข้อมูลใบแจ้งซ่อม MO ของช่วงที่เลือก (ใช้ทำรายงานรายเดือน)
 *
 * ที่มา (user 2026-10-06): *"ยังไม่มีระบบ export data ของ mo ที่เกิดขึ้นในแต่ละช่วงเดือน
 *   ออกมาใช่มั้ย"* — ถูก ของเดิมมีแต่ `printMoReport()` = พิมพ์ใบ **ทีละใบ**
 *   (FM-MTN-006 / FM-JIG-008) เอายอดรวมของเดือนออกไปทำรายงาน/ประชุมไม่ได้เลย
 *
 * 3 ชีท:
 *   1. "รายการ MO"      — 1 บรรทัด = 1 ใบ (ข้อมูลดิบ เอาไป pivot ต่อได้)
 *   2. "สรุปรายเดือน"   — เดือน × จำนวนใบ/ปิดแล้ว/ค้าง + เวลาตอบสนอง/เวลาซ่อม เฉลี่ย
 *   3. "พาเรโตกลุ่มปัญหา" — กลุ่ม × จำนวน × % × %สะสม
 *
 * 🔴 กฎความซื่อสัตย์ที่ไฟล์นี้ต้องทำตาม (CLAUDE.md §"อื่นๆ/ไม่ระบุ" ชั้น 3):
 *   · **ไม่รู้ = ขีด "–" ห้ามเขียน 0** (ใบที่ยังไม่รับงาน/ยังไม่ปิด ไม่มีเวลาซ่อม —
 *     เขียน 0 แล้วค่าเฉลี่ยเพี้ยนลงทันที และไม่มีใครรู้ว่าเพี้ยน)
 *   · **งานตามแผน (PM) กันออกจากพาเรโต *ปัญหา* แต่ห้ามซ่อน** — เขียนเป็นบรรทัดแยก
 *   · **ต้องเขียนว่า "ชี้เป้าไม่ได้กี่ %"** ทั้งบนหัวชีทและในพาเรโต
 *   · ค่าเฉลี่ยทุกตัวต้องบอก **หารจากกี่ใบ** (n) — ไม่งั้นอ่านเป็นค่าของทั้งเดือน
 *
 * กฎ Doc Control (CLAUDE.md): เอกสาร export ใหม่ทุกตัวต้อง register ใน /doc-forms —
 *   doc_key = 'mtn_mo_monthly_export' (seed migration 20261006_doc_form_mtn_mo_monthly_main.sql)
 *   ห้าม hardcode เลขฟอร์ม/Rev ในไฟล์นี้ — อ่านผ่าน getDocForm + fallback เสมอ
 */
import { getDocForm, fullCode } from '../utils/docForms';
import { isVague, isPlannedWork, PLANNED_GROUP } from '../utils/unclassified';

const thin = { style: 'thin' };
const allBorder = { top: thin, bottom: thin, left: thin, right: thin };
/** ไม่รู้ = ขีด ห้าม 0 (ดูหัวไฟล์) */
const DASH = '–';

function put(ws, ref, value, opt = {}) {
  const c = ws.getCell(ref);
  c.value = value ?? '';
  c.font = { size: opt.size ?? 10, bold: !!opt.bold, name: 'Tahoma', color: opt.color ? { argb: opt.color } : undefined };
  c.alignment = { horizontal: opt.align || 'left', vertical: 'middle', wrapText: !!opt.wrap };
  if (opt.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opt.fill } };
  if (opt.numFmt) c.numFmt = opt.numFmt;
  if (opt.border !== false) c.border = allBorder;
}
const mergeSafe = (ws, r) => { try { ws.mergeCells(r); } catch { /* merged already */ } };
const colRef = (i) => {           // 0 → A · 25 → Z · 26 → AA (ชีทแรกมี 19 คอลัมน์ เผื่อโตไว้)
  let s = '', n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
};
const head = (ws, row, labels, widths) => {
  labels.forEach((h, i) => put(ws, `${colRef(i)}${row}`, h, { bold: true, align: 'center', fill: 'FFD9E1F2', wrap: true, size: 9.5 }));
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.getRow(row).height = 30;
};

/** นาทีระหว่าง 2 timestamp — ขาดข้างใดข้างหนึ่ง = null (ไม่รู้) ห้ามคืน 0 */
function minsBetween(a, b) {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 60000) : null;
}
/** เฉลี่ยจากค่าที่ "รู้จริง" เท่านั้น + บอกว่าหารจากกี่ตัว */
function avgOf(list) {
  const ok = list.filter(v => typeof v === 'number' && Number.isFinite(v));
  return ok.length ? { v: Math.round(ok.reduce((s, x) => s + x, 0) / ok.length), n: ok.length } : { v: null, n: 0 };
}
const fmtMin = (m) => (m == null ? DASH : m >= 60 ? `${(m / 60).toFixed(1)} ชม.` : `${m} น.`);
const monthOf = (d) => String(d || '').slice(0, 7);

const TH_MONTH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export function thaiMonthLabel(monthKey) {
  const [y, m] = String(monthKey || '').split('-').map(Number);
  if (!y || !m) return monthKey || '';
  return `${TH_MONTH[m - 1] || m} ${y + 543}`;
}

/**
 * @param {object} p
 * @param {Array}  p.rows      ใบที่ "เห็นบนจอ" (กรองแล้ว) — export ต้องตรงกับที่คนเห็น
 * @param {string} p.from      ขอบล่างช่วง 'YYYY-MM-DD'
 * @param {string} p.to        ขอบบนช่วง
 * @param {(o:any)=>string} [p.dateOf]  วันของใบ (default = work_date) — หน้าเรียกส่ง
 *                                      `workDateOfTime(report_at)` มาเป็น fallback ให้
 * @param {(o:any)=>boolean} [p.isOpen] ใบนี้ยังค้างไหม (ส่ง isMoOpen จาก mtnStepPerm มา —
 *                                      ห้ามเดาจาก status เองในไฟล์นี้ กฎเลขขั้น 2 ฟอร์ม)
 * @param {(k:string)=>string} [p.teamName] key ทีม → ชื่อที่โชว์ (deptNameOf)
 * @param {(o:any)=>string} [p.statusLabel] ป้ายสถานะ (moStatusLabel — ห้ามเขียนตารางสถานะซ้ำ)
 * @param {string} [p.filterNote] สรุปตัวกรองที่เปิดอยู่ (ติดไปกับไฟล์ ห้ามส่งตัวเลขลอยๆ)
 */
export async function exportMoExcel({
  rows = [], from = '', to = '', dateOf = (o) => o.work_date,
  isOpen = null, teamName = (k) => k, statusLabel = (o) => o.status, filterNote = '',
}) {
  const df = await getDocForm('mtn_mo_monthly_export', { title: 'สรุปใบแจ้งซ่อม MO รายเดือน' });
  const ExcelJS = (await import('exceljs')).default;   // lazy — ก้อน ~960KB ใช้ร่วมกับ export ตัวอื่น
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ESM';

  /* ── เตรียมค่าที่ใช้ซ้ำทุกชีท (คำนวณครั้งเดียว) ── */
  const enriched = rows.map(o => {
    const grp = String(o.problem_group || '').trim();
    const ch = String(o.problem_characteristic || '').trim();
    return {
      o,
      date: dateOf(o) || '',
      month: monthOf(dateOf(o) || ''),
      group: grp,
      chara: ch,
      planned: isPlannedWork(grp),
      /* "ชี้เป้าไม่ได้" = กลุ่มหรืออาการเป็นคำกำกวม/ว่าง · ตัดงานตามแผนออกก่อน
         (งานตามแผนไม่ใช่ "ระบุไม่ได้" มันคือ "ไม่ใช่ปัญหา" — คนละเรื่อง) */
      vague: !isPlannedWork(grp) && (!grp || isVague(grp) || !ch || isVague(ch)),
      respMin: minsBetween(o.report_at, o.accept_at),
      fixMin: minsBetween(o.accept_at, o.repair_done_at),
      open: isOpen ? isOpen(o) : o.status !== 'closed',
    };
  });
  const total = enriched.length;
  const plannedN = enriched.filter(r => r.planned).length;
  const vagueN = enriched.filter(r => r.vague).length;
  const pct = (n) => (total ? `${((n / total) * 100).toFixed(1)}%` : DASH);

  /* ตัวหนังสือบอกความครบถ้วน — ต้องติดไปทุกชีท (ห้ามส่งตัวเลขลอยๆ ออกจากระบบ) */
  const honesty = total
    ? `ชี้เป้าไม่ได้ ${vagueN} ใบ (${pct(vagueN)}) = กลุ่ม/อาการเป็น "อื่นๆ" หรือว่าง`
      + ` · งานตามแผน (PM) ${plannedN} ใบ (${pct(plannedN)}) กันออกจากพาเรโตปัญหาแล้ว แต่ไม่ได้ซ่อน`
    : 'ไม่มีใบในช่วงที่เลือก';

  // ═══ ชีท 1 · รายการ MO (ข้อมูลดิบ 1 บรรทัด = 1 ใบ) ═══════════════════════════
  const ws1 = wb.addWorksheet('รายการ MO', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 4 }],   // หัวตารางค้างไว้ — ไฟล์ยาวหลายร้อยบรรทัด
  });
  const H1 = ['วันที่', 'เลข MO', 'สถานะ', 'ค้าง/จบ', 'ทีมช่าง', 'ไลน์', 'เลขเครื่อง', 'ชนิดอุปกรณ์',
    'ประเภทงานซ่อม', 'กลุ่มปัญหา', 'อาการ (หัวข้อย่อย)', 'รายละเอียดที่คนแจ้งพิมพ์',
    'เวลาแจ้ง', 'เวลารับงาน', 'เวลาซ่อมเสร็จ', 'ตอบสนอง (นาที)', 'เวลาซ่อม (นาที)',
    'เกี่ยวคุณภาพ', 'ชี้เป้าได้?'];
  mergeSafe(ws1, `A1:${colRef(H1.length - 1)}1`);
  put(ws1, 'A1', `${df.title || 'สรุปใบแจ้งซ่อม MO รายเดือน'} · ช่วง ${from} → ${to} · ${total} ใบ`,
    { bold: true, size: 13, align: 'center', border: false });
  mergeSafe(ws1, `A2:${colRef(H1.length - 1)}2`);
  put(ws1, 'A2', honesty + (fullCode(df) ? ` · ${fullCode(df)}` : ''), { size: 9.5, align: 'center', border: false, color: 'FF9C5700' });
  if (filterNote) {
    mergeSafe(ws1, `A3:${colRef(H1.length - 1)}3`);
    put(ws1, 'A3', `ตัวกรองที่เปิดอยู่ตอน export: ${filterNote}`, { size: 9, align: 'center', border: false, color: 'FF808080' });
  }
  head(ws1, 4, H1, [11, 21, 17, 9, 15, 16, 13, 16, 15, 22, 26, 34, 16, 16, 16, 13, 13, 11, 10]);

  enriched.forEach((r, i) => {
    const n = 5 + i;
    const o = r.o;
    put(ws1, `A${n}`, r.date || DASH, { align: 'center', size: 9.5 });
    put(ws1, `B${n}`, o.mo_no || DASH, { size: 9.5 });
    put(ws1, `C${n}`, statusLabel(o) || o.status || DASH, { size: 9.5 });
    put(ws1, `D${n}`, r.open ? 'ค้าง' : 'จบแล้ว', { align: 'center', size: 9.5, color: r.open ? 'FFC00000' : undefined });
    put(ws1, `E${n}`, teamName(o.mtn_dept) || DASH, { size: 9.5 });
    put(ws1, `F${n}`, o.line_name || DASH, { size: 9.5 });
    put(ws1, `G${n}`, o.machine_no || DASH, { size: 9.5 });
    put(ws1, `H${n}`, o.item_type || DASH, { size: 9.5 });
    put(ws1, `I${n}`, o.repair_type || DASH, { size: 9.5 });
    put(ws1, `J${n}`, r.group || DASH, { size: 9.5, fill: r.group ? undefined : 'FFFFF2CC' });
    put(ws1, `K${n}`, r.chara || DASH, { size: 9.5 });
    put(ws1, `L${n}`, o.report_note || '', { size: 9, wrap: true });
    put(ws1, `M${n}`, o.report_at ? new Date(o.report_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : DASH, { size: 9 });
    put(ws1, `N${n}`, o.accept_at ? new Date(o.accept_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : DASH, { size: 9 });
    put(ws1, `O${n}`, o.repair_done_at ? new Date(o.repair_done_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : DASH, { size: 9 });
    // 🔴 ยังไม่รับงาน/ยังไม่ปิด = ขีด ห้าม 0 (ไม่งั้น pivot หาค่าเฉลี่ยได้เลขที่ต่ำกว่าจริง)
    put(ws1, `P${n}`, r.respMin == null ? DASH : r.respMin, { align: 'center', size: 9.5 });
    put(ws1, `Q${n}`, r.fixMin == null ? DASH : r.fixMin, { align: 'center', size: 9.5 });
    put(ws1, `R${n}`, o.quality_related ? 'ใช่' : '', { align: 'center', size: 9.5 });
    put(ws1, `S${n}`, r.planned ? 'ตามแผน' : r.vague ? 'ไม่ได้' : 'ได้', {
      align: 'center', size: 9.5, fill: r.vague ? 'FFFFF2CC' : undefined,
    });
  });
  if (!total) {
    mergeSafe(ws1, `A5:${colRef(H1.length - 1)}5`);
    put(ws1, 'A5', 'ไม่มีใบแจ้งซ่อมในช่วง/ตัวกรองที่เลือก — ลองขยายช่วงวันที่หรือล้างตัวกรอง', { align: 'center', color: 'FF808080' });
  }
  ws1.autoFilter = { from: `A4`, to: `${colRef(H1.length - 1)}${4 + Math.max(total, 1)}` };

  // ═══ ชีท 2 · สรุปรายเดือน ════════════════════════════════════════════════════
  const ws2 = wb.addWorksheet('สรุปรายเดือน', { pageSetup: { paperSize: 9, fitToPage: true, fitToWidth: 1 } });
  const H2 = ['เดือน', 'จำนวนใบ', 'จบแล้ว', 'ยังค้าง', 'เกี่ยวคุณภาพ', 'งานตามแผน (PM)',
    'ชี้เป้าไม่ได้', 'ชี้เป้าไม่ได้ %', 'ตอบสนองเฉลี่ย', '(หารจากกี่ใบ)', 'เวลาซ่อมเฉลี่ย', '(หารจากกี่ใบ)'];
  mergeSafe(ws2, `A1:${colRef(H2.length - 1)}1`);
  put(ws2, 'A1', `สรุปใบแจ้งซ่อม MO รายเดือน · ช่วง ${from} → ${to}`, { bold: true, size: 13, align: 'center', border: false });
  mergeSafe(ws2, `A2:${colRef(H2.length - 1)}2`);
  put(ws2, 'A2', 'ค่าเฉลี่ยคิดจากใบที่ "มีเวลาครบ" เท่านั้น — ใบที่ยังไม่รับงาน/ยังไม่ปิด ไม่ถูกนับเป็น 0',
    { size: 9.5, align: 'center', border: false, color: 'FF9C5700' });
  head(ws2, 4, H2, [14, 11, 10, 10, 13, 15, 13, 14, 15, 14, 15, 14]);

  const months = [...new Set(enriched.map(r => r.month).filter(Boolean))].sort();
  const monthRows = months.map(m => enriched.filter(r => r.month === m));
  // แถวสุดท้าย = รวมทุกเดือน (รวมใบที่ไม่รู้วัน ซึ่งไม่เข้าเดือนไหน — ห้ามหายจากยอดรวม)
  const blocks = [...months.map((m, i) => [thaiMonthLabel(m), monthRows[i]]), ['รวมทั้งช่วง', enriched]];
  blocks.forEach(([label, list], i) => {
    const n = 5 + i;
    const last = i === blocks.length - 1;
    const resp = avgOf(list.map(r => r.respMin));
    const fix = avgOf(list.map(r => r.fixMin));
    const vg = list.filter(r => r.vague).length;
    const opt = { bold: last, fill: last ? 'FFEDEDED' : undefined, size: 9.5 };
    put(ws2, `A${n}`, label, { ...opt, align: 'center' });
    put(ws2, `B${n}`, list.length, { ...opt, align: 'center' });
    put(ws2, `C${n}`, list.filter(r => !r.open).length, { ...opt, align: 'center' });
    put(ws2, `D${n}`, list.filter(r => r.open).length, { ...opt, align: 'center' });
    put(ws2, `E${n}`, list.filter(r => r.o.quality_related).length, { ...opt, align: 'center' });
    put(ws2, `F${n}`, list.filter(r => r.planned).length, { ...opt, align: 'center' });
    put(ws2, `G${n}`, vg, { ...opt, align: 'center', fill: last ? 'FFEDEDED' : (vg ? 'FFFFF2CC' : undefined) });
    put(ws2, `H${n}`, list.length ? `${((vg / list.length) * 100).toFixed(1)}%` : DASH, { ...opt, align: 'center' });
    put(ws2, `I${n}`, fmtMin(resp.v), { ...opt, align: 'center' });
    put(ws2, `J${n}`, resp.n ? `${resp.n} / ${list.length}` : DASH, { ...opt, align: 'center', size: 9 });
    put(ws2, `K${n}`, fmtMin(fix.v), { ...opt, align: 'center' });
    put(ws2, `L${n}`, fix.n ? `${fix.n} / ${list.length}` : DASH, { ...opt, align: 'center', size: 9 });
  });

  // ═══ ชีท 3 · พาเรโตกลุ่มปัญหา ════════════════════════════════════════════════
  const ws3 = wb.addWorksheet('พาเรโตกลุ่มปัญหา', { pageSetup: { paperSize: 9, fitToPage: true, fitToWidth: 1 } });
  const H3 = ['อันดับ', 'กลุ่มปัญหา', 'จำนวนใบ', '% ของปัญหา', '% สะสม', 'เวลาซ่อมเฉลี่ย', '(หารจากกี่ใบ)'];
  mergeSafe(ws3, `A1:${colRef(H3.length - 1)}1`);
  put(ws3, 'A1', `พาเรโตกลุ่มปัญหา · ช่วง ${from} → ${to}`, { bold: true, size: 13, align: 'center', border: false });
  mergeSafe(ws3, `A2:${colRef(H3.length - 1)}2`);
  put(ws3, 'A2', `ฐาน % = ใบที่เป็น "ปัญหา" เท่านั้น (ตัดงานตามแผน ${plannedN} ใบออก — อยู่บรรทัดล่างตาราง ไม่ได้ซ่อน)`,
    { size: 9.5, align: 'center', border: false, color: 'FF9C5700' });
  head(ws3, 4, H3, [8, 34, 11, 13, 12, 16, 15]);

  /* ฐานพาเรโต = ปัญหาจริง · 🔴 ห้าม slice ก่อนคิด % สะสม (เส้นจบ 100% ที่อันดับ 10
     ทั้งที่มีอันดับ 11+ = ไฟล์โกหก · กฎเดียวกับ <ParetoChart> ในระบบ) */
  const probs = enriched.filter(r => !r.planned);
  const byGroup = new Map();
  for (const r of probs) {
    const g = r.group || '(ไม่ระบุกลุ่ม)';
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(r);
  }
  const ranked = [...byGroup.entries()].sort((a, b) => b[1].length - a[1].length);
  let accum = 0;
  ranked.forEach(([g, list], i) => {
    const n = 5 + i;
    accum += list.length;
    const fix = avgOf(list.map(r => r.fixMin));
    const vagueGroup = !g || g === '(ไม่ระบุกลุ่ม)' || isVague(g);
    put(ws3, `A${n}`, i + 1, { align: 'center', size: 9.5 });
    put(ws3, `B${n}`, g, { size: 9.5, fill: vagueGroup ? 'FFFFF2CC' : undefined });
    put(ws3, `C${n}`, list.length, { align: 'center', size: 9.5, bold: true });
    put(ws3, `D${n}`, probs.length ? `${((list.length / probs.length) * 100).toFixed(1)}%` : DASH, { align: 'center', size: 9.5 });
    put(ws3, `E${n}`, probs.length ? `${((accum / probs.length) * 100).toFixed(1)}%` : DASH, { align: 'center', size: 9.5 });
    put(ws3, `F${n}`, fmtMin(fix.v), { align: 'center', size: 9.5 });
    put(ws3, `G${n}`, fix.n ? `${fix.n} / ${list.length}` : DASH, { align: 'center', size: 9 });
  });
  // งานตามแผนต่อท้าย — แยกออกจากฐาน % แต่ต้องเห็น (กฎ: แยกออก ≠ ซ่อน)
  const pRow = 5 + ranked.length + 1;
  put(ws3, `A${pRow}`, '—', { align: 'center', size: 9.5 });
  put(ws3, `B${pRow}`, `${PLANNED_GROUP} — ไม่ใช่ปัญหา จึงไม่อยู่ในฐาน % ข้างบน`, { size: 9.5, fill: 'FFE2EFDA' });
  put(ws3, `C${pRow}`, plannedN, { align: 'center', size: 9.5, bold: true, fill: 'FFE2EFDA' });
  put(ws3, `D${pRow}`, DASH, { align: 'center', size: 9.5, fill: 'FFE2EFDA' });
  put(ws3, `E${pRow}`, DASH, { align: 'center', size: 9.5, fill: 'FFE2EFDA' });
  put(ws3, `F${pRow}`, fmtMin(avgOf(enriched.filter(r => r.planned).map(r => r.fixMin)).v), { align: 'center', size: 9.5, fill: 'FFE2EFDA' });
  put(ws3, `G${pRow}`, DASH, { align: 'center', size: 9.5, fill: 'FFE2EFDA' });
  mergeSafe(ws3, `A${pRow + 2}:${colRef(H3.length - 1)}${pRow + 3}`);
  put(ws3, `A${pRow + 2}`,
    `⚠️ ${honesty}\n`
    + 'แถวที่ระบายสีเหลือง = ชี้เป้าไม่ได้ ต้องไปแก้ที่ "ทะเบียนลักษณะปัญหา" (/mtn-repair → ข้อมูลหลัก → 🛑 ลักษณะปัญหา) '
    + 'ให้ทีมนั้นมีอาการให้เลือกครบ ไม่ใช่แก้ที่ไฟล์นี้',
    { size: 9, wrap: true, border: false, color: 'FF9C5700' });

  // ── ดาวน์โหลด ──
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MO-${from}_${to}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  return { rows: total, vague: vagueN, planned: plannedN };
}
