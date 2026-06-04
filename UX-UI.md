# UX/UI Design System — 4M Management

ระบบจัดการสายผลิต Thai Summit Group  
ออกแบบสำหรับใช้งานในโรงงาน: หน้าจอ PC ขนาดใหญ่, Tablet, Mobile

---

## 1. Design Philosophy

- **Dark-first**: Default เป็น Dark Forest Green เพื่อลดแสงสะท้อนในสภาพแวดล้อมโรงงาน
- **Functional clarity**: ข้อมูลมาก่อน ตกแต่งทีหลัง — ทุกองค์ประกอบต้องมีเหตุผล
- **Thai-friendly**: ใช้ฟอนต์ Sarabun/Tahoma รองรับภาษาไทยได้ดี
- **Progressive disclosure**: ซ่อน detail ที่ไม่จำเป็น แสดงเมื่อ user ต้องการ

---

## 2. Color Tokens

### Dark Mode (default)

```css
--bg:       #080f08   /* พื้นหลักสุด */
--bg2:      #0d1a0e   /* พื้นรอง */
--bg3:      #132415   /* Input, Modal background */
--card:     #0f1f10   /* Card */
--border:   #1e3421
--border2:  #2a4530

--accent:      #3dd65c   /* สีหลัก — CTA, active state */
--accent-dim:  rgba(61,214,92,0.09)
--accent2:     #f59a3f   /* สีรอง — warning, secondary action */

--green:  #3dd65c
--amber:  #f59a3f
--red:    #e05c4a
--blue:   #4d9fff
--purple: #9b8de8

--text:   #dff0e1   /* body text */
--text2:  #8aba8e   /* secondary text */
--muted:  #527855   /* label, hint */
--muted2: #334e36   /* divider text */
```

### Light Mode

```css
--bg:       #f5f7f5
--bg2:      #ffffff
--bg3:      #eef3ee
--card:     #ffffff
--accent:   #0d3d14
--text:     #0a1f0c
--text2:    #2d4a30
--muted:    #6a8a6d
```

### Section Colors (Skill Categories)

| Category | Color | Icon |
|----------|-------|------|
| Hard Skill | `#ef4444` (red) | 🔧 |
| Machine Skill | `#f97316` (orange) | ⚙️ |
| Product Skill | `#3b82f6` (blue) | 📦 |
| Soft Skill | `#a855f7` (purple) | 🧠 |

### Production Department Colors

| Dept | Color |
|------|-------|
| PD3 | `#4dcc6a` |
| PD4 | `#f59a3f` |

---

## 3. Typography

### Font Stack

```css
--font-body:    'Sarabun', 'Tahoma', sans-serif;  /* ข้อความทั่วไป */
--font-display: 'Tahoma', 'Sarabun', sans-serif;  /* หัว, KPI, ตาราง */
```

### Scale by Screen Size

| Element | Mobile (≤768) | Desktop (1280-1599) | Large (1600-1919) | Ultra (≥1920) |
|---------|--------------|--------------------|--------------------|----------------|
| `html/body` | 13-14px | 16px | 17px | 18px |
| `nav-link` | 12px | 14px | 15px | 16px |
| `th` | 9-10px | 12px | 12px | 13px |
| `td` | 12-13px | 15px | 15px | 16px |
| `input/select` | — | 15px | 15px | 16px |

### Hierarchy Rules

- **KPI values**: `font-family: var(--font-display); font-weight: 700`
- **Table headers**: `font-size: 12px; letter-spacing: 0.10em; text-transform: uppercase; color: var(--muted)`
- **Section headers**: `font-size: 11px; letter-spacing: 2.5px; text-transform: uppercase`
- **Badge/tag**: `font-size: 10px; font-weight: 700; letter-spacing: 0.8px`

---

## 4. Layout

### Sidebar

```
Width: 252px (desktop) | 210px (tablet) | 280px (TV/ultra)
Mobile: slide-in overlay with backdrop
```

- Fixed sidebar + scrollable main content
- `<main>` ใช้ `minHeight: 100vh` (ไม่ใช้ `height: 100vh`) เพื่อไม่สร้าง nested scroll container
- Sidebar backdrop บน mobile: `rgba(0,0,0,0.65)` + `z-index: 990`

### Page Content

```css
.page-content {
  padding: 24px 28px;
  max-width: 1800px;
  margin: 0 auto;
}
/* Mobile */ padding: 14px;
/* Small phone */ padding: 10px;
/* Large desktop */ padding: 28px 36px;
/* Ultra-wide */ padding: 36px 48px;
```

### Card

```css
background: var(--card);
border: 1px solid var(--border);
border-radius: 8px;
box-shadow: var(--shadow-sm);
padding: 20px;
```

---

## 5. Components

### Buttons

```css
/* Base */
font-family: var(--font-body);
cursor: pointer;
transition: opacity 0.18s, transform 0.12s;

/* Hover */ opacity: 0.88;
/* Active */ transform: scale(0.97);
/* Disabled */ opacity: 0.45; cursor: not-allowed;
```

