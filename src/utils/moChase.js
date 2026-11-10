/* ═══════════════════════════════════════════════════════════════════════════
   🏃 "ใบค้างนี้ต้องไปไล่ใคร" — แผงไล่งานของหัวหน้าช่าง · pure (2026-11-05 · คำสั่ง user)

   ที่มา: แผง `MoStalePanel` (13/10) ตอบได้ว่า **ค้างกี่ใบ · ค้างที่ขั้นไหน · ทีมไหน · เก่าสุดกี่วัน**
   แต่หัวหน้าช่างที่เปิดมาเพื่อ "ไล่งาน" ยังตอบคำถามถัดไปไม่ได้: **ใบกองนี้รอ *ใคร* ลงมือ**
   ⇒ เห็น "ค้าง 106 ใบ" แล้วเหมือนเป็นงานของทีมช่างทั้งกอง ทั้งที่ครึ่งหนึ่งเลื่อนขั้นเองไม่ได้

   วัดจริง 05/11 (DR `mtn_orders` · ใบยังไม่ปิดที่ไม่ขยับ ≥ 7 วัน 77 ใบ):
     · **รอฝั่งช่างเรา ~36 ใบ** — ยังไม่มีช่างกดรับ 33 (`pending` 20 + `assigned` 13) · กำลังซ่อม 3
     · **รอฝ่ายที่แจ้ง ~36 ใบ** — ตรวจรับงานหลังซ่อม 33 (production 30 · die 2 · jig 1) + รับมอบ/ปิดใบ
     · ที่เหลือ = รอ QA · ตีกลับ/ส่งซ่อมนอก
   ⇒ **~47% ของกองค้าง หัวหน้าช่างเลื่อนให้เองไม่ได้** ต้องโทรตามอีกฝ่าย — ข้อมูลนี้ไม่มีจอไหนบอก
     (ก่อนหน้านี้แผงบอกแค่ชื่อขั้น ซึ่งคนต้องรู้เองว่าขั้นไหนเป็นของฝั่งใคร)

   ─── 🔴 กฎที่ไฟล์นี้ยึด ───────────────────────────────────────────────────────
   1. **"ฝั่งไหน" ถาม `moWaitMeta(order).meta.side` เท่านั้น** — ห้ามเทียบเลขขั้น/ชื่อ stage เองที่นี่
      (เลขขั้นคนละความหมาย 2 ฟอร์ม · ขั้น 4 ของทีมเครื่องมือเป็น **ฝั่งช่าง** ส่วนทีม production
       เป็นฝั่งผู้แจ้ง — ทะเบียนตอบให้แล้ว เขียนเองที่นี่ = อีกชุดที่ drift)
   2. **"ค้างกี่วัน" ใช้ `stageAgeOf` ของ `mtnStale.js`** — ห้ามนับวันซ้ำที่นี่ (2 สูตร = 2 จอคนละเลข)
   3. 🔴 **ใบเดียวนับได้ที่เดียว** — ใบที่มีช่าง 2 คน **ยุบเป็นเป้าเดียว** (ชุดช่างที่รับงานร่วมกัน)
      แตกรายคน = ใบเดียวไปโผล่ 2 แถว = ยอดรวมของแผงมากกว่าใบที่มีจริง (จอโกหก)
   4. 🔴 **ชี้เป้าไม่ได้ ต้องเป็นถังที่เห็น ไม่ใช่หาย** — ไม่รู้ฝั่ง (`unknown`) · ไม่มีชื่อ/หน่วยให้ตาม
      (`no_target`) · นับวันไม่ได้ (`unknown` ของ board) ⇒ ต้องให้จอเขียนบอกทุกตัว
   5. **ไม่ยิงคิวรี** — รับ `orders` ที่หน้าโหลดไว้แล้ว (egress 0) · `tech_main`/`tech_secondary`
      **ไม่ได้อยู่ใน `MO_LIST_COLS`** (กฎ egress ของหน้า MO) ⇒ ฝั่งช่างชี้ด้วย `assigned_techs`/
      `assigned_to` (ช่างที่กดรับงาน) เท่านั้น — **ห้ามเติม 2 คอลัมน์นั้นเข้าคิวรีรายการเพื่อแผงนี้**
   6. **รับ `now` เป็นพารามิเตอร์** (เทสรอบ "นาฬิกา +400 วัน")
   7. **สีคืนเป็น tone** ('warn'/'bad'/'none') ให้จอแปลงผ่าน `statusTone.js` ห้ามคืน hex
   ═══════════════════════════════════════════════════════════════════════════ */
