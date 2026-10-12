import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage({ viewport: { width: 1500, height: 1100 }, timezoneId: 'Asia/Bangkok' })
const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0,200)))
await p.goto(process.argv[2], { waitUntil: 'networkidle' }); await p.waitForTimeout(2500)
// เปิดฟอร์มแก้ไขแถวแรก เพื่อให้เห็นช่องแนบรูป
const edit = p.locator('button[title="แก้ไข"]').first()
if (await edit.count()) { await edit.click(); await p.waitForTimeout(1500) }
await p.screenshot({ path: process.argv[3], fullPage: true })
console.log('errors:', errs.length ? errs.slice(0,3) : 'none')
console.log((await p.locator('body').innerText()).replace(/\n{2,}/g,'\n').slice(0, 1600))
await b.close()
