/**
 * improvementA3Print — ใบ A3 Report ของโปรเจคปรับปรุง (Kaizen) · A3 แนวนอน บังคับจบใน 1 หน้า
 *
 * เล่าเรื่องหน้าเดียวตามกรอบที่เลือก (คำสั่ง user 2026-09-17 "PDCA หรือ DMAIC"):
 *   PDCA   ① ความเป็นมา ② สภาพปัจจุบัน ③ เป้าหมาย ④ สาเหตุราก | ⑤ มาตรการ ⑥ แผนงาน ⑦ ผลลัพธ์ ⑧ มาตรฐาน
 *   DMAIC  ①③ Define · ② Measure · ④ Analyze · ⑤⑥ Improve · ⑦⑧ Control
 *   → **ข้อมูลชุดเดียวกัน เปลี่ยนแค่ป้ายขั้น** (ห้ามทำเป็นใบคนละชุด/เก็บ phase คนละมาตรฐานลง DB)
 *
 * ⚠️ ตัวเลขทั้งใบมาจากสิ่งที่หน้าจอคำนวณแล้ว (computeResult/costSavingOf/targetSavingOf ใน
 *    Improvements.jsx) — **ห้ามคำนวณผล/เงินซ้ำในไฟล์นี้** ไม่งั้นได้ตัวเลข 2 ชุดที่เถียงกันเอง
 *    (กฎเดียวกับ "SCADA ห้ามคำนวณ OEE เอง" ใน CLAUDE.md)
 * ⚠️ พูดได้แค่ไหน = `resultMode()` ใน src/utils/improvementA3.js ตัวเดียว (มีเทสล็อกไว้)
 *    ยังไม่ลงมือ/ข้อมูลหลังแก้ไม่ถึงเกณฑ์ = ห้ามมีคำว่า "ประหยัดแล้ว" บนกระดาษ
 * ⚠️ "จบใน 1 หน้า" ใช้ `zoom` ไม่ใช่ `transform: scale` (transform ไม่ลดกล่อง layout → ยังหลายหน้า)
 *
 * เลขฟอร์ม/Rev/ช่องเซ็น/โลโก้ อ่านจากทะเบียนกลาง doc_key 'improvement_a3' — ห้าม hardcode
 */
import { getDocForm, fullCode, withDocFoot, sigAt, pageCss } from '../utils/docForms';
import { a3Sections, a3Data, resultMode, resultPct, moneyHeadline, modeNote, milestonePhaseLabel, planProgress, A3_FRAMEWORKS, normFramework } from '../utils/improvementA3';
import { RATE_COMPONENTS, fmtBaht } from '../utils/costSaving';
import tsLogoUrl from '../assets/TS logo.png';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nl2br = s => esc(s).replace(/\n/g, '<br>');
const fmt = (v, d = 0) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('th-TH', { maximumFractionDigits: d }));

/** รูป/โลโก้ฝังเป็น data URL ก่อนพิมพ์ — ปล่อยเป็น URL แล้วหน้าต่างพิมพ์อาจสั่ง print ก่อนรูปโหลดเสร็จ
 *  = ใบออกมาช่องรูปว่างโดยไม่มีใครรู้ (โหลดไม่ได้ = คืน '' แล้วใบเขียนว่า "ไม่มีรูป" ตามจริง) */
async function urlToDataUrl(url) {
  if (!url) return '';
  try {
    const res = await fetch(url);
    if (!res.ok) return '';
    const blob = await res.blob();
    return await new Promise(resolve => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve('');
      fr.readAsDataURL(blob);
    });
  } catch { return ''; }
}

const SRC_LABEL = { downtime: '🛑 Downtime', defect: '🔍 ของเสีย/คุณภาพ', mtn: '🛠️ ใบซ่อม MTN' };
const ST_LABEL = { monitoring: 'กำลังติดตามผล', done: 'ปิดจ๊อบ — สำเร็จ', cancelled: 'ยกเลิก' };
const MS_LABEL = { todo: 'ยังไม่เริ่ม', doing: 'กำลังทำ', done: 'เสร็จแล้ว' };

