import { startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { canAccessPage } from '../utils/permissions';
import {
  normalizeConfig, buildPlaylist, stepIndex, indexOfLocation, resolveIndex, shouldReload,
  displayChannelName, parseDisplayCmd, ROT_NAV_STATE, fmtSec, SKIP_REASON_LABEL, markQuietReload,
  setActiveDwellSec, barChips, SUBPAGE_ATTR, SUBPAGE_MAX_EXTRA_SEC, parseSubpage, subpageGate, boardFlipSec,
} from '../utils/displayRotation';
import { tvPages } from '../utils/tvPager';
import { NAV_ITEMS, UserContext } from '../App';
import { getCurrentShift, getWorkDate } from '../utils/workDate';

/* ══ 📺 DisplayRotator — จอวนหน้าเอง ตามแผนของบัญชีที่ login ══════════════════════════
   2026-10-09 · คำสั่ง user: "ตั้งว่าจอ user นี้จะเปิดอะไรวนบ้าง" · ตั้งค่าที่ /display-rotation
   ฝังที่ ProtectedLayout ทุก branch (/tv · หน้า Home · หน้าปกติ) — บัญชีที่ไม่มีแถว = ไม่ทำอะไรเลย (1 คิวรีตอนเข้า)

   พฤติกรรม:
   · เปลี่ยนหน้าแบบ SPA (navigate) ไม่รีโหลด — เบาสุดบนทีวี · ครบ `reload_min` แล้ว **รีโหลดเต็มหน้าตอนเปลี่ยนหน้า**
     (ไม่ตัดกลางหน้า) กันหน่วยความจำค้างสะสมบน webOS/Chromium 94
   · มีคนแตะ/คลิก/กดปุ่ม = **หยุดวนชั่วคราว `pause_sec`** ให้เขาดูต่อ แล้ววนต่อเอง · ปุ่ม ⏸ = หยุดค้างจนกดเล่นต่อ
   · อ่านแผนใหม่ทุกครั้งที่วนครบรอบ — แก้ที่ /display-rotation แล้วจอรับเองไม่ต้องเดินไปรีเฟรช (ไม่ใช้ realtime: 1 แถวเล็ก)
   · หน้าที่บัญชีนี้ไม่มีสิทธิ์ = ข้าม **และเขียนบนชิปว่าข้ามกี่หน้า** (ห้ามข้ามเงียบ)

   ⚠️ ตัววนนี้ **ไม่ยกเว้น auto-logout** — การเปลี่ยนหน้าเองไม่นับเป็น activity
      บัญชีจอควรเป็น role `display` (ยกเว้น idle-logout อยู่แล้ว) · หน้า config เตือนเมื่อบัญชีไม่ใช่ display
   ⚠️ admin ที่จำลองมุมมอง role อื่น (viewAs) = ปิดตัววน (ไม่งั้นจอ admin จะวนหน้าเอง)
   ════════════════════════════════════════════════════════════════════════════════════ */

const PAUSE_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'click'];

/* 🎬 เปลี่ยนหน้าแบบ "กระพริบ" (15/10 · user "สำหรับ tv เป็นกระพริบเพื่อให้สมูทเลยได้มั้ย")
   ม่านสีพื้นเฟดขึ้น → เปลี่ยนหน้าใต้ม่าน → ค้างไว้ให้ข้อมูล/ผังหน้าใหม่ขึ้น + ย่อพอดีจอเสร็จ → เฟดออก
   ⇒ ไม่เห็น "กำลังโหลด..." / หน้ากระโดด / ตัวเลขว่างระหว่างโหลด
   · ม่านเป็น DOM ที่ผูกกับ body (ไม่ใช่ state) — ตัววน remount ตอนข้าม branch (/tv ↔ หน้าอื่น) ม่านต้องไม่หาย
   · pointer-events:none = ไม่บังการแตะ (แตะ = หยุดวน ยังทำงาน) · opacity transition ล้วน รองรับ Chromium 94 */
