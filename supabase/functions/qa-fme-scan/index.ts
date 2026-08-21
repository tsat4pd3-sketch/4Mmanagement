// ══ QA FME scan — ฝ่ายผลิตเรียก QA มาตรวจชิ้นงาน (First–Middle–End) ═══════════════════
//
// "ระบบ 2" ตาม docs/INSPECTION_ALARM_SYSTEMS.md (ระบบ 1 = pm-daily-scan · ระบบ 3 = pm-plan-reminder)
//
// ⚠️ หน่วยงานตรวจ = ไลน์ × วันงาน × กะ × **รุ่น** ไม่ใช่ต่อออเดอร์ (คำสั่ง user: ลอตนึงมี 50 เลขออเดอร์)
//    → 50 ใบงานของรุ่นเดียวกัน = เรียก QA ครั้งเดียว
//    → งานคู่ RH/LH นับเป็นรุ่นเดียวกัน (จับกลุ่มด้วย dr_products.pair_mat_no) ไม่งั้นเรียกรัวๆ
//
// อ่านข้อมูลผลิตจาก DR (DR_URL/DR_ANON_KEY) · เขียน obligation + route Telegram ฝั่ง Main
// cron ทุก 5 นาที (ดู migration 20260819_qa_fme_scan_cron.sql) · verify_jwt=false เหมือน scan ตัวอื่น
//
// ปิดทั้งระบบได้ที่ qa_fme_config.is_enabled (default false — ต้องกดเปิดเองที่ /qa)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID   = Deno.env.get('TELEGRAM_CHAT_ID');
// ⚠️ ต้องตั้ง secret DR_URL / DR_ANON_KEY ที่ Supabase project (Edge Functions → Secrets)
// ⚠️ `clean()` ตัดอักขระที่ใส่ใน HTTP header ไม่ได้ทิ้ง (นอกช่วง ASCII printable) — เจอจริง 2026-08-19:
//    คนวาง secret โดยก๊อป "ค่าที่ถูกปิดบัง" จากหน้าเว็บมา ได้ตัว • (U+2022) มาทั้งพวง แล้ว fetch โยน
//    "not a valid ByteString" ซึ่งอ่านไม่ออกว่าต้นเหตุคืออะไร · ตัดทิ้งแล้วจะได้ 401 จาก DR แทน
//    = error ที่ชี้ทางถูก ("key ผิด") · ดูค่าที่ตั้งไว้จริงได้ที่ `?diag=1`
const clean = (s: string) => s.replace(/[^\x20-\x7E]/g, '').trim();
const DR_URL = clean(Deno.env.get('DR_URL') || '').replace(/\/$/, '');
const DR_KEY = clean(Deno.env.get('DR_ANON_KEY') || '');
let BOT_TOKEN: string | undefined = TELEGRAM_BOT_TOKEN;

/* ── วันงานไทย (ตัด 08:00) — กฎเดียวกับ getWorkDate ทั้งระบบ ห้ามใช้ toISOString ตรงๆ ── */
function bangkok(d: Date) { return new Date(d.getTime() + 7 * 3600_000); }
function workDateOf(d: Date): string {
  const b = bangkok(d);
  if (b.getUTCHours() < 8) b.setUTCDate(b.getUTCDate() - 1);
  return b.toISOString().slice(0, 10);
}
function hhmm(iso: string | null): string {
  if (!iso) return '-';
  const b = bangkok(new Date(iso));
  return `${String(b.getUTCHours()).padStart(2, '0')}:${String(b.getUTCMinutes()).padStart(2, '0')}`;
}
const norm = (s: unknown) => String(s ?? '').replace(/[\s-]/g, '').toUpperCase();

/* ── Telegram routing (pattern เดียวกับ mtn-daily-summary) ── */
type Route = { enabled: boolean; chats: string[]; template?: string | null };
async function getBotToken(): Promise<string | undefined> {
  try {
    const { data } = await supabase.from('notification_settings').select('bot_token').eq('id', 1).maybeSingle();
    const t = data?.bot_token ? String(data.bot_token).trim() : '';
    return t || TELEGRAM_BOT_TOKEN || undefined;
  } catch { return TELEGRAM_BOT_TOKEN || undefined; }
}
async function loadRoutes(): Promise<Record<string, Route>> {
  try {
    const [{ data: rules }, { data: channels }] = await Promise.all([
      supabase.from('notification_rules').select('event_key, is_enabled, channel_ids, channel_id'),
      supabase.from('telegram_channels').select('id, chat_id, is_active'),
    ]);
    const chatById = new Map<string, string>();
    for (const c of channels ?? []) {
      if (c.is_active && c.chat_id) chatById.set(String(c.id), String(c.chat_id).trim());
    }
    const map: Record<string, Route> = {};
    for (const r of rules ?? []) {
      const ids: string[] = Array.isArray((r as Record<string, unknown>).channel_ids)
        ? ((r as Record<string, unknown>).channel_ids as string[])
        : (r as { channel_id?: string }).channel_id ? [(r as { channel_id: string }).channel_id] : [];
      const chats = [...new Set(ids.map((id) => chatById.get(String(id))).filter((v): v is string => !!v))];
      map[r.event_key as string] = { enabled: r.is_enabled as boolean, chats };
    }
    return map;
  } catch { return {}; }
}
function chatsFor(routes: Record<string, Route>, key: string): string[] | null {
  const r = routes[key];
  if (r && !r.enabled) return null;                       // ปิดที่ /notification-config = ไม่ส่ง
  if (r && r.chats.length) return r.chats;
  return TELEGRAM_CHAT_ID ? [TELEGRAM_CHAT_ID] : [];      // ยังไม่ตั้งห้อง = ห้อง default
}
async function sendTelegram(message: string, chats: string[]) {
  const list = [...new Set(chats.filter(Boolean))];
  if (!BOT_TOKEN || !list.length) return;
  await Promise.all(list.map((chat) =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: message, parse_mode: 'HTML' }),
    }).catch(() => undefined)
  ));
}

