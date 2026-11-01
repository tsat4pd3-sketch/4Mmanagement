/* 🛡️🛡️ ด่าน "กฎขอบเขตห้ามล็อกคนจริงออกจากระบบ" — เล่นกฎซ้ำกับ **ทะเบียนผู้ใช้จริง** (2026-10-26)
 *
 * ทำไมต้องมี (เคสจริง · คำสั่ง user "ทำด่านกันซ้ำ"):
 *   25/10 แก้กฎขอบเขตให้หัวหน้ากลุ่มแคบลง — `npm run build` ผ่าน · 3,496 เทสผ่าน · crashsweep 84 หน้าพัง 0
 *   แต่เช้าวันจันทร์ 26/10 หน้างานแจ้ง "เปิดกะไม่ได้ เลือกไลน์ไม่ได้"
 *   ⇒ เทสทั้งหมดเล่นกับ **ข้อมูลสังเคราะห์** ที่เขียนให้กฎใหม่ผ่าน จึงไม่มีใครถาม
 *     คำถามเดียวที่สำคัญ: *"ถ้าบีบแบบนี้ คน 124 บัญชีในฐานจริงจะเหลือกี่ไลน์"*
 *   วัดย้อนหลังแล้ว: หัวหน้ากลุ่มฝั่ง PD1 **3 คนเหลือไลน์เดียว** (ไลน์ 800 / 600 / 200&250 ตัน)
 *
 * 🔴 หลักการที่ด่านนี้ล็อกไว้ — **"การบีบขอบเขตเป็นการตั้งค่า ไม่ใช่งานของโค้ด"**
 *    โค้ดห้ามคืนไลน์น้อยกว่าที่ `profiles` ตั้งไว้ · อยากให้ใครแคบลง = ไปแก้ที่ `/add-user`
 *    (ตาข่ายกันตั้งค่าผิดทำได้ แต่ต้องไม่แคบกว่า anchor ที่ตั้งไว้ — ดูข้อ C)
 *
 * ทะเบียนอยู่ `fixtures/userScopeRegistry.json` (ไม่มีชื่อคน · มี SQL รีเฟรชอยู่ใน `_meta`)
 * 🔴 **แก้กฎขอบเขต (`sectionScope.js` · `viewScope.js` · `lineHierarchy.js`) = รีเฟรช fixture
 *    แล้วรันด่านนี้ก่อน merge เสมอ** — ของเก่าไม่ต้องรีเฟรชถ้าไม่ได้แตะกฎ
 * ⏱️ ด่านนี้ไม่พึ่งเวลาปัจจุบันเลย (รอบเทส "นาฬิกา +400 วัน" จึงไม่กระทบ)
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { effectiveSections, scopedLines, scopedLineNames } from '../sectionScope.js';
import { getLineFamilyNames } from '../lineHierarchy.js';

const REG = JSON.parse(
  readFileSync(new URL('./fixtures/userScopeRegistry.json', import.meta.url), 'utf8'));

const lines = REG.lines.filter(l => l.is_active);       // จอโหลดเฉพาะไลน์ที่ใช้งาน
const norm = (s) => (s || '').toString().trim().toLowerCase();
const nameSet = new Set(lines.map(l => l.name));
const sectionsWithLines = new Set(lines.map(l => norm(l.section)).filter(Boolean));
const moved = REG._meta?.moved_lines || {};

const effOf = (p) => effectiveSections(p.role, p.sections, p.section, p.scope_depth);
const visOf = (p) => scopedLines({
  role: p.role, lineId: p.line_id, sections: effOf(p), lines, scopeIdx: null,
}).map(l => l.name);
const tag = (p) => `${p.acct} ${p.role}/${p.scope_depth} sec=${JSON.stringify(p.sections ?? p.section)} line=${p.line_id ?? '-'}`;

test('ทะเบียนที่ด่านใช้ต้องมีของจริงอยู่ (fixture ว่าง = ด่านผ่านฟรี)', () => {
  assert.ok(REG.profiles.length >= 50, `บัญชีน้อยผิดปกติ (${REG.profiles.length})`);
  assert.ok(lines.length >= 20, `ไลน์น้อยผิดปกติ (${lines.length})`);
  assert.ok(REG.openedLines.length >= 10, `ประวัติเปิดกะน้อยผิดปกติ (${REG.openedLines.length})`);
  assert.equal(new Set(REG.profiles.map(p => p.acct)).size, REG.profiles.length, 'acct ซ้ำ');
  // 🔴 ห้ามมีชื่อคน/อีเมล/uid เต็มหลุดเข้าไฟล์ทะเบียน
  const raw = readFileSync(new URL('./fixtures/userScopeRegistry.json', import.meta.url), 'utf8');
  assert.ok(!/@[\w.-]+\.\w/.test(raw.replace(/"[^"]*sql[^"]*":/gi, '')), 'เจออีเมลใน fixture');
  for (const p of REG.profiles) assert.match(p.acct, /^[0-9a-f]{8}$/, `acct ไม่ใช่ hash: ${p.acct}`);
});

test('🔴 A — ไม่มีบัญชีจริงไหนเหลือ 0 ไลน์ (จอว่าง = ทำงานไม่ได้เลย)', () => {
  const locked = REG.profiles.filter((p) => {
    if (p.role === 'admin') return false;                 // ตาข่ายกันตาย เห็นทั้งหมดเสมอ
    const eff = effOf(p);
    /* ขอบเขตที่ "ไม่มีไลน์ผลิตสังกัดอยู่เลย" (QA · Planning&Store · ฝั่งช่าง) ไม่เข้าข่าย —
       จอ picker มีตาข่ายของตัวเองที่ `scopeLines()` ใน LineSelect.jsx (เคส 2026-08-24) */
    if (eff.length && !eff.some(s => sectionsWithLines.has(norm(s)))) return false;
    return visOf(p).length === 0;
  }).map(tag);
  assert.deepEqual(locked, [], `\nบัญชีที่มองไม่เห็นไลน์ไหนเลย ${locked.length} ราย:\n  ${locked.join('\n  ')}\n`);
});

