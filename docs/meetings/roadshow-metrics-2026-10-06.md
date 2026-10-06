# Roadshow metrics (before vs after ESM): ข้อมูลจริงจากฐาน, ชุดที่ 1 (ยังไม่ครบ)

- **วันที่คิวรี:** 2026-10-06 (เดือน 2026-10 มีข้อมูลแค่ 1–6 ต.ค. ทุกตารางจึงเป็น **เดือนไม่เต็ม**)
- **วิธีเก็บ:** Supabase MCP `execute_sql` ใช้ SELECT อย่างเดียว · Main = `ewhdfqwfwofivojtsizn` ("MAIN") · DR = `eyhclzkifitbhbljgoav` ("Product DB")
- **การจัดเดือน:** ตัด timestamp ตามเวลาไทย (`at time zone 'Asia/Bangkok'`) · production_sessions ใช้ `work_date`
- **ค่ากลาง:** `percentile_cont(0.5)` = median และ `percentile_cont(0.8)` = P80 · คิดเฉพาะแถวที่มี timestamp ทั้งสองฝั่ง
- **ยังเก็บไม่ครบ:** ระหว่างเก็บ MCP เริ่มตอบ `FgaApiAuthenticationError: Unauthorized` ทุกคำสั่ง และเรียก REST ตรงไม่ได้เพราะ sandbox บล็อก host supabase · หัวข้อที่ขึ้นว่า **ยังไม่ได้คิวรี** ต้องรันต่อเมื่อ MCP กลับมาใช้ได้ (คำสั่ง SQL ที่เตรียมไว้อยู่ท้ายไฟล์)
- **ไม่มีตัวเลขยุคกระดาษในระบบ** · ทุกแนวโน้มในไฟล์นี้เทียบกัน "ภายในระบบ" คือเดือนแรกที่ใช้ เทียบกับเดือนล่าสุด

---

## 1. ฝ่ายผลิต → ซ่อมบำรุง (DR)

### 1a. เรียกช่างจากใบ downtime (`downtime_logs`)
นิยาม: response = `call_mtn_ack_at − call_mtn_at` (หน่วยนาที) · reporters = `count(distinct reported_by_uid)`

| เดือน | ใบ downtime | เรียกช่าง | ช่างรับทราบ | median รับทราบ (นาที) | P80 (นาที) | คนลงใบ |
|---|---|---|---|---|---|---|
| 2026-06 | 141 | 0 | 0 | – | – | 8 |
| 2026-07 | 2,541 | 3 | 1 | 1,940 (มี 1 ใบ) | – | 14 |
| 2026-08 | 3,688 | 58 | 52 | 3.6 | 529.2 | 16 |
| 2026-09 | 3,792 | 287 | 279 | 6.2 | **30.2** | 21 |
| 2026-10* | 408 | 32 | 31 | 9.0 | 27.6 | 16 |

สรุป: ส.ค. → ก.ย. ค่า P80 ของการรับทราบลดจาก 529 นาทีเหลือ 30 นาที (หาง 20% ที่ช้าสุดหดลงราว 17 เท่า) ขณะที่จำนวนการเรียกช่างผ่านระบบเพิ่มประมาณ 5 เท่า · **ค่า median ขยับขึ้นเล็กน้อย** (3.6 → 6.2 → 9.0 นาที) ต้องพูดตรงๆ บนเวที

### 1b. ใบแจ้งซ่อม MO (`mtn_orders`)
นิยาม: เดือนตาม `coalesce(report_at, created_at)` · รับงาน = `accept_at − report_at` · ซ่อมเสร็จ = `repair_done_at − report_at` (หน่วยชั่วโมง)

