import re, sys
html = open(sys.argv[1], encoding="utf-8").read()
def block(text):
    return dict(re.findall(r'(--[a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6})\b', text))
light_src = re.search(r':root\{(.*?)\n\}', html, re.S).group(1)
light = block(light_src)
dm = re.search(r'@media \(prefers-color-scheme: dark\)\{\s*:root:not\(\[data-theme="light"\]\)\{(.*?)\}\s*\}', html, re.S).group(1)
dark = {**light, **block(dm)}
def lum(h):
    h=h.lstrip('#'); r,g,b=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    f=lambda c: c/12.92 if c<=0.03928 else ((c+0.055)/1.055)**2.4
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)
def cr(a,b):
    la,lb=sorted((lum(a),lum(b)),reverse=True); return (la+0.05)/(lb+0.05)
pairs = [("--fg","--bg",4.5),("--fg","--surface",4.5),("--fg-2","--bg",4.5),("--fg-2","--surface-2",4.5),("--fg-3","--bg",4.5),("--fg-3","--surface-2",4.5),
 ("--brand-text","--bg",4.5),("--brand-text","--brand-soft",4.5),("--on-brand","--brand",4.5),("--on-brand","--brand-hover",4.5),("--brand-soft-fg","--brand-soft",4.5),
 ("--on-danger","--danger",4.5),("--good-fg","--good-bg",4.5),("--warn-fg","--warn-bg",4.5),("--bad-fg","--bad-bg",4.5),("--neutral-fg","--neutral-bg",4.5),
 ("--bad-fg","--surface",4.5),("--good-fg","--surface",4.5),("--fg-2","--brand-soft",4.5),("--side-fg","--side-bg",4.5),("--focus","--bg",3.0),("--accent","--side-bg",3.0),("--on-accent","--accent",4.5),("--fg-3","--surface",3.0),("--good-fg","--surface",3.0),
 ("--viz-1","--surface",3.0),("--viz-2","--surface",3.0),("--viz-gray","--surface",3.0),("--st-closed","--surface",3.0),("--st1","--surface",2.0),("--st6","--surface",2.0),("--viz-tick","--surface",4.5),("--viz-base","--surface",1.2),("--brand-text","--surface",4.5)]
fails = 0
for name, th in (("light", light), ("dark", dark)):
    for a,b,minr in pairs:
        if a not in th or b not in th: continue
        r = cr(th[a], th[b]); ok = r >= minr
        if not ok: fails += 1
        if not ok or "--accent" in a: print(f"{name:5} {a:16} on {b:14} {r:5.2f}  {'ok' if ok else 'FAIL (need '+str(minr)+')'}")
print("contrast failures:", fails)
