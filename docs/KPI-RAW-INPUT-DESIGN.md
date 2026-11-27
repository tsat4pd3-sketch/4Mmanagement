# KPI — กรอก "ตัวเลขดิบ" ให้ระบบคิดเอง (แผนอัพเกรด · ร่าง 2026-11-26)

> สถานะ: **ออกแบบไว้ ยังไม่ลงมือ** — รอ user เคาะคำถาม §5 ก่อน (กติกา `*-DESIGN.md` ใน CLAUDE.md §File Structure)
> คำสั่ง user 26/11: *"ปัจจุบันหลายค่าเป็นการกรอกข้อมูลที่ผ่านการคำนวณมาแล้ว อยากให้กรอกข้อมูลดิบมากกว่า และระบบคิดให้"*
> อ่านคู่กับ `docs/OBEYA-KPI-SOURCES.md` §8.5 §12.2 (สูตรทางการ) · `docs/modules/obeya-kpi-board.md` · `src/utils/kpiSetup.js` (`KPI_BASE_VARS` · `KPI_FORMULAS`) · `src/utils/kpiFormula.js`

## 0. หลักการ (ไม่เปลี่ยน — ต่อยอดของเดิม)
1. **ตัวเลขดิบกรอกที่เดียว = `kpi_base_inputs`** (ตัวแปรฐาน) · สูตรอยู่ `KPI_FORMULAS` ที่เดียว · ค่ารายเดือนของ KPI = `applyFormulaEntries()` **ห้ามคิดในหน้า** (กฎ CLAUDE.md §OBEYA)
2. **ตัวแปรขาด = `null` ห้ามเดา 0** · จอเขียนว่าขาดตัวแปรอะไร เดือนไหน (`formulaNoteText` มีแล้ว)
3. **ค่าที่ระบบมีอยู่แล้วในฐานปฏิบัติการ (OEE · PPM · downtime · MO · safety_events · improvements · employees) = "แหล่งอัตโนมัติ" ของตัวแปรฐาน** — กรอกมือชนะเสมอ + ติดป้าย ≈ (แบบ `headcountAuto` ที่ทำไว้แล้ว) **ห้ามเขียนค่าอัตโนมัติกลับลงฐาน**
4. ค่า % ที่กรอกไว้แล้ววันนี้ **ไม่ลบ ไม่ backfill** — ยังเป็น "กรอกมือชนะ" จนกว่าตัวเลขดิบเดือนนั้นครบ (`usedManual` เดิม) · บอร์ดไม่เปลี่ยนเลขย้อนหลังเงียบๆ
5. ทะเบียนมาตรฐานกลุ่ม (`kpi_standard_items.formula_text`) = ที่มาของสูตร — ESM ไม่คิดสูตรเอง (กฎ KPI Online)

## 1. Audit สถานะวันนี้ (ปี 2026 · ฐานจริง 26/11)

### 1.1 ✅ ทำแล้ว — กรอกดิบ + ระบบคิด (6 ตัว)
| KPI | ตัวแปรฐาน | สูตร | หมายเหตุ |
|---|---|---|---|
| %RM | raw_material (หน่วย) · sale_product (โรงงาน) | `rm_pct` | 5/5 นิยามเป็นสูตรแล้ว |
| DL+OH | dl · oh (หน่วย) · sale_product | `dloh_pct` (parts dl/oh) | 9/10 นิยามเป็นสูตร · **ยังมี 76 ช่องที่กรอกเป็น % ไว้ก่อนมีสูตร** |
| 100P | cost_100p · sale_product | `p100_pct` | **1/7 นิยามเท่านั้นที่เป็นสูตร** — อีก 6 หน่วยยังกรอก % ที่คำนวณมาแล้ว (69 ช่อง) ทั้งที่ cost_100p มีครบ PD1-3/QA |
| DSI | inventory_baht · cogs · days_in_month | `inventory_day` | 3/4 |
| ยอดขาย/หัว | sale_total · manpower (auto จาก employees) | `sale_per_head` | 6/6 |
| Customer Satisfaction | csat_* ← `kpi_csat_scores` (trigger) | `csat_qd_pct` | ครบ — ต้นแบบของ "ดิบ → รวม → สูตร" |

