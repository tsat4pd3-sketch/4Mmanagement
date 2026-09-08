# 🚚 แผนย้าย ESM มา server ของบริษัท (Self-host)

> เริ่มเขียน 2026-09-08 — ไอทีจะรับช่วง maintain ต่อบน local server ของ TSG
> เอกสารนี้เป็น **ของจริงที่วัดจากระบบที่รันอยู่** ไม่ใช่ประมาณการ · ตัวเลขวัดวันที่ 2026-09-08

---

## 0. ⛔ ข้อสรุปที่ต้องตกลงก่อนเริ่ม: **ต้องเป็น PostgreSQL เท่านั้น**

มีการเสนอให้ย้ายไป **MySQL** — **ทำไม่ได้** ไม่ใช่เรื่องความชอบ แต่เป็น requirement ของระบบ

**เหตุผลข้อเดียวที่พอ:** ระบบนี้**ไม่มี backend เป็นของตัวเอง**
React คุยกับ **PostgREST** (REST API ที่ Supabase สร้างอัตโนมัติจาก schema ของ Postgres) โดยตรง
**1,770 จุด** ใน 196 ไฟล์ — MySQL ไม่มีสิ่งนี้ ⇒ ต้องเขียน backend API ใหม่ทั้งหมด แล้วไล่แก้ทั้ง 1,770 จุด

ของที่หายทันทีถ้าเปลี่ยนเป็น MySQL:

| ของที่มีอยู่ | จำนวน | MySQL |
|---|---|---|
| RLS policies (กฎว่าใครเห็นข้อมูลอะไร) | **410** | ❌ ไม่มี RLS — ต้องย้ายไปเขียนในโค้ด **พลาดข้อเดียว = ข้อมูลรั่วข้ามสิทธิ์** |
| Auth (login/JWT/reset password) | 86 users · 54 จุด | ❌ ไม่มี |
| Storage | 1,552 ไฟล์ / 290 MB · 11 buckets · 48 จุด | ❌ ไม่มี |
| Realtime | 9 จุด | ❌ ไม่มี |
| Edge Functions (Deno) | 21 ตัว | ❌ เขียนใหม่ |
| PL/pgSQL functions · triggers | 79 · 258 | ⚠️ คนละภาษา |
| **Array columns** (`sections[]`, `mtn_teams[]`, `hidden_for_lines[]`) | 23 | ❌ **MySQL ไม่มี array type** ต้องแตกเป็นตารางใหม่ + แก้ทุกจุดที่อ่าน |
| **`timestamptz`** | 480 | ⚠️ ไม่เก็บ timezone แบบเดียวกัน — **เสี่ยงพังกฎ work_date ไทย + กะดึกข้ามวัน ทั้งระบบ** |
| `jsonb` | 18 | ⚠️ index ไม่เหมือนกัน |
| pg_cron + pg_net | 16 jobs | ❌ ไม่มี |
| migrations | 360 ไฟล์ | ❌ ใช้ไม่ได้สักไฟล์ |

⇒ **ทางเดียวที่ไม่ต้องเขียนใหม่: self-host Supabase (docker-compose) บน server บริษัท**
ได้ PostgreSQL + Auth + Storage + Realtime + PostgREST + Edge Functions ครบชุดเหมือนเดิม

**สเปคขั้นต่ำที่ต้องขอ:** Linux + Docker · RAM 16 GB · Disk 200 GB · มีแผน backup
(ตอนนี้ DB 183 MB + ไฟล์ 290 MB แต่ถ้าต่อ SCADA จำนวนแถวจะโต **×113–450** — ดู `docs/SCADA_REALTIME_DESIGN.md`)

---

## 1. ขนาดงานจริง (วัด 2026-09-08)

| | MAIN (`ewhdfqwfwofivojtsizn`) | Product DB / DR (`eyhclzkifitbhbljgoav`) |
|---|---|---|
| ตาราง | 132 | 139 |
| ขนาด DB | 92 MB | 91 MB |
| RLS policies | 271 | 139 |
| Triggers | 129 | 129 |
| DB functions | 28 | 51 |
| Views | 1 | 6 |
| Indexes | 296 | 287 |
| Cron jobs | 7 | 9 |
| Storage | 362 ไฟล์ / 173 MB | 1,190 ไฟล์ / 117 MB |
| auth users | **86** | 3 |

Edge Functions **21 ตัว** (ซอร์สอยู่ใน `supabase/functions/` ครบ) · migrations 360 ไฟล์

---

## 2. ✅ เฟส 1 — ทำแล้ว (2026-09-08): ถอด URL ที่ hardcode **ฝั่งเว็บ 12 จุด**

> ครอบเฉพาะโค้ดใน `src/` · ฝั่ง DB และซอร์ส edge ยังค้างอีก 18 จุด (§3)

