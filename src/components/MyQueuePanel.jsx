/* ═══════════════════════════════════════════════════════════════════════════
   📌 คิวงานของฉัน — แผงในเมนูบัญชี                       2026-09-25 · คำสั่ง user

   *"กดดูบัญชีตัวเองแล้วเห็นงานค้างที่รอเรา"*

   กฎ/การแบ่งชั้นอยู่ `src/utils/myQueue.js` (pure · มีเทส) — ที่นี่รับผิดชอบแค่
   **โหลดแถว** กับ **วาด** · ห้ามตัดสินว่าใบไหนของใครในไฟล์นี้

   ── 🔴 กติกาที่ห้ามพลาด ────────────────────────────────────────────────────
   1. **ไม่ยิงอะไรหาใครเลย** — ตรงข้ามกับกระดิ่ง (19,095 แถว/7 วัน อ่าน 7.3%)
      คนเปิดดูเองเมื่ออยากรู้ ⇒ ไม่มีแถวใหม่ ไม่มี invocation ของ send-push
   2. **โหลดครั้งเดียวต่อ session** แล้วรีเฟรชเฉพาะตอนเปิดแผงและข้อมูลเก่าเกิน STALE
      (บทเรียน egress: จออะไรที่ยิงคิวรีทุกครั้งที่ render = ค่าโดยสารเงียบๆ)
   3. **เลือกเฉพาะคอลัมน์ที่ใช้** — `mtn_orders` มี 116 คอลัมน์ `select('*')` = 1.59 MB/ครั้ง
   4. **ว่างต้องขึ้น "ไม่มีงานค้าง" ห้ามซ่อนแผง** · โหลดไม่ครบต้องเขียนบนจอว่าไม่ครบ
      (ผู้ใช้ต้องแยก "เคลียร์หมดแล้ว" ออกจาก "คิวรีล่ม" ให้ได้)
   5. **แหล่งใหม่ต้องส่งทุกครั้ง** (ส่ง undefined = partial โดยตั้งใจ) — ปัจจุบัน: ใบ MO ·
      กะขอปิด · 4M · ใบติดตามงาน · คำขอขึ้นขั้นทักษะ · **🟡 ถังเหลืองรอพิจารณา (09/11)**
      ตารางถังไม่มีคอลัมน์ส่วนงาน ⇒ ที่นี่เติม `section` จากทะเบียนไลน์ให้ก่อนส่ง
   ═══════════════════════════════════════════════════════════════════════════ */
import { useCallback, useContext, useEffect, useState } from 'react';
import Icon, { stripIcon } from './Icon';
import { Link } from 'react-router-dom';
import { UserContext } from '../App';
import { supabase, supabaseDR } from '../supabaseClient';
import { getActor } from '../utils/actorStamp';
import { loadProductionLines } from '../utils/useProductionLines';
import { OPEN_MO_STATUSES, actorSideOf } from '../utils/mtnStepPerm';
import { isAmTeam } from '../utils/pmTeams';
import { amApproveAllowed } from '../utils/amApproval';
import { positionRank } from '../utils/positions';
import { can as canPerm, isActionSeeded, canSeeded as canSeededPerm, isSharedAccount } from '../utils/permissions';
import { teamKeyOf } from '../utils/mtnTeams';
import { pendingYellow } from '../utils/qualityBin';
import {
  TIER, TIER_TITLE, EMPTY_TEXT, OLD_DAYS, buildQueue, badgeCount, capped,
} from '../utils/myQueue';

import { tr } from '../utils/i18n';
/** ข้อมูลเก่ากว่านี้ = โหลดใหม่ตอนเปิดแผง (นาที) */
const STALE_MIN = 5;
/** เพดานแถวต่อคิวรี — คิวงานไม่ใช่รายงาน ไม่ต้องครบทุกแถวในโลก */
/* 🔴 เพดานแถวของคิว — ใบ MO ที่ยังเปิดอยู่โตเกิน 300 ไปนานแล้ว (วัด 22/10: **693 ใบ**)
   เดิม 300 + `order('work_date', asc)` = เก็บใบ**เก่าสุด** แล้วทิ้งใบใหม่ทั้งหมด
   ⇒ 393 ใบ (57%) ไม่เข้าคิวของใครเลย · ใบรอเซ็นปิด 107 ใบ เห็นแค่ 29 ⇒ ผจก.ฝ่ายที่แจ้ง
     เปิดคิวมาเจอ "ไม่มีงานที่รอคุณอยู่" ทั้งที่มี 51 ใบรออนุมัติ (เคสจริง 22/10 · คำสั่ง user)
   ⚠️ 1000 = เพดานแถวต่อคิวรีของ Supabase — เกินกว่านี้ต้องกรองฝั่ง server ไม่ใช่ขยายเลขอีก
      ⇒ ชนเพดานเมื่อไหร่ต้องติด `partial` ให้จอเขียนบอก **ห้ามตัดเงียบ**
   📌 26/10 — ยอดกอง (`moAll`) ใช้ชุดเดียวกันนี้ ไม่ยิงคิวรีซ้ำ: คิวรีเดียว filter/order/limit เท่ากัน
      ⇒ "ยอดกอง" กับ "รายการ" มาจากประชากรเดียวกันเสมอ (เลขไม่เถียงกันเอง · กฎ egress ข้อ 11) */
