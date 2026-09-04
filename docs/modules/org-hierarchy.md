# Organizational Hierarchy (Thai Summit Group)

> ย้ายมาจาก `CLAUDE.md` (2026-09-03 — แยกไฟล์เพื่อลด context) · โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน


ลำดับชั้นองค์กรที่สอดคล้องกันทั้งระบบ — **ห้ามเพิ่มฟีเจอร์ที่ขัดกับลำดับชั้นนี้**

> ### 📄 ผังองค์กรจริงของโรงงาน — ORG001_TSAT4_Overall **Rev.09** (user แนบไฟล์ให้ 2026-08-19)
> ผังจริงมี **3 ชั้น: ฝ่าย → ส่วน → แผนก/กลุ่ม** แต่ `org_nodes` ในระบบมีแค่ `section` → `department`
> (**ยังไม่มีชั้น "ฝ่าย"**) และ PD1–PD4 เป็นรหัสภายในของระบบ **ไม่ตรงกับชื่อ "ส่วน" ในผังจริง**
> ```
> HEAD OF SPG TSAT (ผู้อำนวยการ)
> └── ฝ่าย Steel Auto Office Plant 4 · 2140900002 · ผจก.ทั่วไป (G2)
>     ├── ฝ่าย Logistic and Sales · 2140320000
>     │   ├── ส่วน Log&Sales/Planning&Store · 21404290000 · ผจก.(M1)
>     │   └── ส่วน W/H&DEL/Rack Center · 214025000 · รก.ผจก.(S2)
>     ├── ฝ่าย Engineering · 2140340000
>     │   ├── ส่วน Quality Assurance · 2140441000 · ผจก.(M2)     ← **QA ไม่ใช่ฝ่ายแยก**
>     │   └── ส่วน Process Engineering · 2140446000 · รก.ผจก.(S1)
>     ├── ฝ่าย Production · 2140360000
>     │   ├── ส่วน Assembly 1 · 2140470000      ├── ส่วน Assembly 2 · 2140471000
>     │   ├── ส่วน Press Production · 2140461000 └── ส่วน Tooling MTN. · 2140459100
>     │   └── ส่วน Hydroforming · 2140462000
>     ├── (คอลัมน์ 4) └── ส่วน Maintenance · 2140456000 · รก.ผจก.(S1)
>     └── ฝ่าย สนับสนุนกลาง — ส่วนสนับสนุนบัญชี · HRM · **จัดซื้อ (2100414300)** · CIC · QSM
> ```
> - **งาน Warehouse / Delivery / Rack Center / Store / Planning / Sales อยู่ใต้ ฝ่าย Logistic and Sales ทั้งหมด**
>   → สายธารความต้องการเกือบทั้งสาย (ยกเว้นช่วงผลิต) เป็นของฝ่ายเดียว ใช้จัดกลุ่มใน `/flow-tower`
> - **ระบบยุบ 2 ส่วนของ Logistic เหลือ section เดียว `Planning&Store`** → บัญชีทั้ง 7 กองรวมกัน แยกสิทธิ์ตามงานจริงไม่ได้
>   (ตรวจ 2026-09-03: `Planning&Store` มี **0 แผนกย่อย** · 8 บัญชี — sale 6 · planner_store 1 · manager 1 — ยังเป็นช่องว่างอยู่)
> - **ฝ่ายสนับสนุนกลาง (รวมจัดซื้อ) ยังไม่ถูกขยายผลเข้าระบบเลย** — นอกขอบเขตรอบนี้ (user ยืนยัน 2026-08-19)
>
> ### 🔴🔴 กฎเหล็ก — **Warehouse ≠ Store** · Logistic แบ่ง 3 ฝั่ง (2026-09-03 · user สั่ง "จำไว้เลย")
> *"ข้อมูลที่เกี่ยวพันกับลูกค้า เป็น outbound ให้เป็นส่วน **Warehouse (ที่เก็บชิ้นส่วน FG 1XX)**, Delivery จัดการ
> ส่วนด้านที่เกี่ยวกับ **supplier ส่งชิ้นส่วน 3xx, raw material 5xx, ควบคุมชิ้นส่วนภายใน 2xx จะเป็น Store จัดการ**"*
>
> | ฝั่ง | แผนกที่ดูแล | เลข MAT | ตอบคำถาม |
> |---|---|---|---|
> | 📥 **ขาเข้า (Inbound)** | **Store** | **2xx** ผลิตเอง · **3xx** ซื้อนอก · **5xx** raw | ของเข้ามาครบไหม พอป้อนไลน์ไหม |
> | 📤 **ขาออก (Outbound)** | **Warehouse · Delivery · Rack Center** | **1xx** FG | ส่งลูกค้าทันไหม ของพอส่งไหม |
> | 🧭 **แผนงาน & ข้อมูล** | **Sales · Planner · Billing** | — (ไม่ถือของ) | ประสานข้อมูล ขาเข้า ↔ ผลิต ↔ ขาออก |
>
> - **🔴 "Warehouse" กับ "Store" เป็นคนละแผนก คนละฝั่ง คนละความรับผิดชอบ — ห้ามใช้สลับกันในโค้ด/จอ/เอกสาร**
>   Warehouse = ที่เก็บ **FG 1xx** รอส่งลูกค้า (ขาออก) · Store = คุม **2xx/3xx/5xx** (ขาเข้า)
>   ⚠️ ชื่อ location ในฐานข้อมูลสะกดว่า `FG WAREHOUSE` / `STORE` ซึ่งตรงกับการแบ่งนี้พอดี — อย่าอ่านสลับ
> - **นิยามฝั่ง + การจัดฝั่งจากเลข MAT อยู่ที่ `src/utils/logisticSide.js` จุดเดียว** (`SIDES` · `sideOfMat` ·
>   `sideMatches` · `splitBySide` · `matClassesOfSide`) ต่อยอดบน `matPrefix.js` — **ห้ามเขียนเกณฑ์แยกฝั่งซ้ำในหน้าใดๆ**
>   · ชิปกรอง = `src/components/SideFilterChips.jsx` (component กลาง) · เทสล็อกทิศทางไว้ที่
>   `src/utils/__tests__/logisticSide.test.mjs` (มีเคสกันเผลอสลับ Warehouse/Store โดยเฉพาะ)
> - **⚠️ "จัดฝั่งไม่ได้" ต้องเป็นคำตอบของตัวเอง ห้ามยัดเข้าฝั่งใดฝั่งหนึ่ง** — เลข **9xx** (เลขภายในที่ทีมตั้งเอง)
>   และ **เลขพาร์ทลูกค้า** (`MB3B-…` ที่ยังไม่ resolve เป็น MAT SAP) → `sideOfMat` คืน `null`
>   จอต้องโชว์ชิป ❔ **ไม่ระบุฝั่ง** พร้อมจำนวน (หลักเดียวกับ `coverage.unknown` ใน Delivery)
>   ข้อมูลจริง 2026-09-03: `line_stock_summary` 106 แถว = FG 16 · child 73 · raw 14 · **เลขลูกค้า 3**
> - **เมนูแยก 3 หมวดตามฝั่งแล้ว** (`Logistic - ขาเข้า (Inbound)` / `ขาออก (Outbound)` / `แผนงาน & ข้อมูล`)
>   — `NAV_GROUP_ORDER` + `NAV_GROUP_META` + `CARD_META` (DeptHub) + `PAGE_GROUPS` (/permissions)
>   + `permission_catalog.group_name/sort` (migration `20260903_permission_catalog_logistic_sides.sql` · **apply แล้ว**
>   · ซอย sort ในช่วง 5xx: ขาเข้า 500-519 · ขาออก 520-539 · แผนงาน 540-559) — **5 จุดนี้ต้องตรงกันเสมอ**
> - **`NAV_ITEMS[].alsoIn` = หน้าที่ทำงานคาบ 2 หมวด** (ตอนนี้มีตัวเดียว: `/store-monitor` จับทั้งขาเข้า-ขาออก)
>   sidebar + การ์ดหน้า Home โชว์ซ้ำ 2 ที่ผ่าน **`inNavGroup(item, groups)`** · แต่ **สิทธิ์/ค้นหา/breadcrumb/
>   ตัวนับ นับครั้งเดียวเสมอ** (1 หน้ามีสิทธิ์ชุดเดียว) — `PAGE_GROUPS` จึงใส่ที่หมวดหลักที่เดียว
> - **ยังไม่ทำ (ชั้น 3):** เพิ่ม 7 แผนกย่อยใต้ `Planning&Store` + ติดป้ายฝั่ง แล้วแยก scope/สิทธิ์จริง
>   ตอนนี้ทุกคนยังเห็นทุกหน้าเหมือนเดิม — การแยกที่ทำแล้วเป็นชั้น **เมนู + เนื้อในหน้า** เท่านั้น
> ### ⚠️ กฎเหล็ก — "ฝ่าย (Division)" เป็น **ป้ายที่ node** ไม่ใช่ชั้นใน tree (2026-08-18 · ย้ำอีกครั้ง 2026-08-19)
> ระบบมีกลไกฝ่ายอยู่แล้ว: ตาราง **`org_divisions`** (production/maintenance/quality/logistic/office)
> + คอลัมน์ **`org_nodes.division`** ติดป้ายที่ node ระดับบนสุด แล้ว**ลูกตกทอดขึ้นไปหา** (`divisionOfNode`)
> — หลักเดียวกับ `cost_center`/`head_name` ที่ไลน์ลูกตกทอดจากไลน์แม่
> - ติดป้ายแล้ว: PD1–PD4→production · Planning&Store→logistic · MTN/JIG MTN/DIE MTN→maintenance · QA→quality
> - ตั้งค่าที่ `/org-setup` (dropdown ฝ่ายในโมดัลแก้ไข section/department) · อ่านผ่าน **`src/utils/orgDivisions.js`**
>   (`loadDivisions`/`divisionsSync`/`divisionMeta`/`divisionLabel`/`divisionOfNode`/`divisionOfEmployee`)
> - **🔴 ห้ามเพิ่ม `kind='division'` เป็น node ชั้นใหม่ใน `org_nodes`** — จะพัง cascade section→department ทุกหน้า
>   และกลายเป็นแหล่งความจริงที่ 2 ของเรื่องเดียวกัน
>   **เคยพลาดจริง 2026-08-19:** ผมเพิ่ม node ชั้นฝ่าย + คอลัมน์ใน `/org-setup` + util ซ้อนอีกตัว
>   ทั้งที่ main ทำเสร็จแล้วคนละแบบ → ถอยออกทั้งหมด (migration `20260819_revert_org_division_level`)
>   **บทเรียน: ก่อนเพิ่มแนวคิดระดับ master ให้ `grep` หาของเดิมก่อนเสมอ — โปรเจคนี้มีหลาย session ทำขนานกัน**
> - หน้าที่อยากรู้ "ช่วงงานนี้เป็นของฝ่ายไหน" ให้อ้างด้วย **`code`** แล้วเอาชื่อ/สี/ไอคอนจาก util (เช่น `/flow-tower`)

> - **ห้ามสรุปจากชื่อ role ว่าใครอยู่ฝ่ายไหน** — ข้อมูลจริง: คนของ Logistic&Sales 7 บัญชีใช้ role `sale`
>   ส่วน `planner_store` มีบัญชีเดียว (อัจฉรา โสภาบุญ · +แอดมินหน่วยงาน) ที่เป็นคนลงข้อมูลให้เกือบทั้งฝ่าย


```
ระดับส่วน (Section)      → org_nodes.kind='section'  cost center 21404XXXX
  เช่น PD1, PD2, QA, MTN, JIG MTN, DIE MTN
      ↓
ระดับแผนก (Department)  → org_nodes.kind='department' cost center 21405XXXX
  เช่น HYDROFORM, ASSEMBLY
      ↓
ระดับกลุ่ม/ไลน์หลัก    → production_lines ที่ parent_line_name IS NULL
  เช่น HYDROFORM (parent), LINE APRON ASSY
      ↓
ระดับไลน์ผลิต           → production_lines ที่ parent_line_name SET
  เช่น HDF1, HDF2, LASER123, LASER456, LASER E50, LASER EXPORT
      ↓
ระดับ Team              → employees.team = 'A' | 'B' | 'C'
  A/B หมุนกะ | C กะเช้าตลอด
```

**กฎการ link ข้ามระดับ:**
- **แผนกที่ไม่ขึ้นกับ Section ใด (ขึ้นตรงฝ่าย) รองรับแล้ว (2026-07-13):** `org_nodes.kind='department'` ที่ `parent_id IS NULL` — สร้าง/ย้ายได้จาก OrgSetup (ตัวเลือก "🏛️ ขึ้นตรงฝ่าย" ในฟอร์ม + กลุ่ม "ขึ้นตรงฝ่าย" ในคอลัมน์ Section) · **ลงทะเบียนพนักงานในแผนกขึ้นตรงฝ่ายได้แล้ว (2026-08-06):** เดิม dropdown แผนกใน Register/operator เป็น cascade `d.parent_id === sectionNode.id` ตรงๆ → แผนกที่ `parent_id IS NULL` ไม่มีวันโผล่ = **ลงทะเบียนช่าง MTN/JIG MTN/DIE MTN ไม่ได้เลย** (เจอจริง: ผังมี 4 แผนกขึ้นตรงฝ่าย แต่ฟอร์มบังคับเลือก Section ก่อนถึงปลดล็อกแผนก) · แก้ด้วย **sentinel `ORPHAN_SECTION` ในช่อง Section** (helper รวมที่ `src/utils/sectionScope.js`: `ORPHAN_SECTION`/`ORPHAN_SECTION_LABEL`/`sectionValueForSave`/`sectionValueForEdit`/`orphanDepts`/`deptOptionsFor`/`deptNodeFor`) — เลือก "🏛️ ขึ้นตรงฝ่าย (ไม่มี Section)" → ช่องแผนกโชว์แผนก `parent_id IS NULL` · **บันทึกลง `employees.section` เป็น `null`** (ตรงผังจริง — **ห้ามยัดชื่อแผนกลง section เพื่อให้ cascade ผ่าน** จะกลายเป็น section ปลอมที่ไม่มีในผัง) · ตัวเลือกนี้เห็นเฉพาะ user ที่ไม่ถูกจำกัด scope (หัวหน้าราย section ลงทะเบียนคนนอกส่วนงานตัวเองไม่ได้) · **ผลข้างเคียงที่ตั้งใจ:** พนักงานกลุ่มนี้ section ว่าง → ไม่เข้า scope ของหัวหน้าที่จำกัดราย section (ถูกต้อง — ช่างไม่สังกัดส่วนงานผลิต) · การจับทีมช่าง/labor type ไม่กระทบเพราะ `teamForSection()` (mtnTeams.js) และ `laborTypeOf()` (laborType.js) เช็ค **department ก่อน** section อยู่แล้ว · **ข้อมูลเก่าที่กรอกชื่อแผนกซ้ำลง section** (ช่าง 14 คนที่ย้ายเข้าฐาน 2026-07-22 มี `section='MTN'` ทั้งที่ MTN เป็นแผนกไม่ใช่ส่วนงาน) → `sectionValueForEdit` โชว์เป็น sentinel ให้แก้ต่อได้ (เดิมช่องแผนกล็อกตาย) และ normalize เป็น null เมื่อเซฟทับ · **พนักงานฝ่ายผลิตยังต้องมี section เสมอเพื่อ scoping** (มีตัวเลือก Section ปกติให้เลือกเหมือนเดิม)
- `production_lines.section` = `org_nodes.code` ของ section
- `production_lines.parent_line_name` = `name` ของ production_line ระดับแผนก (เช่น 'HYDROFORM')
- Department name ใน org_nodes ต้องตรงกับ parent production_line name เพื่อให้ Register กรอง LINE dropdown ถูก
- Register.jsx กรอง LINE โดย: `l.name === department || l.parent_line_name === department`
- **Dropdown ลำดับชั้น (Section→แผนก→Line→Team) ทุกหน้าต้อง cascade + ล้างตัวลูกเมื่อเปลี่ยนตัวแม่** — กฎเต็มดู `docs/UI-CONVENTIONS.md` §5.3 (เพิ่ม 2026-07-21 หลังพบ Report 5 จุด + operator filter bar โชว์แผนกข้าม section)
- **⚠️ ตัวเลือก "ส่วนงาน" (section picker) ทุกหน้าต้องยึด `org_nodes` (kind='section') ไม่เดาจาก `production_lines.section`** — ลิสต์/ลำดับตามผัง แล้ว fallback เดาจาก production_lines เมื่อผังยังว่าง (backward-compat) · กรองด้วย `scopeSecs`/`inSectionScope` ทับเสมอ · หน้าที่ทำแล้ว: Report (ทุกแท็บ ผ่าน `useOrgSections`/`useOrgDepts` cascade แผนก 2026-07-21), Dashboard (`orgSections` 641), operator/Register/OJT (แผนก cascade), **ProductionPlan + MorningMeeting (section picker → org_nodes, 2026-07-24)** — เดิม 2 หน้านี้ derive `sectionOpts` จาก `scopedLines.map(l=>l.section)` ทำให้ลิสต์/ลำดับไม่ตรงผัง · หน้าใหม่ที่มี section picker ให้โหลด org_nodes แบบเดียวกัน
- **⚠️ `employees.department`/`section` เป็น free text ไม่ผูก FK กับ `org_nodes`** — data drift ได้ (เจอจริง: พนักงาน PD4 กรอก department ASSY/ASSY2/ทั่วไป แต่ผัง PD4 = GOR/LWRBAR) · dropdown แผนกใน `/operator` จึง cascade จาก `org_nodes` (แผนกใต้ section เรียงตามผัง = optgroup "ในผังองค์กร") + ต่อท้าย legacy ที่พนักงานกรอกแต่ไม่มีในผัง (optgroup "⚠ นอกผัง") ให้ยังกรองได้ระหว่างจัดข้อมูล (2026-07-22) — **ถ้าอยากให้ตรงผัง 100% ต้องจัด `employees.department` ให้ตรงชื่อแผนกใน org_nodes** (data cleanup แยกจากโค้ด)
  - **⚠️ 2 กับดักของตัวจัดกลุ่ม "ในผัง/นอกผัง" (แก้แล้ว 2026-08-06 · user ทักว่า dropdown ไม่สอดคล้องกับผัง):**
    1. **ต้อง fallback เป็น "ทั้งผัง" เมื่อยังไม่เลือกตัวแม่** — ตัวกรอง Group เดิมเขียน `grpDepNode ? lines ของแผนกนั้น : []` → **ยังไม่เลือกแผนก = ลิสต์ในผังว่าง → กลุ่มทุกตัวตกไปกอง "นอกผัง" ทั้งที่มีในผังจริง** (ตัวกรอง Dept ทำถูกอยู่แล้ว: ไม่เลือก section = เอาทุกแผนก) · ลำดับที่ถูก: เลือกแผนก → กลุ่มใต้แผนกนั้น · เลือกแค่ section → กลุ่มของทุกแผนกใน section · ไม่เลือกอะไร → ทั้งผัง
    2. **กลุ่ม (kind='line') ต้องเทียบทั้ง `name` และ `code`** — `code` ของ line เป็น**เลขไลน์** ('9', '12') ไม่ใช่ชื่อ ขณะที่ `employees.group_name` เก็บ**ชื่อ** → เทียบด้วย `code || name` อย่างเดียว ทำให้พนักงานทั้งไลน์ถูกตีเป็นนอกผัง (เจอจริง LINE ASSY TSRA code='9' → 35 คนหลุด) · **ฟอร์มแก้ไขพนักงานก็ต้องบันทึก `name` ไม่ใช่ `code || name`** ไม่งั้นแก้ทีนึงช่อง Group กลายเป็นเลข "9" (มี 2 คนโดนไปแล้ว — แก้ได้เองเมื่อเปิดแก้ไขแล้วเลือกกลุ่มใหม่)
  - **หมายเหตุ: `code || name` ยังถูกสำหรับ section/department** (code เป็น PD1/PD2… หรือ null) — กฎนี้ใช้กับ **kind='line' เท่านั้น**
  - **⚠️ ห้ามซ่อน optgroup "นอกผัง" ทิ้ง (2026-08-06 · user ถามว่าควรซ่อนไหม):** ซ่อนแล้ว**หาคนที่ต้องแก้ไม่เจอ** — ข้อมูลผิดยังอยู่ในตารางแต่กรองหาไม่ได้ = ผิดแบบมองไม่เห็น · ทำเป็น **worklist** แทน: `/operator` มีแถบเหลือง "⚠️ ข้อมูลไม่ตรงผังองค์กร N คน" + ปุ่ม 🔎 ดูเฉพาะที่ต้องแก้ (`filterOffOrg`) + ช่องแผนก/กลุ่มในตารางที่ผิดขึ้นสีเหลือง + tooltip บอกเหตุผล → ไล่แก้จนเหลือ 0 แล้วแถบหายเอง
  - **🔴 กฎเหล็ก — กรอง scope แล้วไม่เหลืออะไร = ห้ามคืนลิสต์ว่าง (2026-08-24 · user ทัก "แอดมินหน่วยงานเข้าไม่ได้ทุกฟีเจอร์")**
    หน่วยงานสนับสนุน (`Planning&Store` · QA · MTN · JIG/DIE) **ไม่มีไลน์ผลิตสังกัดเลย** (ตรวจแล้ว: `production_lines` ที่ section='Planning&Store' = **0 แถว**)
    → `scopeLines` กรองด้วย sections แล้วได้ 0 ไลน์ → dropdown เลือกไลน์**ว่างเปล่าทั้งหน้า** ใช้ฟีเจอร์ไม่ได้เลย
    (เจอที่ `/line-stock` → เพิ่มรอบจัดส่ง · หน่วยงานพวกนี้ทำงาน "ให้ทุกไลน์" การกรองด้วย section จึงไม่มีความหมายตั้งแต่ต้น)
    · แก้ที่ `scopeLines` (`LineSelect.jsx`) — **กรองแล้วไม่เหลือ = ไม่กรอง** หลักเดียวกับ branch ของ leader ที่ `fam` ว่างแล้วคืนทั้งลิสต์
    · ไลน์ผลิตของ supervisor/leader ยังถูกกรองตามปกติ (ส่วนงานเขามีไลน์อยู่จริง) — ไม่กระทบใคร
    · **จุดใหม่ที่กรอง scope แล้วผลลัพธ์เป็นลิสต์ให้เลือก ต้องคิดเคสนี้เสมอ** fail-closed ในตัวเลือก = ล็อกคนออกจากงานตัวเอง
  - **⚠️ บาง section แก้ผ่านฟอร์มไม่ได้ ต้องเพิ่มในผังก่อน** — ผังไม่มีแผนกใต้ section นั้นเลย = dropdown ว่าง เลือกอะไรไม่ได้ (ข้อมูลจริง 2026-08-06: **PD1 32 คน** ผังมี 0 แผนก) · แถบเตือนแยกนับให้แล้ว ("ในนี้ N คน แก้ที่ฟอร์มยังไม่ได้ — ต้องเพิ่มที่ผังองค์กรก่อน" + ลิงก์ `/org-setup`) — **ห้ามบอกให้ user ไปไล่แก้เฉยๆ โดยไม่บอกว่าบางส่วนแก้ไม่ได้**
  - **ฟอร์มพิมพ์ชื่อแผนก/กลุ่มเองไม่ได้แล้ว** — ทั้ง `/register` และโมดัลแก้ไขใน `/operator` เป็น `<select>` จาก org_nodes ล้วน (ตั้งแต่ 2026-07-22) และไม่มี bulk import พนักงาน → **drift ใหม่เกิดไม่ได้จาก UI** ที่ค้างอยู่คือข้อมูลก่อนหน้านั้น

