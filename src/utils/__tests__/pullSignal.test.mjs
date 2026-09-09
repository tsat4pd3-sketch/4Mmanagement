import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FALLBACK_PROFILE, pickProfile, findHeaderRow, colIndexMap, readMeta,
  parseTs, dateStr, timeStr, shipSlotOf, joinPartNo, parsePullFile,
  signalKey, aggregateSignals, planOrderUpdates, LOCKED_STATUSES,
  toCeYear, looksBuddhist, findDuplicateUploads, orderShipAt, pickPullRound,
} from '../pullSignal.js';

/* ── ไฟล์จริงที่ user ส่งมา 2026-09-08 (Detailed_SMART.csv รอบ 12:00–14:00) ──────────────
   หัวรายงาน 5 บรรทัด แล้วหัวตารางอยู่แถว index 5 · ตัวเลขทุกตัวคัดจากไฟล์จริงไม่แต่ง */
const CSV = [
  ['SMART Supplier - Part Usage Report'],
  ['username', 's-prapaw'],
  ['GSDBCODE', 'GUD6A'],
  ['Detailed SMART'],
  ['Start Time', '2026-09-08T12:00:00', 'End Time', '2026-09-08T14:00:00'],
  ['Plant Code', 'SMART Number', 'Prefix', 'Base', 'Suffix', 'Control Code', 'Part Description',
   'LSA', 'Replenishment time stamp', 'Containers Used', 'Part Quantity', 'Market Area', 'Market Row', 'Market Rack', 'LP'],
  ['GRBNA', '150524', 'RB3B', '16E060', 'BA', '', 'REINF ASY FRT FNDR INR BDY', 'BFU6W040', '09/08/2026 13:43:46', '1', '10', 'BFRH', 'B5', '5E', ''],
  ['GRBNA', '150524', 'RB3B', '16E060', 'BA', '', 'REINF ASY FRT FNDR INR BDY', 'BFU6W040', '09/08/2026 13:00:09', '1', '10', 'BFRH', 'B5', '5E', ''],
  ['GRBNA', '150524', 'RB3B', '16E060', 'BA', '', 'REINF ASY FRT FNDR INR BDY', 'BFU6W040', '09/08/2026 12:36:33', '1', '10', 'BFRH', 'B5', '5E', ''],
  ['GRBNA', '151709', 'RB3B', '16E061', 'BA', '', 'REINF ASY FRT FNDR INR BDY LH', 'BFU6W040', '09/08/2026 13:43:46', '1', '10', 'BFRH', 'B5', '5E', ''],
  ['GRBNA', '151709', 'RB3B', '16E061', 'BA', '', 'REINF ASY FRT FNDR INR BDY LH', 'BFU6W040', '09/08/2026 13:00:09', '1', '10', 'BFRH', 'B5', '5E', ''],
  ['GRBNA', '151709', 'RB3B', '16E061', 'BA', '', 'REINF ASY FRT FNDR INR BDY LH', 'BFU6W040', '09/08/2026 12:36:33', '1', '10', 'BFRH', 'B5', '5E', ''],
  ['GRBNA', '160412', 'RB3B', '8C306', 'BC', '', 'REINF ASY RAD SUPT LWR', 'BFU6W040', '09/08/2026 12:47:40', '1', '35', 'BFRH', 'B5', '5F', ''],
];

/* ไฟล์เดียวกันคนละนามสกุล (Detailed_SMART_7.xlsx รอบ 14:00–16:00)
   ⚠️ หัวไฟล์สะกดต่างกันจริง: username→CDSID · GSDBCODE→GSDB — นี่คือเหตุผลที่ต้องมี alias */
const XLSX = [
  ['SMART Supplier - Part Usage Report'],
  ['CDSID', 's-prapaw'],
  ['GSDB', 'GUD6A'],
  ['Detailed SMART'],
  ['Start Time', '2026-09-08T14:00:00', 'End Time', '2026-09-08T16:00:00'],
  CSV[5],
  ['GRBNA', '150524', 'RB3B', '16E060', 'BA', '', 'REINF ASY FRT FNDR INR BDY', 'BFU6W040', '09/08/2026 14:42:19', '1', '10', 'BFRH', 'B5', '5E', ''],
  ['GRBNA', '150524', 'RB3B', '16E060', 'BA', '', 'REINF ASY FRT FNDR INR BDY', 'BFU6W040', '09/08/2026 14:21:51', '1', '10', 'BFRH', 'B5', '5E', ''],
  ['GRBNA', '160412', 'RB3B', '8C306', 'BC', '', 'REINF ASY RAD SUPT LWR', 'BFU6W040', '09/08/2026 14:31:56', '1', '35', 'BFRH', 'B5', '5F', ''],
];

const P = FALLBACK_PROFILE;

/* ══ เวลา — กฎเหล็ก Date/Time ของโปรเจค ══════════════════════════════════════════ */

test('parseTs — 09/08/2026 ต้องเป็น 8 ก.ย. (MDY) ไม่ใช่ 9 ส.ค.', () => {
  const d = parseTs('09/08/2026 13:43:46', 'MDY');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8);       // ก.ย. = index 8
  assert.equal(d.getDate(), 8);
  assert.equal(d.getHours(), 13);
  assert.equal(d.getSeconds(), 46);
});

test('parseTs — โปรไฟล์ DMY ต้องอ่านสลับได้ (เผื่อลูกค้าเจ้าอื่น)', () => {
  const d = parseTs('09/08/2026 13:00', 'DMY');
  assert.equal(d.getMonth(), 7);       // ส.ค.
  assert.equal(d.getDate(), 9);
});

