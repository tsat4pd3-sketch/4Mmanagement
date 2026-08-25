# QC Flow Audit — สายธารความต้องการทั้ง loop (2026-08-25)

> **ที่มา:** คำสั่ง user *"เร่ง qc audit multi agent เช็ค workflow ทั้งหมด ตาม loop สายธารความต้องการ"*
> รันด้วย Workflow multi-agent 6 โดเมน (find → adversarial verify ต่อ finding) · 11 agents · ~71 นาที
> ครอบ: Sales/EDI → คลัง FG → ผลิต FG → ระเบิด BOM/backflush/accumulator → สโตร์ชั้นใน → Kanban/รอบส่ง/จัดซื้อ
> ผล: **ยืนยัน 45 · needs_db 3 · หักล้างแล้ว 0** — ทุกข้อผ่านด่าน verify ที่ต้องมี "อินพุตจริง → ผลลัพธ์ผิด" + file:line
> raw JSON: scratchpad `flow_audit.json` (session 7b0b1595) · script: `qc-demand-flow-audit` (runId wf_78897c97-068)

## สถานะรวม

| กลุ่ม | นับ |
|---|---|
| ✅ แก้แล้ว (commit `b272e1d` + งาน session ขนาน) | ดูตาราง |
| 🔴 รอฝั่ง DB (ต้องได้ dump ฟังก์ชันสด / รัน SQL โดย user) | #10/#18 · #11/#17 · #12 · #26 |
| ⏸ ต้อง deploy edge function (จัด batch กับ user) | #5 · #28 · #31 |
| ⬜ ค้างฝั่ง client (เหลือง/ฟ้า) | ที่เหลือ — ทยอยเคลียร์ |

## ตารางรวม findings

| # | สี | โดเมน | ไฟล์:บรรทัด | เรื่อง | สถานะ |
|---|---|---|---|---|---|
| 0 | 🔴 | ขาออก FG | `src/pages/CustomerDemand.jsx:158` | coverage + การหักสต็อกตอนกดส่ง นับ/หักจาก 'ทุกคลัง' — กฎ 'คลัง FG เท่านั้น' ไม่เคยตามมาถึง CustomerDemand | ✅ แก้แล้ว (b272e1d 2026-08-25) |
| 1 | 🔴 | ขาออก FG | `src/pages/RundownStock.jsx:100` | Rundown นับสต็อกก้อนเดียวกันซ้ำหลายแถว — จัดกลุ่มด้วยเลขบน order แต่ start ดึง onHand[stockMat] เต็มก้อนโดยไม่แชร์ pool | ✅ แก้แล้ว (b272e1d 2026-08-25) |
| 2 | 🟡 | ขาออก FG | `src/pages/RundownStock.jsx:98` | Rundown เหมา status 'sap'/'mapped_nostock' เป็น ❔ 'ยังจับคู่เลขไม่ได้' — พาร์ทที่ขาดหนักสุดหลุดจาก shortCount ขณะ CustomerDemand เคสเดียวกันขึ้นแดงนับเข้า | ✅ แก้แล้ว (b272e1d 2026-08-25) |
| 3 | 🟡 | ขาออก FG | `src/pages/CustomerDemand.jsx:150` | pnIndex ของ Delivery ไม่กรอง is_active — แถวที่ถูก EC superseded ทำ p_no กลายเป็น ambiguous แล้วการหักสต็อกอัตโนมัติหยุดทำงาน (drift จาก Rundown ที่กรองแล้ว) | ✅ แก้แล้ว (b272e1d 2026-08-25) |
| 4 | 🟡 | ขาออก FG | `src/pages/CustomerDemand.jsx:257` | advance() หักสต็อกจาก snapshot ใน state โดยไม่ re-fetch — หน้านี้ไม่มี polling · atomic guard กันเฉพาะใบเดียวกัน | ✅ แก้แล้ว (b272e1d 2026-08-25) |
| 5 | 🟡 | ขาออก FG | `supabase/functions/shipping-phase-scan/index.ts:82` | workflowLive (shipping-phase-scan v3) — query 30 วันไม่เช็ค error + ติดเพดาน 1000 แถวเงียบ + ตัดสินจากสถานะปัจจุบันที่ transient | ⏸ ต้อง deploy edge shipping-phase-scan — จัด batch แยกกับ user |
| 6 | 🟡 | ขาออก FG | `src/pages/CustomerDemand.jsx:129` | ตัวนับ '⏰ ค้างส่งจากวันก่อน' หลุดใบกะดึก (ตี 0-7 โมงของวันนี้) ของวันงานที่เพิ่งจบ — query กรอง due_date < day เท่านั้น | ✅ แก้แล้ว (b272e1d 2026-08-25) |
| 7 | 🔵 | ขาออก FG | `src/pages/CustomerDemand.jsx:285` | insert consume ล้มด้วย error อื่น (ไม่ใช่ 42703) → ไหลเข้าข้อความวินิจฉัย 'ของยังไม่เคยถูกบันทึกเข้า' ที่ขัดกับความจริง | ✅ แก้แล้ว (b272e1d 2026-08-25) |
| 8 | 🔵 | ขาออก FG | `src/pages/CustomerDemand.jsx:109` | deleteManualOrder ลบได้ 0 แถวแต่ toast 'ลบแล้ว' — pattern 'สำเร็จ 0 แถว' ที่ CLAUDE.md ห้าม | ✅ แก้แล้ว (b272e1d 2026-08-25) |
| 9 | 🔵 | ขาออก FG | `src/pages/CustomerDemand.jsx:239` | chain สถานะเดินหน้าอย่างเดียว ไม่มีทางย้อน — กด 'ส่งแล้ว' พลาด = consume + Telegram + สถานะ ถาวรทั้งชุด | ⏸ backlog (ออกแบบ undo chain — product decision) |
| 10 | 🔴 | ผลิต FG → เข้าคลังอัตโนมัติ | `src/pages/DailyReport.jsx:1526` | ยอดผลิตบางส่วนของใบที่ยกยอด/ยกเลิก ไม่เคยเข้าคลังเลย — โพสต์เฉพาะ 'ส่วนที่เหลือ' ตอนปิดใบสุดท้าย | 🔴 รอ DB — ต้องแก้ trigger/flow ปิดกะ (ดู §DB) |
| 11 | 🔴 | ผลิต FG → เข้าคลังอัตโนมัติ | `supabase/migrations/20260821_explode_demand_lot_guard.sql:31` | ถอยใบแล้วสแกนปิดใหม่ → fn_explode_child_demand ระเบิด demand ซ้ำ 2 เท่า (ไม่มี dedup ต่อใบแบบฝั่ง inflow) | 🔴 รอ DB — ต้อง dump ฟังก์ชันสดจาก user ก่อน (ดู §DB) |
| 12 | 🟡 | ผลิต FG → เข้าคลังอัตโนมัติ | `supabase/migrations/20260820_op_items_never_enter_stock.sql:17` | OP guard มีอยู่แค่ใน DB — ไฟล์ migration ล่าสุดในรีโปที่ create or replace fn_post_confirmed_output (20260714) ไม่มี guard → replay/ยกร่างครั้งหน้า guard หายเงียบ | ✅ commit เวอร์ชันจริงจาก dump ของ user เข้ารีโปแล้ว (`20260825_sync_fn_post_confirmed_output.sql` — DB มีอยู่แล้ว ไม่ต้องรัน) |
| 13 | 🟡 | ผลิต FG → เข้าคลังอัตโนมัติ | `src/pages/DailyReport.jsx:1533` | handleImportCarryOrders ไม่ส่งต่อ is_manual/qty_target — ใบ manual ที่ยกยอดกลายเป็นใบสแกนในกะถัดไป (ปิดใบด้วยยอดจริงไม่ได้ + เข้าคลังด้วยเป้าแทนยอดจริง) | ✅ แก้แล้ว (batch 2 · 2026-08-25) |
| 14 | 🟡 | ผลิต FG → เข้าคลังอัตโนมัติ | `src/pages/DailyReport.jsx:1097` | กันเปิดใบซ้ำเช็คจาก state ฝั่ง client อย่างเดียว — 2 เครื่องสแกนการ์ดใบเดียวกันพร้อมกัน = ใบซ้ำ → เข้าคลัง 2 เท่า | ✅ ฝั่ง client แก้แล้ว (แปลง 23505) · ด่านจริง = migration `20260825_prod_orders_session_prodno_unique.sql` (DR — รอ user รัน) |
| 15 | 🔵 | ผลิต FG → เข้าคลังอัตโนมัติ | `src/pages/DailyReport.jsx:1885` | ปิดกะเลือก 'ผลิตครบแล้ว' เขียนทับ qty_actual ด้วยเป้า — ใบ manual ที่ทำเกินเป้าเสียยอดจริง + เข้าคลังต่ำกว่าจริง | ✅ แก้แล้ว (batch 2 · 2026-08-25) |
| 16 | 🔵 | ผลิต FG → เข้าคลังอัตโนมัติ | `src/pages/DailyReport.jsx:1051` | attachMachine ใช้ try{await ...update()}catch{} — supabase-js ไม่ throw = error ถูกกลืนโดย catch ที่ไม่มีวันทำงาน | ✅ แก้แล้ว (batch 2 · 2026-08-25) |
| 17 | 🔴 | ระเบิด BOM + backflush + accumulator | `src/pages/DailyReport.jsx:1281` | ถอยใบ (↩️) แล้วสแกนปิดใหม่ = fn_explode_child_demand ระเบิด BOM ซ้ำ 2 รอบ — หักมินิสโตร์ซ้ำ + demand สะสมซ้ำ | 🔴 รอ DB — เรื่องเดียวกับ #11 |
| 18 | 🔴 | ระเบิด BOM + backflush + accumulator | `src/pages/DailyReport.jsx:1526` | ใบยกยอดข้ามกะ: ยอดที่ผลิตจริงในกะแรก (qty_actual) ไม่เคยผ่าน trigger — backflush/demand/FG stock ของส่วนนั้นหายถาวร | 🔴 รอ DB — เรื่องเดียวกับ #10 |
| 19 | 🔴 | ระเบิด BOM + backflush + accumulator | `src/pages/FlowTower.jsx:76` | FlowTower ดึง purchase_requests ทั้งตารางไม่ paginate — ตารางเกิน 1000 แถวแล้ว (≥1,026) ตัวเลขสถานี 'สั่งซื้อวัตถุดิบ' ผิดเงียบ | ✅ แก้แล้ว (b272e1d 2026-08-25) |
| 20 | 🟡 | ระเบิด BOM + backflush + accumulator | `supabase/migrations/20260819_demand_flow_routing.sql:128` | ยอดค้างเกินเพดาน MAX_LOTS มองไม่เห็นที่ไหนเลย — v_demand_flow_blocks กรอง lot_size>0 ทิ้ง ขัดกับที่ comment ใน guard migration อ้างไว้เอง | ⬜ ยังไม่แก้ |
| 21 | 🟡 | ระเบิด BOM + backflush + accumulator | `supabase/migrations/20260821_explode_demand_lot_guard.sql:43` | race ตอน 2 ใบปิดพร้อมกันบนไลน์เดียว: อ่าน on-hand จาก view แล้วค่อย insert consume — หักเกินจริง + demand หาย | ⬜ ยังไม่แก้ |
| 22 | 🟡 | ระเบิด BOM + backflush + accumulator | `src/pages/FlowTower.jsx:181` | สถานี/ข้อต่อ 'สั่งซื้อวัตถุดิบ' ไม่มีทางเป็น ✅ ไหลจริง — ขัดนิยาม 4 สถานะของหน้าตัวเอง | ✅ แก้แล้ว (batch 2 · 2026-08-25) |
| 23 | 🔵 | ระเบิด BOM + backflush + accumulator | `supabase/migrations/20260821_explode_demand_lot_guard.sql:38` | trigger ระเบิด demand ไม่กัน is_operation — guard 'OP ห้ามเข้าคลัง' (20260820) แก้เฉพาะ fn_post_confirmed_output | ⬜ ยังไม่แก้ |
| 24 | 🔵 | ระเบิด BOM + backflush + accumulator | `supabase/migrations/20260821_void_lot_size_typo_purchase_requests.sql:21` | ยกเลิกใบสั่งซื้อไม่คืนยอดเข้า accumulator — pattern เสี่ยงถ้ามี cancel path ในอนาคต (ผลกระทบเคสจริงวันนี้เล็ก) | ⬜ ยังไม่แก้ |
| 25 | 🔵 | ระเบิด BOM + backflush + accumulator | `src/pages/FlowTower.jsx:111` | fcastQty ดึง customer_forecasts (โดน cap 1000) ทุกรอบ poll + ทุก realtime event แต่ไม่เคยถูกแสดงผล — egress เปล่า + กับดักรอ | ✅ แก้แล้ว (batch 2 · 2026-08-25) |
| 26 | 🔴 | Store ชั้นใน | `supabase/migrations/20260821_store_abnormal_view.sql:40` | เคส C ของ v_store_abnormal ไม่ frame-aware — รอบหลังเที่ยงคืน (00:00-07:59) หลุดผ่านตัวกรอง hour<20 แล้วถูกตีเป็น "เลยเวลา" ปลอม | 🔴 รอ DB — แก้วิว v_store_abnormal (ดู §DB) |
| 27 | 🟡 | Store ชั้นใน | `supabase/migrations/20260821_store_abnormal_view.sql:29` | เคส A/B เทียบ min/max ระดับ "ต่อ mat" กับ on-hand ระดับ "ต่อ location" + แถว (line,mat) ที่ net เป็น 0 ค้างในวิวตลอดกาลแล้วยิง sev 3 รายวัน | ⬜ ยังไม่แก้ |
| 28 | 🟡 | Store ชั้นใน | `supabase/functions/store-daily-scan/index.ts:41` | สแกนรายวัน 08:30 + วิวเช็คเฉพาะ work_date วันนี้ → เคส C/D ของวันที่เพิ่งจบไม่มีทางเข้า Telegram เชิงโครงสร้าง | ⏸ ต้อง deploy edge store-daily-scan — จัด batch แยก |
| 29 | 🟡 | Store ชั้นใน | `src/pages/LineStock.jsx:183` | reviewTxn อนุมัติ/ปฏิเสธคิว adjust ไม่นับแถวที่เขียนจริง — 2 คนตัดสินพร้อมกันได้ toast โกหก | ✅ แก้แล้ว (batch 2 · 2026-08-25) |
| 30 | 🟡 | Store ชั้นใน | `src/pages/LineStock.jsx:119` | โหลด line_stock_summary ทั้ง view ไม่แบ่งหน้า 4 จุด (LineStock ×2, FlowTower, DeptDashboard) — เกิน 1000 แถวเมื่อไหร่ของหายเงียบ | ✅ แก้แล้ว (batch 2 · 2026-08-25) |
| 31 | 🟡 | Store ชั้นใน | `supabase/functions/store-daily-scan/index.ts:66` | ขาส่งแจ้งเตือนของ store-daily-scan กลืนความล้มเหลว 2 ชั้น (.catch เงียบ + ไม่เช็ค res.ok) — Telegram ตายได้เป็นเดือนโดย scan รายงาน ok | ⏸ ต้อง deploy edge store-daily-scan — จัด batch แยก |
| 32 | 🔵 | Store ชั้นใน | `supabase/migrations/20260821_store_abnormal_view.sql:42` | นิยาม dwell ของเคส C ใช้ coalesce(...,0) ต่างจาก default (points··1)×(min··10) ของ getRoundStatus — drift ชนิดที่วิวถูกสร้างมาเพื่อฆ่า | ⬜ ยังไม่แก้ |
| 33 | 🔵 | Store ชั้นใน | `src/pages/StoreMonitor.jsx:74` | scope filter ของ StoreMonitor ซ่อน findings ของคลังกลาง (STORE/FG WAREHOUSE) จาก role ที่ถูกจำกัด sections/leader | ✅ แก้แล้ว (batch 2 · 2026-08-25) |
| 34 | 🔵 | Store ชั้นใน | `src/components/WipBetweenSteps.jsx:86` | baseline นับจริงของ WIP ดึงแค่ 500 แถวล่าสุดทั้งตาราง — buffer ที่นับนานแล้วหลุดหน้าต่างเงียบๆ แล้ว inFlight เด้งกลับไปคิดจากใบผลิตทั้งประวัติ | ✅ แก้แล้ว (batch 2 · 2026-08-25) |
| 35 | 🔴 | Kanban ดึง + รอบส่ง + จัดซื้อ | `src/pages/HeijunkaKanban.jsx:1041` | แท็บ 🛒 จัดซื้อ: ใบ cancelled 984 ใบไม่ถูกกรอง — โชว์เป็น '🆕 รอสั่งซื้อ' พร้อมปุ่มปลุกใบขยะคืนชีพ + limit(300) เบียดคิวจริงหาย | ✅ แก้แล้ว — session ขนานทำวิว v_purchase_open_summary + b272e1d เพิ่ม meta cancelled / CAS guard |
| 36 | 🟡 | Kanban ดึง + รอบส่ง + จัดซื้อ | `src/pages/FlowTower.jsx:76` | FlowTower: purchPending นับจาก select ไม่ paginate — ตารางทะลุเพดาน 1000 แถวไปแล้วจริง (~1,026 ใบ) | ✅ แก้แล้ว (b272e1d 2026-08-25) |
| 37 | 🟡 | Kanban ดึง + รอบส่ง + จัดซื้อ | `src/pages/HeijunkaKanban.jsx:1315` | advanceWip ไม่มี guard `.neq(status)` — กดซ้ำ/2 เครื่อง = บวก current_qty จุด WIP ซ้ำสองรอบ | ✅ แก้แล้ว (batch 2 · 2026-08-25) |
| 38 | 🟡 | Kanban ดึง + รอบส่ง + จัดซื้อ | `src/pages/HeijunkaKanban.jsx:533` | DeliveryRoundsPanel ให้ยืนยันส่งได้ตั้งแต่สถานะ ⬜ รอ (ก่อน cutoff) — ข้ามขั้น chain ต่างจากอีก 2 view | ✅ แก้แล้ว (batch 2 · 2026-08-25) |
| 39 | 🟡 | Kanban ดึง + รอบส่ง + จัดซื้อ | `src/pages/RackCenter.jsx:156` | RackCenter QR deep-link เปิดฟอร์มเรียกภาชนะโดยไม่เช็ค rack_center:operate — ซ่อนปุ่มแต่ไม่ guard ค่าจาก URL | ✅ แก้แล้ว (batch 2 · 2026-08-25) |
| 40 | 🟡 | Kanban ดึง + รอบส่ง + จัดซื้อ | `src/pages/HeijunkaKanban.jsx:1225` | advanceLot 'done' ตัดวัตถุดิบจาก state ที่โหลดแค่ 400 แถวล่าสุด — ล็อตเก่าปิดแล้ว raw ไม่ถูก consume เงียบ | ✅ แก้แล้ว (batch 2 · 2026-08-25) |
| 41 | 🟡 | Kanban ดึง + รอบส่ง + จัดซื้อ | `src/pages/HeijunkaKanban.jsx:1490` | ReceiveModal รับไม่ครบ: ช่องว่าง = รับ 0 · พิมพ์ค่าลบได้ · กดจาก 2 เครื่องซ้ำ = consume shortfall สองรอบ | ✅ แก้แล้ว (batch 2 · 2026-08-25) |
| 42 | 🟡 | Kanban ดึง + รอบส่ง + จัดซื้อ | `src/pages/HeijunkaKanban.jsx:1260` | advancePurchase 'received' ที่ dest_line ว่าง — toast ขึ้น 'รับเข้าสโตร์ +qty' แต่ไม่มีสต็อกถูกเติมเลย | ✅ แก้แล้ว (batch 2 · 2026-08-25) |
| 43 | 🔵 | Kanban ดึง + รอบส่ง + จัดซื้อ | `src/pages/HeijunkaKanban.jsx:1284` | reorderLot กลืน error — supabase คืน {error} ไม่ throw, Promise.all จึงสำเร็จเสมอ | ✅ แก้แล้ว (batch 2 · 2026-08-25) |
| 44 | 🔵 | Kanban ดึง + รอบส่ง + จัดซื้อ | `src/pages/HeijunkaKanban.jsx:1435` | tripsFor: มอบหมายคนขับแล้วแต่รถทุกคันของเขาไม่ตั้งความจุ → บรรทัดเที่ยวหายทั้งแถบ แทนที่จะ fallback | ✅ แก้แล้ว (batch 2 · 2026-08-25) |
| DB-1 | 🔵 | needs_db | `supabase/migrations/20260811_backfill_shipped_stock_consume.sql:45` | backfill migration 20260811 (ยังไม่ apply) ล้าสมัย — guard ส่วนที่ 2 จะ abort ถ้าปัจจุบันมี mat หลายคลัง และตัวจัดสรรส่วนที่ 3 ใช้ pool ทุกคลัง (เขียนก่อนกฎ FG-only ตกผลึก) | ❔ ต้องเช็คข้อมูลจริง (ดู §SQL) |
| DB-2 | 🟡 | needs_db | `supabase/migrations/20260821_explode_demand_lot_guard.sql:43` | backflush ยังพลาดเมื่อกะ FG เปิดที่ 'ไลน์แม่' — นโยบายจ่ายเข้าไลน์ลูกแก้ทิศเดียว ทิศ 'เปิดกะผิดชั้น' ไม่มี guard | ❔ ต้องเช็คข้อมูลจริง (ดู §SQL) |
| DB-3 | 🟡 | needs_db | `src/components/StockMoveToChild.jsx:36` | state ปลายทาง/จำนวนของแผงย้ายมินิสโตร์ key ด้วย mat_no อย่างเดียว — mat เดียวค้าง 2 ไลน์แม่แชร์ state ปนกัน | ❔ ต้องเช็คข้อมูลจริง (ดู §SQL) |

