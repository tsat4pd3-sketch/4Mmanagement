import { useState, useEffect, useLayoutEffect, useContext, useRef, useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import imageCompression from 'browser-image-compression';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { pairAwareTotal, collapseOps } from '../utils/pairTotals';
import { loadOpInfo, opInfoSync } from '../utils/opItems';
import { parallelUnitsOf, flowModeOf } from '../utils/lineTypes';
import { toast } from '../components/Toast';
import ToggleDot from '../components/ToggleDot';
import useUndoHistory, { undoBtnStyle } from '../utils/useUndoHistory';
import { computeLiveOee, wavg, wLoad, wRun, wProd, buildCtMap, isTrialDefect, defectQty, policyBreakOverlapMin } from '../utils/oee';
import { usePolling } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import { cachedMaster } from '../utils/masterCache';
import { loadPmTeams, isAmTeam } from '../utils/pmTeams';
import { fetchByIds } from '../utils/fetchByIds';
import { monthKeyOf, shiftMonth, monthLabel, monthRange, fmtKwh, fmtBaht, deltaPct, energyCat, efFor, co2eKg, fmtTco2e } from '../utils/energy';
import { OPEN_MO_STATUSES } from '../utils/dieStatus';
import { fmtDtElapsed } from '../utils/downtimeRules';
import { zoneFill, zoneHealth, zoneHealthText, zoneKindMeta, ZONE_KINDS, WAREHOUSE_LOCATIONS } from '../utils/storageZones';

/* ── ผังรวมโรงงาน (Factory Master Map) — polygon อิสระ + เลือก metric, 2026-07-16 ──────
   รูปผังใหญ่ทั้งโรงงาน 1 รูป + วาด polygon ล้อมแต่ละไลน์ (L/U ได้) ระบายสีตาม metric ที่เลือก
   metric: ยอดผลิต / OEE / Downtime / ของเสีย — เลือกดูได้ · มี side panel จัดอันดับไลน์ (ใช้พื้นที่ข้าง)
   - View: ทุก role · Edit (อัปโหลด/วาด/ย้าย/ลบ): can('factory_map','edit')
   - points = [[x,y],...] เป็น % ของรูปจริง (0-100) · SVG polygon preserveAspectRatio=none + non-scaling stroke
*/

function getWorkDate() {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// วันงานล่าสุดที่ "จบแล้ว" (default ของแผงสรุปทบทวน) — ตรรกะเดียวกับ MorningMeeting
//   ก่อน 08:00 = work date ปัจจุบัน (ยังเป็นเมื่อวาน) · หลัง 08:00 = ถอย 1 วัน
function reviewDefaultDate() {
  const base = getWorkDate();
  if (new Date().getHours() < 8) return base;
  const d = new Date(`${base}T00:00:00`); d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const shiftDate = (s, delta) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + delta); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtThaiDate = (s) => { try { return new Date(`${s}T00:00:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); } catch { return s; } };
const fmtNum = (n) => (n == null ? '0' : Math.round(n).toLocaleString('en-US'));
const pctCol = (p) => p == null ? 'var(--muted)' : p >= 95 ? '#22c55e' : p >= 80 ? '#f59e0b' : '#ef4444';
const oeeCol = (o) => o == null ? 'var(--muted)' : o >= 80 ? '#22c55e' : o >= 65 ? '#f59e0b' : '#ef4444';

// สีตามหมวดสถานะ (คำนวณต่อ metric) — down = แดงกระพริบ (Andon), อื่นๆ นิ่ง
const CAT = {
  good: { color: '#22c55e', label: 'ดี' },
  ok:   { color: '#f59e0b', label: 'เฝ้าระวัง' },
  bad:  { color: '#ef4444', label: 'ต้องแก้' },
  down: { color: '#ef4444', label: 'Downtime', blink: true },
  idle: { color: '#6b7280', label: 'ไม่มีแผน/ปิดกะ' },
  waiting: { color: '#38bdf8', label: 'เปิดกะ · ยังไม่มี order' },
  busy: { color: '#38bdf8', label: 'กำลังทำ PM' },   // งานตามแผนที่กำลังทำอยู่ — ไม่ใช่ alarm ห้ามกระพริบ
};

// นิยาม metric แต่ละตัว — value(ค่าเรียงอันดับ) · text(บนกรอบ) · cat(หมวดสี) · worstFirst(เรียง side panel)
/** % เปลี่ยนแปลงพลังงานเทียบเดือนก่อน — ต้องมีฐานจริงถึงจะเทียบ (0 = ไม่มีข้อมูล ไม่ใช่ "ไม่เปลี่ยน") */
const energyDelta = (s) => (s.kwhPrev ? deltaPct(s.kwh, s.kwhPrev) : null)

/* ── 🚦 สุขภาพรวม (แท็บ default · 2026-08-26 คำสั่ง user "ทุกอย่างปกติก็เขียว ไม่ปกติก็แล้วแต่สีที่กำหนด
   ส่วนแท็บอื่นดูเรื่องของตัวเองพอ") — pure functions ระดับ module ให้ METRICS เรียกได้
   ⚠️ เกณฑ์ทุกตัว "ยืม" จาก metric เจ้าของเรื่อง (pace 95/80 · NG 20 · PM overdue/dueSoon · คน 80)
      ห้ามตั้งเกณฑ์ชุดใหม่ — ไม่งั้นแท็บรวมกับแท็บเจาะตอบไม่ตรงกัน */
const HEALTH_RANK = { down: 4, bad: 3, ok: 2, good: 1, waiting: 1, idle: 0 };
// โซนสนับสนุน (MTN/utility/คลัง/แม่พิมพ์) — ย้ายขึ้นมาจาก component (ใช้แค่ field บน st · pure)
const facHealthOf = (st) => {
  if (st.storeZone) return st.storeZone.cat;   // 🏬 โซนคลัง: แดง "นิ่ง" = ต่ำกว่า Min/ล้นความจุ (งานคลังไม่ใช่ alarm เครื่องหยุด — ห้ามกระพริบ)
  if (st.die) return st.die.moPending ? 'down' : st.die.mo ? 'bad' : 'good';   // โซนแม่พิมพ์: MO รอรับงาน = กระพริบ (Andon)
  return (st.supAtRisk || st.dtActive) ? 'down' : st.pmOverdue ? 'bad' : st.pmDueSoon ? 'ok' : 'good';
};
const facHealthTextOf = (st) => {
  if (st.storeZone) return st.storeZone.text;
  if (st.die) return st.die.mo ? `⚠ แม่พิมพ์ใบซ่อมค้าง ${st.die.mo} ตัว` : `🔨 แม่พิมพ์ ${st.die.total} ตัว`;
  if (st.supAtRisk) return '⚠ เครื่องซ่อมอยู่';
  if (st.dtActive) return '🔴 หยุด';
  if (st.pmOverdue) return `⚠ PM เกิน ${st.pmOverdue}`;
  if (st.pmDueSoon) return `PM ใกล้ครบ ${st.pmDueSoon}`;
  return '🔧 ปกติ';
};
// ไลน์ผลิต — รวมทุกสัญญาณ เอาตัวแย่สุดตัดสินสี · ข้อความต้องบอก "เหตุผล" เสมอ ห้ามให้เดาจากสี
const prodHealthSignals = (s) => {
  const sig = [];
  if (s.dtActive) sig.push({ cat: 'down', txt: `🔴 หยุด ${fmtDtElapsed(s.dtOpenMin)}` });
  if (s.supAtRisk) sig.push({ cat: 'down', txt: '⚠ utility ที่จ่ายไลน์กำลังซ่อม' });
  if (s.target > 0 && s.onTimeTarget >= 1) {
    const p = s.actual / s.onTimeTarget * 100;   // เกณฑ์เดียวกับแท็บยอดผลิต (≥95 เขียว / ≥80 เหลือง)
    if (p < 80) sig.push({ cat: 'bad', txt: `ตามหลังจังหวะ ${Math.round(p)}%` });
    else if (p < 95) sig.push({ cat: 'ok', txt: `หลุดจังหวะ ${Math.round(p)}%` });
  }
  if (s.ng >= 20) sig.push({ cat: 'bad', txt: `NG ${s.ng}` });        // เกณฑ์เดียวกับแท็บของเสีย
  else if (s.ng > 0) sig.push({ cat: 'ok', txt: `NG ${s.ng}` });
  /* ⚠️ PM (ช่าง) กับ AM (ผลิตตรวจเอง) แยกกันเสมอ — คนละคนรับผิดชอบ รวมเป็นก้อนเดียวแล้วตอบไม่ได้ว่าใครต้องไปทำ
     "กำลังทำ PM อยู่" ไม่ใช่ปัญหา แต่ต้องเห็นบนป้าย (ไม่งั้นคนอ่านคิดว่าไลน์หยุดเพราะเสีย) */
  if (s.pmBusy) sig.push({ cat: 'good', txt: '🔧 กำลังทำ PM' });
  if (s.pmOverdue) sig.push({ cat: 'bad', txt: `PM เกิน ${s.pmOverdue}` });
  else if (s.pmDueSoon) sig.push({ cat: 'ok', txt: `PM ใกล้ครบ ${s.pmDueSoon}` });
  if (s.amOverdue) sig.push({ cat: 'bad', txt: `AM เกิน ${s.amOverdue}` });
  else if (s.amDueSoon) sig.push({ cat: 'ok', txt: `AM ใกล้ครบ ${s.amDueSoon}` });
  if (s.hasOpen && s.headTotal > 0) {
    const pp = s.present / s.headTotal * 100;    // เกณฑ์ "แย่" ของแท็บคน (<80)
    if (pp < 80) sig.push({ cat: 'ok', txt: `คนมา ${s.present}/${s.headTotal}` });
  }
  return sig.sort((a, b) => HEALTH_RANK[b.cat] - HEALTH_RANK[a.cat]);
};
const prodHealthCat = (s) => {
  const sig = prodHealthSignals(s);
  if (!sig.length) return s.hasOpen ? 'good' : 'idle';
  return sig[0].cat;
};
const prodHealthText = (s) => {
  const sig = prodHealthSignals(s);
  if (!sig.length) return s.hasOpen ? '✓ ปกติ' : '⏸ ยังไม่เปิดกะ';
  const t = sig.slice(0, 2).map(x => x.txt).join(' · ');
  return sig.length > 2 ? `${t} +${sig.length - 2}` : t;   // เกิน 2 เหตุ = นับบอก ห้ามตัดเงียบ
};

const METRICS = {
  /* 🚦 แท็บ default — ตอบ "ทั้งโรงงานปกติไหม" ในแวบเดียว: เขียวหมด = จบ · ผิดปกติ = สีตามเรื่องของมัน
     + ข้อความบอกเหตุผล · โซนสนับสนุนโชว์ด้วย (นี่คือบ้านของภาพรวม) · แท็บอื่น = มุมเจาะรายเรื่อง */
  health: {
    label: '🚦 ปกติ/ผิดปกติ', desc: true,
    value: s => HEALTH_RANK[s.isFac ? facHealthOf(s) : prodHealthCat(s)] || 0,
    cat: s => (s.isFac ? facHealthOf(s) : prodHealthCat(s)),
    text: s => (s.isFac ? facHealthTextOf(s) : prodHealthText(s)),
    short: s => {
      if (s.isFac) return facHealthOf(s) === 'good' ? '' : facHealthTextOf(s);
      const sig = prodHealthSignals(s);
      return sig.length ? sig[0].txt : (s.hasOpen ? '✓' : '');
    },
  },
  /* ⚡ พลังงานไฟฟ้า — ทีมขอ "show ค่า kWh บริเวณ Line บนผัง อยากดูละเอียดค่อยกดเข้าไป"
     เฟส 1 ตัวเลขมาจากการกรอกมือรายเดือนที่ /energy → ป้ายต้องบอกที่มา ห้ามดูเหมือนค่าที่วัดสด
     สี = เทียบเดือนก่อน (ลดลง=เขียว) · ไม่มีฐานเทียบ = เทา ไม่ใช่เขียว
     ⚠️ facilityNA ต้องไม่ตั้ง — โซนคอมเพรสเซอร์/คูลลิ่งคือตัวกินไฟหลัก metric นี้มีความหมายเต็มที่ */
  energy: {
    label: '⚡ พลังงาน', worstFirst: true, desc: true,
    value: s => s.kwh ?? null,
    text: s => {
      if (s.kwh == null) return 'ยังไม่กรอก';
      const d = energyDelta(s);
      return `${fmtKwh(s.kwh)} kWh${d != null ? ` · ${d > 0 ? '+' : ''}${d}%` : ''}`;
    },
    short: s => (s.kwh == null ? '' : `${fmtKwh(s.kwh)}`),
    cat: s => (s.kwh == null ? 'idle' : energyCat(energyDelta(s))),
  },
  productivity: {
    // เทียบ "เป้า ณ เวลาปัจจุบัน (on-time)" ไม่ใช่เป้าเต็มกะ — % จึงบอกว่า "ทันจังหวะมั้ย" แบบ real-time
    // ฟอร์แมต: ทำได้ / เป้า ณ เวลานี้ / เป้าเต็มกะ · สี = ทำได้เทียบเป้า ณ เวลานี้
    label: '📦 ยอดผลิต', worstFirst: true, facilityNA: true,
    // เป้า 0 = ไม่มี order → ไม่มี pace ให้จัดอันดับ (คืน null → ลงไปท้ายรายการ ไม่ปนกับไลน์ตกจังหวะ)
    value: s => s.target > 0 ? (s.onTimeTarget >= 1 ? Math.round(s.actual / s.onTimeTarget * 100) : 100) : null,
    // แยกให้เห็นชัด: มี order → ทำได้/เป้า ณ เวลานี้/เต็มกะ · เปิดกะแต่ยังไม่มี order · ยังไม่เปิดกะ
    // ป้ายบนผังไม่โชว์ % (2026-08-06 · คำสั่ง user "คนจะงง ชนกับ OEE") — เอาแค่ ได้/ควรได้/เป้า
    // สีของกรอบยังบอกว่าทันจังหวะไหม (cat) · % เต็มๆ ดูได้ที่ popup รายละเอียด
    text: s => s.target > 0 ? `${s.actual}/${Math.round(s.onTimeTarget)}/${s.target}` : (s.hasOpen ? '🔵 เปิดกะ · ยังไม่มี order' : '⏸ ยังไม่เปิดกะ'),
    cat: s => s.target > 0 ? (s.onTimeTarget < 1 ? 'ok' : (() => { const p = s.actual / s.onTimeTarget * 100; return p >= 95 ? 'good' : p >= 80 ? 'ok' : 'bad'; })()) : (s.hasOpen ? 'waiting' : 'idle'),
    short: s => s.target > 0 ? (s.onTimeTarget >= 1 ? `${Math.round(s.actual / s.onTimeTarget * 100)}%` : `${s.actual}`) : '',
  },
  oee: {
    label: '⚙️ OEE', worstFirst: true, facilityNA: true,
    value: s => s.oee,
    text: s => s.oee != null
      ? `OEE ${Math.round(s.oee)}%${s.oeeLive ? ' (สด)' : ''}${s.oeeCtPartial ? ' ⚠CT ไม่ครบ' : ''}${s.oeePOver ? ` ⚠%P ตัน (${Math.round(s.oeePRaw)}%)` : ''}`
      : (s.oeeNoCt ? '⚠ ยังไม่ตั้ง CT' : s.hasOpen ? 'กำลังเก็บข้อมูล...' : ''),
    short: s => s.oee != null ? `${Math.round(s.oee)}%${s.oeePOver ? '⚠' : ''}` : (s.oeeNoCt ? '⚠CT' : ''),
    cat: s => s.oee == null ? 'idle' : s.oee >= 80 ? 'good' : s.oee >= 65 ? 'ok' : 'bad',
  },
  breakdown: {
    label: '🔧 Downtime', worstFirst: true, desc: true, facilityNA: true,
    // sidebar อันดับ = สะสมทั้งวันงาน (นอกแผน + รวมเวลาที่กำลังหยุด)
    value: s => s.dtMin,
    text: s => s.dtActive ? `🔴 หยุด ${fmtDtElapsed(s.dtOpenMin)}` : s.dtMin > 0 ? `${s.dtMin} นาที` : (s.hasOpen ? 'ไม่มี' : ''),
    cat: s => s.dtActive ? 'down' : !s.hasOpen && s.dtMin === 0 ? 'idle' : s.dtMin === 0 ? 'good' : s.dtMin < 30 ? 'ok' : 'bad',
    // สีบนแผนที่ = downtime "สะสมเฉพาะชั่วโมงปัจจุบัน" (รีเซ็ตทุกต้นชั่วโมง) — ≤5น.เขียว · ≤15น.เหลือง · >15น.แดง
    //   กำลังหยุดอยู่ (ยังไม่กลับมารัน) = แดงต่อเนื่อง · เพิ่งกลับมารัน = คิดตามนาทีที่หยุดในชั่วโมงนี้
    mapCat: s => s.dtActive ? 'down' : !s.hasOpen && s.dtMinHour === 0 ? 'idle' : s.dtMinHour <= 5 ? 'good' : s.dtMinHour <= 15 ? 'ok' : 'bad',
    mapText: s => s.dtActive ? `🔴 หยุด ${fmtDtElapsed(s.dtOpenMin)}` : s.dtMinHour > 0 ? `${s.dtMinHour} น./ชม.นี้` : (s.hasOpen ? '✓ ปกติ' : ''),
    short: s => s.dtActive ? `🔴 ${fmtDtElapsed(s.dtOpenMin)}` : s.dtMinHour > 0 ? `${s.dtMinHour}น.` : '',
  },
  ng: {
    label: '🚫 ของเสีย', worstFirst: true, desc: true, facilityNA: true,
    value: s => s.ng,
    text: s => s.ng > 0 ? `NG ${s.ng}` : (s.hasOpen ? 'NG 0' : ''),
    cat: s => !s.hasOpen && s.ng === 0 ? 'idle' : s.ng === 0 ? 'good' : s.ng < 20 ? 'ok' : 'bad',
    short: s => s.ng > 0 ? `NG ${s.ng}` : '',
  },
  people: {
    // 👷 รวม "คน/เข้างาน" + "จุดงานเข้าประจำ" เป็นแท็บเดียว (2026-08-04 คำสั่ง user) —
    // ป้าย: คนมา/ทั้งหมด · จุดที่มีคนเข้าประจำ/จุดทั้งหมด · ⚠PPE — สี = ด้านที่แย่กว่า
    label: '👷 คน & จุดงาน', worstFirst: false, facilityNA: true,
    value: s => s.headTotal > 0 ? Math.round(s.present / s.headTotal * 100) : (s.stationTotal > 0 ? Math.round(s.stationFilled / s.stationTotal * 100) : null),
    text: s => {
      const parts = [];
      if (s.headTotal > 0) parts.push(`${s.present}/${s.headTotal} คน`);
      if (s.stationTotal > 0) parts.push(`${s.stationFilled}/${s.stationTotal} จุด`);
      if (s.ppeBad) parts.push(`⚠PPE ${s.ppeBad}`);
      return parts.join(' · ');
    },
    cat: s => {
      const rank = { idle: 0, good: 1, ok: 2, bad: 3 };
      const cM = s.headTotal === 0 ? 'idle' : (() => { const p = s.present / s.headTotal * 100; return p >= 95 ? 'good' : p >= 80 ? 'ok' : 'bad'; })();
      const cS = !s.stationTotal ? 'idle' : (() => { const p = s.stationFilled / s.stationTotal * 100; return p >= 90 ? 'good' : p >= 70 ? 'ok' : 'bad'; })();
      return rank[cS] > rank[cM] ? cS : cM;  // เอาด้านที่แย่กว่า
    },
    short: s => {
      if (s.headTotal > 0) return `${s.present}/${s.headTotal}${s.ppeBad ? ` ⚠${s.ppeBad}` : ''}`;
      return s.stationTotal > 0 ? `${s.stationFilled}/${s.stationTotal}` : '';
    },
  },
  /* 🛠️ PM ของ "ช่าง" เท่านั้น — AM (ผลิตตรวจเอง) ถูกแยกออกโดยตั้งใจ (คำสั่ง user 2026-08-26)
     กฎเหล็ก CLAUDE.md: AM ≠ PM คนละงาน คนละทะเบียน คนละสิทธิ์ · แยกด้วยแกนข้อมูล `mtn_teams.kind`
     ผ่าน `isAmTeam(checklists.department)` **ห้าม hardcode `department === 'production'`**
     ⚠️ AM ไม่ได้หายไปไหน — โชว์เป็นบรรทัดแยกในการ์ด hover (ห้ามซ่อนเงียบ) และมีแท็บ 🏭 AM ของตัวเอง
     ⚠️ "กำลังทำ PM อยู่วันนี้" มาจาก **แผนประสานงาน PM** (pm_coordination_*) คนละตารางกับ pm_plans
        — pm_plans บอกแค่ "ครบกำหนดเมื่อไหร่" ไม่ได้บอกว่าช่างลงมือวันไหน · ตัวนี้ชนะทุกสถานะ
        (สิ่งที่เกิดอยู่ตอนนี้สำคัญกว่าสิ่งที่ค้าง) และเป็นสีฟ้า **ไม่ใช่ alarm ห้ามกระพริบ** */
  pm: {
    label: '🛠️ PM ช่าง (Preventive)', worstFirst: true, desc: true,
    value: s => s.pmBusy ? 2000 + s.pmBusy : (s.pmTotal ? s.pmOverdue * 1000 + s.pmDueSoon : null),
    text: s => s.pmBusy ? `🔧 กำลังทำ PM วันนี้${s.pmBusyText ? ` · ${s.pmBusyText}` : ''}`
      : s.pmTotal ? (s.pmOverdue ? `⚠ เกินกำหนด ${s.pmOverdue}` : s.pmDueSoon ? `ใกล้ครบ ${s.pmDueSoon}` : `PM ปกติ (${s.pmTotal})`) : '',
    cat: s => s.pmBusy ? 'busy' : !s.pmTotal ? 'idle' : s.pmOverdue ? 'bad' : s.pmDueSoon ? 'ok' : 'good',
    short: s => s.pmBusy ? '🔧 PM' : !s.pmTotal ? '' : s.pmOverdue ? `⚠ ${s.pmOverdue}` : s.pmDueSoon ? `~${s.pmDueSoon}` : '',
  },
  /* 🏭 AM — ผลิตตรวจเครื่องเองทุกต้นกะ (checklists.department ที่ mtn_teams.kind = 'am')
     แยกแท็บจาก PM เพราะเป็นคนละงาน คนละคนรับผิดชอบ — เอามารวมนับก็ตอบไม่ได้ว่าใครต้องไปทำ */
  am: {
    label: '🏭 AM (ผลิตตรวจเอง)', worstFirst: true, desc: true,
    value: s => s.amTotal ? s.amOverdue * 1000 + s.amDueSoon : null,
    text: s => s.amTotal ? (s.amOverdue ? `⚠ เกินกำหนด ${s.amOverdue}` : s.amDueSoon ? `ใกล้ครบ ${s.amDueSoon}` : `AM ปกติ (${s.amTotal})`) : '',
    cat: s => !s.amTotal ? 'idle' : s.amOverdue ? 'bad' : s.amDueSoon ? 'ok' : 'good',
    short: s => !s.amTotal ? '' : s.amOverdue ? `⚠ ${s.amOverdue}` : s.amDueSoon ? `~${s.amDueSoon}` : '',
  },
  supply: {
    // 🔗 Supply route — ไลน์ผลิต: utility จ่ายไลน์นี้ กำลังซ่อม = กระทบ · โซน facility: เครื่องในโซน down = กระทบไลน์ที่จ่าย
    label: '🔗 Supply Route', worstFirst: true, desc: true,
    value: s => s.supList.length ? (s.supAtRisk ? 1000 + s.supList.length : s.supList.length) : null,
    text: s => {
      const feeds = s.isFac && s.supFeeds?.length ? ` → ${s.supFeeds.join(', ')}` : '';
      if (!s.supList.length) return '';
      if (s.supAtRisk) return `⚠ ${supNames(s.supList, true).join(', ')} ซ่อมอยู่${feeds}`;
      return s.isFac ? `ปกติ${feeds ? ' · จ่าย' + feeds : ''}` : `จ่ายโดย ${supNames(s.supList).join(', ')}`;
    },
    cat: s => !s.supList.length ? 'idle' : s.supAtRisk ? 'down' : 'good',
    short: s => !s.supList.length ? '' : s.supAtRisk ? '⚠ ซ่อมอยู่' : '',
  },
};

const round = (v) => Math.round(v * 100) / 100;
// convex hull (Andrew monotone chain) — ใช้วาด "กรอบแม่อัตโนมัติ" ล้อมกรอบไลน์ลูกทั้งหมด
const convexHull = (pts) => {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length <= 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const pt of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop(); lower.push(pt); }
  for (const pt of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop(); upper.push(pt); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
};
// ขยาย hull ออกจากจุดศูนย์กลางเล็กน้อย ให้เส้นประไม่ทับขอบกรอบลูกพอดี
const expandHull = (pts, f = 1.045) => {
  if (!pts.length) return pts;
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  return pts.map(([x, y]) => [Math.min(100, Math.max(0, round(cx + (x - cx) * f))), Math.min(100, Math.max(0, round(cy + (y - cy) * f)))]);
};
/* ── จัดวางป้ายไม่ให้ทับกัน (2026-08-06) ─────────────────────────────────────
   ปัญหาเดิม: ป้ายไลน์ยึด "กึ่งกลางขอบบนของกรอบ" ตายตัว ไม่มีการเลี่ยงกันเลย
   → ไลน์ที่วางติดกันบนผังจริง (Laser GOR/Assy GOR · Laser LWR/Assy LWR · Line 60/61)
     ป้ายทับกันจนอ่านไม่ออก (ป้ายกลุ่มเคยมี logic เลี่ยงอยู่ แต่ป้ายไลน์ไม่มี)

   ⚠️ แกน x เป็น % ของ "ความกว้าง" · แกน y เป็น % ของ "ความสูง" — ผังไม่ใช่จัตุรัส
      ต้องแปลง y เป็นหน่วยเดียวกับ x (หาร aspect) ก่อนคำนวณการทับ ไม่งั้นเพี้ยน
      หน่วยกลางที่ใช้ในไฟล์นี้เรียก "หน่วย N" = % ของความกว้างผัง
   ประมาณขนาดกล่องจากความยาวข้อความ (วัดของจริงตอนคำนวณ layout ไม่ได้) แล้ว
   **กำหนด width ให้ป้ายเท่าที่จองไว้** → พื้นที่ที่จองกับที่วาดจริงตรงกันเสมอ
   (pattern เดียวกับ de-overlap ป้ายประเทศใน WorldFactoryMap) */
/* การ์ด KPI พลังงาน — ขนาดคงที่ (ไม่ขึ้นกับความยาวข้อความ) เพราะเลขใหญ่ + sparkline กินที่ตายตัว
   ทีมส่งภาพอ้างอิงมา (โรงงาน 3D + การ์ด kW ลอยเหนืออุปกรณ์) → โครงการ์ด: ชื่อ / เลขใหญ่+หน่วย / %เทียบ / กราฟจิ๋ว */
const KPI_W = 152, KPI_H = 82;   // 82 = เผื่อบรรทัด A·P·Q ของการ์ด OEE (จองพื้นที่เท่ากันทุกการ์ด KPI)
const estLabelPx = (name, txt, big, plain, kpi) => {
  if (kpi) return { w: KPI_W, h: KPI_H };
  const nf = big ? 8.6 : 7.8, vf = big ? 7.4 : 7.0;   // px ต่อตัวอักษร (ตัวหนา Sarabun)
  // plain = ข้อความล้วนวางในกรอบไลน์ตัวเอง (ไม่มีการ์ด/พื้นหลัง) → เล็กกว่าเยอะ ใส่ข้อมูลได้ครบกว่า
  if (plain) return { w: Math.max(40, (name || '').length * nf, (txt || '').length * vf) + 6, h: txt ? 30 : 16 };
  return {
    w: Math.max(72, (name || '').length * nf, (txt || '').length * vf) + 22,
    h: txt ? (big ? 42 : 37) : (big ? 26 : 23),
  };
};
/** กราฟจิ๋วบนการ์ด KPI — inline SVG ไม่ใช้ lib (การ์ดเล็กมาก ลาก Recharts มาไม่คุ้ม)
 *  ต้องมีอย่างน้อย 2 จุดถึงจะเป็นเส้น · จุดเดียว = ไม่วาด (ลากเส้นแบนๆ หลอกว่า "ทรงตัว") */
const Spark = ({ data, color, w = 46, h = 16 }) => {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data), span = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / span) * h}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', overflow: 'visible' }} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
      <circle cx={w} cy={h - ((data[data.length - 1] - min) / span) * h} r="1.9" fill={color} />
    </svg>
  );
};
const boxHit = (a, b, pad = 0.35) =>
  a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
/* วางกล่องป้าย — กติกาสำคัญที่สุดคือ **ป้ายต้องอยู่ติด/ใกล้กรอบของตัวเอง**
   ลำดับ: (1) ตำแหน่งที่ติดกรอบ (บน/ล่าง/ซ้าย/ขวา + เลื่อนชิดซ้าย-ขวาตามขอบ)
          (2) ขยับออกทีละขั้น แต่ **ห้ามเกิน MAX_AWAY** — ที่ขยับออกมาจะถูกลากเส้นโยงกลับกรอบ
          (3) หาไม่เจอ: จอกว้าง = กลับไปตำแหน่งธรรมชาติ (ยอมทับนิดดีกว่าลอยหนี)
                       จอแคบ = คืน null ไม่วาด แล้วไปนับบอกบนจอ
   ⚠️ ห้ามปล่อยให้ขยับได้ไม่จำกัด — เคยดันแนวตั้งได้ถึง 12 แถว ป้ายไปโผล่ห่างกรอบตัวเอง 213px
      (user ทัก 2026-08-06 "ตำแหน่งมั่ว เด้งไปไกลจากไลน์") · วัดแล้ว MAX_AWAY 9 หน่วยคือจุดคุ้ม:
      จอ 1800px ทับ 0 · 1250px ทับ 2 · ไกลสุด ~90px (มีเส้นโยงกำกับ) */
const MAX_AWAY = 12;
const gapToBox = (b, bb) => {
  const dx = Math.max(bb.x0 - (b.x + b.w), b.x - bb.x1, 0);
  const dy = Math.max(bb.y0 - (b.y + b.h), b.y - bb.y1, 0);
  return Math.hypot(dx, dy);
};
/* วางกล่องป้าย · ข้อห้าม 2 อย่าง (คำสั่ง user 2026-08-06 "label ไม่ควรไปทับกรอบพื้นที่ของไลน์อื่น"):
     (ก) ห้ามทับป้ายใบอื่น   (ข) ห้ามทับ "กรอบพื้นที่ของไลน์อื่น" — ทับกรอบตัวเอง/ในครอบครัวได้
   ลำดับ: ตำแหน่งที่ติดกรอบตัวเอง → (ถ้าเป็นระดับข้อความสุดท้าย) ค้นหาที่ว่างรอบๆ เรียงจากใกล้ไปไกล
          จำกัด MAX_AWAY + ลากเส้นโยงกลับกรอบ → จอแคบ: ไม่วาดแล้วนับบอก · จอกว้าง: กลับที่เดิมยอมทับ
   ⚠️ ห้ามเอา "กรอบไลน์อื่น" ออกจาก obstacles — เคยเช็คแค่ป้ายชนป้าย ผลคือป้าย Assy GOR/GOR
      ไปนั่งทับกรอบ Laser GOR/LWR BAR (user ทัก) */
const placeBox = (cands, w, h, placed, maxY, bb, obstacles, allowDrop, isLast) => {
  const ok = (b) => b.x >= -0.5 && b.x + b.w <= 100.5 && b.y >= -0.5 && b.y + b.h <= maxY + 0.5
    && !placed.some(p => boxHit(b, p)) && !obstacles.some(p => boxHit(b, p, 0));
  for (const c of cands) { const b = { x: c.x, y: c.y, w, h }; if (ok(b)) return b; }
  if (!isLast) return null;                       // ยังย่อข้อความได้อีก → ลองระดับถัดไปก่อน อย่าเพิ่งย้ายป้าย
  const step = Math.max(h * 0.8, 1.2);            // ค้นหาที่ว่างรอบกรอบ เรียงจากใกล้สุด
  const near = [];
  for (let x = Math.max(0, bb.x0 - MAX_AWAY - w); x <= Math.min(100 - w, bb.x1 + MAX_AWAY); x += step) {
    for (let y = Math.max(0, bb.y0 - MAX_AWAY - h); y <= Math.min(maxY - h, bb.y1 + MAX_AWAY); y += step) {
      const b = { x, y, w, h }, d = gapToBox(b, bb);
      if (d <= MAX_AWAY) near.push({ b, d });
    }
  }
  near.sort((a, z) => a.d - z.d);
  for (const { b } of near) if (ok(b)) return b;
  if (allowDrop) return null;                     // จอแคบ: ไม่วาด แล้วไปนับบอกบนจอ
  return {                                        // จอกว้าง: กลับตำแหน่งธรรมชาติ ยอมทับดีกว่าไม่มีป้าย
    x: Math.min(Math.max(cands[0].x, 0.3), Math.max(0.3, 100 - w - 0.3)),
    y: Math.min(Math.max(cands[0].y, 0.3), Math.max(0.3, maxY - h - 0.3)),
    w, h,
  };
};
// ผังแคบกว่านี้ = ย่อข้อความบนป้าย (มือถือ/แท็บเล็ตแนวตั้ง) — PC/จอ TV กว้างกว่านี้เสมอ จึงได้ข้อมูลครบ
const COMPACT_W = 820;
const polyArea = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(a) / 2;
};
const centroid = (pts) => pts.length
  ? [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]
  : [50, 50];
// จุดยึดป้าย = กึ่งกลางแนวนอน + ขอบบนสุดของ polygon → ป้ายเกาะขอบบน ไม่ทับกลางผังไลน์ (2026-07-22)
const labelAnchor = (pts) => pts.length
  ? [(Math.min(...pts.map(p => p[0])) + Math.max(...pts.map(p => p[0]))) / 2, Math.min(...pts.map(p => p[1]))]
  : [50, 50];
const EMPTY_ST = { actual: 0, target: 0, onTimeTarget: 0, runN: 0, capN: 0, hasOpen: false, oee: null, oeeLive: false, oeeNoCt: false, oeeCtPartial: false, oeePOver: false, oeePRaw: 0, dtMin: 0, dtMinHour: 0, dtOpenMin: null, dtOpenUnknown: false, dtActive: false, ng: 0,
  headTotal: 0, present: 0, ppeBad: 0, stationTotal: 0, stationFilled: 0, pmTotal: 0, pmOverdue: 0, pmDueSoon: 0,
  amTotal: 0, amOverdue: 0, amDueSoon: 0, pmBusy: 0, pmBusyText: '',
  supList: [], supAtRisk: false };
// รวมชื่อ utility ที่จ่ายไลน์นี้ (dedup ตามเลขเครื่อง) เอาที่กำลังซ่อม (atRisk) ก่อน
// รวมชื่อ utility ที่จ่ายไลน์นี้ — dedup ตามเลขเครื่องก่อน แล้วยุบชื่อที่ซ้ำเป็น "ชื่อ ×N" (กันโชว์ชื่อเดียวซ้ำหลายรอบ)
const supNames = (list, riskOnly) => {
  const byNo = new Map();
  (list || []).filter(x => !riskOnly || x.atRisk).forEach(x => { if (!byNo.has(x.no)) byNo.set(x.no, x.name || x.no || '—'); });
  const cnt = new Map();
  [...byNo.values()].forEach(nm => cnt.set(nm, (cnt.get(nm) || 0) + 1));
  return [...cnt.entries()].map(([nm, c]) => c > 1 ? `${nm} ×${c}` : nm);
};

// setupMode=false (default, /factory-map) = display-only (ดู + popup ไม่มีปุ่มแก้ผัง)
// setupMode=true (/layout-setup แท็บภาพรวมโรงงาน) = โหมดตั้งค่า อัปโหลดรูป/วาด polygon ได้
export default function FactoryMap({ setupMode = false }) {
  const { role } = useContext(UserContext);
  const canEdit = setupMode && can('factory_map', 'edit', role);
  const navigate = useNavigate();

  const [imageUrl, setImageUrl] = useState(null);
  const [mapId, setMapId] = useState(null);
  const [regions, setRegions] = useState([]);
  const [layoutLines, setLayoutLines] = useState(() => new Set()); // ไลน์ที่มีผังพื้น (line_layouts) → คลิกเจาะดูผังพร้อมคนแบบ Dashboard
  const [lineStatus, setLineStatus] = useState({});   // production metrics (DR)
  const [manpower, setManpower] = useState({});        // คน/เข้างาน (Main)
  const [pmStatus, setPmStatus] = useState({});        // PM เครื่องจักร (DR)
  const [pmOrphan, setPmOrphan] = useState({ total: 0, overdue: 0 });  // แผน PM ที่อุปกรณ์ยังไม่ผูกไลน์ — วางบนผังไม่ได้ แต่ห้ามหายเงียบ
  const [supplyStatus, setSupplyStatus] = useState({}); // supply route: line_name → { suppliers:[{no,name,atRisk}], atRisk } (DR)
  const [facilityZones, setFacilityZones] = useState([]); // ชื่อโซน MTN/facility (pm_facility_areas + facility machine line_names) — ตัวเลือกตีกรอบ
  const [facilitySupply, setFacilitySupply] = useState({}); // zone → { machines:[{no,name,atRisk}], atRisk, feeds:[line] } (มุมมองโซน facility เอง)
  const [dieZones, setDieZones] = useState({});        // 🔨 โซนคลังแม่พิมพ์: normName → { id, name, total, mo, moPending } (DR die_storage_areas)
  const [storeZones, setStoreZones] = useState({});    // 🏬 โซนคลังสินค้า (WMS): normName → { ...zone, fill, cat, text, nameMap } (DR storage_zones)
  const [storeZoneModal, setStoreZoneModal] = useState(null); // คลิกโซนคลัง → popup รายการ MAT ในโซน
  const [energyStatus, setEnergyStatus] = useState({});  // ⚡ พลังงานรายเดือน: name → { qty, prev, cost, source } (DR · เฟส 1 กรอกมือ)
  const [energyMonth, setEnergyMonth] = useState(null);  // เดือนที่ผังกำลังโชว์ (ไม่ใช่ live — ต้องประกาศบนจอ)
  const [oeeHistRaw, setOeeHistRaw] = useState(null);    // ⚙️ ประวัติ OEE รายกะ 7 วันก่อน (สำหรับ sparkline การ์ด KPI · null = ยังไม่โหลด)
  const [energyEf, setEnergyEf] = useState(null);        // EF ของเดือนนั้น (null = ยังไม่ตั้ง → ไม่โชว์ tCO2e)
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(canEdit); // setup mode + มีสิทธิ์ → เข้าโหมดแก้เลย
  const [uploading, setUploading] = useState(false);
  const [aspect, setAspect] = useState(null);
  const [metric, setMetric] = useState('health'); // 🚦 default = ปกติ/ผิดปกติ (2026-08-26 คำสั่ง user) — เปิดมาตอบก่อนว่าทั้งโรงงานโอเคไหม
  const [showFac, setShowFac] = useState(false); // 🫥 เปิดดูโซนสนับสนุนชั่วคราวบน metric ผลิต (กดจากชิป)
  // แผงขวา: 'review' = สรุปทบทวนทั้งวัน (default · ประชุมผู้จัดการ) · 'live' = จัดอันดับสดตาม metric (เดิม)
  const [panelMode, setPanelMode] = useState('review');
  const [reviewDate, setReviewDate] = useState(reviewDefaultDate);
  const [reviewStatus, setReviewStatus] = useState({}); // line_name → full-day aggregate ของ reviewDate
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewDetail, setReviewDetail] = useState(null); // ไลน์แม่ที่คลิกดู breakdown ไลน์ย่อย (โหมด review)
  const [storyLine, setStoryLine] = useState(null);   // ไลน์ที่คลิกดู "สรุปเรื่องราวทั้งวัน" (modal หลัก)
  const [story, setStory] = useState(null);           // ข้อมูลสรุปของ storyLine
  const [storyLoading, setStoryLoading] = useState(false);
  const [oeeExplain, setOeeExplain] = useState(null); // { title, rows } — กางวิธีคิด OEE เฉลี่ยถ่วงน้ำหนัก
  // วันที่ของ modal สรุปเรื่องราว — ตั้งตอนเปิด: คลิกจากผัง (live) = วันงานปัจจุบัน · คลิกจากแถบขวา = วันที่ในกรอบ
  const [storyDate, setStoryDate] = useState(getWorkDate);
  const [highlight, setHighlight] = useState(null); // line_name ที่คลิกจาก panel (เน้นชั่วคราว)
  const [detailLine, setDetailLine] = useState(null); // ไลน์ที่คลิกเจาะดู popup รายละเอียด
  const [hoverLine, setHoverLine] = useState(null); // ไลน์ที่เม้าส์วาง (การ์ดพรีวิวลอย — เฉพาะ mouse)
  const [hoverXY, setHoverXY] = useState({ x: 0, y: 0 });
  const [, setHoverTick] = useState(0); // บังคับ reposition หลังการ์ด mount (ได้ความสูงจริง) กันตกขอบตอนเม้าส์นิ่ง

  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState([]);
  const [hoverPt, setHoverPt] = useState(null);
  const [snapFirst, setSnapFirst] = useState(false);
  const [assignFor, setAssignFor] = useState(null);
  const [assignLine, setAssignLine] = useState('');
  const [newZone, setNewZone] = useState(''); // พิมพ์ชื่อโซน MTN/facility ใหม่ (ไม่มีใน master)
  const [newZoneType, setNewZoneType] = useState('fac'); // โซนใหม่เป็นอะไร: 'fac' MTN/facility (เดิม) | 'store' โซนคลังสินค้า (สร้างทะเบียน storage_zones ให้ด้วย)
  const [newZoneKind, setNewZoneKind] = useState('fg');  // ชนิดโซนคลัง (ZONE_KINDS) เมื่อเลือก store
  const [wrapW, setWrapW] = useState(0);      // ความกว้างผังจริง (px) — แปลงขนาดป้าย px → % ตอนกันป้ายทับกัน
  /* ── ขนาดป้ายต่อเครื่อง (2026-08-25 · user: "สเกลเพี้ยนๆ พอเปิดหลายจอทีวี") ──────────────
     ต้นเหตุ: จอ TV แต่ละตัวตั้ง OS display scaling ไม่เท่ากัน (150–300%) → CSS px ใหญ่ไม่เท่ากัน
     - ผังถูกย่อให้พอดีจอ แต่ "ป้าย" คิดขนาดเป็น CSS px → สัดส่วนป้าย/ผังโตตาม scaling = ป้ายล้น/ทับกัน
     - viewport CSS แคบลง (1920@150% = 1280px) หัก rail+แผงขวาแล้ว wrapW ต่ำกว่า COMPACT_W
       → ขึ้น "จอแคบ · ซ่อนป้าย" ทั้งที่จอใหญ่มาก
     ทางแก้ที่เลือก: ให้แต่ละเครื่องปรับขนาดป้ายเอง (A− / A+) จำใน localStorage — ตั้งครั้งเดียวต่อจอ
     (แก้จาก OS ก็ได้แต่หน้างานเข้า settings จอ TV ไม่ได้/ไม่กล้า) · คู่กับปุ่มซ่อนแผงขวาคืนพื้นที่ให้ผัง */
  const [lblScale, setLblScale] = useState(() => {
    try { const v = parseFloat(localStorage.getItem('fm_lbl_scale')); return Number.isFinite(v) ? Math.min(1.6, Math.max(0.6, v)) : 1; }
    catch { return 1; }
  });
  const applyScale = (v) => {
    const nv = Math.min(1.6, Math.max(0.6, Math.round(v * 10) / 10));
    setLblScale(nv);
    try { localStorage.setItem('fm_lbl_scale', String(nv)); } catch { /* per-device pref เท่านั้น */ }
  };
  // ซ่อนแผงขวา (จอ TV เอาพื้นที่คืนให้ผัง — จำต่อเครื่อง) · ปุ่มอยู่แถบ metric
  const [panelHide, setPanelHide] = useState(() => { try { return localStorage.getItem('fm_panel_hide') === '1'; } catch { return false; } });
  const togglePanelHide = () => setPanelHide(v => { const nv = !v; try { localStorage.setItem('fm_panel_hide', nv ? '1' : '0'); } catch { /* ignore */ } return nv; });
  const wrapRef = useRef(null);
  const hoverCardRef = useRef(null); // วัดความสูงจริงของการ์ด hover เพื่อกันตกขอบ
  const dragRef = useRef(null);
  const regionsRef = useRef([]);
  // กำลังคนล่าสุด (ไลน์ → {stationFilled/stationTotal, present/headTotal}) — ใช้ปรับ "จำนวนเครื่องที่เดินได้จริง"
  // loadStatus เป็น useCallback deps แคบ อ่าน state ตรงๆ จะ stale จึงผ่าน ref เหมือน flowByLineRef
  const manpowerRef = useRef({});
  /* ไลน์ที่ "คนโหลดเข้า-ออกเอง" (machines.automation_level = manual) — เฉพาะไลน์แบบนี้เท่านั้นที่
     กำลังคนจำกัดจำนวนเครื่องที่เดินได้ · ไลน์ auto/semi-auto เครื่องเดินเองได้ คนแค่ยืนซัพพอร์ท
     (คำสั่ง user 2026-08-06) — ข้อมูลจริง: SUB APRON = manual/standalone 6 เครื่อง ·
     LASER-345/789 = auto/inline · ไม่มีข้อมูล = ไม่ปรับ (ไม่เดาแทนหน้างาน) */
  const manualLineRef = useRef({});
  /* OEE สดต่อ session ที่ loadStatus คำนวณไว้แล้ว — ให้ modal เรื่องราวรายไลน์ใช้ตัวเดียวกัน
     ⚠️ เดิม modal อ่าน `production_sessions.oee` (stamp ตอนปิดกะ) ตรงๆ → กะที่ยังเปิดขึ้น "—"
        ขณะที่การ์ด hover บนผังเดียวกันโชว์ "OEE 99% (สด)" = จอเดียวกันตอบคนละอย่าง (user ทัก 2026-08-06) */
  const liveOeeRef = useRef({});
  const flowByLineRef = useRef({}); // line_name → { flow_mode, parallel_stations } — หัก DT 1/N ใน OEE สด (loadStatus เป็น useCallback deps แคบ ใช้ ref กัน stale)
  useEffect(() => { regionsRef.current = regions; }, [regions]);

  // ─── Undo/Redo (โหมดตั้งค่า) — snapshot กรอบไลน์ทั้งชุด restore = diff แล้วเขียนย้อนลง DB ───
  const regionSnap = () => regionsRef.current.map(r => ({ ...r, points: r.points.map(p => [...p]) }));
  const applyRegionSnapshot = async (snap) => {
    const cur = regionsRef.current;
    const sM = new Map(snap.map(r => [r.id, r])), cM = new Map(cur.map(r => [r.id, r]));
    const del = cur.filter(r => !sM.has(r.id)).map(r => r.id);
    const ins = snap.filter(r => !cM.has(r.id)).map(r => ({ id: r.id, line_name: r.line_name, points: r.points }));
    const upd = snap.filter(r => { const c = cM.get(r.id); return c && (c.line_name !== r.line_name || JSON.stringify(c.points) !== JSON.stringify(r.points)); });
    try {
      if (del.length) { const { error } = await supabase.from('factory_line_regions').delete().in('id', del); if (error) throw error; }
      if (ins.length) { const { error } = await supabase.from('factory_line_regions').insert(ins); if (error) throw error; }
      for (const r of upd) { const { error } = await supabase.from('factory_line_regions').update({ line_name: r.line_name, points: r.points }).eq('id', r.id); if (error) throw error; }
    } catch (err) { toast.error('ย้อนไม่สำเร็จ: ' + err.message); return false; }
    regionsRef.current = snap;
    setRegions(snap);
    return true;
  };
  const hist = useUndoHistory({ snapOf: regionSnap, applySnapshot: applyRegionSnapshot, enabled: canEdit && editing });
  const shiftRef = useRef(false);
  const lastRawRef = useRef(null);

  const M = METRICS[metric];

  // การ์ด hover เพิ่ง mount → วัดความสูงจริงแล้ว reposition รอบเดียว (กันตกขอบตอนเม้าส์ไม่ขยับ)
  useLayoutEffect(() => { if (hoverLine) setHoverTick(t => t + 1); }, [hoverLine]);

  /* ── โหลดผัง + รูปทรง + ไลน์ ── */
  const loadMap = useCallback(async () => {
    const [{ data: fm }, { data: rg }, { data: ln }, { data: lay }] = await Promise.all([
      supabase.from('factory_map').select('id, image_url').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('factory_line_regions').select('id, line_name, points'),
      supabase.from('production_lines').select('id, name, parent_line_name').order('name'),
      supabase.from('line_layouts').select('line_name'),
    ]);
    setImageUrl(fm?.image_url || null);
    setMapId(fm?.id || null);
    setRegions((rg || []).map(r => ({ ...r, points: Array.isArray(r.points) ? r.points : [] })));
    setLines(ln || []);
    // โหมดไหลงาน/จำนวนเครื่องขนาน (best-effort — ยังไม่ apply migration 20260723 ก็ข้าม) ใช้หัก DT 1/N ใน OEE สด
    try {
      const { data: fl } = await supabase.from('production_lines').select('name, flow_mode, parallel_stations');
      const m = {}; (fl || []).forEach(l => { m[l.name] = l; });
      flowByLineRef.current = m;
    } catch { /* คอลัมน์ยังไม่มี — N=1 พฤติกรรมเดิม */ }
    setLayoutLines(new Set((lay || []).map(l => l.line_name)));
    setLoading(false);
    // โซน MTN/facility (ไม่ผูกไลน์ผลิต) — จาก pm_facility_areas + ชื่อระบบของเครื่อง facility/utility
    Promise.all([
      supabaseDR.from('pm_facility_areas').select('name').then(r => r).catch(() => ({ data: [] })),
      supabaseDR.from('machines').select('line_name, equipment_category').then(r => r).catch(() => ({ data: [] })),
    ]).then(([fa, mc]) => {
      const set = new Set((fa?.data || []).map(a => a.name).filter(Boolean));
      (mc?.data || []).forEach(m => { if (m.equipment_category && m.equipment_category !== 'production' && m.line_name) set.add(m.line_name); });
      setFacilityZones([...set].sort((a, b) => a.localeCompare(b)));
    });
    // ไลน์ไหน "คนโหลดเข้า-ออกเอง" — นับเครื่องผลิต manual เทียบ auto/semi ต่อไลน์ (query แยก + catch เอง
    // เพื่อไม่ให้ facilityZones พังถ้าคอลัมน์ automation_level ยังไม่ apply)
    supabaseDR.from('machines').select('line_name, automation_level, equipment_category').eq('is_active', true)
      .then(({ data }) => {
        const cnt = {};
        (data || []).forEach(m => {
          if (!m.line_name || (m.equipment_category && m.equipment_category !== 'production')) return;
          const c = cnt[m.line_name] || (cnt[m.line_name] = { man: 0, autoish: 0 });
          if (m.automation_level === 'manual') c.man++;
          else if (m.automation_level === 'auto' || m.automation_level === 'semi_auto') c.autoish++;
        });
        const out = {};
        Object.entries(cnt).forEach(([ln, c]) => { if (c.man || c.autoish) out[ln] = c.man > c.autoish; });
        manualLineRef.current = out;
      })
      .catch(() => { manualLineRef.current = {}; });
  }, []);
  useEffect(() => { loadMap(); }, [loadMap]);

  /* ── metric รายไลน์ (DR) — refresh 30 วิ · เก็บทุก metric ในรอบเดียว ── */
  const loadStatus = useCallback(async () => {
    const workDate = getWorkDate();
    const { data: sessions } = await supabaseDR
      // ⚠️ ต้อง select `shift` — ตัวกรองนโยบายพักเทียบ b.shift === s.shift ถ้าไม่มีจะเป็น undefined
      //    แล้วเหลือแค่ b.shift === 'both' ซึ่ง break_policies ไม่มีสักแถว = ไม่หักเวลาพักเลยทั้งระบบ
      .from('production_sessions').select('id, line_name, status, shift, oee, oee_a, oee_p, oee_q, qty_ng, ng_qty, start_time, shift_min').eq('work_date', workDate);
    if (!sessions?.length) { setLineStatus({}); return; }
    const sessIds = sessions.map(s => s.id);
    const [{ data: orders }, { data: dts }, { data: defs }, prods, breaks, kstds] = await Promise.all([
      supabaseDR.from('prod_orders').select('session_id, status, qty, qty_ok, qty_actual, qty_target, qty_ng, mat_no, opened_at').in('session_id', sessIds),
      supabaseDR.from('downtime_logs').select('session_id, duration_min, ended_at, started_at, machine_no, dr_downtime_types(category)').in('session_id', sessIds),
      // ⚠️ NG ต้องมาจาก defect_logs — prod_orders.qty_ng ไม่เคยถูกเขียนทั้งระบบ (ยืนยัน 0/6100 แถว)
      // เดิมไม่ส่ง ngQty เข้า computeLiveOee → Q สดเป็น 100% เสมอ = OEE บนผังสูงกว่าความจริงทุกไลน์ (แก้ 2026-08-05)
      supabaseDR.from('defect_logs').select('session_id, qty_ng, qty_suspect, is_trial, dr_defect_types(excl_from_q)').in('session_id', sessIds),
      // ⚡ master 3 ตัวล่างนี้ผ่าน cache (10 นาที) — เดิมดึงทั้งตารางทุก 30 วิ กิน egress ~70% ของรอบ
      //    โดยไม่ได้ความสดอะไรเพิ่ม (CT/นโยบายพัก เปลี่ยนเดือนละไม่กี่ครั้ง) ดู src/utils/masterCache.js
      cachedMaster('dr_products:ct', async () =>
        (await supabaseDR.from('dr_products').select('mat_no, cycle_time_sec, pair_mat_no, process_type')).data || []),
      cachedMaster('break_policies:active', async () =>
        (await supabaseDR.from('break_policies').select('shift, process_type, start_time, duration_min').eq('is_active', true)).data || []),
      // CT ต้องมาจาก fallback chain เดียวกับตอนปิดกะ (kanban_standards → dr_products) ไม่งั้น P สด ≠ P ที่ stamp
      cachedMaster('kanban_standards:ct', async () =>
        (await supabaseDR.from('kanban_standards').select('mat_no, dr_products(cycle_time_sec)').eq('is_active', true)).data || []),
      loadOpInfo(), // map รายการขั้นตอน (OP งานขับนัท) — collapseOps ตอนรวมยอด ไม่นับซ้ำ
    ]);
    const pairMap = {}, procMap = {};
    (prods || []).forEach(p => { if (p.pair_mat_no) pairMap[p.mat_no] = p.pair_mat_no; procMap[p.mat_no] = p.process_type; });
    const ctMap = buildCtMap({ kanbanStds: kstds || [], products: prods || [] });
    const ordBySess = {}; (orders || []).forEach(o => { (ordBySess[o.session_id] ||= []).push(o); });
    const dtBySess = {}; (dts || []).forEach(d => { (dtBySess[d.session_id] ||= []).push(d); });
    // ⚠️ Q ไม่นับ "งานทดลอง" (is_trial / ประเภทที่ตั้ง excl_from_q) — สูตรเดียวกับตอนปิดกะ
    const ngBySess = {}; (defs || []).forEach(d => { if (isTrialDefect(d)) return; ngBySess[d.session_id] = (ngBySess[d.session_id] || 0) + defectQty(d); });
    const nowMs = Date.now();
    // ต้นชั่วโมงปัจจุบัน (clock hour) — ใช้คิด downtime "สะสมเฉพาะชั่วโมงนี้" สำหรับสีบนแผนที่
    const hourStart = (() => { const d = new Date(nowMs); d.setMinutes(0, 0, 0); return d.getTime(); })();

    // OEE สด (กะยังเปิด) — util กลาง src/utils/oee.js (ใช้ร่วมกับ /oee-analytics ให้ตัวเลขตรงกัน)
    // ปิดกะแล้ว = ใช้ค่าที่ stamp ไว้เสมอ
    const liveOee = (s, os, dl) => {
      // ไลน์เครื่องขนาน (LASER-345/789 N=3): DT ที่ระบุเครื่องหักแค่ 1/N — สูตรเดียวกับ computeOEE ใน DailyReport
      const r = computeLiveOee({
        session: s, orders: os, downtimes: dl, ctMap, workDate, nowMs, ngQty: ngBySess[s.id] || 0,
        parallelN: parallelUnitsOf(flowByLineRef.current[s.line_name]),
        /* เพดานเครื่องขนาน — เฉพาะไลน์ที่ CT เป็น "ต่อเครื่อง" (parallel_machine)
           ตัวหารจริงของ P วัดจาก order window ใน util (busyMinutes) ไม่ใช่จำนวนคน
           ⚠️ เคย ship เป็น "จำนวนเครื่องที่ปรับตามกำลังคน" ซึ่งผิด — 1 คนคุมได้หลายเครื่อง
           (จำนวนคนยังใช้กับ "ควรผลิตได้ตอนนี้" (runN/capN) ตามเดิม — คนละเรื่องกับตัวหาร P)
           เคสจริง SUB APRON 05/08: คน 4 แต่ 6 พาร์ทวิ่งพร้อมกัน = 6 เครื่อง (2026-08-13) */
        parallelCap: flowModeOf(flowByLineRef.current[s.line_name]?.flow_mode) === 'parallel_machine'
          ? parallelUnitsOf(flowByLineRef.current[s.line_name]) : 1,
      });
      return r; // คืนทั้งก้อน — ต้องรู้ "สาเหตุ" ที่คำนวณไม่ได้ (noOutput vs ไม่ได้ตั้ง CT) ไม่ใช่แค่ null
    };

    const byLine = {};
    const liveBySess = {};   // session_id → OEE สด (ให้ modal ใช้ค่าเดียวกับผัง)
    sessions.forEach(s => {
      const os = ordBySess[s.id] || [];
      // นับงานคู่ RH/LH เป็น 1 คู่/stroke (ไม่บวกชิ้น LH+RH ซ้ำในภาพใหญ่) · พาร์ทเดี่ยว/ไม่ระบุ mat = บวกปกติ
      const perMat = {};
      os.forEach(o => {
        if (!o.mat_no) return;
        const e = perMat[o.mat_no] || (perMat[o.mat_no] = { mat_no: o.mat_no, target: 0, produced: 0 });
        e.target += o.qty_target ?? o.qty ?? 0;
        e.produced += o.status === 'confirmed' ? (o.qty_ok ?? o.qty ?? 0) : (o.qty_actual ?? 0);
      });
      const nullOs = os.filter(o => !o.mat_no);
      const ptot = pairAwareTotal(collapseOps(Object.values(perMat), opInfoSync()), m => pairMap[m] || null);
      const target = ptot.target + nullOs.reduce((a, o) => a + (o.qty_target ?? o.qty ?? 0), 0);
      const actual = ptot.produced + nullOs.reduce((a, o) => a + (o.status === 'confirmed' ? (o.qty_ok ?? o.qty ?? 0) : (o.qty_actual ?? 0)), 0);
      const dl = dtBySess[s.id] || [];
      // Downtime — นับเฉพาะ "นอกแผน" (planned เช่นนับสต็อก ไม่ใช่ loss) + รวมเวลาที่ "กำลังหยุด" (ยังไม่ปิด) จนถึงตอนนี้
      //   dtMin = สะสมทั้งวันงาน (ใช้ sidebar อันดับ) · dtMinHour = สะสมเฉพาะชั่วโมงปัจจุบัน (ใช้สีบนแผนที่)
      let dtMin = 0, dtMinHour = 0, dtActive = false, plannedDtMin = 0;
      /* ⏱ dtOpenMin = "หยุดมาแล้วกี่นาที" ของรายการที่ยัง**เปิดค้าง** (นานสุดในไลน์)
         ⚠️ คนละตัวกับ dtMinHour (นาทีที่เสียใน "ชั่วโมงนี้") — เดิมป้ายเขียน "🔴 หยุด 52 น."
            จาก dtMinHour ขณะที่ Dashboard/จอห้องช่างบอก 194 นาที = จอเดียวกันตอบคนละเลข
            (user ทัก 2026-08-26) · "หยุดมาแล้วกี่นาที" ต้องเป็นเลขเดียวกันทุกจอ */
      let dtOpenMin = null, dtOpenUnknown = false;
      const plannedRows = [];   // เก็บช่วงจริงไว้ clamp กับหน้าต่าง [anchor, now] ทีหลัง (ดูหมายเหตุที่ availMin)
      let plannedNoTime = 0;    // หยุดตามแผนที่ไม่มีเวลาเริ่ม — ไม่รู้ว่าตกช่วงไหน
      dl.forEach(d => {
        if (d.dr_downtime_types?.category === 'planned') {
          // หยุดตามแผน — ไม่นับเป็น loss แต่ต้องหักออกจาก "เวลาที่มีให้ผลิต" ตอนคิดว่าควรผลิตได้เท่าไหร่
          const ps = d.started_at ? new Date(d.started_at).getTime() : null;
          if (ps != null) {
            const pe = d.ended_at ? new Date(d.ended_at).getTime()
                     : d.duration_min != null ? ps + Number(d.duration_min) * 60000 : nowMs;
            plannedDtMin += Math.max(0, (Math.min(pe, nowMs) - ps) / 60000);
            plannedRows.push({ ps, pe });
          } else { plannedDtMin += Number(d.duration_min) || 0; plannedNoTime += Number(d.duration_min) || 0; }
          return;
        }
        const active = !d.ended_at && d.duration_min == null;
        if (active) dtActive = true;
        const s0 = d.started_at ? new Date(d.started_at).getTime() : null;
        if (active) {
          if (s0 != null) dtOpenMin = Math.max(dtOpenMin ?? 0, Math.round((nowMs - s0) / 60000));
          else dtOpenUnknown = true;   // ไม่รู้เวลาเริ่ม = "ไม่รู้" ห้ามตีเป็น 0
        }
        if (s0 != null) {
          const e0 = d.ended_at ? new Date(d.ended_at).getTime()
                   : active ? nowMs
                   : d.duration_min != null ? s0 + Number(d.duration_min) * 60000 : nowMs;
          dtMin += Math.max(0, (e0 - s0) / 60000);
          const ov = Math.min(e0, nowMs) - Math.max(s0, hourStart);   // ทับซ้อนกับ [ต้นชั่วโมงนี้, ตอนนี้]
          if (ov > 0) dtMinHour += ov / 60000;
        } else {
          dtMin += Number(d.duration_min) || 0;  // ไม่มี timestamp → นับเข้าสะสมทั้งวันอย่างเดียว
        }
      });
      dtMin = Math.round(dtMin); dtMinHour = Math.round(dtMinHour);
      // ── "ควรผลิตได้ ณ ตอนนี้" = เวลาที่มีให้ผลิตจริง ÷ CT · เพดาน = เป้าจากใบที่เปิด (2026-08-03 · คำสั่ง user) ──
      //   ระบบเป็น pull (ขายเท่าไหร่ ผลิตเท่านั้น) → เป้า = ใบที่เปิดแล้ว · ห้ามคาดหวังเกินที่ลูกค้าดึง
      //   เวลาที่มีให้ผลิต = ตั้งแต่ (เริ่มกะ หรือ เปิดใบแรก แล้วแต่อันหลัง) ถึงตอนนี้ − พักตามแผน − หยุดตามแผน
      //   เดิมใช้ "เป้าเต็ม × สัดส่วนเวลาของกะ" ซึ่งต่ำเกินจริงในระบบ pull (ใบทยอยเปิด เป้าเลยโตทีหลัง)
      let onTimeTarget = target, runN = 0, capN = 0;   // เครื่องที่เดินได้จริง / เต็มกำลัง (ไว้อธิบายบนจอ)
      if (s.status === 'open' && s.start_time) {
        const shiftStart = new Date(`${workDate}T${s.start_time.slice(0, 5)}:00`).getTime();
        // เปิดใบแรกช้ากว่าเริ่มกะ = เพิ่งเริ่มผลิตตอนนั้น (ก่อนหน้านั้นยังไม่มีงานให้ทำ)
        const firstOpen = os.reduce((m, o) => { const t = o.opened_at ? new Date(o.opened_at).getTime() : null; return t && (m == null || t < m) ? t : m; }, null);
        const anchor = Math.max(shiftStart, firstOpen ?? shiftStart);
        const capMs = shiftStart + (s.shift_min || 570) * 60000;   // ไม่นับเลยเวลาเลิกกะ
        let availMin = (Math.min(nowMs, capMs) - anchor) / 60000;
        // หักเวลาพักตามแผนที่ผ่านไปแล้ว — ใช้สูตรกลางจาก utils/oee.js (เดิมเขียน overlap ซ้ำที่นี่เป็นก๊อปที่ 4)
        const procOfSess = os.map(o => procMap[o.mat_no]).find(Boolean) || null;
        availMin -= policyBreakOverlapMin({
          policies: breaks, startMs: anchor, endMs: Math.min(nowMs, capMs),
          workDate, shift: s.shift, processType: procOfSess,
        });
        /* หักหยุดตามแผน — ⚠️ ต้อง clamp กับหน้าต่าง [anchor, min(now, capMs)] ก่อน
           เดิมหัก plannedDtMin ทั้งก้อน ซึ่งสะสมตั้งแต่ต้นกะ → หยุดตามแผนที่เกิด "ก่อนเปิดใบแรก"
           ถูกหักออกจากหน้าต่างที่ไม่ได้ครอบมันอยู่ → "ควรผลิตได้" ต่ำเกินจริงมาก
           (เคสหนัก: planned ≥ หน้าต่าง → availMin = 0 → guard คืน 100% คงที่ = ตัวชี้วัดตายทั้งไลน์)
           แถวที่ไม่มีเวลาเริ่ม = ไม่รู้ว่าตกช่วงไหน → ไม่หัก แต่ยังนับใน plannedDtMin สำหรับ wLoad */
        const winEndMs = Math.min(nowMs, capMs);
        availMin -= plannedRows.reduce((a, r) =>
          a + Math.max(0, (Math.min(r.pe, winEndMs) - Math.max(r.ps, anchor)) / 60000), 0);
        availMin = Math.max(0, availMin);
        // CT เฉลี่ยถ่วงตามสัดส่วนเป้าของแต่ละ mat ในกะนี้
        let ctW = 0, ctQ = 0;
        Object.values(perMat).forEach(m => { const ct = ctMap[m.mat_no] || 0; if (ct > 0 && m.target > 0) { ctW += ct * m.target; ctQ += m.target; } });
        const ctAvg = ctQ > 0 ? ctW / ctQ : 0;
        /* ⚠️ ไลน์ที่เดินหลายเครื่องขนาน กำลังผลิต = N ÷ CT ไม่ใช่ 1 ÷ CT (2026-08-06 · user ให้ตรวจ SUB APRON)
           เคสจริง SUB APRON: ผลิต 2500 แต่ระบบบอก "ควรได้ 796" → 314% ทั้งที่ของออกปกติ
           เพราะคิดเหมือนมีเครื่องเดียว (ยอดจริง = 3.14 เท่าของกำลังเครื่องเดียว)
           **ไลน์ที่เป็น parallel_machine แต่ยังไม่ตั้ง `parallel_stations` = ไม่รู้ N จริง ห้ามเดา**
           (ทะเบียนเครื่องเอามานับแทนไม่ได้ — SUB APRON ลงไว้ 14 ตัวแต่รวมจิ๊ก/โรบอทด้วย)
           → ถอยไปสูตรอัตราตามเวลา (เป้า × สัดส่วนเวลาที่ผ่านไป) ซึ่งไม่ต้องรู้ N */
        const lineCfg = flowByLineRef.current[s.line_name];
        const fullN = parallelUnitsOf(lineCfg);
        const unknownN = flowModeOf(lineCfg?.flow_mode) === 'parallel_machine' && !(Number(lineCfg?.parallel_stations) > 1);
        /* ⭐ N ที่ตั้งไว้คือ "เต็มกำลัง" — วันไหนคนไม่พอก็เดินน้อยกว่านั้น (คำสั่ง user 2026-08-06:
           "เดินได้พร้อมกัน 6 เครื่อง แต่บางทีคนไม่พอ ก็จะเดินตามที่มีกำลังคน")
           → เครื่องที่เดินได้จริง = N × สัดส่วนกำลังคนที่มาจริง (จุดงานที่มีคนเข้าประจำก่อน แล้วค่อยหัวคน)
           ตรวจกับข้อมูลจริง SUB APRON: N=6 · จุดงานมีคน 3/6 → เดินได้ 3 เครื่อง = 2388 ชิ้น
           ของออกจริง 2500 (= 3.14 เท่าของเครื่องเดียว) → ตรงกับที่โมเดลทำนาย
           ⚠️ ไม่มีข้อมูลกำลังคน (ยังไม่เช็คชื่อ/ไลน์ไม่มีจุดงาน) = ไม่ปรับ ใช้ N เต็ม — ห้ามตีเป็น 0 คน */
        const mp = manpowerRef.current[s.line_name];
        // เฉพาะไลน์ที่คนโหลดเข้า-ออกเอง · ไลน์ auto คนแค่ยืนซัพพอร์ท เครื่องเดินเองได้ ไม่ต้องหาร
        const manRatio = !(manualLineRef.current[s.line_name] === true) ? null
          // ถ่วงตามเวลาก่อน (รู้ว่าช่วงไหนเดินกี่จุด — รองรับการย้ายคนกลางกะ) แล้วค่อยดูภาพ ณ ตอนนี้
          : (mp?.stationTotal > 0 && mp.manMin > 0 && mp.winMin > 0)
            ? Math.min(1, mp.manMin / (mp.stationTotal * mp.winMin))
          : (mp?.stationTotal > 0 && mp.stationFilled > 0) ? mp.stationFilled / mp.stationTotal
          : (mp?.headTotal > 0 && mp.present > 0) ? mp.present / mp.headTotal : null;
        const parallelN = (fullN > 1 && manRatio != null)
          ? Math.max(1, Math.min(fullN, Math.round(fullN * manRatio))) : fullN;
        onTimeTarget = (ctAvg > 0 && !unknownN)
          ? Math.min(target, (availMin * 60) / ctAvg * parallelN)
          : target * Math.max(0, Math.min(1, ((nowMs - shiftStart) / 60000) / (s.shift_min || 570)));
        runN = parallelN; capN = fullN;
      }
      // ปิดกะแล้ว → ใช้ oee ที่ stamp · ยังเปิด → คำนวณสด
      const plannedDtMinAll = dl.filter(d => d.dr_downtime_types?.category === 'planned').reduce((a, d) => a + (Number(d.duration_min) || 0), 0);
      const lr = s.oee != null ? null : liveOee(s, os, dl);
      const oeeVal = s.oee != null ? Number(s.oee) : (lr && lr.oee != null ? Math.round(lr.oee) : null);
      const isLive = s.oee == null && oeeVal != null;
      if (isLive) liveBySess[s.id] = oeeVal;
      const acc = byLine[s.line_name] || { ...EMPTY_ST, oeeRows: [] };
      byLine[s.line_name] = {
        actual: acc.actual + actual, target: acc.target + target,
        onTimeTarget: acc.onTimeTarget + onTimeTarget,
        // เดินได้จริงกี่เครื่อง / เต็มกำลังกี่เครื่อง — เอาไปอธิบายบน popup ว่าทำไม "ควรได้" เท่านี้
        runN: Math.max(acc.runN || 0, runN), capN: Math.max(acc.capN || 0, capN),
        hasOpen: acc.hasOpen || s.status === 'open',
        dtMin: acc.dtMin + dtMin, dtMinHour: acc.dtMinHour + dtMinHour, dtActive: acc.dtActive || dtActive,
        dtOpenMin: dtOpenMin == null ? acc.dtOpenMin : Math.max(acc.dtOpenMin ?? 0, dtOpenMin),
        dtOpenUnknown: acc.dtOpenUnknown || dtOpenUnknown,
        // NG ยึด defect_logs (คอลัมน์ session ไม่น่าเชื่อถือ — กะเก่า column=0 ทั้งที่มี NG จริง · CLAUDE.md)
        ng: acc.ng + (ngBySess[s.id] ?? s.qty_ng ?? s.ng_qty ?? 0),
        // เฉลี่ย OEE ของไลน์ (กะเช้า+ดึก) ต้องถ่วงด้วยเวลารับภาระ ห้าม mean ธรรมดา (util กลาง oeeAvg.js)
        // เดิม oeeSum/oeeN ทำให้ผังสด กับแผงขวาโหมดทบทวน (ซึ่งถ่วงถูก) โชว์คนละเลขของไลน์เดียวกัน
        /* ⚠️ shift_min ถูกเขียนตอน "ปิดกะ" เท่านั้น → กะที่ยังเปิดเป็น null → wLoad = 0
           → wavg ข้ามแถวนั้นทั้งแถว (และไม่ตกไป plain mean เพราะมีแถวกะปิดแล้ว)
           = ทุกเย็นผังรวมโชว์ OEE ของกะเช้าที่จบไปแล้ว โดยติดป้ายว่าเป็นค่า "สด"
           ใช้ || 570 ให้ตรงกับ path แผงทบทวน (บรรทัด ~886) ที่ทำถูกอยู่แล้ว */
        /* A/P/Q แนบไปกับแถวด้วย (การ์ด KPI ต้องแตกให้เห็น — user ทัก "บอกแต่ OEE ก็ทำแต่ OEE หรอ" 2026-08-25)
           ปิดกะ = ค่า stamp · เปิดกะ = ค่าสดจาก computeLiveOee (⚠️ util คืน key ตัวใหญ่ A/P/Q)
           calcA/totalQty/ngQty = ตัวถ่วง wRun/wProd ตอน rollup (กฎ: P ถ่วง wRun · Q ถ่วง wProd) */
        oeeRows: [...(acc.oeeRows || []), ...(oeeVal != null ? [{
          oee: oeeVal, shift_min: s.shift_min || 570, plannedMin: plannedDtMinAll,
          a: s.oee != null ? (s.oee_a != null ? Number(s.oee_a) : null) : (lr?.A ?? null),
          p: s.oee != null ? (s.oee_p != null ? Number(s.oee_p) : null) : (lr?.P ?? null),
          q: s.oee != null ? (s.oee_q != null ? Number(s.oee_q) : null) : (lr?.Q ?? null),
          calcA: s.oee != null ? (s.oee_a != null ? Number(s.oee_a) : null) : (lr?.A ?? null),
          totalQty: actual, ngQty: ngBySess[s.id] || 0,
        }] : [])],
        oeeLive: acc.oeeLive || isLive,
        // ประเมิน OEE ไม่ได้เพราะยังไม่ตั้ง CT ของชิ้นงานที่ผลิต — ต้องบอกบนจอ ไม่ใช่เงียบเป็นช่องว่าง
        oeeNoCt: acc.oeeNoCt || !!(lr && lr.noCt),
        oeeCtPartial: acc.oeeCtPartial || !!(lr && !lr.noCt && lr.qtyNoCt > 0),
        /* %P ทะลุ 100 ก่อนโดน cap = งานมาตรฐานที่บันทึกมากกว่าเวลาเครื่องที่มีจริง
           → ข้อมูลมีอะไรผิด (CT / ยอดที่กรอก / เวลาเปิด-ปิดใบ / จำนวนเครื่องขนาน)
           ต้องเห็นบนจอ ห้าม cap เงียบ — เคสจริง SUB APRON โดน cap มาแล้ว 14 กะโดยไม่มีใครรู้ */
        oeePOver: acc.oeePOver || !!(lr && lr.pOver),
        oeePRaw: Math.max(acc.oeePRaw || 0, (lr && lr.pOver && lr.pRawPct) || 0),
      };
    });
    const out = {};
    Object.entries(byLine).forEach(([name, v]) => {
      const avg = wavg(v.oeeRows || [], r => r.oee, wLoad);
      out[name] = { ...v, oee: avg != null ? Math.round(avg) : null };
    });
    liveOeeRef.current = liveBySess;
    setLineStatus(out);
  }, []);
  usePolling(loadStatus, RATE.ANDON);

  /* ── ⚡ พลังงานไฟฟ้ารายเดือน (DR · เฟส 1 กรอกมือที่ /energy) ──────────────────
     ทีมสรุปว่าอยากเห็น "ค่า kWh บริเวณ Line บนผัง" ก่อน
     ⚠️ **ข้อมูลพลังงานเป็นรายเดือน ไม่ใช่ live** — ของเดิมล็อกไว้ที่ `monthKeyOf()` (เดือนปัจจุบัน)
        ค่าไฟบิลจริงมาช้าเป็นสัปดาห์ → ต้นเดือนยังไม่มีใครกรอก **ทั้งผังขึ้น "ยังไม่กรอก" ทุกกรอบ**
        ทั้งที่เดือนก่อนกรอกครบแล้ว (เจอจริง 2026-08-20: ข้อมูลอยู่ ก.ค. แต่ผังมองหา ส.ค.)
     → ถอยหาเดือนล่าสุดที่มีข้อมูลจริง (ไม่เกิน 6 เดือน) แล้ว **ประกาศเดือนที่ใช้บนหน้าจอเสมอ**
        (จอนี้เป็นจอ live ทุก metric อื่น — ไม่บอกเดือน คนจะอ่านเป็นค่าปัจจุบัน)
     ⚠️ key ต้องมี scope_kind ด้วย — ไลน์กับโซนชื่อชนกันได้ (เดิมใช้ scope_name ล้วน) */
  const loadEnergy = useCallback(async () => {
    const win = monthRange(monthKeyOf(), 7);          // 6 เดือนย้อนหลัง + เดือนปัจจุบัน
    const { data, error } = await supabaseDR.from('energy_monthly')
      .select('scope_kind, scope_name, month_key, qty, cost, source').eq('utility', 'electric')
      .gte('month_key', win[0]).lte('month_key', win[win.length - 1]);
    if (error) return;                       // ยังไม่ apply migration = metric ขึ้น "ยังไม่กรอก" ไม่พัง
    // เดือนล่าสุดที่มีตัวเลขจริงของ "จุดวัด" (ไม่นับแถวบิลทั้งโรงงานอย่างเดียว — ผังโชว์รายจุด)
    const filled = new Set((data || [])
      .filter(r => r.qty != null && r.scope_kind !== 'plant').map(r => r.month_key));
    const cur = [...win].reverse().find(mk => filled.has(mk)) || monthKeyOf();
    const prev = shiftMonth(cur, -1);
    const out = {};
    for (const r of data || []) {
      if (r.scope_kind === 'plant') continue;
      if (r.month_key !== cur && r.month_key !== prev) continue;
      const o = (out[r.scope_name] ||= { qty: null, prev: null, cost: null, source: null, series: [] });
      if (r.month_key === cur) { o.qty = Number(r.qty) || 0; o.cost = Number(r.cost) || 0; o.source = r.source; }
      else if (r.month_key === prev) o.prev = Number(r.qty) || 0;
    }
    // ชุดข้อมูลย้อนหลังสำหรับกราฟจิ๋วบนการ์ด (เรียงเก่า→ใหม่ · เดือนที่ไม่มีข้อมูล = ข้าม ไม่เติม 0)
    const seriesOf = {};
    for (const r of data || []) {
      if (r.scope_kind === 'plant' || r.qty == null || r.month_key > cur) continue;
      (seriesOf[r.scope_name] ||= []).push({ mk: r.month_key, v: Number(r.qty) || 0 });
    }
    Object.entries(seriesOf).forEach(([n, arr]) => {
      if (out[n]) out[n].series = arr.sort((a, b) => a.mk.localeCompare(b.mk)).map(x => x.v);
    });
    setEnergyMonth(cur);
    setEnergyStatus(out);
    // ⚠️ EF โหลดแยก best-effort — ยังไม่ apply migration C1 = ไม่มี tCO2e แต่ kWh ยังขึ้นปกติ
    const { data: ef } = await supabaseDR.from('energy_emission_factors')
      .select('utility_key, kg_co2e, effective_from');
    setEnergyEf(efFor('electric', cur, ef || []));
  }, []);
  useEffect(() => { loadEnergy(); }, [loadEnergy]);

  /* จุดที่กรอกค่าไฟไว้แต่ **ยังไม่ได้ตีกรอบบนผัง** = ตัวเลขหายไปเฉยๆ ไม่มีใครเห็น
     ห้ามเงียบ — ขึ้นชิปเตือนพร้อมรายชื่อ (หลักเดียวกับ "จอแคบ · ซ่อนป้าย N ไลน์") */
  const energyNoRegion = useMemo(() => {
    if (metric !== 'energy') return [];
    const drawn = new Set(regions.map(r => r.line_name));
    return Object.entries(energyStatus)
      .filter(([n, v]) => v.qty != null && !drawn.has(n)).map(([n]) => n);
  }, [metric, regions, energyStatus]);

  /* ── ⚙️ ประวัติ OEE 7 วันก่อนหน้า — sparkline + Δ บนการ์ด KPI ของ metric OEE (2026-08-25) ──
     โหลด "ครั้งเดียว" ตอนกดแท็บ OEE ครั้งแรก ไม่ poll (ค่า stamp ของกะปิดแล้วไม่เปลี่ยนระหว่างวัน — กฎ egress)
     ⚠️ ค่าเฉลี่ยรายวันต้อง wavg ถ่วง wLoad (= shift_min − plannedMin) ตามกฎ OEE → ต้องดึง planned DT ต่อกะ
     7 วัน ≈ 250 กะ ไม่มีทางถึงเพดาน 1000 แถว (ทั้งระบบเปิดกะ ~35/วัน) — chunk .in 120 ตามกฎ URL ยาว */
  const loadOeeHist = useCallback(async () => {
    const to = shiftDate(getWorkDate(), -1), from = shiftDate(getWorkDate(), -7);
    const { data: sess, error } = await supabaseDR.from('production_sessions')
      .select('id, line_name, work_date, oee, shift_min')
      .eq('status', 'closed').gte('work_date', from).lte('work_date', to).order('id').limit(1000);
    if (error) { setOeeHistRaw([]); return; }   // โหลดไม่ได้ = การ์ดไม่มี sparkline/Δ (ค่า OEE หลักยังขึ้นปกติ)
    const rows = (sess || []).filter(s => s.oee != null);
    const planned = {};
    for (let i = 0; i < rows.length; i += 120) {
      const ids = rows.slice(i, i + 120).map(s => s.id);
      const { data: dts } = await supabaseDR.from('downtime_logs')
        .select('session_id, duration_min, dr_downtime_types(category)').in('session_id', ids);
      (dts || []).forEach(r => {
        if (r.dr_downtime_types?.category === 'planned') planned[r.session_id] = (planned[r.session_id] || 0) + (Number(r.duration_min) || 0);
      });
    }
    setOeeHistRaw(rows.map(s => ({ line_name: s.line_name, work_date: s.work_date, oee: Number(s.oee), shift_min: s.shift_min, plannedMin: planned[s.id] || 0 })));
  }, []);
  useEffect(() => { if (metric === 'oee' && oeeHistRaw == null) loadOeeHist(); }, [metric, oeeHistRaw, loadOeeHist]);

  /* ── manpower รายไลน์ (Main: employees + daily_production_logs วันนี้) — refresh 60 วิ ── */
  const loadManpower = useCallback(async () => {
    const workDate = getWorkDate();
    // live = กะปัจจุบันเท่านั้น (คำสั่ง user 2026-08-04) — เดิมนับพนักงานทั้งไลน์ (ทุกทีม 2 กะ)
    // เป็นตัวหาร + present รวม log ทั้งวัน → เลขโป่ง เช่น 15/33 ทั้งที่กะนี้มี 16 คน
    const curShift = (() => { const h = new Date().getHours(); return h >= 8 && h < 20 ? 'day' : 'night'; })();
    const [{ data: emps }, { data: pls }, { data: logsAll }, { data: ws }, saRes] = await Promise.all([
      supabase.from('employees').select('id, line_id').eq('is_active', true),
      supabase.from('production_lines').select('id, name'),
      supabase.from('daily_production_logs').select('employee_id, is_present, has_helmet, has_boots, has_gloves, assigned_line, shift').eq('work_date', workDate),
      supabase.from('workstations').select('id, line_name'),
      // ประวัติเข้า-ออกจุดงาน (มีเวลาเริ่ม/จบ) — ใช้ถ่วงน้ำหนักตามเวลา ไม่ใช่ดูแค่ ณ ตอนนี้
      // เคสที่ต้องรองรับ: ต้นกะเดิน 3 เครื่อง ผ่านไป 4 ชม. ย้ายคนมาเดิน 6 เครื่อง
      supabase.from('station_assignment_logs').select('station_id, line_name, started_at, ended_at')
        .eq('work_date', workDate).then(r => r).catch(() => ({ data: [] })),
    ]);
    // log ของกะปัจจุบัน (shift null = log เก่าก่อนมีคอลัมน์ — นับรวมแบบ backward-compat)
    const logs = (logsAll || []).filter(l => !l.shift || l.shift === curShift);
    const lineOfId = {}; (pls || []).forEach(l => { lineOfId[l.id] = l.name; });
    const empLine = {}; (emps || []).forEach(e => { empLine[e.id] = lineOfId[e.line_id]; });
    // จุดงาน (workstations) ต่อไลน์ + จุดที่มีคนเข้าประจำจริง (assigned_line ของคนที่มาทำงาน)
    const stationLine = {}; const stationTotal = {};
    (ws || []).forEach(w => { stationLine[w.id] = w.line_name; if (w.line_name) stationTotal[w.line_name] = (stationTotal[w.line_name] || 0) + 1; });
    const filledSet = {}; // line_name -> Set(station id)
    logs.forEach(l => {
      if (l.is_present && l.assigned_line != null) {
        const ln = stationLine[l.assigned_line];
        if (ln) (filledSet[ln] = filledSet[ln] || new Set()).add(l.assigned_line);
      }
    });
    const out = {};
    // ตัวหาร = คนที่ถูกเช็คชื่อในกะนี้ (มา+ขาด+ลา) ไม่ใช่พนักงานทั้งไลน์ — ตรงกับหน้าเช็คชื่อ
    logs.forEach(l => {
      const ln = empLine[l.employee_id]; if (!ln) return;
      const o = out[ln] || { headTotal: 0, present: 0, ppeBad: 0, stationTotal: 0, stationFilled: 0 };
      o.headTotal++;
      if (l.is_present) { o.present++; if (!(l.has_helmet && l.has_boots && l.has_gloves)) o.ppeBad++; }
      out[ln] = o;
    });
    // เติมจำนวนจุดงาน/จุดที่มีคน (รวมไลน์ที่ไม่มีพนักงานสังกัดแต่มี workstations)
    Object.keys(stationTotal).forEach(ln => {
      const o = out[ln] || { headTotal: 0, present: 0, ppeBad: 0, stationTotal: 0, stationFilled: 0 };
      o.stationTotal = stationTotal[ln];
      o.stationFilled = filledSet[ln]?.size || 0;
      out[ln] = o;
    });
    /* ── กำลังคนถ่วงตามเวลา (คนย้ายจุดกลางกะ) ──────────────────────────────
       เดิมใช้ภาพ ณ ตอนนี้คูณกับเวลาทั้งกะ → ถ้าเช้าเดิน 3 เครื่อง แล้วบ่ายย้ายมาเดิน 6
       จะคิดเป็น 6 ทั้งกะ (คาดหวังสูงเกิน) · ตอนนี้รวม "นาที-จุดงาน" ที่มีคนอยู่จริง
       ตั้งแต่ต้นกะถึงตอนนี้ แล้วหารด้วย (จำนวนจุดงาน × นาทีที่ผ่านไป) */
    const nowT = Date.now();
    const shiftStartT = (() => {
      const d = new Date(); d.setHours(curShift === 'day' ? 8 : 20, 0, 0, 0);
      if (curShift === 'night' && d.getTime() > nowT) d.setDate(d.getDate() - 1);   // ตี 1 = กะดึกที่เริ่มเมื่อวาน
      return d.getTime();
    })();
    const winMin = Math.max(1, (nowT - shiftStartT) / 60000);
    const manMin = {};
    (saRes?.data || []).forEach(a => {
      if (!a.line_name || !a.started_at) return;
      const st = Math.max(new Date(a.started_at).getTime(), shiftStartT);
      const en = Math.min(a.ended_at ? new Date(a.ended_at).getTime() : nowT, nowT);
      if (en > st) manMin[a.line_name] = (manMin[a.line_name] || 0) + (en - st) / 60000;
    });
    Object.keys(out).forEach(ln => { out[ln].manMin = manMin[ln] || 0; out[ln].winMin = winMin; });
    Object.entries(manMin).forEach(([ln, v]) => {
      if (!out[ln]) out[ln] = { headTotal: 0, present: 0, ppeBad: 0, stationTotal: 0, stationFilled: 0, manMin: v, winMin };
    });
    manpowerRef.current = out;
    setManpower(out);
  }, []);
  usePolling(loadManpower, RATE.BOARD);

  /* ── PM เครื่องจักรรายไลน์ (DR: checklists → **jigs** → pm_plans) — refresh 30 นาที ──
     🔴 บั๊กที่แก้ 2026-08-26 (user: "PM ยังไม่ขึ้นหน้าแดชบอร์ดผังโรงงาน"):
        เดิมเขียน `.in('equipment_id', machines.map(m => m.id))` — แต่ **`checklists.equipment_id`
        ชี้ไป `jigs.id` ไม่ใช่ `machines.id`** (กฎ: `jigs` คือทะเบียน "อุปกรณ์ที่มีแผน PM"
        เครื่องจักรมี "แถวเงา" ใน jigs ที่ `machine_id` ชี้กลับ machines)
        ⇒ เทียบ uuid คนละตาราง = ไม่แมตช์สักแถว → `cls` ว่าง → `setPmStatus({})`
          → ทุกไลน์ขึ้น "—" ตลอดกาล **ทั้งที่มีแผน PM เกินกำหนดอยู่จริง**
        (`/dept-dashboard` และ edge `pm-plan-reminder` ทำถูกอยู่แล้ว — จอผังตกสำรวจจุดเดียว)
     ⚠️ ไลน์เอาจาก `jigs.line_name` ก่อน (เป็นของอุปกรณ์ตัวนั้นเอง) ไม่มีค่อยถอยไปไลน์ของเครื่องที่ผูก
     ⚠️ query ล้มเหลว = **คงค่าเดิมไว้ ห้ามล้างเป็น {}** (ล้างแล้วจอบอก "ไม่มีแผน PM" ซึ่งเป็นคำตอบผิด) */
  const loadPM = useCallback(async () => {
    await loadPmTeams().catch(() => {});   // ให้ isAmTeam อ่าน mtn_teams.kind ได้จริง (โหลดพลาด = fallback เดาจาก key)
    const { data: cls, error: clErr } = await supabaseDR.from('checklists').select('id, equipment_id, department').eq('module', 'mtn');
    if (clErr) { console.warn('loadPM checklists', clErr.message); return; }
    const eqIds = [...new Set((cls || []).map(c => c.equipment_id).filter(Boolean))];
    if (!eqIds.length) { setPmStatus({}); return; }
    /* ⚠️ ผ่าน fetchByIds เสมอ — checklists/jigs หลักร้อยแถว `.in()` ตรงๆ URL ยาวเกินจน proxy ตัด
       แล้วคืนค่าว่าง "เงียบ" (บทเรียนเดิม: จอโชว์ 0 ทั้งที่มีของจริง) */
    const [jgRes, machines] = await Promise.all([
      fetchByIds(eqIds, c => supabaseDR.from('jigs').select('id, line_name, machine_id').in('id', c)),
      cachedMaster('machines:idline', async () =>
        (await supabaseDR.from('machines').select('id, line_name').eq('is_active', true)).data || []),
    ]);
    if (jgRes.error) { console.warn('loadPM jigs', jgRes.error); return; }
    const lineOfMachine = {}; (machines || []).forEach(m => { lineOfMachine[m.id] = m.line_name; });
    const lineOfEq = {}; jgRes.rows.forEach(j => { lineOfEq[j.id] = j.line_name || lineOfMachine[j.machine_id] || ''; });
    const lineOfChecklist = {}; (cls || []).forEach(c => { lineOfChecklist[c.id] = lineOfEq[c.equipment_id]; });
    /* แยก AM / PM ด้วยแกนข้อมูล `mtn_teams.kind` — ห้าม hardcode `department === 'production'`
       (กฎเหล็ก: แยก AM รายส่วนงาน/rollout โรงงานที่เรียกทีมคนละชื่อ แล้วจะพังเงียบ) */
    const amOfChecklist = {}; (cls || []).forEach(c => { amOfChecklist[c.id] = isAmTeam(c.department); });
    const plRes = await fetchByIds((cls || []).map(c => c.id),
      c => supabaseDR.from('pm_plans').select('checklist_id, next_due_date').eq('is_active', true).in('checklist_id', c));
    if (plRes.error) { console.warn('loadPM plans', plRes.error); return; }
    const plans = plRes.rows;
    const now = new Date(); const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const soon = new Date(now.getTime() + 7 * 864e5); const soonStr = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
    const out = {};
    /* ⚠️ อุปกรณ์ที่ยังไม่ได้ผูกไลน์ = วางบนผังไม่ได้ **แต่ห้ามทิ้งเงียบ** — โดยเฉพาะตัวที่เกินกำหนด
       (แผน PM ที่ไม่รู้ว่าอยู่ไลน์ไหน จะหายจากทุกจอที่จัดกลุ่มตามไลน์) → นับไว้โชว์เป็นชิป */
    const orphan = { total: 0, overdue: 0 };
    const blank = () => ({ pmTotal: 0, pmOverdue: 0, pmDueSoon: 0, amTotal: 0, amOverdue: 0, amDueSoon: 0, pmBusy: 0, pmBusyText: '' });
    (plans || []).forEach(p => {
      const overdue = p.next_due_date && p.next_due_date < today;
      const ln = lineOfChecklist[p.checklist_id];
      if (!ln) { orphan.total++; if (overdue) orphan.overdue++; return; }
      const o = out[ln] || blank();
      const k = amOfChecklist[p.checklist_id] ? 'am' : 'pm';
      o[`${k}Total`]++;
      if (overdue) o[`${k}Overdue`]++;
      else if (p.next_due_date && p.next_due_date <= soonStr) o[`${k}DueSoon`]++;
      out[ln] = o;
    });
    setPmOrphan(orphan);

    /* 🔧 "กำลังทำ PM อยู่วันนี้" — จาก **แผนประสานงาน PM** (คนละตารางกับ pm_plans)
       pm_plans บอกแค่ "ครบกำหนดเมื่อไหร่" · ตัวที่บอกว่า *ช่างลงมือวันไหน* คือ pm_coordination_tasks
       ⇒ ไม่ดึงตัวนี้ = ผังขึ้น "PM ปกติ" เขียวทั้งที่ MTN ยืนทำ PM อยู่หน้าเครื่อง (user เจอจริง 26/08)
       ⚠️ best-effort — ล้มเหลวห้ามลาก metric PM พังทั้งตัว (แค่ไม่มีสถานะ "กำลังทำ") */
    try {
      const { data: coPlans } = await supabaseDR.from('pm_coordination_plans')
        .select('id, line_name, title, machine_no, status').not('status', 'in', '("done","cancelled")');
      const planById = {}; (coPlans || []).forEach(pl => { planById[pl.id] = pl; });
      if (coPlans?.length) {
        const tkRes = await fetchByIds(coPlans.map(pl => pl.id),
          c => supabaseDR.from('pm_coordination_tasks').select('plan_id, task_date, done').in('plan_id', c));
        /* ⚠️ "กำลังทำ PM" = **วันนี้อยู่ในช่วงงานของแผนที่ยังไม่ปิด** ไม่ใช่แค่ "มีขั้นงานลงวันนี้"
           งาน PM กินหลายวัน (เจอจริง: PM LASER LS-07 วิ่ง 26→28/08) ระหว่างนั้นเครื่องอยู่ในมือช่างตลอด
           — เช็คเฉพาะขั้นที่ลงวันนี้ จะเงียบในวันที่ขั้นนั้นถูกติ๊กเสร็จไปแล้ว ทั้งที่งานยังไม่จบ
           (วันที่เป็น 'YYYY-MM-DD' เทียบสตริงตรงกับเทียบเวลาอยู่แล้ว) */
        const byPlan = {};
        (tkRes.rows || []).forEach(t => {
          if (!t.task_date) return;
          const g = byPlan[t.plan_id] || (byPlan[t.plan_id] = { min: t.task_date, max: t.task_date, left: 0 });
          if (t.task_date < g.min) g.min = t.task_date;
          if (t.task_date > g.max) g.max = t.task_date;
          if (!t.done) g.left++;
        });
        Object.entries(byPlan).forEach(([pid, g]) => {
          if (g.min > today || g.max < today) return;         // นอกช่วงงาน = ไม่ใช่ "กำลังทำ"
          const pl = planById[pid]; const ln = pl?.line_name; if (!ln) return;
          const o = out[ln] || blank();
          o.pmBusy++;
          if (!o.pmBusyText) o.pmBusyText = [pl.machine_no, pl.title].filter(Boolean).join(' · ')
            + (g.left ? ` (เหลือ ${g.left} ขั้น)` : '');
          out[ln] = o;
        });
      }
    } catch (e) { console.warn('loadPM coordination', e?.message || e); }
    setPmStatus(out);
  }, []);
  usePolling(loadPM, RATE.SLOW);

  /* ── Supply route (DR: facility_supply_links + machines + open MO) — refresh 30 วิ ──
     utility/facility จ่ายไลน์ไหน · ถ้ามีใบซ่อม (MO) เปิดค้างบนเครื่องนั้น = ไลน์ที่จ่ายกระทบ (แดง) */
  const loadSupply = useCallback(async () => {
    // ⚡ links/machines เป็น master (เปลี่ยนนานๆ ครั้ง) → cache · เหลือแต่ใบซ่อมที่ต้องสดจริง
    //    และกรอง "ใบที่ยังไม่ปิด" ฝั่ง server — เดิมดึง mtn_orders ทั้งตารางมากรองในเบราว์เซอร์
    const [linkRows, machineRows, mos] = await Promise.all([
      cachedMaster('facility_supply_links', async () =>
        (await supabaseDR.from('facility_supply_links').select('machine_id, line_name')).data || []),
      cachedMaster('machines:supply', async () =>
        (await supabaseDR.from('machines').select('id, machine_no, machine_name, line_name, equipment_category')).data || []),
      supabaseDR.from('mtn_orders').select('machine_no')
        .not('status', 'in', '("closed","rejected")').then(r => r, () => ({ data: [] })),
    ]);
    const mcRows = machineRows || [];
    const byId = {}; mcRows.forEach(m => { byId[m.id] = m; });
    const openNos = new Set((mos?.data || []).map(o => o.machine_no));
    // (ก) มุมมองไลน์ผลิต: utility จ่ายไลน์นี้ กำลังซ่อม = กระทบ (เดิม)
    const out = {};
    linkRows.forEach(l => {
      const mc = byId[l.machine_id]; if (!mc) return;
      const atRisk = openNos.has(mc.machine_no);
      const o = out[l.line_name] || { suppliers: [], atRisk: false };
      o.suppliers.push({ no: mc.machine_no, name: mc.machine_name, atRisk });
      if (atRisk) o.atRisk = true;
      out[l.line_name] = o;
    });
    setSupplyStatus(out);
    // (ข) มุมมองโซน facility เอง: เครื่องในโซนนี้ down (open MO) มั้ย + จ่ายให้ไลน์ไหนบ้าง
    const feedsByMachine = {}; linkRows.forEach(l => { (feedsByMachine[l.machine_id] ||= []).push(l.line_name); });
    const fac = {};
    mcRows.forEach(m => {
      if (!m.equipment_category || m.equipment_category === 'production' || !m.line_name) return;
      const atRisk = openNos.has(m.machine_no);
      const o = fac[m.line_name] || { machines: [], atRisk: false, feeds: new Set() };
      o.machines.push({ no: m.machine_no, name: m.machine_name, atRisk });
      (feedsByMachine[m.id] || []).forEach(ln => o.feeds.add(ln));
      if (atRisk) o.atRisk = true;
      fac[m.line_name] = o;
    });
    Object.values(fac).forEach(o => { o.feeds = [...o.feeds]; });
    setFacilitySupply(fac);
  }, []);
  usePolling(loadSupply, RATE.ANDON);

  /* ── 🔨 โซนคลังแม่พิมพ์ — link ผังรวม ↔ ผังจัดเก็บแม่พิมพ์ (/die-registry?tab=layout · 2026-08-19) ──
     กรอบบนผังรวมที่ "ชื่อตรงกับชื่อผังจัดเก็บแม่พิมพ์" (die_storage_areas.name · จับคู่ normalize
     trim+lowercase) = โซนคลังแม่พิมพ์ — pattern เดียวกับโซน facility ↔ pm_facility_areas
     (ข้าม project Main↔DR ทำ FK ไม่ได้ ชื่อคือกุญแจ — เปลี่ยนชื่อผังใน DieLayout จะ cascade ชื่อกรอบให้)
     health: แม่พิมพ์ในโซนมีใบซ่อม MO ค้าง → แดง (รอรับงาน = กระพริบ) · ปกติ = เขียว + จำนวนตัว */
  const loadDieZones = useCallback(async () => {
    const { data: areas, error } = await supabaseDR.from('die_storage_areas').select('id, name').eq('is_active', true);
    if (error || !areas?.length) { setDieZones({}); return; }   // ยังไม่ apply migration 20260819 / ยังไม่มีผัง = ไม่มีโซน
    const [{ data: exts }, { data: dieRows }, { data: mos }] = await Promise.all([
      supabaseDR.from('equipment_die').select('machine_id, area_id').not('area_id', 'is', null),
      supabaseDR.from('machines').select('id, machine_no').eq('equipment_kind', 'die'),
      supabaseDR.from('mtn_orders').select('machine_no, status').in('status', OPEN_MO_STATUSES),
    ]);
    const normNo = (s) => String(s || '').trim().toUpperCase();
    const noById = {}; (dieRows || []).forEach(m => { noById[m.id] = normNo(m.machine_no); });
    const moByNo = {}; (mos || []).forEach(o => { const k = normNo(o.machine_no); if (k) (moByNo[k] ||= []).push(o); });
    const byArea = {}; (exts || []).forEach(e => { (byArea[e.area_id] ||= []).push(e.machine_id); });
    const out = {};
    areas.forEach(a => {
      const ids = byArea[a.id] || [];
      let mo = 0, moPending = 0;
      ids.forEach(id => {
        const list = moByNo[noById[id]] || [];
        if (list.length) { mo++; if (list.some(o => o.status === 'pending')) moPending++; }
      });
      out[String(a.name || '').trim().toLowerCase()] = { id: a.id, name: a.name, total: ids.length, mo, moPending };
    });
    setDieZones(out);
  }, []);
  usePolling(loadDieZones, RATE.ANALYTIC);
  const dieZoneOf = (name) => dieZones[String(name || '').trim().toLowerCase()] || null;

  /* ── 🏬 โซนคลังสินค้า (WMS เฟส 1 · 2026-08-25) — link ผังรวม ↔ ทะเบียนโซนใน /line-stock ──
     กรอบที่ "ชื่อตรงกับ storage_zones.name" = โซนคลัง (ชื่อคือกุญแจ trim+lowercase — pattern เดียวกับ die)
     สถานะคำนวณสดจากสต็อกจริง: line_stock_summary คลังกลาง (FG WAREHOUSE/STORE) ของ MAT ที่ผูกกับโซน
     + kanban min/max + ขนาดกล่อง (parts_master.qty_per_pkg ‖ kanban_standards.qty_per_kanban)
     สูตร เต็ม/ขาด/นับกล่อง อยู่ src/utils/storageZones.js ที่เดียว — ห้ามเขียนซ้ำในหน้า
     ⚠️ เฟส 1 ยอดเป็น "ยอดรวมของ MAT ในคลังกลาง" ไม่ใช่ยอดรายโซนจริง (ledger ยังไม่รู้จักโซน) — popup บอกกำกับ */
  const loadStoreZones = useCallback(async () => {
    const { data: zs, error } = await supabaseDR.from('storage_zones')
      .select('id, name, kind, capacity_pkg, mat_nos, note').eq('is_active', true);
    if (error || !zs?.length) { setStoreZones({}); return; }   // ยังไม่ apply migration 20260825 / ยังไม่มีโซน = เงียบ (ฟีเจอร์ opt-in)
    const mats = [...new Set(zs.flatMap(z => z.mat_nos || []))];
    const stock = {}, pkgMap = {}, stdMap = {}, nameMap = {};
    for (let i = 0; i < mats.length; i += 120) {               // กฎ .in() แบ่งก้อนละ 120
      const c = mats.slice(i, i + 120);
      const [{ data: st }, { data: pm }, { data: ks }] = await Promise.all([
        supabaseDR.from('line_stock_summary').select('mat_no, qty_on_hand').in('line_name', WAREHOUSE_LOCATIONS).in('mat_no', c),
        supabaseDR.from('parts_master').select('mat_no, part_name, qty_per_pkg').in('mat_no', c), // ⚠️ คอลัมน์คือ part_name ไม่ใช่ name (42703 เงียบ)
        supabaseDR.from('kanban_standards').select('mat_no, min_qty, max_qty, qty_per_kanban').eq('is_active', true).in('mat_no', c),
      ]);
      (st || []).forEach(r => { stock[r.mat_no] = (stock[r.mat_no] || 0) + (Number(r.qty_on_hand) || 0); });
      (pm || []).forEach(p => { pkgMap[p.mat_no] = p.qty_per_pkg; nameMap[p.mat_no] = p.part_name; });
      (ks || []).forEach(k => { stdMap[k.mat_no] = k; });
    }
    const pkgOf = (m) => Number(pkgMap[m]) || Number(stdMap[m]?.qty_per_kanban) || null; // ไม่รู้ = null ห้ามเป็น 0
    const stdOf = (m) => stdMap[m] || null;
    const out = {};
    zs.forEach(z => {
      const fill = zoneFill(z, stock, pkgOf, stdOf);
      out[String(z.name || '').trim().toLowerCase()] = {
        ...z, fill, cat: zoneHealth(fill), text: `${zoneKindMeta(z.kind).icon} ${zoneHealthText(fill)}`, nameMap,
      };
    });
    setStoreZones(out);
  }, []);
  usePolling(loadStoreZones, RATE.ANALYTIC);
  const storeZoneOf = (name) => storeZones[String(name || '').trim().toLowerCase()] || null;

  /* ── Realtime — ผังเปลี่ยนสี "ทันที" ที่หน้างานบันทึก ไม่ต้องรอรอบ poll (2026-08-19) ────
     เดิมหน้านี้เป็น polling ล้วน (0 channel) เลยต้องตั้ง 30 วิ เพื่อให้ Andon ทัน = กิน egress หนัก
     ตอนนี้ push มาก่อน · poll เหลือเป็นแค่ "กันเหนียวเผื่อ realtime หลุด" → ยืดเป็นหลักนาทีได้
     ⚠️ debounce 1.5 วิ กัน event รัวตอนสแกนปิดใบหลายใบติดกัน (pattern เดียวกับ Dashboard)
     ⚠️ ผังแดงเร็วกว่าเดิมด้วยซ้ำ — การ "แจ้งเตือน" จริง (Telegram/ไซเรน) เป็นคนละกลไก
        (edge `downtime-open-scan` pg_cron ทุก 5 นาที ยิงเมื่อค้างเกิน `dt_alert_config.open_alert_min`)  */
  useEffect(() => {
    let timer = null;
    const bump = (fn) => { clearTimeout(timer); timer = setTimeout(fn, 1500); };
    const ch = supabaseDR.channel('factory-map-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'downtime_logs' },       () => bump(loadStatus))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prod_orders' },         () => bump(loadStatus))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'defect_logs' },         () => bump(loadStatus))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_sessions' }, () => bump(loadStatus))
      // mtn_orders กระทบทั้ง supply route และโซนคลังแม่พิมพ์ (MO ค้างของแม่พิมพ์) — refresh คู่กัน
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mtn_orders' },          () => bump(() => { loadSupply(); loadDieZones(); }))
      .subscribe();
    return () => { clearTimeout(timer); supabaseDR.removeChannel(ch); };
  }, [loadStatus, loadSupply, loadDieZones]);

  /* ── สรุปทบทวนทั้งวัน (กะเช้า+ดึก) ตาม reviewDate — โหลดเมื่อเปลี่ยนวัน/เข้าโหมด review (ไม่ auto refresh) ──
     ต่างจากผังที่โชว์สด: แผงนี้ใช้ค่าที่ปิดกะแล้ว (OEE ที่ stamp, DT/NG/ผลิตทั้งวัน) ไว้ประชุมผู้จัดการ */
  const loadReview = useCallback(async () => {
    setReviewLoading(true);
    try {
      const [{ data: sessions }, empRes, plRes, logRes] = await Promise.all([
        // ⚠️ ต้องมี `shift` — ตาราง "กางวิธีคิด OEE" (oeeRows) โชว์กะ ถ้าไม่ select จะขึ้น "—" ทุกแถว
        //    ซึ่งเป็นแผงที่มีไว้ตอบคำถาม "ทำไมบวกหารแล้วไม่ตรง" โดยเฉพาะ (กะเช้า/ดึกแยกไม่ออก)
        supabaseDR.from('production_sessions').select('id, line_name, status, shift, oee, qty_ng, ng_qty, shift_min').eq('work_date', reviewDate),
        supabase.from('employees').select('id, line_id').eq('is_active', true),
        supabase.from('production_lines').select('id, name'),
        supabase.from('daily_production_logs').select('employee_id, is_present').eq('work_date', reviewDate),
      ]);
      const out = {};
      // oeeWSum/oeeWLoad = ถ่วงน้ำหนักด้วยเวลารับภาระ (กฎ OEE: ห้าม mean-of-percentages) · oeeSum/oeeN = fallback เมื่อไม่มีน้ำหนัก
      const ensure = (ln) => (out[ln] || (out[ln] = { actual: 0, target: 0, oeeWSum: 0, oeeWLoad: 0, oeeSum: 0, oeeN: 0, dtMin: 0, ng: 0, present: 0, headTotal: 0, oeeRows: [] }));
      // คนเข้างานของวันนั้น (map พนักงาน→ไลน์ ปัจจุบัน — ยอมรับได้สำหรับทบทวนย้อนหลัง)
      const lineOfId = {}; (plRes.data || []).forEach(l => { lineOfId[l.id] = l.name; });
      const presentSet = new Set((logRes.data || []).filter(l => l.is_present).map(l => l.employee_id));
      (empRes.data || []).forEach(e => {
        const ln = lineOfId[e.line_id]; if (!ln) return;
        const o = ensure(ln); o.headTotal++; if (presentSet.has(e.id)) o.present++;
      });
      if (sessions?.length) {
        const sessIds = sessions.map(s => s.id);
        const [{ data: orders }, { data: dts }, { data: rvDefs }, { data: prods }] = await Promise.all([
          supabaseDR.from('prod_orders').select('session_id, status, qty, qty_ok, qty_actual, qty_target, mat_no').in('session_id', sessIds),
          supabaseDR.from('downtime_logs').select('session_id, duration_min, started_at, ended_at, dr_downtime_types(category)').in('session_id', sessIds),
          supabaseDR.from('defect_logs').select('session_id, qty_ng, qty_suspect').in('session_id', sessIds),
          supabaseDR.from('dr_products').select('mat_no, pair_mat_no'),
        ]);
        const rvNgBySess = {}; (rvDefs || []).forEach(d => { rvNgBySess[d.session_id] = (rvNgBySess[d.session_id] || 0) + (Number(d.qty_ng) || 0) + (Number(d.qty_suspect) || 0); });
        const pairMap = {}; (prods || []).forEach(p => { if (p.pair_mat_no) pairMap[p.mat_no] = p.pair_mat_no; });
        const ordBySess = {}; (orders || []).forEach(o => { (ordBySess[o.session_id] ||= []).push(o); });
        const dtBySess = {}; (dts || []).forEach(d => { (dtBySess[d.session_id] ||= []).push(d); });
        await loadOpInfo(); // map รายการขั้นตอน (OP) — cache แล้วถูก ไม่ยิงซ้ำ
        sessions.forEach(s => {
          const o = ensure(s.line_name);
          const os = ordBySess[s.id] || [];
          // นับงานคู่ RH/LH เป็น 1 คู่/stroke เหมือนภาพใหญ่ (pairAwareTotal)
          const perMat = {};
          os.forEach(od => {
            if (!od.mat_no) return;
            const e = perMat[od.mat_no] || (perMat[od.mat_no] = { mat_no: od.mat_no, target: 0, produced: 0 });
            e.target += od.qty_target ?? od.qty ?? 0;
            e.produced += od.status === 'confirmed' ? (od.qty_ok ?? od.qty ?? 0) : (od.qty_actual ?? 0);
          });
          const nullOs = os.filter(od => !od.mat_no);
          const ptot = pairAwareTotal(collapseOps(Object.values(perMat), opInfoSync()), m => pairMap[m] || null);
          o.target += ptot.target + nullOs.reduce((a, od) => a + (od.qty_target ?? od.qty ?? 0), 0);
          o.actual += ptot.produced + nullOs.reduce((a, od) => a + (od.status === 'confirmed' ? (od.qty_ok ?? od.qty ?? 0) : (od.qty_actual ?? 0)), 0);
          // Downtime นอกแผนทั้งวัน (dtMin) + เวลาที่วางแผนหยุด (plannedMin) สำหรับถ่วงน้ำหนัก OEE
          let plannedMin = 0;
          (dtBySess[s.id] || []).forEach(d => {
            const mins = d.duration_min != null ? (Number(d.duration_min) || 0)
              : (d.started_at && d.ended_at ? Math.max(0, (new Date(d.ended_at) - new Date(d.started_at)) / 60000) : 0);
            if (d.dr_downtime_types?.category === 'planned') plannedMin += mins;
            else o.dtMin += mins;
          });
          o.ng += rvNgBySess[s.id] ?? s.qty_ng ?? s.ng_qty ?? 0;   // NG ยึด defect_logs (คอลัมน์ session ไม่น่าเชื่อถือ)
          // OEE ถ่วงด้วย "เวลารับภาระ" (shift_min − plannedMin) ตามกฎถ่วงน้ำหนัก OEE
          if (s.oee != null) {
            const wLoad = Math.max(0, (s.shift_min || 570) - plannedMin);
            o.oeeWSum += Number(s.oee) * wLoad; o.oeeWLoad += wLoad;
            o.oeeSum += Number(s.oee); o.oeeN++;
            // เก็บรายกะไว้กางอธิบายวิธีคิดค่าเฉลี่ยถ่วงน้ำหนักบนจอ (ตอบคำถาม "ทำไมบวกหารแล้วไม่ตรง")
            o.oeeRows.push({ line: s.line_name, shift: s.shift, oee: Number(s.oee), w: wLoad, shiftMin: s.shift_min || 570, planned: Math.round(plannedMin) });
          }
        });
      }
      Object.values(out).forEach(o => { o.dtMin = Math.round(o.dtMin); o.oee = o.oeeWLoad > 0 ? Math.round(o.oeeWSum / o.oeeWLoad) : (o.oeeN ? Math.round(o.oeeSum / o.oeeN) : null); });
      setReviewStatus(out);
    } catch { setReviewStatus({}); }
    finally { setReviewLoading(false); }
  }, [reviewDate]);
  useEffect(() => { if (panelMode === 'review' && !editing) loadReview(); }, [loadReview, panelMode, editing]);

  /* ── สรุปเรื่องราวทั้งวันของไลน์ที่คลิก (modal) — ผลิตรายพาร์ท · Downtime+เหตุผล · ของเสีย · 4M · คน ──
     วันที่ = วันที่ของแผงทบทวน (โหมด review) หรือวันงานปัจจุบัน (โหมดสด) · โหลดเมื่อเปิด modal เท่านั้น */
  useEffect(() => {
    if (!storyLine) { setStory(null); return; }
    let cancelled = false;
    (async () => {
      setStoryLoading(true);
      const fam = familyNames(storyLine);
      try {
        const { data: sessions } = await supabaseDR.from('production_sessions')
          .select('id, line_name, shift, status, oee, oee_a, oee_p, oee_q, shift_min, start_time, end_time')
          .eq('work_date', storyDate).in('line_name', fam);
        const ids = (sessions || []).map(s => s.id);
        const [ordRes, dtRes, defRes, fourMRes, prodRes] = await Promise.all([
          ids.length ? supabaseDR.from('prod_orders').select('session_id, mat_no, status, qty, qty_ok, qty_actual, qty_target, is_manual, prod_no, machine_no').in('session_id', ids) : { data: [] },
          ids.length ? supabaseDR.from('downtime_logs').select('id, session_id, machine_no, description, duration_min, started_at, ended_at, carry_over, dr_downtime_types(name_th, category)').in('session_id', ids) : { data: [] },
          ids.length ? supabaseDR.from('defect_logs').select('id, session_id, qty_ng, qty_suspect, qty_repair, description, dr_defect_types(name_th), prod_orders(mat_no)').in('session_id', ids) : { data: [] },
          supabase.from('four_m_logs').select('id, line_name, category, description, status').eq('work_date', storyDate).in('line_name', fam),
          supabaseDR.from('dr_products').select('mat_no, name, pair_mat_no'),
          loadOpInfo(), // map รายการขั้นตอน (OP) — ให้ยอดรวมใน modal ยุบขั้นซ้ำเหมือนผัง
        ]);
        if (cancelled) return;
        const prodName = {}, pairMap = {};
        (prodRes.data || []).forEach(p => { prodName[p.mat_no] = p.name; if (p.pair_mat_no) pairMap[p.mat_no] = p.pair_mat_no; });
        const sessById = {}; (sessions || []).forEach(s => { sessById[s.id] = s; });

        // ผลิตรายพาร์ท (รวมทุกกะ)
        const byMat = {};
        (ordRes.data || []).forEach(o => {
          const k = o.mat_no || '(ไม่ระบุ MAT)';
          const e = byMat[k] || (byMat[k] = { mat: k, name: prodName[o.mat_no] || '', target: 0, produced: 0, orders: 0, manual: 0 });
          e.target += o.qty_target ?? o.qty ?? 0;
          e.produced += o.status === 'confirmed' ? (o.qty_ok ?? o.qty ?? 0) : (o.qty_actual ?? 0);
          e.orders++; if (o.is_manual) e.manual++;
        });
        const parts = Object.values(byMat).sort((a, b) => (b.target || 0) - (a.target || 0));
        const ptot = pairAwareTotal(collapseOps(Object.values(byMat).filter(p => p.mat !== '(ไม่ระบุ MAT)').map(p => ({ mat_no: p.mat, target: p.target, produced: p.produced })), opInfoSync()), m => pairMap[m] || null);
        const nullPart = byMat['(ไม่ระบุ MAT)'];
        const totTarget = ptot.target + (nullPart?.target || 0);
        const totProduced = ptot.produced + (nullPart?.produced || 0);

        // Downtime — แยกนอกแผน/ในแผน แล้วรวมตามประเภท+เครื่อง (เก็บ note ของพนักงานไว้ด้วย)
        const dtRows = (dtRes.data || []).map(d => {
          const mins = d.duration_min != null ? Number(d.duration_min) || 0
            : (d.started_at && d.ended_at ? Math.max(0, (new Date(d.ended_at) - new Date(d.started_at)) / 60000) : 0);
          return { id: d.id, session_id: d.session_id, mins: Math.round(mins), machine: d.machine_no, note: d.description,
            type: d.dr_downtime_types?.name_th || 'ไม่ระบุประเภท', planned: d.dr_downtime_types?.category === 'planned',
            open: !d.ended_at && d.duration_min == null, carry_over: d.carry_over, shift: sessById[d.session_id]?.shift };
        }).sort((a, b) => b.mins - a.mins);
        const dtUnplanned = dtRows.filter(d => !d.planned);
        const dtPlanned = dtRows.filter(d => d.planned);

        // ของเสีย — รวมตามประเภท
        const defByType = {};
        (defRes.data || []).forEach(d => {
          const k = d.dr_defect_types?.name_th || 'ไม่ระบุประเภท';
          const e = defByType[k] || (defByType[k] = { type: k, ng: 0, suspect: 0, repair: 0, notes: [] });
          e.ng += d.qty_ng || 0; e.suspect += d.qty_suspect || 0; e.repair += d.qty_repair || 0;
          if (d.description) e.notes.push(d.description);
        });
        const defects = Object.values(defByType).sort((a, b) => (b.ng + b.suspect) - (a.ng + a.suspect));

        // สรุปรายกะ
        const shifts = (sessions || []).map(s => {
          const sOrders = (ordRes.data || []).filter(o => o.session_id === s.id);
          const t = sOrders.reduce((a, o) => a + (o.qty_target ?? o.qty ?? 0), 0);
          const p = sOrders.reduce((a, o) => a + (o.status === 'confirmed' ? (o.qty_ok ?? o.qty ?? 0) : (o.qty_actual ?? 0)), 0);
          const dt = dtRows.filter(d => d.session_id === s.id && !d.planned).reduce((a, d) => a + d.mins, 0);
          const ng = (defRes.data || []).filter(d => d.session_id === s.id).reduce((a, d) => a + (d.qty_ng || 0), 0);
          // ปิดกะแล้ว = ค่าที่ stamp · ยังเปิด = OEE สดตัวเดียวกับที่ผังใช้ (ห้ามโชว์ "—" ทั้งที่ผังมีเลข)
          const liveO = liveOeeRef.current[s.id];
          return { id: s.id, line: s.line_name, shift: s.shift, status: s.status,
            oee: s.oee != null ? s.oee : (liveO ?? null), oeeLive: s.oee == null && liveO != null,
            a: s.oee_a, p: s.oee_p, q: s.oee_q, target: t, produced: p, dt, ng };
        }).sort((a, b) => (a.shift === 'day' ? 0 : 1) - (b.shift === 'day' ? 0 : 1));

        /* 🔗 สายการไหลระหว่างไลน์ (2026-08-19) — "หยุดที่นี่ กระทบไลน์ไหน"
           รวมทั้งครอบครัว แล้วตัดเส้นที่วิ่งอยู่ในครอบครัวเดียวกันทิ้ง (เป็นการไหลภายใน ไม่ใช่ผลกระทบข้ามกลุ่ม)
           best-effort: ยังไม่ apply migration = ไม่มีบล็อกนี้ ไม่ทำ modal พัง */
        let flowDown = [], flowUp = [];
        try {
          const famSet = new Set(fam);
          const { data: fl } = await supabaseDR.from('line_flow_links').select('*').eq('is_active', true);
          for (const l of fl || []) {
            if (famSet.has(l.from_line) && !famSet.has(l.to_line)) flowDown.push(l);
            if (famSet.has(l.to_line) && !famSet.has(l.from_line)) flowUp.push(l);
          }
        } catch { /* best-effort */ }

        /* ── 🧭 มิติอื่นของไลน์ที่ "ไม่ผูกกับกะ" — PM รายแผน + ใบซ่อม MO ค้าง (2026-08-26)
           user ทัก: "คลิกมาไม่เจอข้อมูลอะไรเลย ทั้งที่บอก PM ค้าง · มันควรโชว์ทุกเรื่อง
           เพราะจะดูรายละเอียดของไลน์นั้นแล้ว" — เดิม modal มีแต่เรื่องผลิต และวันที่ไม่ได้เปิดกะ
           จะขึ้นข้อความบรรทัดเดียวแล้วจบ ทั้งที่ PM/ใบซ่อม/คน/ไฟ ยังมีเรื่องให้ดู
           ⚠️ ทั้งก้อนเป็น best-effort — พลาดแล้วซ่อนเฉพาะบล็อกนั้น ห้ามทำ modal พังทั้งใบ
           ⚠️ equipment ของไลน์ = jigs ที่ line_name ตรง **หรือ** แถวเงาของเครื่องในไลน์ (machine_id)
              (กฎเดียวกับ loadPM — checklists.equipment_id ชี้ jigs.id ไม่ใช่ machines.id) */
        let pmRows = null, moRows = null;
        try {
          const { data: mcRows } = await supabaseDR.from('machines')
            .select('id, machine_no, machine_name').eq('is_active', true).in('line_name', fam);
          const mcIds = (mcRows || []).map(m => m.id);
          const [jgLine, jgMc] = await Promise.all([
            supabaseDR.from('jigs').select('id, name, jig_no, line_name, machine_id').eq('module', 'mtn').in('line_name', fam),
            mcIds.length ? fetchByIds(mcIds, c => supabaseDR.from('jigs').select('id, name, jig_no, line_name, machine_id').eq('module', 'mtn').in('machine_id', c)) : { rows: [] },
          ]);
          const jigById = {};
          [...(jgLine.data || []), ...(jgMc.rows || [])].forEach(j => { jigById[j.id] = j; });
          const jigIds = Object.keys(jigById);
          if (jigIds.length) {
            const clRes = await fetchByIds(jigIds, c => supabaseDR.from('checklists')
              .select('id, equipment_id, department, name, frequency').eq('module', 'mtn').in('equipment_id', c));
            const clById = {}; clRes.rows.forEach(c => { clById[c.id] = c; });
            const plRes = await fetchByIds(clRes.rows.map(c => c.id), c => supabaseDR.from('pm_plans')
              .select('checklist_id, next_due_date, last_done_at').eq('is_active', true).in('checklist_id', c));
            const today = getWorkDate();
            pmRows = plRes.rows.map(p => {
              const cl = clById[p.checklist_id], j = jigById[cl?.equipment_id];
              const days = p.next_due_date
                ? Math.round((new Date(`${p.next_due_date}T00:00:00`) - new Date(`${today}T00:00:00`)) / 864e5) : null;
              return { key: p.checklist_id, name: j?.jig_no || j?.name || 'อุปกรณ์ (ไม่พบชื่อ)',
                sub: j?.jig_no && j?.name && j.jig_no !== j.name ? j.name : '', dept: cl?.department,
                due: p.next_due_date, days, lastDone: p.last_done_at };
            }).sort((a, b) => (a.days ?? 9e9) - (b.days ?? 9e9));
          } else pmRows = [];
          // ใบซ่อมค้าง — ใบเปิดมีไม่มาก ดึงทั้งชุดแล้วกรองด้วยไลน์/เลขเครื่องของไลน์นี้
          const famSet = new Set(fam);
          const nos = new Set((mcRows || []).map(m => String(m.machine_no || '').trim().toUpperCase()).filter(Boolean));
          const { data: mos } = await supabaseDR.from('mtn_orders')
            .select('id, mo_no, machine_no, line_name, status, report_at, problem_characteristic')
            .in('status', OPEN_MO_STATUSES);
          moRows = (mos || [])
            .filter(o => famSet.has(o.line_name) || nos.has(String(o.machine_no || '').trim().toUpperCase()))
            .sort((a, b) => String(a.report_at || '').localeCompare(String(b.report_at || '')));
        } catch { /* best-effort — บล็อก PM/ใบซ่อมจะไม่ขึ้น แต่ modal ยังใช้ได้ */ }

        setStory({
          pmRows, moRows,
          flowDown, flowUp,
          totTarget, totProduced, parts,
          dtUnplanned, dtPlanned,
          dtUnplannedMin: dtUnplanned.reduce((a, d) => a + d.mins, 0),
          dtPlannedMin: dtPlanned.reduce((a, d) => a + d.mins, 0),
          defects, ngTotal: defects.reduce((a, d) => a + d.ng, 0), suspectTotal: defects.reduce((a, d) => a + d.suspect, 0),
          shifts, fourM: fourMRes.data || [], sessionCount: (sessions || []).length,
        });
      } catch { if (!cancelled) setStory(null); }
      finally { if (!cancelled) setStoryLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [storyLine, storyDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── family rollup: ตีกรอบ "ไลน์บนสุด (top-level)" แล้วรวมยอดของลูกขึ้นมา ──
  // (ข้อมูลจริง: พนักงาน/บางเมตริกผูกกับไลน์แม่ · บางอันผูกกับลูก → รวมทั้งครอบครัวจึงครบ)
  // ไลน์ไม่มีลูก = โชว์ตัวเอง (เช่น LINE A 800 Ton) · ไลน์มีลูก = ตัวเอง + ลูกทั้งหมด
  const childrenOf = useMemo(() => {
    const m = {};
    lines.forEach(l => { if (l.parent_line_name) (m[l.parent_line_name] ||= []).push(l.name); });
    return m;
  }, [lines]);
  const parentOf = useMemo(() => {
    const m = {};
    lines.forEach(l => { if (l.parent_line_name) m[l.name] = l.parent_line_name; });
    return m;
  }, [lines]);
  const familyNames = (name) => [name, ...(childrenOf[name] || [])];
  // ไล่ขึ้นบรรพบุรุษ (พ่อ→ปู่→...) กันลูปด้วย seen
  const ancestorNames = (name) => { const out = []; const seen = new Set([name]); let p = parentOf[name]; while (p && !seen.has(p)) { out.push(p); seen.add(p); p = parentOf[p]; } return out; };
  // คืนชื่อไลน์ที่จะ "เปิดผังพื้นพร้อมพนักงาน" ให้ — เลือกผังที่มีคนจริง
  // (ผังไลน์แม่-ลูกคนละรูป · คนอยู่บนผังของไลน์ลูก → ไลน์แม่ว่าง = เด้งไปโชว์ผังลูกที่มีคนแทน)
  // ไลน์ลูกที่ไม่มีผังของตัวเอง → ไล่ขึ้นใช้ผังของไลน์แม่ (2026-07-22 — เดิมได้ popup ตัน)
  const floorMapTarget = (name) => {
    const presentOf = (n) => manpower[n]?.present || 0;
    const cand = familyNames(name).filter(n => layoutLines.has(n));
    if (cand.length) {
      if (layoutLines.has(name) && presentOf(name) > 0) return name;        // ไลน์แม่มีผัง+คนของตัวเอง → โชว์ตัวเอง
      const withPeople = cand.filter(n => presentOf(n) > 0).sort((a, b) => presentOf(b) - presentOf(a));
      if (withPeople.length) return withPeople[0];                          // ไลน์แม่ว่าง → ลูกที่มีคนมากสุด
      return layoutLines.has(name) ? name : cand[0];                        // ยังไม่มีใครเข้างาน → ผังตัวเอง/ตัวแรก
    }
    // ตัวเอง+ลูกไม่มีผัง → ใช้ผังของไลน์แม่ที่ใกล้สุด (ผังกลุ่มเดียวกัน)
    return ancestorNames(name).find(a => layoutLines.has(a)) || null;
  };
  // คลิกไลน์: มีผังพื้น → เปิดผังไลน์พร้อมพนักงาน (Dashboard) พร้อม from=factory-map เพื่อปิดแล้วเด้งกลับผังรวม · ไม่มีผัง → popup สรุปเมตริก
  // โซน MTN/Facility → เปิดผังเครื่องจักร (ซ่อมบำรุง) แท็บ Facility ของโซนนั้นเลย
  //   (popup เมตริกผลิตไม่มีความหมายกับโซน facility — ยอด/OEE/คน เป็น "—" หมด · 2026-08-03)
  // ไลน์ผลิต → เปิด "สรุปเรื่องราวทั้งวัน" (ผลิตรายพาร์ท/DT+เหตุผล/ของเสีย/4M) — มีปุ่มไปผังไลน์+พนักงานในนั้น
  //   (เดิมคลิกแล้วเด้งไปผังคนทันที ซึ่งดูปัญหาของวันไม่ได้ · 2026-08-03 คำสั่ง user)
  // date = วันที่ที่จะสรุป · ไม่ส่ง = วันงานปัจจุบัน (คลิกจากผัง live) · ส่ง reviewDate = คลิกจากแถบทบทวนขวา
  const openLine = (name, date) => {
    // 🔨 โซนคลังแม่พิมพ์ → เปิดผังจัดเก็บแม่พิมพ์ของโซนนั้นเลย (ต้องเช็คก่อน isFac — ชื่อโซนแม่พิมพ์ก็ไม่ใช่ไลน์ผลิตเหมือนกัน)
    const dz = dieZoneOf(name);
    if (dz) { setHoverLine(null); navigate(`/die-registry?tab=layout&area=${encodeURIComponent(dz.id)}&from=factory-map`); return; }
    // 🏬 โซนคลังสินค้า → popup รายการ MAT ในโซน (เต็ม/ขาด) — เช็คก่อน isFac เหมือนโซนแม่พิมพ์
    const sz = storeZoneOf(name);
    if (sz) { setHoverLine(null); setStoreZoneModal(sz); return; }
    if (isFac(name)) { setHoverLine(null); navigate(`/mtn-layout?view=facility&zone=${encodeURIComponent(name)}&from=factory-map`); return; }
    setHoverLine(null); setStoryDate(date || getWorkDate()); setStoryLine(name);
  };
  // เปิดผังไลน์ + พนักงาน (Dashboard) — จากปุ่มใน modal สรุป
  const openFloorMap = (name) => {
    const t = floorMapTarget(name);
    if (t) navigate(`/dashboard?line=${encodeURIComponent(t)}&from=factory-map`);
    else { setStoryLine(null); setDetailLine(name); }
  };
  // ตีกรอบเฉพาะ "ไลน์บนสุด (top-level)" = parent_line_name IS NULL — 1 กรอบ/กลุ่ม (รวมยอดลูกด้วย stOf)
  const topNames = useMemo(() => lines.filter(l => !l.parent_line_name).map(l => l.name), [lines]);
  // ชื่อไลน์ผลิตทั้งหมด (แม่+ลูก) — กรอบที่ line_name ไม่ตรงไลน์ผลิตใดเลย = โซน MTN/facility
  const allProdNames = useMemo(() => new Set(lines.map(l => l.name)), [lines]);
  const isFac = (name) => !allProdNames.has(name);
  const stOf = (name) => {
    const agg = { ...EMPTY_ST, supList: [], oeeRows: [] };
    familyNames(name).forEach(n => {
      const sp = supplyStatus[n];
      if (sp) { agg.supList.push(...sp.suppliers); agg.supAtRisk = agg.supAtRisk || sp.atRisk; }
      const p = lineStatus[n];
      if (p) { agg.actual += p.actual || 0; agg.target += p.target || 0; agg.onTimeTarget += p.onTimeTarget || 0; agg.runN = Math.max(agg.runN || 0, p.runN || 0); agg.capN = Math.max(agg.capN || 0, p.capN || 0); agg.hasOpen = agg.hasOpen || p.hasOpen; agg.dtMin += p.dtMin || 0; agg.dtMinHour += p.dtMinHour || 0; if (p.dtOpenMin != null) agg.dtOpenMin = Math.max(agg.dtOpenMin ?? 0, p.dtOpenMin); agg.dtOpenUnknown = agg.dtOpenUnknown || p.dtOpenUnknown; agg.dtActive = agg.dtActive || p.dtActive; agg.ng += p.ng || 0; agg.oeeRows.push(...(p.oeeRows || [])); agg.oeeLive = agg.oeeLive || p.oeeLive; agg.oeeNoCt = agg.oeeNoCt || p.oeeNoCt; agg.oeeCtPartial = agg.oeeCtPartial || p.oeeCtPartial; agg.oeePOver = agg.oeePOver || p.oeePOver; agg.oeePRaw = Math.max(agg.oeePRaw || 0, p.oeePRaw || 0); }
      const m = manpower[n];
      if (m) { agg.headTotal += m.headTotal || 0; agg.present += m.present || 0; agg.ppeBad += m.ppeBad || 0; agg.stationTotal += m.stationTotal || 0; agg.stationFilled += m.stationFilled || 0; }
      const pm = pmStatus[n];
      if (pm) { agg.pmTotal += pm.pmTotal || 0; agg.pmOverdue += pm.pmOverdue || 0; agg.pmDueSoon += pm.pmDueSoon || 0;
               agg.amTotal += pm.amTotal || 0; agg.amOverdue += pm.amOverdue || 0; agg.amDueSoon += pm.amDueSoon || 0;
               agg.pmBusy += pm.pmBusy || 0; if (!agg.pmBusyText) agg.pmBusyText = pm.pmBusyText || ''; }
      // ⚡ พลังงาน — หน้ากรอกให้กรอกได้เฉพาะ "ไลน์บนสุด" เท่านั้น ไลน์ลูกจึงไม่มีแถว = บวกซ้ำไม่ได้
      //    (ถ้าวันหน้าเปิดให้กรอกรายไลน์ลูกด้วย ต้องเปลี่ยนเป็น "แม่มีค่า = ใช้ของแม่" แบบ stdManpower)
      const en = energyStatus[n];
      if (en) { agg.kwh = (agg.kwh || 0) + (en.qty || 0); agg.kwhPrev = (agg.kwhPrev || 0) + (en.prev || 0); agg.kwhCost = (agg.kwhCost || 0) + (en.cost || 0); agg.kwhSrc = agg.kwhSrc || en.source; if (!agg.kwhSeries?.length) agg.kwhSeries = en.series || []; }
    });
    // โซน facility เอง: Supply Route = เครื่องในโซนนี้ down (open MO) มั้ย (มุมมองต่างจากไลน์ผลิตที่เป็น "ถูกจ่าย")
    if (isFac(name)) {
      const fs = facilitySupply[name];
      if (fs) { agg.supList = fs.machines; agg.supAtRisk = fs.atRisk; agg.supFeeds = fs.feeds; agg.isFac = true; }
      else agg.isFac = true;
      const dz = dieZoneOf(name);
      if (dz) agg.die = dz;    // 🔨 โซนคลังแม่พิมพ์ — health จากใบซ่อม MO ของแม่พิมพ์ที่วางในโซน
      const sz = storeZoneOf(name);
      if (sz) agg.storeZone = sz; // 🏬 โซนคลังสินค้า — health จากสต็อกจริง (เต็ม/ใกล้เต็ม/ต่ำกว่า Min)
    }
    const aggAvg = wavg(agg.oeeRows, r => r.oee, wLoad);
    agg.oee = aggAvg != null ? Math.round(aggAvg) : null;
    // A/P/Q รวมครอบครัว — ถ่วงน้ำหนักตามกฎ (A=wLoad · P=wRun · Q=wProd) ใช้บนการ์ด KPI metric OEE
    agg.oeeA = wavg(agg.oeeRows, r => r.a, wLoad);
    agg.oeeP = wavg(agg.oeeRows, r => r.p, wRun);
    agg.oeeQ = wavg(agg.oeeRows, r => r.q, wProd);
    // 🌱 คาร์บอน (C1) — คำนวณจาก kWh × EF ของเดือนที่ผังโชว์ · ไม่มี EF = null (ห้ามเดา)
    agg.kwhCo2 = co2eKg(agg.kwh ?? null, energyEf);
    return agg;
  };
  const catColor = (name) => CAT[M.cat(stOf(name))];
  // โซน MTN/facility (metric ผลิต): default เขียว "ปกติ" ถ้าไม่มีเหตุผิดปกติ — แดง/ส้มเฉพาะเมื่อมีเครื่องซ่อม/PM ค้าง (คำสั่ง user)
  // ตัวจริงย้ายไประดับ module (facHealthOf/facHealthTextOf — METRICS.health ใช้ร่วม) · alias คงชื่อเดิมให้ call site ทั้งไฟล์
  const facHealth = facHealthOf;
  const facHealthText = facHealthTextOf;
  const regCat = (st) => (st.isFac && M.facilityNA) ? facHealth(st) : (M.mapCat || M.cat)(st);
  const regText = (st) => (st.isFac && M.facilityNA) ? facHealthText(st) : (M.mapText || M.text)(st);
  /* 🫥 "กรอบขึ้นตามสิ่งที่กด" (2026-08-25 · คำสั่ง user — เข้มขึ้นรอบ 2 หลัง user ทัก "OEE ผังจะโชว์คลังสินค้าทำไม"):
     metric ที่โซนสนับสนุนไม่มีข้อมูล (facilityNA เช่น คน/ยอดผลิต/OEE/DT/ของเสีย)
     → ซ่อนกรอบโซน MTN/utility/คลัง/แม่พิมพ์ **ทั้งหมด ไม่ว่าสถานะอะไร** (รอบแรกเว้นโซนผิดปกติไว้
       แล้วกล่องคลัง "เกิน Max" ไปโผล่บนแท็บ OEE — แท็บไหนต้องพูดแต่เรื่องของแท็บนั้น)
     ⚠️ สัญญาณผิดปกติไม่หายเงียบ — ยุบเป็นตัวนับ ⚠ บนชิป (title = รายชื่อ+อาการ) + กดชิปเปิดดูชั่วคราวได้
     · โหมดแก้ผังเห็นครบทุกกรอบ (ต้องแก้ได้) · metric ของโซนเอง (พลังงาน/PM/Supply Route) โชว์ปกติ */
  const facHidden = (name) => !editing && !showFac && M.facilityNA && isFac(name);
  const facZones = useMemo(() => {
    if (editing || !M.facilityNA) return { all: [], warn: [] };
    const all = regions.map(r => r.line_name).filter(n => isFac(n));
    const warn = all.filter(n => { const h = facHealth(stOf(n)); return h !== 'good' && h !== 'idle'; });
    return { all, warn };
    // facHealth อ่านสถานะปัจจุบันผ่าน stOf — ใส่ state ที่พึ่งพาเป็น deps แทน (pattern เดียวกับ ranked)
  }, [regions, metric, editing, pmStatus, supplyStatus, facilitySupply, dieZones, storeZones, lineStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ⚙️ ซีรีส์ OEE รายวันต่อกรอบ (รวมครอบครัวไลน์) — คำนวณครั้งเดียวจาก oeeHistRaw ไม่คิดใน stOf (stOf ถูกเรียกถี่มาก)
     series = wavg รายวันถ่วง wLoad (สูตรบังคับ) เรียงเก่า→ใหม่ · prev = วันล่าสุดที่มีข้อมูล (ฐานเทียบ Δ ของวันนี้) */
  const oeeHistBy = useMemo(() => {
    if (!oeeHistRaw?.length) return {};
    const names = new Set([...regions.map(r => r.line_name), ...topNames]);
    const out = {};
    names.forEach(n => {
      if (isFac(n)) return;
      const fam = new Set(familyNames(n));
      const byDay = {};
      oeeHistRaw.forEach(s => { if (fam.has(s.line_name)) (byDay[s.work_date] ||= []).push(s); });
      const series = Object.keys(byDay).sort().map(d => wavg(byDay[d], x => x.oee, wLoad)).filter(v => v != null);
      if (series.length) out[n] = { series, prev: series[series.length - 1] };
    });
    return out;
    // familyNames/isFac derive จาก lines — ใส่ lines เป็น dep แทน
  }, [oeeHistRaw, regions, topNames, lines]); // eslint-disable-line react-hooks/exhaustive-deps
  /* ป้ายบนผังแคบ (มือถือ/จอเล็ก) — ย่อข้อความให้เหลือตัวเลขสำคัญ (คำสั่ง user 2026-08-06:
     "มือถือลดข้อมูลได้ · PC/จอ display ต้องครบ") · ป้ายกว้างเท่าข้อความยาวสุด
     ผังแคบจึงจัดยังไงก็ทับ — ย่อข้อความคือทางเดียวที่ไม่ต้องซ่อนไลน์ทิ้ง
     ⚠️ COMPACT_W ต้องต่ำกว่าความกว้างผังบนโน้ตบุ๊ก/จอ TV เสมอ ไม่งั้นจอใหญ่โดนย่อไปด้วย
        (จอ 1366 หัก sidebar 252 + แผงขวา 360 ≈ 720 → มือถือ/แท็บเล็ตแนวตั้งเท่านั้นที่เข้าเกณฑ์)
     ⚠️ เกณฑ์ต้องคูณ lblScale — ป้ายถูกย่อ 0.7× ก็กินที่น้อยลง 0.7× (จอ TV ที่ OS scaling สูง
        wrapW แคบลงเทียม กด A− แล้วต้องหลุดจากโหมดย่อได้ ไม่ใช่ติด COMPACT ตายตัว) */
  const compactLbl = wrapW > 0 && wrapW < COMPACT_W * lblScale;
  const shortText = (st) => {
    if (st.isFac && M.facilityNA) return facHealth(st) === 'good' ? '' : facHealthText(st);
    return M.short ? M.short(st) : regText(st);
  };
  const lblText = (st) => (compactLbl ? shortText(st) : regText(st));

  // side panel: ไลน์ที่มีกะวันนี้ ∪ ไลน์ที่ตีกรอบไว้ — เรียงตาม metric (ปัญหาขึ้นบน)
  const ranked = useMemo(() => {
    // แสดงไลน์บนสุด (หน่วยปฏิบัติการ) + กรอบที่ไม่ใช่ไลน์ลูก — ไม่ลิสต์ลูกแยก (รวมใน rollup ของแม่แล้ว กันนับซ้ำในสายตา)
    const names = new Set([...topNames, ...regions.map(r => r.line_name).filter(n => !parentOf[n])]);
    const arr = [...names]
      .filter(n => !facHidden(n))   // 🫥 โซนที่ซ่อนตาม metric ไม่เข้าอันดับด้วย (จะได้ไม่มีแถว "ปกติ" ของโซนช่างปนในอันดับผลิต)
      .map(name => { const st = stOf(name); return { name, st, val: M.value(st), cat: regCat(st) }; });
    arr.sort((a, b) => {
      const av = a.val, bv = b.val;
      if (av == null && bv == null) return a.name.localeCompare(b.name);
      if (av == null) return 1; if (bv == null) return -1;
      return M.desc ? bv - av : av - bv;
    });
    return arr;
  }, [lineStatus, manpower, pmStatus, supplyStatus, facilitySupply, dieZones, storeZones, regions, metric, editing, showFac, topNames, parentOf]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── สรุปทบทวนรายวัน: rollup ทั้งครอบครัว (แม่+ลูก) เหมือน stOf แต่อ่านจาก reviewStatus ──
  //    OEE ถ่วงน้ำหนักด้วยเวลารับภาระ (oeeWSum/oeeWLoad) — ห้าม mean-of-percentages · fallback = เฉลี่ยธรรมดา
  const reviewOf = (name) => {
    const agg = { actual: 0, target: 0, oee: null, oeeWSum: 0, oeeWLoad: 0, oeeSum: 0, oeeN: 0, dtMin: 0, ng: 0, present: 0, headTotal: 0, oeeRows: [] };
    familyNames(name).forEach(n => {
      const r = reviewStatus[n]; if (!r) return;
      agg.actual += r.actual || 0; agg.target += r.target || 0;
      agg.oeeWSum += r.oeeWSum || 0; agg.oeeWLoad += r.oeeWLoad || 0; agg.oeeSum += r.oeeSum || 0; agg.oeeN += r.oeeN || 0;
      agg.dtMin += r.dtMin || 0; agg.ng += r.ng || 0; agg.present += r.present || 0; agg.headTotal += r.headTotal || 0;
      if (r.oeeRows?.length) agg.oeeRows.push(...r.oeeRows);
    });
    agg.oee = agg.oeeWLoad > 0 ? Math.round(agg.oeeWSum / agg.oeeWLoad) : (agg.oeeN ? Math.round(agg.oeeSum / agg.oeeN) : null);
    return agg;
  };
  // เรียงไลน์ที่ทำได้ต่ำสุดขึ้นบน (ปัญหาก่อน) · ไม่มีเป้าไปท้าย
  // ⚠️ ลิสต์เฉพาะ "กลุ่มไลน์บนสุด" (1 แถว/กลุ่ม รวมยอดลูกด้วย reviewOf) — ไม่ลิสต์ไลน์ลูกซ้ำ
  //    (แม้ลูกจะถูกตีกรอบไว้ก็ตาม เช่น LWR BAR + Laser LWR/Assy LWR → เห็นแค่ LWR BAR ยอดรวม กันนับซ้ำในสายตา · ดูแยกลูกได้ที่ drill-down)
  const reviewRanked = useMemo(() => {
    const names = new Set([...topNames, ...regions.map(r => r.line_name).filter(n => !parentOf[n])]);
    const arr = [...names].map(name => ({ name, r: reviewOf(name) }));
    arr.sort((a, b) => {
      const ap = a.r.target > 0 ? a.r.actual / a.r.target : null;
      const bp = b.r.target > 0 ? b.r.actual / b.r.target : null;
      if (ap == null && bp == null) return a.name.localeCompare(b.name);
      if (ap == null) return 1; if (bp == null) return -1;
      return ap - bp;
    });
    return arr;
  }, [reviewStatus, regions, topNames, parentOf]); // eslint-disable-line react-hooks/exhaustive-deps
  // ยอดรวมทั้งโรงงาน (รวมเฉพาะไลน์บนสุด กันนับซ้ำ) · OEE ถ่วงน้ำหนักเช่นกัน
  const reviewTotals = useMemo(() => {
    const t = { actual: 0, target: 0, dtMin: 0, ng: 0, present: 0, headTotal: 0, oeeWSum: 0, oeeWLoad: 0, oeeSum: 0, oeeN: 0, oee: null, oeeRows: [] };
    topNames.forEach(name => { const r = reviewOf(name); t.actual += r.actual; t.target += r.target; t.dtMin += r.dtMin; t.ng += r.ng; t.present += r.present; t.headTotal += r.headTotal; t.oeeWSum += r.oeeWSum; t.oeeWLoad += r.oeeWLoad; t.oeeSum += r.oeeSum; t.oeeN += r.oeeN; if (r.oeeRows?.length) t.oeeRows.push(...r.oeeRows); });
    t.oee = t.oeeWLoad > 0 ? Math.round(t.oeeWSum / t.oeeWLoad) : (t.oeeN ? Math.round(t.oeeSum / t.oeeN) : null);
    return t;
  }, [reviewStatus, topNames]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── อัปโหลดรูปผัง (บีบเบา 2560/2.5MB/q0.9) ── */
  const handleUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = '';
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const isGif = file.type === 'image/gif' || ext === 'gif';
    if (isGif && file.size > 2 * 1024 * 1024) return toast.error('GIF ต้องไม่เกิน 2MB');
    try {
      setUploading(true);
      const blob = isGif ? file : await imageCompression(file, { maxSizeMB: 2.5, maxWidthOrHeight: 2560, initialQuality: 0.9 });
      const path = `factory/map_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('employee-photos').upload(path, blob);
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('employee-photos').getPublicUrl(path);
      const row = mapId
        ? await supabase.from('factory_map').update({ image_url: pub.publicUrl, updated_at: new Date().toISOString() }).eq('id', mapId).select('id').single()
        : await supabase.from('factory_map').insert({ image_url: pub.publicUrl }).select('id').single();
      if (row.error) throw row.error;
      const prev = imageUrl;
      if (prev?.includes('/employee-photos/factory/')) {
        const oldName = decodeURIComponent(prev.split('/employee-photos/')[1] || '');
        if (oldName.startsWith('factory/')) supabase.storage.from('employee-photos').remove([oldName]).catch(() => {});
      }
      setMapId(row.data.id); setImageUrl(pub.publicUrl); setAspect(null);
      toast.success('อัปโหลดผังโรงงานแล้ว');
    } catch (err) { toast.error('อัปโหลดไม่สำเร็จ: ' + err.message); }
    finally { setUploading(false); }
  };

  const pctFromEvent = (clientX, clientY) => {
    const r = wrapRef.current.getBoundingClientRect();
    return { x: Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)), y: Math.min(100, Math.max(0, ((clientY - r.top) / r.height) * 100)) };
  };
  const framedNames = () => new Set(regions.map(r => r.line_name));
  // กลุ่มถือว่า "ตีแล้ว" เมื่อ ตีที่ตัวแม่เอง หรือ ตีรายไลน์ลูกแล้ว (ตีลูกครบ = แม่ไม่ต้องตีซ้ำ — กรอบแม่จะทับลูก)
  const coveredTop = (top, f) => f.has(top) || (childrenOf[top] || []).some(c => f.has(c));
  const framedTopCount = (() => { const f = framedNames(); return topNames.filter(n => coveredTop(n, f)).length; })();
  const assignableLines = () => { const f = framedNames(); return topNames.filter(n => !coveredTop(n, f)); };
  // กลุ่มที่เริ่มตีเป็นรายไลน์ลูกแล้วแต่ยังไม่ครบ → เสนอไลน์ลูกที่เหลือให้ตีต่อ (ไม่เสนอตัวแม่ซ้ำ)
  const assignableLeafs = () => {
    const f = framedNames(); const out = [];
    topNames.forEach(t => {
      if (f.has(t)) return;
      const ch = childrenOf[t] || [];
      if (ch.length && ch.some(c => f.has(c))) out.push(...ch.filter(c => !f.has(c)));
    });
    return out;
  };
  const assignableFacility = () => { const f = framedNames(); return facilityZones.filter(n => !f.has(n)); };
  // 🔨 ผังจัดเก็บแม่พิมพ์ (die_storage_areas) ที่ยังไม่ถูกตีกรอบ — ตีกรอบชื่อเดียวกัน = คลิกแล้วเด้งเข้าผังแม่พิมพ์
  const assignableDie = () => { const f = framedNames(); return Object.values(dieZones).map(z => z.name).filter(n => !f.has(n)).sort((a, b) => a.localeCompare(b)); };
  // 🏬 โซนคลังสินค้า (storage_zones) ที่ยังไม่ถูกตีกรอบ — ทะเบียนจัดการที่ /line-stock แท็บ "โซนคลัง (ผัง)"
  const assignableStore = () => { const f = framedNames(); return Object.values(storeZones).map(z => z.name).filter(n => !f.has(n)).sort((a, b) => a.localeCompare(b)); };
  // กรอบแม่อัตโนมัติ (2026-08-04): แม่ไม่ได้ตีเอง + ลูกถูกตีแล้ว → เส้นประล้อมกรอบลูกทั้งหมด + ป้ายยอดรวม family
  // แก้ปัญหา "เช็คชื่อกันที่ไลน์แม่" — ข้อมูลที่ผูกชื่อแม่ (คน ฯลฯ) โผล่บนผังโดยไม่ต้องตีกรอบแม่ทับลูก
  const autoHulls = useMemo(() => {
    const f = new Set(regions.map(r => r.line_name));
    return topNames
      .filter(t => !f.has(t) && (childrenOf[t] || []).some(c => f.has(c)))
      .map(t => {
        const pts = regions.filter(r => (childrenOf[t] || []).includes(r.line_name)).flatMap(r => r.points);
        return { name: t, hull: expandHull(convexHull(pts)) };
      })
      .filter(h => h.hull.length >= 3);
  }, [regions, topNames, childrenOf]);
  /* ตำแหน่งป้ายทั้งผัง — กันทับกันทั้งป้ายไลน์และป้ายกลุ่ม (2026-08-06)
     ลำดับ: กรอบใหญ่ได้เลือกที่ก่อน (ป้ายอยู่ตำแหน่งธรรมชาติ) → ตัวเล็กหลบ
            → ป้ายกลุ่มวางท้ายสุด เลี่ยงป้ายไลน์ที่วางแล้วทุกใบ
     ยังไม่รู้ขนาดผัง (รูปยังไม่โหลด) = คืน {} → render ถอยไปวางแบบเดิม */
  const labelLayout = useMemo(() => {
    const out = { region: {}, hull: {}, ready: false, hidden: [] };
    if (!wrapW || !aspect) return out;           // รูปยังไม่โหลด → render ถอยไปวางแบบเดิม
    out.ready = true;
    const toN = (px) => (px / wrapW) * 100;      // px → หน่วย N (% ของความกว้าง)
    // ขนาดป้ายตามที่เครื่องนี้ตั้ง (A−/A+) — ตัวจองพื้นที่กับตัววาด (zoom) ต้องคูณตัวเดียวกันเสมอ
    const est = (name, txt, big, plain, kpi) => {
      const r = estLabelPx(name, txt, big, plain, kpi);
      return lblScale === 1 ? r : { w: r.w * lblScale, h: r.h * lblScale };
    };
    const maxY = 100 / aspect;                   // ความสูงผังในหน่วย N
    const g = toN(5);                            // ระยะห่างขั้นต่ำจากขอบกรอบ
    const placed = [];
    // ไลน์ที่มีปัญหาได้เลือกที่ก่อน — ที่ไม่พอทุกใบ ตัวที่ต้องรีบเห็นต้องรอด
    const RANK = { down: 5, bad: 4, waiting: 3, ok: 2, good: 1, idle: 0 };
    const sev = (name) => RANK[regCat(stOf(name))] ?? 0;
    /* ป้ายที่ขยับออกจากกรอบต้องมีเส้นโยงกลับ ไม่งั้นดูไม่ออกว่าเป็นของไลน์ไหน
       (พิกัดเส้นเป็นหน่วยผังจริง: x = % ความกว้าง, y = % ความสูง) */
    const linkOf = (b, bb) => {
      if (gapToBox(b, bb) < 0.6) return null;
      const lx = Math.min(Math.max((bb.x0 + bb.x1) / 2, b.x), b.x + b.w);
      const ly = Math.min(Math.max((bb.y0 + bb.y1) / 2, b.y), b.y + b.h);
      return { x1: lx, y1: ly * aspect, x2: (bb.x0 + bb.x1) / 2, y2: (bb.y0 + bb.y1) / 2 * aspect };
    };
    /* ⭐ กติกาหลัก: "ตำแหน่งสำคัญกว่ารายละเอียด"
       ป้ายใหญ่กว่ากรอบตัวเองหลายเท่า (กรอบ Laser GOR กว้าง ~54px แต่ป้ายกว้าง ~180px)
       → จะวางให้ติดกรอบทุกใบโดยไม่ทับกันเป็นไปไม่ได้ถ้ายืนกรานข้อความเต็มทุกใบ
       ลำดับที่ใช้: ลองข้อความเต็มทุกตำแหน่งที่ติดกรอบก่อน → ไม่ได้ค่อยย่อข้อความ → ชื่ออย่างเดียว
       → สุดท้ายถึงยอมขยับออก (มีเส้นโยง) — ห้ามสลับลำดับ (เคยให้ตำแหน่งยืดหยุ่นก่อน
       ผลคือป้ายลอยห่างกรอบตัวเอง 213px user ทัก "ตำแหน่งมั่ว" 2026-08-06)
       วัดกับกรอบจริง: จอ 1800px ข้อมูลเต็มครบ 27/27 ทับ 0 ไม่มีใบไหนต้องขยับ */
    // กรอบพื้นที่ของทุกไลน์ (หน่วย N) — ใช้เป็นสิ่งกีดขวาง ป้ายห้ามไปนั่งทับกรอบไลน์อื่น
    const regionRect = {};
    regions.forEach(r => {
      const xs = r.points.map(p => p[0]), ys = r.points.map(p => p[1]);
      const x0 = Math.min(...xs), y0 = Math.min(...ys) / aspect;
      regionRect[r.line_name] = { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) / aspect - y0 };
    });
    const place = (bbPts, big, levels, ownNames) => {
      const xs = bbPts.map(p => p[0]), ys = bbPts.map(p => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const y0 = Math.min(...ys) / aspect, y1 = Math.max(...ys) / aspect;
      const cyn = (y0 + y1) / 2, bb = { x0, x1, y0, y1 };
      // ทับกรอบตัวเอง/ไลน์ในกลุ่มเดียวกันได้ (ป้ายเกาะกรอบตัวเองเป็นเรื่องปกติ) — ที่เหลือห้ามทับ
      const obstacles = Object.entries(regionRect).filter(([n]) => !ownNames.has(n)).map(([, v]) => v);
      const okIn = (b) => !placed.some(p => boxHit(b, p)) && !obstacles.some(p => boxHit(b, p, 0));
      for (let lvl = 0; lvl < levels.length; lvl++) {
        /* kpi เป็นคุณสมบัติ "ราย level" (2026-08-26 · user ทัก "box ทับกันเละ") — เดิมเป็น flag ทั้ง call
           แล้วการ์ด KPI ถูกส่งมาระดับเดียว = มันคือ level สุดท้ายทันที → เข้าโหมด "ยอมทับ" ทั้งที่ยังย่อได้
           ตอนนี้ chain = [การ์ด KPI, ป้ายเต็ม, ป้ายย่อ, ชื่ออย่างเดียว] — ที่ไม่พอ = สละการ์ด ไม่ใช่ไปทับเพื่อน */
        const kpi = !!levels[lvl].kpi;
        /* ⭐ ป้ายไลน์: ลอง "ข้อความล้วนในกรอบตัวเอง" ก่อน (คำสั่ง user 2026-08-06)
           กรอบไลน์มีพื้นสีอ่อนอยู่แล้ว ไม่ต้องมีการ์ด/ขอบซ้อนอีก → ป้ายเล็กลงมาก
           วัดแล้ว: จอ 1800px มี 17/27 ใบลงในกรอบตัวเองได้ · 1250px ข้อมูลเต็มเพิ่ม 20→21
           และ "เหลือชื่ออย่างเดียว" ลดจาก 3 เหลือ 1 */
        if (!big && !kpi) {
          const { w: pw, h: ph } = est(levels[lvl].name, levels[lvl].txt, big, true);
          const w2 = Math.min(toN(pw), 34), h2 = toN(ph);
          const p2 = toN(2), bx2 = (x0 + x1) / 2 - w2 / 2;
          for (const c of [
            { x: bx2, y: y0 + p2 }, { x: x0 + p2, y: y0 + p2 }, { x: x1 - w2 - p2, y: y0 + p2 },
            { x: bx2, y: cyn - h2 / 2 },
            { x: bx2, y: y1 - h2 - p2 }, { x: x0 + p2, y: y1 - h2 - p2 }, { x: x1 - w2 - p2, y: y1 - h2 - p2 },
          ]) {
            const b = { x: c.x, y: c.y, w: w2, h: h2 };
            // ต้องอยู่ในกรอบตัวเองจริงๆ (ล้นได้เล็กน้อย) ไม่งั้นข้อความลอยบนรูปผังอ่านไม่ออก
            if (b.x >= x0 - toN(3) && b.x + b.w <= x1 + toN(3) && okIn(b)) {
              placed.push(b); return { ...b, lvl, plain: true, link: null };
            }
          }
        }
        const { w: wpx, h: hpx } = est(levels[lvl].name, levels[lvl].txt, big, false, kpi);
        const w = kpi ? toN(wpx) : Math.min(toN(wpx), big ? 36 : 34), h = toN(hpx), bx = (x0 + x1) / 2 - w / 2;
        const cands = big
          ? [ // ป้ายลูกเกาะขอบบนเป็นหลัก → ใต้กรอบกลุ่มว่างโดยธรรมชาติ ลองก่อน
              { x: bx, y: y1 + g }, { x: x0, y: y1 + g }, { x: x1 - w, y: y1 + g },
              { x: bx, y: y0 - h - g }, { x: x0, y: y0 - h - g }, { x: x1 - w, y: y0 - h - g },
              { x: x1 + g, y: cyn - h / 2 }, { x: x0 - w - g, y: cyn - h / 2 },
              { x: x1 + g, y: y1 + g }, { x: x0 - w - g, y: y1 + g },
              { x: x1 + g, y: y0 - h - g }, { x: x0 - w - g, y: y0 - h - g }]
          : [ // ทุกตัวเลือกติดกรอบของตัวเอง — มี "เลื่อนชิดซ้าย/ขวาตามขอบ" ให้หลบเพื่อนบ้านโดยไม่หนีออกจากกรอบ
              { x: bx, y: y0 + toN(2) }, { x: x0, y: y0 + toN(2) }, { x: x1 - w, y: y0 + toN(2) },
              { x: bx, y: y0 - h - g }, { x: x0, y: y0 - h - g }, { x: x1 - w, y: y0 - h - g },
              { x: bx, y: y1 - h - toN(2) }, { x: x0, y: y1 - h - toN(2) }, { x: x1 - w, y: y1 - h - toN(2) },
              { x: bx, y: y1 + g }, { x: x0, y: y1 + g }, { x: x1 - w, y: y1 + g },
              { x: x1 + g, y: cyn - h / 2 }, { x: x0 - w - g, y: cyn - h / 2 },
              { x: bx, y: y0 + h + g }, { x: bx, y: cyn - h / 2 }];
        const last = lvl === levels.length - 1;
        const box = placeBox(cands, w, h, placed, maxY, bb, obstacles, last && compactLbl, last);
        if (box) { placed.push(box); return { ...box, lvl, kpi, link: linkOf(box, bb) }; }
      }
      return null;
    };

    /* ป้ายกลุ่มวางก่อนป้ายไลน์ — ยอดรวมทั้ง family สำคัญกว่ารายไลน์
       เทสกับกรอบจริง: วางกลุ่มก่อน ผังแคบเสียป้ายน้อยลงชัดเจน และจอใหญ่ไม่แย่ลงเลย */
    [...autoHulls]
      .sort((a, b) => sev(b.name) - sev(a.name) || polyArea(b.hull) - polyArea(a.hull))
      .forEach(hh => {
        const st = stOf(hh.name), kids = (childrenOf[hh.name] || []).length;
        const full = lblText(st), sh = shortText(st);
        const levels = [{ name: `▣ ${hh.name}${compactLbl ? '' : `  ${kids} ไลน์`}`, txt: full }];
        if (sh !== full) levels.push({ name: `▣ ${hh.name}`, txt: sh });
        if (levels[levels.length - 1].txt !== '') levels.push({ name: `▣ ${hh.name}`, txt: '' });
        // ป้ายกลุ่มห้ามทับกรอบไลน์ใดๆ เลย (รวมลูกตัวเอง) — เทสแล้วเข้มขนาดนี้ไม่เสียอะไร ยังหาที่ติดกรอบได้ครบ
        const box = place(hh.hull, true, levels, new Set());
        if (box) out.hull[hh.name] = box; else out.hidden.push(hh.name);
      });

    [...regions]
      .sort((a, b) => sev(b.line_name) - sev(a.line_name) || polyArea(b.points) - polyArea(a.points))
      .forEach(r => {
        if (facHidden(r.line_name)) return;   // 🫥 โซนที่ถูกซ่อนตาม metric — ไม่วางป้าย (นับบอกที่ชิปแยก ไม่เข้า out.hidden ของจอแคบ)
        const st = stOf(r.line_name);
        const full = lblText(st), sh = shortText(st);
        const levels = [{ name: r.line_name, txt: full }];
        if (sh !== full) levels.push({ name: r.line_name, txt: sh });
        if (levels[levels.length - 1].txt !== '') levels.push({ name: r.line_name, txt: '' });
        // ⚡/⚙️ เฉพาะจุดที่ "มีข้อมูลจริง" ถึงได้การ์ดใหญ่ — ที่เหลือคงป้ายเล็กเหมือนเดิม
        //    (ถ้าให้ทุกกรอบเป็นการ์ดใหญ่ ผังจะเต็มไปด้วยการ์ด "ยังไม่กรอก" แล้วชนกันจนซ่อนเพียบ
        //     ภาพอ้างอิงเองก็มีการ์ดแค่ 4 ใบบนผังทั้งโรง)
        //    OEE ใช้การ์ดสไตล์เดียวกับพลังงาน (2026-08-25 · คำสั่ง user "รูปแบบคล้ายๆ เรื่องไฟ")
        const isKpi = (metric === 'energy' && st.kwh != null) || (metric === 'oee' && st.oee != null);
        // การ์ด = level แรกของ chain เดียวกับป้ายปกติ — ที่ไม่พอ "สละการ์ด" ย่อเป็นป้าย ไม่ไปทับเพื่อน
        // lvl ที่เก็บถูกปรับกลับเป็น index ของ levels เดิม (renderer แปลง lvl→ข้อความด้วย mapping เดิม)
        const lv = isKpi ? [{ ...levels[0], kpi: true }, ...levels] : levels;
        const box = place(r.points, false, lv, new Set([r.line_name]));
        if (box) out.region[r.id] = box.kpi ? box : { ...box, lvl: box.lvl - (isKpi ? 1 : 0) };
        else out.hidden.push(r.line_name);
      });
    return out;
    // stOf/regCat/lblText/facHidden อ่านสถานะปัจจุบัน — ใส่ state ที่มันพึ่งพาเป็น deps แทน (ตัวฟังก์ชันสร้างใหม่ทุก render)
  }, [regions, autoHulls, childrenOf, wrapW, aspect, metric, editing, showFac, lineStatus, manpower, pmStatus, supplyStatus, facilitySupply, dieZones, storeZones, lblScale]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── หาจุดที่จะวาง: แม่เหล็กจุดแรก > Shift ตั้งฉาก > ปกติ ── */
  const resolveDrawPoint = (p, shift) => {
    if (draft.length >= 3) { const f = draft[0]; if (Math.hypot(f[0] - p.x, f[1] - p.y) < 3) return { pt: [f[0], f[1]], snap: true }; }
    if (shift && draft.length) {
      const last = draft[draft.length - 1];
      return Math.abs(p.x - last[0]) >= Math.abs(p.y - last[1]) ? { pt: [round(p.x), last[1]], snap: false } : { pt: [last[0], round(p.y)], snap: false };
    }
    return { pt: [round(p.x), round(p.y)], snap: false };
  };
  const onMapClick = (e) => {
    if (!editing || !drawing) return;
    if (e.target.closest('[data-handle]') || e.target.closest('button')) return;
    const { pt, snap } = resolveDrawPoint(pctFromEvent(e.clientX, e.clientY), e.shiftKey);
    if (snap) return finishDraw();
    setDraft(prev => [...prev, pt]);
  };
  const onMapMove = (e) => {
    if (drawing) {
      lastRawRef.current = { x: e.clientX, y: e.clientY };
      if (draft.length) { const { pt, snap } = resolveDrawPoint(pctFromEvent(e.clientX, e.clientY), e.shiftKey); setHoverPt(pt); setSnapFirst(snap); }
      return;
    }
    if (dragRef.current) {
      const p = pctFromEvent(e.clientX, e.clientY);
      const d = dragRef.current, dx = p.x - d.px, dy = p.y - d.py;
      setRegions(prev => prev.map(r => {
        if (r.id !== d.id) return r;
        const pts = d.base.map((pt, i) => (d.vi === -1 || d.vi === i) ? [Math.min(100, Math.max(0, round(pt[0] + dx))), Math.min(100, Math.max(0, round(pt[1] + dy)))] : pt);
        return { ...r, points: pts };
      }));
    }
  };
  const finishDraw = () => {
    const pts = draft;
    setDraft([]); setHoverPt(null); setSnapFirst(false); setDrawing(false);
    if (pts.length < 3) return;
    setAssignLine(''); setNewZone(''); setNewZoneType('fac'); setNewZoneKind('fg'); setAssignFor(pts); // ตีกรอบได้เสมอ (ไลน์ผลิต / โซน facility / โซนคลัง / พิมพ์ชื่อโซนใหม่)
  };
  const confirmAssign = async () => {
    const target = (assignLine === '__new__' ? newZone.trim() : assignLine).trim();
    if (!target) return toast.error('เลือกไลน์/โซน หรือพิมพ์ชื่อโซนใหม่ก่อน');
    if (regions.some(r => r.line_name === target)) return toast.error(`"${target}" ถูกตีกรอบไว้แล้ว`);
    const isNewStore = assignLine === '__new__' && newZoneType === 'store'; // จับก่อน reset state
    const storeKind = newZoneKind;
    const pts = assignFor; setAssignFor(null); setNewZone('');
    hist.pushHistory();
    const { data, error } = await supabase.from('factory_line_regions').insert({ line_name: target, points: pts }).select().single();
    if (error) return toast.error('บันทึกไม่สำเร็จ: ' + error.message);
    setRegions(prev => [...prev, { ...data, points: pts }]);
    // 🏬 โซนคลังใหม่จากจอ setup แผนผังโดยตรง — สร้างทะเบียน storage_zones ให้ในขั้นเดียว
    // (คำสั่ง user 2026-08-25 "อ้างอิงจากระบบ setup แผนผัง" — ไม่ต้องไปเริ่มที่ /line-stock ก่อน)
    if (isNewStore) {
      const { error: ze } = await supabaseDR.from('storage_zones').insert({ name: target, kind: storeKind });
      if (ze) {
        // 42P01 = ยังไม่ apply migration · unique = มีทะเบียนอยู่แล้ว (กรอบจับคู่ได้เอง ไม่เป็นไร)
        if (ze.code === '23505') toast.info(`"${target}" มีทะเบียนโซนคลังอยู่แล้ว — กรอบจับคู่ให้อัตโนมัติ`);
        else toast.error(`ตีกรอบแล้ว แต่สร้างทะเบียนโซนคลังไม่สำเร็จ (${ze.message}) — สร้างเองที่ /line-stock แท็บโซนคลัง`);
      } else {
        toast.success(`ตีกรอบ + สร้างทะเบียนโซนคลัง "${target}" แล้ว — ไปผูก MAT/ความจุ ที่ /line-stock แท็บ 🏬 โซนคลัง`);
        loadStoreZones();
        return;
      }
    }
    toast.success(`ตีกรอบ ${target} แล้ว`);
  };
  const cancelDraw = () => { setDraft([]); setHoverPt(null); setSnapFirst(false); setDrawing(false); };

  useEffect(() => {
    if (!drawing) return;
    const recompute = () => {
      if (!lastRawRef.current || !draft.length) return;
      const { pt, snap } = resolveDrawPoint(pctFromEvent(lastRawRef.current.x, lastRawRef.current.y), shiftRef.current);
      setHoverPt(pt); setSnapFirst(snap);
    };
    const down = (e) => { if (e.key === 'Shift') { shiftRef.current = true; recompute(); } if (e.key === 'Escape') cancelDraw(); };
    const up = (e) => { if (e.key === 'Shift') { shiftRef.current = false; recompute(); } };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const startDrag = (e, region, vi) => {
    if (!editing || drawing) return;
    e.stopPropagation();
    wrapRef.current?.setPointerCapture?.(e.pointerId);
    const p = pctFromEvent(e.clientX, e.clientY);
    dragRef.current = { id: region.id, vi, px: p.x, py: p.y, base: region.points.map(pt => [...pt]), snap: regionSnap() };
  };
  const endDrag = async () => {
    if (!dragRef.current) return;
    const d = dragRef.current; dragRef.current = null;
    const r = regions.find(x => x.id === d.id);
    if (!r) return;
    if (JSON.stringify(r.points) === JSON.stringify(d.base)) return;   // คลิกเฉยๆ ไม่ได้ลาก — ไม่บันทึก/ไม่เข้า history
    if (d.snap) hist.pushSnapshot(d.snap);
    await supabase.from('factory_line_regions').update({ points: r.points }).eq('id', d.id);
  };
  const deleteRegion = async (id) => {
    const rg = regions.find(r => r.id === id);
    if (!window.confirm(`ลบกรอบไลน์ "${rg?.line_name || ''}" ?`)) return;
    hist.pushHistory();
    setRegions(prev => prev.filter(r => r.id !== id));
    const { error } = await supabase.from('factory_line_regions').delete().eq('id', id);
    if (error) toast.error(error.message);
  };

  const onImgLoad = (e) => setAspect(e.target.naturalWidth / e.target.naturalHeight);
  // ความกว้างผังจริง — ใช้แปลงขนาดป้าย (px) เป็น % ตอนคำนวณการทับ · ย่อ/ขยายจอแล้วจัดป้ายใหม่เอง
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([en]) => setWrapW(en.contentRect.width));
    ro.observe(el);
    setWrapW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [imageUrl, loading]);
  const wrapStyle = aspect ? { width: `min(100%, calc((100vh - 210px) * ${aspect}))` } : { width: '100%' };
  const ptsStr = (pts) => pts.map(p => `${p[0]},${p[1]}`).join(' ');
  const flashLine = (name) => { setHighlight(name); setTimeout(() => setHighlight(h => h === name ? null : h), 2000); };

  return (
    <div className="page-content" style={{ maxWidth: 'min(98vw, 2400px)', margin: '0 auto' }}>
      <div style={{ display: 'flex', paddingRight: 52, justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(16px,3vw,22px)', color: 'var(--text)' }}>🗺️ ผังรวมโรงงาน</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>ทุกไลน์บนผังเดียว — เลือกดูได้หลายมุมมอง · <b>วางเม้าส์ดูสรุป · คลิกเปิดผังไลน์พร้อมพนักงาน</b> · อัปเดตสดอัตโนมัติ · <b>แผงขวา = สรุปทบทวนทั้งวัน (เลือกวันได้)</b></p>
        </div>
        {canEdit && <button onClick={() => { setEditing(v => !v); cancelDraw(); }} style={{ ...btn(editing), position: 'relative' }}>{editing ? '✓ เสร็จ' : '✏️ แก้ผัง'}<ToggleDot on={editing} /></button>}
      </div>

      {/* เลือก metric */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {Object.entries(METRICS).map(([k, m]) => (
          <button key={k} onClick={() => setMetric(k)} style={btn(metric === k)}>{m.label}</button>
        ))}
        {/* ⚡ พลังงานเป็นข้อมูล "รายเดือน" ไม่ใช่ live เหมือน metric อื่นบนจอนี้ — ต้องประกาศเดือนเสมอ
            ไม่งั้นคนอ่านเป็นค่าปัจจุบัน (จอนี้ทุกอย่างสดหมด) */}
        {!editing && metric === 'energy' && (
          <span style={{ alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, whiteSpace: 'nowrap' }}>
            <b style={{ color: '#f59e0b', background: '#f59e0b1a', border: '1px solid #f59e0b55', borderRadius: 6, padding: '3px 8px' }}>
              📅 {energyMonth ? monthLabel(energyMonth) : 'ยังไม่มีข้อมูล'} · ✍️ กรอกมือรายเดือน
            </b>
            <span style={{ color: 'var(--muted)' }}>
              {energyMonth && energyMonth !== monthKeyOf() && <b style={{ color: '#f59e0b' }}>เดือนล่าสุดที่มีข้อมูล · </b>}
              สีกรอบ = เทียบเดือนก่อน (ลดลง = เขียว)
              {!energyEf && <> · <span title="ตั้งค่าที่ /energy แท็บ ⚙️">ยังไม่ตั้งค่าการปล่อย → ไม่มี tCO2e</span></>}
            </span>
          </span>
        )}
        {!editing && metric === 'energy' && !!energyNoRegion.length && (
          <span title={`ยังไม่ได้ตีกรอบ: ${energyNoRegion.join(', ')}`}
            style={{ alignSelf: 'center', fontSize: 11.5, fontWeight: 700, color: '#f59e0b', background: '#f59e0b1a', border: '1px solid #f59e0b55', borderRadius: 6, padding: '3px 8px', whiteSpace: 'nowrap' }}>
            ⚠ กรอกค่าไฟไว้แต่ยังไม่ได้ตีกรอบบนผัง {energyNoRegion.length} จุด — ตัวเลขไม่โผล่
          </span>
        )}
        {/* 🫥 โซนสนับสนุนถูกซ่อนตาม metric ที่กด — สัญญาณผิดปกติยุบเป็นตัวนับ ⚠ บนชิป (ไม่หายเงียบ) · กดชิปเปิดดูชั่วคราว */}
        {!editing && !!facZones.all.length && (
          <button onClick={() => setShowFac(v => !v)}
            title={facZones.warn.length
              ? `โซนที่มีสัญญาณ: ${facZones.warn.map(n => `${n} (${facHealthText(stOf(n))})`).join(' · ')}`
              : `ซ่อน: ${facZones.all.join(', ')}`}
            style={{ alignSelf: 'center', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', borderRadius: 6, padding: '3px 8px', whiteSpace: 'nowrap',
              background: showFac ? 'var(--bg3)' : facZones.warn.length ? '#f59e0b1a' : 'transparent',
              border: `1px solid ${showFac ? 'var(--border2)' : facZones.warn.length ? '#f59e0b55' : 'var(--border)'}`,
              color: facZones.warn.length ? '#f59e0b' : 'var(--muted)' }}>
            {showFac ? '👁 กำลังแสดงโซนสนับสนุน — แตะเพื่อซ่อน'
              : `🫥 ซ่อนโซนสนับสนุน ${facZones.all.length} โซน${facZones.warn.length ? ` · ⚠ ${facZones.warn.length} มีสัญญาณ` : ''} — แตะเพื่อดู`}
          </button>
        )}
        {/* 🛠️ แผน PM ที่อุปกรณ์ยังไม่ผูกไลน์ — วางบนผังไม่ได้ แต่ต้องรู้ว่ามีค้างอยู่ (ห้ามหายเงียบ) */}
        {!editing && metric === 'pm' && pmOrphan.total > 0 && (
          <Link to="/pm?tab=setup"
            title="ไปตั้ง 'ไลน์' ให้อุปกรณ์ที่ PM Setup — ตั้งแล้วแผนจะขึ้นบนกรอบไลน์นั้นเอง"
            style={{ alignSelf: 'center', fontSize: 11.5, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap', borderRadius: 6, padding: '3px 8px',
              color: pmOrphan.overdue ? '#ef4444' : '#f59e0b',
              background: pmOrphan.overdue ? '#ef44441a' : '#f59e0b1a',
              border: `1px solid ${pmOrphan.overdue ? '#ef444455' : '#f59e0b55'}` }}>
            ⚠ แผน PM {pmOrphan.total} รายการยังไม่ผูกไลน์ — ไม่ขึ้นบนผัง{pmOrphan.overdue ? ` · เกินกำหนดแล้ว ${pmOrphan.overdue}` : ''}
          </Link>
        )}
        {/* legend อธิบายเลขบนป้าย — เลข 3 ตัวติดกันไม่มีคำอธิบายคนอ่านไม่ออก (คำสั่ง user 2026-08-06) */}
        {!editing && metric === 'productivity' && (
          <span style={{ alignSelf: 'center', fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
            <b style={{ color: '#22c55e' }}>ทำได้</b> /
            <b style={{ color: 'var(--text2)' }} title="ถ้าเดินตามจังหวะปกติ ถึงตอนนี้ควรได้เท่านี้ (คิดจากเวลาที่ผลิตได้จริง ÷ รอบเวลาชิ้นงาน)">ควรได้ตอนนี้</b> /
            <b style={{ color: 'var(--text2)' }} title="เป้ารวมของใบงานที่เปิดในกะนี้">เป้ากะ</b>
            <span style={{ opacity: 0.65 }}>· สีกรอบ = ทันจังหวะไหม</span>
          </span>
        )}
        {!editing && !!labelLayout.hidden.length && (
          // จอแคบวางป้ายไม่ครบ — ต้องบอกว่าขาดไปกี่ไลน์ ห้ามให้หายเงียบ + ชี้ทางแก้ (ลดขนาดป้าย/ซ่อนแผงขวา)
          <span title={`ไม่มีที่วางป้าย: ${labelLayout.hidden.join(', ')}\nจอ TV ที่ตั้ง scaling สูงจะเข้าเคสนี้ทั้งที่จอใหญ่ — กด A− ลดขนาดป้าย หรือซ่อนแผงขวา`}
            style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 11.5, fontWeight: 700, color: '#f59e0b', background: '#f59e0b1a', border: '1px solid #f59e0b55', borderRadius: 6, padding: '3px 8px', whiteSpace: 'nowrap' }}>
            ที่ไม่พอ · ซ่อนป้าย {labelLayout.hidden.length} ไลน์ — ลองกด A− / ซ่อนแผงขวา
          </span>
        )}
        {!editing && !labelLayout.hidden.length && !!autoHulls.length && (
          <span style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            <b style={{ color: 'var(--text2)' }}>▣ กลุ่ม</b> (ยอดรวมทั้งกลุ่ม · เส้นประ) · <b style={{ color: 'var(--text2)' }}>↳ ไลน์ย่อย</b> ในกลุ่ม
          </span>
        )}
        {/* ปรับขนาดป้ายต่อเครื่อง + ซ่อนแผงขวา — สำหรับจอ TV ที่ OS scaling ทำสัดส่วนป้าย/ผังเพี้ยน (2026-08-25)
            ค่าจำใน localStorage ของเครื่องนั้น: ตั้งครั้งเดียวต่อจอ ทุกจอเลยดูสม่ำเสมอได้แม้ scaling ไม่เท่ากัน */}
        {!editing && (
          <span style={{ marginLeft: (!labelLayout.hidden.length && !autoHulls.length) ? 'auto' : 0, alignSelf: 'center', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
            title="ขนาดป้ายบนผัง (จำค่าต่อเครื่อง) — จอ TV ที่ป้ายใหญ่/ทับกัน ให้กด A−">
            <button onClick={() => applyScale(lblScale - 0.1)} disabled={lblScale <= 0.6}
              style={{ ...miniTab(false), padding: '3px 8px', fontSize: 12, opacity: lblScale <= 0.6 ? 0.4 : 1 }}>A−</button>
            <span style={{ fontSize: 11, fontWeight: 700, color: lblScale === 1 ? 'var(--muted)' : 'var(--accent)', minWidth: 34, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
              ป้าย {Math.round(lblScale * 100)}%
            </span>
            <button onClick={() => applyScale(lblScale + 0.1)} disabled={lblScale >= 1.6}
              style={{ ...miniTab(false), padding: '3px 8px', fontSize: 12, opacity: lblScale >= 1.6 ? 0.4 : 1 }}>A+</button>
            <button onClick={togglePanelHide} style={{ ...miniTab(panelHide), padding: '3px 8px', fontSize: 11.5 }}
              title={panelHide ? 'แสดงแผงสรุปด้านขวา' : 'ซ่อนแผงขวา — คืนพื้นที่ให้ผัง (เหมาะกับจอ TV)'}>
              {panelHide ? '▶ แผงขวา' : '◀ ซ่อนแผงขวา'}
            </button>
          </span>
        )}
      </div>

      {editing && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
          <label style={{ ...btn(false), display: 'inline-flex', alignItems: 'center', gap: 6, cursor: uploading ? 'default' : 'pointer' }}>
            {uploading ? '⏳ กำลังอัปโหลด...' : (imageUrl ? '🖼️ เปลี่ยนรูปผัง' : '🖼️ อัปโหลดรูปผังโรงงาน')}
            <input type="file" accept="image/*" onChange={handleUpload} disabled={uploading} style={{ display: 'none' }} />
          </label>
          {imageUrl && !drawing && <button onClick={() => { setDrawing(true); setDraft([]); }} style={btn(false)}>✏️ วาดกรอบใหม่ (ไลน์ / 🏬 โซนคลัง / 🔧 facility)</button>}
          {!drawing && <button onClick={hist.undo} disabled={!hist.canUndo || hist.busy} style={undoBtnStyle(hist.canUndo && !hist.busy)} title="ย้อนกลับ (Ctrl+Z)">↩️ Undo</button>}
          {!drawing && <button onClick={hist.redo} disabled={!hist.canRedo || hist.busy} style={undoBtnStyle(hist.canRedo && !hist.busy)} title="ทำซ้ำ (Ctrl+Y)">↪️ Redo</button>}
          {drawing && (
            <>
              <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>🖊️ คลิกทีละจุดล้อมพื้นที่ (L/U ได้) · กด <b>Shift</b> = เส้นตั้งฉาก · เข้าใกล้จุดแรก = ดูดปิดรูป</span>
              <button onClick={finishDraw} disabled={draft.length < 3} style={btn(true)}>✓ เสร็จ ({draft.length} จุด)</button>
              <button onClick={() => setDraft(p => p.slice(0, -1))} disabled={!draft.length} style={btn(false)}>↩ ลบจุดล่าสุด</button>
              <button onClick={cancelDraw} style={btn(false)}>✕ ยกเลิก</button>
            </>
          )}
          {!drawing && <span style={{ fontSize: 12, color: 'var(--muted)' }}>ลากกลางรูป=ย้าย · ลากจุดมุม=ปรับรูปทรง</span>}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>ตีกรอบแล้ว {framedTopCount}/{topNames.length} ไลน์ (กลุ่มบนสุด · รวมยอดลูกให้อัตโนมัติ)</span>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด...</div>
      ) : !imageUrl ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)', background: 'var(--card)', border: '1px dashed var(--border2)', borderRadius: 12 }}>
          ยังไม่มีรูปผังโรงงาน — {canEdit ? 'กด "✏️ แก้ผัง" แล้วอัปโหลดรูป' : 'ให้ผู้ดูแลอัปโหลดรูปผังก่อน'}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* ── ผัง ── */}
          <div style={{ flex: '1 1 640px', minWidth: 0, display: 'flex', justifyContent: 'center' }}>
          <div ref={wrapRef} onClick={onMapClick} onPointerMove={onMapMove} onPointerUp={endDrag} onPointerCancel={endDrag}
            style={{ position: 'relative', ...wrapStyle, maxHeight: 'calc(100vh - 200px)', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', cursor: drawing ? 'crosshair' : 'default', touchAction: 'none', background: '#0a0a0f' }}>
            <img src={imageUrl} alt="ผังโรงงาน" onLoad={onImgLoad} style={{ display: 'block', width: '100%', height: 'auto', pointerEvents: 'none', userSelect: 'none' }} />
            {/* scrim บางๆ ให้กรอบเด่นแต่ยังเห็นผังชัด (ไม่หรี่จนภาพหม่น) */}
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(6,8,14,0.14)', pointerEvents: 'none' }} />

            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
              {/* กรอบแม่อัตโนมัติ — เส้นประล้อมลูก (วาดก่อน = อยู่ใต้กรอบลูก คลิก/hover เฉพาะพื้นที่ระหว่างลูก) */}
              {!editing && autoHulls.map(h => {
                const meta = CAT[regCat(stOf(h.name))];
                return (
                  <polygon key={`hull-${h.name}`} points={ptsStr(h.hull)}
                    fill={`${meta.color}14`} stroke={meta.color} strokeWidth={hoverLine === h.name || highlight === h.name ? '3' : '1.6'}
                    strokeDasharray="6 4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" opacity={0.9}
                    style={{ pointerEvents: drawing ? 'none' : 'auto', cursor: 'pointer' }}
                    onClick={(e) => { e.stopPropagation(); openLine(h.name); }}
                    onPointerEnter={(e) => { if (e.pointerType === 'mouse') { setHoverLine(h.name); setHoverXY({ x: e.clientX, y: e.clientY }); } }}
                    onPointerMove={(e) => { if (e.pointerType === 'mouse') setHoverXY({ x: e.clientX, y: e.clientY }); }}
                    onPointerLeave={() => setHoverLine(hv => hv === h.name ? null : hv)} />
                );
              })}
              {regions.map(r => {
                if (facHidden(r.line_name)) return null;   // 🫥 กรอบขึ้นตาม metric ที่กด — โซนสนับสนุนสถานะปกติไม่วาด (นับที่ชิป 🫥)
                const cat = regCat(stOf(r.line_name)); const meta = CAT[cat]; const hl = highlight === r.line_name || hoverLine === r.line_name;
                return (
                  <polygon key={r.id} data-region points={ptsStr(r.points)}
                    className={meta.blink ? 'region-alarm' : undefined}
                    fill={meta.blink ? undefined : `${meta.color}${hl ? '55' : '2b'}`} stroke={meta.blink ? undefined : meta.color}
                    strokeWidth={hl ? '3.5' : '1.75'} vectorEffect="non-scaling-stroke" strokeLinejoin="round"
                    style={{ pointerEvents: drawing ? 'none' : 'auto', cursor: editing ? 'move' : 'pointer' }}
                    onClick={(e) => { if (!editing) { e.stopPropagation(); openLine(r.line_name); } }}
                    onPointerEnter={!editing ? (e) => { if (e.pointerType === 'mouse') { setHoverLine(r.line_name); setHoverXY({ x: e.clientX, y: e.clientY }); } } : undefined}
                    onPointerMove={!editing ? (e) => { if (e.pointerType === 'mouse') setHoverXY({ x: e.clientX, y: e.clientY }); } : undefined}
                    onPointerLeave={!editing ? () => setHoverLine(h => h === r.line_name ? null : h) : undefined}
                    onPointerDown={editing && !drawing ? (e) => startDrag(e, r, -1) : undefined} />
                );
              })}
              {drawing && draft.length > 0 && (
                <polyline points={ptsStr(hoverPt ? [...draft, hoverPt] : draft)} fill={snapFirst ? 'rgba(34,197,94,0.18)' : 'rgba(77,159,255,0.12)'} stroke={snapFirst ? '#22c55e' : '#4d9fff'} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeDasharray="3 2" />
              )}
              {/* เส้นโยงป้าย↔กรอบ — เฉพาะป้ายที่ต้องขยับออกจากกรอบเพื่อหลบป้ายอื่น
                  (ป้ายที่ยังติดกรอบไม่มีเส้น จะได้ไม่รกโดยไม่จำเป็น) */}
              {/* เส้นโยง 3 ชั้น: halo ดำ + เส้นสี + จุดปลายฝั่งกรอบ — เดิมเส้นเดียวจาง 0.55 มองไม่เห็นบนภาพถ่ายผัง
                  (user ทัก 2026-08-25 "เส้นไกด์ที่ชี้กลับไปที่ไลน์มองไม่เห็นเลย")
                  ⚠️ จุดปลายใช้ line ยาว 0 + linecap round (วาดเป็นวงกลมขนาด px คงที่) — ห้ามใช้ <circle r="%">
                  เพราะ viewBox ถูกยืด preserveAspectRatio=none วงกลมจะเบี้ยวเป็นวงรี */}
              {!editing && [
                ...regions.map(r => [labelLayout.region[r.id]?.link, CAT[regCat(stOf(r.line_name))].color, `lk-r-${r.id}`]),
                ...autoHulls.map(h => [labelLayout.hull[h.name]?.link, CAT[regCat(stOf(h.name))].color, `lk-h-${h.name}`]),
              ].filter(([l]) => l).map(([l, color, key]) => (
                // เส้นบาง + drop-shadow จางๆ พออ่านออกบนภาพถ่าย — ห้ามกลับไปใช้ halo ดำหนา (user: "พอเป็นสีดำดูอึดอัด")
                <g key={key} pointerEvents="none" style={{ filter: 'drop-shadow(0 0 1.2px rgba(0,0,0,0.9))' }}>
                  <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                    stroke={color} strokeWidth="1.6" strokeDasharray="4 3" opacity={0.9} vectorEffect="non-scaling-stroke" />
                  <line x1={l.x2} y1={l.y2} x2={l.x2} y2={l.y2}
                    stroke={color} strokeWidth="4.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                </g>
              ))}
            </svg>

            {drawing && draft.map((pt, i) => (
              <div key={`d-${i}`} style={{ position: 'absolute', left: `${pt[0]}%`, top: `${pt[1]}%`, width: i === 0 ? (snapFirst ? 22 : 16) : 11, height: i === 0 ? (snapFirst ? 22 : 16) : 11, transform: 'translate(-50%,-50%)', borderRadius: '50%', background: i === 0 ? (snapFirst ? 'rgba(34,197,94,0.35)' : 'rgba(77,159,255,0.3)') : '#4d9fff', border: `2px solid ${i === 0 ? '#22c55e' : '#fff'}`, pointerEvents: 'none', transition: 'width .1s,height .1s' }} />
            ))}

            {/* ป้ายกลุ่ม (กรอบแม่อัตโนมัติ) — ยอดรวมทั้ง family (รวมคนที่เช็คชื่อผูกไลน์แม่)
                แยกจากป้ายไลน์ให้ชัด (2026-08-06): ▣ + ขอบประหนา + ตัวใหญ่กว่า + ชิปบอกจำนวนไลน์ย่อย */}
            {!editing && autoHulls.map(h => {
              const box = labelLayout.hull[h.name];
              if (labelLayout.ready && !box) return null;   // จอแคบ ไม่มีที่ว่างจริง → นับไปบอกบนจอแทน (ห้ามวาดทับ)
              const st = stOf(h.name); const meta = CAT[regCat(st)];
              // ข้อความตามระดับที่ layout เลือกไว้ (ที่ไม่พอ = ย่อลง แทนที่จะทับ/ลอยหนีกรอบ)
              const txt = !box || box.lvl === 0 ? lblText(st) : box.lvl === 1 ? shortText(st) : '';
              const kids = (compactLbl || (box && box.lvl > 0)) ? 0 : (childrenOf[h.name] || []).length;
              const posStyle = box
                ? { left: `${box.x}%`, top: `${box.y * aspect}%`, width: `${box.w}%` }
                : { left: `${centroid(h.hull)[0]}%`, top: `${centroid(h.hull)[1]}%`, transform: 'translate(-50%,-50%)', maxWidth: '32%' };
              return (
                <div key={`hlbl-${h.name}`}
                  style={{ position: 'absolute', ...posStyle, pointerEvents: editing ? 'none' : 'auto', cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); openLine(h.name); }}
                  onPointerEnter={(e) => { if (e.pointerType === 'mouse') { setHoverLine(h.name); setHoverXY({ x: e.clientX, y: e.clientY }); } }}
                  onPointerMove={(e) => { if (e.pointerType === 'mouse') setHoverXY({ x: e.clientX, y: e.clientY }); }}
                  onPointerLeave={() => setHoverLine(hv => hv === h.name ? null : hv)}>
                  {/* zoom = ตัวเดียวกับที่ est ในการจองพื้นที่คูณไว้ — ใช้ zoom (ลด layout จริง) ไม่ใช่ transform (ภาพลวงตา) ตามบทเรียน fitOnePage */}
                  <div style={{ ...(lblScale !== 1 ? { zoom: lblScale } : {}), background: 'linear-gradient(180deg, rgba(8,10,16,0.93), rgba(8,10,16,0.82))', border: `2px dashed ${meta.color}`, borderRadius: 9, padding: '3px 9px 4px', textAlign: 'center', textShadow: '0 1px 3px rgba(0,0,0,0.95)', boxShadow: `0 3px 14px rgba(0,0,0,0.45), inset 0 0 0 1px ${meta.color}22` }}>
                    <div style={{ fontSize: 'clamp(12px,1.15vw,16px)', fontWeight: 800, color: '#fff', letterSpacing: 0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.25 }}>
                      {st.dtActive && metric !== 'breakdown' && <span className="dt-alarm-icon" style={{ color: '#ef4444' }}>🔴 </span>}▣ {h.name}
                      {kids > 0 && <span style={{ fontSize: '0.72em', fontWeight: 700, color: 'rgba(255,255,255,0.62)', marginLeft: 5 }}>{kids} ไลน์</span>}
                    </div>
                    {txt && <div style={{ fontSize: 'clamp(11px,1vw,13.5px)', fontWeight: 800, color: meta.color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.25 }}>{txt}</div>}
                  </div>
                </div>
              );
            })}

            {/* ป้ายไลน์ = การ์ดทึบมีขอบสีสถานะ (อ่านออกทุกพื้นหลัง) + จุดแดงถ้า downtime ค้าง
                ตำแหน่งมาจาก labelLayout (กันทับกัน) — ยังไม่รู้ขนาดผัง = ถอยไปเกาะขอบบนแบบเดิม
                ไลน์ที่เป็น "ลูก" ของกลุ่ม นำหน้าด้วย ↳ ให้อ่านออกว่าอยู่ใต้กลุ่มไหน (2026-08-06)
                ข้อมูลครบทุกตัวเหมือนเดิม (คำสั่ง user 2026-08-04) */}
            {regions.map(r => {
              if (facHidden(r.line_name)) return null;      // 🫥 โซนที่ซ่อนตาม metric — ป้ายก็ไม่วาด
              const box = labelLayout.region[r.id];
              if (labelLayout.ready && !box) return null;   // จอแคบ ไม่มีที่ว่างจริง → กรอบสียังบอกสถานะ แตะดูรายละเอียดได้
              const [cx, cy] = labelAnchor(r.points);
              const st = stOf(r.line_name); const meta = CAT[regCat(st)];
              const txt = !box || box.lvl === 0 ? lblText(st) : box.lvl === 1 ? shortText(st) : '';
              const parent = parentOf[r.line_name];
              const posStyle = box
                ? { left: `${box.x}%`, top: `${box.y * aspect}%`, width: `${box.w}%` }
                : { left: `${cx}%`, top: `${cy}%`, transform: 'translate(-50%, 2px)', maxWidth: '30%' };
              /* ⚡ การ์ด KPI พลังงาน — โครงตามภาพอ้างอิงที่ทีมส่งมา (การ์ด kW ลอยเหนืออุปกรณ์บนผังโรงงาน)
                 ชื่อจุด (เล็ก) / เลขใหญ่ + หน่วย / ป้าย %เทียบเดือนก่อน / กราฟจิ๋วย้อนหลัง
                 ⚠️ เฉพาะจุดที่มีค่าไฟจริง — จุดที่ยังไม่กรอกคงป้ายเล็กเหมือนเดิม ไม่งั้นผังเต็มไปด้วยการ์ดเปล่า */
              /* ⚙️ การ์ด KPI OEE — สไตล์เดียวกับการ์ดพลังงาน (2026-08-25 · คำสั่ง user "รูปแบบคล้ายๆ เรื่องไฟ")
                 ชื่อไลน์ / เลข OEE ใหญ่ + สปาร์คไลน์ 7 วัน / Δ เทียบวันก่อนเป็น "จุด" (ไม่ใช่ %เปลี่ยน — OEE เป็น % อยู่แล้ว)
                 ทิศสีกลับด้านกับไฟ: OEE ขึ้น = เขียว · ลง = แดง · ไม่มีวันก่อนให้เทียบ = บอกตรงๆ ห้ามเดา */
              if (box?.kpi && metric === 'oee') {
                const hist = oeeHistBy[r.line_name];
                const d = hist?.prev != null && st.oee != null ? Math.round((st.oee - hist.prev) * 10) / 10 : null;
                const dCol = d == null ? 'rgba(255,255,255,0.55)' : d >= 1 ? '#22c55e' : d <= -1 ? '#ef4444' : 'rgba(255,255,255,0.75)';
                const series = hist ? [...hist.series, st.oee] : null;
                return (
                  <div key={`lbl-${r.id}`}
                  /* ป้าย/การ์ดต้องคลิกได้ = เข้าไลน์ของป้ายเสมอ (2026-08-26 · user ทัก "คลิก box LASER ดันเข้า HYDRO
                     เพราะ box ลอยทับกรอบไลน์อื่น") — เดิม pointerEvents:none คลิกทะลุไปโดนกรอบข้างใต้ */
                  style={{ position: 'absolute', ...posStyle, pointerEvents: editing ? 'none' : 'auto', cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); openLine(r.line_name); }}
                  onPointerEnter={(e) => { if (e.pointerType === 'mouse') { setHoverLine(r.line_name); setHoverXY({ x: e.clientX, y: e.clientY }); } }}
                  onPointerMove={(e) => { if (e.pointerType === 'mouse') setHoverXY({ x: e.clientX, y: e.clientY }); }}
                  onPointerLeave={() => setHoverLine(hv => hv === r.line_name ? null : hv)}>
                    <div style={{
                      ...(lblScale !== 1 ? { zoom: lblScale } : {}),
                      background: 'linear-gradient(180deg, rgba(6,10,18,0.94), rgba(6,10,18,0.86))',
                      border: `1px solid ${meta.color}88`, borderLeft: `3px solid ${meta.color}`,
                      borderRadius: 8, padding: '5px 9px 6px', boxShadow: '0 4px 18px rgba(0,0,0,0.55)',
                      textShadow: '0 1px 3px rgba(0,0,0,0.95)', maxWidth: 150,
                    }}>
                      <div style={{ fontSize: 9.5, fontWeight: 800, color: 'rgba(255,255,255,0.72)', letterSpacing: 0.3,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textTransform: 'uppercase', lineHeight: 1.25 }}>
                        {st.dtActive && <span className="dt-alarm-icon" style={{ color: '#ef4444' }}>🔴 </span>}
                        {parent && <span style={{ color: 'rgba(255,255,255,0.5)' }}>↳ </span>}{r.line_name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginTop: 1 }}>
                        <span style={{ fontSize: 'clamp(17px,1.5vw,22px)', fontWeight: 900, color: '#fff', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                          {Math.round(st.oee)}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6 }}>% OEE</span>
                        <span style={{ marginLeft: 'auto' }}><Spark data={series} color={meta.color} /></span>
                      </div>
                      {/* แถวเนื้อหาการ์ดทุกแถวต้อง nowrap — ข้อความยาวห้ามดันการ์ดสูงเกิน KPI_H ที่ layout จองไว้ (2026-08-26 "box ทับกันเละ") */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, fontSize: 9.5, fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                        <span style={{ color: dCol }}>{d == null ? 'ไม่มีฐานเทียบ' : `${d > 0 ? '▲ +' : d < 0 ? '▼ ' : ''}${d} จุด·วันก่อน`}</span>
                        {st.oeeLive && <span style={{ color: 'rgba(255,255,255,0.55)' }}>· สด</span>}
                        {st.oeeCtPartial && <span style={{ color: '#f59e0b' }}>· ⚠CT ไม่ครบ</span>}
                        {st.oeePOver && <span style={{ color: '#f59e0b' }}>· ⚠%P ตัน</span>}
                      </div>
                      {/* แตก A·P·Q ให้เห็นบนการ์ด (user 2026-08-25 "บอกแต่ OEE ก็ทำแต่ OEE หรอ") — ถ่วงน้ำหนักตามกฎแล้วใน stOf */}
                      {(st.oeeA != null || st.oeeP != null || st.oeeQ != null) && (
                        <div style={{ display: 'flex', gap: 7, marginTop: 2, fontSize: 9.5, fontWeight: 800, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                          <span style={{ color: '#4ade80' }}>A {st.oeeA != null ? Math.round(st.oeeA) : '–'}</span>
                          <span style={{ color: '#60a5fa' }}>P {st.oeeP != null ? Math.round(st.oeeP) : '–'}</span>
                          <span style={{ color: '#c084fc' }}>Q {st.oeeQ != null ? Math.round(st.oeeQ) : '–'}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
              if (box?.kpi) {
                const d = energyDelta(st);
                const dCol = d == null ? 'rgba(255,255,255,0.55)' : d <= -5 ? '#22c55e' : d > 10 ? '#ef4444' : 'rgba(255,255,255,0.75)';
                return (
                  <div key={`lbl-${r.id}`}
                  /* ป้าย/การ์ดต้องคลิกได้ = เข้าไลน์ของป้ายเสมอ (2026-08-26 · user ทัก "คลิก box LASER ดันเข้า HYDRO
                     เพราะ box ลอยทับกรอบไลน์อื่น") — เดิม pointerEvents:none คลิกทะลุไปโดนกรอบข้างใต้ */
                  style={{ position: 'absolute', ...posStyle, pointerEvents: editing ? 'none' : 'auto', cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); openLine(r.line_name); }}
                  onPointerEnter={(e) => { if (e.pointerType === 'mouse') { setHoverLine(r.line_name); setHoverXY({ x: e.clientX, y: e.clientY }); } }}
                  onPointerMove={(e) => { if (e.pointerType === 'mouse') setHoverXY({ x: e.clientX, y: e.clientY }); }}
                  onPointerLeave={() => setHoverLine(hv => hv === r.line_name ? null : hv)}>
                    <div style={{
                      ...(lblScale !== 1 ? { zoom: lblScale } : {}),
                      background: 'linear-gradient(180deg, rgba(6,10,18,0.94), rgba(6,10,18,0.86))',
                      border: `1px solid ${meta.color}88`, borderLeft: `3px solid ${meta.color}`,
                      borderRadius: 8, padding: '5px 9px 6px', boxShadow: '0 4px 18px rgba(0,0,0,0.55)',
                      textShadow: '0 1px 3px rgba(0,0,0,0.95)', maxWidth: 150,
                    }}>
                      <div style={{ fontSize: 9.5, fontWeight: 800, color: 'rgba(255,255,255,0.72)', letterSpacing: 0.3,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textTransform: 'uppercase', lineHeight: 1.25 }}>
                        {st.dtActive && <span className="dt-alarm-icon" style={{ color: '#ef4444' }}>🔴 </span>}
                        {st.isFac ? (st.storeZone ? `${zoneKindMeta(st.storeZone.kind).icon} ` : st.die ? '🔨 ' : '🔧 ') : ''}{r.line_name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginTop: 1 }}>
                        <span style={{ fontSize: 'clamp(17px,1.5vw,22px)', fontWeight: 900, color: '#fff', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                          {fmtKwh(st.kwh)}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6 }}>kWh</span>
                        <span style={{ marginLeft: 'auto' }}><Spark data={st.kwhSeries} color={meta.color} /></span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, fontSize: 9.5, fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                        <span style={{ color: dCol }}>{d == null ? 'ไม่มีฐานเทียบ' : `${d > 0 ? '+' : ''}${d}%`}</span>
                        {st.kwhCo2 != null && <span style={{ color: 'rgba(255,255,255,0.55)' }}>· 🌱 {fmtTco2e(st.kwhCo2)} t</span>}
                        {st.kwhCost > 0 && <span style={{ color: 'rgba(255,255,255,0.55)' }}>· ฿{fmtKwh(st.kwhCost)}</span>}
                      </div>
                    </div>
                  </div>
                );
              }
              return (
                <div key={`lbl-${r.id}`}
                  /* ป้าย/การ์ดต้องคลิกได้ = เข้าไลน์ของป้ายเสมอ (2026-08-26 · user ทัก "คลิก box LASER ดันเข้า HYDRO
                     เพราะ box ลอยทับกรอบไลน์อื่น") — เดิม pointerEvents:none คลิกทะลุไปโดนกรอบข้างใต้ */
                  style={{ position: 'absolute', ...posStyle, pointerEvents: editing ? 'none' : 'auto', cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); openLine(r.line_name); }}
                  onPointerEnter={(e) => { if (e.pointerType === 'mouse') { setHoverLine(r.line_name); setHoverXY({ x: e.clientX, y: e.clientY }); } }}
                  onPointerMove={(e) => { if (e.pointerType === 'mouse') setHoverXY({ x: e.clientX, y: e.clientY }); }}
                  onPointerLeave={() => setHoverLine(hv => hv === r.line_name ? null : hv)}>
                  {/* ป้ายที่ลงในกรอบไลน์ตัวเองได้ = ข้อความล้วน ไม่มีการ์ด/ขอบ (กรอบมีพื้นสีอ่อนอยู่แล้ว
                      ซ้อนการ์ดอีกชั้นทั้งเปลืองที่ทั้งรก) · ป้ายที่ต้องออกไปอยู่นอกกรอบยังใช้การ์ด
                      ไม่งั้นตัวหนังสือลอยบนรูปถ่ายผังอ่านไม่ออก */}
                  <div style={{
                    ...(lblScale !== 1 ? { zoom: lblScale } : {}),
                    ...(box?.plain
                      ? { textAlign: 'center', textShadow: '0 1px 2px #000, 0 0 7px rgba(0,0,0,0.95)' }
                      : { background: 'linear-gradient(180deg, rgba(8,10,16,0.78), rgba(8,10,16,0.58))', border: `1px solid ${meta.color}66`, borderBottom: `2.5px solid ${meta.color}`, borderRadius: 7, padding: '2px 8px 3px', textAlign: 'center', textShadow: '0 1px 3px rgba(0,0,0,0.95)', boxShadow: '0 2px 10px rgba(0,0,0,0.35)' }),
                  }}>
                    <div style={{ fontSize: 'clamp(11px,1vw,14px)', fontWeight: 800, color: '#fff', letterSpacing: 0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>
                      {st.dtActive && metric !== 'breakdown' && <span className="dt-alarm-icon" style={{ color: '#ef4444' }}>🔴 </span>}
                      {parent && <span title={`ไลน์ย่อยของ ${parent}`} style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 700, marginRight: 2 }}>↳</span>}
                      {st.isFac && (st.storeZone ? `${zoneKindMeta(st.storeZone.kind).icon} ` : st.die ? '🔨 ' : '🔧 ')}{r.line_name}
                    </div>
                    {txt && <div style={{ fontSize: 'clamp(10px,0.9vw,12.5px)', fontWeight: 800, color: meta.color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.25, opacity: 0.95 }}>{txt}</div>}
                  </div>
                </div>
              );
            })}

            {editing && !drawing && regions.map(r => {
              const [cx, cy] = centroid(r.points);
              return (
                <div key={`h-${r.id}`}>
                  {r.points.map((pt, i) => (
                    <div key={i} data-handle onPointerDown={(e) => startDrag(e, r, i)} style={{ position: 'absolute', left: `${pt[0]}%`, top: `${pt[1]}%`, width: 14, height: 14, transform: 'translate(-50%,-50%)', background: '#4d9fff', border: '2px solid #fff', borderRadius: 3, cursor: 'grab', touchAction: 'none' }} />
                  ))}
                  <button onClick={(e) => { e.stopPropagation(); deleteRegion(r.id); }} title={`ลบกรอบ ${r.line_name}`} style={{ position: 'absolute', left: `${cx}%`, top: `${cy}%`, transform: 'translate(-50%,-140%)', width: 22, height: 22, borderRadius: 6, border: 'none', background: 'rgba(239,68,68,0.92)', color: '#fff', fontSize: 13, cursor: 'pointer', lineHeight: 1 }}>✕</button>
                </div>
              );
            })}
          </div>
          </div>

          {/* ── side panel: สรุปทบทวนรายวัน (default) / จัดอันดับสด (ใช้พื้นที่ข้าง) ──
              จอ TV ซ่อนได้ (ปุ่ม ◀ ในแถบ metric) — คืนความกว้างให้ผัง ~360px แล้ว wrapW มักพ้นเกณฑ์ compact */}
          {!editing && !panelHide && (
            <aside style={{ flex: '0 0 360px', maxWidth: '100%', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
              {/* สลับโหมดแผง */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                <button onClick={() => setPanelMode('review')} style={{ ...miniTab(panelMode === 'review'), flex: 1 }}>📅 สรุปทบทวนรายวัน</button>
                <button onClick={() => setPanelMode('live')} style={{ ...miniTab(panelMode === 'live'), flex: 1 }}>⚡ สด (จัดอันดับ)</button>
              </div>

              {panelMode === 'review' ? (
                <>
                  {/* ตัวเลือกวันที่ */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <button onClick={() => setReviewDate(d => shiftDate(d, -1))} style={navBtn}>◀</button>
                    <input type="date" value={reviewDate} max={getWorkDate()} onChange={e => e.target.value && setReviewDate(e.target.value)}
                      style={{ width: 150, padding: '6px 8px', borderRadius: 8, fontSize: 13, textAlign: 'center' }} />
                    <button onClick={() => setReviewDate(d => (d < getWorkDate() ? shiftDate(d, 1) : d))} disabled={reviewDate >= getWorkDate()} style={{ ...navBtn, opacity: reviewDate >= getWorkDate() ? 0.4 : 1 }}>▶</button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' }}>{fmtThaiDate(reviewDate)}</div>
                    {reviewDate !== reviewDefaultDate() && <button onClick={() => setReviewDate(reviewDefaultDate())} style={{ ...miniTab(false), padding: '2px 8px', fontSize: 11 }}>↺ วันล่าสุด</button>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>ภาพรวมทั้งวัน (กะเช้า+ดึก) สำหรับประชุมผู้จัดการ · เรียงไลน์ที่ทำได้ต่ำสุดขึ้นบน · คลิกแถวเปิดผังไลน์</div>

                  {/* สรุปทั้งโรงงาน */}
                  {(() => {
                    const t = reviewTotals; const pct = t.target > 0 ? Math.round(t.actual / t.target * 100) : null;
                    const stats = [
                      { label: 'ผลิตได้รวม / เป้า', val: `${fmtNum(t.actual)}/${fmtNum(t.target)}${pct != null ? ` · ${pct}%` : ''}`, color: pctCol(pct) },
                      { label: 'OEE เฉลี่ย', val: t.oee != null ? `${t.oee}%` : '—', color: oeeCol(t.oee),
                        explain: t.oeeRows?.length ? { title: 'OEE เฉลี่ยทั้งโรงงาน', rows: t.oeeRows } : null },
                      { label: 'Downtime รวม', val: `${fmtNum(t.dtMin)} น.`, color: t.dtMin > 0 ? '#f59e0b' : 'var(--text)' },
                      { label: 'ของเสียรวม', val: fmtNum(t.ng), color: t.ng > 0 ? '#ef4444' : 'var(--text)' },
                      { label: 'คนเข้างาน', val: t.headTotal > 0 ? `${t.present}/${t.headTotal}` : '—', color: 'var(--text)' },
                    ];
                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 14 }}>
                        {stats.map(s => (
                          <div key={s.label} onClick={s.explain ? () => setOeeExplain(s.explain) : undefined}
                            title={s.explain ? 'ดูวิธีคิดค่าเฉลี่ย' : undefined}
                            style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '7px 10px', cursor: s.explain ? 'pointer' : 'default' }}>
                            <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600 }}>
                              {s.label}{s.explain && <span style={{ color: 'var(--accent)', fontWeight: 800 }}> ⓘ</span>}
                            </div>
                            <div style={{ fontSize: 15, fontWeight: 800, color: s.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{s.val}</div>
                            {s.explain && <div style={{ fontSize: 9.5, color: 'var(--muted)' }}>ถ่วงน้ำหนักตามเวลารับภาระ</div>}
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {reviewLoading ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)', padding: 16, textAlign: 'center' }}>กำลังโหลด...</div>
                  ) : reviewRanked.every(x => !x.r.target && !x.r.dtMin && !x.r.ng && x.r.oee == null) ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)', padding: 20, textAlign: 'center' }}>ไม่มีข้อมูลการผลิตของวันที่เลือก</div>
                  ) : reviewRanked.map(({ name, r }, i) => {
                    const noData = !r.target && !r.dtMin && !r.ng && r.oee == null;
                    if (noData) return null;
                    const hasRegion = regions.some(rg => rg.line_name === name);
                    const kids = (childrenOf[name] || []).filter(k => { const kr = reviewStatus[k]; return kr && (kr.target || kr.dtMin || kr.ng || kr.oeeN); });
                    const hasKids = kids.length > 0;
                    const pct = r.target > 0 ? Math.round(r.actual / r.target * 100) : null;
                    return (
                      // ไลน์แม่ที่มีลูก → คลิกเปิด breakdown ไลน์ย่อย · ไลน์เดี่ยว → เปิดผังไลน์พร้อมพนักงาน
                      <div key={name} onClick={() => { if (hasKids) { setReviewDetail(name); } else { if (hasRegion) flashLine(name); openLine(name, reviewDate); } }}
                        style={{ padding: '8px 10px', borderRadius: 9, marginBottom: 5, cursor: 'pointer', background: highlight === name ? 'var(--bg2)' : 'var(--bg3)', border: `1px solid ${highlight === name ? pctCol(pct) : 'var(--border2)'}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 5 }}>
                          <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', width: 18, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                          <div style={{ minWidth: 0, flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {name}{hasKids ? <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}> · ▸ {kids.length} ไลน์ย่อย</span> : (!hasRegion && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}> · ยังไม่ตีกรอบ</span>)}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 800, color: pctCol(pct), whiteSpace: 'nowrap', flexShrink: 0 }}>{r.target > 0 ? `${fmtNum(r.actual)}/${fmtNum(r.target)} · ${pct}%` : '—'}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 27 }}>
                          <Chip label="OEE" val={r.oee != null ? `${r.oee}%` : '—'} color={oeeCol(r.oee)} />
                          <Chip label="DT" val={`${fmtNum(r.dtMin)}น.`} color={r.dtMin > 0 ? '#f59e0b' : 'var(--muted)'} />
                          <Chip label="NG" val={fmtNum(r.ng)} color={r.ng > 0 ? '#ef4444' : 'var(--muted)'} />
                          {r.headTotal > 0 && <Chip label="คน" val={`${r.present}/${r.headTotal}`} color="var(--text2)" />}
                        </div>
                      </div>
                    );
                  })}
                </>
              ) : (() => {
                // ── โหมดสด (จัดอันดับตาม metric ที่เลือก) — เดิม ──
                const counts = ranked.reduce((a, r) => { a[r.cat] = (a[r.cat] || 0) + 1; return a; }, {});
                const maxVal = Math.max(1, ...ranked.map(r => (r.val == null ? 0 : Math.abs(r.val))));
                const isPct = ['productivity', 'oee', 'people'].includes(metric);
                return (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>{M.label} — จัดอันดับ (สด)</div>
                    {/* สรุปจำนวนไลน์ตามสถานะ */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                      {['bad', 'down', 'ok', 'good', 'waiting', 'idle'].filter(c => counts[c]).map(c => (
                        <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: CAT[c].color, background: `${CAT[c].color}1a`, border: `1px solid ${CAT[c].color}44`, padding: '3px 9px', borderRadius: 20 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: CAT[c].color }} />{counts[c]} {CAT[c].label}
                        </span>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>{M.desc ? 'มาก → น้อย (ปัญหาขึ้นบน)' : 'น้อย → มาก (ตามหลังขึ้นบน)'} · คลิกแถวเพื่อเน้นบนผัง</div>
                    {metric === 'productivity' && (
                      <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 8, padding: '4px 8px', background: 'var(--bg3)', borderRadius: 6, lineHeight: 1.5 }}>
                        รูปแบบ <b style={{ color: 'var(--text2)' }}>ทำได้ / ควรได้ ณ ตอนนี้ / เป้า (ใบที่เปิด)</b><br />
                        <b style={{ color: 'var(--text2)' }}>ควรได้</b> = เวลาที่มีให้ผลิต (ตั้งแต่เริ่มกะ/เปิดใบแรก − พัก − หยุดตามแผน) ÷ CT · ไม่เกินเป้าที่เปิดใบไว้
                      </div>
                    )}
                    {ranked.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--muted)', padding: 20, textAlign: 'center' }}>ยังไม่มีข้อมูลวันนี้</div>
                    ) : ranked.map(({ name, st, cat, val }, i) => {
                      const meta = CAT[cat]; const txt = regText(st); const hasRegion = regions.some(r => r.line_name === name);
                      const barW = val == null ? 0 : isPct ? Math.min(100, Math.abs(val)) : Math.round(Math.abs(val) / maxVal * 100);
                      return (
                        <div key={name} onClick={() => { if (hasRegion) flashLine(name); openLine(name); }}
                          style={{ padding: '8px 10px', borderRadius: 9, marginBottom: 5, cursor: 'pointer', background: highlight === name ? 'var(--bg2)' : 'var(--bg3)', border: `1px solid ${highlight === name ? meta.color : 'var(--border2)'}` }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                            <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', width: 18, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                            <span className={meta.blink ? 'dt-alarm-blink' : undefined} style={{ width: 11, height: 11, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                            <div style={{ minWidth: 0, flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {name}{(childrenOf[name]?.length) ? <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}> · รวม {childrenOf[name].length} ไลน์ย่อย</span> : (!hasRegion && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}> · ยังไม่ตีกรอบ</span>)}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 800, color: meta.color, whiteSpace: 'nowrap', flexShrink: 0 }}>{txt || '—'}</div>
                          </div>
                          {/* แถบเทียบสัดส่วน */}
                          <div style={{ height: 5, borderRadius: 3, background: 'var(--bg)', marginTop: 6, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${barW}%`, background: meta.color, borderRadius: 3, transition: 'width .3s' }} />
                          </div>
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </aside>
          )}
        </div>
      )}

      {editing && imageUrl && assignableLines().length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>ยังไม่ได้ตีกรอบ: <span style={{ color: '#f59e0b' }}>{assignableLines().join(', ')}</span></div>
      )}

      {/* ── การ์ดพรีวิวลอยตามเม้าส์ (hover) — สรุปทุกมุมมองแบบย่อ, เฉพาะ mouse ── */}
      {hoverLine && !editing && !detailLine && (() => {
        const st = stOf(hoverLine); const kids = childrenOf[hoverLine] || []; const meta = CAT[M.cat(st)];
        const hasFloor = !!floorMapTarget(hoverLine);
        const W = 264, OFF = 18;
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
        // ความสูงจริงจากรอบก่อน (การ์ดสูงเกือบคงที่) — กันตกขอบล่างแบบแม่นๆ
        const H = Math.min(hoverCardRef.current?.offsetHeight || 300, vh - 16);
        // แนวนอน: ถ้าล้นขวา → เด้งไปซ้ายเคอร์เซอร์
        const left = hoverXY.x + OFF + W > vw - 8 ? Math.max(8, hoverXY.x - OFF - W) : hoverXY.x + OFF;
        // แนวตั้ง: เกาะเคอร์เซอร์ · ถ้าจะตกขอบล่าง → เด้งหนีขึ้นบน · ไม่ต่ำกว่าขอบบน
        let top = hoverXY.y - 40;
        if (top + H > vh - 8) top = vh - H - 8;
        if (top < 8) top = 8;
        /* 🏬 โซนคลังสินค้า — การ์ด hover เฉพาะคลัง (user ทัก 2026-08-25 "พื้นที่คลังไม่ควรแสดงเหมือนไลน์ผลิต")
           ห้ามโชว์ metric ผลิต/พลังงาน/PM — ข้อมูลที่มีความหมายคือ ของ/กล่อง/ความจุ/Min-Max */
        if (st.storeZone) {
          const z = st.storeZone; const f = z.fill; const km = zoneKindMeta(z.kind);
          const zm = CAT[z.cat] || CAT.idle;
          const topMats = f.mats.slice().sort((a, b) => (b.short ? 1 : 0) - (a.short ? 1 : 0) || b.qty - a.qty).slice(0, 4);
          const row = (label, val, color) => (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 7, padding: '4px 8px' }}>
              <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>{label}</span>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: color || 'var(--text)', textAlign: 'right', overflowWrap: 'anywhere', lineHeight: 1.3 }}>{val}</span>
            </div>
          );
          return (
            <div ref={hoverCardRef} style={{ position: 'fixed', left, top, width: W, zIndex: 1250, pointerEvents: 'none',
              background: 'var(--card)', border: `1px solid ${zm.color}66`, borderTop: `3px solid ${zm.color}`, borderRadius: 12,
              boxShadow: '0 12px 34px rgba(0,0,0,0.5)', padding: '12px 14px', color: 'var(--text)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: zm.color, flexShrink: 0 }} />
                <div style={{ fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{km.icon} {hoverLine}</div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, marginLeft: 19 }}>
                โซนคลังสินค้า · {km.label} — <span style={{ color: zm.color, fontWeight: 700 }}>{zoneHealthText(f)}</span>
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {row('📦 ของในโซน', f.mats.length ? `${f.totQty.toLocaleString()} ชิ้น · ${f.unknownPkg ? `${f.totPkgs}+?` : f.totPkgs} กล่อง` : 'ยังไม่ผูก MAT', f.mats.length ? undefined : 'var(--muted)')}
                {row('🧺 ความจุ', z.capacity_pkg ? `${z.capacity_pkg} กล่อง${f.fillPct != null ? ` · ใช้ไป ${f.fillPct}%` : ''}` : 'ยังไม่กรอก', z.capacity_pkg ? undefined : 'var(--muted)')}
                {row('🏷 MAT ที่ผูก', `${f.mats.length} รายการ`)}
                {f.shortCount > 0 && row('🟥 ต่ำกว่า Min', `${f.shortCount} รายการ`, '#ef4444')}
                {f.overMaxCount > 0 && row('⚠ เกิน Max', `${f.overMaxCount} รายการ`, '#f59e0b')}
              </div>
              {topMats.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                  {topMats.map(m => (
                    <span key={m.mat_no} style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 6, border: `1px solid ${m.short ? '#ef4444' : 'var(--border2)'}`, color: m.short ? '#ef4444' : 'var(--text2)' }}>
                      {m.mat_no} · {m.qty.toLocaleString()}
                    </span>
                  ))}
                  {f.mats.length > topMats.length && <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>+อีก {f.mats.length - topMats.length}</span>}
                </div>
              )}
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, lineHeight: 1.4 }}>
                ยอดจาก ledger คลังกลาง (FG WAREHOUSE / STORE) — ระบบยังไม่นับยอดรายโซนจริง
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 8, textAlign: 'center', fontWeight: 700 }}>
                🏬 คลิกเพื่อดูรายการ MAT ทั้งหมดในโซน
              </div>
            </div>
          );
        }
        return (
          <div ref={hoverCardRef} style={{ position: 'fixed', left, top, width: W, zIndex: 1250, pointerEvents: 'none',
            background: 'var(--card)', border: `1px solid ${meta.color}66`, borderTop: `3px solid ${meta.color}`, borderRadius: 12,
            boxShadow: '0 12px 34px rgba(0,0,0,0.5)', padding: '12px 14px', color: 'var(--text)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span className={meta.blink ? 'dt-alarm-blink' : undefined} style={{ width: 11, height: 11, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
              <div style={{ fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text)' }}>{hoverLine}</div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, marginLeft: 19 }}>
              สถานะ: <span style={{ color: meta.color, fontWeight: 700 }}>{meta.label}</span>{kids.length ? ` · รวม ${kids.length} ไลน์ย่อย` : ''}
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {/* ⚠️ โซน utility/facility ไม่ใช่ไลน์ผลิต — metric ผลิต (ยอดผลิต/OEE/DT/ของเสีย/คน) ไม่มีความหมาย
                  ของเดิมโชว์ครบ 7 แถวโดย 5 แถวเขียนว่า "🔧 Facility" เฉยๆ = การ์ดยาวแต่ไม่มีข้อมูล
                  (user ทัก 2026-08-20 "box card จุดที่เป็นระบบ utility มันโชว์หลาย")
                  → ตัดแถวที่ N/A ออก แล้ว **บอกด้วยบรรทัดเดียวว่าตัดอะไรไป** (ห้ามหายเงียบ) */}
              {Object.entries(METRICS).filter(([, m]) => !(st.isFac && m.facilityNA)).map(([k, m]) => {
                const c = CAT[m.cat(st)]; const t = m.text(st); const isCur = k === metric;
                return (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                    background: isCur ? `${c.color}22` : 'var(--bg3)', border: isCur ? `1px solid ${c.color}55` : '1px solid var(--border2)',
                    borderRadius: 7, padding: '4px 8px' }}>
                    <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: isCur ? 800 : 600, whiteSpace: 'nowrap', flexShrink: 0 }}>{m.label}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: t ? c.color : 'var(--muted)', minWidth: 0, textAlign: 'right', overflowWrap: 'anywhere', lineHeight: 1.3 }}>
                      {t || '—'}
                      {/* ไลน์เครื่องขนาน: บอกว่า "ควรได้" คิดจากเครื่องที่เดินได้จริงกี่เครื่อง
                          ไม่งั้นคนอ่านไม่ออกว่าทำไมตัวเลขเปลี่ยนไปตามวัน (คนมาไม่เท่ากัน) */}
                      {k === 'energy' && st.kwh != null && (
                        <span style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', marginTop: 1 }}>
                          {st.kwhCost ? `${fmtBaht(st.kwhCost)} บาท · ` : ''}
                          {st.kwhCo2 != null ? `🌱 ${fmtTco2e(st.kwhCo2)} tCO2e · ` : ''}
                          {energyMonth ? monthLabel(energyMonth) : ''}
                        </span>
                      )}
                      {k === 'productivity' && st.capN > 1 && (
                        <span style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', marginTop: 1 }}>
                          {st.runN < st.capN
                            ? `คิดจากเดิน ${st.runN}/${st.capN} เครื่อง (ตามกำลังคนที่มา)`
                            : `คิดจากเดินเต็มกำลัง ${st.capN} เครื่อง`}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            {st.isFac && (
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, lineHeight: 1.4 }}>
                {st.die ? '🔨 โซนคลังแม่พิมพ์' : '🔧 โซนระบบสนับสนุน (utility)'} — ไม่ใช่ไลน์ผลิต
                จึงไม่มี {Object.values(METRICS).filter(m => m.facilityNA).map(m => m.label.replace(/^\S+\s/, '')).join(' / ')}
              </div>
            )}
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 9, textAlign: 'center', fontWeight: 700 }}>
              {hasFloor ? '🏭 คลิกเพื่อเปิดผังไลน์ + พนักงาน' : 'คลิกเพื่อดูรายละเอียด + แยกไลน์ย่อย'}
            </div>
          </div>
        );
      })()}

      {/* ── drill-down: คลิกไลน์ → รายละเอียดทุก metric + แยกตามไลน์ลูก ── */}
      {/* ── กางวิธีคิด OEE เฉลี่ย (ถ่วงน้ำหนัก) — ตอบคำถาม "ทำไมบวกกันหารแล้วไม่ตรง" ── */}
      {oeeExplain && (() => {
        const rows = [...oeeExplain.rows].sort((a, b) => b.w - a.w);
        const sumW = rows.reduce((a, r) => a + r.w, 0);
        const sumWX = rows.reduce((a, r) => a + r.oee * r.w, 0);
        const weighted = sumW > 0 ? sumWX / sumW : null;
        const plain = rows.length ? rows.reduce((a, r) => a + r.oee, 0) / rows.length : null;
        const sh = (v) => v === 'day' ? 'เช้า' : v === 'night' ? 'ดึก' : (v || '—');
        return (
          <div onClick={() => setOeeExplain(null)} style={{ position: 'fixed', inset: 0, zIndex: 2100, background: 'rgba(0,0,0,0.68)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, width: '100%', maxWidth: 660, maxHeight: '90vh', overflowY: 'auto', padding: '20px 22px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 4 }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>🧮 {oeeExplain.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>ค่าเฉลี่ยถ่วงน้ำหนัก — ไม่ใช่เอา % มาบวกกันแล้วหาร</div>
                </div>
                <button onClick={() => setOeeExplain(null)} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: 'var(--text2)', fontSize: 15 }}>✕</button>
              </div>

              {/* สูตร */}
              <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 9, padding: '10px 12px', margin: '12px 0 14px', fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.7 }}>
                <b style={{ color: 'var(--text)' }}>สูตร:</b> OEE เฉลี่ย = Σ(OEE ของกะ × เวลารับภาระ) ÷ Σ(เวลารับภาระ)<br />
                <b style={{ color: 'var(--text)' }}>เวลารับภาระ</b> = เวลากะ − เวลาหยุดตามแผน (นาที) · กะที่เดินเครื่องนานกว่า ถ่วงน้ำหนักมากกว่า
              </div>

              {/* ตารางคิดจริง */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 460, fontVariantNumeric: 'tabular-nums' }}>
                  <thead><tr style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                    <th style={TH_L}>ไลน์ · กะ</th>
                    <th style={TH_R}>OEE</th>
                    <th style={TH_R}>เวลารับภาระ</th>
                    <th style={TH_R}>OEE × เวลา</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border2)', textAlign: 'right', color: 'var(--text)' }}>
                        <td style={{ textAlign: 'left', padding: '6px 7px' }}>
                          <b>{r.line}</b> <span style={{ color: 'var(--muted)' }}>· {sh(r.shift)}</span>
                          {r.planned > 0 && <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{r.shiftMin} − {r.planned} (หยุดตามแผน)</div>}
                        </td>
                        <td style={{ padding: '6px 7px', fontWeight: 700, color: oeeCol(r.oee) }}>{r.oee.toFixed(1)}%</td>
                        <td style={{ padding: '6px 7px' }}>{fmtNum(r.w)} น.</td>
                        <td style={{ padding: '6px 7px', color: 'var(--muted)' }}>{fmtNum(r.oee * r.w)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr style={{ textAlign: 'right', borderTop: '2px solid var(--border2)', color: 'var(--text)', fontWeight: 800 }}>
                    <td style={{ textAlign: 'left', padding: '8px 7px' }}>รวม</td>
                    <td style={{ padding: '8px 7px' }}>—</td>
                    <td style={{ padding: '8px 7px' }}>{fmtNum(sumW)} น.</td>
                    <td style={{ padding: '8px 7px' }}>{fmtNum(sumWX)}</td>
                  </tr></tfoot>
                </table>
              </div>

              {/* ผลลัพธ์ + เทียบกับเฉลี่ยธรรมดา */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
                <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: 9, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700 }}>✅ ที่ระบบใช้ (ถ่วงน้ำหนัก)</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: oeeCol(weighted) }}>{weighted != null ? `${weighted.toFixed(1)}%` : '—'}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{fmtNum(sumWX)} ÷ {fmtNum(sumW)}</div>
                </div>
                <div style={{ background: 'var(--bg3)', border: '1px dashed var(--border2)', borderRadius: 9, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700 }}>❌ ถ้าบวกกันหารเฉยๆ</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--muted)' }}>{plain != null ? `${plain.toFixed(1)}%` : '—'}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>เฉลี่ย {rows.length} กะเท่าๆ กัน</div>
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 12, lineHeight: 1.7 }}>
                <b style={{ color: 'var(--text2)' }}>ทำไมต่างกัน:</b> กะที่เดินเครื่องนานกว่า (หรือไลน์ที่เปิดหลายกะ) มีผลต่อผลงานรวมมากกว่า
                ถ้าเฉลี่ยเท่าๆ กัน กะสั้นๆ จะถ่วงเท่ากะเต็มวัน — ตัวเลขจะสวยหรือแย่เกินจริง · กะที่ไม่มีผลผลิต (OEE ว่าง) ไม่ถูกนับ
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── สรุปเรื่องราวทั้งวันของไลน์ (คลิกไลน์บนผัง/แถบขวา) ── */}
      {storyLine && (() => {
        const s = story;
        const pct = s && s.totTarget > 0 ? Math.round(s.totProduced / s.totTarget * 100) : null;
        const kids = childrenOf[storyLine] || [];
        const sh = (v) => v === 'day' ? '☀️ กะเช้า' : v === 'night' ? '🌙 กะดึก' : (v || '—');
        return (
          <div onClick={() => setStoryLine(null)} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.66)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, width: '100%', maxWidth: 860, maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
              {/* หัว */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, padding: '18px 20px 12px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text)' }}>📋 {storyLine}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    {storyDate === getWorkDate()
                      ? <span style={{ color: 'var(--accent)', fontWeight: 700 }}>⚡ วันนี้ (สด)</span>
                      : 'สรุปทั้งวัน'} · {fmtThaiDate(storyDate)}{kids.length ? ` · รวม ${kids.length} ไลน์ย่อย` : ''}{s?.sessionCount ? ` · ${s.sessionCount} กะ` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 7, flexShrink: 0 }}>
                  <button onClick={() => openFloorMap(storyLine)} style={{ ...miniTab(false), whiteSpace: 'nowrap' }}>🏭 ผังไลน์ + พนักงาน</button>
                  <button onClick={() => setStoryLine(null)} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', color: 'var(--text2)', fontSize: 15 }}>✕</button>
                </div>
              </div>

              <div style={{ overflowY: 'auto', padding: '16px 20px 20px' }}>
                {storyLoading ? (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>กำลังโหลด...</div>
                ) : !s ? (
                  <div style={{ padding: 40, textAlign: 'center', color: '#ef4444', fontSize: 13 }}>โหลดข้อมูลไม่สำเร็จ — ลองปิดแล้วเปิดใหม่</div>
                ) : (<>
                  {/* ไม่ได้เปิดกะ = บอกแล้วไปต่อ ห้ามจบแค่บรรทัดเดียว — PM/ใบซ่อม/คน/ไฟ ยังมีเรื่องให้ดู
                      (2026-08-26 · user ทัก "คลิกมาไม่เจอข้อมูลอะไรเลย ทั้งที่บอก PM ค้าง") */}
                  {!s.sessionCount && (
                    <div style={{ background: 'var(--bg3)', border: '1px dashed var(--border2)', borderRadius: 9, padding: '10px 12px', marginBottom: 16, fontSize: 12.5, color: 'var(--text2)' }}>
                      ⏸ <b>ไม่มีการเปิดกะของไลน์นี้ใน{fmtThaiDate(storyDate)}</b> — ไม่มียอดผลิต/OEE/Downtime ของวันนี้
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>ด้านล่างคือสถานะปัจจุบันของไลน์ (PM · ใบซ่อม · คน · ไฟฟ้า) ซึ่งไม่ผูกกับวันที่เลือก</div>
                    </div>
                  )}
                  {/* สรุปหัวเรื่อง */}
                  {s.sessionCount > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px,1fr))', gap: 8, marginBottom: 18 }}>
                    {[
                      { k: 'ผลิตได้ / เป้า', v: `${fmtNum(s.totProduced)}/${fmtNum(s.totTarget)}`, sub: pct != null ? `${pct}%` : '', c: pctCol(pct) },
                      { k: 'Downtime นอกแผน', v: `${fmtNum(s.dtUnplannedMin)} น.`, sub: s.dtPlannedMin ? `ในแผน ${fmtNum(s.dtPlannedMin)} น.` : '', c: s.dtUnplannedMin > 0 ? '#f59e0b' : 'var(--text)' },
                      { k: 'ของเสีย', v: fmtNum(s.ngTotal), sub: s.suspectTotal ? `สงสัย ${fmtNum(s.suspectTotal)}` : '', c: s.ngTotal > 0 ? '#ef4444' : 'var(--text)' },
                      { k: '4M วันนี้', v: fmtNum(s.fourM.length), sub: s.fourM.filter(f => f.status === 'pending' || f.status === 'pending_qa').length ? `ค้าง ${s.fourM.filter(f => f.status === 'pending' || f.status === 'pending_qa').length}` : '', c: 'var(--text)' },
                    ].map(x => (
                      // การ์ดสูงเท่ากันทุกใบ: บรรทัดล่างจองที่ไว้เสมอ (ไม่มี sub ใช้ nbsp) — ไม่งั้นการ์ดเตี้ยไม่เท่ากัน
                      <div key={x.k} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 9, padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600 }}>{x.k}</div>
                        <div style={{ fontSize: 17, fontWeight: 800, color: x.c, fontVariantNumeric: 'tabular-nums', lineHeight: 1.15 }}>{x.v}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', minHeight: 15 }}>{x.sub || ' '}</div>
                      </div>
                    ))}
                  </div>
                  )}

                  {/* รายกะ */}
                  {s.sessionCount > 0 && (
                  <StorySection title="🕐 แยกตามกะ">
                    <div style={{ display: 'grid', gap: 6 }}>
                      {s.shifts.map(x => {
                        const p = x.target > 0 ? Math.round(x.produced / x.target * 100) : null;
                        return (
                          <div key={x.id} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '8px 11px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <b style={{ fontSize: 12.5, color: 'var(--text)' }}>{sh(x.shift)}</b>
                              {kids.length > 0 && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{x.line}</span>}
                              {x.status === 'open' && <span style={{ fontSize: 11, color: '#38bdf8', border: '1px solid #38bdf855', borderRadius: 20, padding: '1px 7px' }}>กำลังเปิด</span>}
                              <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: pctCol(p) }}>{x.target > 0 ? `${fmtNum(x.produced)}/${fmtNum(x.target)} · ${p}%` : `${fmtNum(x.produced)} ชิ้น`}</span>
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                              <Chip label="OEE" val={x.oee != null ? `${Math.round(x.oee)}%${x.oeeLive ? ' (สด)' : ''}` : '—'} color={oeeCol(x.oee)} />
                              {x.a != null && <Chip label="A" val={`${Math.round(x.a)}%`} color="var(--text2)" />}
                              {x.p != null && <Chip label="P" val={`${Math.round(x.p)}%`} color="var(--text2)" />}
                              {x.q != null && <Chip label="Q" val={`${Math.round(x.q)}%`} color="var(--text2)" />}
                              <Chip label="DT" val={`${fmtNum(x.dt)}น.`} color={x.dt > 0 ? '#f59e0b' : 'var(--muted)'} />
                              <Chip label="NG" val={fmtNum(x.ng)} color={x.ng > 0 ? '#ef4444' : 'var(--muted)'} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </StorySection>
                  )}

                  {/* ผลิตรายพาร์ท */}
                  {s.parts.length > 0 && (
                    <StorySection title={`📦 ผลิตรายชิ้นงาน (${s.parts.length})`}>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 420, fontVariantNumeric: 'tabular-nums' }}>
                          {/* ⚠️ index.css มี `th { text-align: left }` — rule ตรงชนะ inherit จาก <tr> ต้องสั่ง textAlign ที่ th เอง ไม่งั้นหัวกับค่าเหลื่อมกัน */}
                          <thead><tr style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                            <th style={TH_L}>MAT / ชิ้นงาน</th>
                            <th style={TH_R}>เป้า</th><th style={TH_R}>ผลิตได้</th><th style={TH_R}>%</th><th style={TH_R}>ใบ</th>
                          </tr></thead>
                          <tbody>
                            {s.parts.map(p => {
                              const pp = p.target > 0 ? Math.round(p.produced / p.target * 100) : null;
                              return (
                                <tr key={p.mat} style={{ borderBottom: '1px solid var(--border2)', textAlign: 'right', color: 'var(--text)' }}>
                                  <td style={{ textAlign: 'left', padding: '6px 7px' }}>
                                    <div style={{ fontWeight: 700 }}>{p.mat}</div>
                                    {p.name && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.name}</div>}
                                  </td>
                                  <td style={{ padding: '6px 7px' }}>{fmtNum(p.target)}</td>
                                  <td style={{ padding: '6px 7px' }}>{fmtNum(p.produced)}</td>
                                  <td style={{ padding: '6px 7px', color: pctCol(pp), fontWeight: 700 }}>{pp != null ? `${pp}%` : '—'}</td>
                                  <td style={{ padding: '6px 7px', color: 'var(--muted)' }}>{p.orders}{p.manual ? ` (✍️${p.manual})` : ''}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </StorySection>
                  )}

                  {/* 🔗 สายการไหล — "หยุดที่นี่ กระทบใคร / ของมาจากไหน" (2026-08-19)
                      ⚠️ ยังไม่ผูกกับเวลาหยุดจริง (ต้องรู้ buffer ครบก่อนถึงบอกได้ว่ากระทบเมื่อไหร่)
                         ตอนนี้บอกแค่ "เชื่อมกับใคร" ซึ่งก็ยังดีกว่าไม่มีอะไรเลย — ห้ามเขียนให้ดูเหมือนคำตอบสำเร็จรูป */}
                  {(s.flowDown?.length > 0 || s.flowUp?.length > 0) && (
                    <StorySection title="🔗 สายการไหลระหว่างไลน์">
                      <div style={{ display: 'grid', gap: 6 }}>
                        {s.flowDown?.length > 0 && (
                          <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
                            <b style={{ color: s.dtUnplannedMin > 0 ? '#f59e0b' : 'var(--text)' }}>➡️ ป้อนงานให้:</b>{' '}
                            {s.flowDown.map((l, i) => (
                              <span key={l.id}>
                                {i > 0 && ' · '}
                                <b style={{ color: 'var(--text)' }}>{l.to_line}</b>
                                {l.buffer_qty != null
                                  ? <span style={{ color: 'var(--muted)' }}> (buffer {Number(l.buffer_qty).toLocaleString()} ชิ้น)</span>
                                  : <span style={{ color: 'var(--muted)' }}> (ยังไม่ระบุ buffer)</span>}
                              </span>
                            ))}
                            {s.dtUnplannedMin > 0 && (
                              <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>
                                ⚠ วันนี้ไลน์นี้หยุดนอกแผน {fmtNum(s.dtUnplannedMin)} นาที — เช็คที่ไลน์ปลายน้ำว่ามี “รอชิ้นงาน” ตามมาไหม
                              </div>
                            )}
                          </div>
                        )}
                        {s.flowUp?.length > 0 && (
                          <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
                            <b style={{ color: 'var(--text)' }}>⬅️ รับของจาก:</b>{' '}
                            {s.flowUp.map((l, i) => (
                              <span key={l.id}>{i > 0 && ' · '}<b style={{ color: 'var(--text)' }}>{l.from_line}</b></span>
                            ))}
                          </div>
                        )}
                        <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                          ตั้งสายการไหลที่ หน้าจัดการไลน์ → 🔗 สายการไหลระหว่างไลน์
                        </div>
                      </div>
                    </StorySection>
                  )}

                  {/* Downtime + เหตุผล */}
                  {s.sessionCount > 0 && (<>
                  <StorySection title={`🔧 Downtime นอกแผน (${s.dtUnplanned.length} ครั้ง · ${fmtNum(s.dtUnplannedMin)} นาที)`}>
                    {s.dtUnplanned.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>ไม่มี — ไม่มีเครื่องหยุดนอกแผน 👍</div> : (
                      <div style={{ display: 'grid', gap: 5 }}>
                        {s.dtUnplanned.map(d => (
                          <div key={d.id} style={{ background: 'var(--bg3)', borderLeft: `3px solid ${d.open ? '#ef4444' : '#f59e0b'}`, border: '1px solid var(--border2)', borderRadius: 8, padding: '7px 10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <b style={{ fontSize: 12.5, color: 'var(--text)' }}>{d.type}</b>
                              {d.machine && <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {d.machine}</span>}
                              {d.open && <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 700 }}>🔴 ยังหยุดอยู่</span>}
                              {d.carry_over && <span style={{ fontSize: 11, color: 'var(--muted)' }}>ยกข้ามกะ</span>}
                              <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: '#f59e0b' }}>{fmtNum(d.mins)} น.</span>
                            </div>
                            {d.note && <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 3 }}>💬 {d.note}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                    {s.dtPlanned.length > 0 && (
                      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
                        ในแผน (ไม่นับเป็น loss): {s.dtPlanned.map(d => `${d.type} ${d.mins}น.`).join(' · ')}
                      </div>
                    )}
                  </StorySection>

                  {/* ของเสีย */}
                  <StorySection title={`🚫 ของเสีย (${fmtNum(s.ngTotal)} ชิ้น)`}>
                    {s.defects.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>ไม่มีของเสีย 👍</div> : (
                      <div style={{ display: 'grid', gap: 5 }}>
                        {s.defects.map(d => (
                          <div key={d.type} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '7px 10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <b style={{ fontSize: 12.5, color: 'var(--text)', minWidth: 0 }}>{d.type}</b>
                              <span style={{ marginLeft: 'auto', display: 'flex', gap: 5, flexShrink: 0 }}>
                                <Chip label="NG" val={fmtNum(d.ng)} color="#ef4444" />
                                {d.suspect > 0 && <Chip label="สงสัย" val={fmtNum(d.suspect)} color="#f59e0b" />}
                                {d.repair > 0 && <Chip label="ซ่อม" val={fmtNum(d.repair)} color="var(--text2)" />}
                              </span>
                            </div>
                            {d.notes.length > 0 && <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 3 }}>💬 {d.notes.join(' · ')}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </StorySection>
                  </>)}

                  {/* 4M */}
                  {s.fourM.length > 0 && (
                    <StorySection title={`🔄 4M วันนี้ (${s.fourM.length})`}>
                      <div style={{ display: 'grid', gap: 5 }}>
                        {s.fourM.map(f => (
                          <div key={f.id} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '7px 10px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#4d9fff', flexShrink: 0 }}>{f.category}</span>
                            <span style={{ fontSize: 12, color: 'var(--text2)', minWidth: 0, flex: 1 }}>{f.description || '—'}</span>
                            <span style={{ fontSize: 10.5, flexShrink: 0, color: f.status === 'approved' ? '#22c55e' : f.status === 'rejected' ? '#ef4444' : '#f59e0b' }}>
                              {f.status === 'approved' ? 'อนุมัติ' : f.status === 'rejected' ? 'ปฏิเสธ' : 'รออนุมัติ'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </StorySection>
                  )}

                  {/* ══ 🧭 สถานะปัจจุบันของไลน์ (ไม่ผูกกับวันที่เลือก) ══════════════════════
                      2026-08-26 · user: "อันนี้โชว์แค่เกี่ยวกับการผลิตหรอ มันควรโชว์ทุกเรื่องนะ
                      เพราะจะดูรายละเอียดของไลน์นั้นๆ แล้ว"
                      ⚠️ PM/ใบซ่อม/คน/ไฟ เป็น "สถานะตอนนี้" ไม่ใช่ของวันที่เลือก — ต้องเขียนกำกับ
                         ไม่งั้นคนอ่านเข้าใจว่าเป็นข้อมูลย้อนหลังของวันนั้น */}
                  {(() => {
                    const st = stOf(storyLine);
                    const pmDue = (s.pmRows || []).filter(r => r.days == null || r.days <= 7);
                    const eDelta = st.kwhPrev ? deltaPct(st.kwh, st.kwhPrev) : null;
                    return (
                      <StorySection title="🧭 สถานะปัจจุบันของไลน์ (ไม่ขึ้นกับวันที่เลือก)">
                        <div style={{ display: 'grid', gap: 9 }}>
                          {/* 🛠️ PM — ตัวที่ผังโชว์บนป้าย ต้องกดเข้ามาแล้วเห็นว่า "เครื่องไหน" */}
                          <div>
                            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>
                              🛠️ PM เครื่องจักร{st.pmTotal ? ` · ${st.pmTotal} แผน` : ''}
                            </div>
                            {s.pmRows == null ? (
                              <div style={{ fontSize: 11.5, color: '#f59e0b', marginTop: 3 }}>⚠ ดึงรายการ PM ไม่สำเร็จ</div>
                            ) : !s.pmRows.length ? (
                              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>ยังไม่มีแผน PM ของอุปกรณ์ในไลน์นี้ — ตั้งที่หน้า PM Setup</div>
                            ) : (<>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 4, fontSize: 12, fontWeight: 800 }}>
                                <span style={{ color: st.pmOverdue ? '#ef4444' : 'var(--muted)' }}>เกินกำหนด {st.pmOverdue || 0}</span>
                                <span style={{ color: st.pmDueSoon ? '#f59e0b' : 'var(--muted)' }}>ใกล้ครบ {st.pmDueSoon || 0}</span>
                                <span style={{ color: 'var(--muted)' }}>ทั้งหมด {st.pmTotal || 0}</span>
                              </div>
                              {pmDue.length > 0 && (
                                <div style={{ display: 'grid', gap: 3, marginTop: 6 }}>
                                  {pmDue.slice(0, 6).map((r, i2) => (
                                    <div key={`${r.key}-${i2}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
                                      <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: r.days != null && r.days < 0 ? '#ef4444' : '#f59e0b' }} />
                                      <span style={{ fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                                      {r.sub && <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sub}</span>}
                                      <span style={{ marginLeft: 'auto', flexShrink: 0, fontWeight: 700, color: r.days != null && r.days < 0 ? '#ef4444' : '#f59e0b' }}>
                                        {r.days == null ? 'ไม่มีรอบตายตัว' : r.days < 0 ? `เกิน ${Math.abs(r.days)} วัน` : r.days === 0 ? 'ครบวันนี้' : `อีก ${r.days} วัน`}
                                      </span>
                                    </div>
                                  ))}
                                  {pmDue.length > 6 && <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>+ อีก {pmDue.length - 6} รายการ</div>}
                                </div>
                              )}
                              <Link to="/pm?tab=plan" style={{ fontSize: 10.5, color: 'var(--accent)', textDecoration: 'none', display: 'inline-block', marginTop: 4 }}>→ ดูแผน PM ทั้งหมด</Link>
                            </>)}
                          </div>

                          {/* 🔧 ใบซ่อม MO ค้าง */}
                          <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>🔧 ใบซ่อม MO ที่ยังไม่ปิด</div>
                            {s.moRows == null ? (
                              <div style={{ fontSize: 11.5, color: '#f59e0b', marginTop: 3 }}>⚠ ดึงใบซ่อมไม่สำเร็จ</div>
                            ) : !s.moRows.length ? (
                              <div style={{ fontSize: 12, fontWeight: 800, color: '#22c55e', marginTop: 3 }}>✅ ไม่มีใบค้าง</div>
                            ) : (<>
                              <div style={{ fontSize: 15, fontWeight: 900, color: '#f59e0b', marginTop: 2 }}>{s.moRows.length} ใบ</div>
                              <div style={{ display: 'grid', gap: 3, marginTop: 4 }}>
                                {s.moRows.slice(0, 5).map(o => (
                                  <div key={o.id} onClick={() => navigate('/mtn-repair')} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, cursor: 'pointer' }}>
                                    <span style={{ fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>{o.mo_no || '⏳ รอออกเลข'}</span>
                                    <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {o.machine_no || 'ไม่ระบุเครื่อง'}{o.problem_characteristic ? ` · ${o.problem_characteristic}` : ''}
                                    </span>
                                  </div>
                                ))}
                                {s.moRows.length > 5 && <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>+ อีก {s.moRows.length - 5} ใบ</div>}
                              </div>
                            </>)}
                          </div>

                          {/* 👷 คน & จุดงาน · ⚡ ไฟฟ้า · 🔗 Supply route — ตัวเลขชุดเดียวกับแท็บบนผัง */}
                          <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 8 }}>
                            <div>
                              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>👷 คน & จุดงาน (ตอนนี้)</div>
                              {st.headTotal || st.stationTotal ? (
                                <div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 3, fontWeight: 700 }}>
                                  มา {fmtNum(st.present)}/{fmtNum(st.headTotal)} คน
                                  {st.stationTotal > 0 && <span style={{ color: 'var(--muted)', fontWeight: 500 }}> · เข้าจุด {fmtNum(st.stationFilled)}/{fmtNum(st.stationTotal)}</span>}
                                  {st.ppeBad > 0 && <span style={{ color: '#ef4444' }}> · ⚠PPE {fmtNum(st.ppeBad)}</span>}
                                </div>
                              ) : <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>ยังไม่มีข้อมูลเช็คชื่อ</div>}
                            </div>
                            <div>
                              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>⚡ ไฟฟ้า{energyMonth ? ` · ${monthLabel(energyMonth)}` : ''}</div>
                              {st.kwh != null ? (
                                <div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 3, fontWeight: 700 }}>
                                  {fmtKwh(st.kwh)} kWh
                                  {eDelta != null && <span style={{ color: eDelta <= -5 ? '#22c55e' : eDelta > 10 ? '#ef4444' : 'var(--muted)' }}> · {eDelta > 0 ? '+' : ''}{eDelta}%</span>}
                                  {st.kwhCost > 0 && <span style={{ color: 'var(--muted)', fontWeight: 500 }}> · {fmtBaht(st.kwhCost)} บาท</span>}
                                </div>
                              ) : <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>ยังไม่กรอกของไลน์นี้</div>}
                            </div>
                            {st.supList?.length > 0 && (
                              <div>
                                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>🔗 ระบบสนับสนุนที่จ่ายให้</div>
                                <div style={{ fontSize: 12, color: st.supAtRisk ? '#ef4444' : 'var(--text2)', marginTop: 3, fontWeight: st.supAtRisk ? 800 : 500 }}>
                                  {st.supAtRisk ? '⚠ มีเครื่องกำลังซ่อม: ' : 'ปกติ · '}
                                  {[...new Set(st.supList.filter(x => !st.supAtRisk || x.atRisk).map(x => x.name || x.no))].slice(0, 4).join(' · ')}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </StorySection>
                    );
                  })()}
                </>)}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── โหมด review: คลิกไลน์แม่ → maximize breakdown ไลน์ย่อยของวันที่เลือก ── */}
      {reviewDetail && (() => {
        const parent = reviewOf(reviewDetail);
        const selfRaw = reviewStatus[reviewDetail]; // ผลิตของไลน์แม่เอง (ถ้ามี)
        const rows = [];
        if (selfRaw && (selfRaw.target || selfRaw.dtMin || selfRaw.ng || selfRaw.oeeN)) rows.push({ name: reviewDetail, self: true, r: { ...selfRaw, oee: selfRaw.oeeWLoad > 0 ? Math.round(selfRaw.oeeWSum / selfRaw.oeeWLoad) : (selfRaw.oeeN ? Math.round(selfRaw.oeeSum / selfRaw.oeeN) : null) } });
        (childrenOf[reviewDetail] || []).forEach(k => rows.push({ name: k, r: reviewOf(k) }));
        // เรียงลูกทำได้ต่ำสุดขึ้นบน
        rows.sort((a, b) => { const ap = a.r.target > 0 ? a.r.actual / a.r.target : 2; const bp = b.r.target > 0 ? b.r.actual / b.r.target : 2; return ap - bp; });
        const ppct = parent.target > 0 ? Math.round(parent.actual / parent.target * 100) : null;
        return (
          <div onClick={() => setReviewDetail(null)} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 22px', width: '100%', maxWidth: 620, maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{reviewDetail}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>แยกตามไลน์ย่อย · {fmtThaiDate(reviewDate)} (ทั้งวัน)</div>
                </div>
                <button onClick={() => setReviewDetail(null)} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: 'var(--text2)', fontSize: 15 }}>✕</button>
              </div>
              {/* ยอดรวมทั้งกลุ่ม */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 10, padding: '10px 12px', margin: '10px 0 14px' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>รวมทั้งกลุ่ม</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: pctCol(ppct) }}>{parent.target > 0 ? `${fmtNum(parent.actual)}/${fmtNum(parent.target)} · ${ppct}%` : '—'}</div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Chip label="OEE" val={parent.oee != null ? `${parent.oee}%` : '—'} color={oeeCol(parent.oee)} />
                  {parent.oeeRows?.length > 1 && (
                    <button onClick={() => setOeeExplain({ title: `OEE เฉลี่ย · ${reviewDetail}`, rows: parent.oeeRows })}
                      title="ทำไมไม่เท่ากับเฉลี่ยเลขธรรมดา?"
                      style={{ border: '1px solid var(--border2)', background: 'var(--bg2)', color: 'var(--accent)', borderRadius: 20, fontSize: 10.5, fontWeight: 800, padding: '2px 8px', cursor: 'pointer' }}>ⓘ วิธีคิด</button>
                  )}
                  <Chip label="DT" val={`${fmtNum(parent.dtMin)}น.`} color={parent.dtMin > 0 ? '#f59e0b' : 'var(--muted)'} />
                  <Chip label="NG" val={fmtNum(parent.ng)} color={parent.ng > 0 ? '#ef4444' : 'var(--muted)'} />
                  {parent.headTotal > 0 && <Chip label="คน" val={`${parent.present}/${parent.headTotal}`} color="var(--text2)" />}
                </div>
              </div>
              {/* รายไลน์ย่อย — คลิกเปิดผังไลน์พร้อมพนักงาน */}
              <div style={{ display: 'grid', gap: 7 }}>
                {rows.map(({ name, r, self }) => {
                  const pct = r.target > 0 ? Math.round(r.actual / r.target * 100) : null;
                  return (
                    <div key={name} onClick={() => { setReviewDetail(null); openLine(name, reviewDate); }}
                      style={{ padding: '9px 11px', borderRadius: 9, cursor: 'pointer', background: 'var(--bg3)', border: `1px solid ${self ? 'var(--border)' : 'var(--border2)'}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
                        <div style={{ minWidth: 0, flex: 1, fontSize: 13.5, fontWeight: 700, color: self ? 'var(--accent)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {self ? `${name} (เฉพาะไลน์แม่)` : `↳ ${name}`}
                        </div>
                        <div style={{ fontSize: 13.5, fontWeight: 800, color: pctCol(pct), whiteSpace: 'nowrap', flexShrink: 0 }}>{r.target > 0 ? `${fmtNum(r.actual)}/${fmtNum(r.target)} · ${pct}%` : '—'}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <Chip label="OEE" val={r.oee != null ? `${r.oee}%` : '—'} color={oeeCol(r.oee)} />
                        <Chip label="DT" val={`${fmtNum(r.dtMin)}น.`} color={r.dtMin > 0 ? '#f59e0b' : 'var(--muted)'} />
                        <Chip label="NG" val={fmtNum(r.ng)} color={r.ng > 0 ? '#ef4444' : 'var(--muted)'} />
                        {r.headTotal > 0 && <Chip label="คน" val={`${r.present}/${r.headTotal}`} color="var(--text2)" />}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12, textAlign: 'center' }}>แตะไลน์ย่อยเพื่อเปิดผังไลน์พร้อมพนักงาน</div>
            </div>
          </div>
        );
      })()}

      {detailLine && (() => {
        const st = stOf(detailLine); const kids = childrenOf[detailLine] || [];
        return (
          <div onClick={() => setDetailLine(null)} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 22px', width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>
                  {st.dtActive && <span className="dt-alarm-icon" style={{ color: '#ef4444' }}>🔴 </span>}{detailLine}
                </div>
                <button onClick={() => setDetailLine(null)} style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: 'var(--text2)', fontSize: 15 }}>✕</button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>รายละเอียดทุกมุมมอง — วันงานปัจจุบัน{kids.length ? ` · รวมยอดไลน์ลูก ${kids.length} ไลน์` : ''}</div>

              {/* การ์ดทุก metric */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: kids.length ? 18 : 0 }}>
                {/* โซน utility ตัด metric ผลิตออกเหมือนการ์ด hover — ไม่โชว์ช่อง "Facility" เปล่าๆ 5 ใบ */}
                {Object.entries(METRICS).filter(([, m]) => !(st.isFac && m.facilityNA)).map(([k, m]) => {
                  const cat = m.cat(st); const meta = CAT[cat]; const txt = m.text(st);
                  return (
                    <div key={k} style={{ background: 'var(--bg3)', border: `1px solid ${meta.color}55`, borderLeft: `3px solid ${meta.color}`, borderRadius: 8, padding: '9px 11px' }}>
                      <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 3 }}>{m.label}</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: meta.color }}>{txt || '—'}</div>
                    </div>
                  );
                })}
              </div>

              {/* แยกตามไลน์ลูก */}
              {kids.length > 0 && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text2)', marginBottom: 8 }}>แยกตามไลน์ย่อย</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                      <thead>
                        <tr style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                          <th style={TH_L}>ไลน์</th>
                          <th style={{ ...TH_R, whiteSpace: 'nowrap' }} title="ทำได้ / เป้า ณ เวลานี้ / เป้าเต็มกะ">ผลิต (ทำ/ณ เวลานี้/เต็ม)</th>
                          <th style={TH_R}>คน</th>
                          <th style={TH_R}>DT (น.)</th>
                          <th style={TH_R}>NG</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[detailLine, ...kids].map(n => {
                          const p = lineStatus[n] || {}; const mp = manpower[n] || {};
                          const self = n === detailLine;
                          return (
                            <tr key={n} style={{ borderBottom: '1px solid var(--border2)', color: 'var(--text)', textAlign: 'right' }}>
                              <td style={{ textAlign: 'left', padding: '5px 6px', fontWeight: self ? 800 : 400, color: self ? 'var(--accent)' : 'var(--text)' }}>{self ? `${n} (ตัวเอง)` : `↳ ${n}`}</td>
                              <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>{p.target ? `${p.actual || 0}/${Math.round(p.onTimeTarget || 0)}/${p.target}` : '—'}</td>
                              <td style={{ padding: '5px 6px' }}>{mp.headTotal ? `${mp.present || 0}/${mp.headTotal}` : '—'}</td>
                              <td style={{ padding: '5px 6px', color: p.dtMin ? '#f59e0b' : 'inherit' }}>{p.dtMin || 0}</td>
                              <td style={{ padding: '5px 6px', color: p.ng ? '#ef4444' : 'inherit' }}>{p.ng || 0}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>* คน/PM มักผูกกับไลน์แม่ (ลูกเป็น 0) · ผลิต/DT/NG อาจอยู่ที่ไลน์ลูก — การ์ดด้านบนรวมให้แล้ว</div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* 🏬 popup โซนคลังสินค้า — read-only viewer (ตั้งใจให้ปิดจาก backdrop ได้ · UI-CONVENTIONS §5) */}
      {storeZoneModal && (() => {
        const z = storeZoneModal; const f = z.fill; const km = zoneKindMeta(z.kind);
        const stColor = { good: 'var(--accent)', ok: '#f59e0b', bad: '#ef4444', idle: 'var(--muted)' }[z.cat] || 'var(--muted)';
        return (
          <div className="modal-scroll" style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setStoreZoneModal(null)}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: `1px solid ${stColor}`, borderRadius: 14, padding: '20px 22px', width: '100%', maxWidth: 640, maxHeight: '88vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginBottom: 4 }}>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{km.icon} {z.name}</div>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{km.label}</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: stColor }}>{zoneHealthText(f)}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
                รวม {f.totQty.toLocaleString()} ชิ้น · {f.unknownPkg ? `${f.totPkgs}+? กล่อง (ไม่รู้ขนาดกล่อง ${f.unknownPkg} MAT)` : `${f.totPkgs} กล่อง`}
                {z.capacity_pkg ? ` · ความจุ ${z.capacity_pkg} กล่อง${f.fillPct != null ? ` (${f.fillPct}%)` : ''}` : ' · ⚠ ยังไม่กรอกความจุ'}
                {z.note ? ` · ${z.note}` : ''}
              </div>
              {f.mats.length ? (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead><tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                      {['MAT', 'ชื่อพาร์ท', 'คงเหลือ', 'กล่อง', 'Min', 'Max', 'สถานะ'].map(h => <th key={h} style={{ padding: '4px 6px', borderBottom: '1px solid var(--border2)' }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {f.mats.slice().sort((a, b) => (b.short ? 1 : 0) - (a.short ? 1 : 0) || b.qty - a.qty).map(m => (
                        <tr key={m.mat_no} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '5px 6px', fontWeight: 700, whiteSpace: 'nowrap' }}>{m.mat_no}</td>
                          <td style={{ padding: '5px 6px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{z.nameMap?.[m.mat_no] || '—'}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{m.qty.toLocaleString()}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right' }}>{m.pkgs ?? '—'}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--muted)' }}>{m.min ?? '—'}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--muted)' }}>{m.max ?? '—'}</td>
                          <td style={{ padding: '5px 6px' }}>{m.short ? <span style={{ color: '#ef4444', fontWeight: 700 }}>🟥 ต่ำกว่า Min</span> : m.over ? <span style={{ color: '#f59e0b' }}>⚠ เกิน Max</span> : <span style={{ color: 'var(--accent)' }}>ปกติ</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div style={{ fontSize: 13, color: 'var(--muted)' }}>ยังไม่ผูก MAT กับโซนนี้ — ไปผูกที่ /line-stock แท็บ "โซนคลัง (ผัง)"</div>}
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                * ยอด = สต็อกของ MAT ที่ผูกกับโซน จาก ledger คลังกลาง (FG WAREHOUSE / STORE) — ระบบยังไม่บันทึกยอด "รายโซน" จริง (เฟสถัดไป)
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={() => navigate('/line-stock?tab=zones')} style={{ flex: 1, padding: '9px 0', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)' }}>🏬 จัดการโซน / ผูก MAT</button>
                <button onClick={() => navigate('/rundown-stock')} style={{ flex: 1, padding: '9px 0', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)' }}>📉 Rundown Stock</button>
                <button onClick={() => setStoreZoneModal(null)} style={{ flex: 1, padding: '9px 0', borderRadius: 9, fontSize: 13, fontWeight: 800, cursor: 'pointer', background: 'var(--accent)', color: '#fff', border: 'none' }}>ปิด</button>
              </div>
            </div>
          </div>
        );
      })()}

      {assignFor && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '22px 24px', width: '100%', maxWidth: 360 }}>
            {(() => { const okAssign = assignLine === '__new__' ? !!newZone.trim() : !!assignLine; const prodOpts = assignableLines(); const leafOpts = assignableLeafs(); const facOpts = assignableFacility(); const dieOpts = assignableDie(); const storeOpts = assignableStore(); return <>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>🖊️ ตีกรอบให้ไลน์/โซนไหน?</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>เลือกไลน์ผลิต หรือโซน MTN/facility ที่จะผูกกับรูปที่วาด ({assignFor.length} จุด) · กลุ่มที่ตีรายไลน์ลูกครบแล้วไม่ขึ้นในลิสต์ (ไม่ต้องตีแม่ซ้ำ)</div>
            <select value={assignLine} onChange={e => setAssignLine(e.target.value)} autoFocus style={{ width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 14, marginBottom: newZone !== '' || assignLine === '__new__' ? 8 : 16 }}>
              <option value="">— เลือกไลน์/โซน —</option>
              {prodOpts.length > 0 && <optgroup label="🏭 ไลน์ผลิต (ยังไม่มีกรอบ)">{prodOpts.map(n => <option key={n} value={n}>{n}</option>)}</optgroup>}
              {leafOpts.length > 0 && <optgroup label="↳ ไลน์ย่อยที่ยังไม่ได้ตี (กลุ่มตีเป็นรายลูก)">{leafOpts.map(n => <option key={n} value={n}>{n}</option>)}</optgroup>}
              {facOpts.length > 0 && <optgroup label="🔧 โซน MTN / Facility">{facOpts.map(n => <option key={n} value={n}>{n}</option>)}</optgroup>}
              {dieOpts.length > 0 && <optgroup label="🔨 คลังแม่พิมพ์ (ผังจัดเก็บใน /die-registry)">{dieOpts.map(n => <option key={n} value={n}>{n}</option>)}</optgroup>}
              {storeOpts.length > 0 && <optgroup label="🏬 โซนคลังสินค้า (ทะเบียนใน /line-stock แท็บโซนคลัง)">{storeOpts.map(n => <option key={n} value={n}>{n}</option>)}</optgroup>}
              <optgroup label="อื่นๆ"><option value="__new__">➕ พิมพ์ชื่อโซนใหม่…</option></optgroup>
            </select>
            {assignLine === '__new__' && (
              <div style={{ marginBottom: 16, display: 'grid', gap: 8 }}>
                {/* โซนใหม่เป็นอะไร — 'store' = สร้างทะเบียน storage_zones ให้ในขั้นเดียว (setup จบในจอแผนผัง) */}
                <div style={{ display: 'flex', gap: 6 }}>
                  {[['fac', '🔧 โซน MTN / Facility'], ['store', '🏬 โซนคลังสินค้า (WMS)']].map(([v, lb]) => (
                    <button key={v} onClick={() => setNewZoneType(v)}
                      style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: `1.5px solid ${newZoneType === v ? 'var(--accent)' : 'var(--border2)'}`, background: newZoneType === v ? 'rgba(74,222,128,0.12)' : 'var(--bg3)', color: newZoneType === v ? 'var(--accent)' : 'var(--text2)' }}>
                      {lb}
                    </button>
                  ))}
                </div>
                <input value={newZone} onChange={e => setNewZone(e.target.value)} autoFocus
                  placeholder={newZoneType === 'store' ? 'เช่น FG OUT LANE 1, WIP APRON, STORE SUB PART' : 'เช่น ห้องปั๊มลม, MTN Workshop, ระบบหล่อเย็น'}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 14, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box' }} />
                {newZoneType === 'store' && (
                  <>
                    <select value={newZoneKind} onChange={e => setNewZoneKind(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13 }}>
                      {ZONE_KINDS.map(k => <option key={k.key} value={k.key}>{k.icon} {k.label}</option>)}
                    </select>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>ระบบจะสร้างทะเบียนโซนคลังให้เลย — ผูก MAT/ความจุต่อที่ /line-stock แท็บ 🏬 โซนคลัง</div>
                  </>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setAssignFor(null); setNewZone(''); }} style={{ flex: 1, padding: '11px 0', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)' }}>ยกเลิก</button>
              <button onClick={confirmAssign} disabled={!okAssign} style={{ flex: 2, padding: '11px 0', borderRadius: 9, fontSize: 13, fontWeight: 800, cursor: okAssign ? 'pointer' : 'not-allowed', background: okAssign ? 'var(--accent)' : 'var(--muted)', color: '#fff', border: 'none' }}>✓ ตีกรอบ</button>
            </div>
            </>; })()}
          </div>
        </div>
      )}
    </div>
  );
}

const btn = (active) => ({
  padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border2)'}`,
  background: active ? 'var(--accent-dim)' : 'var(--bg3)', color: active ? 'var(--accent)' : 'var(--text2)',
});
const miniTab = (active) => ({
  padding: '7px 10px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border2)'}`,
  background: active ? 'var(--accent-dim)' : 'var(--bg3)', color: active ? 'var(--accent)' : 'var(--text2)',
});
const navBtn = { padding: '6px 11px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)' };
// หัวตาราง — ต้องสั่ง textAlign ที่ th เอง (index.css มี `th { text-align: left }` ที่ชนะการสืบทอดจาก <tr>)
const TH_L = { textAlign: 'left', padding: '5px 7px' };
const TH_R = { textAlign: 'right', padding: '5px 7px' };
// หัวข้อย่อยใน modal สรุปเรื่องราวทั้งวัน
function StorySection({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text2)', marginBottom: 7, paddingBottom: 5, borderBottom: '1px solid var(--border)' }}>{title}</div>
      {children}
    </div>
  );
}
function Chip({ label, val, color }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 20, padding: '2px 8px' }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span><span style={{ color }}>{val}</span>
    </span>
  );
}