const VEIL_ID = 'esm-rot-veil';
const VEIL_FADE_MS = 280;
const VEIL_HOLD_MS = 900;
let veilTimer = null;
function veilEl() {
  let v = document.getElementById(VEIL_ID);
  if (!v) {
    v = document.createElement('div');
    v.id = VEIL_ID;
    v.setAttribute('aria-hidden', 'true');
    Object.assign(v.style, {
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0', background: 'var(--bg)',
      opacity: '0', transition: `opacity ${VEIL_FADE_MS}ms ease`, pointerEvents: 'none', zIndex: '2147483000',
    });
    document.body.appendChild(v);
  }
  return v;
}
/** เฟดม่านขึ้น → `go()` → ค้าง → เฟดออก · `keep` = ไม่ต้องเฟดออก (กำลังรีโหลดทั้งหน้า) */
function veilSwap(go, keep = false) {
  const v = veilEl();
  clearTimeout(veilTimer);
  v.style.opacity = '1';
  veilTimer = setTimeout(() => {
    go();
    if (!keep) veilTimer = setTimeout(() => { v.style.opacity = '0'; }, VEIL_HOLD_MS);
  }, VEIL_FADE_MS);
}

export default function DisplayRotator({ userId, role, disabled, shell = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [cfgRow, setCfgRow] = useState(null);   // null = ไม่มีแผน / ยังไม่โหลด
  const [loadErr, setLoadErr] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [idx, setIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [pausedUntil, setPausedUntil] = useState(0);
  const [held, setHeld] = useState(false);       // ⏸ ค้าง (กดเอง)
  const [now, setNow] = useState(() => Date.now());
  const loadedAtRef = useRef(Date.now());
  const subSeenRef = useRef(new Map());          // แถบหน้าย่อยตัวที่ i เห็นหน้าสุดท้ายตอน elapsed เท่าไหร่ (subpageGate)
  const [subWait, setSubWait] = useState(null);  // { page, count } = ครบเวลาแล้วแต่ยังรอหน้าย่อย
  const [fitPage, setFitPage] = useState(null);  // { page, count } = หน้ายาวเกินจอ ⇒ แบ่งเป็นส่วนแล้วหมุน (fit ด้านล่าง)

  /* ── โหลดแผนของบัญชีนี้ (guard stale response — กฎเขียน DB ข้อ 4) ── */
  useEffect(() => {
    if (!userId || disabled) { setCfgRow(null); return undefined; }
    let alive = true;
    (async () => {
      const { data, error } = await supabase.from('display_rotations')
        .select('enabled, items, default_sec, pause_sec, reload_min')
        .eq('user_id', userId).maybeSingle();
      if (!alive) return;
      if (error) {
        // 42P01 = ยังไม่ apply migration → ฟีเจอร์ยังไม่เปิด ไม่รบกวนจอ · อื่นๆ ต้องบอกบนจอ
        setLoadErr(error.code === '42P01' ? null : error.message);
        return;
      }
      setLoadErr(null);
      setCfgRow(data || null);
    })();
    return () => { alive = false; };
  }, [userId, disabled, reloadTick]);

  const cfg = useMemo(() => (cfgRow ? normalizeConfig(cfgRow) : null), [cfgRow]);
  const { playable, skipped } = useMemo(() => (cfg
    ? buildPlaylist(cfg.items, p => canAccessPage(p, role), cfg.defaultSec)
    : { playable: [], skipped: [] }), [cfg, role]);
  const active = !!cfg && cfg.enabled && playable.length > 0 && !disabled;
  const n = playable.length;
  const cur = active ? playable[Math.min(idx, n - 1)] : null;
  /* บอกบอร์ดที่แบ่งหน้าภายในว่าหน้านี้ค้างกี่วิ (boardFlipSec) — ออกจากรอบ = ล้าง */
  useEffect(() => { setActiveDwellSec(active && cur ? cur.sec : null); return () => setActiveDwellSec(null); }, [active, cur]);

  /* ── หน้าเปลี่ยน (ทั้งจากเราและจากคน/รีโมท) → ตำแหน่งในรอบตาม + นับเวลาใหม่ ── */
  useEffect(() => {
    if (!active) return;
    setIdx(prev => Math.min(resolveIndex(playable, prev, location.pathname, location.search), playable.length - 1));
    setElapsed(0);
    subSeenRef.current = new Map();
  }, [active, playable, location.pathname, location.search]);

  /* ── เริ่มวน: ถ้าหน้าปัจจุบันไม่อยู่ในรอบ (เช่น เพิ่ง login ลงหน้า Home) → ไปหน้าแรกของรอบ ── */
  const startedRef = useRef(false);
  useEffect(() => {
    if (!active) { startedRef.current = false; return; }
    if (startedRef.current) return;
    startedRef.current = true;
    if (indexOfLocation(playable, location.pathname, location.search) < 0) navigate(playable[0].path, { replace: true, state: { [ROT_NAV_STATE]: `0-${Date.now()}` } });
  }, [active, playable, location.pathname, location.search, navigate]);

  const goTo = useCallback((nextIdx) => {
    if (!active) return;
    const target = playable[nextIdx];
    if (!target) return;
    if (shouldReload(loadedAtRef.current, Date.now(), cfg.reloadMin)) {
      // รีโหลดเต็มหน้าไปยังหน้าถัดไปเลย (ล้างหน่วยความจำ) · ใต้ม่าน + ไม่ขึ้น splash ซ้ำ
      veilSwap(() => { markQuietReload(); window.location.assign(target.path); }, true);
      return;
    }
    setIdx(nextIdx);
    setElapsed(0);
    subSeenRef.current = new Map();
    setSubWait(null);
    // startTransition = ระหว่างโหลดไฟล์หน้าใหม่ (lazy) ค้างหน้าเดิมไว้ ไม่โชว์ "กำลังโหลด..." ของ Suspense
    veilSwap(() => startTransition(() => {
      navigate(target.path, { state: { [ROT_NAV_STATE]: `${nextIdx}-${Date.now()}` } });
    }));
    if (nextIdx === 0) setReloadTick(t => t + 1);   // ครบรอบ = อ่านแผนใหม่
  }, [active, playable, cfg, navigate]);

  /* ── นาฬิกา 1 วิ ── */
  useEffect(() => {
    if (!active && !shell) return undefined;   // กรอบจอ TV ต้องมีนาฬิกาแม้ไม่ได้ตั้งรอบวน
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (!active || held || t < pausedUntil) return;
      setElapsed(e => e + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [active, shell, held, pausedUntil]);

  /* 📖 ครบเวลาแล้ว แต่บอร์ดยังมีหน้าย่อยที่ยังไม่ได้โชว์ = รอ (เพดาน SUBPAGE_MAX_EXTRA_SEC) — ดู subpageGate */
  useEffect(() => {
    if (!active || !cur) return;
    const pagers = [...document.querySelectorAll(`[${SUBPAGE_ATTR}]`)].map(el => parseSubpage(el.getAttribute(SUBPAGE_ATTR)));
    const gate = subpageGate(pagers, subSeenRef.current, elapsed);
    if (elapsed < cur.sec) { if (subWait) setSubWait(null); return; }
    if (gate.ready || elapsed >= cur.sec + SUBPAGE_MAX_EXTRA_SEC) { goTo(stepIndex(idx, n, 1)); return; }
    if (subWait?.page !== gate.waiting.page || subWait?.count !== gate.waiting.count) setSubWait(gate.waiting);
  }, [active, cur, elapsed, idx, n, goTo, subWait]);

  /* ── มีคนแตะจอ = หยุดชั่วคราว ── */
  const pauseMs = (cfg?.pauseSec || 0) * 1000;
  useEffect(() => {
    if (!active) return undefined;
    const onInput = () => setPausedUntil(Date.now() + pauseMs);
    PAUSE_EVENTS.forEach(e => window.addEventListener(e, onInput, { passive: true, capture: true }));
    return () => PAUSE_EVENTS.forEach(e => window.removeEventListener(e, onInput, { capture: true }));
  }, [active, pauseMs]);

  /* ── 📡 สั่งจอจากหน้าตั้งค่า (14/10 · คำสั่ง user "สั่งจอหน้างานเปลี่ยนหน้าได้จาก user admin") ──
     ช่อง broadcast `esm-display-<user_id>` · presence = บอกว่าตอนนี้อยู่หน้าไหน (หน้าตั้งค่าโชว์ 🟢 ออนไลน์)
     🔴 รับเฉพาะคำสั่งใน DISPLAY_CMDS · goto ได้แค่ "ลำดับในรอบ" — ห้ามเพิ่มคำสั่งพาไป path ใดก็ได้
        (ใครรู้ id ก็ส่งได้ · จำกัดไว้ = ทำได้แค่สลับหน้าที่ admin ส่วนงานตั้งไว้แล้ว) */
  const cmdRef = useRef(null);
  cmdRef.current = (p) => {
    const c = parseDisplayCmd(p, n);
    if (!c) return;
    setPausedUntil(0);
    if (c.type === 'goto') goTo(c.idx);
    else if (c.type === 'next') goTo(stepIndex(idx, n, 1));
    else if (c.type === 'prev') goTo(stepIndex(idx, n, -1));
    else if (c.type === 'hold') setHeld(true);
    else if (c.type === 'resume') setHeld(false);
    else if (c.type === 'reload') window.location.reload();
  };
  const chanRef = useRef(null);
  const presenceRef = useRef(null);
  useEffect(() => {
    if (!active || !userId) return undefined;
    const ch = supabase.channel(displayChannelName(userId), { config: { broadcast: { self: false }, presence: { key: 'screen' } } });
    ch.on('broadcast', { event: 'cmd' }, ({ payload }) => cmdRef.current?.(payload));
    ch.subscribe((st) => {
      if (st !== 'SUBSCRIBED') return;
      chanRef.current = ch;
      ch.track(presenceRef.current).catch(() => {});   // สถานะแรก (effect ข้างล่างอาจยิงก่อนต่อติด)
    });
    return () => { chanRef.current = null; supabase.removeChannel(ch); };
  }, [active, userId]);
  const curPath = cur?.path || '';
  presenceRef.current = { idx: Math.min(idx, Math.max(0, n - 1)), n, path: curPath, held, at: Date.now() };
  useEffect(() => {
    chanRef.current?.track(presenceRef.current).catch(() => {});
  }, [idx, n, curPath, held]);

  /* ── 🖥️ พอดีจอ (15/10 · user: "พอเปิดจอวน tv ไม่ควรมี overflow") ──
     จอแขวนไม่มีใครเลื่อน ⇒ ของที่ล้นลงล่าง = ไม่มีใครเห็น · ย่อทั้งหน้า (CSS zoom ที่ <main>) ให้สูงพอดีจอ
     · zoom (ไม่ใช่ transform) = layout คิดความกว้างใหม่ให้เต็มจอเอง ไม่เหลือขอบว่างด้านขวา · Chromium 94 รองรับ
     · วัดซ้ำทุก 1.5 วิ (ข้อมูลโหลดทีหลัง/สลับมุมมอง) · เปลี่ยน < 2% ไม่ขยับ (กันจอสั่น) · ย่อสุด 55%
     · ปิด scrollbar ของทั้งหน้าระหว่างวน · ออกจากโหมดวน = คืนค่าเดิมทั้งหมด
     · หน้า /tv ไม่มี <main> (เต็มจออยู่แล้ว) = ไม่แตะ */
  const pathKey = `${location.pathname}${location.search}`;
  useEffect(() => {
    if (!active) return undefined;
    const html = document.documentElement;
    const prev = { h: html.style.overflow, b: document.body.style.overflow };
    html.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    let zoom = 1;
    /* 📐 20/10 (user "scale ของ UX/UI ให้สวยเหมือนกัน" — หน้า OEE แนวโน้มถูกย่อถึง 55% ตัวหนังสือ ~7px)
       ย่อได้ไม่ต่ำกว่า FIT_FLOOR · ย่อถึงพื้นแล้วยังล้น = **แบ่งเป็นส่วนตามขอบการ์ดแล้วหมุน** (tvPages · ซ้อน 48px ถ้าการ์ดเดียวสูงเกินจอ)
       เลื่อนด้วย body.scrollTop (html/body สูง 100% + overflow hidden ⇒ body คือกล่องที่เลื่อน · px ของ body ไม่ถูก zoom = ตรงกันทุกเบราว์เซอร์) · ตำแหน่งการ์ดคิดเป็น "สัดส่วนของ main"
       (rect ใต้ zoom ของ Cr94 = ก่อนย่อ · Cr ใหม่ = หลังย่อ — สัดส่วนเท่ากันทั้งคู่) × ความสูงจริงจาก scrollHeight ของเอกสาร
       แถบบนเขียน "ส่วน n/N" + data-tv-subpage ⇒ ตัววนรอจนครบทุกส่วน (subpageGate) */
    const FIT_FLOOR = 0.8;
    let pages = null;
    let pg = 0;
    let onPage = 0;
    const measurePages = (m, avail, barH) => {
      const root = m.querySelector('.page-content') || m;
      const mr = m.getBoundingClientRect();
      const hVis = Math.max(1, document.body.scrollHeight - barH);
      const toVis = y => ((y - mr.top) / Math.max(1, mr.height)) * hVis;
      const items = [];
      [...root.children].forEach((b) => {
        const r = b.getBoundingClientRect();
        if (!r.height) return;
        const top = toVis(r.top), bottom = toVis(r.bottom);
        if (bottom - top > avail && b.children.length > 1) {
          [...b.children].forEach((c) => {
            const rc = c.getBoundingClientRect();
            if (rc.height) items.push({ top: toVis(rc.top), bottom: toVis(rc.bottom) });
          });
        } else items.push({ top, bottom });
      });
      const ps = tvPages(items, avail);
      return ps.length > 1 ? ps : null;
    };
    const showPage = () => {
      const p = pages?.[pg];
      document.body.scrollTop = p ? Math.max(0, p.start - 8) : 0;
      setFitPage(pages ? { page: pg + 1, count: pages.length } : null);
    };
    const fit = () => {
      const m = document.querySelector('main');
      if (!m) return;
      /* หน้าที่มี 3D (CSS perspective/preserve-3d) หรือ canvas — Chromium 94 คิดพิกัดใต้ zoom ผิด
         (ผัง 3D ยุบไปมุมซ้ายบน · รูปจากจอจริง 16/10) ⇒ ไม่ย่อ · หน้าพวกนี้คุมความสูงเอง */
      if (m.querySelector('[data-tv-nofit], canvas')) {
        if (zoom !== 1) { zoom = 1; m.style.zoom = ''; }
        if (pages) { pages = null; pg = 0; showPage(); }
        return;
      }
      /* 🔴 19/10 (จอ TV จริง: "จอค่อยๆ วูมเอ้า" หลังสลับ 3D→2D): เดิมคิด target = zoom × จอ ÷ rect.height
         โดยเชื่อว่า rect "คูณ zoom แล้ว" — จริงบน Chromium 128+ เท่านั้น · **Chromium 94 (webOS) คืน rect
         ของตัวที่ตั้ง zoom เป็นขนาดก่อนย่อ** ⇒ ทุก 1.5 วิ target = zoom × ค่าคงที่ = ย่อซ้อนทบไปเรื่อยๆ จนชน 55%
         (เครื่อง dev เป็น Chromium ใหม่ = ย่อครั้งเดียวแล้วนิ่ง ⇒ จำลองไม่เจอ)
         ⇒ วัด "ความสูงตอนไม่ย่อ" ตรงๆ: ถอด zoom → อ่าน rect → ใส่คืน ในจังหวะเดียว (ไม่มี paint คั่น = จอไม่กระพริบ)
           แล้ว target = จอ ÷ ความสูงนั้น — ไม่คูณ zoom ปัจจุบัน ⇒ ทุกเบราว์เซอร์ได้คำตอบเดียวกัน · ไม่สะสม */
      const prevZoom = m.style.zoom;
      m.style.zoom = '';
      const natural = m.getBoundingClientRect().height + 2;
      m.style.zoom = prevZoom;
      const barH = parseFloat(getComputedStyle(document.body).paddingTop) || 0;   // แถบบนของกรอบจอ TV
      const avail = window.innerHeight - barH;
      // ย่อได้ถึง FIT_FLOOR แล้วพอดี = ย่อ · ไม่พอดี = ไม่ย่อเลย (100%) แล้วแบ่งส่วน — ต้องหมุนอยู่แล้ว ย่อไปก็แค่ตัวเล็กลง
      const fitRatio = avail / Math.max(1, natural);
      const target = fitRatio >= FIT_FLOOR ? Math.min(1, fitRatio) : 1;
      if (Math.abs(target - zoom) >= 0.02) {
        zoom = Math.round(target * 100) / 100;
        m.style.zoom = zoom >= 0.995 ? '' : String(zoom);
      }
      const next = natural * zoom > avail + 4 ? measurePages(m, avail, barH) : null;
      const sig = (ps) => (ps ? ps.map(p => Math.round(p.start)).join(',') : '');
      if (sig(next) !== sig(pages)) {
        pages = next;
        if (!pages || pg >= pages.length) { pg = 0; onPage = 0; }
        showPage();
      }
    };
    const t0 = setTimeout(fit, 300);
    const id = setInterval(fit, 1500);
    // หมุนส่วน — จังหวะเดียวกับบอร์ดที่แบ่งหน้าเอง (boardFlipSec) · ตัววนรอจนครบผ่าน data-tv-subpage
    const flip = setInterval(() => {
      if (!pages) return;
      onPage += 1;
      if (onPage < (boardFlipSec(pages.length) || 12)) return;
      onPage = 0;
      pg = (pg + 1) % pages.length;
      showPage();
    }, 1000);
    return () => {
      clearTimeout(t0); clearInterval(id); clearInterval(flip);
      const m = document.querySelector('main');
      if (m) m.style.zoom = '';
      document.body.scrollTop = 0;
      setFitPage(null);
      html.style.overflow = prev.h;
      document.body.style.overflow = prev.b;
    };
  }, [active, pathKey]);

  /* ชิปหดเล็กหลังเปลี่ยนหน้า 6 วิ (ไม่บังเนื้อหาจอ) · มีคนแตะ/หยุด/ข้ามหน้า = กางเต็ม */
  const [changedAt, setChangedAt] = useState(() => Date.now());
  useEffect(() => { setChangedAt(Date.now()); }, [pathKey]);

  const pausedLeft = Math.max(0, Math.ceil((pausedUntil - now) / 1000));
  const skipTitle = skipped.map(s => `${s.path || '(ว่าง)'} — ${SKIP_REASON_LABEL[s.reason]}`).join('\n');
  // ปุ่มไม่นับเป็น "มีคนใช้จอ" — ตัวฟัง (capture ที่ window) ตั้งหยุดชั่วคราวไปก่อน แล้ว onClick ล้างทิ้ง
  const btn = (label, onClick, title, st = btnStyle) => (
    <button type="button" title={title}
      onClick={() => { onClick(); setPausedUntil(0); }}
      style={st}>{label}</button>
  );

  if (shell) {
    return (
      <TvShellBar
        pathname={location.pathname} search={location.search} now={now}
        loadErr={loadErr} active={active && !!cur}
        idx={Math.min(idx, Math.max(0, n - 1))} n={n} sec={cur?.sec || 0} elapsed={elapsed}
        held={held} pausedLeft={pausedLeft} skipped={skipped} skipTitle={skipTitle} subWait={subWait} fitPage={fitPage}
        controls={active && cur ? (
          <>
            {btn('◀', () => goTo(stepIndex(idx, n, -1)), 'หน้าก่อนหน้า', barBtn)}
            {btn(held ? '▶' : '⏸', () => setHeld(h => !h), held ? 'วนต่อ' : 'หยุดค้างหน้านี้', barBtn)}
            {btn('▶▶', () => goTo(stepIndex(idx, n, 1)), 'หน้าถัดไป', barBtn)}
          </>
        ) : null}
      />
    );
  }

  if (loadErr) {
    return (
      <div style={chipStyle} title={loadErr}>⚠ โหลดรอบจอวนหน้าไม่สำเร็จ — จอจะค้างหน้านี้</div>
    );
  }
  if (!active || !cur) return null;

  const status = held ? '⏸ หยุดอยู่'
    : pausedLeft > 0 ? `⏸ มีคนใช้จอ · วนต่อใน ${fmtSec(pausedLeft)}`
      : subWait ? `รอหน้าย่อย ${subWait.page}/${subWait.count}`
        : `ถัดไปใน ${fmtSec(Math.max(0, cur.sec - elapsed))}`;

  const compact = !held && pausedLeft === 0 && skipped.length === 0 && now - changedAt > 6000;
  if (compact) {
    return (
      <div style={{ ...chipStyle, padding: '3px 9px', opacity: 0.55, gap: 6 }} role="status" aria-live="off"
        title="แตะจอเพื่อหยุดวน / ดูปุ่มควบคุม">
        🔁 {Math.min(idx, n - 1) + 1}/{n} · {fmtSec(Math.max(0, cur.sec - elapsed))}
      </div>
    );
  }

  return (
    <div style={chipStyle} role="status" aria-live="off">
      <span style={{ fontWeight: 800 }}>🔁 จอวนหน้า {Math.min(idx, n - 1) + 1}/{n}</span>
      <span style={{ color: 'var(--muted)' }}>{status}</span>
      {skipped.length > 0 && (
        <span title={skipTitle} style={{ color: 'var(--amber)', fontWeight: 700 }}>
          ⚠ ข้าม {skipped.length} หน้า
        </span>
      )}
      {btn('◀', () => goTo(stepIndex(idx, n, -1)), 'หน้าก่อนหน้า')}
      {btn(held ? '▶' : '⏸', () => setHeld(h => !h), held ? 'วนต่อ' : 'หยุดค้างหน้านี้')}
      {btn('▶▶', () => goTo(stepIndex(idx, n, 1)), 'หน้าถัดไป')}
    </div>
  );
}

/* ══ 📺 แถบบนของกรอบจอ TV — หน้าตาเดียวทุกหน้า (16/10 · user "โหมดจอทีวีหลากหลาย UX มาก คนใช้จะงง") ══
   ซ้าย = จอนี้กำลังโชว์อะไร (ชื่อหน้า + ตัวกรองที่ตั้งจากลิงก์) · ขวา = ส่วนงานของจอ · วันงาน/กะ · นาฬิกา
   ล่างสุดของแถบ = ความคืบหน้ารอบวน (1 ขีด = 1 หน้า · ขีดปัจจุบันเติมตามเวลา)
   แทนที่: หัวเพจ/breadcrumb/แท็บ/แถบกรองของทุกหน้า · ชิปมุมจอ · นาฬิกาที่บางบอร์ดวาดเอง
   ความสูงอยู่ที่ `--tvbar-h` (index.css) — บอร์ดที่เต็มจอแบบ fixed ต้องเริ่มที่ top: var(--tvbar-h, 0px) */
function TvShellBar({ pathname, search, now, loadErr, active, idx, n, sec, elapsed, held, pausedLeft, skipped, skipTitle, subWait, fitPage, controls }) {
  const { sections, section } = useContext(UserContext) || {};
  const secs = (sections?.length ? sections : (section ? [section] : [])).filter(Boolean);
  const nav = pathname === '/tv'
    ? { icon: '📺', label: 'Andon Board' }
    : NAV_ITEMS.find(x => x.to === pathname) || { icon: '🖥️', label: pathname };
  const chips = barChips(`${pathname}${search || ''}`);
  const d = new Date(now);
  const shift = getCurrentShift(d) === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก';
  const hhmm = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' });
  const wd = getWorkDate(d);
  const status = !active ? null
    : held ? '⏸ หยุดค้าง'
      : pausedLeft > 0 ? `⏸ มีคนใช้จอ · วนต่อใน ${fmtSec(pausedLeft)}`
        : subWait ? `รอหน้าย่อย ${subWait.page}/${subWait.count}`
          : `ถัดไปใน ${fmtSec(Math.max(0, sec - elapsed))}`;
  return (
    <div role="banner" style={barStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1, overflow: 'hidden' }}>
        <span style={{ fontSize: 20, lineHeight: 1 }}>{nav.icon}</span>
        <span style={{ fontSize: 21, fontWeight: 900, fontFamily: 'var(--font-display)', whiteSpace: 'nowrap' }}>{nav.label}</span>
        {chips.map(c => (
          <span key={c} style={barChip}>{c}</span>
        ))}
        {/* 📐 หน้ายาวเกินจอ ⇒ แบ่งส่วนหมุน (fit) — data-tv-subpage ให้ตัววนรอจนครบทุกส่วน */}
        {fitPage && (
          <span {...{ [SUBPAGE_ATTR]: `${fitPage.page}/${fitPage.count}` }} style={{ ...barChip, color: 'var(--accent)', borderColor: 'var(--accent)' }}>
            ส่วน {fitPage.page}/{fitPage.count}
          </span>
        )}
      </div>
      {loadErr && (
        <span title={loadErr} style={{ fontSize: 16, fontWeight: 700, color: 'var(--amber)', whiteSpace: 'nowrap' }}>⚠ โหลดรอบวนไม่สำเร็จ — ค้างหน้านี้</span>
      )}
      {active && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 16, color: 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            🔁 {idx + 1}/{n} · {status}
          </span>
          {skipped.length > 0 && (
            <span title={skipTitle} style={{ fontSize: 16, color: 'var(--amber)', fontWeight: 700, whiteSpace: 'nowrap' }}>⚠ ข้าม {skipped.length} หน้า</span>
          )}
          {controls}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        {secs.length > 0 && <span style={{ ...barChip, fontWeight: 800, color: 'var(--text)' }}>🏭 {secs.join(' · ')}</span>}
        <span style={{ fontSize: 17, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{shift} · วันงาน {wd}</span>
        <span style={{ fontSize: 26, fontWeight: 900, minWidth: 70, textAlign: 'right' }}>{hhmm}</span>
      </div>
      {active && n > 1 && (
        <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, display: 'flex', gap: 3 }}>
          {Array.from({ length: n }, (_, i) => (
            <div key={i} style={{ flex: 1, background: 'var(--border2)', overflow: 'hidden' }}>
              <div style={{ height: '100%', background: 'var(--accent)',
                width: i < idx ? '100%' : i > idx ? '0%' : `${Math.min(100, (elapsed / Math.max(1, sec)) * 100)}%`,
                transition: i === idx ? 'width 1s linear' : 'none' }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const chipStyle = {
  position: 'fixed', right: 14, bottom: 'calc(14px + var(--mnav-h, 0px))', zIndex: 9990,
  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', maxWidth: '92vw',
  padding: '6px 10px', borderRadius: 999, fontSize: 12,
  background: 'var(--card)', border: '1px solid var(--border2)', color: 'var(--text)',
  boxShadow: 'var(--shadow-float)', opacity: 0.85,
};
/* 📺 แถบบนกรอบจอ TV — ตัวอักษร ≥16px (โหมดจอประชุม 20/10 · UI §6.32 · เดิม 11-12px อ่านไม่ออกจากระยะ 2-3 ม.) */
const barStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, height: 'var(--tvbar-h, 46px)', zIndex: 9990,
  display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px',
  background: 'var(--card)', borderBottom: '1px solid var(--border2)', color: 'var(--text)',
};
const barChip = {
  padding: '2px 12px', borderRadius: 999, fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap',
  background: 'var(--bg2)', border: '1px solid var(--border2)', color: 'var(--text2)',
};
const barBtn = {
  minWidth: 32, height: 30, padding: '0 9px', borderRadius: 999, fontSize: 15, fontWeight: 800, opacity: 0.6,
  cursor: 'pointer', background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border2)',
};
const btnStyle = {
  minWidth: 30, height: 26, padding: '0 8px', borderRadius: 999, fontSize: 12, fontWeight: 800,
  cursor: 'pointer', background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border2)',
};
