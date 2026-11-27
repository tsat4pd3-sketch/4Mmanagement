# 📈 Live Benefits — ประโยชน์จาก ESM นับสด (`/live-benefits` · 2026-11-26)

> โหลดไฟล์นี้**เฉพาะเมื่อแตะโมดูลนี้** · หน้า `src/pages/LiveBenefits.jsx` · สูตร `src/utils/paperBenefits.js` (+ เทส `__tests__/paperBenefits.test.mjs`)
> migration `20261126_live_benefits_main.sql` (Main) + `20261126_live_benefits_dr.sql` (DR) — **apply แล้ว 26/11**

## โจทย์ (คำสั่ง user 26/11)
- "ทำหน้า live benefits ของโปรแกรม มุม paperless กับการลดขั้นตอน/ลดเวลา (Digital Transformation) ในหมวดผู้บริหาร"
- "ฟอร์มเอกสารทั้งหมดในแพลตฟอร์มที่มีระบบ export = แทบจะทดแทนการใช้กระดาษ เพราะอยากได้ hard copy ค่อยปริ้น
  **แค่มองให้ออกว่าเอกสารไหนรายกะ เอกสารไหนรายเดือน**"
- ก่อนหน้า (รายงาน/เด็ค 23/11): **ใบเช็ครายวันส่วนใหญ่ = เดือนละ 1 ใบ ต่อกะ ต่อไลน์** (ตรวจ 5 วันไม่ใช่ 5 ใบ) ·
  เช็คชื่อ = รายเดือนต่อไลน์×กะ · AM = รายเดือนต่อเครื่อง×กะ · Poka-yoke = รายเดือนต่ออุปกรณ์×กะ

## ออกแบบ
| ชั้น | อยู่ที่ | หน้าที่ |
|---|---|---|
| รายชื่อฟอร์ม | `doc_forms` (ทะเบียนเอกสาร — ฟอร์ม export ทุกตัวต้องลงอยู่แล้ว) | **ไม่มีลิสต์มือ** · ฟอร์มใหม่ที่ลงทะเบียน = โผล่หน้านี้เอง |
| รอบการออกใบ | `doc_forms.paper_basis` + `paper_unit` (แก้ที่ `/doc-forms` ไม่ต้อง deploy) | `shift` ออกทุกกะ · `month` เดือนละใบ · `quarter` ทุก 3 เดือน · `event` ต่อเรื่อง · `document` เอกสารควบคุม · `report` รายงาน/ส่งออก · `other` ป้าย/แม่แบบ · `null` ยังไม่จัด |
| ตัวนับ | RPC `esm_benefits_rollup(p_from)` **ชื่อเดียวกันทั้ง 2 project** | คืน `(kind, key, month_key, n, val)` · `paper`: n = แผ่น · val = ครั้งที่บันทึก · `flow`: n = ตัวอย่าง · val = มัธยฐาน · **นับอย่างเดียว ไม่คิด KPI** |
| ประกอบ/คาดการณ์ | `utils/paperBenefits.js` | `buildPaperModel` · `buildFlowModel` · `flowTrend` · `keyingHours` · **ห้ามคิดซ้ำในหน้า** |

- **Main RPC** = `SECURITY DEFINER` + `has_perm('page:/live-benefits')` (นับทั้งโรงงาน · คืนแค่ตัวเลขรวม) · ไม่มีสิทธิ์ = `42501` → จอเขียนบอก
- **DR RPC** = `SECURITY INVOKER` (anon — กฎเหล็ก supabaseDR) · grant anon/authenticated
- seed สิทธิ์ `page:/live-benefits` = admin/manager (ระบุ role ตรงๆ ไม่ใช้ `enum_range`)
- **ไม่ scope ตามส่วนงาน** (จอผู้บริหาร precedent `/adoption-outlook`)

## 🔴 กฎของโมดูล
1. **"แผ่น" ≠ "ครั้งที่บันทึก"** — ใบรายเดือน 1 แผ่นถูกเติมทุกวัน ⇒ กระดาษนับแผ่น · งานคีย์ Excel นับครั้ง · ห้ามรวมเป็นเลขเดียว
2. **เดือนที่ยังไม่จบ:** ใบรายกะ/รายเรื่อง คาดการณ์เต็มเดือน (`projectFactor` = วันในเดือน ÷ วันทำงานที่ผ่านมา) ·
   **ใบรายเดือนห้ามคูณแผ่น** (เปิดครบตั้งแต่ต้นเดือน) แต่ "ครั้งที่บันทึก" คาดการณ์ได้ · จอต้องเขียนว่าคาดการณ์
3. **ฟอร์มยังไม่จัดรอบ / จัดแล้วแต่ยังนับสดไม่ได้ ต้องโชว์** (NoticeBar + แท็บ 📋) ห้ามหายเงียบ
4. **`document`/`report`/`other` ไม่นับเป็นกระดาษที่ทดแทน** (เอกสารควบคุมแก้เป็นครั้งคราว · รายงาน = สรุปจากข้อมูลที่บันทึกแล้ว)
5. **แนวโน้มเวลา (`flowTrend`) ต้องโชว์ 2 มุม:** เทียบฐาน + เทียบเดือนก่อน — ดีขึ้นจากฐานแต่แย่ลงจากเดือนก่อน = ต้องเห็นทั้งคู่ ·
   เดือนที่ตัวอย่าง `< MIN_FLOW_SAMPLE` (30) ไม่ใช้ตัดสิน (เคสจริง: 4M พ.ย. อนุมัติแค่ 5 ใบ = ใบที่เร็วรอดมา ไม่ใช่ดีขึ้น)
