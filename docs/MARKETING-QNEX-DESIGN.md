# 💼 Marketing — Q-neX (E-Quotation) · ต้นน้ำของสายธาร Marketing → New Model → โรงงาน

> **สถานะ: สำรวจ/ออกแบบ ยังไม่ลงมือ** (2026-10-30)
> ที่มา (user ส่ง 30/10 — *"ข้อมูลทั้งหมดที่ marketing ใช้งาน และจะทำงานร่วมกับ IEC"*):
> 1. **POC for Q-neX Project** (เด็ค 22 หน้า ของฝ่าย Marketing) — 6 โมดูล + สูตรคำนวณ + test plan 12 ข้อ
> 2. **Q-neX Project Flowchart 20261005** (`.mmd`/`.svg`/`.pdf`) — เก็บ source ไว้ที่ `docs/marketing/qnex-flowchart-20261005.mmd`
> 3. **Sample Data Package — FORD Steel** — เอกสารจริง 1 พาร์ท ตั้งแต่ RFQ ถึง PO (5 โฟลเดอร์ · ~60 ไฟล์)
>
> 🔴 **ชุดตัวอย่าง FORD ไม่ได้อยู่ในรีโป** — มีราคาเสนอลูกค้า · ใบ PO · ต้นทุนภายใน ⇒ เก็บไว้นอก git เท่านั้น
> เอกสารนี้ถอด**โครง**ของไฟล์มา ไม่ลอกตัวเลขเชิงพาณิชย์
> ⚠️ หน้า "Timeline & Milestones" ของเด็ค (หน้า 3) เป็นรูปล้วน อ่านไม่ได้ — ต้องขอจาก Marketing (§9)

---

## 1. โจทย์ — Q-neX อยู่ตรงไหนของ ESM

> user (29/10): *"มันจะต่อกันนะ … ลูปมาเก็ตติ้งกับนิวโมเดลคืองานช่วงแรกเลยที่ทำกับลูกค้า ว่าจะได้งานใหม่หรือไม่
> เริ่มจากมาเก็ตติ้งมานิวโมเดล ถ้าได้งานจนจบถึงจะส่งต่อเข้าโรงงาน"*

```
                 ┌──────────── เว็บ edition "ก่อน SOP" (dist-nm) ────────────┐
 ลูกค้า ──RFQ──► Marketing (Q-neX) ──CRD──► IEC / CSC (NPI · PPS · Mfg Review) ──┐
                 ▲  quote · rework · award                                       │ ได้งาน
                 └──────── ลูกค้า approve / design change / decline ◄────────────┘
                                                                                  ▼
                                               ใบแจ้งจัดทำ F-MKT-001 ──► โรงงานผลิตจริง (ESM แมส · dist/)
```

- **ที่ตั้งในระบบ:** โมดูลมาเก็ตติ้ง = หน้าใหม่ใน **edition เดียวกับ New Model** (`src/appEdition.nm.js` → `EDITION_PAGES`)
  ห้ามแตก edition ที่ 3 (คำสั่ง user 29/10 · 📄 `docs/modules/nm-frontend-split.md` §4)
- **ฐานข้อมูล:** ตาราง `mkt_*` ทุกตัวอยู่ **Main project เท่านั้น** (เหตุผล §7 ข้อ 1)
- **ความสัมพันธ์กับ NPI:** Q-neX คือ**ต้นน้ำ**ของ `npi_projects` — RFQ ที่ได้งานแล้วควรกลายเป็นโปรเจค NPI
  ไม่ใช่สร้างมือซ้ำ (วันนี้ `npi_projects` สร้างมือล้วน)

---

## 2. Q-neX ตามที่ Marketing ออกแบบ — 6 โมดูล (ถอดจากเด็ค + flowchart)

