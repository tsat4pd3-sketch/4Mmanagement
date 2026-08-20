/**
 * VsmCanvas — วาดแผนผังสายธารคุณค่าเป็น SVG จากโมเดล (`src/lib/vsmModel.js`)
 *
 * สัญลักษณ์ตามมาตรฐานสากล (Learning to See — Rother & Shook) ชุดเดียวกับใบกระดาษของ TSAT
 * ⚠️ สัญลักษณ์ทุกตัวนิยามใน `SYMBOLS` ที่เดียว — legend สร้างจาก registry เดียวกัน
 *    **สัญลักษณ์ที่อยู่ใน legend ต้องถูกวาดจริงบนผังด้วย** (เคยพลาด: legend โฆษณา 15 ตัว
 *    แต่ผังวาดจริง 3 ตัว = legend โกหกคนอ่าน)
 *
 * ⚠️ สีเป็น literal จาก `palette` prop ไม่ใช้ CSS var — เพราะใบพิมพ์ clone `outerHTML`
 *    ของ SVG นี้ไปใช้ตรงๆ (ดู vsmPrint.js) ถ้าใช้ var สีจะหายหมดตอนพิมพ์
 *
 * layout เป็น auto-layout จากโมเดล (ไม่ใช่ลากวางอิสระ) → regenerate แล้วผังจัดใหม่ให้เอง
 * โครง: supplier (ซ้าย) → สายป้อน (บน) + สายหลัก (กลาง) → ลูกค้า (ขวา) · บันไดเวลา (ล่าง)
 */
import { LIVE_STATUS } from '../lib/vsmLive';
import { fmtMct, fmtMinSec } from '../lib/vsmModel';

export const PALETTE_LIGHT = {
  bg: '#ffffff', ink: '#111827', sub: '#4b5563', line: '#374151', faint: '#9ca3af',
  box: '#ffffff', boxHead: '#dbeafe', data: '#f9fafb', inv: '#fde68a', invInk: '#78350f',
  push: '#d1d5db', info: '#1d4ed8', va: '#16a34a', nva: '#dc2626', outsource: '#ede9fe',
  pull: '#0f766e', feed: '#f1f5f9',
};
export const PALETTE_DARK = {
  bg: '#0f1613', ink: '#e5e7eb', sub: '#9ca3af', line: '#6b7280', faint: '#6b7280',
  box: '#18211d', boxHead: '#1e3a5f', data: '#131a17', inv: '#78350f', invInk: '#fde68a',
  push: '#374151', info: '#60a5fa', va: '#22c55e', nva: '#ef4444', outsource: '#3b2f5e',
  pull: '#2dd4bf', feed: '#141c19',
};

/** ทะเบียนสัญลักษณ์ — legend อ่านจากตัวนี้ (ห้ามแยกลิสต์) */
export const SYMBOLS = [
  { key: 'factory',  label: 'ผู้ส่งมอบ / ลูกค้า (Outside source)' },
  { key: 'process',  label: 'กระบวนการผลิต (Process)' },
  { key: 'data',     label: 'กล่องข้อมูล (Data box)' },
  { key: 'inv',      label: 'คงคลัง (Inventory)' },
  { key: 'truck',    label: 'การขนส่ง (Shipment)' },
  { key: 'push',     label: 'การไหลแบบผลัก (Push arrow)' },
  { key: 'pull',     label: 'การดึงจากซูเปอร์มาร์เก็ต (Withdrawal)' },
  { key: 'super',    label: 'ซูเปอร์มาร์เก็ต (Supermarket)' },
  { key: 'kanbanP',  label: 'คัมบังสั่งผลิต (Production kanban)' },
  { key: 'kanbanW',  label: 'คัมบังเบิกถอน (Withdrawal kanban)' },
  { key: 'post',     label: 'จุดแขวนคัมบัง (Kanban post)' },
  { key: 'infoE',    label: 'ข้อมูลอิเล็กทรอนิกส์ (Electronic info)' },
  { key: 'infoM',    label: 'ข้อมูลด้วยมือ (Manual info)' },
  { key: 'operator', label: 'พนักงาน (Operator)' },
  { key: 'ladder',   label: 'บันไดเวลา (Timeline: VA / NVA)' },
];

