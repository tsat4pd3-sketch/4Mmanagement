/* ═══ 🧺 รับเข้าคลัง "ทั้งกอง" — RPC stock_receipt_confirm_group (DR · Product DB) ════
 *
 * ที่มา (2026-10-22 · คำสั่ง user): ปิดใบผลิต 1 ใบ = ใบรอรับ 1 ใบ ⇒ วัดจริง 22/10
 *   `20058498` ค้าง **169 ใบ / 2,324 ชิ้น / 3 วัน** ที่เส้นทางเดียวกันเป๊ะ (Assy GOR → STORE)
 *   คิวทั้งโรงงาน 331 ใบ · 24,342 ชิ้น ⇒ จอ "การ์ดต่อใบ" ไม่มีใครไล่กดไหว คิวเลยตาย
 *   ผลพวง: FG ติดลบ (10086024 = −630) เพราะขาขายหักออโต้ทัน แต่ขารับเข้าค้างคิว
 *
 * 🔴 ยุบเพื่อ "กด" เท่านั้น — **ทุกใบยังถูกปิดรายใบพร้อม `qty_received` ของตัวเอง**
 *    (user เคาะ 22/10 "เก็บรายใบไว้ กางดูได้") ⇒ สอบกลับรายออเดอร์ได้เหมือนเดิม
 * 🔴 ยอดที่นับได้ไม่ตรง **ปันแบบใบเก่าก่อน (FIFO) ห้ามเฉลี่ยเป็นทศนิยม** — ของนับเป็นชิ้น
 *    ใบที่ยอดไม่พอถึงได้บางส่วน · ที่เหลือได้ 0 · นับได้เกิน = ส่วนเกินลงใบใหม่สุด
 *    **ตรรกะต้องตรงกับ `allocateFifo()` ใน `src/utils/stockReceipts.js` เป๊ะ** (เทสคุม 2 ฝั่ง)
 * 🔴 ลงบัญชี **1 แถวต่อ 1 กอง** (169 แถวในบัญชี = ขยะ) · กอง 1 ใบ = พฤติกรรมเดิมทุกอย่าง
 *    (note / ref_session_id / ref_order_id เหมือน `stock_receipt_confirm` ตัวเดิมเป๊ะ)
 * · ไม่ใช่ security definer — เหมือนตัวเดิม (ฝั่ง DR วิ่งด้วย anon เสมอ)
 * · ตัวเดิม `stock_receipt_confirm` **ยังอยู่ ห้ามถอด** (ใช้ตอนกดรับใบเดี่ยว)
 *
 * ✅ ทดสอบแล้ว 22/10 (ธุรกรรมที่บังคับ rollback): 3 ใบ × 14 นับได้ 20
 *    → ปันได้ 14 / 6 / 0 · ledger 1 แถว 20 ชิ้น · ใบที่ยอดต่างได้ diff_reason ครบ
 * ↩️ rollback: drop function if exists public.stock_receipt_confirm_group(uuid[], numeric, text, text, uuid);
 *    (จอถอยไปกดรับทีละใบด้วย `stock_receipt_confirm` ได้ทันที ไม่มีข้อมูลเสียหาย)
 *
 * 📄 docs/modules/daily-report.md §คิวรอรับเข้าคลัง
 * ═══════════════════════════════════════════════════════════════════════════════════ */

create or replace function public.stock_receipt_confirm_group(p_ids uuid[], p_qty numeric, p_reason text, p_by text, p_by_uid uuid)
returns table (slip_id uuid, qty numeric) language plpgsql as $fn$
declare
  r public.stock_receipts;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_got bigint; v_left bigint; v_exp bigint := 0; v_cnt int := 0; v_alloc bigint;
  v_txn uuid; v_last uuid;
  v_mat text; v_src text; v_dest text; v_part text; v_prod text;
  v_wd date; v_sess uuid; v_ord uuid; v_note text;
