import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQuestion, periodFromText, defaultPeriod, matchSubject, oeeSummary, downtimeTop, productionTotals,
  rankLinesByOee, openDowntimeList, moOpenSummary, fourMPendingSummary, defectTop, attendanceSummary, makeShiftOf, applyHelpers, scrapReportSummary,
} from '../askBot.js';
import { dtOpenKind } from '../downtimeRules.js';

/* 💬 แชทถามข้อมูล ขั้นที่ 1 (19/11) — ล็อกตัวอ่านคำถาม + สูตรรวมผล
   ⚠️ ตรึงวันที่เองทุกเคส ห้ามอ้าง new Date() (รอบ "นาฬิกา +400 วัน") */
const T = '2026-11-19';   // วันพฤหัส

test('ประโยคจริงจาก user อ่านได้ครบ: เจตนา + ช่วง + ชื่อ', () => {
  const q = parseQuestion('ขอยอดผลิตงาน apron assy 060 ของเดือน 10 ที', T);
  assert.equal(q.intent, 'production');
  assert.equal(q.period.from, '2026-10-01');
  assert.equal(q.period.to, '2026-10-31');
  assert.equal(q.subject, 'apron assy 060');
  const q2 = parseQuestion('เดือนนี้ ผลิตงาน apron 060 ไปกี่ชิ้นแล้ว', T);
  assert.equal(q2.intent, 'production');
  assert.equal(q2.subject, 'apron 060');
  assert.deepEqual([q2.period.from, q2.period.to], ['2026-11-01', T], 'เดือนนี้ตัดที่วันนี้ ไม่ลากไปอนาคต');
});

test('เจตนา: OEE มาก่อนยอดผลิต · downtime สะกดได้หลายแบบ · ไม่รู้จัก = null (ไม่เดา)', () => {
  assert.equal(parseQuestion('oee HDF1 วันนี้', T).intent, 'oee');
  assert.equal(parseQuestion('oee การผลิต HDF1', T).intent, 'oee');
  for (const s of ['downtime สูงสุด', 'ดาวไทม์อะไรสูงสุด', 'ดาวน์ไทม์', 'เครื่องหยุดอะไรมากสุด'])
    assert.equal(parseQuestion(s, T).intent, 'downtime_top', s);
  assert.equal(parseQuestion('ยอดขายเดือนนี้', T).intent, null);
  assert.equal(parseQuestion('สวัสดี', T).intent, null);
});

test('ไม่ระบุช่วง = null + บอกค่าตั้งต้นของคำถามนั้น (จอต้องเขียนว่าใช้ค่าไหน)', () => {
  const q = parseQuestion('ดาวไทม์อะไรสูงสุด', T);
  assert.equal(q.period, null);
  assert.equal(q.periodDefault, 'week');
  const d = defaultPeriod('week', T);
  assert.deepEqual([d.from, d.to, d.explicit], ['2026-11-16', T, false]);
});

test('ช่วงเวลา: เดือนระบุ · พ.ศ. · ชื่อเดือนไทย · เดือนที่ยังมาไม่ถึง = error (ห้ามเดาเป็นปีที่แล้ว)', () => {
  assert.deepEqual(periodFromText('ต.ค. 2569', T).from, '2026-10-01');
  assert.deepEqual(periodFromText('ตุลาคม', T).to, '2026-10-31');
  assert.equal(periodFromText('เดือน 2/2024', T).to, '2024-02-29', 'ปีอธิกสุรทิน');
  assert.ok(periodFromText('เดือน 12', T).error, 'ธ.ค. ปีนี้ยังมาไม่ถึง');
  assert.ok(periodFromText('เดือน 13', T).error);
  assert.deepEqual([periodFromText('เมื่อวาน', T).from], ['2026-11-18']);
  assert.deepEqual([periodFromText('เดือนที่แล้ว', '2026-01-10').from], ['2025-12-01'], 'ข้ามปี');
  assert.equal(periodFromText('hdf1', T), null);
});