**Button Patterns:**
- **Primary CTA**: `background: var(--accent); color: #000; font-weight: 700`
- **Danger**: `background: var(--red)`
- **Ghost/Icon-only**: 32px circle, `border-radius: 50%`, hover scale + glow
- **Icon buttons (CRUD)**: compact 32px, icon-only, tooltip on hover

### Form Inputs

```css
background: var(--bg3);
border: 1px solid var(--border2);
border-radius: var(--radius);   /* 4px */
padding: 9px 12px;
/* Focus */ border-color: var(--accent);
/* Placeholder */ color: var(--muted);
```

### Modal / Overlay

```css
.overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.78);
  backdrop-filter: blur(4px);
  z-index: 2000;
}
.modal {
  background: var(--bg3);
  border: 1px solid var(--border2);
  border-radius: 8px;
  padding: 28px;
  width: min(480px, 94vw);
}
```

### Toast Notifications

Singleton pattern — import แล้วใช้งานได้เลย:

```js
import { toast } from '../components/Toast'
toast.success('บันทึกสำเร็จ')
toast.error('เกิดข้อผิดพลาด')
toast.info('กำลังโหลด...')
```

### Badges

```css
.badge-green  { color: var(--green);  font-weight: 700; }
.badge-red    { color: var(--red);    font-weight: 700; }
.badge-amber  { color: var(--amber);  font-weight: 700; }
.badge-blue   { color: var(--blue);   font-weight: 700; }
```

---

## 6. Tables

### Base Style

```css
table { width: 100%; border-collapse: collapse; }
th {
  font-size: 12px; font-weight: 700;
  letter-spacing: 0.10em; text-transform: uppercase;
  color: var(--muted); padding: 11px 14px;
  border-bottom: 1px solid var(--border);
}
td {
  padding: 11px 14px; font-size: 15px;
  border-bottom: 1px solid var(--border);
}
tr:last-child td { border-bottom: none; }
tr:hover td { background: var(--accent-dim); }
```

### Horizontal Scroll (Skill Matrix)

ปัญหา: `overflow-x: auto` บังคับให้ `overflow-y: auto` ด้วย (CSS spec) → ทำให้ scrollbar ตกลงไปข้างล่างสุด

วิธีแก้: **Dual Scrollbar Pattern**

```
┌─────────────────────────────────┐
│ [===TOP MIRROR SCROLLBAR===]    │  ← mirror div, height = scrollbar height
├─────────────────────────────────┤
│ Name │ Skill1 │ Skill2 │ ...    │  ← actual table
│ ...  │        │        │        │
└─────────────────────────────────┘
```

- Mirror div width = table scrollWidth (synced via ResizeObserver)
- Bidirectional scroll sync via event listeners
- Custom scrollbar: `height: 8px; background: var(--border2)`

### Scroll Affordance

เพื่อให้ user รู้ว่า scroll ซ้าย-ขวาได้:

1. **Fade gradient**: ด้านซ้าย/ขวา `background: linear-gradient(...)` overlay บาง ๆ
2. **Bouncing arrow**: `›` เคลื่อนไหว `keyframes bounce-right` บริเวณขวา
3. **Hint chip**: "เลื่อนดูสกิลทั้งหมด →" แสดงครั้งแรก หายไปหลัง scroll ครั้งแรก

### Skill Column Visibility

แสดงเฉพาะ column ที่มีพนักงานอย่างน้อย 1 คนมีข้อมูล (score > 0):

```js
const activeSkillDefs = skillDefs.filter(sd =>
  employees.some(emp => {
    const s = emp.employee_skills?.find(es => es.skill_name === sd.name);
    return s && s.score > 0;
  })
);
```

---

## 7. Skill System UX

### Score → Level Mapping

| Score | Level | ความหมาย | สี |
|-------|-------|---------|-----|
| 0 | N/A | ไม่เกี่ยวข้อง / ยังไม่ได้อบรม | — (แสดง "—") |
| 25 | Lv 1 | ต้องอุ / ทำได้เมื่อมีคนดูแล | 🔴 |
| 50 | Lv 2 | มาตรฐาน / ทำได้เองปกติ | 🟡 |
| 75 | Lv 3 | แก้ปัญหาได้ | 🟢 |
| 100 | Lv 4 | ผู้ชำนาญ / สอนคนอื่นได้ | 🔵 |

**กฎ: score = 0 → ไม่แสดง / แสดงเป็น "—"**  
เหตุผล: minimum valid score หลังอบรมคือ 25 เสมอ ดังนั้น 0 = ไม่ได้อบรม = ไม่เกี่ยวข้องกับงาน

### Skill Category Headers (LineSetup, Operator)

แสดง icon + label + คำอธิบายสั้น:

