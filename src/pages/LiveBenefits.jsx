import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import { supabase, supabaseDR } from '../supabaseClient';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import KpiTile from '../components/KpiTile';
import NoticeBar from '../components/NoticeBar';
import InfoMore from '../components/InfoMore';
import useTabParam from '../utils/useTabParam';
import { tr } from '../utils/i18n';
import { getWorkDate } from '../utils/workDate';
import { monthsShort, yearDisplay } from '../utils/dateFormat';
import { CHART_MARGIN, axisTick, tooltipProps } from '../utils/chartAxis';
import { chartAnim } from '../utils/motion';
import {
  BENEFITS_FROM, TRIAL_START_MONTH, SHEETS_PER_REAM, PAPER_BASIS, BASIS_ORDER, COUNTED_WITH,
  buildPaperModel, buildFlowModel, flowTrend, keyingHours, MIN_FLOW_SAMPLE,
} from '../utils/paperBenefits';

/* ══ 📈 Live Benefits — ประโยชน์จาก ESM นับสด (2026-11-26 · คำสั่ง user) ═══════════════════════════════
   มุม Digital Transformation สำหรับผู้บริหาร: ① กระดาษที่ทดแทน ② ขั้นตอน/เวลาที่ลดได้ ③ ทะเบียนฟอร์มทั้งหมด (รายกะ/รายเดือน/รายเรื่อง)
   · ฟอร์ม = ทะเบียน `doc_forms` (ฟอร์ม export ทุกตัว) + `paper_basis`/`paper_unit` ที่แก้ได้ที่ /doc-forms
   · ตัวเลข = RPC `esm_benefits_rollup` ทั้ง 2 project · สูตรประกอบ/คาดการณ์อยู่ `utils/paperBenefits.js` ที่เดียว
   · อ่านอย่างเดียว ไม่เขียน DB · ไม่ scope ตามส่วนงาน (จอผู้บริหาร — คุมด้วยสิทธิ์ page:/live-benefits)
   📄 docs/modules/live-benefits.md */

const TABS = [
  { key: 'paper', label: '🧾 ไร้กระดาษ' },
  { key: 'flow', label: '⏱ ลดขั้นตอน · ลดเวลา' },
  { key: 'forms', label: '📋 ฟอร์มทั้งหมด (รายกะ / รายเดือน)' },
];
const MIN_KEY = 'live-benefits:min-per-entry';
const fmt = (v) => (v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString());
const monthText = (mk) => {
  const [y, m] = String(mk).split('-').map(Number);
  return `${monthsShort()[m - 1] || mk} ${String(yearDisplay(y)).slice(-2)}`;
};
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 14, boxShadow: 'var(--shadow-sm)' };
const th = { textAlign: 'right', fontSize: 12, whiteSpace: 'nowrap', padding: '6px 8px' };
const td = { textAlign: 'right', fontSize: 13, padding: '6px 8px', whiteSpace: 'nowrap' };

function BasisChip({ basis }) {
  const m = PAPER_BASIS[basis];
  if (!m) return <span style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 700 }}>{tr('ยังไม่จัด')}</span>;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: m.tone, border: `1px solid ${m.tone}`, borderRadius: 'var(--r-sm)', padding: '1px 6px', whiteSpace: 'nowrap' }}>
      {tr(m.short)}
    </span>
  );
}

