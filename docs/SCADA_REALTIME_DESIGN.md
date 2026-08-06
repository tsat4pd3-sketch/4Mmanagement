# SCADA → ESM · ออกแบบรับข้อมูลเครื่องจักรแบบ realtime (เตรียมล่วงหน้า)

> สถานะ: **ออกแบบเผื่อไว้ ยังไม่ implement** — เขียน 2026-08-06 หลังดู dashboard ที่ maker เสนอ (OEE stamping จาก SCADA)
> เป้าหมาย: ให้ **ข้อเท็จจริงจากเครื่องจักรไหลเข้าเองแบบ realtime** พนักงานไม่ต้องกรอกยอด/เวลาหยุด
> ผู้อ่าน: session ถัดไปที่จะต่อ SCADA จริง — อ่านหัวข้อ "⚠️ 7 ปัญหาที่ต้องแก้ก่อนเขียนโค้ด" ให้จบก่อนลงมือ

---

## 1. หลักการที่ห้ามหลุด

> **SCADA = ข้อเท็จจริง (fact) · คน = เหตุผล (reason) · ESM = เจ้าของสูตร (truth)**

- เครื่องจักรบอกได้ว่า **"หยุดตอน 14:03:12 ถึง 14:21:40"** — บอกไม่ได้ว่า **"เพราะแม่พิมพ์ติด"**
- เอา SCADA มาแทน **การกรอกตัวเลข** (เวลา/จำนวน) ไม่ใช่แทน **การจัดประเภท** (สาเหตุ/ของเสีย)
- **ห้ามให้ SCADA คำนวณ OEE เอง** — กฎทั้งหมดอยู่ที่ `src/utils/oee.js` จุดเดียวตามกฎเหล็กเดิม
  มี OEE 2 ชุดในบริษัท = ประชุมเช้าเถียงกันว่าจะเชื่อจอไหน (เจ็บกว่าปัญหาเทคนิคทั้งหมดรวมกัน)

---

## 2. SCADA ตอบอะไรได้ / ไม่ได้

| ข้อมูล | SCADA ตอบได้เอง | หมายเหตุ |
|---|---|---|
| จำนวน stroke / SPM จริง | ✅ | แม่นกว่า `qty × CT` ที่พึ่ง CT master |
| เครื่องเดิน / หยุด / เวลาที่หยุด | ✅ | ระดับวินาที ไม่ต้องรอคนกด |
| เริ่ม-จบ เปลี่ยนแม่พิมพ์ | ✅ | ถ้ามี signal die change |
| Alarm code จากเครื่อง | ✅ | ใช้ **เดา**ประเภท downtime ได้ แต่ต้องให้คนยืนยัน |
| **สาเหตุที่หยุด** | ❌ | เครื่องไม่รู้ว่ารอวัตถุดิบ/รอคน/ประชุม |
| **ของดี vs ของเสีย** | ❌ | เพรสไม่รู้จัก NG — **Q ยังต้องมาจากคน/QA เสมอ** |
| **กำลังทำพาร์ทไหน** | ⚠️ | ต้องมี die ID (RFID/บาร์โค้ดบนแม่พิมพ์) ไม่งั้นต้องพึ่งการสแกนเปิดใบงานเหมือนเดิม |
| หยุดเพราะ "ไม่มีแผนผลิต" | ❌ | เครื่องหยุดเหมือนกันหมด — ต้องดูจาก `production_sessions` ว่ากะเปิดอยู่ไหม |

> **ผลที่ตามมา: "OEE realtime" ที่ได้จริงคือ A กับ P — Q ยังตามหลังจนกว่าจะมีคนลง NG**
> จอต้องบอกให้ชัด ห้ามโชว์ Q=100% ลอยๆ (เราเคยพลาดแบบนี้มาแล้วที่ FactoryMap ซึ่ง Q สด = 100% เสมอ)

---

## 3. สถาปัตยกรรม

