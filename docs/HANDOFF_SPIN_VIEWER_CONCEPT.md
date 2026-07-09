# HANDOFF — 360° Spin Viewer สำหรับวางจุดตรวจ (concept อนุมัติแล้ว รอ implement)

> จาก session QA/QC (2026-07-09) → ส่งต่อให้ session ตรวจสอบเครื่องจักร (PM)
> User ชอบ concept นี้และเห็นว่าเหมาะกับฝั่งตรวจเครื่องจักร/JIG — เอาไปพิจารณา implement ฝั่ง PM ได้เลย

## Concept (คุยกับ user แล้ว เลือกแนวทางนี้)

ปัญหา: อุปกรณ์/ชิ้นงานจริงเป็น 3 มิติ รูปเดียวหรือแบบ 2D มุมเดียววางจุดตรวจไม่ครบทุกด้าน

ทางเลือกที่ประเมินให้ user แล้ว:
1. 3D จริงจากไฟล์ CAD (three.js + GLB) — ทำได้ ~2–4 วัน แต่ติดที่ต้องขอไฟล์ CAD ต่อชิ้น → เก็บไว้เป็น phase ถัดไป
2. **360° spin จากรูปถ่ายหลายมุม — ✅ user เลือกแบบนี้** (ไม่ต้องมี CAD)
3. Photogrammetry สร้าง 3D จากรูป — ตัดทิ้ง (ยาก+ไม่เสถียรกับผิวโลหะสะท้อนแสง)

### พฤติกรรมที่ตกลงกัน (แบบที่ 2)

- ถ่ายรูปอุปกรณ์/ชิ้นงานรอบตัว **12–24 เฟรม** (แท่นหมุนหรือเดินถ่ายรอบ, มุมห่างสม่ำเสมอ ~15–30°, ฉากหลังเรียบ)
- อัพโหลดทั้งชุด → viewer เดียว **ลากนิ้ว/เมาส์ = หมุน** เหมือนดูสินค้าเว็บช้อปปิ้ง
- จะวางจุดตรวจ: หมุนไปมุมที่เห็นจุดชัด → คลิกวาง pin — **pin ผูกกับเฟรมนั้น** หมุนกลับมาเฟรมนี้ pin โผล่
- รูป/แบบ 2D ทางการยังอัพเป็นแผ่นแยกคู่กันได้ (spin ไว้จำตำแหน่งจริง, 2D ไว้อ้างอิงสเปคเอกสาร)
- Effort ประเมินไว้ **~1–2 วัน** ต่อฝั่ง ไม่มี breaking change

## โค้ดอ้างอิงฝั่ง QA (ทำ multi-sheet เสร็จแล้ว ใช้เป็นต้นแบบได้)

ฝั่ง QA (`/qa-setup`) มีโครง "หลายแผ่นต่อ 1 part + balloon ผูกแผ่น" ใช้งานอยู่แล้ว — spin viewer คือ data โครงเดียวกัน แค่เพิ่ม UX หมุน:

- `src/pages/QAInspectionSetup.jsx` — tab strip เลือกแผ่น, upload หลายแผ่น, click-to-place balloon ต่อแผ่น, ย้าย balloon ข้ามแผ่น, นับ balloon ต่อแผ่น
- `supabase/migrations/20260709_qa_part_multi_drawings.sql` — pattern ตาราง `qa_part_drawings (id, part_id fk cascade, title, drawing_url, sort)` + `qa_inspection_items.drawing_id fk set null` + migrate รูปเดี่ยวเดิม + backfill
- สิ่งที่ต้องเพิ่มสำหรับ spin: flag ว่ารูปชุดนี้เป็น spin set + ลำดับเฟรม (ใช้ `sort` ที่มีอยู่ได้) แล้วทำ viewer แบบ drag→เปลี่ยนเฟรม (preload รูปทั้งชุด, `pointermove` คำนวณ delta → index)

## แนวทาง map เข้าฝั่ง PM (เครื่องจักร/JIG)

สถานะปัจจุบันฝั่ง PM: `jigs.image_path` = รูปเดียวต่ออุปกรณ์, `jig_checkpoints.x_pos/y_pos` = pin บนรูปนั้น (0–1), setup ใน `PMSetup.jsx` (ImageAnnotator), แสดงใน `PMCheckData.jsx`

ที่ต้องทำ (เทียบเคียง pattern ฝั่ง QA):
1. ตารางใหม่ฝั่ง **DR project** เช่น `jig_images (id, jig_id fk cascade, title, image_path, sort, is_spin_frame bool)`
2. `jig_checkpoints add column image_id uuid references jig_images(id) on delete set null` — pin ผูกเฟรม/แผ่น
3. Migrate `jigs.image_path` เดิม → แถวแรกใน `jig_images` + backfill `image_id` ให้ checkpoint ที่มี x_pos
4. `PMSetup.jsx`: ImageAnnotator รองรับหลายรูป (tab/spin), `PMCheckData.jsx` + export แสดง pin ตามเฟรม

## ⚠️ กฎเหล็กฝั่ง DR project (ย้ำ — เคยพังมาแล้ว)

- DR project `eyhclzkifitbhbljgoav` ผ่าน client `supabaseDR` วิ่งด้วย role **anon เสมอ** — ตารางใหม่ต้อง RLS **anon-friendly**: `create policy x on public.y for all to anon, authenticated using (true) with check (true);` **ห้าม `TO authenticated`**
- Migration files เก่าล้าสมัย — **verify live schema ก่อนเสมอ** (`execute_sql` project `eyhclzkifitbhbljgoav`) ตารางจริงคือ `jigs/checklists/jig_checkpoints/inspections/inspection_results`
- เขียน migration file ลง `supabase/migrations/` และ commit เสมอ
- วันที่ใช้ helper local time ห้าม `new Date().toISOString()` หา work date (ดู CLAUDE.md)

## คำถามเปิด (ตัดสินใจตอน implement)

- spin set กับรูปแผ่นเดี่ยวปนกันใน list เดียว หรือแยก section
- จำนวนเฟรมขั้นต่ำที่ยอมรับ (แนะนำ ≥8) และ validate ตอนอัพโหลด
- บีบอัดรูปต่อเฟรม (ฝั่ง PM มี `imageCompression` pipeline อยู่แล้วใน PMSetup — ใช้ซ้ำได้เลย)
