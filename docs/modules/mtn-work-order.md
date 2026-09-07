# MTN Work-Order — ใบแจ้งซ่อม MO 7 ขั้น (2026-07-14)

> ย้ายมาจาก `CLAUDE.md` (2026-09-03 — แยกไฟล์เพื่อลด context) · โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน


หน้า `/mtn-repair` (`MtnRepair.jsx`, กลุ่มการตรวจสอบและซ่อมบำรุง) — **clone ระบบ AppSheet เดิม (Jig MTN) มาอยู่ใน ESM** เพื่อไม่ต้องแยกระบบ + เก็บฐานข้อมูลเดียวกัน · ตารางทั้งหมดอยู่ **DR project** (anon-open ตาม convention)

> ### ⚠️ กฎเหล็ก — ฟอร์มขั้น 1-7 ต้องไม่ปิดเองจากการเผลอแตะ (audit ทั้งระบบ 2026-08-21 · feedback หน้างาน)
> *"เผลอกดด้านนอก popup แล้วปิด"* — ตรวจแล้ว **`ModalShell` ของ MtnRepair ไม่เคยมี backdrop-close เลย** (ไล่ git history แล้ว)
> ทั้ง `ReportModal` (ขั้น 1) · `DetailDrawer` · `StepModal` (ขั้น 2-7) และ modal ลูกที่เปิดซ้อน (`ScanModal` · `ImageCropModal`) ปลอดภัยอยู่แล้ว
> - **ห้ามเติม `onClick={onClose}` ที่ div ชั้นนอกของ `ModalShell`** (มีคอมเมนต์กำกับไว้ในโค้ดแล้ว)
> - **`StepModal` ซ้อนบน `DetailDrawer` โดย zIndex เท่ากัน (3000)** — ตัวหลังใน DOM ชนะการ hit-test ทั้งจอ คลิกจึงไม่ทะลุไปโดนปุ่มของใบที่อยู่ข้างหลัง · **ห้ามลด zIndex ของ StepModal**
> - **`stepModal.order` เป็น snapshot ตอนกดเปิด** → realtime `mtn_orders` ยิง `loadOrders()` ระหว่างกรอกก็ไม่ remount ข้อมูลไม่หาย · **ห้ามเปลี่ยนไปอ่าน `orders.find(...)` ตรงๆ หรือใส่ `key` ที่เปลี่ยนตามข้อมูล** (ผลข้างเคียงที่รับได้: ใบเป็นภาพ ณ ตอนเปิด — คนอื่นเลื่อนขั้นระหว่างนั้นจะไม่เห็น)
> - **✕ / ยกเลิก ถามยืนยันเมื่อกรอกไปแล้ว** (`dirty` + `confirmDiscard()`) — `dirty` ต้องถูกตั้งจาก **ทุก** ทางที่แก้ข้อมูล (ช่องกรอก · แนบรูป · เพิ่ม/ลบอะไหล่ · ลายเซ็น) เพิ่มช่องใหม่ต้องผ่าน `set()`/`touch()` เสมอ ไม่งั้นถามไม่ขึ้นแล้วข้อมูลหายเงียบ
> - **จุดที่ปิดจาก backdrop ได้จริงอยู่ที่อื่น — แก้แล้ว 12 จุด 9 ไฟล์** (FeedbackModal · SparePartMaster ×4 รวมพรีวิวนำเข้าไฟล์ · RackMap ×2 · DieLayout · BbsCheck · QaClaims · PeChangeRequests · RackCenter QR label) · กติกาเต็ม + รายชื่อ modal ที่**ตั้งใจ**คงการปิดจาก backdrop ไว้ → `docs/UI-CONVENTIONS.md` §5

