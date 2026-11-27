/* ══ 🎯 บล็อก "เกณฑ์ตัดสิน ○△✗" ชุดเดียว ใช้ทั้งนิยาม KPI กรอกมือ (DefModal) และเป้าของ KPI อัตโนมัติ (AutoTargetModal) ══
   2026-11-16 · คำสั่ง user: "หน้ากรอก KPI ใช้งานยาก user งงเรื่อง plan และเรื่องเปรียบเทียบว่าผ่านหรือตก — ต้องตั้งได้โดยไม่ hardcode"
   เดิม: เกณฑ์กระจาย 5 ช่อง (เป้าตัวเลข · ทิศทาง · Commitment *ข้อความอิสระ* · Target ข้อความ · ติ๊กแผนสะสม) ไม่มีที่ไหนสรุปว่าตัดสินยังไง
   ตอนนี้: ทิศทาง → Target ตัวเลข → Commitment **ตัวเลข** → วิธีตัดสินรายเดือน (เป้าเดียว / แผนของเดือนนั้น) → ประโยคสรุปสด + เตือนที่ขัดกัน
   · ข้อความบนใบ Appraisal ("≤ 1.017 %") สร้างให้เองจากตัวเลข (fmtBar) — ไม่ต้องพิมพ์ · ประโยค/คำเตือนมาจาก kpiSetup (scoreRuleText/defIssues) ไม่คิดเองในนี้
   🔴 เกณฑ์ทางการ 1 / 0.5 / 0 ยังเป็นของ scoreDef() — บล็อกนี้แค่ "ตั้งค่า" ไม่ได้ตัดสิน */
import { useMemo } from 'react';
import { scoreRuleText, defIssues, fmtBar, summaryModeLabel } from '../utils/kpiSetup';
import { tr } from '../utils/i18n';

/**
 * @param f        ฟอร์ม { direction, target_value, commit_value, score_by_plan }
 * @param set      (key, value) => void
 * @param unit     หน่วยของ KPI (สำหรับประโยคสรุป/ข้อความบนใบ)
 * @param summaryMode  วิธีรวม 12 เดือนจากทะเบียน (average/sum/max/as_of/rate) — โชว์ให้เห็นเฉยๆ แก้ที่ 📘 ทะเบียน
 * @param plans    {เดือน: ค่า} ของแถว (มี = ตรวจเรื่องแผนขัดกับวิธีตัดสินให้ด้วย)
 * @param auto     true = KPI ที่ระบบคำนวณค่าเอง (ข้อความหัวต่างนิดหน่อย)
 */
