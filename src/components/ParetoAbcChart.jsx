import { useState, useMemo, useEffect } from 'react';
import { clusterNotes } from '../utils/textCluster';

/* ── Pareto + ABC Analysis + Drill-down (ใช้ร่วมทุกกราฟพาเรโต) — 2026-08-04 คำสั่ง user ────────
   1) ABC: จัดกลุ่มตาม % สะสม (A ≤80% ตัวหลัก · B ≤95% · C หางยาว) — สีตามกลุ่ม ไม่ใช่สีรายประเภท
   2) **ความหนาแท่งไม่เท่ากันตามกลุ่ม** — A หนา+ชื่อเต็ม · B บาง+ชื่อย่อ · C บางมาก (ในโหมดย่อ
      ยุบเป็นแถบเดียว) — ให้สายตาไปที่ A ก่อน · วาดด้วย HTML ไม่ใช่ Recharts เพราะ Recharts
      บังคับทุกแถวสูงเท่ากัน → ข้อมูลเยอะแล้ว **ชื่อบนแกน Y เขียนทับกัน** (บั๊กที่เจอจริง 2026-08-05)
   3) **คลิกแท่ง = เจาะลึก** แยกตามมิติที่เกี่ยวข้อง (เครื่องจักร/ไลน์/ชิ้นงาน/กะ/คน/วัน) + เห็นรายการดิบ
   4) **มิติ `cluster:true` = จับกลุ่มจากข้อความอิสระ** (หมายเหตุพนักงาน) ด้วย `utils/textCluster` —
      แก้เคส "อื่นๆ" ครองอันดับ 1 แต่บอกอะไรไม่ได้ (2026-08-05) · แถวที่ไม่ได้กรอกโน้ตแสดงแยก ไม่กลบ
   รับ `records` (แถวดิบ flat) แล้ว component รวมยอดเอง → เจาะได้ทุกมิติโดยไม่ต้อง query ใหม่ */

const ABC = {
  A: { color: '#ef4444', label: 'A', desc: 'ตัวหลัก (80% ของปัญหา)' },
  B: { color: '#f59e0b', label: 'B', desc: 'รอง (80–95%)' },
  C: { color: '#6b7280', label: 'C', desc: 'หางยาว (5% สุดท้าย)' },
};
const OPA = { A: 1, B: 0.75, C: 0.45 };
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// จัดกลุ่ม ABC จาก % สะสม — รายการแรกเป็น A เสมอ (กันเคสรายการเดียวกินเกิน 80% แล้วไม่มี A)
export function classifyAbc(items, valueOf) {
  const sorted = [...items].sort((a, b) => valueOf(b) - valueOf(a));
  const total = sorted.reduce((s, d) => s + (valueOf(d) || 0), 0);
  let run = 0;
  return sorted.map((d, i) => {
    const v = valueOf(d) || 0;
    const prevCum = total > 0 ? run / total * 100 : 0;
    run += v;
    return { ...d, _val: v, _pct: total > 0 ? v / total * 100 : 0, _cum: total > 0 ? run / total * 100 : 0,
      _cls: i === 0 || prevCum < 80 ? 'A' : prevCum < 95 ? 'B' : 'C' };
  });
}

/* 💰 มูลค่าเป็นบาทต่อแถว (`r.baht`) — optional
   `baht == null` = **ตีมูลค่าไม่ได้** (ไลน์ไม่มี activity rate / พาร์ทไม่มีต้นทุน)
   ห้ามตีเป็น 0 เพราะจะทำให้พาเรโตเรียงตามเงินชี้เป้าผิด → นับแยกเป็น `unpriced` แล้วบอกบนจอ */
const sumBaht = (recs) => {
  let baht = 0, unpriced = 0;
  recs.forEach(r => { if (r?.baht == null) unpriced++; else baht += Number(r.baht) || 0; });
  return { baht, unpriced };
};

const groupBy = (records, keyOf) => {
  const m = {};
  records.forEach(r => {
    const k = keyOf(r) || '(ไม่ระบุ)';
    const g = m[k] || (m[k] = { name: k, value: 0, count: 0, baht: 0, unpriced: 0 });
    g.value += r.value || 0;
    g.count++;
    if (r.baht == null) g.unpriced++; else g.baht += Number(r.baht) || 0;
  });
  return Object.values(m);
};