test('🔴 parseTs — ISO ที่ไม่มี Z ต้องเป็นเวลาท้องถิ่น ห้ามถูกตีเป็น UTC (วันงานจะเพี้ยน)', () => {
  const d = parseTs('2026-09-08T14:00:00');
  assert.equal(dateStr(d), '2026-09-08');
  assert.equal(timeStr(d), '14:00');
  assert.equal(d.getHours(), 14);      // ถ้าโดนตีเป็น UTC จะกลายเป็น 21:00 ที่ไทย
});

test('parseTs — AM/PM และค่าที่อ่านไม่ออก', () => {
  assert.equal(timeStr(parseTs('09/08/2026 01:05 PM')), '13:05');
  assert.equal(timeStr(parseTs('09/08/2026 12:30 AM')), '00:30');
  assert.equal(parseTs(''), null);
  assert.equal(parseTs('ไม่ใช่เวลา'), null);
  const asDate = new Date(2026, 8, 8, 9, 0);
  assert.equal(parseTs(asDate), asDate);   // xlsx ที่ parse เป็น Date มาแล้ว
});

/* ══ ปี พ.ศ. — ไฟล์จริง 2026-09-09 ส่งมาเป็น 2569 (เจอหลัง deploy วันแรก) ═════════════ */

test('🔴 toCeYear — ปี พ.ศ. ต้องถูกแปลงเป็น ค.ศ. · ปี ค.ศ. ต้องไม่ถูกแตะ', () => {
  assert.equal(toCeYear(2569), 2026);
  assert.equal(toCeYear(2500), 1957);
  assert.equal(toCeYear(2026), 2026);      // ค.ศ. ปกติ ห้ามลบ 543
  assert.equal(toCeYear(1999), 1999);
  assert.equal(toCeYear('2569'), 2026);    // ค่าจากไฟล์เป็นข้อความเสมอ
});

test('🔴 parseTs — ไฟล์จริงที่ user เจอ: Start Time = 2569-09-09T06:00:00 ต้องได้ 2026', () => {
  const d = parseTs('2569-09-09T06:00:00');
  assert.equal(dateStr(d), '2026-09-09');
  assert.equal(timeStr(d), '06:00');
});

test('parseTs — พ.ศ. ในรูปแบบ slash และ date เปล่าก็ต้องแปลง', () => {
  assert.equal(dateStr(parseTs('09/09/2569 13:43:46', 'MDY')), '2026-09-09');
  assert.equal(dateStr(parseTs('2569-09-09')), '2026-09-09');
});

test('looksBuddhist — ใช้เตือนบนจอ (ห้ามแปลงเงียบ)', () => {
  assert.equal(looksBuddhist('2569-09-09T06:00:00'), true);
  assert.equal(looksBuddhist('09/09/2569 13:43:46'), true);
  assert.equal(looksBuddhist('2026-09-08T12:00:00'), false);
  assert.equal(looksBuddhist(''), false);
  assert.equal(looksBuddhist(null), false);
});

test('⭐ parsePullFile — ไฟล์ พ.ศ. ทั้งใบ: แปลงให้ + รอบส่งถูก + **ต้องเตือนบนจอ**', () => {
  const be = CSV.map(r => r.map(c =>
    typeof c === 'string' ? c.replace(/\b2026\b/g, '2569') : c));
  const r = parsePullFile(be, P);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 7);
  assert.equal(r.slot.work_date, '2026-09-08');    // ไม่ใช่ 2569 (ใบล่องหน 543 ปี)
  assert.equal(r.slot.ship_time, '15:00');
  assert.equal(dateStr(r.rows[0].pulled_at), '2026-09-08');
  assert.ok(r.warnings.some(w => w.includes('พ.ศ.')), 'ต้องมีคำเตือนว่าแปลงปีให้');
});

/* ══ รอบส่ง = ปลายช่วง + lead (user: milk-run) ═════════════════════════════════════ */

test('⭐ shipSlotOf — 08:00–10:00 + 60 นาที = รอบ 11:00 (เคสที่ user ยกมาเอง)', () => {
  const s = shipSlotOf(parseTs('2026-09-08T10:00:00'), 60);
  assert.equal(s.ship_time, '11:00');
  assert.equal(s.work_date, '2026-09-08');
});

test('shipSlotOf — ไฟล์จริง 12:00–14:00 → รอบ 15:00 · 14:00–16:00 → 17:00', () => {
  assert.equal(shipSlotOf(parseTs('2026-09-08T14:00:00'), 60).ship_time, '15:00');
  assert.equal(shipSlotOf(parseTs('2026-09-08T16:00:00'), 60).ship_time, '17:00');
});

test('🔴 shipSlotOf — รอบที่ตกก่อน 08:00 ต้องนับเป็นวันงานก่อนหน้า (กรอบ 08:00→08:00)', () => {
  const s = shipSlotOf(parseTs('2026-09-09T06:30:00'), 60);
  assert.equal(s.ship_time, '07:30');
  assert.equal(s.work_date, '2026-09-08');   // กะดึกของวันงาน 8 ก.ย.
});

test('shipSlotOf — บวกข้ามเที่ยงคืน และ lead ตั้งค่าอื่นได้', () => {
  const s = shipSlotOf(parseTs('2026-09-08T23:30:00'), 60);
  assert.equal(s.ship_time, '00:30');
  assert.equal(s.work_date, '2026-09-08');
  assert.equal(shipSlotOf(parseTs('2026-09-08T10:00:00'), 90).ship_time, '11:30');
  assert.equal(shipSlotOf(parseTs('2026-09-08T10:00:00'), 0).ship_time, '10:00');
  assert.equal(shipSlotOf(null, 60), null);
});

