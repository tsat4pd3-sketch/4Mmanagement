/* ══ เวลาเปลี่ยนรุ่นงานปั๊ม (sequence-dependent setup time) ═══════════════════════════
   ที่มา (user 2026-09-24): "งานปั๊มมันจะวุ่นวายกว่าที่ผ่านมา มันมี setup time change over die
   มาเป็นตัวแปร ถ้า die height ต่างกันเกินมันมีผล เลยต้องมีการ drag จัดแผนเพื่อหา optimization"

   ตัวเลขจากช่างปั๊ม (user 2026-09-25): **"1mm = 1sec"** ⇒ ผลของความสูงเป็น **อัตราเชิงเส้น**
   (`per_mm_sec`) ไม่ใช่ขั้นบันได · `height_steps` คงไว้สำหรับเงื่อนไขแบบขั้นในอนาคต (บวกทับกันได้)

   แก่นของโจทย์: เวลา setup **ขึ้นกับลำดับ** — A→B กับ B→A ไม่เท่ากันก็ได้ และสลับลำดับ
   ให้ |Δ die height| น้อย = ปรับ shut height น้อย = ได้เวลาผลิตคืนมาโดยไม่ต้องลงทุนอะไร

   ⭐ **แยก "เวลาฐาน" ออกจาก "ส่วนที่ขึ้นกับลำดับ" (varMin) — 2026-09-25**
     เวลาฐาน (ยกแม่พิมพ์ลง-ขึ้น-จูน) **ยังไม่ได้ถามช่าง** ⇒ `base_min = null = ไม่รู้`
     แต่การตอบว่า "ลำดับไหนดีกว่า" **ทำได้ทันทีโดยไม่ต้องรู้เวลาฐาน** เพราะลำดับที่สลับกันบน
     แม่พิมพ์ชุดเดิมมี**จำนวนครั้งเปลี่ยนเท่ากัน** ⇒ เวลาฐานหักกลบหายไปจากผลต่าง
     ⇒ `totalMin` = null (ตอบเวลารวมไม่ได้) แต่ `varMin` = ตัวเลขจริงที่ใช้จัดลำดับได้

   🔴 กฎความซื่อสัตย์ (บังคับ — จอที่แนะนำจากตัวเลขที่เดาเอง อันตรายกว่าจอที่บอกว่าไม่รู้):
     · **ไม่มีกฎในทะเบียน = `min: null` + `state:'no_rule'` ห้ามคืน 0 และห้าม fallback เลขในโค้ด**
     · **ไม่รู้เวลาฐาน = `min: null` + `state:'no_base'`** (varMin ยังใช้ได้)
     · **ไม่รู้ die height ข้างใดข้างหนึ่ง = `state:'unknown_height'`** คืนได้แค่เวลาฐาน
       และจอต้องเขียนกำกับว่าตัวเลขนี้ยังไม่รวมผลของความสูง (= ต่ำกว่าจริง)
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

/* ── ผลของความสูง (นาที) — อัตราต่อมม. + ขั้นบันได (บวกทับกันได้) ────────────────────────
   คืน `null` เมื่อกฎไม่ได้บอกผลของความสูงไว้เลย (ทั้ง per_mm_sec และ height_steps ว่าง)
   = "ยังไม่รู้" ห้ามคืน 0 (0 จะทำให้ทุกลำดับเท่ากันหมด แล้วจอจะบอกว่า "เรียงใหม่ไม่ช่วย" แบบมั่ว) */
export function heightAddMin(rule, diffMm) {
  const perMm = num(rule?.per_mm_sec);
  const steps = Array.isArray(rule?.height_steps) ? rule.height_steps : [];
  if (perMm == null && steps.length === 0) return null;
  const d = Math.max(0, num(diffMm) ?? 0);
  return (perMm == null ? 0 : (perMm * d) / 60) + (steps.length ? stepAddMin(steps, d) : 0);
}

/* ── เวลาเปลี่ยนจากแม่พิมพ์ตัวหนึ่งไปอีกตัว ─────────────────────────────────────────────
   die = { id, die_height_mm } · ตัวแรกของกะ (fromDie = null) ถือว่าไม่มีการเปลี่ยน = 0
   คืน { min, baseMin, varMin, state, diffMm, sameDie }
     · `min`    = เวลารวม (null = ตอบไม่ได้ — ดู state)
     · `varMin` = ส่วนที่ขึ้นกับ "ลำดับ" (ผลของความสูง) — ใช้เทียบลำดับได้แม้ไม่รู้เวลาฐาน
     · `baseMin`= เวลาฐานของการเปลี่ยนครั้งนี้ (null = ยังไม่ได้ถามช่าง) */