| เดือน | MO | จาก downtime | จากใบตรวจ PM | % จาก downtime | median รับงาน (ชม.) | P80 รับงาน | median ซ่อมเสร็จ (ชม.) | P80 ซ่อมเสร็จ | ปิดอนุมัติแล้ว (approve_at) |
|---|---|---|---|---|---|---|---|---|---|
| 2026-07 | 4 | 1 | 0 | 25% | 16.18 | 25.87 | 16.23 | 25.91 | 2 |
| 2026-08 | 73 | 59 | 0 | 81% | 0.06 (~4 นาที) | 7.46 | 0.15 (~9 นาที) | 7.91 | 68 |
| 2026-09 | 499 | 304 | 2 | 61% | 0.09 (~5 นาที) | **0.55** (~33 นาที) | 0.15 | **0.93** (~56 นาที) | 252 |
| 2026-10* | 66 | 31 | 0 | 47% | 0.20 (~12 นาที) | 0.79 | 0.27 | 1.15 | 2 |

### 1c. downtime → MO → ปิดงาน (เฉพาะ MO ที่ผูก `source_downtime_id`)
นิยาม: downtime→MO = `mo.report_at − downtime.started_at` (นาที) · ซ่อมเสร็จ→ตรวจรับ = `check_at − repair_done_at` (ชม.) · ปิดใบ = `approve_at − report_at` (ชม.)

| เดือน | n | median downtime→MO (นาที) | P80 | median ซ่อมเสร็จ→ตรวจรับ (ชม.) | median แจ้ง→ปิดอนุมัติ (ชม.) | P80 |
|---|---|---|---|---|---|---|
| 2026-07 | 1 | 657 | – | 113.6 | 147 | – |
| 2026-08 | 51 | 7.7 | 43.7 | 0.01 | 397 (~16.5 วัน) | 459 |
| 2026-09 | 294 | 3.2 | 22.3 | 4.28 | 97 (~4 วัน) | 201 |
| 2026-10* | 31 | **2.7** | **13.5** | 0.83 | ยังไม่มีใบปิด | – |

### 1d. ⚠️ คอขวดงานเอกสารหลังซ่อม (สถานะ MO ณ 2026-10-06)
| status | ใบ | หมายเหตุ |
|---|---|---|
| closed | 324 | |
| **checked** | **205** | ผู้แจ้งตรวจรับแล้ว แต่ `qa_at` ว่างทุกใบ · `check_at` เก่าสุด 2026-08-27 · median ค้าง 13 วัน |
| repaired | 43 | ซ่อมเสร็จแต่ยังไม่ตรวจรับ · median ค้าง 5.9 วัน |
| pending | 32 | |
| assigned | 13 | |
| qa | 11 | median ค้าง 4.1 วัน |
| transferred / returned / handover / rejected | 5 / 4 / 3 / 2 | |

การซ่อมจริงเร็ว (median < 10 นาที) แต่**การปิดใบช้า** เพราะค้างที่ขั้นตรวจรับและ QA

---

## 2. ฝ่ายผลิต → หัวหน้างาน: ปิดกะ (`production_sessions`, DR)
นิยาม: อนุมัติปิดกะ = `closed_at − close_requested_at` (นาที) · OEE stamped = `oee is not null` · openers/closers = distinct uid

| เดือน (work_date) | กะ | ปิดแล้ว | มี OEE | % OEE | ขอปิด | median อนุมัติ (นาที) | P80 (นาที) | ถูกตีกลับ | คนเปิดกะ | คนอนุมัติ |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-06 | 20 | 20 | 13 | 65% | 13 | 44.9 | 507 | 0 | 5 | 4 |
| 2026-07 | 353 | 353 | 248 | 70% | 344 | 279.5 | 882 | 3 | 14 | 4 |
| 2026-08 | 497 | 497 | 488 | **98%** | 493 | 559.4 | 2,372 | 6 | 13 | 4 |
| 2026-09 | 505 | 502 | 485 | 96% | 474 | 782.3 | 2,218 | 1 | 21 | **9** |
| 2026-10* | 113 | 92 | 87 | 95% | 74 | 169.7 | 956 | 0 | 14 | 8 |

สถานะรวมตอนนี้: closed 1,464 · pending_close 13 · open 11

