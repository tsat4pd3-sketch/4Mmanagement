/* ══ คืนสิทธิ์ "จัดกำลังคน" ให้หัวหน้ากลุ่ม (leader) ═══════════════════════════════════
   project: Main "MAIN" (ewhdfqwfwofivojtsizn)   · 2026-10-14 · คำสั่ง user (หน้างานแจ้ง 08:27)

   อาการ: *"จัดกำลังคนมันอยู่ใน line management ที่หัวหน้ากลุ่มใช้ประจำ แต่ตอนนี้เข้าไม่ได้"*

   ต้นเหตุ (ไม่ใช่บั๊กใหม่ — เป็นการ "ปิดช่องโหว่" ที่ไปทับการใช้งานจริง):
     commit 060e0643 "RLS รอบ 8" (13/10) ปิด 2 ชั้นพร้อมกัน
       · ฝั่งจอ — ปุ่ม 📌 บันทึกตำแหน่งประจำ / ↩ Pool ใน modal จุดงาน **เดิมไม่มี can() เลย**
         ⇒ ใครเปิด modal ได้ก็กดได้ · ตอนนี้ถูกซ่อน+บล็อกด้วย `management:assign_manpower`
       · ฝั่ง DB — `employee_home_positions` รัด RLS ด้วยคีย์เดียวกัน
     แต่ `leader` **ไม่เคยมีแถว `management:assign_manpower` เลย** (มีแค่ supervisor/manager/
     admin/dept_admin) ⇒ หัวหน้ากลุ่มที่ใช้ปุ่มนี้ทุกวันผ่านช่องโหว่ หยุดทำงานทันที

   การตัดสินใจ (user เคาะ 14/10): **ให้ `leader` ถือคีย์นี้เต็ม** — ตรงกับงานจริงที่เขาทำอยู่
     (ลากคนเข้าจุดงาน · บันทึกตำแหน่งประจำ · ส่งกลับ Pool)
     ขอบเขตยังถูกจำกัดด้วย scope ไลน์ของ leader เหมือนเดิม (`scopeLines` — ครอบครัวไลน์ตัวเอง)
     ⇒ คีย์นี้ไม่ได้เปิดให้แก้ข้ามไลน์

   ผลที่ตามมา (ตารางที่ leader จะเขียนได้เพิ่ม — ทั้งคู่คือสิ่งที่เขาทำอยู่แล้ว):
     · `employee_home_positions` (ALL = management:assign_manpower)
     · `daily_production_logs` UPDATE/INSERT — leader ผ่านอยู่แล้วทางขา `checkin:record`

   🔁 rollback (ย้อนได้ทันที บรรทัดเดียว):
     update public.role_permissions set allowed = false
      where role = 'leader' and permission_key = 'management:assign_manpower';
     -- หรือลบแถวทิ้งให้กลับไปสภาพเดิมเป๊ะ:
     -- delete from public.role_permissions
     --  where role = 'leader' and permission_key = 'management:assign_manpower';
   ═══════════════════════════════════════════════════════════════════════════════ */

insert into public.role_permissions (role, permission_key, allowed)
values ('leader', 'management:assign_manpower', true)
on conflict (role, permission_key) do update set allowed = true;
