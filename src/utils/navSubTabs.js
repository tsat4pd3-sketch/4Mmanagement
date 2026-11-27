/* 27/11: ทะเบียนนี้ = เฉพาะหน้าที่ param ไม่ใช่ `tab` หรืออยากให้ข้อย่อยโผล่ก่อนเคยเปิดหน้า — หน้าอื่นได้ข้อย่อยอัตโนมัติจาก `navTabsLive.js` (PageHeader ประกาศ)
/* ══ 🗂️ ข้อย่อยของเมนูใน Sub bar = แท็บของหน้านั้น (2026-11-24 · คำสั่ง user "ย้าย Detail bar ไป Sub bar เป็นข้อย่อย") ══
   **ที่เดียว** ของรายชื่อแท็บของหน้าที่ย้ายแท็บไปไว้ในแผงเมนู — หน้าเอาลิสต์จากที่นี่ไปใช้ด้วย (ห้ามพิมพ์ซ้ำในหน้า = ดริฟต์)
   · `param` = query param ของแท็บ (`useTabParam(..., param)`) · `perm` (ไม่ใส่ = ใช้สิทธิ์หน้า) กรองด้วย `hasPermission`
   · `PageHeader` โหมดกะทัดรัด (หมวดใน `STICKY_TAB_GROUPS`) **ไม่วาดแถบแท็บ** ของหน้าที่อยู่ในทะเบียนนี้ — เปลี่ยนแท็บที่แผงเมนู
     หน้าที่ไม่อยู่ในทะเบียน = ยังมีแถบแท็บในหน้าเหมือนเดิม (ไม่มีทางที่แท็บจะหายไปเฉยๆ)
   · ไฟล์นี้ต้องเป็นข้อมูลล้วน (App.jsx import ตอนโหลดแอป — ห้าม import หน้า/ของหนัก)                                   */

/* 📦 /line-stock — 16/11: Stock ขึ้นแท็บแรก · `perm` = สิทธิ์หน้าเดิมของแท็บนั้น (หน้ารวม piggyback 2 คีย์ใน canAccessPage) */
export const LINE_STOCK_TABS = [
  { key:'stock',      label: 'Stock',                  perm: 'page:/line-stock' },
  /* 16/11 (คำสั่ง user) เลิกคำ ขาออก/ขาเข้า — คน W/H อ่านกลับด้าน · key out/in คงเดิม */
  { key:'out',        label: 'ส่งของเข้าไลน์',          perm: 'page:/line-stock' },
  { key:'in',         label: 'รับของเข้าคลัง',          perm: 'page:/line-stock' },
  { key:'reqlog',     label: 'ประวัติเบิก-ส่ง',          perm: 'page:/line-stock' },   // ไลน์ขออะไร · สโตร์ส่งอะไร ย้อนหลังตามช่วงวัน (27/11)
  { key:'monitoring', label: 'Monitoring แผน-สต๊อก',    perm: 'page:/monitoring' },
  { key:'count',      label: 'ตรวจนับ/เฟิร์มยอด',       perm: 'page:/line-stock' },   // กระทบยอดขาออกที่หลุด + ตรวจนับทั้งคลัง (2026-09-23)
  { key:'sap',        label: 'ค้างตัด SAP',             perm: 'page:/line-stock' },   // ใบที่ส่งถึงไลน์แล้วแต่ตัดจ่ายใน SAP ไม่ได้ (04/11)
  { key:'diff',       label: 'คลังพัก/ผลต่าง',          perm: 'page:/line-stock' },   // รับไม่ครบ = ส่วนที่ขาดพักไว้ (05/11)
  { key:'wip',        label: 'WIP ค้างระหว่างขั้น',      perm: 'page:/line-stock' },   // คนละเรื่องกับ 'คิวเติม WIP' ในบอร์ดคัมบัง
  { key:'sapview',    label: 'เทียบตัดแบบ SAP',         perm: 'page:/line-stock' },   // FG×BOM แบบ SAP เทียบที่ ESM ตัดจริง (20/11)
  { key:'sapstock',   label: 'เทียบยอด SAP (MB52)',     perm: 'page:/line-stock' },   // อัปโหลด MB52 เทียบยอดคงคลังรายสัปดาห์ (20/11)
  { key:'settings',   label: 'ตั้งค่า',                 perm: 'page:/line-stock' },
];

/* 🎴 /heijunka — มุมมองของบอร์ดคัมบัง (`?view=`) — ย้ายมาจาก HeijunkaKanban.jsx ทั้งก้อน (24/11)
   ⚠️ แต่ละตู้มีขั้นไม่เหมือนกัน (FG เตรียม→ส่ง→รับ · Child ปล่อยเข้าไลน์→รับเข้าสโตร์ ·
      จัดซื้อ สั่งซื้อ→รับเข้า) ⇒ ห้ามเขียนลำดับขั้นเดียวครอบทุกตู้ คนจะหาปุ่มที่ไม่มีอยู่จริง */
