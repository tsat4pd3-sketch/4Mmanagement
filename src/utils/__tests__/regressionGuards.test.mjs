/* ═══════════════════════════════════════════════════════════════════════════
   🛡️ ด่านกัน "บั๊กเก่ากลับมา" — ไล่อ่านไฟล์ทั้งรีโปแล้วบังคับกฎที่เคยพังจริง   2026-09-16

   คำสั่ง user: *"ปัญหาต่างๆ ที่เคยแก้เคยเกิด ไม่ควรเกิดซ้ำ"*

   ทำไมเป็น "เทส" ไม่ใช่ script แยก: `npm test` อยู่ในด่าน `npm run build` อยู่แล้ว และ
   `scripts/run-tests.mjs` เก็บไฟล์ใน `__tests__/` เองอัตโนมัติ ⇒ ไม่มีด่านใหม่ให้ลืมต่อ
   (pattern เดียวกับ `storageUpload.test.mjs` ที่สแกนทั้งรีโปอยู่แล้ว)

   ── กติกาของไฟล์นี้ (สำคัญกว่าตัวกฎ) ──────────────────────────────────────
   1. **ใส่เฉพาะกฎที่เคยพังจริงและตรวจด้วย grep ได้แม่น** — กฎที่ false positive บ่อยจะทำให้คน
      อยากปิดด่าน (บทเรียนเดียวกับ `eslint.critical.config.js`: ห้ามใส่กฎ style จุกจิก)
   2. **ทุกกฎต้องเขียน `why` = บั๊กที่เคยเกิด + `fix` = ทำยังไงแทน** — ข้อความนี้คือสิ่งที่คนเห็นตอน build ล่ม
   3. **คอมเมนต์ไม่นับ** — เอกสาร/คำเตือนในโค้ดพูดถึง pattern ต้องห้ามได้ (ตัวสแกนตัด comment ออกก่อน)
   4. **ยกเว้นได้ แต่ต้องมีเหตุผลเขียนกำกับใน `allow`** ห้ามยกเว้นลอยๆ
   5. เจอบั๊กคลาสใหม่ที่ "คนถัดไปน่าจะพลาดซ้ำ" → เพิ่มกฎที่นี่ **ในคอมมิทเดียวกับที่แก้บั๊ก**
   ═══════════════════════════════════════════════════════════════════════════ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname;

function walk(dir, exts, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '__tests__' || e === 'dist' || e.startsWith('.')) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some(x => e.endsWith(x))) out.push(full);
  }
  return out;
}

/** ตัดคอมเมนต์ออกก่อนตรวจ — ไม่งั้นคำเตือนที่เขียนไว้ในโค้ดจะกลายเป็น "ผู้ต้องหา" เสียเอง
 *  (แทนที่ด้วยช่องว่างความยาวเท่าเดิม เพื่อให้เลขบรรทัด/คอลัมน์ยังตรง) */
