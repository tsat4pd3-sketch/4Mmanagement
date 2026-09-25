/* ═══════════════════════════════════════════════════════════════════════════
   📌 คิวงานของฉัน — "เปิดบัญชีตัวเองแล้วเห็นงานที่รออยู่"      2026-09-25 · คำสั่ง user

   *"เหมือน กดดูบัญชีตัวเองแล้วเห็นงานค้างที่รอเรา"*  +  *"ส่วนใหญ่จะเป็นรอแผนก"*

   ── ทำไมเป็น "ดึง" ไม่ใช่ "ยิง" ───────────────────────────────────────────────
   17/09 เคยลองเปิดผู้รับในแอปเพิ่ม 14 เรื่องแล้ว **ย้อนกลับ** (คำสั่ง user: ชะลอก่อน)
   เพราะห้องแชทกับกระดิ่งส่วนตัวไม่ใช่ช่องทางชนิดเดียวกัน — วัดจริง 25/09:
     กระดิ่ง **19,095 แถว/7 วัน** ถึง 92/94 บัญชี **อ่าน 7.3%**
     `mtn_checked` ใบเดียวเด้ง **31 คน** อ่าน **3%** · เรื่องใบซ่อมรวม = **74%** ของกระดิ่งทั้งระบบ
   ⇒ ไฟล์นี้คือฝั่งตรงข้าม: **ไม่ยิงอะไรเลย** คนเปิดดูเองเมื่ออยากรู้
     (ไม่มีแถวใหม่ · ไม่มี invocation ของ send-push · ไม่เพิ่ม egress ต่อเหตุการณ์)

   ── 🔴 บทเรียนที่ทำให้ไฟล์นี้แบ่ง 3 ชั้น (วัดจริง 25/09 ก่อนเขียน) ─────────────────
   สมมติฐานแรกคือ "ใบที่มีชื่อเราอยู่ = งานของเรา" — **ผิด**
     ใบซ่อมรอตรวจรับ 168 ใบ → ชื่อผู้ตรวจรับมีแค่ **10 ชื่อ · ส่วนงานเดียว**
     = คิวของแผนก ที่บังเอิญมีใครสักคนถูกพิมพ์ชื่อไว้ ไม่ใช่ภาระของคนนั้นคนเดียว
   ⇒ **"รอเรา" กับ "รอหน่วยงานเรา" ต้องแยกกันบนจอ** ความรู้สึกรับผิดชอบคนละระดับ
     และ **ตัวเลขบนไอคอนนับเฉพาะชั้นแรก** — ถ้านับรวมจะได้เลขหลักพัน (ใบขอซื้อค้าง 6,743
     รายการที่ระบบระเบิดความต้องการสร้างเอง) แล้ว**ไม่มีใครกดดูอีกเลย** = พังแบบเดียวกับกระดิ่ง

   ── ไฟล์นี้ pure ─────────────────────────────────────────────────────────────
   ห้าม import supabaseClient — ผู้เรียกโหลดแถวมาให้ แล้วที่นี่ตัดสินอย่างเดียว (เทสได้ตรงๆ)
   "ขั้นนี้รอใคร" อ่านจาก `stepMeta()` (mtnStepPerm.js) เท่านั้น — **ห้ามเขียน `step === 4`**
   (เลขขั้นคนละความหมายระหว่างฟอร์ม JIG/DIE กับ MTN — กฎเหล็กใน CLAUDE.md)
   ═══════════════════════════════════════════════════════════════════════════ */
import { personKey, normPersonName } from './actorStamp.js';
import { stepMeta } from './mtnStepPerm.js';
import { isMtnFormRow } from './mtnMoForm.js';

/** 3 ชั้นของคิว — ชื่อชั้นใช้ร่วมกับจอ ห้ามพิมพ์สตริงเองในหน้า */
export const TIER = { MINE: 'mine', UNIT: 'unit', FLOOR: 'floor' };

