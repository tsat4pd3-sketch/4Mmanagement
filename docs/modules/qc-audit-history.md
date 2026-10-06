# ประวัติผล QC Audit — บันทึกไว้กัน regress

> ⬅️ กลับไป `CLAUDE.md` → หัวข้อ "กฎการทำงานของทุก AI session (Workflow Discipline)" · **QC Agent**
> ไฟล์นี้เก็บ **ผลการตรวจที่ทำไปแล้วและแก้เสร็จแล้ว** — เป็นบันทึกย้อนหลัง ไม่ใช่กฎที่ต้องอ่านทุก session
> (กฎปัจจุบันของ QC agent + วิธีรัน `/qc-audit` ยังอยู่ใน CLAUDE.md)

#### ผลรอบ audit เต็ม 2026-08-03/04 — แก้ครบแล้ว (บันทึกไว้กัน regress)

| หมวด | ที่แก้ | สาระ |
|---|---|---|
| A Date/Time | `PMSchedule.jsx` | modal เลื่อนแผน PM เคยใช้ `toISOString().slice(0,10)` = UTC → วันเลื่อนเพี้ยน 1 วันช่วง 00:00-07:00 ไทย · ใช้ helper `ymd()` local แทน |
| B Supabase | `LineSetup.jsx` `handleRenameLine` | ขยาย cascade `line_name` อีก 5 ตาราง (Main `lpa_questions`/`station_assignment_logs` · DR `pm_daily_alerts`/`kanban_calc_params`/`transport_nodes`) · `lpa_questions.hidden_for_lines[]` เป็น text[] ต้องอ่าน-แก้-เขียนรายแถวด้วย `.contains()` |
| C Permissions | `permissions.js` · `operator.jsx` · `pmNotify.js` | bucket `dept_admin` บังคับข้าม key `page:*` ในโค้ด (ไม่พึ่งความถูกต้องของ seed) · แท็บ operator gate ด้วย `can()` แทน role array · ผู้รับแจ้งเตือน PM อ่าน role จาก `role_permissions` (`pm:record`/`qa:record`) ไม่ hardcode |
| D Scoping | `StoreMonitor.jsx` · `QualityControl.jsx` | 2 หน้านี้เห็นข้ามส่วนงาน — เพิ่ม mandatory scope (leader = family · อื่น = sections) ครอบทั้งลิสต์/ตัวนับ/dropdown |
| E Storage | `MtnRepair.jsx` | แก้ไขสเตปแล้วอัปรูป/ลายเซ็นทับ = ไฟล์เก่ากำพร้า → ลบไฟล์เดิมหลัง DB update สำเร็จ (best-effort · ข้ามลายเซ็นจากโปรไฟล์ที่ใช้ร่วม) |
| F UI | `DailyReport` (10 จุด) + PmCoordination/MonthlyReviewExport/TaxonomyManagerModal · `PMSetup` · `StoreMonitor` · `Improvements` · `OEEAnalytics` | ติด `mgrid` ให้ grid ใน modal · ImageAnnotator เพิ่มซูม 100-400% (§5.1) · เลิกเขียน keyframes กระพริบเอง ใช้ `.mo-card-alert` · playhead gantt ใช้ `.now-line` · แกนวันกราฟเทรนด์ต่อเนื่อง (วันไม่ผลิต = ตอว่าง ไม่ข้ามวัน) |
| G เอกสาร | Checkin/DailyReport + `20260804_doc_forms_attendance_dpr.sql` | ฟอร์ม export 3 ตัวสุดท้ายเข้าทะเบียน `doc_forms` แล้ว (ดูแถว `/doc-forms`) |

- **ปิดเคสแล้ว:** `FactoryMap.jsx` ไม่กรอง scope — **user ยืนยัน 2026-08-05 ว่าตั้งใจ ให้ทุกคนเห็นทั้งโรงงาน** (บันทึกเป็นข้อยกเว้นทางการในหัวข้อ Section Scoping แล้ว ไม่ต้องแก้โค้ด)

#### ⚠️ audit "migration ในรีโปครบแต่ยังไม่ apply" — วิธีตรวจที่เชื่อถือได้ (2026-08-06)

**`supabase migration list` เทียบชื่อไฟล์ไม่ได้** — เวอร์ชันในตาราง `supabase_migrations.schema_migrations` เป็น timestamp ที่ระบบตั้งตอน apply ผ่าน MCP ไม่ใช่ชื่อไฟล์ในรีโป · **ไฟล์ที่ไม่ได้ apply จึงไม่มีทางรู้จากทะเบียน ต้องพิสูจน์จาก schema จริง**
**วิธีที่ใช้ (ทำซ้ำได้):** สแกนทุกไฟล์ใน `supabase/migrations/` ดึงเป้าหมายที่สร้าง (`create table` / `add column` / `create function`) → query `information_schema` ของ **ทั้ง 2 project** → ของที่**ไม่มีในทั้งคู่** = migration ที่ยังไม่ apply จริง (ไม่ต้องรู้ว่าไฟล์ไหนของ project ไหน)
**ผลรอบนี้ (175 ไฟล์ · 215 object):** ค้างจริง **1 ไฟล์** = `20260722_mtn_return_reroute.sql` (apply แล้ว 2026-08-06 · ดูรายละเอียดในหัวข้อ MTN Work-Order) · อีก 6 ตาราง `pm_equipment`/`pm_checklists`/`pm_checkpoints`/`pm_inspections`/`pm_inspection_results`/`pm_schedules` จาก `20260701_add_pm_maintenance_module.sql` **ไม่มีในทั้ง 2 project และไม่ต้อง apply** — ไฟล์นั้น DEPRECATED ตั้งแต่ 2026-07-10 (โมดูล PM จริงย้ายไป `jigs`/`checklists`/`jig_checkpoints`/`inspections`/`inspection_results`/`pm_plans` ฝั่ง DR) เก็บไว้เป็นประวัติเท่านั้น
**บทเรียน:** migration ที่ค้างจะ**พังเงียบ** (write ตัวที่ไม่ tolerant ได้ error 42703 เฉพาะตอนผู้ใช้กดใช้ฟีเจอร์นั้น) — ค้างมา 2 สัปดาห์กว่าจะรู้ · เขียน migration เสร็จ **ต้อง apply แล้วบันทึกวันที่ apply ใน CLAUDE.md ทันที** (pattern เดียวกับที่ `line_type`/`flow_mode`/`equipment_category` เคยค้างแล้วทำให้ช่องเซฟไม่ติดเงียบๆ)

### 🎯 QC audit เต็มก่อน roadshow (2026-10-05) — ทุกโมดูล/หน้า/แท็บ · ทะเบียนสถานะ

คำสั่ง user *"qc test audit all module all page all tab all function all feature"* · 8 agent (กฎ A–G × 2 + bug-hunt 6 กลุ่มโดเมน)
+ เครื่องวัดเบราว์เซอร์จริง · **ผลอัตโนมัติ:** build/เทส 2269 ผ่าน · `crashsweep` 81 หน้า **พัง 0** · `mobilesweep` 81 หน้า **0** ·
`stdsweep` ผิด 2 มุมมอง (LineStock ระยะแท็บ→กรอง 48px · QualityControl 20px) · `chartsweep` Obeya ป้ายแกนยื่น 3–6px 2 มุมมอง

