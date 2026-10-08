import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import {
  AXIS_FS, CELL_BAR_FILL, tooltipProps, axisTick, CHART_MARGIN, axisUnitLabel, axisUnitTop,
} from '../utils/chartAxis';

/* ══ 📊 CapacityLoadChart — "ภาระที่ต้องทำ" เทียบ "กำลังที่มี" หน่วยเดียวกันคือ **กะ** ═══════
   ที่มา (user 2026-10-06): *"3 tab แรกเราว่าฟุ่มเฟือย มันคือเรื่องเดียวกันคนละมุมมอง
   ซึ่งโรงงานชอบแบบกราฟ"* — หน้าวางแผนเดิมเป็นตารางล้วน **ไม่มีกราฟเลยสักตัว**

   ทำไมหน่วยเป็น "กะ" ไม่ใช่ "ชิ้น": ชิ้นของคนละพาร์ทเทียบกันไม่ได้ (CT ต่างกัน 5s กับ 13s)
   แต่ "กะ" คือหน่วยที่หัวหน้าไลน์ตัดสินใจจริง — เกิน 1 กะ = ต้องเปิด OT/กะดึก

   🔴 กติกากราฟของโปรเจค (UI §6.19 · utils/chartAxis.js · มีด่าน build):
   • `YAxis width="auto"` · margin ซ้ายห้ามติดลบ ⇒ ใช้ `CHART_MARGIN`
   • `<Bar>` ที่ลูกเป็น `<Cell>` ต้องมี `fill={CELL_BAR_FILL}` + `<Tooltip {...tooltipProps()}>`
     (ไม่งั้น tooltip เป็นตัวหนังสือดำบนการ์ดเข้ม)
   • **ห้ามแกน Y 2 ข้าง** — ที่นี่มีแกนเดียว (กะ) เพราะทั้งภาระและกำลังเป็นหน่วยเดียวกัน
     ⇒ "กำลังที่มี" วาดเป็น **เส้นอ้างอิง** ไม่ใช่ series ที่มีแกนของตัวเอง
   🔴 **ไม่รู้กำลัง = ไม่วาดเส้น** (ห้ามลากเส้นที่ 0 — คนจะอ่านว่า "ไม่มีกำลังเลย")
   ═══════════════════════════════════════════════════════════════════════════════════════ */

const C_OK = '#22c55e';      // อยู่ในกำลังกะปกติ
const C_OVER = '#f59e0b';    // เกินกำลัง — ต้องเปิดเพิ่ม
const C_HARD = '#ef4444';    // เกินแม้เปิดเต็มที่
const C_IDLE = 'var(--border2)';

export default function CapacityLoadChart({
  data = [],            // [{ key, label, load, note? }] — load = กะที่ต้องใช้
  capacity = null,      // กะที่มีตามปกติ (กะเช้า) · null = ไม่รู้ ⇒ ไม่วาดเส้น
  capacityMax = null,   // กะที่มีถ้าเปิดเต็มที่ (เช้า+ดึก) · null = ไม่รู้
  height = 150,
  unit = 'กะ',
}) {
  if (!data.length) return null;
  const colorOf = (v) => {
    if (!(v > 0)) return C_IDLE;
    if (capacityMax !== null && v > capacityMax + 1e-9) return C_HARD;
    if (capacity !== null && v > capacity + 1e-9) return C_OVER;
    return C_OK;
  };

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ ...CHART_MARGIN, top: axisUnitTop(AXIS_FS) }} barCategoryGap="12%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={axisTick()} interval="preserveStartEnd" />
          <YAxis width="auto" tick={axisTick()} allowDecimals label={axisUnitLabel(unit, { fontSize: AXIS_FS })}   /* 🔴 ห้ามต่ำกว่า 11px — จอ TV อ่านไม่ออก (ด่าน chartsweep จับได้ 06/10) */ />
          <Tooltip
            {...tooltipProps()}
            formatter={(v) => [`${Number(v).toFixed(2)} ${unit}`, 'ต้องใช้']}
            labelFormatter={(l, p) => p?.[0]?.payload?.note || l}
          />
          {/* เส้นกำลัง — มีค่าจริงเท่านั้นถึงวาด */}
          {capacity !== null ? (
            <ReferenceLine y={capacity} stroke={C_OK} strokeDasharray="5 4"
              label={{ value: `กำลังปกติ ${capacity}`, position: 'insideTopRight', fill: C_OK, fontSize: AXIS_FS, fontWeight: 700 }} />
          ) : null}
          {capacityMax !== null && capacity !== null && capacityMax > capacity ? (
            <ReferenceLine y={capacityMax} stroke={C_HARD} strokeDasharray="2 4"
              label={{ value: `เปิดเต็มที่ ${capacityMax}`, position: 'insideTopRight', fill: C_HARD, fontSize: AXIS_FS, fontWeight: 700 }} />
          ) : null}
          <Bar dataKey="load" fill={CELL_BAR_FILL} radius={[3, 3, 0, 0]}>
            {data.map((d) => <Cell key={d.key} fill={colorOf(d.load)} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
