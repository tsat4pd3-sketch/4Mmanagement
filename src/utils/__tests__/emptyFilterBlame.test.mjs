import test from 'node:test';
import assert from 'node:assert/strict';
import { blameEmpty, ladderSteps } from '../emptyFilterBlame.js';

const ROWS = [
  { id: 1, team: 'production', ack: true },
  { id: 2, team: 'production', ack: true },
  { id: 3, team: 'maintenance', ack: false },
  { id: 4, team: 'maintenance', ack: false },
  { id: 5, team: 'jig', ack: true },
];
const fTeam = (v) => ({ key: 'team', label: 'ทีมช่าง', value: v, on: !!v, test: r => r.team === v });
const fAck = (on) => ({ key: 'ack', label: 'รอเซ็นรับทราบ', on, test: r => !r.ack });

test('ไม่ว่าง = ไม่โทษใคร', () => {
  const b = blameEmpty(ROWS, [fTeam('maintenance'), fAck(true)]);
  assert.equal(b.empty, false);
  assert.deepEqual(b.culprits, []);
});

test('เคสจริง 26/10 — ทีม PRODUCTION ตัดใบ MTN ทิ้งหมด ⇒ ชี้ตัวที่ปลดแล้วได้ของคืน', () => {
  const b = blameEmpty(ROWS, [fTeam('production'), fAck(true)]);
  assert.equal(b.empty, true);
  assert.equal(b.needsMulti, false);
  // ปลด "ทีม" → เห็นใบ MTN ที่รอเซ็น 2 ใบ · ปลด "รอเซ็น" → เห็นใบ production 2 ใบ — จริงทั้งคู่ ต้องเสนอทั้งคู่
  assert.deepEqual(b.culprits.map(c => [c.key, c.n]), [['ack', 2], ['team', 2]]);
  // บันไดต้องเห็นว่าตกเหลือ 0 ที่ขั้น ack
  assert.deepEqual(b.ladder.map(r => r.n), [5, 2, 0]);
});

test('ปลดตัวเดียวไม่พอ = needsMulti (จอต้องเสนอล้างทั้งหมด ไม่ใช่ชี้ตัวเดียว)', () => {
  // ตัวกรอง 2 ตัวที่ต่างก็ไม่ตรงอะไรเลย ⇒ ปลดตัวไหนตัวเดียวก็ยัง 0
  const b = blameEmpty(ROWS, [
    { key: 'id', label: 'id=99', on: true, test: r => r.id === 99 },
    fTeam('zzz'),
  ]);
  assert.equal(b.empty, true);
  assert.equal(b.needsMulti, true);
  assert.deepEqual(b.culprits, []);
});

test('ไม่มีข้อมูลเลย ≠ ตัวกรองตัดทิ้ง', () => {
  const b = blameEmpty([], [fTeam('production')]);
  assert.equal(b.total, 0);
  assert.equal(b.needsMulti, false, 'ว่างเพราะไม่มีข้อมูล — ห้ามไล่ให้คนไปล้างตัวกรอง');
});

test('ตัวกรองที่ปลดเองไม่ได้ (ขอบเขตสิทธิ์) ติดธง removable:false', () => {
  const scope = { key: 'scope', label: 'ขอบเขต', on: true, removable: false, test: r => r.team === 'jig' };
  const b = blameEmpty(ROWS, [scope, fAck(true)]);
  assert.equal(b.empty, true);
  assert.equal(b.culprits.find(c => c.key === 'scope')?.removable, false);
});

test('on:false ไม่เข้าบันได · ไม่มีตัวกรองเลย = บันไดขั้นเดียว', () => {
  const b = blameEmpty(ROWS, [fTeam(''), fAck(false)]);
  assert.deepEqual(b.ladder.map(r => r.n), [5]);
  assert.equal(b.empty, false);
});

test('ladderSteps ตัดขั้นที่ไม่ได้ตัดอะไรออก แต่ขั้นที่เหลือ 0 ต้องอยู่เสมอ', () => {
  const b = blameEmpty(ROWS, [
    { key: 'noop', label: 'ไม่ตัดอะไร', on: true, test: () => true },
    fTeam('production'), fAck(true),
  ]);
  const steps = ladderSteps(b.ladder);
  assert.deepEqual(steps.map(r => r.key), ['', 'team', 'ack']);
  assert.equal(steps[steps.length - 1].n, 0);
});

test('ทนค่าขยะ — ไม่ใช่อาเรย์/ไม่มี test ต้องไม่ระเบิด', () => {
  const b = blameEmpty(null, [null, { key: 'x', label: 'ไม่มี test' }, undefined]);
  assert.deepEqual(b.ladder.map(r => r.n), [0], 'ตัวกรองที่ไม่มี test ไม่เข้าบันได');
  assert.equal(b.needsMulti, false, 'ไม่มีข้อมูล = ไม่ใช่ความผิดตัวกรอง');
});
