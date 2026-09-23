# 🗄️ โครงสร้างฐานข้อมูล (Data Map) — `/schema`

> สร้าง 2026-09-22 · คำขอ user (ทีมงานแจ้งมา):
> *"ESM สร้างหน้าโครงสร้างให้ผมมองเห็นได้ไหม ถ้าลองกดเจอบัค จะได้เห็น table ชื่ออะไร PK FK กันแบบไหน
> จะรายงานปัญหาได้ตรงครับ"*

---

## 1. หน้านี้ตอบอะไร

| คำถามของคนหน้างาน | ที่ตอบในจอ |
|---|---|
| ข้อมูลที่เพี้ยนอยู่ตารางไหน · ชื่อเต็มว่าอะไร | แท็บ 📋 ตาราง (ค้นได้ · จัดกลุ่มตามคำนำหน้า) |
| ตารางนี้คีย์อะไร (PK) · ผูกกับตารางไหน (FK ออก/เข้า) | แผง 🔑 คีย์หลัก + 🔗 ความสัมพันธ์ |
| ทำไมกดบันทึกแล้วเงียบ | แผง 🔧 รายละเอียดเชิงเทคนิค → RLS policy มีคำสั่งอะไรให้ role ไหน |
| หน้านี้ใช้ตารางอะไรบ้าง / ตารางนี้ถูกใช้ที่หน้าไหน | แท็บ 🧭 หน้าไหนใช้ตารางไหน (2 ทาง) |
| จะแจ้งบัคให้คนแก้ทำงานต่อได้ทันที | ปุ่ม 🐛 **แจ้งบัคเรื่องตารางนี้** → เปิดกล่อง 💬 พร้อมบริบทครบ |

**สิทธิ์:** `page:/schema` — seed ให้ทุก role ที่เป็นคนทำงาน (ยกเว้น `display` = บัญชีจอแขวน และ
`dept_admin` = bucket ไม่ใช่ role) · migration `20260922_schema_map_page_main.sql` ·
ปรับเพิ่ม/ลดเองได้ที่ `/permissions` (ลงทะเบียนใน `PAGE_GROUPS` แล้ว)

**จอนี้ไม่เห็นข้อมูลในตารางสักแถวเดียว** — มีแต่ชื่อตาราง/คอลัมน์/ชนิด/คีย์/policy (เมทาดาทาล้วน)

---

## 2. ที่มาของข้อมูล — 2 ทาง ไม่มีลิสต์ที่เขียนมือเลย

### (ก) โครงสร้าง ← อ่านสดจาก `pg_catalog` ผ่าน RPC

| ฟังก์ชัน | คืนอะไร | ขนาด | เรียกเมื่อไหร่ |
|---|---|---|---|
| `esm_schema_overview()` | ตาราง/วิวทั้งหมด (ชื่อ · จำนวนคอลัมน์ · PK · RLS · แถวโดยประมาณ · comment) + **เส้น FK ทั้งหมด** | ~33-35 KB/project | เปิดหน้า (cache 12 ชม.) |
| `esm_schema_table(p_table)` | คอลัมน์ทั้งหมด + PK/FK/refs/unique/check/index/policy/trigger ของ **ตารางเดียว** | ~3-8 KB | ตอนกดเลือกตาราง |

- migration: `20260922_schema_catalog_rpc_main.sql` · `20260922_schema_catalog_rpc_dr.sql`
  (**apply แล้วทั้ง 2 project 2026-09-22** ผ่าน MCP)
- `security definer` + `set search_path = pg_catalog, public` · สิทธิ์:
  **Main → `authenticated` เท่านั้น** · **DR → `anon, authenticated`**
  - ⚠️ `supabaseDR` ไม่เคย authenticate — ไม่ grant anon = จอฝั่ง DR ว่างแบบเงียบ (กฎเหล็กใน CLAUDE.md)
  - 🔴 **`revoke ... from public` ไม่พอที่จะกัน anon** — Supabase ตั้ง default privileges ให้ฟังก์ชันใหม่
    ทุกตัวใน schema public ได้ execute ทั้ง `anon`/`authenticated`/`service_role` **แบบ grant ตรงถึง role**
    ⇒ ฝั่ง Main ต้อง `revoke execute ... from anon` ตรงๆ (เจอตอนตรวจกลับหลัง apply · แก้แล้ว 22/09)
    ตรวจด้วย `select proacl from pg_proc where proname like 'esm_schema%'` — **ฝั่ง Main ต้องไม่มี `anon=X`**
