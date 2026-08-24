# QC Audit — ระบบการคำนวณทั้งโปรเจค (2026-08-20)

ตรวจ **7 โดเมนขนานกัน** ครอบทุกฟังก์ชันคำนวณในระบบ · พบ **~114 ข้อ** (🔴 26 · 🟡 48 · 🔵 40)
ทุกข้อมี "อินพุตจริง → ผลลัพธ์ผิด" กำกับ · ฟังก์ชัน pure พิสูจน์ด้วย `node` แล้ว

> **สถานะ: รอบ 1 แก้แล้ว 2026-08-20** (T1-1 · T1-2 · T1-4 · T1-5 · T1-6 · T1-8 · T1-9 · T3-1 · T3-2 · T3-15)
> **รอบ 2 แก้แล้ว 2026-08-24** (T1-3 Dashboard OEE สด → wrapper computeLiveOee · T1-7 Cpk ตัดแถวที่ไม่ตรง n + แถบเตือน ห้ามตัดเงียบ · T1-10 sessActual คิดจากใบงาน orderTotal ทั้ง MorningMeeting+OEEAnalytics · T3-12 ordersProducedOf รวมสูตรตารางเทรนด์=KPI · T3-35 จุดกราฟ SPC โยงวันถูกผ่าน keptRows)
> **รอบ 3 แก้แล้ว 2026-08-24** (T2-1 ฝั่งอ่าน — default Lot แปลงชิ้น÷Pkg เป็นใบ [ฝั่งเขียน+หน่วยหัวตาราง session ขนานแก้ไปแล้ว 2026-08-21 ผ่าน `lotPcsOf`+migration ตามเก็บ 14 แถว] · T2-6 RundownStock ผ่าน matResolve แล้ว [session ขนาน 2026-08-21] · T2-7 computeResult ตัดกะ open + guard ไม่มี baseline ห้ามขึ้น "ต้นทุนเพิ่ม" · T2-8 นาที mtn = downtime ที่ผูกใบ ไม่ใช่ lead time ใบซ่อม + รายงานใบที่ไม่มี DT ผูก · T2-9 CapaEffectiveness resolve เลขลูกค้า→SAP ผ่าน matResolve + โชว์ matched/raw ห้ามเงียบ · T2-10 ตัวหาร Rank = max(อายุแถว, เดือนที่มีข้อมูล) + เทส spareRank 5 เคส · ข้อ 4 ของ user: "ค่าซ่อมจริง" เป็น toggle ก้อนที่ 5 [key ใหม่ imp_cost_comps2 — migrate ค่าเก่า+repair = พฤติกรรมเดิม] + เขียนกำกับว่าอาจทับซ้อน IDP)
> **รอบ 4 แก้แล้ว 2026-08-24** (pagination: `fetchAllPages` helper ใหม่ใน fetchByIds.js [query เดี่ยวไม่มี id list — `.limit(5000)` โดน PostgREST clamp 1000 เงียบ] · T3-14 DeptDashboard ทั้ง loadProduction+loadQa ผ่าน fetchByIds + banner โหลดไม่ครบ · T3-25 DemandVsProduction orders/forecasts/stock แบ่งหน้า · T3-26 RundownStock orders 923 รอบ + stock แบ่งหน้า + แถบเตือนโหลดไม่ครบ · T2-14/T3-13/T3-31/T3-34 ตรวจแล้วแก้ไปก่อนหน้าแล้วในรอบ fetchByIds 2026-08-20)
> **รอบ 5 แก้แล้ว 2026-08-24** (รวมสูตร drift: DailyReport computePolicyBreakMin → wrapper ครอบ policyBreakOverlapMin [⚠️ policy process_type=null นับด้วยแล้ว — มาตรฐานเดียวกับจออื่น] · PlannerSales countWorkingDays → countWorkingDaysInMonth กลาง · T2-11 transportGraph nodePath ไม่ทิ้งจุดเมื่อถนนขาด + Transport วาด polyline ราย segment เฉพาะที่ถึงจริง + เส้นประแดงช่วงขาด · T2-12 timeFrame duration_min coerce Number · T2-13 energy deltaPct/bahtPerUnit เช็ค null ก่อน Number · เทสใหม่ 4 ไฟล์: pairTotals(7) · stdManpower(6) · timeFrame+energy(6) · transportGraph(5) — **เทสจับบั๊กแฝงเพิ่ม 1 ตัว: stdCapacityOf นับซ้ำเมื่อแม่ unset+ลูกตั้งค่า** → ลูกที่แม่อยู่ในลิสต์ = 0 เสมอ [ข้อมูลจริงปัจจุบันไม่กระทบ — ทุกไลน์แม่ตั้งค่าแล้ว])
> ✅ ครบทั้ง 5 รอบ · เหลือประเมิน backfill T1-5/T3-1 (ต้องอ่าน DB — รอ MCP approval) + T3 รายย่อยที่เหลือทยอยเก็บตามโอกาส
>
> **การตัดสินใจของ user (2026-08-20):**
> 1. **backfill เฉพาะที่พิสูจน์ได้ ถ้าพิสูจน์ไม่ได้ปล่อยไป** (ค่าที่ stamp ผิดจาก T1-5/T3-1)
> 2. **`lot_size = 1` = "ผลิตตามสั่ง ไม่รอสะสมล็อต" (lot-for-lot)** — ใช้กับพาร์ทพิเศษที่ไม่มีขนาดล็อตประจำ
>    · ตรวจข้อมูลจริงแล้ว 22 แถวเป็น `1` เป๊ะทุกแถว (ไม่มี 2-50) และยังไม่สร้างใบสั่งผิดเลย
>    · **ตัวที่ค้างจริงคือ `lot_size = null`** (30045438 = 275,342 ชิ้น · 30044771 = 257,409 …)
>    · แก้ label/placeholder ใน `/products` แล้ว — เดิมเขียน "เว้นว่าง = ไม่สะสมเป็นล็อต" ซึ่ง**บอกตรงข้ามกับที่ระบบทำ**
> 3. **สกิลเฉพาะต้องประจำสถานีเดิม** → T3-38 (`group by assigned_line`) = **ไม่ใช่บั๊ก ปิดเคส**
>    แต่ T1-8 (สกิลที่ไม่ผูกจุดงานเลย) ยังต้องแก้ — เอา "ไม่รู้" ไปตัดสินว่า "ไม่ได้ใช้"
> 4. **IDP (จาก SAP) กับค่าซ่อมที่ช่างลง เป็นคนละเรื่องกัน** → ไม่ตัดตัวไหนออก
>    แต่ต้องทำ "ค่าซ่อมจริง" เป็น toggle ตัวที่ 5 + เขียนกำกับว่าอาจทับกัน (รอบ 3)

