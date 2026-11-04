/* 🔀 แยก "จอดูสัญญาณ" กับ "จอทำรายการ" ของสโตร์ (2026-11-04 · คำสั่ง user)
   user: *"หน้าตู้ heijunka ยอดงานจะต้องไม่วิ่งผ่านหน้านี้ หน้านี้เป็นแค่ monitor เรื่องสัญญาณ KANBAN"* ·
   *"ย้ายไป line-stock · จัดซื้อแยกแท็บ"*
   · `/heijunka` (HeijunkaKanban mode='monitor') = ดูอย่างเดียว
   · `/line-stock?tab=store` = ตู้งานสโตร์ (ขากับไลน์ผลิต) · `/line-stock?tab=purchase` = จัดซื้อ (ขา supplier → รับเข้าสโตร์)
   ไฟล์นี้แยกจาก HeijunkaKanban เพื่อให้ LineStock lazy-load หน้านั้นได้โดยไม่ดึงทั้งก้อนมาตั้งแต่แรก */
export const OPS_STORES_WORK = ['wip', 'fg', 'child', 'raw', 'plating', 'rack'];
export const OPS_STORES_BUY = ['purchase'];
