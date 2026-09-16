# ทะเบียนที่มาของตัวเลข KPI บนบอร์ด OBEYA — รับไฟล์ทีละส่วนงาน

> ### 🔴 อ่าน **§8 (คู่มือระบบ KPI Online ของกลุ่ม · 2026-09-16)** ก่อนแตะอะไรที่เกี่ยวกับ KPI
> กลุ่มมีระบบ KPI ทางการอยู่แล้ว (`http://tsg-hrprd01/KPI_Online/`) พร้อมโครงข้อมูล · **เกณฑ์ให้คะแนน 1/0.5/0** ·
> วิธีรวม 12 เดือน · ขั้นอนุมัติ · เลขฟอร์ม — §8 ปิดคำถามที่ §5-7 เดาไว้หลายข้อ **และแก้ที่สรุปผิดไป 1 ข้อ (Safety)**

> **เอกสารนี้คือ "ความจำ" ของงานรับไฟล์** — ไม่ใช่คู่มือ
>
> ปัญหาจริง: ไฟล์ KPI มีหลายสิบไฟล์ × หลายส่วนงาน แต่ **context ของ session ถูกสรุปทิ้งเป็นระยะ**
> สิ่งที่วิเคราะห์จากไฟล์ชุดที่ 1 จะหายก่อนไฟล์ชุดที่ 5 มาถึง ถ้าไม่เขียนลงที่นี่
> ⇒ **ทุกครั้งที่ได้ไฟล์ใหม่ ต้องอัพเดทตารางในไฟล์นี้ในคอมมิทเดียวกัน**
> (หลักเดียวกับ `docs/PE-FORM-SPEC.md` = สัญญาระหว่างตัวนำเข้ากับตัวส่งออก)

---

## 1. ส่งยังไงให้ได้ผลที่สุด

### ⭐ ส่ง "1 ส่วนงานให้ครบ" ก่อน — อย่าส่ง "1 KPI ทุกส่วนงาน"
ส่ง PD3 ครบทั้ง 8 หัวข้อ → ต่อคอลัมน์เดียวให้ครบจริงได้เลย แล้วส่วนงานที่เหลือทำตามแบบ
ส่งกระจาย 1 หัวข้อทุกส่วนงาน = ยังไม่มีคอลัมน์ไหนใช้งานได้สักคอลัมน์

**ลำดับที่แนะนำ:** PD3 (มีรูปบอร์ดแล้ว + ข้อมูลผลิตเดินเต็ม) → PD4 → ที่เหลือ

### 📎 รูปแบบไฟล์ เรียงจากดีสุด
| รูปแบบ | ได้อะไร |
|---|---|
| **`.xlsx` ตัวจริง** | ดีที่สุด — อ่าน**สูตรในเซลล์**ได้ ⇒ รู้ว่าตัวเลขมาจากไหนจริงๆ ไม่ต้องเดา |
| `.csv` | ได้ตัวเลข แต่**สูตรหาย** |
| `.pdf` | อ่านเลข/หัวตารางได้ ไม่เห็นสูตร |
| รูปถ่าย | อ่านได้ แต่เลขเล็กๆ อาจพลาด — ใช้ตอนไม่มีไฟล์ต้นฉบับ |

**ครั้งละ 3–5 ไฟล์** แล้วรอผมสรุปก่อนส่งชุดถัดไป — ส่งทีเดียว 30 ไฟล์ ผมจะอ่านหยาบลงและตกรายละเอียด

### 🎯 คำถามที่ผมจะตอบให้ทุกไฟล์
1. **ตัวเลขนี้ระบบคำนวณเองได้ไหม** (มีข้อมูลต้นทางในระบบหรือยัง)
2. ถ้าไม่ได้ — **ขาดข้อมูลอะไร** ต้องไปกรอกที่ไหน
3. **สูตรจริงคืออะไร** (หน่วย · ตัวตั้ง · ตัวหาร · ช่วงเวลา)
4. **เป้า + ทิศทาง** ที่ควรตั้งใน 📑 KPI รายเดือน

---

## 2. สถานะรายหัวข้อ (อัพเดททุกครั้งที่ได้ไฟล์)

สถานะ: 🟢 คำนวณอัตโนมัติแล้ว · 🟡 คำนวณได้บางส่วน/รอข้อมูล · ⚪ ยังต้องกรอกมือ · ❓ ยังไม่เห็นไฟล์