**ขอบเขต:** `utils/oee.js` · `DailyReport.computeOEE` · FactoryMap/Dashboard/OEEAnalytics/MorningMeeting/DeptDashboard/monthlyReviewPptx · costSaving/Improvements/capaEffect · capacityModel/ProductionPlan/kanbanCalc/companyCalendar/stdManpower/pmPredictive/vsmModel · pairTotals/opItems/wipChain/demandSupply/matResolve/lineHierarchy/RundownStock/LineStock · QualityControl(SPC/FTT/PPM)/spareRank/pmSchedule/skill farm(SQL)/textCluster/individualSkillPrint · transportGraph/energy/lineFlow/markerScale/timeFrame/navRecent/seededRandom/PeFlowChart/spareImport

---

## ⚠️ ชนิดบั๊กที่พบซ้ำมากที่สุด (ใช้เป็น checklist ตอนเขียนโค้ดใหม่)

| # | รูปแบบ | พบกี่ที่ |
|---|---|---|
| 1 | **`Number(null) === 0` ไม่ใช่ NaN** → "ไม่รู้" กลายเป็น 0/−100% เงียบ | ~12 |
| 2 | **ไม่ paginate / `.in()` ไม่ chunk** → ชนเพดาน 1000 แถว ยอดขาดโดยไม่มีสัญญาณ | ~9 |
| 3 | **สูตรเดียวกันเขียนซ้ำหลายที่แล้ว drift** (break policy 4 ก๊อป · OEE สด 2 ก๊อป · countWorkingDays 3 ก๊อป) | ~8 |
| 4 | **select ไม่ครบคอลัมน์ที่ logic ต้องใช้** → เงื่อนไขกลายเป็นโค้ดตาย | ~5 |
| 5 | **Downtime ที่ยังเปิดค้าง = 0 นาที** (ใช้ `duration_min` ล้วน ไม่นับถึง now) | ~5 |
| 6 | **"ประเมินไม่ได้" ถูกแปลงเป็นตัวเลข** แทนที่จะเป็น null | ~7 |
| 7 | **นับซ้ำ/นับขาด** (แม่+ลูก · LH+RH · OP+พาร์ทจริง · NG 2 แหล่ง · forecast 2 source) | ~7 |
| 8 | **หน่วยสลับ** (ชิ้น↔ใบคัมบัง · วันทำงาน↔วันปฏิทิน · lead time↔เวลาหยุดจริง) | ~4 |

---

## 🔥 Tier 1 — ผิด "อยู่ตอนนี้" บนจอที่ใช้ทุกวัน

### T1-1 · ผังรวมโรงงาน: "ควรผลิตได้ตอนนี้" ไม่เคยหักเวลาพักเลยสักนาที
`FactoryMap.jsx:418` (select) + `:528`

```js
.select('id, line_name, status, oee, qty_ng, ng_qty, start_time, shift_min')  // ← ไม่มี shift
if (!(b.shift === 'both' || b.shift === s.shift)) return;                     // s.shift = undefined
```

**ยืนยันกับฐานจริง:** `break_policies` มี `shift='day'` 7 แถว (150 นาที) และ `shift='night'` 7 แถว (140 นาที) — **ไม่มีแถว `'both'` เลยแม้แต่แถวเดียว** → เงื่อนไขเป็นเท็จเสมอ → ไม่มีนาทีพักถูกหักออกจาก `availMin` ในทุกกะทุกไลน์

- กะเช้า Line 60 · CT 58 วิ · เวลา 16:00 (ผ่านพัก 80 นาที)
- ถูก: (480−80) → ควรได้ **414 ชิ้น** · ได้: 480 → **497 ชิ้น** (เกิน 20%)
- ผลิตจริง 430 → ควรขึ้น 104% 🟩 แต่ขึ้น 87% 🟨

**แก้:** เติม `shift` ใน select **และ** เรียก `policyBreakOverlapMin()` จาก `utils/oee.js` แทนการเขียนสูตร overlap ซ้ำ (นี่คือ implementation ที่ **4** ของสูตรเดียวกัน)

### T1-2 · ผังรวม: หัก "หยุดตามแผน" ออกจากหน้าต่างที่ไม่ได้ครอบมัน
`FactoryMap.jsx:487-495` + `:538`

`plannedDtMin` สะสมทั้ง session ไม่ clamp แต่ `availMin` เริ่มที่ `anchor = max(shiftStart, firstOpen)`

- planned 08:00-10:00 (120 น.) · เปิดใบแรก 09:00 · ตอนนี้ 12:00
- ถูก: 180 − 60 = 120 → **124 ชิ้น** · ได้: 180 − 120 = 60 → **62 ชิ้น**
- ผลิตจริง 100 → ควร 81% 🟨 แต่ขึ้น **161% 🟩**

**หนักกว่า:** planned ≥ หน้าต่าง → `availMin=0` → guard คืน **100% คงที่** + `cat='ok'` = ตัวชี้วัดตายทั้งไลน์แต่จอไม่บอก
**⚠️ T1-1 กับ T1-2 ดันคนละทางแต่ไม่หักล้างกัน** (T1-1 บวกคงที่ ~80 น./กะ · T1-2 ลบตาม planned DT ซึ่งเป็น **73%** ของนาที DT ทั้งหมด) → เลขคาดเดาไม่ได้ทั้งสองทิศ