- **Workflow 7 ขั้น (mirror ของเดิม):** 1 แจ้งซ่อม → 2 รับ/จ่ายงาน (**ออกเลข MO อัตโนมัติ**) → 3 ดำเนินการซ่อม → 4 ตรวจหลังซ่อม → 5 คุณภาพหลังซ่อม (**เฉพาะงานที่ step4 ระบุ "เกี่ยวกับคุณภาพ"** ไม่งั้นข้ามไป step6) → 6 รับมอบ/ติดตาม → 7 อนุมัติปิด (Close MO) · **⏭ ใบที่ค้างรอ QA แล้วแต่งานไม่เกี่ยวคุณภาพจริง กดข้าม step5 → 6 ได้** (ดูหัวข้อ "ข้าม QA" ด้านล่าง · 2026-09-03) · `status`: pending→assigned→repaired→checked→qa→handover→closed · `rejected` (step2 เลือก "Reject MO") · `current_step` 1..7 ใช้คิด % ความคืบหน้า
- **↩️ ตีกลับให้ผู้แจ้ง (แจ้งผิดแผนก · 2026-07-22 · migration `20260722_mtn_return_reroute.sql` DR — ⚠️ ค้างไม่ได้ apply มา 2 สัปดาห์ เพิ่ง apply จริง 2026-08-06):** ทีมที่ได้รับใบผิดแผนกกด Reject ที่ step2 → `status='returned'` + `returned_at`/`returned_from_dept` + เหตุผลใน `reject_reason` (reuse ช่องเดิม) → **ใบเด้งกลับหาผู้แจ้ง ไม่ถูกทิ้ง** → ผู้แจ้งเลือกแผนกที่ถูกแล้วส่งใหม่ (`resubmit`) → กลับเป็น `pending` + **รีเซ็ต `report_at`** (นาฬิกา KPI เริ่มนับใหม่ให้แผนกที่ถูก — ไม่โทษทีมที่เพิ่งได้รับใบ) โดยเก็บ `first_report_at` (เวลาเปิดครั้งแรก) + `bounce_count` ไว้อ้างอิง · การ์ดใบโชว์ชิป "↩️ ใบนี้เคยถูกตีกลับ N ครั้ง" เสมอเมื่อ bounce_count > 0 · **ระหว่างที่ migration ยังไม่ apply ฟีเจอร์นี้พังเงียบ** — กด Reject/ส่งใหม่ได้ error 42703 (`update` ไม่ tolerant ตัดคอลัมน์ที่ไม่มี) · `mtn_orders.status` ไม่มี check constraint จึงรับค่า `returned` ได้ทันทีหลังเติมคอลัมน์
- **ประเมินความพึงพอใจบริการซ่อม (step 6 รับมอบ/ติดตาม — KPI หน่วยงานซ่อม · 2026-07-22):** หน่วยงานผู้แจ้งให้คะแนน **5 ด้าน × 3 ระดับ** (เฉยๆ=1/พอใจ=2/พอใจมาก=3): คุณภาพงานซ่อม · ความเร็วในการตอบสนอง · ความสามารถในการแก้ไขปัญหา · ความสุภาพ/PPE · ความพร้อมในการเข้าแก้ไขปัญหา · เก็บ `mtn_orders.satisfaction` jsonb (ด้านที่ไม่ประเมิน = ไม่มี key · **ไม่บังคับ ข้ามได้**) · const กลาง `SAT_DIMS`/`SAT_LEVELS` ใน MtnRepair · **แท็บ 📊 KPI** เพิ่มการ์ด "ความพึงพอใจเฉลี่ย %" + แถบรายด้าน (avg/3 · เขียว≥2.5/เหลือง≥2/แดง) นับเฉพาะใบที่ประเมิน · migration `20260722_mtn_satisfaction.sql` (DR additive)
- **⚠️ ฟิลเตอร์สถานะไม่ให้ซ้ำ:** dropdown สถานะ render จาก `STATUS_META` (มี `closed: '✅ ปิด MO'` อยู่แล้ว) + `open`/`all` เท่านั้น — **ห้ามเพิ่ม `<option value="closed">` ซ้ำ** (เคยมี "✅ ปิดแล้ว" ซ้ำกับ "✅ ปิด MO" — ลบแล้ว 2026-07-22)
- **⚠️ ฟิลเตอร์ไลน์ (fLine + แท็บ KPI) กางครอบครัวไลน์ผ่าน `getLineFamilyNames` เสมอ ห้ามเทียบ `o.line_name === fLine` ตรงตัว (แก้ 2026-08-25 · feedback หน้างาน "เลือกแผนก Hydroform/Apron Assy แล้ว MO ไม่ขึ้น"):** dropdown เลือกได้ถึงระดับไลน์แม่ แต่ใบ MO เก็บชื่อ**ไลน์ลูก** (HDF1/SUB APRON/Assy GOR — ข้อมูลจริงยืนยัน) → exact match ทำให้เลือกแม่แล้วใบของลูกหายหมด · fam ว่าง (ชื่อไม่อยู่ในทะเบียนไลน์) = ถอยไปเทียบตรงตัว · เป็นบั๊ก class เดียวกับกฎ "scope ของ leader = ทั้งครอบครัวไลน์"
- **เลข MO auto — แยกต่อทีม (2026-07-24 · คำสั่ง user):** RPC `mtn_assign_mo_no(order_id, prefix)` (SECURITY DEFINER, idempotent) ออกตอน step2 = **`<รหัสทีม>-<ประเภท>-<DDMMYY>-<เลขรันต่อเนื่องต่อทีม>`** เช่น `MTN-BM-250726-0678` · **รหัสทีม** = `mtn_teams.mo_code` (data-driven — maintenance→MTN/jig→JIG/die→DIE/production→PRD · แก้ได้) · **ประเภท** (prefix) = ประเภทงานซ่อม BM/IM/CM/PM/AM/RE · **DDMMYY** = วันออกเลข (เวลาไทย อ่านได้) · **เลขรัน = ต่อเนื่องต่อทีม ไม่รีเซ็ตรายวัน** (ตาราง `mtn_mo_seq` keyed by team_code) — ต่างจากเดิมที่ `mtn_mo_counter` นับรวมทุกทีมต่อวัน (ปนกัน แยกทีมไม่ได้) · migration `20260724_mtn_mo_per_team.sql` (DR · ต้อง apply หลัง `mtn_teams`) · signature เดิม client ไม่ต้องแก้ (RPC อ่าน `mtn_dept` จากใบเอง) · **ตั้งเลขเริ่มต้นต่อทีม (ต่อจากระบบเดิม) + แก้รหัสทีม ที่ ⚙️ ข้อมูลตั้งต้น → 🔢 เลขรัน MO** (ใส่ "เลขล่าสุด" ของแต่ละทีม เช่น 677 → ใบถัดไป 0678) · `mtn_mo_counter` เดิม vestigial · MO เก่ารูปแบบเดิมยังอยู่เป็นประวัติ
- **ตาราง (DR):** `mtn_orders` (แถวเดียวต่อใบ เก็บครบ 7 ขั้น) · `mtn_order_parts` (log เบิกอะไหล่ต่อใบ + หัก stock) · master: `mtn_technicians` `mtn_spare_parts` `mtn_problem_types` (cascade ลักษณะปัญหา→รายละเอียด) `mtn_repair_types` `mtn_item_types` · `mtn_mo_counter` · migration `20260714_mtn_work_order.sql` (seed taxonomy 20 + ช่าง 8 + item/repair types)
- **รูป/ลายเซ็น:** bucket **`mtn-images`** (DR, anon-open, cap 5MB) — รูปก่อน/หลังซ่อม/QA บีบ 1280px q0.85 ก่อนอัปโหลด (helper `resizeImage`) · ลายเซ็นต่อขั้น (step4/5/6/7) วาดใน `SignaturePad` (canvas→PNG) · ลบใบ = ลบไฟล์ที่ผูกทุกอัน (best-effort)
- **KPI (คำนวณสดจาก timestamp ไม่เก็บ):** Response = accept−report · TTR = repair_done−accept · Breakdown = repair_done−report · แท็บ 📊 KPI มีการ์ดเฉลี่ย + พาเรโต้ลักษณะปัญหา Top 10 (กรองช่วงวัน/ไลน์)
> ### 🔴🔴 กฎเหล็ก — "ขั้นไหนใครทำ" อยู่ที่ `src/utils/mtnStepPerm.js` ที่เดียว (2026-09-02 · recheck ตามคำสั่ง user)
> เกณฑ์นี้ถูกใช้ **2 ที่ที่ต้องตรงกันเป๊ะเสมอ** — ตัวซ่อนปุ่มใน `DetailDrawer` (`canEditStep`) กับ
> guard ชั้นสองใน `StepModal.save()` (**RLS ของ `mtn_orders` ฝั่ง DR เป็น anon เปิดหมด → UI คือด่านเดียวจริงๆ**)
> เดิมเขียนซ้ำ 2 ก้อนแล้ว**ต่างกันจริง** (ตัวซ่อนปุ่มมี branch `step===1` ที่ guard ไม่มี) → ยุบมาที่ util
> · `MTN_STEPS` / `canDoStep()` / `stepLabel()` / `stepDenyHint()` / `isOrderReporter()` · เทส 13 เคส
> **ห้ามเอา `STEP_PERM` กลับมาเขียนใน MtnRepair.jsx และห้ามพิมพ์ชื่อขั้นซ้ำในหน้า** (ปุ่ม/หัวโมดัล/StepBox อ่านจาก `stepLabel`/`MTN_STEPS`)
>
> | ขั้น | ใครทำ | คีย์ | seed |
> |---|---|---|---|
> | 1 เปิดใบแจ้งซ่อม | ใครก็ได้ที่พบปัญหา | `report` | ทุก role |
> | 2 รับเรื่อง + จ่ายงาน | **หัวหน้าช่าง** | **`assign`** 🆕 | admin/manager/mtn/dept_admin |
> | 3 ลงมือซ่อม + อัพเดท | ช่างที่รับงาน | `service` | admin/manager/mtn |
> | 2-3 เฉพาะใบทีมตัวเอง | ช่างฝ่ายผลิต | `service_own_team` | + supervisor/leader/engineer |
> | 4 ตรวจรับงานหลังซ่อม | **ผู้เปิดใบ / ฝ่ายที่แจ้ง** | **`accept_work`** 🆕 | admin/manager/supervisor/leader/dept_admin — **ไม่ให้ `mtn`** |
> | 5 ตรวจคุณภาพ | QA | `qa` | admin/manager/qa/dept_admin |
> | 6 รับมอบ + ติดตามผล | **หัวหน้าแผนกผู้แจ้ง** | **`handover`** 🆕 | admin/manager/supervisor/leader/dept_admin |
> | 7 อนุมัติปิดใบ | หัวหน้าแผนก/ส่วน/ผจก. | `approve` | + **supervisor** + dept_admin |
>
> - **🔴 ขั้น 4 เคยเป็น `service` = ทีมช่างตรวจงานตัวเองแล้วเซ็นรับรองเอง** และช่องติ๊ก
>   **"เกี่ยวกับคุณภาพ?" อยู่ในขั้นนี้ ซึ่งเป็นตัวตัดสินว่าจะข้าม QA (ขั้น 5) หรือไม่**
>   ⇒ ช่างเลือกเองว่าจะให้ QA ตรวจไหม · แก้แล้ว: `service_own_team` หดเหลือ **ขั้น 2-3**
> - **🔴 ขั้น 6 เคยเป็น `report` ที่ seed ด้วย `enum_range` = ทุก role** ⇒ sale/planner_store/display
>   กดรับมอบ + ให้คะแนนความพึงพอใจแทนฝ่ายที่แจ้งได้
> - **⭐ ผู้เปิดใบทำขั้น 4 และ 6 ของใบตัวเองได้เสมอ ไม่ต้องรอ admin ติ๊ก role** — `isOrderReporter()`
>   ยึด **`mtn_orders.reported_by_name`** (ระบบ stamp ตอน insert) เป็นหลัก · **`reporter_prod` เป็นช่องที่พิมพ์แก้ได้
>   ใช้เป็น fallback เฉพาะใบเก่าที่ยังไม่มี stamp** (ถ้าเทียบด้วยเสมอ = พิมพ์ชื่อคนอื่นแล้วสวมสิทธิ์ได้)
>   · ช่างที่เปิดใบเองก็ยังตรวจรับใบตัวเองได้ตามปกติ
> - **⭐ deploy-safe: คีย์ใหม่ที่ยังไม่ apply migration = ไม่มีแถว = fail-closed** → `canDoStep` เช็ค
>   `isActionSeeded()` แล้วถอยไปคีย์เดิม (`assign`→`service` · `accept_work`→`service` · `handover`→`report`)
>   **ไม่ถอย = ใบค้างขั้นนั้นทั้งระบบทันทีที่ deploy โค้ดก่อนรัน SQL** · seed แล้วเกณฑ์ใหม่มีผลเอง
> - **`manage_master` = แก้ย้อนหลังได้ทุกขั้น** (ไม่ใช่แค่จัดการช่าง/อะไหล่ตามชื่อ) — label ในทะเบียนเขียนกำกับแล้ว
> - **แยก "หัวหน้าช่าง" จาก "ช่าง" ใช้ flag `is_dept_admin` ห้ามเพิ่ม role** — seed `mtn` ให้ `assign` ไว้ก่อน
>   ไม่ให้ทีมช่างทำงานไม่ได้ตอน deploy · อยากรัดจริงให้ถอด `mtn` ที่ `/permissions` แล้วติ๊กแอดมินหน่วยงานที่ `/add-user`
> - **bucket `dept_admin` ไม่ติดกับดัก `enum_range` ในโมดูลนี้** — `20260803_dept_admin.sql` ก๊อปทุก action ที่ manager ถือให้ bucket ตอนสร้าง จึงได้ `mtn_repair:*` ชุดเดิมครบตั้งแต่ตอนนั้น (ตรวจกับฐานจริง 2026-09-02) · **กับดัก `enum_range` ยังใช้กับ role ธรรมดาที่เพิ่มทีหลังเสมอ — แต่ bucket ตัวนี้มีตัวก๊อปให้แล้ว อย่าเหมาว่าขาด**
> - **ยังไม่ทำ:** ยังไม่ผูก "ฝ่ายที่แจ้ง" กับ scope จริง — manager/supervisor คนไหนก็ได้ทั้งโรงงานยังปิดใบของฝ่ายอื่นได้
>   (จะทำต้องเทียบ section ของ `line_name` บนใบ กับ `sections` ของผู้ใช้ — เป็นการรัดที่ล็อกคนออกได้ ต้องให้ user เคาะก่อน)
> - migration `20260902_mtn_step_ownership.sql` (Main)

