/* 🔌 สร้างไฟล์ flow ของ Node-RED ให้ต้นทาง import ได้ทันที (ศูนย์เชื่อมต่อ · 2026-11-11)
   📄 docs/modules/integration-hub.md

   แม่แบบแต่ละชนิด = flow ที่ทดสอบแล้วว่ารันได้จริงที่ Node-RED Die Shop (09–10/11)
   ⚠️ แม่แบบ energy_* เขียนสำหรับ Node-RED ระบบ "TSS Smart Energy" (ตาราง MySQL energy_sec /
      energy_event / energy_day + global ecLimits จากโหนด SMART ENERGY HUB) — ต้นทางที่ schema ต่าง
      ต้องแก้ SQL ในโหนด function เอง (flow เขียนบอกไว้ในโหนด comment)
   ⚠️ แม่แบบ machine_state / piece_count เขียนสำหรับ Node-RED OEE ของ PD2 (db_user02: oee_stop · oee_piece ·
      OnplanMaster · UnplanMaster) — ส่ง "ข้อเท็จจริง" อย่างเดียว ไม่ส่งเลข OEE ที่ต้นทางคิด
   🔴 ห้ามใส่รหัสลับลงไฟล์ — โหนดอ่านจาก env ของ Node-RED (`ESM_SOURCE_KEY` หรือ `INGEST_SECRET` ของต้นทาง legacy)
   🔴 ชนิด 'planned' (ยังไม่มีปลายทางรับใน ESM) ไม่สร้างโหนด แต่คืนรายชื่อใน `skipped` ให้จอเขียนบอก */
import { kindOf } from './integrationKinds.js';

const SAFE = (s) => String(s || '').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'src';

/** header ที่ทุกโหนด http ใช้ — legacy ที่ยังไม่มีรหัสของตัวเอง = secret กลาง · ที่เหลือ = รหัสต่อต้นทาง */
export function authHeaderCode(source) {
  const useLegacy = !!source?.legacy_secret && !source?.key_hint;
  return useLegacy
    ? `'x-ingest-secret': env.get('INGEST_SECRET'), 'x-source': '${SAFE(source?.code)}'`
    : `'x-source-key': env.get('ESM_SOURCE_KEY')`;
}
export const envVarName = (source) => (source?.legacy_secret && !source?.key_hint ? 'INGEST_SECRET' : 'ESM_SOURCE_KEY');

/**
 * @param {object} p
 * @param {{code:string,name:string,legacy_secret?:boolean,key_hint?:string|null}} p.source
 * @param {string[]} p.kinds   ชนิดที่จะสร้าง (คีย์จาก integrationKinds.js)
 * @param {string} p.ingestUrl URL ของ edge ingest-energy
 * @returns {{ nodes: object[], built: string[], skipped: {key:string, reason:string}[] }}
 */
