# PM Photo-Compare Inspection — ❌ ถอดออกแล้ว (2026-07-22)

> ย้ายมาจาก `CLAUDE.md` (2026-09-03 — แยกไฟล์เพื่อลด context) · โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน


**ถอดระบบเทียบรูปเงา (photo-hunt / PhotoCompareModal) ออกทั้งหมด** ตามคำสั่ง user: มันไม่ได้เทียบความเหมือนด้วย AI (แค่ wipe/blink/diff เงา) — ไม่คุ้ม · **ใช้ฟีเจอร์ที่มีอยู่พอ = เห็นรูปมาตรฐาน + เห็นจุดที่ต้องเช็ค**
- ลบ `src/components/PhotoCompareModal.jsx` + ปุ่ม "เทียบรูป/ตั้งรูปมาตรฐาน" + การเก็บรูปหลักฐาน NG (evidenceBlobs) ออกจาก PMCheckData
- **ยังเหลือ:** `CpImage` แสดง thumbnail รูปมาตรฐาน (`jig_checkpoints.image_path`) คลิกเปิดเต็มจอ บนทุกแถวจุดตรวจ — ผู้ตรวจเห็นรูป+จุดที่ต้องเช็คได้เหมือนเดิม · ตั้งรูปมาตรฐานที่ PMSetup (เหมือนเดิม)
- คอลัมน์ `inspection_results.evidence_path` (migration `20260715_inspection_evidence_photo.sql`) เป็น vestigial — ไม่เขียนใหม่แล้ว แต่ HistoryModal ยังโชว์รูปหลักฐานเก่าถ้ามี (harmless) · ไม่ต้อง rollback migration
- **ถ้าจะทำ AI ตรวจสภาพจริง** (YOLO/anomaly) ค่อยเริ่มใหม่เป็นระบบแยก — การเทียบเงาเฉยๆ ไม่เหมาะ (user ยืนยัน)

---
