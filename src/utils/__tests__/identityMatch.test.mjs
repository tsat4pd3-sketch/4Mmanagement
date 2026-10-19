/* 🪪 บัญชีที่ "ยังไม่รู้ว่าเป็นใคร" — ตัวจัดคิว (2026-10-19 · คำสั่ง user "จอบัญชีที่ยังไม่ผูกพนักงาน")
   เทสยึดตัวเลขที่วัดจากฐานจริง: 73 person ผูกครบ · 31 shared ไม่ต้องผูก · 18 ยังไม่ระบุประเภท
   และกับดักหลัก = "จับคู่ชื่ออัตโนมัติ" ใช้ไม่ได้ (ชื่อตรง 1/18) ⇒ ห้ามเดาแทนคน */
import test from 'node:test';
import assert from 'node:assert/strict';
import { employeeCandidates, unlinkedTriage, routeHint } from '../identityMatch.js';

const EMPS = [
  { id: 'e1', name: 'ธวัช  พิมพ์วงศ์', employee_id_code: '1001', is_active: true },   // 2 ช่องว่าง
  { id: 'e2', name: 'ณัฐวุฒิ อาษานอก', employee_id_code: '1002', is_active: true },
  { id: 'e3', name: 'ณัฐวุฒิ แสนทวีสุข', employee_id_code: '1003', is_active: true },
  { id: 'e4', name: 'ตะวัน กันหา', employee_id_code: '1004', is_active: true },
  { id: 'e5', name: 'สมชาย ใจดี', employee_id_code: '1005', is_active: true },
  { id: 'e6', name: 'สมชาย ใจดี', employee_id_code: '1006', is_active: true },        // ชื่อซ้ำ (มีจริง)
  { id: 'e7', name: 'เจนนิภา เจริญพันธ', employee_id_code: '1007', is_active: true }, // ไม่มี ์
  { id: 'e8', name: 'คนลาออก', employee_id_code: '1008', is_active: false },
];

test('ชื่อตรงกัน (ต่างแค่ช่องว่าง) → ผูกได้เลย', () => {
  const r = employeeCandidates({ full_name: 'ธวัช พิมพ์วงศ์' }, EMPS);
  assert.equal(r.tier, 'name');
  assert.equal(r.confident, true);
  assert.deepEqual(r.rows.map(e => e.id), ['e1']);
});

test('🔴 ต่างแค่ทัณฑฆาต/วรรณยุกต์ ต้องเจอ — ไม่งั้นคนไปกดเพิ่มคนซ้ำเข้าฐาน', () => {
  const r = employeeCandidates({ full_name: 'เจนนิภา เจริญพันธ์' }, EMPS);
  assert.equal(r.confident, true);
  assert.equal(r.rows[0].id, 'e7');
});

test('🔴 ชื่อตรงกันแต่เจอหลายคน = ห้ามผูกให้เอง (ชื่อซ้ำมีจริง)', () => {
  const r = employeeCandidates({ full_name: 'สมชาย ใจดี' }, EMPS);
  assert.equal(r.tier, 'name');
  assert.equal(r.confident, false);
  assert.equal(r.rows.length, 2);
  assert.equal(routeHint(r).key, 'pick_one');
});

test('🔴 ชื่อต้นตรง นามสกุลต่าง = เสนอให้ดู แต่ confident ต้องเป็น false', () => {
  const r = employeeCandidates({ full_name: 'ณัฐวุฒิ ทรงดอน' }, EMPS);
  assert.equal(r.tier, 'first');
  assert.equal(r.confident, false);
  assert.equal(r.rows.length, 2);
  assert.equal(routeHint(r).key, 'maybe');
  /* เคสจริงจากฐาน: ตะวัน จัน vs ตะวัน กันหา — คนละนามสกุล ห้ามผูกให้ */
  const r2 = employeeCandidates({ full_name: 'ตะวัน จัน' }, EMPS);
  assert.equal(r2.confident, false);
});

test('ไม่เจอเลย = บอกตรงๆ ว่าไม่มีในทะเบียน (15/18 ใบจริงเป็นแบบนี้)', () => {
  const r = employeeCandidates({ full_name: 'ศักดา กาละศรี' }, EMPS);
  assert.equal(r.tier, null);
  assert.deepEqual(r.rows, []);
  assert.equal(routeHint(r).key, 'not_in_registry');
});

test('คนที่ลาออกแล้วห้ามถูกเสนอ', () => {
  assert.deepEqual(employeeCandidates({ full_name: 'คนลาออก' }, EMPS).rows, []);
});

test('ไม่มีชื่อในบัญชี / ไม่มีทะเบียน = ไม่โยน ไม่เดา', () => {
  assert.deepEqual(employeeCandidates({}, EMPS), { tier: null, rows: [], confident: false });
  assert.deepEqual(employeeCandidates({ full_name: 'ก' }, []), { tier: null, rows: [], confident: false });
  assert.deepEqual(employeeCandidates(null, null), { tier: null, rows: [], confident: false });
});

/* ═══ แยก 3 กอง — ตัวเลขที่จอต้องพูดให้ตรง ═══ */
test('🔴 บัญชีกลางไม่ใช่งานค้าง · person ที่ผูกแล้วไม่เข้าคิว · null = คิวจริง', () => {
  const users = [
    { id: 'p1', account_kind: 'person', employee_id: 'e1', full_name: 'ก' },
    { id: 'p2', account_kind: 'shared', employee_id: null, full_name: 'จอ TV PD1' },
    { id: 'p3', account_kind: null,     employee_id: null, full_name: 'ธวัช พิมพ์วงศ์' },
    { id: 'p4', account_kind: '',       employee_id: null, full_name: 'ศักดา กาละศรี' },
    { id: 'p5', account_kind: 'person', employee_id: null, full_name: 'สมชาย ใจดี' },
  ];
  const t = unlinkedTriage(users, EMPS);
  assert.deepEqual(t.queue.map(x => x.u.id), ['p3', 'p4']);
  assert.deepEqual(t.sharedOk.map(u => u.id), ['p2']);
  assert.deepEqual(t.personUnlinked.map(x => x.u.id), ['p5'], 'ติดป้ายเป็นคนแต่ยังไม่ผูก = กองแยก ควรเป็น 0');
  assert.equal(t.queue[0].confident, true, 'คิวต้องพากตัวเลือกมาด้วย');
  assert.equal(t.queue[1].tier, null);
});

test('ลิสต์ว่าง/ไม่ส่งอะไรมา = 3 กองว่าง ไม่โยน', () => {
  const t = unlinkedTriage();
  assert.deepEqual([t.queue.length, t.personUnlinked.length, t.sharedOk.length], [0, 0, 0]);
});