import { isMoOpen, moWaitMeta, MO_STATUS_LABEL } from './mtnStepPerm.js';
import { assignedTechsOf, joinTechs } from './mtnPurchase.js';
import { STALE_DAYS, STALE_HARD_DAYS, stageAgeOf, staleTone } from './mtnStale.js';

/** ฝั่งที่ต้องลงมือ — เรียงตาม "ของเราก่อน" (หัวหน้าช่างเปิดมาเพื่อไล่ของตัวเองเป็นอย่างแรก) */
export const CHASE_SIDES = Object.freeze([
  { key: 'mtn', icon: '🔧', label: 'รอฝั่งช่างเรา',
    hint: 'อยู่ในมือทีมช่าง — ไล่ได้เลย (รับงาน · ลงมือซ่อม · หัวหน้า/ผจก.ช่างเซ็น)' },
  { key: 'pr', icon: '🛒', label: 'รอลูปจัดซื้อ (PR)',
    hint: 'ใบนี้มีใบขอซื้อค้างอยู่ — ผจก.ฝ่ายที่แจ้งอนุมัติปิดใบได้ต่อเมื่อลูป PR จบ (รับของ/ยกเลิก) ไปตามจัดซื้อ ไม่ใช่ไปตาม ผจก.' },
  { key: 'reporter', icon: '🏭', label: 'รอฝ่ายที่แจ้ง',
    hint: 'ช่างทำส่วนของตัวเองจบแล้ว — ต้องไปตามอีกฝ่าย เราเลื่อนขั้นให้เองไม่ได้' },
  { key: 'qa', icon: '🧪', label: 'รอ QA',
    hint: 'รอ QA ตรวจคุณภาพหลังซ่อม (ใบ JIG/DIE) — ถ้างานไม่เกี่ยวคุณภาพ กดข้าม QA ได้' },
  { key: 'outside', icon: '↩️', label: 'นอกลูปขั้น',
    hint: 'ตีกลับให้ผู้แจ้งแก้ / ส่งของซ่อมภายนอก — นาฬิกาไม่ได้อยู่กับขั้นในระบบ' },
  { key: 'unknown', icon: '❓', label: 'ระบบตัดสินไม่ได้',
    hint: 'ใบไม่มีขั้นถัดไปที่อ่านได้ (สถานะแปลก/ข้อมูลไม่ครบ) — ต้องเปิดดูทีละใบ' },
]);
const SIDE_META = Object.fromEntries(CHASE_SIDES.map(s => [s.key, s]));
export const chaseSideMeta = (key) => SIDE_META[key] || SIDE_META.unknown;

/**
 * ใบนี้รอ "ฝั่งไหน" ลงมือ — `'mtn' | 'reporter' | 'qa' | 'outside' | 'unknown'`
 * 🔴 ฝั่งมาจาก `meta.side` ของทะเบียนขั้น · ขั้น QA ไม่มี `side` (ไม่ใช่ทั้งช่างและผู้แจ้ง) ⇒ แยกถังเอง
 * 🔴 `stage` เป็น null โดยเจตนาสำหรับใบตีกลับ/ส่งซ่อมนอก (กฎข้อ 6 ของ mtnStale) ⇒ `outside` ไม่ใช่ unknown
 */
/* 🛒 ขั้น "ผจก.ฝ่ายที่แจ้งอนุมัติปิดใบ" ของทั้ง 2 ฟอร์ม
      JIG/DIE/PD ขั้น 7 = `close` · ทีม MTN ขั้น 8 = `cost_mgr_close` (ดู mtnStepPerm.js) */
