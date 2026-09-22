# 🧭 IEC New Model — OBEYA Board ออนไลน์ + Program Project Management

> **สถานะ: สำรวจ/ออกแบบ ยังไม่ลงมือ** (2026-09-19)
> ที่มา: ไวท์บอร์ดคอนเซ็ปต์ IEC 18.09.2026 · ตารางไมล์สโตนรายลูกค้า ·
> **รูปบอร์ด OBEYA จริงของ MODEL 737D MLM (ภาพรวม + ปิดทุกแผง)** · ใบ POP ของรุ่น D02D (maru G)
>
> ⚠️ ถอดจาก**รูปถ่าย** — ตัวเลข/ชื่อคน/ตัวย่อบางจุดอ่านจากภาพ ต้องให้ IEC ยืนยัน (§9)
> ⏳ **รอจาก IEC: work flow การไล่ดูบอร์ด (จากไหน → เจาะไปไหน) เพื่อออกแบบ dashboard** — จะเติมเป็น §8.1

---

## 1. โจทย์

ทีม **IEC (Engineering New Model)** ขอให้ "บอร์ด OBEYA ของ new model เข้าระบบออนไลน์"
ปัจจุบัน = **กระดาษ A3/A4 ปิดผนัง · 1 บอร์ด = 1 รุ่น** (ที่ถ่ายมาคือ `MODEL: 737D MLM`)
~21 แผง แต่ละแผงเสียบ **ป้าย Evaluation กลม G / Y / R** แล้วรวมขึ้น `OVERALL PROJECT EVA`

**ข้อจำกัดจากคำสั่ง user (2026-09-18/19):**
- เว็บนี้**แยกจาก ESM** เป็น project management ของตัวเอง
- ผู้ใช้ = **IEC + supplier ที่อยู่คนละบริษัท** ⇒ คนนอกองค์กรล็อกอินจริง
- ต้อง**ลิงก์ PFC / FMEA / Control Plan** ของ ESM ได้

---

## 2. 🔴 ข้อสรุปเรื่องฐานข้อมูล (ตัดสินก่อนเขียนโค้ดบรรทัดแรก)

วัดจริงบน Main project (`ewhdfqwfwofivojtsizn`) 19/09/2026:

| ตารางทั้งหมด | เปิด SELECT ให้ทุกคนที่ล็อกอิน (`qual = true`) | ไม่เปิด RLS เลย |
|---|---|---|
| 136 | **125** | 3 |

⇒ **ห้ามให้ supplier ล็อกอินเข้า project Main เด็ดขาด** — บัญชีเดียวยิง PostgREST อ่าน `employees`
`profiles` `audit_log` `cost_center_rates` `employee_skills` `daily_production_logs` ได้หมด
หน้าเว็บโชว์แค่ 2 แท็บไม่ช่วย (เปิด DevTools ยิง API เองได้) · ไล่แก้ RLS 125 ตารางเพื่อรับคนนอก
= blast radius ทั้งระบบ (เคยพังมาแล้วตอนแก้ฝั่ง DR แบบเหมา)

**ทางที่เลือก: Supabase project ที่ 3** (`IEC-PM`) auth แยก ตารางแยก
- **ทุกตารางมี `supplier_id`/`org_id` + RLS ต่อ tenant ตั้งแต่แถวแรก ห้าม `using(true)`**
- **ลิงก์ PFC/FMEA/CP ข้าม project ทำ FK ไม่ได้** ⇒ 2 ชั้น
  1. ฝั่ง PM เก็บ **รหัสอ้างอิง + snapshot** (เลขชุด PE, part no, rev, วันที่, สถานะ)
  2. ดูของจริงยิงผ่าน **Edge Function อ่านอย่างเดียวบน ESM** คืนเฉพาะพาร์ทที่มีสิทธิ์
     — supplier ไม่เคยได้ anon key ของ Main
- **`npi_*` ผูกกับ ESM แค่ 4 ตาราง** (วัดจาก FK จริง): `pe_doc_sets` · `qa_parts` · `four_m_logs` ·
  `pe_change_requests` ⇒ ยกไปตั้งระบบใหม่ได้โดยไม่ลาก ESM ทั้งก้อน
- **Trade-off ที่ยอมรับ:** คน TSAT มี 2 บัญชี (ESM / PM) จนกว่าจะทำ SSO

---

## 3. โครงหน่วยงาน IEC (ไวท์บอร์ด 18.09.2026)

| หน่วย | ลูกค้าที่ดูแล |
|---|---|
| ECSC | ทุกลูกค้า (ภาพรวม/ประสานกลาง) |
| PE1 | ISUZU · HONDA · SHONUN *(รอยืนยัน — น่าจะ Shonan)* · TOYOTA · OTHER |
| PE2 | NISSAN · TOYOTA · MMTh · OTHER |
| QE1 | ทุกลูกค้าที่อ้างอิง PE1, PE2 |
| PE3 | FORD · MAZDA · BYD · BMW · OTHER |
| PE4 | FORD · GWM · MG · OTHER |
| QE2 | ทุกลูกค้าที่อ้างอิง PE3, PE4 |

**🔴 TOYOTA อยู่ทั้ง PE1/PE2 · FORD อยู่ทั้ง PE3/PE4** ⇒ ทีม↔ลูกค้าเป็น **many-to-many**
ต้องมีตารางเชื่อม ห้ามเก็บเป็นคอลัมน์ `team` ในทะเบียนลูกค้า · QE ผูกกับ**กลุ่ม PE** ไม่ใช่ลูกค้าโดยตรง

**การนำทางที่วางไว้:** `หน่วยงาน → ลูกค้า → รุ่น → รายละเอียดโปรเจค` · **วัดผล:** ไฟ 🟢🟡🔴 ต่อลูกค้า

---

## 4. ไมล์สโตนรายลูกค้า (ตาราง Excel ของ IEC)

| ลูกค้า | ลำดับด่าน |
|---|---|
| Toyota | CV → 1A → MPT → SOP |
| Isuzu | ETO → K-KEN → 1P → 1PP → AS → PP → SOP |
| Mitsubishi | DCV → PJ → PL → PT → PP → SOP |
| Nissan | ET → VC → PT1 → PT2 → FVC → SOP |
| Ford | DCV → TT → PP → MP |
| Honda | CV/MQ → DUN → RYU → HIN → MP |
| MG · BYD · GWM · Other | รอเติม |

1. **จำนวนด่านไม่เท่ากัน** (Toyota 4 · Isuzu 7) ⇒ ห้ามล็อก 7 คอลัมน์ตายตัว
2. **ด่านจบมี 2 ชื่อ** — SOP / MP ⇒ ต้องมี**ด่านมาตรฐานภายใน**แล้วแมปชื่อลูกค้าทับ
3. ต้นฉบับพิมพ์ผิดแล้ว (`Totota`, `GMW` vs `GWM`) ⇒ ชื่อลูกค้าต้องมาจากทะเบียน
4. โครงนี้ = `npi_templates` + `npi_template_phases` ที่มีอยู่แล้ว **ใช้ต่อได้เลย**

---

## 5. บอร์ด OBEYA 737D MLM — แกะรายแผง

### 5.0 บริบทของโปรเจคนี้
- ลูกค้า **TMT (Toyota Motor Thailand)** · Model **737D** · รุ่นย่อย **MLM**
- **🔑 1 Model มีหลายรุ่นย่อย** — Master Schedule แสดง 2 สาย: **GR-S / P0-8AT** และ **MLM**
  แต่ละสายมีไทม์ไลน์ SPTT ของตัวเอง ⇒ ชั้นข้อมูลคือ `ลูกค้า → Model → sub-project → พาร์ท`
- **พาร์ทหลัก 4 ตัว** (ชุดกันชนหน้า): `52101-YP010` PLATE SUB-ASSY, FR BUMPER REINFORCEMENT ·
  `52104-YP010` COVER SUB-ASSY, FR BUMPER · `52112-YP340` EXTENSION, FR BUMPER RH ·
  `52113-YP340` EXTENSION, FR BUMPER LH

### 5.1 หัวบอร์ด — EVA 3 แกน (ไม่ใช่ดวงเดียว)
ป้าย `OVERALL PROJECT 737D EVA` แบ่ง **3 ช่อง** และให้คะแนนแยกกัน:

| แกน | ค่าที่เห็นในรูป |
|---|---|
| **Result KPI** | 🔴 R |
| **Process KPI** | 🟡 Y |
| **Milestone** | 🟡 Y |

