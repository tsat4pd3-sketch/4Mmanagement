/* desktop-diff — พิสูจน์ว่า "จอคอมไม่เปลี่ยนแม้แต่พิกเซลเดียว" (2026-10-15 · คำสั่ง user)
   งานมือถือ (handheld) ห้ามกระทบ UX/UI จอคอม ⇒ ถ่ายทุกหน้า × ทุกแท็บ ที่ 1500×900 จาก 2 เวอร์ชัน
   แล้วเทียบทีละพิกเซล · เวลาถูกตรึง + ปิด animation ทั้งคู่ (ไม่งั้นนาฬิกา/เส้น "ตอนนี้" ต่างกันเอง)

   เตรียม: เวอร์ชันฐาน (ก่อนแก้) เปิดที่ :5198 — ใช้ git worktree ของ commit ฐาน + config ที่ชี้ root/พอร์ตใหม่
     git worktree add /tmp/base <sha> && ln -s $PWD/node_modules /tmp/base/node_modules
     sed -e "s#$PWD#/tmp/base#g" -e s/5199/5198/ audit/vite.audit.mjs > /tmp/base/audit/vite.base.mjs
     (cd /tmp/base && npx vite --config audit/vite.base.mjs)       # ฐาน :5198
     npx vite --config audit/vite.audit.mjs                         # ปัจจุบัน :5199
     node audit/desktopdiff.mjs                                     # ONLY=Checkin,DailyReport ได้
   ผล: หน้าที่ต่าง > 0 พิกเซล พร้อมรูปคู่ที่ OUT_DIR (default /tmp/desktopdiff) */
import { chromium } from 'playwright'
import fs from 'fs'
import { execFileSync } from 'child_process'

const VIEW = { width: Number(process.env.W || 1500), height: Number(process.env.H || 900) }
const OUT = process.env.OUT_DIR || '/tmp/desktopdiff'
const BASE = process.env.BASE || 'http://localhost:5198'
const CUR = process.env.CUR || 'http://localhost:5199'
const FIXED = new Date('2026-10-14T10:30:00+07:00')
fs.mkdirSync(OUT, { recursive: true })

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p0 = await b.newPage(); await p0.goto(`${CUR}/audit/index.html`); await p0.waitForTimeout(1200)
const ONLY = (process.env.ONLY || '').split(',').map(s => s.trim()).filter(Boolean)
const PAGES = ONLY.length ? ONLY : await p0.evaluate(() => window.__PAGES); await p0.close()

const KILL = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'
async function shoot(origin, name, tabIdx) {
  const p = await b.newPage({ viewport: VIEW, timezoneId: 'Asia/Bangkok', reducedMotion: 'reduce' })
  await p.clock.install({ time: FIXED })
  /* สุ่มแบบตรึงเมล็ด — บางหน้าสุ่มค่าโดยตั้งใจ (operator: pickUnusedColor สุ่มสีตัวอย่าง) ⇒ 2 ฝั่งได้สีต่างกันเอง = ผลบวกปลอม */
  await p.addInitScript(() => { let x = 42; Math.random = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648) })
  await p.goto(`${origin}/audit/index.html?p=${name}&role=admin`, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await p.clock.runFor(1500); await p.waitForTimeout(900)
  await p.addStyleTag({ content: KILL })
  const tabs = await p.$$eval('[data-tabbar] button', bs => bs.map(x => (x.textContent || '').trim().slice(0, 30)))
  if (tabIdx != null && tabs[tabIdx]) {
    await p.locator('[data-tabbar] button').filter({ hasText: tabs[tabIdx] }).first().click().catch(() => {})
    await p.clock.runFor(800); await p.waitForTimeout(700)
  }
  const f = `${OUT}/${name}_${tabIdx ?? 0}_${origin === BASE ? 'base' : 'cur'}.png`
  await p.screenshot({ path: f, fullPage: true })
  await p.close()
  return { f, tabs }
}

const diffs = []
let views = 0
for (const name of PAGES) {
  try {
    const first = await shoot(CUR, name, null)
    const n = Math.max(1, first.tabs.length)
    for (let t = 0; t < n; t++) {
      // ทั้ง 2 ฝั่งต้องทำเหมือนกันเป๊ะ (คลิกแท็บทั้งคู่) — ไม่งั้นแสงของแท็บที่ถูกคลิกต่างกันเองเป็นผลบวกปลอม
      const cur = first.tabs.length ? await shoot(CUR, name, t) : first
      const base = await shoot(BASE, name, first.tabs.length ? t : null)
      views++
      const px = Number(execFileSync('python3', ['-c', `
from PIL import Image, ImageChops
a=Image.open('${base.f}').convert('RGB'); b=Image.open('${cur.f}').convert('RGB')
if a.size!=b.size: print(-1)
else:
  d=ImageChops.difference(a,b).convert('L').point(lambda v:255 if v>8 else 0)
  print(d.histogram()[255])`]).toString().trim())
      if (px !== 0) diffs.push({ name, tab: first.tabs[t] || '(หน้าเดียว)', px })
    }
  } catch (e) { diffs.push({ name, tab: '?', px: `error ${String(e).slice(0, 60)}` }) }
  process.stdout.write('.')
}
await b.close()
console.log(`\nเทียบ ${PAGES.length} หน้า / ${views} มุมมอง @${VIEW.width}×${VIEW.height} — ต่าง ${diffs.length} มุมมอง`)
diffs.forEach(d => console.log(`🔴 ${d.name} [${d.tab}] ${d.px === -1 ? 'ความสูงหน้าเปลี่ยน' : d.px + ' px'}`))
process.exit(diffs.length ? 1 : 0)
