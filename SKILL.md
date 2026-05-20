# SKILL.md — React + Vite + Supabase Project Playbook

ใช้ไฟล์นี้เป็น reference เวลาเริ่มโปรเจคใหม่ที่มี stack และ pattern เดียวกัน
ส่งให้ Claude อ่านก่อนเริ่มงาน จะทำงานได้ตรง convention ทันที

---

## Stack

| ส่วน | เทคโนโลยี |
|------|----------|
| Frontend | React 19 + Vite |
| Database | Supabase (PostgreSQL) |
| Routing | React Router DOM v7 |
| Charts | Recharts |
| Animation | Framer Motion |
| Deploy | Render.com (Static Site) |

```json
{
  "@supabase/supabase-js": "^2.105.4",
  "framer-motion": "^12.38.0",
  "react": "^19.2.6",
  "react-dom": "^19.2.6",
  "react-router-dom": "^7.15.0",
  "recharts": "^3.8.1"
}
```

---

## Environment Variables

```
VITE_SUPABASE_URL=https://<project-id>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

---

## Project Structure

```
src/
  supabaseClient.js     ← singleton client
  App.jsx               ← routing + auth + UserContext provider
  index.css             ← CSS variables + global classes
  pages/                ← one file per route
  components/
    Toast.jsx           ← global toast system
```

---

## Supabase Client

```js
// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

---

## Auth & UserContext

### Context shape
```js
// App.jsx
export const UserContext = createContext({ role: 'admin', lineId: null, team: null, section: null });
```

### Provider
```jsx
<UserContext.Provider value={{ role, lineId: userLineId, team: userTeam, section: userSection }}>
  {children}
</UserContext.Provider>
```

### Profile fetch (after login)
```js
const fetchProfile = async (user) => {
  const { data } = await supabase
    .from('profiles')
    .select('role, line_id, full_name, team, section')
    .eq('id', user.id)
    .single();
  setUserRole(data?.role ?? 'admin');
  setUserLineId(data?.line_id ?? null);
  setUserTeam(data?.team ?? null);
  setUserSection(data?.section ?? null);
};
```

### Consume in page
```js
const { role, lineId: userLineId, team: userTeam } = useContext(UserContext);
```

---

## Role System

### ทุก role ที่ใช้
```js
const ROLE_LABELS = {
  admin:      '👑 Admin',
  manager:    '🏢 Manager',
  supervisor: '🎯 Supervisor',
  leader:     '⭐ Leader',
  qa:         '🔍 QA',
};
```

### Route guard
```jsx
function RoleRoute({ children, allow, userRole }) {
  if (!allow.includes(userRole ?? 'admin')) return <Navigate to="/" replace />;
  return children;
}

// usage
<Route path="/linesetup" element={
  <RoleRoute allow={['admin', 'manager', 'supervisor']} userRole={role}>
    <LineSetup />
  </RoleRoute>
} />
```

### Inline role check
```js
const canEdit   = ['admin', 'manager'].includes(role);
const canApprove = (log) => {
  if (['admin', 'manager'].includes(role)) return true;
  if (role === 'qa')         return log.requires_qa !== false;
  if (role === 'supervisor') return log.requires_qa === false;
  return false;
};
```

### Leader scoping (filter by team/line)
```js
const isLeader  = role === 'leader';
const poolItems = items.filter(w => {
  if (isLeader && userTeam) return w.team === userTeam;
  return true;
});
```

---

## Navigation

```js
const NAV_ITEMS = [
  { to: '/',      icon: '📊', label: 'Dashboard',    roles: null },
  { to: '/page1', icon: '🔄', label: 'หน้า 1',       roles: null },
  { to: '/admin', icon: '⚙️', label: 'ตั้งค่า',       roles: ['admin', 'manager'] },
];
// roles: null = ทุกคนเห็น, roles: [...] = เฉพาะ role ที่ระบุ
```

---

## Supabase Query Patterns

### SELECT + nested join
```js
const { data } = await supabase
  .from('daily_production_logs')
  .select('id, assigned_line, employee_id, employees(id, name, team, employee_skills(skill_name, score))')
  .eq('work_date', today)
  .eq('is_present', true);
```

