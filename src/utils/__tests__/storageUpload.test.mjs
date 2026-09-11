/* เทส storageUpload — 2 กลุ่ม
   1. uploadOpts — ค่า cacheControl ที่ออกไปต้องถูกฝั่ง (immutable 1 ปี / mutable 1 ชม.)
   2. **ด่านกันลืมทั้งรีโป** — ไล่อ่านไฟล์ใน src/ แล้วบังคับว่าทุก `.upload(` ต้องผ่าน `uploadOpts()`
      เหตุที่ต้องมีด่าน: ตอนตรวจ 11 ก.ย. 2026 พบว่า **25 จุดอัปโหลดทั้งระบบไม่มีสักจุดที่ตั้ง
      cacheControl** → ทุกไฟล์ได้ default 1 ชม. → รูปถูกโหลดใหม่ทุกชั่วโมงจนโควต้า egress หมด
      แล้ว Supabase ล็อกทั้ง organization (login ไม่ได้ทั้งโรงงาน)
      กฎแบบนี้ถ้าเขียนไว้แต่ในเอกสาร คนถัดไปจะลืม — จึงต้องอยู่ในด่าน `npm run build` */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uploadOpts, CACHE_IMMUTABLE, CACHE_MUTABLE } from '../storageUpload.js';

test('ค่า default = immutable (path ที่มี timestamp/uuid — เปลี่ยนรูป = URL ใหม่)', () => {
  assert.equal(uploadOpts().cacheControl, CACHE_IMMUTABLE);
  assert.equal(uploadOpts({ upsert: true }).cacheControl, CACHE_IMMUTABLE);
});

test('mutable: true = cache สั้น (path คงที่ ทับไฟล์เดิมที่ URL เดิม)', () => {
  assert.equal(uploadOpts({ mutable: true, upsert: true }).cacheControl, CACHE_MUTABLE);
});

test('ไม่กลืน option เดิม และ `mutable` ต้องไม่หลุดไปถึง Supabase', () => {
  const o = uploadOpts({ mutable: true, upsert: false, contentType: 'image/png' });
  assert.equal(o.upsert, false);
  assert.equal(o.contentType, 'image/png');
  assert.equal('mutable' in o, false);   // ส่งไปจะเป็น option แปลกปลอมของ storage API
});

test('ระบุ cacheControl มาเองต้องชนะค่า default', () => {
  assert.equal(uploadOpts({ cacheControl: '60' }).cacheControl, '60');
});

test('immutable ต้องยาวกว่า mutable จริง (กันสลับค่ากันเองโดยไม่ตั้งใจ)', () => {
  assert.ok(Number(CACHE_IMMUTABLE) > Number(CACHE_MUTABLE));
});

// ── ด่านกันลืม: ทุก .upload() ในรีโปต้องผ่าน uploadOpts() ───────────────────────
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP = new Set(['storageUpload.js']);          // ตัว util เอง (มีคำว่า .upload( ในคอมเมนต์)

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== '__tests__') walk(p, out); }
    else if (/\.(jsx?|mjs)$/.test(e) && !SKIP.has(e)) out.push(p);
  }
  return out;
}

test('ทุกจุด storage.upload() ในรีโปต้องส่ง options ผ่าน uploadOpts()', () => {
  const bad = [];
  for (const file of walk(SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('.upload(')) return;
      if (line.includes('uploadOpts(')) return;
      bad.push(`${file.slice(SRC.length + 1)}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, [],
    'จุดอัปโหลดที่ไม่ผ่าน uploadOpts() = ไฟล์นั้นจะได้ cache แค่ 1 ชม. แล้วกิน egress ซ้ำทุกชั่วโมง\n' +
    '→ ห่อ options ด้วย uploadOpts({...}) · ถ้า path คงที่ (ทับไฟล์เดิมได้) ใส่ mutable: true ด้วย');
});
