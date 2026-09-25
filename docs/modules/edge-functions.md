# Edge Functions

> ย้ายมาจาก `CLAUDE.md` (2026-09-03 — แยกไฟล์เพื่อลด context) · โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน


### 🔴🔴 `verify_jwt` ของฟังก์ชันที่ **cron เรียก** ต้องเป็น `false` เสมอ (2026-09-25 · เคยพังจริง)

**เกิดจริง:** deploy `mtn-daily-summary` เมื่อ 24/09 แล้วติด `verify_jwt: true` ไป
⇒ สรุปงานซ่อมเช้า **25/09 หายทั้งฉบับ** (Telegram ไม่เข้า · กระดิ่ง 0 ใบ)

**ทำไมถึงหาไม่เจอง่ายๆ — มันเงียบสนิท 2 ชั้น:**
1. `pg_cron` เรียกผ่าน `net.http_post` **ไม่มี header `Authorization`** (ดู `cron.job` ทุกตัวในโปรเจคนี้)
   ⇒ เปิด `verify_jwt` = โดน **401 ตั้งแต่หน้าประตู ตัวฟังก์ชันไม่เคยรันเลย**
2. 🔴 **`cron.job_run_details` ยังขึ้น `succeeded`** — มันวัดแค่ว่า "คิว http_post สำเร็จ" ไม่ใช่ผลลัพธ์ HTTP
   ⇒ ดูหน้า cron แล้วเขียวหมด ทั้งที่งานไม่ได้ทำ

**วิธีตรวจว่า cron job ทำงานจริงไหม (ห้ามดูแค่ job_run_details):**
```sql
-- ผลลัพธ์ HTTP จริง (net._http_response เก็บย้อนหลังสั้นมาก ~15 นาที)
select status_code, left(content,300), created from net._http_response order by created desc limit 20;
```
หรือดูจาก log (ย้อนได้ 24 ชม.) — `source='function_edge_logs'` หา `POST | 401 | .../<slug>`
· **ตัวชี้วัดที่ดีที่สุด = ผลลัพธ์ปลายทาง** (มีแถวใน `notifications` ของ event นั้นวันนี้ไหม)

**กฎ:** ฟังก์ชันที่ถูกเรียกโดย cron/trigger/ระบบภายใน → `verify_jwt: false`
(ในโปรเจคนี้: `send-notification` · `daily-4m-summary` · `qa-fme-scan` · `send-push` · `send-event-notification`
 · `mtn-daily-summary` · `cleanup-orphan-photos` ฯลฯ ล้วน false)
เปิด `true` เฉพาะฟังก์ชันที่ **คนกดจากหน้าเว็บ** และต้องเช็คสิทธิ์ (`create-user`/`delete-user`/`reset-user-password`)
⚠️ เครื่องมือ deploy บางตัว **ตั้ง `verify_jwt: true` เป็นค่าเริ่มต้น** — ทุกครั้งที่ deploy ต้องส่งค่าให้ตรงของเดิม
   แล้ว**เช็คกลับจาก `list_edge_functions`** ว่าได้ค่าที่ตั้งใจจริง

### 🏷️ ป้ายราคาในหน้าตั้งค่าแจ้งเตือน + `notifications.event_key` (2026-09-17)

**คำสั่ง user:** *"ป้ายราคาโชว์ตอนเลือกติ๊กคอนฟิค จะได้รู้"* · *"ตอนนี้มันเลือกแค่ role แต่ไม่เลือก
ส่วนงานหรือแผนก มันเลยข้ามกันหมด บางอย่างเกี่ยวกับเลเวล supervisor แต่ไม่เกี่ยวกับแผนกนั้นก็ไม่ควรแจ้ง"*

**ที่มา (วัดจริง 17/09):** เหตุการณ์จริงทั้งระบบมีแค่ **~69/วัน** แต่กลายเป็น **3,844 แถว/วัน**
เพราะตัวคูณผู้รับเฉลี่ย **56 คน/เหตุการณ์** — ใบซ่อม **1 ใบ = 99 แถว** (8 ขั้น × ~50 คน)
= 79% ของแจ้งเตือนทั้งระบบ · **คนเปิดอ่าน 8%**
· 41 กฎที่มีผู้รับ → **19 กฎไม่กรองส่วนงานเลย** · **ระบุส่วนงานเอง 0 กฎ · ระบุแผนกเอง 0 กฎ**
· ช่องจำกัดผู้รับมีในหน้ามาตลอด แต่**ซ่อนหลังปุ่ม "🎯 จำกัดผู้รับ"** ที่ต้องกดเปิด ⇒ ไม่เคยมีใครใช้
⇒ **ไม่มีใครตั้งผิด — แค่ "ติ๊กเผื่อไว้ก่อน" เพราะตอนติ๊กไม่เห็นว่าแปลว่ากี่แถว/วัน**

**ของที่ทำ:**
- **ป้ายราคาใต้แถวติ๊ก role** — `≈ 21 คน/ครั้ง · เกิด 31 ครั้ง/วัน · ≈ 651 แจ้งเตือน/วัน · เปิดอ่าน 7%`
  + คำเตือน 🔴/⚠️ (ไม่จำกัดส่วนงาน · ตัวกรองไม่มีผลกับใคร · คนอ่านน้อย)
  · **สูตร/เกณฑ์อยู่ `src/utils/notifReach.js` เท่านั้น (pure · 10 เทส) ห้ามคำนวณซ้ำในหน้า**
- **RPC `notif_rule_reach(p_days)`** (SECURITY DEFINER · guard `has_perm('page:/notification-config')`)
  — สรุปฝั่ง server เพราะต้องอ่าน `notifications` หลายหมื่นแถว · ดึงมา client = ชนเพดาน 1000 แถว
