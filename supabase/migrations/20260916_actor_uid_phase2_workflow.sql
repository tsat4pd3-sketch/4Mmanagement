-- ══════════════════════════════════════════════════════════════════════════════
-- Actor UID เฟส 2 — คอลัมน์ "ผู้ทำงานแต่ละขั้น" (workflow actor) · 2026-09-16
--
-- เฟส 1 ครอบ "ใครแก้แถวนี้ล่าสุด" (updated_by_uid) ผ่าน wrapper อัตโนมัติแล้ว
-- เฟส 2 นี้ครอบอีกชนิดหนึ่งที่ wrapper ครอบไม่ได้: **คนที่ทำขั้นตอนหนึ่งของงาน**
--   เช่น ใครเปิดกะ · ใครยืนยันใบผลิต · ใครซ่อม · ใครตรวจรับ · ใครอนุมัติ · ใครจ่ายของ
--   คอลัมน์พวกนี้เก็บ "ชื่อคนที่ถูกเลือกจาก picker" ไม่ใช่ "คนที่กดเซฟ" จึงต้อง stamp รายจุด
--
-- 🔴 กฎที่ยึด: เพิ่ม uid **คู่กับ** ชื่อ ไม่แทนที่ ไม่ลบ ไม่เปลี่ยนความหมายคอลัมน์เดิม
--    ชื่อที่เก็บไว้ = snapshot ณ วันที่ทำงาน (ฟอร์มพิมพ์/ใบเซ็นต้องได้ชื่อเดิมเสมอ
--    แม้คนนั้นจะเปลี่ยนชื่อ/ลาออกไปแล้ว) · uid = คีย์ที่ join/นับได้
--
-- ทุกคอลัมน์ nullable ไม่มี default ไม่แตะ RLS ไม่แตะ trigger ไม่แตะข้อมูลเดิม
--   ⇒ โค้ดเก่าที่ยังไม่ส่ง uid ทำงานได้ปกติ (ได้ null) · apply ก่อน deploy โค้ดได้ปลอดภัย
--
-- ⚠️ ไฟล์นี้มี 2 ส่วน — **รันคนละ project**
--    ส่วน A = DR project  `eyhclzkifitbhbljgoav`  (ชื่อในจอ Supabase: "Product DB")
--    ส่วน B = Main project `ewhdfqwfwofivojtsizn`  (ชื่อในจอ Supabase: "MAIN")
--    รันผิดฝั่ง = 42P01 relation does not exist (ตาราง 2 ฝั่งชื่อคล้ายกัน ระวัง)
--
-- Rollback: คอลัมน์ nullable ที่ไม่มีใครเขียน ไม่รบกวนอะไร — แนะนำปล่อยไว้ ไม่ต้อง drop
--   ถ้าจะ drop จริง ให้ revert โค้ดฝั่ง client ก่อนเสมอ
-- ══════════════════════════════════════════════════════════════════════════════


