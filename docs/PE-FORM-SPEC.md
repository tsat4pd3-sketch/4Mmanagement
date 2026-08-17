# สเปกฟอร์ม PE Core Tools (PFC / PFMEA / Control Plan) + แนวทาง Export กลับ 100%

> แกะจากไฟล์จริงของ TSAT — `MB3B-8C306-BE` (FMEA Rev.16 · CNP Rev.9 · PFC Rev.05) และ `P703 RH/LH`
> อัพเดท 2026-08-14 · **เอกสารนี้คือ "สัญญา" ระหว่างตัวนำเข้า (`src/utils/peExcelImport.js`) กับตัวส่งออก**
> แก้ตัวใดตัวหนึ่งต้องมาอัพเดทที่นี่

---

## 0. ข้อสรุปสำคัญที่สุด — Export 100% ต้องใช้ "ไฟล์ต้นฉบับเป็นแม่แบบ" ห้ามวาดใหม่

**วัดจริงแล้ว: ไม่มี library ไหน round-trip ไฟล์ PFC ได้**

| วิธี | ขนาดไฟล์ | drawing | media | วัตถุในผัง (shape/connector/pic) |
|---|---|---|---|---|
| ต้นฉบับ | 1,185 KB | 7 | 31 | **700** |
| อ่าน→เขียนด้วย **ExcelJS** | 924 KB | 7 | 32 | **45** (เหลือ 6%) |
| อ่าน→เขียนด้วย **SheetJS** | 1,151 KB | 0 | 0 | **0** |

**PFC ไม่ใช่ตาราง — เป็นผังที่วาดด้วยรูปทรง Excel จริง** (`flowChartProcess`, `flowChartDecision`,
`flowChartMerge`, `ellipse`, `straightConnector1`, `bentConnector2` …) กระจายใน 7 ชีท รวม ~560 รูปทรง
+ 59 รูปภาพ + กลุ่ม (grpSp) ซ้อนกัน · **ExcelJS สร้าง shape ไม่ได้เลย** และตอนเขียนกลับก็ทิ้งไป 94%

**→ วิธีเดียวที่ได้ 100% คือ "แก้เฉพาะค่าในเซลล์ของไฟล์ต้นฉบับ" (surgical edit ใน zip)**

```
ไฟล์ต้นฉบับ (.xlsx = zip)
  ├── xl/worksheets/sheetN.xml   ← แก้เฉพาะ <c r="C12"><v>…</v></c> ของเซลล์ที่รู้ที่อยู่
  ├── xl/drawings/*.xml          ← ไม่แตะ (ผัง/รูปทรง/เส้นเชื่อม)
  ├── xl/media/*                 ← ไม่แตะ (โลโก้/รูป)
  ├── xl/printerSettings/*       ← ไม่แตะ (ตั้งค่าพิมพ์)
  ├── xl/styles.xml              ← ไม่แตะ (ฟอนต์/เส้นขอบ/สี)
  └── xl/externalLinks/*         ← ไม่แตะ (ลิงก์ไปไฟล์อื่น)
```
สิ่งที่ไม่แตะ = เหมือนเดิม **แบบ byte-identical** → 100% โดยนิยาม ไม่ต้องพิสูจน์ทีละจุด

**สิ่งที่ตัวนำเข้าต้องเก็บเพื่อให้ export ทำได้ (ทำแล้วบางส่วน):**
- ✅ `_row` / `_nrows` ของทุก record (แถวที่มันอยู่ในชีทต้นฉบับ) — `parseFmeaSheet` / `parseCpSheet`
- ✅ `parseFormHeader().cells` — ที่อยู่เซลล์ของทุกฟิลด์ในหัวเอกสาร
- ⬜ ชื่อชีทต้นทางของแต่ละ record (ตอนนี้รู้ระดับ OP แต่ยังไม่เก็บลง DB)
- ⬜ ตัวไฟล์ต้นฉบับ (ต้องเก็บใน Storage + checksum)
- ⬜ ตัวเขียน zip (`fflate`/`jszip` — มีใน node_modules แล้วแต่เป็น transitive ต้องประกาศเป็น dep จริง)

> ⚠️ **ห้ามทำ export ด้วยการวาดฟอร์มขึ้นใหม่จากศูนย์** (แบบ `scrapExportExcel.js`) — กับ 3 ฟอร์มนี้ทำไม่ได้จริง
> และขัดกฎเดิมของโปรเจค "ห้ามจำลอง layout ใบจริงมาไว้อีกที่" (CLAUDE.md · docFormPreview / VSM)