/* ── สัญลักษณ์เดี่ยว (วาดที่ 0,0 กรอบ ~32×26) ─────────────────────────────── */
export function Symbol({ k, P, scale = 1 }) {
  const s = { fill: 'none', stroke: P.line, strokeWidth: 1.2 };
  const g = c => <g transform={`scale(${scale})`}>{c}</g>;
  switch (k) {
    case 'factory': return g(<>
      <path d="M1 20 L1 9 L9 14 L9 9 L17 14 L17 9 L25 14 L25 20 Z" {...s} fill={P.box} />
      <path d="M1 20 L25 20" {...s} />
    </>);
    case 'process': return g(<rect x="1" y="6" width="30" height="14" rx="1.5" {...s} fill={P.box} />);
    case 'data': return g(<><rect x="1" y="6" width="30" height="14" {...s} fill={P.data} />
      <path d="M1 11 L31 11" {...s} strokeWidth="0.7" /></>);
    case 'inv': return g(<><path d="M13 5 L25 21 L1 21 Z" {...s} fill={P.inv} />
      <text x="13" y="19" fontSize="7" fill={P.invInk} textAnchor="middle" fontWeight="700">I</text></>);
    case 'truck': return g(<><rect x="1" y="9" width="15" height="9" {...s} fill={P.box} />
      <path d="M16 12 L23 12 L26 16 L26 18 L16 18 Z" {...s} fill={P.box} />
      <circle cx="7" cy="19.5" r="2" {...s} /><circle cx="21" cy="19.5" r="2" {...s} /></>);
    case 'push': return g(<><path d="M1 13 L22 13" {...s} strokeWidth="5" stroke={P.push} />
      <path d="M22 9 L30 13 L22 17 Z" fill={P.push} stroke={P.line} strokeWidth="1" /></>);
    case 'pull': return g(<><circle cx="9" cy="13" r="6" {...s} stroke={P.pull} />
      <path d="M15 13 L28 13" {...s} stroke={P.pull} /><path d="M24 10 L28 13 L24 16" {...s} stroke={P.pull} /></>);
    case 'super': return g(<><rect x="1" y="7" width="30" height="12" {...s} fill={P.box} />
      <path d="M1 11 L31 11 M11 11 L11 19 M21 11 L21 19" {...s} strokeWidth="0.8" /></>);
    case 'kanbanP': return g(<><rect x="4" y="7" width="20" height="13" {...s} fill={P.box} />
      <path d="M4 7 L14 13 L24 7" {...s} strokeWidth="0.8" />
      <text x="14" y="18" fontSize="7" fill={P.sub} textAnchor="middle">P</text></>);
    case 'kanbanW': return g(<><rect x="4" y="7" width="20" height="13" {...s} fill={P.box} />
      <path d="M4 7 L14 13 L24 7" {...s} strokeWidth="0.8" />
      <text x="14" y="18" fontSize="7" fill={P.sub} textAnchor="middle">W</text></>);
    case 'post': return g(<><path d="M6 20 L6 8 L26 8" {...s} />
      <rect x="17" y="8" width="9" height="7" {...s} fill={P.box} /></>);
    case 'infoE': return g(<path d="M1 17 L8 9 L14 15 L21 7 L30 13" {...s} stroke={P.info} />);
    case 'infoM': return g(<><path d="M1 13 L27 13" {...s} stroke={P.info} />
      <path d="M23 10 L27 13 L23 16" {...s} stroke={P.info} /></>);
    case 'operator': return g(<><circle cx="14" cy="10" r="3.5" {...s} fill={P.box} />
      <path d="M8 20 A6 6 0 0 1 20 20 Z" {...s} fill={P.box} /></>);
    case 'ladder': return g(<path d="M1 9 L9 9 L9 18 L17 18 L17 9 L25 9 L25 18 L31 18" {...s} />);
    default: return null;
  }
}

/* ── ค่าคงที่ layout ──────────────────────────────────────────────────────── */
const COL_W = 212, BOX_W = 162, BOX_H = 56, DATA_H = 104;
const FACT_W = 140, FACT_H = 58;
const PLAN_W = 210, PLAN_H = 74;
const PAD_L = 214, PAD_R = 214;
const Y_TOP = 16;
const FEED_H = 78;                    // ความสูงต่อสายป้อน 1 สาย
const FEED_BOX_W = 132, FEED_BOX_H = 40;

const fmt = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString('th-TH', { maximumFractionDigits: d }));

/* ── ชิ้นส่วนย่อย ─────────────────────────────────────────────────────────── */
const Fact = ({ x, y, P, title, sub, sub2, w = FACT_W }) => (
  <g>
    <path d={`M${x} ${y + 40} L${x} ${y + 12} L${x + w * 0.24} ${y + 26} L${x + w * 0.24} ${y + 12} L${x + w * 0.49} ${y + 26} L${x + w * 0.49} ${y + 12} L${x + w * 0.74} ${y + 26} L${x + w * 0.74} ${y + 40} Z`}
      fill={P.box} stroke={P.line} strokeWidth="1.3" />
    <rect x={x} y={y + 40} width={w} height={18} fill={P.boxHead} stroke={P.line} strokeWidth="1.1" />
    <text x={x + w / 2} y={y + 52.5} fontSize="10.5" fontWeight="700" fill={P.ink} textAnchor="middle">{title || '—'}</text>
    {sub && <text x={x + w / 2} y={y + 70} fontSize="9.5" fill={P.sub} textAnchor="middle">{sub}</text>}
    {sub2 && <text x={x + w / 2} y={y + 81} fontSize="9.5" fill={P.sub} textAnchor="middle">{sub2}</text>}
  </g>
);

/** เส้นข้อมูล — electronic = หยัก (ฟ้าประ) · manual = ตรง
    labelPos = [x,y] วางป้ายเอง (ค่า default วางเหนือจุดเริ่ม — เส้นที่ออกจากใต้กล่องจะทับกล่อง) */
