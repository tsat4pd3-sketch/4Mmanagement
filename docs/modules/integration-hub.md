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
2. **ทะเบียนชนิดข้อมูล = ตาราง `integration_kinds` (DR) · แก้ผ่าน modal ในแท็บชนิดข้อมูล** (27/11 · เดิม hardcode)
   · ชนิดในตัว (`is_builtin`) = ปลายทางในโค้ด `src/utils/integrationKinds.js` — DB แก้ได้แค่ชื่อ/ไอคอน/คำอธิบาย · ห้ามลบ ·
   เพิ่มชนิดในตัวใหม่ = เติมในโค้ด **+ seed แถว is_builtin** (เทส `integrationHub.test.mjs` เทียบกับ migration)
   · รวมโค้ด+DB ผ่าน `mergeKinds()` เท่านั้น · edge `integration-admin` อ่านตารางเดียวกัน (ห้าม hardcode รายชื่อในเอดจ์ — มีเทส)
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
| `supabase/functions/ingest-energy` (**v8 deploy 13/11**) | `identify()` ระบุต้นทาง · พัก 423 · `tick` ทุกครั้ง · `states`/`pieces` |
| `supabase/functions/integration-admin` (**v3 deploy 13/11** · verify_jwt=true) | create / rotate / update / pause / resume / legacy_off / map_tag / map_reason |
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
6. **เหตุผล:** `PLANNED_STOP`/`NO_PLAN` → OnplanMaster · **`FAULT` → AlarmMaster** (แก้ 13/11 — หลักฐาน: รหัส 15 จอ Node-RED = "Robot Water Flow Error" แต่เดิม join UnplanMaster ได้ "รอชิ้นงานจาก Store") · `UNPLANNED`/`IDLE` → UnplanMaster ·
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

## 🏭 OEE รายจิ๊ก/เครื่อง จากข้อมูลเครื่อง (13/11 · คำสั่ง user "ทำให้หมด ให้ ESM เหนือกว่า Node-RED")

**จอ:** `/line-oee` แถวการ์ดรายจิ๊ก (`LineJigCards` · เฉพาะไลน์ที่ผูก Node-RED) · `/oee-analytics?tab=machine`
(`?mview=shift` ภาพรวมกะ + ดูลึก `?jig=` · `?mview=report` รายงานช่วงวัน + Pareto + Loss + เทียบเครื่อง + รายกะ + CSV `csv_jig_oee_shift`)

**กฎ (ห้ามหลุด):**
1. **สูตรอยู่ `src/utils/machineOee.js` ที่เดียว** (pure · มีเทส) · โหลด/ประกอบ `src/lib/jigOeeData.js` · วาด `src/components/JigOee.jsx` — ห้ามคิดในหน้า
2. **เป็น OEE "รายจิ๊ก" แยกจาก OEE ไลน์ที่ประทับตอนปิดกะ** (`oee.js`) — ห้ามเอาไปทับ/เฉลี่ยรวม · จอเขียนกำกับเสมอ
3. นิยามเวลา: แผน = กรอบกะที่ผ่านไป − ไม่มีแผน − หยุดตามแผน − ขาดการสื่อสาร (กันออก+บอก) ·
   เสีย A = Alarm + หยุดนอกแผน + Idle ที่**ไม่ใช่**หยุดสั้น · หยุดสั้นของ Alarm/หยุดนอกแผน = เสีย P ·
   **Idle สั้น = จังหวะโหลดงาน นับเป็นเวลาเดิน** (ตรงจอ Node-RED: Idle≥2 นาที 33 น. = ของเรา 33.4 น.)
4. **P = ชิ้นทั้งหมด (`qty` รวม NG — user ยืนยัน) × CT ของ MAT ในใบบนจิ๊ก ÷ เวลาเดิน** · ไม่มีใบ/ไม่มี CT = `null` + เหตุผล
   (**ห้ามใช้ ideal ของต้นทาง**) · หลาย MAT CT ต่างกัน = ถ่วงยอดที่ยืนยัน + บอก · P > 100% = ตัด + ชูธง `pOver`