export const HEIJUNKA_VIEW_META = {
  unified:  { label: 'ตู้ Kanban รวม',   act: true,  purpose: 'คิวงานของสโตร์ทุกตู้ — สโตร์เป็นคนกดบันทึกสถานะ (แต่ละตู้มีขั้นของตัวเอง ดูคำบนปุ่ม)',
              monitor: 'สัญญาณ Kanban ทุกตู้ — ดูสถานะอย่างเดียว' },
  chart:    { label: 'Store Time Chart', act: true,  purpose: 'ไลน์ไหนจะขาดของกี่โมง — เลือกพาร์ทแล้วกดสร้างใบส่งได้จากที่นี่',
              monitor: 'ไลน์ไหนจะขาดของกี่โมง — ดูอย่างเดียว' },
  board:    { label: 'Store Board',      act: false, purpose: 'สรุปรายไลน์ว่ามีใบค้างกี่ใบ — เป็นทางลัดเข้าไปทำงานต่อ ไม่มีปุ่มทำงานเอง' },
  timeline: { label: 'Heijunka Board',   act: false, purpose: 'กริดรอบส่ง 24 ชม. — ดูว่ารอบไหนส่งอะไรบ้าง (มีเฉพาะไลน์ที่ใช้รอบ)' },
  pull:     { label: 'Pull / ใบสั่งผลิต', act: true,  purpose: 'ระบบดึง: demand สะสมครบล็อตแล้วออกใบสั่งผลิต + ใบเบิกวัตถุดิบ',
              monitor: 'ระบบดึง: demand สะสมครบล็อตแล้วออกใบสั่งผลิต + ใบเบิกวัตถุดิบ — ดูอย่างเดียว' },
  demand:   { label: 'ความต้องการวันนี้', act: false, purpose: 'ต้องใช้พาร์ทอะไร กี่ชิ้น กี่ใบคัมบัง — สลับดูแบบการ์ดหรือตารางได้' },
  /* 🎴 ใบคัมบังบนจอ แทนใบที่ต้องวนกลับสโตร์ (25/11 · user "ไม่ต้องส่งใบจริง" + "ลดการเดิน")
     🔴 แทนเฉพาะใบสัญญาณ — แท็ก one-way จาก SAP ที่ติดกล่องยังใช้เหมือนเดิม */
  cards:    { label: 'ตู้ e-Kanban',     act: true,  purpose: 'ใบคัมบังบนจอ — ไลน์กด "ใช้หมดแล้ว" แทนการเดินไปวางการ์ดที่ตู้ · สโตร์เห็นคิวหยิบเรียงตามโซน ไม่ต้องเดินเก็บการ์ด',
              monitor: 'ใบคัมบังบนจอ — ดูว่าใบไหนอยู่ที่ไลน์ ใบไหนรอสโตร์ (ดูอย่างเดียว)' },
};

export const TRANSPORT_TABS = [
  { key: 'assign',   label: 'มอบหมายวันนี้' },
  { key: 'route',    label: 'เส้นทางรอบส่ง' },
  { key: 'carriers', label: 'คนขับ/ยานพาหนะ' },
];

export const PLANNER_SALES_TABS = [
  { key: 'planner',    label: 'Forecast Planner' },
  { key: 'kanban',     label: 'คำนวณ Kanban' },
  { key: 'upload',     label: 'อัพโหลด (Sales)' },
  { key: 'monitoring', label: 'Monitoring (Planning)' },
];

export const PRODUCTION_PLAN_TABS = [
  { key: 'plan',     label: 'กำลังการผลิต' },
  /* 📋 แท็บเดียวของหน้านี้ที่ **เขียน DB** — แท็บกำลังการผลิตวิเคราะห์อย่างเดียว
     (งาน lot size ที่ไม่ได้เดินตามคัมบัง ต้องมีคนวางคิวให้ ไม่ใช่ first come first serve) */
  { key: 'lots',     label: 'แผนสั่งงาน (ล็อต)' },
  { key: 'settings', label: 'ตั้งค่า' },
];

import { ACTIVITIES, ACTIVITY_TABS } from './activityPages.js';

/* path → { param, tabs } · แท็บแรก = ค่าตั้งต้นของหน้า (ตรงกับ default ของ useTabParam ในหน้า) */
export const NAV_SUB_TABS = {
  '/line-stock':      { param: 'tab',  tabs: LINE_STOCK_TABS },
  '/heijunka':        { param: 'view', tabs: Object.entries(HEIJUNKA_VIEW_META).map(([key, m]) => ({ key, label: m.label })) },
  '/transport':       { param: 'tab',  tabs: TRANSPORT_TABS },
  '/planner-sales':   { param: 'tab',  tabs: PLANNER_SALES_TABS },
  '/production-plan': { param: 'tab',  tabs: PRODUCTION_PLAN_TABS },
  /* 🎯 หมวดกิจกรรม (25/11) — 9 กิจกรรม × Dashboard · Edit Data · Setting (`src/utils/activityPages.js`) */
  ...Object.fromEntries(ACTIVITIES.map(a => [a.path, { param: 'tab', tabs: ACTIVITY_TABS }])),
};