const InfoLine = ({ pts, P, electronic = true, label = null, labelPos = null }) => {
  const [lx, ly] = labelPos || [(pts[0][0] + pts[pts.length - 1][0]) / 2, pts[0][1] - 5];
  if (electronic) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      const seg = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 13));
      for (let j = 0; j < seg; j++) {
        const t0 = j / seg, t1 = (j + 1) / seg;
        const mx = x1 + (x2 - x1) * ((t0 + t1) / 2), my = y1 + (y2 - y1) * ((t0 + t1) / 2);
        const nx = -(y2 - y1), ny = (x2 - x1), nl = Math.hypot(nx, ny) || 1;
        const off = (j % 2 ? -3.4 : 3.4);
        out.push(`${j === 0 ? 'M' : 'L'}${x1 + (x2 - x1) * t0} ${y1 + (y2 - y1) * t0}`,
          `L${mx + (nx / nl) * off} ${my + (ny / nl) * off}`);
      }
      out.push(`L${x2} ${y2}`);
    }
    return <g>
      <path d={out.join(' ')} fill="none" stroke={P.info} strokeWidth="1.15" />
      {label && <text x={lx} y={ly} fontSize="9" fill={P.info} textAnchor="middle">{label}</text>}
    </g>;
  }
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
  const [ex, ey] = pts[pts.length - 1], [px, py] = pts[pts.length - 2];
  const a = Math.atan2(ey - py, ex - px);
  return <g>
    <path d={d} fill="none" stroke={P.info} strokeWidth="1.15" />
    <path d={`M${ex - 6 * Math.cos(a - 0.42)} ${ey - 6 * Math.sin(a - 0.42)} L${ex} ${ey} L${ex - 6 * Math.cos(a + 0.42)} ${ey - 6 * Math.sin(a + 0.42)}`}
      fill="none" stroke={P.info} strokeWidth="1.15" />
    {label && <text x={lx} y={ly} fontSize="9" fill={P.info} textAnchor="middle">{label}</text>}
  </g>;
};

/** จุดคงคลัง — มี kanban = supermarket + kanban post (จุดดึง) · ไม่มี = สามเหลี่ยม I (ผลัก) */
const InvPoint = ({ cx, y, P, inv }) => {
  const missing = inv?.qty == null;
  const isPull = !!inv?.kanban;
  return (
    <g>
      {inv?.label && <text x={cx} y={y - 30} fontSize="9.5" fill={P.sub} textAnchor="middle">{inv.label}</text>}
      {isPull ? (
        <g>
          <rect x={cx - 21} y={y - 21} width="42" height="20" fill={P.box} stroke={P.line} strokeWidth="1.2" />
          <path d={`M${cx - 21} ${y - 14} L${cx + 21} ${y - 14} M${cx - 7} ${y - 14} L${cx - 7} ${y - 1} M${cx + 7} ${y - 14} L${cx + 7} ${y - 1}`}
            stroke={P.line} strokeWidth="0.8" fill="none" />
          <text x={cx} y={y - 25} fontSize="8.5" fill={P.pull} textAnchor="middle" fontWeight="700">SUPERMARKET</text>
        </g>
      ) : null}
      <path d={`M${cx} ${y} L${cx + 17} ${y + 26} L${cx - 17} ${y + 26} Z`}
        fill={missing ? 'none' : P.inv} stroke={missing ? P.nva : P.line}
        strokeWidth="1.3" strokeDasharray={missing ? '3 2' : undefined} />
      <text x={cx} y={y + 23} fontSize="9" fontWeight="700" fill={missing ? P.nva : P.invInk} textAnchor="middle">I</text>
      <text x={cx} y={y + 39} fontSize="10" fontWeight="700" fill={P.ink} textAnchor="middle">
        {missing ? 'ยังไม่กรอก' : `${fmt(inv.qty)} ${inv.uom || 'pcs'}`}
      </text>
      {inv?.days != null && <text x={cx} y={y + 51} fontSize="9.5" fill={P.sub} textAnchor="middle">{fmt(inv.days, 2)} วัน</text>}
      {isPull && inv.kanban?.total_kanban != null && (
        <text x={cx} y={y + 62} fontSize="9" fill={P.pull} textAnchor="middle">คัมบัง {fmt(inv.kanban.total_kanban)} ใบ</text>
      )}
    </g>
  );
};

const Push = ({ x1, x2, y, P }) => {
  const w = x2 - x1;
  if (w < 14) return null;
  return <g>
    <rect x={x1} y={y - 4} width={w - 9} height="8" fill={P.push} stroke={P.line} strokeWidth="0.8" />
    <path d={`M${x2 - 9} ${y - 8} L${x2} ${y} L${x2 - 9} ${y + 8} Z`} fill={P.push} stroke={P.line} strokeWidth="0.8" />
  </g>;
};

/** ลูกศรดึง (withdrawal) — วงกลม + เส้นย้อนกลับไปกระบวนการก่อนหน้า */
const PullArrow = ({ x1, x2, y, P }) => (
  <g>
    <circle cx={x2} cy={y} r="6.5" fill="none" stroke={P.pull} strokeWidth="1.3" />
    <path d={`M${x2 - 6.5} ${y} L${x1 + 7} ${y}`} stroke={P.pull} strokeWidth="1.3" fill="none" strokeDasharray="4 2.5" />
    <path d={`M${x1 + 12} ${y - 4} L${x1 + 6} ${y} L${x1 + 12} ${y + 4}`} stroke={P.pull} strokeWidth="1.3" fill="none" />
  </g>
);