### T1-3 · Dashboard (จอ Andon): เครื่องกำลังเสีย แต่ A ≈ 100%
`Dashboard.jsx:341-430` — เขียน `computeSessionOEE` เอง ไม่ใช้ `computeLiveOee` (ขัดกฎ `oee.js:5`)

3 อาการ:
- **(ก)** `d.duration_min || 0` → DT ที่ยังไม่ปิดรายการ = ช่วงยาว **0 นาที**
  > หยุดตั้งแต่ 10:00 ยังไม่ปิด · ตอนนี้ 14:00 → FactoryMap: A = **33%** · Dashboard: A = **100%**
  > นี่คือจอ Andon — ตัวเลขที่ควรแดงที่สุดกลับเขียวสนิท
- **(ข)** นับผลิตเฉพาะใบ `confirmed` → ทิ้ง `qty_actual` ของใบที่ยังเปิด → `P = null → OEE = N/A` ทั้งที่ไลน์กำลังเดินและอีก 2 จอมีเลข
- **(ค)** ไม่มี `parallelCap` → SUB APRON P raw 842% โดน `min(1,…)` กลืนเงียบ → OEE ~99%

### T1-4 · โมดัลปิดกะ: OEE preview ใช้ NG = 0 เสมอ
`DailyReport.jsx:282, 2372, 3469` — `closeNg` มี 3 บรรทัดในทั้งโปรเจค: ประกาศ → `setCloseNg('0')` → อ่าน · **ไม่มี input ผูกกับมันเลย**

> เห็น OEE 76.5% ก่อนกดปิดกะ → stamp จริง 63.8% · ในโมดัลเดียวกันห่างกัน 20 บรรทัด การ์ด "🔴 สรุปงานเสีย" โชว์ NG จริง = ขัดกันเอง

**แก้:** `const ng = sumDefectQty(defectLogs, 'line')` แล้วลบ state `closeNg` ทิ้ง

### T1-5 · ธง "งานทดลอง" ใช้ไม่ได้จริงกับค่าที่ stamp
`DailyReport.jsx:1886` (+ `:653`) ส่ง `totalQtyNg + totalQtySuspect` (ผลรวมดิบทุกแถว) เข้า `computeOEE` → บรรทัด `sumDefectQty(defectLogs,'line')` **ไม่เคยถูกรันเลย**

> ดี 500 · NG จริง 40 · ลองแม่พิมพ์ 60 → ถูก **92.6%** · stamp จริง **83.3%**
> จอสดกรองถูก ค่าที่ stamp ไม่กรอง = **Q คนละตัวระหว่าง 2 จอ**

### T1-6 · FTT/PPM: กะที่มีแต่งานทดลอง หลุด filter ทางประตูหลัง
`QualityControl.jsx:364` — `defBySession.has(s.id) ? … : (s.qty_ng || 0)`
กะที่ของเสีย**ทุกแถว**เป็น try-out → ไม่มี key ใน Map → ตกไป rollup ที่รวม try-out ครบ

> 20 กะปกติ + 3 กะ try-out → PPM **17,544** ที่ถูก **1,783** (สูงเกิน 10 เท่า)

### T1-7 · Cpk เฟ้อ 52% เมื่อ subgroup ขนาดไม่เท่ากัน
`QualityControl.jsx:82-104` — เลือกค่าคงที่จาก `subgroup_size` แต่ไม่ตรวจว่าความยาว `readings` จริงตรงกับ n

> 10 แถว × 5 ค่า → Cpk **1.86** · ปนแถวค่าเดียว 5 แถว → Cpk **2.83**
> Cpk คือเลขที่รายงานลูกค้า/ตัดสินเกณฑ์ 1.33 — เฟ้อทางเดียวแบบนี้คือ **false pass**

### T1-8 · สกิลที่ไม่ผูกจุดงาน โดน decay −2 ทุกสัปดาห์จนถึงพื้น
`20260713_skill_farming_server_side.sql:207-218` — loop เป็น `employees × skill_definitions` แต่ `v_worked` มาจาก join `station_requirements` เท่านั้น

**ยืนยันกับฐานจริง:** สกิลทั้งหมด 44 · **ไม่มี `station_requirements` เลย 8 สกิล** · แถวคะแนน 26-99 ของสกิลกลุ่มนั้น = **46 แถว กำลังถูกลด −2 ทุกสัปดาห์ โดยไม่มีทางได้คืน**
> ลงถึง 25 ภายใน ~37 สัปดาห์ — คะแนนที่หัวหน้าตั้งเองหายไปเงียบๆ

### T1-9 · OEE สดของกะที่กำลังเดิน ถูกตัดทิ้งจากค่าเฉลี่ยไลน์
`FactoryMap.jsx:592, 606, 1084` — `production_sessions.shift_min` เขียนตอน**ปิดกะ**เท่านั้น → กะที่เปิดอยู่ `shift_min = null` → `wLoad = 0` → `wavg` ข้ามแถวนั้น (และไม่ตกไป plain mean เพราะมีแถวกะปิดแล้ว)

> 21:00 · กะเช้า(closed) 72 · กะดึก(open) 45 → ได้ **72%** พร้อมป้าย "(สด)" · ที่ถูก ≈ 69.9%
> ทุกเย็นผังรวมโชว์ OEE ของกะที่จบไปแล้ว โดยติดป้ายว่าเป็นค่าสด · แผงขวาโหมดทบทวนใช้ `|| 570` จึงไม่เจอ = 2 แผงในหน้าเดียวคนละเลข

### T1-10 · ยอดผลิตของกะที่ปิดแล้ว ไม่ยุบชั้น OP → นับซ้ำ 3 เท่า
`OEEAnalytics.jsx:544` · `MorningMeeting.jsx:258-259` — ใช้ `actual_qty`/`qty_ok` ที่ stamp ซึ่งเป็น**ผลรวมดิบ** (`DailyReport.jsx:1882` ไม่ผ่าน `pairAwareTotal`/`collapseOps`)

