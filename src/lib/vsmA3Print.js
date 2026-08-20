/**
 * vsmA3Print — ใบ A3 Report รูปแบบ Toyota / Denso (A3 แนวนอน · บังคับจบใน 1 หน้า)
 *
 * A3 Report ไม่ใช่ "แค่กระดาษ A3" — เป็นเอกสารเล่าเรื่องหน้าเดียวตามลำดับ PDCA
 *   ซ้าย  (Plan)          ① ความเป็นมา → ② สภาพปัจจุบัน (ผัง VSM อยู่ตรงนี้) → ③ เป้าหมาย → ④ วิเคราะห์สาเหตุ
 *   ขวา   (Do-Check-Act)  ⑤ มาตรการแก้ไข → ⑥ แผนดำเนินการ (ใคร/อะไร/เมื่อไหร่) → ⑦ ติดตามผล
 *
 * ⚠️ ผัง VSM ไม่ได้วาดใหม่ที่นี่ — รับ `svgHtml` ที่ clone จาก <VsmCanvas> ตัวจริงบนจอ
 *    (กฎ CLAUDE.md: ห้ามจำลอง layout ใบจริงมาไว้ในตัวพิมพ์ = layout ชุดที่ 2 ที่ต้องตามแก้)
 *
 * ⚠️ "จบใน 1 หน้า" ใช้ `zoom` ไม่ใช่ `transform: scale`
 *    transform เป็นภาพลวงตา ไม่ลดกล่อง layout → เบราว์เซอร์ยังนับหลายหน้า
 *    (บทเรียนเดียวกับใบประเมินรายบุคคล F-PRS-P1-119 — CLAUDE.md)
 *
 * เลขฟอร์ม/Rev/ช่องเซ็น/โลโก้ อ่านจากทะเบียนกลาง doc_key 'vsm' — ห้าม hardcode
 */
import { getDocForm, fullCode, withDocFoot, sigAt, pageCss } from '../utils/docForms';
import { fmtMct, fmtMinSec } from './vsmModel';
import tsLogoUrl from '../assets/TS logo.png';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nl2br = s => esc(s).replace(/\n/g, '<br>');
const fmt = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString('th-TH', { maximumFractionDigits: d }));

async function urlToDataUrl(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise(resolve => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve('');
      fr.readAsDataURL(blob);
    });
  } catch { return ''; }
}

/**
 * ข้อเท็จจริงของสภาพปัจจุบัน — ดึงจากโมเดลล้วน ไม่ตีความ ไม่เดา
 * (ส่วนที่เป็น "การวิเคราะห์" ปล่อยให้คนเขียนเอง — ระบบไม่รู้ว่าอะไรคือสาเหตุ)
 */
export function currentConditionFacts(model) {
  const f = [];
  const T = model.totals, I = model.info;
  if (T.pltDays != null) f.push(`Lead time รวม (PLT) = <b>${fmt(T.pltDays, 2)} วัน</b> · เวลางานจริง (PT) = <b>${fmtMinSec(T.ptSec) || '—'}</b> · <b style="color:#dc2626">MCT = ${fmtMct(T.pltDays, T.ptSec) || '—'}</b>`);
  if (T.vaPct != null) f.push(`สัดส่วนงานที่สร้างคุณค่า <b>%VA = ${fmt(T.vaPct, 2)}%</b> — เวลาที่เหลือคือของรออยู่ในสายการผลิต`);
  if (I.ttSec != null) f.push(`Takt time = <b>${fmt(I.ttSec, 1)} วินาที</b> (ลูกค้าต้องการ ${fmt(I.orderDay)} ชิ้น/วัน)`);

  // คอขวด: ขั้นที่ CT เกิน TT
  if (I.ttSec != null) {
    const over = model.chain.filter(b => b.ct != null && b.ct > I.ttSec)
      .sort((a, b) => b.ct - a.ct);
    if (over.length) f.push(`ขั้นที่ <b>C/T เกิน Takt</b>: ${over.slice(0, 3).map(b => `${esc(b.name)} (${fmt(b.ct, 1)}s)`).join(' · ')}`);
  }
  // คงคลังก้อนใหญ่สุด
  const inv = [...model.inventories].filter(v => v.days != null).sort((a, b) => b.days - a.days)[0];
  // หน่วยตามของจริง — วัตถุดิบเป็น KG/coil ไม่ใช่ชิ้น (ห้าม hardcode "ชิ้น")
  if (inv) f.push(`คงคลังที่กินเวลามากสุด: <b>${esc(inv.label)}</b> ${fmt(inv.qty)} ${esc(inv.uom || 'ชิ้น')} = <b>${fmt(inv.days, 2)} วัน</b>`);
  // OEE ต่ำสุด
  const low = [...model.chain].filter(b => b.oeePct != null).sort((a, b) => a.oeePct - b.oeePct)[0];
  if (low) f.push(`%OEE ต่ำสุดในสาย: <b>${esc(low.name)} = ${fmt(low.oeePct, 1)}%</b>`);
  // C/O สูงสุด
  const co = [...model.chain].filter(b => b.setupSec != null).sort((a, b) => b.setupSec - a.setupSec)[0];
  if (co && co.setupSec > 0) f.push(`เวลาปรับตั้งสูงสุด (C/O): <b>${esc(co.name)} = ${fmt(co.setupSec)} วินาที</b>`);
  return f;
}

