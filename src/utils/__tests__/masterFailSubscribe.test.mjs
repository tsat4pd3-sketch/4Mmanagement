/* เทส "ธงโหลดล้มต้องบอกต่อได้" + "ล้างทะเบียนไลน์ต้องครบทุกคีย์" (2026-11-09)

   ที่มา (feedback user): *"เราจะเจอปัญหาโหลดไลน์ไม่ขึ้นในหลายๆหน้า แต่เราเห็นมีหน้าเปิดกะ
   ที่มีไห้โหลดไลน์ใหม่ แต่จุดอื่นไม่มี"* — แถบ `<LineRegistryAlert />` มีอยู่แล้วและอยู่เหนือ
   `<Routes>` (ทุกหน้าควรเห็น) แต่มัน mount ครั้งเดียวตอนเปิดแอป และ `failures` Map
   ไม่มีใครฟังได้ ⇒ ทะเบียนล้ม**หลัง**เปิดแอป = ช่องเลือกว่างทั้งแอปโดยแถบไม่โผล่ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cachedMaster, invalidateMaster, masterLoadState, onMasterFailChange, MasterLoadError } from '../masterCache.js';
import { KEYS_BY_TABLE } from '../masterInvalidate.js';

test('🔔 ล้มแล้วต้องยิงบอกตัวฟัง (ไม่ใช่รอให้จอ mount ใหม่)', async () => {
  const seen = [];
  const off = onMasterFailChange(k => seen.push(k));
  try {
    await cachedMaster('t:sub:fail', async () => { throw new MasterLoadError({ message: 'เน็ตสะดุด' }); });
    assert.deepEqual(seen, ['t:sub:fail'], 'ล้มแล้วต้องแจ้งคีย์นั้นทันที 1 ครั้ง');
    assert.equal(masterLoadState('t:sub:fail')?.message, 'เน็ตสะดุด');
  } finally { off(); invalidateMaster('t:sub:fail'); }
});

test('🔔 สำเร็จแล้วต้องยิงบอกด้วย — คำเตือนค้างบนจอถาวรแย่กว่าไม่เตือน', async () => {
  const k = 't:sub:recover';
  let fail = true;
  const loader = async () => { if (fail) throw new MasterLoadError({ message: 'ล้ม' }); return [1]; };
  await cachedMaster(k, loader);
  assert.ok(masterLoadState(k), 'รอบแรกต้องล้ม');

  const seen = [];
  const off = onMasterFailChange(key => seen.push(key));
  try {
    fail = false;
    invalidateMaster(k);                       // ผู้ใช้กดปุ่ม "โหลดใหม่"
    await cachedMaster(k, loader);
    assert.equal(masterLoadState(k), null, 'สำเร็จแล้วธงต้องหาย');
    assert.ok(seen.includes(k), 'ต้องแจ้งตอนธงหายด้วย ไม่ใช่แจ้งแค่ตอนล้ม');
  } finally { off(); invalidateMaster(k); }
});

test('🔕 เลิกฟังแล้วต้องไม่ได้ข่าวอีก (คนละจอ unmount แล้วห้าม setState)', async () => {
  const seen = [];
  const off = onMasterFailChange(k => seen.push(k));
  off();
  await cachedMaster('t:sub:off', async () => { throw new MasterLoadError({ message: 'x' }); });
  assert.deepEqual(seen, []);
  invalidateMaster('t:sub:off');
});

test('🧯 ตัวฟังตัวหนึ่งพัง ต้องไม่ทำให้ตัวอื่นไม่ได้ข่าว', async () => {
  const ok = [];
  const offBad = onMasterFailChange(() => { throw new Error('ตัวฟังพัง'); });
  const offOk = onMasterFailChange(k => ok.push(k));
  const warn = console.warn; console.warn = () => {};
  try {
    await cachedMaster('t:sub:boom', async () => { throw new MasterLoadError({ message: 'y' }); });
    assert.deepEqual(ok, ['t:sub:boom']);
  } finally { console.warn = warn; offBad(); offOk(); invalidateMaster('t:sub:boom'); }
});

test('🏭 ทะเบียนไลน์: invalidateTable ต้องครอบคีย์ของ picker + ชั้นนอกของหน้าเปิดกะ', () => {
  const keys = KEYS_BY_TABLE.production_lines;
  for (const k of ['production_lines:v3', 'production_lines:dr', 'production_lines:flow']) {
    assert.ok(keys.includes(k), `ทะเบียนขาด '${k}' — invalidateTable('production_lines') จะล้างไม่ครบ`);
  }
});