- **ไม่คืนตัวเงื่อนไข policy (`using` / `with check`)** โดยตั้งใจ — ตอบคำถาม "มี policy ของคำสั่งนี้ไหม
  ให้ role ไหน" ก็พอสำหรับการแจ้งบัคแล้ว
- **ทำไมต้องแยก 2 ฟังก์ชัน:** คอลัมน์ของทุกตารางรวมกัน = 4,100+ แถว ก้อนเดียวหลายร้อย KB
  → ผิดกฎเหล็ก egress ข้อ 11 (จอรายการเอาเท่าที่ใช้ · ใบเต็มดึงตอนเปิดทีละใบ)

**ทำไมไม่ใช้ `docs/sql/00_schema_snapshot_*.sql`:** ไฟล์นั้น dump ครั้งเดียว 2026-07-10 แล้วไม่เคยตามอีกเลย
(ตอน dump ยังไม่มี `npi_*` / `kpi_*` / `lpa_*` …) — **เอกสารที่ผิดแย่กว่าไม่มีเอกสาร**

### (ข) "หน้าไหนใช้ตารางไหน" ← สแกนซอร์สตอน build

- `scripts/vite-plugin-schema-usage.mjs` → virtual module **`virtual:schema-usage`**
  (ไม่มีไฟล์ generate ให้ commit — ทุก build = ตรงกับโค้ด ณ วันนั้นเสมอ)
- logic บริสุทธิ์อยู่ที่ **`src/utils/schemaUsageScan.js`** (มีเทส `__tests__/schemaUsageScan.test.mjs`)
- วิธีทำงาน: อ่าน `src/App.jsx` → route → ไฟล์หน้า → **เดินตาม import ญาติทั้งสาย** เก็บทุก
  `supabase.from('x')` / `supabaseDR.from('x')` / `.rpc('x')`

> ### 🔴 กับดักที่เจอจริงตอนทำ — ล็อกด้วยเทสแล้วทั้งหมด
> 1. **ห้ามเดินเข้า `src/App.jsx`** — มันคือ router ที่ import ทุกหน้า และทุกหน้า `import { UserContext } from '../App'`
>    กลับมา ⇒ เดินเข้าครั้งเดียว **ทุกหน้าได้รายชื่อตารางเหมือนกันหมด** (/daily-report ได้ 112 ตาราง Main
>    ทั้งที่จริงแตะไม่กี่ตัว · ก้อนข้อมูลบวมจาก 40 KB → 575 KB)
> 2. **คอมเมนต์ต้องถูกตัดก่อนสแกน** — `// checkWrite(await supabase.from('t')…)` ใน `utils/dbWrite.js`
>    ทำให้ได้ตารางผีชื่อ `t`
> 3. **`storage.from('bucket')` ไม่ใช่ตาราง** — ตัวสแกนรับเฉพาะชื่อ client ที่ whitelist ไว้

**ขอบเขตที่ตั้งใจ (ไม่ใช่บั๊ก):** จับเฉพาะชื่อตารางที่เขียนตรงๆ ในโค้ด (ทั้งระบบเขียนแบบนี้ ~1,900 จุด) ·
component กลางที่รับ client เป็น prop (`client.from(...)` — `AuditLogViewer`) ถูกจัดเป็น "ไม่ทราบฝั่ง"
แล้วไปเทียบกับทะเบียนตารางจริงบนจอ · ตารางที่ถูกแตะโดย Edge Function / trigger ฝั่ง DB จะไม่ขึ้น

**ผลพลอยได้:** ชื่อตารางในโค้ดที่**ไม่มีอยู่จริงในฐานทั้ง 2 ฝั่ง** ถูกรวบไว้ท้ายแท็บ 🧭 (กล่องส้ม) —
จุดพวกนั้นจะพังเงียบตอนรันจริง

---

## 3. ปุ่ม 🐛 แจ้งบัค — ต่อเข้ากล่อง feedback เดิม ไม่ได้ทำใบที่ 2

- ข้อความตั้งต้นสร้างจาก **`src/utils/schemaReport.js`** (pure + มีเทส):
  ตาราง · ฐานข้อมูล+project id · PK · FK ออก/เข้า · หน้าที่ใช้ · ลิงก์ `?t=<proj>.<table>` · ช่องให้กรอกอาการ
