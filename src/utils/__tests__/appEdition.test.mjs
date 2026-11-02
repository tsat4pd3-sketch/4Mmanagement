import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as full from '../../appEdition.js';
import * as nm from '../../appEdition.nm.js';

const ROOT = process.cwd();

/* ══ 🏷️ แยก frontend ของ New Model (2026-10-29 · คำสั่ง user) ═══════════════════════════
   เว็บ New Model = โปรแกรมตัวเดียวกับ ESM แต่สลับ "รายชื่อหน้าที่เว็บนี้มี" ตอน build
   เทสชุดนี้คุม 2 เรื่องที่พังแล้วไม่มีใครรู้:
   ① รุ่นเต็มต้องไม่เปลี่ยนพฤติกรรมแม้แต่หน้าเดียว (เงื่อนไข "ห้ามกระทบระบบแมส")
   ② เว็บ NM ต้องกันหน้าของระบบแมสจริง **รวมถึง admin**
   ═══════════════════════════════════════════════════════════════════════════════════════ */

test('🔴 รุ่นเต็ม — inEdition ต้องจริงเสมอ (ไม่งั้นหน้าหายจากระบบแมส)', () => {
  for (const p of ['/', '/daily-report', '/obeya', '/mtn-repair', '/npi', '/nm-board',
    '/หน้าที่ยังไม่มี', '', null, undefined]) {
    assert.equal(full.inEdition(p), true, `รุ่นเต็มบล็อก ${p}`);
  }
  assert.equal(full.EDITION_PAGES, null, 'รุ่นเต็มต้องไม่มี allowlist');
  assert.equal(full.EDITION_HOME, '/', 'หน้าแรกของรุ่นเต็มต้องเป็น / (ไม่งั้น DeptHub ถูกเด้งทิ้ง)');
});

test('รุ่น NM — เปิดเฉพาะหน้าที่อยู่ในลิสต์', () => {
  assert.equal(nm.inEdition('/nm-board'), true);
  assert.equal(nm.inEdition('/npi'), true);
  assert.equal(nm.inEdition('/daily-report'), false);
  assert.equal(nm.inEdition('/obeya'), false);
  assert.equal(nm.inEdition('/permissions'), false);
  assert.equal(nm.EDITION_HOME, '/nm-board');
});

test('รุ่น NM — ตัด query/hash ก่อนเทียบ (deep-link ต้องเข้าได้)', () => {
  assert.equal(nm.inEdition('/npi?project=abc&tab=tooling'), true);
  assert.equal(nm.inEdition('/nm-board?cust=toyota&proj=737d-mlm&tv=1'), true);
  assert.equal(nm.inEdition('/npi#top'), true);
  assert.equal(nm.inEdition('/daily-report?line=A'), false);
});

test('🔴 รุ่น NM — ปลายทางของลิงก์ที่หน้า NM ชี้ไป ต้องอยู่ในลิสต์ (ไม่งั้นลิงก์ในจอเป็นทางตัน)', () => {
  const src = ['src/pages/NPI.jsx', 'src/pages/NewModelBoard.jsx', 'src/pages/Rfq.jsx']
    .map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n');
  const targets = new Set();
  for (const m of src.matchAll(/(?:href|to)=["'{`]+(\/[a-z0-9-]+)/g)) targets.add(m[1]);
  const dead = [...targets].filter(t => !nm.inEdition(t));
  assert.deepEqual(dead, [], `\n\n❌ หน้า NM มีลิงก์ไปหน้าที่เว็บ NM ไม่มี ${dead.length} ปลายทาง\n`
    + '   ทำไมสำคัญ: กดแล้วเด้งกลับหน้าแรกเงียบๆ — คนใช้จะนึกว่าระบบพัง\n'
    + '   แก้: เติมใน EDITION_PAGES (src/appEdition.nm.js) หรือเอาลิงก์ออกจากหน้า NM\n'
    + `   ปลายทางที่ตาย: ${dead.join(' · ')}\n`);
});

test('🔴 ด่าน edition ต้องอยู่ "ก่อน" admin bypass ใน canAccessPage', () => {
  const code = readFileSync(join(ROOT, 'src/utils/permissions.js'), 'utf8');
  const fn = code.slice(code.indexOf('export function canAccessPage'));
  const edi = fn.indexOf('inEdition(');
  const body = fn.indexOf('hasPermission(');
  assert.ok(edi > 0, '\n\n❌ canAccessPage ไม่ได้เรียก inEdition — เว็บ New Model จะเปิดหน้าระบบแมสได้\n');
  assert.ok(edi < body,
    '\n\n❌ ด่าน edition อยู่หลังการเช็คสิทธิ์ ⇒ admin ข้ามได้\n'
    + '   ทำไมห้าม: edition ตอบ "เว็บนี้มีหน้านี้ไหม" ไม่ใช่ "คนนี้เข้าได้ไหม"\n'
    + '              admin ข้ามได้เมื่อไหร่ = เว็บ IEC เปิดจอระบบแมสได้ = หมดเหตุผลที่แยกเว็บ\n');
});

test('🔴 2 edition ต้อง export ชุดเดียวกัน (สลับไฟล์แล้วต้องไม่มีอะไรขาด)', () => {
  const need = ['EDITION', 'EDITION_LABEL', 'EDITION_HOME', 'EDITION_PAGES', 'inEdition'];
  for (const k of need) {
    assert.ok(k in full, `appEdition.js ขาด ${k}`);
    assert.ok(k in nm, `appEdition.nm.js ขาด ${k}`);
  }
});

test('🔴 nm.html ต้องมีตาข่ายกันจอขาวชุดเดียวกับ index.html', () => {
  const ix = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const nmh = readFileSync(join(ROOT, 'nm.html'), 'utf8');
  for (const must of ['boot-fallback', 'boot-retry', '__ESM_MOUNTED', '/src/main.jsx']) {
    assert.ok(nmh.includes(must),
      `\n\n❌ nm.html ขาด "${must}"\n`
      + '   ทำไมสำคัญ: chunk โหลดไม่ได้ = React ไม่เคยขึ้น = ErrorBoundary ไม่ทำงาน\n'
      + '              จอ IEC จะขาวสนิทโดยไม่มีอะไรบอกคนหน้างาน (เคยเกิดกับเว็บหลัก 26/10)\n');
  }
  /* ตาข่ายต้องเป็น "ชุดเดียวกัน" ไม่ใช่แค่มีคำนั้น — เทียบทั้งบล็อกสคริปต์ */
  const grab = (s) => s.slice(s.indexOf('<div id="boot-fallback"'), s.lastIndexOf('</script>'));
  assert.equal(grab(nmh), grab(ix),
    '\n\n❌ ตาข่ายกันจอขาวของ nm.html ไม่ตรงกับ index.html — แก้ที่หนึ่งต้องแก้อีกที่ด้วย\n');
});

test('🔴 vite.nm.config ต้องมี define/ปลั๊กอินชุดเดียวกับ vite.config (ไม่งั้นจอ IEC ค้างเวอร์ชันเก่า)', () => {
  const nmc = readFileSync(join(ROOT, 'vite.nm.config.js'), 'utf8');
  for (const must of ['__BUILD_ID__', 'version.json', 'schemaUsage', 'react()']) {
    assert.ok(nmc.includes(must), `\n\n❌ vite.nm.config.js ขาด ${must} — ดูคอมเมนต์หัวไฟล์\n`);
  }
  assert.ok(/outDir:\s*'dist-nm'/.test(nmc), '\n\n❌ build ของ NM ต้องออกที่ dist-nm เท่านั้น ห้ามทับ dist ของเว็บแมส\n');
});