export default function ParetoAbcChart({
  title, records = [], dims = [], unit, height = 240,
  emptyText = 'ไม่มีข้อมูล', sectionStyle, titleStyle,
  /* focus = สั่งเปิดหน้าต่างเจาะจากภายนอก (เช่นการ์ด "💰 มูลค่าดาวไทม์" กด Top-5 แล้วเจาะทันที)
     รูปแบบ { cat, measure?, dim?, n } — `n` เป็น nonce: กดชื่อเดิมซ้ำต้องเปิดใหม่ได้
     ⚠️ ตั้ง measure ให้ตรงกับสิ่งที่คนกดมา (กดจากการ์ดเงิน = ต้องได้แกนบาท ไม่งั้นเรียงคนละชุดกับที่เห็น) */
  focus = null,
}) {
  const [open, setOpen] = useState(false);
  const [drill, setDrill] = useState(null);           // ชื่อประเภทที่กำลังเจาะ
  // ดีฟอลต์ = มิติปกติตัวแรก (มิติ cluster ถูกเลือกให้อัตโนมัติเฉพาะตอนเจาะ "อื่นๆ")
  const [dimKey, setDimKey] = useState(dims.find(d => !d.cluster)?.key || dims[0]?.key || null);
  /* แกนที่ใช้จัดอันดับ/แบ่ง ABC — 'value' (นาที/ชิ้น) หรือ 'baht'
     ⚠️ default = 'value' โดยตั้งใจ: ตัวเลขที่คนหน้างานคุ้นเคยต้องไม่เปลี่ยนเองหลัง deploy
     แต่ "เรียงตามเงิน" คือคำถามของผู้บริหาร — 5 นาทีของไลน์แพงอาจสำคัญกว่า 30 นาทีของไลน์ถูก */
  const [measure, setMeasure] = useState('value');
  const hasMoney = useMemo(() => records.some(r => r?.baht != null), [records]);
  const money = hasMoney && measure === 'baht';
  const valOf = (d) => (money ? (d.baht || 0) : (d.value || 0));
  const unitOf = money ? 'บาท' : unit;

  const rows = useMemo(() => classifyAbc(groupBy(records, r => r.cat), valOf), [records, money]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = rows.reduce((s, d) => s + d._val, 0);
  const recTotals = useMemo(() => sumBaht(records), [records]);
  const groups = useMemo(() => {
    const g = { A: [], B: [], C: [] };
    rows.forEach(r => g[r._cls].push(r));
    return g;
  }, [rows]);

  // ── ข้อมูลของประเภทที่เจาะ ──
  const drillRecs = useMemo(() => (drill ? records.filter(r => (r.cat || '(ไม่ระบุ)') === drill) : []), [records, drill]);
  const drillDim = useMemo(() => dims.find(d => d.key === dimKey) || null, [dims, dimKey]);
  // มิติแบบ cluster = จับกลุ่มข้อความอิสระ (หมายเหตุ) · มิติปกติ = group ตามค่าในฟิลด์
  const drillCluster = useMemo(() => (drillDim?.cluster
    ? clusterNotes(drillRecs, r => r[dimKey], r => r.value) : null), [drillDim, drillRecs, dimKey]);
  const drillRows = useMemo(() => {
    if (!dimKey) return [];
    if (!drillCluster) return classifyAbc(groupBy(drillRecs, r => r[dimKey]), valOf);
    // แถวที่ไม่ได้กรอกหมายเหตุนับรวมในพาเรโตด้วย — ถ้ามันขึ้นกลุ่ม A แปลว่าปัญหาอยู่ที่วินัยการบันทึก
    // มูลค่าเป็นบาทของแต่ละกลุ่มคำ = รวมจาก `recs` ของกลุ่มนั้น (clusterNotes คืนแถวดิบมาให้)
    const m = drillCluster.missing;
    const items = [
      ...drillCluster.clusters.map(c => ({ ...c, ...sumBaht(c.recs || []) })),
      ...(m.count > 0 ? [{ name: '(ไม่ได้กรอกหมายเหตุ)', value: m.value, count: m.count, _noNote: true, ...sumBaht(m.recs || []) }] : []),
    ];
    return classifyAbc(items, valOf);
  }, [drillRecs, dimKey, drillCluster, money]); // eslint-disable-line react-hooks/exhaustive-deps
  const drillTotal = drillRecs.reduce((s, r) => s + (money ? (Number(r.baht) || 0) : (r.value || 0)), 0);
  const drillTotals = useMemo(() => sumBaht(drillRecs), [drillRecs]);

  // ประเภทที่ "ไม่บอกอะไร" (อื่นๆ/ไม่ระบุ) — ถ้าติดกลุ่ม A ต้องชวนให้ไปเจาะ ไม่ปล่อยเป็นอันดับ 1 ลอยๆ
  const noteDim = dims.find(d => d.cluster) || null;
  const vagueA = useMemo(() => (noteDim
    ? groups.A.filter(d => /อื่น|ไม่ระบุ|etc|other/i.test(d.name)) : []), [groups, noteDim]);

  const openDrill = (name, dim) => {
    setDrill(name);
    // เปิดจากชิป "อื่นๆ" → เด้งเข้ามิติหมายเหตุให้เลย (คนกดเพราะอยากรู้ว่ามันคืออะไร)
    const want = dim || (noteDim && /อื่น|ไม่ระบุ|etc|other/i.test(name) ? noteDim.key : null);
    if (want) setDimKey(want);
    else if (!dimKey) setDimKey((dims.find(d => !d.cluster) || dims[0])?.key || null);
  };

  /* เปิดการเจาะจากภายนอกตาม prop focus — ผูกกับ n (nonce) เพื่อให้กดชื่อเดิมซ้ำแล้วเปิดใหม่ได้
     ⚠️ ประเภทที่ส่งมาต้องมีอยู่จริงในชุดข้อมูล ไม่งั้นได้หน้าต่างเปล่า → เช็คก่อนเปิด */
  const focusN = focus?.n;
  useEffect(() => {
    if (!focus?.cat || !dims.length) return;
    if (!records.some(r => (r.cat || '(ไม่ระบุ)') === focus.cat)) return;
    if (focus.measure === 'baht' && hasMoney) setMeasure('baht');
    else if (focus.measure === 'value') setMeasure('value');
    openDrill(focus.cat, focus.dim);
  }, [focusN]); // eslint-disable-line react-hooks/exhaustive-deps

  const tip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload; const m = ABC[d._cls];
    return (
      <div style={{ background: 'var(--bg3)', border: `1px solid ${m.color}66`, borderLeft: `3px solid ${m.color}`, borderRadius: 7, padding: '8px 11px', fontSize: 12, maxWidth: 290 }}>
        <div style={{ fontWeight: 800, color: 'var(--text)', marginBottom: 3 }}>{d.name}</div>
        <div style={{ color: m.color, fontWeight: 700 }}>กลุ่ม {m.label} · {m.desc}</div>
        <div style={{ color: 'var(--text2)', marginTop: 3 }}>{fmt(d._val)} {unitOf} · <b>{d._pct.toFixed(1)}%</b> ของทั้งหมด · {d.count} ครั้ง</div>
        <div style={{ color: 'var(--muted)' }}>สะสมถึงรายการนี้ {d._cum.toFixed(1)}%</div>
        {dims.length > 0 && <div style={{ color: 'var(--accent)', marginTop: 4, fontWeight: 700 }}>🔍 คลิกเพื่อเจาะลึก</div>}
      </div>
    );
  };

  // แกน Y: ชื่อเฉพาะกลุ่ม A · ที่เหลือเป็นจุด
  const yTick = ({ x, y, payload }) => {
    const d = rows[payload.index]; if (!d) return null;
    const isA = d._cls === 'A';
    return (
      <text x={x} y={y} dy={4} textAnchor="end" fill={isA ? 'var(--text)' : 'var(--muted)'}
        fontSize={isA ? 11 : 13} fontWeight={isA ? 700 : 400}>
        {isA ? (d.name.length > 22 ? d.name.slice(0, 21) + '…' : d.name) : '·'}
      </text>
    );
  };

  // ── แท่ง HTML: ความหนา/ขนาดตัวอักษรต่างกันตามกลุ่ม ABC (Recharts ทำไม่ได้ — ทุก band สูงเท่ากัน) ──
  const BAR = { A: { h: 20, font: 12, name: true }, B: { h: 11, font: 11, name: true }, C: { h: 6, font: 10.5, name: false } };
  const maxVal = Math.max(1, ...rows.map(d => d._val));

  const barRow = (d, i, { showName, compact }) => {
    const m = ABC[d._cls]; const cfg = BAR[d._cls];
    const nameShown = showName || cfg.name;
    return (
      <div key={i} onClick={() => dims.length && openDrill(d.name)}
        title={`${d.name} · ${fmt(d._val)} ${unitOf} (${d._pct.toFixed(1)}%) · ${d.count} ครั้ง · สะสม ${d._cum.toFixed(1)}%`
          + (hasMoney ? ` · ${money ? `${fmt(d.value)} ${unit}` : `${fmt(d.baht)} บาท`}${d.unpriced ? ` · ตีมูลค่าไม่ได้ ${d.unpriced} รายการ` : ''}` : '')}
        style={{ display: 'grid', gridTemplateColumns: nameShown ? `minmax(0, ${compact ? '38%' : '30%'}) 1fr auto` : '1fr auto',
          alignItems: 'center', gap: 8, cursor: dims.length ? 'pointer' : 'default',
          padding: d._cls === 'A' ? '3px 0' : '1.5px 0' }}>
        {nameShown && (
          <span style={{ fontSize: cfg.font, fontWeight: d._cls === 'A' ? 700 : 500,
            color: d._cls === 'A' ? 'var(--text)' : 'var(--text2)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right' }}>{d.name}</span>
        )}
        <span style={{ display: 'block', background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden', height: cfg.h }}>
          <span style={{ display: 'block', height: '100%', width: `${Math.max(1.5, d._val / maxVal * 100)}%`,
            background: m.color, opacity: OPA[d._cls], borderRadius: 3 }} />
        </span>
        <span style={{ fontSize: d._cls === 'A' ? 11.5 : 10.5, fontWeight: d._cls === 'A' ? 800 : 600,
          color: d._cls === 'A' ? m.color : 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {fmt(d._val)}{d._cls === 'A' ? ` (${d._pct.toFixed(0)}%)` : ''}
        </span>
      </div>
    );
  };

  /* ── โหมดย่อ: แท่ง Top N · ที่เหลือยุบแถวเดียว (2026-09-02 · คำสั่ง user "default top10 พอมั้ย
        ที่เหลือยุบไว้ ไปโชว์ตอนกดขยาย") ──
     เดิมยุบเฉพาะกลุ่ม C ⇒ Downtime ยัง render A(13)+B(10) = 23 แท่ง สูงเกือบ 700px
     บนจอที่คนอ่านจริงแค่ 5-6 อันดับแรก
     ⚠️ กฎที่ห้ามแหก:
       · **การจัดกลุ่ม ABC ยังคำนวณจาก "ทุกรายการ" เหมือนเดิม** — ป้าย "A · 13 รายการ (81%)"
         ต้องเป็นความจริงของทั้งชุด ไม่ใช่ของ 10 อันที่โชว์ (ไม่งั้นเปอร์เซ็นต์โกหก)
       · **ห้ามซ่อนเงียบ** — แถวที่ยุบต้องบอกจำนวน + ยอดรวม + % และกดเปิดดูครบได้
       · **ชิป "เน้นแก้กลุ่ม A" ด้านล่างยังโชว์ครบทุกตัว** = ลิสต์งานที่ต้องแก้ไม่มีวันหาย
         (ตัวที่ยุบไปในกราฟยังอ่านชื่อได้จากชิป) */
  const TOP_N = 10;
  // เหลือเกิน 1 รายการถึงคุ้มที่จะยุบ (ยุบ 1 แถวเพื่อได้ 1 แถวคืน = ไม่ได้อะไร)
  const nShow = rows.length > TOP_N + 1 ? TOP_N : rows.length;
  const chartCompact = () => {
    const rest = rows.slice(nShow);
    const rSum = rest.reduce((s2, d) => s2 + d._val, 0);
    const restA = rest.filter(d => d._cls === 'A').length;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {rows.slice(0, nShow).map((d, i) => barRow(d, i, { compact: true }))}
        {rest.length > 0 && (
          <div onClick={() => setOpen(true)} title={`อีก ${rest.length} รายการ · รวม ${fmt(rSum)} ${unitOf} — กดดูครบทุกรายการ`}
            style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 38%) 1fr auto', alignItems: 'center', gap: 8, cursor: 'pointer', paddingTop: 3 }}>
            <span style={{ fontSize: 10.5, color: 'var(--muted)', textAlign: 'right' }}>
              ⤢ อีก {rest.length} รายการ{restA > 0 ? ` (กลุ่ม A ${restA})` : ''}
            </span>
            <span style={{ display: 'block', background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden', height: 6 }}>
              <span style={{ display: 'block', height: '100%', width: `${Math.max(1.5, rSum / maxVal * 100)}%`, background: ABC.C.color, opacity: OPA.C }} />
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              {fmt(rSum)} ({(rSum / total * 100).toFixed(0)}%)
            </span>
          </div>
        )}
      </div>
    );
  };

  // โหมดขยาย: ทุกรายการมีชื่อ (C ก็เห็น) ความหนายังต่างกันตามกลุ่ม
  const chartFull = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {rows.map((d, i) => barRow(d, i, { showName: true }))}
    </div>
  );

  const strip = (
    <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', background: 'var(--bg3)', marginBottom: 8 }}>
      {['A', 'B', 'C'].map(k => {
        const sum = groups[k].reduce((s, d) => s + d._val, 0);
        return sum > 0 ? <div key={k} style={{ width: `${sum / total * 100}%`, background: ABC[k].color, opacity: OPA[k] }}
          title={`${k}: ${groups[k].length} รายการ · ${fmt(sum)} ${unitOf}`} /> : null;
      })}
    </div>
  );

  if (!rows.length) {
    return (
      <div style={sectionStyle}>
        <div style={titleStyle}>{title}</div>
        <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 13 }}>{emptyText}</div>
      </div>
    );
  }

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={titleStyle}>{title}</div>
        {/* 💰 สลับแกนจัดอันดับ นาที ↔ บาท — "5 นาทีของไลน์แพง อาจสำคัญกว่า 30 นาทีของไลน์ถูก"
            เปลี่ยนทั้งลำดับและการแบ่งกลุ่ม ABC (ไม่ใช่แค่โชว์ตัวเลขเพิ่ม) */}
        {hasMoney && (
          <div style={{ flexShrink: 0, display: 'flex', gap: 4, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 7, padding: 2 }}>
            {[['value', unit], ['baht', '฿ บาท']].map(([k, lb]) => (
              <button key={k} onClick={() => setMeasure(k)}
                title={k === 'baht' ? 'เรียงตามมูลค่าความสูญเสีย (นาที/60 × activity rate ของไลน์)' : `เรียงตาม${unit}`}
                style={{ background: measure === k ? 'var(--accent)' : 'transparent', color: measure === k ? '#04140a' : 'var(--text2)',
                  border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 800, padding: '3px 9px', cursor: 'pointer' }}>{lb}</button>
            ))}
          </div>
        )}
        <button onClick={() => setOpen(true)} title="ขยายดูทุกรายการ"
          style={{ flexShrink: 0, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 7, color: 'var(--text2)', fontSize: 11.5, fontWeight: 700, padding: '3px 9px', cursor: 'pointer' }}>⤢ ขยาย</button>
      </div>
      {/* มูลค่ารวม + ส่วนที่ตีมูลค่าไม่ได้ — ห้ามเงียบ ไม่งั้นยอดเงินดูเหมือนครบทั้งที่ขาด */}
      {hasMoney && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, lineHeight: 1.55 }}>
          💰 มูลค่ารวม <b style={{ color: '#fbbf24' }}>{fmt(recTotals.baht)} บาท</b>
          {recTotals.unpriced > 0 && (
            <span style={{ color: '#f59e0b' }}> · ⚠ ตีมูลค่าไม่ได้ {recTotals.unpriced} รายการ
              (ไลน์ยังไม่ตั้ง cost center / activity rate — ตั้งที่ ผังองค์กร → 💰 Activity Rate)</span>
          )}
          {money && <span> · กำลังเรียงตามเงิน — ลำดับและกลุ่ม ABC เปลี่ยนตามมูลค่า ไม่ใช่{unit}</span>}
        </div>
      )}
      {strip}
      {/* "อื่นๆ / ไม่ระบุ" ติดกลุ่ม A = อันดับต้นๆ แต่บอกอะไรไม่ได้ → ชี้ทางไปดูหมายเหตุจริงทันที */}
      {vagueA.map((d, i) => (
        <div key={i} onClick={() => openDrill(d.name, noteDim.key)}
          style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', cursor: 'pointer', marginBottom: 8,
            background: '#f59e0b14', border: '1px solid #f59e0b55', borderRadius: 8, padding: '6px 10px', fontSize: 11.5, color: 'var(--text2)' }}>
          <b style={{ color: '#f59e0b' }}>“{d.name}” = {d._pct.toFixed(0)}% แต่ยังไม่บอกสาเหตุ</b>
          <span>— กดดูหมายเหตุที่พนักงานเขียนจริง แยกเป็นกลุ่มสาเหตุให้แล้ว</span>
          <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontWeight: 800, whiteSpace: 'nowrap' }}>{noteDim.label} →</span>
        </div>
      ))}
      {chartCompact()}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 10.5, color: 'var(--muted)', marginTop: 6 }}>
        {['A', 'B', 'C'].map(k => groups[k].length > 0 && (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: ABC[k].color, opacity: OPA[k] }} />
            {k} · {groups[k].length} รายการ ({(groups[k].reduce((s, d) => s + d._val, 0) / total * 100).toFixed(0)}%)
          </span>
        ))}
        {/* บอกให้ชัดว่ากราฟตัดที่เท่าไหร่ — ป้าย A/B/C ข้างบนเป็นของ "ทุกรายการ" ไม่ใช่ของที่เห็น */}
        {rows.length > nShow && (
          <span style={{ color: 'var(--muted)' }}>
            กราฟแสดง {nShow} อันดับแรกจาก {rows.length} · สัดส่วน A/B/C ข้างบนนับครบทุกรายการ
          </span>
        )}
        {dims.length > 0 && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>🔍 คลิกแท่ง/ชิป = เจาะลึก</span>}
      </div>
      {/* เน้นกลุ่ม A — ตัวที่ต้องแก้ก่อน (คลิกเจาะได้) */}
      <div style={{ marginTop: 9, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: ABC.A.color }}>เน้นแก้กลุ่ม A →</span>
        {groups.A.map((d, i) => (
          <span key={i} onClick={() => dims.length && openDrill(d.name)}
            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: `${ABC.A.color}1e`, border: `1px solid ${ABC.A.color}55`, color: ABC.A.color, fontWeight: 700, cursor: dims.length ? 'pointer' : 'default' }}>
            {d.name}: {fmt(d._val)} {unitOf} ({d._pct.toFixed(0)}%)
          </span>
        ))}
      </div>

      {/* ── popup ขยาย: เห็นครบทุกรายการ + ตาราง (คลิกแถวเจาะได้) ── */}
      {open && (
        <div onClick={() => setOpen(false)} style={ovl(1250)}>
          <div onClick={e => e.stopPropagation()} style={{ ...panel, maxWidth: 980 }}>
            <div style={head}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                  ABC Analysis · รวม {fmt(total)} {unitOf} · {rows.length} รายการ — <b style={{ color: ABC.A.color }}>กลุ่ม A {groups.A.length} รายการ = {(groups.A.reduce((s, d) => s + d._val, 0) / total * 100).toFixed(0)}%</b>
                </div>
              </div>
              <button onClick={() => setOpen(false)} style={closeBtn}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '14px 20px 20px' }}>
              {chartFull()}
              <div style={{ overflowX: 'auto', marginTop: 14 }}>
                <table style={tbl}>
                  <thead><tr style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                    <th style={thL}>#</th><th style={thL}>รายการ</th><th style={thC}>กลุ่ม</th>
                    <th style={thR}>{unitOf}</th>{hasMoney && <th style={thR}>{money ? unit : 'บาท'}</th>}<th style={thR}>ครั้ง</th><th style={thR}>%</th><th style={thR}>สะสม %</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((d, i) => (
                      <tr key={i} onClick={() => dims.length && openDrill(d.name)}
                        style={{ borderBottom: '1px solid var(--border2)', color: 'var(--text)', background: d._cls === 'A' ? `${ABC.A.color}0d` : undefined, cursor: dims.length ? 'pointer' : 'default' }}>
                        <td style={{ padding: '6px 7px', color: 'var(--muted)' }}>{i + 1}</td>
                        <td style={{ padding: '6px 7px', fontWeight: d._cls === 'A' ? 700 : 400 }}>{d.name}</td>
                        <td style={{ padding: '6px 7px', textAlign: 'center' }}><span style={clsChip(d._cls)}>{d._cls}</span></td>
                        <td style={{ padding: '6px 7px', textAlign: 'right', fontWeight: 700 }}>{fmt(d._val)}</td>
                      {hasMoney && <td style={{ padding: '6px 7px', textAlign: 'right', color: 'var(--text2)' }}>{fmt(money ? d.value : d.baht)}{d.unpriced ? ' *' : ''}</td>}
                        <td style={{ padding: '6px 7px', textAlign: 'right', color: 'var(--muted)' }}>{d.count}</td>
                        <td style={{ padding: '6px 7px', textAlign: 'right' }}>{d._pct.toFixed(1)}%</td>
                        <td style={{ padding: '6px 7px', textAlign: 'right', color: 'var(--muted)' }}>{d._cum.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, lineHeight: 1.7 }}>
                <b style={{ color: ABC.A.color }}>A</b> = สะสมถึง 80% แรก — แก้กลุ่มนี้ได้ผลมากที่สุด · <b style={{ color: ABC.B.color }}>B</b> = 80–95% · <b style={{ color: ABC.C.color }}>C</b> = 5% สุดท้าย
                {dims.length > 0 && ' · คลิกแถวเพื่อเจาะลึก'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── popup เจาะลึก: แยกตามมิติ (เครื่อง/ไลน์/ชิ้นงาน/กะ/คน/วัน) + รายการดิบ ── */}
      {drill && (
        <div onClick={() => setDrill(null)} style={ovl(1270)}>
          <div onClick={e => e.stopPropagation()} style={{ ...panel, maxWidth: 900 }}>
            <div style={head}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>🔍 เจาะลึก · {title}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{drill}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                  {fmt(drillTotal)} {unitOf} · {drillRecs.length} ครั้ง · {(drillTotal / total * 100).toFixed(1)}% ของทั้งหมด
                        {hasMoney && <> · <b style={{ color: '#fbbf24' }}>{money ? `${fmt(drillRecs.reduce((s, r) => s + (r.value || 0), 0))} ${unit}` : `${fmt(drillTotals.baht)} บาท`}</b>{drillTotals.unpriced > 0 && <span style={{ color: '#f59e0b' }}> · ตีมูลค่าไม่ได้ {drillTotals.unpriced} รายการ</span>}</>}
                </div>
              </div>
              <button onClick={() => setDrill(null)} style={closeBtn}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '12px 20px 20px' }}>
              {/* เลือกมิติที่จะแยก */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                {dims.map(dm => (
                  <button key={dm.key} onClick={() => setDimKey(dm.key)}
                    style={{ padding: '5px 11px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      border: `1px solid ${dimKey === dm.key ? 'var(--accent)' : 'var(--border2)'}`,
                      background: dimKey === dm.key ? 'var(--accent-dim)' : 'var(--bg3)',
                      color: dimKey === dm.key ? 'var(--accent)' : 'var(--text2)' }}>{dm.label}</button>
                ))}
              </div>

              {/* มิติหมายเหตุ: อธิบายว่าจับกลุ่มมายังไง + ชวนยกระดับกลุ่มใหญ่เป็นประเภทจริง */}
              {drillCluster && (
                <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '8px 11px', marginBottom: 10, fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.65 }}>
                  จับกลุ่มจาก<b> ข้อความที่พนักงานพิมพ์เอง </b>โดยเทียบความคล้ายของตัวอักษร (พิมพ์ต่างกันเล็กน้อย/มีเว้นวรรค/ใส่เวลา = กลุ่มเดียวกัน)
                  {drillCluster.missing.count > 0 && (
                    <> · <span style={{ color: '#f59e0b', fontWeight: 700 }}>ยังไม่กรอกหมายเหตุ {drillCluster.missing.count} ครั้ง ({fmt(drillCluster.missing.value)} {unit})</span></>
                  )}
                  {drillRows[0] && !drillRows[0]._noNote && drillRows[0]._pct >= 15 && (
                    <div style={{ marginTop: 5, color: 'var(--accent)', fontWeight: 700 }}>
                      💡 “{drillRows[0].name}” กิน {drillRows[0]._pct.toFixed(0)}% ของ “{drill}” — ควรตั้งเป็น<b>ประเภทของตัวเอง</b> (Daily Report → ⚙️ ตั้งค่า → ประเภท Downtime) รอบหน้าจะได้ไม่ตกไปกอง “อื่นๆ” อีก
                    </div>
                  )}
                </div>
              )}

              {/* สัดส่วนตามมิติที่เลือก — แถบ + ตัวเลข (ABC เหมือนกัน) */}
              {drillRows.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--muted)', padding: 16, textAlign: 'center' }}>ไม่มีข้อมูลในมิตินี้</div>
              ) : (
                <div style={{ display: 'grid', gap: 5 }}>
                  {drillRows.map((d, i) => (
                    <div key={i} style={{ background: 'var(--bg3)', border: `1px solid ${d._noNote ? '#f59e0b55' : 'var(--border2)'}`, borderRadius: 8, padding: '7px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={clsChip(d._cls)}>{d._cls}</span>
                        <span style={{ minWidth: 0, flex: 1, fontSize: 12.5, fontWeight: 700, color: d._noNote ? '#f59e0b' : 'var(--text)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: drillCluster ? 'normal' : 'nowrap' }}>
                          {d._noNote ? '⚠️ ' : ''}{d.name}
                        </span>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: ABC[d._cls].color, whiteSpace: 'nowrap' }}>{fmt(d._val)} {unitOf}
                          {hasMoney && <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', marginLeft: 5 }}>{money ? `${fmt(d.value)} ${unit}` : `${fmt(d.baht)} บาท`}</span>}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', width: 76, textAlign: 'right' }}>{d._pct.toFixed(1)}% · {d.count} ครั้ง</span>
                      </div>
                      {/* กลุ่มคำ: บอกว่ารวมข้อความที่เขียนต่างกันกี่แบบ + ตัวอย่าง — โปร่งใสว่าจับกลุ่มอะไรเข้ามา */}
                      {d.variants > 1 && (
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3 }}>
                          รวม {d.variants} แบบที่เขียนต่างกัน{d.samples?.length ? ` · เช่น "${d.samples.join('" · "')}"` : ''}
                        </div>
                      )}
                      <div style={{ height: 5, borderRadius: 3, background: 'var(--bg)', marginTop: 5, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${d._pct}%`, background: ABC[d._cls].color, opacity: OPA[d._cls] }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* รายการดิบ (มากสุดก่อน) — เห็นหมายเหตุพนักงานจริง */}
              <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text2)', margin: '16px 0 7px', paddingBottom: 5, borderBottom: '1px solid var(--border)' }}>
                รายการจริง ({drillRecs.length})
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                {[...drillRecs].sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 40).map((r, i) => (
                  <div key={i} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 7, padding: '6px 9px', fontSize: 11.5 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <b style={{ color: ABC.A.color, whiteSpace: 'nowrap' }}>{fmt(r.value)} {unit}{r.baht != null && <span style={{ color: '#fbbf24', marginLeft: 5 }}>· {fmt(r.baht)} บาท</span>}</b>
                      {dims.filter(dm => !dm.cluster).map(dm => r[dm.key] ? (
                        <span key={dm.key} style={{ color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                          <span style={{ color: 'var(--muted)' }}>{dm.label}</span> {r[dm.key]}
                        </span>
                      ) : null)}
                    </div>
                    {r.note && <div style={{ color: 'var(--muted)', marginTop: 3 }}>💬 {r.note}</div>}
                  </div>
                ))}
                {drillRecs.length > 40 && <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: 6 }}>… และอีก {drillRecs.length - 40} รายการ</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── styles ── */
const ovl = (z) => ({ position: 'fixed', inset: 0, zIndex: z, background: 'rgba(0,0,0,0.68)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 });
const panel = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, width: '100%', maxHeight: '92vh', display: 'flex', flexDirection: 'column' };
const head = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, padding: '16px 20px 10px', borderBottom: '1px solid var(--border)' };
const closeBtn = { background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: 'var(--text2)', fontSize: 15, flexShrink: 0 };
const tbl = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 520, fontVariantNumeric: 'tabular-nums' };
// index.css มี `th { text-align: left }` (rule ตรงชนะ inherit) → ต้องสั่ง textAlign ที่ th เอง
const thL = { textAlign: 'left', padding: '5px 7px' };
const thR = { textAlign: 'right', padding: '5px 7px' };
const thC = { textAlign: 'center', padding: '5px 7px' };
const clsChip = (c) => ({ fontSize: 10.5, fontWeight: 800, color: ABC[c].color, background: `${ABC[c].color}1e`, border: `1px solid ${ABC[c].color}55`, borderRadius: 20, padding: '1px 7px', flexShrink: 0 });