const LIMIT = 1000;

/* คอลัมน์ที่ "ใครรอใบนี้" ต้องใช้จริงเท่านั้น (myQueue.moWaitingOn + การวาดแถว) */
const MO_COLS = [
  'id', 'mo_no', 'work_date', 'current_step', 'status', 'dept_section', 'line_name',
  'machine_no', 'mtn_dept', 'item_type',
  /* 👥 `assigned_techs` = ตัวจริงของ "ช่างที่มอบหมาย" (array) · `assigned_to` คือสำเนาที่ต่อกันด้วย
     จุลภาคไว้ให้ใบพิมพ์อ่าน — ขาดคอลัมน์นี้ = `isMeAmong` ถอยไปแกะสตริง (ยังทำงาน แต่แม่นน้อยกว่า
     เมื่อชื่อมีจุลภาค) ⇒ select มาด้วยเสมอ (16/11) */
  'assigned_to', 'assigned_techs', 'tech_main', 'tech_main_uid',
  'reporter_prod', 'reporter_prod_uid', 'reported_by_name', 'reported_by_uid',
  // nextStepOf() ต้องใช้ตัดสินขั้นถัดไป (รอ QA หรือข้ามแล้ว · ช่วงเซ็นปิดของใบ MTN) — 05/10
  'qa_skipped_at', 'purpose', 'mtn_head_at', 'approve_at',
  /* 🔒 ด่านอนุมัติก่อนเริ่มงาน (`isApprovalBlocked`) — 13/10
     🔴 ขาดช่องใดช่องหนึ่ง = undefined = "ไม่รู้" ⇒ ใบที่รอ ผจก.เซ็น ตกกลับไปนับเป็น
        "รอช่างรับงาน" เงียบๆ แล้วไม่เข้าชั้น `mine` ของใครเลย (อาการที่ user เจอ)
     `dept_manager_name` = เกณฑ์ "ชื่ออยู่ในใบ" ของ canSignMtnApproval() */
  'dept_manager_at', 'plant_manager_at', 'dept_manager_name', 'plant_manager_name',
].join(', ');

const DEAD = ['cancelled', 'rejected'];

