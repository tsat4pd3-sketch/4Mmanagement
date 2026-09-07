# ผังรวมโรงงาน — ผังภาพรวมทั้งโรงงานที่เดียว (ยุบรวมแล้ว 2026-07-16)

> ย้ายมาจาก `CLAUDE.md` (2026-09-03 — แยกไฟล์เพื่อลด context) · โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน


**ผังรวมโรงงาน = `/factory-map` (FactoryMap) ที่เดียวเท่านั้น** — polygon ต่อไลน์ + หลายโหมด (ยอดผลิต/OEE/Downtime/ของเสีย/คน/**PM เครื่องจักร**) ดู "Factory Master Map" ด้านบน
- ⚠️ **เคยทำ MTN org map แยก (แท็บ "ภาพรวม Org" ใน `/mtn-layout` + component `FactoryPlanManager` ใน LineSetup) แล้วมันซ้ำซ้อนกับ `/factory-map` → ยุบทิ้งแล้ว** (2026-07-16) · `/mtn-layout` เหลือปุ่มลิงก์ "🗺️ ภาพรวมทั้งโรงงาน" → `/factory-map` แทน · **อย่าสร้างผังรวมโรงงานอันใหม่ ให้ต่อยอดที่ `/factory-map`**
- ตาราง `pm_org_nodes` (migration `20260716_pm_org_nodes.sql`) เป็น vestigial (additive ไม่ลบ แต่ไม่มีโค้ดใช้แล้ว) · ถ้าอยากได้ signal "ใบซ่อม MO ค้าง" บนผังรวม ให้เพิ่มเป็น metric ใน FactoryMap (มี Downtime/PM mode อยู่แล้ว)
