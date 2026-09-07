# Role System

> ย้ายมาจาก `CLAUDE.md` (2026-09-03 — แยกไฟล์เพื่อลด context) · โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน


> **role = "ชุดสิทธิ์ใช้ระบบ" ไม่ใช่ตำแหน่งงาน (2026-07-10)** — ตำแหน่งจริงในโรงงาน
> (ผู้จัดการฝ่าย/หัวหน้าแผนก/หัวหน้าส่วน/วิศวกร/เจ้าหน้าที่/ช่างเทคนิค ฯลฯ) เก็บที่ `profiles.position`
> (text อิสระ มี datalist แนะนำใน AddUser) ใช้แสดงตัวตน/รายงาน/ลายเซ็นเท่านั้น **ไม่มีผลต่อ permission**
> ตัวอย่าง: คน QA ทุกระดับ (technician→manager) ใช้ role `qa` เหมือนกันถ้าทำงานในระบบเหมือนกัน
> ต่างกันแค่ position · ถ้าวันหน้าระดับต่างกันต้องได้**สิทธิ์**ต่างกันจริง ค่อยเพิ่ม role ใหม่ + แถวใน
> role_permissions (ระบบรองรับ) — **ห้ามเพิ่ม role ตามชื่อตำแหน่งโดยที่ชุดสิทธิ์ไม่ต่างจาก role เดิม**
>
> **ตัวเลือก "ตำแหน่งงาน" (position) รวมศูนย์ที่ `src/utils/positions.js` จุดเดียว (2026-07-22)** — master list ไทยชุดเดียวใช้ร่วมทั้ง **พนักงาน (`employees.position` — Register/operator)** และ **user (`profiles.position` — AddUser)** · `positionOptionsWith(current)` เติมค่าเก่านอกลิสต์ (เช่น Operator/Leader/Technician/Engineer) ไว้หัวลิสต์ให้ยังเลือก/แสดงได้ไม่หาย · AddUser ยังมี "อื่นๆ (พิมพ์เอง)" · **ห้าม hardcode ลิสต์ position ซ้ำในหน้าใดๆ** เพิ่ม/แก้ตำแหน่งแก้ที่ไฟล์นี้ที่เดียว (เดิมกระจาย 3 หน้า ลิสต์ไม่ตรงกัน — operator/Register เป็นอังกฤษ, AddUser เป็นไทย)

11 roles ใน enum `user_role`: `admin, manager, supervisor, leader, qa, document_control, sale, mtn, engineer, planner_store, display`

> **ชื่อแสดงผลของ role ไม่ใช้คำตำแหน่งบริษัทแล้ว (2026-07-13)** — เพื่อไม่ให้ชนกับ `profiles.position`
> ชื่อ/ไอคอน/สี/คำอธิบายทั้งหมดอยู่ที่ **`src/utils/roleMeta.js` จุดเดียว** (`ROLE_META`, `ROLE_OPTIONS`, `roleLabel()`)
> — **ห้ามนิยาม label ของ role ซ้ำในหน้าใดๆ** (เคยซ้ำ 4 ไฟล์: App/DeptHub/AddUser/PermissionsManagement — รวมแล้ว)
> รหัสใน DB (enum) คงเดิม เปลี่ยนเฉพาะการแสดงผล · ข้อความ UI ที่พูดถึง role ให้เรียกตามชื่อใหม่ ไม่เรียก Manager/Supervisor/Leader

| Role (รหัสใน DB) | ชื่อแสดงผล | สิทธิ์หลัก |
|------|-----------|-----------|
| `admin` | 🛡️ ผู้ดูแลระบบ (System Admin) | ทุกอย่าง รวมถึง Add User, จัดการสิทธิ์ |
| `manager` | 🏭 สิทธิ์ทั้งฝ่าย (Full Access) | ดูและแก้ไขได้ทุกหน้า ยกเว้น Add User/จัดการสิทธิ์ |
| `supervisor` | 🏢 สิทธิ์ระดับส่วน (Section Scope) | จัดการเฉพาะ section ตัวเอง, Register พนักงาน, อนุมัติ 4M step 1 |
| `leader` | 👥 สิทธิ์ระดับไลน์ (Line/Team Scope) | เห็นเฉพาะ line/team ของตัวเอง |
| `qa` | ✅ งานคุณภาพ (Quality) | ดู Dashboard + Report, อนุมัติ 4M step QA |
| `document_control` | 🗂️ งานเอกสาร (Document Control) | จัดการเอกสาร CQI-15, ปฏิทินบริษัท |
| `sale` | 🚚 ขาย-จัดส่ง (Sales & Delivery) | ทีมขาย — Planner & Sales, Delivery, Kanban, Dashboard (seed: `20260708_sale_role_demand_page_permissions.sql`) |
| `mtn` | 🔧 ซ่อมบำรุง (Maintenance) | ทีมซ่อมบำรุง (MTN/JIG/DIE) — หน้า PM ทั้งหมด, ผังเครื่องจักร, ฐานข้อมูลเครื่องจักร (seed: `20260713_mtn_role.sql`) |
| `engineer` | ⚙️ งานวิศวกรรม (Engineering) | process engineering — Product Master `products:create/edit` (BOM/EC/New Model) โดยไม่พ่วงอำนาจจัดการผลิต/อนุมัติ QA/งาน PM · **ตั้งใจไม่รวมกับ qa/mtn** เพราะอำนาจอนุมัติคุณภาพกับ master เครื่องจักรต้องแยกคนถือ (seed: `20260713_engineer_planner_store_roles.sql`) |
| `planner_store` | 📦 แผนงาน-คลัง (Planner & Store) | ฝั่งคลัง/แผนงาน — Store, Kanban, Rack, Rundown, อัพโหลด Forecast (`heijunka:operate`, `line_stock:issue/manage_rounds`, `rack_center:operate`, `demand:upload`) — แยกจาก `sale` ที่โฟกัส Delivery/Ship-to (seed เดียวกัน) |
| `display` | 📺 จอแสดงผล (View Only) | ดูอย่างเดียว (จอแสดงผลลอย ไม่ login เป็นคน) |

### สิทธิ์ตามหน้า/action — `role_permissions` (data-driven, ไม่ hardcode)

- ตาราง `role_permissions (role, permission_key, allowed)` เป็น source of truth เดียวสำหรับ "role ไหนเข้าหน้า/ทำ action ไหนได้บ้าง"
- โหลดผ่าน `loadPermissions()` (cache ใน memory) แล้วเช็คด้วย `hasPermission(key, role)` / `canAccessPage(path, role)` — ไฟล์ `src/utils/permissions.js`
- **⚠️ กับดัก Supabase ตัด 1000 แถว/query (เจอจริง 2026-08-03):** `role_permissions` โตเกิน 1000 แถวแล้ว (1,135) — query ที่ไม่ `.range()` ได้แค่ 1000 แถวแรก **แถวที่ seed ทีหลัง (เช่น bucket `dept_admin`) หายเงียบ** = สิทธิ์ใน DB ถูกแต่ปุ่ม/เมนูไม่โผล่ (fail-closed) · แก้แล้ว: `loadPermissions()` + หน้า `/permissions` ดึงแบบแบ่งหน้า · **โค้ดใหม่ที่ select ตารางนี้ (หรือตารางใดที่โตได้เกิน 1000) ต้อง paginate เสมอ**
  - **⚠️ กับดักซ้อน — "paginate ตัวที่เคยพังไปแล้ว 1 ตัว" ไม่พอ ต้องดูทั้ง `Promise.all` (เจอรอบที่ 3 · 2026-08-27):** `LineStock.jsx load()` มี 6 query ในก้อนเดียว แต่ paginate แค่ `line_stock_summary` ตัวที่เคยมีคนแจ้งบั๊ก · อีก 4 ตัว (`bom_items` 408 · `dr_products` 287 · `kanban_standards` · `parts_master` 287) เป็น `select()` เปล่า — **ยังไม่ถึง 1000 วันนี้ แต่เป็นตารางที่โตตามการลงข้อมูล** · ตัวที่เจ็บที่สุดคือ **`bom_items` เพราะเป็นที่มาของ "ไลน์ลูกปลายทาง" ใน `StockMoveToChild`** → ตกหล่นเมื่อไหร่ พาร์ทนั้นกลายเป็น **"⚠ ใช้หลายไลน์ ต้องเลือกเอง"** ทั้งที่จริงชี้ไลน์เดียวชัดเจน = **เสนอผิดแบบเงียบ แล้วคนเลือกปลายทางผิด → หักสต็อกผิดตัว ย้อนยาก** · **กติกา: เจอ `Promise.all` ที่มีตัวหนึ่ง paginate แล้ว = สัญญาณว่าอีกตัวถูกลืม ให้ไล่ทั้งก้อนเสมอ** · และ **`fetchAllPages` คืน `{rows, error, truncated}` ต้องเช็ค 2 ตัวหลังแล้วบอกผู้ใช้ ห้ามอ่านแต่ `rows`** (โหลดไม่ครบ = จอดูปกติทุกอย่าง แต่ข้อเสนอ/ชื่อพาร์ท/min-max หายไปเฉยๆ)
