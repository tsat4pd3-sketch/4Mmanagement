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

**⏳ ค้าง — โค้ดล้วน (ทำได้เลย · เรียงตามผลต่อ roadshow)**
- จอเดโม (ที่เหลือ): stale-response MtnAnalysis/ProductHistory/QualityBins · Obeya SQDCM โหลด `oee_targets` ล้มแล้วใช้เป้ามาตรฐานเงียบ
- ข้อมูล/สต็อก: PlannerSales ลบ batch ⇒ cascade ลบประวัติส่ง (`.in()` ยาว + 1000 แถว) · EDI import ลบก่อน insert ไม่มี rollback · ProdLotPlanner save ซ้ำ = ล็อตซ้ำ · PlannedLotQueue เทียบแผนทั้งวันกับใบกะเดียว · HeijunkaKanban deduct/receive ไม่คืนสถานะ · CustomerDemand advance ไม่คืนสถานะ · RackCenter ไม่มี CAS · MaterialRequests เลขใบ `count()+1` · VSM order/ปี บวกทุก forecast · `toRed` ไม่ส่ง `defect_log_id` · QA dashboard กรองสินค้าแล้วสูตรเปลี่ยน · PeChangeRequests `capa→ncr` · PFMEA proposal ไม่ CAS · CQI-15 approve ไม่นับแถว · ScrapReport header กำพร้า + เลขซ้ำตอนคิวรีล้ม · MtnRepair labour ถูกล้าง · PMCheckData header ไม่มีผล · PmCoordination toast เขียวตอนล้ม · break intervals ก๊อป 4 จุด · write ไม่เช็ค error ~8 จุด · ScanLanding `q=` ไม่ถูกอ่าน · ป้าย QR จุดส่งงานสแกนแล้ว "ไม่พบ"
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

