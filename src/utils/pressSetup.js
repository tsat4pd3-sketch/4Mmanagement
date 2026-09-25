/* ══ เวลาเปลี่ยนรุ่นงานปั๊ม (sequence-dependent setup time) ═══════════════════════════
   ที่มา (user 2026-09-24): "งานปั๊มมันจะวุ่นวายกว่าที่ผ่านมา มันมี setup time change over die
   มาเป็นตัวแปร ถ้า die height ต่างกันเกินมันมีผล เลยต้องมีการ drag จัดแผนเพื่อหา optimization"

   แก่นของโจทย์: เวลา setup **ขึ้นกับลำดับ** — A→B กับ B→A ไม่เท่ากันก็ได้ และสลับลำดับ
   ให้ |Δ die height| น้อย = ปรับ shut height น้อย = ได้เวลาผลิตคืนมาโดยไม่ต้องลงทุนอะไร

   🔴 กฎความซื่อสัตย์ (บังคับ — จอที่แนะนำจากตัวเลขที่เดาเอง อันตรายกว่าจอที่บอกว่าไม่รู้):
     · **ไม่มีกฎในทะเบียน = `min: null` + `state:'no_rule'` ห้ามคืน 0 และห้าม fallback เลขในโค้ด**
       (ค่าจริงต้องมาจากช่างปั๊ม — ตาราง `press_setup_rules` ตั้งใจสร้างไว้ว่าง)
     · **ไม่รู้ die height ข้างใดข้างหนึ่ง = `state:'unknown_height'`** คืนได้แค่เวลาฐาน
       และจอต้องเขียนกำกับว่าตัวเลขนี้ยังไม่รวมผลของความสูง
     · `fitsPress` คืน `null` เมื่อไม่รู้ — **`null` ไม่ใช่ `false`** ("ไม่รู้ว่าขึ้นได้ไหม"
       ห้ามแปลว่า "ขึ้นไม่ได้" แล้วไปตัดตัวเลือกของคนวางแผนทิ้ง)

   ⚠️ ข้อมูลตั้งต้น ณ วันที่เขียน: แม่พิมพ์ 262 ตัว **กรอกความสูงแล้ว 0 ตัว** และ
      ไลน์ปั๊มไม่เคยบันทึก downtime "Set up Machine" เลยใน 120 วัน ⇒ ทุกจอที่ใช้ไฟล์นี้
      ต้องรับมือกับ "ยังไม่มีข้อมูล" เป็นกรณีปกติ ไม่ใช่กรณียกเว้น
   ═══════════════════════════════════════════════════════════════════════════════════ */

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/* ── กฎที่ใช้กับเครื่องนี้ — เครื่อง ชนะ ไลน์ ชนะ ทั้งโรงงาน ────────────────────────────
   (หลักเดียวกับ scope ของ KPI/oee_targets: เฉพาะเจาะจงกว่าชนะเสมอ) */
export function resolveSetupRule(rules = [], { machineNo = null, lineName = null } = {}) {
  const act = rules.filter(r => r && r.is_active !== false);
  const pick = (kind, value) => act.find(r =>
    r.scope_kind === kind && String(r.scope_value ?? '') === String(value ?? ''));
  return (machineNo && pick('machine', machineNo))
      || (lineName  && pick('line', lineName))
      || pick('global', null)
      || null;
}

/* ขั้นบันไดของ |Δ height| → นาทีที่บวกเพิ่ม · steps เรียงน้อย→มาก · max_mm null = ขั้นสุดท้าย */
export function stepAddMin(steps, diffMm) {
  const list = (Array.isArray(steps) ? steps : [])
    .map(s => ({ max: num(s?.max_mm), add: num(s?.add_min) ?? 0 }))
    .sort((a, b) => (a.max == null ? Infinity : a.max) - (b.max == null ? Infinity : b.max));
  for (const s of list) if (s.max == null || diffMm <= s.max) return s.add;
  return list.length ? list[list.length - 1].add : 0;
}

/* ── เวลาเปลี่ยนจากแม่พิมพ์ตัวหนึ่งไปอีกตัว ─────────────────────────────────────────────
   die = { id, die_height_mm } · ตัวแรกของกะ (fromDie = null) ถือว่าไม่มีการเปลี่ยน = 0 */
export function setupMinutes({ fromDie = null, toDie = null, rule = null } = {}) {
  if (!toDie) return { min: 0, state: 'none', diffMm: null };
  if (!fromDie) return { min: 0, state: 'first', diffMm: null };   // ใบแรก — ไม่มีของเดิมให้ถอด
  const sameDie = fromDie.id != null && fromDie.id === toDie.id;

  if (!rule) {
    // ⚠️ ไม่มีกฎ = ตอบไม่ได้ ห้ามเดาเป็น 0 (0 จะทำให้แผนดูดีเกินจริงแล้วคนเชื่อ)
    return { min: null, state: 'no_rule', sameDie, diffMm: null };
  }
  if (sameDie) return { min: num(rule.same_die_min) ?? 0, state: 'same_die', sameDie, diffMm: 0 };

  const base = num(rule.base_min) ?? 0;
  const h1 = num(fromDie.die_height_mm), h2 = num(toDie.die_height_mm);
  if (h1 == null || h2 == null) {
    // รู้แค่ "ต้องเปลี่ยนแม่พิมพ์" แต่ไม่รู้ว่าความสูงต่างกันเท่าไหร่
    return { min: base, state: 'unknown_height', sameDie, diffMm: null,
             missing: [h1 == null ? fromDie : null, h2 == null ? toDie : null].filter(Boolean) };
  }
  const diffMm = Math.abs(h1 - h2);
  return { min: base + stepAddMin(rule.height_steps, diffMm), state: 'ok', sameDie, diffMm };
}

