import { useState, useEffect, useMemo, useCallback, useContext, useRef } from 'react';
import { MoreMark } from '../components/InfoMore';
import { naturalCompare } from '../utils/listOrder';
import {
  LineChart, Line, BarChart, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine, LabelList,
} from 'recharts';
import { chartAnim } from '../utils/motion';
import { supabase, supabaseDR } from '../supabaseClient';
import { buildScheduleMaps, lineScheduleTeam } from '../utils/shiftAssign';
import { UserContext } from '../App';
import { inSectionScope, scopedLines as scopedLinesOf } from '../utils/sectionScope';
import { dtBucketName, buildDtIndex, dtTrashStats } from '../utils/downtimeCategory';
import { getLineFamilyNames, sortLineNames } from '../utils/lineHierarchy';
import { can } from '../utils/permissions';
import { toast } from '../components/Toast';
import useIsMobile from '../utils/useIsMobile';
import OeeInsightPanel from '../components/OeeInsightPanel'
import JigOeeAnalytics from '../components/JigOeeAnalytics';
import ParetoAbcChart from '../components/ParetoAbcChart';
import DowntimeTimeline from '../components/DowntimeTimeline';
import { pairAwareTotal, collapseOps, orderTotal } from '../utils/pairTotals';
import { loadOpInfo, opInfoSync } from '../utils/opItems';
import { parallelUnitsOf, flowModeOf } from '../utils/lineTypes';
import { lazy, Suspense } from 'react';
import { defectUnitCost, fmtBaht, lineCostCenter, rateFor, ratePerHour, RATE_COMPONENTS } from '../utils/costSaving';
import { loadAffectsLanes } from '../utils/affectsLanes';
import { qRatio, computeSessionOee, computeLiveOee, shiftStartDate, LIVE_MIN_ELAPSED, strictOee, wavg, wLoad, wRun, wProd, policyBreakForShift, breakIntervalsIn, dtMinOutsideBreaks, laneWeightFn, parallelNBySession, dtLineMin, laneBySessionId, buildCtMap, sumDefectQty, splitDefectQty, ngByMatFrom, isTrialDefect, avgOeeTarget, QBIN_EMBED, defectQty, defectQtyAll, suspectPendingQty } from '../utils/oee';
import { statusColor, statusOf, toneVar } from '../utils/statusTone';
import OeeHeadline, { GaugeRing, METRIC_COLOR, oeeColor } from '../components/OeeHeadline';
import LineLensMap from '../components/LineLensMap';     // 🗺️ ผังเครื่องจักรของไลน์ (ของกลางตัวเดียวกับ /factory-map)
import FactoryMiniMap from '../components/FactoryMiniMap'; // 🏭 ผังรวมโรงงานแบบอ่านอย่างเดียว (ข้อมูลกรอบชุดเดียวกับ /factory-map)
import PageHeader from '../components/PageHeader';
import Page from '../components/Page';
import FilterBar from '../components/FilterBar';
import Segmented from '../components/Segmented';
import { ALL, SHIFT_OPTIONS } from '../utils/filterLabels';
import { useSearchParams } from 'react-router-dom';
import TimeRangeBar from '../components/TimeRangeBar';
import useTimeRange from '../utils/useTimeRange';
import { bucketKey, bucketLabel } from '../utils/timeRange';
import useTabParam from '../utils/useTabParam';
import { urlBool } from '../utils/urlInit';
import {fmtTime, monthsShort, yearDisplay } from '../utils/dateFormat';
import { visibleInterval } from '../utils/usePolling';
import { fetchByIds, fetchAllPages } from '../utils/fetchByIds';
import { spanDays } from '../utils/borrowDays';
import { addDaysStr } from '../utils/workDate';
import LineSelect from '../components/LineSelect';
import LineScopeSelect, { deptLines } from '../components/LineScopeSelect';
import useOrgScope from '../utils/useOrgScope';
import { loadLinesRes, LINE_COLUMNS } from '../utils/useProductionLines';
import { useOrgSections, useOrgTeams } from '../utils/useOrgSections';
import { RATE } from '../utils/refreshRates';
import { useLatestRequest } from '../utils/useLatestRequest';

import { MORE_MARK } from '../components/InfoMore';   // เครื่องหมาย "อ่านเพิ่ม" ชุดเดียวกันทั้งระบบ
import { BREAK_POLICY_COLS } from '../utils/oeeMasters';
import NoticeBar from '../components/NoticeBar';
import { tr as trI18n, dateLocale } from '../utils/i18n';
import MatLabel from '../components/MatLabel';   // 📦 ป้าย MAT→ชื่อ/Part No. ของกลาง (ตาราง OEE รายพาร์ท)

/* ข้อความขยายของแถบ "ค่าสด" — ใช้ทั้งที่ title= ของบรรทัด (hover ทั้งบรรทัดบนจอคอม)
   และที่ <MoreMark> (กดเปิดได้บนจอสัมผัส) ⇒ เขียนที่เดียว ไม่ให้ 2 ที่เพี้ยนกัน · 18/11 */
const LIVE_MIX_NOTE = 'ค่าสด = คิดถึงเวลานี้ ตัวเลขจริงยืนยันตอนปิดกะ · OOE / TEEP / OEE จริง ด้านล่างนับเฉพาะกะที่ปิดแล้ว';
import { tint } from '../utils/statusTone';   // สี token ต่อ alpha-hex ไม่ได้ ⇒ ย่อยเป็น -dim/-line (UI §6.17)
const MonthlyReviewExport = lazy(() => import('../components/MonthlyReviewExport'));

// ── Colour helpers ───────────────────────────────────────────────
/* `oeeColor` · `METRIC_COLOR` ย้ายไป `components/OeeHeadline.jsx` (ของกลาง · import ข้างบน) */
/* 🚦 A/P/Q ไม่มีเกณฑ์ตายตัวในไฟล์นี้แล้ว (23/09) — ทุกจุดตัดสินด้วย `statusOf(v, trTarget.x)`
   คือ **เป้าจริงของกรุ๊ปที่เลือก** จากตาราง `oee_targets` ซึ่งเป็นเป้าเดียวกับที่จอพิมพ์ให้คนอ่านเห็น
   (เดิม `aColor` 90/75 · `pColor` 85/70 · `qColor` 99/95 ⇒ กรุ๊ปที่ตั้งเป้าเองจะถูกตัดสินผิดเป้า
   และค่ามาตรฐานของระบบคือ P 90 แต่โค้ดทาเขียวตั้งแต่ 85) · ห้ามเพิ่มเกณฑ์ตายตัวกลับเข้ามา */


// เป้าหมายมาตรฐาน (fallback) — ใช้เมื่อกรุ๊ปใน scope ยังไม่ถูกตั้ง target ในตาราง oee_targets
// ตั้งได้เฉพาะ A/P/Q — เป้า OEE ไม่ตั้งเอง คำนวณจาก A×P×Q เสมอ (คำสั่ง user 2026-07-13)
// target จริงตั้งรายกรุ๊ปจากปุ่ม 🎯 · ระดับ section = ค่าเฉลี่ยของกรุ๊ปใน section (ไม่เก็บใน DB)
const TARGET = { a: 90, p: 90, q: 99 };
TARGET.oee = Math.round(TARGET.a * TARGET.p * TARGET.q / 10000 * 10) / 10; // 80.2

/* `METRIC_LABEL` ย้ายไป `components/OeeHeadline.jsx` พร้อมหัวแดชบอร์ด (27/11) */

// ── OEE calculation helpers ──────────────────────────────────────
// หมายเหตุ: A/P/Q/OEE คำนวณและบันทึกไว้แล้วใน production_sessions (oee_a/oee_p/oee_q/oee)
// ตอนปิดกะจาก DailyReport.jsx ซึ่งคิดรวม break_policies และ CT ต่อ MAT.NO อย่างถูกต้องแล้ว
// ห้ามคำนวณซ้ำด้วยสูตรอย่างง่ายที่นี่ เพราะจะได้ตัวเลขคนละชุดกับหน้า Daily Report
/* breakPols: ต้องส่งมาเสมอ — `plannedMin`/`unplannedMin` ที่คืนไปคือ "นาทีที่หักจากฐานเวลาได้จริง"
   นาที downtime ที่ตกอยู่ในช่วงพักตามนโยบายถูกกันออกจากฐานไปแล้วรอบหนึ่ง **ห้ามหักซ้ำ** (utils/oee §3.1)
   ⚠️ คนละตัวกับนาทีในพาเรโต/มูลค่า (`dtRecords`) ที่ยังใช้ duration_min เต็ม = "เครื่องหยุดกี่นาที" */
/* `lines` = ทะเบียนไลน์ (แมป ชื่อไลน์ → แถว) — ไลน์เครื่องขนานบันทึก downtime รายเครื่อง
   ⇒ ต้องหารด้วยจำนวนเลนก่อนเอามาหักจากเวลากะ (oee.js §3.2) ไม่งั้น `plannedMin` ทะลุความยาวกะ
   แล้วน้ำหนัก wLoad ของกะนั้นเหลือ 0 = หายจากค่าเฉลี่ยเงียบๆ */
/* ── 📦 รวม `byProduct` จากหลายกะ — ใช้ทั้งแท็บรายวันและรายช่วง (2026-11-24) ────────────
   🔴 **สูตรไม่ได้อยู่ที่นี่** — `computeSessionOee()` คืน `byProduct` มาให้แล้ว (oee.js §OEE รายพาร์ท)
      ฟังก์ชันนี้ทำแค่ "รวมหลายกะ"
   🔴 รวมด้วย **ตัวตั้งรวม ÷ ตัวหารรวม** ห้ามเฉลี่ย % ของแต่ละกะ (mean-of-means — กะที่ผลิตน้อย
      จะถ่วงเท่ากะที่ผลิตเยอะ · กฎเดียวกับ KPI รวมใน obeya-kpi-board)
   🔴 `overlap` = ไลน์เดินหลายพาร์ทพร้อมกัน ⇒ จอต้องเขียนว่า **บวกเป็นภาพรวมไลน์ไม่ได้** (UI §6.43) */
/* 🔒 เพดานช่วงของแท็บ "รายพาร์ท" — ต้องคิด computeSessionOee ทีละกะ (ไม่ใช่อ่านค่าที่ประทับ)
   ⇒ ช่วงยาวเกินนี้ = จอค้าง + egress บาน ⇒ ตัดให้เหลือ N วันล่าสุดของช่วง **แล้วเขียนบนจอว่าตัด**
   (กฎจอซื่อสัตย์ — ห้ามตัดเงียบ) · 31 วัน = ครอบ 1 เดือน KPI */
const PART_MAX_DAYS = 31;

function aggregateByProduct({ sessions, ordersBySession, downtimes, defects, prods, kstds,
  breakPols, flowByLine, affectsLn }) {
  if (!prods?.length) return { rows: [], overlap: false, sessions: 0, unknownQty: 0, failed: 0 };
  const bySess = (rows) => (rows || []).reduce((m, r) => ((m[r.session_id] ||= []).push(r), m), {});
  const dtBy = bySess(downtimes), defBy = bySess(defects);
  const acc = new Map();
  let overlap = false, nSess = 0, unknownQty = 0, failed = 0;
  for (const sess of sessions) {
    const os = ordersBySession[sess.id] || [];
    if (!os.length) continue;
    let R;
    try {
      R = computeSessionOee({
        session: sess, orders: os,
        downtimes: dtBy[sess.id] || [], defects: defBy[sess.id] || [],
        products: prods, kanbanStds: kstds || [], breakPolicies: breakPols || [],
        processType: sess.dr_products?.process_type || null,
        lineFlow: flowByLine?.[sess.line_name] || {}, affectsLanes: affectsLn,
        endTime: sess.end_time || null,
      });
    } catch { failed++; continue; }
    if (!R?.byProduct?.length) continue;
    nSess++; unknownQty += Number(R.unknownQty) || 0;
    if (R.byProductOverlap) overlap = true;
    for (const g of R.byProduct) {
      const cur = acc.get(g.key) || { key: g.key, name: g.name, pNo: g.pNo, matNos: new Set(),
        netAvailMin: 0, runMin: 0, stdMin: 0, pcs: 0, good: 0, ngQty: 0, qBasePcs: 0, shifts: 0,
        overlap: false, lines: new Set(), byDay: new Map() };
      g.matNos.forEach(m => cur.matNos.add(m));
      cur.name ||= g.name; cur.pNo ||= g.pNo;
      cur.netAvailMin += g.netAvailMin; cur.runMin += g.runMin; cur.stdMin += g.stdMin;
      cur.pcs += g.pcs; cur.good += g.good; cur.ngQty += g.ngQty; cur.qBasePcs += g.qBasePcs || 0;
      cur.shifts += 1; cur.overlap = cur.overlap || g.overlap;
      cur.lines.add(sess.line_name);
      /* 📅 สะสม "ตัวตั้ง/ตัวหาร" รายวันไว้ด้วย — หัวแดชบอร์ดของแท็บนี้ต้องวาดเทรนด์รายวันของพาร์ทที่เลือก
         🔴 เก็บเป็นตัวตั้ง/ตัวหาร **ห้ามเก็บ %** แล้วมาเฉลี่ยทีหลัง (mean-of-means — กฎเดียวกับข้างล่าง) */
      const dk = sess.work_date;
      if (dk) {
        const d = cur.byDay.get(dk) || { netAvailMin: 0, runMin: 0, stdMin: 0, good: 0, ngQty: 0, qBasePcs: 0 };
        d.netAvailMin += g.netAvailMin; d.runMin += g.runMin; d.stdMin += g.stdMin;
        d.good += g.good; d.ngQty += g.ngQty; d.qBasePcs += g.qBasePcs || 0;
        cur.byDay.set(dk, d);
      }
      acc.set(g.key, cur);
    }
  }
  /* 🔴 สูตรเดียวกันทั้ง "ทั้งช่วง" และ "รายวัน" — เขียนที่เดียวแล้วเรียกซ้ำ ห้ามก๊อป */
  const apqOf = (r) => {
    const A = r.netAvailMin > 0 ? Math.min(1, r.runMin / r.netAvailMin) : null;
    const P = r.runMin > 0 ? Math.min(1, r.stdMin / r.runMin) : null;
    /* 🔴 %Q = งานดี ÷ **ยอดผลิต** ผ่านสูตรกลาง `qRatio` (oee.js §7.2.2) ห้ามคิดเองที่นี่ —
       `qBasePcs` = ฐานที่ `computeSessionOee` คิดมาแล้วรายพาร์ท (ตัดงานทดลองออก) */
    const Q = qRatio(Math.max(r.qBasePcs, r.good + r.ngQty), r.ngQty);
    return { A, P, Q, oee: (A != null && P != null && Q != null) ? A * P * Q : null };
  };
  const rows = [...acc.values()].map(r => {
    /* เทรนด์รายวันของพาร์ทนี้ (เรียงวัน) — หัวแดชบอร์ดเอาไปวาดแท่ง A/P/Q
       🔴 ไม่เติมวันที่ไม่มีกะ: "ไม่ได้ผลิต" ≠ "ผลิตแล้วได้ 0" (MiniTrend วาดตอเทาให้เองถ้าค่าเป็น null) */
    const days = [...r.byDay.entries()].sort((x, y) => x[0].localeCompare(y[0]))
      .map(([date, d]) => ({ date, ...apqOf(d) }));
    const { byDay, ...rest } = r;    // eslint-disable-line no-unused-vars -- Map ไม่ต้องไหลออกไปที่จอ
    return { ...rest, matNos: [...r.matNos], lines: [...r.lines], days, ...apqOf(r) };
  }).sort((a, b) => (a.oee == null) - (b.oee == null) || (a.oee ?? 0) - (b.oee ?? 0));
  return { rows, overlap, sessions: nSess, unknownQty, failed };
}

function calcOEE(sessions, downtimes, defects, breakPols = [], lines = null, affectsBy = null) {
  const laneOf = lines ? parallelNBySession(lines) : null;
  const results = [];
  for (const s of sessions) {
    const sessionDT = downtimes.filter(d => d.session_id === s.id);
    const sessionDefects = defects.filter(d => d.session_id === s.id);

    const startMs = (s.work_date && s.start_time)
      ? new Date(`${shiftStartDate(s.work_date, String(s.start_time).slice(0, 5), s.shift)}T${String(s.start_time).slice(0, 5)}:00`).getTime() : null;
    const brkIv = (startMs && Number(s.shift_min) > 0 && breakPols.length)
      ? breakIntervalsIn({ policies: breakPols, startMs, endMs: startMs + Number(s.shift_min) * 60000,
          workDate: s.work_date, shift: s.shift, lineName: s.line_name })   // 🏭 ข้อยกเว้นเวลาพักรายไลน์ (ทะเบียนกลาง · 20/10)
      : [];
    const laneW = laneOf ? laneWeightFn(laneOf(s), affectsBy) : () => 1;
    const plannedMin   = sessionDT.filter(d => d.dr_downtime_types?.category === 'planned').reduce((a, d) => a + dtMinOutsideBreaks(d, brkIv) * laneW(d), 0);
    const unplannedMin = sessionDT.filter(d => d.dr_downtime_types?.category !== 'planned').reduce((a, d) => a + dtMinOutsideBreaks(d, brkIv) * laneW(d), 0);

    const ngQty = sessionDefects.reduce((a, d) => a + (d.qty_ng || 0), 0) + (s.qty_ng || 0);
    const totalQty = s.actual_qty || 0;
    const okQty = s.qty_ok || totalQty; // การ์ดที่สแกน = ของดีล้วน → fallback ยอดดี = ยอดผลิต (ไม่หัก NG ซ้ำ)

    results.push({
      ...s,
      calcA: s.oee_a != null ? +Number(s.oee_a).toFixed(1) : null,
      calcP: s.oee_p != null ? +Number(s.oee_p).toFixed(1) : null,
      calcQ: s.oee_q != null ? +Number(s.oee_q).toFixed(1) : null,
      calcOEE: s.oee  != null ? +Number(s.oee).toFixed(1)  : null,
      unplannedMin: +unplannedMin.toFixed(1),
      plannedMin:   +plannedMin.toFixed(1),
      dtBreakdown: sessionDT,
      defectBreakdown: sessionDefects,
      ngQty, okQty, totalQty,
    });
  }
  return results;
}

/* ── OOE / TEEP — ต่างจาก OEE ที่ "ฐานเวลา" อย่างเดียว (2026-08-04 · คำสั่ง user) ────────────
   OEE  = ฐาน "เวลารับภาระ" (เวลากะ − พักนโยบาย − หยุดตามแผน)  → ตอนที่ตั้งใจเดิน เดินดีแค่ไหน
   OOE  = ฐาน "เวลากะทั้งหมด" (รวมพัก + หยุดตามแผน)            → เวลาที่โรงงานเปิด ใช้คุ้มแค่ไหน
   TEEP = ฐาน "เวลาปฏิทิน 24 ชม./วัน"                          → กำลังผลิตที่มีทั้งหมด ใช้ไปกี่ %
   ค่าจะเรียง TEEP ≤ OOE ≤ OEE เสมอ (ฐานใหญ่ขึ้น เลขเล็กลง)
   คิดจาก OEE ที่ stamp ไว้แล้วคูณสัดส่วนฐาน — ไม่คำนวณ A/P/Q ใหม่ (กันได้ตัวเลขคนละชุดกับ Daily Report) */
// เวลาพักตามนโยบาย — ใช้ util กลาง (src/utils/oee.js) จุดเดียวกับ Daily Report
// เดิมมีสูตรท้องถิ่นที่ทิ้งนโยบายเฉพาะ process + ใช้เวลาเริ่มกะตายตัว 08:00/20:00 → นับพักขาด
// ทำให้ OEE จริง/OOE ของกะเดียวกันไม่ตรงกับแท็บประวัติใน Daily Report (รวมเป็นตัวเดียว 2026-08-05)
const policyBreakMin = (row, policies) => policyBreakForShift({
  policies, shift: row.shift, shiftMin: row.shift_min, workDate: row.work_date, startTime: row.start_time,
});

// ── ค่าเฉลี่ยถ่วงน้ำหนักตามตำรา OEE ───────────────────────────────
// A/OEE ถ่วงด้วย "เวลารับภาระ" (loading time = shift − planned DT) · P ถ่วงด้วย "เวลาเดินเครื่อง"
// (loading × A) · Q ถ่วงด้วย "จำนวนที่ผลิต" (ดี + เสีย) — กะเล็กไม่ถ่วงเท่ากะใหญ่ (เดิมเฉลี่ยธรรมดา
// mean-of-percentages ทำให้กะผลิต 10 ชิ้นครึ่งชม.มีน้ำหนักเท่ากะทั้งวัน · แก้ 2026-08-02)
// รับ field ได้ทั้งแบบเต็ม (calcA/plannedMin/totalQty จาก calcOEE) และแบบ history (oee_a/actual_qty/qty_ng)
// ── Date helpers ─────────────────────────────────────────────────
// ⚠️ ห้ามใช้ toISOString() เพื่อคำนวณวันที่ local — จะเพี้ยนข้ามวันเพราะ UTC offset (ดู CLAUDE.md)
// สัปดาห์เริ่มวันจันทร์ (ธรรมเนียมโรงงาน) — key = วันที่จันทร์ของสัปดาห์นั้น (YYYY-MM-DD, sortable)
/* ⏱️ ตัวแบ่งถัง/ป้ายแกนเวลา ย้ายไป `src/utils/timeRange.js` ทั้งหมดแล้ว (23/09)
   — ของเดิมในหน้านี้ถูกลบทิ้ง **ห้ามเขียนกลับมาในหน้า** (จะกลายเป็นสูตรคนละชุดกับหน้าอื่นอีก) */
const fmtThaiDate   = d => { if (!d) return '—'; const [y,m,dd] = d.split('-').map(Number); return `${dd} ${monthsShort()[m-1]} ${yearDisplay(y)}`; };

function getWorkDateStr(date = new Date()) {
  const h = date.getHours();
  const d = new Date(date);
  if (h < 8) d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function dateStrAdd(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// ── KPI Card ─────────────────────────────────────────────────────
/* `calc` = ที่มาของตัวเลข (user 2026-08-20: "จะรู้ได้ไงว่า A เท่านี้มาจาก downtime กี่นาที")
   — เป็นตัวเลขอธิบาย ไม่ใช่ตัวที่เอาไปคำนวณซ้ำ · ค่าจริงยังเป็นค่าที่ stamp ตอนปิดกะ */
/* KpiCard — ตัวเลข + ที่มาของสูตร
   `calc` = **ตัวเลขที่มา (ตัวตั้ง ÷ ตัวหาร = ผล) เห็นตลอด** — คือสิ่งที่ user ขอไว้
            ("จะรู้ได้ไงว่า A เท่านี้มาจาก downtime กี่นาที") ห้ามเอาไปซ่อน
   `more`  = คำอธิบายเชิงแนวคิด/ข้อควรระวัง → พับไว้หลังปุ่ม ⓘ (user 2026-08-21:
            "รายละเอียดที่อธิบายเยอะๆ เป็น tooltips ดีมั้ย") เพราะกำแพงข้อความบนการ์ด
            ทำให้เลขจริงจมหาย
   ⚠️ ใช้ "กดเปิด" ไม่ใช่ hover tooltip — จอสัมผัส/จอ TV ไม่มีเมาส์ (UI-CONVENTIONS §6) */
/* `primary` = ใบพระเอกของแถว (23/09 · brief De-AI UI ข้อ 03) — แถวนี้ OEE เป็นพระเอกโดยธรรมชาติ
   เพราะ **OEE = A × P × Q** ⇒ A/P/Q คือ "ตัวประกอบ" ของมัน ไม่ใช่ตัวเลขคนละเรื่องที่มาเรียงกัน
   เดิม 5 ใบ 28px เท่ากันหมด ⇒ จอไม่ได้บอกว่าอันไหนคือผลรวม อันไหนคือส่วนประกอบ
   `unit` = หน่วยท้ายเลข (ค่าเริ่มต้น '%') — ใบ "ผลิตรวม" เคยส่ง value={null} ทำให้ช่องเลขใหญ่
   ขึ้น "—" แล้วเอาเลขจริงไปซ่อนใน sub ขนาด 11px (= ตัวเลขที่ใหญ่ที่สุดบนการ์ดคือขีด) */
const KpiCard = ({ label, value, color, sub, calc, more, primary = false, unit = '%' }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      background: 'var(--card-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
      padding: primary ? '16px 22px' : '14px 18px',
      minWidth: primary ? 210 : 110, flex: primary ? '2 1 240px' : '1 1 130px',
    }}>
      <div style={{ fontSize: primary ? 12.5 : 11, fontWeight: primary ? 700 : 400, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: primary ? 46 : 28, fontWeight: 900, color: color || 'var(--text)', lineHeight: 1 }}>
        {value ?? '—'}
        {value != null && unit && <span style={{ fontSize: primary ? 20 : 14, fontWeight: 600, marginLeft: 2 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: primary ? 12 : 11, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
      {calc && (
        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--border)', lineHeight: 1.65 }}>
          {calc}
          {more && (
            <>
              <button onClick={() => setOpen(o => !o)} style={{
                marginTop: 5, padding: '2px 7px', borderRadius: 'var(--r-md)', cursor: 'pointer',
                border: '1px solid var(--border2)', background: 'var(--bg3-surf)',
                color: 'var(--muted)', fontSize: 11, fontWeight: 700,
              }}>{open ? trI18n("ย่อ") : `${MORE_MARK} ${trI18n("อ่านเพิ่ม")}`}</button>
              {open && <div style={{ marginTop: 5 }}>{more}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ── Custom tooltip ───────────────────────────────────────────────
const OEETooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--bg3-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '8px 12px', fontSize: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color }}>{p.name}: {p.value?.toFixed(1)}%</div>
      ))}
    </div>
  );
};

/* 📊 GaugeRing · MiniTrend · หัวแดชบอร์ด OEE ย้ายไป `src/components/OeeHeadline.jsx` (27/11)
   — แท็บ "รายพาร์ท" ใช้ก้อนเดียวกัน ⇒ ของกลาง (CLAUDE.md 26/11 · UI §0.1) */

// ── Vertical metric bar (Live session card) ───────────────────────
function MetricColumn({ label, value, target, color }) {
  const H = 130;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const barH = (pct / 100) * H;
  const targetTop = H - (target / 100) * H;
  return (
    <div style={{ textAlign: 'center', width: 70 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ position: 'relative', width: 44, height: H, margin: '0 auto', background: 'var(--bg2-surf)', borderRadius: 'var(--r-md)', overflow: 'hidden', border: '1px solid var(--border)' }}>
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: barH, background: color, transition: 'height .5s ease' }} />
        <div style={{ position: 'absolute', left: -1, right: -1, top: targetTop, borderTop: '2px dashed rgba(255,255,255,0.55)' }} />
      </div>
      <div style={{ marginTop: 6, fontWeight: 900, fontSize: 15, color }}>{value != null ? value.toFixed(1) : '—'}%</div>
    </div>
  );
}

const STATUS_BADGE = {
  open:          { label: 'RUNNING',    bg: 'var(--green-dim)',  color: 'var(--green)' },
  pending_close: { label: 'รออนุมัติปิด', bg: 'var(--amber-dim)', color: 'var(--amber)' },
  closed:        { label: 'ปิดกะแล้ว',   bg: 'rgba(148,163,184,0.15)', color: 'var(--muted)' },
};

