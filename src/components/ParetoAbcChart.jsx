import { useState, useMemo, useEffect, useRef } from 'react';
import { clusterNotes } from '../utils/textCluster';
import { classifyAbc, PARETO_CUTOFF, vagueShare } from '../utils/pareto';
import ParetoChart from './ParetoChart';

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
/* แท่งสูงสุดในกราฟย่อ — เกินนี้ยุบหางยาวเป็นแท่งเดียว (ต้องตรงกับที่ส่งให้ ParetoChart) */
const MAX_BARS = 12;
/* ชิปกลุ่ม A สูงสุดที่โชว์ใต้กราฟ — เกินนี้ยุบเป็นปุ่ม "ดูครบ" (ดูเหตุผลตรงจุดที่ใช้) */
const CHIP_MAX = 12;
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// สูตร ABC + % สะสม ย้ายไป `utils/pareto.js` แล้ว (เทสได้ — ตัวรันเทสไม่รับ .jsx)
export { classifyAbc };

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

  /* ── สุขภาพของข้อมูล: พาเรโตที่เต็มไปด้วย "อื่นๆ / ไม่ระบุ" ชี้เป้าไม่ได้ ต่อให้วาดถูกหลักทุกอย่าง ──
     เคสจริง 2026-09-15 (user ส่งจอมา): KPI ใบซ่อม MTN มี "ไม่ระบุกลุ่ม" 224 + "อื่นๆ" 89 จาก 319 ใบ
     = 98% ⇒ กราฟสวยแต่บอกไม่ได้ว่าต้องแก้อะไร · **ต้องขึ้นเตือนบนจอ ห้ามปล่อยให้คนอ่านเข้าใจผิดว่า
     "ปัญหาหลักคือไม่ระบุกลุ่ม"** — ตัวเลขนี้แปลว่ากระบวนการเก็บข้อมูลพัง ไม่ใช่ผลวิเคราะห์ */
  const vague = useMemo(() => vagueShare(rows), [rows]);

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

  /* ── 📊 การวาด: ย้ายไป `ParetoChart` (แท่งตั้งมาตรฐานสากล) 2026-09-22 ──────────────
     เดิมไฟล์นี้วาดเอง = **แท่งนอน ความหนาไม่เท่ากันตามกลุ่ม ABC**
     user เทียบกับ Pareto มาตรฐาน (Excel · ASQ · QI Macros) แล้วสรุปว่า *"เทียบกันไม่ติดเลย …
     แนวนอนไม่เวิค เป็นแนวตั้งและเอียง text เอา"* ⇒ เปลี่ยนตัววาดที่นี่ที่เดียว
     กราฟที่ได้ผลพร้อมกัน 5 จุด: /mtn-analysis · /oee-analytics ×2 · /dept-dashboard ×2

     ⚠️ **ห้ามกลับไปวาดแท่งนอน** — เหตุผลเดิมที่เลือกแท่งนอน (ชื่อยาวเขียนทับกันบนแกน)
        แก้ด้วย "ป้ายเอียง -45°/-90°" ตามที่ user สั่ง ไม่ใช่ด้วยการพลิกกราฟ
     ⚠️ ไฟล์นี้เหลือหน้าที่: รวมยอด · จัด ABC · เตือนสุขภาพข้อมูล · เจาะลึก — **ไม่คำนวณพิกัด** */
  const chartCompact = () => (
    <ParetoChart rows={rows} unit={unitOf} height={330} maxBars={MAX_BARS}
      onPick={dims.length ? (r) => openDrill(r.name) : undefined} />
  );
  /* 🔴 กราฟใน popup ต้อง "เต็มช่อง" — ห้ามล็อกสัดส่วน viewBox ไว้ตายตัว (user 23/09 "เว้นไว้ทำไม")
     SVG ใช้ `width:100%; height:auto` ⇒ ความสูงที่วาดจริง = กว้างช่อง × (vbH/vbW)
     ถ้า vbH ตายตัว (เดิม 400) แล้วช่องสูงกว่านั้น ⇒ **เหลือที่ว่างใต้กราฟเป็นแถบใหญ่**
     (วัดจริง: ช่องสูง ~640px แต่กราฟวาดได้ ~390px = ว่าง 250px)
     ⇒ วัดช่องจริงด้วย ResizeObserver แล้วคำนวณ vbH ให้สัดส่วนตรงกับช่อง
     ⚠️ ห้ามแก้ด้วย `preserveAspectRatio="none"` (แท่งยืดผิดสัดส่วน อ่านค่าผิด)
        และห้ามล็อก `height` เป็น px บน svg (จะได้ letterbox ซ้าย-ขวาแทน — บั๊กเดิม 22/09) */
  const VB_W = 1600;
  const LEGEND_H = 46;              // แถบคำอธิบาย/ปุ่มมุมป้ายใต้ svg (อยู่นอก viewBox)
  const chartPane = useRef(null);
  const [paneBox, setPaneBox] = useState(null);
  useEffect(() => {
    const el = chartPane.current;
    if (!open || !el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => {
      const { width: w, height: h } = e.contentRect;
      // อัปเดตเฉพาะตอนขยับจริง — กันลูป (กราฟสูงขึ้น → scrollbar โผล่ → กว้างลด → วัดใหม่)
      setPaneBox(p => (p && Math.abs(p.w - w) < 3 && Math.abs(p.h - h) < 3 ? p : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);
  const fullH = paneBox?.w > 0
    ? Math.round(VB_W * Math.max(paneBox.h - LEGEND_H, 240) / paneBox.w)
    : 400;
  const chartFull = () => (
    <ParetoChart rows={rows} unit={unitOf} height={fullH} width={VB_W} maxBars={rows.length}
      showTailToggle={false} onPick={dims.length ? (r) => openDrill(r.name) : undefined} />
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
      {/* 🔴 ข้อมูลกำกวมเกินครึ่ง = กราฟนี้ยังชี้เป้าไม่ได้ — บอกตรงๆ ดีกว่าให้คนเชื่อผลผิด */}
      {vague.pct >= 40 && (
        <div style={{ background: '#ef444414', border: '1px solid #ef444455', borderRadius: 8,
          padding: '7px 10px', marginBottom: 8, fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.6 }}>
          <b style={{ color: '#ef4444' }}>⚠ {vague.pct.toFixed(0)}% ของข้อมูลยังไม่บอกสาเหตุ</b>
          {' '}({vague.names.join(' · ')} รวม {fmt(vague.vagueVal)} จาก {fmt(vague.total)} {unitOf})
          {' — '}พาเรโตยัง<b>ชี้เป้าไม่ได้</b>จนกว่าจะระบุสาเหตุตอนบันทึก
          {noteDim && <span> · กดแท่งนั้นเพื่อดูหมายเหตุที่พนักงานเขียนจริง</span>}
        </div>
      )}
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
        {/* 🔴 "แสดงกี่อันดับ" ย้ายไปอยู่ใน ParetoChart แล้ว — ที่นี่ไม่รู้ว่าผู้ใช้กางหางยาวอยู่หรือย่ออยู่
            เดิมเขียนตายตัวว่า "แสดง 11 อันดับแรกจาก 46" แล้ว**ยังขึ้นอยู่ทั้งที่จอกางครบ 46 แท่งแล้ว**
            (user ส่งภาพมา 22/09) · ที่เหลือไว้ตรงนี้คือสิ่งที่หน้าแม่รู้จริง = สัดส่วน A/B/C นับครบทุกรายการ */}
        {rows.length > MAX_BARS + 1 && (
          <span style={{ color: 'var(--muted)' }}>สัดส่วน A/B/C ข้างบนนับครบทุกรายการ ไม่ใช่เฉพาะแท่งที่เห็น</span>
        )}
        {dims.length > 0 && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>🔍 คลิกแท่ง/ชิป = เจาะลึก</span>}
      </div>
      {/* เน้นกลุ่ม A — ตัวที่ต้องแก้ก่อน (คลิกเจาะได้) */}
      <div style={{ marginTop: 9, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {/* 🔴 กลุ่ม A ไม่ได้แปลว่า "ไม่กี่ตัว" — ข้อมูลที่หมวดกระจายมาก (เช่นพาเรโตจากข้อความอิสระ)
            มี A ได้ถึง **499 รายการ** ⇒ เดิม render ชิปครบทุกตัว = กำแพงชิปท่วมจอ
            (user แจ้ง 23/09 "ทำไมมันโชว์เยอะแบบนี้ ควร hide รึป่าว")
            ⇒ โชว์เท่าที่อ่านไหว แล้วบอกว่าเหลืออีกเท่าไหร่ + กดดูครบได้
            **ห้ามตัดทิ้งเงียบ** — ลิสต์งานที่ต้องแก้ต้องเข้าถึงได้เสมอ (กฎความซื่อสัตย์ของจอ) */}
        <span style={{ fontSize: 10.5, fontWeight: 800, color: ABC.A.color }}>
          เน้นแก้กลุ่ม A{groups.A.length > CHIP_MAX ? ` (${CHIP_MAX} จาก ${groups.A.length})` : ''} →
        </span>
        {groups.A.slice(0, CHIP_MAX).map((d, i) => (
          <span key={i} onClick={() => dims.length && openDrill(d.name)}
            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: `${ABC.A.color}1e`, border: `1px solid ${ABC.A.color}55`, color: ABC.A.color, fontWeight: 700, cursor: dims.length ? 'pointer' : 'default' }}>
            {d.name}: {fmt(d._val)} {unitOf} ({d._pct.toFixed(0)}%)
          </span>
        ))}
        {groups.A.length > CHIP_MAX && (
          <button type="button" onClick={() => setOpen(true)}
            style={{ fontSize: 11, padding: '2px 9px', borderRadius: 10, cursor: 'pointer', fontWeight: 700,
              background: 'var(--bg3)', color: 'var(--text2)', border: `1px dashed ${ABC.A.color}77` }}>
            ⤢ ดูกลุ่ม A ครบ {groups.A.length} รายการ
          </button>
        )}
      </div>

      {/* ── popup ขยาย: เห็นครบทุกรายการ + ตาราง (คลิกแถวเจาะได้) ── */}
      {open && (
        <div onClick={() => setOpen(false)} style={ovl(1250)}>
          {/* popup ขยาย: กว้างขึ้น + **กราฟฟรีซ ตารางเลื่อนในตัวเอง** (user 23/09)
              "กราฟมันเล็ก สัดส่วนตอนนี้เหมือน 50/50 … เอาให้กราฟ 70 table 30
               ละถ้าให้ดี ฟรีซกราฟไว้ เลื่อนแค่ตาราง" */}
          <div onClick={e => e.stopPropagation()} style={{ ...panel, maxWidth: 1500 }}>
            <div style={head}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                  ABC Analysis · รวม {fmt(total)} {unitOf} · {rows.length} รายการ — <b style={{ color: ABC.A.color }}>กลุ่ม A {groups.A.length} รายการ = {(groups.A.reduce((s, d) => s + d._val, 0) / total * 100).toFixed(0)}%</b>
                </div>
              </div>
              <button onClick={() => setOpen(false)} style={closeBtn}>✕</button>
            </div>
            {/* ── กราฟ: ฟรีซไว้ (ไม่เลื่อนไปกับตาราง) · ~70% ของพื้นที่ที่เหลือ ──
                flexShrink 0 = ไม่ให้ตารางบีบกราฟให้เตี้ยลงเมื่อรายการเยอะ */}
            {/* สัดส่วน **กราฟ 70 : ตาราง 30** ของพื้นที่ใต้หัว (user 23/09)
                ทั้งคู่ `minHeight: 0` + เลื่อนในตัวเอง ⇒ เลื่อนตารางแล้วกราฟไม่ขยับ (ฟรีซ)
                ⚠️ `minHeight: 0` คือตัวที่ทำให้ overflow ทำงานใน flex column — ขาดไปจะดันทะลุกรอบ */}
            <div ref={chartPane} style={{ flex: '1 1 70%', minHeight: 0, overflowY: 'auto',
                          padding: '14px 20px 6px', borderBottom: '1px solid var(--border)' }}>
              {chartFull()}
            </div>
            {/* ── ตาราง: เลื่อนในตัวเอง ~30% · minHeight 0 คือสิ่งที่ทำให้ overflow ทำงานใน flex column ── */}
            <div style={{ flex: '1 1 30%', minHeight: 0, overflowY: 'auto', padding: '10px 20px 20px' }}>
              <div style={{ overflowX: 'auto' }}>
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
/* 🔴 `overflow: hidden` บังคับให้ลูกอยู่ในกรอบ 92vh — ขาดตัวนี้ ลูกที่ `flex: 0 0 auto`
   (เช่นบล็อกกราฟ) จะดันตารางทะลุขอบล่างจอ แล้วตัวเลื่อนด้านในไม่ทำงานเลย
   (เจอจริง 23/09 ตอนแยกกราฟ/ตารางเป็น 2 ชั้นใน popup ขยาย) */
const panel = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, width: '100%',
  /* 🔴 ต้องเป็น `height` ไม่ใช่แค่ `maxHeight` — `flex-basis: 70%/30%` ของลูกจะทำงานก็ต่อเมื่อ
     ความสูงของกล่องแม่ "แน่นอน" · ถ้ามีแต่ maxHeight ความสูงจะขึ้นกับเนื้อหา ⇒ % ตีกลับเป็น auto
     แล้วได้สัดส่วนตามเนื้อหาแทน (เจอจริง 23/09: ตั้ง 70/30 แต่ได้ 41/59 = กลับด้าน) */
  height: '92vh', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
const head = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, padding: '16px 20px 10px', borderBottom: '1px solid var(--border)' };
const closeBtn = { background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: 'var(--text2)', fontSize: 15, flexShrink: 0 };
const tbl = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 520, fontVariantNumeric: 'tabular-nums' };
// index.css มี `th { text-align: left }` (rule ตรงชนะ inherit) → ต้องสั่ง textAlign ที่ th เอง
const thL = { textAlign: 'left', padding: '5px 7px' };
const thR = { textAlign: 'right', padding: '5px 7px' };
const thC = { textAlign: 'center', padding: '5px 7px' };
const clsChip = (c) => ({ fontSize: 10.5, fontWeight: 800, color: ABC[c].color, background: `${ABC[c].color}1e`, border: `1px solid ${ABC[c].color}55`, borderRadius: 20, padding: '1px 7px', flexShrink: 0 });
