# 🪜 StepFlow — แถบ "ตอนนี้ถึงขั้นไหน" ✓—✓—⑦—○ ของใบที่ส่งต่อกัน (2026-11-12)

> คำสั่ง user 12/11: *"เราชอบการแสดงว่าตอนนี้ถึงขั้นตอนไหนแบบนี้"* → *"ใส่แถบขั้นตอนแบบนี้ในใบ MO กับ 4M ด้วย และเช็คกับทุกงานที่มีการส่งต่อข้อมูลกัน"*
> กติกาหน้าตา → `docs/UI-CONVENTIONS.md` §6.30 · component `src/components/StepFlow.jsx` · helper กลาง `src/utils/stepFlow.js` (`linearFlow()`)

## กฎ
1. **component ไม่รู้ธุรกิจ** — รับ `steps/waiting/unknown/compact` แล้ววาด · **กฎขั้นอยู่ใน utils เจ้าของสถานะของโมดูลนั้น** (ตารางข้างล่าง) ห้ามเขียน `status === 'x'` ในหน้า
2. ใบที่เดินเส้นตรงตามสถานะใช้ `linearFlow({ status, steps, at, exits })` — `at[status] = index ขั้นปัจจุบัน` (= `steps.length` คือจบครบ) · `exits[status]` = จบแบบไม่ปกติ (ยกเลิก/ตีกลับ) หยุดที่ขั้น `at` ใส่ `tone` + label
3. 🔴 **สถานะที่กฎไม่รู้จัก = `known:false`** → แถบเขียน "สถานะนี้ระบบไม่รู้จัก" **ห้ามเดา** (mock ของ audit ใช้ `status:'open'` จึงเห็นข้อความนี้ทุกหน้า — ถูกต้องแล้ว)
4. 🔴 **ขั้นที่ "ไม่ต้องทำ" (ข้าม QA · งานดีจบที่ขั้น 2 · ทำลายข้ามซ่อม) = `skipped` ⏭ เหลือง ห้าม ✓ เขียว** (= โกหกว่ามีคนตรวจ)
5. ใบที่ถูกตีกลับ/ยกเลิก = หยุดที่ขั้นที่ตก สีตาม tone (แดง = ตีกลับ · เทา = ยกเลิก/ส่งต่อ) ไม่ใช่เขียวยาว
6. `compact` (วงเล็ก ไม่มีป้าย · ป้ายใน title) ใช้ในแถวตาราง/การ์ดเล็ก · ใบเต็ม (โมดัล/drawer) ใช้แบบเต็ม + บรรทัด "⏳ รอ: ใคร — ทำอะไร"
7. เทส: `stepFlow.test.mjs` (helper + flow ที่สถานะอยู่ในหน้า) · `moduleFlows.test.mjs` (flow ของโมดูล) · `mktRfq/mtnStepPerm/fourMFlow.test.mjs`

## ใส่แล้ว (17 ใบ)

