/* ══ ✒️ Icon — ไอคอนเส้น (lucide) แทน emoji ที่จุดวาดกลาง (2026-11-05 · คำสั่ง user "แท็บกับไอคอน" · UI-CONVENTIONS §6.36) ═══
   ทำไม: emoji วาดต่างกันทุกเครื่อง (Windows/Android/webOS TV) · มีสีของตัวเองชนพาเลต 5 สี · ดูไม่เป็นมืออาชีพ (comment 04/11)
   แนวทาง: **ไม่ไล่แก้ 277 ไฟล์** — ทะเบียน `icon: '🏭'` ใน NAV_ITEMS/PageHeader/เมนูยังเป็น emoji เหมือนเดิม
   แล้ว "แปลงที่จุดวาด" ด้วย `<Icon glyph="🏭" />` ⇒ ตัวที่มีใน `ICON_MAP` = ไอคอนเส้น · ไม่มี = วาด emoji เดิม (ไม่หาย ไม่พัง)
   · สี = `currentColor` เสมอ (ตามข้อความรอบตัว) · ขนาด = `size` px (default 16) · stroke 1.75
   · เพดาน Chromium 94: inline SVG ธรรมดา ผ่าน
   · เพิ่ม emoji ใหม่ในทะเบียนเมนู/หัวเพจ = เติม ICON_MAP ที่นี่ (มีด่าน `nav-icons-mapped` ใน regressionGuards)

   ใช้:  <Icon glyph={item.icon} size={17} />          // emoji → svg
         <Icon name="Search" size={14} />               // เรียกชื่อ lucide ตรง (ของใหม่ที่ไม่มี emoji)
         stripIcon('📋 รายการ MO') → 'รายการ MO'         // ตัด emoji นำหน้าป้าย (แท็บ) */
import {
  Recycle, Settings, Zap, CircleCheck, Plane, Plus, Sunrise, Kanban, Award, Landmark, House, Building2, Store,
  Factory, Tag, Users, HardHat, Lightbulb, Briefcase, FileText, Calendar, TrendingUp, TrendingDown, ChartColumn,
  ClipboardList, Ruler, BookOpen, Scroll, FilePenLine, Gauge, Megaphone, Package, Tv, Repeat, RefreshCw, Search,
  Lock, KeyRound, Bell, Link, Wrench, Bolt, Sparkles, Archive, Database, CalendarDays, Anvil, Map, Rocket, Truck,
  Siren, Hammer, UsersRound, Compass, Toolbox, Gamepad2, Camera, FolderOpen, Shield, ShieldCheck, PenLine, Globe,
  Drama, MessageSquare, BellOff, LogOut, Folder, Menu, QrCode, ClipboardCheck, Star, UserRound, Plug,
} from 'lucide-react';

export const ICON_MAP = {
  '♻️': Recycle, '⚙️': Settings, '⚡': Zap, '✅': CircleCheck, '✈️': Plane, '➕': Plus, '🌅': Sunrise, '🎴': Kanban,
  '🏅': Award, '🏛️': Landmark, '🏠': House, '🏢': Building2, '🏬': Store, '🏭': Factory, '🏷️': Tag, '👥': Users,
  '👷': HardHat, '💡': Lightbulb, '💼': Briefcase, '📄': FileText, '📅': Calendar, '📈': TrendingUp, '📉': TrendingDown,
  '📊': ChartColumn, '📋': ClipboardList, '📐': Ruler, '📖': BookOpen, '📜': Scroll, '📝': FilePenLine, '📟': Gauge,
  '📢': Megaphone, '📦': Package, '📺': Tv, '🔁': Repeat, '🔄': RefreshCw, '🔍': Search, '🔎': Search, '🔐': Lock,
  '🔑': KeyRound, '🔔': Bell, '🔌': Plug, '🔗': Link, '🔧': Wrench, '🔩': Bolt, '🔮': Sparkles, '🗃️': Archive, '🗄️': Database,
  '🗓': CalendarDays, '🗓️': CalendarDays, '🗜️': Anvil, '🗺️': Map, '🚀': Rocket, '🚚': Truck, '🚨': Siren, '🛠️': Hammer,
  '🔨': Hammer, '🧑‍🤝‍🧑': UsersRound, '🧭': Compass, '🧰': Toolbox, '🎮': Gamepad2, '📷': Camera, '📸': Camera,
  '🗂️': FolderOpen, '🛡️': Shield, '🦺': ShieldCheck, '✍️': PenLine, '🌐': Globe, '🎭': Drama, '💬': MessageSquare,
  '🔕': BellOff, '🚪': LogOut, '📁': Folder, '☰': Menu, '🔳': QrCode, '☑️': ClipboardCheck, '⭐': Star, '👤': UserRound,
};
const LUCIDE = {
  Recycle, Settings, Zap, CircleCheck, Plane, Plus, Sunrise, Kanban, Award, Landmark, House, Building2, Store, Factory,
  Tag, Users, HardHat, Lightbulb, Briefcase, FileText, Calendar, TrendingUp, TrendingDown, ChartColumn, ClipboardList,
  Ruler, BookOpen, Scroll, FilePenLine, Gauge, Megaphone, Package, Tv, Repeat, RefreshCw, Search, Lock, KeyRound, Bell,
  Link, Wrench, Bolt, Sparkles, Archive, Database, CalendarDays, Anvil, Map, Rocket, Truck, Siren, Hammer, UsersRound,
  Compass, Toolbox, Gamepad2, Camera, FolderOpen, Shield, ShieldCheck, PenLine, Globe, Drama, MessageSquare, BellOff,
  LogOut, Folder, Menu, QrCode, ClipboardCheck, Star, UserRound,
};

// emoji นำหน้าป้าย (ชุดเดียวกับ LEAD_RE ใน utils/i18n.js — รวม variation selector / ZWJ / ช่องว่าง)
const LEAD_RE = /^(?:[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{25A0}-\u{25FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]|\s)+/u;
export const stripIcon = (label) => (typeof label === 'string' ? label.replace(LEAD_RE, '') : label);
export const hasIcon = (glyph) => !!(glyph && ICON_MAP[String(glyph).trim()]);

export default function Icon({ glyph, name, size = 16, strokeWidth = 1.75, style, className, title }) {
  const C = name ? LUCIDE[name] : (glyph ? ICON_MAP[String(glyph).trim()] : null);
  if (C) {
    return <C size={size} strokeWidth={strokeWidth} aria-hidden="true" focusable="false" className={className}
      style={{ flexShrink: 0, verticalAlign: '-0.15em', ...style }} />;
  }
  if (glyph == null || glyph === '') return null;
  // ไม่มีใน map = emoji เดิม (เห็นได้ ไม่หาย) — เติม ICON_MAP เมื่อเจอ
  return <span aria-hidden="true" className={className} title={title}
    style={{ fontSize: size, lineHeight: 1, flexShrink: 0, display: 'inline-block', ...style }}>{glyph}</span>;
}