### 1.2 ⚡ ระบบคำนวณจากฐานปฏิบัติการแล้ว แต่ "ใบ KPI" ยังกรอกมือทับ
| KPI | ระบบคิดจาก | สถานะใบ KPI |
|---|---|---|
| OEE · PPM · COPQ (PD) | production_sessions · defect_logs (DR) — แถว "KPI คำนวณอัตโนมัติ" ในแท็บเดียวกัน | นิยาม OEE/PPM ยังกรอกมือ 49 ช่องต่อตัว (กฎ "กรอกมือชนะ") · COPQ PD3/PD4 16 ช่อง |
| MO Closed · MBD · MTBF · MTTR | `kpi_mtn_rollup` (DR) ผ่าน `kpiAuto.js` — **เฉพาะทีมที่ map `equipment_kind` (JIG MTN)** | Electric/Mechanic/Preventive/Tooling MTN กรอกมือ 40–50 ช่องต่อตัว |

### 1.3 🎯 เป้าหมายของแผนนี้ — กรอก "ค่าที่คำนวณแล้ว" ไม่มีตัวแปรฐาน
| KPI (ช่องกรอกปี 2026) | สูตรทางการ (`kpi_standard_items`) | ตัวเลขดิบที่ควรกรอก/ดึง | แหล่งอัตโนมัติที่มีอยู่แล้ว |
|---|---|---|---|
| QCC % (67 ช่อง · 10 หน่วย) | *Refer to activity announcement* — **ESM ยังไม่รู้นิยาม** | ทีมที่ส่ง · ทีมที่ผ่าน (หรือ คนเข้าร่วม/ทั้งหมด) | — (ถาม §5.1) |
| TS Academy % (69 · 9) | (Passed training employee ÷ Total Employee) × 100 · สะสม เอาเดือนล่าสุด | คนผ่านอบรมสะสม · จำนวนพนักงาน | ตัวหาร = `headcountAuto` (employees) มีแล้ว · ตัวตั้งต้องมีรายชื่อจาก Academy |
| Machine Break Down % (50 · 5 ทีม) | ชม.หยุด ÷ (730 × จำนวนเครื่อง) × 100 | ชม.เครื่องหยุด · จำนวนเครื่อง | `kpi_mtn_rollup` ถ้าทีมนั้น map equipment_kind |
| MTBF · MTTR (40+40 · 4 ทีม) | [(730×เครื่อง) − ชม.เสีย] ÷ เครื่อง · ชม.เสีย ÷ จำนวนครั้ง | ชม.เสียรวม · จำนวนครั้ง · จำนวนเครื่อง | เดียวกับข้างบน |
| MO Closed on target % (24 · 4) | MO ปิดตามเป้า ÷ MO ทั้งหมด × 100 | 2 ตัวนับ | `mtn_orders` (ทีมที่ map) |
| PM Machine · PM on Plan % (30 · 3) | ทำได้ ÷ แผน × 100 | PM ที่ทำ · PM ตามแผน | โมดูล PM (`pm-predictive`) มีแผน/ผลอยู่แล้ว |
| Safety (108 ช่อง · 12 หน่วย) | นับ Case · **4 ชั้นทางการ** (Serious · Absent >3d · Absent <3d · Minor) | จำนวนเหตุการณ์รายชั้น | `safety_events` (Main) — ต้องมี severity 4 ชั้น |
| Cost Reduction / CR (MTN) / 100P&CR Tooling (53 ช่อง) | CR value from improvement project | บาทที่ลดได้ต่อโครงการ ต่อเดือน | `/improvements` cost saving (DR · `costSaving.js` rate ต่อ CC) |
| Engineering Day (30 · 6) | Number of Passed Activity | จำนวนทีม/กิจกรรมที่ผ่าน | ยังไม่มีทะเบียน (ไฟล์กิจกรรม) |
| Internal Satisfaction % (10 · 2) | Actual Score ÷ Total Score × 100 | คะแนนที่ได้ · คะแนนเต็ม (เหมือน csat) | — |
| Inventory Balance (บาท · BIG/SMALL PRESS · 20 ช่อง) | ใบบอร์ด: Inventory ÷ (Sale product ÷ 30) = วัน | inventory_baht (มีแล้วทั้ง 2 แผนก) | สลับนิยามเป็นสูตร `inventory_day` ได้เลย |
| Non NC Major (39) | นับ Case | เป็นตัวเลขดิบอยู่แล้ว | — |
| Air Leak % (7 · Electric) | ไม่มีในทะเบียนมาตรฐาน | ต้องถามนิยาม | — |

