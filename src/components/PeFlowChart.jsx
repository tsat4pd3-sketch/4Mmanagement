/* ═══ ผังกระบวนการผลิต (Process Flow Chart) — วาดจากข้อมูล pe_processes ═══
   2026-08-17 · ใช้ในแท็บ Flow ของ /pe-docs + ตัวพิมพ์ src/lib/pePfcPrint.js

   ⚠️ นี่คือ "ผังที่ระบบวาดจากข้อมูลในระบบ" ไม่ใช่ไฟล์ PFC เดิมของ PE
      ไฟล์ PFC เดิมเป็นรูปทรง Excel ~560 ชิ้นวางมือข้าม 5 หน้า สร้างใหม่ให้เหมือนเป๊ะไม่ได้
      (ดู docs/PE-FORM-SPEC.md §0.1) · ผังนี้มีข้อดีคือ **ตรงกับรายการ OP เสมอ** แก้ OP แล้วผังเปลี่ยนตาม

   โครงผังถอดจากไฟล์จริง MB3B-8C306-BE:
     แถวบน = ช่องทางเข้าของ child part (OP ที่ kind='incoming_insp') เรียงซ้าย→ขวา
     ด้านล่าง = สายหลักไหลลง แล้ววกเป็นคอลัมน์ถัดไปเมื่อยาวเกินหน้า (ใช้ตัวเชื่อม A-G เหมือนฟอร์มจริง)

   สัญลักษณ์ตามมาตรฐาน ASME/AIAG — นิยามที่ SYMBOLS จุดเดียว legend สร้างจากตัวเดียวกัน
   ⚠️ เพิ่ม kind ใหม่ใน pe_processes ต้องมาเติมที่นี่ ไม่งั้นตกไปเป็นสี่เหลี่ยมเงียบๆ */

/** สัญลักษณ์ต่อชนิดขั้นงาน (ตรงกับ check constraint ของ pe_processes.kind) */
export const SYMBOLS = {
  process: { label: 'ขั้นงาน (Operation)', shape: 'rect', color: '#2563eb' },
  incoming_insp: { label: 'ตรวจรับเข้า (Incoming Insp.)', shape: 'diamond', color: '#7c3aed' },
  inspection: { label: 'ตรวจสอบ (Inspection)', shape: 'diamond', color: '#0891b2' },
  storage: { label: 'จัดเก็บ (Storage)', shape: 'tri', color: '#ca8a04' },
  transport: { label: 'เคลื่อนย้าย (Transport)', shape: 'arrow', color: '#65a30d' },
  rework: { label: 'งานแก้ไข (Rework)', shape: 'rectDash', color: '#dc2626' },
  warehouse: { label: 'คลังสินค้า (Warehouse)', shape: 'tri', color: '#ca8a04' },
  delivery: { label: 'ส่งมอบ (Delivery)', shape: 'arrow', color: '#16a34a' },
};
const symOf = (kind) => SYMBOLS[kind] || SYMBOLS.process;

/* ── ขนาด (หน่วย px ของ viewBox — ตัวพิมพ์สเกลด้วย viewBox ไม่ต้องแก้ตัวเลขพวกนี้) ── */
const NW = 168, NH = 74;          // กล่องขั้นงาน
const GAP_Y = 42, GAP_X = 58;     // ระยะห่างแนวตั้ง/แนวนอน
const IN_W = 150, IN_H = 48;      // ป้าย child part ด้านบน
const IN_NW = 148;                // กล่องขั้นงานของช่องทางเข้า — แคบกว่าสายหลัก เพราะเป็นข้าวหลามตัด ปลายแหลมชนกันง่าย
const IN_PITCH = IN_W + 46;       // ระยะห่างระหว่างช่องทางเข้า (เผื่อปลายข้าวหลามตัด)
const BUS_GAP = 58;               // ช่องว่างระหว่างแถวช่องทางเข้ากับสายหลัก — ที่อยู่ของ "เส้นรวม"
const PAD = 26;
const CONN = 'ABCDEFGHJKLMN';     // ตัวเชื่อมข้ามคอลัมน์ (ไม่ใช้ I กันสับสนกับ 1)
const MAIN_COL_MAX = 8;           // เพดานจำนวนคอลัมน์ของสายหลัก (มากกว่านี้ตัวเชื่อมเยอะจนอ่านยาก)
const IN_COL_MAX = 10;            // เพดานช่องทางเข้าต่อแถว

