/* ══ 🧭 ไม่พบหน้านี้ — route ที่ไม่รู้จัก           2026-10-02 ══════════════════════
   **ที่มา (เคสจริง):** user กดลิงก์ `/program-update` ที่เพิ่ง deploy แล้วแจ้งว่า "หน้าล่ม"
   — ของจริงคือเบราว์เซอร์ยังถือบันเดิลเก่าที่ยังไม่มี route นี้ แล้ว `<Routes>` **ไม่มี
   catch-all** ⇒ วาด "ไม่มีอะไรเลย" = จอเปล่า ไม่มีข้อความบอกว่าเกิดอะไรขึ้น

   🔴 กฎที่ยึด (ENGINEERING-PRINCIPLES "ห้ามล้มเหลวเงียบ"):
      ที่อยู่ที่ระบบไม่รู้จัก **ต้องเขียนบนจอว่าไม่พบ + บอกทางออก** ห้ามปล่อยจอว่าง
      (จอว่างกับระบบพังหน้าตาเหมือนกันสำหรับคนหน้างาน)
   ⚠️ นี่ไม่ใช่หน้า "ไม่มีสิทธิ์" — `RoleRoute` เด้งไปหน้าหลักเมื่อไม่มีสิทธิ์ (ดู App.jsx)
   ⚠️ ไม่อยู่ใน `NAV_ITEMS` โดยตั้งใจ (ไม่ใช่เมนู) · **import ตรงไม่ใช่ lazy** —
      บันเดิลเก่า/เน็ตมีปัญหาคือสถานการณ์ที่หน้านี้ต้องทำงาน จะไปพึ่ง chunk ใหม่ไม่ได้
   ═══════════════════════════════════════════════════════════════════════════════ */
import { Link, useLocation } from 'react-router-dom';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';

export default function NotFound() {
  const { pathname, search } = useLocation();
  const btn = {
    padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
    border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)',
    textDecoration: 'none', display: 'inline-block',
  };
  return (
    <Page width="form">
      {/* `breadcrumb={false}` — ที่อยู่นี้ไม่อยู่ใน NAV_ITEMS จึงไม่มีหมวดให้ไต่ (จะได้ breadcrumb ว่าง) */}
      <PageHeader
        icon="🧭" title="ไม่พบหน้านี้" breadcrumb={false}
        sub={`ที่อยู่ที่เปิด: ${pathname}${search}`}
      />

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderLeft: '4px solid var(--accent2)',
                    borderRadius: 10, padding: '12px 16px', fontSize: 13, lineHeight: 1.8, color: 'var(--text2)' }}>
        <b>สาเหตุที่เจอบ่อย — ไล่ตามลำดับ</b>
        <div>1. <b>ระบบเพิ่งอัพเดท</b> แล้วแท็บนี้ยังถือรุ่นเก่าอยู่ ⇒ กด <b>โหลดใหม่</b> ด้านล่าง</div>
        <div>2. ลิงก์เก่า/บุ๊กมาร์กของหน้าที่ถูกย้ายหรือยุบเป็นแท็บของหน้าอื่น</div>
        <div>3. พิมพ์ที่อยู่ผิด</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
          โหลดใหม่แล้วยังไม่พบ = หน้านั้นไม่มีในระบบ (ถ้าควรมี แจ้งผ่านปุ่ม 💬 แจ้งปัญหา ท้ายเมนู)
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <button type="button" style={{ ...btn, background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none' }}
          onClick={() => window.location.reload()}>🔄 โหลดใหม่</button>
        <Link to="/" style={btn}>🏠 กลับหน้าหลัก</Link>
      </div>
    </Page>
  );
}