- **`notifications.event_key`** + **`notification_rules.title_match`** (LIKE pattern · data-driven)
  🔴 **ทำไมต้องมี:** ก่อนหน้านี้ไม่มีคอลัมน์บอกว่าแถวไหนมาจากกฎไหน ต้องเดาจาก `title = label`
  ⇒ วัดจริง **46,307/54,154 แถว (86%) จับคู่ไม่ได้** เพราะ `send-mtn-notification` ตั้ง title เอง
  (`"🛠️ แจ้งซ่อมใหม่ — Line 60 · -"`) ⇒ **ป้ายราคาจะบอกว่าใบซ่อมราคา 0 ทั้งที่กิน 79% ของระบบ**
  = ชี้ทางผิดแรงกว่าไม่มีป้าย · เติมที่ trigger `trg_notification_fill_link` (แพทเทิร์นเดียวกับ `link`)
  · หลังแก้ + backfill: **จับคู่ได้ 93%** (ที่เหลือ = mention/ข้อความทดสอบ ซึ่งไม่มีกฎ — ถูกต้องแล้ว)
  · ⚠️ **ตัวส่งใหม่ที่ตั้ง title เอง ต้อง seed `title_match` ด้วย** ไม่งั้นป้ายราคาของเรื่องนั้นเป็น 0

> #### 🔴🔴 เจอระหว่างทาง — `notifications` ไม่มี index เลยนอกจาก pkey
> กระดิ่งยิง `where user_id = ? order by created_at desc limit 30` ทุกครั้งที่เปิดแอป + ทุก realtime event
> ⇒ **seq scan ทั้งตาราง 64,456 แถว ทุก user ทุกจอ** (ตารางโตวันละ 3,844 แถว)
> แก้แล้ว: `idx_notifications_user_created (user_id, created_at desc)` + `idx_notifications_created`
> · ยืนยันด้วย `explain analyze`: seq scan (cost 11,459) → **Index Scan 32 buffers**
> · **บทเรียน: ตารางที่โตทุกวันและถูกอ่านด้วย filter คงที่ ต้องเช็ค `pg_indexes` ตั้งแต่วันที่สร้าง**
> — ของแบบนี้ไม่มีใครเห็นจากหน้าจอ เห็นได้จากแผนคิวรีเท่านั้น (คลาสเดียวกับกฎเหล็กข้อ 9)

**กฎที่ตกผลึกเรื่องความซื่อสัตย์ของป้าย** (`notifReach.js` ล็อกด้วยเทส):
- ประวัติน้อยกว่า 30 แถว = **ไม่สรุป % อ่าน** (ห้ามบอกว่า "ไม่มีคนอ่าน" ทั้งที่เพิ่งเปิดใช้)
- ไม่เคยเกิดเหตุการณ์ = เขียน **"ยังไม่มีสถิติ"** ห้ามโชว์ `0 แจ้งเตือน/วัน`
- ระบุส่วนงาน/แผนกเอง = ประมาณผู้รับต่อครั้งไม่ได้ → คืน `null` แล้วโชว์ `≤ N คน` **ห้ามเดาเป็นตัวเลข**

**migration:** `20260917_notif_rule_reach_rpc.sql` · `20260917_notifications_event_key.sql` ·
`20260917_notifications_indexes.sql` · `20260917_notif_rule_reach_by_event_key` (**apply แล้วทั้งหมด**)

---

### 📣 ย้ายแจ้งเตือน Telegram เข้าระบบ — ⏸️ **ทำแล้วย้อนกลับ รอทำใหม่เป็นแบบ "สรุปรายรอบ"** (2026-09-17)

> **สถานะ: ย้อนกลับหมดแล้ว** (`20260917_revert_inapp_recipients_from_telegram.sql`) — ฐานกลับไปเป็น
> 14 เรื่อง Telegram-only เหมือนเดิม · **ห้าม re-apply ตัวเดิม** ให้ทำตามทิศทางใหม่ด้านล่าง
>
> **ทำไมย้อน (คำสั่ง user):** *"ทำแบบนี้เพิ่ม egress หรอ งั้นชะลอก่อนเลย ว่าจะให้ลด"* ·
> *"เรื่องบางเรื่องที่แจ้งตลอด แต่ไม่ค่อยมีใครดูหรือสนใจ — อาจจะทำเป็นแจ้งเตือนสรุปตามรอบเวลาดีกว่ามั้ย ยกเว้นเรื่องเร่งด่วน"*
>
> **บทเรียนที่แพงที่สุดของรอบนี้ — ไม่ใช่เรื่องต้นทุน แต่เรื่องดีไซน์:**
> ห้องแชทกับกระดิ่งส่วนตัว **ไม่ใช่ช่องทางชนิดเดียวกัน** · 149 DT/วันไหลผ่านตาในห้องแชทได้
> แต่ยัดใส่กระดิ่งทีละใบ = คนอ่านไม่ไหวแล้วเลิกอ่านทั้งกระดิ่ง ⇒ **แจ้งเตือนที่ไม่มีใครอ่าน
> แย่กว่าไม่มีแจ้งเตือน** (คลาสเดียวกับคิว 4M auto 323 ใบที่กลบใบจริง)
> ⇒ **ย้าย 1:1 จาก Telegram ไม่ใช่คำตอบ · ต้องแยก "เร่งด่วน = รายตัว" ออกจาก "รับรู้ = สรุปรายรอบ" ก่อน**
>
> **✅ แก้แล้ว 2026-09-24 — "ยิงแม้ user ไม่มี subscription" ไม่เป็นจริงอีกต่อไป** (ดูหัวข้อถัดไป)
>
> **ตัวเลขต้นทุนที่วัดไว้ (กันประเมินผิดซ้ำ):** 1 แถวใน `notifications` = `fn_notify_push` ยิง
> `send-push` **1 invocation ต่อแถว** (~~ยิงแม้ user ไม่มี subscription~~) + คิวรี `push_subscriptions` 1 ครั้ง
> ⇒ +2,000 แถว/วัน = +2,000 invocation/วัน · **egress เองน้อย ~2-4 MB/วัน** (payload ~1 KB)
> — **ตัวแพงจริงคือ invocation + แถวสะสม + คนเลิกอ่าน ไม่ใช่ egress** (egress ก้อนใหญ่คือ poll/รูป
> เช่น FactoryMap 26 KB/รอบ) · อย่าอ้าง "egress" เป็นเหตุผลลอยๆ ให้ดูว่าต้นทุนจริงอยู่ตรงไหน

