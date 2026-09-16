import { useMemo } from 'react';
import useTabParam from '../utils/useTabParam';
import ObeyaKpiBoard from '../components/ObeyaKpiBoard';
import ObeyaSqdcmBoard from '../components/ObeyaSqdcmBoard';

/* ══ 🏛️ OBEYA — ห้องบัญชาการโรงงาน (หน้าเดียว 2 แท็บ) ═══════════════════════════════
   2026-09-15 — รวมงาน 2 session ที่ทำ `/obeya` คนละมุมโดยไม่รู้ว่าอีกฝั่งทำอยู่
   (branch `claude/obeya-kpi-dashboard-85xbgm` กับ `claude/oee-report-ppt-export-tjojy0`)
   ทั้งคู่มาจากคำสั่ง user คนละครั้ง และ **ไม่ทับกัน** — ต่างมิติกันชัดเจน:

     แท็บ 📋 บอร์ด KPI ส่วนงาน (default)  = ยุบ "กระดาษ OBEYA KPI monitoring" ที่แปะผนังเข้ามา
        รายเดือน × กลุ่มไลน์ (คอลัมน์) × 8 หัวข้อ (แถว) ตามบอร์ดจริงที่ user ถ่ายรูปมา
        → docs/modules/obeya-kpi-board.md

     แท็บ 🖥️ จอมอนิเตอร์ SQDCM           = บอร์ดจอ TV "กระดาษ A4 สิบแผ่นปูเต็มจอ"
        รายวัน/สัปดาห์/เดือน × 5 แกน SQDCM เป็นกราฟ + ACTION BOARD ปิดลูป
        → docs/modules/obeya.md

   **ห้ามยุบสองแท็บเข้าด้วยกัน** — คนละหน่วยเวลา (เดือน vs วัน) คนละแกนตัด (กลุ่มไลน์ vs แกน SQDCM)
   คนละเจ้าของตัวเลข (บัญชี/ลูกค้ากรอกมือ vs ระบบคำนวณสด) · ยุบรวม = ได้จอที่ไม่ตรงกระดาษ
   และไม่ตรงหน้างานพร้อมกันทั้งคู่
   ════════════════════════════════════════════════════════════════════════════════ */

export default function Obeya() {
  const [tab, setTab] = useTabParam(['kpi', 'sqdcm'], 'kpi');
  const tabs = useMemo(() => ([
    { key: 'kpi', label: '📋 บอร์ด KPI ส่วนงาน' },
    { key: 'sqdcm', label: '🖥️ จอมอนิเตอร์ SQDCM' },
  ]), []);

  return tab === 'sqdcm'
    ? <ObeyaSqdcmBoard tabs={tabs} tab={tab} onTab={setTab} />
    : <ObeyaKpiBoard tabs={tabs} tab={tab} onTab={setTab} />;
}
