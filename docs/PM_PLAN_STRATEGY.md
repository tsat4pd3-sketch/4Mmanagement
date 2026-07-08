# แผน PM — สถาปัตยกรรมและ Roadmap: Preventive → Predictive → Prescriptive

> เอกสารออกแบบว่าจะ "set plan" การบำรุงรักษาอย่างไร ให้เริ่มจาก **Preventive** (ตามเวลา)
> แล้วต่อยอดเป็น **Predictive** (จากข้อมูลการใช้งาน/สภาพจริง) และ **Prescriptive** (แนะนำสิ่งที่ควรทำ) ได้
> โดยไม่ต้องรื้อของเดิม — ทุกอย่างเป็นการ **เพิ่มแบบ additive** บนโครงที่มีอยู่

---

## 1. สถานะปัจจุบัน (Preventive อย่างเดียว)

| องค์ประกอบ | ที่อยู่ | กลไก |
|-----------|--------|------|
| นิยามความถี่ | `checklists.frequency` (`daily/weekly/monthly/quarterly/periodic`) | รอบตายตัวตามปฏิทิน |
| คำนวณครบกำหนด | `PMSchedule.jsx` + `lib/pmSchedule.js` | `next_due = วันตรวจล่าสุด(ที่อนุมัติ) + FREQ_DAYS[frequency]` คำนวณสดใน UI |
| จุดตรวจ | `jig_checkpoints` (variable=มีสเปค SPC / attribute=OK-NG) | เก็บค่า + สถานะ SPC ต่อครั้ง |
| ผลตรวจ | `inspections` + `inspection_results` | มี avg, status, final_status, recheck |

**ข้อจำกัด:** รอบเป็นค่าคงที่ ไม่รู้ว่าเครื่องถูกใช้หนัก/เบาแค่ไหน — เครื่องที่เดิน 3 กะ กับเครื่องที่แทบไม่เดิน ใช้รอบเดียวกัน

> ⚠️ ข้อมูล PM ทั้งหมดอยู่บน project **Product DB** (`eyhclzkifitbhbljgoav`) ผ่าน client `supabaseDR`
> ที่วิ่งด้วย role `anon` เสมอ — ตารางใหม่ทุกตัวต้องตั้ง RLS แบบ `anon`-friendly เหมือนตารางเดิม
> **ห้าม** ตั้ง policy เป็น `TO authenticated` (จะพังเพราะ client ไม่มี JWT)

---

## 2. Maturity Model — 3 ระดับ

```
ระดับ 1  PREVENTIVE      "ถึงเวลาแล้ว → ตรวจ"        ← ตอนนี้อยู่ตรงนี้
   │     trigger: ปฏิทิน (ทุก N วัน)
   ▼
ระดับ 2  PREDICTIVE      "ใช้งานถึงเกณฑ์/สภาพเริ่มเพี้ยน → ตรวจ"
   │     trigger: usage (จำนวนช็อต/ชิ้น), condition (SPC drift), reliability (MTBF)
   ▼
ระดับ 3  PRESCRIPTIVE    "ควรทำ X ภายในวันที่ Y เพราะ Z (คุ้มสุด)"
         trigger: model แนะนำ action + จัดตารางให้เอง
```

| ระดับ | Trigger | แหล่งข้อมูลที่ **มีอยู่แล้ว** | ตัวอย่างกฎ |
|-------|---------|------------------------------|-----------|
| Preventive | เวลา | `checklists.frequency` | "ทุก 30 วัน" |
| Predictive — Usage | จำนวนการผลิต | `prod_orders.qty` (2,014 แถวจริง) / `production_shots.shot_count` (backfill) | "ครบ 50,000 ช็อตนับจาก PM ครั้งก่อน → ตรวจ" |
| Predictive — Condition | แนวโน้มค่าวัด | `inspection_results.avg_value` + สเปค `jig_checkpoints.lsl/usl/lcl/ucl` | "ค่า avg เข้าใกล้ USL 3 ครั้งติด หรือ Cpk < 1.33 → ตรวจก่อนกำหนด" |
| Predictive — Reliability | ความถี่เสีย | `downtime_logs` (machine_no, duration_min, started_at) | "MTBF ของเครื่องต่ำกว่าเกณฑ์ → เพิ่มความถี่ PM" |
| Prescriptive | รวมทุกสัญญาณ + ต้นทุน | ทั้งหมดข้างบน + cost/labor | "เปลี่ยน locator pin ภายใน 5 วัน ก่อนคาดว่าจะ NG" |