/* ══ อ่านไฟล์ ══════════════════════════════════════════════════════════════════════ */

test('findHeaderRow — ข้ามหัวรายงาน 5 บรรทัดไปเจอหัวตารางที่ index 5', () => {
  assert.equal(findHeaderRow(CSV, P), 5);
  assert.equal(findHeaderRow(XLSX, P), 5);
  assert.equal(findHeaderRow([['ก'], ['ข']], P), -1);
});

test('colIndexMap — ทนช่องว่างเกิน/ตัวพิมพ์ไม่ตรง', () => {
  const { idx, missing } = colIndexMap(['  PLANT code ', 'SMART Number', 'Prefix', 'Base', 'Suffix',
    'Part Description', 'Replenishment Time Stamp', 'Containers Used', 'Part Quantity'], P.col_map);
  assert.equal(missing.length, 0);
  assert.equal(idx.ship_to, 0);
  assert.equal(idx.pulled_at, 6);
});

test('⭐ readMeta — alias ต่างกันระหว่าง .csv (username/GSDBCODE) กับ .xlsx (CDSID/GSDB)', () => {
  const a = readMeta(CSV, 5, P.meta_map);
  const b = readMeta(XLSX, 5, P.meta_map);
  assert.equal(a.user, 's-prapaw');
  assert.equal(b.user, 's-prapaw');          // คนละสะกด ต้องได้ค่าเดียวกัน
  assert.equal(a.supplier_code, 'GUD6A');
  assert.equal(b.supplier_code, 'GUD6A');
  assert.equal(a.window_end, '2026-09-08T14:00:00');
  assert.equal(b.window_end, '2026-09-08T16:00:00');   // 2 ค่าในแถวเดียวกันต้องแยกออก
});

test('pickProfile — เลือกจากคำในหัวไฟล์ · ไม่ match เลยต้องบอกว่า guessed', () => {
  const other = { code: 'x', name: 'x', detect_keywords: ['ไม่มีทางเจอ'], col_map: {}, is_active: true };
  const hit = pickProfile(CSV, [other, P]);
  assert.equal(hit.profile.code, 'ford_esmart');
  assert.equal(hit.guessed, false);
  const miss = pickProfile([['ไฟล์อะไรไม่รู้']], [other, P]);
  assert.equal(miss.guessed, true);          // จอต้องให้คนเลือกโปรไฟล์เอง
});

test('joinPartNo — ประกอบ prefix/base/suffix · ส่วนที่ว่างถูกข้าม', () => {
  assert.equal(joinPartNo('RB3B', '16E060', 'BA'), 'RB3B-16E060-BA');
  assert.equal(joinPartNo('RB3B', '8C306', 'BC', ' '), 'RB3B 8C306 BC');
  assert.equal(joinPartNo('', '16E060', ''), '16E060');
});

test('⭐ parsePullFile — ไฟล์จริง: 7 แถว · qty = containers × part_qty', () => {
  const r = parsePullFile(CSV, P);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 7);
  assert.equal(r.shipTo, 'GRBNA');
  assert.equal(r.slot.ship_time, '15:00');
  assert.equal(r.slot.work_date, '2026-09-08');
  const first = r.rows[0];
  assert.equal(first.customer_part_no, 'RB3B-16E060-BA');
  assert.equal(first.qty, 10);
  assert.equal(first.dock_code, 'B5');       // Market Row = dock ของใบส่ง
  assert.equal(first.supplier_ref, '150524');
  assert.equal(first.lsa, 'BFU6W040');
});

test('parsePullFile — qty_mode qty_only ต้องไม่คูณ containers', () => {
  const rows = [...CSV];
  rows[6] = [...CSV[6]]; rows[6][9] = '3';        // Containers Used = 3
  const mul = parsePullFile(rows, P).rows[0];
  const only = parsePullFile(rows, { ...P, qty_mode: 'qty_only' }).rows[0];
  assert.equal(mul.qty, 30);
  assert.equal(only.qty, 10);
});

test('🔴 parsePullFile — แถวที่อ่านไม่ออกต้องถูกนับรายงาน ห้ามข้ามเงียบ', () => {
  const rows = [...CSV,
    ['GRBNA', '9', 'RB3B', '9X999', 'AA', '', 'x', '', 'เวลาอะไรไม่รู้', '1', '5', '', '', '', ''],
    ['GRBNA', '9', 'RB3B', '9X998', 'AA', '', 'x', '', '09/08/2026 12:00:00', '1', 'abc', '', '', '', ''],
    ['GRBNA', '9', '', '', '', '', 'x', '', '09/08/2026 12:00:00', '1', '5', '', '', '', ''],
  ];
  const r = parsePullFile(rows, P);
  assert.equal(r.rows.length, 7);                       // 3 แถวเสียถูกตัด
  assert.equal(r.warnings.length, 3);
  assert.ok(r.warnings.some(w => w.includes('เวลา')));
  assert.ok(r.warnings.some(w => w.includes('จำนวน')));
  assert.ok(r.warnings.some(w => w.includes('เลขพาร์ท')));
});

test('parsePullFile — ไฟล์ผิดฟอร์แมต/ไม่มีข้อมูล ต้องคืน error ไม่ throw', () => {
  const bad = parsePullFile([['อะไรก็ไม่รู้'], ['a', 'b']], P);
  assert.equal(bad.ok, false);
  assert.ok(bad.error.includes('หัวตาราง'));
  const empty = parsePullFile([CSV[5]], P);
  assert.equal(empty.ok, false);
  assert.ok(empty.error.includes('ไม่พบแถวข้อมูล'));
});

/* ══ รวมยอด ════════════════════════════════════════════════════════════════════════ */