---

## รายละเอียดรายข้อ

### #0 🔴 coverage + การหักสต็อกตอนกดส่ง นับ/หักจาก 'ทุกคลัง' — กฎ 'คลัง FG เท่านั้น' ไม่เคยตามมาถึง CustomerDemand
- **ไฟล์:** `src/pages/CustomerDemand.jsx:158` · **โดเมน:** ขาออก FG: Delivery / Shipping / Rundown · **สถานะ:** ✅ แก้แล้ว (b272e1d 2026-08-25)
- **scenario:** mat 20059949: FG WAREHOUSE 1,000 + STORE 10,231 → coverage รวม 11,231 → order 5,000 ขึ้น '📦 stock พร้อมส่งครบ' ทั้งที่ส่งได้จริง 1,000 (Rundown โชว์ติดลบ — 2 หน้าตอบสวนกัน) · กด 'ส่งแล้ว' → sort ไลน์ตาม qty มาก→น้อย → เขียน consume ลง STORE (ของก่อนแพ็ค) แทน FG WAREHOUSE → ledger ผิด 2 คลัง: STORE ถูกหักทั้งที่ของไม่ได้ออกตรงนั้น + FG WAREHOUSE ค้างยอดผี → backflush/StoreMonitor min-max เพี้ยนลูกโซ่
- **หลักฐาน (verifier):** ยืนยันจากโค้ดจริง: load() ที่ CustomerDemand.jsx:149-160 query line_stock_summary ด้วย .in('mat_no', keys) อย่างเดียว ไม่มี query stock_inflow_rules และไม่กรอง line_name เลยทั้งไฟล์ (grep 'fgDest' ในไฟล์ = 0) → fgStock (161-169) รวมทุกคลัง · coverage (222-237) จัดสรรจาก total รวม · advance() 263 `[...(entry?.lines||[])].sort((a,b)=>b.qty-a.qty)` เขียน consume ลงคลังที่ qty มากสุด = STORE ได้จริง · เทียบ RundownStock.jsx:43,53,82 ที่แก้แล้ว (commit c232614 — git log ยืนยันว่า commit นั้นแตะ RundownStock แต่ 'ไม่อยู่' ใน log ของ CustomerDemand.jsx · docs/QC-CALC-AUDIT-2026-08-20.md ไม่มีรายการ CustomerDemand/fgDest ในลิสต์ที่แก้แล้ว) · CLAUDE.md ไม่มีที่ไหนบันทึกว่า CustomerDemand ตั้งใจนับทุกคลัง — กลับกัน กฎ Rundown เขียนชัดว่า 'ของใน mini-store/STORE ยังส่งลูกค้าไม่ได้' · เคสจริง 20059949 (FG 1,000 + STORE 10,231) ที่ commit c232614 บันทึกไว้เอง ทำให้ scenario เป็นรูปธรรม: coverage ขึ้น 'พร้อมส่งครบ' สวนกับ Rundown หน้าข้างๆ + consume ลง STORE ผิดคลัง
- **แนวแก้ที่เสนอ:** ทำเหมือน RundownStock.jsx:43,53,82 — โหลด stock_inflow_rules หา fgDest แล้วกรอง line_stock_summary เฉพาะคลัง FG ทั้ง fgStock (coverage) และ txns ตอน advance() · ถ้าจะรองรับสต็อกใต้เลขลูกค้าที่อยู่นอกคลัง FG ต้องให้คลัง FG มาก่อนเสมอในลำดับหัก ไม่ใช่เรียงตาม qty
- **SQL เช็ค:**
```sql
-- DR: order ค้างส่งที่มีสต็อกอยู่นอกคลัง FG = จะถูก coverage นับเป็นพร้อมส่ง + ถูกหักผิดคลังตอนกดส่ง
select s.mat_no, s.line_name, s.qty_on_hand
  from line_stock_summary s
 where s.qty_on_hand > 0
   and s.line_name <> (select dest_line_name from stock_inflow_rules where match_type='prefix' and match_value='1' and is_active limit 1)
   and s.mat_no in (select mat_no from customer_shipping_orders where status <> 'shipped');
```

### #1 🔴 Rundown นับสต็อกก้อนเดียวกันซ้ำหลายแถว — จัดกลุ่มด้วยเลขบน order แต่ start ดึง onHand[stockMat] เต็มก้อนโดยไม่แชร์ pool
- **ไฟล์:** `src/pages/RundownStock.jsx:100` · **โดเมน:** ขาออก FG: Delivery / Shipping / Rundown · **สถานะ:** ✅ แก้แล้ว (b272e1d 2026-08-25)
- **scenario:** order ค้างส่ง 2 แถวคนละเลขคีย์: 'RB3B 8C306 BB' (mapped→10100379) + '10100379' (direct) → byMat แตก 2 แถว แต่ละแถว start = onHand['10100379'] เต็ม 6,000 เท่ากัน → สต็อกถูกนับ 2 รอบ · demand 9,000 แบ่ง 2 แถว ไม่มีแถวไหน bal ติดลบ → shortCount = 0 ทั้งที่ขาดจริง 3,000 → ไม่เปิด OT → หลุดส่ง
- **หลักฐาน (verifier):** ยืนยันจากโค้ด: byMat จัดกลุ่มด้วย o.mat_no (86-93) · แต่ละแถวเรียก pickStockMat แล้ว `start = onHand[stockMat] ?? 0` เต็มก้อน (94-101) ไม่มี shared remain pool — ขณะที่ CustomerDemand coverage (222-231) แชร์ pool ถูกต้อง (`remain[sap] = avail - use`) พิสูจน์ว่า requirement นี้เป็นที่รู้กันแล้วแต่ Rundown ตกหล่น · กลไกสร้างคู่เลขมีจริงตาม CLAUDE.md: ปุ่ม 🔗 จับคู่ SAP re-point เฉพาะ customer_forecasts (ไม่แตะ customer_shipping_orders) + กฎ 2026-08-19 ห้ามลบ order วันเก่า → order เก่าคีย์เลขลูกค้า (pending ค้าง) อยู่ร่วมกับ order ใหม่ที่ import เป็นเลข SAP ได้จริง · จำนวนคู่ที่เกิดจริงวันนี้ต้องดู DB (sql_check) แต่ defect ในโค้ดแน่นอน
- **แนวแก้ที่เสนอ:** หลัง pickStockMat ให้ merge แถวที่ stockMat เดียวกัน (รวม demand/overdue ราย mat SAP) หรือจัดสรร onHand เป็น shared pool แบบ coverage ใน CustomerDemand — แสดงเลขลูกค้า/SAP คู่กันในคอลัมน์พาร์ท
- **SQL เช็ค:**
```sql
-- DR: มีคู่เลขบน order (ค้างส่ง) ที่ชี้สต็อกก้อนเดียวกันไหม — เจอ = บั๊กเกิดแล้วจริง
with pn as (
  select upper(regexp_replace(p_no,'[^A-Za-z0-9]','','g')) k, mat_no from dr_products where is_active and p_no is not null and p_no<>''
  union
  select upper(regexp_replace(p_no,'[^A-Za-z0-9]','','g')), mat_no from kanban_standards where is_active and p_no is not null and p_no<>''
), u as (select k, min(mat_no) m from pn group by k having count(distinct mat_no)=1 and min(mat_no) ~ '^[0-9]+$'),
ord as (select distinct mat_no from customer_shipping_orders where status <> 'shipped'),
keyed as (select o.mat_no, coalesce(u.m, case when o.mat_no ~ '^[0-9]+$' then o.mat_no end) sap
            from ord o left join u on u.k = upper(regexp_replace(o.mat_no,'[^A-Za-z0-9]','','g')))
select sap, array_agg(mat_no) order_keys from keyed where sap is not null group by sap having count(*) > 1;
```

### #2 🟡 Rundown เหมา status 'sap'/'mapped_nostock' เป็น ❔ 'ยังจับคู่เลขไม่ได้' — พาร์ทที่ขาดหนักสุดหลุดจาก shortCount ขณะ CustomerDemand เคสเดียวกันขึ้นแดงนับเข้า
- **ไฟล์:** `src/pages/RundownStock.jsx:98` · **โดเมน:** ขาออก FG: Delivery / Shipping / Rundown · **สถานะ:** ✅ แก้แล้ว (b272e1d 2026-08-25)
- **scenario:** 10100821 order ค้าง 8,272 ชิ้น ไม่มีแถวสต็อกเลย → pickStockMat คืน status 'sap' → Rundown ขึ้น ❔ ไม่คิด balance ไม่เข้า shortCount — พาร์ทที่ขาดหนักสุดหายจากตัวนับ 'จะติดลบใน 14 วัน' ทั้งที่ Delivery หน้าข้างๆ ขึ้น '🚨 ไม่มี stock ต้องผลิต!'
- **หลักฐาน (verifier):** ยืนยันจากโค้ด: matResolve.js:87-88 pickStockMat คืน mat 'ไม่ null' สำหรับทั้ง 'sap' (mat=เลขนั้นเอง) และ 'mapped_nostock' (mat=ปลายทางที่ map ได้ชัด) = รู้เลขแน่นอนแล้ว แค่คลังไม่มีแถว · RundownStock:98 `unknown = !['direct','mapped'].includes(res.status)` ตี 2 สถานะนี้เป็น unknown → stockMat=null, tracked=false, ข้าม firstShort (106) → ไม่เข้า shortCount (117) · CustomerDemand:234 `unknown: !sap` → เคสเดียวกัน unknown=false, short=qty เต็ม → นับใน shortCount (317) + การ์ดขึ้น 🚨 ต้องผลิต! (735) — 2 หน้าจัดประเภทตรงข้ามกันจริง · เคส 10100821 (order 8,272 ผลิตบันทึก 0) ที่ CLAUDE.md บันทึกไว้เข้าเงื่อนไขนี้พอดี · แก้รายละเอียดทีมแรกนิดเดียว: tooltip รายแถว (188 title={r.issue}) โชว์ matIssueText ที่ถูกต้อง ('ของยังไม่เคยถูกบันทึกเข้า') อยู่แล้ว — ข้อความเท็จคือ KPI card (146) + footer (209) ที่เหมาว่า 'เลขยังไม่จับคู่ MAT SAP' และประเด็นหลักคือหลุดจากตัวนับ 'จะติดลบใน 14 วัน'
- **แนวแก้ที่เสนอ:** แยก 3 สถานะให้ตรง CustomerDemand: unknown เฉพาะ ambiguous/placeholder/none · 'sap'/'mapped_nostock' = start 0, tracked true, เข้า shortCount + ใช้ matIssueText ของเคสนั้นแทนข้อความจับคู่ไม่ได้ (KPI card/footer แยกข้อความ 2 กลุ่ม)
- **SQL เช็ค:**
```sql
-- DR: พาร์ทเลข SAP ที่มี order ค้างส่งแต่ไม่มีแถวสต็อก = ตอนนี้ขึ้น ❔ แทนที่จะขึ้นแดง
select o.mat_no, sum(o.qty) qty_pending
  from customer_shipping_orders o
 where o.status <> 'shipped' and o.mat_no ~ '^[0-9]+$'
   and not exists (select 1 from line_stock_summary s where s.mat_no = o.mat_no)
 group by o.mat_no order by 2 desc;
```

### #3 🟡 pnIndex ของ Delivery ไม่กรอง is_active — แถวที่ถูก EC superseded ทำ p_no กลายเป็น ambiguous แล้วการหักสต็อกอัตโนมัติหยุดทำงาน (drift จาก Rundown ที่กรองแล้ว)
- **ไฟล์:** `src/pages/CustomerDemand.jsx:150` · **โดเมน:** ขาออก FG: Delivery / Shipping / Rundown · **สถานะ:** ✅ แก้แล้ว (b272e1d 2026-08-25)
- **scenario:** EC ออกเลขใหม่ mark ตัวเก่า inactive แต่ p_no เดิมค้างในแถว inactive + แถวใหม่ p_no เดียวกัน → Delivery เห็น p_no ชี้ 2 mat → ambiguous → ทุกใบของพาร์ทนั้นเลิกหักสต็อกพร้อม toast ชี้ให้ไปแก้ Product Master ทั้งที่ตัวการคือแถว inactive · Rundown resolve ได้ปกติ — 2 หน้า drift หลัง EC 1 ครั้ง
- **หลักฐาน (verifier):** ยืนยัน code drift จริง: CustomerDemand:150-151 select แค่ `.not('p_no','is',null)` ไม่มี `.eq('is_active',true)` ขณะ RundownStock:46-47 กรองแล้ว · เส้นทางพัง verify แล้ว: buildPnIndex เก็บทุกแถวเป็น Set ของ mat (matResolve.js:29-39) → p_no เดียวชี้ 2 mat (active+inactive) → resolveMatNo คืน ambiguous mat=null (56) → advance(): sap=null → entry=null → txns ว่าง → cut=0 → shipMsg = matIssueText ambiguous ('แก้ p_no ที่ Product Master') ชี้ทางผิด — การหักหยุดทั้งพาร์ท · หมายเหตุ: buildPnIndex ใช้ Set จึงไม่พังเมื่อ mat เดียวกันซ้ำจาก dr_products+kanban_standards — ต้องเป็น mat 'คนละตัว' เท่านั้น = สถานการณ์ EC/แถวเก่าค้าง p_no ซึ่งมีจริงได้ (CLAUDE.md บันทึก master p_no ยังไม่ unique) แต่จำนวนที่เกิดวันนี้ต้องดู DB · fix ปลอดภัยไม่มีเงื่อนไข (ให้ตรง Rundown)
- **แนวแก้ที่เสนอ:** เติม .eq('is_active', true) ให้ทั้ง 2 query ใน load() ของ ShippingTab (150-151) ให้ตรง RundownStock
- **SQL เช็ค:**
```sql
-- DR: p_no ที่ unique เมื่อนับเฉพาะ active แต่กำกวมเมื่อรวม inactive — เจอ = Delivery ตี ambiguous ผิดอยู่ตอนนี้
with allr as (
  select upper(regexp_replace(p_no,'[^A-Za-z0-9]','','g')) k, mat_no, is_active from dr_products where p_no is not null and p_no<>''
  union all
  select upper(regexp_replace(p_no,'[^A-Za-z0-9]','','g')), mat_no, is_active from kanban_standards where p_no is not null and p_no<>'')
select k, count(distinct mat_no) n_all, count(distinct mat_no) filter (where is_active) n_active
  from allr group by k
having count(distinct mat_no) > 1 and count(distinct mat_no) filter (where is_active) = 1;
```

### #4 🟡 advance() หักสต็อกจาก snapshot ใน state โดยไม่ re-fetch — หน้านี้ไม่มี polling · atomic guard กันเฉพาะใบเดียวกัน
- **ไฟล์:** `src/pages/CustomerDemand.jsx:257` · **โดเมน:** ขาออก FG: Delivery / Shipping / Rundown · **สถานะ:** ✅ แก้แล้ว (b272e1d 2026-08-25)
- **scenario:** (ก) เปิดหน้าค้างตั้งแต่เช้า ของเข้าคลังเที่ยง กดส่งบ่าย → snapshot เช้าไม่มีของ → cut=0 → ขึ้น '⚠️ ไม่ได้หักสต็อก · ของยังไม่เคยถูกบันทึกเข้า' ทั้งที่ของอยู่ในคลัง + สถานะ shipped กดซ้ำไม่ได้ · (ข) 2 เครื่องเปิดค้าง กดส่งคนละใบ mat เดียวกัน → ต่างคนหักเต็มจาก snapshot เดิม → consume รวมเกินจริง ยอดคลังติดลบเงียบ
- **หลักฐาน (verifier):** ยืนยัน: CustomerDemand ไม่ import usePolling/visibleInterval เลย (บรรทัด 1-10) · load() วิ่งเฉพาะ [day, refreshKey] (174-175) และ refreshKey เปลี่ยนเฉพาะจาก ShipToTab onChanged (1037 — แก้ config ship-to) ไม่ใช่ timer · advance() อ่าน matMap/fgStock จาก state (257-263) แล้ว insert txns ก่อนค่อย load() (309) · atomic guard 247-248 `.eq('status', o.status)` กันเฉพาะการเลื่อนใบเดียวกันซ้ำ ไม่กัน 2 เครื่องส่งคนละใบของ mat เดียวกันจาก snapshot เก่าคนละก๊อป → consume รวมเกินของจริงได้ (line_stock_transactions ไม่มี guard กันติดลบแบบ mtn_stock_move) · scenario (ก) stale snapshot → cut=0 + สถานะ shipped ไปแล้ว retry ไม่ได้ = เคสเดียวกับที่ต้องเขียน backfill 20260811 มาเก็บตก — ยืนยันว่าเกิดจริงได้
- **แนวแก้ที่เสนอ:** ใน advance() ก่อนสร้าง txns query line_stock_summary สดเฉพาะ stockLookupKeys ของ mat ใบนั้น (payload จิ๋ว ไม่ผิดกฎ egress) แล้วค่อยจัดสรร

### #5 🟡 workflowLive (shipping-phase-scan v3) — query 30 วันไม่เช็ค error + ติดเพดาน 1000 แถวเงียบ + ตัดสินจากสถานะปัจจุบันที่ transient
- **ไฟล์:** `supabase/functions/shipping-phase-scan/index.ts:82` · **โดเมน:** ขาออก FG: Delivery / Shipping / Rundown · **สถานะ:** ⏸ ต้อง deploy edge shipping-phase-scan — จัด batch แยกกับ user
- **scenario:** orders 30 วันทะลุ 1000 แถว (ตอนนี้ ~470+ pending สะสมโตต่อเนื่อง — ดู sql_check) หรือ query timeout → workflowLive=false → แจ้งเตือนเฟสกลางถูกข้ามเงียบทั้งที่ทีมเริ่มกดยืนยัน/เตรียม/โหลดแล้ว → walkback ที่เพิ่ง adopt ไม่เตือน 'ก่อนสาย' ตามที่ออกแบบ
- **หลักฐาน (verifier):** ยืนยัน: 81-83 `const { data: recent } = await db.from('customer_shipping_orders').select('status').gte('due_date',...)` — ไม่ destructure error · ไม่มี .range/.order/.limit/count → (ก) query ล้ม: recent=null → `(recent ?? []).some(...)` (84) = false → suppress เฟสกลางจากความไม่รู้ (ข) เกิน 1000 แถว: PostgREST คืน 1000 แรกลำดับไม่กำหนด แถว confirmed/prepared หลุดหน้าได้ → live=false ทั้งที่ทีมใช้ walkback แล้ว — สวน comment self-healing (79) ในไฟล์เอง (ค) ตัดสินจาก current status ซึ่งหายเมื่อใบถูกปิดครบ = ข้อจำกัดโครงสร้างจริง · mitigation ที่มีอยู่: skip (103) เกิดก่อน upsert seenKeys (110) → เตือนย้อนหลังได้เมื่อ live กลับมา (ทีมแรก note ไว้ถูกแล้ว — ลดความแรงเหลือ yellow ไม่ใช่ red) · เป็นโค้ดล่าสุดของไฟล์ (commit 6989c46) ไม่มี fix ตามหลัง
- **แนวแก้ที่เสนอ:** (1) เช็ค error ของ query recent — error = ถือ workflowLive=true (fail-open ฝั่งเตือน) (2) นับด้วย head:true count แยกราย status (3 query จิ๋ว) แทนดึงแถว (3) ระยะยาว stamp timestamp ต่อเฟส (confirmed_at/prepared_at) ให้ตรวจ adoption จากประวัติจริง
- **SQL เช็ค:**
```sql
-- DR: จำนวนแถวที่ workflowLive scan เห็น — >1000 = ติด clamp แล้ว
select count(*) from customer_shipping_orders where due_date >= current_date - 30;
```

