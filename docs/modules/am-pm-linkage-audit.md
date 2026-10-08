# 🔗 Audit — AM กับ PM ทั้งโปรเจค "มันต้อง link กัน" (2026-10-08 · คำสั่ง user)

> สถานะ: **รายงานผล ยังไม่แก้** (ยกเว้นผังรวมโรงงาน AM ที่แก้ไปก่อนหน้าในวันเดียวกัน) ·
> ลำดับแก้ที่เสนออยู่ท้ายไฟล์ — ข้อที่เป็น product decision (ยุบ 2 ระบบ AM) **ต้องให้ user สั่งก่อน**
> (`pm-predictive-planner-sync.md` §งานค้าง ห้ามหยิบไปทำเอง)

## 0. ภาพรวม — AM มี 2 ระบบที่ไม่คุยกัน · PM มีสูตร "ครบกำหนด" ที่ไม่รู้จัก run_day

```
ระบบ ①  checklists(department ทีม kind='am') ──trigger──▶ pm_plans (cycle_basis calendar|run_day)
            ▲                                                    │ next_due_date (null เมื่อ run_day / ไม่รู้รอบ)
            │ inspections (PMCheckData บันทึก)                   ▼
            │                                   จอ PM ทุกจอ (DeptDashboard · Andon/TV · MtnMachineLayout ·
            │                                   MaintenanceLevels · PmForecast · OrderTrace · pm-plan-reminder)
            │
ระบบ ②  pm_daily_line_targets (ไลน์ × jig × กะ) + inspections ตั้งแต่เริ่มกะ + prod_orders.opened_at
            └──▶ computeDailyPmStatus (lib/pmDailyStatus.js) ──▶ /daily-checker?tab=pm · ผังรวมโรงงาน (08/10) ·
                                                                 pm-daily-scan (ส้ม) · pmDailyAlarm (แดง/เขียว)
```
- **ไม่มีโค้ด ไม่มี trigger ตัวไหน sync ② ↔ ①** — คอลัมน์ร่วมมีแค่ `jigs.line_name` และมีทางเดียว (DailyPM ย้ายไลน์) ที่ย้ายทั้งคู่
- **ไม่มีจอไหนคิด % compliance ของ AM หรือ PM เลย** (`countsForCompliance` มีแต่ไม่มีใครหาร)
- **"ตรวจแล้ว" มี 3 นิยาม** (pending นับ/ไม่นับ · ครอบครัวไลน์กี่ชั้น · กรองอุปกรณ์หรือไม่) แล้วแต่ไฟล์

## 1. ตัวเลขจริง (DR · 2026-10-08)

| เรื่อง | ตัวเลข | ความหมาย |
|---|---|---|
| แผน AM (`department=production`) | 33 แผน: **run_day 7** · calendar 26 — ใน 26 นั้น **`interval_days = null` 24 แผน** | จิ๊ก 24 ตัวอยู่ในทะเบียนรายวัน (ต้องตรวจทุกกะ) แต่แผนบอกว่า "ไม่มีรอบ" ⇒ ทุกจอ PM เห็นเป็นปกติ |
| จิ๊กในทะเบียนรายวัน vs จิ๊กที่มีแผน AM | 31 ซ้อนกัน · แผนอย่างเดียว 2 · ทะเบียนอย่างเดียว 0 | ซ้อนกันเกือบหมด = **ยุบเป็นชุดเดียวได้** (ทะเบียน = แผน run_day interval 1) |
| JIG MTN (`jig_maintenance`) | 106 แผน calendar รอบ 30 วัน · **ไม่เคยตรวจสักใบ · `next_due_date` null ทั้ง 106** | ทุกจอที่กรอง `next_due_date` ⇒ โปรแกรม PM จิ๊กทั้งแผนก**หายจากจอ** · ผังรวมโรงงานขึ้น "PM ปกติ (N)" |
| AM ตรวจจริง 14 วัน (วันผลิต → วันที่มีใบตรวจ) | HDF1 5→4 · LASER E50 **7→0** · LASER EXPORT **6→0** · LASER-345 **5→0** · TSRA-1 **5→0** | 4 ใน 5 ไลน์ที่เดินเครื่อง **ไม่มีใครตรวจ AM เลย** ขณะที่ผังเดิมขึ้นเขียว |
| ส้มจาก `pm-daily-scan` 14 วัน | LASER E50 12/12 กะ · LASER EXPORT 10/10 · LASER-345 9/9 · HYDROFORM 16 (เดินจริง 1 กะ — นับผ่านลูก HDF1) | Telegram เตือนทุกกะอยู่แล้ว **แต่จอไม่เคยสะท้อน** และไม่มีใครตาม |
| ใบตรวจ AM ล่าสุด | 2026-10-02 (ก่อน audit 6 วัน) | — |