- **⏭ ข้าม QA (ขั้น 5 → 6) เมื่องานไม่เกี่ยวกับคุณภาพ (2026-09-03 · คำสั่ง user "สเต็ป 5 ต้องให้ QA อนุมัติ ถ้าเรื่องไม่เกี่ยวกับ QA ต้องกดข้ามไปสเต็ป 6 ได้ ตอนนี้ไม่ได้"):**
  ขั้น 4 เลือก "เกี่ยวกับคุณภาพ" → ใบไปค้างรอ QA และ**ไม่มีใครเลื่อนต่อได้นอกจาก QA** (ตรวจฐาน 2026-09-03: ค้าง 26 ใบ ทีม PRODUCTION ทั้งหมด นานสุด 9 วัน — ส่วนใหญ่เป็น PM/BM เครื่อง STATIONARY/ROBOT ที่หัวหน้าไลน์ติ๊ก "เกี่ยวกับคุณภาพ" ไว้)
  - **โมเดล: การข้าม = แก้การตัดสินใจของขั้น 4 ไม่ใช่ขั้นใหม่** — `status` คง `checked` · `quality_related` → `ไม่เกี่ยวกับคุณภาพ` · บันทึก `qa_skip_reason` (บังคับ) / `qa_skipped_by` / `qa_skipped_at` → `nextStepFor` พาไปขั้น 6 เอง · **ไม่เพิ่ม status ใหม่** (KPI/Andon/ใบพิมพ์/edge เดิมไม่ต้องรู้จักค่าใหม่) · ไม่เซ็น (ไม่ใช่การรับรองคุณภาพ)
  - **ใครข้ามได้ = `canSkipQa()` ใน `mtnStepPerm.js`** (source of truth เดียวกับปุ่มและ guard ตอนบันทึก): คนที่ทำขั้น 4 ได้ (ผู้เปิดใบ / `accept_work` / `manage_master`) **หรือ** QA (`qa`) — QA เห็นว่าไม่ใช่งานตัวเองก็ปล่อยผ่านได้โดยไม่ต้องเซ็นรับรองสิ่งที่ไม่ได้ตรวจ · **ช่างที่ซ่อม (`service`) ข้ามไม่ได้** เหตุผลเดียวกับที่ช่างตรวจรับงานตัวเองไม่ได้ · ใบที่ไม่ได้ค้างรอ QA (`isWaitingQa`=false) ข้ามไม่ได้แม้เป็น manage_master
  - UI: ปุ่ม "⏭ ไม่เกี่ยวกับคุณภาพ — ข้าม QA ไปขั้น 6" (สีเหลือง) ข้างปุ่มขั้นถัดไปใน DetailDrawer · StepModal โหมด `skipQa` (state `stepModal.skipQa` — ไม่ใช่ step ใหม่) กรอกเหตุผล · StepBox 5 โชว์กล่อง "⏭ ข้ามการตรวจ QA + เหตุผล/คน/เวลา" · กล่อง 🔒 บอกทางข้ามให้คนที่กดไม่ได้ (§6.9) · ใบพิมพ์ FM-JIG-008 ช่อง 5 พิมพ์ "ไม่เกี่ยวกับคุณภาพ (ข้ามการตรวจ QA)" + เหตุผล
  - แจ้งเตือน event **`mtn_qa_skipped`** (edge `send-mtn-notification` · ขั้นต่อไป: รอรับมอบ) · rule ก๊อปห้อง/role จาก `mtn_checked` · edge ที่ยังไม่ deploy ตอบ 400 unknown event → client กลืนเงียบตาม pattern เดิมของ `notifyMtn` (ใบยังเดินต่อ แค่ไม่มีข้อความ)
  - **deploy-safe:** ยังไม่ apply migration DR → update ได้ 42703 → client ถอยไปบันทึกแค่ `quality_related` + toast แดงบอกให้รัน migration (ใบเดินต่อได้ แต่เหตุผลไม่ถูกเก็บ — ไม่เงียบ)
  - migrations: `20260903_mtn_qa_skip.sql` (DR — 3 คอลัมน์ additive) + `20260903_mtn_qa_skipped_notification_rule.sql` (Main — แถว notification_rules) · เทส `mtnStepPerm.test.mjs` +6 เคส
  - ⚠️ ระหว่างตรวจพบ `notification_rules.channel_ids` ของ `mtn_checked`/`mtn_qa` **ว่างในฐานจริง** ทั้งที่ migration `20260825_mtn_events_route_to_mtn_room.sql` ควรผูกห้องให้แล้ว → ข้อความขั้น 4-5 ตกห้อง fallback ของบอท · ตรวจซ้ำ 2026-09-07: **ทุก event หมวด maintenance ยกเว้น mtn_reported ว่างหมด** (0825 ไม่เคยถูกรัน) → migration `20260907_mtn_rules_smart_maintenance_room.sql` ผูกห้อง 🔧 Smart Maintenance (ห้องเดียวกับ pm_*) ให้แถวที่ว่าง · ย้ายห้องได้ที่ /notification-config