⇒ ระบบต้องเก็บ EVA **3 แกนต่อโปรเจค** ไม่ใช่ field เดียว

**`PROJECT EVA STATUS`** (ตารางเล็กเหนือแผง Organization) = ตัวนับ:

| | Total | CV (EVA/OK/NG) | 1A (EVA/OK/NG) | MPT (EVA/OK/NG) |
|---|---|---|---|---|
| **Main KPI** | | | | |
| **Sub KPI** | | | | |
| **EVA EACH STATE** | | | | |

⇒ นับ KPI หลัก/ย่อยที่ OK vs NG **แยกรายไมล์สโตน** แล้วสรุป EVA ต่อด่าน
(ตรงกับใบ POP ของ D02D ที่นับ 110 sub-KPI แยก 44/66)

### 5.2 Organization
ผังองค์กรโปรเจค: `Customer: TMT / Model: 737D MLM` · หัวเป็น Project Manager → Project Leader →
แตกเป็น ~12 สายงาน (Engineering, Quality Assurance, Production, Production Engineering, Die Maintenance,
Purchasing, Planning, Marketing ฯลฯ) แต่ละกล่องมีชื่อคน-ตำแหน่ง-ติดต่อ · มุมขวามีช่อง Prepared/Checked/Approved
⇒ **ผังคนต่อโปรเจค ไม่ใช่ผังบริษัท** — คนละคนต่อรุ่น

### 5.3 Master Schedule (EVA 🟡)
ใบ `II. SPTT Progress` (ระบุ CONFIDENTIAL — No Photo, No Copy) แกนเวลา **Jan 2026 → Sep 2027**

| สาย | SPTT#1 | SPTT#2 | CV | SPTT#3 | 1A | HVPT | MPT | SOP Readiness |
|---|---|---|---|---|---|---|---|---|
| GR-S / P0-8AT | ก.พ.–เม.ย.69 | มี.ค.–พ.ค.69 | มิ.ย.69 | ก.ย.–ธ.ค.69 | ม.ค.70 ① | ก.พ.70 | มี.ค.70 **Rev.1 Additional MPT (SOP no change)** | พ.ค.–มิ.ย.70 |
| MLM | ก.พ.–เม.ย.69 | มี.ค.–พ.ค.69 | มิ.ย.69 | ก.ย.–ธ.ค.69 | ม.ค.70 ② | ก.พ.70 | – | เม.ย.–มิ.ย.70 |

ตารางล่าง (จุดโฟกัสปัจจุบัน):

| Project | Activity | Milestone | Part Condition | Part Delivery Date (PAD) | Target to complete SPTT#2 |
|---|---|---|---|---|---|
| ① GR-S P0-8AT | SPTT#3 | 1A | OTOP Q100% | 11-Jan-27 | 25-Dec-26 |
| ② MLM | SPTT#3 | 1A | OTOP Q100% | 11-Jan-27 | 25-Dec-26 |

⇒ มีแนวคิด **Focus PJT** (รุ่นที่ต้องจับตาเป็นพิเศษ) + **แผน Rev.** (MPT Rev.1) ⇒ ต้องเก็บประวัติการเลื่อนแผน

### 5.4 EVA Milestone (EVA 🟡) — หัวใจของการวัดผล
ใบ `Milestone status`: พาร์ทเป็นแถว · ไมล์สโตนเป็นคอลัมน์ **และมี "จุดยืนยัน (CF)" ซ้อนข้างใน**

| ด่าน | จุดยืนยัน | วันที่ | เกณฑ์ |
|---|---|---|---|
| CV | CF#1 | 23-Jun-26 | OT 90% (Fitting 100%) |
| CV | CF#2 | 7-Sep-26 | OT 95% (Fitting 100%) |
| CV | CF#3 | 24-Nov-26 | OTOP 100% |
| 1A | – | – | – |
| MPT | – | – | Mass production condition |

สถานะที่เห็น (จุดสี + ตัวเลขเขียนมือ):

| พาร์ท | CF#1 | CF#2 |
|---|---|---|
| 52101-YP010 PLATE SUB-ASSY | 🟢 | 100% |
| 52104-YP010 COVER SUB-ASSY | 🟢 | 100% |
| 52112-YP340 EXTENSION RH | 🟡 | 🔴 + เขียนมือ OT/Fitting ไม่ถึงเกณฑ์ |
| 52113-YP340 EXTENSION LH | 🟡 | 🔴 + เขียนมือ OT/Fitting ไม่ถึงเกณฑ์ |

⇒ **2 พาร์ท EXTENSION คือตัวที่ทำให้ทั้งโปรเจคแดง** (สอดคล้องกับ Develop Color 🔴 และ Kadai 🔴)
⇒ โครงข้อมูล: `(part × milestone × CF checkpoint) → {ค่าที่วัดได้, เกณฑ์, EVA}` — **ต้องเก็บตัวเลขจริง ไม่ใช่แค่สี**

**ใบ `Requirement of SPTT Milestone` (2/28 · PROTECTED) = นิยาม "ผ่าน" ของแต่ละด่าน**

| SPTT | Key Point | Toyota Milestone | Off-Tool | Off-Process | Required Quality | Required Capacity Study |
|---|---|---|---|---|---|---|
| #1 | Ranking, Changing point · All preparation schedule | 3 wks after tooling order issued | – | – | ผ่านกิจกรรม problem prevention & change point management ตามแผน | – |
| #2 | Tooling progress · Off-Tool confirmation · ECI confirmation | CV | ○ | – | Quality 90% (ทุก inspection item) · Fitting OT 100% | – |
| #3 | Off-Tool Off-Process · ECI · Part Evaluation (PESS) · LVPT | 1A | ○ | ○ | 100% (With Grain, evaluation completed) | CT actual ≤ Plan · %Direct OK actual ≥ Plan · %Remain Capacity ≥ 10% |
| #4 | HVPT | MPT | ○ | ○ | 100% (ทุก inspection item) | %OA actual ≥ Plan · %Remain Capacity ≥ 10% |
| SOP Readiness | SOP Readiness | QCS | ○ | ○ | Completed all points | – |
| Initial SOP Control | Special Quality Control · Daily Stock Monitoring | 3 เดือนหลัง SOP | ○ | ○ | Achieved all KPIs with stable production/supply | – |

⇒ **นี่คือ config ของ gate criteria** ที่ระบบควรเก็บเป็นข้อมูล (ไม่ใช่ hardcode) แล้วตัดเกรดอัตโนมัติ

**ใบ `SPTT#3, 4 check sheet` (5/28) — `TMA SPTT Document` = ชุดเอกสารที่ลูกค้าบังคับต่อด่าน**

| Seq | เอกสาร | CV 1st | CV 2nd | 1A (3rd LVPT) | MPT (4th HVPT) | QCS/SOP Readiness | SOP Initial |
|---|---|---|---|---|---|---|---|
| 1 | Changing Point Management (CPM) | 1 | 1 | 1 | 1 | | |
| 2 | Production Preparation Schedule (PPS) | 1 | 1 | 1 | 1 | | |
| 3 | Tool Progress Report (TPR) | 1 | 1 | 1 | 1 | | |
| 4 | Production Process Confirmation Sheet (PPC) | 2 | 2 | 2 | 2 | | |
| 5 | Capacity Planning Study Sheet | 1 | 1 | 1 | | | |
| 6 | Part Evaluation Status Sheet (PESS) | 1 | 1 | 1 | | | |
| 7 | 1st Visit Minute Meeting | 1 | | | | | |
| 8 | Total confirmation sheet | 1 | 1 | 1 | | | |
| 9 | SPTT #2&3&4 check sheet | 7 | 4 | 6 | 7 | | |
| 10 | Final Inspection check sheet | | | | 1 | | |
| 11 | Abnormal part handling sheet | | | | 1 | | |
| 12 | SOP Readiness check sheet | 3 | | | | 3 | |
| 13 | SOP Initial Control | 1 | | | | | 1 |
| | **รวมหน้า** | **22** | **9** | **12** | **12 / 13** | **5** | **1** |

⇒ ตรงกับ `npi_deliverables` (รายการเอกสารต่อเฟส) — เติมแม่แบบ Toyota ชุดนี้ได้ทันที

