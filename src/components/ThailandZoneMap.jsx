/* ══ 🗺️ แผนที่โซนในไทย — ภาคกลาง + ตะวันออก (SVG ล้วน ไม่มี dependency/tile ภายนอก) ══════
   ใช้ในหน้า /group-overview ตอนเจาะเข้า "โซนในไทย" (บางนา / ตะวันออก) — ระดับโลกใช้ WorldFactoryMap
   ผู้เรียกส่งเฉพาะโซนที่จะวาดมาให้ (component ไม่กรองเอง)

   หลักการ:
   • ทุกอย่างวางด้วย "พิกัดจริง (lat/lon)" แล้ว project แบบ equirectangular → viewBox
     เส้นชายฝั่งอ่าวไทยตอนบน/แม่น้ำ/ถนนสายหลัก ใช้พิกัดจริง แผนที่จึงดูออกว่าเป็นภาคกลาง-ตะวันออก
   • กรอบโซนคำนวณจาก "หมุดของโซนนั้น + padding" (rounded rect) — ไม่ hardcode ตำแหน่งกรอบ
     ⇒ เพิ่ม/ย้ายโรงงานแล้วกรอบโซนขยับตามเอง ไม่มีทางหลุดกรอบ
   • หมุด = วงกลม + ป้ายชื่อใต้ (ตาม UI-CONVENTIONS §1 — ห้ามเป็นกล่องเหลี่ยม) สีตามสถานะ
     Andon: แดง/เหลือง/เขียว แบบ "นิ่ง" (ไม่กระพริบ — กระพริบสงวนให้ downtime ค้างจริงเท่านั้น §2)
   • มือถือ: เลื่อนแนวนอนได้ (minWidth) เหมือนข้อยกเว้นบอร์ดเวลา §6 — ไม่บีบจนป้ายอ่านไม่ออก
   ═════════════════════════════════════════════════════════════════════════════════════════ */

import { useState } from 'react';

/* กรอบแผนที่ (lon/lat) + สเกล → viewBox 1000 × H
   ซูมไว้ที่ "แนวโรงงานจริง" (สมุทรปราการ → ระยอง) ไม่กินพื้นที่ว่างทางเหนือ */
const B = { lon0: 99.90, lon1: 102.15, lat0: 12.42, lat1: 14.15 };
const S = 1000 / (B.lon1 - B.lon0);
const H = Math.round((B.lat1 - B.lat0) * S);
const px = (lon) => +((lon - B.lon0) * S).toFixed(1);
const py = (lat) => +((B.lat1 - lat) * S).toFixed(1);
const pts = (arr) => arr.map(([lo, la]) => `${px(lo)},${py(la)}`).join(' ');

/* เส้นชายฝั่งอ่าวไทยตอนบน (พิกัดจริงโดยประมาณ) — ฝั่งตะวันตกขึ้นเหนือ → ก้นอ่าว → ฝั่งตะวันออกลงใต้ */
const COAST = [
  [99.95, 12.25], [99.96, 12.60], [99.99, 12.95], [100.02, 13.20], [100.05, 13.36],
  [100.16, 13.44], [100.29, 13.50], [100.42, 13.52], [100.55, 13.55], [100.62, 13.53],
  [100.72, 13.50], [100.83, 13.47], [100.92, 13.42], [100.99, 13.34], [100.97, 13.20],
  [100.89, 13.08], [100.88, 12.93], [100.90, 12.78], [100.94, 12.65], [101.06, 12.71],
  [101.20, 12.66], [101.32, 12.63], [101.55, 12.70], [101.78, 12.62], [102.05, 12.55],
  [102.45, 12.45],
];
/* แผ่นดิน = กรอบทั้งหมด ลบ "รอยหยัก" อ่าวไทยที่เปิดลงด้านล่าง */
const LAND = [
  [B.lon0, B.lat0], ...COAST, [B.lon1, B.lat0], [B.lon1, B.lat1], [B.lon0, B.lat1],
];

