"""Builds the single-file prototype: inlines the logo and the dark-mode colour tokens into the source page.
Usage: python3 scripts/build.py .   (run from the prototype folder)"""
import base64, sys
sp = sys.argv[1]
src = open(f"{sp}/src/outreach-management.src.html", encoding="utf-8").read()
dove = base64.b64encode(open(f"{sp}/assets/dove-white.png", "rb").read()).decode()
dark = """    --bg:#161118; --surface:#1E1721; --surface-2:#271E2B;
    --line:#372C3C; --line-strong:#4F4155;
    --fg:#F4EEF3; --fg-2:#C9BCCB; --fg-3:#A599A9;
    --brand-hover:#9A3475;
    --brand-text:#EBADD2; --brand-soft:#3A1F33; --brand-soft-fg:#F2C8DF;
    --danger:#C73A34;
    --good-bg:#173121; --good-fg:#8BDBA6;
    --warn-bg:#3A2C0D; --warn-fg:#F3C873;
    --bad-bg:#3C1A1A; --bad-fg:#F5A3A3;
    --neutral-bg:#30273A; --neutral-fg:#C9BCCB;
    --focus:#F2C8DF; --scrim:rgba(0,0,0,.65);
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 6px 20px rgba(0,0,0,.35);
    --viz-1:#B9589A; --viz-2:#C98500; --viz-gray:#8A7F90;
    --st1:#8E3F73; --st2:#A5518A; --st3:#BD6BA3; --st4:#D38ABA; --st5:#E6AAD0; --st6:#F4CCE5; --st-closed:#7E7485;
    --viz-grid:#2D2332; --viz-base:#4F4155; --viz-tick:#A599A9;"""
assert src.count("/*__DARK_TOKENS__*/") == 2 and src.count("__DOVE_PNG_BASE64__") == 1
out = src.replace("__DOVE_PNG_BASE64__", dove).replace("/*__DARK_TOKENS__*/", dark)
open(f"{sp}/app/outreach-management.html", "w", encoding="utf-8").write(out)
print("built", len(out), "bytes")