**ปัญหาที่แก้:** ย้าย server แล้วตั้ง env ครบ หน้าเว็บก็ยัง**ยิงแจ้งเตือนกลับ cloud ตัวเก่า** (URL ฝังในโค้ด)
และฝั่ง DR ยัง fallback ไปฐานเดิม **แบบเงียบ ไม่มี error** = ข้อมูลผลิตแตกเป็น 2 ที่

| แก้อะไร | ที่ไหน |
|---|---|
| สร้าง SSOT ของ URL/key | `src/utils/appConfig.js` (ใหม่) — `SUPABASE_URL` · `SUPABASE_DR_URL` · `fnUrl()` · `callFn()` · `configWarnings` |
| 8 จุด `fetch()` URL เต็ม → `callFn()` | `utils/notifyEvent.js` · `DailyReport.jsx` (3) · `PMSchedule.jsx` · `PMCheckData.jsx` · `MtnRepair.jsx` · `Checkin.jsx` |
| 3 จุดประกอบ URL เอง → `fnUrl()` | `AddUser.jsx` (create-user / reset-user-password / delete-user) |
| DR fallback → คุมที่เดียว + ส่งเสียงดัง | `supabaseClient.js` อ่านจาก appConfig แทน |
| ตั้ง env ไม่ครบ = **ป้ายเตือนแดงบนจอ admin** | `configBanner` ใน `App.jsx` |
| ประกาศ env ฝั่ง DR | `render.yaml` · `.env.example` |
| ล็อกด้วยเทส | `src/utils/__tests__/appConfig.test.mjs` (4 เคส — กันเคส base URL ติด `/` ท้าย) |

**ผลลัพธ์ที่พิสูจน์แล้ว:** build ด้วย env ปลอม → บันเดิลใช้ URL ใหม่ทั้งหมด · URL ของ MAIN **หายจากบันเดิล 100%**
· `crashsweep` 70 หน้า พัง 0

> ⚠️ `LEGACY_DR_URL/KEY` ใน `appConfig.js` **ยังอยู่** เพราะ Render ไม่เคยตั้ง env ฝั่ง DR — ถอดตอนนี้ = production ล่ม
> **ถอดเมื่อ:** ตั้ง `VITE_SUPABASE_DR_URL/KEY` ครบทุกที่ที่ build → ป้ายเตือนหายจากจอ → ลบทั้ง 2 ค่าในคอมมิทเดียว

---

## 3. ⬜ เฟส 2 — ยังไม่แก้ (URL hardcode 18 จุด: DB 12 + ซอร์ส edge 6)

**ยังไม่ทำเพราะเป็น "การเปลี่ยนพฤติกรรมที่ย้อนยาก"** (แตะเส้นทางแจ้งเตือน + PM scan ที่รันอยู่จริง)
ตามกฎ CLAUDE.md → ต้องให้ user ตัดสินใจก่อนลงมือ

### 3.1 Cron jobs ที่มี URL ฝังใน command

| Project | jobname | schedule |
|---|---|---|
| MAIN | `daily-4m-summary` | `0 1 * * *` |
| MAIN | `mtn-daily-summary` | `0 2 * * *` |
| MAIN | `qa-fme-scan` | `*/5 * * * *` |
| DR | `downtime-open-scan` | `*/5 * * * *` |
| DR | `kanban-round-scan` | `*/10 * * * *` |
| DR | `pm-daily-scan` | `*/10 * * * *` |
| DR | `pm-plan-reminder` | `0 1 * * *` |
| DR | `shipping-phase-scan` | `*/10 * * * *` |
| DR | `store-daily-scan` | `50 0 * * *` |

(cron ที่ไม่มี URL — `pm-refresh-plans` · `purge-audit-log` ×2 · `purge-cron-logs` · `daily-skill-farm`
· `weekly-skill-update` · `shift-schedule-gap-scan` — ย้ายได้เลย ไม่ต้องแก้)

### 3.2 DB functions ที่มี URL ฝังใน body (ทั้งหมดอยู่ MAIN)

| function | ผูกกับ trigger | ทำอะไร |
|---|---|---|
| `fn_notify_push` | ✅ 1 | `notifications` AFTER INSERT → ยิง edge `send-push` |
| `fn_notify_skill_levelup` | ✅ 1 | คำขออัพระดับทักษะ → แจ้งเตือน |
| `fn_shift_schedule_scan` | — (เรียกจาก cron) | สแกนช่องว่างตารางกะ |

### 3.3 ⚠️ ซอร์ส edge function ที่ฝัง URL ของ MAIN ไว้ในไฟล์ (6 ไฟล์)

**นี่คือกับดักเดียวกับที่เฟส 1 ปิดไปฝั่งเว็บ** — scan ที่รันบน cron ฝั่ง DR ยิงข้ามไปเรียก edge
แจ้งเตือนที่อยู่ฝั่ง MAIN ⇒ **ย้าย server แล้ว cron ทุกตัวยังส่งแจ้งเตือนกลับ cloud เก่า**

