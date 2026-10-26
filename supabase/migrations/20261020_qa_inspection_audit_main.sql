-- MAIN (ewhdfqwfwofivojtsizn · ชื่อในจอ Supabase "MAIN") · 2026-10-20 · คำสั่ง user "ทำ audit trigger ตารางใบตรวจต่อเลย"
-- เหตุ: ตารางคุณภาพที่หน้างานเริ่มใช้จริงไม่มี audit เลย — แก้/ลบผลตรวจ ใบ NCR/CAPA แล้วสืบไม่ได้ว่าใคร/ค่าเดิมอะไร
--       และคอลัมน์ *_uid ของ "คนบันทึก" ไม่เคยถูกเติม (โค้ดส่งแต่ชื่อ)
-- 📄 docs/modules/traceability-audit-log.md · docs/modules/qa-inspection.md
--
-- ① fn_audit() (INSERT/UPDATE/DELETE) — ตารางที่คนเขียนจากจอ
-- ② fn_audit_manual_only() — qa_fme_obligations: edge `qa-fme-scan` (service role) สร้าง/อัปเดตตัวนับแจ้งเตือนถี่
--    ⇒ log เฉพาะตอนคนกดในแอป (รับงาน/ยกเลิก) ไม่ log งานระบบ (หลักเดียวกับ employee_skills)
-- ③ default auth.uid() ที่คอลัมน์ "คนบันทึก/คนสร้าง" — คนกดบันทึก = คนเดียวกับคอลัมน์นั้นจริง
--    (ไม่ใส่ที่ inspector_uid/closed_by_uid/action_by_uid/disposition_by_uid — พวกนั้นเป็น "คนที่ถูกเลือก" อาจไม่ใช่คนกด)
--    default ทำงานเฉพาะตอน INSERT ที่ไม่ส่งค่ามา · โค้ดที่ส่งค่ามาเองยังชนะ · anon/service = null เหมือนเดิม
--
-- ปลอดภัย: fn_audit มี `exception when others then null` — audit ล้มไม่ทำให้ write หลักพัง
-- rollback: drop trigger if exists trg_audit on public.<table>;
--           alter table public.<table> alter column <col> drop default;

do $$
declare t text;
begin
  foreach t in array array[
    'qa_inspection_sheets','qa_inspection_results','qa_inspection_pieces','qa_inspection_actions',
    'qa_inspection_items','qa_part_drawings','qa_ncr','qa_capa','qa_measurements',
    'qa_fme_config','qa_fme_part_rules'
  ] loop
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I
                    for each row execute function public.fn_audit()', t);
  end loop;
end $$;

drop trigger if exists trg_audit on public.qa_fme_obligations;
create trigger trg_audit after insert or update or delete on public.qa_fme_obligations
  for each row execute function public.fn_audit_manual_only();

alter table public.qa_inspection_sheets  alter column created_by_uid  set default auth.uid();
alter table public.qa_inspection_results alter column recorded_by_uid set default auth.uid();
alter table public.qa_inspection_pieces  alter column recorded_by_uid set default auth.uid();
alter table public.qa_inspection_actions alter column recorded_by_uid set default auth.uid();
alter table public.qa_ncr                alter column created_by_uid  set default auth.uid();
alter table public.qa_capa               alter column created_by_uid  set default auth.uid();
alter table public.qa_measurements       alter column created_by_uid  set default auth.uid();
alter table public.qa_customer_claims    alter column created_by_uid  set default auth.uid();
alter table public.qa_parts              alter column created_by_uid  set default auth.uid();
alter table public.qa_characteristics    alter column created_by_uid  set default auth.uid();