/** แสดงกี่รายการต่อชั้นก่อน "ดูทั้งหมด" — เกินนี้ต้องบอกว่าซ่อนไปกี่รายการ ห้ามตัดเงียบ */
export const CAP = { [TIER.MINE]: 8, [TIER.UNIT]: 6, [TIER.FLOOR]: 6 };

/** เกินกี่วัน = แก่จนต้องติดธง (ใบซ่อมรอตรวจรับค้างเฉลี่ย 9.3 วันตอนวัด 25/09) */
export const OLD_DAYS = 7;

const norm = (s) => String(s ?? '').trim().toLowerCase();

/** วันที่ห่างจากวันนี้ — รับ 'YYYY-MM-DD' หรือ ISO · ค่าที่อ่านไม่ออกคืน null (ไม่ใช่ 0) */
export function ageDays(dateLike, now = new Date()) {
  if (!dateLike) return null;
  const t = new Date(typeof dateLike === 'string' && dateLike.length === 10
    ? `${dateLike}T00:00:00` : dateLike);
  if (Number.isNaN(t.getTime())) return null;
  const d = Math.floor((now - t) / 86400000);
  return d < 0 ? 0 : d;
}

/**
 * คนคนนี้คือเราหรือเปล่า — **uid ชนะชื่อเสมอ**
 * ไม่มีทั้ง uid และชื่อ → `false` (ไม่รู้ ≠ ใช่ — ห้ามตีว่าเป็นของเรา)
 */
export function isMe({ uid, name }, me) {
  if (uid && me?.uid) return norm(uid) === norm(me.uid);
  const a = personKey(null, name);
  const b = personKey(null, me?.name);
  return !!a && a === b;
}

/**
 * ใบ MO ใบนี้กำลังรอใคร — คืน `{ step, meta, who, byName }`
 *   who    = { uid, name } ของคนที่ขั้นนี้รอ (รู้ตัวคน) · `null` = รอ "ตำแหน่ง" ไม่ใช่ตัวคน
 *   byName = true แปลว่าขั้นนี้ผูกกับตัวบุคคลจริง (ผู้เปิดใบ / ช่างที่รับงาน)
 *
 * 🔴 ไม่เดาเลขขั้นเอง — `stepMeta()` เป็นคนบอกว่าขั้นนี้ `byReporter` หรือ `stage === 'service'`
 */
export function moWaitingOn(o = {}) {
  const mtnForm = isMtnFormRow(o);
  const step = Number(o.current_step) || 0;
  const meta = stepMeta(step, { mtnForm });
  if (!meta) return { step, meta: null, who: null, byName: false };

  if (meta.byReporter) {
    return {
      step, meta, byName: true,
      who: {
        uid: o.reporter_prod_uid || o.reported_by_uid || null,
        name: o.reporter_prod || o.reported_by_name || null,
      },
    };
  }
  if (meta.stage === 'service') {
    return {
      step, meta, byName: true,
      who: { uid: o.tech_main_uid || null, name: o.assigned_to || o.tech_main || null },
    };
  }
  // ขั้นที่รอ "ตำแหน่ง" (จ่ายงาน / QA / หัวหน้าแผนก / ผจก.) — ไม่มีชื่อเจาะจง
  return { step, meta, who: null, byName: false };
}

/** ใบนี้อยู่ในขอบเขตของเราไหม — `sections: []` = ไม่จำกัด (เห็นทุกส่วนงาน) */
export function inMyScope(row, me) {
  const secs = Array.isArray(me?.sections) ? me.sections.filter(Boolean) : [];
  if (!secs.length) return true;                    // ไม่จำกัด
  const s = norm(row?.dept_section || row?.section);
  if (!s) return false;                             // ใบไม่ระบุส่วนงาน = ตอบไม่ได้ว่าของเรา
  return secs.some(x => norm(x) === s);
}

/* ── ตัวแปลงแถวดิบ → รายการบนจอ ─────────────────────────────────────────────
   ทุกตัวคืนรูปเดียวกัน: { key, icon, title, detail, age, tier, tag, to }
   `to` = ลิงก์ที่**พาไปถึงใบนั้นจริง** (ไม่ใช่หน้ารวม) — คนกดแล้วต้องทำงานต่อได้ทันที */