| # | หัวข้อบนบอร์ด | สถานะ | สูตรจริง (จากฟอร์ม KPI Evaluation · ตัวอย่าง PD2 2024) | ต้นทางในระบบ | ยังขาด |
|---|---|---|---|---|---|
| 1 | Direct Labor | ⚪ กรอกมือ (นิยามชัดแล้ว) | **ต้นทุนแรงงาน ÷ Sale from product** (user ยืนยัน 2026-09-07) · แผนรายเดือนไม่เท่ากัน · Commitment ≤ 0.806% / Target ≤ 0.782% | ไม่มีในระบบ (บัญชี/SAP) → กรอกมือที่ 📑 KPI รายเดือน · สูตร/หน่วยเติมในทะเบียนแล้ว (`20260907_kpi_catalog_formulas.sql`) | แผนรายเดือน (ระบบมีเป้าเดียวทั้งปี — งาน (b) §5.6) |
| 2 | Overhead | ⚪ กรอกมือ (นิยามชัดแล้ว) | **ค่าโสหุ้ย ÷ Sale from product** (ยืนยัน 2026-09-07) · Commitment ≤ 0.108% / Target ≤ 0.105% | เหมือนข้อ 1 | เหมือนข้อ 1 |
| 3 | Inventory Balance | ⚪ กรอกมือ (นิยามชัดแล้ว) | **มูลค่าสต็อกคงคลัง (บาท)** — บัญชีสรุปส่ง monthly report ให้ทุกเดือน (ยืนยัน 2026-09-07 · ใบ PD2 ปี 2024 ใช้หน่วย "วัน" — คนละหน่วย ตอนตั้งเป้าต้องเลือกให้ตรงกับที่บัญชีส่ง) | ไม่ดึงจาก `line_stock_summary` (ของเราเป็นชิ้น ไม่มีมูลค่า) → กรอกมือ | — |
| 4 | Customer Satisfaction | ⚪ กรอกมือ (นิยามชัดแล้ว) | **คะแนนที่ได้จากลูกค้า** (ยืนยัน 2026-09-07) · ใบ PD2 เป็นขั้น 1/16 · Commitment ≥ 95% / Target 100% | ไม่มีในระบบ → กรอกมือ · **ไม่ผูก** `qa_customer_claims` | — |
| 5 | **OEE** | 🟢 | "Data from OEE program" · Commitment ≥ 70% / Target ≥ 75% · PD2 2024 ทำได้ 84–93% · Progress = ค่าเฉลี่ย 12 เดือน (ตรวจแล้ว) | `production_sessions.oee` (wavg) · เป้าที่ `oee_targets` | เป้าในระบบเป็น A×P×Q (default 80.2) — ใบใช้ 75% ตรงๆ · ตั้ง `oee_targets` ของแต่ละกลุ่มให้ตรงใบ · **§8: สูตรทางการ = `%OEE = A x P x Q` เป๊ะ · เป้ากลาง ≥87% · รวมทั้งปีด้วย Average · weight 4** |
| 6 | **PPM** | 🟢 **ปิดคำถามแล้ว** | user ยืนยัน 2026-09-07: **"งานเสีย ÷ ยอดที่ผลิต"** = สูตรที่ระบบใช้อยู่ (ยอดที่ผลิตทั้งหมด = สแกนดี + เสีย เพราะสแกนปิดใบนับเฉพาะของดี) → **โค้ดไม่เปลี่ยน** เปลี่ยนแค่ข้อความกำกับบนจอ/ใบพิมพ์ให้พูดว่า "ยอดที่ผลิตทั้งหมด (สแกนดี + เสีย)" กันเข้าใจผิดซ้ำ · Commitment ≤ 300 / Target ≤ 250 PPM | `defect_logs` (line-mode) | **§8 ยืนยันซ้ำจากเอกสารทางการ:** `Internal Quality Rate = (Defect / Total Production) x 1,000,000` · และมี KPI พี่น้องอีกตัว `Incoming Quality Rate` (ของซื้อเข้า) ที่เรายังไม่ได้ทำ |
| 7 | **Safety** | 🟡 **กรอกมือ + หน้างานประกอบ** | user ยืนยัน 2026-09-07: ค่า KPI = **"คะแนนที่สรุปจากหน่วยงานความปลอดภัย"** (ไม่ใช่นับจาก safety_events) · ใบ PD2 นับเฉพาะร้ายแรง (Die/Disability/Dismemberment) "0 Case" | บอร์ด `/obeya` แถว Safety: **มีนิยาม Safety + ค่าเดือนนี้ (กลุ่มไลน์ → ส่วนงาน) = ใช้ค่านั้น ป้าย ✍️** · ยังไม่กรอก = ถอยไปนับ `safety_events` เหมือนเดิม (⚪ ถ้าไม่มีบันทึก) · note เขียนกำกับทั้ง 2 แหล่งเสมอ | 🔴 **§8 ขัดกับช่องนี้** — คู่มือทางการบอกว่า Safety = **จำนวนเคส (Case) เป้า 0 · Creator = Center** และมีข้อย่อยทางการ 4 ชั้น (Serious / Absent >3 Days / Absent <3 Days / Minor Injures) · **ต้องถามให้จบก่อนตั้งนิยาม** (§8.11 ข้อ 3) |
| 8 | Training | ⚪ | บนใบคือ **"TS Academy" (4.2)** — "Data from HRM" · % สะสมพนักงานที่ผ่านอบรม · Commitment ≥ 80% / Target ≥ 90% | `ojt_trainings` 13 ใบ · `employee_skills` | **§8 ปิดนิยามแล้ว:** `(Number of Passed training employee / Total Employee) x 100` · สะสม เอาเดือนล่าสุด (`Summary = Actual`) · เหลือแค่เกณฑ์ว่า "ผ่าน" คือคะแนนเท่าไหร่ |

### KPI บนฟอร์มที่ **ไม่อยู่ใน 8 หัวข้อของบอร์ด** (ฟอร์มมี 11 ตัว · เลข BSC 1.1–4.3)
| เลข | ชื่อบนฟอร์ม | สูตร/ที่มา | หมายเหตุ |
|---|---|---|---|
| 3.1 | Overall Cost Reduction (100P&CR) | "Value cost improvement" % · Commitment ≥ 1.00% / Target ≥ 1.20% · แผน 1.2% ทุกเดือน | = 100P ในแผง Key Performance · ระบบมี `improvements` cost saving แต่**ตัวหาร (ต้นทุนรวม?) ไม่มี** |
| 4.1 | Engagement Survey | "Data from HRM" · ปีละครั้ง (ธ.ค.) · ≥ 80% / ≥ 85% | กรอกมือ 1 ค่า/ปี — ระบบรองรับอยู่แล้ว (เดือนอื่นใส่ "-") |
| 4.3 | Core Activity : CIW | "Data from Leader Activity" · **milestone รายไตรมาส** 0.3529 / 0.6471 / 0.8235 / 1 (= 6/17 · 11/17 · 14/17 · 17/17 ⇒ **17 cost center หลัก**) | เป้าเป็นขั้นบันได ไม่ใช่ค่าเดียวทั้งปี |

### แผง Key Performance (ระดับส่วนงาน) + Core Activity Plan
| หัวข้อ | สถานะ | หมายเหตุ |
|---|---|---|
| 100P · TS Academy | 🟡 | เห็นแล้วในฟอร์ม KPI Evaluation (= 3.1 Overall Cost Reduction · 4.2 TS Academy — ดูตารางบน) |
| LEAN · QCC · 5S | ❓ | ยังไม่เห็นไฟล์ |
| Kaizen | 🟡 | มี `improvements` (Kaizen) ในระบบแล้ว + สูตร cost saving — ต้องดูว่าใบนับอะไร (จำนวนเรื่อง? เงินที่ประหยัด?) |
| Master Plan / E-Day (แผง ENGNEER) | 🟡 | **เห็นฟอร์มแล้ว (2026-09-07 — ดู §5)** = Gantt รายสัปดาห์ 12 เดือน × W1–W4 · 15 แถว · Plan/Actual · ยังไม่มีที่เก็บในระบบ |

---

## 3. กฎตอนวิเคราะห์ไฟล์ (ห้ามพลาด)

1. **ห้ามเดาสูตร** — อ่านจากเซลล์จริง/หัวตารางเท่านั้น · อ่านไม่ออก = ถามกลับ
   (บทเรียนเดิมทั้งโปรเจค: EF พลังงาน · `lot_size` · ชื่อ KPI — เดาแล้วเสียหายกว่าไม่ทำ)
2. **สูตรที่ต่างจากระบบต้องรายงาน ห้ามเงียบ** — เช่น PPM ข้างบน · ให้ user เลือกว่าจะยึดสูตรไหน
   แล้ว**เขียนกำกับบนจอ**ว่าใช้สูตรอะไร
3. **"ตัวเลขบนใบ" ≠ "ตัวเลขที่ระบบคำนวณได้"** — ถ้าต่างกัน ให้หาสาเหตุก่อนเปลี่ยนสูตรระบบ
   (ขอบเขตกะ? รวมงานทดลอง? นับไลน์ไหนบ้าง?)
