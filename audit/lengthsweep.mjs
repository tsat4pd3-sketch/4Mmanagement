/* length-sweep — วัดว่าหน้าไหน "ยาวเกินจอ" กี่เท่า (2026-09-25 · คำสั่ง user)
   *"ออดิททั้งหมดที มันมีหน้าไหน เลื่อนได้แบบเยอะมากๆมั้ย แบบ ยาว 2 เท่าของจอคอมนี้ก็ยาวเกินไปแล้วนะ"*

   ทำไมต้องมีเครื่องมือนี้:
   - หน้าที่ไม่ใช่จอมอนิเตอร์ **เลื่อนได้** (user อนุญาต) แต่ "เลื่อนได้" ≠ "ยาวเท่าไหร่ก็ได้"
   - ยาวเกิน 2 เท่าของจอ = คนหาของไม่เจอ ต้องเลื่อนหลายรอบกว่าจะเห็นครบ
   - build/lint/เทส/crashsweep/mobilesweep **จับไม่ได้เลย** เพราะหน้าไม่ได้พัง แค่ยาว

   วัดที่ 1920×1080 (จอ PC หน้างาน) · role=admin (ไม่งั้นครึ่งหน้าไม่โผล่ ดู crashsweep)
   วัดทั้ง "มุมมองแรก" และ "ทุกแท็บบนหัวเพจ" แล้วเอาค่ามากสุด — แท็บที่ยาวสุดคือตัวปัญหา

   เกณฑ์: 🔴 ≥ 2.0 เท่า = ยาวเกินไป · 🟡 1.5-2.0 = เฝ้าดู · ✅ < 1.5 = โอเค
   ปรับได้: BAD=2.5 WARN=1.8 node audit/lengthsweep.mjs
*/
import { chromium } from 'playwright';

const TZ = { timezoneId: 'Asia/Bangkok' };
const VW = Number(process.env.VW || 1920);
const VH = Number(process.env.VH || 1080);
const BAD = Number(process.env.BAD || 2.0);
const WARN = Number(process.env.WARN || 1.5);
const TAB_CAP = Number(process.env.TAB_CAP || 8);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p0 = await b.newPage({ ...TZ });
await p0.goto('http://localhost:5199/audit/index.html');
await p0.waitForTimeout(1200);
const PAGES = await p0.evaluate(() => window.__PAGES);
await p0.close();

const measure = (p) => p.evaluate(() => ({
  h: document.body.scrollHeight,
  vh: window.innerHeight,
}));

const rows = [];
for (const name of PAGES) {
  const p = await b.newPage({ viewport: { width: VW, height: VH }, ...TZ });
  let worst = { ratio: 0, h: 0, where: 'หน้าแรก' };
  try {
    await p.goto(`http://localhost:5199/audit/index.html?p=${name}&role=admin`,
      { waitUntil: 'domcontentloaded', timeout: 20000 });
    await p.waitForTimeout(1300);
    const m = await measure(p);
    worst = { ratio: m.h / m.vh, h: m.h, where: 'หน้าแรก' };

    /* แท็บบนหัวเพจ — แท็บที่ยาวสุดคือตัวปัญหา ไม่ใช่แท็บแรกเสมอไป
       ⚠️ ต้องหา element ใหม่ทุกรอบ (กดแล้วหน้า re-render = handle เดิม detach) — กับดักเดียวกับ crashsweep */
    const labels = [];
    for (const btn of await p.$$('header button, main > div button')) {
      const t = ((await btn.textContent()) || '').trim().slice(0, 24);
      if (t && t.length > 1 && !labels.includes(t)) labels.push(t);
      if (labels.length >= TAB_CAP) break;
    }
    for (const label of labels) {
      try {
        const loc = p.locator('header button, main > div button').filter({ hasText: label }).first();
        if (!(await loc.count())) continue;
        await loc.click({ timeout: 800 });
        await p.waitForTimeout(900);
        const mm = await measure(p);
        const r = mm.h / mm.vh;
        if (r > worst.ratio) worst = { ratio: r, h: mm.h, where: `แท็บ "${label}"` };
      } catch { /* กดไม่ติด = ข้าม */ }
    }
  } catch (e) {
    worst = { ratio: 0, h: 0, where: 'โหลดไม่ขึ้น: ' + String(e).slice(0, 60) };
  }
  rows.push({ name, ...worst });
  await p.close();
}
await b.close();

rows.sort((a, c) => c.ratio - a.ratio);
const bad = rows.filter(r => r.ratio >= BAD);
const warn = rows.filter(r => r.ratio >= WARN && r.ratio < BAD);

const line = (r) => `   ${r.ratio.toFixed(2)} เท่า (${r.h}px)  ${r.name}  — ${r.where}`;
console.log(`\n📏 วัดความยาวหน้าที่ ${VW}×${VH} · ${rows.length} หน้า\n`);
console.log(`🔴 ยาวเกิน ${BAD} เท่า — ยาวเกินไป (${bad.length} หน้า)`);
bad.forEach(r => console.log(line(r)));
console.log(`\n🟡 ${WARN}-${BAD} เท่า — เฝ้าดู (${warn.length} หน้า)`);
warn.forEach(r => console.log(line(r)));
console.log(`\n✅ ไม่เกิน ${WARN} เท่า: ${rows.length - bad.length - warn.length} หน้า`);
if (bad.length) console.log('\nหน้าที่ 🔴 ควรแก้: ยุบส่วนที่ซ้ำ · พับคำอธิบายด้วย <InfoMore> · แบ่งแท็บ · หรือทำเป็นบอร์ดแบ่งหน้า (UI §6.23)');
