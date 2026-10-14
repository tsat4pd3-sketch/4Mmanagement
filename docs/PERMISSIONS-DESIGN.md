# 🔐 CRUD-Level Permissions — Design Document

ระบบสิทธิ์ระดับ action (เข้าดู / สร้าง / แก้ไข / ลบ / อนุมัติ / export แยกกัน) สำหรับ ESM
ต่อยอดจากระบบ `role_permissions` เดิม — **ไม่รื้อของเดิม ไม่มี breaking change ระหว่างทาง**

| | |
|---|---|
| สถานะ | Phase 0 เริ่มแล้ว (ดูตาราง Rollout ด้านล่าง) |
| หลักการ | เพิ่มทีละชั้น ทุก phase ระบบต้องทำงานเหมือนเดิม 100% จนกว่า admin จะ "เลือก" เปลี่ยนสิทธิ์เอง |

---

## 1. เป้าหมาย & หลักการ

1. **Source of truth เดียว** — ตาราง `role_permissions (role, permission_key, allowed)` เดิม
   ใช้ร่วมกันทั้ง frontend (ซ่อน/แสดงปุ่ม) และ RLS ฝั่ง DB (บังคับจริง)
2. **บังคับ 2 ชั้น** — UI = UX (กันเผลอกด) / **RLS = security จริง** (กัน bypass ผ่าน API ตรง)
3. **แยก 2 มิติ ห้ามปนกัน**
   - **Action** (ทำอะไรได้): `products:create`, `four_m:approve_qa` → เก็บใน `role_permissions`
   - **Scoping** (แถวไหนทำได้): leader→ไลน์ตัวเอง, supervisor→section ตัวเอง → เป็น logic แยก (JS วันนี้ / RLS clause เพิ่มเติมใน Phase 3)
4. **admin bypass เสมอ** ทั้งใน JS (`can()`) และ SQL (`has_perm()`) — กัน admin ล็อกตัวเองออกจากระบบ
5. **fail-closed** — ไม่รู้/โหลดไม่ได้/ไม่มี row = ไม่อนุญาต (ยกเว้น admin)

---

## 2. Data Model

### 2.1 `role_permissions` (มีอยู่แล้ว — ไม่แก้ schema)
```
role permission_key allowed updated_at updated_by   unique(role, permission_key)
```
เปลี่ยนแค่ **convention ของ key** จากเดิมมี 2 แบบ → เพิ่มแบบที่ 3:

| รูปแบบ key | ความหมาย | สถานะ |
|---|---|---|
| `page:/products` | เข้าหน้าได้ (RoleRoute + sidebar) | ใช้อยู่ — คงไว้ |
| `manage_master_data` | ปุ่มแก้ master data (legacy รวมทุกหน้า) | ~~retired~~ 2026-07-22 — แตกเป็น `oee:set_target`/`ot_master:manage`/`management:assign_manpower` แล้ว ไม่มีโค้ดอ่าน |
| `resource:action` | สิทธิ์ระดับ action **(ใหม่)** | Phase 0 seed แล้ว |

### 2.2 `permission_catalog` (ใหม่ — Phase 0)
นิยามว่า "ระบบมี permission อะไรบ้าง" เพื่อให้หน้า จัดการสิทธิ์ render matrix จาก data ไม่ต้อง hardcode รายการในโค้ด

```sql
create table permission_catalog (
  resource   text not null,   -- 'products', 'four_m', 'daily_report', ...
  action     text not null,   -- 'create' | 'edit' | 'delete' | 'approve_sv' | ...
  label      text not null,   -- 'สร้างสินค้าใหม่' (โชว์ใน UI)
  group_name text not null,   -- หมวดใน UI เช่น 'ฝ่ายผลิต'
  sort       int  not null default 0,
  primary key (resource, action)
);
```
- **เพิ่มฟีเจอร์ใหม่ = insert catalog 1 แถว + seed role_permissions** → UI ขึ้นเองไม่ต้องแก้หน้า จัดการสิทธิ์
- ไม่ใส่ FK จาก `role_permissions.permission_key` → catalog เพราะ key แบบ `page:/...` เดิมไม่อยู่ใน catalog (ตั้งใจ)
- **`group_name` มี FK → `nav_groups(name)` (2026-09-07 · `20260907_nav_groups_registry.sql`)** — `nav_groups` = ทะเบียนหมวดเมนู (name/seq/sort_lo/sort_hi) ที่ mirror `NAV_GROUP_ORDER` ใน App.jsx · seed catalog ด้วยชื่อหมวดที่ไม่อยู่ในทะเบียน = error ทันที (เดิมเป็น do-block `raise warning` ที่ลิสต์หมวด hardcode แล้ว drift) · วิว `v_permission_catalog_sort_drift` = แถวที่ sort หลุดช่วง/ซ้ำในหมวด ควรว่างเสมอ · เปลี่ยนหมวดเมนู = migration `*_nav_groups_*` ใหม่ (เทส `navGroupsRegistry.test.mjs` ล็อกไว้)

### 2.3 Naming convention
```
<resource>:<action>       ตัวพิมพ์เล็ก, snake_case
products:create           four_m:approve_qa        daily_report:close_shift
```
action มาตรฐาน: `view` `create` `edit` `delete` + action เฉพาะโดเมน (`approve_*`, `export`, `issue`, `record`, ...)