export default function LiveBenefits() {
  const [tab, setTab] = useTabParam(TABS.map(t => t.key), 'paper');
  const [state, setState] = useState({ loading: true, forms: [], paperRows: [], flowRows: [], errs: [] });
  const [minPerEntry, setMinPerEntry] = useState(() => {
    try { const v = Number(localStorage.getItem(MIN_KEY)); return v > 0 ? v : 1; } catch { return 1; }
  });
  const today = getWorkDate();

  useEffect(() => {
    let alive = true;
    (async () => {
      const [main, dr, forms] = await Promise.all([
        supabase.rpc('esm_benefits_rollup', { p_from: BENEFITS_FROM }),
        supabaseDR.rpc('esm_benefits_rollup', { p_from: BENEFITS_FROM }),
        supabase.from('doc_forms').select('doc_key, form_code, title, paper_basis, paper_unit, used_route, is_active'),
      ]);
      if (!alive) return;
      const errs = [];
      if (main.error) errs.push(`${tr('ข้อมูลฝั่ง Main (เช็คชื่อ · LPA · BBS · 4M · QA · OJT · Poka-yoke)')}: ${main.error.message}`);
      if (dr.error) errs.push(`${tr('ข้อมูลฝั่งผลิต (ใบงาน · AM/PM · MO · ถังเหลือง/แดง · Scrap)')}: ${dr.error.message}`);
      if (forms.error) errs.push(`${tr('ทะเบียนเอกสาร')}: ${forms.error.message}`);
      const rows = [...(main.data || []), ...(dr.data || [])];
      setState({
        loading: false, errs, forms: forms.data || [],
        paperRows: rows.filter(r => r.kind === 'paper'), flowRows: rows.filter(r => r.kind === 'flow'),
      });
    })();
    return () => { alive = false; };
  }, []);

  const model = useMemo(() => buildPaperModel({ forms: state.forms, rows: state.paperRows, today }),
    [state.forms, state.paperRows, today]);
  const flow = useMemo(() => buildFlowModel(state.flowRows, model.months), [state.flowRows, model.months]);
  const setMin = (v) => { setMinPerEntry(v); try { localStorage.setItem(MIN_KEY, String(v)); } catch { /* โหมดส่วนตัว */ } };

  const cur = model.totals[model.cur] || { sheets: 0, entries: 0, sheetsProj: 0, entriesProj: 0 };
  const sparkSheets = model.trialMonths.map(mk => model.totals[mk]?.sheetsProj ?? null);
  const hours = keyingHours(cur.entriesProj, minPerEntry);
  const noData = !state.loading && state.paperRows.length === 0;

  return (
    <Page>
      <PageHeader title={tr('ประโยชน์จาก ESM (Live)')} icon="📈"
        sub={tr('นับสดจากข้อมูลจริง — กระดาษที่ระบบทดแทน และขั้นตอน/เวลาที่ลดได้ (มุม Digital Transformation)')}
        tabs={TABS.map(t => ({ key: t.key, label: tr(t.label) }))} tab={tab} onTab={setTab} />

      {state.errs.map(e => <NoticeBar key={e} tone="bad" style={{ marginBottom: 8 }}>{tr('โหลดไม่สำเร็จ — ตัวเลขด้านล่างขาดส่วนนี้')} · {e}</NoticeBar>)}

      {state.loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>{tr('กำลังโหลด...')}</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10, marginBottom: 12, alignContent: 'start' }}>
            <KpiTile hero label={tr('กระดาษที่ไม่ต้องพิมพ์ เดือนนี้')} value={noData ? null : cur.sheetsProj} unit={tr('แผ่น')}
              spark={sparkSheets}
              note={noData ? tr('ยังไม่มีข้อมูล') : `${tr('ถึงวันนี้')} ${fmt(cur.sheets)} · ≈ ${(cur.sheetsProj / SHEETS_PER_REAM).toFixed(1)} ${tr('รีม')}${model.partialMonth ? ` · ${tr('คาดการณ์เต็มเดือน')}` : ''}`} />
            <KpiTile label={tr('ครั้งที่ไม่ต้องคีย์ลง Excel เดือนนี้')} value={noData ? null : cur.entriesProj} unit={tr('ครั้ง')}
              note={tr('ใบรายเดือน 1 แผ่นถูกเติมทุกวัน ⇒ งานคีย์มากกว่าจำนวนแผ่น')} />
            <KpiTile label={tr('ชั่วโมงคนที่ไม่ต้องคีย์ เดือนนี้')} value={hours == null ? null : Math.round(hours)} unit={tr('ชม.')}
              note={`${tr('ประมาณการ')} · ${minPerEntry} ${tr('นาที/ครั้ง (ปรับได้ที่แท็บ ⏱)')}`} tone="warn" />
            <KpiTile label={`${tr('สะสมตั้งแต่เริ่มทดลอง')} (${monthText(TRIAL_START_MONTH)})`} value={noData ? null : model.sinceTrial.sheets} unit={tr('แผ่น')}
              note={`≈ ${(model.sinceTrial.sheets / SHEETS_PER_REAM).toFixed(1)} ${tr('รีม')} · ${fmt(model.sinceTrial.entries)} ${tr('ครั้งที่บันทึก')}`} />
          </div>

          {tab === 'paper' && <PaperTab model={model} />}
          {tab === 'flow' && <FlowTab flow={flow} months={model.months} model={model} minPerEntry={minPerEntry} setMin={setMin} />}
          {tab === 'forms' && <FormsTab model={model} />}
        </>
      )}
    </Page>
  );
}