```
เครื่องจักร (PLC)
   │  OPC-UA / Modbus
   ▼
SCADA / Historian ของ maker            ← เขาเก็บ raw tag ความถี่สูงไว้ฝั่งเขา (ไม่เอาเข้า Supabase)
   │
   ▼
Gateway (ของเรา — Node/Python เล็กๆ บนเครื่องในโรงงาน)
   │  • edge-detect: แปลง signal ต่อเนื่อง → "เหตุการณ์" (state เปลี่ยน / counter snapshot)
   │  • buffer ลง disk เมื่อเน็ตหลุด แล้ว replay
   │  • batch + gzip ทุก 10-30 วิ
   ▼  HTTPS POST + shared secret
Edge Function `ingest-machine-events` (DR project · verify_jwt=false)
   │  • dedup ด้วย source_event_id (idempotent — ยิงซ้ำได้ไม่พัง)
   │  • validate tag → machine_no ผ่าน machine_tag_map
   ▼
ตาราง machine_state_events / machine_counters (DR)
   │
   ▼
ตัวแปลงเป็นข้อมูลธุรกิจ (pg function หรือ edge cron)
   │  • ช่วงหยุด > threshold  → downtime_logs (source='scada', downtime_type_id=NULL รอคนระบุสาเหตุ)
   │  • stroke เพิ่ม          → prod_orders.qty_actual (+ log prod_order_qty_updates)
   ▼
`src/utils/oee.js` คำนวณเหมือนเดิมทุกประการ ← ไม่ต้องแก้สูตรเลย
```

**ทำไมต้องมี Gateway ไม่ยิงจาก SCADA ตรง:** SCADA ส่วนใหญ่ยิง HTTPS + auth เองไม่ได้ · และเราต้องการ buffer ตอนเน็ตหลุด (โรงงานเน็ตหลุดคือเรื่องปกติ ข้อมูลหายไม่ได้)

---

## 4. Schema ที่ต้องเพิ่ม (DR project)

```sql
-- จับคู่ tag ของ SCADA ↔ เครื่องของเรา (ห้ามใช้ machine_no เป็น key ตรงๆ — ชื่อเปลี่ยนได้)
create table machine_tag_map (
  id uuid primary key default gen_random_uuid(),
  source        text not null,           -- 'scada_pd2' ฯลฯ (เผื่อมีหลายระบบ)
  tag           text not null,           -- ชื่อ tag ฝั่ง SCADA
  machine_id    uuid references machines(id),   -- ★ ผูกด้วย id ไม่ใช่ machine_no
  signal_kind   text not null,           -- 'state' | 'counter' | 'die_change' | 'alarm'
  is_active     boolean default true,
  unique (source, tag)
);

-- เหตุการณ์เปลี่ยนสถานะ (เก็บเฉพาะ "ตอนเปลี่ยน" ไม่เก็บทุกวินาที)
create table machine_state_events (
  id uuid primary key default gen_random_uuid(),
  machine_id      uuid references machines(id),
  state           text not null,         -- 'run' | 'stop' | 'idle' | 'die_change' | 'alarm'
  started_at      timestamptz not null,  -- เวลาจากฝั่งเครื่อง
  ended_at        timestamptz,
  duration_sec    integer,
  alarm_code      text,
  source_event_id text not null,         -- ★ dedup key จาก gateway
  received_at     timestamptz default now(),  -- ★ เก็บคู่กับ started_at เสมอ (กันนาฬิกา 2 แหล่ง)
  unique (source_event_id)
);

-- snapshot ตัวนับ (stroke) — เก็บเป็นช่วง ไม่ใช่ทุกจังหวะปั๊ม
create table machine_counters (
  id uuid primary key default gen_random_uuid(),
  machine_id   uuid references machines(id),
  counted_at   timestamptz not null,
  stroke_total bigint not null,          -- ค่าสะสมดิบจาก PLC (ต้องทน counter reset — ดู §5.7)
  delta        integer,                  -- คำนวณตอน ingest
  source_event_id text unique
);
```