- ส่งเข้ากล่องเดิม (`user_feedback` · `FeedbackModal`) ผ่าน **`src/utils/feedbackPrefill.js`**
  (`openFeedback(text)` ยิง event `esm:open-feedback` → `Sidebar` เปิดกล่อง → modal อ่าน prefill ตอน mount)
  · กล่อง feedback mount อยู่ใน `Sidebar` ส่ง prop ลงหน้าไม่ได้ จึงใช้ event
  · **หน้าอื่นที่อยากมีปุ่ม "แจ้งปัญหาพร้อมบริบท" ให้ใช้ `openFeedback()` ตัวนี้ ห้ามทำกล่องใบใหม่**

---

## 4. รายละเอียด UI ที่ตั้งใจไว้

- `PageHeader` + `useTabParam` (แท็บอยู่ใน URL) · เลือกตารางแล้วอยู่ใน URL ด้วย (`?t=main.employees`)
  → **แปะลิงก์ในใบแจ้งบัคได้ตรงตาราง**
- ลิสต์ 300+ ตาราง = จัดกลุ่มตาม**คำนำหน้าที่มีจริงในชื่อ** (`npi_*` · `kpi_*` · `qa_*` …) พับ/กางได้
  — data-driven ล้วน ไม่มีลิสต์กลุ่ม hardcode ให้ต้องตามแก้เวลามีโมดูลใหม่ · กลุ่มที่มีตัวเดียวรวมเป็น "อื่นๆ"
  · พิมพ์ค้นเมื่อไหร่ = กางทุกกลุ่มอัตโนมัติ
- **ไม่มีกล่อง scroll แนวตั้งซ้อน** (UI-CONVENTIONS §6.8) · มือถือยุบเหลือคอลัมน์เดียว + ปุ่ม "← กลับไปลิสต์"
  (ไม่มี sticky = ไม่ชนกับดัก mobile §334)
- ตัวเลขแถวคือ **ค่าประมาณจาก `reltuples`** — เขียนบนจอไว้ตรงๆ ว่าประมาณ (ห้ามทำให้คนเข้าใจว่านับจริง)
- อ่านโครงสร้างฝั่งไหนไม่ได้ → **ขึ้นกล่องแดงบอกว่าฝั่งไหนและน่าจะเพราะอะไร** (ยังไม่ apply migration /
  ไม่ได้ grant) ไม่ใช่โชว์ 0 ตาราง

---

## 5. งานที่ตั้งใจ "ยังไม่ทำ" (เฟสถัดไป — ห้ามหยิบไปทำเองจนกว่า user สั่ง)

- แผน ER แบบวาดเส้น (ตอนนี้บอกความสัมพันธ์เป็นลิสต์ 2 ทิศ ซึ่งอ่านง่ายกว่าบนมือถือ/จอ TV)
- ค้นหา "ระดับคอลัมน์" ข้ามทุกตาราง (ต้องดึงคอลัมน์ทุกตารางมาไว้ฝั่ง client = ขัดกฎ egress ข้อ 11)
- ผูกตาราง ↔ Edge Function / pg_cron (ตอนนี้เห็นแค่ trigger กับ RPC ที่หน้าเรียก) — จะทำให้หมวด 🕳️ ใน
  แท็บ 🩺 ฟันธงได้จริงว่า "ลบได้ไหม" แทนที่จะเป็นแค่รายการที่ต้องไปตรวจ

---

## 6. rollback

```sql
-- ทั้ง 2 project
drop function if exists public.esm_schema_overview();
drop function if exists public.esm_schema_table(text);
-- Main
delete from role_permissions where permission_key = 'page:/schema';
```
ฝั่งโค้ด: ถอด route/NAV `/schema` + `src/pages/SchemaMap.jsx` + plugin ใน `vite.config.js`
และ `audit/vite.audit.mjs` (ถอด plugin อย่างเดียวโดยยังมีหน้าอยู่ = หน้าพังเพราะหา `virtual:schema-usage` ไม่เจอ)

---

## 7. 🩺 แท็บตรวจสุขภาพโครงสร้าง + การล้างตารางสำรอง (2026-09-22 รอบ 2)

> คำสั่ง user: *"พวกตารางซ้ำๆ คือยังไง audit test และ improve ได้มั้ย ตารางไหนไม่ได้ใช้ หรือมัน
> โครงสร้างไม่ดี แก้ไขให้ที ตอนนี้จำนวน schema เยอะมาก"* (เห็นจากจอ `pm_*` ที่มี `pm_plans` คู่กับ
> `pm_plans_bak_test1_20260909` เรียงติดกัน)

### 7.1 ต้นเหตุของ "ตารางซ้ำๆ"

