-- ════════════════════════════════════════════════════════════════════════════
-- Main project ("MAIN" · ewhdfqwfwofivojtsizn) — QC audit รอบ 6 (2026-10-12)
-- 🔴 คิวอนุมัติ 4M: ใครล็อกอินก็ตั้ง status='approved' ให้ใบตัวเองได้
--
-- `four_m_logs` มี policy เดียว `Allow authenticated full access four_m` (for all · using true)
-- ⇒ ปุ่มบนจอ gate ด้วย `can('four_m','approve_sv'|'approve_qa'|'reset')` แต่ **REST ตรงไม่ผ่านปุ่ม**
--    = อนุมัติใบของตัวเองได้ · ปิดใบข้ามขั้น QA ได้ · ย้อนวันอนุมัติ/สวมชื่อผู้อนุมัติได้
--    (ลายเซ็นอนุมัติของ 4M คือหลักฐาน IATF ว่าการเปลี่ยน Man/Machine/Method/Material ถูกรับรองแล้ว)
--
-- ── ⚠️ ทำไม "รัด policy UPDATE" ใช้ไม่ได้ที่ตารางนี้ ──────────────────────────
-- policy แยกตาม **คำสั่ง** (UPDATE) ไม่ได้แยกตาม **คอลัมน์** แต่หน้างานมี 2 ความหมายปนกัน:
--   · เดินสถานะ/ลงลายเซ็นอนุมัติ → ต้องมีคีย์
--   · แนบรูปคำขอ/แก้คำบรรยาย   → `Management.jsx:2278` ปุ่ม "แนบเอกสาร" **ไม่มี can() gate**
--     ใครเปิด /management ได้ก็กดได้ (วัดจริง: `page:/management` ถือ 8 role รวม display)
-- รัด UPDATE ด้วยคีย์อนุมัติ = ปุ่มแนบเอกสารพังเงียบ (0 แถว ไม่มี error · กฎเหล็ก DB ข้อ 2)
-- รัดด้วย union ที่รวม `page:/management` = เท่ากับไม่รัด
-- ⇒ **ด่านต้องอยู่ชั้นคอลัมน์ = trigger** (ต้นแบบเดียวกับ `protect_profile_role()`)
--
-- ── ตารางเส้นทางที่อนุญาต (ไล่จากโค้ดจริง ไม่ใช่เดา) ─────────────────────────
--   pending_doc → pending           = แนบเอกสารแล้วส่งเข้าคิว · ไม่ต้องมีคีย์ (ไม่ใช่การอนุมัติ)
--                                     แต่ **ห้ามแตะคอลัมน์อนุมัติพร้อมกัน**
--   pending     → pending_qa        = `Report.handleApprove` ขั้น SV   → `four_m:approve_sv`
--   pending     → approved          = ใบที่ `requires_qa=false`        → `four_m:approve_sv`
--   pending_qa  → approved          = `Report` ขั้น QA                 → `four_m:approve_qa`
--   * → rejected                    = `Report.handleReject`            → approve_sv **or** approve_qa
--   * → pending (รีเซ็ต)             = `Report.jsx:2090` ปุ่มรีเซ็ต      → `four_m:reset`
--   สถานะไม่ขยับ + ไม่แตะคอลัมน์อนุมัติ = ผ่าน (แนบรูป/แก้คำบรรยาย)
--   เส้นทางอื่นทั้งหมด = บล็อก
-- ใครถือคีย์ (วัดจาก role_permissions จริง 12/10):
--   approve_sv = admin · dept_admin · leader · manager · supervisor
--   approve_qa = admin · dept_admin · manager · qa
--   reset      = admin · dept_admin · manager
--
-- 🔴 `auth.uid() is null` = service role / pg_cron / edge function → ผ่านเสมอ
--    (`daily-4m-summary` · `send-notification` ต้องทำงานต่อได้) · admin bypass เหมือน trigger ของ profiles
--
-- ── 🐞 ของที่เจอระหว่างทาง แต่ **ไม่แก้ในไฟล์นี้** (เป็น product decision) ──────
-- CHECK `four_m_logs_status_check` = ANY('pending','pending_qa','approved','rejected')
-- ⇒ **ไม่มี `pending_doc`** แต่ `Management.jsx:696` insert ค่านี้ ⇒ ล้มด้วย `23514` **ทุกครั้ง**
--    (วัดแล้ว: `four_m_logs` ไม่มีแถว pending_doc เลยสักแถว · โค้ดอ่านค่านี้ 3 จุด)
--    ⇒ ใบ 4M Man "ย้ายข้ามไลน์ต้อง OJT" **ไม่เคยถูกสร้าง** — หน้างานเห็น toast แดงแล้วงานหลุดร่องรอย
--    เติมค่าเข้า CHECK = ใบ pending_doc จะไหลเข้าคิว `/report` ทันทีโดยที่จอยังไม่มีป้ายแยก
--    (ขัดกฎ "4M ที่ระบบสร้างเอง ห้ามเข้าคิวอนุมัติเงียบๆ") ⇒ **ต้องแก้จอคู่กัน รอ user ตัดสิน**
--    กฎ ① ในฟังก์ชันนี้เขียนรอไว้แล้ว — วันที่เปิดใช้ ไม่ต้องแก้ trigger อีก
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.protect_four_m_status()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_appr_touched boolean;
begin
  if auth.uid() is null then
    return new;                                   -- service role / edge function / migration
  end if;
  if current_user_role() is not distinct from 'admin'::user_role then
    return new;
  end if;

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

  -- ① แนบเอกสารแล้วส่งเข้าคิว = "ยื่นเรื่อง" ไม่ใช่ "อนุมัติ" (ดูหมายเหตุ CHECK ข้างบน)
  if old.status = 'pending_doc' and new.status = 'pending' then
    if v_appr_touched then
      raise exception '4M: attaching a document cannot set approval fields';
    end if;
    return new;
  end if;

  -- ② ขั้นหัวหน้า
  if old.status = 'pending' and new.status in ('pending_qa', 'approved') then
    if not (select public.has_perm('four_m:approve_sv')) then
      raise exception '4M: supervisor approval requires four_m:approve_sv';
    end if;
    return new;
  end if;

  -- ③ ขั้น QA
  if old.status = 'pending_qa' and new.status = 'approved' then
    if not (select public.has_perm('four_m:approve_qa')) then
      raise exception '4M: QA approval requires four_m:approve_qa';
    end if;
    return new;
  end if;

  -- ④ ปฏิเสธ
  if new.status = 'rejected' then
    if not ((select public.has_perm('four_m:approve_sv')) or (select public.has_perm('four_m:approve_qa'))) then
      raise exception '4M: reject requires four_m:approve_sv or four_m:approve_qa';
    end if;
    return new;
  end if;

  -- ⑤ รีเซ็ตกลับเข้าคิว
  if new.status = 'pending' then
    if not (select public.has_perm('four_m:reset')) then
      raise exception '4M: reset to pending requires four_m:reset';
    end if;
    return new;
  end if;

  raise exception '4M: status change % -> % is not an allowed transition', old.status, new.status;
