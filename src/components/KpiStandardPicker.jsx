import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import ReadOnlyNote from './ReadOnlyNote';
import {
  KPI_TOTAL_WEIGHT, KPI_STD_UNITS, stdUnitLabel, isStdParent, isStdFixed,
  requirementOf, checkStdSelection,
} from '../utils/kpiSetup';

/* ══ 🧩 ตั้งชุด KPI จากทะเบียนมาตรฐานของกลุ่ม (2026-09-23) ══════════════════════════════
 *
 * ═══ ปัญหาที่ตัวนี้แก้ ═══════════════════════════════════════════════════════════════
 * ทะเบียน `kpi_standard_items` ลงฐานไปตั้งแต่ 21/09 (318 แถว · 20 หน่วยงาน) และชั้นกติกา
 * ใน `kpiSetup.js` §6 ก็เขียนครบแล้ว — **แต่ไม่มีจอไหนพาคนไปถึงมันเลย**
 * ⇒ วิธีเดียวที่ตั้ง KPI ได้คือกด "＋ เพิ่ม KPI" แล้ว**พิมพ์ชื่อเอง**ทีละข้อ ซึ่ง:
 *   · พิมพ์ชื่อไม่ตรงเอกสารกลุ่ม ⇒ เทียบข้ามหน่วยงาน/ข้ามปีไม่ได้
 *   · ไม่มีใครรู้ว่าข้อไหน `Fixed` (ตัดทิ้งไม่ได้) ⇒ ใบขาดข้อบังคับโดยไม่รู้ตัว
 *   · ไม่มีตัวนับน้ำหนัก ⇒ ไม่มีทางรู้ว่าครบ 50 หรือยัง
 * วัดจริง 23/09: `kpi_definitions` = **0 แถว** ทั้งระบบ — ฟีเจอร์ทั้งสายยังไม่เคยถูกใช้
 *
 * ═══ กฎที่ต้องไม่ลืม (docs/modules/obeya-kpi-board.md · docs/OBEYA-KPI-SOURCES.md §15) ═══
 * 🔴 `requirement = null` **ไม่ใช่ "ลืมกรอก"** = แถวหัวข้อแม่ (เช่น `Activity` ที่มี QCC/Kaizen
 *    อยู่ใต้มัน) — ไม่ใช่ KPI ที่ให้คะแนนเอง ⇒ **ห้ามมี checkbox ห้ามนับน้ำหนัก**
 *    (เช็คผ่าน `isStdParent` เท่านั้น ห้ามเขียน `!it.requirement` เองซ้ำ)
 * 🔴 `seq` **ใช้เรียงไม่ได้** — ต้นฉบับ `Production` พิมพ์เลข `6` ซ้ำ 2 แถว ⇒ เรียงด้วย
 *    `sort_order` เสมอ · `seq` มีไว้โชว์ให้ตรงกระดาษเท่านั้น
 * 🔴 **เตือนเท่านั้น ห้ามบล็อกการบันทึก** — ใบจริงของ TSAT เพิ่ม `Non NC Major` เองซึ่งไม่มี
 *    ในทะเบียนสักหน่วยงาน · และระหว่างตั้งค่ายังไม่ครบ 50 เป็นเรื่องปกติ
 * 🔴 **ไม่เดาเป้า** — ทะเบียนกลุ่มบอกแค่ "หัวข้อ + สูตร" ไม่ได้บอก Commitment/Target ของโรงงานเรา
 *    ⇒ สร้างแถวโดยเว้นเป้าไว้ แล้วให้คนไปตั้งที่ ✏️ ทีละข้อ **ห้ามใส่ตัวเลขให้เองแม้แต่ 0**
 * 🔴 **ไม่เกลี่ยน้ำหนักให้อัตโนมัติตอนบันทึก** — ปุ่มเกลี่ยมีให้กดเอง (คนเห็นตัวเลขก่อนเสมอ)
 *
 * หน่วยงานที่ `seeded:false` (4 ตัว TSA) = ตั้งใจยังไม่ใส่ในทะเบียน (ถอด PDF แล้วนับไม่ตรง)
 * ⇒ ต้องขึ้นในลิสต์พร้อมเหตุผล **ห้ามซ่อน** (กฎความซื่อสัตย์ของจอ: ไม่มี ≠ ไม่แสดง)
 * ════════════════════════════════════════════════════════════════════════════════════ */