const CLOSE_STAGES = Object.freeze(['close', 'cost_mgr_close']);
/** ใบขอซื้อที่ "ยังไม่จบลูป" — ยังไม่รับของและยังไม่ยกเลิก */
export const openPrRows = (prs) => (Array.isArray(prs) ? prs : [])
  .filter(p => p && p.status !== 'received' && p.status !== 'cancelled');

/**
 * ใบนี้รอ "ฝั่งไหน" ลงมือ — `'mtn' | 'pr' | 'reporter' | 'qa' | 'outside' | 'unknown'`
 * 🔴 ฝั่งมาจาก `meta.side` ของทะเบียนขั้น · ขั้น QA ไม่มี `side` ⇒ แยกถังเอง
 * 🔴 `stage` เป็น null โดยเจตนาสำหรับใบตีกลับ/ส่งซ่อมนอก ⇒ `outside` ไม่ใช่ unknown
 * 🛒 **มี PR ค้าง + อยู่ขั้นปิดใบ = รอลูปจัดซื้อ ไม่ใช่รอ ผจก.** (10/11 · คำสั่ง user
 *    "ผจก.ฝ่ายแจ้งจะอนุมัติได้ก็ต่อเมื่อ loop pr จบ") — ไปตาม ผจก. ตอนที่ของยังไม่มา
 *    คือไล่ผิดคน · ไม่ส่ง `prs` มา = พฤติกรรมเดิมเป๊ะ (ไม่รู้ = ไม่เดา)
 */
export function chaseSideOf(order = {}, { prs = null } = {}) {
  if (!isMoOpen(order)) return null;
  const { stage, meta } = moWaitMeta(order);
  if (!stage) return 'outside';
  if (prs && CLOSE_STAGES.includes(stage) && openPrRows(prs).length) return 'pr';
  if (stage === 'qa') return 'qa';
  if (meta?.side === 'mtn' || meta?.side === 'reporter') return meta.side;
  return 'unknown';
}

/** ชื่อหน่วยที่ต้องไปตามฝั่งผู้แจ้ง — ไลน์ก่อน (ชี้เป้าแคบสุด) ถอยไปชื่อผู้แจ้ง */
const reporterUnitOf = (o) => String(o?.line_name || '').trim()
  || String(o?.reporter_prod || '').trim()
  || String(o?.reported_by_name || '').trim();

/**
 * "ไปตามใคร" ของใบนี้ — `{ key, label, kind, whoShort, stage, team, line, text }`
 *   `kind`: `'unassigned'` ยังไม่มีช่างรับ · `'tech'` ช่างที่รับงานไว้ · `'role'` ตำแหน่งที่ต้องเซ็น
 *           `'unit'` หน่วยงานฝั่งผู้แจ้ง · `'status'` ใบนอกลูปขั้น · `'no_target'` ชี้เป้าไม่ได้
 * 🔴 ใบเดียว = เป้าเดียว (กฎข้อ 3) — ช่างหลายคนยุบเป็นชุดเดียว ไม่แตกรายคน
 *
 * `line`/`text`/`stage`/`team` = **"กดแล้วให้กรองอะไร"** — จอเอาไปเรียกตัวกรองของหน้าแม่ได้ตรงๆ
 *   ⇒ จอไม่ต้องรู้กฎขั้น และ **ไม่ต้องสร้างตัวกรองชุดที่ 2** (UI-STANDARD: ตัวกรองมีชุดเดียวบนแถบ)
 *   🔴 `text` ใช้ได้เพราะช่องค้นหาของหน้า MO ครอบ `assigned_to` — ถอดออกจากช่องค้นหา = ชิปช่างกดแล้วไม่ได้ผล
 * @param teamName ตัวแปลงคีย์ทีม → ชื่อทีม (ค่าใน DB เป็น key · ห้ามโชว์ key ดิบ)
 */
