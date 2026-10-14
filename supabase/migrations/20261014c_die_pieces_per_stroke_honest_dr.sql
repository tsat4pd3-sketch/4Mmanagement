-- ═══════════════════════════════════════════════════════════════════════════════
-- "ชิ้น/จังหวะ" ของแม่พิมพ์ — เลิกเดาเป็น 1   · project: DR "Product DB" (eyhclzkifitbhbljgoav)
-- คำสั่ง user 2026-10-14: "มันก็ควรจะนับ shot นะ ไม่ใช่นับชิ้น สำหรับงานคู่"
-- ═══════════════════════════════════════════════════════════════════════════════
-- ปัญหาที่วัดได้ก่อนแก้:
--   die_sets.pieces_per_stroke      not null default 1  → 92/92 แถว = 1 (ค่า default ล้วน)
--   equipment_die.pieces_per_stroke nullable            → 264/264 แถว = null
--   equipment_die.shot_total                            → 0 ทุกแถว
--
-- ⇒ ระบบ "ประกาศ" ว่าแม่พิมพ์ทุกตัวปั๊มได้ 1 ชิ้น/จังหวะ ทั้งที่ไม่มีใครเคยกรอก
--   และ DieRegistry.saveSet บีบ `numOrNull(...) ?? 1` ทุกครั้งที่เซฟ
--   ⇒ เลข 1 ที่เห็นอยู่ **ไม่มีแถวไหนเป็นคำยืนยันของคน** ยุบเป็น null ได้ทั้งก้อน
--
-- ทำไมถึงอันตราย: งานคู่ LH/RH ปั๊มทีเดียวได้ 2 ชิ้น
--   แม่พิมพ์สเปค "ทน 50,000 shot" ถ้าระบบคิดว่า 1 ชิ้น = 1 shot
--   → PM จะเด้งตอนผลิตครบ 50,000 ชิ้น = 25,000 shot จริง = **ช้าไป 2 เท่า** แม่พิมพ์พังก่อนถึงคิว
--
-- blast radius: ไม่มีแผน PM แบบ usage สักใบ (pm_plans: 165 แถว plan_type='time' ทั้งหมด,
--   usage_threshold ว่างทุกใบ) ⇒ วันนี้ไม่มีตัวเลขไหนบนจอเปลี่ยน
--   เปลี่ยนแค่: ป้ายในทะเบียนแม่พิมพ์ขึ้น "ยังไม่ระบุ ชิ้น/stroke" (เหลือง) แทนการเงียบ
--
-- rollback (ย้อนได้เต็ม — เลขเดิมเป็น default ล้วน):
--   update public.die_sets set pieces_per_stroke = 1 where pieces_per_stroke is null;
--   alter table public.die_sets alter column pieces_per_stroke set default 1;
--   alter table public.die_sets alter column pieces_per_stroke set not null;
-- ═══════════════════════════════════════════════════════════════════════════════

alter table public.die_sets alter column pieces_per_stroke drop not null;
alter table public.die_sets alter column pieces_per_stroke drop default;

-- เลข 1 ที่มีอยู่เกิดจาก default + การบีบค่าฝั่งจอ ไม่ใช่คำตอบของหน้างาน → คืนสภาพ "ยังไม่รู้"
update public.die_sets set pieces_per_stroke = null where pieces_per_stroke = 1;

comment on column public.die_sets.pieces_per_stroke is
  '1 stroke ได้กี่ชิ้น (งานคู่ LH/RH = 2) · null = ยังไม่รู้ ห้ามเดาเป็น 1 — '
  'อ่านผ่าน ppsOf() ใน src/utils/pmUsage.js เท่านั้น (ชั้น equipment_die ว่าง = ถอยมาใช้ค่าชั้นนี้)';

comment on column public.equipment_die.pieces_per_stroke is
  'ชิ้น/stroke เฉพาะ OP นี้ · null = ใช้ค่าของชุด (die_sets) · ทั้ง 2 ชั้นว่าง = ยังไม่รู้ '
  'จอต้องเขียนบอก ห้ามคิด shot ต่อ — ppsOf() ใน src/utils/pmUsage.js';