**หัวใจ:** ทั้ง 3 ระดับตอบคำถามเดียวกัน — *"checklist นี้ครบกำหนดเมื่อไหร่?"* — ต่างกันแค่ที่มาของ `next_due`
ดังนั้นออกแบบให้ `next_due` มาจาก **trigger ที่ถอดเปลี่ยนได้** แล้วอนาคตแค่เพิ่มชนิด trigger

---

## 3. Schema ที่เสนอ (additive, ไม่กระทบของเดิม)

### 3.1 ตารางใหม่ `pm_plans` — หนึ่งแผนต่อหนึ่ง checklist

```sql
create table if not exists public.pm_plans (
  id             uuid primary key default gen_random_uuid(),
  checklist_id   uuid not null references public.checklists(id) on delete cascade,
  plan_type      text not null default 'time',   -- 'time' | 'usage' | 'condition' | 'hybrid'

  -- Preventive (time)
  interval_days  int,                             -- แทน/เสริม checklists.frequency

  -- Predictive (usage)
  usage_metric   text,                            -- 'produced_qty' | 'shot_count'
  usage_threshold numeric,                        -- เช่น 50000
  usage_source_line text,                         -- machine/line ที่ผูกการนับ

  -- Predictive (condition) — เก็บกฎแบบยืดหยุ่นเป็น JSON
  condition_rules jsonb,                          -- {"spc_trend":"toward_usl","consecutive":3,"cpk_min":1.33}

  -- Materialized (คำนวณโดย engine/edge function, ให้ UI อ่านเร็ว)
  next_due_date  date,
  next_due_reason text,                           -- 'time' | 'usage' | 'condition' — โชว์ให้ผู้ใช้เข้าใจว่าทำไมถึงครบ
  health_score   numeric,                         -- 0-100 สำหรับ predictive dashboard
  last_done_at   timestamptz,
  last_inspection_id uuid references public.inspections(id),

  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (checklist_id)
);

alter table public.pm_plans enable row level security;
-- anon-friendly (เหมือนตาราง PM เดิมบน Product DB) — ห้ามใช้ TO authenticated
create policy pm_plans_all on public.pm_plans for all to anon, authenticated using (true) with check (true);
```

> **ทำไมแยกตาราง ไม่ยัดใน `checklists`:** `checklists` เป็น master ที่ PMSetup/PMCheckData ใช้เขียนอยู่แล้ว
> การเพิ่มคอลัมน์เยอะเสี่ยงชนกับ write path เดิม (เพิ่งเจอบั๊ก `layout_type` มา) — แยกตารางปลอดภัยกว่าและ join ง่าย

### 3.2 (มีอยู่แล้ว ใช้ได้เลย) แหล่งข้อมูล predictive
- **Usage:** `prod_orders` (qty จริงต่อ session/machine) เป็นตัวหลัก, `production_shots` เป็น backfill เมื่อไม่มี live data
- **Condition:** `inspection_results.avg_value` เทียบ `jig_checkpoints` สเปค → มี `lib/spc.js` (`getSpcStatus`) พร้อมต่อยอดเป็น Cpk/trend
- **Reliability:** `downtime_logs` (machine_no, duration_min, started_at) → MTBF = ช่วงเวลาเฉลี่ยระหว่างเหตุเสีย

---

## 4. Engine — คำนวณ `next_due` อย่างไรในแต่ละระดับ

> คำนวณใน **Supabase Edge Function** (cron รายวัน) เขียนผล materialize ลง `pm_plans.next_due_date`
> เพื่อให้ `PMSchedule.jsx` แค่ **อ่าน** (เร็ว + ไม่ต้องดึงข้อมูลหนักมาคำนวณใน browser)
> ⚠️ ใช้ `Asia/Bangkok` ในการหาวันที่เสมอ ห้าม `toISOString()` (ตามกฎโปรเจค)

**Time (Preventive):**
```
next_due = last_approved_inspection_date + interval_days
```

**Usage (Predictive):**
```
produced_since_pm = Σ prod_orders.qty (ของ line/machine นี้ ตั้งแต่ last_done_at → now)
ratio = produced_since_pm / usage_threshold
ถ้า ratio ≥ 1 → overdue
ประมาณวันครบ = last_done_at + (usage_threshold / อัตราผลิตเฉลี่ยต่อวัน)
health_score = clamp(100 * (1 - ratio), 0, 100)
```

