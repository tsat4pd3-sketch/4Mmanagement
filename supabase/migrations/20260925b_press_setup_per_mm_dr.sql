-- ⏱️ เวลาเปลี่ยนรุ่นงานปั๊ม — อัตราต่อมิลลิเมตร (DR "Product DB" · eyhclzkifitbhbljgoav · 2026-09-25)
--
-- คำตอบจากช่างปั๊ม (user 2026-09-25): **"1mm = 1sec"**
--   ⇒ ผลของความสูงเป็น **อัตราเชิงเส้น** ไม่ใช่ขั้นบันได (ตอนตั้งโครงเมื่อเช้าเดายังไม่ได้ เลยทำ
--     height_steps ไว้ก่อน) · ของจริงคือ |Δ die height| × 1 วินาที
--   ⇒ เพิ่ม `per_mm_sec` = วินาทีที่บวกเพิ่มต่อ 1 มม. ของผลต่างความสูง
--   · `height_steps` **คงไว้** (ยังใช้ได้เมื่อวันหน้ามีเงื่อนไขแบบขั้น เช่น "เกิน 200 มม. ต้องเปลี่ยนบล็อก
--     +30 นาที") — คิดรวมกับอัตราต่อมม. ใน src/utils/pressSetup.js
--
-- 🔴 base_min / same_die_min เปลี่ยนเป็น **nullable ไม่มี default**
--   เพราะ user ตอบมาแค่ส่วนของความสูง (ข้ออื่น "ไว้ก่อนไม่มีผล") ⇒ เวลาฐานยก-ลงแม่พิมพ์ **ยังไม่รู้**
--   `not null default 0` = ระบบจะตอบ "เปลี่ยนแม่พิมพ์ใช้เวลา 0 นาที" ซึ่งเป็นการโกหกที่ดูน่าเชื่อ
--   ⇒ null = "ยังไม่รู้" · pressSetup.js คืน state 'no_base' และจอต้องเขียนว่ารวมเวลาฐานไม่ได้
--   ⭐ แต่ **การเทียบว่าลำดับไหนดีกว่า ยังทำได้ทันที** — ลำดับที่สลับกันบนของชุดเดิมมีจำนวนครั้ง
--      เปลี่ยนแม่พิมพ์เท่ากัน ⇒ เวลาฐานหักกลบหายไปจากผลต่าง เหลือแต่ส่วนที่ขึ้นกับความสูง (varMin)
--
-- 🔙 rollback:
--   alter table press_setup_rules drop column if exists per_mm_sec;
--   -- (จะคืน not null default 0 ก็ได้ แต่ไม่แนะนำ — ดูเหตุผลข้างบน)
--   update press_setup_rules set base_min = 0 where base_min is null;
--   alter table press_setup_rules alter column base_min set default 0, alter column base_min set not null;
--   alter table press_setup_rules alter column same_die_min set default 0, alter column same_die_min set not null;

alter table press_setup_rules add column if not exists per_mm_sec numeric;
comment on column press_setup_rules.per_mm_sec is
  'วินาทีที่บวกเพิ่มต่อ 1 มม. ของ |Δ die height| (ช่างปั๊ม 2026-09-25: 1mm = 1sec) · null = ยังไม่รู้ผลของความสูง — ห้ามตีเป็น 0';

-- เวลาฐาน / ตัวเดิมเปลี่ยนล็อต: null = "ยังไม่รู้" (ห้าม default 0 — ดูหัวไฟล์)
alter table press_setup_rules alter column base_min     drop not null;
alter table press_setup_rules alter column base_min     drop default;
alter table press_setup_rules alter column same_die_min drop not null;
alter table press_setup_rules alter column same_die_min drop default;
comment on column press_setup_rules.base_min is
  'เวลาฐานเปลี่ยนเป็นแม่พิมพ์คนละตัว (นาที) — ยกลง/ยกขึ้น/จูน · null = ยังไม่ได้ถามช่าง (จอต้องบอกว่ารวมเวลาไม่ได้ แต่ยังเทียบลำดับได้)';
comment on column press_setup_rules.same_die_min is
  'แม่พิมพ์ตัวเดิม เปลี่ยนแค่ล็อต/ม้วน (นาที) · null = ยังไม่รู้';

-- ── กฎทั้งโรงงานจากคำตอบช่างปั๊ม: 1 มม. = 1 วินาที ───────────────────────────────────────
-- ใส่เฉพาะส่วนที่ user ยืนยันมา · เวลาฐานปล่อย null ไว้ตามความจริง (ไม่เดาแทนช่าง)
insert into press_setup_rules (scope_kind, scope_value, per_mm_sec, base_min, same_die_min, height_steps, note, updated_by_name)
select 'global', null, 1, null, null, '[]'::jsonb,
       'ช่างปั๊มให้ตัวเลข 2026-09-25: ผลต่างความสูงแม่พิมพ์ 1 มม. = 1 วินาที · เวลาฐานยก-ลงแม่พิมพ์ยังไม่ได้ถาม (null = ยังไม่รู้)',
       'migration 20260925b'
where not exists (select 1 from press_setup_rules where scope_kind = 'global' and is_active);

-- ── เช็คผลหลังรัน ────────────────────────────────────────────────────────────────────
-- select scope_kind, per_mm_sec, base_min, same_die_min, note from press_setup_rules;
