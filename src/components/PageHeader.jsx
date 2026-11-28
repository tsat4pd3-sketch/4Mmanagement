import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MoreMark } from './InfoMore';
import { useLocation, useNavigate } from 'react-router-dom';
import { NAV_ITEMS, STICKY_TAB_GROUPS, FULL_STICKY_GROUPS, STD_LAYOUT_GROUPS, inNavGroup } from '../App';
import { useNavSubItemsStore } from '../utils/navSubItems';
import { publishNavTabs } from '../utils/navTabsLive';   // 🗂️ 27/11 แท็บของทุกหน้า → ข้อย่อยในแผงเมนู   // 🗂️ Detail Bar = รายการที่หน้าประกาศตอนรัน (พื้นที่ SAP)
import { useMergeParams } from '../utils/useTabParam';
import { NAV_SUB_TABS } from '../utils/navSubTabs';   // 🗂️ 24/11 หน้าที่แท็บย้ายไปเป็นข้อย่อยในแผงเมนู
import useIsMobile from '../utils/useIsMobile';
import { HubContext } from './Page';
import MobileFilterFold, { splitFilterChildren } from './MobileFilterFold';
import useLang from '../utils/useLang';   // 🌐 ชื่อหน้า/คำอธิบาย/แท็บ/breadcrumb แปลที่จุดวาด (utils/i18n.js)
import Icon, { stripIcon } from './Icon';   // ✒️ ไอคอนเส้นแทน emoji · แท็บตัด emoji นำหน้า (UI §6.36)
import TabBar from './TabBar';

import { tr } from '../utils/i18n';
/* ══ 🧭 PageHeader — หัวหน้าเพจมาตรฐาน (breadcrumb + ชื่อหน้า + ปุ่ม + แท็บ) ══════════════
   ทุกหน้าควรขึ้นด้วย component นี้ ห้ามวาดหัวเรื่อง/แถบแท็บเอง
   (ดู docs/NAVIGATION-REVIEW.md — เดิมมีหัวเรื่องแค่ 22 จาก 56 หน้า และแท็บมุมโค้ง 7/8/12 ปนกัน)

   ใช้:
     const [tab, setTab] = useTabParam(['list','kpi'], 'list');
     <PageHeader title={tr('แจ้งซ่อม MTN (MO)')} icon="🛠️" sub={tr('ค้างดำเนินการ 3 ใบ')}
       actions={<button…/>} tabs={[{key:'list',label: 'รายการ MO'},…]} tab={tab} onTab={setTab} />

   • breadcrumb (หมวด › ชื่อหน้า) generate เองจาก NAV_ITEMS ตาม pathname — ไม่ต้องใส่มือ
   • เว้น paddingRight ให้พ้น 🔔 มุมขวาบนตามกติกา UI §7
   • แท็บ: แบบ "เส้นใต้" ทรงเดียวกันทั้งระบบ (2026-11-05 · UI §6.36) · เลื่อนแนวนอนได้บนมือถือ · แท็บที่ถูกเลือก = ตัวหนา + เส้น accent ใต้
     ป้ายแท็บถูกตัด emoji นำหน้าออกที่จุดวาด (`stripIcon`) — ทะเบียน `label: 'รายการ'` ในหน้าไม่ต้องแก้
   ═════════════════════════════════════════════════════════════════════════════════════════ */

/* ── 🔦 ตัวชี้แท็บที่ "ไถลตาม" + เรืองแสง (2026-09-23 · คำสั่ง user จากคลิป Navigation Tabs V2) ──
   กติกาที่ห้ามลืมถ้ามาแก้ต่อ:
   1. ป้ายแท็บเป็นข้อความไทยยาวไม่เท่ากัน (และ badge ทำให้กว้างเปลี่ยนระหว่างวัน)
      ⇒ **ห้ามคำนวณตำแหน่งจาก index × ความกว้างคงที่แบบในคลิปต้นทาง** ต้องวัดปุ่มจริงเสมอ
   2. วัด `offsetTop` ด้วย ไม่ใช่แค่ `offsetLeft` — เดสก์ท็อปแท็บ wrap ได้ ตัวชี้ต้องย้ายบรรทัดตาม
   3. ตัวชี้อยู่ใน `rowRef` ซึ่งเป็น "เนื้อหา" ของกล่องที่เลื่อนแนวนอน (มือถือ) ⇒ เลื่อนตามเองโดย
      ไม่ต้องดัก event scroll · `rowRef` ต้อง `position:relative` เพราะเป็น offsetParent ของปุ่ม
   4. เฟรมแรกห้ามให้ตัวชี้วิ่งมาจากมุมซ้าย — วัดใน useLayoutEffect (ก่อน paint) แล้วค่อยเปิด transition
   5. เพดาน Chromium 94 (จอ TV): transform/transition/box-shadow/ResizeObserver ผ่านหมด
      **ห้ามใช้ `color-mix()`** — แสงเรืองใช้ตัวแปร `--accent-glow` ใน index.css (มีทั้ง 2 ธีม)      */
