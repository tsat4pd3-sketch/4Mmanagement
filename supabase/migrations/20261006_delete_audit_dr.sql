-- ══ B2: บันทึกการลบ (DELETE) ของตารางงาน/ประวัติฝั่ง DR ("Product DB" · eyhclzkifitbhbljgoav) ══
-- 2026-10-06 · user อนุมัติ "ทำข้อ 5" (DB audit ชุด B)
--
-- ปัญหา: supabaseDR = anon เสมอ ⇒ ใครถือ anon key ก็ลบแถวได้ และตารางงานเหล่านี้ไม่มี trigger audit
--        ⇒ ลบแล้วไม่เหลือร่องรอยเลยว่าแถวเดิมมีอะไร (ตารางทะเบียน 68 ตัวมี fn_audit ครบแล้ว — ไม่แตะ)
-- ทำ: ผูก `fn_audit()` ตัวเดิม (best-effort · audit ล้มไม่ทำให้การลบล้ม) เฉพาะ AFTER DELETE
--     ⇒ เก็บ old_data ทั้งแถวใน audit_log · INSERT/UPDATE ไม่บันทึก (ไม่เพิ่มภาระตารางที่เขียนถี่)
-- ข้อจำกัดเดิมของ DR: actor = updated_by_name ของแถว (คนแก้ล่าสุด ไม่ใช่คนกดลบ) · ไม่มีคอลัมน์ = null
-- ไม่รวม (ตั้งใจ): ตารางที่ระบบลบ-สร้างใหม่ทั้งก้อนเป็นปกติ (customer_forecasts · *_alerts ·
--   child_demand_accumulator · ตัวนับ mtn_mo_counter/mtn_mo_seq) — บันทึกไปก็เป็นขยะเต็ม audit_log
--   และตารางที่ anon ลบไม่ได้อยู่แล้ว (revoke 06/10 · 20261006_revoke_delete_history_dr.sql)
-- ภาระ: วัดจาก pg_stat ตลอดอายุตาราง ≈ 4,000 แถวที่ถูกลบ · audit_log มี retention 6 เดือนอยู่แล้ว
--
-- ย้อนกลับ (ไม่กระทบข้อมูล): ต่อตาราง  drop trigger if exists trg_audit_delete on public.<ตาราง>;

set lock_timeout = '3s';
do $$
declare t text; ok int := 0; skipped text[] := '{}';
begin
  foreach t in array array[
    'prod_orders','downtime_logs','defect_logs','inspections','jig_images',
    'mtn_orders','mtn_order_labor','mtn_spare_usage_monthly','bom_items',
    'scrap_reports','scrap_report_items','material_requests','material_request_items',
    'improvements','improvement_milestones','pm_coordination_plans','pm_coordination_tasks',
    'pm_plan_reminders','pm_plan_deferrals','pm_facility_points','facility_supply_links',
    'demand_upload_batches','customer_pull_batches','customer_pull_rounds','customer_pull_formats',
    'kanban_deliveries','kanban_delivery_rounds','kanban_scans','kanban_calc_params',
    'production_plan_lots','production_shots','rack_requests','packaging_withdrawal_requests',
    'lot_post_events','lot_post_accumulations','wip_adjustments',
    'transport_round_stops','transport_round_assignments','transport_edges','transport_nodes',
    'transport_vehicles','transport_carriers','transport_settings',
    'event_comments','break_policies','capacity_shift_patterns','internal_delivery_sla',
    'ct_proposals','user_signatures','vsm_maps','pm_org_nodes','tasks','guests'
  ] loop
    if to_regclass('public.' || t) is null then skipped := skipped || (t || ':ไม่มีตาราง'); continue; end if;
    if exists (select 1 from pg_trigger g join pg_proc p on p.oid = g.tgfoid
               where g.tgrelid = ('public.' || t)::regclass and p.proname = 'fn_audit' and not g.tgisinternal) then
      skipped := skipped || (t || ':มี audit แล้ว'); continue;
    end if;
    begin
      execute format('create trigger trg_audit_delete after delete on public.%I for each row execute function public.fn_audit()', t);
      ok := ok + 1;
    exception when others then skipped := skipped || (t || ':' || sqlerrm);
    end;
  end loop;
  raise notice 'trg_audit_delete: ผูกแล้ว % ตาราง · ข้าม %', ok, skipped;
end $$;
reset lock_timeout;

-- ตรวจผล: ต้องได้ 53 แถว (ลบตารางที่ไม่มีจริงออก)
--   select event_object_table from information_schema.triggers
--   where trigger_name = 'trg_audit_delete' order by 1;