test('ตัดคำฟุ่มเฟือยฝั่งอังกฤษแบบทั้งคำเท่านั้น — ชื่อที่มีคำนั้นอยู่ข้างในต้องไม่ถูกกิน', () => {
  assert.equal(parseQuestion('oee TOPPER line วันนี้', T).subject, 'topper');
  assert.equal(parseQuestion('ยอดผลิต MONTHLY-A', T).subject, 'monthly-a');
});

const LINES = [
  { name: 'HDF1' }, { name: 'HDF2' },
  { name: 'APRON ASSY 060' }, { name: 'APRON ASSY 061' },
];
const PRODUCTS = [
  { mat_no: '10100384', name: 'REINF APRON RH', p_no: 'MB3B-16C274-CF' },
  { mat_no: '10100385', name: 'REINF APRON RH', p_no: 'MB3B-16C274-CF' },   // สินค้าเดียวกัน คนละลูกค้า
  { mat_no: '90031601', name: 'OP HDF', p_no: 'X', is_operation: true },
];

test('ค้นชื่อ: ตรงตัวเดียวตอบเลย · หลายตัว = ให้เลือก (ห้ามเดา) · ตรงเป๊ะชนะ "มีคำนี้ข้างใน"', () => {
  assert.equal(matchSubject('hdf1', { lines: LINES }).pick.name, 'HDF1');
  assert.equal(matchSubject('apron assy 060', { lines: LINES, products: PRODUCTS }).pick.name, 'APRON ASSY 060');
  const many = matchSubject('hdf', { lines: LINES });
  assert.equal(many.pick, null);
  assert.deepEqual(many.choices.map(c => c.name), ['HDF1', 'HDF2']);
  assert.equal(matchSubject('zzz', { lines: LINES }).pick, null);
  assert.equal(matchSubject('zzz', { lines: LINES }).choices.length, 0);
});

test('ค้นพาร์ท: สินค้าเดียวกันหลาย MAT (แกน p_no) = ตัวเลือกเดียว · ชั้น OP ไม่ใช่พาร์ท', () => {
  const m = matchSubject('mb3b-16c274', { lines: LINES, products: PRODUCTS });
  assert.equal(m.pick.kind, 'part');
  assert.deepEqual(m.pick.mats.sort(), ['10100384', '10100385']);
  assert.equal(matchSubject('op hdf', { lines: [], products: PRODUCTS }).pick, null);
  const amb = matchSubject('apron', { lines: LINES, products: PRODUCTS });
  assert.equal(amb.pick, null, 'ชื่อไลน์กับพาร์ทชนกัน = ให้เลือก');
  assert.equal(amb.choices.length, 3);
  assert.equal(matchSubject('hdf1', { lines: LINES, products: PRODUCTS, kinds: ['line'] }).pick.kind, 'line');
});

test('OEE รวม = ถ่วงน้ำหนักตามกะ (ห้ามเฉลี่ย % ตรงๆ) · กะไม่มีค่า stamp ไม่นับแต่ต้องบอกจำนวน', () => {
  const s = oeeSummary([
    { oee: 80, oee_a: 90, oee_p: 90, oee_q: 99, shift_min: 600, actual_qty: 900, qty_ng: 0 },
    { oee: 40, oee_a: 50, oee_p: 90, oee_q: 99, shift_min: 200, actual_qty: 100, qty_ng: 0 },
    { oee: null, shift_min: 600 },
  ]);
  assert.equal(s.n, 2);
  assert.equal(s.oee, 70, '(80×600 + 40×200)/800');
  assert.equal(s.noStamp, 1);
  assert.equal(oeeSummary([]).oee, null, 'ไม่มีกะ = null ไม่ใช่ 0');
});