test('⭐ aggregateSignals — ไฟล์ 12:00–14:00: 16E060=30 · 16E061=30 · 8C306=35', () => {
  const g = aggregateSignals(parsePullFile(CSV, P).rows);
  assert.equal(g.length, 3);
  const by = Object.fromEntries(g.map(x => [x.customer_part_no, x]));
  assert.equal(by['RB3B-16E060-BA'].qty, 30);
  assert.equal(by['RB3B-16E060-BA'].pulls, 3);
  assert.equal(by['RB3B-16E061-BA'].qty, 30);
  assert.equal(by['RB3B-8C306-BC'].qty, 35);
  assert.equal(by['RB3B-8C306-BC'].pulls, 1);
  assert.equal(timeStr(by['RB3B-16E060-BA'].first_at), '12:36');   // ครั้งแรกที่ดึง
  assert.equal(timeStr(by['RB3B-16E060-BA'].last_at), '13:43');
});

test('signalKey — คีย์กันซ้ำต้องแยกพาร์ทที่ดึงวินาทีเดียวกันออกจากกัน', () => {
  const rows = parsePullFile(CSV, P).rows;
  const a = rows.find(r => r.customer_part_no === 'RB3B-16E060-BA' && timeStr(r.pulled_at) === '13:43');
  const b = rows.find(r => r.customer_part_no === 'RB3B-16E061-BA' && timeStr(r.pulled_at) === '13:43');
  assert.notEqual(signalKey(a), signalKey(b));          // เวลาเดียวกันแต่คนละพาร์ท = คนละแถว
  assert.equal(signalKey(a), signalKey({ ...a }));      // แถวเดิม = คีย์เดิม (นำเข้าไฟล์ซ้ำจะถูกกัน)
  assert.equal(new Set(rows.map(r => signalKey(r))).size, rows.length);
});

/* ══ แผนการอัพเดทใบส่ง — กติกาที่ user เคาะ 2026-09-08 ══════════════════════════════ */

const RESOLVE = (p) => ({
  'RB3B-16E060-BA': { mat: '10100385', status: 'mapped', candidates: ['10100385'] },
  'RB3B-16E061-BA': { mat: '10100401', status: 'mapped', candidates: ['10100401'] },
  'RB3B-8C306-BC': { mat: '10105769', status: 'mapped', candidates: ['10105769'] },
}[p] || { mat: null, status: 'none', candidates: [] });

const groupsOf = (m) => aggregateSignals(parsePullFile(m, P).rows);

test('⭐ planOrderUpdates — เจอใบ pending ยอดต่าง → update พร้อมส่วนต่าง', () => {
  const orders = [{ id: 'o1', customer_part_no: 'RB3B 16E060 BA', mat_no: '10100385', qty: 40, status: 'pending' }];
  const plan = planOrderUpdates(groupsOf(CSV), orders, RESOLVE);
  const row = plan.find(x => x.group.customer_part_no === 'RB3B-16E060-BA');
  assert.equal(row.action, 'update');
  assert.equal(row.order.id, 'o1');
  assert.equal(row.diff, -10);                 // 862 บอก 40 · ลูกค้ายืนยัน 30
  assert.equal(row.mat, '10100385');
});

test('planOrderUpdates — ยอดตรงกับ 862 อยู่แล้ว = same (ไม่ต้องเขียนอะไร)', () => {
  const orders = [{ id: 'o1', customer_part_no: 'RB3B-8C306-BC', qty: 35, status: 'pending' }];
  const row = planOrderUpdates(groupsOf(CSV), orders, RESOLVE)
    .find(x => x.group.customer_part_no === 'RB3B-8C306-BC');
  assert.equal(row.action, 'same');
  assert.equal(row.diff, 0);
});

test('🔴 planOrderUpdates — ใบที่เตรียม/ส่งไปแล้ว ต้องไม่ถูกแก้ยอด แต่ต้องรายงานส่วนต่าง', () => {
  LOCKED_STATUSES.forEach(st => {
    const orders = [{ id: 'o1', customer_part_no: 'RB3B-8C306-BC', qty: 70, status: st }];
    const row = planOrderUpdates(groupsOf(CSV), orders, RESOLVE)
      .find(x => x.group.customer_part_no === 'RB3B-8C306-BC');
    assert.equal(row.action, 'locked', st);
    assert.equal(row.diff, -35, st);           // ต้องเห็นว่าต่างเท่าไหร่ เพื่อให้คนไปจัดการเอง
    assert.ok(row.reason);
  });
});

test('planOrderUpdates — ใบ pending มาก่อนใบที่ส่งไปแล้ว (รอบเดียวกันมีทั้งคู่)', () => {
  const orders = [
    { id: 'done', customer_part_no: 'RB3B-8C306-BC', qty: 70, status: 'shipped' },
    { id: 'open', customer_part_no: 'RB3B-8C306-BC', qty: 70, status: 'pending' },
  ];
  const row = planOrderUpdates(groupsOf(CSV), orders, RESOLVE)
    .find(x => x.group.customer_part_no === 'RB3B-8C306-BC');
  assert.equal(row.action, 'update');
  assert.equal(row.order.id, 'open');
});

test('⭐ planOrderUpdates — ไม่มีใบในรอบนั้น → สร้างใหม่ (user: เป็นการ confirm order ดึงไว/ช้าได้)', () => {
  const plan = planOrderUpdates(groupsOf(CSV), [], RESOLVE);
  assert.equal(plan.length, 3);
  assert.ok(plan.every(x => x.action === 'create'));
  assert.equal(plan.find(x => x.group.customer_part_no === 'RB3B-16E061-BA').diff, 30);
});

