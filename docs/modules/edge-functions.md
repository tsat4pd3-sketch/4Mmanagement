# Edge Functions

> ย้ายมาจาก `CLAUDE.md` (2026-09-03 — แยกไฟล์เพื่อลด context) · โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน


### `send-notification`
- **Endpoint:** `POST /functions/v1/send-notification`
- **Payload:** `{ event: "status_change", log: { ...four_m_log } }`
- **Events อื่น:** `checkin_summary`, `checkin_update`, `ot_booking`, `prod_close`, `downtime`, `downtime_recovered`, `downtime_call_mtn`, `downtime_open_15min`, `morning_meeting`
  - ⚠️ **หมวดเช็คชื่อแยกเป็น 3 event (2026-07-21 — คำสั่ง user: หัวหน้าแผนกงงว่าทำไมเช็คชื่อซ้ำ):** ปุ่ม "บันทึก" ตัวเดียวในหน้า Checkin ทำ 3 อย่าง (เช็คชื่อ / แก้กำลังคน / จองรถ OT) เดิมยิง `checkin_summary` **ทุกครั้ง** — พอหัวหน้ากลุ่มมาลงจอง OT กะดึกระหว่างวันแล้วกดบันทึก จะเด้ง "เช็คชื่อเสร็จแล้ว" ซ้ำ หัวหน้าแผนกเลยงง · แก้: `Checkin.jsx handleSave` เก็บ `baseline` ตอนโหลด แล้วเทียบตอนบันทึก → เลือก event ตามสิ่งที่เปลี่ยนจริง:
    - `checkin_summary` — บันทึกครั้งแรกของวัน (ยังไม่มี log ของคนที่แสดงอยู่) = เช็คชื่อเริ่มงาน (payload เดิม `{ event, summary }`)
    - `checkin_update` — เคยเช็คชื่อแล้ว + ข้อมูลเข้างาน/ลา/PPE เปลี่ยน = อัพเดทกำลังคน (payload `{ event, summary: {...+changed_count, changed_names} }` — ลิสต์คนที่เปลี่ยน)
    - `ot_booking` — สถานะจอง OT/งาน/ช่วงเวลาเปลี่ยน = จองรถ OT (payload `{ event, booking: {line_name, work_date, date_label, shift_label, count, items, booked_by} }` — items = รายชื่อ+งาน+เวลาต่อคนของวันจองหลัก · กะดึกจองคืนถัดไป กะเช้าจองวันนี้)
    - ไม่เปลี่ยนอะไร (re-save เฉยๆ) = **เงียบ ไม่ยิงอะไร** · ทั้ง 3 event category `manpower` ปรับห้อง/ปิด/แก้ข้อความได้ที่ `/notification-config` (migration `20260721_checkin_notification_split.sql` seed default เข้าห้องเดียวกับ checkin_summary) · **ต้อง deploy edge function `send-notification` ให้รู้จัก 2 event ใหม่** (ก่อน deploy: 2 event ใหม่ได้ 400 เงียบๆ ฝั่ง client fire-and-forget — bug ซ้ำหายทันทีจากฝั่ง frontend, แค่ยังไม่มีข้อความ update/OT)
  - `morning_meeting` — สรุปประชุมแถวเช้าจากหน้า `/morning-meeting` (payload `{ event, summary: {...} }` — ผลิตรวม/เป้า, OEE, DT, NG, งานหลุดแผน, action ค้าง) · rule/template แก้ได้จากหน้าตั้งค่าการแจ้งเตือน (deploy v30 2026-07-13)
  - ⚠️ **Downtime notification overhaul (2026-07-14) — ลดสัญญาณรบกวน + เรียกช่างแบบตั้งใจ** (คำสั่ง user: แจ้งเยอะเกิน เบรคดาวน์เล็กน้อยก็แจ้ง + พนักงานลงย้อนหลังไม่ได้ตั้งใจเรียกช่าง):
    - **บันทึก Downtime ใหม่ = ไม่แจ้ง Telegram ทันทีอีกต่อไป** (ทั้งปิดแล้วและเปิดค้าง) — ตัด `notifyDowntime` ตอน insert ใน `DailyReport.jsx handleAddDT`
    - **ปิดรายการย้อนหลัง (ลงแล้วปิดเลย)** → เงียบ ไปสรุปตอนปิดกะแทน (`prod_close` มี downtimes[]/dt_total_min ครบอยู่แล้ว)
    - **เปิดค้าง (ไม่ปิดรายการ)** → `downtime-open-scan` (DR pg_cron ทุก 5 นาที) แจ้ง `downtime_open_15min` เมื่อ `started_at` เกิน `dt_alert_config.open_alert_min` นาที (config ได้จากหน้า `/notification-config`, default 15) แล้ว stamp `open_alerted_at` กันซ้ำ → เตือน**เสียงหน้า Production** (Dashboard/Management)
    - **ปุ่ม "📞 เรียกช่าง" ในแถว Downtime (DailyReport)** → `downtime_call_mtn` แจ้งทันที (set `call_mtn=true, call_mtn_at, call_mtn_by`) → เตือน**เสียงหน้า Maintenance** (MtnMachineLayout)
    - **เสียงบนเว็บ:** `src/components/DowntimeSiren.jsx` (mode `call_mtn` / `open_15min`) — Web Audio วนจนกด "รับทราบ" (set `call_mtn_ack_at` / `open_ack_at`) · scope เสียงแยกหน้าตามคำสั่ง user (เรียกช่างดังหน้า MTN, เปิดค้างดังหน้า Production)
