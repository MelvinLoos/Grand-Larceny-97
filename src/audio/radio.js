// --- CAR RADIO: procedural stations on a lookahead scheduler (ctx clock, not frame-bound timers) ---
import { STATIONS } from '../config.js';
import { VOWELS } from './core.js';

const TICK_MS = 100;
const AHEAD = 0.3; // seconds of music scheduled in advance
const mf = (n) => 440 * 2 ** ((n - 69) / 12);
const pat = (s) => [...s].map((c) => c === 'x');
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// --- shared instruments (each call is a tiny self-freeing one-shot into the station bus) ---
const kick = (a, t, g = 0.55) => {
    const v = a.voiceOn(a.bus, t);
    a.tone(v, { type: 'sine', f0: 150, f1: 45, glide: 0.12, dur: 0.22, gain: g });
    a.noise(v, { ftype: 'highpass', freq: 2500, dur: 0.012, gain: g * 0.25 });
};
const snare = (a, t, g = 0.5) => {
    const v = a.voiceOn(a.bus, t);
    a.noise(v, { ftype: 'highpass', freq: 1800, dur: 0.15, gain: g * 0.7 });
    a.tone(v, { type: 'triangle', f0: 190, f1: 110, dur: 0.1, gain: g * 0.5 });
};
const hat = (a, t, g = 0.12, open = false) => {
    a.noise(a.voiceOn(a.bus, t), { ftype: 'highpass', freq: 7000, dur: open ? 0.12 : 0.03, gain: g });
};
const clap = (a, t, g = 0.4) => {
    const v = a.voiceOn(a.bus, t);
    for (const at of [0, 0.012, 0.024]) a.noise(v, { ftype: 'bandpass', freq: 1500, Q: 1.5, dur: 0.03, at, gain: g });
    a.noise(v, { ftype: 'bandpass', freq: 1500, Q: 1.5, dur: 0.12, at: 0.03, gain: g * 0.6 });
};
const chord = (a, t, notes, o) => {
    const v = a.voiceOn(a.bus, t);
    for (const n of notes) a.tone(v, { f0: mf(n), ...o });
};

// --- STYLES: bpm + step(audio, stepIndex, time, 16thDuration) ---
const JUNGLE = {
    kick: pat('x.x.......x.....x..x......x.....'),
    snare: pat('....x.......x.......x.......x...'),
    ghost: pat('.......x.x.....x.......x.x....x.'),
    roots: [33, 33, 29, 31],
    chords: [
        [57, 60, 64, 67],
        [57, 60, 64, 67],
        [53, 57, 60, 64],
        [55, 59, 62, 65]
    ]
};
const ACID = [
    { n: 45, a: 1 },
    { n: 45 },
    { n: 57, a: 1, s: 1 },
    { n: 45 },
    null,
    { n: 45 },
    { n: 48, a: 1 },
    { n: 50 },
    { n: 45, a: 1 },
    null,
    { n: 57 },
    { n: 45 },
    { n: 43, a: 1 },
    { n: 45 },
    null,
    { n: 52, s: 1 }
];
const RIFF = [
    [0, 24, 2],
    [3, 27, 1],
    [4, 29, 2],
    [8, 31, 2],
    [12, 29, 1],
    [14, 27, 2]
];
const SOFT_CHORDS = [
    [60, 64, 67, 71],
    [57, 60, 64, 67],
    [53, 57, 60, 64],
    [55, 59, 62, 65]
];