> ### ⚠️ กฎเหล็ก — เปลี่ยนชื่อไลน์ (rename) ต้อง cascade `line_name` ทุกตาราง **2 project** (2026-07-22)
> **ชื่อไลน์ถูกเก็บเป็น text snapshot (ไม่ใช่ FK) ในหลายสิบตารางทั้ง Main + DR** — `production_lines.name` เป็นแค่ที่เดียว ที่เหลืออ้างด้วยชื่อ · เปลี่ยนชื่อแล้ว**ไม่ตามไปแก้ทุกที่ = ข้อมูลชื่อเก่ากำพร้าเงียบๆ ทันที**
> **เคสจริงที่เจอ:** เปลี่ยนชื่อไลน์ Laser ใน `/linesetup` → "กะที่เปิดค้าง" หายจากรายการ "กะที่เปิดอยู่" ใน Daily Report (เพราะ `production_sessions.line_name` = ชื่อเก่า แต่หน้ากรองด้วยชื่อไลน์ปัจจุบัน — leader `.in('line_name',[children])`, scoped role `lineMap[s.line_name].section` — session ยังเปิดอยู่ใน DB **แค่ถูกกรองพ้นสายตา** ไม่ได้หาย) · `dr_products.line_name` เก่ายังทำให้เปิด order/สแกนของไลน์ที่เปลี่ยนชื่อไม่ได้ด้วย
> **`handleRenameLine` (LineSetup.jsx) cascade แล้ว (best-effort ต่อ table):** Main = `workstations, line_layouts, wip_buffer_points, machine_points, machine_flow_links, four_m_logs, factory_line_regions, lpa_plans, lpa_audits, lpa_questions, meeting_action_items, station_assignment_logs, pokayoke_devices, wip_replenish_requests, employee_home_positions, qa_parts, qa_characteristics, qa_instruments, qa_ncr` · DR = `machines, production_sessions, dr_products, line_stock_transactions, jigs, pm_daily_line_targets, pm_daily_alerts, mtn_orders, improvements, scrap_reports, facility_supply_links, pm_coordination_plans, kanban_delivery_rounds, kanban_deliveries, rack_requests, kanban_calc_params, transport_nodes` + **`line_flow_links` (2 คอลัมน์ `from_line`+`to_line`)** + `pm_plans.usage_source_line` + คอลัมน์ `source_line` (`bom_items, child_lot_requests, packaging_withdrawal_requests`) + **`lpa_questions.hidden_for_lines[]`** (text[] — bump ธรรมดาไม่ได้ ต้องอ่าน-แก้-เขียนรายแถวด้วย `.contains()`) · (ขยายลิสต์ 2026-07-30 จาก single-source audit — เดิมตกหล่น supply route/PM ประสานงาน/poka-yoke/QA/คำขอ logistic · **ขยายอีกรอบ 2026-08-03 จาก QC audit** — เดิมตกหล่น lpa_questions/kanban_calc_params/transport_nodes/station_assignment_logs/pm_daily_alerts) · **เพิ่มตารางใหม่ที่เก็บ `line_name`/`source_line` ต้องมาเติมในลิสต์นี้ด้วย** · `handleDeleteLine` มีช่องโหว่เดียวกัน (ลบไลน์ที่ยังมี session เปิด = orphan) — ยังไม่ปิด, เลี่ยงลบไลน์ที่มีกะเปิดค้าง
> **กู้ session ที่กำพร้าไปแล้ว (rename ก่อนมี fix):** ใน `/linesetup` เปลี่ยนชื่อไลน์**กลับเป็นชื่อเก่า** (session ชื่อเก่ากลับมาโผล่) แล้ว**เปลี่ยนเป็นชื่อใหม่ที่ต้องการอีกรอบ** — รอบสองจะ cascade `production_sessions` ตามไปด้วย (fix ใหม่) · หรือ UPDATE `production_sessions.line_name` ชื่อเก่า→ใหม่ ตรงใน DR SQL editor