- **สิทธิ์ (role_permissions):** `page:/mtn-repair`+`mtn_repair:report` = ทุก role · ที่เหลือดูตารางในกฎเหล็กด้านบน · ปุ่ม action แต่ละขั้นเช็คผ่าน `canDoStep()` (ไม่ hardcode role array)
- **เชื่อมกับ Downtime:** ปุ่ม "📝 เปิดใบซ่อม" ในแถว Downtime (DailyReport) → สร้าง `mtn_orders` prefill (ไลน์/เครื่อง/อาการจาก dt type) `status=pending`, `source_downtime_id` ผูกที่มา (กันเปิดซ้ำ) แล้ว MTN ไปรับงานต่อที่ `/mtn-repair`
- **หลายทีมซ่อม (2026-07-14):** ครอบคลุม **PRODUCTION(Autonomous) / JIG MTN / DIE MTN / MTN** — `mtn_technicians.dept` (ทีมของช่าง, master แยกกลุ่มตามทีม) + `mtn_orders.mtn_dept` ("แจ้งถึงหน่วยงาน" auto จากชนิดอุปกรณ์: JIG→JIG MTN, DIE→DIE MTN, อื่น→MTN แก้ได้) · ฟิลเตอร์รายการตามหน่วยงาน · migration `20260714_mtn_multi_team.sql`
- **แจกงานให้ถูกทีม 4 ส่วน (2026-07-16 — คำสั่ง user):** ทำ 3 อย่างพร้อมกัน จับคู่ทีมของ user ผ่าน `teamsForUser(mtnTeams, sections)` (util `src/utils/mtnTeams.js`):
  - **ทีมมาจาก `profiles.mtn_teams` ที่ตั้งใน `/add-user` โดยตรง (2026-07-22)** — ช่อง "🔧 ทีมช่างซ่อม" (multi-select JIG MTN/DIE MTN/MTN/PRODUCTION) โผล่เฉพาะ role งานซ่อม (`MTN_TEAM_ROLES` = mtn/engineer/leader/supervisor) · **แยกจาก Section ไม่กระทบ scope ข้อมูลผลิต** · ช่างฝ่ายผลิต first-response เลือก `PRODUCTION` + PD ของตัวเองได้ · เขียน best-effort หลัง create/update (edge `create-user` ยังไม่รู้จัก field นี้) · UserContext expose `mtnTeams` (โหลด best-effort เหมือน avatar_url กัน login พังถ้ายังไม่ apply migration)
  - **fallback (backward-compat):** ไม่ได้ตั้ง `mtn_teams` → `teamsForUser` เดา JIG/DIE/MTN จาก **section string** เหมือนเดิม (`teamForSection`) · PRODUCTION ไม่เดาจาก section (section ฝ่ายผลิตมีหลายชื่อ) — ต้องตั้ง mtn_teams เอง
  1. **บังคับเลือกทีมตอนแจ้ง** — ReportModal ฟิลด์ "แจ้งถึงทีมช่าง" (required, default = ทีมของผู้แจ้ง) · **เปิดใบจาก Downtime มี picker เลือกทีม** (DailyReport `openMoPicker` → modal 4 ปุ่ม, เดา default จากชื่อเครื่อง) แทน hardcode 'MTN' เดิม
  2. **คิวงานแยกทีม** — MtnRepair default ฟิลเตอร์หน่วยงาน = ทีมของ user (สังกัดทีมเดียว, ไม่ใช่ admin) เปิดมาเห็นคิวทีมตัวเองก่อน ปรับเป็น "ทุกหน่วยงาน" ได้
  3. **แจ้งเตือน Telegram แยกห้องต่อทีม** — `telegram_channels.team` (migration `20260716_telegram_channels_team.sql` Main) แท็กห้องเป็นของทีมไหน · edge `send-mtn-notification` v4: มีห้องของทีมตาม `mtn_dept` → ส่งเข้าห้องทีม, ไม่มี → route เดิม (ห้องรวม/fallback) · ตั้งทีมของห้องได้ที่ `/notification-config` (dropdown ต่อห้อง) · **backward-compatible: ห้อง team=NULL = ห้องรวมพฤติกรรมเดิม**
