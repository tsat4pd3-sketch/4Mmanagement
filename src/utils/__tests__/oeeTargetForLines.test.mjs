/* oeeTargetForLines + valueInk — สี OEE ทุกจอเทียบเป้ากลุ่มชุดเดียวกับ OBEYA
   (QC 05/10 · เดิม FactoryMap/GroupOverview/DeptDashboard ตัดสีด้วย 80/65 ตายตัว) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { oeeTargetForLines } from '../oee.js';
import { valueInk } from '../statusTone.js';

test('⭐ oeeTargetForLines: ไลน์ลูกใช้เป้าของไลน์แม่ · ไม่รู้เป้า (null) = null ห้ามเดา', () => {
  const lines = [{ name: 'GOR' }, { name: 'Laser GOR', parent_line_name: 'GOR' }];
  const tg = { GOR: { target_a: 95, target_p: 95, target_q: 99 } };
  const t = oeeTargetForLines(['Laser GOR'], lines, tg);
  assert.ok(Math.abs(t.oee - 89.3) < 0.1, `got ${t.oee}`);
  assert.equal(t.configured, true);
  assert.equal(oeeTargetForLines(['Laser GOR'], lines, null), null);   // โหลดเป้าไม่ได้
  assert.equal(oeeTargetForLines(['X'], lines, {}).configured, false);  // ไม่ได้ตั้ง = ค่ามาตรฐาน (จอต้องบอก)
});

test('valueInk: ไม่มีค่า = muted · ไม่มีเป้า = สีตัวหนังสือปกติ (ไม่ทาเขียว)', () => {
  assert.equal(valueInk(null, 80), 'var(--muted)');
  assert.equal(valueInk(70, null), 'var(--text)');
  assert.notEqual(valueInk(85, 80), 'var(--text)');
  assert.notEqual(valueInk(85, 80), valueInk(60, 80));
});