> SUB APRON: 500 ชิ้น ผ่าน 3 ขั้นขับนัท → FactoryMap **500** · OEEAnalytics/MorningMeeting **1,500**
> ซ้ำร้าย `sessTarget` collapse ถูก → เป้า 500 vs ผลิต 1,500 = 300% (โดน `Math.min(100,…)` กลบ) และ "คงเหลืออีก" = 0 ตลอด

---

## 🟠 Tier 2 — ผิดเมื่อข้อมูลโต / เคสที่เกิดได้ทันทีถ้าใช้ฟีเจอร์นั้น

### T2-1 · `kanban_standards.lot_size` มี 2 หน่วยขัดกัน — กระทบ **write-path** ของ store
`PlannerSales.jsx:813, 984-985` · `kanbanCalc.js:37` vs trigger `20260710_route_buy_parts_to_purchase.sql:60-77`

| ฝั่ง | หน่วย |
|---|---|
| DB trigger · Heijunka · ProductMaster · RoutingPanel | **ชิ้น** |
| แท็บคำนวณ Kanban (อ่าน+เขียน) | **จำนวนใบคัมบัง** |

> (ก) `doApply` เขียน `lot_size = 10` แทน 3000 → trigger ยิงใบสั่งผลิต+ใบเบิกวัตถุดิบทุก **10 ชิ้น** = ถี่เกิน **300 เท่า**
> (ข) อ่านค่าชิ้น 3000 มาคิด → `totalKanban` **3,006 ใบ** แทน 16 ใบ (เฟ้อ 188 เท่า)

**ข้อมูลจริง:** `kanban_standards` 299 แถว · มี `lot_size` 135 แถว · **22 แถวที่ค่าอยู่ระหว่าง 1-50** ← ต้องตรวจว่าเป็นใบคัมบังที่เขียนผิดหน่วยหรือล็อตเล็กจริง

### T2-2 · ProductionPlan รายเดือน ไม่ dedupe forecast source → นับซ้ำ
`ProductionPlan.jsx:105-106, 292-297` — `select` ไม่ดึง `source` เลย จึง dedupe ไม่ได้ (ขณะที่ `PlannerSales` และ `vsmModel` ทำแล้ว)
> EDI 830 44,000 + manual 44,000 = **88,000** → `shiftsNeeded` 44 แทน 22 → verdict พลิกเป็น "🚨 เกินกำลัง" → สั่งเปิดกะดึก/OT/เรียกคนวัน ม.75 โดยไม่จำเป็น

### T2-3 · PmForecast query forecast ผิดชนิดคอลัมน์ → เส้นทาง forecast เป็นโค้ดตาย
`PmForecast.jsx:77-78` — `.eq('period_month', '2026-08')` บนคอลัมน์ `date` · error ถูกกลืน (destructure แค่ `data`)
> `fcByMat` ว่างเสมอ → `dailyRate` ตกไป fallback `act/30` ตลอด และ `rateSource` แสดง `'actual'` ทุกครั้ง

### T2-4 · `stdCapacityOf` นับซ้ำเมื่อแม่ไม่ตั้ง std แต่ลูกตั้ง
`stdManpower.js:44-57` — JSDoc อ้างว่า "ปลอดภัยเมื่อบวกรวมทั้งลิสต์" แต่แม่ fallback เป็นผลรวมลูก **และ** ลูกคืนค่าตัวเองด้วย
> PARENT 0 · C1 6 · C2 7 → ผลรวม **26** คนจริง 13
> **กำลังกลายเป็นเคสหลัก** เพราะกฎ 2026-08-12 สั่งย้าย std/line_id ไปไลน์ลูก

### T2-5 · Dashboard ตีความ `stdCapacityOf = 0` ผิด → `totalCapacity` นับซ้ำ
`Dashboard.jsx:826-834` — 0 มี 2 ความหมาย ("แม่นับแล้ว" vs "ยังไม่ตั้ง") แต่ตีเป็นอย่างหลังเสมอ แล้วถอยไปนับหัวจริง
> เป็นบั๊กตัวเดียวกับที่คอมเมนต์บรรทัด 824 อ้างว่าแก้แล้ว — กลับมาผ่านทาง fallback

### T2-6 · RundownStock ตี "ยังจับคู่เลขไม่ได้" เป็น "สต็อก 0 = ของจะขาด"
`RundownStock.jsx:59-88` — ไม่ผ่าน `matResolve` เลย · `onHand[o.mat_no] ?? 0`
> `RB3B 8C306 BB` (เลขลูกค้า) หาไม่เจอใน `line_stock_summary` (เก็บเลข SAP) → bal ติดลบ → **sort ขึ้นบนสุด + นับเข้า `shortCount`** = สั่งเปิด OT ทั้งที่ของเต็มคลัง และกลบพาร์ทที่ขาดจริง

### T2-7 · โปรเจคปรับปรุงเปิดวันนี้ = อ้าง saving เต็มทันที
`Improvements.jsx:365-420` — ไม่มีเกณฑ์ขั้นต่ำของ `beforeDays`/`afterDays` (ต่างจาก `capaEffect.MIN_DAYS = 5`)
> เปิด 09:00 ยังไม่มี DT → **"ประหยัด 12,600 บาท/เดือน"** · ไม่มีกะก่อนวันเริ่ม → **"ต้นทุนเพิ่ม 450 บาท/วัน"**
> `computeResult` ไม่กรอง `status='closed'` ด้วย → กะที่เพิ่งเปิดนับเป็นวันผลิตเต็มวัน

### T2-8 · MTN saving: นาฬิกาใบซ่อม × rate ผลิต
`Improvements.jsx:290-291 → :386` — `repair_done_at − report_at` = lead time (รวมกลางคืน/วันหยุด/รอช่าง)
> ศุกร์ 16:00 → จันทร์ 09:00 = **65 ชม./ใบ** → 3 ใบ/30 วัน = **81,900 บาท/เดือน** ที่จริง ~2,520 → **เกิน 33 เท่า**

