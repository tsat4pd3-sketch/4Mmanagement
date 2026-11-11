# 🔌 ศูนย์เชื่อมต่อ Node-RED / เครื่องจักร — `/integrations`

> 2026-11-11 · คำสั่ง user: *"อัพเกรดหน้าการเชื่อมต่อ mqtt ย้ายไปในหมวด setting และใช้ได้กับทุกข้อมูลที่เชื่อมต่อกับ node-red ได้"*
> รูปตัวอย่างที่ user OK (artifact) = 3 จอ: ① รายการต้นทาง ② หน้าต้นทาง ③ เพิ่มการเชื่อมต่อ 4 ขั้น
> **เฟส 1 (ทำแล้ว):** ทะเบียนต้นทาง + รหัสลับต่อต้นทาง + จอ ①② + gen flow + ย้ายค่าไฟ Die Shop เข้ามาเป็นตัวแรก
> **ยังไม่ทำ:** จอ ③ แบบ wizard เต็ม (ตอนนี้เป็น modal เพิ่มต้นทาง + ปุ่มดาวน์โหลด flow) · ชนิด `machine_state` / `piece_count` (OEE Line D3 — รอเฟสถัดไป)

## สายข้อมูล

```
Node-RED (ต้นทาง) ──POST /functions/v1/ingest-energy──▶ ESM (DR)
   header x-source-key = รหัสของต้นทาง   (หรือ x-ingest-secret = secret กลาง สำหรับต้นทาง legacy)
   body { readings | events | daily | limits }  ← ชนิดข้อมูลตาม src/utils/integrationKinds.js
          │
          ├─ เขียนตารางของโมดูลนั้น (energy_live / energy_readings / energy_events / energy_daily / energy_live_meters)
          └─ fn_integration_tick() → integration_sources.last_* + integration_hourly (นับรายชั่วโมง เก็บ 30 วัน)
```

## กฎ (ห้ามหลุด)

1. **ต้นทางส่ง "ข้อเท็จจริง" · ESM เป็นเจ้าของสูตร** — ทะเบียนชนิดข้อมูลไม่มี "เลข OEE ของต้นทาง" โดยตั้งใจ
   (`docs/SCADA_REALTIME_DESIGN.md` §1 · มีเทสกัน)
2. **ทะเบียนชนิดข้อมูลมีที่เดียว = `src/utils/integrationKinds.js`** · edge `integration-admin` มีรายชื่อซ้ำ
   (edge import จาก `src/` ไม่ได้) ⇒ **เพิ่มชนิดใหม่ต้องแก้ 2 ที่ + deploy edge** — เทส `integrationHub.test.mjs` จับถ้าไม่ตรง
3. **ชนิด `planned` = ESM ยังไม่มีปลายทางรับ** ⇒ ฟอร์มติ๊กไม่ได้ · ตัว gen flow ไม่สร้างโหนดแต่คืน `skipped` ให้จอเขียนบอก
4. **รหัสลับ:** สร้างฝั่ง server (edge) · เก็บแค่ `sha256` (`key_hash`) + 4 ตัวท้าย (`key_hint`) ·
   **anon อ่าน `key_hash` ไม่ได้** (grant รายคอลัมน์ ⇒ `select('*')` บนตารางนี้จาก client = error — เลือกคอลัมน์เสมอ) ·
   แสดงครั้งเดียวหลังสร้าง/เปลี่ยน · **ไม่ใส่ในไฟล์ flow** (โหนดอ่าน `env.get('ESM_SOURCE_KEY')`)
5. **ตาราง `integration_*` client เขียนไม่ได้เลย** (ไม่มี grant insert/update/delete) — สร้าง/เปลี่ยนรหัส/พัก ผ่าน
   edge `integration-admin` (ตรวจ token ล็อกอินของ Main + `has_perm('integration:manage')` แบบ `demand-mail-file`)
   ⇒ ถือ anon key อย่างเดียว (ฝังในบันเดิลเว็บ) สร้างต้นทางปลอม/ยิงข้อมูลปลอมไม่ได้
