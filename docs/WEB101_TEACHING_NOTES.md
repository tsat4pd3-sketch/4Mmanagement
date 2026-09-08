# เขียนเว็บสายโรงงาน 101 — คู่มือผู้สอน

เอกสารประกอบสไลด์ `docs/WEB101_Teaching_Slides.html` (71 สไลด์)
เปิดสไลด์: ดับเบิลคลิกไฟล์ → เปิดในเบราว์เซอร์ · `→`/Space ถัดไป · `←` ย้อน · `F` เต็มจอ · แตะขอบซ้าย/ขวาบนแท็บเล็ตได้

> ทำไมต้องมีไฟล์นี้: สไลด์ฉายให้ดู ส่วนนี้คือของที่ผู้เรียน **คัดลอกไปวางได้** และผู้สอนใช้คุมเวลา
> ผู้เรียนเปิดสไลด์บนโปรเจคเตอร์อย่างเดียวจะพิมพ์ตามไม่ทัน — แจกไฟล์นี้ให้ทุกคนก่อนเริ่ม

---

## 1. กลุ่มเป้าหมาย & เงื่อนไข

| หัวข้อ | รายละเอียด |
|---|---|
| ผู้เรียน | วิศวกร/ธุรการ/หัวหน้างาน ที่ **ไม่เคยเขียนโปรแกรม** แต่ใช้ Excel คล่อง |
| จำนวนที่เหมาะสม | 8–15 คน (มากกว่านี้ต้องมีผู้ช่วยเดินดูอีก 1 คน) |
| เวลา | 6 ชั่วโมง (บรรยาย 4 + แล็บ 2) หรือแบ่ง 2 ครึ่งวัน |
| ต้องเตรียม | คอมพิวเตอร์คนละเครื่อง (ลงสิทธิ์ติดตั้งโปรแกรมได้) · อินเทอร์เน็ต · โปรเจคเตอร์ |
| ผู้สอนต้องเตรียม | บัญชี Supabase ตัวอย่าง 1 โปรเจค + บัญชี GitHub · เผื่อคนติดตั้งไม่ทัน |

**ให้ผู้เรียนติดตั้งมาก่อนวันเรียน** (ส่งลิงก์ล่วงหน้า 3 วัน) — ถ้าเริ่มลงโปรแกรมในห้อง จะเสียเวลาไปครึ่งเช้า

---

## 2. ตารางเวลา

| เวลา | สไลด์ | หัวข้อ | โหมด |
|---|---|---|---|
| 09:00–09:20 | 1–10 | เว็บทำงานยังไง | บรรยาย |
| 09:20–09:50 | 11–17 | ติดตั้ง + สร้างโปรเจคแรก | **ทำตามพร้อมกัน** |
| 09:50–10:35 | 18–25 | HTML / CSS / JavaScript | บรรยาย + ลองพิมพ์ |
| 10:35–10:50 | — | พัก | |
| 10:50–11:50 | 26–35 | React 101 | **ทำตามพร้อมกัน** |
| 11:50–12:10 | 36–39 | Router + โครงโปรเจค | บรรยาย |
| 13:00–13:45 | 40–49 | Supabase + สิทธิ์ | **ทำตามพร้อมกัน** |
| 13:45–14:45 | 50–57 | 🔧 แล็บ: หน้าบันทึกยอดผลิต | **ลงมือทำ** |
| 14:45–15:15 | 58–61 | Git + deploy ขึ้นออนไลน์ | **ทำตามพร้อมกัน** |
| 15:15–15:45 | 62–66 | บทเรียนจากระบบจริง | บรรยาย |
| 15:45–16:00 | 67–71 | ใช้ AI ช่วย · เส้นทางต่อ · การบ้าน | บรรยาย |

**ถ้าเวลาไม่พอ** ตัดตามลำดับนี้: Router (36–39) → บทเรียน (62–66) → HTML/CSS ลึก (19–20)
**ห้ามตัด:** React 101 · Supabase · แล็บ · เช็คลิสต์ 10 ข้อ

