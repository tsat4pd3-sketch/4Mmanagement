# Daily Report — ไลน์ผสมหลาย process (welding + metal forming ในไลน์เดียว · 2026-07-22)

> ย้ายมาจาก `CLAUDE.md` (2026-09-03 — แยกไฟล์เพื่อลด context) · โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน


**dropdown ประเภท Downtime/งานเสีย ใช้ `sessionProcessTypesAll()` (union ทุก process ที่มีเครื่อง/สินค้าจริงใน**ครอบครัวไลน์** — แม่+ลูกทั้งหมดผ่าน `getLineFamilyNames` ไม่ใช่ชื่อไลน์ตรงเป๊ะ: กะมักเปิดบนไลน์ลูก แต่เครื่องลงทะเบียนใต้ไลน์พี่น้อง · แก้ 2026-07-24)** — เดิมใช้ `sessionProcessType()` (เสียงข้างมากตัวเดียว) ทำให้ไลน์ผสม เช่น LWR (laser=metal_forming + Stationary=welding_assembly) มองไม่เห็นประเภทของอีก process (เคสจริงจาก supervisor Assy2) · ประเภทที่ `process_type` = null/common เห็นเสมอทั้งสอง dropdown · **break policies ยังใช้ majority ตัวเดียว (`sessionProcessType`) โดยตั้งใจ** — union จะหักเวลาพักซ้ำสอง policy · ทางแก้ฝั่งข้อมูล: ประเภทที่อยากให้เห็นทุกไลน์ตั้ง process = "🔗 ทุกกระบวนการ" ใน ⚙️ ตั้งค่า