---

## 1. โครงไฟล์ (จากไฟล์จริง MB3B-8C306-BE)

| | PFMEA | Control Plan (CNP) | Process Flow (PFC) |
|---|---|---|---|
| จำนวนชีท | 28 | 27 | 7 |
| ชีทข้อมูล | 26 (ชีทละ OP) | 25 (ชีทละ OP) | — (เป็นผังวาด) |
| ชีท cover | `FM-PE-017 P.1`, `306` | `306` | `306` |
| ขนาดชีท | 71 คอลัมน์ × 115 แถว | 14 คอลัมน์ × 77 แถว | **156 คอลัมน์** × 135 แถว |
| merge/ชีท | ~61 ช่วง | ~28 ช่วง | ~71 ช่วง |
| พิมพ์ | A4 แนวนอน ย่อ **35%** · `A1:S69` | A4 แนวนอน ย่อ **47%** · `A1:N77` | A4 แนวนอน ย่อ **63%** · `A1:EZ124` |
| drawing | ชีทละ 1 (โลโก้ + 11 กล่อง) | ชีทละ 1 | **560 รูปทรง + 59 รูป** |

**คอลัมน์แคบมากใน PFC (กว้าง 1–3) = ตารางถูกใช้เป็น "กระดาษกราฟ" ให้วางรูปทรง** — ยืนยันว่าเนื้อหาจริงอยู่ใน
drawing ไม่ใช่ในเซลล์

---

## 2. PFMEA — ชีทละ OP

**ข้อมูลเริ่มแถว 10** · หัวคอลัมน์อยู่แถว 8–9 (2 ชั้น) · จบที่แถวที่คอลัมน์ A มีเลขฟอร์ม (`FM-PE1-018`)

### หัวเอกสาร (แถว 1–7)
| เซลล์ | เนื้อหา |
|---|---|
| `B1` (merge B1:C2) | บริษัท ไทยซัมมิท โอโตโมทีฟ จำกัด / `B2` THAI SUMMIT AUTOMOTIVE CO.,LTD. |
| `D1` (merge ถึง S3) | POTENTIAL FAILURE MODE AND EFFECTS ANALYSIS |
| `A3` | PROCESS FMEA |
| `N4` | `FMEA Number: FMEA-P703-03` |
| `A5` | `Item : REINF ASY RAD SUPT LWR (MB3B-8C306-BE)` ← **เลขพาร์ทอยู่ในวงเล็บ** |
| `F5` | `Key Date: 08 March 2024` |
| `N5` | `Prepared By : …` |
| `A6` | `Model Year(s)/Program(s) : MY21` |
| `N6` | `FMEA Date (Original) : …` |
| `A7` | `Core Team : …(PE); …(QA); …(PD)` |

### คอลัมน์ข้อมูล (ตรงกับ `F_COLS` ในตัวแกะ)
| คอล | index | หัวตาราง (แถว 8/9) | ฟิลด์ |
|---|---|---|---|
| A | 0 | Item / Function | `item_function` (merge ครอบทั้ง OP → ต้อง `colLabelMap`) |
| B | 1 | Requirements | `requirement` |
| C | 2 | Potential Failure Mode | `failure_mode` ← **ต้องมีค่า** ถึงนับเป็น record ใหม่ |
| D | 3 | Potential Effect(s) of Failure | `effects` |
| E | 4 | Severity | `severity` ← **ต้องเป็น 1–10** ถึงนับเป็น record ใหม่ |
| F | 5 | Classification | `classification` (CC/SC) |
| G | 6 | Potential Cause(s) of Failure | `causes` |
| H | 7 | Current Process Controls **Prevention** | `prevention` |
| I | 8 | Occurrence | `occurrence` |
| J | 9 | Current Process Controls **Detection** | `detection_ctrl` |
| K | 10 | Detection | `detection` |
| L | 11 | **RPN** | — *(คำนวณ S×O×D ในแอปเสมอ ไม่เก็บ ไม่อ่าน)* |
| M | 12 | Recommended Action | `recommended_action` |
| N | 13 | Responsibility & Target Completion Date | `responsibility` |
| O | 14 | Action Results — Actions Taken & Effective | `action_taken` |
| P–R | 15–17 | Severity / Occurrence / Detection (ใหม่) | `new_severity` / `new_occurrence` / `new_detection` |
| S | 18 | RPN (ใหม่) | — *(คำนวณ)* |