test('🔴 planOrderUpdates — จับคู่ MAT ไม่ได้ ต้องไม่สร้างใบ และบอกวิธีแก้', () => {
  const amb = () => ({ mat: null, status: 'ambiguous', candidates: ['10100384', '10100385'] });
  const row = planOrderUpdates(groupsOf(CSV), [], amb)[0];
  assert.equal(row.action, 'unresolved');
  assert.ok(row.reason.includes('10100384'));
  const none = planOrderUpdates(groupsOf(CSV), [], () => ({ mat: null, status: 'none', candidates: [] }))[0];
  assert.ok(none.reason.includes('Product Master'));
});

test('planOrderUpdates — จับใบเดิมได้ทั้งจากเลขลูกค้าและเลข MAT (EDI เก็บคนละช่อง)', () => {
  const byMat = [{ id: 'm', customer_part_no: null, mat_no: '10100385', qty: 40, status: 'pending' }];
  const row = planOrderUpdates(groupsOf(CSV), byMat, RESOLVE)
    .find(x => x.group.customer_part_no === 'RB3B-16E060-BA');
  assert.equal(row.action, 'update');
  assert.equal(row.order.id, 'm');
});

test('⭐ พาร์ทที่ไม่อยู่ในไฟล์ ต้องไม่โผล่ในแผนเลย (user: ไม่มีใน e-SMART = ตรงกับ 862)', () => {
  const orders = [
    { id: 'keep', customer_part_no: 'MB3B 8A297 CB', qty: 182, status: 'pending' },
    { id: 'hit', customer_part_no: 'RB3B-8C306-BC', qty: 70, status: 'pending' },
  ];
  const plan = planOrderUpdates(groupsOf(CSV), orders, RESOLVE);
  assert.equal(plan.length, 3);
  assert.equal(plan.some(x => x.order?.id === 'keep'), false);   // ใบที่ไม่อยู่ในไฟล์ = ไม่ถูกแตะ
});

/* ══ 🚨 alarm อัพไฟล์ซ้ำ (user 2026-09-09: "ถ้าเป็นไฟล์เดียวกัน ให้ alarm ว่าอัพซ้ำ") ═════ */

const B = (o) => ({ id: o.id, file_name: o.f, window_start: o.ws, window_end: o.we, uploaded_at: o.at });
const PREV = [
  B({ id: 'b2', f: 'Detailed SMART - 2026-09-09T100430.028.csv', ws: '2026-09-09T08:00:00', we: '2026-09-09T10:00:00', at: '2026-09-09T13:35:34' }),
  B({ id: 'b1', f: 'Detailed SMART - 2026-09-09T080702.660.csv', ws: '2026-09-09T06:00:00', we: '2026-09-09T08:00:00', at: '2026-09-09T08:32:37' }),
];
const WIN = (a, b) => ({ windowStart: parseTs(a), windowEnd: parseTs(b) });

test('⭐ findDuplicateUploads — ชื่อไฟล์ตรง = ซ้ำ (เคสกดอัพไฟล์เดิมซ้ำ)', () => {
  const hits = findDuplicateUploads(PREV, { fileName: 'Detailed SMART - 2026-09-09T100430.028.csv', ...WIN('2026-09-09T08:00:00', '2026-09-09T10:00:00') });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].reason, 'same_file');
  assert.equal(hits[0].batch.id, 'b2');
});

test('⭐ findDuplicateUploads — ชื่อไฟล์ใหม่แต่ช่วงเวลาเดิม = ซ้ำ (โหลดซ้ำจากพอร์ทัลได้ชื่อใหม่ทุกครั้ง)', () => {
  const hits = findDuplicateUploads(PREV, { fileName: 'Detailed SMART - 2026-09-09T119999.111.csv', ...WIN('2026-09-09T06:00:00', '2026-09-09T08:00:00') });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].reason, 'same_window');
  assert.equal(hits[0].batch.id, 'b1');
});

test('findDuplicateUploads — ช่วงเวลาใหม่ + ชื่อใหม่ = ไม่ซ้ำ (รอบถัดไปต้องอัพได้ปกติ)', () => {
  assert.deepEqual(findDuplicateUploads(PREV, { fileName: 'ใหม่.csv', ...WIN('2026-09-09T10:00:00', '2026-09-09T12:00:00') }), []);
});

test('🔴 findDuplicateUploads — ไฟล์ที่ไม่บอกช่วงเวลา ห้ามถูกตีว่าซ้ำกันหมด', () => {
  const noWin = [B({ id: 'x', f: 'ก.csv', ws: null, we: null, at: '2026-09-09T09:00:00' })];
  assert.deepEqual(findDuplicateUploads(noWin, { fileName: 'ข.csv', windowStart: null, windowEnd: null }), []);
  // ชื่อตรงยังจับได้ตามปกติ
  assert.equal(findDuplicateUploads(noWin, { fileName: 'ก.csv' })[0].reason, 'same_file');
});

test('findDuplicateUploads — เจอหลายใบต้องเรียงใหม่สุดก่อน · ไม่มีข้อมูลไม่ throw', () => {
  const many = [...PREV, B({ id: 'b0', f: 'Detailed SMART - 2026-09-09T080702.660.csv', ws: '2026-09-09T06:00:00', we: '2026-09-09T08:00:00', at: '2026-09-09T08:10:00' })];
  const hits = findDuplicateUploads(many, { fileName: 'Detailed SMART - 2026-09-09T080702.660.csv', ...WIN('2026-09-09T06:00:00', '2026-09-09T08:00:00') });
  assert.deepEqual(hits.map(h => h.batch.id), ['b1', 'b0']);
  assert.deepEqual(findDuplicateUploads(null, {}), []);
  assert.deepEqual(findDuplicateUploads(PREV), []);
});

