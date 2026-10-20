import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { loadLinesRes } from '../utils/useProductionLines';
import { UserContext } from '../App';
import { wavg, wLoad, wRun, wProd, buildCtMap, computeLiveOee, isTrialDefect, defectQty, ngByMatFrom, dtMinBySession, QBIN_EMBED } from '../utils/oee';
import { parallelUnitsOf, flowModeOf } from '../utils/lineTypes';
import { isOpenDT, isPlannedDT } from '../utils/downtimeRules';
import { dtBucketName, dtTrashStats, buildDtIndex } from '../utils/downtimeCategory';
import { getLineFamilyNames, getLeafLineNames, getAncestorNames, isLeafLine } from '../utils/lineHierarchy';
import LineSelect, { lineOptions } from '../components/LineSelect';
import { getWorkDate } from '../utils/workDate';
import { cachedMaster } from '../utils/masterCache';
import { loadBreakPolicies, loadCtProducts, loadCtKanban } from '../utils/oeeMasters';
import { fetchByIds } from '../utils/fetchByIds';
import { usePolling } from '../utils/usePolling';
import RATE from '../utils/refreshRates';
import { useLiveBoard } from '../utils/useLiveBoard';
import { useLatestRequest } from '../utils/useLatestRequest';
import { fetchAllRows } from '../utils/fetchAllRows';
import { mrows } from '../utils/masterCache';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, ReferenceLine, LabelList, Cell,
} from 'recharts';
import { CELL_BAR_FILL } from '../utils/chartAxis';
import useTvShell, { tvSizer } from '../utils/useTvShell';

/* ═══ 📟 OEE บอร์ดหน้าไลน์ — /line-oee (2026-08-25 · คำสั่ง user "เพิ่มหน้า OEE หน้าไลน์แบบนี้") ═══
   จอ TV ประจำไลน์ผลิต 1 จอ = 1 ไลน์ (deep-link ?line=<ชื่อกลุ่มไลน์>) — โครงตามภาพอ้างอิง
   OEE SUMMARY WEEKLY ของ vendor: Overall vs Target/Variance · เทรนด์รายวัน · การ์ด A/P/Q
   พร้อมที่มาตัวเลข · Alarm Top 6 · Defect Top 6 · Alarm History · แถบสถานะปัจจุบัน

   ⚠️ เตรียมรับ SCADA ตาม docs/SCADA_REALTIME_DESIGN.md:
   หน้านี้อ่านจากตารางของเราเท่านั้น (production_sessions/prod_orders/downtime_logs/defect_logs)
   วัน SCADA มาจริง → raw data (stroke/เวลาหยุด) ไหลเข้าตารางชุดเดิม จอนี้ไม่ต้องแก้อะไร
   **ห้ามต่อ SQL ของ SCADA ตรงเข้าหน้านี้ / ห้ามเอา OEE ที่ SCADA คำนวณมาโชว์** — ESM เป็นเจ้าของสูตร
   (มี OEE 2 ชุดเมื่อไหร่ = เถียงกันว่าเชื่อจอไหน) · SCADA ไม่มีทางรู้ NG → Q มาจากคนเสมอ

   กติกาที่ยึด (สูตรชุดเดียวกับทุกจอ — ห้าม drift):
   - กะปิดแล้ว = ค่า stamp · กะเปิด = computeLiveOee (ประเมินไม่ได้ = null + เหตุผล ห้ามเป็น 0)
   - เฉลี่ยข้ามกะ/รายวัน = wavg ถ่วง wLoad/wRun/wProd — ห้าม mean-of-percentages
   - NG = defect_logs (qty_ng+qty_suspect) line-mode ไม่รวมงานทดลอง · Pareto ของเสียโชว์ทุกรายการ (รวม 🧪)
   - Pareto Downtime นับเฉพาะนอกแผน (planned ไม่ใช่ loss)
   - Target = oee_targets ของกรุ๊ป (A×P×Q — target_oee เป็น vestigial ห้ามใช้) · ไม่ตั้ง = 90×90×99
   - ดึงแถวลูกผ่าน fetchByIds + query พลาด = ขึ้น "ข้อมูลไม่ครบ" ห้ามโชว์ 0 เงียบ
   - จอ TV: ฟอนต์ ≥ 11px · กระพริบเฉพาะแดง (DT ค้างนอกแผน) · usePolling(RATE.BOARD) ไม่ยิงตอนแท็บซ่อน
   - ไม่มี PageHeader โดยตั้งใจ (ข้อยกเว้นบอร์ดจอ TV เหมือน Dashboard/Management) */