### 5.5 Project Operation Process (EVA 🟡 + 🟡) — ใบ POP
ติด **2 แผ่น = 1 แผ่นต่อกลุ่มพาร์ท** (แผ่นซ้าย = EXTENSION RH/LH · แผ่นขวา = PLATE SUB-ASSY)
โครงเหมือนใบ POP ของ D02D ที่แกะไว้แล้ว: `KPI / Sub KPI` + `PIC` + `Condition (if any)` +
**คอลัมน์จุด EVA รายแถว (ดำ/เหลือง/แดง)** + Gantt รายสัปดาห์ยาวข้ามปี
รายการ sub-KPI ที่อ่านได้จากแถบข้าง: …57 QCF/QCP · 58 PPAP preparing · 59 PPAP submit ·
59-64 QA document (inspection standard, data sheet, sequence sheet, MICS, MCS, part quality point) ·
72-75 Quality improvement loop #1-#4 · 76-79 SPTT#1 · 80-84 SPTT#2 · 85-93 SPTT#3 · 94-102 SPTT#4 ·
103-106 Part stock in plant (CV/1A/MPT/QCS) · 107 SOP · 108-109 Initial SOP · 110 Project reflection review
⇒ **POP เป็นเอกสารมาตรฐานข้ามรุ่น** (D02D กับ 737D โครงเดียวกัน เลขต่างเล็กน้อย)
⇒ หน่วยของ EVA ที่ละเอียดที่สุดของบอร์ดอยู่ที่นี่: **EVA ต่อ sub-KPI ต่อกลุ่มพาร์ท**

### 5.6 Part Overview (EVA 🟢) — `PART LIST MODEL 737D MLM`
การ์ดพาร์ทเรียงเป็น**ต้นไม้โครงสร้าง** (เลขข้อบอกชั้น): 1 → 1.1, 1.2, 1.3 → 1.3.1, 1.3.2
แต่ละการ์ดมี: รูป · `P/NAME` · `P/NO.` · `SPEC MAT'` และบางตัวมีป้าย **PROGRESSIVE DIE** / `Mat sap`

| # | ชื่อ | เลขพาร์ท | สเปกวัสดุ |
|---|---|---|---|
| 1 | EXTENSION, FR BUMPER, RH | 52112-YP340 | PAINTING (11BK01) |
| 1.1 | BRKT FR BUMPER SIDE RH | 52143-0K010 | SCGA270D 1.4T × 2000 × 790 |
| 1.2 | RIVET | 95113-00610 | – |
| 1.3 | ASS'Y BRKT, FR BUMPER MOUNTING, RH | 52147-0K111 | PAINTING EDP |
| 1.3.1 | BRKT, FR BUMPER MOUNTING, RH | 52147-0K111 | SHGA270D-45 1.27×160×CCOIL · PROGRESSIVE DIE |
| 1.3.2 | NUT WELD M6 | 90174-T0006 | Mat sap 30023006 |
| 2 | EXTENSION, FR BUMPER, LH | 52113-YP340 | PAINTING (11BK01) |
| 2.1 | BRKT FR BUMPER SIDE LH | 52144-0K010 | SCGA270D 1.4T × 2000 × 790 |
| 3 | COVER SUB ASS'Y, FR BUMPER | 52104-YP010 | PAINTING (115V18) |
| 3.1 | BAR FR BUMPER CTR | 52111-YP030 | SCGA270D 1.4T × 1340 × 520 |
| 3.2 | INSERT, FR BUMPER EXTENSION, NO.2 RH | 52117-0K021 | SCGA270D-45 1.2T×145×CCOIL · PROGRESSIVE DIE |

⇒ คือ **BOM tree + สเปกวัสดุ + ชนิดแม่พิมพ์** — เชื่อมกับ BOM ของ ESM ได้ตรงๆ

### 5.7 Material Information (EVA 🟢) — `737D MLM Production Process Confirmation Sheet` (PPC)
Rev.01 (21-May-26) · หัวใบระบุ `Milestone: SPTT1` · `PPC Route: Supp → PN/PE, Cc: PS, QC` + ช่องเซ็น 3 ชั้น
1. **Milestone Summary** — เมทริกซ์ `SPTT#1..#4` × หัวข้อ: Inhouse Production · Purchase Part · Material ·
   Process · Production Place · Tooling Making · G.P or Jig (ช่องแรเงา = ยืนยันแล้ว)
2. **Over all of part structure** — รูปโครงสร้างพาร์ทจริง + หมายเหตุ "Change item on Rev.01"
3. **Supply Chain Declaration** — ตารางใหญ่รายพาร์ท คอลัมน์หลัก:
   `Purchase part (insert/rivet/new item Yes-No/L-T)` · `Material (ชื่อวัสดุ · ขนาด · import · ราคา ·
   **Now Supplier / New Supplier** · new material confirmed?)` · `Material Delivery Route (Supplier→Plant)` ·
   `Process (**Now Production Place / New Production Place**)` · `Tooling Making (**Now / New Tooling Place**)` ·
   `G.P or Jig (ต้องแก้/ทำใหม่ไหม)` · `Change Point present`
⇒ **นี่คือ "จุดเปลี่ยนเทียบรุ่นเดิม" แบบเป็นทางการ** (ของเก่า→ของใหม่ ทุกมิติ) และเป็นต้นทางของแผง CPM

### 5.8 3 แผงที่ใช้ "ตารางเดียวกันเป๊ะ" — CPM · ECI Control List · PPC/ECN Changing
ทั้ง 3 แผงเป็น **ฟอร์มเดียวกัน** ต่างกันแค่หัวเรื่อง (ทุกแผง EVA 🟢 ในรูป):

```
No | Part No. | Part name | Picture ||  CV: Changing(Y/N) Effect Tool(Y/N) Effect Milestone(Y/N) Finished(Y/N) EVA
                                    ||  1A: Changing(Y/N) Effect Tool(Y/N) Effect Milestone(Y/N) Finished(Y/N) EVA
```
- **Changing Point Management (CPM)** — จุดเปลี่ยนของรุ่น
- **ECI Control List** — รายการ ECI จากลูกค้า
- **PPC / ECN Changing** — การเปลี่ยนที่กระทบ PPC/ECN
- ทั้ง 3 ใบ: บล็อก **CV กรอกครบ EVA เขียวทั้ง 4 พาร์ท · บล็อก 1A ว่างทั้งบล็อก**
  ⇒ **ว่าง = ยังไม่ถึงด่าน ไม่ใช่ลืมกรอก** — จอออนไลน์ต้องแยก 2 สถานะนี้ให้ออก (ห้ามโชว์เป็น NG)

⇒ **ทำ component เดียว ใช้ 3 ที่** (ต่างกันที่ `kind`) — ประหยัดงานและทำให้ฟอร์มไม่ drift

### 5.9 Tooling Schedule (มี 2 ระดับ)
**(ก) `Tool Progress Report` (TPR) — รายตัวเครื่องมือ** (EVA 🟢)
หัวใบ: Part Number/Name · Supplier · **Tool Maker + Country** · Tooling/Equipment Name (Die) ·
**C/F Maker** · ECI No. · Plan Revision (Revised date / Die complete / Process complete / C/F complete) ·
**Tooling Type**: ☐1 Unique ☑2 Common ☐3 Symmetry(RH,LH,UPR) ☐3.1 Same ☐3.2 Separate ·
DWG/CAD Received · "This model needs first complete parts on"
ขั้นงาน (แต่ละขั้นมี **3 แถว: Plan / Revise / Actual**):
CAD data receive → Check CAD data & review → Die concept design → Order material → CAM design →
Basic machining → Machining → Assembly insert → Copy finishing → Die assembly → Hard frame & fitting →
TO trial → Confirm data → Stock part → Measured data to TMT · แยกอีกกลุ่ม: Process design ·
Equipment preparation · ปิดท้าย **Latest Picture** (Die design/Copy/Fitting/Supplier/TMT)
ใบเดียวกันใช้กับ **จิ๊กพ่นสีที่ QCC** ด้วย (Jig concept design → Material prep for sample → Making jig sample
→ Trial & confirm → Material prep for mass production → Making jig)

**(ข) `737D Tooling schedule` — ภาพรวมทุกเครื่องมือ** (EVA 🔴)
Gantt ใหญ่ ทุกพาร์ท × ทุกขั้น มีแถบสี + หมุด CV/1A + แถว **Plan / Revise / Result / Comment**
⇒ **TPR เขียวแต่ภาพรวมแดง** = เครื่องมือบางตัวไปได้ แต่ทั้งชุดช้า ⇒ EVA ต้องมีทั้ง 2 ระดับ ห้ามสรุปทับกัน

