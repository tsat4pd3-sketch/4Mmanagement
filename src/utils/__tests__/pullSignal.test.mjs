import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FALLBACK_PROFILE, pickProfile, findHeaderRow, colIndexMap, readMeta,
  parseTs, dateStr, timeStr, shipSlotOf, joinPartNo, parsePullFile,
  signalKey, aggregateSignals, planOrderUpdates, LOCKED_STATUSES,
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
