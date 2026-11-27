/* ══ 🔎 kpiInsight — "ทำไมถึงตก · ค่าไหนเกิน · เพราะอะไร" ของแผ่น KPI ตอนกด 🔍 (2026-11-16 · คำสั่ง user) ═══
   user: "ปุ่มแว่นขยายบนแผ่นที่ไม่ตามเป้า กดแล้วไปหน้ากรอกข้อมูลเพื่ออะไร — ควรเป็นการสรุป insight ว่าตกเพราะอะไร
          ค่าไหนเกินเป้า เกินเพราะสาเหตุไหน · และทุกกราฟต้องตอบได้ว่าจบปีจะผ่านหรือไม่ผ่าน"
   pure ทั้งไฟล์ (เทส `__tests__/kpiInsight.test.mjs`) — จอส่งตัวเลขที่ตัดสินแล้วเข้ามา (ค่า/เป้า/สถานะรายเดือนจาก scoreDef · ตัวแปรสูตรจาก
   applyFormulaEntries · คาดปลายปีจาก yearForecast · อัตราที่ต้องทำจาก neededRunRate) ตัวนี้แค่ "เรียบเรียง" **ไม่คิดเกณฑ์เอง**
   🔴 กฎความซื่อสัตย์: ไม่มีข้อมูลข้อไหน = ไม่เขียนข้อนั้น (ไม่เดา) · การคาดการณ์ต้องบอกสมมติฐานทุกครั้ง */
import { baseVarOf, formulaOf } from './kpiSetup.js';
import { tr } from './i18n.js';

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const pct = (a, b) => (a == null || b == null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100);
const sgn = (x, d = 1) => (x == null ? '—' : `${x > 0 ? '+' : ''}${Number(x).toFixed(d)}`);

/** ตัวแปรของสูตรขยับยังไงเทียบเดือนก่อน + ตัวไหนเป็นเหตุหลัก (สูตรอัตราส่วน: ตัวตั้ง = ทุกตัวยกเว้นตัวสุดท้าย · ตัวหาร = ตัวสุดท้าย) */
export function formulaDrivers(info, month, prevMonth, { fmtIn = (v, x) => String(x) } = {}) {
  const f = info?.key ? formulaOf(info.key) : null;
  const cur = info?.inputs?.[month], prev = info?.inputs?.[prevMonth];
  if (!f || !cur || !prev) return null;
  const vars = f.vars.map((k) => ({ key: k, label: (baseVarOf(k)?.label || k).split(' (')[0], cur: num(cur[k]), prev: num(prev[k]) }))
    .map((v) => ({ ...v, chg: pct(v.cur, v.prev) }));
  if (vars.some(v => v.cur == null || v.prev == null)) return { vars, driver: null };
  const isRatio = f.unit === '%' || f.key === 'inventory_day' || f.key === 'sale_per_head';
  let driver = null;
  if (isRatio && vars.length >= 2) {
    const den = vars[vars.length - 1];
    const nums = vars.slice(0, -1);
    const numSum = (arr, k) => arr.reduce((s, v) => s + v[k], 0);
    const numChg = pct(numSum(nums, 'cur'), numSum(nums, 'prev'));
    const denChg = den.chg;
    const numLabel = nums.map(v => v.label).join('+');
    const numUp = numChg != null && numChg > 0, denUp = denChg != null && denChg > 0;
    /* ผลต่อ "ค่า %" : ตัวตั้งขึ้น ⇒ % ขึ้น · ตัวหารขึ้น ⇒ % ลง — เหตุหลัก = ฝั่งที่ขยับแรงกว่า */
    const main = Math.abs(numChg ?? 0) >= Math.abs(denChg ?? 0) ? 'num' : 'den';
    driver = {
      numLabel, denLabel: den.label, numChg, denChg, main,
      text: main === 'num'
        ? `ตัวตั้ง (${numLabel}) ${numUp ? tr("เพิ่ม") : 'ลด'} ${Math.abs(numChg).toFixed(1)}% แรงกว่าตัวหาร (${den.label}) ${denUp ? tr("เพิ่ม") : 'ลด'} ${Math.abs(denChg ?? 0).toFixed(1)}% ⇒ ค่าขยับเพราะ${numLabel}เป็นหลัก`
        : `ตัวหาร (${den.label}) ${denUp ? tr("เพิ่ม") : 'ลด'} ${Math.abs(denChg).toFixed(1)}% แรงกว่าตัวตั้ง (${numLabel}) ${numUp ? tr("เพิ่ม") : 'ลด'} ${Math.abs(numChg ?? 0).toFixed(1)}% ⇒ ค่าขยับเพราะ${den.label}${denUp ? 'โต' : 'หด'}เป็นหลัก`,
    };
  }
  return { vars, driver, lines: vars.map(v => `${v.label} ${fmtIn(v.key, v.prev)} → ${fmtIn(v.key, v.cur)} (${sgn(v.chg)}%)`) };
}

