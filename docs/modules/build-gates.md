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

## ด่าน context (2026-09-03 · เพิ่มกฎรับเข้า 2026-10-05)
CLAUDE.md เคยโต + มี `@import` จนกิน context 550k tokens ต่อ session
(ต้นเหตุจริงคือ `@path` ไม่ใช่ขนาดไฟล์) → `scripts/check-claude-md-size.mjs` เป็นขั้นแรกของ build

**05/10 เพิ่ม 3 ข้อ (4-6) เพราะเพดานขนาดอย่างเดียวไม่อยู่** — 30/09 รีดลงเหลือ 103.8 KB แล้ว
**โตกลับ 16 KB เต็มใน 2 วันทำการ** (กฎ "ห้ามใส่ประวัติ/ผลรันจริง" มีอยู่แล้วแต่ไม่มีใครตรวจ):
| # | ตรวจ | ผล |
|---|---|---|
| 4 | หัวข้อ `##` เกิน **9 KB** | ล่ม |
| 5 | บล็อกกฎ 🔴 ที่ไม่มี `path`/`fn()` บอกว่ากฎอยู่ไฟล์ไหน | ล่ม |
| 6 | เกิน **110 KB** → พิมพ์หัวข้อใหญ่สุด + จำนวนบรรทัดที่ย้ายได้ | เตือน |

🔴 **ห้ามขยายเพดาน (120 KB รวม / 9 KB ต่อหัวข้อ) เพื่อให้ build ผ่าน — ให้รีดเนื้อหา**
· ข้อ 5 กันคลาสบั๊ก "กฎไม่บอกว่าสูตรอยู่ไหน ⇒ session ถัดไปเขียนสูตรซ้ำในหน้า"
· 📄 กฎรับเข้า 4 ข้อ + รายการพร้อมรีด → `docs/modules/claude-md-slim.md` §รอบ 2

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

---

## ฉบับเต็มของหัวข้อด่าน+QC agent ที่เคยอยู่ใน CLAUDE.md (ย้ายมา 2026-09-30)

CLAUDE.md เหลือ "คำสั่งที่ต้องรัน + กฎห้าม" ของแต่ละด่าน — คำอธิบาย/เคสจริงเต็มอยู่ข้างบนไฟล์นี้แล้ว
ส่วนข้างล่างคือข้อความเดิมทั้งดุ้น (กันข้อความหาย):

## กฎการทำงานของทุก AI session (Workflow Discipline)

ลำดับที่ต้องทำทุกครั้ง ไม่ว่าจะแก้อะไร:
1. **เช็คกฎก่อนลงมือ** — อ่าน section ที่เกี่ยวข้องใน CLAUDE.md นี้ + `docs/modules/<module>.md` ของโมดูลที่แตะ + เอกสารเฉพาะทาง:
   - **ทุกงาน → `docs/ENGINEERING-PRINCIPLES.md`** (หลักการแก้แบบยั่งยืน + checklist ก่อน commit/merge)
   - แก้ UI → `docs/UI-CONVENTIONS.md` (บังคับ)
   - แตะสิทธิ์/role → `docs/PERMISSIONS-DESIGN.md`
   - แตะ DB → section "Supabase Projects" (2 projects!) + เขียน migration ลง `supabase/migrations/` เสมอ
