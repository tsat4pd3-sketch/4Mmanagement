/* ══ 💬 askBot — ตัวอ่านคำถาม + สูตรรวมผลของแชท "ถามข้อมูลในระบบ" (2026-11-19 · คำสั่ง user) ══
   ขั้นแรก **ยังไม่มี AI**: จับคำ (keyword) → เลือก "เครื่องมือ" → เครื่องมือเรียกสูตรกลางชุดเดิม
   ตอนได้งบ = เปลี่ยนเฉพาะ `parseQuestion()` เป็น AI · ชั้นเครื่องมือ (`lib/askBotQuery.js`) ใช้ต่อได้ทั้งหมด

   🔴 กติกาที่ห้ามแหก
   · **ไม่เข้าใจ = ไม่เดา** — คืน `intent: null` ให้จอเสนอรูปแบบที่ถามได้ · ชื่อตรงหลายตัว = ให้คนเลือก
   · **ห้ามมีสูตรชุดที่ 2** — OEE ถ่วงด้วย `wavg`+`wLoad/wRun/wProd` (เหมือนกราฟ 10 วันของ /oee-analytics) ·
     downtime จัดแท่งด้วย `dtBucketName()` · ยอดผลิตต่อใบ = `orderProducedQty()` · ยุบชั้น OP ด้วย `collapseOps()`
   · **ยอดผลิต = "ชิ้น"** ห้ามยุบคู่ RH/LH (กฎ "ชิ้น ≠ shot") — ยุบเฉพาะชั้น OP (ขั้นตอนของชิ้นเดียวกัน)
   · ไฟล์นี้ **pure** (ห้าม import supabase) — เทสด้วย `node --test` ตรงๆ · วันที่รับ `today` จากผู้เรียกเสมอ
   📄 docs/modules/askbot.md */
import { wavg, wLoad, wRun, wProd, orderProducedQty, dtMinBySession, dtPlannedSplit, dtRawMin, defectQtyAll, sumSuspectPending } from './oee.js';
import { dtTypeName } from './downtimeCategory.js';
import { isVague } from './unclassified.js';
import { OPEN_MO_STATUSES, MO_STATUS_LABEL } from './mtnStepPerm.js';
import { buildScheduleMaps, resolveAssignedShift } from './shiftAssign.js';
import { addDaysStr } from './workDate.js';
import { dtBucketName, buildDtIndex, dtTrashStats } from './downtimeCategory.js';
import { collapseOps } from './pairTotals.js';
import { partCoreOf } from './partGroup.js';
import { weekMonday } from './timeRange.js';
import { tr } from './i18n.js';

/* ── 1) ช่วงเวลา ─────────────────────────────────────────────────────────── */
/* 🔴 ไม่รับตัวย่อแบบไม่มีจุด ("มค" "กค") — เป็นข้อความย่อยของคำทั่วไปได้ ("ซ่อมค้าง" มี "มค")
   เจอจริงตอนลองถาม 19/11: "ใบแจ้งซ่อมค้างกี่ใบ" ถูกอ่านเป็นเดือน ม.ค. */
const TH_MONTHS = [
  ['มกราคม', 'ม.ค.'], ['กุมภาพันธ์', 'ก.พ.'], ['มีนาคม', 'มี.ค.'],
  ['เมษายน', 'เม.ย.'], ['พฤษภาคม', 'พ.ค.'], ['มิถุนายน', 'มิ.ย.'],
  ['กรกฎาคม', 'ก.ค.'], ['สิงหาคม', 'ส.ค.'], ['กันยายน', 'ก.ย.'],
  ['ตุลาคม', 'ต.ค.'], ['พฤศจิกายน', 'พ.ย.'], ['ธันวาคม', 'ธ.ค.'],
];
export const MONTH_LABEL = TH_MONTHS.map(m => m[1]);

const pad2 = (n) => String(n).padStart(2, '0');
const lastDayOf = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m = 1..12
const addDay = (s, n) => addDaysStr(s, n);

function monthRange(y, m, today) {
  const from = `${y}-${pad2(m)}-01`;
  const end = `${y}-${pad2(m)}-${pad2(lastDayOf(y, m))}`;
  if (from > today) return { from, to: end, future: true };
  return { from, to: end < today ? end : today };
}

/**
 * อ่านช่วงเวลาจากข้อความ — คืน `{ from, to, label, explicit }` หรือ `{ error }`
 * ไม่พบคำบอกช่วง = `null` (ผู้เรียกใช้ค่าตั้งต้นของคำถามนั้น แล้ว**ต้องเขียนบอก**ว่าใช้ค่าไหน)
 * 🔴 "เดือน 10" ไม่ระบุปี = ปีของ `today` · ยังมาไม่ถึง = `error` (ห้ามเดาว่าหมายถึงปีที่แล้ว)
 */