test('downtime สูงสุด: ไม่นับหยุดตามแผน · "อื่นๆ" แตกตามเครื่อง ไม่ขึ้นอันดับ 1 เป็นก้อนเดียว', () => {
  const T1 = { name_th: 'แม่พิมพ์เสีย', category: 'unplanned' };
  const OTHER = { name_th: 'อื่นๆ', category: 'unplanned' };
  const r = downtimeTop([
    { duration_min: 30, dr_downtime_types: T1 },
    { duration_min: 50, dr_downtime_types: OTHER, machine_no: 'SW10' },
    { duration_min: 50, dr_downtime_types: OTHER, machine_no: 'SW11' },
    { duration_min: 500, dr_downtime_types: { name_th: 'ประชุม', category: 'planned' } },
  ]);
  assert.equal(r.total, 130);
  assert.equal(r.plannedExcluded, 1);
  assert.equal(r.top.length, 3, 'อื่นๆ 2 เครื่อง = 2 แท่ง');
  assert.ok(!r.top.some(e => e.name === 'อื่นๆ'), 'ห้ามมีแท่ง "อื่นๆ" ก้อนเดียว');
  assert.equal(r.trash.vague, 2);
});

test('ยอดผลิต = ชิ้น: งานคู่ RH/LH นับแยก · ชั้น OP ยุบเข้าพาร์ทจริง · ใบไม่มี MAT ยังนับ', () => {
  const conf = (mat_no, qty) => ({ mat_no, status: 'confirmed', qty, qty_ok: qty });
  const t = productionTotals([
    conf('RH', 100), conf('LH', 100),                   // คู่ — ห้ามยุบเหลือ 100
    conf('OP1', 50), conf('OP2', 50),                   // 2 ขั้นของชิ้นเดียวกัน (พาร์ทจริงไม่อยู่ในชุด) = 50
    { mat_no: null, status: 'open', qty_actual: 7 },
  ], { OP1: { parent: 'FG' }, OP2: { parent: 'FG' } });
  assert.equal(t.total, 100 + 100 + 50 + 7);
  assert.equal(t.noMat, 7);
  assert.equal(productionTotals([]).total, 0);
});

test('OEE รวม: หยุดตามแผนลดน้ำหนักกะผ่าน dtMinBySession (ไม่ใช่รวมนาทีเอง)', () => {
  const S = (id, oee) => ({ id, oee, oee_a: oee, oee_p: 100, oee_q: 100, shift_min: 600, work_date: '2026-11-10', shift: 'day', start_time: '2026-11-10T01:00:00Z', actual_qty: 1 });
  const dts = [{ session_id: 'a', duration_min: 300, started_at: '2026-11-10T02:00:00Z', ended_at: '2026-11-10T07:00:00Z',
    dr_downtime_types: { name_th: 'PM', category: 'planned', planned_cap_min: null } }];
  const s = oeeSummary([S('a', 90), S('b', 60)], dts, []);
  assert.equal(s.oee, 70, 'กะ a น้ำหนัก 300 · กะ b 600 ⇒ (90×300+60×600)/900');
});

test('downtime สูงสุด: หยุดตามแผนเกินเพดานของประเภท = ส่วนเกินนับเป็นนอกแผน', () => {
  const r = downtimeTop([{ duration_min: 50, dr_downtime_types: { name_th: 'Set up Machine', category: 'planned', planned_cap_min: 30 } }]);
  assert.equal(r.total, 20);
  assert.equal(r.overMin, 20);
  assert.equal(r.plannedExcluded, 0);
});

test('ชื่อไทยต้องไม่ถูกตัดกลางพยางค์ · ตัวเลขต้องตรงทั้งตัว (เคสจริงตอนลองถาม 19/11)', () => {
  assert.equal(parseQuestion('oee ชุดที่ 1 เดือนนี้', T).subject, 'ชุดที่ 1');
  const L = [{ name: 'APRON ชุดที่ 1' }, { name: 'APRON ชุดที่ 10' }, { name: 'APRON ชุดที่ 12' }];
  assert.equal(matchSubject('ชุดที่ 1', { lines: L }).pick.name, 'APRON ชุดที่ 1');
  assert.equal(matchSubject('060', { lines: [{ name: 'APRON 060' }, { name: 'APRON 0601' }] }).pick.name, 'APRON 060');
});