### 🔕 fn_notify_push — ไม่ปลุก Edge Function ให้คนที่ยังไม่เปิด Push (2026-09-24)

**วัดจริง 23/09 ฝั่ง Main** (`edge_logs` แยกด้วย user-agent):

| endpoint | ครั้ง/วัน | มาจาก Edge Runtime |
|---|---:|---:|
| `push_subscriptions` | 5,929 | 5,627 |
| `notification_settings` | 5,402 | 5,402 (ทั้งหมด) |
| **รวม** | **11,331** | = **25.3% ของ REST ทั้งวัน** |

มากกว่าทุก endpoint ที่คนเปิดใช้จริง (`production_lines` 4,041 · `profiles` 3,814 · `role_permissions` 3,358)

**ต้นเหตุ:** trigger ยิง `send-push` 1 ครั้งต่อ 1 แถวใน `notifications` โดยไม่ดูก่อนว่าผู้รับเปิด Push ไหม
ของจริง 24 ชม.: **แจ้งเตือน 1,377 แถว · ผู้รับมี subscription แค่ 389 (28%)**
⇒ **988 ครั้ง (72%) ยิงทิ้งเปล่า** และแต่ละครั้งยังอ่าน 2 ตารางเต็มๆ ก่อนตอบ `sent: 0`
(ทั้งระบบมีคนเปิด Push **23 จาก 97 คน** · subscription 27 แถว)

**ที่แก้** (migration `20260924_push_skip_users_without_subscription_main.sql` + `send-push` v14):
1. trigger `select ... from push_subscriptions where user_id = NEW.user_id` **ในตัว DB เอง** (index
   ไม่ผ่าน PostgREST ⇒ ไม่นับเป็น request) · `null` = ไม่เรียก Edge Function เลย
2. แนบผลเป็น `subs` ไปกับ body ⇒ ฟังก์ชันไม่ต้องคิวรีซ้ำ
   · **ส่งเฉพาะคีย์ของเครื่องปลายทาง (endpoint/p256dh/auth) ซึ่งเป็นค่าสาธารณะ
     🔴 ห้ามส่ง VAPID private key ผ่าน body เด็ดขาด** (นั่นเป็นความลับฝั่งผู้ส่ง)
3. **เข้ากันได้ทั้ง 2 ทาง** — ฟังก์ชันเก่า+trigger ใหม่ = มองข้าม `subs` แล้วคิวรีเอง ·
   ฟังก์ชันใหม่+trigger เก่า = ไม่มี `subs` ก็คิวรีเอง ⇒ deploy คนละจังหวะได้

> 🔴 **บทเรียน: cache ในตัวแปรโมดูลของ Edge Function แก้ปัญหานี้ไม่ได้**
> 14/09 เคยใส่ cache VAPID (TTL 10 นาที) พร้อมคอมเมนต์ว่า "ตัดคิวรีนี้ทิ้งได้เกือบหมด"
> **แต่วัด 23/09 ได้ผลจริงแค่ ~17%** เพราะ Deno สร้าง isolate ใหม่แทบทุกครั้ง (cold start = หน่วยความจำว่าง)
> ⇒ **ตัวที่ลดได้จริงคือ "จำนวนครั้งที่ถูกเรียก" ไม่ใช่ "จำที่ฝั่งฟังก์ชัน"**
> และเป็นตัวอย่างของบั๊กคลาส *"แก้แล้ว เขียนเอกสารว่าแก้แล้ว แต่ไม่มีใครกลับไปวัด"*
> — **แก้ Edge Function เสร็จต้องกลับมาอ่าน log ยืนยันเสมอ**

**ตรวจกลับหลัง apply:** `trg_notify_push` ยังผูกอยู่ + enabled · `pg_get_functiondef` มี `v_subs`/`subs` ·
edge function v14 `verify_jwt=false` เหมือนเดิม (⚠️ **ตัวนี้ถูกเรียกจาก pg_net ที่ไม่ส่ง Authorization —
deploy ด้วย `verify_jwt=true` เมื่อไหร่ Push ตายทั้งระบบทันที**)

---

**ข้อมูลที่ถอดไว้แล้ว (ยังใช้ได้ตอนทำรอบใหม่ — ไม่ต้องขุดซ้ำ):**

**คำสั่ง user:** *"จากการแจ้งเตือน telegram ให้ย้ายเข้าระบบเราทั้งหมด สิทธิ์หรือช่องทางก็ไปอ้างอิงจาก telegram"*
(ต่อจากคำถาม "ถ้าระบบแจ้งเตือนโอเค เราไม่ต้องใช้ telegram แล้วสิ")