- **Cost Center auto:** ดึงจาก `production_lines.cost_center` ตามไลน์ที่เลือก (fallback ไลน์แม่ถ้า sub-line ไม่มี) แก้ทับได้
- **วันที่ (want_at/target_done_at) เป็น date-only:** input `type=date` (**ปฏิทิน ค.ศ.**) + echo "= DD/MM/พ.ศ." ใต้ช่องกันสับสน ปี · เก็บ/แสดงเฉพาะวันที่ ไม่มีเวลา
- **ลายเซ็นใช้ซ้ำจากโปรไฟล์ (2026-07-14):** `SignField` default = ใช้ `profiles.signature_url` ของ user (ไม่สร้างไฟล์ใหม่ทุกครั้ง) · กด "เซ็นใหม่" เพื่อวาดเฉพาะกิจ (ค่อยอัปโหลด) — ลดไฟล์รูปสะสมมาก (เดิมเซ็น 4 ครั้ง/ใบ = 4 ไฟล์)
- **แก้ไขหลังบันทึก:** DetailBox แต่ละสเตปมีปุ่ม ✏️ แก้ไข (StepModal `editMode` — อัพเดทเฉพาะฟิลด์ ไม่เลื่อนสถานะ/ไม่แจ้งซ้ำ) · สิทธิ์: `manage_master` (หัวหน้า) หรือผู้มีสิทธิ์ทำสเตปนั้น (ผู้กรอกแก้ของตัวเองได้)
- **🔎 ช่องเลือกอะไหล่ในขั้นซ่อม (Step 3) ต้องค้นได้ (2026-08-24 · feedback หน้างาน "อะไหล่เป็น 1000 หาไม่เจอ"):** ใช้ **`src/components/SearchSelect.jsx`** (ค้นชื่อ/รหัส/ชั้นวาง/mat_no/part_no · โชว์สต็อก+ชั้นวางในลิสต์ · อะไหล่ทีมของใบขึ้นก่อนแต่**ไม่ตัดทีมอื่นทิ้ง**) — เดิมเป็น `<select>` ยัดทุกแถว + ช่อง "หรือพิมพ์ชื่อ" ซ้อนข้างๆ ที่พอเลือกแล้วแค่สะท้อนชื่อเดิม · **รวมเป็นช่องเดียว**: เลือกจากทะเบียน = ผูก `part_id` หักสต็อกให้ · พิมพ์เองไม่ตรงลิสต์ = เก็บแค่ชื่อ (`part_id` null ไม่หักสต็อก) + ป้าย "✎ ไม่ได้อยู่ในทะเบียน" · เบิกเกินสต็อกขึ้นเตือนก่อนกดบันทึก (RPC กันติดลบอยู่แล้ว แต่บอกก่อนจะได้ไม่เสียเที่ยว) · กติกาเต็ม `docs/UI-CONVENTIONS.md` §5.1.1
- **⚠️ โหลดทะเบียนอะไหล่ต้องแบ่งหน้า** — `mtn_spare_parts` โตเกิน 1000 แถวได้ · `select('*')` เฉยๆ ได้แค่ 1000 แถวแรก **ของที่เกินหายจากทั้งลิสต์เลือกและหน้าคลังเงียบๆ** (กฎเดียวกับ `role_permissions`) → ผ่าน `fetchAllRows()` ใน `MtnRepair.jsx` (order คงที่ปิดท้ายด้วย `id` ไม่งั้นแถวหลุด/ซ้ำระหว่างหน้า)
- **Spare part + stock control:** master `mtn_spare_parts` (code/name/unit/stock_qty/min_qty) + ledger `mtn_stock_txns` (in/adjust/consume) · แท็บอะไหล่: ➕รับเข้า / ปรับยอด (log ledger) + แถบแดงเมื่อ ≤ min · ขั้นซ่อมเบิกอะไหล่ = หัก stock + log consume อัตโนมัติ · migration `20260714_mtn_stock_txns.sql`
- **ค่าแรงซ่อมมาตรฐาน + ค่าใช้จ่ายต่อใบ (2026-07-22 · คำสั่ง user):** master `mtn_labor_rates` (name/unit/price/dept) — แท็บ ⚙️ ข้อมูลตั้งต้น → 💰 ค่าแรงมาตรฐาน (ช่างกรอกราคามาตรฐานไว้เลือกใช้) · ขั้นซ่อม (step 3) มีช่อง **(1) ค่าแรงซ่อม** (เลือกจากราคามาตรฐาน หรือพิมพ์เอง) + **(2) ค่าอะไหล่/อุปกรณ์** → เก็บ `mtn_orders.labor_cost`/`parts_cost` (numeric) · พิมพ์ลงฟอร์ม **FM-MTN-006** ช่อง (1)/(2)/รวม อัตโนมัติ · migration `20260722_mtn_labor_cost.sql` (DR additive)
- **แจ้งเตือน Telegram — ครบทุกสเตป (คำสั่ง user 2026-07-14):** edge function `send-mtn-notification` events `mtn_reported`(1,+รูปก่อน)/`mtn_assigned`(2)/`mtn_repaired`(3,+รูปหลัง)/`mtn_checked`(4)/`mtn_qa`(5,+รูป QA)/`mtn_handover`(6)/`mtn_closed`(7) · format mirror ระบบเดิม + หน่วยงานในหัวข้อ · วันที่ พ.ศ. · route ผ่าน notification_rules category maintenance (ตั้งค่า/ปิด/แก้ข้อความที่ `/notification-config`)
  - **ไหลตามสเตป (v5, 2026-07-22 — คำสั่ง user):** step1 แจ้งเข้าห้องทีมที่เกี่ยวข้อง (ห้องรวม smart maintenance วันนี้ · อนาคตแยกห้อง MTN/JIG MTN/DIE MTN/PRODUCTION ผ่าน `telegram_channels.team`) · ทุกสเตปต่อท้ายบรรทัด **"⏳ ขั้นต่อไป: รอ…"** (map `NEXT`) ให้ห้องแชทเดิมรู้ว่ารออะไรต่อ (รับงาน→รอซ่อม→รอตรวจ→รอคุณภาพ/รับมอบ→รออนุมัติปิด) จนจบ step7 แจ้งปิดงาน
  - **สรุปงานค้างทุกเช้า 09:00 (2026-07-22):** edge `mtn-daily-summary` (Main pg_cron 02:00 UTC) รวมใบที่ยังไม่ปิดนับตามทีม+ขั้นที่ค้าง ส่งภาพรวมห้องรวม + แยกรายทีมเข้าห้องทีม (event `mtn_daily_summary` · ปิด/แก้ห้องที่ `/notification-config`)