-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║ ส่วน A — DR project (eyhclzkifitbhbljgoav · "Product DB")                  ║
-- ╚════════════════════════════════════════════════════════════════════════════╝
do $$
declare r record;
  -- (ตาราง, คอลัมน์ชื่อเดิม, คอลัมน์ uid ที่จะเพิ่ม)
  m text[][] := array[
    -- ผลิต
    ['production_sessions','opened_by_name','opened_by_uid'],
    ['production_sessions','closed_by_name','closed_by_uid'],
    ['production_sessions','close_requested_by_name','close_requested_by_uid'],
    ['production_sessions','close_reject_by_name','close_reject_by_uid'],
    ['prod_orders','opened_by','opened_by_uid'],
    ['prod_orders','confirmed_by','confirmed_by_uid'],
    ['prod_orders','reopened_by','reopened_by_uid'],
    ['prod_order_qty_updates','logged_by','logged_by_uid'],
    ['downtime_logs','reported_by_name','reported_by_uid'],
    ['downtime_logs','call_mtn_by','call_mtn_by_uid'],
    ['downtime_logs','fix_by','fix_by_uid'],
    ['downtime_logs','followup_by','followup_by_uid'],
    ['defect_logs','reported_by_name','reported_by_uid'],
    ['defect_logs','fix_by','fix_by_uid'],
    ['defect_logs','followup_by','followup_by_uid'],
    -- ซ่อมบำรุง (ใบ MO 7 ขั้น — ขั้นละคน)
    ['mtn_orders','reported_by_name','reported_by_uid'],
    ['mtn_orders','reporter_prod','reporter_prod_uid'],
    ['mtn_orders','reporter_qa','reporter_qa_uid'],
    ['mtn_orders','accepted_by','accepted_by_uid'],
    ['mtn_orders','tech_main','tech_main_uid'],
    ['mtn_orders','tech_secondary','tech_secondary_uid'],
    ['mtn_orders','checker_name','checker_uid'],
    ['mtn_orders','qa_checker','qa_checker_uid'],
    ['mtn_orders','qa_skipped_by','qa_skipped_by_uid'],
    ['mtn_orders','ho_reporter','ho_reporter_uid'],
    ['mtn_orders','ho_checker','ho_checker_uid'],
    ['mtn_orders','approver_name','approver_uid'],
    ['mtn_orders','dept_manager_name','dept_manager_uid'],
    ['mtn_orders','plant_manager_name','plant_manager_uid'],
    ['mtn_orders','cost_mgr_name','cost_mgr_uid'],
    ['mtn_orders','satisfaction_by','satisfaction_by_uid'],
    ['mtn_orders','mo_approved_by','mo_approved_by_uid'],
    ['mtn_order_parts','logged_by','logged_by_uid'],
    ['mtn_order_labor','worker_name','worker_uid'],
    ['mtn_order_labor','logged_by','logged_by_uid'],
    ['mtn_order_handoffs','handed_by','handed_by_uid'],
    ['mtn_stock_txns','by_name','by_uid'],
    ['pm_plans','deferred_by','deferred_by_uid'],
    ['pm_plan_deferrals','by_name','by_uid'],
    ['pm_coordination_plans','created_by','created_by_uid'],
    ['fixture_shim_events','by_name','by_uid'],
    ['fixture_shim_events','approved_by','approved_by_uid'],
    -- สโตร์ / จัดซื้อ / คลัง
    ['purchase_requests','ordered_by','ordered_by_uid'],
    ['purchase_requests','received_by','received_by_uid'],
    ['line_stock_transactions','created_by','created_by_uid'],
    ['line_stock_transactions','reviewed_by','reviewed_by_uid'],
    ['child_lot_requests','triggered_by','triggered_by_uid'],
    ['rack_requests','requested_by','requested_by_uid'],
    ['rack_requests','prepared_by','prepared_by_uid'],
    ['rack_requests','delivered_by','delivered_by_uid'],
    ['rack_requests','received_by','received_by_uid'],
    ['rack_requests','cancelled_by','cancelled_by_uid'],
    ['material_requests','requester_name','requester_uid'],
    ['material_requests','made_by_name','made_by_uid'],
    ['material_requests','approved_by_name','approved_by_uid'],
    ['material_requests','received_by_name','received_by_uid'],
    ['material_requests','recorded_by_name','recorded_by_uid'],
    ['material_requests','checked_by_name','checked_by_uid'],
    -- ลูกค้า / จัดส่ง / แผน
    ['customer_shipping_orders','shipped_by','shipped_by_uid'],
    ['customer_shipping_orders','created_by_name','created_by_uid'],
    ['demand_upload_batches','uploaded_by','uploaded_by_uid'],
    ['customer_pull_batches','uploaded_by','uploaded_by_uid'],
    ['kanban_deliveries','confirmed_by','confirmed_by_uid'],
    ['kanban_deliveries','received_by','received_by_uid'],
    ['kanban_delivery_rounds','created_by','created_by_uid'],
    ['kanban_scans','scanned_by','scanned_by_uid'],
    ['kanban_targets','created_by','created_by_uid'],
    ['transport_round_assignments','assigned_by','assigned_by_uid'],
    -- คุณภาพ / ปรับปรุง / master ที่บันทึกคนสร้าง
    ['quality_bin_records','reported_by','reported_by_uid'],
    ['quality_bin_records','qa_by','qa_by_uid'],
    ['quality_bin_records','repair_by','repair_by_uid'],
    ['quality_bin_records','disposed_by','disposed_by_uid'],
    ['scrap_reports','inspector_name','inspector_uid'],
    ['scrap_reports','requester_name','requester_uid'],
    ['scrap_reports','approver_qa_name','approver_qa_uid'],
    ['scrap_reports','approver_pd_name','approver_pd_uid'],
    ['scrap_reports','approver_gm_name','approver_gm_uid'],
    ['scrap_reports','sender_name','sender_uid'],
    ['scrap_reports','receiver_name','receiver_uid'],
    ['scrap_reports','created_by','created_by_uid'],
    ['improvements','created_by_name','created_by_uid'],
    ['vsm_maps','approved_by','approved_by_uid'],
    ['vsm_maps','checked_by','checked_by_uid'],
    ['vsm_maps','issued_by','issued_by_uid'],
    ['bom_items','created_by','created_by_uid'],
    ['parts_master','created_by','created_by_uid'],
    ['product_packaging','created_by','created_by_uid'],
    ['lot_post_configs','created_by','created_by_uid']
  ];
  i int;
begin
  for i in 1 .. array_length(m,1) loop
    -- เพิ่มเฉพาะเมื่อ "ตารางมีจริง" และ "คอลัมน์ชื่อเดิมมีจริง"
    -- (กันเพิ่ม uid ลอยๆ ให้คอลัมน์ที่ไม่มีอยู่ — จะกลายเป็นคอลัมน์กำพร้าที่ไม่มีใครรู้ว่าคู่กับอะไร)
    if exists (select 1 from information_schema.columns
               where table_schema='public' and table_name=m[i][1] and column_name=m[i][2]) then
      execute format('alter table public.%I add column if not exists %I uuid', m[i][1], m[i][3]);
    else
      raise notice 'ข้าม %.% (ไม่มีคอลัมน์ต้นทาง)', m[i][1], m[i][2];
    end if;
  end loop;