### 1.4 ⏸ ตัวที่ user สั่ง "เอาแบบเดิมก่อน" (26/11) — QCC · TS Academy (+ Engineering Day · 100P กิจกรรม)
- **กรอกค่าเหมือนวันนี้ต่อไป** — ไม่สร้างตารางดิบ/ตัวนำเข้าของ KPI เอง เพราะ **หมวด "กิจกรรม" กำลังถูกสร้างโดยอีก session** (25/11 · `src/pages/Activity.jsx` · ทะเบียน `src/utils/activityPages.js` · 9 หน้า: 100P · 5S · Smart Factory · KYT · Kaizen · QCC · Lean · CFO · CFP · **ยังไม่มีฐานข้อมูล**)
- สัญญาเชื่อมโยงที่เสนอ (ทำเมื่อหมวดกิจกรรมมีฐานแล้ว · ตกลงกับเจ้าของโมดูลนั้นก่อน ห้ามทำซ้ำ 2 ที่):
  · โมดูลกิจกรรมเป็น **เจ้าของตัวเลขดิบ** (ทีมที่ส่ง/ผ่าน · กิจกรรมที่ผ่าน · มูลค่า 100P ต่อโครงการ) ตามขอบเขตผังองค์กร + เดือน
  · ฝั่ง KPI อ่านเป็น **แหล่งอัตโนมัติของตัวแปรฐาน** (§2.2) เช่น `qcc_submitted/qcc_passed` · `eng_day_passed` · `cost_100p` — กรอกมือชนะ · ติดป้าย ≈ · ไม่เขียนกลับ
  · นิยาม "% QCC" ยังต้องมาจากประกาศกิจกรรมของกลุ่ม (§5.1) — โมดูลกิจกรรมเก็บตัวนับ ฝั่ง KPI ถือสูตร
- TS Academy: รอรูปแบบรายชื่อจาก Academy (§5.2) · ตัวหารจาก `headcountAuto` พร้อมแล้วเมื่อถึงเวลา

## 2. สถาปัตยกรรม — ขยาย 3 ชั้นเดิม ไม่สร้างระบบใหม่

### 2.1 ชั้นตัวแปรฐาน (`KPI_BASE_VARS` + `kpi_base_inputs`)
- `kpi_base_inputs.var_key` เป็น text อยู่แล้ว ⇒ **เพิ่มตัวแปรได้โดยไม่แก้ schema** (เช็ค constraint/trigger ก่อน) · เพิ่ม `group` ให้ตัวแปร (`finance` · `people` · `activity` · `mtn` · `safety`) ใช้จัดหมวดในแผงกรอก
- ตัวแปรใหม่ (ชื่อชั่วคราว): `qcc_submitted` · `qcc_passed` · `ts_passed_cum` · `mbd_stop_hr` · `mc_count` · `fail_count` · `mo_total` · `mo_on_target` · `pm_plan` · `pm_done` · `isat_actual` · `isat_total` · `cr_baht` · `eng_day_passed` · `safety_l1..l4`
- ตัวแปรแบบ **count** ต้องมี `summary` ของตัวเอง (รวมปี = Σ) แยกจากตัวแปรแบบ **stock** (สิ้นเดือน) และ **cumulative** (TS Academy = เดือนล่าสุด) — ใส่ที่ตัวแปร ไม่ใช่ที่หน้า