5. **Q = NG ที่คนตัดสิน** (`defectQty` ของ defect_logs ผ่าน `prod_order_id` ของใบบนจิ๊ก) · NG หน้าเครื่อง = โชว์คู่ ไม่ใช้คิด
6. รวมหลายกะ/จิ๊ก = **ถ่วงเวลา** (`combineJigRows`) ห้ามเฉลี่ย % · ย้อนหลังใช้ rpc `fn_machine_shift_facts` (แค่รวมวินาที)
7. MTTR/MTBF จาก Alarm ของเครื่อง (คนละแหล่งกับ `/mtn-analysis` ที่คิดจากใบแจ้งซ่อม)
8. เทียบจอ Node-RED 13/11 JTSRA03-04: A 85.4 vs 85.3 · P 95.5 vs 95.8 (ต่างแค่ปัดนาที) — เทสล็อกไว้

**จอดูลึก (16/11 · คำสั่ง user "ทำ ก ข ค" หลังเห็นจอ Node-RED ใหม่):**
- ก. **ยอดรายชั่วโมง + นาทีรายสถานะของชั่วโมงเดียวกัน** — 2 กราฟซ้อนแกน X เดียว (UI §6.19 · ล็อก `YAxis width` ด้วย `alignedYWidth` · `syncId`) · สูตร `hourlyStateMinutes()`
- ข. **ทั้งวัน `?sh=all`** = กรอบ 08:00→08:00 วันถัดไป (`shiftBounds(wd,'all')`) คิด OEE เป็นกรอบเดียว · พักนโยบาย = พักกะเช้า + พักกะดึก (`jigBreaks()` แต่ละกะใช้เวลาเลิกของใบกะนั้น) · การ์ด ชิ้นดี/เป้า/ทำได้%/เฉลี่ยต่อชม. จาก `hourlySummary()` (ไม่รู้ CT = `–` ห้าม 0) · `/line-oee` ยังเป็นรายกะ
- ค. **รายงาน: ยอดรายวัน vs ชิ้นที่ควรทำได้** (`dailyCapacityRows()` · เทา = ยังขาด · มีกะไม่รู้ CT = ไม่วาดเทา) · tooltip = เวลารายสถานะจากสูตร OEE เดียวกัน · คลิกวัน = ไปมุมมองทั้งวัน (`?wd=&sh=all&jig=`)
  · ตั้งใจ**ไม่ปัดเป็น "ช่องละ 50 ชิ้น"** แบบจอ Node-RED — วันยอดน้อยจะเหลือ 0–1 ช่องจนอ่านไม่ได้
- 🔎 **กดแท่ง Pareto ⇒ รายครั้ง + ผูก ESM** (16/11 · `StopDrillPanel`) — ทั้งดูลึกรายกะและรายงาน · รายครั้งคัดด้วย `stopKeyOf()` ตัวเดียวกับแท่ง (กดแล้วจำนวนต้องเท่าแท่ง · มีเทส)
  · ผูกที่ `linkStops()`: MAT = ใบบนจิ๊กที่เปิดอยู่ตอนเกิด (ไม่มี ⇒ ใบในกะ + บอก) · DT = เครื่องเดียวกันทับช่วง ±10 นาที · MO = เปิดจาก DT นั้น (`source_downtime_id`) หรือเครื่องเดียวกันเวลาตรง (ป้าย "เวลาตรงกัน")
  · โหลด `loadStopLinks()` ตอนกดเท่านั้น (DT ผ่าน `session_id` ของใบ ไม่เดาจากชื่อไลน์) · ไม่รู้เครื่อง = ไม่ผูก · อ่านไม่ได้ = เขียนบอก · หยุดสั้นในรายงาน/พักเกิน = ไม่มีรายครั้ง (บอกบนจอ)
  · ตัวกดเห็นแค่ระดับ AlarmMaster (21 รหัส) — รายละเอียดในตัวหุ่นยนต์ต้องรอดูว่า `db_user02` เก็บเลข Alarm ย่อยไหม (ยังไม่รู้ · ห้ามเดา)