> ### 🔴🔴 กฎเหล็ก — "หยุดเกินเกณฑ์" ตัดสินจาก **เวลาที่ผ่านไปจริง** ห้ามใช้ธง `open_alerted_at` (2026-08-26 · user ทัก "alarm เสียงก็ไม่มี")
> **`open_alerted_at` = ตัวกันแจ้ง Telegram ซ้ำ ไม่ใช่สถานะ alarm** — edge `downtime-open-scan` stamp ให้ **ก็ต่อเมื่อ POST หา `send-notification` สำเร็จ** (`if (res && res.ok)`)
> ⇒ Telegram ล่ม / ปิด rule / ไม่มีห้อง = **ธงไม่ถูกตั้งตลอดกาล** → ไซเรนบนจอ (`.not('open_alerted_at','is',null)`) **ไม่เคยดังเลย** และจอห้องช่างอ่านเครื่องที่หยุดมา **3 ชม. 14 น. ว่า "⏱️ เพิ่งหยุด"** (เคสจริง Assy LWR 26/08)
> — การแจ้งเตือนภายนอกล้มเหลว **ห้ามลากให้ alarm บนจอตายตามไปด้วย**
> - **ตัวตัดสินอยู่ที่ `src/utils/downtimeRules.js` (pure) จุดเดียว: `isOverDtThreshold(d, thrMin)` + `fmtDtElapsed(m)` + `DT_OPEN_ALERT_MIN_DEFAULT`** · เกณฑ์นาทีโหลดผ่าน **`loadDtAlertMin()`** (`downtimeAlarm.js` · cache ระดับ module · โหลดไม่ได้ = 15 **ห้ามคืน null แล้วเงียบ**)
> - **`open_15min` ต้องกรอง planned เองด้วย** — เดิมพึ่งว่า scanner stamp เฉพาะนอกแผน พอเลิกใช้ธงแล้วต้องเช็ค `isAlarmingDT` เอง ไม่งั้น "นับสต๊อก 349 นาที" กลับมาส่งเสียงทั้งวัน (เคสเดิม 2026-08-04)
> - **ไซเรนคำนวณใหม่ทุกนาทีจากข้อมูลที่โหลดมาแล้ว (ไม่ยิง DB)** — ไม่งั้นรายการที่ครบเกณฑ์ระหว่างเปิดจอต้องรอรอบ poll ถัดไป (RATE.BACKUP = 15 นาที)
> - **จอ TV ที่ไม่มีใครแตะ = เบราว์เซอร์บล็อกเสียง** → แถบไซเรนขึ้น "🔇 แตะเพื่อเปิดเสียง" **ห้ามเงียบ** (เดิมเห็นแถบแต่ไม่มีเสียงแล้วไม่มีอะไรอธิบาย)
> - **"หยุดมาแล้วกี่นาที" ต้องเป็นเลขเดียวกันทุกจอ** — ผังรวมเคยโชว์ `dtMinHour` (นาทีที่เสียใน *ชั่วโมงนี้*) ใต้คำว่า "🔴 หยุด 52 น." ขณะที่ Dashboard/จอห้องช่างบอก 194 นาที ⇒ **จอเดียวกันตอบคนละเลข** · ตอนนี้ `lineStatus.dtOpenMin` = elapsed ของรายการที่ยังเปิดค้าง (นานสุดในไลน์) ใช้ทุกป้าย · `dtMinHour` เหลือไว้คิด **สี** ของแท็บ Downtime เท่านั้น · ไม่รู้เวลาเริ่ม = `dtOpenUnknown` → `—` **ห้ามตีเป็น 0**
> - เทสล็อกไว้แล้ว `src/utils/__tests__/downtimeRules.test.mjs` (8 เคส · รวมเคส "Telegram ล่มแต่ต้องยังเตือน" และ "planned ห้ามส่งเสียง")
    - `downtime_recovered` ยิงเฉพาะตอนปิดรายการที่**เคยถูกแจ้ง**แล้ว (`open_alerted_at` หรือ `call_mtn`) — ปิดรายการที่ไม่เคยดังก็เงียบ ไม่รก
    - schema: `20260714_downtime_alert_v2.sql` (DR: คอลัมน์ open_alerted_at/open_ack_at/call_mtn*/ + ตาราง `dt_alert_config`) · cron: `20260714_downtime_open_scan_cron.sql` (DR) · rules: `20260714_downtime_notification_rules.sql` (Main)
  - `downtime` — event เดิม (payload `{ event: "downtime", downtime: {...} }`) ยังมีอยู่แต่**เลิกยิงจาก DailyReport แล้ว** (เก็บไว้เผื่อ manual/backward compat) — คู่กับ alarm กระพริบแดงที่จุดเครื่องจักรบน Dashboard/Management (helper: `src/utils/downtimeAlarm.js` — alarm เฉพาะเมื่อ downtime ยังไม่ปิดรายการ ปิดรายการแล้วดับทันที)
  - **⚠️ หยุดตามแผน (`category='planned'`) ห้าม Andon แดง / ห้ามยิงแจ้งเตือน (2026-08-04 · คำสั่ง user):** นับสต๊อก / ไม่มีแผนผลิต / 5ส ไม่ใช่ความเสียหาย ไม่มีอะไรให้ "ดำเนินการทันที" — เคสจริง: SP-88 "นับสต๊อก/ไม่มีแผนผลิต" ค้าง 349 นาที เด้ง ANDON RED + ไซเรน + Telegram ทั้งวัน · แก้ 2 ชั้น: (1) client `isAlarmingDT = isOpenDT && !isPlannedDT` (แก้ที่ util จุดเดียว มีผลทั้ง Dashboard/Management/DeptHub) (2) edge `downtime-open-scan` กรอง `category !== 'planned'` ก่อนยิง `downtime_open_15min` — **ต้อง deploy edge ใหม่** (ก่อน deploy: จอไม่แดงแล้ว แต่ Telegram/ไซเรนยังดังจาก planned)
  - **แต่ห้ามซ่อนหาย:** `fetchActiveDowntimes` คืน `plannedList`/`plannedByLine` แยกออกมา · แผง Andon (Dashboard) โชว์บล็อก "🗓️ หยุดตามแผน · N รายการ (ไม่นับเป็น Andon)" สีเทาสงบ ไม่กระพริบ
  - **แผง Andon ครอบทั้ง downtime + quality (2026-08-04 · คำสั่ง user):** เพิ่มบล็อก "🚫 คุณภาพ (Quality) · ของเสียวันนี้ N ชิ้น" แยกตามประเภท + 💬 หมายเหตุพนักงาน (`qualityByLine` จาก `defect_logs` ที่ join `dr_defect_types`) · **ระดับไฟ (แดง/เหลือง/เขียว) ยังตัดสินจาก downtime ค้าง + 4M ค้างเท่านั้น** — ของเสียแสดงเป็นข้อมูลประกอบ (ถ้าจะให้ NG ยกระดับไฟ ต้องมีเกณฑ์ก่อน)
  - **Person alarm (ไม่เกี่ยว Telegram):** marker คนบนผัง Dashboard/Management กระพริบด้วย helper `src/utils/personAlarm.js` — แดง = เช็คชื่อแล้วแต่ PPE ไม่ครบ (Management แสดงเป็นแถบเตือนเหนือผัง เพราะคน PPE ไม่ครบไม่เข้า pool), เหลือง = ย้ายจุด/ข้ามไลน์แล้ว 4M Man ยังรออนุมัติ (จับคู่คน↔log ด้วยชื่อใน description เพราะ four_m_logs ไม่มี employee_id)
  - `downtime_recovered` — แจ้งเมื่อรายการ Downtime ที่เปิดค้าง (ไม่มีเวลาจบ/ระยะเวลา) ถูกแก้ไขจนปิดรายการ = เครื่องกลับมารันได้ (เฉพาะเคสนี้ การแก้ไขทั่วไปไม่แจ้งซ้ำ)
  - `prod_close` — รองรับ field เสริม (start_time/end_time/shift_min, total_qty, qty_repair, oee_a/p/q, parts[], downtimes[], dt_count, dt_total_min, dt_carry[]) — ข้อความ Telegram จะสรุปครบเหมือนหน้าปิดกะ ทุก field optional เพื่อ backward compat
  - **Downtime ตัดยอดข้ามกะ:** ถ้าเครื่องยังซ่อมไม่เสร็จตอนปิดกะ เลือก "ยังซ่อมอยู่ — ตัดยอดข้ามกะ" ใน modal ปิดกะ → รายการกะนี้ถูกปิดด้วยเวลาปิดกะ (`downtime_logs.carry_over = true`) และเมื่อเปิดกะถัดไปของไลน์เดียวกัน ระบบสร้างรายการต่อเนื่องให้อัตโนมัติ (`carried_from_id` ชี้รายการเดิม) — OEE ถูกต้องทั้งสองกะ, alarm กระพริบต่อเนื่อง, แจ้ง "เครื่องกลับมารันได้" เฉพาะตอนปิดรายการจริง (migration: `20260709_downtime_carry_over.sql`)
