"""Regenerate the README screenshots and the link-preview image.

    npm run build:test
    python3 -m http.server 8765          # from the project folder
    python3 test/readme_shots.py         # PNGs in shots/, WebP/JPEG in docs/ and public/

Uses the ?debug hook (window.__mm) to start levels and play a few logical moves.
"""
import os
import sys
from playwright.sync_api import sync_playwright
from PIL import Image

URL = 'http://127.0.0.1:8765/test/out/test.html?debug'
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'shots')
DOCS = os.path.join(ROOT, 'docs')

# play logical moves, then flag some of the mines touching the open area
PLAY = """
async ({ steps, flagEvery }) => {
  const m = window.__mm, S = m.S, f = S.field;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < steps; i++) {
    if (S.status === 'won' || S.status === 'lost') break;
    const c = m.findLogicalSafe(f.nb, f.counts, f.mineCount, f.revealed);
    if (c < 0) break;
    m.primary(c);
    await sleep(40);
  }
  const front = [];
  for (let c = 0; c < f.n; c++) {
    if (!f.revealed[c] && f.mines[c] && !f.flags[c] && f.nb[c].some((y) => f.revealed[y])) front.push(c);
  }
  let k = 0;
  for (const c of front) {
    if (k++ % flagEvery !== flagEvery - 1) { m.doFlag(c); await sleep(30); }
  }
  return { status: S.status, revealed: f.revealedCount, n: f.n, flags: f.flagCount };
}
"""


def context(browser, w, h, mobile=False):
    return browser.new_context(
        viewport={'width': w, 'height': h},
        device_scale_factor=2 if mobile else 1,
        is_mobile=mobile,
        has_touch=mobile,
        locale='en-US',
    )


def game_shot(page, start_js, name, steps, flag_every=3, mobile=False, settle=2600, at=(0.5, 0.5)):
    page.evaluate(start_js)
    page.wait_for_timeout(2800)
    vp = page.viewport_size
    x, y = vp['width'] * at[0], vp['height'] * at[1]
    if mobile:
        page.touchscreen.tap(x, y)
    else:
        page.mouse.click(x, y)
    page.wait_for_timeout(900)
    res = page.evaluate(PLAY, {'steps': steps, 'flagEvery': flag_every})
    page.wait_for_timeout(settle)
    path = os.path.join(SHOTS, name + '.png')
    page.screenshot(path=path)
    print(name, res)
    return path


def webp(src, dst, width=None, quality=82):
    im = Image.open(src).convert('RGB')
    if width and im.width != width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(dst, 'WEBP', quality=quality, method=6)
    print(dst, im.size, os.path.getsize(dst) // 1024, 'KB')


def main():
    only = set(sys.argv[1:])
    os.makedirs(SHOTS, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=ARGS)

        if not only or 'desktop' in only:
            page = context(b, 1280, 760).new_page()
            page.goto(URL)
            page.wait_for_timeout(5000)
            page.screenshot(path=os.path.join(SHOTS, 'readme_title.png'))
            game_shot(page, 'window.__mm.startLevel(window.__mm.campaignLevel(8))', 'readme_planet', 70)
            game_shot(page, 'window.__mm.startLevel(window.__mm.campaignLevel(5))', 'readme_cube', 40)
            game_shot(page, 'window.__mm.startLevel(window.__mm.classicLevel(1))', 'readme_classic', 45, flag_every=2)

        if not only or 'mobile' in only:
            page = context(b, 390, 844, mobile=True).new_page()
            page.goto(URL)
            page.wait_for_timeout(5000)
            # tap the near side of the ring, not the hole in the middle
            game_shot(page, 'window.__mm.startLevel(window.__mm.campaignLevel(3))', 'readme_mobile_donut', 45,
                      mobile=True, at=(0.5, 0.64))

        if not only or 'og' in only:
            page = context(b, 1200, 630).new_page()
            page.goto(URL)
            page.wait_for_timeout(5000)
            # a cleaner card: no corner buttons, no progress line
            page.add_style_tag(content='.icons, .progress-line { visibility: hidden !important; }')
            page.wait_for_timeout(300)
            page.screenshot(path=os.path.join(SHOTS, 'og.png'))
        b.close()

    def have(n):
        return os.path.exists(os.path.join(SHOTS, n))

    if have('readme_title.png'):
        webp(os.path.join(SHOTS, 'readme_title.png'), os.path.join(DOCS, 'title.webp'))
    for n in ('planet', 'cube', 'classic'):
        if have(f'readme_{n}.png'):
            webp(os.path.join(SHOTS, f'readme_{n}.png'), os.path.join(DOCS, f'{n}.webp'))
    if have('readme_mobile_donut.png'):
        webp(os.path.join(SHOTS, 'readme_mobile_donut.png'), os.path.join(DOCS, 'mobile-donut.webp'), width=520)
    if have('og.png'):
        dst = os.path.join(ROOT, 'public', 'og.jpg')
        Image.open(os.path.join(SHOTS, 'og.png')).convert('RGB').save(dst, 'JPEG', quality=86, optimize=True, progressive=True)
        print(dst, os.path.getsize(dst) // 1024, 'KB')


if __name__ == '__main__':
    main()