> ### 🔗 สายการไหลระหว่างไลน์ — `line_flow_links` (2026-08-19 · คำขอ user)
> *"hdf1 ป้อนงานเข้า laser345 และส่งต่อเข้าไลน์ apron assy 60 61 มันเกือบจะเป็น one piece flow แต่มีระบบ buffer มา mix เพื่อไม่ให้ไลน์เบรคดาวน์มากเกินไป"*
> **ระบบเดิมไม่มีที่ไหนเก็บ "ไลน์ต่อไลน์" เลย** (ตรวจแล้ว): `machine_flow_links` = ทางเดินงาน**ในไลน์เดียวกัน** · `part_routings` = routing **รายพาร์ท** (ถูกต้องกว่าแต่มีข้อมูล 1 แถว) · `facility_supply_links` = utility→ไลน์ (ลม/ไฟ/น้ำ คนละเรื่อง)
> - ตาราง **`line_flow_links`** (DR · `from_line`/`to_line`/`buffer_label`/`buffer_qty`/`is_active` · unique คู่ไลน์ · migration `20260819_line_flow_links.sql` **apply แล้ว**) — **ไม่ seed เส้นทางให้เอง** ("ไลน์ไหนป้อนไลน์ไหน" เป็นความรู้หน้างาน เดาแล้วผิดเสียหายกว่า)
> - ตั้งที่ **`/linesetup` → แผง 🔗 สายการไหลระหว่างไลน์** (`src/components/LineFlowPanel.jsx`) · สูตรอยู่ **`src/utils/lineFlow.js` (pure · เทส 12 เคส)** — `buildFlowGraph`/`downstreamOf`/`upstreamOf`/`traceChain`/`bufferCoverMin`/`lineAvgCtSec`/`downstreamRisk`/`missingLinksFromRouting`
> - **⚠️ กฎเหล็กของโมเดลนี้: "ต้นน้ำหยุด ≠ ปลายน้ำหยุดทันที"** — buffer ระหว่างกลางคือตัวกันสะเทือนที่หน้างาน**ตั้งใจ**ใส่ไว้ (ยิ่งเครื่องเยอะ โอกาสเบรคดาวน์ยิ่งสูง จึงต้องมี buffer) · ปลายน้ำหยุดก็ต่อเมื่อ buffer หมด → `bufferCoverMin(qty, ctปลายน้ำ)` = "หยุดได้กี่นาทีก่อนปลายน้ำเริ่มรอ" · **ห้ามแสดงว่าต้นน้ำหยุด = ปลายน้ำกระทบแบบเหมารวม** คนจะเลิกเชื่อสัญญาณ
> - **⚠️ ไม่กรอก buffer = `null` = "ไม่รู้" ห้ามเดาเป็น 0** (0 แปลว่า "ไม่มี buffer เลย กระทบทันที" คนละความหมาย) · `downstreamRisk` คืน 3 สถานะ `safe`/`at_risk`/**`unknown`** **ห้ามยุบเหลือ 2**
> - **⚠️ `Number(null)` = 0 ไม่ใช่ NaN** — เช็ค "มีค่าไหม" ด้วย `Number()` เฉยๆ ไม่ได้ (helper `num()` ในไฟล์) · เทสจับได้จริงตอนเขียน: ไลน์ที่ยังไม่กรอก buffer ถูกตีเป็น "0 ชิ้น = กระทบทันที" (กับดักเดียวกับที่เคยทำ Rank อะไหล่เพี้ยน)
> - **cover time คิดจาก CT ของไลน์ *ปลายน้ำ* เสมอ** (ปลายน้ำเป็นคนกินของออกจาก buffer) · `lineAvgCtSec` **ข้ามรายการที่ `is_operation`** (ไม่ใช่ของที่ปลายน้ำกินเป็นชิ้น)
> - แสดงที่ **modal เรื่องราวรายไลน์ใน `/factory-map`** (บล็อก 🔗 เหนือ Downtime) — บอกว่าเชื่อมกับใคร + เตือนให้ไปเช็ค "รอชิ้นงาน" ที่ปลายน้ำเมื่อไลน์นี้หยุด · **ยังไม่ผูกกับเวลาหยุดจริงอัตโนมัติ** (ต้องมี buffer ครบก่อน) — จอต้องไม่เขียนให้ดูเหมือนคำตอบสำเร็จรูป
> - **`missingLinksFromRouting`** = เมื่อ `part_routings` ลงครบ ให้ใช้ตรวจทานว่าเส้นไหนยังไม่ได้ตั้ง — **เสนอให้คนยืนยัน ห้าม insert เอง** (หลักเดียวกับ AI intake / PE change request)
> - **⚠️ เก็บชื่อไลน์เป็น text snapshot 2 คอลัมน์** → `handleRenameLine` bump ทั้ง `from_line` และ `to_line` แล้ว
>
> #### 🔴 กฎเหล็ก — ปลายทางของเส้นต้องเป็น **ไลน์ผลิต (leaf) ไม่ใช่ไลน์แม่** (2026-09-03 · feedback หน้างาน)
> *"laser ป้อนงานให้ทั้ง 60/61 ตั้งยังไง"* — ตรวจข้อมูลจริงแล้วพบว่าเส้นที่ตั้งไว้คือ
> **`LASER-345 → LINE APRON ASSY` ซึ่งเป็นชื่อ *แผนก* ไม่ใช่ไลน์** (ลูกจริงคือ Line 60 / Line 61 / SUB APRON)
> - **ผลที่ตามมาไม่ใช่แค่ความสวยงาม — มันคำนวณไม่ได้เลย:** `bufferCoverMin` คิดจาก `lineAvgCtSec(ไลน์ปลายน้ำ)`
>   ซึ่งอ่าน `dr_products.line_name` · วัดจริง 03/09: **`LINE APRON ASSY` มีสินค้าผูกอยู่ 0 ตัว**
>   (Line 60 = 5 ตัว CT 55.2 วิ · Line 61 = 4 ตัว CT 55.2) ⇒ ตั้งที่ไลน์แม่ = `cover` เป็น `null`
>   = สถานะ **`unknown` ตลอดกาล** ต่อให้กรอก buffer ครบ — ซึ่งเป็นเหตุผลเดียวที่ฟีเจอร์นี้มีอยู่
> - **1 ต้นน้ำ → หลายปลายทาง = ตั้งหลายเส้น** (unique key เป็น `(from_line, to_line)` รองรับอยู่แล้ว)
>   เช่น `LASER-345 → Line 60` + `LASER-345 → Line 61` **ไม่ใช่ยุบเป็นเส้นเดียวชี้ไลน์แม่**
> - **ต้นเหตุคือ dropdown ลิสต์ไลน์ดิบๆ ไม่กรอง ไม่บอกอะไรเลย** (`lines.filter(l => l.name !== lineName)`)
>   — บั๊ก class เดียวกับ dropdown ของ `/line-oee` · **แก้แล้ว: แยก optgroup ⭐ ไลน์ผลิต / ⚠️ ระดับแผนก
>   + กรอง `is_active === false` + เตือนใต้ฟอร์มพร้อมปุ่มลัดเลือกไลน์ย่อย (ปิดทางตัน) + ป้าย ⚠ บนเส้นที่ตั้งผิดชั้นไว้แล้ว**
> - **เตือน ไม่บล็อก และไม่ตัดไลน์แม่ทิ้งจากลิสต์** (กฎ "เสนอลำดับ ไม่ตัดตัวเลือก" เดียวกับ `moveTargets`)
>   · **ระบบไม่แก้เส้นที่ตั้งไว้แล้วให้เอง** — "ไลน์ไหนป้อนไลน์ไหน" เป็นความรู้หน้างาน (กฎเดิมของหัวข้อนี้)
> - **กรอก buffer แล้วแต่ไลน์ปลายทางไม่มี CT = ขึ้นป้าย ⚠ บอกเหตุผล** เดิมเงียบสนิท (ผิดกฎ "ห้ามล้มเหลวเงียบ")
> - **⚠️ `line_type` ที่ยังไม่ตั้ง (ข้อมูลจริง 03/09: `Line 61`, `BENDING E50`, `BENDING EXPORT` = null)**
>   ทำให้ตัวเสนอปลายทางของ `moveTargets` ไม่นับไลน์นั้นเป็นไลน์ขึ้นรูป — **ระบบไม่เดา ต้องตั้งเองที่
>   `/linesetup` → ⚙️ ตั้งค่าไลน์ → 🏭 คุณสมบัติของไลน์นี้**
> - **หลักการคิดเงินที่ยืนยันกับ user แล้ว: ความเสียหายคิดที่ไลน์ที่ *เกิดเหตุ* ด้วย rate ของไลน์นั้น ไม่ปันส่วนข้ามไลน์** — ผลกระทบปลายน้ำถูกบันทึกเองอยู่แล้วผ่าน downtime type "รอชิ้นงาน Sub Part"/"รอชิ้นงาน (HDF, Laser)" ที่ไลน์ปลายน้ำ (ข้อมูลจริง 60 วัน: Line 61 = 348 นาที) · cost center แยกตาม SAP = ถูกแล้ว **ห้ามรวม**
> - **ข้อมูลจริงแก้แล้ว 2026-09-03 (ผ่าน SQL Editor — ไม่ใช่ UI · audit trigger เก็บ delete/insert ไว้ · `updated_by_name` = "tsat.vx (แก้ผ่าน SQL)"):**
>   ลบ `LASER-345 → LINE APRON ASSY` · เพิ่ม `LASER-345 → Line 60` + `LASER-345 → Line 61` (buffer_qty ยัง null — หน้างานกรอกเอง)
>   · Main: `production_lines.line_type` ของ `Line 61` = `welding_assembly` (ตามไลน์แม่ + Line 60/SUB APRON)
>   · **ยังค้าง: `LASER-789` ไม่มีปลายทาง** — สินค้าใน dr_products ของไลน์นี้ = REINF FRT FNDR LH/RH "ก่อนแพ็ค" (20065635/20065715)
>     ไม่มี BOM parent ในระบบ ⇒ ระบบตอบไม่ได้ว่าส่งต่อไลน์ไหน (อาจไปแพ็ค/ส่งลูกค้าตรง) — **ห้ามเดา** รอหน้างานยืนยันแล้วตั้งที่ `/linesetup`
>     · **ข้อมูลจริง 2026-09-04:** ทั้ง 2 เลขเข้า STORE (prefix 2) แล้วมี `customer_shipping_orders` จาก EDI 862 ลูกค้า GBJWC ตรง ⇒ **ปลายทาง = ลูกค้า ไม่ใช่ไลน์ผลิตในโรงงาน** จบสายที่ LASER-789 ตามที่ user เคาะ ("✂️ จบขอบเขตเรา") — ไม่ต้องตั้งเส้นต่อใน `line_flow_links` · รายละเอียดสาย HDF2→LASER-789 ดู `docs/modules/oee.md` บล็อก 🔴 2026-09-04

> ### ⚠️ กฎเหล็ก — กำลังคนมาตรฐาน (`std_day_shift`/`std_night_shift`) อ่านผ่าน `src/utils/stdManpower.js` เท่านั้น (2026-08-05)
> **`production_lines` เก็บ std ได้ทั้งไลน์แม่และไลน์ลูก แต่ไม่เคยมีกฎ inherit** → ข้อมูลจริงมี **3 convention ปนกันในตารางเดียว**: HYDROFORM (แม่ 14/14 · ลูกทั้ง 6 ก็อป 14/14 มาหมด) · LINE APRON ASSY (แม่ 17 · ลูก 6+7+6=19) · GOR/LWR BAR (แม่ตั้ง · ลูก 0/0) — ส่วน**พนักงานจริง (`employees.line_id`)** เดิมผูกไลน์แม่แทบทั้งหมด **แต่ที่ถูกคือไลน์ลูก (ระดับกลุ่ม)** กำลังทยอยจัด — ดูกฎ "พนักงานอยู่ที่ไลน์ลูก" ในหัวข้อ scope ของ leader
> **แต่ละหน้าเลยเดากันเอง แล้วตอบ "ไลน์นี้มีคนกี่คน" ไม่ตรงกัน** (Dashboard 28 · OrderTrace 14 · ProductionPlan ทิ้งไลน์แม่ทั้งดุ้น)
> **กฎที่ใช้ (ยึด pattern เดียวกับ `shift_schedules`: ลูกตามแม่ เว้นแต่ตั้งเอง):**
> - **ตัวเลขกำลังคนของ "กลุ่ม" อยู่ที่ไลน์แม่** — แม่ตั้งไว้ = นั่นคือยอดกลุ่ม **ห้ามบวกลูกซ้ำ** · แม่ไม่ได้ตั้ง = รวมจากลูก
> - **คุณสมบัติไลน์** (เช่น "เดินกะดึกได้ไหม") **ตกทอด**จากแม่ลงลูกได้ — คนละเรื่องกับตัวเลขกำลังคน
>
> | export | ใช้ตอบ | ใช้ที่ |
> |---|---|---|
> | `stdCapacityOf(lines, name, shift)` | การ์ดรายไลน์ + **ผลรวมทั้งลิสต์ (ไม่นับซ้ำ)** — **ไลน์ลูกที่แม่อยู่ในลิสต์ = 0 เสมอ** (แม่ถือยอดกลุ่ม own หรือ rollup — เดิม "ลูกนับตัวเองเมื่อแม่ไม่ตั้ง" ทำให้แม่ unset + ลูกตั้งค่า ถูกนับซ้ำ 2 เท่า · QC audit รอบ 5 2026-08-24 มีเทสคุม invariant Σ ครอบครัว = stdGroupOf) | Dashboard |
> | `stdGroupOf(lines, name, shift)` | "กลุ่มนี้ทั้งกลุ่มกี่คน" | OrderTrace |
> | `stdInheritedOf` / `hasNightShift` | **คุณสมบัติไลน์** (มีกะดึกไหม) — ⚠️ ห้ามใช้รวมยอด จะซ้ำกับแม่ | ProductionPlan |
>
> **จุดใหม่ที่แตะกำลังคน ห้ามอ่าน `line.std_day_shift` ตรงๆ ห้ามเขียน heuristic เอง** (Dashboard เคยใช้ "ไลน์ย่อยที่ไม่มีพนักงาน = 0" ซึ่งพังทันทีที่ลูกมีคนสักคน — LASER E50 มี 1 คน → HYDROFORM กลายเป็น 28 แทน 14 · **พนักงานคนเดียวลงผิดไลน์ = ตัวหารทั้งโรงงานเพี้ยน 14**) · ยอดรวมกะเช้าทั้งโรงงานหลังแก้ = **67 คน** (เดิม 81 จากการนับซ้ำ)
> **⚠️ `parallel_stations` (N) = "เครื่องหลักที่เดินพร้อมกันจริงตอน**เต็มกำลัง**"** — **ไม่ใช่จำนวนเครื่องทั้งหมดในทะเบียน และไม่ใช่จำนวนคนที่มาวันนี้** (ผังรวมปรับตามกำลังคนที่มาจริงให้เองแล้ว ดูหัวข้อ Factory Master Map) · ตั้งสูงเกินจริงจะเพี้ยน 2 ทางพร้อมกัน: "ควรผลิตได้ตอนนี้" สูงเกิน (ไลน์ดูตามหลังตลอด) + หัก DT 1/N มากเกิน (%A สูงเกินจริง) · ไลน์ที่เป็น `parallel_machine` แต่ไม่ตั้ง N = ผังรวมถอยไปสูตรอัตราตามเวลา และแผง LineSetup ขึ้นแถบเตือนสีส้มให้ไปตั้ง
> **`cost_center` / `head_name` ก็ตกทอดจากแม่** (ลูกไม่ได้กรอก = ใช้ของแม่) — ทำแล้วที่ MtnRepair + Report (ใบค่าฝีมือ)
> **แผง LineSetup แยก 2 กลุ่มแล้ว:** 🏢 ข้อมูลของกลุ่ม (กำลังคน/cost center/หัวหน้า — ตกทอด) vs 🏭 คุณสมบัติของไลน์นี้ (ประเภทไลน์/โหมดไหลงาน/N เครื่องขนาน — ไม่ตกทอด) พร้อมข้อความบอกว่าค่าที่กรอกจะถูกนับหรือไม่ · **ชื่อแผง = "⚙️ ตั้งค่าไลน์ (กำลังคน + คุณสมบัติไลน์)"** — เดิมชื่อ "Standard Manpower" อย่างเดียวทั้งที่ข้างในมีคุณสมบัติไลน์ด้วย user ทักว่าสับสน (2026-08-06) · **เพิ่ม field ใหม่ในแผงนี้ต้องวางให้ตรงกลุ่ม** และถ้าไม่ใช่เรื่องคน ห้ามไปกองรวมกับกำลังคน
> **⚠️ ProductionPlan ห้ามกรองเหลือเฉพาะไลน์ลูก (leaf-only)** — `lineOfMat` map 1 พาร์ท → 1 ไลน์ ตาม `dr_products.line_name` เท่านั้น ไลน์แม่จึงไม่มีทางนับซ้ำกับลูก · เดิมกรอง leaf ทิ้ง → **HYDROFORM ที่มีสินค้าผูกกับตัวแม่ 5 พาร์ท หายจากแผนผลิตทั้งหมด** และ GOR/LWR BAR (ลูก std_night=0) **ไม่เคยถูกเปิดกะดึกในแผนเลย** ทั้งที่ไลน์เดินกะดึกจริง

### ทีมช่างซ่อม 4 ส่วน — data-driven + ยึด department เป็นหลัก (2026-07-22)

**เลิก hardcode ชื่อทีมในโค้ด** (คำสั่ง user) — ทีมช่าง (MTN/JIG MTN/DIE MTN/PRODUCTION) มาจากตาราง **`mtn_teams`** (DR · migration `20260722_mtn_teams.sql`): `key` (=`checklists.department`: maintenance/jig_maintenance/die_maintenance/production) · `label` · `icon` · `equip_type` (machine/jig/die/null) · `dept_name` (โยง `mtn_orders.mtn_dept`) · `color` · เพิ่ม/แก้ทีมได้จากตารางนี้ไม่ต้องแก้โค้ด
- โหลดผ่าน **`src/utils/pmTeams.js`** (`loadPmTeams()` cache + `pmTeamsSync()` + `DEFAULT_TEAMS` fallback ถ้า migration ยังไม่ apply) — หน้า **PMSchedule / PMCheckData / MtnMachineLayout / PMSetup** ดึง options+label+สี+icon จากตัวนี้ (เดิมต่างคนต่าง hardcode DEPT_OPTIONS/MTN_DEPTS · MtnMachineLayout เคยตกหล่น PRODUCTION · PMSetup เป็นหน้าสุดท้ายที่ยัง hardcode — แก้แล้ว 2026-07-22)
> ### ⚠️ กฎเหล็ก — "พนักงานคนนี้เข้ากะไหน" ตอบผ่าน `src/utils/shiftAssign.js` เท่านั้น (2026-08-11)
> เดิม logic นี้ถูกเขียนซ้ำใน `Checkin.jsx` กับ `Dashboard.jsx` (คอมเมนต์เขียนว่า "same logic as Checkin") แล้ว **drift กันจริง** — Dashboard ตกเงื่อนไข **Team C** → คนทีม C ที่เช็คชื่อแล้ว **หายจากบอร์ดทั้งกะเช้าและกะดึก** (บอร์ดกรองด้วย `assignedShift` ที่เป็น null) · รวมมาที่ util เดียวแล้ว
> **ลำดับตัดสิน (ห้ามสลับ):** `shift_overrides` รายคน → `shift_merge_events` (ไลน์ชนะ section) → **ตารางกะ: ไลน์ผลิตก่อน → ไม่มีค่อยใช้ของหน่วยงาน**
> - `buildScheduleMaps(rows)` → `{ byLine, byDept, count }` · `scheduleTeamFor(emp, maps)` · `shiftFromTeam(dayTeam, empTeam)` · `resolveAssignedShift(emp, {overrideShift, mergeShift, maps})`
> - **`Team C` = กะเช้าตลอด ไม่หมุน A/B** — ห้ามตัดเงื่อนไขนี้ออก คนจะหายจากจอ · ทีมที่ไม่รู้จัก → `null` (ไม่เดา)
> - **⚠️ ป้ายกำกับทีมบนจอต้องผ่าน `teamLabel()` — ห้ามเขียน "Team A (กะเช้า)" ตายตัวเด็ดขาด** (พบจริง 2026-08-21 ที่ dropdown "Team / กะ" ใน `/operator` — เขียน A=กะเช้า · B=กะดึก · C=ไม่มีพันธะกะ **ผิดทั้ง 3 บรรทัด**: A/B หมุนสลับกันรายสัปดาห์ตาม `shift_schedules.day_team` จึงเขียนไว้ในป้ายไม่ได้ · ส่วน C ที่คงที่จริงกลับเขียนว่า "ไม่มีพันธะกะ" ซึ่งตรงข้ามกับกติกา) · จุดอื่นทั้ง 9 dropdown เขียน "Team A" เปล่าๆ ถูกอยู่แล้ว · **ลิสต์ทีมดึงจากผังองค์กร** (`org_nodes` kind='team' เหมือน `/register`) ผังยังไม่มีทีม = ถอยไป A/B/C · ค่าเดิมของพนักงานที่ไม่อยู่ในลิสต์ต้องยังโชว์ได้ (ไม่งั้นเปิดแก้ไขแล้วทีมหายเงียบ)
>
> #### ⚠️ กฎเหล็ก — `profiles.team` คุม "เห็นใครบ้าง" ด้วย ไม่ใช่แค่ "เข้ากะไหน" (2026-08-21 · feedback หน้างาน)
> *"Team C คือพวกหัวหน้าที่ไม่ได้อยู่หน้างาน ไม่ได้สลับกะกับใคร แต่ต้องเห็นข้อมูลของทุกทีม ไม่ใช่เห็นแต่ทีม C กันเอง"*
> เดิม `Checkin.jsx` กรอง `.eq('team', team)` ด้วยทีมของ**บัญชี**ตรงตัว → **หัวหน้าทีม C เห็นเฉพาะคนทีม C**
> และ `/add-user` **บังคับ**ให้ role ระดับไลน์กรอก Team เสมอ = เลี่ยงด้วยการเว้นว่างไม่ได้ → ไม่มีทางออก
> - **`seesAllTeams(team)` ใน `src/utils/shiftAssign.js` จุดเดียว** (`NON_ROTATING_TEAMS = ['C']`)
>   — ทีมที่ไม่หมุนกะ = ไม่ผูกกับกะไหน ⇒ **เห็นคนทั้งไลน์ทุกทีม** · **ขอบเขต "ไลน์" ยังคุมเหมือนเดิม ปลดเฉพาะแกนทีม**
> - **⚠️ `Checkin.jsx` เป็นหน้าเดียวในระบบที่กรองด้วยทีมของบัญชี** (ตรวจครบทุกหน้า 2026-08-21)
>   · `Management.jsx` destructure `userTeam` มาแต่**ไม่เคยใช้** (ตัวแปรตาย) · `Report`/`operator`/`ShiftOrganize` ใช้ team เป็น **ตัวกรองที่ผู้ใช้เลือกเอง** คนละเรื่อง
>   → หน้าใหม่ที่จะกรองพนักงานตามทีมของหัวหน้า **ต้องผ่าน `seesAllTeams` เสมอ ห้าม `.eq('team', team)` ตรงๆ**
> - `/add-user` เขียนกำกับใต้ช่อง Team แล้วว่า A/B = เห็นเฉพาะทีมตัวเอง · C = เห็นทั้งไลน์ (ไม่งั้น admin เลือกให้ผิดโดยไม่รู้ตัว)
>
> #### 🏢 กะของ "หน่วยงานสนับสนุน" — `shift_schedules.dept_name` (2026-08-11 · user แจ้ง "set กะให้พนักงานซัพพอร์ทยังทำไม่ได้")
> ตารางกะเดิมผูก `(work_date, line_id)` เท่านั้น → **พนักงานที่ไม่มี `line_id` (ช่าง MTN/JIG/DIE · QA · คลัง) ไม่มีแถวให้ตั้งกะเลย** `assignedShift` เป็น null ตลอด เหลือทางเดียวคือ `shift_overrides` ทีละคน-ทีละวัน (14 คน × 30 วัน = ใช้จริงไม่ไหว)
> - **รูปแบบที่ user ยืนยัน: หมุน A/B พร้อมกันทั้งแผนก เหมือนไลน์ผลิต** · คนที่ไม่หมุนกะ = **Team C** (กลไกเดิมรองรับอยู่แล้ว ไม่ต้องเพิ่มอะไร)
> - แถวหน่วยงาน = `line_id: null` + `dept_name` = ชื่อแผนก (จับคู่ `employees.department` แบบ trim+lowercase) · check constraint บังคับให้แถวหนึ่งมีขอบเขตเดียว
> - **ตั้งที่ `/shift-organize` ตาราง "🏢 หน่วยงานสนับสนุน"** — ลิสต์เฉพาะแผนกที่มีพนักงานจริง เรียง "คนไม่ผูกไลน์" มากสุดขึ้นบน + แถบบอกจำนวนคนที่ยังไม่มีกะ · แผนกที่พนักงานกรอกไว้แต่ไม่มีในผัง ขึ้นป้าย **⚠ นอกผัง** (ตั้งกะได้ แต่ควรจัดให้ตรงผัง — **ห้ามซ่อน** หลักเดียวกับ optgroup "นอกผัง" ใน `/operator`)
> - **scope:** leader ไม่เห็นตารางนี้ (ดูแลไลน์ ไม่ใช่หน่วยงาน) · role ที่ถูกจำกัด `sections` เห็นเฉพาะแผนกใต้ส่วนงานตัวเอง · **แผนกขึ้นตรงฝ่าย (ไม่มี section) เห็นเฉพาะ user ที่ไม่ถูกจำกัด** (กฎเดียวกับ `ORPHAN_SECTION`)
> - **⚠️ unique index ของ `dept_name` ต้องเป็นแบบธรรมดา ห้าม partial** — PostgREST upsert ส่งแค่ `on_conflict=work_date,dept_name` เติม `WHERE` ให้ไม่ได้ → Postgres infer partial index ไม่เจอ แล้วพังทั้งการบันทึก · ไม่ต้องกลัวชนกับแถวไลน์ (dept_name = null ซึ่ง unique index ปล่อยผ่านเสมอ)
> - **⚠️ `fetchEmployees` ที่กรอง scope ต้อง fallback ไป `employees.section` ด้วย** ไม่ใช่ดูแค่ `production_lines.section` — พนักงานซัพพอร์ทไม่มีไลน์ จึงไม่มี join ให้ดู แล้วหายจากสายตา user ที่ถูกจำกัด scope ทั้งที่อยู่ส่วนงานเดียวกัน
> - อ่านแบบ tolerant: ยังไม่ apply migration = `dept_name` ไม่มีในผลลัพธ์ → ทำงานแบบเดิมเป๊ะ (ใช้ `select('*')`) · ตอนบันทึกเจอ `42703` ต้อง **ขึ้น toast บอกให้ไป apply migration ห้ามเงียบ**
> - **migration apply แล้ว 2026-08-18** (user รันเองผ่าน SQL Editor — เซสชันเว็บเข้า DB ไม่ได้)
> > - **🔁 เติมตารางกะล่วงหน้าจากรอบเดิม (2026-08-28 · คำขอ user "ปกติสลับกันทุก 2 สัปดาห์อยู่แล้ว พอจะ seed ล่วงหน้าได้มั้ย จะได้มีอะไรให้ fallback"):**
>   ปุ่ม **🔁 เติมกะล่วงหน้า** ในแถบเลือกสัปดาห์ของ `/shift-organize` → `src/components/ShiftAutoFillModal.jsx`
>   · สูตรอยู่ **`src/utils/shiftRotation.js` (pure · เทส 10 เคส)** — `mondayOf`/`addDays`/`weeksBetween`/`detectRotation`/`teamForWeek`/`projectWeeks`
>   · **ไม่มี migration ไม่มี permission key ใหม่** (ใช้ `shift_schedule:edit` / `edit_dept` เดิม · `note` เป็นคอลัมน์ที่มีอยู่แล้ว)
>   - **🔴 ระบบเสนอ คนกดยืนยัน — ห้ามทำเป็น seed อัตโนมัติ/cron เด็ดขาด** ตารางกะมีผลกับ เช็คชื่อ · OEE · ค่าแรง OT
>     เดาผิดแล้วแก้ย้อนยาก · ต้องเห็น preview รายสัปดาห์ก่อนเขียนเสมอ (หลักเดียวกับ AI intake / PE change request)
>   - **ห้ามทับสัปดาห์ที่มีข้อมูลแล้ว** — ของที่คนตั้งเองชนะเสมอ · แถบสรุปบอกว่าข้ามไปกี่สัปดาห์
>   - **ตรวจรอบไม่ได้ = โชว์พร้อมเหตุผล ห้ามข้ามเงียบ** (ประวัติน้อยเกินไป / ยังไม่เคยสลับ / สลับไม่สม่ำเสมอ)
>   - **`detectRotation` ทนช่องว่าง** — สัปดาห์ที่ไม่มีใครตั้งไว้ต้องไม่ทำให้ตรวจพลาด
>     (ข้อมูลจริง GOR ขาดสัปดาห์ 10-16/08 แต่ 17/08 กลับมาตรงจังหวะ = ตกหล่น ไม่ใช่ pattern ต่าง)
>   - **ไล่ตัดสัปดาห์เก่าสุดออกทีละอันถ้ายังไม่เข้ารูป** — รอบสลับเปลี่ยนกติกาได้ตามช่วงเวลา
>     (LINE APRON ASSY พ.ค. สลับทุกสัปดาห์ แล้วเป็นทุก 2 สัปดาห์ตั้งแต่ มิ.ย. — เหตุการณ์เก่าไม่ควรทำให้ต่อรอบปัจจุบันไม่ได้)
>     · **แต่ต้องเหลือ ≥ `minWeeks` (4) และเห็นอย่างน้อย 2 บล็อกของรอบนั้น (`win.length >= 2*k`)**
>     ไม่งั้นข้อมูล 3-4 จุดจะ "เข้ารูป" กับรอบยาวๆ ได้เสมอ (เจอตอนเทส: 4 สัปดาห์มั่วๆ ถูกตีเป็น "สลับทุก 3 สัปดาห์")
>   - **⚠️ ไลน์ลูกที่ตามไลน์แม่ ต้องเติมแถวให้ด้วย** — `resolveAssignedShift` อ่าน `line_id` ตรงตัว **ไม่ไล่ขึ้นไปหาแม่**
>     เติมแต่แม่ = คนของไลน์ลูกยังหายจากจอเหมือนเดิม · โมดัลจึง resolve rotation ของแม่มาใช้เมื่อลูก `is_manual=false`
>   - **แถวที่ระบบเติมติด `note = 'auto-rotate'`** และ **`handleSave` เขียน `note: null` เสมอ** → คนแก้เองแล้วธงหลุดเอง
>     (ไม่งั้นแถวที่คนตั้งจะยังดูเหมือนระบบเดาให้ตลอดไป)
>   - วัดกับข้อมูลจริง 2026-08-28: ต่อรอบได้ **7 ไลน์** (GOR · LWR BAR · HYDROFORM · HDF1 · Line 60 · LINE APRON ASSY · SUB APRON — ทั้งหมด K=2)
>     · ต่อไม่ได้ 6 (Assy GOR/Assy LWR ประวัติ 2 สัปดาห์ · LINE ASSY TSRA/FORD UP375 สลับไม่สม่ำเสมอจริง · MTN ยังไม่เคยสลับ · LINE A มีสัปดาห์เดียว)
>
> #### 🔔 เตือนหัวหน้าแผนกเมื่อตารางกะจะหมด — `shift_schedule_gap` (2026-08-31 · คำสั่ง user "alarm ให้หัวหน้าแผนกเค้าไปปรับเอง")
> แถบเตือนบน Dashboard (กฎด้านบน) ต้องมีคนเปิดดูก่อนถึงเห็น → เพิ่มตัวสแกนฝั่ง server ที่ไปหาหัวหน้าเอง
> · migration `20260828_shift_schedule_gap_alert.sql` (Main · **apply แล้ว 2026-08-31**) — `fn_shift_schedule_scan(p_lead_days=14)`
> + cron `shift-schedule-gap-scan` ทุกวัน **00:30 UTC = 07:30 ไทย** (ก่อนเข้ากะเช้า) → ยิงผ่าน `send-event-notification` ตัวกลาง
> - **🔴 ขอบเขตวัดจาก "คนที่จะหายจากจอจริง" ไม่ใช่ "แถวที่มีในตาราง"** — ตัวที่ทำให้คนหายคือ `resolveAssignedShift`
>   คืน null ซึ่งเกิดกับ **พนักงานที่ผูก `line_id`** (ใช้ตารางกะของไลน์) และ **พนักงานที่ไม่มี `line_id`** (ตกมาใช้ตารางกะของแผนก)
>   ⇒ นับ affected แยก 2 สูตรตามชนิดหน่วย · ส่วนงานจะถูกเตือนต่อเมื่อ **`sum(affected) > 0`**
>   · วัดกับข้อมูลจริง 31/08: แถวแผนก **GOR/LWRBAR/ทั่วไป/ฝ่าผลิต = 0 คนที่ไม่มี line_id** (ทุกคนมีไลน์ ตารางไลน์ชนะ)
>   = กระทบใครไม่ได้เลย · ถ้านับเป็นงานค้างจะกลายเป็นเสียงรบกวนถาวร · **แผนก MTN 9 คน = กระทบจริง ต้องเตือน**
> - **ไลน์ `is_active = false` ตัดออก** — จับ `test`/`test child`/`test child 2` ได้พอดีทั้งชุด (ปิดใช้งานแล้ว = ไม่ใช่งานค้าง)
> - **แต่หน่วยที่ยังไม่มีคนสังกัดยังลิสต์ให้เห็นในข้อความ** ("ยังไม่มีคนสังกัด") — ห้ามซ่อนเงียบ เพราะ 🔁 เติมทีเดียวได้ทั้งส่วนงาน
> - **⚠️ เรียงลิสต์ด้วย `last_date, affected desc, unit_name`** — หน่วยส่วนใหญ่หมดกะวันเดียวกันหมด เรียงด้วยชื่อ
>   ทำให้หน่วยที่มีคนจริงถูกตัดออกจาก 6 แถวแรก (เจอจริงตอนเทส: **Office PD4 7 คน โดนซ่อน** ขณะที่ไลน์ 0 คน 4 ตัวโผล่)
> - **⚠️⚠️ เรียง "สรุป + สิ่งที่ต้องทำ" ไว้ก่อนลิสต์หน่วยเสมอ** — `send-event-notification` ตัด body ในแอปที่ **300 ตัวอักษร**
>   (`[title, ...lines].join(' · ').slice(0,300)`) → เอาลิสต์ขึ้นก่อน บรรทัด 👉 จะโดนตัด กระดิ่งเหลือแต่กำแพงชื่อไลน์ที่ทำอะไรไม่ได้
>   · ตรวจกับของจริงแล้ว: ทั้ง 5 ข้อความมีบรรทัด 👉 ครบก่อนถูกตัด
> - **เตือนซ้ำ "รายสัปดาห์" ไม่ใช่ครั้งเดียวจบ** (`shift_schedule_alerts` PK `(scope_key, week_key)`) ตามกฎ "งานค้างที่ยังไม่หายต้องเตือนซ้ำ"
>   · **ไม่เตือนรายวัน** — บทเรียน `shipping_phase_alert` 592 ครั้งใน 4 วันจนต้องปิดทิ้ง
> - **1 ข้อความ / 1 ส่วนงาน ห้ามยิงรายไลน์** (PD4 มี 7 หน่วย = 7 ข้อความพร้อมกัน) · ความถี่จริง ~5 ข้อความ/สัปดาห์ทั้งโรงงาน
>   → ต่ำพอเปิด `inapp_roles` ได้ตามกฎ "วัดความถี่ก่อนเปิดกระดิ่ง"
> - **ผู้รับรวม role `mtn` ด้วย** — แถวแผนก MTN เป็นงานค้างจริง และ mtn ถือ `shift_schedule:edit_dept` อยู่แล้ว
>   ไม่ใส่ = คนที่แก้ได้จริงไม่ได้รับข้อความ · **บัญชี mtn ไม่ได้ตั้ง section → ผ่านตัวกรอง `inapp_match_section` เสมอ** (ตั้งใจ ช่างดูแลทุกไลน์)
> - **`ref_table = 'shift_schedules'` → กดกระดิ่งแล้วเข้า `/shift-organize`** — เพิ่มใน **`NOTIF_ROUTE` (App.jsx) และ `routeFor()`
>   (send-push/index.ts) ทั้งคู่** ตามกฎ mirror · ⚠️ `send-push` ต้อง deploy ใหม่ ก่อน deploy Web Push จะพาไปหน้าแรกแทน (ไม่พัง)
> - **ผลรันจริงครั้งแรก 31/08:** 5 ส่วนงาน · PD1 หมดมา **8 วัน** (31 คน) · PD2 37 คน · PD3 32 คน · PD4 อีก 6 วัน (49 คน) · MTN 9 คน
> - **⚠️ pg_net เป็น fire-and-forget เช็ค `res.ok` ไม่ได้** → ส่งพลาด = สัปดาห์นั้นเงียบ (สัปดาห์ถัดไปยิงใหม่เอง)
>   · ตัวที่ไม่พึ่งการส่งเลยคือแถบเตือนบนจอ Dashboard · **และ `notifications` ถูก insert แบบ async — verify ทันทีหลังเรียกจะได้ 0 แถว ต้องรอ worker**
- **🔧 หัวหน้าทีมช่างตั้งกะเอง (2026-08-19 · feedback "แอดมินหน่วยงาน MTN เข้าหน้าตารางกะไม่ได้"):** `page:/shift-organize` seed ไว้ก่อน role `mtn` เกิด (กับดัก enum_range) และ bucket `dept_admin` ปลดล็อก `page:*` ไม่ได้โดยดีไซน์ → migration `20260819_shift_organize_mtn_page_main.sql` (**apply แล้ว 2026-08-19** · ตรวจ profiles: mtn 8 บัญชี sections ว่างหมด ไม่มีใครติดกับดัก ORPHAN · แอดมินหน่วยงาน 5 คน) เปิด page ให้ role `mtn` — **mtn ทุกคนเข้าดูได้ · แก้/ลบได้เฉพาะผู้ถือ `shift_schedule:edit`/`delete` (แอดมินหน่วยงาน ผ่าน bucket)** ชั้นสิทธิ์เดิมไม่เปลี่ยน · role support อื่น (qa/planner_store) เปิดที่ `/permissions` เอง · **⚠️ กับดัก: แอดมินหน่วยงานช่างต้องมี `profiles.sections` ว่าง** — ถ้าถูกตั้ง sections ไว้ แผนกขึ้นตรงฝ่าย (MTN/JIG/DIE ที่ไม่มี section) จะหายจากตารางหน่วยงานตามกฎ ORPHAN → ตั้งกะแผนกตัวเองไม่ได้
> - **🏢 แยกสิทธิ์แก้กะหน่วยงาน `shift_schedule:edit_dept` (2026-08-20 · feedback "ณัฐเปิดมาแล้ว กำหนดกะในฐานข้อมูลแล้ว แต่ไม่มีปุ่มสลับกะ"):** ตารางหน่วยงานถูก gate ด้วย `shift_schedule:edit` ซึ่ง seed ไว้แค่ admin/manager/supervisor ตั้งแต่ 20260708 (ก่อน role `mtn` เกิด) → mtn เข้าหน้าได้ (เปิด page ให้แล้ว 2026-08-19) แต่คอลัมน์จัดการหายทั้งตาราง · **ไม่แจก `shift_schedule:edit` ให้ mtn** เพราะคีย์นั้นครอบกะไลน์ผลิต + override รายคน + ยุบกะทั้ง section ด้วย → คีย์ใหม่ `shift_schedule:edit_dept` = **แก้ได้เฉพาะตารางหน่วยงานสนับสนุน** · โค้ดเช็ค **`canEditDept = can(edit) || can(edit_dept)`** (`edit` ครอบ `edit_dept` เสมอ — คนเดิมไม่กระทบ) + guard ชั้นสองใน `handleSave` (ผู้ถือ edit_dept ห้ามเขียนแถวไลน์ผลิต) · migration `20260820_shift_schedule_edit_dept.sql`
> - **🏢🏢 ต้องครอบ *ทุก* หน่วยงานสนับสนุน ไม่ใช่แค่ MTN (2026-08-20 · คำสั่ง user "แอดมินแผนกอื่นก็ควรทำได้กับส่วนงานตัวเอง"):** QA / แพลนนิ่ง-คลัง / วิศวกรรม / เอกสาร มีพนักงานไม่ผูกไลน์เหมือนกันทั้งนั้น → migration `20260820_shift_schedule_edit_dept_all_units.sql` (**ครอบไฟล์แรกทั้งหมด รันไฟล์เดียวพอ · รันซ้ำได้**) เปิด `shift_schedule:edit_dept` ให้ admin/manager/supervisor/**mtn/qa/engineer/planner_store/sale/document_control**/dept_admin + เปิด `page:/shift-organize` ให้ 6 role สนับสนุน (เดิมเปิดให้ mtn ตัวเดียว)
>   - **⭐ "หน่วยงานของฉัน" = `profiles.section` (คอลัมน์เดี่ยว) — ห้ามใช้ `sections[]`** (กฎเหล็ก: `sections[]` เป็น scope ทั้งระบบ ตั้งแล้ว StoreMonitor/PlannerSales/RundownStock/Dashboard/Report เหลือ 0 แถวทันที · ส่วน `section` เดี่ยวไม่กระทบ scope ตาม `effectiveSections()` ข้อ 5) — **precedent เดียวกับ `employees:edit_all_sections`**
>   - จับคู่ได้ทั้ง **ชื่อแผนก** (MTN/QA — แผนกขึ้นตรงฝ่าย) และ **ชื่อส่วนงาน** (PD1 — แผนกใต้ section) ผ่าน `isMyUnit(d)` · แถวของตัวเองติดชิป 🏠 · แถวหน่วยงานอื่นขึ้น 🔒 ของหน่วยงานอื่น
>   - **หน่วยงานของตัวเองเห็นเสมอ แม้ถูกจำกัด `sections` หรือเป็นแผนกขึ้นตรงฝ่าย** (ไม่งั้นแอดมิน QA/คลังที่ถูกตั้ง sections จะมองไม่เห็นแผนกตัวเอง — แก้กับดัก ORPHAN ที่เคยบันทึกไว้)
>   - **ไม่ตั้ง `profiles.section` = แก้ได้ทุกหน่วยงานที่เห็น (พฤติกรรมเดิม ไม่มีใครเสียสิทธิ์ตอน deploy)** → การรัดให้แคบเป็น **opt-in** ที่ admin ตั้งเองที่ `/add-user`
>   - guard 3 ชั้น: ซ่อนปุ่มรายแถว · `toggleDept` เช็ค `canEditDeptRow` · `handleSave` กรอง `pendingDept` ก่อนเขียน
> - **⚠️ กฎที่ตกผลึกจากเคสนี้ — ซ่อนปุ่มได้ ห้ามซ่อนเหตุผล (audit 2026-08-20):** ทุกหน้าที่ซ่อน UI ด้วย `can()` ต้องมี **`<ReadOnlyNote>`** (`src/components/ReadOnlyNote.jsx`) บอกว่าต้องเปิดคีย์ไหนให้ role ไหน — **ห้ามเขียนแถบนี้เองซ้ำในหน้าใดๆ** · ดู `docs/UI-CONVENTIONS.md` §6.9 (ทำแล้ว 18 หน้า) · **คีย์ที่ยังติดกับดักเดิม ยังไม่มีใครเปิดให้ role ใหม่:** `report:export` · `heijunka:operate` · `rack_center:operate` · `checkin:record` (seed 2026-07-08 = "ทุก role ณ ตอนนั้น" 7 ตัว) — ตอนนี้อย่างน้อย**หน้าจอบอกแล้วว่าต้องไปเปิดที่ไหน** ส่วนจะเปิดให้ใครเป็นการตัดสินใจของ admin
> - **เทส gate สิทธิ์มีแล้ว: `src/utils/__tests__/permissions.test.mjs`** — เทสโค้ดจริงของ `permissions.js` (bundle ด้วย rolldown + stub supabaseClient เพราะไฟล์จริง import client ที่พึ่ง `import.meta.env`): bucket ห้ามปลด page:* · pagination >1000 แถวไม่หลุด · fail-closed · canDelete fallback · Daily Checker piggyback · รัน `node --test 'src/utils/__tests__/*.test.mjs'`