---

## 3. เตรียมเครื่อง (ส่งให้ผู้เรียนล่วงหน้า)

| # | โปรแกรม | ลิงก์ | เช็คว่าลงสำเร็จ |
|---|---|---|---|
| 1 | Node.js (LTS) | nodejs.org | `node -v` ขึ้นเลขเวอร์ชัน |
| 2 | Visual Studio Code | code.visualstudio.com | เปิดโปรแกรมได้ |
| 3 | Git | git-scm.com | `git --version` ขึ้นเลข |
| 4 | Google Chrome | google.com/chrome | กด F12 แล้วเห็นแผงเครื่องมือ |

ส่วนเสริม VS Code ที่ควรลง: **ES7+ React snippets** · **Prettier** · **Thai Language Pack** (ถ้าต้องการเมนูไทย)

สมัครบัญชีไว้ล่วงหน้า: **GitHub** (github.com) · **Supabase** (supabase.com) · **Render** (render.com) — ฟรีทั้งหมด

---

## 4. คำสั่งที่ใช้ในคลาส (คัดลอกได้)

```bash
# สร้างโปรเจคใหม่ (เลือก React → JavaScript)
npm create vite@latest my-first-app
cd my-first-app
npm install
npm run dev            # เปิด http://localhost:5173

# ติดตั้งของเพิ่มที่ใช้ในแล็บ
npm install @supabase/supabase-js react-router-dom

# ตรวจก่อนส่งของ
npm run build

# Git
git init
git checkout -b feature/daily-log
git add .
git commit -m "เพิ่มหน้าบันทึกยอดผลิต"
git push -u origin feature/daily-log
```

---

## 5. แล็บ — หน้าบันทึกยอดผลิต (โค้ดเต็ม)

### 5.1 SQL — รันใน Supabase → SQL Editor

```sql
create table daily_logs (
  id          bigserial primary key,
  work_date   date not null,
  shift       text not null default 'day',
  line_name   text not null,
  qty_ok      int  not null default 0,
  qty_ng      int  not null default 0,
  note        text,
  created_by  text,
  created_at  timestamptz default now()
);

alter table daily_logs enable row level security;

create policy "rw for logged-in" on daily_logs
  for all to authenticated using (true) with check (true);

-- ข้อมูลตัวอย่างไว้ทดสอบว่าอ่านได้จริง
insert into daily_logs (work_date, line_name, qty_ok, qty_ng) values
  (current_date, 'ASSY 060', 1240, 6),
  (current_date, 'ASSY 061', 980,  0);
```

> **ระวัง:** ถ้าคลาสยังไม่ทำระบบล็อกอิน ให้เปลี่ยน `to authenticated` เป็น `to anon`
> ชั่วคราวเพื่อให้เห็นข้อมูล **แล้วบอกผู้เรียนให้ชัดว่านี่คือของชั่วคราวสำหรับห้องเรียนเท่านั้น**
> ห้ามใช้แบบนี้กับข้อมูลจริง

### 5.2 `.env` (รากโปรเจค)

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

เพิ่ม `.env` ลงใน `.gitignore` ด้วย (Vite ใส่มาให้แล้ว — ให้ผู้เรียนเปิดดูยืนยัน)

### 5.3 `src/supabaseClient.js`

```js
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(url, key)
```

### 5.4 `src/utils/workDate.js`

```js
/** วันงาน: ก่อน 08:00 นับเป็นวันก่อนหน้า (กะดึกทำงานข้ามเที่ยงคืน)
 *  ⚠️ ห้ามใช้ new Date().toISOString() — คืนเวลาสากล ช้ากว่าไทย 7 ชม. */
export function getWorkDate(now = new Date()) {
  const d = new Date(now)
  if (d.getHours() < 8) d.setDate(d.getDate() - 1)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** กะปัจจุบัน: 08:00–19:59 = day · นอกนั้น night */
export function getCurrentShift(now = new Date()) {
  const h = now.getHours()
  return h >= 8 && h < 20 ? 'day' : 'night'
}
```