### #6 🟡 ตัวนับ '⏰ ค้างส่งจากวันก่อน' หลุดใบกะดึก (ตี 0-7 โมงของวันนี้) ของวันงานที่เพิ่งจบ — query กรอง due_date < day เท่านั้น
- **ไฟล์:** `src/pages/CustomerDemand.jsx:129` · **โดเมน:** ขาออก FG: Delivery / Shipping / Rundown · **สถานะ:** ✅ แก้แล้ว (b272e1d 2026-08-25)
- **scenario:** order due_date=2026-08-25 ship_time=03:00 ยังไม่ shipped · ตอนนี้ 25/8 10:00 → slot ผ่านมา 7 ชม. แต่ไม่อยู่ในชาร์ตวันนี้ + pastDue ไม่นับ → ปุ่มแดง 'ค้างส่งจากวันก่อน N ใบ' นับขาด ใบล่องหน
- **หลักฐาน (verifier):** ยืนยันจากโค้ด: pastDue query 129-130 `.gte('due_date', back).lt('due_date', day).neq('status','shipped')` — ตัด due_date = day ออก · แต่กรอบวันงาน: order due_date=day + ship_time<08:00 คือ slot กะดึกของวันงาน day−1 (จบไปแล้ว ณ ตอน workDateStr()=day) — ใบนี้ไม่โผล่ในชาร์ตวันนี้ด้วย (d1 filter 134-135 ตัด time<08:00 ทิ้ง) → มองไม่เห็นทั้งชาร์ตและตัวนับ จนกว่าจะกด ◀ ไปดู day−1 เอง (ที่นั่นขึ้นแดงถูกต้องผ่าน isPastDay) · ตรรกะ work-day frame ตรวจกับ load() 120-126 แล้วสอดคล้อง
- **แนวแก้ที่เสนอ:** เพิ่มก้อนที่สองใน pastDue: due_date = day AND ship_time < '08:00' AND status != 'shipped' และให้ปุ่มกระโดดไป day−1 เมื่อใบล่าสุดเป็นเคสนี้

### #7 🔵 insert consume ล้มด้วย error อื่น (ไม่ใช่ 42703) → ไหลเข้าข้อความวินิจฉัย 'ของยังไม่เคยถูกบันทึกเข้า' ที่ขัดกับความจริง
- **ไฟล์:** `src/pages/CustomerDemand.jsx:285` · **โดเมน:** ขาออก FG: Delivery / Shipping / Rundown · **สถานะ:** ✅ แก้แล้ว (b272e1d 2026-08-25)
- **scenario:** สต็อกมีครบแต่ insert ล้ม (network/timeout) → toast 'ตัดสต็อกไม่สำเร็จ' ตามด้วย toast 'ของยังไม่เคยถูกบันทึกเข้า — เช็คการปิดออเดอร์ผลิต' → ผู้ใช้ไปไล่ฝั่งผลิตผิดที่ แทนที่จะรู้ว่าต้องปรับยอดมือ
- **หลักฐาน (verifier):** ยืนยันเส้นทางโค้ด: 285 `if (e2) { cut = 0; toast.error('ส่งแล้วแต่ตัดสต็อกไม่สำเร็จ: '+e2.message) }` → ไหลเข้า `if (cut <= 0)` (287) ซึ่ง resolve สำเร็จทำให้ matIssueText คืน null → shipMsg fallback 'ของยังไม่เคยถูกบันทึกเข้า — เช็คการปิดออเดอร์ผลิต/กฎรับเข้าอัตโนมัติ' (291-292) แล้ว toast อีกใบที่ 307 · จุดที่ทีมแรกพูดเบาไป: toast แรก (285) บอกสาเหตุจริงอยู่แล้ว ('ตัดสต็อกไม่สำเร็จ: <msg>') — ผู้ใช้จึงได้ 2 ข้อความขัดกันเอง ไม่ใช่ได้แต่ข้อความผิดล้วน → คงเป็น blue (ความสับสน + ไม่มี retry เพราะ status shipped ไปแล้ว) ไม่ยกระดับ
- **แนวแก้ที่เสนอ:** แยก flag insertFailed ออกจาก 'ไม่มีของ' — e2 ที่ไม่ใช่ 42703 ให้ shipMsg บอก 'ตัดสต็อกไม่สำเร็จ (ระบบ) — ต้องปรับยอดมือที่หน้า Store' ไม่เข้าสูตรวินิจฉัย stock

### #8 🔵 deleteManualOrder ลบได้ 0 แถวแต่ toast 'ลบแล้ว' — pattern 'สำเร็จ 0 แถว' ที่ CLAUDE.md ห้าม
- **ไฟล์:** `src/pages/CustomerDemand.jsx:109` · **โดเมน:** ขาออก FG: Delivery / Shipping / Rundown · **สถานะ:** ✅ แก้แล้ว (b272e1d 2026-08-25)
- **scenario:** เครื่อง A เปิด popup ใบ pending ค้าง · เครื่อง B ยืนยันใบเป็น confirmed · เครื่อง A กด 🗑 → 0 แถว → toast 'ลบแล้ว' แล้วใบโผล่กลับสถานะ confirmed — ผู้ใช้งง
- **หลักฐาน (verifier):** ยืนยัน: 109-112 delete `.eq('id').eq('source','manual').eq('status','pending')` ไม่มี .select('id')/นับแถว → เงื่อนไขไม่ตรง (ใบถูกเลื่อนสถานะโดยเครื่องอื่นแล้ว) = 0 แถว ไม่ error → toast 'ลบแล้ว' (112) · ตรงกับกฎ CLAUDE.md '.update()/delete ที่โดนบล็อก/ไม่ตรงเงื่อนไข = สำเร็จ 0 แถว ต้องนับแถวเสมอ' · ผลเบาเพราะ load() (114) ทำให้ใบโผล่กลับมาให้เห็น — blue เหมาะแล้ว
- **แนวแก้ที่เสนอ:** ต่อ .select('id') เช็ค length — 0 แถวให้ toast 'ลบไม่ได้ — ใบนี้เริ่ม workflow ไปแล้ว/ถูกลบไปก่อนแล้ว'

### #9 🔵 chain สถานะเดินหน้าอย่างเดียว ไม่มีทางย้อน — กด 'ส่งแล้ว' พลาด = consume + Telegram + สถานะ ถาวรทั้งชุด
- **ไฟล์:** `src/pages/CustomerDemand.jsx:239` · **โดเมน:** ขาออก FG: Delivery / Shipping / Rundown · **สถานะ:** ⏸ backlog (ออกแบบ undo chain — product decision)
- **scenario:** มือลั่นกด '🚚 ส่งถึงลูกค้าแล้ว' บนใบ loaded ที่ยังไม่ออกจากโรงงาน → shipped + หักสต็อกจริง + ยิง shipping_shipped เข้า Telegram — ไม่มีทางถอนจาก UI ต้องให้ admin แก้ DB + ปรับยอดมือผ่านคิวอนุมัติ
- **หลักฐาน (verifier):** ยืนยัน: SHIP_STATUS (35-41) มีแต่ next ไม่มี back · advance() (239-311) เลื่อนไป st.next เท่านั้น + atomic guard ผ่าน (ข้ามขั้นไม่ได้ ✓) · ทั้งไฟล์ไม่มี UI ถอนสถานะ shipped (grep revert/ถอย = 0) · CLAUDE.md บันทึก chain 'ห้ามข้าม' แต่ไม่ได้บันทึกว่า 'ไม่มีปุ่มย้อน' เป็นการตัดสินใจ — เทียบกับ prod_orders ที่มีปุ่ม ↩️ ถอยใบพร้อมถอนแถว stock · ref_shipment_id (272) ผูก FK แล้วทำให้ถอนตรงแถวได้จริงถ้าจะทำ · เป็น product decision ต้องถาม user ก่อน — verdict confirmed ในฐานะข้อสังเกต blue ตามที่ทีมแรกจัดไว้
- **แนวแก้ที่เสนอ:** ถ้าจะทำ: ปุ่ม ↩️ เฉพาะ shipped→loaded ภายในเวลาจำกัด + ลบแถว consume ที่ ref_shipment_id = ใบนั้น + audit — เป็น product decision ควรถาม user ก่อน

### #10 🔴 ยอดผลิตบางส่วนของใบที่ยกยอด/ยกเลิก ไม่เคยเข้าคลังเลย — โพสต์เฉพาะ 'ส่วนที่เหลือ' ตอนปิดใบสุดท้าย
- **ไฟล์:** `src/pages/DailyReport.jsx:1526` · **โดเมน:** ผลิต FG → เข้าคลังอัตโนมัติ · **สถานะ:** 🔴 รอ DB — ต้องแก้ trigger/flow ปิดกะ (ดู §DB)
- **scenario:** ใบสแกน 35 ชิ้น กะเช้าทำได้ 18 (กรอก qty_actual) → ปิดกะเลือก 'ยกยอด' = status='carry_over', qty_actual=18 (1876-1881) — trigger ไม่โพสต์ · กะดึก import สร้างใบใหม่ qty=remainQty=17 (1526,1540) → สแกนปิด qty_ok=17 (1232) → เข้า FG WAREHOUSE แค่ 17 จาก 35 ที่ผลิตจริง (ยกยอด 2 รอบ: 18→10→ปิด 7 = โพสต์ 7/35) · ขา backflush (fn_explode ใช้ NEW.qty=17) ขาดเท่ากัน · 'cancel' ที่ qty_actual>0 ก็ไม่โพสต์ → Shipping Chart ขึ้น '🚨 ไม่มี stock' เกินจริง, Rundown balance ต่ำเกินจริง ขณะ OEE/pairAwareTotal นับเต็ม
- **หลักฐาน (verifier):** ยืนยันครบทุกข้อต่อ: (1) trigger fn_post_confirmed_output (20260714_work_date_bangkok_fallback.sql:18-19) ยิงเฉพาะ transition →'confirmed' — สถานะ 'carry_over' (DailyReport.jsx:1876-1881 เขียน qty_actual=qActual) และ 'cancelled' (1891) ไม่มีวันถูกโพสต์ และภายหลังถูก mark 'imported' (1522,1550) ก็ยังไม่ใช่ confirmed (2) handleImportCarryOrders สร้างใบใหม่ qty=remainQty (1526,1540) → สแกนปิดผ่าน doConfirmCloseOrder ตั้ง qty_ok=match.qty=remainQty (1232) → trigger โพสต์ coalesce(qty_ok,qty)=remainQty เท่านั้น (3) grep ทั้งไฟล์: line_stock_transactions ถูกแตะที่เดียวคือ delete ตอน revert (1280) — ไม่มี path ไหนโพสต์ qty_actual ของ carry_over/cancelled เลย (4) CLAUDE.md บันทึกว่า 'ภาพรวมทั้งกะ ผลิตได้ รวม qty_actual ของใบ carry_over' = ฝั่งนับผลิตนับ 35 แต่ฝั่งคลังได้ 17 — mismatch เชิงระบบจริง ไม่มีที่ไหนบันทึกว่าตั้งใจ
- **แนวแก้ที่เสนอ:** ให้ user เคาะโมเดลเดียวแล้วทำครบสาย: (ก) โพสต์ qty_actual ณ จังหวะ status → carry_over/cancelled (ขยาย trigger หรือ insert จากโค้ดปิดกะ ผูก ref_order_id ใบเดิมใช้ dedup เดิม) — ตรงกับที่ OEE นับอยู่แล้ว · หรือ (ข) ใบสุดท้ายของ chain โพสต์ยอดสะสมทั้งการ์ด (ต้อง carry ยอดสะสมมากับใบ import) · แบบ (ก) ปลอดภัยกว่า (ไม่แตะ dedup/OEE) · ระหว่างรอ ขึ้น badge 'ผลิตแล้วแต่ยังไม่เข้าคลัง N ชิ้น' ห้ามเงียบ
- **SQL เช็ค:**
```sql
-- DR: ชิ้นที่ผลิตจริงบนใบยก/ยกเลิก ที่ไม่มีแถว stock auto ผูกอยู่เลย
select status, count(*) as orders, sum(qty_actual) as pieces_never_posted
from prod_orders o
where status in ('carry_over','imported','cancelled') and coalesce(qty_actual,0) > 0
  and not exists (select 1 from line_stock_transactions t where t.ref_order_id = o.id and t.created_by = 'auto')
group by status;
```

### #11 🔴 ถอยใบแล้วสแกนปิดใหม่ → fn_explode_child_demand ระเบิด demand ซ้ำ 2 เท่า (ไม่มี dedup ต่อใบแบบฝั่ง inflow)
- **ไฟล์:** `supabase/migrations/20260821_explode_demand_lot_guard.sql:31` · **โดเมน:** ผลิต FG → เข้าคลังอัตโนมัติ · **สถานะ:** 🔴 รอ DB — ต้อง dump ฟังก์ชันสดจาก user ก่อน (ดู §DB)
- **scenario:** ปิดใบ FG ครั้งแรก → explode หัก mini-store (consume) + สะสม accumulator + ออกใบลูก/ใบสั่งซื้อครบ · กด ↩️ ถอยใบ (ลบเฉพาะแถว issue) → สแกนปิดใหม่ = transition open→confirmed อีกรอบ → consume ซ้ำ (มินิสโตร์หัก 2 เท่า) + accumulator ทบ 2 เท่า → purchase_requests/child_lot_requests ออกซ้ำ · ใบ manual 300→revert→ปิด 500 = demand 800 จากผลิตจริง 500 · revert แล้วเปลี่ยนเป็น cancel = demand+consume ของของที่ไม่ได้ผลิต ค้างถาวรไม่มีอะไรถอน
- **หลักฐาน (verifier):** อ่านฟังก์ชันเวอร์ชันล่าสุด (20260821 คือไฟล์หลังสุดที่ create or replace fn_explode_child_demand — เช็คแล้วทั้ง 5 ไฟล์ที่อ้างถึง): บรรทัด 31-32 เช็คแค่ transition (NEW='confirmed' และ OLD≠'confirmed') ไม่มี marker ต่อ NEW.id ใดๆ · แถว consume (บรรทัด 50-52) insert โดยไม่ใส่ ref_order_id จึงใช้เป็นตัวกันซ้ำแบบ inflow ไม่ได้ · handleRevertOrder (DailyReport.jsx:1264-1285) เปลี่ยน confirmed→open + ลบเฉพาะแถว type='issue' created_by='auto' (1280-1281) ไม่แตะ consume/accumulator/child_lot_requests/purchase_requests และ confirm dialog (1266-1270) ไม่เตือนเรื่อง demand · สแกนปิดใหม่ = open→confirmed ผ่านเงื่อนไข 31-32 → explode วิ่งเต็มรอบสอง · ใบ manual revert คืน qty=qty_target (1276) แล้วปิดด้วยยอดใหม่ = demand ทบตามที่อ้างจริง · CLAUDE.md บันทึกการถอน stock ไว้เฉพาะ trg_post_confirmed_output — gap นี้ไม่ได้ documented ว่าตั้งใจ
- **แนวแก้ที่เสนอ:** เพิ่ม dedup ให้ fn_explode_child_demand: ใส่ ref_order_id ให้แถว consume (คอลัมน์มีอยู่แล้ว แค่ไม่ได้เขียน) แล้วใช้เป็น marker · หรือตาราง marker demand_exploded(order_id pk) insert on conflict do nothing เป็นด่านแรกของ function · ฝั่ง UI: handleRevertOrder เตือนว่า demand ที่ระเบิดแล้วไม่ถูกถอน (หรือถอน consume/accumulator ให้ด้วยเมื่อมี marker)
- **SQL เช็ค:**
```sql
-- DR: ใบที่เคยถอย (reopen_count>0) — นับร่องรอย explode ซ้ำ
select o.prod_no, o.mat_no, o.reopen_count, o.status,
  (select count(*) from line_stock_transactions t where t.type='consume' and t.created_by='auto' and t.note like '%'||o.prod_no||'%') as consume_rows,
  (select count(*) from child_lot_requests c where c.source_prod_no = o.prod_no) as lot_reqs,
  (select count(*) from purchase_requests p where p.source_prod_no = o.prod_no) as po_reqs,
  (select count(*) from packaging_withdrawal_requests w where w.source_prod_no = o.prod_no) as pkg_reqs
from prod_orders o where coalesce(o.reopen_count,0) > 0;
```

### #12 🟡 OP guard มีอยู่แค่ใน DB — ไฟล์ migration ล่าสุดในรีโปที่ create or replace fn_post_confirmed_output (20260714) ไม่มี guard → replay/ยกร่างครั้งหน้า guard หายเงียบ
- **ไฟล์:** `supabase/migrations/20260820_op_items_never_enter_stock.sql:17` · **โดเมน:** ผลิต FG → เข้าคลังอัตโนมัติ · **สถานะ:** ✅ commit เวอร์ชันจริงจาก dump ของ user เข้ารีโปแล้ว (`20260825_sync_fn_post_confirmed_output.sql` — DB มีอยู่แล้ว ไม่ต้องรัน)
- **scenario:** session ถัดไปเขียน migration แก้ fn_post_confirmed_output โดยยกร่างจากไฟล์เต็มล่าสุดในรีโป (20260714) — แบบเดียวกับที่ 20260714 เคยยกจาก 20260710 — หรือ replay migrations กู้ DB → guard is_operation หายเงียบ บั๊กสต๊อกปลอม ~37,700 ชิ้นกลับมาโดย build/lint จับไม่ได้ · เสริม: guard query dr_products limit 1 ไม่กรอง is_active → mat_no ซ้ำ (แถว superseded จาก EC) ให้ผลไม่ deterministic
- **หลักฐาน (verifier):** เปิดไฟล์แล้ว: 20260820 เป็นคอมเมนต์ล้วนทั้ง 24 บรรทัด (บรรทัด 17: 'เนื้อฟังก์ชันเต็มดูที่ฐานข้อมูล (apply ผ่าน MCP)') ไม่มี SQL รันจริง · grep ทั้ง migrations: ไฟล์ที่ create or replace ฟังก์ชันนี้จริงมี 20260710 กับ 20260714 — เวอร์ชันเต็มล่าสุด (20260714:14-49) ไม่มีบล็อก is_operation · 20260821_laser345 แค่อ้างถึงในคอมเมนต์ ไม่ redefine · precedent เกิดจริงแล้วในรีโปเอง: 20260714 ยกร่างทั้งฟังก์ชันจาก 20260710 มาแก้จุดเดียว — ทำแบบเดียวกันรอบหน้าจะทับ guard ทิ้งเงียบ · สมมติฐานร้ายสุด 'ถ้า DB function ไม่มี guard' ต้องข้อมูลจริงยืนยัน (guard ตามคอมเมนต์ 19-20 ก็ไม่กรอง is_active/ไม่ order by → limit 1 ไม่ deterministic เมื่อ mat_no ซ้ำ) จึงคง sql_check ไว้
- **แนวแก้ที่เสนอ:** dump pg_get_functiondef(fn_post_confirmed_output) จาก DB ลงเป็น migration เต็มไฟล์ใหม่ (แทนคอมเมนต์) ให้ไฟล์ล่าสุดในรีโป = เวอร์ชันจริงเสมอ ตามกฎ CLAUDE.md ('เปลี่ยน schema ต้องมีไฟล์') · ใน guard เติม and is_active + order by ให้ deterministic
- **SQL เช็ค:**
```sql
-- DR: (1) ยืนยันว่า function ใน DB มี guard จริง
select position('is_operation' in pg_get_functiondef(oid)) > 0 as has_op_guard from pg_proc where proname='fn_post_confirmed_output';
-- (2) mat_no ซ้ำใน dr_products ที่ธง OP ไม่ตรงกัน (ทำให้ limit 1 เสี่ยง)
select mat_no, count(*) n, bool_or(coalesce(is_operation,false)) any_op, bool_and(coalesce(is_operation,false)) all_op
from dr_products group by mat_no having count(*) > 1;
```