| ใบ | กฎขั้น (ที่เดียว) | วาดที่ | แบบ |
|---|---|---|---|
| RFQ (Marketing) | `rfqFlow()` `utils/mktRfq.js` | `pages/Rfq.jsx` RfqSheet | เต็ม |
| ใบ MO (JIG/DIE/PD 7 ขั้น · MTN 8 ขั้น · ข้าม QA · รอ supplier) | `moFlow()` `utils/mtnStepPerm.js` | `pages/MtnRepair.jsx` DetailDrawer | เต็ม |
| ใบขอซื้อ (PR) ในใบ MO | `prFlow()` `utils/mtnPurchase.js` | `components/MtnPurchase.jsx` PrRow | ย่อ |
| 4M (ยื่น → SV → QA → มีผล) | `fourMFlow()` `utils/fourMFlow.js` | `pages/Report.jsx` แท็บ 4M ช่องสถานะ | ย่อ |
| ถังเหลือง/ถังแดง (5 ขั้น · branching ผ่าน `ncStep`) | `ncFlow()` `utils/qualityBin.js` | `components/QualityBins.jsx` (QC queue + /scrap-report?tab=bins) | ย่อ |
| NCR | `ncrFlow()` `utils/qaDocStatus.js` | `pages/QualityControl.jsx` โมดัล NCR | เต็ม |
| CAPA / 8D | `capaFlow()` `utils/qaDocStatus.js` | `pages/QualityControl.jsx` โมดัล 8D | เต็ม |
| เคลมลูกค้า | `claimFlow()` `utils/qaDocStatus.js` | `components/QaClaims.jsx` ClaimModal | เต็ม |
| ใบขอเบิก/คืน FM-STO-003 | `matReqFlow()` `utils/materialRequest.js` | `components/MaterialRequests.jsx` Editor | เต็ม |
| ใบรายงานของเสีย FM-PD2-002 | `scrapReportFlow()` `utils/stepFlow.js` | `pages/ScrapReport.jsx` Editor | เต็ม |
| ECI (NPI) | `eciFlow()` `utils/npi.js` | `components/NpiDrawingsEci.jsx` eciModal | เต็ม |
| PPAP / PSW (NPI) | `ppapFlow()` `utils/npi.js` | `components/NpiPartPanel.jsx` ppapModal (ตามสถานะที่เลือก) | เต็ม |
| คำขอแก้เอกสาร PE (8D/Improvement → PE) | `crFlow()` `utils/peLink.js` | `components/PeChangeRequests.jsx` CrRow | ย่อ |
| ผลต่างรับ-ส่ง (สโตร์ ↔ ผลิต) | `discrepancyFlow()` `utils/stockDiscrepancy.js` | `components/StockDiscrepancyReport.jsx` | ย่อ |
| ขอปิดกะ (leader → SV) | `shiftCloseFlow()` `utils/stepFlow.js` | `pages/DailyReport.jsx` การ์ดกะใน sidebar | ย่อ |
| ใบ OJT FM-HRM-004 (ผู้สอน → ระดับจัดการ → HR) | `ojtFlow()` `utils/stepFlow.js` (ตัดสินจากช่องเซ็นจริง) | `pages/OjtTraining.jsx` โมดัล | เต็ม |
| แผนประสานงาน PM (MTN → ผลิต) | `pmCoordinationFlow()` `utils/stepFlow.js` | `pages/PmCoordination.jsx` แถวที่กาง | เต็ม |

## เช็คแล้ว **ไม่ใส่** (เหตุผลรายตัว — อย่ารื้อกลับโดยไม่อ่าน)

| งาน | ทำไม |
|---|---|
| CQI-15 event log (`/event-log`) | **ขนาน** ไม่ใช่ลำดับ — 4 ฝ่าย (O/ME/JME/QT) เซ็นคนละแถวไม่มีก่อน-หลัง ⇒ ชิปรายฝ่ายที่มีอยู่ถูกแล้ว แถบเส้นตรงจะโกหกลำดับ |
| NPI เฟส APQP (`NpiPartPanel`) | มีแถบเฟสของตัวเองแล้ว (การ์ดเฟสเรียงแนวนอน + นับ deliverable) · ทีมเดียวทำ ไม่ใช่ส่งต่อข้ามแผนก |
| NPI deliverables | เลือกสถานะรายรายการใน select — ไม่มีใบให้เปิด |
| ใบตรวจ QA ทีละชิ้น (`QaPieceStepper`) | เป็นลูปตรวจ (ตกแล้ววนใหม่) ไม่ใช่สายงานส่งต่อ |
| FME (ชิ้นแรก/กลาง/ท้าย) | 3 สถานะ แสดงบนบอร์ดกระเบื้องด้วยสีอยู่แล้ว |
| บอร์ดสโตร์ (`/heijunka` · `/rack-center` · child lot · purchase) | kanban = คอลัมน์สถานะคือแถบขั้นในตัว การ์ดอยู่คอลัมน์ไหน = ถึงขั้นนั้น |
| ตัดสินครั้งเดียว: ขอปรับยอดคลัง · ขึ้นขั้นทักษะ · PE master proposal · CT proposal · อนุมัติใบตรวจ AM/PM | pending → approved/rejected ขั้นเดียว แถบ 2 จุดไม่บอกอะไรเพิ่มจากชิป |
| action item ประชุมเช้า/Obeya | open → doing → done ของคนเดียวกัน ไม่มีการส่งต่อ |
| ซ่อมภายนอก (`MtnOutsource`) | 2 สถานะ (ของออก/ของกลับ) — ป้ายวันที่พอ |
| Kaizen/Improvements · BBS · LPA · PPE · OT · feedback inbox · safety event · plating | ไม่มีสายอนุมัติ หรือ open/closed ขั้นเดียว |
| ใบรายงานปัญหาการผลิต (`prodProblemDoc`) | ใบพิมพ์มีเลขที่ ไม่มีสถานะ — การส่งต่ออยู่ในสายถังเหลือง (ใส่แล้ว) |

## ประวัติ
- 2026-11-12 สร้าง component + RFQ → MO/4M → inventory 25 flow (agent) → ใส่ 17 ใบ · ไม่ใส่ตามตารางบน
