import { useContext, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import useTabParam from '../utils/useTabParam';
import useIsMobile from '../utils/useIsMobile';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { scopedLineNames } from '../utils/sectionScope';
import { canAccessPage, hasPermission } from '../utils/permissions';
import PageHeader from '../components/PageHeader';
import Page from '../components/Page';
import ObeyaKpiBoard from '../components/ObeyaKpiBoard';
import ObeyaSqdcmBoard from '../components/ObeyaSqdcmBoard';

const KpiMonthly = lazy(() => import('../components/KpiMonthly'));
const DeptDashboard = lazy(() => import('./DeptDashboard'));

/* ══ 🏛️ OBEYA — ห้องบัญชาการโรงงาน (หน้าเดียว 3 แท็บ) ═══════════════════════════════
   2026-09-15 — รวมงาน 2 session ที่ทำ `/obeya` คนละมุมโดยไม่รู้ว่าอีกฝั่งทำอยู่
   2026-09-17 — ย้าย 📑 KPI รายเดือน เข้ามาเป็นแท็บที่ 3 (คำสั่ง user: "สองหน้าซ้ำซ้อนกัน")

     แท็บ 📋 บอร์ด KPI ส่วนงาน (default)  = ยุบ "กระดาษ OBEYA KPI monitoring" ที่แปะผนังเข้ามา
        รายเดือน × กลุ่มไลน์ (คอลัมน์) × 8 หัวข้อ (แถว) — **จอสำหรับดู**
        → docs/modules/obeya-kpi-board.md
     แท็บ 🖥️ จอ SQDCM                    = บอร์ดจอ TV "กระดาษ A4 สิบแผ่นปูเต็มจอ"
        สัปดาห์/เดือน/ปี × 5 แกน SQDCM เป็นกราฟ + ACTION BOARD ปิดลูป → docs/modules/obeya.md
     แท็บ ⚙️ ตั้งค่า KPI / กรอกผล (ท้ายสุด) = ตาราง 12 เดือน + ตั้งนิยาม KPI + ทะเบียนชื่อ + Excel/PDF
        ตามฟอร์ม FM-HRM-6-022/024/025 — **โต๊ะสำหรับกรอกและตั้งค่า** (ข้อมูลชุดเดียวกับแท็บแรก)
     ⭐ 23/09: แท็บ 📋 กับ 🖥️ วาดจาก `ObeyaSheet.jsx` ชิ้นเดียวกัน (คำสั่ง user "ควรจะรูปแบบเดียวกัน")
     แท็บ 📌 งานค้างของส่วนงาน (23/09 · user: "งานค้างส่วนงาน ควรย้ายเป็น tab ใน หมวด OBEYA ไปเลย")
        = หน้า `/dept-dashboard` เดิม embed ทั้งดุ้น (pattern เดียวกับ /equipment · ไม่แก้ของเดิม) — คิวงานวันนี้
        ที่กดไปทำได้ (ผลิต/ซ่อมบำรุง/สโตร์/QA ด้วย `?dept=`) · route เดิม redirect มา `?tab=todo` พา ?dept= มาด้วย
        · สิทธิ์ piggyback `page:/dept-dashboard` (แท็บโผล่ตามสิทธิ์เดิม · เข้า /obeya ได้ถ้ามีสิทธิ์แท็บใดแท็บหนึ่ง)
     ⭐ 23/09: ทุกแท็บเลือกขอบเขตด้วย `<OrgScopePicker>` (ผังองค์กรทุกมิติ) — ห้ามกลับไปทำ select ส่วนงานเอง

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
  /* ลำดับแท็บ (user 23/09): จอดู 2 ใบไว้หน้า · "ตั้งค่า/กรอก" ไว้ท้ายสุด — คนเปิดหน้านี้ส่วนใหญ่มาดู ไม่ได้มากรอก */
  const isMobile = useIsMobile();
  const { role, lineId, sections } = useContext(UserContext);
  const [lines, setLines] = useState([]);
  /* แท็บโผล่ตามสิทธิ์: บอร์ด/ตั้งค่า = `page:/obeya` · 📌 งานค้าง = `page:/dept-dashboard` (คีย์เดิม ไม่ seed ใหม่)
     ⚠️ ถ้าอ่านสิทธิ์ไม่ได้ทั้งคู่ (cache ยังไม่มา / harness ที่ไม่โหลด role_permissions) = โชว์ครบ —
     RoleRoute กั้นหน้าทั้งหน้าไว้แล้ว การซ่อนแท็บตรงนี้เป็นแค่ความสะดวก ห้ามทำให้จอเหลือแท็บว่าง (crashsweep จะเดินไม่ถึงแท็บอื่น) */
  const boardsOk = hasPermission('page:/obeya', role);
  const todoOk = canAccessPage('/dept-dashboard', role);
  const canBoards = boardsOk || !todoOk;
  const canTodo = todoOk || !boardsOk;

  const tabs = useMemo(() => ([
    canBoards && { key: 'kpi', label: '📋 บอร์ด KPI ส่วนงาน (รายเดือน)' },
    canBoards && { key: 'sqdcm', label: '🖥️ จอ SQDCM (สัปดาห์/เดือน/ปี)' },
    canTodo && { key: 'todo', label: '📌 งานค้างของส่วนงาน (วันนี้)' },
    canBoards && { key: 'table', label: '⚙️ ตั้งค่า KPI / กรอกผล' },
  ].filter(Boolean)), [canBoards, canTodo]);
  const [tab, setTab] = useTabParam(tabs.map(t => t.key), tabs[0]?.key || 'kpi');

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

  /* UI-STANDARD 2026-09-24: ทุกแท็บอยู่ใน <Page> กรอบเดียวกัน — เดิมแต่ละแท็บมีรากของตัวเอง
     (kpi/sqdcm ชิด sidebar x=0 · todo/table x=24) ⇒ หัวเพจกระโดดตอนสลับแท็บ
     โหมดจอ TV ของบอร์ดเป็น position:fixed เต็มจอ — ไม่ถูกกรอบนี้บีบ */
  const loadingNote = <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14, padding: 24 }}>กำลังโหลด...</div>;
  let body;
  if (tab === 'sqdcm') body = <ObeyaSqdcmBoard tabs={tabs} tab={tab} onTab={setTab} />;
  else if (tab === 'todo') {
    body = (
      <Suspense fallback={loadingNote}>
        <DeptDashboard embedded tabs={tabs} tab={tab} onTab={setTab} />
      </Suspense>
    );
  } else if (tab === 'table') {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <PageHeader
          tabs={tabs} tab={tab} onTab={setTab}
          title="OBEYA — ตั้งค่า KPI / กรอกผล" icon="⚙️"
          sub="ตั้งนิยาม KPI · กรอกผลราย 12 เดือน · ออกฟอร์ม FM-HRM-6-022/024/025 — ข้อมูลชุดเดียวกับแท็บ 📋 บอร์ด"
        />
        <Suspense fallback={loadingNote}>
          <KpiMonthly lines={lines} scopeSet={scopeSet} isMobile={isMobile} />
        </Suspense>
      </div>
    );
  } else body = <ObeyaKpiBoard tabs={tabs} tab={tab} onTab={setTab} />;
  return <Page>{body}</Page>;
}