### #13 🟡 handleImportCarryOrders ไม่ส่งต่อ is_manual/qty_target — ใบ manual ที่ยกยอดกลายเป็นใบสแกนในกะถัดไป (ปิดใบด้วยยอดจริงไม่ได้ + เข้าคลังด้วยเป้าแทนยอดจริง)
- **ไฟล์:** `src/pages/DailyReport.jsx:1533` · **โดเมน:** ผลิต FG → เข้าคลังอัตโนมัติ · **สถานะ:** ✅ แก้แล้ว (batch 2 · 2026-08-25)
- **scenario:** ไลน์ไม่มีบาร์โค้ด (HDF1) เปิดเป้า manual 500 ทำได้ 300 ยกยอด → กะถัดไป import สร้างแถว qty=200 ไม่มี is_manual → ระบบตีเป็นใบสแกน: ปุ่มปิดยอดจริงหาย เหลือทางปิดที่ผิดทั้งคู่ — (ก) พิมพ์ MANUAL-... ลงช่องสแกนปิด → qty_ok=200 เต็มเป้าทั้งที่จริงอาจ 150 → trigger โพสต์ของปลอม 50 ชิ้นเข้าคลัง (ข) ปิดกะเลือก 'ผลิตครบแล้ว' → โพสต์ 200 เหมือนกัน · และกรอกยอดสะสมเกิน 200 ไม่ได้ (สิทธิ์ที่ใบ manual ต้องมี)
- **หลักฐาน (verifier):** ยืนยันทุกชิ้น: insert ที่ 1533-1546 มีเฉพาะ session_id/prod_no/mat_no/part_name/p_no/customer/qty/status/opened_by/carry_over_from_session_id/carry_over_note/opened_at — ไม่มี is_manual, qty_target, machine_no · loadProdOrders carryOrders (492-509) ไม่กรองใบ manual ออก จึงเข้า flow นี้จริง · renderOrderRow: manualOpen = is_manual && open (2798) → ปุ่ม '✓ ปิดใบนี้ (ยอดจริง)' render เฉพาะ manualOpen (2967-2971) ใบยกที่ธงหายจึงเหลือแต่ 'ปิดใบยังใช้สแกนเหมือนเดิม' · พิมพ์ MANUAL-... ในช่องสแกนปิด → handleCloseProdNoChange จับใบ open ตาม prod_no (1215) → doConfirmCloseOrder ตั้ง qty_ok = match.qty เต็มเป้าเสมอ (1232) · handleManualQtyUpdate บล็อก v > qty เมื่อ !is_manual (1403-1405) = กรอกยอดจริงเกินเป้าไม่ได้ ตรงตามอ้าง
- **แนวแก้ที่เสนอ:** ใน insert ของ handleImportCarryOrders (1533) เติม is_manual: o.is_manual ?? false, qty_target: o.is_manual ? remainQty : undefined, qty_actual: 0, และ machine_no แบบ best-effort ตาม pattern attachMachine — ใบ manual ที่ยกมาจะได้ปุ่มปิดยอดจริง + กติกากรอกเกินเป้า กลับคืนมา
- **SQL เช็ค:**
```sql
-- DR: ใบยกยอดที่ต้นทางเป็น MANUAL แต่แถวใหม่ไม่ติดธง manual
select count(*) n, sum(qty) qty_at_risk from prod_orders
where carry_over_from_session_id is not null and prod_no like 'MANUAL-%' and coalesce(is_manual,false) = false;
```

### #14 🟡 กันเปิดใบซ้ำเช็คจาก state ฝั่ง client อย่างเดียว — 2 เครื่องสแกนการ์ดใบเดียวกันพร้อมกัน = ใบซ้ำ → เข้าคลัง 2 เท่า
- **ไฟล์:** `src/pages/DailyReport.jsx:1097` · **โดเมน:** ผลิต FG → เข้าคลังอัตโนมัติ · **สถานะ:** ✅ ฝั่ง client แก้แล้ว (แปลง 23505) · ด่านจริง = migration `20260825_prod_orders_session_prodno_unique.sql` (DR — รอ user รัน)
- **scenario:** กะเดียวเปิด Daily Report 2 เครื่อง สแกนการ์ดใบเดียวกันห่าง <1-2 วิ (ก่อน realtime+reload ทัน) → dup check ผ่านทั้งคู่ → 2 แถว open ของการ์ดเดียว → ปิดได้ทั้งคู่ (สแกนปิดจับใบแรก อีกใบถูกปิดตอนปิดกะด้วย 'ผลิตครบแล้ว') → trigger โพสต์ 2 แถว (dedup ต่อ ref_order_id คนละ id ไม่ช่วย) = FG เกินจริง 1 การ์ดเต็มๆ
- **หลักฐาน (verifier):** ยืนยัน: dup check = prodOrders.find ฝั่ง client (1097-1101) · doInsertProdOrder insert ตรงไม่มี server-side check (1055-1069) · realtime debounce 600ms (548-557) + latency loadProdOrders = หน้าต่าง race จริง ~1-2 วิ · grep ทุก migration: ไม่มี unique index ใดๆ บน prod_orders — CLAUDE.md ห้ามเฉพาะ unique บน prod_no ทั้งตาราง (เหตุผล: ยกยอดข้ามกะสร้าง prod_no เดิมใน 'คนละ session') ซึ่งไม่ขัดกับ partial index (session_id, prod_no) ที่ fix เสนอ — ตรวจแล้ว pattern การใช้จริงไม่มีเคส legit ที่ (session_id, prod_no) ซ้ำ: chain ยกยอดอยู่คนละ session เสมอ, revert เป็น update แถวเดิม, และ dup check ปัจจุบันบล็อกแม้ใบ confirmed ในกะเดียวกันอยู่แล้ว (1099) = intent ของระบบคือ 1 การ์ด/กะ 1 แถว · dedup ของ trigger เช็คต่อ ref_order_id (20260714:23-26) = คนละ id โพสต์ซ้ำได้จริง
- **แนวแก้ที่เสนอ:** เพิ่ม partial unique index: create unique index on prod_orders (session_id, prod_no) where status <> 'imported' — ไม่ขัดกฎห้าม unique ทั้งตาราง (chain ยกยอดอยู่คนละ session เสมอ) · UI แปลง error 23505 เป็น 'ใบนี้ถูกเปิดโดยเครื่องอื่นแล้ว'
- **SQL เช็ค:**
```sql
-- DR: การ์ดใบเดียวกันมีหลายแถวในกะเดียว (ตัด chain ยกยอดข้ามกะออกด้วย session เดียวกัน)
select session_id, prod_no, count(*) n, array_agg(status) statuses
from prod_orders where prod_no not like 'MANUAL-%'
group by session_id, prod_no having count(*) > 1 order by n desc limit 20;
```

### #15 🔵 ปิดกะเลือก 'ผลิตครบแล้ว' เขียนทับ qty_actual ด้วยเป้า — ใบ manual ที่ทำเกินเป้าเสียยอดจริง + เข้าคลังต่ำกว่าจริง
- **ไฟล์:** `src/pages/DailyReport.jsx:1885` · **โดเมน:** ผลิต FG → เข้าคลังอัตโนมัติ · **สถานะ:** ✅ แก้แล้ว (batch 2 · 2026-08-25)
- **scenario:** ใบ manual เป้า 500 พนักงานอัพยอดสะสม 520 → หัวหน้าไม่ได้กดปุ่มปิดใบก่อน ไปกดปิดกะเลย: invalidCarry บังคับเลือก 'ผลิตครบแล้ว' → qty_actual ถูกทับ 520→500, trigger โพสต์ 500 → ของจริง 20 ชิ้นหายทั้งจากคลังและจากยอดจริง (เหลือร่องรอยใน prod_order_qty_updates เท่านั้น)
- **หลักฐาน (verifier):** ยืนยัน (ปรับ line จาก 1883 → 1885 คือบรรทัด qty_actual: order.qty ใน branch 'confirm' 1882-1889 · ไม่เซ็ต qty_ok → trigger โพสต์ qty): ใบ manual กรอกเกินเป้าได้จริง (guard 1403 ยกเว้น is_manual) · modal ปิดกะ prefill carryQtyActual จาก qty_actual (2455-2459) → 520 ≥ 500 ติด invalidCarry (1802, 4058-4062) เลือก 'ยกยอด' ไม่ได้ ถูกบีบเหลือ 'confirm' (ทับเป็น 500 · UI 4102-4105 โชว์ 'ปิดยอด 500/500 ครบเป้า' โดยไม่เตือนว่าสะสมจริง 520) หรือ 'cancel' (เก็บ 520 แต่ไม่เข้าคลังเลย) — ไม่มีทางถูกใน modal · path ที่ถูกมีแค่ปุ่ม ✓ ปิดใบนี้ ก่อนเปิด modal (handleManualClose 1426-1429 เขียน qty=finalQty ถูกต้อง) · เป็น edge จริง severity blue เหมาะสม
- **แนวแก้ที่เสนอ:** branch 'confirm' ใน handleCloseSession: ถ้า order.is_manual ให้ finalQty = max(qActual, o.qty_actual, o.qty) แล้วเขียน qty/qty_ok/qty_actual = finalQty แบบเดียวกับ handleManualClose แทน hardcode order.qty
- **SQL เช็ค:**
```sql
-- DR: ใบที่ log ยอดสะสมสูงกว่ายอดที่ stamp ตอน confirm
select o.prod_no, o.qty, max(u.qty_accum) logged_max from prod_orders o
join prod_order_qty_updates u on u.order_id = o.id
where o.status='confirmed' and coalesce(o.is_manual,false)
group by o.id, o.prod_no, o.qty having max(u.qty_accum) > o.qty;
```

### #16 🔵 attachMachine ใช้ try{await ...update()}catch{} — supabase-js ไม่ throw = error ถูกกลืนโดย catch ที่ไม่มีวันทำงาน
- **ไฟล์:** `src/pages/DailyReport.jsx:1051` · **โดเมน:** ผลิต FG → เข้าคลังอัตโนมัติ · **สถานะ:** ✅ แก้แล้ว (batch 2 · 2026-08-25)
- **scenario:** เปิดใบบนไลน์ parallel_machine เลือกเครื่อง SP-72 → update ล้ม (RLS/เน็ต/คอลัมน์) = ใบไม่ผูกเครื่องแบบเงียบสนิท → Heijunka จัดเลน round-robin แทนเลนเครื่องจริง + %A หัก DT 1/N เพี้ยน + /order-trace ระบุเครื่องไม่ได้ โดยไม่มีใครรู้ว่าการผูกล้มเหลว
- **หลักฐาน (verifier):** ยืนยันตรงบรรทัด: 1051 คือ try { await supabaseDR.from('prod_orders').update({ machine_no }) } catch { /* คอลัมน์อาจยังไม่มี */ } — ขัดกฎเหล็กของโปรเจคเองตรงตัว (CLAUDE.md 2026-08-10: 'try/catch ที่ไม่ destructure error ไม่ใช่ best-effort มันคือกลืน error ทิ้ง' — supabase-js คืน {error} ไม่ throw) · เป็นจุดเดียวใน flow เปิดใบที่ยังใช้ pattern ต้องห้ามนี้ (จุดอื่นเช่น 1408, 1533 destructure error แล้ว) · CLAUDE.md ระบุ feature เลือกเครื่องใช้งานจริง (refine 2026-08-05 จากข้อมูลจริง) — ข้ออ้าง 'คอลัมน์อาจยังไม่มี' ใช้เหตุผลไม่ได้แล้ว และต่อให้ยังไม่ apply pattern ที่ถูกต้องตามกฎคือ warn+toast ไม่ใช่เงียบ · ผลกระทบ (เลนบอร์ด/1/N/order-trace) ตรงตามที่ CLAUDE.md บันทึกว่า machine_no ใช้ทำอะไร
- **แนวแก้ที่เสนอ:** เปลี่ยนเป็น const { error } = await ... แล้ว console.warn + toast non-fatal ตาม pattern close_request_note (งานหลักสำเร็จ แต่ผูกเครื่องไม่ได้ — ห้ามเงียบ)

### #17 🔴 ถอยใบ (↩️) แล้วสแกนปิดใหม่ = fn_explode_child_demand ระเบิด BOM ซ้ำ 2 รอบ — หักมินิสโตร์ซ้ำ + demand สะสมซ้ำ
- **ไฟล์:** `src/pages/DailyReport.jsx:1281` · **โดเมน:** ระเบิด BOM + backflush + accumulator · **สถานะ:** 🔴 รอ DB — เรื่องเดียวกับ #11
- **scenario:** ปิดใบ FG 35 ชิ้น → trigger หัก mini-store (consume ไม่มี ref_order_id) + สะสม accumulator + ออกใบ PR/lot → กด ↩️ ถอยใบ (ลบเฉพาะแถว issue) → สแกนปิดใหม่ → OLD.status='open' ผ่าน guard → ระเบิดซ้ำเต็มรอบ: mini-store ถูกหัก 2 เท่า, accumulator +2 เท่า, ใบสั่งซื้อ/ใบผลิตลูกออกซ้ำ — และเคสถอยเพราะ 'ปิดเกินยอด' คือเคสที่รอบแรก qty ผิดอยู่แล้ว demand ผิดค้างถาวร
- **หลักฐาน (verifier):** ยืนยันครบทุกชั้น: (1) DailyReport.jsx:1280-1281 handleRevertOrder ลบเฉพาะ `.eq('ref_order_id', o.id).eq('type','issue').eq('created_by','auto')` — แถว consume ของ fn_explode_child_demand (20260821_explode_demand_lot_guard.sql:50-52) เขียนโดย **ไม่มี ref_order_id เลย** (insert ระบุแค่ line_name/mat_no/qty/type/note/created_by) จึงไม่มีวันถูกลบ · accumulator/ใบ PR-lot ที่ออกแล้วไม่ถูกแตะ (1271-1284 ไม่มีโค้ดอื่น) (2) guard ของ trigger (20260821:31-32) `if TG_OP='UPDATE' and OLD.status is not distinct from 'confirmed' then return null` — revert ทำให้ OLD.status='open' → ปิดใหม่ผ่าน guard ระเบิดเต็มรอบที่ 2 (3) contrast พิสูจน์ว่าเป็นการตกหล่นไม่ใช่เจตนา: trg_post_confirmed_output มี dedup `if exists (... ref_order_id = NEW.id ...)` (20260710_stock_inflow_on_confirm.sql:45-46) และ comment ที่ 1260-1262 แสดงเจตนาให้ re-scan idempotent — แต่ explode trigger (เกิด 2026-08-19 หลัง revert feature 2026-07-15) ไม่เคยถูกรวมเข้า flow ถอยใบ · CLAUDE.md ไม่มีที่ไหนบันทึกว่าตั้งใจ
- **แนวแก้ที่เสนอ:** ให้ trigger กันซ้ำแบบเดียวกับ trg_post_confirmed_output: ใส่ ref_order_id ลงแถว consume แล้วเช็คก่อนระเบิด (มีแถว consume/บันทึกการระเบิดของ order id นี้แล้ว = ข้าม) หรือเพิ่มคอลัมน์ exploded_at บน prod_orders เช็คใน trigger · ฝั่ง handleRevertOrder ถ้าจะให้ระเบิดใหม่ได้ ต้องถอนแถว consume + ลด accumulator ของรอบแรกด้วย (ระบุ order ได้จาก ref_order_id ที่เพิ่มใหม่)
- **SQL เช็ค:**
```sql
-- DB=DR · หา FG ที่ถูก consume ซ้ำ + จำนวนใบที่เคยถอยแล้วปิดใหม่
select note, mat_no, count(*) n, sum(qty) qty from line_stock_transactions where created_by='auto' and type='consume' group by 1,2 having count(*)>1;
select count(*) reopened from prod_orders where coalesce(reopen_count,0)>0 and status='confirmed';
```

### #18 🔴 ใบยกยอดข้ามกะ: ยอดที่ผลิตจริงในกะแรก (qty_actual) ไม่เคยผ่าน trigger — backflush/demand/FG stock ของส่วนนั้นหายถาวร
- **ไฟล์:** `src/pages/DailyReport.jsx:1526` · **โดเมน:** ระเบิด BOM + backflush + accumulator · **สถานะ:** 🔴 รอ DB — เรื่องเดียวกับ #10
- **scenario:** ใบเป้า 35 ทำได้ 18 ยกไป 17: ใบเดิมเป็น carry_over→imported (ไม่เคย confirmed) → 18 ชิ้นแรกไม่ถูกระเบิด BOM ไม่หักมินิสโตร์ ไม่เข้าคลัง FG · กะถัดไปใบใหม่ qty=17 ปิดแล้วระเบิด/เข้าคลังแค่ 17 → ทุกใบที่ยกยอด FG stock และ child demand ต่ำกว่าจริงสะสมเงียบๆ เท่ากับ qty_actual ของกะแรก · หนักสุด remainQty<=0 (ผลิตครบแต่ไม่ได้สแกนปิด) = ทั้งใบหายจากระบบ stock/demand
- **หลักฐาน (verifier):** ยืนยันตรงทุก line: 1526 `remainQty = o.qty - (o.qty_actual||0)` · 1533-1541 ใบใหม่ qty=remainQty status='open' · 1550-1551 ใบเดิม mark 'imported' · เคส remainQty<=0 ที่ 1527-1531 mark 'imported' ตรงๆ ไม่ผ่าน confirmed เลย · ตอนปิดกะใบถูกตั้ง 'carry_over' (DailyReport:1877) ไม่ใช่ 'confirmed' → ทั้งชีวิตของใบเดิมไม่เคย 'confirmed' → ทั้ง fn_explode_child_demand (guard 20260821:31) และ trg_post_confirmed_output (เงื่อนไข confirmed เดียวกัน) ไม่เคยยิงสำหรับส่วนที่ผลิตได้จริง · CLAUDE.md พูดถึง qty_actual ของ carry_over เฉพาะฝั่ง 'การแสดงผล/รายงาน' (นับเข้า ผลิตได้) ไม่มีที่ไหนบันทึกว่าฝั่ง stock/demand ตั้งใจข้าม — วงจร FG stock ในเอกสารเขียนว่า 'สแกนปิดออเดอร์ → post เข้า stock' ซึ่งไม่ครอบเคสนี้ · grep ทั้งไฟล์ไม่พบ path อื่นที่ post stock/explode จาก qty_actual
- **แนวแก้ที่เสนอ:** เลือกแบบเดียวแล้วแก้ให้ตรงกันทั้ง 2 trigger: ก) ตอนปิดกะที่ตัดสินใจยกยอด ถ้า qty_actual>0 ให้ trigger รับ status='carry_over' โดยระเบิด/post ด้วย qty_actual + dedup ต่อใบ หรือ ข) ให้ใบยกไปถือเป้าเต็ม (qty เดิม) แล้วปิดครั้งเดียวระเบิดเต็มที่กะปลายทาง
- **SQL เช็ค:**
```sql
-- DB=DR · ยอดผลิตจริงที่ไม่เคยผ่าน trigger เลย
select status, count(*) orders, sum(qty_actual) pcs_never_exploded from prod_orders where status in ('carry_over','imported') and coalesce(qty_actual,0)>0 group by 1;
```

### #19 🔴 FlowTower ดึง purchase_requests ทั้งตารางไม่ paginate — ตารางเกิน 1000 แถวแล้ว (≥1,026) ตัวเลขสถานี 'สั่งซื้อวัตถุดิบ' ผิดเงียบ
- **ไฟล์:** `src/pages/FlowTower.jsx:76` · **โดเมน:** ระเบิด BOM + backflush + accumulator · **สถานะ:** ✅ แก้แล้ว (b272e1d 2026-08-25)
- **scenario:** purchase_requests ≥1,026 แถว → 26+ แถวหลุดจากผลลัพธ์แน่นอน · ถ้าแถว pending อยู่ในส่วนที่ถูกตัด purchPending นับขาด → สถานี 'สั่งซื้อวัตถุดิบ (Planning)' พลิกจาก 🔴 ตัน เป็น ⚪ ยังไม่ใช้ ทั้งที่มีใบค้างจริง — ขัดกฎเหล็ก pagination >1000 (บทเรียน role_permissions) บนหน้าที่ตั้งใจเปิดโชว์ผู้บริหารหลายจอ
- **หลักฐาน (verifier):** ยืนยัน: FlowTower.jsx:76 `supabaseDR.from('purchase_requests').select('status, qty')` — ไม่มี .range/.order/ไม่กรอง status · purchPending คำนวณที่ :118 · หลักฐานว่าเกิน 1000 มาจาก migration เอง (20260821_void_lot_size_typo:11 'pending 1,024 → 40 · ordered 2 · cancelled 984' = 1,026 แถวขั้นต่ำ และตารางโตต่อ) → PostgREST ตัด 1000 แถวแรกแน่นอน แถวที่หลุดอยู่ฝั่งไหนไม่การันตี (ไม่มี order) · เช็คแล้วว่าไม่ใช่ของที่แก้ไปแล้ว: QC รอบ 4 แก้ pagination ที่ DeptDashboard/DemandVsProduction/RundownStock — git log ของ FlowTower ไม่มี commit แก้ query เหล่านี้ · :72 customer_shipping_orders `.neq('shipped')` pattern เดียวกัน (434 แถว ณ 24/08 + กฎห้ามลบออเดอร์วันเก่า 2026-08-19 = สะสมทางเดียว) · :74-75 child_lot_requests/raw_withdrawal_requests โตไม่จำกัดเหมือนกัน
- **แนวแก้ที่เสนอ:** purchase_requests: กรองฝั่ง server `.eq('status','pending')` + `select('qty', {count:'exact'})` หรือใช้ fetchAllPages (helper มีแล้วใน fetchByIds.js จาก QC รอบ 4) · customer_shipping_orders: กรอง status + นับด้วย count:'exact' หรือ aggregate ฝั่ง view · ทำเหมือนกันกับ child_lot_requests/raw_withdrawal_requests
- **SQL เช็ค:**
```sql
-- DB=DR
select count(*) total, count(*) filter (where status='pending') pending from purchase_requests;
select count(*) from customer_shipping_orders where status <> 'shipped';
```

