# Daily Report — ไลน์ผสมหลาย process (welding + metal forming ในไลน์เดียว · 2026-07-22)

> ย้ายมาจาก `CLAUDE.md` (2026-09-03 — แยกไฟล์เพื่อลด context) · โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน


**dropdown ประเภท Downtime/งานเสีย ใช้ `sessionProcessTypesAll()` (union ทุก process ที่มีเครื่อง/สินค้าจริงใน**ครอบครัวไลน์** — แม่+ลูกทั้งหมดผ่าน `getLineFamilyNames` ไม่ใช่ชื่อไลน์ตรงเป๊ะ: กะมักเปิดบนไลน์ลูก แต่เครื่องลงทะเบียนใต้ไลน์พี่น้อง · แก้ 2026-07-24)** — เดิมใช้ `sessionProcessType()` (เสียงข้างมากตัวเดียว) ทำให้ไลน์ผสม เช่น LWR (laser=metal_forming + Stationary=welding_assembly) มองไม่เห็นประเภทของอีก process (เคสจริงจาก supervisor Assy2) · ประเภทที่ `process_type` = null/common เห็นเสมอทั้งสอง dropdown · **break policies ยังใช้ majority ตัวเดียว (`sessionProcessType`) โดยตั้งใจ** — union จะหักเวลาพักซ้ำสอง policy · ทางแก้ฝั่งข้อมูล: ประเภทที่อยากให้เห็นทุกไลน์ตั้ง process = "🔗 ทุกกระบวนการ" ใน ⚙️ ตั้งค่า

---

## 🔴 2 คำถามที่ต่างกัน: "ไลน์นี้เป็นกระบวนการอะไร" vs "dropdown มีตัวเลือกอะไร" (2026-10-27)

ตาราง `machines` ฝั่ง DR **ไม่ได้เก็บแค่เครื่องจักร** — วัดจริง 27/10:

| `equipment_kind` | แถว |
|---|---|
| `machine` (เครื่องจักรจริง) | 226 |
| `die` (แม่พิมพ์) | 268 |
| `jig` (จิ๊ก) | 190 |
| `facility` | 44 |

และ **674/728 แถวเป็น `welding_assembly`** = ค่า default ที่ไม่มีใครแก้ ไม่ใช่ข้อเท็จจริง

### ① โหวตเป็น "คำตอบเดียว" → **ต้องกรอง** `machineAssetsOnly()`

`sessionProcessType()` = เสียงข้างมาก เอาไปเลือก **นโยบายเวลาพัก**
เดิมกรองแค่ชื่อไลน์ ⇒ แม่พิมพ์กับจิ๊ก**โหวตชนะเครื่องจักรจริง**:

| ไลน์ | เดิมได้ (ทุกชนิด) | ที่ถูก (เฉพาะเครื่องจักร) |
|---|---|---|
| HDF1 | `welding_assembly` (18 เสียง) | `metal_forming` (12) |
| HDF2 | `welding_assembly` (18) | `metal_forming` (13) |
| LASER-345 | `welding_assembly` (22) | `metal_forming` (7) |
| LASER-789 | `welding_assembly` (19) | `metal_forming` (6) |
| Airbooster · Utility Hydrofroming · UTLITY STEEL | `welding_assembly` | **ไม่มีแถวเครื่องจักรเลย** |

⚠️ **ผลกระทบวันนี้ = 0 — อย่าเขียนเกินจริง:** ตรวจ `break_policies` แล้ว **ทุกแถวเป็น `process_type = 'common'`**
(ยังไม่มีใครตั้งนโยบายพักแยกกระบวนการ) ⇒ เลือก process ผิดก็ยังหักพักชุดเดียวกัน
🔴 **แต่จะมีผลทันทีที่มีใครตั้งนโยบายพักแยกกระบวนการ** (ระบบรองรับอยู่แล้ว) ⇒ แก้ตอนนี้ = กันไว้ก่อน ไม่ใช่กู้ของเสีย

### ② รวมเป็น "ตัวเลือก" → **ห้ามกรอง** `processUnionRows()`

`sessionProcessTypesAll()` = union เอาไปทำ **dropdown ประเภท Downtime/งานเสีย**
🔴 **เกือบพลาด:** ตอนแรกผมกรองชนิดสินทรัพย์ที่จุดนี้ด้วย — **ผิด** เพราะ:

| ไลน์ | `process_type` จากเครื่องจักร | จากแม่พิมพ์/จิ๊ก |
|---|---|---|
| **Line 60** | `welding_assembly` เท่านั้น | **`metal_forming`** |
| Airbooster · Utility Hydrofroming · UTLITY STEEL | *(ไม่มี)* | `welding_assembly` |

และ **Line 60 ลง downtime ประเภท `metal_forming` ไปแล้ว 10 ใบจริง**
(ทะเบียนประเภท DT แยกกระบวนการจริง: common 34 · welding 26 · metal_forming 24 · laser 6)
⇒ กรองจิ๊กออก = **ตัวเลือกที่หน้างานใช้อยู่หายไป 24 รายการ** · 3 ไลน์ที่ไม่มีเครื่องจักรจะได้ dropdown ว่าง