/**
 * @param {object}   p.imp          แถว improvements (รวม a3 jsonb ถ้ามี)
 * @param {object}   p.result       ผลก่อน/หลังจาก computeResult() — { noData } ได้
 * @param {object}   p.cost         costSavingOf(imp, result, potential) ที่หน้าคำนวณตาม mode แล้ว
 * @param {object}   p.target       targetSavingOf(imp, result) — null = ยังไม่ตั้งเป้า/คิดไม่ได้
 * @param {Array}    p.milestones   improvement_milestones ของโปรเจค (เรียง sort_order มาแล้ว)
 * @param {boolean}  p.started      doStarted(imp) — สวิตช์เดียวที่ปลดล็อก "ผลจริง"
 * @param {Array}    p.peReqs       pe_change_requests ที่ผูกโปรเจคนี้ (อาจว่าง)
 * @param {string}   p.framework    'pdca' | 'dmaic' (default = ค่าที่เก็บใน a3.framework)
 * @param {number}   p.workDaysMonth วันทำงาน/เดือน จากปฏิทินบริษัท (ใช้อธิบายที่มาของ บาท/เดือน)
 * @param {string}   p.today        วันที่ออกเอกสาร 'YYYY-MM-DD' (ฉีดเข้ามา ห้ามอ่านนาฬิกาเอง)
 * @param {string}   p.issuedBy     ผู้พิมพ์ (fullName)
 */