ทุกครั้งที่ session ก่อนๆ ทำ migration ที่แตะข้อมูลจริง จะ `create table <ชื่อ>_bak_<วันที่> as select …`
ไว้กันพลาด — **ถูกต้องตามกฎ rollback แล้ว** แต่สร้างไว้ใน `public` และไม่มีใครกลับมาเก็บกวาด
⇒ สะสม **37 ตารางใน ~1 เดือน** (DR 33 · Main 4) ปนกับตารางจริงทุกที่ที่มองเห็น schema

**🔴 ที่แย่กว่าความรก — ข้อมูลจริงรั่วผ่าน anon key:** 35 ใน 37 ตัว **ไม่มี RLS**
(`create table as select` คัดลอกข้อมูลมา แต่ policy ไม่ได้ตามมาด้วย) · ฝั่ง DR ที่ client วิ่งด้วย
role `anon` เสมอ = ใครมี anon key (ฝังอยู่ในบันเดิลเว็บ) อ่าน/เขียน/ลบสำเนาข้อมูลผลิตจริงได้โดยไม่ต้อง login
· ของจริงที่ค้างอยู่: ใบผลิต 1,361 + 561 แถว · ใบขอซื้อ 984 แถว · downtime reclass 958 แถว · ลิงก์แจ้งเตือน 51,454 แถว

### 7.2 ทำอะไรไป — **ย้าย ไม่ลบ**

`alter table public.<ชื่อ> set schema archive;` ทั้ง 37 ตัว
(migration `20260922_archive_backup_tables_{main,dr}.sql` · **apply แล้ว 22/09**)

| | ก่อน | หลัง |
|---|---|---|
| ตาราง/วิวใน public — DR | 173 | **140** |
| ตาราง/วิวใน public — Main | 140 | **136** |

- **ข้อมูลอยู่ครบทุกแถว** — rollback = `alter table archive.<ชื่อ> set schema public;` (มีลิสต์เต็มท้ายไฟล์ migration)
- schema `archive` **ไม่ถูก expose ผ่าน PostgREST** + `revoke all … from anon, authenticated`
  ⇒ หายจาก API และจากจอ /schema ทันที แต่ยังเปิดดู/กู้ได้จาก SQL Editor
- **ไม่ drop** เพราะลบแล้วย้อนไม่ได้ — ให้ user ตัดสินใจลบเองเมื่อมั่นใจ (ดู §7.5)
- ตรวจก่อนย้ายครบ 2 ชั้น: ไม่มีโค้ด client/edge เรียกใช้ (สแกน `.from()` ทั้งรีโป) **และ**
  ไม่มี function/trigger/view ฝั่ง DB อ้างถึง (สแกน `pg_get_functiondef` + `pg_get_viewdef`)

### 7.3 กันไม่ให้กลับมาอีก (3 ชั้น)

1. **ด่านใน build** — `regressionGuards` กฎ `backup-tables-go-to-archive`:
   migration ที่ลงวันที่ ≥ 20260922 ห้าม `create table` ชื่อเข้าข่ายตารางสำรองใน public (ต้องเป็น `archive.`)
   · ของเก่าก่อนหน้านั้นไม่ถูกฟ้อง (รันไปแล้ว + ย้ายเข้า archive แล้ว) · **เดิมตั้ง 20260923 แล้วรั่วจริงภายในวันเดียว — ดู §7.6**
   · คู่กับกฎ `new-table-needs-rls` (ตารางใหม่ใน public ต้องเปิด RLS ในไฟล์เดียวกัน · §7.6)
2. **แท็บ 🩺 ในจอ** — ถ้ามีตัวใหม่โผล่ใน public จะขึ้น 🔴 ทันทีที่เปิดจอ
3. **ตัวตัดสินชื่อมีจุดเดียว** — `BACKUP_RE` ใน `src/utils/schemaAudit.js`
   ใช้ร่วมกันทั้งจอ · ด่าน build · (และ regex เดียวกันในไฟล์ migration) **แก้ต้องแก้พร้อมกัน**

### 7.4 แท็บ 🩺 ตรวจสุขภาพโครงสร้าง — 6 หมวด

ตัวตรวจ = `src/utils/schemaAudit.js` (pure + เทส `__tests__/schemaAudit.test.mjs`) อ่านจาก
`esm_schema_overview()` + ดัชนี "หน้าไหนใช้ตารางไหน" ⇒ **คำนวณสดทุกครั้งที่เปิดจอ ไม่ใช่รายงานแช่แข็ง**