**ก่อนแก้:** 14/61 เรื่องที่เปิดอยู่มี Telegram แต่ `inapp_roles` ว่าง ⇒ ปิด Telegram เมื่อไหร่หายเงียบทันที
(รวมเรื่องด่วนที่สุด: Downtime · เรียกช่าง MTN · Daily PM แดง · สโตร์หยิบผิดพาร์ท)
**หลังแก้: เหลือ 0** · migration `20260917_inapp_recipients_from_telegram.sql` (+ `20260917_downtime_inapp_drop_mtn`)

**วิธีถอด "ผู้ฟังประจำห้อง" จาก Telegram** (ไม่ได้เดา — ถอดจากกฎที่ตั้งครบ 2 ขาอยู่แล้ว
เอา role ที่ห้องนั้นใช้ **≥50% ของกฎในห้อง** + `admin` ทุกห้อง):

| ห้อง | role ที่ได้ |
|---|---|
| 🔧 Smart Maintenance | admin · manager · supervisor · mtn |
| 🚚 Smart Logistic | admin · manager · planner_store · sale |
| 🔍 Smart Quality | admin · manager · qa |
| 🏭 Smart Production / 📝 Report Technician PD3 | admin · manager · supervisor · leader |
| 🧑‍🏭 Smart Manpower | admin · manager · supervisor |

> **⚠️ นี่คือ "เพิ่มช่องทาง" ไม่ใช่ "ย้าย"** — Telegram ยังส่งครบทุกเรื่องเหมือนเดิม ตั้งใจให้รันขนาน 2 ขา
> แล้วค่อยปิด Telegram **ทีละเรื่อง** ที่ `/notification-config`

#### 🔴 2 กับดักที่เจอตอนทำ — จำไว้ก่อนตั้งผู้รับในแอปครั้งต่อไป

1. **ห้องแชทกับกระดิ่งส่วนตัวรับปริมาณไม่เท่ากัน** — `downtime` ยิง **149 ครั้ง/วัน** (วัดจริง 30 วัน)
   ห้อง Telegram รับไหว แต่กระดิ่ง+เสียง+push ส่วนตัว × 61 คน = **9,100 แถว/วัน**
   (ฐาน `notifications` ทั้งระบบตอนนี้ 64,456 แถว = **โตเท่าตัวใน 7 วัน**) + เสี่ยง egress
   (เคยโดน Supabase ล็อกทั้ง org มาแล้ว) ⇒ **เรื่องที่ยิงถี่ต้องแคบกว่าที่ Telegram ตั้งไว้เสมอ**
   · `downtime`/`downtime_recovered` → `supervisor + leader` + `match_section` = 4-9 คน/ใบ (PD3 = 24) ≈ 1,500/วัน
2. **`notify_recipients()` มี 2 ทางรั่วที่ทำให้ `inapp_match_section` ไม่ช่วยอะไร:**
   - **`admin`/`manager` ถูกยกเว้นจากการกรองส่วนงานเสมอ** → ใส่ในเรื่องที่ยิงถี่ = ได้ทุกใบทั้งโรงงาน
     · **✅ ปิดได้แล้วรายกฎ (2026-09-21): `notification_rules.inapp_scope_strict`**
       (migration `20260921_notify_scope_strict.sql` · **apply แล้ว**) — `true` = ผู้บริหารถูกกรอง
       ตามส่วนงานเหมือนคนอื่น · **default `false` = ทุกกฎเดิมพฤติกรรมเหมือนเดิมเป๊ะ**
       · ติ๊กได้เองที่ `/notification-config` ใต้ "แจ้งเฉพาะคนที่ดูแลส่วนงาน" (ปุ่ม 🎯 จำกัดผู้รับ)
       · เปิดให้แล้ว 3 เรื่องที่ยิงถี่: `mtn_handover` · `skill_levelup_request` · `defect_recorded`
         — วัดจริง 14 วันก่อนแก้: ผจก. 4 คนได้ 49.6-59.8 แถว/วัน **อ่านรวมกัน 2 จาก 2,920 (0.07%)**
         หลังแก้: ผจก.PD1 ได้เฉพาะ PD1 (mtn_handover@PD1 8→7 คน · @PD3 16→14)
       · **🔴 ห้ามเปิด strict กับเรื่องที่ผู้บริหารต้องเห็นทั้งโรงงานจริงๆ** (สรุปรายวัน/เรื่องข้ามส่วนงาน)
         — ธงนี้ตั้งใจให้ "เลือกเป็นเรื่องๆ" ไม่ใช่เปิดทั้งระบบ · ย้อน: `set inapp_scope_strict = false`
   - **คนที่ไม่มี `section`/`sections`/`employees.section` เลย ถูกปล่อยผ่านทุกส่วนงาน** →
     **ช่างซ่อม 13/13 คนไม่มี section** (ใช้ `mtn_teams[]` แทนตามดีไซน์ของ role งานซ่อม)
     ⇒ ใส่ role `mtn` ในกฎที่กรองด้วย section **กรองไม่ได้เลยสักคน**
     · ช่างจึงรับ downtime ผ่าน `downtime_call_mtn` + `downtime_open_15min` (เรื่องที่ต้องลงมือ) แทน
   · **กฎ: ก่อนพึ่ง `inapp_match_section` ให้เช็คก่อนว่า role ปลายทาง "มี section จริงกี่คน"**

**ย้อนได้:** ค่าเดิมของ 14 เรื่องอยู่ที่ `bk_notification_rules_inapp_20260917` (event_key + inapp_roles + inapp_match_section)