- `admin` bypass เสมอ (return true ทันทีไม่ query cache) กันกรณี config ผิดจนตัวเองเข้าไม่ได้
- แก้ได้จากหน้า `/permissions` (`src/pages/PermissionsManagement.jsx`) — ตาราง matrix role × permission key, toggle แล้ว upsert ทันที
- permission key รูปแบบ `page:/route` สำหรับสิทธิ์เข้าหน้า, `resource:action` สำหรับสิทธิ์ทำงานในหน้า (เช่น `products:create`, `oee:set_target`) — โหลดจาก `permission_catalog` แสดงในแท็บ "สิทธิ์การทำงาน"
- **⚠️ กฎเหล็ก — เพิ่มหน้า/สิทธิ์ใหม่ ต้องลง "ทะเบียน" ด้วย ไม่งั้น admin ปรับจาก UI ไม่ได้เลย (audit 2026-08-06):** `role_permissions` เก็บ**ค่า** แต่ตัวที่ทำให้ "โผล่ให้ติ๊ก" ในหน้า `/permissions` เป็นคนละที่ — seed แถวอย่างเดียวไม่พอ:
  - **หน้าใหม่** → เพิ่ม `{ key: 'page:/xxx', label: '...' }` ใน **`PAGE_GROUPS`** (`src/pages/PermissionsManagement.jsx`) **ในคอมมิทเดียวกับที่เพิ่ม route** · ไม่เพิ่ม = สิทธิ์ล็อกตามที่ seed ไว้ ปรับไม่ได้ (audit 2026-08-06 เจอค้าง 8 หน้า: `/qr-labels` `/dept-dashboard` `/group-overview` `/adoption-outlook` `/energy` `/pe-docs` `/vsm` `/die-registry` — เปิดให้ทุก role แต่ปิดไม่ได้)
  - **action ใหม่** → insert แถวใน **`permission_catalog`** ด้วย · ไม่ insert = ไม่ขึ้นในตาราง (เคยตกหล่น 8 key: `lpa:*` 3 · `ojt:*` 2 · `doc_forms:manage` · `pm_coord:manage` · `transport:manage` — แก้แล้ว migration `20260806_permission_catalog_gaps.sql`)
    - ⚠️ **คอลัมน์คือ `resource` + `action` แยกกัน ไม่ใช่ `permission_key`** (key ที่โค้ดเช็คคือ `resource:action` ที่ประกอบขึ้นตอน runtime) · เขียน insert ผิดคอลัมน์ = error 42703
    - ⚠️ **`group_name` ต้องเป็นชื่อหมวดตาม `NAV_GROUP_ORDER` เท่านั้น + `sort` ตามช่วงของหมวด** (ภาพรวม 1xx · ฝ่ายผลิต 2xx · วิเคราะห์ & รายงาน 3xx · พนักงาน & ทักษะ 4xx · Logistic 5xx · ซ่อมบำรุง 6xx · QA/QC 7xx · PE 8xx · ตั้งค่า 9xx — เลือกเลขที่ยังว่าง ห้ามซ้ำ) — พิมพ์ชื่อหมวดเอง = หมวดกำพร้าโผล่กลางตาราง (audit 2026-08-19 เจอ 'ซ่อมบำรุง'/'ประชุมแถวเช้า' เป็นหมวดเดี่ยว + sort ชนกัน 8 คู่ → จัดใหม่ทั้งตารางด้วย migration `20260819_permission_catalog_regroup.sql` **apply แล้ว 2026-08-19** — cosmetic ล้วน ไม่แตะ role_permissions · ผลตรวจ: 9 หมวด 89 แถว ตรงเป๊ะ) · **⚠️ แล้วยังหลุดอีกรอบ:** `20260818_org_divisions.sql` seed `org:manage_divisions` ด้วย `group_name='ตั้งค่า/ฐานข้อมูล'` (ชื่อผิด) แต่ถูก apply **หลัง** audit รอบนั้น จึงตกสำรวจ → เก็บด้วย `20260824_permission_catalog_org_divisions_group.sql` (**apply แล้ว 2026-08-24** · ผลตรวจ: 9 หมวด 94 แถว · หมวดตั้งค่าฯ sort ถึง 940) — **บทเรียน: migration ที่ seed catalog แล้ว apply ทีหลัง ต้องตรวจ group_name ซ้ำเสมอ audit รอบเก่าไม่ครอบให้** · **`PAGE_GROUPS` ใน PermissionsManagement.jsx ต้อง mirror `NAV_ITEMS` เสมอ** (หมวด/ลำดับ/ชื่อ — เพิ่มหน้าใหม่แก้ 2 ที่ให้ตรงกัน) · QC checklist ข้อ C6
  - **ลงทะเบียนแล้วยังไม่จบ** — กับดัก `enum_range` (ดูย่อหน้าถัดไป) ทำให้ role ที่เพิ่มทีหลังไม่มีแถว ต้องไปติ๊กที่ `/permissions` เองอยู่ดี
  - **ห้ามใส่ key ลงทะเบียนโดยที่โค้ดไม่เรียกใช้** — ติ๊กแล้วไม่มีผล คนตั้งค่างง (ลบ `org:manage`/`users:manage`/`permissions:manage` ออกแล้ว — 3 หน้านั้นคุมด้วย `page:*` + admin-only พอ)
  - **คอลัมน์ 🛡️ แอดมินหน่วยงาน โผล่เฉพาะแท็บ "สิทธิ์การทำงาน"** (`PAGE_COLS` กรอง `bucket` ออกจากแท็บหน้า) เพราะ `hasPermission()` บล็อก `page:*` ของ bucket ไว้ — ติ๊กในแท็บหน้าไม่มีผลจริง **ห้ามเอาคอลัมน์นี้กลับเข้าแท็บการเข้าถึงหน้า**
  - **ตรวจว่าครบไหม:** เทียบ key ที่โค้ดเรียก (`can('x','y')` / `canDelete` / `hasPermission` — ระวัง call แบบ dynamic เช่น `approve_${role}` ใน EventLog และ `STEP_PERM[step]` ใน MtnRepair) กับ `permission_catalog` และเทียบ `NAV_ITEMS` กับ `PAGE_GROUPS`
- **🛡️ แอดมินหน่วยงาน (Department Admin) — 2 ชั้นต่อหน่วยงานสนับสนุน (2026-08-03 · คำสั่ง user):** แยก "คนใช้งาน" (ดู/ใช้ แต่แก้ไม่ได้) ออกจาก "แอดมินหน่วยงาน" (แก้ master/ตั้งค่า/อนุมัติ — เฉพาะ scope หน่วยงานตัวเอง ไม่ใช่ admin ระบบ) โดย**ไม่เพิ่ม role รายหน่วยงานเป็นสิบตัว**
  - **โมเดล = flag ต่อ user** `profiles.is_dept_admin` (migration `20260803_dept_admin.sql`) ซ้อนบน role เดิม · role เดิม (mtn/qa/sale/planner_store/supervisor/leader...) = **ชั้น user** · ติ๊ก flag = **ชั้นแอดมินหน่วยงาน**
  - **กลไก:** `dept_admin` เป็น **"bucket สิทธิ์" ใน `role_permissions`** (เพิ่มใน enum `user_role` แต่**ไม่ assign เป็น base role ให้ใคร**) · `permissions.js` module-level `_deptAdmin` (ตั้งจาก `App.jsx fetchProfile` ผ่าน `setDeptAdmin` เหมือน `setDrActorName`) → `hasPermission(key, role)` เช็ค base role ก่อน **แล้ว fallback bucket `dept_admin:${key}`** ถ้า flag เปิด — **ไม่ต้อง thread flag ผ่าน `can()` หลายร้อยจุด** · bucket มีเฉพาะ **action (ไม่มี `page:*`)** → ไม่ปลดล็อกหน้าใหม่ (แอดมินหน่วยงานเห็นหน้าตาม base role เท่านั้น) — **บังคับในโค้ดแล้ว** (`hasPermission` ข้าม bucket เมื่อ key ขึ้นต้น `page:` · QC audit 2026-08-03 — เดิมพึ่งความถูกต้องของ seed อย่างเดียว ซึ่งเสี่ยงเพราะ migration หน้าใหม่ที่ seed ด้วย `enum_range` จะแจก `page:*` ให้ทุก role ในอีนัมรวม `dept_admin`) · scope ยังจำกัดตาม section/ทีมของ base role
  - **ตั้งค่า "แอดมินหน่วยงานทำอะไรได้" ที่ `/permissions` คอลัมน์ 🛡️ แอดมินหน่วยงาน** (data-driven · seed default = action ทั้งหมดที่ manager ทำได้) · **ติ๊ก flag ที่ `/add-user`** (checkbox "เป็นแอดมินหน่วยงาน" โผล่ทุก role ยกเว้น admin/display · เขียน best-effort เหมือน mtn_teams) · `roleMeta.js`: `dept_admin` มี `bucket:true` → `ROLE_OPTIONS` (ตัวเลือก base role) ตัดออก, `PERMISSION_COLUMN_ROLES` รวมไว้เป็นคอลัมน์
  - **ผล:** เช่น planner_store (base role ไม่มี `products:edit`) เข้า Product Master/Kanban Std ได้แต่เดิม**แก้ไม่ได้** (ปุ่ม ✏️ แก้ไข gate ด้วย `can('products','edit')`) → ติ๊กแอดมินหน่วยงาน = ปุ่มแก้โผล่ · **จุดใหม่ที่อยากให้แยก user/แอดมิน ให้ gate ด้วย `can(resource,action)` ตามปกติ** — flag จัดการ tier ให้เอง
  - **ยังไม่ทำ (phase 2):** "จัดการ user ในหน่วยงานตัวเอง" (เพิ่ม/แก้ user รายหน่วยงาน) — ต้องแก้ Edge Function `create-user`/`delete-user` (ตอนนี้ admin-only) · ตอนนี้แอดมินหน่วยงานได้ครบ **แก้ master/config + อนุมัติ workflow** แล้ว
  - **⚠️ แท็บ "การเข้าถึงหน้า" ห้ามมีคอลัมน์ `dept_admin` (2026-08-06 · user รายงานว่างง):** `hasPermission` บล็อก `page:*` ของ bucket ไว้ในโค้ดอยู่แล้ว → ช่องติ๊กในแท็บนั้นเป็น**ช่องตาย ติ๊กแล้วไม่มีผล** แต่หน้าจอไม่บอก คนตั้งค่าเลยเข้าใจว่า "ตั้งแอดมินหน่วยงานแล้วน่าจะเข้าหน้าได้" · `PermissionsManagement.jsx` แยก `PAGE_COLS = ROLES.filter(r => !r.bucket)` ให้แท็บหน้าใช้ (`renderPermTable(groups, label, cols)`) + แถบอธิบายว่าต้องติ๊กที่ **base role** ก่อนเสมอ แล้วค่อยเพิ่มอำนาจที่แท็บ action · **เพิ่ม bucket ใหม่ในอนาคตต้องคง filter นี้ไว้**