const STYLES = {
    // RUSH 104: amen-style breakbeat, rolling Reese, minor7 stabs
    jungle: {
        bpm: 168,
        step(a, k, t, d) {
            const s = k % 32;
            const sb = k % 16;
            const bar = Math.floor(k / 16) % 4;
            if (JUNGLE.kick[s]) kick(a, t, 0.6);
            if (JUNGLE.snare[s]) snare(a, t, 0.55);
            else if (JUNGLE.ghost[s]) snare(a, t, 0.14);
            if (s % 2 === 0) hat(a, t, 0.1, s % 8 === 6);
            const len = { 0: 6, 6: 4, 10: 6 }[sb];
            if (len) {
                const f = mf(JUNGLE.roots[bar] + (sb === 6 ? 12 : 0));
                const v = a.voiceOn(a.bus, t);
                for (const dt of [-14, 14]) {
                    a.tone(v, {
                        type: 'sawtooth',
                        f0: f,
                        detune: dt,
                        dur: len * d * 0.95,
                        gain: 0.05,
                        freq: 420,
                        freq1: 250,
                        fdur: len * d,
                        Q: 3
                    });
                }
                a.tone(v, { type: 'sine', f0: f, dur: len * d * 0.95, gain: 0.16 });
            }
            if (sb === 0 || (sb === 10 && bar % 2)) {
                chord(a, t, JUNGLE.chords[bar], { type: 'sawtooth', dur: 0.45, gain: 0.018, freq: 1600, attack: 0.01 });
            }
        }
    },
    // THE METER: four-on-the-floor, clap, squelchy 303 line, staccato organ
    acid: {
        bpm: 116,
        step(a, k, t, d) {
            const s = k % 16;
            const bar = Math.floor(k / 16) % 8;
            if (s % 4 === 0) kick(a, t, 0.55);
            if (s % 8 === 4) clap(a, t, 0.35);
            if (s % 4 === 2) hat(a, t, 0.14, true);
            else if (s % 2 === 1) hat(a, t, 0.05);
            const n = ACID[s];
            if (n) {
                const note = n.n + (bar >= 4 ? -2 : 0);
                const prev = a.rs.prev;
                const v = a.voiceOn(a.bus, t);
                a.tone(v, {
                    type: 'sawtooth',
                    f0: n.s && prev ? mf(prev) : mf(note),
                    f1: mf(note),
                    glide: 0.05,
                    dur: d * 0.92,
                    gain: n.a ? 0.07 : 0.045,
                    freq: (900 + 1400 * (0.5 + 0.5 * Math.sin(k * 0.05))) * (n.a ? 1.4 : 1),
                    freq1: 250,
                    fdur: d * 0.8,
                    Q: 14
                });
                a.rs.prev = note;
            }
            if ([2, 5, 10, 13].includes(s)) {
                const notes = bar < 4 ? [57, 60, 64] : [55, 59, 62];
                chord(a, t, notes, { type: 'sine', dur: 0.07, gain: 0.03 });
                chord(a, t, notes, { type: 'square', dur: 0.06, gain: 0.012, freq: 2200 });
            }
        }
    },
    // CRASH FM: driving distorted power chords, backbeat, gritty lead
    rock: {
        bpm: 132,
        step(a, k, t, d) {
            const s = k % 16;
            const bar = Math.floor(k / 16) % 4;
            const root = [40, 43, 45, 43][bar];
            if ([0, 8, 10].includes(s)) kick(a, t, 0.55);
            if (s === 4 || s === 12) snare(a, t, 0.6);
            if (s % 2 === 0) hat(a, t, 0.08);
            if (s % 2 === 0) {
                const dur = s % 4 === 0 ? d * 1.9 : d * 1.3;
                const v = a.voiceOn(a.bus, t);
                for (const n of [root, root + 7]) {
                    a.tone(v, { type: 'sawtooth', f0: mf(n), dur, gain: 0.04, drive: true, freq: 1400 });
                }
                a.tone(v, { type: 'sine', f0: mf(root - 12), dur, gain: 0.14 });
            }
            for (const [st, off, len] of RIFF) {
                if (st !== s) continue;
                a.tone(a.voiceOn(a.bus, t), {
                    type: 'square',
                    f0: mf(root + off),
                    dur: len * d * 0.9,
                    gain: 0.03,
                    drive: true,
                    freq: 1500,
                    ftype: 'bandpass',
                    Q: 1.2
                });
            }
        }
    },
    // BEIGE 101: easy listening
    soft: {
        bpm: 92,
        step(a, k, t, d) {
            const s = k % 16;
            const c = SOFT_CHORDS[Math.floor(k / 16) % 4];
            if (s === 0 || s === 10) kick(a, t, 0.3);
            if (s === 4 || s === 12) {
                const v = a.voiceOn(a.bus, t);
                a.tone(v, { type: 'square', f0: 900, dur: 0.03, gain: 0.04 });
                a.noise(v, { ftype: 'bandpass', freq: 2000, dur: 0.05, gain: 0.08 });
            }
            if (s % 2 === 0) hat(a, t, 0.05);
            if (s === 0 || s === 6 || s === 11)
                chord(a, t, c, { type: 'triangle', dur: d * 5, gain: 0.03, freq: 2400 });
            if (s === 0 || s === 8)
                a.tone(a.voiceOn(a.bus, t), { type: 'sine', f0: mf(c[0] - 24), dur: d * 4, gain: 0.18 });
        }
    },
    // AM talk radio: bandpassed hiss and random formant babble
    talk: {
        bpm: 150,
        setup(a) {
            a.rs.pitch = 100 + Math.random() * 100;
            a.rs.nextPhrase = 0;
            a.rs.until = 0;
        },
        step(a, k, t) {
            const rs = a.rs;
            const v = a.voiceOn(a.bus, t);
            if (k % 3 === 0)
                a.noise(v, { ftype: 'bandpass', freq: 1400, Q: 0.4, dur: 0.35, gain: 0.012, attack: 0.05 });
            if (k >= rs.nextPhrase) {
                rs.until = k + 8 + Math.floor(Math.random() * 14);
                rs.nextPhrase = rs.until + 6 + Math.floor(Math.random() * 14);
                rs.pitch = pick([105, 130, 190, 210]);
            }
            if (k < rs.until && Math.random() < 0.72) {
                const f = rs.pitch * (0.9 + Math.random() * 0.25);
                a.formant(v, {
                    f0: f,
                    f1: f * (0.85 + Math.random() * 0.3),
                    dur: 0.08 + Math.random() * 0.07,
                    gain: 0.05,
                    vowel: pick(VOWELS)
                });
            }
        }
    },
    // Dispatch scanner: carrier hum, walkie EQ, squelch + formant bursts
    scanner: {
        bpm: 150,
        setup(a, bus) {
            const ctx = a.ctx;
            const mk = (f) => {
                const o = ctx.createOscillator();
                o.frequency.value = f;
                const g = ctx.createGain();
                g.gain.value = 0.02;
                o.connect(g);
                g.connect(bus);
                o.start();
                return [o, g];
            };
            const n = a.noiseSource();
            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = 1400;
            bp.Q.value = 0.5;
            const ng = ctx.createGain();
            ng.gain.value = 0.012;
            n.connect(bp);
            bp.connect(ng);
            ng.connect(bus);
            n.start();
            a.rs.nodes = [...mk(60), ...mk(120), n, bp, ng];
            a.rs.nextChat = 15 + Math.floor(Math.random() * 40);
        },
        step(a, k, t) {
            if (k >= a.rs.nextChat) {
                a.rs.nextChat = k + 60 + Math.floor(Math.random() * 60);
                a.chatter(t);
            }
        }
    }
};