- แถบสถานะซูมได้ (`ZoomStateStrip`): ลากเลือกช่วง · คลิก = ±15 นาที · ป้ายนาทีรายสถานะของช่วงที่ซูม (`segmentMinutesIn`)

**ที่ ESM เหนือกว่า:** CT รายพาร์ทจากใบจริง · Q จาก QA · ชิ้นเครื่อง vs ยืนยัน vs แผน ต่อจิ๊ก · เหตุผลที่คิดไม่ได้เขียนบนจอ ·
เตือนเครื่องเสียที่ยังไม่ลง downtime (ทางที่ 2) · ผูกกับใบผลิต/QA/ซ่อมของ ESM

## 🟢 สถานะสด `machine_live` (13/11)
- `oee_stop` ส่งได้แค่ช่วงหยุดที่จบแล้ว ⇒ ชนิดใหม่ `machine_live` อ่าน `MachineStatus` + `View_MachineState_Duration` (since)
- ตาราง `machine_live_state` (1 แถว/เครื่อง ทับทุกนาที · migration `20261113d`) · edge ingest-energy **v8** รับ `body.live`
- 🔴 **เก็บ/โชว์ข้อความตามต้นทาง ไม่แปลรหัส MCStateType เอง** (ยังไม่รู้ MCStateMaster) ⇒ ชิปสถานะสดไม่มีสี
- ส่งเกิน 3 นาที (`LIVE_STALE_MS`) = การ์ดถอยไป "สถานะล่าสุดที่รู้*" + เขียนว่าสถานะสดขาด

| ไฟล์ | หน้าที่ |
|---|---|
| `supabase/migrations/20261113_machine_facts_alarm_unplanned_dr.sql` (DR · apply แล้ว) | state `unplanned` · reason_kind `alarm` |
| `supabase/migrations/20261113b_machine_shift_facts_dr.sql` (DR · apply แล้ว) | rpc `fn_machine_shift_facts` (ตัดคร่อมกะ) |
| `supabase/migrations/20261113c_doc_forms_csv_jig_oee_main.sql` (Main · apply แล้ว) | ทะเบียน CSV `csv_jig_oee_shift` |
| `supabase/migrations/20261113d_machine_live_state_dr.sql` (DR · apply แล้ว) | `machine_live_state` |
| `src/utils/machineOee.js` · `src/lib/jigOeeData.js` | สูตร · โหลด |
| `src/components/JigOee.jsx` · `JigOeeAnalytics.jsx` · `LineJigCards.jsx` | การ์ด/ดูลึก/รายงาน · แท็บ · แถวบน /line-oee |

## 🍱 เวลาพัก + ⏱️ ยึดระยะเวลา (16/11 · คำสั่ง user · เลือกทาง A)
- **นาฬิกา PLC คลาด ~3–5 นาที** (วัด: received_at − ended_at ต่ำสุด 3.3–4 นาที ทั้งที่ส่งทุก 1 นาที) ⇒ user: *"อยากให้เน้นที่ duration"*
  - ช่วงหยุดใช้ `duration_sec` ของต้นทางก่อน `ended_at` (`evSpan()` · rpc `fn_machine_shift_facts` v2 ก็เช่นกัน)
  - ไม่จับคู่ช่วงหยุดกับนโยบายพักด้วยเวลานาฬิกา · เตือนเครื่องเสียใน Daily Report เผื่อ ±10 นาที (`CLOCK_SLACK_MS`)
