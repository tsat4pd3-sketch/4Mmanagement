/* เทส masterCache — cache ตาราง master ข้ามการเปิดแอป (2026-09-14)
   เคสที่ต้องล็อกไว้ เพราะพลาดแล้วเจ็บคนละแบบ:
   · ไม่ cache ข้ามการเปิดแอป → egress ทะลุโควต้า (เหตุที่ทำรอบนี้)
   · cache แล้วล้างไม่ได้      → แก้ master แล้วหน้างานเห็นของเก่าค้าง แก้อะไรไม่ได้เลย
   · localStorage ปิด/เต็ม แล้วพัง → แอปล่มใน private mode
   node ไม่มี localStorage → stub ให้ก่อน import โมดูล */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── stub localStorage (ต้องมาก่อน import masterCache) ──
let store = new Map();
let throwOnSet = false;
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { if (throwOnSet) throw new Error('QuotaExceeded'); store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const { cachedMaster, invalidateMaster } = await import('../masterCache.js');

let hits = 0;
const loader = async () => { hits++; return [{ id: 1, name: 'เครื่อง A' }]; };

beforeEach(() => { store = new Map(); throwOnSet = false; hits = 0; invalidateMaster(); });

test('เรียกซ้ำในแท็บเดียวกัน = ยิง DB ครั้งเดียว', async () => {
  await cachedMaster('machines', loader);
  await cachedMaster('machines', loader);
  assert.equal(hits, 1);
});

test('🔴 หัวใจของรอบนี้ — เปิดแอปใหม่ (memory ว่าง) ต้องใช้ของใน localStorage ไม่ยิง DB ซ้ำ', async () => {
  await cachedMaster('machines', loader);
  assert.equal(hits, 1);
  invalidateMemoryOnly();                       // จำลอง "เปิดแอปใหม่" — memory หาย localStorage อยู่
  const again = await cachedMaster('machines', loader);
  assert.equal(hits, 1, 'ยิง DB ซ้ำ = กลับไปเป็นบั๊กเดิมที่ทำ egress ทะลุโควต้า');
  assert.deepEqual(again, [{ id: 1, name: 'เครื่อง A' }]);
});

test('หมดอายุตาม TTL → โหลดใหม่', async () => {
  await cachedMaster('machines', loader, 50);
  invalidateMemoryOnly();
  await new Promise(r => setTimeout(r, 60));
  await cachedMaster('machines', loader, 50);
  assert.equal(hits, 2);
});

test('🔴 invalidateMaster ต้องล้าง localStorage ด้วย — ไม่งั้นแก้ master แล้วของเก่าค้างข้ามการเปิดแอป', async () => {
  await cachedMaster('machines', loader);
  invalidateMaster('machines');
  assert.equal(store.size, 0, 'ยังมีของค้างใน localStorage');
  await cachedMaster('machines', loader);
  assert.equal(hits, 2);
});

test('invalidateMaster() ไม่ส่ง key = ล้างทุกคีย์ทั้ง memory และ localStorage', async () => {
  await cachedMaster('machines', loader);
  await cachedMaster('dr_products', loader);
  invalidateMaster();
  assert.equal(store.size, 0);
});

test('localStorage เขียนไม่ได้ (private mode/เต็ม) = ต้องไม่ throw และยังคืนข้อมูลถูก', async () => {
  throwOnSet = true;
  const data = await cachedMaster('machines', loader);
  assert.deepEqual(data, [{ id: 1, name: 'เครื่อง A' }]);
});

test('ค่าใน localStorage ที่พัง (JSON เพี้ยน) ต้องไม่ทำให้แอปล่ม — ถือว่าไม่มี cache', async () => {
  store.set('esm_mc_machines', '{ไม่ใช่ json');
  const data = await cachedMaster('machines', loader);
  assert.deepEqual(data, [{ id: 1, name: 'เครื่อง A' }]);
  assert.equal(hits, 1);
});

test('cache ของ CACHE_EPOCH เก่าต้องถูกทิ้ง (โครงข้อมูลเปลี่ยน = อ่านของเก่าไม่ได้)', async () => {
  store.set('esm_mc_machines', JSON.stringify({ v: 'epoch-เก่า', at: Date.now(), data: [{ id: 9 }] }));
  const data = await cachedMaster('machines', loader);
  assert.deepEqual(data, [{ id: 1, name: 'เครื่อง A' }], 'ยังใช้ cache ของ build เก่าอยู่');
});

test('loader ล้ม → คืนค่าเดิมที่มี ไม่โยน error ใส่หน้าจอ', async () => {
  await cachedMaster('machines', loader);
  invalidateMemoryOnly();
  store.clear();                                 // ไม่มีทั้ง memory และ localStorage
  const bad = async () => { throw new Error('network'); };
  const data = await cachedMaster('machines', bad);
  assert.equal(data, undefined);                 // ไม่มีของเก่าให้คืน แต่ต้องไม่ throw
});

/* จำลอง "ปิดแอปแล้วเปิดใหม่": memory cache หาย แต่ localStorage ยังอยู่
   (invalidateMaster ล้างทั้งคู่ จึงใช้แทนกันไม่ได้) */
function invalidateMemoryOnly() {
  const keep = new Map(store);
  invalidateMaster();
  store = keep;
}