**ยังเหลือก่อนปิด Telegram ได้จริง:** Web Push 22/94 คน (iPhone ต้อง "เพิ่มลงหน้าจอโฮม" ก่อน) ·
ขา "รับ" (`telegram-webhook`) ยังไม่ deploy · คอมเมนต์ในระบบยังมีแค่ MO/downtime

---

### 🔗 "กดกระดิ่งแล้วไปที่ปัญหานั้นเลย" — `notifications.link` (2026-09-16)

**ที่มา (feedback ทีมงานผ่าน user):** *"ระบบกระดิ่งแจ้งเตือนในเว็ป มีบางอันที่สามารถคลิกเข้าไปในจุดที่แจ้งเตือนหรือปัญหานั้นๆได้ แต่บางอันก็ไม่ได้"*

**วัดจากฐานจริง 16/09 (notifications 61,339 แถว):**

| กลุ่ม | จำนวน | กดได้ไหม (ก่อนแก้) |
|---|---|---|
| `ref_table` มีค่า (MO/downtime/4M/…) | 54,410 | ✅ ไปหน้ารวมของเรื่องนั้น (ผ่าน `NOTIF_ROUTE`) |
| **`ref_table` = null** | **6,873** | ❌ **ไม่มีลูกศร › กดแล้วแค่ mark อ่าน** |

ก้อน null ทั้งหมดออกจาก `notifyInApp()` ใน edge (send-notification · send-store-notification ·
mtn-daily-summary · daily-4m-summary · qa-fme-scan) ซึ่ง **ไม่เคยส่ง `ref_table` เลยสักตัว**:
หลุดเฟสงานส่ง 5,489 · เตือนรอบ PM 379 · ส่งงานลูกค้า 338 · เฝ้าระวังสโตร์ 326 · EDI 156 ·
แผนประสานงาน PM 131 · 💬 mention ใต้ใบซ่อม ~70 ⇒ ผู้ใช้เห็นพฤติกรรม "บางอันได้ บางอันไม่ได้" ตรงตามที่แจ้ง

**โมเดลปลายทาง 2 ชั้น (ห้ามสลับลำดับ):**
1. **`notifications.link`** (คอลัมน์ใหม่) = path ตรงๆ → **deep-link ได้** เช่น `/mtn-repair?mo=<id>`
2. `ref_table` → `NOTIF_ROUTE` (หน้ารวม) = ของเดิม ยังใช้กับใบเก่าทุกใบ

**ทำไมไม่ยัด `ref_table` ให้ครบแทน:** แจ้งเตือนสรุป **ไม่ได้ผูกกับแถวเดียว** (เฝ้าระวังสโตร์ = 100 รายการ)
⇒ ใส่ไปก็เป็นคำโกหก + `send-push` ใช้ `(ref_table, ref_id)` เป็น `tag` ของ push ด้วย · และ
**`ref_id` เป็น `uuid`** ⇒ ตารางที่ pk เป็น bigint เก็บ id ไม่ได้อยู่แล้ว

**ทำไมแก้ที่ DB ไม่ใช่ในโค้ด edge:** `send-notification` = 59 KB · `qa-fme-scan` = 53 KB —
กติกาในไฟล์นี้ (§audit รอบ 11) ห้าม deploy ไฟล์ขนาดนี้ผ่าน MCP และ user ไม่มี CLI ⇒
**ไม่มีทางแก้ในไฟล์นั้นอย่างปลอดภัย** · trigger ตัวเดียวครอบทุกตัวส่ง + แก้ปลายทางได้ทีหลังโดยไม่ต้อง deploy

**ของที่ทำ (migration `20260916_notifications_link.sql` + `20260916_notification_rules_link.sql` — apply แล้วทั้งคู่):**
- `notifications.link text` + `fn_notify_push` ส่ง `link` ต่อให้ Web Push ด้วย
- `notification_rules.link text` (data-driven · seed 25 event) + trigger `trg_notification_fill_link`
  (BEFORE INSERT) เติมให้เมื่อผู้ส่งไม่ได้ระบุ — จับคู่ด้วย `label = title` (ทุกตัวส่งตั้ง title จาก label อยู่แล้ว)
- **deep-link ใบ MO:** `ref_table='mtn_orders'` + `ref_id` → `/mtn-repair?mo=<id>` (ทำใน trigger
  แทนแก้ `send-mtn-notification` 30 KB) · `MtnRepair.jsx` รับ `?mo=` ทั้ง **id และเลข MO** — **ห้ามถอด**
- backfill ใบเก่า (backup ที่ `bk_notifications_link_20260916`)
- ฝั่งจอ: `src/utils/notifLink.js` = ตัวตัดสินจุดเดียว (`link` ก่อน → `ref_table` · กรอง path ภายใน ·
  ผ่าน `canAccessPage` เสมอ) — **ห้ามอ่าน `n.link` ตรงๆ ที่อื่น** (มาจาก DB = ข้อมูล ไม่ใช่โค้ด)
- `send-push` v13 + `send-event-notification` v3 (deploy + ดึงกลับเทียบกับ repo แล้ว ตรงกันทั้งคู่ ·
  `verify_jwt=false` ทั้งคู่เหมือนเดิม) · **`send-event-notification` กัน `ref_id` ที่ไม่ใช่ uuid** —
  เดิมส่งเลขเข้าไป = insert ทั้งก้อนล้ม 22P02 ⇒ **ทุกคนไม่ได้แจ้งเตือนใบนั้นเลย แบบเงียบ**

**ผลวัดหลังแก้:** กดได้ 52,194 ใบผ่าน `link` (deep-link ถึงใบ MO 45,015) + 12,225 ใบผ่าน `ref_table`
· เหลือกดไม่ได้ **37 ใบ** = ข้อความทดสอบ + `user_feedback` (ตั้งใจไม่มีหน้า)

