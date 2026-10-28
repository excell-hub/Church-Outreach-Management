import sys, json
from playwright.sync_api import sync_playwright
html, outdir, PW = sys.argv[1], sys.argv[2], sys.argv[3]
errors = []
STUB = """
window.__saved = [];
window.claude = { use: async (n) => n === 'downloads' ? { save: async (o) => { window.__saved.push(o); return { status: 'saved' }; } } : null };
"""
def login(page, email):
    page.fill('#login-email', email); page.fill('#login-password', PW)
    page.click('form[data-form="login"] button[type="submit"]')
    page.wait_for_selector('#page-title')
def overflow(page):
    return page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
def new_page(b, vp, scheme, name, stub=True):
    ctx = b.new_context(viewport=vp, color_scheme=scheme)
    if stub: ctx.add_init_script(STUB)
    page = ctx.new_page()
    page.on('console', lambda m: errors.append((name, m.type, m.text)) if m.type in ('error', 'warning') and 'fonts.g' not in m.text and 'ERR_' not in m.text else None)
    page.on('pageerror', lambda e: errors.append((name, 'pageerror', str(e))))
    page.goto('file://' + html)
    page.wait_for_selector('#login-email')
    return ctx, page
with sync_playwright() as p:
    b = p.chromium.launch()
    # ---- desktop light: pastor
    ctx, page = new_page(b, {'width': 1280, 'height': 900}, 'light', 'desk')
    login(page, 'apollos@example.org')
    page.wait_for_selector('.viz-svg')
    page.wait_for_timeout(300)
    print('desk dashboard overflow', overflow(page))
    page.screenshot(path=f'{outdir}/s4-desk-dash.png', full_page=True)
    info = page.evaluate("""(() => { const svg = document.querySelector('.viz-svg'); const box = svg.parentElement; return { svgW: svg.getAttribute('width'), boxW: box.clientWidth, hits: svg.querySelectorAll('.viz-hit').length, bars: svg.querySelectorAll('.viz-bar').length, maxBarW: Math.max(...[...svg.querySelectorAll('.viz-bar')].map(r => r.getBBox().width)) }; })()""")
    print('chart', info)
    # hover a column -> tooltip
    hit = page.locator('.viz-hit').nth(5)
    hit.scroll_into_view_if_needed(); page.wait_for_timeout(300)
    hit.hover()
    page.wait_for_timeout(200)
    tip = page.evaluate("(() => { const t = document.querySelector('.viz-tip'); return t && !t.hidden ? t.innerText : null; })()")
    print('tooltip on hover:', repr(tip))
    page.screenshot(path=f'{outdir}/s4-desk-tip.png', clip={'x': 240, 'y': 380, 'width': 1000, 'height': 420})
    page.mouse.move(5, 5)
    page.wait_for_timeout(100)
    print('tooltip hidden after leave:', page.evaluate("document.querySelector('.viz-tip').hidden"))
    # keyboard: focus first hit, arrow right
    page.locator('.viz-hit').nth(0).focus()
    page.keyboard.press('ArrowRight'); page.keyboard.press('ArrowRight')
    foc = page.evaluate("(() => { const a = document.activeElement; return { cls: a.getAttribute('class'), idx: [...a.parentNode.children].indexOf(a), tab: a.getAttribute('tabindex'), tabs0: document.querySelectorAll('.viz-hits [tabindex=\"0\"]').length }; })()")
    print('keyboard focus', foc)
    kt = page.evaluate("(() => { const t = document.querySelector('.viz-tip'); return t && !t.hidden ? t.innerText : null; })()")
    print('tooltip on focus:', repr(kt))
    # filters: 30 days, then team, then location; the title must keep focus-friendly updates
    page.select_option('#rep-preset', '30d')
    page.wait_for_timeout(200)
    print('preset focus kept:', page.evaluate("document.activeElement && document.activeElement.id"))
    line = page.inner_text('.rep-line'); print('line:', line)
    page.select_option('#rep-team', 'd_a'); page.wait_for_timeout(150)
    page.select_option('#rep-area', 'a_centre'); page.wait_for_timeout(150)
    print('note:', page.inner_text('.scope-note') if page.locator('.rep-bar .scope-note').count() else None)
    page.screenshot(path=f'{outdir}/s4-desk-filtered.png', full_page=True)
    # custom range with a bad value
    page.select_option('#rep-preset', 'custom'); page.wait_for_timeout(150)
    page.fill('#rep-from', '2026-10-20'); page.fill('#rep-to', '2026-10-10')
    page.dispatch_event('#rep-to', 'change'); page.wait_for_timeout(150)
    print('bad range message:', page.inner_text('.rep-bar [role=alert]') if page.locator('.rep-bar [role=alert]').count() else None)
    page.click('[data-action="rep-reset"]'); page.wait_for_timeout(150)
    print('after reset preset:', page.input_value('#rep-preset'), 'team', page.locator('#rep-team').input_value())
    # reports page and tabs
    page.click('.nav-item[data-page="reports"]'); page.wait_for_selector('.seg-wrap')
    page.wait_for_timeout(300)
    print('reports export buttons (capability present):', page.locator('[data-action="export-csv"]').count())
    page.screenshot(path=f'{outdir}/s4-desk-reports-activity.png', full_page=True)
    for tab in ['followup', 'progress', 'definitions']:
        page.click(f'[data-action="rep-tab"][data-tab="{tab}"]'); page.wait_for_timeout(250)
        print(tab, 'overflow', overflow(page), 'focus kept on tab:', page.evaluate("document.activeElement && document.activeElement.dataset.tab"))
        page.screenshot(path=f'{outdir}/s4-desk-reports-{tab}.png', full_page=True)
    page.click('[data-action="rep-tab"][data-tab="activity"]'); page.wait_for_timeout(200)
    # export a CSV through the stubbed capability
    page.locator('[data-action="export-csv"][data-table="summary"]').first.click(); page.wait_for_timeout(300)
    saved = page.evaluate("window.__saved")
    print('saved files:', [(s['filename'], len(s['data'])) for s in saved])
    if saved: print(saved[0]['data'][:300].replace('\r\n', ' | '))
    page.locator('[data-action="export-csv"][data-table="activity"]').first.click(); page.wait_for_timeout(300)
    print('saved after second export:', [s['filename'] for s in page.evaluate("window.__saved")])
    # table twin opens
    page.locator('.viz-table summary').first.click(); page.wait_for_timeout(100)
    print('table twin visible:', page.evaluate("!!document.querySelector('.viz-table[open] table')"))
    # a resize redraws the chart to the new width
    w1 = page.evaluate("document.querySelector('.viz-svg').getAttribute('width')")
    page.set_viewport_size({'width': 700, 'height': 900}); page.wait_for_timeout(500)
    w2 = page.evaluate("document.querySelector('.viz-svg').getAttribute('width')")
    print('chart width after resize', w1, '->', w2, 'overflow', overflow(page))
    ctx.close()
    # ---- desktop dark: pastor
    ctx, page = new_page(b, {'width': 1280, 'height': 900}, 'dark', 'desk-dark')
    login(page, 'apollos@example.org'); page.wait_for_selector('.viz-svg'); page.wait_for_timeout(300)
    page.screenshot(path=f'{outdir}/s4-dark-dash.png', full_page=True)
    col = page.evaluate("getComputedStyle(document.querySelector('.viz-bar')).fill + ' / hb ' + getComputedStyle(document.querySelector('.hb-fill')).backgroundColor")
    print('dark bar colours:', col)
    page.click('.nav-item[data-page="reports"]'); page.wait_for_selector('.seg-wrap'); page.wait_for_timeout(300)
    page.screenshot(path=f'{outdir}/s4-dark-reports.png', full_page=True)
    ctx.close()
    # ---- mobile light: team leader
    ctx, page = new_page(b, {'width': 390, 'height': 844}, 'light', 'mob')
    login(page, 'john@example.org'); page.wait_for_selector('.viz-svg'); page.wait_for_timeout(400)
    print('mobile dashboard overflow', overflow(page), 'chart w', page.evaluate("document.querySelector('.viz-svg').getAttribute('width')"), 'box', page.evaluate("document.querySelector('.viz-cols').clientWidth"))
    page.screenshot(path=f'{outdir}/s4-mob-dash.png', full_page=True)
    # pipeline hand-off
    page.locator('[data-action="pipe-from-report"]').first.click(); page.wait_for_selector('#pipeline-table', timeout=3000)
    print('pipeline opened with filter:', page.evaluate("JSON.stringify(ui.pipeFilter)"))
    page.screenshot(path=f'{outdir}/s4-mob-pipeline-from-report.png')
    page.evaluate("go('reports')"); page.wait_for_selector('.seg-wrap'); page.wait_for_timeout(300)
    print('mobile reports overflow', overflow(page))
    page.screenshot(path=f'{outdir}/s4-mob-reports.png', full_page=True)
    page.click('[data-action="rep-tab"][data-tab="definitions"]'); page.wait_for_timeout(200)
    print('mobile definitions overflow', overflow(page))
    ctx.close()
    # ---- no capability: export must not appear
    ctx, page = new_page(b, {'width': 1280, 'height': 900}, 'light', 'nocap', stub=False)
    login(page, 'apollos@example.org'); page.click('.nav-item[data-page="reports"]'); page.wait_for_selector('.seg-wrap'); page.wait_for_timeout(300)
    print('export buttons without the capability:', page.locator('[data-action="export-csv"]').count())
    ctx.close()
    b.close()
print('errors:', json.dumps(errors, indent=1))