test('รอบ 2: จับเจตนาใหม่ 6 แบบ · ลำดับความหมาย (ต่ำสุด ก่อน oee · ตอนนี้ ก่อน downtime สูงสุด)', () => {
  const k = (s) => parseQuestion(s, T).intent;
  assert.equal(k('oee ต่ำสุด วันนี้'), 'oee_lowest');
  assert.equal(k('ไลน์ไหน oee แย่ที่สุด เดือนนี้'), 'oee_lowest');
  assert.equal(k('oee HDF1'), 'oee');
  assert.equal(k('เครื่องหยุดตอนนี้'), 'down_now');
  assert.equal(k('ตอนนี้มีเครื่องไหนหยุดอยู่บ้าง'), 'down_now');
  assert.equal(parseQuestion('ตอนนี้มีเครื่องไหนหยุดอยู่บ้าง', T).subject, '', 'ไม่มีชื่อไลน์ = ทั้งขอบเขต');
  assert.equal(k('downtime สูงสุด'), 'downtime_top');
  assert.equal(k('MO ค้าง HDF1'), 'mo_open');
  assert.equal(k('ใบแจ้งซ่อมค้างกี่ใบ'), 'mo_open');
  assert.equal(k('moon'), null, '"mo" ต้องเป็นคำเดี่ยว');
  assert.equal(k('4M ค้าง'), 'fourm_pending');
  assert.equal(k('ของเสียสูงสุด สัปดาห์นี้'), 'defect_top');
  assert.equal(k('ng มากสุด hdf1'), 'defect_top');
  assert.equal(k('มาทำงานกี่คน HDF1'), 'attendance');
});

test('ตัวย่อเดือนไม่มีจุดต้องไม่ถูกอ่านเป็นเดือน ("ซ่อมค้าง" มี "มค")', () => {
  assert.equal(parseQuestion('ใบแจ้งซ่อมค้างกี่ใบ', T).period, null);
  assert.equal(periodFromText('ม.ค.', T).from, '2026-01-01');
});

test('รอบ 2: ไลน์ OEE ต่ำสุด = ไลน์ละ oeeSummary เรียงต่ำ→สูง · ไลน์ไม่มีค่าแยกออก', () => {
  const S = (id, line, oee) => ({ id, line_name: line, oee, shift_min: 600 });
  const r = rankLinesByOee([S(1, 'A', 80), S(2, 'B', 50), S(3, 'B', 70), S(4, 'C', null)]);
  assert.deepEqual(r.ranked.map(x => [x.line, x.oee]), [['B', 60], ['A', 80]]);
  assert.deepEqual(r.noValue, ['C']);
});

test('รอบ 2: เครื่องหยุดตอนนี้ — กะปิดแล้ว = ลืมปิดรายการ (ไม่นับเป็นเครื่องหยุด แต่ไม่ซ่อน)', () => {
  const now = Date.parse('2026-11-19T03:00:00Z');
  const row = (st, at) => ({ machine_no: 'SW10', started_at: at, ended_at: null, duration_min: null,
    production_sessions: { line_name: 'HDF1', status: st }, dr_downtime_types: { name_th: 'แม่พิมพ์เสีย', category: 'unplanned' } });
  const r = openDowntimeList([row('open', '2026-11-19T02:00:00Z'), row('closed', '2026-11-18T02:00:00Z'),
    { ...row('open', '2026-11-19T02:30:00Z'), ended_at: '2026-11-19T02:40:00Z', duration_min: 10 }],
  now, d => dtOpenKind(d, d.production_sessions?.status));
  assert.equal(r.open.length, 1);
  assert.equal(Math.round(r.open[0].min), 60);
  assert.equal(r.forgotten.length, 1);
});