**ด่านกันหลุดซ้ำ:** `src/utils/__tests__/notifRoute.test.mjs` — ทุก path ใน `notification_rules.link`
(อ่านจากไฟล์ migration) และใน `NOTIF_ROUTE` ต้องเป็น `<Route>` ที่มีจริงใน App.jsx · ทุก event ที่ยิง
`notifyInApp` ต้องมีปลายทาง · `notifLink.test.mjs` ล็อกกติกาความปลอดภัยของ `link`

**เพิ่ม event ใหม่ที่ยิง `notifyInApp`** → ต้อง seed `notification_rules.link` ด้วย ไม่งั้นกระดิ่งกดไม่ได้ (เทสจะตก)

---

### 🔔 ช่องทางแจ้งเตือน — ปิดช่องว่าง "Telegram ทางเดียว" (2026-09-14)

**ที่มา:** user ตัดสินใจว่าถ้าย้ายระบบลง server ของบริษัท **จะไม่เอา Telegram** (ดู `docs/LOCAL-SERVER-MIGRATION-SPEC.md` §5)
→ ต้องมั่นใจก่อนว่าทุกเหตุการณ์ยังส่งถึงคนได้โดยไม่พึ่ง Telegram

**ผลสำรวจ (14 ก.ย. 2026) — ต้องแยก 2 ชั้น อย่าสับสน:**

| ชั้น | อาการ | จำนวน |
|---|---|---|
| **ก. ช่องว่างเชิงโค้ด** — ฟังก์ชันไม่มีโค้ดเขียน `notifications` เลย | ถอด Telegram = หายสนิท แก้ที่หน้าเว็บไม่ได้ | **3 ตัว** |
| **ข. ช่องว่างเชิงตั้งค่า** — โค้ดรองรับแล้ว แต่ `notification_rules.inapp_roles` ว่าง | `notifyInApp()` return ทันที = ไม่แจ้งในแอป (opt-in by design) | **21 event** |

**ชั้น ก. แก้แล้วทั้ง 3:** `daily-4m-summary` · `mtn-daily-summary` · `qa-fme-scan`
- เพิ่ม helper `notifyInApp(eventKey, message, type)` ในแต่ละไฟล์ (edge function แชร์โค้ดข้ามกันไม่ได้ → เขียนซ้ำตาม pattern เดิมของ `send-*`)
- **ผู้รับมาจาก RPC `notify_recipients` จุดเดียว ห้ามกรอง role เองในไฟล์** (กติกาเดียวกับ Telegram)
- **opt-in:** `inapp_roles` ว่าง = ไม่แจ้งในแอป ⇒ deploy แล้วพฤติกรรมเดิมเป๊ะจนกว่าจะตั้งผู้รับ
- `daily-4m-summary` เดิม**ไม่มี event_key ในทะเบียนเลย** (ยิง Telegram ผ่าน env `TELEGRAM_CHAT_ID` ตรงๆ → admin ปิด/เปลี่ยนห้องไม่ได้) — ลงทะเบียน `four_m_daily_summary` แล้ว
- `daily-4m-summary` เด้งกระดิ่ง**เฉพาะวันที่มีงานค้าง** (pending/pending_qa/rejected > 0) — วันที่เคลียร์หมดไม่รบกวน 87 บัญชี
- **⚠️ กับดักที่เจอใน `qa-fme-scan`:** เดิม `const sent = await sendTelegram(...)` แล้วใช้ `if (sent)` ตัดสินว่าจะ `mark alert_count` ไหม
  ⇒ วันที่ถอด Telegram ออก `sent` เป็น false ตลอด → **ไม่เคย mark → เตือนซ้ำทุก 5 นาทีไม่จบ และ escalate ไม่เดินหน้า**
  แก้เป็น `sent = tgSent || appSent` (ถึงผู้รับช่องทางใดก็ได้) · และเปลี่ยน guard `callChats?.length` → `callChats !== null`
  (เดิม "ไม่มีห้อง Telegram" = ข้ามทั้งบล็อก กระดิ่งในแอปเลยไม่ได้ยิงตามไปด้วย)
  **บทเรียนทั่วไป: ตัวแปรที่แปลว่า "ส่งสำเร็จ" ห้ามผูกกับช่องทางเดียว**
- migration `20260914_notify_inapp_telegram_only_gaps.sql` (Main · **apply แล้ว**) — seed `four_m_daily_summary` + ตั้ง `inapp_roles` ให้ `mtn_daily_summary` / `qa_fme_call` / `qa_fme_overdue` เฉพาะแถวที่ยังว่าง (รันซ้ำได้)
- **สถานะ deploy: ✅ ครบทั้ง 3 แล้ว** — `daily-4m-summary` v11 · `mtn-daily-summary` v15 · **`qa-fme-scan` v16 (deploy 2026-09-16)**
  - qa-fme-scan ค้างมา 2 วันเพราะไฟล์ 52 KB ต้องคัดลอกทั้งก้อนเข้า MCP **โดยไม่มีตัวตรวจความครบ**
    ⇒ **ทางออกที่ใช้จริง (ทำซ้ำได้กับไฟล์ใหญ่ตัวอื่น):**
    1. `qa_fme_config.is_enabled = false` อยู่แล้ว ⇒ ต่อให้ไฟล์เพี้ยนก็ไม่กระทบของจริง (cron return early)
    2. `npx esbuild <ไฟล์> --bundle --external:https://* --format=esm --outfile=/dev/null` = ด่านไวยากรณ์ในเครื่อง (คอนเทนเนอร์ไม่มี deno)
    3. **ยิง `?dry=1` ผ่าน `net.http_get` แล้วอ่าน `net._http_response`** — โหมดนี้รันทั้งเส้นแต่ไม่เขียน DB ไม่ส่ง Telegram
       (เน็ตจากคอนเทนเนอร์ออกไป supabase.co ตรงๆ ไม่ได้ ต้องยิงผ่าน pg_net ฝั่ง DB)
    · ผลตรวจจริง 16/09: `200 · {ok:true, dry:true, enabled:false, scanned:{sessions:33, orders:390, runs:60}, would_create:32}`
      = ไฟล์บูตได้ อ่าน DR ได้ คำนวณครบ ⇒ **พิสูจน์ว่าไม่ตกหล่น** (แข็งแรงกว่าไล่ diff ด้วยตา)

