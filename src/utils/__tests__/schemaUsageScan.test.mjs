// เทสตัวสแกน "หน้าไหนแตะตารางไหน" (หน้า /schema) — src/utils/schemaUsageScan.js
// กับดักที่เคยเจอจริงตอนทำ (ล็อกไว้ทั้งหมด):
//   · เดินเข้า App.jsx → ทุกหน้าได้รายชื่อตารางเหมือนกันหมด (App import ทุกหน้า + ทุกหน้า import UserContext กลับ)
//   · คอมเมนต์ยกตัวอย่างโค้ด (`supabase.from('t')` ใน dbWrite.js) ติดมาเป็นตารางชื่อ "t"
//   · `storage.from('bucket')` ไม่ใช่ตาราง
import test from 'node:test'
import assert from 'node:assert/strict'
import { scanCode, mergeHits, walkTables, parseAppRoutes, stripComments } from '../schemaUsageScan.js'

test('แยกฝั่ง Main / DR ตามชื่อ client — storage.from ไม่ใช่ตาราง', () => {
  const r = scanCode(`
    const a = await supabase.from('employees').select('*')
    const b = await supabaseDR.from('downtime_logs').select('id')
    const c = supabase.storage.from('line-photos').upload(p, f)
    const d = await client.from('audit_log').select('id')
  `)
  assert.deepEqual(r.main, ['employees'])
  assert.deepEqual(r.dr, ['downtime_logs'])
  assert.deepEqual(r.unknown, ['audit_log'])   // client กลาง = ไม่ฟันธงฝั่ง ไปเทียบทะเบียนจริงบนจอ
  assert.ok(!r.main.includes('line-photos') && !r.dr.includes('line-photos'))
})

test('คอมเมนต์ไม่นับเป็นการใช้ตาราง (เคยได้ตาราง "t" จากตัวอย่างใน dbWrite.js)', () => {
  const r = scanCode([
    "// ใช้: checkWrite(await supabase.from('t').update(x), 'ป้าย')",
    "/* ตัวอย่าง: supabaseDR.from('ตัวอย่าง_zz') */",
    "const ok = await supabase.from('four_m_logs').insert(row)",
  ].join('\n'))
  assert.deepEqual(r.main, ['four_m_logs'])
  assert.deepEqual(r.dr, [])
})

test('stripComments ไม่ไปตัด // ที่อยู่กลางบรรทัด (https:// ในสตริง)', () => {
  assert.match(stripComments("const u = 'https://x.co/a'"), /https:\/\/x\.co\/a/)
})

test('จับ .rpc() ของทั้ง 2 client · เก็บ import ญาติไว้เดินต่อ', () => {
  const r = scanCode(`
    import X from './components/X'
    import { y } from '../utils/y.js'
    import cfg from 'react'
    const { data } = await supabaseDR.rpc('mtn_stock_move', {})
  `)
  assert.deepEqual(r.rpc, ['mtn_stock_move'])
  assert.deepEqual(r.imports, ['./components/X', '../utils/y.js'])   // 'react' = แพ็กเกจ ไม่ใช่ไฟล์ในโปรเจค
})

test('walkTables เดินตาม import ครบสาย + กันวนลูป', () => {
  const files = {
    '/p/page.jsx': "import C from './c'\nawait supabase.from('profiles').select()",
    '/p/c.jsx': "import P from './page'\nawait supabaseDR.from('prod_orders').select()",
  }
  const r = walkTables('/p/page.jsx', {
    getFile: (f) => files[f] ?? null,
    resolveSpec: (from, spec) => (spec === './c' ? '/p/c.jsx' : spec === './page' ? '/p/page.jsx' : null),
  })
  assert.deepEqual(r.main, ['profiles'])
  assert.deepEqual(r.dr, ['prod_orders'])
  assert.deepEqual(r.files.sort(), ['/p/c.jsx', '/p/page.jsx'])
})

test('🔴 skip กัน App.jsx ออกจากกราฟ — ไม่งั้นทุกหน้าได้ตารางชุดเดียวกันหมด', () => {
  const files = {
    '/src/pages/A.jsx': "import { UserContext } from '../App'\nawait supabase.from('employees').select()",
    '/src/App.jsx': "await supabase.from('role_permissions').select()\nawait supabaseDR.from('machines').select()",
  }
  const opts = {
    getFile: (f) => files[f] ?? null,
    resolveSpec: (from, spec) => (spec === '../App' ? '/src/App.jsx' : null),
  }
  const withApp = walkTables('/src/pages/A.jsx', opts)
  assert.ok(withApp.main.includes('role_permissions'), 'ไม่ skip = ตารางของ App ไหลเข้าทุกหน้า')

  const skipped = walkTables('/src/pages/A.jsx', { ...opts, skip: (f) => f === '/src/App.jsx' })
  assert.deepEqual(skipped.main, ['employees'])
  assert.deepEqual(skipped.dr, [])
})

test('parseAppRoutes อ่าน route + ชื่อเมนูจากรูปแบบที่ App.jsx ใช้จริง', () => {
  const app = `
    const DailyReport = lazy(() => import('./pages/DailyReport'));
    export const NAV_ITEMS = [
      { to: '/daily-report',   icon: '📊', label: 'Daily Report',      group: 'ฝ่ายผลิต' },
    ];
    <Routes>
      <Route path="/daily-report"  element={
        <RoleRoute path="/daily-report" userRole={role}><DailyReport /></RoleRoute>
      } />
    </Routes>
  `
  const { routes, nav } = parseAppRoutes(app)
  assert.deepEqual(routes, [{ path: '/daily-report', comp: 'DailyReport', file: './pages/DailyReport' }])
  assert.equal(nav['/daily-report'].label, 'Daily Report')
})

test('mergeHits รวมไม่ซ้ำ + เรียง', () => {
  const r = mergeHits([{ main: ['b', 'a'] }, { main: ['a'], dr: ['z'] }, null])
  assert.deepEqual(r.main, ['a', 'b'])
  assert.deepEqual(r.dr, ['z'])
})
