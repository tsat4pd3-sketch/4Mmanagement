import { useContext, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import useTabParam from '../utils/useTabParam';
import useIsMobile from '../utils/useIsMobile';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { scopedLineNames } from '../utils/sectionScope';
import PageHeader from '../components/PageHeader';
import ObeyaKpiBoard from '../components/ObeyaKpiBoard';
import ObeyaSqdcmBoard from '../components/ObeyaSqdcmBoard';

const KpiMonthly = lazy(() => import('../components/KpiMonthly'));

/* ══ 🏛️ OBEYA — ห้องบัญชาการโรงงาน (หน้าเดียว 3 แท็บ) ═══════════════════════════════
   2026-09-15 — รวมงาน 2 session ที่ทำ `/obeya` คนละมุมโดยไม่รู้ว่าอีกฝั่งทำอยู่
   2026-09-17 — ย้าย 📑 KPI รายเดือน เข้ามาเป็นแท็บที่ 3 (คำสั่ง user: "สองหน้าซ้ำซ้อนกัน")

     แท็บ 📋 บอร์ด KPI ส่วนงาน (default)  = ยุบ "กระดาษ OBEYA KPI monitoring" ที่แปะผนังเข้ามา
        รายเดือน × กลุ่มไลน์ (คอลัมน์) × 8 หัวข้อ (แถว) — **จอสำหรับดู**
        → docs/modules/obeya-kpi-board.md
     แท็บ 📑 KPI รายเดือน / ตั้งเป้า      = ตาราง 12 เดือน + ตั้งนิยาม KPI + ทะเบียนชื่อ + Excel/PDF
        ตามฟอร์ม FM-HRM-6-022/024/025 — **โต๊ะสำหรับกรอกและตั้งค่า** (ข้อมูลชุดเดียวกับแท็บแรก)
     แท็บ 🖥️ จอมอนิเตอร์ SQDCM           = บอร์ดจอ TV "กระดาษ A4 สิบแผ่นปูเต็มจอ"
        รายวัน/สัปดาห์/เดือน × 5 แกน SQDCM เป็นกราฟ + ACTION BOARD ปิดลูป
        → docs/modules/obeya.md

   ═══ 🔴 ทำไม 📑 KPI รายเดือน ต้องอยู่ที่นี่ ไม่ใช่ `/dept-dashboard` (17/09) ══════════
   เดิมมันเป็นแท็บใน `/dept-dashboard` → user ทักว่าซ้ำกับแท็บ 📋 ของหน้านี้ **และถูก**
   `/dept-dashboard` ตัดด้วย `?dept=` = **หน้าที่/ฝ่าย** (ผลิต·ซ่อมบำรุง·สโตร์·QA)
   แต่ตาราง KPI รายเดือนตัดด้วย **ส่วนงาน (PD1..PD4) × กลุ่มไลน์ × ปี** = แกนของ Obeya เป๊ะ
   — คอมเมนต์ใน DeptDashboard เองก็เขียนว่า *"KPI รายเดือนมี section picker ของตัวเอง
   จึงไม่ต้องมีแถวนี้"* คือยอมรับอยู่กลายๆ ว่าแท็บนั้นไม่ได้ใช้แกนของหน้าที่มันสิงอยู่
   ⇒ **ตาราง (ตั้งค่า/กรอก) กับ บอร์ด (ดู) เป็นของคู่กัน ต้องอยู่หน้าเดียวกัน**
   `/dept-dashboard?view=kpi` ยัง redirect มาที่นี่ให้อัตโนมัติ (ห้ามตัดทางเข้าเดิมของใคร)

   **ห้ามยุบ 📋 กับ 🖥️ เข้าด้วยกัน** — คนละหน่วยเวลา (เดือน vs วัน) คนละแกนตัด
   คนละเจ้าของตัวเลข · แต่ 📋 กับ 📑 **คือข้อมูลชุดเดียวกัน** (`kpi_definitions` +
   `kpi_manual_entries` + `kpi_catalog`) แค่คนละมุมมอง — ห้ามแยกคลังเด็ดขาด
   ════════════════════════════════════════════════════════════════════════════════ */

export default function Obeya() {
  const [tab, setTab] = useTabParam(['kpi', 'table', 'sqdcm'], 'kpi');
  const isMobile = useIsMobile();
  const { role, lineId, sections } = useContext(UserContext);
  const [lines, setLines] = useState([]);

  const tabs = useMemo(() => ([
    { key: 'kpi', label: '📋 บอร์ด KPI ส่วนงาน' },
    { key: 'table', label: '📑 KPI รายเดือน / ตั้งเป้า' },
    { key: 'sqdcm', label: '🖥️ จอมอนิเตอร์ SQDCM' },
  ]), []);

  /* โหลดไลน์เฉพาะตอนเปิดแท็บตาราง — แท็บอื่นโหลดของตัวเองอยู่แล้ว ไม่ยิงซ้ำ */
  useEffect(() => {
    if (tab !== 'table' || lines.length) return;
    let alive = true;
    supabase.from('production_lines').select('id, name, section, parent_line_name')
      .then(({ data }) => { if (alive) setLines(data || []); });
    return () => { alive = false; };
  }, [tab, lines.length]);

  const scopeSet = useMemo(() => {
    const names = scopedLineNames({ role, lineId, sections, lines });
    return names ? new Set(names) : null;
  }, [lines, role, lineId, sections]);

  if (tab === 'sqdcm') return <ObeyaSqdcmBoard tabs={tabs} tab={tab} onTab={setTab} />;
  if (tab === 'table') {
    return (
      <div style={{ maxWidth: 'min(97vw, 1800px)', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <PageHeader
          tabs={tabs} tab={tab} onTab={setTab}
          title="OBEYA — KPI รายเดือน / ตั้งเป้า" icon="📑"
          sub="ตั้งนิยาม KPI · กรอกผลราย 12 เดือน · ออกฟอร์ม FM-HRM-6-022/024/025 — ข้อมูลชุดเดียวกับแท็บ 📋 บอร์ด"
        />
        <Suspense fallback={<div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14, padding: 24 }}>กำลังโหลด...</div>}>
          <KpiMonthly lines={lines} scopeSet={scopeSet} isMobile={isMobile} />
        </Suspense>
      </div>
    );
  }
  return <ObeyaKpiBoard tabs={tabs} tab={tab} onTab={setTab} />;
}