---

## 3. SQL Layer — `has_perm()` (Phase 0) → RLS (Phase 3)

### 3.1 helper (Phase 0 — สร้างแล้ว ยังไม่มี policy ไหนเรียก)
```sql
create or replace function has_perm(perm_key text)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select coalesce(
    (select p.role = 'admin'::user_role
            or exists (select 1 from role_permissions rp
                       where rp.role = p.role
                         and rp.permission_key = perm_key
                         and rp.allowed)
     from profiles p where p.id = auth.uid()),
    false);  -- ไม่มี profile / ไม่ login = ปฏิเสธ (fail-closed)
$$;
```

### 3.2 RLS pattern (Phase 3 — ยังไม่ทำ)
```sql
-- ⚠️ ใช้ (select has_perm(...)) เสมอ เพื่อให้ Postgres แปลงเป็น InitPlan
--    (ประเมินครั้งเดียวต่อ query แทนที่จะเรียกทุกแถว — เร็วกว่ามาก)
create policy products_insert on products for insert to authenticated
  with check ((select has_perm('products:create')));
create policy products_update on products for update to authenticated
  using ((select has_perm('products:edit')));
create policy products_delete on products for delete to authenticated
  using ((select has_perm('products:delete')));
create policy products_select on products for select to authenticated
  using ((select has_perm('products:view')));
```
- Scoping (leader/supervisor) เมื่อถึง Phase 3 ให้เขียนเป็น `and` clause เพิ่มใน policy — ไม่ใช่ permission key ใหม่
- ทำ **ทีละ table** เริ่มจาก master data ที่ traffic ต่ำ → เทสต์ → ค่อยขยาย

---

## 4. Frontend Layer

### 4.1 `src/utils/permissions.js` (เพิ่มใน Phase 0)
```js
can(resource, action, role)   // = hasPermission(`${resource}:${action}`, role); admin เสมอ true
```
### 4.2 `src/utils/usePerms.js` (ใหม่ — hook แยกไฟล์ กัน circular import กับ App.jsx)
```jsx
const { can } = usePerms();               // bind role จาก UserContext ให้อัตโนมัติ
{can('products','create') && <button>+ เพิ่มสินค้า</button>}
{can('products','delete') && <button onClick={del}>ลบ</button>}
```
Phase 2 จะไล่แทนที่ `hasPermission('manage_master_data', role)` และ `['admin',...].includes(role)` ทีละหน้า

ความคืบหน้า Phase 2 (2026-07-10): Management.jsx — hardcode role array 3 จุด (ปุ่มกำหนด/ถอด/มอบหมาย
งานนอกไลน์) แทนด้วย `can('management','assign_special_task')` แล้ว (migration:
`20260710_management_special_task_permission.sql` — apply กับ DB จริงแล้ว seed ตรงพฤติกรรมเดิม a/m/s/l)

**✅ manage_master_data เกษียณครบแล้ว (2026-07-22):** 3 จุดสุดท้ายแตกเป็นสิทธิ์ย่อย —
`oee:set_target` (OEEAnalytics ปุ่ม 🎯), `ot_master:manage` (Report แผงจองรถ OT),
`management:assign_manpower` (Management ลากจัดกำลังคน ×2 จุด) · migration
`20260722_retire_manage_master_data.sql` (catalog + seed a/m/s) · ไม่มีโค้ดอ่าน `manage_master_data`
แล้ว (แถวเดิมใน role_permissions คงไว้เผื่อ rollback) · แถว Legacy ในหน้า /permissions ถูกถอดออก

### 4.3 Cache & การมีผลทันที
- `loadPermissions()` โหลดครั้งเดียวตอน login (มีอยู่แล้ว)
- Phase 1: หน้า จัดการสิทธิ์ save → `loadPermissions(true)` + Supabase Realtime broadcast บน `role_permissions` → client อื่น reload cache → มีผลโดยไม่ต้อง refresh
- ระหว่างที่ Realtime ยังไม่ทำ: มีผลเมื่อ user โหลดหน้าเว็บใหม่ (พฤติกรรมเดียวกับวันนี้)

---

## 5. หน้า "จัดการสิทธิ์" (Phase 1)

เปลี่ยนจาก matrix "หน้า × role" → **เลือก resource แล้วเห็น action × role** (อ่านจาก catalog):

```
[ Resource: 🔩 Product Master ▾ ]
Action        ADMIN  MANAGER  SUPERVISOR  LEADER  QA  DOC  DISPLAY
👁 เข้าดู       ✓(ล็อก)  ✓        ✓          ✓      ✓   ✓    ✓
➕ สร้าง        ✓(ล็อก)  ✓        ✓          ☐      ☐   ☐    ☐
✏️ แก้ไข        ✓(ล็อก)  ✓        ✓          ☐      ☐   ☐    ☐
🗑️ ลบ          ✓(ล็อก)  ✓        ✓          ☐      ☐   ☐    ☐
```
Workflow: admin ติ๊ก → upsert `role_permissions` → refresh cache → UI ปุ่มหาย/ขึ้นทันที (และ Phase 3 เป็นต้นไป RLS บล็อกจริงพร้อมกัน)
คอลัมน์ admin แสดงติ๊กล็อกไว้เสมอ (bypass ในโค้ด แก้ไม่ได้)

