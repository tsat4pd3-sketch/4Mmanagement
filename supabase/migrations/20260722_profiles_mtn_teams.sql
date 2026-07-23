-- profiles.mtn_teams — ทีมช่างซ่อมที่ user สังกัด (แยกคิวใบแจ้งซ่อม MO ให้ถูกทีม · 2026-07-22)
-- แยกจาก profiles.sections (ที่คุม scope ข้อมูลฝ่ายผลิต) โดยตั้งใจ — ทีมช่างไม่ควรไปกรองข้อมูลผลิตราย section
-- ค่าที่ถูกต้อง = subset ของ MTN_TEAMS ใน src/utils/mtnTeams.js: JIG MTN / DIE MTN / MTN / PRODUCTION
-- ตั้งจากหน้า /add-user (โผล่เฉพาะ role งานซ่อม: mtn/engineer/leader/supervisor) · consumer: teamsForUser() → MtnRepair คิวงาน
-- additive + nullable → backward-compatible (null/ว่าง = fallback เดาทีมจาก section เหมือนเดิม)

alter table public.profiles
  add column if not exists mtn_teams text[];

comment on column public.profiles.mtn_teams is
  'ทีมช่างซ่อมที่ user สังกัด (JIG MTN/DIE MTN/MTN/PRODUCTION) — แยกคิวใบแจ้งซ่อม MO · แยกจาก sections (scope ผลิต)';
