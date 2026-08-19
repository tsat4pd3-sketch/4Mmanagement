#!/usr/bin/env python3
"""ESM one-page infographic (A4 landscape) — Thai Summit Group theme.

กติกาธีม TSG (docs: tsg-presentation-theme SKILL.md)
  · Tahoma ทุกจุด · ภาษาอังกฤษ (เอกสารบริษัท/ลูกค้า) · 3 สีหลัก เขียว/ส้ม/กลาง
  · โลโก้ ST + THAI SUMMIT GROUP ที่ footer
  · เน้น infographic — ตัวหนังสือไม่เกิน ~40% ของพื้นที่
ทุกตัวเลขบนหน้านี้ดึงจากฐานข้อมูลจริง (ดู STATS) — อัปเดตเลขแล้วรันสคริปต์ใหม่
"""
import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from importlib.machinery import SourceFileLoader
IMG = SourceFileLoader("_a", str(pathlib.Path(__file__).parent / ".infographic_assets.py")).load_module().IMG

OUT = pathlib.Path("/home/user/4Mmanagement/docs/ESM_Overview_Infographic_A4.html")

# ── ตัวเลขจริง ณ 2026-08-19 (นับจาก DB ทั้ง 2 project) ────────────────────
STATS = dict(
    live_since="18 Jun 2026", days="2 months live",
    shifts="822", orders="8,337", downtime="4,740", four_m="1,086",
    checkins="8,885", employees="202", lines="27", equipment="518",
    products="109", oee="79.3", skills="2,250", lpa="190",
    fmea="898", cp="680", forms="35", pages="57", roles="11",
)

# ── วงจรการทำงานประจำวัน (แกนกลางของหน้า) ────────────────────────────────
LOOP = [
    ("01", "SHIFT START",   "attendance · PPE\nskill-fit manning"),
    ("02", "MORNING BRIEF", "auto summary\nopen actions"),
    ("03", "PRODUCE",       "kanban scan\nlive OEE"),
    ("04", "DETECT",        "downtime · defect\nandon · escalate"),
    ("05", "VERIFY",        "AM · poka-yoke\nLPA · inspection"),
    ("06", "CLOSE SHIFT",   "supervisor approval\nOEE stamped"),
    ("07", "ANALYSE",       "OEE·OOE·TEEP\n6 losses · 8 wastes"),
    ("08", "IMPROVE",       "kaizen before/after\ncost saving · PFMEA"),
]

MODULES = [
    ("Overview",     "&#128202;", ["Live plant map (colour by OEE / downtime / manpower)",
                                   "Department dashboards", "Executive & group roll-up"]),
    ("Production",   "&#127981;", ["Attendance &amp; PPE · line manning by skill-fit",
                                   "Daily report · shift close approval",
                                   "Production planning (OT / night / holiday)"]),
    ("Analytics",    "&#128200;", ["OEE / OOE / TEEP · true-OEE",
                                   "Root-cause engine (7 automatic findings)",
                                   "Order traceability · Value Stream Map"]),
    ("People",       "&#128101;", ["Skill matrix 0-100 · auto EXP", "OJT training records",
                                   "Shift roster A/B/C"]),
    ("Logistics",    "&#128230;", ["Store &amp; kanban pull · rundown stock",
                                   "Delivery walk-back schedule",
                                   "Shortage alert · route &amp; transport"]),
    ("Maintenance",  "&#128295;", ["Work order 7 steps · response / MTTR KPI",
                                   "AM / PM planning &amp; forecast",
                                   "Spare part rank A/B/C · QR scan"]),
    ("Quality",      "&#9989;",   ["Inspection check sheet", "SPC / Cp-Cpk · NCR · CAPA-8D",
                                   "Scrap report · CQI-15 log"]),
    ("Engineering",  "&#128208;", ["Process flow · PFMEA · Control Plan",
                                   "Excel import / export", "Revision history by root cause"]),
    ("Master data",  "&#9881;",   ["Parts · BOM · routing", "Equipment &amp; die registry",
                                   "Document control · role permission matrix"]),
]