### #20 🟡 ยอดค้างเกินเพดาน MAX_LOTS มองไม่เห็นที่ไหนเลย — v_demand_flow_blocks กรอง lot_size>0 ทิ้ง ขัดกับที่ comment ใน guard migration อ้างไว้เอง
- **ไฟล์:** `supabase/migrations/20260819_demand_flow_routing.sql:128` · **โดเมน:** ระเบิด BOM + backflush + accumulator · **สถานะ:** ⬜ ยังไม่แก้
- **scenario:** พาร์ท lot_size=100 pending สะสม 20,000 → ปิดใบ 1 ครั้งออกได้ 50 ใบ (5,000) เหลือ 15,000 ค้างใน accumulator → view กรองทิ้งเพราะ lot_size>0 → FlowTower ขึ้น 'ไม่มีจุดตัน' เขียว · ถ้า FG หยุดผลิตยอดค้างติดถาวรไม่มีใครเห็น
- **หลักฐาน (verifier):** ยืนยัน: view line 127-128 `where a.pending_qty > 0 and coalesce(ks.lot_size, 0) <= 0` — พาร์ทที่ตั้ง lot_size แล้วไม่มีวันโผล่ในวิว · guard migration (20260821:14-15) comment ว่า 'ส่วนที่เหลือไม่หาย...จึงยังโผล่ใน v_demand_flow_blocks / หน้า /flow-tower' = **เท็จ** (view กรองทิ้งแน่นอน) · FlowTower อ่านจุดตันจาก view อย่างเดียว (:77) · nuance ที่ทีมแรกระบุถูกแล้ว: backlog ไม่ติดถาวรเสมอไป — while loop รอบถัดไป re-read pending จาก accumulator (20260821:61) จึงระบายทีละ ≤50 ใบทุกครั้งที่ FG ใดๆ ที่ BOM มีพาร์ทนี้ปิดใบ · แต่ระหว่างนั้น 'มองไม่เห็น' จริง และถ้า FG หยุดผลิต (EC/เลิกรุ่น) = ติดถาวรเงียบ ตรงตามที่รายงาน
- **แนวแก้ที่เสนอ:** เพิ่มเงื่อนไขที่ 2 ในวิว (หรือวิวคู่): แถว lot_size>0 แต่ pending_qty >= lot_size = 'ค้างรอรอบระเบิดถัดไป (ติดเพดาน MAX_LOTS)' แสดงแยกสถานะใน FlowTower + แก้ comment ใน guard migration ให้ตรงความจริง
- **SQL เช็ค:**
```sql
-- DB=DR · ยอดค้างที่ตั้ง lot แล้วแต่ view มองไม่เห็น
select a.child_mat_no, a.pending_qty, ks.lot_size from child_demand_accumulator a join kanban_standards ks on ks.mat_no=a.child_mat_no and ks.is_active and ks.lot_size>0 where a.pending_qty >= ks.lot_size;
```

### #21 🟡 race ตอน 2 ใบปิดพร้อมกันบนไลน์เดียว: อ่าน on-hand จาก view แล้วค่อย insert consume — หักเกินจริง + demand หาย
- **ไฟล์:** `supabase/migrations/20260821_explode_demand_lot_guard.sql:43` · **โดเมน:** ระเบิด BOM + backflush + accumulator · **สถานะ:** ⬜ ยังไม่แก้
- **scenario:** on-hand พาร์ทลูก X ที่ไลน์ A = 100 · ใบ FG 2 ใบจาก 2 จอ confirmed วินาทีเดียวกัน gross ใบละ 100: ทั้งคู่อ่านได้ 100 → ทั้งคู่ insert consume 100 → on-hand จบที่ -100 และ v_short=0 ทั้งคู่ = ของขาดจริง 100 ชิ้นไม่เข้า accumulator เลย
- **หลักฐาน (verifier):** ยืนยันจากโค้ด: อ่าน on-hand จาก view (43-45) → คำนวณ consume (46-48) → insert consume (49-53) — ไม่มี FOR UPDATE / advisory lock ใดๆ (และล็อก view aggregate ไม่ได้อยู่แล้ว) · row lock แรกที่ serialize คือ on-conflict ของ accumulator ที่บรรทัด 55-58 ซึ่งอยู่ **หลัง** จุด consume จริงตามที่ทีมแรกระบุ → 2 ทรานแซกชันขนานอ่านค่า on-hand เดียวกันภายใต้ MVCC ได้แน่นอน · โอกาสเกิดต่ำ (ต้องชนไลน์+mat ที่ BOM ทับกัน+จังหวะเดียวกันจาก 2 เครื่อง — batch scan จากเครื่องเดียวเป็นทรานแซกชันเรียงกัน ไม่ชน) แต่ผลคือสต็อกติดลบ + demand หาย (v_short=0 ทั้งคู่) พร้อมกัน ตรวจย้อนยาก · ไม่มีเอกสารบันทึกว่ายอมรับ trade-off นี้
- **แนวแก้ที่เสนอ:** ล็อกก่อนอ่าน: `perform pg_advisory_xact_lock(hashtext(v_line||'|'||b.mat_no))` ก่อน select on-hand หรือย้าย on-conflict insert ของ accumulator ขึ้นก่อนขั้น consume เพื่อยืม row lock serialize ทั้งก้อน
- **SQL เช็ค:**
```sql
-- DB=DR · มีสโตร์ไลน์ไหนติดลบไหม (สัญญาณว่า over-consume เคยเกิด)
select line_name, mat_no, qty_on_hand from line_stock_summary where qty_on_hand < 0;
```

### #22 🟡 สถานี/ข้อต่อ 'สั่งซื้อวัตถุดิบ' ไม่มีทางเป็น ✅ ไหลจริง — ขัดนิยาม 4 สถานะของหน้าตัวเอง
- **ไฟล์:** `src/pages/FlowTower.jsx:181` · **โดเมน:** ระเบิด BOM + backflush + accumulator · **สถานะ:** ✅ แก้แล้ว (batch 2 · 2026-08-25)
- **scenario:** Planning ทำงานไว กดสั่งจน pending=0 แต่มีใบ status='ordered' ออกวันนี้ → สถานีแสดง ⚪ 'ยังไม่ใช้' ทั้งที่ท่อใช้งานจริง → ผู้บริหารอ่านว่าแผนกยังไม่เริ่มใช้ระบบ ตรงข้ามความจริง
- **หลักฐาน (verifier):** ยืนยันตรง line: :181 `st: S.purchPending > 0 ? 'block' : (S.blocks?.length ? 'block' : 'idle')` · link :193 `purchPending>0 ? 'block' : 'idle'` — ไม่มีทาง 'flow' จริง (query :76 select แค่ status,qty ไม่มี timestamp ให้ตัดสินการเคลื่อนไหวด้วยซ้ำ) · nuance ที่ต้องปรับจากทีมแรก: ครึ่ง 'pending>0 = block' หักล้างได้บางส่วน — CLAUDE.md บันทึกว่า pending queue คือ 'คิวงานของ Planning ต้องตามต่อ ห้ามตีเป็นนอกขอบเขต' การโชว์เป็นงานค้างจึงมีฐานจากเอกสาร ไม่ถึงกับผิด · แต่ครึ่งที่ยืนยันได้เต็ม: pending=0 + มี ordered/received วันนี้ = ⚪ ยังไม่ใช้ ทั้งที่ท่อไหลจริง ขัดนิยาม '✅ ไหลจริง = มีรายการเคลื่อนไหวจริง' ที่สถานีอื่นทุกใบใช้ — asymmetry ในหน้าเดียวกัน
- **แนวแก้ที่เสนอ:** เพิ่มมิติเวลาแบบสถานีอื่น: นับ ordered/received ใน 7 วันล่าสุด → มี = 'flow' · pending ค้างเกิน N วัน = 'block' · ไม่มีอะไรเลย = 'idle' (select created_at/ordered_at เพิ่ม พร้อมแก้ pagination ตามข้อ purchase_requests)
- **SQL เช็ค:**
```sql
-- DB=DR · ถ้ามี ordered/received ใน 7 วัน = ท่อ 'ไหลจริง' อยู่แต่หน้าแสดงเป็นตัน/ยังไม่ใช้
select status, count(*) from purchase_requests where coalesce(ordered_at, received_at, created_at) >= now() - interval '7 days' group by 1;
```

### #23 🔵 trigger ระเบิด demand ไม่กัน is_operation — guard 'OP ห้ามเข้าคลัง' (20260820) แก้เฉพาะ fn_post_confirmed_output
- **ไฟล์:** `supabase/migrations/20260821_explode_demand_lot_guard.sql:38` · **โดเมน:** ระเบิด BOM + backflush + accumulator · **สถานะ:** ⬜ ยังไม่แก้
- **scenario:** ถ้าใครผูก bom_items/product_packaging ให้รายการ OP (เกิดมาแล้ว 1 ครั้ง): ปิดใบขั้นตอน → ระเบิด demand ซ้ำทุกขั้น (parent FG ระเบิดอยู่แล้ว + OP ระเบิดเพิ่ม) = demand คูณตามจำนวนขั้นเงียบๆ
- **หลักฐาน (verifier):** ยืนยัน asymmetry: fn_explode_child_demand เวอร์ชันล่าสุด (20260821:38) `select id, name into v_fg from dr_products where mat_no = NEW.mat_no and is_active limit 1` — ไม่มีการเช็ค is_operation · ขณะที่ fn_post_confirmed_output มี guard (grep 20260820_op_items_never_enter_stock.sql:12,19 `select coalesce(is_operation,false)`) · วันนี้ harmless เพราะ OP ไม่มี BOM/packaging (loop ว่าง) แต่ precedent มีจริง: 50031601 เคยเป็น OP ที่อยู่ใน BOM 9 สูตรพร้อมกัน (บันทึกใน CLAUDE.md · แก้ด้วย 20260821_laser345_own_op_numbers แล้ว) → ไม่มีอะไรใน DB กันเกิดซ้ำ · เป็น latent bug ที่ sql_check ยืนยันสถานะปัจจุบันได้
- **แนวแก้ที่เสนอ:** เพิ่ม guard is_operation ต้นฟังก์ชัน (tolerant กับคอลัมน์แบบเดียวกับที่ 20260820 ทำ) ให้สมมาตรกับ trigger เข้าคลัง
- **SQL เช็ค:**
```sql
-- DB=DR · OP ที่มี BOM/packaging เกาะอยู่ = ระเบิดซ้ำได้จริง
select d.mat_no, count(b.id) bom_rows from dr_products d left join bom_items b on b.product_id=d.id and b.is_active where d.is_operation group by 1 having count(b.id)>0;
select d.mat_no from dr_products d join product_packaging p on p.product_id=d.id and p.is_active where d.is_operation;
```

### #24 🔵 ยกเลิกใบสั่งซื้อไม่คืนยอดเข้า accumulator — pattern เสี่ยงถ้ามี cancel path ในอนาคต (ผลกระทบเคสจริงวันนี้เล็ก)
- **ไฟล์:** `supabase/migrations/20260821_void_lot_size_typo_purchase_requests.sql:21` · **โดเมน:** ระเบิด BOM + backflush + accumulator · **สถานะ:** ⬜ ยังไม่แก้
- **scenario:** ถ้าวันหน้าเพิ่มปุ่มยกเลิก PR/child_lot โดยไม่คืน accumulator = demand leak เงียบทุกครั้งที่กดยกเลิก (การออกใบหัก accumulator ไปแล้วเสมอ)
- **หลักฐาน (verifier):** ยืนยันจากไฟล์: migration (21-25) update เป็น cancelled 984 ใบโดยไม่มี insert คืน child_demand_accumulator ที่ไหนเลย และการออกใบ = accumulator ถูกหักไปแล้ว (trigger :82 `v_pending := v_pending - v_lot`) → 984 ชิ้นหายจากทั้งสองฝั่งจริง · nuance ที่ต้องลดน้ำหนัก: migration :11 บันทึกเองว่าหลังรันยังเหลือ pending 40 ใบ = 40,000 ชิ้น mat เดียว (คิวเดิมของคอยล์ตัวเดียวกันก่อนบั๊ก) → demand 984 ชิ้นที่หายถูกคิวเดิมกลบเกินพอ ผลกระทบจริงวันนี้ ≈ 0 · คุณค่าของ finding อยู่ที่กติกาไปข้างหน้า (UI ยังไม่มีปุ่ม cancel PR — ตรวจแล้ว Heijunka มีแค่ mark ordered) ซึ่งถูกต้อง
- **แนวแก้ที่เสนอ:** ตั้งกติกา: cancel purchase_requests/child_lot_requests ที่ยัง pending ต้องคืน qty เข้า child_demand_accumulator (upsert บวกกลับ) — ทำเป็น RPC/trigger กลางก่อนมี UI cancel · ส่วน 984 ชิ้นเดิมให้ user ตัดสิน (คิว 40,000 ชิ้น mat เดียวกันยังค้างอยู่ อาจไม่ต้องคืน) ห้ามคืนอัตโนมัติ

### #25 🔵 fcastQty ดึง customer_forecasts (โดน cap 1000) ทุกรอบ poll + ทุก realtime event แต่ไม่เคยถูกแสดงผล — egress เปล่า + กับดักรอ
- **ไฟล์:** `src/pages/FlowTower.jsx:111` · **โดเมน:** ระเบิด BOM + backflush + accumulator · **สถานะ:** ✅ แก้แล้ว (batch 2 · 2026-08-25)
- **scenario:** จอ FlowTower หลายจอดึง forecast สูงสุด 1000 แถวทุก 10 นาที + ทุกครั้งที่มีใครเปิด/ปิดใบผลิตทั้งโรงงาน โดยค่าไม่ถูกแสดงเลย — เสีย egress ฟรี และเป็นกับดักตัวเลขผิดรอคนหยิบใช้
- **หลักฐาน (verifier):** ยืนยันด้วย grep ทั้งไฟล์: `fcast` ปรากฏแค่ 2 ที่ — destructure (:70/:80) กับคำนวณ fcastQty (:111) — ไม่มีที่ไหนใน JSX ใช้เลย · query :80 `.gte('period_month', since)` (since=7 วันก่อน) ครอบ forecast ถึง ส.ค. 2027 (~1,463 แถวตาม CLAUDE.md) → cap 1000 · หนักกว่าที่ทีมแรกบอก: load ถูกยิงไม่ใช่แค่ทุก RATE.ANALYTIC (:128) แต่รวม realtime ทุก event ของ prod_orders/production_sessions ด้วย (:130-136) บนหน้าที่ตั้งใจเปิดหลายจอพร้อมกัน — ขัดกฎ egress ที่เพิ่งบังคับ 2026-08-19 · ถ้าใครหยิบ fcastQty ไปโชว์จะได้ค่า undercount ที่นิยามช่วงเวลาก็ผิด (gte 7 วันก่อน = รวมอนาคตทั้งปี)
- **แนวแก้ที่เสนอ:** ตัด query fcast + fcastQty ทิ้ง หรือถ้าจะใช้จริงให้ sum ฝั่ง server (view/rpc) พร้อมนิยามช่วงเวลาที่ตั้งใจ

### #26 🔴 เคส C ของ v_store_abnormal ไม่ frame-aware — รอบหลังเที่ยงคืน (00:00-07:59) หลุดผ่านตัวกรอง hour<20 แล้วถูกตีเป็น "เลยเวลา" ปลอม
- **ไฟล์:** `supabase/migrations/20260821_store_abnormal_view.sql:40` · **โดเมน:** Store ชั้นใน: LineStock / WIP / StoreMonitor · **สถานะ:** 🔴 รอ DB — แก้วิว v_store_abnormal (ดู §DB)
- **scenario:** รอบกะดึก delivery_time='05:00' (is_active): ตอน 10:00 (now_min=600) → 600 > 300+dwell และ not-exists ที่ work_date=วันนี้เป็นจริงเสมอ (การยืนยันของเช้านี้อยู่ใต้ work_date เมื่อวาน) → ขึ้น "รอบส่งเลยเวลา" sev 3 แดงกระพริบบน /store-monitor + นับใน KPI ⏰ ตั้งแต่ 08:00 ถึงเที่ยงคืนทุกวัน ขณะที่บอร์ด Heijunka/LineStock (getRoundStatus) ตอบ ⬜ รอ — 2 จอตอบสวนกัน และเข้าสรุป Telegram รายวัน (scan 08:30 now_min=510 > 300 ก็ยิงเหมือนกัน)
- **หลักฐาน (verifier):** เปิดไฟล์ยืนยันแล้ว: line 40 `extract(hour from r.delivery_time) < 20` — comment line 33 ประกาศเจตนา "เฉพาะรอบกลางวัน — กะดึกข้ามวันเป็นเฟสถัดไป" แต่รอบ 00:00-07:59 (ซึ่งเป็นรอบกะดึกตามกรอบ 08:00→08:00) ผ่านตัวกรอง (hour 0-7 < 20) · lines 41-42 เทียบ now_min (นาฬิกาดิบ 0-1439) กับเวลารอบดิบ ไม่ห่อเข้ากรอบวันงาน — ขัดตรงกับ src/utils/deliveryRounds.js:17-23 (timeStrToMs: h<8 บวก 24 ชม.) ซึ่งไฟล์นั้นประกาศตัวเองเป็น single source of truth ของสถานะรอบส่ง (header lines 1-7) · not-exists lines 43-46 เช็ค kanban_deliveries ที่ work_date=วันนี้ ขณะที่รอบ 05:00 ของ frame วันนี้จะยืนยันจริงพรุ่งนี้เช้า → รอบ 05:00 ขึ้นแดง sev 3 ตั้งแต่ now_min>300+dwell (ช่วง ~08:00-24:00) ทุกวัน สวนกับ getRoundStatus (deliveryRounds.js:52-58) ที่ตอบ ⬜ รอ · CLAUDE.md ไม่ได้บันทึกพฤติกรรมนี้ว่าตั้งใจ (บันทึกแค่ว่าวิวเป็น single source) · ยังไม่ถูกแก้ (ไฟล์ล่าสุดของวิวคือ 20260821) · ผลกระทบจริงขึ้นกับว่ามีรอบ delivery_time < 08:00 ใน DB ไหม — คง sql_check ไว้ แต่ตัวโค้ดผิดแน่นอนไม่ว่าข้อมูลวันนี้เป็นยังไง (รอบกะดึกตัวแรกที่ถูกตั้งจะ misfire ทันที)
- **แนวแก้ที่เสนอ:** ในเคส C แปลงเวลารอบเข้ากรอบวันงานแบบเดียวกับ timeStrToMs (h<8 บวก 24 ชม. แล้วเทียบกับนาทีนับจากเริ่มกรอบ) หรือถ้าตั้งใจตัดกะดึกจริงให้กรอง `r.shift='day'` ตรงๆ แทน `hour<20` (hour<20 ไม่ใช่นิยามของรอบกลางวันตามกรอบ 08:00→08:00)
- **SQL เช็ค:**
```sql
-- DR: มีรอบหลังเที่ยงคืนไหม (ถ้ามีแม้ใบเดียว = false alarm รายวันทันที)
select id, line_name, shift, round_no, delivery_time from kanban_delivery_rounds where is_active and delivery_time < '08:00'::time;
```