**ชั้น ข. ยังไม่แตะ** — 21 event ที่ `inapp_roles` ว่าง (เช่น `checkin_summary` · `prod_close` · `downtime` · `pm_daily_*` · `shipping_shipped` · `wip_*` · `mtn_closed` · `kanban_round_cutoff`)
**ห้ามเปิดแบบเหมา** — `downtime` เกิดจริง **145 ครั้ง/วัน** (วัด 30 วัน, ก.ย. 2026) เปิดให้ manager/admin = กระดิ่ง+push ท่วมจนคนเลิกอ่าน
(บทเรียนเดียวกับ 4M Man อัตโนมัติ 392 ใบ/10 วัน) → ต้องเลือกผู้รับให้แคบ ใช้ `inapp_match_section=true` แจ้งเฉพาะหัวหน้าส่วนงานที่เกิดเหตุ

**หมายเหตุที่เคยเข้าใจผิด:** `four_m_status` (4M เปลี่ยนสถานะ) **ไม่ใช่** ช่องว่าง — มันเขียน `notifications` ด้วย logic ผู้รับตามสถานะ workflow ของตัวเอง (ไม่ได้ผ่าน `notifyInApp` จึงไม่ขึ้นตอน grep หา helper) · `downtime_call_mtn` / `downtime_open_15min` ก็เช่นกัน (ใช้ `insertNotifications` + `recipientsForDowntime`)

---

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
| ↳ บล็อก **📥 ใบที่รอฝ่ายผู้แจ้ง** (2026-09-16 · v15) | เดียวกัน | ขั้น 4/6/7 (`REPORTER_WAIT`) แยก**รายส่วนงานที่ถอดจาก `line_name`** → ห้อง event `mtn_pickup_pending` (seed 🏭 Smart Production) + กระดิ่งในแอป**รายส่วนงาน** ผ่าน `notify_recipients(p_section)` · เหตุผล+ตัวเลขที่วัดได้ → `docs/modules/mtn-work-order.md` · migration `20260916_mtn_pickup_pending_rule_main.sql` (Main) · ปิดบล็อก = ปิด event นี้ที่ `/notification-config` |
| `send-push` | Main (verify_jwt=false · เรียกจาก trigger) | **Web Push ไปมือถือ** — trigger `trg_notify_push` (`fn_notify_push`, `notifications` AFTER INSERT, pg_net best-effort) POST `{user_id,title,body,type,ref_table,ref_id}` มาที่นี่ · อ่าน VAPID จาก `notification_settings` (id=1 · service role) + ทุก `push_subscriptions` ของ user แล้ว `web-push` ส่งทีละ endpoint · **404/410 = ลบแถว subscription ทิ้ง** (หมดอายุ) · error อื่น (401 VAPID ผิด/403/413/429) log ดัง + ตอบ 502 เมื่อไม่ส่งได้เลย · `routeFor(ref_table)` ต้อง mirror `NOTIF_ROUTE` ใน App.jsx · **2026-09-08: ส่งด้วย `{ TTL: 3600, urgency: 'high' }`** — Android Doze ปลุกเครื่องให้เฉพาะ high-priority (feedback Samsung "เปิดแล้วไม่เคยเด้ง") + TTL 1 ชม. กัน MO เก่าเด้งเป็นกองตอนเครื่องกลับมาออนไลน์ · **ต้อง deploy ใหม่หลังแก้นี้** (ไฟล์ ~5 KB deploy ผ่าน MCP ได้ แล้ว `get_edge_function` ดึงกลับเทียบ `TTL: 3600`) · ฝั่งเว็บ/กฎสถานะ subscription ดู `docs/modules/deploy.md` §Web Push |
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
> **⚠️ แต่ user ไม่มี CLI (2026-09-07 — ก๊อปคำสั่ง `supabase functions deploy` ไปวางใน SQL Editor แล้วได้ 42601)**
> → ห้ามส่งคำสั่ง CLI ให้ user ทำ · ทางเดียวที่มีคือ **deploy ผ่าน MCP โดย AI session** แล้ว `get_edge_function`
> ดึงกลับมาเทียบกับ repo ให้ครบทุกจุดที่แก้ก่อนถือว่าเสร็จ · ไฟล์ ≤ ~30 KB ยอมรับได้ (send-mtn 25 KB deploy ผ่าน MCP แล้ว v17)
> · ไฟล์ 56 KB (`send-notification`) ยังเสี่ยง — แตกไฟล์ก่อนถ้าต้องแก้
> · deploy ผ่าน MCP แล้ว **ต้องดึงกลับมาตรวจว่าโครงสร้างครบทุกจุดที่ตั้งใจแก้** ก่อนถือว่าเสร็จ

---