### Dynamic filter (conditional)
```js
let q = supabase.from('production_lines').select('id, name').order('name');
if (isLeader && userLineId) q = q.eq('id', userLineId);
const { data } = await q;
```

### INSERT
```js
await supabase.from('four_m_logs').insert([{
  work_date: today,
  category: 'Man',
  description: desc,
  requires_qa: true,
}]);
```

### UPDATE
```js
await supabase.from('daily_production_logs')
  .update({ assigned_line: stationId })
  .eq('id', logId);
```

### UPSERT (conflict on composite key)
```js
await supabase.from('employee_skills').upsert(
  { employee_id: empId, skill_name: 'welding', score: 80 },
  { onConflict: 'employee_id,skill_name' }
);
```

### DELETE
```js
await supabase.from('operator_special_tasks')
  .delete()
  .eq('employee_id', empId)
  .eq('work_date', today);
```

### history lookup (limit 1)
```js
const { data: history } = await supabase.from('daily_production_logs')
  .select('id')
  .eq('employee_id', empId)
  .lt('work_date', today)
  .limit(1);
if (!history?.length) { /* first time */ }
```

---

## DB Migration Pattern

ใช้ Supabase MCP tool `apply_migration`:
```sql
-- naming: snake_case, descriptive
-- name: add_requires_qa_to_four_m_logs

ALTER TABLE four_m_logs ADD COLUMN IF NOT EXISTS requires_qa boolean DEFAULT true;
ALTER TABLE four_m_logs ADD COLUMN IF NOT EXISTS change_subtype text;
```

```sql
-- ตาราง + RLS boilerplate
CREATE TABLE IF NOT EXISTS operator_special_tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  task_type    text NOT NULL,
  work_date    date NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (employee_id, work_date)
);

ALTER TABLE operator_special_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read"   ON operator_special_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated insert" ON operator_special_tasks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated delete" ON operator_special_tasks FOR DELETE TO authenticated USING (true);
```

---

## Edge Function Pattern

```ts
// supabase/functions/<name>/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // verify caller
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(
      req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    )
    if (error || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const body = await req.json()
    // ... logic ...

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
```

---

## Toast System

```js
// src/components/Toast.jsx
let _dispatch = null;
export const toast = {
  success: (msg) => _dispatch?.({ type: 'success', msg }),
  error:   (msg) => _dispatch?.({ type: 'error',   msg }),
  info:    (msg) => _dispatch?.({ type: 'info',     msg }),
};
```

```js
// usage ในทุก page
import { toast } from '../components/Toast';

toast.success('บันทึกสำเร็จ');
toast.error('เกิดข้อผิดพลาด: ' + error.message);
toast.info('กำลังโหลด...');
```

---

## Modal / Overlay

```jsx
{showModal && (
  <div className="overlay">
    <div className="modal" style={{ width: 'min(420px, 94vw)' }}>
      <h3 style={{ marginTop: 0, color: 'var(--accent)' }}>ชื่อ Modal</h3>
      {/* content */}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button onClick={handleSave} style={{ flex: 2, padding: 12, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700 }}>
          บันทึก
        </button>
        <button onClick={() => setShowModal(null)} style={{ flex: 1, padding: 12, background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 8 }}>
          ยกเลิก
        </button>
      </div>
    </div>
  </div>
)}
```

CSS classes ที่มีในระบบ:
- `.overlay` — fixed backdrop blur, z-index 2000
- `.modal` — bg3, border2, radius-lg, shadow-lg, padding 32px

---

## CSS Variables

```css
/* Dark (default) */
--bg:      #050505;
--bg2:     #0a0a0a;
--bg3:     #111111;
--card:    #0d0d0d;
--border:  #1e1e1e;
--border2: #2a2a2a;
--accent:  #e31937;      /* brand red */
--text:    #ffffff;
--text2:   #a8a8a8;
--muted:   #555555;
--green:   #22c55e;
--amber:   #f59e0b;
--red:     #e74c3c;
--blue:    #4d9fff;

--font-body:    'Sarabun', sans-serif;   /* ภาษาไทย */
--font-display: 'Inter', sans-serif;

--radius:    10px;
--radius-lg: 15px;
--shadow-sm: 0 2px 8px rgba(0,0,0,0.4);
--shadow-md: 0 4px 20px rgba(0,0,0,0.6);
--shadow-lg: 0 10px 40px rgba(0,0,0,0.8);
```

