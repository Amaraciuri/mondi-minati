// Pointer handling: tap, press-and-hold, right/middle click, drag, pinch, wheel.
export class Input {
  constructor(el, h) {
    this.el = el;
    this.h = h; // handlers
    this.ptrs = new Map();
    this.drag = false;
    this.pinch = false;
    this.longTimer = 0;
    this.longFired = false;
    this.downCell = -1;
    this.lastMove = 0;
    this.holdEl = document.getElementById('hold');
    this.enabled = true;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e, false));
    el.addEventListener('pointercancel', (e) => this.up(e, true));
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.ptrs.size) this.h.hover(-1);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (!this.enabled) return;
        const k = e.deltaMode === 1 ? 30 : 1;
        this.h.zoom(Math.exp(-e.deltaY * k * 0.0016));
      },
      { passive: false }
    );
  }

  pos(e) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  clearLong() {
    clearTimeout(this.longTimer);
    this.longTimer = 0;
    this.holdEl?.classList.remove('on');
  }

  down(e) {
    this.h.unlock?.();
    if (!this.enabled) return;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    const p = this.pos(e);
    this.ptrs.set(e.pointerId, { x: p.x, y: p.y, x0: p.x, y0: p.y, t0: performance.now(), button: e.button, type: e.pointerType });
    if (this.ptrs.size === 1) {
      this.h.grab?.();
      this.drag = false;
      this.pinch = false;
      this.longFired = false;
      this.downCell = this.h.pick(p.x, p.y);
      this.lastMove = performance.now();
      if (e.pointerType === 'mouse') {
        if (e.button === 2) {
          // classic: right button flags immediately
          this.longFired = true;
          if (this.downCell >= 0) this.h.secondary(this.downCell);
          return;
        }
        if (e.button === 0) this.h.pressStart(this.downCell);
      } else {
        this.h.pressStart(this.downCell);
        if (this.downCell >= 0 && this.h.canHold(this.downCell)) {
          if (this.holdEl) {
            this.holdEl.style.left = e.clientX + 'px';
            this.holdEl.style.top = e.clientY + 'px';
            setTimeout(() => {
              if (this.longTimer && !this.drag) this.holdEl.classList.add('on');
            }, 110);
          }
          this.longTimer = setTimeout(() => {
            this.longTimer = 0;
            this.holdEl?.classList.remove('on');
            if (this.drag || this.pinch || this.ptrs.size !== 1) return;
            this.longFired = true;
            this.h.pressEnd();
            this.h.secondary(this.downCell);
          }, 380);
        }
      }
    } else if (this.ptrs.size === 2) {
      this.clearLong();
      this.h.pressEnd();
      this.pinch = true;
      this.drag = true;
      const [a, b] = [...this.ptrs.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.h.dragStart();
    }
  }

  move(e) {
    const p = this.pos(e);
    const ptr = this.ptrs.get(e.pointerId);
    if (!ptr) {
      if (e.pointerType === 'mouse' && this.enabled) this.h.hover(this.h.pick(p.x, p.y));
      return;
    }
    const now = performance.now();
    const dt = (now - this.lastMove) / 1000;
    this.lastMove = now;
    const dx = p.x - ptr.x, dy = p.y - ptr.y;
    ptr.x = p.x;
    ptr.y = p.y;
    if (!this.enabled) return;
    if (this.ptrs.size === 1) {
      if (!this.drag) {
        const moved = Math.hypot(p.x - ptr.x0, p.y - ptr.y0);
        const thr = ptr.type === 'mouse' ? 5 : 10;
        if (moved > thr) {
          this.drag = true;
          this.clearLong();
          this.h.pressEnd();
          this.h.dragStart();
          // include the movement so far so the grab feels exact
          this.h.dragBy(p.x - ptr.x0, p.y - ptr.y0, dt);
        }
      } else this.h.dragBy(dx, dy, dt);
    } else if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (this.pinchDist > 0) this.h.zoom(d / this.pinchDist);
      this.h.dragBy(mid.x - this.pinchMid.x, mid.y - this.pinchMid.y, dt);
      this.pinchDist = d;
      this.pinchMid = mid;
    }
  }

  up(e, cancelled) {
    const ptr = this.ptrs.get(e.pointerId);
    if (!ptr) return;
    if (!cancelled) this.h.unlock?.();
    this.ptrs.delete(e.pointerId);
    try {
      this.el.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    if (this.ptrs.size > 0) {
      // finishing a pinch: keep dragging state until every finger is up
      if (this.ptrs.size === 1) {
        const rest = [...this.ptrs.values()][0];
        rest.x0 = rest.x;
        rest.y0 = rest.y;
      }
      return;
    }
    this.clearLong();
    const wasDrag = this.drag;
    this.h.pressEnd();
    if (wasDrag) {
      this.h.dragEnd(performance.now() - this.lastMove);
    } else if (!cancelled && !this.longFired && this.enabled) {
      const p = this.pos(e);
      const target = this.downCell >= 0 ? this.downCell : this.h.pick(p.x, p.y);
      if (ptr.type === 'mouse' && ptr.button === 1) this.h.chord(target);
      else if (ptr.type === 'mouse' || ptr.button === 0) this.h.primary(target);
    }
    this.drag = false;
    this.pinch = false;
  }
}
