/* masterRefs — ด่านนับปลายทางก่อนลบทะเบียนกลางฝั่ง DR (2026-10-18)
   เน้น 3 คลาสที่พลาดง่าย: fail-closed เมื่อนับไม่ได้ · ยุบหลายคิวรีของตารางเดียวให้เป็นแถวเดียว ·
   ทะเบียนที่อ้างกันด้วย "ข้อความในใบ" (repair_wi_registry → fix_action) ต้องนับแบบ substring */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MASTER_REF_SPECS, loadMasterRefs, masterBlockMessage, masterDeleteGuard, splitWiNos,
} from '../masterRefs.js';

/* client ปลอม — บันทึกทุกคิวรีที่ถูกยิง แล้วคืนจำนวนตาม map ที่ส่งเข้ามา
   key ของ map = "<table>" หรือ "<table>|<ilike pattern>" · ค่าเป็นเลข = count · เป็น object = error */
function fakeClient(answers = {}, log = []) {
  return {
    from(table) {
      const q = { table, filters: {}, pattern: null };
      const self = {
        select() { return self; },
        eq(k, v) { q.filters[k] = v; return self; },
        in(col, vals) { q.col = col; q.vals = vals; return self; },
        ilike(col, pat) { q.col = col; q.pattern = pat; return self; },
        then(res, rej) {
          log.push(q);
          const hit = answers[`${table}|${q.pattern}`] ?? answers[table] ?? 0;
          const out = typeof hit === 'object' ? { count: null, error: hit } : { count: hit, error: null };
          return Promise.resolve(out).then(res, rej);
        },
      };
      return self;
    },
  };
}

test('ทะเบียนที่ประกาศไว้ ต้องมี keysOf + targets ครบทุกตัว', () => {
  const regs = Object.keys(MASTER_REF_SPECS);
  assert.deepEqual(regs.sort(), [
    'customers', 'die_op_types', 'die_press_lines', 'die_set_kinds', 'repair_wi_registry', 'suppliers',
  ]);
  for (const [name, spec] of Object.entries(MASTER_REF_SPECS)) {
    assert.equal(typeof spec.keysOf, 'function', name);
    assert.ok(spec.targets.length > 0, name);
    assert.ok(spec.label, name);
    for (const [t, c, l] of spec.targets) assert.ok(t && c && l, `${name} → ${t}.${c}`);
  }
});

test('ไม่มีใครใช้ = คืน null (ลบได้)', async () => {
  const refs = await loadMasterRefs(fakeClient({}), 'customers', { code: 'FVL', name: 'FVL' });
  assert.deepEqual(refs, { counts: [], total: 0, partial: false });
  assert.equal(masterBlockMessage('customers', 'FVL', refs), null);
});

test('มีคนใช้ = บล็อก + บอกตารางและจำนวน', async () => {
  const refs = await loadMasterRefs(fakeClient({ prod_orders: 1974, dr_products: 378 }),
    'customers', { code: 'FVL', name: 'FVL', aliases: ['F.V.L.'] });
  assert.equal(refs.total, 1974 + 378);
  assert.equal(refs.partial, false);
  assert.equal(refs.counts[0].table, 'prod_orders');            // เรียงมาก→น้อย
  const msg = masterBlockMessage('customers', 'FVL', refs);
  assert.match(msg, /ลบไม่ได้/);
  assert.match(msg, /ใบผลิต 1,974 รายการ/);
  assert.match(msg, /ปิดใช้งาน/);                                // ต้องเสนอทางออกให้คน
});

test('คีย์ที่ส่งไปนับ = code + name + alias ทุกสะกด (ลบแถวแล้วค่าเก่ากำพร้าทั้งชุด)', async () => {
  const log = [];
  await loadMasterRefs(fakeClient({}, log), 'customers', { code: 'FVL', name: 'FVL Co.', aliases: ['F.V.L.', ''] });
  const q = log.find(x => x.table === 'prod_orders');
  assert.deepEqual(q.vals, ['FVL', 'FVL Co.', 'F.V.L.']);        // ค่าว่างถูกตัด
  assert.equal(q.col, 'customer');
});

test('🔴 นับไม่ได้ (error อื่นที่ไม่ใช่ schema gap) = partial ⇒ ห้ามลบ', async () => {
  const refs = await loadMasterRefs(fakeClient({ prod_orders: { code: '08006', message: 'network' } }),
    'customers', { name: 'FVL' });
  assert.equal(refs.partial, true);
  const msg = masterBlockMessage('customers', 'FVL', refs);
  assert.match(msg, /ยังลบ "FVL" ไม่ได้/);
  assert.match(msg, /ตรวจไม่ครบ/);
});