const CHAO_PHRAYA = [[100.53, 14.75], [100.49, 14.36], [100.58, 14.05], [100.49, 13.78], [100.53, 13.66], [100.57, 13.52]];
const BANGPAKONG = [[101.35, 14.05], [101.20, 13.85], [101.08, 13.68], [100.99, 13.50], [100.96, 13.42]];
/* ถนนสายหลักที่โรงงานยานยนต์เกาะอยู่ — ให้เห็น "แนวบางนา-ตราด" กับ "แนวมอเตอร์เวย์ลงอีสเทิร์นซีบอร์ด" */
const RD_BANGNA = [[100.60, 13.67], [100.74, 13.61], [100.88, 13.57], [101.02, 13.52], [101.14, 13.47], [101.00, 13.38]];
const RD_MOTORWAY = [[100.63, 13.73], [100.82, 13.55], [100.95, 13.40], [100.94, 13.20], [100.91, 13.02], [101.02, 12.83], [101.22, 12.72], [101.36, 12.68]];

/* เมือง/จังหวัดอ้างอิง — anchor:'end' = วางป้ายไว้ซ้ายจุด (เลี่ยงชนหมุดโรงงานที่อยู่ทางขวา) */
const CITIES = [
  { n: 'กรุงเทพฯ', lat: 13.76, lon: 100.50, big: true, anchor: 'end' },
  { n: 'ปทุมธานี', lat: 14.02, lon: 100.53, anchor: 'end' },
  { n: 'สมุทรสาคร', lat: 13.55, lon: 100.27, anchor: 'end' },
  { n: 'สมุทรปราการ', lat: 13.60, lon: 100.60, anchor: 'end', dy: -12 },
  { n: 'ฉะเชิงเทรา', lat: 13.69, lon: 101.07 },
  { n: 'ปราจีนบุรี', lat: 14.05, lon: 101.37 },
  { n: 'ชลบุรี', lat: 13.36, lon: 100.98, anchor: 'end', dy: 15 },
  { n: 'แหลมฉบัง', lat: 13.10, lon: 100.89, anchor: 'end', dy: -14 },
  { n: 'พัทยา', lat: 12.93, lon: 100.88, anchor: 'end' },
  { n: 'ระยอง', lat: 12.68, lon: 101.28, anchor: 'end', dy: -16 },
];

const statusColor = (s) => s === 'bad' ? '#ef4444' : s === 'ok' ? '#f59e0b' : '#22c55e';
const canHover = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;