Light mode: `document.documentElement.setAttribute('data-theme', 'light')`
```css
[data-theme="light"] {
  --bg: #f2f2f2; --bg2: #e8e8e8; --bg3: #dcdcdc;
  --card: #ffffff; --border: #dedede; --border2: #c8c8c8;
  --text: #111111; --text2: #505050; --muted: #909090;
}
```

---

## State Naming Convention

```js
// data arrays        → plural noun
const [workers,     setWorkers]     = useState([]);
const [lines,       setLines]       = useState([]);
const [skillDefs,   setSkillDefs]   = useState([]);

// selected / active → selected* หรือ active*
const [selectedLine,   setSelectedLine]   = useState('');
const [selectedWorker, setSelectedWorker] = useState(null);

// modal / popup → show* (null = ปิด, value = ข้อมูล)
const [showModal,    setShowModal]    = useState(null);
const [stationModal, setStationModal] = useState(null);

// loading / saving → is*
const [isSaving, setIsSaving] = useState(false);
const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

// map / lookup → *Map
const [approverMap,    setApproverMap]    = useState({});
const [homePositions,  setHomePositions]  = useState({});
```

---

## Score / Status Color Pattern

```js
// score → color
const scoreColor = (score) => {
  if (score >= 80) return '#22c55e';   // ชำนาญ
  if (score >= 60) return '#84cc16';   // ผ่านเกณฑ์
  if (score >= 40) return '#f59e0b';   // กำลังพัฒนา
  return '#ef4444';                     // ต่ำกว่าเกณฑ์
};

// status meta pattern
const STATUS_META = {
  pending:  { label: '⏳ รออนุมัติ', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  approved: { label: '✅ Approved',  color: '#22c55e', bg: 'rgba(34,197,94,0.12)'  },
  rejected: { label: '❌ Rejected',  color: '#ef4444', bg: 'rgba(239,68,68,0.12)'  },
};
```

---

## Mobile Responsive Pattern

```js
const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
useEffect(() => {
  const h = () => setIsMobile(window.innerWidth <= 768);
  window.addEventListener('resize', h);
  return () => window.removeEventListener('resize', h);
}, []);

// layout
<div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row' }}>
  <div style={{ width: isMobile ? '100%' : 210 }}>  {/* sidebar */}
  <div style={{ flex: 1 }}>                          {/* content */}
```

---

## Deploy (Render.com)

| Setting | Value |
|---------|-------|
| Type | Static Site |
| Build Command | `npm run build` |
| Publish Directory | `./dist` |
| Branch | `main` |
| Env vars | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

---

## Checklist เริ่มโปรเจคใหม่

- [ ] `npm create vite@latest <name> -- --template react`
- [ ] ติดตั้ง packages ตาม stack ข้างบน
- [ ] สร้าง `src/supabaseClient.js`
- [ ] สร้าง `src/components/Toast.jsx` (copy จากโปรเจคนี้)
- [ ] วาง CSS variables ใน `index.css`
- [ ] สร้าง `profiles` table + RLS ใน Supabase
- [ ] สร้าง `UserContext` ใน `App.jsx`
- [ ] เพิ่ม `CLAUDE.md` บอก stack, tables, routes
- [ ] ตั้ง env vars บน Render

---

## ตั้งค่า Claude สำหรับโปรเจคใหม่

สร้าง `CLAUDE.md` ที่ root โดยมี:
1. Tech stack + version
2. Supabase Project ID + URL
3. รายการ tables + description
4. รายการ routes + components
5. Deploy info

แนบ `SKILL.md` นี้ด้วยก็ได้ หรือ copy เฉพาะส่วนที่ใช้
