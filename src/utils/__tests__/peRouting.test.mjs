/* เทสตัวเสนอ routing จาก PFC (pure) — รันด้วย: node --test src/utils/__tests__/peRouting.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeRoutingFromPfc, resolveMatForSet, toRoutingRows } from '../peRouting.js';
import { buildVsmGaps } from '../../lib/vsmGaps.js';

const P = (op, kind, name, extra = {}) => ({ op_no: op, seq: Number(op) || 0, kind, name, ...extra });

test('process/inspection เป็นขั้น · storage เกาะเป็น wip ของขั้นก่อนหน้า · ที่เหลือข้ามแบบรายงาน', () => {
  const { steps, skipped } = proposeRoutingFromPfc([
    P('5', 'incoming_insp', 'INCOMING INSP. W520781-S'),
    P('10', 'process', 'BENDING', { machine_no: 'SP-74', line_name: 'Line 60' }),
    P('15', 'storage', 'Store Semi'),
    P('20', 'process', 'PROJECTION WELD NUT', { machine_no: 'SP-78' }),
    P('30', 'transport', 'ขนย้าย dolly'),
    P('40', 'inspection', 'FINAL INSPECTION'),
    P('50', 'rework', 'REWORK Assy'),
  ]);
  assert.equal(steps.length, 3);
  assert.equal(steps[0].wip_label, 'Store Semi');            // storage → จุดพักหลัง BENDING
  assert.equal(steps[1].wip_label, null);
  assert.equal(steps[2].kind, 'inspection');
  assert.deepEqual(skipped.map(s => s.reason), ['incoming_insp', 'wip', 'transport', 'rework']);
});

test('storage ก่อนขั้นแรก = ไม่มีขั้นให้เกาะ — รายงานแยก ไม่พังไม่เงียบ', () => {
  const { steps, skipped } = proposeRoutingFromPfc([P('1', 'storage', 'Store Raw'), P('10', 'process', 'STAMPING')]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].wip_label, null);
  assert.equal(skipped[0].reason, 'storage_no_prev');
});

test('toRoutingRows renumber เฉพาะที่ติ๊ก + ค่าที่ระบบหาเองไม่ถูกยัด (null = ให้ระบบหา)', () => {
  const rows = toRoutingRows('10100384', [
    { op_no: '10', name: 'A', include: true, line_name: 'Line 60', machine_no: 'SP-74', wip_label: 'Store' },
    { op_no: '20', name: 'B', include: false },
    { op_no: '30', name: 'C', include: true },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.seq), [1, 2]);            // seq ต่อเนื่องหลังตัดตัวไม่ติ๊ก
  assert.equal(rows[0].mat_no, '10100384');
  assert.equal(rows[0].wip_label, 'Store');
  assert.equal(rows[1].line_name, null);
  assert.ok(!('ct_sec' in rows[0]));                          // ไม่ยัดค่าที่ตารางนิยามให้ null = ระบบหาเอง
  assert.match(rows[0].note, /OP 10/);
});

test('resolveMatForSet: mat_no ของชุดชนะ · p_no เทียบแบบ normalize · กำกวม = ไม่เดา', () => {
  const products = [
    { mat_no: '10100384', p_no: 'RB3B-16E060-BA' },
    { mat_no: '10100385', p_no: 'RB3B 16E060 BA' },          // p_no ซ้ำกันจริงในฐาน (กฎ matResolve)
    { mat_no: '10106831', p_no: 'MB3B-8C306-BE' },
  ];
  assert.equal(resolveMatForSet({ mat_no: '10106831' }, products).matNo, '10106831');
  const amb = resolveMatForSet({ part_no: 'RB3B 16E060 BA' }, products);
  assert.equal(amb.matNo, null);
  assert.equal(amb.how, 'ambiguous');
  assert.equal(amb.candidates.length, 2);
  const one = resolveMatForSet({ part_no: 'MB3B 8C306 BE' }, products);
  assert.equal(one.matNo, '10106831');
  assert.equal(one.how, 'p_no');
  assert.equal(resolveMatForSet({ part_no: 'XXX' }, products).how, 'none');
});

test('vsmGaps: code ที่รู้จักได้ลิงก์ · code แปลกไม่หายเงียบ · มี peSet = ลิงก์ชี้ชุดนั้นตรงๆ', () => {
  const model = { warnings: [
    { level: 'warn', text: 'ยังไม่ลง routing', code: 'fallback_routing' },
    { level: 'error', text: 'อนาคตอาจมี warning ใหม่', code: 'something_new' },
    { level: 'info', text: 'รอบส่ง supplier', code: 'supplier_pattern' },
  ] };
  const gaps = buildVsmGaps(model, { peSet: { id: 'abc' } });
  assert.equal(gaps.length, 3);                               // ไม่มีรายการหาย
  assert.ok(gaps[0].actions.some(a => a.to === '/pe-docs?set=abc'));
  assert.deepEqual(gaps[1].actions, []);                      // code ไม่รู้จัก = โชว์เฉยๆ ไม่มีลิงก์
  assert.ok(gaps[2].actions[0].label && !gaps[2].actions[0].to);  // งานกรอกในหน้า = ไม่มีลิงก์
  const noSet = buildVsmGaps(model, {});
  assert.ok(noSet[0].actions.some(a => a.to === '/pe-docs'));
});
