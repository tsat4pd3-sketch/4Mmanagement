import { useContext, Suspense, lazy } from 'react';
import { UserContext } from '../App';
import { canAccessPage } from '../utils/permissions';
import useTabParam from '../utils/useTabParam';
import PageHeader from '../components/PageHeader';

/* ── 🔧 ศูนย์ PM — รวม 5 หน้างานซ่อมบำรุงตามแผนเป็นหน้าเดียว (2026-08-26) ──────────────
   ที่มา (feedback หน้างาน): *"หน้าที่เกี่ยวกับ PM 3 หน้า มันควรจะรวมเป็นหน้าเดียวหรือไม่
   เพื่อไม่ต้องกดกลับไปกลับมา เพราะเหมือนจะเป็น workflow ที่ทำงานด้วยกันอยู่แล้ว"*
   → ใช่ — จริงๆ มี **5 หน้า** (ตรวจ / แผน / ล่วงหน้า / ประสานงาน / ตั้งค่า) ที่เป็นสายงานเดียวกัน
     ตั้งจุดตรวจ → ระบบคำนวณวันครบกำหนด → ดูล่วงหน้าเพื่อกันของ/จัด shutdown
     → นัด Production → ช่างลงมือตรวจ → ผลตรวจเลื่อนรอบถัดไปเอง (วนกลับข้อ 2)

   ⚠️ pattern เดียวกับ `DailyChecker` เป๊ะ — **embed component หน้าเดิมทั้งดุ้น ไม่แก้ของเดิม**
      (แก้ของเดิมเมื่อไหร่ = ต้องตามแก้ 2 ทาง แล้ว drift · หลักเดียวกับ `DEPTS` ใน DeptDashboard)

   ⚠️ แท็บซ้อนแท็บต้องคนละ param (UI-CONVENTIONS §6.8):
      หน้าแม่ใช้ `?tab=` · หน้าลูกทั้ง 5 ใช้ `?dept=` / `?line=` / `?equip=` อยู่แล้ว → ไม่ชนกัน
      **หน้าลูกที่จะเพิ่มทีหลัง ห้ามใช้ `?tab=`**

   ⚠️ สิทธิ์: piggyback สิทธิ์หน้าเดิมทั้ง 5 — ไม่ต้อง seed `page:/pm`
      (ดู canAccessPage ใน permissions.js) · แท็บโผล่ตามสิทธิ์ย่อยของแต่ละหน้า
      → `/pm-setup` ที่เป็น admin/mgr/sv เท่านั้น ยังคงซ่อนจากช่างเหมือนเดิม

   เพิ่มหน้างาน PM ใหม่ = เพิ่ม entry ใน TABS + route redirect ใน App.jsx + special-case ใน permissions.js
*/

const PMCheckData   = lazy(() => import('./PMCheckData'));
const PMSchedule    = lazy(() => import('./PMSchedule'));
const PmForecast    = lazy(() => import('./PmForecast'));
const PmCoordination = lazy(() => import('./PmCoordination'));
const PMSetup       = lazy(() => import('./PMSetup'));
const MaintenanceLevels = lazy(() => import('./MaintenanceLevels'));

/* เรียงตาม "ความถี่ที่ใช้จริง" ไม่ใช่ลำดับ workflow —
   ช่างเปิดจอมาเพื่อ *ตรวจ* ทุกวัน ส่วน *ตั้งค่า* นานๆ ครั้ง (หลักเดียวกับ DailyChecker) */
const TABS = [
  { key: 'check',    label: '✅ ตรวจอุปกรณ์',        page: '/pm-check',        Comp: PMCheckData,
    hint: 'บันทึกผลตรวจตามจุดที่ตั้งไว้ — ตรวจครบแล้วรอบถัดไปเลื่อนให้เอง' },
  { key: 'plan',     label: '📅 แผน PM',              page: '/pm-schedule',     Comp: PMSchedule,
    hint: 'ปฏิทิน/ไทม์ไลน์ว่าเครื่องไหนครบกำหนดวันไหน + ผลตรวจจริงของวันนั้น' },
  { key: 'forecast', label: '🔮 ล่วงหน้า (Planner)',  page: '/pm-forecast',     Comp: PmForecast,
    hint: 'คาดวันที่จะต้อง PM + buffer ที่ต้องผลิตเผื่อก่อนเครื่องหยุด' },
  /* 3 ระดับ Preventive → Predictive → Prescriptive (2026-09-23) — อ่านอย่างเดียว
     piggyback สิทธิ์ page:/pm-forecast (ทุก role เข้าได้อยู่แล้ว) ⇒ ไม่ต้อง seed สิทธิ์ใหม่ · ไม่มี route แยก */
  { key: 'levels',   label: '🧭 3 ระดับ PM',   page: '/pm-forecast', Comp: MaintenanceLevels,
    hint: 'แผนบอกว่าถึงเวลาไหม → ข้อมูลเสียจริงบอกว่าแย่ลงไหม → ระบบแนะนำว่าควรทำอะไร ภายในเมื่อไหร่ เพราะอะไร' },
  { key: 'coord',    label: '🗓️ ประสานงาน',           page: '/pm-coordination', Comp: PmCoordination,
    hint: 'งาน PM ที่กินหลายวัน — นัด Production ล่วงหน้า + ช่วง Production Support' },
  { key: 'setup',    label: '⚙️ ตั้งค่าจุดตรวจ',      page: '/pm-setup',        Comp: PMSetup,
    hint: 'ลงทะเบียนอุปกรณ์ + จุดที่ต้องตรวจ + รอบเวลา/ยอดผลิต' },
];

export default function PmHub() {
  const { role } = useContext(UserContext);

  // แท็บโผล่ตามสิทธิ์หน้าเดิมของแต่ละตัว — URL ที่ชี้แท็บซึ่งไม่มีสิทธิ์ = ตกกลับแท็บแรกที่เข้าได้ (ห้ามจอว่าง)
  const available = TABS.filter(t => canAccessPage(t.page, role));
  const [active, setActive] = useTabParam(available.map(t => t.key), available[0]?.key);
  const cur = available.find(t => t.key === active);

  return (
    <div>
      <div style={{ padding: 'clamp(10px,2.5vw,18px) clamp(12px,3vw,24px) 0', maxWidth: 'min(98vw, 2400px)', margin: '0 auto' }}>
        {/* หัว + แท็บ มาตรฐาน (UI §6.8) · sub = คำอธิบายแท็บที่เลือก
            — 5 แท็บชื่อคล้ายกัน ไม่มีคำอธิบายคนใหม่แยกไม่ออกว่าจะเข้าอันไหน */}
        <PageHeader title="ซ่อมบำรุงตามแผน (PM)" icon="🔧"
          sub={cur?.hint || 'ตั้งจุดตรวจ → ครบกำหนด → เตรียมล่วงหน้า → นัดผลิต → ตรวจจริง → เลื่อนรอบถัดไปเอง'}
          tabs={available.map(t => ({ key: t.key, label: t.label }))} tab={active} onTab={setActive} />
      </div>

      {cur ? (
        <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด...</div>}>
          <cur.Comp />
        </Suspense>
      ) : (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>ยังไม่มีสิทธิ์เข้าหน้างาน PM ใดในหน้านี้</div>
      )}
    </div>
  );
}
