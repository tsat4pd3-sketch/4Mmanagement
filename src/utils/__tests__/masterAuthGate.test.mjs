/* เทส "ผลที่โหลดตอนไม่ได้ login ห้ามลง cache" (2026-11-10)

   ที่มา (หน้างาน: "ปัญหาโหลดไลน์ผลิต dropdown ไม่ขึ้น"): log ฝั่ง Main 24 ชม. เจอ
   `production_lines` ถูกอ่านแบบ anon 122 ครั้ง/28 IP — ได้ 200 + 0 แถว ทุกครั้ง แล้ว login ตามมาในไม่กี่วินาที
   ลูกโซ่ = กดออกจากระบบ → ล้าง cache → หน้าที่ยัง mount โหลดทะเบียนใหม่ตอนไม่มี token
   → ลิสต์ว่างถูกจดเป็น "สำเร็จ" 4 ชม. ⇒ คนถัดไปที่ login เครื่องนั้น dropdown ไลน์ว่าง */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cachedMaster, invalidateMaster, masterLoadState, setMasterAuthUser, MasterLoadError } from '../masterCache.js';

test('🔐 โหลดตอนออกจากระบบแล้ว = คืนให้ผู้เรียก แต่ห้ามจด · ห้ามขึ้นเป็นผลล้ม', async () => {
  const k = 't:gate:signedout';
  let calls = 0;
  try {
    setMasterAuthUser(null);
    const a = await cachedMaster(k, async () => { calls++; return []; });
    assert.deepEqual(a, []);
    setMasterAuthUser('u1');                         // คนถัดไป login
    const b = await cachedMaster(k, async () => { calls++; return [1, 2]; });
    assert.deepEqual(b, [1, 2], 'ต้องยิงใหม่ ไม่ใช่ได้ลิสต์ว่างของรอบออกจากระบบ');
    assert.equal(calls, 2);

    setMasterAuthUser(null);                         // ล้มระหว่างออกจากระบบ = ไม่ใช่ข่าวของใคร
    invalidateMaster(k);
    await cachedMaster(k, async () => { throw new MasterLoadError({ message: 'anon' }); });
    assert.equal(masterLoadState(k), null, 'ห้ามจดเป็นผลล้ม (แถบเตือนจะค้างให้คนถัดไป)');
  } finally { setMasterAuthUser(undefined); invalidateMaster(k); }
});

test('🔐 ผู้ใช้เปลี่ยนระหว่างโหลด (สลับบัญชีบนเครื่องกลาง) = ห้ามจด', async () => {
  const k = 't:gate:switch';
  try {
    setMasterAuthUser('u1');
    let release;
    const p = cachedMaster(k, () => new Promise(r => { release = r; }));
    setMasterAuthUser('u2');
    release(['ของ u1']);
    await p;
    let calls = 0;
    const d = await cachedMaster(k, async () => { calls++; return ['ของ u2']; });
    assert.deepEqual(d, ['ของ u2']);
    assert.equal(calls, 1, 'ผลที่ได้ข้ามการเปลี่ยนผู้ใช้ต้องไม่ถูกใช้ซ้ำ');
  } finally { setMasterAuthUser(undefined); invalidateMaster(k); }
});

test('🔐 login อยู่ตลอด = จด cache ตามปกติ (พฤติกรรมเดิม)', async () => {
  const k = 't:gate:normal';
  try {
    setMasterAuthUser('u1');
    let calls = 0;
    const loader = async () => { calls++; return [1]; };
    await cachedMaster(k, loader);
    await cachedMaster(k, loader);
    assert.equal(calls, 1);
  } finally { setMasterAuthUser(undefined); invalidateMaster(k); }
});

test('🧪 nonEmpty: ลิสต์ว่างที่ค้างใน cache (ของพิษรอบก่อน) ต้องถูกข้ามแล้วยิงใหม่', async () => {
  const k = 't:gate:nonempty';
  try {
    await cachedMaster(k, async () => []);           // ของพิษจากเวอร์ชันก่อน (ยังไม่มีประตู)
    let calls = 0;
    const d = await cachedMaster(k, async () => { calls++; return ['L1']; }, undefined, { nonEmpty: true });
    assert.deepEqual(d, ['L1']);
    assert.equal(calls, 1);
    const plain = await cachedMaster(k, async () => { calls++; return ['x']; });
    assert.deepEqual(plain, ['L1'], 'ของที่ไม่ว่างใช้ cache ตามปกติ');
  } finally { invalidateMaster(k); }
});