begin
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'ไม่ได้เลือกใบไหนเลย'; end if;
  if p_qty is null or p_qty < 0 then raise exception 'จำนวนที่นับได้ต้องเป็น 0 ขึ้นไป'; end if;
  if coalesce(btrim(p_by), '') = '' then raise exception 'ไม่รู้ว่าใครเป็นคนรับ'; end if;
  v_got := floor(p_qty);

  -- ล็อกทุกใบในกองพร้อมกัน เรียงเก่า→ใหม่ (ลำดับเดียวกับ allocateFifo ฝั่งจอ)
  for r in select * from public.stock_receipts where id = any(p_ids) order by created_at, id for update loop
    if r.status <> 'pending' then
      raise exception 'ใบ % ถูก% ไปแล้ว — รีเฟรชจอแล้วกดใหม่', coalesce(r.prod_no, r.id::text),
        case r.status when 'received' then 'รับเข้า' else 'ยกเลิก' end;
    end if;
    v_cnt := v_cnt + 1;
    v_exp := v_exp + r.qty_expected;
    if v_mat is null then
      v_mat := r.mat_no; v_src := r.source_line; v_dest := r.dest_line_name; v_part := r.part_name;
      v_sess := r.ref_session_id; v_ord := r.prod_order_id; v_prod := r.prod_no;
    elsif v_mat is distinct from r.mat_no or v_src is distinct from r.source_line or v_dest is distinct from r.dest_line_name then
      raise exception 'ใบในกองไม่ใช่เส้นทางเดียวกัน (พาร์ท/ต้นทาง/ปลายทางต่างกัน) — ลงบัญชีรวมไม่ได้';
    end if;
    v_wd := greatest(coalesce(v_wd, r.work_date), r.work_date);
    v_last := r.id;
  end loop;
  -- ใบหายไประหว่างทาง (คนอื่นรับ/ยกเลิก) = หยุด ห้ามรับแค่บางส่วนเงียบๆ
  if v_cnt <> cardinality(p_ids) then
    raise exception 'ใบที่เลือกมี % ใบ แต่หาเจอ % ใบ — รีเฟรชจอแล้วกดใหม่', cardinality(p_ids), v_cnt;
  end if;
  if v_got <> v_exp and v_reason is null then
    raise exception 'ยอดที่นับได้ (%) ไม่ตรงกับใบรวม (%) — ต้องใส่เหตุผล', v_got, v_exp;
  end if;

  v_note := case when v_cnt = 1
      then 'รับเข้า (นับแล้ว): ปิดออเดอร์ ' || coalesce(v_prod, '') || ' จากไลน์ ' || coalesce(v_src, '-')
      else 'รับเข้า (นับแล้ว): รวม ' || v_cnt || ' ใบ จากไลน์ ' || coalesce(v_src, '-') end
    || case when v_got <> v_exp then ' · นับได้ ' || v_got || ' จากใบรวม ' || v_exp || ' — ' || v_reason else '' end;

  if v_got > 0 then
    insert into public.line_stock_transactions
      (line_name, mat_no, part_name, qty, type, ref_session_id, ref_order_id, work_date, note, created_by, created_by_uid)
    values (v_dest, v_mat, v_part, v_got, 'issue',
            case when v_cnt = 1 then v_sess end, case when v_cnt = 1 then v_ord end,
            v_wd, v_note, p_by, p_by_uid)
    returning id into v_txn;
  end if;

  -- ปันยอดลงใบรายตัว (FIFO) — ส่วนเกินลงใบใหม่สุด
  v_left := v_got;
  for r in select * from public.stock_receipts where id = any(p_ids) order by created_at, id loop
    v_alloc := least(r.qty_expected, v_left);
    v_left := v_left - v_alloc;
    if r.id = v_last then v_alloc := v_alloc + v_left; v_left := 0; end if;
    update public.stock_receipts
       set status = 'received', qty_received = v_alloc,
           diff_reason = case when v_alloc <> r.qty_expected then coalesce(v_reason, 'ปันตามยอดที่นับรวมทั้งกอง') end,
           received_by = p_by, received_by_uid = p_by_uid, received_at = now(),
           stock_txn_id = v_txn, updated_by_name = p_by, updated_by_uid = p_by_uid
     where id = r.id;
    slip_id := r.id; qty := v_alloc; return next;
  end loop;
  return;
end $fn$;