> ### ⚠️ กฎเหล็ก — `user_role` ถือ 3 แกน ห้ามเพิ่ม role เมื่อเจอแกนใหม่ (2026-08-06 · คำสั่ง user)
> `user_role` คอลัมน์เดียวปนกัน 3 เรื่อง ทำให้เข้าใจผิดซ้ำๆ ว่า role = ตำแหน่งงาน:
> **`scope`** ระดับสิทธิ์/ขอบเขต (admin·manager·supervisor·leader) · **`unit`** หน่วยงาน (mtn·qa·engineer·sale·planner_store·document_control) · **`device`** อุปกรณ์ (display) · **`tier`** ชั้นเสริม (dept_admin — bucket ของ flag)
> - **ติดป้ายแกนที่ `ROLE_META[x].axis`** (`src/utils/roleMeta.js`) → `/add-user` จัดกลุ่ม dropdown + แผงอธิบายตามแกนอัตโนมัติ · **เพิ่ม role ใหม่ต้องระบุ `axis` เสมอ** (ไม่ระบุ = ตกกลุ่ม `unit`)
> - **⚠️ `engineer` = "ส่วนวิศวกรรม" (หน่วยงาน) ไม่ใช่ "ตำแหน่งวิศวกร"** — เคสจริง: **วิศวกรที่ทำ PM สังกัดแผนก MTN ใช้ role `mtn`** (ข้อมูลจริง 2026-08-06: role `engineer` มีบัญชีเดียว `processengineering` · ส่วน role `mtn` 8 คน ในนั้นตำแหน่ง "วิศวกร" 3 คน) · เคยเข้าใจผิดจนเกือบแจกสิทธิ์ PM ให้ผิด role
> - **ตำแหน่งจริงอยู่ที่ `profiles.position` / `employees.position`** แยกจาก role เด็ดขาด
> - **เจอแกนใหม่ → เพิ่ม attribute ห้ามเพิ่ม role** (precedent ที่ได้ผลแล้ว 3 ครั้ง: `sections[]` แยก scope · `is_dept_admin` แยก tier · `mtn_teams[]` แยกทีมช่าง) — ไม่งั้นตอน rollout หลายโรงงาน role จะระเบิดเป็นสิบตัว
> - **✅ แกนที่ 4 "ระดับงาน" ทำแล้ว (2026-08-06 · เฟส 2)** — ตาราง **`positions`** (Main · migration `20260806_positions_master.sql` · apply แล้ว)
>   - **`employees.position` / `profiles.position` เก็บ "key" แล้ว แสดงผลผ่าน `positionLabel()`** — เดิมเป็น free text ปนไทย-อังกฤษ (`Operator` 195 + `พนักงานฝ่ายผลิต` 6 = อันเดียวกันแต่แยกกันในข้อมูล · `Technician` 17 + `ช่างเทคนิค` 6 · `Engineer` 1 + `วิศวกร` 5) → normalize แล้ว **ทุกแถวจับคู่ level ได้ 100% ไม่มีค่ากำพร้า**
>   - **แบ่ง 2 ชั้นโดยตั้งใจ:** ตาราง `positions` = **ชื่อตำแหน่ง** (ข้อมูล เปลี่ยนบ่อย ต่างกันได้ทุกโรงงานตอน rollout) · `POSITION_LEVELS` ใน `src/utils/positions.js` = **ระดับงาน** (แนวคิด TPM ที่นิ่ง) — **เพิ่มตำแหน่งใหม่ = เพิ่มแถวชี้ไป level เดิม ไม่ต้องแตะโค้ด**
>   - `maintenanceKindOfPosition()` → `am` (operator/leader) · `pm` (technician/engineer) · `both` (หัวหน้า/ผจก.) · `null` (ธุรการ/เลขา/เจ้าหน้าที่)
>   - **payoff:** `/add-user` เตือนเมื่อระดับงานไม่ตรงกับสิทธิ์ที่ให้ — เคสจริงที่จับได้: **ธุรการที่ role `mtn` ได้ `pm:approve` เต็ม** · **เป็นคำแนะนำเท่านั้น ไม่บล็อก** (หน้างานมีข้อยกเว้นเสมอ) สิทธิ์จริงยังคุมที่ `role_permissions`
>   - **⚠️ จุดที่แสดง/พิมพ์ `position` ต้องผ่าน `positionLabel()` เสมอ** ไม่งั้นใบพิมพ์ขึ้น `operator` — ทำแล้ว: sidebar, `/add-user`, ใบ Multi-Skill + CSV (Report), ใบประเมินรายบุคคล (individualSkillPrint) · **component ร่วมที่พิมพ์เอกสารต้อง `await loadPositions()` เองก่อนอ่าน** (กฎเดียวกับ `loadDocForms()` — SkillRadarPanel ทำแล้ว)
>
> #### ⚠️ AM (ผลิตตรวจเอง) ≠ PM (ช่าง) — คนละงาน คนละทะเบียน คนละสิทธิ์ (คำสั่ง user 2026-08-05 · เป็นข้อมูล 2026-08-06)
> ศัพท์ TPM: **`production` = AM (Autonomous Maintenance)** พนักงานผลิตดูแล/ตรวจเครื่องเองทุกต้นกะ · **ทีมช่าง (MTN/JIG MTN/DIE MTN) = PM (Preventive/Predictive · อนาคต prescriptive)** ตรวจตามรอบเวลา/ยอดผลิต · **key ใน DB ยังเป็น `production` เหมือนเดิม เปลี่ยนเฉพาะการแสดงผล**
> **นิยาม:** **AM** = พนักงานหน้างานตรวจเองทุกต้นกะ · **PM** = ช่าง (technician/engineer ทุกส่วนงาน) ตรวจ**ตามอีเวนต์** ไม่ใช่ทุกวัน — `pm_plans.plan_type` = `time` (รอบเวลา) / `usage` (ยอดผลิต) / `hybrid` + `condition_rules`
> - **⚠️ แกน AM/PM เป็น "ข้อมูล" ไม่ใช่เงื่อนไขในโค้ด — `mtn_teams.kind` (`am`/`pm`)** (migration `20260806_am_pm_axis_dr.sql` · apply แล้ว) · อ่านผ่าน **`teamKindOf(key)` / `isAmTeam(key)`** · เดิม hardcode `key === 'production'` ซึ่ง**พังเงียบ**ทันทีที่แยก AM รายส่วนงาน (AM-PD1/PD2) หรือ rollout โรงงานที่เรียกทีมคนละชื่อ — ทีมใหม่จะกลายเป็น PM โดยไม่มีใครรู้ · ทีมที่ไม่รู้จัก → **PM (fail-safe เลือกฝั่งสิทธิ์แคบกว่า)** · **สลับได้ที่ปุ่มใน PM Setup** (หัวข้อ AM/PM ข้างชื่อแผนก)
> - **⚠️ สิทธิ์บันทึกแยกแกนแล้ว: `am:record` (พนักงานหน้างาน) vs `pm:record` (ช่าง)** — เลือกด้วย **`recordPermFor(dept)`** ห้าม hardcode `can('pm','record')` อีก · migration `20260806_am_pm_permission_axis.sql` **seed `am:record` เท่ากับ `pm:record` เดิมทุกประการ → พฤติกรรมไม่เปลี่ยน ไม่มีใครหลุดสิทธิ์** แล้วค่อยไปรัดเองที่ `/permissions` (เช่น ถอด `pm:record` ออกจาก leader ให้เหลือแต่ AM)
> - **`display` ถูกถอด `pm:record`/`pm:approve`/`am:record` แล้ว** — จอ TV/บอร์ดหน้าไลน์เป็นอุปกรณ์ ไม่ใช่คน ไม่มีใครรับผิดชอบสิ่งที่บันทึก
> - **ชื่อ/คำอธิบายอยู่ที่ `src/utils/pmTeams.js` จุดเดียว** — `DEFAULT_TEAMS` label `production` = "AM (ผลิตตรวจเอง)" + `teamKind(key)` คืน `{short, full, desc}` (AM_KIND/PM_KIND) · **หน้าใดที่โชว์ชื่อทีมให้เรียก `teamKind()` มาอธิบาย ห้าม hardcode คำว่า "PM ฝ่ายผลิต"** · ใช้แล้วที่ PMSetup + PMCheckData (บรรทัดใต้แท็บ) · DailyPM/DailyChecker ใช้ชื่อ AM อยู่แล้วตั้งแต่ 2026-07-23
> - `mtn_teams` **apply แล้ว** (ตรวจ 2026-08-06 — เอกสารเดิมเขียนว่ายังไม่ apply ซึ่งไม่จริงแล้ว) → **เปลี่ยนชื่อทีมให้แก้ที่ตาราง `mtn_teams.dept_name`** ไม่ต้องแก้โค้ด · `DEFAULT_TEAMS` เหลือเป็น fallback ตอนโหลดไม่ทัน/ตารางล่ม
>
> #### ⚠️ 2 หน้า PM ฝั่งผลิตใช้เกณฑ์คนละอย่าง — เคยดูเหมือนข้อมูลหาย (2026-08-05)
> | หน้า | ลิสต์อะไร | เกณฑ์ |
> |---|---|---|
> | **PM Setup** (`/pm-setup?dept=production`) | เครื่องที่ **ลงจุดตรวจ AM ไว้แล้ว** | มีแถว `checklists` (module mtn, department `production`) |
> | **PM ตรวจสอบ** (`/pm-check?dept=production`) | เครื่องที่ **ต้องตรวจทุกต้นกะจริง** | มีแถว **`pm_daily_line_targets`** (ทะเบียน AM · ติ๊กที่ `/daily-checker?tab=pm`) |
>
> **2 เกณฑ์นี้ไม่เท่ากันโดยธรรมชาติ** (ข้อมูลจริง 2026-08-05: มี checklist 27 · ลงทะเบียน 7 · **ลงจุดตรวจแล้วแต่ไม่ได้ลงทะเบียน 21** · ลงทะเบียนแต่ยังไม่มีจุดตรวจ 1) — **เป็นเรื่อง data ไม่ใช่ bug ของ logic** (จะให้ไลน์ไหนตรวจเครื่องอะไรทุกกะ เป็นการตัดสินใจของคน **ห้ามให้ระบบลงทะเบียนให้เองอัตโนมัติ**)
> **แต่ห้ามเงียบ** — ทำให้เห็นทั้ง 2 ทางแล้ว: PM ตรวจสอบ มีบล็อกส้มท้ายลิสต์ "⚠ มีรายการตรวจ AM แล้ว แต่ยังไม่ได้ลงทะเบียน · N เครื่อง" (+รายชื่อ+ลิงก์ไปลงทะเบียน) และรายการที่ลงทะเบียนแต่ยังไม่มีจุดตรวจขึ้น "⚠ ยังไม่มีจุดตรวจ AM" · PM Setup การ์ดเครื่องที่ยังไม่ลงทะเบียนขึ้นชิป "⚠ ยังไม่ได้ลงทะเบียน AM" พร้อมลิงก์
> **ลำดับที่ถูกต้อง: PM Setup ลงจุดตรวจ → `/daily-checker?tab=pm` ⚙️ ติ๊กลงทะเบียน → เครื่องถึงโผล่ให้ตรวจ**
>
> #### 🔧 เจอ NG ตอนตรวจ → เปิดใบแจ้งซ่อม MO ต่อได้เลย (2026-09-02 · feedback หน้างาน "ถ้า NG จะให้เลือกเปิด MO ได้เลยใช่มั้ย")
> เดิม**ไม่มี** — `PMCheckData` แจ้งเตือนในแอปว่าพบ NG แล้วจบ ช่างต้องไปพิมพ์ใบใหม่เองที่ `/mtn-repair`
> โดยไม่มีอะไรผูกกลับ ⇒ **ตอบไม่ได้ว่า "NG ที่เจอเมื่อวาน ถูกซ่อมหรือยัง"**
> · `mtn_orders.source_inspection_id` (DR · migration `20260902_mtn_order_from_inspection.sql`) — FK `on delete set null`
>   + **unique partial index** (1 ผลตรวจ = 1 ใบซ่อม กันดับเบิลคลิก/2 เครื่องพร้อมกัน · 23505 → ข้อความไทย)
> - **⚠️ เสนอหลังบันทึกผลตรวจสำเร็จเท่านั้น ห้ามเปิดใบตอนกด NG** — ต้องมี `inspection_id` ก่อนถึงผูกที่มาได้
>   และถ้าเปิดก่อนบันทึก ผลตรวจอาจไม่ถูกบันทึกแต่ใบซ่อมออกไปแล้ว
> - **⚠️ ระบบเสนอ คนกดยืนยัน ห้าม auto-สร้าง** (กฎเดิมทั้งโปรเจค) — ใบซ่อมมีคนต้องรับผิดชอบจริง ไม่ใช่ผลข้างเคียงของการกดบันทึก
> - **⚠️ AM เจอ NG ส่งกลับให้ผลิตซ่อมเองไม่ได้** — `defaultMoTeam()` เดาทีมช่างจาก `teamForEquipmentKind(jigs.equipment_type)`
>   แล้ว fallback `maintenance` · **เป็นการเดา ต้องเขียนบอกบนจอ + เลือกทับได้เสมอ** (กฎ "ชนิดอุปกรณ์ไม่ได้ล็อกว่าใครตรวจ")
> - **กด "ไว้ก่อน" ต้องไม่เป็นทางตัน** — แท็บ 🕐 ประวัติ มีปุ่ม 🔧 เปิดใบแจ้งซ่อม ต่อรายใบที่ `status='fail'` และยังไม่มีใบซ่อม
>   · ใบที่เปิดแล้วโชว์ชิป `🔧 ใบซ่อม <MO_NO>` (ตอบ "แก้แล้วรึยัง" ได้จากหน้าตรวจเลย)
> - **ไม่เพิ่ม permission key ใหม่** — gate ด้วย `can('mtn_repair','report')` เดิม (seed ทุก role อยู่แล้ว)
> - insert ทน 42703 (ยังไม่ apply migration = เปิดใบได้ แต่ **ต้อง toast บอกว่าผูกกลับผลตรวจไม่ได้** ห้ามเงียบ)
>
> #### ⚠️ กฎเหล็ก — "ชนิดอุปกรณ์" ไม่ได้ล็อกว่า "ใครเป็นคนตรวจ" (2026-08-11 · คำสั่ง user)
> เลือกชนิดเป็น `Die` **ไม่ได้แปลว่าต้องเป็นทีมแม่พิมพ์ตรวจ** — ฝ่ายผลิตตรวจแม่พิมพ์/จิ๊ก/ปั๊มลมเองในหมวด **AM** ได้ ถ้าตั้งใจให้ตรวจ
> **`checklists.department` เป็นตัวตัดสินว่าใครตรวจเสมอ · `jigs.equipment_type` เป็นแค่ "ของชิ้นนี้คืออะไร"** (สองแกนตัดกัน ห้ามยุบรวม — หลักเดียวกับ `equipment_kind` vs `equipment_category`)
> **ตรวจแล้ว 2026-08-11 · 3 หน้าทำถูกอยู่แล้ว:** `PMSetup` (equipment_type เป็น property ของอุปกรณ์ ไม่ผูก department · ลิสต์เพิ่มอุปกรณ์เห็นทั้ง 565 ตัวรวมแม่พิมพ์) · `PMCheckData` (union — "มี checklist ของแผนกนี้" **หรือ** ชนิดตรงกับ `equip_type` default ของทีม) · `PMSchedule` (ยึด checklist ของ department ล้วน)
> **🔴 `DailyPM` (ทะเบียน AM) ผิด — แก้แล้ว:** `prodOnly` ตัด `equipment_type` jig/die + `equipment_category` facility ออก **แบบตายตัว** → ตั้งจุดตรวจ AM ให้แม่พิมพ์ที่ PM Setup ได้ แต่ **เครื่องไม่มีวันโผล่ในลิสต์ลงทะเบียน = ไม่มีทางให้ operator ตรวจ** · แย่กว่านั้นคือ PMCheckData มีบล็อกส้ม "มีรายการตรวจ AM แล้ว แต่ยังไม่ได้ลงทะเบียน" **ชี้ทางไปลงทะเบียนที่ลงไม่ได้จริง** = ทางตันที่มองไม่เห็น
> **กติกา: `amEquipIds` (เครื่องที่มี checklist ของ AM แล้ว) ชนะเงื่อนไขชนิด/หมวดทั้งหมด** — default ยังกรองให้ลิสต์สะอาด แต่สิ่งที่คนตั้งใจตั้งไว้ต้องไม่ถูกกรองทิ้ง · **จุดใหม่ที่กรองอุปกรณ์ด้วย `equipment_type`/`equipment_category` ต้องมีข้อยกเว้นแบบนี้เสมอ**
>
> #### ⚠️ จุดตรวจชนิด "ค่าวัด" — โหมดเกณฑ์ต้องเป็น state ห้าม derive จากค่าที่กรอก (2026-08-11 · user ทัก "เลือก max-min กับน้อยกว่าไม่ได้")
> PM Setup มี 3 โหมดเกณฑ์: `≥ ต่ำสุด` (lsl) · `≤ สูงสุด` (usl) · `ช่วง min–max` (ทั้งคู่) — **DB มีแค่ `jig_checkpoints.lsl`/`usl` ไม่มีคอลัมน์โหมด**
> เดิม derive โหมดจากค่าที่กรอก → **ล็อกตายอยู่โหมดเดียว**: ตอนเริ่ม lsl/usl ว่างทั้งคู่ = ได้ `gte` เสมอ · กด "≤ สูงสุด"/"ช่วง" แล้วไม่มีอะไรเปลี่ยน (ปุ่มเหมือนกดไม่ติด) · ซ้ำร้าย **โหมด `gte` ซ่อนช่อง usl อยู่ = ไม่มีทางกรอก usl ได้เลย** จึงเข้าโหมดอื่นไม่ได้ตลอดกาล
> **กติกา: เก็บ `_mmode` เป็น state (client-only ขึ้นต้น `_` ไม่ลง DB — pattern เดียวกับ `_key`/`_frameKey`)** · โหลดจาก DB ค่อย derive ครั้งเดียวตอน map · เปลี่ยนโหมดล้างเฉพาะช่องที่โหมดใหม่ไม่ใช้
> **ฝั่งหน้าตรวจ (`measureStatus` ใน PMCheckData) รองรับครบ 3 โหมดอยู่แล้ว** (`lsl != null && v < lsl` / `usl != null && v > usl`) — ปัญหาอยู่ที่ฝั่ง setup อย่างเดียว
> **⚠️ validate ตอนบันทึก (เพิ่ม 2026-08-11):** ชนิดค่าวัด **ต้องมีเกณฑ์อย่างน้อย 1 ช่อง** — ไม่มีเกณฑ์ = `measureStatus` ไม่มีอะไรให้ fail → **จุดตรวจผ่านตลอดกาล แต่จอขึ้นเขียวว่าตรวจแล้ว** (หลอกคนอ่านผล) · และ `min >= max` = NG ตลอด ก็บล็อกเช่นกัน
>
> #### ⚠️ กฎเหล็ก — หน้าที่ถูก embed ในหน้ารวม (PmHub/DailyChecker) ห้ามใส่ `overflow` ให้ container ตัวเอง (2026-09-02 · user ทัก "ยิ่งหัวข้อเยอะ ข้อหลังๆ มองไม่เห็นรูป")
> `PMCheckData` ออกแบบเป็น app-shell (`page{height:100%}` · `main{overflow:hidden}` · `body{overflowY:auto}`)
> แต่ `PmHub` ไม่ได้กำหนดความสูง ⇒ `height:100%` **ตกเป็น `auto`** ⇒ 2 กล่องนั้นกลายเป็น
> **scroll container ที่ไม่มีวันเลื่อน** (เนื้อหาสูงเท่าไหร่กล่องสูงตาม) — ดูเผินๆ เหมือนไม่มีอะไรเสีย
> แต่มัน **"ขัง" `position:sticky` ของรูปเครื่องไว้ข้างใน** → เอกสารเลื่อน รูปเลื่อนตามหายไป
> ⇒ **sticky ไม่เคยทำงานเลยสักครั้ง** และไม่มี error ใดๆ ให้เห็น
> - **flex child ล้นแนวนอนแก้ด้วย `minWidth:0` ไม่ใช่ `overflow:hidden`** (ตัวหลังเป็นตัวขัง sticky)
> - **จอแคบ/มือถือ: รูปเป็น "แถบติดบน" พื้นหลังทึบ + พับเก็บได้** (จำที่ `pm_viewer_open`) · รูปเตี้ยลง
>   (190px มือถือ / 260px แท็บเล็ต) + ตัดบรรทัดอธิบายออก (`compact`) — 480px บนมือถือกินเกือบทั้งจอ
>   ⇒ ที่เหลือต้องเป็นของรายการตรวจเกินครึ่งจอ · **พับแล้วต้องมีปุ่มกางคืน ห้ามหายเงียบ**
> - **⚠️ `scrollMarginTop` ของแถวเช็คต้องมาจากการ *วัด* ความสูงแถบ (ResizeObserver) ห้ามเดา** (กฎ §6.8) —
>   `scrollIntoView({block:'nearest'})` ตอนคลิกหมุด จะเลื่อนแถวไปนอนใต้รูปพอดี = กดแล้วไม่เห็นสิ่งที่เพิ่งกด
>
> #### ⚠️ รูปหลายมุมของเครื่อง = ของกลาง · หมุดจุดตรวจ = ของแต่ละแผนก (2026-08-11 · user ทัก "ทำไมรูปยังค้างอยู่")
> `jig_images` (spin 8 มุม) ผูกกับ **ตัวเครื่อง** ทุกแผนกเห็นชุดเดียวกัน — แต่ **`jig_checkpoints.image_id` (หมุดปักอยู่เฟรมไหน) ผูกกับ `checklist` ของแผนก** → **จุดตรวจของแต่ละแผนกอยู่คนละมุมของเครื่องได้** (AM ตรวจด้านหน้า · MTN เปิดตู้ไฟด้านหลัง)
> **บั๊กที่เจอ:** `showPhoto` เช็คแค่ `frames.length > 0` ไม่ได้เช็คว่ามีจุดตรวจของแผนกที่เปิดอยู่ไหม → เปิดแท็บที่ยังไม่มี checklist **ยังโชว์รูปหมุนมุมที่ 1/8 เปล่าๆ ไม่มีหมุดสักจุด** ดูเหมือนหน้าพร้อมใช้งานทั้งที่ไม่มีอะไรให้ตรวจ (จอกว้างยิ่งหนัก เพราะ 2 คอลัมน์ทำให้รูปกินซ้ายเต็ม)
> **กติกา: `showPhoto` ต้องมี `checkpoints.length > 0` เสมอ** — ตัวเครื่องยืนยันได้จาก thumbnail บนหัวเรื่องอยู่แล้ว
> **ห้ามปล่อยให้ทางตัน** — จอว่างต้องบอกด้วยว่า **แผนกไหนมีจุดตรวจของเครื่องนี้อยู่** (`listChecklistsByDept`) เป็นชิปกดสลับแท็บไปดูได้เลย ไม่ใช่ให้ไปไล่กดทีละแท็บเอง