4. **ส่วนงานอาจใช้สูตรไม่เหมือนกัน** — บันทึกแยกรายส่วนงานถ้าเจอ **ห้ามเหมาว่าเหมือนกัน**
5. **ไฟล์ที่มีข้อมูลย้อนหลัง = ของมีค่า** — กรอกเข้าระบบผ่าน 📑 KPI รายเดือน (ลงย้อนหลังได้ 4 ปี)
   แล้วเทรนด์กับการเทียบปีต่อปีจะใช้ได้ทันที

---

## 4. บันทึกรายส่วนงาน

### PD3 — ยังไม่ได้รับไฟล์
รู้จากรูปบอร์ดแล้ว: 2 คอลัมน์ (LINE HYDROFORM 1&2 · LINE APRON ASSY & SUP APRON)
สถานะบนบอร์ด ณ วันถ่ายรูป: Inventory 🔴 (APRON) · PPM 🔴 (HYDROFORM) · Safety 🔴 (APRON) · OEE 🟡 (APRON)

### PD2 — ได้ "ตัวอย่างฟอร์ม" ปี 2024 (2026-09-07) — ไม่ใช่ข้อมูลสด
ชีท `Example for manager` ในไฟล์ KPI Evaluation = ใบจริงของ **Production Assembly (PD2) ปี 2024** (Manager K.Witthaya · Update 16/01/2025)
ค่ารายเดือนครบ 12 เดือน 11 KPI → **ลงย้อนหลังปี 2024 ของ PD2 ได้ทันที**ผ่าน 📑 KPI รายเดือน (รอ user สั่ง — ห้ามลงเอง)
สิ่งที่ใบนี้บอกและระบบยังไม่มี → §5

### PD4 · PD1 · Planning&Store — ยังไม่ได้รับไฟล์

---

## 5. ไฟล์ชุดที่ 1 (2026-09-07) — 4 ฟอร์มตัวอย่าง (`*_for_example.xlsx`)

> ทั้ง 4 ไฟล์เป็น **แม่แบบ** (ช่องว่าง) + 1 ชีทตัวอย่างจริง (PD2 2024) · ไม่มีเลขฟอร์ม/Rev/โลโก้ในเซลล์ใดเลย (แนบมาเป็นรูป? — ไม่มีรูปในไฟล์) · A4 แนวนอนทุกใบ · ไม่มีสูตร/conditional formatting/data validation (ทุกอย่างพิมพ์มือ ยกเว้น TS Academy `=เดือนก่อน+x%`)

### 5.1 Key Performance Index Evaluation (ชีท Form for manager / Form for Supervisor / Example for manager)
**โครงคอลัมน์:** No · Key performance · KPI (= *ที่มาข้อมูล* เช่น "Data from SAP") · **Commitment** · **Target** · Master plan Y2024 ม.ค.–ธ.ค. (แต่ละ KPI 2 แถว **Plan / Actual**) · Response (Champion) · **Progress** · **EVA** · Problem · Countermeasure
**หัวใบ:** Approval Level 3 ช่อง — ใบ Manager = Director / GM Plant / Manager · ใบ Supervisor = GM Plant / Manager / Supervisor · มุมขวา Date / Name / Dept / Update · กล่อง "หัวข้อ ↔ Performance indicator" 8 ช่อง (ใบตัวอย่างใส่ 11)
**หมวด BSC 4 หมวดตายตัว:** 1 Financial · 2 Customer · 3 Internal Process · 4 Learning & Growth — ตรงกับ `kpi_definitions.category` (financial/customer/internal/learning) พอดี

**⭐ ข้อค้นพบสำคัญ — ระบบยังทำไม่ตรงใบ 3 จุด:**
1. **EVA = 3 ระดับจาก 2 เกณฑ์:** ● เขียว "Achieve target" (ผ่าน Target) · ● เหลือง "Within commitment" (ไม่ถึง Target แต่ยังอยู่ใน Commitment) · ● แดง "Miss commitment" (หลุด Commitment) — สีจาก font Wingdings `l` (00B050 / FFFF00 / FF0000)
   → ระบบเก็บ `commitment` เป็น**ข้อความ**เฉยๆ แล้วตัดสินเหลืองด้วย `statusVsTarget(band=5%)` ซึ่งเป็นแถบเดา **ต้องเปลี่ยนเป็น `commitment_value` ตัวเลข** แล้วให้ G/Y/R = target / commitment / หลุด (ทั้ง `/obeya` และ 📑 KPI รายเดือน) — band 5% ใช้เฉพาะแถวที่ไม่มี commitment
   · ใบมี legend แถวที่ 2 อีกชุด (✓ Achieve · ▲ Improvement · ✗ Miss goal) แต่ตัวอย่างจริงใช้แค่ ● 3 สี
2. **แผน (Plan) เป็นรายเดือน ไม่ใช่ค่าเดียวทั้งปี:** DL/OH แผนต่างกันทุกเดือน (ตาม budget) · TS Academy/CIW เป็นบันได · Engagement มีแค่ ธ.ค. → ระบบมี `target_value` เดียว/ปี — **ต้องมี plan รายเดือน** (คอลัมน์ `plan` ใน `kpi_manual_entries` เป็นทางที่กระทบน้อยสุด · แถว auto ก็ต้องตั้งแผนรายเดือนได้)
3. **Progress = ค่าเฉลี่ยของ Actual ทุกเดือนที่มีค่า** (ตรวจ 3 ตัว: OEE 0.8793 · PPM 12.25 · CSAT 0.8802 ตรงเป๊ะ · DL 0.00653 vs avg 0.00667 — คลาดจากพิมพ์มือ) — ตรงกับคอลัมน์ "เฉลี่ย-รวม" ที่ export มีอยู่แล้ว ✓ · Safety/Inventory เป็นข้อความ ("0 Case" / "0.41 Day") ไม่ใช่ตัวเลข

**Problem / Countermeasure / Response(Champion)** — ระบบมี `action_plan`/`action_owner` ต่อ KPI ต่อปี ใกล้เคียง · แต่ใบเขียน Problem เป็นเหตุการณ์มีวันที่ ("Store ไม่รับงาน 022/023 วันที่ 29/04/2024") = ควรผูกกับ open issue (§5.3) มากกว่าฝังในนิยาม