export function chaseTargetOf(order = {}, { teamName = (k) => k, teamOf = (o) => String(o?.mtn_dept || '').trim(), prs = null } = {}) {
  const side = chaseSideOf(order, { prs });
  const { stage, meta } = moWaitMeta(order);
  const whoShort = meta?.whoShort || '';
  const team = teamOf(order) || '';
  const teamTxt = team ? (teamName(team) || team) : '(ไม่ระบุทีม)';

  /* 🛒 รอลูปจัดซื้อ — แยก 2 กอง เพราะคนที่ต้องไปตาม **คนละคน**
       ยังไม่มีเลข PR = รอแอดมินช่างคีย์เข้า SAP · มีเลขแล้ว = รอของจากจัดซื้อ/ผู้ขาย */
  if (side === 'pr') {
    const open = openPrRows(prs);
    const noNo = open.filter(p => !String(p?.pr_no || '').trim()).length;
    return noNo > 0
      ? { key: 'pr:no_no', kind: 'pr', whoShort: 'แอดมินช่าง', stage, team,
          label: `ยังไม่ได้ลงเลข PR (${noNo} ใบขอซื้อ) · ${teamTxt}` }
      : { key: 'pr:waiting', kind: 'pr', whoShort: 'จัดซื้อ', stage, team,
          label: `รอของตามใบขอซื้อ ${open.map(p => p.pr_no).filter(Boolean).join(', ')}` };
  }

  if (side === 'mtn') {
    /* ยังไม่มีใครกดรับ = งานของคนจ่ายงาน (หัวหน้าช่างของทีมนั้น) — จับกลุ่มตามทีม */
    if (stage === 'assign') {
      return { key: `assign:${team}`, kind: 'unassigned', whoShort, stage, team,
        label: `ยังไม่มีช่างรับงาน · ${teamTxt}` };
    }
    /* กำลังซ่อม = ไปถามช่างที่กดรับไว้ · ไม่มีชื่อ = ชี้เป้าไม่ได้ ต้องเห็นว่ามีกี่ใบ */
    if (stage === 'service') {
      const techs = assignedTechsOf(order);
      if (!techs.length) {
        return { key: `no_tech:${team}`, kind: 'no_target', whoShort, stage, team,
          label: `กำลังซ่อม แต่ใบไม่มีชื่อช่าง · ${teamTxt}` };
      }
      const names = joinTechs(techs);
      return { key: `tech:${names}`, kind: 'tech', whoShort, stage, team, text: techs[0], label: names };
    }
    /* ขั้นเซ็นฝั่งช่าง (ขั้น 4 ของทีมเครื่องมือ · หัวหน้าแผนกช่าง · ผจก.ช่าง) — ตามที่ตำแหน่งในทีมนั้น */
    return { key: `role:${stage}:${team}`, kind: 'role', whoShort, stage, team,
      label: `${whoShort || 'ฝั่งช่าง'} · ${teamTxt}` };
  }

  if (side === 'reporter') {
    const unit = reporterUnitOf(order);
    if (!unit) {
      return { key: 'no_unit', kind: 'no_target', whoShort, stage,
        label: 'รอฝ่ายที่แจ้ง แต่ใบไม่มีไลน์/ชื่อผู้แจ้ง' };
    }
    /* ไลน์ = กรองด้วยตัวกรองไลน์ (กางครอบครัวไลน์ให้เอง) · ชื่อคน = ช่องค้นหา */
    const isLine = !!String(order?.line_name || '').trim();
    return { key: `unit:${unit}`, kind: 'unit', whoShort, stage,
      ...(isLine ? { line: unit } : { text: unit }), label: unit };
  }

  if (side === 'qa') return { key: 'qa', kind: 'role', whoShort: whoShort || 'QA', stage, label: 'QA' };

  if (side === 'outside') {
    const st = String(order?.status || '').trim();
    return { key: `status:${st || 'unknown'}`, kind: 'status', whoShort,
      label: MO_STATUS_LABEL[st] || st || 'ไม่รู้สถานะ' };
  }
  return { key: 'unknown', kind: 'no_target', whoShort, label: 'ไม่รู้ว่ารอใคร' };
}