- **🎭 โหมดจำลองมุมมอง role (View-as · 2026-08-19 · คำขอ user "user แจ้งว่าไม่เห็นหน้านั้น อยากมีโหมดเทสจำลอง role"):** admin จริงกดปุ่ม 🎭 ในเมนูโปรไฟล์ (แผง 👤 rail / ท้าย drawer มือถือ) → `ViewAsModal` เลือก role + องค์ประกอบ scope (leader = ไลน์+ทีม · role อื่น = sections · ติ๊ก 🛡️ แอดมินหน่วยงานได้) → ระบบ render ทั้งแอปด้วยค่า effective นั้น (เมนู/ปุ่ม/ขอบเขตข้อมูลฝั่งจอ ตรงกับที่ user role นั้นเห็นจริง เพราะทุกหน้าอ่าน role ผ่าน `UserContext` + `can()`/`canAccessPage`)
  - **กลไก:** เก็บ config ใน `sessionStorage['esm-view-as']` (**ต่อแท็บ** — เปิดแท็บใหม่ยังเป็น admin ปกติ · refresh คงโหมด) · App root คำนวณ `effRole/effLineId/effTeam/effSections/effMtnTeams/effDeptAdmin` แล้วส่งเข้า ProtectedLayout — honored เฉพาะเมื่อ **role จริง = admin** · `setDeptAdmin()` (module flag ของ bucket) ตามโหมดผ่าน effect · apply/exit = full reload ไปหน้าหลัก (ล้าง state หน้าที่ mount ค้าง)
  - **⚠️ จำลองเฉพาะฝั่งจอ — RLS ฝั่ง DB ยังเป็น admin จริง** การกดบันทึกสำเร็จด้วยสิทธิ์จริงเสมอ (มีแถบเตือนในโมดัล + ป้ายลอย 🎭 ล่างจอบอกโหมด + ปุ่มออก ห้ามถอด) · `setDrActorName` ยังเป็นชื่อจริง (audit ต้องเห็นคนแก้จริง)
  - **⚠️ เพดานกะ (`shiftCapped`) ตัดสินจาก role จริงเสมอ** — admin ที่จำลอง leader ต้องไม่โดนเตะออกท้ายกะ · context มี `realRole` เพิ่มให้หน้าที่ต้องรู้ role จริง
- **legacy `manage_master_data` เกษียณแล้ว (2026-07-22)** — สวิตช์รวมเก่า (แทน `['admin','manager','supervisor'].includes(role)` hardcode ~10 ไฟล์) ถูกแตกเป็นสิทธิ์ย่อยครบแล้ว: `oee:set_target` (ปุ่ม 🎯 ตั้งเป้า OEE) · `ot_master:manage` (Report แผงจองรถ OT — สายรถ/งาน OT) · `management:assign_manpower` (ลากจัดกำลังคนบนผัง) · seed default = admin/mgr/sv เท่าเดิม (พฤติกรรมไม่เปลี่ยน) · migration `20260722_retire_manage_master_data.sql` · แถว `manage_master_data` เดิมใน role_permissions คงไว้แต่ไม่มีโค้ดอ่านแล้ว (เผื่อ rollback) — **ห้ามผูกฟีเจอร์ใหม่กับ manage_master_data อีก**
- **ต่างจาก scoping ตาม section/line/team** (ด้านล่าง) — permission ตอบว่า "เข้าหน้านี้ได้ไหม/ทำ action นี้ได้ไหม" ส่วน scoping ตอบว่า "เห็นข้อมูลแถวไหนบ้าง" สองเรื่องนี้แยกกันคนละกลไก