export async function loadMyQueue(me) {
  /* ยิงขนานกัน — ทุกก้อนแยก error ของตัวเอง: ก้อนไหนล่มส่ง undefined ให้ buildQueue
     แล้วมันจะติด `partial` ให้เอง (ห้ามกลืนเป็น [] = จอจะบอกว่า "ไม่มีงาน" ทั้งที่ไม่รู้) */
  const ok = (r) => (r.error ? undefined : (r.data || []));

  const canLu = !!(me.canLevelUp || me.canLevelUp100);
  const [moR, sesR, prR, moPrR, fourR, actR, lines, luR, binR, binRedR, redPendR, rfqAssessR, gapR, gapOdR, amR, wfR] = await Promise.all([
    /* กรองด้วยสถานะที่ยังมีคนต้องทำต่อ — เดิม `.gt('current_step', 1)` ตัดใบ "รอจ่ายงาน" (current_step = 1)
       ทิ้งทั้งหมด และ `.is('approve_at', null)` ตัดใบ MTN ที่อนุมัติแล้วแต่ยังรอปิดใบ (ขั้น 8) */
    supabaseDR.from('mtn_orders').select(MO_COLS)
      .in('status', OPEN_MO_STATUSES)
      .order('work_date', { ascending: true }).limit(LIMIT),
    supabaseDR.from('production_sessions').select('id, line_name, section, shift, work_date')
      .eq('status', 'pending_close').order('work_date', { ascending: true }).limit(100),
    supabaseDR.from('purchase_requests').select('id', { count: 'exact', head: true })
      .is('ordered_at', null),
    /* 🛒 23/11 — ใบขอซื้อของใบ MO (คนละตารางกับ `purchase_requests` ข้างบน)
       ใช้ตอบว่า "ใบนี้ติดลูป PR อยู่ไหม" ⇒ ใบที่ติดอยู่ **ห้ามนับเป็น "รอคุณเซ็น"**
       (หน้างาน 23/11: *"รอเรา 7 ใบ แต่เป็นใบอยู่ loop pr ซึ่งมันไม่ได้รอเราไง"*)
       🔴 เลือก 3 คอลัมน์พอ · ล้ม = ส่ง undefined ⇒ `prOf` เป็น null = พฤติกรรมเดิม ไม่ตัดใบทิ้งมั่ว */
    /* cap-ok: mtn_purchase_requests ทั้งตาราง 32 แถว · เข้าเงื่อนไขคิวรีนี้ 26 แถว (วัด 23/11)
       โตเกิน 1000 เมื่อไหร่ต้องเปลี่ยนเป็น fetchAllRows */
    supabaseDR.from('mtn_purchase_requests').select('order_id, status, po_no')
      .neq('status', 'cancelled').not('order_id', 'is', null).limit(1000),
    supabase.from('four_m_logs').select('id, work_date, line_name, category, description, status')
      .in('status', ['pending', 'pending_qa']).order('work_date', { ascending: true }).limit(200),
    supabase.from('meeting_action_items').select('id, problem, section, line_name, assignee, due_date, meeting_date, status')
      .in('status', ['open', 'doing']).order('due_date', { ascending: true, nullsFirst: false }).limit(100),
    loadProductionLines().catch(() => []),          // มี cache ร่วมกับ picker — ปกติไม่ยิงคิวรีเพิ่ม
    /* ⬆️ คำขอขึ้นขั้นทักษะ — โหลดเฉพาะคนที่อนุมัติได้ (ไม่มีสิทธิ์ = ไม่ยิงคิวรีเลย) · ส่วนงานมาจากตัวพนักงาน */
    canLu
      ? supabase.from('skill_level_up_requests').select('id, to_level, requested_at, employees!inner(section, is_active)')
        .eq('status', 'pending').eq('employees.is_active', true).limit(500)
      : Promise.resolve({ data: null, error: null }),
    /* 🟡 ถังเหลืองรอพิจารณา — เงื่อนไขเดียวกับแผงในหน้าถัง (`pendingYellow`) · เลือกเฉพาะคอลัมน์ที่คิวใช้
       (ตารางนี้กว้าง — `select('*')` คือตัวกิน egress · กฎเขียน DB ข้อ 11) */
    supabaseDR.from('quality_bin_records')
      .select('id, bin, is_active, work_date, line_name, mat_no, part_name, part_no, qty, cause, qa_decision, return_date, special_use_doc_no, repair_date, qty_ng')
      .eq('bin', 'yellow').eq('is_active', true)
      /* 🔴 ตัดสินแล้วแต่ยังไม่จบ = ยังค้าง (บั๊ก A 10/11) — ตัด "งานดี" ฝั่ง server ที่เหลือตัดสินด้วย pendingYellow() */
      .or('qa_decision.is.null,qa_decision.neq.good').is('return_date', null)
      .order('work_date', { ascending: true }).limit(200),
    /* ใบเหลืองที่ย้ายลงถังแดงไปแล้ว = ออกจากคิว (ไม่งั้นเป็น "ของค้างเทียม" ที่ทำให้คนเลิกเชื่อจอ)
       แถวจริงตอนนี้ 0 — แต่ต้องถามไว้ เพราะทางย้ายมือยังเปิดอยู่ในหน้าถัง */
    supabaseDR.from('quality_bin_records').select('from_yellow_id')
      .eq('bin', 'red').eq('is_active', true).not('from_yellow_id', 'is', null).limit(1000),
    /* 🔴 ถังแดงยังไม่ออกใบ (10/11) — หัวหน้าแผนกต้องเห็นเพื่อทวงหัวหน้าไลน์ · เฉพาะคอลัมน์ที่คิวใช้
       ⚠️ นับเฉพาะ "ยังไม่ผูกใบ" — ผูกใบร่างแล้วดูที่หน้าถัง (ขึ้นส้ม "ร่าง · ยังไม่ส่งอนุมัติ") */
    supabaseDR.from('quality_bin_records').select('id, work_date, line_name, qty')
      .eq('bin', 'red').eq('is_active', true).is('scrap_report_id', null)
      .order('work_date', { ascending: true }).limit(300),
    /* 📐 RFQ ที่รอ IEC ประเมิน (เฟส 2a · 13/11) — โหลดเฉพาะคนที่มีสิทธิ์ rfq:assess (IEC ทั้งทีม) · Main project */
    me.canRfqAssess
      ? supabase.from('mkt_rfq_assessments').select('id, rfq_id, round, requested_at, mkt_rfqs!inner(rfq_no, customer, model, title, due_date, priority)')
        .eq('status', 'draft').order('requested_at', { ascending: true }).limit(200)
      : Promise.resolve({ data: null, error: null }),
    /* 🧾 20/11 — ไลน์ใช้ของแล้วแต่สโตร์ยังไม่ลงจ่าย (v_line_issue_gaps · DR) · นับอย่างเดียว ไม่ดึงแถว */
    supabaseDR.from('v_line_issue_gaps').select('mat_no', { count: 'exact', head: true }),
    supabaseDR.from('v_line_issue_gaps').select('mat_no', { count: 'exact', head: true }).eq('overdue', true),
    /* ✍️ A5 (24/11 · คำสั่ง user): ใบตรวจ AM รออนุมัติ — เดิมไม่โผล่ในคิวใคร ต้องไล่เปิดทีละอุปกรณ์ (วัด 24/11: ค้าง 326 ใบ)
       โหลดเฉพาะคนที่อนุมัติ AM ได้ (`amApproveAllowed` — คีย์เดียวกับปุ่มในใบตรวจ) · คอลัมน์เท่าที่ใช้ · ทีม AM ตัดสินฝั่ง JS (`isAmTeam`) */
    me.canAmApprove
      ? supabaseDR.from('inspections').select('id, inspected_at, jigs!inner(line_name), checklists!inner(department)')
        .eq('approval_status', 'pending').order('inspected_at', { ascending: true }).limit(1000)
      : Promise.resolve({ data: null, error: null }),
    /* ✍️ 25/11: งาน e-Workflow ที่รอฉัน (ใบฟอร์ม + ใบรอบเอกสาร เช่น Poka-Yoke) — เดิมดูได้แค่แท็บ "รอฉัน" ใน /workflows */
    me.uid
      ? supabase.from('wf_tasks').select('id, created_at, wf_instances!inner(id, status, line_name, subject_kind, section, def_id, wf_defs(name))')
        .eq('assignee_id', me.uid).eq('status', 'open').eq('wf_instances.status', 'in_progress').limit(500)
      : Promise.resolve({ data: null, error: null }),
  ]);
  const rfqAssess = me.canRfqAssess ? ok(rfqAssessR)?.map(r => ({ id: r.id, rfq_id: r.rfq_id, round: r.round, requested_at: r.requested_at, ...(r.mkt_rfqs || {}) })) : undefined;
  const levelUps = canLu ? ok(luR)?.map(r => ({ id: r.id, to_level: r.to_level, requested_at: r.requested_at, section: r.employees?.section })) : undefined;

  /* `four_m_logs` ไม่มีคอลัมน์ส่วนงาน — เทียบขอบเขตผ่านทะเบียนไลน์ (ไลน์ → ส่วนงาน)
     ไลน์ที่ไม่อยู่ในทะเบียน = ตอบไม่ได้ว่าส่วนงานไหน ⇒ ปล่อย undefined ให้ inMyScope ตัดออกเอง */
  const secOfLine = new Map((lines || []).map(l => [String(l.name || '').trim().toLowerCase(), l.section]));
  const fourM = ok(fourR)?.map(f => ({
    ...f, section: secOfLine.get(String(f.line_name || '').trim().toLowerCase()),
  }));

  /* 🟡 ถังเหลือง: เติม `section` จากทะเบียนไลน์ (ตารางถังไม่มีคอลัมน์ส่วนงาน) — ไลน์นอกทะเบียน
     ปล่อย undefined ให้ buildQueue นับเป็น "ชี้ส่วนงานไม่ได้" แล้วจอเขียนบอก ห้ามเดาให้
     🔴 ก้อนใดก้อนหนึ่งล่ม = ส่ง undefined ⇒ partial (คิวที่ "ครบไม่จริง" แย่กว่าคิวที่บอกว่าโหลดไม่ครบ) */
  /* 🔴 ชนเพดาน 1000 = เพดาน PostgREST พอดี ⇒ รายการใบแดงอาจไม่ครบ แล้วใบที่ย้ายลงแดงไปแล้ว
     กลับมาค้างในคิวของทุกคน (ของค้างเทียม — สิ่งที่ตัวกรองนี้มีไว้กัน) ⇒ ถือเป็น "ไม่รู้" เหมือนคิวรีล่ม */
  const redRows = binRedR.error ? null : (binRedR.data || []);
  const movedToRed = (redRows && redRows.length < 1000) ? new Set(redRows.map(r => r.from_yellow_id)) : null;
  /* 🔴 ชนเพดาน 200 ของคิวเอง = "โหลดไม่ครบ" ไม่ใช่ "มีแค่นี้" ⇒ ติดธงให้จอเขียนบอก (กฎเขียน DB ข้อ 5) */
  const binsTruncated = Array.isArray(binR.data) && binR.data.length >= 200;
  const bins = (binR.error || !movedToRed) ? undefined
    : pendingYellow(binR.data || [], movedToRed)
      .map(b => ({ ...b, section: secOfLine.get(String(b.line_name || '').trim().toLowerCase()) }));

  const redBins = redPendR.error ? null
    : (redPendR.data || []).map(b => ({ ...b, section: secOfLine.get(String(b.line_name || '').trim().toLowerCase()) }));
  const redBinsTruncated = Array.isArray(redPendR.data) && redPendR.data.length >= 300;

  const amPending = me.canAmApprove ? ok(amR)?.filter(r => isAmTeam(r.checklists?.department))
    .map(r => ({ id: r.id, inspected_at: r.inspected_at, line_name: r.jigs?.line_name || null,
      section: secOfLine.get(String(r.jigs?.line_name || '').trim().toLowerCase()) })) : undefined;
  const amPendingTruncated = Array.isArray(amR?.data) && amR.data.length >= 1000;

  // อ่านล้ม = null (⇒ partial · จอเขียนว่าโหลดไม่ครบ) ไม่ใช่ undefined (= ไม่ได้โหลด)
  const wfTasks = !me.uid ? undefined : wfR.error ? null : (wfR.data || []).map(t => ({ id: t.id, created_at: t.created_at, def: t.wf_instances?.wf_defs?.name || 'ใบงาน',
    bound: !!t.wf_instances?.subject_kind, line_name: t.wf_instances?.line_name || null }));

  const moRows = ok(moR);
  const mo = moRows?.filter(o => !DEAD.includes(String(o.status || '')));
  /* 🔴 ชนเพดาน = โหลดไม่ครบ ไม่ใช่ "ไม่มีงาน" — ต้องติด `partial` ให้จอเขียนบอก
     (เดิม `partial` ติดเฉพาะตอนคิวรี **ล่ม** ⇒ ตัดแถวทิ้งเงียบๆ แล้วจอยืนยันว่าเคลียร์หมด) */
  const moTruncated = Array.isArray(moRows) && moRows.length >= LIMIT;

  const summaries = [];
  if (gapR.error == null && Number(gapR.count) > 0) {
    const od = gapOdR.error == null ? Number(gapOdR.count) || 0 : null;
    summaries.push({
      key: 'line_issue_gap', icon: '🧾',
      title: `${tr("ไลน์ใช้ของแล้วแต่สโตร์ยังไม่ลงจ่าย")} ${Number(gapR.count).toLocaleString()} ${tr("รายการ")}`,
      detail: od == null ? 'นับรายการเกิน 1 กะไม่ได้' : (od ? `${tr("เกิน 1 กะ")} ${od.toLocaleString()} ${tr("รายการ — สโตร์กดยืนยันจ่าย")}` : 'ยังอยู่ในกะนี้'),
      count: Number(gapR.count), to: '/line-stock?tab=out',
    });
  }
  if (prR.error == null && Number(prR.count) > 0) {
    summaries.push({
      key: 'pr_unordered', icon: '🧾',
      title: `${tr("ใบขอซื้อรอกดสั่งซื้อ")} ${Number(prR.count).toLocaleString()} ${tr("รายการ")}`,
      detail: 'ระบบระเบิดความต้องการสร้างให้ — ยังไม่มีเจ้าภาพกดสั่ง',
      count: Number(prR.count), to: '/line-stock',
    });
  }

  /* `moAll` = ชุดนับยอดกอง · ตอนนี้เป็นชุดเดียวกับรายการ (เพดาน 1000 ครอบใบเปิดค้างทั้งหมดแล้ว)
     🔴 คิวรีล่ม = `mo` เป็น undefined ⇒ **ไม่ส่ง** `moAll` เพื่อให้ `countsCapped` ติดธง
        ห้ามส่ง [] (จะกลายเป็น "ทุกกองมี 0 ใบ" ทั้งที่ไม่รู้ · ลิสต์ว่าง 2 ความหมาย · กฎข้อ 12) */
  /* 🛒 ใบขอซื้อรายใบ — อ่านไม่ได้ = `null` (ไม่รู้ ≠ ไม่มี) ⇒ กฎถอยไปพฤติกรรมเดิม */
  const moPrByOrder = moPrR?.error ? null : (() => {
    const by = {};
    (moPrR?.data || []).forEach(r => { (by[r.order_id] || (by[r.order_id] = [])).push(r); });
    return by;
  })();
  return buildQueue({ mo, moAll: mo, moAllCapped: moTruncated, moTruncated,
    prOf: moPrByOrder ? (o) => (moPrByOrder[o.id] || []) : null,
    sessions: ok(sesR), fourM, actions: ok(actR), summaries, levelUps, bins, binsTruncated, redBins, redBinsTruncated, rfqAssess,
    amPending, amPendingTruncated, wfTasks }, me);
}

