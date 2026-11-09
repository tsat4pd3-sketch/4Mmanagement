/* 🔔 ผลตรวจอุปกรณ์ (PM/AM) — บีบผู้รับให้เหลือ "ส่วนงานของอุปกรณ์" + ยุบใบรัว  (MAIN · 2026-11-09)

   เหตุ: user แจ้งว่า "ยังมีการแจ้งเตือนมั่วแผนก"
   วัดจริง 30 วัน — `pm_inspection_ng` 1 ใบยิงถึง **83 คน ข้าม 12 ส่วนงาน** อ่าน 4%
   ต้นเหตุ 2 ชั้น:
     ① ฝั่งโค้ด `src/lib/pmNotify.js` เดิมดึง profiles ด้วย `role` ล้วน ไม่ผ่าน `notify_recipients`
        ⇒ ค่าที่ตั้งในทะเบียนนี้ "ไม่มีผล" เลย (แก้ในคอมมิทเดียวกัน — ตอนนี้ยิงผ่าน edge กลาง)
     ② ทะเบียนเองก็ไม่ได้บีบ: `inapp_match_section=false` + `inapp_scope_strict=false`

   ผู้รับหลังแก้ = **ทีมเจ้าของอุปกรณ์ + หัวหน้าส่วนงานนั้น** (คำสั่ง user 09/11)
     · หัวหน้าส่วนงาน ← ทะเบียนนี้ (`inapp_match_section` + `scope_strict`)
     · ช่างของทีม      ← `extra_user_ids` ฝั่งโค้ด (แกน "ทีม" กับ "ส่วนงาน" ใน notify_recipients
                          เป็น AND ⇒ ส่ง p_team ไปจะตัดหัวหน้าทิ้ง · 📄 pmNotify.js)
   วัดหลังแก้: PD3 + jig = **24 คน** (จาก 83)

   ย้อนกลับ: SQL ท้ายไฟล์ */
update notification_rules
   set inapp_roles        = array['mtn','supervisor','manager'],
       inapp_match_section = true,
       inapp_scope_strict  = true,
       inapp_rollup_min    = 60,
       link                = coalesce(link, '/pm?tab=check'),
       updated_at          = now()
 where event_key = 'pm_inspection_ng';

/* ใบที่ "ผ่าน" ไม่ด่วน ⇒ ยุบยาวกว่า NG (3 ชม.) */
update notification_rules
   set inapp_roles        = array['mtn','supervisor','manager'],
       inapp_match_section = true,
       inapp_scope_strict  = true,
       inapp_rollup_min    = 180,
       link                = coalesce(link, '/pm?tab=check'),
       updated_at          = now()
 where event_key = 'pm_inspection_approved';

/* ═══ ย้อนกลับ (MAIN) ═══════════════════════════════════════════
update notification_rules
   set inapp_match_section = false, inapp_scope_strict = false, inapp_rollup_min = null
 where event_key in ('pm_inspection_ng','pm_inspection_approved');
   ═══════════════════════════════════════════════════════════════ */