> #### ⚠️ กฎเหล็ก — RLS ก็ต้อง data-driven: เช็คสิทธิ์ด้วย `has_perm('<key>')` ห้าม hardcode role array ใน policy (2026-08-17)
> UI อ่าน `role_permissions` แต่ **RLS บาง policy ยัง hardcode รายชื่อ role ไว้ใน DB** → 2 ฝั่ง drift กันแล้ว**เพี้ยนได้ 2 ทางสวนกัน** และ build/lint จับไม่ได้เลย (เป็น runtime ฝั่ง DB):
> - **UI ให้ แต่ DB ปฏิเสธ** = ปุ่มโผล่ กดแล้วเด้ง error 42501 (`new row violates row-level security policy`)
> - **UI ซ่อน แต่ DB อนุญาต** = ช่องโหว่ ยิง API ตรงได้ทั้งที่ `role_permissions` ปิดไว้
>
> **เคสจริงที่เจอ (`employee_skills`):** policy เดิมเช็ค `role = any(['admin','manager','supervisor','leader'])` ขณะที่ `role_permissions` บอกว่า `mtn` มี `skills:edit`=true และ `leader`=false → ช่าง MTN **เพิ่มสกิลให้ช่างด้วยกันไม่ได้เลย** (พนักงานสนับสนุน MTN/DIE MTN 18 คน ยังไม่มีสกิลสักแถว) ส่วน leader กลับเขียนได้ผ่านแผงในโมดัลแก้ไขพนักงาน — ขัดกับระบบ farm+ด่านอนุมัติที่ตั้งใจย้ายไปฝั่ง server แล้ว
>
> - **ใช้ `public.has_perm(perm_key text)`** (Main · SECURITY DEFINER · mirror ของ `hasPermission()` ใน `permissions.js`: admin bypass → `role_permissions` ของ base role → bucket `dept_admin` ที่**ห้ามปลดล็อก `page:*`**) · migration `20260817_employee_skills_rls_data_driven.sql`
> - **⚠️ ห้ามเปลี่ยนชื่อพารามิเตอร์ `perm_key`** — มี 21 policy ฝั่ง QA อ้างอยู่ (`qa_parts`/`qa_ncr`/`qa_capa`/`qa_measurements`/`qa_inspection_*`/`qa_characteristics`/`qa_instruments`/`qa_part_drawings`) · เปลี่ยนแล้วได้ error 42P13 ต้อง `drop function` ก่อน ซึ่งจะพา policy ตกไปด้วย → **ใช้ `create or replace` เสมอ**
> - **policy ที่ต้องการหลาย key ให้ `or` กัน** (`employee_skills` = `skills:edit` ∨ `skills:approve_levelup` ∨ `skills:delete`) แล้วปรับต่อที่ `/permissions` ได้เลยไม่ต้องเขียน migration ใหม่
> - **⚠️ RLS ปฏิเสธ UPDATE/DELETE = 0 rows ไม่ error** (เงียบ!) มีแต่ INSERT/upsert ที่โยน 42501 → **โค้ดที่เขียนตารางซึ่งคุมด้วย RLS ต้อง gate ด้วย `can()` ฝั่ง UI ให้ตรงกับ policy ด้วย** อย่าหวังพึ่ง error
> - **ผลของการแก้ (วัดกับผู้ใช้จริง):** ได้สิทธิ์เพิ่ม mtn 8 + planner_store(dept_admin) 1 · **เสียสิทธิ์ leader 17 คน** (ตรงตามที่ `role_permissions` ตั้งไว้)
> #### ⚠️ ขอบเขตสกิล 2 ระดับ: ฝ่าย → เจาะจงหน่วยงาน (2026-08-18 · คำสั่ง user)
> **ที่มา:** ช่างแผนก MTN เปิดโมดัลแก้ไขพนักงานแล้วเจอสกิลฝ่ายผลิต 29 ตัวขึ้น "ไม่เกี่ยวข้อง" เรียงยาวจนหาของตัวเองไม่เจอ
> - **ผังองค์กร *ไม่มี* ชั้นฝ่ายเป็น node โดยตั้งใจ** — ระดับบนสุดคือ **ส่วนงาน** (PD1-4, Planning&Store) กับ **แผนกขึ้นตรงฝ่าย** (MTN, JIG MTN, DIE MTN, QA) · แทรก node ชั้นใหม่จะไปพัง cascade section→department ทุกหน้า
> → ใช้ **ติดป้าย `org_nodes.division` ที่ node ระดับบนสุด แล้วลูกตกทอด** (หลักเดียวกับ `cost_center`/`head_name` ที่ไลน์ลูกตกทอดจากไลน์แม่) · master `org_divisions` (production/maintenance/quality/logistic/office — เพิ่มฝ่ายได้ไม่ต้องแก้โค้ด) · ตั้งที่ `/org-setup` (ช่อง "ฝ่าย (Division)" + ป้ายในลิสต์ที่บอกด้วยว่าค่าไหน "ตกทอด")
> - **`skill_definitions` มี 2 ช่อง:** `scope_division` (ว่าง = ทุกฝ่าย) + `scope_section` (ว่าง = ทั้งฝ่าย) → เลือกได้ 3 แบบ: สกิลกลาง · ทั้งฝ่ายผลิต · ฝ่ายผลิตเฉพาะ PD3
> - **อ่านผ่าน `src/utils/orgDivisions.js` เท่านั้น** (`divisionOfNode`/`divisionOfEmployee`/`skillInScope`/`scopeUnitsForDivision`/`skillScopeLabel`) — **ห้ามเดาฝ่ายจากชื่อ section/department** (ชื่อเปลี่ยนได้ + โรงงานอื่นตอน rollout เรียกไม่เหมือนกัน)
> - **⚠️ ระดับเจาะจงต้องเทียบทั้ง `section` และ `department`** — พนักงานฝ่ายช่าง/คุณภาพมี `section` เป็น **null** (สังกัดแผนกขึ้นตรงฝ่าย) เทียบ section อย่างเดียว = ไม่มีวันตรง · `scopeUnitsForDivision` จึงคืนทั้ง section และ department ระดับบนสุด
> - **⚠️ ห้ามซ่อนเงียบ** — สกิลที่พนักงาน **มีอยู่แล้ว โชว์เสมอ** แม้นอกขอบเขต (การถือสกิลข้ามส่วนงานเป็นเรื่องปกติ: PD2 31 คนถือสกิล PD3 93 แถว · PD4 31 คนถือสกิล PD3 77 แถว) + แถบบอกว่ากรองอยู่ + ปุ่มกางดูพร้อมจำนวน + เตือนเมื่อส่วนงานนั้น**ยังไม่ได้ติดป้ายฝ่าย**
> - **backward-compatible:** สกิลที่มี `scope_section` แต่ไม่มี `scope_division` (ข้อมูลเก่า) เทียบด้วยหน่วยงานอย่างเดียวเหมือนเดิม · ยังไม่ apply migration = `division` เป็น undefined = ทุกสกิลเป็นของทุกฝ่าย = พฤติกรรมเดิมเป๊ะ (operator.jsx มี fallback select ตัดคอลัมน์เมื่อเจอ 42703)
> - **ผลกับข้อมูลจริง (จาก 44 สกิล):** ช่าง MTN/DIE/JIG 25 คน เห็น **15** · PD3 เห็น 34 · PD4 เห็น 25 · **PD1/PD2 ยังเห็น 15** เพราะสกิลผลิตถูก scope เจาะจง PD3/PD4 ไว้ → **แก้ที่ข้อมูล ไม่ต้องแก้โค้ด** (ล้างช่อง "เจาะจงส่วนงาน" ให้เหลือแค่ฝ่ายผลิต แล้วทุก PD เห็นทันที)
> - migration `20260818_org_divisions.sql` (**apply แล้ว**) · สิทธิ์แก้ฝ่าย = `org:manage_divisions` (admin/manager)
>
> #### ⚠️ สิทธิ์แก้คะแนนทักษะแบ่ง 3 ชั้น ห้ามยุบเป็นสวิตช์เดียว (2026-08-18 · คำสั่ง user)
> | key | ครอบอะไร | ผู้ถือ (seed) |
> |---|---|---|
> | `skills:edit` | แก้คะแนนสกิลทั่วไป | admin · dept_admin · **leader** · manager · mtn · sale · supervisor |
> | **`skills:edit_high`** | ตั้งคะแนน **เกิน 50** (ระดับแก้ปัญหาได้/ผู้เชี่ยวชาญ) | ผู้ถือ `skills:edit` ทุก role **ยกเว้น leader** |
> | **`skills:edit_allowance`** | ติ๊ก **ใบเซอร์ค่าฝีมือ** (`category='allowance_skill'` → score 100) | admin · manager · supervisor · dept_admin (**ระดับหัวหน้าแผนกขึ้นไป**) |
>
> - **เหตุผลที่แยก:** หัวหน้ากลุ่มควรตั้งคะแนนลูกทีมได้ถึงระดับ "มาตรฐาน" (50) แต่ระดับสูงกว่านั้นควรผ่านคนที่สิทธิ์สูงกว่า · ส่วนใบเซอร์ค่าฝีมือ **กระทบเงิน** จึงแคบสุด (user สั่ง "ค่าฝีมือ ต้องหัวหน้าแผนก" · ยืนยันให้คุมด้วย **role** ไม่ใช่ `profiles.position`)
> - **บังคับ 2 ชั้นเสมอ — UI + RLS** (`employee_skills_write` WITH CHECK): `score <= 50 or has_perm('skills:edit_high')` และแถวหมวดค่าฝีมือต้องมี `skills:edit_allowance` · **UI อย่างเดียวไม่พอ ยิง API ตรงข้ามได้**
> - **เพดานอยู่ที่ `SKILL_EDIT_CAP` (`src/utils/skillLevels.js`) จุดเดียว** — แก้ค่านี้ต้องแก้ policy ให้ตรงกันด้วย ไม่งั้น UI ปล่อยผ่านแล้วโดน DB ตีกลับ
> - **⚠️ WITH CHECK ที่ไม่ผ่าน = error 42501 ดังๆ** (ต่างจาก USING ที่เงียบเป็น 0 แถว) → UI ต้อง gate ให้ตรง + แปลง error เป็นภาษาคน **ห้ามโยน error ดิบใส่หน้างาน**
> - **สกิลที่คะแนนเดิมเกินเพดานของผู้ใช้ = ล็อกช่อง ไม่ให้แตะเลย** (กันเผลอกดคะแนนคนลง และถึงแก้ก็โดนตีกลับ) · ตอนบันทึกก็ข้ามแถวพวกนี้ ไม่ส่งให้ DB ปฏิเสธ
> - **⚠️ ไม่กระทบ EXP farm อัตโนมัติ** — `fn_daily_skill_farm`/`fn_weekly_skill_update` เป็น SECURITY DEFINER (bypass RLS) → คะแนนจากการทำงานจริงยังขึ้นเกิน 50 ได้ตามด่านอนุมัติเดิม · **เพดานนี้คุมเฉพาะ "การพิมพ์คะแนนใส่เอง"** ซึ่งเป็นจุดที่ข้ามด่านอนุมัติได้
> - **⚠️ ผู้อนุมัติ level-up (admin/manager/supervisor) ได้ `edit_high` ครบ** → กด approve ขึ้น 75/100 ได้เหมือนเดิม (flow นั้นเขียน `employee_skills` จาก client จริง ถ้าลืมจะพังเงียบ)
> - **role ที่เพิ่มทีหลังไม่มีแถว = ถูกจำกัด (fail-safe ฝั่งแคบกว่า)** · migration `20260818_skills_edit_cap.sql` + `20260818_skills_allowance_permission.sql` (**apply แล้ว**)
> - **เทสแล้วกับ RLS จริง** (สวมบท `authenticated` — รันเป็น service role จะ bypass RLS แล้วหลอกว่าผ่าน): leader→50 ผ่าน · leader→75 บล็อก 42501 · supervisor→75 ผ่าน · ค่าฝีมือ: leader/mtn บล็อก · supervisor ผ่าน
>
> - **✅ คืนสิทธิ์ leader แล้ว 2026-08-17 (คำสั่ง user "ให้หัวหน้ากลุ่มทำได้แหละ")** — `leader × skills:edit = true` (migration `20260817_employee_skills_audit.sql`) มีผลทั้ง UI และ RLS ทันทีไม่ต้อง deploy · **เปิดสิทธิ์คู่กับการทำ audit log ให้มีจริงก่อน** (user เข้าใจว่ามี log อยู่แล้ว ซึ่งตอนนั้น**ยังไม่มี**) — ดูหัวข้อ Traceability
> - **policy อื่นที่ยัง hardcode role array อยู่ ให้ทยอยย้ายมาใช้ `has_perm()`** เมื่อไปแตะตารางนั้น
>
> #### ⚠️ กฎเหล็ก — "เห็นได้ทั้งโรงงาน แต่แก้ได้เฉพาะส่วนงานตัวเอง" ห้ามใช้ `profiles.sections` ทำ (2026-08-17)
> **`sections` เป็น scope ระดับทั้งระบบ ไม่ใช่ตัวกรองเฉพาะหน้าพนักงาน** — หน่วยงานสนับสนุน (คลัง/สโตร์ = section `Planning&Store`) **ไม่มีไลน์ผลิตสังกัดอยู่เลย** → ตั้ง `sections=['Planning&Store']` เมื่อไหร่ หน้าที่กรองด้วย section (**StoreMonitor · Dashboard · Report** — ตรวจโค้ดซ้ำ 2026-08-24: `PlannerSales`/`RundownStock` **ไม่ได้อ่าน `sections` เลย** จึงไม่กระทบ ที่เคยเขียนไว้ว่ากระทบด้วยคือผิด) เหลือ **0 แถวทันที** = พังงานประจำวันของเขาเอง แลกกับการซ่อนรายชื่อพนักงานฝ่ายผลิต
> - **กลไกที่ถูก: คีย์ `employees:edit_all_sections`** (migration `20260817_sale_role_employee_management.sql`) — role ที่ **มี** = แก้ได้ทุกส่วนงาน (พฤติกรรมเดิม) · **ไม่มี** = ปุ่ม ✏️/🚫 + แผงระดับทักษะ เปิดเฉพาะแถวที่ `employees.section` ตรงกับ **`profiles.section` (คอลัมน์เดี่ยว)** ของผู้ใช้ แถวอื่นขึ้น 🔒
> - **ใช้ `profiles.section` เดี่ยว ไม่ใช่ `sections[]` โดยตั้งใจ** — `effectiveSections()` ข้อ 5 บอกว่า "role อื่นที่มีแค่ section เดี่ยว → ไม่จำกัด" → **scope ทั้งระบบคงเดิมเป๊ะ** ได้ค่า "ส่วนงานของฉัน" มาใช้ฟรีๆ · **ห้ามเผลอย้ายค่านี้ไปใส่ `sections[]`**
> - seed = ทุก role ที่เคยแก้ได้ `true` → **พฤติกรรมเดิมไม่เปลี่ยนสำหรับใครเลย** · UI เช็คผ่าน `isActionSeeded()` → ก่อน apply migration ทุก role แก้ได้หมดเหมือนเดิม (pattern เดียวกับ `canDelete()`)
> - **role ใหม่ที่ยังไม่มีแถว = ถูกจำกัดตามส่วนงาน (fail-safe ฝั่งแคบกว่า)** — ถ้า role ใหม่ต้องแก้ข้ามส่วนงาน ต้องติ๊กที่ `/permissions`
> - **⚠️ เป็นการกันพลาดฝั่ง UI เท่านั้น** — RLS ของ `employees` เป็น `true` สำหรับ authenticated มาแต่เดิม DB ยังไม่รู้จัก section ของพนักงาน · เหมาะกับโจทย์ "กันแก้/ลบผิดตัว" ไม่ใช่กันคนที่ตั้งใจยิง API ตรง · ถ้าต้องการระดับ DB ต้องเขียน policy ที่ join section ของแถวกับ profiles ของผู้เรียก
> - **สถานะปัจจุบัน:** role `sale` ได้ `page:/operator` `page:/register` `employees:register` `employees:edit` `skills:edit` (เดิม**ไม่มีแถวเลย** = เข้าไม่ได้) · บัญชี `sale` **ทั้ง 7 ตัว** (W/H · Store · Delivery · Billing — user ยืนยันว่าอยู่หน่วยงานเดียวกัน) ตั้ง `section='Planning&Store'` → เห็นพนักงานทั้งโรงงาน แต่ **แก้ได้เฉพาะคนในหน่วยงานตัวเอง** · `sections[]` ยังว่าง = scope ทั้งระบบไม่กระทบ · บัญชี `sale` ที่เพิ่มทีหลังจะได้ค่าเดียวกันเมื่อรัน migration ซ้ำ — ถ้ามีคนอยู่คนละหน่วยงานจริงให้แก้รายคนที่ `/add-user`
>
> #### ⚠️ สิทธิ์แผงสกิลใน `/operator` แยกจาก `employees:edit` แล้ว — `canEditSkillsFor` (2026-08-19 · feedback "สกิลฝ่ายซัพพอร์ท/ช่าง/คนขับรถ เพิ่มไม่ได้")
> เดิมแผง 📊 ระดับทักษะเปิดเมื่อ **แก้ประวัติพนักงานได้** (`employees:edit` + section ตรง) — พนักงานสนับสนุน (ช่าง MTN/JIG/DIE · คนขับรถ) `section = null` โดยตั้งใจ (กฎ ORPHAN_SECTION) → **ไม่ตรงกับ section ของใครเลย = สกิลล็อกหมดทั้งที่ RLS ฝั่ง DB (has_perm `skills:edit`) เปิดให้ mtn อยู่แล้ว**
> - **`canEditSkillsFor(emp)`** = `skills:edit` **และ** (`employees:edit_all_sections` ‖ section ตรงกับ `profiles.section` ‖ **พนักงาน section=null → เปิดให้ `MAINTENANCE_ROLES` (mtn/engineer)**) — สิทธิ์สกิลไม่พ่วงสิทธิ์แก้ประวัติอีก · RLS `employee_skills_write` ยังเป็นด่านสุดท้ายเสมอ
> - migration `20260819_mtn_operator_page_main.sql` (**apply แล้ว 2026-08-19**) เปิด `page:/operator` ให้ role `mtn` (กับดัก enum_range — หน้า seed ก่อน role เกิด) — **ให้เฉพาะ page ไม่แจก `employees:edit`** (ช่างได้แผงสกิลตาม skills:edit เท่านั้น ประวัติพนักงานยังเป็นของฝ่ายบุคคล/หัวหน้าผลิต)
>
> **⚠️ แผง "📊 ระดับทักษะ" ในโมดัลแก้ไขพนักงาน (`/operator`) แยกสิทธิ์จาก `employees:edit` แล้ว** — เดิมไม่ถูก gate เลย ใครเปิดโมดัลได้ก็แก้คะแนนได้ · ตอนนี้ read-only เมื่อไม่มี `skills:edit` และ `handleUpdate` **ยิง upsert/delete เฉพาะสกิลที่เปลี่ยนจริง** (เดิมยิงทุกสกิลทุกครั้งที่กดบันทึกแม้แก้แค่ชื่อ/รูป → คนไม่มีสิทธิ์สกิลโดน RLS ปฏิเสธจนบันทึกประวัติพนักงานไม่ผ่านทั้งใบ) · สกิลพลาด = **ไม่ throw รวม** (ข้อมูลพนักงานบันทึกไปแล้ว การ throw ทำให้อ่านเหมือนไม่ได้บันทึกอะไรเลย) แต่ต้องขึ้น toast บอกให้ชัดว่าส่วนไหนสำเร็จ ส่วนไหนไม่ — **ห้ามเงียบ**

