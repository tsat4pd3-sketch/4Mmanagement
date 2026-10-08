/*  ═══════════════════════════════════════════════════════════════════════════════════════
    BACKFILL — คืนยอดผลิตของ "ใบยกยอดที่กะถัดไปรับไปแล้ว (imported)" เข้าสูตร %P / %Q / OEE
    project: DR / "Product DB"  (eyhclzkifitbhbljgoav)          วันที่: 2026-09-17
    ═══════════════════════════════════════════════════════════════════════════════════════

    ต้นเหตุ (แก้ในโค้ดแล้ว 16/09 · commit deda887 — computeOEE ใน DailyReport.jsx 3 จุด):
      ลิสต์สถานะที่ "นับยอดที่ทำได้" เป็น ['open','carry_over','cancelled'] — ไม่มี 'imported'
      สถานะ imported = ใบยกยอดที่กะถัดไป "กดรับไปแล้ว" · ยอดที่ทำได้จริงในกะนี้ยังอยู่ที่
      qty_actual ของใบเดิมเสมอ (ใบสืบทอดฝั่งกะถัดไปถือแค่ส่วนที่เหลือ remainQty
      ⇒ นับแล้วไม่ซ้ำซ้อน — กติกาเต็มอยู่ที่ src/utils/oee.js §6)
      ⇒ พอกะถัดไปกด "รับยอดค้าง" ยอดผลิตของกะที่ทำจริง "ลดลงเงียบๆ" ทันที ⇒ %P/%Q/OEE ร่วง

      เคสที่หัวหน้ากลุ่ม Assy2 จับได้: Assy LWR 15/09 กะเช้า — ตอนขอปิดกะนับ 384 ชิ้น
      พอ SV มาอนุมัติ/แก้เวลาเช้าวันถัดไป (ใบถูก import ไปแล้ว) เหลือ 352
        ⇒ %P 86.18 → 79.00 · OEE 72.00 → 66.00
        ทั้งที่ actual_qty ในแถวเดียวกันยังเป็น 384 (แถวขัดแย้งกันเอง)

    ขอบเขต: 145 กะที่ปิดแล้ว (24/06–15/09) มีใบ imported ที่ถือยอดจริง — รวม 3,432 ชิ้นหายจากสูตร

    ── วิธีทำ — ⚠️ "ใช้อัตราส่วน" ไม่ใช่คำนวณใหม่ทั้งก้อน ────────────────────────────────────
    ทดลองก่อนแล้วว่า *คำนวณ %P ใหม่ทั้งก้อนด้วย master วันนี้ใช้ไม่ได้*: จำลอง computeOEE
    ด้วยข้อมูลวันนี้แล้วเทียบกับค่าที่ stamp ไว้ (867 กะที่ไม่มีใบ imported เลย) ตรงแค่ 27-44%
    ทั้งที่ %A ตรง 83-85% ⇒ CT ใน master เปลี่ยนไปจากตอนปิดกะแล้ว
    (ตรงกับกฎที่เขียนไว้ใน oee.js: "ค่าที่ stamp ตอนปิดกะคือความจริงสูงสุดของกะที่ปิดแล้ว
     ห้ามคำนวณใหม่ด้วย master ปัจจุบัน")

    จึงแก้ด้วยอัตราส่วน — บั๊กนี้เปลี่ยน **แค่ qty** เท่านั้น ตัวหาร (runSec) และ CT ไม่ขยับเลย:
        P      = min(1, Σ(qty_i × ct_i) / runSec)
        P_ใหม่ = P_เดิม × Σ(qty_ใหม่_i × ct_i) / Σ(qty_เดิม_i × ct_i)
    ⇒ runSec ตัดทิ้ง และ "สเกล" ของ CT ก็ตัดทิ้ง เหลือแค่สัดส่วน CT ระหว่าง MAT ในกะเดียวกัน:
      • method 'A' — กะมี MAT เดียว ⇒ สัดส่วนตัดหมด = แม่นยำ ไม่ต้องรู้ CT เลย
      • method 'B' — หลาย MAT ⇒ ใช้สัดส่วน CT วันนี้ (ทนต่อการปรับ CT ทั้งไลน์พร้อมกัน
        และเคสหลักที่นี่คือพาร์ทเดียวกันแตกตามลูกค้า สัดส่วน = 1 อยู่แล้ว)
      • method 'qty_only' — กะที่ไม่เคยมี %P (HYDROFORM 25/06) แก้แค่ actual_qty

    ── ทวนสอบ 2 ทางก่อนรัน (ทำไปแล้ว 17/09) ───────────────────────────────────────────────
    เขียนตัวคำนวณ 2 ชุดแยกกันคนละภาษา (สคริปต์ Node ที่ import สูตรจริงจาก src/utils/oee.js
    กับคิวรี SQL ชุดนี้) แล้วเทียบผลทีละแถว — **ตรงกันทุกค่าที่เทียบได้**
    และเคส Assy LWR 15/09 กะเช้า ทั้งสองทางให้ P = 86.18 เท่ากับที่จำลองมือแบบเต็มสูตรไว้ก่อนหน้า

    ✅ ทวนสอบ: Assy LWR 15/09 กะเช้า (method B) วิธีนี้ให้ P = 86.18 — ตรงกับที่จำลองมือแบบ
       เต็มสูตรไว้ก่อนหน้าเป๊ะ (ไล่ break policy + downtime จริงทีละนาที)

    • %Q = ยอดใหม่ / (ยอดใหม่ + qty_ng)
    • OEE = A × P × Q ใหม่เสมอ (ห้ามอ่าน oee เดิม)
    • **%A ไม่แตะเลย** — สูตร %A ไม่มี qty อยู่ในนั้น บั๊กนี้ไม่กระทบ
    • actual_qty แก้เฉพาะ 3 กะที่ยัง stamp ผิดไว้ (อีก 142 กะ stamp ถูกตั้งแต่ตอนปิดกะแล้ว)
    • ข้าม 1 กะ (Assy LWR 09/09 กะดึก) — ชุด MAT ในสูตร %P เปลี่ยน (1→2) พิสูจน์ไม่ได้ ไม่แตะ

    ผลที่คาด: ~117 กะ · %P ขยับ "ขึ้น" มัธยฐาน +1.49 จุด (มากสุด +12.67)
            · OEE ขยับขึ้นมัธยฐาน +1.19 จุด (มากสุด +11.19) · **ไม่มีกะไหนตัวเลขลดลง**
    (migration นี้เขียนเป็น "สูตร" ไม่ใช่รายการเลข 117 แถว — อ่านรู้เรื่อง ตรวจซ้ำได้ และรันซ้ำ
     ก็ไม่เขียนทับของเดิม เพราะ on conflict do nothing + update อ่านจากตารางสำรอง)

    ── ROLLBACK ────────────────────────────────────────────────────────────────────────────
    ตาราง oee_imported_qty_backfill_20260917 เก็บค่าก่อน-หลังครบทุกแถว ย้อนได้ด้วย:
      update production_sessions ps
         set oee_p = b.old_p, oee_q = b.old_q, oee = b.old_oee, actual_qty = b.old_qty
        from oee_imported_qty_backfill_20260917 b
       where b.session_id = ps.id;
    ═══════════════════════════════════════════════════════════════════════════════════════ */

