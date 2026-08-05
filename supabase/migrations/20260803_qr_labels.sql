-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- หน้า 🏷️ พิมพ์ป้าย QR อุปกรณ์ (/qr-labels) + ทะเบียนเอกสารของแผ่นป้าย
--
-- ป้าย QR ติดเครื่องจักร/จิ๊ก → สแกนเลือกอุปกรณ์ได้ทันทีในหน้าแจ้งซ่อม/ตรวจ PM/บันทึก Downtime
-- (ตัวอ่าน = src/components/ScanModal.jsx · รูปแบบรหัส = src/utils/qrCode.js)

-- 1) สิทธิ์เข้าหน้า — ดูได้ทุก role (หน้าอ่านอย่างเดียว + พิมพ์)
--    ⚠️ seed ด้วย enum_range = ล็อกรายชื่อ role ณ ตอนนี้ · role ที่เพิ่มทีหลังต้องติ๊กเองที่ /permissions
insert into role_permissions (role, permission_key, allowed)
select r, 'page:/qr-labels', true from unnest(enum_range(null::user_role)) r
on conflict (role, permission_key) do nothing;

-- 2) สิทธิ์สั่งพิมพ์ป้าย (คุมจำนวนสติกเกอร์ที่พิมพ์ออกมา)
insert into permission_catalog (resource, action, label, group_name, sort)
values ('qr_labels', 'print', 'ป้าย QR: สั่งพิมพ์ป้ายอุปกรณ์', 'ตั้งค่าโปรแกรม,ฐานข้อมูล', 210)
on conflict (resource, action) do nothing;

insert into role_permissions (role, permission_key, allowed)
select r, 'qr_labels:print', (r::text in ('admin','manager','supervisor','mtn','engineer'))
from unnest(enum_range(null::user_role)) r
on conflict (role, permission_key) do nothing;

-- 3) ทะเบียนเอกสาร — แผ่นป้าย QR (กฎ CLAUDE.md: เอกสาร export ใหม่ทุกตัวต้อง register)
--    form_code = null → ยังไม่ตั้งเลขฟอร์มทางการ = แผ่นป้ายหน้าตาเดิมเป๊ะ
--    doc_control ตั้งเลขฟอร์มเมื่อไหร่ แถบเลขฟอร์มจะโผล่บนหัวแผ่นเอง ไม่ต้องแก้โค้ด
insert into doc_forms (doc_key, form_code, title, rev, effective_date, paper, used_route, sig_blocks)
values ('qr_label', null, 'ป้าย QR อุปกรณ์ (เครื่องจักร/จิ๊ก/แม่พิมพ์)', null, null, 'A4 (สติกเกอร์หลายดวง)', '/qr-labels', null)
on conflict (doc_key) do nothing;
