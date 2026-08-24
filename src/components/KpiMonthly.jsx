import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { wavg, wLoad, sumDefectQty } from '../utils/oee';
import { defectUnitCost, fmtBaht } from '../utils/costSaving';
import { getDocForm, withDocFoot, loadDocForms } from '../utils/docForms';

/* ═══ 📑 KPI รายเดือน (เฟส 1 · 2026-08-24 · คำสั่ง user) ═══
   แทน "แพ็คกระดาษรายเดือน" ที่ปริ้นเซ็นกัน (Internal Defect Report ราย section + OEE รายเดือน)
   ซึ่งเป็นหลักฐานเบื้องหลังฟอร์ม KPI Monitoring FM-HRM-6-024 — เฉพาะ KPI ที่คำนวณอัตโนมัติได้:
     ยอดผลิต · ของเสีย · PPM · Cost of defect · OEE (เทียบเป้า oee_targets + Y/N) · DT นอกแผน
   เฟส 2 (ยังไม่ทำ): KPI นอกระบบกรอกมือ (DL/OH/Satisfaction/Safety/HR) + เป้ารายปี + export Excel ลงฟอร์มเดิม

   กติกาที่ยึด (ห้ามละเมิด):
   - OEE เดือน = wavg(oee ที่ stamp, ถ่วง wLoad = shift_min − plannedMin) — ห้าม mean-of-percentages
   - NG ยึด defect_logs (qty_ng + qty_suspect) แบบ line-mode (ไม่รวมงานทดลอง — มาตรฐานเดียวกับ %Q/FTT/PPM ทุกจอ)
   - PPM = NG ÷ (ยอดผลิต + NG) × 1e6 — ยอดสแกน = ของดีล้วน (ต่างจากสูตรใบเดิม NG÷ยอดผลิต ~0.03% ที่ระดับ PPM ต่ำ
     เทียบใบเก่าได้ต่อเนื่อง — เขียนกำกับสูตรบนจอ/ใบพิมพ์แล้ว)
   - ยอดผลิต = Σ actual_qty ของกะปิดแล้ว "รายชิ้น" (LH/RH แยกชิ้น — ตรงกับใบเดิมที่นับต่อไลน์ต่อชิ้น
     · PPM ต้องหารด้วยชิ้นอยู่แล้ว จึงไม่ใช้ pairAwareTotal ที่นับคู่สำหรับยอดภาพใหญ่)
   - Cost of defect ผ่าน defectUnitCost (standard ชนะ → material) · ตีมูลค่าไม่ได้ = รายงานจำนวน ห้ามเดา
   - นับเฉพาะกะที่ปิดแล้ว — เดือนปัจจุบันติดป้าย "ยังไม่จบ" · กะเปิดค้างไม่ถูกนับ (บอกบนจอ)
   - โหลดครั้งเดียวตอนเปิด/เปลี่ยนปี ไม่ poll (กฎ egress) */

const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const DEFAULT_APQ = { a: 90, p: 90, q: 99 }; // ค่ามาตรฐานเมื่อกรุ๊ปยังไม่ตั้ง target (กฎ oee_targets)

/* ดึงทุกแถวแบบแบ่งหน้า — กับดัก Supabase ตัด 1000 แถว/query */
async function pageAll(buildQuery, onProg) {
  const out = [];
  for (let i = 0; ; i++) {
    const { data, error } = await buildQuery().range(i * 1000, i * 1000 + 999);
    if (error) throw error;
    out.push(...(data || []));
    onProg?.(out.length);
    if (!data || data.length < 1000) return out;
  }
}
const chunk = (arr, n = 120) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