/* ── UI ชิ้นเล็ก ────────────────────────────────────────────────────────── */

/* ✒️ 20/11 (user ดูแผงโปรไฟล์: "อันนี้ก็ควรแก้") — emoji หน้าแถวคิว → ไอคอนเส้นชุดเดียวกับเมนู (UI §6.36)
   · map เฉพาะแผงนี้ (ไม่เติม ICON_MAP กลาง — กันไอคอนหัวเพจหน้าอื่นเปลี่ยนตาม) · ไม่อยู่ใน map = emoji เดิม
   · 🟡/🔴 ถังเหลือง/แดง **คง emoji สี** — สีคือความหมาย (สถานะ) ไม่ใช่ของตกแต่ง
   · ทั้งจอคอมและมือถือ (20/11 · user สั่งให้มือถือตามด้วย) */
const QUEUE_ICON = {
  '🛠': 'Hammer', '🛠️': 'Hammer', '🔧': 'Wrench', '☑️': 'ClipboardCheck', '🧪': 'FlaskConical', '👔': 'UserRoundCheck',
  '✍️': 'PenLine', '🔎': 'Search', '🎯': 'Target', '⬆️': 'ArrowUp', '↩️': 'Undo2', '🤝': 'Handshake', '🔒': 'Lock',
  '📤': 'Upload', '🏁': 'Flag', '🧾': 'Receipt', '📋': 'ClipboardList', '📝': 'FilePenLine', '📐': 'Ruler', '📦': 'Package',
  '✅': 'CircleCheck', '🙋': 'Hand', '🏭': 'Factory', '🗂': 'FolderOpen', '🗂️': 'FolderOpen',
};
function QIcon({ glyph, size = 15 }) {
  const nm = QUEUE_ICON[String(glyph || '').trim()];
  if (nm) return <span style={{ color: 'var(--text2)', display: 'inline-flex', flexShrink: 0 }}><Icon name={nm} size={size} /></span>;
  return <span style={{ fontSize: 14, flexShrink: 0 }}>{glyph}</span>;
}
/** หัวข้อชั้นคิว "🙋 รอคุณโดยตรง" → ไอคอนเส้น + ข้อความ (จอคอม) */
function TierTitle({ text, suffix = '' }) {
  const lead = String(text || '').slice(0, String(text || '').length - String(stripIcon(text) || '').length).trim();
  if (!QUEUE_ICON[lead]) return <>{text}{suffix}</>;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name={QUEUE_ICON[lead]} size={13} /><span>{stripIcon(text)}{suffix}</span></span>;
}