6. ชั่วโมงคนที่ประหยัด = **ประมาณการ** (นาที/ครั้ง ผู้ดูปรับเองได้ · จำในเครื่องด้วย localStorage) — ต้องจับเวลาจริงก่อนแปลงเป็นเงิน

## วิธีนับรายฟอร์ม (ตรงกับ SQL ใน migration)
| doc_key | project | แผ่น | ครั้งที่บันทึก |
|---|---|---|---|
| `daily_production_report` | DR | กะ (`production_sessions` open/pending_close/closed) | = แผ่น |
| `xlsx_am_monthly` (AM) | DR | เครื่อง × กะ ต่อเดือน (`inspections` ของทีม `mtn_teams.kind='am'` · กะจากเวลาตรวจ 08–19 = เช้า) | ครั้งที่ตรวจ |
| `pm_jig` (FM-JIG-003) | DR | ครั้งที่ตรวจ (inspections ที่ไม่ใช่ AM) | = แผ่น |
| `mo_report` (+ `mo_report_mtn`) | DR | ใบซ่อมที่ไม่ยกเลิก — **2 ฟอร์มนับรวมใต้ `mo_report`** (แยกฟอร์มต้องใช้ `isMtnFormRow` ฝั่ง JS) | = แผ่น |
| `qbin_red` / `qbin_yellow` | DR | ไลน์ × วัน | รายการชิ้นงาน |
| `prod_problem_report` · `scrap_report` · `improvement_a3` | DR | ใบ | = แผ่น |
| `attendance_record` (เช็คชื่อ+PPE) | Main | ไลน์ × กะ ต่อเดือน | ไลน์ × กะ × วัน |
| `lpa_plan` · `lpa_report` | Main | แผน (ไลน์ × กะ × เดือน) | รายงาน: ครั้งที่ตรวจ (`lpa_audits`) |
| `bbs_observation` | Main | `bbs_sheets` (ไลน์ × กะ × เดือน) | = แผ่น |
| `changing_point` (FM-PD-037) | Main | ไลน์ ต่อเดือน | รายการ 4M |
| `cqi15_event_log` | Main | ไลน์ ต่อเดือน | เหตุการณ์ |
| `qa_inspection_sheet` · `ojt` | Main | ใบ | = แผ่น |
| `multi_skill` (FM-PD1-017 skill matrix) | Main | ไลน์ ต่อไตรมาส — วางที่เดือนต้นไตรมาส · **ทะเบียนทักษะไม่มีประวัติรายไตรมาส ⇒ ใช้ภาพปัจจุบัน** (migration `20261126b_…`) | ช่องคะแนนทักษะ |
| `pokayoke_check` | Main | อุปกรณ์ × กะ ต่อเดือน — **ไม่อยู่ใน `doc_forms`** (ยังไม่มีแบบพิมพ์) ⇒ อยู่ใน `EXTRA_FORMS` | ครั้งที่ตรวจ |

**ตัวชี้วัดเวลา (`FLOW_METRICS`):** แจ้งซ่อม→ช่างรับงาน · แจ้งซ่อม→ซ่อมเสร็จ · % ใบซ่อมที่เปิดต่อจาก downtime/ผลตรวจ AM ·
ปิดกะหลังเลิกกะ (DR) · 4M ยื่น→อนุมัติครบ (Main)

## เพิ่มฟอร์ม/ตัวชี้วัดใหม่
- **ฟอร์มใหม่** — ลงทะเบียน `doc_forms` ตามกฎเดิม แล้วตั้ง `paper_basis`/`paper_unit` ที่ `/doc-forms` ⇒ โผล่ในแท็บ 📋 ทันที
  (สถานะ "ยังนับสดไม่ได้") · **นับสด** = เติม 1 บล็อก `union all` ใน RPC ของ project ที่ตารางอยู่ (key = doc_key) — ไม่ต้องแก้หน้า
- **ตัวชี้วัดเวลาใหม่** — เติม `union all` kind='flow' ใน RPC + 1 entry ใน `FLOW_METRICS`
- ฟอร์มที่ทำในระบบแต่ไม่มีแบบพิมพ์ = `EXTRA_FORMS` (พอมีแบบพิมพ์แล้วให้ลง `doc_forms` แล้วลบออกจาก `EXTRA_FORMS`)

## รอบ 2 (26/11 · user "ใบ OJT เซ็นในจอได้ทั้งหมด · ใบ skill matrix อัพทุก 3 เดือน = ลดกระดาษ")
- เพิ่ม `paper_basis='quarter'` + `multi_skill` = quarter ต่อไลน์ · OJT นับอยู่แล้ว (รายเรื่อง — ใบละครั้งที่อบรม)

## ยังไม่ทำ (เฟสถัดไป)
- นับสดฟอร์มรายเรื่องที่เหลือ: `material_request` · `pm_coordination` · `ot_booking` · `ot_compensation_report` · `morning_meeting` ·
  `mkt_production_*` · `individual_skill` (จัดรอบแล้ว ขึ้นป้าย "ยังนับสดไม่ได้")
- แยก MO 2 ฟอร์มรายฟอร์ม (ต้องย้ายกฎ `isMtnFormRow` ไปฝั่ง SQL หรือเก็บธงฟอร์มในแถว)
- ความถูกต้องของ `paper_basis` ที่ seed ไว้ = ผู้พัฒนาจัดตามรูปฟอร์มพิมพ์ — ให้ document control ทบทวนที่ `/doc-forms`