- **เวลาพัก = นโยบาย ESM แบบ "โควตานาที"** (`breakIntervalsIn` ตามไลน์ของจิ๊ก · พักท้ายกะใช้เมื่อรู้เวลาเลิกกะ)
  - เหตุผล Onplan ที่ติดป้าย 🍱 "เวลาพัก (ESM คิดเอง)" (`machine_reason_map.is_break` · migration `20261116`) = การกดพักหน้าเครื่อง
  - กดพัก > โควตา ⇒ ส่วนเกิน = **เสีย A "พักเกินเวลานโยบาย"** (ขึ้นใน Loss + Pareto)
  - กดพัก < โควตา (พักแต่ไม่ได้กด เครื่องขึ้น Idle) ⇒ โควตาที่เหลือหักจาก Idle ≥ 2 นาทีก่อน — จอเขียนบอก
  - อ่านนโยบายไม่ได้ ⇒ ถอยไปใช้เวลาที่กดพักหน้าเครื่อง + เขียน `no_break_policy`
- ไฟล์: `supabase/migrations/20261116_machine_reason_is_break_dr.sql` (apply แล้ว) · `20261116b_machine_shift_facts_reason_dr.sql` (rpc + reason_code · ดูสถานะ apply ในคอมมิท)

## ✏️ แก้ชื่อ / หมายเหตุต้นทาง (23/11 · คำสั่ง user "ไม่อยากได้ Die Shop")
- ปุ่ม "✏️ แก้ชื่อ / หมายเหตุ" ข้างชื่อในหน้าต้นทาง (`SourceDetail` · สิทธิ์ `integration:manage` เดียวกับปุ่มอื่น) → edge `integration-admin` action `update` (มีอยู่แล้วตั้งแต่ v3)
- 🔴 **รหัส (`code`) แก้ไม่ได้** — อยู่ในชื่อ topic มิเตอร์ (`<code>/<ตู้>/kw`) และ Node-RED ตัวเดิมส่ง `x-source` = code ⇒ เปลี่ยน = ค่าหลุดจากตู้ทันที


## ⚡ ต้นทาง `hdf` (Node-RED HDF · Smart Energy TSAT-P4) — ผูก topic + ลงทะเบียนตู้ (23/11 · คำสั่ง user "ทำให้ที")
- ผูก `hdf/<ตู้>/{kw,kwh_total,v,a,pf}` → `zone/<ตู้>` 24 แถว (AC-08 ไม่ส่ง pf) · ค่ารายเฟส v1-3/a1-3 เข้าเองผ่าน topic พี่น้อง (ingest v9)
- ทะเบียนบอร์ด `energy_live_meters`: ตู้ `MDB (HDF)` — MDB-07 → Aircomp-HDF → AC-06 / AC-07 / AC-08 (ผังอ่านจากจอ Node-RED · แก้ `parent_name` ได้)
- 🔴 **MDB-06 ไม่ได้แตะ** — มีคนผูกไว้ก่อนแล้วกับโซน `Utility Hydrofroming` (ข้อมูลรายเดือนใช้โซนนั้น) · ยังไม่ขึ้นบอร์ดสด รอ user ตัดสิน

## 📘 คู่มือ (WI) — `/integrations?tab=guide` (23/11 · คำสั่ง user)
- `src/components/IntegrationGuide.jsx` · 6 ขั้น (สร้างต้นทาง → รหัสลับ → import flow → env + เลือกฐาน + Deploy → ตรวจสุขภาพ → ผูก topic/เครื่อง/เหตุผล) + ปัญหาที่เจอบ่อย
- 🔴 **เนื้อหาต้องตรงพฤติกรรมจริง** — แก้ flow (`nodeRedFlow.js`) / edge (`ingest-energy`, `integration-admin`) / หน้าต้นทาง แล้วต้องตามแก้ WI ในคอมมิทเดียวกัน
- แสดงอย่างเดียว ไม่ใช่เอกสาร export — ถ้าเพิ่มปุ่มพิมพ์ต้องลง `/doc-forms` ก่อน