function Row({ it, onGo }) {
  const old = it.age != null && it.age >= OLD_DAYS;
  const body = (
    <>
      <QIcon glyph={it.icon} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {it.title}
        </span>
        {(it.detail || it.tag) && (
          <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {[it.detail, it.tag].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
      {it.age != null && (
        <span title={`${tr("ค้างมา")} ${it.age} ${tr("วัน")}`} style={{
          flexShrink: 0, fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--r-pill)',
          color: old ? '#ef4444' : 'var(--muted)',
          background: old ? '#ef444418' : 'transparent',
        }}>{it.age}{tr('ว')}</span>
      )}
      {it.count != null && (
        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>
          {it.count.toLocaleString()}
        </span>
      )}
    </>
  );
  const style = {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
    padding: '6px 8px', borderRadius: 7, background: 'transparent',
    border: '1px solid transparent', color: 'var(--text2)', textDecoration: 'none',
  };
  return it.to
    ? <Link to={it.to} onClick={onGo} className="nav-link" style={style}>{body}</Link>
    : <div style={style}>{body}</div>;
}

function Group({ tier, items, onGo }) {
  const { shown, hidden } = capped(items, tier);
  const empty = EMPTY_TEXT[tier];
  if (!shown.length && !empty) return null;        // ชั้นโรงงานไม่มีของ = ไม่ต้องมีหัวข้อเปล่า
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', padding: '4px 8px 2px', letterSpacing: 0.2 }}>
        <TierTitle text={TIER_TITLE[tier]} suffix={shown.length ? ` · ${items.length}` : ''} />
      </div>
      {shown.length === 0
        ? <div style={{ fontSize: 11.5, color: 'var(--muted)', padding: '2px 8px 6px' }}>{empty}</div>
        : shown.map(it => <Row key={it.key} it={it} onGo={onGo} />)}
      {hidden > 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)', padding: '2px 8px 0' }}>
          …{tr("อีก")} {hidden} {tr("รายการ")}
        </div>
      )}
    </div>
  );
}

