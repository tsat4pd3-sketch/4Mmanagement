import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { toHierarchicalOptions } from '../utils/lineHierarchy';
import { wavg, wLoad, buildCtMap, groupLean, SIX_BIG_LOSSES, EIGHT_WASTES } from '../utils/oee';
import { fetchByIds } from '../utils/fetchByIds';

/* ── 🧠 OEE Insight Engine — วิเคราะห์ภาพรวมอัตโนมัติ (rule-based + สถิติ) ──
   ตอบ 2 คำถามหลักของ user (2026-07-14):
   1. "ทำไมยอดงานไม่ได้ตามเป้า" → แตกเป้าที่หายไปเป็นชิ้น: Downtime นอกแผน / NG / ความเร็วต่ำกว่า CT
   2. "เหตุการณ์รูปแบบไหนกระทบ OEE" → หา pattern ซ้ำ: downtime เรื้อรัง (ชนิด×เครื่อง),
      กะเช้า vs กะดึก, วันไหนของสัปดาห์แย่สุด, คนขาดสัมพันธ์กับ OEE ตก, product ที่ช้ากว่า CT ซ้ำๆ
   ทุก insight มีหลักฐานตัวเลขแนบเสมอ (นาที/ชิ้น/จำนวนกะ) — ไม่ฟันธงลอยๆ · ข้อมูลไม่พอ = ไม่แสดง */