export function setupMinutes({ fromDie = null, toDie = null, rule = null } = {}) {
  const zero = { min: 0, baseMin: 0, varMin: 0, diffMm: null, sameDie: false };
  if (!toDie)   return { ...zero, state: 'none' };
  if (!fromDie) return { ...zero, state: 'first' };   // ใบแรก — ไม่มีของเดิมให้ถอด
  const sameDie = fromDie.id != null && fromDie.id === toDie.id;

  if (!rule) {
    // ⚠️ ไม่มีกฎ = ตอบไม่ได้ ห้ามเดาเป็น 0 (0 จะทำให้แผนดูดีเกินจริงแล้วคนเชื่อ)
    return { min: null, baseMin: null, varMin: null, state: 'no_rule', sameDie, diffMm: null };
  }

  /* แม่พิมพ์ตัวเดิม เปลี่ยนแค่ล็อต — ไม่มีการปรับ shut height ⇒ varMin = 0 */
  if (sameDie) {
    const b = num(rule.same_die_min);
    return { min: b, baseMin: b, varMin: 0, state: b == null ? 'no_base' : 'same_die', sameDie, diffMm: 0 };
  }

  const base = num(rule.base_min);
  const h1 = num(fromDie.die_height_mm), h2 = num(toDie.die_height_mm);

  if (h1 == null || h2 == null) {
    // รู้แค่ "ต้องเปลี่ยนแม่พิมพ์" แต่ไม่รู้ว่าความสูงต่างกันเท่าไหร่ ⇒ ได้แค่เวลาฐาน (ต่ำกว่าจริง)
    return {
      min: base, baseMin: base, varMin: null, state: 'unknown_height', sameDie, diffMm: null,
      missing: [h1 == null ? fromDie : null, h2 == null ? toDie : null].filter(Boolean),
    };
  }

  const diffMm = Math.abs(h1 - h2);
  const varMin = heightAddMin(rule, diffMm);
  if (varMin == null) {
    // กฎมีอยู่ แต่ไม่ได้บอกผลของความสูงไว้ (ยังไม่กรอก per_mm_sec / ขั้นบันได)
    return { min: base, baseMin: base, varMin: null, state: 'no_height_rule', sameDie, diffMm };
  }
  return {
    min: base == null ? null : base + varMin,
    baseMin: base, varMin,
    state: base == null ? 'no_base' : 'ok',
    sameDie, diffMm,
  };
}

/* ── เวลา setup รวมของ "ลำดับหนึ่ง" — ใช้เทียบว่าสลับลำดับแล้วประหยัดกี่นาที ────────────
   🔴 `totalMin: null` เมื่อยังไม่มีกฎ หรือยังไม่รู้เวลาฐาน — จอต้องบอกว่าตอบเวลารวมไม่ได้
   ⭐ `varMin` = ส่วนที่ขึ้นกับลำดับ **ใช้เทียบลำดับได้แม้ totalMin เป็น null**
      `unknownCount` > 0 = ตัวเลขยังไม่รวมผลของความสูงบางช่วง (ต่ำกว่าจริง) ต้องเขียนกำกับ */
export function sequenceSetup(dies = [], rule = null) {
  let total = 0, varTotal = 0, unknownCount = 0;
  let noRule = false, baseUnknown = false, varUnknown = false;
  const steps = [];
  for (let i = 0; i < dies.length; i++) {
    const r = setupMinutes({ fromDie: i > 0 ? dies[i - 1] : null, toDie: dies[i], rule });
    steps.push(r);
    if (r.state === 'no_rule') { noRule = true; continue; }
    if (r.state === 'unknown_height' || r.state === 'no_height_rule') { unknownCount++; varUnknown = true; }
    if (r.baseMin == null) baseUnknown = true;
    total += r.min || 0;
    varTotal += r.varMin || 0;
  }
  return {
    totalMin: noRule || baseUnknown ? null : total,
    varMin: noRule || varUnknown ? null : varTotal,
    steps, unknownCount, noRule, baseUnknown,
    changeCount: steps.filter(s => s.state !== 'first' && s.state !== 'none' && !s.sameDie).length,
  };
}

/* ── heuristic แรกของงานปั๊ม: เรียงตามความสูงแม่พิมพ์ (ขึ้นทางเดียว) ────────────────────
   1mm = 1sec ⇒ เวลารวมของการไล่ความสูงทางเดียว = (สูงสุด − ต่ำสุด) วินาที ซึ่งเป็นค่าน้อยสุด
   ที่เป็นไปได้ของผลรวม |Δ| (อสมการสามเหลี่ยม) ⇒ heuristic นี้ **เหมาะที่สุด** สำหรับอัตราเชิงเส้น
   ⚠️ ถ้าวันหน้าใส่ขั้นบันได (height_steps) ด้วย จะไม่การันตีว่าดีที่สุดอีก — เป็น "ข้อเสนอ" ให้คนลากแก้
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

/* ── ความพร้อมของข้อมูล — ให้จอบอกตรงๆ ว่ายังกรอกไม่ครบแค่ไหน (ห้ามเงียบ) ─────────────
   🔴 `canPlan` ต้องดู "กฎที่บอกผลของความสูงได้" ไม่ใช่แค่ "มีกฎ" — กฎที่มีแต่เวลาฐาน
      จัดลำดับให้ไม่ได้เลย (ทุกลำดับเท่ากันหมด) */
export function setupDataReadiness({ dies = [], presses = [], rules = [] } = {}) {
  const dieTotal = dies.length;
  const dieWithHeight = dies.filter(d => num(d?.die_height_mm) != null).length;
  const pressTotal = presses.length;
  const pressWithRange = presses.filter(p => num(p?.shut_height_min_mm) != null || num(p?.shut_height_max_mm) != null).length;
  const act = rules.filter(r => r && r.is_active !== false);
  const ruleCount = act.length;
  const ruleWithHeight = act.filter(r => num(r.per_mm_sec) != null
    || (Array.isArray(r.height_steps) && r.height_steps.length > 0)).length;
  const ruleWithBase = act.filter(r => num(r.base_min) != null).length;
  return {
    dieTotal, dieWithHeight, dieMissing: dieTotal - dieWithHeight,
    pressTotal, pressWithRange, pressMissing: pressTotal - pressWithRange,
    ruleCount, ruleWithHeight, ruleWithBase,
    /* จัดลำดับได้เมื่อ "มีกฎที่บอกผลของความสูง" + "รู้ความสูงอย่างน้อย 2 ตัว" */
    canPlan: ruleWithHeight > 0 && dieWithHeight >= 2,
    /* ตอบ "เวลารวมกี่นาที" ได้ต่อเมื่อรู้เวลาฐานด้วย (คนละคำถามกับ canPlan) */
    canTotal: ruleWithHeight > 0 && ruleWithBase > 0,
  };
}