export function periodFromText(text, today) {
  const t = String(text || '').toLowerCase();
  const y0 = +today.slice(0, 4), m0 = +today.slice(5, 7);
  if (/วันนี้|today/.test(t)) return { from: today, to: today, label: `วันนี้ (${today})`, explicit: true };
  if (/เมื่อวาน|yesterday/.test(t)) { const d = addDay(today, -1); return { from: d, to: d, label: `เมื่อวาน (${d})`, explicit: true }; }
  if (/(สัปดาห์|อาทิตย์)นี้|this ?week/.test(t)) return { from: weekMonday(today), to: today, label: `สัปดาห์นี้ (${weekMonday(today)} – ${today})`, explicit: true };
  if (/(สัปดาห์|อาทิตย์)(ที่แล้ว|ก่อน)|last ?week/.test(t)) {
    const mon = addDay(weekMonday(today), -7);
    return { from: mon, to: addDay(mon, 6), label: `สัปดาห์ที่แล้ว (${mon} – ${addDay(mon, 6)})`, explicit: true };
  }
  if (/เดือนนี้|this ?month/.test(t)) return { ...monthRange(y0, m0, today), label: `เดือนนี้ (${MONTH_LABEL[m0 - 1]} ${y0})`, explicit: true };
  if (/เดือน(ที่แล้ว|ก่อน)|last ?month/.test(t)) {
    const y = m0 === 1 ? y0 - 1 : y0, m = m0 === 1 ? 12 : m0 - 1;
    return { ...monthRange(y, m, today), label: `เดือนที่แล้ว (${MONTH_LABEL[m - 1]} ${y})`, explicit: true };
  }

  /* เดือนระบุ — "เดือน 10" · "เดือน 10/2026" · "ต.ค." · "ตุลาคม 2569" */
  let m = null, yTxt = null;
  const num = t.match(/เดือน\s*(\d{1,2})(?:\s*[/-]\s*(\d{4}))?/);
  if (num) { m = +num[1]; yTxt = num[2] || null; }
  if (m == null) {
    for (let i = 0; i < 12 && m == null; i++) {
      for (const w of TH_MONTHS[i]) {
        const idx = t.indexOf(w);
        if (idx >= 0) { m = i + 1; const after = t.slice(idx + w.length).match(/^\s*(\d{4})/); yTxt = after ? after[1] : null; break; }
      }
    }
  }
  if (m == null) return null;
  if (m < 1 || m > 12) return { error: `ไม่มีเดือนที่ ${m}` };
  let y = yTxt ? +yTxt : y0;
  if (y > 2400) y -= 543;                       // พ.ศ. → ค.ศ.
  const r = monthRange(y, m, today);
  if (r.future) return { error: `${MONTH_LABEL[m - 1]} ${y} ยังมาไม่ถึง — ถ้าหมายถึงปีอื่น พิมพ์ปีต่อท้าย เช่น "เดือน ${m}/${y - 1}"` };
  return { from: r.from, to: r.to, label: `${MONTH_LABEL[m - 1]} ${y}${yTxt ? '' : ' (ไม่ได้ระบุปี = ปีนี้)'}`, explicit: true };
}

/* ── 2) จับเจตนา ─────────────────────────────────────────────────────────── */
/* ลำดับสำคัญ: OEE → downtime → ยอดผลิต ("oee ผลิต" = ถาม OEE ไม่ใช่ยอด) */
export const INTENTS = [
  /* "ต่ำสุด" มาก่อน "oee" เฉยๆ · "ตอนนี้" มาก่อน "downtime สูงสุด" — ลำดับคือความหมาย ห้ามสลับ */
  { key: 'oee_lowest', re: /(oee|โออีอี|ประสิทธิภาพ|เปอร์เซ็นต์เครื่อง).*(ต่ำ|แย่|น้อย)(สุด|ที่สุด)|(ต่ำ|แย่|น้อย)(สุด|ที่สุด).*(oee|โออีอี|ประสิทธิภาพ|เปอร์เซ็นต์เครื่อง)|lowest|worst/, defaultPeriod: 'today', needSubject: null },
  { key: 'oee', re: /oee|โออีอี|ประสิทธิภาพ|เปอร์เซ็นต์เครื่อง/, defaultPeriod: 'today', needSubject: 'line' },
  { key: 'down_now', re: /((down\s*time|ดาว(น์)?\s*ไทม์|หยุด|เครื่องเสีย|เครื่องพัง|ดาวน์).*(ตอนนี้|ขณะนี้|อยู่ไหม|อยู่มั้ย|อยู่บ้าง|now))|((ตอนนี้|ขณะนี้|now).*(down\s*time|ดาว(น์)?\s*ไทม์|หยุด|เครื่องเสีย|เครื่องพัง|ดาวน์))|(ไลน์|เครื่อง)ไหน(หยุด|ดาวน์|เสีย|พัง)/, defaultPeriod: null, needSubject: null },
  { key: 'downtime_top', re: /down\s*time|ดาว(น์)?\s*ไทม์|เครื่องหยุด|หยุดเครื่อง|เครื่องเสีย|เครื่องพัง|หยุดนาน|สาเหตุ(ที่)?หยุด/, defaultPeriod: 'week', needSubject: null },
  { key: 'mo_open', re: /(^|[^a-z])mo([^a-z]|$)|แจ้งซ่อม|ใบซ่อม|งานซ่อม|รอช่าง|ช่างยังไม่มา/, defaultPeriod: null, needSubject: null },
  { key: 'fourm_pending', re: /4\s*m|โฟร์เอ็ม|changing\s*point/, defaultPeriod: null, needSubject: null },
  /* 🧾 "ใบสแครป" = ใบรายงานของเสีย FM-PD2-002 (`/scrap-report`) — ต้องมาก่อน defect_top ("ใบรายงานของเสีย" มีคำว่า ของเสีย) */
  { key: 'scrap_report', re: /ใบ\s*(สแครป|scrap)|scrap\s*report|ใบ\s*รายงาน\s*ของเสีย/, defaultPeriod: 'month', needSubject: null },
  /* "งานเสีย" = คำที่หน้างานพิมพ์จริง (user ทัก 19/11: "วันนี้มีงานเสียอะไรบ้าง" ตอบไม่ได้) */
  { key: 'defect_top', re: /ของเสีย|งานเสีย|ชิ้นงานเสีย|เสียอะไร|ของไม่ผ่าน|งานไม่ผ่าน|สแครป|defect|reject|scrap|(^|[^a-z])ng([^a-z]|$)/, defaultPeriod: 'week', needSubject: null },
  { key: 'attendance', re: /มาทำงาน|เช็คชื่อ|ขาดงาน|คนขาด|มากี่คน|คนมา|ใครลา|กำลังคน|คนครบ|attendance/, defaultPeriod: 'today', needSubject: null },
  /* "ยอด" เดี่ยวๆ = ยอดผลิต แต่ "ยอดขาย" ไม่ใช่ (ยังไม่มีเครื่องมือ ⇒ ต้องตอบว่าไม่เข้าใจ) */
  { key: 'production', re: /ยอดผลิต|ผลิต|กี่ชิ้น|ทำได้(กี่|เท่า)|ยอด(?!ขาย)|output|production/, defaultPeriod: 'month', needSubject: 'any' },
];