**กติกาแถว:** แถวที่มี Severity(E) + Failure mode(C) = **เริ่ม record ใหม่** · แถวถัดไปที่ไม่มี = **บรรทัดต่อ**
ของ record เดิม (ต่อด้วย `\n` ทุกคอลัมน์ข้อความ) — ฟอร์มนี้ 1 record กินหลายแถวเป็นปกติ

---

## 3. Control Plan (CNP) — ชีทละ OP

**ข้อมูลเริ่มแถว 12** · หัวคอลัมน์แถว 8–11 (4 ชั้น) · จบที่แถวที่คอลัมน์ A มีเลขฟอร์ม

### หัวเอกสาร (แถว 1–7)
| เซลล์ | เนื้อหา |
|---|---|
| `A1` | CONTROL PLAN |
| `A3` | `£ Prototype £ Pre-Launch S Production` ← **ติ๊กด้วยฟอนต์ Wingdings** (`£`=ว่าง `S`=ติ๊ก) |
| `F3` | Key Contact / Phone · `K3` Date (Original) · `M3` Date (Revised) |
| `A4` | `Control Plan Number : CNP-P703-03` |
| `A5`→`C5` | Part Number → **ค่าอยู่คนละเซลล์** (`MB3B - 8C306 - BE` มีเว้นวรรครอบขีด) |
| `A6`→`C6` | Part Name → ค่าที่ C6 |
| `A7` EWO No. · `D7` `MODEL: P703,U704` · `F5/F6/F7` Core Team / PE Approve / QA Approve |
| `K5/K6/K7` | Customer Eng. / Customer Quality / Other Approval |

### คอลัมน์ข้อมูล (ตรงกับ `C_COLS`)
| คอล | index | หัวตาราง | ฟิลด์ |
|---|---|---|---|
| A | 0 | Part / Process Number | `sub_op` (`100.1`) — merge ครอบหลายแถว |
| B | 1 | Process Name / Operation Description | `sub_name` — **บรรทัดที่ 2+ คือเลข child part** |
| C | 2 | Machine, Device, Jig, Tools For Mfg. | `machine` |
| D | 3 | Characteristics **No.** | `char_no` ← **ต้องเป็นเลขล้วน** ถึงนับเป็น record ใหม่ |
| E | 4 | Characteristics — Product | `product_char` |
| F | 5 | Characteristics — Process | `process_char` |
| G | 6 | Special Char. Class | `special_class` |
| H | 7 | Methods — Person In Charge | `person` |
| I | 8 | Product/Process Specification Tolerance | `spec` |
| J | 9 | Evaluation Measurement Technique | `method` |
| K | 10 | Sample Size | `sample_size` |
| L | 11 | Frequency | `frequency` |
| M | 12 | Control Method | `control_method` |
| N | 13 | Reaction Plan / Related Documents | `reaction_plan` |

---

## 4. PFC — หัวเอกสารอยู่ในเซลล์ แต่ผังอยู่ใน drawing

หัวเอกสารกระจายข้ามคอลัมน์กว้างๆ และ **ป้าย / `:` / ค่า อยู่คนละเซลล์**

| ป้าย | `:` | ค่า |
|---|---|---|
| `B5` Supplier Name | `L5` | `M5` THAISUMMIT AUTOMOTIVE CO.,LTD. |
| `B6` Part Name | `L6` | `M6` REINF ASY RAD SUPT LWR |
| `B7` Part No. | `L7` | `M7` MB3B-8C306-BE |
| `AR5` Code Supplier | `BD5` | `BE5` GUD6A |
| `AR6` Model | `BD6` | `BE6` P703 |
| `AR7` Customer Name | `BD7` | `BE7` FTM |
| `BZ6` Page 2/5 · `DO5/DO6` Date · `DV6` Confirmed by · `EH6` Checked by · `EU6` Approved by |

→ `parseFormHeader()` จึงต้องรองรับทั้ง 3 แบบ (ค่าในเซลล์เดียวกัน / เซลล์ถัดไป / ข้าม `:` ไปอีกเซลล์)

---

## 5. ชีท cover → ประวัติการแก้ไข