| # | โมดูล | ทำอะไร | UI/ช่องที่ระบุในเด็ค |
|---|---|---|---|
| 1 | **Manual Job Type Selection** | คนเลือกชนิดงานก่อน (human-first) | Process type: `Steel Stamping` / `Plastic Injection` · Priority: Normal 24-48 ชม. / Urgent 12 ชม. / Due date |
| 2 | **OEM Identification & Transformation** | รับไฟล์ RFQ → ระบบเดา OEM จากหัวเอกสาร/อีเมล → โหลด "OEM profile" (กฎ parse · แม่แบบคำนวณ · ฟอร์มใบเสนอราคาของ OEM นั้น) → แปลงเป็นข้อมูลโครงสร้าง | OEM dropdown 13 ค่า (Ford Toyota Isuzu Mazda Honda Mitsubishi Hyundai Nissan BYD Changan GWM MG + Others) · ชนิดเอกสาร 6 แบบ (CPL · Eng Concept & Volume · CAD · Commercial RFQ form · MSOW · MP&L) · **Gatekeeper checklist 14 รายการ** (2D/3D · CAE · DFMEA · ECR/ECN · packaging · tooling CBD · C/F jig · BOM · PFC/op sheet · scrap rate · soft tooling · ED&T …) |
| 3 | **Logic & Computation** | "Automated Assessment" → **Data Selection** (เลือกว่าส่งให้แผนกไหน + ใครเห็นไฟล์อะไร) → แต่ละแผนกส่ง feasibility/cost กลับ → IEC รวม → ถ้าต้อง design change → export package ให้ลูกค้า → MKT pre-review (concept & cost) → **Cost Modeler → Auto-Calculation Engine** | Feasibility: `Feasible` / `Design Changing Request` / `Not Feasible` · checklist gate **บล็อก submit ถ้าขาด** · action: Approve → Auto-calc / Request Rework / Hold / Decline |
| 4 | **Business Review & Selective Rework** | **2 ชั้น: MKT Engineer → MKT Manager** · ตีกลับเลือกแผนกเป้าหมายได้ (IEC · RDPP · R&D · TSAT P.3 · Purchasing) · **เพิ่มเลขเวอร์ชันอัตโนมัติ** · audit trail | Rework reason: Missing doc/spec · Cost exceeds target · Unrealistic CT/SPM · Supplier quote incomplete · Drawing revision |
| 5 | **Customer Feedback Loop** (MKT manual) | ส่ง design package (CBD template · concept design · TS commercial layout) → ผลจากลูกค้า | `APPROVED` / `DESIGN_CHANGE` (→ rework + design version +1) / `DECLINED` |
| 6 | **Award Tracking** | `AWARDED` → คำนวณยอดขายเพิ่ม/ปี (volume × unit price) → Won report → **trigger Production Order (ไป SAP)** → log · `LOST` → เหตุผล + ยอดที่เสีย → Lost report · `CANCELLED` | ไฟล์ตัวอย่าง: Production Order · Model Report |

### 2.1 แผนกที่อยู่ในลูป (จาก flowchart)
`IEC` (รวมผลทุกแผนก + feasibility) · `RDPP` · `R&D (Testing Center)` · `TSAT P.3 (Steel-Al, 980)` · `Purchasing` (supplier quotes · BOP · material price)
⚠️ ในเด็คเขียนเป็น "Dep. API" — ในความเป็นจริงคือ**คนในแผนกนั้นเปิดจอแล้วกรอก** ไม่ใช่ API (§5)

### 2.2 Access matrix (เด็คหน้า 10) — ใครเห็นเอกสารอะไร
| เอกสารใน RFQ | MKT | IEC | RDPP | R&D | TSAT P.3 | Purchasing |
|---|---|---|---|---|---|---|
| 2D/3D CAD · Material spec · BOM/sub-part | แก้ได้ | ดาวน์โหลด | ดาวน์โหลด | ซ่อน | ซ่อน | ซ่อน |
| Volume | แก้ได้ | ดูอย่างเดียว ×5 |
| Sourcing mat. part list · BOP part list | แก้ได้ | ซ่อน | ซ่อน | ซ่อน | ซ่อน | ดาวน์โหลด |
| **Customer target price** | แก้ได้ | **ซ่อนทุกแผนก** |

⇒ นี่คือ**สิทธิ์ระดับ "ชนิดเอกสาร"** ไม่ใช่ระดับหน้า — ESM ทำได้ด้วยคีย์ `role_permissions` ต่อชนิดเอกสาร (§6.3)

