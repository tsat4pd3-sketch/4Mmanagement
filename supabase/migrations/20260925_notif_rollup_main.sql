/* ══ 🔕 ยุบกระดิ่งซ้ำ — 1 คน + 1 เรื่อง + ยังไม่อ่าน = ใบเดียว นับรวม (2026-09-25 · คำสั่ง user) ══
 *
 * เหตุการณ์ที่ทำให้ต้องมี (วัดจริง 25/09 ฝั่ง DR + Main):
 *   ใบซ่อมค้างขั้น "ตรวจแล้ว รอ QA" **168 ใบ** — 160 ใบ `qa_at` ว่าง ไม่มีใครแตะเลย
 *   ไล่ไทม์ไลน์เจอว่า **109 ใบเกิดในบ่ายวันเดียว (23/09 09:56–13:49)** — ช่าง 2 คนนั่งเคลียร์
 *   งานตรวจขั้น 4 ที่ค้างสะสมรวดเดียว (เขาทำงานดี ไม่ใช่ความผิด)
 *   ⇒ บ่ายนั้นระบบยิงกระดิ่ง `mtn_checked` = **3,564 ใบ** ให้คน 48 คน · อ่าน 94 ใบ (2.6%)
 *      เฉพาะ role `qa` 14 คน ได้ **1,582 ใบ (≈113 ใบ/คน/บ่ายเดียว) อ่าน 2 ใบ = 0.13%**
 *   ⇒ ภาพรวม 7 วัน ช่องกระดิ่งของ QA **อ่าน 0.6%** — ต่ำสุดในบรรดา role หน้างาน = ช่องทางตายแล้ว
 *
 * 🔴 บทเรียน: ปัญหาไม่ใช่ "คนไม่กดปิดใบ" แต่คือ **1 ใบงาน = 1 กระดิ่ง ต่อคน ไม่มีเพดาน**
 *    ⇒ เคลียร์งานค้างทีเดียว 109 ใบ = ระเบิด 3,564 ใบ แล้วสัญญาณจริงจมหายไปกับกอง
 *    การเพิ่ม "ตัวเตือนรายวัน" อีกตัวในสภาพนี้ = กระดิ่งใบที่ 114 (แก้ไม่ตรงเหตุ)
 *
 * ── สิ่งที่ทำ ────────────────────────────────────────────────────────────────────────
 * ภายในหน้าต่างเวลาที่ตั้งไว้ ถ้า "คนเดิม + เรื่องเดิม + ใบเดิมยังไม่ได้อ่าน" มีอยู่แล้ว
 * → **นับรวมในใบเดิม ไม่สร้างใบใหม่** (`return null` ⇒ `trg_notify_push` ไม่ยิงตาม = ไม่มีเสียงเด้งซ้ำ)
 *
 * 🔴 กติกาที่ฝังไว้ อย่ารื้อ:
 *  1. **ปิดเป็นค่าตั้งต้น** (`inapp_rollup_min` null) — ทุกเรื่องที่ไม่ได้ตั้ง = พฤติกรรมเดิมเป๊ะ
 *     เรื่องด่วนรายใบ (เช่น `downtime_call_mtn` เรียกช่างเข้าหน้างาน) **ห้ามเปิด** — ทุกใบต้องดังของมันเอง
 *  2. **ไม่มี `link` ในทะเบียน = ยุบไม่ได้** — ใบรวมชี้ไปที่ใบเดี่ยวใบใดใบหนึ่งไม่ได้ (มันรวมหลายใบ)
 *     ไม่มีหน้ารวมให้กดไปดู = กดแล้วไปไหนไม่ได้ ⇒ ปล่อยเป็นใบเดี่ยวเหมือนเดิม (fail-open)
 *  3. 🔴 **ห้ามขยับ `created_at` ของใบรวม** — หน้าต่างถูกวัดจาก "ใบแรกของกลุ่ม"
 *     ถ้าเลื่อนตามใบล่าสุด หน้าต่างจะไถไปเรื่อยๆ = ใบเดียวดูดทุกอย่างไม่มีวันจบ
 *  4. **ยุบเฉพาะใบที่ยังไม่อ่าน** — อ่านไปแล้วคือรับรู้แล้ว ของใหม่ต้องเป็นใบใหม่ ห้ามแอบต่อท้าย
 *  5. ใบรวม **ล้าง `ref_id`/`ref_table` ทิ้ง** แล้วใช้ `link` ของทะเบียน — ไม่งั้น `fn_notification_fill_link`
 *     จะพาไปใบเดี่ยวใบเดียว ทั้งที่ข้อความบอกว่ามี N รายการ (จอโกหก)
 *
 * ⚠️ ลำดับ trigger สำคัญ: `trg_notification_fill_link` (f) ต้องมาก่อน `trg_notification_rollup` (r)
 *    — Postgres เรียง trigger ตามชื่อ · ตัวแรกเป็นคนเติม `event_key` ให้ ถ้าสลับกัน `event_key`
 *      จะยังว่างตอนตัวนี้ทำงาน = ไม่ยุบอะไรเลยเงียบๆ
 *
 * ย้อนกลับ: drop trigger + function (คอลัมน์ทิ้งไว้ได้ ไม่มีใครพัง — default เดิมทั้งคู่)
 * ปลายทาง: **Main (MAIN · ewhdfqwfwofivojtsizn)**
 * ══════════════════════════════════════════════════════════════════════════════════ */