- **Secrets ที่ต้องตั้งใน Supabase:**
  - `TELEGRAM_BOT_TOKEN` — จาก @BotFather
  - `TELEGRAM_CHAT_ID` — Group Chat ID (เลขติดลบ เช่น `-5279077923`)

### Functions อื่นๆ ที่ deploy อยู่ (สรุปย่อ — เพิ่มเอกสาร 2026-07-10)

| Function | Project | ทำอะไร |
|---|---|---|
| `daily-4m-summary` | Main | สรุป 4M รายวันส่ง Telegram — default = **work date เมื่อวาน** (ตัด 08:00 ตามกฎ getWorkDate ไม่ใช่วันปฏิทิน — แก้ 2026-07-12 v3) |
| `send-cqi15-notification` | Main | แจ้งเตือน CQI-15 Event Log + approval แยกจาก send-notification |
| `pm-daily-scan` | DR (pg_cron) | สแกน Daily PM alarm สีส้ม (เช็คไม่เสร็จตามเวลา) — เขียว/แดง event-driven จากแอป |
| `pm-plan-reminder` | DR (pg_cron รายวัน 01:00 UTC = 08:00 ไทย) | เตือน Planned PM ตามขั้น 30/14/3 วัน + **เกินกำหนด (ซ้ำสัปดาห์ละครั้ง)** → POST ไป send-notification ฝั่ง Main · ดูกฎ "เตือน PM" ด้านล่าง |
| `shipping-phase-scan` | DR (pg_cron ทุก 10 นาที) | สแกน shipping walkback phase misses บนกรอบวันงาน 08:00→08:00 · **v3 (2026-08-24): เตือนเฟสกลางเฉพาะเมื่อทีมใช้ walkback จริง** — ดูกฎด้านล่าง |
| `qa-fme-scan` | Main (pg_cron ทุก 5 นาที · **cron active**) | **ผลิตเรียก QA มาตรวจ FME** — อ่าน `production_sessions`/`prod_orders`/`dr_products` จาก DR (`DR_URL`/`DR_ANON_KEY`) หา "รุ่นที่เพิ่งขึ้นไลน์/เพิ่งจบ" → สร้าง `qa_fme_obligations` + ยิง `qa_fme_call`/`qa_fme_overdue` + sync สถานะจาก `qa_inspection_sheets` · **เช็ค `qa_fme_config.is_enabled` ก่อนทำอะไรทั้งสิ้น (default false = เงียบสนิท)** · **deploy v14 + cron `*/5` เดินอยู่ แต่สวิตช์ยังปิด** (ตรวจ 2026-09-02) · **แจ้ง Telegram รวมเป็นข้อความเดียวต่อรอบสแกน ห้ามวนส่งรายรายการ** (แก้ + deploy v14 แล้ว 2026-09-02 · diff ซอร์สที่รันอยู่กับรีโปแล้วตรงกัน) |
| `store-daily-scan` | DR (pg_cron 00:50 UTC = **07:50 ไทย** — ดูกฎ "เวลาสแกนต้องอยู่ในวันงานที่จะรายงาน") | **เฝ้าระวังสโตร์รายวัน** (2026-08-21) — อ่านวิว **`v_store_abnormal`** (เงื่อนไข 5 เคสอยู่ในวิวที่เดียว หน้า `/store-monitor` อ่านตัวเดียวกัน **ห้าม copy เงื่อนไขมาเขียนซ้ำ**) → จัดกลุ่มตามเคส → POST `store_abnormal` ไป `send-store-notification` · **ยิงวันละครั้ง ไม่ใช่ทุก 10 นาที** (บทเรียนจาก `shipping_phase_alert` ที่ยิง 592 ครั้งใน 4 วันจนไม่มีใครอ่าน) · verify_jwt=false |
| `send-store-notification` | Main | **ผู้ส่งฝั่ง Store** — รับ event `store_abnormal` · **แยกไฟล์จาก send-notification โดยตั้งใจ (กันไฟล์ 47KB พัง) แต่ route ผ่าน `notification_rules`/`telegram_channels` ชุดเดียวกัน** (precedent เดียวกับ `send-mtn-notification`) → เปิด/ปิด/เลือกห้อง/แก้ข้อความ/เลือก role ที่เข้ากระดิ่ง ทำที่ `/notification-config` เหมือนทุกเรื่อง · verify_jwt=false |
| `send-event-notification` | Main | **ผู้ส่งกลาง generic (2026-08-25)** — รับ `{ event, lines[], title?, section?, line_name?, ref_table?, ref_id?, vars? }` แล้วส่งทั้ง **Telegram + ในแอป** จากแถว `notification_rules` เดียวกัน · resolve ส่วนงานจาก `line_name` เอง (ไลน์ลูกตกทอดจากไลน์แม่) · ผู้รับผ่าน RPC `notify_recipients` · **เพิ่มเรื่องใหม่ = insert แถว rule + เรียก `notifyEvent()` ไม่ต้องแตะ edge ตัวไหนอีก** · เรียกจาก client ผ่าน `src/utils/notifyEvent.js` และจาก DB trigger ผ่าน pg_net · verify_jwt=false |
| `downtime-open-scan` | DR (pg_cron ทุก 5 นาที) | สแกน Downtime ที่เปิดค้างเกิน `dt_alert_config.open_alert_min` นาที → POST `downtime_open_15min` ไป send-notification ฝั่ง Main + stamp `open_alerted_at` กันซ้ำ (2026-07-14) |
| `send-mtn-notification` | Main | แจ้งเตือนใบแจ้งซ่อม MO — **แจ้งครบทุกสเตป 1-7** (`mtn_reported`/`assigned`/`repaired`/`checked`/`qa`/`handover`/`closed`) · **แยกไฟล์จาก send-notification (กันไฟล์ใหญ่พัง) แต่ route ผ่าน notification_rules/telegram_channels เดียวกัน** → ตั้งค่า/ปิด/เลือกห้อง/แก้ข้อความได้จาก `/notification-config` (category maintenance) · **route ตามทีม:** มีห้องแท็ก `telegram_channels.team` = `mtn_dept` → เข้าห้องทีม, ไม่มี → ห้องรวม (smart maintenance/fallback) · **v5 (2026-07-22): แต่ละสเตปต่อท้าย "⏳ ขั้นต่อไป: รอ…"** ให้ห้องแชทรู้ว่ารออะไรต่อ (map `NEXT` ในไฟล์) · payload `{ event, mo: {...} }` |
| `mtn-daily-summary` | Main (pg_cron 02:00 UTC = **09:00 ไทย**) | **สรุปงานซ่อม (MO) ค้างประจำวัน** (2026-07-22) — อ่าน `mtn_orders` ฝั่ง DR (`DR_URL`/`DR_ANON_KEY`, status ไม่ใช่ closed/rejected) นับตามทีม (`mtn_dept`) + ขั้นที่ค้าง (pending→รอรับงาน … handover→รออนุมัติปิด) → ส่งภาพรวมเข้าห้องรวม (event `mtn_daily_summary`) + แยกรายทีมเข้าห้องที่แท็ก team ไว้ · verify_jwt=false (cron เรียกได้ไม่ต้อง JWT) · ปิด/แก้ห้องได้ที่ `/notification-config` · migration `20260722_mtn_daily_summary_rule.sql` (rule) + `20260722_mtn_daily_summary_cron.sql` (cron Main) |
| `telegram-webhook` | Main | ⚠️ **ซอร์สอยู่ใน repo แต่ยังไม่เคย deploy จริง** (ตรวจ 2026-08-06 — ตาราง `telegram_messages`/`telegram_sent_messages`/`telegram_pending_actions` apply แล้ว แต่ function ไม่มีในโปรเจค) → ขา "รับ" ยังไม่ทำงาน: reply ใน Telegram ไม่กลายเป็นคอมเมนต์ · AI intake `/dt` ยังใช้ไม่ได้ · ขา "ส่ง" (send-notification/send-mtn-notification) ทำงานปกติ · เปิดใช้ต้อง deploy + ตั้ง secrets + `setWebhook` กับ Telegram (เป็น action ที่มีผลกับบอทจริง — ถาม user ก่อน) · **ขา "รับ" ของบอท** (2026-07-16): Telegram ยิงทุก update เข้า function นี้ (setWebhook + secret) → (1) กวาดเก็บข้อความกลุ่มที่ลงทะเบียน → `telegram_messages` (2) **reply ใต้ข้อความแจ้งเตือน = คอมเมนต์ `event_comments` ผูกใบงานอัตโนมัติ** (mapping จาก `telegram_sent_messages` — send-notification/send-mtn-notification ถูก patch ให้จำ message_id ของ event ที่มี ref: mtn ทุก event + downtime_call_mtn/open_15min · payload ต้องส่ง `id` มาด้วย) (3) **AI intake**: `/dt RB80 โรบอทชนจิ๊ก 14.00-14.20` ทุกกลุ่ม หรือพิมพ์อิสระในกลุ่มที่อยู่ใน env `AI_INTAKE_CHAT_IDS` → Claude Haiku แยกฟิลด์ → ground กับ machines/dr_downtime_types/production_sessions จริง (work date ตัด 08:00 ไทย) → ปุ่ม [✅ บันทึก][❌ ยกเลิก] ใน Telegram — **คนกดยืนยันเท่านั้นถึง insert `downtime_logs` · AI ห้ามเขียนฐานเอง** (คิว `telegram_pending_actions` หมดอายุ 6 ชม.) · secrets: `TELEGRAM_WEBHOOK_SECRET`, `DR_URL`, `DR_ANON_KEY`, `ANTHROPIC_API_KEY` (ไม่ตั้ง = ปิดเฉพาะ AI), `AI_INTAKE_CHAT_IDS` · migration `20260716_telegram_intake.sql` (Main — 3 ตาราง service-role-only) |

