# รีด CLAUDE.md ให้มีที่ว่าง (2026-09-30) — ย้ายอะไรไปไหน

## ทำไม

`CLAUDE.md` ชน **119.8 / 120 KB** (เหลือ 0.2 KB) ⇒ session ถัดไปที่เพิ่มกฎ 1 ย่อหน้าจะทำให้
`npm run check:context` ตก = **build ล่ม deploy ไม่ออกทั้งระบบ** โดยที่โค้ดไม่ผิดอะไรเลย
(และคนถัดไปจะหาสาเหตุไม่เจอ เพราะ commit ที่ทำให้ตกคือ commit ที่ "แค่เขียนเอกสาร")

**ผล: 119.8 → 103.8 KB (เหลือที่ว่าง ~16 KB)**

## หลักที่ใช้ตัดสินว่าอะไรอยู่ CLAUDE.md อะไรย้ายออก

| อยู่ใน CLAUDE.md | ย้ายไป `docs/modules/` |
|---|---|
| **กฎ** ("ห้าม…" / "ต้อง…") + **ชื่อ helper/ไฟล์ที่ต้องใช้** | คำอธิบายว่าทำไม · เคสจริง · ตัวเลขที่วัดได้ |
| คำสั่งที่ต้องรัน (`node audit/crashsweep.mjs`) | ที่มาของด่าน · ประวัติ |
| หัวข้อของกฎทุกข้อ (ครบ ห้ามตัดข้อไหนหาย) | ตัวอย่างโค้ด ✅/❌ · ผังโฟลเดอร์ |

🔴 **กติกา: ตัด "เหตุผล" ได้ ตัด "กฎ" ไม่ได้** — ทุกครั้งที่ย้าย ต้องเหลือบรรทัดชี้ทางใน CLAUDE.md
(`📄 … → docs/modules/<file>.md`) ไม่งั้นความรู้หายจากสายตา session ถัดไป

## ย้ายอะไรไปไหน

| เดิมใน CLAUDE.md | ปลายทาง | เหลืออะไรไว้ |
|---|---|---|
| §File Structure — ผังโฟลเดอร์ทั้งดุ้น (~5 KB) | `docs/modules/file-structure.md` | 8 บรรทัด: App.jsx = source of truth เมนู · main.jsx guard ห้ามถอด · 2 clients · utils = กฎกลาง · migrations · docs บังคับอ่าน + 📌 ห้ามหยิบ design ไปทำเอง · บล็อก SCADA (กฎเหล็ก) |
| §Patterns — ตัวอย่างโค้ด Date/Time + คำอธิบายยาวของกฎเขียน DB 11 ข้อ | `docs/modules/date-time-rules.md` · `docs/modules/db-write-rules.md` | กฎครบ 11 ข้อ (หัวข้อ + สิ่งที่ต้องทำ) · ชื่อฟังก์ชันวันที่ครบ |
| §Design System — เหตุผลของกฎ CSS | ย่อในที่เดิม + ชี้ `docs/UI-CONVENTIONS.md` §7 | ข้อห้ามทุกข้อ (`color-mix` ฯลฯ) + วิธีแทน + คำสั่งตรวจก่อน merge |
| §Workflow Discipline — คำอธิบายด่าน + QC agent | `docs/modules/build-gates.md` | คำสั่งรันทุกด่าน + กฎห้าม (ห้าม bypass · ห้ามถอดรอบ +400 วัน · ห้าม disable rules-of-hooks) |
| ขั้นตอน register `/doc-forms` (3 ข้อ) | `docs/modules/doc-forms.md` | กฎ "ต้อง register + ห้าม hardcode เลขฟอร์ม/โลโก้" |

## เช็คว่าไม่มีอะไรหาย

ทุกบล็อกที่ย้ายถูก **ก๊อปทั้งดุ้นแบบ verbatim** ลงไฟล์ปลายทางก่อนลบออกจาก CLAUDE.md
(ในไฟล์ปลายทางมีหัวข้อ "ของเดิมจาก CLAUDE.md / ยกมาทั้งดุ้น") ⇒ ตรวจย้อนได้ด้วย
`git show <sha>:CLAUDE.md` เทียบกับไฟล์ใน `docs/modules/`

## ⚠️ ถ้าเพดานใกล้เต็มอีก

ตัวถัดไปที่ใหญ่สุดและย่อได้: §OBEYA (6.2 KB · กฎหนาแน่นมาก ย่อยากที่สุด — ระวัง) ·
§Shift Logic · §Database Schema · §Branch & Deploy Workflow
**ห้ามย่อ OBEYA/OEE โดยไม่อ่าน `docs/modules/obeya*.md` + `oee.md` ก่อน** — กฎ 2 ชุดนี้พังแล้วตัวเลขบนจอผิดเงียบ