### 2.3 สูตรคำนวณมาตรฐาน (เด็คหน้า 16-17) — "ต้องตรง MKT Master Excel 100%" (TC-06)
```
ราคาชิ้น = ① วัตถุดิบ + ② ชิ้นส่วนซื้อ + ③ กระบวนการ + ④ OH & Profit + ⑤ อื่นๆ
① เหล็ก: ((ρ × W × L × T) × ราคา/กก.) − (น้ำหนักเศษ × ราคาเศษ)   · มีเคลือบ: T + ความหนาเคลือบ
   พลาสติก: ราคาเม็ด × น้ำหนักใช้ (รวม % defect/scrap)
② ราคา × จำนวน × handling charge
③ ต่อ operation: DP + LB + indirect LB
   ปั๊ม: DP = (อัตรา DP × CT) / cavity  หรือ (อัตรา DP × ขนาดเครื่อง) / cavity · LB = อัตรา LB × CT · indirect = LB × XX%
   ประกอบ/เชื่อม: DP = อัตรา DP × CT × qty · LB = อัตรา LB × CT × qty
   ฉีด: หาร mold cavity · พ่นสี: หาร qty ต่อ jig
④ OH = Σ(portion#X × XX%) · Profit = (OH × XX%) + Σ(portion#X × XX%)
⑤ packaging · delivery · ED&T · test cost · SAL · MP&L
```
จาก TS Cost Breakdown จริง: อัตรา DP ของงานปั๊มเป็น**ตารางตามชนิดเครื่อง+ตัน** (Transfer / Tandem / Progressive × หลายขนาด)
· OH&Profit ใบตัวอย่าง = 10% ของ sub total · ตามด้วย packaging / transport · export packaging แยก
🔴 **ค่าคงที่พวกนี้ต้องเป็นทะเบียนที่ Marketing แก้เองได้ ห้ามฝังในโค้ด** (หลักเดียวกับ `press_setup_rules` · `skill_exp_config`)

---

## 3. สายธารของจริง — ถอดจากชุดตัวอย่าง FORD (1 พาร์ท BRKT ASY · MY2020 · 3 ชิ้นย่อย + EDP)