/* ══ ⭐ จับคู่ด้วย "ช่วงเวลาของไฟล์" ไม่ใช่รอบตรงเป๊ะ (user เคาะ 2026-09-09) ═══════════
   ข้อมูลจริง AAT 09/09: 862 เดินกริด 08:00/10:00/13:00/15:30 · e-SMART = ปลายช่วง+1 ชม.
   = 09:00/11:00/15:00 ⇒ จับตรงเป๊ะแล้วสร้างรอบใหม่ทุกครั้ง = ยอดนับ 2 เท่า + 862 ค้างแดงตลอดกาล */

const D = '2026-09-09';
const ORD = (id, part, qty, time, status = 'pending', source = 'edi_862') =>
  ({ id, customer_part_no: part, mat_no: null, qty, due_date: D, ship_time: time, status, source });
const SLOT = (ws, t) => ({ windowStart: parseTs(ws), targetAt: parseTs(t) });
const G1 = [{ customer_part_no: 'RB3B-16E060-BA', qty: 30, pulls: 3, part_name: 'x', dock_code: 'B5' }];
const RES1 = () => ({ mat: '10100385', status: 'mapped', candidates: ['10100385'] });

test('orderShipAt — ship_time ก่อน 08:00 = กะดึก ตกวันถัดไปตามปฏิทิน', () => {
  assert.equal(dateStr(orderShipAt(D, '10:00')), '2026-09-09');
  assert.equal(dateStr(orderShipAt(D, '00:30')), '2026-09-10');
  assert.equal(timeStr(orderShipAt(D, '00:30')), '00:30');
  assert.equal(orderShipAt(D, null), null);
  assert.equal(orderShipAt(null, '10:00'), null);
});

test('⭐ ไฟล์ 08:00–10:00 → รอบ 11:00 ต้องไปอัพเดทใบ 862 ของ 10:00 (ไม่สร้างรอบใหม่)', () => {
  const orders = [ORD('a', 'RB3B 16E060 BA', 50, '10:00')];
  const [row] = planOrderUpdates(G1, orders, RES1, SLOT(`${D}T08:00:00`, `${D}T11:00:00`));
  assert.equal(row.action, 'update');
  assert.equal(row.order.id, 'a');
  assert.equal(row.diff, -20);            // 862 วางแผน 50 · ลูกค้าเรียกจริง 30
});

test('⭐ ไฟล์ 06:00–08:00 → รอบ 09:00 ต้องจับใบ 08:00 ได้ (ช่วงคร่อมขอบกรอบวันงาน 08:00)', () => {
  const orders = [ORD('a', 'RB3B 16E060 BA', 50, '08:00')];
  const [row] = planOrderUpdates(G1, orders, RES1, SLOT(`${D}T06:00:00`, `${D}T09:00:00`));
  assert.equal(row.action, 'update');
  assert.equal(row.order.id, 'a');
});

test('🔴 ใบนอกช่วงเวลาต้องไม่ถูกแตะ (รอบบ่าย/กะดึกของวันเดียวกัน)', () => {
  const orders = [ORD('later', 'RB3B 16E060 BA', 50, '15:30'), ORD('night', 'RB3B 16E060 BA', 60, '00:30')];
  const [row] = planOrderUpdates(G1, orders, RES1, SLOT(`${D}T08:00:00`, `${D}T11:00:00`));
  assert.equal(row.action, 'create');     // ไม่มีใบในช่วง → สร้างใหม่
  assert.equal(row.order, null);
});

test('⭐ มีใบ 862 หลายใบในช่วงเดียวกัน — อัพเดทใบที่ใกล้เวลารับสุด ที่เหลือรายงานเป็น extras ห้ามแตะเอง', () => {
  const orders = [ORD('early', 'RB3B 16E060 BA', 20, '08:30'), ORD('late', 'RB3B 16E060 BA', 50, '10:00')];
  const [row] = planOrderUpdates(G1, orders, RES1, SLOT(`${D}T08:00:00`, `${D}T11:00:00`));
  assert.equal(row.action, 'update');
  assert.equal(row.order.id, 'late');                    // ใกล้เวลาที่ลูกค้ามารับที่สุด
  assert.deepEqual(row.extras.map(o => o.id), ['early']); // ต้องโผล่ให้คนเห็น ไม่ถูกลบ/แก้เงียบ
});

test('ใบในช่วงที่เตรียม/ส่งไปแล้ว ยังต้องเป็น locked เหมือนเดิม (ไม่แก้ยอด)', () => {
  const orders = [ORD('done', 'RB3B 16E060 BA', 50, '10:00', 'prepared')];
  const [row] = planOrderUpdates(G1, orders, RES1, SLOT(`${D}T08:00:00`, `${D}T11:00:00`));
  assert.equal(row.action, 'locked');
  assert.equal(row.diff, -20);
});

test('🔴 ใบที่ไม่ระบุเวลาส่ง ต้องไม่ถูกดูดเข้าช่วงไหนเลย (ห้ามเดา)', () => {
  const orders = [ORD('notime', 'RB3B 16E060 BA', 50, null)];
  const [row] = planOrderUpdates(G1, orders, RES1, SLOT(`${D}T08:00:00`, `${D}T11:00:00`));
  assert.equal(row.action, 'create');
});

test('ไม่ส่ง slot = พฤติกรรมเดิม (ผู้เรียกกรองรอบมาเองแล้ว)', () => {
  const orders = [ORD('a', 'RB3B 16E060 BA', 50, '10:00')];
  const [row] = planOrderUpdates(G1, orders, RES1);
  assert.equal(row.action, 'update');
  assert.equal(row.order.id, 'a');
});