// ── Main Component ───────────────────────────────────────────────
export default function OEEAnalytics() {
  const { role, lineId: userLineId, sections: scopeSecs = [], fullName, scopeIdx } = useContext(UserContext);
  const isMobile = useIsMobile(); // ≤768px: grid วิเคราะห์ยุบเป็นคอลัมน์เดียว กันกราฟถูกตัด (desktop ไม่เปลี่ยน)
  const [viewTab, setViewTab] = useTabParam(['today', 'part', 'trend', 'insight', 'machine'], 'today');
  // break_policies — ใช้คิดเวลาพักนโยบายสำหรับ OOE/TEEP (ต้องประกาศก่อน tdKpi/kpi ที่เรียกใช้)
  const [breakPols, setBreakPols] = useState([]);
  /* 🔀 "เครื่องไหนหยุดแล้วครอบกี่เลน" (machines.affects_lanes · utils/affectsLanes.js)
     `{}` = ยังไม่โหลด / ไม่มีใครกรอก = ทุกเครื่องครอบ 1 เลน = **พฤติกรรมเดิมเป๊ะ** */
  const [affectsLn, setAffectsLn] = useState({});
  useEffect(() => { let alive = true; loadAffectsLanes().then(m => { if (alive) setAffectsLn(m || {}); }); return () => { alive = false; }; }, []);
  useEffect(() => {
    supabaseDR.from('break_policies').select(BREAK_POLICY_COLS).eq('is_active', true)
      .then(r => setBreakPols(r.data || []), () => setBreakPols([]));
  }, []);
  const canSetTarget = can('oee', 'set_target', role);
  const canExportReview = can('oee', 'export_review', role);
  const [showReviewExport, setShowReviewExport] = useState(false);

  // ── Target OEE/A/P/Q รายกรุ๊ป (ตาราง oee_targets ฝั่ง Main) ──
  const [oeeTargets, setOeeTargets] = useState({});          // { group_name: row }
  const [showTargetModal, setShowTargetModal] = useState(false);
  const loadTargets = useCallback(async () => {
    const { data } = await supabase.from('oee_targets').select('*');
    const m = {};
    (data || []).forEach(r => { m[r.group_name] = r; });
    setOeeTargets(m);
  }, []);
  useEffect(() => { loadTargets(); }, [loadTargets]);

  // mandatory scope (แบบเดียวกับ DailyReport): leader → ครอบครัวไลน์ตัวเอง ·
  // role ที่ถูกจำกัด sections → เฉพาะไลน์ในส่วนงาน scope — filter อิสระของหน้า apply ทับอีกที
  const isScoped = (role === 'leader' && !!userLineId) || scopeSecs.length > 0;   // ธง "บัญชีนี้ถูกจำกัดไหม" (ไม่ใช่ตัวตัดสินขอบเขต)

  // ══════════════════════════ Shared line/org data ══════════════════════════
  const [linesFull, setLinesFull] = useState([]); // [{id,name,section,parent_line_name}] — ถูก scope แล้ว
  const [parentChildrenMap, setParentChildrenMap] = useState({}); // { 'HYDROFORM': ['HDF1','HDF2',...] }
  // line_name → { flow_mode, parallel_stations } — หัก DT ที่ระบุเครื่อง 1/N ใน OEE สด (best-effort แยก query
  // เหมือน FactoryMap — ยังไม่ apply migration 20260723 ก็ไม่พังลิสต์ไลน์หลัก · N=1 พฤติกรรมเดิม)
  const [flowByLine, setFlowByLine] = useState({});
  useEffect(() => {
    loadLinesRes()
      .then(({ data }) => {
        if (!data) return;
        const m = {}; data.forEach(l => { m[l.name] = l; });
        setFlowByLine(m);
      }, () => {});
  }, []);

  useEffect(() => {
    // LINE_COLUMNS (id,name,parent_line_name,section,is_active) ครบสำหรับ <LineSelect> + cost_center ที่หน้านี้ใช้คิดต้นทุน (2026-09-07)
    // (ไม่ใช้ useProductionLines() ตรงๆ เพราะ cache กลางไม่มี cost_center — คิวรีเดียวแต่ scope เองเหมือนเดิม)
    loadLinesRes().then(({ data }) => {
      /* 🔭 ของกลาง `scopedLines()` (QC audit 09/11 · กวาดรอบ 2) — สูตรเดิมในหน้าแคบกว่าที่
         `profiles` ตั้งไว้ (leader ได้ครอบครัวไลน์ล้วน · ไม่รู้จัก `scopeIdx`) */
      let rows = data || [];
      const scoped = scopedLinesOf({ role, lineId: userLineId, sections: scopeSecs, lines: rows, scopeIdx });
      if (scoped.length !== rows.length) rows = scoped;
      setLinesFull(rows);
      const pcm = {};
      rows.forEach(l => {
        if (l.parent_line_name) {
          if (!pcm[l.parent_line_name]) pcm[l.parent_line_name] = [];
          pcm[l.parent_line_name].push(l.name);
        }
      });
      setParentChildrenMap(pcm);
    });
  }, []);

  /* ══════════════════════════════════════════════════════════════════════
     TAB: TODAY — real-time single-day monitoring dashboard
     ══════════════════════════════════════════════════════════════════════ */
  /* 🔗 รับตัวกรองที่ "เจาะมา" จากหน้าอื่น (2026-09-22 · user: เจาะจาก OBEYA ที่กรอง PD3 ไว้
     แล้วต้องมากรองใหม่อีกรอบ) — `?section=` / `?date=` · ไม่มีก็ใช้ค่าเริ่มต้นเดิมเป๊ะ
     30/09 เพิ่ม `?dept=` (แผนก/กลุ่มไลน์) + `?line=` — ขอบเขตบน OBEYA เลือกได้ถึงระดับไลน์ (`drillParams()`)
     ⇒ ทั้ง 3 แท็บต้องเริ่มที่ขอบเขตเดียวกัน: วันนี้ (section→dept→line) · แนวโน้ม/วิเคราะห์ (ไลน์ = line ∥ dept) */
  const [urlParams] = useSearchParams();
  const [tdDate,   setTdDate]   = useState(() => urlParams.get('date') || getWorkDateStr());
  const [tdShift,  setTdShift]  = useState(() => (['day', 'night'].includes(urlParams.get('shift')) ? urlParams.get('shift') : ''));   // ?shift= (จอวนหน้า · 15/10)
  const [tdSection,setTdSection]= useState(() => urlParams.get('section') || '');
  const [tdDept,   setTdDept]   = useState(() => urlParams.get('dept') || '');
  // แผนกตามผังองค์กร (BIG PRESS ฯลฯ · 2026-10-02) — กรองด้วย "ชุดไลน์ของแผนก" จากดัชนีผังตัวเดียวกับช่องขอบเขต
  const [tdUnit,   setTdUnit]   = useState(() => urlParams.get('unit') || '');
  const [tdLine,   setTdLine]   = useState(() => urlParams.get('line') || '');
  /* ไลน์ของแท็บแนวโน้ม (ประกาศตรงนี้เพราะ effect ตรวจสิทธิ์ด้านล่างต้องเคลียร์มันด้วย) = ที่เจาะมา (`?line=` ละเอียดกว่า `?dept=`) */
  const [selLine,    setSelLine]    = useState(() => urlParams.get('line') || urlParams.get('dept') || '');
  /* 🔎 ช่องกรอง "ชิ้นงาน" ของแท็บรายพาร์ท (27/11 · คำสั่ง user "สามารถกรองชิ้นงานที่ผลิตรายนั้นได้")
     ว่าง = ยังไม่เลือก ⇒ หัวแดชบอร์ดเลือกพาร์ทที่เดินเครื่องนานสุดให้เอง (เขียนบนจอว่าเลือกตัวไหน)
     🔴 เก็บเป็น `key` ของกลุ่มพาร์ท (จาก `byProduct.key`) ไม่ใช่ MAT เดี่ยว — 1 สินค้าอาจมีหลาย MAT */
  const [selPart,    setSelPart]    = useState(() => urlParams.get('part') || '');
  /* 🗺️ ไลน์ที่การ์ด "ผังไลน์" (แท็บภาพรวมวันนี้) กำลังโชว์ — ว่าง = ตามตัวกรองไลน์ของหน้า
     ตัวกรองหน้าเป็น "ทั้งโรงงาน" = **คนต้องเลือกเองจากช่องบนการ์ด** ห้ามให้ระบบเลือกให้เงียบๆ
     (27/11 · user ทัก *"filter เลือกทั้งโรงงานแต่ทำไมโชว์ Assy LWR"*) */
  const [tdMapPick,  setTdMapPick]  = useState('');
  /* 👥 ลิสต์ทีมจากผัง (`useOrgTeams` · ผังยังไม่มีทีม = A/B/C) — 05/11 audit dropdown เดิม hardcode A/B/C
     `?team=` รับตามลิงก์ · ค่าที่ไม่อยู่ในผังยังโชว์ในช่อง (ติดป้าย) ไม่ทิ้งเงียบ */
  const orgTeams = useOrgTeams();
  const [tdTeam,   setTdTeam]   = useState(() => urlParams.get('team') || '');
  // แถบ "วันนี้เทียบค่าเฉลี่ย" พับเป็นค่าเริ่มต้น — หน้านี้คือภาพวันเดียว การเทียบย้อนหลังอยู่แท็บแนวโน้ม
  // ?cmp= / ?auto= (จอวนหน้า /display-rotation · ไม่มีในลิงก์ = ค่าเดิม)
  const [tdCmpOpen, setTdCmpOpen] = useState(() => urlBool('cmp', false));
  const [autoRefresh, setAutoRefresh] = useState(() => urlBool('auto', true));
  const [lastUpdate,  setLastUpdate]  = useState(null);

  const [tdSessions,  setTdSessions]  = useState([]);
  const [tdDowntimes, setTdDowntimes] = useState([]);
  const [tdLoadWarn,  setTdLoadWarn]  = useState(null);
  const [tdDefects,   setTdDefects]   = useState([]);
  const [tdHistory,   setTdHistory]   = useState([]); // last 10 days, closed sessions, lightweight
  const [tdProductsByMat, setTdProductsByMat] = useState({}); // mat_no -> part name
  const [tdCtMap, setTdCtMap] = useState({});                 // mat_no -> cycle_time_sec (คำนวณ OEE สดของกะที่ยังไม่ปิด)
  const [tdOrdersBySession, setTdOrdersBySession] = useState({}); // session_id -> prod_orders[] (สำหรับนับงานคู่ RH/LH เป็น 1 คู่)
  const [tdPairMat, setTdPairMat] = useState({}); // mat_no -> pair_mat_no
  const [shiftSchedMap, setShiftSchedMap] = useState({}); // ผลของ buildScheduleMaps (byLine + parentOf)
  const [tdLoading, setTdLoading] = useState(false);

  // Cascading Section → Department(group) → Line options (2026-09-07: ส่วนงานยึด org_nodes · แผนก/ไลน์ผ่าน <LineSelect> กลาง)
  // ส่วนงานจากผังองค์กร (กฎ CLAUDE.md) เฉพาะที่มีไลน์ใน scope ของ user · ผังยังว่าง = ถอยไปเดาจาก production_lines (backward-compat)
  const orgSections = useOrgSections();
  const sectionOptions = useMemo(() => {
    const inLines = new Set(linesFull.map(l => l.section).filter(Boolean));
    const fromOrg = orgSections.filter(sec => inLines.has(sec));
    return fromOrg.length ? fromOrg : [...inLines].sort(naturalCompare);
  }, [orgSections, linesFull]);

  /* ⚠️ ส่วนงานที่เจาะมาอาจ **อยู่นอกขอบเขตของคนที่กดเปิดลิงก์** (คนละ role/scope)
     ปล่อยไว้ = จอกรองด้วยค่าที่ตัวเองไม่มีสิทธิ์ แล้วได้ผลว่าง "เหมือนไม่มีข้อมูล"
     ⇒ เคลียร์ทิ้งแล้วบอกบนจอ (กฎ: ห้ามล้มเหลวเงียบ) · เช็คครั้งเดียวตอนทะเบียนไลน์โหลดเสร็จ */
  const secFromUrlDone = useRef(false);
  useEffect(() => {
    if (secFromUrlDone.current || !linesFull.length) return;
    secFromUrlDone.current = true;
    const want = urlParams.get('section');
    if (want && !sectionOptions.includes(want)) {
      setTdSection(''); setTdDept(''); setTdLine('');
      toast.info(`${trI18n("ไม่มีสิทธิ์ดูส่วนงาน")} "${want}" ${trI18n("ที่เจาะมา — แสดงทุกส่วนงานที่คุณเห็นได้แทน")}`);
      return;
    }
    /* แผนก/ไลน์ที่เจาะมาก็ต้องมีในทะเบียนที่คนนี้เห็น — ไม่มี = เคลียร์แล้วบอก (ไม่ใช่กรองด้วยชื่อที่ไม่มี = จอว่างเงียบ) */
    const names = new Set(linesFull.map(l => l.name));
    const wDept = urlParams.get('dept'), wLine = urlParams.get('line');
    if (wLine && !names.has(wLine)) { setTdLine(''); setSelLine(wDept && names.has(wDept) ? wDept : ''); toast.info(`${trI18n("ไม่พบไลน์")} "${wLine}" ${trI18n("ที่เจาะมาในทะเบียนที่คุณเห็นได้")}`); }
    if (wDept && !names.has(wDept)) { setTdDept(''); setTdLine(''); setSelLine(''); toast.info(`${trI18n("ไม่พบแผนก/กลุ่มไลน์")} "${wDept}" ${trI18n("ที่เจาะมาในทะเบียนที่คุณเห็นได้")}`); }
  }, [linesFull, linesFull.length, sectionOptions, urlParams]);

  const { index: orgIdx } = useOrgScope(linesFull);
  const tdUnitLines = useMemo(() => deptLines(orgIdx, tdUnit, linesFull), [orgIdx, tdUnit, linesFull]);
  const tdScopeLines = useMemo(() => {
    if (tdLine) return [tdLine];
    // แผนกที่ไม่มีไลน์ผลิต = ห้ามตกไปเป็น "ทั้งโรงงาน" (in() ว่าง = ไม่กรอง) ⇒ ใส่ชื่อที่ไม่มีวันตรง ให้จอขึ้นว่างตามจริง
    if (tdUnit) return tdUnitLines?.length ? tdUnitLines : ['__ไม่มีไลน์ในแผนกนี้__'];
    if (tdDept) return parentChildrenMap[tdDept] ? [tdDept, ...parentChildrenMap[tdDept]] : [tdDept];
    if (tdSection) return linesFull.filter(l => l.section === tdSection).map(l => l.name);
    // ไม่เลือก filter: role ที่ถูก scope → จำกัดที่ไลน์ใน scope เสมอ (linesFull ถูก scope แล้ว) · ไม่ scope → ทุกไลน์
    return isScoped ? linesFull.map(l => l.name) : null;
  }, [tdLine, tdUnit, tdUnitLines, tdDept, tdSection, linesFull, parentChildrenMap, isScoped]);

  const tdScopeLabel = tdLine || tdDept || (tdUnit ? `${trI18n("แผนก")} ${tdUnit}` : '') || tdSection || trI18n("ทุกไลน์");

  /* 🔴 ไลน์ที่ส่งให้แท็บ "เจาะลึก" ต้องเป็น array **ตัวเดิม** ตราบใดที่ค่ายังไม่เปลี่ยน
     เดิมเขียน `linesFull.filter(...)` ตรงใน JSX ⇒ array ใหม่ทุก render ⇒ `run` ในแผงนั้น
     เปลี่ยน identity ทุก render ⇒ ยิงคิวรีซ้ำไม่หยุด (กฎเหล็กการเขียน DB ข้อ 9 · QC 06/10) */
  const insightLines = useMemo(
    () => (tdSection ? linesFull.filter(l => l.section === tdSection) : linesFull),
    [tdSection, linesFull]);

  // ── Target ตาม scope ที่เลือก ──
  // กรุ๊ปของไลน์ = parent_line_name (ไลน์เดี่ยวไม่มีแม่ = ตัวมันเอง)
  const groupOfLine = useCallback((lineName) => {
    const row = linesFull.find(l => l.name === lineName);
    return row?.parent_line_name || lineName;
  }, [linesFull]);

  // กรุ๊ปทั้งหมดใน scope (ใช้ทั้ง modal ตั้งค่า และการเฉลี่ยระดับ section/ทุกไลน์)
  const allGroups = useMemo(() => {
    const seen = new Set(); const out = [];
    linesFull.forEach(l => {
      const g = l.parent_line_name || l.name;
      if (seen.has(g)) return;
      seen.add(g);
      const gRow = linesFull.find(x => x.name === g) || l;
      out.push({ name: g, section: gRow.section || '' });
    });
    return out.sort((a, b) => (a.section || '').localeCompare(b.section || '') || a.name.localeCompare(b.name));
  }, [linesFull]);

  // เฉลี่ย target ของหลายกรุ๊ป (กรุ๊ปที่ไม่ตั้งค่า metric นั้นใช้ค่ามาตรฐานแทน)
  // เป้า OEE ไม่ตั้งเอง — คำนวณจาก A×P×Q ของแต่ละกรุ๊ปเสมอ แล้วค่อยเฉลี่ยข้ามกรุ๊ป
  // สูตรอยู่ที่ `avgOeeTarget` ใน src/utils/oee.js — **เด็ค .pptx รายเดือนใช้ตัวเดียวกัน**
  // (ย้ายออกจากหน้านี้ 2026-09-10 · util OEE มีไฟล์เดียว ห้ามเขียนสูตรซ้ำในหน้า)
  const targetOf = useCallback(
    (groupNames) => avgOeeTarget(groupNames.map(g => oeeTargets[g] || null)),
    [oeeTargets]
  );

  // แท็บวันนี้: เลือกกรุ๊ป → เป้ากรุ๊ป · เลือกไลน์ → เป้ากรุ๊ปของไลน์ · เลือก section →
  // เฉลี่ยกรุ๊ปใน section · ทุกไลน์ → เฉลี่ยทุกกรุ๊ปใน scope (เช่น PD3 = เฉลี่ย APRON ASSY + HYDROFORM)
  const tdTarget = useMemo(() => {
    if (tdLine) return targetOf([groupOfLine(tdLine)]);
    if (tdDept) return targetOf([tdDept]);
    if (tdUnit) return targetOf([...new Set((tdUnitLines || []).map(groupOfLine))]);
    const pool = tdSection ? allGroups.filter(g => g.section === tdSection) : allGroups;
    return targetOf(pool.map(g => g.name));
  }, [tdLine, tdDept, tdUnit, tdUnitLines, tdSection, allGroups, targetOf, groupOfLine]);

  const beginToday = useLatestRequest();   // เปลี่ยนวัน/กะ/ขอบเขตระหว่างโหลด = คำตอบเก่าห้ามทับจอ (กฎ DB ข้อ 4 · 05/10)
  const loadToday = useCallback(async () => {
    const live = beginToday();
    // scope แล้วแต่รายชื่อไลน์ยังไม่มา (หรือไม่มีไลน์ใน scope) — ห้าม query แบบไม่กรอง
    if (isScoped && !(tdScopeLines || []).length) { setTdSessions([]); setTdDowntimes([]); setTdDefects([]); return; }
    setTdLoading(true);
    try {
      let q = supabaseDR.from('production_sessions')
        .select('*, dr_products(name, mat_no)')
        .eq('work_date', tdDate)
        .in('status', ['open', 'pending_close', 'closed'])
        .order('created_at', { ascending: false })
        .limit(500);
      if (tdScopeLines?.length === 1) q = q.eq('line_name', tdScopeLines[0]);
      else if (tdScopeLines?.length > 1) q = q.in('line_name', tdScopeLines);
      if (tdShift) q = q.eq('shift', tdShift);
      /* 05/10 (QC audit): เดิม `{ data: sess }` ⇒ คิวรีกะล้ม = "วันนี้ไม่มีกะ" ทุกแผงเป็น 0 เงียบๆ */
      const { data: sess, error: sErr } = await q;
      if (!live()) return;
      if (sErr) {
        console.error('[OEEAnalytics] loadToday กะ:', sErr);
        setTdLoadWarn(`${trI18n("โหลดข้อมูลกะไม่สำเร็จ")}: ${sErr.message || sErr} — ${trI18n("ตัวเลขด้านล่างเป็นของรอบก่อนหน้า")}`);
        return;
      }

      const sessionIds = (sess || []).map(s => s.id);
      // วันเดียวมีกะไม่มาก แต่ใช้ helper เดียวกับแท็บแนวโน้มไว้ — กันพลาดซ้ำถ้าวันหน้าไลน์เยอะขึ้น
      // และได้เช็ค error ในตัว (เดิมรับแค่ data → ล้มเหลวแล้วโชว์ 0 เหมือนไม่มีข้อมูลจริง)
      const [dtRes, defRes, ordRes] = await Promise.all([
        fetchByIds(sessionIds, c => supabaseDR.from('downtime_logs')
          .select('*, dr_downtime_types(name_th, category, planned_cap_min, color)').in('session_id', c)),
        fetchByIds(sessionIds, c => supabaseDR.from('defect_logs')
          .select(`*, dr_defect_types(name_th, color, excl_from_q), prod_orders(mat_no, part_name), ${QBIN_EMBED}`).in('session_id', c)),
        fetchByIds(sessionIds, c => supabaseDR.from('prod_orders')
          .select('session_id, mat_no, status, qty, qty_target, qty_ok, qty_actual').in('session_id', c)),
      ]);
      if (!live()) return;
      const ord = ordRes.rows;

      setTdSessions(sess || []);
      setTdDowntimes(dtRes.rows);
      setTdDefects(defRes.rows);
      setTdLoadWarn([dtRes, defRes, ordRes].find(r => r.error)?.error || null);
      const obs = {};
      ord.forEach(o => { (obs[o.session_id] || (obs[o.session_id] = [])).push(o); });
      setTdOrdersBySession(obs);
      // pair_mat_no ของ mat ที่มีในกะวันนี้ (นับงานคู่ RH/LH เป็น 1 คู่/stroke — ดู pairTotals.js)
      const mats = [...new Set(ord.map(o => o.mat_no).filter(Boolean))];
      if (mats.length) {
        // + cycle_time_sec/name: ใช้คำนวณ OEE สดของกะที่ยังไม่ปิด (computeLiveOee) และแสดงชื่อพาร์ทในการ์ดกำลังผลิต
        // CT ผ่าน buildCtMap — fallback chain เดียวกับตอนปิดกะ (kanban_standards → dr_products)
        const [{ data: prod, error: pErr }, kstd] = await Promise.all([
          supabaseDR.from('dr_products').select('mat_no, pair_mat_no, cycle_time_sec, name').in('mat_no', mats),
          supabaseDR.from('kanban_standards').select('mat_no, dr_products(cycle_time_sec)').in('mat_no', mats).then(r => r, () => ({ data: [] })),
          loadOpInfo(), // map รายการขั้นตอน (OP) — ให้ opInfoSync พร้อมก่อนคำนวณ tdKpi
        ]);
        if (!live()) return;
        // ทะเบียนสินค้าโหลดไม่ได้ = ไม่รู้ CT/คู่ RH-LH ⇒ OEE สดเชื่อไม่ได้ ต้องบอก (เดิมเงียบ)
        if (pErr) setTdLoadWarn(w => w || `${trI18n("โหลดทะเบียนสินค้า (CT/คู่ RH-LH) ไม่สำเร็จ")}: ${pErr.message || pErr}`);
        const pm = {}, nm = {};
        (prod || []).forEach(p => {
          if (p.pair_mat_no) pm[p.mat_no] = p.pair_mat_no;
          if (p.name) nm[p.mat_no] = p.name;
        });
        setTdPairMat(pm);
        setTdCtMap(buildCtMap({ kanbanStds: kstd?.data || [], products: prod || [] }));
        if (Object.keys(nm).length) setTdProductsByMat(prev => ({ ...prev, ...nm }));
      } else { setTdPairMat({}); setTdCtMap({}); }
      setLastUpdate(new Date());

      // เก็บ mat_no → part name ไว้ map ให้ downtime_logs.mat_no (free text, ไม่ใช่ FK)
      const matMap = {};
      (sess || []).forEach(s => { if (s.dr_products?.mat_no) matMap[s.dr_products.mat_no] = s.dr_products.name; });
      setTdProductsByMat(prev => ({ ...prev, ...matMap }));
    } finally {
      if (live()) setTdLoading(false);
    }
  }, [tdDate, tdShift, tdScopeLines, isScoped, beginToday]);

  const loadTdHistory = useCallback(async () => {
    if (isScoped && !(tdScopeLines || []).length) { setTdHistory([]); return; }
    const startStr = dateStrAdd(tdDate, -9);
    let q = supabaseDR.from('production_sessions')
      .select('work_date, oee, oee_a, oee_p, oee_q, status, line_name, shift, shift_min, start_time, actual_qty, qty_ng')
      .eq('status', 'closed')
      .gte('work_date', startStr).lte('work_date', tdDate)
      /* cap-ok: production_sessions 10 วัน = 255 แถว (วัด 20/10) */
      .limit(3000);
    if (tdScopeLines?.length === 1) q = q.eq('line_name', tdScopeLines[0]);
    else if (tdScopeLines?.length > 1) q = q.in('line_name', tdScopeLines);
    if (tdShift) q = q.eq('shift', tdShift);
    const { data } = await q;
    setTdHistory(data || []);
  }, [tdDate, tdShift, tdScopeLines, isScoped]);

  // ทีมตามตาราง shift_schedules (A/B สลับกันตามวัน, C กะเช้าตลอด) — best effort, ถ้าไม่มีข้อมูลจะไม่ระบุ
  useEffect(() => {
    if (!tdDate || !linesFull.length) return;
    /* 🔴 ไม่กรอง `.in('line_id', ids)` แล้ว — ไลน์ลูกตกทอดกะจาก**ไลน์แม่** ซึ่งอาจไม่อยู่ในขอบเขตที่ดูอยู่
       และห้ามอ่าน `byLine[id]` ตรงๆ (ข้ามการตกทอด = ไลน์ลูกที่ยังไม่มีแถวของตัวเองจะ "ไม่ระบุทีม")
       ⚠️ อ่านไม่ได้ ≠ "ไม่มีตารางกะ" — เดิมแกะแค่ `{ data }` แล้วเงียบ */
    supabase.from('shift_schedules').select('line_id, dept_name, day_team').eq('work_date', tdDate)
      .then(({ data, error }) => {
        if (error) { console.warn('[OEEAnalytics] อ่านตารางกะไม่สำเร็จ — ทีมของกะจะไม่ระบุ', error); setShiftSchedMap({}); return; }
        setShiftSchedMap(buildScheduleMaps(data || [], linesFull));
      });
  }, [tdDate, linesFull]);

  const lineIdByName = useMemo(() => Object.fromEntries(linesFull.map(l => [l.name, l.id])), [linesFull]);
  const resolveTeam = useCallback((lineName, shift) => {
    const id = lineIdByName[lineName];
    const dayTeam = lineScheduleTeam(id, shiftSchedMap) || undefined;
    if (!dayTeam) return null;
    if (shift === 'day') return dayTeam;
    if (dayTeam === 'C') return null; // Team C ไม่มีกะดึก
    return dayTeam === 'A' ? 'B' : 'A';
  }, [lineIdByName, shiftSchedMap]);

  useEffect(() => { loadToday(); }, [loadToday]);
  useEffect(() => { loadTdHistory(); }, [loadTdHistory]);

  // Auto refresh ทุก 60 วิ เฉพาะตอนอยู่ tab วันนี้ + เปิด auto refresh
  useEffect(() => {
    if (viewTab !== 'today' || !autoRefresh) return;
    const stopPoll = visibleInterval(() => { loadToday(); loadTdHistory(); }, RATE.ANALYTIC);
    return () => stopPoll();
  }, [viewTab, autoRefresh, loadToday, loadTdHistory]);

  const tdSessionsTeamFiltered = useMemo(() => {
    if (!tdTeam) return tdSessions;
    return tdSessions.filter(s => resolveTeam(s.line_name, s.shift) === tdTeam);
  }, [tdSessions, tdTeam, resolveTeam]);

  const tdSessionIdSet = useMemo(() => new Set(tdSessionsTeamFiltered.map(s => s.id)), [tdSessionsTeamFiltered]);
  const tdDowntimesScoped = useMemo(() => tdTeam ? tdDowntimes.filter(d => tdSessionIdSet.has(d.session_id)) : tdDowntimes, [tdDowntimes, tdTeam, tdSessionIdSet]);

  const tdDefectsScoped   = useMemo(() => tdTeam ? tdDefects.filter(d => tdSessionIdSet.has(d.session_id)) : tdDefects,   [tdDefects, tdTeam, tdSessionIdSet]);

  /* 🔀 จำนวนเลนของแต่ละกะ — ไลน์เครื่องขนานบันทึก downtime รายเครื่อง ⇒ ทุกยอดรวมนาทีในหน้านี้
     ต้องแปลงเป็น "นาทีของไลน์" ด้วย `dtLineMin()` (oee.js §3.2 · คำสั่ง user 27/10)
     ไม่งั้นหน้าเดียวกันขัดกันเอง: หัวข้อ 1 (%A) หารเลนแล้ว แต่หัวข้อ 2 บวกนาทีดิบ
     (22/10 LASER-345: ดิบ 1,078 นาที บนเวลาผลิต 1,440 = อ่านว่าหยุด 75% ทั้งที่ %A = 80.68/94.73) */
  const tdLaneBy = useMemo(() => laneBySessionId(tdSessionsTeamFiltered, flowByLine || {}),
    [tdSessionsTeamFiltered, flowByLine]);
  const tdLaneOfRow = useCallback((d) => tdLaneBy[d?.session_id] || 1, [tdLaneBy]);
  /* มีไลน์ขนานอยู่ในชุดที่ดูอยู่ไหม — ใช้ตัดสินว่าจะเขียนหมายเหตุหน่วยบนจอ (ไม่มี = ไม่ต้องรก) */
  const tdHasParallel = useMemo(() => Object.values(tdLaneBy).some(n => Number(n) > 1), [tdLaneBy]);

  const tdRows = useMemo(() => calcOEE(tdSessionsTeamFiltered, tdDowntimesScoped, tdDefectsScoped, breakPols, flowByLine, affectsLn), [tdSessionsTeamFiltered, tdDowntimesScoped, tdDefectsScoped, breakPols, flowByLine, affectsLn]);

  /* 🟢 ค่าสดของกะที่ยังไม่ปิด (09/11 · user ทัก "OEE สดไม่ขึ้นในหน้านี้")
     เดิม OEE OVERVIEW + เทรนด์ 10 วัน อ่านแต่ค่าที่ stamp ตอนปิดกะ ⇒ ระหว่างกะเดิน ขึ้น "—" ทั้งแถบ
     ทั้งที่การ์ด "กะที่กำลังผลิต" ข้างล่างคิดสดได้แล้ว · ใช้ `computeLiveOee` ตัวเดียวกับการ์ดนั้น
     (ห้ามคิดสูตรเอง) — กะที่ stamp แล้วยังใช้ค่า stamp เสมอ · จอต้องเขียนว่ารวมค่าสดกี่กะ */
  const liveCalcOf = useCallback((sess) => {
    if (!sess || sess.status === 'closed') return null;
    const os = tdOrdersBySession[sess.id] || [];
    const defs = tdDefects.filter(d => d.session_id === sess.id);
    return computeLiveOee({
      session: sess, orders: os, downtimes: tdDowntimes.filter(d => d.session_id === sess.id),
      ctMap: tdCtMap, ngQty: sumDefectQty(defs, 'line'), workDate: tdDate,
      /* ฐานของ %Q = ยอดผลิต (oee.js §7.2.2) ⇒ ส่งแถวดิบ ไม่ใช่ `ngForP` ที่นับงานทดลองด้วย */
      ngForP: ngByMatFrom(defs, os), qRows: defs, pairMap: tdPairMat, affectsLanes: affectsLn,
      nowMs: lastUpdate?.getTime?.() || Date.now(),
      parallelN: parallelUnitsOf(flowByLine[sess.line_name]),
      parallelCap: flowModeOf(flowByLine[sess.line_name]?.flow_mode) === 'parallel_machine'
        ? parallelUnitsOf(flowByLine[sess.line_name]) : 1,
      breakPolicies: breakPols || [],
      processType: sess.dr_products?.process_type || null,
    });
  }, [tdOrdersBySession, tdDowntimes, tdDefects, tdCtMap, tdPairMat, tdDate, lastUpdate, flowByLine, breakPols, affectsLn]);
  /* แถวสด (รูปเดียวกับแถว calcOEE ให้ wavg/wLoad/wRun/wProd ใช้ได้ตรงๆ) — ฐานน้ำหนัก = เวลาที่เดินมาแล้ว ไม่ใช่ทั้งกะ */
  const tdLiveRows = useMemo(() => {
    const out = {};
    for (const r of tdRows) {
      if (r.calcOEE != null || r.status === 'closed') continue;
      const lv = liveCalcOf(r);
      if (!lv || lv.oee == null) continue;
      out[r.id] = { ...r, calcA: lv.A, calcP: lv.P, calcQ: lv.Q, calcOEE: lv.oee,
        shift_min: lv.elapsedMin, plannedMin: lv.plannedDtMin, totalQty: lv.produced, ngQty: lv.ngQty, _live: true };
    }
    return out;
  }, [tdRows, liveCalcOf]);
  const tdLiveCount = Object.keys(tdLiveRows).length;

  /* ── 📦 OEE รายพาร์ท (2026-11-20 · คำสั่ง user "oee by part/product ต้องการให้มีนะ") ────────
     🔴 **ไม่มีสูตรในหน้านี้** — `computeSessionOee()` คืน `byProduct` มาให้แล้ว (oee.js §OEE รายพาร์ท)
     🔴 รวมหลายกะด้วย **ตัวตั้งรวม ÷ ตัวหารรวม** ห้ามเฉลี่ย % ของแต่ละกะ (กฎ KPI รวม)
     🔴 กะที่ปิดแล้วก็คิดสดใหม่ที่นี่ ⇒ อาจไม่ตรงกับ %A ที่ประทับตอนปิดกะ (ทะเบียนเปลี่ยนทีหลังได้)
        จอต้องเขียนบอก ห้ามเงียบ
     🔴 `overlap` = ไลน์เดินหลายพาร์ทพร้อมกัน ⇒ นาทีหยุดเดียวถูกคิดให้หลายพาร์ท
        ⇒ **เทียบพาร์ทต่อพาร์ทได้ บวกเป็นภาพรวมไลน์ไม่ได้** */
  const tdKpi = useMemo(() => {
    // งานคู่ RH/LH (pair_mat_no) นับเป็น 1 คู่/stroke — เฉพาะกะที่มีคู่จริงถึงคำนวณจาก prod_orders ที่เหลือใช้ค่า stamped เดิม
    const hasPairIn = os => os.some(o => o.mat_no && tdPairMat[o.mat_no] && os.some(x => x.mat_no === tdPairMat[o.mat_no]));
    // orderTotal = pair-aware + op-aware (รายการขั้นตอน OP งานขับนัทไม่บวกซ้ำ — collapseOps ใน pairTotals)
    const pairSum = (os, pick) => orderTotal(os, pick, m => tdPairMat[m] || null, opInfoSync());
    // เป้ากะ: ใช้ target_qty ที่ตั้งไว้ → ไม่ได้ตั้ง (ค่า 0 = เกือบทุกกะในระบบจริง) ให้รวมเป้าใบงานแทน
    // (กฎเดียวกับ MorningMeeting: เป้ากะ = target_qty → รวม qty_target ?? qty ของใบงาน · ห้าม fallback ไป std_day_shift ซึ่งเป็นจำนวน "คน")
    // เดิม non-pair คืน r.target_qty ตรงๆ → การ์ด "จำนวนชิ้นงานที่ผลิตรวม" ขึ้น "ยังไม่ตั้งเป้ากะ" ทั้งที่ใบงานมีเป้าครบ (2026-08-05)
    const sessTarget = r => {
      const os = (tdOrdersBySession[r.id] || []).filter(o => !['cancelled','imported','carry_over'].includes(o.status));
      if (hasPairIn(os)) return pairSum(os, o => o.qty_target ?? o.qty ?? 0);
      if (r.target_qty) return r.target_qty;
      return orderTotal(os, o => o.qty_target ?? o.qty ?? 0, () => null, opInfoSync());
    };
    // ผลิตจริง: actual_qty เขียนตอน "ปิดกะ" เท่านั้น → กะที่ยังเปิดต้องรวมจากใบงานสด
    // (เดิม non-pair คืน r.totalQty ตรงๆ → การ์ด "ผลิตรวมวันนี้" เป็น 0 ทั้งที่ผลิตอยู่ · แก้ 2026-08-05
    //  pattern เดียวกับบั๊ก sessTarget) · pair-aware ทำถูกอยู่แล้วทั้งสองเส้นทาง
    /* ⚠️ ต้องคิดจากใบงานเสมอเมื่อมีใบ (pair-aware + op-aware ผ่าน orderTotal)
       เดิม non-pair คืน r.totalQty (= actual_qty ที่ stamp ตอนปิดกะ = ผลรวมดิบ ไม่ผ่าน collapseOps)
       → กะ SUB APRON ที่ชิ้นเดียวผ่าน 3 ขั้นขับนัท นับ 1,500 แทน 500 (QC audit 2026-08-20 · T1-10)
       ค่า stamp เป็น fallback เฉพาะตอนไม่มีใบงานเท่านั้น */
    const pickA = o => (o.status === 'confirmed' ? (o.qty_ok ?? o.qty ?? 0) : (o.qty_actual ?? 0));
    const sessActual = r => {
      const os = tdOrdersBySession[r.id] || [];
      if (os.length) return orderTotal(os, pickA, m => tdPairMat[m] || null, opInfoSync());
      return r.totalQty || 0;
    };
    // OOE/TEEP ของวันนี้ — ฐาน: OOE = เวลากะทั้งหมด · TEEP = ปฏิทิน 24 ชม. ของไลน์ที่เปิดกะวันนี้
    const tdOee = wavg(tdRows, r => r.calcOEE, wLoad);
    // A/P/Q/OEE รวม = กะปิดแล้ว (stamp) + กะที่กำลังเดิน (สด) · OOE/TEEP/OEE จริง ยังคิดจากกะปิดเท่านั้น (ต้องรู้เวลาทั้งกะ)
    const kRows = tdRows.map(r => tdLiveRows[r.id] || r);
    const tdValid = tdRows.filter(r => r.calcOEE != null && (Number(r.shift_min) || 0) > 0);
    let tdNet = 0, tdShift = 0, tdBreak = 0, tdPlanned = 0;
    const tdLineSet = new Set();
    tdValid.forEach(r => {
      const sm = Number(r.shift_min) || 0;
      const brk = policyBreakMin(r, breakPols);
      const pl = Number(r.plannedMin) || 0;
      tdShift += sm; tdBreak += brk; tdPlanned += pl; tdNet += Math.max(0, sm - brk - pl);
      tdLineSet.add(r.line_name);
    });
    const tdCal = tdLineSet.size * 1440;   // วันเดียว = 1,440 นาที/ไลน์
    const tdR1 = v => (v == null ? null : +v.toFixed(1));
    // OEE จริง — นับหยุด "ในแผน" เป็นการสูญเสีย (กันการติ๊กในแผนเพื่อดัน A) · ถ่วงด้วยฐาน (กะ − พัก)
    const strictRows = tdValid.map(r => {
      const st = strictOee({
        shiftMin: r.shift_min, breakMin: policyBreakMin(r, breakPols),
        plannedDtMin: r.plannedMin, a: r.calcA, p: r.calcP, q: r.calcQ,
      });
      // gap รายกะ — ต้องเทียบ "กะต่อกะ" แล้วค่อยถ่วงน้ำหนัก ห้ามเอาค่าเฉลี่ยรวม 2 ตัวมาลบกัน
      // (OEE ถ่วงด้วยเวลารับภาระ · OEE จริง ถ่วงด้วยฐาน กะ−พัก — คนละน้ำหนัก ผลต่างรวมอาจติดลบได้
      //  ทั้งที่รายกะ strict ≤ OEE เสมอ)
      return st && st.oee != null
        ? { oee: st.oee, w: st.baseMin, gap: r.calcOEE != null ? r.calcOEE - st.oee : null }
        : null;
    }).filter(Boolean);
    return {
      oee: wavg(kRows, r => r.calcOEE, wLoad), a: wavg(kRows, r => r.calcA, wLoad),
      p: wavg(kRows, r => r.calcP, wRun), q: wavg(kRows, r => r.calcQ, wProd),
      strictOee: wavg(strictRows, r => r.oee, r => r.w),
      strictGapPts: wavg(strictRows.filter(r => r.gap != null), r => r.gap, r => r.w),
      ooe:  tdOee != null && tdShift > 0 ? tdR1(tdOee * (tdNet / tdShift)) : null,
      teep: tdOee != null && tdCal   > 0 ? tdR1(tdOee * (tdNet / tdCal))   : null,
      netAvailMin: Math.round(tdNet), shiftMinSum: Math.round(tdShift),
      breakMinTotal: Math.round(tdBreak), plannedMinTotal: Math.round(tdPlanned), teepLines: tdLineSet.size,
      totalQty: tdRows.reduce((s, r) => s + sessActual(r), 0),
      targetQty: tdRows.reduce((s, r) => s + sessTarget(r), 0),
      totalDT: tdDowntimesScoped.reduce((s, d) => s + dtLineMin(d, tdLaneBy[d.session_id] || 1, { affectsBy: affectsLn }), 0),
      totalShiftMin: tdSessionsTeamFiltered.reduce((s, r) => s + (r.shift_min || 0), 0),
    };
  }, [tdRows, tdLiveRows, tdDowntimesScoped, tdSessionsTeamFiltered, tdOrdersBySession, tdPairMat, breakPols, tdLaneBy, affectsLn]);

  const tdHistoryGrouped = useMemo(() => {
    const map = {};
    for (const r of tdHistory) { (map[r.work_date] ||= []).push(r); }
    // แท่งของวันที่เลือก = กะปิดแล้ว + กะที่กำลังเดิน (ค่าสด) — ไม่งั้นแท่งวันนี้ว่างตลอดจนปิดกะ
    for (const lv of Object.values(tdLiveRows)) {
      (map[tdDate] ||= []).push({ oee: lv.calcOEE, oee_a: lv.calcA, oee_p: lv.calcP, oee_q: lv.calcQ,
        shift_min: lv.shift_min, plannedMin: lv.plannedMin, actual_qty: lv.totalQty, qty_ng: lv.ngQty });
    }
    const days = [];
    for (let i = 9; i >= 0; i--) {
      const key = dateStrAdd(tdDate, -i);
      const items = map[key] || [];
      days.push({
        key, label: bucketLabel(key, 'day'),
        oee: wavg(items, i => i.oee   != null ? +i.oee   : null, wLoad),
        a:   wavg(items, i => i.oee_a != null ? +i.oee_a : null, wLoad),
        p:   wavg(items, i => i.oee_p != null ? +i.oee_p : null, wRun),
        q:   wavg(items, i => i.oee_q != null ? +i.oee_q : null, wProd),
      });
    }
    return days;
  }, [tdHistory, tdDate, tdLiveRows]);

  /* วันนี้เทียบ "ค่าเฉลี่ย 9 วันก่อนหน้า" — ตอบคำถามที่คนอ่านกราฟ 10 วันแล้วต้องกวาดตาเอาเอง
     ⚠️ ต้องถ่วงน้ำหนักด้วย wavg เหมือนทุกที่ (กฎ CLAUDE.md: ห้าม mean-of-percentages / mean-of-means
        — เฉลี่ยค่ารายวันตรงๆ จะทำให้วันที่ผลิตน้อยถ่วงเท่าวันที่ผลิตเยอะ)
     ⚠️ ตัด "วันนี้" ออกจากตัวเฉลี่ยเสมอ ไม่งั้นเทียบกับตัวเอง */
  const tdVsAvg = useMemo(() => {
    const past = tdHistory.filter(r => r.work_date !== tdDate);
    const days = new Set(past.map(r => r.work_date)).size;
    const W = { oee: wLoad, a: wLoad, p: wRun, q: wProd };
    const F = { oee: i => (i.oee != null ? +i.oee : null), a: i => (i.oee_a != null ? +i.oee_a : null),
                p: i => (i.oee_p != null ? +i.oee_p : null), q: i => (i.oee_q != null ? +i.oee_q : null) };
    const out = { days };
    for (const k of ['oee', 'a', 'p', 'q']) {
      const avg = wavg(past, F[k], W[k]);
      const now = tdKpi[k];
      out[k] = { avg, now, diff: (avg != null && now != null) ? +(now - avg).toFixed(1) : null };
    }
    return out;
  }, [tdHistory, tdDate, tdKpi]);

  // Live/latest session card
  const tdLiveSession = useMemo(() => {
    const running = tdSessionsTeamFiltered.filter(s => s.status === 'open' || s.status === 'pending_close')
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    if (running.length) return running[0];
    const closed = [...tdSessionsTeamFiltered].sort((a, b) => (b.closed_at || b.created_at || '').localeCompare(a.closed_at || a.created_at || ''));
    return closed[0] || null;
  }, [tdSessionsTeamFiltered]);

  const tdLiveRowStamped = useMemo(() => tdLiveSession ? tdRows.find(r => r.id === tdLiveSession.id) : null, [tdLiveSession, tdRows]);
  // กะยังไม่ปิด = ยังไม่มีค่า oee_* ที่ stamp → คำนวณสดแบบเดียวกับผังรวมโรงงาน (util กลาง computeLiveOee)
  // ปิดกะแล้วใช้ค่าที่ stamp เสมอ (ห้ามคำนวณซ้ำด้วย master ปัจจุบัน — ดู CLAUDE.md)
  const tdLiveCalc = useMemo(() => {
    if (!tdLiveSession || tdLiveSession.status === 'closed') return null;
    if (tdLiveRowStamped?.calcOEE != null) return null;
    return liveCalcOf(tdLiveSession);
  }, [tdLiveSession, tdLiveRowStamped, liveCalcOf]);
  const isLiveCalc = Boolean(tdLiveCalc);
  const tdLiveRow = useMemo(() => tdLiveCalc
    ? { calcA: tdLiveCalc.A, calcP: tdLiveCalc.P, calcQ: tdLiveCalc.Q, calcOEE: tdLiveCalc.oee }
    : tdLiveRowStamped, [tdLiveCalc, tdLiveRowStamped]);
  /* ── 🗺️ ผังเครื่องจักรของ "ไลน์ที่เลือก" ในแถวการ์ดบนสุด (27/11 · คำสั่ง user) ─────────────
     user ชี้ที่ว่างด้านขวาของแถวแล้วสั่ง *"ใส่เป็น layout ของไลน์ที่เลือก"*
     🔴 ใช้ของกลาง `<LineLensMap>` ตัวเดียวกับ `/factory-map` **ห้ามวาดผังใหม่ในหน้า**
     · ไลน์ไหน: ช่องกรองไลน์ก่อน → ไม่ได้กรอง = ไลน์ของกะที่การ์ดซ้ายกำลังโชว์ (การ์ด 3 ใบในแถวเดียวกัน
       จะได้เล่าเรื่องเดียวกัน: กะนี้ · ได้เท่าไหร่ · เครื่องไหนหยุด)
     · เลนส์ `breakdown` = "เครื่องไหนหยุดวันนี้" — ตรงกับคำถามของแท็บนี้ (PM/AM มีบ้านของมันที่ /mtn-layout)
     · ชี้ไลน์ไม่ได้ (ยังไม่มีกะเลย) = **ไม่วาดการ์ด** ปล่อยแถวเหลือ 2 ใบ ไม่ใช่โชว์ผังว่าง */
  /* ไลน์ที่ "เดินจริงในวันนี้" ในขอบเขตที่เลือก = ตัวเลือกของช่องบนการ์ด
     🔴 ลิสต์ชื่อไลน์เรียงด้วย `sortLineNames` (ส่วนงาน→แม่→ลูก) **ห้าม `.sort()` ดิบ** (UI §5.3 ข้อ 9) */
  const tdMapLineOptions = useMemo(
    () => sortLineNames([...new Set(tdSessionsTeamFiltered.map(x => x.line_name).filter(Boolean))], linesFull),
    [tdSessionsTeamFiltered, linesFull]);
  /* 🔴 ลำดับการตัดสิน: **ตัวกรองไลน์ของหน้าชนะเสมอ** → ไม่ได้กรอง = ไลน์ที่คนเลือกบนการ์ด
     ⇒ กรอง "ทั้งโรงงาน" แล้วยังไม่ได้เลือก = **ไม่โชว์ผัง** (การ์ดบอกให้เลือกไลน์)
     เดิมถอยไปใช้ไลน์ของกะที่กำลังเดินให้เอง ⇒ จอบอก "ทั้งโรงงาน" แต่โชว์ผังไลน์เดียวโดยไม่บอกว่าทำไม
     (27/11 · user ทัก) — กฎจอซื่อสัตย์: เลือกแทนคนได้ แต่ต้องเขียนบนจอ ที่นี่ "ให้คนเลือก" ตรงกว่า */
  const tdMapLine = tdLine || (tdMapPick && tdMapLineOptions.includes(tdMapPick) ? tdMapPick : null);

  /* 🏭 ผังรวมโรงงานต้องระบายสีว่าไลน์ไหนเป็นยังไง — OEE ของวันนี้รายไลน์
     🔴 รวมหลายกะของไลน์เดียวด้วย `wavg(..., wLoad)` ของกลาง **ห้ามเฉลี่ยธรรมดา**
        (กะที่ผลิตน้อยจะถ่วงเท่ากะที่ผลิตเยอะ — กฎเดียวกับทุกจอที่รวม OEE)
     · กะที่ยังไม่ปิดใช้ค่าสด (`tdLiveRows`) เหมือนการ์ด/เทรนด์ด้านบน */
  const tdOeeByLine = useMemo(() => {
    const by = {};
    tdRows.forEach(r => { (by[r.line_name] ||= []).push({ ...r, _oee: tdLiveRows[r.id]?.calcOEE ?? r.calcOEE }); });
    const out = {};
    Object.entries(by).forEach(([n, rows]) => { out[n] = wavg(rows, i => i._oee, wLoad); });
    return out;
  }, [tdRows, tdLiveRows]);
  /* สัญญาของ `<FactoryMiniMap>`: คืน `null` = ไม่มีข้อมูล (เทาจาง) · มี `label` = "ผิดปกติ" (ป้ายเด่น)
     ⇒ ไลน์ที่ถึงเป้าไม่ต้องมีป้าย (จออ่านเร็ว เห็นเฉพาะตัวที่ต้องไปดู) */
  const tdMapStateOf = useCallback((name) => {
    const v = tdOeeByLine[name];
    if (v == null) return null;
    const tone = statusOf(v, tdTarget.oee);
    return { color: toneVar(tone), blink: false, label: tone === 'good' ? null : `OEE ${v}%` };
  }, [tdOeeByLine, tdTarget.oee]);
  const tdMapFamily = useMemo(
    () => (tdMapLine ? getLineFamilyNames(linesFull, tdMapLine) : []), [linesFull, tdMapLine]);
  const tdMapParent = useMemo(
    () => (tdMapLine ? (linesFull.find(l => l.name === tdMapLine)?.parent_line_name || null) : null),
    [linesFull, tdMapLine]);
  /* DT นอกแผนของไลน์นั้นในวันที่เลือก → รูปแบบที่ `LineLensMap` รับ `{ machine, mins, open }`
     (กติกา "ใบที่ยังหยุดอยู่ = นับจาก started_at ถึงตอนนี้" ชุดเดียวกับผังรวม · ไม่รู้เวลาเริ่ม = null ห้ามตีเป็น 0) */
  const tdMapDt = useMemo(() => {
    if (!tdMapFamily.length) return [];
    const fam = new Set(tdMapFamily);
    const sessOf = new Set(tdSessionsTeamFiltered.filter(x => fam.has(x.line_name)).map(x => x.id));
    const now = Date.now();
    return tdDowntimesScoped
      .filter(d => sessOf.has(d.session_id) && d.dr_downtime_types?.category !== 'planned')
      .map(d => {
        const open = !d.ended_at && d.duration_min == null;
        const mins = open
          ? (d.started_at ? Math.max(0, Math.round((now - new Date(d.started_at).getTime()) / 60000)) : null)
          : Math.round(Number(d.duration_min) || 0);
        return { id: d.id, machine: d.machine_no, mins, open };
      });
  }, [tdMapFamily, tdSessionsTeamFiltered, tdDowntimesScoped]);
  // ชิ้นงานที่กำลังผลิตในกะนั้น (session.product_id มักว่าง เพราะไลน์วิ่งหลายพาร์ทต่อกะ) — ดึงจากใบงานจริง
  const tdLiveParts = useMemo(() => {
    if (!tdLiveSession) return [];
    const os = tdOrdersBySession[tdLiveSession.id] || [];
    const seen = new Map();
    os.filter(o => !['cancelled', 'imported'].includes(o.status)).forEach(o => {
      if (!o.mat_no) return;
      if (!seen.has(o.mat_no)) seen.set(o.mat_no, tdProductsByMat[o.mat_no] || o.mat_no);
    });
    return [...seen.values()];
  }, [tdLiveSession, tdOrdersBySession, tdProductsByMat]);
  // target ของการ์ด live = เป้ากรุ๊ปของไลน์ที่กำลังผลิตจริง (เจาะจงกว่า filter รวม)
  const liveTarget = useMemo(
    () => tdLiveSession ? targetOf([groupOfLine(tdLiveSession.line_name)]) : null,
    [tdLiveSession, targetOf, groupOfLine]
  );

  // Downtime donut (โดยประเภท)
  // จัดอันดับสาเหตุ (pareto) — สีตาม "ประเภท" เท่านั้น: นอกแผน = ม่วง (เด่น) / ในแผน = เทา (จาง)
  // ห้ามกลับไปไล่สีตามลำดับแถว (hue-cycling อ่านไม่ออกว่าสีสื่ออะไร — เคยเป็นโดนัท 25 สี)
  const [tdDtShowAll, setTdDtShowAll] = useState(() => urlBool('dtall', false));   // ?dtall= (จอวนหน้า)
  // เจาะดูรายการดิบของแถวที่กด — { kind: 'cause'|'part', key, label }
  const [tdDtDrill, setTdDtDrill] = useState(null);
  /* พจนานุกรมเดาประเภทจากคำ — จากชื่อประเภทในชุดข้อมูลเอง (ไม่ยิงคิวรีเพิ่ม) */
  const tdDtIdx = useMemo(() => buildDtIndex(tdDowntimesScoped), [tdDowntimesScoped]);
  const tdDtByCause = useMemo(() => {
    const map = {};
    for (const d of tdDowntimesScoped) {
      /* 🗑️ "อื่นๆ / Alarm ไม่ระบุสาเหตุ" แตกตามเครื่อง (utils/downtimeCategory 23/09)
         — แท่งที่ยุบรวมไว้บอกไม่ได้ว่าไปแก้เครื่องไหน ทั้งที่ 92% ของใบกรอก machine_no ไว้แล้ว */
      const name = dtBucketName(d, tdDtIdx);
      const cat  = d.dr_downtime_types?.category || 'unplanned';
      // typeId ไว้ query ย้อนหลังของสาเหตุนี้ตอนกดเจาะ (ชื่อเป็น snapshot เทียบตรงๆ ไม่ได้)
      if (!map[name]) map[name] = { name, min: 0, rawMin: 0, category: cat, typeId: d.downtime_type_id || null };
      map[name].min += dtLineMin(d, tdLaneOfRow(d), { affectsBy: affectsLn });   // 🔀 นาทีของไลน์ (ขนานหารเลน)
      map[name].rawMin += d.duration_min || 0;          // นาที-เครื่องดิบ — ไว้เขียนกำกับ ไม่ใช่ตัวจัดอันดับ
    }
    const rows = Object.values(map).sort((a, b) => b.min - a.min);
    const total = rows.reduce((s, d) => s + d.min, 0);
    const max = rows.length ? rows[0].min : 0;
    return {
      total: +total.toFixed(1),
      plannedMin:   +rows.filter(d => d.category === 'planned').reduce((s, d) => s + d.min, 0).toFixed(1),
      unplannedMin: +rows.filter(d => d.category !== 'planned').reduce((s, d) => s + d.min, 0).toFixed(1),
      rawTotal: +rows.reduce((s, d) => s + d.rawMin, 0).toFixed(1),
      rows: rows.map(d => ({
        ...d, min: +d.min.toFixed(1), rawMin: +d.rawMin.toFixed(1),
        pct: total > 0 ? +(d.min / total * 100).toFixed(1) : 0,
        barPct: max > 0 ? (d.min / max * 100) : 0,
      })),
    };
  }, [tdDowntimesScoped, tdDtIdx, tdLaneOfRow, affectsLn]);

  // Top 10 downtime แยกตามพาร์ท (mat_no ที่บันทึกไว้ตอน log downtime)
  // นับเฉพาะ "นอกแผน" — ในแผน (นับสต๊อก/ไม่มีแผนผลิต) ไม่ผูก mat_no แล้วเคยครองอันดับ 1 เป็น
  // "ไม่ระบุ MAT.NO 81.9%" ซึ่งไม่ใช่ความเสียหายจริง กลบพาร์ทที่มีปัญหาจริง (2026-07-15)
  const tdDtByPart = useMemo(() => {
    const map = {};
    for (const d of tdDowntimesScoped) {
      if (d.dr_downtime_types?.category === 'planned') continue;
      const mat = d.mat_no || 'ไม่ระบุ MAT.NO';
      if (!map[mat]) map[mat] = { mat, part: tdProductsByMat[mat] || mat, min: 0 };
      map[mat].min += dtLineMin(d, tdLaneOfRow(d), { affectsBy: affectsLn });   // 🔀 นาทีของไลน์
    }
    const arr = Object.values(map).sort((a, b) => b.min - a.min).slice(0, 10);
    const max = arr.length ? arr[0].min : 0;
    const total = Object.values(map).reduce((s, d) => s + d.min, 0);
    return arr.map(d => ({ ...d, min: +d.min.toFixed(1), pct: total > 0 ? +(d.min / total * 100).toFixed(1) : 0, barPct: max > 0 ? (d.min / max * 100) : 0 }));
  }, [tdDowntimesScoped, tdProductsByMat, tdLaneOfRow, affectsLn]);

  /* "สาเหตุนี้เกิดซ้ำแค่ไหน" — ย้อนหลัง 30 วันของ downtime type ที่กดเจาะ
     ⚠️ ยิงตอนเปิดโมดัลเท่านั้น (user กดเอง ไม่ใช่ polling) และกรองฝั่ง server ให้แคบที่สุด
        — embed production_sessions!inner เพื่อกรองวัน/ไลน์ในคิวรีเดียว ไม่ดึง session ทั้งช่วงมากรองเอง
     ⚠️ ไม่มี typeId (ข้อมูลเก่าไม่ผูก type) = ไม่ query ห้ามเดา */
  const [tdDrillHist, setTdDrillHist] = useState(null);
  useEffect(() => {
    if (!tdDtDrill || tdDtDrill.kind !== 'cause' || !tdDtDrill.typeId) { setTdDrillHist(null); return; }
    let dead = false;
    setTdDrillHist({ loading: true });
    (async () => {
      const from = dateStrAdd(tdDate, -29);
      let q = supabaseDR.from('downtime_logs')
        .select('duration_min, production_sessions!inner(work_date, line_name)')
        .eq('downtime_type_id', tdDtDrill.typeId)
        .gte('production_sessions.work_date', from)
        .lte('production_sessions.work_date', tdDate)
        /* cap-ok: downtime_logs 30 วัน ต่อ 1 downtime_type สูงสุด 541 แถว (วัด 20/10 — ทุก type รวมกัน 3,275 แต่คิวรีนี้กรอง type เดียว) */
        .limit(3000);
      if (tdScopeLines?.length === 1) q = q.eq('production_sessions.line_name', tdScopeLines[0]);
      else if (tdScopeLines?.length > 1) q = q.in('production_sessions.line_name', tdScopeLines);
      const { data, error } = await q;
      if (dead) return;
      if (error) { setTdDrillHist({ error: error.message }); return; }   // ห้ามเงียบ
      const byDay = {};
      for (const r of data || []) {
        const d = r.production_sessions?.work_date;
        if (!d) continue;
        byDay[d] = (byDay[d] || 0) + (r.duration_min || 0);
      }
      const days = [];
      for (let i = 29; i >= 0; i--) {
        const key = dateStrAdd(tdDate, -i);
        days.push({ key, min: +(byDay[key] || 0).toFixed(1) });
      }
      const hitDays = days.filter(d => d.min > 0).length;
      setTdDrillHist({
        days, hitDays, count: (data || []).length,
        total: +days.reduce((a, d) => a + d.min, 0).toFixed(1),
        max: Math.max(...days.map(d => d.min), 1),
      });
    })();
    return () => { dead = true; };
  }, [tdDtDrill, tdDate, tdScopeLines]);

  /* รายการดิบของแถวที่กดในแผง 2.2 / 2.3 — ตอบ "ปัญหานี้เกิดที่ไหน เครื่องไหน กี่โมง ใครลง"
     ⚠️ ต้องกรองจาก tdDowntimesScoped (ชุดเดียวกับที่รวมยอดในแผง) ไม่งั้นตัวเลขในโมดัลไม่ตรงกับแถว
     ⚠️ แผง 2.3 นับเฉพาะ "นอกแผน" → ตอนเจาะต้องกรอง planned ออกให้ตรงกันด้วย */
  const tdDrillRows = useMemo(() => {
    if (!tdDtDrill) return [];
    const sMap = {};
    for (const s of tdSessions) sMap[s.id] = s;
    return tdDowntimesScoped
      .filter(d => (tdDtDrill.kind === 'cause'
        ? dtBucketName(d, tdDtIdx) === tdDtDrill.key   // ต้องเป็นสูตรเดียวกับตอนสร้างคีย์ใน tdDtByCause
        : d.dr_downtime_types?.category !== 'planned' && (d.mat_no || 'ไม่ระบุ MAT.NO') === tdDtDrill.key))
      .map(d => ({ ...d, _s: sMap[d.session_id] || null }))
      .sort((a, b) => (b.duration_min || 0) - (a.duration_min || 0));
  }, [tdDtDrill, tdDowntimesScoped, tdSessions, tdDtIdx]);

  /* ══════════════════════════════════════════════════════════════════════
     TAB: TREND — historical range analytics (เดิม)
     ══════════════════════════════════════════════════════════════════════ */
  const [sessions,   setSessions]   = useState([]);
  const [downtimes,  setDowntimes]  = useState([]);
  // activity rate ต่อ cost center (Main) — ใช้แปลงนาทีดาวไทม์เป็นบาท (best-effort · ว่าง = แผงบอกว่าขาด rate)
  const [ccRates, setCcRates] = useState([]);
  useEffect(() => {
    supabase.from('cost_center_rates').select('*').then(({ data, error }) => { if (!error) setCcRates(data || []); });
  }, []);
  const [dtIncludePlanned, setDtIncludePlanned] = useState(() => urlBool('planned', false));   // ?planned= (จอวนหน้า) // Pareto DT: default นับเฉพาะนอกแผน
  // สั่ง Pareto ให้เจาะประเภทที่กดจากการ์ด 💰 (nonce = กดชื่อเดิมซ้ำต้องเปิดใหม่ได้)
  const [dtFocus, setDtFocus]   = useState(null);
  const [defFocus, setDefFocus] = useState(null);
  const [trOrders, setTrOrders]   = useState([]);   // ใบงานของช่วงที่เลือก (ทำ pair-aware total)
  const [trPairMat, setTrPairMat] = useState({});
  const [defects,    setDefects]    = useState([]);
  const [partCost,   setPartCost]   = useState({});   // mat_no -> {material_cost, standard_cost} (แผงมูลค่าของเสีย)
  const [dtTypes,    setDtTypes]    = useState([]);
  const [defectTypes,setDefectTypes]= useState([]);
  const [lines,      setLines]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [trLoadWarn, setTrLoadWarn] = useState(null);  // โหลดแถวลูกไม่ครบ = ตัวเลขต่ำกว่าจริง ต้องบอก

  /* Filters — สเกล + กรอบเวลา ใช้ของกลาง `useTimeRange` (ผูก `?scale=&from=&to=` ใน URL)
     ⚠️ `defaultDays: 90` คงพฤติกรรมเดิมของหน้านี้ไว้ (เดิม `dateStrAdd(today,-90)`)
        ห้ามเปลี่ยนเป็น 30 ตามค่ากลาง — หน้านี้ดูแนวโน้มยาว ผู้ใช้คุ้นกับ 90 วันแล้ว */
  /* 🪜 บันไดความละเอียด (23/09): 90 วัน → แท่งรายสัปดาห์ 13 แท่ง (เดิมรายเดือน = 4 แท่ง อ่านเทรนด์ไม่ออก)
     🔴 `finest: 'day'` — `production_sessions` เก็บแค่ `work_date` + กะ **ไม่มียอดผลิตรายชั่วโมง**
        ⇒ %P รายชั่วโมงจะเป็นตัวเลขที่เดาเอา · จอนี้จึงไม่มีปุ่ม "วันนี้" โดยตั้งใจ */
  const tr = useTimeRange({ defaultScale: 'week', defaultDays: 90, finest: 'day' });
  const { scale: period, from: dateFrom, to: dateTo } = tr;
  const [selShift,   setSelShift]   = useState(() => (['day', 'night'].includes(new URLSearchParams(window.location.search).get('shift')) ? new URLSearchParams(window.location.search).get('shift') : ''));
  // ชื่อไลน์ใน sessions ที่ไม่ตรงทะเบียน (ไลน์ถูก rename/ลบ) — แยก optgroup ใน dropdown ห้ามซ่อน (2026-09-07)
  const trOrphanLines = useMemo(() => {
    const reg = new Set(linesFull.map(l => String(l.name).trim().toLowerCase()));
    return lines.filter(n => !reg.has(String(n).trim().toLowerCase()));
  }, [lines, linesFull]);

  /* ── 📦 แท็บ "รายพาร์ท" (รายช่วง) — โหลดข้อมูลของตัวเอง ────────────────────────────────
     ไม่ยืมของแท็บแนวโน้ม: แท็บนั้นเอา **เฉพาะกะปิดแล้ว** (ค่าที่ประทับ) แต่แท็บนี้คิดสดทีละกะ
     และต้องเห็นกะที่ยังไม่ปิดของวันนี้ด้วย · ยิงเฉพาะตอนเปิดแท็บนี้ (egress = ไบต์ · กฎ DB ข้อ 11) */
  const [pbSessions, setPbSessions] = useState([]);
  const [pbOrdersBy, setPbOrdersBy] = useState({});   // session_id -> prod_orders[]
  const [pbDowntimes, setPbDowntimes] = useState([]);
  const [pbDefects, setPbDefects] = useState([]);
  const [pbProds, setPbProds] = useState([]);         // แถว dr_products ดิบ (CT/คู่ RH-LH/p_no)
  const [pbKstds, setPbKstds] = useState([]);
  const [pbLoading, setPbLoading] = useState(false);
  const [pbWarn, setPbWarn] = useState(null);
  const [pbLoaded, setPbLoaded] = useState(false);

  /* ไลน์ที่แท็บแนวโน้ม/รายพาร์ทใช้กรองคิวรี — เลือกไลน์แม่ = รวมไลน์ลูกด้วย
     ไม่เลือก: role ที่ถูก scope → จำกัดที่ไลน์ใน scope เสมอ (linesFull ถูก scope แล้ว) · ไม่ scope → null = ทุกไลน์
     🔴 ต้องเป็น memo (array ตัวเดิมตราบใดที่ค่าไม่เปลี่ยน) — ใส่ใน deps ของ loader ได้ตามกฎ DB ข้อ 9 */
  const trScopeLines = useMemo(() => (selLine
    ? (parentChildrenMap[selLine] ? [selLine, ...parentChildrenMap[selLine]] : [selLine])
    : (isScoped ? linesFull.map(l => l.name) : null)
  ), [selLine, parentChildrenMap, isScoped, linesFull]);

  // Target ของแท็บแนวโน้ม: เลือกกรุ๊ป/ไลน์ → เป้ากรุ๊ปนั้น · ทุกไลน์ → เฉลี่ยทุกกรุ๊ปใน scope
  const trTarget = useMemo(() => {
    if (selLine) return targetOf([groupOfLine(selLine)]);
    return targetOf(allGroups.map(g => g.name));
  }, [selLine, allGroups, targetOf, groupOfLine]);

  // ── Load data ──────────────────────────────────────────────────
  const beginData = useLatestRequest();   // เปลี่ยนช่วง/ไลน์ระหว่างไล่หน้า = คำตอบเก่าห้ามทับจอ (กฎ DB ข้อ 4 · 05/10)
  const loadData = useCallback(async () => {
    const live = beginData();
    setLoading(true);
    try {
      const expandedLines = trScopeLines;   // กฎการขยายไลน์แม่→ลูก อยู่ที่ `trScopeLines` ที่เดียว
      if (isScoped && !expandedLines?.length) {
        setSessions([]); setDowntimes([]); setDefects([]); setLoading(false); return;
      }

      // ⚠️ `.limit(5000)` ใช้ไม่ได้ — PostgREST clamp ที่ 1000 แถวเงียบๆ
      //    วัดจริง 2026-09-02: ช่วง 90 วันมี 1,058 กะปิดแล้ว → **หายไป 58 กะทุกครั้งที่เปิดแท็บแนวโน้ม**
      //    (กะที่หายคือกะท้ายช่วงตาม order work_date → เดือนล่าสุดขาดมากสุด ซึ่งเป็นเดือนที่คนดู)
      //    ต้องแบ่งหน้าเสมอ + order คงที่คู่ range (work_date อย่างเดียวไม่ unique → ต้องมี id ปิดท้าย)
      const sessRes = await fetchAllPages(() => {
        let q = supabaseDR.from('production_sessions')
          .select('*')
          .eq('status', 'closed')
          .gte('work_date', dateFrom)
          .lte('work_date', dateTo);
        if (expandedLines?.length === 1) q = q.eq('line_name', expandedLines[0]);
        else if (expandedLines?.length > 1) q = q.in('line_name', expandedLines);
        if (selShift) q = q.eq('shift', selShift);
        return q;
      }, { orderBy: ['work_date', 'id'] });
      const sess = sessRes.rows;

      const sessionIds = sess.map(s => s.id);

      // ⚠️ ห้าม .in('session_id', sessionIds) ตรงๆ — ช่วง 90 วัน = 800+ กะ → URL ~31,700 ตัวอักษร
      //    โดนตัด → คิวรีล้มเหลว → DT/ของเสีย/Pareto/มูลค่าเป็น 0 เงียบๆ ขณะที่ A/P/Q (ค่า stamp)
      //    ยังโชว์ค่าจริง = จอขัดแย้งกันเอง (บั๊กจริงที่ user จับได้ 2026-08-20)
      const [dtRes, defRes, { data: dtt }, { data: deft }, lineRes] = await Promise.all([
        fetchByIds(sessionIds, c => supabaseDR.from('downtime_logs')
          .select('*, dr_downtime_types(name_th, category, planned_cap_min, color)').in('session_id', c)),
        fetchByIds(sessionIds, c => supabaseDR.from('defect_logs')
          .select(`*, dr_defect_types(name_th, color, excl_from_q), prod_orders(mat_no, part_name), ${QBIN_EMBED}`).in('session_id', c)),
        supabaseDR.from('dr_downtime_types').select('*').eq('is_active', true).order('sort_order'),
        supabaseDR.from('dr_defect_types').select('*').eq('is_active', true).order('sort_order'),
        // ⚠️ ตัวนี้อ่าน "กะปิดแล้วทั้งตาราง" เพื่อทำ dropdown ไลน์ → ไม่แบ่งหน้า = ได้แค่ 1000 แถวแรก
        //    วัดจริง 2026-09-02: 1,058 แถว → distinct line_name ได้ 27 จาก 28 = **ไลน์หนึ่งหายจาก dropdown**
        //    (เลือกไลน์นั้นดูแนวโน้มไม่ได้เลย และไม่มีอะไรบอกว่าหายไป)
        fetchAllPages(() => supabaseDR.from('production_sessions').select('line_name').eq('status', 'closed')),
      ]);
      if (!live()) return;
      const linesData = lineRes.rows;

      setSessions(sess || []);
      setDowntimes(dtRes.rows);
      setDefects(defRes.rows);
      // ต้นทุน/ชิ้น สำหรับแผง "มูลค่าของเสีย" — best-effort (ยังไม่กรอกต้นทุน = แผงบอกว่าขาดอะไร ไม่เดา)
      supabaseDR.from('parts_master').select('mat_no, material_cost, standard_cost').eq('is_active', true)
        .then(({ data: pm }) => setPartCost(Object.fromEntries((pm || []).map(r => [r.mat_no, r]))))
        .catch(() => setPartCost({}));
      setDtTypes(dtt || []);
      setDefectTypes(deft || []);

      // ใบงาน + pair map ของช่วงที่เลือก — ใช้ทำ "ผลิตรวม" แบบนับงานคู่ RH/LH เป็น 1 คู่ (กฎ pairAwareTotal)
      // เดิมแท็บนี้บวก actual_qty ตรงๆ (ไม่ pair-aware) ขณะที่แท็บ "ภาพรวมวันนี้" นับคู่แล้ว
      // → ยอดผลิตของช่วงเดียวกันไม่ตรงกันระหว่าง 2 แท็บในหน้าเดียว (แก้ 2026-08-05)
      // ⚠️ Supabase คืนสูงสุด 1000 แถว/ครั้ง → ต้องแบ่งหน้า ไม่งั้นช่วงยาวยอดขาดเงียบๆ
      // ⚠️ เดิมแบ่งหน้าอย่างเดียวแต่ยัด id ทั้ง 800+ ตัวใน .in() → URL ยาวเกิน คืน 0 แถว
      //    แล้ว trTotalQty ถอยไปใช้ actual_qty เงียบๆ (ยอดที่เห็นเลยตรงกับ sum(actual_qty) เป๊ะ)
      const ordRes = await fetchByIds(sessionIds, c => supabaseDR.from('prod_orders')
        .select('session_id, mat_no, status, qty, qty_ok, qty_actual').in('session_id', c));
      if (!live()) return;
      setTrOrders(ordRes.rows);
      // โหลดไม่ครบ = ตัวเลขรวมต่ำกว่าจริง ต้องบอกบนจอ ห้ามเงียบ
      setTrLoadWarn(
        [sessRes, dtRes, defRes, ordRes, lineRes].some(r => r.error || r.truncated)
          ? (sessRes.error || dtRes.error || defRes.error || ordRes.error || lineRes.error
             || 'ข้อมูลบางส่วนถูกตัด (ช่วงยาวเกิน)')
          : null,
      );
      const trMats = [...new Set(ordRes.rows.map(o => o.mat_no).filter(Boolean))];
      await loadOpInfo(); // map รายการขั้นตอน (OP) — ให้ trTotalQty ยุบขั้นซ้ำก่อนรวมยอด
      if (trMats.length) {
        const pm = {};
        for (let i = 0; i < trMats.length; i += 300) {
          const { data: pr } = await supabaseDR.from('dr_products').select('mat_no, pair_mat_no').in('mat_no', trMats.slice(i, i + 300));
          (pr || []).forEach(p2 => { if (p2.pair_mat_no) pm[p2.mat_no] = p2.pair_mat_no; });
        }
        if (!live()) return;
        setTrPairMat(pm);
      } else setTrPairMat({});

      // dropdown ไลน์ของแท็บ trend มาจากชื่อไลน์ใน sessions — ต้องกรองตาม scope ด้วย
      const normLn = (s) => (s || '').trim().toLowerCase();
      const allowedSet = isScoped ? new Set(linesFull.map(l => normLn(l.name))) : null;
      const uniqueLines = [...new Set((linesData || []).map(r => r.line_name).filter(Boolean))]
        .filter(n => !allowedSet || allowedSet.has(normLn(n)))
        .sort();
      setLines(uniqueLines);
    } finally {
      if (live()) setLoading(false);
    }
  }, [dateFrom, dateTo, selShift, trScopeLines, isScoped, linesFull, beginData]);

  useEffect(() => { loadData(); }, [loadData]);

  /* ช่วงที่คิดจริงของแท็บรายพาร์ท — ยาวเกินเพดาน = เอา N วันล่าสุดของช่วง (แล้วเขียนบนจอ) */
  const partWin = useMemo(() => {
    const asked = spanDays(dateFrom, dateTo);
    if (asked == null) return { from: dateFrom, to: dateTo, days: null, asked: null, clamped: false };
    if (asked <= PART_MAX_DAYS) return { from: dateFrom, to: dateTo, days: asked, asked, clamped: false };
    const from = addDaysStr(dateTo, -(PART_MAX_DAYS - 1));
    // แกะวันไม่ออก = ไม่ตัด (ห้ามเดาวัน · กฎ Date/Time)
    return from ? { from, to: dateTo, days: PART_MAX_DAYS, asked, clamped: true }
      : { from: dateFrom, to: dateTo, days: asked, asked, clamped: false };
  }, [dateFrom, dateTo]);

  /* deps ของ loader ต้องเป็น primitive (กฎ DB ข้อ 9 — object/array ใน deps = ยิงคิวรีซ้ำไม่หยุด) */
  const pbFrom = partWin.from, pbTo = partWin.to;
  const beginPart = useLatestRequest();   // เปลี่ยนช่วง/ไลน์ระหว่างโหลด = คำตอบเก่าห้ามทับจอ (กฎ DB ข้อ 4)
  const loadPartOee = useCallback(async () => {
    const live = beginPart();
    if (isScoped && !(trScopeLines || []).length) {
      setPbSessions([]); setPbOrdersBy({}); setPbDowntimes([]); setPbDefects([]); setPbLoaded(true); return;
    }
    setPbLoading(true); setPbWarn(null);
    try {
      /* `select('*')` ตั้งใจ — `computeSessionOee` อ่านหลายคอลัมน์รวม `ct_snapshot`/`break_snapshot`
         ตัดคอลัมน์พลาด = คิด %A/%P ผิดเงียบ · จำนวนแถวถูกคุมด้วยเพดาน PART_MAX_DAYS แล้ว
         ⚠️ ต้องแบ่งหน้า (PostgREST clamp 1000 แถวเงียบๆ) + order คงที่คู่ range */
      const sessRes = await fetchAllPages(() => {
        let q = supabaseDR.from('production_sessions')
          .select('*')
          .in('status', ['open', 'pending_close', 'closed'])
          .gte('work_date', pbFrom).lte('work_date', pbTo);
        if (trScopeLines?.length === 1) q = q.eq('line_name', trScopeLines[0]);
        else if (trScopeLines?.length > 1) q = q.in('line_name', trScopeLines);
        if (selShift) q = q.eq('shift', selShift);
        return q;
      }, { orderBy: ['work_date', 'id'] });
      if (!live()) return;
      const sess = sessRes.rows;
      const ids = sess.map(x => x.id);
      // ⚠️ ห้าม `.in('session_id', ids)` ตรงๆ — ช่วงยาว = URL เกินเพดาน proxy แล้วคืนว่างเงียบ (กฎ DB ข้อ 5)
      const [dtRes, defRes, ordRes] = await Promise.all([
        fetchByIds(ids, c => supabaseDR.from('downtime_logs')
          .select('*, dr_downtime_types(name_th, category, planned_cap_min, color)').in('session_id', c)),
        fetchByIds(ids, c => supabaseDR.from('defect_logs')
          .select(`*, dr_defect_types(name_th, color, excl_from_q), prod_orders(mat_no, part_name), ${QBIN_EMBED}`).in('session_id', c)),
        fetchByIds(ids, c => supabaseDR.from('prod_orders')
          .select('session_id, mat_no, status, qty, qty_target, qty_ok, qty_actual').in('session_id', c)),
      ]);
      if (!live()) return;
      const obs = {};
      ordRes.rows.forEach(o => { (obs[o.session_id] || (obs[o.session_id] = [])).push(o); });
      setPbSessions(sess); setPbOrdersBy(obs);
      setPbDowntimes(dtRes.rows); setPbDefects(defRes.rows);

      const mats = [...new Set(ordRes.rows.map(o => o.mat_no).filter(Boolean))];
      let prods = [], kstds = [], regErr = null;
      for (let i = 0; i < mats.length; i += 300) {
        const chunk = mats.slice(i, i + 300);
        // + p_no: แกนจับกลุ่ม "พาร์ทจริง" (CLAUDE.md §พาร์ทจริง — ห้ามจับด้วยชื่อ)
        const [pr, ks] = await Promise.all([
          supabaseDR.from('dr_products').select('mat_no, pair_mat_no, cycle_time_sec, name, p_no').in('mat_no', chunk),
          supabaseDR.from('kanban_standards').select('mat_no, dr_products(cycle_time_sec)').in('mat_no', chunk)
            .then(r => r, () => ({ data: [], error: null })),
        ]);
        if (!live()) return;
        if (pr.error) regErr = pr.error;
        prods = prods.concat(pr.data || []);
        kstds = kstds.concat(ks?.data || []);
      }
      setPbProds(prods); setPbKstds(kstds);
      /* อ่านทะเบียน/แถวลูกไม่ครบ = พาร์ทหาย/CT ผิด ⇒ ต้องบอกบนจอ ห้ามโชว์เลขเฉยๆ */
      const bad = [sessRes, dtRes, defRes, ordRes].find(r => r.error || r.truncated);
      /* เก็บเป็น "ข้อความ" เสมอ — ยัด object error ลง state แล้ว React render ไม่ได้ (จอขาว) */
      setPbWarn(regErr ? `${trI18n('โหลดทะเบียนสินค้า (CT/คู่ RH-LH) ไม่สำเร็จ')}: ${regErr.message || regErr}`
        : bad ? String(bad.error?.message || bad.error || trI18n('ข้อมูลบางส่วนถูกตัด (ช่วงยาวเกิน)')) : null);
      setPbLoaded(true);
    } finally {
      if (live()) setPbLoading(false);
    }
  }, [pbFrom, pbTo, selShift, trScopeLines, isScoped, beginPart]);

  /* โหลดเฉพาะตอนอยู่แท็บนี้ — แท็บอื่นไม่ต้องจ่าย egress ของใบหยุด/ของเสียชุดที่ 2 */
  useEffect(() => { if (viewTab === 'part') loadPartOee(); }, [viewTab, loadPartOee]);

  /* 📦 OEE รายพาร์ทของช่วง — ตัวรวมอยู่ที่ `aggregateByProduct()` · สูตรอยู่ `oee.js` (ห้ามคิดในหน้า) */
  const pbByProduct = useMemo(() => aggregateByProduct({
    sessions: pbSessions, ordersBySession: pbOrdersBy,
    downtimes: pbDowntimes, defects: pbDefects,
    prods: pbProds, kstds: pbKstds, breakPols, flowByLine, affectsLn,
  }), [pbSessions, pbOrdersBy, pbDowntimes, pbDefects, pbProds, pbKstds, breakPols, flowByLine, affectsLn]);

  /* ── 📊 หัวแดชบอร์ดของแท็บรายพาร์ท — "พาร์ทไหนที่กำลังดูอยู่" ───────────────────────────
     🔴 **ห้ามรวมทุกพาร์ทเป็นหัวเดียว** — `byProduct` มีกฎ `overlap` (ไลน์เดินหลายพาร์ทพร้อมกัน
        นาทีหยุด 1 นาทีถูกคิดให้ทุกพาร์ทที่คาบเวลากัน) ⇒ **บวกเป็นภาพรวมไลน์ไม่ได้** (oee.js §byProduct)
        ⇒ หัวแดชบอร์ดโชว์ **ทีละพาร์ท** เสมอ · ไม่เลือก = หยิบพาร์ทที่ "เดินเครื่องนานสุด" ให้
        (= ตัวที่มีน้ำหนักกับไลน์มากสุด) แล้ว**เขียนบนจอว่ากำลังดูตัวไหน** ห้ามเงียบ */
  const partOptions = useMemo(
    () => [...pbByProduct.rows].sort((a, b) => (b.runMin - a.runMin) || (b.pcs - a.pcs)),
    [pbByProduct.rows]);
  const partPick = useMemo(
    () => partOptions.find(r => r.key === selPart) || partOptions[0] || null,
    [partOptions, selPart]);
  /* เลือกพาร์ทค้างไว้แล้วเปลี่ยนไลน์/ช่วงจนพาร์ทนั้นหลุดขอบเขต = ต้องบอก ไม่ใช่สลับเงียบ */
  const partPickFallback = !!selPart && partPick?.key !== selPart;
  /* เทรนด์รายวันของพาร์ทที่เลือก — รูปแบบเดียวกับ `tdHistoryGrouped` ที่ `<OeeHeadline>` รับ
     (ค่าเป็น % 0..100 หรือ null · วันที่ไม่มีกะจะไม่มีแท่ง = ตอเทา) */
  const partTrend = useMemo(() => (partPick?.days || []).map(d => ({
    label: bucketLabel(d.date, 'day'),   // ป้ายแกนวันชุดเดียวกับเทรนด์ของแท็บวันนี้ (utils/timeRange)
    a: d.A == null ? null : +(d.A * 100).toFixed(1),
    p: d.P == null ? null : +(d.P * 100).toFixed(1),
    q: d.Q == null ? null : +(d.Q * 100).toFixed(1),
  })), [partPick]);

  /* กะที่ยังไม่ปิดอยู่ในช่วง = ค่าสด (ยังขยับได้) — ต้องเขียนบนจอ ไม่ใช่ปนเงียบ */
  const pbLiveCount = useMemo(
    () => pbSessions.filter(x => x.status === 'open' || x.status === 'pending_close').length,
    [pbSessions]);

  // ── Computed rows ──────────────────────────────────────────────
  const rows = useMemo(() => calcOEE(sessions, downtimes, defects, breakPols, flowByLine, affectsLn), [sessions, downtimes, defects, breakPols, flowByLine, affectsLn]);

  /* ยอดผลิตจากใบงาน (pair-aware + op-aware) ของกลุ่ม session ใดๆ — ใช้ทั้ง KPI หัวแท็บ และตารางรายช่วง
     (QC audit 2026-08-20 · T3-12: เดิมตารางรายช่วงบวก actual_qty ดิบ → บวกกันแล้วไม่เท่า KPI หัวแท็บ
     ในหน้าเดียวกัน — งานคู่โชว์ 2,000 ในตาราง แต่ KPI โชว์ 1,000) · ไม่มีใบงาน = fallback ค่า stamp */
  const ordersProducedOf = useCallback((sessIds) => {
    const os = trOrders.filter(o => sessIds.has(o.session_id));
    if (!os.length) return null;   // ให้ผู้เรียกถอยไปใช้ค่า stamp เอง
    const perMat = {}; let nullSum = 0;
    os.forEach(o => {
      // ยกยอด = ผลิตจริงส่วนที่ทำได้ (กฎ 2026-07-23) · `imported` = ใบเดียวกันหลังกะถัดไปรับไปแล้ว
      // ต้องนับเท่ากัน ไม่งั้นยอดผลิตของกะหายตอนกะหน้ากดรับ (oee.js §6 · 2026-09-09)
      const q = o.status === 'confirmed' ? (o.qty_ok ?? o.qty ?? 0)
        : ['carry_over', 'imported'].includes(o.status) ? (o.qty_actual ?? 0) : 0;
      if (!q) return;
      if (!o.mat_no) { nullSum += q; return; }
      (perMat[o.mat_no] || (perMat[o.mat_no] = { mat_no: o.mat_no, produced: 0 })).produced += q;
    });
    // ⚠️ pairAwareTotal คืน { target, produced } เท่านั้น · collapseOps ยุบชั้น OP ไม่บวกซ้ำ
    return pairAwareTotal(collapseOps(Object.values(perMat), opInfoSync()), m => trPairMat[m] || null).produced + nullSum;
  }, [trOrders, trPairMat]);

  // ── Group by period ────────────────────────────────────────────
  const grouped = useMemo(() => {
    const map = {};
    for (const r of rows) {
      const key = bucketKey(r.work_date, period);   // ตัวแบ่งถังกลาง (utils/timeRange) — ห้ามคำนวณเองในหน้า
      if (!map[key]) map[key] = [];
      map[key].push(r);
    }
    const out = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).map(([key, items]) => {
      return {
        key,
        label: bucketLabel(key, period),
        oee:   wavg(items, i => i.calcOEE, wLoad),
        a:     wavg(items, i => i.calcA, wLoad),
        p:     wavg(items, i => i.calcP, wRun),
        q:     wavg(items, i => i.calcQ, wProd),
        // pair+op aware ให้ตรงกับ KPI หัวแท็บ — ไม่มีใบงานค่อยถอยไปค่า stamp
        totalQty:   ordersProducedOf(new Set(items.map(i => i.id))) ?? items.reduce((s, i) => s + (i.totalQty || 0), 0),
        ngQty:      items.reduce((s, i) => s + (i.ngQty || 0), 0),
        unplannedMin: items.reduce((s, i) => s + i.unplannedMin, 0),
        count: items.length,
      };
    });

    // แกนวันต่อเนื่อง — วันที่ไม่มีการผลิตต้องมีช่องของตัวเอง (ค่าเป็น null = ตอว่าง)
    // ไม่งั้นกราฟ "ข้ามวัน" ทำให้ระยะห่างบนแกนไม่ตรงเวลาจริง อ่านเทรนด์ผิด
    // (UI-CONVENTIONS · pattern เดียวกับกราฟรายวันใน /product-history · QC audit 2026-08-03)
    // เติมเฉพาะช่องว่างระหว่างวันแรก-วันสุดท้ายที่มีข้อมูล (ไม่ pad หัว-ท้ายช่วงที่เลือก) · cap 400 วันกันช่วงยาวผิดปกติ
    if (!['day', 'week'].includes(period) || out.length < 2) return out;
    const dayMs = 86400000;
    const stepMs = period === 'week' ? 7 * dayMs : dayMs; // แกนสัปดาห์เดินทีละจันทร์
    const first = new Date(`${out[0].key}T00:00:00`), last = new Date(`${out[out.length - 1].key}T00:00:00`);
    const span = Math.round((last - first) / stepMs) + 1;
    if (!(span > out.length) || span > 400) return out;
    const byKey = Object.fromEntries(out.map(g => [g.key, g]));
    const filled = [];
    for (let t = first.getTime(); t <= last.getTime(); t += stepMs) {
      const d = new Date(t);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      filled.push(byKey[key] || {
        key, label: bucketLabel(key, period), empty: true,
        oee: null, a: null, p: null, q: null,
        totalQty: 0, ngQty: 0, unplannedMin: 0, count: 0,
      });
    }
    return filled;
  }, [rows, period, ordersProducedOf]);

  // ── Overall KPIs ───────────────────────────────────────────────
  // ผลิตรวมของช่วง — นับงานคู่ RH/LH เป็น 1 คู่/stroke (เหมือนแท็บภาพรวมวันนี้ · util pairAwareTotal)
  // ไม่มีใบงาน (ยังโหลดไม่เสร็จ/ข้อมูลเก่า) → ถอยไปใช้ actual_qty ที่ stamp ไว้
  const trTotalQty = useMemo(() => {
    return ordersProducedOf(new Set(rows.map(r => r.id))) ?? rows.reduce((s2, r) => s2 + (r.totalQty || 0), 0);
  }, [rows, ordersProducedOf]);

  const kpi = useMemo(() => {
    // ถ่วงน้ำหนักตรงจากทุกกะใน scope (ไม่ใช่เฉลี่ยของค่าเฉลี่ยรายวันอีกชั้น — mean-of-means ทำให้
    // วันที่ผลิตน้อยถ่วงเท่าวันที่ผลิตเยอะ) · A/OEE ถ่วงเวลารับภาระ, P ถ่วงเวลาเดินเครื่อง, Q ถ่วงจำนวนผลิต
    const oee = wavg(rows, r => r.calcOEE, wLoad);
    // ── ฐานเวลาสำหรับ OOE/TEEP — นับเฉพาะกะที่มี OEE (กะไม่มีผลผลิตไม่ถ่วง) ──
    const valid = rows.filter(r => r.calcOEE != null && (Number(r.shift_min) || 0) > 0);
    let sumNetAvail = 0, sumShift = 0, sumBreak = 0, sumPlanned = 0;
    const lineSet = new Set();
    valid.forEach(r => {
      const shiftMin = Number(r.shift_min) || 0;
      const brk = policyBreakMin(r, breakPols);
      const plan = Number(r.plannedMin) || 0;
      sumShift += shiftMin; sumBreak += brk; sumPlanned += plan;
      sumNetAvail += Math.max(0, shiftMin - brk - plan);
      lineSet.add(r.line_name);
    });
    // TEEP: ฐาน = เวลาปฏิทินทั้งหมดในช่วงที่เลือก × จำนวนไลน์ — **ต้องรวมวันที่ไม่ได้เปิดกะด้วย**
    // (ตามตำรา "Not Scheduled Time / ไม่มีแผนเปิดกะ" อยู่ในฐาน TEEP — ถ้านับเฉพาะวันที่เปิดกะ TEEP จะสูงเกินจริง)
    const dayCount = Math.max(1, Math.round((new Date(`${dateTo}T00:00:00`) - new Date(`${dateFrom}T00:00:00`)) / 86400000) + 1);

    /* ⚠️⚠️ กำลังผลิตต้องนับ "ไลน์ละครั้งเดียว" — user จับได้ 2026-08-20 ว่า TEEP ต่ำผิดปกติ
       ตัดออก 2 กลุ่ม เพราะเป็น "ของชิ้นเดียวกันที่นับไปแล้ว" ไม่ใช่กำลังผลิตเพิ่ม:
       1. ไลน์แม่ที่ไลน์ลูกก็เปิดกะ (HYDROFORM/GOR/LWR BAR/LINE APRON ASSY) — งานเกิดบนลูกอยู่แล้ว
       2. ชื่อที่ไม่อยู่ในทะเบียน production_lines (เปิดกะด้วยชื่อ "เครื่อง" เช่น SP-72) — เครื่องใน
          ไลน์ที่นับไปแล้ว · ข้อมูลจริง 7 ชื่อนี้กินตัวหาร 29% แต่มีเวลากะรวมแค่ 1%
       ⚠️ ตัดเฉพาะ "ตัวหาร" — เวลากะ/เวลารับภาระของกะพวกนั้นยังนับในตัวเศษ (เป็นเวลาผลิตจริง)
       ⚠️ ไลน์ที่ไม่เคยเปิดกะเลย (PD1/PD2 ตอนนี้) ไม่เข้าตัวหารอยู่แล้ว เพราะ lineSet มาจากกะจริง
          — ตรงกับที่ user สั่ง "ยังไม่มียอดผลิต ยังไม่ต้องนับ มีเมื่อไหร่ค่อยคิด" */
    const regNames = new Set(linesFull.map(l => l.name));
    const ranNames = [...lineSet];
    const unregNames = regNames.size ? ranNames.filter(n => !regNames.has(n)) : [];
    const dupParents = ranNames.filter(n => (parentChildrenMap[n] || []).some(k => lineSet.has(k)));
    // ทะเบียนยังไม่โหลด = อย่าเพิ่งตัดอะไร (ไม่งั้นตัวหารเป็น 0 แล้ว TEEP หายทั้งแผง)
    const capacityLines = regNames.size
      ? ranNames.filter(n => regNames.has(n) && !dupParents.includes(n))
      : ranNames;

    /* ⚠️⚠️ ปฏิทินของแต่ละไลน์ต้องเริ่มนับ "วันที่ไลน์นั้นเข้าระบบ" ไม่ใช่วันเริ่มช่วงที่เลือก
       (user 2026-08-20: "ควรคิดตั้งแต่ระบบเริ่มนะ สตาร์ทช่วง 1/7/26")
       ข้อมูลจริง: ระบบเริ่มใช้จริงสัปดาห์ 29/6 · แต่ละไลน์ทยอยเข้าคนละวัน (2/7 ถึง 23/7)
       ไม่มีไลน์ไหนเริ่มตั้งแต่ 22/5 (วัน default ของช่วง 90 วัน) เลยสักไลน์
       → นับปฏิทินเต็มช่วงให้ทุกไลน์ = **อ้างว่าไลน์ว่างงาน ทั้งที่ความจริงคือยังไม่ได้เข้าระบบ**
         ซึ่งเป็นคำกล่าวอ้างเท็จ ไม่ใช่แค่ตัวเลขเพี้ยน (1,183 → 510 วัน-ไลน์ · TEEP 11.4% → ~26%)
       ⚠️ ไลน์ที่หยุดไปเฉยๆ หลังเข้าระบบแล้ว **ยังถูกนับเต็ม** — นั่นคือกำลังผลิตที่ว่างจริง
          ตัวนี้ต่างจาก "ยังไม่เข้าระบบ" คนละเรื่อง ห้ามยุบรวมกัน
       ⚠️ กติกานี้ทำให้คำสั่ง user ก่อนหน้า ("PD1/PD2 ยังไม่ได้ใช้ มีเมื่อไหร่ค่อยเริ่มคิด")
          ทำงานเองอัตโนมัติ — ไลน์ใหม่เริ่มนับปฏิทินวันที่เปิดกะแรก ไม่ต้องไปตั้งค่าอะไร */
    const firstDay = {};
    valid.forEach(r => {
      const d = r.work_date;
      if (!d) return;
      if (!firstDay[r.line_name] || d < firstDay[r.line_name]) firstDay[r.line_name] = d;
    });
    const daysTo = (d) => Math.max(1, Math.round(
      (new Date(`${dateTo}T00:00:00`) - new Date(`${d}T00:00:00`)) / 86400000) + 1);
    const lineDays = capacityLines.reduce((a, n) => a + daysTo(firstDay[n] || dateFrom), 0);
    const calMin = lineDays * 1440;
    const r1 = (v) => (v == null ? null : +v.toFixed(1));
    return {
      oee, a: wavg(rows, r => r.calcA, wLoad),
      p: wavg(rows, r => r.calcP, wRun), q: wavg(rows, r => r.calcQ, wProd),
      // OOE/TEEP = OEE × สัดส่วนฐานเวลา → เรียง TEEP ≤ OOE ≤ OEE เสมอ และอธิบายได้ตรงๆ
      ooe:  oee != null && sumShift > 0 ? r1(oee * (sumNetAvail / sumShift)) : null,
      teep: oee != null && calMin  > 0 ? r1(oee * (sumNetAvail / calMin))   : null,
      netAvailMin: Math.round(sumNetAvail), shiftMinTotal: Math.round(sumShift),
      breakMinTotal: Math.round(sumBreak), plannedMinTotal: Math.round(sumPlanned), calMin,
      teepLines: capacityLines.length, teepDays: dayCount, teepLineDays: lineDays,
      // ตัดอะไรออกจากตัวหารบ้าง — ต้องโชว์บนจอ ห้ามตัดเงียบ
      teepRan: lineSet.size, teepDupParents: dupParents, teepUnreg: unregNames,
      // ไลน์แรกสุดเข้าระบบวันไหน — ใช้บอกว่าปฏิทินเริ่มนับตรงไหน
      teepFirstDay: capacityLines.length
        ? capacityLines.map(n => firstDay[n]).filter(Boolean).sort()[0] || null : null,
      sessions: rows.length, total: trTotalQty,
      // ── ที่มาของ A / P / Q — user 2026-08-20: "จะรู้ได้ไงว่า A เท่านี้มาจาก downtime กี่นาที
      //    ของ work time · Q เท่านั้นมาจากดี/เสียเท่าไหร่" → แนบตัวตั้ง/ตัวหารของแต่ละตัวไปเลย
      //    ⚠️ เป็น "ตัวเลขอธิบาย" ไม่ใช่ตัวที่เอาไปคำนวณ A/P/Q ซ้ำ — ค่าจริงยังเป็นค่าที่ stamp ตอนปิดกะ
      //       (รวมทั้งช่วงแบบนี้จะได้ค่าใกล้ๆ แต่ไม่เท่าเป๊ะ เพราะของจริงคิดรายกะแล้วถ่วงน้ำหนัก) ── */
      unplannedMinTotal: Math.round(rows.reduce((a, r) => a + (Number(r.unplannedMin) || 0), 0)),
      okQtyTotal: rows.reduce((a, r) => a + (Number(r.okQty) || 0), 0),
      ngQtyTotal: rows.reduce((a, r) => a + (Number(r.ngQty) || 0), 0),
    };
  }, [rows, breakPols, dateFrom, dateTo, trTotalQty, linesFull, parentChildrenMap]);

  // ── Downtime Pareto ────────────────────────────────────────────
  // แถวดิบสำหรับ Pareto + เจาะลึก (ParetoAbcChart รวมยอด/จัด ABC/เจาะมิติเอง)
  //   session → ไลน์/กะ/วัน · downtime_logs → เครื่อง/ชิ้นงาน/ผู้บันทึก/หมายเหตุ
  const sessById = useMemo(() => Object.fromEntries(rows.map(r => [r.id, r])), [rows]);
  // ⚠️ Pareto Downtime นับเฉพาะ "นอกแผน" (กฎ CLAUDE.md — ในแผน เช่น นับสต๊อก/ไม่มีแผนผลิต ไม่ใช่ loss)
  // เดิมรวมทั้งสองประเภท → "นับสต๊อก / ไม่มีแผนผลิต" ครองอันดับ 1 ที่ 50% ทั้งที่ไม่ใช่ปัญหาที่ต้องแก้
  // (บั๊กเดียวกับที่เคยแก้ในแผง Top Downtime 2026-07-15 แต่ Pareto ตกหล่น · user เจอ 2026-08-05)
  // toggle "รวมหยุดตามแผน" ให้ดูได้เมื่อต้องการ — ไม่ซ่อนข้อมูล แค่ไม่ให้ปนกับ loss จริงโดยปริยาย
  /* 💰 บาทต่อแถว — ใส่ไว้กับ record ตั้งแต่ต้นทาง เพื่อให้ "เจาะมิติไหนก็เห็นเงิน" โดยไม่ต้อง query ใหม่
     (คำสั่ง user 2026-08-26 "แปลง loss เป็นตัวเงินคือหมัดเด็ด — เจาะเข้าไปต่อได้มั้ย")
     ⚠️ คืน `null` เมื่อไลน์ไม่มี cost center / ไม่มี activity rate — **ห้ามคืน 0**
        เพราะพาเรโตที่เรียงตามเงินจะชี้เป้าผิด (ไลน์ที่ตีราคาไม่ได้จะกลายเป็น "ไม่มีความสูญเสีย") */
  const priceMin = useCallback((min, lineName, workDate) => {
    if (!(min > 0) || !lineName) return null;
    const cc = lineCostCenter(linesFull, lineName);
    const rate = cc ? rateFor(ccRates, cc, workDate) : null;
    if (!rate) return null;
    return (min / 60) * ratePerHour(rate, RATE_COMPONENTS.map(c => c.key));
  }, [linesFull, ccRates]);

  const dtIdx = useMemo(() => buildDtIndex(downtimes), [downtimes]);
  const dtRecords = useMemo(() => downtimes.filter(d => dtIncludePlanned || d.dr_downtime_types?.category !== 'planned').map(d => {
    const s = sessById[d.session_id] || {};
    const min = Number(d.duration_min) || 0;
    return {
      cat: dtBucketName(d, dtIdx),
      value: min,
      // หยุดตามแผนไม่ใช่ loss → ไม่ตีเป็นเงิน (กฎเดียวกับ dtCost) แต่ยังอยู่ในพาเรโตตอนติ๊ก "รวมในแผน"
      baht: d.dr_downtime_types?.category === 'planned' ? null : priceMin(min, s.line_name, s.work_date),
      machine: d.machine_no || '', line: s.line_name || '',
      product: d.mat_no || '', shift: s.shift === 'day' ? trI18n("กะเช้า") : s.shift === 'night' ? 'กะดึก' : '',
      man: d.reported_by_name || '', date: s.work_date || '',
      note: d.description || '',
    };
  }), [downtimes, sessById, dtIncludePlanned, priceMin]);
  const dtPlannedMin = useMemo(() => downtimes.filter(d => d.dr_downtime_types?.category === 'planned')
    .reduce((a, d) => a + (Number(d.duration_min) || 0), 0), [downtimes]);
  /* 💰 มูลค่าดาวไทม์นอกแผน (2026-08-19 · คำสั่ง user "รายละเอียดดาวไทม์ควร link เรื่องเงินออกมาให้เห็น")
     บาท = นาที/60 × activity rate (DL+DP+IDP+OH เต็ม) ของ cost center ไลน์นั้น ณ วันเกิดเหตุ
     · นับเฉพาะนอกแผน (planned ไม่ใช่ loss — กฎเดียวกับ Pareto) · ไลน์ไม่มี rate = กอง "ตีมูลค่าไม่ได้"
       รายงานบนจอเสมอ ห้ามเดา (convention เดียวกับพาร์ทไม่มีต้นทุนในแผงมูลค่าของเสีย) */
  const dtCost = useMemo(() => {
    const allComps = RATE_COMPONENTS.map(c => c.key);
    const byType = new Map();   // ประเภท -> { min, baht }
    const noRate = new Map();   // ไลน์ -> นาทีที่ตีมูลค่าไม่ได้
    let baht = 0, pricedMin = 0, totalMin = 0;
    downtimes.forEach(d => {
      if (d.dr_downtime_types?.category === 'planned') return;
      const min = Number(d.duration_min) || 0;
      if (!min) return;
      totalMin += min;
      const sess = sessById[d.session_id] || {};
      const cc = sess.line_name ? lineCostCenter(linesFull, sess.line_name) : null;
      const rate = cc ? rateFor(ccRates, cc, sess.work_date) : null;
      if (!rate) { const k = sess.line_name || 'ไม่ระบุไลน์'; noRate.set(k, (noRate.get(k) || 0) + min); return; }
      const v = (min / 60) * ratePerHour(rate, allComps);
      baht += v; pricedMin += min;
      const t = dtBucketName(d, dtIdx);   // 🗑️ ต้องตรงกับพาเรโตในหน้าเดียวกัน
      const cur = byType.get(t) || { min: 0, baht: 0 };
      cur.min += min; cur.baht += v; byType.set(t, cur);
    });
    return { baht, pricedMin, totalMin, byType: [...byType.entries()].sort((a, b) => b[1].baht - a[1].baht),
      noRate: [...noRate.entries()].sort((a, b) => b[1] - a[1]) };
  }, [downtimes, sessById, linesFull, ccRates]);
  const defRecords = useMemo(() => defects.map(d => {
    const s = sessById[d.session_id] || {};
    const qty = (d.qty_ng || 0) + (d.qty_suspect || 0);
    const mat = d.prod_orders?.mat_no || null;
    const { unit: unitCost } = defectUnitCost(mat ? partCost[mat] : null);
    return {
      cat: d.dr_defect_types?.name_th || 'ไม่ระบุ',
      value: qty,
      // พาร์ทที่ยังไม่กรอกต้นทุนใน Material Master = null (ตีมูลค่าไม่ได้) ห้ามเดาเป็น 0
      baht: unitCost == null ? null : qty * unitCost,
      product: d.prod_orders?.mat_no || '', line: s.line_name || '',
      shift: s.shift === 'day' ? trI18n("กะเช้า") : s.shift === 'night' ? 'กะดึก' : '',
      man: d.reported_by_name || '', date: s.work_date || '',
      note: d.description || '',
    };
  }), [defects, sessById, partCost]);
  /* 💰 มูลค่าของเสีย — แยก "ทั้งหมด" กับ "เฉพาะไลน์ผลิต (ไม่รวมงานทดลอง)" (2026-08-17 · คำสั่ง user)
     ตัวหลัง = ก้อนเดียวกับที่ถูกนับใน %Q ของ OEE · ต้นทุน/ชิ้นใช้ util กลาง defectUnitCost
     ⚠️ พาร์ทที่ยังไม่กรอกต้นทุนใน Material Master → ไม่เดาราคา แต่รายงานจำนวนให้เห็นบนจอ */
  const defectCost = useMemo(() => {
    /* 🔴 4 ถังต้องกระทบยอดกันได้: qtyAll = qtyTrial + qtyLine + qtyPending + qtyCleared
       · qtyLine  = ตัวที่คิดเข้า %Q จริง (NG + ของสงสัยที่ QA ตัดสินว่าเสีย)
       · qtyPending = ของสงสัยที่ QA ยังไม่พิจารณา — **ยังไม่รู้ว่าเสียไหม** จึงไม่อยู่ใน %Q (§7.1 ของ oee.js)
       · qtyCleared = QA ตรวจแล้วใช้ได้/ซ่อม/ขอใช้ — ไม่ใช่ของเสีย แต่ยังอยู่ในยอด "ทั้งหมด" ที่คนกรอกไว้ */
    const acc = { all: 0, line: 0, trial: 0, pendingBaht: 0,
                  qtyAll: 0, qtyLine: 0, qtyTrial: 0, qtyPending: 0, qtyCleared: 0 };
    const noCost = new Map();   // mat -> จำนวนชิ้นที่ตีมูลค่าไม่ได้
    const byType = new Map();   // ประเภทของเสีย -> { qty, baht }
    defects.forEach(d => {
      const qty = defectQtyAll(d);              // ยอดที่คนกรอก (เห็นทุกอย่าง)
      if (!qty) return;
      const qtyQ = defectQty(d);                // ตัวที่คิดเข้า %Q
      const pend = suspectPendingQty(d);        // รอ QA พิจารณา
      const trial = isTrialDefect(d);
      acc.qtyAll += qty;
      if (trial) acc.qtyTrial += qty;
      else {
        acc.qtyLine += qtyQ; acc.qtyPending += pend;
        acc.qtyCleared += Math.max(0, qty - qtyQ - pend);   // QA ตัดสินแล้วว่าไม่ใช่ของเสีย
      }
      const mat = d.prod_orders?.mat_no || null;
      const { unit } = defectUnitCost(mat ? partCost[mat] : null);
      if (unit == null) {
        const k = mat || 'ไม่ระบุ MAT';
        noCost.set(k, (noCost.get(k) || 0) + qty);
        return;
      }
      const v = qty * unit;
      acc.all += v;
      if (trial) acc.trial += v;
      else { acc.line += qtyQ * unit; acc.pendingBaht += pend * unit; }
      /* Top ประเภทตามมูลค่า — ตอบคนละคำถามกับ Pareto รายจำนวน
         ("ประเภทไหนแพงสุด" ≠ "ประเภทไหนเยอะสุด" — ของเสีย 5 ชิ้นของพาร์ทแพง กินเงินกว่า 50 ชิ้นของพาร์ทถูก) */
      const t = d.dr_defect_types?.name_th || 'ไม่ระบุ';
      const cur = byType.get(t) || { qty: 0, baht: 0 };
      cur.qty += qty; cur.baht += v; byType.set(t, cur);
    });
    return { ...acc, noCost: [...noCost.entries()].sort((a, b) => b[1] - a[1]),
      byType: [...byType.entries()].sort((a, b) => b[1].baht - a[1].baht) };
  }, [defects, partCost]);

  // `cluster: true` = จับกลุ่มจากข้อความอิสระ (ทางเดียวที่จะเจาะ "อื่นๆ" ซึ่งบังคับกรอกรายละเอียดอยู่แล้ว)
  const NOTE_DIM = { key: 'note', label: 'หมายเหตุ (จับกลุ่มคำ)', cluster: true };
  const DT_DIMS = [
    NOTE_DIM,
    { key: 'machine', label: 'เครื่องจักร' }, { key: 'line', label: trI18n("ไลน์") },
    { key: 'product', label: 'ชิ้นงาน' }, { key: 'shift', label: trI18n("กะ") },
    { key: 'man', label: 'ผู้บันทึก' }, { key: 'date', label: 'วัน' },
  ];
  const DEF_DIMS = [
    NOTE_DIM,
    { key: 'product', label: 'ชิ้นงาน' }, { key: 'line', label: trI18n("ไลน์") },
    { key: 'shift', label: trI18n("กะ") }, { key: 'man', label: 'ผู้บันทึก' }, { key: 'date', label: 'วัน' },
  ];

  // ── Styles ─────────────────────────────────────────────────────
  const s = {
    section: { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', marginBottom: 16 },
    title:   { fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 12 },
    sel:     { width: 'auto', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', color: 'var(--text)', fontSize: 13 }, // width:auto กัน index.css input/select {width:100%} ยืดเต็ม filter bar
    tab:     active => ({ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                background: active ? 'var(--accent)' : 'var(--bg2)', color: active ? 'var(--accent-ink)' : 'var(--text)' }),
  };

  return (
    <Page>
      <PageHeader
        title="OEE Analytics" icon="📈"
        sub={trI18n('วิเคราะห์ประสิทธิภาพการผลิต — Availability · Performance · Quality')}
        tabs={[
          { key: 'today', label: trI18n("ภาพรวมวันนี้") },
          { key: 'part', label: trI18n("รายพาร์ท") },
          { key: 'trend', label: trI18n("แนวโน้ม/ประวัติ") },
          { key: 'insight', label: trI18n("วิเคราะห์สาเหตุ") },
          { key: 'machine', label: trI18n("รายเครื่อง (จากเครื่องจักร)") },
        ]}
        tab={viewTab} onTab={setViewTab}
        actions={<>
          {canSetTarget && (
            <button type="button" className="pg-btn"
              onClick={() => setShowTargetModal(true)} title={trI18n('ตั้ง Target A/P/Q รายกรุ๊ป (OEE = A×P×Q อัตโนมัติ) — ระดับส่วนคำนวณจากค่าเฉลี่ยของกรุ๊ป')}>
              {trI18n('ตั้ง Target')}
            </button>
          )}
          {canExportReview && (
            <button type="button" className="pg-btn"
              onClick={() => setShowReviewExport(true)} title={trI18n('สร้างเด็ค Monthly Performance Review (.pptx) ตาม template TSG จากข้อมูลเดือนที่เลือก')}>
              {trI18n('รายงานเดือน')}
            </button>
          )}
        </>}
      />

      {/* โหลดแถวลูก (downtime/ของเสีย/ใบงาน) ไม่ครบ = ตัวเลขรวมต่ำกว่าจริง — ห้ามแสดง 0 เหมือนไม่มีข้อมูล */}
      {(viewTab === 'today' ? tdLoadWarn : viewTab === 'trend' ? trLoadWarn : null) && (
        <div style={{ background: 'var(--red-dim)', border: '1px solid var(--red-line)', borderRadius: 'var(--r-md)', padding: '9px 13px', marginBottom: 12, fontSize: 12.5, color: 'var(--red)', lineHeight: 1.6 }}>
          ⚠ <b>{trI18n('ตัวเลขบางส่วนโหลดไม่ครบ')}</b> — Downtime / {trI18n("ของเสีย / ยอดผลิต อาจต่ำกว่าความจริง")}
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
            {viewTab === 'today' ? tdLoadWarn : trLoadWarn} · {trI18n("ลองย่อช่วงวันให้สั้นลงแล้วกดโหลดใหม่")}
          </div>
        </div>
      )}

      {viewTab === 'today' ? (
        <>
          {/* ── Filter bar ── UI-STANDARD 2026-09-24: ขอบเขต → เวลา → กะ (Segmented เหมือนแท็บแนวโน้ม) → spacer → สถานะ/ปุ่ม */}
          <FilterBar style={{ marginBottom: 16 }}>
            {/* ขอบเขต = ช่องเดียว ส่วนงาน → กลุ่มไลน์ → ไลน์ลูก (<LineScopeSelect> · 2026-10-02 · เดิม 3 ช่อง และช่องไลน์ลูกโผล่
                เฉพาะตอนเลือกกลุ่มที่มีลูก = user "เจาะไลน์ไม่ได้") · state เดิม tdSection/tdDept/tdLine คงไว้ คิวรีไม่เปลี่ยน */}
            <LineScopeSelect lines={linesFull} sections={sectionOptions} section={tdSection} line={tdLine || tdDept}
              unit={tdUnit} pickDept index={orgIdx}
              onChange={(sec, ln, { root, unit }) => {
                setTdSection(sec); setTdUnit(unit || '');
                if (!ln) { setTdDept(''); setTdLine(''); return; }
                if (root && root !== ln) { setTdDept(root); setTdLine(ln); } else { setTdDept(ln); setTdLine(''); }
              }} />

            <select value={tdTeam} onChange={e => setTdTeam(e.target.value)}>
              <option value="">{trI18n(ALL.team)}</option>
              {tdTeam && !orgTeams.includes(tdTeam) && <option value={tdTeam}>Team {tdTeam} {trI18n('(ไม่อยู่ในผัง)')}</option>}
              {orgTeams.map(t => <option key={t} value={t}>Team {t}</option>)}
            </select>

            <input type="date" value={tdDate} onChange={e => setTdDate(e.target.value)} />
            <span className="filter-label">{fmtThaiDate(tdDate)}</span>

            <Segmented value={tdShift} onChange={setTdShift} options={SHIFT_OPTIONS} label={trI18n('กะ')} />

            <span className="spacer" />
            <span className="filter-count">
              {trI18n("อัปเดตล่าสุด")} : {lastUpdate ? lastUpdate.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
            </span>
            <button onClick={() => { loadToday(); loadTdHistory(); }} style={{ ...s.tab(false) }} title={trI18n('โหลดใหม่')}>🔄</button>
            <button onClick={() => setAutoRefresh(v => !v)} style={s.tab(autoRefresh)}>
              {/* จุดเขียวนิ่ง — กระพริบสงวนให้สถานะแดง (Andon) เท่านั้น ตาม UI-CONVENTIONS */}
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: autoRefresh ? 'var(--green)' : 'var(--muted)', marginRight: 6, boxShadow: autoRefresh ? '0 0 5px 1px var(--green-line)' : 'none' }} />
              {trI18n('รีเฟรชอัตโนมัติ')}
            </button>
            {tdLoading && <span className="filter-count">{trI18n('กำลังโหลด...')}</span>}
          </FilterBar>

          {/* 1. OEE Overview */}
          <div style={s.section}>
            <div style={s.title}>OEE OVERVIEW — {tdScopeLabel}</div>
            {/* ย่อรูปแบบ ไม่ย่อความจริง — "มีค่าสดผสมอยู่ N กะ" ต้องอยู่บนจอ (ไม่งั้นอ่านเลขผิดว่าเป็นของปิดกะแล้ว)
                ส่วนขยาย (ค่าจริงยืนยันตอนปิดกะ · OOE/TEEP นับเฉพาะกะปิด) พับไป tooltip · user 18/11
                🔴 คอมเมนต์ต้องอยู่ "ก่อน" `{cond && (` — วางข้างในกลายเป็น 2 node = จอขาว (พลาดมาแล้ว 3 รอบ) */}
            {/* 📊 วงแหวน + A/P/Q = ของกลาง `<OeeHeadline>` (แท็บ "รายพาร์ท" ใช้ก้อนเดียวกัน · 27/11) */}
            <OeeHeadline
              oee={tdKpi.oee} a={tdKpi.a} p={tdKpi.p} q={tdKpi.q}
              target={tdTarget} trend={tdHistoryGrouped} centerLabel={trI18n('OEE รวมวันนี้')}
              targetTitle={tdTarget.configured ? trI18n('เป้าจากการตั้งค่ารายกรุ๊ป (section = เฉลี่ยของกรุ๊ป)') : trI18n('ค่ามาตรฐาน — ยังไม่ตั้ง target กรุ๊ปใน scope นี้')}
              note={tdLiveCount > 0 ? (
                <div style={{ fontSize: 11, color: 'var(--muted)', margin: '-4px 0 8px' }} title={LIVE_MIX_NOTE}>
                  🟢 {trI18n("รวมค่าสดของ")} {tdLiveCount} {trI18n("กะที่ยังไม่ปิด")} <MoreMark text={LIVE_MIX_NOTE} />
                </div>
              ) : null}
            />

            {/* ── OOE / TEEP วันนี้ — ต่างจาก OEE ที่ "ฐานเวลา" (2026-08-04) ── */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              {/* OEE จริง — นับหยุด "ในแผน" เป็นการสูญเสีย (ปิดช่องโหว่ติ๊กในแผนเพื่อดัน A · 2026-08-05) */}
              <div style={{ flex: '1 1 150px', minWidth: 140 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{trI18n('OEE จริง — นับหยุดในแผนด้วย')}</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: tdKpi.strictOee != null ? oeeColor(tdKpi.strictOee) : 'var(--muted)' }}>{tdKpi.strictOee ?? '—'}{tdKpi.strictOee != null ? '%' : ''}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {trI18n("ฐาน = เวลากะ − พัก (นับหยุดในแผนเป็นการสูญเสีย")})
                  {tdKpi.strictGapPts != null && tdKpi.strictGapPts > 0.05
                    ? <> · <span style={{ color: 'var(--amber)' }}>{trI18n('ต่ำกว่า OEE')} {tdKpi.strictGapPts.toFixed(1)} {trI18n('จุด')}</span></> : ''}
                </div>
              </div>
              <div style={{ flex: '1 1 150px', minWidth: 140 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{trI18n('OOE — ใช้เวลากะคุ้มแค่ไหน')}</div>
                {/* ไม่มีเป้า OOE/TEEP ในระบบ ⇒ ห้ามทาเขียว/แดง (statusTone กฎ 2) — เหมือนแถว KPI ด้านล่าง */}
                <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--text)' }}>{tdKpi.ooe ?? '—'}{tdKpi.ooe != null ? '%' : ''}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{trI18n("ฐาน = เวลากะทั้งหมด (รวมพัก + หยุดตามแผน) · ยังไม่ได้ตั้งเป้า")}</div>
              </div>
              <div style={{ flex: '1 1 150px', minWidth: 140 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{trI18n('TEEP — ใช้กำลังผลิตที่มีกี่ %')}</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--text)' }}>{tdKpi.teep ?? '—'}{tdKpi.teep != null ? '%' : ''}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{trI18n("ฐาน = ปฏิทิน 24 ชม.")} · {tdKpi.teepLines} {trI18n('ไลน์ · ยังไม่ได้ตั้งเป้า')}</div>
              </div>
              <div style={{ flex: '2 1 260px', minWidth: 230 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 4 }}>{trI18n('เวลาที่หายไปก่อนถึง OEE (ในกะ)')}</div>
                {tdKpi.shiftMinSum > 0 ? (<>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
                    <span>{trI18n('พัก')} <b style={{ color: 'var(--text)' }}>{tdKpi.breakMinTotal.toLocaleString()}</b> {trI18n('น.')}</span>
                    <span>{trI18n('หยุดตามแผน')} <b style={{ color: 'var(--amber)' }}>{tdKpi.plannedMinTotal.toLocaleString()}</b> {trI18n('น.')}</span>
                    <span>= <b style={{ color: 'var(--amber)' }}>{((tdKpi.breakMinTotal + tdKpi.plannedMinTotal) / tdKpi.shiftMinSum * 100).toFixed(1)}%</b> {trI18n('ของเวลากะ')}</span>
                  </div>
                  <div style={{ display: 'flex', height: 9, borderRadius: 'var(--r-xs)', overflow: 'hidden', background: 'var(--bg3)', marginTop: 8 }}>
                    <div style={{ width: `${tdKpi.ooe ?? 0}%`, background: 'var(--green)' }} title={trI18n('สร้างของดี')} />
                    <div style={{ width: `${Math.max(0, (tdKpi.netAvailMin / tdKpi.shiftMinSum * 100) - (tdKpi.ooe ?? 0))}%`, background: 'var(--blue)' }} title={trI18n('เสียตอนเดินเครื่อง')} />
                    <div style={{ flex: 1, background: 'var(--amber)' }} title={trI18n('พัก + หยุดตามแผน')} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>{trI18n('🟩 สร้างของดี · 🟪 เสียตอนเดินเครื่อง · 🟧 พัก+หยุดตามแผน (OEE ไม่เห็นส่วนนี้)')}</div>
                </>) : <div style={{ fontSize: 12, color: 'var(--muted)' }}>{trI18n('ยังไม่มีกะปิด')}</div>}
              </div>
            </div>
          </div>

          {/* Row: [กะที่กำลังผลิต + ยอดผลิตรวมวันนี้] | [ผังไลน์]
              📐 27/11 (user: "1 เล็กลงได้มั้ย · 2 ขยับซ้าย · 3 ใส่เป็น layout ของไลน์ที่เลือก"
                 แล้วตามด้วย "การ์ดจำนวนชิ้นงานผลิตรวม เอาไปรวมกับการ์ดกะที่กำลังผลิตอยู่เลย จะได้ขยายเลย์เอาท์")
              เดิม 2 คอลัมน์ `1.4fr 1fr` ⇒ การ์ดซ้ายกว้างเกินเนื้อหา + แถวเหลือที่ว่างขวา
              ⇒ ยุบ 2 ใบซ้ายเป็นใบเดียว แล้วแบ่งแถวเป็น **2 คอลัมน์** ผังได้ที่กว้างกว่าเดิม
              · วันนั้นไม่มีกะเลย = คอลัมน์เดียวเต็มแถว (ห้ามเว้นช่องว่างเปล่า) */}
          <div style={{ display: 'grid', gap: 16, marginBottom: 16,
            gridTemplateColumns: isMobile ? 'minmax(0, 1fr)'
              : tdMapLineOptions.length ? 'minmax(0, 0.8fr) minmax(0, 1.4fr)' : 'minmax(0, 1fr)' }}>
            {/* 1.1 Live session */}
            <div style={{ ...s.section, marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <div style={s.title}>
                    {tdLiveSession && tdLiveSession.status !== 'closed' ? trI18n("กะที่กำลังผลิตอยู่ตอนนี้") : trI18n("กะล่าสุดของวันที่เลือก")}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    {tdLiveSession && tdLiveSession.status !== 'closed'
                      ? (tdLiveCalc?.noOutput ? `${trI18n("เปิดกะแล้ว")} ${tdLiveCalc.elapsedMin} ${trI18n("นาที · ยังไม่ปิดใบงานแรก — ประเมิน P/Q ยังไม่ได้")}`
                        /* ผลิตแล้วแต่ชิ้นงานยังไม่ได้ตั้ง CT → ประเมินความเร็วไม่ได้ ห้ามโชว์ OEE 0% */
                        : tdLiveCalc?.noCt ? `${trI18n("ผลิตแล้ว")} ${tdLiveCalc.produced} ${trI18n("ชิ้น แต่ชิ้นงานยังไม่ได้ตั้ง Cycle Time — ประเมิน %P/OEE ไม่ได้ (ตั้งที่")} Product Master: ${(tdLiveCalc.matsNoCt || []).slice(0, 3).join(', ')})`
                        : tdLiveCalc?.qtyNoCt > 0 ? `${trI18n("ค่าสด — ⚠ มีชิ้นงานที่ยังไม่ตั้ง")} CT ${tdLiveCalc.qtyNoCt} ${trI18n("ชิ้น")} (${(tdLiveCalc.matsNoCt || []).slice(0, 3).join(', ')}) → %P ${trI18n("ต่ำกว่าจริง")}`
                        : isLiveCalc ? `${trI18n("ค่าสด — คำนวณจากข้อมูล ณ ตอนนี้ (ยังไม่ปิดกะ) · ตัวเลขจริงยืนยันตอนปิดกะ")}`
                                    : `${trI18n("รอข้อมูล — กะเพิ่งเปิด ยังคำนวณไม่ได้ (ต้องเดินอย่างน้อย")} ${LIVE_MIN_ELAPSED} ${trI18n("นาที")})`)
                      : trI18n("ค่าที่บันทึกไว้ตอนปิดกะ")}
                  </div>
                </div>
                {tdLiveSession && (() => { const b = STATUS_BADGE[tdLiveSession.status] || STATUS_BADGE.closed; return (
                  <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 'var(--r-pill)', background: b.bg, color: b.color, whiteSpace: 'nowrap' }}>
                    {trI18n(b.label)}{isLiveCalc ? trI18n(" · สด") : ''}
                  </span>
                ); })()}
              </div>
              {!tdLiveSession ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>{trI18n('ไม่มีข้อมูลกะในวันที่เลือก')}</div>
              ) : (
                /* 📐 27/11 (user วงที่ว่างกลางการ์ดมาให้) — เดิมกล่องข้อความซ้ายยืดตามชื่อไลน์/ชื่อพาร์ทที่ยาว
                   ดันแท่ง A/P/Q ตกบรรทัดใหม่ แล้วเหลือที่ว่างครึ่งการ์ด
                   ⇒ `space-between` + ให้กล่องข้อความ `flex:1 1 200px minWidth:0` (ยืด/หดได้)
                      แท่ง A/P/Q เกาะขวาเสมอ · จอแคบค่อย wrap ลงบรรทัดใหม่ตามเดิม */
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{trI18n('ไลน์ · กะ')}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>
                      {tdLiveSession.line_name} <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>{tdLiveSession.shift === 'night' ? trI18n('🌙 กะดึก') : trI18n('☀️ กะเช้า')}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{trI18n('ชิ้นงานที่ผลิต')}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
                      {tdLiveParts.length ? (tdLiveParts.length > 2 ? `${tdLiveParts.slice(0, 2).join(', ')} +${tdLiveParts.length - 2}` : tdLiveParts.join(', '))
                        : (tdLiveSession.dr_products?.name || tdLiveSession.dr_products?.mat_no || trI18n("ยังไม่เปิดใบงาน"))}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>OEE</div>
                    <div style={{ fontSize: 28, fontWeight: 900, color: tdLiveRow?.calcOEE != null ? oeeColor(tdLiveRow.calcOEE) : 'var(--muted)' }}>
                      {tdLiveRow?.calcOEE ?? '—'}{tdLiveRow?.calcOEE != null ? '%' : ''}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>TARGET {(liveTarget || tdTarget).oee}%</div>
                  </div>
                  <div style={{ display: 'flex', gap: 14, flex: 'none' }}>
                    <MetricColumn label="A" value={tdLiveRow?.calcA} target={(liveTarget || tdTarget).a} color={METRIC_COLOR.a} />
                    <MetricColumn label="P" value={tdLiveRow?.calcP} target={(liveTarget || tdTarget).p} color={METRIC_COLOR.p} />
                    <MetricColumn label="Q" value={tdLiveRow?.calcQ} target={(liveTarget || tdTarget).q} color={METRIC_COLOR.q} />
                  </div>
                </div>
              )}
              {/* 📦 ยอดผลิตรวมของวันนี้ — รวมเข้ามาในการ์ดเดียวกัน (27/11 · คำสั่ง user
                  *"เอาไปรวมกับการ์ดกะที่กำลังผลิตอยู่เลยได้มั้ย จะได้ขยายเลย์เอาท์"*) ⇒ แถวเหลือ 2 ใบ ผังกว้างขึ้น
                  เป้ากะ (`target_qty`) ยังไม่ได้ตั้งในระบบ (=0 ทุกกะ) — เป้ากะ (target_qty) ปัจจุบันไม่ได้ตั้งในระบบ (=0 ทุกกะ)
                target 0 = ไม่มีเป้าให้เทียบ ห้ามโชว์ "0%" (ดูเป็นพลาดเป้าทั้งที่ผลิตได้จริง) — โชว์ "ยังไม่ตั้งเป้า" (2026-07-15) */}
            {(() => { const hasTarget = tdKpi.targetQty > 0; const achievePct = hasTarget ? Math.round(Math.min(100, tdKpi.totalQty / tdKpi.targetQty * 100)) : 0; return (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              {/* 🔴 ท่อนนี้เป็น **ยอดของทั้งวัน ทุกไลน์ในขอบเขต** ไม่ใช่ของกะที่การ์ดด้านบนโชว์
                  ⇒ ป้ายต้องเขียนขอบเขตให้ชัด ไม่งั้นรวมการ์ดแล้วคนอ่านว่าเป็นยอดของกะนั้น (27/11) */}
              <div style={{ ...s.title, marginBottom: 8 }}>
                {trI18n('จำนวนชิ้นงานที่ผลิตรวมของวันนี้')}{' '}
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>· {tdScopeLabel}</span>
              </div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                <div style={{ flex: '1 1 150px', minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{trI18n('เป้าหมาย')}</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: hasTarget ? 'var(--text)' : 'var(--muted)' }}>
                    {hasTarget ? <>{tdKpi.targetQty.toLocaleString()} <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>{trI18n('ชิ้น')}</span></> : <span style={{ fontSize: 14, fontWeight: 700 }}>{trI18n('ยังไม่ตั้งเป้ากะ')}</span>}
                  </div>
                  <div style={{ height: 10 }} />
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{trI18n('ผลิตได้แล้ว')}</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--blue)' }}>{tdKpi.totalQty.toLocaleString()} <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>{trI18n('ชิ้น')}</span></div>
                  {hasTarget && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{trI18n('คงเหลืออีก')} {Math.max(0, tdKpi.targetQty - tdKpi.totalQty).toLocaleString()} {trI18n('ชิ้น')}</div>}
                </div>
                <div style={{ position: 'relative', width: 140, height: 140, flexShrink: 0 }}>
                  <GaugeRing value={achievePct} color={hasTarget ? 'var(--blue)' : 'var(--border)'} size={140} stroke={13} />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    {hasTarget ? (
                      <><div style={{ fontSize: 24, fontWeight: 900, color: 'var(--blue)' }}>{achievePct}%</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{trI18n('เทียบเป้าหมาย')}</div></>
                    ) : (
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textAlign: 'center', padding: '0 12px' }}>{trI18n('ไม่มีเป้า')}<br/>{trI18n('ให้เทียบ')}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            ); })()}

            </div>

            {/* 3.1 🗺️ ผังเครื่องจักรของไลน์ที่เลือก — ของกลาง `<LineLensMap>` (ตัวเดียวกับ /factory-map)
                🔴 ไลน์มาจาก **ตัวกรองไลน์ของหน้า** ก่อน · ไม่ได้กรอง = ช่องบนการ์ดให้คนเลือก
                   ห้ามเลือกให้เองเงียบๆ (27/11 · user ทัก "filter เลือกทั้งโรงงานแต่ทำไมโชว์ Assy LWR") */}
            {tdMapLineOptions.length > 0 && (
              <div style={{ ...s.section, marginBottom: 0, minWidth: 0 }}>
                <div style={{ ...s.title, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
                  <span style={{ flex: 'none' }}>{trI18n('ผังไลน์')}</span>
                  {tdLine ? (
                    /* หน้ากรองไลน์ไว้แล้ว = การ์ดตามตัวกรอง ไม่ต้องมีช่องให้เลือกซ้ำ (ชื่อเต็มอยู่ใน title) */
                    <span title={tdLine} style={{ fontWeight: 600, color: 'var(--muted)', minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tdLine}</span>
                  ) : (
                    <>
                      <select value={tdMapLineOptions.includes(tdMapPick) ? tdMapPick : ''}
                        onChange={e => setTdMapPick(e.target.value)}
                        title={trI18n('เลือกไลน์ที่จะดูผัง (เฉพาะไลน์ที่มีกะในวันที่เลือก)')}
                        style={{ fontWeight: 600, maxWidth: '100%' }}>
                        <option value="">{trI18n('ทั้งโรงงาน (ผังรวม)')}</option>
                        {tdMapLineOptions.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                      {tdMapLine && (
                        <button onClick={() => setTdMapPick('')} className="ctl-btn"
                          style={{ fontSize: 11.5, padding: '2px 10px', borderRadius: 'var(--r-pill)',
                            border: '1px solid var(--border2)', background: 'transparent', color: 'var(--text2)', cursor: 'pointer' }}>
                          ← {trI18n('ผังรวมโรงงาน')}
                        </button>
                      )}
                    </>
                  )}
                </div>
                {/* กดกรอบไลน์บนผังรวมที่วันนั้นไม่มีกะ = ต้องบอก ห้ามกดแล้วเงียบ (กฎจอซื่อสัตย์) */}
                {!tdLine && tdMapPick && !tdMapLineOptions.includes(tdMapPick) && (
                  <NoticeBar tone="info">
                    {trI18n('ไลน์')} <b>{tdMapPick}</b> {trI18n('ไม่มีกะในวันที่เลือก — ยังไม่มีผลผลิต/เวลาหยุดให้ดูผัง')}
                  </NoticeBar>
                )}
                {tdMapLine ? (
                  /* หัวข้อย่อย "ผังเครื่องจักร · เครื่องหยุดวันนี้" `<LineLensMap>` เขียนให้เองแล้ว ไม่ซ้ำ */
                  <LineLensMap
                    lineName={tdMapLine} family={tdMapFamily} parentName={tdMapParent}
                    lens="breakdown" dtRows={tdMapDt} date={tdDate}
                    height={isMobile ? '300px' : 'clamp(240px, 32vh, 420px)'}
                  />
                ) : (<>
                  {/* 🏭 ยังไม่เจาะไลน์ = โชว์ **ผังรวมโรงงาน** (27/11 · user "ถ้าเลือกทั้งโรงงานดูเลย์เอาต์ใหญ่โรงงานได้มั้ย")
                      🔴 ข้อมูลกรอบ/รูป = ชุดเดียวกับ `/factory-map` ผ่าน `<FactoryMiniMap>` — **ห้ามมีผังรวมชุดที่ 2**
                      · ระบายสีด้วย OEE ของวันนี้รายไลน์ (เทียบเป้าเดียวกับหัวแดชบอร์ด) · ไม่มีกะ = เทาจาง
                      · กดกรอบไลน์ = เจาะเข้าผังเครื่องจักรของไลน์นั้น (เปลี่ยนช่องเลือกด้านบนให้เอง) */}
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
                    {trI18n('ผังรวมโรงงาน · ระบายสีตาม OEE วันนี้')} —{' '}
                    {trI18n('กดกรอบไลน์เพื่อดูผังเครื่องจักรของไลน์นั้น')}
                  </div>
                  <FactoryMiniMap
                    stateOf={tdMapStateOf} onPick={n => setTdMapPick(n)}
                    height={isMobile ? 280 : 360} bottomReserve={0}
                  />
                </>)}
              </div>
            )}
          </div>

          {/* 1.2 ⏱ ไทม์ไลน์เครื่องหยุด — "หยุดตอนไหนของวัน" (user 2026-08-26)
              แท็บนี้เป็นภาพวันเดียว คำถามที่ตอบไม่ได้มาตลอดคือ "26 นาทีนั้นกระจุกช่วงไหน"
              ซึ่งเปลี่ยนวิธีแก้คนละเรื่อง — ยอดรวม/พาเรโต้ด้านล่างตอบแค่ "ประเภทไหนมากสุด" */}
          <div style={s.section}>
            <div style={s.title}>{trI18n('⏱ ไทม์ไลน์เครื่องหยุด —')} {tdDate}</div>
            <DowntimeTimeline sessions={tdSessionsTeamFiltered} downtimes={tdDowntimesScoped} workDate={tdDate} isMobile={isMobile} />
          </div>

          {/* 1.3 วันนี้เทียบ 9 วันก่อนหน้า — เดิมเป็นกราฟ 10 วันเต็มจอ ซึ่ง (ก) ซ้ำกับ sparkline
              ในการ์ด A/P/Q ที่อยู่เหนือมันเอง (ข) ซ้ำกับกราฟแนวโน้มรายวันในแท็บ 📊 แนวโน้ม/ประวัติ
              ซึ่งให้ตัวเลขเท่ากันเป๊ะ (ตารางเดียวกัน · closed เหมือนกัน · wavg สูตรเดียวกัน)
              → ย่อเป็นแถบเทียบ + ปุ่มกระโดดไปดูย้อนหลังเต็มในแท็บที่ทำหน้าที่นั้นจริง (user 2026-08-20)
              → 2026-08-26 พับเป็นค่าเริ่มต้น: หน้านี้คือ "วันนี้" การเทียบย้อนหลังมีบ้านอยู่แล้วที่แท็บแนวโน้ม
                 (ไม่ลบทิ้ง — ยังมีค่าตอนกะปิดครบแล้ว แค่ไม่ควรกินที่เหนือไทม์ไลน์/พาเรโต้) */}
          <div style={{ ...s.section, paddingBottom: tdCmpOpen ? undefined : 10 }}>
            <div onClick={() => setTdCmpOpen(o => !o)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', cursor: 'pointer', userSelect: 'none' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', transform: tdCmpOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>▶</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>{trI18n('วันนี้เทียบค่าเฉลี่ย')} {tdVsAvg.days ? `${tdVsAvg.days} ${trI18n("วันก่อนหน้า")}` : ''}</span>
              {!tdCmpOpen && (
                <span style={{ fontSize: 11.5, color: 'var(--text2)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {['oee', 'a', 'p', 'q'].map(k => {
                    const v = tdVsAvg[k];
                    const up = v.diff != null && v.diff > 0.05, dn = v.diff != null && v.diff < -0.05;
                    return (
                      <span key={k}>
                        <b style={{ color: 'var(--muted)' }}>{k === 'oee' ? 'OEE' : k.toUpperCase()}</b>{' '}
                        <b style={{ color: v.now != null ? (k === 'oee' ? oeeColor(v.now) : METRIC_COLOR[k]) : 'var(--muted)' }}>{v.now ?? '—'}{v.now != null ? '%' : ''}</b>
                        <span style={{ color: up ? 'var(--green)' : dn ? 'var(--red)' : 'var(--muted)' }}>
                          {v.diff == null ? trI18n(" (เทียบไม่ได้)") : ` (${up ? '▲+' : dn ? '▼' : '●'}${v.diff})`}
                        </span>
                      </span>
                    );
                  })}
                </span>
              )}
            </div>
          {tdCmpOpen && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, marginTop: 10 }}>
            {!tdVsAvg.days && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{trI18n('ยังไม่มีข้อมูลย้อนหลัง')}</div>}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', flex: 1, minWidth: 260 }}>
              {['oee', 'a', 'p', 'q'].map(k => {
                const v = tdVsAvg[k];
                const up = v.diff != null && v.diff > 0.05;
                const dn = v.diff != null && v.diff < -0.05;
                return (
                  <div key={k} style={{ flex: '1 1 120px', minWidth: 110, background: 'var(--bg2-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '8px 11px' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{k === 'oee' ? 'OEE' : k.toUpperCase()}</div>
                    <div style={{ fontSize: 17, fontWeight: 900, color: v.now != null ? (k === 'oee' ? oeeColor(v.now) : METRIC_COLOR[k]) : 'var(--muted)' }}>
                      {v.now ?? '—'}{v.now != null ? '%' : ''}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: up ? 'var(--green)' : dn ? 'var(--red)' : 'var(--muted)' }}>
                      {v.diff == null ? trI18n("เทียบไม่ได้") : `${up ? '▲ +' : dn ? '▼ ' : '● '}${v.diff} ${trI18n("จุด")}`}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {trI18n("เฉลี่ย")} {v.avg ?? '—'}{v.avg != null ? '%' : ''}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              <button onClick={() => { tr.setScale('day'); tr.setRange(dateStrAdd(tdDate, -29), tdDate); setViewTab('trend'); }}
                title={trI18n('เปิดแท็บแนวโน้ม/ประวัติ พร้อมตั้งช่วง 30 วันล่าสุดให้')}
                style={{ ...s.tab(false), color: 'var(--blue)', border: '1px solid var(--blue-line)', whiteSpace: 'nowrap' }}>
                {trI18n('ดูย้อนหลังเต็ม (30 วัน)')}
              </button>
              {/* ⚠️ ตัวกรองทีมมีผลกับตัวเลข "วันนี้" แต่ไม่มีผลกับค่าเฉลี่ยย้อนหลัง (ตารางกะโหลดมาแค่วันที่เลือก)
                  — ห้ามปล่อยให้คนอ่านคิดว่าเทียบทีมเดียวกัน */}
              {tdTeam && (
                <div style={{ fontSize: 11, color: 'var(--amber)', maxWidth: 220, textAlign: 'right', lineHeight: 1.45 }}>
                  ⚠ {trI18n("ค่าเฉลี่ยย้อนหลัง")} <b>{trI18n('ไม่ได้กรองทีม')} {tdTeam}</b> — {trI18n("เทียบกับทุกทีม")}
                </div>
              )}
            </div>
          </div>
          )}
          </div>

          {/* 2. Downtime — pareto bars สีตามประเภท (นอกแผนเด่น/ในแผนจาง) แทนโดนัทหลายสี + ตารางยาว */}
          <div style={s.section}>
            <div style={s.title}>{trI18n('DOWNTIME (เวลาที่เครื่องหยุด)')}</div>
            <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : '260px 1.5fr 1.2fr', gap: 14, alignItems: 'stretch' }}>

              {/* 2.1 Total — โชว์ "นอกแผน" เป็นตัวเลขหลัก (ความเสียหายจริง) · ในแผน (ไม่มีแผนผลิต/นับสต๊อก)
                  ไม่ใช่ loss ห้ามเอามาคิด % หลัก/โป่งตัวเลข (เคยโชว์รวม 5,512น. · 38.68% ทั้งที่ 4,684น. คือ
                  ไม่มีแผนผลิต — user: "ไม่มีแผนผลิตไม่ควรเป็นอันดับ1 นอกแผนสำคัญกว่า" 2026-07-15) */}
              <div style={{ background: 'var(--bg2-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '14px 16px', display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 12 }}>{trI18n('2.1 Downtime นอกแผนของวันนี้')}</div>
                <div style={{ position: 'relative', width: 130, height: 130, margin: '2px auto 0' }}>
                  <GaugeRing value={tdKpi.totalShiftMin > 0 ? Math.min(100, tdDtByCause.unplannedMin / tdKpi.totalShiftMin * 100) : 0} color="var(--blue)" size={130} stroke={11} />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--blue)' }}>{tdDtByCause.unplannedMin.toLocaleString()}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{trI18n('นาที · นอกแผน')}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text2)', marginTop: 10 }}>
                  <b style={{ color: 'var(--blue)' }}>{tdKpi.totalShiftMin > 0 ? (tdDtByCause.unplannedMin / tdKpi.totalShiftMin * 100).toFixed(2) : '0.00'}%</b> {trI18n("ของเวลาผลิตทั้งหมด")}
                </div>
                {/* บริบท: รวมทั้งหมด + ในแผน (จาง 📅) — ให้เห็นภาพเต็มโดยไม่ให้ในแผนกลบตัวเลขหลัก */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 'auto', paddingTop: 12 }}>
                  <div style={{ background: 'var(--bg3-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '7px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{trI18n('ในแผน 📅')}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text2)' }}>{tdDtByCause.plannedMin.toLocaleString()} <span style={{ fontSize: 11, fontWeight: 600 }}>{trI18n('นาที')}</span></div>
                  </div>
                  <div style={{ background: 'var(--bg3-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '7px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{trI18n('รวมทั้งหมด')}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text2)' }}>{tdDtByCause.total.toLocaleString()} <span style={{ fontSize: 11, fontWeight: 600 }}>{trI18n('นาที')}</span></div>
                  </div>
                </div>
              </div>

              {/* 2.2 Pareto by cause */}
              <div style={{ background: 'var(--bg2-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>{trI18n('2.2 Downtime แยกตามสาเหตุ')}<span style={{ fontWeight: 600, color: 'var(--muted2)' }}> {trI18n('· นาทีที่ไลน์หยุด')}</span></div>
                  <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--muted)' }}>
                    <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 'var(--r-xs)', background: 'var(--blue)', marginRight: 4, verticalAlign: 'middle' }} />{trI18n('นอกแผน')}</span>
                    <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 'var(--r-xs)', background: 'var(--muted2)', marginRight: 4, verticalAlign: 'middle' }} />{trI18n('ในแผน 📅')}</span>
                  </div>
                </div>
                {/* 🔀 ไลน์เครื่องขนาน — บอกหน่วยให้ชัด ไม่งั้นคนเทียบกับเลขที่พนักงานลงแล้วคิดว่าจอผิด
                    (เคสจริง 27/10 ทีม MTN: ราง Conveyor เสีย 50 นาที ลง 3 เครื่อง → จอเคยโชว์ 306 นาที = "ไลน์หยุด 5 ชม.") */}
                {tdHasParallel && (
                  <NoticeBar tone="warn" style={{ marginBottom: 10 }}>
                    {trI18n("ชุดนี้มี")}<b>{trI18n('ไลน์เครื่องขนาน')}</b> {trI18n('— เครื่องหยุดพร้อมกันหลายเครื่องนับเป็น')}<b>{trI18n('ไลน์หยุดครั้งเดียว')}</b> ({trI18n("หารจำนวนเลน) ตรงกับฐานเวลาของ %A ในหัวข้อ 1 · รวมนาทีที่พนักงานลงจริงทุกเครื่อง")} = <b>{tdDtByCause.rawTotal.toLocaleString()}</b> {trI18n("นาที-เครื่อง")}
                  </NoticeBar>
                )}
                {tdDtByCause.rows.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 13 }}>{trI18n('ไม่มีข้อมูล Downtime')}</div>
                ) : (() => {
                  const TOP_N = 8;
                  const shown = tdDtShowAll ? tdDtByCause.rows : tdDtByCause.rows.slice(0, TOP_N);
                  const rest = tdDtByCause.rows.slice(TOP_N);
                  const restMin = +rest.reduce((s, d) => s + d.min, 0).toFixed(1);
                  const restPct = +rest.reduce((s, d) => s + d.pct, 0).toFixed(1);
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {shown.map(d => {
                        const planned = d.category === 'planned';
                        return (
                          <div key={d.name} title={`${d.name} — ${d.min} ${trI18n("นาที")} (${d.pct}%) · ${trI18n("กดเพื่อดูรายการ")}`}
                            onClick={() => setTdDtDrill({ kind: 'cause', key: d.name, label: d.name, typeId: d.typeId })}
                            style={{ cursor: 'pointer' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontSize: 12, marginBottom: 3 }}>
                              <span style={{ color: planned ? 'var(--muted)' : 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                                {d.name}{planned && <span style={{ marginLeft: 5, fontSize: 11 }}>📅</span>}
                              </span>
                              <span style={{ color: planned ? 'var(--muted)' : 'var(--text2)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                                <b style={{ color: planned ? 'var(--muted)' : 'var(--text)' }}>{d.min.toLocaleString()}</b> {trI18n('นาที ·')} {d.pct}%
                              </span>
                            </div>
                            <div style={{ height: 7, borderRadius: 'var(--r-xs)', background: 'var(--bg3)', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${Math.max(1.5, d.barPct)}%`, background: planned ? 'var(--muted2)' : 'var(--blue)', borderRadius: 'var(--r-xs)' }} />
                            </div>
                          </div>
                        );
                      })}
                      {rest.length > 0 && (
                        <button onClick={() => setTdDtShowAll(v => !v)}
                          style={{ marginTop: 2, padding: '6px 10px', borderRadius: 'var(--r-md)', border: '1px dashed var(--border2)', background: 'transparent', color: 'var(--muted)', fontSize: 11.5, cursor: 'pointer', textAlign: 'center' }}>
                          {tdDtShowAll ? trI18n("ย่อเหลือ Top 8") : `${trI18n("อื่นๆ อีก")} ${rest.length} ${trI18n("สาเหตุ")} · ${restMin.toLocaleString()} ${trI18n("นาที")} (${restPct}%)`}
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* 2.3 Top 10 by part */}
              <div style={{ background: 'var(--bg2-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '14px 16px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 12 }}>{trI18n('2.3 Top 10 Downtime รายพาร์ท')} <span style={{ fontWeight: 500, fontSize: 11 }}>{trI18n('(เฉพาะนอกแผน)')}</span></div>
                {tdDtByPart.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 13 }}>{trI18n('ไม่มีข้อมูล')}</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {tdDtByPart.map((d, i) => (
                      <div key={d.mat} title={`${d.part} — ${d.min} ${trI18n("นาที")} (${d.pct}%) · ${trI18n("กดเพื่อดูรายการ")}`}
                        onClick={() => setTdDtDrill({ kind: 'part', key: d.mat, label: d.part })}
                        style={{ cursor: 'pointer' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontSize: 12, marginBottom: 3 }}>
                          <span style={{ color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                            <span style={{ color: 'var(--muted)', fontWeight: 700, marginRight: 6, fontVariantNumeric: 'tabular-nums' }}>{i + 1}.</span>{d.part}
                          </span>
                          <span style={{ color: 'var(--text2)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                            <b style={{ color: 'var(--text)' }}>{d.min.toLocaleString()}</b> {trI18n('นาที ·')} {d.pct}%
                          </span>
                        </div>
                        <div style={{ height: 7, borderRadius: 'var(--r-xs)', background: 'var(--bg3)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.max(1.5, d.barPct)}%`, background: 'var(--blue)', borderRadius: 'var(--r-xs)' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* เจาะรายการดิบของแถวที่กด (แผง 2.2 / 2.3) — ตอบว่าปัญหานี้เกิดที่ไหน เครื่องไหน กี่โมง */}
          {tdDtDrill && (() => {
            /* 🔀 ยอดรวมในหัวโมดัล = **นาทีของไลน์** (ไลน์ขนานหารเลน) ส่วนตัวเลขในแต่ละแถว
               ยังเป็นนาทีที่พนักงานลงจริง (นาที-เครื่อง) — 2 หน่วยนี้ต้องเขียนกำกับให้ชัด
               เคส LASER-345 22/10: 7 แถว ดิบ 306 นาที = ไลน์หยุดจริง 102 นาที (3 แถวเวลาเดียวกัน = ครั้งเดียว) */
            const totMin = tdDrillRows.reduce((a, d) => a + dtLineMin(d, tdLaneOfRow(d), { affectsBy: affectsLn }), 0);
            const totRawMin = tdDrillRows.reduce((a, d) => a + (d.duration_min || 0), 0);
            const drillParallel = tdDrillRows.some(d => tdLaneOfRow(d) > 1);
            const th = { padding: '6px 8px', fontSize: 11, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' };
            const td = { padding: '6px 8px', fontSize: 12, color: 'var(--text)', borderTop: '1px solid var(--border)', verticalAlign: 'top' };
            return (
              <div className="modal-scroll" onClick={() => setTdDtDrill(null)}
                style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', WebkitBackdropFilter: 'var(--scrim-blur)', backdropFilter: 'var(--scrim-blur)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 16 }}>
                <div onClick={e => e.stopPropagation()}
                  style={{ background: 'var(--card-surf)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', width: 'min(96vw, 900px)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '13px 18px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {tdDtDrill.kind === 'cause' ? '⏱ ' : '📦 '}{trI18n(tdDtDrill.label)}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                        {tdDate} · {tdDrillRows.length} {trI18n('รายการ · รวม')} <b style={{ color: 'var(--blue)' }}>{Math.round(totMin).toLocaleString()}</b> {trI18n("นาทีที่ไลน์หยุด")}
                        {tdDtDrill.kind === 'part' && ' · เฉพาะนอกแผน'}
                      </div>
                      {/* 🔀 ไลน์เครื่องขนาน — ต้องบอกว่าทำไมผลรวมไม่เท่ากับการบวกเลขในคอลัมน์ ไม่งั้นคนอ่านว่าจอคำนวณผิด */}
                      {drillParallel && (
                        <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 3, lineHeight: 1.5 }}>
                          🔀 <b>{trI18n('ไลน์เครื่องขนาน')}</b> — {trI18n("เครื่องหยุดพร้อมกันหลายเครื่อง = ไลน์หยุดครั้งเดียว · นาทีในตารางคือ")} <b>{trI18n('นาที-เครื่อง')}</b> {trI18n('ที่พนักงานลงไว้ (รวม')} {Math.round(totRawMin).toLocaleString()} {trI18n("นาที")})
                        </div>
                      )}
                    </div>
                    <button onClick={() => setTdDtDrill(null)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 'var(--r-md)', padding: '2px 9px', fontSize: 14, cursor: 'pointer' }}>✕</button>
                  </div>
                  <div style={{ flex: 1, overflow: 'auto', padding: '4px 14px 14px' }}>
                    {/* 🔁 เกิดซ้ำแค่ไหน — ย้อนหลัง 30 วันของสาเหตุนี้ (ตอบว่าเป็นปัญหาเรื้อรังหรือเหตุการณ์เดียว) */}
                    {tdDtDrill.kind === 'cause' && tdDrillHist && (
                      <div style={{ background: 'var(--bg2-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '9px 12px', margin: '10px 0 4px' }}>
                        {tdDrillHist.loading ? (
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{trI18n('กำลังโหลดย้อนหลัง 30 วัน…')}</div>
                        ) : tdDrillHist.error ? (
                          <div style={{ fontSize: 12, color: 'var(--red)' }}>{trI18n('โหลดย้อนหลังไม่สำเร็จ —')} {tdDrillHist.error}</div>
                        ) : (<>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 7 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>{trI18n('ย้อนหลัง 30 วัน')}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                              {trI18n("เกิด")} <b style={{ color: 'var(--text)' }}>{tdDrillHist.hitDays}</b> {trI18n('วัน ·')} <b style={{ color: 'var(--text)' }}>{tdDrillHist.count}</b> {trI18n("ครั้ง · รวม")} <b style={{ color: 'var(--blue)' }}>{Math.round(tdDrillHist.total).toLocaleString()}</b> {trI18n("นาที")}
                            </div>
                          </div>
                          {/* แท่งรายวัน — วันที่เลือกอยู่เน้นสี · วันไม่เกิด = ตอเทาเตี้ย (ไม่ปล่อยว่างจนดูเหมือนวันหาย) */}
                          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 44 }}>
                            {tdDrillHist.days.map(d => (
                              <div key={d.key} title={`${d.key} — ${Math.round(d.min).toLocaleString()} ${trI18n("นาที")}`}
                                style={{ flex: 1, minWidth: 3, borderRadius: '2px 2px 0 0',
                                  height: `${Math.max(3, (d.min / tdDrillHist.max) * 100)}%`,
                                  background: d.min > 0 ? (d.key === tdDate ? 'var(--amber)' : 'var(--blue)') : 'var(--border)',
                                  opacity: d.min > 0 ? 0.9 : 1 }} />
                            ))}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                            <span>{dateStrAdd(tdDate, -29)}</span>
                            <span style={{ color: 'var(--amber)' }}>{trI18n('■ วันที่เลือก')}</span>
                            <span>{tdDate}</span>
                          </div>
                          {tdDrillHist.hitDays >= 10 && (
                            <div style={{ fontSize: 11.5, color: 'var(--amber)', marginTop: 7, lineHeight: 1.5 }}>
                              ⚠ {trI18n("เกิด")} {tdDrillHist.hitDays} {trI18n("วันจาก 30 วัน = ปัญหาเรื้อรัง ไม่ใช่เหตุการณ์เดียว — ควรเปิดโปรเจคปรับปรุงที่")} <b>/improvements</b> {trI18n("แทนการแก้ซ้ำทุกวัน")}
                            </div>
                          )}
                        </>)}
                      </div>
                    )}
                    {tdDtDrill.kind === 'cause' && !tdDtDrill.typeId && (
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', margin: '10px 0 4px' }}>
                        ({trI18n("รายการกลุ่มนี้ไม่ได้ผูกกับประเภท Downtime — ดูย้อนหลังให้ไม่ได้")})
                      </div>
                    )}
                    {tdDrillRows.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 13 }}>{trI18n('ไม่มีรายการ')}</div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
                        <thead><tr style={{ background: 'var(--bg2)' }}>
                          {[trI18n("ไลน์"), trI18n("กะ"), trI18n("เวลา"), trI18n("เครื่อง"), trI18n("ชิ้นงาน"), trI18n("นาที"), trI18n("หมายเหตุ / ผู้บันทึก")].map((h, i) =>
                            <th key={i} style={th}>{trI18n(h)}</th>)}
                        </tr></thead>
                        <tbody>
                          {tdDrillRows.map(d => (
                            <tr key={d.id}>
                              <td style={td}>{d._s?.line_name || '—'}</td>
                              <td style={td}>{d._s?.shift === 'night' ? trI18n('🌙 ดึก') : trI18n('☀️ เช้า')}</td>
                              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                {d.started_at ? fmtTime(new Date(d.started_at)) : '—'}
                                {d.ended_at && <> – {fmtTime(new Date(d.ended_at))}</>}
                                {/* ยังไม่ปิดรายการ = เครื่องยังหยุดอยู่ ต้องเห็นชัด */}
                                {d.started_at && !d.ended_at && <span style={{ color: 'var(--red)', fontWeight: 700 }}> {trI18n('· ยังไม่ปิด')}</span>}
                              </td>
                              <td style={td}>{d.machine_no || '—'}</td>
                              <td style={{ ...td, fontFamily: 'monospace', fontSize: 11.5 }}>{d.mat_no || '—'}</td>
                              <td style={{ ...td, fontWeight: 800, textAlign: 'right', color: d.dr_downtime_types?.category === 'planned' ? 'var(--muted)' : 'var(--blue)' }}>
                                {Math.round(d.duration_min || 0).toLocaleString()}
                              </td>
                              <td style={{ ...td, minWidth: 200 }}>
                                {d.description || <span style={{ color: 'var(--muted)' }}>{trI18n('— ไม่ได้กรอกหมายเหตุ —')}</span>}
                                {d.reported_by_name && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{d.reported_by_name}</div>}
                                {/* วิธีแก้ไขที่หัวหน้ากลุ่มลงไว้ (feedback 2026-08-19) */}
                                {d.fix_action && <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 3 }}>{d.fix_action}</div>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      ) : viewTab === 'part' ? (
        /* 📦 OEE รายพาร์ท — ตัวเลขมาจาก `computeSessionOee().byProduct` (ห้ามคิดในหน้า)
           ขอบเขต = ช่วงของ <TimeRangeBar> (เพดาน PART_MAX_DAYS วัน) · ไลน์/กะ = ชุดเดียวกับแท็บแนวโน้ม */
        <>
        {/* ⏱️ แถบกรองเวลามาตรฐาน — `scales={[]}` เพราะแท็บนี้เป็น **ตาราง ไม่มีแท่ง**
            ⇒ บันได "แท่งละ 1 …" ไม่มีความหมาย (โชว์ = ปุ่มหลอก) · ที่เหลือเหมือนทุกหน้า */}
        <TimeRangeBar
          scale={period} from={dateFrom} to={dateTo} today={tr.today} scales={[]}
          onFrom={tr.setFrom} onTo={tr.setTo} onPreset={tr.setPreset}
          onView={tr.setView} onReload={loadPartOee} loading={pbLoading} style={{ marginBottom: 12 }}
        >
          <LineSelect lines={linesFull} value={selLine} onChange={setSelLine} placeholder={ALL.line}
            extraGroups={[{ label: 'นอกทะเบียน (ชื่อใน sessions ไม่ตรงทะเบียนไลน์)', options: trOrphanLines.map(n => ({ value: n })) }]} />
          {/* 🔎 ช่องกรอง "ชิ้นงาน" (27/11 · คำสั่ง user) — ตัวเลือกคือพาร์ทที่ "ผลิตจริงในไลน์+ช่วงที่เลือก"
              ไม่ใช่ทะเบียนสินค้าทั้งโรงงาน ⇒ เปลี่ยนไลน์แล้วลิสต์แคบลงตาม · เรียงตามเวลาเดินเครื่อง */}
          <select value={partPick?.key || ''} onChange={e => setSelPart(e.target.value)}
            disabled={!partOptions.length} title={trI18n('เลือกชิ้นงานที่จะดูภาพรวม')}>
            {!partOptions.length && <option value="">{trI18n('ยังไม่มีชิ้นงานในช่วงนี้')}</option>}
            {partOptions.map(r => (
              <option key={r.key} value={r.key}>
                {r.matNos[0]}{r.name ? ` — ${r.name}` : ''}{r.matNos.length > 1 ? ` (+${r.matNos.length - 1} MAT)` : ''}
              </option>
            ))}
          </select>
          <Segmented value={selShift} onChange={setSelShift} options={SHIFT_OPTIONS} label={trI18n('กะ')} />
        </TimeRangeBar>

        {/* 📊 หัวแดชบอร์ดของพาร์ทที่เลือก — ก้อนเดียวกับแท็บ "ภาพรวมวันนี้" (`<OeeHeadline>` · 27/11)
            user: *"OEE รายพาร์ท ต้องโชว์เป็น dashboard แบบนี้สิ ... แค่กรองด้วยฟิลเตอร์"* */}
        {partPick && (
          <div className="card" style={{ padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              {/* ชื่อพาร์ทยาวได้มาก — ต้องตัดในกล่องตัวเอง ไม่งั้นดันการ์ดล้นจอมือถือ (mobilesweep จับ) */}
              <b title={`${partPick.matNos.join(' · ')}${partPick.name ? ` — ${partPick.name}` : ''}`}
                style={{ fontSize: 15, minWidth: 0, maxWidth: '100%',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <MatLabel mat={partPick.matNos[0]} name={partPick.name} oneLine />
              </b>
              {/* ไลน์ที่ผลิตพาร์ทนี้อาจมีหลายสิบ ⇒ โชว์ตัวแรก + นับที่เหลือ (ชื่อเต็มอยู่ใน title)
                  ไม่งั้นบรรทัดนี้ยาวจนดันหัวการ์ดเป็น 2-3 บรรทัด */}
              <span style={{ fontSize: 12, color: 'var(--muted)' }} title={partPick.lines.join('\n')}>
                {partPick.lines[0]}{partPick.lines.length > 1 ? ` +${partPick.lines.length - 1} ${trI18n('ไลน์')}` : ''}
                {' · '}{partPick.shifts} {trI18n('กะ')} ·{' '}
                {trI18n('เดิน')} {Math.round(partPick.runMin).toLocaleString()} {trI18n('น.')} ·{' '}
                {trI18n('ยอดผลิต')} {Math.round(partPick.pcs).toLocaleString()} {trI18n('ชิ้น')}
                {partPick.ngQty ? ` · ${trI18n('เสีย')} ${Math.round(partPick.ngQty).toLocaleString()}` : ''}
              </span>
            </div>
            {/* เลือกพาร์ทไว้แล้วพาร์ทนั้นหลุดขอบเขต = บอก ห้ามสลับเงียบ (กฎจอซื่อสัตย์) */}
            {partPickFallback && (
              <NoticeBar tone="info">
                {trI18n('ชิ้นงานที่เลือกไว้ไม่มีในไลน์/ช่วงนี้ — แสดงชิ้นงานที่เดินเครื่องนานสุดแทน')}
              </NoticeBar>
            )}
            <OeeHeadline
              oee={partPick.oee == null ? null : +(partPick.oee * 100).toFixed(1)}
              a={partPick.A == null ? null : +(partPick.A * 100).toFixed(1)}
              p={partPick.P == null ? null : +(partPick.P * 100).toFixed(1)}
              q={partPick.Q == null ? null : +(partPick.Q * 100).toFixed(1)}
              target={trTarget} trend={partTrend.length > 1 ? partTrend : null}
              trendCaption={trI18n('เทรนด์รายวันของชิ้นงานนี้')}
              centerLabel={trI18n('OEE ของชิ้นงานนี้')}
              targetTitle={trI18n('เป้าเดียวกับขอบเขตที่เลือก (ยังไม่มีเป้ารายชิ้นงาน)')}
              note={partPick.overlap ? (
                <div style={{ fontSize: 11, color: 'var(--amber)', margin: '-4px 0 8px' }}>
                  ⚠️ {trI18n('ไลน์เดินหลายพาร์ทพร้อมกันในช่วงนี้ — %A ของชิ้นงานนี้รวมนาทีหยุดที่คาบกับพาร์ทอื่น')}
                </div>
              ) : null}
            />
          </div>
        )}

        <div className="card" style={{ padding: 14, display: 'grid', gap: 10, alignContent: 'start' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 15 }}>{trI18n('เทียบทุกชิ้นงานในขอบเขตนี้')}</b>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {partWin.from === partWin.to ? fmtThaiDate(partWin.from) : `${fmtThaiDate(partWin.from)} – ${fmtThaiDate(partWin.to)}`}
              {partWin.days ? ` (${partWin.days} ${trI18n('วัน')})` : ''}
              {' · '}{trI18n('คิดจาก')} {pbByProduct.sessions} {trI18n('กะ')} · {pbByProduct.rows.length} {trI18n('พาร์ท')}
              {pbLoading ? ` · ${trI18n('กำลังโหลด...')}` : ''}
            </span>
          </div>

          {/* ช่วงถูกตัด = ต้องเขียนบนจอ ห้ามตัดเงียบ */}
          {partWin.clamped && (
            <NoticeBar tone="info">
              {trI18n('ช่วงที่เลือกยาว')} {partWin.asked} {trI18n('วัน — แท็บนี้คิดสดทีละกะ จึงแสดงเฉพาะ')}{' '}
              <b>{PART_MAX_DAYS} {trI18n('วันล่าสุดของช่วง')}</b> ({fmtThaiDate(partWin.from)} – {fmtThaiDate(partWin.to)}){' '}
              — {trI18n('อยากดูเดือนก่อน ให้เลื่อนกรอบวันที่')}
            </NoticeBar>
          )}

          {pbWarn && (
            <NoticeBar tone="bad">
              <b>{trI18n('ตัวเลขบางส่วนโหลดไม่ครบ')}</b> — {pbWarn} · {trI18n('ลองย่อช่วงวันให้สั้นลงแล้วกดโหลดใหม่')}
            </NoticeBar>
          )}

          {/* 🔴 กฎจอซื่อสัตย์ — บอกข้อจำกัดก่อนให้ดูเลข ห้ามให้คนเข้าใจผิดเงียบๆ */}
          <div style={{ fontSize: 12, lineHeight: 1.6, padding: '8px 10px', borderRadius: 'var(--r-md)',
            background: 'var(--amber-dim)', color: 'var(--amber)', border: '1px solid var(--amber-line)' }}>
            {pbByProduct.overlap && (
              <div><b>{trI18n('⚠️ ไลน์เดินหลายพาร์ทพร้อมกัน')}</b> — {trI18n('นาทีที่เครื่องหยุด 1 นาที ถูกคิดให้ทุกพาร์ทที่ช่วงเวลาคาบกัน')}
                {' '}<b>{trI18n('เทียบพาร์ทต่อพาร์ทได้ แต่บวกเป็นภาพรวมไลน์ไม่ได้')}</b></div>
            )}
            <div>{trI18n('ตัวเลขนี้คิดสดจากใบผลิต/ใบหยุดของแต่ละกะ — อาจไม่ตรงกับ %A ที่ประทับตอนปิดกะ (ทะเบียน CT/หมวดหยุด/เวลาพัก เปลี่ยนหลังปิดกะได้)')}</div>
            <div>{trI18n('%A/%P/%Q ของช่วง = ตัวตั้งรวม ÷ ตัวหารรวม (ไม่ใช่เฉลี่ยรายกะ) — กะที่ผลิตน้อยจึงไม่ถ่วงเท่ากะที่ผลิตเยอะ')}</div>
            {pbLiveCount > 0 && (
              <div>🟢 {trI18n('รวมค่าสดของ')} {pbLiveCount} {trI18n('กะที่ยังไม่ปิด — ตัวเลขยังขยับได้')}</div>
            )}
            {pbByProduct.unknownQty > 0 && (
              <div><b>{trI18n('ชี้ CT ไม่ได้')} {Math.round(pbByProduct.unknownQty).toLocaleString()} {trI18n('ชิ้น')}</b> — {trI18n('พาร์ทพวกนี้ไม่อยู่ในตาราง (ไม่รู้ CT = คิด %P ไม่ได้)')}</div>
            )}
            {pbByProduct.failed > 0 && <div>{trI18n('คิดไม่สำเร็จ')} {pbByProduct.failed} {trI18n('กะ')}</div>}
          </div>

          {pbByProduct.rows.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--muted)', padding: '20px 0', textAlign: 'center' }}>
              {!pbLoaded || pbLoading ? trI18n('กำลังโหลด...')
                : pbSessions.length === 0 ? trI18n('ไม่มีกะในช่วง/ขอบเขตที่เลือก')
                : pbProds.length === 0 ? trI18n('ยังไม่มีข้อมูลใบผลิตในช่วงที่เลือก')
                : trI18n('ไม่มีพาร์ทที่คิด OEE ได้ในช่วงที่เลือก')}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'right', color: 'var(--muted)', borderBottom: '1px solid var(--line)' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px' }}>{trI18n('พาร์ท')}</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px' }}>{trI18n('ไลน์')}</th>
                    <th style={{ padding: '6px 8px' }}>%A</th>
                    <th style={{ padding: '6px 8px' }}>%P</th>
                    <th style={{ padding: '6px 8px' }}>%Q</th>
                    <th style={{ padding: '6px 8px' }}>OEE</th>
                    <th style={{ padding: '6px 8px' }}>{trI18n('เดิน (น.)')}</th>
                    <th style={{ padding: '6px 8px' }}>{trI18n('ชิ้น')}</th>
                    <th style={{ padding: '6px 8px' }}>{trI18n('เสีย')}</th>
                    <th style={{ padding: '6px 8px' }}>{trI18n('กะ')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pbByProduct.rows.map(r => {
                    const cell = (v) => v == null ? <span style={{ color: 'var(--muted)' }}>—</span> : `${(v * 100).toFixed(1)}`;
                    return (
                      <tr key={r.key} onClick={() => setSelPart(r.key)}
                        title={trI18n('คลิกเพื่อดูภาพรวมของชิ้นงานนี้ด้านบน')}
                        style={{ borderBottom: '1px solid var(--line)', textAlign: 'right', cursor: 'pointer',
                          background: r.key === partPick?.key ? 'var(--accent-dim)' : undefined }}>
                        {/* ชื่อพาร์ทยาวได้มาก — ต้องตัดในช่องตัวเอง ไม่งั้นล้นไปทับคอลัมน์ไลน์ */}
                        <td title={`${r.matNos.join(' · ')}${r.name ? ` — ${r.name}` : ''}`}
                          style={{ textAlign: 'left', padding: '6px 8px', maxWidth: 260,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <MatLabel mat={r.matNos[0]} name={r.name} oneLine />
                          {r.matNos.length > 1 && <span style={{ fontSize: 11, color: 'var(--muted)' }}> +{r.matNos.length - 1} MAT</span>}
                          {r.overlap && <span title={trI18n('ช่วงเวลาคาบกับพาร์ทอื่น — ห้ามเอาไปบวกรวม')} style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 700 }}> ⚠️</span>}
                        </td>
                        <td title={r.lines.join('\n')}
                          style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--muted)',
                            maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.lines[0]}{r.lines.length > 1 ? ` +${r.lines.length - 1} ${trI18n('ไลน์')}` : ''}
                        </td>
                        <td style={{ padding: '6px 8px' }}>{cell(r.A)}</td>
                        <td style={{ padding: '6px 8px' }}>{cell(r.P)}</td>
                        <td style={{ padding: '6px 8px' }}>{cell(r.Q)}</td>
                        <td style={{ padding: '6px 8px', fontWeight: 800,
                          color: r.oee == null ? 'var(--muted)' : r.oee >= 0.85 ? 'var(--green)' : r.oee >= 0.6 ? 'var(--amber)' : 'var(--red)' }}>
                          {cell(r.oee)}
                        </td>
                        <td style={{ padding: '6px 8px' }}>{Math.round(r.runMin).toLocaleString()}</td>
                        <td style={{ padding: '6px 8px' }}>{Math.round(r.pcs).toLocaleString()}</td>
                        <td style={{ padding: '6px 8px' }}>{r.ngQty ? Math.round(r.ngQty).toLocaleString() : "—"}</td>
                        <td style={{ padding: '6px 8px' }}>{r.shifts}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </>
      ) : viewTab === 'machine' ? (
        /* 🏭 OEE รายจิ๊กจากข้อมูลเครื่อง (Node-RED) — สูตร ESM · คนละชุดกับ OEE ไลน์ที่ประทับ (13/11 · คำสั่ง user) */
        <JigOeeAnalytics />
      ) : viewTab === 'insight' ? (
        /* ขอบเขตที่เจาะมา (section จากแท็บวันนี้ = ค่าที่รับจาก URL แล้วตรวจสิทธิ์แล้ว) ต้องตามมาถึงแท็บนี้ด้วย
           ไม่งั้นเจาะ "ดูของเสียละเอียด" จาก OBEYA ที่กรอง PD4 แล้วได้พาเรโตทั้งโรงงาน */
        <OeeInsightPanel lines={insightLines} ccRates={ccRates}
          sectionHint={tdSection} initLine={tdLine || tdDept} />
      ) : (
      <>
      {/* ⏱️ แถบกรองเวลามาตรฐาน — เหมือนกันทุกหน้า (docs/modules/time-range-filter.md)
          ของเฉพาะหน้า (ไลน์/กะ) ส่งเข้าไปเป็น children ห้ามวาดแถบเองใหม่ */}
      <TimeRangeBar
        scale={period} from={dateFrom} to={dateTo} today={tr.today} finest="day"
        onScale={tr.setScale} onFrom={tr.setFrom} onTo={tr.setTo} onPreset={tr.setPreset}
        onView={tr.setView} onReload={loadData} loading={loading} style={{ marginBottom: 12 }}
      >
        {/* ทะเบียนไลน์ (scope แล้ว) ผ่าน <LineSelect> กลาง — เดิมสร้างจากชื่อใน sessions: ไลน์ที่ rename แล้วโชว์ชื่อเก่า / ไลน์ที่ยังไม่มี session หาย (2026-09-07) */}
        <LineSelect lines={linesFull} value={selLine} onChange={setSelLine} placeholder={ALL.line}
          extraGroups={[{ label: trI18n("นอกทะเบียน (ชื่อใน sessions ไม่ตรงทะเบียนไลน์)"), options: trOrphanLines.map(n => ({ value: n })) }]} />
        <Segmented value={selShift} onChange={setSelShift} options={SHIFT_OPTIONS} label={trI18n('กะ')} />
      </TimeRangeBar>

      {/* KPI Cards
          🚦 สีของ A/P/Q/OEE = เทียบ **เป้าที่เขียนอยู่บนการ์ดใบเดียวกัน** (`trTarget` จาก `oee_targets`)
             ผ่าน `statusOf()` ชุดกลาง — 23/09 ก้อน B
             เดิมใบพวกนี้เขียน "เป้า ≥ 90%" แต่ไปทาสีด้วยเกณฑ์ตายตัวในไฟล์ (`aColor` 90/75 ·
             `pColor` 85/70 · `qColor` 99/95) ⇒ กรุ๊ปที่ตั้งเป้าเองไม่เท่าค่ามาตรฐาน **จอจะบอกเป้าหนึ่ง
             แต่ตัดสินอีกเป้าหนึ่ง** (ค่า default ของระบบคือ P 90 แต่โค้ดทาเขียวตั้งแต่ 85)
             ⇒ 23/09 ไล่แก้ทั้งหน้าแล้ว: การ์ด KPI · A/P/Q แท็บวันนี้ · ตารางรายช่วง ใช้ `trTarget`/`tdTarget`
             เหมือนกันหมด · `oeeColor` เหลือไว้เฉพาะ OEE (เกณฑ์ 80/60 = เกณฑ์ของ OEE จริงๆ) */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16, alignItems: 'stretch' }}>
        <KpiCard primary label={trI18n('OEE เฉลี่ย (= A × P × Q)')} value={kpi.oee}
          color={statusColor(statusOf(kpi.oee, trTarget.oee))}
          sub={`${kpi.sessions} ${trI18n("กะ · เป้า")} ≥ ${trTarget.oee}%`}
          calc={<>
            {kpi.a ?? '—'}% <span style={{ color: 'var(--muted)' }}>(A)</span> ×{' '}
            {kpi.p ?? '—'}% <span style={{ color: 'var(--muted)' }}>(P)</span> ×{' '}
            {kpi.q ?? '—'}% <span style={{ color: 'var(--muted)' }}>(Q)</span> = <b>{kpi.oee ?? '—'}%</b><br />
            <span style={{ color: 'var(--muted)' }}>{trI18n('สามใบขวามือคือตัวประกอบของเลขนี้ ไม่ใช่ตัวเลขคนละเรื่อง')}</span>
          </>} />
        <KpiCard label="Availability (A)" value={kpi.a} color={statusColor(statusOf(kpi.a, trTarget.a))}
          sub={`${trI18n("เป้า")} ≥ ${trTarget.a}% · % ${trI18n("เวลาที่เครื่องพร้อม")}`}
          calc={<>
            {trI18n("เวลารับภาระ")} <b>{kpi.netAvailMin.toLocaleString()}</b> {trI18n('น.')}<br />
            − {trI18n("หยุดนอกแผน")} <b style={{ color: 'var(--blue)' }}>{kpi.unplannedMinTotal.toLocaleString()}</b> {trI18n('น.')}<br />
            = {trI18n("เดินเครื่อง")} <b>{Math.max(0, kpi.netAvailMin - kpi.unplannedMinTotal).toLocaleString()}</b> {trI18n("น.")}
          </>} />
        <KpiCard label="Performance (P)" value={kpi.p} color={statusColor(statusOf(kpi.p, trTarget.p))}
          sub={`${trI18n("เป้า")} ≥ ${trTarget.p}% · % ${trI18n("ความเร็วผลิต")}`}
          calc={<>
            {trI18n("เวลาที่ควรใช้ตาม CT ÷ เวลาเดินเครื่อง")}<br />
            <span style={{ color: 'var(--muted)' }}>{trI18n('ผลิต')} {kpi.total.toLocaleString()} {trI18n('ชิ้น ใน')} {Math.max(0, kpi.netAvailMin - kpi.unplannedMinTotal).toLocaleString()} {trI18n('น.')}</span>
          </>} />
        <KpiCard label="Quality (Q)" value={kpi.q} color={statusColor(statusOf(kpi.q, trTarget.q))}
          sub={`${trI18n("เป้า")} ≥ ${trTarget.q}% · % ${trI18n("ชิ้นงานดี")}`}
          calc={<>
            {trI18n("ของดี")} <b style={{ color: 'var(--green)' }}>{kpi.okQtyTotal.toLocaleString()}</b> {trI18n('ชิ้น')}<br />
            {trI18n("ของเสีย")} <b style={{ color: 'var(--red)' }}>{kpi.ngQtyTotal.toLocaleString()}</b> {trI18n('ชิ้น')}<br />
            = {trI18n("ผลิตจริง")} <b>{(kpi.okQtyTotal + kpi.ngQtyTotal).toLocaleString()}</b> {trI18n("ชิ้น")}
          </>} />
        {/* ผลิตรวม = ข้อเท็จจริง ไม่มีเป้าให้เทียบ ⇒ ตัวเลขสีปกติ ห้ามทาเขียว (statusTone กฎ 2) */}
        <KpiCard label={trI18n('ผลิตรวม')} value={kpi.total.toLocaleString()} unit={trI18n(" ชิ้น")}
          color="var(--text)" sub={`${kpi.sessions} ${trI18n("กะ · ยังไม่ตั้งเป้ารายช่วง")}`} />
      </div>

      {/* ── OOE / TEEP — ต่างจาก OEE ที่ "ฐานเวลา" · เห็นเวลาที่หายไปกับแผน/ไม่ได้เปิดกะ (2026-08-04) ── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16, alignItems: 'stretch' }}>
        {/* OOE/TEEP ต่างจาก OEE ที่ "ตัวหาร" อย่างเดียว — กางตัวเศษ/ตัวหารให้เห็นเหมือน A/P/Q
            (user 2026-08-20: "ให้สองค่านี้เห็นแบบ %A ด้วย") · สูตร = OEE × (รับภาระ ÷ ฐาน) */}
        {/* 🚦 OOE/TEEP **ไม่มีเป้าในระบบ** (`oee_targets` เก็บแค่ A/P/Q) ⇒ ตามกฎ statusTone ข้อ 2
            "ไม่มีเป้า = เทา ห้ามเขียว/แดง" — 23/09 ก้อน B
            เดิมทั้งคู่ถูกทาด้วย `oeeColor()` ซึ่งเป็นเกณฑ์ของ **OEE** ⇒ TEEP ที่ปกติต่ำโดยธรรมชาติ
            (ฐานเป็นปฏิทิน 24 ชม. รวมวันที่ไม่ได้เปิดกะ) ขึ้นแดงตลอดเวลาโดยไม่มีใครตั้งเกณฑ์ไว้
            = จอบอกว่า "แย่" ทั้งที่ไม่มีอะไรให้เทียบว่าแย่ · ตั้งเป้าเมื่อไหร่ค่อยเปลี่ยนเป็น statusOf */}
        <KpiCard label="OOE (Overall Operations Effectiveness)" value={kpi.ooe}
          color="var(--text)"
          sub={trI18n('ฐาน = เวลากะทั้งหมด (รวมพัก + หยุดตามแผน) · ยังไม่ได้ตั้งเป้า')}
          calc={<>
            {/* ⚠️ ไม่ใช่ "เอา OEE ไปคูณเพิ่ม" — พีชคณิตยุบแล้วเป็น A×P×Q ชุดเดียวกับ OEE
                เปลี่ยนแค่ตัวหารของ A (user ทัก 2026-08-20 ว่าคำอธิบายเดิมทำให้เข้าใจผิด) */}
            {trI18n("เป็น")} <b>A × P × Q</b> {trI18n('ชุดเดียวกับ OEE — เปลี่ยนแค่ตัวหารของ A')}<br />
            A = {trI18n("เดินเครื่อง")} ÷ <b>{trI18n('เวลากะทั้งหมด')} {kpi.shiftMinTotal.toLocaleString()}</b> {trI18n("น.")}
            → <b>{kpi.a != null && kpi.shiftMinTotal > 0 ? (kpi.a * kpi.netAvailMin / kpi.shiftMinTotal).toFixed(1) : '—'}%</b>
            <span style={{ color: 'var(--muted)' }}> {trI18n('(OEE ใช้')} {kpi.a ?? '—'}%)</span><br />
            <span style={{ color: 'var(--muted)' }}>P {kpi.p ?? '—'}% · Q {kpi.q ?? '—'}{trI18n('% เหมือน OEE ทุกตัว')}</span>
          </>} />
        <KpiCard label="TEEP (Total Effective Equipment Performance)" value={kpi.teep}
          color="var(--text)"
          sub={`${trI18n("ฐาน = ปฏิทิน 24 ชม.")} · ${kpi.teepLines} ${trI18n("ไลน์ · รวม")} ${kpi.teepLineDays.toLocaleString()} ${trI18n("วัน-ไลน์ · ยังไม่ได้ตั้งเป้า")}`}
          calc={<>
            {trI18n("เป็น")} <b>A × P × Q</b> {trI18n('ชุดเดียวกับ OEE — เปลี่ยนแค่ตัวหารของ A')}<br />
            A = {trI18n("เดินเครื่อง")} ÷ <b>{trI18n('ปฏิทิน')} {kpi.calMin.toLocaleString()}</b> {trI18n("น.")}
            → <b>{kpi.a != null && kpi.calMin > 0 ? (kpi.a * kpi.netAvailMin / kpi.calMin).toFixed(1) : '—'}%</b>
            <span style={{ color: 'var(--muted)' }}> {trI18n('(OEE ใช้')} {kpi.a ?? '—'}%)</span><br />
            <span style={{ color: 'var(--muted)' }}>P {kpi.p ?? '—'}% · Q {kpi.q ?? '—'}{trI18n('% เหมือน OEE ทุกตัว')}</span>
          </>}
          /* คำอธิบายยาว → พับหลัง ⓘ · **แต่ยังต้องอยู่บนจอ ห้ามตัดทิ้ง**
             ทั้ง 3 ก้อนนี้ตอบคำถามที่ถูกถามจริงมาแล้ว (ทำไมต่ำ · ปฏิทินเริ่มตรงไหน · ตัดไลน์อะไรออก) */
          more={<>
            {/* ต่ำเป็นเรื่องปกติ — ฐานรวมเวลาที่ไม่ได้เปิดกะด้วย ห้ามให้คนอ่านตกใจว่าโรงงานแย่ */}
            <div style={{ color: 'var(--muted)' }}>
              {trI18n("ต่ำเพราะฐานนับเวลาที่ยังไม่ได้เปิดกะด้วย — บอก \"กำลังผลิตที่เหลืออยู่\" ไม่ใช่ผลงานของไลน์")}
            </div>
            {/* ปฏิทินของแต่ละไลน์เริ่มนับวันที่มันเข้าระบบ ไม่ใช่วันเริ่มช่วง — ต้องบอก ไม่งั้นคนคิดว่านับเต็มช่วง */}
            <div style={{ color: 'var(--muted)', marginTop: 3 }}>
              {trI18n("ปฏิทินเริ่มนับ")}<b> {trI18n('วันที่แต่ละไลน์เข้าระบบ')}</b> {trI18n("ไม่ใช่วันเริ่มช่วง")}
              {kpi.teepFirstDay && <> {trI18n('(ไลน์แรกสุด')} {kpi.teepFirstDay})</>} —
              {trI18n("ช่วงก่อนหน้านั้นคือ “ยังไม่ได้ใช้ระบบ” ไม่ใช่ “ไลน์ว่าง")}”
            </div>
            {/* ตัดอะไรออกจากตัวหารบ้าง — ต้องเห็น ไม่งั้นคนสงสัยว่าทำไมเลขไลน์ไม่ตรงกับที่เห็นในลิสต์ */}
            {(kpi.teepDupParents.length > 0 || kpi.teepUnreg.length > 0) && (
              <div style={{ color: 'var(--amber)', marginTop: 3 }}>
                {trI18n("เปิดกะ")} {kpi.teepRan} {trI18n('ชื่อ → นับเป็นกำลังผลิต')} {kpi.teepLines} {trI18n("ไลน์")}
                {kpi.teepDupParents.length > 0 && (
                  <div title={kpi.teepDupParents.join(' · ')}>
                    − {kpi.teepDupParents.length} {trI18n("ไลน์แม่ที่ไลน์ลูกก็เปิดกะ (ของชิ้นเดียวกัน")})
                  </div>
                )}
                {kpi.teepUnreg.length > 0 && (
                  <div title={kpi.teepUnreg.join(' · ')}>
                    − {kpi.teepUnreg.length} {trI18n("ชื่อที่ไม่อยู่ในทะเบียนไลน์ (เปิดกะด้วยชื่อเครื่อง")})
                  </div>
                )}
              </div>
            )}
          </>} />
        <div style={{ background: 'var(--card-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '14px 18px', flex: '2 1 320px', minWidth: 260 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{trI18n('เวลาที่หายไปก่อนถึง OEE (ในกะ)')}</div>
          {kpi.shiftMinTotal > 0 ? (<>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5 }}>
              <span>{trI18n('พักนโยบาย')} <b style={{ color: 'var(--text)' }}>{kpi.breakMinTotal.toLocaleString()}</b> {trI18n('น.')}</span>
              <span>{trI18n('หยุดตามแผน')} <b style={{ color: 'var(--amber)' }}>{kpi.plannedMinTotal.toLocaleString()}</b> {trI18n('น.')}</span>
              <span>= <b style={{ color: 'var(--amber)' }}>{((kpi.breakMinTotal + kpi.plannedMinTotal) / kpi.shiftMinTotal * 100).toFixed(1)}%</b> {trI18n('ของเวลากะ')}</span>
            </div>
            {/* แถบสัดส่วน: เดินได้จริง (OEE) / เสียในเวลารับภาระ / พัก+หยุดตามแผน */}
            <div style={{ display: 'flex', height: 9, borderRadius: 'var(--r-xs)', overflow: 'hidden', background: 'var(--bg3)', marginTop: 9 }}>
              <div style={{ width: `${(kpi.ooe ?? 0)}%`, background: 'var(--green)' }} title={trI18n('เวลาที่สร้างของดีจริง')} />
              <div style={{ width: `${Math.max(0, (kpi.netAvailMin / kpi.shiftMinTotal * 100) - (kpi.ooe ?? 0))}%`, background: 'var(--blue)' }} title={trI18n('เสียในเวลารับภาระ (เครื่องเสีย/ช้า/ของเสีย)')} />
              <div style={{ flex: 1, background: 'var(--amber)' }} title={trI18n('พักนโยบาย + หยุดตามแผน')} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.6 }}>
              🟩 {trI18n("สร้างของดี · 🟪 เสียตอนเดินเครื่อง · 🟧 พัก+หยุดตามแผน (OEE มองไม่เห็นส่วนนี้ — OOE เห็น")})
            </div>
          </>) : <div style={{ fontSize: 12, color: 'var(--muted)' }}>{trI18n('ไม่มีข้อมูล')}</div>}
        </div>
      </div>

      {/* OEE Trend Chart */}
      <div style={s.section}>
        <div style={s.title}>{trI18n('แนวโน้ม OEE · A · P · Q')}</div>
        {grouped.length === 0
          ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>{loading ? trI18n('กำลังโหลด...') : trI18n('ไม่มีข้อมูล')}</div>
          : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={grouped} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis width="auto" domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted)' }} unit="%" />
                <Tooltip content={<OEETooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={trTarget.oee} stroke="var(--green)" strokeDasharray="4 4" strokeWidth={1} label={{ value: `TARGET ${trTarget.oee}%`, fill: 'var(--green)', fontSize: 11 }} />
                <Line {...chartAnim()} type="monotone" dataKey="oee" name="OEE" stroke="var(--blue)" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                <Line {...chartAnim()} type="monotone" dataKey="a"   name="A%"  stroke="var(--green)" strokeWidth={1.5} dot={false} strokeDasharray="5 3" connectNulls />
                <Line {...chartAnim()} type="monotone" dataKey="p"   name="P%"  stroke="var(--amber)" strokeWidth={1.5} dot={false} strokeDasharray="5 3" connectNulls />
                <Line {...chartAnim()} type="monotone" dataKey="q"   name="Q%"  stroke="var(--blue)" strokeWidth={1.5} dot={false} strokeDasharray="5 3" connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )
        }
      </div>

      {/* ══ 📐 โครงพื้นที่ของบล็อกล่าง (แก้ 2026-09-02 · feedback "ลืมกฎเรื่องใช้พื้นที่ให้คุ้มค่า") ══
          เดิม: การ์ดเงิน 2 ใบเป็น section เต็มความกว้าง (ตัวหนังสือกองซ้าย ที่ว่างขวา ~60%)
                แล้ว grid 2 คอลัมน์ข้างล่างมี **ลูก 3 ตัว** (DT Pareto · มูลค่าของเสีย · Defect Pareto)
                ⇒ แถว 2 เหลือครึ่งขวา**ว่างเปล่า** + การ์ดเงินโดน grid ยืดสูงเท่า DT Pareto (25 แท่ง)
                   = ช่องดำยาวครึ่งจอ ซึ่งคือสิ่งที่เห็นในภาพหน้าจอ
          ตอนนี้: 2 แถว · แต่ละแถวมีลูก **2 ตัวพอดี** ไม่มีช่องกำพร้า
            แถว A: [Pareto Downtime (สูงสุด)] | [การ์ดเงิน 2 ใบเรียงลง — ความสูงรวมพอๆ กัน]
            แถว B: [Pareto ของเสีย]           | [เปรียบเทียบ A·P·Q]
          ⚠️ `alignItems:'start'` บังคับ — ไม่งั้น grid ยืดการ์ดเตี้ยให้สูงเท่าเพื่อน (ต้นเหตุเดิม)
          ⚠️ คอลัมน์ขวาว่างทั้งคอลัมน์เมื่อไหร่ (ยังไม่มีต้นทุน/rate) ต้องกลับเป็นเต็มความกว้าง
             ไม่งั้นได้ช่องว่างแบบเดิมกลับมา */}
      {(() => {
      const hasMoney = dtCost.totalMin > 0 || defectCost.qtyAll > 0;
      /* A·P·Q อยู่คอลัมน์ขวาได้เฉพาะตอนแท่งน้อย (รายเดือน/สัปดาห์) — ถ้าจัดกลุ่มรายวันช่วงยาว
         แท่งจะเป็นสิบๆ กลุ่ม ต้องใช้ความกว้างเต็มถึงจะอ่านออก */
      const apqNarrow = grouped.length > 0 && grouped.length <= 12;
      const gcol = (on) => (isMobile || !on ? 'minmax(0, 1fr)' : 'minmax(0, 1.35fr) minmax(300px, 1fr)');
      /* วาดครั้งเดียว ใช้ได้ทั้ง 2 ตำแหน่ง (คอลัมน์ขวาของแถว B หรือเต็มความกว้างข้างล่าง)
         — ห้ามก๊อป JSX 2 ชุด เดี๋ยวแก้ตัวเดียวแล้วอีกตัวค้าง */
      const apqChart = (
        <div style={s.section}>
          <div style={s.title}>{trI18n('เปรียบเทียบ A · P · Q')}</div>
          {grouped.length === 0
            ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>{loading ? trI18n('กำลังโหลด...') : trI18n('ไม่มีข้อมูล')}</div>
            : (
              <ResponsiveContainer width="100%" height={220}>
                {/* maxBarSize — กลุ่มน้อย (3 เดือน) บนคอลัมน์กว้าง แท่งจะอ้วนจนดูเหมือนที่ว่างเป็นช่องๆ */}
                <BarChart data={grouped} margin={{ top: 5, right: 20, left: 0, bottom: 5 }} maxBarSize={44}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <YAxis width="auto" domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted)' }} unit="%" />
                  <Tooltip content={<OEETooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar {...chartAnim()} dataKey="a" name="A%" fill="var(--green)" opacity={0.8} radius={[2, 2, 0, 0]} />
                  <Bar {...chartAnim()} dataKey="p" name="P%" fill="var(--amber)" opacity={0.8} radius={[2, 2, 0, 0]} />
                  <Bar {...chartAnim()} dataKey="q" name="Q%" fill="var(--blue)" opacity={0.8} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )
          }
        </div>
      );
      return (<>

      <div style={{ display: 'grid', gridTemplateColumns: gcol(hasMoney), gap: 16, alignItems: 'start' }}>
        {/* Downtime Pareto — ABC Analysis (ชื่อบนแกนเฉพาะกลุ่ม A · ที่เหลือดูที่ tooltip/ปุ่มขยาย) */}
        <div style={{ minWidth: 0 }}>
          <ParetoAbcChart title={`Pareto — Downtime ${dtIncludePlanned ? trI18n('ทุกประเภท') : trI18n('นอกแผน')} ${trI18n("รายประเภท (นาที")})`}
            records={dtRecords} dims={DT_DIMS} unit={trI18n("นาที")} focus={dtFocus}
            emptyText={dtIncludePlanned ? trI18n('ไม่มีข้อมูล Downtime') : trI18n('ไม่มี Downtime นอกแผนในช่วงนี้')}
            sectionStyle={s.section} titleStyle={s.title} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--muted)', marginTop: -8, marginBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={dtIncludePlanned} onChange={e => setDtIncludePlanned(e.target.checked)} style={{ width: 'auto' }} />
            {trI18n("รวม \"หยุดตามแผน\" ด้วย")} ({Math.round(dtPlannedMin).toLocaleString()} {trI18n('นาที)')}
            <span style={{ color: 'var(--muted)' }}>{trI18n('— ปกติไม่นับ เพราะไม่ใช่การสูญเสียที่ต้องแก้')}</span>
          </label>
        </div>

        {/* คอลัมน์ขวา = การ์ดเงิน 2 ใบเรียงลง (สั้นทั้งคู่ · รวมกันแล้วสูงพอๆ กับ Pareto ซ้าย) */}
        {hasMoney && (
        <div style={{ minWidth: 0 }}>

      {/* 💰 มูลค่าดาวไทม์นอกแผน — link นาทีที่เสียกับเงิน (คู่กับแผงมูลค่าของเสียด้านล่าง) */}
      {dtCost.totalMin > 0 && (
        <div style={s.section}>
          <div style={s.title}>{trI18n('มูลค่าดาวไทม์นอกแผน (ช่วงที่เลือก)')}</div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'stretch' }}>
            <div style={{ background: 'var(--card-surf)', border: '1px solid var(--red-line)', borderLeft: '4px solid var(--red)', borderRadius: 'var(--r-md)', padding: '10px 14px', minWidth: 210 }}>
              <div style={{ fontSize: 11.5, color: 'var(--text2)', fontWeight: 700 }}>{trI18n('รวมที่ตีมูลค่าได้')}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--red)', lineHeight: 1.25 }}>
                {fmtBaht(dtCost.baht)} <span style={{ fontSize: 12, fontWeight: 700 }}>{trI18n('บาท')}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                {Math.round(dtCost.pricedMin).toLocaleString()} {trI18n("นาที · นาที/60 × activity rate (DL+DP+IDP+OH) ของ cost center ไลน์")}
              </div>
            </div>
            {dtCost.byType.length > 0 && (
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>{trI18n('Top ประเภทตามมูลค่า')}</div>
                {/* กดแถวแล้วเจาะทันที — ยอดรวมอย่างเดียวตอบไม่ได้ว่า "เงินก้อนนี้เกิดที่เครื่องไหน กะไหน วันไหน"
                    ซึ่งเป็นคำถามเดียวที่ทำให้เอาไปแก้ได้จริง · ส่ง measure='baht' ไปด้วยให้เรียงตามเงินตรงกับที่เห็น */}
                {dtCost.byType.slice(0, 5).map(([t, v]) => (
                  <div key={t} role="button" tabIndex={0}
                    onClick={() => setDtFocus({ cat: t, measure: 'baht', n: Date.now() })}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDtFocus({ cat: t, measure: 'baht', n: Date.now() }); } }}
                    title={`${trI18n("เจาะดู")} "${t}" — ${trI18n("แยกตามเครื่อง/ไลน์/ชิ้นงาน/กะ/วัน")}`}
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, color: 'var(--text2)', padding: '3px 6px', margin: '0 -6px', borderRadius: 6, cursor: 'pointer' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--red-dim)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</span>
                    <span style={{ whiteSpace: 'nowrap' }}><b style={{ color: 'var(--red)' }}>{fmtBaht(v.baht)}</b> {trI18n('บาท ·')} {Math.round(v.min).toLocaleString()} {trI18n('น.')}</span>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, lineHeight: 1.55 }}>
                  🔍 <b>{trI18n('คลิกแถวเพื่อเจาะ')}</b> — {trI18n("แยกตามเครื่อง/ไลน์/ชิ้นงาน/กะ/คนบันทึก/วัน (เห็นบาทรายแถวและรายการดิบ) · หรือเลื่อนลงไปที่")} <b>Pareto</b> {trI18n('แล้วกดปุ่ม')} <b style={{ color: 'var(--accent)' }}>{trI18n('฿ บาท')}</b> {trI18n("เพื่อเรียงทั้งกราฟตามเงิน")}
                </div>
              </div>
            )}
          </div>
          {dtCost.noRate.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--amber)', background: 'var(--amber-dim)', border: '1px solid var(--amber-line)', borderRadius: 'var(--r-md)', padding: '8px 11px', lineHeight: 1.7 }}>
              ⚠ {trI18n("ตีมูลค่าไม่ได้")} {Math.round(dtCost.noRate.reduce((a, x) => a + x[1], 0)).toLocaleString()} {trI18n("นาที — ไลน์ยังไม่มี cost center หรือยังไม่ตั้ง activity rate (ตั้งที่")} <b>{trI18n('ผังองค์กร → แผง 💰 Activity Rate')}</b>) · {trI18n("ยอดบาทข้างบนจึงต่ำกว่าความจริง")}
              <div style={{ marginTop: 4, color: 'var(--muted)' }}>
                {dtCost.noRate.slice(0, 8).map(([l, m]) => `${l} (${Math.round(m).toLocaleString()} ${trI18n("น.")})`).join(' · ')}{dtCost.noRate.length > 8 ? ' …' : ''}
              </div>
            </div>
          )}
        </div>
      )}

        {/* 💰 มูลค่าของเสีย — แยกงานทดลองออกจากของเสียจากไลน์ผลิต (ตัวที่คิดเข้า %Q) */}
        {defectCost.qtyAll > 0 && (
          <div style={s.section}>
            <div style={s.title}>{trI18n('มูลค่าของเสีย (ช่วงที่เลือก)')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10, alignContent: 'start' }}>
              {[
                { k: 'all',   label: 'ของเสียทั้งหมด',            sub: 'รวมงานทดลอง',                      color: 'var(--red)', qty: defectCost.qtyAll },
                { k: 'line',  label: 'จากไลน์ผลิต',               sub: 'ตัวที่คิดเข้า %Q (ไม่รวมงานทดลอง/ของรอ QA)', color: 'var(--amber)', qty: defectCost.qtyLine },
                { k: 'trial', label: 'งานทดลอง (Try-out)',     sub: 'ไม่ถูกนับใน %Q',                    color: 'var(--blue)', qty: defectCost.qtyTrial },
              ].map(c => (
                <div key={c.k} style={{ background: 'var(--card-surf)', border: `1px solid ${tint(c.color, 'line')}`, borderLeft: `4px solid ${c.color}`, borderRadius: 'var(--r-md)', padding: '10px 14px' }}>
                  <div style={{ fontSize: 11.5, color: 'var(--text2)', fontWeight: 700 }}>{trI18n(c.label)}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: c.color, lineHeight: 1.25 }}>
                    {fmtBaht(defectCost[c.k])} <span style={{ fontSize: 12, fontWeight: 700 }}>{trI18n('บาท')}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.qty.toLocaleString()} {trI18n('ชิ้น ·')} {c.sub}</div>
                </div>
              ))}
            </div>
            {/* 🔴 ยอด "ทั้งหมด" กับ "ที่คิดเข้า %Q" ต่างกันตรงไหน ต้องเขียนบนจอ ห้ามให้ไปเดาเอง (กฎ §7.1 oee.js) */}
            {(defectCost.qtyPending > 0 || defectCost.qtyCleared > 0) && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.6,
                            background: 'var(--card-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '7px 11px' }}>
                {defectCost.qtyPending > 0 && (
                  <div>
                    ⏳ {trI18n("ในยอด \"ทั้งหมด\" มีของ")}<b>{trI18n('ต้องสงสัยที่ QA ยังไม่พิจารณา')} {defectCost.qtyPending.toLocaleString()} {trI18n('ชิ้น')}</b>
                    {defectCost.pendingBaht > 0 && <> (≈ {fmtBaht(defectCost.pendingBaht)} {trI18n("บาท")})</>}
                    {' '}— <b>{trI18n('ยังไม่นับใน %Q')}</b> {trI18n("เพราะยังไม่รู้ว่าดีหรือเสีย · ถ้า QA ตัดสินว่าทำลาย %Q จะต่ำลงกว่าที่เห็นตอนนี้")}
                  </div>
                )}
                {defectCost.qtyCleared > 0 && (
                  <div>
                    ✅ {trI18n("และมี")} <b>{defectCost.qtyCleared.toLocaleString()} {trI18n('ชิ้น')}</b> {trI18n("ที่ QA ตรวจแล้วใช้ได้/ซ่อม/ขอใช้ — ไม่ใช่ของเสีย จึงไม่อยู่ใน")} %Q
                  </div>
                )}
              </div>
            )}
            {/* Top ประเภทตามมูลค่า — กดแล้วเจาะทันที (ยอดรวมตอบไม่ได้ว่าเงินก้อนนี้เกิดที่ไลน์ไหน พาร์ทไหน วันไหน) */}
            {defectCost.byType.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>{trI18n('Top ประเภทตามมูลค่า')}</div>
                {defectCost.byType.slice(0, 5).map(([t, v]) => (
                  <div key={t} role="button" tabIndex={0}
                    onClick={() => setDefFocus({ cat: t, measure: 'baht', n: Date.now() })}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDefFocus({ cat: t, measure: 'baht', n: Date.now() }); } }}
                    title={`${trI18n("เจาะดู")} "${t}" — ${trI18n("แยกตามไลน์/ชิ้นงาน/กะ/วัน")}`}
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, color: 'var(--text2)', padding: '3px 6px', margin: '0 -6px', borderRadius: 6, cursor: 'pointer' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--red-dim)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</span>
                    <span style={{ whiteSpace: 'nowrap' }}><b style={{ color: 'var(--red)' }}>{fmtBaht(v.baht)}</b> {trI18n('บาท ·')} {v.qty.toLocaleString()} {trI18n('ชิ้น')}</span>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, lineHeight: 1.55 }}>
                  🔍 <b>{trI18n('คลิกแถวเพื่อเจาะ')}</b> — "{trI18n("ประเภทไหนแพงสุด\" ตอบคนละคำถามกับ \"ประเภทไหนเยอะสุด\" ใน Pareto ด้านล่าง")}
                  · <b>{trI18n('ประเภทที่ยังตีมูลค่าไม่ได้ไม่โผล่ในลิสต์นี้')}</b> ({trI18n("ดูแถบเตือนด้านล่าง")})
                </div>
              </div>
            )}
            {defectCost.noCost.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--amber)', background: 'var(--amber-dim)', border: '1px solid var(--amber-line)', borderRadius: 'var(--r-md)', padding: '8px 11px', lineHeight: 1.7 }}>
                ⚠ {trI18n("ยังตีมูลค่าไม่ได้")} {defectCost.noCost.length} {trI18n('พาร์ท (')}{defectCost.noCost.reduce((a, x) => a + x[1], 0).toLocaleString()} {trI18n("ชิ้น) — ยอดบาทข้างบนจึงต่ำกว่าความจริง")}
                <br />{trI18n('กรอกต้นทุน/ชิ้นที่')} <b>Product Master → 🗂 Material Master</b> (standard_cost {trI18n("หรือ")} material_cost)
                <div style={{ marginTop: 4, color: 'var(--muted)' }}>
                  {defectCost.noCost.slice(0, 8).map(([m, q]) => `${m} (${q})`).join(' · ')}{defectCost.noCost.length > 8 ? ' …' : ''}
                </div>
              </div>
            )}
          </div>
        )}

        </div>
        )}
      </div>

      {/* ══ แถว B: Pareto ของเสีย | เปรียบเทียบ A·P·Q ══
          A·P·Q แท่งเยอะ (จัดกลุ่มรายวัน) = ต้องเต็มความกว้าง → ตกลงไปเป็นบล็อกของตัวเองข้างล่าง
          แล้วให้ Pareto ของเสียกินเต็มความกว้างแทน (ไม่เหลือครึ่งขวาว่างทั้ง 2 กรณี) */}
      <div style={{ display: 'grid', gridTemplateColumns: gcol(apqNarrow), gap: 16, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <ParetoAbcChart title={trI18n('Pareto — ของเสียรายประเภท (ชิ้น)')} records={defRecords} dims={DEF_DIMS} unit={trI18n("ชิ้น")} focus={defFocus}
            emptyText={trI18n('ไม่มีข้อมูลของเสีย')} sectionStyle={s.section} titleStyle={s.title} />
        </div>
        {apqNarrow && <div style={{ minWidth: 0 }}>{apqChart}</div>}
      </div>

      {!apqNarrow && apqChart}
      </>);
      })()}

      {/* Data Table */}
      <div style={s.section}>
        <div style={s.title}>{trI18n('ตารางสรุป')}</div>
        <div className="table-sticky" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--muted)' }}>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>{trI18n('ช่วงเวลา')}</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>{trI18n('กะ')}</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>{trI18n('ผลิตรวม')}</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>{trI18n('DT (นาที)')}</th>
                {/* 🚦 เขียนเป้าไว้บนหัวคอลัมน์ เพราะสีในตารางตัดสินจากเป้าพวกนี้ (23/09 · statusTone)
                    เดิมตารางทาสีด้วยเกณฑ์ตายตัวในไฟล์ โดยไม่มีอะไรบอกคนอ่านว่าเทียบกับอะไร */}
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>A% <span style={{ fontWeight: 400 }}>(≥{trTarget.a})</span></th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>P% <span style={{ fontWeight: 400 }}>(≥{trTarget.p})</span></th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Q% <span style={{ fontWeight: 400 }}>(≥{trTarget.q})</span></th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>OEE% <span style={{ fontWeight: 400 }}>(≥{trTarget.oee})</span></th>
              </tr>
            </thead>
            <tbody>
              {/* ตารางโชว์เฉพาะวันที่มีข้อมูลจริง — วันตอว่างที่เติมให้แกนกราฟต่อเนื่อง (empty) ไม่ต้องขึ้นเป็นแถว */}
              {grouped.filter(g => !g.empty).map((g, i) => (
                <tr key={g.key} style={{ borderBottom: '1px solid var(--border)', background: i % 2 ? 'var(--bg2)' : 'transparent' }}>
                  <td style={{ padding: '5px 8px', fontWeight: 700, color: 'var(--text)' }}>{period === 'day' ? g.key : trI18n(g.label)}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--muted)' }}>{g.count}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right' }}>{g.totalQty.toLocaleString()}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: g.unplannedMin > 60 ? 'var(--red)' : 'var(--text)' }}>{g.unplannedMin.toLocaleString()}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: statusColor(statusOf(g.a, trTarget.a)), fontWeight: 700 }}>{g.a ?? '—'}{g.a != null ? '%' : ''}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: statusColor(statusOf(g.p, trTarget.p)), fontWeight: 700 }}>{g.p ?? '—'}{g.p != null ? '%' : ''}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: statusColor(statusOf(g.q, trTarget.q)), fontWeight: 700 }}>{g.q ?? '—'}{g.q != null ? '%' : ''}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: statusColor(statusOf(g.oee, trTarget.oee)), fontWeight: 900, fontSize: 14 }}>{g.oee ?? '—'}{g.oee != null ? '%' : ''}</td>
                </tr>
              ))}
              {grouped.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>{loading ? trI18n('กำลังโหลด...') : trI18n('ไม่มีข้อมูล')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {showTargetModal && canSetTarget && (
        <OeeTargetModal
          groups={allGroups}
          targets={oeeTargets}
          fullName={fullName}
          onClose={() => setShowTargetModal(false)}
          onSaved={() => { loadTargets(); setShowTargetModal(false); }}
        />
      )}

      {showReviewExport && canExportReview && (
        <Suspense fallback={null}>
          <MonthlyReviewExport onClose={() => setShowReviewExport(false)} />
        </Suspense>
      )}
    </Page>
  );
}

