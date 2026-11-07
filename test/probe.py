import sys, json
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:8765/test/out/test.html?debug'
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
setup = sys.argv[1]          # JS run first (e.g. start a level)
probe = open(sys.argv[2]).read()
wait = int(sys.argv[3]) if len(sys.argv) > 3 else 2500
shot = sys.argv[4] if len(sys.argv) > 4 else None
vw = sys.argv[5] if len(sys.argv) > 5 else '1280x800'
w, h = map(int, vw.split('x'))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=ARGS)
    mobile = w < 700
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile)
    page = ctx.new_page()
    logs = []
    page.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') and 'GPU stall' not in m.text else None)
    page.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
    page.goto(URL)
    page.wait_for_timeout(3000)
    if setup:
        page.evaluate(setup)
    page.wait_for_timeout(wait)
    res = page.evaluate(probe)
    print(json.dumps(res, indent=1))
    if shot:
        page.wait_for_timeout(500)
        page.screenshot(path=shot)
    print('\n'.join(l for l in logs if '404' not in l)[-3000:])
    b.close()