**✅ แก้แล้วรอบนี้ (batch 1)**
| # | ที่ | สาระ |
|---|---|---|
| 1 | `PMSetup.jsx` handleSave | 🔴 กดบันทึกรายการตรวจ PM = **ลบจุดตรวจทั้งชุดแล้ว insert ใหม่** · `inspection_results.checkpoint_id` เป็น CASCADE ⇒ ประวัติผลตรวจหายถาวรทุกครั้ง + `fixture_points` หลุด (วัด: 18 จุด เหลือผูก checkpoint 0) → sync ตาม id · ลบเฉพาะจุดที่ถอดจริง มีประวัติต้องยืนยัน · `jig_images` ทำแบบเดียวกัน · ด่าน `pm-checkpoints-no-delete-all` |
| 2 | `pmChecklists.js` copyChecklistToDept | "คัดลอกทับ" แผนกที่มีประวัติผลตรวจ = ห้าม (เดิมลบประวัติปลายทาง) |
| 3 | `oee.js` suspectState | 🔴 ลง 2 ถังพร้อมกัน (แดงจาก NG + เหลืองจากสงสัย) ⇒ ของสงสัยถูกนับเสียทันที ผิดกฎ "รอ QA" → ใบแดงตรงนับเฉพาะเมื่อไม่มีใบเหลือง · ใบ `is_active=false` ไม่มีสิทธิ์ตัดสิน (embed เพิ่ม `is_active`) · วัดฐาน: กะที่โดนจริง **0** ไม่ต้อง backfill |
| 4 | `HeijunkaKanban.jsx` confirmRound | 🔴 claim รอบส่งแล้ว ledger ล้ม ⇒ รอบขึ้น "ส่งแล้ว" ของไม่เข้าสต็อก กดซ้ำไม่ได้ → คืน claim (กฎเขียน DB ข้อ 6) |

**✅ แก้แล้ว batch 2 — คุณภาพ/วิศวกรรม + MTN/PM (branch `fix/qc-quality-mtn`)**
| # | ที่ | สาระ |
|---|---|---|
| 1 | `QualityBins.jsx` | `toRed` ส่งต่อ `defect_log_id` (เดิม %Q มองไม่เห็นใบแดง ⇒ ของยืนยันเสียค้าง "รอ QA") · ป้ายเกินอายุแท็กนับจากคิวรีแยกไม่ผูกช่วงวันที่ (ชนเพดาน 500 / เช็คใบย้ายแดงล้ม = เขียนบนจอ) · stale guard |
| 2 | `MaterialRequests.jsx` + `materialRequest.js` | เลขใบ = เลขสูงสุดของเดือน+1 (`maxReqSeq`) ออกใหม่ตอนบันทึก · ใบ approved/issued ห้ามลบจริง → ยกเลิก · ⚠️ แนะนำ unique index `material_requests.doc_no` (ยังไม่ทำ) |
| 3 | `vsmModel.js` `demandOf` | Order/year = 12 เดือนจากเดือนที่เลือก + EDI 830 ชนะ manual รายเดือน · ไม่ครบ 12 เดือน = ≈ + จำนวนเดือน · เทส `vsmDemand` |
| 4 | `QualityControl.jsx` dashboard | กรองสินค้าใช้ `defectQty`/`isTrialDefect` เหมือนทางหลัก · ขึ้นของสงสัยรอ QA · คิวรีล้ม = แถบเตือน (NCR/CAPA `—`) |
| 5 | `PeChangeRequests.jsx` | ส่ง `ref_kind` ตรงตัว (วัดแล้ว check ทั้ง 2 ตารางรับ `capa`) |
| 6 | `PeMasterLibrary.jsx` accept | claim CAS ก่อน → เขียน master → ล้มคืน claim · ทุก error ถูกอ่าน |
| 7 | `Improvements.jsx` + `costSaving.js` | กะ/`fetchByIds` ล้ม = error/partial บนการ์ด · `rateIsFallback()` บอกว่าใช้ rate วันไหน · เทส `costSavingRate` |
| 8 | `EventLog.jsx` CQI-15 | อนุมัตินับแถว · ปิดสถานะใบอ่าน error+นับแถว · ผลตรวจ upsert ผ่าน `checkWrite` |
| 9 | `ScrapReport.jsx` | เขียน id/เลขใบกลับ editor หลังสร้างหัวใบ · `nextDocNo` คิวรีล้ม = throw |
| 10 | `QAInspectionSetup.jsx` · `qaDocNo.js` | ถอด balloon ล้ม = หยุด · ประทับเวลา drawing อ่าน error · `nextDocNo` ล้ม = null + 5 ผู้เรียกบล็อก · ⏭ `NpiDrawingsEci` เลข ECI ต่อโปรเจค = **ตั้งใจ** (unique `(project_id, eci_no)`) ไม่แก้ |
| 11 | `PeSetFromMasterModal.jsx` | rollback ลบชุดนับแถว — ลบไม่ได้บอกว่าชุดค้าง |
| 12 | `ScanLanding.jsx` · `MtnRepair.jsx` | 🔴 **select `jigs.department` (ไม่มีคอลัมน์) ⇒ 42703 จิ๊กไม่เคยถูกพบ** → ถอด + แผนกจาก `checklists.department` ส่ง `&dept=` (ด่าน `jigs-has-no-department-column`) · ป้ายจุดส่ง ESM:D มีหน้าปลายทาง · `/mtn-repair` อ่าน `?q=` |
| 13 | `MtnRepair.jsx` | ค่าแรงรายคน: บล็อกบันทึกจนโหลดของเดิมเสร็จ/สำเร็จ ไม่ทับแถวที่พิมพ์ · `loadOrders` error + แถบเพดาน 1000 · `before_img` / `call_mtn_at` อ่าน error |
| 14 | `PMCheckData.jsx` | ผลรายจุดล้ม = ลบหัวใบ (ลบไม่ได้บอก) · `last_done_at` = `getWorkDate()` |
| 15 | `PmCoordination.jsx` | `functions.invoke` error · toast เขียวตามผลจริง · tasks insert-ก่อน-ลบ · `setBusy(false)` · แผนใหม่บันทึกซ้ำไม่สร้างหัวซ้ำ · stamp `last_done_at` = `getWorkDate()` + นับแถว |
| 16 | `PmForecast.jsx` | `pm_usage_daily` ล้ม = แถบเตือน |
| 17 | `MtnAnalysis.jsx` | stale guard = request id ใน load · UX: แท็บสินทรัพย์ตั้งต้น = กลุ่มแรกที่มีข้อมูล (`firstAssetWithData` + เทส) · ถอดชื่อตาราง/คอลัมน์ออกจากข้อความบนจอ |
| 18 | `SparePartMaster.jsx` | delete ยอดใช้ manual อ่าน error |

