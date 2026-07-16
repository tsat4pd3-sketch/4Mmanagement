import { useState, useEffect, useCallback } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';

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

const SEV = {
  high: { c: '#ef4444', bg: 'rgba(239,68,68,0.08)', label: 'กระทบหนัก' },
  med:  { c: '#f59e0b', bg: 'rgba(245,158,11,0.08)', label: 'pattern ที่ควรดู' },
  info: { c: '#4d9fff', bg: 'rgba(77,159,255,0.07)', label: 'ข้อสังเกต' },
};

export default function OeeInsightPanel({ lines }) {
  const [days, setDays] = useState(30);
  const [selLine, setSelLine] = useState('');
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState(null); // null = ยังไม่รัน
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

      const [{ data: dts }, { data: defs }, { data: orders }, { data: kstd }] = await Promise.all([
        supabaseDR.from('downtime_logs').select('session_id, machine_no, duration_min, description, dr_downtime_types(name_th, category)').in('session_id', ids),
        supabaseDR.from('defect_logs').select('session_id, qty_ng, qty_suspect, dr_defect_types(name_th)').in('session_id', ids),
        supabaseDR.from('prod_orders').select('session_id, mat_no, qty, qty_ok, status').in('session_id', ids).in('status', ['confirmed', 'carry_over', 'imported']),
        supabaseDR.from('kanban_standards').select('mat_no, dr_products(name, cycle_time_sec)').eq('is_active', true),
      ]);
      const ctOf = (mat) => Number(kstd?.find(k => k.mat_no === mat)?.dr_products?.cycle_time_sec) || 0;
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
          ngPieces += (s.qty_ng || 0) + (s.qty_suspect || 0);
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
      const dayO = sess.filter(s => s.shift === 'day').map(s => Number(s.oee));
      const nightO = sess.filter(s => s.shift === 'night').map(s => Number(s.oee));
      if (dayO.length >= 3 && nightO.length >= 3) {
        const gap = avg(dayO) - avg(nightO);
        if (Math.abs(gap) >= 5) {
          const worse = gap > 0 ? 'night' : 'day';
          const wSess = sess.filter(s => s.shift === worse);
          const dA = avg(sess.filter(s => s.shift === 'day').map(s => Number(s.oee_a))) - avg(sess.filter(s => s.shift === 'night').map(s => Number(s.oee_a)));
          const dP = avg(sess.filter(s => s.shift === 'day').map(s => Number(s.oee_p))) - avg(sess.filter(s => s.shift === 'night').map(s => Number(s.oee_p)));
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
      const withAbs = sess.filter(s => (absentByDate[s.work_date] || 0) > 0).map(s => Number(s.oee));
      const noAbs = sess.filter(s => (absentByDate[s.work_date] || 0) === 0).map(s => Number(s.oee));
      if (withAbs.length >= 3 && noAbs.length >= 3) {
        const gap = avg(noAbs) - avg(withAbs);
        if (gap >= 5) {
          out.push({
            sev: gap >= 10 ? 'high' : 'med', icon: '👥',
            title: `วันที่มีคนขาด OEE ต่ำกว่าปกติเฉลี่ย ${gap.toFixed(1)} จุด`,
            detail: `วันมีคนขาด ${withAbs.length} กะ เฉลี่ย OEE ${avg(withAbs).toFixed(1)} vs วันคนครบ ${noAbs.length} กะ เฉลี่ย ${avg(noAbs).toFixed(1)} — กำลังคนคือคอขวด ลองดูแผนคน backup/multi-skill`,
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

      out.sort((a, b) => ({ high: 0, med: 1, info: 2 }[a.sev] - { high: 0, med: 1, info: 2 }[b.sev]) || b.impact - a.impact);
      setInsights(out);
      setMeta({ from, to, nSess: sess.length, dtMin: Math.round(dtMinUnpl) });
    } catch (e) {
      setInsights([]);
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
          {lines.map(l => <option key={l.id} value={l.name}>{l.parent_line_name ? `↳ ${l.name}` : l.name}</option>)}
        </select>
        <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ width: 'auto', padding: '6px 10px', fontSize: 12, borderRadius: 7, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
          {[14, 30, 60, 90].map(d => <option key={d} value={d}>ย้อนหลัง {d} วัน</option>)}
        </select>
        {meta && !meta.error && <span style={{ fontSize: 11, color: 'var(--muted)' }}>วิเคราะห์จาก {meta.nSess} กะที่ปิดแล้ว · Downtime นอกแผนรวม {meta.dtMin ?? 0} นาที</span>}
      </div>

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
