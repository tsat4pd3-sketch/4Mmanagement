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
- หลัก · เริ่ม 2026-11-27 22:19 · ปรับหน้าออกแบบใบงาน e-Workflow ให้ใช้ง่าย (ซ่อนช่องเทคนิค · พรีวิวผู้รับงาน · ผู้อนุมัติภาษาคน · จัดลำดับ 4 ขั้น · ช่อง Cost Center / หลายเครื่อง) · แตะ: `src/pages/WorkflowDesigner.jsx` `src/utils/wfSchema.js` `src/components/WfFormFields.jsx` `docs/modules/e-workflow.md` · migration: function `wf_check_data` + ใหม่ `wf_preview_step` (Main)

## ต้องคุยกัน

## บันทึก (ใหม่อยู่บนสุด)

- 2026-11-28 · smf01 · กลยุทธ์ PDF ทุกกิจกรรม: ของกลาง `src/components/StrategyBook.jsx` (e-book) · `src/utils/useStrategySetting.jsx` (อัปโหลด/เปลี่ยน/ลบ) · `src/utils/strategyPdf.js` (ตรวจ 16:9 · ≤5 หน้า · ≤20 MB) · +`pdfjs-dist` 6.5.438 (โหลดแบบ lazy) · กิจกรรมอื่น Dashboard = กลยุทธ์ · ภาพรวม / Setting = กลยุทธ์ (`Activity.jsx` · `ACTIVITIES[].code`) · 5S Setting: ถอด "เกณฑ์ผ่าน" ใส่ "กลยุทธ์" (ค่าเกณฑ์เดิมยังอยู่ในฐาน) · เส้นใต้ Detail Bar เฉพาะช่วงแท็บ ไม่ลากใต้ Tool Bar · UPLOAD_SITES +1 · ไม่มี migration (ใช้ act_strategy/act-public เดิม)
- 2026-11-28 · smf01 · 5S Setting ทีม: ช่องพนักงานเลือกจากทะเบียน `employees` ผ่าน `<PersonSelect>` (เติมรหัส + ชื่อให้ · ห้ามพิมพ์ชื่อลอย) · ปุ่ม "คัดลอกจากปีที่แล้ว" (คนที่ใช้งานของปีก่อน · คนที่มีแล้วข้าม · ถามยืนยันพร้อมจำนวน) · ⚠️ ทีม 2026: 29/63 คนยังไม่อยู่ในทะเบียน employees ของ ESM (แถวเดิมใช้ได้ แต่เพิ่มใหม่ต้องมีในทะเบียนก่อน) · ไฟล์หลัก `src/pages/activity5s/*` · ปุ่มจางบอกเหตุผล + จอบอก "ดูอย่างเดียว" เมื่อไม่มีสิทธิ์ · migration `20261128_act02_5s_perm_manager.sql` (role manager ได้ `act_5s:manage` · ลงแล้วผ่าน MCP · คำสั่ง user)
- 2026-11-28 · smf01 · Tool Bar: ปุ่มรีเฟรชหมุน 1 รอบทุกครั้งที่กด (ทุกหน้า) · ปุ่ม 🔍 พิมพ์ลงช่องค้นหาที่ซ่อนได้ (`data-tool-search`) · 5S: เอาช่องค้นหาในหน้าออก (ใช้ปุ่ม 🔍) · toast "รีเฟรชข้อมูลแล้ว" เมื่อโหลดเสร็จ · หน้า flush ขอบล่าง 10px + ตารางชิดก้นจอ (ช่องล่าง 44 → 18px) · ไฟล์หลัก `src/components/PageHeader.jsx` `src/index.css` `src/pages/activity5s/*` · ไม่มี migration
- 2026-11-28 · smf01 · `.app-sheet` ตัดเส้นขอบล่าง/ขวา + มุมโค้ง (ทุกหน้า) · 5S Dashboard อันดับ/ผู้ตรวจ/แผนงาน: ตารางยืดถึงก้นจอด้วย `useFitHeight` (วัดจริง ทุกขนาดจอ · แถวเติมให้เส้นคอลัมน์ลากถึงล่าง · หน้าไม่เลื่อนเอง) · ไฟล์หลัก `src/index.css` `src/pages/activity5s/Dashboard.jsx` · ไม่มี migration
- 2026-11-28 · smf01 · หัวเพจ std จอคอม: แท็บ Detail Bar ขนาด sm · ตัดเส้นใต้ทั้งแถว · Tool Bar ชิดขวาสุด (หมวดค้างทั้งก้อน) · ตัวกรอง 5S เล็กลง · ของกลางใหม่ `src/components/StdBarChart.jsx` กราฟแท่งมาตรฐานแบบ Core (UI §6.9.0) ใช้ใน 5S ภาพรวม · ไม่มี migration
- 2026-11-28 · smf01 · หน้ากิจกรรมหัวเพจกลับเป็น 2 แถวแบบ Core (ถอดแบบแถวเดียวออกจาก PageHeader) · 5S Dashboard ภาพรวม: ไทล์ + กราฟ + ตารางลงกริด 5 คอลัมน์ชุดเดียว (กราฟกว้าง 3 · ตาราง 2) ⇒ ขอบตารางตรงไทล์ · ตารางสูงเท่ากราฟ · ไฟล์หลัก `src/components/PageHeader.jsx` `src/pages/activity5s/Dashboard.jsx` `docs/UI-CONVENTIONS.md` · ไม่มี migration
- 2026-11-28 · smf01 · หน้ากิจกรรม: หัวเพจแถวเดียว (ชื่อ+breadcrumb+Detail Bar+Tool Bar · สูง 76 → 38px) · `.app-sheet` ตัดเส้นขอบบน ชิดขอบจอ (ทุกหน้า) · 5S Dashboard: ตัดพื้นการ์ดนอก · แท่งกราฟ/วงโดนัทสีอ่อนลง (เติมโปร่ง + ขอบทึบ) · ไฟล์หลัก `src/components/PageHeader.jsx` `src/index.css` `src/pages/activity5s/*` `docs/UI-CONVENTIONS.md` · ไม่มี migration
- 2026-11-27 · หลัก · แท็บ "ภาพรวมวันนี้" `/oee-analytics`: การ์ดกะเลิกเหลือที่ว่างกลางใบ (`space-between` + กล่องข้อความยืด/หดได้) · **ไม่ได้เจาะไลน์ = โชว์ผังรวมโรงงาน** ผ่าน `<FactoryMiniMap>` (ข้อมูลกรอบชุดเดียวกับ `/factory-map`) ระบายสีตาม OEE วันนี้รายไลน์ · กดกรอบ = เจาะเข้าผังเครื่องจักรของไลน์นั้น · เพิ่ม prop `height` (optional) ให้ `FactoryMiniMap` — ไม่ส่ง = พฤติกรรมเดิมเป๊ะ (TV/Andon/ManpowerBoard ไม่กระทบ) · ไฟล์หลัก `src/pages/OEEAnalytics.jsx` `src/components/FactoryMiniMap.jsx` `docs/modules/oee.md` · ไม่มี migration
- 2026-11-27 · หลัก · แก้ข้อความบนจอที่ผิด 3 จุด (RFQ: ส่ง CRD ไม่แจ้ง IEC ต้องกด "ส่งให้ IEC ประเมิน" · คัมบัง: ชี้ Stock Management › รับของเข้าคลัง / ตั้งค่า › กฎรับเข้า · DailyReport: ตกลง/ยกเลิก) + sync เอกสาร 19 ไฟล์ใน docs/modules กับโค้ด + ตัวตรวจ WI ค้นบนข้อความที่จอโชว์/ไฟล์ของเล่ม/ตาม lazy import · ไฟล์หลัก `src/utils/mktRfq.js` `src/pages/Rfq.jsx` `src/pages/HeijunkaKanban.jsx` `src/pages/DailyReport.jsx` `src/i18n/en.js` `docs/wi/kit/wi_check.mjs` `docs/modules/*.md` · ไม่มี migration
- 2026-11-27 · smf01 · Sub bar: แถวหัวของเมนูที่มีข้อย่อย (กิจกรรม 9 ตัว + หน้าที่มีแท็บทุกหน้า) = ปุ่มพับ ลูกศรอยู่หน้าชื่อแทนไอคอน · กดชื่อ = ซ่อน/ขยาย ไม่เด้งหน้า (เข้าหน้าผ่านข้อย่อย) · ไฟล์หลัก `src/App.jsx` (navRow/subNav) `src/index.css` `docs/UI-CONVENTIONS.md` §6.8.1 · ไม่มี migration
- 2026-11-27 · smf01 · 5S รอบ 2: Dashboard 6 ส่วน (กลยุทธ์ · ภาพรวม · อันดับ · ผู้ตรวจ · แผนงาน · ทีม) ยกสูตรจาก Core · ข้อมูลไม่พอ = จอบอก (ไม่โชว์ 0) · หัวเพจ std จอคอม: ชื่อหน้า + breadcrumb แถวเดียว (สูง 114 → 76px · ทุกหน้า std) · ไฟล์หลัก `src/pages/activity5s/Dashboard.jsx` `dash.js` `src/components/PageHeader.jsx` `docs/UI-CONVENTIONS.md` · ไม่มี migration (ประวัติใบตรวจ/แผนงานนำเข้าจาก Core ด้วย SQL ที่ user รัน) · ⚠️ harness `audit/vite.audit.mjs`: alias ข้อแรก `(^|/)../supabaseClient` กิน `../../supabaseClient` ก่อนข้อ 2 ⇒ หน้าในโฟลเดอร์ย่อยโหลดไม่ขึ้นใน harness (ไม่ได้แก้ — ของ loop หลัก)
- 2026-11-27 · หลัก · แท็บ "ภาพรวมวันนี้" `/oee-analytics` แถวการ์ดบนสุดเหลือ **2 ใบ** (ยุบการ์ด "ยอดผลิตรวมวันนี้" เข้าไปเป็นท่อนล่างของการ์ด "กะที่กำลังผลิตอยู่ตอนนี้" · ผังไลน์ได้ที่กว้างขึ้น) + **เลิกเลือกไลน์ให้เองเงียบๆ**: กรองไลน์ไว้ = ตามตัวกรอง · ไม่ได้กรอง = ช่องเลือกบนการ์ด (ค่าเริ่มต้นว่าง + เขียนบนจอว่าผังเป็นของไลน์เดียว) · ไฟล์หลัก `src/pages/OEEAnalytics.jsx` `docs/modules/oee.md` · ไม่มี migration
- 2026-11-27 · หลัก · รอบตรวจคู่มือ WI รายสัปดาห์ 27/11 — ทำใหม่ทั้ง 6 เล่ม (ps/prod/wh/mtn/qa/eng) + เลื่อน base เป็น f19f9137 · ไฟล์หลัก `docs/wi/books/**` `docs/wi/books.json` · ไม่แตะ src/ · ไม่มี migration
- 2026-11-27 · หลัก · audit harness หา path รีโปจากตำแหน่งไฟล์เอง (เลิก hardcode `/home/user/4Mmanagement`) — รองรับรีโปเปลี่ยนชื่อเป็น `ESM` และเครื่อง smf01 · ตรวจแล้ว: index/alias mock/virtual:schema-usage ตรงกับก่อนแก้ · ไฟล์หลัก `audit/vite.audit.mjs` · ไม่มี migration
- 2026-11-27 · หลัก · แท็บ "ภาพรวมวันนี้" `/oee-analytics` แถวการ์ดบนสุดเป็น 3 ใบ (ย่อการ์ดกะที่กำลังผลิต · การ์ดยอดผลิตเลื่อนซ้าย · ที่ว่างขวา = **ผังเครื่องจักรของไลน์ที่เลือก** ผ่านของกลาง `<LineLensMap>` เลนส์ `breakdown`) · ไลน์ = ช่องกรองไลน์ → ไม่กรอง = ไลน์ของกะที่การ์ดซ้ายโชว์ · ชี้ไลน์ไม่ได้ = กลับเป็น 2 คอลัมน์ · ไฟล์หลัก `src/pages/OEEAnalytics.jsx` `docs/modules/oee.md` · ไม่มี migration
- 2026-11-27 · smf01 · 5S (ยกจากระบบ Core) รอบ 1 · ตาราง `act_activity` (act01–act09 ตามเมนู) · `act_strategy` · `act02_*` 9 ตาราง + วิว `act02_audit_group` · bucket `act-public` · สิทธิ์ `act_5s:manage` (หมวดคุณภาพ & วิศวกรรม — nav_groups ไม่มีหมวดกิจกรรม) · ข้อมูลปี 2026: พื้นที่ 34 · ทีม 86 · หัวข้อตรวจ 25 · แผนตรวจ 102 · หน้าใหม่ `src/pages/activity5s/**` (route /activity-5s ใน App.jsx แยกจาก Activity.jsx) · Setting: พื้นที่ · ทีม · หัวข้อตรวจ · แผนตรวจ · เกณฑ์ผ่าน · Dashboard / Edit Data = รอบ 2 · คนในทีมเก็บรหัส + ชื่อ (ไม่ FK employees: 28/62 คนไม่อยู่ใน employees) · migration `20261127_act02_5s_main.sql` `20261127b_act02_5s_seed_main.sql` (ลงแล้วผ่าน MCP)
- 2026-11-27 · หลัก · ของที่คนกรอกค้างชนะการรีโหลด (หน้างานแจ้ง "จอชอบรีเฟรชระหว่างลงข้อมูล") + หน้าต่าง deploy ผูก `break_policies`/`company_calendar` + ร่างฟอร์มใน localStorage · ไฟล์หลัก `src/utils/pendingInput.js` `src/utils/useFormDraft.js` `src/components/DraftBar.jsx` `src/main.jsx` `src/pages/MtnRepair.jsx` `.github/workflows/scheduled-deploy.yml` · ไม่มี migration
- 2026-11-27 · หลัก · แก้ด่าน `new-table-needs-rls` ให้อ่าน "เปิด RLS เป็นลูป dynamic SQL" ได้ — `20261127_act02_5s_main.sql` ของ smf01 **ถูกต้องอยู่แล้ว** (RLS + policy + GRANT + trigger ครบ 11 ตาราง · ตรวจ DB แล้ว `relrowsecurity=true` ทุกตัว) แต่ด่าน regex ต่อตารางมองไม่เห็น ⇒ `npm run build` บน main แดงอยู่ · แก้ที่ด่าน (`src/utils/__tests__/regressionGuards.test.mjs`) **ไม่แตะ migration ที่ smf01 จองไว้** · กฎไม่ผ่อน: ต้องมีทั้งคำสั่งเปิด RLS แบบ dynamic และชื่อตารางอยู่ในลิสต์ของลูป

- 2026-11-27 · smf01 · เริ่มระบบจองงาน 2 loop (ไฟล์นี้ + หัวข้อสั้นใน CLAUDE.md)