6. **ต้นทาง legacy** (`legacy_secret=true`) รับ `INGEST_SECRET` กลางได้ — Node-RED เดิมไม่ต้องแก้ ·
   ย้ายไปใช้รหัสของตัวเอง: ออกรหัส → ตั้ง `ESM_SOURCE_KEY` + import flow ใหม่ → ดูแถบเขียว → กด "เลิกใช้รหัสกลาง"
   (edge ไม่ยอมให้เลิกถ้ายังไม่เคยออกรหัส — กันข้อมูลหยุดเข้าทันที)
7. **พักการรับ = 423** ไม่เขียนข้อมูล แต่ยังนับเป็นครั้งที่ล้ม (เห็นว่าต้นทางยังยิงอยู่)
8. **นับไม่ได้ ≠ รับไม่ได้** — `fn_integration_tick` ล้ม ingest ยังสำเร็จ (log ใน edge)
9. **สถานะต้นทาง** = `sourceStatus()` — ไม่เคยได้รับ ≠ ขาดการติดต่อ (เกิน `SOURCE_STALE_MIN` 3 นาที) ≠ พัก
10. **ไฟล์ flow = ค่าตั้งเครื่อง ไม่ใช่เอกสาร** ⇒ ไม่ลงทะเบียน `/doc-forms`

## ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `supabase/migrations/20261111_integration_hub_dr.sql` (DR · **apply แล้ว 11/11**) | `integration_sources` · `integration_hourly` · `fn_integration_tick` · seed `dieshop` (legacy) |
| `supabase/migrations/20261111b_integration_hub_perm_main.sql` (Main · **apply แล้ว 11/11**) | `permission_catalog` `integration:manage` (sort 919 · ค่าเริ่มต้น admin) |
| `supabase/functions/ingest-energy` (**v6 deploy 11/11**) | `identify()` ระบุต้นทาง · พัก 423 · `tick` ทุกครั้ง |
| `supabase/functions/integration-admin` (**v1 deploy 11/11** · verify_jwt=true) | create / rotate / update / pause / resume / legacy_off |
| `src/utils/integrationKinds.js` | ทะเบียนชนิด · `sourceStatus()` · `healthBars()` |
| `src/utils/nodeRedFlow.js` | `buildNodeRedFlow()` — แม่แบบ = flow ที่รันจริงที่ Die Shop (schema TSS Smart Energy) |
| `src/pages/Integrations.jsx` | จอ `?tab=sources|kinds` · หน้าต้นทาง `?src=<code>` |
| `src/utils/energy.js` `energyPointOptions()` / `energyZonesFrom()` | จุดที่ผูก topic ได้ — ใช้ร่วม `/energy` + `/integrations` |

## ตรวจแล้ว (11/11)
- anon: อ่าน `key_hash` ไม่ได้ · insert/update ไม่ได้ · เรียก `fn_integration_tick` ไม่ได้
- `integration-admin`: ไม่มี token → 401 · token ปลอม → 401 · ไม่มีแถว "hack" ถูกสร้าง
- `ingest-energy`: `x-source-key` ผิด → 401 · Die Shop (secret กลาง) ยังเข้าปกติ + นับลง `integration_hourly`

## งานค้าง
- แท็บ "มิเตอร์ / MQTT" ใน `/energy` ยังอยู่ (ชี้มาหน้านี้) — ถอดได้เมื่อแจกสิทธิ์ `page:/integrations` ให้คนที่ผูก topic แล้ว
- `EnergyMqttTopics` ยังโชว์ topic ของทุกต้นทางรวมกัน (มีต้นทางค่าไฟตัวเดียวตอนนี้) — แยกตามต้นทางเมื่อมีตัวที่ 2
- OEE Line D3 (Node-RED PD2 · `db_user02` · JTSRA03-03/04): ชนิด `machine_state`/`piece_count` + ปลายทางรับ + จอเทียบกับ Daily Report
