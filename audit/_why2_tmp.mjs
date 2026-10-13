import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, timezoneId: 'Asia/Bangkok' });
await p.goto('http://localhost:5199/audit/index.html?p=NotificationConfig&role=admin', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2000);
const r = await p.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('main *')) {
    const h = el.getBoundingClientRect().height;
    if (h < 1500) continue;
    out.push({ h: Math.round(h), kids: el.children.length, tag: el.tagName,
      txt: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 70) });
  }
  out.sort((a, c) => c.h - a.h);
  const pick = [];
  for (const x of out) { if (pick.some(y => Math.abs(y.h - x.h) < 30)) continue; pick.push(x); if (pick.length >= 6) break; }
  return pick;
});
r.forEach(x => console.log(`${x.h}px · ${x.tag} ลูก ${x.kids} | "${x.txt}"`));
await b.close();
