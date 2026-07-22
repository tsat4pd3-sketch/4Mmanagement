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
