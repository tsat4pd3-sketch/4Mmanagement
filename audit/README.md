# audit/ — เครื่องมือวัด layout มือถือของจริง (ไม่ใช้เดา)

เรนเดอร์ **ทุกหน้าใน `src/pages/`** ด้วยเบราว์เซอร์จริงที่ขนาดจอมือถือ แล้ววัดว่ามีอะไรล้น/เล็กเกิน/พัง
โดย **ไม่ต้อง login** — ใช้ `mockSupabase.js` ยิงข้อมูลปลอมแทน Supabase ทั้ง 2 project

> เกิดจากงาน 2026-08-04 (หัวหน้างานกดปุ่มบันทึกไม่ได้) — ก่อนหน้านั้น audit ทำได้แค่ grep
> ซึ่งจับ "grid ไม่ยอมหด" ไม่ได้เลย ต้องวัดจากเบราว์เซอร์เท่านั้น

## ใช้ยังไง

```bash
npx vite --config audit/vite.audit.mjs        # เปิดที่ :5199
# แล้วเปิด http://localhost:5199/audit/index.html?p=DailyReport
```
`?p=<ชื่อไฟล์ใน src/pages ไม่ต้องมี .jsx>` เช่น `?p=Checkin`

**หน้าที่ต้องส่ง props ถึงจะเรนเดอร์จริง มี harness แยก** (main.jsx mount แบบ `<C/>` ไม่ส่ง props):

| URL | วัดอะไร |
|---|---|
| `?p=__sidebar` | sidebar แบบ D (rail + แผงลอย) — `window.__setPin(true/false)` สลับปักหมุด |
| `hub.html[?role=admin]` | หน้า Home (DeptHub) — นับการ์ด/ชิป/แถว ⭐ · seed `localStorage['nav_recent_v1']` เพื่อทดสอบ "ใช้บ่อย" |

> ⚠️ harness ไม่มีตาราง `role_permissions` → เมนูโผล่ครบเฉพาะ `role=admin` (โค้ด bypass ให้ admin)
> role อื่นจะเห็นการ์ดว่าง — เป็นข้อจำกัดของ harness ไม่ใช่บั๊กของหน้า

กวาดทั้งโปรเจค (60 หน้า × 3 ความกว้าง × กดปุ่ม/แท็บ) — ใช้เวลา ~10 นาที:
```bash
npm i -D playwright   # ครั้งแรกเท่านั้น (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 ใช้ chromium ที่มีอยู่)
node audit/sweep.mjs  # ต้องเปิด vite audit ค้างไว้ก่อน
```
`audit/probe.js` = **ตัวตรวจ "ล้นจอจริง"** ใช้ร่วมทุกสคริปต์ — pattern ที่ใช้จริง:

| วัดอะไร | วิธี |
|---|---|
| ล้นแนวนอน | `right > innerWidth` + ตัด false positive 3 แบบ (ดูด้านล่าง) → เอา element ที่พ่อไม่ได้ล้น = ต้นเหตุจริง |
| layout ขยับจากการแก้ CSS | **A/B ในหน้าเดียวกัน**: จับกล่องทุก element → inject CSS ปิด fix → จับใหม่ → เทียบ |
| noise ของหน้าเอง | จับ 2 ครั้งติดโดยไม่แตะอะไร — หน้าที่มีอนิเมชัน/เวลา (Dashboard, OEEAnalytics) ขยับเองตลอด |
| ปุ่มกดยาก | `elementFromPoint(cx, cy-17)` ยังโดนปุ่มไหม (จำลองนิ้วกว้าง ~34px) |

## กับดักที่ต้องรู้

- **ต้องเทียบกับ noise เสมอ** — Dashboard/OEEAnalytics ขยับเองหลายร้อยจุดต่อการเรนเดอร์
  ถ้าไม่มี control จะสรุปผิดว่า CSS ทำพัง (พลาดมาแล้ว 2 รอบ)
- **ต้องตัด false positive 3 แบบ ไม่งั้นไล่แก้ของที่ไม่ได้พัง** (`audit/probe.js` ทำให้แล้ว):
  1. อยู่ใน `<svg>` — svg clip ลูกเองอยู่แล้ว (GroupOverview เคยขึ้นเตือน 15 ตัว = ไม่จริง)
  2. มีบรรพบุรุษที่ `overflow:hidden` **และตัวมันเองอยู่ในจอ** — คือ ellipsis ที่ตั้งใจตัด
     (MorningMeeting/MtnMachineLayout เคยขึ้นเตือน = ไม่จริง ข้อความมี ellipsis อยู่แล้ว)
  3. มีบรรพบุรุษที่เลื่อนข้างเองได้ — มี scroller ของตัวเอง = ตั้งใจ
  **⚠️ แต่ห้ามนับ `main`/`body` เป็น "คนตัดที่ถูกต้อง"** — `main{overflow-x:hidden}` ตัดของที่ล้นจริง
  ซึ่งคือสิ่งที่เรากำลังตามหา ถ้านับด้วยจะได้ผล "สะอาดปลอม" ทุกหน้า (พลาดมาแล้ว)
- **ตัวเลื่อนของหน้าคือ `<body>` ไม่ใช่ `<html>`** (`html,body{height:100%}` + `overflow-x:hidden`)
  → `document.scrollingElement` คืน `<html>` ซึ่ง **ไม่เลื่อน** ต้องไล่หาตัวที่ `scrollHeight > clientHeight`
- mock คืนแถวปลอม 14 แถวเหมือนกันทุกตาราง — พอสำหรับวัด layout **แต่ไม่ใช่การเทส business logic**
- ถ้าหน้าไหน CRASH ใน harness ให้เช็คก่อนว่าเป็น "mock ไม่มีคอลัมน์นั้น" หรือ **โค้ดไม่ได้กัน null จริง**
  (รอบแรกเจอของจริง 3 จุด: `.slice()` บน `due_date`/`period_month` ที่เป็น null แล้วทำหน้าขาวทั้งหน้า)

## ไฟล์

- `index.html` + `main.jsx` — ตัวโหลดหน้าเดี่ยว (มี ErrorBoundary + จำลอง `<main>` แบบเดียวกับแอปจริง)
- `mockSupabase.js` — client ปลอม (chainable + คืน `ROWS` 14 แถว) · เพิ่มคอลัมน์ใน `ROW()` ได้ตามต้องการ
- `probe.js` — ตัวตรวจ "ล้นจอจริง" (ตัด false positive 3 แบบข้างบน) · **ใช้ตัวนี้ตัวเดียว ห้ามเขียนใหม่**
- `sweep.mjs` — กวาดทุกหน้า × 320/360/390px × กดปุ่ม แล้วรายงานจุดที่ล้นพร้อม style ที่เป็นต้นเหตุ
- `vite.audit.mjs` — alias `../supabaseClient` → mock · **ไม่กระทบ `npm run build` ปกติ**