export default function KpiMonthly({ lines, scopeSet, isMobile }) {
  const nowYear = new Date().getFullYear();
  const [year, setYear] = useState(nowYear);
  const [section, setSection] = useState('');
  const [orgSections, setOrgSections] = useState(null); // null = ยังโหลด · [] = ผังว่าง → fallback
  const [loading, setLoading] = useState(false);
  const [prog, setProg] = useState('');
  const [err, setErr] = useState(null);
  const [data, setData] = useState(null); // { key, sessions, dtBySession, dtUnpBySession, defects, partCost, targets }

  /* ตัวเลือกส่วนงานยึด org_nodes (kind='section') ตามกฎ — fallback เดาจาก production_lines เมื่อผังว่าง */
  useEffect(() => {
    supabase.from('org_nodes').select('code, name, sort_order').eq('kind', 'section').order('sort_order')
      .then(({ data: d, error }) => setOrgSections(error ? [] : (d || [])));
  }, []);
  const sectionOpts = useMemo(() => {
    const inScopeSecs = new Set(lines.filter(l => !scopeSet || scopeSet.has(l.name)).map(l => l.section).filter(Boolean));
    const fromOrg = (orgSections || []).map(s => s.code || s.name).filter(s => inScopeSecs.has(s));
    return fromOrg.length ? fromOrg : [...inScopeSecs].sort();
  }, [orgSections, lines, scopeSet]);

  /* ไลน์ในขอบเขตที่เลือก (scope ก่อน แล้วค่อย filter section ทับ — pattern มาตรฐาน) */
  const targetLineNames = useMemo(() => {
    let ls = lines.filter(l => !scopeSet || scopeSet.has(l.name));
    if (section) ls = ls.filter(l => (l.section || '') === section);
    return ls.map(l => l.name);
  }, [lines, scopeSet, section]);

  const load = useCallback(async () => {
    if (!lines.length) return;
    const key = `${year}|${section}|${targetLineNames.length}`;
    setLoading(true); setErr(null); setProg('');
    try {
      // 1) กะปิดแล้วทั้งปี (slim)
      const sessions = await pageAll(() => {
        let q = supabaseDR.from('production_sessions')
          .select('id, line_name, work_date, shift_min, oee, actual_qty')
          .eq('status', 'closed').gte('work_date', `${year}-01-01`).lte('work_date', `${year}-12-31`)
          .order('id');
        if (targetLineNames.length) q = q.in('line_name', targetLineNames);
        return q;
      }, n => setProg(`โหลดกะ ${n} แถว...`));

      const ids = sessions.map(s => s.id);
      // 2) Downtime ของกะพวกนั้น (chunk .in 120 ต่อคิว — กฎ URL ยาว) → plannedMin ต่อกะ (ตัวถ่วง wLoad) + นาทีนอกแผน
      const dtPlanned = {}, dtUnplanned = {};
      let dtSeen = 0;
      for (const c of chunk(ids)) {
        const { data: rows, error } = await supabaseDR.from('downtime_logs')
          .select('session_id, duration_min, dr_downtime_types(category)').in('session_id', c);
        if (error) throw error;
        rows.forEach(r => {
          const m = Number(r.duration_min) || 0;
          if (r.dr_downtime_types?.category === 'planned') dtPlanned[r.session_id] = (dtPlanned[r.session_id] || 0) + m;
          else dtUnplanned[r.session_id] = (dtUnplanned[r.session_id] || 0) + m;
        });
        dtSeen += rows.length; setProg(`โหลด Downtime ${dtSeen} แถว...`);
      }
      // 3) ของเสีย (line-mode ต้องรู้ is_trial + excl_from_q + mat สำหรับคิดเงิน)
      const defects = [];
      for (const c of chunk(ids)) {
        const { data: rows, error } = await supabaseDR.from('defect_logs')
          .select('session_id, qty_ng, qty_suspect, is_trial, prod_orders(mat_no), dr_defect_types(excl_from_q)')
          .in('session_id', c);
        if (error) throw error;
        defects.push(...rows);
      }
      // 4) ต้นทุน/ชิ้น + เป้า OEE
      const [{ data: parts, error: e4 }, { data: targets, error: e5 }] = await Promise.all([
        supabaseDR.from('parts_master').select('mat_no, material_cost, standard_cost'),
        supabase.from('oee_targets').select('group_name, target_a, target_p, target_q'),
      ]);
      if (e4) throw e4;
      if (e5) throw e5;
      const partCost = Object.fromEntries((parts || []).map(p => [p.mat_no, p]));
      setData({ key, sessions, dtPlanned, dtUnplanned, defects, partCost, targets: targets || [] });
    } catch (e) {
      setErr(e?.message || 'โหลดข้อมูลไม่สำเร็จ'); setData(null);
    } finally { setLoading(false); setProg(''); }
  }, [lines.length, year, section, targetLineNames]);
  useEffect(() => { load(); }, [load]);

  /* เป้า OEE ของขอบเขต = เฉลี่ยของกรุ๊ป (ไลน์บนสุด) ในขอบเขต — กฎ oee_targets: section ไม่เก็บใน DB */
  const targetOee = useMemo(() => {
    if (!data) return null;
    const tops = new Set(lines.filter(l => targetLineNames.includes(l.name)).map(l => l.parent_line_name || l.name));
    const tByGroup = Object.fromEntries(data.targets.map(t => [t.group_name, t]));
    const vals = [...tops].map(g => {
      const t = tByGroup[g] || {};
      const a = Number(t.target_a) || DEFAULT_APQ.a, p = Number(t.target_p) || DEFAULT_APQ.p, q = Number(t.target_q) || DEFAULT_APQ.q;
      return a * p * q / 10000;
    });
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  }, [data, lines, targetLineNames]);

  /* รวมรายเดือน */
  const months = useMemo(() => {
    if (!data) return null;
    const defBySession = {};
    data.defects.forEach(d => (defBySession[d.session_id] = defBySession[d.session_id] || []).push(d));
    const out = Array.from({ length: 12 }, () => ({ produce: 0, ng: 0, cost: 0, costMissQty: 0, dtMin: 0, sess: [], n: 0 }));
    data.sessions.forEach(s => {
      const mi = Number(s.work_date?.slice(5, 7)) - 1;
      if (mi < 0 || mi > 11) return;
      const m = out[mi];
      m.n += 1;
      m.produce += Number(s.actual_qty) || 0;
      m.dtMin += data.dtUnplanned[s.id] || 0;
      m.sess.push({ oee: s.oee != null ? Number(s.oee) : null, shift_min: s.shift_min, plannedMin: data.dtPlanned[s.id] || 0 });
      const defs = defBySession[s.id] || [];
      m.ng += sumDefectQty(defs, 'line');
      defs.forEach(d => {
        if (d.is_trial || d.dr_defect_types?.excl_from_q) return; // ฐานเดียวกับ PPM (line-mode)
        const qty = (Number(d.qty_ng) || 0) + (Number(d.qty_suspect) || 0);
        if (!qty) return;
        const mat = d.prod_orders?.mat_no || null;
        const { unit } = defectUnitCost(mat ? data.partCost[mat] : null);
        if (unit == null) m.costMissQty += qty;
        else m.cost += qty * unit;
      });
    });
    out.forEach(m => {
      m.oee = m.sess.length ? wavg(m.sess, x => x.oee, wLoad) : null;
      m.ppm = (m.produce + m.ng) > 0 ? (m.ng / (m.produce + m.ng)) * 1e6 : null;
    });
    const allSess = out.flatMap(m => m.sess);
    const tot = {
      produce: out.reduce((s, m) => s + m.produce, 0),
      ng: out.reduce((s, m) => s + m.ng, 0),
      cost: out.reduce((s, m) => s + m.cost, 0),
      costMissQty: out.reduce((s, m) => s + m.costMissQty, 0),
      dtMin: out.reduce((s, m) => s + m.dtMin, 0),
      n: out.reduce((s, m) => s + m.n, 0),
      oee: allSess.length ? wavg(allSess, x => x.oee, wLoad) : null,
    };
    tot.ppm = (tot.produce + tot.ng) > 0 ? (tot.ng / (tot.produce + tot.ng)) * 1e6 : null;
    return { out, tot };
  }, [data]);

  const curMonthIdx = year === nowYear ? new Date().getMonth() : -1;
  const nf = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 }));

  /* แถวของตาราง — เพิ่ม KPI ใหม่ = เพิ่ม entry ตรงนี้ */
  const ROWS = useMemo(() => [
    { key: 'produce', label: 'ยอดผลิต (ชิ้น)', get: m => nf(m.produce) },
    { key: 'ng',      label: 'ของเสีย (ชิ้น · ไม่รวมงานทดลอง)', get: m => nf(m.ng), warnPos: true },
    { key: 'ppm',     label: 'Internal defect (PPM)', get: m => nf(m.ppm), warnPos: true },
    { key: 'cost',    label: 'Cost of defect (บาท)', get: m => nf(m.cost), warnPos: true },
    { key: 'oee',     label: `OEE (%)${targetOee != null ? ` · เป้า ≥ ${targetOee.toFixed(1)}` : ''}`, get: m => nf(m.oee, 1),
      yn: m => (m.oee == null || targetOee == null ? null : m.oee >= targetOee) },
    { key: 'dt',      label: 'Downtime นอกแผน (นาที)', get: m => nf(m.dtMin), warnPos: true },
  ], [targetOee]);

  /* พิมพ์ — รายงานภายในห่อ withDocFoot ตามกฎทะเบียนเอกสาร (doc_key: kpi_monthly) */
  const handlePrint = async () => {
    await loadDocForms(); // component ร่วม/lazy chunk ต้องโหลดเอง ห้ามพึ่งหน้าแม่ (กับดัก docFormSync)
    const df = await getDocForm('kpi_monthly', {});
    const th = 'border:1px solid #999;padding:4px 6px;font-size:11px;background:#eee;text-align:center';
    const td = 'border:1px solid #999;padding:4px 6px;font-size:11px;text-align:right';
    const rows = ROWS.map(r => `<tr><td style="${td};text-align:left;font-weight:bold">${r.label}</td>${
      months.out.map((m, i) => `<td style="${td}">${m.n ? r.get(m) : ''}${r.yn && m.n && r.yn(m) != null ? ` <b>${r.yn(m) ? '✓' : '✗'}</b>` : ''}${i === curMonthIdx ? '<div style="font-size:8px;color:#b45309">ยังไม่จบ</div>' : ''}</td>`).join('')
    }<td style="${td};font-weight:bold">${r.get(months.tot)}</td></tr>`).join('');
    const html = `
      <h2 style="margin:0 0 2px">สรุป KPI รายเดือน ${year + 543} — ${section || 'ทุกส่วนงานในขอบเขต'}</h2>
      <div style="font-size:11px;color:#555;margin-bottom:8px">
        จากกะที่ปิดแล้ว ${months.tot.n.toLocaleString()} กะ · OEE ถ่วงน้ำหนักเวลารับภาระ ·
        PPM = ของเสีย ÷ (ยอดผลิต + ของเสีย) × 10⁶ (ไม่รวมงานทดลอง) · พิมพ์ ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
      </div>
      <table style="border-collapse:collapse;width:100%">
        <tr><th style="${th};text-align:left">KPI</th>${TH_M.map(m => `<th style="${th}">${m}</th>`).join('')}<th style="${th}">รวม/เฉลี่ย</th></tr>
        ${rows}
      </table>
      ${months.tot.costMissQty > 0 ? `<div style="font-size:10px;color:#b45309;margin-top:6px">⚠ ของเสีย ${months.tot.costMissQty.toLocaleString()} ชิ้นยังตีมูลค่าไม่ได้ (พาร์ทไม่มีต้นทุน/ชิ้นใน Parts Master) — Cost of defect จึงต่ำกว่าจริง</div>` : ''}
      <table style="margin-top:26px;width:60%"><tr>${(Array.isArray(df?.sig_blocks) && df.sig_blocks.length ? df.sig_blocks : ['Issued', 'Checked', 'Approved']).map(s2 => `<td style="text-align:center;font-size:11px;padding-top:30px;border-top:1px solid #999">${typeof s2 === 'string' ? s2 : s2?.label || ''}</td>`).join('')}</tr></table>`;
    const w = window.open('', '_blank');
    if (!w) { toast.error('เบราว์เซอร์บล็อก popup — อนุญาต popup ก่อนพิมพ์'); return; }
    w.document.write(withDocFoot(html, 'kpi_monthly'));
    w.document.close(); w.focus();
    setTimeout(() => w.print(), 350);
  };

  const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' };
  const thSt = { padding: '6px 8px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', whiteSpace: 'nowrap', textAlign: 'right', borderBottom: '1px solid var(--border2)' };
  const tdSt = { padding: '6px 8px', fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap', textAlign: 'right', borderBottom: '1px solid var(--border)', fontVariantNumeric: 'tabular-nums' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>📑 KPI รายเดือน</span>
        {/* width กัน index.css input/select width:100% */}
        <select value={year} onChange={e => setYear(+e.target.value)} style={{ width: 110, padding: '5px 8px', fontSize: 13, borderRadius: 7, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
          {[nowYear, nowYear - 1, nowYear - 2].map(y => <option key={y} value={y}>{y + 543}</option>)}
        </select>
        <select value={section} onChange={e => setSection(e.target.value)} style={{ width: 190, padding: '5px 8px', fontSize: 13, borderRadius: 7, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
          <option value="">ทุกส่วนงานในขอบเขต</option>
          {sectionOpts.map(s2 => <option key={s2} value={s2}>{s2}</option>)}
        </select>
        {months && !loading && (
          <button onClick={handlePrint} style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>🖨️ พิมพ์ / PDF</button>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
        นับเฉพาะ<b>กะที่ปิดแล้ว</b> — กะที่เปิดค้างยังไม่ถูกนับ · OEE = ค่า stamp ถ่วงน้ำหนักเวลารับภาระ ·
        PPM = ของเสีย ÷ (ยอดผลิต + ของเสีย) × 10⁶ ไม่รวมงานทดลอง (ต่างจากสูตรใบเดิม ของเสีย ÷ ยอดผลิต ~0.03% ที่ระดับ PPM ปัจจุบัน) ·
        KPI นอกระบบ (DL/OH/Satisfaction/Safety/HR) = เฟสถัดไป
      </div>

      {loading && <div style={{ ...card, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>กำลังโหลดข้อมูลทั้งปี... {prog}</div>}
      {err && <div style={{ ...card, borderColor: '#ef4444', color: '#ef4444', fontSize: 13 }}>โหลดไม่สำเร็จ: {err} <button onClick={load} style={{ marginLeft: 8, cursor: 'pointer' }}>ลองใหม่</button></div>}

      {!loading && !err && months && (
        <div style={{ ...card, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ ...thSt, textAlign: 'left' }}>KPI</th>
                {TH_M.map((m, i) => (
                  <th key={m} style={{ ...thSt, color: i === curMonthIdx ? 'var(--accent)' : 'var(--muted)' }}>
                    {m}{i === curMonthIdx && <div style={{ fontSize: 9, fontWeight: 600 }}>ยังไม่จบ</div>}
                  </th>
                ))}
                <th style={{ ...thSt, color: 'var(--text)' }}>รวม/เฉลี่ย</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(r => (
                <tr key={r.key}>
                  <td style={{ ...tdSt, textAlign: 'left', fontWeight: 700, color: 'var(--text)' }}>{r.label}</td>
                  {months.out.map((m, i) => {
                    const yn = r.yn && m.n ? r.yn(m) : null;
                    return (
                      <td key={i} style={{ ...tdSt, opacity: m.n ? 1 : 0.35 }}>
                        {m.n ? r.get(m) : '·'}
                        {yn != null && <b style={{ marginLeft: 4, color: yn ? '#22c55e' : '#ef4444' }}>{yn ? 'Y' : 'N'}</b>}
                      </td>
                    );
                  })}
                  <td style={{ ...tdSt, fontWeight: 800, color: 'var(--text)' }}>
                    {r.get(months.tot)}
                    {r.yn && months.tot.n ? (() => { const yn = r.yn(months.tot); return yn == null ? null : <b style={{ marginLeft: 4, color: yn ? '#22c55e' : '#ef4444' }}>{yn ? 'Y' : 'N'}</b>; })() : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8 }}>
            จากกะที่ปิดแล้ว {months.tot.n.toLocaleString()} กะ
            {months.tot.costMissQty > 0 && (
              <span style={{ color: '#f59e0b' }}> · ⚠ ของเสีย {months.tot.costMissQty.toLocaleString()} ชิ้นยังตีมูลค่าไม่ได้
                (กรอกต้นทุน/ชิ้นที่ Product Master → 🗂 Parts Master) — Cost of defect ต่ำกว่าจริง</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