**Condition (Predictive):**
```
ดึง inspection_results ล่าสุด N ครั้งของ checklist
- ถ้า avg_value ขยับเข้าหา USL/LSL ต่อเนื่อง ≥ consecutive → เลื่อน next_due ให้เร็วขึ้น
- คำนวณ Cpk = min(USL-μ, μ-LSL) / (3σ); ถ้า Cpk < cpk_min → flag "ตรวจก่อนกำหนด"
```

**Hybrid:** `next_due = min(time_due, usage_due, condition_due)` — อันไหนถึงก่อนใช้อันนั้น

---

## 5. UI/UX — PMSetup กลายเป็น "Plan Builder"

เพิ่มใน PMSetup modal (ต่อจากส่วนเลือก frequency เดิม) แบบ progressive:

```
┌ รูปแบบแผน ────────────────────────────────┐
│ ◉ ตามเวลา (Preventive)   ○ ตามการใช้งาน     │
│ ○ ตามสภาพ (SPC)          ○ ผสม (Hybrid)     │
├───────────────────────────────────────────┤
│ [time]     ทุก [ 30 ] วัน                    │
│ [usage]    ทุก [ 50000 ] ชิ้น  จากไลน์ [▼]   │
│ [condition] เตือนเมื่อ Cpk < [1.33]          │
└───────────────────────────────────────────┘
```
- Default = `time` (ผู้ใช้เดิมไม่ต้องเปลี่ยนอะไร → ไม่กระทบ)
- PMSchedule เพิ่มคอลัมน์ "เหตุผลครบกำหนด" (`next_due_reason`) + แถบ `health_score` สำหรับ predictive

---

## 6. Roadmap แบบทำได้จริง (แนะนำลำดับ)

### Phase 1 — ทำ Preventive ให้แน่น + วางราก (1–2 sprint) ✅ *ส่วนใหญ่ทำแล้ว*
- [x] แก้บั๊ก save (layout_type/note_text), date correctness, pin numbering *(session นี้)*
- [x] Schedule ไม่นับผลตรวจที่ถูก reject, off-by-one, daily-freq *(session นี้)*
- [ ] สร้างตาราง `pm_plans` + migrate `checklists.frequency` → `pm_plans(plan_type='time', interval_days)`
- [ ] PMSchedule อ่านจาก `pm_plans.next_due_date` (materialized) แทนคำนวณสด
- [ ] Edge Function `pm-refresh-schedule` (cron รายวัน) เขียน next_due สำหรับ plan_type='time'

### Phase 2 — Usage-based Predictive (2–3 sprint)
- [ ] เพิ่ม plan_type='usage' + Plan Builder UI
- [ ] Engine รวม `prod_orders.qty` ต่อ line/machine ตั้งแต่ last PM → เทียบ threshold
- [ ] Dashboard: health_score + "คาดว่าจะครบในอีก X วัน"

### Phase 3 — Condition-based Predictive (3–4 sprint)
- [ ] ต่อยอด `lib/spc.js` → Cpk + trend detection จาก `inspection_results`
- [ ] plan_type='condition' + กฎ JSON
- [ ] เชื่อม `downtime_logs` → MTBF ต่อ machine เพื่อปรับความถี่อัตโนมัติ
- [ ] แจ้งเตือน (in-app + Telegram) เมื่อ predictive flag เด้ง

### Phase 4 — Prescriptive (อนาคต)
- [ ] เก็บ cost/labor/spare-part ต่อ action
- [ ] Model แนะนำ "ทำอะไร เมื่อไหร่" + จัดตารางรวมทั้งไลน์ให้ downtime รวมต่ำสุด
- [ ] What-if simulation ("ถ้าเลื่อน PM เครื่องนี้ 3 วัน เสี่ยงเท่าไหร่")

---

## 7. Quick wins ที่ทำได้ทันที (แนะนำเริ่ม Phase 1 ต่อ)
1. **ตาราง `pm_plans` + backfill จาก `checklists.frequency`** — วางรากให้ทุกอย่างต่อยอด โดยไม่เปลี่ยน UX เดิม
2. **Edge Function materialize `next_due`** — ย้ายการคำนวณออกจาก browser, รองรับ cron/predictive
3. **แสดง "ใช้ไป X ชิ้นจาก threshold" บน PMSchedule** — ให้เห็นคุณค่า usage-based ก่อนเปิดใช้เต็ม (อ่านจาก `prod_orders` ที่มีข้อมูลจริงแล้ว)

> เริ่มที่ข้อ 1–2 จะได้ประโยชน์สูงสุดต่อความพยายาม เพราะเป็นฐานที่ทั้ง predictive/prescriptive ยืนอยู่บนมัน