alter table public.notification_rules
  add column if not exists inapp_rollup_min int;

comment on column public.notification_rules.inapp_rollup_min is
  'ยุบกระดิ่งซ้ำ: ภายในกี่นาที ถ้าคนเดิมยังไม่ได้อ่านใบเดิมของเรื่องนี้ ให้นับรวมในใบเดิมแทนการสร้างใบใหม่ · null/0 = ปิด (พฤติกรรมเดิม) · ต้องมี link ในทะเบียนด้วยจึงจะยุบ';

alter table public.notifications
  add column if not exists rollup_count int not null default 1;

comment on column public.notifications.rollup_count is
  'ใบนี้รวมเหตุการณ์ไว้กี่รายการ (1 = ใบเดี่ยวปกติ) — ดู fn_notification_rollup';

create or replace function public.fn_notification_rollup()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_min  int;
  v_link text;
  v_id   uuid;
  v_cnt  int;
begin
  /* ยังไม่รู้ว่าเรื่องอะไร (trigger เติม event_key รันก่อนหน้าแล้วยังว่าง) = ยุบไม่ได้ ต้องปล่อยผ่าน */
  if new.event_key is null or new.user_id is null or coalesce(new.is_read, false) then
    return new;
  end if;

  select r.inapp_rollup_min, r.link into v_min, v_link
    from notification_rules r
   where r.event_key = new.event_key;

  if coalesce(v_min, 0) <= 0 then return new; end if;   -- ปิดอยู่ = พฤติกรรมเดิม (ข้อ 1)
  if v_link is null then return new; end if;            -- ไม่มีหน้ารวมให้กดไปดู = ห้ามยุบ (ข้อ 2)

  /* ⚠️ `order by created_at asc` = **ใบแรกของกลุ่ม** ไม่ใช่ใบล่าสุด — สมอของหน้าต่าง (ข้อ 3) */
  select n.id, n.rollup_count into v_id, v_cnt
    from notifications n
   where n.user_id   = new.user_id
     and n.event_key = new.event_key
     and not n.is_read
     and n.created_at > now() - make_interval(mins => v_min)
   order by n.created_at asc
   limit 1
   for update skip locked;

  if v_id is null then return new; end if;              -- ยังไม่มีกลุ่ม = ใบนี้เป็นใบแรก ดังตามปกติ

  update notifications
     set rollup_count = v_cnt + 1,
         body = left(coalesce(new.body, ''), 200)
                || ' · (รวม ' || (v_cnt + 1)::text || ' รายการ — กดเพื่อดูทั้งหมด)',
         link = v_link,
         ref_id = null,
         ref_table = null
   where id = v_id;

  return null;   -- ⛔ ไม่ insert ใบใหม่ ⇒ AFTER INSERT (trg_notify_push) ไม่ทำงาน = ไม่มี push ซ้ำ
end;
$function$;

drop trigger if exists trg_notification_rollup on public.notifications;
create trigger trg_notification_rollup
  before insert on public.notifications
  for each row execute function public.fn_notification_rollup();

/* ── เปิดให้เรื่องที่วัดแล้วว่าท่วมจริง (7 วัน) ────────────────────────────────────────
 *   mtn_checked  4,921 ใบ (พีค 113 ใบ/คน/วัน · อ่าน 3.3%)   mtn_reported 2,610 (พีค 25)
 *   mtn_assigned 2,215 (พีค 25)   mtn_repaired 2,050 (พีค 23)   mtn_handover 516 (พีค 28)
 *   mtn_closed   460 (พีค 27)     mtn_qa 763                    mtn_qa_skipped
 * หน้าต่าง 180 นาที = burst เคลียร์งานค้าง (23/09 กิน 4 ชม.) ยุบเหลือ ~2 ใบแทน 113
 *   แต่ของใหม่ที่เข้ามาอีกหลายชั่วโมงถัดมา ยังดังของมันเองอยู่ (ไม่ใช่ปิดเสียงทั้งวัน)
 * ⚠️ ทั้ง 8 เรื่องนี้ไม่มี `link` ในทะเบียน ⇒ ต้องตั้งให้ด้วย ไม่งั้นข้อ 2 จะกันไว้ไม่ยุบเลย
 *    ตั้ง `/mtn-repair` **ไม่กระทบ deep link รายใบ** — `fn_notification_fill_link` ให้
 *    `ref_table='mtn_orders'` ชนะก่อนเสมอ (ใบเดี่ยวยังกดไปถึงใบนั้นเหมือนเดิม)
 * ── 🚫 ห้ามเปิดให้ `downtime_call_mtn` (เรียกช่างด่วน) — ทุกใบต้องดังของมันเอง */
update public.notification_rules
   set inapp_rollup_min = 180,
       link = coalesce(link, '/mtn-repair')
 where event_key in ('mtn_checked', 'mtn_reported', 'mtn_assigned', 'mtn_repaired',
                     'mtn_qa', 'mtn_qa_skipped', 'mtn_handover', 'mtn_closed');