**เพิ่มคอลัมน์บนตารางเดิม (additive ทั้งหมด):**
```sql
alter table downtime_logs add column if not exists source text default 'manual';  -- 'manual' | 'scada'
alter table downtime_logs add column if not exists source_event_id text;          -- โยงกลับ event ต้นทาง
alter table prod_orders   add column if not exists qty_source text default 'manual';
```
> **ต้องมี `source` ตั้งแต่แถวแรก** — ไม่งั้นพอเดินคู่กัน (manual + scada) จะแยกไม่ออกว่าแถวไหนมาจากไหน แล้วสืบย้อนไม่ได้ตลอดกาล

---

## 5. ⚠️ 7 ปัญหาที่ต้องแก้ก่อนเขียนโค้ด

### 5.1 ปริมาณข้อมูลจะระเบิด DB (ข้อที่อันตรายที่สุด)

ข้อมูลจริงวันนี้: DR database = **36 MB / 500 MB** (free tier) · downtime ที่คนกรอก = **~92 แถว/วัน**

ถ้า auto-log ทุกการหยุดของเครื่อง 209 ตัว:

| สมมติฐาน | แถว/วัน | แถว/เดือน | เทียบของเดิม |
|---|---|---|---|
| 50 state change/เครื่อง/วัน | 10,450 | 313,500 | **×113** |
| 200 state change/เครื่อง/วัน | 41,800 | 1,254,000 | **×450** |

≈ 60-150 MB/เดือน → **free tier ตายใน 3-6 เดือน**

**ต้องออกแบบรับตั้งแต่แรก:**
- gateway **edge-detect ฝั่งโรงงาน** ห้ามส่ง sample ทุกวินาทีเข้ามา
- ตั้ง **threshold micro-stop** (ดู §5.2) — หยุดสั้นไม่สร้างแถว
- **retention:** `machine_state_events` เก็บ raw 90 วัน แล้ว rollup เป็นรายชั่วโมง/รายกะ ทิ้ง raw (pg_cron)
- raw ความละเอียดสูงให้อยู่ที่ **historian ของ maker** — เราเก็บแค่ที่ใช้คำนวณ
- ประเมิน Supabase Pro ($25/เดือน = DB 8GB) ไว้ในงบตั้งแต่ต้น

### 5.2 Micro-stop จะทำให้ %A พังและ DB บวม

เครื่องปั๊มหยุด 3-10 วินาที (ป้อนงาน/เซ็นเซอร์สะดุด) วันละเป็นพันครั้ง
ถ้านับเป็น downtime ทุกครั้ง → %A ตกฮวบทั้งที่ของออกปกติ + แถวท่วม DB

**กฎที่ต้องตั้ง (ตรงกับตำรา TPM และ `six_big_loss` ที่เรามีอยู่แล้ว):**

| ระยะเวลาหยุด | จัดเป็น | ลงตารางไหน |
|---|---|---|
| < ~3 นาที (ตั้งค่าได้ต่อไลน์) | **minor_stop** → กระทบ **P** (speed loss) | รวมยอดรายกะ ไม่สร้างแถว downtime |
| ≥ threshold | **breakdown/setup** → กระทบ **A** | สร้าง `downtime_logs` |

> เรามีคอลัมน์ `dr_downtime_types.six_big_loss` อยู่แล้ว (migration `20260805_lean_loss_classification.sql`) — ต่อยอดตรงนี้ได้เลย ไม่ต้องสร้างแนวคิดใหม่

### 5.3 stroke ≠ จำนวนชิ้น (งานคู่ LH/RH)

แม่พิมพ์คู่ปั๊ม 1 ครั้งได้ 2 ชิ้น (LH+RH) — เพรสนับได้แค่ stroke
เรามี `pair_mat_no` อยู่แล้วสำหรับจับคู่ แต่**ยังไม่มีที่เก็บ "1 stroke = กี่ชิ้น"**

