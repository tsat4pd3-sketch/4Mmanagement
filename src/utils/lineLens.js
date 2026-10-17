/* ══════════════════════════════════════════════════════════════════════════
   🔎 lineLens — "แท็บที่เลือกบนผังรวม = เลนส์ที่ใช้มองไลน์" · pure ล้วน (2026-10-16)

   ที่มา (user 16/10 · คอมเมนต์จากผู้ใช้หน้างาน):
     · "hover ควรโชว์เรื่องที่เกี่ยวกับ tab ที่เอาเม้าส์ไปวาง ไม่ใช่โชว์ทั้งหมด
        จะโชว์ทั้งหมดก็คือ tab ปกติ/ผิดปกติ ที่รวมทุกเรื่อง"
     · "คลิกเข้าไปที่ไลน์ ก็ควรโชว์เรื่องที่เกี่ยวกับ tab ที่เลือก และโชว์คู่กับผังเลเอ้าท์
        tab PM ไม่ได้อยากดูคน อยากดูสถานะเครื่องจักร"
     · "สถานะ PM แล้ว / ใกล้ PM / หลุด PM ยังไม่ลิ้งไปที่แต่ละจุด — ตอนนี้เหมือนสถานะ breakdown
        ซึ่งน่าจะเป็นเรื่องของ tab downtime"

   ไฟล์นี้ตัดสิน 3 อย่าง (ใช้ที่ `pages/FactoryMap.jsx` + `components/LineLensMap.jsx`):
     ① `storySectionsFor(metric)` — กล่องรายละเอียดของไลน์แสดงหัวข้อไหนบ้าง
     ② `mapLensOf(metric)` — แท็บนี้มีผังเครื่องจักรคู่ไหม และระบายสีหมุดด้วยเรื่องอะไร
     ③ `markerFor(lens, …)` — สี/ป้ายของหมุดเครื่อง 1 ตัว
   🔴 PM กับ Downtime เป็นคนละคำถาม — หมุดแท็บ PM ตอบ "ถึงรอบ PM หรือยัง" (STATUS_META ของ lib/pmSchedule)
      หมุดแท็บ Downtime ตอบ "เครื่องหยุดไหม/หยุดไปกี่นาที" · ห้ามเอาสีของเรื่องหนึ่งไปทับอีกเรื่อง
   🔴 ไม่รู้ = เทา ไม่ใช่เขียว (เครื่องไม่มีแผน PM ≠ PM ตามกำหนด)
   ══════════════════════════════════════════════════════════════════════════ */
import { machineKey } from './machineNo.js';

/** หัวข้อของกล่องรายละเอียดไลน์ (key ตรงกับบล็อกใน FactoryMap story modal) */
export const STORY_SECTIONS = ['summary', 'shifts', 'parts', 'flow', 'dt', 'ng', 'fourm', 'pm', 'mo', 'people', 'energy', 'supply'];

const SECTIONS_BY_METRIC = {
  productivity: ['summary', 'shifts', 'parts', 'flow'],
  oee: ['summary', 'shifts', 'dt', 'ng'],
  breakdown: ['dt', 'mo'],
  ng: ['ng', 'shifts'],
  people: ['people', 'fourm'],
  pm: ['pm', 'mo'],
  am: ['pm'],
  energy: ['energy'],
  supply: ['supply'],
};

/** ชุดหัวข้อที่กล่องรายละเอียดแสดงสำหรับแท็บนี้ · health/ไม่รู้จัก = ทุกหัวข้อ */
export function storySectionsFor(metric) {
  return new Set(SECTIONS_BY_METRIC[metric] || STORY_SECTIONS);
}

/** แท็บนี้ต้องมีผังเครื่องจักรคู่ไหม → ชื่อเลนส์ของหมุด หรือ null (ไม่มีผัง — เรื่องนี้ไม่ได้ผูกกับตัวเครื่อง) */
export function mapLensOf(metric) {
  /* 👷 คน = ผังจุดงาน + คนประจำจุด · 📦 ยอดผลิต = บอร์ด Heijunka ของไลน์ (ไม่ใช่ผัง — user 16/10) */
  if (metric === 'pm' || metric === 'am' || metric === 'breakdown' || metric === 'people' || metric === 'productivity') return metric;
  if (metric === 'health') return 'health';
  return null;
}

export const LENS_LABEL = {
  pm: 'สถานะ PM เครื่องจักร (ช่าง)',
  am: 'สถานะ AM (ผลิตตรวจเอง)',
  breakdown: 'เครื่องหยุดวันนี้',
  health: 'ปกติ/ผิดปกติ (เครื่องหยุด + PM)',
  people: 'จุดงาน + คนประจำจุด',
  productivity: 'Heijunka ของไลน์',
};

