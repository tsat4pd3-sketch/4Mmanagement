/**
 * VsmCanvas — วาดแผนผังสายธารคุณค่าเป็น SVG จากโมเดล (`src/lib/vsmModel.js`)
 *
 * สัญลักษณ์ตามมาตรฐานสากล (Learning to See — Rother & Shook) ชุดเดียวกับใบกระดาษของ TSAT
 * ⚠️ สัญลักษณ์ทุกตัวนิยามใน `SYMBOLS` ที่เดียว — legend สร้างจาก registry เดียวกัน
 *    ห้ามวาดสัญลักษณ์ซ้ำในหน้าอื่น (จะกลายเป็น legend ที่ไม่ตรงกับผัง)
 *
 * ⚠️ สีเป็น literal จาก `palette` prop ไม่ใช้ CSS var — เพราะใบพิมพ์ clone `outerHTML`
 *    ของ SVG นี้ไปใช้ตรงๆ (ดู vsmPrint.js) ถ้าใช้ var สีจะหายหมดตอนพิมพ์
 *
 * layout เป็น auto-layout จากโมเดล (ไม่ใช่ลากวางอิสระ) → regenerate แล้วผังจัดใหม่ให้เอง
 */

export const PALETTE_LIGHT = {
  bg: '#ffffff', ink: '#111827', sub: '#4b5563', line: '#374151', faint: '#9ca3af',
  box: '#ffffff', boxHead: '#dbeafe', data: '#f9fafb', inv: '#fde68a', invInk: '#78350f',
  push: '#d1d5db', info: '#1d4ed8', va: '#16a34a', nva: '#dc2626', outsource: '#ede9fe',
};
export const PALETTE_DARK = {
  bg: '#0f1613', ink: '#e5e7eb', sub: '#9ca3af', line: '#6b7280', faint: '#6b7280',
  box: '#18211d', boxHead: '#1e3a5f', data: '#131a17', inv: '#78350f', invInk: '#fde68a',
  push: '#374151', info: '#60a5fa', va: '#22c55e', nva: '#ef4444', outsource: '#3b2f5e',
};

/** ทะเบียนสัญลักษณ์ — legend อ่านจากตัวนี้ (ห้ามแยกลิสต์) */
export const SYMBOLS = [
  { key: 'factory',  label: 'ผู้ส่งมอบ / ลูกค้า (Outside source)' },
  { key: 'process',  label: 'กระบวนการผลิต (Process)' },
  { key: 'data',     label: 'กล่องข้อมูล (Data box)' },
  { key: 'inv',      label: 'คงคลัง (Inventory)' },
  { key: 'truck',    label: 'การขนส่ง (Shipment)' },
  { key: 'push',     label: 'การไหลแบบผลัก (Push arrow)' },
  { key: 'pull',     label: 'การไหลแบบดึง (Withdrawal)' },
  { key: 'super',    label: 'ซูเปอร์มาร์เก็ต (Supermarket)' },
  { key: 'kanbanP',  label: 'คัมบังสั่งผลิต (Production kanban)' },
  { key: 'kanbanW',  label: 'คัมบังเบิกถอน (Withdrawal kanban)' },
  { key: 'post',     label: 'จุดแขวนคัมบัง (Kanban post)' },
  { key: 'infoE',    label: 'ข้อมูลอิเล็กทรอนิกส์ (Electronic info)' },
  { key: 'infoM',    label: 'ข้อมูลด้วยมือ (Manual info)' },
  { key: 'operator', label: 'พนักงาน (Operator)' },
  { key: 'ladder',   label: 'บันไดเวลา (Timeline: VA / NVA)' },
];

