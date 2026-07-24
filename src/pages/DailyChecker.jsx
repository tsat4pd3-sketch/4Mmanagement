import { useContext, Suspense, lazy } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserContext } from '../App';
import { canAccessPage } from '../utils/permissions';

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

// เพิ่มระบบเช็คใหม่ตรงนี้ (key/label/หน้าเดิมที่คุมสิทธิ์/component)
const TABS = [
  { key: 'pm',       label: '🔧 Autonomous Maintenance (AM)', page: '/daily-pm', Comp: DailyPM },
  { key: 'pokayoke', label: '🛡️ Poka-Yoke Check',            page: '/pokayoke', Comp: PokaYokeCheck },
  { key: 'lpa',      label: '📋 Layer Process Audit (LPA)',   page: '/lpa',      Comp: LayerProcessAudit },
];

export default function DailyChecker() {
  const { role } = useContext(UserContext);
  const [sp, setSp] = useSearchParams();

  const available = TABS.filter(t => canAccessPage(t.page, role));
  const wanted = sp.get('tab');
  const active = available.find(t => t.key === wanted)?.key || available[0]?.key;
  const setActive = (k) => { const n = new URLSearchParams(sp); n.set('tab', k); setSp(n, { replace: true }); };
  const Cur = available.find(t => t.key === active)?.Comp;

  return (
    <div>
      {/* หัว + แท็บ (สลับระบบเช็ค) */}
      <div style={{ padding: 'clamp(10px,2.5vw,18px) clamp(12px,3vw,24px) 0', maxWidth: 'min(98vw, 2400px)', margin: '0 auto' }}>
        <h2 style={{ margin: '0 0 2px', fontFamily: 'var(--font-display)', fontSize: 'clamp(15px,2.6vw,20px)', color: 'var(--text)' }}>🗂️ Daily Checker</h2>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--muted)' }}>ศูนย์รวมระบบตรวจเช็ครายวันของไลน์ผลิต — เลือกแท็บด้านล่าง</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
          {available.map(t => {
            const on = active === t.key;
            return (
              <button key={t.key} onClick={() => setActive(t.key)} style={{
                padding: '9px 18px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border2)'}`,
                background: on ? 'var(--accent-dim)' : 'var(--bg3)', color: on ? 'var(--accent)' : 'var(--text2)',
              }}>{t.label}</button>
            );
          })}
        </div>
      </div>

      {/* เนื้อหาแท็บ (component หน้าเดิม) */}
      {Cur ? (
        <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด...</div>}>
          <Cur />
        </Suspense>
      ) : (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>ยังไม่มีสิทธิ์เข้าระบบเช็คใดในหน้านี้</div>
      )}
    </div>
  );
}
