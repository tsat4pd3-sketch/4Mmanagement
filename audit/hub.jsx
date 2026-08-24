/* audit/hub.html — เรนเดอร์หน้า Home (DeptHub) ด้วยเบราว์เซอร์จริง เพื่อวัด layout/นับการ์ด-ชิป
 *
 * ทำไมต้องมีแยกจาก audit/main.jsx: main.jsx mount หน้าเพจแบบ `<C/>` **ไม่ส่ง props**
 * แต่ DeptHub อ่าน `userRole` จาก props (ไม่ใช่ UserContext) → canAccessPage fail-closed
 * → การ์ด/ชิปว่างหมด วัดอะไรไม่ได้เลย
 *
 * ⚠️ harness ไม่มีตาราง role_permissions (mockSupabase ไม่ได้จำลอง) → เมนูโผล่ครบเฉพาะ
 *    role=admin (โค้ด bypass ให้ admin เสมอ) · role อื่นจะเห็นว่าง ไม่ใช่บั๊กของหน้า
 *
 * ใช้: npx vite --config audit/vite.audit.mjs → http://localhost:5199/audit/hub.html[?role=admin]
 */
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { UserContext } from '../src/App';
import DeptHub from '../src/pages/DeptHub';
import '../src/index.css';

const role = new URLSearchParams(location.search).get('role') || 'admin';
const CTX = {
  role, lineId: 1, team: 'A', section: 'PD1', sections: [], fullName: 'ทดสอบ ระบบ',
  position: 'operator', mtnTeams: [], isDeptAdmin: false, realRole: role,
};

createRoot(document.getElementById('root')).render(
  <MemoryRouter>
    <UserContext.Provider value={CTX}>
      <DeptHub userRole={role} realRole={role} userFullName="ทดสอบ ระบบ" userEmail="a@b.c"
        userPosition="operator" theme="dark" onToggleTheme={() => {}} onLogout={() => {}}
        onOpenSearch={() => { window.__palette = (window.__palette || 0) + 1; }}
        onToggleRemote={() => {}} />
    </UserContext.Provider>
  </MemoryRouter>,
);
