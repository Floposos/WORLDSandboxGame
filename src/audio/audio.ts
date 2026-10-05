import { SPEED_OF_SOUND } from '../core/constants';

/**
 * Lautstärke und Tiefpass einer Explosion aus Entfernung und Ladung (rein, testbar).
 * Lautstärke fällt mit 1/(1 + d/d0), d0 wächst mit W^(1/3); der Tiefpass schließt mit der
 * Entfernung (Luft dämpft hohe Frequenzen stärker).
 */
export function explosionMix(
  distanceM: number,
  tntKg: number,
): { gain: number; cutoffHz: number; delayS: number; durationS: number } {
  const s = Math.cbrt(Math.max(0.01, tntKg));
  const d = Math.max(0, distanceM);
  const gain = Math.min(1, (0.35 + 0.08 * s) / (1 + d / (40 * s)));
  const cutoffHz = Math.max(180, Math.min(9_000, 9_000 / (1 + d / (60 * s))));
  return { gain, cutoffHz, delayS: d / SPEED_OF_SOUND, durationS: Math.min(6, 0.8 + 0.35 * s) };
}

/**
 * Prozedurale Geräusche mit WebAudio (Spec 7.6): Explosion (Rauschen + tiefer Wumms, verzögert
 * um Distanz / 343 m/s), Einsturz-Rumpeln. Keine Audiodateien, also keine Lizenzfragen.
 * Der AudioContext entsteht erst bei der ersten Nutzung (Browser verlangen eine Nutzergeste).
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.8;
  private muted = false;
  private lastRumble = -1;

  setVolume(volume: number, muted: boolean): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    }
  }

  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    const Ctor =
      typeof window !== 'undefined'
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    // Sanfte Begrenzung gegen Übersteuern bei mehreren Explosionen
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    // Braunes Rauschen (tiefer als weißes, klingt nach Druckwelle)
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    return this.ctx;
  }

  /** Explosion in `distanceM` Entfernung (Schallverzögerung inklusive). */
  explosion(distanceM: number, tntKg: number): void {
    if (this.muted || this.volume === 0) return;
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noise) return;
    const mix = explosionMix(distanceM, tntKg);
    const t0 = ctx.currentTime + mix.delayS;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(mix.cutoffHz, t0);
    lp.frequency.exponentialRampToValueAtTime(
      Math.max(80, mix.cutoffHz * 0.15),
      t0 + mix.durationS,
    );
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(mix.gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + mix.durationS);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + mix.durationS + 0.1);

    // Tiefer Wumms: Sinus mit fallender Tonhöhe
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(70, t0);
    osc.frequency.exponentialRampToValueAtTime(28, t0 + mix.durationS * 0.6);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(mix.gain * 0.9, t0 + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + mix.durationS * 0.7);
    osc.connect(og).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + mix.durationS);
  }

  /** Rumpeln beim Einsturz (gedrosselt: höchstens alle 0,5 s). */
  rumble(distanceM: number, strength = 1): void {
    if (this.muted || this.volume === 0) return;
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noise) return;
    if (ctx.currentTime - this.lastRumble < 0.5) return;
    this.lastRumble = ctx.currentTime;
    const t0 = ctx.currentTime + distanceM / SPEED_OF_SOUND;
    const dur = 2.5;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const g = ctx.createGain();
    const peak = Math.min(0.6, (0.25 * strength) / (1 + distanceM / 80));
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t0 + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.1);
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