/* คำที่ไม่ใช่ชื่อไลน์/พาร์ท — ตัดทิ้งก่อนเอาส่วนที่เหลือไปค้นชื่อ
   🔴 ภาษาไทยไม่มีเว้นวรรค ("ขอยอดผลิตงาน apron…") ⇒ ฝั่งไทยต้องตัดแบบ "ข้อความย่อย"
      แต่ฝั่งอังกฤษ/ตัวเลขตัดแบบ **ทั้งคำเท่านั้น** — ชื่อไลน์/พาร์ทส่วนใหญ่เป็นอักษรละติน
      ตัดแบบข้อความย่อยฝั่งนั้น = "TOPPER" เหลือ "PER" แล้วค้นผิดตัว */
const THAI_FILLER = /โออีอี|ใบรายงานของเสีย|ใบสแครป|สแครป|ประสิทธิภาพ|เปอร์เซ็นต์เครื่อง|เครื่องเสีย|เครื่องพัง|หยุดนาน|สาเหตุที่|สาเหตุ|ดาวน์|งานซ่อม|ช่างยังไม่มา|รอช่าง|ของไม่ผ่าน|งานไม่ผ่าน|เปลี่ยน|คนมา|ใครลา|กำลังคน|คนครบ|ทำได้|นาน|พัง|บ่อยที่สุด|บ่อยสุด|บ่อย|ชิ้นงานเสีย|งานเสีย|เสีย|มีเครื่อง|เครื่อง|หยุด|มี|ใคร|ต่ำที่สุด|ต่ำสุด|แย่ที่สุด|แย่สุด|น้อยที่สุด|น้อยสุด|ตอนนี้|ขณะนี้|อยู่ไหม|อยู่มั้ย|อยู่บ้าง|ไหนบ้าง|แจ้งซ่อม|ใบซ่อม|โฟร์เอ็ม|ของเสีย|มาทำงาน|เช็คชื่อ|ขาดงาน|คนขาด|มากี่คน|กี่คน|กี่ใบ|ค้าง|รออนุมัติ|อนุมัติ|ไหม|มั้ย|ไหน|อยู่|ดาว(น์)?\s*ไทม์|เครื่องหยุด|หยุดเครื่อง|ยอดผลิต|ผลิต|กี่ชิ้น|สูงสุด|มากที่สุด|มากสุด|อันดับ|อะไร|บ้าง|เท่าไหร่|เท่าไร|ไปแล้ว|แล้ว|ได้|ไป|ของ|ขอ|ยอด|ดู|หน่อย|ครับ|ค่ะ|คะ|นะ|ไลน์|งาน|ชิ้น|กี่|ที|สุด/g;
const LATIN_FILLER = /\b(scrap\s*report|scrap|changing\s*point|reject|lowest|worst|now|mo|4\s*m|ng|defects?|attendance|oee|down\s*time|downtime|top|line|output|production|today|yesterday|this|last|week|month)\b|[?？!]/g;
const THAI_RUN = /([฀-๿]+)/;
/* 🔴 ห้ามตัดคำกลางพยางค์ — "ที" ใน "ชุดที่" ตามด้วยไม้เอก ⇒ ไม่ใช่คำว่า "ที" (เคสจริงตอนลองถาม 19/11)
   ⇒ ตัดได้เฉพาะเมื่อตัวถัดไป **ไม่ใช่** สระบน/ล่าง/วรรณยุกต์ (อักขระประกอบของพยางค์เดียวกัน) */
const THAI_MARK_AHEAD = /^[ัิ-ฺ็-๎]/;
const stripThaiFiller = (run) => run.replace(THAI_FILLER, (m, ...a) => {
  const off = a[a.length - 2], str = a[a.length - 1];
  return THAI_MARK_AHEAD.test(str.slice(off + m.length)) ? m : ' ';
});

function stripPeriodWords(t) {
  let s = t.replace(/เดือน\s*\d{1,2}(\s*[/-]\s*\d{4})?/g, ' ')
    .replace(/วันนี้|เมื่อวาน|(สัปดาห์|อาทิตย์)(นี้|ที่แล้ว|ก่อน)|เดือน(นี้|ที่แล้ว|ก่อน)/g, ' ')
    .replace(SHIFT_WORDS, ' ');
  for (const names of TH_MONTHS) for (const w of names) s = s.split(w).join(' ');
  return s.replace(/(^|\s)(25|20)\d{2}(?=\s|$)/g, ' ');
}

/* คำไทยสั้นที่ตัดแบบข้อความย่อยไม่ได้ ("ใบ"/"คน" อยู่ในคำอื่นเยอะ) ⇒ ตัดเฉพาะตอนยืนเดี่ยวเป็นคำ */
const SOLO_THAI = new Set(['ใบ', 'คน', 'ลา', 'ช่าง', 'ซ่อม', 'ครบ', 'ไม่ผ่าน']);

function subjectOf(t) {
  return stripPeriodWords(t).split(THAI_RUN)
    .map(part => (THAI_RUN.test(part) ? stripThaiFiller(part) : part.replace(LATIN_FILLER, ' ')))
    .join(' ').split(/\s+/).filter(w => w && !SOLO_THAI.has(w)).join(' ').trim();
}

/**
 * @returns {{ intent:string|null, period:object|null, periodDefault:string|null, subject:string, error?:string }}
 */