## 2. ข้อบกพร่องที่ยืนยันแล้ว (เรียงความรุนแรง)

### A. "ไม่มีวันครบกำหนด" ถูกตีความเป็น "ปกติ" ทั้งระบบ (คลาสเดียวกับที่แก้ FactoryMap AM 08/10)
| ที่ | อาการ | หลักฐาน |
|---|---|---|
| `FactoryMap.jsx` loadPM (PM ช่าง) | `pmTotal++` แต่ `overdue = next_due_date < today` ⇒ 106 แผนจิ๊กที่ไม่เคยตรวจ = "PM ปกติ" | `src/pages/FactoryMap.jsx` ~L1105-1115 |
| `DeptDashboard.jsx` | `plans.filter(p => p.next_due_date)` ⇒ run_day + ไม่เคยตรวจ หายเงียบ · KPI "PM เกินกำหนด" เขียว 0 | L395-402, L438 |
| `MtnAndonBoard.jsx` (TvBoard) | `.filter(p => p.next_due_date)` ⇒ "✅ ไม่มีแผนที่ถึงกำหนด (แผนที่ใช้งานอยู่ N)" เขียวทั้งที่ N รวมแผนที่ไม่เคยถูกประเมิน | L317-333, L565-570 |
| `pm-plan-reminder` | `.not('next_due_date','is',null)` ⇒ แผนที่ไม่เคยตรวจ/ไม่รู้รอบ ไม่เคยถูกเตือน | `supabase/functions/pm-plan-reminder/index.ts` L81-83 |
| **ต้นเหตุร่วม** | `pm_refresh_plan()` ตั้ง `next_due_date` เฉพาะเมื่อมี `last_done` + `interval_days` ⇒ แผนที่**ไม่เคยตรวจ**หรือ**ไม่รู้รอบ**ไม่มีวันครบกำหนดตลอดกาล · จอไม่มีสถานะ "ไม่เคยตรวจ/ไม่รู้รอบ" แยกจาก "ปกติ" | trigger ใน `20261002_pm_cycle_basis_run_day.sql` |

### B. สูตร due กลางไม่รู้จัก `cycle_basis` ⇒ AM run_day กลายเป็น "เกินกำหนด" ปลอมในวันที่ไม่ได้ผลิต
- `src/lib/pmSchedule.js` `computeNextDue`/`dueStatus`/`resolvePlanDue` (L63-69, L86, L156-174): `next_due_date` null ⇒ ถอยไป `last_done + interval_days` (= +1 วัน) โดยไม่ดู `basisOf(plan)`
- ผู้รับผลกระทบ: `MtnMachineLayout.jsx` (L48-63 marker แดงทุกวันจันทร์ · default `dept='all'` ให้ AM ทับสถานะ PM ช่างบนเครื่องเดียวกัน · ไม่กรอง `is_active`) ·
  `utils/maintenanceLevels.js` (L293-307 · AM ปนเข้าชั้น Preventive ทำ overdue/never/withCycle เพี้ยน + สร้าง action "PM เกินกำหนด" ให้ AM) ·
  `OrderTrace.jsx` (L549-561 "🔴 PM เกินกำหนด N วัน ณ วันผลิต" + risk +40 ปลอม) · `pmSpareData.js` (รู้ตัว บอกว่า estimate)
- `PMSchedule.jsx` เป็นจอเดียวที่ทำถูก (`resolveRunDayDue` + ครอบครัวไลน์ + `pm_usage_daily`) — แต่ "เดินวันนี้" = ใบ **confirmed** ขณะที่บอร์ด AM ใช้ใบ **opened** (คนละนิยาม)