/* ── 🗂 แท็บเกิน 7 = จัดเป็น "กลุ่ม 2 ชั้น" ที่มองเห็นทั้ง 2 ชั้น (2026-11-13 · user: "ยุบแท็บเกิน 7") — `tabs=[{ key, label, children:[…] }]`
   แถวบน = แท็บเดี่ยว + ชื่อกลุ่ม · แถวล่าง (`data-subtab`) = แท็บลูกของกลุ่มที่เลือก · `?tab=` ยังเป็นคีย์ลูกเดิม ⇒ ลิงก์/บุ๊กมาร์กไม่พัง
   ไม่ใช่ dropdown: ชื่อกลุ่มบอกว่าข้างในมีอะไร (title = รายชื่อลูก) และกดกลุ่มแล้วเห็นลูกทั้งหมดทันที — ยังเป็น recognition ไม่ใช่ recall
   ── 🚫 ห้ามพับแท็บเข้า dropdown (2026-10-01 · user: *"ถ้าเป็นดรอปดาว จะทำให้ user ไม่รู้ป่าว ไม่จำเป็นต้องดรอปดาวก็ได้"*) ──
   รอบ 24/09 เคยพับแท็บที่เกิน 7 เข้า "⋯ เพิ่มเติม" โดยอ้าง Miller 7±2 — **ตีความผิด**: 7±2 คือขีดของสิ่งที่ต้อง "จำ"
   แท็บที่วางอยู่บนจอคือสิ่งที่ "เห็นแล้วจำได้" (recognition) · ของที่ซ่อนอยู่ = คนไม่รู้ว่ามี (NN/g: hidden navigation
   ลดการค้นพบ) ⇒ ProductMaster 4 แท็บ (ลูกค้า/Supplier/ทบทวน CT/Export) กลายเป็นของที่ไม่มีใครเจอ
   · แท็บโชว์ครบเสมอ — เดสก์ท็อปตัดขึ้นบรรทัดใหม่ (ตัวชี้วัด offsetTop ตามได้) · มือถือเลื่อนแนวนอน
   · แท็บเยอะจนรก = แก้ที่ "ของซ้ำ/ของที่ควรเป็นหน้าแยก" (NAVIGATION-REVIEW §2.3) ไม่ใช่ซ่อน */

/* ══ 📝 คำบรรยายใต้ชื่อหน้า — ยาวเกินครึ่งบรรทัดให้พับไป tooltip (2026-11-18 · คำสั่ง user) ═════
   user 18/11: *"ข้อความสีเทาแบบนั้นอยากให้เป็น tooltip เพื่ออ่านมากกว่าโชว์มาเยอะๆแบบนี้"*
   textsweep 18/11 พบ **~30 หน้าหน้าละ 1 จุด** และทุกจุดคือ `sub=` ของคอมโพเนนต์นี้
   ⇒ แก้ที่นี่ที่เดียวจบทุกหน้า **และกันหน้าใหม่ในอนาคตไปด้วย** (ไม่ต้องไล่แก้ทีละหน้า)

   🔴 ย่อรูปแบบ ไม่ย่อความจริง:
     · ท่อนแรก = "หน้านี้คืออะไร" **อยู่บนจอเสมอ** (ตัดทิ้งไม่ได้ คนเปิดมาต้องรู้ว่ามาถูกหน้าไหม)
     · ⚠️ ทุกท่อน **อยู่บนจอเสมอ ห้ามพับ** — กฎ `components/InfoMore.jsx`
       (คำเตือนสถานะจริงซ่อนแล้วกลับไปผิดเงียบ ซึ่งโปรเจคนี้ห้ามที่สุด)
     · ท่อนที่เหลือ (ขยายความ/ที่มา) → `title=` + ⓘ ให้รู้ว่ามีของให้อ่านต่อ
     · สั้นอยู่แล้ว (≤ SUB_HEAD_MAX) = ไม่พับ ไม่ขึ้น ⓘ ให้รก — พฤติกรรมเดิมเป๊ะ
   ⚠️ จอสัมผัสชี้ไม่ได้ ⇒ ท่อนแรก + ⚠️ ต้องพอให้ใช้งานหน้าได้โดยไม่ต้องอ่าน tooltip         */
const SUB_HEAD_MAX = 70;   // ครึ่งบรรทัดที่ 1500px — เกินนี้คือเริ่มแย่ที่กับเนื้อหา
function SubLine({ text = '', marginTop = 3 }) {
  const st = { fontSize: 12.5, color: 'var(--muted)', marginTop };
  /* 🔴 `sub` รับ JSX ได้ด้วย (18 หน้าส่งเป็น element — ชิป/ตัวหนา/ลิงก์ข้างใน เช่น FactoryMap · MtnRepair · Checkin)
        ของพวกนั้น**ห้ามแตะ**: แยกท่อนด้วยข้อความไม่ได้ และ `String(element)` = "[object Object]" บนจอ */
  if (typeof text !== 'string') return <div style={st}>{text}</div>;
  const full = text;
  if (full.length <= SUB_HEAD_MAX) return <div style={st}>{full}</div>;

  /* คั่นด้วย ` · ` เป็นหลัก — แต่หลายหน้าเขียนยาวโดยใช้ ` — ` คั่นแทน (เช่น /pe-docs)
     ซึ่งเดิมหลุดด่านนี้ไปทั้งก้อน ⇒ ถ้าแยกด้วย ` · ` แล้วยังได้ท่อนเดียว ให้ลอง ` — ` ต่อ
     🔴 ลองตามลำดับ ไม่ใช่แยกพร้อมกัน — บรรทัดที่มีทั้งคู่ (`A · B — C`) ต้องคงโครงเดิมไว้ */
  let parts = full.split(' · ').map(x => x.trim()).filter(Boolean);
  if (parts.length === 1) parts = full.split(' — ').map(x => x.trim()).filter(Boolean);
  const warns = parts.filter(x => /^[⚠🔴]/.test(x));
  const plain = parts.filter(x => !/^[⚠🔴]/.test(x));
  /* เก็บท่อนแรกๆ ไว้บนจอจนกว่าจะเต็มครึ่งบรรทัด — อย่างน้อย 1 ท่อนเสมอ */
  const head = []; let n = 0;
  for (const x of plain) { if (head.length && n + x.length > SUB_HEAD_MAX) break; head.push(x); n += x.length + 3; }
  const rest = plain.slice(head.length);
  if (!rest.length) return <div style={st}>{full}</div>;
  return (
    <div style={st} title={rest.join(' · ')}>
      {head.join(' · ')} <MoreMark text={rest.join(' · ')} />
      {warns.map((w, i) => <span key={i} style={{ color: 'var(--amber)', fontWeight: 700 }}> · {w}</span>)}
    </div>
  );
}

