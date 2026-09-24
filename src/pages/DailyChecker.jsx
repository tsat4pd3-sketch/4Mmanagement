import { useContext, Suspense, lazy } from 'react';
import { UserContext } from '../App';
import { canAccessPage } from '../utils/permissions';
import useTabParam from '../utils/useTabParam';
import PageHeader from '../components/PageHeader';
import Page, { Hub } from '../components/Page';

/* ── Daily Checker — ศูนย์รวมระบบเช็ครายวันของไลน์ผลิต (2026-07-23) ──────────────────
   ขมวด Daily PM + LPA (+ ระบบเช็คอื่นที่จะเพิ่ม) เป็นหน้าเดียว แยกด้วยแท็บ
   - แต่ละแท็บ = component หน้าเดิม (embed ทั้งดุ้น ไม่แก้ของเดิม) แสดงตามสิทธิ์หน้านั้นๆ
   - เพิ่มระบบเช็คใหม่ = เพิ่ม entry ใน TABS (component + page permission เดิมของมัน)
   - สิทธิ์เข้าหน้า: piggyback บน page:/daily-pm / page:/lpa (ดู canAccessPage ใน permissions.js)
     → ไม่ต้อง seed permission ใหม่ · แท็บโผล่ตามสิทธิ์ย่อยแต่ละหน้า
*/

const DailyPM           = lazy(() => import('./DailyPM'));
const LayerProcessAudit = lazy(() => import('./LayerProcessAudit'));
const PokaYokeCheck     = lazy(() => import('./PokaYokeCheck'));
const BbsCheck          = lazy(() => import('./BbsCheck'));

// เพิ่มระบบเช็คใหม่ตรงนี้ (key/label/หน้าเดิมที่คุมสิทธิ์/component)
const TABS = [
  { key: 'pm',       label: '🔧 Autonomous Maintenance (AM)', page: '/daily-pm', Comp: DailyPM },
  { key: 'pokayoke', label: '🛡️ Poka-Yoke Check',            page: '/pokayoke', Comp: PokaYokeCheck },
  { key: 'lpa',      label: '📋 Layer Process Audit (LPA)',   page: '/lpa',      Comp: LayerProcessAudit },
  { key: 'bbs',      label: '🦺 สังเกตพฤติกรรมความปลอดภัย (BBS)', page: '/bbs',  Comp: BbsCheck },
];

export default function DailyChecker() {
  const { role } = useContext(UserContext);

  // แท็บโผล่ตามสิทธิ์ย่อยของแต่ละระบบเช็ค — ลิสต์ที่ส่งให้ useTabParam จึงเป็นเฉพาะที่เข้าได้
  // (URL ที่ชี้แท็บซึ่งไม่มีสิทธิ์ = ตกกลับแท็บแรกที่เข้าได้ ไม่ใช่จอว่าง)
  const available = TABS.filter(t => canAccessPage(t.page, role));
  const [active, setActive] = useTabParam(available.map(t => t.key), available[0]?.key);
  const Cur = available.find(t => t.key === active)?.Comp;

  return (
    <Page>
      {/* หัว + แท็บ — ใช้ PageHeader มาตรฐาน (UI §6.8) ห้ามวาดหัว/แถบแท็บเอง
          หน้าลูกครอบด้วย <Hub> ⇒ ไม่วาดชื่อหน้าซ้ำ · <Page> ของหน้าลูกไม่เพิ่มขอบซ้ำ (UI-STANDARD §1) */}
        <PageHeader title="Daily Checker" icon="🗂️"
          sub="ศูนย์รวมระบบตรวจเช็ครายวันของไลน์ผลิต — เลือกแท็บด้านล่าง"
          tabs={available.map(t => ({ key: t.key, label: t.label }))} tab={active} onTab={setActive} />

      {/* เนื้อหาแท็บ (component หน้าเดิม) */}
      {Cur ? (
        <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด...</div>}>
          <Hub><Cur /></Hub>
        </Suspense>
      ) : (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>ยังไม่มีสิทธิ์เข้าระบบเช็คใดในหน้านี้</div>
      )}
    </Page>
  );
}
