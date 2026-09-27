/** Keyboard + mouse (pointer lock) + simple touch look/move. */
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  locked = false;
  /** Virtual stick from touch (x: strafe, y: forward). */
  touchMove = { x: 0, y: 0 };
  private touchLookId: number | null = null;
  private touchMoveId: number | null = null;
  private touchLast = { x: 0, y: 0 };
  private touchStart = { x: 0, y: 0 };

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    element.addEventListener('touchstart', (e) => this.onTouch(e, 'start'), { passive: false });
    element.addEventListener('touchmove', (e) => this.onTouch(e, 'move'), { passive: false });
    element.addEventListener('touchend', (e) => this.onTouch(e, 'end'), { passive: false });
    element.addEventListener('touchcancel', (e) => this.onTouch(e, 'end'), { passive: false });
  }

  private onTouch(e: TouchEvent, phase: 'start' | 'move' | 'end'): void {
    e.preventDefault();
    const w = this.element.clientWidth;
    for (const t of Array.from(e.changedTouches)) {
      if (phase === 'start') {
        if (t.clientX < w * 0.4 && this.touchMoveId === null) {
          this.touchMoveId = t.identifier;
          this.touchStart = { x: t.clientX, y: t.clientY };
        } else if (this.touchLookId === null) {
          this.touchLookId = t.identifier;
          this.touchLast = { x: t.clientX, y: t.clientY };
        }
      } else if (phase === 'move') {
        if (t.identifier === this.touchMoveId) {
          this.touchMove.x = Math.max(-1, Math.min(1, (t.clientX - this.touchStart.x) / 60));
          this.touchMove.y = Math.max(-1, Math.min(1, -(t.clientY - this.touchStart.y) / 60));
        } else if (t.identifier === this.touchLookId) {
          this.mouseDX += (t.clientX - this.touchLast.x) * 1.6;
          this.mouseDY += (t.clientY - this.touchLast.y) * 1.6;
          this.touchLast = { x: t.clientX, y: t.clientY };
        }
      } else {
        if (t.identifier === this.touchMoveId) {
          this.touchMoveId = null;
          this.touchMove.x = this.touchMove.y = 0;
        }
        if (t.identifier === this.touchLookId) this.touchLookId = null;
      }
    }
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  /** True once per physical key press. */
  hit(code: string): boolean {
    return this.pressed.has(code);
  }

  requestLock(): void {
    if (!this.locked) this.element.requestPointerLock?.();
  }

  releaseLock(): void {
    if (this.locked) document.exitPointerLock?.();
  }

  endFrame(): void {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.pressed.clear();
  }
}