**ต้องเพิ่ม:** `dr_products.pieces_per_stroke` (default 1) หรือผูกกับ die
แล้ว `qty = strokes × pieces_per_stroke` · ยอดรวมภาพใหญ่ยังใช้ `pairAwareTotal` ตามกฎเดิม (1 ปั๊ม = 1 คู่)

> ⚠️ ถ้าลืมข้อนี้ ยอดผลิตงานคู่จะ**ขาดไปครึ่งหนึ่ง**ทันที

### 5.4 stroke นี้เป็นของพาร์ทไหน — ยังต้องพึ่งคน (หรือ die ID)

เพรสนับ stroke อย่างเดียว ไม่รู้ว่ากำลังทำ MAT ไหน
→ **การสแกนเปิด/ปิดใบงาน (`prod_orders`) ยังต้องมีอยู่** จนกว่าจะติด die ID (RFID/บาร์โค้ดบนแม่พิมพ์)

**ลำดับความคุ้มในการลงทุน:**
1. รับ state + stroke (ได้ A, P อัตโนมัติ) ← คุ้มสุด ทำก่อน
2. die ID → รู้พาร์ทเอง (เลิกสแกนเปิดใบ)
3. vision/gauge → รู้ NG เอง (ได้ Q อัตโนมัติ) ← แพงสุด ทำหลังสุด

### 5.5 "เครื่องหยุด" ≠ "downtime" เสมอ

เครื่องหยุดตอนพักเที่ยง / ตอนไม่มีแผนผลิต / ตอนกะปิด — สัญญาณเหมือนกันหมด
**ตัวแปลงต้องเช็คบริบทก่อนสร้างแถว:**
- มี `production_sessions` เปิดอยู่ไหม (ไม่มี = ไม่ใช่ downtime)
- ตกในช่วง `break_policies` ไหม (ใช้ `policyBreakOverlapMin` จาก `src/utils/oee.js`)
- ตกในช่วง planned downtime ที่มีคนลงไว้แล้วไหม (กันซ้อน)

> **ห้าม auto-classify เป็น `category='planned'` เอง** — เราเพิ่งเจอปัญหาการติ๊ก planned ผิดจนต้องสร้าง "OEE จริง" มาจับ · ให้ SCADA สร้างแถวแบบ **ยังไม่ระบุประเภท** แล้วคนเลือกเอง

### 5.6 นาฬิกา 2 แหล่ง (เคยกัดมาแล้ว)

เรามี `trg_prod_orders_close_time_guard` เพราะ clock skew ระหว่าง client กับ server ทำให้ใบ "ปิดก่อนเปิด" 33 ใบ
gateway ในโรงงานจะเป็นนาฬิกาแหล่งที่ 3

**บังคับ:** gateway sync NTP · เก็บ `started_at` (จากเครื่อง) คู่กับ `received_at` (server) เสมอ · ตอน ingest ถ้า `|started_at − received_at|` เกิน N นาที = flag ไว้ อย่าเงียบ

### 5.7 Counter reset / เครื่องรีสตาร์ท

`stroke_total` จาก PLC จะ**วนกลับเป็น 0** ตอนรีเซ็ต/ไฟดับ/counter overflow
ถ้าคำนวณ `delta = new − old` ตรงๆ จะได้ค่าติดลบมหาศาล → ยอดผลิตพัง

**กฎ:** `delta < 0` → ถือว่า reset ใช้ `delta = new` (ไม่ใช่ผลต่าง) + log ไว้ตรวจ · และ **cap** ค่าที่มากผิดปกติ (เช่น > กำลังผลิตทฤษฎีของช่วงเวลานั้น) ไม่ให้เขียนเข้ายอดเงียบๆ

---

## 6. แผนเปลี่ยนผ่าน — เดินคู่ก่อน ห้ามสลับทันที

