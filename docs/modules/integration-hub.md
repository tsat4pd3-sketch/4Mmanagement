# 🔌 ศูนย์เชื่อมต่อ Node-RED / เครื่องจักร — `/integrations`

> 2026-11-11 · คำสั่ง user: *"อัพเกรดหน้าการเชื่อมต่อ mqtt ย้ายไปในหมวด setting และใช้ได้กับทุกข้อมูลที่เชื่อมต่อกับ node-red ได้"*
> รูปตัวอย่างที่ user OK (artifact) = 3 จอ: ① รายการต้นทาง ② หน้าต้นทาง ③ เพิ่มการเชื่อมต่อ 4 ขั้น
> **เฟส 1 (ทำแล้ว):** ทะเบียนต้นทาง + รหัสลับต่อต้นทาง + จอ ①② + gen flow + ย้ายค่าไฟ Die Shop เข้ามาเป็นตัวแรก
> **เฟส 2 (11/11 · "เริ่ม OEE Line D3"):** ชนิด `machine_state` / `piece_count` ใช้งานได้ + แผง "ข้อมูลจากเครื่อง" (ดู §OEE Line D3)
> **ยังไม่ทำ:** จอ ③ แบบ wizard เต็ม (ตอนนี้เป็น modal เพิ่มต้นทาง + ปุ่มดาวน์โหลด flow)

## สายข้อมูล

```
Node-RED (ต้นทาง) ──POST /functions/v1/ingest-energy──▶ ESM (DR)
   header x-source-key = รหัสของต้นทาง   (หรือ x-ingest-secret = secret กลาง สำหรับต้นทาง legacy)
   body { readings | events | daily | limits | states | pieces }  ← ชนิดข้อมูลตาม src/utils/integrationKinds.js
          │
          ├─ เขียนตารางของโมดูลนั้น (energy_live / energy_readings / energy_events / energy_daily / energy_live_meters
          │                          / machine_state_events / machine_counters)
          └─ fn_integration_tick() → integration_sources.last_* + integration_hourly (นับรายชั่วโมง เก็บ 30 วัน)
```

## กฎ (ห้ามหลุด)

0. **ที่เดียว** — ผูก topic ค่าไฟ / ต้นทาง / รหัสลับ ทำที่ `/integrations` เท่านั้น · แท็บ "มิเตอร์ / MQTT" ใน `/energy` **ถอดแล้ว 11/11**
   (user: *"ย้ายละก็ให้มันมีที่เดียว"*) · `/energy?tab=mqtt` เก่า = ส่งต่อมาที่นี่ · **ห้ามเอาแท็บกลับไปที่ /energy**
   ⇒ คนที่ต้องผูก topic ต้องได้สิทธิ์ `page:/integrations` (ผูกได้ = `energy:record` · จัดการต้นทาง = `integration:manage`)

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
| `supabase/functions/ingest-energy` (**v7 deploy 11/11**) | `identify()` ระบุต้นทาง · พัก 423 · `tick` ทุกครั้ง · `states`/`pieces` |
| `supabase/functions/integration-admin` (**v2 deploy 11/11** · verify_jwt=true) | create / rotate / update / pause / resume / legacy_off / map_tag / map_reason |
| `supabase/migrations/20261111c_machine_facts_dr.sql` (DR · **apply แล้ว**) | `machine_tag_map` · `machine_state_events` · `machine_counters` |
| `supabase/migrations/20261111d_machine_reason_map_dr.sql` (DR · **apply แล้ว**) | `machine_reason_map` (เหตุผลต้นทาง → `dr_downtime_types`) |
| `supabase/migrations/20261111e_machine_counter_hourly_dr.sql` (DR · **apply แล้ว**) | rpc `fn_machine_counter_hourly` (รวมรายชั่วโมง · ไม่คิด KPI) |
| `src/utils/machineFacts.js` | จัดถังกะ ESM · `compareWithSessions` · รายการจับคู่ + ข้อเสนอ (ตรงเป๊ะเท่านั้น) |
| `src/components/MachineFactsPanel.jsx` | แผงในหน้าต้นทาง: ① ผูกเครื่อง ② จับคู่เหตุผล ③ เทียบ Daily Report |
| `src/utils/integrationKinds.js` | ทะเบียนชนิด · `sourceStatus()` · `healthBars()` |
| `src/utils/nodeRedFlow.js` | `buildNodeRedFlow()` — แม่แบบ = flow ที่รันจริงที่ Die Shop (schema TSS Smart Energy) |
| `src/pages/Integrations.jsx` | จอ `?tab=sources|kinds` · หน้าต้นทาง `?src=<code>` |
| `src/utils/energy.js` `energyPointOptions()` / `energyZonesFrom()` | จุดที่ผูก topic ได้ — ใช้ร่วม `/energy` + `/integrations` |