test('🔴 B — โค้ดห้ามบีบแคบกว่าขอบเขตที่ตั้งไว้ใน profiles (ตัวที่พลาดจริง 25/10)', () => {
  const bad = [];
  for (const p of REG.profiles) {
    if (p.role === 'admin') continue;
    const eff = effOf(p);
    if (!eff.length) continue;                            // ไม่จำกัด / scope_depth='all' → ข้อ C คุม
    const want = lines.filter(l => eff.some(s => norm(s) === norm(l.section))).map(l => l.name);
    if (!want.length) continue;                           // ขอบเขตไม่มีไลน์สังกัด
    const got = new Set(visOf(p));
    const miss = want.filter(n => !got.has(n));
    if (miss.length) bad.push(`${tag(p)}\n      ขาด ${miss.length}/${want.length} ไลน์: ${miss.join(' · ')}`);
  }
  assert.deepEqual(bad, [], `\nบัญชีที่โค้ดบีบแคบกว่าที่ตั้งไว้ ${bad.length} ราย:\n  ${bad.join('\n  ')}\n`);
});

test('🔴 C — ของ 25/10 ห้ามถอย: หัวหน้ากลุ่มที่ตั้ง scope_depth=all ต้องถูกบีบเป็นครอบครัวไลน์ตัวเอง', () => {
  /* เคสสังเคราะห์ — คุมกฎไว้เสมอ ไม่ว่าทะเบียนจริงจะถูกแก้ไปแล้วหรือยัง
     (ถ้าผูกกับทะเบียนอย่างเดียว วันที่แอดมินแก้ 2 บัญชีนั้นถูก กฎจะไม่มีใครคุม) */
  const famOf = (lineId) => {
    const me = lines.find(l => String(l.id) === String(lineId));
    return me ? [...getLineFamilyNames(lines, me.name)].sort() : null;
  };
  const parent = lines.find(l => !l.parent_line_name
    && lines.some(c => c.parent_line_name === l.name));
  assert.ok(parent, 'ทะเบียนไม่มีไลน์แม่ที่มีลูก — เคสสังเคราะห์ประกอบไม่ได้');
  const synthetic = { acct: 'synthetic', role: 'leader', scope_depth: 'all', sections: null, section: parent.section, line_id: parent.id };
  assert.deepEqual([...visOf(synthetic)].sort(), famOf(parent.id),
    'leader + scope_depth=all ต้องเห็นแค่ครอบครัวไลน์ตัวเอง ไม่ใช่ทั้งโรงงาน');
  assert.ok(visOf(synthetic).length < lines.length, 'เห็นทั้งโรงงาน = ของ 25/10 ถอยแล้ว');

  // แล้วค่อยทวนกับบัญชีจริงที่ยังตั้งแบบนี้อยู่ (มีเท่าไหร่ก็ได้ รวมศูนย์ = 0)
  for (const p of REG.profiles.filter(p => p.role === 'leader' && p.line_id && p.scope_depth === 'all')) {
    assert.deepEqual([...visOf(p)].sort(), famOf(p.line_id), `${tag(p)} ไม่เท่าครอบครัวไลน์ตัวเอง`);
  }
});