### T2-9 · CapaEffectiveness กรองเลขพาร์ทผิดกุญแจ → ทิ้งของเสียเกือบหมด
`CapaEffectiveness.jsx:143-150` — `capa.part_no` (เลขลูกค้า) เทียบ `prod_orders.mat_no` (เลข SAP) ตรงๆ · คอมเมนต์เขียนว่า "เทียบทั้ง 2 ทาง" แต่โค้ดเทียบทางเดียว · **ไม่ผ่าน `matResolve`**
> เหลือ 0 แถว → "ไม่พบของเสียเลย" · เหลือ 2-3 แถว → ตัดสิน verdict จาก sample บิดเบี้ยว แล้ว **stamp `eff_snapshot` ถาวร** + เข้า KPI IATF §10.2.4
> `matched`/`raw` คำนวณไว้แล้วแต่**ไม่ได้ render** — ผิดกฎ "ห้ามเงียบ" ที่เขียนไว้ในไฟล์เดียวกัน

### T2-10 · Rank อะไหล่เพี้ยน 6 เท่าตอน import จาก Excel
`spareRank.js:90-97` — ตัวหารมาจาก `created_at` ของแถว ไม่ใช่จำนวนเดือนที่มีข้อมูล
> ประวัติ 6 เดือน (เดือนละ 2) · แถวสร้างวันนี้ → avg **12** → **Rank A** · แถวเก่า → avg 2 → Rank C
> ข้อมูลชุดเดียวกันเป๊ะ → **Rank A ยกคลัง** → เตือน Safety Stock ทุกตัว → คนเลิกสนใจ + สั่งของเกิน

### T2-11 · `routeThroughStops` ถนนขาดช่วงกลาง → วาดเส้นทางปลอมทะลุกำแพง
`transportGraph.js:80-98` (`slice(1)` ตัดหัว segment ถัดไป) + `Transport.jsx:584-585` (วาด polyline โดยไม่ gate `route.ok`)
> STORE→A→C→D ที่ A-C ขาด → `nodePath` = `["STORE","A","D"]` (จุด C หายทั้งจุด) + `distance` = ผลรวมบางส่วน
> บนผังเห็นเส้นเขียวลาก A→D ทะลุโรงงาน ดูสมบูรณ์ ขณะที่ข้อความข้างล่างเขียน "⚠ ถนนขาดช่วง"

### T2-12 · `breaksToFrame` — `duration_min` เป็นข้อความ → ต่อสตริง
`timeFrame.js:20` — `s + (p.duration_min || 0)`
> `{start:'12:00', duration_min:'45'}` → `e = "72045"` → แถบพักยาว **71,325 นาที (~50 วัน)** คลุมทั้งบอร์ด
> `oee.js:80` coerce ไว้แล้ว (`Number(p.duration_min) || 0`) = ฟิลด์เดียวกัน 2 มาตรฐานในโค้ดเบสเดียว

### T2-13 · `energy.js` — `Number(null) === 0` 2 จุด
`:39-43` `bahtPerUnit(null, q)` → **0** → ขึ้น `0 ⚠` ส้ม + tooltip "กรอกผิดหลักไหม" บนแถวที่แค่ยังกรอกไม่ครบ
`:32-36` `deltaPct(null, base)` → **−100** → ชิป **เขียว "ลดลง 100%"** · ขัดคอมเมนต์บรรทัด 54 ของไฟล์เอง
> `saveCell` เขียน `qty: null` จริง → แถว "กรอกค่าไฟแต่ยังไม่กรอกหน่วย" มีอยู่ในตาราง

### T2-14 · เด็คผู้บริหาร: chunk 150 กะ ทะลุ 1000 แถว
`monthlyReviewPptx.js:84-95` — ไฟล์มี `fetchAll()` อยู่แล้วแต่ใช้กับ sessions อย่างเดียว
> 10.3 ใบ/กะ × 150 = **1,545 แถว → คืน 1,000** → หาย ~35% ของ chunk แรก → output ต่ำเกินจริง + **PPM สูงเกินจริง** (output เป็นตัวส่วน)

---

## 🟡 Tier 3 — ผิดเคสขอบ / 2 จอไม่ตรงกัน / ขัด convention