test('รอบ 2: MO ค้าง นับตามสถานะในชุดเปิด · สถานะที่ไม่รู้จักแยกนับ ห้ามเดา', () => {
  const now = Date.parse('2026-11-19T00:00:00Z');
  const r = moOpenSummary([
    { status: 'pending', created_at: '2026-11-09T00:00:00Z' }, { status: 'pending', created_at: '2026-11-18T00:00:00Z' },
    { status: 'repairing', created_at: '2026-11-17T00:00:00Z' }, { status: 'แปลก' },
  ], now);
  assert.equal(r.total, 3);
  assert.deepEqual(r.list.map(e => [e.status, e.n, e.oldestDays]), [['pending', 2, 10], ['repairing', 1, 2]]);
  assert.equal(r.unknown, 1);
});

test('รอบ 2: 4M ค้าง — แยกรอหัวหน้า/รอ QA และใบระบบ [Auto]', () => {
  const r = fourMPendingSummary([
    { status: 'pending', work_date: '2026-11-10', created_by: 'u1', line_name: 'A' },
    { status: 'pending_qa', work_date: '2026-11-18', created_by: null, description: '[Auto] x', line_name: 'A' },
    { status: 'approved', work_date: '2026-11-01', created_by: 'u1' },
  ], T);
  assert.deepEqual([r.total, r.pending, r.pending_qa, r.auto, r.oldestDays], [2, 1, 1, 1, 9]);
});

test('รอบ 2: ของเสียสูงสุด — "อื่นๆ/ไม่ระบุ" ไม่ติดอันดับ แต่ยังรวมในยอดและบอกจำนวน', () => {
  const r = defectTop([
    { qty_ng: 5, dr_defect_types: { name_th: 'รอยบุบ' } },
    { qty_ng: 50, dr_defect_types: { name_th: 'อื่นๆ' } },
    { qty_ng: 3, qty_suspect: 2, dr_defect_types: { name_th: 'Spot หลุด' } },
    { qty_ng: 4 },
  ]);
  assert.deepEqual(r.top.map(e => e.name), ['รอยบุบ', 'Spot หลุด']);
  assert.equal(r.total, 64);
  assert.equal(r.vagueQty, 54);
});

test('รอบ 2: มาทำงาน — แยก มา / แจ้งไม่มา / ยังไม่เช็ค (ห้ามรวมเป็น "ขาด")', () => {
  const name = { 1: 'HDF1', 2: 'HDF2' };
  const r = attendanceSummary(
    [{ id: 'a', line_id: 1 }, { id: 'b', line_id: 1 }, { id: 'c', line_id: 1 }, { id: 'd', line_id: 2 }, { id: 'e', line_id: 9 }],
    [{ employee_id: 'a', is_present: true }, { employee_id: 'b', is_present: false }],
    id => name[id] || null);
  assert.deepEqual([r.head, r.in, r.out, r.none], [4, 1, 1, 2]);
  assert.equal(r.lines[0].line, 'HDF1');
});

test('รอบ 2: เครื่องหยุดที่ไม่มีเวลาเริ่ม = ไม่ทราบ (null) ห้ามเป็น 0 นาที', () => {
  const r = openDowntimeList([{ machine_no: 'X', started_at: null, ended_at: null, duration_min: null,
    production_sessions: { line_name: 'A', status: 'open' } }], Date.parse('2026-11-19T00:00:00Z'), () => 'open');
  assert.equal(r.open[0].min, null);
});

test('ของเสีย: คำที่หน้างานพิมพ์จริง "งานเสีย" ต้องเข้าใจ (user ทัก 19/11)', () => {
  for (const s of ['วันนี้มีงานเสียอะไรบ้าง', 'งานเสีย', 'ชิ้นงานเสีย สัปดาห์นี้', 'reject เดือนนี้']) {
    const q = parseQuestion(s, T);
    assert.equal(q.intent, 'defect_top', s);
    assert.equal(q.subject, '', `${s} → ต้องไม่เหลือคำค้างไปค้นเป็นชื่อไลน์`);
  }
  assert.equal(parseQuestion('งานเสีย HDF1 วันนี้', T).subject, 'hdf1');
});