1. **เฟส 0 (ทำได้เลย ไม่ต้องรอ vendor):** เพิ่มคอลัมน์ `source` + `machine_tag_map` ว่างๆ · additive ทั้งหมด ไม่กระทบของเดิม
2. **เฟส 1 — นำร่อง 1 ไลน์ (SEYI-250):** รับ state + stroke · สร้างแถว `source='scada'` แต่ **ยังไม่เอาไปคิด OEE**
3. **เฟส 2 — เดินคู่ 4-6 สัปดาห์:** จอเทียบ "OEE จากคนกรอก vs จาก SCADA" ข้างกัน + ส่วนต่าง
   **ให้หน้างานเป็นคนตัดสินว่าอันไหนตรงความจริง** — ไม่ใช่เราตัดสิน
4. **เฟส 3 — สลับเป็นหลัก:** SCADA เป็นแหล่งของ A/P · คนเหลือแค่ระบุสาเหตุ + ลง NG
5. **เฟส 4 — ขยายทีละไลน์** ตามความคุ้ม

> **ห้าม recompute กะเก่าด้วยข้อมูลใหม่** — กฎเดิมของโปรเจค (ค่าที่ stamp ไว้คือความจริง ณ วันนั้น)

---

## 7. ข้อกำหนดที่ต้องล็อกในสัญญา/ใบเสนอราคา

**ถ้าไม่ได้ 3 ข้อแรก = ระบบนั้นเป็นกล่องปิด อย่าซื้อ**

1. ✅ **เข้าถึง raw data ได้** — API หรืออ่าน DB/historian ตรง (ระบุ format + rate limit)
2. ✅ **ได้ tag list ทั้งหมด** พร้อมความหมาย/หน่วย/ความถี่ เป็นเอกสาร
3. ✅ **ข้อมูลเป็นของเรา** เก็บบนเครื่องที่เราควบคุมได้ · export ย้อนหลังได้
4. ระบุชัดว่า **Quality มาจาก signal อะไร** (ถ้าตอบไม่ได้ = OEE เขาไม่ครบ 3 ตัว)
5. ระบุ **นิยามตัวหารของ Availability** (รวมเวลาพักไหม / หักหยุดตามแผนไหม)
6. รองรับเพรสรุ่นเก่าที่ไม่ใช่ SEYI ไหม · ค่าใช้จ่ายต่อ tag/ต่อเครื่องเพิ่ม
7. มี signal **die change** แยกจาก stop ทั่วไปไหม
8. **ห้ามผูกว่าต้องดู OEE บนจอเขาเท่านั้น**

---

## 8. ทำอะไรได้ตอนนี้ (ยังไม่ต้องมี SCADA)

- [ ] migration เพิ่ม `downtime_logs.source` / `prod_orders.qty_source` (default `'manual'`) — 1 ไฟล์ ไม่มีความเสี่ยง
- [ ] `dr_products.pieces_per_stroke` (default 1) — เก็บข้อมูลงานคู่ไว้ก่อน จะได้ไม่ต้องไล่กรอกทีหลัง
- [ ] **กฎสำหรับโค้ดใหม่:** ห้ามเขียน logic ที่สมมติว่าทุกแถวมาจากคน (เช่นบังคับ `reported_by_name` ไม่ว่าง)
- [ ] ตอนเจรจา ใช้ §7 เป็น checklist

---

## เอกสารที่เกี่ยวข้อง

- `CLAUDE.md` §OEE — สูตร A/P/Q, กฎ Q (ยอดสแกน = ของดีล้วน), 1/N เครื่องขนาน, งานคู่ RH/LH
- `src/utils/oee.js` — single source of truth ของทุกสูตร (**ปลายทางของข้อมูล SCADA คือที่นี่ ไม่ใช่สูตรใหม่**)
- `CLAUDE.md` §Traceability — `audit_log` + `updated_by_name` (ข้อมูลจาก SCADA ก็ต้องสืบย้อนได้เหมือนกัน)
