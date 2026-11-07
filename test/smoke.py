import sys, json, time
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:8765/test/out/test.html?debug'
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
scen = sys.argv[1] if len(sys.argv) > 1 else 'desktop'

AUTOPLAY = """
async (maxSteps) => {
  const m = window.__mm; const S = m.S;
  for (let i = 0; i < maxSteps; i++) {
    if (S.status === 'won' || S.status === 'lost') break;
    const f = S.field;
    let c = -1;
    if (!f.placed) { c = Math.floor(f.n / 2); }
    else {
      // flag known mines occasionally to exercise flags (use real mine info)
      c = m.findLogicalSafe(f.nb, f.counts, f.mineCount, f.revealed);
      if (c < 0) { for (let x = 0; x < f.n; x++) if (!f.revealed[x] && !f.mines[x]) { c = x; break; } }
    }
    m.primary(c);
    await new Promise(r => setTimeout(r, 30));
  }
  return { status: S.status, revealed: S.field.revealedCount, n: S.field.n };
}
"""

def run():
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=ARGS)
        if scen.startswith('mobile'):
            ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        elif scen.startswith('tablet'):
            ctx = b.new_context(viewport={'width': 1024, 'height': 768}, device_scale_factor=1, is_mobile=True, has_touch=True)
        else:
            ctx = b.new_context(viewport={'width': 1280, 'height': 800})
        page = ctx.new_page()
        logs = []
        page.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
        page.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        page.goto(URL)
        page.wait_for_timeout(3500)
        tag = scen
        page.screenshot(path=f'shots/{tag}_1_title.png')
        steps = sys.argv[2].split(',') if len(sys.argv) > 2 else ['level0']
        k = 2
        for st in steps:
            if st.startswith('level'):
                i = int(st[5:])
                page.evaluate(f'window.__mm.startLevel(window.__mm.campaignLevel({i}))')
                page.wait_for_timeout(2600)
            elif st.startswith('classic'):
                i = int(st[7:])
                page.evaluate(f'window.__mm.startLevel(window.__mm.classicLevel({i}))')
                page.wait_for_timeout(2600)
            elif st.startswith('custom'):
                a = st[6:].split(':')
                page.evaluate(f'window.__mm.startLevel(window.__mm.customLevel("{a[0]}", {a[1]}, {a[2]}))')
                page.wait_for_timeout(2600)
            elif st == 'daily':
                page.evaluate('window.__mm.startLevel(window.__mm.dailyLevel())')
                page.wait_for_timeout(2600)
            elif st == 'map':
                page.evaluate('window.__mm.showMap()')
                page.wait_for_timeout(2000)
            elif st == 'click':
                vp = page.viewport_size
                if scen.startswith('mobile') or scen.startswith('tablet'):
                    page.touchscreen.tap(vp['width'] / 2, vp['height'] / 2)
                else:
                    page.mouse.click(vp['width'] / 2, vp['height'] / 2)
                page.wait_for_timeout(1200)
            elif st == 'rclick':
                vp = page.viewport_size
                page.mouse.click(vp['width'] / 2 + 40, vp['height'] / 2 - 30, button='right')
                page.wait_for_timeout(600)
            elif st == 'drag':
                vp = page.viewport_size
                page.mouse.move(vp['width'] / 2, vp['height'] / 2)
                page.mouse.down()
                for j in range(12):
                    page.mouse.move(vp['width'] / 2 + j * 12, vp['height'] / 2 + j * 4)
                    page.wait_for_timeout(16)
                page.mouse.up()
                page.wait_for_timeout(900)
            elif st == 'autoplay':
                r = page.evaluate(AUTOPLAY, 4000)
                logs.append('autoplay: ' + json.dumps(r))
                page.wait_for_timeout(2600)
            elif st == 'lose':
                r = page.evaluate("""() => { const S = window.__mm.S; const f = S.field;
                  if (!f.placed) window.__mm.primary(0);
                  for (let x = 0; x < f.n; x++) if (f.mines[x] && !f.flags[x]) { window.__mm.primary(x); return x; } return -1; }""")
                logs.append(f'lose at {r}')
                page.wait_for_timeout(1300)
            elif st == 'undo':
                page.click('#lUndo')
                page.wait_for_timeout(900)
            elif st == 'hint':
                page.click('#btnHint')
                page.wait_for_timeout(1600)
            elif st == 'flagmode':
                page.click('#btnMode')
                page.wait_for_timeout(300)
            elif st == 'zoomin':
                page.click('#btnZoomIn')
                page.wait_for_timeout(700)
            elif st == 'pause':
                page.click('#btnMenu')
                page.wait_for_timeout(500)
            elif st == 'dismiss':
                page.click('#panel .btn.primary')
                page.wait_for_timeout(900)
            elif st.startswith('tap:'):
                xy = st[4:].split('x')
                page.touchscreen.tap(float(xy[0]), float(xy[1]))
                page.wait_for_timeout(900)
            elif st.startswith('mclick:'):
                xy = st[7:].split('x')
                page.mouse.click(float(xy[0]), float(xy[1]))
                page.wait_for_timeout(900)
            elif st.startswith('hold:'):
                xy = st[5:].split('x')
                page.evaluate('''([x, y]) => { const c = document.getElementById('gl');
                  const o = { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true };
                  c.dispatchEvent(new PointerEvent('pointerdown', o));
                  setTimeout(() => c.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 })), 650); }''', [float(xy[0]), float(xy[1])])
                page.wait_for_timeout(1200)
            elif st.startswith('click#'):
                page.click('#' + st[6:])
                page.wait_for_timeout(700)
            elif st == 'esc':
                page.keyboard.press('Escape')
                page.wait_for_timeout(400)
            elif st.startswith('wait'):
                page.wait_for_timeout(int(st[4:]))
            elif st.startswith('evalfile:'):
                logs.append('evalfile: ' + json.dumps(page.evaluate(open(st[9:]).read())))
                page.wait_for_timeout(900)
            elif st.startswith('eval:'):
                logs.append('eval: ' + json.dumps(page.evaluate(st[5:])))
            elif st == 'shot':
                pass
            page.screenshot(path=f'shots/{tag}_{k}_{st.replace(":", "_")[:20]}.png')
            k += 1
        print('\n'.join(logs[-40:]))
        b.close()

run()
