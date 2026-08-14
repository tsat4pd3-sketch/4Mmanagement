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

สคริปต์วัดผล (playwright) เขียนไว้ชั่วคราวใน scratchpad ของ session — pattern ที่ใช้จริง:

| วัดอะไร | วิธี |
|---|---|
| ล้นแนวนอน | หา element ที่ `getBoundingClientRect().right > 390` **และไม่มีบรรพบุรุษที่ `overflow-x:auto`** |
| layout ขยับจากการแก้ CSS | **A/B ในหน้าเดียวกัน**: จับกล่องทุก element → inject CSS ปิด fix → จับใหม่ → เทียบ |
| noise ของหน้าเอง | จับ 2 ครั้งติดโดยไม่แตะอะไร — หน้าที่มีอนิเมชัน/เวลา (Dashboard, OEEAnalytics) ขยับเองตลอด |
| ปุ่มกดยาก | `elementFromPoint(cx, cy-17)` ยังโดนปุ่มไหม (จำลองนิ้วกว้าง ~34px) |

## กับดักที่ต้องรู้

- **ต้องเทียบกับ noise เสมอ** — Dashboard/OEEAnalytics ขยับเองหลายร้อยจุดต่อการเรนเดอร์
  ถ้าไม่มี control จะสรุปผิดว่า CSS ทำพัง (พลาดมาแล้ว 2 รอบ)
- **SVG ข้างในล้นได้ปกติ** — `<svg>` clip ลูกอยู่แล้ว ให้ดูที่กล่องของ `<svg>` เอง ไม่ใช่ `path`/`rect`
  (GroupOverview ขึ้นเตือน 15 ตัวทุกครั้ง = false positive)
- **ตัวเลื่อนของหน้าคือ `<body>` ไม่ใช่ `<html>`** (`html,body{height:100%}` + `overflow-x:hidden`)
  → `document.scrollingElement` คืน `<html>` ซึ่ง **ไม่เลื่อน** ต้องไล่หาตัวที่ `scrollHeight > clientHeight`
- mock คืนแถวปลอม 14 แถวเหมือนกันทุกตาราง — พอสำหรับวัด layout **แต่ไม่ใช่การเทส business logic**
- ถ้าหน้าไหน CRASH ใน harness ให้เช็คก่อนว่าเป็น "mock ไม่มีคอลัมน์นั้น" หรือ **โค้ดไม่ได้กัน null จริง**
  (รอบแรกเจอของจริง 3 จุด: `.slice()` บน `due_date`/`period_month` ที่เป็น null แล้วทำหน้าขาวทั้งหน้า)

## ไฟล์

- `index.html` + `main.jsx` — ตัวโหลดหน้าเดี่ยว (มี ErrorBoundary + จำลอง `<main>` แบบเดียวกับแอปจริง)
- `mockSupabase.js` — client ปลอม (chainable + คืน `ROWS` 14 แถว) · เพิ่มคอลัมน์ใน `ROW()` ได้ตามต้องการ
- `vite.audit.mjs` — alias `../supabaseClient` → mock · **ไม่กระทบ `npm run build` ปกติ**