ทุกไฟล์มีชีท cover ชื่อเลขท้ายพาร์ท (`306` / `060` / `061`) — **ขึ้นต้นด้วยเลขเหมือนชีท OP**
จึงแยกด้วยชื่อไม่ได้ ต้องแยกด้วย "แกะเป็นตารางข้อมูลได้กี่แถว" (0 แถว = ลองอ่านเป็น cover)

คอลัมน์วันที่ **ไม่คงที่** (เจอทั้ง B และ C) → หาเองจากคอลัมน์ที่มีวันที่จริงมากสุด แล้วอ่านที่เหลือแบบ offset:
`+1` suffix · `+2` ECN · `+3` เนื้อหา · `+6/+7/+8` ผู้จัดทำ/ตรวจ/อนุมัติ (ตรงกันทั้ง 2 layout ที่เจอ)

---

## 6. กับดักที่เจอจากไฟล์จริง (อย่าให้ใครแก้ย้อน)

| # | เรื่อง | สาเหตุ | กติกา |
|---|---|---|---|
| 1 | อ่านได้แค่ 3 จาก 7 record | `sheet_to_json` คืนแถวเทียบ `!ref` แต่ `!merges` เป็นพิกัดสัมบูรณ์ | อ่านผ่าน `sheetToGrid()` เท่านั้น |
| 2 | ชีท cover ถูกอ่านเป็นชีท OP | cover ชื่อ `060`/`306` ขึ้นต้นด้วยเลข | แยกด้วยจำนวนแถวที่แกะได้ ไม่ใช่ชื่อ |
| 3 | แถวของ OP 250 ไปกอง OP 240 | ชีท `240-250` เป็นช่วงรวม แต่เกณฑ์เดิมดู "ห่าง ≥ 20" | `rangedKey` ใช้ **ตัวหลัง > ตัวหน้า** |
| 4 | PFMEA หล่นทั้งชีท 18 แถว | ไฟล์เขียนเลขผิด: ชีท `140` แต่ในเซลล์เขียน `130` | สร้าง OP จากชื่อชีทด้วย + **เตือน** ไม่แก้ให้เอง |
| 5 | REWORK หล่น 8 แถว | เดิมล็อกให้เกาะ OP ชื่อ `WELD INSPECTION` | เกาะ **ขั้นตรวจตัวสุดท้าย** + เตือนว่าผูกกับ OP ไหน |
| 6 | `EWO No.` ได้ค่าของช่องข้างๆ | ช่องว่างจริง แล้วไล่หาค่าไปทางขวาจนเจอป้ายถัดไป | หยุดทันทีเมื่อเจอ "ป้ายของช่องอื่น" |
| 7 | `Core Team` หลุด | ตัวกรองความยาวตัดทั้งเซลล์ทิ้ง | จำกัดความยาวที่ **ชื่อป้าย** ไม่ใช่ทั้งเซลล์ |

---

## 7. สถานะปัจจุบัน

| | สถานะ |
|---|---|
| นำเข้า PFMEA / CP / ประวัติแก้ไข | ✅ ใช้งานได้ (`/pe-docs` → 📥 นำเข้า Excel) |
| กรอกข้อมูลชุดอัตโนมัติจากหัวเอกสาร | ✅ |
| จำที่อยู่แถว/เซลล์ไว้ให้ export | ✅ ในหน่วยความจำ (ยังไม่เก็บลง DB) |
| **Export กลับเป็น .xlsx เหมือนเดิม 100%** | ⬜ **ยังไม่ทำ** — ต้องเก็บไฟล์ต้นฉบับ + ตัวเขียน zip |
| นำเข้า/ส่งออก ตัวผัง PFC (รูปทรง) | ⬜ ไม่ทำ — ผังเป็น drawing แก้ในระบบไม่ได้ ต้องแก้ใน Excel แล้วอัพใหม่ |

**ลำดับที่ควรทำต่อ:** (1) เก็บไฟล์ต้นฉบับตอนนำเข้า + คอลัมน์ provenance ใน `pe_fmea_items`/`pe_cp_items`
(2) ตัวเขียน zip แบบ surgical (3) ปุ่ม "⬇️ ดาวน์โหลดเป็น Excel (ฟอร์มเดิม)" (4) เตือนเมื่อข้อมูลในระบบมีแถวเกิน
จำนวนแถวที่ฟอร์มต้นฉบับมี (ต้องแทรกแถว = งานอีกระดับ)
