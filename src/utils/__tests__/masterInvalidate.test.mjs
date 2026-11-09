/* เทส masterInvalidate — ทะเบียน "ตาราง → คีย์ cache" ต้องไม่ล้าสมัย (2026-09-15)

   🔴 เหตุที่ต้องมีด่านนี้: `invalidateProducts()` / `invalidateMachines()` ฯลฯ เขียนไว้ตั้งแต่ ก.ย.
      แล้ว **ไม่มีหน้าไหนเรียกเลยสักหน้า** จนเจอตอน audit 15/09 — เอกสาร/helper ที่ไม่มีด่านบังคับ
      จะล้าสมัยเสมอ (บทเรียนเดียวกับเทส 9 ไฟล์ที่ไม่มี script ไหนรัน จนต้องเอาเข้าด่าน build)

   เคสที่ล็อก: มีคนเพิ่ม `cachedMaster('คีย์ใหม่')` แล้วไม่ลงทะเบียน
   ⇒ แก้ master แล้วคีย์นั้นค้างถึง 4 ชม. โดยไม่มีใครรู้ (หน้างานเห็นของเก่า หาสาเหตุไม่เจอ) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEYS_BY_TABLE, UNMANAGED, DYNAMIC_PREFIXES, invalidateTable } from '../masterInvalidate.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|mjs)$/.test(f)) out.push(p);
  }
  return out;
}

const registered = new Set([...Object.values(KEYS_BY_TABLE).flat(), ...UNMANAGED]);

test('🔴 ทุกคีย์ cachedMaster/cachedRows ในโค้ดต้องอยู่ในทะเบียน masterInvalidate', () => {
  const missing = [];
  for (const file of walk(SRC)) {
    if (file.includes('__tests__') || file.endsWith('masterInvalidate.js')) continue;
    const src = readFileSync(file, 'utf8');
    /* 🔴 ต้องจับ **ทุกตัวที่เขียน cache** — เพิ่มตัวใหม่แล้วลืมต่อ regex = คีย์หลุดทะเบียนเงียบๆ
       ซึ่งเป็นบั๊กเดียวกับที่ด่านนี้ตั้งมาดัก (`cachedRows` เพิ่ม 13/10) */
    for (const m of src.matchAll(/cached(?:Master|Rows)\(\s*'([^']+)'/g)) {
      const key = m[1];
      if (registered.has(key)) continue;
      if (DYNAMIC_PREFIXES.some(p => key.startsWith(p))) continue;
      missing.push(`${file.replace(SRC, 'src')} → '${key}'`);
    }
  }
  assert.deepEqual(missing, [],
    'คีย์ cache ที่ยังไม่ลงทะเบียน — แก้ master แล้วคีย์นี้จะค้างถึง 4 ชม. เงียบๆ\n' +
    'เพิ่มเข้า KEYS_BY_TABLE (ใต้ตารางที่เป็นเจ้าของเนื้อข้อมูล) หรือ UNMANAGED พร้อมเหตุผล\n' +
    missing.join('\n'));
});

/* 🔴 09/11 — ปิดช่องที่ทำให้ทะเบียนล้าสมัยเงียบมา 4 สัปดาห์
   ด่านข้างบนสแกนเฉพาะ `cachedMaster('<สตริงตรงๆ>')` ⇒ ไฟล์ที่เขียน `cachedMaster(KEY, …)`
   โดย `KEY` เป็นตัวแปร **หลุดด่านทั้งไฟล์** · เคสจริง: `useProductionLines.js` bump คีย์
   `production_lines:v2` → `:v3` (13/10) แต่ทะเบียนยังชี้ `:v2`
   ⇒ `/line-setup` เซฟแล้วเรียก `invalidateTable('production_lines')` = ล้างคีย์ที่ตายแล้ว
     dropdown ไลน์ของหน้าอื่นค้างของเก่าถึง 4 ชม. (หน้างานแจ้ง "โหลดไลน์ไม่ขึ้น") */
test('🔴 คีย์ที่ส่งเป็น "ตัวแปร" ให้ cachedMaster ก็ต้องอยู่ในทะเบียน (ไม่ใช่แค่สตริงตรงๆ)', () => {
  const missing = [];
  for (const file of walk(SRC)) {
    if (file.includes('__tests__') || file.endsWith('masterInvalidate.js')) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/cached(?:Master|Rows)\(\s*([A-Za-z_$][\w$]*)\s*,/g)) {
      const ident = m[1];
      /* หา `const <ident> = '<คีย์>'` ในไฟล์เดียวกัน — ตัวแปรที่ประกอบจากค่าอื่น (template/ตัวแปร)
         จับไม่ได้โดยตั้งใจ: พวกนั้นเป็นคีย์ไดนามิก ซึ่งคุมด้วย DYNAMIC_PREFIXES อยู่แล้ว */
      const decl = new RegExp(`(?:const|let|var)\\s+${ident}\\s*=\\s*'([^']+)'`).exec(src);
      if (!decl) continue;
      const key = decl[1];
      if (registered.has(key)) continue;
      if (DYNAMIC_PREFIXES.some(p => key.startsWith(p))) continue;
      missing.push(`${file.replace(SRC, 'src')} → ${ident} = '${key}'`);
    }
  }
  assert.deepEqual(missing, [],
    'คีย์ cache ที่ส่งเป็นตัวแปรแล้วยังไม่ลงทะเบียน — bump คีย์เมื่อไหร่ invalidateTable จะล้างผิดตัว\n'
    + 'เพิ่มคีย์ใหม่เข้า KEYS_BY_TABLE **และคงคีย์เก่าไว้** (ล้างของค้างบนเครื่องหน้างาน)\n'
    + missing.join('\n'));
});

test('ไม่มีคีย์ซ้ำข้ามตาราง (ซ้ำ = ล้างแล้วไม่รู้ว่าใครเป็นเจ้าของจริง)', () => {
  const seen = new Map();
  for (const [table, keys] of Object.entries(KEYS_BY_TABLE)) {
    for (const k of keys) {
      // ยอมให้ซ้ำได้ถ้าตั้งใจ (ตารางเดียวกันเนื้อเดียวกัน) แต่ต้องรู้ว่าซ้ำที่ไหน
      if (seen.has(k)) assert.fail(`คีย์ '${k}' อยู่ทั้ง ${seen.get(k)} และ ${table}`);
      seen.set(k, table);
    }
  }
});

test('invalidateTable กับตารางที่ไม่ได้ลงทะเบียน = เตือนดังใน console ห้ามเงียบ', () => {
  const orig = console.warn;
  let warned = 0;
  console.warn = () => { warned++; };
  try { invalidateTable('ตารางที่ไม่มีจริง'); } finally { console.warn = orig; }
  assert.equal(warned, 1, 'ล้าง cache ตารางที่ไม่รู้จักแล้วเงียบ = cache ค้างโดยไม่มีใครรู้');
});
