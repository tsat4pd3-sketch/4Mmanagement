/* ทะเบียน "คีย์ไหนโหลดล้ม" + ข้อความมาตรฐานข้างช่องเลือก (2026-10-13)
   ทำไมต้องมีเทส: ทั้งระบบพึ่ง `masterLoadState(key)` เพื่อแยก "ลิสต์ว่างเพราะไม่มีของ"
   ออกจาก "ลิสต์ว่างเพราะโหลดไม่สำเร็จ" — ถ้าธงนี้ไม่ถูกตั้ง/ไม่ถูกเคลียร์ จอจะกลับไปโกหกเหมือนเดิม */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cachedMaster, invalidateMaster, masterLoadState, mrows, MasterLoadError } from '../masterCache.js';
import { registryFailText } from '../useMasterRows.js';

test('โหลดล้ม → ตั้งธงล้มเหลวของคีย์นั้น และคืนลิสต์ว่าง (ห้ามคืน undefined)', async () => {
  invalidateMaster('t:fail');
  const out = await cachedMaster('t:fail', async () => { throw new MasterLoadError(new Error('เน็ตสะดุด')); });
  assert.deepEqual(out, [], 'ต้องคืน [] ให้ผู้เรียก .map() ต่อได้');
  const st = masterLoadState('t:fail');
  assert.ok(st, 'ต้องมีสถานะล้มเหลว');
  assert.equal(st.hadFallback, false, 'ไม่มีของเดิมค้าง = ไม่ใช่ของเก่า');
});

test('โหลดสำเร็จรอบถัดไป → ธงต้องหาย (คำเตือนค้างบนจอถาวรไม่ได้)', async () => {
  invalidateMaster('t:recover');
  await cachedMaster('t:recover', async () => { throw new Error('ล้ม'); });
  assert.ok(masterLoadState('t:recover'), 'รอบแรกล้ม');
  invalidateMaster('t:recover');   // ให้ยิงใหม่ (เลียนแบบปุ่มลองใหม่)
  const rows = await cachedMaster('t:recover', async () => [{ id: 1 }]);
  assert.equal(rows.length, 1);
  assert.equal(masterLoadState('t:recover'), null, 'สำเร็จแล้วธงต้องหาย');
});

test('ล้มแต่ยังมีของเดิม → ของเดิมไม่ถูกลิสต์ว่างทับ และธงบอกว่าเป็นของเก่า', async () => {
  invalidateMaster('t:keep');
  await cachedMaster('t:keep', async () => [{ id: 'เดิม' }]);
  invalidateMaster('t:keep');
  // หมายเหตุ: invalidate ล้าง cache ⇒ ไม่มีของเดิมให้ถอย — เลียนแบบ "TTL หมด" ด้วยคีย์ใหม่แทน
  const k = 't:keep2';
  invalidateMaster(k);
  await cachedMaster(k, async () => [{ id: 'เดิม' }], 0);   // ttl 0 = รอบหน้ายิงใหม่ทันที
  const out = await cachedMaster(k, async () => { throw new Error('ล้มรอบ 2'); }, 0);
  assert.deepEqual(out, [{ id: 'เดิม' }], 'ต้องคืนของเดิม ห้ามกลายเป็น []');
  assert.equal(masterLoadState(k)?.hadFallback, true, 'ต้องบอกว่าที่เห็นเป็นของเก่า');
});

test('mrows: ตาราง/คอลัมน์ไม่มี = ว่างจริง · error อื่น = โยน', () => {
  assert.deepEqual(mrows({ error: { code: '42P01', message: 'no table' } }), []);
  assert.deepEqual(mrows({ error: { code: '42703', message: 'no column' } }), []);
  assert.throws(() => mrows({ error: { code: 'PGRST301', message: 'jwt' } }), MasterLoadError);
  assert.deepEqual(mrows({ data: [{ a: 1 }] }), [{ a: 1 }]);
});

test('ข้อความข้างช่องเลือก: แยก "ว่างเพราะล้ม" กับ "ของเก่าอาจไม่ครบ"', () => {
  const fresh = registryFailText('ทะเบียนลูกค้า', false);
  const stale = registryFailText('ทะเบียนลูกค้า', true);
  assert.match(fresh, /ไม่ได้แปลว่าไม่มีข้อมูล/, 'ต้องบอกว่าว่างไม่ได้แปลว่าไม่มีของ');
  assert.match(stale, /ของเดิม/, 'ต้องบอกว่าเป็นของเก่า');
  assert.notEqual(fresh, stale, '2 เคสนี้พูดเหมือนกันไม่ได้');
});