export const radio = {
    buildRadio(ctx) {
        this.radioFilter = ctx.createBiquadFilter(); // "car speaker" EQ, also the door-open muffler
        this.radioFilter.type = 'lowpass';
        this.radioFilter.frequency.value = 5500;
        this.radioCar = this.gainTo(1, this.radioGain);
        this.radioFilter.connect(this.radioCar);
        this.station = null;
        this.style = null;
        this.bus = null;
        this.rs = {};
        this.retire = [];
        this.epoch = ctx.currentTime;
        this.nextT = 0;
        this.stepK = 0;
        this.timer = null;
        this.lastDispatch = -9;
    },

    // Called on entering a car or pressing R. `id` is a STATIONS key or 'off'.
    tuneTo(id) {
        if (!this.ctx) return;
        const key = STATIONS[id] && id !== 'off' ? id : null;
        if (key === this.station) return;
        const now = this.ctx.currentTime;
        // FM tuning burst + tape click
        const v = this.voiceOn(this.radioCar, now);
        this.noise(v, { ftype: 'bandpass', freq: 1200, freq1: 3200, Q: 0.7, dur: 0.25, gain: 0.22, attack: 0.01 });
        this.tone(v, { type: 'square', f0: 3000, dur: 0.012, gain: 0.08 });
        this.tone(v, { type: 'square', f0: 2200, dur: 0.012, at: 0.25, gain: 0.08 });
        this.setStation(key, now);
    },

    setStation(key, now = this.ctx.currentTime) {
        if (this.bus) {
            this.bus.gain.setTargetAtTime(0, now, 0.05);
            this.retire.push({ bus: this.bus, rs: this.rs, at: now + 0.6 });
            this.bus = null;
        }
        this.station = key;
        this.style = null;
        this.rs = {};
        if (key) {
            this.style = STYLES[STATIONS[key].style];
            this.bus = this.gainTo(0, this.radioFilter);
            this.bus.gain.setTargetAtTime(1, now + 0.12, 0.1);
            this.style.setup?.(this, this.bus);
            const d = 60 / this.style.bpm / 4;
            this.stepK = Math.ceil((now + 0.05 - this.epoch) / d); // shared epoch: stations "keep playing" while you're away
            this.nextT = this.epoch + this.stepK * d;
        }
        if (!this.timer && (key || this.retire.length)) this.timer = setInterval(() => this.tick(), TICK_MS);
    },

    tick() {
        const ctx = this.ctx;
        if (!ctx || ctx.state !== 'running') return; // paused / hidden: never fire stacked notes later
        const now = ctx.currentTime;
        for (let i = this.retire.length - 1; i >= 0; i--) {
            const r = this.retire[i];
            if (r.at > now) continue;
            for (const n of r.rs.nodes || []) {
                try {
                    n.stop?.();
                } catch {
                    /* already stopped */
                }
                n.disconnect();
            }
            r.bus.disconnect();
            this.retire.splice(i, 1);
        }
        if (!this.station) {
            if (!this.retire.length) {
                clearInterval(this.timer);
                this.timer = null;
            }
            return;
        }
        if (!this.enabled) return;
        const d = 60 / this.style.bpm / 4;
        if (this.nextT < now - 0.05) {
            // main thread stalled: skip ahead instead of dumping the backlog at once
            this.stepK = Math.ceil((now - this.epoch) / d);
            this.nextT = this.epoch + this.stepK * d;
        }
        while (this.nextT < now + AHEAD) {
            this.style.step(this, this.stepK, this.nextT, d);
            this.stepK++;
            this.nextT = this.epoch + this.stepK * d;
        }
    },

    // Squelch click -> dispatcher syllables -> squelch tail, all inside the walkie 400-2400Hz band
    chatter(t) {
        const v = this.voiceOn(this.bus, t);
        const n = 2 + Math.floor(Math.random() * 4);
        const pitch = pick([95, 115, 175]);
        this.noise(v, { ftype: 'bandpass', freq: 2000, Q: 1, dur: 0.03, gain: 0.09 });
        this.noise(v, { ftype: 'bandpass', freq: 1200, Q: 0.8, dur: n * 0.14, at: 0.04, gain: 0.02 });
        for (let i = 0; i < n; i++) {
            const f = pitch * (0.9 + Math.random() * 0.3);
            this.formant(v, {
                f0: f,
                f1: f * (0.8 + Math.random() * 0.4),
                dur: 0.1,
                at: 0.05 + i * 0.14,
                gain: 0.07,
                vowel: pick(VOWELS)
            });
        }
        this.noise(v, { ftype: 'bandpass', freq: 1800, Q: 1, dur: 0.04, at: 0.07 + n * 0.14, gain: 0.07 });
    },

    // Wanted level changed / crime committed: the scanner reacts
    dispatch() {
        if (!this.ctx || this.style !== STYLES.scanner || this.ctx.state !== 'running') return;
        const now = this.ctx.currentTime;
        if (now - this.lastDispatch < 1.5) return;
        this.lastDispatch = now;
        this.chatter(now + 0.05);
    }
};