### `cleanup-orphan-photos` (Main project — 2026-07-09)
- ล้างไฟล์กำพร้าใน bucket `employee-photos` = ไฟล์ที่ไม่มี `employees.image_url` / `line_layouts.image_url` ชี้ถึงแล้ว
- `POST /functions/v1/cleanup-orphan-photos?dry_run=1` + header `x-cleanup-token` (token ฝังในซอร์ส function) — **รัน dry_run ดูรายงานก่อนลบจริงเสมอ**, มี safety ข้ามไฟล์ที่อัปโหลดภายใน 24 ชม.
- รันครั้งแรกล้างได้ 117 ไฟล์ / 100.6MB — ปกติไม่ต้องรันซ้ำ เพราะแอปลบไฟล์เก่าเองตอนเปลี่ยนรูปแล้ว (ดู "Storage & รูปภาพ")
- ถ้า environment โดน network policy บล็อกยิงตรงไป supabase.co → เรียกผ่าน `net.http_post` (pg_net) จาก SQL แทน (ดู pattern ใน migration `20260708_pm_daily_scan_cron.sql`)

> ### ⚠️ กฎเหล็ก — ตรวจ "ของค้าง" ต้องถามฐาน ห้ามเชื่อ stamp ในไฟล์/เอกสาร (2026-09-02)
> เอกสาร/คอมเมนต์ในไฟล์บอกสถานะ deploy ผิดได้ง่าย เพราะแต่ละ session บันทึกคนละที่และไม่มีใครตามลบ
> — วัดจริงรอบนี้: CLAUDE.md เขียนว่า `qa-fme-scan` "ยังไม่ deploy" แต่**อยู่ v13 + cron เดินมาแล้ว**
> · migration 35 ไฟล์ล่าสุดมี stamp ในไฟล์แค่ 2 ตัว ทั้งที่ **apply ครบทุกตัว**
> **วิธีตรวจที่เชื่อได้ (ทำซ้ำได้ ~3 คิวรี):**
> 1. **migration** → query `to_regclass()` / `information_schema.columns` / `pg_proc` / `pg_indexes` /
>    `cron.job` ของ object ที่แต่ละไฟล์สร้าง **ทั้ง 2 project** — ไม่มีในทั้งคู่ = ยังไม่ apply จริง
>    (`supabase_migrations.schema_migrations` เทียบชื่อไฟล์ไม่ได้ — เวอร์ชันเป็น timestamp ตอน apply)
> 2. **edge** → `list_edge_functions` แล้ว `get_edge_function` **ดึงซอร์สที่รันอยู่มา diff กับ repo**
>    เลข version/updated_at บอกแค่ "เคยถูก deploy" ไม่ได้บอกว่าตรงกับ repo
> 3. **สวิตช์** → ของที่ deploy แล้วอาจยังเงียบเพราะ flag ปิด (`qa_fme_config.is_enabled`)
>    หรือ rule ไม่ได้เลือกห้อง (`notification_rules.channel_ids` ว่าง) — **"deployed" ≠ "ทำงาน"**
> **⚠️ deploy edge ผ่าน MCP ต้องพิมพ์ทั้งไฟล์ซ้ำใน tool call** → ไฟล์ใหญ่ (`send-notification` 56KB)
> **ห้าม deploy ด้วยวิธีนี้** พิมพ์พลาดตัวเดียว = แจ้งเตือนทั้งระบบพัง · ไฟล์ใหญ่ให้ deploy ด้วย
> `supabase functions deploy <slug>` จากเครื่องที่มี CLI + access token (อ่านไฟล์ตรง ไม่มีทางพิมพ์ตก)
> · deploy ผ่าน MCP แล้ว **ต้องดึงกลับมาตรวจว่าโครงสร้างครบทุกจุดที่ตั้งใจแก้** ก่อนถือว่าเสร็จ

---