### C. ทะเบียนรายวัน ② กับแผน ① ไม่ sync กัน (ไม่มีโค้ด/ trigger)
| เหตุการณ์ | ② ทะเบียน | ① แผน | ที่ |
|---|---|---|---|
| ติ๊กลงทะเบียนจุดตรวจ AM | insert | **ไม่สร้าง checklist/แผน** (ได้แค่ป้าย "⚠ ยังไม่มีจุดตรวจ AM") | `DailyPM.jsx:161` · `PMCheckData.jsx:1222` |
| เอาออกจากทะเบียน | delete (เฉพาะแถว `shift=null` — แถวเฉพาะกะลบจาก UI ไม่ได้) | แผนยัง active | `DailyPM.jsx:152-156` |
| สร้าง checklist AM ใหม่หลัง 02/10 | — | trigger ให้ `cycle_basis='calendar'` เสมอ ⇒ AM รายวันใหม่นับวันปฏิทิน (ส้ม/แดงปลอมวันหยุด) · `PMSetup.jsx:940-953` ไม่เซ็ต/ไม่ select `cycle_basis` | `pm_checklist_sync` |
| PM Setup แก้รอบ/วันครบกำหนด | — | เขียน `next_due_date` ทับแผน run_day ⇒ `pm-plan-reminder` กลับมาเตือนช่างเรื่อง AM | `PMSetup.jsx:947-952` |
| PmCoordination ปิดงาน "done" | — | เขียน `next_due_date = done + interval` ทับ run_day (จน cron 08:05 ล้าง) · reminder cron 08:00 วิ่ง**ก่อน** refresh ⇒ เตือน d3 ปลอมได้ | `PmCoordination.jsx:241-249` |
| ย้ายจิ๊กไปไลน์อื่นที่ PM Setup | **ไม่ย้าย** (ค้างไลน์เก่า) | — | `PMSetup.jsx:877-885` (DailyPM.jsx:135-139 ย้ายถูก) |
| ลบไลน์ที่ /line-setup | **ไม่ลบ** (orphan · บอร์ดยังสร้างการ์ดให้ไลน์ที่ไม่มี) | — | `LineSetup.jsx:421` |
| ย้าย checklist ข้ามทีม AM↔PM | — | `cycle_basis` เดิมติดไป | `lib/pmChecklists.js:119` |
| ปิดใช้ | ไม่มีโค้ดตั้ง `is_active=false` ทั้งสองฝั่ง (ลบจริงอย่างเดียว) | | |
| ทะเบียนชี้ไลน์แม่ แต่จิ๊กอยู่ไลน์ลูก | HYDROFORM ↔ HDF1 5 แถว (loader รวมครอบครัวแล้ว แต่ป้ายบนผังอยู่คนละกรอบกับที่กะเปิด) | | DR จริง |

### D. นิยาม "ตรวจแล้ว" ไม่ตรงกันระหว่างบอร์ด · scan · trigger · client
| กติกา | บอร์ด (`pmDailyStatus.js`/`dailyAmBoard.js`) | `pm-daily-scan` | `pm_refresh_plan` / client |
|---|---|---|---|
| `status='pending'` | ยังไม่ตรวจ | **นับว่าตรวจแล้ว** (L92) | trigger เลื่อน `last_done_at` ให้ · client ไม่นับ (`PMCheckData:1045`) |
| ครอบครัวไลน์ | ทุกชั้นบน-ล่าง | แม่ 1 ชั้น + ลูก 1 ชั้น (L141) | — |
| กรองอุปกรณ์ `isDailyAmEquipment` | กรอง | ไม่กรอง (ส้มได้ทั้งที่บอร์ดเขียว) | — |
| ใบกะ `void` | กันออก | **ไม่กัน** (L98 — ใบโมฆะเริ่มนาฬิกา 60 นาที) | — |
| ทีม AM | `isAmTeam` | **hardcode `'production'`** (L75) | `pmDailyAlarm.js:36,57` · `PMCheckData.jsx:771,776,1078,1112,1157,1222` · `OrderTrace.jsx:376` · `PMSetup.jsx:1667` hardcode ทั้งหมด |
| error คิวรี | เช็คทุกตัว | sessions/orders ไม่เช็ค | — |
| เวลาเริ่มกะ | `amShiftInfo` | คิดเอง (Bangkok→UTC) | `pmDailyAlarm.js:8-23` · `PMCheckData.jsx:778-783` คิดเองอีก 2 สำเนา |
- `pmDailyAlarm.handleDailyPmSave` หา target ด้วย `.eq('line_name', jig.line_name)` ไม่รวมครอบครัว ⇒ จิ๊กที่ลงทะเบียนไว้ที่ไลน์แม่ **ไม่เคยยิงแดง/เขียว** · ส่ง `firstOrderAt: null` · แดงยิงซ้ำทุกครั้งที่บันทึก NG (ไม่มี dedupe)
- `PMCheckData.jsx:1045-1066` บล็อก stamp แผนฝั่ง client = โค้ดตายโดยบังเอิญ (trigger เขียน `last_done_at` ก่อนเสมอ) ถ้ามันทำงานจะเขียน calendar due ทับ run_day
- `OrderTrace.jsx:375-382`: ถ้าคิวรี checklist AM ล้ม ⇒ `!amClIds.size` ทำให้**ทุกใบตรวจ (รวม PM ช่าง) นับเป็น AM** · หน้าต่าง 32 ชม. · นับ `status==='ng'` ซึ่งไม่มีค่านี้ (`pass/fail/warning/pending`)

