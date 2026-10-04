/**
 * Tastatur- und Maus-Eingabe für Flug- und Bodenkamera. Blickdrehung per Pointer-Lock
 * (Klick ins Bild) oder, falls der Browser den verweigert, per Ziehen mit gedrückter Maus.
 */
export class CameraInput {
  private readonly keys = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private dragging = false;
  /** Nur wenn aktiv, werden Eingaben gesammelt und Pointer-Lock angefordert. */
  active = false;
  private readonly disposers: (() => void)[] = [];

  constructor(private readonly element: HTMLElement) {
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Document | Window,
      type: K,
      handler: (e: HTMLElementEventMap[K]) => void,
    ): void => {
      target.addEventListener(type, handler as EventListener);
      this.disposers.push(() => target.removeEventListener(type, handler as EventListener));
    };
    on(window, 'keydown', (e) => {
      if (!this.active || isTyping(e)) return;
      this.keys.add(e.code);
      if (MOVEMENT_KEYS.has(e.code)) e.preventDefault();
    });
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => this.keys.clear());
    on(element, 'pointerdown', (e) => {
      if (!this.active || e.button !== 0) return;
      this.dragging = true;
      if (!this.locked) {
        // Pointer-Lock ist optional: In Tests/Headless oder ohne Nutzergeste schlägt er fehl.
        try {
          const req = element.requestPointerLock() as unknown;
          if (req instanceof Promise) req.catch(() => undefined);
        } catch {
          /* Ziehen als Rückfall */
        }
      }
    });
    on(window, 'pointerup', () => (this.dragging = false));
    on(window, 'mousemove', (e) => {
      if (!this.active) return;
      if (this.locked || this.dragging) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      }
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.element;
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Achse aus zwei Tasten: +1, −1 oder 0. */
  axis(positive: string, negative: string): number {
    return (this.isDown(positive) ? 1 : 0) - (this.isDown(negative) ? 1 : 0);
  }

  /** Liest die gesammelte Mausbewegung (Pixel) und setzt sie zurück. */
  consumeLook(): { dx: number; dy: number } {
    const out = { dx: this.lookX, dy: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }

  /** Einmalige Tastendrücke (z. B. Sprung) verbrauchen. */
  consumeKey(code: string): boolean {
    if (!this.keys.has(code)) return false;
    this.keys.delete(code);
    return true;
  }

  release(): void {
    this.keys.clear();
    this.lookX = 0;
    this.lookY = 0;
    this.dragging = false;
    if (this.locked) document.exitPointerLock();
  }

  dispose(): void {
    this.release();
    for (const d of this.disposers) d();
  }
}

const MOVEMENT_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

/** Tippt der Nutzer gerade in ein Eingabefeld? Dann keine Steuerung. */
export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  if (!t || typeof t.tagName !== 'string') return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}
