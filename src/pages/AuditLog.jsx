import { useState } from 'react';
import PageHeader from '../components/PageHeader';
import useTabParam from '../utils/useTabParam';
import AuditLogViewer from '../components/AuditLogViewer';
import { supabase, supabaseDR } from '../supabaseClient';

/* ── 📜 ประวัติการแก้ไขข้อมูล (Audit Log) — ทั้งระบบ (2026-08-19 · user ทักว่าอยู่ผิดที่) ──
   เดิมจอดู audit ตัวเดียวถูกฝังใน /mtn-repair → ⚙️ ข้อมูลตั้งต้น → 📜 ประวัติการแก้ไข
   ซึ่งกรองไว้แค่ 9 ตารางของทีมช่าง ทั้งที่ระบบมี audit trigger ~74 ตารางรวม 2 project
   → ของสำคัญอย่าง `role_permissions` (ใครแก้สิทธิ์) · `profiles` · `employees` · `machines`
     · `dr_products` **ไม่มีหน้าไหนดูได้เลย** ทั้งที่บันทึกไว้ครบ

   หน้านี้จึงเป็น "จอกลาง" ของประวัติทั้งระบบ อยู่ในหมวดตั้งค่าโปรแกรม,ฐานข้อมูล
   แท็บใน /mtn-repair ยังอยู่เหมือนเดิม (ดูในบริบทงานช่างสะดวกกว่า) แต่ใช้ component เดียวกัน

   ⚠️ audit_log แยกคนละชุดต่อ project — เลือกฝั่งด้วยแท็บ ไม่ใช่ query รวม
      (คนละ database เชื่อมกันไม่ได้ · ดูกฎ "Supabase Projects" ใน CLAUDE.md)
   ⚠️ retention 6 เดือน (cron `purge-audit-log` ทั้ง 2 project · migration 20260819_audit_log_retention.sql)
      เก่ากว่านั้นถูกลบอัตโนมัติ — ต้องเก็บยาวกว่านี้ให้ export ออกก่อน                        */

const SRC = {
  main: { label: '🗄️ ระบบหลัก', client: supabase,
    desc: 'สิทธิ์/ผู้ใช้ · พนักงาน & ทักษะ · ผังองค์กร & ไลน์ · ทะเบียนเอกสาร · แจ้งเตือน · เอกสาร PE' },
  dr:   { label: '🏭 ข้อมูลผลิต', client: supabaseDR,
    desc: 'สินค้า & คัมบัง · เครื่องจักร & แม่พิมพ์ · แผน PM · ข้อมูลตั้งต้นงานซ่อม · ประเภท Downtime/ของเสีย' },
};

export default function AuditLog() {
  const [tab, setTab] = useTabParam(Object.keys(SRC), 'main');
  const [reload, setReload] = useState(0);
  const src = SRC[tab] || SRC.main;

  return (
    <div style={{ padding: '18px 20px 40px', maxWidth: 1180, margin: '0 auto' }}>
      <PageHeader
        tabs={Object.entries(SRC).map(([k, v]) => ({ key: k, label: v.label }))}
        tab={tab} onTab={(k) => { setTab(k); setReload(x => x + 1); }}
      />

      <AuditLogViewer
        key={tab}
        client={src.client}
        reloadKey={reload}
        intro={<>
          📜 <b>ใครแก้อะไร เมื่อไหร่ ค่าเก่า→ค่าใหม่</b> — ระบบบันทึกอัตโนมัติทุกครั้งที่มีการเพิ่ม/แก้/ลบ<b>ข้อมูลตั้งต้น (master)</b>
          <br /><span style={{ opacity: 0.85 }}>ขอบเขตฝั่งนี้: {src.desc}</span>
          <br /><span style={{ opacity: 0.85 }}>
            ⚠️ เก็บย้อนหลัง <b>6 เดือน</b> (ลบอัตโนมัติทุกวัน) · ไม่ครอบข้อมูลรายวัน เช่น ใบผลิต/เช็คชื่อ/Downtime
            — พวกนั้นมีประวัติในหน้าของตัวเอง
          </span>
        </>}
      />
    </div>
  );
}