function moItem(o, w, tier) {
  const age = ageDays(o.work_date);
  return {
    key: `mo:${o.id}`,
    icon: w.meta?.icon || '🔧',
    title: `${o.mo_no || 'ใบซ่อม'} — ${w.meta?.title || `ขั้น ${w.step}`}`,
    detail: [o.line_name, o.machine_no].filter(Boolean).join(' · ') || o.dept_section || '',
    age, tier,
    tag: tier === TIER.MINE ? null : (w.meta?.whoShort || null),
    to: `/mtn-repair?mo=${encodeURIComponent(o.id)}`,   // MtnRepair อ่าน `?mo=` แล้วเปิด drawer ของใบนั้นให้
  };
}

/**
 * ประกอบคิวจากแถวที่ผู้เรียกโหลดมา
 *
 * @param {object} src  แถวดิบ — ขาดก้อนไหนให้ส่ง `undefined` **ห้ามส่ง []** (ดู `missing`)
 * @param {object} me   { uid, name, sections }
 * @returns {{ mine, unit, floor, counts, missing, partial }}
 *
 * 🔴 `missing` = ก้อนที่โหลดไม่สำเร็จ ⇒ `partial === true` ⇒ **จอต้องเขียนว่าตัวเลขไม่ครบ**
 *    (กฎ "ห้ามล้มเหลวเงียบ" — จอที่ขึ้น "ไม่มีงานค้าง" ทั้งที่คิวรีล่ม คือจอโกหก)
 */
export function buildQueue(src = {}, me = {}, now = new Date()) {
  const mine = []; const unit = []; const floor = [];
  const missing = [];
  const need = (k, v) => { if (v === undefined || v === null) { missing.push(k); return []; } return v; };

  // ── ใบซ่อม MO ────────────────────────────────────────────────────────────
  for (const o of need('mo', src.mo)) {
    const w = moWaitingOn(o);
    if (!w.meta) continue;                                  // ใบยังไม่เข้าลูป (ขั้น 1) — ไม่ใช่งานค้างของใคร
    if (w.byName && w.who && isMe(w.who, me)) { mine.push(moItem(o, w, TIER.MINE)); continue; }
    if (inMyScope(o, me)) unit.push(moItem(o, w, TIER.UNIT));
  }

  // ── กะที่ขอปิด รอหัวหน้าอนุมัติ ────────────────────────────────────────────
  for (const s of need('sessions', src.sessions)) {
    if (!inMyScope(s, me)) continue;
    unit.push({
      key: `ses:${s.id}`, icon: '📋', tier: TIER.UNIT,
      title: `คำขอปิดกะ — ${s.line_name || '-'}`,
      detail: s.shift === 'night' ? 'กะดึก' : 'กะเช้า',
      age: ageDays(s.work_date, now), tag: 'รอหัวหน้าอนุมัติ',
      to: `/daily-report?date=${s.work_date || ''}`,
    });
  }

  // ── 4M รออนุมัติ ─────────────────────────────────────────────────────────
  for (const f of need('fourM', src.fourM)) {
    if (!inMyScope(f, me)) continue;
    unit.push({
      key: `4m:${f.id}`, icon: '📝', tier: TIER.UNIT,
      title: `4M ${f.category || ''} — ${f.line_name || '-'}`.trim(),
      detail: String(f.description || '').slice(0, 48),
      age: ageDays(f.work_date, now),
      tag: f.status === 'pending_qa' ? 'รอ QA' : 'รอหัวหน้า',
      /* ลิงก์เดียวกับคิวงานค้างใน DeptDashboard — ใบค้างมักเก่ากว่าช่วง default 7 วัน จึงต้องส่ง from= ไปด้วย */
      to: `/report?tab=4&status=${encodeURIComponent(f.status || '')}&from=${f.work_date || ''}&focus=${f.id}`,
    });
  }

  // ── งานที่ถูกมอบหมายชื่อเราตรงๆ (ใบติดตามงานแก้ไข) ──────────────────────────
  for (const a of need('actions', src.actions)) {
    const it = {
      key: `act:${a.id}`, icon: '🎯',
      title: String(a.problem || 'งานติดตาม').slice(0, 48),
      detail: [a.line_name, a.section].filter(Boolean).join(' · '),
      age: ageDays(a.due_date || a.meeting_date, now),
      tag: a.status === 'doing' ? 'กำลังทำ' : 'ยังไม่เริ่ม',
      to: '/morning-meeting',
      tier: TIER.MINE,
    };
    if (isMe({ uid: a.assignee_uid, name: a.assignee }, me)) mine.push(it);
    else if (inMyScope(a, me)) unit.push({ ...it, tier: TIER.UNIT, tag: a.assignee || 'ยังไม่มีผู้รับผิดชอบ' });
  }

  // ── ชั้น 3: ของทั้งโรงงานที่ไม่มีเจ้าภาพ — **สรุปบรรทัดเดียว ห้ามแตกรายตัว** ──────
  //    ใบขอซื้อค้าง 6,743 รายการมาจากตัวระเบิดความต้องการ ไม่ใช่ "งานที่คนหนึ่งต้องทำทีละใบ"
  for (const s of (src.summaries || [])) {
    if (!s || !Number(s.count)) continue;
    floor.push({ key: `sum:${s.key}`, icon: s.icon || '📦', tier: TIER.FLOOR,
      title: s.title, detail: s.detail || '', count: Number(s.count), age: null, to: s.to });
  }

  const byAge = (a, b) => (b.age ?? -1) - (a.age ?? -1);      // เก่าสุดขึ้นก่อน · ไม่รู้อายุไปท้าย
  mine.sort(byAge); unit.sort(byAge);

  return {
    mine, unit, floor,
    counts: { mine: mine.length, unit: unit.length, floor: floor.reduce((n, f) => n + (f.count || 0), 0) },
    missing,
    partial: missing.length > 0,
  };
}

