/**
 * Procedural Web Audio API Cosmic Soundscape & Event SFX Engine.
 * Zero external audio files — synthesizes lush deep-space ambient drone,
 * energy-scaled impact booms, Roche tidal cracks, supernova blasts, and glassy UI pings.
 */
class CosmosAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private mediaDest: MediaStreamAudioDestinationNode | null = null;
  private muted = false;
  private started = false;

  public isMuted(): boolean {
    return this.muted;
  }

  /** Returns a persistent Web Audio MediaStream tap for clean video recording, or null if unavailable/muted. */
  public getMediaStream(): MediaStream | null {
    if (!this.ctx || !this.masterGain || this.muted || this.ctx.state !== 'running') {
      return null;
    }
    if (!this.mediaDest) {
      this.mediaDest = this.ctx.createMediaStreamDestination();
      this.masterGain.connect(this.mediaDest);
    }
    return this.mediaDest.stream;
  }

  public ensureStarted(): void {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    try {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.42;
      this.masterGain.connect(this.ctx.destination);

      this.startAmbientDrone();
      this.started = true;
    } catch {
      // Ignore if browser blocks audio before gesture
    }
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    if (!mute) this.ensureStarted();
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(mute ? 0 : 0.42, this.ctx.currentTime, 0.08);
    }
  }

  private startAmbientDrone(): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;

    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = 0.16;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    filter.Q.value = 1.2;

    // Gentle LFO breathing on lowpass filter cutoff for cosmic stillness
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.065;
    lfoGain.gain.value = 95;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    filter.connect(this.ambientGain);
    this.ambientGain.connect(this.masterGain);

    // Warm A-minor 9th deep space chord pad (55 Hz, 82.4 Hz, 110.3 Hz, 164.5 Hz)
    const freqs = [55.0, 82.41, 110.25, 164.6];
    const types: OscillatorType[] = ['sine', 'triangle', 'sine', 'sine'];
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = types[idx];
      osc.frequency.value = f;
      g.gain.value = idx === 0 ? 0.35 : idx === 1 ? 0.18 : 0.1;
      osc.connect(g);
      g.connect(filter);
      osc.start();
    });
  }

  public playSpawnPing(): void {
    if (this.muted) return;
    this.ensureStarted();
    if (!this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.16);

    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.14, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.28);

    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  public playCollision(impactEnergy: number, catastrophic = false): void {
    if (this.muted) return;
    this.ensureStarted();
    if (!this.ctx || !this.masterGain) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const intensity = Math.min(1, Math.max(0.25, (Math.log10(Math.max(impactEnergy, 1e22)) - 22) / 14));

    // Sub-bass gravitational impact thump
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(catastrophic ? 115 : 88, now);
    osc.frequency.exponentialRampToValueAtTime(24, now + (catastrophic ? 1.1 : 0.65));

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.55 * intensity, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (catastrophic ? 1.2 : 0.75));

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 1.25);

    // Filtered noise debris crackle
    this.playNoiseBurst(catastrophic ? 0.95 : 0.45, catastrophic ? 950 : 620, 0.25 * intensity);
  }

  public playTidalDisruption(): void {
    if (this.muted) return;
    this.ensureStarted();
    if (!this.ctx || !this.masterGain) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.9);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(520, now);
    filter.frequency.exponentialRampToValueAtTime(120, now + 0.9);
    filter.Q.value = 3.0;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.26, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 1.0);

    this.playNoiseBurst(0.8, 1200, 0.16);
  }

  public playSupernova(): void {
    if (this.muted) return;
    this.ensureStarted();
    if (!this.ctx || !this.masterGain) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Massive cinematic sub-drop
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(140, now);
    sub.frequency.exponentialRampToValueAtTime(22, now + 2.2);

    subGain.gain.setValueAtTime(0.001, now);
    subGain.gain.linearRampToValueAtTime(0.75, now + 0.04);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 2.3);

    sub.connect(subGain);
    subGain.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 2.35);

    // Sweeping plasma shockwave wash
    this.playNoiseBurst(2.1, 2400, 0.36);
  }

  /**
   * Authentic LIGO-style Gravitational Wave Merger "Chirp" (rising frequency sweep -> ringdown impact!)
   */
  public playGravitationalWaveChirp(isKilonova = false): void {
    if (this.muted) return;
    this.ensureStarted();
    if (!this.ctx || !this.masterGain) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(42, now);
    osc.frequency.exponentialRampToValueAtTime(125, now + 0.45);
    osc.frequency.exponentialRampToValueAtTime(isKilonova ? 520 : 340, now + 0.72);
    osc.frequency.exponentialRampToValueAtTime(32, now + 1.55);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.38, now + 0.68);
    gain.gain.linearRampToValueAtTime(0.72, now + 0.74);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.65);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 1.7);

    if (isKilonova) {
      this.playNoiseBurst(1.6, 3200, 0.28);
    }
  }

  /**
   * Solar Coronal Mass Ejection (CME) magnetic eruption roar
   */
  public playCmeLaunch(): void {
    if (this.muted) return;
    this.ensureStarted();
    if (!this.ctx || !this.masterGain) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.9);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(950, now);
    filter.frequency.exponentialRampToValueAtTime(160, now + 0.95);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.26, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 1.05);

    this.playNoiseBurst(1.1, 1800, 0.22);
  }

  /**
   * Ethereal electromagnetic shimmer + resonant shield hum when CME strikes Earth's magnetosphere!
   */
  public playMagnetosphereHit(): void {
    if (this.muted) return;
    this.ensureStarted();
    if (!this.ctx || !this.masterGain) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const freqs = [196, 293.66, 440, 587.33];
    for (let i = 0; i < freqs.length; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freqs[i], now);
      osc.frequency.exponentialRampToValueAtTime(freqs[i] * 1.03, now + 1.4);

      gain.gain.setValueAtTime(0.0005, now);
      gain.gain.linearRampToValueAtTime(0.085 / (i * 0.4 + 1), now + 0.14);
      gain.gain.exponentialRampToValueAtTime(0.0005, now + 1.65);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 1.7);
    }
    this.playNoiseBurst(0.9, 1400, 0.14);
  }

  /**
   * Interstellar-inspired relativistic Morris-Thorne wormhole throat transit sweep
   */
  public playWormholeTransit(): void {
    if (this.muted) return;
    this.ensureStarted();
    if (!this.ctx || !this.masterGain) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    // 1. Deep sub-bass gravity dive -> throat resonance -> emergence settle (2.5s synced to 3D transit)
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(46, now);
    sub.frequency.exponentialRampToValueAtTime(132, now + 1.35);
    sub.frequency.exponentialRampToValueAtTime(34, now + 2.50);

    subGain.gain.setValueAtTime(0.001, now);
    subGain.gain.linearRampToValueAtTime(0.46, now + 1.25);
    subGain.gain.exponentialRampToValueAtTime(0.0008, now + 2.55);

    sub.connect(subGain);
    subGain.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 2.60);

    // 2. Shimmering exotic-matter harmonic crystal chord across the throat
    const chord = [220, 329.63, 493.88, 659.25];
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, now);
    filter.frequency.exponentialRampToValueAtTime(2600, now + 1.35);
    filter.frequency.exponentialRampToValueAtTime(360, now + 2.50);
    filter.Q.value = 1.8;

    const chordGain = ctx.createGain();
    chordGain.gain.setValueAtTime(0.0008, now);
    chordGain.gain.linearRampToValueAtTime(0.28, now + 1.18);
    chordGain.gain.exponentialRampToValueAtTime(0.0006, now + 2.52);
    filter.connect(chordGain);
    chordGain.connect(this.masterGain);

    for (let i = 0; i < chord.length; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(chord[i], now);
      osc.frequency.exponentialRampToValueAtTime(chord[i] * 1.08, now + 1.35);
      osc.frequency.exponentialRampToValueAtTime(chord[i], now + 2.50);
      g.gain.value = 0.065 / (0.25 + i * 0.2);
      osc.connect(g);
      g.connect(filter);
      osc.start(now);
      osc.stop(now + 2.56);
    }

    // 3. Relativistic plasma whoosh
    this.playNoiseBurst(2.40, 1950, 0.18);
  }

  private playNoiseBurst(duration: number, cutoffHz: number, volume: number): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const now = ctx.currentTime;
    filter.frequency.setValueAtTime(cutoffHz, now);
    filter.frequency.exponentialRampToValueAtTime(90, now + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
  }
}

export const cosmosAudio = new CosmosAudioEngine();
