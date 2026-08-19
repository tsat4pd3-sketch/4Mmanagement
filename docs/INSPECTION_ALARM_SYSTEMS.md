# ระบบตรวจสอบ + Alarm — สถาปัตยกรรมรวม 3 ระบบ

> รวบรวม requirement จากการวางระบบ Smart Maintenance/Inspection
> มี **3 ระบบตรวจสอบ** ที่ต่างเจ้าของ ความถี่ และรูปแบบการแจ้งเตือน แต่ใช้ **engine เดียวกัน**

---

## หลักการรวม (ทำไมเป็น engine เดียว)

ทั้ง 3 ระบบคือ *"งานตรวจที่ต้องเกิดภายในกรอบเวลาหนึ่ง เทียบกับเหตุการณ์ตั้งต้น ถ้าไม่เกิด → เตือนแบบทวีความถี่"*
ต่างกันแค่ **4 พารามิเตอร์**:

| พารามิเตอร์ | ความหมาย |
|-------------|----------|
| **Trigger** | อะไรเริ่มจับเวลา (เริ่มผลิต / confirm order / ใกล้ถึงรอบปฏิทิน) |
| **Grace window** | ช้าได้กี่นาที/วัน ก่อนถือว่า "เกิน" |
| **Escalation** | เตือนซ้ำอย่างไร (ครั้งเดียว / ทุก 30 นาที / เป็นสเตจ) |
| **Completion** | อะไรถือว่า "ตรวจเสร็จ" (inspection ครบทุกเครื่อง / QA submit / PM submit) |

→ ออกแบบเป็นตาราง `inspection_obligations` + Edge Function scheduler ตัวเดียวที่อ่าน config แล้วยิง alarm

---

## ระบบ 1 — Production Daily Preventive Maintenance (ต่อไลน์ × กะ)

**เจ้าของ:** ฝ่ายผลิต · **ตรวจ:** ความพร้อมเครื่องจักร/อุปกรณ์/ระบบ POKA-YOKE ตอนเริ่มงาน

| | |
|--|--|
| Trigger | order ตัวแรกของไลน์ถูก confirm (`prod_orders.confirmed_at` ผ่าน `production_sessions` line×shift×work_date) |
| Grace window | **ไม่เกิน 1 ชั่วโมง** หลังเริ่มผลิต + confirm ยอด |
| หน่วย | **ต่อไลน์ ต่อกะ** — มองภาพรวมเครื่องที่ "ลงทะเบียนต้องตรวจ" N เครื่อง |
| Completion | ตรวจครบ N เครื่อง |

**สถานะ (aggregate ทั้งไลน์):**
- 🟢 **เขียว** — ตรวจครบ N + ผ่านหมด → "ไลน์ X ตรวจครบ 10/10 ทุกอย่างปกติ"
- 🟠 **ส้ม** — เกิน window แล้วตรวจ < N → "ไลน์ X ตรวจ 9/10 ขาด: [เครื่องที่ยังไม่ตรวจ]"
- 🔴 **แดง** — พบ NG → "ไลน์ X เครื่อง [Y] หัวข้อ [Z] ผิดปกติ" (แดงชนะส้ม, รวมข้อความ)

**ต้องนิยาม (ข้อ 3 — ยังคุยกันอยู่):** "N เครื่องที่ลงทะเบียนต้องตรวจต่อไลน์" มาจากไหน
- 3A ใช้ checklist ที่ตั้ง frequency='daily' (reuse `pm_plans`)
- 3B ตาราง registry แยก `pm_daily_line_targets(line_name, jig_id, shift?)` ← ตรงคำว่า "ลงทะเบียน" สุด
- 3C อิง `machines` ต่อไลน์

---

## ระบบ 2 — QA First–Middle–End ✅ **สร้างแล้ว 2026-08-19** (ต่อ **รุ่น** ไม่ใช่ต่อ order)

**เจ้าของ:** QA · **ตรวจ:** ชิ้นงาน 3 ช่วง first / middle / end

> ### ⚠️ แก้สมมติฐานเดิม — หน่วยคือ "รุ่น" ไม่ใช่ "order" (คำสั่ง user 2026-08-19)
> เอกสารฉบับแรกเขียนว่า trigger = "confirm order ตัวแรก · หน่วย = ต่อ order" ซึ่ง **ใช้จริงไม่ได้**:
> *"เฉพาะเปลี่ยนรุ่น หรือ เปลี่ยนกะ ไม่มองเป็นออเดอร์ เพราะบางงาน ลอทนึงมี 50 เลขออเดอร์"*
> → ต่อ order = เรียก QA 50 ครั้งต่อลอต · **หน่วยที่ถูกคือ ไลน์ × วันงาน × กะ × รุ่น**