### 5.2 Master Plan (ชีท Master Plan · ปี 2025 · TSA สาขา 1)
Gantt: No · (ชื่อกิจกรรม — ช่อง B–J ว่างไม่มีหัว) · Response · Status (Plan/Actual 2 แถวต่อกิจกรรม) · 12 เดือน × **W1–W4** · Remark · ISSUED BY / APPROVED BY · 15 แถว
ชีทซ่อน `D1` = รุ่นเก่ากว่า (มี "Activities" · PREPARED/APPROVED · Rev) · **ยังไม่มีตารางไหนในระบบเก็บแผนรายสัปดาห์แบบนี้** (`improvements` เป็นโปรเจคเดี่ยว ไม่มี Gantt)

### 5.3 Open Issue (ชีท Open Issue · ชีทซ่อน Open Issue (2) / P1)
คอลัมน์: Topic · No. · **Status R / Y / G** (3 ช่องติ๊ก) · Problem · Countermeasure · Start Date · Finish Date · Response Person · Remark · หัว Issue by / Date
รุ่นจัดกลุ่ม (ซ่อน) แบ่ง **Topic 5 กลุ่มตายตัว**: Customer issue, Drawing/Raw material · Dies Tooling · Assembly & Equipment · Part quality · Other
→ ใกล้ `meeting_action_items` ที่สุด (problem/root_cause/assignee/due_date/status open-doing-done) แต่**ขาด**: Countermeasure แยกจากสาเหตุ · Start date · Topic 5 กลุ่ม · สถานะเป็น R/Y/G (ของเราเป็น workflow ไม่ใช่สี) — แผง 🚨 "งานที่ต้องตามแก้" ใน `/obeya` ควรพิมพ์ออกเป็นใบนี้ได้

### 5.4 Monitoring Sheet (ชีท Monitoring Sheet · ชีทซ่อน D2 "PROJECT MONITORING SHEET" · D3)
รายสัปดาห์: "Result Weekly : Date" · Problem Detail | Countermeasure (ช่องเขียนอิสระ) · Open Issue List 7 แถว (คอลัมน์เดียวกับ §5.3)
รุ่นซ่อน D2 = Yearly plan + ตารางผลรายสัปดาห์ 12 เดือน × W1–W4 + open issue list ในใบเดียว
→ = "บันทึกประชุมรายสัปดาห์ของ Obeya" — ระบบมี Morning Meeting รายวัน แต่ไม่มีรอบรายสัปดาห์

### 5.5 คำถามที่ถาม user — **ตอบแล้ว 2026-09-07 (ดู §6)**
1. **PPM ตัวหาร** (ค้างจากรอบก่อน — ไฟล์นี้ก็ไม่ตอบ)
2. **DL / OH % ตัวหารคืออะไร** (ยอดขาย? ต้นทุนผลิต?) และเอามาจาก SAP รายงานตัวไหน — ถ้าไม่มีทางดึง ก็กรอกมือต่อไป (ระบบรองรับแล้ว)
3. **Customer Satisfaction 16 ข้อ** ใบคะแนนอะไร ใครกรอก — ถ้าเป็นใบที่ QA/Sales ได้จากลูกค้า ทำฟอร์มกรอกในระบบได้ (แล้วบอร์ดคำนวณ % เอง)
4. **Safety นับเฉพาะร้ายแรง 3 ประเภท** ตามชื่อ KPI หรือ นับทุกเหตุบาดเจ็บ — ตอนนี้ระบบแดงตั้งแต่ปฐมพยาบาล และ**ไม่มีชนิดเหนือ LTI** (ตาย/ทุพพลภาพ/สูญเสียอวัยวะ) · บอร์ดกระดาษ PD3 ขึ้นแดงที่ APRON — เหตุระดับไหน?
5. **Inventory "วัน"** สูตร + จะให้ผูก cost center กับกลุ่มไลน์ยังไง (ต้องมีตาราง map)
6. ใบ KPI Evaluation นี้**มีเลขฟอร์มไหม** — export ปัจจุบันอิง FM-HRM-6-022/024/025 ซึ่งเป็นคนละ layout · ถ้าจะ export ใบนี้ต้อง register `/doc-forms` เพิ่ม
7. อนุญาตให้**ลงข้อมูล PD2 ปี 2024 ย้อนหลัง**จากชีทตัวอย่างไหม (11 KPI × 12 เดือน — ทำได้เลยเมื่อสั่ง)

### 5.6 งานที่ตกผลึกจากไฟล์ชุดนี้ (สถานะ 2026-09-07: (e) ทำแล้วในรูป "กรอกมือชนะ" · (a)(b)(c)(d) **ยังไม่ทำ รอ user สั่ง**)
- (a) `commitment_value` + กติกา G/Y/R 3 ระดับ (target / commitment) — กระทบ `obeya.js` `statusVsTarget` ผู้ใช้ทุกจอ ต้อง backward-compatible (ไม่มี commitment = band เดิม)
- (b) แผนรายเดือน (`plan`) ต่อ KPI — โมดัลกรอก + กราฟเส้นแผน + export คอลัมน์ Plan/Actual 2 แถวตามใบ
- (c) Open issue ตามใบ §5.3 บน `meeting_action_items` (เพิ่ม countermeasure / start_date / topic / rag) + พิมพ์ใบ
- (d) Master Plan Gantt รายสัปดาห์ (ตารางใหม่) — แผง ENGNEER
- (e) เพิ่มชั้น `fatal`/`disability`/`dismemberment` ใน `SAFETY_KINDS` (severity 6+) + ให้ KPI Safety เลือกได้ว่านับจากชั้นไหน (ขึ้นกับคำตอบข้อ 4 — ห้ามลดความเข้มของบอร์ดเองโดยไม่ได้สั่ง)

---

## 6. คำตอบ user 2026-09-07 (ปิดคำถาม §5.5) + สิ่งที่ทำตาม