TRACE = [
    ("Customer order",  "EDI 862 / 830"),
    ("Production order","kanban scan"),
    ("Machine &amp; die",   "PM status that day"),
    ("Operator",        "skill · PPE · station"),
    ("Material",        "lot withdrawal"),
    ("In-process",      "checks · defects"),
    ("Finished goods",  "stock ledger"),
    ("Shipment",        "delivery round"),
]

STANDARDS = [
    ("IATF 16949",  "Process approach, competence records, change control"),
    ("CQI-15",      "Welding event log with approval routing"),
    ("APQP / PPAP",  "PFMEA &amp; Control Plan linked by operation no."),
    ("8D",          "3-legged root cause from a real shift"),
    ("TPM",         "AM by operators · PM by technicians"),
    ("Lean",        "6 big losses · 8 wastes · VSM · kaizen"),
]

STRIP = [
    ("photo_press2500t", "2,500-ton press line", "stamping &middot; die shot counter feeds PM"),
    ("photo_robots",     "Robot welding cells",  "downtime by machine, straight from the floor"),
    ("photo_hotpress",   "Hot-press forming",    "cycle time drives the OEE performance rate"),
]

OUTCOMES = [
    ("Answer in seconds, not days",
     "&#8220;Which shift, which machine, who ran it, was PM overdue, what changed?&#8221; &mdash; one search on the order number."),
    ("Loss you can act on",
     "Every stop and defect is classified the moment it happens, then ranked by minutes and money."),
    ("Change control that holds",
     "Any Man / Machine / Material / Method change raises a 4M record needing supervisor + QA approval before it runs. 35 controlled forms print from the system."),
]


