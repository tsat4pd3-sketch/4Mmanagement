/* ══ 📊 กราฟแท่งมาตรฐาน (2026-11-28 · คำสั่ง user "มาตรฐานกราฟแท่งใช้แบบนี้ · ขยายผลกราฟแท่ง" — ต้นแบบจากระบบ Core) ══
   หน้าตา: ชื่อกราฟซ้าย · คำอธิบาย (legend) ขวาบน = กล่องสี + ชื่อชุด · เส้นประแดง + ชื่อเกณฑ์
   · ชื่อแกน Y อยู่เหนือหัวแกน · ขีดแกน 0/25/50/75/100 (ไม่ใส่หน่วยที่ขีด — หน่วยอยู่ในชื่อแกน)
   · แท่ง = สีโปร่ง + ขอบสีทึบ · ค่าบนหัวแท่ง (มีหน่วย) · ตัวเลขประกอบกลางแท่ง (`inner` เช่น "34 ใบ")
   · เส้นเป้า = เส้นประแดง เต็มความกว้าง ป้าย "Target xx%" ชิดขวาเหนือเส้น
   · ค่า `null` = ไม่มีข้อมูล ⇒ ไม่วาดแท่ง ไม่มีป้าย (ห้ามโชว์ 0 แทน "ไม่มี")
   ใช้กับกราฟแท่งใหม่ทุกตัว · พาเรโตยังใช้ `<ParetoChart>` (กติกาต่างกัน) */
import { Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisTick, tooltipProps } from '../utils/chartAxis';
import { chartAnim } from '../utils/motion';

const fmt = (v, digits) => (v == null ? '' : Number(v).toFixed(digits));

/**
 * @param {{ title: string, data: {name:string, value:number|null, inner?:string}[], color: string,
 *   seriesLabel: string, unit?: string, digits?: number, yMax?: number, yTicks?: number[], yTitle?: string,
 *   targets?: {value:number, label?:string, legend?:string}[], height?: number, tooltipName?: string }} p
 */
export default function StdBarChart({ title, data, color, seriesLabel, unit = '', digits = 2, yMax, yTicks, yTitle, targets = [], height = 240, tooltipName }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-sm)', padding: '14px 16px 8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--text2)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {/* กล่องสีเหมือนแท่ง: ขอบทึบ + พื้นสีเดียวกันโปร่ง (ไม่ใช้ color-mix — จอ TV Chromium 94) */}
            <span aria-hidden="true" style={{ position: 'relative', width: 12, height: 12, borderRadius: 3, border: `1.5px solid ${color}`, flexShrink: 0, overflow: 'hidden' }}>
              <span style={{ position: 'absolute', inset: 0, background: color, opacity: 0.22 }} />
            </span>
            {seriesLabel}
          </span>
          {targets.map((t, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span aria-hidden="true" style={{ width: 16, borderTop: '2px dashed var(--red)' }} />
              {t.legend || t.label}
            </span>
          ))}
        </span>
      </div>
      {yTitle && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>{yTitle}</div>}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="name" tick={axisTick()} interval={0} tickLine={false} axisLine={{ stroke: 'var(--border2)' }} />
          <YAxis width="auto" domain={[0, yMax ?? 'auto']} ticks={yTicks} tick={axisTick()} tickLine={false} axisLine={false} />
          <Tooltip {...tooltipProps()} cursor={{ fill: 'var(--accent-dim)' }}
            formatter={(v, _k, it) => [v == null ? '-' : `${fmt(v, digits)}${unit}${it.payload.inner ? ` · ${it.payload.inner}` : ''}`, tooltipName || seriesLabel]} />
          {targets.map((t, i) => (
            <ReferenceLine key={i} y={t.value} stroke="var(--red)" strokeWidth={2} strokeDasharray="6 4" ifOverflow="extendDomain"
              label={{ value: t.label || `Target ${fmt(t.value, digits)}${unit}`, position: 'insideBottomRight', fill: 'var(--red)', fontSize: 12 }} />
          ))}
          <Bar {...chartAnim()} dataKey="value" fill={color} fillOpacity={0.22} stroke={color} strokeWidth={1.5} radius={[4, 4, 0, 0]} maxBarSize={46}>
            <LabelList dataKey="value" position="top" formatter={(v) => (v == null ? '' : `${fmt(v, digits)}${unit}`)} style={{ fill: 'var(--text)', fontSize: 12 }} />
            <LabelList dataKey="inner" position="center" style={{ fill: 'var(--text)', fontSize: 12 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