/**
 * ตัวเลขบนรูปโปรไฟล์ — **นับเฉพาะชั้น "รอเราจริงๆ"**
 * คืน 0 = **ไม่ต้องวาด badge เลย** (ไม่ใช่วาดวงกลมที่มีเลข 0)
 * ⚠️ โหลดไม่ครบ (`partial`) → คืน 0 เช่นกัน — ตัวเลขที่อาจผิดแย่กว่าไม่มีตัวเลข
 *    (รายการข้างในยังโชว์พร้อมคำเตือนว่าไม่ครบ)
 */
export function badgeCount(q) {
  if (!q || q.partial) return 0;
  return q.counts?.mine || 0;
}

/** ตัดรายการตาม CAP แล้วบอกว่าซ่อนไปกี่อัน — ห้ามตัดเงียบ */
export function capped(list, tier) {
  const cap = CAP[tier] ?? 6;
  const arr = Array.isArray(list) ? list : [];
  return { shown: arr.slice(0, cap), hidden: Math.max(0, arr.length - cap) };
}

/** ข้อความตอนไม่มีงาน — **ต้องโชว์เสมอ ห้ามซ่อนแผง**
 *  (กฎเดียวกับคิวงานค้างใน DeptDashboard: ผู้ใช้ต้องแยกออกว่า "เคลียร์หมด" ≠ "จอพัง") */
export const EMPTY_TEXT = {
  [TIER.MINE]: '✅ ไม่มีงานที่รอคุณอยู่',
  [TIER.UNIT]: '✅ ไม่มีงานค้างในหน่วยงานของคุณ',
  [TIER.FLOOR]: '',
};

export const TIER_TITLE = {
  [TIER.MINE]: '🙋 รอคุณโดยตรง',
  [TIER.UNIT]: '🏭 คิวของหน่วยงานคุณ',
  [TIER.FLOOR]: '🗂 ค้างทั้งโรงงาน (ยังไม่มีเจ้าภาพ)',
};

/** ชื่อคนแบบย่อสำหรับป้ายกำกับ — ใช้ตัวเทียบชุดเดียวกับทั้งระบบ */
export const shortName = (s) => normPersonName(s).split(' ')[0] || '';