---

## 6. Rollout Plan

| Phase | ทำอะไร | เสี่ยง | Definition of Done |
|-------|--------|--------|-------------------|
| **0** ✅ | `permission_catalog` + seed `resource:action` (= พฤติกรรมวันนี้เป๊ะ) + `has_perm()` + `can()`/`usePerms()` | **ศูนย์** — เพิ่มอย่างเดียว ไม่มีโค้ด/policy ไหนเรียกของใหม่ | build ผ่าน, migration apply แล้ว, ระบบเดิมทำงานเหมือนเดิม |
| **1** | หน้า จัดการสิทธิ์ → matrix resource×action + realtime cache refresh | ต่ำ (แตะหน้าเดียว) | admin ติ๊กแล้วค่า persist, ค่า `page:/` เดิมยังแก้ได้ |
| **2** | ไล่แทน hardcode ด้วย `can()` ทีละหน้า — ลำดับ: ProductMaster → MachineDatabase → LineStock → ShiftOrganize → operator → Report(4M) → DailyReport → EventLog | กลาง (ทีละหน้า, ทดสอบต่อหน้า) | หน้า X ไม่เหลือ `manage_master_data`/hardcode; พฤติกรรม default เท่าเดิม |
| **3** | เปิด RLS `has_perm` ทีละ table (main project) แทน `using(true)` | กลาง–สูง (ทำทีละ table + smoke test) | ยิง API ตรงด้วย role ที่ไม่มีสิทธิ์ถูกปฏิเสธ; ผ่าน advisor scan |
| **4** | DR project: forward JWT ของ main → ตั้ง RLS `authenticated`+`has_perm` ฝั่ง DR | สูง (ต้องทดสอบทุกหน้า DR) | DR ปิด anon ได้โดยแอปไม่พัง |

**กติกาความปลอดภัยทุก phase:**
- seed/default ต้องตรงพฤติกรรมปัจจุบันเป๊ะ — การ "เข้มขึ้น" เกิดจาก admin ติ๊กเอง ไม่ใช่จาก deploy
- deploy ลำดับ: migration ก่อน → frontend ทีหลัง (frontend ใหม่พึ่งตาราง/ฟังก์ชันใหม่)
- ทุก phase มี rollback: Phase 0–2 = revert commit; Phase 3 = `alter policy ... using (true)` คืนได้ทันที per-table

---

## 7. Phase 4 — แนวทาง DR project (บันทึกไว้ก่อน ยังไม่ทำ)

ปัญหา: `supabaseDR` ใช้ anon key ล้วน ไม่เคย auth → เปิด RLS แล้วพังทันที (เคย revert มาแล้ว)

**แนวทางที่เลือก: A — Forward JWT** (กระทบต่ำสุด)
1. DR project ตั้ง JWT secret ให้ **ตรวจ token ของ main project ได้** (JWKS/shared secret)
2. `supabaseClient.js`: สร้าง `supabaseDR` ด้วย `global.headers.Authorization = Bearer <main access_token>` และผูก `supabase.auth.onAuthStateChange` เพื่ออัพเดต header เมื่อ token refresh
3. เมื่อ request ฝั่ง DR เป็น `authenticated` แล้ว → ค่อยไล่เปลี่ยน policy `public` → `authenticated` (+ `has_perm` โดย sync ตาราง `role_permissions`/`profiles` ไป DR หรือฝัง role ใน JWT claim)
4. ทดสอบทุกหน้า DR (Daily Report, Product Master, PM, Line Stock, Heijunka, Rack, Machine) ก่อน merge

ทางเลือกสำรอง: B = Edge Function proxy (งานเยอะ), C = รวม project (ใหญ่เกิน scope)

---

## 8. Catalog เริ่มต้น (Phase 0 seed — ตรงพฤติกรรมวันนี้)

> a=admin m=manager s=supervisor l=leader q=qa d=doc_control p=display · **ตัวหนา = ทุก role**

| Resource | Actions (ผู้ได้สิทธิ์ตอน seed) |
|---|---|
| checkin | record (**ทุก role** — วันนี้ไม่มี gate ในหน้า) |
| daily_report | open_shift(a,m,s,l) · record(a,m,s,l) · request_close(a,m,s,l) · close_shift(a,m,s) · approve_close(a,m,s) · delete_session(a) · setup(a,m,s) |
| four_m | approve_sv(a,m,s,l) · approve_qa(a,m,q) · reset(a,m) · manage_docs(a,m) |
| event_log | create(a,m,s,l,q) · approve_o(a,m,s,l) · approve_qt(a,m,q) · approve_jme(a,m,s) · approve_me(a,m) · delete(a) |
| line_stock | issue(a,m,s,l) · manage_rounds(a,m,s) |
| heijunka | operate (**ทุก role**) |
| rack_center | operate (**ทุก role**) |
| products | create/edit/delete (a,m,s) |
| machines | create/edit/delete (a,m,s) |
| employees | register(a,m,s) · edit(a,m,s,l) · deactivate(a,m,s,l) |
| skills | edit(a,m,s) · delete(a,m) · approve_levelup(a,m,s) · approve_levelup_100(a,m) · run_weekly_update(a,m) |
| line_setup | edit(a,m,s) |
| shift_schedule | edit(a,m,s) |
| company_calendar | edit(a,d) |
| org | manage(a) |
| users | manage(a) |
| permissions | manage(a) |
| pm | setup(a,m,s) · record(**ทุก role**) · approve(a,m,s,q) |
| report | export(**ทุก role**) |