- **พิมพ์ใบ MO / บันทึก PDF — เลือกฟอร์มตามทีมช่าง (2026-07-22 · คำสั่ง user "ฟอร์ม maintenance กับ jig/die ไม่เหมือนกัน"):** ปุ่ม 🖨️ ใน DetailDrawer → `printMoReport(o, dparts)` **แยก layout ตาม `mtn_dept`**:
  - **JIG MTN / DIE MTN / PRODUCTION → FM-JIG-008** (`printMoReport` เดิม): โลโก้ TS + หัว 3 คอลัมน์ + ส่วน 1 ผู้แจ้ง | 2 รับงาน + 3 ซ่อม + BEFORE/AFTER + 4&5 คุณภาพ | 6 รับมอบ + ตารางอนุมัติ 4 ช่อง (JIG/MTN·QA·PD·MGR) + footer FM-JIG-008-REV.00 (doc_key `mo_report`)
  - **MTN เท่านั้น → FM-MTN-006** (`printMoReportMtn` ใหม่ · คำสั่ง user: อีก 3 แผนกใช้ฟอร์มเดิม): layout ตามใบ M/O กระดาษ — หัว M/O + ส่วนผู้แจ้ง/checkbox รอ-ดำเนินการ/ประเภทงาน(ซ่อม/ปรับปรุง) + ดำเนินงานซ่อมบำรุง + BEFORE/AFTER + ตารางอะไหล่ 5 แถว + ค่าใช้จ่าย (1)+(2) + **ตารางประเมินความพึงพอใจ 5 ข้อ × เฉยๆ/พอใจ/พอใจมาก (ติ๊กจาก `o.satisfaction`)** + ลายเซ็น ผู้ตรวจสอบและรับรอง/ผู้อนุมัติ + footer FM-MTN-006 (doc_key `mo_report_mtn` · fallback ในโค้ด — migration `20260722_doc_form_mo_mtn.sql` ทำให้แก้ที่ `/doc-forms` ได้)
  - เพิ่มทีม/ฟอร์มใหม่ → เพิ่ม branch ใน `printMoReport` + register doc_key ใน doc_forms · เซฟ PDF จาก dialog พิมพ์เบราว์เซอร์
- **Scope:** leader = family ไลน์ตัวเอง (branch มาก่อน) · role อื่นตาม `sections` — pattern มาตรฐาน
- **ข้อมูลเก่า 677 ใบจาก Google Sheet ยังไม่ย้าย** (user เลือก "ย้ายทีหลัง") — ระบบเริ่มนับ MO ใหม่จาก 0

---
