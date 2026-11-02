import test from 'node:test';
import assert from 'node:assert/strict';
import { orderShipToRows } from '../shipToOrder.js';

const MAP = { GRBNA: { sort_order: 10 }, GBL9A: { sort_order: 20 }, TSPK: { sort_order: 30 }, X: { sort_order: null } };

test('ลำดับตามทะเบียน ไม่ขึ้นกับลำดับที่ใบโผล่ในวันนั้น', () => {
  const a = orderShipToRows([{ key: 'FTM', code: 'GBL9A' }, { key: 'TSPK', code: 'TSPK' }, { key: 'AAT', code: 'GRBNA' }], MAP);
  const b = orderShipToRows([{ key: 'TSPK', code: 'TSPK' }, { key: 'AAT', code: 'GRBNA' }, { key: 'FTM', code: 'GBL9A' }], MAP);
  assert.deepEqual(a, ['AAT', 'FTM', 'TSPK']);
  assert.deepEqual(b, a);
});

test('ไม่ได้ตั้งลำดับ / นอกทะเบียน / ไม่ระบุลูกค้า = ต่อท้าย เรียงตามชื่อ', () => {
  assert.deepEqual(orderShipToRows([
    { key: 'ZED', code: 'Z' }, { key: '— ไม่ระบุลูกค้า —', code: null }, { key: 'BETA', code: 'X' }, { key: 'AAT', code: 'GRBNA' },
  ], MAP), ['AAT', 'BETA', 'ZED', '— ไม่ระบุลูกค้า —']);
});