def loop_ring():
    """วงแหวน 8 ขั้น (SVG ล้วน พิมพ์คมทุก dpi)

    ⚠️ ป้ายกำกับวางนอกวง → viewBox ต้องกว้างกว่าเส้นผ่านศูนย์กลางมาก
       ไม่งั้นข้อความซ้าย-ขวาโดนตัด (เคยพลาดมาแล้ว)
    """
    import math
    W, H = 482.0, 372.0
    cx, cy = W / 2, H / 2
    r_out, r_in = 118.0, 76.0
    n = len(LOOP)
    seg = 360.0 / n
    gap = 2.6
    parts = []
    for i, (num, title, desc) in enumerate(LOOP):
        a0 = -90 + i * seg + gap / 2
        a1 = -90 + (i + 1) * seg - gap / 2
        rad = math.radians
        x0o, y0o = cx + r_out * math.cos(rad(a0)), cy + r_out * math.sin(rad(a0))
        x1o, y1o = cx + r_out * math.cos(rad(a1)), cy + r_out * math.sin(rad(a1))
        x1i, y1i = cx + r_in * math.cos(rad(a1)), cy + r_in * math.sin(rad(a1))
        x0i, y0i = cx + r_in * math.cos(rad(a0)), cy + r_in * math.sin(rad(a0))
        d = (f"M{x0o:.1f},{y0o:.1f} A{r_out},{r_out} 0 0 1 {x1o:.1f},{y1o:.1f} "
             f"L{x1i:.1f},{y1i:.1f} A{r_in},{r_in} 0 0 0 {x0i:.1f},{y0i:.1f} Z")
        # 07-08 = ผลลัพธ์ที่ย้อนกลับเข้าการผลิต ทำสีส้มให้เห็นว่าเป็นวงปิด
        fill = "#C0561E" if i >= 6 else ("#0D3D14" if i % 2 == 0 else "#2C5F2D")
        am = math.radians(-90 + (i + 0.5) * seg)
        tx, ty = cx + 97 * math.cos(am), cy + 97 * math.sin(am)
        parts.append(f'<path d="{d}" fill="{fill}"/>')
        parts.append(f'<text x="{tx:.1f}" y="{ty:.1f}" class="rn">{num}</text>')

        lx, ly = cx + 130 * math.cos(am), cy + 130 * math.sin(am)
        c = math.cos(am)
        anchor = "start" if c > 0.15 else ("end" if c < -0.15 else "middle")
        lx += 5 if anchor == "start" else (-5 if anchor == "end" else 0)
        lines = desc.split("\n")
        y0 = ly - (5 * len(lines)) + (2 if anchor == "middle" else 0)
        t = [f'<text x="{lx:.1f}" y="{y0:.1f}" text-anchor="{anchor}" class="rt">{title}</text>']
        for k, ln in enumerate(lines):
            t.append(f'<text x="{lx:.1f}" y="{y0 + 12 + k * 10.5:.1f}" '
                     f'text-anchor="{anchor}" class="rd">{ln}</text>')
        parts.append("".join(t))

    # ลูกศรบอกทิศทางวน (ตามเข็มนาฬิกา)
    arrow = (f'<path d="M{cx+r_in-9:.0f},{cy-3:.0f} l7,5 -7,5 z" fill="#C0561E" '
             f'transform="rotate(-38 {cx} {cy})"/>')

    return f'''<svg viewBox="0 0 {W:.0f} {H:.0f}" class="ring">
  <defs><style>
    .rn{{font:700 14px Tahoma,sans-serif;fill:#fff;text-anchor:middle;dominant-baseline:central}}
    .rt{{font:700 11.5px Tahoma,sans-serif;fill:#0D3D14}}
    .rd{{font:400 9.2px Tahoma,sans-serif;fill:#5a6b5d}}
    .cc{{font:700 30px Tahoma,sans-serif;fill:#0D3D14;text-anchor:middle}}
    .cs{{font:700 9.5px Tahoma,sans-serif;fill:#C0561E;text-anchor:middle;letter-spacing:2px}}
    .cm{{font:400 9px Tahoma,sans-serif;fill:#5a6b5d;text-anchor:middle}}
  </style></defs>
  {"".join(parts)}
  <circle cx="{cx}" cy="{cy}" r="{r_in-4}" fill="#fff" stroke="#D8E4D0" stroke-width="1.4"/>
  <text x="{cx}" y="{cy-22}" class="cs">ONE SYSTEM</text>
  <text x="{cx}" y="{cy+8}" class="cc">ESM</text>
  <text x="{cx}" y="{cy+27}" class="cm">every step feeds the next</text>
  <text x="{cx}" y="{cy+39}" class="cm">no re-typing, no side files</text>
  {arrow}
</svg>'''


def trace_spine():
    cells = []
    for i, (a, b) in enumerate(TRACE):
        cells.append(f'<div class="tc"><b>{a}</b><span>{b}</span></div>')
        if i < len(TRACE) - 1:
            cells.append('<div class="tarr">&#9656;</div>')
    return "".join(cells)


