import { useState, useMemo } from 'react';
import useIsMobile from '../utils/useIsMobile';
import { FRAME_START, frameMin, breaksToFrame } from '../utils/timeFrame';
import { getRoundStatus, roundDeliveryMin, addMinutes } from '../utils/deliveryRounds';
import { forecastRunout, byUrgency, RUNOUT_REASON } from '../utils/wipRunout';

/* ═══ 🕐 Store Time Chart — สโตร์เตรียมของส่งเข้าไลน์ (2xx/3xx/5xx) ═══════════
   ที่มา (user 2026-08-26): "รอบการส่งของจาก Warehouse ไปลูกค้า ดูเข้าใจง่าย ชัดเจนที่สุด
   แต่ที่เหลือ ระหว่างสโตร์ 2xx,3xx,5xx ไปเข้าไลน์ผลิต ดูยาก ดูไม่ออก อยากให้ทำออกมาให้ได้แบบนี้
   สำหรับ workflow ที่เห็นความต้องการจากส่วนผลิต แตก BOM และต้องเตรียมของไปส่ง"

   ⇒ จอนี้คือ **ฝาแฝดของ Shipping Time Chart (`/customer-demand`) แต่เป็นขาเข้าไลน์**
      โครงเดียวกันเป๊ะ: แถบสรุป → ชาร์ต 24 ชม. → ชิปกรอง → การ์ดรายรอบ + walkback
      ต่างกันแค่ "ปลายทาง": ลูกค้า → **ไลน์ผลิต** · order → **รอบจัดส่งคัมบัง**

   ⚠️⚠️ จอนี้มี **2 โหมด** ไม่ใช่โหมดเดียว (user เคาะ 2026-08-27):
   • ไลน์ที่มีรอบ `is_active` → **กำหนดรอบ** = ชาร์ต 24 ชม. + walkback + การ์ดรายรอบ
   • ไลน์ที่ไม่มีรอบ        → **ส่งตามคำขอ** = คิวงาน "เห็นความต้องการ → เรียง → ส่งเลย"
   **"ไม่มีรอบ" ไม่ใช่ของขาด ห้ามเขียนว่า "ยังไม่ตั้งรอบ → ไปตั้ง"** — ทีมสโตร์เลือกไม่เดินเป็นรอบเอง
   (เดิมจอไล่ให้ไปตั้งรอบทุกไลน์ ทั้งที่พักรอบทั้งหมดไปแล้วโดยตั้งใจ · docs/STORE-PULL-LOOP-DESIGN.md §6.1)

   ⚠️ กฎที่ยกมาจากฝั่ง Delivery ห้ามทิ้ง:
   • กรอบวันงาน 08:00 → 08:00 เสมอ (`FRAME_START`) — รอบกะดึกข้ามเที่ยงคืนต้องอยู่แถวเดียวกัน
   • **แดง = สิ่งที่ "คนพลาด" เท่านั้น** — ตัดยอด/เริ่มจัดของ เป็นหมุดเวลา ไม่ใช่ด่านที่คนต้องกด
     ทำแดงด้วยจะกลายเป็นจอที่แดงตลอดเวลาแล้วไม่มีใครเชื่อ (บทเรียนจาก shipping_phase_alert
     ที่เตือนเฟสที่ทีมไม่ได้ใช้ 66-224 ครั้ง/วัน จนถูกปิด)
   • **"ไม่รู้" ≠ "ไม่มี"** — พาร์ทที่ไม่มีแถวใน `line_stock_summary` ของ STORE = ยังไม่เคยตั้งสต็อก
     ต้องแยกจาก "มีแต่ไม่พอ" ห้ามขึ้น 🚨 เหมือนกัน (คนจะสั่งผลิตซ้ำโดยไม่จำเป็น)
   ═══════════════════════════════════════════════════════════════════════════ */

const SPAN_MIN = 40;   // ระยะที่ถือว่า "ชนกัน" → แยกเลน (เท่าฝั่ง shipping)
const LANE_H   = 28;

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12 };
const chip = (bg, color, extra) => ({
  fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 8,
  background: bg, color, whiteSpace: 'nowrap', ...extra,
});

const hhmm = (t) => (t || '—').slice(0, 5);
const fmtMin = (m) => {
  if (m == null) return '—';
  const x = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};