/* ── Modal ตั้ง Target OEE/A/P/Q รายกรุ๊ป ─────────────────────────────
   เก็บเฉพาะระดับกรุ๊ปในตาราง oee_targets (Main) — ระดับ section เป็นค่าเฉลี่ยของกรุ๊ป
   คำนวณสดให้ดูในหัวข้อ section · ช่องว่าง = ไม่ตั้ง (ใช้ค่ามาตรฐาน และไม่ถูกนำไปเฉลี่ย)
   modal มีฟอร์ม → ห้ามปิดจากคลิก backdrop (UI-CONVENTIONS §5) */
function OeeTargetModal({ groups, targets, fullName, onClose, onSaved }) {
  // ตั้งได้เฉพาะ A/P/Q — OEE ไม่ใช่ช่องกรอก คำนวณจาก A×P×Q ให้อัตโนมัติ (ช่องว่างใช้ค่ามาตรฐานแทนในสูตร)
  const METRICS = [
    { key: 'target_a', label: 'A', def: TARGET.a },
    { key: 'target_p', label: 'P', def: TARGET.p },
    { key: 'target_q', label: 'Q', def: TARGET.q },
  ];
  const [draft, setDraft] = useState(() => {
    const d = {};
    groups.forEach(g => {
      const t = targets[g.name] || {};
      d[g.name] = { target_a: t.target_a ?? '', target_p: t.target_p ?? '', target_q: t.target_q ?? '' };
    });
    return d;
  });
  const [saving, setSaving] = useState(false);

  const setVal = (g, k, v) => setDraft(prev => ({ ...prev, [g]: { ...prev[g], [k]: v } }));

  const bySection = useMemo(() => {
    const m = {};
    groups.forEach(g => { const sec = g.section || trI18n('(ไม่ระบุส่วน)'); (m[sec] = m[sec] || []).push(g); });
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  }, [groups]);

  // OEE ของกรุ๊ปจาก draft = A×P×Q (metric ที่เว้นว่างใช้ค่ามาตรฐานในสูตร) — สูตรเดียวกับหน้า OEE
  const num = (v, def) => { const n = Number(v); return v !== '' && v != null && !isNaN(n) ? n : def; };
  const groupOee = (g) => {
    const d = draft[g.name] || {};
    return Math.round(num(d.target_a, TARGET.a) * num(d.target_p, TARGET.p) * num(d.target_q, TARGET.q) / 10000 * 10) / 10;
  };

  // ค่าเฉลี่ยระดับ section จาก draft (โชว์สด — ตรงกับที่หน้า OEE จะคำนวณตอนเลือก section)
  const secAvg = (list, key) => {
    const vals = list.map(g => draft[g.name]?.[key]).filter(v => v !== '' && v != null).map(Number).filter(v => !isNaN(v));
    return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 10) / 10 : null;
  };
  const secOee = (list) => {
    const vals = list.map(groupOee);
    return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 10) / 10 : null;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const toUpsert = [];
      const toDelete = [];
      for (const g of groups) {
        const d = draft[g.name];
        const nums = {};
        let hasAny = false, bad = false;
        for (const m of METRICS) {
          const raw = d[m.key];
          if (raw === '' || raw == null) { nums[m.key] = null; continue; }
          const n = Number(raw);
          if (isNaN(n) || n < 0 || n > 100) { bad = true; break; }
          nums[m.key] = n; hasAny = true;
        }
        if (bad) { toast.error(`${trI18n("ค่า target ของ")} ${g.name} ${trI18n("ต้องเป็นตัวเลข")} 0–100`); setSaving(false); return; }
        if (hasAny) {
          // target_oee ไม่เก็บแล้ว (คำนวณจาก A×P×Q ในแอปเสมอ) — เขียน null ล้างค่าเก่าที่เคยกรอกไว้
          toUpsert.push({ group_name: g.name, ...nums, target_oee: null, updated_by: userData?.user?.id || null, updated_by_name: fullName || null, updated_at: new Date().toISOString() });
        } else if (targets[g.name]) {
          toDelete.push(g.name); // เคลียร์ทุกช่อง = ลบ target ของกรุ๊ป (กลับไปใช้ค่ามาตรฐาน)
        }
      }
      if (toUpsert.length) {
        const { error } = await supabase.from('oee_targets').upsert(toUpsert, { onConflict: 'group_name' });
        if (error) throw error;
      }
      if (toDelete.length) {
        const { error } = await supabase.from('oee_targets').delete().in('group_name', toDelete);
        if (error) throw error;
      }
      toast.success('บันทึก Target เรียบร้อย');
      onSaved();
    } catch (e) {
      toast.error((trI18n('บันทึกไม่สำเร็จ') + ': ') + e.message);
      setSaving(false);
    }
  };

  const inSt = { width: 64, padding: '4px 6px', borderRadius: 6, fontSize: 12, textAlign: 'right', background: 'var(--bg)', border: '1px solid var(--border2)', color: 'var(--text)' };

  return (
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', WebkitBackdropFilter: 'var(--scrim-blur)', backdropFilter: 'var(--scrim-blur)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 16 }}>
      <div style={{ background: 'var(--card-surf)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', width: 'min(96vw, 760px)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{trI18n("ตั้ง Target A / P / Q รายกรุ๊ป")} — OEE = A×P×Q</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              {trI18n("ตั้งเฉพาะ")} A / P / Q — <strong>{trI18n('เป้า OEE คำนวณจาก A×P×Q ให้อัตโนมัติ')}</strong> · {trI18n("ระดับส่วน (section) ไม่ต้องตั้ง คำนวณเป็นค่าเฉลี่ยของกรุ๊ป · ช่องว่าง = ใช้ค่ามาตรฐาน")} (A {TARGET.a} / P {TARGET.p} / Q {TARGET.q} → OEE {TARGET.oee})
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 'var(--r-md)', padding: '2px 9px', fontSize: 14, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 18px' }}>
          {bySection.map(([sec, list]) => (
            <div key={sec} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px dashed var(--border)' }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)' }}>{sec}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {trI18n("เป้ารวมของส่วน (เฉลี่ยจากกรุ๊ป")}): {' '}
                  {METRICS.map(m => `${m.label} ${secAvg(list, m.key) ?? '—'}`).join(' · ')}
                  {' · '}<strong style={{ color: 'var(--green)' }}>OEE {secOee(list) ?? '—'}</strong>
                </span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ fontSize: 11, color: 'var(--muted)' }}>
                    <th style={{ textAlign: 'left', padding: '6px 4px' }}>{trI18n('กรุ๊ป / ไลน์หลัก')}</th>
                    {METRICS.map(m => <th key={m.key} style={{ textAlign: 'right', padding: '6px 4px', width: 76 }}>{trI18n(m.label)} ≥ %</th>)}
                    <th style={{ textAlign: 'right', padding: '6px 4px', width: 90 }} title={trI18n('คำนวณจาก A×P×Q อัตโนมัติ — ไม่ต้องกรอก')}>OEE = A×P×Q</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map(g => (
                    <tr key={g.name} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '5px 4px', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{g.name}</td>
                      {METRICS.map(m => (
                        <td key={m.key} style={{ padding: '5px 4px', textAlign: 'right' }}>
                          <input type="number" min="0" max="100" step="0.1" inputMode="decimal"
                            value={draft[g.name]?.[m.key] ?? ''}
                            onChange={e => setVal(g.name, m.key, e.target.value)}
                            placeholder={String(m.def)}
                            style={inSt} />
                        </td>
                      ))}
                      <td style={{ padding: '5px 4px', textAlign: 'right', fontSize: 13, fontWeight: 800, color: 'var(--green)', whiteSpace: 'nowrap' }}>
                        {groupOee(g)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {!groups.length && <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{trI18n('ยังไม่มีข้อมูลกรุ๊ปไลน์')}</div>}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 18px', borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 'var(--r-md)', border: '1px solid var(--border2)', background: 'var(--bg3-surf)', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}>{trI18n('ยกเลิก')}</button>
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '8px 18px', borderRadius: 'var(--r-md)', border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 700, fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? trI18n('กำลังบันทึก...') : trI18n('บันทึก Target')}
          </button>
        </div>
      </div>
    </div>
  );
}