/* กรอบที่ผังมีจริงบนกระดาษ A3 แนวนอน (มม.) หลังหักหัวเอกสาร/หมายเหตุ/legend/ช่องเซ็น/footer
   ⚠️ ใช้เป็น "เป้า" ในการเลือกทรงผังเท่านั้น ไม่ได้ล็อกขนาดจริง — ตัวพิมพ์ย่อด้วย viewBox อีกที
      (ถ้าเปลี่ยนขนาดกระดาษที่ /doc-forms ผังยังลงหน้าเดียวเสมอ แค่ทรงอาจไม่ได้เหมาะที่สุด) */
const FIT_W = 390, FIT_H = 215;

const dims = (nIn, bandCols, perCol, mainCols) => {
  const bandRows = nIn ? Math.ceil(nIn / bandCols) : 0;
  const bandW = bandRows ? Math.min(nIn, bandCols) * IN_PITCH : 0;
  const bandH = bandRows ? bandRows * (IN_H + NH + GAP_Y + 10) + 18 : 0;
  const mainTop = PAD + bandH + (bandRows ? BUS_GAP : 0);
  const w = Math.max(PAD * 2 + bandW, PAD * 2 + Math.max(1, mainCols) * (NW + GAP_X + 40) - GAP_X - 40) + PAD;
  const h = mainTop + perCol * (NH + GAP_Y) + PAD;
  return { bandRows, bandW, bandH, mainTop, w, h };
};

/**
 * เลือก "ทรงผัง" (ช่องทางเข้าต่อแถว × ขั้นงานต่อคอลัมน์) ที่ย่อลงกระดาษแล้ว **ใหญ่ที่สุด**
 * — คือ maximize min(กว้างกระดาษ/กว้างผัง, สูงกระดาษ/สูงผัง) ตรงๆ ไม่ต้องเดาสัดส่วนเป้าหมาย
 *   (ผังผอมสูงหรืออ้วนเตี้ยเกินไป ต่างก็ถูกกระดาษบีบจนตัวหนังสือเล็ก — สูตรนี้จับได้ทั้งสองทาง)
 */
function pickShape(nIn, nMain) {
  let best = null;
  const perMax = Math.max(1, nMain);
  for (let bc = 1; bc <= Math.max(1, Math.min(nIn || 1, IN_COL_MAX)); bc++) {
    for (let cols = 1; cols <= MAIN_COL_MAX; cols++) {
      const perCol = Math.max(1, Math.ceil(nMain / cols));
      if (perCol > perMax) continue;
      if (cols > 1 && perCol < 3) continue;         // คอลัมน์สั้นเกินไป = ตัวเชื่อมเยอะเกินจำเป็น
      const mainCols = nMain ? Math.ceil(nMain / perCol) : 0;
      const { w, h } = dims(nIn, bc, perCol, mainCols);
      const scale = Math.min(FIT_W / w, FIT_H / h);
      if (!best || scale > best.scale + 1e-9) best = { bandCols: bc, perCol, mainCols, scale };
    }
  }
  return best || { bandCols: 1, perCol: Math.max(1, nMain), mainCols: nMain ? 1 : 0, scale: 1 };
}

/** ตัดข้อความให้พอดีความกว้าง แล้วคืนเป็นบรรทัด (ประมาณจากจำนวนอักษร — ไทย/อังกฤษกว้างต่างกันเล็กน้อย) */
function wrap(text, perLine = 22, maxLines = 2) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const out = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= perLine) cur += ' ' + w;
    else { out.push(cur); cur = w; }
    if (out.length === maxLines) break;
  }
  if (cur && out.length < maxLines) out.push(cur);
  if (out.length === maxLines) {
    const used = out.join(' ').length;
    if (used < String(text || '').length) out[maxLines - 1] = out[maxLines - 1].slice(0, perLine - 1) + '…';
  }
  return out.length ? out : [''];
}

/**
 * คำนวณตำแหน่งทุกชิ้นบนผัง (pure — เทสได้ + ตัวพิมพ์เรียกใช้ตัวเดียวกัน)
 * @param {Array} procs  pe_processes เรียงตาม seq แล้ว
 * @returns {{ nodes, feeds, links, width, height }}
 */
