/* ══ 🔬 ทะเบียนแจ้งเตือน "ใบซ่อมที่รอ QA ตรวจคุณภาพ (ขั้น 5)" — สรุปเช้า 09:00 (2026-09-25) ══
 *
 * ช่องว่างที่ปิด (วัดจริง 25/09 · ใบค้างขั้น `checked` 168 ใบ):
 *   **160 ใบรอ QA** (`quality_related='เกี่ยวกับคุณภาพ'` · `qa_at` ว่างทั้งหมด)
 *   `REPORTER_WAIT` ในสรุปเช้า **จงใจไม่รวม `checked_qa`** (ถูกแล้ว — รอ QA ไม่ใช่รอผู้แจ้ง)
 *   แต่ **ไม่มีบล็อกไหนส่งต่อให้ QA เลย** ⇒ ใบกองเงียบ ไม่มีใครถูกเตือน
 *
 * ตั้งค่าให้เหมือน `mtn_accept_pending` (ตัวพี่ของมันฝั่งช่าง):
 *   · `inapp_match_section` + `inapp_scope_strict` = ยิงเฉพาะ QA ของส่วนงานนั้น ไม่กวนทั้งโรงงาน
 *     (จำเป็นมากกับเรื่องนี้ — QA อ่านกระดิ่งแค่ 0.6% แล้ว ยิงกว้างอีกคือฝังกลบ)
 *   · `manager` ติดไปด้วยเพื่อให้ใบที่กองนานมีคนเห็นเหนือหัวหน้างาน
 * ⚠️ `on conflict` **ไม่แตะ** `is_enabled`/`inapp_roles`/`channel_ids` — ถ้า admin ปรับเองไว้แล้ว
 *    รัน migration ซ้ำต้องไม่ไปทับการตั้งค่าของเขา (กฎเดียวกับ mtn_accept_pending 24/09)
 *
 * ย้อนกลับ: `delete from notification_rules where event_key='mtn_qa_pending';`
 *   (ปิดเฉยๆ ก็ได้ — edge `mtn-daily-summary` เช็ค resolveEvent แล้วข้ามบล็อกทั้งก้อน)
 * ปลายทาง: **Main (MAIN · ewhdfqwfwofivojtsizn)**
 * ══════════════════════════════════════════════════════════════════════════════════ */

insert into public.notification_rules
  (event_key, label, category, sort_order, is_enabled,
   inapp_roles, inapp_match_section, inapp_scope_strict, link)
values
  ('mtn_qa_pending', 'ใบซ่อมที่รอ QA ตรวจคุณภาพ (ขั้น 5) — สรุปเช้า 09:00', 'maintenance', 39, true,
   array['qa', 'manager']::text[], true, true, '/mtn-repair')
on conflict (event_key) do update
  set label = excluded.label,
      category = excluded.category,
      sort_order = excluded.sort_order,
      inapp_match_section = excluded.inapp_match_section,
      inapp_scope_strict = excluded.inapp_scope_strict,
      link = coalesce(public.notification_rules.link, excluded.link);
