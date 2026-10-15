/* ══ 📺 จอวนหน้า (display rotation) — กฎกลางที่เดียว ══════════════════════════════════
   2026-10-09 · คำสั่ง user: "user ที่เป็น role display เราจะตั้งหน้าที่จะให้มันเปิดวนไปเรื่อยๆ ได้มั้ย"
   → "แบบมีหน้า config ได้ว่าจอ user นี้จะเปิดอะไรวนบ้าง"

   ข้อมูล: ตาราง `display_rotations` (Main · 1 แถว = 1 บัญชีที่เปิดจอ)
   ผู้ใช้: `components/DisplayRotator.jsx` (ตัววนบนจอ) · `pages/DisplayRotation.jsx` (หน้าตั้งค่า)
   ⚠️ จุดใหม่ที่ต้องตีความ `items` ให้เรียกไฟล์นี้ — ห้ามเขียน clamp/ตรวจ path เองในหน้า

   กติกาที่ตกผลึก:
   1. **หน้าที่บัญชีนั้นไม่มีสิทธิ์ = ข้าม แล้วต้องเขียนบนจอ** (ห้ามข้ามเงียบ — คนตั้งจะงงว่าทำไมหน้าหาย)
      ตัดสินตอนวนจริงด้วย canAccessPage ของบัญชีนั้น · ไม่เก็บสิทธิ์ไว้ในแถว (สิทธิ์เปลี่ยนที่ /permissions ได้ตลอด)
   2. **ค่าที่อ่านไม่ออก = ไม่ใช่ 0** — path แปลก = ข้าม (`invalid`) · วินาทีว่าง = ใช้ค่าตั้งต้นของจอ
   3. path ต้องเป็นเส้นทางภายในแอปเท่านั้น (`/…` · ห้าม `//host` / `http:` — ไม่ให้จอถูกพาออกนอกระบบ)
   ════════════════════════════════════════════════════════════════════════════════════ */

/** คีย์ใน location.state ที่ตัววนแนบตอนเปลี่ยนหน้า — App ใช้เป็น key ของ <Routes> ให้หน้า remount
 *  (หน้าเดิมที่เปลี่ยนแค่ query จะได้อ่านค่าตั้งต้นจากลิงก์ใหม่ · utils/urlInit.js) */
export const ROT_NAV_STATE = 'rotNav';

/* 🎬 ไม่ขึ้นหน้า splash (โลโก้ ENTERPRISE SHOPFLOOR …) ซ้ำบนจอ TV (15/10 · user "เปลี่ยนหน้าต้องขึ้นโหลดใหม่เรื่อยๆหรอ")
   · ตัววนรีโหลดเต็มหน้าตามรอบ `reload_min` → ฝากธงไว้ใน sessionStorage ก่อนรีโหลด · App อ่านแล้วลบทิ้ง (ใช้ครั้งเดียว)
   · หน้าที่ถูกฝังใน iframe (กรอบตัวอย่างในหน้าตั้งค่า) = ไม่ต้องมี splash
   storage อาจโยน (โหมดส่วนตัว/บล็อก) ⇒ try/catch ทุกครั้ง · พังแล้วแค่เห็น splash เหมือนเดิม */
const QUIET_KEY = 'esm-rot-quiet-reload';
export function markQuietReload() {
  try { sessionStorage.setItem(QUIET_KEY, '1'); } catch { /* ไม่มี storage = เห็น splash ตามปกติ */ }
}
export function skipSplash() {
  try { if (window.self !== window.top) return true; } catch { return true; }   // cross-origin top = ถูกฝังแน่ๆ
  try {
    if (sessionStorage.getItem(QUIET_KEY) !== '1') return false;
    sessionStorage.removeItem(QUIET_KEY);
    return true;
  } catch { return false; }
}