end;
$function$;

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.four_m_logs'::regclass
                    and tgname = 'trg_protect_four_m_status') then
    create trigger trg_protect_four_m_status before update on public.four_m_logs
      for each row execute function public.protect_four_m_status();
  end if;
end $$;

-- ── ใบ 4M ห้ามลบ (กฎ CLAUDE.md §4M: เคลียร์คิวค้างด้วย `rejected` ห้าม delete) ──
-- ไม่มีจอไหนลบใบ 4M (grep ทั้ง src/ + supabase/functions/ = 0 จุด) ⇒ ด่านนี้กัน **REST ตรง**
-- ไม่ใช่เปิดทางให้ลบ · ใช้ **restrictive** เพื่อ AND กับ policy เดิม (ไม่ต้อง drop ของเดิม
-- ซึ่ง MCP รันไม่ได้อยู่แล้ว — ดู `docs/modules/db-write-rules.md` §ขอบเขตของ MCP)
do $$
begin
  if not exists (select 1 from pg_policy
                  where polrelid = 'public.four_m_logs'::regclass
                    and polname = 'four_m_logs_delete_guard') then
    create policy four_m_logs_delete_guard on public.four_m_logs
      as restrictive for delete to authenticated
      using ((select public.has_perm('four_m:reset')));
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- ตรวจกลับ — วัดจริง 12/10 ด้วย `set_config('request.jwt.claims')` ของ role จริง แล้ว rollback
--   ทั้ง 10 เส้นทางได้ผลตามออกแบบ:
--     1 qa ข้ามไปอนุมัติขั้น SV            = ✅ บล็อก
--     2 document_control อนุมัติรวบ        = ✅ บล็อก
--     3 document_control แก้คำบรรยาย        = ✅ ผ่าน  (ไม่ล็อกเกินจำเป็น)
--     4 document_control แอบใส่ approved_at = ✅ บล็อก (สถานะไม่ขยับก็ไม่ให้แตะ)
--     5 supervisor อนุมัติขั้น SV           = ✅ ผ่าน
--     6 supervisor ปิดขั้น QA เอง           = ✅ บล็อก
--     7 supervisor ปฏิเสธ                   = ✅ ผ่าน
--     8 supervisor รีเซ็ต (ไม่ถือ reset)     = ✅ บล็อก
--     9 manager รีเซ็ต (ถือ four_m:reset)   = ✅ ผ่าน
--    10 qa อนุมัติรวบจาก pending            = ✅ บล็อก
--   · ด่าน DELETE ยืนยันจาก **นิยาม policy** (restrictive = AND) — รัน `delete` ทดสอบผ่าน MCP ไม่ได้
--     เพราะ MCP ค้างกับคำสั่งที่ถูกตีว่าทำลาย (เหมือน `drop`) · แถวทดสอบไม่ค้างในฐาน (ตรวจแล้ว 0 แถว)
--
-- ROLLBACK (คืนสภาพเดิม ไม่เสียข้อมูล)
--   drop trigger if exists trg_protect_four_m_status on public.four_m_logs;
--   drop function if exists public.protect_four_m_status();
--   drop policy  if exists four_m_logs_delete_guard on public.four_m_logs;
-- ════════════════════════════════════════════════════════════════════════════