/* ══ 🔍 ปุ่มค้นหาท้ายแถบแท็บ — หัวเพจกะทัดรัด (หมวดใน `STICKY_TAB_GROUPS` · 24/11 คำสั่ง user) ════════════════
   user เลือก "ค้นหาข้อมูลในแท็บที่เปิดอยู่" ⇒ ปุ่มนี้ **ไม่มีตรรกะค้นหาของตัวเอง** — มันพิมพ์ลงช่องค้นหาของแท็บ
   (`<SearchInput>` = `input[type=search]`) ⇒ ตัวกรองของแต่ละแท็บทำงานเหมือนพิมพ์ที่ช่องเดิมเป๊ะ (single source)
   · แถบแท็บตรึงบนจอ ⇒ เลื่อนลึกแค่ไหนก็ค้นได้ไม่ต้องเลื่อนกลับขึ้นไปหาช่อง
   · หาช่อง: ช่อง search ตัวแรกที่มองเห็นในหน้า (นอกหัวเพจ · ไม่อยู่ในโมดัล)
   · 🔴 แท็บไม่มีช่องค้นหา = บอกบนจอว่า "แท็บนี้ไม่มีช่องค้นหา" ห้ามเปิดช่องที่พิมพ์แล้วไม่เกิดอะไร (จอโกหก)
   · พิมพ์ผ่าน native setter + event `input` (วิธีมาตรฐานให้ onChange ของ React รับค่า) */
const SEARCH_SEL = 'input[type="search"]';
function findTabSearch(root) {
  const scope = root?.parentElement;
  if (!scope) return null;
  return [...scope.querySelectorAll(SEARCH_SEL)].find(el => !root.contains(el) && el.offsetParent !== null
    && !el.closest('[role="dialog"], .modal, .modal-overlay')) || null;
}
function pushValue(el, v) {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (set) set.call(el, v); else el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function HeaderSearch({ rootRef, tabKey }) {
  const { tr } = useLang();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [none, setNone] = useState(false);
  const [ph, setPh] = useState('');
  const targetRef = useRef(null);
  // เปลี่ยนแท็บ = ช่องเป้าหมายเปลี่ยน ⇒ ปิดแล้วเริ่มใหม่ (ห้ามพิมพ์ค้างไปลงช่องของแท็บเก่า)
  useEffect(() => { setOpen(false); setQ(''); setNone(false); targetRef.current = null; }, [tabKey]);
  useEffect(() => { if (!none) return undefined; const id = setTimeout(() => setNone(false), 2500); return () => clearTimeout(id); }, [none]);
  const toggle = () => {
    if (open) { setOpen(false); return; }
    const el = findTabSearch(rootRef.current);
    targetRef.current = el;
    if (!el) { setNone(true); return; }
    setQ(el.value || ''); setPh(el.placeholder || tr('ค้นหา')); setNone(false); setOpen(true);
  };
  const onChange = (v) => {
    setQ(v);
    const el = targetRef.current;
    if (el && el.isConnected) pushValue(el, v);
    else { targetRef.current = null; setOpen(false); setNone(true); }   // ช่องหายไปแล้ว (แท็บถูกถอด) — บอก ไม่พิมพ์ลอย
  };
  return (
    <span data-ph="tab-search" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      {open && (
        <span className="search-input" style={{ width: 240 }}>
          <span className="search-ico" aria-hidden="true">🔍</span>
          <input type="search" autoFocus value={q} placeholder={ph} aria-label={ph}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
            style={{ paddingLeft: 30, paddingRight: 28 }} />
          {q ? <button type="button" className="search-clear" aria-label={tr('ล้างคำค้น')} onClick={() => onChange('')}>✕</button> : null}
        </span>
      )}
      <button type="button" onClick={toggle} aria-pressed={open} aria-label={tr('ค้นหาข้อมูลในแท็บนี้')} title={tr('ค้นหาข้อมูลในแท็บนี้')}
        style={{ width: 30, height: 30, borderRadius: 'var(--r-md)', flexShrink: 0, cursor: 'pointer',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border2)'}`, background: open ? 'var(--accent-dim)' : 'var(--card)',
          color: open ? 'var(--accent)' : 'var(--text)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon glyph="🔍" size={15} />
      </button>
      {none && (
        <span role="status" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, whiteSpace: 'nowrap', zIndex: 60,
          fontSize: 12, padding: '6px 10px', borderRadius: 'var(--r-md)', background: 'var(--card)', border: '1px solid var(--border2)',
          color: 'var(--muted)', boxShadow: 'var(--shadow-float)' }}>{tr('แท็บนี้ไม่มีช่องค้นหา')}</span>
      )}
    </span>
  );
}

/* ══ 🧰 Tool Bar — (2026-11-25 · คำสั่ง user "ต้องอยู่ตำแหน่งดังภาพตลอด") ══
   27/11 มาตรฐาน 7 ปุ่ม: รีเฟรช · ค้นหา · Export · Import · เพิ่ม · แก้ไข · ลบ — `layout="std"` วาดครบ 7 ปุ่มเสมอ
   ปุ่มที่หน้าไม่ส่งมา = จางกดไม่ได้ (ตำแหน่งปุ่มไม่ขยับระหว่างหน้า/แท็บ) */