/* ── สัญลักษณ์เดี่ยว (วาดที่ 0,0 ขนาดประมาณ 34×26 สำหรับ legend) ───────────── */
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
    case 'pull': return g(<><circle cx="9" cy="13" r="6" {...s} />
      <path d="M15 13 L28 13" {...s} /><path d="M24 10 L28 13 L24 16" {...s} /></>);
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
    case 'infoE': return g(<path d="M1 17 L8 9 L14 15 L21 7 L30 13" {...s} />);
    case 'infoM': return g(<><path d="M1 13 L27 13" {...s} /><path d="M23 10 L27 13 L23 16" {...s} /></>);
    case 'operator': return g(<><circle cx="14" cy="10" r="3.5" {...s} fill={P.box} />
      <path d="M8 20 A6 6 0 0 1 20 20 Z" {...s} fill={P.box} /></>);
    case 'ladder': return g(<path d="M1 9 L9 9 L9 18 L17 18 L17 9 L25 9 L25 18 L31 18" {...s} />);
    default: return null;
  }
}

/* ── ค่าคงที่ layout ──────────────────────────────────────────────────────── */
const COL_W = 206, BOX_W = 158, BOX_H = 54, DATA_H = 104;
const Y_FACT = 18, FACT_W = 132, FACT_H = 58;
const Y_PLAN = 18, PLAN_W = 190, PLAN_H = 62;
const Y_PROC = 232;
const Y_DATA = Y_PROC + BOX_H;
const Y_LAD = Y_DATA + DATA_H + 54;
const PAD_L = 168, PAD_R = 168;

const fmt = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString('th-TH', { maximumFractionDigits: d }));
const secTxt = v => (v == null ? '—' : `${fmt(v, 1)} sec`);

/* ── ชิ้นส่วนย่อย ─────────────────────────────────────────────────────────── */
const Fact = ({ x, y, P, title, sub }) => (
  <g>
    <path d={`M${x} ${y + 40} L${x} ${y + 12} L${x + 22} ${y + 26} L${x + 22} ${y + 12} L${x + 44} ${y + 26} L${x + 44} ${y + 12} L${x + 66} ${y + 26} L${x + 66} ${y + 40} Z`}
      fill={P.box} stroke={P.line} strokeWidth="1.3" />
    <rect x={x} y={y + 40} width={FACT_W} height={18} fill={P.boxHead} stroke={P.line} strokeWidth="1.1" />
    <text x={x + FACT_W / 2} y={y + 52} fontSize="11" fontWeight="700" fill={P.ink} textAnchor="middle">{title || '—'}</text>
    {sub && <text x={x + FACT_W / 2} y={y + 70} fontSize="10" fill={P.sub} textAnchor="middle">{sub}</text>}
  </g>
);

const Tri = ({ cx, y, P, qty, days, label, missing }) => (
  <g>
    <path d={`M${cx} ${y} L${cx + 17} ${y + 26} L${cx - 17} ${y + 26} Z`}
      fill={missing ? 'none' : P.inv} stroke={missing ? P.nva : P.line}
      strokeWidth="1.3" strokeDasharray={missing ? '3 2' : undefined} />
    <text x={cx} y={y + 23} fontSize="9" fontWeight="700" fill={missing ? P.nva : P.invInk} textAnchor="middle">I</text>
    <text x={cx} y={y + 39} fontSize="10" fontWeight="700" fill={P.ink} textAnchor="middle">
      {missing ? 'ยังไม่กรอก' : `${fmt(qty)} pcs`}
    </text>
    {days != null && <text x={cx} y={y + 51} fontSize="9.5" fill={P.sub} textAnchor="middle">{fmt(days, 2)} วัน</text>}
    {label && <text x={cx} y={y - 6} fontSize="9.5" fill={P.sub} textAnchor="middle">{label}</text>}
  </g>
);

const Push = ({ x1, x2, y, P }) => {
  const w = x2 - x1;
  if (w < 14) return null;
  return <g>
    <rect x={x1} y={y - 4} width={w - 9} height="8" fill={P.push} stroke={P.line} strokeWidth="0.8" />
    <path d={`M${x2 - 9} ${y - 8} L${x2} ${y} L${x2 - 9} ${y + 8} Z`} fill={P.push} stroke={P.line} strokeWidth="0.8" />
  </g>;
};