end $$;


-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║ ส่วน B — Main project (ewhdfqwfwofivojtsizn · "MAIN")                      ║
-- ║ หมายเหตุ: Main ส่วนใหญ่เก็บ uuid อยู่แล้ว (four_m_logs / daily_production_logs ║
-- ║ / shift_* / skill_* ฯลฯ) ที่เพิ่มคือกลุ่มที่ยังเป็น text ล้วนเท่านั้น          ║
-- ╚════════════════════════════════════════════════════════════════════════════╝
do $$
declare
  m text[][] := array[
    ['lpa_audits','auditor_name','auditor_uid'],
    ['bbs_sheets','inspector_name','inspector_uid'],
    ['bbs_sheets','updated_by_name','updated_by_uid'],
    ['bbs_observations','updated_by_name','updated_by_uid'],
    ['bbs_row_notes','updated_by_name','updated_by_uid'],
    ['safety_events','reported_by_name','reported_by_uid'],
    ['ojt_trainings','trainer_name','trainer_uid'],
    ['ojt_trainings','maker_name','maker_uid'],
    ['ojt_trainings','approver_name','approver_uid'],
    ['ojt_trainings','hr_name','hr_uid'],
    ['ojt_training_attendees','evaluator_name','evaluator_uid'],
    ['line_helpers','created_by_name','created_by_uid'],
    ['kpi_actuals','entered_by','entered_by_uid'],
    ['user_feedback','handled_by','handled_by_uid'],
    ['pokayoke_checks','checker_name','checker_uid'],
    -- PE / NPI
    ['pe_doc_sets','created_by_name','created_by_uid'],
    ['pe_doc_revisions','issued_by','issued_by_uid'],
    ['pe_doc_revisions','checked_by','checked_by_uid'],
    ['pe_doc_revisions','approved_by','approved_by_uid'],
    ['pe_change_requests','created_by','created_by_uid'],
    ['pe_change_requests','decided_by','decided_by_uid'],
    ['npi_projects','created_by_name','created_by_uid'],
    ['npi_tasks','created_by_name','created_by_uid'],
    ['npi_deliverables','approved_by','approved_by_uid'],
    ['npi_drawing_revisions','released_by','released_by_uid'],
    ['npi_change_requests','requested_by','requested_by_uid'],
    ['npi_change_requests','decided_by','decided_by_uid'],
    ['npi_tooling_plans','maker_name','maker_uid'],
    -- QA
    ['qa_inspection_sheets','inspector_name','inspector_uid'],
    ['qa_inspection_sheets','created_by','created_by_uid'],
    ['qa_inspection_sheets','closed_by','closed_by_uid'],
    ['qa_inspection_results','recorded_by','recorded_by_uid'],
    ['qa_inspection_pieces','recorded_by','recorded_by_uid'],
    ['qa_inspection_actions','action_by','action_by_uid'],
    ['qa_inspection_actions','recorded_by','recorded_by_uid'],
    ['qa_ncr','disposition_by','disposition_by_uid'],
    ['qa_ncr','created_by','created_by_uid'],
    ['qa_ncr','closed_by','closed_by_uid'],
    ['qa_capa','created_by','created_by_uid'],
    ['qa_customer_claims','created_by','created_by_uid'],
    ['qa_customer_claims','closed_by','closed_by_uid'],
    ['qa_measurements','created_by','created_by_uid'],
    ['qa_parts','created_by','created_by_uid'],
    ['qa_characteristics','created_by','created_by_uid'],
    ['qa_instruments','cal_by','cal_by_uid'],
    -- สโตร์หน้าไลน์ (WIP)
    ['wip_replenish_requests','requested_by','requested_by_uid'],
    ['wip_replenish_requests','delivered_by','delivered_by_uid'],
    ['wip_replenish_requests','picked_by_name','picked_by_uid'],
    ['wip_replenish_requests','received_by_name','received_by_uid'],
    ['wip_replenish_requests','decided_by_name','decided_by_uid'],
    ['wip_replenish_requests','hold_by_name','hold_by_uid']
  ];
  i int;
begin
  for i in 1 .. array_length(m,1) loop
    if exists (select 1 from information_schema.columns
               where table_schema='public' and table_name=m[i][1] and column_name=m[i][2]) then
      execute format('alter table public.%I add column if not exists %I uuid', m[i][1], m[i][3]);
    else
      raise notice 'ข้าม %.% (ไม่มีคอลัมน์ต้นทาง)', m[i][1], m[i][2];
    end if;
  end loop;
end $$;