หมายเหตุ: สิทธิ์ที่ดู "กว้างเกิน" (เช่น display บันทึกเช็คชื่อได้) คือพฤติกรรมจริงของโค้ดวันนี้ — seed ตามจริงก่อน แล้วให้ admin เข้มขึ้นเองผ่านหน้า จัดการสิทธิ์ (Phase 1+)

---

## 9. คำถามที่ตอบไปแล้ว (decision log)

- **ตารางจัดการสิทธิ์ปัจจุบันคุมอะไร?** เฉพาะ "เข้าหน้าได้" (`page:/...`) — ไม่คุม CRUD ในหน้า (CRUD ยังเป็น hardcode + `manage_master_data`)
- **ทำแค่ UI หรือ UI+RLS?** → UI+RLS (UI อย่างเดียว bypass ผ่าน API ได้ ไม่ใช่ security จริง)
- **DR anon gap** → แนวทาง A (forward JWT) — Phase 4

---

## 10. 🔭 แท็บภาพรวม (Matrix) — "ใครทำอะไรได้บ้าง" ในจอเดียว (2026-10-06 · คำสั่ง user)

*"เรื่องสิทธิ์นี่ช่วยทำเป็นตาราง matrix ออกมาให้เห็นภาพทีสิ ว่า role, level, position อะไรทำอะไรได้บ้างในแต่ละฟังก์ชัน"*

**ทำเป็นจอ ไม่ใช่ตารางในเอกสาร** — เหตุผลเดียวกับ `/schema`: ทะเบียนสิทธิ์เปลี่ยนทุกสัปดาห์
(ตอนทำ: 14 ชุดสิทธิ์ × ~196 ฟังก์ชัน) ตารางที่พิมพ์มือจะผิดตั้งแต่สัปดาห์ถัดไป และไม่มีใครรู้ว่าผิด
⇒ `/permissions?tab=matrix` (แท็บแรก · อ่านอย่างเดียว) ใช้ **ข้อมูลชุดเดียวกับ 2 แท็บที่แก้ได้**
(`rows`/`map` ก้อนเดียว) — **ห้ามแยกแหล่ง** ไม่งั้นจอเดียวกันตอบคนละเลข

### 🔴 3 แกนที่ตัดสินว่า "คนคนหนึ่งทำอะไรได้" — เขียนไว้บนจอ เพราะเข้าใจผิดซ้ำทุกครั้ง

| แกน | ให้สิทธิ์ไหม | ทำอะไร | ตั้งที่ไหน |
|---|---|---|---|
| **ชุดสิทธิ์ (`role`)** | ✅ **ตัวเดียวที่ให้/ไม่ให้** | เปิดหน้า + ปุ่มในหน้า | `/permissions` แท็บ 📄 / 🛠️ |
| **ขอบเขต (`scope_depth` + สังกัด)** | ❌ | **หุบว่าเห็นข้อมูลของใคร** ไม่เพิ่ม/ลดปุ่ม | `/add-user` รายคน |
| **ตำแหน่ง / ระดับ (`position`)** | ❌ *(ยกเว้น 1 จุด)* | คำแนะนำ + ค่าตั้งต้นของขอบเขต | ฐานพนักงาน |

> **ข้อยกเว้นเดียวที่ `position` ล็อกของจริง = ช่องเซ็นในใบ MO** (`utils/mtnStepPerm.js` · `minRank`)
> ส่งมอบ ≥40 · ผู้ตรวจสอบ/หัวหน้าช่าง ≥50 · อนุมัติ/ปิดค่าใช้จ่าย ≥60 (ระดับจาก `POSITION_LEVELS`)
> — ที่เหลือทั้งระบบ **ห้ามเอา `position` มาบล็อกการทำงาน** (หน้างานมีข้อยกเว้นเสมอ · `utils/positions.js` หัวไฟล์)

### 🔴 ช่องในตารางมี 3 สถานะ ห้ามยุบเหลือ 2

| สัญลักษณ์ | ความหมาย | ทำไมต้องแยก |
|---|---|---|
| `✓` | เปิดให้ทำได้ | |
| `·` | ปิดไว้ (มีแถว `allowed=false`) | = **ตั้งใจปิด** |
| `–` | **ยังไม่เคยมีแถวในทะเบียน** | ระบบถือว่าไม่ได้สิทธิ์เหมือนกัน แต่ความหมายต่าง: ไม่มีใครเคยตัดสินใจ |

แท็บที่แก้ได้ใช้ `?? false` (ยุบ 2 สถานะหลังเป็นช่องว่าง) ซึ่งโอเคสำหรับการติ๊ก
แต่**จอภาพรวมต้องแยก** ไม่งั้นอ่านว่า "ปิดไว้ตั้งใจ" ทั้งที่จริงคือ "ไม่เคยตั้ง" · จอบอกจำนวนช่องที่ยังไม่ตั้งเสมอ

