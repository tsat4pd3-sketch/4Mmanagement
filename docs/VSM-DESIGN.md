# Value Stream Mapping (VSM) — ออกแบบก่อนลงมือ

> สถานะ: **เฟส 1 ทำแล้ว 2026-08-13** (หน้า `/vsm` + routing master) · **แท็บ ⚡ สายธารสด (Realtime) ทำแล้ว 2026-08-19** (ดู §8) · **worklist ข้อมูลที่ขาด + เสนอ routing จาก PFC ทำแล้ว 2026-08-20** (ดู §9) — เฟส 2-4 (future state/kaizen burst) ยังไม่ทำ
> **📎 reference สไตล์ใบจริงของโรงงาน (user แชร์ 2026-08-20) อยู่ที่ skill `.claude/skills/vsm-tsat-reference/SKILL.md`** — งานที่แตะ VSM ให้โหลด skill นั้นคู่กับไฟล์นี้เสมอ (ธรรมเนียม MCT headline · kaizen burst · future state · ชุดคำบนเส้นข้อมูล) · MCT/PT format ผ่าน `fmtMct`/`fmtMinSec` ใน `src/lib/vsmModel.js` (เพิ่ม 2026-08-20)
> ที่มา: คำสั่ง user 2026-08-06 "อยากได้ tab สร้าง VSM มาตรฐานสากล กดเลือก main product
> (100XXXXX) แล้วโปรแกรมสร้างให้" · user เลือก **"เพิ่ม master routing ก่อน"** + **"เฟสแรก = Current state + พิมพ์ A3"**
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
| **ลำดับกระบวนการ** | **`part_routings`** (ตารางใหม่ 2026-08-13) | ✅ |
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

**user เลือก ข** (2026-08-13) → สร้างตาราง **`part_routings`** แล้ว จัดการที่ **Product Master → 🔀 Routing**
พาร์ทที่ยังไม่ลง routing ไม่ตัน — ระบบใช้ไลน์เดียวจาก Product Master ไปก่อน (`is_fallback`) แล้ว**ขึ้นเตือนบนจอ**
ว่ายังไม่ได้ลง (ไม่เงียบ) · ปุ่ม "⚡ สร้างขั้นตั้งต้นจากไลน์" ช่วยตั้งต้นให้ 1 ขั้น แล้วค่อยแตกเป็นหลายขั้นเอง

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
| **1 ✅** | เลือก FG → generate ร่าง (กล่องกระบวนการ + ตัวเลขจริง + ▲ คงคลัง + บันไดเวลา + PLT/PT/%VA) → แก้ค่า → บันทึก → พิมพ์ A3 |
| **2** | Future state: ก๊อป current แล้วแก้ + **kaizen burst ผูกกับโปรเจคใน `/improvements`** (ระบบมีอยู่แล้ว) → ติดตามผลจริงว่าลด PLT ได้เท่าไหร่ |
| **3** | routing master (ถ้าเฟส 1 พิสูจน์แล้วว่าคุ้ม) · รอบส่ง supplier · งานจ้างนอก |
| **4** | เทียบ current vs future อัตโนมัติจากข้อมูลจริง — "เดือนนี้ PLT ลดจาก 81 → 74 วันจริงไหม" |

**จุดที่ทำให้ของเราต่างจาก VSM กระดาษ:** ใบกระดาษคือภาพนิ่งที่ล้าสมัยทันทีที่วาดเสร็จ
ของเรา generate ซ้ำได้ทุกเดือน → **VSM กลายเป็นตัวชี้วัดที่มีชีวิต** ไม่ใช่โปสเตอร์ติดผนัง


---

## 6. ⚠️ สูตร %VA — ตัวหารไม่ใช่ 86,400 (ถอดจากใบจริง 2026-08-13)

ใบ VSM ของบริษัทเขียน `%VA = VA / (VA+NVA) x 100` แต่ไม่บอกว่า NVA มาจากไหน — ถอดกลับจากตัวเลขในใบได้ว่า:

```
VA  = PT (วินาที)
NVA = PLT (วัน) × AT (วินาที/วัน)        ← ไม่ใช่ × 86,400
```

| ใบ | PLT | PT | AT | ตัวหารในใบ | คำนวณ PLT×AT + PT | %VA ในใบ | ได้ |
|---|---|---|---|---|---|---|---|
| REINF ASY BDY SD RR | 81 | 48,162 | 56,400 | **4,616,562** | **4,616,562** ✓ | 1.04% | **1.04%** ✓ |
| P/8 RADIATOR GRL | 82.65 | 53,100 | 56,400 | — | 4,714,560 | 1.13% | **1.13%** ✓ |

