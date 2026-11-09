import { Fragment, useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabaseDR } from '../supabaseClient';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { urlBool } from '../utils/urlInit';
import { sumUsage, dailyRate, usageEta, usageProgress, USAGE_LEVELS } from '../utils/pmUsage';
import { dieUsage, setMatsOf } from '../utils/dieUsage';            // 🔨 แม่พิมพ์นับจากพาร์ทของชุด ไม่ใช่ยอดไลน์ (08/11)
import { membersBySet } from '../utils/dieRegistryExport';

/* ══ 📊 ยอดผลิตสะสมรายอุปกรณ์ — แท็บใน /pm-forecast ══════════════════  2026-09-15
   คำสั่ง user: *"ดูหน้าไหนได้บ้างว่าเครื่องไหนผ่านการผลิตไปแล้วกี่ชิ้นงาน"*
   (ก่อนหน้านี้ **ไม่มีหน้าไหนดูได้เลย** — ยอดผลิตทุกจอเป็นราย "ไลน์" หรือราย "สินค้า")

   🔨 **ยกเว้นแม่พิมพ์ (08/11 · user: "ไลน์ผลิต a100 b100 เครื่องทำ 200 shot แต่ a ไม่ได้เท่ากับ 200")**
      แม่พิมพ์นับจาก MAT ของชุดที่มันอยู่ (ชุดบ้าน + ชุดที่ยืม) ทุกไลน์ ผ่าน `src/utils/dieUsage.js` ·
      ชุดไม่ผูก MAT = "นับไม่ได้" **ห้ามถอยไปใช้ยอดไลน์** (วัดจริง: ยอดไลน์เกินยอดพาร์ทจริง ~15 เท่า)

   ⚠️ กติกาที่ต้องเขียนกำกับบนจอเสมอ (คำสั่ง user: "เริ่มที่ระดับไลน์ก่อน") — เครื่องจักร/จิ๊ก:
      ยอดที่เห็น = **ยอดของไลน์** ⇒ อุปกรณ์ทุกตัวในไลน์เดียวกันใช้ตัวเลขเดียวกัน
      ไลน์ที่มีเครื่องขนานกันหลายตัว ยอดต่อเครื่องจริงจะน้อยกว่านี้
      (`prod_orders.machine_no` ถูกกรอกแค่ 3.8% ของใบ — นับรายเครื่องทั้งโรงงานยังทำไม่ได้)
      ห้ามถอดคำเตือนนี้ออกจนกว่าจะบังคับผูกเครื่องตอนเปิดใบผลิตครบทุกไลน์

   ⚠️ ทุกตัวเลขในจอนี้คำนวณด้วย `src/utils/pmUsage.js` เท่านั้น (pure · มีเทส) ห้ามคิดเลขซ้ำที่นี่
   ═══════════════════════════════════════════════════════════════════════════ */

const N = (v) => Number(v || 0).toLocaleString();
const fmtThai = (ymd) => {
  if (!ymd) return '—';
  const [y, m, d] = String(ymd).slice(0, 10).split('-');
  return `${+d} ${['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][+m - 1]} ${String(+y + 543).slice(-2)}`;
};

const KIND_META = {
  machine: { icon: '⚙️', label: 'เครื่องจักร' },
  jig:     { icon: '🧰', label: 'จิ๊ก / fixture' },
  die:     { icon: '🔨', label: 'แม่พิมพ์' },
  other:   { icon: '📦', label: 'อุปกรณ์อื่น' },
};