**✅ UX quick wins (05/10):** PPM ยอดผลิต 0 = "—" ไม่ใช่ 1,000,000 (`KpiMonthly` + `obeyaYear`) · `/program-update` ตั้งต้น "สำหรับผู้ใช้" ซ่อนเอกสาร/งานระบบ

**✅ แก้แล้ว (batch ผลิต/admin · branch `fix/qc-production-admin`)**
| # | ที่ | สาระ |
|---|---|---|
| 5 | `DailyReport.jsx` loader 4 ตัว | 🔴 stale-response: คำตอบช้าของกะก่อนหน้าเขียนทับกะที่เลือก → ref `selSessIdRef` + `isStaleSess()` หลังทุก await |
| 6 | `DailyReport.jsx` ปิดกะ | ปิดตรง/ส่งขอปิด ตัดสินด้วย `role==='leader'` → `closeIsRequest = !can(close_shift)` · `canEditRecords` ใช้ `canRequestClose` (ด่าน `daily-report-close-by-permission`) |
| 7 | `DailyReport.jsx` ยิง/เปิดเป้าย้อนหลัง | hardcode 08–20 → `backfillWindowError()` (`resolveShiftTime`+`checkShiftTime`) · ด่าน `daily-report-backfill-shift-window` |
| 8 | `DailyReport.jsx` ประวัติ + ถอยใบ | โหลดล้ม = แถบแดง ไม่ใช่ "ไม่พบข้อมูล" · รายละเอียดล้มไม่ cache [] · ถอยใบ CAS 0 แถว = หยุด (ไม่ถอน stock ซ้ำ) |
| 9 | `Management.jsx` | ปิด `station_assignment_logs` เดิมล้ม = ไม่ insert · 4M Man case 2/3 กันซ้ำ (คน+จุด+ไลน์ ที่ยัง pending) |
| 10 | `Checkin.jsx` | ตรึงกะตอนโหลด (บันทึกหลัง 20:00 ไม่ยกเลิกจองรถ OT คืนพรุ่งนี้อีก) + แถบเตือนข้ามกะ · ลบจองล่วงหน้าอ่าน error |
| 11 | `LineSetup.jsx` | cascade ชื่อไลน์ → `line_delivery_points`/`storage_locations` อ่าน error เข้า `bumpFailed` · ลากจุด/ลบจุดงานนับแถว |
| 12 | `OjtTraining.jsx` | ลายเซ็นเก่าลบหลังบันทึกสำเร็จ · ผู้เข้าอบรม upsert/insert ก่อนแล้วลบเฉพาะคนที่ถูกเอาออก · ช่องลายเซ็นหัวเอกสาร → `PersonSelect` |
| 13 | `AddUser.jsx` | ขั้นย่อยหลังสร้าง/แก้บัญชีคืน error ให้รวบ → toast แดงรายขั้น (ไม่ขึ้นเขียวตอนบางขั้นล้ม) · update profile นับแถว · ซิงค์จากฐานพนักงานล้ม = toast |
| 14 | `PermissionsManagement.jsx` | เพิ่ม `/monitoring` `/mtn-analysis` `/nm-board` + เทส `navPermissionCoverage` (NAV_ITEMS ทุกหน้าต้องมีแถว) · โหลดสิทธิ์ล้ม = ไม่โชว์ตาราง (กันติ๊กทับ) |
| 15 | `App.jsx` | redirect PM 5 + Daily Checker 4 → `LegacyTabRedirect` (ด่าน `legacy-redirect-keeps-query`) · realtime กระดิ่ง + `role_permissions` ผ่าน `coalesce(LIVE.PAGE)` |
| 16 | `OrgSetup.jsx` | บันทึก/เปิด-ปิด/ลบ นับแถว (RLS 0 แถว = แจ้ง ไม่ขึ้นเขียว) |
| — | `LineSetup.jsx` `wip_buffer_points` | **ไม่แก้ — รายงาน:** เขียนแค่ rename cascade (คงประวัติให้ชื่อตรง) + ลบตอนลบไลน์ทั้งไลน์ · ไม่ได้เขียนยอด/เรียก `wip_point_add_qty` · จะเลิกลบประวัติตอนลบไลน์ไหม = ให้ user ตัดสิน |

**✅ workflow audit (05/10):** คิวงานของฉันอ่าน `current_step` เป็นขั้นที่รอ ⇒ ช้าไป 1 ขั้นทุกใบ (ใบรอ QA 204 ใบไปอยู่ที่ผู้แจ้ง · ใบรอจ่ายงานหาย) → `nextStepOf()` ใน `mtnStepPerm.js` ใช้ร่วมกับ MtnRepair · ลงถังจาก Daily Report แจ้ง QA (`quality_bin_added`) · ค้างส่งต่อ batch planning: FlowTower นับใบเบิกวัตถุดิบด้วย `!= 'done'` (1,472 แทน 482) · HeijunkaKanban โหลดใบเบิก 400 ใบล่าสุดไม่กรองสถานะ (ซ่อน 172 ใบ)
**⛔ workflow audit — รอ user ตัดสิน:** trigger `fn_explode_child_demand` ไม่เคารพชั้น BOM (`parent_mat`) ⇒ ระเบิดซ้ำ 217 แถว/70 FG (ความต้องการ/ใบขอซื้อเกินจริง) · ทุก MO ต้องผ่าน QA (ค้างโต ~70 ใบ/สัปดาห์) · รับของ bulk 01/10 (4,005 ใบ ≈2M ชิ้น) จริงหรือไม่ · PM ตรวจไม่ผ่านเปิด MO อัตโนมัติไหม · ใบเศษถังแดงดึงข้ามวันได้ไหม · ให้ mtn/engineer มี `obeya:record` · qa มี `morning_meeting:record`

**✅ DB audit (05/10) — แก้ฝั่งโค้ด:** ถอยใบผลิตที่ปิดแล้ว ลบแถว `issue` ใน `line_stock_transactions` ที่**ไม่มี DELETE policy** ⇒ ลบได้ 0 แถวเงียบ แต่ขึ้น toast เขียว "ถอนยอด stock ให้เรียบร้อย" → เช็คแถวที่เหลือ ถ้ายังอยู่ = แจ้งเตือนให้ Store ตรวจยอด (ทางแก้ถาวร = นโยบายลบเฉพาะ `created_by='auto' and type='issue'` หรือ RPC — **รอ user**)
**⛔ DB audit (05/10) — รอ user ตัดสิน (SQL เต็มอยู่ในแชท 05/10):** MAIN ~40 ตารางเขียน/ลบได้ทุก authenticated (เคยเสียหายจริง: workstation ถูกลบ 39 ครั้ง ⇒ `daily_production_logs.assigned_line` 41% ชี้จุดงานที่ไม่มีแล้ว) · CQI-15/4M ไม่มี audit trigger (ข้อมูล CQI-15 ถูกลบโดยไม่มีร่องรอย) · `notifications` 81 MB/20k แถว กระดิ่ง ~0.5 วิ · DR anon ลบประวัติได้ทุกตาราง (one-curl wipe ผ่าน cascade) · CASCADE จาก master → ประวัติ (jigs/machines/mtn_spare_parts/mtn_orders/child_lot_requests) · stock ผี 108 แถว 6,245 ชิ้นจากใบที่ถูกลบ · ไฟล์ EDI ลูกค้าใน bucket `demand-mail` anon อ่านได้