/** คัมบัง + จุดแขวน */
const KanbanCard = ({ x, y, P, kind = 'P' }) => (
  <g>
    <path d={`M${x - 9} ${y + 12} L${x - 9} ${y} L${x + 9} ${y}`} stroke={P.line} strokeWidth="1.1" fill="none" />
    <rect x={x + 1} y={y - 1} width="16" height="11" fill={P.box} stroke={P.line} strokeWidth="1.1" />
    <path d={`M${x + 1} ${y - 1} L${x + 9} ${y + 4} L${x + 17} ${y - 1}`} stroke={P.line} strokeWidth="0.7" fill="none" />
    <text x={x + 9} y={y + 8.5} fontSize="7" fill={P.sub} textAnchor="middle">{kind}</text>
  </g>
);

/** กล่องกระบวนการ + กล่องข้อมูล
 *  lv = สถานะสดจาก `lib/vsmLive.js` (แท็บ ⚡ สายธารสด) — ไม่ส่ง = render เหมือนเดิมเป๊ะ
 *  (ใบพิมพ์ clone SVG จากแท็บเอกสารซึ่งไม่ส่ง live → ไม่กระทบ)
 *  สี/ความหมายสถานะอยู่ที่ LIVE_STATUS ใน vsmLive.js — ที่นี่แค่เลือกใช้ ห้ามนิยามสีใหม่ */
function ProcBox({ b, x, yProc, P, small = false, lv = null }) {
  const w = small ? FEED_BOX_W : BOX_W, h = small ? FEED_BOX_H : BOX_H;
  // ขอบตามสถานะสด: down แดง(กระพริบ — Andon แดงเท่านั้นที่กระพริบ) · run เขียว · idle เส้นประจาง
  const lvStroke = lv ? ({ down: P.nva, run: P.va }[lv.status] || null) : null;
  const lvDash = lv?.status === 'idle' ? '5 3' : undefined;
  // ข้อความสถานะอ่านจาก LIVE_STATUS (vsmLive.js) — ห้ามพิมพ์ป้ายสถานะซ้ำที่นี่ เดี๋ยว drift
  const lvTitle = lv ? [
    (LIVE_STATUS[lv.status] || LIVE_STATUS.unknown).label
      + (lv.status === 'down' ? ` ${lv.alarms?.length || 0} รายการ` : ''),
    lv.live?.oee != null ? `OEE สด ${lv.live.oee}%` : null,
    lv.produced != null ? `วันนี้ ${lv.produced}/${lv.target || '—'} ชิ้น` : null,
  ].filter(Boolean).join(' · ') : null;
  // จอ TV โหมดเบา (data-perf="lite") งดกระพริบตาม UI §1.7 — ขอบแดงนิ่งยังบอกสถานะครบ
  const perfLite = typeof document !== 'undefined' && document.documentElement.dataset.perf === 'lite';
  const rows = [
    ['C/T', b.ct == null ? '—' : `${fmt(b.ct, 1)} sec`],
    ['T/T', b.ttSec == null ? '—' : `${fmt(b.ttSec, 1)} sec`],
    ['C/O', b.setupSec == null ? '—' : `${fmt(b.setupSec)} sec`],
    ['%OEE', b.oeePct == null ? '—' : `${fmt(b.oeePct, 1)}%`],
    ['Shift', b.shifts ? `${b.shifts} SHIFT` : '—'],
    ['A/T', b.atSec == null ? '—' : fmt(b.atSec)],
    ['LOT', b.lotSize == null ? '—' : `${fmt(b.lotSize)} pcs`],
  ];
  return (
    <g>
      {lvTitle && <title>{lvTitle}</title>}
      <rect x={x} y={yProc} width={w} height={h} rx="2"
        fill={b.isOutsourced ? P.outsource : P.box}
        stroke={lvStroke || (lv?.status === 'idle' ? P.faint : P.line)}
        strokeWidth={lvStroke ? 2.2 : 1.4} strokeDasharray={lvDash}>
        {lv?.status === 'down' && !perfLite && (
          <animate attributeName="stroke-opacity" values="1;0.25;1" dur="1.1s" repeatCount="indefinite" />
        )}
      </rect>
      <rect x={x} y={yProc} width={w} height="15" fill={P.boxHead} stroke={P.line} strokeWidth="1.1" />
      <text x={x + w / 2} y={yProc + 11} fontSize="8.5" fill={P.ink} textAnchor="middle" fontWeight="600">
        {/* กล่อง fallback (ยังไม่ลง routing) ชื่อขั้น = ชื่อไลน์ — ไม่พิมพ์ซ้ำ 2 บรรทัด */}
        {b.isOutsourced ? `จ้างนอก · ${b.vendor || 'ยังไม่ระบุ'}` : (b.line && b.line !== b.name ? b.line : (b.line ? '' : '—'))}
        {b.machineNo ? `${b.isOutsourced || (b.line && b.line !== b.name) ? ' · ' : ''}${b.machineNo}` : ''}
      </text>
      <text x={x + w / 2} y={yProc + (small ? 31 : 34)} fontSize={small ? 10 : 11.5} fontWeight="800" fill={P.ink} textAnchor="middle">
        {(b.name || '').slice(0, small ? 20 : 24)}
      </text>
      {!small && b.operators != null && <>
        <circle cx={x + 15} cy={yProc + 46} r="3.6" fill={P.box} stroke={P.line} strokeWidth="1" />
        <path d={`M${x + 9} ${yProc + 54} A6 6 0 0 1 ${x + 21} ${yProc + 54} Z`} fill={P.box} stroke={P.line} strokeWidth="1" />
        <text x={x + 27} y={yProc + 52} fontSize="10" fontWeight="700" fill={P.ink}>{fmt(b.operators)}</text>
      </>}
      {!small && b.isFallback && <text x={x + w - 5} y={yProc + 50} fontSize="8.5" fill={P.nva} textAnchor="end">ยังไม่ลง routing</text>}

      {!small && <>
        <rect x={x} y={yProc + h} width={w} height={DATA_H} fill={P.data} stroke={P.line} strokeWidth="1.2" />
        {rows.map(([k, v], i) => {
          const yy = yProc + h + 14 + i * 13;
          return <g key={k}>
            <text x={x + 7} y={yy} fontSize="9.5" fill={P.sub}>{k}</text>
            <text x={x + w - 7} y={yy} fontSize="9.5" fontWeight="700" fill={P.ink} textAnchor="end">{v}</text>
          </g>;
        })}
      </>}
      {small && <text x={x + w / 2} y={yProc + FEED_BOX_H - 3} fontSize="8.5" fill={P.sub} textAnchor="middle">
        C/T {b.ct == null ? '—' : fmt(b.ct, 1)}s · OEE {b.oeePct == null ? '—' : fmt(b.oeePct, 0) + '%'}
      </text>}
    </g>
  );
}