### ⚠️ กฎเหล็ก — ตัวตนของคนอยู่ที่ `employees` · `profiles` คือบัญชี (2026-08-21 · คำสั่ง user)

**ปัญหาเดิม:** คนคนเดียวถูกเก็บ 2 ที่ที่**ไม่มีคอลัมน์ผูกกันเลย** — `employees` (หัวหน้าแผนกดูแล ทีม/ไลน์/ส่วนงาน) กับ `profiles` (admin กรอกเองตอนสร้าง user ซึ่งมี ทีม/ไลน์/ส่วนงาน **ซ้ำอีกชุด**) → admin ไม่รู้ว่าหัวหน้าตั้งอะไรไว้ กรอกไม่ตรง
**เคสจริง:** หัวหน้า LINE APRON ASSY 2 คน **ทีมสลับกันพอดี** (กรกฎ บัญชี=B ตัวจริง=A · ชาญณรงค์ บัญชี=A ตัวจริง=B) → `Checkin.jsx` กรองรายชื่อด้วย `empQ.eq('team', team)` จาก**บัญชี** ตรงๆ = **"มองไม่เห็นกะตัวเอง" เห็นของอีกคนแทน**
**วัดทั้งระบบตอนพบ:** จับคู่ชื่อได้ 13/71 บัญชี · ในนั้นเพี้ยน 6 · ช่าง 25 คนจับคู่ไม่ได้เลยสักคน (บัญชีช่างเป็นบัญชีกลาง `maintenance`/`jigmaintenance`)
**สถานะล่าสุด 2026-08-25:** ผูกแล้ว **23/71** (`person`) · ติดป้าย `shared` 12 (บัญชีหน่วยงาน/จอ ไม่ต้องผูก) · **เหลือ 36 ที่ต้องไล่ผูกเองที่ `/add-user`** (33 คนจริงที่ชื่อในบัญชีไม่ตรงฐานพนักงาน — ส่วนใหญ่พิมพ์ชื่อไม่ครบนามสกุล + 3 บัญชีทดสอบที่ควรลบ) · migration รอบ 2 = `20260825_link_profiles_to_employees_round2.sql` + `20260825_mark_shared_accounts.sql` (**apply แล้ว** · บังคับ `count(*) = 1` ในตัว migration → ชื่อซ้ำไม่ถูกผูกให้ · วัดก่อน-หลังแล้ว ไม่มีใครเสีย `line_id`/`section`)
**⚠️ ทำไมต้องผูกให้ครบ:** ตัวกรอง **"แผนก"** ของระบบแจ้งเตือน (`notify_recipients`) เดินผ่าน `profiles.employee_id → employees.department` — **บัญชีที่ยังไม่ผูก = ตัวกรองแผนกไม่มีผลกับคนนั้น** (ส่วนงานยังใช้ได้ เพราะอ่าน `profiles.section` ตรงๆ)

- **`profiles.employee_id`** (FK → `employees.id` · unique partial) = ตัวผูกที่ขาดไป · **`profiles.account_kind`** = `person` (ต้องผูก) / `shared` (บัญชีหน่วยงาน-อุปกรณ์ ไม่ต้องผูก) / null = ยังไม่ระบุ
- **⚠️ บัญชีบางตัวไม่ใช่คน ห้ามบังคับให้ผูก** (user ยืนยัน) — `maintenance`/`warehouse1`/`delivery1`/`Display`/`ADMIN` ไม่มีตัวตนใน `employees` และไม่ควรมี
- **⚠️ ระบบไม่เดาว่าบัญชีไหนเป็นแบบไหน** — backfill ผูกให้เฉพาะที่ชื่อตรง**ชัดเจนตัวเดียว** (13 บัญชี) ที่เหลือ `account_kind` = null ขึ้นเป็น **worklist ใน `/add-user`** ให้ admin จัด (หลักเดียวกับ backfill ทะเบียนแม่พิมพ์: แกะไม่ออกปล่อยว่าง)
- **`/add-user` เลือกประเภทบัญชีก่อน** → บัญชีของคน = **เลือกพนักงานจากฐาน** แล้ว ชื่อ/ทีม/ไลน์/ส่วนงาน/ตำแหน่ง เติมให้อัตโนมัติ + **ล็อกช่องทีม/ไลน์ไม่ให้กรอกทับ** (ช่องที่กรอกเองได้คือต้นเหตุเดิม) · บัญชีหน่วยงาน = พิมพ์ชื่อเองเหมือนเดิม
- **แถบเตือนใน `/add-user`** ลิสต์บัญชีที่ตัวตนไม่ตรงกับฐานพนักงาน + ปุ่ม **"ใช้ค่าจากฐานพนักงาน"** แก้ทีละคน (ฐานพนักงานคือค่าจริงเสมอ)
- **✅ read path ย้ายแล้ว 2026-08-21** — `fetchProfile` (App.jsx) อ่าน **ทีม/ไลน์/ส่วนงาน จาก `employees`** เมื่อบัญชีผูกแล้ว
  - **⚠️ fallback รายฟิลด์ (`??`) ห้ามถอดจนกว่าจะผูกครบทุกบัญชี** — ยังไม่ผูก **หรือ** ฐานพนักงานเว้นช่องนั้นว่าง → ใช้ค่าเดิมในบัญชี
    ถอดตอนนี้ = **leader 11 คนเสีย `line_id`+`team` ทันที** (scope ของ leader พึ่ง 2 ค่านี้ตรงๆ) → เปิดหน้าเช็คชื่อไม่เห็นใครเลย ทำงานไม่ได้ทั้งกะ · และ supervisor ที่ฐานพนักงานไม่ได้กรอกไลน์จะเสียไลน์ไปด้วย
  - **⚠️ `sections[]` ไม่ย้าย** — เป็น "ขอบเขตที่ admin ให้" ไม่ใช่ตัวตน · `employees` ไม่มีของเทียบเท่า · ย้ายเมื่อไหร่ supervisor 21 + qa 6 + doc_control 2 เห็นข้อมูลผิดขอบเขตทันที
  - **วัดก่อน-หลังแล้ว (71 บัญชี): เปลี่ยน 4 · เสียค่าไป 0** — กรกฎ ทีม B→A · ชาญณรงค์ A→B (เคสที่รายงาน) · ณัชพล/วิริยะ ได้ไลน์เพิ่ม · ที่เหลือ 67 บัญชีไม่ขยับ · **เกณฑ์รับของงานนี้คือ "ต้องไม่มีใครเสียค่าที่เคยมี"** แก้อะไรต่อให้วัดซ้ำแบบเดียวกัน
  - **ผูกแล้วแต่ฐานพนักงานเว้นว่าง = ขึ้นเตือนใน `/add-user`** ("ระบบใช้ค่าเดิมในบัญชีไปก่อน") **ห้ามเงียบ** ไม่งั้นเข้าใจผิดว่า single source แล้วทั้งที่ยังไม่ใช่
  - select `employee_id` แบบ tolerant — เจอ 42703 (ยังไม่ apply migration) ถอยไป select ชุดเดิม **ห้ามให้ login พังทั้งระบบ**
