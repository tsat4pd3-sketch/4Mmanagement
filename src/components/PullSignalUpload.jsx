/**
 * 📥 อัพโหลดสัญญาณดึงงานจากลูกค้า (e-SMART) → ยืนยัน/อัพเดทใบส่งในรอบนั้น
 *
 * ที่มา (user 2026-09-08 · ฝ่าย Logistic): ลูกค้า AAT เรียกงานไม่ตรงตาม EDI 862 · เขาส่ง e-SMART
 * มาให้ในพอร์ทัล user โหลดออกมาทุก 2 ชม. แล้วอัพเข้าระบบ
 *   "e-SMART คือข้อมูลที่อัพเดทสุดท้ายก่อนจะส่งของ **เหมือนการยืนยัน order จากลูกค้า**"
 *   "**ส่วนตัวไหนที่ไม่มีใน e-SMART แปลว่าตรงกับ 862**"
 *
 * กติกาที่ user เคาะ (2026-09-08) — เปลี่ยนเมื่อไหร่ต้องแก้เอกสารโมดูล logistic ด้วย:
 *   1. รอบส่ง = **ปลายช่วงเวลาในไฟล์ + lead_min** (milk-run ลูกค้ามารับ) — แก้ได้บนจอก่อนยืนยัน
 *   2. จำนวน = Σ(Containers Used × Part Quantity)
 *   3. ไม่มีใบ 862 ในรอบนั้น → **สร้างใหม่**
 *   4. ใบที่ `prepared` ขึ้นไป → **ไม่แตะ** แต่ต้องรายงานส่วนต่างให้เห็น (สต็อกอาจถูกหักไปแล้ว)
 *   5. พาร์ทที่ไม่อยู่ในไฟล์ → ไม่แตะเลย (ห้ามลบ ห้าม zero-out)
 *
 * ⚠️ สูตร/การตัดสินใจทั้งหมดอยู่ `src/utils/pullSignal.js` (pure · เทส 27 เคส) — ห้ามคำนวณซ้ำในไฟล์นี้
 * ⚠️ ทน migration ที่ยังไม่ apply: ตาราง/คอลัมน์ใหม่ไม่มี (42P01/42703) → บอกบนจอ **ห้ามเงียบ**
 */
import { useState, useCallback, useEffect, useMemo } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { checkWrite } from '../utils/dbWrite';
import { buildPnIndex, resolveMatNo } from '../utils/matResolve';
import {
  FALLBACK_PROFILE, pickProfile, parsePullFile, aggregateSignals,
  planOrderUpdates, signalKey, dateStr, timeStr, findDuplicateUploads,
} from '../utils/pullSignal';

const SOURCE = 'esmart';
const inputSt = {
  padding: '8px 10px', borderRadius: 8, fontSize: 13, background: 'var(--bg2)',
  border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--font-body)',
};
const th = { padding: '7px 8px', fontSize: 11, fontWeight: 800, color: 'var(--text2)', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const thR = { ...th, textAlign: 'right' };
const td = { padding: '6px 8px', fontSize: 12, borderBottom: '1px solid var(--border)' };
const tdR = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });

/* ป้ายผลการตัดสินต่อพาร์ท — สีสื่อความหมายเดียวกับทั้งระบบ (เขียว=ทำได้ · ส้ม=ต้องมีคนดู · เทา=ไม่ทำอะไร) */
const ACTION_META = {
  update:     { label: '✏️ อัพเดทยอด + ยืนยัน', color: '#22c55e' },
  create:     { label: '➕ สร้างใบใหม่',          color: '#0ea5e9' },
  same:       { label: '= ตรงกับ 862 อยู่แล้ว',   color: 'var(--muted)' },
  locked:     { label: '🔒 ทำไปแล้ว — ไม่แตะ',    color: '#f59e0b' },
  unresolved: { label: '⚠ จับคู่ MAT ไม่ได้',     color: '#ef4444' },
};