export async function printImprovementA3({
  imp, result, cost, target, milestones = [], started, peReqs = [],
  framework, workDaysMonth, today, issuedBy, section = null,
}) {
  const a3 = a3Data(imp);
  const fw = normFramework(framework || a3.framework);
  const df = await getDocForm('improvement_a3', {
    title: 'A3 Report — โปรเจคปรับปรุง (Kaizen)',
    sig_blocks: ['Approved By', 'Checked By', 'Issued By'],
  }, section ? { section } : {});

  const [logo, imgBefore, imgAfter] = await Promise.all([
    urlToDataUrl(df.logo_url || tsLogoUrl),
    urlToDataUrl(imp.image_before_url),
    urlToDataUrl(imp.image_after_url),
  ]);

  const code = fullCode(df);
  const r = result;
  const mode = resultMode(r, started);
  const pct = resultPct(r);
  const money = moneyHeadline(mode, cost?.totalPerDay);
  const note = modeNote(mode, r);
  const secs = a3Sections(fw);
  const secOf = (key) => secs.find(s => s.key === key) || { no: '', title: '', meta: { s: '', label: '', color: '#6b7280' } };
  const prog = planProgress(milestones);
  const unit = r && !r.noData ? r.unit : '';

  const sigs = [sigAt(df, 0), sigAt(df, 1), sigAt(df, 2)];

  /** กล่อง 1 ช่องของใบ — ว่างต้องบอกว่าไปกรอกที่ไหน ห้ามปล่อยช่องเปล่าเฉยๆ */
  const panel = (key, body, opts = {}) => {
    const s = secOf(key);
    return `
    <section class="pnl${opts.grow ? ' grow' : ''}">
      <h2>
        <span class="no">${s.no}</span>${esc(s.title)}
        <span class="ph" style="background:${s.meta.color}22;color:${s.meta.color};border-color:${s.meta.color}66">${esc(s.meta.s)} · ${esc(s.meta.label)}</span>
      </h2>
      <div class="bd${opts.pad0 ? ' p0' : ''}">${body || `<div class="empty">— ${esc(opts.emptyHint || 'ยังไม่ได้กรอก (กรอกได้ที่ปุ่ม 📋 A3 ในหน้า Improvements ก่อนพิมพ์)')} —</div>`}</div>
    </section>`;
  };

  /* ── ① ความเป็นมา / ปัญหา — ข้อเท็จจริงของโปรเจค + คำอธิบายที่คนเขียน ── */
  const factRow = (k, v) => `<tr><td class="k">${esc(k)}</td><td>${v}</td></tr>`;
  const background = `
    <table class="kv">
      ${factRow('ไลน์ / จุดงาน', `<b>${esc(imp.line_name)}</b>${imp.machine_no ? ` · เครื่อง <b>${esc(imp.machine_no)}</b>` : ' · ทั้งไลน์'}${imp.mat_no ? ` · สินค้า <b>${esc(imp.mat_no)}</b>` : ''}`)}
      ${factRow('ปัญหาที่เล็ง', `${esc(SRC_LABEL[imp.problem_source] || imp.problem_source || '—')} — <b>${esc(imp.problem_label || 'ทุกประเภท')}</b>`)}
      ${factRow('ช่วงเทียบผล', `ก่อนแก้ ${fmt(imp.baseline_days)} วัน ↔ หลังแก้ ${fmt(imp.baseline_days)} วัน · จุดตัด = ${esc(imp.start_date || '—')}`)}
      ${factRow('สถานะโปรเจค', `${esc(ST_LABEL[imp.status] || imp.status || '—')}${started ? ` · ยืนยันเริ่มลงมือแก้ ${esc(imp.do_started_at || imp.start_date || '')}` : ' · <b>ยังไม่ยืนยันเริ่มลงมือแก้</b>'}`)}
      ${a3.team ? factRow('ทีมงาน', nl2br(a3.team)) : ''}
    </table>
    ${a3.background ? `<div class="tx">${nl2br(a3.background)}</div>` : ''}
    ${imp.description ? `<div class="tx"><b>สภาพปัญหา:</b> ${nl2br(imp.description)}</div>` : ''}`;

  /* ── ② สภาพปัจจุบัน — ตัวเลขจริงจากระบบ (ไม่มีข้อมูล = เขียนว่าไม่มี ห้ามพิมพ์ 0) ── */
  const bar = (label, perDay, total, days, color) => {
    const max = Math.max(r.beforePerDay || 0, r.afterPerDay || 0, 0.0001);
    return `<div class="barrow">
      <span class="bl">${esc(label)}</span>
      <span class="bt"><i style="width:${Math.min(100, ((perDay || 0) / max) * 100)}%;background:${color}"></i></span>
      <span class="bv" style="color:${color}">${fmt(perDay, 1)} ${esc(unit)}/วัน <span class="sub">(${fmt(total, 0)} / ${fmt(days, 0)} วันผลิต)</span></span>
    </div>`;
  };
  /* ⚠️ มีกะในช่วงหลัง แต่ไม่มีกะเลยก่อนวันเริ่มแก้ = **ไม่มี baseline** — พิมพ์ 0 ทั้งแถว
     อ่านเหมือน "ไม่มีปัญหาแล้ว" ทั้งที่แปลว่าวัดไม่ได้ (กฎเดียวกับ missing ของ costSavingOf) */
  const noBaseline = r && !r.noData && !r.beforeDays;
  const noBaselineWarn = '<div class="warn">⚠ ไม่มีกะที่ปิดแล้วในช่วง "ก่อนวันเริ่มแก้" — ยังไม่มีฐานเทียบ (baseline) · ตัวเลข 0 ในช่องนี้แปลว่า "วัดไม่ได้" ไม่ใช่ "ไม่มีปัญหา" — ขยายหน้าต่างเทียบ หรือตรวจวันเริ่มโปรเจค</div>';
  const current = (!r || r.noData)
    ? `<div class="warn">⚠ ${esc(note)}</div>`
    : noBaseline ? noBaselineWarn : `<div class="kpi">
        <div><div class="v">${fmt(r.beforePerDay, 1)}</div><div class="l">ก่อนแก้ (${esc(unit)}/วัน)</div></div>
        <div><div class="v">${fmt(r.beforeTotal, 0)}</div><div class="l">รวมก่อนแก้ (${esc(unit)})</div></div>
        <div><div class="v">${fmt(r.beforeDays, 0)}</div><div class="l">วันผลิตที่ใช้เทียบ</div></div>
        <div><div class="v">${cost?.totalPerMonth != null && money.potential ? fmtBaht(Math.abs(cost.totalPerMonth)) : '—'}</div><div class="l">มูลค่าปัญหา (บาท/เดือน)</div></div>
      </div>
      ${bar(started ? 'ก่อนแก้' : 'ปัจจุบัน', r.beforePerDay, r.beforeTotal, r.beforeDays, '#dc2626')}
      ${r.source === 'mtn' ? `<div class="sub">⏱ เครื่องหยุดจริงจาก downtime ที่ผูกใบ: ก่อน ${fmt(r.beforeMin)} นาที${(r.beforeMinUnlinked || 0) ? ` · ⚠ ${r.beforeMinUnlinked} ใบไม่มี downtime ผูก (นาทีส่วนนั้นไม่ถูกนับ)` : ''}</div>` : ''}
      <div class="sub">ที่มา: กะที่ปิดแล้วของไลน์ในช่วงเทียบ — หารด้วย<b>วันที่มีการผลิตจริง</b> ไม่ใช่วันปฏิทิน</div>`;

  /* ── ③ เป้าหมาย — ไม่ตั้งเป้า = เตือน ห้ามเงียบ ── */
  const targetBody = Number(imp.target_value) > 0
    ? `<div class="tx">🎯 <b>${imp.target_mode === 'per_day'
        ? `ลดลง ${fmt(imp.target_value, 1)} ${esc(unit || 'หน่วย')}/วัน`
        : `ลด ${fmt(imp.target_value, 0)}%`}</b>
        ${r && !r.noData && r.beforePerDay > 0 && target ? ` (จาก ${fmt(r.beforePerDay, 1)} → ${fmt(r.beforePerDay * (1 - target.frac), 1)} ${esc(unit)}/วัน)` : ''}
      </div>
      ${target?.perMonth != null ? `<div class="tx">💰 ถึงเป้า = คาดว่าจะประหยัด <b>~${fmtBaht(target.perMonth)} บาท/เดือน</b> <span class="sub">(เพดานถ้าแก้หายหมด ~${fmtBaht(target.capPerMonth)})</span></div>` : ''}
      <div class="sub">${started ? 'ผลจริงเทียบกับเป้านี้อยู่ในช่อง ' + secOf('result').no : 'ยังไม่ลงมือแก้ — ตัวเลขนี้เป็นเป้า ไม่ใช่ผล'}</div>`
    : `<div class="warn">⚠ ยังไม่ได้ตั้งเป้าหมาย — ตั้งที่ปุ่ม ✏️ แก้ไข ในหน้า Improvements (ไม่มีเป้า = วัดความสำเร็จของโปรเจคไม่ได้)</div>`;

  /* ── ⑤ มาตรการแก้ไข + รูปก่อน/หลัง ── */
  const photo = (src, label, url) => `<figure><figcaption>${esc(label)}</figcaption>${
    src ? `<img src="${src}" alt="${esc(label)}">`
        : `<div class="nopic">${url ? 'โหลดรูปไม่สำเร็จ' : 'ไม่มีรูป'}</div>`}</figure>`;
  const countermeasure = `
    ${imp.action_taken ? `<div class="tx"><b>การแก้ไขที่บันทึกไว้:</b> ${nl2br(imp.action_taken)}</div>` : ''}
    ${a3.countermeasures ? `<div class="tx">${nl2br(a3.countermeasures)}</div>` : ''}
    ${(imp.image_before_url || imp.image_after_url) ? `<div class="pics">
      ${photo(imgBefore, 'ก่อนแก้ไข', imp.image_before_url)}
      ${photo(imgAfter, 'หลังแก้ไข', imp.image_after_url)}
    </div>` : ''}`.trim();

  /* ── ⑥ แผนดำเนินการ (milestone จริงจากระบบ) ── */
  const msRows = milestones.map(m => {
    const ph = milestonePhaseLabel(m.phase, fw);
    const late = m.status !== 'done' && m.planned_end && today && m.planned_end < today;
    return `<tr>
      <td class="c"><span class="chip" style="background:${ph.color}22;color:${ph.color}">${esc(ph.s)}</span></td>
      <td>${esc(m.title)}${m.note ? `<div class="sub">💬 ${esc(m.note)}</div>` : ''}</td>
      <td class="c">${esc(m.assignee || '—')}</td>
      <td class="c">${esc(m.planned_start || '—')} → ${esc(m.planned_end || '—')}</td>
      <td class="c${late ? ' late' : ''}">${esc(MS_LABEL[m.status] || m.status)}${late ? ' ⚠ เลยแผน' : ''}${m.done_at ? `<div class="sub">${esc(m.done_at)}</div>` : ''}</td>
    </tr>`;
  }).join('');
  const planBody = msRows
    ? `<table class="tb"><thead><tr><th style="width:30px">ขั้น</th><th>งาน</th><th style="width:78px">ผู้รับผิดชอบ</th><th style="width:132px">แผน</th><th style="width:88px">สถานะ</th></tr></thead><tbody>${msRows}</tbody></table>`
    : '';

  /* ── ⑦ ผลลัพธ์ + เงิน — ใจกลางของกฎ "ห้ามพูดเกินจริง" ── */
  const compLine = cost ? RATE_COMPONENTS.map(c => `${esc(c.label)} ${fmtBaht(cost.comp?.[c.key] || 0)}`).join(' · ') : '';
  const resultBody = (!r || r.noData)
    ? `<div class="warn">⚠ ${esc(note)}</div>`
    : `${noBaseline ? noBaselineWarn : ''}
      ${mode === 'confirmed'
        ? `<div class="big" style="color:${pct != null && pct > 0 ? '#16a34a' : '#dc2626'}">${pct == null ? '—' : `${pct > 0 ? '▼' : '▲'} ${Math.abs(pct)}%`}
             <span class="sub">เทียบก่อน/หลังวันเริ่มแก้ (${esc(imp.start_date)})</span></div>`
        : `<div class="warn">⏳ ${esc(note)}</div>`}
      ${noBaseline ? '' : bar(started ? 'ก่อนแก้' : 'ปัจจุบัน', r.beforePerDay, r.beforeTotal, r.beforeDays, '#dc2626')}
      ${started ? bar('หลังแก้', r.afterPerDay, r.afterTotal, r.afterDays, mode === 'confirmed' && pct > 0 ? '#16a34a' : '#f59e0b') : ''}
      <div class="money">
        <div class="mh">💰 ${esc(money.label)}${cost?.cc ? ` <span class="sub">· CC ${esc(cost.cc)}</span>` : ''}</div>
        ${cost?.totalPerDay == null
          ? `<div class="warn">ยังคำนวณเป็นบาทไม่ได้ — ${cost?.missing?.length ? esc(cost.missing.join(' · ')) : 'ข้อมูลต้นทุนไม่ครบ'}</div>`
          : `<div class="mv">~${fmtBaht(Math.abs(cost.totalPerDay))} บาท/วัน · <b>~${fmtBaht(Math.abs(cost.totalPerMonth))} บาท/เดือน</b>
               <span class="sub">(${fmt(workDaysMonth, 0)} วันทำงาน/เดือน ตามปฏิทินบริษัท)</span></div>
             <div class="sub">${compLine}${imp.problem_source === 'defect' ? ` · วัสดุ/Std ${fmtBaht(cost.matPerDay || 0)}` : ''}${imp.problem_source === 'mtn' ? ` · ค่าซ่อมจริง ${fmtBaht(cost.repairPerDay || 0)}` : ''} (บาท/วัน)</div>
             ${cost.invest > 0 ? `<div class="sub">🏗 ลงทุน ${fmtBaht(cost.invest)} บาท${cost.payback ? ` → คืนทุน${money.potential ? 'เร็วสุด (ถ้าแก้หายหมด)' : ''} ~${cost.payback < 10 ? cost.payback.toFixed(1) : Math.round(cost.payback)} เดือน` : ' — ยังไม่มี saving ให้คืนทุน'}</div>` : ''}`}
        ${cost?.totalPerDay != null ? (cost.missing || []).map(m => `<div class="warn">⚠ ${esc(m)}</div>`).join('') : ''}
      </div>`;

  /* ── ⑧ มาตรฐาน & ขยายผล — ผูกกับคำขอแก้เอกสาร PE ของจริง ── */
  /* ใบ A3 จบใน 1 หน้า — รายการ PE ยาวๆ จะดันช่องอื่นจนถูกย่อทั้งใบ ⇒ ตัดที่ 8 แถว
     แต่ **ต้องบอกว่าตัดไปกี่รายการ + ดูต่อที่ไหน** ห้ามตัดเงียบ */
  const PE_CAP = 8;
  const peMore = Math.max(0, peReqs.length - PE_CAP);
  const peRows = peReqs.slice(0, PE_CAP).map(p => `<tr>
      <td class="c">${esc(p.doc_type || '—')}</td>
      <td>${esc(p.proposal || '')}</td>
      <td class="c">${esc(p.status || '')}</td>
    </tr>`).join('');
  const standardize = `
    ${imp.result_note ? `<div class="tx"><b>สรุปผลตอนปิดจ๊อบ:</b> ${nl2br(imp.result_note)}</div>` : ''}
    ${a3.standardize ? `<div class="tx">${nl2br(a3.standardize)}</div>` : ''}
    ${peRows
      ? `<div class="sub" style="margin-top:3px">📐 คำขอแก้เอกสาร PE ที่เกิดจากโปรเจคนี้</div>
         <table class="tb"><thead><tr><th style="width:52px">เอกสาร</th><th>ข้อเสนอ</th><th style="width:62px">สถานะ</th></tr></thead><tbody>${peRows}</tbody></table>
         ${peMore ? `<div class="sub">… และอีก ${peMore} รายการ — ดูทั้งหมดที่ปุ่ม 📐 PE บนการ์ดโปรเจค</div>` : ''}`
      : '<div class="sub">📐 ยังไม่มีคำขอแก้เอกสาร PE (PFMEA/Control Plan) จากโปรเจคนี้ — เสนอได้ที่ปุ่ม 📐 PE บนการ์ด</div>'}`;

  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<title>A3 Report — ${esc(imp.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;800&display=swap" rel="stylesheet">
<style>
  @page { size: ${pageCss(df, 'A3 landscape')}; margin: 7mm; }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; background:#fff; }
  body { font-family:'Sarabun',sans-serif; color:#111827; font-size:10px; }
  #sheet { width: 406mm; }                 /* A3 นอน 420 − ขอบ 2×7 */

  .hd { display:flex; border:1.5px solid #111827; align-items:stretch }
  .hd .logo { width:118px; display:flex; align-items:center; justify-content:center; border-right:1.2px solid #111827; padding:4px }
  .hd .logo img { max-width:100%; max-height:40px }
  .hd .ttl { flex:1; padding:4px 10px; border-right:1.2px solid #111827 }
  .hd .ttl h1 { margin:0; font-size:15px; font-weight:800 }
  .hd .ttl .thm { font-size:10.5px; margin-top:2px }
  .hd .meta { width:236px; padding:4px 8px; border-right:1.2px solid #111827; font-size:9px }
  .hd .meta div { display:flex; justify-content:space-between; line-height:1.5 }
  .hd .meta .k { color:#4b5563 }
  .hd .sig { display:flex }
  .hd .sig .b { width:86px; border-left:1px solid #111827; text-align:center; font-size:8px; padding:2px; display:flex; flex-direction:column }
  .hd .sig .b:first-child { border-left:none }
  .hd .sig .lb { color:#4b5563 }
  .hd .sig .sp { flex:1; min-height:26px }
  .hd .sig .nm { border-top:1px dotted #6b7280; font-weight:600; font-size:8px }

  .cols { display:flex; gap:4px; margin-top:4px; align-items:stretch }
  .col { display:flex; flex-direction:column; gap:4px; width:50% }

  .pnl { border:1.2px solid #111827; display:flex; flex-direction:column }
  .pnl.grow { flex:1 }
  .pnl h2 { margin:0; font-size:10.5px; font-weight:800; background:#e5edf7; border-bottom:1px solid #111827;
            padding:2px 7px; display:flex; align-items:center; gap:6px }
  .pnl h2 .no { display:inline-flex; align-items:center; justify-content:center; width:15px; height:15px;
                border-radius:50%; background:#111827; color:#fff; font-size:9px; flex:0 0 auto }
  .pnl h2 .ph { margin-left:auto; font-size:8px; font-weight:800; border:1px solid; border-radius:9px; padding:0 6px }
  .pnl .bd { padding:5px 8px; font-size:9.5px; line-height:1.5; flex:1 }
  .pnl .bd.p0 { padding:2px }
  .empty { color:#9ca3af; font-style:italic; font-size:9px }
  .tx { margin-bottom:3px }
  .sub { color:#4b5563; font-size:8.5px }
  .warn { color:#b45309; font-weight:600; background:#fffbeb; border:1px solid #fcd34d; border-radius:3px; padding:3px 5px; margin:2px 0 }

  table.kv { width:100%; border-collapse:collapse; margin-bottom:3px }
  table.kv td { padding:1px 0; vertical-align:top }
  table.kv td.k { width:82px; color:#4b5563 }

  .kpi { display:flex; gap:4px; margin-bottom:4px }
  .kpi div { flex:1; border:1px solid #9ca3af; text-align:center; padding:2px }
  .kpi .v { font-size:12.5px; font-weight:800; line-height:1.15 }
  .kpi .l { font-size:7.5px; color:#4b5563 }

  .barrow { display:flex; align-items:center; gap:6px; margin:2px 0 }
  .barrow .bl { width:40px; color:#4b5563; font-weight:700; flex:0 0 auto }
  .barrow .bt { flex:1; height:12px; background:#f1f5f9; border-radius:3px; overflow:hidden; display:block }
  .barrow .bt i { display:block; height:100%; border-radius:3px }
  .barrow .bv { width:150px; text-align:right; font-weight:800; flex:0 0 auto }

  .big { font-size:17px; font-weight:800; margin:2px 0 }
  .money { border-top:1px dashed #9ca3af; margin-top:4px; padding-top:3px }
  .money .mh { font-weight:800 }
  .money .mv { font-size:12px; font-weight:800; color:#111827 }

  table.tb { width:100%; border-collapse:collapse; font-size:9px }
  table.tb th, table.tb td { border:1px solid #9ca3af; padding:2px 4px; vertical-align:top }
  table.tb th { background:#f1f5f9; font-weight:700 }
  table.tb td.c { text-align:center }
  table.tb td.late { color:#b91c1c; font-weight:700 }
  .chip { display:inline-block; font-weight:800; border-radius:8px; padding:0 5px; font-size:8px }

  .pics { display:flex; gap:5px; margin-top:3px }
  .pics figure { flex:1; margin:0; text-align:center }
  .pics figcaption { font-size:8.5px; font-weight:700; color:#4b5563 }
  .pics img { width:100%; max-height:38mm; object-fit:contain; border:1px solid #9ca3af }
  .pics .nopic { height:20mm; border:1px dashed #9ca3af; display:flex; align-items:center; justify-content:center; color:#9ca3af; font-size:8.5px }

  .ft { display:flex; justify-content:space-between; font-size:8px; color:#4b5563; margin-top:3px }
</style></head><body>
<div id="sheet">

  <div class="hd">
    <div class="logo">${logo ? `<img src="${logo}" alt="">` : ''}</div>
    <div class="ttl">
      <h1>A3 REPORT — ${esc(imp.title)}</h1>
      <div class="thm">
        <b>กรอบการเล่าเรื่อง:</b> ${esc(A3_FRAMEWORKS[fw].label)}
        &nbsp;·&nbsp; <b>ไลน์:</b> ${esc(imp.line_name)}
        ${imp.machine_no ? `&nbsp;·&nbsp; <b>เครื่อง:</b> ${esc(imp.machine_no)}` : ''}
        ${imp.mat_no ? `&nbsp;·&nbsp; <b>สินค้า:</b> ${esc(imp.mat_no)}` : ''}
        &nbsp;·&nbsp; <b>ปัญหา:</b> ${esc(imp.problem_label || SRC_LABEL[imp.problem_source] || '—')}
        &nbsp;·&nbsp; <b>แผนงาน:</b> ${prog.total ? `${prog.done}/${prog.total} ขั้น` : 'ยังไม่มีแผนงาน'}
      </div>
    </div>
    <div class="meta">
      <div><span class="k">ผู้จัดทำ</span><span>${esc(imp.created_by_name || issuedBy || '—')}</span></div>
      <div><span class="k">วันเริ่มแก้ (จุดตัด)</span><span>${esc(imp.start_date)}</span></div>
      <div><span class="k">วันที่พิมพ์</span><span>${esc(today || '')}</span></div>
      <div><span class="k">เอกสาร</span><span>${esc(code || '—')}</span></div>
    </div>
    <div class="sig">
      ${sigs.map(s => `<div class="b"><div class="lb">${esc(s.label)}</div><div class="sp"></div><div class="nm">${esc(s.name || '')}</div></div>`).join('')}
    </div>
  </div>

  <div class="cols">
    <div class="col">
      ${panel('background', background)}
      ${panel('current', current)}
      ${panel('target', targetBody)}
      ${panel('rootCause', a3.root_cause ? nl2br(a3.root_cause) : '', {
        grow: true,
        emptyHint: 'ยังไม่ได้วิเคราะห์สาเหตุราก (ระบบไม่เดาสาเหตุให้ — กรอกที่ปุ่ม 📋 A3 ในหน้า Improvements)',
      })}
    </div>
    <div class="col">
      ${panel('countermeasure', countermeasure, {
        emptyHint: started ? 'ยังไม่ได้บันทึกมาตรการแก้ไข' : 'ยังไม่ได้ลงมือแก้ (อยู่ช่วงวิเคราะห์/วางแผน)',
      })}
      ${panel('plan', planBody, { pad0: !!planBody, emptyHint: 'ยังไม่มีขั้นงานในแผน — เพิ่มได้ที่แผง 🗓 แผนงาน บนการ์ด' })}
      ${panel('result', resultBody, { grow: true })}
      ${panel('standardize', standardize, {
        emptyHint: 'ยังไม่ได้สรุปมาตรฐาน/ขยายผล — งานที่แก้แล้วไม่ถูกทำเป็นมาตรฐาน มีโอกาสกลับมาเกิดซ้ำ',
      })}
    </div>
  </div>

  <div class="ft">
    <span>ตัวเลขทุกช่องมาจากข้อมูลจริงในระบบ ESM (กะที่ปิดแล้ว · downtime/ของเสีย/ใบซ่อม · activity rate ของ cost center)${money.potential ? ' — ใบนี้ยังไม่มี "ผลที่ยืนยันแล้ว" ตัวเงินคือมูลค่าปัญหาก่อนแก้' : ''}</span>
    <span>${esc(code)}${df.effective_date ? ` · Effective: ${esc(df.effective_date)}` : ''}</span>
  </div>
</div>

<script>
  // บังคับจบใน 1 หน้า — ย่อด้วย zoom (ลดกล่อง layout จริง) ไม่ใช่ transform: scale
  (function () {
    function fit() {
      var el = document.getElementById('sheet');
      var maxH = 283 * (96 / 25.4);          // A3 นอน 297mm − ขอบ 2×7mm
      el.style.zoom = 1;
      var h = el.scrollHeight;
      if (h > maxH) el.style.zoom = Math.max(0.45, (maxH / h) * 0.995);
      window.focus(); window.print();
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ setTimeout(fit, 60); });
    else window.addEventListener('load', function(){ setTimeout(fit, 160); });
  })();
</script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false;               // popup ถูกบล็อก — ผู้เรียกต้องขึ้น toast บอก ห้ามเงียบ
  w.document.write(withDocFoot(html, 'improvement_a3', section ? { section } : {}));
  w.document.close();
  return true;
}