/* ── เวลา setup รวมของ "ลำดับหนึ่ง" — ใช้เทียบว่าสลับลำดับแล้วประหยัดกี่นาที ────────────
   🔴 `totalMin: null` เมื่อยังไม่มีกฎ — จอต้องบอกว่าเทียบไม่ได้ ห้ามโชว์ 0 นาที
      `unknownCount` > 0 = ตัวเลขยังไม่รวมผลของความสูง (ต่ำกว่าจริง) ต้องเขียนกำกับ */
export function sequenceSetup(dies = [], rule = null) {
  let total = 0, unknownCount = 0, noRule = false;
  const steps = [];
  for (let i = 0; i < dies.length; i++) {
    const r = setupMinutes({ fromDie: i > 0 ? dies[i - 1] : null, toDie: dies[i], rule });
    steps.push(r);
    if (r.state === 'no_rule') noRule = true;
    else {
      if (r.state === 'unknown_height') unknownCount++;
      total += r.min || 0;
    }
  }
  return { totalMin: noRule ? null : total, steps, unknownCount, noRule, changeCount: steps.filter(s => s.state !== 'first' && s.state !== 'none' && !s.sameDie).length };
}

/* ── heuristic แรกของงานปั๊ม: เรียงตามความสูงแม่พิมพ์ (ขึ้นทางเดียว) ────────────────────
   ไม่ใช่ optimizer เต็มรูป — เป็น "ข้อเสนอ" ให้คนลากแก้ต่อ (ระบบเสนอ คนตัดสิน)
   ⚠️ ตัวที่ไม่รู้ความสูง **ต่อท้าย ไม่ใช่ตัดทิ้ง** (ห้ามทำให้งานหายจากแผนเพราะข้อมูลไม่ครบ) */
export function orderByDieHeight(dies = []) {
  const known = dies.filter(d => num(d?.die_height_mm) != null);
  const unknown = dies.filter(d => num(d?.die_height_mm) == null);
  known.sort((a, b) => num(a.die_height_mm) - num(b.die_height_mm));
  return [...known, ...unknown];
}

/* ── แม่พิมพ์ตัวนี้ขึ้นเครื่องนี้ได้ไหม ────────────────────────────────────────────────
   คืน { ok: true | false | null } — **null = ไม่รู้ (ข้อมูลไม่ครบ) ห้ามอ่านเป็น false** */
export function fitsPress(die, press) {
  const h = num(die?.die_height_mm);
  const lo = num(press?.shut_height_min_mm), hi = num(press?.shut_height_max_mm);
  if (h == null) return { ok: null, reason: 'ยังไม่ได้กรอกความสูงแม่พิมพ์' };
  if (lo == null && hi == null) return { ok: null, reason: 'ยังไม่ได้กรอกช่วง shut height ของเครื่อง' };
  if (lo != null && h < lo) return { ok: false, reason: `เตี้ยกว่าช่วงของเครื่อง (${h} < ${lo} มม.)` };
  if (hi != null && h > hi) return { ok: false, reason: `สูงกว่าช่วงของเครื่อง (${h} > ${hi} มม.)` };
  return { ok: true, reason: null };
}

/* ── ความพร้อมของข้อมูล — ให้จอบอกตรงๆ ว่ายังกรอกไม่ครบแค่ไหน (ห้ามเงียบ) ─────────── */
export function setupDataReadiness({ dies = [], presses = [], rules = [] } = {}) {
  const dieTotal = dies.length;
  const dieWithHeight = dies.filter(d => num(d?.die_height_mm) != null).length;
  const pressTotal = presses.length;
  const pressWithRange = presses.filter(p => num(p?.shut_height_min_mm) != null || num(p?.shut_height_max_mm) != null).length;
  const ruleCount = rules.filter(r => r && r.is_active !== false).length;
  return {
    dieTotal, dieWithHeight, dieMissing: dieTotal - dieWithHeight,
    pressTotal, pressWithRange, pressMissing: pressTotal - pressWithRange,
    ruleCount,
    /* พร้อมจัดลำดับจริงก็ต่อเมื่อ "มีกฎ" + "รู้ความสูงอย่างน้อย 2 ตัว" (ต่ำกว่านี้เทียบลำดับไม่ได้) */
    canPlan: ruleCount > 0 && dieWithHeight >= 2,
  };
}