export default function StoreTimeChart({
  rounds, deliveries, view, storeStock, kanbanStd, lineMap, workDate, breakPolicies, nowMs,
  fmt, canOperate, onConfirm, confirming, onReceive, onOpenLine,
}) {
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed]   = useState({});
  const [popup, setPopup]           = useState(null);
  const [cardFilter, setCardFilter] = useState('todo');
  const [sortMode, setSortMode]     = useState('urgent');
  const [highlightId, setHighlightId] = useState(null);
  const [expanded, setExpanded]     = useState(null);
  const [qOpen, setQOpen]           = useState({});   // กางรายการพาร์ทของคิวส่งตามคำขอ
  /* 📥 มอง WIP ที่ไลน์ = 0 สำหรับพาร์ทที่ยังไม่ได้ตั้งยอด (user 2026-09-01)
     default = เปิด เพราะสภาพจริงคือพาร์ทส่วนใหญ่ยังไม่มีแถวสต็อกที่ไลน์
     → ปิดไว้ = สโตร์เปิดจอมาแล้วไม่เห็นความต้องการอะไรเลย (ปัญหาที่ทำให้ต้องมีโหมดนี้)
     ⚠️ เปิดแล้ว **ต้องมีแถบบอกและป้ายรายแถวเสมอ** ห้ามให้ตัวเลข gross ดูเหมือนยอดที่หักแล้ว */
  const [assumeWip0, setAssumeWip0]  = useState(() => {
    try { return localStorage.getItem('esm_store_assume_wip0') !== 'off'; } catch { return true; }
  });
  const toggleAssume = () => setAssumeWip0(v => {
    const n = !v;
    try { localStorage.setItem('esm_store_assume_wip0', n ? 'on' : 'off'); } catch { /* โหมดส่วนตัวจำไม่ได้ก็ไม่เป็นไร */ }
    return n;
  });

  const { roundAlloc, groupDemand } = view;
  const leftW = isMobile ? 96 : 150;
  const tStart = FRAME_START, span = 1440;
  const hourMarks = Array.from({ length: 25 }, (_, i) => FRAME_START + i * 60);
  const breakBands = breaksToFrame(breakPolicies);

  // เวลาปัจจุบันบนกรอบวันงาน (นาที) — วันอื่นไม่ต้องมีเส้น now
  const nowD = new Date(nowMs);
  const nowW = frameMin(`${String(nowD.getHours()).padStart(2, '0')}:${String(nowD.getMinutes()).padStart(2, '0')}`);
  const todayFrame = (() => {
    const d = new Date(nowMs);
    if (d.getHours() < 8) d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const isToday = workDate === todayFrame;

  const confirmedSet = useMemo(() => {
    const s = new Set();
    deliveries.forEach(d => s.add(`${d.line_name}|${d.shift}|${d.round_no}`));
    return s;
  }, [deliveries]);
  const receivedMap = useMemo(() => {
    const m = {};
    deliveries.forEach(d => { m[`${d.line_name}|${d.shift}|${d.round_no}`] = d; });
    return m;
  }, [deliveries]);
  const keyOf = (r) => `${r.line_name}|${r.shift}|${r.round_no}`;

  /* ── แถวชาร์ต = กลุ่มไลน์ที่ **เดินเป็นรอบ** (ไลน์ลูกรวมใต้ไลน์แม่) ──────────
     ⚠️ ไลน์ที่ไม่มีรอบ **ไม่เข้าชาร์ต** — ไปอยู่คิว "ส่งตามคำขอ" ด้านล่างแทน
        (เดิมยัดเข้าชาร์ตเป็นแถวว่างพร้อมข้อความ "ยังไม่ตั้งรอบ" = ไลน์เดียวโผล่ 2 ที่
         ด้วยคำอธิบายที่ขัดกันเอง) — แต่ยังต้องเห็นเสมอ ห้ามหายเงียบ */
  const byLine = useMemo(() => {
    const m = {};
    rounds.forEach(r => {
      const g = lineMap?.[r.line_name]?.parent_line_name || r.line_name;
      (m[g] = m[g] || []).push(r);
    });
    Object.values(m).forEach(list => list.sort((a, b) => (frameMin(a.delivery_time) ?? 9e9) - (frameMin(b.delivery_time) ?? 9e9)));
    return m;
  }, [rounds, lineMap]);

  /* ── ของในสโตร์พอไหม — จัดสรรแบบ FIFO ตามเวลาส่ง (รอบแรกได้ของก่อน) ────────
     กระจกบานเดียวกับ `coverage` ฝั่ง Delivery: pool ต่อ mat แชร์กันทุกรอบทั้งวัน
     ⚠️ mat ที่ไม่มีแถวสต็อกใน STORE เลย = **ไม่รู้** (untracked) ห้ามนับเป็น "ขาด" */
  const coverage = useMemo(() => {
    const remain = { ...(storeStock || {}) };
    const map = {};
    const all = rounds.slice().sort((a, b) => (frameMin(a.delivery_time) ?? 9e9) - (frameMin(b.delivery_time) ?? 9e9));
    all.forEach(r => {
      const parts = (roundAlloc?.[r.id]?.parts || []).filter(p => p.netTotal > 0);
      let short = 0, shortMats = 0, untracked = 0, covered = 0;
      parts.forEach(p => {
        if (!(p.mat_no in (storeStock || {}))) { untracked++; return; }
        const avail = remain[p.mat_no] || 0;
        const use = Math.min(avail, p.netTotal);
        remain[p.mat_no] = avail - use;
        covered += use;
        const miss = p.netTotal - use;
        if (miss > 0) { short += miss; shortMats++; }
      });
      map[r.id] = { short, shortMats, untracked, covered, need: parts.length };
    });
    return map;
  }, [rounds, roundAlloc, storeStock]);

  /* ── walkback ของรอบส่งเข้าไลน์ ─────────────────────────────────────────────
     4 หมุด แต่มีแค่ 2 ที่เป็น "ด่านที่คนต้องกด" (gate) — อีก 2 เป็นหมุดเวลาเฉยๆ
     ห้ามทำหมุดเวลาให้เป็นสีแดง (ดูกฎหัวไฟล์) */
  const phaseList = (r) => {
    const dl = frameMin(r.delivery_time);
    if (dl == null) return [];
    const prep = Number(r.prep_minutes) || 60;
    const cut = frameMin(r.cutoff_time);
    const fin = dl + roundDeliveryMin(r);
    const k = keyOf(r);
    const isConf = confirmedSet.has(k);
    const isRecv = !!receivedMap[k]?.received_status;
    const past = (m) => isToday ? nowW > m : workDate < todayFrame;
    return [
      { key: 'cut',  icon: '✂️', label: 'ตัดยอดความต้องการ', at: cut ?? dl, gate: false, done: past(cut ?? dl) },
      { key: 'prep', icon: '📦', label: 'เริ่มจัดของในสโตร์', at: dl - prep, gate: false, done: past(dl - prep) },
      { key: 'ship', icon: '🚚', label: 'ส่งออกจากสโตร์',    at: dl,        gate: true,  done: isConf },
      { key: 'recv', icon: '✅', label: 'ไลน์รับของครบ',      at: fin,       gate: true,  done: isRecv },
    ].map(p => ({ ...p, missed: p.gate && !p.done && past(p.at) }));
  };
  const phaseLate = (r) => phaseList(r).some(p => p.missed);

  /* ── ตัวนับสรุป (ต้องตรงกับชิปกรองด้านล่างเป๊ะ) ── */
  const statusOf = (r) => getRoundStatus(r, confirmedSet, receivedMap, workDate, nowMs);
  const isDone     = (r) => !!receivedMap[keyOf(r)]?.received_status;
  const isOverdue  = (r) => statusOf(r).label === '🔴 ค้างส่ง';
  const doneN      = rounds.filter(isDone).length;
  const overdueN   = rounds.filter(isOverdue).length;
  const shortN     = rounds.filter(r => !isDone(r) && (coverage[r.id]?.short || 0) > 0).length;
  const untrackedN = rounds.filter(r => !isDone(r) && (coverage[r.id]?.untracked || 0) > 0).length;
  /* ── 2 โหมด: มีรอบ active = กำหนดรอบ · ไม่มีรอบ = ส่งตามคำขอ ───────────────
     ⚠️ "ไม่มีรอบ" **ไม่ใช่ของขาด** — เป็นโหมดที่ทีมเลือก (docs/STORE-PULL-LOOP-DESIGN.md §6.1)
     ทีมสโตร์ไม่ได้ทำงานเป็นรอบ: เห็นใครเบิกก่อนก็จัดของไปส่งก่อน
     ⇒ ห้ามให้จอเขียนว่า "ยังไม่ตั้งรอบ → ไปตั้ง" เหมือนงานยังทำไม่เสร็จ */
  const onDemandLines = Object.keys(groupDemand || {}).filter(g => !byLine[g]?.length);
  const hasRoundMode  = rounds.length > 0;

  /* ── ⏳ forecast "ไลน์จะขาดของเมื่อไหร่" → เวลาบนไทม์ไลน์ + ลำดับส่งของ ────────
     สูตรอยู่ `src/utils/wipRunout.js` ที่เดียว (เทส 11 เคส) — ห้ามคำนวณเองในจอ
     ⚠️ เดินเวลาจาก `nowMs` จึงคำนวณที่นี่ ไม่ใช่ใน view memo ของหน้าแม่
        (ยัดเข้า memo นั้น = คำนวณ demand/BOM/รอบ ใหม่ทั้งชุดทุกนาที) */
  const runoutByLine = useMemo(() => {
    const { groupOrders = {}, bomByMat = {}, ctByMat = {}, wipByGroup = {} } = view || {};
    return onDemandLines.map(g => {
      const f = forecastRunout({
        orders: groupOrders[g] || [],
        bomOf: (m) => bomByMat[m] || [],
        wipOf: (m) => (wipByGroup[g]?.[m] ?? null),   // undefined/null = ไม่มีแถวสต็อก = ไม่รู้
        ctOf: (m) => ctByMat[m] || 0,
        nowMs,
        assumeZeroWip: assumeWip0,
      });
      // ผูกกับ demand ที่บอร์ดคำนวณไว้ เพื่อให้ "จำนวนที่ต้องส่ง/จำนวนการ์ด" ตรงกับที่อื่นในหน้า
      const gd = groupDemand?.[g] || { parts: [], totalKanban: 0 };
      const byMat = {};
      gd.parts.forEach(p => { byMat[p.mat_no] = p; });
      const parts = f.parts.map(p => ({
        ...p,
        part_name: byMat[p.mat_no]?.part_name,
        cards: byMat[p.mat_no]?.cards || 0,
        netTotal: byMat[p.mat_no]?.netTotal ?? p.need,
      }));
      // เวลาแรกของไลน์มาจากพาร์ทที่ถูกสมมติ WIP=0 หรือเปล่า → คุมสี/ข้อความไม่ให้บอกว่า "ขาดแล้ว"
      const firstTimed = parts.find(p => p.runoutMs != null);
      return { line: g, ...f, cards: gd.totalKanban, parts, firstAssumed: !!firstTimed?.assumed };
    }).sort(byUrgency);
  }, [onDemandLines, view, groupDemand, nowMs, assumeWip0]);

  // ตำแหน่งบนกรอบวันงาน 08:00→08:00 คิดจาก ms จริง (runout ข้ามวันได้ — แปลงผ่าน HH:MM จะเพี้ยน)
  const frameStartMs = useMemo(() => {
    const [y, m, d] = String(workDate).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1, 8, 0, 0, 0).getTime();
  }, [workDate]);
  const FRAME_MS = 1440 * 60000;
  const pctOfMs = (ms) => ((ms - frameStartMs) / FRAME_MS) * 100;
  const clockOf = (ms) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  // ⚠️ assumed = ยังไม่รู้ว่ามีของที่ไลน์เท่าไหร่ → ห้ามเขียน "ขาดแล้ว" (ยังไม่ยืนยัน)
  const inMs = (ms, assumed) => {
    const diff = ms - nowMs;
    if (diff <= 0) return assumed ? 'ไลน์เริ่มใช้แล้ว' : 'ขาดแล้ว';
    const mn = Math.round(diff / 60000);
    return mn < 60 ? `อีก ${mn} น.` : `อีก ${Math.floor(mn / 60)} ชม. ${mn % 60} น.`;
  };
  // สีตามความเร่งด่วน — แดง = ขาดแล้ว/กำลังจะขาด (ของหมดคือไลน์หยุด ไม่ใช่เรื่องเล็ก)
  // ⚠️ พาร์ทที่สมมติ WIP=0 ห้ามเป็นแดง — สีแดงคือคำยืนยัน เราแค่ยังไม่รู้ (ส้ม = ต้องไปดู)
  const urgTone = (ms, assumed) => (ms == null ? 'var(--muted)'
    : assumed ? '#f59e0b'
    : ms <= nowMs ? '#ef4444'
    : ms - nowMs < 2 * 3600000 ? '#f59e0b'
    : 'var(--accent)');

  /* คิวโหมดส่งตามคำขอ — เอา forecast มาผูกกับ "ของในสโตร์พอไหม" เป็นก้อนเดียว
     ⚠️ ต้องเป็น memo เดียวกับ runoutByLine ห้ามแยก — แยกแล้วได้ 2 ลำดับที่เถียงกันเอง
        (ลำดับบนไทม์ไลน์กับลำดับบนการ์ดต้องเป็นอันเดียวกันเสมอ)
     ⚠️ ของในสโตร์เป็น pool ร่วม: mat เดียวที่หลายไลน์ต้องใช้พร้อมกัน ต้องขึ้น "ต้องแบ่ง"
        ห้ามบอกว่าครบทั้ง 2 ไลน์ (ของมีชุดเดียว ส่งไลน์แรกไปแล้วไลน์ที่สองไม่เหลือ) */
  const onDemandQueue = useMemo(() => {
    const needByMat = {};
    runoutByLine.forEach(r => r.parts.forEach(p => {
      if (p.netTotal > 0) needByMat[p.mat_no] = (needByMat[p.mat_no] || 0) + p.netTotal;
    }));
    return runoutByLine.map(r => {
      const parts = r.parts.map(p => {
        const tracked = p.mat_no in (storeStock || {});
        const have = tracked ? (storeStock[p.mat_no] || 0) : null;
        const store = !tracked ? 'unknown'                                     // ❔ ไม่รู้ ≠ ไม่มี
          : have >= p.netTotal
            ? (needByMat[p.mat_no] > have ? 'split' : 'ok')
            : have > 0 ? 'partial' : 'none';
        return { ...p, have, store };
      });                                                                       // เรียงตาม runout มาแล้วจาก util
      const n = (s) => parts.filter(p => p.store === s).length;
      return {
        ...r, parts,
        ok: n('ok'), split: n('split'), partial: n('partial'), none: n('none'), unknownStore: n('unknown'),
      };
    });
  }, [runoutByLine, storeStock]);

  // พาร์ทที่ยังไม่มียอด WIP ที่ไลน์ — ต้องรายงานเสมอ ไม่ว่าโหมดจะเปิดหรือปิด
  const assumedTotal = onDemandQueue.reduce((s, q) => s + (q.assumedCount || 0), 0);
  const unknownTotal = onDemandQueue.reduce((s, q) => s + (q.counts?.unknown || 0), 0);

  const counts = {
    todo: rounds.filter(r => !isDone(r)).length,
    overdue: overdueN,
    done: doneN,
    all: rounds.length,
  };
  const visibleRounds = rounds.filter(r =>
    cardFilter === 'all' ? true
      : cardFilter === 'done' ? isDone(r)
      : cardFilter === 'overdue' ? isOverdue(r)
      : !isDone(r));

  // เร่งด่วน = deadline ของด่านที่ยังไม่ผ่าน ที่ใกล้/เลยมานานสุด (สูตรเดียวกับ urgencyKey ฝั่ง shipping)
  const urgencyKey = (r) => {
    if (isDone(r)) return Number.MAX_SAFE_INTEGER;
    const unmet = phaseList(r).filter(p => p.gate && !p.done);
    if (unmet.length) return Math.min(...unmet.map(p => p.at));
    return frameMin(r.delivery_time) ?? Number.MAX_SAFE_INTEGER - 1;
  };
  const cardsSorted = sortMode === 'urgent'
    ? [...visibleRounds].sort((a, b) => urgencyKey(a) - urgencyKey(b))
    : [...visibleRounds].sort((a, b) => (frameMin(a.delivery_time) ?? 9e9) - (frameMin(b.delivery_time) ?? 9e9));

  // เลนกันบล็อกทับกันในแถวเดียว
  const lanesByLine = useMemo(() => {
    const res = {};
    Object.entries(byLine).forEach(([g, list]) => {
      const laneEnd = [], map = {};
      list.filter(r => frameMin(r.delivery_time) != null).forEach(r => {
        const t = frameMin(r.delivery_time);
        let li = laneEnd.findIndex(end => t >= end);
        if (li < 0) { li = laneEnd.length; laneEnd.push(0); }
        laneEnd[li] = t + SPAN_MIN;
        map[r.id] = li;
      });
      res[g] = { map, count: Math.max(1, laneEnd.length) };
    });
    return res;
  }, [byLine]);

  const goToCard = (r) => {
    if (!(cardFilter === 'all'
      || (cardFilter === 'done' && isDone(r))
      || (cardFilter === 'overdue' && isOverdue(r))
      || (cardFilter === 'todo' && !isDone(r)))) setCardFilter('all');
    setPopup(null);
    setHighlightId(r.id);
    setTimeout(() => document.getElementById(`store-round-${r.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    setTimeout(() => setHighlightId(null), 3000);
  };

  // ไม่มีทั้งรอบและ demand = วันนี้ผลิตยังไม่ต้องใช้ของ (ไม่ใช่ "ยังตั้งค่าไม่เสร็จ")
  if (!hasRoundMode && !onDemandLines.length) return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
      วันงานนี้ยังไม่มีความต้องการพาร์ทจากไลน์ผลิต — เปิดใบผลิตแล้วระบบจะแตก BOM มาให้เอง
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
      {/* ── แถบสรุป (โครงเดียวกับหัว Shipping Chart) ── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {hasRoundMode && <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>
          📦 {rounds.length} รอบส่งเข้าไลน์ · ✅ {doneN} รับของแล้ว
          {overdueN > 0 && <span style={{ color: '#ef4444' }}> · 🔴 {overdueN} ค้างส่ง</span>}
          {shortN > 0 && <span style={{ color: '#f59e0b' }}> · ⚠️ {shortN} รอบของในสโตร์ไม่พอ</span>}
          {untrackedN > 0 && (
            <span style={{ color: 'var(--muted)' }} title="พาร์ทเหล่านี้ไม่มีแถวสต็อกในคลัง STORE — เช็คไม่ได้ว่ามีของไหม (ไม่ได้แปลว่าไม่มี)">
              {' '}· ❔ {untrackedN} รอบ ยังเช็คของไม่ได้
            </span>
          )}
        </span>}
        {onDemandLines.length > 0 && (
          <span title={onDemandLines.join(' · ')}
            style={chip('rgba(59,130,246,0.12)', '#60a5fa', { border: '1px solid rgba(59,130,246,0.35)', padding: '4px 10px' })}>
            🚚 ส่งตามคำขอ {onDemandLines.length} ไลน์
          </span>
        )}
      </div>

      {/* ── ชาร์ต 24 ชม. — เฉพาะไลน์ที่เดินเป็นรอบ ────────────────────────────
          ไม่มีรอบเลย = ไม่วาดกริด 24 ชม. · กริดเปล่าไม่ได้บอกอะไร แถมทำให้ดูเหมือนจอพัง */}
      {hasRoundMode && <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
            🕐 Store Time Chart — สโตร์ ➜ ไลน์ผลิต · วันงาน {workDate}
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>คลิกที่บล็อกเพื่อดูของที่ต้องเตรียม / ไปที่การ์ดรายรอบ</span>
        </div>
        <div style={isMobile ? { overflowX: 'auto', WebkitOverflowScrolling: 'touch' } : undefined}>
          <div style={isMobile ? { minWidth: 780 } : undefined}>
            {/* หัวชั่วโมง */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border2)', background: 'var(--bg2)', position: 'relative' }}>
              <div style={{ width: leftW, flexShrink: 0, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', borderRight: '1px solid var(--border2)', ...(isMobile ? { position: 'sticky', left: 0, zIndex: 6, background: 'var(--bg2)' } : null) }}>
                ไลน์ปลายทาง · คลิกชื่อเพื่อย่อ
              </div>
              <div style={{ flex: 1, position: 'relative', height: 22 }}>
                {hourMarks.map((m, i) => (i % 2 === 0 && (
                  <span key={m} style={{
                    position: 'absolute', left: `${((m - tStart) / span) * 100}%`, top: 4, whiteSpace: 'nowrap',
                    fontSize: 11, fontWeight: (m % 1440) === 480 || (m % 1440) === 1200 ? 800 : 500,
                    color: (m % 1440) === 480 || (m % 1440) === 1200 ? 'var(--text2)' : 'var(--muted)',
                    transform: m === tStart + span ? 'translateX(-100%)' : 'translateX(-50%)',
                  }}>{String((m / 60) % 24 | 0).padStart(2, '0')}:00</span>
                )))}
              </div>
              {isToday && nowW >= tStart && nowW <= tStart + span && (
                <div className="now-chip" style={{ left: `calc(${leftW}px + (100% - ${leftW}px) * ${(nowW - tStart) / span})` }}>
                  ⏱ {fmtMin(nowW)}
                </div>
              )}
            </div>

            {Object.keys(byLine).sort().map(g => {
              const list = byLine[g];
              const lanes = lanesByLine[g] || { map: {}, count: 1 };
              const isCol = !!collapsed[g];
              const rowH = isCol ? 26 : 10 + lanes.count * LANE_H;
              const gd = groupDemand?.[g];
              const okN = list.filter(isDone).length;
              return (
                <div key={g} style={{ display: 'flex', borderTop: '1px solid var(--border)' }}>
                  <div onClick={() => setCollapsed(m => ({ ...m, [g]: !m[g] }))}
                    title={isCol ? 'คลิกเพื่อขยาย' : 'คลิกเพื่อย่อ'}
                    style={{ width: leftW, flexShrink: 0, padding: '4px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text2)', borderRight: '1px solid var(--border2)', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center', cursor: 'pointer', userSelect: 'none', ...(isMobile ? { position: 'sticky', left: 0, zIndex: 6, background: 'var(--card)' } : null) }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ color: 'var(--muted)', marginRight: 4 }}>{isCol ? '▸' : '▾'}</span>{g}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
                      {`${list.length} รอบ · ✅ ${okN}`}
                      {gd ? ` · 🎴 ${gd.totalKanban}` : ''}
                    </span>
                  </div>
                  <div style={{ flex: 1, position: 'relative', height: rowH }}>
                    {hourMarks.map(m => (
                      <div key={m} style={{ position: 'absolute', top: 0, bottom: 0, left: `${((m - tStart) / span) * 100}%`, width: 1, background: (m % 1440) === 1200 ? 'var(--border2)' : 'var(--border)' }} />
                    ))}
                    {breakBands.map((b, bi) => {
                      const l = Math.max(0, ((b.s - tStart) / span) * 100);
                      const w = Math.min(100 - l, ((b.e - b.s) / span) * 100);
                      if (w <= 0) return null;
                      return <div key={bi} title={`${b.label} — เวลาพัก`} style={{
                        position: 'absolute', top: 0, bottom: 0, left: `${l}%`, width: `${w}%`, zIndex: 0, pointerEvents: 'none',
                        background: 'repeating-linear-gradient(45deg, rgba(148,163,184,0.18) 0px, rgba(148,163,184,0.18) 4px, transparent 4px, transparent 8px)',
                        borderLeft: '1px dashed rgba(148,163,184,0.6)', borderRight: '1px dashed rgba(148,163,184,0.6)',
                      }} />;
                    })}
                    {isToday && nowW >= tStart && nowW <= tStart + span && (
                      <div className="now-line" style={{ left: `${((nowW - tStart) / span) * 100}%` }} />
                    )}
                    {list.filter(r => frameMin(r.delivery_time) != null).map(r => {
                      const t = frameMin(r.delivery_time);
                      const st = statusOf(r);
                      const od = isOverdue(r);
                      const late = !od && !isDone(r) && phaseLate(r);
                      const cov = coverage[r.id];
                      const color = od ? '#ef4444' : late ? '#f97316' : (cov?.short > 0 && !isDone(r)) ? '#f59e0b' : st.top;
                      const left = ((t - tStart) / span) * 100;
                      const lane = lanes.map[r.id] || 0;
                      const sel = popup?.r?.id === r.id;
                      if (isCol) return (
                        <div key={r.id} onClick={e => setPopup({ r, x: e.clientX, y: e.clientY })}
                          title={`${hhmm(r.delivery_time)} · รอบ ${r.round_no} · ${roundAlloc?.[r.id]?.totalKanban || 0} การ์ด`}
                          style={{ position: 'absolute', top: 8, width: 9, height: 9, borderRadius: '50%', left: `${Math.min(left, 98.5)}%`, background: color, border: '1.5px solid rgba(0,0,0,0.25)', cursor: 'pointer', zIndex: 1 }} />
                      );
                      return (
                        <div key={r.id} onClick={e => setPopup({ r, x: e.clientX, y: e.clientY })}
                          style={{
                            position: 'absolute', top: 5 + lane * LANE_H, height: LANE_H - 6,
                            left: `${Math.min(left, 97)}%`, width: `${(SPAN_MIN / span) * 100}%`, minWidth: 52,
                            background: `${color}${sel ? '55' : '22'}`, border: `1.5px solid ${color}${sel ? '' : 'cc'}`,
                            borderRadius: 5, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            gap: 3, overflow: 'hidden', cursor: 'pointer', boxSizing: 'border-box',
                            boxShadow: od ? `0 0 5px ${color}55` : 'none',
                          }}>
                          <span style={{ fontSize: 12, fontWeight: 800, color, whiteSpace: 'nowrap', lineHeight: 1 }}>
                            {hhmm(r.delivery_time)}{isDone(r) ? ' ✅' : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>}

      {/* ── Popup รายละเอียดรอบ ── */}
      {popup && (() => {
        const r = popup.r;
        const st = statusOf(r);
        const alloc = roundAlloc?.[r.id] || { parts: [], totalKanban: 0 };
        const cov = coverage[r.id] || {};
        const W = 280;
        const left = Math.max(8, Math.min(popup.x - W / 2, window.innerWidth - W - 12));
        const top = Math.min(popup.y + 14, window.innerHeight - 260);
        return (
          <>
            <div onClick={() => setPopup(null)} style={{ position: 'fixed', inset: 0, zIndex: 1400 }} />
            <div style={{ position: 'fixed', left, top, width: W, zIndex: 1401, background: 'var(--bg3)', border: `1px solid ${st.border}`, borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.45)', padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 900, color: 'var(--text)' }}>
                  {r.shift === 'night' ? '🌙' : '☀️'} รอบ {r.round_no} · {hhmm(r.delivery_time)}
                </span>
                <span style={chip('rgba(0,0,0,0.15)', st.color)}>{st.label}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 700, marginBottom: 6 }}>🏭 {r.line_name}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                🔩 {alloc.parts.length} พาร์ท · 🎴 <b style={{ color: '#f59e0b' }}>{alloc.totalKanban}</b> การ์ด
              </div>
              <StockNote cov={cov} fmt={fmt} />
              <button onClick={() => goToCard(r)}
                style={{ marginTop: 10, width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', background: 'var(--accent)', color: '#08130a', border: 'none', fontFamily: 'var(--font-body)' }}>
                ↓ ดูของที่ต้องเตรียม
              </button>
            </div>
          </>
        );
      })()}

      {/* ── ชิปกรอง + เรียง (ตัวเลขต้องตรงกับจำนวนการ์ดที่เห็น) — ของโหมดรอบเท่านั้น ── */}
      {hasRoundMode && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {[
          { k: 'todo', label: `⏳ ต้องทำ (${counts.todo})` },
          { k: 'overdue', label: `🔴 ค้างส่ง (${counts.overdue})` },
          { k: 'done', label: `✅ รับของแล้ว (${counts.done})` },
          { k: 'all', label: `ทั้งหมด (${counts.all})` },
        ].map(f => (
          <button key={f.k} onClick={() => setCardFilter(f.k)} style={{
            padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-body)',
            background: cardFilter === f.k ? 'var(--accent)' : 'var(--bg2)',
            color: cardFilter === f.k ? '#08130a' : 'var(--text2)',
            border: `1px solid ${cardFilter === f.k ? 'var(--accent)' : 'var(--border)'}`,
          }}>{f.label}</button>
        ))}
        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>เรียง:</span>
        {[{ k: 'urgent', label: '⚡ ใกล้ดิวก่อน' }, { k: 'time', label: '🕐 ตามเวลาส่ง' }].map(s => (
          <button key={s.k} onClick={() => setSortMode(s.k)} style={{
            padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-body)',
            background: sortMode === s.k ? 'var(--accent)' : 'var(--bg2)',
            color: sortMode === s.k ? '#08130a' : 'var(--text2)',
            border: `1px solid ${sortMode === s.k ? 'var(--accent)' : 'var(--border)'}`,
          }}>{s.label}</button>
        ))}
      </div>}

      {/* ── 🚚 โหมดส่งตามคำขอ — ไลน์ที่ไม่ได้เดินเป็นรอบ ───────────────────────
          ⚠️ นี่ไม่ใช่ worklist "ไปตั้งรอบ" — ทีมสโตร์ไม่ได้ทำงานเป็นรอบโดยเลือกเอง (user 27/08)
             จอต้องเป็น **คิวงานที่หยิบส่งได้เลย**: เห็นความต้องการ → เรียง → ส่ง
          ⚠️ ลำดับตอนนี้เรียงตาม "ความพร้อมของของ" ยังไม่ใช่ "เวลาที่ผลิตแจ้ง"
             เวลาแจ้งจะมีจริงเมื่อเปิดคิวคำขอ (เฟส 2 · docs/STORE-PULL-LOOP-DESIGN.md §4.1)
             ห้ามเขียนบนจอว่าเรียงตามเวลาแจ้งจนกว่าจะมี `requested_at` จริง */}
      {onDemandQueue.length > 0 && (
        <div style={{ ...card, borderColor: 'rgba(59,130,246,0.35)', background: 'rgba(59,130,246,0.04)', padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#60a5fa' }}>
              🚚 ส่งตามคำขอ (delivery to order) — {onDemandQueue.length} ไลน์
            </span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              อยากให้ไลน์ไหนเดินเป็นรอบ ตั้งได้ที่ <b>📦 Line Stock → ⏰ รอบจัดส่ง</b>
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>
            ไม่ได้นัดเวลาไว้ — เวลาบนไทม์ไลน์มาจาก <b>การคำนวณ</b>: หัก WIP ด้วยของที่ผลิตไปแล้ววันนี้
            แล้วเดินเวลาด้วย cycle time ของใบที่ยังไม่ปิด → <b>ไลน์ไหนจะขาดของก่อน ไปส่งก่อน</b>
          </div>

          {/* 📥 โหมดมอง WIP=0 — ต้องบอกให้เห็นชัดทุกครั้งที่เปิด ห้ามให้ยอด gross ดูเหมือนยอดสุทธิ */}
          {assumeWip0 && assumedTotal > 0 && (
            <div style={{ ...card, borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.07)',
              padding: '8px 11px', marginBottom: 10, display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 240, fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.55 }}>
                <b style={{ color: '#f59e0b' }}>📥 กำลังมอง WIP ที่ไลน์ = 0 · {assumedTotal} พาร์ท</b> (ยังไม่ได้ตั้งยอดที่ไลน์)
                <div style={{ color: 'var(--muted)', marginTop: 2 }}>
                  ยอดที่เห็นเป็น <b>ยอดเต็มตามสูตร BOM — ยังไม่หักของที่อาจมีอยู่ที่ไลน์แล้ว</b> ·
                  เวลาที่พลอต = <b>เวลาที่ไลน์เริ่มต้องใช้ของชิ้นนั้น</b> (กำหนดส่ง) ไม่ใช่เวลาที่ของหมดจริง ·
                  ลำดับส่งของยังถูกต้องตามคิวใบผลิต · ตั้งยอดจริงได้ที่ <b>📦 Line Stock → 🔩 WIP ค้างระหว่างขั้น</b>
                </div>
              </div>
              <button onClick={toggleAssume} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8,
                padding: '5px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: 'var(--text2)', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap' }}>
                ปิดโหมดนี้
              </button>
            </div>
          )}
          {!assumeWip0 && unknownTotal > 0 && (
            <div style={{ ...card, background: 'var(--bg2)', padding: '8px 11px', marginBottom: 10,
              display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 240, fontSize: 11.5, color: 'var(--muted)' }}>
                ❔ <b>{unknownTotal} พาร์ท</b> ยังไม่มียอด WIP ที่ไลน์ → คำนวณเวลาไม่ได้ ไม่ขึ้นบนไทม์ไลน์
              </span>
              <button onClick={toggleAssume} style={{ background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 8,
                padding: '5px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 800, color: '#f59e0b', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap' }}>
                📥 มอง WIP=0 เพื่อดู workflow
              </button>
            </div>
          )}

          {/* ── ⏳ ไทม์ไลน์ runout — พลอตจากเวลาที่คำนวณ ไม่ใช่รอบที่ตั้งไว้ ────────── */}
          <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 12 }}>
            <div style={isMobile ? { overflowX: 'auto', WebkitOverflowScrolling: 'touch' } : undefined}>
              <div style={isMobile ? { minWidth: 780 } : undefined}>
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border2)' }}>
                  <div style={{ width: leftW, flexShrink: 0, padding: '4px 8px', fontSize: 10.5, color: 'var(--muted)', fontWeight: 700, ...(isMobile ? { position: 'sticky', left: 0, zIndex: 6, background: 'var(--card)' } : null) }}>
                    ไลน์ · จะขาดของเมื่อไหร่
                  </div>
                  <div style={{ flex: 1, position: 'relative', height: 20 }}>
                    {hourMarks.filter((_, i) => i % 2 === 0).map(m => (
                      <span key={m} style={{ position: 'absolute', left: `${((m - tStart) / span) * 100}%`, top: 3, fontSize: 10, color: 'var(--muted)', transform: 'translateX(-50%)' }}>
                        {fmtMin(m)}
                      </span>
                    ))}
                  </div>
                </div>
                {onDemandQueue.map(q => {
                  const first = q.firstRunoutMs;
                  const tone = urgTone(first, q.firstAssumed);
                  const barL = Math.max(0, pctOfMs(Math.max(nowMs, frameStartMs)));
                  const barR = first == null ? null : Math.min(100, pctOfMs(first));
                  return (
                    <div key={q.line} style={{ display: 'flex', borderTop: '1px solid var(--border)' }}>
                      <div style={{ width: leftW, flexShrink: 0, padding: '5px 10px', borderRight: '1px solid var(--border2)', overflow: 'hidden', ...(isMobile ? { position: 'sticky', left: 0, zIndex: 6, background: 'var(--card)' } : null) }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.line}</div>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: tone }}>
                          {first == null ? '— ยังคำนวณเวลาไม่ได้'
                            : `${q.firstAssumed ? '📥 ' : ''}${clockOf(first)} · ${inMs(first, q.firstAssumed)}`}
                        </div>
                      </div>
                      <div style={{ flex: 1, position: 'relative', height: 34 }}>
                        {hourMarks.map(m => (
                          <div key={m} style={{ position: 'absolute', top: 0, bottom: 0, left: `${((m - tStart) / span) * 100}%`, width: 1, background: (m % 1440) === 1200 ? 'var(--border2)' : 'var(--border)' }} />
                        ))}
                        {breakBands.map((b, bi) => {
                          const l = Math.max(0, ((b.s - tStart) / span) * 100);
                          const w = Math.min(100 - l, ((b.e - b.s) / span) * 100);
                          if (w <= 0) return null;
                          return <div key={bi} title={`${b.label} — เวลาพัก`} style={{
                            position: 'absolute', top: 0, bottom: 0, left: `${l}%`, width: `${w}%`, zIndex: 0, pointerEvents: 'none',
                            background: 'repeating-linear-gradient(45deg, rgba(148,163,184,0.18) 0px, rgba(148,163,184,0.18) 4px, transparent 4px, transparent 8px)',
                          }} />;
                        })}
                        {isToday && nowW >= tStart && nowW <= tStart + span && (
                          <div className="now-line" style={{ left: `${((nowW - tStart) / span) * 100}%` }} />
                        )}
                        {/* แถบ "ของยังพอ" จากตอนนี้ถึงเวลาที่จะขาดตัวแรก */}
                        {barR != null && barR > barL && (
                          <div title={q.firstAssumed
                            ? `ไลน์เริ่มต้องใช้ของตอน ${clockOf(first)} — ยังไม่รู้ว่ามีอยู่ที่ไลน์เท่าไหร่`
                            : `ของพอถึง ${clockOf(first)}`} style={{
                            position: 'absolute', top: 12, height: 10, left: `${barL}%`, width: `${barR - barL}%`,
                            background: `${tone}33`, borderLeft: `2px solid ${tone}`, borderRadius: 3, zIndex: 1,
                          }} />
                        )}
                        {/* จุด = พาร์ทแต่ละตัวจะหมดตอนไหน */}
                        {q.parts.filter(p => p.runoutMs != null).map(p => {
                          const x = pctOfMs(p.runoutMs);
                          if (x < 0 || x > 100) return null;
                          return (
                            <div key={p.mat_no}
                              title={p.assumed
                                ? `${p.mat_no} — ไลน์เริ่มต้องใช้ ${clockOf(p.runoutMs)} (${inMs(p.runoutMs, true)}) · ต้องส่ง ${fmt(p.netTotal)} · 📥 ยังไม่ได้ตั้งยอด WIP ที่ไลน์ ยอดนี้ยังไม่หัก`
                                : `${p.mat_no} — ของที่ไลน์หมด ${clockOf(p.runoutMs)} (${inMs(p.runoutMs)}) · ต้องส่ง ${fmt(p.netTotal)}`}
                              style={{
                                position: 'absolute', top: 9, left: `${x}%`, width: 8, height: 8, marginLeft: -4,
                                borderRadius: '50%', background: urgTone(p.runoutMs, p.assumed), zIndex: 2,
                                // วงแหวนกลวง = ตัวเลขที่ยังไม่ยืนยัน (แยกจากจุดทึบที่หักยอดจริงแล้ว)
                                ...(p.assumed ? { background: 'transparent', border: '2px solid #f59e0b', width: 9, height: 9, marginLeft: -4.5 } : null),
                              }} />
                          );
                        })}
                        {/* ไม่มีเวลาให้พลอตเลย = ต้องบอกว่าทำไม ห้ามปล่อยแถวว่าง */}
                        {q.parts.every(p => p.runoutMs == null) && (
                          <div style={{ position: 'absolute', top: 9, left: 8, fontSize: 10.5, color: 'var(--muted)', zIndex: 2 }}>
                            {q.counts.unknown > 0 ? `❔ ${q.counts.unknown} พาร์ทยังไม่มียอด WIP ที่ไลน์ — คำนวณไม่ได้`
                              : q.counts.no_ct > 0 ? `⚠️ ยังไม่ตั้ง cycle time (${q.noCtMats.slice(0, 2).join(' · ')}) — คำนวณเวลาไม่ได้`
                              : q.counts.idle > 0 ? '⏸️ ไลน์ยังไม่มีใบผลิตเปิด'
                              : '✅ ของที่ไลน์พอถึงจบแผนวันนี้'}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ padding: '5px 10px', borderTop: '1px solid var(--border2)', fontSize: 10.5, color: 'var(--muted)' }}>
              ⚠️ WIP ที่ใช้คำนวณ = ยอดในระบบ <b>หักด้วยของที่ผลิตไปแล้ววันนี้</b> (คำนวณจากใบผลิต ไม่ได้อ่านจากยอดตัดสต็อก
              เพราะ backflush ยังไม่ทำงาน) · {assumeWip0
                ? <>พาร์ทที่ยังไม่เคยตั้งยอดที่ไลน์ ถูกมองเป็น <b>0</b> (วงแหวน 📥) — เป็น<b>กำหนดส่ง</b> ไม่ใช่ “ของหมดแล้ว”</>
                : <>พาร์ทที่ยังไม่เคยตั้งยอดที่ไลน์ = <b>คำนวณไม่ได้</b> ไม่ใช่ “ของหมด”</>}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 10 }}>
            {onDemandQueue.map((q, i) => {
              const open = !!qOpen[q.line];
              const blocked = q.none + q.partial;
              return (
                <div key={q.line} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={chip('rgba(96,165,250,0.15)', '#60a5fa', { minWidth: 20, textAlign: 'center' })}>{i + 1}</span>
                    <button onClick={() => onOpenLine?.(q.line)} title="เปิดบอร์ดของไลน์นี้"
                      style={{ background: 'none', border: 'none', padding: 0, cursor: onOpenLine ? 'pointer' : 'default',
                        fontSize: 12.5, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-body)', textAlign: 'left' }}>
                      🏭 {q.line}
                    </button>
                  </div>
                  {/* บรรทัดเวลา = คำตอบหลักของการ์ด "ต้องไปเมื่อไหร่" */}
                  <div style={{ marginTop: 4, fontSize: 12, fontWeight: 800, color: urgTone(q.firstRunoutMs, q.firstAssumed) }}>
                    {q.firstRunoutMs != null
                      ? (q.firstAssumed
                        ? `📥 ต้องส่งก่อน ${clockOf(q.firstRunoutMs)} · ${inMs(q.firstRunoutMs, true)}`
                        : `⏳ ไลน์จะขาดของ ${clockOf(q.firstRunoutMs)} · ${inMs(q.firstRunoutMs)}`)
                      : q.counts.unknown > 0 ? '❔ คำนวณเวลาไม่ได้ — ยังไม่มียอด WIP ที่ไลน์'
                      : q.counts.no_ct > 0   ? '⚠️ คำนวณเวลาไม่ได้ — ยังไม่ตั้ง cycle time'
                      : q.counts.idle > 0    ? '⏸️ ไลน์ยังไม่มีใบผลิตเปิด'
                      : '✅ ของที่ไลน์พอถึงจบแผนวันนี้'}
                  </div>
                  {q.assumedCount > 0 && (
                    <div style={{ fontSize: 10.5, color: '#f59e0b', marginTop: 1 }}
                      title="พาร์ทเหล่านี้ยังไม่ได้ตั้งยอด WIP ที่ไลน์ — ระบบมองเป็น 0 ยอดที่แสดงจึงยังไม่หักของที่อาจมีอยู่แล้ว">
                      📥 {q.assumedCount} พาร์ทยังไม่ได้ตั้งยอดที่ไลน์ — ยอดนี้ยังไม่หัก
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginTop: 2 }}>
                    <span style={{ fontSize: 19, fontWeight: 900, color: 'var(--accent)', fontFamily: 'var(--font-display)' }}>{q.cards}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>การ์ด · {q.parts.length} พาร์ท</span>
                  </div>
                  {/* สถานะของในสโตร์ (คนละเรื่องกับ WIP ที่ไลน์) — "ไม่รู้" แยกจาก "ไม่มี" เสมอ */}
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                    {q.ok > 0      && <span style={chip('rgba(34,197,94,0.14)', 'var(--accent)')}>✅ สโตร์มีพร้อม {q.ok}</span>}
                    {q.split > 0   && <span style={chip('rgba(245,158,11,0.14)', '#f59e0b')} title="ของชุดนี้มีไลน์อื่นต้องใช้ด้วย — ส่งไลน์แรกไปแล้วอาจไม่เหลือ">🔀 ต้องแบ่ง {q.split}</span>}
                    {q.partial > 0 && <span style={chip('rgba(245,158,11,0.14)', '#f59e0b')}>⚠️ สโตร์ไม่พอ {q.partial}</span>}
                    {q.none > 0    && <span style={chip('rgba(239,68,68,0.14)', '#ef4444')}>🚨 สโตร์ไม่มีของ {q.none}</span>}
                    {q.unknownStore > 0 && <span style={chip('rgba(148,163,184,0.14)', 'var(--muted)')} title="พาร์ทนี้ไม่มีแถวสต็อกในคลัง STORE — เช็คไม่ได้ว่ามีของไหม (ไม่ได้แปลว่าไม่มี)">❔ เช็คไม่ได้ {q.unknownStore}</span>}
                  </div>
                  <button onClick={() => setQOpen(s => ({ ...s, [q.line]: !s[q.line] }))}
                    style={{ marginTop: 7, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      fontSize: 11, fontWeight: 700, color: 'var(--muted)', fontFamily: 'var(--font-body)' }}>
                    {open ? '▾ ซ่อนรายการ' : `▸ ดูรายการที่ต้องหยิบ (${q.parts.length})`}
                  </button>
                  {open && (
                    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 260, overflowY: 'auto' }}>
                      {q.parts.map(p => {
                        const m = p.store === 'ok'    ? { c: 'var(--accent)', t: '✅' }
                          : p.store === 'split'       ? { c: '#f59e0b', t: '🔀' }
                          : p.store === 'partial'     ? { c: '#f59e0b', t: '⚠️' }
                          : p.store === 'none'        ? { c: '#ef4444', t: '🚨' }
                          :                             { c: 'var(--muted)', t: '❔' };
                        const rr = RUNOUT_REASON[p.reason] || RUNOUT_REASON.unknown;
                        return (
                          <div key={p.mat_no} style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 11.5 }}>
                            <span style={{ color: m.c }} title={`ของในสโตร์: ${m.t}`}>{m.t}</span>
                            <span style={{ fontWeight: 700, color: 'var(--text2)', fontFamily: 'var(--font-display)' }}>{p.mat_no}</span>
                            <span style={{ color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.part_name || ''}</span>
                            {/* เวลาที่ "ของที่ไลน์" จะหมด — คนละตัวกับของในสโตร์
                                📥 = ยังไม่ได้ตั้งยอดที่ไลน์ (มองเป็น 0) → เวลานี้คือกำหนดส่ง ไม่ใช่เวลาที่ของหมดจริง */}
                            <span title={p.assumed
                              ? `WIP ที่ไลน์: ยังไม่ได้ตั้งยอด — ระบบมองเป็น 0 · เวลานี้คือเวลาที่ไลน์เริ่มต้องใช้ (${rr.label})`
                              : `WIP ที่ไลน์: ${p.wipNow == null ? 'ไม่มียอด' : fmt(p.wipNow)} · ${rr.label}`}
                              style={{ color: urgTone(p.runoutMs, p.assumed), whiteSpace: 'nowrap', fontSize: 10.5, fontWeight: 700 }}>
                              {p.runoutMs != null ? `${p.assumed ? '📥' : '⏳'} ${clockOf(p.runoutMs)}` : rr.icon}
                            </span>
                            <span style={{ fontWeight: 800, color: m.c, whiteSpace: 'nowrap' }}>
                              {fmt(p.netTotal)}{p.cards > 0 ? ` · ${p.cards}ใบ` : ''}
                            </span>
                            <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap', fontSize: 10.5 }}>
                              {p.have == null ? 'สโตร์ —' : `สโตร์ ${fmt(p.have)}`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {blocked > 0 && (
                    <div style={{ marginTop: 6, fontSize: 10.5, color: '#f59e0b' }}>
                      ส่งได้ไม่ครบ — {blocked} พาร์ทของในสโตร์ไม่พอ
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── การ์ดรายรอบ + walkback + ของที่ต้องเตรียม (โหมดรอบเท่านั้น) ── */}
      {!hasRoundMode ? null : cardsSorted.length === 0 ? (
        <div style={{ ...card, padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          ไม่มีรอบในตัวกรองนี้
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(290px, 100%), 1fr))', gap: 12 }}>
          {cardsSorted.map(r => {
            const st = statusOf(r);
            const k = keyOf(r);
            const alloc = roundAlloc?.[r.id] || { parts: [], totalKanban: 0 };
            const cov = coverage[r.id] || {};
            const phases = phaseList(r);
            const done = isDone(r);
            const conf = confirmedSet.has(k);
            const od = isOverdue(r);
            const need = !conf && (st.label === '⏳ กำลังเตรียม' || od);
            const isOpen = expanded === r.id;
            const hi = highlightId === r.id;
            return (
              <div key={r.id} id={`store-round-${r.id}`} style={{
                ...card, background: st.bg, borderColor: hi ? 'var(--accent)' : st.border,
                boxShadow: hi ? '0 0 0 2px var(--accent)' : 'none', overflow: 'hidden', transition: 'box-shadow .2s',
              }}>
                <div style={{ height: 4, background: st.top }} />
                <div style={{ padding: '10px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 900, color: 'var(--text)' }}>
                      🕐 {hhmm(r.delivery_time)} <span style={{ fontSize: 12, color: 'var(--muted)' }}>รอบ {r.round_no}</span>
                    </span>
                    <span style={chip('rgba(0,0,0,0.15)', st.color)}>{st.label}</span>
                  </div>
                  <div onClick={() => onOpenLine?.(r.line_name)}
                    style={{ fontSize: 13, fontWeight: 800, color: '#0ea5e9', marginTop: 3, cursor: onOpenLine ? 'pointer' : 'default' }}>
                    🏭 {r.line_name}{r.shift === 'night' ? ' · 🌙 กะดึก' : ' · ☀️ กะเช้า'}
                  </div>

                  {/* ของที่ต้องเตรียม — demand → BOM → การ์ดคัมบัง */}
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 900, color: '#f59e0b', fontFamily: 'var(--font-display)' }}>{alloc.totalKanban}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>การ์ด · {alloc.parts.length} พาร์ท</span>
                  </div>

                  {/* walkback — ด่านที่พลาดขึ้นแดง หมุดเวลาเป็นสีกลาง */}
                  {!done && phases.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 8 }}>
                      {phases.map(p => (
                        <span key={p.key} style={{
                          fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 7,
                          background: p.missed ? 'rgba(239,68,68,0.12)' : p.done ? 'rgba(34,197,94,0.1)' : 'var(--bg2)',
                          color: p.missed ? '#ef4444' : p.done ? '#22c55e' : 'var(--muted)',
                          border: `1px solid ${p.missed ? 'rgba(239,68,68,0.35)' : p.done ? 'rgba(34,197,94,0.25)' : 'var(--border)'}`,
                        }}>
                          {p.missed ? '🔴' : p.done ? '✓' : p.icon} {p.label} {fmtMin(p.at)}
                        </span>
                      ))}
                    </div>
                  )}

                  {!done && <StockNote cov={cov} fmt={fmt} />}

                  {receivedMap[k]?.received_status && (
                    <div style={{ fontSize: 11, color: receivedMap[k].received_status === 'full' ? '#22c55e' : '#f59e0b', marginTop: 6, fontWeight: 700 }}>
                      {receivedMap[k].received_status === 'full' ? '✔️' : '⚠️'} {receivedMap[k].received_by} รับของแล้ว
                      {receivedMap[k].received_note ? ` — ${receivedMap[k].received_note}` : ''}
                    </div>
                  )}

                  {canOperate && need && (
                    <button onClick={() => onConfirm(r, alloc.parts)} disabled={confirming === r.id}
                      style={{ marginTop: 9, width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.35)', fontFamily: 'var(--font-body)' }}>
                      {confirming === r.id ? '...' : '✅ ยืนยันส่งออกจากสโตร์'}
                    </button>
                  )}
                  {canOperate && conf && !done && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
                      <button onClick={() => onReceive(r, alloc.parts, 'full')}
                        style={{ flex: 1, padding: '8px 4px', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.35)', fontFamily: 'var(--font-body)' }}>✔️ รับครบ</button>
                      <button onClick={() => onReceive(r, alloc.parts, 'partial')}
                        style={{ flex: 1, padding: '8px 4px', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.35)', fontFamily: 'var(--font-body)' }}>⚠️ รับไม่ครบ</button>
                    </div>
                  )}

                  <button onClick={() => setExpanded(isOpen ? null : r.id)}
                    style={{ marginTop: 8, width: '100%', padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'var(--bg2)', color: 'var(--text2)', border: '1px solid var(--border)', fontFamily: 'var(--font-body)' }}>
                    {isOpen ? '▾ ซ่อนรายการของ' : `▸ ดูของที่ต้องเตรียม (${alloc.parts.length})`}
                  </button>
                </div>

                {isOpen && (
                  <div style={{ borderTop: '1px solid rgba(128,128,128,0.18)', padding: '8px 14px', maxHeight: 260, overflowY: 'auto' }}>
                    {alloc.parts.length === 0 ? (
                      <div style={{ fontSize: 11, color: 'var(--muted)', padding: '6px 0' }}>รอบนี้ยังไม่มีพาร์ทที่ต้องเตรียม (ผลิตยังไม่เปิดใบในหน้าต่างตัดยอดนี้)</div>
                    ) : alloc.parts.map(p => {
                      const per = kanbanStd?.[p.mat_no];
                      const inStore = storeStock?.[p.mat_no];
                      const enough = inStore == null ? null : inStore >= p.netTotal;
                      return (
                        <div key={p.mat_no} style={{ padding: '5px 0', borderBottom: '1px solid rgba(128,128,128,0.1)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 800, color: '#0ea5e9' }}>{p.mat_no}</span>
                            <span style={{ fontSize: 12, fontWeight: 900, color: p.netTotal > 0 ? '#f59e0b' : '#22c55e' }}>
                              {p.netTotal <= 0 ? '✓ ในไลน์พอ' : per ? `${p.cards} ใบ` : `${fmt(p.netTotal)} ${p.uom || ''}`}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.part_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                            ผลิตต้องใช้ {fmt(p.qty)}
                            {p.stockUsed > 0 ? ` · มีในไลน์ ${fmt(p.stockUsed)}` : ''}
                            {p.netTotal > 0 ? ` · ต้องส่ง ${fmt(p.netTotal)}` : ''}
                            {p.netTotal > 0 && (enough === null
                              ? <span style={{ color: 'var(--muted)' }} title="ไม่มีแถวสต็อกของพาร์ทนี้ในคลัง STORE — เช็คไม่ได้ว่ามีของไหม"> · ❔ ยังเช็คของในสโตร์ไม่ได้</span>
                              : enough
                                ? <span style={{ color: '#22c55e' }}> · ✓ สโตร์มี {fmt(inStore)}</span>
                                : <span style={{ color: '#ef4444', fontWeight: 800 }}> · 🚨 สโตร์มี {fmt(inStore)} ขาด {fmt(p.netTotal - inStore)}</span>)}
                          </div>
                        </div>
                      );
                    })}
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                      ตัดยอด {hhmm(r.cutoff_time)} · เตรียม {r.prep_minutes || 60} น. · {r.points_count || 1} จุด × {r.time_per_point_min || 10} น.
                      {r.delivery_time ? ` · เสร็จ ~${addMinutes(hhmm(r.delivery_time), roundDeliveryMin(r))}` : ''}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* สรุปสถานะของในสโตร์ต่อรอบ — ⚠️ "ไม่รู้" ต้องเป็นข้อความของตัวเอง ห้ามรวมกับ "ขาด" */
function StockNote({ cov, fmt }) {
  if (!cov || !cov.need) return null;
  if (cov.short > 0) return (
    <div style={{ fontSize: 11.5, color: '#ef4444', fontWeight: 800, marginTop: 6 }}>
      🚨 ของในสโตร์ไม่พอ {cov.shortMats} พาร์ท — ขาดรวม {fmt(cov.short)} ชิ้น
    </div>
  );
  if (cov.untracked > 0) return (
    <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700, marginTop: 6 }}
      title="พาร์ทเหล่านี้ไม่มีแถวสต็อกในคลัง STORE — ไม่ได้แปลว่าไม่มีของ แค่ระบบยังเช็คไม่ได้">
      ❔ ยังเช็คของไม่ได้ {cov.untracked} พาร์ท (ไม่มีข้อมูลสต็อกในสโตร์)
    </div>
  );
  return <div style={{ fontSize: 11.5, color: '#22c55e', fontWeight: 700, marginTop: 6 }}>📦 ของในสโตร์พร้อมครบ</div>;
}