/* ── กะ (20/11 · คำสั่ง user "ใส่คำว่ากะเช้า กะดึก กะนี้") ─────────────────────
   กะเช้า = 'day' · กะดึก = 'night' (ค่าเดียวกับ `production_sessions.shift`)
   🔴 "กะนี้" = กะปัจจุบัน **ของวันทำงานนี้** — ผู้เรียกส่ง `shiftNow` (`getCurrentShift()`) เข้ามา
      ไฟล์นี้ไม่อ่านนาฬิกาเอง (pure + เทสตรึงได้) · ไม่ส่ง = ตัดสินไม่ได้ ⇒ error ห้ามเดา
   🔴 "กะนี้" ไม่บอกช่วง = วันนี้ (กะนี้ของเมื่อวานไม่มีความหมาย) */
/* 🕐 "เมื่อกี้" (20/11 · คำสั่ง user) = **กะก่อนหน้ากะปัจจุบัน** (กะล่าสุดที่จบไปแล้ว)
   ตีความแบบนี้เพราะคำตอบนับเฉพาะกะที่ปิดแล้ว — "กะนี้" ส่วนใหญ่ยังไม่ปิด
   🔴 คำตอบต้องเขียนบอกเสมอว่าตีความเป็นกะไหน วันไหน (ป้ายช่วง) — ไม่ใช่ความหมายที่ชัดในตัว */
const SHIFT_WORDS = /กะ\s*(เช้า|ดึก|นี้|ปัจจุบัน|ที่แล้ว|ก่อน)|เมื่อกี้|เมื่อกี๊|day\s*shift|night\s*shift/g;
export const SHIFT_LABEL = { day: 'กะเช้า', night: 'กะดึก' };

export function shiftFromText(t, shiftNow = null, today = null) {
  const s = String(t || '').toLowerCase();
  if (/กะ\s*เช้า|day\s*shift/.test(s)) return { shift: 'day', label: SHIFT_LABEL.day };
  if (/กะ\s*ดึก|night\s*shift/.test(s)) return { shift: 'night', label: SHIFT_LABEL.night };
  if (/กะ\s*(นี้|ปัจจุบัน)/.test(s)) {
    if (shiftNow !== 'day' && shiftNow !== 'night') return { error: 'ยังบอกไม่ได้ว่าตอนนี้เป็นกะไหน — พิมพ์ "กะเช้า" หรือ "กะดึก" แทน' };
    return { shift: shiftNow, label: `กะนี้ (${SHIFT_LABEL[shiftNow]})`, isNow: true };
  }
  if (/เมื่อกี้|เมื่อกี๊|กะ\s*(ที่แล้ว|ก่อน)/.test(s)) {
    if ((shiftNow !== 'day' && shiftNow !== 'night') || !today) return { error: 'ยังบอกไม่ได้ว่ากะก่อนหน้าคือกะไหน — พิมพ์ "กะเช้า" หรือ "กะดึก" พร้อมวัน เช่น "กะดึก เมื่อวาน"' };
    /* กะเช้าตอนนี้ ⇒ ก่อนหน้า = กะดึกของวันทำงานเมื่อวาน · กะดึกตอนนี้ ⇒ กะเช้าของวันทำงานเดียวกัน */
    const prev = shiftNow === 'day' ? { shift: 'night', date: addDay(today, -1) } : { shift: 'day', date: today };
    return { shift: prev.shift, prevDate: prev.date, label: `เมื่อกี้ = กะก่อนหน้า (${SHIFT_LABEL[prev.shift]} ${prev.date})` };
  }
  return null;
}

export function parseQuestion(text, today, { shiftNow = null } = {}) {
  const raw = String(text || '').trim();
  const t = raw.toLowerCase();
  const it = INTENTS.find(i => i.re.test(t)) || null;
  const sh = shiftFromText(t, shiftNow, today);
  let p = periodFromText(t, today);
  if (!p && sh?.isNow) p = periodFromText(tr("วันนี้"), today);     // กะนี้ = วันนี้
  if (!p && sh?.prevDate) p = { from: sh.prevDate, to: sh.prevDate, label: sh.prevDate, explicit: true };   // เมื่อกี้ = วันของกะก่อนหน้า
  const subject = subjectOf(t);
  if (!it) return { intent: null, period: null, periodDefault: null, subject, shift: null };
  if (p?.error || sh?.error) return { intent: it.key, period: null, periodDefault: null, subject, shift: null, error: p?.error || sh.error };
  return { intent: it.key, period: p, periodDefault: p ? null : it.defaultPeriod, subject,
    shift: sh ? { key: sh.shift, label: sh.label } : null,
    /* ถามว่า "สแครป" แต่ได้ของเสียจากรายงานผลิต — จอต้องบอกว่าไม่ใช่ตัวเลขตามใบ scrap report (user เลือก 20/11) */
    viaScrap: it.key === 'defect_top' && /สแครป|scrap/.test(t) };
}

/** ค่าตั้งต้นของช่วง (เมื่อคำถามไม่ได้บอก) — จอต้องเขียนว่า "ไม่ได้ระบุช่วง ใช้…" */
export function defaultPeriod(key, today) {
  const p = periodFromText(key === 'today' ? tr("วันนี้") : key === 'week' ? 'สัปดาห์นี้' : 'เดือนนี้', today);
  return { ...p, explicit: false };
}

/* ── 3) ค้นชื่อไลน์/พาร์ท ─────────────────────────────────────────────────── */
export const normKey = (s) => String(s ?? '').toLowerCase().replace(/[\s\-_/.()[\],]+/g, '');

/**
 * หาไลน์/พาร์ทจากข้อความ — **ตรงตัวเดียวเท่านั้นถึงตอบ** หลายตัว = คืนให้คนเลือก (ห้ามเดา)
 * พาร์ทยุบด้วยแกน `p_no` (`partCoreOf`) = สินค้าเดียวกันคนละลูกค้า นับเป็นตัวเลือกเดียว
 * @param {{ lines?:any[], products?:any[], kinds?:('line'|'part')[] }} reg
 * @returns {{ pick:object|null, choices:object[], more:number }}
 *   pick   = `{ kind:'line', name }` | `{ kind:'part', core, mats:[], label }`
 */