| ไฟล์ | บรรทัด | ตัวแปร |
|---|---|---|
| `supabase/functions/pm-plan-reminder/index.ts` | 12 | `NOTIFY_URL` → `send-notification` |
| `supabase/functions/pm-daily-scan/index.ts` | 13 (+127 ประกอบ `/rest/v1/rpc/…`) | `NOTIFY_URL` |
| `supabase/functions/downtime-open-scan/index.ts` | 13 | `NOTIFY_URL` |
| `supabase/functions/shipping-phase-scan/index.ts` | 13 | `NOTIFY_URL` |
| `supabase/functions/store-daily-scan/index.ts` | 19 | `NOTIFY_URL` → `send-store-notification` |
| `supabase/functions/kanban-round-scan/index.ts` | 24, 26, 61 | `MAIN_URL` — ใช้เป็น `createClient(MAIN_URL, MAIN_ANON)` ด้วย |

**แก้ยังไง:** ทั้ง 6 ไฟล์ใช้ `Deno.env.get('SUPABASE_URL')` อยู่แล้วสำหรับ client ของตัวเอง แต่ไม่ได้ใช้กับ
`NOTIFY_URL` → เปลี่ยนเป็นอ่านจาก secret ใหม่ เช่น `MAIN_FUNCTIONS_URL` (fallback = ค่าเดิม) แล้ว **redeploy ทั้ง 6 ตัว**
· ตั้ง secret นี้ใน dashboard ตอน cutover (§4.1 ข้อ 4)
· ตรวจ: `grep -rn "supabase\.co" supabase/functions/` ต้องได้ 0

### 3.4 แนวทางที่เสนอสำหรับ cron/function ฝั่ง DB (ยังไม่ลงมือ)

ทำ URL เป็น **data-driven จุดเดียวต่อ project** แทนที่จะฝังไว้ 12 ที่ — ให้ไอทีแก้ที่เดียวตอน cutover:

```sql
-- ตัวอย่างแนวทาง (ยังไม่ apply — รออนุมัติ)
-- 1. เก็บ base URL ไว้ที่เดียว
create table if not exists app_settings (key text primary key, value text not null);
insert into app_settings(key, value)
  values ('functions_base_url', 'https://<project>.supabase.co/functions/v1')
  on conflict (key) do nothing;

-- 2. helper อ่านค่า (fallback ค่าเดิมเสมอ = ยังไม่ตั้งก็ทำงานเหมือนเดิม)
create or replace function fn_base_url() returns text language sql stable as $$
  select coalesce((select value from app_settings where key='functions_base_url'),
                  'https://<project>.supabase.co/functions/v1');
$$;

-- 3. แก้ cron/function ให้ใช้ fn_base_url() || '/<ชื่อฟังก์ชัน>' แทน URL เต็ม
```

**เงื่อนไขความปลอดภัย:** fallback เป็นค่าเดิมเสมอ ⇒ apply แล้วพฤติกรรมไม่เปลี่ยนเลย (additive · ย้อนได้)
**วิธีตรวจหลัง apply:** `select jobname from cron.job where command ~ 'supabase\.co'` ต้องได้ 0 แถว
แล้วรอ 1 รอบ cron ดูว่าแจ้งเตือนยังเข้าปกติ

---

## 4. ⬜ เฟส 3 — ขั้นตอน cutover จริง

### 4.1 สิ่งที่ต้องส่งมอบให้ไอที (anon key **ไม่พอ**)

| # | ของ | หมายเหตุ |
|---|---|---|
| 1 | **DB password / connection string** ของทั้ง 2 project | สำหรับ `pg_dump` · **ต้อง dump `auth` schema ด้วย** ไม่งั้นพนักงาน 86 คนต้องตั้งรหัสใหม่ทุกคน |
| 2 | Storage 1,552 ไฟล์ / 290 MB (11 buckets) | `avatars` `employee-photos` `four-m-images` `improvement-images` `jig-images` `mtn-images` `npi-files` `pe-images` `product-images` `qa-drawings` `signatures` |
| 3 | Edge Functions 21 ตัว | ซอร์สอยู่ในรีโปแล้ว ✅ |
| 4 | **Secrets 12 ตัว** (+ `MAIN_FUNCTIONS_URL` ใหม่ ถ้าทำเฟส 2 §3.3) | `TELEGRAM_BOT_TOKEN` · `TELEGRAM_CHAT_ID` · `TELEGRAM_WEBHOOK_SECRET` · `ANTHROPIC_API_KEY` · `AI_INTAKE_CHAT_IDS` · `CRON_SECRET` · `CLEANUP_TOKEN` · `INGEST_SECRET` · `DR_URL` · `DR_ANON_KEY` · `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` |
| 5 | VAPID keys (Web Push) | อยู่ในตาราง `notification_settings` — มาพร้อม dump |