### 2.2 ชั้นแหล่งอัตโนมัติ (`autoVars` — แบบ `headcountAuto`)
- ของกลางใหม่ `src/utils/kpiAutoVars.js`: `{ var_key → get(scopeKey, month) → number|null }` รวมแหล่ง: employees (มี) · `kpi_mtn_rollup` (มี · ย้ายมาเป็นตัวแปรแทนแถว ⚡) · `safety_events` · `improvements` (DR) · PM · defect cost (DR)
- กติกาเดิม: **กรอกมือชนะ** · ค่าอัตโนมัติติดป้าย ≈ + tooltip บอกที่มา · ระดับที่แหล่งตอบไม่ได้ (ไลน์/CC) = `null` ไม่เดา · โหลดไม่ได้ = จอเขียน ไม่ใช่ 0
- 🔴 DR เป็น anon-open — ตัวเลขจาก DR เป็น "ค่าประกอบ" ให้คนยืนยัน ไม่ใช่ค่าทางการจนกว่าจะผ่าน Edge Function (known gap เดิม)

### 2.3 ชั้นสูตร (`KPI_FORMULAS`) — เพิ่มสูตรตามทะเบียนมาตรฐาน
`qcc_pct` · `ts_academy_pct` (summary max) · `mbd_pct` · `mtbf_hr` · `mttr_hr` · `mo_closed_pct` · `pm_pct` · `isat_pct` · `cr_baht_sum` · `safety_cases` (Σ 4 ชั้น · parts) — ทุกตัวมีเทสใน `kpiFormula.test.mjs` + `kpiSetup.test.mjs` (ขาไม่ครบ = null)
· KPI ที่เป็นสัดส่วน "ตัวตั้งรวม ÷ ตัวหารรวม" ตอนรวมข้ามหน่วย/รวมปี ใช้ `rollup_mode='formula'` ที่ทำไว้ 25/11 — ห้ามเฉลี่ย %

### 2.4 ชั้นจอ (`/obeya?tab=table`)
- แผง "ตัวเลขฐาน" (`KpiBaseInputsPanel`) กลายเป็น **ที่กรอกหลัก** แบ่งหมวดตาม §2.1 · แถวที่มีค่าอัตโนมัติโชว์ ≈ ก่อน กรอกทับได้
- ตาราง KPI: ช่องของ KPI ที่เป็นสูตร = อ่านอย่างเดียว 🧮 (มีแล้ว) · ปุ่ม "กรอกค่าตรง" เฉพาะกรณีพิเศษ ต้องใส่เหตุผล (ลง `kpi_month_notes`) — ป้องกันกลับไปกรอก % เงียบๆ
- นำเข้าไฟล์ผ่าน `ImportKit` เดิม (มี `kpi_base` · `kpi_csat`): เพิ่ม `kpi_ts_academy` (รายชื่อผ่านอบรม) · `kpi_qcc` (ผลกิจกรรม) เมื่อรู้รูปแบบไฟล์
- ใบพิมพ์/Excel 3 ชีท: ชีท Monitoring โชว์ "ดิบ → ค่า" ให้ตรวจสอบได้ (ต้นแบบ 100P/DL-OH ที่มี)

### 2.4b 🔒 สวิตช์ "คัทออฟกรอกมือ" ของ admin (คำสั่ง user 26/11)
> *"กรอกมือทับค่าที่คำนวณจากระบบ ต้องมีไว้ช่วง implement แรก แต่ต้องมีปุ่มให้ admin คัทออฟระบบ manual ทับได้"*