- migration `20260821_profiles_employee_link.sql` (**apply แล้ว**) · **ไม่เปลี่ยนพฤติกรรมของใครเลย** (additive ล้วน)
- **⚠️ RLS `auth_update_profiles` เปิดให้ authenticated แก้ profile ของใครก็ได้** (using/with_check = true · ของเดิมมาก่อน) — คุมด้วย `page:/add-user` (admin only) ฝั่ง UI เท่านั้น · ถ้าจะรัดต้องทำแยก (ดูกฎ `set_my_signature` RPC)

### Section/Line/Team Scoping — รองรับหลาย section ต่อ user แล้ว (2026-07-09)

- ขอบเขตส่วนงานเก็บที่ `profiles.sections text[]` (หลายค่า เช่น `{PD1,PD2,QA}`) โดยยังมี `profiles.section` เดี่ยว (legacy) อยู่คู่กัน — ตีความผ่าน `effectiveSections(role, sections, section)` ใน `src/utils/sectionScope.js` ตามลำดับ:
  1. `admin` → ไม่จำกัดเสมอ
  2. **role คุณภาพทั้งโรงงาน (`qa`) → ไม่จำกัดเสมอ** (2026-07-16) — QA เป็นผู้อนุมัติ 4M step QA / งานคุณภาพข้ามสายผลิตทั้งโรงงาน และ section ของ QA เอง (ค่าจริงในระบบคือ `"QA"`) **ไม่ใช่สายผลิต** ถ้าปล่อยให้ scope ตาม section จะกรองข้อมูลผลิตออกหมด (เห็น 4M/รายงาน = 0 ทุกใบ — bug ที่เจอจริง) · กำหนดใน `FACTORY_WIDE_ROLES` ใน `sectionScope.js` — ถ้าจะให้ QA แยกดูแลราย section จริงต้องคิดกลไกใหม่ (ปัจจุบัน QA ทุกคน sections=`["QA"]`)
  3. `sections` มีค่า → จำกัดตาม array นั้น **ใช้ได้ทุก role ที่เหลือ** (เช่น manager ที่ดูแลเฉพาะ PD1+PD2)
  4. `supervisor` ที่มีแค่ `section` เดี่ยว → `[section]` (พฤติกรรมเดิมเป๊ะ)
  5. role อื่นที่มีแค่ `section` เดี่ยวค้างอยู่ → **ไม่จำกัด** (ตั้งใจ — กัน manager เก่าที่เคยกรอก section ไว้เฉยๆ โดนจำกัดกะทันหันหลัง deploy)
- UserContext ส่ง `sections` = array ผลลัพธ์สุดท้าย (`[]` = ไม่จำกัด) — ในหน้าเช็คด้วย `scopeSecs.length` แล้วกรองด้วย `inSectionScope(scopeSecs, value)` (เทียบ trim+lowercase) หรือ `.in('section', scopeSecs)` ใน query
- `leader` ยังผูก `profiles.line_id` + `team` เหมือนเดิม ไม่เกี่ยวกับ sections — เช็ค branch ของ leader **ก่อน** branch ของ scope เสมอ
- > ### ⚠️ กฎเหล็ก — scope ของ leader = **ทั้งครอบครัวไลน์** ห้าม `.eq('line_id', lineId)` ตรงตัว (2026-08-10)
  > **เคสจริงที่ทำให้เจอ:** จัดข้อมูลพนักงาน PD4 ให้ตรงผังองค์กร → เลือกกลุ่ม "GOR ASSY"/"LWRBAR ASSY" ในฟอร์ม ซึ่ง `org_nodes.ref_line_id` ชี้ไป**ไลน์ลูก** (Assy GOR/Assy LWR) → `employees.line_id` ย้ายจากไลน์แม่ไปไลน์ลูก → **หัวหน้ากลุ่มที่ผูกกับไลน์แม่ (GOR/LWR BAR) เปิดหน้าเช็คชื่อแล้วเห็น 0 คน** ("แก้ฐานข้อมูลใหม่ เช็คชื่อหายหมดเลย" — 4 หัวหน้า, 41 คนหาย)
  > **ต้นเหตุคือโค้ด ไม่ใช่ข้อมูล** — การย้ายคนไปไลน์ลูกถูกต้องและละเอียดกว่าเดิม แต่ query ของ leader กรอง `line_id` ตรงตัว ขัดกับ pattern ที่เอกสารระบุไว้เอง (`leader = family ไลน์ตัวเอง`) และขัดกับตัวกรองแสดงผลในหน้าเดียวกันที่ใช้ `getLineFamilyIds` อยู่แล้ว
  > **แก้ครบ 5 จุดแล้ว:** `Checkin` (ลิสต์เช็คชื่อ + export), `operator` (ฐานข้อมูลพนักงาน), `ShiftOrganize`, `Report` (แท็บรายพนักงาน) — ใช้ `getLineFamilyIds(lines, lineId)` แล้ว `.in('line_id', [...fam])` · **fallback เป็น `.eq` เดิมเมื่อ family ว่าง** (ไลน์ยังโหลดไม่เสร็จ/ไม่เจอไลน์) ห้ามปล่อยให้ `.in('line_id', [])` = ไม่เห็นใครเลย
  > **⚠️ ต้องดึง `production_lines` ให้เสร็จก่อนสร้าง query พนักงาน** — หลายหน้าโหลด lines ขนานกับ employees (Checkin เคย `setLines` อยู่ใน `Promise.all` ก้อนเดียวกัน) ถ้าอ่าน state `lines` ตอนนั้นจะได้ array ว่าง → family ว่าง → ตกไป fallback แล้วบั๊กกลับมาเงียบๆ
  > **ผลพลอยได้:** หัวหน้า HYDROFORM เห็นเพิ่มจาก 32 → 34 คน (2 คนที่ผูกไลน์ลูก LASER E50 เดิมมองไม่เห็นมาตลอด)
  >
  > #### ⚠️ พนักงานอยู่ที่ **ไลน์ลูก (ระดับกลุ่ม)** — ไลน์แม่คือระดับแผนก (2026-08-12 · คำสั่ง user)
  > **`employees.line_id` ต้องชี้ไลน์ที่มี `parent_line_name` (ไลน์ลูก = ระดับกลุ่ม)** · ไลน์แม่ (`parent_line_name is null`) ส่วนใหญ่เป็น**ระดับแผนก** ไม่ใช่ที่อยู่ของคน — ตรงกับ `org_nodes` kind='line' (กลุ่ม) ที่ `ref_line_id` ชี้ไลน์ลูกอยู่แล้ว และตรงกับที่หัวหน้าตั้งตารางกะไว้
  > **เอกสารเดิมเขียนว่า "ผูกกับไลน์แม่ 100%" — นั่นคือ*สภาพที่เป็นอยู่* ไม่ใช่*สิ่งที่ควรเป็น*** (ข้อมูลเก่ายังค้างที่ไลน์แม่อยู่หลายกลุ่ม ทยอยจัดให้ตรงได้)
  >
  > #### ⚠️ ย้าย `line_id` = ย้ายทุกอย่างที่ผูก `line_id` ไปด้วย — ต้องไล่เช็คก่อนย้าย
  > **`shift_schedules.line_id` ก็ผูกไลน์เหมือนกัน** → ย้ายคนข้ามชั้นไลน์แล้ว **"ไม่มีตารางกะ" ทันที** ถ้ากะสัปดาห์นั้นถูกตั้งไว้ที่ไลน์อีกชั้นหนึ่ง (เจอจริง 2026-08-12: ย้ายคนกลับไลน์แม่เพื่อกู้เช็คชื่อ → กะ 10-16 ส.ค. ที่ตั้งไว้ที่ไลน์ลูกหายทันที หน้าจัดกะขึ้น "ไม่มีกะ")
  > **ก่อนย้าย `line_id` ให้ตรวจอย่างน้อย:** `shift_schedules` · `employee_home_positions` · `workstations` ของไลน์ปลายทาง · `shift_overrides` — **และ snapshot ค่าเดิมไว้เสมอ** (ย้อนด้วย `group_name` ไม่ได้ถ้าบางคน `group_name` ว่าง)
  >
  > #### 🤝 ยืมพนักงานข้ามไลน์รายกะ — ตาราง `line_helpers` (2026-08-19 · feedback "หัวหน้าดึงพนักงานไลน์อื่นมาช่วยไม่ได้")
  > scope ของ leader ทำให้คนไลน์อื่น "มองไม่เห็น" โดยดีไซน์ — ทางออกไม่ใช่แก้ scope แต่เป็น**การยืมตัวชั่วคราวเป็นข้อมูล**: `line_helpers` (Main · migration `20260819_line_helpers_main.sql`) 1 แถว = ยืม 1 คน มาช่วยไลน์ปลายทาง 1 กะ (`unique(work_date, shift, employee_id)` — คนหนึ่งถูกยืมได้ทีละไลน์ ไลน์ที่สองต้องให้ไลน์แรกกดคืนก่อน · error 23505 = ข้อความบอกตรงๆ)
  > - **ห้ามแก้ `employees.line_id` เพื่อยืมตัว** (บทเรียน 2026-08-12 ข้างบน — ย้าย line_id ลากตารางกะ/จุดประจำพังตาม) — การยืมเป็นเรื่องรายวัน+รายกะ ตัวตนถาวรอยู่ไลน์เดิม
  > - **Checkin:** ปุ่ม 🤝 ยืมพนักงาน (สิทธิ์ `checkin:record`) → ค้นทั้งโรงงานด้วยชื่อ/รหัส → เลือกไลน์ปลายทาง (จาก `scopedLines`) · คนที่ยืมโผล่ในรายชื่อพร้อมป้าย "🤝 ยืมตัวจาก <ไลน์เดิม>" + ปุ่ม ✕ คืน · ฝั่งไลน์เดิมเห็นป้าย "→ ไปช่วยไลน์ X (กะนี้)" (**ไม่ตัดออกจากลิสต์** — ไลน์เดิมยังเช็คชื่อ/ดูสถานะได้)
  > - **ตัวกรองไลน์/section + เปิดกะ Daily Report ต้องมองคนยืมเป็น "ไลน์ปลายทาง"** (`effLineIdOf(emp)` = `_helperToLineId || line_id`) · `assignedShift` ของคนยืม = กะปัจจุบันเสมอ (การยืมผูกกับกะ — ห้ามให้ตารางกะไลน์เดิมกรองทิ้ง)
  > - **Management (ผังจัดกำลังคน):** `matchesTeam` ยอมรับคนที่ `helperMap[employee_id]` ชี้ไลน์ใน scope → เข้า pool ลากลงสถานีได้ พร้อมป้าย 🤝 ยืมตัว · **ลากลงสถานี = เข้าเกณฑ์ 4M Man ย้ายข้ามไลน์ตามปกติ** (`sameLine` เทียบจาก `employees.line_id` เดิม — ถูกต้องแล้ว ห้ามไปหลอกให้เป็นไลน์เดียวกัน)
  > - โค้ดอ่าน/เขียน best-effort ทั้งหมดเผื่อ rollback · migration **apply แล้ว 2026-08-19** (user รันผ่าน SQL Editor)
  >
  > #### ⚠️ บทเรียน: อาการที่เกิดจาก**โค้ด** ห้ามแก้ด้วยการ**ย้อนข้อมูล** (2026-08-12)
  > ตอนเช็คชื่อหาย เคยย้อน `line_id` กลับไลน์แม่เพื่อให้ใช้งานได้ทันทีระหว่างรอ deploy — **ผลคือทำตารางกะพังแทน** (ย้ายปัญหา ไม่ได้แก้) · ข้อมูลที่ถูกจัดให้ตรงผังแล้วคือของถูก **โค้ดต่างหากที่ต้องตามให้ทัน** · ถ้าจำเป็นต้องกู้ชั่วคราวจริงๆ ให้ประเมิน blast radius ของการย้อนข้อมูลก่อน แล้วบอก user ว่าจะแตะอะไรบ้าง