/**
 * แผงไล่งาน — "ใบค้างเกินเกณฑ์ แยกตามฝั่งที่ต้องลงมือ แล้วแยกย่อยว่าไปตามใคร"
 *
 * ⚠️ ผู้เรียกต้องกรอง **ขอบเขตของผู้ใช้** มาก่อน แต่ **ห้ามกรองช่วงวันที่/สถานะ** — ใบค้างคือใบเก่า
 *    โดยนิยาม (กฎเดียวกับ `buildMoStaleBoard`)
 *
 * @returns {{ days, hardDays, open, stale, unknownAge, sides: Array }}
 *   · `sides[].targets[]` = `{ key, label, kind, whoShort, n, hard, oldest, tone, rows }`
 *   · `unknownAge` = ใบที่นับวันไม่ได้ (ไม่เข้าแผงเลย) — **จอต้องเขียนบอก** ห้ามกลืน
 */
export function buildMoChaseBoard(orders, {
  now = Date.now(), days = STALE_DAYS, hardDays = STALE_HARD_DAYS,
  teamOf = (o) => String(o?.mtn_dept || '').trim(), teamName = (k) => k,
  /* 🛒 ใบขอซื้อของใบ MO นี้ — ไม่ส่ง = พฤติกรรมเดิมเป๊ะ (ไม่มีฝั่ง 'pr') */
  prOf = null,
} = {}) {
  const open = (Array.isArray(orders) ? orders : []).filter(o => o && isMoOpen(o));
  const bySide = new Map();
  let stale = 0, unknownAge = 0;

  for (const o of open) {
    const age = stageAgeOf(o, now);
    if (age.days == null) { unknownAge += 1; continue; }   // นับวันไม่ได้ = ไม่รู้ว่าเกินเกณฑ์ไหม
    if (age.days < days) continue;
    stale += 1;

    const prs = prOf ? prOf(o) : null;
    const side = chaseSideOf(o, { prs }) || 'unknown';
    const target = chaseTargetOf(o, { teamName, teamOf, prs });
    const hard = age.days >= hardDays;

    if (!bySide.has(side)) bySide.set(side, { side, meta: chaseSideMeta(side), n: 0, hard: 0, oldest: null, _t: new Map() });
    const s = bySide.get(side);
    s.n += 1;
    if (hard) s.hard += 1;
    if (s.oldest == null || age.days > s.oldest) s.oldest = age.days;

    if (!s._t.has(target.key)) {
      s._t.set(target.key, { ...target, n: 0, hard: 0, oldest: null, rows: [] });
    }
    const t = s._t.get(target.key);
    t.n += 1;
    if (hard) t.hard += 1;
    if (t.oldest == null || age.days > t.oldest) t.oldest = age.days;
    t.rows.push({ ...o, _stale: age, _tone: staleTone(age.days, { days, hardDays }) });
  }

  /* เรียงฝั่งตามทะเบียน (ของเราก่อน) · ในแต่ละฝั่งเรียง "ค้างนานสุดก่อน" แล้วค่อยจำนวนใบ
     🔴 ไล่งานต้องเริ่มจากใบที่ดองนานสุด ไม่ใช่กองที่ใบเยอะสุด */
  const byOldest = (a, b) => (b.oldest - a.oldest) || (b.n - a.n) || String(a.label).localeCompare(String(b.label));
  const sides = CHASE_SIDES
    .map(m => bySide.get(m.key))
    .filter(Boolean)
    .map(s => ({
      side: s.side, meta: s.meta, n: s.n, hard: s.hard, oldest: s.oldest,
      tone: staleTone(s.oldest, { days, hardDays }),
      targets: [...s._t.values()]
        .map(t => ({ ...t, tone: staleTone(t.oldest, { days, hardDays }), rows: t.rows.sort((a, b) => b._stale.days - a._stale.days) }))
        .sort(byOldest),
    }));

  return { days, hardDays, open: open.length, stale, unknownAge, sides };
}