export default function PullSignalUpload({ open, onClose, onApplied, fullName, shipToMap }) {
  const [profiles, setProfiles] = useState(null);        // null = ยังไม่โหลด · [] = ตารางว่าง/ยังไม่ apply
  const [profileMissing, setProfileMissing] = useState(false);
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);            // ผลจาก parsePullFile + โปรไฟล์ที่ใช้
  const [shipTo, setShipTo] = useState('');
  const [workDate, setWorkDate] = useState('');
  const [shipTime, setShipTime] = useState('');
  const [orders, setOrders] = useState([]);
  const [dupKeys, setDupKeys] = useState(new Set());     // แถวที่เคยนำเข้าแล้ว (กันยอดทบ)
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ctxError, setCtxError] = useState('');
  // 🚨 alarm "ไฟล์นี้เคยอัพแล้ว" — เตือน ไม่บล็อก แต่ต้องติ๊กรับทราบก่อนถึงกดยืนยันได้
  const [dupUploads, setDupUploads] = useState([]);
  const [dupAck, setDupAck] = useState(false);

  /* ── โปรไฟล์รูปแบบไฟล์ (data-driven) — ยังไม่ apply migration = ใช้ค่าสำรองในโค้ด + บอกบนจอ ── */
  useEffect(() => {
    if (!open) return;
    let alive = true;
    supabaseDR.from('customer_pull_formats').select('*').eq('is_active', true).order('code')
      .then(({ data, error }) => {
        if (!alive) return;
        if (error || !data?.length) { setProfiles([FALLBACK_PROFILE]); setProfileMissing(true); }
        else { setProfiles(data); setProfileMissing(false); }
      });
    return () => { alive = false; };
  }, [open]);

  const reset = useCallback(() => {
    setFile(null); setParsed(null); setShipTo(''); setWorkDate(''); setShipTime('');
    setOrders([]); setDupKeys(new Set()); setProducts([]); setCtxError('');
    setDupUploads([]); setDupAck(false);
  }, []);

  /* ── อ่านไฟล์ (csv/xlsx ทางเดียวกัน — SheetJS อ่าน csv ได้) ────────────────────────── */
  const onFile = useCallback(async (f) => {
    if (!f) return;
    reset(); setFile(f); setLoading(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer(), { raw: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      // raw:true + defval:'' → ค่าคงเป็นข้อความ ไม่ให้ SheetJS เดา MDY/DMY แทนเรา (pullSignal.parseTs คุมเอง)
      const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      const { profile, guessed } = pickProfile(matrix, profiles || [FALLBACK_PROFILE]);
      const res = parsePullFile(matrix, profile);
      setParsed({ ...res, profile, guessed, rowsInFile: matrix.length });
      if (res.ok) {
        setShipTo(res.shipTo || '');
        setWorkDate(res.slot?.work_date || dateStr(new Date()));
        setShipTime(res.slot?.ship_time || '');
      }
    } catch (e) {
      setParsed({ ok: false, error: `อ่านไฟล์ไม่สำเร็จ: ${e.message}`, rows: [], warnings: [] });
    }
    setLoading(false);
  }, [profiles, reset]);

  /* ── โหลดบริบทปลายทาง: ใบส่งในรอบนั้น + แถวที่เคยนำเข้า ───────────────────────────
     ⚠️ แยกเป็นฟังก์ชันเพราะ **`apply()` ต้องเรียกซ้ำก่อนเขียนเสมอ** —
     เคสจริง 2026-09-09: ไฟล์เดียวกันถูกอัพ 2 ครั้งห่างกัน 4 วินาที · รอบที่ 2 ใช้ `plan` ที่คำนวณไว้
     ตั้งแต่ตอนเปิดไฟล์ (ยังไม่มีใบพวกนั้น) ⇒ **สร้างใบซ้ำอีกชุด 3 ใบ = ยอดเด้งเป็น 2 เท่า** */
  const fetchContext = useCallback(async () => {
    const [ordRes, sigRes] = await Promise.all([
      supabaseDR.from('customer_shipping_orders')
        .select('id, customer, mat_no, customer_part_no, part_name, qty, plan_qty, due_date, ship_time, status, dock_code, source, order_no')
        .eq('customer', shipTo).eq('due_date', workDate),
      (async () => {
        const times = (parsed?.rows || []).map(r => r.pulled_at.getTime());
        if (!times.length) return { data: [], error: null };
        const lo = new Date(Math.min(...times)), hi = new Date(Math.max(...times));
        return supabaseDR.from('customer_pull_signals')
          .select('ship_to, supplier_ref, customer_part_no, pulled_at')
          .eq('source', SOURCE).eq('ship_to', shipTo)
          .gte('pulled_at', lo.toISOString()).lte('pulled_at', hi.toISOString());
      })(),
    ]);
    return {
      // รอบเดียวกัน = ship_time ตรงระดับนาที (EDI เก็บเป็น text 'HH:MM' หรือ 'HH:MM:SS')
      orders: (ordRes.data || []).filter(o => String(o.ship_time || '').slice(0, 5) === shipTime),
      dupKeys: new Set((sigRes.data || []).map(r => signalKey({ ...r, pulled_at: new Date(r.pulled_at) }, SOURCE))),
      // ตารางยังไม่ apply (42P01) = ถือว่ายังไม่เคยนำเข้า แต่ต้องบอกบนจอ ห้ามเงียบ
      err: ordRes.error?.message || (sigRes.error ? `ยังตรวจการนำเข้าซ้ำไม่ได้: ${sigRes.error.message}` : ''),
    };
  }, [shipTo, workDate, shipTime, parsed]);

  /* ⚠️ guard คำตอบเก่าทับจอใหม่ (กฎ stale-response ของโปรเจค) — เปลี่ยนรอบ/ลูกค้าเร็วๆ ได้ */
  useEffect(() => {
    if (!open || !parsed?.ok || !shipTo || !workDate || !shipTime) { setOrders([]); return; }
    let alive = true;
    setLoading(true); setCtxError('');
    (async () => {
      const prodRes = await supabaseDR.from('dr_products').select('mat_no, p_no, customer, is_operation, is_active');
      const ctx = await fetchContext();
      if (!alive) return;
      if (prodRes.error) setCtxError(prodRes.error.message);
      else if (ctx.err) setCtxError(ctx.err);
      setProducts(prodRes.data || []);
      setOrders(ctx.orders);
      setDupKeys(ctx.dupKeys);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [open, parsed, shipTo, workDate, shipTime, fetchContext]);

  /* ── 🚨 ไฟล์นี้เคยอัพไปแล้วหรือยัง (user 2026-09-09: "ถ้าเป็นไฟล์เดียวกัน ให้ alarm ว่าอัพซ้ำ") ──
     เทียบระดับ **ไฟล์** ไม่ใช่ระดับแถว — คนต้องเห็นก่อนกด ไม่ใช่รู้ตัวตอนใบซ้ำไปแล้ว */
  useEffect(() => {
    if (!open || !parsed?.ok || !shipTo) { setDupUploads([]); return; }
    let alive = true;
    supabaseDR.from('customer_pull_batches')
      .select('id, file_name, window_start, window_end, work_date, ship_time, uploaded_by, uploaded_at, orders_updated, orders_created')
      .eq('source', SOURCE).eq('ship_to', shipTo)
      .order('uploaded_at', { ascending: false }).limit(50)
      .then(({ data, error }) => {
        if (!alive) return;
        // ตารางยังไม่ apply = ตรวจไม่ได้ แต่ไม่ใช่ "ไม่ซ้ำ" → ctxError บอกอยู่แล้วจากอีกจุด
        if (error) { setDupUploads([]); return; }
        setDupUploads(findDuplicateUploads(data, {
          fileName: file?.name, windowStart: parsed.windowStart, windowEnd: parsed.windowEnd,
        }));
        setDupAck(false);
      });
    return () => { alive = false; };
  }, [open, parsed, shipTo, file]);

  /* ── จับคู่ MAT: กรอง Product Master ด้วย "ชื่อลูกค้า" ของ ship-to ก่อนเสมอ ──────────────
     กฎเหล็ก (CLAUDE.md 2026-08-24): เลขพาร์ทลูกค้า 1 ตัว = หลายเลข SAP ต่างที่ลูกค้าปลายทาง
     RB3B-16E060-BA → 10100384 (FTM) · 10100385 (AAT) · 10106790 (FVL) — ไม่กรองก่อน = ambiguous ทุกตัว */
  const custName = shipToMap?.[shipTo]?.customer_name || null;
  const pnIndex = useMemo(() => {
    const norm = (s) => String(s || '').trim().toUpperCase();
    const scoped = custName && norm(custName) !== norm(shipTo)
      ? products.filter(p => norm(p.customer) === norm(custName))
      : products;
    return buildPnIndex(scoped.length ? scoped : products);
  }, [products, custName, shipTo]);
  const scopedByCustomer = !!custName && custName !== shipTo
    && products.some(p => String(p.customer || '').trim().toUpperCase() === String(custName).trim().toUpperCase());

  /* ── แผนที่จะทำ (pure) — แถวที่เคยนำเข้าแล้วถูกตัดออกก่อนรวมยอด ไม่งั้นยอดทบ ────────── */
  const fresh = useMemo(
    () => (parsed?.rows || []).filter(r => !dupKeys.has(signalKey(r, SOURCE))),
    [parsed, dupKeys]);
  const dupCount = (parsed?.rows?.length || 0) - fresh.length;
  const groups = useMemo(() => aggregateSignals(fresh), [fresh]);
  const plan = useMemo(
    () => planOrderUpdates(groups, orders, (p) => resolveMatNo(p, pnIndex)),
    [groups, orders, pnIndex]);

  const tally = useMemo(() => {
    const t = { update: 0, create: 0, same: 0, locked: 0, unresolved: 0 };
    plan.forEach(x => { t[x.action] = (t[x.action] || 0) + 1; });
    return t;
  }, [plan]);
  const willWrite = tally.update + tally.create;
  const blockedByDup = dupUploads.length > 0 && !dupAck;

  /* ── ยืนยัน — เขียนจริง ───────────────────────────────────────────────────────────── */
  const apply = async () => {
    if (!willWrite) { toast.error('ไม่มีรายการที่ต้องเขียน'); return; }
    setSaving(true);

    /* 🔴 re-plan จาก "ของจริง ณ วินาทีนี้" ก่อนเขียนเสมอ — plan บนจอถูกคำนวณตอนเปิดไฟล์
       ระหว่างนั้นอาจมีคนอัพไฟล์เดียวกันไปแล้ว/กดปุ่มรอบสอง (เกิดจริง 2026-09-09 ห่างกัน 4 วินาที)
       เชื่อ plan เก่า = สร้างใบซ้ำทั้งชุด · ตัวกันซ้ำที่ DB เป็นด่านสุดท้าย ไม่ใช่ด่านเดียว */
    const live = await fetchContext();
    if (live.err) { toast.error(`ตรวจสถานะล่าสุดไม่สำเร็จ: ${live.err}`); setSaving(false); return; }
    const liveGroups = aggregateSignals((parsed.rows || []).filter(r => !live.dupKeys.has(signalKey(r, SOURCE))));
    const plan = planOrderUpdates(liveGroups, live.orders, (pn) => resolveMatNo(pn, pnIndex));
    const liveWrite = plan.filter(x => x.action === 'update' || x.action === 'create').length;
    if (!liveWrite) {
      toast.info('ไฟล์นี้ถูกนำเข้าไปแล้ว — ไม่มีอะไรต้องอัพเดทเพิ่ม');
      setSaving(false); reset(); onClose?.(); return;
    }
    setOrders(live.orders); setDupKeys(live.dupKeys);
    const fresh = (parsed.rows || []).filter(r => !live.dupKeys.has(signalKey(r, SOURCE)));

    const now = new Date().toISOString();
    const stamp = { confirm_source: SOURCE, confirmed_at: now };

    // 1) ก้อนการนำเข้า — ทำเป็น "ร่องรอย" ก่อน แล้วค่อยเขียนใบ (ล้มกลางทางยังสืบได้ว่าไฟล์ไหน)
    const batchRow = {
      source: SOURCE, format_code: parsed.profile?.code || null, ship_to: shipTo,
      file_name: file?.name || null, work_date: workDate, ship_time: shipTime,
      window_start: parsed.windowStart ? parsed.windowStart.toISOString() : null,
      window_end: parsed.windowEnd ? parsed.windowEnd.toISOString() : null,
      row_count: parsed.rows.length, new_signals: fresh.length, uploaded_by: fullName || null,
    };
    const bRes = await supabaseDR.from('customer_pull_batches').insert(batchRow).select('id').single();
    if (bRes.error) {
      // ตารางยังไม่ apply = เขียนใบส่งได้อยู่ แต่จะไม่มีร่องรอย → ถามก่อน ห้ามเงียบ
      const go = window.confirm(`บันทึกประวัติการนำเข้าไม่ได้ (${bRes.error.message})\nยังจะอัพเดทใบส่งต่อไหม? (จะไม่มีบันทึกว่ามาจากไฟล์ไหน)`);
      if (!go) { setSaving(false); return; }
    }
    const batchId = bRes.data?.id || null;

    // 2) แถวดิบ = หลักฐาน ห้ามแก้ · ชนคีย์กันซ้ำที่ DB → upsert ignoreDuplicates (ปลอดภัยกว่าเช็คฝั่ง client อย่างเดียว)
    //    ล้มแล้วต้องไปโผล่ในสรุปท้าย ห้ามให้ toast เขียวกลบ
    let sigErr = null;
    if (fresh.length) {
      const matOf = new Map(plan.map(x => [x.group.customer_part_no, x.mat]));
      const recs = fresh.map(r => ({
        batch_id: batchId, source: SOURCE, ship_to: r.ship_to || shipTo,
        supplier_ref: r.supplier_ref, customer_part_no: r.customer_part_no, part_name: r.part_name,
        pulled_at: r.pulled_at.toISOString(), containers: r.containers,
        qty_per_container: r.qty_per_container, qty: r.qty, dock_code: r.dock_code,
        market_area: r.market_area, market_rack: r.market_rack, lsa: r.lsa, lp: r.lp,
        window_start: parsed.windowStart ? parsed.windowStart.toISOString() : null,
        window_end: parsed.windowEnd ? parsed.windowEnd.toISOString() : null,
        work_date: workDate, ship_time: shipTime, mat_no: matOf.get(r.customer_part_no) || null,
      }));
      /* ⚠️ `onConflict` ต้องเป็น **คอลัมน์ล้วนที่ตรงกับ unique index จริง** —
         เดิม index ใช้ `coalesce(supplier_ref, customer_part_no)` แล้วส่ง `supplier_ref` มา
         ⇒ Postgres หา constraint ไม่เจอ (42P10) ⇒ **แถวหลักฐานไม่ถูกบันทึกเลย** และแท็บประวัติกางออกมาว่าง
         (เกิดจริง 2026-09-09 · ตอนนี้ index เป็น `(source, ship_to, customer_part_no, pulled_at)` คอลัมน์ล้วน) */
      for (let i = 0; i < recs.length; i += 400) {
        const res = await supabaseDR.from('customer_pull_signals')
          .upsert(recs.slice(i, i + 400), { onConflict: 'source,ship_to,customer_part_no,pulled_at', ignoreDuplicates: true });
        if (res.error) { sigErr = res.error.message; checkWrite(res, 'บันทึกแถวสัญญาณดึง'); break; }
      }
    }

    // 3) ใบส่ง — อัพเดท/สร้าง เฉพาะพาร์ทที่อยู่ในไฟล์
    let updated = 0, created = 0; const failed = [];
    for (const x of plan) {
      if (x.action === 'update') {
        const patch = {
          qty: x.group.qty,
          // ยอดแผนเก็บ "ครั้งแรกที่ถูกยืนยัน" เท่านั้น — อัพซ้ำรอบสองห้ามทับด้วยยอดที่ยืนยันไปแล้ว
          plan_qty: x.order.plan_qty ?? x.order.qty,
          part_name: x.order.part_name || x.group.part_name || null,
          dock_code: x.order.dock_code || x.group.dock_code || null,
          status: x.order.status === 'pending' ? 'confirmed' : x.order.status,
          pull_batch_id: batchId, ...stamp,
        };
        // compare-and-swap กับสถานะที่อ่านมา — 2 คนอัพไฟล์พร้อมกัน/ใบเพิ่งถูกกดเตรียม = ต้องไม่ทับ
        let res = await supabaseDR.from('customer_shipping_orders').update(patch)
          .eq('id', x.order.id).eq('status', x.order.status).select('id');
        if (res.error?.code === '42703') {                    // migration ยังไม่ apply → ยอดยังอัพได้
          res = await supabaseDR.from('customer_shipping_orders')
            .update({ qty: patch.qty, part_name: patch.part_name, dock_code: patch.dock_code, status: patch.status })
            .eq('id', x.order.id).eq('status', x.order.status).select('id');
          if (!res.error) toast.info('ยังไม่ได้ apply migration — อัพเดทยอดให้แล้ว แต่ไม่ได้บันทึกว่ามาจาก e-SMART');
        }
        if (res.error) failed.push(`${x.group.customer_part_no}: ${res.error.message}`);
        else if (!res.data?.length) failed.push(`${x.group.customer_part_no}: ใบถูกเปลี่ยนสถานะไปแล้ว — โหลดใหม่แล้วลองอีกครั้ง`);
        else updated++;
      } else if (x.action === 'create') {
        const rec = {
          customer: shipTo, mat_no: x.mat, customer_part_no: x.group.customer_part_no,
          part_name: x.group.part_name || null, qty: x.group.qty, due_date: workDate,
          ship_time: shipTime, dock_code: x.group.dock_code || null,
          source: SOURCE, status: 'confirmed', pull_batch_id: batchId,
          created_by_name: fullName || null,   // 📜 ให้แท็บประวัติตอบได้ว่าใบนี้เกิดจากใครอัพไฟล์
          ...stamp,
        };
        let res = await supabaseDR.from('customer_shipping_orders').insert(rec).select('id');
        if (res.error?.code === '42703') {
          // eslint-disable-next-line no-unused-vars
          const { pull_batch_id, confirm_source, confirmed_at, created_by_name, ...slim } = rec;
          res = await supabaseDR.from('customer_shipping_orders').insert(slim).select('id');
        }
        if (res.error?.code === '23505') failed.push(`${x.group.customer_part_no}: มีใบของรอบนี้อยู่แล้ว (ด่านกันซ้ำที่ฐานข้อมูล) — กด ↻ แล้วลองใหม่`);
        else if (res.error) failed.push(`${x.group.customer_part_no}: ${res.error.message}`);
        else created++;
      }
    }

    if (batchId) {
      await supabaseDR.from('customer_pull_batches').update({
        orders_updated: updated, orders_created: created,
        orders_skipped: plan.filter(x => x.action === 'locked' || x.action === 'unresolved').length,
      }).eq('id', batchId);
    }
    setSaving(false);
    // ⚠️ ห้ามขึ้นเขียวล้วนเมื่อมีบางรายการล้ม (หลักเดียวกับ "กดส่งแล้วหักสต็อกไม่ได้ต้องรายงาน")
    if (sigErr) failed.push(`บันทึกแถวหลักฐานไม่สำเร็จ (แท็บประวัติจะกางดูรายการไม่ได้): ${sigErr}`);
    if (failed.length) toast.error(`อัพเดท ${updated} · สร้าง ${created} · ล้มเหลว ${failed.length} — ${failed[0]}`);
    else toast.success(`✅ ยืนยันจากลูกค้าแล้ว — อัพเดท ${updated} ใบ · สร้างใหม่ ${created} ใบ (รอบ ${shipTime})`);
    onApplied?.({ workDate, shipTime, updated, created });
    if (!failed.length) { reset(); onClose?.(); }
  };

  if (!open) return null;
  const rowsInFile = parsed?.rows?.length || 0;

  return (
    /* ⚠️ ไม่ปิดจาก backdrop — เป็นฟอร์มที่ตั้งค่ารอบ/ลูกค้าไว้แล้ว เผลอแตะแล้วต้องอัพไฟล์ใหม่ทั้งชุด */
    <div className="overlay" style={{ zIndex: 2400 }}>
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
        padding: 18, width: 'min(96vw, 1100px)', margin: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 900, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
            📥 อัพโหลด e-SMART — ยืนยัน order จากลูกค้า
          </span>
          <button className="tbtn" onClick={() => { reset(); onClose?.(); }}
            style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12, lineHeight: 1.6 }}>
          ไฟล์จากพอร์ทัลลูกค้า = <b>ยอดยืนยันสุดท้ายก่อนส่ง</b> · ระบบอัพเดท<b>เฉพาะพาร์ทที่อยู่ในไฟล์</b> ·
          พาร์ทที่ไม่อยู่ในไฟล์ถือว่า<b>ตรงกับ 862 อยู่แล้ว ไม่ถูกแตะ</b>
        </div>

        {profileMissing && (
          <div style={{ ...noteBox('#f59e0b'), marginBottom: 10 }}>
            ⚠ ยังอ่านทะเบียนรูปแบบไฟล์ (<code>customer_pull_formats</code>) ไม่ได้ — ใช้ค่าสำรองของ Ford e-SMART ในโค้ดแทน ·
            ถ้าไฟล์ลูกค้าเจ้าอื่นให้ apply migration <code>20260908_customer_pull_signals_esmart.sql</code> ก่อน
          </div>
        )}

        <label style={{
          display: 'block', border: '1px dashed var(--border2)', borderRadius: 10, padding: 14,
          textAlign: 'center', cursor: 'pointer', background: 'var(--bg2)', marginBottom: 12,
        }}>
          <input type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
            onChange={e => onFile(e.target.files?.[0])} />
          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)' }}>
            {file ? `📄 ${file.name}` : '📎 เลือกไฟล์ e-SMART (.csv / .xlsx)'}
          </span>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {file ? 'คลิกเพื่อเปลี่ยนไฟล์' : 'ระบบอ่านหัวไฟล์เพื่อรู้ช่วงเวลาและรูปแบบเอง'}
          </div>
        </label>

        {loading && <div style={{ fontSize: 12, color: 'var(--text2)' }}>⏳ กำลังอ่าน…</div>}

        {parsed && !parsed.ok && (
          <div style={noteBox('#ef4444')}>🔴 {parsed.error}</div>
        )}

        {parsed?.ok && (
          <>
            <div style={{ ...noteBox('#0ea5e9'), marginBottom: 10 }}>
              <b>{parsed.profile?.name}</b>{parsed.guessed && ' · ⚠ เดารูปแบบจากคอลัมน์ (ไม่เจอคำสำคัญในหัวไฟล์)'}
              {' · '}ช่วงเวลา {parsed.windowStart ? `${timeStr(parsed.windowStart)}–` : ''}{parsed.windowEnd ? timeStr(parsed.windowEnd) : '—'}
              {' · '}{rowsInFile} แถว{dupCount > 0 && ` · ⏭ เคยนำเข้าแล้ว ${dupCount} แถว (ไม่นับซ้ำ)`}
              {parsed.meta?.supplier_code && ` · GSDB ${parsed.meta.supplier_code}`}
            </div>
            {parsed.warnings.map((w, i) => <div key={i} style={{ ...noteBox('#f59e0b'), marginBottom: 6 }}>⚠ {w}</div>)}

            {/* 🚨 alarm อัพซ้ำ — เตือน ไม่บล็อก (อัพซ้ำมีเหตุผลที่ถูกต้องจริง เช่นรอบก่อนล้มกลางทาง)
                แต่ต้องติ๊กรับทราบก่อนถึงกดยืนยันได้ · สีแดงนิ่ง ไม่กระพริบ (กระพริบสงวนให้ Andon) */}
            {dupUploads.length > 0 && (
              <div style={{ ...noteBox('#ef4444'), marginBottom: 10 }}>
                <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 4 }}>
                  🚨 ไฟล์ชุดนี้เคยอัพเข้าระบบไปแล้ว {dupUploads.length > 1 ? `${dupUploads.length} ครั้ง` : ''}
                </div>
                {dupUploads.slice(0, 3).map(({ batch: b, reason }) => (
                  <div key={b.id} style={{ fontSize: 12, marginTop: 3 }}>
                    • {reason === 'same_file' ? 'ชื่อไฟล์เดียวกัน' : 'ช่วงเวลาเดียวกัน (คนละชื่อไฟล์)'}
                    {' — '}{whenText(b.uploaded_at)} โดย {b.uploaded_by || 'ไม่ระบุ'}
                    {b.ship_time && ` · ลงรอบ ${b.ship_time}`}
                    {' → '}อัพเดท {fmt(b.orders_updated)} ใบ · สร้าง {fmt(b.orders_created)} ใบ
                  </div>
                ))}
                <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6, lineHeight: 1.6 }}>
                  ยืนยันต่อได้ถ้าตั้งใจ (เช่นรอบก่อนล้มกลางทาง) — ระบบจะ<b>ไม่สร้างใบซ้ำ</b> เพราะเทียบกับของจริงก่อนเขียนเสมอ
                  และมีด่านกันซ้ำที่ฐานข้อมูลอีกชั้น · ถ้าไม่มีอะไรต้องแก้จริง ระบบจะบอกว่า “นำเข้าไปแล้ว” แล้วปิดให้เอง
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, cursor: 'pointer', fontSize: 12, fontWeight: 800 }}>
                  <input type="checkbox" checked={dupAck} onChange={e => setDupAck(e.target.checked)} />
                  รับทราบว่าเป็นไฟล์ซ้ำ — ยืนยันจะอัพต่อ
                </label>
              </div>
            )}

            <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginBottom: 10 }}>
              <Field label="ลูกค้า (Plant Code)">
                <select value={shipTo} onChange={e => setShipTo(e.target.value)} style={inputSt}>
                  {!shipTo && <option value="">— เลือก —</option>}
                  {[...new Set([shipTo, ...Object.keys(shipToMap || {})].filter(Boolean))].sort().map(c => (
                    <option key={c} value={c}>{shipToMap?.[c]?.customer_name && shipToMap[c].customer_name !== c ? `${shipToMap[c].customer_name} (${c})` : c}</option>
                  ))}
                </select>
              </Field>
              <Field label="วันงานที่ส่ง">
                <input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} style={inputSt} />
              </Field>
              <Field label={`รอบส่ง (ปลายช่วง +${parsed.profile?.lead_min ?? 60} นาที)`}>
                <input type="time" value={shipTime} onChange={e => setShipTime(e.target.value)} style={inputSt} />
              </Field>
            </div>

            {!shipToMap?.[shipTo] && shipTo && (
              <div style={{ ...noteBox('#f59e0b'), marginBottom: 8 }}>
                ⚠ <b>{shipTo}</b> ไม่มีในทะเบียน Ship-to — ชาร์ต/workflow ต่อลูกค้าจะไม่ครบ ตั้งได้ที่แท็บ ⚙️ Ship-to Config
              </div>
            )}
            {shipTo && !scopedByCustomer && (
              <div style={{ ...noteBox('#f59e0b'), marginBottom: 8 }}>
                ⚠ ยังไม่ได้ตั้ง “ชื่อลูกค้า” ให้ ship-to นี้ (หรือไม่มีสินค้าไหนใช้ชื่อนั้น) — เลขพาร์ทลูกค้า 1 ตัวชี้ได้หลาย MAT
                จึงอาจ<b>จับคู่ไม่ได้</b> · ตั้งที่ ⚙️ Ship-to Config ให้ตรงกับช่อง “ลูกค้า” ใน Product Master
              </div>
            )}
            {ctxError && <div style={{ ...noteBox('#ef4444'), marginBottom: 8 }}>🔴 {ctxError}</div>}

            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760, fontVariantNumeric: 'tabular-nums' }}>
                <thead><tr style={{ background: 'var(--bg2)' }}>
                  <th style={th}>เลขพาร์ทลูกค้า</th>
                  <th style={th}>MAT SAP</th>
                  <th style={thR}>ดึง (ครั้ง)</th>
                  <th style={thR}>ลูกค้ายืนยัน</th>
                  <th style={thR}>862 เดิม</th>
                  <th style={thR}>ส่วนต่าง</th>
                  <th style={th}>จะทำอะไร</th>
                </tr></thead>
                <tbody>
                  {plan.map((x, i) => {
                    const m = ACTION_META[x.action] || {};
                    return (
                      <tr key={i}>
                        <td style={{ ...td, fontWeight: 700 }}>{x.group.customer_part_no}
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{x.group.part_name || ''}</div></td>
                        <td style={{ ...td, fontFamily: 'monospace', color: x.mat ? '#0ea5e9' : 'var(--muted)' }}>{x.mat || '—'}</td>
                        <td style={tdR}>{x.group.pulls}</td>
                        <td style={{ ...tdR, fontWeight: 900 }}>{fmt(x.group.qty)}</td>
                        <td style={tdR}>{x.order ? fmt(x.order.qty) : '—'}</td>
                        <td style={{ ...tdR, fontWeight: 800, color: !x.order ? 'var(--muted)' : x.diff > 0 ? '#ef4444' : x.diff < 0 ? '#f59e0b' : 'var(--muted)' }}>
                          {x.order ? (x.diff > 0 ? `+${fmt(x.diff)}` : fmt(x.diff)) : '—'}
                        </td>
                        <td style={{ ...td, color: m.color, fontWeight: 700 }}>{m.label}
                          {x.reason && <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}>{x.reason}</div>}</td>
                      </tr>
                    );
                  })}
                  {!plan.length && (
                    <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--muted)' }}>
                      {dupCount > 0 ? 'ทุกแถวในไฟล์นี้เคยนำเข้าไปแล้ว — ไม่มีอะไรต้องอัพเดท' : 'ไม่มีรายการ'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--text2)', flex: '1 1 240px' }}>
                จะเขียน <b style={{ color: 'var(--accent)' }}>{willWrite}</b> ใบ
                (อัพเดท {tally.update} · สร้างใหม่ {tally.create})
                {tally.same ? ` · ตรงอยู่แล้ว ${tally.same}` : ''}
                {tally.locked ? ` · 🔒 ทำไปแล้ว ${tally.locked}` : ''}
                {tally.unresolved ? ` · ⚠ จับคู่ไม่ได้ ${tally.unresolved}` : ''}
              </span>
              <button onClick={() => { reset(); onClose?.(); }} style={{ ...inputSt, cursor: 'pointer', fontWeight: 700 }}>ยกเลิก</button>
              <button onClick={apply} disabled={saving || !willWrite || !shipTo || !shipTime || (dupUploads.length > 0 && !dupAck)}
                style={{
                  padding: '9px 18px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 800,
                  cursor: saving || !willWrite ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-body)',
                  background: willWrite && !blockedByDup ? 'var(--accent)' : 'var(--bg3)',
                  color: willWrite && !blockedByDup ? '#08130a' : 'var(--muted)',
                }}>
                {saving ? 'กำลังบันทึก…'
                  : blockedByDup ? '🚨 ติ๊กรับทราบไฟล์ซ้ำก่อน'
                  : `✅ ยืนยันอัพเดท (${willWrite})`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** เวลาแบบอ่านง่ายในกล่องเตือน — วันที่+เวลา (ไม่ใช้ toISOString: จะได้ UTC) */
const whenText = (v) => {
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const noteBox = (color) => ({
  padding: '7px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1.6,
  background: `${color}14`, border: `1px solid ${color}55`, color: 'var(--text)',
});

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>{label}</span>
      {children}
    </label>
  );
}