### 5.5 `src/pages/DailyLog.jsx` — ไฟล์เต็ม

```jsx
import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { getWorkDate, getCurrentShift } from '../utils/workDate'

const EMPTY = { line_name: '', shift: getCurrentShift(), qty_ok: '', qty_ng: '', note: '' }

export default function DailyLog() {
  const [workDate, setWorkDate] = useState(getWorkDate())
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [form, setForm]         = useState(EMPTY)
  const [saving, setSaving]     = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = async (date) => {
    setLoading(true)
    const { data, error } = await supabase
      .from('daily_logs')
      .select('id, line_name, shift, qty_ok, qty_ng, note')
      .eq('work_date', date)
      .order('line_name')
    if (error) alert('โหลดข้อมูลไม่สำเร็จ: ' + error.message)
    setRows(data || [])
    setLoading(false)
  }

  // โหลดใหม่ทุกครั้งที่เปลี่ยนวัน — มี alive กันคำตอบเก่ามาทับจอใหม่
  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('daily_logs')
        .select('id, line_name, shift, qty_ok, qty_ng, note')
        .eq('work_date', workDate)
        .order('line_name')
      if (!alive) return
      if (error) alert('โหลดข้อมูลไม่สำเร็จ: ' + error.message)
      setRows(data || [])
      setLoading(false)
    })()
    return () => { alive = false }
  }, [workDate])

  const save = async () => {
    if (!form.line_name.trim()) return alert('กรุณากรอกชื่อไลน์ก่อน')
    setSaving(true)
    const { error } = await supabase.from('daily_logs').insert({
      work_date: workDate,
      line_name: form.line_name.trim(),
      shift:     form.shift,
      qty_ok:    Number(form.qty_ok) || 0,
      qty_ng:    Number(form.qty_ng) || 0,
      note:      form.note || null,
    })
    setSaving(false)
    if (error) return alert('บันทึกไม่สำเร็จ: ' + error.message)  // ห้ามเงียบ
    setForm(EMPTY)
    load(workDate)
  }

  const remove = async (row) => {
    if (!confirm(`ลบยอดของ ${row.line_name} ใช่หรือไม่?`)) return
    const { data, error } = await supabase
      .from('daily_logs').delete().eq('id', row.id).select('id')
    if (error)         return alert('ลบไม่สำเร็จ: ' + error.message)
    if (!data?.length) return alert('ลบไม่สำเร็จ — บัญชีนี้ไม่มีสิทธิ์ลบข้อมูล')
    load(workDate)
  }

  const totalOk = rows.reduce((s, r) => s + r.qty_ok, 0)
  const totalNg = rows.reduce((s, r) => s + r.qty_ng, 0)
  const ngPct   = totalOk + totalNg
    ? (totalNg / (totalOk + totalNg) * 100).toFixed(2) : '0.00'

  return (
    <div style={{ padding: 20, fontFamily: 'Sarabun, sans-serif' }}>
      <h2>บันทึกยอดผลิต</h2>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0' }}>
        <label>วันงาน</label>
        <input type="date" value={workDate} style={{ width: 160 }}
               onChange={e => setWorkDate(e.target.value)} />
        <span>ดี {totalOk.toLocaleString()} · เสีย {totalNg.toLocaleString()} · ของเสีย {ngPct}%</span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        <input placeholder="ชื่อไลน์" value={form.line_name}
               onChange={e => set('line_name', e.target.value)} style={{ width: 160 }} />
        <select value={form.shift} onChange={e => set('shift', e.target.value)} style={{ width: 110 }}>
          <option value="day">กะเช้า</option>
          <option value="night">กะดึก</option>
        </select>
        <input type="number" placeholder="ดี" value={form.qty_ok}
               onChange={e => set('qty_ok', e.target.value)} style={{ width: 90 }} />
        <input type="number" placeholder="เสีย" value={form.qty_ng}
               onChange={e => set('qty_ng', e.target.value)} style={{ width: 90 }} />
        <input placeholder="หมายเหตุ" value={form.note}
               onChange={e => set('note', e.target.value)} style={{ width: 200 }} />
        <button onClick={save} disabled={saving || !form.line_name.trim()}>
          {saving ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </div>

      {loading && <p>กำลังโหลด…</p>}
      {!loading && rows.length === 0 && <p>ยังไม่มีข้อมูลของวันนี้</p>}

      {rows.length > 0 && (
        <table border="1" cellPadding="6" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr><th>ไลน์</th><th>กะ</th><th>ดี</th><th>เสีย</th><th>หมายเหตุ</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>{r.line_name}</td>
                <td>{r.shift === 'night' ? 'กะดึก' : 'กะเช้า'}</td>
                <td style={{ textAlign: 'right' }}>{r.qty_ok.toLocaleString()}</td>
                <td style={{ textAlign: 'right', color: r.qty_ng > 0 ? '#c00' : undefined }}>
                  {r.qty_ng.toLocaleString()}
                </td>
                <td>{r.note || '-'}</td>
                <td><button onClick={() => remove(r)}>ลบ</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

### 5.6 ต่อเข้า `src/App.jsx`

```jsx
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import DailyLog from './pages/DailyLog'

