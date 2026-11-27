# จองงาน ESM (2 loop) · เริ่ม 2026-11-27

ESM มีคนทำงาน 2 loop พร้อมกัน → **ต้องจองงานในไฟล์นี้ก่อนลงมือทุกครั้ง** กันแก้ไฟล์ / ตาราง / หน้าเดียวกันชนกัน

| loop | ใคร | ทำงานจาก |
|---|---|---|
| **หลัก** | เจ้าของ ESM (Claude Code on the web · branch สุ่มชื่อ) | `claude/*` → merge เข้า `main` |
| **smf01** | ผู้ช่วยพัฒนา ESM (Claude Code ในเครื่อง · บัญชี GitHub `tsat4smf01`) | `smf01/*` → merge เข้า `main` |

## ขั้นตอน (ทุก session ทั้ง 2 loop)
1. **ก่อนเริ่ม:** `git fetch origin && git checkout -B <branch> origin/main` · อ่านหัวข้อ "กำลังทำอยู่" ด้านล่าง
2. **จอง:** เพิ่ม 1 บรรทัดใน "กำลังทำอยู่" แล้ว commit + push **เข้า `main` ทันที** (commit เล็ก ข้อความ `CLAIM: <loop> <งาน>`) — จองใน branch ตัวเองไม่นับ อีก loop มองไม่เห็น
   `- <loop> · เริ่ม YYYY-MM-DD HH:MM · <งาน> · แตะ: <ไฟล์ / หน้า / ตาราง / view / function>`
3. **ห้ามแตะ** ไฟล์ · หน้า · ตาราง · view · function · RLS ที่อีก loop จองอยู่ · ต้องใช้ร่วม = เขียนขอใน "ต้องคุยกัน" แล้วรอ
4. **ไฟล์ใช้ร่วม** (`src/App.jsx` · เมนู / route · `src/supabaseClient.js` · `src/lib/**` · `CLAUDE.md` · `package.json`): แก้ให้น้อยที่สุด · `git pull --rebase origin main` ก่อน push ทุกครั้ง
5. **migration:** ใส่ชื่อตาราง / view ที่แก้ในบรรทัดจอง · ชื่อไฟล์ขึ้นต้นวันที่ + ชื่อเรื่อง (แบบเดิม) ไม่ซ้ำกับของอีก loop
6. **เสร็จ:** ลบบรรทัดจองของตัวเอง + เพิ่ม 1 บรรทัดใน "บันทึก" (ใหม่อยู่บนสุด: วันที่ · loop · ทำอะไร · ไฟล์หลัก · migration) แล้ว push เข้า `main`
7. **จองค้างเกิน 24 ชม.** ไม่มี commit ใหม่ = ถามเจ้าของ loop นั้นก่อน ห้ามลบของคนอื่นเอง
8. กฎ build / auto-merge / rollback เดิมใน `CLAUDE.md` §Branch & Deploy Workflow ใช้ทั้ง 2 loop

## กำลังทำอยู่

<!-- - <loop> · เริ่ม YYYY-MM-DD HH:MM · <งาน> · แตะ: <ไฟล์ / หน้า / ตาราง> -->
- หลัก · เริ่ม 2026-11-27 15:20 · จัดแถวการ์ดแท็บ "ภาพรวมวันนี้" ของ /oee-analytics (ย่อการ์ดกะที่กำลังผลิต · ขยับการ์ดยอดผลิต · เติมผังไลน์ที่เลือกในที่ว่างขวา) · แตะ: `src/pages/OEEAnalytics.jsx` (เฉพาะแท็บ today) · อาจ import ของกลางผังไลน์แบบอ่านอย่างเดียว · ไม่มี migration ไม่แตะ DB

## ต้องคุยกัน

## บันทึก (ใหม่อยู่บนสุด)

- 2026-11-27 · smf01 · 5S (ยกจากระบบ Core) รอบ 1 · ตาราง `act_activity` (act01–act09 ตามเมนู) · `act_strategy` · `act02_*` 9 ตาราง + วิว `act02_audit_group` · bucket `act-public` · สิทธิ์ `act_5s:manage` (หมวดคุณภาพ & วิศวกรรม — nav_groups ไม่มีหมวดกิจกรรม) · ข้อมูลปี 2026: พื้นที่ 34 · ทีม 86 · หัวข้อตรวจ 25 · แผนตรวจ 102 · หน้าใหม่ `src/pages/activity5s/**` (route /activity-5s ใน App.jsx แยกจาก Activity.jsx) · Setting: พื้นที่ · ทีม · หัวข้อตรวจ · แผนตรวจ · เกณฑ์ผ่าน · Dashboard / Edit Data = รอบ 2 · คนในทีมเก็บรหัส + ชื่อ (ไม่ FK employees: 28/62 คนไม่อยู่ใน employees) · migration `20261127_act02_5s_main.sql` `20261127b_act02_5s_seed_main.sql` (ลงแล้วผ่าน MCP)
- 2026-11-27 · หลัก · ของที่คนกรอกค้างชนะการรีโหลด (หน้างานแจ้ง "จอชอบรีเฟรชระหว่างลงข้อมูล") + หน้าต่าง deploy ผูก `break_policies`/`company_calendar` + ร่างฟอร์มใน localStorage · ไฟล์หลัก `src/utils/pendingInput.js` `src/utils/useFormDraft.js` `src/components/DraftBar.jsx` `src/main.jsx` `src/pages/MtnRepair.jsx` `.github/workflows/scheduled-deploy.yml` · ไม่มี migration
- 2026-11-27 · หลัก · แก้ด่าน `new-table-needs-rls` ให้อ่าน "เปิด RLS เป็นลูป dynamic SQL" ได้ — `20261127_act02_5s_main.sql` ของ smf01 **ถูกต้องอยู่แล้ว** (RLS + policy + GRANT + trigger ครบ 11 ตาราง · ตรวจ DB แล้ว `relrowsecurity=true` ทุกตัว) แต่ด่าน regex ต่อตารางมองไม่เห็น ⇒ `npm run build` บน main แดงอยู่ · แก้ที่ด่าน (`src/utils/__tests__/regressionGuards.test.mjs`) **ไม่แตะ migration ที่ smf01 จองไว้** · กฎไม่ผ่อน: ต้องมีทั้งคำสั่งเปิด RLS แบบ dynamic และชื่อตารางอยู่ในลิสต์ของลูป

- 2026-11-27 · smf01 · เริ่มระบบจองงาน 2 loop (ไฟล์นี้ + หัวข้อสั้นใน CLAUDE.md)