| ขั้น | โฟลเดอร์ | เอกสาร | ใครทำ | ความหมายต่อระบบ |
|---|---|---|---|---|
| ① รับ RFQ | `1. RFQ Package` | CPL (PDF) · Engineering Concept Doc & **Volume** (xlsx · APW/MPW/annual) · CAD (.stp zip) · **Commercial RFQ Form = Ford "Global Quotation Cost Detail Sheet"** (xls · 9 ชีท) · MSOW + 26 attachments (spec) · MP&L assumptions (packaging) | ลูกค้า → MKT | ชนิดเอกสาร 6 แบบในโมดูล 2 ตรงกับโฟลเดอร์นี้เป๊ะ · **ฟอร์มต้นทุนเป็นของ OEM** (Ford = PP-P-F104c) ⇒ "OEM profile" = ฟอร์มส่งออกคนละแบบ |
| ② ขอให้ IEC คิด | `2. PPS from CSC(IEC)` | **CRD — Customer Requirement Data** (เลขที่ `MKT1/136/2020` · เรียน ผู้จัดการฝ่าย CSC · "ขอให้ดำเนินการคำนวณราคา") · PPS drawing (process planning) | **MKT → CSC/IEC** | 🔑 **นี่คือใบส่งต่อ Marketing → IEC** — ช่อง "สิ่งที่ต้องการ": Process Standard · ราคาแม่พิมพ์ · ราคา Jig&Fixture · ค่า modify · เครื่องมือทดสอบ · Tooling CBD · มี 3 ลายเซ็น (เจ้าหน้าที่ · ผจก.ส่วน · ผจก.ฝ่าย) + ช่อง "Cost Calculation Sheet No./ผู้ส่ง/ผู้รับ" ขากลับ |
| ③ ทบทวนการผลิต | `3. Manufacturing Review from PE(IEC)` | **F2EC Concept line** (xlsx: volume ±10% · ชม./กะ 9.5 · plan downtime 95 น. · 20 วัน/เดือน · 2 กะ · ประสิทธิภาพ 80% → takt · จำนวน robot/jig) · Packaging concept (1271 domestic/export) | IEC/PE | สูตร takt/capacity ที่นี่ **ซ้ำกับ `shiftCapacity.js`/`companyCalendar.js` ของ ESM** — ถ้าทำในระบบต้องใช้ของกลาง ไม่ใช่ก๊อป Excel |
| ④ ต้นทุน + เสนอราคา | `4. Quotation and CBD` | **TS Cost Breakdown** (internal · 4 ชีท: EQUALISER / ENGINEERING DATA / Tooling&Equipment / PURCHASING DATA · 64 คอลัมน์) · Fleet packaging CBD · **REV05 Ford form (xlsm)** · **Quotation cover** (`MKT1/671/2019 REV.05` · ราคา ex-work / packaging / piece / tooling · เงื่อนไข 4 ข้อ) | MKT (+IEC +Purchasing) | ใบเสนอราคามี**เลขที่ + REV** ⇒ เป็น "บันทึก" ที่ต้องเก็บทุกเวอร์ชัน (กฎ CLAUDE.md §ฟอร์มที่ยื่นออกไปแล้ว) · ชีท ENGINEERING DATA มีช่อง "From Engineering / From Purchasing / From BOM" = ใครเติมช่องไหน |
| ⑤ ได้งาน → เปิดโปรเจค | `5. Document for Kick off` | จาก Ford: **PO** + **TO (Tool Order)** · TS internal: **ใบแจ้งจัดทำ F-MKT-001** (เรียน ผู้จัดการทั่วไปฝ่ายโรงงาน · Part No · **SAP Mat. No. (ว่าง)** · ช่องทางจำหน่าย · ประมาณการขาย/ปี · ผิว/เคลือบ · packing · ผู้สร้างแม่พิมพ์) + **F-MKT-002** (ใบแจ้งรายการชิ้นส่วนประกอบ · make/purchase · customer supply) + **F-MKT-006** (ตาราง milestone DEV/TT/PP/Job#1/OKTB รายเดือน) · **Tooling Budget F-MKT-005** · **Model Report** (สรุป package: Award/Lost · annual sales · tooling · CMBP · %DM) | MKT → โรงงาน | 🔑🔑 **ใบแจ้งจัดทำ = รอยต่อ "NM → โรงงาน" ที่เอกสาร IEC §7.12 บอกว่ายังไม่มีในระบบ — ของจริงมีอยู่แล้วเป็นกระดาษ และ Marketing เป็นคนออก** · Model Report = โมดูล 6 (won/lost) ตรงตัว |

**ข้อสังเกตจากข้อมูลจริง (ต้องถาม §9):**
- CRD ออกเลข `MKT1/136/2020` · ใบเสนอราคา `MKT1/671/2019` · ใบแจ้งจัดทำ `MKT1./366/05/2020` — **running number 3 ชุด** ต่างรูปแบบ (บางตัวมีเดือน) · "MKT1" = Marketing 1 (มีหลายส่วน?)
- ใบเสนอราคา REV.05 แต่ CRD ฉบับเดียว — rework วนที่ชั้นราคา ไม่กลับไป IEC ทุกรอบ
- ใบแจ้งจัดทำระบุ `FTM = 67,387` (ประมาณการผลิต) แต่ Model Report ใช้ volume 10,000 — **ตัวเลข volume มี ≥3 ชุด** (RFQ annual · ประมาณการขาย · ที่ใช้คิดยอด) ต้องรู้ว่าชุดไหนคือของจริงในแต่ละขั้น
- SAP Material No. ในใบแจ้งจัดทำ**ว่าง** ⇒ SAP MAT ถูกออกทีหลัง ⇒ การ "trigger SAP" ในโมดูล 6 ไม่ใช่ของที่ Q-neX ออกเองได้

---

## 4. 🔑 สิ่งที่ค้นพบเมื่อเทียบกับ ESM วันนี้

1. **รอยต่อปลายทางที่หายไป (IEC §7.12) มีฟอร์มจริงอยู่แล้ว** = ใบแจ้งจัดทำ **F-MKT-001/002/006** + งบ tooling **F-MKT-005**
   ⇒ ไม่ต้องออกแบบ "การส่งต่อ" ใหม่ — เอาฟอร์มที่โรงงานคุ้นอยู่แล้วเข้า `/doc-forms` แล้วให้ระบบเป็นคนออกใบ
2. **จุดเริ่มของ IEC มีฟอร์มจริง** = CRD ⇒ "สร้างโปรเจค NPI" ควรเกิดจาก CRD ไม่ใช่กรอกมือ
3. **ESM รู้จักหน่วย Marketing · CSC · RDPP · CIC อยู่แล้ว** ในทะเบียน KPI (`kpi_standard_items` 2026 · `src/utils/kpiSetup.js`)
   แต่**ยังไม่มี role / หน้า / ตารางของพวกเขาเลย** — มีแค่ `engineer_nm` (IEC) กับ `sale` (ขาย-จัดส่ง ซึ่งเป็นปลายน้ำ คนละงาน)
4. 🧵 **Golden thread ที่ขึ้นทันที:** KPI ของ **CSC** ในทะเบียนกลาง =
   *"Error control in process planning — (bidding processes − actual) / actual"* และ *"Error in blank size"*
   ⇒ ตัวเลขที่ IEC ประมาณตอนเสนอราคา (จำนวน process · blank size · CT) **มีตัวจริงอยู่ในฝั่งโรงงานแล้ว**
   (`dr_products` CT · `die_sets` · PFC ใน `pe_doc_sets`) — ถ้า RFQ ↔ NPI ↔ พาร์ทจริงผูกกัน KPI นี้คำนวณเองได้
   (วันนี้ไม่มีใครคำนวณได้เพราะ 3 ฝั่งไม่รู้จักกัน)
5. **สูตร takt/capacity ใน F2EC Concept line** ซ้ำกับ `shiftCapacity.js` + ปฏิทินบริษัท — ของ IEC ใช้ค่าสมมติ (20 วัน/เดือน · 80%)
   ส่วน ESM มีของจริง (ปฏิทิน · OEE จริงของไลน์คล้ายกัน) ⇒ ประมาณการเสนอราคาที่อิงไลน์จริงได้
6. **ESM ไม่มีและไม่ควรทำเองในเฟสแรก:** OCR/auto-classifier เอกสาร OEM · "API" ข้ามบริษัทไป TSAT P.3/RDPP · trigger SAP
   (ESM ไม่มีสะพานไป SAP เลย — 📄 `FINANCIAL-GAP-ANALYSIS`) ⇒ ดู §5

---

## 5. แม็ป Q-neX → ESM — มีแล้ว / ต้องสร้าง / อยู่นอกกรอบ

| ของใน Q-neX | ESM วันนี้ | ต้องทำ |
|---|---|---|
| Login/role/สิทธิ์ 3 ชั้น · approval 2 ชั้น · audit log · in-app notification · คิวงานของฉัน | ✅ มีหมด (`role_permissions` · `can()` · `notification_rules` · `myQueue.js` · traceability) | เพิ่ม role `marketing` (+`marketing_manager`?) · คีย์สิทธิ์ · กฎแจ้งเตือน |
| ทะเบียนลูกค้า (OEM dropdown) | ✅ `customers` (DR) + `useCustomers` picker | ใช้ picker กลาง **ห้ามทำ dropdown 13 ค่าเอง** (CLAUDE.md §5.1.2) · เพิ่ม OEM ที่ยังไม่มีผ่านทะเบียน |
| โปรเจคพาร์ทใหม่ · เฟส · เอกสารส่งมอบ · PPAP | ✅ `npi_*` | ผูก `mkt_rfq → npi_project` (ได้งานแล้วสร้างให้) |
| PFC / PFMEA / CP · มาตรฐานตรวจ | ✅ `pe_doc_sets` · `qa_parts` | ลิงก์จาก NPI อยู่แล้ว |
| ฟอร์มมีเลขที่/Rev/ลายเซ็น (CRD · ใบเสนอราคา · ใบแจ้งจัดทำ · งบ tooling) | ✅ `/doc-forms` + `src/lib/prodProblemDoc.js` (ต้นแบบ "ออกใบ = เขียนทะเบียนก่อนพิมพ์ · พิมพ์ซ้ำ = ใบเดิม") | register F-MKT-001/002/005/006 + CRD + ใบเสนอราคา · running number ต่อชุด |
| ความจุ/takt (Mfg review) | ✅ `shiftCapacity.js` · `companyCalendar.js` · OEE จริง | ให้ IEC เลือก "ไลน์อ้างอิง" แล้วระบบเสนอตัวเลข (คนแก้ได้) |
| เก็บไฟล์ RFQ (PDF/xlsx/CAD zip หลายสิบ MB) | ⚠️ Storage มีแต่กติกาเน้นรูป (`uploadOpts()` · crop) | bucket ใหม่ `mkt-rfq` (Main) · สิทธิ์อ่านต่อชนิดเอกสาร · **CAD zip 28 MB** ต้องดูเพดาน |
| Auto-calc engine (สูตร §2.3) | ❌ | `src/utils/mktCost.js` (pure · มีเทสเทียบกับ Master Excel) + ทะเบียนอัตรา (`mkt_rate_tables`) |
| Data Selection / access matrix ต่อชนิดเอกสาร | ❌ | คีย์ `rfq_doc:<kind>:view/download` + RLS ที่ `has_perm()` ตามชนิด |
| Selective rework + เวอร์ชัน | ❌ | `mkt_rfq_tasks` (แผนกเป้าหมาย · สถานะ · รอบ) · `mkt_quotations.rev` |
| Award / Lost / Model Report | ❌ | `mkt_awards` + รายงานรายปีแบบ Model Report |
| OCR / auto-classify OEM จากอีเมล | ❌ | **นอกกรอบเฟสแรก** — คนเลือก OEM เอง (โมดูล 1 บอกเองว่า human-first) · ไฟล์ติดป้ายชนิดเอกสารตอนอัปโหลด |
| "API" ไปแผนกต่างบริษัท (TSAT P.3 · RDPP · R&D) | ❌ | ถ้าคนพวกนั้นมีบัญชี ESM = เป็น task ในคิวเหมือน IEC · ถ้าไม่มี = **ส่งอีเมล/ไฟล์นอกระบบแล้วมากรอกผล** (ต้องถาม §9) |
| Trigger SAP production order | ❌ | **นอกกรอบ** — ระบบออก**ใบแจ้งจัดทำ** (ของจริงที่โรงงานใช้) แล้วคนไปเปิดใน SAP · เก็บ SAP MAT ที่ได้กลับมาในแถว |

---

## 6. ข้อเสนอโครงข้อมูล (ร่าง — ยังไม่เขียน migration)

ทั้งหมดบน **Main** · prefix `mkt_` · RLS ด้วย `has_perm()` ทุกตาราง · ผูก audit

### 6.1 ตารางหลัก
| ตาราง | หน้าที่ | ช่องสำคัญ |
|---|---|---|
| `mkt_rfqs` | 1 แถว = 1 งานเสนอราคา | `rfq_no` (running) · `customer` (text ตามทะเบียน) · `model` · `process_type` (`steel`/`plastic`) · `priority` · `due_date` · `status` (state machine §6.2) · `target_price` 🔒 · `annual_volume` · `apw`/`mpw` · `sop_date_customer` · `owner_name` · `npi_project_id` (null จนกว่าจะได้งาน) |
| `mkt_rfq_parts` | พาร์ทในงาน (RFQ 1 งานมีหลายพาร์ท/ชิ้นย่อย) | `part_no` · `part_name` · `parent_part_id` (ชิ้นย่อย PIA01-03) · `material_spec` · `thickness` · `qty_per` · `coating` |
| `mkt_rfq_documents` | ไฟล์ที่รับ/ส่ง | `doc_kind` (CPL · eng_concept · cad · commercial_form · msow · mpl · **ตาม checklist 14 รายการ**) · `direction` (in/out) · `storage_path` · `uploaded_by` |
| `mkt_rfq_tasks` | งานที่มอบให้แผนก (แทน "Dep. API") | `dept` (iec/rdpp/rd/tsat_p3/purchasing) · `round` · `status` · `result_kind` (feasibility/cost/quote) · `result_payload` jsonb · `blocked_missing` (รายการที่ gate บอกว่าขาด) |
| `mkt_cost_models` | ผลคำนวณต้นทุนต่อพาร์ท ต่อเวอร์ชัน | `rfq_part_id` · `version` · `inputs` jsonb · `portions` jsonb (①–⑤) · `unit_price` · `tooling_price` · `rate_table_version` |
| `mkt_quotations` | ใบเสนอราคาที่ยื่น (= บันทึก) | `quote_no` · `rev` · `snapshot` jsonb · `oem_form_kind` · `submitted_at` · `approved_by` (MKT Manager) · `customer_outcome` (approved/design_change/declined) |
| `mkt_awards` | ผลสุดท้าย | `outcome` (awarded/lost/cancelled) · `loss_reason` · `annual_sales` (= volume × price · คำนวณตอนบันทึก) · `po_no` · `to_no` · `production_order_no` (F-MKT-001) |
| `mkt_rate_tables` | ค่าคงที่ของสูตร | อัตรา DP ตามเครื่อง/ตัน · อัตรา LB · % indirect · % OH · % profit · ราคาเศษ · density — **มีผลตั้งแต่วันที่ · เก็บประวัติ** |

### 6.2 สถานะของ RFQ (ถอดจาก flowchart)
`received` → `assessing` (tasks เปิดอยู่) → `pre_review` (MKT concept&cost) → `costing` → `quote_review` (Engineer) → `quote_approval` (Manager)
→ `quoted` → `customer_review` → (`design_change` → กลับ `assessing` + design rev+1 | `declined`) → `awarded` / `lost` / `cancelled`
· rework ทุกจุด = เปิด `mkt_rfq_tasks` รอบใหม่ ไม่ย้อนสถานะเงียบๆ

### 6.3 สิทธิ์ — เพิ่มจาก 3 ชั้นเดิม 1 ชั้น: "ชนิดเอกสาร"
- หน้า `page:/rfq` · ปุ่ม `rfq:create` `rfq:assign` `rfq:cost` `rfq:submit_quote` `rfq:approve_quote` (Manager) `rfq:award`
- **ชนิดเอกสาร** `rfq_doc:cad:download` · `rfq_doc:bop:view` · `rfq_doc:target_price:view` ฯลฯ ⇒ matrix §2.2 คือ seed ของ role ละชุด
- ชั้นขอบเขต (ชั้น ③) = แถวที่ `mkt_rfq_tasks.dept` เป็นของเรา (ช่าง/IEC เห็นเฉพาะงานที่ถูกมอบ)

---

## 7. 🔴 กฎที่ล็อกไว้ก่อนเขียนโค้ดบรรทัดแรก

1. **ราคาทุกชนิด (target price · ต้นทุน · ใบเสนอราคา · PO) อยู่ Main เท่านั้น** — DR เป็น anon-open ใครมี key อ่านได้ทั้งตาราง (CLAUDE.md §Supabase Projects · ข้อห้ามเดียวกับ `parts_master`)
2. **ทะเบียนลูกค้า/ซัพพลายเออร์ใช้ picker กลาง** (`useCustomers` · `useSuppliers`) — ห้ามทำ dropdown OEM ของตัวเอง
3. **ฟอร์มที่มีเลขที่ทุกใบ (CRD · ใบเสนอราคา · ใบแจ้งจัดทำ · งบ tooling) = บันทึก** — ออกใบ = เขียนทะเบียนก่อนพิมพ์ · พิมพ์ซ้ำ = ใบเดิม · running = เลขสูงสุด+1 ห้าม `count()+1` · ต้อง register `/doc-forms` **ห้าม hardcode เลขฟอร์ม/Rev/โลโก้**
4. **ค่าคงที่ของสูตรเป็นทะเบียน** (`mkt_rate_tables`) — ห้ามฝัง 10% / 3200 THB ในโค้ด · สูตรอยู่ `src/utils/mktCost.js` ที่เดียว มีเทสเทียบ Master Excel ของ Marketing
5. **ระบบเสนอ คนตัดสิน** — auto-calc ให้ตัวเลข แต่ MKT Engineer/Manager เป็นคนกด approve · feasibility เป็นของ IEC · ระบบไม่เปลี่ยนสถานะเองยกเว้น gate ที่ "บล็อก" (ขาดเอกสารบังคับ)
6. **edition** — ทุกหน้าใหม่เข้า `EDITION_PAGES` ของ `appEdition.nm.js` · ไม่แตก edition · สิทธิ์ยังตัดสินที่ `role_permissions`
7. **ได้งานแล้วไม่ "copy" เข้า NPI/โรงงานเงียบๆ** — ระบบ*เสนอ*สร้างโปรเจค NPI + ออกใบแจ้งจัดทำ · คนกดยืนยัน (ต้นแบบ `pe_master_proposals`)
8. **ตัวเลข volume ต้องบอกที่มาเสมอ** (RFQ annual / APW / ประมาณการขาย) — ห้ามมีช่องเดียวชื่อ "volume"
9. **อ่านไม่ได้ ≠ ไม่มี** — ไฟล์ RFQ โหลดไม่ได้ / rate table ว่าง = เขียนบนจอ ห้ามคืน 0 (กฎความซื่อสัตย์ของจอ)

---

## 8. ลำดับที่เสนอ — ปิดลูปทั้งสายก่อน แล้วค่อยฉลาด

| เฟส | ทำอะไร | ได้อะไร |
|---|---|---|
| **1 · ทะเบียน + รอยต่อ** | `mkt_rfqs`/`parts`/`documents` · หน้า `/rfq` (รายการ + ใบงาน) · CRD → สร้าง/ผูก NPI · Award → เสนอออก **ใบแจ้งจัดทำ F-MKT-001/002** · Model Report (won/lost) · role `marketing` | **สายธารต่อกันครบทั้ง 3 ข้อต่อเป็นครั้งแรก** — RFQ ↔ NPI ↔ พาร์ทจริง · ปิด gap IEC §7.12 ด้วยฟอร์มจริง |
| **2 · มอบงานแผนก + gate** | `mkt_rfq_tasks` · checklist gatekeeper · access matrix ต่อชนิดเอกสาร · คิวงานของฉัน + แจ้งเตือนในแอป | IEC/Purchasing เห็นงานในคิว · ขาดเอกสารบล็อก submit (TC-03/04) |
| **3 · ต้นทุน + ใบเสนอราคา** | `mkt_rate_tables` · `mktCost.js` (①–⑤) · `mkt_cost_models` เวอร์ชัน · ใบเสนอราคา 2 ชั้นอนุมัติ · ส่งออกฟอร์ม OEM (Ford PP-P-F104c ก่อน) | TC-06..11 · ตรง Master Excel |
| **4 · วัดย้อนกลับ** | KPI CSC "bidding vs actual" จาก RFQ ↔ พาร์ทจริง · ประมาณการ takt จากไลน์จริง | golden thread ที่ไม่มีระบบไหนในกลุ่มทำได้ |
| ⛔ นอกกรอบ | OCR/auto-OEM · API ข้ามบริษัท · trigger SAP | รอ user สั่ง / รอสะพาน SAP |

---

## 9. คำถามที่ต้องให้ Marketing / user ตอบก่อนลงมือ

1. **ESM = Q-neX เลยใช่ไหม** หรือ Q-neX มีทีม/ผู้ขายทำแยกแล้ว ESM แค่ต่อ (เด็คมีทีมงาน + timeline ของตัวเอง) — คำตอบเปลี่ยนทุกอย่าง
2. **Timeline & Milestones** (เด็คหน้า 3 อ่านไม่ได้) — เส้นตายของ POC คือเมื่อไหร่ · เฟสไหนก่อน
3. **Master Excel ของ Marketing** ที่ TC-06 บอกว่าต้องตรง 100% — คือ `TS Cost Breakdown.xlsx` ใช่ไหม หรือมีไฟล์แม่อีกตัว · อัตรา DP/LB/OH ปัจจุบันอยู่ที่ใคร
4. **แผนกนอกบริษัท** (TSAT P.3 · RDPP · R&D) — มีบัญชี ESM ได้ไหม หรือทำงานผ่านอีเมล
5. **CSC กับ IEC** — ชื่อเดียวกันไหม (CRD เรียน "ผู้จัดการฝ่าย CSC" · โฟลเดอร์เขียน "CSC(IEC)" · ทะเบียน KPI มีทั้ง 2 หน่วย)
6. **running number 3 ชุด** (CRD · ใบเสนอราคา · ใบแจ้งจัดทำ) — รูปแบบเป๊ะ · รีเซ็ตรายปี? · "MKT1" มีกี่ส่วน
7. **volume ชุดไหนคือของจริงในแต่ละขั้น** (RFQ annual 67k · ประมาณการขาย 471k/7 ปี · Model Report 10k)
8. **SAP** — หลัง AWARDED ใครเปิด production order ใน SAP · SAP MAT กลับมาทางไหน
9. **ใครคือผู้ใช้จริงวันแรก** (กี่คน · MKT1 อย่างเดียว?) — เพื่อ seed role ให้แคบ
10. **ชิ้นงานพลาสติก** — มีชุดตัวอย่างไหม (เด็คมีสูตรฉีด/พ่นสีแต่ตัวอย่างมีแค่เหล็ก)

📄 เกี่ยวข้อง: `docs/IEC-NEW-MODEL-OBEYA-DESIGN.md` §7.12 (รอยต่อ NM→โรงงาน) · `docs/modules/nm-frontend-split.md` §4 (edition) ·
`docs/modules/npi-apqp.md` · `docs/modules/doc-forms.md` · `docs/FINANCIAL-GAP-ANALYSIS.md` (ไม่มีสะพาน SAP)
