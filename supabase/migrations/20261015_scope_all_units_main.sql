/* ═══════════════════════════════════════════════════════════════════════════════
   คีย์สิทธิ์ใหม่ `scope:all_units` — "แก้ข้อมูลข้ามหน่วยงานได้"
   project: MAIN (ชื่อในจอ Supabase "MAIN" · ewhdfqwfwofivojtsizn)   2026-10-15

   ที่มา (คำสั่ง user): *"user เป็น mtn ที่เป็นแค่แอดมินส่วนงาน แต่เข้าไปแก้ KPI ของแผนกอื่นได้
   มั่วเลย"* → *"ต้องไม่เกิดเคสนี้อีก ที่ user บาง role เข้าหน้าได้ทุกหน้า แต่ต้องไม่มีสิทธิ์
   ไปแก้ข้อมูลส่วนงานคนอื่น"*

   ผลตรวจทั้งระบบ (docs/modules/permission-scope-audit.md) พบว่าระบบมีแค่ 2 ชั้น —
   "เข้าหน้าได้ไหม" + "กดปุ่มเป็นไหม" — **ไม่มีชั้น "แถวนี้เป็นของหน่วยงานเราไหม"**
   ⇒ 20 จุดที่คนส่วนงานหนึ่งแก้/อนุมัติ/ลบของอีกส่วนงานได้

   คีย์นี้คือ "ใบผ่าน" ของชั้นที่ 3 (ตัวตัดสินอยู่ที่ src/utils/writeScope.js)
   · ไม่ถือคีย์นี้ = แก้ได้เฉพาะส่วนงานของตัวเอง (`profiles.section` / `sections`)
   · ถือคีย์นี้   = แก้ข้ามหน่วยงานได้เหมือนเดิมทุกประการ

   🔴 **"ขอบเขตที่เห็น" ไม่เปลี่ยน** — `effectiveSections()` ยังทำงานเหมือนเดิมทุกบรรทัด
      ช่าง MTN ยังเห็นงานซ่อมทุกไลน์ · จอรายงาน/ผัง/Andon ไม่กระทบ

   seed (คำสั่ง user 15/10 "ดูได้ทั้งโรงงาน แต่แก้ได้เฉพาะของตัวเอง"):
     true  = role ที่ "งานจริงเป็นงานทั้งโรงงาน" — admin · manager · qa · planner_store
             · engineer · engineer_nm · document_control · warehouse_delivery
     false = role ที่ผูกกับหน่วยงาน — supervisor · leader · mtn · **dept_admin** · sale · display
   ⚠️ `dept_admin` เป็น false โดยตั้งใจ: bucket นี้ถือคีย์ action 101 ตัว (99 ตัวเป็นคีย์ของ
      manager) แบบไม่มีขอบเขต ทั้งที่ migration 20260803_dept_admin.sql เขียนเจตนาไว้เองว่า
      "แก้ได้เฉพาะหน่วยงานตัวเอง" — คีย์นี้คือตัวที่ทำให้เจตนานั้นเป็นจริง

   วัดก่อนลง (15/10): 7 บัญชีที่ไม่มี `section` เลย = admin 2 · display 2 · engineer 1
   · engineer_nm 1 · manager 1 ⇒ **อยู่ในกลุ่ม true ทั้งหมด ไม่มีใครถูกล็อกออกจากงาน**
   (`display` seed false ได้ เพราะเป็นบัญชีจอแขวน อ่านอย่างเดียว ไม่มีปุ่มแก้)

   rollback:  delete from public.role_permissions where permission_key = 'scope:all_units';
              ⚠️ ย้อนคีย์อย่างเดียว **ไม่พอ** — ฝั่งจอ fail-closed (คีย์หาย = ไม่มีใครข้ามหน่วยได้)
              ถ้าต้องย้อนด่วนให้ตั้งเป็น true ทุก role แทน = ได้พฤติกรรมก่อน 15/10 เป๊ะ:
                update public.role_permissions set allowed = true
                 where permission_key = 'scope:all_units';
   ═══════════════════════════════════════════════════════════════════════════════ */

insert into public.role_permissions (role, permission_key, allowed)
select r::public.user_role,
       'scope:all_units',
       r in ('admin', 'manager', 'qa', 'planner_store',
             'engineer', 'engineer_nm', 'document_control', 'warehouse_delivery')
from unnest(enum_range(null::public.user_role)) as r
on conflict (role, permission_key) do nothing;
