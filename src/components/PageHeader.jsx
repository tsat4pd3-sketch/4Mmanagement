import { useContext } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { NAV_ITEMS } from '../App';
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
/* ── 🚫 ห้ามพับแท็บเข้า dropdown (2026-10-01 · user: *"ถ้าเป็นดรอปดาว จะทำให้ user ไม่รู้ป่าว ไม่จำเป็นต้องดรอปดาวก็ได้"*) ──
   รอบ 24/09 เคยพับแท็บที่เกิน 7 เข้า "⋯ เพิ่มเติม" โดยอ้าง Miller 7±2 — **ตีความผิด**: 7±2 คือขีดของสิ่งที่ต้อง "จำ"
   แท็บที่วางอยู่บนจอคือสิ่งที่ "เห็นแล้วจำได้" (recognition) · ของที่ซ่อนอยู่ = คนไม่รู้ว่ามี (NN/g: hidden navigation
   ลดการค้นพบ) ⇒ ProductMaster 4 แท็บ (ลูกค้า/Supplier/ทบทวน CT/Export) กลายเป็นของที่ไม่มีใครเจอ
   · แท็บโชว์ครบเสมอ — เดสก์ท็อปตัดขึ้นบรรทัดใหม่ (ตัวชี้วัด offsetTop ตามได้) · มือถือเลื่อนแนวนอน
   · แท็บเยอะจนรก = แก้ที่ "ของซ้ำ/ของที่ควรเป็นหน้าแยก" (NAVIGATION-REVIEW §2.3) ไม่ใช่ซ่อน */

export default function PageHeader({
  title, icon, sub, actions, tabs, tab, onTab, breadcrumb = true, filters, children,
}) {
  const isMobile = useIsMobile();
  const { tr } = useLang();
  const inHub = useContext(HubContext);   // หน้าลูกใน hub → ไม่วาดชื่อหน้า/breadcrumb ซ้ำ (Page.jsx)
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const navItem = NAV_ITEMS.find(n => n.to === pathname);
  const tabList = (tabs || []).filter(Boolean);
  const tabLabel = stripIcon(tr(tabList.find(t => t.key === tab)?.label));

  /* แท็บ = ของกลาง <TabBar audit> (06/11) — หน้าตาเดียวกับแถบในหน้าอื่นที่ใช้ TabBar · `audit` = data-tabbar/data-tab-ind ให้ stdsweep */
  const renderTabs = () => <TabBar className="ph-chrome" tabs={tabList} value={tab} onChange={onTab} audit />;

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

  return (
    /* `data-ph-root` = ก้อนหัวเพจทั้งก้อน (ชื่อ + คำอธิบาย + แถบแท็บ + filters/actions ของหัว)
       🔴 ตัวตรวจลำดับ (`audit/stdsweep.mjs`) ต้องวัด "ก้นของก้อนนี้" ไม่ใช่ก้นของ `h1`
          ไม่งั้นคำอธิบายใต้ชื่อหน้า (`sub=`) จะถูกนับเป็น "ของแทรกเหนือแถบกรอง" ทุกหน้า
          (เจอจริง 20/10: รายงาน 19 มุมมอง ซึ่งส่วนใหญ่เป็น false positive จากเหตุนี้) */
    <div data-ph-root="1" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 'var(--ph-mb, 12px)' }}>
      {breadcrumb && navItem && !inHub && (
        <div className="ph-chrome" style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
          <button onClick={() => navigate('/')} style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--muted)', fontSize: 12,
          }}><Icon glyph="🏠" size={12} style={{ marginRight: 4 }} />{tr('หน้าหลัก')}</button>
          <span>›</span>
          <span>{tr(navItem.group)}</span>
          <span>›</span>
          <span style={{ color: 'var(--text)', fontWeight: 700 }}>{tr(navItem.label)}</span>
          {tabLabel && <><span>›</span><span style={{ color: 'var(--text2)' }}>{tabLabel}</span></>}
        </div>
      )}

      {(!inHub || sub || actions) && (
      <div className="ph-chrome" style={{
        display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
        justifyContent: 'space-between', paddingRight: inHub ? 0 : 52,   // กัน 🔔 ทับ (UI §7) — ใน hub หัวของแม่กันให้แล้ว
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
            <h2 style={{ margin: 0, fontSize: 23, display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              {icon && <Icon glyph={icon} size={22} strokeWidth={1.6} style={{ color: 'var(--accent)' }} />}{tr(title)}
            </h2>
            )
          )}
          {sub && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: inHub ? 0 : 3 }}>{tr(sub)}</div>}
        </div>
        {/* actions = ปุ่ม "คำสั่งระดับหน้า" เท่านั้น (บันทึก/เพิ่ม/พิมพ์/โหมด TV) — ห้ามใส่ตัวกรอง (select/วันที่/ขอบเขต/สเกล)
            ตัวกรองต้องอยู่ `filters` ⇒ ลงใต้แถบแท็บเสมอ (UI-STANDARD §2 ลำดับแนวตั้ง · stdsweep ตรวจ data-ph) */}
        {actions && <div data-ph="actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>{actions}</div>}
      </div>
      )}

      {!!tabList.length && renderTabs()}

      {/* ── ลำดับแนวตั้งตายตัวทุกหน้า: breadcrumb → ชื่อหน้า|ปุ่มคำสั่ง → แท็บ → แถบกรอง → เนื้อหา ──
          (user 24/09: "ลำดับยังโดดไปมา เดี๋ยวแท็บมาก่อนช่องค้นหา บางหน้าค้นหาอยู่บนสุดก่อนแท็บ") */}
      {filters && <div className="filter-bar ph-chrome" data-ph="filters" style={{ marginTop: 2, marginBottom: 0 }}>{mobileFold(filters) || filters}</div>}
      {children}
    </div>
  );
}