const dateStrAdd = (s, n) => {
  const d = new Date(`${s}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const todayWorkDate = () => {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const DOW_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
// เฉลี่ย OEE/A/P ข้ามกะ ต้องถ่วงด้วยเวลารับภาระ (กฎ OEE · util กลาง oeeAvg.js) — เดิม avg() ธรรมดา
// ทำให้ insight อ้างตัวเลข "เฉลี่ยกะเช้า vs ดึก" ไม่ตรงกับ KPI ในหน้าเดียวกัน (แก้ 2026-08-05)
const avgW = (ss, pick, plannedOf) => {
  const rows = ss.map(s => ({ v: pick(s), shift_min: s.shift_min, plannedMin: plannedOf(s.id) }));
  const r = wavg(rows, x => (x.v == null || isNaN(x.v) ? null : Number(x.v)), wLoad);
  return r == null ? 0 : r;
};

const SEV = {
  high: { c: '#ef4444', bg: 'rgba(239,68,68,0.08)', label: 'กระทบหนัก' },
  med:  { c: '#f59e0b', bg: 'rgba(245,158,11,0.08)', label: 'pattern ที่ควรดู' },
  info: { c: '#4d9fff', bg: 'rgba(77,159,255,0.07)', label: 'ข้อสังเกต' },
};

export default function OeeInsightPanel({ lines }) {
  // ตัวเลือกไลน์เรียงตามผัง: ไลน์แม่ก่อน แล้วไลน์ลูกตามใต้แม่ (ไม่ใช่เรียงชื่อรวดเดียวจนลูกหลุดจากแม่)
  const lineOpts = useMemo(() => toHierarchicalOptions(lines || []), [lines]);
  const [days, setDays] = useState(30);
  const [selLine, setSelLine] = useState('');
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState(null); // null = ยังไม่รัน
  const [lean, setLean] = useState(null);         // { losses: [...], wastes: [...] } — 6 Big Losses / 8 Wastes
  const [leanAxis, setLeanAxis] = useState('six_big_loss');
  const [meta, setMeta] = useState(null);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const to = todayWorkDate();
      const from = dateStrAdd(to, -days);
      const lineNames = selLine ? [selLine] : lines.map(l => l.name);
      if (!lineNames.length) { setInsights([]); setLoading(false); return; }

      const { data: sessions } = await supabaseDR.from('production_sessions')
        .select('id, line_name, work_date, shift, shift_min, target_qty, actual_qty, qty_ok, qty_ng, qty_suspect, oee, oee_a, oee_p, oee_q, status')
        .in('line_name', lineNames).gte('work_date', from).lte('work_date', to)
        .in('status', ['closed', 'pending_close']);
      const sess = (sessions || []).filter(s => s.oee != null);
      if (sess.length < 3) { setInsights([]); setMeta({ from, to, nSess: sess.length }); setLoading(false); return; }
      const ids = sess.map(s => s.id);
      const sessById = Object.fromEntries(sess.map(s => [s.id, s]));

      // ⚠️ ห้าม .in('session_id', ids) ตรงๆ — ช่วง 90 วันมี 800+ กะ → URL ยาวเกิน คิวรีล้มเหลวเงียบ
      //    แล้วแผงนี้จะสรุปว่า "ไม่มี Downtime เรื้อรัง / ไม่มีของเสียกระจุก" ทั้งที่มี (บั๊กชนิดเดียว
      //    กับที่เจอในตารางสรุป OEE 2026-08-20) — วิเคราะห์สาเหตุที่บอกว่า "ไม่มีปัญหา" อันตรายที่สุด
      const [dtRes, defRes, ordRes, { data: kstd }, { data: prodCt }] = await Promise.all([
        fetchByIds(ids, c => supabaseDR.from('downtime_logs')
          .select('session_id, machine_no, duration_min, description, dr_downtime_types(name_th, category, six_big_loss, waste_type)').in('session_id', c)),
        fetchByIds(ids, c => supabaseDR.from('defect_logs')
          .select('session_id, qty_ng, qty_suspect, dr_defect_types(name_th, six_big_loss, waste_type)').in('session_id', c)),
        fetchByIds(ids, c => supabaseDR.from('prod_orders')
          .select('session_id, mat_no, qty, qty_ok, status').in('session_id', c).in('status', ['confirmed', 'carry_over', 'imported'])),
        supabaseDR.from('kanban_standards').select('mat_no, dr_products(name, cycle_time_sec)').eq('is_active', true),
        supabaseDR.from('dr_products').select('mat_no, cycle_time_sec'),
      ]);
      const dts = dtRes.rows, defs = defRes.rows, orders = ordRes.rows;
      const loadErr = [dtRes, defRes, ordRes].find(r => r.error)?.error || null;
      // CT ผ่าน buildCtMap — fallback chain เดียวกับตอนปิดกะ (เดิม kanban ล้วน → บาง MAT ได้ CT=0)
      const ctMapAll = buildCtMap({ kanbanStds: kstd || [], products: prodCt || [] });
      const ctOf = (mat) => ctMapAll[mat] || 0;
      const prodNameOf = (mat) => kstd?.find(k => k.mat_no === mat)?.dr_products?.name || mat;

      // ── ข้อมูลคนขาดจากฝั่ง Main (เช็คชื่อ) — ผูก line ผ่าน employees.line_id ──
      const lineIds = lines.filter(l => lineNames.includes(l.name)).map(l => l.id);
      let absentByDate = {}; // work_date -> จำนวนคนขาด (ของไลน์ใน scope)
      try {
        const { data: emps } = await supabase.from('employees').select('id, line_id').in('line_id', lineIds).eq('is_active', true);
        const empIds = (emps || []).map(e => e.id);
        if (empIds.length) {
          const { data: logs } = await supabase.from('daily_production_logs')
            .select('work_date, employee_id, is_present').gte('work_date', from).lte('work_date', to)
            .eq('is_present', false).in('employee_id', empIds.slice(0, 900));
          (logs || []).forEach(l => { absentByDate[l.work_date] = (absentByDate[l.work_date] || 0) + 1; });
        }
      } catch { /* ฝั่งเช็คชื่อพังไม่ทำ insight หลักล่ม */ }

      // CT เฉลี่ยถ่วงน้ำหนักต่อ session (ไว้แปลง นาที ↔ ชิ้น)
      const ctBySess = {};
      (orders || []).forEach(o => {
        const ct = ctOf(o.mat_no);
        if (ct <= 0) return;
        const c = (ctBySess[o.session_id] ||= { std: 0, qty: 0 });
        const q = o.qty_ok ?? o.qty ?? 0;
        c.std += q * ct; c.qty += q;
      });
      const ctSess = (sid) => { const c = ctBySess[sid]; return c && c.qty > 0 ? c.std / c.qty : 0; };

      // นาที DT "ในแผน" ต่อกะ — ใช้เป็นน้ำหนัก (เวลารับภาระ = shift_min − planned)
      const plannedMinOf = (sid) => (dts || [])
        .filter(d => d.session_id === sid && d.dr_downtime_types?.category === 'planned')
        .reduce((a, d) => a + (Number(d.duration_min) || 0), 0);

      const out = [];

      /* ═ 1. Loss decomposition — เป้าหายไปไหน ═ */
      let shortfall = 0, dtPieces = 0, ngPieces = 0, nMiss = 0, dtMinUnpl = 0;
      sess.forEach(s => {
        const target = Number(s.target_qty) || 0;
        const actual = s.qty_ok ?? s.actual_qty ?? 0;
        const sDts = (dts || []).filter(d => d.session_id === s.id && d.dr_downtime_types?.category !== 'planned');
        const unplMin = sDts.reduce((a, d) => a + (Number(d.duration_min) || 0), 0);
        dtMinUnpl += unplMin;
        if (target > 0 && actual < target) {
          nMiss += 1;
          shortfall += target - actual;
          const ct = ctSess(s.id);
          if (ct > 0) dtPieces += Math.min(target - actual, (unplMin * 60) / ct);
          // NG ยึด defect_logs (คอลัมน์ session ไม่น่าเชื่อถือ — CLAUDE.md) ให้ตรงกับ insight ข้อ NG กระจุกประเภท
          ngPieces += (defs || []).filter(d => d.session_id === s.id)
            .reduce((a, d) => a + (Number(d.qty_ng) || 0) + (Number(d.qty_suspect) || 0), 0);
        }
      });
      if (shortfall > 0) {
        const speedPieces = Math.max(0, Math.round(shortfall - dtPieces - ngPieces));
        const parts = [
          [Math.round(dtPieces), `Downtime นอกแผน (${Math.round(dtMinUnpl)} นาทีรวม)`],
          [Math.round(ngPieces), 'งานเสีย/สงสัย (NG)'],
          [speedPieces, 'ความเร็วต่ำกว่า CT / จังหวะหยุดย่อยที่ไม่ได้บันทึก'],
        ].filter(([v]) => v > 0).sort((a, b) => b[1] === a[1] ? 0 : b[0] - a[0]);
        out.push({
          sev: dtPieces / Math.max(1, shortfall) > 0.5 ? 'high' : 'med', icon: '🎯',
          title: `เป้าหายรวม ${Math.round(shortfall).toLocaleString()} ชิ้น จาก ${nMiss} กะที่พลาดเป้า`,
          detail: parts.map(([v, l]) => `≈ ${v.toLocaleString()} ชิ้นจาก ${l}`).join(' · '),
          impact: Math.round(shortfall),
        });
      }

      /* ═ 2. Downtime เรื้อรัง (ชนิด×เครื่อง เกิดซ้ำหลายกะ) ═ */
      const chron = new Map();
      (dts || []).forEach(d => {
        if (d.dr_downtime_types?.category === 'planned') return;
        const key = `${d.dr_downtime_types?.name_th || 'ไม่ระบุ'}::${d.machine_no || '-'}`;
        const c = chron.get(key) || { name: d.dr_downtime_types?.name_th || 'ไม่ระบุ', machine: d.machine_no || '', min: 0, cnt: 0, sids: new Set(), lines: new Set() };
        c.min += Number(d.duration_min) || 0; c.cnt += 1; c.sids.add(d.session_id);
        c.lines.add(sessById[d.session_id]?.line_name);
        chron.set(key, c);
      });
      [...chron.values()].filter(c => c.sids.size >= 3).sort((a, b) => b.min - a.min).slice(0, 3).forEach(c => {
        out.push({
          sev: c.min >= 120 ? 'high' : 'med', icon: '🔁',
          title: `Downtime เรื้อรัง: "${c.name}"${c.machine ? ` ที่ ⚙️${c.machine}` : ''}`,
          detail: `เกิดซ้ำใน ${c.sids.size} กะ (${c.cnt} ครั้ง · รวม ${Math.round(c.min)} นาที) ${[...c.lines].filter(Boolean).join(', ')} — ปัญหาซ้ำแบบนี้คุ้มที่จะเปิดโปรเจคใน Improvements แก้ที่ราก`,
          impact: c.min,
        });
      });

      /* ═ 3. กะเช้า vs กะดึก ═ */
      const daySess = sess.filter(s => s.shift === 'day');
      const nightSess = sess.filter(s => s.shift === 'night');
      const dayO = daySess.map(s => Number(s.oee));
      const nightO = nightSess.map(s => Number(s.oee));
      if (dayO.length >= 3 && nightO.length >= 3) {
        const gap = avgW(daySess, s => s.oee, plannedMinOf) - avgW(nightSess, s => s.oee, plannedMinOf);
        if (Math.abs(gap) >= 5) {
          const worse = gap > 0 ? 'night' : 'day';
          const wSess = sess.filter(s => s.shift === worse);
          const dA = avgW(daySess, s => s.oee_a, plannedMinOf) - avgW(nightSess, s => s.oee_a, plannedMinOf);
          const dP = avgW(daySess, s => s.oee_p, plannedMinOf) - avgW(nightSess, s => s.oee_p, plannedMinOf);
          const cause = Math.abs(dA) > Math.abs(dP) ? `Availability ต่างกัน ${Math.abs(dA).toFixed(1)} จุด (Downtime มากกว่า)` : `Performance ต่างกัน ${Math.abs(dP).toFixed(1)} จุด (ความเร็ว/จังหวะงาน)`;
          out.push({
            sev: Math.abs(gap) >= 10 ? 'high' : 'med', icon: worse === 'night' ? '🌙' : '☀️',
            title: `กะ${worse === 'night' ? 'ดึก' : 'เช้า'} OEE ต่ำกว่าอีกกะเฉลี่ย ${Math.abs(gap).toFixed(1)} จุด`,
            detail: `เฉลี่ยกะเช้า ${avg(dayO).toFixed(1)} vs กะดึก ${avg(nightO).toFixed(1)} (${dayO.length}/${nightO.length} กะ) — ตัวต่างหลักคือ ${cause} · ลองดูกำลังคน/การส่งมอบงานข้ามกะของกะ${worse === 'night' ? 'ดึก' : 'เช้า'} (${wSess.length} กะ)`,
            impact: Math.abs(gap) * 10,
          });
        }
      }

      /* ═ 4. วันไหนของสัปดาห์ Downtime หนักสุด ═ */
      const dowMin = {};
      (dts || []).forEach(d => {
        if (d.dr_downtime_types?.category === 'planned') return;
        const s = sessById[d.session_id];
        if (!s) return;
        const dow = new Date(`${s.work_date}T00:00:00`).getDay();
        (dowMin[dow] ||= []).push(Number(d.duration_min) || 0);
      });
      const dowAvg = Object.entries(dowMin).map(([dow, arr]) => ({ dow: +dow, total: arr.reduce((a, v) => a + v, 0), n: new Set(sess.filter(s => new Date(`${s.work_date}T00:00:00`).getDay() === +dow).map(x => x.work_date)).size }))
        .filter(x => x.n >= 2).map(x => ({ ...x, perDay: x.total / x.n }));
      if (dowAvg.length >= 3) {
        const sorted = [...dowAvg].sort((a, b) => b.perDay - a.perDay);
        const worst = sorted[0];
        const med = sorted[Math.floor(sorted.length / 2)].perDay;
        if (med > 0 && worst.perDay > med * 1.6) {
          out.push({
            sev: 'med', icon: '📅',
            title: `วัน${DOW_TH[worst.dow]} Downtime นอกแผนสูงผิดปกติ`,
            detail: `เฉลี่ย ${Math.round(worst.perDay)} นาที/วัน (จาก ${worst.n} วัน) เทียบค่ากลางวันอื่น ${Math.round(med)} นาที — เช็คกิจกรรมประจำวันนั้น (เริ่มสัปดาห์/สลับแผน/วัตถุดิบเข้า ฯลฯ)`,
            impact: worst.perDay,
          });
        }
      }

      /* ═ 5. คนขาด ↔ OEE ═ */
      const withAbsS = sess.filter(s => (absentByDate[s.work_date] || 0) > 0);
      const noAbsS = sess.filter(s => (absentByDate[s.work_date] || 0) === 0);
      const withAbs = withAbsS.map(s => Number(s.oee));
      const noAbs = noAbsS.map(s => Number(s.oee));
      if (withAbs.length >= 3 && noAbs.length >= 3) {
        const gap = avgW(noAbsS, s => s.oee, plannedMinOf) - avgW(withAbsS, s => s.oee, plannedMinOf);
        if (gap >= 5) {
          out.push({
            sev: gap >= 10 ? 'high' : 'med', icon: '👥',
            title: `วันที่มีคนขาด OEE ต่ำกว่าปกติเฉลี่ย ${gap.toFixed(1)} จุด`,
            detail: `วันมีคนขาด ${withAbs.length} กะ เฉลี่ย OEE ${avgW(withAbsS, s => s.oee, plannedMinOf).toFixed(1)} vs วันคนครบ ${noAbs.length} กะ เฉลี่ย ${avgW(noAbsS, s => s.oee, plannedMinOf).toFixed(1)} — กำลังคนคือคอขวด ลองดูแผนคน backup/multi-skill`,
            impact: gap * 8,
          });
        }
      }

      /* ═ 6. Product ที่ช้ากว่า CT ซ้ำๆ ═ */
      const slowByProd = new Map();
      sess.forEach(s => {
        if (Number(s.oee_p) >= 75) return;
        const mats = [...new Set((orders || []).filter(o => o.session_id === s.id).map(o => o.mat_no))];
        if (mats.length !== 1) return; // เอาเฉพาะกะ product เดียว ชี้ตัวได้ชัด
        const pn = prodNameOf(mats[0]);
        const c = slowByProd.get(pn) || { n: 0, ps: [] };
        c.n += 1; c.ps.push(Number(s.oee_p));
        slowByProd.set(pn, c);
      });
      [...slowByProd.entries()].filter(([, c]) => c.n >= 3).sort((a, b) => b[1].n - a[1].n).slice(0, 2).forEach(([pn, c]) => {
        out.push({
          sev: 'med', icon: '🐢',
          title: `"${pn}" วิ่งช้ากว่า CT มาตรฐานซ้ำๆ`,
          detail: `P ต่ำกว่า 75% ถึง ${c.n} กะ (เฉลี่ย P ${avg(c.ps).toFixed(1)}) — ถ้าหน้างานเร็วสุดได้เท่านี้จริง CT ใน Product Master อาจตั้งไว้เร็วเกิน หรือมี micro-stop ที่ไม่ได้บันทึก`,
          impact: c.n * 20,
        });
      });

      /* ═ 7. งานเสียกระจุกที่ประเภทเดียว ═ */
      const ngByType = new Map();
      (defs || []).forEach(d => {
        const k = d.dr_defect_types?.name_th || 'ไม่ระบุ';
        const c = ngByType.get(k) || { qty: 0, sids: new Set() };
        c.qty += (d.qty_ng || 0) + (d.qty_suspect || 0); c.sids.add(d.session_id);
        ngByType.set(k, c);
      });
      const ngTotal = [...ngByType.values()].reduce((a, c) => a + c.qty, 0);
      if (ngTotal >= 20) {
        const [topName, topC] = [...ngByType.entries()].sort((a, b) => b[1].qty - a[1].qty)[0];
        if (topC.qty / ngTotal >= 0.5) {
          out.push({
            sev: 'med', icon: '🔴',
            title: `NG กว่าครึ่งมาจากประเภทเดียว: "${topName}"`,
            detail: `${topC.qty.toLocaleString()} จาก ${ngTotal.toLocaleString()} ชิ้น (${Math.round((topC.qty / ngTotal) * 100)}%) ใน ${topC.sids.size} กะ — โฟกัสแก้ประเภทนี้ตัวเดียวได้ผลเกินครึ่ง`,
            impact: topC.qty,
          });
        }
      }

      // ── Lean: 6 Big Losses + 8 Wastes (แกนวิเคราะห์ แยกจาก category ที่ใช้คิด OEE) ──
      // ของเสียแปลงเป็น "นาทีที่เสียไป" ด้วย CT ของกะนั้น เพื่อเทียบกับ downtime ในหน่วยเดียวกัน
      const ctSecFn = (sid) => ctSess(sid);
      setLean({
        losses: groupLean({ axis: 'six_big_loss', downtimes: dts || [], defects: defs || [], ctSecFn }),
        wastes: groupLean({ axis: 'waste_type',   downtimes: dts || [], defects: defs || [], ctSecFn }),
      });

      out.sort((a, b) => ({ high: 0, med: 1, info: 2 }[a.sev] - { high: 0, med: 1, info: 2 }[b.sev]) || b.impact - a.impact);
      setInsights(out);
      setMeta({ from, to, nSess: sess.length, dtMin: Math.round(dtMinUnpl), loadErr });
    } catch (e) {
      setInsights([]); setLean(null);
      setMeta({ error: e.message });
    }
    setLoading(false);
  }, [days, selLine, lines]);

  useEffect(() => { run(); }, [run]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>🧠 วิเคราะห์ภาพรวมอัตโนมัติ</span>
        {/* width กัน index.css select{width:100%} (กับดัก CSS ใน CLAUDE.md) */}
        <select value={selLine} onChange={e => setSelLine(e.target.value)} style={{ width: 'auto', padding: '6px 10px', fontSize: 12, borderRadius: 7, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
          <option value="">— ทุกไลน์ที่มองเห็น —</option>
          {/* เรียงตามลำดับชั้นจริง (แม่ → ลูกใต้แม่) ผ่าน util กลาง — เดิม map ตรงๆ ลูกเลยลอยไปคนละที่กับแม่ */}
          {lineOpts.map(({ line: l, depth }) => (
            <option key={l.id} value={l.name}>{depth ? `${' '.repeat(depth * 3)}↳ ${l.name}` : l.name}</option>
          ))}
        </select>
        <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ width: 'auto', padding: '6px 10px', fontSize: 12, borderRadius: 7, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
          {[14, 30, 60, 90].map(d => <option key={d} value={d}>ย้อนหลัง {d} วัน</option>)}
        </select>
        {meta && !meta.error && <span style={{ fontSize: 11, color: 'var(--muted)' }}>วิเคราะห์จาก {meta.nSess} กะที่ปิดแล้ว · Downtime นอกแผนรวม {meta.dtMin ?? 0} นาที</span>}
        {/* โหลดแถวลูกไม่ครบ = แผงนี้อาจสรุปว่า "ไม่มีปัญหา" ทั้งที่มี — อันตรายที่สุด ห้ามเงียบ */}
        {meta?.loadErr && (
          <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 700 }}>
            ⚠ ข้อมูลโหลดไม่ครบ — ผลวิเคราะห์อาจตกหล่น ({meta.loadErr})
          </span>
        )}
      </div>

      {/* ── Lean: 6 Big Losses / 8 Wastes — จำแนกจาก master (dr_downtime_types.six_big_loss/waste_type)
           แยกคนละแกนกับ ในแผน/นอกแผน ที่ใช้คิด OEE โดยตั้งใจ (คำสั่ง user 2026-08-05) ── */}
      {!loading && lean && (lean.losses.length > 0 || lean.wastes.length > 0) && (() => {
        const rows = leanAxis === 'six_big_loss' ? lean.losses : lean.wastes;
        const maxMin = Math.max(1, ...rows.map(r => r.min));
        const totalMin = rows.reduce((a, r) => a + r.min, 0);
        const unclassified = rows.find(r => !r.key);
        return (
          <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 10, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 800 }}>🧩 วิเคราะห์ความสูญเปล่าแบบ Lean</div>
              <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                {[['six_big_loss', '6 Big Losses (TPM)'], ['waste_type', '8 Wastes (Lean)']].map(([k, lb]) => (
                  <button key={k} onClick={() => setLeanAxis(k)}
                    style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      border: leanAxis === k ? '1px solid var(--accent)' : '1px solid var(--border)',
                      background: leanAxis === k ? 'var(--accent)' : 'transparent', color: leanAxis === k ? '#fff' : 'var(--text2)' }}>{lb}</button>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
              เวลาสูญเสียรวม {totalMin.toLocaleString()} นาที (นับทั้งในแผน/นอกแผน · ของเสียแปลงเป็นนาทีด้วย CT)
              {unclassified ? ` · ⚠️ ยังไม่จัดหมวด ${unclassified.min.toLocaleString()} นาที — จัดได้ที่ Daily Report → ⚙️ ตั้งค่า → ประเภท Downtime` : ''}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {rows.map((r, i) => {
                const c = r.meta?.color || 'var(--muted)';
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5 }}>
                      <span style={{ fontWeight: 700, color: r.meta ? 'var(--text)' : 'var(--muted)' }}>
                        {r.meta ? `${r.meta.icon} ${r.meta.label}` : '❔ ยังไม่จัดหมวด'}
                      </span>
                      {r.meta?.oee && <span style={{ fontSize: 10.5, fontWeight: 800, color: c }}>กระทบ {r.meta.oee}</span>}
                      <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', color: 'var(--text2)' }}>
                        {r.min.toLocaleString()} น. · {r.count} ครั้ง{r.qty ? ` · NG ${r.qty.toLocaleString()} ชิ้น` : ''}
                        {totalMin > 0 ? <span style={{ color: 'var(--muted)' }}> ({Math.round(r.min / totalMin * 100)}%)</span> : null}
                      </span>
                    </div>
                    <div style={{ height: 7, borderRadius: 4, background: 'var(--bg3)', overflow: 'hidden', margin: '3px 0 2px' }}>
                      <div style={{ width: `${Math.max(1, r.min / maxMin * 100)}%`, height: '100%', background: c }} />
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                      {r.types.slice(0, 3).map(t => `${t.name} ${t.min.toLocaleString()}น.`).join(' · ')}
                      {r.types.length > 3 ? ` +${r.types.length - 3} ประเภท` : ''}
                      {r.meta?.fix ? <div style={{ color: c, marginTop: 2 }}>💡 {r.meta.fix}</div> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 13 }}>กำลังวิเคราะห์...</div>
      ) : meta?.error ? (
        <div style={{ textAlign: 'center', padding: 30, color: '#ef4444', fontSize: 12 }}>วิเคราะห์ไม่สำเร็จ: {meta.error}</div>
      ) : !insights?.length ? (
        <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 13 }}>
          {meta && meta.nSess < 3 ? `ข้อมูลยังไม่พอวิเคราะห์ (มี ${meta?.nSess ?? 0} กะในช่วงนี้ — ต้องอย่างน้อย 3 กะ)` : 'ไม่พบ pattern ผิดปกติในช่วงนี้ 🎉 (เป้าครบ/ไม่มีปัญหาซ้ำ)'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {insights.map((it, i) => {
            const sv = SEV[it.sev];
            return (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 10, background: sv.bg, border: `1px solid ${sv.c}44`, borderLeft: `4px solid ${sv.c}` }}>
                <div style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{it.icon}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{it.title}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: sv.c, background: `${sv.c}18`, borderRadius: 5, padding: '1px 7px' }}>{sv.label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4, lineHeight: 1.55 }}>{it.detail}</div>
                </div>
              </div>
            );
          })}
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            💡 เจอปัญหาซ้ำที่คุ้มค่าแก้ → เปิดโปรเจคในหน้า Improvements (พาเรโต้จะ prefill เป้าให้) แล้วระบบติดตามผลก่อน/หลังให้อัตโนมัติ
          </div>
        </div>
      )}
    </div>
  );
}