/* ── hook: โหลด + ถือสถานะคิว ─────────────────────────────────────────────
   แยกจากตัววาดเพราะ **badge ต้องมีเลขแม้แผงปิดอยู่** — ถ้าโหลดอยู่ในตัววาด
   พอผู้ใช้ปิดแผง component จะ unmount แล้วเลขหาย (แล้วโหลดใหม่ทุกครั้งที่เปิด = เปลืองฟรี)
   @param {boolean} open  แผงเปิดอยู่ไหม — ใช้ตัดสินว่าถึงเวลารีเฟรชของเก่าหรือยัง */
/* 🔁 ผลโหลดใช้ร่วมกันทุกตัวที่เรียก hook นี้ (13/10) — sidebar กับกระดิ่งต่างเรียก ⇒ ห้ามยิงคิวรีชุดเดียวกัน 2 รอบ
   คีย์ = ตัวตน+ขอบเขต · ตัวที่เรียกพร้อมกันรอ promise เดียวกัน · โหลดเสร็จแจ้งทุกตัวให้เห็นเลขเดียวกัน */
const shared = { key: null, at: 0, promise: null, q: null, listeners: new Set(), loader: null };

/* ── 🔄 เคลียร์คิวให้โหลดใหม่ หลังมีการ "ทำงานเสร็จ" ที่ทำให้คิวเปลี่ยน ───────  2026-10-22
   เคสจริง (คำสั่ง user): ผจก.กดเซ็นอนุมัติปิดใบจากคิว → ใบปิดแล้วจริง แต่**แถวยังคาอยู่ในแผง**
   เพราะแผงโหลด "ครั้งเดียวต่อ session" แล้วรีเฟรชเฉพาะตอนเปิดแผงและของเก่าเกิน STALE_MIN (5 นาที)
   ⇒ คนเซ็นเสร็จแล้วมองไม่ออกว่าอันไหนทำไปแล้ว · เผลอกดซ้ำ · และ badge ค้างเลขเดิม
   🔴 ต้องเรียกจากทุกจุดที่ "ปิดงานที่เคยอยู่ในคิว" — ไม่ใช่แค่ /mtn-repair
   ⚠️ ล้าง `at` อย่างเดียวไม่พอ (แผงที่เปิดค้างอยู่จะไม่รู้ตัว) ⇒ ถ้ามีคนฟังอยู่ ให้ยิงโหลดจริงเลย
      ไม่มีคนฟัง = แค่ทำให้ของเก่าหมดอายุ รอบหน้าที่เปิดแผงค่อยโหลด (ไม่เปลืองคิวรีฟรีๆ) */