สรุป: กะที่มี OEE ขึ้นจาก 70% เป็น 96–98% (ได้ OEE ของทุกกะทันทีที่ปิด ไม่ต้องรอคีย์ Excel) · **แต่การอนุมัติปิดกะช้าลง** (median ก.ค. 4.7 ชม. → ก.ย. 13 ชม.) และ P80 อยู่ราว 1.5 วัน · ในเดือน ก.ย. คนอนุมัติเพิ่มจาก 4 เป็น 9 คน · ต.ค. (ข้อมูล 6 วัน) median ลงมาที่ 2.8 ชม. แต่ยังมีใบ pending ที่ไม่ได้นับรวม จึงต้องรอข้อมูลทั้งเดือนก่อนอ้าง

---

## 3. 4M Change (`four_m_logs`, Main)
นิยาม: SV = `sv_approved_at − created_at` · Final = `approved_at − created_at` (ชั่วโมง) · creators = distinct `created_by`

| เดือน | ใบ | approved | rejected | ค้าง | median SV (ชม.) | P80 SV | median Final (ชม.) | P80 Final | คนสร้าง |
|---|---|---|---|---|---|---|---|---|---|
| 2026-05 | 433 | 102 | 326 | 5 | 52.3 | 75.9 | 1,916 | 1,980 | 6 |
| 2026-06 | 146 | 145 | 0 | 1 | 21.0 | 103.0 | 133 | 2,008 | 4 |
| 2026-07 | 356 | 351 | 0 | 5 | 267.2 | 288.1 | 288 | 1,247 | 3 |
| 2026-08 | 194 | 194 | 0 | 0 | 283.1 | 447.6 | 417 | 469 | 4 |
| 2026-09 | 126 | 125 | 0 | 1 | **1.0** | 113.4 | 243 | 328 | 4 |
| 2026-10* | 19 | 19 | 0 | 0 | null | null | null | null | 0 |

⚠️ **ยังไม่ควรขึ้นจอ:** ข้อมูลชุดนี้มีสัญญาณว่าเป็นการอนุมัติทีละก้อน (batch) และมีใบที่ระบบสร้างเอง · rejected 326 ใบในเดือน พ.ค. น่าจะเป็นการเคลียร์คิวใบระบบตามกฎ `docs/modules/four-m-workflow.md` · ใบเดือน ต.ค. ไม่มี `created_by` และไม่มี timestamp อนุมัติ · ต้องแยกใบคน/ใบระบบให้ได้ก่อน (คิวรีเตรียมไว้แล้วแต่ยังไม่ได้รัน เพราะ MCP ใช้ไม่ได้) · ข้อมูลที่ยืนยันได้ตอนนี้: ก.ย. หัวหน้างานอนุมัติ 4M ได้ใน median 1 ชม.

---

## 4–9. ยังไม่ได้คิวรี (MCP ใช้ไม่ได้ระหว่างเก็บ)
- 4 Store: `wip_replenish_requests` (Main; คอลัมน์ `requested_at/picked_at/delivered_at/received_at` + uid ครบ) · `child_lot_requests` (DR; ไม่มีคอลัมน์ timestamp ตอนจ่ายของ วัดได้แค่จำนวน/สถานะ) · `raw_withdrawal_requests` (มีแค่ `created_at,status` วัด lead time ไม่ได้) · `kanban_deliveries` (`confirmed_at`, `received_at`) · `stock_receipts` (`created_at → received_at`)
- 5 Planning: `demand_mail_inbox` (`received_at → handled_at`) · `demand_upload_batches` (`uploaded_at`) · `customer_shipping_orders` (`shipped_at` เทียบ `due_date`)
- 6 Quality: `defect_logs` → `quality_bin_records.qa_decision_at` · `lpa_audits` (`audit_date, layer`)
- 7 PM · 8 จำนวนฟอร์มที่เลิกใช้กระดาษ · 9 คนใช้งานรายแผนก