- **ช่วงเปลี่ยนผ่าน = กรอกมือชนะ (เหมือนวันนี้)** · เมื่อหน่วยนั้น/KPI นั้นพร้อม admin กด **คัทออฟ** ⇒ ค่าทางการ = ค่าที่ระบบคิด (สูตร/อัตโนมัติ) เท่านั้น ช่องกรอกมือปิด
- **ที่เก็บ = ทะเบียน KPI (`kpi_catalog.manual_policy`)** ค่า `allow` (default · กรอกมือชนะ) | `locked` (คัทออฟ) — เป็นของ "ตัวตน KPI" ไม่ใช่รายแถว เพราะ 1 KPI มีนิยามหลายหน่วย ·
  + สวิตช์ระดับโรงงาน `kpi_settings.manual_policy_default` (ตัวเดียว · คัทออฟทั้งโรงงานทีเดียว) — ลำดับ: ทะเบียน KPI ชนะค่า default
  + ต้องการคัทออฟเฉพาะบางหน่วย = ตั้งที่นิยาม (`kpi_definitions.manual_policy` null = ตามทะเบียน) — เฟสหลัง ถ้าจำเป็นจริง
- **ตัดสินที่เดียว**: `valueSourceOf(def, month, { policy })` ใน `src/utils/kpiFormula.js` (ต่อจาก `usedManual`) คืน `manual | formula | auto | none` + เหตุผล — **ห้ามให้หน้าใดตัดสินเอง** (ด่าน grep `entries[...]` นอก util) · ใช้ทั้งบอร์ด · ตารางกรอก · ใบพิมพ์ · Excel · PPTX
- **คัทออฟแล้วไม่ลบของเดิม**: `kpi_manual_entries` คงอยู่ (ย้อนได้ทันทีด้วยการปลดล็อก) · ช่องในตารางโชว์ค่าระบบ 🧮 และค่าที่เคยกรอกเป็นตัวขีดฆ่า/จาง + tooltip "ถูกคัทออฟ · ค่าที่เคยกรอก X" (กฎความซื่อสัตย์ · เลขบนบอร์ดเปลี่ยนต้องเห็นว่าเปลี่ยนจากอะไร)
- **ก่อนกด ต้องเห็นผลกระทบ**: โมดัลยืนยัน (ของกลาง `signConfirm.js`) บอก "คัทออฟ KPI X · จะเปลี่ยนตัวเลข N ช่องใน M หน่วย (รายการเดือนที่ค่าระบบ ≠ ค่ากรอก · เดือนที่ระบบยังไม่มีค่า = จะว่าง)" — เดือนที่ระบบคิดไม่ได้ **ขึ้น "—" ไม่ถอยไปใช้ค่ากรอกเงียบๆ** (ไม่งั้นคัทออฟไม่จริง)
- **สิทธิ์**: คีย์ใหม่ `kpi:cutoff` (insert `permission_catalog` + seed admin เท่านั้น) — ไม่ผูกกับ `kpi:manage` (คนกรอกต้องปลดล็อกเองไม่ได้) · RLS ของคอลัมน์ policy ผ่าน `has_perm('kpi:cutoff')` · audit trigger บันทึกใคร/เมื่อไร
- **ที่กด**: แท็บ ⚙️ ตั้งค่า → 📘 ทะเบียนชื่อ KPI (ต่อ KPI) + แถบสถานะใบมีป้าย "🔒 ค่าระบบเท่านั้น" เมื่อถูกคัทออฟ · สวิตช์ทั้งโรงงานอยู่หน้าเดียวกันเฉพาะ admin
- ลำดับแนะนำ: คัทออฟทีละ KPI เมื่อ (ก) ตัวเลขดิบครบย้อนหลังถึงต้นปี (ข) เทียบค่าระบบกับค่ากรอกแล้วต่างกันอธิบายได้ · รายงาน diff นี้ = เฟส 4 ในตาราง §3 (ทำก่อนกด ไม่ใช่หลัง)