/* ── DR REST (คนละ project — ใช้ anon key ตาม convention ของ supabaseDR) ── */
async function dr<T>(path: string): Promise<T[]> {
  if (!DR_URL || !DR_KEY) return [];
  const res = await fetch(`${DR_URL}/rest/v1/${path}`, {
    headers: { apikey: DR_KEY, Authorization: `Bearer ${DR_KEY}` },
  });
  if (!res.ok) throw new Error(`DR ${path} → ${res.status} ${await res.text()}`);
  return await res.json() as T[];
}

type Sess = { id: string; work_date: string; line_name: string; shift: string; status: string; closed_at: string | null };
type Ord  = { id: string; session_id: string; mat_no: string | null; part_name: string | null;
              status: string; opened_at: string | null; confirmed_at: string | null;
              qty: number | null; qty_ok: number | null; qty_actual: number | null };
type Prod = { mat_no: string | null; pair_mat_no: string | null; name: string | null;
              p_no: string | null; is_operation: boolean | null; op_parent_mat: string | null };

const STAGE_LABEL: Record<string, string> = { first: 'ชิ้นแรก (First)', middle: 'ระหว่างผลิต (Middle)', end: 'ชิ้นสุดท้าย (End)' };
const REASON_LABEL: Record<string, string> = {
  shift_start: 'เริ่มกะ', model_change: 'เปลี่ยนรุ่น', mid_run: 'รุ่นนี้ผลิตต่อเนื่องนาน',
  model_change_out: 'จบรุ่น (กำลังเปลี่ยนรุ่น)', shift_end: 'ปิดกะ',
};
// สเตจของ obligation ↔ stage ในใบตรวจ (qa_inspection_sheets.stage) — ใช้จับคู่ว่า "ตรวจแล้ว"
const SHEET_STAGE: Record<string, string> = { first: 'setup_first', middle: 'inprocess', end: 'final' };