```
🔧 Hard Skill  ·  ทักษะการทำงานรูปแบบต่างๆ
────────────────────────────────────────────
⚙️ Machine Skill  ·  ใช้ ปรับตั้ง ควบคุมเครื่องจักร
────────────────────────────────────────────
📦 Product Skill  ·  คุณภาพกระบวนการผลิต
────────────────────────────────────────────
🧠 Soft Skill  ·  หลักการคิด ระบบการทำงาน
```

### Radar Chart

- แสดงเฉพาะ skill ที่ score > 0
- ไม่ plot จุด 0 เพราะจะทำให้กราฟบิดเบือน

---

## 8. Responsive Breakpoints

| Name | Range | Notes |
|------|-------|-------|
| Small phone | ≤ 480px | Single column, font 13px |
| Mobile | ≤ 768px | Sidebar overlay, table scroll wrap |
| Tablet | 769–1024px | Sidebar 210px, compact padding |
| Desktop | 1025–1279px | Default layout |
| Large desktop | 1280–1599px | font 16px, normal spacing |
| Wide | 1600–1919px | font 17px, larger nav |
| Ultra-wide / TV | ≥ 1920px | font 18px, sidebar 280px |

```css
@media (max-width: 768px) {
  .stat-grid-4 { grid-template-columns: repeat(2, 1fr) !important; }
  .table-scroll-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .sidebar-backdrop.visible { display: block; }
}
```

---

## 9. Theme Toggle

- Data attribute: `document.documentElement.setAttribute('data-theme', 'light')`
- CSS selector: `[data-theme="light"] { ... }`
- Transition: `background-color 0.22s ease, color 0.15s ease`
- Persisted in `localStorage` key: `theme`

---

## 10. Splash Screen

```
#splash → position: fixed, z-index: 9000
  ↓ 0ms   logo animates up + fade in
  ↓ 200ms title animates up
  ↓ 450ms subtitle fades in
  ↓ bar fills 0→100% over ~1.5s
  ↓ opacity: 0 + pointer-events: none (class "hidden")
```

---

## 11. Sidebar Navigation

```
Logo (top) 
──────────
[nav-link] icon + label
  • active: background accent-dim, color accent, left border 2px accent
  • hover: background accent-dim, color accent
──────────
[User panel] (bottom)
  avatar | name (13px bold)
          email (11px muted)
          role badge (10px)
[Theme toggle] [Logout]
```

---

## 12. Shadows

```css
--shadow-sm: 0 2px 8px rgba(0,0,0,0.5)    /* cards */
--shadow-md: 0 4px 20px rgba(0,0,0,0.7)   /* dropdowns, floating UI */
--shadow-lg: 0 10px 40px rgba(0,0,0,0.85) /* modals */
```

Light mode versions: `rgba(0,0,0,0.07/0.10/0.14)`

---

## 13. Border Radius

```css
--radius:    4px   /* inputs, buttons */
--radius-sm: 3px   /* badges, tags */
--radius-lg: 8px   /* cards, modals */
```

---

## 14. Z-Index Scale

| Layer | z-index |
|-------|---------|
| Normal content | 0 |
| Sticky headers | 10 |
| Dropdowns | 100 |
| Sidebar (mobile) | 1000 |
| Sidebar backdrop | 990 |
| Modals / Overlays | 2000 |
| Toasts | 3000 |
| Splash screen | 9000 |

---

## 15. Animation Principles

- ใช้ Framer Motion สำหรับ page transitions และ complex animations
- CSS transitions สำหรับ micro-interactions (hover, focus)
- Duration: 0.12–0.22s สำหรับ UI responses, 0.4–0.9s สำหรับ page-level
- Easing: `cubic-bezier(0.4, 0, 0.2, 1)` (material standard)
- ไม่ animate ถ้า `prefers-reduced-motion: reduce`

---

## 16. Accessibility

- Contrast ratio: dark mode text/bg ผ่าน WCAG AA
- Focus states: `border-color: var(--accent)` บน inputs
- Disabled states: `opacity: 0.45; cursor: not-allowed`
- Keyboard: modals ควร trap focus (ยังไม่ implement ครบ)
- Touch targets: minimum 44×44px บน mobile

---

## 17. Pattern Library (Quick Reference)

### Section Header Divider

```jsx
<div className="vx-section-header">
  <h3>Section Title</h3>
  <span className="tag">TAG</span>
  <div className="line" />
</div>
```

### KPI Card

```jsx
<div className="card">
  <div style={{ color: 'var(--muted)', fontSize: 11 }}>LABEL</div>
  <div className="kpi-val" style={{ fontSize: 28 }}>999</div>
  <div style={{ color: 'var(--text2)', fontSize: 12 }}>sub text</div>
</div>
```

### Status Badge

```jsx
<span className="badge-green">● Active</span>
<span className="badge-red">● Error</span>
<span className="badge-amber">● Pending</span>
```

### Scrollable Table Wrapper (Mobile)

```jsx
<div className="table-scroll-wrap">
  <table>...</table>
</div>
```

---

*Last updated: 2026-06-04 — Thai Summit 4M Management System*
