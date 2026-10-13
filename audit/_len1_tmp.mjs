import { chromium } from 'playwright';
const JOBS = JSON.parse(process.env.JOBS || '[["ProgramUpdate","60"]]');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const [name, tab] of JOBS) {
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, timezoneId: 'Asia/Bangkok' });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 140)));
  await p.goto(`http://localhost:5199/audit/index.html?p=${name}&role=admin`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1800);
  let where = 'หน้าแรก';
  if (tab) { const l = p.locator('header button, main button').filter({ hasText: tab }).first(); if (await l.count()) { await l.click({ timeout: 1500 }).catch(()=>{}); await p.waitForTimeout(1300); where = `แท็บ ${tab}`; } }
  const h = await p.evaluate(() => document.body.scrollHeight);
  console.log(`${name} · ${where} — ${h}px = ${(h / 1080).toFixed(2)} เท่า${errs.length ? ' ⚠ ' + errs[0] : ''}`);
  if (process.env.SHOT) await p.screenshot({ path: `${process.env.SHOT}-${name}.png` });
  await p.close();
}
await b.close();