### 2.5 ฐานข้อมูล
- ไม่แก้โครง `kpi_base_inputs` · migration ต่อเฟส = **สลับ `kpi_definitions.provider → 'formula'` + `provider_config.formula`** ของ KPI นั้น (แบบ `20261019_kpi_fin_defs_to_formula_main.sql`) — ย้อนได้ด้วยการตั้งกลับเป็น manual
- คอลัมน์ใหม่ `kpi_catalog.manual_policy text default 'allow' check in ('allow','locked')` + ตาราง/แถว `kpi_settings` (ค่า default ทั้งโรงงาน) + คีย์สิทธิ์ `kpi:cutoff` ใน `permission_catalog` — ย้อนได้ (ค่า default = พฤติกรรมเดิมเป๊ะ)
- ตารางดิบใหม่ (ถ้าต้องมี): `kpi_ts_academy_passes` (รายคน × หลักสูตร × เดือน) · `kpi_activity_results` (QCC/Eng Day รายทีม) — ทั้งคู่ Main · RLS `has_perm('kpi:manage')` · trigger rollup → `kpi_base_inputs` เหมือน `kpi_csat_rollup`
- audit trigger ทุกตารางใหม่ · GRANT ครบ · `permission_catalog` ถ้ามีคีย์ใหม่

## 3. เฟสการทำ (เรียง คุ้ม ÷ เสี่ยง)
| เฟส | ขอบเขต | ต้องเคาะก่อน | ประมาณ |
|---|---|---|---|
| **0 — ปิดของที่มีสูตรอยู่แล้ว** (ไม่แตะ schema) | 100P: สลับ 6 นิยามเป็นสูตร (cost_100p มีครบ) · DL+OH ทีมช่าง: กรอก dl/oh ของ Electric/Mechanic/Preventive · Inventory Balance BIG/SMALL PRESS → `inventory_day` · เพิ่มด่าน "KPI ที่มีสูตรในทะเบียน ห้ามสร้างนิยาม manual ใหม่" · **ด่านทะเบียนซ้ำ**: เพิ่ม KPI ชื่อใกล้ทะเบียนเดิม = เสนอให้ใช้ตัวเดิม (ข้ามหน่วย) · แถวตั้งหน่วยต่างจากทะเบียน = เตือน · บอร์ดรวมหน่วยต่างกัน = เขียนว่ารวมไม่ได้ (เคส 26/11 MTTR/MTBF/CR/DL+OH ซ้ำ) | §5.3 (หน่วย Inventory = วัน?) | 1 session |
| **1 — ช่างทุกทีม** | ตัวแปร mbd_stop_hr/mc_count/fail_count/mo_* + สูตร 4 ตัว · auto จาก `kpi_mtn_rollup` สำหรับทีมที่ map equipment_kind · ที่เหลือกรอกดิบ | §5.5 | 1–2 session |
| **2 — คน/กิจกรรม** | Internal Satisfaction (score/total) · Cost Reduction ← improvements · **QCC · TS Academy · Engineering Day = คงกรอกมือ (§1.4) รอหมวดกิจกรรมมีฐาน** | §5.4 (§5.1 §5.2 เลื่อนไป) | 1 session |
| **3 — ความปลอดภัย/PM/คุณภาพ** | Safety 4 ชั้น ← safety_events · PM on plan ← PM module · COPQ ← DR · OEE/PPM เลิกกรอกมือ | §5.3 §5.6 | 1–2 session |
| **4 — รายงาน diff + คัทออฟ** | รายงาน "ค่าระบบ vs ค่ากรอก" ต่อ KPI/หน่วย/เดือน · สวิตช์คัทออฟ (§2.4b) ต่อ KPI + ทั้งโรงงาน · admin กดทีละ KPI เมื่อ diff อธิบายได้ | — | 1 session |