const PERSPECTIVES = [
  { key: 'financial', label: '💰 Financial' },
  { key: 'customer', label: '🤝 Customer' },
  { key: 'internal', label: '🏭 Internal Process' },
  { key: 'learning', label: '📚 Learning & Growth' },
];

/* เทียบชื่อแบบไม่สนช่องว่าง/ตัวพิมพ์ — ตรงกับ unique index `lower(btrim(name))` ของ kpi_catalog
   ⚠️ ต้องยุบช่องว่างซ้ำด้วย: ทะเบียนกลุ่มถอดมาจาก PDF มี double space หลายจุด */
const normName = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();

const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export default function KpiStandardPicker({
  year, section, group, canManage, role, existingDefs = [], onClose, onDone,
}) {
  const [unit, setUnit] = useState('');
  const [regYear, setRegYear] = useState(null);      // ปีของ "ทะเบียน" — คนละตัวกับปีที่กำลังตั้ง KPI
  const [avail, setAvail] = useState(null);          // Map(std_unit → [ปีที่มีในทะเบียน])
  const [items, setItems] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [weights, setWeights] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const reqRef = useRef(0);

  /* ── 1) ทะเบียนมีหน่วยงาน/ปีอะไรบ้าง (โหลดครั้งเดียว · 2 คอลัมน์ กัน egress) ───────── */
  useEffect(() => {
    let alive = true;
    supabase.from('kpi_standard_items').select('year, std_unit')
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          /* 42P01 = ยังไม่ apply migration · อย่างอื่น = คิวรีล้มจริง — ทั้งคู่ต้องบอกบนจอ
             ห้ามปล่อยให้ดูเหมือน "ทะเบียนว่าง" (คนละเรื่องกันคนละวิธีแก้) */
          setAvail(new Map());
          toast.error(error.code === '42P01'
            ? 'ยังไม่ได้ apply migration 20260921_kpi_standard_2026_main.sql (Main) — แจ้ง admin'
            : 'อ่านทะเบียน KPI มาตรฐานไม่สำเร็จ: ' + error.message);
          return;
        }
        const m = new Map();
        for (const r of data || []) {
          if (!m.has(r.std_unit)) m.set(r.std_unit, new Set());
          m.get(r.std_unit).add(r.year);
        }
        setAvail(new Map([...m].map(([k, v]) => [k, [...v].sort((a, b) => b - a)])));
      });
    return () => { alive = false; };
  }, []);

  /* ปีทะเบียนที่จะใช้: ปีเดียวกับที่กำลังตั้ง KPI ถ้ามี — ไม่มีก็ปีล่าสุดที่ทะเบียนมี
     (เอกสารกลุ่มออกเป็นรุ่นปี ไม่ได้ออกทุกปี ⇒ ปี 2027 ใช้ทะเบียน 2026 ไปก่อนเป็นเรื่องปกติ
      แต่ **ต้องเขียนบนจอว่าใช้ทะเบียนปีไหน** ห้ามเงียบ) */
  const unitYears = (unit && avail?.get(unit)) || [];
  const useYear = regYear ?? (unitYears.includes(year) ? year : (unitYears[0] ?? null));

  /* ── 2) โหลดรายการของหน่วยงานที่เลือก ───────────────────────────────────────────── */
  useEffect(() => {
    if (!unit || !useYear) { setItems(null); return; }
    const seq = ++reqRef.current;
    setLoading(true);
    let alive = true;
    supabase.from('kpi_standard_items')
      .select('id, seq, sort_order, perspective, topic, formula_text, requirement, note')
      .eq('year', useYear).eq('std_unit', unit).order('sort_order')
      .then(({ data, error }) => {
        if (!alive || seq !== reqRef.current) return;   // กัน stale response ตอนสลับหน่วยงานเร็วๆ
        setLoading(false);
        if (error) { setItems([]); toast.error('โหลดรายการไม่สำเร็จ: ' + error.message); return; }
        setItems(data || []);
      });
    return () => { alive = false; };
  }, [unit, useYear]);

  const rows = items || [];
  const kpiRows = useMemo(() => rows.filter(r => !isStdParent(r)), [rows]);

  /* KPI ที่ขอบเขตนี้ตั้งไว้แล้ว — เทียบด้วย std_item_id ก่อน แล้วค่อยตกไปเทียบชื่อ
     (แถวที่สร้างก่อนมีคอลัมน์ std_item_id จะไม่มี id ให้เทียบ) */
  const already = useMemo(() => {
    const ids = new Set(), names = new Set();
    for (const d of existingDefs) {
      if (d?.std_item_id) ids.add(d.std_item_id);
      const n = normName(d?.kpi_catalog?.name || d?.name);
      if (n) names.add(n);
    }
    return { ids, names };
  }, [existingDefs]);
  const isAlready = useCallback(
    (it) => already.ids.has(it.id) || already.names.has(normName(it.topic)),
    [already]);

  /* ── 3) ติ๊กเริ่มต้น: `Fixed` ที่ **ยังไม่ถูกตั้งในขอบเขตนี้** ───────────────────────
     🔴 ต้องเป็น effect แยกหลังคำนวณ `isAlready` แล้ว — เดิมติ๊กตอนโหลดเสร็จทันที
        ⇒ ข้อที่ตั้งไว้แล้วเข้าเซ็ต `picked` ไปด้วย ทั้งที่ **ไม่มีช่องกรอกน้ำหนักให้เห็น**
          และตอนบันทึกก็ถูกข้าม ⇒ ตัวนับท้ายจอขึ้น "50/50" ทั้งที่ช่องบนจอรวมได้ 25
          = จอโกหกเรื่องน้ำหนัก ซึ่งเป็นตัวเลขทางการที่ต้องเป๊ะ (เจอตอนทดสอบด้วย Playwright 23/09)
     · แถวแม่ไม่เข้าเซ็ตเด็ดขาด (`isStdFixed` เป็นเท็จกับ `requirement: null` อยู่แล้ว) */
  useEffect(() => {
    if (!items) return;
    setPicked(new Set(items.filter(r => isStdFixed(r) && !isAlready(r)).map(r => r.id)));
    setWeights({});
  }, [items, isAlready]);

  /* ── 4) ตัวนับน้ำหนัก + ข้อบังคับที่ขาด — ผ่าน checkStdSelection() เท่านั้น ──────────
     🔴 ต้องนับ **ทั้งใบ** = แถวที่ตั้งไว้แล้วในขอบเขตนี้ + แถวที่กำลังจะเพิ่ม
        ไม่งั้นได้คำตอบผิด 2 ทาง: (1) น้ำหนักขึ้นว่า "ขาด" ทั้งที่ใบครบแล้ว
        (2) ข้อบังคับที่ **สร้างไปแล้ว** ถูกรายงานว่า "ขาด" ⇒ คำเตือนที่ผิด ซึ่งคนจะเรียนรู้ที่จะเมิน
        (ประกาศ QSM-R2 001/2569: Total Weight = 50 ของ **ทั้งใบ** ไม่ใช่ของรอบที่เพิ่ม) */
  const existRows = useMemo(() => existingDefs.map(d => ({
    weight: d?.weight, std_item_id: d?.std_item_id || null,
    topic: d?.kpi_catalog?.name || d?.name || '',
  })), [existingDefs]);
  const existWeight = useMemo(
    () => Math.round(existRows.reduce((a, r) => a + (num(r.weight) ?? 0), 0) * 100) / 100,
    [existRows]);

  const newRows = useMemo(() => kpiRows.filter(r => picked.has(r.id))
    .map(r => ({ weight: num(weights[r.id]), std_item_id: r.id, topic: r.topic })),
  [kpiRows, picked, weights]);
  const newWeight = useMemo(
    () => Math.round(newRows.reduce((a, r) => a + (r.weight ?? 0), 0) * 100) / 100,
    [newRows]);

  const check = useMemo(
    () => checkStdSelection([...existRows, ...newRows], rows),
    [existRows, newRows, rows]);

  const toggle = (it) => {
    if (!canManage) return;
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(it.id)) {
        /* ปลด Fixed ได้ แต่ต้องรู้ตัว — ประกาศกลุ่มบอกว่าตัดทิ้งไม่ได้
           (ไม่บล็อก เพราะใบจริงบางใบก็ไม่ตรงทะเบียน 100%) */
        if (isStdFixed(it) && !window.confirm(
          `"${it.topic}" เป็นข้อ **บังคับ (Fixed)** ตามทะเบียนมาตรฐานของกลุ่ม\n` +
          'ตัดออกจากใบได้ แต่จอจะเตือนว่าใบนี้ขาดข้อบังคับตลอด\n\nยืนยันตัดออก?')) return prev;
        next.delete(it.id);
      } else next.add(it.id);
      return next;
    });
  };

  /* เกลี่ยน้ำหนัก "ส่วนที่เหลือของใบ" ให้ข้อใหม่ — ปัดลง 0.5 แล้วโยนเศษที่เหลือไปข้อแรก
     ⚠️ เป็นปุ่มให้กดเอง **ไม่ทำอัตโนมัติตอนบันทึก** — น้ำหนักคือดุลพินิจของหัวหน้าหน่วยงาน
        ระบบเสนอได้ แต่ห้ามตัดสินแทน */
  const spreadWeights = () => {
    const ids = kpiRows.filter(r => picked.has(r.id)).map(r => r.id);
    if (!ids.length) { toast.info('ยังไม่ได้เลือกข้อไหนเลย'); return; }
    /* เกลี่ยเฉพาะ "ส่วนที่เหลือ" — ข้อที่ตั้งไว้แล้วถือน้ำหนักของมันอยู่ เกลี่ยทับไม่ได้จากจอนี้ */
    const budget = Math.round((KPI_TOTAL_WEIGHT - existWeight) * 100) / 100;
    if (budget <= 0) {
      toast.info(`ข้อที่ตั้งไว้แล้วกินน้ำหนักครบ ${existWeight}/${KPI_TOTAL_WEIGHT} — ต้องไปลดน้ำหนักข้อเดิมที่ ✏️ ก่อน`);
      return;
    }
    const each = Math.floor((budget / ids.length) * 2) / 2;
    const rest = Math.round((budget - each * ids.length) * 100) / 100;
    const next = {};
    ids.forEach((id, i) => { next[id] = String(i === 0 ? Math.round((each + rest) * 100) / 100 : each); });
    setWeights(next);
    toast.info(`เกลี่ย ${budget} ให้ ${ids.length} ข้อใหม่แล้ว (ของเดิมถือไว้ ${existWeight}) — แก้รายข้อได้ตามจริง`);
  };

  /* ── 5) บันทึก: ทะเบียนชื่อ (kpi_catalog) ก่อน แล้วค่อยสร้างนิยาม ───────────────── */
  const save = async () => {
    /* `picked` ไม่มีแถวที่ตั้งไว้แล้วอยู่แล้ว (ดูหัวข้อ 3) — กรองซ้ำอีกชั้นกันเคส
       `existingDefs` เพิ่งเปลี่ยนจาก session อื่นระหว่างที่โมดัลเปิดค้าง */
    const todo = kpiRows.filter(r => picked.has(r.id) && !isAlready(r));
    if (!todo.length) { toast.info('ยังไม่ได้เลือกข้อไหนเลย'); return; }
    const skipped = kpiRows.filter(r => picked.has(r.id)).length - todo.length;
    if (!window.confirm(
      `สร้าง KPI ${todo.length} ข้อ สำหรับปี ${year + 543}` +
      `\nขอบเขต: ${group ? `กลุ่มไลน์ ${group}` : section ? `ส่วนงาน ${section}` : 'ทั้งโรงงาน'}` +
      (skipped ? `\n(ข้าม ${skipped} ข้อที่ตั้งไว้แล้ว)` : '') +
      '\n\n⚠️ สร้างเฉพาะ "หัวข้อ + สูตร + น้ำหนัก" — Commitment/Target ยังว่าง ต้องไปตั้งทีละข้อที่ปุ่ม ✏️')) return;

    setSaving(true);
    try {
      /* (ก) ทะเบียนชื่อ — อ่านสดทุกครั้ง ห้ามใช้ของที่ค้างในจอ (session อื่นอาจเพิ่งเพิ่มชื่อ) */
      const readCat = async () => {
        const { data, error } = await supabase.from('kpi_catalog').select('id, name');
        if (error) { toast.error('อ่านทะเบียนชื่อ KPI ไม่สำเร็จ: ' + error.message); return null; }
        return new Map((data || []).map(c => [normName(c.name), c.id]));
      };
      let catMap = await readCat();
      if (!catMap) return;

      /* ⚠️ ตัดชื่อซ้ำใน batch เดียวกันออกก่อน — `normName` ของเรายุบช่องว่างซ้ำด้วย (`A  B` = `A B`)
         แต่ unique index ของ DB เป็น `lower(btrim(name))` ซึ่ง **ไม่ยุบช่องว่างกลางคำ**
         ⇒ ทะเบียนกลุ่มที่ถอดจาก PDF มี double space ปนอยู่ ถ้าไม่ตัดซ้ำ จะได้ 2 แถวในทะเบียน
           ที่โค้ดเรามองว่าเป็นชื่อเดียวกัน → `catMap` เก็บได้ id เดียว → นิยาม 2 ข้อชี้ catalog เดียวกัน
           → ข้อที่สองตก 23505 ตอน insert */
      const seen = new Set();
      const missing = todo.filter(r => {
        const k = normName(r.topic);
        if (catMap.has(k) || seen.has(k)) return false;
        seen.add(k); return true;
      });
      if (missing.length) {
        const { error } = await supabase.from('kpi_catalog').insert(missing.map(r => ({
          name: String(r.topic).trim(), category: r.perspective,
          formula_text: r.formula_text || null,
        })));
        /* 23505 = ชื่อซ้ำ (อีก session เพิ่งเพิ่ม) — ไม่ใช่ความล้มเหลว อ่านทะเบียนใหม่แล้วไปต่อ */
        if (error && error.code !== '23505') {
          toast.error('เพิ่มชื่อเข้าทะเบียนไม่สำเร็จ: ' + error.message);
          return;
        }
        catMap = await readCat();
        if (!catMap) return;
      }

      const noCat = todo.filter(r => !catMap.has(normName(r.topic)));
      if (noCat.length) {
        /* ไม่เงียบ ไม่สร้างแถวที่ไม่ผูกทะเบียน — แถวไม่ผูกทะเบียนเทียบข้ามปีไม่ได้
           (`kpi_definitions_year_scope_catalog_uniq` ก็ไม่คุมมันด้วย ⇒ ซ้ำได้ไม่จำกัด) */
        toast.error(`เพิ่มชื่อเข้าทะเบียนไม่ครบ ${noCat.length} ข้อ (${noCat[0].topic}…) — ยังไม่สร้าง KPI`);
        return;
      }

      /* (ข) นิยาม — ส่ง section/line_group ให้ trigger `fn_kpi_def_scope_sync` แปลงเป็น scope เอง
             ⚠️ **ไม่ใส่ commitment/target/target_value/direction** โดยตั้งใจ (ดูกฎ "ไม่เดาเป้า" หัวไฟล์) */
      const payload = todo.map(r => ({
        year, section: section || null, line_group: group || null,
        category: r.perspective, catalog_id: catMap.get(normName(r.topic)),
        name: String(r.topic).trim(), formula_text: r.formula_text || null,
        seq: r.sort_order, seq_label: r.seq || null,
        weight: num(weights[r.id]),
        std_unit: unit, std_item_id: r.id, source: 'manual',
      }));
      const { data: ins, error } = await supabase.from('kpi_definitions').insert(payload).select('id');
      if (error || !ins?.length) {
        /* 23505 ตรงนี้แปลว่ามี "แถวที่จอมองไม่เห็น" ถือคีย์อยู่ — เกือบทุกครั้งคือแถวที่ถูกปิดใช้งาน
           (`is_active = false`) ซึ่งยังกินคีย์ `(year, scope, catalog_id)` อยู่ · บอกทางออกให้ตรงจุด
           ห้ามปล่อยข้อความ postgres ดิบให้คนหน้างานอ่านเอง */
        toast.error(error?.code === '23505'
          ? 'มี KPI ข้อนี้อยู่ในขอบเขตนี้แล้ว แต่ถูกปิดใช้งานไว้ (ไม่ขึ้นบนจอ) — เปิดคืนจากฐานข้อมูล หรือเปลี่ยนขอบเขตก่อน'
          : 'สร้าง KPI ไม่สำเร็จ' + (error ? ': ' + error.message : ' (ไม่มีสิทธิ์ kpi:manage)'));
        return;
      }
      toast.success(`สร้าง KPI ${ins.length} ข้อแล้ว — ไปตั้ง Commitment/Target ทีละข้อที่ปุ่ม ✏️ ได้เลย`);
      onDone?.();
      onClose?.();
    } finally { setSaving(false); }
  };

  const box = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' };
  const selSt = w => ({ ...box, width: w, padding: '6px 9px', fontSize: 13 });
  const btnSt = { padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' };
  const th = { padding: '6px 8px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', borderBottom: '1px solid var(--border2)', textAlign: 'left', whiteSpace: 'nowrap' };
  const td = { padding: '5px 8px', fontSize: 12, color: 'var(--text2)', borderBottom: '1px solid var(--border)', verticalAlign: 'top' };

  const scopeText = group ? `กลุ่มไลน์ ${group}` : section ? `ส่วนงาน ${section}` : 'ทั้งโรงงาน (ไม่เลือกส่วนงาน)';
  const pickedCount = kpiRows.filter(r => picked.has(r.id)).length;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: '#0008', zIndex: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
        width: 'min(1040px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column',
      }}>
        {/* ── หัว ── */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>🧩 ตั้งชุด KPI จากทะเบียนมาตรฐานของกลุ่ม</span>
            <button onClick={onClose} style={{ ...btnSt, marginLeft: 'auto' }}>ปิด</button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6, lineHeight: 1.7 }}>
            ที่มา: <b>KPI Guideline 2026 (as of 29.01.2026) ส่วนที่ 2 — KPI Standard</b> ·
            แต่ละหน่วยงานหยิบข้อ <b style={{ color: '#ef4444' }}>บังคับ (Fixed)</b> ทั้งหมด
            + ติ๊ก <b style={{ color: '#3b82f6' }}>เลือกได้ (Choice)</b> เท่าที่ต้องการ แล้วถ่วงน้ำหนักให้รวม <b>{KPI_TOTAL_WEIGHT}</b>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
            <label style={{ fontSize: 12, color: 'var(--text2)' }}>หน่วยงานมาตรฐาน</label>
            <select value={unit} onChange={e => { setUnit(e.target.value); setRegYear(null); }} style={selSt(290)}>
              <option value="">— เลือกหน่วยงาน —</option>
              {KPI_STD_UNITS.map(u => {
                const has = (avail?.get(u.unit) || []).length > 0;
                return (
                  <option key={u.unit} value={u.unit} disabled={!has}>
                    {stdUnitLabel(u.unit)}{has ? '' : ' — ยังไม่มีในทะเบียน'}
                  </option>
                );
              })}
            </select>
            {unitYears.length > 1 && (
              <>
                <label style={{ fontSize: 12, color: 'var(--text2)' }}>รุ่นทะเบียน</label>
                <select value={useYear ?? ''} onChange={e => setRegYear(+e.target.value)} style={selSt(110)}>
                  {unitYears.map(y => <option key={y} value={y}>{y + 543}</option>)}
                </select>
              </>
            )}
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              จะสร้างลงปี <b style={{ color: 'var(--text)' }}>{year + 543}</b> · ขอบเขต <b style={{ color: 'var(--text)' }}>{scopeText}</b>
            </span>
          </div>
          {unit && useYear != null && useYear !== year && (
            <div style={{ fontSize: 11.5, color: '#f59e0b', marginTop: 6 }}>
              ⚠️ ทะเบียนไม่มีรุ่นปี {year + 543} — กำลังใช้รุ่น <b>{useYear + 543}</b> เป็นแม่แบบ
              (เอกสารกลุ่มออกเป็นรุ่นปี ไม่ได้ออกทุกปี)
            </div>
          )}
          <ReadOnlyNote show={!canManage} role={role} compact what="ตั้งชุด KPI" permKey="kpi:manage" />
        </div>

        {/* ── ตาราง ── */}
        <div style={{ flex: 1, overflow: 'auto', padding: '4px 16px' }}>
          {avail == null && <div style={{ padding: 20, fontSize: 13, color: 'var(--muted)' }}>กำลังโหลดทะเบียน…</div>}
          {avail != null && !unit && (
            <div style={{ padding: 20, fontSize: 13, color: 'var(--muted)', lineHeight: 1.8 }}>
              เลือกหน่วยงานมาตรฐานด้านบนก่อน — ระบบจะเติมข้อ <b>บังคับ</b> ให้ครบเอง
              แล้วคุณติ๊กเฉพาะข้อ <b>เลือกได้</b><br />
              <span style={{ color: '#f59e0b' }}>
                หน่วยงาน TSA 4 ตัว (Accounting-TSA · HRM-TSA · Internal Audit-TSA · AOBM-TSA)
                ยังไม่มีในทะเบียน — ตารางต้นฉบับซ้อนข้อย่อยหลายชั้นจนนับ Fixed/Choice ไม่ตรง PDF
                จึงตั้งใจยังไม่ใส่ (ใส่ผิดแย่กว่าไม่ใส่)
              </span>
            </div>
          )}
          {loading && <div style={{ padding: 20, fontSize: 13, color: 'var(--muted)' }}>กำลังโหลดรายการ…</div>}
          {!loading && unit && items && !rows.length && (
            <div style={{ padding: 20, fontSize: 13, color: '#f59e0b' }}>ทะเบียนรุ่นนี้ไม่มีรายการของ {unit}</div>
          )}
          {!loading && rows.length > 0 && (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 34 }} />
                  <th style={{ ...th, width: 46 }}>ข้อ</th>
                  <th style={th}>หัวข้อ KPI / สูตรตามเอกสาร</th>
                  <th style={{ ...th, width: 74 }}>ประเภท</th>
                  <th style={{ ...th, width: 92, textAlign: 'right' }}>น้ำหนัก</th>
                </tr>
              </thead>
              <tbody>
                {PERSPECTIVES.filter(p => rows.some(r => r.perspective === p.key)).map(p => ([
                  <tr key={p.key}>
                    <td colSpan={5} style={{ ...td, fontWeight: 800, color: 'var(--text)', background: 'var(--bg2)' }}>{p.label}</td>
                  </tr>,
                  ...rows.filter(r => r.perspective === p.key).map(it => {
                    const parent = isStdParent(it);
                    const req = requirementOf(it.requirement);
                    const on = picked.has(it.id);
                    const dup = !parent && isAlready(it);
                    return (
                      <tr key={it.id} style={parent ? { background: 'var(--bg3)' } : undefined}>
                        <td style={{ ...td, textAlign: 'center' }}>
                          {parent ? (
                            <span title="แถวหัวข้อแม่ — ไม่ใช่ KPI ที่ให้คะแนนเอง ข้อย่อยอยู่ใต้มัน"
                              style={{ fontSize: 12, color: 'var(--muted)' }}>▾</span>
                          ) : (
                            /* แถวที่ตั้งไว้แล้วโชว์ติ๊กค้าง (สื่อว่า "มีแล้ว") แต่ **ไม่อยู่ใน `picked`**
                               ⇒ ไม่ถูกนับในตัวนับน้ำหนัก/จำนวนข้อที่จะสร้าง */
                            <input type="checkbox" checked={dup || on} disabled={!canManage || dup}
                              onChange={() => toggle(it)} style={{ width: 'auto', cursor: canManage && !dup ? 'pointer' : 'default' }} />
                          )}
                        </td>
                        <td style={{ ...td, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{it.seq}</td>
                        <td style={td}>
                          <b style={{ color: parent ? 'var(--muted)' : 'var(--text)', fontSize: 12.5 }}>{it.topic}</b>
                          {dup && <span style={{ marginLeft: 6, fontSize: 10.5, color: '#22c55e' }}>✓ ตั้งไว้แล้วในขอบเขตนี้</span>}
                          <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 1 }}>
                            {it.formula_text || '—'}
                            {/^\s*\*?\s*refer to/i.test(it.formula_text || '') && (
                              <span style={{ color: '#f59e0b' }}> · เกณฑ์อยู่ในประกาศแยก ยังไม่มีในระบบ — ตั้งเป้าเองหลังสร้าง</span>
                            )}
                          </div>
                        </td>
                        <td style={td}>
                          {req && (
                            <span title={req.hint} style={{
                              fontSize: 10.5, fontWeight: 800, color: req.color,
                              border: `1px solid ${req.color}`, borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap',
                            }}>{req.label}</span>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          {!parent && on && !dup && (
                            <input type="number" step="0.5" min="0" value={weights[it.id] ?? ''}
                              disabled={!canManage} placeholder="—"
                              onChange={e => setWeights(w => ({ ...w, [it.id]: e.target.value }))}
                              style={{ ...box, width: 76, padding: '3px 6px', fontSize: 12, textAlign: 'right' }} />
                          )}
                        </td>
                      </tr>
                    );
                  }),
                ]))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── ท้าย: ตัวนับน้ำหนัก + ข้อบังคับที่ขาด (เตือนเท่านั้น ห้ามบล็อก) ── */}
        {rows.length > 0 && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>
              {existRows.length > 0 && (
                <span style={{ color: 'var(--muted)' }}>
                  มีอยู่แล้ว {existRows.length} ข้อ ({existWeight}) +{' '}
                </span>
              )}
              เพิ่มใหม่ <b style={{ color: 'var(--text)' }}>{pickedCount}</b> ข้อ ({newWeight}) ·
              รวมทั้งใบ{' '}
              <b style={{ color: check.diff === 0 ? '#22c55e' : '#f59e0b', fontSize: 14 }}>{check.weight}</b>
              <span style={{ color: 'var(--muted)' }}> / {KPI_TOTAL_WEIGHT}</span>
              {check.diff !== 0 && (
                <span style={{ color: '#f59e0b' }}> ({check.diff > 0 ? `เกิน ${check.diff}` : `ขาด ${-check.diff}`})</span>
              )}
            </span>
            {canManage && <button onClick={spreadWeights} style={btnSt} title={`แบ่งน้ำหนักเท่าๆ กันให้รวม ${KPI_TOTAL_WEIGHT} — แก้รายข้อต่อได้`}>⚖️ เกลี่ยให้ครบ {KPI_TOTAL_WEIGHT}</button>}
            {check.missingFixed.length > 0 && (
              <span style={{ fontSize: 11.5, color: '#ef4444' }}>
                ⚠️ ขาดข้อบังคับ {check.missingFixed.length} ข้อ: {check.missingFixed.slice(0, 3).map(m => m.topic).join(' · ')}
                {check.missingFixed.length > 3 ? ' …' : ''}
              </span>
            )}
            <button onClick={save} disabled={!canManage || saving || !pickedCount}
              style={{
                ...btnSt, marginLeft: 'auto', background: 'var(--accent)', color: '#fff',
                borderColor: 'var(--accent)', opacity: (!canManage || saving || !pickedCount) ? 0.5 : 1,
                cursor: (!canManage || saving || !pickedCount) ? 'default' : 'pointer',
              }}>
              {saving ? '⏳ กำลังสร้าง…' : `สร้าง KPI ${pickedCount} ข้อ`}
            </button>
          </div>
        )}
        {rows.length > 0 && (
          <div style={{ padding: '0 16px 12px', fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
            สร้างแล้วได้ <b>หัวข้อ + สูตร + น้ำหนัก</b> เท่านั้น — <b>Commitment / Target ยังว่าง</b>
            เพราะทะเบียนกลุ่มไม่ได้กำหนดเป้าของโรงงานเรา ต้องไปตั้งทีละข้อที่ปุ่ม ✏️
            · น้ำหนักไม่ครบ {KPI_TOTAL_WEIGHT} หรือขาดข้อบังคับ <b>บันทึกได้ปกติ</b> (เตือนไว้ให้เห็นเท่านั้น)
          </div>
        )}
      </div>
    </div>
  );
}
