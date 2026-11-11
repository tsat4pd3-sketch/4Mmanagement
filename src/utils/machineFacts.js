/* 🏭 ข้อมูลจากเครื่อง (ศูนย์เชื่อมต่อ) — จัดถังตามกะของ ESM + รายการที่ต้องจับคู่ (2026-11-11 · OEE Line D3)
   📄 docs/modules/integration-hub.md §OEE Line D3 · docs/SCADA_REALTIME_DESIGN.md

   🔴 เฟส "เดินคู่": ตัวเลขชุดนี้ **ไม่ใช่ OEE และห้ามเอาไปเข้าสูตร** (`src/utils/oee.js` ยังเป็นเจ้าของสูตร)
      — ไฟล์นี้แค่ "วางข้อเท็จจริงจากเครื่องข้างที่คนลง" ให้เห็นว่าตรง/ไม่ตรงกันแค่ไหน
   🔴 ไม่รวมชิ้นข้ามเครื่องเป็นยอดไลน์ — เครื่องในไลน์อาจต่อกันเป็นสาย (ชิ้นเดียวผ่านหลายเครื่อง)
      หรือขนานกัน · ไฟล์นี้ไม่รู้ ⇒ คืนรายเครื่อง ห้ามเดา
   🔴 ไม่รู้ = null ไม่ใช่ 0 — นาทีที่ต้นทางไม่ส่งยอด ≠ "เครื่องทำได้ 0 ชิ้น"
   🔴 จับคู่ tag/เหตุผล: ระบบ "เสนอ" ได้เฉพาะตัวที่ตรงเป๊ะ · คนกดยืนยันเสมอ (เขียนผ่าน edge integration-admin)

   กะ = กรอบ ESM: เช้า 08:00–20:00 · ดึก 20:00–08:00 (วันทำงานตัด 08:00 — ตรรกะเดียวกับ getWorkDate())
   คิดจากเวลาไทยตรงๆ (UTC+7) ไม่พึ่ง timezone ของเครื่องที่เปิดจอ */
import { machineKey } from './machineNo.js';

const H = 3600000;
const BKK = 7 * H;

