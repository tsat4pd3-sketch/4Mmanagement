import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const VIEWS = ['unified', 'chart', 'board', 'pull', 'demand']
for (const v of VIEWS) {
  const p = await b.newPage({ viewport: { width: 1500, height: 900 }, timezoneId: 'Asia/Bangkok' })
  await p.goto(`http://localhost:5199/audit/index.html?p=HeijunkaKanban&role=admin&view=${v}`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(1800)
  const r = await p.evaluate(() => {
    const vis = el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 }
    const hits = [...document.querySelectorAll('button,input,select,a[href],[role="button"]')].filter(vis)
    const small = hits.filter(el => { const b = el.getBoundingClientRect(); return b.height < 40 || b.width < 40 })
    const tiny  = hits.filter(el => { const b = el.getBoundingClientRect(); return b.height < 28 })
    const cb    = [...document.querySelectorAll('input[type=checkbox]')].filter(vis)
                   .map(el => { const b = el.getBoundingClientRect(); return Math.round(Math.min(b.width, b.height)) })
    const imgs  = [...document.querySelectorAll('img')].filter(vis)
                   .map(el => { const b = el.getBoundingClientRect(); return Math.round(Math.min(b.width, b.height)) })
    // กล่องรูป (PartThumb) รวมตัวที่ยังไม่มีรูป
    const thumbs = [...document.querySelectorAll('div')].filter(el => {
      const b = el.getBoundingClientRect()
      return vis(el) && Math.abs(b.width - b.height) < 3 && b.width >= 20 && b.width <= 90 && getComputedStyle(el).overflow === 'hidden'
    }).map(el => Math.round(el.getBoundingClientRect().width))
    const fonts = hits.map(el => parseFloat(getComputedStyle(el).fontSize)).filter(Boolean)
    const doc = document.scrollingElement.scrollHeight > innerHeight ? document.scrollingElement : document.body
    // ปุ่มคำสั่งหลักตัวแรก (ที่ทำงานจริง ไม่ใช่แท็บ/ตัวกรอง)
    const act = [...document.querySelectorAll('button')].find(el => /เริ่มเตรียม|ยืนยัน|จ่าย|สร้างใบส่ง|สั่งซื้อ|รับ/.test(el.textContent))
    return {
      hits: hits.length, small: small.length, tiny: tiny.length,
      cbMin: cb.length ? Math.min(...cb) : null, cbN: cb.length,
      imgMin: imgs.length ? Math.min(...imgs) : null,
      thumbMin: thumbs.length ? Math.min(...thumbs) : null, thumbN: thumbs.length,
      fontMin: fonts.length ? Math.min(...fonts) : null,
      fontUnder12: fonts.filter(f => f < 12).length,
      pageH: doc.scrollHeight, viewH: innerHeight,
      firstActionY: act ? Math.round(act.getBoundingClientRect().top + (doc.scrollTop || 0)) : null,
      firstActionText: act ? act.textContent.trim().slice(0, 28) : null,
    }
  })
  console.log(v.padEnd(9), JSON.stringify(r))
  await p.close()
}
await b.close()