CSS = """
@page{size:297mm 210mm;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:297mm;height:210mm}
body{font-family:Tahoma,"Noto Sans Thai",sans-serif;color:#1b2a1e;background:#fff;
 -webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:297mm;height:210mm;display:flex;flex-direction:column;overflow:hidden;position:relative}

/* ── header ───────────────────────────────────────── */
.hd{height:21mm;background:linear-gradient(100deg,#0D3D14 0%,#164D1D 58%,#0D3D14 100%);
 color:#fff;display:flex;align-items:center;padding:0 7mm;gap:5mm;position:relative;flex:0 0 21mm}
.hd::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1.1mm;background:#C0561E}
.hd .lg{height:14mm}
.hd .ttl{font-size:19pt;font-weight:700;letter-spacing:.4px;line-height:1.1}
.hd .ttl span{color:#EBD9B0}
.hd .sub{font-size:8pt;color:#CFE0C8;margin-top:1.2mm;letter-spacing:.2px}
.hero{margin-left:auto;display:flex;gap:4.6mm;align-items:center}
.hero div{text-align:right}
.hero b{display:block;font-size:15pt;color:#FD8342;line-height:1}
.hero span{display:block;font-size:6.6pt;color:#CFE0C8;margin-top:.7mm;letter-spacing:.3px}

/* ── body grid ────────────────────────────────────── */
.bd{flex:0 0 153mm;display:grid;grid-template-columns:60mm 116mm 1fr;gap:4mm;padding:3.4mm 7mm 0;min-height:0;overflow:hidden}
.col{display:flex;flex-direction:column;gap:3mm;min-height:0}
h2{font-size:9.2pt;color:#0D3D14;letter-spacing:1.5px;border-bottom:1.4pt solid #C0561E;
 padding-bottom:1mm;margin-bottom:1.6mm;flex:0 0 auto}
h2 small{float:right;font-size:6.6pt;color:#C0561E;letter-spacing:.3px;font-weight:400;
 text-transform:none;padding-top:.7mm}

/* ── left ─────────────────────────────────────────── */
.what{font-size:7.3pt;line-height:1.45;color:#2f4033}
.what b{color:#0D3D14}
.photo{position:relative;border-radius:1.6mm;overflow:hidden;flex:0 0 auto}
.photo img{width:100%;height:21mm;object-fit:cover;display:block}
.photo .cap{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(transparent,rgba(13,61,20,.93));
 color:#fff;font-size:6.4pt;padding:4mm 2mm 1.4mm;letter-spacing:.3px}
.nums{display:grid;grid-template-columns:1fr 1fr;gap:1.4mm}
.nums div{background:#ECF1E9;border-left:1.1mm solid #2C5F2D;border-radius:0 1mm 1mm 0;padding:1.1mm 1.6mm}
.nums b{display:block;font-size:10.2pt;color:#0D3D14;line-height:1}
.nums span{display:block;font-size:6.2pt;color:#555;margin-top:.5mm}
.nums div.o{border-left-color:#C0561E}
.nums div.o b{color:#C0561E}
.stack{display:flex;flex-direction:column;gap:1.2mm}
.srow{display:flex;gap:1.6mm;align-items:baseline;font-size:6.7pt;color:#2f4033;
 border-bottom:.3pt dotted #cfd8cc;padding-bottom:.7mm}
.srow b{color:#0D3D14;flex:0 0 15mm;font-size:6.9pt}

/* ── center ───────────────────────────────────────── */
.ringwrap{flex:1;display:flex;align-items:center;justify-content:center;min-height:0;margin:-2mm -6mm 0}
.ring{width:100%;height:100%}
.trace{display:flex;align-items:stretch;gap:.7mm;margin-top:.6mm}
.tc{flex:1;background:#fff;border:.4pt solid #D8E4D0;border-top:1mm solid #2C5F2D;border-radius:.8mm;
 padding:1.3mm .8mm;text-align:center;display:flex;flex-direction:column;justify-content:center}
.tc b{display:block;font-size:6.1pt;color:#0D3D14;line-height:1.2}
.tc span{display:block;font-size:5.4pt;color:#777;margin-top:.5mm;line-height:1.15}
.tarr{align-self:center;color:#C0561E;font-size:7pt;line-height:1}
.tnote{margin-top:1.6mm;background:#0D3D14;color:#fff;border-radius:1mm;padding:1.7mm 2.4mm;
 font-size:6.8pt;line-height:1.45}
.tnote b{color:#FD8342}

/* ── right ────────────────────────────────────────── */
.mods{display:grid;grid-template-columns:1fr 1fr;gap:1.3mm}
.mod{border:.4pt solid #D8E4D0;border-radius:1mm;padding:1.1mm 1.4mm;background:#fff}
.mod h3{font-size:7pt;color:#0D3D14;display:flex;align-items:center;gap:1.2mm;margin-bottom:.9mm}
.mod h3 i{font-style:normal;font-size:7.4pt}
.mod ul{list-style:none}
.mod.wide{grid-column:1/-1}
.mod.wide ul{columns:2;column-gap:3mm}
.mod li{font-size:5.75pt;color:#4a5a4d;line-height:1.28;padding-left:1.9mm;position:relative;margin-bottom:.2mm}
.mod li::before{content:"";position:absolute;left:.5mm;top:1.35mm;width:.9mm;height:.9mm;
 border-radius:50%;background:#C0561E}
.two{display:grid;grid-template-columns:1fr 1fr;gap:3mm;flex:1;min-height:0}
.std div{display:flex;gap:1.4mm;font-size:6.1pt;line-height:1.25;margin-bottom:.85mm;align-items:baseline}
.std b{flex:0 0 15mm;color:#C0561E;font-size:6.4pt}
.std span{color:#4a5a4d}
.out div{margin-bottom:1.2mm}
.out b{display:block;font-size:6.7pt;color:#0D3D14;margin-bottom:.3mm}
.out span{display:block;font-size:5.85pt;color:#4a5a4d;line-height:1.3}

/* ── photo strip ──────────────────────────────────── */
.strip{flex:0 0 19mm;display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:15mm;
 gap:2mm;padding:2mm 7mm 2mm}
.sp{position:relative;border-radius:1.2mm;overflow:hidden;height:15mm}
.sp img{width:100%;height:100%;object-fit:cover;display:block}
.sp .ov{position:absolute;inset:0;background:linear-gradient(90deg,rgba(13,61,20,.88) 0%,rgba(13,61,20,.55) 46%,rgba(13,61,20,0) 74%);
 display:flex;flex-direction:column;justify-content:center;padding:0 2.6mm}
.sp b{font-size:7pt;color:#fff;line-height:1.15}
.sp span{font-size:5.8pt;color:#CFE0C8;margin-top:.5mm;line-height:1.25;max-width:44mm}

/* ── footer ───────────────────────────────────────── */
.ft{height:8.5mm;flex:0 0 8.5mm;display:flex;align-items:center;padding:0 7mm;gap:2mm;
 border-top:.5pt solid #D8E4D0}
.ft img{height:5mm}
.ft .wm{font-size:8pt;font-weight:700;color:#0D3D14;letter-spacing:.3px}
.ft .mid{margin-left:auto;font-size:6.2pt;color:#555;text-align:right;line-height:1.35}
.ft .mid b{color:#0D3D14}
"""