const ms = (v) => {
  if (v == null || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
const ymd = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

/** เวลา → กะของ ESM `{ workDate, shift, startMs, endMs }` · อ่านไม่ออก = null */
export function factShiftOf(v) {
  const t = ms(v);
  if (t == null) return null;
  const local = new Date(t + BKK);
  const h = local.getUTCHours();
  const shift = h >= 8 && h < 20 ? 'day' : 'night';
  const wd = new Date(t + BKK - 8 * H);                 // ก่อน 08:00 = วันทำงานก่อนหน้า
  const workDate = ymd(wd);
  const base = Date.UTC(wd.getUTCFullYear(), wd.getUTCMonth(), wd.getUTCDate()) - BKK;   // 00:00 ไทยของวันทำงาน
  const startMs = base + (shift === 'day' ? 8 : 20) * H;
  return { workDate, shift, startMs, endMs: startMs + 12 * H };
}

/** สถานะหยุด → ใช้ master เหตุผลชุดไหน (user ยืนยัน 11/11)
 *  หยุดตามแผน/ไม่มีแผน = OnplanMaster · FAULT = UnplanMaster · อื่นๆ = ยังไม่รู้ ⇒ null (ห้ามเดา) */
export function reasonKindOf(state) {
  if (state === 'planned_stop' || state === 'no_plan') return 'onplan';
  if (state === 'fault') return 'unplan';
  return null;
}

export const STATE_META = {
  fault:        { label: 'เสีย / ขัดข้อง', color: 'var(--red, #e5484d)' },
  idle:         { label: 'ว่าง (รอ)',      color: 'var(--yellow, #f5a524)' },
  planned_stop: { label: 'หยุดตามแผน',     color: 'var(--blue, #3b82f6)' },
  no_plan:      { label: 'ไม่มีแผนผลิต',   color: 'var(--text-dim, #888)' },
  comm_loss:    { label: 'ขาดการสื่อสาร',  color: 'var(--purple, #a855f7)' },
  other:        { label: 'อื่นๆ (ต้นทางส่งค่าที่ไม่รู้จัก)', color: 'var(--text-dim, #888)' },
};
export const STATE_ORDER = ['fault', 'idle', 'planned_stop', 'no_plan', 'comm_loss', 'other'];

/** tag → machine_id จากทะเบียนจับคู่ (เฉพาะที่ผูกแล้ว) */
export function tagIndex(tagMap = []) {
  const m = new Map();
  for (const r of tagMap || []) if (r?.tag && r?.machine_id) m.set(r.tag, r.machine_id);
  return m;
}

/** แบ่งช่วง [s,e) ตามกรอบกะ — ช่วงหยุดที่คร่อมกะถูกตัดเข้าแต่ละกะตามเวลาจริง */
function splitByShift(s, e) {
  const out = [];
  let cur = s;
  for (let guard = 0; cur < e && guard < 400; guard++) {
    const f = factShiftOf(cur);
    const end = Math.min(e, f.endMs);
    out.push({ ...f, sec: (end - cur) / 1000 });
    cur = end;
  }
  return out;
}

/**
 * รวมข้อเท็จจริงเป็นรายเครื่อง × วันทำงาน × กะ
 * @param {{ states?: object[], counters?: object[], tagMap?: object[] }} p
 *   states   = แถว machine_state_events · counters = แถว machine_counters หรือแถวรายชั่วโมงจาก RPC · tagMap = machine_tag_map
 * @returns {object[]} `{ key, tag, machineId|null, workDate, shift, pieces|null, ng|null, minutes, stopSec{}, minorSec, stops, firstAt, lastAt }`
 *   pieces/ng = null เมื่อกะนั้นไม่มีแถวนับชิ้นเลย (ไม่รู้ ≠ 0) · minutes = จำนวนนาทีที่มีแถวนับชิ้น
 */
export function summarizeMachineFacts({ states = [], counters = [], tagMap = [] } = {}) {
  const idx = tagIndex(tagMap);
  const rows = new Map();
  const get = (tag, f) => {
    const key = `${tag}|${f.workDate}|${f.shift}`;
    if (!rows.has(key)) {
      rows.set(key, {
        key, tag, machineId: idx.get(tag) ?? null, workDate: f.workDate, shift: f.shift,
        pieces: null, ng: null, minutes: 0,
        stopSec: Object.fromEntries(STATE_ORDER.map(s => [s, 0])), minorSec: 0, stops: 0,
        firstAt: null, lastAt: null,
      });
    }
    return rows.get(key);
  };
  const seen = (r, t) => {
    if (r.firstAt == null || t < r.firstAt) r.firstAt = t;
    if (r.lastAt == null || t > r.lastAt) r.lastAt = t;
  };

  // รับได้ทั้งแถวรายนาที (machine_counters) และแถวรายชั่วโมง (rpc fn_machine_counter_hourly: hour_at/qty/ng/minutes)
  // ถังชั่วโมงไม่คร่อมกะ (ขอบกะ 08:00/20:00 = ต้นชั่วโมง)
  for (const c of counters || []) {
    const t = ms(c?.counted_at ?? c?.hour_at);
    if (t == null || !c?.machine_tag) continue;
    const r = get(c.machine_tag, factShiftOf(t));
    r.pieces = (r.pieces ?? 0) + (Number(c.delta ?? c.qty) || 0);
    r.ng = (r.ng ?? 0) + (Number(c.ng_delta ?? c.ng) || 0);
    r.minutes += c.minutes != null ? Number(c.minutes) || 0 : 1;
    seen(r, t);
  }

  for (const s of states || []) {
    const st = ms(s?.started_at);
    if (st == null || !s?.machine_tag) continue;
    // ไม่มีเวลาจบ = ใช้ duration · ไม่มีทั้งคู่ = นับเป็น 1 ครั้งแต่ไม่รู้นาที (ไม่เดาความยาว)
    const en = ms(s.ended_at) ?? (Number.isFinite(Number(s.duration_sec)) && s.duration_sec != null ? st + Number(s.duration_sec) * 1000 : null);
    const state = STATE_META[s.state] ? s.state : 'other';
    const parts = en != null && en > st ? splitByShift(st, en) : [{ ...factShiftOf(st), sec: 0 }];
    parts.forEach((p, i) => {
      const r = get(s.machine_tag, p);
      r.stopSec[state] += p.sec;
      if (s.is_minor) r.minorSec += p.sec;
      if (i === 0) r.stops += 1;
      seen(r, i === 0 ? st : p.startMs);
    });
  }

  return [...rows.values()].sort((a, b) =>
    (a.workDate < b.workDate ? 1 : a.workDate > b.workDate ? -1 : 0)
    || (a.shift === b.shift ? 0 : a.shift === 'night' ? -1 : 1)
    || a.tag.localeCompare(b.tag));
}

/** เวลาหยุดรวมของกะ (วินาที) — ทั้งหมด / นอกแผน (fault+idle) / ตามแผน (planned_stop+no_plan) */
export function stopTotals(stopSec = {}) {
  const v = (k) => Number(stopSec[k]) || 0;
  return {
    all: STATE_ORDER.reduce((s, k) => s + v(k), 0),
    unplanned: v('fault') + v('idle'),
    planned: v('planned_stop') + v('no_plan'),
    unknown: v('comm_loss') + v('other'),
  };
}

/**
 * เหตุผลหยุดที่เห็นจากต้นทาง (สำหรับจอจับคู่) — 1 แถวต่อ (master, รหัส)
 * @returns `{ kind, code, text, count, sec, map|null }` · map = แถว machine_reason_map ที่ยืนยันแล้ว
 *   สถานะที่ยังไม่รู้ master (IDLE/COMM_LOSS) ไม่อยู่ในลิสต์นี้ — คืนจำนวนแยกใน `unmappable`
 */
export function reasonRows(states = [], reasonMap = []) {
  const mapped = new Map((reasonMap || []).map(r => [`${r.reason_kind}|${r.reason_code}`, r]));
  const out = new Map();
  let unmappable = 0;
  for (const s of states || []) {
    const kind = reasonKindOf(s?.state);
    if (!kind) { unmappable++; continue; }
    if (s.reason_code == null) continue;
    const key = `${kind}|${s.reason_code}`;
    if (!out.has(key)) out.set(key, { kind, code: Number(s.reason_code), text: null, count: 0, sec: 0, map: mapped.get(key) || null });
    const r = out.get(key);
    if (!r.text && s.reason_text) r.text = String(s.reason_text);
    r.count++;
    r.sec += Number(s.duration_sec) || 0;
  }
  // ที่เคยจับคู่ไว้แต่ช่วงนี้ไม่เห็น ยังต้องโชว์ (แก้/ลบได้)
  for (const [key, m] of mapped) if (!out.has(key)) out.set(key, { kind: m.reason_kind, code: m.reason_code, text: m.reason_text, count: 0, sec: 0, map: m });
  const rows = [...out.values()].sort((a, b) => (a.kind === b.kind ? a.code - b.code : a.kind === 'onplan' ? -1 : 1));
  return { rows, unmappable };
}

/** ข้อเสนอประเภท downtime — ตรงชื่อเป๊ะ (หลังตัดช่องว่าง/ตัวพิมพ์) เท่านั้น · ไม่เจอ/เจอหลายตัว = null (ห้ามเดา) */
export function suggestDowntimeType(text, types = []) {
  const n = (s) => String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, '');
  const k = n(text);
  if (!k) return null;
  const hit = (types || []).filter(t => t?.is_active !== false && n(t.name_th) === k);
  return hit.length === 1 ? hit[0] : null;
}

/** รหัสเครื่องที่เห็นจากต้นทาง + ข้อเสนอจากทะเบียน (machineKey ตรงเป๊ะ ตัวเดียว) */
export function tagRows({ states = [], counters = [], tagMap = [], machines = [] } = {}) {
  const tags = new Map();
  const touch = (tag, at) => {
    if (!tag) return;
    const t = ms(at);
    const cur = tags.get(tag) || { tag, lastAt: null };
    if (t != null && (cur.lastAt == null || t > cur.lastAt)) cur.lastAt = t;
    tags.set(tag, cur);
  };
  for (const s of states || []) touch(s?.machine_tag, s?.started_at);
  for (const c of counters || []) touch(c?.machine_tag, c?.counted_at ?? c?.hour_at);
  for (const m of tagMap || []) touch(m?.tag, null);
  const byTag = new Map((tagMap || []).map(r => [r.tag, r]));
  return [...tags.values()].map(r => {
    const map = byTag.get(r.tag) || null;
    const cands = (machines || []).filter(m => m?.machine_no && machineKey(m.machine_no) === machineKey(r.tag));
    return { ...r, map, suggest: !map?.machine_id && cands.length === 1 ? cands[0] : null };
  }).sort((a, b) => a.tag.localeCompare(b.tag));
}

/**
 * วางข้อเท็จจริงจากเครื่องข้าง Daily Report — 1 แถวต่อ ไลน์ × วันทำงาน × กะ
 * @param {object[]} factRows  ผลของ summarizeMachineFacts (เฉพาะแถวที่ผูกเครื่องแล้วถึงจะรู้ไลน์)
 * @param {{ machines: object[], sessions: object[], downtimes: object[] }} p
 *   machines  = [{ id, machine_no, line_name }] · sessions = production_sessions (id, work_date, shift, line_name, status, actual_qty)
 *   downtimes = downtime_logs (session_id, duration_min, machine_no)
 * @returns `{ key, line, workDate, shift, session|null, sessionCount, humanDtMin|null, humanLineDtMin|null, machines[] }`
 *   machines[] = factRow + `{ machineNo, humanDtMin }` — DT ที่คนลงด้วยเลขเครื่องนี้ (machineKey ตรงกัน)
 *   humanLineDtMin = DT ที่คนลงโดยไม่ระบุเครื่อง (ระดับไลน์) · session=null = ไม่มีใบผลิตกะนั้น (ไม่ใช่ 0)
 *   🔴 กะที่มีใบผลิตแต่เครื่องไม่ส่งอะไรเลย ก็ต้องโชว์ (machines ว่าง) — ช่องว่างฝั่งไหนก็ต้องเห็น
 */
export function compareWithSessions(factRows = [], { machines = [], sessions = [], downtimes = [] } = {}) {
  const mById = new Map((machines || []).map(m => [m.id, m]));
  const out = new Map();
  const get = (line, workDate, shift) => {
    const key = `${line}|${workDate}|${shift}`;
    if (!out.has(key)) out.set(key, { key, line, workDate, shift, session: null, sessionCount: 0, humanDtMin: null, humanLineDtMin: null, machines: [] });
    return out.get(key);
  };
  const lines = new Set();
  for (const f of factRows || []) {
    const m = f.machineId ? mById.get(f.machineId) : null;
    if (!m?.line_name) continue;
    lines.add(m.line_name);
    get(m.line_name, f.workDate, f.shift).machines.push({ ...f, machineNo: m.machine_no, humanDtMin: null });
  }
  const dtBySession = new Map();
  for (const d of downtimes || []) {
    if (!d?.session_id) continue;
    if (!dtBySession.has(d.session_id)) dtBySession.set(d.session_id, []);
    dtBySession.get(d.session_id).push(d);
  }
  for (const s of sessions || []) {
    if (!lines.has(s?.line_name)) continue;
    const row = get(s.line_name, s.work_date, s.shift);
    row.sessionCount += 1;
    // หลายใบในกะเดียว (เปิดซ้ำ) = รวมยอด แต่บอกจำนวนใบให้จอเขียน
    row.session = row.session
      ? { ...row.session, actual_qty: (Number(row.session.actual_qty) || 0) + (Number(s.actual_qty) || 0) }
      : { status: s.status, actual_qty: s.actual_qty };
    for (const d of dtBySession.get(s.id) || []) {
      const min = Number(d.duration_min) || 0;
      row.humanDtMin = (row.humanDtMin ?? 0) + min;
      const mk = d.machine_no ? machineKey(d.machine_no) : '';
      const hit = mk ? row.machines.find(x => machineKey(x.machineNo) === mk) : null;
      if (hit) hit.humanDtMin = (hit.humanDtMin ?? 0) + min;
      else if (!mk) row.humanLineDtMin = (row.humanLineDtMin ?? 0) + min;
    }
    if (row.session && row.humanDtMin == null) row.humanDtMin = 0;   // มีใบผลิต + ไม่มีแถว DT = คนลง 0 จริง
  }
  for (const r of out.values()) {
    r.machines.sort((a, b) => String(a.machineNo).localeCompare(String(b.machineNo)));
    if (r.session) for (const x of r.machines) if (x.humanDtMin == null) x.humanDtMin = 0;
  }
  return [...out.values()].sort((a, b) =>
    (a.workDate < b.workDate ? 1 : a.workDate > b.workDate ? -1 : 0)
    || (a.shift === b.shift ? 0 : a.shift === 'night' ? -1 : 1)
    || a.line.localeCompare(b.line));
}
