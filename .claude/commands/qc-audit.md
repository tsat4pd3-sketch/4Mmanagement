---
description: รัน QC audit ตรวจทั้งโปรเจคว่ามีโค้ดขัดกับกฎโปรเจค (CLAUDE.md / UI-CONVENTIONS.md / PERMISSIONS-DESIGN.md) หรือไม่
---

รัน QC audit ของโปรเจค ESM โดยใช้ agent `qc-project-rules` (อ่านอย่างเดียว ไม่แก้โค้ด)

Arguments (ถ้ามี): `$ARGUMENTS`
- ว่าง = ตรวจทุกหมวด (A–G)
- ระบุหมวด เช่น `B D` = ตรวจเฉพาะหมวดนั้น
- ระบุ path เช่น `src/pages/DailyReport.jsx` = ตรวจทุกหมวดเฉพาะไฟล์/โฟลเดอร์นั้น

## วิธีรัน

1. ถ้าตรวจ**ทุกหมวดทั้งโปรเจค** ให้ fan-out เป็น 4 subagents ขนานกัน (subagent_type: `qc-project-rules`)
   แบ่งหมวดกันชัดเจน เพื่อไม่ให้ context ของ agent เดียวล้น:
   - Agent 1: หมวด A (Date/Time) + หมวด B (Supabase 2 projects)
   - Agent 2: หมวด C (Permissions) + หมวด D (Section scoping)
   - Agent 3: หมวด E (Storage/รูป) + หมวด G (Workflow/เอกสาร)
   - Agent 4: หมวด F (UI Conventions) — หมวดใหญ่สุด แยกเดี่ยว
2. ถ้าระบุหมวด/ไฟล์มา ให้รัน agent เดียวตรวจตามที่ระบุ
3. รวมผลจากทุก agent เป็นรายงานเดียว จัดกลุ่ม 🔴 กฎเหล็ก / 🟡 convention / 🔵 legacy-ข้อสังเกต / ✅ ผ่าน
   - รายการซ้ำระหว่าง agent ให้ dedup (file:line เดียวกัน + กฎเดียวกัน = รายการเดียว)
   - เรียง 🔴 ก่อนเสมอ พร้อมวิธีแก้ที่เจาะจง
4. **ห้ามแก้โค้ดใดๆ ระหว่าง audit** — audit คือรายงาน ถ้า user อยากให้แก้จะสั่งต่อเอง
5. ปิดท้ายรายงานด้วยสรุปตัวเลขรวม และเสนอลำดับการแก้ (🔴 ก่อน)