const STATE_LABEL = { current: 'Current state', future: 'Future state', ideal: 'Ideal state' };

export async function printVsmA3({ map, model, svgHtml, legendHtml, section = null }) {
  const df = await getDocForm('vsm', {
    title: 'แผนผังสายธารคุณค่า (Value Stream Map)',
    sig_blocks: ['Approved By', 'Checked By', 'Issued By'],
  }, section ? { section } : {});

  const logo = await urlToDataUrl(df.logo_url || tsLogoUrl);
  const code = fullCode(df);
  const h = model.header, T = model.totals, I = model.info;
  const a3 = map.a3 || {};

  const sigs = [
    { ...sigAt(df, 0), val: map.approved_by },
    { ...sigAt(df, 1), val: map.checked_by },
    { ...sigAt(df, 2), val: map.issued_by },
  ];

  const facts = currentConditionFacts(model);

  /** กล่องหัวข้อ 1 ช่องของ A3 — ว่างต้องบอกว่าให้กรอกที่ไหน ห้ามปล่อยช่องเปล่าเฉยๆ */
  const panel = (no, title, body, opts = {}) => `
    <section class="pnl${opts.grow ? ' grow' : ''}">
      <h2><span class="no">${no}</span>${esc(title)}</h2>
      <div class="bd${opts.pad0 ? ' p0' : ''}">${body || '<div class="empty">— ยังไม่ได้กรอก (กรอกได้ในหน้า VSM ก่อนพิมพ์) —</div>'}</div>
    </section>`;

  const planRows = Array.isArray(a3.plan) && a3.plan.length
    ? a3.plan.map(r => `<tr><td>${esc(r.what)}</td><td class="c">${esc(r.who)}</td><td class="c">${esc(r.when)}</td><td class="c">${esc(r.status)}</td></tr>`).join('')
    : '';

  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<title>A3 Report — ${esc(h.partName || h.matNo)}</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;800&display=swap" rel="stylesheet">
<style>
  @page { size: ${pageCss(df, 'A3 landscape')}; margin: 7mm; }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; background:#fff; }
  body { font-family:'Sarabun',sans-serif; color:#111827; font-size:10px; }
  #sheet { width: 406mm; }               /* A3 นอน 420 − ขอบ 2×7 */

  .hd { display:flex; border:1.5px solid #111827; align-items:stretch; }
  .hd .logo { width:118px; display:flex; align-items:center; justify-content:center; border-right:1.2px solid #111827; padding:4px }
  .hd .logo img { max-width:100%; max-height:40px }
  .hd .ttl { flex:1; padding:4px 10px; border-right:1.2px solid #111827 }
  .hd .ttl h1 { margin:0; font-size:15px; font-weight:800; letter-spacing:.2px }
  .hd .ttl .thm { font-size:10.5px; margin-top:2px }
  .hd .ttl .thm b { font-weight:800 }
  .hd .meta { width:250px; padding:4px 8px; border-right:1.2px solid #111827; font-size:9px }
  .hd .meta div { display:flex; justify-content:space-between; line-height:1.5 }
  .hd .meta .k { color:#4b5563 }
  .hd .sig { display:flex }
  .hd .sig .b { width:86px; border-left:1px solid #111827; text-align:center; font-size:8px; padding:2px; display:flex; flex-direction:column }
  .hd .sig .b:first-child { border-left:none }
  .hd .sig .lb { color:#4b5563 }
  .hd .sig .sp { flex:1; min-height:26px }
  .hd .sig .nm { border-top:1px dotted #6b7280; font-weight:600; font-size:8px }

  .cols { display:flex; gap:4px; margin-top:4px; align-items:stretch }
  .col { display:flex; flex-direction:column; gap:4px }
  .col.l { width:62% } .col.r { width:38% }

  .pnl { border:1.2px solid #111827; display:flex; flex-direction:column }
  .pnl.grow { flex:1 }
  .pnl h2 { margin:0; font-size:10.5px; font-weight:800; background:#e5edf7; border-bottom:1px solid #111827;
            padding:2px 7px; display:flex; align-items:center; gap:6px }
  .pnl h2 .no { display:inline-flex; align-items:center; justify-content:center; width:15px; height:15px;
                border-radius:50%; background:#111827; color:#fff; font-size:9px; flex:0 0 auto }
  .pnl .bd { padding:5px 8px; font-size:9.5px; line-height:1.5; flex:1 }
  .pnl .bd.p0 { padding:2px }
  .empty { color:#9ca3af; font-style:italic; font-size:9px }

  ul.f { margin:0; padding-left:14px } ul.f li { margin-bottom:1.5px }

  .kpi { display:flex; gap:4px; margin-bottom:4px }
  .kpi div { flex:1; border:1px solid #9ca3af; text-align:center; padding:2px }
  .kpi .v { font-size:13px; font-weight:800; line-height:1.1 }
  .kpi .l { font-size:7.5px; color:#4b5563 }

  .map { text-align:center }
  .map svg { width:100%; height:auto; max-height:112mm }

  table.pl { width:100%; border-collapse:collapse; font-size:9px }
  table.pl th, table.pl td { border:1px solid #9ca3af; padding:2px 4px; }
  table.pl th { background:#f1f5f9; font-weight:700 }
  table.pl td.c { text-align:center; white-space:nowrap }

  .lg { border:1.2px solid #111827; margin-top:4px; padding:2px 4px }
  .lg .t { font-size:8.5px; font-weight:800; margin-bottom:1px }
  .ft { display:flex; justify-content:space-between; font-size:8px; color:#4b5563; margin-top:3px }
</style></head><body>
<div id="sheet">

  <div class="hd">
    <div class="logo">${logo ? `<img src="${logo}" alt="">` : ''}</div>
    <div class="ttl">
      <h1>A3 REPORT — ${esc(a3.title || 'ปรับปรุงสายธารคุณค่า (Value Stream Improvement)')}</h1>
      <div class="thm">
        <b>Part:</b> ${esc(h.partName || '—')} &nbsp;·&nbsp; <b>Part No.:</b> ${esc(h.partNo || h.matNo)}
        &nbsp;·&nbsp; <b>Model:</b> ${esc(h.model || '—')} &nbsp;·&nbsp; <b>Customer:</b> ${esc(h.customer || '—')}
        &nbsp;·&nbsp; <b>${esc(STATE_LABEL[map.state] || 'Current state')}</b>
      </div>
    </div>
    <div class="meta">
      <div><span class="k">ผู้จัดทำ</span><span>${esc(map.issued_by || '—')}</span></div>
      <div><span class="k">ช่วงข้อมูล</span><span>${esc(map.period_from || '')} – ${esc(map.period_to || '')}</span></div>
      <div><span class="k">วันที่</span><span>${esc(map.effective_date || new Date().toLocaleDateString('th-TH'))}</span></div>
      <div><span class="k">เอกสาร</span><span>${esc(code || '—')}</span></div>
    </div>
    <div class="sig">
      ${sigs.map(s => `<div class="b"><div class="lb">${esc(s.label)}</div><div class="sp"></div><div class="nm">${esc(s.val || s.name || '')}</div></div>`).join('')}
    </div>
  </div>

  <div class="cols">
    <div class="col l">
      ${panel('1', 'ความเป็นมา / เหตุผลที่ต้องทำ (Background)', a3.background ? nl2br(a3.background) : '')}
      ${panel('2', 'สภาพปัจจุบัน (Current Condition)', `
        <div class="kpi">
          <div><div class="v">${fmt(T.pltDays, 2)}</div><div class="l">PLT (วัน)</div></div>
          <div><div class="v">${fmt(T.ptSec)}</div><div class="l">PT (วินาที)</div></div>
          <div><div class="v">${T.vaPct == null ? '—' : fmt(T.vaPct, 2) + '%'}</div><div class="l">%VA</div></div>
          <div><div class="v">${I.ttSec == null ? '—' : fmt(I.ttSec, 1)}</div><div class="l">Takt (วินาที)</div></div>
          <div><div class="v">${fmt(I.orderDay)}</div><div class="l">ความต้องการ/วัน</div></div>
        </div>
        <ul class="f">${facts.map(x => `<li>${x}</li>`).join('')}</ul>
        <div class="map">${svgHtml}</div>`, { grow: true })}
    </div>

    <div class="col r">
      ${panel('3', 'เป้าหมาย (Target)', a3.target ? nl2br(a3.target) : '')}
      ${panel('4', 'วิเคราะห์สาเหตุราก (Root Cause Analysis)', a3.rootCause ? nl2br(a3.rootCause) : '')}
      ${panel('5', 'มาตรการแก้ไข (Countermeasures)', a3.countermeasures ? nl2br(a3.countermeasures) : '', { grow: true })}
      ${panel('6', 'แผนดำเนินการ (Implementation Plan)', planRows
        ? `<table class="pl"><thead><tr><th>สิ่งที่ต้องทำ</th><th>ผู้รับผิดชอบ</th><th>กำหนดเสร็จ</th><th>สถานะ</th></tr></thead><tbody>${planRows}</tbody></table>`
        : '', { pad0: !!planRows })}
      ${panel('7', 'ติดตามผล (Follow-up / Results)', a3.followup ? nl2br(a3.followup) : '')}
    </div>
  </div>

  <div class="lg"><div class="t">สัญลักษณ์ในแผนผัง (VSM Symbols)</div>${legendHtml || ''}</div>
  <div class="ft">
    <span>%VA = VA ÷ (VA + NVA) × 100 · NVA = PLT × A/T · ตัวเลขมาจากข้อมูลจริงในระบบ ESM</span>
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
  if (!w) return false;
  w.document.write(withDocFoot(html, 'vsm', section ? { section } : {}));
  w.document.close();
  return true;
}