export function matchSubject(subject, { lines = [], products = [], kinds = ['line', 'part'] } = {}) {
  const tokens = String(subject || '').toLowerCase().split(/\s+/).map(normKey).filter(Boolean);
  if (!tokens.length) return { pick: null, choices: [], more: 0 };
  const whole = tokens.join('');
  /* ตัวเลขล้วนต้องตรง "ทั้งตัว" — ถาม "ชุดที่ 1" ห้ามได้ 10–15 มาด้วย · ถาม "060" ห้ามได้ "0601" */
  /* 0 นำหน้าไม่นับ — พิมพ์ "060" ต้องเจอ "Line 60" (user ทัก 20/11 · เดิมหาไลน์ไม่เจอแล้วไปตกที่พาร์ท 16E060 เงียบๆ) */
  const hitAll = (hay) => tokens.every(tk => (/^\d+$/.test(tk)
    ? new RegExp(`(^|\\D)0*${String(Number(tk))}(?!\\d)`).test(hay) : hay.includes(tk)));

  const lineHits = [], lineExact = [];
  if (kinds.includes('line')) for (const l of lines) {
    if (!l?.name) continue;
    const k = normKey(l.name);
    if (k === whole) lineExact.push(l);
    else if (hitAll(k)) lineHits.push(l);
  }
  const partByKey = new Map(), partExact = new Set();
  if (kinds.includes('part')) for (const p of products) {
    if (!p?.mat_no || p.is_operation) continue;          // ชั้น OP ไม่ใช่พาร์ทจริง
    const keys = [normKey(p.name), normKey(p.p_no), normKey(p.mat_no)];
    const exact = keys.includes(whole);
    if (!exact && !keys.some(hitAll)) continue;
    const core = partCoreOf(p.p_no) || `mat:${p.mat_no}`;
    const g = partByKey.get(core) || { kind: 'part', core, mats: [], label: p.name || p.mat_no, p_no: p.p_no || null };
    g.mats.push(p.mat_no);
    partByKey.set(core, g);
    if (exact) partExact.add(core);
  }
  const lineChoice = (l) => ({ kind: 'line', name: l.name, label: l.name });

  /* ตรงเป๊ะชนะ "มีคำนี้อยู่ข้างใน" · ตรงเป๊ะหลายตัว (ไลน์ชื่อเดียวกับพาร์ท) = ยังต้องให้เลือก */
  const exact = [...lineExact.map(lineChoice), ...[...partExact].map(c => partByKey.get(c))];
  const pool = exact.length ? exact : [...lineHits.map(lineChoice), ...partByKey.values()];
  if (pool.length === 1) return { pick: pool[0], choices: [], more: 0 };
  const MAX = 8;
  return { pick: null, choices: pool.slice(0, MAX), more: Math.max(0, pool.length - MAX) };
}

/* ── 4) สูตรรวมผล (เรียกสูตรกลางเท่านั้น) ─────────────────────────────────── */

/**
 * OEE ของกะที่ปิดแล้ว — ค่า stamp ถ่วงน้ำหนักแบบเดียวกับ /oee-analytics และ /vsm
 * (oee/A ด้วย wLoad · P ด้วย wRun · Q ด้วย wProd)
 * 🔴 น้ำหนัก wLoad ต้องหัก "หยุดตามแผน" ที่ตัดช่วงพัก + หารเลนแล้ว ⇒ ผ่าน `dtMinBySession` เท่านั้น
 *    (รวม duration_min เอง = หักนาทีที่ทับพักซ้ำ · กฎเหล็ก §OEE 2026-09-15)
 * @param sessions  กะ (ต้องมี id, work_date, shift, start_time, shift_min, line_name + oee*)
 * @param downtimes ใบ downtime ของกะชุดนี้ (started_at/ended_at/duration_min/machine_no + category/planned_cap_min)
 */
export function oeeSummary(sessions = [], downtimes = [], breakPolicies = [], { lines = null, affectsBy = null } = {}) {
  const eff = dtMinBySession(sessions, downtimes, breakPolicies, { lines, affectsBy });
  const items = sessions.filter(s => s && s.oee != null).map(s => ({ ...s, plannedMin: eff[s.id]?.planned || 0 }));
  return {
    n: items.length,
    oee: wavg(items, i => +i.oee, wLoad),
    a: wavg(items, i => (i.oee_a != null ? +i.oee_a : null), wLoad),
    p: wavg(items, i => (i.oee_p != null ? +i.oee_p : null), wRun),
    q: wavg(items, i => (i.oee_q != null ? +i.oee_q : null), wProd),
    noStamp: sessions.filter(s => s && s.oee == null).length,
  };
}

/**
 * พาเรโต downtime นอกแผน — นาทีเต็ม `duration_min` (คำถาม "เครื่องหยุดกี่นาที" · ไม่ใช่ฐานเวลา OEE)
 * · แยกในแผน/นอกแผนผ่าน `dtPlannedSplit()` — หยุดตามแผนที่เกินเพดานของประเภท = นอกแผน (ทะเบียน · 16/11)
 * · ถังขยะ "อื่นๆ" ถูกแตกตามเครื่องโดย `dtBucketName()` ⇒ ไม่ขึ้นอันดับ 1 เป็นก้อนเดียว
 */
export function downtimeTop(rows = [], n = 5) {
  const parts = rows.map(d => ({ d, sp: dtPlannedSplit(d, Number(d?.duration_min) || 0) }));
  const unplanned = parts.filter(x => x.sp.unplanned > 0);
  const idx = buildDtIndex(unplanned.map(x => x.d));
  const by = new Map();
  let total = 0, overMin = 0;
  for (const { d, sp } of unplanned) {
    total += sp.unplanned; overMin += sp.overMin;
    const k = dtBucketName(d, idx);
    const e = by.get(k) || { name: k, min: 0, count: 0 };
    e.min += sp.unplanned; e.count += 1; by.set(k, e);
  }
  const list = [...by.values()].sort((a, b) => b.min - a.min);
  const trash = dtTrashStats(unplanned.map(x => x.d), { index: idx });
  return { total, top: list.slice(0, n), groups: list.length, trash, overMin,
    plannedExcluded: parts.filter(x => x.sp.planned > 0 && x.sp.unplanned === 0).length };
}