### สิ่งที่จอบอกเพิ่ม (ไม่ใช่แค่ติ๊ก)

- **จำนวนบัญชีจริงต่อชุดสิทธิ์** ใต้หัวคอลัมน์ — เห็นทันทีว่าคอลัมน์ไหนมีคนใช้ · default ซ่อนชุดสิทธิ์ที่ยังไม่มีใครถือ
  🔴 **โหลดจำนวนไม่ได้ = `null` ⇒ ขีด `—` และ *ไม่ซ่อน* คอลัมน์ไหนเลย** (ห้ามเดาซ่อนจากข้อมูลที่ไม่รู้)
- **"เฉพาะที่ชุดสิทธิ์ต่างกัน"** — ซ่อนแถวที่ทุก role เหมือนกันหมด เหลือเฉพาะเส้นแบ่งจริง (ตัว `admin` ไม่นับ เพราะเปิดเสมอ)
- **ช่องตาย** (`✕` สีจาง) = หน้า × คอลัมน์ธงเสริม (แอดมินหน่วยงาน) — `hasPermission()` บล็อก key `page:` ของ bucket ในโค้ด

### ⚠️ ของที่จอนี้ยัง**ไม่**ตอบ (อย่าเข้าใจผิดว่าครบ)

- **RLS ฝั่ง DB ไม่ได้อยู่ในตารางนี้** — ตารางนี้คือสิทธิ์ที่ "จอ" บังคับ · ฝั่ง DB ยังมี policy ที่เป็น `true` เปล่าอยู่มาก
  (OWASP A01 · ดู `docs/ACCESS-CONTROL-STANDARDS.md`) ⇒ **ติ๊กปิดในจอ ≠ ปิดจริงที่ฐานข้อมูล**
- **จุดที่ยัง hardcode `role === '…'` ในโค้ด** ไม่โผล่ในตารางนี้ (วัดล่าสุด 147 จุด) — ตั้งค่าที่นี่ไม่มีผลกับจุดพวกนั้น
- ไม่มีปุ่ม export (ทุกเอกสาร export ต้องขึ้นทะเบียน `/doc-forms` ก่อน — ยังไม่ทำ)

---

## §11 รัด RLS 13 ตารางที่ด่านอยู่ที่ UI ชั้นเดียว (2026-10-08 · QC audit)

ตารางเหล่านี้เคยเป็น `for all to authenticated using (true)` = **ใครที่ login แล้วยิง REST ตรง
ก็เขียนได้ทั้งตาราง ถึงปุ่มบนจอจะซ่อนอยู่** (ตรวจกับ `pg_policies` ของจริง ไม่ใช่เดาจาก migration)

| ตาราง | predicate ใหม่ | คีย์ที่เปิดปุ่มบนจอ |
|---|---|---|
| `telegram_channels` · `notification_rules` | `has_perm('page:/notification-config')` | หน้านั้นไม่มี `can()` เลย (route-gated) · RPC 3 ตัวของหน้าเดียวกันใช้คีย์นี้อยู่แล้ว |
| `pe_doc_sets` `pe_processes` `pe_fmea_items` `pe_cp_items` `pe_doc_revisions` `pe_change_requests` | `has_perm('pe:edit') or has_perm('pe:approve')` | `PEDocs.jsx:89-90` |
| `lpa_questions` `lpa_plans` `lpa_plan_days` | `has_perm('lpa:manage')` | แท็บที่เปิดด้วย `canManage` เท่านั้น |
| `lpa_audits` `lpa_audit_answers` | `has_perm('lpa:record') or has_perm('lpa:manage') or has_perm('lpa:delete')` | `canRecord` บันทึก · `canDelete` ลบ |

### 🔴 กฎที่ต้องยึดทุกครั้งที่รัด RLS (บทเรียนรอบนี้)

1. **predicate ห้ามแคบกว่าคีย์ที่เปิดปุ่มบนจอ** ⇒ ใช้ **union ของคีย์ที่ปุ่มใช้จริง**
   แคบกว่า = "กดแล้วปุ่มเขียวแต่ไม่บันทึก" (RLS ปฏิเสธ UPDATE/DELETE = สำเร็จ 0 แถว ไม่มี error)
   · เคสนี้ PE เกือบถูกรัดเป็น insert=`pe:edit` / update=`pe:approve` ซึ่ง**แคบกว่าจอ** (จอให้
     คนถือ `pe:edit` แก้แถวได้) ⇒ เปลี่ยนเป็น union
2. 🔴 **ตารางที่มี policy เดียว (`_all`) ต้องเพิ่ม `for select using (true)` ก่อนรัด**
   รัด `using` ของ `_all` เลย = **ปิดการอ่านไปด้วย ทั้งหน้าดับ** · `lpa_*` ทั้ง 5 ตัวเข้าข่ายนี้
   (telegram / notification / `pe_*` มี `_read`/`_select` แยกอยู่แล้ว)
3. ใช้ **`alter policy` ไม่ใช่ drop+create** — drop แล้ว create มีช่วงที่ตารางไม่มี policy
   = ปฏิเสธทุกคน ถ้า migration ล้มกลางทาง (บทเรียน 05/10)
