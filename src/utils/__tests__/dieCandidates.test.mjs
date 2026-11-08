/* เทส "แม่พิมพ์ของงานที่กำลังผลิต" — src/utils/dieCandidates.js (2026-11-08)
   🔴 ล็อก: ทะเบียนยืนยัน ≠ ระบบเดา · ชุดที่ผูก MAT อื่นห้ามเดาทับ · จับเลขพาร์ทตรงตัวเท่านั้น */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dieCandidatesForMats, setPartNos } from '../dieCandidates.js';

const sets = [
  { id: 1, set_code: 'DS-BHS', part_no: 'BHS08555/BHS07706', mat_no: null, mat_no_2: null },   // เคสจริง 05/11
  { id: 2, set_code: 'DS-LINK', part_no: 'X1', mat_no: '20000001', mat_no_2: null },
  { id: 3, set_code: 'DS-OTHER', part_no: 'BHS07706', mat_no: '99999999' },                   // ผูก MAT อื่นแล้ว
  { id: 4, set_code: 'DS-OFF', part_no: 'BHS08555', is_active: false },
];
const dieRows = [
  { machine_no: 'BHS OP10', die_set_id: 1 }, { machine_no: 'BHS OP20', die_set_id: 1 },
  { machine_no: 'LINK OP10', die_set_id: 2 }, { machine_no: 'OTHER OP10', die_set_id: 3 },
  { machine_no: 'OFF OP10', die_set_id: 4 }, { machine_no: 'LOOSE', die_set_id: null },
];
const pno = { 10076603: 'BHS07706', 10076604: 'BHS08555', 20000001: 'X1', 30000000: 'BHS07706 - STEP 1' };
const pnoOfMat = (m) => pno[m] ?? null;

test('setPartNos แยกด้วย / และตัดช่องว่าง', () => {
  assert.deepEqual(setPartNos({ part_no: ' bhs08555 / BHS07706 ' }), ['BHS08555', 'BHS07706']);
  assert.deepEqual(setPartNos({ part_no: null }), []);
});

test('เคสจริง: งาน 10076603/604 → แม่พิมพ์ทุก OP ของชุด BHS เป็น guess', () => {
  const r = dieCandidatesForMats({ runMats: ['10076603', '10076604'], pnoOfMat, sets, dieRows });
  assert.equal(r.byMachine.get('BHS OP10').tier, 'guess');
  assert.equal(r.byMachine.get('BHS OP20').tier, 'guess');
  assert.deepEqual(r.byMachine.get('BHS OP10').mats, ['10076603', '10076604']);
  assert.ok(!r.byMachine.has('OTHER OP10'), 'ชุดที่ผูก MAT อื่นห้ามเดาทับ');
  assert.ok(!r.byMachine.has('OFF OP10'), 'ชุดปิดใช้ไม่เสนอ');
  assert.deepEqual(r.coverage, { total: 2, linked: 0, guess: 2, none: [] });
});

test('ทะเบียนผูก MAT ไว้ = linked', () => {
  const r = dieCandidatesForMats({ runMats: ['20000001'], pnoOfMat, sets, dieRows });
  assert.equal(r.byMachine.get('LINK OP10').tier, 'linked');
  assert.equal(r.coverage.linked, 1);
});

test('p_no มีคำต่อท้าย = ไม่จับ (ห้ามตัดคำเพื่อเดาเพิ่ม) และนับเป็นหาไม่ได้', () => {
  const r = dieCandidatesForMats({ runMats: ['30000000'], pnoOfMat, sets, dieRows });
  assert.equal(r.byMachine.size, 0);
  assert.deepEqual(r.coverage.none, ['30000000']);
});

test('ไม่มีงานผลิต = ว่าง ไม่พัง', () => {
  const r = dieCandidatesForMats({});
  assert.equal(r.byMachine.size, 0);
  assert.equal(r.coverage.total, 0);
});

test('ชุดที่ไม่มีแม่พิมพ์รายตัวในทะเบียน = ไม่นับว่าหาเจอ (กันจอบอกว่าเจอแต่ลิสต์ว่าง)', () => {
  const r = dieCandidatesForMats({ runMats: ['20000001'], pnoOfMat, sets, dieRows: [] });
  assert.equal(r.byMachine.size, 0);
  assert.deepEqual(r.coverage, { total: 1, linked: 0, guess: 0, none: ['20000001'] });
});