**✅ แก้แล้ว (batch จอเดโม/ผู้บริหาร · branch `fix/qc-exec-screens`)**
| # | ที่ | สาระ |
|---|---|---|
| 17 | `orderPlanQty()` (oee §6.1) | เป้าใบผลิตกติกาเดียว: cancelled 0 · imported = min(เป้า, ทำได้) · carry_over เต็ม — Obeya D (เดือน+ปี) · FactoryMap · GroupOverview · DeptDashboard · Dashboard · MorningMeeting · vsmLive · ด่าน `order-plan-via-helper` · RPC ปีส่ง Σ ต่อสถานะ (ข้อจำกัดระดับกลุ่ม — ไม่แก้ SQL) |
| 18 | Obeya C/Pareto | ไม่มีกะ = เทา "ยังไม่มีข้อมูล" (`axisCost`/`axisCostYear` รับ `sessions`) · ปี RPC ล้มตั้ง `dtBad`/`dfBad` · C เดือนตัดของเสียทดลองเหมือนปี |
| 19 | สี OEE | `oeeTargetForLines` + `statusOf`/`valueInk` แทน 80/65 (FactoryMap · GroupOverview · DeptDashboard) · ไม่รู้เป้า = เทา |
| 20 | wLoad | `dtMinBySession` ที่ FactoryMap (ทบทวน + sparkline) · DeptDashboard · GroupOverview · ด่าน `no-wload-without-break-helper` จับสูตรเขียนเอง |
| 21 | stale-response | `useLatestRequest()` ใหม่ (+เทส) — SQDCM · WorkforceInsight · MorningMeeting · Energy · OEEAnalytics · LineOeeBoard · Dashboard · FactoryMap ทบทวน · GroupOverview |
| 22 | โหลดล้ม ≠ 0 | MorningMeeting · FactoryMap ทบทวน · GroupOverview · TvBoard (แถบแดง + ลองใหม่ 30 วิ) · Dashboard (ซ่อน OEE สด) · OEEAnalytics วันนี้ |
| 23 | Dashboard | live OEE ใช้ `pairMap` ของรอบโหลดนั้น (เดิม state เก่า ⇒ %P คู่ RH/LH 2 เท่า) |
| 24 | ทะเบียน CT/พัก | `utils/oeeMasters.js` แบ่งหน้าครบ + โยนเมื่อล้ม (`:v2`) · LineOeeBoard ไลน์เคยผลิตแบ่งหน้าครบ · ด่าน `master-cache-swallow` จับ 2 บรรทัด |
| 25 | CapacityBoard / QaFmeBoard | `oee_targets` อ่านจาก Main + เตือนเมื่อล้ม · realtime `qa_fme_obligations` แยก board `client: supabase` |
| 26 | chartsweep/stdsweep | ป้ายหน่วยแกน `axisUnitLabel`/`axisUnitTop` + Pareto `shortTick` (Obeya 0 ปัญหา) · StockReceiptQueue แถบกรองชิดแท็บ · MaterialRequests ตัด padding บน (QualityControl 20→16px) |
| UX | จอเดโม | TV มีชื่อไลน์ในกรอบ (`utils/regionGeom.js`) · GroupOverview พับ mockup/คำอธิบาย + ตัดข้อความนักพัฒนา + "ยังไม่มีข้อมูล" แทน 0/0 (2.61→1.98 จอ) · SQDCM จอ < 800px ไม่บีบ · Obeya หัวเพจเดียว · งานค้างไม่มี "?"/หัวข้อว่าง · ตัด `scoreDef`/`parts_master`/`safety_events` ออกจากข้อความบนจอ |

**✅ แก้แล้ว batch 3 — planning/store (branch `fix/qc-planning-store`)**
| # | ที่ | สาระ |
|---|---|---|
| 1 | `PlannerSales.jsx` ลบไฟล์ | 🔴 detach ใบประวัติด้วยตัวกรอง (ไม่ใช่ `.in()` ยาว) · นับ exact ก่อน/หลัง · ไม่เท่ากัน = ยกเลิกการลบ (FK cascade จริง) |
| 2 | `PlannerSales.jsx` EDI | insert ก่อน → ลบฉบับเดิมตาม id (ทีละ 200) · ล้ม = ถอย batch ใหม่ · ใบวันเก่า/ที่ทำแล้วอ่านแบ่งหน้า+เช็ค error · ship_to upsert/จับคู่ MAT เช็คผล |
| 3 | `PlannedLotQueue.jsx` | 🔴 โหลดใบผลิตทุกกะของไลน์+วันงานเอง (`production_sessions!inner`) · stale guard · โหลดไม่ได้ = แถบเตือน |
| 4 | `ProdLotPlanner.jsx` | หลัง insert โหลดใหม่เสมอ (กันล็อตซ้ำ) · UPDATE 0 แถว = ล้ม · โหลดใบผลิตล้ม = แถบเตือน |
| 5 | `HeijunkaKanban.jsx` | ตัดสต็อกล้ม → ลองใหม่ก่อน "ถึงไลน์" (กันตัดซ้ำจาก note) · รับไม่ครบ ledger ล้ม = คืน claim · demand แบ่งหน้า+error · carry_over/imported = `qty_actual` |
| 6 | ช่วงพักบอร์ดไทม์ไลน์ | `halfDayBreakIntervals()` แทนสูตรก๊อป 4 จุด (Heijunka ×2 · Dashboard · Management) + ด่าน + เทส |
| 7 | `deliveryRounds.js` `timeStrToMs` | 🔴 ทุกเวลาเลื่อน +8 ชม. (ฐาน 08:00 + ชั่วโมงเต็ม) → ฐานเที่ยงคืน · เทสใหม่ |
| 8 | `CustomerDemand.jsx` advance | ตัดสต็อก FG ล้ม = คืนสถานะใบ + ไม่ยิงแจ้ง "ส่งแล้ว" |
| 9 | `RackCenter.jsx` | เลื่อนขั้น/ยกเลิก/จ่าย packaging = CAS + นับแถว |
| 10 | `FlowTower.jsx` | "ผลิตวันนี้" = `orderDonePcs` + fetchByIds + ล้ม = "—" · poll ผ่าน `makeIdleGate` (floor `RATE.SLOW`) |
| 11 | `planLots.js` `orderDonePcs` | ใช้ `orderInQty` (ห้ามถอยไปเป้า) · cancelled = 0 · null-safe · เทส |
| 12 | `ProductHistory` / `OrderTrace` | stale guard · ค้นล้มขึ้นแถบแดง · `orIlike()` escape `,()` (`pgrstFilter.js` + เทส) · ช่องค้น+ปุ่มกลุ่มเดียว placeholder สั้น |
| 13 | `MonitoringUpload.jsx` | ส่วนต่างสต็อกคิดใหม่จากยอดสดตอนยืนยัน (`stockAdjustPlan` + เทส) · ข้อความล้มบอกตรงว่าข้อมูลบางขั้นถูกล้าง |
| 14 | `Transport.jsx` saveStops / `PullSignalUpload.jsx` | เส้นทาง insert-first (seq สลับช่วง) · ตัวนับ batch e-SMART นับแถว |
| 15 | `FlowTower.jsx` · `HeijunkaKanban.jsx` ใบเบิก/ใบ child | ค้าง = `pending` (ตารางไม่มี `done` — เดิมนับ cancelled เป็นค้าง 1,472 แทน 482) · คิวสโตร์โหลดใบค้างทุกหน้า + ประวัติล่าสุด (เดิม 172 ใบรอจ่ายหาย · ใบยกเลิกขึ้นปุ่มจ่าย) · ด่าน `raw-withdrawal-status-set` |