test('ตาราง/คอลัมน์ยังไม่มี (42P01 · 42703) = นับเป็น 0 ได้จริง ไม่ใช่ partial', async () => {
  const refs = await loadMasterRefs(
    fakeClient({ container_types: { code: '42P01' }, part_routings: { code: '42703' } }),
    'suppliers', { code: 'SUP', name: 'SUP' });
  assert.equal(refs.partial, false);
  assert.equal(refs.total, 0);
  assert.equal(masterBlockMessage('suppliers', 'SUP', refs), null);
});

test('ไม่รู้คีย์ของแถว = partial ⇒ ห้ามลบ (ห้ามตีว่า "ไม่มีใครใช้")', async () => {
  for (const row of [null, {}, { code: '  ' }]) {
    const refs = await loadMasterRefs(fakeClient({ prod_orders: 5 }), 'customers', row);
    assert.equal(refs.partial, true, JSON.stringify(row));
    assert.equal(refs.total, 0);
    assert.ok(masterBlockMessage('customers', '—', refs));
  }
});

test('ทะเบียนที่ไม่รู้จัก / ไม่มี client = partial', async () => {
  assert.equal((await loadMasterRefs(fakeClient({}), 'ไม่มีทะเบียนนี้', { name: 'x' })).partial, true);
  assert.equal((await loadMasterRefs(null, 'customers', { name: 'x' })).partial, true);
});

test('machines นับเฉพาะ equipment_kind=die (ชื่อกลุ่มเครื่องปั๊มชนกับชื่อไลน์ผลิต)', async () => {
  const log = [];
  await loadMasterRefs(fakeClient({}, log), 'die_press_lines', { code: 'LINE-A', name: 'LINE A ( 800 Ton )' });
  const m = log.find(x => x.table === 'machines');
  assert.equal(m.filters.equipment_kind, 'die');
  const d = log.find(x => x.table === 'die_sets');
  assert.deepEqual(d.filters, {});                               // ชุดแม่พิมพ์ไม่ต้องกรอง
});

test('🔴 die_op_types / die_set_kinds จับคู่ด้วย key เท่านั้น ห้ามใช้ label', async () => {
  for (const reg of ['die_op_types', 'die_set_kinds']) {
    const log = [];
    await loadMasterRefs(fakeClient({}, log), reg, { key: 'hydroform', label: 'อื่นๆ' });
    assert.ok(log.length > 0, reg);
    for (const q of log) assert.deepEqual(q.vals, ['hydroform'], `${reg} ส่ง label ไปนับด้วย`);
  }
});

test('repair_wi_registry นับแบบ substring และแยก wi_no หลายเล่ม', async () => {
  assert.deepEqual(splitWiNos('WI-PD3-068, WI-PD3-050'), ['WI-PD3-068', 'WI-PD3-050']);
  assert.deepEqual(splitWiNos(''), []);
  const log = [];
  const refs = await loadMasterRefs(
    fakeClient({ 'defect_logs|%WI-PD3-068%': 3, 'defect_logs|%WI-PD3-050%': 2 }, log),
    'repair_wi_registry', { code: 'W350', wi_no: 'WI-PD3-068, WI-PD3-050' });
  // 2 เล่ม × 2 ตาราง = 4 คิวรี · ตารางเดียวกันต้องยุบเป็นแถวเดียว
  assert.equal(log.length, 4);
  assert.equal(refs.counts.length, 1);
  assert.equal(refs.counts[0].table, 'defect_logs');
  assert.equal(refs.counts[0].n, 5);
  assert.match(log[0].pattern, /^%WI-PD3-068%$/);
});

test('masterDeleteGuard — ใช้ชื่อจาก nameOf และคืน null เมื่อลบได้', async () => {
  const ok = masterDeleteGuard(fakeClient({}), 'die_set_kinds', r => r?.label);
  assert.equal(await ok({ key: 'tandem', label: 'Tandem' }), null);
  const blocked = masterDeleteGuard(fakeClient({ die_sets: 92 }), 'die_set_kinds', r => r?.label);
  assert.match(await blocked({ key: 'tandem', label: 'Tandem' }), /"Tandem" ยังถูกใช้อยู่/);
});

test('refs เป็น null/undefined = ข้อความบล็อก ไม่ใช่ null', () => {
  assert.ok(masterBlockMessage('customers', 'FVL', null));
  assert.ok(masterBlockMessage('customers', 'FVL', undefined));
});