function stripComments(src) {
  let out = '', i = 0, n = src.length;
  let inLine = false, inBlock = false, inStr = null;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (inLine) { if (c === '\n') { inLine = false; out += c; } else out += ' '; i++; continue; }
    if (inBlock) { if (c === '*' && c2 === '/') { inBlock = false; out += '  '; i += 2; } else { out += c === '\n' ? c : ' '; i++; } continue; }
    if (inStr) { out += c; if (c === '\\') { out += c2 ?? ''; i += 2; continue; } if (c === inStr) inStr = null; i++; continue; }
    if (c === '/' && c2 === '/') { inLine = true; out += '  '; i += 2; continue; }
    if (c === '/' && c2 === '*') { inBlock = true; out += '  '; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

/* ── ทะเบียนกฎ ─────────────────────────────────────────────────────────────
   scan: โฟลเดอร์ที่ตรวจ · ext: นามสกุล · re: regex (global) · allow: ไฟล์ที่ยกเว้น + เหตุผล */
const RULES = [
  {
    id: 'actor-identity-via-setActor',
    scan: ['src'], ext: ['.jsx', '.js'],
    re: /setDrActorName\s*\(/g,
    why: 'setDrActorName ตั้งได้แค่ "ชื่อ" ไม่มี uid ⇒ ตัวตนผู้ใช้ขาดคีย์ที่นับ/join ได้ '
       + 'ซึ่งเป็นต้นเหตุเดิมที่ทำให้ตอบไม่ได้ว่า "งานนี้มีคนทำจริงกี่คน" '
       + '(วัดจริง 16/09/2026: คนเดียวกันถูกนับเป็นหลายคนเพราะทะเบียนคนพิมพ์มือคนละชุด — '
       + '"อภิสิทธิ์ จำปาต้า" ใน profiles vs "นายอภิสิทธิ์ จำปาต้น" ใน mtn_technicians)',
    fix: 'ใช้ setActor(uid, name) จาก src/utils/actorStamp.js — เจ้าของเดียวของ "ใครกำลังทำงาน"',
    allow: { 'src/supabaseClient.js': 'ตัว shim backward-compat เอง (ส่งต่อให้ setActor)' },
  },
  {
    id: 'bom-tree-via-buildBomIndex',
    scan: ['src'], ext: ['.jsx', '.js'],
    // จับ pattern "หาตัวแม่ของบรรทัด BOM เอง" = matOf[b.product_id] / matOfProd[x.product_id] ฯลฯ
    re: /\w*[mM]at[A-Za-z]*\s*\[\s*\w+\.product_id\s*\]/g,
    why: 'ประกอบต้นไม้ BOM เองด้วย product_id ⇒ **ตัวแม่ต้องเป็นแถว dr_products เท่านั้น** '
       + 'ของที่อยู่แค่ parts_master เลยเป็นใบไม้ตลอดกาล — วัดจริง 16/09/2026: 506 แถว/98 สินค้า '
       + 'มีแค่ 57 แถว (11%) ที่ลูกมี BOM ต่อ ⇒ ~90% ถูกตรึงชั้นเดียว "แก้ชั้นไม่ได้" '
       + 'และตั้งแต่มีคอลัมน์ parent_mat แล้ว การเขียนเองจะ**มองข้ามชั้นที่คนตั้งไว้เงียบๆ**',
    fix: 'ใช้ buildBomIndex(rows, matOfProduct) จาก src/utils/bomTree.js แล้วอ่านผ่าน ix.bomOf / ix.parentOf',
    allow: { 'src/utils/bomTree.js': 'ตัว helper เอง (นิยาม parentOf อยู่ที่นี่)' },
  },
  {
    id: 'no-setSearchParams-object',
    scan: ['src'], ext: ['.jsx', '.js'],
    re: /setSearchParams\s*\(\s*\{/g,
    why: 'ล้าง URL param อื่นทิ้งหมด รวม ?tab= ของหน้าแม่ ⇒ จอเด้งออกจากแท็บที่ใช้อยู่ '
       + '(เกิดจริง 16/09/2026: /pm?tab=setup กดแท็บส่วนงานแล้วเด้งไป "ตรวจอุปกรณ์" · เจอซ้ำ 3 หน้า)',
    fix: "ใช้ useMergeParams() จาก src/utils/useTabParam.js — setParams({ dept: d }) · ล้างตัวเดียวด้วย { equip: null }",
    allow: { 'src/utils/useTabParam.js': 'ตัว helper เอง' },
  },
  {
    id: 'no-utc-workdate',
    scan: ['src'], ext: ['.jsx', '.js'],
    re: /new Date\(\)\.toISOString\(\)\.slice/g,
    why: 'toISOString() = UTC ⇒ ช่วง 00:00-06:59 เวลาไทยได้ "วันก่อนหน้า" (กฎเหล็ก Date/Time ใน CLAUDE.md)',
    fix: 'ใช้ getWorkDate() (วันงานตัด 08:00) หรือ todayLocal() จาก src/utils/dateFormat.js',
    allow: {},
  },
  {
    id: 'no-color-mix',
    scan: ['src'], ext: ['.jsx', '.js', '.css'],
    re: /color-mix\s*\(/g,
    why: 'ต้องใช้ Chromium 111+ แต่จอ TV หน้างาน (LG webOS 23) = Chromium 94 ⇒ ทั้งบรรทัด declaration ถูกทิ้ง '
       + 'พื้นการ์ดกลายเป็นโปร่ง (เคยหลุดจริงที่ StoreMonitor)',
    fix: "ใช้ alpha-hex `${color}14` หรือ backgroundImage: linear-gradient(c14, c14) ทับบน var(--card)",
    allow: {},
  },
  {
    id: 'no-viewport-dvh',
    scan: ['src'], ext: ['.jsx', '.js', '.css'],
    re: /\b\d+(\.\d+)?(dvh|svh|lvh)\b/g,
    why: 'หน่วย dvh/svh/lvh ต้องใช้ Chromium 108+ — เพดานจอ TV ที่ต้องรองรับคือ 94',
    fix: 'ใช้ vh หรือคำนวณความสูงด้วย flex/grid แทน',
    allow: {},
  },
  {
    id: 'no-css-container-query',
    scan: ['src'], ext: ['.jsx', '.js', '.css'],
    re: /@container\b/g,
    why: '@container ต้องใช้ Chromium 105+ — เพดานจอ TV = 94',
    fix: 'ใช้ breakpoint ปกติ (useIsMobile / media query)',
    allow: {},
  },
  {
    id: 'no-replica-identity-full',
    scan: ['supabase/migrations'], ext: ['.sql'],
    re: /replica\s+identity\s+full/gi,
    why: 'ทำให้ทุก UPDATE/DELETE ส่ง row เต็มผ่าน realtime = ค่า egress พุ่ง (กฎเหล็กข้อ 7 ใน CLAUDE.md) '
       + 'ปัญหาจริงคือ DELETE กรองด้วยคอลัมน์ที่ไม่ใช่ pk ไม่ได้ — ห้ามแก้ด้วยวิธีนี้',
    fix: 'แยก subscribe DELETE แบบไม่กรอง แล้วกรองฝั่ง client แทน',
    allow: {},
  },
];

function violations(rule) {
  const files = rule.scan.flatMap(d => walk(join(ROOT, d), rule.ext));
  const hits = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rule.allow[rel]) continue;
    const raw = readFileSync(file, 'utf8');
    const code = rule.ext.includes('.sql') ? raw.replace(/--[^\n]*/g, '') : stripComments(raw);
    code.split('\n').forEach((line, i) => {
      rule.re.lastIndex = 0;
      if (rule.re.test(line)) hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 110)}`);
    });
  }
  return hits;
}

for (const rule of RULES) {
  test(`🛡️ ${rule.id} — ${rule.why.slice(0, 70)}…`, () => {
    const hits = violations(rule);
    assert.deepEqual(hits, [],
      `\n\n❌ กฎ "${rule.id}" ถูกละเมิด ${hits.length} จุด\n`
      + `   ทำไมห้าม: ${rule.why}\n`
      + `   แก้ยังไง: ${rule.fix}\n\n`
      + hits.map(h => '   • ' + h).join('\n')
      + `\n\n   (ยกเว้นจริงๆ ให้เติม allow ใน src/utils/__tests__/regressionGuards.test.mjs พร้อมเหตุผล)\n`);
  });
}

test('🛡️ ทุกกฎต้องมี why + fix เขียนกำกับ (ข้อความนี้คือสิ่งที่คนเห็นตอน build ล่ม)', () => {
  for (const r of RULES) {
    assert.ok(r.why && r.why.length > 30, `${r.id}: ต้องเขียน why ให้เข้าใจว่าเคยพังยังไง`);
    assert.ok(r.fix && r.fix.length > 10, `${r.id}: ต้องเขียน fix ว่าให้ใช้อะไรแทน`);
  }
});

test('🛡️ ตัวสแกนต้องไม่จับข้อความในคอมเมนต์ (ไม่งั้นเอกสารในโค้ดกลายเป็นผู้ต้องหา)', () => {
  const src = [
    '// setSearchParams({ dept: d })  ← ห้ามเขียนแบบนี้',
    '/* color-mix( ) ห้ามใช้ */',
    'const ok = 1;',
  ].join('\n');
  const out = stripComments(src);
  assert.ok(!out.includes('setSearchParams({'));
  assert.ok(!out.includes('color-mix('));
  assert.ok(out.includes('const ok = 1;'), 'โค้ดจริงต้องไม่ถูกตัดทิ้ง');
  assert.equal(out.split('\n').length, 3, 'เลขบรรทัดต้องไม่เพี้ยน');
});

test('🛡️ ตัวสแกนต้องไม่พลาดของจริงที่อยู่ในสตริง/JSX', () => {
  const out = stripComments(`const s = "a // b"; setSearchParams({ x: 1 });`);
  assert.ok(out.includes('setSearchParams({'), 'โค้ดหลังสตริงที่มี // ต้องยังถูกตรวจ');
});
