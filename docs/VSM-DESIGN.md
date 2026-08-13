# Value Stream Mapping (VSM) — ออกแบบก่อนลงมือ

> สถานะ: **ออกแบบ ยังไม่ได้ทำ** (2026-08-06 · คำสั่ง user "อยากได้ tab สร้าง VSM มาตรฐานสากล
> กดเลือก main product (100XXXXX) แล้วโปรแกรมสร้างให้")
> อ่านคู่กับ `docs/ENGINEERING-PRINCIPLES.md` + `docs/UI-CONVENTIONS.md`

อ้างอิงจากใบ VSM จริงของ TSAT 2 ใบ (REINF ASY BDY SD RR `N1WB-E20022-AB` · P/8 RADIATOR GRL
`N1WB-17C759-BB` — ทั้งคู่ Model P703 ลูกค้า FORD) — โครงตาม Learning to See (Rother & Shook)
ซึ่งเป็นมาตรฐานสากลที่ใบของเราใช้อยู่แล้ว **ไม่ต้องคิดสัญลักษณ์ใหม่**

---

## 1. VSM 1 ใบประกอบด้วยอะไร (ถอดจากใบจริง)

| โซน | สิ่งที่มี |
|---|---|
| **หัวกระดาษ** | Company / Model Line / Effective Date / Approved-Checked-Issued By · ☑ Current state ☐ Future ☐ Ideal |
| **ระบุพาร์ท** | Part Name · Part No. · Model · Customer |
| **กล่องข้อมูลมุมขวาบน** | Working day (21 วัน) · Order pcs/year · pcs/month · pcs/day · **AT** (56,400 sec) · **TT** (61 sec) |
| **ผู้ส่งมอบ (ซ้าย)** | โรงงาน supplier + ตัวเลขรอบส่ง `7:1:1` · ปริมาณคงคลังที่ store (60,000 Kg · 16,376 coil/set) |
| **ลูกค้า (ขวา)** | TSRA `1:4:2` · Forecast 12 months · Order 2 days early · Shipping |
| **การไหลข้อมูล (เส้นบน)** | SALE & PLANNING → SAP → PRODUCTION · เส้นหยัก = electronic · เส้นตรง = manual · PLANNING CONTROL |
| **กล่องกระบวนการ** | ชื่อ (STAMPING PRESS 300 TON) + **CT · TT · Set up (C/O) · %OEE · จำนวนกะ · AT · LOT SIZE** + จำนวนคน |
| **คงคลังระหว่างทาง** | ▲ + จำนวนชิ้น (3,000 Pcs · 200 Pcs · 2,840 · 4,080) · Store Raw / Store Blank / Store Semi / W/H |
| **สัญญาณดึง** | PW (withdrawal kanban) · PK (production kanban) · waiting post · supermarket · 🔺 pull |
| **งานจ้างนอก** | JAROONRAT `1:3:3` (พ่นสี) — กล่องโรงงานนอกคั่นกลางสายผลิต |
| **บันไดเวลาล่าง** | ขั้นบน = วัน (คงคลัง) · ขั้นล่าง = วินาที (งานจริง) |
| **สรุปมุมล่างขวา** | **PLT** 81 วัน · **PT** 48,162 sec · MCT · **%VA = VA ÷ (VA+NVA) × 100 = 1.04%** |
| **แถบสัญลักษณ์ล่าง** | legend ทั้งชุด |

---

## 2. ข้อมูลที่ระบบมีอยู่แล้ว → เติมช่องไหนได้บ้าง

**หัวใจคือ: ตัวเลขเกือบทั้งใบมีอยู่ในระบบแล้ว** — VSM ที่ทำมือปีละครั้งจะกลายเป็นของที่ generate ได้ทุกวัน

| ช่องในใบ VSM | ที่มาในระบบ | สถานะ |
|---|---|---|
| Part Name / No. / Customer | `dr_products` + `parts_master` (`p_no` = เลขลูกค้า) | ✅ |
| Working day / เดือน | `company_calendar` ผ่าน `countWorkingDaysInMonth()` — **ห้าม hardcode 21/22** | ✅ |
| Order pcs/year · /month · /day | `customer_forecasts` (830) + `customer_shipping_orders` (862) | ✅ |
| **AT** (available time) | `production_sessions.shift_min` − พักตามนโยบาย `policyBreakForShift()` × จำนวนกะ | ✅ |
| **TT** = AT ÷ ความต้องการต่อวัน | คำนวณจาก 2 ช่องบน | ✅ |
| ลำดับกระบวนการ | `bom_items` (FG → ลูก) + `dr_products.line_name` ของแต่ละลูก | ⚠️ **ได้แค่ 2 ชั้น** (ดู §3) |
| **CT** ต่อกระบวนการ | `dr_products.cycle_time_sec` (มาตรฐาน) · เทียบ **CT จริง** จาก `prod_orders` ได้ด้วย | ✅ |
| **%OEE** ต่อกระบวนการ | `production_sessions` ผ่าน `wavg` ใน `utils/oee.js` (ถ่วงเวลารับภาระ) | ✅ |
| **C/O (Set up)** | `downtime_logs` ที่ประเภทถูกจัด `six_big_loss='setup'` → ค่ากลางของนาทีเปลี่ยนรุ่น | ✅ (ได้จากงาน Lean 2026-08-05) |
| จำนวนกะ | นับกะที่เปิดจริงในช่วง (`production_sessions.shift`) | ✅ |
| **LOT SIZE** | `kanban_standards.lot_size` | ✅ |
| จำนวนคนในกล่อง | `stdCapacityOf()` / `stdGroupOf()` (`utils/stdManpower.js`) | ✅ |
| ▲ คงคลังระหว่างทาง (pcs) | ยอดคงเหลือจาก `line_stock_transactions` · เทียบ `kanban_standards.min/max_qty` | ✅ |
| ▲ เป็น "กี่วัน" | ชิ้น ÷ ความต้องการต่อวัน | ✅ |
| Supermarket / PW / PK | มี kanban ของพาร์ทนั้นใน `kanban_standards` = จุดดึง · `total_kanban` | ✅ |
| รอบส่งลูกค้า | `kanban_delivery_rounds` + `kanban_deliveries` | ✅ |
| ผู้ส่งมอบ (300/500) | `parts_master.supplier` · ของค้างสั่ง `purchase_requests` | ⚠️ มีชื่อ ไม่มีรอบส่ง |
| ขนส่ง/milk-run | `transport_*` (carrier, รอบ, ยานพาหนะ) | ✅ (ในโรงงาน) |
| **PLT / PT / %VA** | คำนวณจากทั้งหมดข้างบน | ✅ |
| การไหลข้อมูล (SAP/forecast) | — เป็นข้อความคงที่ของโรงงาน | ⚠️ ตั้งค่าครั้งเดียว |
| **งานจ้างนอก (JAROONRAT)** | **ไม่มีข้อมูล** | ❌ |
| รอบส่ง supplier `7:1:1` | **ไม่มีข้อมูล** | ❌ |
| Raw material เป็น Kg/coil | `parts_master.uom` มี แต่ conversion coil→ชิ้น ไม่มี | ❌ |

---

## 3. ⚠️ ช่องว่างจริงข้อเดียวที่ต้องตัดสินใจ — "ลำดับกระบวนการ" (routing)

`bom_items` เก็บ **FG → ลูก 1 ชั้น** เท่านั้น (`product_id` + `mat_no` ของลูก) — ระบบ**ไม่มีตาราง routing**
บอกว่าพาร์ทหนึ่งต้องผ่านเครื่อง/สถานีอะไร เรียงลำดับไหน

ใบจริงมี `STAMPING 300T → Store Blank → STAMPING 600T → Store Semi → MAIN ASSY`
ถ้า "Blank" กับ "Semi" **ไม่ได้เป็น mat_no แยก** ในระบบ → generate อัตโนมัติจะได้แค่
`ไลน์ปั๊ม → ไลน์ประกอบ` ตกหล่นขั้นกลางไป

**3 ทางเลือก:**

| | วิธี | ได้อะไร | เสียอะไร |
|---|---|---|---|
| **ก** | generate ร่างจากข้อมูลจริง แล้ว**ให้คนลาก/เพิ่มขั้นเองในหน้าจอ** เก็บเป็นเอกสาร | ทำได้เลย ไม่ต้องแตะ master · ตัวเลขยังมาจากข้อมูลจริง 100% | ขั้นกลางต้องเพิ่มเองรอบแรก (รอบหลังใช้ของเดิม) |
| **ข** | เพิ่ม master **routing** (พาร์ท → ลำดับกระบวนการ/เครื่อง) แล้ว generate ครบ | ใบสมบูรณ์อัตโนมัติ · ใช้ต่อยอดได้อีกเยอะ (capacity, ต้นทุน, PM) | เป็นงานลงข้อมูลใหญ่ (ทุกพาร์ท × ทุกขั้น) ก่อนได้ VSM ใบแรก |
| **ค** | ให้ intermediate เป็น mat_no จริงใน `parts_master` แล้วผูก BOM หลายชั้น | ตรงหลัก material master ที่วางไว้แล้ว | ต้องออกเลข MAT ให้ของกลางทาง = เรื่องของ SAP ไม่ใช่แค่เรื่องเรา |

**แนะนำ: ก → ข** — เฟส 1 ทำ **ก** (ได้ใบใช้งานจริงเร็ว พิสูจน์ว่าเลขถูก) แล้วถ้าติดใจค่อยยกร่างที่คนแก้ไว้
ขึ้นเป็น routing master ในเฟส 2 (**ร่างที่คนแก้แล้ว = ข้อมูล routing ที่ได้มาฟรี** ไม่ต้องนั่งลงใหม่)

---

## 4. โครงที่เสนอ

### 4.1 เก็บยังไง
```
vsm_maps  (DR project — pattern เดียวกับ improvements/scrap_reports)
  id · mat_no (FG) · title · state ('current' | 'future' | 'ideal')
  period_from / period_to        ← ช่วงข้อมูลที่ใช้คำนวณ
  effective_date · approved_by / checked_by / issued_by
  data jsonb                     ← nodes + links + ตัวเลขที่ snapshot ไว้
  generated_at · updated_by_name · status
```
- **snapshot ตัวเลขลง `data`** ไม่คำนวณสดตอนเปิดดู — VSM คือ "ภาพ ณ เวลานั้น" (ใบจริงเขียน
  *Information on July 25*) เหมือนที่ระบบ snapshot `lpa_audit_answers.question_text`
- ปุ่ม **"↻ ดึงข้อมูลปัจจุบันมาเทียบ"** → โชว์ diff ทีละช่อง (CT/OEE/stock เปลี่ยนไปเท่าไหร่)
  **ไม่เขียนทับเงียบ** ให้คนกดรับเป็นรายช่อง
- ตารางเดียว + jsonb ไม่แตกเป็น `vsm_nodes`/`vsm_links` — เป็นเอกสารวาด ไม่ได้ query รายโหนด

### 4.2 หน้าจอ
- **แท็บใน `/oee-analytics`? ไม่** — VSM เป็นเครื่องมือ Lean ระดับสายผลิต ควรอยู่หมวด
  **วิเคราะห์ & รายงาน** เป็นหน้าของตัวเอง `/vsm` (ต่อยอดจากแกน Lean 6 Big Losses/8 Wastes
  ที่เพิ่งทำ 2026-08-05 — VSM คือมุมมอง "ทั้งสาย" ของเรื่องเดียวกัน)
- เลือก FG (mat `1xxxxxxx`) + ช่วงเวลา → **สร้างร่าง** → แก้บนผัง → บันทึก/พิมพ์
- วาดด้วย **SVG + พิกัด % แบบเดียวกับ FactoryMap/RackMap** (ไม่เอา lib วาดผังมาเพิ่ม)
- สัญลักษณ์เป็น component เดียว `src/components/vsm/` + legend สร้างจาก registry เดียวกัน
  **ห้าม hardcode รูปสัญลักษณ์ซ้ำในหน้า**

### 4.3 กติกาที่ห้ามพลาด
- **ตัวเลขทุกตัวต้องมาจาก util กลางเดิม** — `utils/oee.js` (OEE/AT/พัก) · `pairTotals` (งานคู่ RH/LH
  = 1 stroke) · `companyCalendar` (วันทำงาน) · `stdManpower` (จำนวนคน) · `kanbanCalc`
  **ห้ามเขียนสูตรใหม่ในหน้า VSM** ไม่งั้นได้ OEE คนละชุดกับ `/oee-analytics` ทันที
- **ช่องที่ไม่มีข้อมูลต้องขึ้นว่า "ยังไม่มีข้อมูล" ห้ามเดาเลขให้** (เช่น รอบส่ง supplier, งานจ้างนอก)
- ใบพิมพ์ (A3 landscape) **ต้อง register ใน `/doc-forms`** doc_key `vsm` ตามกฎเอกสาร
- %VA ต่ำมาก (1.04%) เป็นเรื่องปกติของ VSM — **ห้ามทำ UI ตีความว่าเป็นสีแดง/ผิดปกติ**

---

## 5. เฟส

| เฟส | ได้อะไร |
|---|---|
| **1** | เลือก FG → generate ร่าง (กล่องกระบวนการ + ตัวเลขจริง + ▲ คงคลัง + บันไดเวลา + PLT/PT/%VA) → แก้บนผัง → บันทึก → พิมพ์ A3 |
| **2** | Future state: ก๊อป current แล้วแก้ + **kaizen burst ผูกกับโปรเจคใน `/improvements`** (ระบบมีอยู่แล้ว) → ติดตามผลจริงว่าลด PLT ได้เท่าไหร่ |
| **3** | routing master (ถ้าเฟส 1 พิสูจน์แล้วว่าคุ้ม) · รอบส่ง supplier · งานจ้างนอก |
| **4** | เทียบ current vs future อัตโนมัติจากข้อมูลจริง — "เดือนนี้ PLT ลดจาก 81 → 74 วันจริงไหม" |

**จุดที่ทำให้ของเราต่างจาก VSM กระดาษ:** ใบกระดาษคือภาพนิ่งที่ล้าสมัยทันทีที่วาดเสร็จ
ของเรา generate ซ้ำได้ทุกเดือน → **VSM กลายเป็นตัวชี้วัดที่มีชีวิต** ไม่ใช่โปสเตอร์ติดผนัง
