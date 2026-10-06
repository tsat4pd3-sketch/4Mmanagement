# -*- coding: utf-8 -*-
"""Thai Summit Group presentation theme helper (Cowork).
Encodes the official TSG template: colors, Tahoma fonts, fixed positions,
footer logo + page number, title/agenda/section/content/scorecard builders.
Slide size 13.333 x 7.5 in. See SKILL.md for the full spec."""
import os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn

ASSET = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tsg_assets")

# ---- Palette (exact from template) ----
GREEN_D = RGBColor(0x0D,0x3D,0x14)   # titles, headers, table header, footer wordmark
GREEN_M = RGBColor(0x2C,0x5F,0x2D)   # subtitles, table body text
GREEN_TINT = RGBColor(0xEC,0xF1,0xE9)# alternating table row
ORANGE = RGBColor(0xC0,0x56,0x1E)    # stats, status alerts, chart line, number badges
ORANGE_LT = RGBColor(0xFD,0x83,0x42) # logo orange / light accent
GOLD = RGBColor(0xEB,0xD9,0xB0)      # title-slide subtitle & quality line
PRES_GREEN = RGBColor(0xCF,0xE0,0xC8)# title-slide org line
GREY = RGBColor(0x55,0x55,0x55)      # captions, page number
AMBER = RGBColor(0xC8,0x8A,0x00)     # "other" status (watch)
WHITE = RGBColor(0xFF,0xFF,0xFF)
FONT = "Tahoma"
SW, SH = 13.333, 7.5

def new_pres():
    p = Presentation(); p.slide_width=Inches(SW); p.slide_height=Inches(SH); return p
def blank(p): return p.slides.add_slide(p.slide_layouts[6])

def _set_bg(s, rgb):
    el=s.background.element
    # simple: add a full-slide rect
def rect(s,x,y,w,h,fill=None,line=None,lw=0.75,shape=MSO_SHAPE.RECTANGLE,radius=None,shadow=False):
    sp=s.shapes.add_shape(shape,Inches(x),Inches(y),Inches(w),Inches(h))
    if fill is None: sp.fill.background()
    else: sp.fill.solid(); sp.fill.fore_color.rgb=fill
    if line is None: sp.line.fill.background()
    else: sp.line.color.rgb=line; sp.line.width=Pt(lw)
    sp.shadow.inherit=False
    if shadow:
        spPr=sp._element.spPr
        ef=spPr.makeelement(qn('a:effectLst'),{}); spPr.append(ef)
        sh=ef.makeelement(qn('a:outerShdw'),{'blurRad':'50000','dist':'20000','dir':'5400000','rotWithShape':'0'}); ef.append(sh)
        c=sh.makeelement(qn('a:srgbClr'),{'val':'8A99AD'}); sh.append(c)
        a=c.makeelement(qn('a:alpha'),{'val':'38000'}); c.append(a)
    return sp

def text(s,x,y,w,h,runs,align=PP_ALIGN.LEFT,anchor=MSO_ANCHOR.TOP,wrap=True,sa=2,line_spacing=None):
    tb=s.shapes.add_textbox(Inches(x),Inches(y),Inches(w),Inches(h)); tf=tb.text_frame
    tf.word_wrap=wrap; tf.vertical_anchor=anchor
    tf.margin_left=Inches(0.03);tf.margin_right=Inches(0.03);tf.margin_top=Inches(0.01);tf.margin_bottom=Inches(0.01)
    if isinstance(runs,str): runs=[[(runs,{})]]
    if isinstance(runs[0],tuple): runs=[runs]
    first=True
    for para in runs:
        p=tf.paragraphs[0] if first else tf.add_paragraph(); first=False
        p.alignment=align; p.space_after=Pt(sa); p.space_before=Pt(0)
        if line_spacing: p.line_spacing=line_spacing
        if isinstance(para,tuple): para=[para]
        for t,o in para:
            r=p.add_run(); r.text=t
            r.font.size=Pt(o.get("sz",14)); r.font.bold=o.get("b",False); r.font.italic=o.get("i",False)
            r.font.name=o.get("f",FONT); r.font.color.rgb=o.get("c",GREEN_M)
    return tb

def footer(s,page):
    s.shapes.add_picture(os.path.join(ASSET,"logo_footer.png"),Inches(0.42),Inches(6.92),Inches(0.4),Inches(0.42))
    text(s,0.86,6.92,4.5,0.45,[[("THAI SUMMIT GROUP",{"sz":13,"b":True,"c":GREEN_D})]],anchor=MSO_ANCHOR.MIDDLE)
    text(s,12.5,6.95,0.65,0.4,[[(str(page),{"sz":12,"c":GREY})]],align=PP_ALIGN.RIGHT,anchor=MSO_ANCHOR.MIDDLE)

def head(s,title,subtitle=None):
    text(s,0.5,0.28,11.9,0.95,[[(title,{"sz":34,"b":True,"c":GREEN_D})]],anchor=MSO_ANCHOR.MIDDLE)
    if subtitle:
        text(s,0.55,1.12,11.9,0.5,[[(subtitle,{"sz":19,"b":True,"c":GREEN_M})]])

def headline_box(s,x,y,w,label,h=0.44):
    rect(s,x,y,w,h,fill=GREEN_D)
    text(s,x,y-0.02,w,h,[[(label,{"sz":15,"b":True,"c":WHITE})]],align=PP_ALIGN.CENTER,anchor=MSO_ANCHOR.MIDDLE)

def title_slide(p,title,subtitle,presenter,org,quality=None):
    s=blank(p)
    s.shapes.add_picture(os.path.join(ASSET,"bg_title.png"),0,0,Inches(SW),Inches(SH))
    s.shapes.add_picture(os.path.join(ASSET,"logo_big.png"),Inches(6.0),Inches(0.55),Inches(1.62),Inches(1.7))
    text(s,1.0,2.75,11.3,1.1,[[(title,{"sz":44,"b":True,"c":WHITE})]])
    text(s,1.0,3.9,11.3,0.7,[[(subtitle,{"sz":24,"b":True,"c":GOLD})]])
    text(s,1.0,4.95,11.3,0.5,[[(presenter,{"sz":16,"c":WHITE})]])
    text(s,1.0,5.35,11.3,0.5,[[(org,{"sz":14,"c":PRES_GREEN})]])
    if quality:
        text(s,1.0,6.05,11.3,0.6,[[(quality,{"sz":15,"b":True,"i":True,"c":GOLD})]])
    return s

def section_divider(p,bg,title_lines):
    s=blank(p)
    s.shapes.add_picture(os.path.join(ASSET,bg),0,0,Inches(SW),Inches(SH))
    runs=[[(t,{"sz":30,"c":WHITE})] for t in title_lines]
    text(s,8.15,2.9,4.6,1.6,runs,anchor=MSO_ANCHOR.MIDDLE,sa=4)
    return s