**⏳ ค้าง — โค้ดล้วน (ทำได้เลย · เรียงตามผลต่อ roadshow)**
- จอเดโม: Obeya SQDCM โหลดเป้า OEE ล้มแล้วถอยไปเป้า default เงียบ · MtnAnalysis แท็บ QC7 พาเรโต ป้าย "100.0%" ล้นกรอบ 11px (chartsweep)
- ข้อมูล/สต็อก: write ไม่เช็ค error ~8 จุด (ลำดับรอง)
**⛔ ค้าง — ต้องให้ user ตัดสิน (RLS/edge/security — ห้าม auto-merge)**
- 🔴 `telegram_channels` / `notification_rules` เขียนได้ทุก authenticated (เปลี่ยน chat_id รับแจ้งเตือนทั้งโรงงานได้)
- 🔴 edge แจ้งเตือน (`send-notification`/`-event-`/`-mtn-`/`-store-`/`-cqi15-`/`send-push`) `verify_jwt=false` ไม่เช็คผู้เรียก ⇒ ยิงแจ้งเตือนปลอม/ push ใครก็ได้จากภายนอก · `daily-4m-summary` รับ Bearer อะไรก็ได้
- 🔴 `employees` UPDATE/DELETE `using(true)` · 🔴 `profiles` INSERT `with check(true)` (ถ้าเปิด sign-up = สมัครเองเป็น admin ได้)
- 🟡 `org_nodes`/`section_signers` ไม่จำกัด "หน่วยตัวเอง" ฝั่ง server · `company_calendar`/`ojt_*` เขียนได้ทุกคน · `telegram-webhook` secret ว่าง = เปิด (ยังไม่ deploy)
- MachineDatabase เปลี่ยน `machine_no` ไม่ cascade ประวัติ (ต้องตัดสินว่าจะ cascade หรือบล็อก)

### full QC audit หา zero-day (2026-09-02..04 · 10 รอบ) — สรุปคลาสบั๊ก
รายละเอียดแต่ละรอบอยู่ในข้อความคอมมิท (`git log --grep="audit รอบ"`) · กฎที่ตกผลึกอยู่ CLAUDE.md §"กฎเหล็กการเขียน DB จาก client"
- **วิธีที่ได้ผล:** ทุก finding วัดกับฐานจริงก่อนตัดสิน · เทส RLS ต้อง**สวมบทผู้ใช้จริง** (`set_config('request.jwt.claims', …)` + `set local role authenticated` ปิดท้าย `raise exception 'RESULT: %'` ให้ rollback) — service role bypass RLS แล้วหลอกว่าผ่าน · เช็คชื่อคอลัมน์จริงก่อนเขียนคิวรีเทส
- **รอบ 10 (2026-09-04):** RLS hardcode role array แคบกว่าสิทธิ์ UI 5 ตาราง + `operator_special_tasks` ไม่มี UPDATE policy (upsert เปลี่ยนงานนอกไลน์พัง 42501 ทุก role) → `20260904_rls_match_ui_permissions.sql` + client นับแถว (Management · LineSetup · operator · ShiftOrganize) · EventLog สร้างใบแล้วไม่เช็คว่ารายการอนุมัติเกิด (ค้าง in_progress ตลอดกาล) · DailyReport ลูปยกยอดไม่เช็คผล (กะปิดแต่ใบยัง open) · trigger explode ไม่ stamp `ref_order_id` ให้แถว consume (2,247 แถว สอบกลับไม่เห็น) → `20260904_explode_consume_ref_order.sql`
- **ค้าง (ยืนยันแล้ว ยังไม่แก้):** StoreMonitor scope ไม่มี fallback "กรองแล้วไม่เหลือ" · MaterialRequests ใช้ `.includes()` แทน `inSectionScope` · ProductMaster `pair_mat_no` ตั้งข้างเดียว · edge: mtn-daily-summary `.catch(()=>null)` · insertNotifications dead try/catch · cleanup-orphan-photos token hardcode · downtime-open-scan mark ไม่เช็ค · ไม่มี `supabase/config.toml` · advisor: 5 ตาราง Main เปิด RLS ไม่มี policy (`notification_settings`·`shift_schedule_alerts`·`telegram_*` — client ไม่แตะ ใช้ service role เท่านั้น) · `push_subscriptions` upsert `ignoreDuplicates` = เครื่องแชร์กัน (แท็บเล็ตหน้าไลน์) endpoint ค้างเป็นของ user แรกที่ login ไม่ย้ายให้คนถัดไป (ยังไม่วัดผลจริง)
- **รอบ 11 (2026-09-07):** `cleanup-orphan-photos` คิวรี whitelist ผังรวมโรงงานไม่เช็ค error = ล้มแล้ว**ลบรูปผังจริง** + token ฝังในซอร์ส → env secret fail-closed · edge 5 ตัว in-app notify กลืน error (dead try/catch) · downtime-open-scan stamp กันแจ้งซ้ำล้มเงียบ · mtn-daily-summary Telegram ล้มเงียบ · StoreMonitor/MaterialRequests เขียน scope เองขาด fallback → ใช้ `scopedLineNames` กลาง · ProductMaster ผูกคู่ RH/LH ไม่เช็คผล (วัดจริง: 30 คู่ชี้กลับครบ ยังไม่พังจริง — กันไว้) · **ที่ตัดออกหลังวัด:** `pair_mat_no` ตั้งข้างเดียว (ไม่พบในฐาน) · 5 ตาราง RLS ไม่มี policy (client ไม่แตะ)
- **รอบ 12 (2026-09-07):** 🔴 `get_auth_users()` (SECURITY DEFINER อ่าน `auth.users`) **anon เรียกผ่าน RPC ได้** = อีเมล login ทุกบัญชี (86) รั่วโดยไม่ต้อง login → guard admin + revoke anon (`20260907_get_auth_users_admin_guard.sql` apply แล้ว · เทส: anon exec=false · leader → forbidden · admin 86 แถว) · กวาด "เขียนเปล่าไม่อ่าน error" **69 จุด/23 ไฟล์** ด้วย helper `src/utils/dbWrite.js` (`checkWrite`) + จุด delete-then-insert 8 แห่ง หยุดก่อน insert เมื่อ delete ล้ม (กันแถวซ้ำ) + จุดใน try/catch ให้ throw · try/catch ตาย 2 จุด (PlannerSales · AddUser) · cron 16 job ทั้ง 2 project สำเร็จหมด 14 วัน (ไม่มี zero-day ฝั่ง cron) · advisor ที่เหลือ: SECURITY DEFINER view 5 ตัว + ตาราง `_bak_*` ไม่มี RLS ฝั่ง DR (anon-open โดย convention อยู่แล้ว — ไม่ใช่รูใหม่) · `bot_token`/`set_bot_token` มี guard admin อยู่แล้ว

