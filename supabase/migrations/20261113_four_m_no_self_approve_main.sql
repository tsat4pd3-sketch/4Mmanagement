-- ════════════════════════════════════════════════════════════════════════════
-- Main project ("MAIN" · ewhdfqwfwofivojtsizn) — 2026-11-13 · คำสั่ง user (อุดความเสี่ยงช่องเซ็น ข้อ 3)
-- 🔴 ใบ 4M: ห้ามอนุมัติใบที่ตัวเองเปิด · ห้ามคนเดียวกันเซ็นทั้งขั้น SV และขั้น QA
--
-- ต่อยอด `protect_four_m_status()` (20261012b) — เพิ่มเฉพาะ 2 เงื่อนไขในข้อ ② / ③ ที่เหลือเหมือนเดิมทุกตัวอักษร
--   ② pending → pending_qa|approved : ผู้กด (auth.uid()) ต้องไม่ใช่ `created_by`
--   ③ pending_qa → approved         : ผู้กด ต้องไม่ใช่ `created_by` และไม่ใช่ `sv_approved_by`
-- · ใบที่ `requires_qa=false` ขั้น SV เขียน approved_by = SV เอง (ออกแบบไว้) ⇒ ไม่เข้าข่าย "SV = QA"
-- · `created_by` ว่าง (ใบระบบ/ใบเก่า) = ไม่มีใครเป็นเจ้าของ ⇒ ไม่บล็อก
-- · ตีกลับ/รีเซ็ต ไม่เปลี่ยน (ตีกลับใบตัวเองได้ = ไม่ใช่การรับรอง)
-- · service role / admin bypass เหมือนเดิม (ด่านจอบล็อก admin ด้วย — ฐานเปิดไว้ให้ admin แก้ข้อมูล)
-- จำลองกับข้อมูลจริง 13/11: ใบที่ค้างอยู่ตอนนี้และจะถูกล็อกเจ้าของ = ดูคิวรีท้ายไฟล์
-- ย้อนกลับ: รัน 20261012b อีกรอบ (create or replace ฟังก์ชันเดิม)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.protect_four_m_status()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_appr_touched boolean;
begin
  -- ไม่มี JWT = service role / pg_cron / edge function (daily-4m-summary, send-notification) / migration
  if auth.uid() is null then
    return new;
  end if;
  if current_user_role() is not distinct from 'admin'::user_role then
    return new;
  end if;

  -- "คอลัมน์ของการอนุมัติ" — ห้ามแตะถ้าไม่มีคีย์ แม้สถานะไม่ขยับ (กันย้อนวันอนุมัติ/สวมชื่อผู้อนุมัติ)
  v_appr_touched :=
       new.sv_approved_by is distinct from old.sv_approved_by
    or new.sv_approved_at is distinct from old.sv_approved_at
    or new.approved_by    is distinct from old.approved_by
    or new.approved_at    is distinct from old.approved_at
    or new.reject_reason  is distinct from old.reject_reason
    or new.qa_image_url   is distinct from old.qa_image_url;

  -- แก้เนื้อใบอย่างเดียว (คำบรรยาย/รูปคำขอ) = ปล่อย — ไม่ใช่การเดินสถานะ
  if new.status is not distinct from old.status and not v_appr_touched then
    return new;
  end if;

  -- ① แนบเอกสารแล้วส่งเข้าคิว (pending_doc → pending) = "ยื่นเรื่อง" ไม่ใช่ "อนุมัติ"
  if old.status = 'pending_doc' and new.status = 'pending' then
    if v_appr_touched then
      raise exception '4M: attaching a document cannot set approval fields';
    end if;
    return new;
  end if;

  -- ② ขั้นหัวหน้า: pending → pending_qa (ต้องส่ง QA) หรือ → approved (ใบที่ไม่ต้อง QA)
  if old.status = 'pending' and new.status in ('pending_qa', 'approved') then
    if not (select public.has_perm('four_m:approve_sv')) then
      raise exception '4M: supervisor approval requires four_m:approve_sv';
    end if;
    if old.created_by is not null and old.created_by = auth.uid() then
      raise exception '4M: cannot approve a 4M log you created';
    end if;
    return new;
  end if;

  -- ③ ขั้น QA: pending_qa → approved
  if old.status = 'pending_qa' and new.status = 'approved' then
    if not (select public.has_perm('four_m:approve_qa')) then
      raise exception '4M: QA approval requires four_m:approve_qa';
    end if;
    if old.created_by is not null and old.created_by = auth.uid() then
      raise exception '4M: cannot approve a 4M log you created';
    end if;
    if old.sv_approved_by is not null and old.sv_approved_by = auth.uid() then
      raise exception '4M: the supervisor who approved this log cannot also approve it as QA';
    end if;
    return new;
  end if;

  -- ④ ปฏิเสธ — ขั้นไหนก็ได้ที่ผู้อนุมัติขั้นนั้นถืออยู่
  if new.status = 'rejected' then
    if not ((select public.has_perm('four_m:approve_sv')) or (select public.has_perm('four_m:approve_qa'))) then
      raise exception '4M: reject requires four_m:approve_sv or four_m:approve_qa';
    end if;
    return new;
  end if;

  -- ⑤ รีเซ็ตกลับเข้าคิว (approved/rejected/pending_qa → pending) = คีย์ reset เท่านั้น
  if new.status = 'pending' then
    if not (select public.has_perm('four_m:reset')) then
      raise exception '4M: reset to pending requires four_m:reset';
    end if;
    return new;
  end if;

  raise exception '4M: status change % -> % is not an allowed transition', old.status, new.status;
end;
$function$;

-- ── ตรวจกลับ ────────────────────────────────────────────────────────────────
-- select position('cannot approve a 4M log you created' in pg_get_functiondef('public.protect_four_m_status'::regproc)) > 0 as installed;
-- ใบค้างที่เจ้าของใบจะกดเองไม่ได้แล้ว:
-- select status, count(*) from four_m_logs where status in ('pending','pending_qa') and created_by is not null group by 1;