| # | คำถาม | คำตอบ user | ทำอะไร |
|---|---|---|---|
| 1 | PPM ตัวหาร | "งานเสีย ÷ ยอดที่ผลิต" | = สูตรระบบ (ยอดที่ผลิตทั้งหมด = สแกนดี + เสีย) → **โค้ดไม่เปลี่ยน** · แก้ข้อความกำกับ 6 จุด (KpiMonthly ×4 · Obeya · DeptDashboard) ให้พูดว่า "ยอดที่ผลิตทั้งหมด (สแกนดี + เสีย)" — ⚠️ session ถัดไป**ห้ามเปลี่ยนเป็น NG ÷ ยอดสแกน** เพราะยอดสแกน = ของดีล้วน ไม่ใช่ยอดที่ผลิต |
| 2 | DL / OH ตัวหาร | ต้นทุนแรงงาน / ค่าโสหุ้ย ÷ Sale from product · กรอกมือ | เติม formula/unit/scope ในทะเบียน (`20260907_kpi_catalog_formulas.sql`) |
| 3 | Customer Satisfaction | คะแนนที่ได้จากลูกค้า · กรอกมือ | เติมทะเบียน · ไม่ผูกเคลม |
| 4 | Safety นับอะไร | เอา "คะแนนที่สรุปจากหน่วยงานความปลอดภัย" | บอร์ด `/obeya` แถว Safety ใช้ค่ากรอกมือเมื่อมี (ป้าย ✍️) · ไม่มี = นับ safety_events เดิม · **ไม่ลดชั้นความรุนแรงเอง** (งาน (e) เดิมตกไป) |
| 5 | Inventory "วัน"? | ใส่**มูลค่า**สต็อกคงคลัง · บัญชีส่ง monthly report | เติมทะเบียน หน่วย "บาท" (ใบ PD2 เก่าใช้ "วัน" — คนละหน่วย ระวังตอนเทียบปีเก่า) |
| 6 | เลขฟอร์ม KPI Evaluation | "ไม่แน่ใจ เดี๋ยวไปหาก่อน" | ✅ **เจอแล้วใน §8.8: `FM-HRM-6-022(01)`** (ใบ Appraisal ที่ KPI Online พิมพ์เอง) — แต่**ทบทวนก่อนทำปุ่มพิมพ์ใน ESM** เพราะระบบกลางพิมพ์ได้อยู่แล้ว |
| 7 | ลง PD2 ปี 2024 ย้อนหลัง | ไม่ | ไม่ลง |

**หลักที่ตกผลึกจากรอบนี้:** KPI 5 ตัวบนบอร์ด (DL · OH · Inventory · CSAT · Safety) **เจ้าของตัวเลขคือหน่วยงานอื่น** (บัญชี · ลูกค้า · หน่วยงานความปลอดภัย) ไม่ใช่ฝ่ายผลิต → ระบบเป็น "ที่กรอก + ที่โชว์" ไม่ใช่ "ที่คำนวณ" · ห้ามพยายาม derive จากข้อมูลผลิตแล้วอ้างว่าเท่ากัน

---

## 7. โครง KPI ปี 2026 ต่างจากไฟล์ตัวอย่าง (user แจ้ง 2026-09-07)

> "ที่ส่งให้ดูคือปีเก่า · ปีนี้จะมีเพิ่ม %RM (Raw Material) เข้ามาเป็นข้อที่ 1 และ DL กับ OH จะรวมกันเป็นข้อเดียว"

| หมวด Financial | ปี 2024 (ไฟล์ตัวอย่าง / รูปบอร์ด) | ปี 2026 (ปัจจุบัน) |
|---|---|---|
| ข้อ 1 | 1.1 Direct Labour | **%RM (Raw Material)** — ⚠️ สูตรที่ใส่ในทะเบียน = *ต้นทุนวัตถุดิบ ÷ Sale from product × 100* เป็น**ข้อสันนิษฐาน**จากแบบ DL/OH ยังไม่ได้ยืนยัน (แก้ได้ที่ 🗂 ทะเบียน) |
| ข้อ 2 | 1.2 Overhead | **DL+OH** = (ต้นทุนแรงงานทางตรง + ค่าโสหุ้ย) ÷ Sale from product × 100 |

- ทำแล้ว: ทะเบียนเพิ่ม 2 ชื่อ + ปิดใช้งาน Direct Labor / Overhead (ไม่ลบ ไม่ rename) · บอร์ด `/obeya` สลับชุดแถวตามปีของวันที่ดู (`boardRowsFor`)
- ยังไม่รู้: ชื่อทางการที่บริษัทใช้เรียก 2 ตัวนี้บนใบปี 2026 (ตั้งชั่วคราว `%RM (Raw Material)` / `DL+OH (Direct Labor + Overhead)` — **rename ในทะเบียนได้เลย บอร์ดจับคู่ด้วยชื่อแบบไม่สนช่องว่าง/วงเล็บ แต่ต้องคงคำว่า RM / DL+OH ไว้**) · หัวข้ออื่นอีก 6 ตัวปีนี้เหมือนเดิมหรือไม่ (ยังไม่ได้ถาม)
- ⚠️ ไฟล์ KPI ที่จะส่งมาต่อไป ขอเป็น**ใบปี 2026** จะได้ไม่วิเคราะห์โครงเก่าซ้ำ

---

## 8. คู่มือระบบ **KPI Online** ของกลุ่ม (Rev.2 · ได้ไฟล์ 2026-09-16) — เอกสารชี้ขาดที่สุดที่ได้มา

> ไฟล์: `KPI Online - User Manual Rev.2.pdf` (55 หน้า) · Kick-off & Training **14 ก.ย. 2026**
> ระบบจริง: **http://tsg-hrprd01/KPI_Online/Login** (login = user/password เดียวกับ TSG Intranet)
> ติดต่อ: QSM ประจำ Plant · **KPI.Audit@thaisummit.co.th** · IT: Ampon.Tan / Rujirott.Som @thaisummit.co.th

### 8.0 🔴 เส้นแบ่งที่ต้องยึดตั้งแต่นี้ไป

**KPI Online = ระบบทะเบียนอย่างเป็นทางการของกลุ่ม (system of record)** — เป็นที่ตั้ง Commit/Target/Weight,
อนุมัติตามสายบังคับบัญชา, เซ็น e-Signature, และส่งคะแนนเข้า **PEV (ประเมินผลงาน)** ปลายปี
**ESM ไม่ใช่และต้องไม่พยายามเป็นระบบนั้น** — หน้าที่ของ ESM คือ **"โรงงานผลิตตัวเลข Actual"**
(OEE · PPM · Safety · ยอดผลิต) ที่คนต้องเอาไปกรอกใน KPI Online ทุกเดือน + เป็นจอที่เห็นสถานะรายวัน
ซึ่ง KPI Online ไม่มี (มันเป็นราย*เดือน* และไม่รู้จักไลน์/กะ/เครื่อง)

⇒ เป้าของบอร์ด `/obeya?tab=kpi` เปลี่ยนจาก "บอร์ดของเราเอง" เป็น **"ใบเตรียมกรอก KPI Online"**:
ศัพท์ · โครงคอลัมน์ · เกณฑ์ให้คะแนน ต้องตรงกับ KPI Online ให้มากที่สุด เพื่อให้ copy ไปกรอกได้ตรงช่อง
**ห้ามคิดเกณฑ์สี/เกณฑ์คะแนนขึ้นเองอีก** — ของจริงมีแล้ว (ดู §8.3)

### 8.1 ใครทำอะไร (workflow 5 ขา — หน้า 3)