### สวีป dropdown ให้ค้นได้ทั้งระบบ (2026-09-08) — regression 2 รอบจากงานเดียว
คำสั่ง user: *"audit ระบบการเลือก dropdown list ของทุกจุด ทุกหน้าทุกแท็บ ตรงไหนไม่มีระบบ search/filter … ต้องแก้นะ"* → แปลง `<select>` ยาว 20 จุด/13 ไฟล์เป็น `SearchSelect`/picker กลาง
**แล้วหน้างานแจ้งกลับ 2 รอบในวันเดียวกัน — ทั้งคู่มาจากการแปลงนี้เอง:**
1. *"ปกติมันจะเป็นไลน์ผลิตค่ะ ตอนจะแอดอุปกรณ์ใหม่"* — `optgroup` ตามไลน์หายตอนแปลง (635 เครื่องเรียงแบน) → `groupByLine` + `maxRows` คลุมทั้งลิสต์
2. *"เลือกละหาจิ้กไม่เจอ พิมพ์หาก็ไม่ได้"* — `MachineSelect valueKey='id'` ส่ง `text=''` (controlled ว่าง) ⇒ ตัวอักษรถูกลบทุก render + ตัวกรองไม่เคยทำงาน → helper `pickerText()` คืน `undefined` ให้ picker ที่เก็บ FK id + SearchSelect sync `innerText` แม้โหมด controlled + พาเรนต์ no-op เมื่อค่าไม่เปลี่ยน (เดิมล้างฟอร์มทั้งใบทุก keystroke)

**บทเรียน (กฎเต็มอยู่ `docs/UI-CONVENTIONS.md` §5.1.1):**
- **แปลง `<select>` → ช่องค้นหา ไม่ใช่งาน mechanical** — ต้องยกโครงกลุ่มมาด้วย และเช็คว่าพาเรนต์มี "ที่เก็บคำค้น" จริงไหม
- **build/lint/เทสหน่วยผ่านครบ แต่ช่องพิมพ์ไม่ได้เลย** — บั๊ก UI แบบ controlled/uncontrolled ต้องเปิดเบราว์เซอร์จริงวัด `input.value` หลังพิมพ์ + จำนวนแถวที่เหลือ (ทำผ่าน `audit/vite.audit.mjs` + Playwright · lab เล็กๆ ที่ mount component ตรง เร็วกว่าไล่หาปุ่มในหน้าจริงที่ติด permission gate)


---

## QC audit เต็มโปรเจค 2026-10-06 (4 agent ขนาน A–G) + ผลการเคาะของ user

รันบน main `63c8c944` · พบ **🔴 9 · 🟡 28 · 🔵 25** · ด่านอัตโนมัติทุกตัวยังผ่านหมดตอนรัน
(เทส 2,392 · stdsweep · searchsweep · lint) ⇒ **ของที่เจอคือสิ่งที่ด่านยังมองไม่เห็น**

### 🔑 ประเด็นที่ใหญ่กว่าตัวบั๊ก — ด่านรั่ว 6 จุด
| ด่าน | รั่วตรงไหน | หลุดกี่จุด |
|---|---|---|
| **grep ทั้งระบบ** | `src/pages/EventLog.jsx:149` มีไบต์ NUL ⇒ `file` อ่านเป็น binary ⇒ **ripgrep ข้ามทั้งไฟล์เงียบๆ** | ทุก audit ที่ผ่านมาไม่เคยตรวจไฟล์นี้ |
| `no-utc-workdate` | regex ผูกกับ `new Date()` เปล่าๆ | 2 |
| `matOrderSweep` | ไม่รู้จักคอลัมน์ชื่อ `name` (รู้จักแค่ `part_name`/`p_no`) | 9 |
| `card-shadow-via-token` | จับแค่รูป `0 [0-3]px Npx rgba(...)` | 48 |
| `<Cell>` guard | เช็คแค่ `fill` ไม่เช็ค `tooltipProps` | 2 |
| *(ไม่มีด่าน fontSize)* | เอกสารเขียน 11 มาตลอดแต่ไม่เคยมีด่าน | 160 |

➕ `checkWrite()` **ไม่นับแถว** แต่หน้าตา API ทำให้คนคิดว่านับ ⇒ 10 จุดใส่ `.select('id')` ไว้เปล่าๆ

### ✅ ที่ user เคาะแล้วและทำเสร็จในรอบนี้ (06/10)
1. **CSV export เข้าข่ายกฎ doc-forms → "ทำเลย"** — seed 8 doc_key + ของกลาง `src/utils/csvDoc.js`
   · 📄 `doc-forms.md` §CSV export ก็เป็นเอกสาร
2. **3 หน้าที่ไม่มีตัวกรองขอบเขต → "เอาให้เป็นมาตรฐาน"** — `/heijunka` เติม `<LineScopeSelect>` (เป็น
   ตัวกรองมุมมอง ไม่ใช่การบังคับ) · `/monitoring` + `/rundown-stock` ไม่เติมพร้อมเหตุผล
   · 📄 `role-system.md` §เคาะเพิ่ม 2026-10-06
3. **ฟอนต์ 11 vs 10.5 → "แก้ให้เป็นมาตรฐาน"** — ยึด **11** ทั้งเอกสารและด่าน · กวาด 160 จุด ·
   ด่านใหม่ `font-min-11` + chartsweep 10.5→11 · 📄 `UI-CONVENTIONS.md` §4

### ⏳ ที่ยังไม่ได้แตะในรอบนี้ (รอ user สั่ง — เรียงตามที่เสนอไว้)
- **รอบ 1:** publication ขาด 4 ตาราง (`monitor_cells`/`monitor_board_parts` ฝั่ง DR ·
  `daily_production_logs`/`four_m_logs` ฝั่ง Main) ⇒ จอช้าได้ถึง 2 ชม. · ไบต์ NUL ใน `EventLog.jsx` ·
  `addDays` ใน `MonitorFgSync` คืนวันย้อน 1 วัน
- **รอบ 2:** `checkWriteRows()` ของกลาง + 10 จุด · RLS `org_assignments` / `doc_forms` /
  `factory_map` / `oee_targets` ให้ตรงคีย์ปุ่ม · ขยายด่านที่รั่ว
