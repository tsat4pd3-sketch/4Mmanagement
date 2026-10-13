import test from 'node:test';
import assert from 'node:assert/strict';
import { skillFit, skillMapOf } from '../skillFit.js';

test('skillFit: จุดไม่ตั้งทักษะ = null (ไม่ใช่ 100) · ไม่มีคะแนน = 0 ไม่ผ่าน · คะแนน = ข้อผ่าน/ทั้งหมด', () => {
  assert.equal(skillFit([], { a: 100 }), null);
  assert.equal(skillFit(null, {}), null);
  const m = skillMapOf([{ skill_name: 'weld', score: 75 }, { skill_name: 'gauge', score: '50' }]);
  const f = skillFit([{ skill_name: 'weld', min_score: 50 }, { skill_name: 'gauge', min_score: 75 }, { skill_name: 'jig', min_score: 25 }], m);
  assert.equal(f.score, 33); assert.equal(f.passed, 1); assert.equal(f.total, 3);
  assert.deepEqual(f.details.map(d => [d.skill_name, d.actual, d.pass, d.assessed]), [['weld', 75, true, true], ['gauge', 50, false, true], ['jig', 0, false, false]],
    'ไม่มีแถวคะแนน = ยังไม่ประเมิน (assessed false) แยกจากประเมินแล้วไม่ถึง');
});