| | |
|--|--|
| หน่วย | **ไลน์ × วันงาน × กะ × รุ่น × สเตจ** (unique key ของ `qa_fme_obligations`) |
| Trigger `first` | รุ่นนั้นโผล่ในกะครั้งแรก → ครอบทั้ง **เปลี่ยนกะ** (กะใหม่ = นับใหม่) และ **เปลี่ยนรุ่น** |
| Trigger `end` | รุ่นนั้นจบ = ปิดใบครบแล้วมีรุ่นอื่นเริ่มต่อ (กำลังเปลี่ยนรุ่น) หรือปิดกะ |
| Trigger `middle` | รุ่นวิ่งเกิน `mid_after_min` — **default 0 = ปิด** (user ระบุ "เฉพาะ" 2 เหตุข้างบน) |
| Grace window | QA ต้อง submit ผลภายใน **15 นาที** (`first_due_min` / `end_due_min`) |
| Escalation | ยังไม่รับงาน → เตือนซ้ำทุก **30 นาที** (`escalate_min`) เพดาน `max_alerts` (8) กัน spam |
| Completion | **เปิดใบตรวจ = รับงาน (หยุดเตือน)** · **ปิดใบ = จบงาน** (done_ok / done_ng ตามผล) |
| ช่องทาง | Telegram — event `qa_fme_call` / `qa_fme_overdue` (หมวด quality) ตั้งห้องที่ `/notification-config` |

**⚠️ งานคู่ RH/LH = รุ่นเดียวกัน** — จับกลุ่มด้วย `dr_products.pair_mat_no` (ตัวแทนกลุ่ม = mat ที่เรียงน้อยกว่า)
ไม่งั้นสลับ LH/RH จะถูกอ่านว่า "เปลี่ยนรุ่น" ทุกครั้ง แล้วเรียก QA รัวๆ

**ของที่สร้าง:**
- `qa_fme_obligations` + `qa_fme_config` (Main) · `qa_parts.mat_no` (ผูกพาร์ท QA ↔ เลข SAP ฝั่งผลิต)
- edge `qa-fme-scan` (cron 5 นาที) — อ่าน `production_sessions`/`prod_orders`/`dr_products` จาก DR
  แล้วสร้าง obligation + ยิง Telegram + sync สถานะจาก `qa_inspection_sheets`
- UI `src/components/QaFmeQueue.jsx` — คิวเรียกตรวจ + ตั้งค่า อยู่บนแท็บ ✅ ใบตรวจ ใน `/qa`
- **ไม่ได้สร้าง `qa_piece_inspections` แยกตามที่เอกสารเดิมเสนอ** — ใบตรวจ `qa_inspection_sheets`
  (สร้างปี 2026-08-04 หลังเอกสารฉบับแรก) ทำหน้าที่นั้นอยู่แล้ว ครบทั้ง stage/ผลรายจุด/NCR
  → สร้างตารางที่ 2 = ผลตรวจแตกเป็น 2 ที่ (ผิดหลัก single source of truth)

**ข้อจำกัดที่รู้อยู่ (v1):** ถ้ารุ่น A → B → A ในกะเดียวกัน รอบสองของ A จะไม่เกิด `first` ใหม่
(unique key กันไว้) — ยอมรับได้เพราะเลือกฝั่ง "ไม่เตือนซ้ำ" ไว้ก่อน · แก้ทีหลังได้ด้วยการเติม `run_seq` ในคีย์

---

## ระบบ 3 — Maintenance Planned Preventive Maintenance (ต่อเครื่อง × รอบ)

**เจ้าของ:** Maintenance ทุกประเภท (MTN / JIG MTN / DIE MTN) · **ตรวจ:** วางแผนเข้าเครื่อง อาจต้องหยุดไลน์

| | |
|--|--|
| Trigger | ใกล้ถึงรอบ PM (`pm_plans.next_due_date`) |
| ความถี่ | ทุก **3 เดือน / 6 เดือน** แล้วแต่เครื่อง — **กำหนดเองก่อน**, อนาคตให้ AI predict |
| Escalation | เตือนเป็นสเตจ: **1 เดือนก่อน → 2 สัปดาห์ก่อน → 3 วันสุดท้าย** ก่อนถึงดิว |
| ผู้รับแจ้ง | planning + production + maintenance (เพื่อประชุมเตรียม stock / จัด shutdown) |
| Completion | วันที่ทำ → **submit ผลลัพธ์ + สรุปผลวันนั้น** |