4. **เช็คก่อนรัดว่า "ใครถือคีย์นี้จริง"** (`role_permissions`) — ไม่มีใครถือ = รัดแล้วไม่มีใครเขียนได้
   · `has_perm()` ให้ role `admin` ผ่านทุกคีย์อยู่แล้ว (admin bypass ในตัวฟังก์ชัน)
5. **ซ้อมด้วย role จริงหลังรัด** — ตั้ง `request.jwt.claims` เป็น id ของบัญชีจริงแต่ละ role
   แล้วเรียก `has_perm()` · ต้องผ่าน 2 ทิศ: คนที่ควรเขียนได้ยังได้ · `operator` เขียนไม่ได้
6. 🔴 **ตรวจซ้ำว่าทุกตารางยังมีแถว `cmd='SELECT'`** — เหลือ 0 แม้ตารางเดียว = rollback ทันที

### 💬 `event_comments` (DR) — ลบไม่ได้ ตั้งแต่คอมเมนต์ไปอยู่บนใบพิมพ์

ตั้งแต่ 07/10 คอมเมนต์ใต้ใบ MO ถูกพิมพ์ลงใบ FM-JIG-008 / FM-MTN-006 + Excel
⇒ ลบคอมเมนต์ = พิมพ์ใบเดิมซ้ำแล้วได้เนื้อไม่เหมือนใบที่ยื่นไปแล้ว (ขัดกฎ "ฟอร์มที่ยื่นออกไปแล้ว = บันทึก")

**วิธีที่ใช้: restrictive policy** — `for delete using (false)` + `for insert with check (มีข้อความ + มีชื่อคนพูด)`
ถูก **AND** กับ policy เดิม ⇒ DELETE เป็นไปไม่ได้ ขณะที่ select/insert/update ยังวิ่งผ่านของเดิม
🔴 ดีกว่า drop+create: **ไม่มีช่วงที่ตารางไม่มี policy** และของเดิมไม่ถูกแตะ ⇒ ย้อนด้วยการลบ 2 policy นี้
⚠️ ฝั่ง DR วิ่งด้วย `anon` เสมอ ⇒ policy เป็น `public` **ห้ามเปลี่ยนเป็น `TO authenticated`**

---

## §12 ด่านบนจอต้อง **เท่ากับ** ด่านในฟังก์ชัน DB (2026-10-12 · QC audit ข้อค้าง)

### 🔴 เคสจริง — ปุ่ม "บันทึก Bot Token" มีให้กด แต่กดแล้วไม่ผ่าน

| ด่าน | ค่า |
|---|---|
| หน้าจอ `page:/notification-config` | **admin · dept_admin · manager · supervisor** |
| ฟังก์ชัน `set_bot_token()` ใน DB | **`profiles.role = 'admin'` เท่านั้น** |

`NotificationConfig.jsx` วาดช่อง token + ปุ่มบันทึก **โดยไม่เช็ค role เลย**
⇒ supervisor/manager/dept_admin เห็นช่อง พิมพ์ token กดบันทึก แล้วได้ toast แดง
`forbidden: admin only` **ดิบๆ ภาษาอังกฤษ** = คลาส "ปุ่มเขียวแต่ไม่เซฟ"

**แก้: ซ่อนช่อง+ปุ่มสำหรับคนที่ไม่ใช่ admin — ไม่ใช่ขยายสิทธิ์ให้ฟังก์ชัน**
bot token = **กุญแจ** (ใครได้ไปยิงข้อความในนามบริษัทได้) ⇒ ให้ supervisor เปลี่ยนได้คือ
*เพิ่มความเสี่ยง* ไม่ใช่ *แก้บั๊ก* · 3 role ที่เหลือยังตั้งห้อง/เรื่อง/ผู้รับได้เหมือนเดิม
+ เขียนบนจอว่าตั้ง token ได้เฉพาะ admin · มีด่านชั้นในที่ `saveToken` ด้วย

**⚠️ ที่นี่เทียบ `role` ตรงๆ ไม่ผ่าน `can()` โดยเจตนา** — ขัดกฎ "ห้าม hardcode role" ไหม? **ไม่**
กฎนั้นมีไว้กัน *ด่านที่แคบกว่าสิทธิ์ที่ `/permissions` แจก* · เคสนี้ตรงกันข้าม: ด่านบนจอต้อง
**เท่ากับด่านใน DB เป๊ะ** จะเปลี่ยนเป็นคีย์สิทธิ์ได้ ต้องแก้ฟังก์ชัน DB พร้อมกัน
ไม่งั้นได้ mismatch กลับมาอีกแบบ · ใช้ `role` (ไม่ใช่ `realRole`) เพื่อให้ "ดูในมุมคนอื่น"
เห็นตรงกับที่คนนั้นเห็นจริง — และ view-as เปิดให้ admin เท่านั้น จึงไม่มีทางได้ปุ่มตาย

### ✅ ตรวจแล้วว่า **ไม่ใช่ปัญหา** — อย่าไปแก้

- **`get_auth_users()`** hardcode `role='admin'` · `page:/add-user` = **admin เท่านั้น**
  ⇒ ด่าน 2 ชั้นตรงกันพอดี ไม่มีใครเจอปุ่มตาย
- **`/display-rotation`** เรียก RPC เดียวกัน แต่เช็ค `realRole !== 'admin'` ฝั่งจอก่อน
  แล้วถอยไปโชว์ชื่อบัญชีแทนอีเมล = **ถูกต้องแล้ว** (degrade ไม่ใช่ error)

