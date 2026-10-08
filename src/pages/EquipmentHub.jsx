import { useContext, useState, useEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import { UserContext } from '../App';
import { supabaseDR } from '../supabaseClient';
import { can, canAccessPage } from '../utils/permissions';
import useTabParam from '../utils/useTabParam';
import PageHeader from '../components/PageHeader';
import Page, { Hub } from '../components/Page';
import fetchAllRows from '../utils/fetchAllRows';
import { toast } from '../components/Toast';
import { teamsForUser } from '../utils/mtnTeams';
import SparePartMaster from '../components/SparePartMaster';
import RackMap from '../components/RackMap';

/* ══ 🧰 ศูนย์ทะเบียนอุปกรณ์ — รวม "ของที่ช่างดูแล" ไว้ที่เดียว ══════════════  2026-09-22

   ที่มา (คำสั่ง user): *"ลองเช็คฟังก์ชันของช่างที เหมือนไปกระจายอยู่หลายหน้า"*
   audit แล้วพบว่าทะเบียนของช่าง **กระจายอยู่ 3 หมวดเมนู คนละ pattern กัน**:
     · เครื่องจักร  → `/machine-database`  (หมวด ตั้งค่าโปรแกรม)
     · แม่พิมพ์     → `/die-registry`      (หมวด ตั้งค่าโปรแกรม)
     · JIG/Fixture → `/fixture`            (หมวด ซ่อมบำรุง)   ← ของช่างเหมือนกันแต่คนละหมวด
     · อะไหล่+ผังคลัง → แท็บใน `/mtn-repair` (หน้าทำงาน ไม่ใช่หน้าทะเบียน)
   ⇒ ยุบเป็นหน้าเดียว 5 แท็บ · route เดิมทั้งหมด redirect เข้ามา (ลิงก์/บุ๊กมาร์กเก่าไม่ตาย)

   ⚠️ pattern เดียวกับ `PmHub` / `DailyChecker` เป๊ะ — **embed หน้าเดิมทั้งดุ้น ไม่แก้ของเดิม**
      (แก้ของเดิมเมื่อไหร่ = ต้องตามแก้ 2 ทางแล้ว drift)

   ⚠️ **แท็บซ้อนแท็บต้องคนละ param** (UI-CONVENTIONS §6.8) — หน้าแม่ใช้ `?tab=`
      ⇒ หน้าลูกที่เคยใช้ `?tab=` ถูกเปลี่ยนเป็น param ของตัวเอง:
        `DieRegistry` → `?die=` (registry|layout|status)
        `FixtureRegistry` → `?fx=` (points|shim|status|classify)
      **หน้าลูกที่จะเพิ่มทีหลัง ห้ามใช้ `?tab=`**

   ⚠️ สิทธิ์: piggyback หน้าเดิมทั้งหมด — ไม่ต้อง seed `page:/equipment`
      (ดู canAccessPage ใน permissions.js) · แท็บโผล่ตามสิทธิ์ย่อยของแต่ละหน้า
      ⇒ คนที่เข้า `/machine-database` ไม่ได้อยู่แล้ว ก็ยังไม่เห็นแท็บเครื่องจักรเหมือนเดิม

   เพิ่มทะเบียนใหม่ = เพิ่ม entry ใน TABS + route redirect ใน App.jsx + special-case ใน permissions.js
   ═════════════════════════════════════════════════════════════════════════════════════════ */

const MachineDatabase = lazy(() => import('./MachineDatabase'));
const DieRegistry     = lazy(() => import('./DieRegistry'));
const FixtureRegistry = lazy(() => import('./FixtureRegistry'));

/* เรียงตาม "ของที่เปิดดูบ่อย" — ช่างค้นอะไหล่/เครื่องทุกวัน ส่วนผังคลังนานๆ ครั้ง
   (หลักเดียวกับ PmHub: ความถี่ที่ใช้จริง ไม่ใช่ลำดับตามตัวอักษร) */
const TABS = [
  { key: 'machine', label: '🏭 เครื่องจักร', page: '/machine-database',
    hint: 'ทะเบียนเครื่อง + ชนิดอุปกรณ์ (equipment_kind) ที่เป็นตัวแยกกลุ่มให้ทุกจอในระบบ' },
  { key: 'die',     label: '🔨 แม่พิมพ์ (DIE)', page: '/die-registry',
    hint: 'ทะเบียน + ผังจัดเก็บ + สถานะแม่พิมพ์' },
  { key: 'jig',     label: '📐 JIG / Fixture', page: '/fixture',
    hint: 'ทะเบียนจุดชิม + บันทึกชิม + สถานะ + จัดชนิดอุปกรณ์' },
  { key: 'spare',   label: '🔩 คลังอะไหล่', page: '/mtn-repair',
    hint: 'ค้นอะไหล่/ชั้นวาง · ยอดคงเหลือ · Rank A/B/C' },
  { key: 'rack',    label: '🗺️ ผังคลังอะไหล่', page: '/mtn-repair',
    hint: 'วางช่องอะไหล่บนรูปชั้นวางจริง — กดช่องแล้วรู้ว่ามีอะไรอยู่' },
];

/* อะไหล่ + ผังคลัง เดิมเป็นแท็บใน `/mtn-repair` ซึ่งโหลด `mtn_spare_parts` ไว้ให้อยู่แล้ว
   ย้ายมาที่นี่ = ต้องโหลดเอง · โหลดเฉพาะตอนเปิดแท็บที่ใช้จริง (ไม่ยิงคิวรีให้คนที่มาดูเครื่องจักร) */
function SparePanel({ view }) {
  const { role, sections: scopeSecs, section: mySection, mtnTeams: userMtnTeams, fullName } = useContext(UserContext);
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const userTeams = useMemo(() => teamsForUser(userMtnTeams, scopeSecs), [userMtnTeams, scopeSecs]);

  /* 🔴 `fetchAllRows` คืน `{ data, error }` ไม่ใช่อาร์เรย์ — destructure เสมอ + อ่าน error
     (supabase-js ไม่ throw · กฎเหล็ก DB ข้อ 1) */
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await fetchAllRows(supabaseDR, 'mtn_spare_parts', '*', q => q.eq('is_active', true).order('sort_order').order('id'));
    if (error) toast.error('โหลดทะเบียนอะไหล่ไม่สำเร็จ: ' + (error.message || error));
    setParts(data || []);
    setLoading(false);
  }, []);
  // stale-response guard — สลับแท็บไปมาแล้วคำตอบเก่ากลับมาทีหลัง ต้องไม่เขียนทับ (กฎเหล็กข้อ 4)
  useEffect(() => { let alive = true; load().then(() => { if (!alive) return; }); return () => { alive = false; }; }, [load]);

  if (loading) return <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>⏳ กำลังโหลดทะเบียนอะไหล่…</div>;
  return view === 'rack'
    ? <RackMap parts={parts} canEdit={can('mtn_repair', 'manage_master', role)} myTeams={userTeams} mySection={mySection} />
    : <SparePartMaster parts={parts} reload={load} fullName={fullName} role={role} myTeams={userTeams} mySection={mySection} />;
}