/* 👷 สีจุดงาน — ตอบ "จุดนี้มีคนที่ทำได้ยืนอยู่ไหม" · ตัดสินจากคนที่มาแล้วตัวที่อ่อนที่สุด */
export const STATION_META = {
  empty: { label: 'ว่าง (ไม่มีคนมา)', color: '#ef4444' },
  low: { label: 'ทักษะไม่ถึง (<50%)', color: '#f97316' },
  partial: { label: 'ทักษะผ่านบางข้อ', color: '#f59e0b' },
  fit: { label: 'ทักษะผ่านครบ', color: '#22c55e' },
  no_req: { label: 'มีคน · จุดยังไม่ตั้งทักษะ', color: '#3b82f6' },
  not_checked: { label: 'ยังไม่เช็คชื่อ', color: '#6b7280' },   // = NO_DATA_COLOR (ประกาศทีหลัง)
  no_one: { label: 'ยังไม่กำหนดคนประจำ', color: '#374151' },
};

/**
 * สถานะจุดงาน 1 จุดจากคนที่ประจำ ({ is_present: true|false|null, fit: {score}|null })
 * 🔴 ไม่ตั้งทักษะ = `no_req` (ไม่ใช่ "ผ่าน") · ยังไม่เช็คชื่อ (null) ≠ ขาด (false)
 */
export function stationMarker(people = []) {
  const list = Array.isArray(people) ? people : [];
  if (!list.length) return { state: 'no_one', ...STATION_META.no_one };
  const present = list.filter(p => p.is_present === true);
  if (!present.length) {
    const st = list.some(p => p.is_present === false) ? 'empty' : 'not_checked';
    return { state: st, ...STATION_META[st] };
  }
  const scores = present.map(p => p.fit?.score).filter(v => v != null);
  if (!scores.length) return { state: 'no_req', ...STATION_META.no_req };
  const worst = Math.min(...scores);
  const st = worst >= 100 ? 'fit' : worst >= 50 ? 'partial' : 'low';
  return { state: st, ...STATION_META[st], worst };
}

export const DT_COLOR = { open: '#ef4444', had: '#f59e0b', none: '#22c55e' };
export const NO_DATA_COLOR = '#6b7280';

/** downtime นอกแผนของวัน → Map(machineKey → { mins, open, count }) */
export function dtByMachine(rows = []) {
  const m = new Map();
  for (const d of Array.isArray(rows) ? rows : []) {
    const k = machineKey(d?.machine);
    if (!k) continue;
    const g = m.get(k) || { mins: 0, open: false, count: 0 };
    g.mins += Number(d.mins) || 0;
    g.open = g.open || !!d.open;
    g.count += 1;
    m.set(k, g);
  }
  return m;
}

/** ใบ DT นอกแผนที่ไม่มีเลขเครื่อง = วางบนผังไม่ได้ → จอต้องบอกจำนวน */
export const dtWithoutMachine = (rows = []) => (Array.isArray(rows) ? rows : []).filter(d => !machineKey(d?.machine)).length;

function worstOf(statuses, statusMeta) {
  let best = null;
  for (const s of statuses) if (!best || (statusMeta[s]?.order ?? 9) < (statusMeta[best]?.order ?? 9)) best = s;
  return best;
}

/**
 * สี/ป้ายหมุดเครื่อง 1 ตัวตามเลนส์
 * @param {'pm'|'am'|'breakdown'|'health'} lens
 * @param {{ checklists?:{am:boolean,status:string}[], dt?:{mins:number,open:boolean}|null, statusMeta:object }} p
 * @returns {{ color:string, state:string, sub:string, alwaysLabel:boolean, blink:boolean }}
 */
export function markerFor(lens, { checklists = [], dt = null, statusMeta = {} } = {}) {
  const pmPart = (am) => {
    const rel = checklists.filter(c => !!c.am === am);
    if (!rel.length) return { color: NO_DATA_COLOR, state: 'no_plan', sub: am ? 'ไม่มีแผน AM' : 'ไม่มีแผน PM', alwaysLabel: false, blink: false };
    const w = worstOf(rel.map(c => c.status), statusMeta);
    return { color: statusMeta[w]?.color || NO_DATA_COLOR, state: w || 'unknown', sub: statusMeta[w]?.label || 'ไม่ทราบ', alwaysLabel: w === 'overdue', blink: false };
  };
  const dtPart = () => {
    if (dt?.open) return { color: DT_COLOR.open, state: 'open', sub: `หยุดอยู่ · ${dt.mins} น.`, alwaysLabel: true, blink: true };
    if (dt?.mins > 0) return { color: DT_COLOR.had, state: 'had', sub: `หยุดวันนี้ ${dt.mins} น.`, alwaysLabel: true, blink: false };
    return { color: DT_COLOR.none, state: 'none', sub: 'ไม่มีหยุดนอกแผน', alwaysLabel: false, blink: false };
  };
  if (lens === 'pm') return pmPart(false);
  if (lens === 'am') return pmPart(true);
  if (lens === 'breakdown') return dtPart();
  // health: เครื่องหยุดอยู่ > PM เกินกำหนด > หยุดวันนี้ > PM ใกล้ครบ > ปกติ
  const d = dtPart(); const p = pmPart(false);
  if (d.state === 'open') return d;
  if (p.state === 'overdue') return p;
  if (d.state === 'had') return d;
  if (p.state === 'due_soon') return p;
  return { color: DT_COLOR.none, state: 'ok', sub: p.state === 'no_plan' ? 'ไม่หยุด · ไม่มีแผน PM' : 'ปกติ', alwaysLabel: false, blink: false };
}