### 🔒 `login_email_exists()` — ถอดออกแล้ว (user ตัดสิน 12/10)

RPC `security definer` ที่ grant ให้ **`anon`** (จำเป็น เพราะ `Login.jsx` เรียกก่อน login)
คืน boolean ว่าอีเมลนี้มีบัญชีใน `auth.users` ไหม — เดิมใช้แยกข้อความ
"ไม่พบบัญชี" ออกจาก "รหัสผ่านผิด" ให้หน้างานรู้ว่าพิมพ์อีเมลผิด

**ความเสี่ยง:** ระบบเปิดบนอินเทอร์เน็ตจริง (Render + anon key อ่านได้จากหน้าเว็บ)
⇒ ใครก็ยิงไล่เดาได้ว่าอีเมลไหนมีบัญชี = **account enumeration** = ได้ลิสต์เป้าไปไล่ลองรหัสผ่าน
(บัญชีโรงงานมักใช้รหัสง่าย/ใช้ร่วมกัน ⇒ ขั้นแรกของการ password spraying)

**ตัดสิน:** ถอด — ชดเชย UX ด้วยข้อความบอกทางออกแทน
*"❌ อีเมลหรือรหัสผ่านไม่ถูกต้อง — ตรวจตัวสะกดอีเมลอีกครั้ง · ถ้าเพิ่งได้บัญชีใหม่ หรือลืมรหัสผ่าน ให้ติดต่อ admin"*
· ด่าน **`login-no-email-oracle`** กันเอากลับมา (ทั้งชื่อเดิมและ RPC ตัวใหม่ที่ทำหน้าที่เดียวกัน)
· 🔴 ห้ามแยก 2 กรณีนี้ ไม่ว่าจะด้วย RPC · ตาราง `profiles` · หรืออ่านจาก error ของ Supabase Auth

### 🧹 `fn_shift_schedule_scan(int)` — ถอน `EXECUTE` จาก `authenticated`

SECURITY DEFINER ไม่มีด่านสิทธิ์ข้างใน · ยิง Telegram + เขียน `shift_schedule_alerts`
· ความแรงถูกจำกัดโดย unique `(scope_key, week_key)` ⇒ ยิงได้สัปดาห์ละครั้งต่อส่วนงาน
· **ตัวชี้ขาด: ไม่มีโค้ดฝั่งจอเรียกเลย** — ผู้เรียกมีแค่ cron job #8 (`30 0 * * *` · รันเป็น `postgres`)
⇒ ถอน grant **ไม่กระทบการใช้งาน** ดีกว่าใส่ `has_perm()` ซึ่งต้องเดาคีย์ทั้งที่ไม่มีใครเรียกจากจอ

migration `20261012_mtn_sec_revoke_scan_and_email_oracle_main.sql` (**apply แล้ว 12/10** · MAIN)
· ใช้ `revoke` ไม่ใช่ `drop function` เพราะ (1) revoke ปิดช่องครบแล้วและย้อน 1 บรรทัด
(2) `drop` ค้างที่ตัว MCP ทุกครั้ง (timeout 60s) ⇒ SQL เก็บกวาดส่งให้ user รันเอง


---

## §13 🖥️ บัญชีกลาง (`account_kind='shared'`) **ห้ามลบอะไรทั้งนั้น** (2026-10-13 · คำสั่ง user)

*"บัญชีกลาง ไม่ควรลบได้นะ"* — มาจาก feedback หน้างานทีม MTN:
*"สำหรับ Account ส่วนงานอย่างของ MTN ผมมองว่าไม่น่าจะให้สามารถลบ MO ได้ จะได้ไม่กดลบกันมั่ว"*

**ทำไม:** บัญชีกลาง = จอ TV / บัญชีประจำเครื่อง-กะ (`maintenance` · `jigmaintenance` ·
`toolingmaintenance` · `TV-1..13` · `warehouse1` …) **ใช้ร่วมกันหลายคน** ⇒ ลบแถวแล้ว
**สอบกลับไม่ได้ว่าใครกด** (audit เขียนได้แค่ชื่อบัญชี) · บัญชีของคน (`person`) สิทธิ์เดิมไม่เปลี่ยน

**ด่าน 2 ชั้น**
| ชั้น | ที่อยู่ | ครอบอะไร **จริง** (วัดจากการออดิท 13/10) |
|---|---|---|
| จอ | `canDelete()` ใน `src/utils/permissions.js` (flag module-level `_sharedAccount` ตั้งจาก `App.jsx` ตอน `fetchProfile`) | เฉพาะปุ่มที่เรียก `canDelete()` ของกลาง — **ไม่ใช่ทุกปุ่มลบในระบบ** (ดูตารางความครอบคลุมข้างล่าง) |
| DB | `has_perm()` ของ **Main** — `case when p.account_kind='shared' and perm_key like '%:delete' then false` (migration `20261013_has_perm_shared_no_delete_main.sql`) | 🔴 **เฉพาะ policy ที่ใช้คีย์ลงท้าย `:delete`** ซึ่งมีจริงแค่ ~4 resource (`line_setup` · `lpa` · `shift_schedule` · `skills`) · policy ส่วนใหญ่ใช้ `qa:manage` / `kpi:manage` / `org:manage` ⇒ **ด่านนี้มองไม่เห็น** |

