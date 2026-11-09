/* 📝 ตัวโหลดฟอร์มแจ้งซ่อมเต็มสำหรับ "เปิดใบซ่อมจาก Downtime" (08/11 · คำสั่ง user)
   ตัวฟอร์มจริง = `MoReportFromDowntime` → `ReportModal` ใน `pages/MtnRepair.jsx` (ฟอร์มเดียวกับหน้าแจ้งซ่อม)
   โหลดแบบ lazy ตอนกดเท่านั้น — หน้า Daily Report ไม่ต้องแบกโค้ดหน้าแจ้งซ่อมทั้งหน้า
   ⚠️ ไฟล์นี้ไม่ใช่ hub ที่ฝังหน้าลูก (ไม่วาดหัวเพจ/แท็บของ MtnRepair) — ดึงมาแค่ modal ตัวเดียว */
import { lazy, Suspense } from 'react';

const Inner = lazy(() => import('../pages/MtnRepair').then(m => ({ default: m.MoReportFromDowntime })));

export default function MoReportFromDowntime(props) {
  return <Suspense fallback={null}><Inner {...props} /></Suspense>;
}