| # | บทบาท | ทำอะไร |
|---|---|---|
| 1 | **HR** | อัปโหลดผังองค์กร · สายบังคับบัญชา · ผู้รักษาการแทน |
| 2 | **IA (Internal Audit)** | อัปโหลด master data ของ Management + Function + Supervisory + หัวข้อ KPI มาตรฐาน |
| 3 | **User Admin QSM** | ตั้ง **Commitment · Target · Weight** ของ Management (ตามที่ได้จาก KPI Deployment) |
| 4 | **User Admin Center** | กรอก **ผลรายเดือน (Result)** ของ KPI ที่ `Creator = Center` |
| 5 | **KPI Owner (Management)** | กรอกผลของ KPI ที่ `Creator = User` + ตรวจ + ส่งอนุมัติ |

- **`Creator` เป็นตัวชี้ขาดว่าใครกรอก** — `Center` = ส่วนกลางกรอกให้ (Total Sales · EBIT · Safety · DSI · Annual Sale Per Head) · `User` = ผู้จัดการเจ้าของ KPI กรอกเอง (Budgeting · OEE · PPM · TS Academy · DL&OH)
- ข้อมูลผังองค์กรผิด/ย้ายหน่วยงาน → **แจ้ง KPI Audit ให้แก้** หน่วยงานแก้เองไม่ได้

### 8.2 โครงข้อมูลจริงของ 1 แถว KPI (หน้า 9-12, 29-35) — **นี่คือสเปกที่เราต้องลอก**

| คอลัมน์ | ความหมาย | ของเรามีหรือยัง |
|---|---|---|
| `Perspective` | BSC 4 ด้าน: **Financial · Customer · Internal process · Learning & Growth** | ❌ `kpi_catalog.category` มี `financial` อยู่ตัวเดียว — ควรขยายเป็น 4 ค่านี้ |
| `No` | เลขข้อ + **ข้อย่อย `5.1 5.2 …`** (ข้อย่อยไม่มี weight ไม่มี point — เป็นรายละเอียดของข้อแม่) | ❌ ยังไม่มีแนวคิดข้อย่อย |
| `KPIGuideline` | ชื่อหัวข้อ | ✅ `kpi_catalog.name` |
| `Formula` | สูตรเป็นข้อความ เช่น `(Defect/Total Production) x 1,000,000` | ✅ `formula_text` |
| `Scope` | ขอบเขต/ที่มาข้อมูล เช่น `Data from P&L line 13` | ✅ `scope_text` |
| `CommitmentCompare` + `Commitment` + `CommitmentUnit` | **เครื่องหมาย (`<= >= < >`) + ตัวเลข + หน่วย** แยก 3 ช่อง | ⚠️ เรามีแต่ค่าเดียว ไม่มีเครื่องหมาย/หน่วยแยก |
| `TargetCompare` + `Target` + `TargetUnit` | เหมือนกัน | ⚠️ เหมือนกัน |
| `FixedWeight` | น้ำหนักคะแนน · **รวมทั้งใบต้อง = 50 พอดี** (ครบ = เขียว · ไม่ครบ = เหลือง) | ❌ ไม่มี |
| `FixedTopic` | **`Fixed`** = ข้อบังคับต้องวัด · **`Choice`** = ข้อให้เลือกตามเกณฑ์ | ❌ ไม่มี |
| `Creator` | `Center` / `User` (ดู §8.1) | ❌ ไม่มี |
| `Summary` | **วิธีรวม 12 เดือนเป็นผลทั้งปี**: `Sum` · `Average` · `As of` (เอาเดือนล่าสุดที่กรอก) · `Actual` · `Actual+Plan` · `Manual` · `Calculate` | ❌ ไม่มี — ของเราเดาเอาเอง |
| `Result` · `Weight` · `0 / 0.5 / 1` · `Point` · `Status` | ผล + ช่องติ๊กระดับ + คะแนน + ไฟ | ⚠️ มีแต่ไฟ ไม่มีคะแนน |

**หน่วย (Unit)** เลือกจากทะเบียนกลาง `Set Unit`: `%` · `Agreement` · `Award` · `Case` · `Days` · `MB` · `Team` · `Types` · `Sections` · `Issues` · `Plants` · `PPM`

**การกรอกตัวเลข (กฎเข้ม):** ยอดขาย/เงิน = หน่วย **MB (ล้านบาท) ทศนิยม 2 ตำแหน่ง** ห้ามใส่ `฿ , MB` หรือช่องว่าง
(`125.50` ✅ · `125,500,000` ❌ · `125 MB` ❌) · % ใส่ `80.00` · จำนวนเรื่อง/ทีม ใส่จำนวนเต็ม

### 8.3 🔴 เกณฑ์ให้คะแนน — **ปิดคำถามงาน (a) ในแฮนด์ออฟ**

```
ผลถึง Target      → ติ๊กช่อง  1   → Point = Weight × 1     🟢
ผลถึง Commitment  → ติ๊กช่อง 0.5  → Point = Weight × 0.5   🟡
ไม่ถึงทั้งคู่      → ติ๊กช่อง  0   → Point = 0              🔴
```
ตรวจกับตัวเลขจริงในคู่มือครบทุกแถวที่อ่านได้ (หน้า 14 · 29 · 33-35):

| KPI | Commit | Target | Result | Weight | Point | ตรง? |
|---|---|---|---|---|---|---|
| Total Sales | ≥35,198.44 MB | ≥35,986.80 MB | 35,420.06 MB | 6 | **3.0** (0.5) | ✅ |
| EBIT | ≥3.71% | ≥3.91% | 4.02% | 6 | **6** (1) | ✅ |
| Budgeting | ≤100% | ≤98.00% | 99.64% | 7 | **3.5** (0.5) | ✅ |
| SLA (ส่งรายงานตรวจ) | ≥80.00% | 100% | 100% | 6 | **6** (1) | ✅ |
| TS Academy | ≥75.00% | ≥85.00% | 100% | 2 | **2** (1) | ✅ |
| Annual Sale Per Head | ≥2.54 MB | ≥2.59 MB | 1.29 MB | 3 | **0** (0) | ✅ |
| Internal Quality Rate | ≤6,401 PPM | ≤6,045 PPM | — | 3 | — | — |

⇒ **เลิกใช้ band 5% ที่เราเดาไว้** (`statusOf` ใน `obeyaKpi.js` / เกณฑ์ใน `obeya.js`)
เมื่อ KPI ตัวนั้นมีทั้ง Commitment และ Target ให้ใช้กติกา 1 / 0.5 / 0 ข้างบน
· มีแต่ Target อย่างเดียว = เขียว/แดง ไม่มีเหลือง **ห้ามประดิษฐ์เหลืองเอง**