function PaperTab({ model }) {
  const counted = model.items.filter(i => i.status === 'counted')
    .sort((a, b) => BASIS_ORDER.indexOf(a.basis) - BASIS_ORDER.indexOf(b.basis)
      || (b.byMonth[model.cur]?.sheetsProj ?? 0) - (a.byMonth[model.cur]?.sheetsProj ?? 0));
  const chart = model.months.map(mk => {
    const row = { m: monthText(mk) };
    for (const b of ['shift', 'month', 'quarter', 'event']) {
      row[b] = counted.filter(i => i.basis === b).reduce((a, i) => a + (i.byMonth[mk]?.sheetsProj ?? i.byMonth[mk]?.sheets ?? 0), 0);
    }
    return row;
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {(model.unclassified.length > 0 || model.notCountable.length > 0) && (
        <NoticeBar tone="warn">
          {model.unclassified.length > 0 && <><b>{model.unclassified.length} {tr('ฟอร์มยังไม่จัดรอบการออกใบ')}</b> — {tr('ตั้งที่')} <a href="/doc-forms">/doc-forms</a> · </>}
          {model.notCountable.length > 0 && <>{model.notCountable.length} {tr('ฟอร์มจัดแล้วแต่ยังนับสดไม่ได้ (ไม่รวมในยอด) — ดูแท็บ 📋')}</>}
        </NoticeBar>
      )}

      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>{tr('กระดาษที่ระบบทดแทน รายเดือน (แผ่น)')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
          {monthText(model.months[0])} = {tr('ก่อนขยายทั้งโรงงาน (ฐานเทียบ)')}{model.partialMonth ? ` · ${monthText(model.cur)} = ${tr('คาดการณ์เต็มเดือน')}` : ''}
        </div>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="m" tick={axisTick()} />
              <YAxis width="auto" tick={axisTick()} />
              <Tooltip {...tooltipProps()} formatter={(v) => Number(v).toLocaleString()} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {['shift', 'month', 'quarter', 'event'].map(b => (
                <Bar key={b} dataKey={b} stackId="p" name={tr(PAPER_BASIS[b].label)} fill={PAPER_BASIS[b].tone} {...chartAnim()} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ ...card, overflowX: 'auto' }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8 }}>{tr('รายฟอร์ม — แผ่นต่อเดือน (ในวงเล็บ = ครั้งที่บันทึก)')}</div>
        <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>{tr('ฟอร์ม')}</th>
              <th style={{ ...th, textAlign: 'left' }}>{tr('1 แผ่นต่อ')}</th>
              {model.months.map(mk => <th key={mk} style={th}>{monthText(mk)}{mk === model.cur && model.partialMonth ? '*' : ''}</th>)}
            </tr>
          </thead>
          <tbody>
            {counted.map(i => (
              <tr key={i.doc_key} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <BasisChip basis={i.basis} />
                    <span>{i.title}</span>
                    {i.form_code && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{i.form_code}</span>}
                    {i.noPrint && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{tr('(ทำในระบบ ยังไม่มีแบบพิมพ์)')}</span>}
                  </div>
                  {Object.entries(COUNTED_WITH).filter(([, to]) => to === i.doc_key).map(([k]) => (
                    <div key={k} style={{ fontSize: 11, color: 'var(--muted)' }}>{tr('รวมใบที่ใช้ฟอร์ม')} {model.items.find(x => x.doc_key === k)?.form_code || k}</div>
                  ))}
                </td>
                <td style={{ ...td, textAlign: 'left', fontSize: 12, color: 'var(--text2)' }}>{i.paper_unit || '—'}</td>
                {model.months.map(mk => {
                  const v = i.byMonth[mk];
                  return (
                    <td key={mk} style={td}>
                      {v && v.sheets > 0 ? <>{fmt(v.sheetsProj ?? v.sheets)}{v.entries !== v.sheets && <span style={{ fontSize: 11, color: 'var(--muted)' }}> ({fmt(v.entriesProj ?? v.entries)})</span>}</> : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--border2)', fontWeight: 800 }}>
              <td style={{ ...td, textAlign: 'left' }}>{tr('รวม')}</td><td />
              {model.months.map(mk => (
                <td key={mk} style={td}>{fmt(model.totals[mk].sheetsProj)} <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>({fmt(model.totals[mk].entriesProj)})</span></td>
              ))}
            </tr>
          </tbody>
        </table>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
          {model.partialMonth && <>* {tr('เดือนนี้ยังไม่จบ: ใบรายกะ/รายเรื่อง คาดการณ์เต็มเดือนตามวันที่ผ่านมา · ใบรายเดือนนับแผ่นจริง (เปิดครบตั้งแต่ต้นเดือน)')} · </>}
          {tr('"—" = ยังไม่มีการใช้งานในเดือนนั้น')}
        </div>
      </div>

      <InfoMore label={tr('นับอย่างไร')} id="live-benefits-how">
        {tr('รายชื่อฟอร์มมาจากทะเบียนเอกสาร (/doc-forms) — ฟอร์มที่ระบบพิมพ์/ส่งออกได้ = ทดแทนกระดาษ (ต้องการ hard copy ค่อยพิมพ์)')} ·
        {' '}{tr('รอบการออกใบ (รายกะ/รายเดือน/รายเรื่อง) ตั้งได้ที่ /doc-forms')} ·
        {' '}{tr('รายงาน/ไฟล์ส่งออกข้อมูล และเอกสารควบคุม (PFMEA/Control Plan ฯลฯ) ไม่นับเป็นกระดาษที่ทดแทน')}
      </InfoMore>
    </div>
  );
}

function FlowTab({ flow, months, model, minPerEntry, setMin }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10, alignContent: 'start' }}>
        {flow.map(m => {
          const t = flowTrend(m, months);
          return (
            <div key={m.key} style={card}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>{tr(m.label)} <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>({m.ratio ? '%' : `${tr('มัธยฐาน')} · ${tr(m.unit)}`})</span></div>
              <div style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 8px', lineHeight: 1.6 }}>
                <div><b style={{ color: 'var(--text2)' }}>{tr('เดิม')}:</b> {tr(m.before)}</div>
                <div><b style={{ color: 'var(--green)' }}>ESM:</b> {tr(m.after)}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {months.map(mk => {
                  const v = m.byMonth[mk];
                  return (
                    <div key={mk} style={{ flex: '1 1 70px', textAlign: 'center', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '6px 4px' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{monthText(mk)}</div>
                      <div style={{ fontSize: 18, fontWeight: 800 }}>{v ? v.val : '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{v ? `n=${v.n.toLocaleString()}` : tr('ไม่มีข้อมูล')}</div>
                    </div>
                  );
                })}
              </div>
              {[['vsBase', 'เทียบฐาน'], ['vsPrev', 'เทียบเดือนก่อน']].map(([k, lbl]) => {
                const c = t[k];
                if (!c || c.improved == null) return null;
                return (
                  <div key={k} style={{ fontSize: 12, marginTop: 6, fontWeight: 700, color: c.improved ? 'var(--green)' : 'var(--amber)' }}>
                    {c.improved ? '▲' : '▼'} {tr(lbl)}: {monthText(c.fromMonth)} {c.from} → {monthText(c.toMonth)} {c.to} {m.ratio ? '%' : tr(m.unit)}
                    {' '}{c.improved ? tr('ดีขึ้น') : tr('แย่ลง — ต้องตามต่อ')}
                  </div>
                );
              })}
              {!t.vsBase && <div style={{ fontSize: 11, marginTop: 6, color: 'var(--muted)' }}>{tr('ยังตัดสินแนวโน้มไม่ได้ — ต้องมีอย่างน้อย 2 เดือนที่มีตัวอย่าง')} ≥ {MIN_FLOW_SAMPLE}</div>}
            </div>
          );
        })}
      </div>

      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>{tr('ขั้นตอนที่หายไปทั้งขั้น — ไม่ต้องคีย์กระดาษลง Excel แล้วทำกราฟเอง')}</div>
        <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text2)' }}>
          {tr('เดิม: เขียนกระดาษ → รวบรวมใบ → คีย์ลง Excel → ทำกราฟ/สรุป → ส่งประชุม')}<br />
          <b style={{ color: 'var(--green)' }}>ESM:</b> {tr('บันทึกที่หน้างาน → ระบบคำนวณ OEE · PPM · MTTR/MTBF · KPI ให้ทันที ทุกคนเห็นตัวเลขชุดเดียวกัน')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap', fontSize: 13 }}>
          <label htmlFor="mpe">{tr('สมมติเวลาคีย์ต่อครั้ง (นาที)')}</label>
          <input id="mpe" type="number" min="0.25" step="0.25" value={minPerEntry} onChange={e => { const v = Number(e.target.value); if (v > 0) setMin(v); }} style={{ width: 80 }} />
          <span style={{ color: 'var(--muted)' }}>
            {model.months.filter(mk => mk >= TRIAL_START_MONTH).map(mk => `${monthText(mk)} ≈ ${fmt(keyingHours(model.totals[mk].entriesProj, minPerEntry))} ${tr('ชม.คน')}`).join(' · ')}
          </span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4 }}>{tr('ประมาณการ — ต้องยืนยันด้วยการจับเวลาจริงก่อนแปลงเป็นเงิน')}</div>
      </div>
    </div>
  );
}

function FormsTab({ model }) {
  const statusText = (i) => ({
    counted: tr('นับสดแล้ว'), counted_with: `${tr('นับรวมกับ')} ${model.items.find(x => x.doc_key === i.countedWith)?.title || i.countedWith}`,
    not_countable: tr('ยังนับสดไม่ได้'), excluded: tr('ไม่นับเป็นกระดาษที่ทดแทน'), unclassified: tr('ยังไม่จัดรอบ'),
  }[i.status]);
  const groups = [...BASIS_ORDER.map(b => ({ key: b, title: PAPER_BASIS[b].label, list: model.byBasis[b] })),
    { key: 'none', title: 'ยังไม่จัดรอบการออกใบ', list: model.unclassified }].filter(g => g.list.length);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, color: 'var(--text2)' }}>
        {tr('ทุกฟอร์มในทะเบียนเอกสารที่ระบบพิมพ์/ส่งออกได้ — แบ่งตามรอบการออกใบ · แก้รอบได้ที่')} <a href="/doc-forms">/doc-forms</a>
      </div>
      {groups.map(g => (
        <div key={g.key} style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            {g.key !== 'none' ? <BasisChip basis={g.key} /> : <BasisChip basis={null} />}
            <span style={{ fontWeight: 800, fontSize: 14 }}>{tr(g.title)}</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{g.list.length} {tr('ฟอร์ม')}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6, alignContent: 'start' }}>
            {g.list.map(i => (
              <div key={i.doc_key} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '6px 8px', fontSize: 13 }}>
                <div style={{ fontWeight: 600 }}>{i.title || i.doc_key}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {[i.form_code, i.paper_unit && `1 ${tr('แผ่นต่อ')} ${i.paper_unit}`, statusText(i)].filter(Boolean).join(' · ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