- **AM ฝ่ายผลิต แยกจาก PM หน่วยงานช่าง:** `/daily-pm` = operator/หัวหน้าไลน์เช็คเครื่อง**ผลิต**รายวัน (department `production` + registry `pm_daily_line_targets`) · ลิสต์ลงทะเบียน AM กรองเฉพาะ**เครื่องผลิต** (ตัด `equipment_type` jig/die + `equipment_category` facility/utility ออก — เดิมโชว์ทุกอย่างปนกัน · DailyPM.jsx `prodOnly`) · PM หน่วยงานช่าง (JIG/DIE/MTN) แยกตามส่วนงานที่หน้า PMSchedule/PMCheck/PMSetup ตามปกติ · **1 เครื่องมีได้ทั้ง checklist ผลิตรายวัน + checklist ช่างรายไตรมาส** (คนละ department คนละ checkpoints — pmChecklists key = equipment_id+module+department)
> #### ⚠️ กฎเหล็ก — "เริ่มผลิต" ของนาฬิกา AM = **เปิดใบผลิต** ไม่ใช่ปิดใบ (2026-08-24 · feedback หน้างาน)
> *"recheck ที เหมือนไม่สอดคล้องกับ daily report ที่กำลังเปิดกะ"* — จอ AM ขึ้น **"ยังไม่เริ่มผลิต" ทั้ง 7 ไลน์** ขณะกะเดินอยู่จริง
> ต้นเหตุ 2 ชั้น (แก้แล้วทั้งคู่ · ต้อง **deploy edge `pm-daily-scan`** ด้วย ไม่งั้นจอกับตัวเตือนตัดสินคนละเวลา):
> 1. **ใช้ `prod_orders.confirmed_at` (ปิดใบ = ผลิตเสร็จ) เป็นจุดเริ่มนับ** → ใบที่กินหลายชั่วโมงทำให้สถานะค้าง idle ทั้งเช้า
>    แล้วนาฬิกา 60 นาทีเพิ่งเริ่มเดินตอนใบแรก*จบ* — ตรงข้ามกับ AM ที่ต้องตรวจ **ต้นกะ** · เปลี่ยนเป็น **`opened_at`** (fallback `confirmed_at` เผื่อใบเก่า)
> 2. **เทียบชื่อไลน์ตรงตัว ไม่ดูครอบครัวไลน์** → อุปกรณ์ลงทะเบียนที่ไลน์แม่ (HYDROFORM) แต่กะเปิดที่ไลน์ลูก (HDF1/HDF2)
>    = การ์ดไลน์แม่ค้าง "ยังไม่เริ่มผลิต" ตลอดกาล · ใช้ `getLineFamilyNames` แล้ว (pattern มาตรฐาน) · ชื่อไลน์ที่ไม่มีในทะเบียนยังคงไว้ ไม่ตกหาย
> - **`idle` มี 2 ความหมาย ต้องแยกให้เห็นบนป้าย** — `ยังไม่เปิดกะ` vs `เปิดกะแล้ว · ยังไม่มีใบผลิต` (เดิมเขียนรวมว่า "ยังไม่เริ่มผลิต" = จอโกหกตอนกะเดินอยู่)
> - จุดใหม่ที่ถามว่า "ไลน์นี้เริ่มผลิตหรือยัง" ให้ยึด `opened_at` ของใบแรก **ห้ามใช้ `confirmed_at`**
- **ยึด `checklists.department` เป็นหลักในการแยกทีม** (คำสั่ง user — 1 เครื่องมี PM หลายทีมได้: ผลิตตรวจรายวัน / MTN เข้า PM รายไตรมาส = คนละ checklist คนละ department) · **PMCheckData เดิมกรองด้วย `equipment_type` (jig/die/machine)** ทำให้ของชิ้นเดียวโผล่คนละแท็บกับ PMSchedule → แก้เป็น union: โผล่ใต้ทีม D ถ้า **มี checklist ของ D อยู่แล้ว** (ตรงกับ PMSchedule) **หรือ** ประเภทอุปกรณ์ = `equip_type` default ของทีม (ให้เริ่ม checklist ใหม่ได้) · `clDeptByJig` (jig_id→Set(department)) ใน PMCheckData
> #### ⚠️ กฎเหล็ก — checklist เกิดตอน "บันทึก" เท่านั้น ห้ามสร้างตอนเปิดดู (2026-08-05)
> `checklists` แถวหนึ่ง = **การประกาศว่า "แผนกนี้รับผิดชอบตรวจเครื่องนี้"** — ทั้ง PMSchedule/PMCheckData/DailyPM ตัดสินว่าเครื่องโผล่ในแท็บแผนกไหนจากการมีอยู่ของแถวนี้ (`clDeptByJig`) · **แค่เปิดดูจึงต้องไม่สร้าง**
> **บั๊กที่เกิดจริง:** `PMSetup` (เปิด modal แก้ไข) + `PMCheckData` (เลือกเครื่อง) เรียก `getOrCreateChecklist` ตอนเปิด → **เปิดดูเครื่อง X ในแท็บ JIG MTN ครั้งเดียว = เกิด checklist เปล่า 0 จุดตรวจของ JIG MTN ทันที แล้วเครื่อง X ค้างอยู่ในแท็บ JIG MTN ตลอดไป** ดูเหมือน "เครื่องอยู่ผิดหมวด/ผิดทีม" · พบเงาแบบนี้ **24 แถว** (jig/die/production ปนกันทั้งที่ไม่มีใครลงจุดตรวจ)
> **กติกาปัจจุบัน:**
> - **เปิดดู → `findChecklist()` (อ่านอย่างเดียว)** · **บันทึกจริง → `getOrCreateChecklist()`** — ทั้ง 2 ฟังก์ชันอยู่ `src/lib/pmChecklists.js` · หน้าใหม่ที่แตะ checklist ต้องแยก 2 จังหวะนี้เสมอ
> - ไม่มี checklist ของแผนกที่เปิดอยู่ = ฟอร์มเปล่าให้เริ่มลงจุดตรวจใหม่ (PMSetup) / ข้อความอธิบาย + ชี้ทางไปตั้งค่า (PMCheckData) — **ไม่ใช่ error**
> - **unique index `checklists_equipment_module_dept_uniq` (equipment_id, module, department)** บังคับ 1 เครื่อง = 1 checklist ต่อแผนก (กันเงาซ้ำระดับ DB)
> - migration ล้างเงา + ย้าย daily→production + unique index: `20260805_pm_dept_ownership_cleanup.sql` (DR · apply แล้ว — ล้าง 24 เงา, จุดตรวจครบ 254 ไม่หาย)
> - **ลงจุดตรวจไว้ผิดแผนกแล้วไม่ต้องพิมพ์ใหม่:** PM Setup → เปิดแก้ไขเครื่อง → แผง **"🗂️ รายการตรวจของเครื่องนี้ (แยกตามแผนก)"** โชว์ทุกแผนกพร้อมจำนวนจุด/จำนวนครั้งที่เคยตรวจ + ปุ่ม **➡️ ย้าย** (เปลี่ยน `department` ของ checklist เดิม — **ประวัติการตรวจ + แผน PM ย้ายตามไปทั้งก้อน** เพราะทุกตารางอ้าง `checklist_id` เดียวกัน) และ **⧉ คัดลอก** (สำเนาเฉพาะนิยามจุดตรวจไปแผนกอื่น ประวัติแยกกัน) · helper `listChecklistsByDept`/`moveChecklistDept`/`copyChecklistToDept`
> - **ปลายทางมีประวัติการตรวจแล้ว = ย้ายทับไม่ได้** (FK `inspections.checklist_id` เป็น `NO ACTION` — DB กันอยู่แล้ว) ให้ใช้คัดลอกแทน · ปลายทางมีจุดตรวจแต่ยังไม่เคยตรวจ = ถาม confirm ก่อนแทนที่
> - **เพิ่มรายการตรวจให้ "แผนกใหม่" ของเครื่องที่มีอยู่แล้ว:** PM Setup ลิสต์เฉพาะเครื่องที่มี checklist ของแผนกที่เลือก (แท็บ = ความรับผิดชอบ) → ทำได้ 2 ทาง (ก) แท็บแผนกนั้น → **เพิ่มอุปกรณ์ใหม่ → เลือกจาก Machine Master** เครื่องเดิม — **save จะใช้แถว `jigs` เดิม (lookup ด้วย `machine_id`) ไม่สร้างอุปกรณ์ซ้ำ** (เดิม mint uuid ใหม่เสมอ = 2 แถวต่อเครื่อง · ยังไม่เคยเกิดจริง ตรวจแล้ว 0 เคส) และมีข้อความบอกว่าเครื่องนี้แผนกไหนตรวจอยู่บ้าง (ข) เปิดเครื่องในแท็บแผนกที่มีจุดตรวจอยู่ → **⧉ คัดลอก** ไปแผนกใหม่
> - **⚠️ รูปจุดตรวจถูกแชร์หลังคัดลอก** (แถวสำเนาอ้าง `image_path` เดิม ไม่ก๊อปไฟล์) → การเก็บกวาดไฟล์ตอน save ของ PMSetup เช็ค `jig_checkpoints` ก่อนลบทุกครั้ง (ไฟล์ที่แผนกอื่นยังอ้างอยู่ = ไม่ลบ)