export default function PmUsageBoard({ daily = [], lines = [], plans = [], todayStr, loading }) {
  const [equip, setEquip] = useState([]);
  const [dieById, setDieById] = useState({});   // machine_id → [{ set, members }] ชุดที่แม่พิมพ์นี้อยู่
  const [matRows, setMatRows] = useState([]);    // ยอดรายวันราย MAT (RPC pm_usage_daily_by_mat)
  const [dieErr, setDieErr] = useState('');      // โหลดส่วนแม่พิมพ์ไม่ครบ — ต้องเขียนบนจอ ห้ามโชว์ว่า "ไม่ผูก MAT"
  const [eqLoading, setEqLoading] = useState(true);
  const [open, setOpen] = useState({});      // ไลน์ที่กางอยู่
  const [onlyWithThreshold, setOnlyWithThreshold] = useState(() => urlBool('fcthr', false));   // ?fcthr= (จอวนหน้า)

  /* อุปกรณ์ทั้งหมดที่ผูกกับไลน์ — เครื่องจักร/แม่พิมพ์/จิ๊ก อยู่ตาราง machines เดียวกัน (equipment_kind)
     ⚠️ `.select()` เปล่าบนตารางที่โตได้ = ชนเพดาน 1000 แถวเงียบๆ → จำกัดคอลัมน์ + กรองปิดระวางออก */
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabaseDR.from('machines')
        .select('id, machine_no, machine_name, line_name, equipment_kind, is_active')
        .neq('is_active', false)
        .order('line_name');
      if (!alive) return;
      if (error) console.warn('[pm-usage] โหลดทะเบียนอุปกรณ์ไม่สำเร็จ:', error.message);
      setEquip(data || []);
      /* 🔨 แม่พิมพ์ (08/11) — นับจากพาร์ทของชุด: ชุด (MAT) + สมาชิกราย OP (ชิ้นเข้า/ออก) + ชุดที่ยืม (common die)
         สูตรทั้งหมดอยู่ `dieUsage.js` (คิดย้อนตามสาย · legacy = ชิ้น/shot เดิม ผ่าน ppsOf) ห้ามคิดในหน้า */
      const [{ data: dies, error: dErr }, { data: sets, error: sErr }, shRes] = await Promise.all([
        supabaseDR.from('equipment_die').select('machine_id, die_set_id, op_seq, feed_type, pieces_in_per_stroke, pieces_per_stroke'),
        supabaseDR.from('die_sets').select('id, set_code, part_name, mat_no, mat_no_2, pieces_per_stroke'),
        supabaseDR.from('die_set_shared_dies').select('die_set_id, machine_id, op_seq'),
      ]);
      if (!alive) return;
      const errs = [dErr && 'ทะเบียนแม่พิมพ์', sErr && 'ชุดแม่พิมพ์', shRes.error && 'แม่พิมพ์ใช้ร่วม'].filter(Boolean);
      const setById = new Map((sets || []).map(st => [st.id, st]));
      const mem = membersBySet((dies || []).map(d => ({ id: d.machine_id, ext: d })), shRes.error ? [] : (shRes.data || []));
      const m = {};
      for (const [setId, members] of Object.entries(mem)) {
        const set = setById.get(setId);
        if (!set) continue;
        for (const x of members) (m[x.die.id] ||= []).push({ set, members });
      }
      setDieById(m);
      // ยอดราย MAT เฉพาะ MAT ที่ชุดผูกไว้ (ไม่ผูก = ไม่ต้องดึง · ตารางเล็ก)
      const mats = [...new Set((sets || []).flatMap(setMatsOf))];
      if (mats.length) {
        const { data: mr, error: mErr } = await supabaseDR.rpc('pm_usage_daily_by_mat', { p_days: 120, p_mats: mats });
        if (!alive) return;
        if (mErr) errs.push('ยอดผลิตราย MAT');
        setMatRows(mr || []);
      }
      setDieErr(errs.length ? `โหลดไม่สำเร็จ: ${errs.join(' · ')} — ยอดแม่พิมพ์บนจอไม่ครบ` : '');
      setEqLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  /* แผน PM ต่อ "ชื่ออุปกรณ์" — ใช้จับคู่กับทะเบียนเครื่อง (checklist ผูก jigs ซึ่งเป็นทะเบียนคนละตัว) */
  const planByEq = useMemo(() => {
    const m = {};
    for (const p of plans) {
      const k = String(p.eqName || '').trim().toLowerCase();
      if (k && !m[k]) m[k] = p;
    }
    return m;
  }, [plans]);

  const rows = useMemo(() => {
    if (!daily.length) return [];
    // ไลน์ที่มีการผลิตจริงในหน้าต่างนี้ (ไม่เอาไลน์ที่ไม่เคยเดินมาปนให้รกจอ)
    const prodLines = [...new Set(daily.map(d => d.line_name).filter(Boolean))];
    const known = new Set(lines.map(l => l.name));
    return prodLines.map(name => {
      // กางครอบครัวไลน์ (แม่-ลูกนับรวมกัน — กฎมาตรฐานของโปรเจค) · ไลน์นอกทะเบียนใช้ชื่อตัวเอง
      const lo = lines.find(l => l.name === name);
      const fam = lo ? getLineFamilyNames(lines, lo.name) : [name];
      const famLines = fam?.length ? fam : [name];
      const all = sumUsage(daily, { lines: famLines });
      const d30 = sumUsage(daily, { lines: famLines, since: addBack(todayStr, 31), until: todayStr });
      const d90 = sumUsage(daily, { lines: famLines, since: addBack(todayStr, 91), until: todayStr });
      const rate = dailyRate(daily, { lines: famLines, days: 30, todayStr });
      const eq = equip.filter(e => famLines.some(f => f === e.line_name));
      return {
        name, famLines, all, d30, d90, rate, eq,
        unknownLine: !known.has(name),
        eqCount: eq.length,
      };
    }).sort((a, b) => b.d30.qty - a.d30.qty);
  }, [daily, lines, equip, todayStr]);

  const shown = useMemo(() => (
    !onlyWithThreshold ? rows
      : rows.filter(r => r.eq.some(e => planByEq[String(e.machine_name || '').trim().toLowerCase()]?.plan?.usage_threshold))
  ), [rows, onlyWithThreshold, planByEq]);

  const grand = useMemo(() => ({
    d30: rows.reduce((s, r) => s + r.d30.qty, 0),
    all: rows.reduce((s, r) => s + r.all.qty, 0),
  }), [rows]);

  const th = { padding: '9px 10px', fontWeight: 700, whiteSpace: 'nowrap' };
  const td = { padding: '8px 10px', whiteSpace: 'nowrap' };

  if (loading || eqLoading) return <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>กำลังรวมยอดผลิต…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* กล่องนี้คือ "ความจริงของตัวเลข" — ห้ามถอดออก (UI-CONVENTIONS §6.9 ซ่อนปุ่มได้ ห้ามซ่อนเหตุผล) */}
      <div style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--text2)', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.40)', borderRadius: 'var(--r-md)', padding: '9px 12px' }}>
        <b style={{ color: 'var(--text)' }}>แม่พิมพ์นับจาก “พาร์ทของชุดแม่พิมพ์”</b> (MAT ที่ผูกในทะเบียนแม่พิมพ์ · ทุกไลน์ที่ผลิต) — ชุดที่ยังไม่ผูก MAT นับไม่ได้
        {dieErr && <div style={{ color: 'var(--red)', fontWeight: 700 }}>⚠️ {dieErr}</div>}
        <div style={{ marginTop: 4 }}>⚠️ <b style={{ color: 'var(--accent2)' }}>เครื่องจักร/จิ๊ก: ยอดที่เห็นเป็น “ยอดของไลน์” ไม่ใช่ยอดที่วัดรายเครื่องจริง</b> —
        อุปกรณ์ทุกตัวในไลน์เดียวกันใช้ตัวเลขเดียวกัน · ไลน์ที่มีเครื่องขนานกันหลายตัว ยอดจริงต่อเครื่องจะน้อยกว่านี้
        <div style={{ color: 'var(--muted)' }}>
          เหตุผล: ใบผลิตผูก “เครื่อง” ไว้แค่ 3.8% ของใบทั้งหมด — ถ้าอยากได้ยอดรายเครื่องจริง ต้องบังคับเลือก/สแกนเครื่องตอนเปิดใบผลิตทุกไลน์ก่อน
        </div></div>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
        <span style={{ color: 'var(--text2)' }}>30 วันล่าสุด <b style={{ color: 'var(--accent)', fontSize: 14 }}>{N(grand.d30)}</b> ชิ้น · ทั้งช่วง (120 วัน) <b>{N(grand.all)}</b> ชิ้น · {rows.length} ไลน์</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyWithThreshold} onChange={e => setOnlyWithThreshold(e.target.checked)} />เฉพาะไลน์ที่มีอุปกรณ์ตั้งเกณฑ์ PM ตามยอดผลิตแล้ว
        </label>
      </div>

      {!shown.length ? <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>ยังไม่มียอดผลิตในช่วง 120 วันล่าสุด</div> : (
        <div className="table-sticky" style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 780 }}>
            <thead>
              <tr style={{ background: 'var(--bg3)', color: 'var(--muted)', textAlign: 'left' }}>
                {['ไลน์', 'อุปกรณ์', '30 วัน (ชิ้น)', '90 วัน', 'ทั้งช่วง', 'อัตรา/วันเดินงาน', 'วันเดินงาน 30 วัน', 'ผลิตล่าสุด'].map(h => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <Fragment key={r.name}>
                  <tr onClick={() => setOpen(o => ({ ...o, [r.name]: !o[r.name] }))} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
                    <td style={{ ...td, fontWeight: 800, color: 'var(--text)' }}>
                      {open[r.name] ? '▾' : '▸'} {r.name}
                      {r.famLines.length > 1 && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}> (รวมไลน์ลูก {r.famLines.length - 1})</span>}
                      {r.unknownLine && <span style={{ fontSize: 11, color: 'var(--accent2)', fontWeight: 500 }}> · ไม่อยู่ในทะเบียนไลน์</span>}
                    </td>
                    <td style={{ ...td, color: r.eqCount ? 'var(--text2)' : 'var(--muted)' }}>{r.eqCount ? `${r.eqCount} ตัว` : '— ไม่มีในทะเบียน'}</td>
                    <td style={{ ...td, fontWeight: 800, fontFamily: 'monospace', color: 'var(--accent)' }}>{N(r.d30.qty)}</td>
                    <td style={{ ...td, fontFamily: 'monospace' }}>{N(r.d90.qty)}</td>
                    <td style={{ ...td, fontFamily: 'monospace' }}>{N(r.all.qty)}</td>
                    <td style={{ ...td, fontFamily: 'monospace', color: 'var(--text2)' }}>{r.rate.rate ? N(Math.round(r.rate.rate)) : '—'}</td>
                    <td style={{ ...td, color: 'var(--muted)' }}>{r.rate.activeDays} วัน</td>
                    <td style={{ ...td, color: 'var(--muted)' }}>{fmtThai(r.all.lastDate)}</td>
                  </tr>
                  {open[r.name] && (
                    <tr style={{ background: 'var(--bg2)' }}>
                      <td colSpan={8} style={{ padding: '6px 10px 10px 26px' }}>
                        {!r.eq.length ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>ไลน์นี้ยังไม่มีอุปกรณ์ลงทะเบียนในระบบ (ตั้งได้ที่ ⚙️ ทะเบียนเครื่องจักร)</div> : (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                              <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                                {['อุปกรณ์', 'ชนิด', 'ยอดตั้งแต่ PM ล่าสุด', 'เกณฑ์ PM', 'ความคืบหน้า', 'คาดถึงเกณฑ์'].map(h => <th key={h} style={{ padding: '4px 8px', fontWeight: 700 }}>{h}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {r.eq.map(e => {
                                const kind = KIND_META[e.equipment_kind] || KIND_META.other;
                                const pl = planByEq[String(e.machine_name || '').trim().toLowerCase()];
                                const since = pl?.plan?.last_done_at ? String(pl.plan.last_done_at).slice(0, 10) : null;
                                const isDie = e.equipment_kind === 'die';
                                /* 🔨 แม่พิมพ์ = ยอดของพาร์ทในชุดของมัน (08/11) · ไม่อยู่ชุดไหน/ชุดไม่ผูก MAT = null (นับไม่ได้)
                                   ห้ามถอยไปใช้ยอดไลน์ — คือตัวเลขที่ user บอกว่าผิด */
                                const du = isDie ? dieUsage(e.id, dieById[e.id] || [], matRows, { since, until: todayStr }) : null;
                                const accum = isDie ? du.pieces : sumUsage(daily, { lines: r.famLines, since, until: todayStr }).qty;
                                const dieMats = isDie ? [...new Set((dieById[e.id] || []).flatMap(x => setMatsOf(x.set)))] : [];
                                const rate = isDie
                                  ? dailyRate(matRows.map(x => ({ line_name: String(x.mat_no || '').trim().toUpperCase(), work_date: x.work_date, qty: x.qty })), { lines: dieMats, days: 30, todayStr })
                                  : r.rate;
                                const thr = pl?.plan?.usage_threshold ?? null;
                                const eta = usageEta({ accum: accum ?? 0, threshold: accum == null ? null : thr, rate: rate.rate, activeDays: rate.activeDays, windowDays: 30, todayStr });
                                const prog = usageProgress(accum ?? 0, accum == null ? null : thr);
                                const shots = du?.shots ?? null;
                                return (
                                  <tr key={e.id} style={{ borderTop: '1px solid var(--border)' }}>
                                    <td style={{ padding: '5px 8px', color: 'var(--text)' }}>{e.machine_no} <span style={{ color: 'var(--muted)' }}>{e.machine_name}</span></td>
                                    <td style={{ padding: '5px 8px', color: 'var(--text2)' }}>{kind.icon} {kind.label}</td>
                                    <td style={{ padding: '5px 8px', fontFamily: 'monospace' }}>
                                      {accum == null ? (
                                        <span style={{ color: 'var(--accent2)', fontFamily: 'inherit', fontSize: 12 }}>
                                          {!du?.sets ? 'ยังไม่อยู่ชุดแม่พิมพ์ไหน' : 'ชุดยังไม่ผูก MAT'} — นับไม่ได้
                                        </span>
                                      ) : <>{N(accum)} ชิ้น{shots != null && <span style={{ color: 'var(--muted)' }}> ({N(shots)} shot)</span>}</>}
                                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{since ? `PM ล่าสุด ${fmtThai(since)}` : 'ยังไม่เคยบันทึก PM — นับทั้งช่วง'}</div>
                                      {isDie && accum == null && <div style={{ fontSize: 11, color: 'var(--accent2)' }}>ผูก MAT ให้ชุดแม่พิมพ์ที่ <Link to="/equipment?tab=die" style={{ color: 'var(--accent)' }}>ทะเบียนแม่พิมพ์</Link> ก่อน</div>}
                                      {isDie && accum != null && du.noMatSets.length > 0 && <div style={{ fontSize: 11, color: 'var(--accent2)' }}>≥ ยอดนี้ — ชุดที่ใช้ร่วมยังไม่ผูก MAT: {du.noMatSets.join(', ')}</div>}
                                      {isDie && accum != null && shots == null && du.why.length > 0 && <div style={{ fontSize: 11, color: 'var(--accent2)' }}>คิดเป็น shot ไม่ได้: {du.why.join(' · ')}</div>}
                                      {/* user 08/11: ชิ้น/shot ที่ยังไม่กรอก นับเป็น 1 ไปก่อน — ต้องบอกว่าสมมติ (ไม่ใช่ค่าจริง · ไม่ได้เขียนลงฐาน) */}
                                      {isDie && shots != null && du.assumed.length > 0 && <div style={{ fontSize: 11, color: 'var(--accent2)' }} title={du.assumed.join(' · ')}>สมมติ 1 ชิ้น/shot ({du.assumed.length} ช่องยังไม่กรอก) — กรอกที่ทะเบียนแม่พิมพ์ให้ตัวเลขถูก</div>}
                                      {isDie && shots != null && du.legacy && <div style={{ fontSize: 11, color: 'var(--muted)' }}>คิดจาก ชิ้น/shot (ยังไม่กรอกชิ้นเข้า-ออกราย OP = ถือว่าไม่มีการตัดแยก)</div>}
                                    </td>
                                    <td style={{ padding: '5px 8px', fontFamily: 'monospace', color: thr ? 'var(--text2)' : 'var(--muted)' }}>{thr ? N(thr) : 'ยังไม่ตั้ง'}</td>
                                    <td style={{ padding: '5px 8px' }}>
                                      {!prog.hasThreshold ? <span style={{ color: 'var(--muted)' }}>—</span> : (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                          <span style={{ width: 66, height: 7, borderRadius: 'var(--r-xs)', background: 'var(--bg3)', overflow: 'hidden', display: 'inline-block' }}>
                                            <span style={{ display: 'block', height: '100%', width: `${Math.min(100, prog.pct)}%`, background: USAGE_LEVELS[prog.level] }} />
                                          </span>
                                          <b style={{ color: USAGE_LEVELS[prog.level] }}>{prog.pct}%</b>
                                        </span>
                                      )}
                                    </td>
                                    <td style={{ padding: '5px 8px', color: eta.etaDate ? (eta.daysLeft <= 0 ? '#ef4444' : 'var(--text2)') : 'var(--muted)' }}>
                                      {isDie && accum == null ? '—' : !prog.hasThreshold ? 'ตั้งเกณฑ์ที่ ⚙️ ตั้งค่า PM' : eta.etaDate ? `${fmtThai(eta.etaDate)} (อีก ${eta.daysLeft} วัน)` : 'ไลน์ยังไม่เดินงาน'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
        * ยอด = ผลรวม <code>prod_orders.qty</code> ของใบที่ปิดแล้ว (รวมของเสีย — เครื่อง/แม่พิมพ์สึกตามจำนวนชิ้นที่ทำจริง) ·
        ไลน์แม่-ไลน์ลูกนับรวมกัน · อัตรา/วัน หารด้วย <b>วันที่เดินงานจริง</b> ไม่ใช่วันปฏิทิน (เครื่องที่เดินสัปดาห์ละ 2 วันจะได้อัตราไม่เพี้ยน) ·
        “ยอดตั้งแต่ PM ล่าสุด” ไม่นับยอดของวันที่ทำ PM ·
        🔨 แม่พิมพ์ = ยอดของ MAT ที่ชุดแม่พิมพ์ผูกไว้ (รวมชุดที่ยืมแม่พิมพ์ไปใช้) · shot คิดย้อนตามสายจากชิ้นเข้า/ออกราย OP
      </p>
    </div>
  );
}

// ย้อนวันจากสตริง YYYY-MM-DD (ไม่แตะ timezone — ห้ามใช้ toISOString ตามกฎโปรเจค)
function addBack(ymd, n) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() - n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