Deno.serve(async (req) => {
  try {
    // ?diag=1 = ตรวจว่า secret ที่ตั้งไว้ใช้ได้จริงไหม (ยาวเท่าไหร่ · เป็น ASCII ล้วนไหม · หัว/ท้าย)
    // ไม่โชว์ค่าเต็ม · มีไว้เพราะ "วาง secret ผิด" วินิจฉัยจาก error ปลายทางไม่ออก (เคยเจอวางตัว • มา)
    if (new URL(req.url).searchParams.get('diag') === '1') {
      const raw = { url: Deno.env.get('DR_URL') || '', key: Deno.env.get('DR_ANON_KEY') || '' };
      const info = (s: string) => ({
        len: s.length,
        ascii_only: /^[\x20-\x7E]*$/.test(s),
        head: s.slice(0, 8),
        tail: s.slice(-8),
        bad_chars: [...new Set([...s].filter(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126))]
          .map(c => `U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`),
      });
      return json({ ok: true, raw: { DR_URL: info(raw.url), DR_ANON_KEY: info(raw.key) },
                    used: { DR_URL: info(DR_URL), DR_ANON_KEY: info(DR_KEY) } });
    }

    // ?dry=1 = โหมดทดลอง — อ่านข้อมูลผลิตจริงแล้วบอกว่า "จะเรียกอะไรบ้าง"
    // **ไม่เขียน DB · ไม่ส่ง Telegram** · ใช้ดูผลก่อนกดเปิดสวิตช์จริง (ทำงานได้แม้ระบบยังปิดอยู่)
    const dry = new URL(req.url).searchParams.get('dry') === '1';

    const { data: cfg } = await supabase.from('qa_fme_config').select('*').eq('id', 1).maybeSingle();
    if (!cfg) return json({ ok: false, error: 'ยังไม่มี qa_fme_config (apply migration 20260819_qa_fme_call.sql)' });
    if (!cfg.is_enabled && !dry) return json({ ok: true, skipped: 'ปิดอยู่ (qa_fme_config.is_enabled = false)' });
    if (!DR_URL || !DR_KEY) return json({ ok: false, error: 'ยังไม่ได้ตั้ง secret DR_URL / DR_ANON_KEY' });

    BOT_TOKEN = await getBotToken();
    const routes = await loadRoutes();
    const now = new Date();
    const today = workDateOf(now);
    const yest  = workDateOf(new Date(now.getTime() - 86400_000));

    /* ── 1) ข้อมูลผลิต 2 วันงานล่าสุด (กะดึกข้ามวัน) ── */
    const sessions = await dr<Sess>(
      `production_sessions?select=id,work_date,line_name,shift,status,closed_at&work_date=in.(${today},${yest})`);
    if (!sessions.length) return json({ ok: true, note: 'ไม่มีกะในช่วงที่สแกน' });

    const sIds = sessions.map(s => s.id);
    const orders = await dr<Ord>(
      `prod_orders?select=id,session_id,mat_no,part_name,status,opened_at,confirmed_at,qty,qty_ok,qty_actual&session_id=in.(${sIds.join(',')})`);
    const products = await dr<Prod>('dr_products?select=mat_no,pair_mat_no,name,p_no,is_operation,op_parent_mat');
    /* lot_size รายพาร์ท = ฐานของคาบตรวจ Middle (คำสั่ง user 2026-08-20)
       ⚠️ ไม่ตั้ง lot_size = ไม่เดา → พาร์ทนั้นไม่มี Middle แต่ต้องรายงานออกมา ห้ามเงียบ */
    /* ⚠️ kanban_standards ไม่มีคอลัมน์ line_name (เจอตอน dry-run 2026-08-21 → 42703)
       ไลน์ผูกผ่าน product_id → dr_products.line_name · ที่นี่เอาแค่ product_id พอสำหรับแยกแถวซ้ำ */
    type Kstd = { mat_no: string; product_id: string | null; lot_size: number | null;
                  qty_per_kanban: number | null; min_qty: number | null; max_qty: number | null };
    const kstd = await dr<Kstd>(
      'kanban_standards?select=mat_no,product_id,lot_size,qty_per_kanban,min_qty,max_qty&is_active=eq.true');
    /* ⚠️ 1 mat มีได้หลายแถว (คนละไลน์/ปลายทาง) — เดิม `set()` ทับกันไปเรื่อยๆ แถวสุดท้ายชนะ
       = หยิบ lot_size มาแบบสุ่มโดยไม่มีใครรู้ · ถ้าค่าไม่ตรงกัน **ไม่เลือกให้เอง** ต้องรายงาน */
    const lotRows = new Map<string, Kstd[]>();
    for (const k of kstd) if (k.mat_no) lotRows.set(k.mat_no, [...(lotRows.get(k.mat_no) ?? []), k]);

    /* ⚠️⚠️ `kanban_standards.lot_size` ใช้เป็นขนาดล็อตผลิตไม่ได้ (พิสูจน์จาก dry-run จริง 2026-08-21)
       PlannerSales ตอนกด Apply เขียน **จำนวนใบคัมบังต่อล็อต** (`kanbanPerLot = ⌈lot_qty/packaging⌉`)
       ลงคอลัมน์นี้เมื่อ calc_type = production → ค่า 1 = "1 ใบต่อล็อต" ไม่ใช่ 1 ชิ้น
       ข้อมูลจริง: 8 พาร์ทได้ 1 · 4 พาร์ทได้ 3,000-6,000 · 13 พาร์ทไม่มีค่า = ไม่มีตัวไหนเป็นล็อตผลิต

       ⚠️ `kanban_calc_params.lot_size` (ช่อง LOT ในแท็บ Withdrawal) ก็เป็น **"ใบ" ไม่ใช่ "ชิ้น"**
          พิสูจน์จากสูตร: `totalKanban = maxKanban + lotSize` (บวกกับจำนวนใบตรงๆ)
          ตรงกับหน้าจอจริง MAX 88 + LOT 300 = TOTAL 388 → ห้ามเอามาเป็นคาบตรวจ

       เหลือช่องเดียวที่เป็น "ชิ้น" แน่นอน = `kanban_calc_params.lot_qty` (แท็บ Production)
         พิสูจน์: `infoLT = lot_qty × CT` (เวลา = ชิ้น × วินาที/ชิ้น) และ `⌈lot_qty / packaging⌉` = ใบ/ล็อต
       ⇒ พาร์ทฝั่งประกอบ (withdrawal) **ไม่มีขนาดล็อตผลิตอยู่ในระบบเลย** ต้องรอต่อกับ Control Plan */
    type Kparam = { mat_no: string; calc_type: string | null; lot_qty: number | null; lot_size: number | null };
    const kparam = await dr<Kparam>('kanban_calc_params?select=mat_no,calc_type,lot_qty,lot_size');
    const paramRows = new Map<string, Kparam>();
    for (const p of kparam) if (p.mat_no) paramRows.set(p.mat_no, p);

    const lotByMat = new Map<string, number>();
    const lotSource = new Map<string, string>();   // mat → เอาค่ามาจากช่องไหน (ต้องบอกได้เสมอ)
    const lotConflict = new Map<string, number[]>();
    const pos = (v: unknown) => { const n = Number(v); return n > 0 ? n : 0; };
    for (const mat of new Set([...lotRows.keys(), ...paramRows.keys()])) {
      const p = paramRows.get(mat);
      // ช่องเดียวที่หน่วยเป็น "ชิ้น" แน่นอน — ที่เหลือเป็น "ใบ" ห้ามเอามาใช้เป็นคาบตรวจ
      const lotQty = pos(p?.lot_qty);
      if (lotQty > 0) { lotByMat.set(mat, lotQty); lotSource.set(mat, 'calc_params.lot_qty'); continue; }
      // ท้ายสุดค่อยใช้ kanban_standards (ปนหน่วย "ใบ" กับ "ชิ้น" — ด่าน mid_min_pcs จะกรองอีกชั้น)
      const vals = [...new Set((lotRows.get(mat) ?? []).map(r => pos(r.lot_size)).filter(v => v > 0))];
      if (vals.length === 1) { lotByMat.set(mat, vals[0]); lotSource.set(mat, 'kanban_standards.lot_size'); }
      else if (vals.length > 1) lotConflict.set(mat, vals.sort((a, b) => a - b));
    }
    const { data: partRules } = await supabase.from('qa_fme_part_rules').select('*');
    const ruleByMat = new Map<string, { mid_every_pcs: number | null; is_active: boolean }>();
    for (const r of partRules ?? []) ruleByMat.set(r.mat_no, r);

    /* ── 2) จับคู่ RH/LH เป็น "รุ่นเดียวกัน" — ตัวแทนกลุ่ม = mat ที่เรียงน้อยกว่า ── */
    const pairOf = new Map<string, string>();
    const nameOf = new Map<string, string>();
    const opParent = new Map<string, string>();   // รายการขั้นตอน (OP) → พาร์ทจริง
    const opNoParent = new Set<string>();         // OP ที่ยังไม่ผูกพาร์ทจริง (ต้องบอก ห้ามซ่อน)
    const pnoOf = new Map<string, string>();      // mat SAP → เลขพาร์ทลูกค้า (เส้นที่เชื่อมกับ QA)
    for (const p of products) {
      if (!p.mat_no) continue;
      if (p.name) nameOf.set(p.mat_no, p.name);
      if (p.p_no) pnoOf.set(p.mat_no, p.p_no);
      if (p.pair_mat_no) pairOf.set(p.mat_no, p.pair_mat_no);
      if (p.is_operation) {
        if (p.op_parent_mat) opParent.set(p.mat_no, p.op_parent_mat);
        else opNoParent.add(p.mat_no);
      }
    }
    // ⚠️ ยุบ "รายการขั้นตอน (OP)" เข้าพาร์ทจริงก่อนเสมอ แล้วค่อยจับคู่ RH/LH
    //    OP (ขับนัท/สปอต เช่น `E025 (M6 ไม่มีเกลียว)`) ไม่ใช่ "รุ่น" ที่ QA ตรวจ — เป็นขั้นตอนย่อย
    //    ของพาร์ทเดียวกัน · ไม่ยุบ = เรียก QA ซ้ำหลายรอบต่อพาร์ทเดียว (dry-run 2026-08-19 เจอ
    //    14/30 รายการเป็น OP) · กฎเหล็กชั้น Operation ใน CLAUDE.md
    //    OP ที่ยังไม่ผูกพาร์ทจริง (op_parent_mat null) = ใช้เลขเดิมไปก่อน + ติดธงบอกให้ไปผูก
    const canon = (mat: string) => {
      const base = opParent.get(mat) || mat;
      const pair = pairOf.get(base);
      return pair && pair < base ? pair : base;
    };

    /* ── 3) แตกเป็น "run" ต่อ (กะ × รุ่น) ── */
    type Run = { sess: Sess; mat: string; mats: Set<string>; name: string;
                 firstOpen: string; lastAct: string; allDone: boolean; list: Ord[] };
    const runs = new Map<string, Run>();
    const sessById = new Map(sessions.map(s => [s.id, s]));
    for (const o of orders) {
      const sess = sessById.get(o.session_id);
      if (!sess || !o.mat_no || !o.opened_at) continue;
      if (o.status === 'cancelled') continue;
      const mat = canon(o.mat_no);
      const key = `${sess.id}|${mat}`;
      const r = runs.get(key) ?? {
        sess, mat, mats: new Set<string>(), name: nameOf.get(mat) || o.part_name || '',
        firstOpen: o.opened_at, lastAct: o.opened_at, allDone: true, list: [],
      };
      r.list.push(o);
      r.mats.add(o.mat_no);
      if (o.opened_at < r.firstOpen) r.firstOpen = o.opened_at;
      const act = o.confirmed_at || o.opened_at;
      if (act > r.lastAct) r.lastAct = act;
      if (o.status === 'open') r.allDone = false;          // ยังมีใบเปิดค้าง = รุ่นนี้ยังไม่จบ
      runs.set(key, r);
    }

    /* ── 4) obligation ที่ควรมี ── */
    const skipBefore = new Date(now.getTime() - cfg.skip_older_min * 60_000).toISOString();
    type Want = { work_date: string; shift: string; line_name: string; mat_no: string; mat_group: string[];
                  product_name: string; stage: string; trigger_reason: string; session_id: string;
                  triggered_at: string; due_at: string; seq: number; at_qty: number | null };
    const want: Want[] = [];
    // นับสิ่งที่ "ถูกตัดทิ้งเพราะเก่าเกินเกณฑ์" ไว้รายงาน — ไม่งั้น would_create = 0 แล้วอ่านไม่ออกว่าทำไม
    const skippedOld: Record<string, number> = {};
    const add = (r: Run, stage: string, reason: string, at: string, dueMin: number,
                 seq = 1, atQty: number | null = null) => {
      if (at < skipBefore) { skippedOld[stage] = (skippedOld[stage] ?? 0) + 1; return; }  // เก่าเกิน (เพิ่งเปิดสวิตช์)
      want.push({
        work_date: r.sess.work_date, shift: r.sess.shift, line_name: r.sess.line_name,
        mat_no: r.mat, mat_group: [...r.mats], product_name: r.name,
        stage, trigger_reason: reason, session_id: r.sess.id,
        triggered_at: at, due_at: new Date(new Date(at).getTime() + dueMin * 60_000).toISOString(),
        seq, at_qty: atQty,
      });
    };

    /* คาบตรวจ Middle ของรุ่นนี้ (ชิ้น) — override รายพาร์ท > lot_size × ratio > ไม่รู้ = null
       ⚠️ null = ข้ามการตรวจ Middle ของพาร์ทนั้น **ห้ามเดาเป็นค่า default**

       ⚠️ ด่านความสมเหตุสมผล (dry-run 2026-08-21): พาร์ท FG หลายตัวตั้ง `lot_size = 1`
          (ค่า placeholder ไม่ใช่ขนาดล็อตจริง) → คาบ = 1 ชิ้น = เรียก QA ทุกชิ้นจนชนเพดาน
          รอบเดียว 12 ครั้ง · เจอจริง 4 พาร์ท = 46 จาก 91 งานตรวจ
          กติกา: คาบที่คำนวณได้ต่ำกว่า `mid_min_pcs` = **ถือว่า master ยังใช้ไม่ได้ → ไม่ตั้ง Middle
          แล้วรายงานออกไปพร้อมค่าที่คำนวณได้** (ห้ามเดาค่าแทน · ห้ามเงียบ) */
    const midMin = Math.max(1, Number(cfg.mid_min_pcs ?? 10));
    const noLot = new Set<string>();
    const tooSmall = new Map<string, number>();   // mat → คาบที่คำนวณได้ (ต่ำเกินจนไม่น่าใช่ค่าจริง)
    const everyByMat = new Map<string, number>(); // mat → คาบที่ใช้จริง (ไว้ตรวจสอบใน dry-run)
    const midEveryFor = (r: Run): number | null => {
      for (const m of [r.mat, ...r.mats]) {
        const rule = ruleByMat.get(m);
        if (rule) {
          if (rule.is_active === false) return null;             // ตั้งใจปิดพาร์ทนี้
          // override รายพาร์ทคือค่าที่คนตั้งมาเอง → เชื่อตามนั้น ไม่ต้องผ่านด่าน midMin
          if ((rule.mid_every_pcs ?? 0) > 0) {
            everyByMat.set(r.mat, rule.mid_every_pcs as number);
            return rule.mid_every_pcs as number;
          }
        }
      }
      for (const m of [r.mat, ...r.mats]) {
        const lot = lotByMat.get(m);
        if (lot) {
          const every = Math.max(1, Math.round(lot * Number(cfg.mid_lot_ratio ?? 1)));
          if (every < midMin) { tooSmall.set(r.mat, every); return null; }
          everyByMat.set(r.mat, every);
          return every;
        }
      }
      // ค่าไม่ตรงกันระหว่างแถว = "ไม่รู้ว่าอันไหนใช่" ไม่ใช่ "ไม่มี" — แยกให้ขาด (รายงานคนละช่อง)
      if ([r.mat, ...r.mats].some(m => lotConflict.has(m))) return null;
      noLot.add(r.mat);        // ยังไม่ตั้ง lot_size → รายงานออกไป ไม่เงียบ
      return null;
    };
    // ยอดผลิตของ 1 ใบ — สูตรบังคับของโปรเจค (CLAUDE.md): ปิดแล้วใช้ qty_ok ?? qty · ยังเปิดใช้ qty_actual
    const qtyOf = (o: Ord) => o.status === 'confirmed'
      ? (Number(o.qty_ok ?? o.qty) || 0)
      : (Number(o.qty_actual) || 0);

    const bySess = new Map<string, Run[]>();
    for (const r of runs.values()) {
      const arr = bySess.get(r.sess.id) ?? [];
      arr.push(r);
      bySess.set(r.sess.id, arr);
    }

    for (const [, list] of bySess) {
      list.sort((a, b) => a.firstOpen < b.firstOpen ? -1 : 1);
      list.forEach((r, i) => {
        // first — รุ่นแรกของกะ = "เปลี่ยนกะ" · รุ่นถัดมา = "เปลี่ยนรุ่น"
        add(r, 'first', i === 0 ? 'shift_start' : 'model_change', r.firstOpen, cfg.first_due_min);

        /* middle — คาบตาม "ยอดผลิตรายพาร์ท" คำนวณจาก lot_size (คำสั่ง user 2026-08-20)
           ไล่ใบตามเวลา สะสมยอด · ทุกครั้งที่ข้ามหลัก N ชิ้น = ถึงคิวตรวจ 1 ครั้ง
           ⇒ ลอทใหญ่ผลิตทั้งวันได้หลายครั้ง · ลอทสั้นจบก่อนถึงหลักแรก = ไม่มีเลย (ถูกต้อง)
           เวลาที่ใช้ = เวลาของใบที่ทำให้ยอดข้ามหลักนั้น (ไม่ใช่เวลาที่สแกนเจอ) */
        const midMode = String(cfg.mid_mode ?? 'lot');
        if (midMode === 'lot') {
          const every = midEveryFor(r);
          if (every) {
            const evts = r.list
              .map(o => ({ at: o.confirmed_at || o.opened_at, q: qtyOf(o) }))
              .filter(e => !!e.at && e.q > 0)
              .sort((a, b) => (a.at as string) < (b.at as string) ? -1 : 1);
            const cap = Number(cfg.mid_max_per_run ?? 12);
            let acc = 0, k = 0;
            for (const e of evts) {
              acc += e.q;
              while (acc >= (k + 1) * every && k < cap) {
                k += 1;
                add(r, 'middle', 'mid_run', e.at as string, cfg.first_due_min, k, k * every);
              }
              if (k >= cap) break;   // เพดานกัน QA ถูกเรียกรัวจนใช้งานไม่ได้
            }
          }
        } else if (midMode === 'min' && cfg.mid_after_min > 0) {
          // โหมดเดิม (ตามเวลา) — เก็บไว้เผื่อบางไลน์อยากใช้ ไม่ใช่ค่าเริ่มต้นแล้ว
          const midAt = new Date(new Date(r.firstOpen).getTime() + cfg.mid_after_min * 60_000);
          if (midAt <= now && !r.allDone) add(r, 'middle', 'mid_run', midAt.toISOString(), cfg.first_due_min);
        }

        // end — ปิดกะ หรือ รุ่นนี้ปิดใบครบแล้วและมีรุ่นอื่นเริ่มหลังจากนั้น (= กำลังเปลี่ยนรุ่น)
        if (r.sess.status === 'closed') {
          add(r, 'end', 'shift_end', r.sess.closed_at || r.lastAct, cfg.end_due_min);
        } else if (r.allDone) {
          const next = list.find(x => x !== r && x.firstOpen > r.lastAct);
          if (next) add(r, 'end', 'model_change_out', next.firstOpen, cfg.end_due_min);
        }
      });
    }

    /* ── 5) จับคู่พาร์ทฝั่ง QA (mat_no → qa_parts) — ผูกไม่ได้ก็ยังต้องเรียก QA ── */
    const { data: qaParts } = await supabase.from('qa_parts').select('id, part_no, mat_no, line_name').eq('is_active', true);
    const byMat = new Map<string, string>(), byNo = new Map<string, string>();
    for (const p of qaParts ?? []) {
      if (p.mat_no) byMat.set(norm(p.mat_no), p.id);       // คอลัมน์ผูกตรง (แม่นสุด)
      if (p.part_no) byNo.set(norm(p.part_no), p.id);      // ถอยไปเทียบ part_no แบบ normalize
    }
    // ⚠️ เส้นที่เชื่อม QA ↔ ผลิต คือ **เลขพาร์ทลูกค้า (`dr_products.p_no`)** ไม่ใช่เลข SAP
    //    QA ตรวจตามแบบ/เลขลูกค้า → 1 พาร์ท QA ครอบหลายเลข SAP ได้โดยธรรมชาติ
    //    (ข้อมูลจริง: p_no `RB3B-16E061-BA` → mat 10100335 / 10100401 / 10106791 ทั้งหมด Line 61)
    //    ⇒ เทียบ p_no ก่อน แล้วค่อยถอยไปเทียบเลข SAP · `qa_parts.mat_no` เป็นตัวผูกตรงเมื่ออยากล็อกรายเลข
    const resolvePart = (mats: string[], canonMat: string) => {
      const all = [canonMat, ...mats];
      for (const m of all) { const hit = byMat.get(norm(m)); if (hit) return hit; }         // ผูกตรงรายเลข SAP
      for (const m of all) {                                                                // เลขพาร์ทลูกค้า
        const pn = pnoOf.get(m);
        const hit = pn ? byNo.get(norm(pn)) : null;
        if (hit) return hit;
      }
      for (const m of all) { const hit = byNo.get(norm(m)); if (hit) return hit; }          // part_no = เลข SAP
      return null;
    };

    /* ── 6) สร้าง obligation ที่ยังไม่มี (unique key กันซ้ำระดับ DB) ── */
    let created = 0;
    // กันคีย์ซ้ำในก้อนเดียวกัน (ข้อมูลกะซ้ำผิดปกติ) ก่อนส่งเข้า upsert
    const seen = new Set<string>();
    const rows = want
      .filter(w => {
        const k = `${w.line_name}|${w.work_date}|${w.shift}|${w.mat_no}|${w.stage}|${w.seq}`;
        if (seen.has(k)) return false;
        seen.add(k); return true;
      })
      .map(w => ({ ...w, part_id: resolvePart(w.mat_group, w.mat_no) }));

    // ── โหมดทดลอง: บอกว่า "จะเรียกอะไรบ้าง" แล้วจบ (ไม่เขียน ไม่ส่ง) ──
    if (dry) {
      const { data: already } = await supabase.from('qa_fme_obligations')
        .select('line_name, work_date, shift, mat_no, stage, seq').gte('work_date', yest);
      const have = new Set((already ?? []).map(o => `${o.line_name}|${o.work_date}|${o.shift}|${o.mat_no}|${o.stage}|${o.seq ?? 1}`));
      const list = rows.filter(r => !have.has(`${r.line_name}|${r.work_date}|${r.shift}|${r.mat_no}|${r.stage}|${r.seq}`));
      return json({
        ok: true, dry: true, enabled: cfg.is_enabled,
        scanned: { sessions: sessions.length, orders: orders.length, runs: runs.size },
        summary: {
          would_create: list.length,
          // part_linked = กดปุ่ม "เปิดใบตรวจ" จากคิวได้จริงกี่รายการ (ต้องผูก qa_parts.mat_no ก่อน)
          part_linked: list.filter(r => r.part_id).length,
          op_unlinked: [...new Set(list.flatMap(r => r.mat_group.filter(m => opNoParent.has(m))))],
          // พาร์ทที่ยังไม่ตั้ง lot_size → ไม่มีการตรวจ Middle เลย (First/End ยังทำงาน) — ต้องเห็น ห้ามเงียบ
          middle_no_lot_size: [...noLot],
          // ตั้ง lot_size ไว้ แต่เล็กจนไม่น่าใช่ขนาดล็อตจริง (เช่น 1) → ไม่ตั้ง Middle · ต้องไปแก้ master
          middle_lot_too_small: [...tooSmall].map(([mat, every]) => ({ mat, every, min: midMin })),
          // every มาจากช่องไหน ต้องบอกได้เสมอ — ไม่งั้นวินิจฉัยไม่ออกว่าหยิบผิดตารางอีกหรือเปล่า
          mid_every_by_mat: [...everyByMat].map(([mat, every]) => ({ mat, every, from: lotSource.get(mat) ?? 'rule' })),
          // lot_size ไม่ตรงกันระหว่างแถวของ mat เดียวกัน → ไม่เลือกให้เอง ต้องไปจัดข้อมูล/ตั้ง override
          middle_lot_conflict: [...lotConflict].map(([mat, lots]) => ({ mat, lots })),
          /* ⚠️ would_create = 0 ต้องอธิบายได้เสมอ ห้ามให้เดาเอง
             เหตุที่พบบ่อยคือ "เหตุการณ์เก่ากว่า skip_older_min" ไม่ใช่ระบบไม่ทำงาน */
          skipped_old: skippedOld, skip_older_min: cfg.skip_older_min,
          // ค่าดิบจาก kanban_standards ของ **ทุก mat ที่อยู่ในรอบจริง** (ไม่ผูกกับ would_create
          // ไม่งั้นรอบที่ไม่มีอะไรจะสร้าง = ดัมพ์ว่างเปล่า ซึ่งเป็นรอบที่อยากดูข้อมูลที่สุด)
          kanban_rows: [...new Set([...runs.values()].flatMap(r => [r.mat, ...r.mats]))]
            .map(m => ({
              mat: m,
              std: (lotRows.get(m) ?? []).map(k => ({
                lot_size: k.lot_size, qty_per_kanban: k.qty_per_kanban,
                min_qty: k.min_qty, max_qty: k.max_qty,
              })),
              param: paramRows.get(m)
                ? { calc_type: paramRows.get(m)!.calc_type, lot_qty: paramRows.get(m)!.lot_qty,
                    lot_size: paramRows.get(m)!.lot_size }
                : null,
              used: lotByMat.get(m) ?? null, from: lotSource.get(m) ?? null,
            }))
            .filter(x => x.std.length || x.param),
          mid_mode: cfg.mid_mode ?? 'lot', mid_lot_ratio: Number(cfg.mid_lot_ratio ?? 1),
          mid_min_pcs: midMin, mid_max_per_run: Number(cfg.mid_max_per_run ?? 12),
        },
        would_create: list.map(r => ({
          line: r.line_name, shift: r.shift, work_date: r.work_date,
          mat: r.mat_no, mats: r.mat_group, product: r.product_name,
          stage: STAGE_LABEL[r.stage], reason: REASON_LABEL[r.trigger_reason],
          at: hhmm(r.triggered_at), due: hhmm(r.due_at),
          seq: r.seq, at_qty: r.at_qty,
          part_linked: !!r.part_id,
        })),
        note: 'โหมดทดลอง — ยังไม่เขียนอะไรลงฐานข้อมูลและไม่ส่ง Telegram',
      });
    }

    if (rows.length) {
      const { data: ins, error } = await supabase.from('qa_fme_obligations')
        .upsert(rows, { onConflict: 'line_name,work_date,shift,mat_no,stage,seq', ignoreDuplicates: true })
        .select('id');
      if (error) throw new Error(`สร้างงานตรวจไม่สำเร็จ: ${error.message}`);
      created = ins?.length ?? 0;
    }

    /* ── 7) sync ว่า "ตรวจแล้วหรือยัง" ── */
    // เปิดใบตรวจ = รับงานแล้ว (หยุดเตือน) · ปิดใบ = จบงาน  ⇒ ห้ามเตือนซ้ำหลังคนรับงานแล้ว
    const { data: open } = await supabase.from('qa_fme_obligations')
      .select('*').in('status', ['pending', 'acked']).gte('work_date', yest);
    const obs = open ?? [];
    const { data: sheets } = await supabase.from('qa_inspection_sheets')
      .select('id, part_id, line_name, work_date, shift, stage, status, result')
      .in('work_date', [today, yest]);

    let closed = 0;
    for (const ob of obs) {
      let sh = ob.sheet_id ? (sheets ?? []).find(s => s.id === ob.sheet_id) : null;
      if (!sh) {
        // ใบที่ QA เปิดเองโดยไม่ผ่านปุ่มในคิว → จับคู่ด้วย พาร์ท+วัน+กะ+สเตจ
        sh = (sheets ?? []).find(s =>
          s.work_date === ob.work_date && s.shift === ob.shift &&
          s.stage === SHEET_STAGE[ob.stage] &&
          (ob.part_id ? s.part_id === ob.part_id : s.line_name === ob.line_name));
      }
      if (!sh) continue;
      const patch = sh.status === 'done'
        ? { status: sh.result === 'fail' ? 'done_ng' : 'done_ok', done_at: new Date().toISOString(), sheet_id: sh.id }
        : (ob.status === 'pending' ? { status: 'acked', acked_at: new Date().toISOString(), sheet_id: sh.id } : null);
      if (!patch) continue;
      await supabase.from('qa_fme_obligations').update(patch).eq('id', ob.id);
      Object.assign(ob, patch);
      if (sh.status === 'done') closed++;
    }

    /* ── 8) แจ้ง Telegram: เรียกครั้งแรก + เตือนซ้ำเมื่อเกินเวลา ── */
    const callChats = chatsFor(routes, 'qa_fme_call');
    const lateChats = chatsFor(routes, 'qa_fme_overdue');
    let calls = 0, escalations = 0;

    for (const ob of obs) {
      if (ob.status !== 'pending') continue;                       // acked/done = ไม่ต้องตาม
      const head = `🏭 <b>${ob.line_name}</b> · ${ob.shift === 'night' ? 'กะดึก' : 'กะเช้า'}\n` +
        `📦 รุ่น: <b>${ob.mat_no}</b>${ob.product_name ? ` (${ob.product_name})` : ''}\n` +
        `📌 เหตุ: ${REASON_LABEL[ob.trigger_reason] || ob.trigger_reason}` +
        (ob.part_id ? '' : '\n⚠️ ยังไม่ได้ผูกรุ่นนี้กับพาร์ทในระบบตรวจ (ตั้งที่ /qa-setup)');

      if (!ob.alert_count) {
        // ⚠️ นับว่า "เรียกแล้ว" เฉพาะเมื่อส่งออกจริง — ถ้ายังไม่ตั้งห้อง/ปิด rule ไว้ ต้องไม่กลืนการเรียก
        //    (ไม่งั้นพอไปเปิด rule ทีหลัง งานตรวจก้อนนั้นจะเงียบไปเลยทั้งที่ไม่มีใครเคยได้รับแจ้ง)
        if (!callChats || !callChats.length) continue;
        await sendTelegram(
          `🔔 <b>QA เรียกตรวจ — ${STAGE_LABEL[ob.stage]}</b>\n${head}\n` +
          `⏱️ ส่งผลภายใน ${Math.round((new Date(ob.due_at).getTime() - new Date(ob.triggered_at).getTime()) / 60000)} นาที ` +
          `(ภายใน ${hhmm(ob.due_at)})`, callChats);
        calls++;
        await supabase.from('qa_fme_obligations')
          .update({ alert_count: 1, last_alerted_at: now.toISOString() }).eq('id', ob.id);
        continue;
      }

      // เกินเวลาแล้ว → เตือนซ้ำทุก escalate_min จนกว่าจะรับงาน (มีเพดาน max_alerts กัน spam)
      if (now < new Date(ob.due_at) || ob.alert_count >= cfg.max_alerts) continue;
      const since = ob.last_alerted_at ? (now.getTime() - new Date(ob.last_alerted_at).getTime()) / 60000 : 1e9;
      if (since < cfg.escalate_min) continue;
      if (lateChats && lateChats.length) {
        const lateMin = Math.round((now.getTime() - new Date(ob.due_at).getTime()) / 60000);
        await sendTelegram(
          `🚨 <b>QA เกินเวลาตรวจ — ${STAGE_LABEL[ob.stage]}</b> (เตือนครั้งที่ ${ob.alert_count})\n${head}\n` +
          `⏰ เลยกำหนดมาแล้ว <b>${lateMin} นาที</b> (ครบกำหนด ${hhmm(ob.due_at)})`, lateChats);
        escalations++;
      }
      await supabase.from('qa_fme_obligations')
        .update({ alert_count: ob.alert_count + 1, last_alerted_at: now.toISOString() }).eq('id', ob.id);
    }

    return json({ ok: true, scanned: { sessions: sessions.length, runs: runs.size }, created, closed, calls, escalations });
  } catch (e) {
    console.error('qa-fme-scan', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