- **DEPT_LABEL (`src/lib/pmSchedule.js`) เปลี่ยนชื่อแสดงผลให้ตรงฝั่งแจ้งซ่อม** (MTN/JIG MTN/DIE MTN/PRODUCTION แทน "ซ่อมบำรุง/Die Maintenance/ฝ่ายผลิต") · key เดิมคงไว้
- **MtnRepair dropdown "แจ้งถึงทีมช่าง"/ฟิลเตอร์/master ดึงจาก `pmTeamsSync().dept_name` (data-driven จาก `mtn_teams`) แล้ว (2026-07-24)** — เลิก hardcode `MTN_DEPTS` (เหลือเป็น fallback default ในลายเซ็น component เท่านั้น เท่ากับ `DEFAULT_TEAMS` ให้พฤติกรรมเดิมเมื่อ table ว่าง) · `loadPmTeams()` เรียกตอน mount → `setMtnDepts` แล้วส่งผ่าน `cp` ไปทุก sub-component · เพิ่ม/แก้ทีมที่ตาราง `mtn_teams` dropdown ตามทันที
> #### ⚠️ กฎเหล็ก — ทีมช่างเก็บเป็น "รหัส" แสดงเป็น "ชื่อ" (unify แล้ว 2026-08-06)
> เดิมมี **2 encoding ปนกัน**: ฝั่งใบซ่อมเก็บชื่อ (`mtn_orders.mtn_dept = 'JIG MTN'`) ฝั่ง PM เก็บรหัส (`checklists.department = 'jig_maintenance'`) → เทียบ/join ข้ามฝั่งตรงๆ ไม่ได้ ต้องพึ่ง normalize ตลอด
> **รวมเป็นรหัส (`mtn_teams.key`) หมดแล้วทั้ง 2 project** — migration `20260806_unify_team_encoding_dr.sql` + `_main.sql` (**apply แล้ว**): DR = `mtn_orders.mtn_dept`/`returned_from_dept`, `mtn_technicians.dept`, `mtn_labor_rates.dept`, คอลัมน์ `team` ทุกตัว · Main = `telegram_channels.team`, `profiles.mtn_teams[]`
> - **เหตุผล:** ชื่อทีมเปลี่ยนได้ (เคยเปลี่ยน PRODUCTION → "AM (ผลิตตรวจเอง)") ถ้าเก็บชื่อ ข้อมูลเก่ากำพร้าทันที — หลักเดียวกับ role / process_type / line_type ทั้งระบบ
> - **เขียน DB = `teamKeyOf(x)` เสมอ · แสดงผล = `deptNameOf(x)` เสมอ** (`src/utils/mtnTeams.js`) · dropdown ใช้ `teamOptions()` (`value` = key, ข้อความ = ชื่อ) หรือ `<TeamOpts>` ใน MtnRepair — **ห้ามเอาชื่อทีมไปเก็บลง DB อีก**
> - `teamForItem` / `teamForSection` / `teamsForUser` / `MTN_TEAMS` **คืน key ทั้งหมดแล้ว** (เดิมคืนชื่อ)
> - helper ยัง normalize ชื่อ→รหัสต่อไป (ข้อมูลที่ export/พิมพ์ไว้ก่อน หรือคนกรอกมือ อาจยังเป็นชื่อ) — **ห้ามถอด `teamKeyOf` ออกเพราะคิดว่า data สะอาดแล้ว**
> - **✅ edge function deploy แล้ว (2026-08-06)** — `send-mtn-notification` v7 + `mtn-daily-summary` v3 (`verify_jwt=false` ทั้งคู่ตามเดิม — **client เรียกโดยไม่ส่ง token ถ้าตั้ง true จะพังทั้งระบบแจ้งเตือน**) · จัดกลุ่มด้วย key เสมอ (ข้อมูลเก่าที่เป็นชื่อไม่แตกเป็นคนละกลุ่ม) + แปลงเป็นชื่อทีมตอนแสดงผ่าน `teamName()` · สรุปรายวันดึงชื่อสดจาก `mtn_teams` (เปลี่ยนชื่อทีมแล้วตามทันที) fallback ค่าเริ่มต้นถ้าดึงไม่ได้ · client ยังส่ง**ชื่อทีม**ใน payload แจ้งเตือน (`notifyMtn`) ซึ่งถูกต้องทั้ง edge เก่าและใหม่
- **ยังเหลือ:** UI จัดการทีม (เพิ่ม/แก้ row ใน `mtn_teams`) = future (ตอนนี้แก้ผ่านตาราง) — แต่ **`mtn_teams` apply จริงแล้ว** (ตรวจ 2026-08-06 · เอกสารเก่าเขียนว่ายังไม่ apply = ไม่จริงแล้ว)

