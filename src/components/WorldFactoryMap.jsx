/* ══ 🌏 แผนที่โรงงานทั่วโลก (World Factory Map) — SVG ล้วน ไม่มี tile/service ภายนอก ══════════
   ใช้ในหน้า /group-overview (mockup ภาพรวมกลุ่มบริษัท TSG)

   • เส้นขอบประเทศมาจาก `worldGeo.js` (generate ครั้งเดียวจาก Natural Earth 110m แล้วฝังไว้)
     — พิกัด project equirectangular ล่วงหน้า ⇒ หมุดวางด้วย lat/lon จริงได้ตรงเป๊ะ
   • 2 ระดับ: ทั้งโลก = 1 บับเบิลต่อประเทศ (ขนาดตามยอดผลิต) → คลิก = ซูมเข้าประเทศ เห็นหมุดรายโรงงาน
   • ซูมด้วยการเลื่อน viewBox (lerp ผ่าน requestAnimationFrame) — ไม่ใช้ lib แผนที่
   • สี = สถานะ Andon (เขียว/เหลือง/แดง) แบบ "นิ่ง" — กระพริบสงวนให้ downtime ค้างจริงเท่านั้น (§2)
   ═════════════════════════════════════════════════════════════════════════════════════════ */

import { useState, useRef, useEffect, useMemo } from 'react';
import { COUNTRIES, lonX, latY } from './worldGeo';

/* กรอบเริ่มต้น: ครอบทุกภูมิภาคที่มีโรงงาน (อเมริกา → เอเชีย) + เผื่อบริบท */
const VIEW0 = (() => {
  const x0 = lonX(-128), x1 = lonX(128), y0 = latY(62), y1 = latY(-38);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
})();

const statusColor = (s) => s === 'bad' ? '#ef4444' : s === 'ok' ? '#f59e0b' : '#22c55e';
const canHover = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;
const fmt = (n) => Math.round(n || 0).toLocaleString('en-US');