> ⚠️ **ข้อขัดที่ต้องถาม KPI Audit:** แถว Safety ในคู่มือ (หน้า 33) เป็น `Commitment 0 Case` / `Target 1 Case`
> ซึ่ง**สลับด้านยาก-ง่าย**กับตัวอื่น (ปกติ Target คือบาร์ที่ยากกว่า) · ตัวอย่างนั้นได้ 0 คะแนน (แดง)
> เลยแยกไม่ออกว่าระบบตัดสินยังไง — **ห้าม hardcode ว่า "Target ยากกว่าเสมอ"** ให้เทียบทั้ง 2 ค่าแล้วเอา
> บาร์ที่เข้มกว่าเป็นระดับ 1 จะปลอดภัยกว่า

### 8.4 การกรอกรายเดือน (หน้า 19-22, 32-35)

- ทุก KPI = ตาราง **Jan … Dec + Total** และ**ทุกช่องมี `Update: <วันเวลา>` กำกับ** (audit trail รายเซลล์)
- KPI บางตัวมี **หลายแถวข้อมูลต่อ 1 หัวข้อ** แล้วระบบคำนวณช่องผลให้เอง:
  - `EBIT` = แถว **Total Sales** (ดึงอัตโนมัติ) + **EBIT value** → ระบบคำนวณ **Percent** เอง
  - `DL&OH` = แถว **Sale from Production** + **Actual DL&OH** → ระบบคำนวณ % เอง
- `Summary` เป็นตัวบอกว่ารวมยังไง — **ถ้าเป็น `As of` ระบบเอาเดือนล่าสุดที่กรอก** (DSI · TS Academy สะสม)
  · ถ้าเป็น `Sum`/`Average` ระบบคิดให้ · **ถ้าสูตรซับซ้อนจน SUM/AVG ไม่ได้ ให้คำนวณนอกระบบแล้วกรอกช่อง `Total` เอง**
- **แนบไฟล์หลักฐาน (Attachment) ได้ทุกหัวข้อ** (xls, xlsx, csv, pdf, doc, docx) — ที่เก็บหลักฐานอยู่ที่ระบบนั้น ไม่ใช่ที่เรา
- `Activity (QCC, Engineering Day)`: เดือนไหนไม่มีผลงาน **ไม่ต้องกรอก** (ไม่ใช่กรอก 0)

### 8.5 สูตรทางการที่เพิ่งได้ — เทียบกับที่ ESM ทำอยู่

| KPI ทางการ | สูตรบนระบบกลาง (verbatim) | Summary | ESM ตรงไหม |
|---|---|---|---|
| **OEE** | `% OEE = A x P x Q` · Target **≥ 87.00%** · weight 4 · Creator **User** | **Average** | ✅ ตรงเป๊ะกับ `src/utils/oee.js` · ⚠️ **แต่เป้าเราคือ A×P×Q จาก `oee_targets` (default 90/90/99 = 80.2%) ส่วนกลางใช้ 87%** → ต้องตั้ง `oee_targets` ให้ตรงใบ ไม่ใช่ปล่อย default · และผลทั้งปี = **ค่าเฉลี่ยรายเดือน** (ไม่ใช่ถ่วงน้ำหนักทั้งปี) |
| **Internal Quality Rate** (= PPM ของเรา) | `(Defect / Total Production) x 1,000,000` | Calculate | ✅ **ตรงกับสูตรระบบ** — ปิดข้อสงสัย PPM ถาวร (ยืนยันซ้ำรอบที่ 2 จากเอกสารทางการ ไม่ใช่คำบอกเล่า) |
| **Incoming Quality Rate** | `(Total Defect From Production or WH / Total Purchase Quantity) x 1,000,000` | Calculate | ❌ **KPI คนละตัวที่เราไม่เคยรู้** = PPM ของ**ของที่ซื้อเข้า (supplier)** · ESM มี `qa_incoming_inspections`? ต้องไปดู — ถ้ามี นี่คือ KPI ที่เราเติมให้อัตโนมัติได้อีกตัว |
| **DL&OH** | `[(DL+OH) / Sale from product] x 100` · ตัวอย่าง ≤1.3445% / ≤1.3042% · weight 6 | Sum | ✅ ตรงกับที่ user ยืนยันไว้ (§6) — **สูตรที่เราใส่ในทะเบียนถูกแล้ว** |
| **Annual Sale Per Head** | `Total Sales / Average manpower` (หน่วย MB) | Actual+Plan | 🟡 ESM มีกำลังคนรายวัน (`daily_production_logs`) → **คำนวณตัวหารให้ได้** แต่ยอดขายไม่มี |
| **TS Academy** (= Training) | `(Number of Passed training employee / Total Employee) x 100` · สะสม เอาเดือนล่าสุด | Actual | 🟡 **ปิดคำถาม "นิยาม Training" แล้ว** = % พนักงานที่ผ่านอบรม (สะสม) · ESM มี `ojt_trainings` + `ojt_training_attendees` (มี `post_score`) → **นับ "ผ่าน" ได้ถ้าตกลงเกณฑ์คะแนน** |
| **Safety** | นับ **Case** เป้า 0 · Creator **Center** · Summary **Sum** · ข้อย่อยทางการ **4 ชั้น**: `5.1 Serious Accidents` · `5.2 Absent Accidents > 3 Days` · `5.3 Absent Accidents < 3 Days` · `5.4 Minor Injures` | Sum | ⚠️ **ขัดกับที่สรุปไว้ใน §6** ว่า Safety เป็น "คะแนนจากหน่วยงานความปลอดภัย (กรอกมือ)" — เอกสารทางการบอกว่าเป็น **จำนวนเคส** และคนกรอกคือ Center · **`safety_events.kind` ของเราต้อง map ลง 4 ชั้นนี้** (ตอนนี้เป็น near_miss/property/first_aid/medical/restricted/lti) ไม่งั้นเลขที่เราโชว์กับเลขที่เขารายงานไม่ตรงกันตลอดไป |

### 8.6 ชุด KPI ของ **GM Plant** (หน้า 39 — ใกล้บอร์ด PD ที่สุดที่เคยเห็น)

`Total Sales · EBIT · Customer Satisfaction (Q&D) ≥90% · Safety (+4 ข้อย่อย) · Overall Cost Improvement (100P) ≥0.90/≥1.00% ·
Cost Reduction ≤0.67/≤0.70 MB · Day Sales of Inventory (DSI) ≥12 Days · Annual Sale Per Head ≥2.29/≥2.34 MB ·
TS Academy ≥75/≥85% · Engagement Survey ≥80/≥85% · Engineering Day ≥1 Team · QCC ≥30%` — **Total Weight 50.00**

⇒ สังเกต: **`Inventory` ของระดับ Plant เป็น "DSI = จำนวนวัน"** ไม่ใช่มูลค่าบาท (ต่างจากที่ user ตอบไว้ §6 ข้อ 5
ซึ่งน่าจะเป็นของระดับส่วนงาน/ฝ่าย) — **ต้องถามว่าใบ PD ปี 2026 ใช้ตัวไหน** ก่อนตั้งหน่วยในทะเบียน

