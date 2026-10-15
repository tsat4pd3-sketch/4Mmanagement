import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { canAccessPage } from '../utils/permissions';
import {
  normalizeConfig, buildPlaylist, stepIndex, indexOfLocation, resolveIndex, shouldReload,
  displayChannelName, parseDisplayCmd, ROT_NAV_STATE, fmtSec, SKIP_REASON_LABEL, markQuietReload,
} from '../utils/displayRotation';

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

export default function DisplayRotator({ userId, role, disabled }) {
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

  /* 📺 โหมดจอ TV ทุกหน้า (15/10 · user "จอทีวี ให้เป็นโหมดจอ TV (ซ่อนหัวเพจ) ทุกหน้าเลย") — บัญชี role display
     ไม่มีคนกด ⇒ หัวเพจ (ชื่อหน้า · แท็บ · แถบกรอง) = พื้นที่เปล่า · แท็บ/ตัวกรองตั้งจากลิงก์ที่ /display-rotation แทน
     · ตัดสินที่ class บน <body> ที่เดียว → CSS `body.esm-tv-display .ph-chrome` (index.css) — PageHeader ติด class ให้ทุกส่วน
       ยกเว้น `children` (เนื้อหาจริงที่บางหน้าห่อไว้ใน PageHeader ต้องยังเห็น)
     · ไม่ผูกกับว่ามีแผนวนไหม — จอ display ที่ยังไม่ตั้งแผนก็ได้หน้าตาจอ TV · admin จำลองมุมมอง (viewAs) = ไม่ซ่อน */
  const tvChrome = role === 'display' && !disabled;
  useEffect(() => {
    if (!tvChrome) return undefined;
    document.body.classList.add('esm-tv-display');
    return () => document.body.classList.remove('esm-tv-display');
  }, [tvChrome]);

  /* ── หน้าเปลี่ยน (ทั้งจากเราและจากคน/รีโมท) → ตำแหน่งในรอบตาม + นับเวลาใหม่ ── */
  useEffect(() => {
    if (!active) return;
    setIdx(prev => Math.min(resolveIndex(playable, prev, location.pathname, location.search), playable.length - 1));
    setElapsed(0);
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
    // startTransition = ระหว่างโหลดไฟล์หน้าใหม่ (lazy) ค้างหน้าเดิมไว้ ไม่โชว์ "กำลังโหลด..." ของ Suspense
    veilSwap(() => startTransition(() => {
      navigate(target.path, { state: { [ROT_NAV_STATE]: `${nextIdx}-${Date.now()}` } });
    }));
    if (nextIdx === 0) setReloadTick(t => t + 1);   // ครบรอบ = อ่านแผนใหม่
  }, [active, playable, cfg, navigate]);

  /* ── นาฬิกา 1 วิ ── */
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (held || t < pausedUntil) return;
      setElapsed(e => e + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [active, held, pausedUntil]);

  useEffect(() => {
    if (active && cur && elapsed >= cur.sec) goTo(stepIndex(idx, n, 1));
  }, [active, cur, elapsed, idx, n, goTo]);

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
    const fit = () => {
      const m = document.querySelector('main');
      if (!m) return;
      const visual = m.getBoundingClientRect().height + 2;   // ความสูงที่เห็นจริง (คูณ zoom แล้ว)
      const target = Math.max(0.55, Math.min(1, (zoom * window.innerHeight) / Math.max(1, visual)));
      if (Math.abs(target - zoom) < 0.02) return;
      zoom = Math.round(target * 100) / 100;
      m.style.zoom = zoom >= 0.995 ? '' : String(zoom);
    };
    const t0 = setTimeout(fit, 300);
    const id = setInterval(fit, 1500);
    return () => {
      clearTimeout(t0); clearInterval(id);
      const m = document.querySelector('main');
      if (m) m.style.zoom = '';
      html.style.overflow = prev.h;
      document.body.style.overflow = prev.b;
    };
  }, [active, pathKey]);

  /* ชิปหดเล็กหลังเปลี่ยนหน้า 6 วิ (ไม่บังเนื้อหาจอ) · มีคนแตะ/หยุด/ข้ามหน้า = กางเต็ม */
  const [changedAt, setChangedAt] = useState(() => Date.now());
  useEffect(() => { setChangedAt(Date.now()); }, [pathKey]);

  if (loadErr) {
    return (
      <div style={chipStyle} title={loadErr}>⚠ โหลดรอบจอวนหน้าไม่สำเร็จ — จอจะค้างหน้านี้</div>
    );
  }
  if (!active || !cur) return null;

  const pausedLeft = Math.max(0, Math.ceil((pausedUntil - now) / 1000));
  const status = held ? '⏸ หยุดอยู่'
    : pausedLeft > 0 ? `⏸ มีคนใช้จอ · วนต่อใน ${fmtSec(pausedLeft)}`
      : `ถัดไปใน ${fmtSec(Math.max(0, cur.sec - elapsed))}`;
  const skipTitle = skipped.map(s => `${s.path || '(ว่าง)'} — ${SKIP_REASON_LABEL[s.reason]}`).join('\n');

  // ปุ่มบนชิปไม่นับเป็น "มีคนใช้จอ" — ตัวฟัง (capture ที่ window) ตั้งหยุดชั่วคราวไปก่อน แล้ว onClick ล้างทิ้ง
  const btn = (label, onClick, title) => (
    <button type="button" title={title}
      onClick={() => { onClick(); setPausedUntil(0); }}
      style={btnStyle}>{label}</button>
  );

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

const chipStyle = {
  position: 'fixed', right: 14, bottom: 'calc(14px + var(--mnav-h, 0px))', zIndex: 9990,
  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', maxWidth: '92vw',
  padding: '6px 10px', borderRadius: 999, fontSize: 12,
  background: 'var(--card)', border: '1px solid var(--border2)', color: 'var(--text)',
  boxShadow: 'var(--shadow-float)', opacity: 0.85,
};
const btnStyle = {
  minWidth: 30, height: 26, padding: '0 8px', borderRadius: 999, fontSize: 12, fontWeight: 800,
  cursor: 'pointer', background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border2)',
};