| หมวด | ระดับ | เกณฑ์ |
|---|---|---|
| 🧹 ตารางสำรองค้าง public | 🔴 | ชื่อเข้าเกณฑ์ `BACKUP_RE` |
| 🛡️ RLS ปิด | 🔴 ฝั่ง DR · 🟡 ฝั่ง Main | ตารางจริง (ไม่นับวิว) ที่ `relrowsecurity = false` |
| 🔑 ไม่มี PK | 🟡 | ตารางจริงที่ไม่มี primary key |
| 🕳️ ไม่มีหน้าไหนใช้ + ไม่มี FK ชี้มา | 🔵 | ใช้เป็น "รายการที่ต้องไปตรวจ" เท่านั้น |
| 🈳 โค้ดใช้อยู่แต่ 0 แถว | 🔵 | ฟีเจอร์พร้อมแต่ยังไม่มีใครกรอก (หรือบันทึกไม่ติดเงียบๆ) |
| 📦 ตารางที่กินที่มากสุด | 🔵 | Top 5 จาก `pg_total_relation_size` (เพิ่ม `bytes` ใน RPC — migration `20260922b`) |

**🔴 กติกาของจอนี้: ทุกหมวดต้องบอก "ทำไมเป็นปัญหา" + "แก้ยังไง" เสมอ** — ลิสต์ชื่อตารางเฉยๆ
ไม่ช่วยใครตัดสินใจ และจะกลายเป็นจอที่ทุกคนเมินภายใน 2 สัปดาห์
**และ "ไม่มีหน้าไหนใช้" ≠ "ลบได้"** — ตัวสแกนเห็นเฉพาะโค้ดฝั่งหน้าเว็บ (เขียนเตือนไว้บนจอแล้ว)

### 7.5 ของที่ "เจอแล้ว แต่ยังไม่แตะ" — รอ user ตัดสิน (ห้ามลบเอง)

ทั้งหมดนี้ **ไม่ได้ลบและไม่ได้ย้าย** เพราะเป็น product decision ไม่ใช่ขยะจาก migration:

| กลุ่ม | ตาราง | สภาพ |
|---|---|---|
| ชุด KPI รุ่นเก่า (Main) | `kpi_items` (28) · `kpi_targets` (313) · `kpi_actuals` (39) · `kpi_raw_inputs` · `kpi_section_detail` | ถูกแทนด้วย `kpi_definitions`/`kpi_catalog`/`kpi_manual_entries` — ไม่มีโค้ดอ่านแล้ว แต่ **มีข้อมูลจริงของปีก่อน** |
| PPE รุ่นเก่า (Main) | `ppe_items` · `ppe_checks` · `ppe_requirements` · `attendances` | ว่างทั้งหมด — ของจริงไปอยู่ใน `daily_production_logs` (has_helmet/boots/gloves) นานแล้ว |
| ทะเบียนเอกสารรุ่นเก่า | `document_controls` · `document_control_revisions` | ตั้งใจเก็บเป็น vestigial ตั้งแต่ 2026-07-30 (ยุบเข้า `doc_forms`) |
| อื่นๆ ที่ไม่มีใครเรียก | Main: `part_registry` · `part_images` · `profile_org_access` · `production_shots` · `nav_groups` · `employee_photo_purge_log` (ปิด RLS แล้ว §7.6) · `kpi_base_inputs` · `kpi_month_plans` · DR: `production_shots` · `guests` · `tasks` · `user_signatures` · `pm_org_nodes` · `energy_utilities` · `kanban_scans` · `mtn_mo_counter` · วิว `v_sloc_stock` | ต้องเช็คเป็นตัวๆ ว่าเป็น "เลิกใช้" หรือ "ทำโครงไว้รอต่อ" |
| ⚠️ **ทะเบียนมาตรฐาน KPI ที่เพิ่ง seed** | `kpi_standard_items` (261 แถว · migration 20260921) | **ยังไม่มีจอไหนอ่านเลย** — งานค้างจริง ไม่ใช่ของทิ้ง |
| 📦 ไม่มีนโยบายลบย้อนหลัง | ~~Main `notifications`~~ **ตั้ง retention แล้ว 23/09** (84,247 → 51,984 แถว · cron `purge-notifications`) · DR `audit_log` 38 MB (มี cron 6 เดือนแล้ว) | ✅ ดู `docs/modules/notifications-flood.md` — ต้นเหตุจริง (ผู้รับ 30 คน/เหตุการณ์) แก้ไปครึ่งทาง ที่เหลือเป็น product decision |