/** ขอบเขตตัวเลข — ต้องตรงกับ CHECK ใน migration 20261009_display_rotations_main.sql */
export const ROT_LIMITS = Object.freeze({
  minSec: 10,         // ต่ำกว่านี้หน้ายังโหลดข้อมูลไม่ทันก็เปลี่ยนแล้ว
  maxSec: 3600,
  defaultSec: 60,
  minPauseSec: 15,
  maxPauseSec: 3600,
  defaultPauseSec: 120,  // มีคนแตะจอ = หยุดวน 2 นาทีให้เขาดูต่อ
  minReloadMin: 60,
  maxReloadMin: 10080,
  defaultReloadMin: 720, // รีโหลดเต็มหน้าทุก 12 ชม. — ทีวี (webOS/Chromium 94) เปิดทิ้งข้ามวันแล้วหน่วยความจำค้างสะสม
  maxItems: 30,
});

/** หน้าที่ห้ามอยู่ในรอบ — วนไปแล้วจอหลุดจากระบบ/วนซ้อนตัวเอง */
const BLOCKED = new Set(['/login', '/register']);

const clampInt = (v, lo, hi) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};

/** ส่วน path ล้วน (ตัด ?query #hash) — สิทธิ์ผูกกับ "หน้า" ไม่ใช่แท็บ */
export function pathOnly(path) {
  return String(path ?? '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
}

/** path ภายในแอปที่ใช้ได้ไหม — ต้องขึ้นต้น `/` ตัวเดียว ไม่มีช่องว่าง ไม่ใช่ `//host` */
export function isValidRotationPath(path) {
  if (typeof path !== 'string') return false;
  const p = path.trim();
  if (!p.startsWith('/') || p.startsWith('//') || /\s/.test(p) || /^\/[a-z]+:/i.test(p)) return false;
  return !BLOCKED.has(pathOnly(p).toLowerCase());
}

/** หน้าที่วนมุมมองเองข้างใน (ผังโรงงาน ?cycle=) ต้องอยู่นานพอให้วนครบ 1 รอบ
 *  ⇒ วินาทีขั้นต่ำ = จำนวนมุมมอง × วินาที/มุมมอง (ตั้งน้อยกว่านี้ = เห็นแค่ 1-2 เรื่องแล้วเปลี่ยนหน้า) */
export function minSecForPath(path) {
  const q = queryParamsOf(path);
  if (pathOnly(path) !== '/factory-map' || !q.cycle) return 0;
  const n = q.cycle === '1' ? 10 : q.cycle.split(',').filter(Boolean).length;
  const per = Math.min(600, Math.max(5, Number(q.csec) || 15));
  return n > 1 ? Math.min(ROT_LIMITS.maxSec, n * per) : 0;
}

/** วินาทีของหน้านี้ — ว่าง/อ่านไม่ออก = ค่าตั้งต้นของจอ (ไม่ใช่ 0) */
export function secOf(item, defaultSec = ROT_LIMITS.defaultSec) {
  const own = item?.sec == null || item.sec === '' ? null : clampInt(item.sec, ROT_LIMITS.minSec, ROT_LIMITS.maxSec);
  return own ?? clampInt(defaultSec, ROT_LIMITS.minSec, ROT_LIMITS.maxSec) ?? ROT_LIMITS.defaultSec;
}

/** ค่าตั้งของแถว (ทน null/ค่าเพี้ยน) → รูปที่ตัววนใช้ได้เลย */
export function normalizeConfig(row) {
  const r = row || {};
  return {
    enabled: r.enabled !== false,
    defaultSec: clampInt(r.default_sec, ROT_LIMITS.minSec, ROT_LIMITS.maxSec) ?? ROT_LIMITS.defaultSec,
    pauseSec: clampInt(r.pause_sec, ROT_LIMITS.minPauseSec, ROT_LIMITS.maxPauseSec) ?? ROT_LIMITS.defaultPauseSec,
    // null = ตั้งใจไม่รีโหลด · ค่าเพี้ยน = ใช้ค่าตั้งต้น
    reloadMin: r.reload_min === null ? null
      : (clampInt(r.reload_min, ROT_LIMITS.minReloadMin, ROT_LIMITS.maxReloadMin) ?? ROT_LIMITS.defaultReloadMin),
    items: Array.isArray(r.items) ? r.items : [],
  };
}

/**
 * แผนวนจริงของจอ — แยก "หน้าที่เล่นได้" ออกจาก "หน้าที่ข้าม (พร้อมเหตุผล)"
 * @param items      ลำดับจากแถว
 * @param canAccess  (pathOnly) => boolean — สิทธิ์ของบัญชีที่เปิดจอ
 * @returns {{ playable: {path,sec,idx}[], skipped: {path,idx,reason:'invalid'|'no_access'}[] }}
 */
export function buildPlaylist(items, canAccess, defaultSec = ROT_LIMITS.defaultSec) {
  const playable = [];
  const skipped = [];
  (Array.isArray(items) ? items : []).slice(0, ROT_LIMITS.maxItems).forEach((it, idx) => {
    const path = typeof it?.path === 'string' ? it.path.trim() : '';
    if (!isValidRotationPath(path)) { skipped.push({ path, idx, reason: 'invalid' }); return; }
    if (typeof canAccess === 'function' && !canAccess(pathOnly(path))) {
      skipped.push({ path, idx, reason: 'no_access' });
      return;
    }
    playable.push({ path, sec: Math.max(secOf(it, defaultSec), minSecForPath(path)), idx });
  });
  return { playable, skipped };
}

export const SKIP_REASON_LABEL = Object.freeze({
  invalid: 'ที่อยู่หน้าไม่ถูกต้อง',
  no_access: 'บัญชีนี้ไม่มีสิทธิ์เข้าหน้านี้',
});

/** ลำดับถัดไป/ก่อนหน้า (วนกลับ) */
export function stepIndex(i, n, dir = 1) {
  if (!n) return 0;
  return (((Number(i) || 0) + dir) % n + n) % n;
}

const queryOf = (path) => { const m = String(path ?? '').match(/\?[^#]*/); return m && m[0] !== '?' ? m[0] : ''; };

/** รายการนี้คือหน้าที่เปิดอยู่ "ตรงเป๊ะ" ไหม (path + query ตามที่ตั้งไว้) */
export function isSameLocation(item, pathname, search = '') {
  if (!item) return false;
  return `${pathOnly(item.path)}${queryOf(item.path)}` === `${pathOnly(pathname)}${search && search !== '?' ? search : ''}`;
}

/** หน้าที่เปิดอยู่ตรงกับรายการไหนในรอบ (-1 = ไม่อยู่ในรอบ) — ตรงเป๊ะก่อน แล้วค่อยตรงแค่ path */
export function indexOfLocation(playable, pathname, search = '') {
  const exact = playable.findIndex(p => isSameLocation(p, pathname, search));
  if (exact >= 0) return exact;
  return playable.findIndex(p => pathOnly(p.path) === pathOnly(pathname));
}

/** ตำแหน่งในรอบหลังหน้าเปลี่ยน — ถ้ารายการเดิมยังตรงหน้าที่เปิดอยู่ให้คงไว้
 *  (รอบที่มีหน้าเดียวกันซ้ำ เช่น A,B,A — ไม่งั้นค้นเจอ A ตัวแรกทุกครั้ง แล้ววนไม่ถึงตัวที่ 3) */
export function resolveIndex(playable, prevIdx, pathname, search = '') {
  if (isSameLocation(playable[prevIdx], pathname, search)) return prevIdx;
  const i = indexOfLocation(playable, pathname, search);
  return i >= 0 ? i : prevIdx;
}

/** ถึงเวลารีโหลดเต็มหน้าหรือยัง (เช็คตอนเปลี่ยนหน้า เพื่อไม่ตัดกลางหน้า) */
export function shouldReload(loadedAtMs, nowMs, reloadMin) {
  if (reloadMin == null || !loadedAtMs || !nowMs) return false;
  return nowMs - loadedAtMs >= reloadMin * 60 * 1000;
}

/** "1:05" / "45 วิ" */
export function fmtSec(s) {
  const n = Math.max(0, Math.round(Number(s) || 0));
  if (n < 60) return `${n} วิ`;
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

/** ทำความสะอาดก่อนบันทึก — ตัดแถวว่าง · trim · sec ว่าง = null */
export function cleanItemsForSave(items) {
  return (Array.isArray(items) ? items : [])
    .map(it => ({
      path: String(it?.path ?? '').trim(),
      sec: it?.sec == null || it.sec === '' ? null : clampInt(it.sec, ROT_LIMITS.minSec, ROT_LIMITS.maxSec),
    }))
    .filter(it => it.path)
    .slice(0, ROT_LIMITS.maxItems);
}

/* ══ ขอบเขตส่วนงาน — ใครตั้ง/สั่งจอไหนได้ (2026-10-14 · คำสั่ง user) ══════════════════════
   "admin ของแต่ละส่วนงาน setup จอของส่วนงานตัวเองได้ ห้าม setup ข้ามกันมั่ว"
   🔴 ฝั่ง DB ตัดสินด้วย `fn_can_manage_display()` (migration 20261014_display_rotation_scope_main.sql)
      **ตรรกะต้องตรงกับฟังก์ชันนี้** — จอนี้มีไว้กรองลิสต์/ปิดปุ่ม ด่านจริงคือ RLS                         */
const normSec = (s) => String(s ?? '').trim().toLowerCase();

/** ส่วนงานของบัญชีจอ (profiles) — sections ก่อน แล้วค่อย section เดี่ยว */
export function sectionsOfProfile(p) {
  const arr = Array.isArray(p?.sections) ? p.sections.filter(Boolean) : [];
  if (arr.length) return arr;
  return p?.section ? [p.section] : [];
}

/**
 * ผู้ตั้งค่าที่มีขอบเขต `managerSections` (ผลของ effectiveSections · `[]` = ทั้งโรงงาน)
 * ตั้ง/สั่งจอที่อยู่ส่วนงาน `targetSections` ได้ไหม
 * · ผู้ตั้งทั้งโรงงาน = ได้ทุกจอ
 * · จอที่ไม่ได้ตั้งส่วนงาน (= เห็นทั้งโรงงาน) = **เฉพาะผู้ตั้งทั้งโรงงาน** (ไม่งั้นแอดมิน PD3 ตั้งจอที่เห็น PD1 ได้)
 * · จอหลายส่วนงาน = ผู้ตั้งต้องครอบ **ทุก** ส่วนงานของจอ
 */
export function canManageDisplay(managerSections, targetSections) {
  const mine = (Array.isArray(managerSections) ? managerSections : []).map(normSec).filter(Boolean);
  if (!mine.length) return true;
  const tgt = (Array.isArray(targetSections) ? targetSections : []).map(normSec).filter(Boolean);
  if (!tgt.length) return false;
  return tgt.every(s => mine.includes(s));
}

/* ══ สั่งจอจากหน้าตั้งค่า (Realtime broadcast · ไม่มีตาราง) ════════════════════════════════
   จอ (DisplayRotator) เปิดช่อง `esm-display-<user_id>` · ส่ง presence = ตอนนี้อยู่หน้าไหน
   คำสั่งที่จอยอมทำ (ห้ามเพิ่ม "ไปที่ path ใดก็ได้" — ใครรู้ id ก็ส่งได้ จึงจำกัดให้สลับได้แค่หน้าในรอบ):
     goto {idx} · next · prev · hold · resume · reload                                            */
export const displayChannelName = (userId) => `esm-display-${userId}`;
export const DISPLAY_CMDS = Object.freeze(['goto', 'next', 'prev', 'hold', 'resume', 'reload']);

/** คำสั่งที่รับมา → การกระทำที่ปลอดภัย (null = ไม่ทำ) */
export function parseDisplayCmd(p, n) {
  const type = p?.type;
  if (!DISPLAY_CMDS.includes(type)) return null;
  if (type === 'goto') {
    const i = Number(p.idx);
    if (!Number.isInteger(i) || i < 0 || i >= n) return null;
    return { type, idx: i };
  }
  return { type };
}

/* ══ ตัวกรองต่อหน้า (แท็บ/ไลน์/ส่วนงานผ่าน ?query) ═════════════════════════════════════════
   "จอ 1 เปิด OEE ของ Apron Assy · จอ 2 ของ Hydroform ทำยังไง" ⇒ แต่ละหน้ารับตัวกรองทาง URL ไม่เหมือนกัน
   ทะเบียนนี้ = **ชุดที่หน้านั้นอ่านจริง** (ตรวจจากโค้ดหน้านั้น 14/10) ห้ามใส่ param ที่หน้าไม่อ่าน
   (ใส่แล้วไม่มีผล = คนตั้งเชื่อว่ากรองแล้ว แต่จอยังโชว์ทั้งส่วนงาน)
   · หน้าที่ไม่อยู่ในทะเบียน = ยังพิมพ์ต่อท้ายลิงก์เองได้ (ช่อง "ขั้นสูง") · เพิ่มหน้า = อ่านโค้ดหน้านั้นก่อน
   kind: 'select' (options) · 'line' (ชื่อไลน์ · LineSelect) · 'section' (ชื่อส่วนงาน)             */
const opt = (value, label) => ({ value, label });
const SHIFT = { key: 'shift', label: 'กะ', kind: 'select', options: [opt('day', '☀️ กะเช้า'), opt('night', '🌙 กะดึก')] };
const BOARD = { key: 'board', label: 'โหมดจอ TV (ซ่อนหัวเพจ)', kind: 'bool' };
/* 🔴 คีย์ทุกตัวตรวจจากโค้ดหน้านั้นแล้ว (15/10) — อ่านผ่าน useSearchParams / useTabParam หรือ utils/urlInit
   kind: select · bool · section (ชื่อส่วนงาน) · line (ชื่อไลน์) · scope (คีย์ขอบเขตผังองค์กร `section:PD3`/`line_group:…`)
         · product (MAT ผ่าน ProductSelect) · `showIf` = โชว์ช่องนี้เฉพาะเมื่อคีย์อื่นมีค่าที่กำหนด */
export const DISPLAY_PAGE_PARAMS = Object.freeze({
  '/tv': [
    { key: 'dept', label: 'มุมมอง', kind: 'select', options: [
      opt('maintenance', '🔧 ช่างซ่อมบำรุง'), opt('production', '🏭 ฝ่ายผลิต'), opt('store', '📦 สโตร์')] },
    { key: 'sec', label: 'ส่วนงาน', kind: 'section' },
    { key: 'team', label: 'ทีมช่าง', kind: 'select', showIf: { dept: ['', 'maintenance'] }, options: [
      opt('all', 'ทุกทีม'), opt('maintenance', 'ช่างซ่อมบำรุง'), opt('die_maintenance', 'ซ่อมแม่พิมพ์'), opt('jig_maintenance', 'ซ่อม JIG')] },
    { key: 'sound', label: 'เสียงเตือน', kind: 'select', options: [opt('all', '🔊 ทุกเครื่องหยุด')] },
  ],
  '/factory-map': [
    { key: 'metric', label: 'มุมมอง (metric)', kind: 'select', options: [
      opt('health', '🚦 ปกติ/ผิดปกติ'), opt('energy', '⚡ พลังงาน'), opt('productivity', '📦 ยอดผลิต'), opt('oee', '⚙️ OEE'),
      opt('breakdown', '🔧 Downtime'), opt('ng', '🚫 ของเสีย'), opt('people', '👷 คน & จุดงาน'), opt('pm', '🛠️ PM ช่าง'),
      opt('am', '🏭 AM'), opt('supply', '🔗 Supply Route')] },
    { key: 'cycle', label: '🔁 วนมุมมองเอง (เลือกเรื่องที่จะวน)', kind: 'multi', optionsFrom: 'metric' },
    { key: 'csec', label: 'วินาที/มุมมอง', kind: 'select', showIf: { cycle: '*' }, options: ['10', '15', '20', '30', '45', '60'].map(v => opt(v, `${v} วิ`)) },
    { key: 'panel', label: 'แผงขวา', kind: 'select', options: [opt('review', '📅 ทบทวนรายวัน'), opt('obeya', '🏛️ OBEYA (สด)'), opt('live', '📊 อันดับ')] },
    { key: 'view', label: 'ผัง', kind: 'select', options: [opt('2d', '2D'), opt('3d', '🧊 3D')] },
    { key: 'tour', label: 'หมุนกล้องอัตโนมัติ (3D)', kind: 'bool', showIf: { view: ['3d'] } },
    { key: 'lbl', label: 'ขนาดป้าย', kind: 'select', options: ['0.6', '0.8', '1', '1.2', '1.4', '1.6'].map(v => opt(v, `${Math.round(v * 100)}%`)) },
    { key: 'nopanel', label: 'ซ่อนแผงขวา', kind: 'bool' },
    { key: 'support', label: 'โชว์โซนสนับสนุน', kind: 'bool' },
  ],
  '/dashboard': [
    { key: 'section', label: 'ส่วนงาน', kind: 'section' },
    { key: 'line', label: 'เปิดผังไลน์', kind: 'line' },
  ],
  '/line-oee': [
    { key: 'line', label: 'ไลน์', kind: 'line' },
  ],
  '/oee-analytics': [
    { key: 'tab', label: 'แท็บ', kind: 'select', options: [opt('today', '⚡ ภาพรวมวันนี้'), opt('trend', '📊 แนวโน้ม/ประวัติ'), opt('insight', '🧠 วิเคราะห์สาเหตุ')] },
    { key: 'section', label: 'ส่วนงาน', kind: 'section' },
    { key: 'dept', label: 'กลุ่มไลน์ (ไลน์แม่)', kind: 'line' },
    { key: 'line', label: 'ไลน์ย่อย', kind: 'line' },
    SHIFT,
    { key: 'team', label: 'ทีม', kind: 'select', showIf: { tab: ['', 'today'] }, options: [opt('A', 'ทีม A'), opt('B', 'ทีม B'), opt('C', 'ทีม C')] },
    { key: 'scale', label: 'แท่งละ', kind: 'select', showIf: { tab: ['trend', 'insight'] }, options: [opt('day', 'วัน'), opt('week', 'สัปดาห์'), opt('month', 'เดือน')] },
  ],
  '/obeya': [
    { key: 'tab', label: 'แท็บ', kind: 'select', options: [opt('kpi', '📋 บอร์ด KPI'), opt('sqdcm', '🖥️ จอ SQDCM'), opt('todo', '📌 งานค้าง')] },
    { key: 'scope', label: 'ขอบเขต', kind: 'scope', showIf: { tab: ['', 'kpi', 'sqdcm'] } },
    { key: 'period', label: 'ช่วง', kind: 'select', showIf: { tab: ['sqdcm'] }, options: [opt('week', 'สัปดาห์นี้'), opt('month', 'เดือนนี้'), opt('year', 'ปีนี้')] },
    { ...BOARD, showIf: { tab: ['', 'kpi', 'sqdcm'] } },
    { key: 'yfocus', label: 'โฟกัสช่วงค่าแกน Y', kind: 'bool', showIf: { tab: ['', 'kpi'] } },
    { key: 'dept', label: 'งานค้างของ', kind: 'select', showIf: { tab: ['todo'] }, options: [
      opt('production', '🏭 ฝ่ายผลิต'), opt('maintenance', '🔧 ซ่อมบำรุง'), opt('store', '📦 สโตร์'), opt('qa', '✅ QA')] },
  ],
  '/manpower-board': [
    { key: 'tab', label: 'แท็บ', kind: 'select', options: [
      opt('org', '🧑‍🤝‍🧑 ผังกำลังคน'), opt('layout', '🗺️ ผัง LAYOUT'), opt('fourm', '🚦 ป้าย 4M'), opt('staffing', '📊 แผน vs มาจริง'), opt('history', '📜 ประวัติ')] },
    { key: 'tv', label: 'โหมดจอ TV (แบ่งหน้า วนเอง)', kind: 'select', options: [opt('1', 'เปิด'), opt('0', 'ปิด')] },
  ],
  '/store-monitor': [
    { key: 'line', label: 'ไลน์', kind: 'line' },
    { key: 'kind', label: 'แสดง', kind: 'select', options: [opt('shortage', '🟥 จะขาด'), opt('over', '🟧 ล้น')] },
    { key: 'side', label: 'ฝั่ง', kind: 'select', options: [opt('inbound', 'Store (ขาเข้า)'), opt('outbound', 'Warehouse & Delivery (ขาออก)')] },
  ],
  '/heijunka': [
    { key: 'view', label: 'มุมมอง', kind: 'select', options: [
      opt('unified', '🗄️ ตู้ Kanban รวม'), opt('chart', '🕐 Store Time Chart'), opt('board', '🏪 Store Board'),
      opt('timeline', '📊 Heijunka Board'), opt('pull', '🔄 Pull / ใบสั่งผลิต'), opt('demand', '📋 ความต้องการวันนี้')] },
    { key: 'store', label: 'สโตร์', kind: 'select', showIf: { view: ['', 'unified'] }, options: [
      opt('fg', '🏭 Store FG'), opt('child', '🔧 Store Child'), opt('purchase', '🛒 จัดซื้อ'), opt('raw', 'Raw Mat'),
      opt('rack', '📦 Rack Center'), opt('wip', 'WIP'), opt('plating', 'ชุบ')] },
    { key: 'sec', label: 'ส่วนงาน', kind: 'section' },
    { key: 'fline', label: 'ไลน์', kind: 'line' },
    { key: 'shift', label: 'กะ', kind: 'select', options: [opt('day', '☀️ กะเช้า'), opt('night', '🌙 กะดึก')] },
    { key: 'mat', label: 'กลุ่มพาร์ท', kind: 'select', options: [opt('200', '200 ผลิตเอง'), opt('300', '300 ซื้อ'), opt('500', '500 ซื้อ')] },
  ],
  '/rack-center': [
    { key: 'tab', label: 'แท็บ', kind: 'select', options: [opt('board', '📋 บอร์ดสถานะ'), opt('time', '🕐 บอร์ดเวลา'), opt('sla', '⚙️ SLA')] },
    { key: 'fline', label: 'ไลน์', kind: 'line' },
  ],
  '/mtn-layout': [
    { key: 'view', label: 'มุมมอง', kind: 'select', options: [opt('overview', 'ผังรวม'), opt('production', 'ผังไลน์ผลิต'), opt('facility', 'โซน facility')] },
    { key: 'zone', label: 'โซน (ชื่อ)', kind: 'text', showIf: { view: ['facility'] } },
    { key: 'metric', label: 'มุมมองผังรวม', kind: 'select', showIf: { view: ['', 'overview'] }, options: [
      opt('health', '🚦 ปกติ/ผิดปกติ'), opt('energy', '⚡ พลังงาน'), opt('productivity', '📦 ยอดผลิต')] },
  ],
  '/mtn-analysis': [
    { key: 'tab', label: 'แท็บ', kind: 'select', options: [opt('kpi', '📊 KPI ช่าง'), opt('qc7', '🧪 QC 7 Tools')] },
    { key: 'asset', label: 'ชนิดอุปกรณ์', kind: 'select', showIf: { tab: ['qc7'] }, options: [
      opt('machine', '🏭 เครื่องจักร'), opt('die', '🔨 แม่พิมพ์'), opt('jig', '📐 JIG / Fixture'), opt('other', '❓ ยังแยกไม่ได้')] },
    { key: 'scale', label: 'แท่งละ', kind: 'select', options: [opt('day', 'วัน'), opt('week', 'สัปดาห์'), opt('month', 'เดือน')] },
  ],
  '/nm-board': [
    { key: 'tv', label: 'โหมดจอ TV (วนโปรเจคเอง)', kind: 'select', options: [opt('1', 'เปิด')] },
    { key: 'cust', label: 'ลูกค้า', kind: 'select', options: ['toyota', 'isuzu', 'mitsubishi', 'nissan', 'ford', 'honda', 'mg', 'byd', 'gwm', 'mazda', 'bmw', 'shonan'].map(v => opt(v, v.toUpperCase())) },
  ],
  '/pm': [
    { key: 'tab', label: 'แท็บ', kind: 'select', options: [opt('forecast', '🔮 ล่วงหน้า (Planner)')] },
    { key: 'fc', label: 'มุมมอง', kind: 'select', options: [opt('due', '🗓 PM ที่จะครบกำหนด'), opt('usage', '📊 ยอดผลิตสะสม')] },
  ],
  '/vsm': [
    { key: 'tab', label: 'แท็บ', kind: 'select', options: [opt('doc', '📋 เอกสาร VSM'), opt('live', '⚡ สายธารสด')] },
    { key: 'mat', label: 'สินค้า FG', kind: 'product' },
    { key: 'state', label: 'สถานะ', kind: 'select', options: [opt('current', 'Current state'), opt('future', '🎯 Future state')] },
  ],
  '/energy': [
    { key: 'tab', label: 'แท็บ', kind: 'select', options: [opt('summary', '📊 สรุป & วิเคราะห์'), opt('mqtt', '📡 มิเตอร์ / MQTT')] },
  ],
  '/report': [
    { key: 'tab', label: 'แท็บ', kind: 'select', options: [opt('0', 'รายวัน'), opt('1', 'รายพนักงาน'), opt('2', '📍 Log จุดงาน'), opt('3', 'สรุปช่วงเวลา'), opt('4', '🚨 4M Changes')] },
  ],
  '/skills-report': [
    { key: 'tab', label: 'แท็บ', kind: 'select', options: [opt('5', '📊 Skill Matrix'), opt('6', '💰 ค่าฝีมือ'), opt('8', '🏅 Multi-Skill Form')] },
  ],
  '/order-trace': [
    { key: 'tab', label: 'แท็บ', kind: 'select', options: [opt('order', '🔎 จากเลขใบผลิต'), opt('symptom', '🩺 จากอาการ')] },
  ],
});

/** ช่องนี้ควรโชว์ไหม ตามค่าที่ตั้งอยู่ (showIf: { key: [ค่าที่อนุญาต · '' = ยังไม่ตั้ง] }) */
export function paramVisible(def, params) {
  if (!def?.showIf) return true;
  return Object.entries(def.showIf).every(([k, vals]) => (vals === '*' ? !!params?.[k] : vals.includes(params?.[k] ?? '')));
}

/** ค่า query ของ path → object (เฉพาะ ?… ไม่รวม #) */
export function queryParamsOf(path) {
  const m = String(path ?? '').match(/\?([^#]*)/);
  return Object.fromEntries(new URLSearchParams(m ? m[1] : ''));
}

/** ประกอบ path ใหม่จาก base + params (ค่าว่างถูกตัดทิ้ง · คงลำดับคีย์ตามที่ส่ง) */
export function withQueryParams(base, params) {
  const sp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => { if (v != null && String(v).trim() !== '') sp.set(k, String(v).trim()); });
  const q = sp.toString();
  return q ? `${base}?${q}` : base;
}

/** ป้ายสั้นของตัวกรองที่ตั้งไว้ (ใช้บนรายการ/ชิป) — คีย์ที่ไม่อยู่ในทะเบียนโชว์ดิบ */
export function paramSummary(path) {
  const base = pathOnly(path);
  const defs = DISPLAY_PAGE_PARAMS[base] || [];
  return Object.entries(queryParamsOf(path)).map(([k, v]) => {
    const d = defs.find(x => x.key === k);
    const opt = d?.options?.find(o => o.value === v);
    return `${d?.label || k}: ${opt?.label || v}`;
  });
}

/* ── 📖 หน้าภายในของบอร์ด (บอร์ด KPI แบ่ง 2 หน้า) ต้องสลับเองตอนจอวน (15/10 · user: "โหมดจอก็ต้องสลับกลับไปมาได้") ──
   ตัววน (DisplayRotator) บอกไว้ว่าหน้านี้ค้างกี่วินาที ⇒ บอร์ดแบ่งเวลานั้นให้ครบทุกหน้าภายในก่อนจอจะวนต่อ
   · ไม่ได้อยู่ในรอบวน (เปิดโหมดจอเอง) = ใช้ defaultSec · ต่ำสุด BOARD_FLIP_MIN_SEC กันกระพริบ */
export const BOARD_FLIP_MIN_SEC = 12;
let activeDwellSec = null;
export function setActiveDwellSec(sec) {
  const n = Number(sec);
  activeDwellSec = Number.isFinite(n) && n > 0 ? n : null;
}
export const activeDwellSecOf = () => activeDwellSec;
export function boardFlipSec(pages, dwellSec = activeDwellSecOf()) {
  const p = Math.floor(Number(pages) || 0);
  if (p < 2) return null;
  const d = Number.isFinite(Number(dwellSec)) && Number(dwellSec) > 0 ? Number(dwellSec) : ROT_LIMITS.defaultSec;
  return Math.max(BOARD_FLIP_MIN_SEC, Math.floor(d / p));
}