- AddUser.jsx: ช่อง Section เป็น checkbox เลือกหลายอันได้ทุก role และ**ยังเขียน `section` เดี่ยว (= ตัวแรกที่ติ๊ก) คู่กันเสมอ — ห้ามเลิกเขียน** เพื่อให้ revert โค้ดกลับเวอร์ชันเก่าได้โดย supervisor ไม่หลุด scope · supervisor ยังบังคับติ๊กอย่างน้อย 1 (Edge Function `create-user` ยังไม่รู้จัก sections — AddUser update ตามหลังด้วย id ที่ได้กลับมา)
- หน้าที่ปิดช่องโหว่แล้ว: Management, Checkin, operator, Register, DailyReport (Live/History/Export), Report (ครบทั้ง 10 แท็บ — รายวัน/รายพนักงาน/Log จุดงาน/สรุปช่วงเวลา/4M + สิทธิ์อนุมัติ SV/Skill Matrix/ค่าฝีมือ/ใบบันทึก/Multi-Skill Form/จองรถ OT — 2026-07-10), ShiftOrganize (ตารางกะ/override/merge event/dropdown ใน modal — 2026-07-10), OEEAnalytics, LineSetup, EventLog, Improvements, Dashboard, MachineDatabase (2026-07-12 — user ยืนยัน: Dashboard/MachineDatabase ก็กรอง ใครไม่มี scope เห็นหมดเหมือนเดิม) — pattern: mandatory scope filter ก่อน แล้วค่อย apply free-text filter ทับ
- หน้าใหม่ที่ query ข้อมูลตาม line/section **ต้องเพิ่ม scope filter แบบเดียวกัน** ไม่งั้นเห็นข้อมูลข้ามส่วนงานโดยไม่ตั้งใจ
- **ข้อยกเว้นทางการ — `/factory-map` (ผังรวมโรงงาน) ไม่ scope โดยตั้งใจ ทุก role เห็นทั้งโรงงาน** (คำสั่ง user 2026-08-05 ปิดเคสจาก QC audit) — เป็นผังภาพรวมสำหรับจอ TV/ผู้บริหาร/ประชุม การกรองเหลือเฉพาะไลน์ตัวเองทำให้ "ภาพรวม" หมดความหมาย · **ห้ามเติม scope filter ให้หน้านี้** เว้นแต่ user สั่งเปลี่ยน · หน้าอื่นยังยึดกฎ scope ตามปกติ (รวมหน้าที่ deep-link ออกไปจากผัง เช่น Dashboard/MtnMachineLayout ซึ่ง gate ด้วย RoleRoute/scope ของตัวเองอยู่แล้ว)
- **ข้อยกเว้นทางการ (เพิ่ม 2026-08-24 · คำสั่ง user) — `/flow-tower` (สายธารความต้องการ) ก็ไม่ scope เช่นกัน ทุก role เห็นทั้งโรงงาน** — เป็นจอ "สายธารทั้งเส้น" ตั้งแต่ลูกค้าถึงจัดซื้อ สำหรับผู้บริหาร/เปิดหลายจอพร้อมกัน · กรองเหลือเฉพาะส่วนงานตัวเองแล้ว**สายธารขาดกลางทาง = หมดความหมายของหน้า** · **ห้ามเติม scope filter** · เดิม destructure `sections` มาแต่ไม่เคยใช้ (ดูเหมือนลืมทำ ทั้งที่ตั้งใจ) → ถอดออกแล้วพร้อมคอมเมนต์กำกับ **ห้ามเอากลับมา**
- **จอภาพรวมผู้บริหารอื่นที่ไม่ scope โดยตั้งใจ (documented อยู่แล้ว):** `/group-overview` · `/adoption-outlook`
- **⚠️ หน้าหลัก (DeptHub) เคยไม่ scope เลยสักตัว — แก้แล้ว 2026-08-19 (feedback หน้างาน):** telemetry ทั้ง 4 (ไลน์กำลังผลิต/เช็คชื่อ/Downtime ค้าง/4M รออนุมัติ) นับทั้งโรงงานให้ทุก role → หัวหน้าไลน์เห็น Andon ของแผนกอื่นแล้วถามว่า "ไลน์ผมทำไมไม่แจ้งเตือนแบบนี้" · **กติกาที่ user สั่ง: หน่วยงานช่างเห็นทั้งโรงงาน (ดูแลเครื่องทุกไลน์) · หน่วยงานผลิตเห็นเฉพาะส่วนงานตัวเอง** · **helper กลาง `scopedLineNames({role, lineId, sections, lines})` ใน `src/utils/sectionScope.js`** — คืน `null` = ไม่จำกัด · `MAINTENANCE_ROLES` = `['mtn','engineer']` · **หน้าใหม่ที่นับตัวเลขรวมให้ใช้ helper นี้ ห้ามเขียน pattern scope ซ้ำเอง** (เดิมกระจาย ~6 หน้า) · **⚠️ ต้องรอ `production_lines` โหลดเสร็จก่อนเรียก** — lines ว่างคืน `null` (ไม่จำกัด) **ห้ามคืน `[]`** เพราะ `.in('line_name', [])` = ไม่เห็นอะไรเลย · จอที่โชว์ตัวเลขรวมต้อง**ติดป้ายบอกขอบเขต** (🏭 ทั้งโรงงาน / 👥 ส่วนงานของฉัน) ห้ามให้คนอ่านเดาเอง
- **⚠️ dropdown ก็ต้อง scope ไม่ใช่แค่ query (audit 2026-07-23):** `<select>` ที่ลิสต์ **ไลน์/ส่วนงาน/พนักงาน** ต้องกรองตาม scope เหมือนกัน (ไม่งั้น supervisor/leader เห็นไลน์ข้ามส่วนงานใน dropdown แม้ข้อมูลกรองแล้ว) · ปิดช่องโหว่ dropdown แล้ว: **DailyReport เปิดกะ** (leaf+optgroup ตาม `openScopeLineNames`), **Checkin** (แถบ section + ไลน์), **MtnRepair** ReportModal (ผ่าน `scopedLineObjs` ใน cp), **PmCoordination** PlanModal, **DailyPM** ทะเบียน (assign/move — เพิ่ม `scopedProdLines`) · ยังเหลือ (primary user = store/logistic ไม่ใช่ผลิต เลยยัง N/A): LineStock/RackCenter line filter — ถ้าให้ leader ใช้ตรงต้องเพิ่ม scope
  - **⚠️ "scope" ของ role กับ "ชั้นกรองบน dropdown" เป็นคนละเรื่อง — มี scope ถูกแล้วก็ยังต้องมีชั้นกรองด้วย (2026-09 · user จับได้จากภาพหน้าจอ "ไม่กรอง hierarchy"):** `/report` แท็บ **📍 Log จุดงาน** (`StationLogTab`) ตัว query ผูก role-scope ถูกอยู่แล้ว (`scopedStations` — leader=family, อื่น=`sections`) แต่ **dropdown เลือกสถานีไม่มีชั้นกรอง "ส่วนงาน" มาก่อนเลย** เป็น `<select>` ก้อนเดียวยาว รวม optgroup ของทุกไลน์ทุกส่วนงาน (LINE C/PD1, LINE D/PD1, LINE GWM/PD2, LINE MAIN TSRA-1/PD2 ฯลฯ) ปนกันหมด — สำหรับ role ที่ไม่ถูกจำกัด (admin/manager ไม่ตั้ง `sections`) คือลิสต์ทุกสถานีทุกไลน์ทั้งโรงงานในดรอปดาวน์เดียว ต้องเลื่อนหาเอง ไม่มีทางแคบลงก่อนเลือกได้เลย · **เป็นบั๊กคนละชั้นกับ role-scope** — ต่อให้ query ถูก scope 100% ก็ยังต้องมี "ชั้นกรองหมวดหมู่" ให้คนเลือกทีละขั้น (Section → Station) ตามกฎ UI-CONVENTIONS §5.3 (cascade) ไม่ใช่แค่ optgroup label เฉยๆ
    - แก้ด้วยเติมตัวกรอง **"ส่วนงาน" (`stationSection`)** เหนือ dropdown สถานี — pattern เดียวกับ `DailyTab`/`PerEmployeeTab` ในไฟล์เดียวกัน (`useOrgSections()` + `inSectionScope`) ซ้อนทับ `scopedStations` เดิม (แคบลงได้อย่างเดียว ไม่ปลด scope ให้กว้างขึ้น) · เลือกส่วนงานแล้ว dropdown สถานีเหลือแค่ optgroup ของไลน์ในส่วนงานนั้น
    - `secByLineName` (line→section lookup) แยกเป็น `useMemo` ของตัวเองให้ทั้ง `stationSectionsList` และ `scopedStations` ใช้ร่วมกัน · เอฟเฟกต์เดิม "เลือกสถานีแรกอัตโนมัติ/เคลียร์ถ้าหลุด scope" (ผูกกับ `scopedStations`) ทำงานต่อได้เลยไม่ต้องแก้ เพราะตัวกรองส่วนงานไปอยู่ใน `scopedStations` เดียวกัน