ทุกเฟส: migration ย้อนได้ · เทสสูตร · mock harness (`audit/mockSupabase.js` ต้องมีแถวตัวแปรใหม่ไม่งั้นสาขาไม่ถูกรัน) · crashsweep 3 role · เอกสาร `obeya-kpi-board.md` + `OBEYA-KPI-SOURCES.md`

## 4. สิ่งที่ห้ามทำ
- ห้ามคิดสูตรที่ทะเบียนมาตรฐานเขียนว่า "*Refer to … announcement*" เอง (QCC · Engineering Day · Safety) — ต้องได้ประกาศจริงก่อน
- ห้ามมีที่ตัดสิน "กรอกมือชนะหรือไม่" มากกว่า 1 จุด (`valueSourceOf` เท่านั้น) · คัทออฟแล้วห้ามถอยไปใช้ค่ากรอกเงียบๆ ในเดือนที่ระบบไม่มีค่า
- ห้ามเขียนค่าอัตโนมัติลง `kpi_base_inputs`/`kpi_manual_entries` (ค่าสดคิดตอนอ่าน · trigger rollup ใช้เฉพาะตารางดิบที่คนกรอก/นำเข้า)
- ห้ามลบ/ทับค่า % ที่กรอกไว้แล้ว · ห้ามเปลี่ยนเลขบอร์ดย้อนหลังโดยไม่มีป้าย
- ห้ามแตก Q/D, DL/OH, Safety 4 ชั้น เป็นแถว KPI (กฎ parts — น้ำหนัก/คะแนนนับซ้ำ)

## 5. คำถามที่ต้องให้ user เคาะก่อนเขียนโค้ด
> ข้อ 1–2 (QCC · TS Academy) **เลื่อนไป** — user 26/11 ให้คงแบบเดิมก่อน รอหมวดกิจกรรมมีฐานข้อมูล (§1.4)
1. **QCC** — "% ของอะไร": ทีมผ่าน ÷ ทีมส่ง? คนเข้าร่วม ÷ พนักงาน? และผลออกรายเดือนหรือรายรอบ
2. **TS Academy** — ตัวตั้ง "ผ่านอบรม" นับหลักสูตรไหน · รายชื่อมาจากไฟล์ Academy (รูปแบบ?) · ตัวหารใช้ทะเบียน `employees` ของ ESM ได้ไหม (PD1 ในทะเบียน 32 คน — ครบจริงหรือยัง)
3. **OEE / PPM / COPQ / Inventory ของ PD** — ให้ค่าระบบเป็นทางการเลย (เลิกกรอกมือ) ได้หรือยัง · Inventory Balance ของ BIG/SMALL PRESS หน่วย "วัน" ตามแผ่นบอร์ด หรือ "บาท"
4. **Cost Reduction** — นับเฉพาะโครงการใน `/improvements` ที่อนุมัติ/ปิดแล้ว? แยก 100P กับ CR ด้วยอะไร (ประเภทโครงการ?) · ทีมช่าง CR (MTN) ใช้แหล่งเดียวกันไหม
5. **ทีมช่าง Electric / Mechanic / Preventive / Tooling MTN** — เครื่องในทะเบียน `machines.equipment_kind` map ครบพอให้ auto เหมือน JIG MTN ไหม (ถ้าไม่ครบ = กรอกดิบไปก่อน)
6. **Safety** — `safety_events` วันนี้บันทึกความรุนแรงครบ 4 ชั้นตามประกาศไหม · ใบ PD นับชั้นไหนบ้าง (§10.4 ไลน์ = 3 ชั้น ต่างจาก PD3)
7. **Internal Satisfaction** — ใครให้คะแนน ความถี่ (รายเดือน/ครึ่งปี) · คะแนนเต็มเท่าไร
8. **Engineering Day** — ทะเบียนกิจกรรม/ทีมอยู่ไหน (ไฟล์? บอร์ด?) นับ "ผ่าน" ตามอะไร