/**
 * ยอดผลิต (ชิ้น) จากใบผลิต — ต่อใบ `orderProducedQty()` · ยุบชั้น OP ด้วย `collapseOps()`
 * 🔴 ไม่ยุบคู่ RH/LH (ยอดผลิตนับชิ้น) · ใบไม่มี MAT = รวมยอดแยก (`noMat`) ห้ามทิ้ง
 */
export function productionTotals(orders = [], opMap = null) {
  const perMat = {}; let noMat = 0;
  for (const o of orders) {
    const q = orderProducedQty(o);
    if (o.mat_no == null || o.mat_no === '') { noMat += q; continue; }
    (perMat[o.mat_no] ||= { mat_no: o.mat_no, target: 0, produced: 0 }).produced += q;
  }
  const rows = collapseOps(Object.values(perMat), opMap || {});
  const total = rows.reduce((a, r) => a + (Number(r.produced) || 0), 0) + noMat;
  return { total, noMat, rows: rows.filter(r => r.produced > 0).sort((a, b) => b.produced - a.produced) };
}

/* ── รอบ 2 (19/11) ─────────────────────────────────────────────────────── */

/** จัดอันดับไลน์จาก OEE ต่ำ→สูง — ไลน์ละ `oeeSummary` ชุดเดียวกับคำถาม OEE ไลน์ (ไม่มีสูตรที่ 2) */
export function rankLinesByOee(sessions = [], downtimes = [], breakPolicies = [], opts = {}) {
  const byLine = new Map();
  sessions.forEach(s => { if (s?.line_name) (byLine.get(s.line_name) || byLine.set(s.line_name, []).get(s.line_name)).push(s); });
  const ids = new Map(); sessions.forEach(s => ids.set(s.id, s.line_name));
  const dtBy = new Map();
  downtimes.forEach(d => { const ln = ids.get(d.session_id); if (ln) (dtBy.get(ln) || dtBy.set(ln, []).get(ln)).push(d); });
  const rows = [...byLine.entries()].map(([line, ss]) => ({ line, ...oeeSummary(ss, dtBy.get(line) || [], breakPolicies, opts) }));
  const ranked = rows.filter(r => r.oee != null).sort((a, b) => a.oee - b.oee);
  return { ranked, noValue: rows.filter(r => r.oee == null).map(r => r.line) };
}

/**
 * เครื่องหยุดตอนนี้ — แถวเปิดค้าง (ไม่มี ended_at/duration) แยกตามสถานะกะ (`dtOpenKind` ของกลาง)
 * · กะยังเปิด = ยังหยุดจริง · กะปิดแล้ว = **ลืมปิดรายการ** (ห้ามนับเป็นเครื่องหยุด แต่ห้ามซ่อน)
 * @param rows  ต้อง embed `production_sessions(line_name, status)` + `dr_downtime_types(name_th, category)`
 * @param kindOf  `(d) => 'open'|'forgotten'|'unknown'|'done'` (ส่ง `dtOpenKind` เข้ามา — ไฟล์นี้ไม่ import ตัวที่ผูก DB)
 */
export function openDowntimeList(rows = [], nowMs, kindOf) {
  const open = [], forgotten = [];
  for (const d of rows) {
    const k = kindOf(d);
    if (k === 'done') continue;
    const e = { machine: d.machine_no || 'ไม่ระบุเครื่อง', line: d.production_sessions?.line_name || 'ไม่ระบุไลน์',
      type: dtTypeName(d) || tr("ไม่ระบุประเภท"), planned: d?.dr_downtime_types?.category === 'planned',
      /* ไม่มีเวลาเริ่ม = ไม่รู้ว่าหยุดมานานเท่าไหร่ ⇒ null (จอเขียน "ไม่ทราบเวลาเริ่ม") ห้ามโชว์ 0 นาที */
      min: d.started_at ? dtRawMin(d, nowMs) : null };
    (k === 'forgotten' ? forgotten : open).push(e);
  }
  open.sort((a, b) => (b.min ?? -1) - (a.min ?? -1));
  return { open, forgotten };
}

/** ใบ MO ค้าง — นับตามสถานะ (ลำดับ = ลำดับขั้นใน `OPEN_MO_STATUSES`) + ใบเก่าสุดของแต่ละสถานะ (วัน) */
export function moOpenSummary(rows = [], nowMs) {
  const by = new Map(OPEN_MO_STATUSES.map(st => [st, { status: st, label: MO_STATUS_LABEL[st] || st, n: 0, oldestDays: null }]));
  let unknown = 0;
  for (const o of rows) {
    const e = by.get(o.status);
    if (!e) { unknown++; continue; }
    e.n++;
    const t = o.created_at ? Date.parse(o.created_at) : NaN;
    if (Number.isFinite(t)) { const d = Math.floor((nowMs - t) / 86400000); if (e.oldestDays == null || d > e.oldestDays) e.oldestDays = d; }
  }
  const list = [...by.values()].filter(e => e.n);
  return { total: list.reduce((a, e) => a + e.n, 0), list, unknown };
}

