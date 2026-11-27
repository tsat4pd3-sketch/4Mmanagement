/* 📈 กราฟ SPC อุปกรณ์ (26/11) — I-MR (ค่าเดียว/ครั้ง) หรือ X̄-R (วัด 2–3 ครั้ง) + เส้น spec
   ผลคำนวณมาจาก `equipSpc()` (src/utils/equipSpc.js → spcCalc.js ตัวเดียวกับ QA) — ไฟล์นี้วาดอย่างเดียว
   🔴 จุดยังไม่ถึง 20 = "ชั่วคราว": วาดเส้นควบคุมแบบจาง + เขียนบอก n/20 · ไม่ทาสีจุดหลุด · ไม่โชว์ Cpk เป็นค่าตัดสิน (user 26/11)
   🔴 X กับ R/MR = 2 กราฟซ้อนแกน X เดียวกัน (ห้ามแกน Y 2 ข้าง · UI §6.19)
   📄 docs/modules/equipment-spc.md */
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts'
import { tr } from '../utils/i18n'
import { tooltipProps, axisTick } from '../utils/chartAxis'
import { chartAnim } from '../utils/motion'

const fmt = (v, d = 3) => (v == null || !Number.isFinite(v) ? '—' : Number(v).toFixed(d))
/** แกน Y ต้องครอบเส้นควบคุม + spec ด้วย (domain 'auto' ตัดเส้นที่อยู่นอกช่วงข้อมูลทิ้ง = เส้นหาย) */
function spanOf(vals) {
  const xs = vals.filter(v => v != null && Number.isFinite(Number(v))).map(Number)
  if (!xs.length) return ['auto', 'auto']
  const lo = Math.min(...xs), hi = Math.max(...xs), pad = (hi - lo || Math.abs(hi) || 1) * 0.08
  return [lo - pad, hi + pad]
}
/** ป้ายแกน: ทศนิยมตามช่วงข้อมูล (ช่วงแคบ 0.01 ห้ามปัดจนตัวเลขซ้ำกัน) */
const tickFmt = ([lo, hi]) => {
  const r = Number(hi) - Number(lo)
  const d = !Number.isFinite(r) || r <= 0 ? 2 : Math.min(4, Math.max(0, Math.ceil(-Math.log10(r)) + 2))
  return (v) => Number(v).toFixed(d)
}
const cpkTone = (v) => (v == null ? 'var(--muted)' : v >= 1.33 ? 'var(--green)' : v >= 1 ? 'var(--amber)' : 'var(--red)')