ถ้าใช้ 86,400 (24 ชม.) จะได้ 0.68% / 0.74% = **ต่ำกว่าใบจริงเกือบเท่าตัว**
เหตุผลเชิงความหมาย: NVA คือ "เวลารอที่กินโอกาสผลิต" จึงนับด้วยเวลาที่โรงงานเปิดจริง ไม่ใช่เวลานาฬิกา

**สูตรนี้อยู่ที่ `src/lib/vsmModel.js` จุดเดียว — จอ/ใบพิมพ์อ่านจากที่นั่น ห้ามคำนวณซ้ำที่อื่น**

## 7. สิ่งที่ทำจริงในเฟส 1 (ไฟล์)

| ไฟล์ | หน้าที่ |
|---|---|
| `supabase/migrations/20260813_part_routings.sql` (DR) | routing master |
| `supabase/migrations/20260813_vsm_maps.sql` (DR) | เอกสาร VSM (snapshot jsonb) |
| `supabase/migrations/20260813_vsm_permission.sql` (Main) | `page:/vsm` · `vsm:manage` · `routing:manage` · doc_form `vsm` |
| `src/utils/routing.js` | **pure** — จัดกลุ่ม/fallback/เรียงลำดับ routing |
| `src/lib/vsmModel.js` | **pure** — สูตรทั้งหมด (reuse utils/oee · stdManpower · companyCalendar) |
| `src/components/VsmCanvas.jsx` | SVG + ทะเบียนสัญลักษณ์ + legend (auto-layout) |
| `src/components/RoutingPanel.jsx` | แท็บ 🔀 Routing ใน Product Master |
| `src/lib/vsmPrint.js` | พิมพ์ A3 — **clone SVG ตัวจริงไปใช้ ไม่วาดใหม่** |
| `src/pages/VSM.jsx` | หน้าเว็บ: โหลดข้อมูล + แสดงผล (ไม่มีสูตรในนี้) |

**ตรวจแล้วกับข้อมูลจำลองที่ถอดจากใบจริง:** Order/วัน 19,517÷21 = **929** ตรงใบ ·
คงคลัง 3,000 ชิ้น = **3.23 วัน** ตรงใบ · OEE ถ่วงน้ำหนักถูก · เคสข้อมูลว่างไม่พัง (คืน null + เตือน 3 error)

---

## 8. ⚡ แท็บ "สายธารสด (Realtime)" — ทำแล้ว 2026-08-19 (คำสั่ง user "อัพเกรดเป็น VSM realtime")

**mini-ADR:** โจทย์คือ "VSM realtime" แต่กฎเดิมของโมดูลคือ *เอกสาร VSM = snapshot ห้ามคำนวณสดตอนเปิดดู*
(§4.1 — ใบที่อนุมัติแล้วห้ามเปลี่ยนตัวเลขเองเงียบๆ) → ทางที่เลือก: **แยกเป็นแท็บใหม่ อยู่คู่ของเดิม**
(หลัก rollout ข้อ 2 ใน ENGINEERING-PRINCIPLES §11) ไม่ใช่เปลี่ยนเอกสารให้สด
· ทางเลือกที่ตัดทิ้ง: (ก) auto-refresh ตัว generate — ไม่ใช่ realtime จริง (ใช้กะปิดแล้ว)
(ข) เปลี่ยน snapshot เป็นคำนวณสด — ทำลายความน่าเชื่อถือของใบที่เซ็นแล้ว

| ส่วน | มาจากไหน | ความสด |
|---|---|---|
| โครงสาย + ค่ามาตรฐาน (CT · C/O · %OEE เฉลี่ย · AT · TT · demand) | `fetchRaw` เดือนปัจจุบัน (query ชุดเดียวกับ generate) | โหลดครั้งเดียวต่อ FG |
| สถานะไลน์ / OEE กะนี้ / ยอดวันนี้ / DT ค้าง | `src/lib/vsmLive.js` (pure · เทส 7 เคส) จากกะวันงานนี้ | realtime + poll `RATE.BOARD` |
| ▲ คงคลัง → PLT / %VA | `line_stock_summary` ปัจจุบัน → rebuild `buildVsmModel` | ทุกรอบ refresh |

- **สูตรทุกตัวยังมาจาก util กลาง** — `computeLiveOee` / `wavg`+`wLoad` / `sumDefectQty(rows,'line')` /
  สูตรผลิตระหว่างกะ `confirmed ? (qty_ok ?? qty) : (qty_actual ?? 0)` / `isOpenDT`+`isPlannedDT`
  (ย้ายไป `src/utils/downtimeRules.js` pure — downtimeAlarm.js re-export)