test('คำพ้องที่หน้างานพิมพ์ (user สั่ง 19/11 · ทาง ก) — เจตนาถูก และไม่เหลือคำค้างไปค้นเป็นชื่อ', () => {
  const cases = [
    ['ประสิทธิภาพ HDF1 วันนี้', 'oee', 'hdf1'], ['ไลน์ไหนประสิทธิภาพต่ำสุด', 'oee_lowest', ''],
    ['เครื่องเสียตอนนี้', 'down_now', ''], ['ไลน์ไหนหยุด', 'down_now', ''], ['เครื่องไหนดาวน์', 'down_now', ''],
    ['เครื่องพังอะไรบ่อย สัปดาห์นี้', 'downtime_top', ''], ['สาเหตุหยุดเดือนนี้', 'downtime_top', ''],
    ['หยุดนานสุด HDF1', 'downtime_top', 'hdf1'],
    ['งานซ่อมค้าง', 'mo_open', ''], ['รอช่างกี่ใบ', 'mo_open', ''], ['ช่างยังไม่มา', 'mo_open', ''],
    ['ของไม่ผ่านวันนี้', 'defect_top', ''],
    ['changing point ค้าง', 'fourm_pending', ''], ['ใบ 4M ค้าง', 'fourm_pending', ''], ['เปลี่ยน 4M รออนุมัติ', 'fourm_pending', ''],
    ['คนมากี่คน HDF1', 'attendance', 'hdf1'], ['ใครลาวันนี้', 'attendance', ''], ['กำลังคน HDF1', 'attendance', 'hdf1'], ['คนครบไหม', 'attendance', ''],
    ['ทำได้กี่ชิ้น HDF1', 'production', 'hdf1'], ['ผลิตได้เท่าไหร่ เดือนนี้ HDF1', 'production', 'hdf1'], ['ยอด HDF1 เดือนนี้', 'production', 'hdf1'],
  ];
  for (const [s, intent, subject] of cases) {
    const q = parseQuestion(s, T);
    assert.equal(q.intent, intent, s);
    assert.equal(q.subject, subject, s);
  }
  assert.equal(parseQuestion('ยอดขายเดือนนี้', T).intent, null, 'ยอดขาย ยังไม่มีเครื่องมือ — ต้องไม่ถูกตีเป็นยอดผลิต');
});

test('กะ (user สั่ง 20/11): กะเช้า/กะดึก/กะนี้ — กะนี้ต้องรู้กะปัจจุบันจากผู้เรียก ห้ามเดา', () => {
  const a = parseQuestion('oee HDF1 กะเช้า', T);
  assert.deepEqual([a.intent, a.subject, a.shift?.key], ['oee', 'hdf1', 'day']);
  const b = parseQuestion('ของเสียสูงสุด สัปดาห์นี้ กะดึก', T);
  assert.deepEqual([b.intent, b.subject, b.shift?.key, b.period.from], ['defect_top', '', 'night', '2026-11-16']);
  const c = parseQuestion('ยอดผลิต HDF1 กะนี้', T, { shiftNow: 'night' });
  assert.deepEqual([c.subject, c.shift?.key, c.period.from, c.period.to], ['hdf1', 'night', T, T], 'กะนี้ไม่บอกช่วง = วันนี้');
  assert.ok(parseQuestion('oee HDF1 กะนี้', T).error, 'ไม่รู้กะปัจจุบัน = ตอบไม่ได้ ห้ามเดา');
  assert.equal(parseQuestion('oee HDF1 วันนี้', T).shift, null, 'ไม่พูดถึงกะ = ทั้งวันเหมือนเดิม');
  assert.equal(parseQuestion('downtime กะเช้า เดือนนี้', T).subject, '');
});

