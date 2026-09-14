/**
 * ตัวรันเทสของโปรเจค — `npm test`
 *
 * ที่มา (2026-08-24 · QC audit): มีไฟล์เทส 9 ไฟล์ / 51 เคส ที่ CLAUDE.md อ้างว่า "ล็อกไว้แล้ว"
 * แต่ **ไม่มี script ไหนรันมันเลย** และ `npm run build` (ด่านก่อน commit ตามกฎโปรเจค) มีแค่ lint
 * → เทสที่เขียนไว้กันของพังไม่เคยถูกเรียกใช้จริงถ้าไม่มีคนพิมพ์คำสั่งเอง
 *
 * ⚠️ ทำไมไม่ใช้ `node --test 'src/**\/__tests__/*.test.mjs'` ตรงๆ ใน package.json:
 *   node รองรับ glob ใน `--test` ตั้งแต่ **v22** เท่านั้น · Vite 8 รับ Node 20.19+ ได้
 *   ถ้า Render ใช้ Node 20 อยู่ คำสั่ง glob จะพัง = **deploy ล่ม** ทั้งที่โค้ดไม่ผิด
 *   (และ `node --test <โฟลเดอร์>` ก็ใช้ไม่ได้ — มันตีเป็น path ของโมดูล)
 *   → ไล่หาไฟล์เองด้วย fs แล้วส่งเป็นรายชื่อไฟล์ ใช้ได้ทุกเวอร์ชันที่มี node:test
 *
 * ไฟล์เทสใหม่ถูกเก็บอัตโนมัติ ขอแค่วางไว้ใน `__tests__/` ที่ไหนก็ได้ใต้ src/ และลงท้าย .test.mjs
 *
 * ⏱️ **รอบที่ 2 = เลื่อนนาฬิกาไปข้างหน้า เพื่อจับ "เทสระเบิดเวลา"** (2026-09-14)
 *   ที่มา: เทส `pullSignal` เคสหนึ่งนับจำนวน warning ของไฟล์ตัวอย่างลงวันที่ 2026-09-08
 *   พอโค้ดเพิ่มคำเตือน "ไฟล์เก่ากว่าวันนี้เกิน 3 วัน" เทสนั้นก็ **ผ่านตอนเขียน แล้วตกเอง
 *   ตั้งแต่ 12 ก.ย. โดยไม่มีใครแตะโค้ดเลย** ⇒ `npm run build` ล่ม = **deploy ไม่ออก**
 *   และคนที่มาเจอทีหลังก็หาไม่เจอว่า commit ไหนทำพัง (เพราะไม่มี commit ไหนทำ)
 *   ⇒ รันซ้ำอีกรอบด้วยนาฬิกา +400 วัน: ตกรอบนี้ = เทสนั้นพึ่ง "วันนี้" อยู่
 *      **วิธีแก้คือฉีดเวลาเข้าไปในฟังก์ชัน (พารามิเตอร์ `now`) ไม่ใช่ถอดด่านนี้ออก**
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const SKIP = new Set(['node_modules', 'dist', '.git']);

function findTests(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) continue;
      out.push(...findTests(join(dir, e.name)));
    } else if (e.name.endsWith('.test.mjs') && dir.includes('__tests__')) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

const files = findTests('src').sort();
if (!files.length) {
  console.error('✗ ไม่พบไฟล์เทสเลย — ถ้าตั้งใจย้ายที่เก็บเทส ให้แก้ scripts/run-tests.mjs ด้วย');
  process.exit(1);
}
console.log(`▶ เทส ${files.length} ไฟล์`);
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);

/* ── รอบที่ 2: นาฬิกา +400 วัน (ดูหัวไฟล์) ─────────────────────────────────────── */
const AHEAD_DAYS = 400;
console.log(`\n▶ รอบตรวจเทสระเบิดเวลา — รันซ้ำด้วยนาฬิกา +${AHEAD_DAYS} วัน`);
const r2 = spawnSync(
  process.execPath,
  ['--import', new URL('clock-shift.mjs', import.meta.url).href, '--test', ...files],
  { stdio: 'inherit', env: { ...process.env, FAKE_DAYS: String(AHEAD_DAYS) } },
);
if (r2.status !== 0) {
  console.error(`\n✗ มีเทสที่ผ่านวันนี้ แต่ตกเมื่อนาฬิกาเดินไป ${AHEAD_DAYS} วัน = ระเบิดเวลา`);
  console.error('  เทสนั้นพึ่ง "วันนี้" อยู่ → ให้ฉีดเวลาเข้าไปในฟังก์ชัน (พารามิเตอร์ now)');
  console.error('  แล้วตรึงค่าในเทส · **ห้ามถอดรอบนี้ออกเพื่อให้ build ผ่าน**');
  process.exit(r2.status ?? 1);
}