/* ══ 🔴 กริดจริง AAT 2026-09-09 — เที่ยวรถ ↔ ใบ 862 ที่คู่กันจริง ═══════════════════════
   วัดจากฐานจริงหลังใช้งานเต็มวัน:
     เที่ยว 09:00 ↔ 862 08:00 (50/50/70) · 11:00 ↔ 10:00 · 13:00 ↔ 13:00 · **15:00 ↔ 15:30**
   ช่วงครึ่งเปิด (windowStart, targetAt] ที่ใช้ตอนเช้า ผิด 2 ทาง — เทสชุดนี้ล็อกทั้งคู่ */
const OB = (id, part, qty, time, status = 'pending', batch = null) =>
  ({ id, customer_part_no: part, mat_no: null, qty, due_date: D, ship_time: time, status,
     source: 'edi_862', pull_batch_id: batch });

test('🔴 เที่ยว 15:00 ต้องจับใบ 15:30 (ห่าง 30 นาที) — ของเดิมมองไม่เห็นแล้วสร้างรอบใหม่', () => {
  const orders = [OB('a', 'RB3B 16E060 BA', 40, '15:30')];
  const [row] = planOrderUpdates(G1, orders, RES1, SLOT(`${D}T12:00:00`, `${D}T15:00:00`));
  assert.equal(row.action, 'update');
  assert.equal(row.order.id, 'a');
});

test('🔴 ใบที่ e-SMART รอบก่อนเคลมไปแล้ว ต้องไม่ถูกเคลมซ้ำ (13:00 ของเที่ยว 13:00)', () => {
  const orders = [OB('taken', 'RB3B 16E060 BA', 40, '13:00', 'shipped', 'batch-13'),
                  OB('next',  'RB3B 16E060 BA', 40, '15:30')];
  const [row] = planOrderUpdates(G1, orders, RES1, SLOT(`${D}T12:00:00`, `${D}T15:00:00`));
  assert.equal(row.order.id, 'next', 'ต้องข้ามใบที่เที่ยวก่อนเคลมไปแล้ว');
  assert.equal(row.action, 'update');
});

test('อัพไฟล์เดิมซ้ำ (batch เดียวกัน) ยังแก้ใบเดิมได้ = idempotent ไม่สร้างใบใหม่', () => {
  const orders = [OB('a', 'RB3B 16E060 BA', 40, '10:00', 'confirmed', 'b1')];
  const [row] = planOrderUpdates(G1, orders, RES1,
    { ...SLOT(`${D}T08:00:00`, `${D}T11:00:00`), batchId: 'b1' });
  assert.equal(row.action, 'update');
  assert.equal(row.order.id, 'a');
});

test('ใกล้ที่สุดชนะ — เที่ยว 11:00 ต้องเลือกใบ 10:00 ไม่ใช่ 08:30', () => {
  const orders = [OB('x', 'RB3B 16E060 BA', 20, '08:30'), OB('y', 'RB3B 16E060 BA', 50, '10:00')];
  const [row] = planOrderUpdates(G1, orders, RES1, SLOT(`${D}T08:00:00`, `${D}T11:00:00`));
  assert.equal(row.order.id, 'y');
  assert.deepEqual(row.extras.map(o => o.id), ['x'], 'อีกใบต้องโผล่ให้คนเห็น ห้ามแตะเอง');
});

test('🔴 เผื่อหน้าต้องไม่กินใบของเที่ยวถัดไป — 22:00 อยู่ไกลเกิน ต้องไม่ถูกแตะ', () => {
  const orders = [OB('night', 'RB3B 16E060 BA', 70, '22:00')];
  const [row] = planOrderUpdates(G1, orders, RES1, SLOT(`${D}T12:00:00`, `${D}T15:00:00`));
  assert.equal(row.action, 'create');
  assert.equal(row.order, null);
});

test('🔴 ถอยหลังต้องไม่ล้ำเที่ยวก่อนหน้า — เที่ยว 11:00 ห้ามแตะใบ 08:00 (ของเที่ยว 09:00)', () => {
  const orders = [OB('prev', 'RB3B 16E060 BA', 50, '08:00')];
  const [row] = planOrderUpdates(G1, orders, RES1, SLOT(`${D}T08:00:00`, `${D}T11:00:00`));
  assert.equal(row.action, 'create', '08:00 ห่าง 3 ชม. = เกินระยะถอยหลัง 2.5 ชม.');
});

/* ══ 🚚 ตารางรอบรับของลูกค้า — รอบส่งเป็น "ตาราง" ไม่ใช่ "สูตร" (user 2026-09-09) ═══════
   user ส่งใบ "E-SMART Pattern normal/OT" ของ AAT มา — ระยะปลายช่วง→เวลารับ ไม่คงที่
   สูตรเดิม (+60 นาที) เดาช่วง 10:00-12:00 เป็น 13:00 แต่ตารางจริงคือ 14:00 */
const R = (dock, ps, pe, pickup, pattern = 'normal', extra = {}) =>
  ({ ship_to: 'GRBNA', dock_code: dock, pattern, period_start: ps, period_end: pe,
     pickup_time: pickup, is_active: true, ...extra });
const ROUNDS = [
  R('B5', '08:00', '10:00', '11:00'), R('B5', '10:00', '12:00', '14:00'),
  R('B5', '12:00', '14:00', '15:00'), R('B5', '14:00', '16:00', '22:00'),
  R('B5', '16:00', '22:00', '23:00'), R('B5', '22:00', '00:00', '01:00'),
  R('B1', '06:00', '10:00', '13:15'),
  R('B5', '14:00', '16:00', '17:00', 'ot_day'),
];