const DAYS_TREND = 14;   // เทรนด์ย้อนหลัง
const DAYS_KPI = 7;      // หน้าต่างตัวเลข Overall/A/P/Q/Pareto (weekly)
const DEFAULT_TARGET = 90 * 90 * 99 / 1e4; // 80.19 — ค่ามาตรฐานเมื่อกรุ๊ปไม่ตั้ง target (กฎ oee_targets)
const shiftDate = (s, d) => { const x = new Date(`${s}T00:00:00`); x.setDate(x.getDate() + d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const ddmm = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const hrs = (min) => (min / 60).toLocaleString(undefined, { maximumFractionDigits: 1 });
const nf = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

export default function LineOeeBoard() {
  const { role, lineId, sections } = useContext(UserContext);
  /* 📺 โหมดจอประชุม (20/10 · TV 43–50" ยืนดู 2–3 ม.) — ทุกอย่างผูกกับ `tv` · จอคอมเหมือนเดิมเป๊ะ
     ตัวเลขใหญ่ขึ้น · ตัดคำอธิบายเล็ก · เต็มความสูงจอพอดี (ไม่ล้น — ล้น = ตัววนจอย่อ zoom ตัวหนังสือกลับไปเล็ก) */
  const tv = useTvShell();
  const T = tvSizer(tv);
  const [sp, setSp] = useSearchParams();
  const [lines, setLines] = useState([]);
  // เนื้อของ lines เป็น string — ใช้เป็น deps ของตัวโหลดแทน array (ดูหมายเหตุที่ useLiveBoard)
  const linesKey = useMemo(() => lines.map(l => l.name).join('|'), [lines]);
  const [data, setData] = useState(null);   // ก้อนข้อมูลดิบต่อรอบโหลด
  const [partial, setPartial] = useState(false); // query ลูกพลาดบางส่วน — ต้องบอก ห้ามเงียบ
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []); // นาฬิกา local ไม่ยิง DB

  /* ── ไลน์ + scope (pattern มาตรฐาน: leader = family ตัวเอง · อื่นตาม sections) ── */
  useEffect(() => {
    (async () => {
      // 25/09: เดิม select เอง + ถอยชุดคอลัมน์เมื่อ flow_mode ยังไม่ apply — ย้ายมา cache กลางแล้ว
      // (ชุดคอลัมน์/การถอยเป็นหน้าที่ของ useProductionLines.js ที่เดียว)
      const { data: d } = await loadLinesRes();
      setLines(d || []);
    })();
  }, []);
  /* ⚠️ 2026-08-25 บั๊กที่ user จับได้: dropdown ดึงทุกแถวจาก production_lines ตรงๆ ไม่กรองอะไรเลย
     → "Office PD4" / "Rework - PD1" / "test" (is_active=false) โผล่ปนกับไลน์ผลิตจริง เพราะไม่ได้
     เช็ค is_active และไม่มีทางรู้ว่าแถวไหน "ไม่เคยผลิตอะไรเลย" — ตรวจ DB จริงแล้ว 3 แถวนี้ไม่มี
     production_sessions สักแถวเดียวตลอดกาล (ต่างจาก GOR/HYDROFORM ที่มีประวัติจริงแค่ไม่ได้เดินเมื่อเร็วๆ นี้)
     → เพิ่ม (1) is_active (2) "ทั้งครอบครัวไลน์เคยมีกะจริงไหม" — หลักเดียวกับ TEEP ที่ไม่นับไลน์ที่ไม่เคยเปิดกะ
     cache 4 ชม. (payload เล็ก แค่คอลัมน์ line_name ของ session ทั้งหมด ~1,000 แถว) */
  const [everLines, setEverLines] = useState(null); // null = ยังโหลดไม่เสร็จ — อย่าเพิ่งกรองด้วยเงื่อนไขนี้
  useEffect(() => {
    (async () => {
      /* 05/10 (QC audit): เดิม `select('line_name')` เปล่า = ตัดที่ 1,000 แถว (กะทั้งระบบเกินไปนานแล้ว)
         ⇒ ไลน์ที่เปิดกะหลังแถวที่ 1,000 "ไม่เคยผลิต" หายจาก dropdown · และ `.data || []` = ล้มแล้ว cache
         ลิสต์ว่าง 4 ชม. ⇒ แบ่งหน้าครบ + โยนเมื่อล้ม (cache ไม่ถูกทับ) · ล้ม = ไม่กรองด้วยเงื่อนไขนี้ (ดีกว่าหาย) */
      try {
        const rows = await cachedMaster('production_sessions:line_names_ever:v2', async () =>
          mrows(await fetchAllRows(supabaseDR, 'production_sessions', 'line_name', q => q.order('id'))));
        setEverLines(new Set((rows || []).map(r => r.line_name).filter(Boolean)));
      } catch (e) { console.error('[LineOeeBoard] โหลดประวัติไลน์ไม่สำเร็จ — ไม่กรองไลน์ที่ไม่เคยเปิดกะ', e); }
    })();
  }, []);
  /* 🔴 2026-09-24 บั๊กที่ user จับได้ต่อจากรอบ 08-25: dropdown มีแต่ **ไลน์แม่** (9-10 ตัว)
     — `!l.parent_line_name` ตัดไลน์ลูกทิ้งหมด ทั้งที่ **งานจริงเกือบทั้งหมดอยู่ที่ไลน์ลูก**
     (วัดจริง: Line 60 = 109 กะ · LASER-345 = 106 · HDF2 = 107 ส่วนไลน์แม่ HYDROFORM 11 กะ
      และหยุดใช้ตั้งแต่ 02/07 — แม่กลายเป็น "แผนก" ไปแล้ว ไม่ใช่จุดผลิต)
     ⇒ จอ TV ประจำไลน์เปิดดู OEE ของไลน์ตัวเองไม่ได้เลย ต้องดูค่าเฉลี่ยรวมทั้งครอบครัว
        ซึ่งกลบกันเอง (laser + assy + bending คนละ process อยู่ใต้แม่เดียวกัน)
     แก้: ใช้ `<LineSelect>` (picker กลาง · UI §5.1.2) กางลำดับชั้นแม่→ลูกให้ครบ
     ⚠️ คงกฎเดิมของรอบ 08-25 ไว้: ไลน์ปลดระวาง + ไลน์ที่ "ไม่เคยเปิดกะเลย" ต้องไม่โผล่
        แต่เช็คที่ **ไลน์ลูกใต้มัน (leaf)** ไม่ใช่ทั้งครอบครัว — getLineFamilyNames รวม
        *สายบน* ด้วย ⇒ ไลน์ลูกที่ไม่เคยเปิดกะจะติดมาเพราะแม่เคยเปิด (Office PD4 ยังถูกตัดถูกต้อง
        แต่ LINE GWM ที่ไม่เคยเปิดกะจะหลุดเข้ามา) */
  const boardLines = useMemo(() => {
    const act = lines.filter(l => l.is_active !== false);
    if (!everLines) return act;            // ยังโหลดไม่เสร็จ = ยังไม่กรองด้วยเงื่อนไขนี้
    return act.filter(l => everLines.has(l.name) || getLeafLineNames(act, l.name).some(n => everLines.has(n)));
  }, [lines, everLines]);
  const options = useMemo(
    () => lineOptions(boardLines, { role, lineId, sections }).map(o => o.value),
    [boardLines, role, lineId, sections],
  );
  // deep-link ?line= — นอก scope/สะกดผิด = ตกไปตัวแรกที่เข้าได้ (pattern เดียวกับ Management)
  const line = useMemo(() => {
    const q = sp.get('line');
    return q && options.includes(q) ? q : (options[0] || '');
  }, [sp, options]);
  const setLine = (v) => { const n = new URLSearchParams(sp); n.set('line', v); setSp(n, { replace: true }); };

  /* ── โหลดข้อมูลทั้งหน้าต่าง (ไลน์เดียว 14 วัน — payload เล็ก) · poll RATE.BOARD ── */
  const begin = useLatestRequest();   // เปลี่ยนไลน์ระหว่างโหลด = คำตอบของไลน์เก่าห้ามทับจอ (กฎ DB ข้อ 4)
  const load = useCallback(async () => {
    if (!line || !lines.length) return;
    const live = begin();
    const today = getWorkDate();
    /* 🔴 ไลน์ที่ไม่มีลูก (leaf) = ดู **ของตัวเองอย่างเดียว**
       getLineFamilyNames คืน "ตัวเอง + สายบน" ด้วย ⇒ เลือก Laser GOR แล้วกะเก่าของไลน์แม่ GOR
       จะถูกเอามาเฉลี่ยปนด้วย = จอบอก OEE ของไลน์อื่น (กฎ "หน่วยย่อยที่สุด" ใน lineHierarchy.js)
       ไลน์แม่ที่มีลูก = roll-up ทั้งครอบครัวเหมือนเดิม */
    const fam = isLeafLine(lines, line) ? [line] : getLineFamilyNames(lines, line);
    const from = shiftDate(today, -(DAYS_TREND - 1));
    let bad = false;

    const { data: sess, error: e1 } = await supabaseDR.from('production_sessions')
      .select('id, line_name, work_date, shift, status, oee, oee_a, oee_p, oee_q, shift_min, actual_qty, start_time')
      .gte('work_date', from).lte('work_date', today).in('line_name', fam.length ? fam : [line])
      .order('id').limit(1000);
    if (!live()) return;
    if (e1) { setData(null); setPartial(true); return; }
    const sessions = sess || [];
    const ids = sessions.map(s => s.id);

    const [dtR, defR, prods, kstds, breaks] = await Promise.all([
      fetchByIds(ids, c => supabaseDR.from('downtime_logs')
        .select('id, session_id, duration_min, started_at, ended_at, machine_no, description, call_mtn, dr_downtime_types(name_th, category)')
        .in('session_id', c)),
      fetchByIds(ids, c => supabaseDR.from('defect_logs')
        // prod_orders(mat_no) = ไว้ชี้ CT ของ NG ตอนบวกเข้าตัวเศษ %P (ngByMatFrom)
        .select(`id, session_id, qty_ng, qty_suspect, is_trial, prod_orders(mat_no), dr_defect_types(name_th, excl_from_q), ${QBIN_EMBED}`)
        .in('session_id', c)),
      // master ผ่าน cache กลาง — key เดียวกับ FactoryMap = แชร์กัน ไม่ดึงซ้ำ (กฎ egress)
      // ล้ม = null (loader กลางโยน ไม่ cache ลิสต์ว่างทับของดี) ⇒ ติดธง partial บอกบนจอ ห้ามถือว่า "ไม่มี CT/ไม่มีพัก"
      loadCtProducts().catch(() => null),
      loadCtKanban().catch(() => null),
      // นโยบายพัก — ต้องส่งเข้า computeLiveOee ไม่งั้น A/P สดไม่ตรงกับค่าที่ stamp ตอนปิดกะ (2026-09-14)
      loadBreakPolicies().catch(() => null),
    ]);
    if (prods == null || kstds == null || breaks == null) bad = true;
    if (dtR.error || dtR.truncated || defR.error || defR.truncated) bad = true;

    // orders เฉพาะกะที่ยังเปิดของวันนี้ (สำหรับ OEE สด + ยอดระหว่างกะ)
    const openToday = sessions.filter(s => s.status === 'open' && s.work_date === today);
    let orders = [];
    if (openToday.length) {
      const oR = await fetchByIds(openToday.map(s => s.id), c => supabaseDR.from('prod_orders')
        .select('id, session_id, status, qty, qty_ok, qty_actual, qty_target, mat_no, opened_at').in('session_id', c));
      if (oR.error) bad = true;
      orders = oR.rows;
    }

    /* เป้า OEE ของกรุ๊ป (Main) — A×P×Q เสมอ
       ⚠️ oee_targets ตั้งไว้ที่ **ระดับกรุ๊ป/ไลน์แม่** เท่านั้น (วัดจริง 24/09: 11 แถว ไม่มีไลน์ลูกสักตัว)
       ⇒ เลือกไลน์ลูกแล้ว .eq(line) ได้ null → จอตกไป DEFAULT_TARGET 80.19 เงียบๆ ทั้งที่กรุ๊ปตั้ง 85.05
       ให้ไล่ขึ้นสายบนหาตัวที่ใกล้ที่สุด แล้ว**บอกบนจอว่าเป็นเป้าของกรุ๊ปไหน** (ห้ามยืมเงียบ) */
    const tgNames = [line, ...getAncestorNames(lines, line)];
    const { data: tgRows, error: tgErr } = await supabase.from('oee_targets')
      .select('group_name, target_a, target_p, target_q').in('group_name', tgNames);
    if (tgErr) bad = true;   // โหลดเป้าไม่ได้ ≠ "ไม่ได้ตั้งเป้า" — ห้ามตกไปเป้ามาตรฐานเงียบๆ
    const tgBy = Object.fromEntries((tgRows || []).map(r => [r.group_name, r]));
    const tgName = tgNames.find(n => tgBy[n]) || null;
    const tg = tgName ? { ...tgBy[tgName], inheritedFrom: tgName === line ? null : tgName } : null;

    // ── OEE สดของกะเปิดวันนี้ — util กลางตัวเดียวกับ FactoryMap/OEE Analytics ──
    const ctMap = buildCtMap({ kanbanStds: kstds || [], products: prods || [] });
    const procByMat = {}; const pairMap = prods ? {} : null;   // โหลดไม่ได้ = null (ไม่ยุบ) ห้าม {} (= รู้แล้วว่าไม่มีคู่)
    (prods || []).forEach(p2 => {
      procByMat[p2.mat_no] = p2.process_type;
      if (p2.pair_mat_no) pairMap[p2.mat_no] = p2.pair_mat_no;   // งานคู่ RH/LH (แม่พิมพ์คู่/gang die)
    });
    const dtBySess = {}; dtR.rows.forEach(d2 => (dtBySess[d2.session_id] ||= []).push(d2));
    const ngBySess = {}; defR.rows.forEach(d2 => { if (isTrialDefect(d2)) return; ngBySess[d2.session_id] = (ngBySess[d2.session_id] || 0) + defectQty(d2); });
    // คนละตัวกับ ngBySess: %Q ไม่นับงานทดลอง · %P นับทุกชิ้นที่เครื่องทำออกมา (รวมทดลอง/ของสงสัย)
    const defBySess = {}; defR.rows.forEach(d2 => (defBySess[d2.session_id] ||= []).push(d2));
    const lineCfg = Object.fromEntries(lines.map(l => [l.name, l]));
    const ordBySess = {}; orders.forEach(o => (ordBySess[o.session_id] ||= []).push(o));
    const liveBySess = {};
    openToday.forEach(s => {
      liveBySess[s.id] = computeLiveOee({
        session: s, orders: ordBySess[s.id] || [], downtimes: dtBySess[s.id] || [], ctMap,
        workDate: today, nowMs: Date.now(), ngQty: ngBySess[s.id] || 0,
        ngForP: ngByMatFrom(defBySess[s.id] || [], ordBySess[s.id] || []),
        parallelN: parallelUnitsOf(lineCfg[s.line_name]),
        parallelCap: flowModeOf(lineCfg[s.line_name]?.flow_mode) === 'parallel_machine' ? parallelUnitsOf(lineCfg[s.line_name]) : 1,
        breakPolicies: breaks || [],
        processType: (ordBySess[s.id] || []).map(o => procByMat[o.mat_no]).find(Boolean) || null,
        // งานคู่ gang die / RH-LH = 1 shot ได้ 2 ชิ้น — ยุบก่อนคิดเวลามาตรฐานของ %P (pairTotals.js)
        pairMap,
      });
    });

    if (!live()) return;
    setPartial(bad);
    setData({ today, sessions, dts: dtR.rows, defs: defR.rows, ordBySess, dtBySess, ngBySess, liveBySess, target: tg || null, breaks: breaks || [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- linesKey แทน lines (ดูหมายเหตุด้านล่าง)
  }, [line, linesKey, begin]);

  /* 🔴 2026-09-15 — ผูก deps ของตัวโหลดกับ "เนื้อ" (string) ไม่ใช่ identity ของ array
     array ใบใหม่เนื้อเดิม = ตัวโหลดเปลี่ยน identity ทุก render ⇒ ยิงคิวรีซ้ำฟรีๆ
     (กฎเหล็กข้อ 9 ใน CLAUDE.md · เกิดจริงกับ StoreLotQueue 4 คิวรี × 705 ครั้ง/วัน) */
  /* 🔴 2026-09-15 — จอนี้เดิม **poll ล้วน ไม่มี realtime เลย** ทั้งที่เป็นจอ TV หน้าไลน์
     (จอที่จะติดเพิ่ม 10 จอ) ⇒ ยิงเต็มทุก 15 นาที 24 ชม. ไม่ว่ามีอะไรเปลี่ยนหรือไม่
     useLiveBoard = realtime หลัก + เพดาน coalesce + poll ข้ามรอบเมื่อไม่มี event
     ดู src/utils/useLiveBoard.js · docs/POLLING-AUDIT-2026-09-15.md */
  useLiveBoard(load, {
    tables: ['production_sessions', 'prod_orders', 'downtime_logs', 'defect_logs'],
    topic: 'line-oee-board',
  });

  /* ── คำนวณทุกอย่างจากก้อนดิบ ── */
  const C = useMemo(() => {
    if (!data) return null;
    const { today, sessions, dts, defs, ordBySess, dtBySess, ngBySess, liveBySess, target, breaks } = data;
    const kpiFrom = shiftDate(today, -(DAYS_KPI - 1));

    // planned/unplanned นาทีต่อกะ
    // นาทีที่ทับช่วงพักตามนโยบายถูกตัดออกแล้ว — ต้องเป็นชุดเดียวกับ /oee-analytics (utils/oee §3.1)
    // ไม่งั้นน้ำหนัก wLoad ของกะที่มีหยุดตามแผนคร่อมพัก เบากว่าจออื่น = ค่าเฉลี่ยคนละเลข
    const dtEffBySess = dtMinBySession(sessions, dts, breaks || [], { lines });   // หารเลนไลน์เครื่องขนาน (oee.js §3.2)
    const plannedBy = {}, unplannedBy = {};
    Object.entries(dtEffBySess).forEach(([sid, v]) => { plannedBy[sid] = v.planned; unplannedBy[sid] = v.unplanned; });

    // แถวต่อกะสำหรับ wavg — ปิดแล้วใช้ stamp · เปิดใช้ค่าสด (null = ไม่นับ ไม่ใช่ 0)
    const rowOf = (s) => {
      const lv = s.status === 'open' ? liveBySess[s.id] : null;
      const produced = s.status === 'open'
        ? (ordBySess[s.id] || []).reduce((a, o) => a + (o.status === 'confirmed' ? (Number(o.qty_ok ?? o.qty) || 0) : (Number(o.qty_actual) || 0)), 0)
        : Number(s.actual_qty) || 0;
      // ⚠️ computeLiveOee คืน key ตัวใหญ่ A/P/Q (ไม่ใช่ a/p/q)
      const aVal = s.status === 'open' ? (lv?.A ?? null) : (s.oee_a != null ? Number(s.oee_a) : null);
      return {
        work_date: s.work_date, live: s.status === 'open',
        oee: s.status === 'open' ? (lv?.oee ?? null) : (s.oee != null ? Number(s.oee) : null),
        a: aVal,
        p: s.status === 'open' ? (lv?.P ?? null) : (s.oee_p != null ? Number(s.oee_p) : null),
        q: s.status === 'open' ? (lv?.Q ?? null) : (s.oee_q != null ? Number(s.oee_q) : null),
        shift_min: Number(s.shift_min) || 570, plannedMin: plannedBy[s.id] || 0,
        unplannedMin: unplannedBy[s.id] || 0, produced, ngQty: ngBySess[s.id] || 0,
        calcA: aVal, totalQty: produced,
      };
    };
    const rows = sessions.map(rowOf);
    const kpiRows = rows.filter(r => r.work_date >= kpiFrom);

    // เทรนด์รายวัน (แกนวันต่อเนื่อง — วันไม่มีข้อมูล = null ให้กราฟเว้น ไม่ข้ามวัน)
    const trend = [];
    for (let i = DAYS_TREND - 1; i >= 0; i--) {
      const d2 = shiftDate(today, -i);
      const dayRows = rows.filter(r => r.work_date === d2);
      trend.push({ d: ddmm(d2), oee: dayRows.length ? wavg(dayRows, x => x.oee, wLoad) : null, isToday: d2 === today });
    }

    const overall = wavg(kpiRows, r => r.oee, wLoad);
    const A = wavg(kpiRows, r => r.a, wLoad);
    const P = wavg(kpiRows, r => r.p, wRun);
    const Q = wavg(kpiRows, r => r.q, wProd);
    const tgt = target ? ((Number(target.target_a) || 90) * (Number(target.target_p) || 90) * (Number(target.target_q) || 99)) / 1e4 : DEFAULT_TARGET;

    // ที่มาตัวเลข (breakdown สัปดาห์)
    const loadMin = kpiRows.reduce((a, r) => a + Math.max(0, r.shift_min - r.plannedMin), 0);
    const unplMin = kpiRows.reduce((a, r) => a + r.unplannedMin, 0);
    const plMin = kpiRows.reduce((a, r) => a + r.plannedMin, 0);
    const runMin = Math.max(0, loadMin - unplMin);
    const produced = kpiRows.reduce((a, r) => a + r.produced, 0);
    const ngTotal = kpiRows.reduce((a, r) => a + r.ngQty, 0);

    // Pareto (หน้าต่างสัปดาห์เดียวกับ KPI)
    const kpiSessIds = new Set(sessions.filter(s => s.work_date >= kpiFrom).map(s => s.id));
    /* พจนานุกรมเดาประเภทจากคำ — สร้างจากชื่อประเภทที่อยู่ในชุดนี้เอง ไม่ยิงคิวรีเพิ่ม */
    const dtIdx = buildDtIndex(dts);
    const dtTop = {}, defTop = {};
    dts.forEach(d2 => {
      if (!kpiSessIds.has(d2.session_id) || d2.dr_downtime_types?.category === 'planned') return; // Pareto นับเฉพาะนอกแผน
      /* 🗑️ ถังขยะ "อื่นๆ / Alarm ไม่ระบุสาเหตุ" ต้องแตกตามเครื่อง (utils/downtimeCategory 23/09)
         ไม่งั้นแท่งเดียวกินนาทีจากหลายเครื่องรวมกัน — ช่างอ่านแล้วไปไล่ต่อไม่ได้ */
      const k = dtBucketName(d2, dtIdx);
      dtTop[k] = (dtTop[k] || 0) + (Number(d2.duration_min) || 0);
    });
    defs.forEach(d2 => {
      if (!kpiSessIds.has(d2.session_id)) return;
      const k = (d2.dr_defect_types?.name_th || 'ไม่ระบุประเภท') + (isTrialDefect(d2) ? ' 🧪' : '');
      defTop[k] = (defTop[k] || 0) + (Number(d2.qty_ng) || 0) + (Number(d2.qty_suspect) || 0); // ลิสต์ของเสียโชว์ทุกรายการรวมงานทดลอง (ตัดเฉพาะ %Q)
    });
    const top6 = (o) => Object.entries(o).map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v).slice(0, 6);

    // Alarm history — ล่าสุดก่อน · active (นอกแผน) = กระพริบ
    const history = [...dts].filter(d2 => kpiSessIds.has(d2.session_id))
      .sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || ''))).slice(0, 8);

    // สถานะปัจจุบัน (footer)
    const openNow = sessions.filter(s => s.status === 'open' && s.work_date === today);
    const activeDt = dts.filter(d2 => openNow.some(s => s.id === d2.session_id) && isOpenDT(d2) && !isPlannedDT(d2));
    const liveNow = openNow.length ? liveBySess[openNow[0].id] : null;

    return {
      trend, overall, A, P, Q, tgt, variance: overall != null ? +(overall - tgt).toFixed(1) : null,
      loadMin, runMin, unplMin, plMin, produced, ngTotal,
      dtTop6: top6(dtTop), defTop6: top6(defTop), history,
      dtTrash: dtTrashStats(dts.filter(d2 => kpiSessIds.has(d2.session_id) && d2.dr_downtime_types?.category !== 'planned'), { index: dtIdx }),
      hasOpen: !!openNow.length, activeDt, liveNow, kpiN: kpiRows.length,
      liveInWindow: kpiRows.some(r => r.live && r.oee != null),
    };
  }, [data]);

  /* ── สไตล์ (จอ TV — ฟอนต์ ≥ 11px ตาม convention) ── */
  const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: tv ? '12px 20px' : '12px 16px',
    ...(tv ? { display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 } : {}) };
  const capSt = { fontSize: T(11.5, 22), fontWeight: 800, color: 'var(--muted)', letterSpacing: 0.5, textTransform: 'uppercase' };
  const tdPad = tv ? '6px 6px' : '3px 6px';
  const cellClip = tv ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {};
  // จอประชุม: แถวเรียงแนวนอนไม่ wrap · สูงตามสัดส่วนจอ (minHeight 0 = ยอมหดให้พอดีจอ)
  const rowSt = (grow) => (tv ? { display: 'flex', gap: 12, flexWrap: 'nowrap', flex: grow ? `${grow} 1 0` : '0 0 auto', minHeight: 0 } : { display: 'flex', gap: 12, flexWrap: 'wrap' });
  const rowKV = (k, v, color) => (
    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: T(12, 22), lineHeight: tv ? 1.45 : 1.75 }}>
      <span style={{ color: 'var(--muted)' }}>{k}</span><b style={{ color: color || 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{v}</b>
    </div>
  );
  /* kvs = [ป้าย, ค่า, สี, keepOnTv] — จอประชุมโชว์เฉพาะแถวที่ติด keepOnTv (2 แถวที่ตอบ "ทำไม" ได้) */
  const apqCard = (label, badge, val, color, kvs) => (
    <div style={{ ...card, flex: 1, minWidth: tv ? 0 : 250, borderTop: `3px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: tv ? 12 : 8 }}>
        <span style={{ width: T(26, 44), height: T(26, 44), borderRadius: '50%', background: `${color}22`, border: `2px solid ${color}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: T(12.5, 24), fontWeight: 900, color, flexShrink: 0 }}>{badge}</span>
        <span style={{ fontSize: T(13, 26), fontWeight: 800, color: 'var(--text)' }}>{label}</span>
        <span style={{ marginLeft: 'auto', fontSize: T(26, 60), fontWeight: 900, color, fontVariantNumeric: 'tabular-nums', ...(tv ? { lineHeight: 1.1 } : {}) }}>{val == null ? '—' : `${val.toFixed(1)}%`}</span>
      </div>
      <div style={{ marginTop: 6, borderTop: '1px dashed var(--border2)', paddingTop: 6 }}>
        {kvs.filter(r => !tv || r[3]).map(([k, v, c2]) => rowKV(k, v, c2))}
      </div>
    </div>
  );
  /* tvNote = ข้อความสั้นแทน unit บนจอประชุม (เฉพาะเรื่องที่ต้องรู้ เช่น ใบไม่ระบุสาเหตุ) · null = ไม่แสดง */
  const barChart = (title, items, color, unit, tvNote = null) => (
    <div style={{ ...card, flex: 1, minWidth: tv ? 0 : 300 }}>
      <div style={capSt}>{title}</div>
      {!items.length ? <div style={{ fontSize: T(12.5, 24), color: 'var(--muted)', padding: '26px 0', textAlign: 'center' }}>ไม่มีข้อมูลในช่วง {DAYS_KPI} วัน</div> : tv ? (
        /* จอประชุม = แท่งนอน: ชื่อรายการอยู่ซ้ายเต็มคำ (แท่งตั้งเอียงป้าย = ตัดเหลือ "เครื่อง …" อ่านไม่ออก) */
        <div style={{ flex: 1, minHeight: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={items} layout="vertical" margin={{ top: 4, left: 0, right: 64, bottom: 4 }} barCategoryGap="18%">
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={290} interval={0} tickLine={false} axisLine={false}
                tick={{ fontSize: 20, fill: 'var(--text)', fontWeight: 700 }}
                tickFormatter={n => n.length > 21 ? n.slice(0, 20) + '…' : n} />
              <Bar dataKey="v" fill={CELL_BAR_FILL} radius={[0, 5, 5, 0]} isAnimationActive={false}>
                <LabelList dataKey="v" position="right" style={{ fontSize: 22, fontWeight: 900, fill: 'var(--text)' }} />
                {items.map((_, i) => <Cell key={i} fill={color} fillOpacity={1 - i * 0.11} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={190}>
          <BarChart data={items} margin={{ top: 20, left: 0, right: 6, bottom: 4 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text2)' }} interval={0}
              tickFormatter={n => n.length > 9 ? n.slice(0, 8) + '…' : n} angle={-25} height={48} textAnchor="end" />
            <YAxis hide />
            <Bar dataKey="v" fill={CELL_BAR_FILL} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="v" position="top" style={{ fontSize: 11, fontWeight: 800, fill: 'var(--text)' }} />
              {items.map((_, i) => <Cell key={i} fill={color} fillOpacity={1 - i * 0.11} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      {!tv ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>{unit}</div>
        : tvNote && <div style={{ fontSize: 20, fontWeight: 700, color: '#f59e0b' }}>{tvNote}</div>}
    </div>
  );

  const varUp = C?.variance != null && C.variance >= 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 2px',
      ...(tv ? { height: 'calc(100vh - var(--tvbar-h, 0px) - 24px)', boxSizing: 'border-box', overflow: 'hidden' } : {}) }}>
      {/* header — ไม่ใช้ PageHeader (บอร์ดจอ TV — ข้อยกเว้นเดียวกับ Dashboard/Management)
          ph-chrome = กรอบจอ TV ซ่อน (แถบบนของกรอบโชว์ไลน์ที่ตั้งจากลิงก์ + นาฬิกาแทน · index.css) */}
      <div className="ph-chrome" style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 16px' }}>
        <span style={{ fontSize: 17, fontWeight: 900, color: 'var(--text)' }}>📟 OEE รายไลน์ (Weekly)</span>
        {/* picker กลาง (UI §5.1.2) — ลำดับชั้นแม่→ลูกครบ · width กัน index.css select width:100% */}
        <LineSelect lines={boardLines} value={line} onChange={setLine} placeholder={null}
          role={role} lineId={lineId} sections={sections}
          style={{ width: 250, padding: '6px 10px', fontSize: 14, fontWeight: 700, borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)' }} />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>หน้าต่าง {DAYS_KPI} วันล่าสุด{C?.liveInWindow ? ' · รวมกะที่กำลังเปิด (สด)' : ''}</span>
        <span style={{ marginLeft: 'auto', fontSize: 20, fontWeight: 900, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
          {now.toLocaleTimeString('th-TH', { hour12: false })}
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', marginLeft: 8 }}>{now.toLocaleDateString('th-TH')}</span>
        </span>
      </div>

      {partial && (
        <div style={{ ...card, borderColor: '#f59e0b', color: '#f59e0b', fontSize: T(12.5, 22), padding: '8px 14px', flex: tv ? '0 0 auto' : undefined }}>
          {tv ? '⚠ โหลดข้อมูลได้ไม่ครบ — ตัวเลขอาจต่ำกว่าจริง' : '⚠ โหลดข้อมูลได้ไม่ครบ — ตัวเลขบางส่วนอาจต่ำกว่าจริง (ลองรีเฟรช/เช็คเครือข่าย)'}
        </div>
      )}

      {!C ? (
        <div style={{ ...card, textAlign: 'center', color: 'var(--muted)', padding: 40, fontSize: tv ? 26 : undefined }}>กำลังโหลดข้อมูล...</div>
      ) : (
        <>
          {/* แถว 1: Overall + เทรนด์ */}
          <div style={rowSt(1.15)}>
            <div style={{ ...card, flex: tv ? '0 0 380px' : '0 0 250px', display: 'flex', flexDirection: 'column' }}>
              <div style={capSt}>Overall OEE ({DAYS_KPI} วัน)</div>
              <div style={{ fontSize: tv ? 108 : 'clamp(44px,4.5vw,62px)', fontWeight: 900, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums',
                color: C.overall == null ? 'var(--muted)' : C.overall >= C.tgt ? '#22c55e' : C.overall >= C.tgt - 10 ? '#f59e0b' : '#ef4444' }}>
                {C.overall == null ? '—' : `${C.overall.toFixed(1)}%`}
              </div>
              {C.overall == null && <div style={{ fontSize: T(12, 22), color: 'var(--muted)' }}>{tv ? 'ยังไม่มีข้อมูลในช่วงนี้' : 'ยังไม่มีกะปิด/ข้อมูลสดในช่วงนี้'}</div>}
              <div style={{ display: 'flex', gap: 18, marginTop: 'auto', paddingTop: 8, borderTop: '1px dashed var(--border2)' }}>
                <div><div style={capSt}>Target</div><b style={{ fontSize: T(18, 36), color: '#f59e0b', whiteSpace: 'nowrap' }}>{C.tgt.toFixed(1)}%{tv && !data?.target && <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--muted)' }}> มาตรฐาน</span>}</b></div>
                <div><div style={capSt}>Variance</div>
                  <b style={{ fontSize: T(18, 36), color: C.variance == null ? 'var(--muted)' : varUp ? '#22c55e' : '#ef4444' }}>
                    {C.variance == null ? '—' : `${varUp ? '▲ +' : '▼ '}${C.variance}`}</b>
                </div>
              </div>
              {/* จอประชุม: บอกในป้าย Target แทน (บรรทัดแยกล้นการ์ด) */}
              {!data?.target && !tv && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>เป้ามาตรฐาน (ยังไม่ตั้ง 🎯 ที่ /oee-analytics)</div>}
              {data?.target?.inheritedFrom && !tv && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  ใช้เป้าของกรุ๊ป <b style={{ color: 'var(--text2)' }}>{data.target.inheritedFrom}</b> (ไลน์นี้ยังไม่ตั้งเป้าของตัวเอง)
                </div>
              )}
            </div>
            {/* ⚠️ 2026-08-25 บั๊กที่ user ทัก "ปัจจุบันล่ะ มีแต่ย้อนหลัง 7 วันหรอ" — สถานะสดเดิมมีอยู่
                แค่ซ่อนอยู่แถบเล็กท้ายจอ ตัวเลขใหญ่สุดบนจอ (72.0%) คือค่าเฉลี่ย 7 วัน ไม่ใช่ตอนนี้
                → เพิ่มการ์ด "ตอนนี้ (Live)" ให้เห็นคู่กันชัดๆ ตั้งแต่แถวบนสุด (แถบท้ายจอเดิมยังอยู่
                เป็นรายละเอียด/เหตุผลกำกับ) — ที่มาข้อมูลเหมือนเดิมทุกอย่าง (C.activeDt/C.hasOpen/C.liveNow) */}
            <div style={{ ...card, flex: tv ? '0 0 330px' : '0 0 220px', display: 'flex', flexDirection: 'column' }}>
              <div style={capSt}>ตอนนี้ (Live)</div>
              {C.activeDt.length ? (
                <>
                  <div style={{ fontSize: tv ? 72 : 'clamp(30px,3vw,40px)', fontWeight: 900, lineHeight: 1.15, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="dt-alarm-icon">🔴</span> หยุด
                  </div>
                  <div style={{ fontSize: T(11.5, 22), color: tv ? 'var(--text2)' : 'var(--muted)', marginTop: 4 }}>
                    {C.activeDt.map(d2 => d2.dr_downtime_types?.name_th || 'ไม่ระบุ').join(' · ')}
                  </div>
                </>
              ) : C.hasOpen ? (
                <>
                  <div style={{ fontSize: tv ? 96 : 'clamp(36px,3.8vw,50px)', fontWeight: 900, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums',
                    color: C.liveNow?.oee == null ? 'var(--muted)' : '#22c55e' }}>
                    {C.liveNow?.oee != null ? `${Math.round(C.liveNow.oee)}%` : '—'}
                  </div>
                  <div style={{ fontSize: T(11.5, 22), color: tv ? 'var(--text2)' : 'var(--muted)', marginTop: 4 }}>
                    {C.liveNow?.oee != null ? '🟢 กำลังผลิต · OEE กะนี้' : C.liveNow?.noCt ? '⚠ ยังไม่ตั้ง CT — คำนวณไม่ได้' : '🟢 กำลังผลิต · ยังประเมินไม่ได้'}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: tv ? 72 : 'clamp(30px,3vw,40px)', fontWeight: 900, color: 'var(--muted)' }}>⏸</div>
                  <div style={{ fontSize: T(11.5, 26), color: tv ? 'var(--text2)' : 'var(--muted)', marginTop: 4 }}>ยังไม่เปิดกะ</div>
                </>
              )}
            </div>
            <div style={{ ...card, flex: 1, minWidth: tv ? 0 : 'min(380px, 100%)' }}>
              <div style={capSt}>{tv ? `OEE Trend รายวัน (${DAYS_TREND} วัน)` : `OEE Trend รายวัน (${DAYS_TREND} วัน · เฉลี่ยถ่วงเวลารับภาระ)`}</div>
              <div style={tv ? { flex: 1, minHeight: 0 } : undefined}>
              <ResponsiveContainer width="100%" height={tv ? '100%' : 168}>
                <AreaChart data={C.trend} margin={{ top: 8, left: 4, right: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="oeeG" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.55} /><stop offset="100%" stopColor="#2dd4bf" stopOpacity={0.06} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="d" tick={{ fontSize: T(11, 20), fill: 'var(--text2)' }} {...(tv ? { interval: 1, padding: { left: 32, right: 24 } } : {})} />
                  <YAxis width="auto" domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fontSize: T(11, 20), fill: 'var(--text2)' }} tickFormatter={v => `${v}%`} />
                  <ReferenceLine y={C.tgt} stroke="#f59e0b" strokeDasharray="6 4"
                    label={{ value: `target ${C.tgt.toFixed(0)}%`, position: 'insideTopRight', fill: '#f59e0b', fontSize: T(11, 22), fontWeight: 800 }} />
                  <Area type="monotone" dataKey="oee" stroke="#2dd4bf" strokeWidth={tv ? 4 : 2.2} fill="url(#oeeG)" connectNulls={false} isAnimationActive={false} dot={{ r: tv ? 5 : 2.5 }} />
                </AreaChart>
              </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* แถว 2: A / P / Q + ที่มาตัวเลข (กางให้เห็นตามกฎ "ตัวเลขต้องกางที่มา") */}
          <div style={rowSt(0)}>
            {apqCard('Availability', 'A', C.A, '#22c55e', [
              ['เวลารับภาระ (กะ − หยุดในแผน)', `${hrs(C.loadMin)} ชม.`],
              ['เวลาเดินเครื่อง', `${hrs(C.runMin)} ชม.`, undefined, true],
              ['หยุดนอกแผน', `${hrs(C.unplMin)} ชม.`, C.unplMin > 0 ? '#ef4444' : undefined, true],
              ['หยุดตามแผน/พัก', `${hrs(C.plMin)} ชม.`],
            ])}
            {apqCard('Performance', 'P', C.P, '#4d9fff', [
              ['ผลิตจริง', `${nf(C.produced)} ชิ้น`, undefined, true],
              ['อัตราจริง', C.runMin > 0 ? `${nf(C.produced / (C.runMin / 60), 1)} ชิ้น/ชม.` : '—', undefined, true],
              ['เทียบมาตรฐาน (CT)', C.P == null ? 'ยังคำนวณไม่ได้' : `${C.P.toFixed(1)}% ของความเร็วมาตรฐาน`],
            ])}
            {apqCard('Quality', 'Q', C.Q, '#a855f7', [
              ['ผลิตทั้งหมด (ดี+เสีย)', `${nf(C.produced + C.ngTotal)} ชิ้น`],
              ['ของดี (ยอดสแกน)', `${nf(C.produced)} ชิ้น`, undefined, true],
              ['ของเสีย (ไม่รวมงานทดลอง)', `${nf(C.ngTotal)} ชิ้น`, C.ngTotal > 0 ? '#ef4444' : undefined, true],
            ])}
          </div>

          {/* แถว 3: Pareto + Alarm history */}
          <div style={rowSt(1.5)}>
            {barChart(`Alarm Top 6 (นาที · ${DAYS_KPI} วัน)`, C.dtTop6, '#f97316',
                      `เฉพาะหยุดนอกแผน — หยุดตามแผนไม่ใช่ loss${C.dtTrash?.vague
                        ? ` · 🗑️ ไม่ได้ระบุสาเหตุ ${C.dtTrash.vague} ใบ (${
                          C.dtTrash.guessed ? `🔎 เดาจากคำ ${C.dtTrash.guessed} · ` : ''}แตกตามเครื่อง${
                          C.dtTrash.noMachine ? ` · ${C.dtTrash.noMachine} ใบไม่กรอกเครื่อง = ชี้เป้าไม่ได้` : ''})` : ''}`,
                      // จอประชุม: เก็บแค่เรื่องที่ทำให้แท่งเชื่อไม่ได้ (ใบไม่ระบุสาเหตุ) — ห้ามหายเงียบ
                      C.dtTrash?.vague ? `🗑️ ไม่ระบุสาเหตุ ${C.dtTrash.vague} ใบ` : null)}
            {barChart(`Defect Top 6 (ชิ้น · ${DAYS_KPI} วัน)`, C.defTop6, '#ef4444', 'รวมทุกรายการ (🧪 = งานทดลอง ไม่ถูกนับใน %Q)')}
            <div style={{ ...card, flex: 1.2, minWidth: tv ? 0 : 340, ...(tv ? { overflow: 'hidden' } : {}) }}>
              <div style={capSt}>Alarm History (ล่าสุด)</div>
              {!C.history.length ? <div style={{ fontSize: T(12.5, 24), color: 'var(--muted)', padding: '26px 0', textAlign: 'center' }}>ไม่มีรายการหยุดในช่วงนี้</div> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4, ...(tv ? { tableLayout: 'fixed' } : {}) }}>
                  {tv && <colgroup><col style={{ width: '22%' }} /><col /><col style={{ width: '16%' }} /><col style={{ width: '11%' }} /><col style={{ width: '20%' }} /></colgroup>}
                  <thead><tr>{['เวลา', 'รายการ', 'เครื่อง', 'นาที', 'สถานะ'].map(h => (
                    <th key={h} style={{ fontSize: T(11, 20), color: 'var(--muted)', textAlign: 'left', padding: tv ? '4px 6px' : '3px 6px', borderBottom: '1px solid var(--border2)' }}>{h}</th>))}
                  </tr></thead>
                  {/* จอประชุม: 5 แถวล่าสุด ตัวใหญ่ · ตัดคำอธิบายย่อย (คนยืนห่าง 2–3 ม. อ่านไม่ทัน) */}
                  <tbody>{(tv ? C.history.slice(0, 5) : C.history).map(d2 => {
                    const active = isOpenDT(d2), planned = isPlannedDT(d2);
                    return (
                      <tr key={d2.id} className={active && !planned ? 'dt-alarm-blink' : undefined}>
                        <td style={{ fontSize: T(11.5, 20), color: 'var(--text2)', padding: tdPad, whiteSpace: 'nowrap', ...cellClip }}>
                          {d2.started_at ? (tv
                            ? new Date(d2.started_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false })
                            : new Date(d2.started_at).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })) : '—'}
                        </td>
                        <td style={{ fontSize: T(11.5, 20), color: 'var(--text)', padding: tdPad, ...cellClip }}>
                          {d2.dr_downtime_types?.name_th || '—'}{d2.description && !tv ? <span style={{ color: 'var(--muted)' }}> · {d2.description}</span> : ''}
                        </td>
                        <td style={{ fontSize: T(11.5, 20), color: 'var(--text2)', padding: tdPad, ...cellClip }}>{d2.machine_no || '—'}</td>
                        <td style={{ fontSize: T(11.5, 20), color: 'var(--text2)', padding: tdPad, fontVariantNumeric: 'tabular-nums' }}>{d2.duration_min ?? '—'}</td>
                        <td style={{ fontSize: T(11.5, 20), padding: tdPad, whiteSpace: 'nowrap', ...cellClip }}>
                          {/* ⚠️ 2026-08-25 บั๊กที่ user จับได้: shake ทั้งคำ "🔴 Active" (ไม่ใช่แค่ไอคอน) ดูรก/แปลก
                              — .dt-alarm-icon ทุกจุดอื่นในระบบ (FactoryMap/Dashboard/DailyPM) ใช้กับ "ไอคอนตัวเดียว"
                              เท่านั้น จุดนี้ผิดเงื่อนไขเดิม + คำว่า Active ก็ไม่เข้าพวกกับศัพท์ไทยที่เหลือในตาราง
                              (คู่กับ "✓ กลับมาแล้ว") → แยกไอคอนออกมา shake เดี่ยว ข้อความเป็นภาษาไทยล้วน */}
                          {active
                            ? <b style={{ color: planned ? 'var(--muted)' : '#ef4444' }}>
                                {planned ? '🗓️ ตามแผน' : <><span className="dt-alarm-icon">🔴</span> ยังหยุดอยู่</>}
                              </b>
                            : <span style={{ color: '#22c55e' }}>{tv ? '✓ กลับมา' : '✓ กลับมาแล้ว'}</span>}
                          {d2.call_mtn && <span style={{ color: '#f59e0b' }}> 📞</span>}
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              )}
            </div>
          </div>

          {/* footer สถานะปัจจุบัน — กระพริบเฉพาะแดง (DT นอกแผนค้าง) ตาม Andon */}
          <div style={{ ...card, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 14, padding: '8px 16px', flex: tv ? '0 0 auto' : undefined }}>
            {C.activeDt.length ? (
              // shake เฉพาะไอคอน 🔴 — ห้าม shake ทั้งประโยค (กฎเดียวกับที่แก้ในตาราง Alarm History ข้างบน)
              <b style={{ color: '#ef4444', fontSize: T(14, 28) }}>
                <span className="dt-alarm-icon">🔴</span> {line} หยุดอยู่: {C.activeDt.map(d2 => d2.dr_downtime_types?.name_th || 'ไม่ระบุ').join(' · ')}
              </b>
            ) : C.hasOpen ? (
              <b style={{ color: '#22c55e', fontSize: T(14, 28) }}>▶ {line} กำลังผลิต{C.liveNow?.oee != null ? ` · OEE กะนี้ (สด) ${Math.round(C.liveNow.oee)}%` : C.liveNow?.noCt ? ' · ⚠ ยังไม่ตั้ง CT — คำนวณ P ไม่ได้' : ''}</b>
            ) : (
              <b style={{ color: 'var(--muted)', fontSize: T(14, 28) }}>⏸ {line} ยังไม่เปิดกะ</b>
            )}
            <span className="tv-hide" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>
              จาก {C.kpiN} กะ · สูตรชุดเดียวกับ Daily Report/OEE Analytics · อัพเดตทุก {Math.round(RATE.BOARD / 60000)} นาที
            </span>
          </div>
        </>
      )}
    </div>
  );
}