**หลัก:** ความผิด 2 ทางไม่เท่ากัน — โชว์เกิน = เสียงรบกวน · **ซ่อนขาด = บันทึกปัญหาจริงไม่ได้
⇒ ปัญหานั้นหายจากพาเรโตทั้งใบ** ⇒ จุดนี้ต้องใจกว้างเสมอ

### ③ นับ "เลน" ของไลน์เครื่องขนาน → **ต้องกรอง** `machineLaneCount()`

เมื่อไลน์ `flow_mode = 'parallel_machine'` แต่ไม่ได้ตั้ง `parallel_stations`
ระบบถอยไป**นับจำนวนเครื่องในทะเบียน** แล้วเอาไปเป็น**ตัวหาร**ของเวลา downtime (`laneWeightFn()`)
⇒ นับจิ๊กรวม = **ตัวหารใหญ่เกิน = หักเวลาเสียน้อยกว่าจริง = %A/OEE สูงเกินจริง**

| ไลน์ | เดิมนับได้ | ที่ถูก | ส่วนเกิน |
|---|---|---|---|
| Line D1 - GWM | 9 | **4** | จิ๊ก 5 |
| Line D3 - STAMPED | 8 | **4** | จิ๊ก 4 |
| Line D5 - BRK RR BMPR | 8 | **5** | จิ๊ก 3 |
| Line D4 - BRK FRT BMPR | 5 | **3** | จิ๊ก 2 |
| Line D6 - Sub Assembly | 4 | 4 | — |
| Assembly Line D - GWM&RA | *(ไม่มีเครื่องในทะเบียน)* | 1 (ตามกติกาเดิม) | — |

🔴 ค่านี้ถูก **stamp ลง `oee_a`** ตอนปิดกะ (ไม่ใช่แค่จอสด)
⚠️ **ของเก่ากระทบน้อยมาก** — 5 ไลน์นี้รวมกันมี downtime แค่ **3 ใบ** (ไลน์ใหม่ ยังไม่ค่อยลงข้อมูล)
⇒ **ไม่ไล่แก้ย้อนหลัง** (คำสั่ง user: ของเก่าให้ user เช็คเอง)

### จุดที่แก้แล้ว (6 จุด · ทั้งหมดอ่านทะเบียน `machines`)

| ไฟล์ | ใช้ตัวไหน |
|---|---|
| `DailyReport.jsx` `sessionProcessType()` | `machineAssetsOnly` |
| `DailyReport.jsx` `sessionProcessTypesAll()` | `processUnionRows` (ตั้งใจไม่กรอง) |
| `DailyReport.jsx` `parallelUnits` (จอสด) | `machineLaneCount` |
| `DailyReport.jsx` `computeOEE` → `machineCount` (**stamp ลง DB**) | `machineLaneCount` |
| `MachineReliability.jsx` `parallelOf()` | `machineLaneCount` |
| `MorningMeeting.jsx` ฐาน % Downtime | `machineLaneCount` (+ เพิ่ม `equipment_kind` ใน select) |

· ไม่เกี่ยว: บอร์ดคิว (`LineOrderBoard` · `Dashboard` · `Management`) นับจาก **`machine_points`**
  = ตารางผังฝั่ง Main คนละตัว · การแสดงผลรายแถว (ชิป `machine?.process_type`) ก็ไม่เข้าข่าย
· ด่าน: `machine-process-vote-needs-asset-filter` (`regressionGuards`) + เทส `machineAssets.test.mjs`

### 🔎 เรื่องที่ **ยังไม่แก้** — เจอตอนนี้ ต้องให้ user ตัดสิน

🔴 **จำนวนเลนไม่ตรงกันระหว่างจอ** — `parallelUnitsOf(line)` ถูกเรียก **โดยไม่ส่ง fallback**
ที่ `LineOeeBoard.jsx:210` · `Dashboard.jsx:426` · `OEEAnalytics.jsx:774` · `FactoryMap.jsx:798/915/951`
⇒ จอพวกนั้นได้ **1 เลน** ขณะที่ DailyReport ใช้จำนวนจากทะเบียน (D1 = 4)
= **OEE 2 ชุดของกะเดียวกัน** (ขัดหลัก "ห้ามมี OEE 2 ชุด")
· **ทางแก้ที่สะอาดที่สุดเป็นข้อมูล ไม่ใช่โค้ด:** ตั้ง `parallel_stations` ให้ 6 ไลน์นั้นให้ชัด
  แล้วทุกจอจะตรงกันเอง (เพราะ `parallel_stations` ชนะทุกที่) — **เป็น master data ⇒ user/หัวหน้าตัดสิน**
· ป้าย `process_type` ของแม่พิมพ์/จิ๊ก 489 แถวที่เป็นค่า default ก็เป็น master data เช่นกัน
  ตัวกรองที่ทำไปทำให้จอไม่เพี้ยนระหว่างที่ป้ายยังไม่ถูกจัด — **session ห้ามแก้ให้**