/** กล่องกระบวนการ + กล่องข้อมูล */
function ProcBox({ b, x, P, onPick, selected }) {
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
    <g style={onPick ? { cursor: 'pointer' } : undefined} onClick={onPick ? () => onPick(b) : undefined}>
      <rect x={x} y={Y_PROC} width={BOX_W} height={BOX_H} rx="2"
        fill={b.isOutsourced ? P.outsource : P.box}
        stroke={selected ? P.va : P.line} strokeWidth={selected ? 2.4 : 1.4} />
      <rect x={x} y={Y_PROC} width={BOX_W} height="15" fill={P.boxHead} stroke={P.line} strokeWidth="1.1" />
      <text x={x + BOX_W / 2} y={Y_PROC + 11} fontSize="9" fill={P.ink} textAnchor="middle" fontWeight="600">
        {b.isOutsourced ? `จ้างนอก · ${b.vendor || 'ยังไม่ระบุ'}` : (b.line || '—')}
      </text>
      <text x={x + BOX_W / 2} y={Y_PROC + 34} fontSize="11.5" fontWeight="800" fill={P.ink} textAnchor="middle">
        {(b.name || '').slice(0, 24)}
      </text>
      {b.operators != null && <>
        <circle cx={x + 15} cy={Y_PROC + 46} r="3.6" fill={P.box} stroke={P.line} strokeWidth="1" />
        <path d={`M${x + 9} ${Y_PROC + 54} A6 6 0 0 1 ${x + 21} ${Y_PROC + 54} Z`} fill={P.box} stroke={P.line} strokeWidth="1" />
        <text x={x + 27} y={Y_PROC + 52} fontSize="10" fontWeight="700" fill={P.ink}>{fmt(b.operators)}</text>
      </>}
      {b.isFallback && <text x={x + BOX_W - 5} y={Y_PROC + 50} fontSize="8.5" fill={P.nva} textAnchor="end">ยังไม่ลง routing</text>}

      <rect x={x} y={Y_DATA} width={BOX_W} height={DATA_H} fill={P.data} stroke={P.line} strokeWidth="1.2" />
      {rows.map(([k, v], i) => {
        const yy = Y_DATA + 14 + i * 13;
        return <g key={k}>
          <text x={x + 7} y={yy} fontSize="9.5" fill={P.sub}>{k}</text>
          <text x={x + BOX_W - 7} y={yy} fontSize="9.5" fontWeight="700" fill={P.ink} textAnchor="end">{v}</text>
        </g>;
      })}
    </g>
  );
}