- **รอบ 3:** เกต HEIC ของ `SignatureModal` · array ใน deps (`OeeInsightPanel`) · เลขฟอร์ม hardcode
  ใน `kpiExportExcel` · MAT มาก่อนชื่อพาร์ท 9 จุด · picker ลูกค้าใน `/customer-demand` ·
  pointer events ของ `/line-setup`

---

## ✅ ลงมือแก้ครบ 3 รอบ (2026-10-06 · คำสั่ง user "ทำหมด")

ต่อจากรายการค้างในหัวข้อ audit 06/10 ข้างบน — **ทำครบทุกข้อ** ยกเว้นที่ระบุว่าตั้งใจไม่ทำ

### รอบ 1 — บั๊กเงียบที่ไม่มี error ให้เห็น

| ข้อ | สถานะ | หมายเหตุ |
|---|---|---|
| publication ขาด 4 ตาราง | ✅ apply ทั้ง 2 project | DR: `monitor_cells`/`monitor_board_parts`/`monitor_boards` · Main: `daily_production_logs`/`four_m_logs` · ตรวจกลับ **ครบ 18/18 ตารางที่โค้ด subscribe** |
| ทะเบียน + ด่าน กัน publication ตกหล่นรอบที่ 4 | ✅ | `src/utils/realtimeTables.js` + ด่าน `realtime-table-registered` (ต้นเหตุร่วม 3 รอบ = ลิสต์อยู่ในเอกสารที่เขียนมือ) |
| ไบต์ NUL ใน `EventLog.jsx:149` | ✅ + ด่าน | สแกนทั้งรีโปแล้วเหลือ 0 ไฟล์ |
| `addDays` คืนวันผิด (`MonitorFgSync`) | ✅ | **ทดสอบทั้ง 18 ชุดใต้ 5 timezone → พัง 1 ชุด** · ของกลางใหม่ `addDaysStr()` · 📄 `time-range-filter.md` |
| `CtReview` `since` คิดจาก UTC | ✅ | → `addDaysStr(getWorkDate(), -DAYS_BACK)` |
| เอกสารที่เป็นต้นเหตุ (`storage-images.md` ลิสต์มือ) | ✅ | เลิกเก็บลิสต์มือ · ชี้ทะเบียนในโค้ด + คิวรีอ่านสด **ทั้ง 2 project** |

### รอบ 2 — ปิดคลาสบั๊ก + รัด RLS + ขยายด่านที่รั่ว

| ข้อ | สถานะ | หมายเหตุ |
|---|---|---|
| `checkWriteRows()` ของกลาง | ✅ + 2 ด่าน | แปลง 7 จุดที่ต่อ `.select()` ไว้แล้วแต่ส่งเข้า `checkWrite` · 📄 `db-write-rules.md` |
| RLS 6 ตารางเปิดโล่ง | ✅ apply | `doc_forms`(+2) · `factory_map`(+1) · `oee_targets` → ตรงคีย์ปุ่มบนจอ · 📄 `role-system.md` |
| `org_assignments` จอ ≠ RLS | ✅ | จอตรงกับ RLS + เขียนบนจอว่าทำไมไม่มีปุ่ม (ไม่เปิด RLS ให้ `manage_own_unit` ลอยๆ) |
| `positions` role array มือ · `grades` คีย์เกษียณ | ✅ apply | `page:/add-user` · คีย์ใหม่ `grades:manage` seed = ชุดเดิมเป๊ะ |
| คีย์ที่ไม่มีในทะเบียน (`CapacityBoard`) | ✅ | `production_plan:edit`+`master_data:manage` → `production_plan:write` (เดิม **ทีมวางแผนแก้ไม่ได้เลย**) |
| ด่าน `no-utc-workdate` รั่ว | ✅ ขยาย | จับ `.toISOString().slice(0,10)` ทุกรูป · เหลือ 0 จุด **ไม่ยกเว้นไฟล์ไหน** |
| ด่าน `card-shadow-via-token` รั่ว | ✅ ขยาย + แก้ 32 จุด | เดิมจับแค่ offset 0-3px ⇒ modal/popover รั่วหมด · เหลือ 12 จุดที่ยกเว้นโดยเจตนา (เงาเรืองแสงสี · เงาแนวนอน sticky · เงาผสม inset) |
| ด่าน `picker-label-stuffed-with-codes` รั่ว | ✅ ขยาย + แก้ `/line-stock` | รูป "ข้อความมาก่อน รหัสต่อท้าย" = กลไกเสียหายตัวเดียวกัน |
| ด่าน `<Cell>`→`tooltipProps` | ✅ ด่านใหม่ | **วัดแล้ว 0 จุด** — ข้อนี้ audit ประเมินเกินจริง ด่านที่ใส่ไว้คือล็อกสถานะที่ดี |

### รอบ 3

| ข้อ | สถานะ | หมายเหตุ |
|---|---|---|
| HEIC + objectURL leak (`SignatureModal`) | ✅ + ด่าน | พบว่าเป็นคลาสใหญ่: **12 ช่องรับรูปใน 9 ไฟล์** ⇒ ของกลาง `acceptImageFile()` · 📄 `storage-images.md` |
| array ใน deps (`OeeInsightPanel` ← `OEEAnalytics`) | ✅ | แก้ 2 ชั้น: `useMemo` ที่หน้าแม่ + deps ใช้คีย์ string ในแผง · **ไม่ทำด่าน** (เหตุผลใน `build-gates.md`) |
| เลขฟอร์ม hardcode (`kpiExportExcel`) | ✅ apply | 3 ชีท = 3 doc_key · + ตัวล้างชื่อชีท (ทะเบียนเป็น input จากคน) · 📄 `doc-forms.md` |
| ลากหมุดด้วยเมาส์อย่างเดียว (`LineSetup`) | ✅ + ด่าน | pointer events + `pointercancel` + `touchAction` · เดิม **แก้ผังบนจอทัชไม่ได้ทั้งหน้า** |
| CLAUDE.md แตะโซนเตือน | ✅ | เพิ่มกฎใหม่ 3 ข้อ แล้วรีดสุทธิ **112.7 → 109.5 KB** ในคอมมิทเดียวกัน (ตามกฎของตัวเอง) |

### ที่เหลือ — ตั้งใจไม่ทำในรอบนี้ (มีเหตุผลกำกับ ไม่ใช่ลืม)

- **54 จุดที่ `checkWrite` ห่อ UPDATE/DELETE โดยไม่นับแถว** — 0 แถวเป็นเรื่องปกติในหลายจุด
  (touch best-effort · ผูกของที่อาจหายแล้ว) ⇒ แปลงเหมา = toast แดงหลอกหน้างาน · **ต้องอ่านบริบทรายจุด**
  · 42 จุดในนั้นเป็นรูป `.eq('id', …)` = กลุ่มที่ควรแปลงก่อนเมื่อมีคนไล่ต่อ