def build():
    S = STATS
    hero = [(S["oee"] + "%", "AVERAGE OEE"), (S["shifts"], "SHIFTS RECORDED"),
            (S["orders"], "PRODUCTION ORDERS"), (S["pages"], "SCREENS LIVE")]
    hero_html = "".join(f"<div><b>{v}</b><span>{k}</span></div>" for v, k in hero)

    nums = [(S["employees"], "operators tracked", 0), (S["lines"], "production lines", 0),
            (S["equipment"], "machines &amp; dies", 0), (S["products"], "part numbers", 0),
            (S["downtime"], "stop events logged", 1), (S["four_m"], "4M changes controlled", 1),
            (S["checkins"], "attendance + PPE records", 0),
            (S["fmea"], "PFMEA failure modes", 1)]
    nums_html = "".join(
        f'<div class="{"o" if o else ""}"><b>{v}</b><span>{k}</span></div>' for v, k, o in nums)

    mods_html = "".join(
        f'<div class="mod{" wide" if name == "Master data" else ""}">'
        f'<h3><i>{ic}</i>{name}</h3><ul>'
        + "".join(f"<li>{x}</li>" for x in items) + "</ul></div>"
        for name, ic, items in MODULES)

    std_html = "".join(f"<div><b>{a}</b><span>{b}</span></div>" for a, b in STANDARDS)
    out_html = "".join(f"<div><b>{a}</b><span>{b}</span></div>" for a, b in OUTCOMES)

    stack = [
        ("Platform", "React 19 &middot; PostgreSQL &middot; realtime sync"),
        ("Devices", "Shop-floor TV &middot; tablet &middot; phone (installable)"),
        ("Alerts", "In-app &middot; push &middot; Telegram by topic"),
        ("Control", f"{S['roles']} roles &middot; {S['forms']} forms &middot; full audit log"),
    ]
    stack_html = "".join(f'<div class="srow"><b>{a}</b><span>{b}</span></div>' for a, b in stack)

    strip_html = "".join(
        f'<div class="sp"><img src="data:image/jpeg;base64,{IMG[k]}" alt="">'
        f'<div class="ov"><b>{t}</b><span>{c}</span></div></div>'
        for k, t, c in STRIP)

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>ESM — Enterprise Shopfloor Management | Thai Summit Group</title>
<style>{CSS}</style></head>
<body><div class="page">

  <header class="hd">
    <img class="lg" src="data:image/png;base64,{IMG['logo_big']}" alt="">
    <div>
      <div class="ttl">ESM <span>&mdash;</span> Enterprise Shopfloor Management</div>
      <div class="sub">Thai Summit Automotive &middot; TSAT4 &nbsp;|&nbsp; One system from attendance to shipment &mdash;
        live since {S['live_since']}</div>
    </div>
    <div class="hero">{hero_html}</div>
  </header>

  <div class="bd">

    <!-- ── LEFT ─────────────────────────────────── -->
    <section class="col">
      <div>
        <h2>WHAT IT IS</h2>
        <p class="what">One shop-floor system in place of spreadsheets, paper forms and chat groups.
        Every shift is opened, run, checked and closed inside it &mdash; so <b>production, quality,
        maintenance and logistics read the same numbers at the same moment.</b></p>
      </div>

      <div class="photo">
        <img src="data:image/jpeg;base64,{IMG['photo_robots']}" alt="">
        <div class="cap">Body-in-white welding &mdash; every station mapped in the system</div>
      </div>

      <div>
        <h2>IN USE TODAY<small>{S['days']}</small></h2>
        <div class="nums">{nums_html}</div>
      </div>

      <div>
        <h2>BUILT ON</h2>
        <div class="stack">{stack_html}</div>
      </div>
    </section>

    <!-- ── CENTER ───────────────────────────────── -->
    <section class="col">
      <div style="display:flex;flex-direction:column;flex:1;min-height:0">
        <h2>THE DAILY OPERATING LOOP<small>one shift, eight steps</small></h2>
        <div class="ringwrap">{loop_ring()}</div>
      </div>

      <div>
        <h2>ONE ORDER, FULL TRACEABILITY</h2>
        <div class="trace">{trace_spine()}</div>
        <div class="tnote">A customer concern is answered by searching one order number:
          <b>which shift and line, which machine and die, whether PM was overdue, who was at the
          station and their skill level, what 4M changed that day</b> &mdash; then matched back to the
          failure mode already listed in the PFMEA.</div>
      </div>
    </section>

    <!-- ── RIGHT ────────────────────────────────── -->
    <section class="col">
      <div>
        <h2>MODULE MAP<small>{S['pages']} screens &middot; 9 areas</small></h2>
        <div class="mods">{mods_html}</div>
      </div>

      <div class="two">
        <div>
          <h2>ALIGNED TO</h2>
          <div class="std">{std_html}</div>
        </div>
        <div>
          <h2>WHAT IT CHANGES</h2>
          <div class="out">{out_html}</div>
        </div>
      </div>
    </section>
  </div>

  <div class="strip">{strip_html}</div>

  <footer class="ft">
    <img src="data:image/png;base64,{IMG['logo_footer']}" alt="">
    <span class="wm">THAI SUMMIT GROUP</span>
    <span class="mid"><b>Before we build parts, we build people.</b><br>
      ESM overview &middot; figures measured from the live system on 19 Aug 2026</span>
  </footer>

</div></body></html>
"""


OUT.write_text(build(), encoding="utf-8")
print(f"✓ {OUT}  ({OUT.stat().st_size/1024:.0f} KB)")