| # | ไฟล์ | เรื่อง |
|---|---|---|
| T3-1 | `DailyReport.jsx:627-667` | "✏️ แก้เวลากะ" กับกะที่ปิดแล้ว → ใบ `carry_over` ไม่ถูกนับ → กะที่ยกยอดหมด **stamp A/Q/OEE เป็น null ทั้งกะ** |
| T3-2 | `DailyReport.jsx:3613` | `Math.max(0, ดี − NG − สงสัย − ซ่อม)` = สูตรที่ห้ามใช้ ยังอยู่ในโมดัลปิดกะ (ขัดกับ `qty_ok` ที่ stamp) |
| T3-3 | `DailyReport.jsx:4956` | `strictOee` ไม่ถ่วง 1/N → ไลน์ขนานติดแถบเตือน "ตรวจการจัดประเภท DT" ทั้งที่จัดถูก (A จริง 82% vs 90.7%) |
| T3-4 | `DailyReport.jsx:1631-1636` | DT ที่กรอกแค่นาที หักครั้งเดียวจากผลรวมทุก MAT · DT ที่มีเวลาเริ่มหักทีละ MAT → **หยุดเท่ากันแต่ %A ต่างกัน 8.3 จุด เพราะวิธีกรอก** |
| T3-5 | `oee.js:129-151` | `busyMinutes` group ด้วย `mat_no` → 2 เครื่องรันพาร์ทเดียวกัน นับเวลาได้ครึ่งเดียว → P เฟ้อ → ธง `pOver` ชี้เป้าผิด |
| T3-6 | `DailyReport.jsx:1719` vs `oee.js:210` | ตัวหาร P ตอนปิดกะ ≠ ตอนสด (จัดกลุ่มคนละแบบ · หัก DT ไม่เหมือนกัน) → ไลน์ขนานเห็น OEE 2 ตัว |
| T3-7 | `DailyReport.jsx:2450` | เป้ารายชิ้นงานใช้ `o.qty` ซึ่งใบ manual ปิดแล้วถูกยอดจริงเขียนทับ → **%ครบเป้า = 100% เสมอ** |
| T3-8 | `pairTotals.js:61` | `partner` ไม่เช็ค `seen` → หลาย mat ชี้ partner เดียวกัน = นับซ้ำ (**ยังไม่เกิดจริง** — ตรวจฐานแล้ว 28 คู่เป็น 1:1 ครบ) · แถว `mat_no` ซ้ำหายเงียบ |
| T3-9 | `FactoryMap.jsx:444/855/969` | นิยาม NG **3 แบบในไฟล์เดียว** (defectQty กรอง trial · ng+suspect ไม่กรอง · `qty_ng` ล้วน) |
| T3-10 | หลายไฟล์ | DT เปิดค้าง = 0 นาที ใน OEEAnalytics/MorningMeeting/DeptDashboard (FactoryMap นับถึง now) → จอเดียวกันบอก 300 น. อีกจอบอก 0 |
| T3-11 | `OEEAnalytics.jsx:58` | `calcOEE` บวก NG 2 แหล่ง (`defect_logs` + `session.qty_ng`) = นับซ้ำทุกแถว (กระทบแค่น้ำหนัก ยังไม่ถึงจอ) |
| T3-12 | `OEEAnalytics.jsx:841` vs `:874` | ตารางรายช่วงบวกกันแล้วไม่เท่า KPI หัวแท็บในหน้าเดียวกัน (งานคู่ 1,000 vs 2,000) |
| T3-13 | `OEEAnalytics.jsx:785` | `.range()` ไม่มี `ORDER BY` → แถวซ้ำ/หายข้ามขอบหน้า · เพดาน 40 หน้าจบเงียบ |
| T3-14 | `DeptDashboard.jsx:528` | PPM: `prod_orders` 7 วันไม่ paginate → ตัวส่วนขาด → **PPM สูงเกิน 75%** (ตอนนี้ ~680 แถว margin เหลือ 30%) |
| T3-15 | `FactoryMap.jsx:890` | ตาราง "กางวิธีคิด OEE" โชว์กะเป็น "—" ทุกแถว (ไม่ได้ select `shift`) — แผงที่มีไว้ตอบ "ทำไมบวกหารไม่ตรง" โดยเฉพาะ |
| T3-16 | `FactoryMap.jsx:688` | หน้าต่างวัดกำลังคน (จากเริ่มกะ) ≠ หน้าต่างที่เอาไปคูณ (จาก anchor) → เปิดใบสาย = manRatio ต่ำเกิน 3 เท่า |
| T3-17 | `ProductionPlan.jsx:303` | `fullCap` ให้ 2.5 กะ/วัน แต่ลูปรายวันให้ 2.25 → **แท็บรายเดือนบอกรับไหว แท็บรายวันบอกไม่ทัน** |
| T3-18 | `pmPredictive.js:12-15` | `dailyRate` ปนหน่วย "วันทำงาน" กับ "วันปฏิทิน" → วัน PM คลาด 19 วัน · buffer ต่างกัน 27% |
| T3-19 | `pmPredictive.js:19,49` | `computeBuffer` ตรึง `hoursPerDay=16` → ไลน์กะเดียว buffer ขาด ~40% |
| T3-20 | `vsmModel.js:198` | `invDays` ไม่คูณ `qty_per_unit` → พาร์ทเดียวได้ 10 วัน (supplier) กับ 20 วัน (inventory) ในใบเดียว → **%VA ต่ำกว่าจริงราวครึ่ง** |
| T3-21 | `vsmModel.js:65-67` | `orderYear` รวมทุกเดือนที่มีในฐาน (ถึง ส.ค. 2027) + ทุก source → เฟ้อได้ ~2.2 เท่า บนใบ A3 ที่พิมพ์ออกไป |
| T3-22 | `ProductionPlan.jsx:137-142` | `runMin` บวกใบที่ทับกัน (ขัดกฎ `busyMinutes`) → กำลังผลิตต่ำเกิน → สั่ง OT เกินจำเป็น |
| T3-23 | `demandSupply.js:76` | `minStock` เริ่มที่ `openingStock` → verdict "tight" ทั้งที่ต่ำสุดจริง 500 · **ข้อความสรุปขัดกับตารางใต้มันเอง** |
| T3-24 | `wipChain.js:34` | `if (!q) continue` → สถานีที่เปิดใบแล้วแต่ยังไม่ผลิต **หายจากผัง WIP** → "ผ่านขั้นแล้ว 500" ทั้งที่กองรออยู่ |
| T3-25 | `DemandVsProduction.jsx:66` | `line_stock_summary` ดึงทั้ง view ไม่ `.in()` → ถูกตัด = สต็อกกลายเป็น 0 → verdict "🔴 ของจะขาด" ปลอม |
| T3-26 | `RundownStock.jsx:30` | ไม่ `.range()` (order ค้างส่ง **923 รอบ** ใกล้เพดานมาก) + ไม่มีขอบล่างวันที่ → `overdue` ทบสะสมไม่จำกัด |
| T3-27 | `Improvements.jsx:330` | วัดของเสียด้วย `qty_ng` ล้วน — ไม่รวม `qty_suspect` ไม่กรอง trial → ของสงสัย 20/วันที่แก้ได้ = saving **0 บาท** · try-out ก่อนวันเริ่ม = **+7,588 บาท/เดือนปลอม** |
| T3-28 | `OEEAnalytics.jsx:969` | มูลค่าของเสียตกส่วน conversion → **ราคาพาร์ทเดียวกันต่างกัน 45% ระหว่าง 2 หน้า** และแถบเตือนที่มีอยู่ไม่ครอบเคสนี้ |
| T3-29 | `Improvements.jsx:385` + `costSaving.js:8` | IDP ระบุเองว่า "รวมค่าซ่อม" แต่ยังบวกค่าซ่อมจริงจากใบ MO ทับอีกชั้น · ปิด IDP ได้ แต่ปิดค่าซ่อมไม่ได้ |
| T3-30 | `costSaving.js:50` | `rateFor` fallback ไป rate เก่าสุด (ขัด CLAUDE.md) + **ไม่โชว์บนจอว่าใช้ rate ปีไหน** |
| T3-31 | `Improvements.jsx:279,308,331` | `.in()` ไม่ chunk (baseline 90 วัน = ถึง 180 UUID) + ไม่เช็ค `error` เลยทั้ง 3 จุด (array ว่าง = "ไม่มีของเสีย" = saving เต็ม) |
| T3-32 | `QualityControl.jsx:376` | Pareto สะสม % หารด้วยยอด Top-10 → เส้น 80% ตัดที่อันดับ 6 แทนอันดับ 8 → เลือกแก้ไม่ครบ vital-few |
| T3-33 | `QualityControl.jsx:343` | สาย product ใช้ `qty_ng` ล้วน ไม่กรอง trial (ต่างจากสายกะ) → **Pareto กับการ์ด NG ในจอเดียวกันไม่เท่ากัน** |
| T3-34 | `QualityControl.jsx:298` | `prod_orders`/`defect_logs` ไม่ paginate → ช่วง 90 วันเกิน 1000 แน่นอน (ระบบมี 7,210 ใบ) |
| T3-35 | `QualityControl.jsx:84,127` | ป้ายวันที่บนกราฟ SPC เลื่อน เมื่อมีแถวค่าวัดว่าง → จุดหลุด control limit โยงผิดวัน |
| T3-36 | `QualityControl.jsx:97` | X̄̄ ไม่ถ่วงน้ำหนัก → ศูนย์กลาง Ppk ไม่ตรงกับ σ ที่ใช้ (หายเองถ้าแก้ T1-7) |
| T3-37 | `individualSkillPrint.js:30` vs `:155` | ใบ F-PRS-P1-119: ช่องติ๊ก (round) กับวงกลมสรุป (floor) ขัดกัน **48 จาก 101 ค่า** — เอกสารมีลายเซ็นผู้อนุมัติ |
| T3-38 | skill SQL `:207` | `group by assigned_line` → คนหมุน 3 สถานีใน 3 วัน (สกิลเดียวกัน) โดน **decay แทน +2** — คน multi-skill ถูกลงโทษหนักสุด |
| T3-39 | skill SQL `:188` | weekly ไม่มี `coalesce(score,0)` → `score = NULL` กระโดดเป็น 99 + ขอ level-up 100 (**ตรวจแล้วปัจจุบัน 0 แถว** — latent) |
| T3-40 | `spareRank.js:40,130` | `lead_time_days = 0` ตีเป็น "ไม่รู้" → อะไหล่ที่มีของทันที **ไม่มีวันถูกจัด Rank** + ข้อความบอกให้ไปเติมผิดช่อง |
| T3-41 | `capaEffect.js:75` | `judgeEffect` perDay หาย/NaN/ติดลบ → ให้คำตัดสินจริง (`worse`/`effective`) แทน "วัดไม่ได้" — ขัดกฎข้อ 1 ของไฟล์เอง |
| T3-42 | `lineFlow.js:48-70` | `traceChain` — 2 เส้นทางถึงปลายเดียวกัน เส้น buffer 0 ถูกเส้น buffer 1000 กลบ → บอก "safe" ทั้งที่มีเส้นกระทบทันที |
| T3-43 | `lineFlow.js:31 vs :87` | normalize ชื่อไลน์ไม่ตรงกันในไฟล์เดียว (trim vs trim+lowercase) → ตัวพิมพ์เพี้ยน = สายการไหลหายเงียบ |
| T3-44 | `spareImport.js:64` | เซลล์ตัวเลขพิมพ์ผิด → 0 หรือหายทั้งช่อง **โดยไม่ขึ้น error** (หมวดที่ไม่รู้จัก push error แต่ตัวเลขพังเงียบ) |
| T3-45 | `energy.js:64` | `sumRows` ตัวเลขมีคอมมา → 0 แต่ `filled` ยังนับว่ากรอกแล้ว |
| T3-46 | `energy.js:205` | `meteredCoverage` → `unmetered: -20` แสดง "ยังไม่ได้แยกมิเตอร์: **-20 kWh**" |
| T3-47 | `capaEffect.js:57` | `effectWindow` pivot อนาคต → ช่วงกลับหัว + `capped:true` สื่อผิด · `windowDays` 0 กับ −30 ให้ fallback คนละค่า |
| T3-48 | `demandSupply.js:48` | forecast ที่ตกวันเดียวกับ order หายทั้งก้อน (ถูกตามกฎห้ามบวกทับ แต่ผลคือ demand รายสัปดาห์ต่ำกว่าที่ลูกค้าประกาศ 26%) |