test('มาทำงานแยกกะ (user สั่ง 20/11): กะของคนตามลำดับเดียวกับจอเช็คชื่อ · ไม่รู้กะ = แยกนับ ห้ามเดา', () => {
  const lines = [{ id: 1, name: 'HDF1', section: 'PD1' }, { id: 2, name: 'HDF1-A', parent_line_name: 'HDF1', section: 'PD1' }, { id: 3, name: 'X', section: 'PD9' }];
  const shiftOf = makeShiftOf({
    schedules: [{ line_id: 1, day_team: 'A' }],                 // HDF1 ทีม A เช้า · ไลน์ลูกตกทอด
    overrides: [{ employee_id: 'o', shift: 'day' }],             // คน B ที่สลับมาเช้ารายคน
    merges: [],
    lines,
  });
  const emps = [
    { id: 'a', line_id: 1, team: 'A' }, { id: 'b', line_id: 1, team: 'B' }, { id: 'c', line_id: 2, team: 'C' },
    { id: 'kid', line_id: 2, team: 'B' }, { id: 'o', line_id: 1, team: 'B' }, { id: 'u', line_id: 3, team: 'A' },
  ];
  assert.deepEqual(emps.map(shiftOf), ['day', 'night', 'day', 'night', 'day', null]);
  const name = Object.fromEntries(lines.map(l => [l.id, l.name]));
  const logs = [{ employee_id: 'a', is_present: true }, { employee_id: 'b', is_present: true }, { employee_id: 'u', is_present: true }];
  const day = attendanceSummary(emps, logs, id => name[id], { shift: 'day', shiftOf });
  assert.deepEqual([day.head, day.in, day.none, day.otherShift, day.unknownShift, day.unknownIn], [3, 1, 2, 2, 1, 1]);
  const night = attendanceSummary(emps, logs, id => name[id], { shift: 'night', shiftOf });
  assert.deepEqual([night.head, night.in], [2, 1]);
  const all = attendanceSummary(emps, logs, id => name[id]);
  assert.equal(all.head, 6, 'ไม่ระบุกะ = ทั้งวันเหมือนเดิม');
});

test('ยืมคน (user สั่ง 20/11): นับที่ไลน์ปลายทาง · กะ = กะที่ยืม · ทั้งวันไปคนละไลน์ = ต้นสังกัด ห้ามเดา', () => {
  const emps = [{ id: 'a', line_id: 1, team: 'A' }, { id: 'b', line_id: 1, team: 'A' }, { id: 'c', line_id: 1, team: 'A' }];
  const helpers = [
    { employee_id: 'a', to_line_id: 2, shift: 'night' },
    { employee_id: 'b', to_line_id: 2, shift: 'day' }, { employee_id: 'b', to_line_id: 3, shift: 'night' },
  ];
  const night = applyHelpers(emps, helpers, { shift: 'night' });
  assert.deepEqual(night.emps.map(e => [e.line_id, e._helperShift ?? null]), [[2, 'night'], [3, 'night'], [1, null]]);
  assert.equal(night.emps[0]._homeLineId, 1);
  assert.deepEqual([...night.otherShift], [], 'b ถูกยืมทั้ง 2 กะ = ย้ายแล้ว ไม่ใช่อีกกะ');
  const day = applyHelpers(emps, helpers, { shift: 'day' });
  assert.deepEqual([...day.otherShift], ['a'], 'a ถูกยืมเฉพาะกะดึก = อีกกะ ต้องให้จอเขียนบอก');
  const shiftOf = makeShiftOf({ schedules: [{ line_id: 1, day_team: 'A' }], lines: [{ id: 1, name: 'L1' }, { id: 2, name: 'L2' }, { id: 3, name: 'L3' }] });
  assert.equal(shiftOf(night.emps[0]), 'night', 'ทีม A เป็นกะเช้าตามตาราง แต่ถูกยืมไปกะดึก = นับกะดึก');
  const allDay = applyHelpers(emps, helpers);
  assert.deepEqual([allDay.moved, allDay.split], [1, 1]);
  assert.deepEqual(allDay.emps.map(e => e.line_id), [2, 1, 1]);
  assert.equal(emps[0].line_id, 1, 'ห้ามแก้แถวเดิม');
});