/** 4M ค้างอนุมัติ — แยกรอหัวหน้า/รอ QA · แยกใบระบบ (`[Auto]`/ไม่มีผู้สร้าง) ออกจากใบคน (กฎ four-m-workflow) */
export function fourMPendingSummary(rows = [], today) {
  const isAuto = (r) => r.created_by == null || /^\s*\[auto\]/i.test(String(r.description || ''));
  const out = { pending: 0, pending_qa: 0, auto: 0, oldest: null, byLine: new Map() };
  for (const r of rows) {
    if (r.status !== 'pending' && r.status !== 'pending_qa') continue;
    out[r.status]++;
    if (isAuto(r)) out.auto++;
    if (r.work_date && (!out.oldest || r.work_date < out.oldest)) out.oldest = r.work_date;
    const ln = r.line_name || 'ไม่ระบุไลน์';
    out.byLine.set(ln, (out.byLine.get(ln) || 0) + 1);
  }
  out.total = out.pending + out.pending_qa;
  out.oldestDays = out.oldest ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${out.oldest}T00:00:00Z`)) / 86400000) : null;
  out.topLines = [...out.byLine.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return out;
}

/**
 * ของเสียสูงสุด — จำนวน `defectQtyAll` (ตัวเลขชุดของพาเรโต · กฎ %Q vs พาเรโต ห้ามสลับ)
 * 🔴 หมวด "อื่นๆ/ไม่ระบุ" **ไม่ติดอันดับ** — แยกเป็นบรรทัด "ชี้เป้าไม่ได้" (กฎ อื่นๆ ห้ามขึ้นอันดับ 1)
 * · ของสงสัยรอ QA ตัดสิน = นับในพาเรโต (ชิ้นที่เกิดเรื่องจริง) แต่ต้องบอกจำนวนที่ยังรอ (`sumSuspectPending`)
 */
export function defectTop(rows = [], n = 5) {
  const by = new Map();
  let total = 0, vagueQty = 0;
  for (const d of rows) {
    const q = defectQtyAll(d);
    if (!q) continue;
    total += q;
    const name = String(d?.dr_defect_types?.name_th || '').trim();
    if (!name || isVague(name)) { vagueQty += q; continue; }
    by.set(name, (by.get(name) || 0) + q);
  }
  const list = [...by.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty);
  return { total, top: list.slice(0, n), groups: list.length, vagueQty, pending: sumSuspectPending(rows) };
}

/**
 * มาทำงานกี่คน — นับจากพนักงาน active ของไลน์ × บันทึกเช็คชื่อของวันนั้น (สูตรเดียวกับ /dept-dashboard)
 * 🔴 แยก 3 กอง: มา · **แจ้งว่าไม่มา** (is_present=false) · **ยังไม่ได้เช็ค** — ห้ามรวม 2 กองหลังเป็น "ขาด"
 *    (คนกะดึกที่ยังไม่เข้ากะ = ยังไม่เช็ค ไม่ใช่ขาดงาน)
 */
export function attendanceSummary(emps = [], logs = [], lineNameOf = () => null, { shift = null, shiftOf = null } = {}) {
  const st = new Map();
  logs.forEach(l => { if (l?.employee_id != null) st.set(l.employee_id, l.is_present ? 'in' : (st.get(l.employee_id) === 'in' ? 'in' : 'out')); });
  const byLine = new Map();
  const tot = { head: 0, in: 0, out: 0, none: 0 };
  let otherShift = 0, unknownShift = 0, unknownIn = 0;
  for (const e of emps) {
    const ln = lineNameOf(e.line_id);
    if (!ln) continue;
    const k = st.get(e.id) || 'none';
    if (shift && shiftOf) {
      const sh = shiftOf(e);
      /* 🔴 ไม่รู้กะ (ไลน์ยังไม่ตั้งตารางกะ · ทีมที่ไม่รู้กติกา) = แยกนับ ห้ามโยนเข้ากะไหนเอง (ห้ามเดา) */
      if (sh == null) { unknownShift++; if (k === 'in') unknownIn++; continue; }
      if (sh !== shift) { otherShift++; continue; }
    }
    const r = byLine.get(ln) || { line: ln, head: 0, in: 0, out: 0, none: 0 };
    r.head++; r[k]++; tot.head++; tot[k]++;
    byLine.set(ln, r);
  }
  return { ...tot, otherShift, unknownShift, unknownIn,
    lines: [...byLine.values()].sort((a, b) => (b.out + b.none) - (a.out + a.none)) };
}

/**
 * "คนนี้เข้ากะไหนในวันนั้น" สำหรับนับคนรายกะ — ลำดับเดียวกับจอเช็คชื่อ (`Checkin.jsx`):
 *   override รายคน → merge event (ไลน์ชนะส่วนงาน) → ตารางกะไลน์/หน่วยงาน (Team C = กะเช้าตลอด)
 * ตัวตัดสินจริงคือ `resolveAssignedShift()` (`shiftAssign.js` · ของกลางตามกฎ CLAUDE.md §Shift Logic)
 * 🔴 `lines` ต้องส่งเสมอ — ไลน์ลูกตกทอดกะจากไลน์แม่ (`buildScheduleMaps(rows, lines)`)
 * ⚠️ คนที่ถูกยืมไปช่วยไลน์อื่น (`line_helpers`) ยังนับที่ไลน์ต้นสังกัด — จอเช็คชื่อย้ายไปนับที่ไลน์ปลายทาง
 * @returns {(emp) => 'day'|'night'|null}
 */
export function makeShiftOf({ schedules = [], overrides = [], merges = [], lines = [] } = {}) {
  const maps = buildScheduleMaps(schedules, lines);
  const ovr = {}; overrides.forEach(o => { if (o?.employee_id != null) ovr[o.employee_id] = o.shift; });
  const secOf = {}; lines.forEach(l => { secOf[l.id] = l.section; });
  return (emp) => {
    /* คนที่ถูกยืมไปช่วย = อยู่กะที่ถูกยืมแน่นอน (การยืมผูกกะ) — เหมือน /checkin ห้ามให้ตารางกะไลน์เดิมตัดสิน */
    if (emp._helperShift) return emp._helperShift;
    const sec = secOf[emp.line_id];
    const m = merges.find(e => e.line_id === emp.line_id) || merges.find(e => e.section && e.section === sec);
    return resolveAssignedShift(emp, { overrideShift: ovr[emp.id], mergeShift: m?.target_shift, maps });
  };
}

/**
 * ย้ายคนที่ถูกยืมไปช่วย (`line_helpers`) ไปนับที่ **ไลน์ปลายทาง** — เหมือนจอเช็คชื่อ (20/11 · คำสั่ง user)
 * · ระบุกะ: ใช้แถวของกะนั้น (คิวรีกรอง shift มาแล้ว) ⇒ ย้ายไลน์ + ตรึงกะ = กะที่ยืม (`_helperShift`)
 * · ไม่ระบุกะ (ทั้งวัน): ย้ายเฉพาะคนที่ทั้งวันไปไลน์ปลายทาง **ไลน์เดียว** · ไปคนละไลน์ในแต่ละกะ = นับที่ต้นสังกัด
 *   แล้วคืนจำนวนใน `split` ให้จอเขียนบอก (ห้ามเลือกไลน์ใดไลน์หนึ่งเอง = เดา)
 * 🔴 ไม่แตะแถวเดิม (คืน object ใหม่) · `_homeLineId` เก็บไลน์ต้นสังกัดไว้
 * ⚠️ ระบุกะ: คนที่ถูกยืม **เฉพาะอีกกะ** ยังอยู่กะเดิมตามตารางกะ — เหมือน /checkin (โหลดการยืมเฉพาะกะที่ดู)
 *    ⇒ กะเช้า+กะดึกอาจรวมเกินยอดทั้งวัน · คืน `otherShift` (รายชื่อ id) ให้จอเขียนบอก ห้ามเงียบ
 * @param helpers แถวของ **ทั้งวัน** (ทุกกะ) — กรองกะในนี้เอง เพื่อรู้ว่าใครถูกยืมอีกกะ
 * @returns {{ emps:any[], moved:number, split:number, otherShift:Set }}
 */
export function applyHelpers(emps = [], helpers = [], { shift = null } = {}) {
  const by = new Map();
  const otherShift = new Set();
  for (const h of helpers) {
    if (h?.employee_id == null || h.to_line_id == null) continue;
    if (shift && h.shift && h.shift !== shift) { otherShift.add(h.employee_id); continue; }
    const e = by.get(h.employee_id) || { lines: new Set(), shift: h.shift || shift };
    e.lines.add(h.to_line_id); by.set(h.employee_id, e);
  }
  let moved = 0, split = 0;
  const out = emps.map(emp => {
    const h = by.get(emp.id);
    if (!h) return emp;
    if (h.lines.size !== 1) { split++; return emp; }
    const to = [...h.lines][0];
    moved++;
    return { ...emp, line_id: to, _homeLineId: emp.line_id, ...(shift ? { _helperShift: shift } : {}) };
  });
  for (const id of by.keys()) otherShift.delete(id);   // ถูกยืมกะนี้ด้วย = ย้ายไปแล้ว ไม่ใช่ "อีกกะ"
  return { emps: out, moved, split, otherShift };
}

/**
 * 🧾 สรุปใบรายงานของเสีย (`scrap_reports` + `scrap_report_items` · DR) — ตัวเลข **ตามใบ** ไม่ใช่รายงานผลิต
 * · ยอด = `qty` (ช่อง Q'TY ของฟอร์ม) · `confirm_qty` ต่างจากยอดเมื่อไหร่ = คืนให้จอเขียนบอก
 * · พาร์ทจับกลุ่มด้วย mat_no → part_no → part_name (ใบมีพาร์ทย่อยที่คีย์เองซึ่งอาจไม่มี mat_no)
 */
export const SCRAP_STATUS_LABEL = { draft: 'ร่าง', submitted: 'ส่งอนุมัติ', approved: 'อนุมัติแล้ว' };
export function scrapReportSummary(reports = [], items = [], n = 5) {
  const byStatus = {};
  let unknownStatus = 0;
  for (const r of reports) {
    if (SCRAP_STATUS_LABEL[r.status]) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    else unknownStatus++;
  }
  const byPart = new Map();
  let total = 0, confirm = 0, confirmKnown = 0;
  for (const it of items) {
    const q = Number(it.qty) || 0;
    total += q;
    if (it.confirm_qty != null && it.confirm_qty !== '') { confirm += Number(it.confirm_qty) || 0; confirmKnown++; }
    const key = it.mat_no || it.part_no || it.part_name || 'ไม่ระบุพาร์ท';
    const e = byPart.get(key) || { key, name: it.part_name || '', qty: 0 };
    e.qty += q; byPart.set(key, e);
  }
  const parts = [...byPart.values()].filter(e => e.qty > 0).sort((a, b) => b.qty - a.qty);
  return { reports: reports.length, byStatus, unknownStatus, total, confirm, confirmKnown,
    confirmDiffers: confirmKnown > 0 && confirm !== total, top: parts.slice(0, n), parts: parts.length };
}

export const fmtInt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
export const fmtPct = (n) => (n == null ? '—' : `${(+n).toFixed(1)}%`);

/** ข้อความแนะนำรูปแบบที่ถามได้ — ใช้ทั้งปุ่มลัดและตอนไม่เข้าใจคำถาม */
/** ปุ่มลัดใต้กล่องแชท — 3 ปุ่มพอ (user ทัก 20/11 "รกเกินไป") · รายการเต็มอยู่ใน ASK_HINTS ตอนตอบว่าไม่เข้าใจ */
export const HINT_CHIPS = ['oee HDF1 วันนี้', 'downtime สูงสุด สัปดาห์นี้', 'ยอดผลิต HDF1 วันนี้'];

export const ASK_HINTS = [
  'oee HDF1 วันนี้', 'oee ต่ำสุด วันนี้', 'downtime สูงสุด สัปดาห์นี้', 'เครื่องหยุดตอนนี้',
  'MO ค้าง', 'ของเสียสูงสุด สัปดาห์นี้', 'ใบสแครป เดือนนี้', '4M ค้าง', 'มาทำงานกี่คน HDF1', 'ยอดผลิต HDF1 เดือนนี้',
];
