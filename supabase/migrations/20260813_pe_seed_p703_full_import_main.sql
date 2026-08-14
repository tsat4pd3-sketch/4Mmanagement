-- นำเข้าเนื้อหาเต็มใบ P703 ทั้ง 2 พาร์ท (RH 16E060 เติมเต็ม · LH 16E061 สร้างใหม่)
-- จากไฟล์จริง: PFC/FMEA/CNP Rev.12/33/22 (RH) + Rev.11/30/17 (LH) — 2026-08-13
-- ข้อมูล ~450KB อยู่ที่ docs/sql/pe_seed_p703_full.json (แกะด้วย docs/sql/pe_import/)
-- → ดึงเข้า DB ผ่าน pg_net (repo เป็น public raw) แทนการ inline SQL ยักษ์
-- idempotent: replace items/revisions ของ 2 ชุดนี้ทั้งก้อนจากไฟล์ · pe_processes upsert (ชุด RH คงแถวเดิม)
-- หมายเหตุ: ตอน apply จริงใช้ URL ของ branch claude/production-attendance-systems-t4smxh (merge เข้า main แล้วไฟล์อยู่ทั้งคู่)
-- จังหวะ 2: อ่าน response ตาม request id จาก 20260813_pe_seed_p703_fetch.sql แล้วนำเข้า
do $imp$
declare
  rid bigint; body jsonb; s jsonb; tries int := 0;
begin
  select f.rid into rid from public._pe_seed_fetch f limit 1;
  if rid is null then raise exception 'PE seed: ไม่พบ request id (รัน pe_seed_p703_fetch ก่อน)'; end if;
  loop
    select content::jsonb into body from net._http_response where id = rid and status_code = 200;
    exit when body is not null or tries > 30;
  end loop;
  if body is null then raise exception 'PE seed: ดึง JSON ไม่สำเร็จ (request id %)', rid; end if;

  for s in select * from jsonb_array_elements(body->'sets') loop
    if s->>'mode' = 'create' then
      insert into pe_doc_sets (id, part_no, part_name, model, customer, line_name, doc_no_pfc, doc_no_fmea, doc_no_cp, status, remark, created_by_name)
      values ((s->>'id')::uuid, s->>'part_no', s->>'part_name', s->>'model', s->>'customer', s->>'line_name',
              s->>'doc_pfc', s->>'doc_fmea', s->>'doc_cp', 'active',
              'นำเข้าเต็มใบจากไฟล์จริง PFC Rev.11 / FMEA Rev.30 / CNP Rev.17 (2026-08-13)', 'ระบบ (นำเข้าจากไฟล์ Excel)')
      on conflict (id) do nothing;
    end if;

    delete from pe_fmea_items where process_id in (select id from pe_processes where set_id = (s->>'id')::uuid);
    delete from pe_cp_items   where process_id in (select id from pe_processes where set_id = (s->>'id')::uuid);
    delete from pe_doc_revisions where set_id = (s->>'id')::uuid;

    insert into pe_processes (set_id, op_no, seq, name, kind, machine_no, child_parts, remark)
    select (s->>'id')::uuid, o->>'op_no', (o->>'seq')::numeric, o->>'name', o->>'kind', o->>'machine_no', o->>'child_parts', o->>'remark'
    from jsonb_array_elements(s->'ops') o
    on conflict (set_id, op_no) do nothing;

    insert into pe_fmea_items (process_id, seq, item_function, requirement, failure_mode, effects, severity, classification,
                               causes, prevention, occurrence, detection_ctrl, detection, recommended_action,
                               responsibility, action_taken, new_severity, new_occurrence, new_detection)
    select p.id, (f->>'seq')::int, f->>'fn', f->>'req', f->>'fm', f->>'eff', (f->>'s')::int, f->>'cls',
           f->>'cse', f->>'prv', (f->>'o')::int, f->>'dc', (f->>'dt')::int, f->>'ra',
           f->>'rsp', f->>'at', (f->>'ns')::int, (f->>'no')::int, (f->>'nd')::int
    from jsonb_array_elements(s->'fmea') f
    join pe_processes p on p.set_id = (s->>'id')::uuid and p.op_no = f->>'op';

    insert into pe_cp_items (process_id, seq, sub_op, char_no, product_char, process_char, special_class, person,
                             spec, method, sample_size, frequency, control_method, reaction_plan)
    select p.id, (c->>'seq')::int, c->>'sub', (c->>'cn')::int, c->>'pc', c->>'prc', c->>'cls', c->>'per',
           c->>'spec', c->>'m', c->>'ss', c->>'fq', c->>'cm', c->>'rp'
    from jsonb_array_elements(s->'cp') c
    join pe_processes p on p.set_id = (s->>'id')::uuid and p.op_no = c->>'op';

    insert into pe_doc_revisions (set_id, doc_type, rev_date, suffix, ecn_no, content, issued_by, checked_by, approved_by)
    select (s->>'id')::uuid, r->>'t', (r->>'d')::date, r->>'sfx', nullif(r->>'ecn',''), r->>'c', r->>'i', r->>'ck', r->>'ap'
    from jsonb_array_elements(s->'revs') r;
  end loop;

  drop table public._pe_seed_fetch;
end $imp$;