### SQL ที่เตรียมไว้ให้รันต่อ
```sql
-- Main: เติมของ WIP
select to_char(requested_at at time zone 'Asia/Bangkok','YYYY-MM') m, count(*) n, count(delivered_at) delivered,
 percentile_cont(0.5) within group (order by extract(epoch from delivered_at-requested_at)/60) del_med_min,
 percentile_cont(0.8) within group (order by extract(epoch from delivered_at-requested_at)/60) del_p80_min
from wip_replenish_requests group by 1 order by 1;
-- Main: แยกใบ 4M ของคน กับใบที่ระบบสร้าง
select to_char(created_at at time zone 'Asia/Bangkok','YYYY-MM') m, count(*) n, count(created_by) has_creator,
 count(sv_approved_at) has_sv, count(approved_at) has_final from four_m_logs group by 1 order by 1;
-- DR: ส่งของลูกค้าตรงเวลา
select to_char(due_date,'YYYY-MM') m, count(*) n, count(shipped_at) shipped,
 count(*) filter (where (shipped_at at time zone 'Asia/Bangkok')::date <= due_date) on_time
from customer_shipping_orders where status <> 'cancelled' group by 1 order by 1;
-- DR: อีเมล EDI รับเข้า → นำเข้าระบบ
select to_char(received_at at time zone 'Asia/Bangkok','YYYY-MM') m, count(*) n, count(handled_at) handled,
 percentile_cont(0.5) within group (order by extract(epoch from handled_at-received_at)/3600) med_h
from demand_mail_inbox group by 1 order by 1;
-- DR: ถังเหลือง/แดง QA ตัดสิน
select to_char(created_at at time zone 'Asia/Bangkok','YYYY-MM') m, count(*) n, count(qa_decision_at) decided,
 percentile_cont(0.5) within group (order by extract(epoch from qa_decision_at-created_at)/3600) med_h
from quality_bin_records group by 1 order by 1;
```

---

## ตารางสรุปข้ามแผนก (ส่วนที่มีข้อมูลจริงแล้ว)

| งานส่งต่อระหว่างแผนก | นิยาม | เดือนแรกที่มีข้อมูลพอ | ล่าสุด (ก.ย. เดือนเต็ม) | จำนวน (ก.ย.) |
|---|---|---|---|---|
| ผลิต → ช่าง: เรียกแล้วรับทราบ | ack − call, P80 | ส.ค. 529 นาที | **30 นาที** | 279 ครั้ง |
| ผลิต → ช่าง: เครื่องหยุดจนเปิด MO | report − downtime start, median | ส.ค. 7.7 นาที | **3.2 นาที** (ต.ค. 2.7) | 294 ใบ |
| ผลิต → ช่าง: แจ้งจนซ่อมเสร็จ | repair_done − report, P80 | ส.ค. 7.9 ชม. | **0.93 ชม.** | 456 ใบ |
| ผลิต → ช่าง → ผู้แจ้ง/QA: แจ้งจนปิดใบ | approve − report, median | ส.ค. 397 ชม. | **97 ชม.** (ยังช้า) | 294 ใบ |
| ผลิต → หัวหน้า: ขอปิดกะจนอนุมัติ | closed − close_requested, median | ก.ค. 4.7 ชม. | **13 ชม. (แย่ลง)** | 474 กะ |
| ผลิต → ผู้บริหาร: กะที่ได้ OEE ทันที | % sessions with oee | ก.ค. 70% | **96%** | 485 กะ |

## ข้อควรระวัง
- เดือน ต.ค. มีข้อมูลแค่ 6 วัน · เดือน มิ.ย./ก.ค. ข้อมูลน้อย ค่า median จึงไม่เสถียร
- MO ค้างสถานะ `checked` 205 ใบ (ไม่มี `qa_at` ทุกใบ) และ `repaired` 43 ใบ ทำให้เวลาปิดใบดูช้า ต้องเคลียร์คิวหรือทบทวนว่าขั้น QA จำเป็นหรือไม่
- การอนุมัติปิดกะช้าลงเมื่อเทียบกับเดือนแรก
- ตัวเลข 4M มีใบที่ระบบสร้างเองปนอยู่และมีการอนุมัติแบบ batch ห้ามนำไปอ้างจนกว่าจะแยกใบได้
- uid ฝั่ง DR เป็นค่าที่ client ประทับมา (anon) จึงใช้นับคนได้ แต่ไม่ใช่ลายเซ็นที่ยืนยันได้ และอาจมีการใช้บัญชีร่วมกัน