> **ทำไมไม่ลบให้เลย:** ลบตาราง = ย้อนไม่ได้ และ 6 กลุ่มข้างบนมีทั้ง "ข้อมูลจริงปีก่อน" กับ
> "โครงที่ทำไว้รอต่อ" ปนกัน — กฎของโปรเจคคือ AI ทำเฉพาะสิ่งที่ย้อนได้เอง ที่เหลือหยุดถาม

### 7.6 รอบตาม (2026-09-22 เย็น) — ปิดช่อง RLS ที่เหลือ + หลักฐานว่าวงจร "ตารางสำรองค้าง" เกิดซ้ำจริง

**วงจรเกิดซ้ำภายในวันเดียว:** รอบ §7.2 ย้าย 33 ตารางออกตอนเช้า · บ่ายวันเดียวกัน session ขนาน
(migration `20260922_bom_flat_dupe_rows_off_dr.sql`) ก็สร้าง `public.bom_items_backup_20260922`
เพิ่มอีกตัว — RLS ปิด · ไม่มี PK · 598 แถวของ BOM จริง **และด่านใน build ไม่จับ** เพราะตอนนั้นตั้ง
`SINCE = 20260923` (ไม่บังคับไฟล์ลงวันที่เดียวกับรอบทำความสะอาด)
⇒ แก้แล้ว: ลด `SINCE` เป็น **20260922** + มีรายการ `CLEANED` ยกเว้นเฉพาะไฟล์นั้นไฟล์เดียว
(**ห้ามเพิ่มชื่อใหม่เข้า `CLEANED` เพื่อให้ build ผ่าน** — ให้สร้างใน `archive.` ตั้งแต่แรกแทน)

| ทำอะไร | project | migration | ผลหลังรัน |
|---|---|---|---|
| ย้าย `bom_items_backup_20260922` → `archive` | DR | `20260922d_archive_bom_backup_dr.sql` | อยู่ schema `archive` · หายจาก API/จอ |
| เปิด RLS `child_demand_explosions` (14,505 แถว) — policy **INSERT อย่างเดียว** | DR | `20260922d_rls_child_demand_explosions_dr.sql` | `relrowsecurity = true` · 1 policy (`cde_insert_trigger:a`) |
| เปิด RLS `employee_photo_purge_log` (18 แถว) — **ไม่มี policy** | Main | `20260922d_rls_employee_photo_purge_log_main.sql` | `relrowsecurity = true` · 0 policy · ข้อมูลครบ |

**ผลรวม: ตารางใน `public` ที่ RLS ปิด = 0 ทั้ง 2 project** (จากเดิม DR 1 · Main 1 หลังรอบแรก)

**🔴 บทเรียนที่ต้องจำ — trigger ที่ไม่ใช่ SECURITY DEFINER วิ่งด้วยสิทธิ์ของคนยิงคำสั่ง:**
`fn_explode_child_demand` มี `prosecdef = false` ⇒ ตอน trigger ทำงานมันเป็น role `anon`
⇒ **เปิด RLS เฉยๆ โดยไม่ให้ policy INSERT = ยืนยันใบผลิตพัง 42501 ทั้งระบบทันที**
จึงให้ policy เฉพาะ `for insert with check (true)` — ตัวฟังก์ชันไม่เคย SELECT ตารางนี้เลย
(ตรวจ `prosrc` ทั้งตัวแล้ว) ⇒ ไม่มี policy อ่าน/แก้/ลบ = anon แตะไม่ได้ แต่ของเดิมทำงานเหมือนเดิม
· ทดสอบจริงแล้วด้วย `set local role anon`: insert ผ่าน · select ได้ 0 แถว · delete ได้ 0 แถว
· `unique_violation` (ตัวกันระเบิดซ้ำ) ยังทำงานปกติ — เป็นด่าน index ไม่ใช่ด่าน RLS

**ด่านใหม่ใน build: `new-table-needs-rls`** (`regressionGuards`) — migration ลงวันที่ ≥ 20260923
ที่ `create table` ใน `public` ต้องมี `alter table ... enable row level security` ในไฟล์เดียวกัน
· ตารางชั่วคราว/สำรอง → สร้างใน `archive` (ด่านนี้ไม่แตะ) · ตารางที่ตั้งใจให้ไม่มีใครอ่าน
(log ของ migration) = เปิด RLS แล้วไม่ต้องมี policy