export default function EquipmentHub() {
  const { role } = useContext(UserContext);

  // แท็บโผล่ตามสิทธิ์หน้าเดิมของแต่ละตัว — URL ที่ชี้แท็บซึ่งไม่มีสิทธิ์ = ตกกลับแท็บแรกที่เข้าได้ (ห้ามจอว่าง)
  const available = TABS.filter(t => canAccessPage(t.page, role));
  const [active, setActive] = useTabParam(available.map(t => t.key), available[0]?.key);
  const cur = available.find(t => t.key === active);

  return (
    <Page>
        {/* หัว + แท็บ มาตรฐาน (UI §6.8) — เดิมวาดเอง ทำให้ 3 แท็บหน้าตาคนละแบบ (ภาพ user 22/09) */}
        <PageHeader title="ทะเบียนอุปกรณ์ (ของที่ช่างดูแล)" icon="🧰"
          sub={cur?.hint || 'เครื่องจักร · แม่พิมพ์ · JIG/Fixture · อะไหล่ — รวมไว้ที่เดียว'}
          tabs={available.map(t => ({ key: t.key, label: t.label }))} tab={active} onTab={setActive} />
        {/* ไม่มีสิทธิ์สักแท็บ = ต้องบอกว่าทำไม ห้ามปล่อยจอว่าง (UI-CONVENTIONS §6.9) */}
        {!available.length && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13, border: '1px dashed var(--border2)', borderRadius: 10 }}>
            🔒 บัญชีนี้ยังไม่มีสิทธิ์เข้าทะเบียนอุปกรณ์ตัวไหนเลย — ให้ admin เปิดสิทธิ์หน้า
            <b style={{ color: 'var(--text2)' }}> ฐานข้อมูลเครื่องจักร / ทะเบียนแม่พิมพ์ / Fixture / แจ้งซ่อม MTN </b>
            ที่ <b style={{ color: 'var(--text2)' }}>/permissions</b>
          </div>
        )}
      <Hub>
      <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด…</div>}>
        {active === 'machine' && <MachineDatabase />}
        {active === 'die' && <DieRegistry />}
        {active === 'jig' && <FixtureRegistry />}
        {(active === 'spare' || active === 'rack') && (
          <SparePanel view={active} />
        )}
      </Suspense>
      </Hub>
    </Page>
  );
}