export default function WorldFactoryMap({
  comps = [], countries = [], groups = [], onPickCompany, isMobile, height = 560,
}) {
  const [zoomCc, setZoomCc] = useState(null);       // ประเทศที่ซูมอยู่ (null = ทั้งโลก)
  const [gFilter, setGFilter] = useState(null);     // ไฮไลต์เฉพาะกลุ่มธุรกิจ
  const [hover, setHover] = useState(null);         // { kind:'country'|'plant', ... }
  const [view, setView] = useState(VIEW0);          // viewBox ปัจจุบัน (animate)
  const raf = useRef(0);

  /* รวมยอดต่อประเทศ (ระดับโลก) */
  const byCc = useMemo(() => {
    const m = {};
    comps.forEach(c => {
      const o = m[c.cc] || (m[c.cc] = {
        cc: c.cc, meta: countries.find(x => x.cc === c.cc) || { cc: c.cc, name: c.cc, flag: '🏳️' },
        list: [], actual: 0, target: 0, dtMin: 0, ng: 0, oeeW: 0, oeeWSum: 0,
      });
      o.list.push(c);
      o.actual += c.actual; o.target += c.target; o.dtMin += c.dtMin; o.ng += c.ng;
      if (c.oee != null) { const w = Math.max(1, c.target || 1); o.oeeW += w; o.oeeWSum += c.oee * w; }
    });
    return Object.values(m).map(o => {
      const oee = o.oeeW > 0 ? +(o.oeeWSum / o.oeeW).toFixed(1) : null;
      const pct = o.target > 0 ? +(o.actual / o.target * 100).toFixed(1) : null;
      const xs = o.list.map(c => lonX(c.lon)), ys = o.list.map(c => latY(c.lat));
      return {
        ...o, oee, pct,
        x: xs.reduce((a, v) => a + v, 0) / xs.length,
        y: ys.reduce((a, v) => a + v, 0) / ys.length,
        status: (pct != null && pct < 80) || (oee != null && oee < 65) ? 'bad'
          : (pct != null && pct < 95) || (oee != null && oee < 80) ? 'ok' : 'good',
      };
    }).sort((a, b) => b.actual - a.actual);
  }, [comps, countries]);

  const maxActual = Math.max(1, ...byCc.map(c => c.actual));
  const hasGeo = useMemo(() => new Set(countries.map(c => c.geoName)), [countries]);

  /* ── ซูม: lerp viewBox ให้ลื่น (ไม่ใช้ lib) ── */
  const animateTo = (to) => {
    cancelAnimationFrame(raf.current);
    const from = view, t0 = performance.now(), dur = 480;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur), k = ease(t);
      setView({
        x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k,
        w: from.w + (to.w - from.w) * k, h: from.h + (to.h - from.h) * k,
      });
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const zoomToCountry = (cc) => {
    const c = byCc.find(o => o.cc === cc); if (!c) return;
    const xs = c.list.map(p => lonX(p.lon)), ys = c.list.map(p => latY(p.lat));
    const pad = 34;
    let x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad;
    let y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    // ขนาดขั้นต่ำ + รักษาสัดส่วนเดิม (ประเทศที่มีโรงเดียวจะได้ไม่ซูมจนไม่เหลือบริบท)
    const ar = VIEW0.w / VIEW0.h;
    let w = Math.max(x1 - x0, 150), h = Math.max(y1 - y0, 150 / ar);
    if (w / h < ar) w = h * ar; else h = w / ar;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    setZoomCc(cc);
    animateTo({ x: cx - w / 2, y: cy - h / 2, w, h });
  };
  const zoomOut = () => { setZoomCc(null); setHover(null); animateTo(VIEW0); };

  const zoomLevel = VIEW0.w / view.w;                 // >1 = ซูมเข้า
  const k = 1 / zoomLevel;                            // ตัวคูณให้ขนาดหมุด/ฟอนต์คงที่บนจอ
  const plants = zoomCc ? comps.filter(c => c.cc === zoomCc) : [];

  /* de-overlap ป้ายหมุดตอนซูมเข้าประเทศ (§1.2) — ดันป้ายลงทีละแถว ตำแหน่งหมุดไม่ขยับ */
  const pinLayout = useMemo(() => {
    const LW = 78 * k, LH = 20 * k, out = [];
    [...plants].sort((a, b) => latY(b.lat) - latY(a.lat) || lonX(a.lon) - lonX(b.lon)).forEach(c => {
      const x = lonX(c.lon), y = latY(c.lat), r = (c.real ? 11 : 8) * k;
      let ly = y + r + 4 * k;
      for (let i = 0; i < 8; i++) {
        if (!out.some(p => Math.abs(p.lx - x) < LW && Math.abs(p.ly - ly) < LH)) break;
        ly += LH + 3 * k;
      }
      out.push({ c, x, y, r, lx: x, ly });
    });
    return out;
  }, [plants, k]);

  /* จัดวางป้ายชื่อประเทศไม่ให้ทับกัน — ประเทศที่ยอดผลิตเยอะได้เลือกที่ก่อน (บน → ล่าง → ไกลออกไป)
     ตัวบับเบิลไม่ขยับ (อยู่พิกัดจริง) ขยับเฉพาะป้าย แล้วลากเส้นโยงกลับเมื่อป้ายถูกดันออกไปไกล */
  const bubbleLayout = useMemo(() => {
    const hit = (a, b) => Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)) < (a.w + b.w) / 2
      && Math.abs((a.y + a.h / 2) - (b.y + b.h / 2)) < (a.h + b.h) / 2;
    const rOf = (c) => (9 + 26 * Math.sqrt(c.actual / maxActual)) / zoomLevel;
    // สิ่งกีดขวางตั้งต้น = ตัวบับเบิลทุกวง (ป้ายต้องไม่ทับวงของประเทศอื่นด้วย ไม่ใช่แค่ป้ายชนป้าย)
    const placed = byCc.map(c => { const r = rOf(c); return { x: c.x - r, y: c.y - r, w: r * 2, h: r * 2 }; });
    return byCc.map(c => {
      const r = rOf(c);
      const w = Math.max(104, (c.meta.name.length + 12) * 7) / zoomLevel;
      const h = 30 / zoomLevel, gap = 7 / zoomLevel;
      const side = r + gap + w / 2;
      const cands = [
        { dx: 0, ly: c.y - r - gap - h },           // เหนือวง
        { dx: 0, ly: c.y + r + gap },               // ใต้วง
        { dx: side, ly: c.y - h / 2 },              // ขวา
        { dx: -side, ly: c.y - h / 2 },             // ซ้าย
        { dx: 0, ly: c.y - r - gap - h * 2.1 },
        { dx: 0, ly: c.y + r + gap + h * 1.1 },
        { dx: side, ly: c.y - r - h * 1.2 },
        { dx: -side, ly: c.y + r + h * 0.2 },
        { dx: 0, ly: c.y - r - gap - h * 3.2 },
        { dx: 0, ly: c.y + r + gap + h * 2.2 },
      ];
      let pick = cands[0];
      for (const cd of cands) {
        const box = { x: c.x + cd.dx - w / 2, y: cd.ly, w, h };
        if (!placed.some(p => hit(p, box))) { pick = cd; break; }
      }
      placed.push({ x: c.x + pick.dx - w / 2, y: pick.ly, w, h });
      return { c, r, lx: c.x + pick.dx, ly: pick.ly, h, w };
    });
  }, [byCc, maxActual, zoomLevel]);

  const vb = `${view.x.toFixed(1)} ${view.y.toFixed(1)} ${view.w.toFixed(1)} ${view.h.toFixed(1)}`;
  const pctOf = (v, lo, hi) => `${((v - lo) / (hi - lo) * 100).toFixed(2)}%`;

  return (
    <div>
      {/* แถบควบคุม: กลับทั้งโลก · ชิปประเทศ · ไฮไลต์กลุ่มธุรกิจ */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 8 }}>
        <button onClick={zoomOut} style={{
          fontSize: 12.5, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
          background: zoomCc ? 'var(--bg3)' : 'var(--accent)', color: zoomCc ? 'var(--text)' : '#08120a',
          border: `1px solid ${zoomCc ? 'var(--border2)' : 'var(--accent)'}`,
        }}>🌏 ทั้งโลก</button>
        {byCc.map(c => (
          <button key={c.cc} onClick={() => zoomToCountry(c.cc)} style={{
            fontSize: 12.5, fontWeight: 700, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
            background: zoomCc === c.cc ? 'var(--accent)' : 'var(--bg3)',
            color: zoomCc === c.cc ? '#08120a' : 'var(--text)',
            border: `1px solid ${zoomCc === c.cc ? 'var(--accent)' : 'var(--border2)'}`,
          }}>
            {c.meta.flag} {c.meta.name}
            <span style={{ marginLeft: 5, opacity: 0.75 }}>{c.list.length}</span>
          </button>
        ))}
      </div>
      {!!groups.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>ไฮไลต์กลุ่มธุรกิจ:</span>
          {[{ key: null, icon: '🏢', short: 'ทุกกลุ่ม' }, ...groups].map(g => {
            const on = gFilter === g.key;
            return (
              <button key={g.key || 'all'} onClick={() => setGFilter(g.key)} style={{
                fontSize: 12.5, fontWeight: 700, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
                background: on ? 'var(--accent)' : 'var(--bg3)', color: on ? '#08120a' : 'var(--text)',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border2)'}`,
              }}>
                {g.icon} {g.short}
                {g.key && <span style={{ marginLeft: 5, opacity: 0.75 }}>{comps.filter(c => c.groupMeta?.key === g.key).length}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <svg viewBox={vb} preserveAspectRatio="xMidYMid meet"
          style={{ width: '100%', height: 'auto', maxHeight: height, display: 'block', background: '#071322' }}>
          <defs>
            <radialGradient id="wf-ocean" cx="50%" cy="42%" r="75%">
              <stop offset="0%" stopColor="#0d2136" /><stop offset="100%" stopColor="#050d18" />
            </radialGradient>
            <filter id="wf-glow" x="-70%" y="-70%" width="240%" height="240%">
              <feGaussianBlur stdDeviation={2.4 / k} result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* มหาสมุทร */}
          <rect x="-200" y="-200" width="2600" height="1500" fill="url(#wf-ocean)" />

          {/* เส้นละติจูด/ลองจิจูด จางๆ ให้รู้ว่าเป็นลูกโลก */}
          <g stroke="#12314a" strokeWidth={0.7 / k} opacity="0.55">
            {[-60, -30, 0, 30, 60].map(la => <line key={la} x1="0" y1={latY(la)} x2="2000" y2={latY(la)} />)}
            {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map(lo => <line key={lo} x1={lonX(lo)} y1="0" x2={lonX(lo)} y2="1000" />)}
          </g>

          {/* แผ่นดิน — ประเทศที่มีโรงงานเน้นสีเข้มกว่า + ขอบสว่าง */}
          {COUNTRIES.map(c => {
            const has = hasGeo.has(c.n);
            return <path key={c.n} d={c.d} fill={has ? '#22364a' : '#182534'}
              stroke={has ? '#4d7ea8' : '#243447'} strokeWidth={(has ? 0.9 : 0.5) / k} strokeLinejoin="round" />;
          })}

          {/* ── ระดับโลก: บับเบิลต่อประเทศ (ขนาดตามยอดผลิต) ── */}
          {!zoomCc && bubbleLayout.map(({ c, r, lx, ly, h, w }) => {
            const col = statusColor(c.status);
            const nInG = gFilter ? c.list.filter(p => p.groupMeta?.key === gFilter).length : c.list.length;
            const dim = gFilter && nInG === 0;
            // จุดกึ่งกลางป้าย → ลากเส้นโยงกลับขอบวงเมื่ออยู่ห่าง (ตัววงอยู่พิกัดจริงเสมอ)
            const cxL = lx, cyL = ly + h / 2;
            const dist = Math.hypot(cxL - c.x, cyL - c.y);
            const far = dist > r + 14 / zoomLevel;
            const ux = (cxL - c.x) / (dist || 1), uy = (cyL - c.y) / (dist || 1);
            return (
              <g key={c.cc} style={{ cursor: 'pointer' }} opacity={dim ? 0.18 : 1}
                onClick={() => zoomToCountry(c.cc)}
                onMouseEnter={() => canHover() && setHover({ kind: 'country', c })}
                onMouseLeave={() => setHover(null)}>
                {far && <line x1={c.x + ux * r} y1={c.y + uy * r} x2={cxL - ux * (w * 0.18)} y2={cyL - uy * (h * 0.4)}
                  stroke={col} strokeWidth={1.1 / k} strokeDasharray={`${3 / k} ${2.5 / k}`} opacity="0.75" />}
                <circle cx={c.x} cy={c.y} r={r} fill={col} fillOpacity="0.28" filter="url(#wf-glow)" />
                <circle cx={c.x} cy={c.y} r={r} fill="none" stroke={col} strokeWidth={1.8 / k} />
                <circle cx={c.x} cy={c.y} r={Math.max(2.2 / k, r * 0.22)} fill={col} />
                <text x={lx} y={ly + 12 / k} textAnchor="middle" fill="#e2e8f0"
                  fontSize={13 / k} fontWeight="800" style={{ paintOrder: 'stroke', stroke: '#050d18', strokeWidth: 3.4 / k }}>
                  {c.meta.flag} {c.meta.name}
                </text>
                <text x={lx} y={ly + 26 / k} textAnchor="middle" fill={col}
                  fontSize={12 / k} fontWeight="700" style={{ paintOrder: 'stroke', stroke: '#050d18', strokeWidth: 3.4 / k }}>
                  {c.list.length} โรง · {fmt(c.actual)} ชิ้น
                </text>
              </g>
            );
          })}

          {/* ── ซูมเข้าประเทศ: หมุดรายโรงงาน ── */}
          {zoomCc && pinLayout.map(({ c, x, y, r, lx, ly }) => {
            const col = statusColor(c.status);
            const dim = gFilter && c.groupMeta?.key !== gFilter;
            const moved = ly > y + r + 6 * k;
            return (
              <g key={c.key} style={{ cursor: 'pointer' }} opacity={dim ? 0.15 : 1}
                onClick={() => onPickCompany && onPickCompany(c)}
                onMouseEnter={() => !dim && canHover() && setHover({ kind: 'plant', c })}
                onMouseLeave={() => setHover(null)}>
                {moved && !dim && <line x1={x} y1={y + r} x2={lx} y2={ly} stroke={col} strokeWidth={1.2 * k} strokeDasharray={`${3 * k} ${2.5 * k}`} opacity="0.85" />}
                <circle cx={x} cy={y} r={r * 2.1} fill={col} fillOpacity="0.16" filter="url(#wf-glow)" />
                {c.real && <circle cx={x} cy={y} r={r + 5 * k} fill="none" stroke="#22c55e" strokeWidth={1.6 * k} opacity="0.6" />}
                <circle cx={x} cy={y} r={r} fill={col} stroke="#fff" strokeWidth={(c.real ? 2.6 : 2) * k} />
                <text x={x} y={y + 3.6 * k} textAnchor="middle" fontSize={11 * k}>{c.groupMeta?.icon || '🏭'}</text>
                {c.real && <>
                  <circle cx={x + r} cy={y - r} r={6 * k} fill="#22c55e" stroke="#fff" strokeWidth={1.2 * k} />
                  <text x={x + r} y={y - r + 3 * k} textAnchor="middle" fill="#08120a" fontSize={8 * k} fontWeight="900">★</text>
                </>}
                {!dim && (
                  <g transform={`translate(${lx}, ${ly})`}>
                    <rect x={-38 * k} y="0" width={76 * k} height={19 * k} rx={4 * k} fill="rgba(0,0,0,0.85)" stroke={col} strokeWidth={0.9 * k} />
                    <text x="0" y={13.5 * k} textAnchor="middle" fill="#fff" fontSize={12 * k} fontWeight="700">{c.code}</text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* การ์ด hover (เมาส์เท่านั้น — จอทัชใช้คลิกแทน) */}
        {hover && (() => {
          const o = hover.kind === 'country' ? hover.c : hover.c;
          const gx = hover.kind === 'country' ? o.x : lonX(o.lon);
          const gy = hover.kind === 'country' ? o.y : latY(o.lat);
          const left = pctOf(gx, view.x, view.x + view.w), top = pctOf(gy, view.y, view.y + view.h);
          const col = statusColor(o.status);
          return (
            <div style={{
              position: 'absolute', left, top, transform: 'translate(-50%, calc(-100% - 22px))',
              pointerEvents: 'none', zIndex: 5, background: 'var(--card)', border: `1px solid ${col}`,
              borderRadius: 8, padding: '8px 11px', minWidth: 196, boxShadow: '0 10px 26px rgba(0,0,0,0.5)',
            }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>
                {hover.kind === 'country' ? `${o.meta.flag} ${o.meta.name}` : `${o.flag} ${o.code}`}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>
                {hover.kind === 'country' ? `${o.list.length} โรงงาน` : `${o.groupMeta?.icon} ${o.groupMeta?.short} · ${o.region}`}
              </div>
              {[['OEE', o.oee == null ? '—' : o.oee + '%', col],
              ['ผลิต/เป้า', `${fmt(o.actual)}/${fmt(o.target)}`, 'var(--text)'],
              ['Downtime', `${fmt(o.dtMin)} น.`, o.dtMin > 0 ? '#f59e0b' : 'var(--text)'],
              ['ของเสีย', `${fmt(o.ng)} ชิ้น`, o.ng > 0 ? '#ef4444' : 'var(--text)']].map(([l, v, c2]) => (
                <div key={l} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: 'var(--muted)' }}>{l}</span><b style={{ color: c2 }}>{v}</b>
                </div>
              ))}
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                {hover.kind === 'country' ? 'คลิกเพื่อซูมเข้าประเทศนี้' : 'คลิกเพื่อเลือกทางเข้า'}
              </div>
            </div>
          );
        })()}

        {/* ป้ายบอกระดับที่กำลังดู */}
        <div style={{
          position: 'absolute', left: 10, top: 10, fontSize: 12, fontWeight: 700,
          background: 'rgba(5,13,24,0.78)', border: '1px solid var(--border2)', borderRadius: 8, padding: '5px 10px', color: 'var(--text)',
        }}>
          {zoomCc ? `${byCc.find(c => c.cc === zoomCc)?.meta.flag} ${byCc.find(c => c.cc === zoomCc)?.meta.name} · ${plants.length} โรงงาน` : `🌏 ทั้งโลก · ${comps.length} โรงงาน · ${byCc.length} ประเทศ`}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
        <span><b>ขนาดวง</b> = ยอดผลิตของวันนั้น</span>
        <span><b>สี:</b> <b style={{ color: '#22c55e' }}>●</b> ตามเป้า <b style={{ color: '#f59e0b' }}>●</b> เฝ้าระวัง <b style={{ color: '#ef4444' }}>●</b> ต้องแก้</span>
        {!!groups.length && <span><b>ไอคอนในหมุด:</b> {groups.map(g => `${g.icon} ${g.short}`).join(' · ')}</span>}
        <span>★ = บริษัทเรา (ข้อมูลจริง)</span>
        <span>คลิกประเทศ = ซูมเข้า · คลิกหมุด = เลือกทางเข้า</span>
      </div>
    </div>
  );
}