test('สแครป (user สั่ง 20/11 · ทำทั้ง 2): "สแครป" = ของเสียรายงานผลิต + ธงบอก · "ใบสแครป" = ใบรายงานของเสีย', () => {
  const a = parseQuestion('สแครปเดือนนี้ HDF1', T);
  assert.deepEqual([a.intent, a.subject, a.viaScrap], ['defect_top', 'hdf1', true]);
  assert.equal(parseQuestion('ของเสียสูงสุด', T).viaScrap, false);
  for (const s of ['ใบสแครป เดือนนี้', 'ใบ scrap HDF1', 'scrap report เดือน 10', 'ใบรายงานของเสีย สัปดาห์นี้']) {
    const q = parseQuestion(s, T);
    assert.equal(q.intent, 'scrap_report', s);
  }
  assert.equal(parseQuestion('ใบ scrap HDF1', T).subject, 'hdf1');
  assert.equal(parseQuestion('ใบสแครป เดือนนี้', T).subject, '');
});

test('สรุปใบสแครป: นับตามสถานะ · จับพาร์ทด้วย mat→part_no→ชื่อ · ยืนยันไม่เท่ายอด = บอก', () => {
  const r = scrapReportSummary(
    [{ id: 1, status: 'draft' }, { id: 2, status: 'approved' }, { id: 3, status: 'แปลก' }],
    [{ mat_no: 'M1', part_name: 'A', qty: 5, confirm_qty: 5 }, { mat_no: 'M1', qty: 3, confirm_qty: 2 },
     { part_no: 'NUT-6', part_name: 'นัต', qty: 10 }, { part_name: 'สกรู', qty: 1 }]);
  assert.deepEqual([r.reports, r.byStatus.draft, r.byStatus.approved, r.unknownStatus, r.total], [3, 1, 1, 1, 19]);
  assert.deepEqual(r.top.map(e => [e.key, e.qty]), [['NUT-6', 10], ['M1', 8], ['สกรู', 1]]);
  assert.equal(r.confirmDiffers, true);
});

test('"เมื่อกี้" (user สั่ง 20/11) = กะก่อนหน้ากะปัจจุบัน · ไม่รู้กะปัจจุบัน = ตอบไม่ได้ ห้ามเดา', () => {
  const a = parseQuestion('ของเสียเมื่อกี้', T, { shiftNow: 'day' });
  assert.deepEqual([a.intent, a.subject, a.shift?.key, a.period.from], ['defect_top', '', 'night', '2026-11-18'], 'ตอนนี้กะเช้า ⇒ กะดึกเมื่อวาน');
  const b = parseQuestion('oee HDF1 เมื่อกี้', T, { shiftNow: 'night' });
  assert.deepEqual([b.subject, b.shift?.key, b.period.from], ['hdf1', 'day', T], 'ตอนนี้กะดึก ⇒ กะเช้าวันเดียวกัน');
  assert.match(b.shift.label, /กะก่อนหน้า/, 'ป้ายต้องบอกว่าตีความเป็นกะไหน');
  assert.equal(parseQuestion('ยอดผลิต HDF1 กะที่แล้ว', T, { shiftNow: 'day' }).shift.key, 'night');
  assert.ok(parseQuestion('oee HDF1 เมื่อกี้', T).error, 'ไม่รู้กะปัจจุบัน = ตอบไม่ได้');
});

test('เลข 0 นำหน้าไม่นับ: "060" ต้องเจอ "Line 60" (user ทัก 20/11) · ไลน์ชนเลขพาร์ท = ให้เลือก ห้ามเดา', () => {
  const lines = [{ name: 'Line 60' }, { name: 'Line 61' }, { name: 'Line 600' }];
  assert.equal(matchSubject('060', { lines }).pick.name, 'Line 60');
  const products = [{ mat_no: '10100385', name: 'REINF ASY', p_no: 'RB3B-16E060-BA' }];
  const m = matchSubject('060', { lines, products });
  assert.equal(m.pick, null);
  assert.deepEqual(m.choices.map(c => c.kind).sort(), ['line', 'part']);
});