> 🔴 **`service_role` / secret key ห้ามส่งทางอีเมลหรือแชท** — ข้ามทุก RLS อ่าน `auth.users` ได้หมด
> anon/publishable key ส่งได้ (ฝังอยู่ในบันเดิลที่เบราว์เซอร์ทุกเครื่องโหลดอยู่แล้ว)

### 4.2 ลำดับ cutover

1. ตั้ง Supabase self-host บน server บริษัท → ทดสอบว่าเปิดหน้า login ได้
2. `pg_dump` ทั้ง 2 project (รวม `auth`, `storage` schema) → restore เข้า instance ใหม่
3. ก๊อป storage objects ทั้ง 11 buckets
4. Deploy edge functions 21 ตัว + ตั้ง secrets 12 ตัว
5. **แก้ URL ที่ค้าง 18 จุด** (เฟส 2): cron 9 job + DB function 3 ตัว (ถ้าทำ §3.4 แล้วเหลือแก้ `app_settings` แถวเดียว)
   + **redeploy edge 6 ไฟล์ที่ฝัง URL** พร้อมตั้ง secret `MAIN_FUNCTIONS_URL` (§3.3)
6. ตั้ง Telegram webhook ใหม่ให้ชี้ server ใหม่
7. Build frontend ด้วย **env ครบ 4 ตัว** → ตรวจว่า **ป้ายเตือนแดงไม่ขึ้นบนจอ admin**
8. ตรวจ: login ได้ · เปิดกะได้ · บันทึก downtime แล้ว Telegram เข้า · PM scan ทำงาน · รูปขึ้น
9. ตัด DNS/ทางเข้าไปตัวใหม่ · **เก็บ cloud เดิมไว้ read-only อย่างน้อย 1 เดือน** (จุด rollback)

### 4.3 ตรวจก่อนบอกว่า "ย้ายเสร็จ"

**ขั้น A — ตอน cutover (LEGACY_DR_* ยังอยู่ในโค้ด):**
```bash
# 1. URL ของ MAIN ต้องหายจากบันเดิล 100%
grep -c "ewhdfqwfwofivojtsizn" dist/assets/*.js          # ต้องได้ 0 ทุกไฟล์
# 2. URL ใหม่ต้องปรากฏ (พิสูจน์ว่า env เข้าจริง ไม่ได้ตกไป fallback)
grep -l "<โดเมน server ใหม่>" dist/assets/*.js           # ต้องเจออย่างน้อย supabaseClient-*.js
# 3. ซอร์ส edge ต้องไม่เหลือ URL ฝัง (เฟส 2 §3.3)
grep -rn "supabase\.co" supabase/functions/             # ต้องได้ 0
```
> ⚠️ **ห้ามใช้ `eyhclzkifitbhbljgoav` เป็นเกณฑ์ในขั้นนี้** — `LEGACY_DR_URL/KEY` เป็นฝั่งขวาของ `||`
> จึงยังติดอยู่ในบันเดิลเสมอ (tree-shake ไม่ออก) ทั้งที่ตั้ง env ถูกแล้ว · **ตัวชี้วัดจริงของขั้นนี้คือ
> ป้ายเตือนแดงไม่ขึ้นบนจอ admin** = แอปอ่าน env ครบ ไม่ได้ใช้ fallback

```sql
-- ทั้ง 2 project ต้องได้ 0 แถว
select jobname from cron.job where command ~ 'supabase\.co';
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosrc like '%supabase.co%';
```

**ขั้น B — หลังถอด `LEGACY_DR_URL/KEY` ออกจาก `appConfig.js` (§2):**
```bash
grep -c "ewhdfqwfwofivojtsizn\|eyhclzkifitbhbljgoav" dist/assets/*.js   # ตอนนี้ถึงจะต้องได้ 0 ทุกไฟล์
```

---

## 5. ⬜ ยังไม่ทำ (เฟสถัดไป — จงใจ ไม่ใช่ลืม)

- **ปิดช่องโหว่ `supabaseDR` = anon เสมอ** (known gap เดิมใน CLAUDE.md) — ตอนนี้ใครถือ DR anon key
  ก็อ่าน/แก้/ลบข้อมูลผลิตทั้งโรงงานได้โดยไม่ต้อง login · ย้ายมา server ภายในช่วยลดความเสี่ยงระดับเครือข่าย
  แต่**ไม่ได้แก้ต้นเหตุ** — ต้องผ่าน Edge Function ที่ validate ฝั่ง server
- ถอด `LEGACY_DR_URL/KEY` ออกจาก `appConfig.js` (ดู §2)
- คู่มือ backup/restore + upgrade ของ self-host instance สำหรับไอที