/* ── 🥇 ลำดับความสำคัญของ insight (2026-11-16 · คำสั่ง user "insight ไม่เกิน 3-4 บรรทัดพอ") ────────
   popup 🔍 โชว์แค่ 3 ข้อแรก (ที่เหลือกางดูได้) ⇒ **ข้อที่ต้องลงมือก่อนต้องมาก่อน** ไม่ใช่เรียงตามลำดับที่เขียนโค้ด
   เกณฑ์: "ตกไหม" → "จบปีจะตกไหม" → "ต้องทำเท่าไหร่" → "เพราะอะไร (เหตุหลัก/หมายเหตุคน)" → บริบท (สถิติปี/แนวโน้ม) → ตัวเลขตัวแปรดิบ
   🔴 เลขน้อย = สำคัญกว่า · เท่ากัน = เรียงตามลำดับที่ push (เสถียร ทดสอบได้) */
export const INSIGHT_PRIO = Object.freeze({
  gapBad: 10,      // ❌ เดือนนี้หลุดเป้า = พาดหัว
  fcBad: 20,       // 🔮 จบปีไม่ถึงเป้า
  fcWarn: 25,
  needed: 30,      // 🏁 ต้องทำเดือนละเท่าไหร่ถึงจะทัน
  driver: 35,      // 🎯 เหตุหลักจากตัวแปรสูตร
  note: 40,        // 📝 เหตุผลที่คนเขียนไว้เอง (ของจริงกว่าทุกข้อที่ระบบเดา)
  gapOk: 50,       // ✅ เดือนนี้ผ่าน (ยังเป็นพาดหัว แต่ไม่ใช่เรื่องเร่ง)
  year: 60,        // 📊 สถิติทั้งปี
  trend: 65,       // 📈 เทียบเดือนก่อน
  fcGood: 70,
  neededOk: 75,
  vars: 90,        // 🧮 ตัวเลขตัวแปรดิบ = ยาวสุด ลงมือจากมันตรงๆ ไม่ได้
});

/**
 * @param series   12 จุด { k:'YYYY-MM', v, notes:[{kind,text}] } (ไม่รวมแท่งสรุป)
 * @param monthOf  (idx0) → ป้ายเดือน · fmt(v) → ข้อความค่า+หน่วย · monthStatus(p) → 'good'|'warn'|'bad'|'none' (จาก scoreDef ของจอ)
 * @returns [{ icon, text, tone, kind, prio }] **เรียงตามความสำคัญแล้ว** (ดู INSIGHT_PRIO — ข้อที่ต้องลงมือก่อนมาก่อน)
 *          ว่าง = ไม่มีอะไรจะบอก (จอเขียน "ยังไม่มีข้อมูลพอสรุป")
 */