export function invalidateMyQueue() {
  shared.at = 0;
  if (shared.listeners.size && typeof shared.loader === 'function') shared.loader();
}

export function useMyQueue(open = false) {
  const { sections, fullName, role, position, mtnTeams } = useContext(UserContext);
  const [q, setQ] = useState(shared.q);
  const [busy, setBusy] = useState(false);
  const secKey = (sections || []).join('|');        // 🔴 array ใน deps = ยิงซ้ำฟรีๆ → แปลงเป็น string
  const teamKey = (mtnTeams || []).join('|');

  useEffect(() => {
    const on = (v) => setQ(v);
    shared.listeners.add(on);
    return () => { shared.listeners.delete(on); };
  }, []);

  const load = useCallback(async (force = true) => {
    const actor = getActor();
    const key = [actor.uid, actor.name || fullName, secKey, teamKey, role, position].join('§');
    if (shared.key === key) {
      if (shared.promise) { setBusy(true); try { await shared.promise; } finally { setBusy(false); } return; }
      if (!force && shared.q && Date.now() - shared.at < STALE_MIN * 60000) { setQ(shared.q); return; }
    }
    shared.key = key;
    setBusy(true);
    shared.promise = (async () => {
      try {
        const secs = secKey ? secKey.split('|') : [];
        const teams = teamKey ? teamKey.split('|') : [];
        const myTeamKeys = new Set(teams.map(teamKeyOf));
        return await loadMyQueue({
          uid: actor.uid, name: actor.name || fullName || null,
          sections: secs,
          /* ✍️ เกณฑ์ "ช่องเซ็นที่ตำแหน่งเราเซ็นได้คนเดียว" (13/10) — ชุดเดียวกับ DetailDrawer ใน /mtn-repair
             (actorSideOf + positionRank + สิทธิ์ mtn_repair) ⇒ ใบที่ขึ้นว่า "รอคุณเซ็น" = ใบที่กดเซ็นได้จริง */
          actorSide: actorSideOf({ mtnTeams: teams, role, sections: secs, isAm: isAmTeam }),
          posRank: positionRank(position),
          isShared: isSharedAccount(),   // 🖥️ บัญชีกลางเซ็นช่องที่ล็อกตำแหน่งไม่ได้ (13/11) ⇒ ไม่ขึ้นว่า "รอคุณเซ็น"
          can: (a) => canPerm('mtn_repair', a, role),
          seeded: (a) => isActionSeeded('mtn_repair', a),
          hasTeams: teams.length > 0,
          inTeam: (o) => myTeamKeys.has(teamKeyOf(o.mtn_dept)),
          // ⬆️ คีย์เดียวกับปุ่มอนุมัติใน /operator?tab=levelup
          canLevelUp: canPerm('skills', 'approve_levelup', role),
          canLevelUp100: canPerm('skills', 'approve_levelup_100', role),
          // 📐 RFQ รอ IEC ประเมิน — คีย์เดียวกับปุ่มในการ์ดประเมินของ /rfq
          canRfqAssess: canPerm('rfq', 'assess', role),
          // 🔎 ถังเหลืองขั้น QA (ตัดสิน/ตรวจรับ) — คีย์เดียวกับปุ่มในหน้าถัง
          canBinDecide: canSeededPerm('qa', 'bin_decide', role),
          // ✍️ ใบตรวจ AM รออนุมัติ — คีย์เดียวกับปุ่มอนุมัติใน /daily-checker?tab=amcheck (A5 · 24/11)
          canAmApprove: amApproveAllowed({ can: (r, a) => canPerm(r, a, role), isSeeded: isActionSeeded }),
        });
      } catch {
        /* supabase-js คืน error ไม่ throw — มาถึงนี่ได้เฉพาะกรณีผิดปกติ ⇒ ถือว่าไม่ครบ ห้ามขึ้นว่าไม่มีงาน */
        return { mine: [], unit: [], floor: [], counts: { mine: 0, unit: 0, floor: 0 }, missing: ['all'], partial: true };
      }
    })();
    try {
      const r = await shared.promise;
      shared.q = r; shared.at = Date.now();
      shared.listeners.forEach(fn => fn(r));
    } finally { shared.promise = null; setBusy(false); }
  }, [secKey, teamKey, fullName, role, position]);

  /* ให้ invalidateMyQueue() ยิงโหลดจริงได้ — เก็บตัวโหลดล่าสุดไว้ (hook ตัวไหนก็ได้ที่ยัง mount อยู่) */
  useEffect(() => { shared.loader = () => load(true); return () => { if (shared.loader) shared.loader = null; }; }, [load]);
  useEffect(() => { load(false); }, [load]);        // รอบแรกตอน mount (1 ครั้ง/session · ตัวที่ 2 ใช้ผลร่วม)
  useEffect(() => {
    if (open) load(false);                           // เปิดแผง/กระดิ่ง = รีเฟรชเฉพาะเมื่อของเก่าเกิน STALE_MIN
  }, [open, load]);

  return { q, busy, reload: () => load(true), badge: badgeCount(q) };
}