const TOOL_ORDER = ['refresh', 'search', 'export', 'import', 'add', 'edit', 'delete'];
const TOOL_LABEL = { refresh: 'รีเฟรช', search: 'ค้นหา', export: 'Export', import: 'Import', add: 'เพิ่ม', edit: 'แก้ไข', delete: 'ลบ' };
const TOOL_TONE = { add: 'var(--green)', edit: 'var(--amber)', delete: 'var(--red)' };
const TOOL_DIM  = { add: 'var(--green-dim)', edit: 'var(--amber-dim)', delete: 'var(--red-dim)' };
const TOOL_GLYPH = { refresh: '🔄', search: '🔍', export: '📤', import: '📥', add: '➕', edit: '📝', delete: '🗑️' };
/* 📱 มือถือ (25/11 "เหมือนจอคอม"): ปุ่มเหลือไอคอน (ป้ายเต็มอยู่ใน title/aria-label) — ไม่งั้น 4 ปุ่มกินทั้งแถวจน Detail Bar เหลือ 0 */
function ToolBar({ tools, iconOnly = false, full = false, searchSlot = null }) {
  const { tr } = useLang();
  const byKey = Object.fromEntries(tools.map(t => [t.key, t]));
  const list = full
    ? TOOL_ORDER.map(k => byKey[k] || { key: k, label: TOOL_LABEL[k], disabled: true, why: 'หน้านี้ไม่ใช้ปุ่มนี้' })
    : [...tools].sort((a, b) => TOOL_ORDER.indexOf(a.key) - TOOL_ORDER.indexOf(b.key));
  return (
    <span data-ph="toolbar" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 8 }}>
      {list.map(t => (t.key === 'search' && !byKey.search && searchSlot) ? <span key="search" data-tool="search" style={{ display: 'inline-flex' }}>{searchSlot}</span> : (
        <button key={t.key} type="button" data-tool={t.key} onClick={t.disabled ? undefined : t.onClick} disabled={!!t.disabled}
          title={tr(t.label || TOOL_LABEL[t.key]) + (t.disabled && t.why ? ` — ${tr(t.why)}` : '')} aria-label={tr(t.label || TOOL_LABEL[t.key])}
          style={{ height: 30, padding: iconOnly ? '0 8px' : '0 12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--r-md)', fontSize: 13, fontWeight: 600, cursor: t.disabled ? 'default' : 'pointer',
            border: `1px solid ${TOOL_TONE[t.key] || 'var(--border2)'}`, background: TOOL_DIM[t.key] || 'var(--card)',
            color: TOOL_TONE[t.key] || 'var(--text)', opacity: t.disabled ? 0.4 : 1, whiteSpace: 'nowrap' }}>
          {iconOnly ? <Icon glyph={TOOL_GLYPH[t.key]} size={16} /> : tr(t.label || TOOL_LABEL[t.key])}</button>
      ))}
    </span>
  );
}