**ต่อยอดจากที่มี:** `pm_plans` (Phase 1) รองรับ `interval_days` อยู่แล้ว (90/180) → เพิ่ม
- escalation reminder engine (30/14/3 วันก่อน next_due)
- record "PM shutdown event" + ช่องสรุปผลวันทำจริง
- อนาคต: `plan_type='usage'/'condition'` = ส่วน predictive (ดู PM_PLAN_STRATEGY.md)

---

## เปรียบเทียบสรุป

| | ระบบ 1 Production | ระบบ 2 QA | ระบบ 3 Maintenance |
|--|------------------|-----------|--------------------|
| Trigger | เริ่มผลิต (order แรก) | order แรก (เรียก QA) | ใกล้รอบปฏิทิน |
| Window | ≤ 1 ชม. | 15 นาที | 30/14/3 วันก่อน |
| Escalation | ส้มเมื่อเกิน | ทุก 30 นาที จน submit | สเตจ 1เดือน/2สัปดาห์/3วัน |
| หน่วย | ไลน์ × กะ (N เครื่อง) | order × สเตจ | เครื่อง × รอบ |
| เสร็จเมื่อ | ตรวจครบ N | QA submit 15 นาที | submit ผลวันทำ |
| ผู้รับ | ผลิต | QA | planning+prod+mtn |
| ข้อมูลที่มี | prod_orders, inspections | prod_orders (+ตาราง QA ใหม่) | pm_plans (มีแล้ว) |

---

## สถาปัตยกรรม engine ที่เสนอ

```
inspection_obligations (งานตรวจที่ต้องเกิด 1 รายการ)
  ├─ system         'production_daily' | 'qa_fme' | 'maintenance_pm'
  ├─ scope_ref      line×shift / order×stage / plan(เครื่อง×รอบ)
  ├─ trigger_at     เวลาเริ่มจับ (จาก event)
  ├─ due_at         trigger_at + window
  ├─ escalation     'once' | 'every_30m' | 'staged'
  ├─ status         pending | done_ok | done_ng | overdue
  └─ last_alerted_at (กัน spam)

Edge Function (cron ~5-10 นาที)
  1. สร้าง obligation เมื่อ trigger เกิด (order confirm / รอบใกล้ถึง)
  2. เช็ค obligation ที่ค้าง → ยิง Telegram ตาม escalation
  3. ปิด obligation เมื่อ completion เกิด (inspection/QA/PM submit)

Event-driven (ในแอป): 🟢/🔴 ยิงทันทีตอน submit ผล
Scheduled (cron): 🟠 + escalation ทั้งหมด
```

---

## สถานะการสร้าง (อัพเดท 2026-08-19)

| ระบบ | สถานะ | ตัวจริงในระบบ |
|--|--|--|
| 1 Production Daily (AM) | ✅ ใช้งานอยู่ | edge `pm-daily-scan` + `pm_daily_line_targets` |
| 3 Maintenance PM | ✅ ใช้งานอยู่ | edge `pm-plan-reminder` (staged 30/14/3 วัน) |
| 2 QA FME | ✅ โค้ดครบ · **ยังไม่ apply/deploy** | `qa_fme_obligations` + edge `qa-fme-scan` + `QaFmeQueue` |

**เปิดใช้ระบบ 2 ต้องทำ 3 ขั้นตามลำดับ** (ยังไม่ได้ทำ — รอ user สั่ง):
1. apply `supabase/migrations/20260819_qa_fme_call.sql` (Main)
2. deploy edge `qa-fme-scan` (**`verify_jwt=false`** เหมือน scan ตัวอื่น) + apply `20260819_qa_fme_scan_cron.sql`
3. เปิดสวิตช์ที่ `/qa` → แท็บใบตรวจ → ⚙️ ตั้งค่าการเรียกตรวจ (`qa_fme_config.is_enabled`)

> **`is_enabled` default = false โดยตั้งใจ** — ระบบนี้ยิงเข้าห้อง Telegram จริงของโรงงาน
> apply/deploy แล้วจะยังเงียบสนิทจนกว่าคนจะกดเปิดเอง (cron วิ่งได้ แต่ function return ทันที)
> · `skip_older_min` (120) กันไม่ให้ตอนเพิ่งเปิดสวิตช์แล้วเรียกย้อนหลังทั้งกะจนท่วมห้องแชท

> Telegram: ใช้กลุ่มเดิมไปก่อน (แยกกลุ่ม PM/ซ่อมบำรุงทีหลังเมื่อระบบสมบูรณ์)
