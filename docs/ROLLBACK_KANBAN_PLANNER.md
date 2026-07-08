# Rollback Plan — Heijunka Kanban Smart Scheduling Planner

> สำหรับกรณีพบบัคหลัง merge ฟีเจอร์ "ตู้ KANBAN แม่นยำ + Smart Scheduling Planner" เข้า main
> (branch: `claude/fable-focus-kanban-accuracy-qga2hq`)

## จุดยึดก่อนเปลี่ยนแปลง (baseline)

- **main ก่อน merge:** commit `5143c32` — "Merge branch 'claude/youthful-mayer-5ztqqm' into main"
- ไฟล์ที่เปลี่ยนมีไฟล์เดียว: `src/pages/HeijunkaKanban.jsx` (ไม่มี migration / schema / Edge Function เปลี่ยน)
- ตาราง DB ที่ระบบเขียนยังใช้คอลัมน์เดิมทั้งหมด — ข้อมูลที่บันทึกระหว่างใช้เวอร์ชันใหม่ **ไม่ต้อง migrate กลับ**

## วิธี Rollback (เลือกอย่างใดอย่างหนึ่ง)

### วิธีที่ 1 — Revert merge commit (แนะนำ · ปลอดภัยสุด · ไม่แตะประวัติ)

```bash
git checkout main && git pull origin main
# หา SHA ของ merge commit ฟีเจอร์นี้
git log --oneline --merges | grep fable-focus-kanban
git revert -m 1 <merge-sha>
git push origin main
```

Render.com จะ auto-deploy main ที่ revert แล้วให้เอง

### วิธีที่ 2 — ย้อนเฉพาะไฟล์เดียวกลับ baseline (ถ้าอยากเก็บ commit อื่นบน main ไว้)

```bash
git checkout main && git pull origin main
git checkout 5143c32 -- src/pages/HeijunkaKanban.jsx
git commit -m "Rollback HeijunkaKanban to pre-planner baseline (5143c32)"
git push origin main
```

## รอบแก้ที่ 2 — Batch confirm บน Dashboard/Management timeline

- **main ก่อน merge รอบ 2:** commit `01889c4`
- ไฟล์ที่เปลี่ยน: `src/pages/Dashboard.jsx`, `src/pages/Management.jsx`
- เนื้อหา: ใบกัมบังที่พนักงานสแกนปิดรวดเดียวทั้งล็อต (ห่างกัน ≤5 นาที) จะถูกตัดสิน
  "ปิดช้า (ส้ม ✓!)" ที่ใบสุดท้ายของชุดเท่านั้น ไม่ตีส้มใบแรก ๆ ของชุดอีก
- Rollback เฉพาะรอบนี้: `git revert -m 1 <merge-sha รอบ 2>` หรือ
  `git checkout 01889c4 -- src/pages/Dashboard.jsx src/pages/Management.jsx`

## สิ่งที่ต้องรู้ตอน rollback

1. **ยอดสต็อกจาก "ยืนยันส่ง" ต่างกันสองเวอร์ชัน** — เวอร์ชันใหม่บันทึก `line_stock_transactions`
   เป็นยอด NET เฉพาะรอบนั้น (ถูกต้อง) ส่วนเวอร์ชันเก่าบันทึกยอดทั้งวันตั้งแต่รอบแรก
   ถ้า rollback กลางวันงาน ให้เช็คยอดคงเหลือที่ 📦 Line Stock ของวันนั้นด้วย
2. ธุรกรรมที่เกิดไปแล้วเป็นแถวปกติในตาราง ลบ/แก้ได้จากหน้า Line Stock ตามขั้นตอนปกติ
3. หน้าที่ควรทดสอบหลัง rollback: `/heijunka` ทุก view (ตู้รวม / Store Board / Heijunka Board /
   Pull / การ์ด / ตาราง) + การยืนยันส่งและรับของ 1 รอบ