export function layoutFlow(procs = []) {
  const list = [...procs].sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0) || String(a.op_no).localeCompare(String(b.op_no), undefined, { numeric: true }));
  const incoming = list.filter((p) => p.kind === 'incoming_insp');
  const main = list.filter((p) => p.kind !== 'incoming_insp');

  const nodes = [], feeds = [], links = [];

  /* เลือกทรงผังก่อน แล้วค่อยวางของ — ทั้งแถวช่องทางเข้าและคอลัมน์สายหลักถูกเลือกพร้อมกัน */
  const shape = pickShape(incoming.length, main.length);
  const { bandCols, perCol } = shape;
  const { bandW, bandH, bandRows, mainTop, w: width, h: height } = dims(incoming.length, bandCols, perCol, shape.mainCols);

  /* แถวบน: ช่องทางเข้า child part — เรียงซ้าย→ขวา (ถ้าไม่มี incoming เลย ก็ไม่มีแถวนี้) */
  incoming.forEach((p, i) => {
    const col = i % bandCols, row = Math.floor(i / bandCols);
    const x = PAD + col * IN_PITCH;
    const y = PAD + row * (IN_H + NH + GAP_Y + 10);
    feeds.push({ id: `f${p.id}`, proc: p, x, y, w: IN_W, h: IN_H, parts: String(p.child_parts || '').split('\n').filter(Boolean) });
    nodes.push({ id: p.id, proc: p, x: x + (IN_W - IN_NW) / 2, y: y + IN_H + 22, w: IN_NW, h: NH, incoming: true });
    links.push({ from: `f${p.id}`, to: p.id, kind: 'feed' });
  });
  /* สายหลัก: ไหลลงในคอลัมน์ แล้ววกไปคอลัมน์ถัดไป */
  main.forEach((p, i) => {
    const col = Math.floor(i / perCol), row = i % perCol;
    nodes.push({
      id: p.id, proc: p,
      x: PAD + col * (NW + GAP_X + 40),
      y: mainTop + row * (NH + GAP_Y),
      w: NW, h: NH,
    });
    if (i > 0) {
      const prevCol = Math.floor((i - 1) / perCol);
      links.push({ from: main[i - 1].id, to: p.id, kind: prevCol === col ? 'down' : 'jump', tag: prevCol === col ? null : CONN[prevCol] || '?' });
    }
  });

  /* เส้นรวมช่องทางเข้า → สายหลัก: วาดเป็น "บัส" เส้นเดียว (ตอสั้นจากแต่ละช่อง → เส้นนอน → ลูกศรลงเข้าขั้นแรก)
     ⚠️ ห้ามลากเส้นแยกจากทุกช่องมาบรรจบจุดเดียว — 9 เส้นทับกันเป็นพงรก และพาดทับตัวเชื่อม A/B/C */
  const bus = (main.length && incoming.length) ? (() => {
    const ins = nodes.filter((n) => n.incoming);
    const lastRowY = Math.max(...ins.map((n) => n.y + n.h));
    const y = mainTop - Math.round(BUS_GAP * 0.72);   // เว้นให้พ้นวงกลมตัวเชื่อม A/B/C ที่อยู่ที่ mainTop-22
    const target = nodes.find((n) => n.id === main[0].id);
    const tx = target.x + target.w / 2;
    /* ⚠️ ช่องทางเข้าที่ "ไม่ได้อยู่แถวล่างสุด" ต้องเดินสายอ้อมข้าง (ช่องว่างระหว่างคอลัมน์)
       ถ้าลากตรงลงมาจะทะลุกล่องของแถวถัดไป · เคยพลาด: แถวบนไม่มีเส้นต่อลงบัสเลย */
    const stubs = ins.map((n) => {
      const cx = n.x + n.w / 2, by = n.y + n.h;
      if (by === lastRowY) return { d: `M ${cx} ${by} V ${y}`, x: cx };
      const side = Math.max(6, n.x - 14);
      return { d: `M ${cx} ${by} V ${by + 12} H ${side} V ${y}`, x: side };
    });
    const xs = stubs.map((s) => s.x);
    return { y, x1: Math.min(...xs, tx), x2: Math.max(...xs, tx), stubs, targetX: tx, targetY: target.y };
  })() : null;

  return { nodes, feeds, links, bus, width: Math.max(width, 640), height: Math.max(height, 320), perCol, bandCols };
}

