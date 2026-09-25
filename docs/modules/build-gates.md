# ด่านใน `npm run build` — ที่มาของแต่ละด่าน + เคสจริงที่ทำให้ต้องมี

> กฎอยู่ใน `CLAUDE.md` §Workflow Discipline ข้อ 4 — ไฟล์นี้เก็บ**ประวัติ/เคสจริง** ที่เคยอยู่ใน CLAUDE.md
> แล้วทำให้ไฟล์ชนเพดาน 120 KB (ย้ายออก 2026-09-25 · ตัวกฎไม่ถูกตัดแม้แต่ข้อเดียว)

ลำดับด่าน: `check:context` → `lint:critical` → `npm test` → `vite build`

## `npm test` เข้าด่าน (2026-08-24)
ก่อนหน้านั้นมีไฟล์เทส **9 ไฟล์ / 51 เคส** ที่เอกสารอ้างว่า "ล็อกไว้แล้ว" แต่ **ไม่มี script ไหนรันมันเลย**
→ เทสที่เขียนไว้กันของพัง ไม่เคยถูกเรียกใช้จริงถ้าไม่มีคนพิมพ์คำสั่งเอง (พบตอน QC audit)

## รอบ "นาฬิกา +400 วัน" (2026-09-14) — เทสระเบิดเวลา
เกิดจริง: เทส `pullSignal` นับจำนวน warning ของไฟล์ตัวอย่างที่ลงวันที่ 08/09 — พอโค้ดเพิ่มคำเตือน
"ไฟล์เก่ากว่าวันนี้เกิน 3 วัน" เทสก็ **ตกเองตั้งแต่ 12/09** ⇒ build ล่ม deploy ไม่ออก
และ **หา commit ต้นเหตุไม่เจอเพราะไม่มี commit ไหนทำ**

## ด่าน context (2026-09-03)
CLAUDE.md เคยโต + มี `@import` จนกิน context 550k tokens ต่อ session
(ต้นเหตุจริงคือ `@path` ไม่ใช่ขนาดไฟล์) → `scripts/check-claude-md-size.mjs` เป็นขั้นแรกของ build

## ด่าน lint กฎ crash (2026-07-24)
เคสจริง: ใช้ `useMemo` โดยไม่ import → **Daily Report จอขาวทั้งโรงงาน** (bundler ไม่จับ)

## `react-hooks/rules-of-hooks` (2026-07-30)
เคสจริงที่ทำให้เปิดกฎ: `MtnRepair` (`useMemo` หลัง `if (loading) return`) ทำหน้าแจ้งซ่อม crash
+ `ProtectedLayout` (`if (!session) return` ก่อน `useAutoLogout`/`useState`)

## `crashsweep.mjs` (2026-08-26)
เคสจริงที่ **build/lint/เทสผ่านหมดแต่หน้าพัง**: resolve conflict แล้วบรรทัด `setSelSession` หลุด
→ Daily Report จอหลักว่างทั้งหน้า · `/products` แท็บ Kanban Std พังจาก `undefined.toLocaleString()`
รายละเอียด + เหตุผลของแถวพิเศษใน mock รายตัว → `audit/README.md`

## `mobilesweep.mjs` (2026-09-16)
จับ 3 อาการที่ build/lint/เทส/crashsweep ผ่านหมดแต่ใช้งานจริงไม่ได้ที่ 390px