2. **ทำงานให้สอดคล้องกับกฎ** — ถ้าสิ่งที่จะทำขัดกับ convention เดิม ให้ทำตาม convention ก่อน เว้นแต่ user สั่งเปลี่ยน (แล้วต้องไล่แก้ทุกจุดที่ใช้ pattern นั้นให้ตรงกัน)
3. **อัพเดทกฎหลังทำ** — งานที่สร้าง/เปลี่ยน pattern, schema, สิทธิ์, หรือ workflow ที่ session อื่นต้องรู้ → อัพเดทเอกสารที่เกี่ยวข้อง (`docs/modules/<module>.md` เป็นหลัก / UI-CONVENTIONS.md / PERMISSIONS-DESIGN.md / CLAUDE.md เฉพาะกฎข้าม session) **ในคอมมิทเดียวกัน** พร้อมวันที่
4. build ผ่าน (`npm run build`) ก่อน commit เสมอ · merge เข้า `main` = deploy จริง
   - **⚠️ `npm run build` = `check:context` → `lint:critical` → `npm test` → `vite build`**
     · ตัวรันเทส = `scripts/run-tests.mjs` ไล่หา `src/**/__tests__/*.test.mjs` เอง — **วางไฟล์เทสใหม่ใน
     `__tests__/` ที่ไหนก็ได้ใต้ src/ แล้วถูกเก็บอัตโนมัติ ไม่ต้องแก้ script**
     · **ห้ามเปลี่ยนเป็น `node --test '<glob>'` ใน package.json** (glob ต้อง node v22 · Render อาจใช้ 20 ⇒ deploy ล่มทั้งที่โค้ดไม่ผิด)
     · **⏱️ `npm test` รัน 2 รอบ: ปกติ + "นาฬิกา +400 วัน"** จับ **เทสระเบิดเวลา** (ผ่านตอนเขียน แล้วตกเองวันหลัง
     โดยไม่มี commit ไหนทำ ⇒ หาต้นเหตุไม่เจอ) · **กฎ: ฟังก์ชันที่กินเวลาปัจจุบันต้องรับ `now` เป็นพารามิเตอร์
     แล้วเทสตรึงค่า** — ตกรอบนี้ให้แก้เทส **ห้ามถอดรอบนี้ออกจาก `scripts/run-tests.mjs`**
     · 📄 ที่มาของแต่ละด่าน + เคสจริง → `docs/modules/build-gates.md`
   - **🛡️ ด่าน "บั๊กเก่าห้ามกลับมา" = `src/utils/__tests__/regressionGuards.test.mjs`** (2026-09-16 · คำสั่ง user
     *"ปัญหาที่เคยแก้เคยเกิด ไม่ควรเกิดซ้ำ"*) — สแกนทั้งรีโปบังคับกฎที่**เคยพังจริง** (ตกด่าน = build ล่ม
     พร้อมบอกบรรทัด + บั๊กที่เคยเกิด + วิธีแก้) · **เจอบั๊กคลาสใหม่ที่คนถัดไปน่าจะพลาดซ้ำ → เพิ่มกฎที่ไฟล์นี้
     ในคอมมิทเดียวกับที่แก้บั๊ก** (กติกา/ทะเบียนกฎอยู่หัวไฟล์ — ใส่เฉพาะกฎที่ grep ได้แม่น ห้ามใส่กฎจุกจิก)
   - **ด่าน lint กฎ crash** — `eslint.critical.config.js` เช็คเฉพาะกฎที่ทำแอปพังตอน runtime (`no-undef` ฯลฯ)
     ที่ bundler ไม่จับ · lint ไม่ผ่าน = build ไม่ผ่าน **ห้าม bypass ด้วย `vite build` ตรงๆ**
     · **ห้ามเพิ่มกฎ style จุกจิกใน config นี้** (ทำให้คนอยาก bypass ด่านที่กันของพังจริง)
     - **⚠️ build ผ่าน ≠ หน้าไม่พัง — merge งานหลาย session ชนกันในไฟล์เดียว ให้รัน `node audit/crashsweep.mjs` เสมอ**
     (เปิดทุกหน้าที่ 1500px + กดปุ่มบนหัวเพจทีละอัน แล้วเช็ค `window.__crash` ~3 นาที · ต้องเปิด vite audit ค้างไว้)
     · 🔴 **แถวพิเศษใน mock ห้ามถอด** (`NULLISH` · ชั้น OP · ไลน์แม่-ลูก 3 ชั้น · แถว KPI `manual`+`auto:`
     · แถวเอกสารที่ออกเลขที่ใบแล้ว) — แต่ละตัวเปิดโค้ดทั้งคลาสที่ไม่งั้น**ไม่เคยถูกรันใน harness เลย**
     · เพิ่มคอลัมน์ nullable ใน `ROW()` ต้องเติมใน `NULLISH()` ด้วย · เหตุผลรายตัว → `audit/README.md`
     - **📱 `node audit/mobilesweep.mjs` — ทุกหน้าที่ 390px** จับ sticky ค้างทับเนื้อหา · ของล้นแล้วปัดดูไม่ได้ ·
     ข้อความถูกบีบเหลือกว้าง 0 (`docs/UI-CONVENTIONS.md` §มือถือ)
     · **แตะ layout ที่มี `isMobile` หรือ `position:sticky` ต้องรันตัวนี้ก่อน merge**
   - **`react-hooks/rules-of-hooks` เปิดในด่านนี้แล้ว** — จับ hook ที่วางหลัง early return / ใน if / ใน loop = React #310 (จอ error ทั้งหน้า) ที่ build ธรรมดาไม่เห็น · **กฎเหล็ก: hook ทุกตัวต้องอยู่บนสุดของ component ก่อน early return เสมอ** — เจอ error นี้ตอน build ให้ย้าย hook ขึ้น **ห้าม disable กฎ**

### QC Agent — ตรวจโค้ดขัดกฎโปรเจค (2026-07-10)

- **Agent:** `.claude/agents/qc-project-rules.md` (subagent_type: `qc-project-rules`, read-only — ห้ามแก้โค้ด)
  มี checklist กฎ 7 หมวด: A Date/Time · B Supabase 2 projects · C Permissions · D Section scoping ·
  E Storage/รูป · F UI Conventions · G Workflow/เอกสาร — แต่ละข้อ map กลับมาที่ CLAUDE.md /
  docs/UI-CONVENTIONS.md / docs/PERMISSIONS-DESIGN.md (checklist เป็นแค่แผนที่ ตัว agent ต้องอ่านเอกสารจริงก่อนตรวจเสมอ)
- **Slash command:** `/qc-audit` (`.claude/commands/qc-audit.md`) — ไม่มี argument = ตรวจทุกหมวดทั้งโปรเจค
  (fan-out 4 subagents ขนาน), ระบุหมวด (`/qc-audit B D`) หรือไฟล์ (`/qc-audit src/pages/X.jsx`) ได้
- รายงานแบ่ง 🔴 ขัดกฎเหล็ก / 🟡 ขัด convention / 🔵 legacy-ข้อสังเกต / ✅ ผ่าน พร้อม file:line + วิธีแก้
- **เมื่อเพิ่ม/เปลี่ยนกฎใน CLAUDE.md หรือ docs/** ที่ตรวจอัตโนมัติได้ → อัพเดท checklist ใน
  `.claude/agents/qc-project-rules.md` ในคอมมิทเดียวกันด้วย ไม่งั้น QC agent จะตรวจไม่ครบ
- แนะนำรัน `/qc-audit` ก่อน merge งานใหญ่เข้า main และรันเต็มเป็นระยะเพื่อจับ drift ระหว่าง session ขนาน

> 📄 **ประวัติผล audit ที่ตรวจ+แก้ไปแล้ว → `docs/modules/qc-audit-history.md`**
> (รอบเต็ม 2026-08-03/04 ครบ 7 หมวด · วิธี audit "migration ค้างไม่ได้ apply" ที่เชื่อถือได้ 2026-08-06)