test('🔴 D — ไลน์ที่บัญชีนี้ "เคยเปิดกะจริง" ต้องยังมองเห็นได้ (งานจริงห้ามหาย)', () => {
  const byAcct = new Map(REG.profiles.map(p => [p.acct, p]));
  const bad = [];
  let checked = 0;
  for (const row of REG.openedLines) {
    const p = byAcct.get(row.acct);
    if (!p) continue;                                     // บัญชีถูกลบไปแล้ว
    const skip = new Set(moved[row.acct] || []);
    const want = row.lines.filter(n => nameSet.has(n) && !skip.has(n));
    if (!want.length) continue;
    checked += want.length;
    const got = new Set(visOf(p));
    const miss = want.filter(n => !got.has(n));
    if (miss.length) bad.push(`${tag(p)}\n      เคยเปิดกะแต่มองไม่เห็น: ${miss.join(' · ')}`);
  }
  assert.ok(checked >= 30, `คู่ (บัญชี×ไลน์) ที่ตรวจได้น้อยผิดปกติ (${checked}) — fixture เพี้ยนหรือเปล่า`);
  assert.deepEqual(bad, [], `\nบัญชีที่ถูกตัดขาดจากไลน์ที่เคยทำงานจริง ${bad.length} ราย:\n  ${bad.join('\n  ')}\n`);
});

test('🔴 E — 2 ประตูนี้ต้องตอบ "ชุดเดียวกัน" (user เคาะ 29/10) ห้าม drift เงียบ', () => {
  /* 🔁 **เปลี่ยนเจตนาแล้ว 29/10 — คำสั่ง user: "ให้เห็นส่วนงานตัวเองทุกจอ"**
     เดิมด่านนี้ล็อกว่า 2 ตัว "ตั้งใจให้ต่างกัน":
       scopedLines()     = ไลน์ที่ **เห็น**       → ครอบครัว ∪ ส่วนงาน
       scopedLineNames() = ไลน์ที่ **รับผิดชอบ** → ครอบครัวล้วน
     แต่ไล่ผู้เรียกจริงแล้ว 22 จอที่เรียก scopedLineNames **ส่วนใหญ่เป็นจอดู/รายงาน**
     (TvBoard · Obeya · ObeyaKpiBoard · ObeyaSqdcmBoard · DeptDashboard · ScrapReport ·
      QualityControl · QualityBins · QaCheckSheet · MachineDatabase · DieRegistry · LineStock …)
     ⇒ เหตุผลเดิมไม่ตรงกับการใช้งาน · วัดแล้วว่าความต่างนี้คือต้นเหตุของอาการที่หน้างานแจ้งซ้ำ
       *"เห็นของทุกไลน์ แต่เปิดกะเลือกไลน์ตัวเองไม่ได้"*  ⇒ ถาม user แล้ว user สั่งให้ยุบ
     🔴 ด่านนี้จึงกลับด้าน: **ต้องตรงกัน** · จะแยกกลับเป็น 2 ท่าอีก = ต้องถาม user ใหม่ */
  const leaders = REG.profiles.filter(p => p.role === 'leader' && p.line_id
    && effOf(p).length && lines.some(l => String(l.id) === String(p.line_id)));
  assert.ok(leaders.length >= 3, `ทะเบียนมีหัวหน้ากลุ่มที่ผูกไลน์+มี anchor น้อยผิดปกติ (${leaders.length})`);

  const bad = [];
  for (const p of leaders) {
    const args = { role: p.role, lineId: p.line_id, sections: effOf(p), lines };
    const byObj = visOf(p).slice().sort();
    const n = scopedLineNames(args);
    const byName = (n === null ? lines.map(l => l.name) : n).slice().sort();
    if (JSON.stringify(byObj) !== JSON.stringify(byName)) {
      bad.push(`${tag(p)}\n      ตัวไลน์: ${byObj.join(' · ')}\n      ชื่อไลน์: ${byName.join(' · ')}`);
    }
    // ครอบครัวไลน์ตัวเองต้องอยู่ในชุดเสมอ (ตาข่ายเดิม ห้ามหาย)
    const me = lines.find(l => String(l.id) === String(p.line_id));
    for (const f of getLineFamilyNames(lines, me.name)) {
      if (!byName.includes(f)) bad.push(`${tag(p)}\n      ขาดไลน์ในครอบครัวตัวเอง: ${f}`);
    }
  }
  assert.deepEqual(bad, [], `\n2 ประตูตอบไม่ตรงกัน ${bad.length} ราย:\n  ${bad.join('\n  ')}\n`);
});