- **14 ชุด `addDays` ที่เหลือ** — วัดแล้วถูกต้องทั้งหมด · การยุบเหลือชุดเดียว = งานกวาด ไม่ใช่แก้บั๊ก
- **`manage_master_data` (คีย์เกษียณ) ยังมีแถวอยู่** — ยังไม่ได้ไล่ครบว่ามี policy อื่นอ่านอยู่หรือไม่ · ลบ = เสี่ยง
- ~~`shiftFrameOf()` vs `computeLiveOee()` ไม่ตรงกัน = product decision ต้องถาม user~~
  → **ตรวจแล้วเป็นบั๊กชัดเจน ไม่ใช่เรื่องต้องตกลงนิยาม** (วัดได้ว่ากรอบกะเพี้ยน 20 ชม. · มีของจริง 5 กะ)
  **แก้แล้ว** — ของกลาง `shiftStartDate()` · 📄 `oee.md` §shiftStartDate
  ⚠️ ที่ยังค้าง: ยังไม่ backfill ค่า OEE ที่ stamp ไว้ของ 5 กะนั้น
- ~~`page:/flow-tower` ไม่เคย seed~~ → **ตรวจแล้ว seed ไว้อยู่แล้ว 11 role**
  (admin · display · document_control · engineer · leader · manager · mtn · planner_store · qa ·
  supervisor · warehouse_delivery) ⇒ **audit รายงานผิด ไม่มีอะไรต้องแก้**
  (เทียบ: `page:/group-overview` และ `page:/adoption-outlook` = admin + manager เท่านั้น — จอผู้บริหารจริง)
- **3 กราฟรายวันที่ข้ามวันไม่มีข้อมูล** · **select → picker กลาง (VSM/PEDocs/ProductMaster)** ·
  **`SearchInput` 11 จุด** · **`StoreTimeChart` แกนเวลา 2 ชุด** · **`ShiftOrganize` canEdit/canDel**
  — งาน UI standardization ที่ไม่มีบั๊กทำงาน ค้างไว้เป็นรอบถัดไป (ไม่กระทบตัวเลข/สิทธิ์/ข้อมูล)

### 🔁 รอบ 3 (ต่อ) — งาน UI standardization ที่ทำเพิ่มในรอบเดียวกัน

| ข้อ | สถานะ | หมายเหตุ |
|---|---|---|
| `UserContext` value เป็น object literal 3 ที่ | ✅ | ทั้งอ็อบเจกต์ + array `sections` ใหม่ทุก render ⇒ ทุกหน้าที่มี `sections` ใน deps ยิง DB ซ้ำ · `useMemo` + ต้องวางก่อน guard `if (!session)` (ไม่งั้น React #310) |
| `effSections` array ใหม่ทุก render ตอน ViewAs | ✅ | memo ด้วยคีย์ string ของ `viewAs.sections` |
| `ShiftOrganize` ลบ override แบบเงียบ | ✅ | ไฟล์เดียวกันมี 2 ตัวลบที่ทำไม่เหมือนกัน — ตัวหนึ่งนับแถว ตัวหนึ่งไม่นับ · + ด่านชั้นที่ 2 (`canDel`) ทั้งคู่ |
| ช่องค้นหาที่เป็น `<input>` เปล่า | ✅ 6 จุด | → `<SearchInput>` · 📄 `UI-CONVENTIONS.md` §5.1.3 |
| `<select>` ที่ควรเป็น picker กลาง | ✅ 3 จุด | `/vsm` (เดิมมี **SearchInput + select = 2 ตัวทำงานเดียวกัน**) · `/pe-docs` · `/customer-demand` |
| `FRAME_START` ประกาศซ้ำ | ✅ + ด่าน | `InternalTimeBoard` = ตัววาดบอร์ดที่หลายหน้าใช้ร่วม ⇒ แกนเวลา 2 ชุดที่บังเอิญตรงกัน |

### ❌ ข้อที่ตรวจแล้ว **ไม่เป็นอย่างที่ audit ว่า** (บันทึกไว้กันคนมาแก้ของที่ไม่ผิด)

- **`<Tooltip>` ไม่มีธีม** — วัดทั้งรีโป **0 จุด** · ทุกตัวมี `tooltipProps`/`{...chartTip}`/`contentStyle`/
  `content={<CustomTip/>}` อยู่แล้ว (ใส่ด่านไว้ล็อกสถานะที่ดี ไม่ใช่แก้บั๊ก)
- **`addDays` หลายชุดพัง** — วัด 18 ชุดใต้ 5 timezone → **พังชุดเดียว** · อีก 17 ชุดถูกต้องหมด
- **`StoreTimeChart` แกนเวลา 2 ชุด** — จอนี้ไม่ได้ใช้ Recharts และ import ของกลาง `timeFrame.js` อยู่แล้ว
  · ตัวที่ประกาศซ้ำจริงคือ `InternalTimeBoard` (แก้แล้ว) — audit ชี้ผิดไฟล์
- **กราฟรายวันข้ามวันที่ไม่มีข้อมูล** — ที่ตรวจดู (`FactoryMap` sparkline OEE) **ข้ามถูกแล้ว**:
  วันที่ไม่มีการผลิตคือ "ไม่มีข้อมูล" ไม่ใช่ OEE = 0 · เติม 0 จะขัดกฎที่แรงกว่า ("ห้ามโชว์ 0 แทนไม่มีข้อมูล")
  🔴 สิ่งที่ควรทำคือ **เขียนบนจอว่าช่วงนี้มีข้อมูลกี่วัน** ไม่ใช่เติมศูนย์ — เป็นงานออกแบบ ต้องถาม user

### 🆕 เจอใหม่ระหว่างทำ (ยังไม่แก้ — บันทึกไว้)

- **`/morning-meeting` React warning "two children with the same key" × 13** —
  ดักค่าจริงแล้วได้ `id-1` … `id-13` = **id ของ mock** (`audit/mockSupabase.js` ออก `id-${i}` ให้ทุกตาราง)
  ⇒ เกิดเฉพาะใต้ mock ของ audit · ข้อมูลจริงเป็น uuid ต่อตาราง ชนกันไม่ได้ **ยังไม่พบผลกระทบกับของจริง**
  ⚠️ แต่ยังไม่ชี้ได้ว่าเป็นลิสต์ไหน (หน้านี้มี `key={line.id}` / `key={m.id}` / `key={d.id}` หลายจุด)
  🔴 **ถ้าเจอว่าลิสต์ไหนรวมแถวจาก 2 ตารางเข้าด้วยกัน ให้ใส่คำนำหน้าแหล่งในคีย์** (`mo-${id}` / `4m-${id}`)
  — ไม่ใช่เพราะ mock แต่เพราะคีย์ที่อิง id ดิบของหลายตารางเปราะโดยการออกแบบ · ไล่ให้จบรอบหน้า
- **`checkWrite` ห่อ UPDATE/DELETE อีก 54 จุด** (42 จุดเป็นรูป `.eq('id', …)`) — ดู `db-write-rules.md`