begin;

/* ตารางสำรอง — เก็บค่าก่อน/หลังครบทุกแถวไว้ย้อน */
create table if not exists oee_imported_qty_backfill_20260917 (
  session_id    uuid primary key,
  method        text,        -- 'A' MAT เดียว (แม่นยำ) · 'B' หลาย MAT (สัดส่วน CT) · 'qty_only' ไม่มี %P เดิม
  n_mat         integer,
  old_qty       integer, new_qty integer,
  old_p         numeric, new_p   numeric,
  old_q         numeric, new_q   numeric,
  old_oee       numeric, new_oee numeric,
  backfilled_at timestamptz not null default now()
);

/* CT ต่อ MAT — ลำดับเดียวกับ ctForMat() ใน src/utils/oee.js §2: kanban ชนะ แล้วถอยไป dr_products
   ⚠️ ใช้แค่ "สัดส่วน" เท่านั้น สเกลตัดทิ้งในสูตรอัตราส่วนอยู่แล้ว */
create temporary view _ct as
  with ctk as (select k.mat_no, max(dp.cycle_time_sec) ct
                 from kanban_standards k join dr_products dp on dp.id = k.product_id
                where dp.cycle_time_sec > 0 group by 1),
       ctp as (select mat_no, max(cycle_time_sec) ct from dr_products where cycle_time_sec > 0 group by 1)
  select coalesce(k.mat_no, p.mat_no) as mat_no, coalesce(k.ct, p.ct) as ct
    from ctk k full join ctp p on p.mat_no = k.mat_no;