export default function EquipSpcChart({ cp, result, height = 220 }) {
  if (!result) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{tr('ยังไม่มีค่าวัดของข้อนี้')}</div>
  if (result.allExcluded) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--amber)', fontSize: 13 }}>{tr('ค่าวัดมีจำนวนครั้งต่อรอบไม่เท่ากัน — ยังคิด SPC ไม่ได้')}</div>
  const prov = result.provisional
  const indiv = result.subgroup === 1
  const unit = cp?.unit ? ` ${cp.unit}` : ''
  const ooc = prov ? [] : result.points.filter(p => p.oocX || p.oocR || p.run)
  const limStroke = prov ? 'var(--muted)' : 'var(--red)'
  const dot = (key) => (props) => {
    const p = props.payload
    if (props.cx == null || props.cy == null || p?.[key] == null) return null   // จุดแรกของ MR ไม่มีค่า — ห้ามวาดค้างมุมกราฟ
    const bad = !prov && (key === 'xbar' ? (p.oocX || p.run) : p.oocR)
    return <circle key={`${key}-${p.idx}`} cx={props.cx} cy={props.cy} r={bad ? 5 : 3} fill={bad ? 'var(--red)' : 'var(--blue)'} stroke="none" />
  }
  const xDom = spanOf([...result.points.map(p => p.xbar), result.uclX, result.lclX, cp?.usl, cp?.lsl])
  const rDom = spanOf([0, ...result.points.map(p => p.range), result.uclR])
  const tipLabel = (i) => { const p = result.points[i - 1]; return p ? `#${i} · ${p.date || ''}` : `#${i}` }

  return (
    <div>
      {/* สรุป — ตัวเลขตัดสินเฉพาะเมื่อครบ 20 จุด */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5, color: 'var(--text2)', marginBottom: 8 }}>
        <span><b>{result.nPoints}</b> {tr('จุด')} · {indiv ? 'I-MR' : `X̄-R (n=${result.subgroup})`}</span>
        <span>CL <b>{fmt(result.xbarbar)}</b>{unit}</span>
        {(cp?.lsl != null || cp?.usl != null) && <span>Spec <b>{cp?.lsl ?? '—'} – {cp?.usl ?? '—'}</b>{unit}</span>}
        {prov
          ? <span style={{ color: 'var(--amber)', fontWeight: 700 }}>⏳ {tr('เส้นควบคุมชั่วคราว')} ({result.nPoints}/{result.minPoints} {tr('จุด')}) — {tr('ยังไม่ตัดสิน in/out of control')}</span>
          : <>
              <span>Cpk <b style={{ color: cpkTone(result.cpk) }}>{fmt(result.cpk, 2)}</b></span>
              <span style={{ color: ooc.length ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>
                {ooc.length ? `⚠ ${tr('หลุดการควบคุม')} ${ooc.length} ${tr('จุด')}` : `✓ ${tr('อยู่ในการควบคุม')}`}
              </span>
            </>}
        {result.oos > 0 && <span style={{ color: 'var(--red)' }}>{tr('นอก spec')} {result.oos} {tr('ค่า')}</span>}
        {result.excluded > 0 && <span style={{ color: 'var(--muted)' }}>{tr('ตัดออก')} {result.excluded} {tr('ครั้ง (จำนวนค่าวัดไม่ครบ')} {result.subgroup})</span>}
      </div>

      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text2)', margin: '4px 0' }}>{indiv ? 'Individuals (I)' : 'X̄'}</div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={result.points} margin={{ top: 6, right: 78, left: 4, bottom: 0 }} syncId={`spc-${cp?.id || 'x'}`}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="idx" tick={axisTick()} />
          <YAxis width="auto" domain={xDom} tick={axisTick()} tickFormatter={tickFmt(xDom)} />
          <Tooltip {...tooltipProps()} labelFormatter={tipLabel} />
          <ReferenceLine y={result.uclX} stroke={limStroke} strokeDasharray="5 3" label={{ value: `UCL ${fmt(result.uclX)}`, fontSize: 11, fill: limStroke, position: 'right' }} />
          <ReferenceLine y={result.xbarbar} stroke="var(--green)" label={{ value: 'CL', fontSize: 11, fill: 'var(--green)', position: 'right' }} />
          <ReferenceLine y={result.lclX} stroke={limStroke} strokeDasharray="5 3" label={{ value: `LCL ${fmt(result.lclX)}`, fontSize: 11, fill: limStroke, position: 'right' }} />
          {cp?.usl != null && <ReferenceLine y={Number(cp.usl)} stroke="var(--amber)" strokeDasharray="2 3" label={{ value: 'USL', fontSize: 11, fill: 'var(--amber)', position: 'insideTopLeft' }} />}
          {cp?.lsl != null && <ReferenceLine y={Number(cp.lsl)} stroke="var(--amber)" strokeDasharray="2 3" label={{ value: 'LSL', fontSize: 11, fill: 'var(--amber)', position: 'insideBottomLeft' }} />}
          <Line type="linear" dataKey="xbar" name={indiv ? 'X' : 'X̄'} stroke="var(--blue)" strokeWidth={2} dot={dot('xbar')} {...chartAnim()} />
        </LineChart>
      </ResponsiveContainer>

      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text2)', margin: '10px 0 4px' }}>{indiv ? 'Moving Range (MR)' : 'Range (R)'}</div>
      <ResponsiveContainer width="100%" height={Math.round(height * 0.7)}>
        <LineChart data={result.points} margin={{ top: 6, right: 78, left: 4, bottom: 0 }} syncId={`spc-${cp?.id || 'x'}`}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="idx" tick={axisTick()} />
          <YAxis width="auto" domain={[0, rDom[1]]} tick={axisTick()} tickFormatter={tickFmt([0, rDom[1]])} />
          <Tooltip {...tooltipProps()} labelFormatter={tipLabel} />
          {result.uclR != null && <ReferenceLine y={result.uclR} stroke={limStroke} strokeDasharray="5 3" label={{ value: `UCL ${fmt(result.uclR)}`, fontSize: 11, fill: limStroke, position: 'right' }} />}
          {result.rbar != null && <ReferenceLine y={result.rbar} stroke="var(--green)" label={{ value: 'CL', fontSize: 11, fill: 'var(--green)', position: 'right' }} />}
          <Line type="linear" dataKey="range" name={indiv ? 'MR' : 'R'} stroke="var(--blue)" strokeWidth={2} dot={dot('range')} connectNulls {...chartAnim()} />
        </LineChart>
      </ResponsiveContainer>

      {ooc.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text2)' }}>
          {ooc.slice(0, 6).map(p => `#${p.idx} (${p.date}): ${[p.oocX && tr('เกินเส้นควบคุม'), p.oocR && tr('ช่วงแกว่งเกินเส้น'), p.run && tr('เกาะข้างเดียว ≥7 จุด')].filter(Boolean).join(', ')}`).join(' · ')}
          {ooc.length > 6 ? ` · ${tr('และอีก')} ${ooc.length - 6}` : ''}
        </div>
      )}
    </div>
  )
}