test('🔴 ช่วง 10:00-12:00 ต้องได้รอบ 14:00 ตามตาราง — สูตร +60 เดาผิดเป็น 13:00', () => {
  const round = pickPullRound(ROUNDS, {
    shipTo: 'GRBNA', dock: 'B5', windowStart: parseTs(`${D}T10:00:00`), windowEnd: parseTs(`${D}T12:00:00`) });
  const slot = shipSlotOf(parseTs(`${D}T12:00:00`), 60, round);
  assert.equal(slot.ship_time, '14:00');
  assert.equal(slot.from, 'schedule');
  assert.equal(shipSlotOf(parseTs(`${D}T12:00:00`), 60).ship_time, '13:00', 'สูตรเดิมเดาผิด — เก็บไว้เทียบ');
});

test('ระยะห่างไม่คงที่ — 14:00-16:00 ต้องได้ 22:00 (ห่าง 6 ชม.) · 16:00-22:00 ได้ 23:00 (1 ชม.)', () => {
  const a = pickPullRound(ROUNDS, { shipTo: 'GRBNA', dock: 'B5', windowStart: parseTs(`${D}T14:00:00`), windowEnd: parseTs(`${D}T16:00:00`) });
  const b = pickPullRound(ROUNDS, { shipTo: 'GRBNA', dock: 'B5', windowStart: parseTs(`${D}T16:00:00`), windowEnd: parseTs(`${D}T22:00:00`) });
  assert.equal(shipSlotOf(parseTs(`${D}T16:00:00`), 60, a).ship_time, '22:00');
  assert.equal(shipSlotOf(parseTs(`${D}T22:00:00`), 60, b).ship_time, '23:00');
});

test('dock ต่างกัน = คนละตาราง (B1 ช่วง 06:00-10:00 → 13:15)', () => {
  const b1 = pickPullRound(ROUNDS, { shipTo: 'GRBNA', dock: 'B1', windowStart: parseTs(`${D}T06:00:00`), windowEnd: parseTs(`${D}T10:00:00`) });
  assert.equal(shipSlotOf(parseTs(`${D}T10:00:00`), 60, b1).ship_time, '13:15');
  const b5 = pickPullRound(ROUNDS, { shipTo: 'GRBNA', dock: 'B5', windowStart: parseTs(`${D}T06:00:00`), windowEnd: parseTs(`${D}T10:00:00`) });
  assert.equal(b5, null, 'B5 ไม่มีช่วงนี้ → ต้องคืน null ให้ตกไป fallback ไม่ใช่หยิบของ dock อื่นมาใช้');
});

test('pattern OT เป็นคนละชุด — ต้องไม่ปนกับ normal', () => {
  const norm = pickPullRound(ROUNDS, { shipTo: 'GRBNA', dock: 'B5', windowStart: parseTs(`${D}T14:00:00`), windowEnd: parseTs(`${D}T16:00:00`) });
  const ot = pickPullRound(ROUNDS, { shipTo: 'GRBNA', dock: 'B5', pattern: 'ot_day', windowStart: parseTs(`${D}T14:00:00`), windowEnd: parseTs(`${D}T16:00:00`) });
  assert.equal(norm.pickup_time, '22:00');
  assert.equal(ot.pickup_time, '17:00');
});

test('ช่วงข้ามเที่ยงคืน (22:00-00:00 → รับ 01:00) และ work_date ตัดที่ 08:00', () => {
  const round = pickPullRound(ROUNDS, { shipTo: 'GRBNA', dock: 'B5', windowStart: parseTs(`${D}T22:00:00`), windowEnd: parseTs('2026-09-10T00:00:00') });
  const slot = shipSlotOf(parseTs('2026-09-10T00:00:00'), 60, round);
  assert.equal(slot.ship_time, '01:00');
  assert.equal(slot.work_date, '2026-09-09', 'ตี 1 = ยังเป็นวันงานของเมื่อวาน');
});

test('ไม่มีแถวที่ตรง → fallback lead_min และบอกว่ามาจากสูตร', () => {
  const round = pickPullRound(ROUNDS, { shipTo: 'GRBNA', dock: 'B5', windowStart: parseTs(`${D}T03:00:00`), windowEnd: parseTs(`${D}T05:00:00`) });
  assert.equal(round, null);
  const slot = shipSlotOf(parseTs(`${D}T05:00:00`), 60, round);
  assert.equal(slot.from, 'lead');
  assert.equal(slot.ship_time, '06:00');
});

test('is_active=false ต้องไม่ถูกหยิบมาใช้', () => {
  const off = [R('B5', '08:00', '10:00', '11:00', 'normal', { is_active: false })];
  assert.equal(pickPullRound(off, { shipTo: 'GRBNA', dock: 'B5', windowStart: parseTs(`${D}T08:00:00`), windowEnd: parseTs(`${D}T10:00:00`) }), null);
});

test('แถวที่ dock ว่าง = fallback ของ ship-to นั้น (dock ตรงชนะเสมอ)', () => {
  const mix = [R(null, '08:00', '10:00', '10:30'), R('B5', '08:00', '10:00', '11:00')];
  assert.equal(pickPullRound(mix, { shipTo: 'GRBNA', dock: 'B5', windowStart: parseTs(`${D}T08:00:00`), windowEnd: parseTs(`${D}T10:00:00`) }).pickup_time, '11:00');
  assert.equal(pickPullRound(mix, { shipTo: 'GRBNA', dock: 'B9', windowStart: parseTs(`${D}T08:00:00`), windowEnd: parseTs(`${D}T10:00:00`) }).pickup_time, '10:30');
});