/* ── ตัวหลัก ──────────────────────────────────────────────────────────────── */
export default function VsmCanvas({ model, palette = PALETTE_DARK, onPickStep = null, selectedKey = null, width = null }) {
  const P = palette;
  if (!model?.chain?.length) return null;

  const n = model.chain.length;
  const W = PAD_L + n * COL_W + PAD_R;
  const H = Y_LAD + 92;
  const colX = i => PAD_L + i * COL_W + (COL_W - BOX_W) / 2;

  // คงคลัง: raw อยู่ก่อนกล่องแรก · after:<key> อยู่ระหว่างกล่อง · fg อยู่หลังกล่องสุดท้าย
  const invAt = pos => model.inventories.find(v => v.pos === pos);
  const rawInv = invAt('raw'), fgInv = invAt('fg');

  // บันไดเวลา: สลับ ขั้นบน = วันคงคลัง (NVA) · ขั้นล่าง = วินาทีงานจริง (VA)
  const ladder = [];
  ladder.push({ type: 'nva', v: rawInv?.days, x: PAD_L - 62, w: 62 });
  model.chain.forEach((b, i) => {
    ladder.push({ type: 'va', v: b.ct, x: colX(i), w: BOX_W });
    const nx = model.inventories.find(v => v.pos === `after:${b.key}`);
    if (i < n - 1) ladder.push({ type: 'nva', v: nx?.days, x: colX(i) + BOX_W, w: COL_W - BOX_W });
  });
  ladder.push({ type: 'nva', v: fgInv?.days, x: colX(n - 1) + BOX_W, w: 62 });

  const T = model.totals, I = model.info;
  const svg = (
    <svg viewBox={`0 0 ${W} ${H}`} width={width || '100%'} style={{ display: 'block', background: P.bg }}
      xmlns="http://www.w3.org/2000/svg" fontFamily="Sarabun, sans-serif">
      {/* ── แถวบน: supplier · วางแผน · ลูกค้า ── */}
      <Fact x={26} y={Y_FACT} P={P}
        title={model.suppliers[0]?.supplier || 'SUPPLIER'}
        sub={model.suppliers.length > 1 ? `+ อีก ${model.suppliers.length - 1} ราย` : null} />
      <g>
        <rect x={W / 2 - PLAN_W / 2} y={Y_PLAN} width={PLAN_W} height={PLAN_H} fill={P.box} stroke={P.line} strokeWidth="1.4" />
        <rect x={W / 2 - PLAN_W / 2} y={Y_PLAN} width={PLAN_W} height="17" fill={P.boxHead} stroke={P.line} strokeWidth="1.1" />
        <text x={W / 2} y={Y_PLAN + 12.5} fontSize="10.5" fontWeight="800" fill={P.ink} textAnchor="middle">SALE &amp; PLANNING</text>
        <text x={W / 2} y={Y_PLAN + 34} fontSize="10" fill={P.sub} textAnchor="middle">SAP / Production Control</text>
        <text x={W / 2} y={Y_PLAN + 50} fontSize="10" fill={P.sub} textAnchor="middle">
          Forecast 12 เดือน · Order รายวัน
        </text>
      </g>
      <Fact x={W - FACT_W - 26} y={Y_FACT} P={P}
        title={model.customer.name || model.header.customer || 'CUSTOMER'}
        sub={model.customer.roundsPerDay ? `${model.customer.roundsPerDay} รอบส่ง/วัน` : null} />

      {/* ── เส้นข้อมูล (อิเล็กทรอนิกส์ = หยัก · มือ = ตรง) ── */}
      <path d={`M${W / 2 - PLAN_W / 2} ${Y_PLAN + 30} L${168} ${Y_PLAN + 30} L${168} ${Y_PLAN + 22}`}
        fill="none" stroke={P.info} strokeWidth="1.2" strokeDasharray="5 3" />
      <path d={`M${W / 2 + PLAN_W / 2} ${Y_PLAN + 30} L${W - FACT_W - 34} ${Y_PLAN + 30}`}
        fill="none" stroke={P.info} strokeWidth="1.2" strokeDasharray="5 3" />
      <path d={`M${W / 2} ${Y_PLAN + PLAN_H} L${W / 2} ${Y_PROC - 26}`} fill="none" stroke={P.info} strokeWidth="1.2" />
      <path d={`M${W / 2 - 4} ${Y_PROC - 32} L${W / 2} ${Y_PROC - 26} L${W / 2 + 4} ${Y_PROC - 32}`} fill="none" stroke={P.info} strokeWidth="1.2" />

      {/* ── การขนส่งเข้า/ออก ── */}
      <g transform={`translate(30, ${Y_PROC - 4}) scale(1.3)`}><Symbol k="truck" P={P} /></g>
      <g transform={`translate(${W - 92}, ${Y_PROC - 4}) scale(1.3)`}><Symbol k="truck" P={P} /></g>
      <text x={W - 62} y={Y_PROC + 46} fontSize="9.5" fill={P.sub} textAnchor="middle">Shipping</text>

      {/* ── คงคลังต้นทาง/ปลายทาง ── */}
      <Tri cx={PAD_L - 34} y={Y_PROC + 4} P={P} qty={rawInv?.qty} days={rawInv?.days}
        label={rawInv?.label} missing={rawInv?.qty == null} />
      <Tri cx={colX(n - 1) + BOX_W + 34} y={Y_PROC + 4} P={P} qty={fgInv?.qty} days={fgInv?.days}
        label={fgInv?.label} missing={fgInv?.qty == null} />

      {/* ── สายหลัก: กล่อง + ลูกศรผลัก + คงคลังระหว่างทาง ── */}
      {model.chain.map((b, i) => {
        const x = colX(i);
        const nx = model.inventories.find(v => v.pos === `after:${b.key}`);
        return <g key={b.key}>
          <ProcBox b={b} x={x} P={P} onPick={onPickStep} selected={selectedKey === b.key} />
          {i < n - 1 && <>
            <Tri cx={x + BOX_W + (COL_W - BOX_W) / 2} y={Y_PROC + 4} P={P}
              qty={nx?.qty} days={nx?.days} label={nx?.label} missing={nx?.qty == null} />
            <Push x1={x + BOX_W + 2} x2={colX(i + 1) - 2} y={Y_PROC + 74} P={P} />
          </>}
        </g>;
      })}
      <Push x1={PAD_L - 14} x2={colX(0) - 2} y={Y_PROC + 74} P={P} />
      <Push x1={colX(n - 1) + BOX_W + 2} x2={colX(n - 1) + BOX_W + 52} y={Y_PROC + 74} P={P} />

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

      {/* ── สรุปมุมล่างขวา ── */}
      <g>
        <rect x={W - 320} y={Y_LAD + 34} width="300" height="52" fill={P.data} stroke={P.line} strokeWidth="1.2" />
        <text x={W - 312} y={Y_LAD + 50} fontSize="10.5" fill={P.ink}>
          PLT = <tspan fontWeight="800">{fmt(T.pltDays, 2)}</tspan> วัน
          <tspan dx="14">PT = <tspan fontWeight="800">{fmt(T.ptSec)}</tspan> sec</tspan>
        </text>
        <text x={W - 312} y={Y_LAD + 66} fontSize="10.5" fill={P.ink}>
          %VA = VA ÷ (VA+NVA) × 100 = <tspan fontWeight="800" fill={P.va}>{T.vaPct == null ? '—' : `${fmt(T.vaPct, 2)}%`}</tspan>
        </text>
        <text x={W - 312} y={Y_LAD + 80} fontSize="9" fill={P.sub}>
          {fmt(T.vaSec)} ÷ ({fmt(T.vaSec)} + {fmt(T.pltDays, 2)} × {fmt(I.atSec)}) × 100
        </text>
      </g>

      {/* ── กล่องข้อมูลความต้องการ (มุมซ้ายล่างของแถวบน) ── */}
      <g>
        <rect x={26} y={Y_FACT + 82} width="250" height="96" fill={P.data} stroke={P.line} strokeWidth="1.2" />
        {[
          ['Working day', I.workingDays ? `${I.workingDays} วัน/เดือน` : '—'],
          ['Order', I.orderYear ? `${fmt(I.orderYear)} pcs/year` : '—'],
          ['Order', I.orderMonth ? `${fmt(I.orderMonth)} pcs/month` : '—'],
          ['Order', I.orderDay ? `${fmt(I.orderDay)} pcs/day` : '—'],
          ['A/T', secTxt(I.atSec)],
          ['T/T', secTxt(I.ttSec)],
        ].map(([k, v], i) => (
          <g key={i}>
            <text x={36} y={Y_FACT + 98 + i * 14} fontSize="10" fill={P.sub}>{k}</text>
            <text x={266} y={Y_FACT + 98 + i * 14} fontSize="10" fontWeight="700" fill={P.ink} textAnchor="end">{v}</text>
          </g>
        ))}
      </g>
    </svg>
  );
  return svg;
}

/** แถบสัญลักษณ์ — สร้างจาก `SYMBOLS` ตัวเดียวกับที่ผังใช้ */
export function VsmLegend({ palette = PALETTE_DARK }) {
  const P = palette;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '4px 12px',
      alignContent: 'start', padding: '10px 12px', background: P.data, border: `1px solid ${P.line}`, borderRadius: 6,
    }}>
      {SYMBOLS.map(s => (
        <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <svg width="34" height="26" viewBox="0 0 32 26" style={{ flexShrink: 0 }}><Symbol k={s.key} P={P} /></svg>
          <span style={{ fontSize: 11, color: P.sub, lineHeight: 1.25 }}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}
