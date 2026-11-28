/* ══ 🎯 หน้ากิจกรรม (100P · Smart Factory · KYT · Kaizen · QCC · Lean · CFO · CFP) — 2026-11-25 ══
   หน้าเดียววาดทุกกิจกรรม (ตาม path) · ทะเบียน + เหตุผลโครง → `src/utils/activityPages.js` · 5S มีหน้าของตัวเอง (`pages/activity5s`)
   · ส่วน (Dashboard/Edit Data/Setting) เปลี่ยนที่ Sub Bar (`NAV_SUB_TABS`) — หัวเพจไม่วาดแถบแท็บ
   · Detail Bar = `useNavSubItems(..., { all:false })` · Tool Bar = `tools` ของ PageHeader (ตำแหน่งตายตัว)
   · 28/11 (คำสั่ง user "กิจกรรมหน้าอื่นๆ จะมี 2 หน้าก่อน กลยุทธ์ ภาพรวม · Setting กลยุทธ์อัปโหลด PDF 16:9 ≤ 5 หน้า"):
     Dashboard = กลยุทธ์ (PDF e-book) · ภาพรวม (ยังไม่มีข้อมูล) · Setting = กลยุทธ์ (อัปโหลด/เปลี่ยน/ลบ) ·
     Edit Data = โครงตัวอย่างเดิม · ข้อมูลกลยุทธ์ = `act_strategy` ผ่าน `<StrategyBook>` / `useStrategySetting` (ของกลาง)
   · สิทธิ์แก้กลยุทธ์ = `act_5s:manage` ชั่วคราวทุกกิจกรรม (ตรงกับ RLS ของ act_strategy) จนกว่ากิจกรรมนั้นมีคีย์ของตัวเอง */
import { useContext, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import { StrategyBook } from '../components/StrategyBook';
import { toast } from '../components/Toast';
import { UserContext } from '../App';
import useTabParam from '../utils/useTabParam';
import useStrategySetting from '../utils/useStrategySetting';
import { useNavSubItems } from '../utils/navSubItems';
import { canSeeded } from '../utils/permissions';
import { ACTIVITY_TABS, ACTIVITY_DASH_SECTIONS, ACTIVITY_SETTING_SECTIONS, ACTIVITY_SAMPLE_SECTIONS, activityByPath } from '../utils/activityPages';
import useLang from '../utils/useLang';

const SECTIONS_BY_TAB = { dashboard: ACTIVITY_DASH_SECTIONS, edit: ACTIVITY_SAMPLE_SECTIONS, setting: ACTIVITY_SETTING_SECTIONS };
const TOOL_TH = { refresh: 'รีเฟรช', search: 'ค้นหา', export: 'Export', import: 'Import', add: 'เพิ่ม', edit: 'แก้ไข', delete: 'ลบ' };

export default function Activity() {
  const { tr } = useLang();
  const { pathname } = useLocation();
  const { role } = useContext(UserContext);
  const act = activityByPath(pathname);
  const code = act?.code || '';
  const title = act ? act.label : tr('กิจกรรม');
  const [tab, setTab] = useTabParam(ACTIVITY_TABS.map(t => t.key), ACTIVITY_TABS[0].key);
  const [sp] = useSearchParams();
  const sections = useMemo(() => (SECTIONS_BY_TAB[tab] || ACTIVITY_SAMPLE_SECTIONS).map(s => ({ key: s.key, label: tr(s.label) })), [tab, tr]);
  useNavSubItems(pathname, tab, 'sec', sections, { all: false });
  /* Dashboard เปิดมาที่ "กลยุทธ์" (28/11: user อัป PDF แล้วเปิด Dashboard ไม่เห็น — ภาพรวมของกิจกรรมพวกนี้ยังไม่มีข้อมูล ⇒ หน้าแรกต้องเป็นของที่มีจริง)
     · 5S เปิดที่ภาพรวม (มีข้อมูลใบตรวจ) — หน้าของ 5S แยกไฟล์ */
  const sec = sections.find(s => s.key === sp.get('sec')) || sections[0];
  const tabMeta = ACTIVITY_TABS.find(t => t.key === tab) || ACTIVITY_TABS[0];
  const canEdit = canSeeded('act_5s', 'manage', role);
  const strategySetting = tab === 'setting' && sec.key === 'strategy';
  const st = useStrategySetting(code, title, canEdit);
  const [bookTick, setBookTick] = useState(0);   // รีเฟรชกลยุทธ์ฝั่ง Dashboard = วาดใหม่ (อ่านแถวใหม่)

  const notYet = (what) => () => toast.info(`${tr(what)} — ${tr('ยังไม่เชื่อมฐานข้อมูล (หน้ากิจกรรมยังเป็นโครง)')}`);
  /* 🧰 Tool Bar ตามหน้าที่ของแต่ละส่วน (27/11 · คำสั่ง user): Dashboard = รีเฟรช · ค้นหา · Export · Edit Data = ครบ 7 ปุ่ม (ยังเป็นโครง)
     · Setting → กลยุทธ์ = รีเฟรช + เพิ่ม (อัปโหลด) · แก้ไข (เปลี่ยนไฟล์) · ลบ ของจริง */
  const tools = strategySetting
    ? [{ key: 'refresh', label: TOOL_TH.refresh, onClick: st.reload }, ...st.tools]
    : tab === 'dashboard' && sec.key === 'strategy'
      ? [{ key: 'refresh', label: TOOL_TH.refresh, onClick: () => setBookTick(t => t + 1) }]
      : (tab === 'dashboard' ? ['refresh', 'search', 'export'] : ['refresh', 'search', 'export', 'import', 'add', 'edit', 'delete'])
        .map(k => ({ key: k, label: TOOL_TH[k], onClick: notYet(TOOL_TH[k]) }));

  const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg, 12px)', boxShadow: 'var(--shadow-sm)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 };

  return (
    <Page top="flush">
      <PageHeader layout="std" icon="🎯" title={title} tabs={ACTIVITY_TABS} tab={tab} onTab={setTab} tools={tools} />
      {tab === 'dashboard' && sec.key === 'strategy' ? (
        <StrategyBook key={bookTick} code={code} title={title} />
      ) : strategySetting ? (
        <div data-activity-card="1" style={card}>{st.body}</div>
      ) : (
        /* ③ ยังไม่มีข้อมูล: เขียนบนจอตรงๆ (กฎความซื่อสัตย์ของจอ · ห้ามโชว์ 0) */
        <div data-activity-card="1" style={{ ...card, minHeight: '60vh', padding: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            {title} · {tr(tabMeta.label)} · {sec.label}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {tr('ยังไม่มีข้อมูล — หน้านี้เป็นโครงหน้าจอ ยังไม่เชื่อมฐานข้อมูล')}
          </div>
        </div>
      )}
    </Page>
  );
}
