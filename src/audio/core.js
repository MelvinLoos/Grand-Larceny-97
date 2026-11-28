// --- PROCEDURAL WEB AUDIO CORE: buses, shared buffers, spatial helper, one-shot primitives ---
// No audio files: everything is oscillators, one shared noise buffer and filters.

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const MASTER = 0.9;
const NOISE_SECONDS = 1.5;
const PAN_SPAN = 500; // world px of horizontal offset for full pan
const PAN_MAX = 0.85;
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];

export class AudioCore {
    constructor() {
        this.ctx = null;
        this.enabled = true; // user mute toggle
        this.gameActive = true; // false while paused / on the map
        this.listener = { x: 0, y: 0, vx: 0, vy: 0 };
        this.live = 0; // in-flight one-shot sources (leak check)
        this._unlock = () => this.unlock();
    }

    // The context is only ever created inside a user gesture, so the browser never warns about autoplay.
    // The listeners stay for good: iOS / WebKit suspends or "interrupts" the context after calls, Siri,
    // alarms and lock-screen, and only a later gesture can bring it back. navigator.audioSession is left
    // alone so the hardware mute switch keeps working.
    attach() {
        for (const type of GESTURES) window.addEventListener(type, this._unlock, true);
        document.addEventListener('visibilitychange', () => this.applyActive());
    }

    unlock() {
        if (!this.ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            this.ctx = new AC();
            this.ctx.onstatechange = () => this.onStateChange();
            this.build(this.ctx);
        }
        this.recover();
    }

    // Resume whenever the context is not running and the game wants sound; a rejection outside a
    // gesture just means the very next tap (caught by the permanent listeners) does it
    recover() {
        const ctx = this.ctx;
        if (!ctx || ctx.state === 'running' || !this.isActive()) return;
        ctx.resume().catch(() => {});
    }

    onStateChange() {
        // 'suspended' | 'interrupted' (WebKit) while we want sound: try now, else wait for a gesture
        if (this.ctx.state !== 'running') this.recover();
    }

    init() {
        this.unlock();
    }

    build(ctx) {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.knee.value = 10;
        comp.ratio.value = 6;
        comp.attack.value = 0.003;
        comp.release.value = 0.25;
        comp.connect(ctx.destination);
        this.masterGain = this.gainTo(this.enabled ? MASTER : 0, comp);
        this.sfxGain = this.gainTo(0.9, this.masterGain);
        this.engineGain = this.gainTo(0.38, this.masterGain); // rumble under radio + SFX, never over them
        this.radioGain = this.gainTo(0.5, this.masterGain);

        // One white-noise buffer for every screech, static, snare, spray and explosion
        const len = Math.floor(ctx.sampleRate * NOISE_SECONDS);
        this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

        // One soft-clip curve for every distorted layer
        this.curve = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) this.curve[i] = Math.tanh(((i / 1023) * 2 - 1) * 4);

