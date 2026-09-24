import { useContext, useEffect } from 'react';
import { UserContext } from '../App';
import { loadProcessTypes } from '../utils/processTypes';
import ProcessTypeSetup from '../components/ProcessTypeSetup';
import PageHeader from '../components/PageHeader';
import Page from '../components/Page';

/* ── /process-setup — จุดจัดการ master กระบวนการผลิต ในหมวดตั้งค่าโปรแกรม,ฐานข้อมูล ──────
   ใช้ component เดียวกับแท็บ 🏭 กระบวนการ ใน Daily Report ⚙️ (ไม่ duplicate logic)
   process_type เป็น master กลาง — แก้ที่ไหนก็มีผลทั้งระบบ (เครื่อง/สินค้า/ประเภท DT)
*/
export default function ProcessSetup() {
  const { role } = useContext(UserContext);
  useEffect(() => { loadProcessTypes(); }, []);
  return (
    <Page width="form">
      <PageHeader title="กระบวนการผลิต (Process Types)" icon="🏭" />
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 18px' }}>
        master กลาง — เพิ่ม/แก้กระบวนการ (เช่น Laser, Bending) แล้วทุกจุดที่ tag เครื่องจักร (ฐานข้อมูลเครื่องจักร) ·
        สินค้า (Product Master) · ประเภท Downtime/งานเสีย ใช้ตามทันที · แก้ได้ที่นี่หรือใน Daily Report ⚙️ ก็ได้ (ที่เดียวกัน)
      </p>
      <ProcessTypeSetup role={role} />
    </Page>
  );
}