export default function KpiScoreRuleFields({ f, set, unit = '', summaryMode = 'average', plans = null, auto = false, inp, lbl }) {
  const dirCmp = f.direction === 'up' ? '>=' : f.direction === 'down' ? '<=' : null;
  const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
  const previewDef = useMemo(() => ({
    target_value: num(f.target_value), commit_value: num(f.commit_value), direction: f.direction || null,
    target_compare: dirCmp, commit_compare: num(f.commit_value) != null ? dirCmp : null,
    score_by_plan: !!f.score_by_plan, unit, kpi_catalog: { summary_mode: summaryMode },
  }), [f.target_value, f.commit_value, f.direction, f.score_by_plan, unit, summaryMode, dirCmp]);
  const rule = scoreRuleText(previewDef, { unit });
  const issues = defIssues(previewDef, { plans });
  const box = { gridColumn: '1 / -1', border: '1px solid var(--border2)', borderRadius: 'var(--r-md)', padding: '10px 12px', background: 'var(--bg2)', display: 'grid', gap: 10 };
  const radio = (on) => ({ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, cursor: 'pointer', padding: '6px 8px', borderRadius: 'var(--r-sm)', border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent-dim)' : 'var(--card)' });
  return (
    <div style={box}>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>🎯 {tr('เกณฑ์ตัดสิน ○△✗')}
        <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--muted)', marginLeft: 8 }}>
          {auto ? tr('ค่ารายเดือนระบบคำนวณเอง — ตั้งแค่ว่า "เท่าไหร่ถึงผ่าน"') : tr('ค่ารายเดือนกรอกที่ตาราง — ตั้งแค่ว่า "เท่าไหร่ถึงผ่าน"')}
        </span>
      </div>
      <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <div>
          <div style={lbl}>{tr('① ทิศทาง')}</div>
          <select style={inp} value={f.direction || ''} onChange={e => set('direction', e.target.value)}>
            <option value="">{tr('— ไม่ตัดสิน (ดูตัวเลขอย่างเดียว) —')}</option>
            <option value="up">{tr('ยิ่งมากยิ่งดี (≥)')}</option>
            <option value="down">{tr('ยิ่งน้อยยิ่งดี (≤)')}</option>
          </select>
        </div>
        <div>
          <div style={lbl}>{tr('② Target')} <span style={{ fontWeight: 500 }}>{tr('= ○ ผ่าน')}</span></div>
          <input style={inp} type="number" step="any" value={f.target_value ?? ''} onChange={e => set('target_value', e.target.value)} placeholder={tr('ตัวเลข')} />
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{num(f.target_value) != null && dirCmp ? `${tr("บนใบ")}: ${fmtBar(dirCmp, num(f.target_value), unit)}` : ' '}</div>
        </div>
        <div>
          <div style={lbl}>{tr('③ Commitment')} <span style={{ fontWeight: 500 }}>{tr('= △ ขั้นต่ำ')}</span></div>
          <input style={inp} type="number" step="any" value={f.commit_value ?? ''} onChange={e => set('commit_value', e.target.value)} placeholder={tr('เว้นว่าง = ไม่มี △')} />
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{num(f.commit_value) != null && dirCmp ? `${tr("บนใบ")}: ${fmtBar(dirCmp, num(f.commit_value), unit)}` : tr('ผ่อนกว่า Target เสมอ')}</div>
        </div>
      </div>
      <div>
        <div style={lbl}>{tr('④ ตัดสินรายเดือนยังไง')}</div>
        <div style={{ display: 'grid', gap: 6 }}>
          <label style={radio(!f.score_by_plan)}>
            <input type="radio" name="score_mode" checked={!f.score_by_plan} onChange={() => set('score_by_plan', false)} style={{ marginTop: 2 }} />
            <span><b>{tr('เทียบเป้าเดียวกันทุกเดือน')}</b> — {tr('ค่าแต่ละเดือนเทียบ Target/Commitment ข้างบนตรงๆ (KPI ส่วนใหญ่)')}</span>
          </label>
          <label style={radio(!!f.score_by_plan)}>
            <input type="radio" name="score_mode" checked={!!f.score_by_plan} onChange={() => set('score_by_plan', true)} style={{ marginTop: 2 }} />
            <span><b>{tr('เทียบ "แผนของเดือนนั้น"')}</b> — {tr('กรอกแถว 📅 แผน 12 ช่องในตาราง (เปิดให้เองเมื่อเลือกข้อนี้) · ○ = ถึงแผนเดือนนั้น · △ = ถึงแผน×สัดส่วน Commit/Target · เดือนที่ยังไม่กรอกแผน = เทียบเป้าปีตามเดิม · ใช้กับ KPI สะสม (ยอดขาย/หัว · 100P · TS Academy) และ KPI ที่ budget ไม่เท่ากันทุกเดือน (DL/OH)')}</span>
          </label>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>
        <span style={{ color: 'var(--muted)' }}>{tr('⑤ สรุปทั้งปีรวมด้วย')}</span> <b>{summaryModeLabel(summaryMode)}</b>
        <span style={{ color: 'var(--muted)' }}> {tr('(ตั้งที่ 📘 ทะเบียนชื่อ KPI — เป็นของตัวตน KPI ทุกหน่วยเหมือนกัน)')}</span>
      </div>
      <div style={{ padding: '8px 10px', borderRadius: 'var(--r-sm)', background: 'var(--card-surf)', border: `1px solid ${rule.ok ? 'var(--border2)' : 'var(--amber)'}`, fontSize: 12.5, color: 'var(--text)', lineHeight: 1.5 }}>
        <span style={{ color: 'var(--muted)' }}>{tr('กติกาที่จะใช้:')}</span> {rule.text}
      </div>
      {issues.length > 0 && (
        <div style={{ display: 'grid', gap: 4 }}>
          {issues.map(i => <div key={i.code} style={{ fontSize: 12, color: 'var(--red)', fontWeight: 600 }}>⚠ {i.text}</div>)}
        </div>
      )}
    </div>
  );
}