/* ── ตัวหลัก ──────────────────────────────────────────────────────────────── */
export default function VsmCanvas({ model, palette = PALETTE_DARK, width = null, live = null }) {
  const P = palette;
  if (!model?.chain?.length) return null;
  const lvOf = key => live?.byKey?.[key] || null;   // สถานะสดต่อกล่อง (แท็บ ⚡ เท่านั้น)

  const n = model.chain.length;
  const feeders = model.feeders || [];
  const sups = model.suppliers || [];

  // แถวสายป้อนต้องเริ่มใต้คอลัมน์ supplier เสมอ — เดิม fix 178 แล้วป้าย mat ของ feeder
  // (x=26 คอลัมน์เดียวกับ supplier) วาดทับกล่อง supplier ตัวที่ 3 (เจอจริง 2026-08-20)
  const supRows = sups.length ? Math.min(sups.length, 3) : 1;
  const supBottom = Y_TOP + supRows * 78 + (sups.length > 3 ? 22 : 0);
  const yFeedTop = Math.max(178, supBottom + 26);
  const Y_PROC = yFeedTop + feeders.length * FEED_H + (feeders.length ? 26 : 46);
  const Y_DATA = Y_PROC + BOX_H;
  const Y_LAD = Y_DATA + DATA_H + 58;
  const H = Y_LAD + 122;                 // เผื่อกล่องสรุปสูงขึ้นจากบรรทัด MCT (headline ใบจริง)
  // ขั้นต่ำ 1080: แถวบน supplier + SALE&PLANNING + กล่อง Order/day (กว้าง 228) + customer
  // ต้องไม่ทับกัน — สายสั้น (กล่อง 1-2 ใบ) เคยทำ customer จมหลังกล่องข้อมูล (เจอจริง 2026-08-20)
  const W = Math.max(PAD_L + n * COL_W + PAD_R, 1080);
  const colX = i => PAD_L + i * COL_W + (COL_W - BOX_W) / 2;

  const invAt = pos => model.inventories.find(v => v.pos === pos);
  const rawInv = invAt('raw'), fgInv = invAt('fg');

  // บันไดเวลา: ขั้นบน = วันคงคลัง (NVA) · ขั้นล่าง = วินาทีงานจริง (VA)
  const ladder = [];
  ladder.push({ type: 'nva', v: rawInv?.days, x: PAD_L - 66, w: 66 });
  model.chain.forEach((b, i) => {
    ladder.push({ type: 'va', v: b.ct, x: colX(i), w: BOX_W });
    if (i < n - 1) ladder.push({ type: 'nva', v: invAt(`after:${b.key}`)?.days, x: colX(i) + BOX_W, w: COL_W - BOX_W });
  });
  ladder.push({ type: 'nva', v: fgInv?.days, x: colX(n - 1) + BOX_W, w: 66 });

  const T = model.totals, I = model.info;
  const planX = W / 2 - PLAN_W / 2, planCx = W / 2;
  const custX = W - FACT_W - 26;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width || '100%'} style={{ display: 'block', background: P.bg }}
      xmlns="http://www.w3.org/2000/svg" fontFamily="Sarabun, sans-serif">

      {/* ── แถวบน: ผู้ส่งมอบ (ทุกราย) · วางแผน · ลูกค้า ── */}
      {sups.length === 0
        ? <Fact x={26} y={Y_TOP} P={P} title="SUPPLIER" sub="ไม่มีพาร์ทซื้อนอกใน BOM" />
        : sups.slice(0, 3).map((s, i) => (
          <Fact key={s.matNo} x={26} y={Y_TOP + i * 78} P={P}
            title={s.supplier || 'ยังไม่ระบุผู้ส่งมอบ'}
            sub={s.deliveryPattern || 'รอบส่ง: ยังไม่กรอก'}
            sub2={s.qty != null ? `${fmt(s.qty)} pcs${s.days != null ? ` · ${fmt(s.days, 1)} วัน` : ''}` : null} />
        ))}
      {sups.length > 3 && (
        <text x={26 + FACT_W / 2} y={Y_TOP + 3 * 78 + 10} fontSize="9.5" fill={P.sub} textAnchor="middle">
          + ผู้ส่งมอบอีก {sups.length - 3} ราย
        </text>
      )}

      {/* ── ข้อความเส้น/กล่องข้อมูล มาจาก model.info (นับจากข้อมูลจริง) ห้าม hardcode claim
             (คำสั่ง user 2026-08-20: "อย่ามั่ว ไม่รู้ก็บอกไม่รู้") · snapshot เก่าที่ไม่มี field ใหม่
             ใช้ fallback จาก demandSource — ห้ามตีความ undefined เป็น "ไม่มี" ── */}
      {(() => {
        const oldSnap = I.forecastMonths === undefined && I.orderCount === undefined;
        const fcTxt = I.forecastMonths ? `Forecast ${fmt(I.forecastMonths)} เดือน (${I.forecastSource})`
          : (oldSnap && I.demandSource === 'forecast') ? 'Forecast: มีในระบบ'
          : 'Forecast: ยังไม่มีในระบบ';
        const soTxt = I.orderCount ? `Order เดือนนี้ ${fmt(I.orderCount)} ใบ${I.orderSource ? ` (${I.orderSource})` : ''}`
          : (oldSnap && I.demandSource === 'order') ? 'Order: มีในระบบ'
          : 'Order เดือนนี้: ยังไม่มีในระบบ';
        const hasFc = !fcTxt.includes('ยังไม่มี'), hasSo = !soTxt.includes('ยังไม่มี');
        const custLabel = hasFc || hasSo
          ? [hasFc && 'Forecast', hasSo && 'Order'].filter(Boolean).join(' / ')
          : 'ยังไม่มี forecast/order ในระบบ';
        const planLabel = I.planDays === undefined ? 'สั่งผลิตรายวัน'      // snapshot เก่า — ไม่รู้ ไม่อ้างเลข
          : I.planDays ? `สั่งผลิตรายวัน (เปิดกะ ${fmt(I.planDays)} วันในเดือน)`
          : 'สั่งผลิต: เดือนนี้ยังไม่มีกะปิด';
        return <>
          <g>
            <rect x={planX} y={Y_TOP} width={PLAN_W} height={PLAN_H} fill={P.box} stroke={P.line} strokeWidth="1.4" />
            <rect x={planX} y={Y_TOP} width={PLAN_W} height="17" fill={P.boxHead} stroke={P.line} strokeWidth="1.1" />
            <text x={planCx} y={Y_TOP + 12.5} fontSize="10.5" fontWeight="800" fill={P.ink} textAnchor="middle">SALE &amp; PLANNING</text>
            <text x={planCx} y={Y_TOP + 32} fontSize="9.5" fill={P.sub} textAnchor="middle">SAP · Production Control</text>
            <text x={planCx} y={Y_TOP + 46} fontSize="9.5" fill={hasFc ? P.sub : P.nva} textAnchor="middle">{fcTxt}</text>
            <text x={planCx} y={Y_TOP + 60} fontSize="9.5" fill={hasSo ? P.sub : P.nva} textAnchor="middle">{soTxt}</text>
          </g>

          {/* ── การไหลข้อมูล: ลูกค้า→วางแผน (electronic) · วางแผน→supplier (electronic) · วางแผน→ผลิต (manual) ── */}
          <InfoLine P={P} electronic pts={[[custX, Y_TOP + 28], [planX + PLAN_W, Y_TOP + 28]]} label={custLabel} />
          {/* ระบบยังไม่มีข้อมูลใบสั่งซื้อ supplier — บอกตรงๆ ห้ามแปะป้ายเหมือนมีข้อมูลจริง */}
          <InfoLine P={P} electronic pts={[[planX, Y_TOP + 28], [26 + FACT_W, Y_TOP + 28]]} label="สั่งซื้อ (ยังไม่มีข้อมูลในระบบ)" />
          <InfoLine P={P} electronic={false} label={planLabel}
            labelPos={[(planCx + colX(0) + BOX_W / 2) / 2, Y_PROC - 40]}
            pts={[[planCx, Y_TOP + PLAN_H], [planCx, Y_PROC - 34], [colX(0) + BOX_W / 2, Y_PROC - 34], [colX(0) + BOX_W / 2, Y_PROC - 6]]} />
        </>;
      })()}

      <Fact x={custX} y={Y_TOP} P={P}
        title={model.customer.name || model.header.customer || 'CUSTOMER'}
        sub={model.customer.pattern || (model.customer.roundsPerDay ? `${model.customer.roundsPerDay} รอบส่ง/วัน` : 'รอบส่ง: ยังไม่กรอก')} />
      {n > 1 && <InfoLine P={P} electronic={false}
        pts={[[planCx, Y_PROC - 34], [colX(n - 1) + BOX_W / 2, Y_PROC - 34], [colX(n - 1) + BOX_W / 2, Y_PROC - 6]]} />}

      {/* ── สายป้อน (พาร์ทลูกที่ไม่ใช่สายหลัก) — วาดเหนือสายหลัก แล้วชี้ลงกล่องแรก ── */}
      {feeders.map((f, fi) => {
        const y = yFeedTop + fi * FEED_H;
        const startX = PAD_L - 40;
        return (
          <g key={f.matNo}>
            <text x={26} y={y + 16} fontSize="9.5" fill={P.sub}>{f.matNo}</text>
            <text x={26} y={y + 28} fontSize="9" fill={P.faint}>{(f.name || '').slice(0, 22)}</text>
            {f.boxes.map((b, bi) => {
              const bx = startX + bi * (FEED_BOX_W + 34);
              return <g key={b.key}>
                <ProcBox b={b} x={bx} yProc={y} P={P} small lv={lvOf(b.key)} />
                {bi < f.boxes.length - 1 && <Push x1={bx + FEED_BOX_W + 2} x2={bx + FEED_BOX_W + 32} y={y + FEED_BOX_H / 2} P={P} />}
              </g>;
            })}
            {/* เส้นผลักจากสายป้อน ลงไปรวมกับกล่องแรกของสายหลัก */}
            {(() => {
              const lastX = startX + (f.boxes.length - 1) * (FEED_BOX_W + 34) + FEED_BOX_W;
              const tx = colX(0) + BOX_W / 2;
              return <g>
                <path d={`M${lastX + 2} ${y + FEED_BOX_H / 2} L${tx} ${y + FEED_BOX_H / 2} L${tx} ${Y_PROC - 8}`}
                  fill="none" stroke={P.push} strokeWidth="4" />
                <path d={`M${tx - 5} ${Y_PROC - 10} L${tx} ${Y_PROC - 2} L${tx + 5} ${Y_PROC - 10} Z`} fill={P.push} stroke={P.line} strokeWidth="0.8" />
              </g>;
            })()}
          </g>
        );
      })}

      {/* ── การขนส่งเข้า/ออก ── */}
      <g transform={`translate(28, ${Y_PROC + 4}) scale(1.25)`}><Symbol k="truck" P={P} /></g>
      <g transform={`translate(${W - 96}, ${Y_PROC + 4}) scale(1.25)`}><Symbol k="truck" P={P} /></g>
      <text x={W - 62} y={Y_PROC + 52} fontSize="9.5" fill={P.sub} textAnchor="middle">Shipping</text>

      {/* ── คงคลังต้นทาง/ปลายทาง ── */}
      <InvPoint cx={PAD_L - 36} y={Y_PROC + 6} P={P} inv={rawInv} />
      <InvPoint cx={colX(n - 1) + BOX_W + 38} y={Y_PROC + 6} P={P} inv={fgInv} />

      {/* ── สายหลัก ── */}
      {model.chain.map((b, i) => {
        const x = colX(i);
        const nx = invAt(`after:${b.key}`);
        const midX = x + BOX_W + (COL_W - BOX_W) / 2;
        return <g key={b.key}>
          <ProcBox b={b} x={x} yProc={Y_PROC} P={P} lv={lvOf(b.key)} />
          {i < n - 1 && <>
            <InvPoint cx={midX} y={Y_PROC + 6} P={P} inv={nx} />
            {nx?.kanban
              ? <>
                  <PullArrow x1={x + BOX_W + 2} x2={colX(i + 1) - 2} y={Y_PROC + 76} P={P} />
                  <KanbanCard x={midX - 9} y={Y_PROC + 92} P={P} kind="P" />
                </>
              : <Push x1={x + BOX_W + 2} x2={colX(i + 1) - 2} y={Y_PROC + 76} P={P} />}
          </>}
        </g>;
      })}
      <Push x1={PAD_L - 16} x2={colX(0) - 2} y={Y_PROC + 76} P={P} />
      {fgInv?.kanban
        ? <>
            <PullArrow x1={colX(n - 1) + BOX_W + 2} x2={colX(n - 1) + BOX_W + 58} y={Y_PROC + 76} P={P} />
            <KanbanCard x={colX(n - 1) + BOX_W + 28} y={Y_PROC + 92} P={P} kind="W" />
          </>
        : <Push x1={colX(n - 1) + BOX_W + 2} x2={colX(n - 1) + BOX_W + 58} y={Y_PROC + 76} P={P} />}

      {/* ── บันไดเวลา ── */}
      {ladder.map((seg, i) => {
        const up = seg.type === 'nva';
        const y = up ? Y_LAD : Y_LAD + 22;
        const prev = ladder[i - 1];
        return <g key={i}>
          <path d={`M${seg.x} ${y} L${seg.x + seg.w} ${y}`} stroke={up ? P.nva : P.va} strokeWidth="2" fill="none" />
          {prev && <path d={`M${seg.x} ${prev.type === 'nva' ? Y_LAD : Y_LAD + 22} L${seg.x} ${y}`}
            stroke={P.line} strokeWidth="1.2" fill="none" />}
          <text x={seg.x + seg.w / 2} y={up ? y - 5 : y + 12} fontSize="9.5"
            fill={up ? P.nva : P.va} textAnchor="middle" fontWeight="700">
            {seg.v == null ? '—' : (up ? `${fmt(seg.v, 2)} วัน` : `${fmt(seg.v, 0)} s`)}
          </text>
        </g>;
      })}
      <text x={26} y={Y_LAD + 2} fontSize="9" fill={P.nva}>NVA (รอ)</text>
      <text x={26} y={Y_LAD + 26} fontSize="9" fill={P.va}>VA (ทำงาน)</text>

      {/* ── สรุปมุมล่างขวา — MCT เป็น headline ตัวแดงใหญ่ ตามธรรมเนียมใบจริง TSAT
            (skill: vsm-tsat-reference — "MCT = 8.97 Days 4 min 17 second") ── */}
      <g>
        <rect x={W - 336} y={Y_LAD + 40} width="316" height="74" fill={P.data} stroke={P.line} strokeWidth="1.2" />
        <text x={W - 326} y={Y_LAD + 56} fontSize="10.5" fill={P.ink}>
          PLT = <tspan fontWeight="800">{fmt(T.pltDays, 2)}</tspan> วัน
          <tspan dx="16">PT = <tspan fontWeight="800">{fmtMinSec(T.ptSec) || '—'}</tspan></tspan>
        </text>
        <text x={W - 326} y={Y_LAD + 74} fontSize="12.5" fontWeight="900" fill={P.nva}>
          MCT = {fmtMct(T.pltDays, T.ptSec) || '—'}
        </text>
        <text x={W - 326} y={Y_LAD + 90} fontSize="10.5" fill={P.ink}>
          %VA = VA ÷ (VA+NVA) × 100 = <tspan fontWeight="800" fill={P.va}>{T.vaPct == null ? '—' : `${fmt(T.vaPct, 2)}%`}</tspan>
        </text>
        <text x={W - 326} y={Y_LAD + 104} fontSize="9" fill={P.sub}>
          {fmt(T.vaSec)} ÷ ({fmt(T.vaSec)} + {fmt(T.pltDays, 2)} × {fmt(I.atSec)} ) × 100 · NVA = PLT × A/T
        </text>
      </g>

      {/* ── กล่องข้อมูลความต้องการ ── */}
      <g>
        <rect x={planX + PLAN_W + 22} y={Y_TOP} width="228" height="92" fill={P.data} stroke={P.line} strokeWidth="1.2" />
        {[
          ['Working day', I.workingDays ? `${I.workingDays} วัน/เดือน` : '—'],
          ['Order/year', I.orderYear ? `${fmt(I.orderYear)} pcs` : '—'],
          ['Order/month', I.orderMonth ? `${fmt(I.orderMonth)} pcs` : '—'],
          ['Order/day', I.orderDay ? `${fmt(I.orderDay)} pcs` : '—'],
          ['A/T', I.atSec == null ? '—' : `${fmt(I.atSec)} sec`],
          ['T/T', I.ttSec == null ? '—' : `${fmt(I.ttSec, 1)} sec`],
        ].map(([k, v], i) => (
          <g key={i}>
            <text x={planX + PLAN_W + 32} y={Y_TOP + 16 + i * 13} fontSize="9.5" fill={P.sub}>{k}</text>
            <text x={planX + PLAN_W + 240} y={Y_TOP + 16 + i * 13} fontSize="9.5" fontWeight="700" fill={P.ink} textAnchor="end">{v}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

/** แถบสัญลักษณ์ — สร้างจาก `SYMBOLS` ตัวเดียวกับที่ผังใช้ */
export function VsmLegend({ palette = PALETTE_DARK, compact = false }) {
  const P = palette;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 150 : 190}px, 1fr))`,
      gap: compact ? '2px 8px' : '4px 12px', alignContent: 'start',
      padding: compact ? '4px 6px' : '10px 12px',
      background: P.data, border: `1px solid ${P.line}`, borderRadius: 6,
    }}>
      {SYMBOLS.map(s => (
        <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width={compact ? 26 : 34} height={compact ? 20 : 26} viewBox="0 0 32 26" style={{ flexShrink: 0 }}><Symbol k={s.key} P={P} /></svg>
          <span style={{ fontSize: compact ? 8.5 : 11, color: P.sub, lineHeight: 1.2 }}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}