- **"ประเมินไม่ได้" = null + เหตุผลบนจอเสมอ** (กะเพิ่งเปิด <10 นาที · ยังไม่ผลิตชิ้นแรก · ไม่ตั้ง CT ·
  ยังไม่เปิดกะ) — ห้ามโชว์ 0%
- **planned DT ค้างไม่เป็น Andon แดง แต่โชว์แยกแบบสงบ** (กฎ downtimeAlarm เดิม)
- **VsmCanvas prop `live` เป็น additive** — ไม่ส่ง = render เดิมเป๊ะ · ใบพิมพ์ clone SVG จากแท็บเอกสาร
  จึงไม่กระทบ · ขอบกล่อง: แดงกระพริบ (SMIL) = DT ค้าง · เขียว = กำลังผลิต · เส้นประจาง = ยังไม่เปิดกะ
- **โหมดสดไม่บันทึก/ไม่พิมพ์** — กันคนเอาภาพสดไปใช้แทนเอกสารทางการ (จอบอกชัด + ปุ่มบันทึก/พิมพ์อยู่แท็บ 📋 เท่านั้น)
- egress: realtime channel `vsm-live` (downtime_logs/prod_orders/defect_logs/production_sessions —
  อยู่ใน publication ครบ) + `usePolling(RATE.BOARD)` กันเหนียว · query สดกรองตามไลน์ในสาย payload เล็ก
  · query พลาด = flag `partial` แถบส้ม ห้ามเงียบ

## 9. 📋 Worklist "ข้อมูลที่ VSM ยังขาด" + 🔀 เสนอ routing จาก PFC — ทำแล้ว 2026-08-20

จาก audit ข้อมูลจริง 2026-08-20 (FG 44 ตัวยังไม่มี routing เลย · CT ครบแค่ 13/44 · forecast ผูก FG 5/44)
— ปิดลูป "รู้ว่าขาด → ไปลงที่ไหน" ด้วย 2 ชิ้น:

**(ก) Worklist บนหน้า `/vsm` (แท็บเอกสาร)** — แทนบล็อก warning เดิม
- การตรวจ "ขาดอะไร" อยู่ที่ `buildVsmModel` ที่เดียว (warning มี `code` กำกับ) ·
  `src/lib/vsmGaps.js` แค่จับคู่ code → ปุ่มลิงก์ "ไปลงข้อมูลที่ต้นทาง"
- **เพิ่ม warning ใหม่ในโมเดล = ใส่ code + เติม FIX ใน vsmGaps** — code ที่ไม่รู้จักยังแสดง (ไม่มีลิงก์)
- warning รวมใหม่ 2 ตัว: `no_oee` (ไลน์ของขั้นไม่มีกะปิดในเดือน) · `no_setup` (ไม่มี downtime หมวด setup)
- FG ที่มีชุด PFC ใน `/pe-docs` → ปุ่ม routing ชี้ `?set=<id>` ตรงชุด (จับคู่ mat_no ก่อน แล้ว `matchDocSet`)
- ProductMaster ผูกแท็บกับ URL แล้ว (`useTabParam`) → `/products?tab=routing` deep-link ได้

**(ข) ปุ่ม "🔀 เสนอ routing เข้า VSM" ใน `/pe-docs` แท็บ Flow** — PFC → `part_routings`
- **ระบบเสนอ คนยืนยัน** (กฎ AI intake) — ตัวแปลง pure `src/utils/peRouting.js` (เทส 5 เคส):
  `process`/`inspection` → ขั้น routing (ติ๊กออกได้) · `storage` → `wip_label` ของขั้นก่อนหน้า ·
  incoming_insp/transport/rework/warehouse/delivery ข้ามแบบรายงาน (ห้ามตัดเงียบ)
- MAT ผูกผ่าน `resolveMatForSet`: `pe_doc_sets.mat_no` → เทียบ `part_no` กับ `dr_products.p_no`
  แบบ normalize · **กำกวมหลายตัว = ให้คนเลือกเอง ห้ามเดา** (p_no ยังไม่ unique จริง — กฎ matResolve)
- มี routing เดิม = confirm แล้วปิดชุดเดิม (`is_active=false` เก็บประวัติ ตาม partial unique index)
  ก่อน insert · insert พลาด = กู้ชุดเดิมกลับ + toast
- สิทธิ์ = `routing:manage` เดิม (ไม่ seed key ใหม่ — เลี่ยงกับดัก enum_range) ·
  `part_routings` อยู่ใน `DR_AUDIT_TABLES` → updated_by_name ถูก stamp เอง · ติ๊กเกิน 10 ขั้นมีคำแนะนำ
  (ใบ VSM อ่านง่ายมักมี 5–8 กล่อง) แต่ไม่บล็อก