export function buildNodeRedFlow({ source, kinds = [], ingestUrl }) {
  const code = SAFE(source?.code);
  const P = `esm_${code}_`;
  const hdr = `msg.headers = { 'content-type': 'application/json', ${authHeaderCode(source)} };`;
  const nodes = [];
  const built = [];
  const skipped = [];
  let row = 0;
  const want = new Set(kinds);

  for (const k of kinds) {
    const def = kindOf(k);
    if (!def) skipped.push({ key: k, reason: 'ไม่รู้จักชนิดนี้' });
    else if (def.status !== 'live') skipped.push({ key: k, reason: 'ESM ยังไม่มีปลายทางรับ (planned)' });
  }

  /** 1 แถวของ flow: comment → inject → SQL → mysql → แปลง → http → debug */
  const block = (tag, title, inject, sqlFunc, mysqlName, mapFunc, debugName) => {
    const y = 60 + row * 140; row++;
    const id = (n) => `${P}${tag}${n}`;
    nodes.push(
      { id: id(0), type: 'comment', name: title, info: '', x: 300, y: y - 40, wires: [] },
      { id: id(1), type: 'inject', name: inject.name, props: [], repeat: inject.repeat || '', crontab: inject.crontab || '',
        once: !!inject.once, onceDelay: inject.onceDelay || '', topic: '', x: 140, y, wires: [[id(2)]] },
      { id: id(2), type: 'function', name: sqlFunc.name, func: sqlFunc.code, outputs: 1, x: 340, y, wires: [[id(3)]] },
      { id: id(3), type: 'mysql', mydb: '', name: mysqlName, x: 540, y, wires: [[id(4)]] },
      { id: id(4), type: 'function', name: mapFunc.name, func: mapFunc.code, outputs: 1, x: 740, y, wires: [[id(5)]] },
      { id: id(5), type: 'http request', name: 'POST → ESM', method: 'POST', ret: 'obj', paytoqs: 'ignore', url: ingestUrl,
        tls: '', persist: false, proxy: '', authType: '', x: 940, y, wires: [[id(6)]] },
      { id: id(6), type: 'debug', name: debugName, active: true, complete: 'payload', targetType: 'msg', x: 1130, y, wires: [] },
    );
  };

  const limitsLine = want.has('energy_limits')
    ? `\n// ลิมิตจากโหนด SMART ENERGY HUB (global ecLimits) — แก้ที่ HUB ที่เดียว ESM ตามเอง\nconst lim = global.get('ecLimits');\nif (Array.isArray(lim) && lim.length) msg.payload.limits = lim;`
    : '';

  if (want.has('energy_readings')) {
    built.push('energy_readings'); if (want.has('energy_limits')) built.push('energy_limits');
    block('r', `ESM: ค่าไฟทุก 1 นาที (energy_sec → ${code})`, { name: 'ทุก 1 นาที', repeat: '60', once: true, onceDelay: '5' },
      { name: 'SQL สรุป 1 นาทีล่าสุด', code:
`msg.topic = \`
SELECT machine,
       COUNT(*) AS n,
       MAX(power) AS w_max,
       SUBSTRING_INDEX(GROUP_CONCAT(energy ORDER BY log_time DESC), ',', 1) AS kwh_last,
       AVG((voltageA + voltageB + voltageC) / 3) AS v_avg,
       MAX(GREATEST(currentA, currentB, currentC)) AS a_max
FROM energy_sec
WHERE log_time >= NOW() - INTERVAL 60 SECOND
GROUP BY machine\`;
return msg;` },
      'energy_sec (เลือก DB เดิม)',
      { name: 'แปลงเป็น readings', code:
`// ผลสรุป 1 นาที → readings · topic = ${code}/<ตู้>/<ค่า> ต้องตรงกับที่ผูกไว้ใน ESM
const rows = Array.isArray(msg.payload) ? msg.payload : [];
const readings = [];
for (const r of rows) {
  if (!r || !r.n || !r.machine) continue;
  const m = String(r.machine).trim();
  const add = (f, v) => {
    if (v === null || v === undefined || v === '') return;   // ไม่รู้ = ไม่ส่ง (ห้ามกลายเป็น 0)
    const x = Number(v);
    if (Number.isFinite(x)) readings.push({ topic: \`${code}/\${m}/\${f}\`, last: x });
  };
  add('kw', r.w_max === null || r.w_max === undefined ? null : Number(r.w_max) / 1000); // W → kW
  add('kwh_total', r.kwh_last);
  add('v', r.v_avg);
  add('a', r.a_max);
}
if (!readings.length) { node.warn('energy_sec ไม่มีข้อมูลใน 1 นาทีล่าสุด — ไม่ส่ง'); return null; }
${hdr}
msg.payload = { bucket_at: new Date().toISOString(), readings };${limitsLine}
return msg;` },
      'ผลส่งค่าไฟ');
  } else if (want.has('energy_limits')) {
    built.push('energy_limits');
    const y = 60 + row * 140; row++;
    const id = (n) => `${P}l${n}`;
    nodes.push(
      { id: id(0), type: 'comment', name: 'ESM: ลิมิตตู้ไฟทุก 1 นาที (global ecLimits)', info: '', x: 300, y: y - 40, wires: [] },
      { id: id(1), type: 'inject', name: 'ทุก 1 นาที', props: [], repeat: '60', crontab: '', once: true, onceDelay: '10', topic: '', x: 140, y, wires: [[id(2)]] },
      { id: id(2), type: 'function', name: '→ limits', outputs: 1, x: 340, y, wires: [[id(3)]], func:
`const lim = global.get('ecLimits');
if (!Array.isArray(lim) || !lim.length) { node.warn('ยังไม่มี global ecLimits — ไม่ส่ง'); return null; }
${hdr}
msg.payload = { limits: lim };
return msg;` },
      { id: id(3), type: 'http request', name: 'POST → ESM', method: 'POST', ret: 'obj', paytoqs: 'ignore', url: ingestUrl,
        tls: '', persist: false, proxy: '', authType: '', x: 540, y, wires: [[id(4)]] },
      { id: id(4), type: 'debug', name: 'ผลส่งลิมิต', active: true, complete: 'payload', targetType: 'msg', x: 730, y, wires: [] },
    );
  }

  if (want.has('energy_events')) {
    built.push('energy_events');
    block('e', 'ESM: เหตุการณ์ทุก 1 นาที (ส่ง 3 นาทีล่าสุด · ซ้ำ = ข้าม)', { name: 'ทุก 1 นาที', repeat: '60', once: true, onceDelay: '20' },
      { name: 'SQL เหตุการณ์ 3 นาที', code:
`msg.topic = \`
SELECT id,
       DATE_FORMAT(ev_time, '%Y-%m-%d %H:%i:%s') AS ev_time,
       machine, level, code, kind, message, value, duration_s
FROM energy_event
WHERE ev_time >= NOW() - INTERVAL 3 MINUTE
ORDER BY id
LIMIT 1000\`;
return msg;` },
      'energy_event (เลือก DB เดิม)',
      { name: '→ events', code:
`const rows = Array.isArray(msg.payload) ? msg.payload : [];
if (!rows.length) return null;   // ไม่มีเหตุการณ์ = ไม่ส่ง
${hdr}
msg.payload = { events: rows };
return msg;` },
      'ผลส่งเหตุการณ์');
  }

  if (want.has('energy_daily')) {
    built.push('energy_daily');
    block('d', 'ESM: ยอดรายวันย้อนหลัง (ทุกวัน 00:20 / กดเอง)', { name: 'ทุกวัน 00:20 / กดเอง', crontab: '20 00 * * *' },
      { name: 'SQL ยอดรายวัน', code:
`msg.topic = \`
SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, machine, emin, emax, n, pmax,
       DATE_FORMAT(pmax_at, '%Y-%m-%d %H:%i:%s') AS pmax_at
FROM energy_day
WHERE day >= DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01')
  AND day < CURDATE()
ORDER BY day, machine\`;
return msg;` },
      'energy_day (เลือก DB เดิม)',
      { name: '→ daily', code:
`const rows = Array.isArray(msg.payload) ? msg.payload : [];
if (!rows.length) { node.warn('energy_day ไม่มีแถวในช่วงนี้ — ไม่ส่ง'); return null; }
${hdr}
msg.payload = { daily: rows };
return msg;` },
      'ผลส่งยอดรายวัน');
  }

  if (want.has('machine_state')) {
    built.push('machine_state');
    // เหตุผล: หยุดตามแผน (PLANNED_STOP/NO_PLAN) อ่านจาก OnplanMaster · FAULT อ่านจาก UnplanMaster (ยืนยันโดย user 11/11)
    //         สถานะอื่น (IDLE/COMM_LOSS) ยังไม่รู้ว่าใช้ master ไหน ⇒ ส่งรหัสดิบ ไม่ส่งชื่อ (ห้ามเดา)
    block('s', 'ESM: ช่วงหยุดของเครื่องทุก 1 นาที (oee_stop · ส่ง 5 นาทีล่าสุด · ซ้ำ = ทับ)', { name: 'ทุก 1 นาที', repeat: '60', once: true, onceDelay: '15' },
      { name: 'SQL ช่วงหยุด 5 นาที', code:
`msg.topic = \`
SELECT s.machine_id AS machine,
       DATE_FORMAT(s.start_ts, '%Y-%m-%d %H:%i:%s') AS start,
       DATE_FORMAT(s.end_ts, '%Y-%m-%d %H:%i:%s') AS end,
       s.duration_sec, s.state, s.reason_code, s.is_minor,
       CASE WHEN s.state IN ('PLANNED_STOP', 'NO_PLAN') THEN o.Description
            WHEN s.state = 'FAULT' THEN u.Description
            ELSE NULL END AS reason_text
FROM oee_stop s
LEFT JOIN OnplanMaster o ON o.OnplanCode = s.reason_code
LEFT JOIN UnplanMaster u ON u.UnplanCode = s.reason_code
WHERE s.end_ts >= NOW() - INTERVAL 5 MINUTE
ORDER BY s.start_ts
LIMIT 2000\`;
return msg;` },
      'oee_stop (เลือก DB db_user02)',
      { name: '→ states', code:
`const rows = Array.isArray(msg.payload) ? msg.payload : [];
if (!rows.length) return null;   // ไม่มีช่วงหยุดที่จบใน 5 นาที = ไม่ส่ง
${hdr}
msg.payload = { states: rows };
return msg;` },
      'ผลส่งช่วงหยุด');
  }

  if (want.has('piece_count')) {
    built.push('piece_count');
    block('p', 'ESM: ชิ้นต่อนาทีทุก 1 นาที (oee_piece · ส่ง 5 นาทีล่าสุด · นาทีเดิม = ทับด้วยยอดที่ครบกว่า)', { name: 'ทุก 1 นาที', repeat: '60', once: true, onceDelay: '25' },
      { name: 'SQL ชิ้นรายนาที', code:
`// หน้าต่างเริ่มที่ "ต้นนาที" เสมอ ⇒ ทุกนาทีที่ส่งเป็นยอดเต็มนาที (นาทีปัจจุบันจะถูกส่งทับอีกรอบตอนครบ)
msg.topic = \`
SELECT machine_id AS machine,
       DATE_FORMAT(piece_ts, '%Y-%m-%d %H:%i:00') AS minute,
       SUM(qty) AS qty,
       SUM(ng_qty) AS ng
FROM oee_piece
WHERE piece_ts >= DATE_FORMAT(NOW() - INTERVAL 5 MINUTE, '%Y-%m-%d %H:%i:00')
GROUP BY machine_id, DATE_FORMAT(piece_ts, '%Y-%m-%d %H:%i:00')
ORDER BY minute\`;
return msg;` },
      'oee_piece (เลือก DB db_user02)',
      { name: '→ pieces', code:
`const rows = Array.isArray(msg.payload) ? msg.payload : [];
if (!rows.length) return null;   // ไม่มีชิ้นใน 5 นาที = ไม่ส่ง (ESM เห็นเป็น "ไม่มีข้อมูลนาทีนั้น" ไม่ใช่ 0)
${hdr}
msg.payload = { pieces: rows };
return msg;` },
      'ผลส่งนับชิ้น');
  }

  if (nodes.length) {
    nodes.unshift({ id: `${P}hd`, type: 'comment', x: 300, y: 10, wires: [],
      name: `ESM ← ${source?.name || code} (สร้างจากศูนย์เชื่อมต่อ)`,
      info: `ต้นทาง: ${code}\nตั้ง env ของ Node-RED ชื่อ ${envVarName(source)} ก่อน Deploy\nโหนด mysql: เปิดแล้วเลือก DB ของเครื่องนี้\nแม่แบบค่าไฟ = schema TSS Smart Energy (energy_sec/energy_event/energy_day) · แม่แบบเครื่องจักร = Node-RED OEE PD2 (oee_stop/oee_piece) — schema อื่นแก้ SQL ในโหนด function` });
  }
  return { nodes, built, skipped };
}