> ### ⚠️ กฎเหล็ก — "ตัวตนอุปกรณ์ = ของกลาง · รายละเอียด = มุมมองของแต่ละทีม" (2026-08-06 · คำสั่ง user)
> ระบบช่าง **4 ทีมใช้ร่วมกัน** (MTN / JIG MTN / DIE MTN / PRODUCTION) — สิ่งที่ต้อง "ตรงกัน" มีแค่**ตัวตนของอุปกรณ์**
> `machines.id` / `machines.machine_no` / `jigs.id` / ชื่อเครื่อง = **ของกลางชุดเดียว ห้ามแตกตามทีม**
> (ไม่งั้นเครื่องเดียวกันกลายเป็นคนละตัวในสายตาแต่ละทีม → สืบประวัติข้ามทีมไม่ได้ ซึ่งคือหัวใจของระบบซ่อมบำรุงรวม)
> **แต่ "รายละเอียด" อื่นเป็นมุมมองเฉพาะทีม ต้องแยก** — JIG มอง Locator/Clamp/Gripper ชำรุด · DIE มองแม่พิมพ์บิ่น/สึก · MTN มองมอเตอร์/อินเวอร์เตอร์
>
> **วิธีแยก: คอลัมน์ `team` แบบ nullable — `null`/ว่าง = 🌐 ใช้ร่วมทุกทีม (common)**
> (pattern เดียวกับ `lpa_questions.line_name` null = ข้อ common) · ค่าใช้ `mtn_teams.key` · กรองผ่าน **`filterByTeam(rows, team)` / `inTeamScope()` ใน `src/utils/mtnTeams.js` จุดเดียว — ห้ามเขียนเงื่อนไขกรองทีมเอง** (normalize ให้แล้ว รับทั้ง key `jig_maintenance` และ label `JIG MTN`)
>
> | ระดับ | ตาราง | มิติทีม |
> |---|---|---|
> | **ของกลาง (ห้ามแยก)** | `machines`, `jigs`, `mtn_teams`, `pm_facility_areas` | — ไม่มีโดยตั้งใจ |
> | **มุมมองทีม** | `mtn_problem_types`, `mtn_item_types`, `mtn_repair_types`, `mtn_spare_categories`, `pm_checkpoint_categories`, `pm_checking_methods` | `team` (เพิ่ม 2026-08-06 · migration `20260806_mtn_master_team_scope.sql`) |
> | | `mtn_technicians`, `mtn_labor_rates` | `dept` (มีอยู่เดิม) |
> | | `mtn_spare_parts`, `mtn_rack_maps`, `pm_coordination_tasks` | `team` |
> | | `checklists` | `department` — **1 เครื่องมีได้หลาย checklist คนละทีม** (ดูกฎ checklist ownership) |
> | | `mtn_orders` | `mtn_dept` (label) |
> | **derive เอา ไม่ต้องมีคอลัมน์** | `inspections`, `inspection_results`, `jig_checkpoints`, `pm_plans`, `pm_plan_deferrals/reminders` | ← `checklists.department` |
> | | `mtn_order_parts`, `mtn_stock_txns`, `mtn_spare_usage_monthly` | ← part/order |
> | | `mtn_rack_cells` | ← `mtn_rack_maps.team` |
> | | `pm_facility_points` | ← jig |
>
> **จุดที่ต้องกรอง (ทำแล้ว):** ⚙️ ข้อมูลหลัก → `SimpleList` มีแถบเลือกทีม + ตั้งทีมรายแถว (นับ "ซ่อน N รายการของทีมอื่น" ไม่ให้หายเงียบ) · **ฟอร์มแจ้งซ่อม** ชนิดอุปกรณ์/ลักษณะปัญหา กรองตามทีมที่แจ้งถึง + **ล้างค่าที่เลือกไว้เมื่อเปลี่ยนทีมแล้วค่าเดิมไม่อยู่ในลิสต์** (กฎ cascade §5.3) · **ขั้นรับงาน** ประเภทงานซ่อมกรองตามทีมของใบ · **คลังอะไหล่** dropdown หมวดกรองตามทีม + ตั้งทีมของหมวดได้ · **PM Setup** จัดการประเภทจุดตรวจ/วิธีตรวจ (`TaxonomyManagerModal` รับ prop `teams` → มี dropdown ทีม + badge บอกว่าแถวไหนของทีมไหน · ว่าง = 🌐 ทุกทีม แบบเดียวกับ `equip_types` ที่มีอยู่เดิม) · **แท็บ 🔧 ประเภทงานซ่อม** ใน ⚙️ ข้อมูลหลัก (เดิมไม่มี UI เลย แก้ได้ทางตารางอย่างเดียว — รหัสย่อของประเภทเป็นส่วนหนึ่งของเลข MO เปลี่ยนแล้วมีผลกับใบที่ออกเลขใหม่เท่านั้น)
> **⚠️ หมายเลขเครื่องใน dropdown ห้ามกรองตามทีม** — ของกลาง ทุกทีมต้องอ้างเครื่องเดียวกันได้
> #### ⚠️ ใบซ่อมเก็บ "ชื่อ" ของ taxonomy เป็น snapshot — เปลี่ยนชื่อ master ต้องถามก่อน (2026-08-06)
> `mtn_orders` เก็บ **ข้อความ** ของ `item_type` / `problem_characteristic` / `problem_detail` / `repair_type` / `assigned_to`
> (ไม่ใช่ id) — **ตั้งใจ** ตาม pattern snapshot เดียวกับ `lpa_audit_answers.question_text`, `ojt_training_attendees.emp_name`:
> ใบเก่าต้องอ่านออกเหมือนวันที่แจ้ง แม้ master ถูกแก้/ลบทีหลัง
> **แต่ KPI พาเรโต้จัดกลุ่มด้วยข้อความ** (`byChar[o.problem_characteristic]`) → เปลี่ยนชื่อใน ⚙️ ข้อมูลหลัก **กราฟแตกเป็น 2 แท่งทันที**
> → แก้ชื่อในตาราง `NAME_CASCADE` (MtnRepair.jsx) จะ**ถามก่อน**ว่าให้ใบเก่าตามไปด้วยไหม (ตกลง = รวมกลุ่มเดียว · ยกเลิก = คงประวัติเดิม)
> **ห้ามเขียนทับประวัติเงียบๆ** และ **เพิ่มฟิลด์ taxonomy ใหม่ที่ใบซ่อมเก็บเป็นชื่อ ต้องมาเติมใน `NAME_CASCADE` ด้วย**
> (ทางเลือกระยะยาวถ้าอยากเลิกพึ่งข้อความ: เพิ่มคอลัมน์ `*_id` คู่กับ snapshot แล้วให้ KPI จัดกลุ่มด้วย id — ยังไม่ทำ)
>
> #### ⚠️ กฎเหล็ก — "ใครเห็น" ≠ "ใครเป็นเจ้าของ" ในลิสต์แจ้งซ่อม (2026-08-11 · คำสั่ง user)
> ความจริงหน้างานที่ทำให้ต้องแยก 2 แกน (เดิมใช้ `team` ตัวเดียวทำทั้ง 2 หน้าที่ = ล็อกแน่นเกินจริง):
> - **ช่างฝ่ายผลิต (AM) เจอปัญหาก่อนใครเสมอ → ต้องเห็นทุกลักษณะปัญหา/ทุกชนิดอุปกรณ์** — เป็น **กฎในโค้ด** (`SEE_ALL_TEAMS` ใน `mtnTeams.js`) ไม่ใช่ข้อมูล เพราะถ้าให้ไปติ๊กทีละแถวจะตกหล่นแน่
> - **DIE MTN แยกชัดเจน** — งานแม่พิมพ์ไม่เกี่ยวกับช่างส่วนอื่น
> - **JIG MTN ↔ MTN ทับซ้อนกัน** — มีแค่ JIG Fixture ที่เป็นของ JIG แน่ๆ เรื่องอื่นทับซ้อนในบางเคส → ต้องระบุ "ทีมอื่นที่เห็นด้วย" ได้รายแถว
>
> | คอลัมน์ | ความหมาย | ใช้ที่ |
> |---|---|---|
> | `team` | **เจ้าของ — ใครแก้แถวนี้ได้** | `filterByTeam` / `canEditRow` (⚙️ ข้อมูลตั้งต้น) |
> | `shared_teams text[]` | **ทีมอื่นที่เห็นด้วย (เห็นได้ แก้ไม่ได้)** | `visibleToTeam` / `visibleForTeam` (ฟอร์มแจ้งซ่อม) |
>
> **ห้ามยุบ 2 คอลัมน์นี้เป็นตัวเดียว** — ยุบแล้วได้อย่างใดอย่างหนึ่ง: ล็อกแน่นจนผลิตไม่เห็น หรือหลวมจนใครก็แก้ของทีมอื่น
> **ฟอร์มแจ้งซ่อมต้องใช้ `visibleForTeam` · หน้าจัดการ master ใช้ `filterByTeam`** — สลับกันเมื่อไหร่พังทันที
> ติ๊กทีมที่เห็นร่วมได้ที่ ⚙️ ข้อมูลตั้งต้น (ปุ่ม 👁 รายแถว) · migration `20260811_mtn_problem_group_and_sharing.sql`
>
> **⚠️ ฟอร์มแจ้งซ่อม: เลือกชนิดอุปกรณ์แล้ว "ห้ามเขียนทับทีมที่ user เลือกไว้" (2026-08-19 · feedback "ชนิดอุปกรณ์โชว์มั่ว")** — เดิม `onItem` ตั้ง `mtn_dept = deptForItem(it)` ทุกครั้ง → เลือกทีม JIG แล้วจิ้มชนิด 🌐 ของกลาง ทีมเด้งไป MTN เงียบๆ (ลิสต์ลักษณะปัญหาสลับชุด + ใบเข้าคิวผิดทีม) · กติกา: **เติมทีมให้เฉพาะตอนยังไม่เลือก (fill-if-empty)** · ยังไม่เลือกทีม = dropdown ชนิดจัด **optgroup ตามทีม** (`deptNameOf` + 🌐 ท้ายสุด) ไม่กองรวมปนกัน
>
> #### ⚠️ ลักษณะปัญหาเป็น 2 ชั้น: กลุ่มใหญ่ → หัวข้อย่อย (2026-08-11 · feedback ทีมงานหลังลองใช้จริง)
> *"ลักษณะปัญหาถ้าใส่ทั้งหมดมันเยอะ พนักงานเลือกลำบาก · ช่องรายละเอียดที่กรอก Auto ข้อมูลซ้ำกับช่องเดิม"*
> — นับจริง: **DIE MTN เห็น 29 ตัวใน dropdown เดียว** (ผลข้างเคียงจากการ seed ลิสต์ให้ครบเมื่อ 2026-08-10)
> - **`mtn_problem_types.group_name`** = กลุ่มใหญ่ · null = ตกกลุ่ม "อื่นๆ" (ทำงานได้ปกติ ทยอยจัดได้)
> - **`mtn_orders.problem_group`** ต้องเก็บลงใบด้วย ไม่งั้นพาเรโต้ระดับกลุ่มทำไม่ได้ (KPI จัดกลุ่มด้วยข้อความ snapshot)
> - **ต้องมีช่องค้นหาข้ามชั้นเสมอ** — ช่างที่แจ้งทุกวันรู้อยู่แล้วว่าจะเลือกอะไร บังคับเลือกกลุ่มก่อน = เพิ่มขั้นตอนให้เขา
> - **ช่อง "รายละเอียดปัญหา (auto)" ถูกตัดออก** — เดิมเติมค่าจาก `detail` ของ master ซึ่งซ้ำกับช่อง "ระบุรายละเอียด (พิมพ์เอง)" ที่มีอยู่แล้ว
> - **พาเรโต้ KPI เป็น 2 ระดับ** (กลุ่ม → กดแตกดูหัวข้อย่อย) · ใบเก่าก่อนมีกลุ่ม = "ไม่ระบุกลุ่ม" สีเทา **ห้ามเดากลุ่มย้อนหลังให้**
> - **insert ใบซ่อม tolerant กับ `problem_group`** (42703 → ตัดคอลัมน์แล้วลองใหม่) — ยังไม่ apply migration ต้องแจ้งซ่อมได้ปกติ
>
> #### ⚠️ กฎเหล็ก — master ของทีมช่าง "ใครเป็นเจ้าของ คนนั้นแก้" (2026-08-11 · คำสั่ง user)
> เดิมใครมีสิทธิ์ `mtn_repair:manage_master` (admin/manager/**ทุกคน role `mtn`**) **แก้ได้ทุกแถวของทุกทีม** — MTN เข้าไปเปลี่ยนชื่อของ DIE MTN ได้ · ลบของ JIG ได้ · แถว 🌐 ของกลางแก้ทีเดียวกระทบทุกทีม (user เทียบกับเคส "แย่งกันตั้งเลข MAT")
> **กติกาใน `SimpleList` (⚙️ ข้อมูลตั้งต้น):**
> - แถว **ของทีมตัวเอง** (`profiles.mtn_teams`) → แก้/ลบ/ย้ายทีมได้
> - แถว **ของทีมอื่น** → อ่านอย่างเดียว (input readOnly + 🔒 ดูอย่างเดียว + tooltip บอกว่าเป็นของทีมไหน)
> - แถว **🌐 ใช้ร่วมทุกทีม (`team` null)** → **admin/manager เท่านั้น** — แก้ทีเดียวกระทบทุกทีม
> - **เพิ่มรายการใหม่**: คนทีมเดียวเพิ่มได้แต่ของทีมตัวเอง (dropdown ตัด 🌐 ออก) · สร้างของกลางได้เฉพาะหัวหน้า
> - **⚠️ fallback บังคับ: user ที่ยังไม่ได้ตั้ง `mtn_teams` = ไม่ล็อก** (แสดงแถบเตือนแทน) — ไม่งั้นวันที่ deploy ช่างที่ยังไม่ถูกตั้งทีมจะแก้อะไรไม่ได้ทั้งระบบ · ตั้งทีมที่ `/add-user`
> - **เปลี่ยนทีมของแถว = confirm เสมอ ห้ามเงียบ** — ของหายจากลิสต์ทีมเดิมทันที (เคสจริง: ติ๊กของเดิมเป็น JIG แล้วทีม MTN เหลือชนิดอุปกรณ์ตัวเดียว)
> - **`cascadeRename` บอก breakdown รายทีม** (ใบไหนของทีมไหน) + เตือนพิเศษเมื่อกระทบหลายทีม — เขียนทับประวัติข้ามทีมคือความเสี่ยงที่แรงที่สุดของหน้านี้
> - **ที่กันไว้อยู่แล้ว:** ลบ = soft delete (`is_active=false` ใบเก่ายังอ่านออก กู้ได้) · `mtn_item_types`/`mtn_problem_types`/`mtn_spare_categories` อยู่ใน `DR_AUDIT_TABLES` → `audit_log` รู้ว่าใครแก้
> - **📜 แท็บ "ประวัติการแก้ไข" ใน ⚙️ ข้อมูลตั้งต้น (2026-08-11)** — `MasterAuditLog` อ่าน `audit_log` ฝั่ง DR (300 รายการล่าสุด · กรองตามตาราง) โชว์ **ใคร/เมื่อไหร่/ค่าเก่า → ค่าใหม่** รายฟิลด์ · actor มาจาก `updated_by_name` ที่ wrapper ใน `supabaseClient.js` ฝังให้ (DR เป็น anon ไม่มี `auth.uid()`) · เพิ่มตาราง master ใหม่เข้าแท็บนี้ = เติมใน `AUDIT_TABLES` + ต้องอยู่ใน `DR_AUDIT_TABLES` ด้วย
>
> - **ใช้กติกาเดียวกันแล้วที่ `TaxonomyManagerModal`** (ประเภทจุดตรวจ/วิธีตรวจ ใน PM Setup — `pm_checkpoint_categories`/`pm_checking_methods` ก็มีคอลัมน์ `team`) · รับ prop `role` + `myTeams` (จาก `teamsForUser`) · **จุดใหม่ที่ reuse component นี้กับตารางที่มี `team` ต้องส่ง 2 prop นี้ด้วย** ไม่งั้นกลับไปแก้ข้ามทีมได้เหมือนเดิม
>
> **เพิ่ม master ใหม่ในระบบช่าง ให้ถามก่อนว่า "ของกลางหรือมุมมองทีม"** — ถ้าเป็นมุมมองทีมต้องมีคอลัมน์ `team` + กรองด้วย `filterByTeam` + **ล็อกตามเจ้าของแบบเดียวกัน** ตั้งแต่แรก
> **`teamForItem(name, itemRows)` เป็น data-driven แล้ว** — อ่าน `mtn_item_types.team` ก่อน แล้วค่อย fallback เดาจากชื่อ (JIG→JIG MTN ฯลฯ) ที่ hardcode ไว้เดิม
> **⚠️ backfill เป็น `null` ทั้งหมดโดยตั้งใจ = ทุกทีมยังเห็นทุกแถวเหมือนก่อน apply** — การไล่ติ๊กว่าแถวไหนของทีมไหนเป็นงาน "จัดข้อมูล" ทำผ่าน UI ไม่เดาให้ใน migration
>
> #### ⚠️ ลิสต์ตั้งต้นของระบบแจ้งซ่อมเป็นของ JIG MTN ล้วน — ทีมใหม่ต้อง seed ลิสต์ของตัวเอง (2026-08-10)
> `mtn_item_types` / `mtn_problem_types` ที่ seed ไว้ตอนแรก (`20260714_mtn_work_order.sql`) **ยกมาจากระบบ AppSheet ของ JIG MTN ทั้งดุ้น** — ชนิดอุปกรณ์ 7 ตัวเป็น JIG/ROBOT/CONVEYOR/NUT FEEDER · ลักษณะปัญหา 21 ตัวเป็นเรื่อง jig fixture/โรบอท/เซนเซอร์
> → **ทีม DIE MTN เปิดฟอร์มแจ้งซ่อมแล้วไม่มีอะไรตรงกับงานตัวเองเลย** (ทีมงานแจ้งเข้ามาเอง 2026-08-10) · ทีม MTN (เครื่องจักร) ก็มีอาการเดียวกัน — ยังไม่มีลิสต์มอเตอร์/อินเวอร์เตอร์/ระบบไฮดรอลิก
> - **แม่พิมพ์ seed แล้ว** — `20260810_mtn_die_master_lists.sql` (DR): ชนิดอุปกรณ์ 5 (DIE TANDEM/PROGRESSIVE/TRANSFER/SINGLE/SET — **ขึ้นต้น "DIE" ทุกตัว** เพื่อให้ `teamForItem` fallback เดาทีมถูกแม้คอลัมน์ team ยังไม่ apply · ชนิดอิง `die_sets.kind` ที่มีจริง) + ลักษณะปัญหา 22 (คมตัด → อาการที่ชิ้นงาน → การไหลของเศษ → ชิ้นส่วนกลไก → ระบบประกอบ) ทั้งหมด `team='die_maintenance'`
> - **ไม่ seed "อื่นๆ" ซ้ำ** — ใช้แถว `อื่นๆ` เดิมที่เป็น common ร่วมกัน ไม่งั้นทีมเดียวเห็น "อื่นๆ" สองตัว
> - **⚠️ seed อย่างเดียวยังไม่พอที่จะให้ลิสต์สั้นลง** — แถวเดิม 28 ตัวยัง `team=null` (common) จึงติดมาในลิสต์ทุกทีมเสมอ (user เปิดฟอร์มจริงแล้วเจอ: เลือก DIE MTN ยังขึ้น JIG/ROBOT/STATIONARY ครบ) → **`20260810_mtn_split_lists_by_team.sql` (apply แล้ว 2026-08-10)** ติ๊กของเดิมเป็น `jig_maintenance` + seed ลิสต์ทีม MTN (เครื่องจักร 9 ชนิด · ปัญหา 13)
>   - **⚠️ 2 ก้อนนี้ต้องรันคู่กันเสมอ ห้ามรันก้อนติ๊กอย่างเดียว** — โยน JIG/ROBOT/STATIONARY/NUT FEEDER ไปเป็นของ JIG แล้ว **ทีม MTN เหลือชนิดอุปกรณ์แค่ `CONVEYOR` ตัวเดียว** ซึ่งเป็น required field = แจ้งซ่อมเครื่องจักรไม่ได้เลย · **ติ๊กของทีมหนึ่ง = ต้องเช็คเสมอว่าทีมที่เหลือยังมีของพอใช้ไหม**
>   - คงเป็น 🌐 ของกลางโดยตั้งใจ: `CONVEYOR` · เซนเซอร์ชำรุด · กระบอกลม · ลมรั่ว · ระบบไฟฟ้า · เครื่องมาร์ค · Poka-yoke · อื่นๆ (เจอได้ทุกทีม — ผูกทีมใดทีมหนึ่งไม่ได้)
>   - ผลหลัง apply: DIE MTN เห็น 6 ชนิด · JIG MTN 7 (เท่าเดิม ไม่มีอะไรหาย) · MTN 10
>
> #### ⚠️ ช่อง "หมายเลขเครื่อง" ในฟอร์มแจ้งซ่อม ต้องแยกตามชนิดอุปกรณ์ (2026-08-10)
> **บั๊กที่เจอจริง:** เลือกทีม DIE MTN + ชนิดอุปกรณ์ `DIE SINGLE` แล้วช่องหมายเลขเครื่อง**ขึ้นแต่เครื่องจักร** (`HDF-01`) ไม่มีแม่พิมพ์ให้เลือกเลย — ต้นเหตุ 2 ชั้น:
> 1. `loadMasters` **ไม่ได้ select `equipment_kind`** → แยกแม่พิมพ์ (262) ออกจากเครื่องจักร (214) ไม่ได้ ทั้งที่อยู่ตาราง `machines` เดียวกัน
> 2. `lineMachines` กรอง `m.line_name === f.line_name` เสมอ แต่ **แม่พิมพ์ผูก `line_name` เป็นชื่อกลุ่มเครื่องปั๊ม** (`LINE A ( 800 Ton )`) ซึ่ง**ไม่มีใน `production_lines`** → กรองด้วยไลน์ที่เลือกในฟอร์มไม่มีวันเจอแม่พิมพ์
>
> **กติกา:** `wantDie` (ชนิดอุปกรณ์ขึ้นต้น `DIE` · หรือทีม `die_maintenance` ตอนยังไม่เลือกชนิด) → ลิสต์ **แม่พิมพ์ทั้งหมด ไม่กรองไลน์** (แม่พิมพ์ถอดย้ายเครื่องได้ ไลน์ไม่ใช่ตัวจำกัด) + label เปลี่ยนเป็น "หมายเลขแม่พิมพ์ (N ตัว · ทุกไลน์)" · ไม่ใช่งานแม่พิมพ์ → **ตัด `die` ออกจากลิสต์เครื่องจักร** (เดิมปนกันมาตลอด) · ทะเบียนว่าง = เตือนสีส้มชี้ไป `/die-registry` ไม่ปล่อยเงียบ
> **จุดใหม่ที่มี picker เลือกอุปกรณ์ ต้องถามก่อนว่า "ชนิดไหน" แล้วกรองด้วย `equipment_kind` — ห้ามกรองด้วย `line_name` อย่างเดียว** (สมมติฐาน "อุปกรณ์ผูกกับไลน์" ใช้ไม่ได้กับแม่พิมพ์)
> - **เพิ่มลิสต์ให้ทีมใหม่ ทำที่ `/mtn-repair` → ⚙️ ข้อมูลตั้งต้น ได้เลยไม่ต้องแก้โค้ด** (SimpleList มีตัวกรองทีม + ติ๊กทีมรายแถว) — migration ใช้เมื่อ seed ก้อนใหญ่ทีเดียว

> ### ⚠️ กฎเหล็ก — "ชนิดอุปกรณ์" เป็น **แกน** ไม่ใช่ **ตาราง** · แยกหน้าจอได้ ห้ามแยกฐานข้อมูล (2026-08-10)
> **ปัญหาที่เจอ:** `machines` มี 505 แถว active แต่ **262 แถวเป็นแม่พิมพ์ ไม่ใช่เครื่องจักร** (คีย์ปนกันมาตั้งแต่ต้นเพราะไม่เคยมีแกน "ชนิด") → ทะเบียนเครื่องจักรอ่านไม่รู้เรื่อง · dropdown เลือกเครื่องมีแม่พิมพ์ปน · สถิติจำนวนเครื่องผิด
> **คำถามที่ถูกถามและคำตอบ: "แยกเป็น 3 ตาราง machines/jigs/dies ดีไหม" → ไม่**
> `machines` เป็น **ตารางตัวตนของอุปกรณ์** อยู่แล้ว — `machine_no` unique และ **MO / downtime / prod_orders / QR / ผังเครื่องจักร อ้างเลขนี้รวม 12+ ตาราง** · แยกตาราง = ทุกตารางที่อ้างอุปกรณ์ต้อง polymorphic (`equipment_type + equipment_id`) + QR ต้องมี prefix ต่อชนิด + **ทำลายหัวใจของระบบซ่อมบำรุงรวมคือ "เปิดอุปกรณ์ตัวนี้ เห็นประวัติทั้งหมด"**
> → ใช้โมเดล **SAP PM / Maximo: 1 ตัวตน + แกนชนิด + ตารางส่วนขยายต่อชนิด**
> - **`machines.equipment_kind`** (`machine`/`die`/`jig`/`facility` · null = machine) — source of truth `src/utils/equipmentKinds.js`
> - **⚠️ คนละแกนกับ `equipment_category`** (`production`/`facility` = **ที่ตั้ง/การใช้งาน**) — เครื่องจักรอยู่ facility ได้ · แม่พิมพ์อยู่ production **สองแกนตัดกัน ห้ามยุบรวม**
> - **ส่วนขยายต่อชนิด:** `equipment_die` (1:1 กับ machines — `machine_id` เป็นทั้ง PK และ FK · OP/ตัน/shot/regrind) · ชนิดอื่นเพิ่มตารางส่วนขยายแบบเดียวกัน **ห้ามยัดคอลัมน์เฉพาะชนิดลง `machines`**
> - **`die_sets`** = ชุดแม่พิมพ์ (**1 พาร์ท = 1 ชุด**) · `kind` tandem/progressive/transfer/single · `pieces_per_stroke` (งานคู่ LH/RH = 2 — ต่อกับกฎ SCADA "1 stroke ≠ 1 ชิ้น") · `mat_no` โยง Product Master
> - **`die_op_types`** = master กระบวนการ (13 ค่า data-driven) — เพิ่มกระบวนการใหม่ไม่ต้องแก้โค้ด
> - **แยก "หน้าจอ" ได้เต็มที่:** `/machine-database` default กรอง `equipment_kind='machine'` · `/die-registry` เป็นมุมมองแม่พิมพ์ — **แยกหน้าจอ ≠ แยกฐานข้อมูล**
> - **`jigs.equipment_type` ของ "แถวเงา" ต้อง derive จาก `machines.equipment_kind` เสมอ** (`jigEquipTypeOf`) — เดิมตั้งอิสระจากเครื่องจริงจนเพี้ยน (เครื่องอัดลม/คูลลิ่งทาวเวอร์ 9 ตัวกลายเป็น `jig`)
> - **backfill 2026-08-10:** machine 214 · die 262 · facility 29 · ไม่ระบุ 0 · ชุดแม่พิมพ์ 92 (tandem 52 · progressive 26 · single 14) ผูกแล้ว 259/262 — เลือก **"ติดป้าย" ไม่ใช่ "ย้ายตาราง"** reference ทุกเส้นยังอยู่ครบ rollback ง่าย · **ฟิลด์ที่แกะจากชื่อไม่ออกปล่อยว่าง ห้ามเดา** (ยังไม่ระบุตัน 180 · ไม่ระบุ OP 49 · ไม่ระบุกระบวนการ 90) → เป็น worklist ในหน้า `/die-registry` ไม่ใช่ bug
> - migration: `20260810_equipment_kind_and_die_master.sql` · `20260810_backfill_dies_from_machines.sql` · `20260810_sync_shadow_jig_equipment_type.sql` (**apply แล้วทั้งหมด 2026-08-10**)

### Direct / Indirect Labor + รวมช่างเข้าฐานพนักงาน (2026-07-22)

**คนทุกคนอยู่ที่ `employees` ที่เดียว** — operator (ฝ่ายผลิต) และช่างซ่อมบำรุง เป็น employee เหมือนกัน ต่างกันแค่ **ประเภทแรงงาน** และ **section**

- **ประเภทแรงงานตั้งที่ผังองค์กร** (`org_nodes.labor_type` — 'direct'/'indirect') ตั้งได้ทั้ง **section และ department** จาก OrgSetup · **⚠️ ช่างส่วนใหญ่อยู่ระดับแผนก (department) ไม่ใช่ section** → พนักงาน derive **จาก department ก่อน แล้ว section** · seed default (section): ผลิต (PD*/GOR/HYDRO/ASSY/LINE ฯลฯ) = direct, ที่เหลือ = indirect · migration `20260722_org_labor_type.sql`
- **derive ผ่าน `src/utils/laborType.js`** (`buildLaborMap(orgNodes)` รวมทั้ง section+department → `laborTypeOf(section, department, laborMap)` เช็คแผนกก่อน · fallback heuristic: ชื่อเข้าเกณฑ์สนับสนุน MTN/JIG/DIE/QA/คลัง/ธุรการ/ขาย = indirect ก่อน แล้วเกณฑ์ผลิต = direct) — **ห้าม hardcode ว่า node ไหน direct/indirect ในหน้า** อ่านจาก org_nodes เสมอ
- แสดง/กรองในหน้า `/operator` (badge 🔧/🗂️ + ปุ่มกรอง Direct/Indirect) — direct = 🔧 เขียว, indirect = 🗂️ ฟ้า
- **ช่างซ่อมบำรุง = พนักงานแผนก/ส่วน MTN/JIG/DIE** (indirect) มี `employee_skills` เหมือน operator (สกิลซ่อมบำรุง) · สร้างแผนก/ส่วน MTN/JIG/DIE ใน OrgSetup (ตั้ง labor_type = indirect) แล้วลงทะเบียนช่างที่ Register/operator ปกติ
> ### ⚠️ กฎเหล็ก — "ช่างของฝ่ายผลิต" ต้องติ๊กเอง ระบบเดาให้ไม่ได้ (2026-08-21 · feedback หน้างาน)
> *"ช่างของผลิต role มันไม่มีให้เลือก เค้าอยู่ระหว่างระดับส่วนกับระดับกลุ่ม ในลำดับขั้นการรับ-จ่ายงานซ่อม ขั้นตอนที่ 2 ไป 3"*
> **ติด 2 ชั้น แก้ทั้งคู่ · migration `20260821_production_technician_setup.sql` (Main)**
>
> | ชั้น | อาการ | แก้ด้วย |
> |---|---|---|
> | ① เลือกเป็น "ช่างผู้รับผิดชอบ" ขั้น 2 ไม่ได้ | ลิสต์ช่างมาจาก `employees` โดย**เดาทีมจากชื่อแผนก** (`teamForSection`) ซึ่งจับได้แค่ JIG/DIE/MTN — **ทีม `production` เดาไม่ได้โดยตั้งใจ** (ส่วนงานผลิตมีหลายชื่อ PD1/PD2/GOR… เดาเหมาจะไปโดน QA/ธุรการ) ⇒ ช่างฝ่ายผลิต **ไม่มีวันโผล่** ไม่ว่ากรอกข้อมูลยังไง | คอลัมน์ **`employees.mtn_team`** — ติ๊กที่ `/operator` ช่อง 🔧 ทีมช่างซ่อม · **ชนะการเดาเสมอ** (null = ไม่ใช่ช่าง/เดาเหมือนเดิม) |
> | ② ทำขั้น 2-4 ไม่ได้ | `mtn_repair:service` seed ไว้แค่ admin/manager/mtn | คีย์ใหม่ **`mtn_repair:service_own_team`** = ทำได้เฉพาะ**ใบของทีมตัวเอง** |
>
> - **⚠️ ห้ามเพิ่ม role "ช่างฝ่ายผลิต"** — กฎเหล็ก "เจอแกนใหม่ให้เพิ่ม attribute ห้ามเพิ่ม role" · แกน "เป็นช่างของทีมไหน" มีที่อยู่แล้วคือ `profiles.mtn_teams`
> - **คีย์ใหม่คุม 2 ชั้นพร้อมกัน:** role ต้องถือคีย์ **และ** ตัวบุคคลต้องถูกตั้ง `profiles.mtn_teams` ให้ตรงกับทีมของใบนั้น → **ติ๊กให้ role `leader` ไม่ได้แปลว่าหัวหน้ากลุ่มทุกคนแตะใบซ่อมได้** (ไม่ได้ตั้งทีม = `userTeams` ว่าง = ไม่ผ่าน) — วิธีนี้ได้ granularity ระดับคนโดยไม่ต้องมี role ใหม่
> - `canEditStep` + ปุ่มขั้นถัดไป เช็ค `ownTeamService` เพิ่มจาก `service` เดิม · **ใบทีมอื่นยังทำไม่ได้**
> - **ปุ่มขั้นถัดไปหายเพราะสิทธิ์ = ขึ้นแถบบอกว่าต้องตั้งอะไรที่ไหน** (UI-CONVENTIONS §6.9) — เดิมหายเงียบ คนถึงต้องมาถาม
> - `employees.mtn_team` เขียนเป็น **update แยก best-effort** ใน `/operator` — ยัดลง payload หลักไม่ได้ (42703 = บันทึกพนักงานพังทั้งใบ) · select ใน MtnRepair ก็ tolerant (ไม่มีคอลัมน์ = ถอยไปชุดเดิม)
>
- **MtnRepair dropdown "มอบหมายช่าง" ดึงจาก employees ทีมช่าง** (`employees.mtn_team` ก่อน → ไม่มีค่อยเดาด้วย `teamForSection` ใน `mtnTeams.js` map **department ก่อน แล้ว section** →ทีม) + รวมกับ `mtn_technicians` เดิม (ช่างเฉพาะกิจนอกฐานพนักงาน — fallback ไม่ลบ) · **ช่างเดิมทั้ง 14 คน (JIG MTN 7 + MTN 7) ย้ายเข้า employees แล้ว 2026-07-22** (รหัสชั่วคราว TECH-JIG-xx/TECH-MTN-xx รอเติมรหัสจริง · mtn_technicians ทุกแถวถูกปิด is_active=false เหลือไว้เป็นประวัติ — migration `20260722_migrate_technicians_to_employees.sql`) · `assigned_to` ยังเก็บเป็น **ชื่อ (text)** เหมือนเดิม (backward-compatible) · ⚙️ MasterTab: ช่างจากฐานพนักงานแสดง read-only (แก้ที่หน้าพนักงาน) เพิ่มได้เฉพาะช่างเฉพาะกิจ · **MtnRepair อ่าน employees ผ่าน client `supabase` (Main, authenticated)** ไม่ใช่ supabaseDR

---