/* ── รูปทรงของขั้นงาน (คืน element เดียว) ── */
function Shape({ n, theme }) {
  const s = symOf(n.proc.kind);
  const { x, y, w, h } = n;
  const fill = theme.nodeFill, stroke = s.color;
  const common = { fill, stroke, strokeWidth: 2 };
  if (s.shape === 'diamond') return <polygon points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`} {...common} />;
  if (s.shape === 'tri') return <polygon points={`${x},${y} ${x + w},${y} ${x + w / 2},${y + h}`} {...common} />;
  if (s.shape === 'arrow') return <polygon points={`${x},${y + h * 0.22} ${x + w * 0.72},${y + h * 0.22} ${x + w * 0.72},${y} ${x + w},${y + h / 2} ${x + w * 0.72},${y + h} ${x + w * 0.72},${y + h * 0.78} ${x},${y + h * 0.78}`} {...common} />;
  return <rect x={x} y={y} width={w} height={h} rx={6} {...common} strokeDasharray={s.shape === 'rectDash' ? '6 4' : undefined} />;
}

/** จุดต่อของ node ตามรูปทรง (สามเหลี่ยม/ข้าวหลามตัดขอบไม่เท่าสี่เหลี่ยม) */
const anchor = (n, side) => {
  const s = symOf(n.proc.kind);
  const cx = n.x + n.w / 2;
  if (side === 'top') return [cx, s.shape === 'diamond' ? n.y : n.y];
  return [cx, s.shape === 'tri' ? n.y + n.h : n.y + n.h];
};

/**
 * ผังกระบวนการ (SVG)
 * @param {Array} procs      pe_processes ของชุดที่เลือก
 * @param {Function} onPick  คลิกที่ขั้นงาน (optional)
 * @param {'dark'|'light'} mode  light = ชุดสีสำหรับพิมพ์
 */
export default function PeFlowChart({ procs = [], onPick, mode = 'dark', highlight = null }) {
  const { nodes, feeds, links, bus, width, height } = layoutFlow(procs);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const feedById = Object.fromEntries(feeds.map((f) => [f.id, f]));

  const theme = mode === 'light'
    ? { bg: '#ffffff', nodeFill: '#ffffff', text: '#111827', muted: '#6b7280', line: '#9ca3af', feedFill: '#f9fafb', feedStroke: '#d1d5db' }
    : { bg: 'transparent', nodeFill: 'var(--card)', text: 'var(--text)', muted: 'var(--muted)', line: 'var(--border2)', feedFill: 'var(--bg2)', feedStroke: 'var(--border)' };

  if (!procs.length) return null;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: '100%', background: theme.bg, display: 'block' }} role="img" aria-label="ผังกระบวนการผลิต">
      <defs>
        <marker id="pfcArrow" markerWidth="9" markerHeight="9" refX="7" refY="3.2" orient="auto">
          <path d="M0,0 L7,3.2 L0,6.4 z" fill={theme.line} />
        </marker>
      </defs>

      {/* เส้นเชื่อม */}
      {links.map((l, i) => {
        const to = byId[l.to];
        if (!to) return null;
        const [tx, ty] = anchor(to, 'top');
        if (l.kind === 'feed') {
          const f = feedById[l.from];
          if (!f) return null;
          return <line key={i} x1={f.x + f.w / 2} y1={f.y + f.h} x2={tx} y2={ty} stroke={theme.line} strokeWidth={1.6} markerEnd="url(#pfcArrow)" />;
        }
        const from = byId[l.from];
        if (!from) return null;
        const [fx, fy] = anchor(from, 'bottom');
        if (l.kind === 'down') return <line key={i} x1={fx} y1={fy} x2={tx} y2={ty} stroke={theme.line} strokeWidth={1.8} markerEnd="url(#pfcArrow)" />;
        /* ข้ามคอลัมน์ — วาดตัวเชื่อมวงกลม 2 ตัว (A/B/C…) เหมือนฟอร์มจริง ไม่ลากเส้นยาวข้ามผัง */
        return (
          <g key={i}>
            <circle cx={fx} cy={fy + 22} r={13} fill={theme.nodeFill} stroke={theme.line} strokeWidth={1.6} />
            <text x={fx} y={fy + 27} textAnchor="middle" fontSize={13} fontWeight="700" fill={theme.text}>{l.tag}</text>
            <line x1={fx} y1={fy} x2={fx} y2={fy + 9} stroke={theme.line} strokeWidth={1.8} />
            <circle cx={tx} cy={ty - 22} r={13} fill={theme.nodeFill} stroke={theme.line} strokeWidth={1.6} />
            <text x={tx} y={ty - 17} textAnchor="middle" fontSize={13} fontWeight="700" fill={theme.text}>{l.tag}</text>
            <line x1={tx} y1={ty - 9} x2={tx} y2={ty} stroke={theme.line} strokeWidth={1.8} markerEnd="url(#pfcArrow)" />
          </g>
        );
      })}

      {/* เส้นรวมช่องทางเข้า (บัส) — ตอสั้นจากทุกช่อง → เส้นนอนเส้นเดียว → ลูกศรลงเข้าขั้นงานแรก */}
      {bus && (
        <g>
          {bus.stubs.map((s, i) => <path key={i} d={s.d} fill="none" stroke={theme.line} strokeWidth={1.3} strokeDasharray="5 4" />)}
          <line x1={bus.x1} y1={bus.y} x2={bus.x2} y2={bus.y} stroke={theme.line} strokeWidth={1.6} />
          <line x1={bus.targetX} y1={bus.y} x2={bus.targetX} y2={bus.targetY} stroke={theme.line} strokeWidth={1.8} markerEnd="url(#pfcArrow)" />
        </g>
      )}

      {/* ป้าย child part ที่เข้ากระบวนการ */}
      {feeds.map((f) => (
        <g key={f.id}>
          <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={5} fill={theme.feedFill} stroke={theme.feedStroke} strokeWidth={1.2} strokeDasharray="4 3" />
          {(f.parts.length ? f.parts : ['(ยังไม่ระบุ child part)']).slice(0, 2).map((p, i) => (
            <text key={i} x={f.x + f.w / 2} y={f.y + 19 + i * 15} textAnchor="middle" fontSize={11} fill={theme.text}>{p.length > 24 ? `${p.slice(0, 23)}…` : p}</text>
          ))}
          {f.parts.length > 2 && <text x={f.x + f.w / 2} y={f.y + 45} textAnchor="middle" fontSize={10} fill={theme.muted}>+ อีก {f.parts.length - 2}</text>}
        </g>
      ))}

      {/* ขั้นงาน */}
      {nodes.map((n) => {
        const s = symOf(n.proc.kind);
        const nameLines = wrap(n.proc.name, 21, 2);
        const isTri = s.shape === 'tri';
        const cx = n.x + n.w / 2;
        const ty = n.y + (isTri ? 22 : 26);
        const on = highlight && highlight === n.proc.id;
        return (
          <g key={n.id} onClick={onPick ? () => onPick(n.proc) : undefined} style={{ cursor: onPick ? 'pointer' : 'default' }}>
            {on && <rect x={n.x - 5} y={n.y - 5} width={n.w + 10} height={n.h + 10} rx={9} fill="none" stroke={s.color} strokeWidth={3} opacity={0.55} />}
            <Shape n={n} theme={theme} />
            <text x={cx} y={ty} textAnchor="middle" fontSize={13} fontWeight="800" fill={s.color}>OP {n.proc.op_no}</text>
            {nameLines.map((ln, i) => (
              <text key={i} x={cx} y={ty + 16 + i * 13} textAnchor="middle" fontSize={11} fill={theme.text}>{ln}</text>
            ))}
            {n.proc.machine_no && !isTri && (
              <text x={cx} y={ty + 16 + nameLines.length * 13} textAnchor="middle" fontSize={10} fill={theme.muted}>🔧 {n.proc.machine_no}</text>
            )}
            {n.proc.special_class && (
              <>
                <rect x={n.x + n.w - 30} y={n.y + 4} width={26} height={15} rx={3} fill="#dc2626" />
                <text x={n.x + n.w - 17} y={n.y + 15} textAnchor="middle" fontSize={10} fontWeight="800" fill="#fff">{String(n.proc.special_class).slice(0, 3)}</text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** แถบสัญลักษณ์ — สร้างจาก SYMBOLS ตัวเดียวกับผัง (เพิ่ม kind แล้ว legend ตามเอง) */
export function FlowLegend({ procs = [], mode = 'dark' }) {
  const used = new Set(procs.map((p) => (SYMBOLS[p.kind] ? p.kind : 'process')));
  const color = mode === 'light' ? '#374151' : 'var(--text2)';
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color }}>
      {Object.entries(SYMBOLS).filter(([k]) => used.has(k)).map(([k, s]) => (
        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <svg width="22" height="16" viewBox="0 0 22 16">
            <Shape n={{ x: 1, y: 1, w: 20, h: 14, proc: { kind: k } }} theme={{ nodeFill: mode === 'light' ? '#fff' : 'var(--card)' }} />
          </svg>
          {s.label}
        </span>
      ))}
    </div>
  );
}