### #27 🟡 เคส A/B เทียบ min/max ระดับ "ต่อ mat" กับ on-hand ระดับ "ต่อ location" + แถว (line,mat) ที่ net เป็น 0 ค้างในวิวตลอดกาลแล้วยิง sev 3 รายวัน
- **ไฟล์:** `supabase/migrations/20260821_store_abnormal_view.sql:29` · **โดเมน:** Store ชั้นใน: LineStock / WIP / StoreMonitor · **สถานะ:** ⬜ ยังไม่แก้
- **scenario:** mat min=500 ถูก StockMoveToChild แบ่ง 300@Line 60 + 300@Line 61 → โดนตี "ต่ำกว่า Min" 2 ใบทั้งที่รวม 600 > 500 · กลับด้าน STORE 400 + ไลน์ 300 รวม 700 > max 600 แต่ไม่มีแถวไหนเกิน = เคส B หลุด · แถวประวัติศาสตร์ qty=0 ยิง sev 3 ทุกวันตลอดกาล — น่าจะเป็นก้อนใหญ่ของ A=33 ตอน apply
- **หลักฐาน (verifier):** ยืนยัน 2 กลไก: (1) lines 28-31 join `line_stock_summary s` (แถวต่อ line,mat) กับ `kanban_standards k on k.mat_no = s.mat_no` (min/max ต่อ mat ไม่มีมิติไลน์) โดยไม่ aggregate → เปรียบเทียบ per-location กับเกณฑ์ per-mat จริง (2) นิยาม line_stock_summary (20260708_line_stock_review_workflow.sql:47-56) เป็น `group by line_name, mat_no` **ไม่มี having sum<>0** → (line,mat) ที่ยอดสุทธิ 0 ยังมีแถว qty_on_hand=0 ตลอดกาล → เข้าเงื่อนไข `qty_on_hand <= 0 then 3` (line 27) = sev 3 รายวันถ้า mat นั้น min>0 · เคสรูปธรรมที่ระบบสร้างเอง: กด 🔀 ย้ายมินิสโตร์ (StockMoveToChild) ย้ายหมดจากไลน์แม่ → แถวไลน์แม่เหลือ 0 → โดนตีแดง "หมด" ทันทีหลังทำตามที่ระบบแนะนำ · LineStock.jsx:146-152 (stockStatus) เทียบ per-location แบบเดียวกัน — เป็น pattern เดิมทั้งระบบ CLAUDE.md ไม่เคยเคาะว่านิยาม min คุมชั้นไหน จึงเป็นคำถามดีไซน์ที่ต้องให้ user ตัดสิน แต่กลไกขัดกันกับฟีเจอร์แบ่งสต็อกข้ามไลน์ลูกยืนยันได้จากโค้ดแน่นอน
- **แนวแก้ที่เสนอ:** ตัดสิน A/B จากยอดรวมต่อ mat (sum ข้าม location) หรือจำกัดเคส A/B เฉพาะ location ที่ min/max มีความหมายจริง (STORE/FG WAREHOUSE) — ต้องให้ user เคาะว่านิยาม min คุมชั้นไหน แล้วแก้ที่วิวที่เดียว · อย่างน้อยตัดแถว qty_on_hand=0 ที่ไม่มี movement ล่าสุดออกจากเคส A หรือเติม having sum<>0 (ระวัง: LineStock ใช้วิวเดียวกัน)
- **SQL เช็ค:**
```sql
-- DR: mat ที่กระจาย >1 location และเข้าเกณฑ์ A แบบ per-location แต่ยอดรวมจริงเกิน min + นับแถว qty=0 ที่ค้างยิง
select s.mat_no, count(*) locs, sum(s.qty_on_hand) total, min(k.min_qty) min_qty,
       count(*) filter (where s.qty_on_hand < k.min_qty) rows_flagged,
       count(*) filter (where s.qty_on_hand = 0) zero_rows
from line_stock_summary s join kanban_standards k on k.mat_no=s.mat_no and k.is_active and k.min_qty>0
group by s.mat_no having count(*) filter (where s.qty_on_hand < k.min_qty) > 0;
```

### #28 🟡 สแกนรายวัน 08:30 + วิวเช็คเฉพาะ work_date วันนี้ → เคส C/D ของวันที่เพิ่งจบไม่มีทางเข้า Telegram เชิงโครงสร้าง
- **ไฟล์:** `supabase/functions/store-daily-scan/index.ts:41` · **โดเมน:** Store ชั้นใน: LineStock / WIP / StoreMonitor · **สถานะ:** ⏸ ต้อง deploy edge store-daily-scan — จัด batch แยก
- **scenario:** รอบกลางวัน 17:00 เมื่อวานไม่มีใครกดยืนยันส่ง: ตอนสแกน 08:30 วันนี้ not-exists เช็ค work_date=วันนี้ + now_min=510 < 1020 → ไม่ติดเงื่อนไข → รอบที่พลาดหายจากสรุป Telegram ถาวร · partial receipt ของเมื่อวานก็หายแบบเดียวกัน — label ของ rule โฆษณาว่าครอบ "รอบส่งเลยเวลา/รับไม่ครบ" แต่รายงานได้จริงแค่ A/B/E
- **หลักฐาน (verifier):** ยืนยันจากโค้ดล้วน ไม่ต้องพึ่งข้อมูล: scan อ่าน v_store_abnormal ณ เวลารัน (index.ts:41) · วิวเคส C not-exists เช็ค kanban_deliveries ที่ `d.work_date = wd.work_date` (view lines 43-46) และ `wd.now_min > เวลารอบ` — ตอน 08:30 work_date หมุนเป็นวันใหม่แล้ว (view lines 12-14) + now_min=510 ยังไม่เลยรอบกลางวันไหนของวันใหม่ → รอบ 17:00 เมื่อวานที่ไม่มีใครยืนยันล่องหนถาวรจากแจ้งเตือน (เข้า Telegram ได้เฉพาะ false alarm รอบหลังเที่ยงคืนจาก finding แรก) · เคส D (view lines 49-55) กรอง `k.work_date = wd.work_date` — ตอน 08:30 วันงานเพิ่งเริ่ม 30 นาที ว่างเกือบเสมอ · comment วิว line 8 วินิจฉัยว่า "C/D ยังไม่ขึ้นเพราะข้อมูลบาง" ซึ่งผิด — เป็นข้อจำกัดเชิงจังหวะเวลา ต่อให้ข้อมูลหนาก็ไม่ขึ้น · หน้า /store-monitor ที่เปิดระหว่างวันยังเห็น C/D ของวันปัจจุบันได้ปกติ — พังเฉพาะขา Telegram รายวันซึ่งเป็นเหตุผลการมีอยู่ของ scan (header index.ts:5-6: "คนไม่เปิดหน้า = ไม่มีใครรู้") · เทียบ getRoundStatus (deliveryRounds.js:40,53-54) ที่ตีวันย้อนหลังเป็น 🔴 ค้างส่ง — วิวไม่มี branch นี้
- **แนวแก้ที่เสนอ:** ให้เคส C/D ในวิวมองย้อน work_date-1 ด้วย (รอบเมื่อวานที่ไม่มีแถวยืนยัน = ค้างส่ง — ตรงกับ getRoundStatus) หรือเพิ่มรอบสแกนท้ายวันงาน (~07:xx ก่อนตัด 08:00) อีกหนึ่งครั้ง

### #29 🟡 reviewTxn อนุมัติ/ปฏิเสธคิว adjust ไม่นับแถวที่เขียนจริง — 2 คนตัดสินพร้อมกันได้ toast โกหก
- **ไฟล์:** `src/pages/LineStock.jsx:183` · **โดเมน:** Store ชั้นใน: LineStock / WIP / StoreMonitor · **สถานะ:** ✅ แก้แล้ว (batch 2 · 2026-08-25)
- **scenario:** ผู้อนุมัติ A กดปฏิเสธ 10:00:00 · ผู้อนุมัติ B กดอนุมัติ 10:00:01 → update ของ B match 0 แถว (ดี—ไม่เขียนซ้ำ) แต่ supabase คืนสำเร็จ → B เห็น toast "✅ อนุมัติแล้ว — เข้า stock" ทั้งที่รายการถูกปฏิเสธ ยอดไม่เข้า — ผู้อนุมัติ B เข้าใจผิดว่า stock ถูกปรับแล้ว
- **หลักฐาน (verifier):** ยืนยัน: lines 183-184 `.update(patch).eq('id', txn.id).eq('status','pending')` ไม่มี `.select('id')` ไม่นับ data.length · line 186 เช็คแค่ error แล้ว line 187 toast สำเร็จเสมอ · comment line 177 อ้างว่า .eq('status','pending') "ปลอดภัยจากการกดซ้ำ/สองคน" — ถูกแค่ครึ่งเดียว (กันเขียนซ้ำได้จริง แต่ update ที่ match 0 แถวคืนสำเร็จไม่มี error → คนที่สองเห็น "✅ อนุมัติแล้ว — เข้า stock" ทั้งที่รายการถูกปฏิเสธไปแล้ว) · ขัดกฎเหล็ก CLAUDE.md ".update() ที่ถูกบล็อก = สำเร็จ 0 แถว ต้องนับแถวเสมอ" ซึ่งจุดอื่นในไฟล์ระบบทำแล้ว (เทียบ StockMoveToChild.jsx:84-90 ที่ .select('id') + นับแถว) · loadPending() ที่ตามมาช่วยให้คิวรีเฟรชแต่ไม่แก้ toast ที่โกหกไปแล้ว · ยังไม่ถูกแก้ในโค้ดปัจจุบัน
- **แนวแก้ที่เสนอ:** ต่อ `.select('id')` แล้วเช็ค data.length — 0 แถว = toast บอกว่า "รายการนี้ถูกอนุมัติ/ปฏิเสธโดยคนอื่นไปแล้ว" แล้ว reload คิว

### #30 🟡 โหลด line_stock_summary ทั้ง view ไม่แบ่งหน้า 4 จุด (LineStock ×2, FlowTower, DeptDashboard) — เกิน 1000 แถวเมื่อไหร่ของหายเงียบ
- **ไฟล์:** `src/pages/LineStock.jsx:119` · **โดเมน:** Store ชั้นใน: LineStock / WIP / StoreMonitor · **สถานะ:** ✅ แก้แล้ว (batch 2 · 2026-08-25)
- **scenario:** line_stock_summary พ้น 1000 แถว → PostgREST clamp เงียบ: mat ท้ายลิสต์ (เรียง line_name, mat_no) หายจากตาราง Stock · onHandOf เห็น 0 → ปรับลด/คืนเด้ง confirm "จะติดลบ" ทั้งที่ของมีจริง · แผง StockMoveToChild + FlowTower + DeptDashboard store view ตกหล่นชุดเดียวกัน
- **หลักฐาน (verifier):** grep ทั้ง src ยืนยัน: จุดที่ดึง**ทั้ง view** ไม่แบ่งหน้า = LineStock.jsx:119 (`select('*')` — จอเขียนหลักของ store) · LineStock.jsx:1204 · FlowTower.jsx:71 · DeptDashboard.jsx:449 — ขณะที่ RundownStock.jsx:37 และ DemandVsProduction.jsx:69 ถูกย้ายไป fetchAllPages แล้ว (พร้อม comment orderBy composite เพราะ view ไม่มี id) = ยืนยันว่า audit รอบก่อนแก้บางจุดแล้วตกสำรวจ 4 จุดนี้จริง ไม่ใช่ของที่แก้ไปแล้ว · จุดอื่น (VSM/CustomerDemand/Heijunka/Dashboard/WipBetweenSteps) กรอง .in('mat_no',...) แคบอยู่แล้วไม่เข้าข่าย · fetchAllPages มีอยู่จริงใน utils/fetchByIds.js:41 พร้อมใช้ · view โตทางเดียว (group by line_name,mat_no ไม่มี having — แถวไม่มีวันหาย + StockMoveToChild แตกแถวเพิ่มทุกครั้งที่ย้าย) · ผลพวงใน LineStock: onHandOf (line 155-158) หาแถวจาก state stock → mat ที่หลุดหน้า = เห็นเป็น 0 → guard กันติดลบ (lines 208-212) เด้ง confirm ผิด · ขัดกฎ CLAUDE.md "ตารางที่โตได้เกิน 1000 ต้อง paginate เสมอ" ชัดเจน — headroom ปัจจุบันเป็นเรื่องข้อมูล (คง sql_check) แต่ rule violation ยืนยันจากโค้ด
- **แนวแก้ที่เสนอ:** ใช้ fetchAllPages() (utils/fetchByIds.js — มีอยู่แล้ว + pattern orderBy composite ['line_name','mat_no'] ตาม RundownStock) กับ LineStock.jsx:119, :1204, FlowTower.jsx:71, DeptDashboard.jsx:449
- **SQL เช็ค:**
```sql
-- DR: ตอนนี้กี่แถว เหลือ headroom เท่าไหร่
select count(*) from line_stock_summary;
```

### #31 🟡 ขาส่งแจ้งเตือนของ store-daily-scan กลืนความล้มเหลว 2 ชั้น (.catch เงียบ + ไม่เช็ค res.ok) — Telegram ตายได้เป็นเดือนโดย scan รายงาน ok
- **ไฟล์:** `supabase/functions/store-daily-scan/index.ts:66` · **โดเมน:** Store ชั้นใน: LineStock / WIP / StoreMonitor · **สถานะ:** ⏸ ต้อง deploy edge store-daily-scan — จัด batch แยก
- **scenario:** ใครแก้ payload/secret ของ send-store-notification จน 400 หรือ function ถูก undeploy → scan คืน {ok:true, findings:33} ทุกวัน cron log เขียวสนิท ไม่มีใครได้รับแจ้งเตือนสักคน และไม่มีสัญญาณให้ไล่ย้อน
- **หลักฐาน (verifier):** ยืนยัน: lines 66-70 `await fetch(NOTIFY_URL, {...}).catch(() => {})` — (1) network error ถูกกลืน (2) response ไม่ถูก assign/เช็ค `.ok` เลย → send-store-notification คืน 4xx/5xx ก็ผ่าน · line 72 คืน `{ok:true, findings}` โดยไม่มีข้อมูลว่า notify สำเร็จไหม → cron.job_run_details เขียวตลอดแม้ไม่มีใครได้รับแจ้งเตือน · ไม่ใช่พฤติกรรมที่ CLAUDE.md บันทึกว่าตั้งใจ — pattern fire-and-forget ที่ documented เป็นของฝั่ง client (notify หลัง action หลักสำเร็จ) แต่ที่นี่การ notify คือหน้าที่ทั้งหมดของ function (header lines 5-6 ประกาศเองว่าสร้างมาแก้ปัญหา "ไม่เปิดหน้าดู = ไม่มีใครรู้") จึงเข้ากฎ "ห้ามล้มเหลวเงียบ" เต็มๆ · เทียบ: ขา query view มี `if (error) throw error` (line 42) ถูกต้อง — ความไม่สมมาตรยืนยันว่าขา notify ตกหล่นไม่ใช่ดีไซน์
- **แนวแก้ที่เสนอ:** เช็ค res.ok + สะท้อนผลใน response (`notified: true/false, notify_status`) เพื่อให้ cron.job_run_details ใช้ไล่ย้อนได้ · อย่างน้อย console.error ตอน non-ok · ต้อง redeploy edge หลังแก้

### #32 🔵 นิยาม dwell ของเคส C ใช้ coalesce(...,0) ต่างจาก default (points||1)×(min||10) ของ getRoundStatus — drift ชนิดที่วิวถูกสร้างมาเพื่อฆ่า
- **ไฟล์:** `supabase/migrations/20260821_store_abnormal_view.sql:42` · **โดเมน:** Store ชั้นใน: LineStock / WIP / StoreMonitor · **สถานะ:** ⬜ ยังไม่แก้
- **scenario:** รอบที่ points_count/time_per_point_min เป็น null: 17:00 ตรง — /store-monitor ขึ้น ⏰ เลยเวลา แดง ขณะบอร์ด Heijunka/LineStock ยังโชว์ ⏳/รอ ถึง 17:10
- **หลักฐาน (verifier):** ยืนยัน: view line 42 `coalesce(r.points_count,0) * coalesce(r.time_per_point_min,0)` vs src/utils/deliveryRounds.js:33 `roundDeliveryMin = (r.points_count || 1) * (r.time_per_point_min || 10)` (getRoundStatus ใช้ที่ line 57) — รอบที่ค่า null (หรือ 0 ซึ่ง `||` fallback แต่ coalesce ไม่) วิวตี dwell=0 ขึ้น "เลยเวลา" ทันทีที่ถึง delivery_time ขณะบอร์ดยังให้เวลาส่งอีก 10 นาที · ต่างสูงสุด ~10 นาทีจริงตามที่ทีมแรกประเมิน แต่เป็น drift ของนิยาม "ค้างส่ง" ระหว่าง 2 จอในระบบที่ header วิว (line 7) ประกาศว่าเงื่อนไขต้องอยู่ที่เดียว — blue เหมาะสม
- **แนวแก้ที่เสนอ:** เปลี่ยนเป็น coalesce(nullif(r.points_count,0),1) * coalesce(nullif(r.time_per_point_min,0),10) ให้ตรง util

### #33 🔵 scope filter ของ StoreMonitor ซ่อน findings ของคลังกลาง (STORE/FG WAREHOUSE) จาก role ที่ถูกจำกัด sections/leader
- **ไฟล์:** `src/pages/StoreMonitor.jsx:74` · **โดเมน:** Store ชั้นใน: LineStock / WIP / StoreMonitor · **สถานะ:** ✅ แก้แล้ว (batch 2 · 2026-08-25)
- **scenario:** supervisor sections=['PD3'] เปิด /store-monitor: เคส A/E ที่ line='STORE' ทั้ง 33+42 รายการถูกกรองทิ้ง → จอขึ้นเขียว "ไม่พบความผิดปกติ" ทั้งที่คลังกลางมี shortage — ภาพหลอกด้านดี
- **หลักฐาน (verifier):** ยืนยัน: scopeLineNames (lines 64-72) สร้าง Set จากชื่อ production_lines เท่านั้น (family ของ leader หรือไลน์ใน sections) · line 74 `scoped = findings.filter(f => !f.line || scopeLineNames.has(f.line))` — แถวที่ line ว่างผ่าน แต่แถว line_name='STORE'/'FG WAREHOUSE' (มีจริงใน line_stock_summary ตามนิยาม ledger — เป็นปลายทาง stock_inflow_rules) ไม่อยู่ใน Set → ถูกกรองทิ้งทั้ง ลิสต์/ตัวนับ (lines 83-85) · CLAUDE.md บันทึก scope pattern ของหน้านี้เป็นของ audit 2026-08-03 แต่ไม่เคยเคาะ side effect กับชื่อคลังที่ไม่ใช่ไลน์ผลิต — ไม่มีหลักฐานว่า "ตั้งใจซ่อนคลังกลาง" (ตรงข้าม: header หน้านี้บอก primary user คือ store ซึ่งไม่มี scope จึงไม่เคยมีใครเจอ) · blue เหมาะสม: กระทบเฉพาะ supervisor/leader/dept_admin ที่ถูกตั้ง scope ซึ่งเปิดมาเห็น "ไม่พบความผิดปกติ" ปลอม
- **แนวแก้ที่เสนอ:** แถวที่ line ไม่อยู่ใน production_lines เลย (= คลังกลาง STORE/FG WAREHOUSE) ให้ผ่าน scope เสมอเหมือน `!f.line` — หรือให้ user เคาะว่าตั้งใจซ่อน

### #34 🔵 baseline นับจริงของ WIP ดึงแค่ 500 แถวล่าสุดทั้งตาราง — buffer ที่นับนานแล้วหลุดหน้าต่างเงียบๆ แล้ว inFlight เด้งกลับไปคิดจากใบผลิตทั้งประวัติ
- **ไฟล์:** `src/components/WipBetweenSteps.jsx:86` · **โดเมน:** Store ชั้นใน: LineStock / WIP / StoreMonitor · **สถานะ:** ✅ แก้แล้ว (batch 2 · 2026-08-25)
- **scenario:** นับจริงหลาย buffer เป็นประจำจนเกิน 500 แถว: buffer ที่นับครั้งสุดท้าย 6 เดือนก่อนตกนอกหน้าต่าง → inFlight ของขั้นนั้นกระโดดเป็นยอดสะสมตั้งแต่เริ่มระบบ (ผิดหลักพัน) แบบไม่มีเตือน
- **หลักฐาน (verifier):** ยืนยัน: lines 85-86 `from('wip_adjustments').select(...).order('counted_at', {ascending:false}).limit(500)` แล้ว dedupe ตัวแรกต่อ buffer_key ฝั่ง client (lines 92-96) → buffer ที่การนับล่าสุดตกนอก 500 แถวท้ายสุด = ไม่มี key ใน baselines → การคำนวณ in-flight ไม่มีจุดตั้งต้น กลับไปสะสมจากใบผลิตทั้งหมด โดยไม่มีสัญญาณบนจอ (มี banner เฉพาะกรณีตารางไม่มี aErr lines 87-89 — ไม่ครอบกรณีหลุดหน้าต่าง) · เป็น latent: ต้องสะสม >500 แถวก่อน (ตารางเพิ่ง apply 2026-08-18 ยังห่างเพดาน) — blue เหมาะสม · ชนิดเดียวกับกับดัก 1000 แถวที่ documented
- **แนวแก้ที่เสนอ:** ดึง latest ต่อ buffer_key ฝั่ง server (distinct on (buffer_key) ... order by buffer_key, counted_at desc ผ่าน RPC/วิว) หรือ fetchAllPages ทั้งตาราง — ตารางเล็ก ดึงครบได้
- **SQL เช็ค:**
```sql
-- DR: อัตราสะสมปัจจุบัน เหลือ headroom เท่าไหร่
select count(*), min(counted_at), max(counted_at) from wip_adjustments;
```