## ตรวจแล้ว (11/11)
- anon: อ่าน `key_hash` ไม่ได้ · insert/update ไม่ได้ · เรียก `fn_integration_tick` ไม่ได้
- `integration-admin`: ไม่มี token → 401 · token ปลอม → 401 · ไม่มีแถว "hack" ถูกสร้าง
- `ingest-energy`: `x-source-key` ผิด → 401 · Die Shop (secret กลาง) ยังเข้าปกติ + นับลง `integration_hourly`

## งานค้าง
- `EnergyMqttTopics` ยังโชว์ topic ของทุกต้นทางรวมกัน (มีต้นทางค่าไฟตัวเดียวตอนนี้) — แยกตามต้นทางเมื่อมีตัวที่ 2
- เหตุผลของสถานะ COMM_LOSS ยังไม่รู้ว่าต้นทางใช้ master ไหน — ถาม user ก่อนเปิดให้จับคู่ (IDLE = UnplanMaster · user ยืนยัน 11/11)

## 🏭 OEE Line D3 — ข้อมูลจากเครื่อง เฟสเดินคู่ (11/11)

ต้นทาง = Node-RED PD2 (MySQL `db_user02`) · เครื่อง JTSRA03-03 / JTSRA03-04 = **Line D3 - STAMPED** (user ยืนยัน)

**กฎ:**
1. **ส่งข้อเท็จจริงเท่านั้น** — ช่วงหยุด (`oee_stop`) + ชิ้นต่อนาที (`oee_piece`) · **ไม่รับ `oee_shift` / เลข OEE ของต้นทาง** (มีเทสใน `integrationHub.test.mjs`)
2. **เฟสเดินคู่: ห้ามเอาเข้าสูตร OEE · ห้ามเขียน `downtime_logs`** — จอแค่วางข้างที่คนลง
3. **เวลา:** SQL ใน flow ใช้ `DATE_FORMAT` เป็นสตริงไทย (ไม่ปล่อย Date ของ mysql node) → edge `bkk()` ต่อ +07:00
4. **ชิ้นที่อ่านยอดไม่ออก = ทิ้ง ห้ามบีบเป็น 0** · นาทีที่ไม่มีแถว = "ไม่รู้" ไม่ใช่ 0 · ส่งซ้ำ = ทับ (ต้นทางส่งยอดเต็มนาที)
5. **เก็บรหัสเครื่องของต้นทาง (`machine_tag`) ผูกกับ `machines.id` ตอนอ่าน** — แก้การผูกแล้วข้อมูลย้อนหลังตามเอง
6. **เหตุผล:** `PLANNED_STOP`/`NO_PLAN` → OnplanMaster · `FAULT`/`IDLE` → UnplanMaster (user ยืนยัน 11/11) ·
   รหัสเลขเดียวกันคนละ master ⇒ คีย์ = `(reason_kind, reason_code)` · `COMM_LOSS` = ไม่รู้ ⇒ ไม่ส่งชื่อ ไม่ให้จับคู่ (`reasonKindOf()`)
6.1 **รหัสเหตุผล 0 = "ปกติ / ไม่ได้กดเหตุผล"** (พนักงานรีเซ็ตแล้วกลับเป็น 0 · user ยืนยัน 13/11) — ไม่ใช่เหตุผลหยุด
   ⇒ ไม่อยู่ในรายการจับคู่ · จอนับแยกว่ากี่ช่วง/กี่นาที (`NO_REASON_CODE` · `reasonRows().noReason`)
7. **จับคู่ = คนกดเท่านั้น** (edge `map_tag`/`map_reason` · สิทธิ์ `integration:manage`) — ระบบเสนอเฉพาะตัวตรงเป๊ะ
   (เครื่อง: `machineKey` ตรงตัวเดียว · เหตุผล: ชื่อตรงตัวเดียว) · `downtime_type_id = null` = "ตรวจแล้ว ไม่มีตัวตรง"
