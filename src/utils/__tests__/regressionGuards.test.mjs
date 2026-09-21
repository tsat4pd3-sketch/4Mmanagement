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
    id: 'kpi-score-via-scoreDef',
    scan: ['src/components', 'src/pages', 'src/lib'], ext: ['.jsx', '.js'],
    // จับการเอา statusVsTarget ไปตัดสิน "แถว KPI" (ตัวมันมีแถบผ่อนผัน ±5% ที่เราคิดเอง)
    re: /statusVsTarget\s*\(/g,
    why: 'เกณฑ์ทางการของกลุ่มคือ **ถึง Target = 1 · ถึงแค่ Commitment = 0.5 · ไม่ถึง = 0** '
       + '(หัวคอลัมน์ในประกาศบริษัท QSM-R2 001/2569 เขียนตรงตัว) แต่ statusVsTarget ใช้ "แถบ ±5%" '
       + 'ที่เราคิดขึ้นเอง ⇒ 17/09/2026 วัดจริง: KPI แถวเดียวกันค่าเดียวกันได้ 3 คำตอบจาก 3 จอ '
       + '(KpiMonthly = Y/N ไม่มีขั้น 0.5 · ObeyaKpiBoard = เหลืองจากแถบ ±5% · kpiSetup = 1/0.5/0) '
       + 'และ CLAUDE.md เขียนห้ามไว้ตรงๆ ว่า "ห้ามคิดเกณฑ์สีเอง"',
    fix: 'ใช้ scoreDef(value, defRow) จาก src/utils/kpiSetup.js (อ่านได้ทั้งคอลัมน์ใหม่และ direction/commitment เก่า) '
       + 'แล้ว map sc.status → good/warn/bad/unknown',
    allow: {
      'src/components/ObeyaKpiBoard.jsx':
        'เหลือ 2 จุดในแถบ SQDCM = ไฟเฝ้าระวัง**รายวัน** (plan% · OEE วันนี้) ไม่ใช่คะแนน KPI รายเดือน — มีคอมเมนต์เส้นแบ่งกำกับแล้ว',
    },
  },
  {
    id: 'kpi-level-not-boolean',
    scan: ['src'], ext: ['.jsx', '.js'],
    // จับ ternary บนตัวแปรระดับคะแนนโดยตรง เช่น `yn ? 'Y' : 'N'` / `lv ? 'Y' : 'N'`
    re: /\b(yn|ynTot|ynTotal|lv|level)\s*\?\s*['"]Y['"]\s*:\s*['"]N['"]/g,
    why: 'ระดับคะแนน KPI เป็น 1 / 0.5 / 0 ไม่ใช่ boolean — **0.5 เป็นค่า truthy** '
       + '⇒ ใบที่ได้แค่ครึ่งคะแนน (ถึง Commitment แต่ไม่ถึง Target) จะถูกพิมพ์เป็น "Y" สีเขียว '
       + 'เหมือนผ่านเต็ม ทั้งบนจอและในไฟล์ Excel ฟอร์ม FM-HRM-6-022 ที่ส่งให้ QSM',
    fix: "เทียบด้วย === 1 / === 0.5 เสมอ · สัญลักษณ์ทางการ ○ Achieve (1) · △ Improvement (0.5) · ✗ Miss goal (0)",
    allow: {},
  },
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
    id: 'people-index-single-owner',
    scan: ['src'], ext: ['.jsx', '.js'],
    re: /setPeopleIndex\s*\(/g,
    why: 'ทะเบียน "ชื่อ → uid" มีเจ้าของได้คนเดียว — ป้อนจากหลายที่ = ทะเบียนทับกันเอง '
       + 'แล้ว uid ที่ stamp ลงแถวจะต่างกันตามลำดับการโหลดของแต่ละหน้า (บทเรียนเดียวกับตัวตนผู้ใช้ที่เคยมี 2 เจ้าของ)',
    fix: 'ป้อนที่ loadProfilesPeople() ใน src/utils/usePeople.js ที่เดียว — มันคือฟังก์ชันเดียวที่ผลิตรายชื่อ profiles ทั้งแอป',
    allow: {
      'src/utils/usePeople.js': 'เจ้าของที่ตั้งใจให้ป้อน',
      'src/utils/actorStamp.js': 'ตัวฟังก์ชันเอง',
      'src/utils/__tests__/actorStamp.test.mjs': 'เทส',
    },
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
    id: 'carry-qty-must-include-imported',
    scan: ['src'], ext: ['.jsx', '.js'],
    // จับลิสต์สถานะใบผลิตที่ "นับยอดที่ทำได้" แต่ลืม imported
    re: /\[\s*'open'\s*,\s*'carry_over'\s*,\s*'cancelled'\s*\]/g,
    why: 'ลิสต์สถานะที่นับยอดผลิตแต่**ไม่มี `imported`** ⇒ พอกะถัดไปกด "รับยอดค้าง" ใบเดิมกลายเป็น '
       + 'imported แล้วยอดที่ทำได้ในกะนั้นหายจากสูตรทันที · เกิดจริง 16/09/2026 (หัวหน้ากลุ่ม Assy2 จับได้): '
       + 'Assy LWR 15/09 กะเช้า ตอนขอปิดกะนับ 384 ชิ้น → SV อนุมัติเช้าวันถัดไป (ใบถูก import ไปแล้ว) '
       + 'เหลือ 352 ⇒ %P 86.18 → 79.00 · OEE 72.00 → 66.00 ทั้งที่ actual_qty ในแถวเดียวกันยังเป็น 384',
    fix: "เติม 'imported' เข้าลิสต์ (ยอดอยู่ที่ qty_actual ของใบเดิม · ใบสืบทอดถือแค่ส่วนที่เหลือ ไม่ซ้ำซ้อน) "
       + 'หรือใช้ orderProducedQty() จาก src/utils/oee.js §6',
    allow: {},
  },
  {
    id: 'no-select-star-on-wide-hot-tables',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับ `.from('<ตารางอ้วน>').select('*')` — เว้นวรรค/ขึ้นบรรทัดระหว่างกันได้
       ทะเบียนตารางในกฎนี้ = ตารางที่ **คอลัมน์เยอะ + ถูกดึงซ้ำทั้งวันจากหลายเครื่อง** เท่านั้น
       (ไม่ใช่ทุกตาราง — ทะเบียน master เล็กๆ `select('*')` ได้ตามปกติ ไม่ต้องมาขึ้นด่านนี้) */
    re: /\.from\(\s*'(mtn_orders)'\s*\)\s*\n?\s*\.select\(\s*'\*'/g,
    why: 'ตารางกว้าง (mtn_orders = **116 คอลัมน์**) ที่จอเปิดค้างทั้งวันดึงซ้ำ ⇒ egress ระเบิด · '
       + 'วัดจริง 16/09/2026: `mtn_orders?select=*&limit=1000` = **1.59 MB/ครั้ง** (บีบแล้ว ~452 KB) '
       + 'ยิงวันละ **1,389 ครั้ง** ⇒ **~628 MB/วัน = เกือบครึ่งของ egress ฝั่ง DR ทั้งหมดจากคิวรีเดียว** '
       + '· โควต้า Supabase Free = 5 GB/เดือน ⇒ คิวรีนี้ตัวเดียวกินหมดโควต้าใน ~8 วัน '
       + '(เคยโดนล็อกบริการทั้ง organization มาแล้วจาก egress เกิน — ทั้งโรงงาน login ไม่ได้)',
    fix: "จอรายการ = เลือกคอลัมน์ที่ใช้จริง (ดู MO_LIST_COLS ใน src/pages/MtnRepair.jsx) · "
       + "รายละเอียดใบเต็มค่อยดึงตอนเปิดใบทีละใบด้วย .select('*').eq('id', id)",
    allow: {
      'src/pages/MtnRepair.jsx': 'ใบเดียวตอนเปิดดู/หลังบันทึก (fetchFullOrder + .eq(id)) — ไม่ใช่ทั้งตาราง',
      'src/pages/PMCheckData.jsx': 'insert(...).select() คืนแถวที่เพิ่งสร้าง 1 แถว',
      'src/lib/monthlyReviewPptx.js': 'รายงานรายเดือน กดเองปีละไม่กี่ครั้ง ไม่ใช่จอเปิดค้าง',
      'src/pages/OrderTrace.jsx': 'สอบกลับใบเดียวตามที่ผู้ใช้ค้น ไม่ใช่ทั้งตาราง',
    },
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

/* ═══ กฎเชิงความสัมพันธ์ (regex บรรทัดเดียวจับไม่ได้) ═══════════════════════
   บั๊ก "downtime ที่ทับเวลาพักถูกหักซ้ำ" เขียนคร่อมหลายบรรทัดเสมอ (reduce/forEach สะสม
   `duration_min` ของ category='planned') ⇒ regex ต่อบรรทัดจับไม่ได้เลยสักจุด
   แต่มี invariant ที่จับได้แม่น: **ใครถ่วงน้ำหนักด้วย `wLoad` ต้องได้ `plannedMin` มาจาก
   ตัวที่ตัดช่วงพักแล้ว** — ถ้าไฟล์ import wLoad โดยไม่มีตัวตัดช่วงพักอยู่เลย = น่าสงสัยทันที

   วัดจริง 16/09: กฎนี้จับได้ครบทั้ง 6 จุดที่เป็นบั๊ก (OeeInsightPanel · ObeyaKpiBoard ×2 ·
   vsmLive · monthlyReviewPptx ×2 · VSM) — จุดสุดท้าย QC audit เองก็ตกหล่น เพราะ VSM
   ไม่ได้ import wLoad ตรงๆ แต่เซ็ต `s.plannedMin` ให้ util ไปใช้ */
const BREAK_AWARE = /dtMinBySession|dtMinOutsideBreaks|breakIntervalsIn|policyBreakForShift|policyBreakOverlapMin/;
const WLOAD_ALLOW = {
  'src/utils/obeyaKpi.js':
    'โมดูล pure — รับ rows ที่มี plannedMin มาแล้ว ไม่ได้อ่าน downtime เอง (หน้าที่เรียกเป็นคนรับผิดชอบ)',
  'src/pages/PlannerSales.jsx':
    'ตั้งใจไม่โหลด downtime → plannedMin = 0 → wLoad ถอยไปถ่วงด้วย shift_min (มีคอมเมนต์อธิบายที่บรรทัด 883-884) '
    + '= ประมาณการ ไม่ใช่การหักซ้ำ',
};

test('🛡️ no-wload-without-break-helper — ไฟล์ที่ถ่วง OEE ด้วย wLoad ต้องตัด downtime ที่ทับเวลาพักก่อน', () => {
  const files = walk(join(ROOT, 'src'), ['.jsx', '.js']);
  const hits = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (WLOAD_ALLOW[rel] || rel === 'src/utils/oee.js') continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    if (!/^import[^\n]*\bwLoad\b/m.test(code)) continue;   // ใช้จริง ไม่ใช่แค่ชื่อคล้าย (borrowLoading ฯลฯ)
    if (!BREAK_AWARE.test(code)) hits.push(rel);
  }
  assert.deepEqual(hits, [],
    '\n\n❌ ไฟล์ด้านล่างถ่วงน้ำหนัก OEE ด้วย wLoad แต่ไม่มีตัวตัด downtime ที่ทับเวลาพักเลย\n'
    + '   ทำไมห้าม: พักตามนโยบายถูกกันออกจากฐานเวลาไปแล้ว — เอานาที downtime ที่ตกในช่วงพัก\n'
    + '   มาหักอีก = หักซ้ำ (วัดจริง 90 วัน: 664/1,298 กะ %A ต่ำกว่าจริงเฉลี่ย 1.52 จุด สูงสุด 41.1)\n'
    + '   แก้ยังไง: plannedMin ต้องมาจาก dtMinBySession(sessions, downtimes, breakPolicies)[id].planned\n'
    + '   ⚠️ อย่าลืม select `start_time` ของกะ และ `started_at`/`ended_at` ของ downtime ด้วย\n'
    + '      — ขาดคอลัมน์พวกนี้ ตัวตัดช่วงพักจะคืนค่าดิบเงียบๆ (fix ที่ไม่ fix)\n\n'
    + hits.map(h => '   • ' + h).join('\n')
    + '\n\n   (ยกเว้นจริงๆ ให้เติม WLOAD_ALLOW พร้อมเหตุผล)\n');
});


/* ═══ กฎเชิงความสัมพันธ์ #2 — ช่วงเวลาของพาร์ทต้องอยู่ในกะ (2026-09-17 · user จับได้) ═══
   ใบผลิตถูก "ยืนยันย้อนหลัง" ได้ (หัวหน้าปิดการ์ดเช้าวันรุ่งขึ้น / SV อนุมัติทีหลัง)
   ⇒ confirmed_at / stopped_at ตกนอกเวลาเปิด-ปิดกะของตัวเองได้จริง
   วัดจริง 17/09/2026 (ฐาน DR · กะที่ปิดแล้ว): **251 ใบ ใน 64 กะ ปิดหลังกะจบ เฉลี่ยเกิน 715 นาที
   (~12 ชม.) สูงสุด 13,314 นาที (9.2 วัน)**

   เอาไปประกอบ "ช่วงที่พาร์ทวิ่ง" ตรงๆ ⇒ ฐานเวลายาวเกินจริงหลายเท่า:
     Assy LWR 15/09 กะเช้า · MAT 10105769 มีใบที่ confirmed_at = 08:30 ของ *วันถัดไป*
     ⇒ window 24.5 ชม. ⇒ "ควรได้" 1,278 ชิ้นในกะเดียว ⇒ %P รายชิ้น 6%
     ทั้งที่งานตัวเดียวกันคนละลูกค้า (10105770) ได้ 70%
     (จอโชว์ช่วงเป็น "08:00–08:30" เพราะตัดเหลือ HH:MM เลยดูเหมือนครึ่งชั่วโมง — หลอกตามาก)

   regex บรรทัดเดียวจับไม่ได้ (Math.max(...) กับ clampWinToShift อยู่คนละบรรทัด) และ allow
   ระดับไฟล์ก็ใช้ไม่ได้ (จะข้ามทั้ง DailyReport.jsx ซึ่งเป็นไฟล์ที่ต้องเฝ้าพอดี)
   ⇒ ใช้ invariant: **ไฟล์ไหนประกอบ closedTimes/stopTimes จาก confirmed_at/stopped_at
      ต้อง import clampWinToShift มาใช้ด้วย** */
const BUILDS_MAT_WINDOW = /\bconst\s+(?:closedTimes|stopTimes|openStopTimes)\s*=/;

test('🛡️ mat-window-must-clamp-to-shift — ไฟล์ที่ประกอบช่วงเวลาของพาร์ท ต้องรัดให้อยู่ในกะ', () => {
  const files = walk(join(ROOT, 'src'), ['.jsx', '.js']);
  const hits = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rel === 'src/utils/oee.js') continue;            // ตัว helper เอง
    const code = stripComments(readFileSync(file, 'utf8'));
    if (!BUILDS_MAT_WINDOW.test(code)) continue;
    if (!/\bclampWinToShift\s*\(/.test(code)) hits.push(rel);
  }
  assert.deepEqual(hits, [],
    '\n\n❌ ไฟล์ด้านล่างประกอบ "ช่วงเวลาที่ MAT.NO วิ่ง" จาก confirmed_at/stopped_at แต่ไม่ได้รัดให้อยู่ในกะ\n'
    + '   ทำไมห้าม: ใบผลิตถูกยืนยันย้อนหลังข้ามวันได้ — วัดจริง 17/09/2026: 251 ใบ ใน 64 กะ ปิดหลังกะจบ\n'
    + '   เฉลี่ยเกิน 715 นาที สูงสุด 13,314 นาที (9.2 วัน) ⇒ ฐานเวลาของพาร์ทยาวเกินจริงหลายเท่า\n'
    + '   เคสจริง: Assy LWR 15/09 กะเช้า MAT 10105769 → "ควรได้" 1,278 ชิ้น ⇒ %P รายชิ้น 6%\n'
    + '   (งานตัวเดียวกันคนละลูกค้าได้ 70%)\n'
    + '   แก้ยังไง: clampWinToShift(startMs, endMs, shiftFrameOf(session)) จาก src/utils/oee.js §7\n'
    + '   ⚠️ ห้ามแก้ด้วยการทิ้งใบที่เวลาเกิน — ยอดผลิตของใบนั้นเป็นของกะนี้จริง หายไม่ได้\n'
    + '   ⚠️ อย่าลืม select work_date / start_time / end_time ของกะมาด้วย ไม่งั้น frame = null = ไม่รัดเงียบๆ\n\n'
    + hits.map(h => '   • ' + h).join('\n') + '\n');
});


/* ═══ กฎเชิงความสัมพันธ์ #3 — เรียก computeLiveOee ต้องส่ง pairMap (2026-09-18 · user ยืนยันนิยาม) ═══
   user: *"ถ้างานคู่ แบบ gang die / 1 shot ได้งาน 2 ชิ้น หรือ คู่ซ้าย-ขวา ต้องนับเป็น shot หรือ cycle"*

   **ชิ้น ≠ shot** — CT ที่ตั้งในทะเบียนคือเวลาต่อ **1 จังหวะเครื่อง** แต่ RH กับ LH ถือ CT
   เต็มคนละค่า ⇒ บวก qty×CT ทั้งสองข้าง = เวลามาตรฐาน 2 เท่า ⇒ %P ทะลุ 100 แล้วโดน
   `Math.min(1, …)` กดเหลือ 100 **เงียบๆ** ⇒ OEE สูงเกินจริงโดยไม่มีใครรู้

   วัดจริง 18/09 บนข้อมูลสด: HDF1 %P ดิบ 159% · LASER-345 160% (จอขึ้น "⚠%P ตัน")
   ratio (เวลามาตรฐาน ÷ เวลาเครื่องเดิน · เกิน 1 = เป็นไปไม่ได้) ก่อน→หลังยุบ 45 วัน:
     LASER-345 1.80→1.04 · HDF2 1.15→0.72 · HDF1 1.14→0.66
     ไลน์ไม่มีคู่ไม่ขยับ (Line 61 0.71 · BENDING E50 0.59) = ยืนยันว่าแตะเฉพาะไลน์งานคู่

   ⚠️ `pairMap` ไม่ส่ง = กลับไปนับ 2 เท่าเงียบๆ (พฤติกรรมเดิม ไม่ throw ไม่เตือน)
      → ต้องมีด่าน ไม่งั้นจอใหม่ที่ลอกโค้ดจอเก่าจะพลาดซ้ำแน่ */
test('🛡️ live-oee-must-pass-pairmap — ทุกจอที่คิด OEE สด ต้องส่ง pairMap (งานคู่ = 1 shot)', () => {
  const files = walk(join(ROOT, 'src'), ['.jsx', '.js']);
  const hits = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rel === 'src/utils/oee.js') continue;                 // ตัวฟังก์ชันเอง
    const code = stripComments(readFileSync(file, 'utf8'));
    if (!/\bcomputeLiveOee\s*\(\s*\{/.test(code)) continue;   // เรียกจริง ไม่ใช่แค่ import/อ้างชื่อ
    if (!/\bpairMap\s*[:,}]/.test(code)) hits.push(rel);
  }
  assert.deepEqual(hits, [],
    '\n\n❌ ไฟล์ด้านล่างเรียก computeLiveOee แต่ไม่ได้ส่ง pairMap\n'
    + '   ทำไมห้าม: งานคู่ gang die / RH-LH ปั๊ม 1 จังหวะได้ 2 ชิ้น แต่ CT คือเวลาต่อ 1 จังหวะ\n'
    + '   ไม่ส่ง pairMap = บวก qty×CT ทั้งสองข้าง = เวลามาตรฐาน 2 เท่า ⇒ %P ทะลุ 100 แล้วถูก cap เงียบ\n'
    + '   (วัดจริง 18/09: HDF1 %P ดิบ 159% · LASER-345 160% ⇒ OEE สูงเกินจริงทั้ง 4 ไลน์งานคู่)\n'
    + '   แก้ยังไง: โหลด `pair_mat_no` จาก dr_products แล้วส่ง pairMap = { mat_no: pair_mat_no }\n'
    + '   ⚠️ อย่าลืม select `pair_mat_no` ด้วย — ขาดคอลัมน์นี้ pairMap จะว่างเปล่าเงียบๆ (fix ที่ไม่ fix)\n'
    + '   ⚠️ ห้ามยุบคู่ในฝั่งยอดผลิต/%Q — นั่นนับ "ชิ้น" คนละหน่วยกับ "shot"\n\n'
    + hits.map(h => '   • ' + h).join('\n') + '\n');
});