### #35 🔴 แท็บ 🛒 จัดซื้อ: ใบ cancelled 984 ใบไม่ถูกกรอง — โชว์เป็น '🆕 รอสั่งซื้อ' พร้อมปุ่มปลุกใบขยะคืนชีพ + limit(300) เบียดคิวจริงหาย
- **ไฟล์:** `src/pages/HeijunkaKanban.jsx:1041` · **โดเมน:** Kanban ดึง + รอบส่ง + จัดซื้อ · **สถานะ:** ✅ แก้แล้ว — session ขนานทำวิว v_purchase_open_summary + b272e1d เพิ่ม meta cancelled / CAS guard
- **scenario:** 3 ชั้นซ้อนกัน: (1) UnifiedStoreBoard บรรทัด 973 `filteredPurchases` ไม่กรอง status เลย — ใบ cancelled 984 ใบจาก migration 20260821_void ถูก render ทุกใบ (2) บรรทัด 1041 fallback 'cancelled' → '🆕 รอสั่งซื้อ' + ปุ่ม '🛒 สั่งซื้อแล้ว' ใช้งานได้จริง → advancePurchase (บรรทัด 1257 guard แค่ `.neq('status', next)`) เปลี่ยน cancelled→ordered→received = insert line_stock_transactions ชิ้นละ 1 เป็นสต็อกปลอมของ 50031601 (3) loadPull บรรทัด 1191 `.limit(300)` — ใบขยะ 984 ใบสร้าง 4/8 พร้อมกัน คิวจริง 40 ใบสร้างก่อนหน้า → หน้าต่าง 300 ใบล่าสุดเต็มไปด้วย cancelled และใบ pending จริงหลุดจากจอทั้งหมด ขณะที่ badge (บรรทัด 964,968) โชว์เลขไม่ตรงกับการ์ดที่เห็น — Planning เปิดแท็บมาเจอขยะ 300 ใบ 'รอสั่งซื้อ' แต่คิวจริงมองไม่เห็น = dead-end ของสายจัดซื้อทั้งเส้น
- **หลักฐาน (verifier):** ยืนยันครบ 3 ชั้น: (1) HeijunkaKanban.jsx:973 `filteredPurchases = buyFilter ? purchaseRequests.filter(p => matMatches(...)) : purchaseRequests` — ไม่กรอง status ใดๆ ขณะที่ badge นับจาก openPurchases (บรรทัด 964 กรอง received+cancelled ถูกต้อง) = เลข badge กับการ์ดที่เห็นไม่ตรงกันจริง (2) บรรทัด 1041 `PURCHASE_STATUS[pr.status] || PURCHASE_STATUS.pending` — ตรวจ PURCHASE_STATUS (บรรทัด 910-914) มีแค่ pending/ordered/received ไม่มี cancelled → fallback เป็น '🆕 รอสั่งซื้อ' + nextLabel '🛒 สั่งซื้อแล้ว' และปุ่ม render เมื่อ canOperate (บรรทัด 1046) → advancePurchase guard บรรทัด 1257 มีแค่ `.neq('status', next)` — cancelled≠ordered ผ่าน guard → resurrect ได้จริง แล้วขั้น received insert line_stock_transactions (บรรทัด 1261-1265) = สต็อกปลอม (3) loadPull บรรทัด 1191 `.order('created_at', desc).limit(300)` — ใบขยะ 984 ใบสร้างพร้อมกัน 4/8 (ยืนยันจาก migration 20260821_explode_demand_lot_guard.sql header + CLAUDE.md) และหลังจากนั้น 'ไม่มีใบสั่งซื้อออกอีกเลย 17 วัน' → หน้าต่าง 300 ใบล่าสุดเกือบแน่นอนว่าเต็มไปด้วย cancelled · เทียบกับ rack_requests ที่ถูกกรองแล้วที่บรรทัด 1197 (มีคอมเมนต์กำกับว่าเคยเจอบั๊กแบบเดียวกัน) = pattern fix มีอยู่แล้วแต่ไม่ได้ทำกับ purchase · CLAUDE.md ไม่ได้บันทึกว่าเป็นพฤติกรรมตั้งใจ และ QC รอบ 2026-08-20..24 ไม่ได้แก้จุดนี้ (git log ยืนยัน)
- **แนวแก้ที่เสนอ:** loadPull: กรองฝั่ง server `.neq('status','cancelled')` (หรือ `.in('status',['pending','ordered','received'])`) ก่อน limit — pattern เดียวกับ rack_requests ที่กรองแล้วบรรทัด 1197 · เพิ่ม meta `cancelled` ใน PURCHASE_STATUS (label ⛔ ยกเลิก, next:null) กันหลุดเป็น pending · advancePurchase เพิ่ม `.eq('status', pr.status)` กัน transition ข้ามสถานะ (รวม resurrect จาก cancelled)
- **SQL เช็ค:**
```sql
-- DB = DR
select status, count(*), min(created_at), max(created_at) from purchase_requests group by status;
select status, count(*) from (select status from purchase_requests order by created_at desc limit 300) t group by status;
-- ถ้าแถว pending ในคิวรีที่ 2 < จำนวน pending จริง = คิวจริงถูกเบียดหลุดจอแล้ว
```

### #36 🟡 FlowTower: purchPending นับจาก select ไม่ paginate — ตารางทะลุเพดาน 1000 แถวไปแล้วจริง (~1,026 ใบ)
- **ไฟล์:** `src/pages/FlowTower.jsx:76` · **โดเมน:** Kanban ดึง + รอบส่ง + จัดซื้อ · **สถานะ:** ✅ แก้แล้ว (b272e1d 2026-08-25)
- **scenario:** PostgREST คืนสูงสุด 1000 แถวจาก ~1,026 (984 cancelled + 40 pending + ordered/received) โดยไม่มีลำดับการันตี → 26+ แถวหลุดแบบสุ่ม · ถ้าแถว pending ตกอยู่ในส่วนที่ถูกตัด จอผู้บริหาร /flow-tower โชว์คิวจัดซื้อค้างต่ำกว่าจริงเงียบๆ และเพี้ยนหนักขึ้นเมื่อตารางโต — บั๊ก class เดียวกับ role_permissions 1000 แถว
- **หลักฐาน (verifier):** FlowTower.jsx:76 `supabaseDR.from('purchase_requests').select('status, qty')` — ไม่มี order/limit/pagination → ติดเพดาน PostgREST 1000 แถวโดยไม่มีลำดับการันตี · บรรทัด 118 `purchPending = filter(p => p.status === 'pending')` นับจากชุดที่ถูกตัด · ซ้ำร้าย error-check ที่บรรทัด 83-84 (`bad` list) ไม่รวม `purch` ด้วย = ล้มเหลว/ตัดแถวก็เงียบ · CLAUDE.md ยืนยันตารางมี ~1,024 ใบแล้วจริง (40 pending + 984 cancelled) → นับขาดเกิดได้ตอนนี้ ไม่ใช่อนาคต · FlowTower ไม่อยู่ในรายการไฟล์ที่ audit รอบ fetchByIds แก้ (ตรวจ git log แล้ว commit ล่าสุดของไฟล์นี้แตะเฉพาะ scope comment + ลูกศร UI) · หมายเหตุ: raw_withdrawal_requests/child_lot_requests/line_stock_summary ในหน้าเดียวกันก็ select ไม่จำกัดเหมือนกัน (วันนี้แถวน้อยยังไม่ถึงเพดาน)
- **แนวแก้ที่เสนอ:** กรองฝั่ง server ให้แคบก่อน: `.neq('status','cancelled')` (เหลือ ~42 แถว จบทันที) หรือใช้ count query `{ count:'exact', head:true }` ต่อสถานะแบบ AdoptionOutlook · ตารางอื่นในหน้าเดียวกัน (child_lot_requests / raw_withdrawal_requests / line_stock_summary) ควรกัน/ผ่าน fetchAllPages ไปพร้อมกัน + เพิ่ม purch เข้า error-check list บรรทัด 83
- **SQL เช็ค:**
```sql
-- DB = DR
select count(*) from purchase_requests;  -- > 1000 = ยืนยันว่านับขาดได้จริงตอนนี้
```

### #37 🟡 advanceWip ไม่มี guard `.neq(status)` — กดซ้ำ/2 เครื่อง = บวก current_qty จุด WIP ซ้ำสองรอบ
- **ไฟล์:** `src/pages/HeijunkaKanban.jsx:1315` · **โดเมน:** Kanban ดึง + รอบส่ง + จัดซื้อ · **สถานะ:** ✅ แก้แล้ว (batch 2 · 2026-08-25)
- **scenario:** 2 เครื่องสโตร์ (บัญชีร่วม) เห็นการ์ดสถานะ preparing ทั้งคู่ กด '✅ ส่งเติมแล้ว' พร้อมกัน → ทั้งสอง update สำเร็จ → ทั้งสองเข้า branch delivered แล้วต่างคน read-modify-write current_qty: จุด WIP max 100 ของเดิม 20 เรียกเติม 30 → ได้ 80 แทน 50 = ยอดจุด WIP เกินจริง 30 ชิ้น
- **หลักฐาน (verifier):** HeijunkaKanban.jsx:1315 `await supabase.from('wip_replenish_requests').update(payload).eq('id', w.id)` — ไม่มี `.neq('status', next)` ไม่มี `.select('id')` เช็คแถวที่เปลี่ยนจริง ต่างจาก advanceLot (บรรทัด 1212-1215 มีคอมเมนต์อธิบายเหตุผลกัน double-click ชัดเจน) และ advancePurchase (บรรทัด 1256-1259) ในไฟล์เดียวกัน · branch delivered บรรทัด 1317-1322 เป็น read-modify-write บน wip_buffer_points.current_qty (`select current_qty` → `Math.min((current_qty||0) + w.request_qty, max_qty)` → update) — 2 เครื่องที่ state ยังเป็น preparing ทั้งคู่กดพร้อมกัน update สำเร็จทั้งคู่ (ไม่มี error) แล้วต่างคนบวก request_qty → double-add จริงตามที่ทีมแรกอธิบาย (clamp เฉพาะเมื่อชน max_qty) · ไม่มี tolerant/guard อื่นที่มองข้าม
- **แนวแก้ที่เสนอ:** ใช้ pattern เดียวกับ advanceLot: `.update(payload).eq('id', w.id).eq('status', w.status).select('id')` แล้วบวก current_qty เฉพาะเมื่อ updated.length > 0 · เข้มขึ้นอีกให้บวกผ่าน RPC atomic แบบ mtn_stock_move

### #38 🟡 DeliveryRoundsPanel ให้ยืนยันส่งได้ตั้งแต่สถานะ ⬜ รอ (ก่อน cutoff) — ข้ามขั้น chain ต่างจากอีก 2 view
- **ไฟล์:** `src/pages/HeijunkaKanban.jsx:533` · **โดเมน:** Kanban ดึง + รอบส่ง + จัดซื้อ · **สถานะ:** ✅ แก้แล้ว (batch 2 · 2026-08-25)
- **scenario:** รอบบ่าย (cutoff 15:00 ส่ง 16:00) ถูกกดยืนยันได้ตั้งแต่ 08:30 ขณะสถานะยัง ⬜ รอ → insert stock 'issue' ทันทีด้วย netTotal ที่คำนวณจาก order ที่เปิดถึงแค่ 08:30 — order ที่สแกนเปิดตอน 10:00-15:00 ตกหน้าต่างรอบนี้แต่รอบถูกปิดไปแล้ว (confirmedSet + upsert ignoreDuplicates กันยืนยันซ้ำ) = ของส่งขาดจาก demand จริงโดยระบบโชว์ 📦 ส่งแล้ว · 3 view หน้าเดียวกันกติกาไม่เท่ากัน
- **หลักฐาน (verifier):** HeijunkaKanban.jsx:533 `{canOperate && !isConf && (` → ปุ่ม '✅ ยืนยันส่งแล้ว' (บรรทัด 534-537) โผล่ทุกสถานะที่ยังไม่ยืนยัน — เทียบกับอีก 2 view ในไฟล์เดียวกันที่ gate ด้วย needAction: StoreBoardView บรรทัด 119+147 และ UnifiedStoreBoard บรรทัด 998+1003 (`needAction = !isConf && (status.label === '⏳ กำลังเตรียม' || status.label === '🔴 ค้างส่ง')`) · utils/deliveryRounds.js:59-60 ยืนยันว่าก่อน cutoff สถานะ = ⬜ รอ (ST_WAIT) จริง · panel นี้ reachable จริง — render เมื่อ viewMode = timeline/cards/table (บรรทัด 1916-1918) · ผลตาม: confirmRound (บรรทัด 1445-1473) insert issueRows จาก alloc.parts ณ เวลากด → กดก่อน cutoff = netTotal คิดจาก order ที่เปิดถึงตอนนั้นเท่านั้น และ confirmedSet จะกันรอบนั้นไม่ให้ยืนยันซ้ำอีก (upsert ignoreDuplicates บรรทัด 1452-1461) → demand ที่สแกนเข้าทีหลังตกหน้าต่างรอบที่ปิดไปแล้ว = สอดคล้อง scenario ทีมแรก
- **แนวแก้ที่เสนอ:** เพิ่มเงื่อนไข needAction แบบเดียวกับ StoreBoardView/UnifiedStoreBoard: `const needAction = !isConf && (status.label === '⏳ กำลังเตรียม' || status.label === '🔴 ค้างส่ง')` แล้วใช้แทน `!isConf` ที่บรรทัด 533 — และควรยก needAction ไปเป็น flag ใน getRoundStatus (utils/deliveryRounds.js) จะได้ไม่เทียบ label ข้อความซ้ำ 3 ที่

### #39 🟡 RackCenter QR deep-link เปิดฟอร์มเรียกภาชนะโดยไม่เช็ค rack_center:operate — ซ่อนปุ่มแต่ไม่ guard ค่าจาก URL
- **ไฟล์:** `src/pages/RackCenter.jsx:156` · **โดเมน:** Kanban ดึง + รอบส่ง + จัดซื้อ · **สถานะ:** ✅ แก้แล้ว (batch 2 · 2026-08-25)
- **scenario:** role ที่ไม่มี rack_center:operate (mtn/engineer/planner_store — ติดกับดัก seed enum_range ตามคอมเมนต์บรรทัด 247-248 ในไฟล์เอง) เปิดลิงก์จากป้าย QR `/rack-center?line=LINE 60&ctype=RACK-A&qty=1` → ฟอร์มเปิด กดยืนยัน → insert rack_requests สำเร็จ (DR anon) = ทำ action ที่ UI ตั้งใจปิดไว้
- **หลักฐาน (verifier):** RackCenter.jsx:153-158 useEffect deep-link เรียก `applyScan({line, ctype, qty})` โดยไม่มีเงื่อนไข canOperate ใดๆ → applyScan (บรรทัด 140-150) setShowForm(true) · modal ฟอร์ม render จาก showForm เปล่าๆ (บรรทัด 491) ไม่ gate สิทธิ์ · handleRequest (บรรทัด 195-216) insert rack_requests ตรง ไม่เช็ค canOperate เป็นด่านที่สอง · ขณะที่ปุ่ม 📷/🏷️/🔔 ถูก gate ด้วย canOperate (บรรทัด 274-286) และ ReadOnlyNote บรรทัด 249 ประกาศเองว่า role พวกนี้ 'เรียกภาชนะไม่ได้' · DR เป็น anon ไม่มี RLS จริง (CLAUDE.md กฎเหล็ก) → insert สำเร็จแน่ · ตรงกับกฎ UI-CONVENTIONS 'ค่าจาก URL ที่ต้องมีสิทธิ์ ต้อง guard ด้วย' ที่ไฟล์อื่นทำแล้ว (daily-report setup / lpa questions ฯลฯ) — ไม่พบ guard/commit ที่แก้
- **แนวแก้ที่เสนอ:** ใน useEffect deep-link: ถ้า `!canOperate` ให้ toast บอกว่าไม่มีสิทธิ์เรียกภาชนะ (ชี้ permKey rack_center:operate) แล้วล้าง param โดยไม่เปิดฟอร์ม + เพิ่ม guard ซ้ำใน handleRequest (`if (!canOperate) return toast.error(...)`) เป็นด่านที่สอง

### #40 🟡 advanceLot 'done' ตัดวัตถุดิบจาก state ที่โหลดแค่ 400 แถวล่าสุด — ล็อตเก่าปิดแล้ว raw ไม่ถูก consume เงียบ
- **ไฟล์:** `src/pages/HeijunkaKanban.jsx:1225` · **โดเมน:** Kanban ดึง + รอบส่ง + จัดซื้อ · **สถานะ:** ✅ แก้แล้ว (batch 2 · 2026-08-25)
- **scenario:** ล็อตที่ยังโชว์ในลิสต์ (lots limit 200) แต่ใบเบิกของมันหลุดพ้นหน้าต่าง 400 แถว → txns ฝั่ง consume = 0 แถว ขณะที่บรรทัด 1235 update raw_withdrawal_requests → issued ยิงตรง DB ครบทุกใบ → ใบเบิกขึ้น '✔ จ่ายแล้ว' แต่ ledger ไม่มีการหักวัตถุดิบเลย = สต็อก raw ค้างสูงเกินจริงถาวรโดยไม่มีสัญญาณ
- **หลักฐาน (verifier):** ยืนยัน asymmetry จริง: HeijunkaKanban.jsx:1225 แถว consume มาจาก `rawRequests.filter(r => r.lot_request_id === lot.id)` = state ที่ loadPull โหลดด้วย `.limit(400)` (บรรทัด 1185) ขณะที่บรรทัด 1235 `update raw_withdrawal_requests → issued` ยิงตรง DB ด้วย `.eq('lot_request_id', lot.id).eq('status','pending')` ครบทุกใบไม่ขึ้นกับ limit → ใบเบิกที่หลุดหน้าต่าง 400 แถวถูกมาร์ค issued โดยไม่มีแถว consume ใน ledger = ล้มเหลวเงียบตามที่ทีมแรกอธิบาย · lots limit 200 (บรรทัด 1184) — ล็อตท้ายลิสต์ที่ raw เฉลี่ย >2 ใบ/ล็อตจะหลุดจริง · **ข้อสังเกตเพิ่ม: เป็น latent วันนี้** — raw_withdrawal_requests มี ~3 แถว (CLAUDE.md 2026-08-19 'ใบเบิกวัตถุดิบ 3 ใบ') ยังห่างเพดาน 400 มาก แต่ trigger ออก raw หลายใบต่อล็อต (loop BOM ใน 20260821_explode_demand_lot_guard.sql) → โตทะลุได้เมื่อ adoption มา · sql_check ของทีมแรกครอบเรื่องนี้แล้ว จึงคงไว้
- **แนวแก้ที่เสนอ:** ตอนกดปิดล็อตให้ query ใบเบิกของล็อตนั้นสดจาก DB (`.eq('lot_request_id', lot.id).eq('status','pending')`) แทนการ filter จาก state — ได้ครบเสมอไม่ขึ้นกับ limit ของลิสต์แสดงผล
- **SQL เช็ค:**
```sql
-- DB = DR
select count(*) from raw_withdrawal_requests;  -- เกิน 400 เมื่อไหร่ = ความเสี่ยงเริ่มจริง
select count(*) from raw_withdrawal_requests r join child_lot_requests l on l.id = r.lot_request_id
 where l.status = 'done' and r.status = 'issued'
   and not exists (select 1 from line_stock_transactions t where t.type='consume' and t.mat_no = r.raw_mat_no and t.note like 'auto: ใช้ผลิต '||l.child_mat_no||'%');
```