/** ตัววาดล้วน — รับผลจาก `useMyQueue()` มาโชว์ (host เป็นคนถือ state) */
export default function MyQueuePanel({ q, busy, onGo }) {
  return (
    <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 6 }}>
      {q?.partial && (
        <div style={{ fontSize: 11, color: 'var(--amber)', padding: '4px 8px', lineHeight: 1.4 }}>
          ⚠️ {tr("โหลดข้อมูลไม่ครบ — รายการด้านล่าง")}<b>{tr('ไม่ใช่ทั้งหมด')}</b> {tr("อย่าเพิ่งสรุปว่าไม่มีงานค้าง")}
        </div>
      )}
      {/* 🔴 แถวที่ระบุส่วนงานไม่ได้ = ตกจากคิวของ**ทุกคน** ⇒ ต้องเขียนบอก ไม่ใช่ `partial` (คิวรีไม่ได้ล่ม
          ข้อมูลไม่ครบที่ต้นทาง) · วัดจริง 06/10: ใบรอ QA 36 จาก 188 ใบ `dept_section` ว่าง */}
      {q && q.unattributed > 0 && (
        <div style={{ fontSize: 11, color: 'var(--amber)', padding: '4px 8px', lineHeight: 1.4 }}>
          ⚠️ {tr("อีก")} <b>{q.unattributed}</b> {tr('รายการ')}<b>{tr('ระบุส่วนงานไม่ได้')}</b> {tr("จึงไม่เข้าคิวของใครเลย — ต้องเติมส่วนงานในใบก่อน ถึงจะโผล่ในคิวของหน่วยงานที่รับผิดชอบ")}
        </div>
      )}
      {!q && busy && <div style={{ fontSize: 11.5, color: 'var(--muted)', padding: '6px 8px' }}>{tr('กำลังดูคิวงาน…')}</div>}
      {q && (<>
        <Group tier={TIER.MINE} items={q.mine} onGo={onGo} />
        <Group tier={TIER.UNIT} items={q.unit} onGo={onGo} />
        <Group tier={TIER.FLOOR} items={q.floor} onGo={onGo} />
      </>)}
    </div>
  );
}