### E. KPI / แผงอื่น
- ไม่มี KPI compliance ของ AM/PM ที่ไหนเลย (OBEYA M = manpower · `kpi_mtn_rollup` ใช้แค่ MO/downtime · qc7 ไม่มี)
- `DeptDashboard` แผงผลิตไม่มี AM · แผงช่างนับ AM calendar รวมเป็น "PM เกินกำหนด" · ไม่ scope ไลน์
- `PmForecast` ลิสต์แผน AM ปนใน planner หยุดเครื่อง (แสดง "—" + ชวนตั้งระยะ PM)
- `AdoptionOutlook.jsx:105` "เครื่องจักรที่มีแผน PM" = นับแถว `pm_plans` (AM+PM ต่อแผนก) ไม่ใช่เครื่อง

## 3. ลำดับแก้ที่เสนอ (ยังไม่ทำ — รอ user เลือก)

**รอบ 1 — จอห้ามโกหก (ไม่แตะ schema · แก้ได้เลย):**
1. เพิ่มสถานะ **"ไม่เคยตรวจ" / "ไม่รู้รอบ"** เป็นชั้นที่ 3 ในทุกตัวนับ PM (`FactoryMap` loadPM · `DeptDashboard` · `MtnAndonBoard` · `pm-plan-reminder`) — null due ≠ ปกติ · JIG MTN 106 แผนต้องโผล่
2. `lib/pmSchedule.js` รู้จัก `basisOf(plan)`: run_day ⇒ ส่งต่อ `resolveRunDayDue` หรือคืน `unknown` ห้ามถอยไป +1 วัน (ปลด B ทั้งก้อน) + กรอง AM ออกจาก `maintenanceLevels` ชั้น Preventive
3. รวมสำเนา "กะ/ตรวจแล้ว" ให้เหลือ `lib/dailyAmBoard.js` ตัวเดียว: `pmDailyAlarm` (ครอบครัวไลน์ + `amShiftInfo` + dedupe) · `PMCheckData` · `OrderTrace` · `pm-daily-scan` (pending/void/ครอบครัว/`isAmTeam` — ย้ายกติกาเป็น SQL/RPC ร่วมหรือ copy ค่าคงที่ชุดเดียว)
4. กวาด hardcode `'production'` ⇒ `isAmTeam` (9 จุดใน §D) + ด่าน regressionGuards

**รอบ 2 — เชื่อม ② ↔ ① (schema เล็ก · ย้อนได้):**
5. ติ๊กทะเบียนรายวัน ⇒ สร้าง/เปิด checklist AM + แผน `run_day interval 1` ให้เอง · เอาออก ⇒ `is_active=false` ทั้งคู่ · trigger `pm_checklist_sync`: ทีม kind='am' + รอบ ≤1 วัน ⇒ `run_day`
6. ย้ายจิ๊ก/ลบไลน์ ⇒ ตามไปทั้งทะเบียนและแผน (PMSetup · LineSetup · MachineDatabase) · PM Setup / PmCoordination ห้ามเขียน `next_due_date` ลงแผน run_day
7. ซ่อม 24 แผน AM ที่ `interval_days=null` (จิ๊กอยู่ในทะเบียนรายวัน) ⇒ `run_day interval 1` ด้วย migration

**รอบ 3 — product decision (ต้องสั่ง):** ยุบ 2 ระบบ AM ให้เหลือกติกาเดียว (ทะเบียน = แผน run_day) · KPI %compliance AM/PM (ตัวหารตัด `idle_skip`) ขึ้น OBEYA/DeptDashboard · นิยาม "เดินวันนี้" opened vs confirmed ให้ตรงกันระหว่าง PMSchedule กับบอร์ด AM

📄 เกี่ยวข้อง: `factory-master-map.md` §AM รายวันบนผัง · `pm-predictive-planner-sync.md` §งานค้าง · `pm-hub-check-setup.md`