export default function PageHeader({
  title, icon, sub, actions, tabs, tab, onTab, breadcrumb = true, filters, children, tools, layout,
}) {
  /* 📐 `layout="std"` (27/11 · ต้นแบบมาตรฐานบนหน้ากิจกรรม — รอ user เคาะรูปก่อนกวาดทั้งระบบ · UI §0.1)
     Header ชิดบน (คู่กับ <Page top="flush">) → Detail Bar แถวเดียว ◀ ▶ มีเสมอ + Tool Bar 7 ปุ่มขวา → การ์ด
     · แท็บของหน้า (Dashboard/Edit Data/Setting) เปลี่ยนที่ Sub bar ⇒ ไม่วาดแถบแท็บในหน้า (ต้องมีใน `NAV_SUB_TABS` ไม่งั้นวาดตามเดิม) */
  const stdExplicit = layout === 'std';
  const isMobile = useIsMobile();
  const { tr } = useLang();
  const inHub = useContext(HubContext);   // หน้าลูกใน hub → ไม่วาดชื่อหน้า/breadcrumb ซ้ำ (Page.jsx)
  const { pathname, search } = useLocation();
  const tabsViaMenu = stdExplicit && !!NAV_SUB_TABS[pathname];   // `layout="std"` ที่หน้าส่งเอง (กิจกรรม): แท็บเปลี่ยนที่ Sub bar · std ตามหมวด = แท็บยังอยู่ในหน้า
  const navigate = useNavigate();
  const navItem = NAV_ITEMS.find(n => n.to === pathname);
  const rawTabs = (tabs || []).filter(Boolean);
  /* 🗂 แท็บกลุ่ม: entry ที่มี `children` = กลุ่ม (คีย์กลุ่มไม่ใช่ค่าของ ?tab=) · แถวบนวาดกลุ่มเป็น 1 ปุ่ม ·
     กลุ่มที่ถือแท็บปัจจุบัน = active แล้ววาดแถวลูกใต้แถวบน · กดกลุ่ม = ไปลูกตัวแรก · badge กลุ่ม = ผลรวม badge ลูก */
  const groupOf = (k) => rawTabs.find(t => Array.isArray(t.children) && t.children.some(c => String(c.key) === String(k)));
  const activeGroup = groupOf(tab);
  const sumBadge = (kids) => { const n = kids.reduce((a, c) => a + (Number(c.badge) || 0), 0); return n || null; };
  const topTabs = rawTabs.map(t => Array.isArray(t.children)
    ? { key: `grp:${t.key}`, label: t.label, badge: t.badge ?? sumBadge(t.children), title: t.title || t.children.map(c => stripIcon(tr(c.label))).join(' · ') }
    : t);
  const topValue = activeGroup ? `grp:${activeGroup.key}` : tab;
  const onTop = (k) => { const g = String(k).startsWith('grp:') && rawTabs.find(t => Array.isArray(t.children) && `grp:${t.key}` === k); onTab && onTab(g ? g.children[0].key : k); };
  const tabList = topTabs;
  const tabsInPage = !!tabList.length && !tabsViaMenu;   // แถบแท็บวาดในหน้าไหม
  /* 📌 Detail bar ตรึงบน (24/11 · คำสั่ง user "ข้อมูลเยอะ สไลด์ขึ้นลงใช้เวลาหานาน") — เฉพาะหน้าในหมวด `STICKY_TAB_GROUPS` (App.jsx)
     · จอคอมเท่านั้น · หน้าเดี่ยวที่มีแท็บ และไม่มี `filters=` (ให้ค้างแค่แถบแท็บ ตามที่ user เลือก)
     · วิธี: ก้อนหัวเพจทั้งก้อนเป็น sticky แต่ `top` ติดลบเท่าความสูงส่วนเหนือแถบแท็บ ⇒ breadcrumb/ชื่อหน้าเลื่อนหายไป เหลือแท็บติดขอบบน
       (sticky ต้องเป็นลูกตรงของ <Page> ที่สูงเต็มหน้า — ห่อแค่แถบแท็บใน div ของหัวเพจจะเกาะได้แค่ในกล่องหัวเพจ)
     · ไม่เข้าเงื่อนไข = ไม่มี style เพิ่มเลย (หน้าอื่นเหมือนเดิมเป๊ะ) */
  /* 🗜️ 24/11 (คำสั่ง user) เงื่อนไขเดียวกันนี้ = "หัวเพจกะทัดรัด" ด้วย: ไม่มี breadcrumb · ไม่มีคำบรรยาย (`sub`) ·
     ชื่อหน้าอยู่บนสุด · แถบแท็บแถวเดียว (ล้น = ปุ่ม ◀ ▶) · ปุ่ม 🔍 ท้ายแถบ (`HeaderSearch`) */
  /* 🧩 26/11 (คำสั่ง user "ทำหน้าอื่นด้วย ให้เหมือนกัน" — เลือกแบบกะทัดรัดเป็นมาตรฐาน): หัวเพจกะทัดรัดใช้กับ **ทุกหน้าเดี่ยวบนจอคอม**
     ไม่ผูกหมวดเมนูอีกแล้ว (เดิมเฉพาะ `STICKY_TAB_GROUPS` ⇒ แผน-สโตร์หน้าตาต่างจากหน้าอื่น) · มือถือ/hub ไม่แตะ
     · หน้าที่มี `filters=` = กะทัดรัดเหมือนกัน แต่ **ไม่ตรึง** (ค้างแค่แถบแท็บทำไม่ได้เมื่อมีแถบกรองใต้แท็บ — เงื่อนไขเดิม 24/11) และไม่มีปุ่ม 🔍 (แถบกรองมีช่องค้นหาของตัวเอง) */
  /* 📱 25/11 (คำสั่ง user "ขยายผลไปขนาดหน้าจออื่น · มือถือเหมือนจอคอม") — หมวดใน `STICKY_TAB_GROUPS` (แผน-สโตร์ · กิจกรรม)
     ได้หัวเพจกะทัดรัดบนมือถือด้วย · หน้าอื่นบนมือถือยังไม่แตะ (ขอบเขตที่ user สั่ง) */
  const compact = !inHub && !!navItem && (!isMobile || inNavGroup(navItem, STICKY_TAB_GROUPS));
  const compactSticky = compact && !filters;
  /* 📐 std ตามหมวด (27/11 · `STD_LAYOUT_GROUPS`) — แท็บเดิมของหน้า = Detail Bar (แถวเดียว ◀ ▶ มีเสมอ) + Tool Bar 7 ปุ่มชิดขวา
     ปุ่ม 🔍 ของ Tool Bar = ค้นหาในแท็บที่เปิดอยู่ (`HeaderSearch` ตัวเดิม) เมื่อหน้าไม่ได้ส่งปุ่มค้นหาเอง · ปุ่มอื่นที่หน้าไม่ส่ง = จาง */
  const std = stdExplicit || (compactSticky && inNavGroup(navItem, STD_LAYOUT_GROUPS));
  /* 🗂️ 26/11 (คำสั่ง user "แท็บอยู่ในหน้า · เมนูเป็นทางเข้า") — หน้าที่อยู่ในทะเบียน `NAV_SUB_TABS` **ยังวาดแถบแท็บในหน้าเสมอ**
     ข้อย่อยในแผงเมนูเป็น *ทางลัด* เข้าแท็บ (กดจากที่อื่นแล้วตกถึงแท็บนั้นเลย) ไม่ใช่ตัวสลับแท็บ
     — รอบ 24/11 เคยซ่อนแถบแท็บของหน้าพวกนี้ ⇒ สลับแท็บต้องเปิดแผง 2–3 คลิก และคนไม่เห็นว่าหน้านี้มีแท็บอะไรอีก (ถอดแล้ว · ด่าน `tabs-stay-in-page`) */
  /* 📍 Detail Bar (24/11 รอบ 4 · คำสั่ง user "ถัดจาก breadcrumb = Detail Bar: S401, S402…") — ใต้ breadcrumb
     รายการมาจากหน้า (`useNavSubItems(path, tab, query, items)` — ข้อมูลจริงของแท็บนั้น ไม่เดา) · กด = ตั้ง `?<query>=` (ตัวกรองเดียวกับช่องบนจอ)
     · ตอนนี้มีเฉพาะแท็บที่จัดกลุ่มตามพื้นที่ SAP (user เลือก "แสดงเฉพาะหน้าที่มีพื้นที่ SAP") · ไม่มีรายการ = ไม่วาดแถบ
     · แถวเดียว + ◀ ▶ เมื่อล้น (`TabBar scroller`) · ตรึงบนตอนเลื่อนจอ + ปุ่ม 🔍 ท้ายแถบ */
  /* 🗂️ 27/11 (คำสั่ง user "เมนูย่อยใน sidebar ยังมีแค่ของสโตร์"): หน้าเดี่ยวที่มีแท็บประกาศแท็บให้แผงเมนูวาดเป็นข้อย่อย (ทางลัด ?tab=)
     ทำที่ของกลางจุดเดียว — หน้าไม่ต้องขึ้นทะเบียน · hub/หน้าลูกใน hub ไม่ประกาศ (แท็บชั้นใน ไม่ใช่ของเมนู) */
  const tabSig = topTabs.map(t => `${t.key}\u0001${t.label}`).join('\u0002');
  useEffect(() => { if (!inHub && navItem && topTabs.length) publishNavTabs(pathname, rawTabs); }, [inHub, !!navItem, pathname, tabSig]);   // eslint-disable-line react-hooks/exhaustive-deps
  const navLive = useNavSubItemsStore();
  const setUrl = useMergeParams();
  const detail = compactSticky ? (navLive[`${pathname}|${tab ?? ''}`] || null) : null;
  const detailItems = detail && detail.items.length ? detail.items : null;
  const detailCur = detailItems ? (new URLSearchParams(search).get(detail.query) || '') : '';
  /* 📌 ค้างทั้งก้อน (25/11 หมวดกิจกรรม · `FULL_STICKY_GROUPS`) — Header + Detail Bar + Tool Bar ค้างที่ขอบบน top:0
     (ไม่ใช่ top ติดลบแบบ "ค้างเฉพาะแถบ") · ต้องอยู่ในโหมดกะทัดรัดอยู่แล้ว */
  const fullSticky = compactSticky && inNavGroup(navItem, FULL_STICKY_GROUPS);
  /* 📍 25/11 ("บางหน้าไม่มี") — หน้าที่ไม่มีแท็บและไม่มีรายการ Detail Bar ก็ยังมีแถวค้างบนที่มีแค่ 🔍/Tool Bar ชิดขวา
     (ห้ามเดารายการให้หน้า) ⇒ ปุ่มค้นหาอยู่ใกล้มือเสมอตอนเลื่อนจอ */
  const emptyDetailRow = compactSticky && !topTabs.length && !detailItems && inNavGroup(navItem, STICKY_TAB_GROUPS);   // เฉพาะหมวดที่ user สั่ง
  const sticky = compactSticky && (!!topTabs.length || !!detailItems || fullSticky || emptyDetailRow);
  /* 🧰 Tool Bar (25/11) — ปุ่มคำสั่งชุดมาตรฐาน ตำแหน่งตายตัวขวาสุดของแถว Detail Bar (ลำดับ ค้นหา · เพิ่ม · แก้ไข · ลบ)
     · หน้าส่ง `tools=[{ key:'search'|'add'|'edit'|'delete', label, onClick, disabled }]` · ไม่ส่ง = ไม่มี (ปุ่ม 🔍 แบบเดิม)
     · ลำดับเรียงตาม `TOOL_ORDER` เสมอ ไม่ว่าหน้าส่งมาลำดับไหน (ผู้ใช้จำตำแหน่งได้ — คำสั่ง user) */
  const rootRef = useRef(null);
  const toolBar = compactSticky && ((tools && tools.length) || std) ? <ToolBar tools={tools || []} iconOnly={isMobile || std} full={std} searchSlot={std ? <HeaderSearch rootRef={rootRef} tabKey={String(tab ?? '')} /> : null} /> : null;   // std (27/11 คำสั่ง user): ไอคอนทุกขนาดจอ · ชี้ค้าง = ชื่อปุ่ม (title)
  const [stickTop, setStickTop] = useState(0);
  useLayoutEffect(() => {
    if (!sticky) return undefined;
    const root = rootRef.current;
    if (!root) return undefined;
    const measure = () => { if (fullSticky) { setStickTop(0); return; } const bar = root.querySelector('[data-tabbar], [data-detailbar]'); setStickTop(bar ? -bar.offsetTop : 0); };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [sticky, !!detailItems, fullSticky]);   // eslint-disable-line react-hooks/exhaustive-deps
  const leafLabel = stripIcon(tr((activeGroup ? activeGroup.children : rawTabs).find(t => t.key === tab)?.label));
  const tabLabel = activeGroup ? [stripIcon(tr(activeGroup.label)), leafLabel].filter(Boolean).join(' › ') : leafLabel;

  /* แท็บ = ของกลาง <TabBar audit> (06/11) — หน้าตาเดียวกับแถบในหน้าอื่นที่ใช้ TabBar · `audit` = data-tabbar/data-tab-ind ให้ stdsweep
     แถวลูกติด `data-subtab` = ของที่อนุญาตให้คั่นระหว่างแท็บกับแถบกรอง (stdsweep §2.1) */
  const renderTabs = () => (
    <>
      {/* 24/11: โหมดกะทัดรัด = แถวเดียว + ปุ่ม ◀ ▶ เมื่อล้น + ปุ่มค้นหาท้ายแถบ */}
      <TabBar className="ph-chrome" tabs={topTabs} value={topValue} onChange={onTop} audit
        {...(compact ? { scroller: true, ...(std ? { arrows: 'always', ...(isMobile ? null : { after: toolBar }) }
          : (sticky ? { after: <HeaderSearch rootRef={rootRef} tabKey={String(tab)} /> } : null)) } : null)} />
      {/* 📱 std บนมือถือ: Tool Bar ลงแถวถัดไปชิดขวา (แถวเดียวกับแท็บ = แท็บเหลือกว้าง 0) */}
      {std && isMobile && toolBar && (
        <div data-ph="toolbar-row" className="ph-chrome" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -4 }}>{toolBar}</div>
      )}
      {activeGroup && (
        <div data-subtab="1" className="ph-chrome" style={{ marginTop: -4 }}>
          <TabBar size="sm" tabs={activeGroup.children} value={tab} onChange={onTab} />
        </div>
      )}
    </>
  );

  /* 📱 มือถือ: แถบกรอง (`filters=`) ที่มีตัวกรอง ≥2 ตัว ⇒ พับเป็นแถบเดียว · ค้นหา/ของหลัง spacer/ปุ่ม hub โชว์เสมอ
     คืน null = ไม่พับ (จอคอม หรือมีตัวกรองตัวเดียว) ⇒ ผู้เรียก render แบบเดิมเป๊ะ (docs/MOBILE-UX-STANDARD.md §2 ข้อ 3) */
  const mobileFold = (f, extraTail) => {
    if (!isMobile || !f) return null;
    const { fold, search, tail } = splitFilterChildren(f);
    if (fold.length < 2) return null;
    return <MobileFilterFold search={search} tail={extraTail ? [...tail, extraTail] : tail}>{fold}</MobileFilterFold>;
  };

  // ใน hub + ไม่มีอะไรให้โชว์ (ไม่มีคำอธิบาย/ปุ่ม/แท็บ) ⇒ ไม่วาดกล่องเปล่ากินที่ 12px
  if (inHub && !actions && !tabList.length && !filters) return children ?? null;

  /* ใน hub: หน้าแม่แสดงชื่อ+คำอธิบายของแท็บแล้ว ⇒ หน้าลูกไม่แสดง `sub` ซ้ำ และปุ่มคำสั่งไปอยู่ท้ายแถบกรอง
     ⇒ ลำดับใต้แท็บของแม่ = [แท็บย่อย] → [แถบกรอง … ปุ่มคำสั่ง] → เนื้อหา เหมือนหน้าเดี่ยวทุกหน้า
     (stdsweep 24/09: คำอธิบาย/แถวปุ่มของหน้าลูกแทรกระหว่างแท็บกับแถบกรอง 48–67px) */
  if (inHub) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 'var(--ph-mb, 12px)' }}>
        {!!tabList.length && renderTabs()}
        {(filters || actions) && (
          <div className="filter-bar ph-chrome" data-ph="filters" style={{ marginBottom: 0 }}>
            {mobileFold(filters, actions && <span key="hub-actions" data-ph="hub-actions" style={{ display: 'contents' }}>{actions}</span>) || <>
            {filters}
            {actions && <><span className="spacer" /><span data-ph="hub-actions" style={{ display: 'contents' }}>{actions}</span></>}
            </>}
          </div>
        )}
        {children}
      </div>
    );
  }

  const stdOneRow = std && !isMobile && !inHub && compact;   // ชื่อหน้า + breadcrumb แถวเดียว (ดูคอมเมนต์ที่แถวชื่อหน้า)
  /* 📐 28/11 (คำสั่ง user "ส่วนหัวกินพื้นที่เยอะ ย่อ ขยับขึ้นอีก"): หน้ากิจกรรม (`layout="std"` + แท็บอยู่ Sub bar) = **แถวเดียวทั้งหัว**
     ชื่อหน้า + breadcrumb (ตัด … ได้) ซ้าย → Detail Bar → Tool Bar ขวา · หน้าที่มี actions/sub = 2 แถวแบบเดิม */
  const stdMerge = stdOneRow && tabsViaMenu && !!detailItems && !actions && !sub;
  /* breadcrumb — ปกติอยู่บนสุด · หัวเพจกะทัดรัด (24/11 · คำสั่ง user) = ใต้ชื่อหน้า เหนือแถบแท็บ */
  const crumbs = breadcrumb && navItem && !inHub ? (
        <div className="ph-chrome" style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)',
          /* 📱 มือถือโหมดกะทัดรัด: breadcrumb บรรทัดเดียว ตัด … (ชื่อหมวดยาวพับ 2 บรรทัด = หัวเพจที่ค้างบนสูงเกิน 25% จอ · ด่าน mobilesweep)
             ชื่อหน้า/แท็บยังเห็นครบ (ชื่อหน้าอยู่แถวบน · แท็บอยู่แถบแท็บ) · ชี้ดูชื่อหมวดเต็มได้ที่ title */
          ...((isMobile && compact) || stdMerge ? { flexWrap: 'nowrap', overflow: 'hidden', whiteSpace: 'nowrap' } : null) }}>
          <button onClick={() => navigate('/')} style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--muted)', fontSize: 12,
          }}><Icon glyph="🏠" size={12} style={{ marginRight: 4 }} />{tr('หน้าหลัก')}</button>
          <span>›</span>
          {/* มือถือโหมดกะทัดรัด: ชื่อหมวดย่อเป็น … (ชื่อหมวดยาวถูกบีบหายเมื่อแถวเดียว — ด่าน mobilesweep) · ชื่อเต็มอยู่ที่ title */}
          <span title={tr(navItem.group)}>{isMobile && compact ? '…' : tr(navItem.group)}</span>
          <span>›</span>
          <span style={{ color: 'var(--text)', fontWeight: 700 }}>{tr(navItem.label)}</span>
          {tabLabel && <><span>›</span><span style={{ color: 'var(--text2)' }}>{tabLabel}</span></>}
        </div>
  ) : null;

  /* 📍 แถว Detail Bar รายการพื้นที่ (SAP) — std + แท็บในหน้า = แถวที่ 2 ใต้แท็บ (ไม่ถือ Tool Bar) */
  const detailRow = detailItems ? (
      <div data-detailbar="1" className="ph-chrome">
        <TabBar scroller
          tabs={[...(detail.all ? [{ key: '__all', label: tr('ทั้งหมด') }] : []), ...detailItems.map(it => ({ key: String(it.key), label: it.label, title: it.label }))]}
          value={detailCur || (detail.all ? '__all' : String(detailItems[0].key))}
          onChange={(k) => setUrl({ [detail.query]: k === '__all' ? null : k }, { replace: true })}
          arrows={std ? 'always' : undefined}
          after={(std && (isMobile || tabsInPage)) ? undefined : (toolBar || <HeaderSearch rootRef={rootRef} tabKey={String(tab ?? '')} />)} />
        {/* 📱 std บนมือถือ: Tool Bar 7 ปุ่มไม่พอที่ในแถวเดียวกับ Detail Bar (Detail Bar เหลือกว้าง 0) ⇒ ลงแถวถัดไปชิดขวา ลำดับปุ่มเดิม */}
        {std && isMobile && !tabsInPage && toolBar && (
          <div data-ph="toolbar-row" style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 6 }}>{toolBar}</div>
        )}
      </div>
  ) : null;

  return (
    /* `data-ph-root` = ก้อนหัวเพจทั้งก้อน (ชื่อ + คำอธิบาย + แถบแท็บ + filters/actions ของหัว)
       🔴 ตัวตรวจลำดับ (`audit/stdsweep.mjs`) ต้องวัด "ก้นของก้อนนี้" ไม่ใช่ก้นของ `h1`
          ไม่งั้นคำอธิบายใต้ชื่อหน้า (`sub=`) จะถูกนับเป็น "ของแทรกเหนือแถบกรอง" ทุกหน้า
          (เจอจริง 20/10: รายงาน 19 มุมมอง ซึ่งส่วนใหญ่เป็น false positive จากเหตุนี้) */
    <div data-ph-root="1" ref={rootRef} style={{ display: 'flex', flexDirection: 'column', gap: stdOneRow ? 6 : 10, marginBottom: 'var(--ph-mb, 12px)',
      /* 📌 sticky: พื้นทึบกันเนื้อหาทะลุ · z ต่ำกว่าแผงเมนู (997+) / กระดิ่ง (1200) · เว้นขวาพ้น 🔔 ให้แถบแท็บ (ชื่อหน้าย้ายมาเว้นที่นี่แทน) */
      ...(sticky ? { position: 'sticky', top: stickTop, zIndex: 50, background: 'var(--bg)', paddingRight: 52,
        ...(isMobile ? { paddingLeft: 50 } : null) } : null) }}>
      {!compact && crumbs}

      {stdMerge && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
          <div className="ph-chrome" style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '0 1 auto', maxWidth: '34%', overflow: 'hidden' }}>
            <h2 style={{ margin: 0, fontSize: 20, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', flexShrink: 0, whiteSpace: 'nowrap' }}>
              {icon && <Icon glyph={icon} size={19} strokeWidth={1.6} style={{ color: 'var(--accent)' }} />}{tr(title)}
            </h2>
            <div style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>{crumbs}</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>{detailRow}</div>
        </div>
      )}

      {!stdMerge && (!inHub || sub || actions) && (
      <div className="ph-chrome" style={{
        display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
        justifyContent: 'space-between', paddingRight: (inHub || sticky) ? 0 : 52,   // กัน 🔔 ทับ (UI §7) — ใน hub หัวของแม่กันให้แล้ว · sticky = รากเว้นให้แล้ว
      }}>
        <div style={{ minWidth: 0 }}>
          {!inHub && (
            /* 📱 มือถือ: nowrap (15/10 · handheld 360px) — `wrap` ⇒ ชื่อยาวโดนดันทั้งก้อนลงบรรทัดใหม่ เหลือไอคอนลอยบรรทัดเดียว
               (ScrapReport/AM) · nowrap = ชื่อตัดบรรทัด "ในตัวเอง" ข้างไอคอน
               🔴 จอคอม = แบบเดิมเป๊ะ (เคยใช้ทั้ง 2 จอ ⇒ ชิป MOCKUP ใน title ของ /group-overview ชิดชื่อขึ้น 9px · desktopdiff จับได้) */
            isMobile ? (
              <h2 style={{ margin: 0, fontSize: 19, display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'nowrap' }}>
                {icon && <Icon glyph={icon} size={19} strokeWidth={1.6} style={{ color: 'var(--accent)' }} />}<span style={{ minWidth: 0 }}>{tr(title)}</span>
              </h2>
            ) : (
            stdOneRow ? (
              /* 📐 std จอคอม (27/11 · คำสั่ง user "ส่วนหัวใช้พื้นที่เปลือง ขยับขึ้นอีก"): ชื่อหน้า + breadcrumb แถวเดียว ⇒ Detail Bar / Tool Bar ขึ้นมาแถวที่ 2 */
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: 20, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap' }}>
                  {icon && <Icon glyph={icon} size={19} strokeWidth={1.6} style={{ color: 'var(--accent)' }} />}{tr(title)}
                </h2>
                {crumbs}
              </div>
            ) : (
            <h2 style={{ margin: 0, fontSize: 23, display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              {icon && <Icon glyph={icon} size={22} strokeWidth={1.6} style={{ color: 'var(--accent)' }} />}{tr(title)}
            </h2>
            ))
          )}
          {sub && !compact && <SubLine text={tr(sub)} marginTop={inHub ? 0 : 3} />}
        </div>
        {/* actions = ปุ่ม "คำสั่งระดับหน้า" เท่านั้น (บันทึก/เพิ่ม/พิมพ์/โหมด TV) — ห้ามใส่ตัวกรอง (select/วันที่/ขอบเขต/สเกล)
            ตัวกรองต้องอยู่ `filters` ⇒ ลงใต้แถบแท็บเสมอ (UI-STANDARD §2 ลำดับแนวตั้ง · stdsweep ตรวจ data-ph) */}
        {actions && <div data-ph="actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>{actions}</div>}
        {/* 🔍 หัวเพจกะทัดรัดที่ไม่มีแถบแท็บในหน้า = ปุ่มค้นหาอยู่ท้ายแถวชื่อหน้า (มีแถบแท็บ = อยู่ท้ายแถบแท็บ) */}
        {compactSticky && !sticky && !detailItems && (toolBar || <HeaderSearch rootRef={rootRef} tabKey={String(tab ?? '')} />)}
      </div>
      )}

      {compact && !stdOneRow && crumbs}

      {/* 📍 Detail Bar — ใต้ breadcrumb (ดูคอมเมนต์ `detail` ข้างบน) · "ทั้งหมด" = ล้างตัวกรอง */}
      {emptyDetailRow && std && (
        /* std: แถวว่างก็มี ◀ ▶ (จาง) + Tool Bar ตำแหน่งเดียวกับหน้าที่มีแท็บ */
        <div data-detailbar="1" className="ph-chrome">
          <TabBar scroller arrows="always" tabs={[]} value={null} onChange={() => {}} after={isMobile ? undefined : toolBar} />
          {isMobile && toolBar && <div data-ph="toolbar-row" style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 6 }}>{toolBar}</div>}
        </div>
      )}
      {emptyDetailRow && !std && (
        <div data-detailbar="1" className="ph-chrome" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          minHeight: 36, paddingBottom: 2, borderBottom: '1px solid var(--border)' }}>
          {toolBar || <HeaderSearch rootRef={rootRef} tabKey={String(tab ?? '')} />}
        </div>
      )}
      {detailItems && !(std && tabsInPage) && !stdMerge && detailRow}

      {tabsInPage && renderTabs()}
      {/* 📐 std + แท็บอยู่ในหน้า (27/11): แท็บ = Detail Bar แถวแรก (ถือ Tool Bar) · รายการพื้นที่ SAP ตามมาเป็นแถวที่ 2 */}
      {detailItems && std && tabsInPage && detailRow}

      {/* ── ลำดับแนวตั้งตายตัวทุกหน้า: breadcrumb → ชื่อหน้า|ปุ่มคำสั่ง → แท็บ → แถบกรอง → เนื้อหา ──
          (user 24/09: "ลำดับยังโดดไปมา เดี๋ยวแท็บมาก่อนช่องค้นหา บางหน้าค้นหาอยู่บนสุดก่อนแท็บ") */}
      {filters && <div className="filter-bar ph-chrome" data-ph="filters" style={{ marginTop: 2, marginBottom: 0 }}>{mobileFold(filters) || filters}</div>}
      {children}
    </div>
  );
}