---

## 🔵 Tier 4 — ข้อสังเกต / latent (ยังไม่กระทบผู้ใช้)

`Dashboard.jsx:427` Q = 100% เมื่อยังไม่ผลิต · `computePolicyBreakMin` vs `policyBreakOverlapMin` ยัง drift (`process_type` null / `duration_min` NaN) · แท็บประวัติไม่ส่ง `processType` และไม่ถ่วง 1/N · query ประวัติไม่ select `excl_from_q` · `textCluster` ตัดตัวเลขทิ้ง → `RB-107` กับ `RB-205` similarity **1.000** (หมายเลขเครื่องคือสาระ) · Dijkstra ผิดกับน้ำหนักติดลบ · `edgeWeight('  ')` = 0 (ถนนวาร์ปฟรี) · `efFor` เทียบวันที่แบบสตริงต้อง zero-pad · `fmtKwh(1000)` = `fmtKwh(1499)` = "1k" · SPC control limit คำนวณใหม่ตามหน้าต่างที่แสดง (ตามตำราควร freeze baseline) · `FREQ_DAYS` vs `interval_days` มี 2 นิยามรอบ PM · `buildDayPlan` เป็นโค้ดตายและตรรกะไม่ตรงตัวที่ใช้จริง (ไม่รู้จัก `shutdown75`) · `countWorkingDays` 3 ก๊อป fallback 22/26/20 · `simulate` cap 400 วันตัดเงียบ · `splitBeforeAfter` defect กำพร้าตกฝั่ง "ก่อน" ทั้งหมด · `missingLinksFromRouting` เดาทิศจากลำดับ array เมื่อ seq ซ้ำ · `otPeriods` `time` กับ `hours` ไม่ตรงกันทั้ง 4 รายการ · `markerScale(0)` ให้ marker ใหญ่กว่าจอเล็กจริง · `ppmTrend` วัน total=0 → PPM 1,000,000 ดันกราฟ · โปรเจค 2 ใบจับปัญหาเดียวกัน = saving นับซ้ำในแถบรวม