### 8.7 ขั้นตอนอนุมัติ (หน้า 42-52) — ชื่อสถานะทางการ

**ต้นปี (ม.ค.–มี.ค.) — ตั้งเป้า** (มี Email Alert ทุกขั้น)
```
1 Waiting for QSM Input Data → 2 Waiting for Owner Submission → 3 KPI Owner Submitted
→ 4 Supervisor Approval Initial → 5 Manager QSM Verified
```
- QSM กรอกไม่ครบ → **ปุ่ม "Send KPI" ไม่โผล่**
- แก้ Commit/Target หลังอนุมัติ = **Revised KPI (Rev.01) ต้องส่ง KPI Audit เท่านั้น หน่วยงานแก้เองไม่ได้**

**ปลายปี (อย่างน้อย 5 วันทำการก่อนปิดปีของแต่ละ Plant) — ส่งผล**
```
1 KPI Result Submitted → 2 Supervisor Approval - Final → 3 Internal Audit Approval - Final
→ คะแนนวิ่งเข้าระบบ PEV อัตโนมัติ
```
- ปุ่ม **"Send KPI" โผล่เฉพาะเดือนธันวาคม**
- **e-Signature:** อัปโหลดลายเซ็น (JPG/PNG) ครั้งแรกครั้งเดียว ระบบจำไว้ · แก้ภายหลังได้

### 8.8 ใบที่พิมพ์ออกมา (หน้า 37-38)

- **Appraisal → `FM-HRM-6-022(01)`** (มุมล่างขวาใบ) · หัวใบ `APPRAISAL FORM <ปี>` · `PM CODE` · ชื่อบริษัท ·
  Name/Code · Position Title · Working Year · Age (Year) · Department · Cost Center · `Part 4 : Manager` · `REV : 0`
  · ตาราง: Function · KPI's Description · Commitment · Target · Result · Weight · **Appraisal Result (0 / 0.5 / 1)** · Point(s)
  · ท้ายใบ `Total Weight` / `Total Point` + ช่องเซ็น 4 ช่อง: **Responsibility Manager · Supervisor 1 (General Manager) · Supervisor 2 · Verify By QSM (For Manager Only)**
  ⇒ **ปิดคำถามข้อ 6 ใน §6 (เลขฟอร์ม)** — ถ้าจะทำปุ่มพิมพ์ใบนี้ใน ESM ให้ seed `doc_forms` ด้วยคีย์นี้
  · ⚠️ แต่**ทบทวนก่อนทำ**: ใบนี้ระบบกลางพิมพ์ได้เองอยู่แล้ว ทำซ้ำ = เอกสาร 2 ใบที่อาจไม่ตรงกัน (ดู §8.0)
- **Monitoring** = `Monitoring of The Year <ปี> / Department & Section` · คอลัมน์ `No · Perspective · Topic · Formula · Scope · Commitment · Target · Result(Month) Jan–Dec · Average/Total · Status Point` + ท้ายใบ `Total Point` · หัวใบมีช่อง Responsibility/Date + Approve by/Date (ยังไม่เห็นเลขฟอร์มในหน้าที่ได้)
- **Export Excel "KPI Personal Report"** — คอลัมน์ `Plant · EmpCode · Function · Perspective · Node · KPIGuideline · Commit · Target · Result · Weight · 0 · 0.5 · 1 · Point`

### 8.9 หน้า Dashboard ของเขา (หน้า 39-40) — การ์ด 8 ใบ

`Total KPIs · Total Point KPIs (Average Score) · Total Sales (MB) · %EBIT · Customer (%) · Inventory (Days) · 100P (%) · Safety (Case — "Incident count")`

### 8.10 สิ่งที่ต้องทำต่อใน ESM (เรียงตามคุ้ม ÷ เสี่ยง)

| # | งาน | เหตุผล |
|---|---|---|
| 1 | **เกณฑ์ 1 / 0.5 / 0 แทน band เดา** ใน `obeyaKpi.js` + `obeya.js` (+ เทสล็อกด้วยตัวเลขจริง 6 แถวใน §8.3) | เกณฑ์ปัจจุบันเป็นของปลอม · ของจริงมีเอกสารแล้ว |
| 2 | เพิ่ม `commitment_*` + `compare` + `weight` + `creator` + `summary` + `perspective` ใน `kpi_definitions`/`kpi_catalog` | ไม่มี 4 ช่องนี้ = เอาไปกรอก KPI Online ต่อไม่ได้ ต้องพิมพ์ใหม่ทั้งใบ |
| 3 | **map `safety_events.kind` → 4 ชั้นทางการ** (Serious / Absent >3 Days / Absent <3 Days / Minor Injures) | ไม่ map = เลขเราไม่มีวันตรงกับเลขที่เขารายงาน |
| 4 | Total Weight = 50 + คะแนนรวม | เป็นตัวเดียวที่ผู้บริหารดูจริงปลายปี |
| 5 | Training = `(ผ่านอบรม / พนักงานทั้งหมด) × 100` สะสม จาก `ojt_training_attendees` | นิยามชัดแล้ว ทำอัตโนมัติได้ |
| 6 | ดูว่ามี incoming inspection ในระบบไหม → เติม **Incoming Quality Rate** ให้อัตโนมัติ | KPI ทางการอีกตัวที่เราอาจคำนวณให้ฟรี |

### 8.11 คำถามที่ต้องถาม (KPI Audit หรือ QSM ประจำ Plant)

1. ใบ **PD ปี 2026** ใช้ `Inventory Balance (บาท)` หรือ `DSI (วัน)` — คู่มือระดับ Plant ใช้ DSI
2. สูตรทางการของ **%RM** (ตอนนี้เราเดาว่า `ต้นทุนวัตถุดิบ ÷ Sale from product × 100`)
3. **Safety**: ค่าที่กรอกคือ "จำนวนเคส" (ตามคู่มือ) หรือ "คะแนนจากหน่วยงานความปลอดภัย" (ตามที่เคยได้ยิน) — และกรณี `Commit 0 / Target 1` ตัดสินคะแนนยังไง
4. เกณฑ์ "**ผ่าน**อบรม" ของ TS Academy (คะแนน post-test เท่าไหร่ถือว่าผ่าน)
5. **OEE เป้า 87%** เป็นเป้ากลางทั้งกลุ่ม หรือแต่ละ Plant/สายงานตั้งเอง (ของเราตั้งราย parent line)
6. ESM export ให้ตรงช่อง KPI Online ได้ไหม / มี API หรือ import ไฟล์หรือไม่ (ถาม IT: Ampon.Tan · Rujirott.Som)