export function buildInsight({
  series = [], valueIdx = null, value = null, target = null, commit = null, dir = 'up', targetCompare = null,
  monthStatus = () => 'none', fmt = (v) => String(v), monthOf = (i) => `เดือน ${i + 1}`, fmtIn = null,
  info = null, forecast = null, needed = null, byPlan = false, planValue = null,
} = {}) {
  const out = [];
  const v = num(value), t = num(target), c = num(commit);
  const down = dir === 'down';
  const better = (x, y) => (down ? x <= y : x >= y);   // x ดีกว่าหรือเท่า y
  const mLabel = valueIdx != null ? monthOf(valueIdx) : '';

  /* 1) เดือนนี้เทียบเป้า — เกินเท่าไหร่ กี่ % */
  if (v != null && (t != null || c != null)) {
    const ref = byPlan && num(planValue) != null ? num(planValue) : t;
    const refName = byPlan && num(planValue) != null ? 'แผนสะสม' : 'Target';
    if (ref != null) {
      const gap = v - ref; const gp = pct(v, ref);
      const ok = better(v, ref);
      const cmpSym = { '>=': '≥', '<=': '≤', '>': '>', '<': '<', '=': '=' }[targetCompare] || targetCompare || (down ? '≤' : '≥');
      out.push({ icon: ok ? '✅' : '❌', tone: ok ? 'good' : 'bad', kind: 'gap', prio: ok ? INSIGHT_PRIO.gapOk : INSIGHT_PRIO.gapBad,
        data: { ok, value: v, ref, refName, cmpSym, gap, gapPct: gp, commitHit: c != null ? better(v, c) : null, down, label: mLabel },
        text: `${mLabel} ${fmt(v)} เทียบ ${refName} ${cmpSym} ${fmt(ref)} → ${ok ? (down ? 'ต่ำกว่าเป้า' : 'สูงกว่าเป้า') : (down ? 'เกินเป้า' : 'ต่ำกว่าเป้า')} ${fmt(Math.abs(gap))}${gp != null ? ` (${Math.abs(gp).toFixed(1)}%)` : ''}${!ok && c != null && better(v, c) ? ' · ยังถึง Commitment' : ''}${!ok && c != null && !better(v, c) ? ` · หลุด Commitment ${fmt(c)} ด้วย` : ''}` });
    }
  }

  /* 2) ทั้งปี — ผ่านกี่เดือน หลุดกี่เดือน เดือนไหนแย่สุด */
  const pts = series.slice(0, 12).map((p, i) => ({ ...p, i, v: num(p?.v) })).filter(p => p.v != null);
  if (pts.length >= 2 && (t != null || c != null)) {
    const st = pts.map(p => ({ ...p, s: monthStatus(p) }));
    const bad = st.filter(p => p.s === 'bad'), warn = st.filter(p => p.s === 'warn'), good = st.filter(p => p.s === 'good');
    const worst = st.reduce((w, p) => (w == null || (down ? p.v > w.v : p.v < w.v) ? p : w), null);
    const best = st.reduce((w, p) => (w == null || (down ? p.v < w.v : p.v > w.v) ? p : w), null);
    out.push({ icon: '📊', tone: bad.length ? 'bad' : 'good', kind: 'year', prio: INSIGHT_PRIO.year,
      text: `${pts.length} เดือนที่มีค่า: ผ่าน ${good.length}${warn.length ? ` · ถึงแค่ Commit ${warn.length}` : ''} · หลุด ${bad.length}${bad.length ? ` (${bad.map(p => monthOf(p.i)).join(' ')})` : ''}${worst ? ` · แย่สุด ${monthOf(worst.i)} ${fmt(worst.v)}` : ''}${best && best.i !== worst?.i ? ` · ดีสุด ${monthOf(best.i)} ${fmt(best.v)}` : ''}` });
  }

  /* 3) แนวโน้ม — เทียบเดือนก่อนหน้าที่มีค่า + ติดต่อกันกี่เดือน */
  if (valueIdx != null && v != null) {
    const prev = pts.filter(p => p.i < valueIdx).pop() || null;
    if (prev) {
      const d = v - prev.v; const improving = down ? d < 0 : d > 0;
      let streak = 0;
      for (let i = pts.length - 1; i >= 0 && pts[i].i <= valueIdx; i--) { if (monthStatus(pts[i]) === 'bad') streak += 1; else break; }
      out.push({ icon: d === 0 ? '➡️' : improving ? '📈' : '📉', tone: d === 0 ? 'none' : improving ? 'good' : 'warn', kind: 'trend', prio: INSIGHT_PRIO.trend,
        text: `เทียบ ${monthOf(prev.i)} ${fmt(prev.v)} → ${fmt(v)} (${d > 0 ? '+' : ''}${fmt(d)}${pct(v, prev.v) != null ? ` · ${sgn(pct(v, prev.v))}%` : ''} · ${d === 0 ? 'เท่าเดิม' : improving ? 'ดีขึ้น' : 'แย่ลง'})${streak >= 2 ? ` · หลุดเป้าติดต่อกัน ${streak} เดือน` : ''}` });
    }
  }

  /* 4) สูตร — ตัวแปรไหนขยับ ตัวไหนเป็นเหตุหลัก */
  if (info && valueIdx != null) {
    const m = valueIdx + 1;
    const prevM = [...Array(m - 1).keys()].map(i => i + 1).reverse().find(x => info.inputs?.[x]);
    const dr = prevM ? formulaDrivers(info, m, prevM, { fmtIn: fmtIn || ((k, x) => String(x)) }) : null;
    if (dr?.lines?.length) {
      out.push({ icon: '🧮', tone: 'none', kind: 'vars', prio: INSIGHT_PRIO.vars, text: `ตัวแปรเทียบ ${monthOf(prevM - 1)}: ${dr.lines.join(' · ')}` });
      if (dr.driver) out.push({ icon: '🎯', tone: 'warn', kind: 'driver', prio: INSIGHT_PRIO.driver, text: dr.driver.text });
    }
  }

  /* 5) หมายเหตุของเดือนที่ดู (คนเขียนเหตุผลไว้แล้ว = ของจริงกว่าทุกข้อข้างบน) */
  const notes = valueIdx != null ? (series[valueIdx]?.notes || []) : [];
  notes.slice(0, 3).forEach(n => out.push({ icon: '📝', tone: 'none', kind: 'note', prio: INSIGHT_PRIO.note, text: `${n.kind === 'action' ? 'Action' : n.kind === 'remark' ? 'Remark' : 'Note'}: ${n.text}${n.image_url ? ' 📷' : ''}${n.created_by_name ? ` — ${n.created_by_name}` : ''}` }));

  /* 6) จบปี — คาดการณ์ + ต้องทำเท่าไหร่ถึงผ่าน (สมมติฐานต้องเขียนเสมอ) */
  if (forecast && forecast.value != null) {
    const f = forecast;
    const assume = f.basis === 'plan' ? `แผนรายเดือน ${f.planMonths} ด.`
      : f.assumed?.kind === 'slope' ? `เดือนที่เหลือ ${f.assumedMonths.length} ด. เพิ่มต่อเท่าอัตราเดิม${f.planMonths ? ` + แผน ${f.planMonths} ด.` : ''}`
      : f.assumed ? `เดือนที่เหลือ ${f.assumedMonths.length} ด. ทำได้เท่าค่าเฉลี่ย ${fmt(f.assumed.rate)}${f.planMonths ? ` + แผน ${f.planMonths} ด.` : ''}` : 'ครบ 12 เดือนจริง';
    const verdict = f.status === 'good' ? tr("✅ คาดถึงเป้า") : f.status === 'warn' ? '🟡 ถึงแค่ Commitment' : f.status === 'bad' ? tr("❌ คาดไม่ถึงเป้า") : 'ยังไม่มีเป้าให้ตัดสิน';
    out.push({ icon: '🔮', tone: f.status === 'good' ? 'good' : f.status === 'bad' ? 'bad' : 'warn', kind: 'forecast',
      data: { value: f.value, status: f.status, basis: f.basis, assumed: f.assumed, actualMonths: f.actualMonths, assumedMonths: f.assumedMonths, planMonths: f.planMonths, approx: f.approx, assume, verdict },
      prio: f.status === 'bad' ? INSIGHT_PRIO.fcBad : f.status === 'good' ? INSIGHT_PRIO.fcGood : INSIGHT_PRIO.fcWarn,
      text: `คาดปลายปี ${f.approx ? '≈ ' : ''}${fmt(f.value)} (จริง ${f.actualMonths} ด. · ถ้า${assume}) → ${verdict}` });
  }
  if (needed && t != null && needed.feasible === false) {
    /* 🧱 20/11 (user): ที่ต้องทำหลุดช่วงที่เป็นไปได้ของทะเบียน (OEE > 100 % · MTTR ติดลบ) = **ไม่คาดการณ์ตัวเลข** บอกตรงๆ ว่าไม่ทันแล้ว */
    const n = needed;
    const lim = n.limit?.kind === 'max' ? `เพดาน ${fmt(n.limit.value)}` : `พื้น ${fmt(n.limit?.value)}`;
    out.push({ icon: '🏁', tone: 'bad', kind: 'needed', prio: INSIGHT_PRIO.needed, data: { ...n, trivially: false, down },
      text: n.kind === 'reach'
        ? `ไม่ทัน Target ${fmt(t)} ทั้งปีแล้ว — ต้องไปให้ถึง ${fmt(t)} ซึ่ง${n.limit?.kind === 'max' ? 'เกิน' : 'ต่ำกว่า'}${lim} ที่เป็นไปได้`
        : `ไม่ทัน Target ${fmt(t)} ทั้งปีแล้ว — ต่อให้ ${n.remaining} เดือนที่เหลือทำได้สุด${lim} ทุกเดือน ทั้งปีดีสุดได้แค่ ${fmt(n.bestCase)}` });
  } else if (needed && t != null) {
    const n = needed;
    if (n.kind === 'reach') out.push({ icon: '🏁', tone: better(0, n.add) ? 'good' : 'warn', kind: 'needed', prio: better(0, n.add) ? INSIGHT_PRIO.neededOk : INSIGHT_PRIO.needed, data: { ...n, reached: better(0, n.add), down }, text: better(0, n.add) ? `ถึงเป้าทั้งปี ${fmt(t)} แล้ว (ตัวสะสมถอยไม่ได้)` : `ต้องไปให้ถึง ${fmt(t)} ภายใน ${n.remaining} เดือนที่เหลือ (เพิ่มอีก ${fmt(Math.abs(n.add))})` });
    else {
      const trivially = n.trivial === true || (down ? false : n.perMonth <= 0);   // ตัวยิ่งสูงยิ่งดี: ที่ต้องทำ ≤ 0 (หรือ ≤ พื้น/≥ เพดานของทะเบียน) = ผ่านแล้วแม้เดือนที่เหลือเป็น 0
      out.push({ icon: '🏁', tone: trivially ? 'good' : 'warn', kind: 'needed', prio: trivially ? INSIGHT_PRIO.neededOk : INSIGHT_PRIO.needed, data: { ...n, trivially, down },
        text: trivially ? `เป้าทั้งปีถึงแล้ว — เดือนที่เหลือ ${n.remaining} ด. ได้ 0 ก็ยังผ่าน`
          : `เดือนที่เหลือ ${n.remaining} ด. ต้อง${down ? 'ไม่เกิน' : 'ได้อย่างน้อย'}${n.kind === 'sum' ? 'เดือนละ' : 'เฉลี่ยเดือนละ'} ${fmt(n.perMonth)} ถึงจะถึง Target ${fmt(t)} ทั้งปี` });
    }
  }
  /* 🥇 เรียงตามความสำคัญ (ข้อที่ต้องลงมือก่อนขึ้นก่อน) — จอโชว์ 3 ข้อแรก ที่เหลือกางดูได้
     เสมอกัน = คงลำดับที่ push (เสถียร · เทสล็อกลำดับไว้) */
  return out
    .map((x, i) => ({ prio: INSIGHT_PRIO.vars, ...x, _i: i }))
    .sort((a, b) => a.prio - b.prio || a._i - b._i)
    .map(({ _i, ...x }) => x);
}