## 📏 flow ค่าไฟ: ค่าล่าสุด + ค่าสูงสุดแยก (23/11 · คำสั่ง user)
- `buildNodeRedFlow` (energy_readings): kW = `power` ล่าสุด · A = (A+B+C)/3 ล่าสุด · แต่ละตัวแนบ `max` ของนาที (MAX power / MAX เฟสสูงสุด)
- ingest-energy v10 โชว์ `last` · เก็บ `max` ที่ `energy_readings.kw_max/a_max` · ต้นทางที่ไม่ส่ง max = พฤติกรรมเดิม
- ต้องให้หน้างาน **import flow ใหม่** ทุกต้นทางค่าไฟ (hdf · dieshop) ถึงจะเห็นค่าตรงจอ Node-RED · 📄 `docs/ENERGY_MONITORING_DESIGN.md`
- 🧹 **กดผูก topic แล้วรายการ "ยังไม่ได้ผูก" ลบเองทันที** (24/11 · คำสั่ง user) — trigger `trg_energy_topic_mapped_clear` บน `energy_meter_topics` (DR)
  ลบ topic ตัวนั้น + ค่ารายเฟส v1-v3/a1-a3 ของตู้เดียวกัน · ผูกแบบปิดใช้ (`is_active=false`) = ไม่ลบ · ครอบทุกทางที่ผูก (หน้าจอ/SQL)

## 🌡️ ชนิดข้อมูลแก้ได้ + เซนเซอร์ทั่วไป (27/11 · คำสั่ง user "เพิ่มชนิดไม่ควร hardcode ควรเป็น modal CRUD")
user เลือก: ① รับข้อมูลได้ทันที ② ชนิดในตัว 7 ตัวแก้ได้แค่ชื่อ/ไอคอน/คำอธิบาย ③ เก็บรายนาที 7 วัน + สรุปรายวัน
- DR migration `20261127_integration_kinds_sensors`: `integration_kinds` · `sensor_readings` (PK ต้นทาง×ชนิด×จุดวัด×นาที · 7 วัน)
  · `sensor_daily` (n/v_sum/v_min/v_max ต่อวันไทย · trigger `fn_sensor_daily_roll` · เก็บยาว) · RLS อ่านอย่างเดียว · เขียนผ่าน edge
- edge `integration-admin` v4: `kind_create` / `kind_update` (ชนิดในตัวส่ง unit/sort_order = 400) / `kind_delete`
  · 🔴 ลบได้เฉพาะชนิดเพิ่มเอง ที่ **ไม่มีต้นทางติ๊กอยู่ + ไม่มีข้อมูลเลย** (นับไม่ได้ = ห้ามลบ) · มีประวัติแล้ว = ลบไม่ได้ (ประวัติจะหาย)
  · ⚠️ ไฟล์ในรีโปมี `is_break` ของ `map_reason` (รอ user อนุมัติ deploy) — v4 ที่ deploy **ไม่มี** ส่วนนั้น (เหมือน v3)
- edge `ingest-energy` v12: body `sensors: [{ kind, point, value, at? }]` — ต้องมาจากต้นทางที่ลงทะเบียน · ชนิดไม่รู้จัก/ชนิดในตัว/ค่าอ่านไม่ออก
  = ข้าม + ตอบ `sensors_skipped` · นาทีซ้ำ = ข้าม (สรุปรายวันไม่บวกซ้ำ)
- จอ: แท็บชนิดข้อมูล = การ์ด + ✏️/ลบ + modal · ตาราง "ค่าล่าสุดของชนิดที่เพิ่มเอง" (15 นาที + ต่ำ/เฉลี่ย/สูงวันนี้) ·
  หน้าต้นทาง ✏️ แก้ชนิดข้อมูลของต้นทางได้แล้ว (ชนิดใหม่ต้องติ๊กที่ต้นทาง flow ถึงจะมี) · flow ของชนิดเพิ่มเอง = แม่แบบ
  inject → function (ต้นทางเติมค่าเอง — ESM ไม่รู้ว่าเซนเซอร์ต่อที่ไหน) → http
- ยังไม่มี: จอกราฟ/เกณฑ์เตือนของเซนเซอร์ (รอ user บอกว่าจะดูแบบไหน)
