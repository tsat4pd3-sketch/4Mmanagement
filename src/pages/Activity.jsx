/* ══ 🎯 หน้ากิจกรรม (100P · 5S · Smart Factory · KYT · Kaizen · QCC · Lean · CFO · CFP) — 2026-11-25 ══
   หน้าเดียววาดทุกกิจกรรม (ตาม path) · ทะเบียน + เหตุผลโครง → `src/utils/activityPages.js`
   · ส่วน (Dashboard/Edit Data/Setting) เปลี่ยนที่ Sub Bar (`NAV_SUB_TABS`) — หัวเพจไม่วาดแถบแท็บ
   · Detail Bar = `useNavSubItems(..., { all:false })` · Tool Bar = `tools` ของ PageHeader (ตำแหน่งตายตัว)
   · 🔴 ยังไม่เชื่อมฐานข้อมูล ⇒ ไม่มีคิวรีใดๆ ในไฟล์นี้ · จอบอกตรงๆ ว่ายังไม่มีข้อมูล                         */
import { useMemo } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import { toast } from '../components/Toast';
import useTabParam from '../utils/useTabParam';
import { useNavSubItems } from '../utils/navSubItems';
import { ACTIVITY_TABS, ACTIVITY_SAMPLE_SECTIONS, activityByPath } from '../utils/activityPages';
import useLang from '../utils/useLang';
import { tr } from '../utils/i18n';

export default function Activity() {
  const { tr } = useLang();
  const { pathname } = useLocation();
  const act = activityByPath(pathname);
  const [tab, setTab] = useTabParam(ACTIVITY_TABS.map(t => t.key), ACTIVITY_TABS[0].key);
  const [sp] = useSearchParams();
  const sections = useMemo(() => ACTIVITY_SAMPLE_SECTIONS.map(s => ({ ...s })), []);
  useNavSubItems(pathname, tab, 'sec', sections, { all: false });
  const sec = sections.find(s => s.key === sp.get('sec')) || sections[0];
  const tabMeta = ACTIVITY_TABS.find(t => t.key === tab) || ACTIVITY_TABS[0];

  const notYet = (what) => () => toast.info(`${tr(what)} — ${tr('ยังไม่เชื่อมฐานข้อมูล (หน้ากิจกรรมยังเป็นโครง)')}`);
  /* 🧰 Tool Bar ตามหน้าที่ของแต่ละส่วน (27/11 · คำสั่ง user):
     Dashboard = แสดงผลอย่างเดียว ⇒ รีเฟรช · ค้นหา · Export (ปุ่มจัดการข้อมูลจาง)
     Edit Data = transaction (เบิก/จ่าย/กรอก) ⇒ ครบ 7 ปุ่ม · Setting = ฟังก์ชันผู้ดูแลกิจกรรม (กลยุทธ์/แผนงาน) ⇒ ครบ 7 ปุ่ม
     🔴 สิทธิ์ Setting จะผูกทีมกิจกรรมรายปี (ประธาน · รอง · admin · สมาชิก) ตอนทำฐานข้อมูล — ตอนนี้ยังไม่มีด่าน */
  const TOOLS_BY_TAB = {
    dashboard: ['refresh', 'search', 'export'],
    edit:      ['refresh', 'search', 'export', 'import', 'add', 'edit', 'delete'],
    setting:   ['refresh', 'search', 'export', 'import', 'add', 'edit', 'delete'],
  };
  const TOOL_TH = { refresh: 'รีเฟรช', search: 'ค้นหา', export: 'Export', import: 'Import', add: 'เพิ่ม', edit: 'แก้ไข', delete: 'ลบ' };
  const tools = (TOOLS_BY_TAB[tab] || TOOLS_BY_TAB.dashboard).map(k => ({ key: k, label: TOOL_TH[k], onClick: notYet(TOOL_TH[k]) }));

  return (
    <Page top="flush">
      <PageHeader layout="std" icon="🎯" title={act ? act.label : tr('กิจกรรม')}
        tabs={ACTIVITY_TABS} tab={tab} onTab={setTab} tools={tools} />
      {/* ③ Card Dashboard — ยังไม่มีข้อมูล: เขียนบนจอตรงๆ (กฎความซื่อสัตย์ของจอ · ห้ามโชว์ 0) */}
      <div data-activity-card="1" style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg, 12px)',
        boxShadow: 'var(--shadow-sm)', minHeight: '60vh', padding: 24, display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
          {act ? act.label : ''} · {tr(tabMeta.label)} · {sec.label}
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          {tr('ยังไม่มีข้อมูล — หน้านี้เป็นโครงหน้าจอ ยังไม่เชื่อมฐานข้อมูล')}
        </div>
      </div>
    </Page>
  );
}