### 🔴 ความครอบคลุมจริง — อย่าเข้าใจผิดว่า "ปิดแล้วทั้งระบบ" (ออดิท 13/10)
| สิ่งที่นับ | จำนวน |
|---|---|
| `.delete()` ต่อ Supabase ทั้ง repo | ~139 จุด / 66 ไฟล์ (ฝั่ง DR ~66 จุด = **ไม่มีด่าน DB เลย**) |
| ปุ่มลบที่คนกดจริง (มี `confirm()`) | ~82 จุด |
| "ลบ" ที่จริงเป็น `update({is_active:false})` / `status:'cancelled'` | ~30 จุด — 🔴 **ด่าน DB แบบ `%:delete` มองไม่เห็นเลย** |
| จุดที่ผ่าน `canDelete()` ของกลาง (หลังแก้ 13/10) | 11 จุด |

⇒ **ยังไม่ใช่ "บัญชีกลาง = view-only"** · ที่ปิดไปแล้วคือ "ปุ่มลบที่ผ่าน util" + คีย์ `:delete` ฝั่ง Main
· การจะทำให้เป็น view-only จริงต้องตัดสินใจเป็น **ชั้น** (ลบ → อนุมัติ/เซ็น → master data →
ธุรกรรมประจำวัน) เพราะบัญชีกลางหลายตัว**ทำงานจริง** (`maintenance` รับ-ลงผลใบ MO · `warehouse1`
ยืนยันรอบส่ง · `planningstore` อัปโหลด forecast) — 📄 รายการที่จะติดถ้าปิดเหมา + ทางเลือก
"ปิดที่จุดเดียว" (ห่อ client / `canWrite()` / restrictive policy) → `docs/modules/shared-account-audit.md`

### 🚨 กับดักที่เจอจากการออดิท — ตัวแปรท้องถิ่นชื่อ `canDelete` ทับ util (แก้แล้ว 13/10)
5 หน้าเขียน `const canDelete = can('<res>','delete', role)` ⇒ **อ่านโค้ด/grep เหมือนมีด่าน
แต่เป็น `can()` เปล่าๆ** ด่านบัญชีกลางไม่ทำงาน: ลบสินค้า (`ProductMaster`) · ปิดเครื่องจักร
(`MachineDatabase`) · ลบใบ LPA · ลบ event log · ลบ OJT — ของที่ลบแล้วกู้ไม่ได้ทั้งนั้น
⇒ เปลี่ยนเป็น `mayDelete` + เรียก util · **มีด่าน `no-shadow-candelete` ห้ามกลับมา**
· `DailyReport` ลบกะ (`delete_session`) ก็เติม `!isSharedAccount()` แล้ว (คีย์ไม่ลงท้าย `:delete`
  + ตารางอยู่ DR ⇒ ด่านฝั่งจอเป็นด่านเดียว)

🔴 **ด่านต้องอยู่ก่อน `role === 'admin'` ทั้ง 2 ชั้น** — บัญชี `ADMIN` ในฐานจริง**เป็นบัญชีกลาง**
⇒ เช็คหลัง admin = ด่านไร้ผลกับบัญชีที่ลบได้ทุกตาราง (มีด่าน `shared-account-no-delete` ใน regressionGuards)

🔴 **ฝั่ง DR ไม่มี `has_perm`** (วิ่งด้วย `anon` — known gap ของโปรเจค) ⇒ ใบ MO / ตาราง DR
**พึ่งด่านฝั่งจอเท่านั้น** · ห้ามถอด `canDelete` ออกจากปุ่มลบของหน้าฝั่ง DR

**ซ่อนปุ่มได้ ห้ามซ่อนเหตุผล** (UI §6.9) — จอที่บล็อกต้องเขียน "🔒 บัญชีกลางลบใบไม่ได้" + tooltip
บอกทางออก (ล็อกอินด้วยบัญชีตัวเอง) · ทำแล้วที่ `/mtn-repair` ใบ MO

**ผลกระทบที่วัดจากฐานจริง 13/10** (บัญชีกลาง 45 บัญชี):
- `mtn` 3 บัญชี → เสีย `mtn_repair:delete` + `machines:delete` ← **ที่หน้างานขอมา**
- `manager` 1 · `admin` 1 · `supervisor` 2 → เสียคีย์ลบที่ role นั้นถืออยู่
- `qa` 14 · `display` 16 · `engineer` · `planner_store` · `engineer_nm` · `warehouse_delivery` 5
  → **ไม่เสียอะไร** (role ไม่ถือคีย์ลบอยู่แล้ว)
- ⚠️ **ข้อมูลทะเบียนไม่สะอาด:** บัญชีกลางหลายตัวเป็น "ชื่อคนจริง" (qa 14 ตัว · `ขวัญพร` ·
  `ชัยยุทธ`) — ถ้าเป็นบัญชีของคน ให้แก้ **ประเภทบัญชี → "บัญชีของคน"** ที่ `/add-user`
  แล้วสิทธิ์ลบกลับมาเอง (ห้ามแก้ `account_kind` ให้เงียบๆ — มันคือตัวตนของบัญชี)