8. **ไม่รวมชิ้นข้ามเครื่องเป็นยอดไลน์** (ไม่รู้ว่าเครื่องต่อกันเป็นสายหรือขนาน) — ตารางเทียบโชว์รายเครื่อง
9. **กะ = กรอบ ESM** (เช้า 08–20 · ดึก 20–08 · วันทำงานตัด 08:00) คิดจาก UTC+7 ตรงๆ ไม่พึ่ง TZ เครื่อง · ช่วงหยุดคร่อมกะถูกตัดตามเวลาจริง
10. **ชิ้นดึงผ่าน rpc รายชั่วโมง** (รายนาที 7 วัน ≈ 20,000 แถว = ชนเพดาน 1000 + egress) · RPC แค่ SUM ไม่คิดอัตรา

**ตรวจแล้ว (11/11):** POST ทดสอบด้วยต้นทางชั่วคราว (ลบแล้ว) → `states 2 · pieces 1` (แถว qty ว่างถูกทิ้ง) · เวลา 19:50 ไทย → 12:50Z ·
นับลง `integration_hourly` · Die Shop ยังเข้าปกติหลัง deploy v7 · anon insert `machine_reason_map` = false

**ขั้นที่ user ต้องทำ:** สร้างต้นทาง (เช่น `pd2-oee` ชนิด สถานะเครื่อง + นับชิ้น) ที่ `/integrations` → เก็บรหัส →
ตั้ง env `ESM_SOURCE_KEY` ใน Node-RED PD2 → import flow → เลือก DB `db_user02` ในโหนด mysql 2 ตัว → Deploy → กลับมาผูกเครื่อง/จับคู่เหตุผล

## ⚠️ เครื่องช่วยเติม downtime — "ทางที่ 2" (13/11 · user เลือก)

user เลือกจาก 4 ทาง: ① เทียบอย่างเดียว ② **เครื่องช่วยเติม downtime** ③ OEE รายจิ๊กจากเครื่องล้วน ④ OEE ทั้งไลน์จากเครื่อง
· เกณฑ์ที่ user กำหนด: **FAULT เท่านั้น · นานกว่า 5 นาที** (`FAULT_GAP_MIN` / `FAULT_GAP_STATES` ใน `machineFacts.js`)
· ที่มา: D3 ไม่มีการลง downtime เลย 60 วัน ⇒ %A ที่ stamp = 100% ทุกกะ ทั้งที่เครื่องรายงานหยุด

**กฎ:**
1. **เสนอเท่านั้น ห้ามบันทึกเอง** — ปุ่ม "ลงจากช่วงนี้" เติมฟอร์ม downtime เดิม (เครื่อง · เวลาเริ่ม/จบ · ประเภทที่จับคู่ไว้) คนเลือกสาเหตุ+กดบันทึก
2. **ผูกพาร์ท↔เครื่อง = `prod_orders.machine_no` ที่เลือกตอนเปิดใบ** (ไลน์ assembly/standalone เลือกอยู่แล้ว · D3 189/189 ใบ)
   ⇒ เตือนเฉพาะจิ๊กที่มีใบในกะนั้น · **ไม่ต้องมีทะเบียนพาร์ท↔เครื่องเพิ่ม**
   · 1 จิ๊ก/เซลล์ = โรบอท+จิ๊ก+สเตชันนารี+เครื่องมาร์ค ทำงานร่วมกันผลิตพาร์ทเดียว ⇒ รหัสใน Node-RED = รหัสเซลล์ในใบ
   · งานเดียวกันทำได้หลายจิ๊ก (เช่น 20059450 ทำทั้ง 03-01 และ 03-03) ⇒ ห้ามจับคู่ด้วย MAT
3. **"ลงแล้ว"** = downtime ของเครื่องเดียวกัน (`machineKey`) หรือระดับไลน์ (ไม่ระบุเครื่อง) ที่ทับเวลาแม้บางส่วน
4. รหัสเหตุผล 0 = ไม่ได้กด ⇒ ไม่เสนอประเภท · รหัสอื่นที่จับคู่ไว้ (Unplan) ⇒ เลือกประเภทให้ก่อน แก้ได้
5. **แสดงแม้การ์ด Downtime หุบอยู่** (ไลน์ที่ไม่เคยลง DT การ์ดหุบเอง) · ไลน์ที่ไม่มีจิ๊กต่อ Node-RED = ไม่วาดอะไรเลย
6. OEE ยังคิดจากข้อมูลใน ESM เหมือนเดิม — ทางนี้แค่ทำให้ downtime ที่คนลงครบขึ้น

| ไฟล์ | หน้าที่ |
|---|---|
| `src/utils/machineFacts.js` `faultGaps()` | กฎตัดสิน (pure · มีเทส) |
| `src/components/MachineFaultGaps.jsx` | แถบเตือนใน Daily Report การ์ด Downtime |