---

## ✅ สิ่งที่ตรวจแล้วผ่าน (ไม่ต้องกังวล)

- **สูตรสถิติ SPC** — ค่าคงที่ A2/D3/D4/d2/E2 ครบและตรงตำรา AIAG ทุก n=1..10 · `Cpk = min(CPU,CPL)` · `stddev` ใช้ n−1 · spec ข้างเดียว → `Cp = null` (ถูกต้อง) · run rule 7 จุดติดธงที่จุดที่ 8 ถูก
- **สูตร FTT/PPM/Q หลัก** ตรงกฎ (`ดี/(ดี+เสีย)`) ไม่มีการหักซ้ำ
- **`wavg` + น้ำหนักถูกตัว** (A/OEE→wLoad · P→wRun · Q→wProd) ทุกจุด — ไม่เหลือ `sum/n` ในระบบแล้ว
- **`strictOee`** คูณสัดส่วนฐานจากค่า stamp (รับประกัน strict ≤ OEE) · **TEEP** นับทุกวันในช่วง
- **`matResolve` / `matPrefix`** ทั้งไฟล์ — แยกด้วยเลขตัวแรก · ไม่เดาเมื่อกำกวม · `pickStockMat` ลำดับถูก
- **`bestStopOrder`** (TSP) — 12 จุดได้คำตอบที่ถูกเป๊ะใน 2ms · ล็อกจุดแรกทำงานถูก
- **`seededRandom`** — seed เดียวกันได้ค่าเดิม · กระจาย 20,000 seed ลง 10 ช่องสม่ำเสมอ
- **skill farm idempotency** — daily dedup ด้วย `last_daily_farm_date` · weekly กันด้วย unique + transaction เดียว · cron UTC→ไทยถูก
- **`navRecent`** กันนาฬิกาเครื่องเพี้ยน · **`layoutFlow`** ผัง A3 ย่อได้ตามที่ระบุ
- **ไม่พบ `toISOString()` ใช้หา work date ในไฟล์ใดเลย** · guard ข้ามเที่ยงคืนครบทุกจุดที่สร้าง window
- **`policyBreakOverlapMin`** (ตัวใน `oee.js`) คำนวณพักกะดึกข้ามเที่ยงคืนถูกทั้ง 4 เคส
- **`DeptDashboard` ฝ่ายผลิต** = จอที่สะอาดที่สุดในชุดที่ตรวจ (collapse+pair+wavg+NG ถูกครบ)

---

## 📌 ลำดับที่เสนอให้แก้

**รอบ 1 — จอโกหกอยู่ทุกวัน (แก้ไม่ยาก ผลทันที)**
T1-4 (`closeNg`) · T1-5 (trial flag) · T1-1 (`shift` ใน select) · T1-9 (`shift_min || 570`) · T1-8 (skill decay — 46 แถวกำลังลดทุกสัปดาห์) · T1-6 (FTT fallback)

**รอบ 2 — จอ Andon + ตัวเลขที่เอาไปเสนอ**
T1-3 (Dashboard → `computeLiveOee`) · T1-2 (clamp planned DT) · T1-10 (collapse OP) · T1-7 (Cpk subgroup)

**รอบ 3 — ก่อนมีคนใช้ฟีเจอร์นั้นจริง**
T2-1 (lot_size — กระทบ write-path) · T2-7/T2-8/T2-9 (เงิน + IATF) · T2-6 (RundownStock) · T2-10 (Rank อะไหล่)

**รอบ 4 — pagination ทั้งชุด** (T2-14, T3-14, T3-26, T3-31, T3-34, T3-25) — โตขึ้นเรื่อยๆ ตาม adoption

**รอบ 5 — รวมสูตรที่ drift** (break policy 4 ก๊อป → 1 · OEE สด 2 ก๊อป → 1 · countWorkingDays 3 ก๊อป → 1) + เขียนเทสให้ util ที่ยังไม่มี (energy · timeFrame · transportGraph · spareImport · pairTotals · stdManpower)

---

## ⚠️ เรื่องที่ต้องตัดสินใจก่อนแก้

1. **T1-5 / T3-1 กระทบค่าที่ stamp ไปแล้ว** — แก้โค้ดแล้วกะเก่ายังผิดอยู่ · ตามกฎเดิม "ห้าม blanket-recompute กะเก่าด้วย master ปัจจุบัน" → ต้องตกลงว่าจะ backfill เฉพาะกะที่พิสูจน์ได้ หรือปล่อยไว้แล้วเขียนกำกับ
2. **T2-1 lot_size** — ต้องตรวจ 22 แถวที่ค่า 1-50 ว่าเป็นใบคัมบังที่เขียนผิดหน่วย หรือล็อตเล็กจริง ก่อนแก้ทิศทางใดทิศทางหนึ่ง
3. **T3-38 skill weekly** — เอกสารเขียนกำกวม ("ทำงาน ≥3 วัน/สัปดาห์ที่สถานีที่ต้องการสกิล") ต้องยืนยันเจตนา: นับข้ามสถานี หรือต้องประจำสถานีเดิม
4. **T3-29 IDP ทับค่าซ่อม** — ต้องยืนยันกับบัญชีว่า `ACT_IDP_MAC` absorb ค่าซ่อมไว้แล้วจริงไหม