### 🔴 audit รอบ 11 (2026-09-07) — edge functions ที่กลืน error + token ฝังในซอร์ส
- **`cleanup-orphan-photos`** (Main · bucket `employee-photos` = รูปพนักงาน + ผังไลน์ `layouts/` + ผังรวมโรงงาน `factory/`):
  - **คิวรี whitelist `factory_map` ไม่เช็ค error** → ถ้าคิวรีล้ม `fmaps=undefined` แล้วโค้ดเดินต่อ = รูปผังรวมโรงงานทุกไฟล์ที่เก่ากว่า 24 ชม. ถูกนับเป็นกำพร้าและ**ถูกลบจริง** · แก้ให้ throw เหมือน employees/line_layouts
  - **token เคยฝังในซอร์ส** (`const CLEANUP_TOKEN = '56ef…'` อยู่ใน git history) → เปลี่ยนเป็น `Deno.env.get('CLEANUP_TOKEN')` · ไม่ตั้ง = ตอบ 503 ทุกคำขอ (fail-closed)
    **ก่อน deploy ใหม่ต้องตั้ง secret:** `supabase secrets set CLEANUP_TOKEN=<สุ่มใหม่ 48 hex> --project-ref ewhdfqwfwofivojtsizn` · **token เดิมถือว่ารั่วแล้ว ห้ามใช้ซ้ำ**
  - กฎ: ตัวเก็บกวาดที่ "ลบของจริง" ต้อง fail-closed ทุกขั้น — whitelist ล้ม = หยุด ไม่ใช่ลบต่อ · เพิ่มตาราง/โฟลเดอร์ใหม่ที่เก็บใน bucket นี้ต้องมาเติม whitelist ที่นี่ (writers ตอนนี้: operator.jsx · LineSetup.jsx · FactoryMap.jsx — `avatars` แยก bucket โดยเจตนา)
- **`downtime-open-scan`**: stamp `open_alerted_at` ไม่เช็คผล → ล้มเงียบ = รายการเดิมถูกแจ้งซ้ำทุกรอบ 5 นาทีจนกว่าจะปิด · ตอนนี้ log ทั้ง stamp ล้มและ notify ตอบไม่ ok
- **`mtn-daily-summary`**: `fetch(...).catch(() => null)` → Telegram ส่งไม่ออกทั้งวันไม่มีร่องรอย · ตอนนี้ log status/body เมื่อไม่ ok
- **in-app `notifications` insert ใน 5 functions** (`send-notification` ×2 · `send-store-notification` · `send-mtn-notification` · `send-cqi15-notification` ×3): เดิม `try { await supabase.from('notifications').insert(...) } catch {}` — **supabase-js ไม่ throw** จึงไม่มีวันจับ · เปลี่ยนเป็นอ่าน `{ error }` แล้ว log
- ✅ **deploy แล้ว 2026-09-07** ทั้ง 7 ตัว (ผ่าน MCP · verify_jwt=false เท่าเดิม): MAIN cleanup-orphan-photos v10 · mtn-daily-summary v11 · send-notification v47 · send-store-notification v4 · send-mtn-notification v17 · send-cqi15-notification v13 · DR downtime-open-scan v3 · secret `CLEANUP_TOKEN` ตั้งแล้ว (user ตั้งเองในจอ Secrets) — ทดสอบผ่าน pg_net: ไม่ใส่ token → 401 · token เก่าที่รั่ว → 401 (ไม่ใช่ 503) ✔ · ลืม token = ตั้งค่าใหม่ในจอ Secrets ได้ทุกเมื่อ ไม่มีอะไรพัง
- ✅ **deploy 2026-09-09** (งาน "ใบกองที่ขั้น 6 รอรับมอบ" — ดู `docs/modules/mtn-work-order.md`): **send-mtn-notification v18** · **mtn-daily-summary v12**
- ✅ **deploy 2026-09-16: `mtn-daily-summary` v15** — เพิ่มบล็อก 📥 "ใบที่รอฝ่ายผู้แจ้งดำเนินการ" (ขั้น 4/6/7) แยกรายส่วนงาน
  · ตรวจกลับด้วย `get_edge_function` แล้วอ่านซอร์สที่ deploy ครบถ้วน (ยิงทดสอบตรงๆ ไม่ได้ — มันส่งสรุปเข้ากลุ่มจริง รอ cron 09:00)
  · **ก่อนวางโค้ดเข้า MCP ให้ `npx esbuild <ไฟล์> --bundle --external:https://* --format=esm --outfile=/dev/null`** = ด่านไวยากรณ์ในเครื่อง (ไม่มี deno ในคอนเทนเนอร์นี้)
  ทั้งคู่แยกกลุ่ม `checked` ตาม `quality_related` (เกี่ยวกับคุณภาพ → รอ QA ขั้น 5 · ไม่เกี่ยว → รอฝ่ายที่แจ้งรับมอบ ขั้น 6)
  **ตรรกะนี้ถูกเขียนซ้ำแบบย่อในทั้ง 2 ไฟล์** เพราะ edge import จาก `src/` ไม่ได้ — source of truth คือ `moStatusLabel()`/`isWaitingQa()` ใน `src/utils/mtnStepPerm.js` · **แก้ที่นั่นแล้วต้องตามมาแก้ 2 ไฟล์นี้เสมอ** (convention เดียวกับ `src/utils/dieStatus.js`)
  smoke test หลัง deploy: `net.http_post` body `{}` → send-mtn-notification ตอบ `400 {"error":"missing mo"}` = บูตได้ ไม่มีผลข้างเคียง (mtn-daily-summary ทดสอบแบบนี้ไม่ได้ — ยิงแล้วมันส่งสรุปเข้ากลุ่มจริง)
