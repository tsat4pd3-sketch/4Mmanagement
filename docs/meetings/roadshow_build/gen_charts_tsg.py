import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import re, json, os
D=json.load(open("kpi.json")); MONTHS=D["months"]
ORANGE="#C0561E"; ORANGE_D="#8A3B12"; GREEN="#0D3D14"; GREEN2="#2C5F2D"; TGT="#222222"; GRID="#DCE4D6"
def ytd_from(k):
    return k["ytd"]
os.makedirs("charts_tsg",exist_ok=True)
def chart(div,k):
    v=k["vals"]; t=k["target"]
    fig,ax=plt.subplots(figsize=(4.15,2.45),dpi=150)
    fig.patch.set_alpha(0)
    ax.plot(MONTHS,v,marker="o",linewidth=2.6,color=ORANGE,markersize=6.5,
            markerfacecolor=ORANGE,markeredgecolor="white",markeredgewidth=1.0,zorder=3)
    lo=min(min(v),t); hi=max(max(v),t); pad=(hi-lo)*0.16 or max(abs(hi)*0.1,1)
    ax.axhline(t,color=TGT,linestyle=(0,(5,3)),linewidth=1.5,zorder=2)
    ax.text(-0.35,t,f"Target {t:g}",fontsize=7.2,color=TGT,va="center",ha="right",fontweight="bold")
    for x,y in zip(MONTHS,v):
        ax.annotate(f"{y:g}",(x,y),textcoords="offset points",xytext=(0,8),ha="center",
                    fontsize=7.6,color=ORANGE_D,fontweight="bold")
    ax.set_ylim(lo-pad,hi+pad*1.7)
    ax.tick_params(labelsize=8.5,colors=GREEN2)
    for lb in ax.get_xticklabels(): lb.set_fontweight("bold")
    ax.grid(axis="y",linestyle=":",alpha=0.45,color=GRID)
    for s in ["top","right","left"]: ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.margins(x=0.08)
    fig.tight_layout(pad=0.4)
    fig.savefig(f"charts_tsg/{div}_{k['no'].replace('.','_')}.png",transparent=True)
    plt.close(fig)
for d in D["divisions"]:
    for k in d["kpis"]:
        chart(d["key"],k)
print("themed charts done")