- Rollback: `docs/ROLLBACK_MULTI_SECTION_SCOPE.md` — **ห้าม drop คอลัมน์ `sections` ก่อน revert โค้ด** (App.jsx select คอลัมน์นี้ตอน login ถ้า drop ก่อนจะ login ไม่ได้ทั้งระบบ)

### Auth Session & Auto-Logout (กติกาสำคัญ — 2026-07-14 หลังไล่แก้ "เด้ง login บ่อย")

- Session เก็บใน **localStorage** (default ของ supabase-js) แชร์ทุกแท็บของ browser เดียวกัน — **ห้ามเปลี่ยนเป็น sessionStorage** (แท็บใครแท็บมันจะถือ refresh token คนละก๊อปปี้ พอ token หมุนแท็บเก่าหลุดเงียบๆ — ดู comment ใน `src/supabaseClient.js`)
- **`signOut` ทุกจุดต้องใช้ `{ scope: 'local' }`** — default คือ `global` ซึ่ง revoke refresh token ของ user นั้น**ทุกเครื่อง** → account ที่ใช้ร่วมกันหลายจุดในโรงงานโดนเด้งพร้อมกันหมดทุกครั้งที่เครื่องเดียว logout/auto-logout (เคยเป็นสาเหตุหลักของ "เด้ง login บ่อย")
- **Auto-logout (`useAutoLogout` ใน App.jsx):** idle 30 นาที → modal เตือน 5 นาที → logout (role `display` ยกเว้น) โดย:
  - นับ idle **ร่วมกันทุกแท็บ** ผ่าน `localStorage['esm-last-activity']` (เขียน throttle 5 วิ + ฟัง storage event) — ห้ามกลับไปนับต่อแท็บ ไม่งั้นแท็บที่เปิดทิ้งไว้จะ logout ทั้งที่ user ใช้งานอีกแท็บอยู่
  - ระหว่าง countdown ถ้ามี activity (เมาส์/คีย์/แตะจอ — แท็บไหนก็ได้) → ปิดคำเตือนอัตโนมัติ ไม่ต้องกดปุ่ม
- อยากปรับระยะ idle → แก้ `IDLE_TIMEOUT_MS`/`WARN_DURATION_MS` ใน App.jsx จุดเดียว
- **เพดานเวลา login ตามกะ (2026-07-15):** role หน้างานที่ทำงานสลับกะ+ใช้เครื่องเช็คชื่อร่วมกัน (`leader`+`supervisor`) จะถูก **เตะออกทันทีเมื่อเลย "สิ้นกะที่ตอน login + 60 นาที"** ไม่สนใจ idle (กะเช้า 08:00–19:59 → หมดอายุ 21:00 · กะดึก 20:00–07:59 → หมดอายุ 09:00 เช้าถัดไป) — แก้ปัญหาหัวหน้ากะก่อนไม่ logout แล้วคนกะใหม่มาเช็คผิด session · stamp เวลา login ที่ `localStorage['esm-session-started']` ตอน `SIGNED_IN` (ล้างตอน signout) · admin/manager/office/display **ไม่โดน** (ทำงานเครื่องตัวเอง มี idle-logout คุมพอ) · ปรับขอบเขตที่ list `shiftCapped` + ค่า `SHIFT_GRACE_MS`/`shiftDeadlineFrom()` ใน App.jsx

---

## เหตุการณ์ชื่อผู้ใช้หายทั้งระบบ — 2026-09-02 (สืบจาก audit_log · กู้คืน 2026-09-07)

- **อาการ:** `/add-user` ขึ้น "ไม่ระบุชื่อ" เกือบทุกแถว · user ต้องพิมพ์ชื่อคืนเอง 3–4 ก.ย. (24 บัญชี)
- **สาเหตุ (จาก `audit_log`):** 2026-09-02 15:49:33 บัญชี **role `leader`** (mongkol@pd4) update `full_name` ของ **49 บัญชีอื่น**
  ในทรานแซกชันเดียว: ชื่อเดิม → `__hack__` → `null` · 4 นาทีก่อนหน้า บัญชีเดียวกันแก้ `is_dept_admin`/`sections` ของตัวเอง ·
  30 นาทีถัดมา (16:19) มี migration `protect_profile_privilege_columns` apply ผ่าน MCP โดย**ไม่มีไฟล์ในรีโป**
  → **รูปแบบ = การทดสอบช่องโหว่ RLS แล้วปิดช่องโหว่ แต่ขั้น "คืนค่าเดิม" ตั้งเป็น null แทนชื่อเดิม** (ไม่ใช่ระบบรีเฟรช/ไม่ใช่โค้ดหน้าเพจ — `AddUser.handleUpdate` แก้ทีละ id เสมอ)
- **ช่องโหว่จริง:** policy `auth_update_profiles` = `using(true) with check(true)` สำหรับ authenticated → role อะไรก็ update โปรไฟล์คนอื่นได้ทั้งตาราง ·
  trigger `protect_profile_role` เวอร์ชันเดิม (20260706) กันแค่เปลี่ยน `role` · เวอร์ชันใหม่กัน "แก้แถวคนอื่น" + คอลัมน์สิทธิ์ทั้งชุด
  (ไฟล์ `20260902_protect_profile_privilege_columns.sql` ถอดจาก DB ใส่รีโปแล้ว 2026-09-07 · policy `using(true)` ยังคงไว้เพราะ admin update ผ่าน client)
- **กู้คืน:** `20260907_restore_profile_names_from_audit.sql` — เติมเฉพาะแถวที่ยัง null จากค่า `old_data` ใน audit_log (49 บัญชี · no_name 61 → 0) · บัญชีที่ user พิมพ์ใหม่แล้วไม่แตะ
- **กฎที่ตกผลึก:** (1) **ห้ามทดสอบช่องโหว่ด้วยการเขียนทับข้อมูลจริงบน production** — ถ้าจำเป็นให้ใช้ `begin … rollback` หรือแถวทดสอบของตัวเอง และต้องคืนค่าเดิมจาก snapshot ไม่ใช่ null
  (2) migration ที่ apply ผ่าน MCP/SQL Editor **ต้องมีไฟล์ในรีโปคอมมิทเดียวกัน** ไม่งั้น session ถัดไปเห็น DB กับรีโปไม่ตรงกัน (กฎเดิมใน CLAUDE.md แต่หลุด)
  (3) `audit_log` บน `profiles` คือสิ่งที่ทำให้กู้ได้ครบ — ตาราง master ใหม่ต้องผูก `trg_audit` เสมอ