**(ค) `ACTION PLAN IMPROVE DIE`** — ใบย่อยเมื่อเจอปัญหา (EVA 🟡)
รายพาร์ท (EXTENSION FR BUMPER RH) · ออกโดย PE · **แกนเวลารายวัน (1–31 ส.ค. → ก.ย.)** ·
สัญลักษณ์ ◇ PLAN / ◆ ACTUAL · 14 ขั้น (improve die process, machine position hole, fitting, trial,
improve forming insert OP5, fitting punch, trial, confirm data, improve, trial, confirm data, paint,
appearance check) · มีรูปงานจริง + ตาราง **Quality target** (CF#1/CF#2/CF#3 × dimension/appearance)
+ ประทับ "Update 25/8/26, 31/8/26"
⇒ รูปแบบเดียวกับใบกิจกรรมอื่น แค่ granularity เป็น**รายวัน** ⇒ ระบบต้องรองรับทั้งสัปดาห์และวัน

### 5.10 Develop Color (EVA 🔴)
`QUALITY COAT CO., LTD.` / `SCHEDULE FOR Trial Color 11BK01` · แกน **รายสัปดาห์ Aug'26 W1 → Nov'26 W4**
+ คอลัมน์ `PROGRESS` + `RESPOND`

| # | กิจกรรม | กำหนด | สถานะ | ผู้รับผิดชอบ |
|---|---|---|---|---|
| – | Customer Check Color Shade | 13/8 | Finish | QC TMT |
| 1 | Set plan trial develop appearance 8 set (RH 4, LH 4) | 18/8 | Finish | Ekkatat |
| 2 | QCC EDP + Painting (11BK01) | 25/8 | Finish | Samruay |
| 3 | Check appearance (ผิวส้ม) | 25/8 | Finish | Samruay |
| 4 | Data CPK *E *L *a *b | 25/8 | Finish | Samruay |
| 5 | Thickness check (QCC test) | 25/8 | Finish | Samruay |
| 6 | Thickness check (Nippon test) | 31/8 → 20/9 | On plan | Suriya / Ekkatat |

กล่องคำอธิบายชี้ที่แถว 6: **"Target > Level 2 / Result NG < Level 2"** ⇒ เหตุผลที่แผงนี้แดง
บล็อก **Next Plan**: ส่งชิ้นทดลองพ่นแบบไม่ขัดผิวเทียบขัดผิว R/L 5 set (2/9) → EDP+พ่นสี (2-5/9) →
ตรวจ thickness/shade/ผิวส้ม (7/9) → สรุปข้อมูล+ชิ้นงานส่งลูกค้า TMT-QC (23/9)
⇒ **กฎที่ถอดได้: "เหตุผลที่แดง" ผูกกับแถวที่เป็นต้นเหตุเสมอ** ไม่ใช่โน้ตลอยหัวแผง

### 5.11 Packaging Preparation (EVA 🔴)
Gantt โครงการมีหมุด CV / 1A (Jun'26 → Jun'27) + **Packing plan 8 ขั้น พร้อม PIC**:
เช็คมาตรฐานความปลอดภัย TMT & เทียบ package เดิม → tryout ที่ TMT → review basic spec →
งานภายใน (unplan/investment tool · package calculation · PIRPO) → ทำตัวอย่างบรรจุ → tryout ที่ TMT →
อนุมัติมาตรฐาน + process approval สำหรับ mass production → ทำบรรจุภัณฑ์จริง
ใบแนบ **PACKING SPECIFICATION SHEET**: part no/name · supplier code/name · manufactured company ·
package detail (main structure/dunnage/gateway · new / carry-over) · package weight · part weight ·
volume plan · usage/day · STD pallet vs non-STD · **main change point** (part dimension · material spec ·
impact to new model packaging) + รุ่นเดิม→รุ่นใหม่

### 5.12 Customer Information (ไม่มีป้าย EVA ในรูป)
`Packing List` จาก **TOYOTA Motor Asia (Thailand) — Engineering Information Planning Section**
ถึง THAI SUMMIT AUTOMOTIVE · Supplier Code **TSA1** · Package Number `F0TSA120260330000001` (30/03/2026) ·
Primary Document **Type ECI / Number 098JF0503 / Model Code 098J**
ตาราง: `Doc Type (PKL/DWG/CAD/ECI) · File Name · Pages · Part Number · Routing (DLV/SP) · Part Name ·
Delivery Part · Comments` — พาร์ทในแพ็กเกจรวม 52101-YP010 (DLV) + ชิ้นประกอบ SP อีกนับสิบ
(52521-YP040 RETAINER UPR CTR · 52535/52536-YP090 RETAINER SIDE RH/LH · 52537/52538-0K010 NO.2 RH/LH ·
90080-24007 PIN W/HEAD · 90119-T0301 BOLT W/WASHER · 90174-T0003/T0006 NUT WELD · 90241-06037 PIN W/HEAD)
คอลัมน์ Comments แยก **NEW ADOPTION vs ADDITIONAL ADOPTION**
⇒ คือ **ทะเบียนรับข้อมูลทางเทคนิคจากลูกค้า** (ตรงกับ sub-KPI "Technical data receive" ในใบ POP)
⇒ ออนไลน์ควรเก็บเป็น "data package" 1 แถว + ไฟล์ลูก แล้ว**ลิงก์เข้า ECI Control List อัตโนมัติ**

### 5.13 Capacity Planning (EVA 🟢) — `TMA Capacity Planning Study Sheet`
รายพาร์ท (52143/44-0K010 BRACKET FR BUMPER SIDE RH/LH) · ออก 06/03/2026 · มีโหมด
**Automatic Calculate / Manual Input** · แถวละ 1 กระบวนการ: DRAW · TRIM/CAM TRIM · CAM TRIM/CAM PI ·
SEPACAM PI & CAM CUT · RESTRIKE · CAM FORM · PI & CAM PI · **Painting** · **Assembly**
คอลัมน์เป็นชุด: `Production Line (inhouse/outsource · current/new)` → `Planned Production Schedule`
(shift/day · hours/shift · OT/shift · days/month **ไม่เกิน 26 วัน**) → `Planned Cycle Time`
(hrs/month · cycle time · pcs/cycle · CT/pc) → `Down Time` (**Set-up loss** · **Efficiency loss** ·
**Defect loss**) → `Planned Production Performance` **%OA = 100% − (%Setup + %Efficiency + %Quality loss)`
→ `Planned Working Hour Allocation` (tooling order pcs · time peak · other peak · total workload ·
remain · %remain) → **Judge: Enough / Not Enough**
ค่าที่อ่านได้ตัวอย่าง: 1-2 กะ · 7.6-8 ชม./กะ · OT 2.5-4 ชม. · 22-24 วัน/เดือน · CT 15-72 วิ ·
set-up loss 0-10% · efficiency loss 10-20% · **%OA 70-80%** · %remain 61-67% · ตัดสิน **Enough** ทุกแถว
⇒ **สูตรเดียวกับ OEE ของ ESM** (`src/utils/oee.js` — A/P/Q) ต่างที่นี่คือ "แผนล่วงหน้า" ไม่ใช่ผลจริง
⇒ ของจริงในอนาคตดึงจาก ESM มาเทียบได้ว่า **แผน vs ที่ทำได้จริง** ต่างแค่ไหน (ของที่ E-SPT ทำไม่ได้)

### 5.14 Order Information (EVA 🟢) — `TSAT : Summary order 737D MLM`
`No · Part No. · Part Name · Status · PPR No. · PO No. · V/E · Order Q'ty · Delivery date` +
วันที่ส่งจริงเขียนมือ + จุด EVA · **พาร์ทละ 2 แถว = 2 PPR** (`737DMLM232` / `737DMLM233`)

| พาร์ท | PO (ชุด 1 / ชุด 2) | V/E | Q'ty | กำหนดส่ง |
|---|---|---|---|---|
| 52101-YP010 | 0GTJ6780 / 0JTJ7980 | E | 4 | 29/06/2026 |
| 52104-YP010 | 0GTJ6730 / 0JTJ7930 | E | 4 | 29/06/2026 |
| 52112-YP340 | 0GTJ6710 / 0JTJ7910 | E | 4 | 29/06/2026 |
| 52113-YP340 | 0GTJ6720 / 0JTJ7920 | E | 4 | 29/06/2026 |

⇒ ออเดอร์ชิ้นตัวอย่างต่อด่าน (ไม่ใช่ออเดอร์ผลิตจริง) — ส่งครบ EVA เขียวทุกแถว

### 5.15 Previous Reflection (EVA 🟢)
**อีเมลจริงพิมพ์แปะ**: 17 มิ.ย. 2026 · เรื่อง `Vision Tool 262962 - TOYOTA Model 737D MLM (098J) -
Extension, FR Bumper - die design review OP10 OP20 OP50`
เนื้อหา: "ถ้าเป็นก้อน Insert ต่อกัน จะเป็นปัญหาหลัง Mass production" + รูปชิ้นงาน 2 รูป + ไดอะแกรม
`Insert A | Insert B` + หมายเหตุ **"ชิ้นงานเป็นรอยขีดเส้น เนื่องจาก insert dies ต่อกันไม่แนบสนิท"**
และ **"R ใหญ่เกินไป"**
⇒ บทเรียนจากรุ่นก่อนถูกเก็บเป็น**อีเมล + รูป** ⇒ ออนไลน์ต้องรับ "บทเรียน 1 เรื่อง = ข้อความ + รูป +
ผูกกับพาร์ท/OP/เครื่องมือ" และ**ค้นเจอตอนขึ้นรุ่นใหม่** (นี่คือ yokoten ที่ ESM ทำไว้แล้วฝั่ง 8D→PFMEA)

### 5.16 SPTT — `COMMODITY RISK MITIGATION / SPTT PLAN & STRATEGY`
รายพาร์ท (52112-YP340 EXTENSION FR BUMPER RH) · Supplier TSAT · Plant TSA7 · **Ranking H / M / M**
(New tooling requirement · New surface treatment ICR+Color shade 11BK01 · High MC ratio (10%) of painting…)
โครง: `Risk Classification` (Man/Supplier · Machine/Tooling · Method/Process · Material/Product ·
Special Control · Management/Other) × `What is Risk` × `Key Tracking Items (how to prevent risk)` ×
`PIC` × **`Confirmation Stage` (ไทม์ไลน์ติ๊กต่อด่าน)** × `Remark` × `EVA`
หัวข้อย่อยที่อ่านได้: New Tier 2 · New Trial Maker · New M&T Supplier · New Factory · New Machine/Equip ·
New Facilities · New Process · New Test/Measurement · New Evaluation · New Treatment · New Material ·
New Part Structure · Setting Registration · CMK field · UGRP? · R&M/Repair · Others
+ บล็อก Background (Product / Process information) + ผัง Tier supplier + **Roles & Responsibilities (PIC)**
⇒ คือ **ทะเบียนความเสี่ยงของโปรเจค** ที่ผูกกับด่าน — แนวเดียวกับ PFMEA แต่มองระดับ "โครงการ/ซัพพลาย"
ไม่ใช่ระดับ "กระบวนการ" ⇒ **จุดเชื่อมกับ PFMEA ของ ESM ที่ชัดที่สุด**

**ใบแนบ `737D MLM 1st Visit Meeting Minute`** (TSA) — ตารางรายพาร์ท: `T/D · Technical info (DWG/CAD/
Drawing) · Project&Tool (DTS/Maker/L-T) · CPM · QC (C/F, ATS) · EVA (Milestone)` + ช่อง **Problem /
Countermeasure / PIC / DUE** + สเกลให้คะแนน **1 Satisfy requirement · 2 Good · 3 Fair ·
4 Not enough information · 5 No any preparation** + ผังใยแมงมุมสรุป (Supplier/QC/Design/PJ/PE)

### 5.17 Supply Chain
`737D MLM Tooling supply chain` — แถวแบ่งเป็น **1st Tier / 2nd Tier / Die / Jig / C/F**
บนสุด `TMA → TSA1-A (THAI SUMMIT AUTOMOTIVE)` → `Maru A` → แตกลงเป็นผู้ทำเครื่องมือ (เห็น TSAT-P3 ฯลฯ)
แต่ละโหนดมีกล่องบอกจำนวน/สถานะ · มุมขวามีตาราง `Part delivery = 4 parts` (Part/Schedule/Achievement/QTY)
และ `Tooling QTY (Level)` แยก Die / Jig / C/F
⇒ ผังนี้ตอบ "ใครทำอะไร กี่ชิ้น อยู่ tier ไหน" — เป็นแผงที่**ต้องให้ supplier เห็นและอัปเดตเองได้** (เฟส 4)

### 5.18 Kadai (EVA 🔴) — `Kadai Sheet`
คอลัมน์: `No · Issue Date · Problem Category (Tooling / Quality / Process ติ๊ก) · Issue · Cause ·
Countermeasure · Responsible · Target · Dept · Status (สัญลักษณ์วงกลม) · Remark/Actual`
เนื้อหาจริง 4 รายการ (เขียนมือ):

| # | วันที่ | หมวด | ปัญหา | สาเหตุ | มาตรการ | ผู้รับผิดชอบ / กำหนด | หน่วย |
|---|---|---|---|---|---|---|---|
| 1 | 31/8/26 | Tooling | แม่พิมพ์แตกบิ่น ทำให้งานหยุด | ทำ stock ไม่ได้ตามแผน | recover เวลาเข้าแก้ die แล้วใช้ OT ตามแผนผู้ผลิต | K.? · 3/9/26 | DM |
| 2 | 7/9/26 | Process | Rack prototype delay ไป TNT SR 1/10/26 | เอกสาร investment plan ของ rack version ใหม่ยังไม่ครบ ทำเอกสารไม่ทัน | เร่ง GA ทำเอกสารเสนอ director อนุมัติ | K.Sittisak · 3/9/26 | PE |
| 3 | 7/9/26 | Quality | หน้างานขาด WI มาตรฐาน | ยังไม่มี WI ที่ QCC ใช้ร่วมกัน | ให้ QCC develop มาตรฐาน + layer ตรวจ แล้วทำ WI | K.Sittisak 14/9 · K.Samruay 23 | PE / QA |
| 4 | 14/9/26 | Quality | Delay TJ (52143/144) คุณภาพ < 90% | ทำได้ ~70-89% | จัดทำ action plan ทั้งหมด + recovery plan | K.Sittisak · 16/9/26 | PE |

สถานะใช้**สัญลักษณ์วงกลมแบบญี่ปุ่น** (ทึบ / ครึ่ง / กากบาทในวง) ⇒ ต้องถอดเป็น enum ให้ชัดตอนทำระบบ
⇒ โครงเดียวกับ `meeting_action_items` ของ ESM ทุกประการ

### 5.19 Activity Audit / Meeting Minutes
- `737D Follow up — Co-check shade develop#3 at TMT`: ตารางพัฒนาเฉดสี + **รูปงานจริงพร้อมผลวัด** 3 บล็อก
- `Minute meeting 09-04-2026`: รายการ 8 ข้อ + `Due date` + **`PIC` เป็นหน่วยงาน** (TSA-QA · TSA-PE ·
  TSA-QA/PUR · TSA-PUR) เช่น ขอเอกสาร SDS+ATIS ราย part no (15/04, 15/04, 02/05) · ขอ feedback part data
  CF Ex.Bumper · ขอแผนจัดทำ CF เพื่อประกอบใน master plan · ขอเอกสาร SPTT#1 + risk mitigation ·
  ขอผล painting process evaluation ที่ QCC · confirm จำนวน painting jig · confirm L/T ทดสอบ Xenon method
  (accelerated weathering resistance testing) กับ NPT
  ท้ายใบมีคำขวัญ **"Before We Build Parts, We Build People"**
- minute เขียนมือ: `TOPIC: TOYOTA 737D, COLOR DEVELOPMENT (11BK013 / 115V18)` 27 Feb 26 —
  ว่าด้วย EXTENSION RH/LH และ COVER SUB ASSY, การ repaint, กำลังผลิตที่ TSA ขอ, รายชื่อผู้เข้าร่วม
- ใบลงชื่อเข้าประชุม (Attendance) แนบท้าย
⇒ ระบบต้องมี "มติที่ประชุม = รายการงาน + due + PIC" ที่**ไหลเข้า Kadai/งานค้างอัตโนมัติ** ไม่ใช่แค่ไฟล์แนบ

### 5.20 ⭐ แถบ `UPDATE STATUS` — วินัยที่ซ่อนอยู่
**ทุกแผ่นมีแถบเล็กๆ ด้านบนแบ่งเป็นช่องรายสัปดาห์ตลอดอายุโปรเจค** ให้ติ๊กว่าอัปเดตแผ่นนี้แล้วหรือยัง
(บางแผ่นติ๊ก ✓ บางช่องกา ✗) ⇒ ออนไลน์ได้ฟรีจาก `updated_at` + คนที่แก้ล่าสุด และ**เตือนอัตโนมัติ**
เมื่อแผงค้างเกิน N สัปดาห์ — **นี่คือข้อได้เปรียบที่เห็นผลเร็วที่สุดข้อหนึ่ง**

---

## 6. 🔑 บอร์ด 21 แผง มีแค่ **5 รูปทรง** + 2 ชั้นครอบ

| รูปทรง | ใช้กับแผง | โครงข้อมูล |
|---|---|---|
| **A. ใบกิจกรรม** (สัปดาห์/วัน) | Master Schedule · POP · Tooling Schedule · TPR · Action Plan Improve Die · Develop Color · Packaging Prep | กิจกรรม + PIC + **Plan / Revise / Actual** + แถบเวลา + progress + EVA รายแถว |
| **B. เมทริกซ์พาร์ท × ด่าน** | **CPM · ECI Control List · PPC/ECN Changing (ฟอร์มเดียวกัน)** · EVA Milestone · Part Overview | (part × milestone × checkpoint) → ค่า/ตัวเลขจริง + เกณฑ์ + EVA · **ว่าง ≠ NG** |
| **C. ทะเบียนปัญหา/งานค้าง** | Kadai · Meeting Minutes (action) · SPTT risk mitigation · Activity Audit | ปัญหา · หมวด · สาเหตุ · มาตรการ · PIC · due · status — **โครงเดียวกับ `meeting_action_items`** |
| **D. เอกสาร/ฟอร์ม + รูป** | Customer Information · Previous Reflection · Organization · Material Info (PPC) · Order Info · Packing Spec Sheet · Capacity Study | ฟิลด์หัวเอกสาร + ตารางเนื้อใน + ไฟล์/รูป + revision |
| **E. ผังโหนด (tier map)** | Supply Chain · Organization chart | โหนด + tier + เส้นเชื่อม + ตัวนับต่อโหนด |

**ชั้นครอบที่ 1 — EVA:**
- **ต่อแถว** (sub-KPI ในใบ POP, แถวใน Kadai) → **ต่อแผง** (ป้ายกลม G/Y/R) →
  **ต่อโปรเจค 3 แกน** (Result KPI / Process KPI / Milestone) → **ต่อลูกค้า** (ไฟเขียว-เหลือง-แดง ตามไวท์บอร์ด)
- **ต้องเก็บ "ตัวเลขจริง + เกณฑ์" ไม่ใช่เก็บแค่สี** (เช่น OT 95% vs เกณฑ์ 95% · %Remain capacity ≥ 10%)
  เพราะเกณฑ์อยู่ในใบ `Requirement of SPTT Milestone` อยู่แล้ว ⇒ **ให้ระบบตัดสีเอง คนกดทับได้พร้อมเหตุผล**
- **เหตุผลที่แดงต้องผูกกับแถวต้นเหตุ** (แบบกล่อง "Result NG < Level 2" ในแผง Develop Color)

**ชั้นครอบที่ 2 — ความสด:** UPDATE STATUS ต่อแผง (ใครแก้ล่าสุดเมื่อไหร่ + เตือนแผงค้าง)

**สิทธิ์ 3 ชั้น:** IEC ภายใน (ทุกแผง) · หน่วยงานร่วม TSAT (เฉพาะแผงตัวเอง) ·
**supplier (เห็นเฉพาะพาร์ท/tooling ของตัวเอง — ห้ามเห็น Capacity Planning, ราคา, และงานของ supplier อื่น)**

---

## 6.5 🏭 Supplier อัปเดตงานของตัวเอง (คำสั่ง user 2026-09-20)

**เปลี่ยนน้ำหนักของทั้งระบบ:** จาก "IEC พิมพ์ตามที่คนอื่นส่งมา" เป็น "เจ้าของงานกรอกเอง"
⇒ ข้อสรุป §2 (แยก Supabase project + RLS ต่อ supplier) **กลายเป็นข้อบังคับ ไม่ใช่ทางเลือก**

### จุดที่ supplier แตะได้จริง (ไล่จากบอร์ด 737D)

| แผง | ใครคือ supplier ในรูป | สิ่งที่เขากรอก |
|---|---|---|
| **Tool Progress Report (TPR)** | TSAT-P3 (die) · QCC (jig พ่นสี) · TSOP-Plant2 (C/F) | **ช่อง Actual ของ 15 ขั้น** + % คืบหน้า + **รูป Latest Picture** (die design/copy/fitting) |
| **Develop Color** | QUALITY COAT (QCC) | ผลทดลองพ่นแต่ละรอบ (thickness · shade · ผิวส้ม · CPK) + วันที่ทำจริง |
| **Packaging Preparation** | ผู้ทำบรรจุภัณฑ์ | ความคืบหน้าทำตัวอย่าง/ทำจริง + packing spec sheet |
| **Supply Chain** | ทุก tier | ยืนยันโหนดของตัวเอง + จำนวน die/jig/CF ที่รับผิดชอบ |
| **Material Information (PPC)** | ผู้ขายวัสดุ/ชิ้นส่วน | ประกาศ material · now/new supplier · production place · L-T |
| **Order Information** | ผู้ส่งชิ้นตัวอย่าง | วันส่งจริงต่อ PPR/PO |
| **Kadai** | ผู้ถูกมอบหมาย | ความคืบหน้ามาตรการที่ตัวเองรับไป (ตอบ ไม่ใช่เปิดใหม่เอง) |

### 🔴 กฎเหล็ก 6 ข้อ (ตกผลึกจากฟอร์มกระดาษ + บทเรียน ESM)

1. **Plan / Revise / Actual เป็นคนละเจ้าของ** — ฟอร์ม TPR มี 3 แถวนี้อยู่แล้ว ไม่ใช่เรื่องบังเอิญ
   · **Plan = IEC/PE ตั้ง supplier แก้ไม่ได้**
   · **Revise = supplier "ขอเลื่อน" → IEC อนุมัติ** (การเลื่อนแผนคือสิ่งที่ฆ่าโปรเจค ต้องมีคนกดรับรู้เสมอ)
   · **Actual = supplier รายงานได้เอง**
2. **supplier รายงาน "ข้อเท็จจริง" — ห้ามให้ supplier ตั้งไฟ G/Y/R ของตัวเอง**
   ไฟมาจากเกณฑ์ (§5.4) หรือ IEC ตัดสิน · หลักเดียวกับ ESM: *ระบบเสนอ คนตัดสิน* / *เครื่องบอกข้อเท็จจริง คนบอกเหตุผล*
3. **มองเห็นเฉพาะแถวของตัวเอง — ไม่ใช่เฉพาะหน้าของตัวเอง** ⇒ RLS ระดับแถวด้วย `supplier_id`
   **ห้ามเห็นเด็ดขาด:** งานของ supplier เจ้าอื่น · Capacity Planning (กำลังผลิต/ต้นทุน) · ราคาใน PPC ·
   ผังองค์กร+เบอร์ติดต่อภายใน · โปรเจคของลูกค้าอื่น
4. **เลื่อนแผนหรือรายงานช้ากว่าแผน → ระบบตั้งร่าง Kadai ให้อัตโนมัติ ส่ง IEC ตัดสิน** ไม่ใช่เงียบ
   (บทเรียน 4M อัตโนมัติ: อะไรที่ระบบสร้างเอง ต้องมีคนเห็นและปิดได้ ห้ามกองเงียบ)
5. **ทุกการเขียนของ supplier ต้องลง audit (ใคร/เมื่อไหร่/ค่าเก่า→ใหม่)** — เอกสารชุดนี้ใช้อ้างความรับผิดชอบ
   เรื่องความล่าช้ากับคู่ค้า ไม่ใช่บันทึกภายในเฉยๆ
6. **รูปต้องผ่านตัวย่อ/ครอปก่อนอัป + ตั้ง cacheControl** — TPR มีช่องรูปทุกขั้น × ทุกเครื่องมือ × ทุกรุ่น
   (ESM เคยทำ egress ทะลุโควต้าจนทั้ง organization ล็อกมาแล้ว — ห้ามพลาดซ้ำกับคนนอกที่คุมไม่ได้)

### ความจริงหน้างานที่ต้องออกแบบเผื่อ
- ผู้ทำแม่พิมพ์หลายเจ้าเป็นร้านเล็ก **ไม่ล็อกอินทุกสัปดาห์** ⇒ หน้าจอ supplier ต้อง**สั้น มือถือกรอกได้ ช่องน้อย**
  + เตือนอัตโนมัติ (อีเมล/LINE) + **มีทางให้ IEC กรอกแทนได้โดยติดป้ายว่า "IEC กรอกแทน X"** ห้ามปลอมเป็น supplier กรอกเอง
- บัญชี supplier ต้อง **ปิดได้เมื่อจบสัญญา** และรองรับหลายคนต่อบริษัท (ห้ามแชร์บัญชีเดียว — audit จะไร้ความหมาย)
- ต้องมีสถานะ **"ยังไม่เคยเข้าใช้"** แยกจาก "เข้าแล้วแต่ไม่อัปเดต" — คนละปัญหา คนละวิธีแก้

### คำถามเพิ่มสำหรับ IEC
10. supplier รายไหนพร้อมใช้จริงในเฟสแรก (TSAT-P3 / QCC / TSOP-Plant2 ?) และมีกี่บริษัทรวม
11. ยอมให้ supplier เห็น "แผน (Plan)" ทั้งเส้นไหม หรือเห็นเฉพาะงานของตัวเอง + วันที่ต้องส่ง
12. การขอเลื่อนแผน (Revise) ใครเป็นคนอนุมัติ — PE เจ้าของงาน หรือหัวหน้า IEC
13. supplier ต้องอัปโหลดเอกสาร SPTT (13 ใบตาม §5.4) เข้าระบบด้วยไหม หรือยังส่งอีเมลเหมือนเดิม

## 6.6 ⚠️ ZUMEN — ระบบของผู้ขายที่ TSAT กำลังพิจารณาอยู่ตอนนี้ (2026-09-22)

IEC ส่งมา 3 ไฟล์: สไลด์ `260610-ZUMEN Demo Prep` (32 สไลด์ · Mr. Surasak Setsin, Acting GM TSAT-HQ/IEC,
10 มิ.ย. 2026) · โบรชัวร์ไทย `Document No.7TH` (20 หน้า) · เมล forward บัญชีเดโม `demo.zume-n.com`
(ผู้ส่ง Sale & MKT TSAT Plant 3 · **มี user/password อยู่ในเมล — ควรเปลี่ยนรหัสและอย่าเวียนต่อ**)

**ZUMEN = ระบบควบคุมเอกสารที่มี "แบบ (Drawing)" เป็นแกนกลาง** โดย **Fact Base Inc.** (ญี่ปุ่น ·
ก่อตั้ง 1 ก.ย. 2022 · พนักงาน 280 คน · ผู้ถือหุ้น JAFCO, Mizuho Capital, Resona Capital, MUFG Capital ·
มีสาขาเวียดนาม/ฟิลิปปินส์)

| ความสามารถของ ZUMEN | เราทำเองคุ้มไหม |
|---|---|
| **Preview CAD 2D/3D บนเบราว์เซอร์ ไม่ต้องมี CAD** | ❌ ไม่คุ้ม — ต้องมี CAD kernel/ตัวแปลงไฟล์ |
| **ค้นแบบที่ "รูปทรงคล้ายกัน" ด้วย AI** | ❌ ไม่คุ้มในระยะนี้ |
| **ดึงข้อมูลจากช่องหัวแบบเข้าระบบอัตโนมัติ (OCR)** | ⚠️ ทำได้แต่ใช้เวลา |
| **บริการลงทะเบียนแบบให้ (ศูนย์คีย์ข้อมูลที่โตเกียว/โอซาก้า)** | ❌ นี่คือ "บริการ" ไม่ใช่ซอฟต์แวร์ |
| แนบไฟล์ทุกสกุลเข้ากับแบบ + คุมเวอร์ชัน | ✅ มีแล้ว (`doc_forms`, `npi_drawing_revisions`) |
| ถ่ายรูป/วิดีโอ/เสียงหน้างานผูกกับแบบ | ✅ มีแล้ว (ต้องผ่านตัวบีบรูป) |
| สถานะโครงการ/คำสั่งซื้อ + ออกใบเสนอราคา | ✅ มีแล้วและ**ลึกกว่า**ในบริบท TSAT |
| **เกณฑ์ SPTT#1-4 · CF#1/2/3 · EVA 3 แกน · Kadai · %OA · ผูก PFMEA** | ❌ **ZUMEN ไม่มีและไม่รู้จัก** |

**ค่าบริการ (จากโบรชัวร์ + สไลด์ 22):** เปิดระบบปีแรก 80,000 THB + รายเดือน 7,000 THB
⇒ **ปีแรก 164,000 THB · ปีถัดไป 84,000 THB** (ยังไม่รวม VAT · รวม royalty tax 15%)
· ผู้ใช้ไม่จำกัดจำนวน **แต่คิดต่อ "พื้นที่การผลิต"** ⇒ ขยายหลายโรงงาน = คูณจำนวนโรง

**สถานะโครงการ (สไลด์ 31 · ตัดสินเดือนนี้พอดี):**
28-29 พ.ค. road show → มิ.ย. EVP มอบหมาย IEC เตรียมเดโม → 1-15 ก.ค. ประชุมทีม + เตรียมข้อมูล →
ส.ค. ตรวจข้อมูล + ZUMEN แนะนำตั้งเดโม → **ก.ย. เสนอ EVP → EVP ตัดสิน → สรุปจบ**
· เคสเดโมใช้ **TSAT2 (NISSAN / P02H)** · นำร่องที่ TSAT3

### 🔴 จุดชนที่ต้องตัดสินให้ชัด
วัตถุประสงค์ข้อ 2 ในสไลด์เขียนว่า **"ให้ ZUMEN จัดทำ Dashboard ให้ TSA ตั้งแต่ต้น-จบ กระบวนการทำงานใหม่"**
ซึ่ง**ทับกับบอร์ด OBEYA ออนไลน์ที่ IEC ขอจากเราตรงๆ** ⇒ ถ้าปล่อยไว้จะได้ **dashboard 2 ตัว 2 ความจริง**
(บทเรียนเดียวกับกฎ "ห้ามให้ระบบภายนอกคำนวณ OEE เองแล้วเอาเลขมาโชว์" ใน CLAUDE.md)

**เส้นแบ่งที่เสนอ — แบ่งตาม "ใครเป็นเจ้าของความจริง" ไม่ใช่แบ่งตามฟีเจอร์:**
- **ZUMEN = คลังไฟล์/แบบ (system of record ของ "เอกสาร")** — เก็บไฟล์ ค้นหา คุมเวอร์ชัน preview CAD
- **IEC-PM ของเรา = สถานะ/ความคืบหน้า (system of record ของ "งาน")** — EVA, เกณฑ์ SPTT, Kadai,
  ตารางความรับผิดชอบ, supplier อัปเดตงาน
- **เชื่อมกันด้วยลิงก์ + เลขเอกสาร ไม่ใช่ก๊อปไฟล์ข้ามระบบ** — บอร์ดของเราเก็บ "เลขแบบ + rev + ลิงก์ไป ZUMEN"
  ⇒ กดจากแผงบนบอร์ดเปิดแบบใน ZUMEN ได้ทันที · **ห้ามมีไฟล์ 2 ชุด 2 ที่**
- **ถ้า EVP เลือกให้ ZUMEN ทำ dashboard ด้วย** → เราควรหยุดทำส่วนที่ซ้ำ แล้วโฟกัสสิ่งที่ ZUMEN ทำไม่ได้
  (ผูกกับ PFMEA/Control Plan, OEE จริง, 4M, สายธารความต้องการของ ESM) — **ต้องรู้คำตอบก่อนเริ่มเฟส 0**

### 🎁 ของที่ได้ฟรีจากสไลด์ ไม่ว่าผลตัดสินจะออกทางไหน
สไลด์ 28-30 ให้ **รายการเอกสารที่ต้องมีต่อหน่วยงาน ครบทั้งวงจร new model 14 หน่วยงาน + Maker**
(เป็นสิ่งที่สเปกนี้ยังขาดใน §7) — ควรยกมาเป็นแม่แบบ `npi_deliverables` ตรงๆ:

| # | หน่วยงาน | เอกสารที่ต้องมี |
|---|---|---|
| 1 | MKT | Dwg (2D, 3D) · Technical File · ใบแจ้งจัดทำ · Budgeting |
| 2 | ECSC | (ศูนย์ประสาน) |
| 3 | RDPP | Simulation Forming |
| 4 | IEC (PE/QE) | Die Order Sheet · Concept Jig/CF · Investment unplan · M&E List · Tooling List · Static & Dynamic · Packing Design · Inspection Std · ใบส่งมอบ Tooling |
| 5 | PUR | Maker Layout · สัญญาว่าจ้าง · PO Tooling |
| 6 | ACC | IO (Tooling) · ข้อมูลการลงทุนของโครงการ |
| 7 | PLANT | PR (Tooling/MC) · ไฟล์นำเสนออนุมัติจาก EVP · ข้อมูล Asset |
| 8 | PROD | ข้อมูลประวัติปัญหาที่เคยเกิด · Cost Center / Work Center |
| 9 | PE/QA | เอกสาร PM · QCF/P · **PFMEA** · SOP · **SAP (BOM)** · Data Record · Quality Issued |
| 10 | PLN | เอกสารสั่งซื้อวัตถุดิบ · ข้อมูล Kanban |
| 11 | WH | Q-Point (Packing) · ข้อมูลชิ้นส่วนสำหรับส่งลูกค้า · Packing Std. |
| 12 | SALE | Mat No. SAP · Pricing FG · เอกสารบิล · เอกสารรอบการส่ง |
| 13 | CIC | ข้อมูลการตรวจรับบิล |
| 14 | INT | ข้อมูล Tooling / MC |
| – | **Maker (Die/Jig)** | Die layout · Die design · Quotation · Tooling picture · Data by lot · Sample approve · PO · Invoice |

**แบ่งเป็น 2 สเตจตามสไลด์ 30:** `RFQ Stage` (5 โฟลเดอร์) → `AWARDED Stage` (6 โฟลเดอร์)
โดยเอกสารชุดเดียวกันจะเปลี่ยนสถานะเป็น **Approved/Controlled** เมื่อข้ามมาสเตจ AWARDED
⇒ ยืนยันกฎที่เราวางไว้แล้วว่า **เอกสารมีสถานะ draft → controlled** และ **ควบคุมเวอร์ชัน** เสมอ

## 7. เทียบกับของที่มีใน ESM (`npi_*` 13 ตาราง)

**ใช้ต่อได้ทันที:** `npi_projects` · `npi_parts` · `npi_templates` + `npi_template_phases` (= §4 เป๊ะ) ·
`npi_part_phases` (plan/actual) · `npi_tooling_plans` + `npi_tooling_steps` (มี `progress_pct`) ·
`npi_deliverables` (= ตาราง TMA SPTT Document §5.4) · `npi_change_requests` (ECI) ·
`npi_drawing_revisions` · `npi_tasks`

**ต้องทำใหม่:**
- ชั้น **หน่วยงาน/ทีม IEC** + แมปทีม×ลูกค้า (m:n) · ทะเบียน **ลูกค้า / Model / sub-project**
  (ตอนนี้ `npi_projects.customer/model` เป็น text และ**ยังไม่มีชั้น sub-project** ที่ Master Schedule ต้องใช้)
- **EVA 3 แกน + EVA รายแถว/รายแผง + เกณฑ์ตัดสิน + ตัวนับ Main/Sub KPI ต่อด่าน**
- **CF checkpoint ซ้อนในไมล์สโตน** (CV → CF#1/CF#2/CF#3 พร้อมวันที่และเกณฑ์ OT%/Fitting%)
- **Plan / Revise / Actual 3 ชั้น** (ของเรามีแค่ plan/actual)
- เครื่องมือ **A** แบบทั่วไป · **B** เมทริกซ์ (3 แผงใช้ร่วม) · **C** Kadai · **E** ผัง tier
- แผงที่ยังไม่มีที่เก็บ: Material Info (PPC/supply chain declaration) · Capacity Planning ·
  Customer Information (data package) · Previous Reflection · Order Information · Packaging + spec sheet ·
  Organization chart · Line layout · Investment/Equipment · Standard parts · SAP (BOM, Routing)
- **ตารางความรับผิดชอบรายกิจกรรม** (เจ้าภาพ/ผู้ร่วม × 13 หน่วยงาน จากใบ POP) — ของเรามี owner เดี่ยว
- **UPDATE STATUS / ความสดของแผง**

---

## 8. ลำดับที่เสนอ (ยังไม่ลงมือ — รอ user สั่ง)

1. **เฟส 0 — ตั้งบ้าน:** Supabase project ที่ 3 + โครง tenant/สิทธิ์ + ยกโครง `npi_*` +
   ทะเบียนหน่วยงาน/ลูกค้า/Model/sub-project + แม่แบบไมล์สโตน 10 ลูกค้า + แม่แบบเอกสารต่อด่าน (TMA SPTT)
2. **เฟส 1 — บอร์ดอ่านอย่างเดียว:** 21 แผงด้วยเครื่องมือ A–E + EVA ครบ 4 ชั้น + UPDATE STATUS
   (ทำ **737D MLM เป็นรุ่นต้นแบบให้ครบก่อน** — golden thread เดียวกับที่ ESM ใช้)
3. **เฟส 2 — เขียนได้:** ใบกิจกรรม · Kadai · มติที่ประชุม · เมทริกซ์ CPM/ECI/PPC · EVA
4. **เฟส 3 — ลิงก์ ESM:** Edge Function อ่าน PFC/FMEA/CP + เลข ECI/4M + เทียบ **Capacity plan vs OEE จริง**
5. **เฟส 4 — เปิดให้ supplier:** บัญชีภายนอก + RLS ต่อ supplier + ผัง supply chain + TPR ที่ supplier อัปเดตเอง

### 8.1 ⏳ Work flow การไล่ดูบอร์ด (รอจาก IEC)
IEC จะส่ง flow ว่า "ดูจากไหน → เจาะไปไหน" มาให้ ⇒ ใช้กำหนด **ลำดับชั้นของ dashboard** และ
**เส้นทางคลิก** (หน่วยงาน → ลูกค้า → Model → sub-project → แผง → แถว → เอกสาร/รูป)
**ยังไม่ออกแบบหน้าจอจนกว่าจะได้ flow นี้** — จะได้ไม่ต้องรื้อ

---

## 9. คำถามที่ต้องให้ IEC ตอบ

1. `SHONUN` = Shonan ใช่ไหม · `GMW` / `GWM` ตัวไหนถูก
2. 21 แผงเป็น**มาตรฐานทุกรุ่น** หรือแต่ละรุ่นเลือกแผงเอง (กระทบว่าจะทำเป็นแม่แบบบอร์ดหรือ fixed)
3. เกณฑ์ G/Y/R **ต่อแผง** ใช้อะไรตัดสิน — ระบบตัดให้อัตโนมัติจากเกณฑ์ SPTT ได้แค่ไหน และใครมีสิทธิ์กดทับ
4. ใครให้คะแนน EVA และถี่แค่ไหน (รายสัปดาห์ตามแถบ UPDATE STATUS?)
5. สัญลักษณ์ Status ใน Kadai Sheet (วงทึบ / ครึ่งวง / กากบาทในวง) หมายถึงอะไรบ้างให้ครบ
6. supplier ต้องเห็นและ**แก้**อะไรได้บ้าง — TPR ของตัวเอง? Supply chain? Kadai? และห้ามเห็นอะไรเด็ดขาด
7. PPAP: ไวท์บอร์ดเขียน **14 items** · ใบ POP D02D เขียน **11 items** · ระบบตั้งไว้ 18 (AIAG)
   ⇒ ยืนยันว่าเป็นรายการต่อลูกค้า (data-driven) ใช่ไหม
8. บอร์ดอัปเดตรายสัปดาห์หรือรายวัน · ประชุมหน้าบอร์ดบ่อยแค่ไหน (กำหนดจังหวะ refresh/realtime)
9. `EVA` ย่อมาจากอะไรแน่ (Evaluation) และ `Result KPI` vs `Process KPI` แบ่งเส้นตรงไหน