export default function ThailandZoneMap({ zones, groups = [], onPickZone, onPickCompany, isMobile, height = 520 }) {
  const [hover, setHover] = useState(null);   // company ที่ชี้อยู่ (เมาส์เท่านั้น)
  const [gFilter, setGFilter] = useState(null); // ไฮไลต์เฉพาะกลุ่มธุรกิจที่เลือก (null = ทุกกลุ่ม)

  // กรอบโซน = bounding box ของหมุดในโซน + padding (คำนวณสด — ไม่มีทางที่หมุดจะหลุดกรอบ)
  const zoneBoxes = zones.filter(z => z.companies.length).map(z => {
    const xs = z.companies.map(c => px(c.lon)), ys = z.companies.map(c => py(c.lat));
    const pad = 46;
    const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
    return { z, x, y, w: (Math.max(...xs) - Math.min(...xs)) + pad * 2, h: (Math.max(...ys) - Math.min(...ys)) + pad * 2 };
  });

  const mapCompanies = zones.flatMap(z => z.companies.map(c => ({ ...c, zone: z })));
  // ส่วนผสมกลุ่มธุรกิจในโซน — ทุกโซนมีหลายกลุ่มคละกัน ต้องอ่านออกจากบนแผนที่เลย
  const mixOf = (z) => groups.map(g => ({ g, n: z.companies.filter(c => c.groupMeta?.key === g.key).length })).filter(m => m.n > 0);

  /* de-overlap ป้ายชื่อหมุด (UI-CONVENTIONS §1.2): โรงงานที่อยู่ใกล้กันจริง (คลัสเตอร์บางนา)
     ป้ายจะทับกันจนอ่านไม่ออก → ไล่ดันป้ายลงทีละแถว แล้วลากเส้นโยงกลับหมุด (ตำแหน่งหมุดไม่ขยับ) */
  const LW = 80, LH = 21;
  const pinLayout = [];
  [...mapCompanies]
    .sort((a, b) => (py(a.lat) - py(b.lat)) || (px(a.lon) - px(b.lon)))
    .forEach(c => {
      const x = px(c.lon), y = py(c.lat), r = c.real ? 15 : 11;
      let ly = y + r + 6;
      for (let i = 0; i < 8; i++) {
        const hit = pinLayout.some(p => Math.abs(p.lx - x) < LW + 4 && Math.abs(p.ly - ly) < LH + 4);
        if (!hit) break;
        ly += LH + 5;
      }
      pinLayout.push({ c, x, y, r, lx: x, ly });
    });

  return (
    <div>
      {/* ฟิลเตอร์กลุ่มธุรกิจ — กดแล้วเห็นว่ากลุ่มนั้นกระจายอยู่โซนไหนบ้าง (คนละแกนกับโซน) */}
      {!!groups.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, alignItems: 'center' }}>
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
                {g.key && <span style={{ marginLeft: 5, opacity: 0.75 }}>
                  {zones.reduce((a, z) => a + z.companies.filter(c => c.groupMeta?.key === g.key).length, 0)}
                </span>}
              </button>
            );
          })}
        </div>
      )}
    <div style={{ position: 'relative', overflowX: isMobile ? 'auto' : 'visible' }}>
      <div style={{ position: 'relative', minWidth: isMobile ? 720 : undefined }}>
        <svg viewBox={`0 0 1000 ${H}`} style={{ width: '100%', height: 'auto', maxHeight: height, display: 'block', borderRadius: 10 }}>
          {/* น้ำ (อ่าวไทย) เป็นพื้นหลัง แล้ววางแผ่นดินทับ */}
          <rect x="0" y="0" width="1000" height={H} fill="#0b2536" />
          <polygon points={pts(LAND)} fill="#1b3021" stroke="#416b4c" strokeWidth="2" />

          {/* แม่น้ำ */}
          <polyline points={pts(CHAO_PHRAYA)} fill="none" stroke="#2b6b8a" strokeWidth="4" strokeLinecap="round" opacity="0.85" />
          <polyline points={pts(BANGPAKONG)} fill="none" stroke="#2b6b8a" strokeWidth="3" strokeLinecap="round" opacity="0.7" />

          {/* ถนนสายหลัก */}
          <polyline points={pts(RD_BANGNA)} fill="none" stroke="#6b7280" strokeWidth="3.5" strokeDasharray="10 7" strokeLinecap="round" opacity="0.75" />
          <polyline points={pts(RD_MOTORWAY)} fill="none" stroke="#6b7280" strokeWidth="3.5" strokeDasharray="10 7" strokeLinecap="round" opacity="0.75" />
          <text x={px(100.86)} y={py(13.60)} fill="#94a3b8" fontSize="13" fontWeight="600">บางนา-ตราด</text>
          <text x={px(100.99)} y={py(12.90)} fill="#94a3b8" fontSize="13" fontWeight="600" transform={`rotate(-58 ${px(100.99)} ${py(12.90)})`}>มอเตอร์เวย์</text>

          {/* ป้ายอ่าวไทย */}
          <text x={px(100.42)} y={py(12.75)} fill="#5b93b0" fontSize="20" fontWeight="700" letterSpacing="3">อ่าวไทย</text>

          {/* จังหวัด/เมือง */}
          {CITIES.map(c => (
            <g key={c.n}>
              <circle cx={px(c.lon)} cy={py(c.lat)} r={c.big ? 5 : 3.5} fill="#94a3b8" opacity="0.85" />
              <text x={px(c.lon) + (c.anchor === 'end' ? -8 : 8)} y={py(c.lat) + 5 + (c.dy || 0)}
                textAnchor={c.anchor === 'end' ? 'end' : 'start'}
                fill="#9fb0c0" fontSize={c.big ? 17 : 14} fontWeight={c.big ? 700 : 500}>{c.n}</text>
            </g>
          ))}

          {/* กรอบโซน (คลิกเข้าโซน) */}
          {zoneBoxes.map(({ z, x, y, w, h }) => (
            <g key={z.key} onClick={() => onPickZone && onPickZone(z)} style={{ cursor: 'pointer' }}>
              <rect x={x} y={y} width={w} height={h} rx="26"
                fill={z.color} fillOpacity="0.12" stroke={z.color} strokeWidth="2.5" strokeDasharray="12 8" />
              <text x={x + 4} y={y - 10} fill={z.color} fontSize="20" fontWeight="800">{z.icon} {z.name}</text>
              <text x={x + 4 + (z.name.length * 11) + 40} y={y - 10} fill="#9fb0c0" fontSize="14" fontWeight="600">
                {z.companies.length} บริษัท · OEE {z.oee == null ? '—' : z.oee + '%'} · {mixOf(z).map(m => `${m.g.icon}${m.n}`).join(' ')}
              </text>
            </g>
          ))}

          {/* หมุดโรงงาน — วงกลม + ป้ายชื่อใต้ (ตาม convention marker) */}
          {pinLayout.map(({ c, x, y, r, lx, ly }) => {
            const col = statusColor(c.status);
            const moved = ly > y + r + 8;
            // จุดที่ไม่เข้าฟิลเตอร์: จาง + ไม่แสดงป้ายชื่อ (UI-CONVENTIONS §1 — ต้องเห็นชัดว่าถูกกรองออก)
            const dim = gFilter && c.groupMeta?.key !== gFilter;
            return (
              <g key={c.key} style={{ cursor: 'pointer' }} opacity={dim ? 0.14 : 1}
                onClick={() => onPickCompany && onPickCompany(c)}
                onMouseEnter={() => !dim && canHover() && setHover(c)}
                onMouseLeave={() => setHover(null)}>
                {/* เส้นโยงเมื่อป้ายถูกดันลง (ตำแหน่งหมุด = พิกัดจริงเสมอ) */}
                {moved && !dim && <line x1={x} y1={y + r} x2={lx} y2={ly} stroke={col} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.8" />}
                {c.real && <circle cx={x} cy={y} r={r + 7} fill="none" stroke="#22c55e" strokeWidth="2" opacity="0.55" />}
                <circle cx={x} cy={y} r={r} fill={col} stroke="#fff" strokeWidth={c.real ? 3.5 : 2.5} />
                {/* ไอคอน = กลุ่มธุรกิจ (ทุกโซนมีหลายกลุ่มคละกัน ต้องดูออกจากหมุดเลย) */}
                <text x={x} y={y + 5} textAnchor="middle" fontSize={c.real ? 15 : 12}>{c.groupMeta?.icon || '🏭'}</text>
                {/* ★ = บริษัทเรา (ข้อมูลจริง) */}
                {c.real && <>
                  <circle cx={x + r - 1} cy={y - r + 1} r="8" fill="#22c55e" stroke="#fff" strokeWidth="1.5" />
                  <text x={x + r - 1} y={y - r + 5} textAnchor="middle" fill="#08120a" fontSize="10" fontWeight="900">★</text>
                </>}
                {/* ป้ายชื่อใต้หมุด */}
                {!dim && (
                  <g transform={`translate(${lx}, ${ly})`}>
                    <rect x={-39} y={0} width={78} height={21} rx="4" fill="rgba(0,0,0,0.82)" stroke={col} strokeWidth="1" />
                    <text x="0" y="15" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="700">{c.code}</text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* การ์ด hover (เมาส์เท่านั้น — จอทัชใช้คลิกเข้าไปดูแทน) */}
        {hover && (
          <div style={{
            position: 'absolute', left: `${px(hover.lon) / 1000 * 100}%`, top: `${py(hover.lat) / H * 100}%`,
            transform: 'translate(-50%, calc(-100% - 26px))', pointerEvents: 'none', zIndex: 5,
            background: 'var(--card)', border: `1px solid ${statusColor(hover.status)}`, borderRadius: 8,
            padding: '8px 11px', minWidth: 190, boxShadow: '0 8px 22px rgba(0,0,0,0.45)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>{hover.flag} {hover.code}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>{hover.name}</div>
            <div style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ color: 'var(--muted)' }}>OEE</span>
              <b style={{ color: statusColor(hover.status) }}>{hover.oee == null ? '—' : hover.oee + '%'}</b>
            </div>
            <div style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ color: 'var(--muted)' }}>ผลิต/เป้า</span>
              <b>{Math.round(hover.actual).toLocaleString('en-US')}/{Math.round(hover.target).toLocaleString('en-US')}</b>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>คลิกเพื่อดูรายไลน์</div>
          </div>
        )}
      </div>

      {/* legend — สีหมุด = สถานะ · ไอคอนในหมุด = กลุ่มธุรกิจ (2 มิติในหมุดเดียว) */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
        <span><b>สี:</b> <b style={{ color: '#22c55e' }}>●</b> ตามเป้า <b style={{ color: '#f59e0b' }}>●</b> เฝ้าระวัง <b style={{ color: '#ef4444' }}>●</b> ต้องแก้</span>
        <span><b>ไอคอน:</b> {groups.map(g => `${g.icon} ${g.short}`).join(' · ')}</span>
        <span>★ = บริษัทเรา (ข้อมูลจริง)</span>
        <span>คลิกหมุด = ดูรายไลน์ · คลิกกรอบโซน = ดูบริษัทในโซน</span>
      </div>
    </div>
    </div>
  );
}
