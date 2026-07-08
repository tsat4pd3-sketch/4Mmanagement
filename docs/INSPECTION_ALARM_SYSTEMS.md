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

## ระบบ 2 — QA First–Middle–End (ต่อ order/ชิ้นงาน)

**เจ้าของ:** QA · **ตรวจ:** ชิ้นงาน 3 ช่วง first / middle / end (ขึ้นกับรุ่นงาน)

| | |
|--|--|
| Trigger | confirm order ตัวแรก → แจ้งเตือนเรียก QA มาตรวจ |
| Grace window | QA ต้อง **submit ผลภายใน 15 นาที** |
| Escalation | ถ้ายังไม่ submit → alarm **ทุก 30 นาที จนกว่าจะ submit** |
| ช่องทาง | แจ้งผลผ่าน **Telegram** |
| หน่วย | ต่อ order/ชิ้นงาน (first-middle-end แยกสเตจ) |

**หมายเหตุ:** นี่คือ **ตรวจคุณภาพชิ้นงาน** ไม่ใช่ตรวจเครื่องจักร → เป็น object คนละชนิด (จะมีตาราง QA แยก
เช่น `qa_piece_inspections(session_id/order_id, stage, result, submitted_at, submitted_by)`)

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

## ลำดับที่แนะนำให้สร้าง

1. **ระบบ 1 (Production Daily PM)** — ใกล้เสร็จสุด (มี inspections/pm_plans แล้ว, เหลือ registry N + engine)
2. **ระบบ 3 (Maintenance PM escalation)** — มี pm_plans rails แล้ว เหลือ staged reminder
3. **ระบบ 2 (QA FME)** — ต้องสร้าง object ใหม่ (product inspection) มากสุด

> Telegram: ใช้กลุ่มเดิมไปก่อน (แยกกลุ่ม PM/ซ่อมบำรุงทีหลังเมื่อระบบสมบูรณ์)
