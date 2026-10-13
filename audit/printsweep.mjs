/* printsweep — เปิด "ใบพิมพ์" จากโค้ดจริงออกมาเป็น PNG/PDF (2026-10-13 · คำสั่ง user)

   ทำไมต้องมี:
   - ใบพิมพ์ (MO · ใบรายงานของเสีย ฯลฯ) ถูกประกอบเป็น HTML string แล้วยิงเข้า `window.open()` + `print()`
     ⇒ **ไม่มีทางเห็นหน้าตาใบเลยถ้าไม่ไปกดพิมพ์บนเครื่องจริง** · crashsweep ก็ข้ามปุ่มพิมพ์ทุกตัว
   - กฎ UI §6.14.3 "เปลี่ยน layout = ต้องเปิดดูจริงก่อน push" ใช้กับใบพิมพ์ไม่ได้มาก่อนหน้านี้
   - วัดก่อน-หลังได้ด้วย (ความสูงเนื้อใบ) ⇒ รู้ว่าที่แก้ไปดันใบไปหน้าที่ 2 หรือเปล่า

   วิธีทำงาน: เปิดหน้าใน harness → กดแถวในลิสต์ MO → กดปุ่มพิมพ์ → **ดักหน้าต่างที่เด้ง**
   (`context.on('page')`) → `pdf()` + `screenshot()` · `window.print` ถูก stub เป็น no-op ผ่าน
   `addInitScript` ไม่งั้นหน้าต่างจะค้างรอไดอะล็อกพิมพ์

   🔴 ได้ HTML จาก **โค้ดจริง** ไม่ใช่ template ที่ก๊อปมาวาดใหม่ — ถ้าก๊อปมา ใบที่ดูจะไม่ใช่ใบที่พิมพ์
   ⚠️ ข้อมูลเป็น mock (`audit/mockSupabase.js`) ⇒ จำนวนแถวอะไหล่/ค่าแรงเยอะกว่าใบจริง
      (ใบจริง 5 แถว) ความสูงที่วัดได้จึงใช้ **เทียบก่อน-หลังกันเอง** ห้ามเอาไปสรุปว่า "ใบจริงยาวเท่านี้"

   ใช้: เปิด `npx vite --config audit/vite.audit.mjs --port 5199` ค้างไว้ แล้ว
        `OUT=/tmp/mo node audit/printsweep.mjs`  → `<OUT>-mtn.png/.pdf` และ `<OUT>-jig.png/.pdf`
*/
import { chromium } from 'playwright';
const OUT = process.env.OUT || '/tmp/mo-print';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, timezoneId: 'Asia/Bangkok' });
await ctx.addInitScript(() => { window.print = () => {}; });
const p = await ctx.newPage();
await p.goto('http://localhost:5199/audit/index.html?p=MtnRepair&role=admin', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);

const closeDrawer = async (pg) => {
  const b = pg.locator('button').filter({ hasText: /^ปิด$/ }).first();
  if (await b.count()) await b.click({ timeout: 1200 }).catch(() => {});
  else await pg.keyboard.press('Escape');
  await pg.waitForTimeout(700);
};
const rows = await p.$$('tbody tr');
console.log('แถวในลิสต์:', rows.length);
const want = { mtn: 0, jig: 0 };
let got = 0;
for (let i = 0; i < Math.min(rows.length, 10) && got < 2; i++) {
  const tr = (await p.$$('tbody tr'))[i];
  if (!tr) continue;
  await tr.click().catch(() => {});
  await p.waitForTimeout(1200);
  const btn = p.locator('button').filter({ hasText: 'พิมพ์ / บันทึก PDF' }).first();
  if (!(await btn.count())) { await closeDrawer(p); continue; }
  const [pop] = await Promise.all([ ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null), btn.click() ]);
  if (!pop) { console.log(`แถว ${i}: ไม่มีหน้าต่างเด้ง`); await closeDrawer(p); continue; }
  await pop.waitForTimeout(1500);
  const isMtn = await pop.evaluate(() => document.body.innerText.includes('(ซ่อมบำรุง)'));
  const kind = isMtn ? 'mtn' : 'jig';
  if (want[kind]) { await pop.close(); await closeDrawer(p); continue; }
  want[kind] = 1; got++;
  const h = await pop.evaluate(() => document.body.scrollHeight);
  console.log('ความสูงเนื้อใบ (px @794 กว้าง):', h);
  await pop.pdf({ path: `${OUT}-${kind}.pdf`, format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' } });
  await pop.setViewportSize({ width: 794, height: 1123 });
  await pop.waitForTimeout(400);
  await pop.screenshot({ path: `${OUT}-${kind}.png`, fullPage: true });
  console.log(`✅ แถว ${i}: ฟอร์ม ${kind} → ${OUT}-${kind}.png`);
  await pop.close(); await closeDrawer(p); continue;
  await pop.close();
}
if (!got) console.log('❌ ไม่เจอใบเลย');
await b.close();