### #41 🟡 ReceiveModal รับไม่ครบ: ช่องว่าง = รับ 0 · พิมพ์ค่าลบได้ · กดจาก 2 เครื่องซ้ำ = consume shortfall สองรอบ
- **ไฟล์:** `src/pages/HeijunkaKanban.jsx:1490` · **โดเมน:** Kanban ดึง + รอบส่ง + จัดซื้อ · **สถานะ:** ✅ แก้แล้ว (batch 2 · 2026-08-25)
- **scenario:** (1) คนลบตัวเลขทิ้งแล้วกดบันทึก ถูกตีความว่ารับ 0 ชิ้น หักสต็อกเต็มจำนวนเงียบ (2) พิมพ์ -5 → consume มากกว่าที่ issue ไว้ (3) 2 เครื่องเปิดโมดัล 'รับไม่ครบ' ค้างพร้อมกันแล้วต่างคนกดบันทึก → insert แถว consume shortfall ซ้ำ 2 ชุด (ขาด 10 → หักรวม 20)
- **หลักฐาน (verifier):** ยืนยันครบ 3 จุด: (1) บรรทัด 1961 onChange เก็บ `''` เมื่อลบตัวเลขทิ้ง → บรรทัด 1490 `actualQtyByMat[p.mat_no] ?? p.netTotal` — `''` ไม่ใช่ null/undefined จึงไม่ตกไป default → `shortfall = netTotal - '' = netTotal` (JS coerce '' เป็น 0) = ตีความว่ารับ 0 ชิ้น insert consume เต็มจำนวนเงียบ (2) input บรรทัด 1959 `min="0"` — attribute HTML ไม่กันพิมพ์/parseFloat ค่าลบ → shortfall = netTotal+5 consume เกินจริง (ไม่มี validate ใดๆ ใน submitReceive) (3) submitReceive บรรทัด 1507-1510 update kanban_deliveries `.match({...})` ไม่มีเงื่อนไข `received_status is null` และ **insert consume (บรรทัด 1501-1503) เกิดก่อน update** → 2 เครื่องเปิดโมดัลค้างแล้วต่างคนกด = shortRows ถูก insert 2 ชุดจริง · เทียบ confirmRound (บรรทัด 1449-1462) ที่ทำ atomic claim แล้ว = pattern แก้มีในไฟล์เดียวกัน
- **แนวแก้ที่เสนอ:** (1) validate: ค่าว่าง/ติดลบ/มากกว่า netTotal = บล็อกพร้อมข้อความ ก่อนคิด shortfall (2) update kanban_deliveries แบบมีเงื่อนไข `.is('received_status', null).select('id')` แล้ว insert consume เฉพาะเมื่อได้แถวกลับ (ย้าย insert ไปหลัง claim สำเร็จ — pattern เดียวกับ confirmRound)

### #42 🟡 advancePurchase 'received' ที่ dest_line ว่าง — toast ขึ้น 'รับเข้าสโตร์ +qty' แต่ไม่มีสต็อกถูกเติมเลย
- **ไฟล์:** `src/pages/HeijunkaKanban.jsx:1260` · **โดเมน:** Kanban ดึง + รอบส่ง + จัดซื้อ · **สถานะ:** ✅ แก้แล้ว (batch 2 · 2026-08-25)
- **scenario:** ใบที่ dest_line เป็น null (session ถูกลบ/rename ไลน์ก่อน cascade fix) ถูกกด '✅ รับเข้าสโตร์' → สถานะเดินไป received (dead-end แก้ย้อนไม่ได้) + toast เขียวปกติ แต่ยอดคลังไม่ขยับ — ขัดกฎ 'หักสต็อกไม่ได้ต้องรายงานเสมอ ห้ามขึ้นเขียวล้วน'
- **หลักฐาน (verifier):** โค้ดยืนยันตรงตามรายงาน: บรรทัด 1260 `if (next === 'received' && pr.dest_line)` — dest_line ว่าง = ข้าม insert line_stock_transactions ทั้งก้อน แล้วบรรทัด 1268 toast เขียว `✅ รับเข้าสโตร์ ${pr.mat_no} +${pr.qty}` เสมอ · สถานะเดินไป received แล้ว (update สำเร็จก่อนที่บรรทัด 1256) และ PURCHASE_STATUS.received ไม่มี next = dead-end จริง · ตรวจ schema: 20260710_purchase_requests.sql:23 `dest_line text` nullable และ trigger ล่าสุด (20260821_explode_demand_lot_guard.sql:36-37) เติมจาก `select ps.line_name into v_line from production_sessions where id = NEW.session_id` — session ถูกลบ (handleDeleteLine เป็น known gap ใน CLAUDE.md ที่ยังไม่ปิด) หรือ session_id หาไม่เจอ → v_line = null ได้จริง · ขัดกฎที่บันทึกแล้ว 'หักสต็อกไม่ได้ต้องรายงานเสมอ ห้ามขึ้นเขียวล้วน' — เป็น rule violation ระดับโค้ดไม่ว่าข้อมูลวันนี้จะมีแถว null หรือยัง (sql_check คงไว้เพื่อวัดขนาดผลกระทบ)
- **แนวแก้ที่เสนอ:** dest_line ว่าง → toast.error/confirm บอกชัดว่า 'รับสถานะแล้วแต่ไม่รู้ปลายทางสโตร์ — สต็อกไม่ถูกเติม ไปเติมมือที่ Line Stock' หรือบังคับเลือกไลน์ปลายทางก่อนกดรับ ห้ามเขียวเงียบ
- **SQL เช็ค:**
```sql
-- DB = DR
select status, count(*) from purchase_requests where dest_line is null group by status;
```

### #43 🔵 reorderLot กลืน error — supabase คืน {error} ไม่ throw, Promise.all จึงสำเร็จเสมอ
- **ไฟล์:** `src/pages/HeijunkaKanban.jsx:1284` · **โดเมน:** Kanban ดึง + รอบส่ง + จัดซื้อ · **สถานะ:** ✅ แก้แล้ว (batch 2 · 2026-08-25)
- **scenario:** update ตัวใดล้มเหลว (เช่น 42703 ตอน schema drift) → try/catch รอบนอกไม่จับ → คิวผลิตถูกเขียน seq ไม่ครบ (2 ล็อต seq ซ้ำกัน) แบบไม่มี toast ใดๆ
- **หลักฐาน (verifier):** บรรทัด 1284-1286 `await Promise.all(arr.map((l,k) => supabaseDR.from('child_lot_requests').update({seq_no:k+1}).eq('id', l.id)))` — ไม่ destructure/เช็ค error ของแต่ละ result · supabase-js คืน `{error}` ไม่ throw (กฎเหล็ก CLAUDE.md 2026-08-10) → try/catch บรรทัด 1283-1288 ไม่มีวันจับ partial failure ได้ · seq เขียนไม่ครบ = 2 ล็อต seq ซ้ำโดยไม่มี toast · เห็นด้วยกับ severity blue — DR anon allow_all + คอลัมน์ seq_no มีจริง ความน่าจะเป็นล้มเหลวรายแถวต่ำ แต่เป็น pattern ต้องห้ามที่บันทึกไว้แล้ว
- **แนวแก้ที่เสนอ:** เก็บผลลัพธ์แล้วเช็ค: `const rs = await Promise.all(...); const bad = rs.find(r => r.error); if (bad) throw bad.error;`

### #44 🔵 tripsFor: มอบหมายคนขับแล้วแต่รถทุกคันของเขาไม่ตั้งความจุ → บรรทัดเที่ยวหายทั้งแถบ แทนที่จะ fallback
- **ไฟล์:** `src/pages/HeijunkaKanban.jsx:1435` · **โดเมน:** Kanban ดึง + รอบส่ง + จัดซื้อ · **สถานะ:** ✅ แก้แล้ว (batch 2 · 2026-08-25)
- **scenario:** คนขับที่มีสกิลแค่ 'cart' ซึ่งยังไม่กรอกจุ (capacity_pkg null) ถูกมอบหมายรอบ → cand ว่าง → return null → การ์ดรอบนั้นไม่มีบรรทัด 'N กล่อง ÷ จุ = เที่ยว' เลย ขณะรอบข้างๆ ที่ยังไม่มอบหมายกลับโชว์ — ข้อมูลหายเงียบเฉพาะรอบที่จัดการแล้ว ชวนเข้าใจว่าระบบพัง
- **หลักฐาน (verifier):** บรรทัด 1434 `codes = carrier?.vehicles?.length ? carrier.vehicles : transport.vehicles.map(v => v.code)` — carrier ที่มี vehicles ล็อกลิสต์ไว้ที่รถของตัวเองเท่านั้น · บรรทัด 1435 กรอง `Number(v.capacity_pkg) > 0` → รถของ carrier ไม่มีตัวไหนตั้งจุ = cand ว่าง → บรรทัด 1436 return null → บรรทัด 524 (DeliveryRoundsPanel) `if (!tp) return null` = บรรทัดเที่ยวหายทั้งก้อนเฉพาะรอบที่มอบหมายแล้ว ขณะรอบที่ยังไม่มอบหมาย fallback ไปรถทุกคัน (คันจุมากสุด) แสดงปกติ — ยืนยันความไม่สมมาตรตามรายงาน · ส่วนที่ทีมแรกให้เครดิตถูก: Number(null)=0 ถูกกรองทิ้งเป็นพฤติกรรมที่ถูกต้อง (ไม่ตีเป็นจุ 0 กล่อง) และคณิต Math.ceil ถูก · comment ในโค้ดบรรทัด 1429 บอกแค่กรณี 'ยังไม่ตั้งความจุรถเลย = ไม่แสดง' ไม่ได้ครอบเจตนากรณี carrier บางคนไม่มีรถที่ตั้งจุ — ไม่นับเป็น documented behavior
- **แนวแก้ที่เสนอ:** เมื่อรถของ carrier ไม่มีตัวไหนมี capacity → fallback ไปรถจุมากสุดในระบบพร้อมหมายเหตุ '(รถของคนขับยังไม่ตั้งจุ — คิดจากคันจุมากสุด)' แทนการคืน null

## §SQL — needs_db (ให้ user รัน/อนุมัติ MCP)

### DB-1 🔵 backfill migration 20260811 (ยังไม่ apply) ล้าสมัย — guard ส่วนที่ 2 จะ abort ถ้าปัจจุบันมี mat หลายคลัง และตัวจัดสรรส่วนที่ 3 ใช้ pool ทุกคลัง (เขียนก่อนกฎ FG-only ตกผลึก)
- **ไฟล์:** `supabase/migrations/20260811_backfill_shipped_stock_consume.sql:45`
- **เหตุผล:** โค้ดตรงตามที่อ้าง: guard 45-54 raise exception เมื่อ mat ใดมีสต็อก >1 คลัง (fail-loud นี้ 'ตั้งใจ' — CLAUDE.md บันทึก 'หยุดทันทีถ้าเจอ MAT ที่มีสต็อกหลายคลัง' จึงไม่ใช่บั๊กในตัวเอง) · stk CTE 70-72 `min(line_name) + sum(qty_on_hand)` รวมทุกคลัง — เขียน 2026-08-11 ก่อนกฎ FG-only (2026-08-21) จึงขัดกับกฎปัจจุบันถ้าถูกปลด guard แล้วรัน · ส่วนคำอ้าง 'จะ raise แน่นอนกับข้อมูลปัจจุบัน' อิงเคส 20059949 (FG+STORE) จาก commit c232614 ซึ่งเป็นภาพ ณ 21/8 — สต็อก STORE อาจถูกจ่ายออก/ย้ายไปแล้ว ต้องข้อมูลจริงตัดสิน → needs_db · สาระที่เหลือ: migration ค้างไม่ apply = แถวเก็บตกไม่มีวันถูกลง ควร refresh ก่อนคิด apply
- **SQL เช็ค (DR):**
```sql
-- DR: guard ส่วนที่ 2 จะระเบิดไหมถ้ารันวันนี้
select mat_no, count(distinct line_name) n_lines from line_stock_summary where qty_on_hand > 0 group by mat_no having count(distinct line_name) > 1;
```

### DB-2 🟡 backflush ยังพลาดเมื่อกะ FG เปิดที่ 'ไลน์แม่' — นโยบายจ่ายเข้าไลน์ลูกแก้ทิศเดียว ทิศ 'เปิดกะผิดชั้น' ไม่มี guard
- **ไฟล์:** `supabase/migrations/20260821_explode_demand_lot_guard.sql:43`
- **เหตุผล:** ฝั่งโค้ดยืนยันได้: trigger หักด้วย `line_stock_summary where line_name = v_line` (20260821:43-44 — v_line = ไลน์ของกะที่เปิด) · CLAUDE.md บันทึกว่าทางแก้ที่ user เคาะ (ก) คือ 'Store จ่ายเข้าไลน์ลูก + เตือนสีส้มที่ฟอร์มจ่าย ไม่บล็อก' — **ไม่มี guard ใดกันการเปิดกะบนไลน์แม่** (ตรวจแล้วคำเตือนอยู่ฝั่งฟอร์มจ่ายพาร์ทเท่านั้น) → ทิศ mirror นี้ไม่ได้ถูกบันทึกว่าตั้งใจหรือแก้แล้ว · แต่ความเสียหายจริงขึ้นกับข้อมูล: ต้องมีกะไลน์แม่ที่ยัง confirmed FG ที่มี BOM หลังนโยบาย 2026-08-21 — หลักฐาน 33 กะของ TEEP audit เป็นหน้าต่าง 91 วันย้อนหลัง (ส่วนใหญ่ก่อนนโยบาย) จึงตัดสินจากโค้ดอย่างเดียวไม่ได้ ต้องให้ sql_check ชี้ขาด
- **SQL เช็ค (DR):**
```sql
-- DB=DR · ใบ confirmed หลัง 21/08 ที่ปิดใต้กะไลน์แม่
select ps.line_name, count(*) confirmed_orders from prod_orders o join production_sessions ps on ps.id=o.session_id where o.status='confirmed' and ps.work_date >= '2026-08-21' and ps.line_name in ('HYDROFORM','GOR','LWR BAR','LINE APRON ASSY') group by 1;
```

### DB-3 🟡 state ปลายทาง/จำนวนของแผงย้ายมินิสโตร์ key ด้วย mat_no อย่างเดียว — mat เดียวค้าง 2 ไลน์แม่แชร์ state ปนกัน
- **ไฟล์:** `src/components/StockMoveToChild.jsx:36`
- **เหตุผล:** โค้ดยืนยันตามที่รายงาน: line 36 `pick` keyed mat_no ล้วน · move อ่าน pick[r.mat_no] (lines 72-73) · แถวตาราง key `${r.line_name}|${r.mat_no}` (line 125) · sel/onChange ใช้ r.mat_no (lines 123, 132, 140-141) → mat เดียวกันที่ค้าง ≥2 ไลน์แม่แชร์ {to, qty} ก้อนเดียวจริง · ข้อโต้แย้งที่ทีมแรกรับไว้ถูกแล้ว: insert 2 แถว atomic + นับแถว (lines 84-90) ผ่าน — และมี confirm dialog line 77 ที่โชว์คู่ `${r.line_name} → ${to}` จริงเป็นด่านสุดท้าย (แสดงคู่ที่จะเขียนจริง ไม่ใช่คู่ผี — ลดความรุนแรงลงบ้างแต่ user มักกด confirm ตามความเคยชิน และช่อง qty บนจอ (line 140) โชว์ค่าแชร์ของอีกแถวซึ่งชวนเข้าใจว่าถูก) · **เงื่อนไขเกิด: mat เดียวกันต้องมีแถวสต็อก >0 ที่ไลน์แม่ ≥2 ตัวพร้อมกัน** (rows filter childrenOf[s.line_name] line 59) — ข้อมูลที่ CLAUDE.md บันทึกตอนทำฟีเจอร์มีไลน์แม่เดียว (LINE APRON ASSY 31 mat) จึงอาจยังไม่มีเคสจริงวันนี้ → ต้องข้อมูลตัดสิน แต่โค้ดเป็น latent bug แน่นอนและ fix ไม่มีความเสี่ยง
- **SQL เช็ค (DR):**
```sql
-- DR: mat เดียวกันค้าง >0 มากกว่า 1 ไลน์แม่ (เทียบรายชื่อไลน์ที่มีลูกจาก production_lines ฝั่ง Main)
select mat_no, array_agg(line_name order by line_name) locs from line_stock_summary
where abs(qty_on_hand) > 0 group by mat_no having count(distinct line_name) > 1;
```

---

## 🔁 รอบเสริม D1 — โดเมนขาเข้า (Sales/EDI → forecast → แผนผลิต) · agent แยก 2026-08-25

> โดเมนแรกของ workflow ล้มด้วย StructuredOutput cap → รันใหม่เป็น agent แยก (ตรวจโต้แย้งกับโค้ดปัจจุบัน
> หลัง commit 20-24/8 แล้ว — ข้อที่ session ขนานแก้ไปแล้ว เช่น ship-to disambiguation ไม่รายงานซ้ำ)
> ได้ 12 ข้อ (แดง 2 · เหลือง 8 · ฟ้า 2) — **แก้ครบทั้ง 12 ใน batch 3 (2026-08-25)**

| # | สี | ไฟล์ | เรื่อง | สถานะ |
|---|---|---|---|---|
| D1-1 | 🔴 | `ProductionPlan.jsx` | แผนรายวันตัดออเดอร์ค้างส่งที่เลยดิวทิ้ง — backlog เริ่ม 0 เสมอ ("กะเช้าพอ" ปลอม) | ✅ โหลด pending ย้อน 30 วัน seed เป็น backlog วันแรก + ชิป "⏰ ยกมาจากค้างส่งเก่า N ชิ้น" |
| D1-2 | 🔴 | `PlannerSales.jsx` | import เดา mat เมื่อ p_no กำกวม + kanban_standards ไม่กรอง is_active + std ชนะ prods (เสีย customer) | ✅ ship-to disambiguation มีอยู่แล้ว (session ขนาน) · เติม is_active + สลับ prods มาก่อน (entry มี customer ชนะ slot) |
| D1-3 | 🟡 | `PlannerSales.jsx` | ลบ 862 ไม่มีขอบบน — ไฟล์ horizon สั้นลบ pending อนาคตทิ้งถาวร | ✅ เติม `.lte('due_date', edi.dateTo)` (semantics เดียวกับ path 830) |
| D1-4 | 🟡 | `PlannerSales.jsx` | doApply เขียน kanban_standards ไม่เช็ค error — พังเงียบใต้ toast เขียว | ✅ destructure error + นับแถว + ระบุ mat ที่พลาด |
| D1-5 | 🟡 | `PlannerSales.jsx` | 🗑 ลบ batch cascade ลบใบ shipped/ประวัติวันเก่า — ประตูหลังของกฎห้ามลบประวัติ | ✅ detach ใบประวัติ (batch_id=null) ก่อนลบ + confirm บอกจำนวน |
| D1-6 | 🟡 | `DemandVsProduction.jsx` | forecast ไม่ dedup ต่อ source + ก้อน manual รายเดือนถูกอัด 7 วัน → "ของจะขาด" ปลอม | ✅ `dedupeForecastRows` + เกลี่ยตาม grain (edi=7วัน · manual=วันจริงของเดือน) ใน `demandSupply.js` + เทส |
| D1-7 | 🟡 | `PlannerSales.jsx` (PlannerTab) | แท็บ Forecast Planner บวกทุก source — เลขไม่ตรงกับแท็บ 🎴 ข้างๆ | ✅ ใช้ `dedupeForecastRows` ตัวเดียวกัน (KanbanCalcTab ก็ย้ายมาใช้ helper กลาง) |
| D1-8 | 🟡 | `ProductionPlan.jsx` | แท็บรายเดือนไม่ dedup source (T2-2 ค้าง) — shiftsNeeded เฟ้อ 2 เท่า | ✅ select source + dedupe ตอนโหลด |
| D1-9 | 🟡 | `PlannerSales.jsx` (PlannerTab) | โหลด forecast/orders ไม่แบ่งหน้า — horizon 12 เดือนทะลุ 1000 แถว | ✅ fetchAllPages ทั้งคู่ |
| D1-10 | 🟡 | `PlannerSales.jsx` | คิวรี OEE 90 วัน ("CAP จริง ~") ไม่แบ่งหน้า — กะปิดแล้วทะลุ 1000 | ✅ fetchAllPages |
| D1-11 | 🟡 | `PlannerSales.jsx` | base-part fallback ตอน import จับคู่ข้าม revision เงียบๆ (เคส EC เข้าเลขเก่า) | ✅ ติดธง `baseMatched` + แถบ 💡 ในพรีวิว EDI ให้คนตรวจก่อนยืนยัน (ระบบเสนอ คนตรวจ) |
| D1-12 | 🔵 | `PlannerSales.jsx` | dedupe ในไฟล์ 862 ไม่มี PO ใน key — 2 release ต่าง PO slot เดียวกันเหลือใบเดียว | ✅ เติม `|po` ใน key ชั้นในไฟล์ (key เทียบ DB คงเดิม) |

**SQL เช็คขนาดผลกระทบ (DR — optional ให้ user รันดูได้):**
```sql
-- D1-1: ออเดอร์ค้างส่งที่เลยดิว (ก้อนที่เดิมหายจากแผน)
select count(*) n, coalesce(sum(qty),0) pcs from customer_shipping_orders
  where status <> 'shipped' and due_date < (now() at time zone 'Asia/Bangkok')::date;
-- D1-6/7/8: mat×เดือนที่มี forecast 2 source ชนกัน (ก้อนที่เคยถูกนับซ้ำ)
select mat_no, to_char(period_month,'YYYY-MM') m, count(distinct source)
  from customer_forecasts group by 1,2 having count(distinct source) > 1;
```