        this.onBuild(ctx);
    }

    onBuild() {}

    gainTo(value, dest) {
        const g = this.ctx.createGain();
        g.gain.value = value;
        g.connect(dest);
        return g;
    }

    noiseSource(rate = 1) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        src.loop = true;
        src.playbackRate.value = rate;
        return src;
    }

    // --- Mute & pause ---
    toggle() {
        this.enabled = !this.enabled;
        this.unlock();
        if (this.ctx) {
            const g = this.masterGain.gain;
            const v = this.enabled ? MASTER : 0;
            g.cancelScheduledValues(0);
            // A suspended clock never reaches a scheduled ramp, so set it outright
            if (this.ctx.state !== 'running') g.value = v;
            else g.setTargetAtTime(v, this.ctx.currentTime, 0.03);
        }
        return this.enabled;
    }

    setActive(on) {
        if (on === this.gameActive) return;
        this.gameActive = on;
        this.applyActive();
    }

    isActive() {
        return this.gameActive && !document.hidden;
    }

    // Suspending freezes every loop, the radio clock and its scheduler together: no ghost hum
    applyActive() {
        if (!this.ctx) return;
        if (this.isActive()) this.ctx.resume().catch(() => {});
        else this.ctx.suspend().catch(() => {});
    }

    ready() {
        return !!this.ctx && this.enabled && this.gameActive;
    }

    // --- Spatial helper ---
    setListener(x, y, vx = 0, vy = 0) {
        const l = this.listener;
        l.x = x;
        l.y = y;
        l.vx = vx;
        l.vy = vy;
    }

    // gain = (1 - d/maxDist)^2, pan from horizontal offset; null when out of earshot
    spatialParams(x, y, maxDist) {
        const dx = x - this.listener.x;
        const k = clamp(1 - Math.hypot(dx, y - this.listener.y) / maxDist, 0, 1);
        return { gain: k * k, pan: clamp(dx / PAN_SPAN, -PAN_MAX, PAN_MAX) };
    }

    // One sound event. With x/y it gets its own distance gain + StereoPanner tail; the tail
    // disconnects itself once the event's last source has ended.
    voice(x, y, maxDist = 900, vol = 1) {
        if (!this.ready()) return null;
        let gain = vol;
        let pan = 0;
        if (x !== undefined) {
            const s = this.spatialParams(x, y, maxDist);
            gain *= s.gain;
            pan = s.pan;
            if (gain < 0.01) return null;
        }
        const ctx = this.ctx;
        const tail = ctx.createGain();
        tail.gain.value = gain;
        const nodes = [tail];
        if (pan && ctx.createStereoPanner) {
            const p = ctx.createStereoPanner();
            p.pan.value = pan;
            tail.connect(p);
            p.connect(this.sfxGain);
            nodes.push(p);
        } else tail.connect(this.sfxGain);
        return { ctx, t: ctx.currentTime, in: tail, nodes, pending: 0 };
    }

    // An event that plays straight into an existing bus at a given clock time (radio notes)
    voiceOn(dest, t) {
        return { ctx: this.ctx, t, in: dest, nodes: [], pending: 0 };
    }

    // Free the source, its private chain and (with the event's last source) the shared tail
    track(v, src, chain) {
        v.pending++;
        this.live++;
        src.onended = () => {
            src.disconnect();
            for (const n of chain) n.disconnect();
            this.live--;
            if (--v.pending === 0) for (const n of v.nodes) n.disconnect();
        };
    }

    // source -> [waveshaper] -> [filter] -> [AM] -> envelope -> event input
    chain(v, src, o, t, dur) {
        const ctx = v.ctx;
        const chain = [];
        let head = src;
        const link = (n) => {
            head.connect(n);
            head = n;
            chain.push(n);
        };
        if (o.drive) {
            const ws = ctx.createWaveShaper();
            ws.curve = this.curve;
            link(ws);
        }
        if (o.freq) {
            const f = ctx.createBiquadFilter();
            f.type = o.ftype || 'lowpass';
            f.frequency.setValueAtTime(o.freq, t);
            if (o.freq1) f.frequency.exponentialRampToValueAtTime(o.freq1, t + (o.fdur || dur));
            f.Q.value = o.Q ?? 1;
            link(f);
        }
        if (o.am) {
            // amplitude modulation (rattles, bell trills)
            const am = ctx.createGain();
            am.gain.value = 1 - o.am.depth / 2;
            const lfo = ctx.createOscillator();
            lfo.type = o.am.type || 'square';
            lfo.frequency.value = o.am.rate;
            const depth = ctx.createGain();
            depth.gain.value = o.am.depth / 2;
            lfo.connect(depth);
            depth.connect(am.gain);
            lfo.start(t);
            lfo.stop(t + dur + 0.05);
            chain.push(lfo, depth);
            link(am);
        }
        const env = ctx.createGain();
        const peak = Math.max(0.0002, o.gain ?? 0.1);
        const a = o.attack ?? 0.003;
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(peak, t + a);
        if (o.hold) env.gain.setValueAtTime(peak, t + a + o.hold);
        env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        link(env);
        env.connect(v.in);
        return chain;
    }

    tone(v, o) {
        if (!v) return;
        const t = v.t + (o.at || 0);
        const dur = o.dur;
        const osc = v.ctx.createOscillator();
        osc.type = o.type || 'square';
        osc.frequency.setValueAtTime(o.f0, t);
        if (o.f1 && o.f1 !== o.f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + (o.glide || dur));
        if (o.detune) osc.detune.value = o.detune;
        const chain = this.chain(v, osc, o, t, dur);
        osc.start(t);
        osc.stop(t + dur + 0.02);
        this.track(v, osc, chain);
    }

    noise(v, o) {
        if (!v) return;
        const t = v.t + (o.at || 0);
        const src = this.noiseSource(o.rate || 1);
        const chain = this.chain(v, src, o, t, o.dur);
        src.start(t, Math.random() * (NOISE_SECONDS - 0.1));
        src.stop(t + o.dur + 0.02);
        this.track(v, src, chain);
    }

    // Glottal sawtooth through two vowel formants: a syllable of synthesized speech
    formant(v, o) {
        if (!v) return;
        const ctx = v.ctx;
        const t = v.t + (o.at || 0);
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(o.f0, t);
        osc.frequency.linearRampToValueAtTime(o.f1 || o.f0, t + o.dur);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(o.gain, t + 0.015);
        env.gain.setValueAtTime(o.gain, t + o.dur * 0.6);
        env.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
        const chain = [env];
        for (const [f, q] of [
            [o.vowel[0], 6],
            [o.vowel[1], 9]
        ]) {
            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = f;
            bp.Q.value = q;
            osc.connect(bp);
            bp.connect(env);
            chain.push(bp);
        }
        env.connect(v.in);
        osc.start(t);
        osc.stop(t + o.dur + 0.02);
        this.track(v, osc, chain);
    }
}

export const VOWELS = [
    [800, 1150],
    [400, 1700],
    [350, 2300],
    [450, 800],
    [325, 700],
    [600, 1000]
];