export default function App() {
  return (
    <BrowserRouter>
      <nav style={{ padding: 12, borderBottom: '1px solid #ddd' }}>
        <Link to="/daily">บันทึกยอดผลิต</Link>
      </nav>
      <Routes>
        <Route path="/" element={<DailyLog />} />
        <Route path="/daily" element={<DailyLog />} />
      </Routes>
    </BrowserRouter>
  )
}
```

---

## 6. เช็คลิสต์ "หน้าที่ใช้ได้จริง" 10 ข้อ (เกณฑ์ผ่านของแล็บ)

| # | ข้อ | วิธีทดสอบในห้อง |
|---|---|---|
| 1 | ไม่มีข้อมูลก็ไม่พัง | เลือกวันที่ไม่มีข้อมูล → ต้องขึ้นข้อความ ไม่ใช่จอขาว |
| 2 | มีสัญญาณกำลังโหลด | ต้องเห็น "กำลังโหลด…" |
| 3 | บันทึกล้มเหลวแล้วผู้ใช้รู้ | ปิด Wi-Fi แล้วกดบันทึก → ต้องขึ้นข้อความแจ้ง |
| 4 | ข้อมูลไม่ครบ กดไม่ได้ | เว้นช่องไลน์ → ปุ่มต้องกดไม่ได้ |
| 5 | ตัวเลขเป็นตัวเลข | กรอก 1000 + 240 → ยอดรวมต้องได้ 1240 ไม่ใช่ "1000240" |
| 6 | ลบมีการยืนยัน + เช็ค 0 แถว | กดลบ → ต้องถามก่อน |
| 7 | ใช้วันงาน ไม่ใช่วันสากล | เปลี่ยนเวลาเครื่องเป็นตี 2 → ต้องได้วันของเมื่อวาน |
| 8 | จอแคบยังใช้ได้ | ย่อหน้าต่างเหลือครึ่งจอ → ต้องไม่ล้นออกข้าง |
| 9 | สลับวันเร็วๆ ข้อมูลไม่สลับ | กดเปลี่ยนวันรัว 5 ครั้ง → ตัวเลขต้องตรงวันล่าสุด |
| 10 | `npm run build` ผ่าน | ต้องไม่มี error สีแดง |

---

## 7. ตารางแก้ปัญหาที่จะเจอในห้อง (ผู้สอนอ่านล่วงหน้า)

| อาการ | สาเหตุที่พบบ่อยที่สุด | วิธีแก้ |
|---|---|---|
| `npm : command not found` | ยังไม่ได้ลง Node หรือยังไม่ปิด-เปิด Terminal | ปิด Terminal เปิดใหม่ ก่อนอย่างอื่น |
| หน้าเว็บว่างเปล่า จอขาว | มี error ใน Console | เปิด F12 → Console อ่านบรรทัดแดง |
| `Cannot read properties of undefined` | ข้อมูลยังโหลดไม่เสร็จแล้วสั่งใช้ | ตั้งค่าเริ่มต้นเป็น `[]` / ใช้ `?.` |
| ตารางว่าง ทั้งที่ใน Supabase มีข้อมูล | **ลืมเขียนกฎ RLS** | ดูข้อ 5.1 · เช็คแท็บ Network ว่าได้ `[]` กลับมา |
| `Invalid API key` | คัดลอกคีย์ไม่ครบ / แก้ `.env` แล้วไม่รีสตาร์ท | คัดลอกใหม่ + ปิด-เปิด `npm run dev` |
| ตัวแปร env เป็น `undefined` | ชื่อไม่ขึ้นต้น `VITE_` | เปลี่ยนชื่อแล้วรีสตาร์ท |
| กด Enter ในฟอร์มแล้วหน้ารีเฟรช | ใช้ `<form>` โดยไม่กัน default | ไม่ต้องใช้ `<form>` หรือใส่ `e.preventDefault()` |
| จอแดง "Rendered more hooks…" | วาง hook หลัง `if (…) return` | ย้าย hook ขึ้นบนสุดของ component |
| กด F5 บนหน้า `/daily` แล้ว 404 หลัง deploy | ยังไม่ตั้ง rewrite `/*` → `/index.html` | ตั้งใน Render → Redirects/Rewrites |
| ยอดรวมกลายเป็นข้อความต่อกัน | ลืม `Number()` | ครอบทุกค่าที่มาจาก `<input>` |

---

## 8. การบ้าน (ส่งใน 2 สัปดาห์)

1. **ทำหน้าของวันนี้ให้จบ + deploy** — ผ่านครบ 10 ข้อ แล้วส่งลิงก์
2. **เพิ่มอีก 1 อย่างที่ยังไม่ได้สอน** — กราฟ · ส่งออก Excel · ช่องค้นหา (ตั้งใจให้ติด แล้วหาทางออกเอง)
3. **เขียนบันทึก 1 หน้า** — ตารางมีคอลัมน์อะไร · ไฟล์ไหนทำอะไร · **ติดอะไรและแก้ยังไง** (ข้อสุดท้ายมีค่าที่สุด)

---

## 9. อ้างอิงในโปรเจคนี้ (ให้ผู้เรียนไปอ่านต่อ)

| อยากดูของจริงเรื่อง | เปิดไฟล์ |
|---|---|
| กฎรวมของโปรเจค | `CLAUDE.md` |
| หลักการแก้/ต่อยอดอย่างยั่งยืน | `docs/ENGINEERING-PRINCIPLES.md` |
| มาตรฐานหน้าตา UI | `docs/UI-CONVENTIONS.md` |
| ตัวต่อฐานข้อมูล 2 โปรเจค | `src/supabaseClient.js` |
| ตัวเช็คผลการเขียนข้อมูล | `src/utils/dbWrite.js` |
| ระบบสิทธิ์แบบ data-driven | `src/utils/permissions.js` |
| หน้าตัวอย่างที่ครบเครื่อง | `src/pages/DailyReport.jsx` |
| ประวัติการเปลี่ยนฐานข้อมูล | `supabase/migrations/` |

---

*เอกสารนี้คู่กับ `docs/WEB101_Teaching_Slides.html` — แก้สไลด์แล้วอัปเดตไฟล์นี้ด้วย (2026-09-08)*