/* ยอดต่อ (กะ, MAT) แบบ "เดิม" (บั๊ก — ทิ้ง imported) กับ "ใหม่" (นับ imported) */
create temporary view _mat as
  select o.session_id, o.mat_no,
         sum(case when o.status = 'confirmed' then coalesce(o.qty_ok, o.qty, 0)
                  when o.status in ('open','carry_over','cancelled') then coalesce(o.qty_actual, 0)
                  else 0 end) as q_old,                              -- ← สูตรเดิมที่เป็นบั๊ก
         sum(case when o.status = 'confirmed' then coalesce(o.qty_ok, o.qty, 0)
                  else coalesce(o.qty_actual, 0) end) as q_new       -- ← รวม imported (oee.js §6)
    from prod_orders o
   group by 1, 2;

create temporary view _agg as
  select m.session_id,
         sum(m.q_old * c.ct) filter (where m.q_old > 0 and c.ct > 0) as std_old,
         sum(m.q_new * c.ct) filter (where m.q_new > 0 and c.ct > 0) as std_new,
         count(*)            filter (where m.q_old > 0 and c.ct > 0) as n_old,
         count(*)            filter (where m.q_new > 0 and c.ct > 0) as n_new,
         sum(m.q_old) as t_old, sum(m.q_new) as t_new
    from _mat m left join _ct c on c.mat_no = m.mat_no
   group by 1;

insert into oee_imported_qty_backfill_20260917
       (session_id, method, n_mat, old_qty, new_qty, old_p, new_p, old_q, new_q, old_oee, new_oee)
select s.id,
       case when s.oee_p is null then 'qty_only' when a.n_new = 1 then 'A' else 'B' end,
       a.n_new,
       s.actual_qty, a.t_new,
       s.oee_p, p.new_p,
       s.oee_q, q.new_q,
       s.oee,
       case when s.oee_a is null or p.new_p is null or q.new_q is null then s.oee
            else round(s.oee_a * p.new_p * q.new_q / 10000.0, 2) end
  from production_sessions s
  join _agg a on a.session_id = s.id
 cross join lateral (select case when s.oee_p is null then null
                                 else least(100, round(s.oee_p * a.std_new / a.std_old, 2)) end as new_p) p
 cross join lateral (select case when s.oee_q is null then null
                                 else round(100.0 * a.t_new / nullif(a.t_new + coalesce(s.qty_ng, 0), 0), 2) end as new_q) q
 where s.status = 'closed'
   and a.t_new > a.t_old                                   -- มียอดที่หายไปจริง
   and exists (select 1 from prod_orders o
                where o.session_id = s.id and o.status = 'imported' and coalesce(o.qty_actual, 0) > 0)
   /* 🔴 แตะเฉพาะกะที่ "พิสูจน์ได้" — ชุด MAT ที่เข้าสูตร %P ต้องไม่เปลี่ยน และ std เดิมต้องไม่เป็น 0
      ไม่งั้นอัตราส่วนใช้ไม่ได้ (ต้องรู้ CT ย้อนหลังซึ่งไม่มี) · กะแบบนั้นปล่อยไว้เหมือนเดิม */
   and (s.oee_p is null or (a.n_old = a.n_new and a.n_old > 0 and coalesce(a.std_old, 0) > 0))
   /* ข้ามแถวที่ตัวเลขไม่ขยับเลย — ไม่ต้องเขียนทับให้เปลืองประวัติ */
   and (s.actual_qty is distinct from a.t_new
        or (s.oee_p is not null and s.oee_p is distinct from p.new_p)
        or (s.oee_q is not null and s.oee_q is distinct from q.new_q))
on conflict (session_id) do nothing;

update production_sessions ps
   set actual_qty = b.new_qty,
       oee_p      = coalesce(b.new_p,   ps.oee_p),
       oee_q      = coalesce(b.new_q,   ps.oee_q),
       oee        = coalesce(b.new_oee, ps.oee)
  from oee_imported_qty_backfill_20260917 b
 where b.session_id = ps.id
   and ps.status = 'closed';

commit;

/* ── ตรวจผลหลังรัน ─────────────────────────────────────────────────────────────────────
select method, count(*) as กะ,
       round(avg(new_p   - old_p),   2) as p_เฉลี่ยขึ้น,
       round(avg(new_oee - old_oee), 2) as oee_เฉลี่ยขึ้น,
       min(new_p - old_p)                as p_ขยับน้อยสุด,
       sum(new_qty - old_qty)            as ยอดที่คืนกลับ
  from oee_imported_qty_backfill_20260917 group by 1 order by 1;

-- เคสที่หัวหน้ากลุ่ม Assy2 จับได้ — ต้องได้ oee_p = 86.18 · oee = 71.99 · actual_qty = 384
select work_date, shift, line_name, actual_qty, oee_a, oee_p, oee_q, oee
  from production_sessions
 where work_date = '2026-09-15' and shift = 'day' and line_name = 'Assy  LWR';
─────────────────────────────────────────────────────────────────────────────────────── */
