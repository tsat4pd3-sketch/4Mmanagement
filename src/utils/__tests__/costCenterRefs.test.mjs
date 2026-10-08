/* ด่าน "ลบรหัส cost center ต้องนับปลายทางก่อน" — เคส 06/10 (ลบ 29 รหัสที่บัญชีตั้ง rate ไว้แล้ว)
   กฎที่เทสนี้ยึด: นับไม่ครบ = ห้ามลบ (fail-closed) · ปลายทางมี 3 ทาง ไม่ใช่ 2 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCostCenterRefs, costCenterBlockMessage, COST_CENTER_REF_TABLES } from '../costCenterRefs.js';

/** client ปลอม: counts = { table: n } · errors = { table: {code} } */
const fakeClient = (counts = {}, errors = {}) => ({
  from(table) {
    const api = {
      select: () => api,
      eq: () => api,
      then: (res) => res(errors[table]
        ? { count: null, error: errors[table] }
        : { count: counts[table] ?? 0, error: null }),
    };
    return api;
  },
});

test('rate ของบัญชีนับเป็นปลายทาง — ไลน์/ผังว่างก็ลบไม่ได้ (เคสจริง 06/10)', async () => {
  const refs = await loadCostCenterRefs(fakeClient({ cost_center_rates: 1 }), '2140671102');
  assert.equal(refs.total, 1);
  assert.equal(refs.partial, false);
  assert.equal(refs.counts[0].table, 'cost_center_rates');
  assert.match(costCenterBlockMessage('2140671102', refs), /ลบไม่ได้/);
});

test('ไม่มีใครใช้ + นับครบ = ลบได้ (คืน null)', async () => {
  const refs = await loadCostCenterRefs(fakeClient(), '9999999999');
  assert.deepEqual(refs, { counts: [], total: 0, partial: false });
  assert.equal(costCenterBlockMessage('9999999999', refs), null);
});

test('คิวรีนับล้ม = partial ⇒ ห้ามลบ (fail-closed)', async () => {
  const refs = await loadCostCenterRefs(fakeClient({}, { org_nodes: { code: '08006' } }), '2140661401');
  assert.equal(refs.partial, true);
  assert.match(costCenterBlockMessage('2140661401', refs), /ตรวจไม่ครบ/);
});

test('ตาราง/คอลัมน์ยังไม่มี (42P01/42703) = นับเป็น 0 ได้ ไม่ใช่ partial', async () => {
  const refs = await loadCostCenterRefs(
    fakeClient({}, { kpi_base_inputs: { code: '42P01' }, kpi_month_notes: { code: '42703' } }), '2140661401');
  assert.equal(refs.partial, false);
  assert.equal(costCenterBlockMessage('2140661401', refs), null);
});

test('ไม่มี client / ไม่มีรหัส = partial ห้ามลบ', async () => {
  assert.equal((await loadCostCenterRefs(null, '1')).partial, true);
  assert.equal((await loadCostCenterRefs(fakeClient(), '  ')).partial, true);
  assert.equal(costCenterBlockMessage('x', null), 'ยังตรวจการใช้งานไม่เสร็จ — ลองอีกครั้ง');
});

test('ปลายทางต้องครบ 3 ทาง + แกน KPI (ถอดออกแล้วด่านนี้ต้องแดง)', () => {
  const tables = COST_CENTER_REF_TABLES.map(t => t[0]);
  for (const t of ['cost_center_rates', 'production_lines', 'org_nodes',
    'kpi_definitions', 'kpi_month_notes', 'kpi_base_inputs']) {
    assert.ok(tables.includes(t), `ขาดปลายทาง ${t}`);
  }
  // KPI ต้องกรองด้วย scope_kind='cost_center' ไม่งั้นนับขอบเขตอื่นมาด้วย
  for (const [t, , , extra] of COST_CENTER_REF_TABLES) {
    if (t.startsWith('kpi_')) assert.deepEqual(extra, ['scope_kind', 'cost_center']);
  }
});
