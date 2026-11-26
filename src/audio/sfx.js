// --- ONE-SHOT SOUND EFFECTS: every recipe is oscillators + the shared noise buffer ---
import { VOWELS, clamp } from './core.js';

// Horn voicings per car class (two-tone chords; vans get an air horn, the tank a klaxon)
const HORNS = {
    hellcrab: { a: 659, b: 831, type: 'square', dur: 0.34, lp: 3400, gain: 0.05 },
    bumbler: { a: 340, b: 425, type: 'sawtooth', dur: 0.2, lp: 2200, gain: 0.06 },
    cabbie: { a: 400, b: 500, type: 'sawtooth', dur: 0.24, lp: 2400, gain: 0.06 },
    blitz: { a: 311, b: 392, type: 'sawtooth', dur: 0.3, lp: 1800, gain: 0.07 },
    van: { a: 185, b: 233, type: 'sawtooth', dur: 0.5, lp: 900, gain: 0.1 },
    hauler: { a: 156, b: 196, type: 'sawtooth', dur: 0.62, lp: 800, gain: 0.11 },
    tank: { a: 140, b: 175, type: 'square', dur: 0.6, lp: 700, gain: 0.08 }
};

export const sfx = {
    door(car) {
        const v = this.voice(car.x, car.y, 700);
        this.noise(v, { freq: 320, dur: 0.14, gain: 0.35 });
        this.tone(v, { type: 'square', f0: 2400, dur: 0.02, at: 0.06, gain: 0.05 });
        this.tone(v, { type: 'square', f0: 1500, dur: 0.03, at: 0.085, gain: 0.04 });
    },

    yelp(x, y) {
        const v = this.voice(x, y, 700);
        this.formant(v, { f0: 380, f1: 620, dur: 0.14, gain: 0.09, vowel: VOWELS[2] });
        this.formant(v, { f0: 640, f1: 400, dur: 0.17, gain: 0.09, vowel: VOWELS[0], at: 0.15 });
    },

    horn(car) {
        const x = car?.x;
        const y = car?.y;
        const v = this.voice(x, y, 1000);
        if (car?.spec.isPolice) {
            this.tone(v, { type: 'sawtooth', f0: 680, f1: 960, dur: 0.24, gain: 0.07, freq: 3000 });
            return;
        }
        const h = HORNS[car?.typeKey] || HORNS.bumbler;
        for (const f of [h.a, h.b]) {
            this.tone(v, {
                type: h.type,
                f0: f,
                dur: h.dur,
                hold: h.dur * 0.6,
                gain: h.gain,
                freq: h.lp,
                attack: 0.01
            });
        }
    },

    crash(x, y, force = 200) {
        const k = clamp((force - 100) / 400, 0.25, 1);
        const v = this.voice(x, y, 1100);
        this.noise(v, { ftype: 'bandpass', freq: 1800, Q: 1.2, dur: 0.18 + 0.2 * k, gain: 0.28 * k });
        this.tone(v, { type: 'square', f0: 95, f1: 38, dur: 0.14 + 0.14 * k, gain: 0.22 * k });
        this.tone(v, { type: 'triangle', f0: 620, f1: 240, dur: 0.1, at: 0.02, gain: 0.07 * k, freq: 2400 });
    },

    thump(x, y) {
        const v = this.voice(x, y, 700);
        this.tone(v, { type: 'sine', f0: 120, f1: 50, dur: 0.12, gain: 0.22 });
        this.noise(v, { freq: 420, dur: 0.09, gain: 0.12 });
    },

    rustle(x, y) {
        const v = this.voice(x, y, 650);
        this.noise(v, { ftype: 'highpass', freq: 3000, dur: 0.18, gain: 0.06, attack: 0.02 });
        this.noise(v, { ftype: 'highpass', freq: 4500, dur: 0.1, at: 0.06, gain: 0.04 });
    },

    snap(x, y) {
        const v = this.voice(x, y, 650);
        this.noise(v, { ftype: 'bandpass', freq: 1200, Q: 4, dur: 0.06, gain: 0.16 });
        this.tone(v, { type: 'triangle', f0: 140, f1: 60, dur: 0.1, gain: 0.1 });
    },

    shoot(idx, x, y) {
        const v = this.voice(x, y, 1100);
        if (idx === 0) {
            this.noise(v, { ftype: 'bandpass', freq: 900, dur: 0.08, gain: 0.1 });
            this.tone(v, { type: 'sine', f0: 140, f1: 60, dur: 0.08, gain: 0.15 });
        } else if (idx === 1) {
            this.noise(v, { ftype: 'highpass', freq: 1800, dur: 0.07, gain: 0.2 });
            this.tone(v, { type: 'sine', f0: 900, f1: 120, dur: 0.1, gain: 0.2 });
        } else if (idx === 2) {
            this.noise(v, { ftype: 'highpass', freq: 2600, dur: 0.05, gain: 0.14 });
            this.tone(v, { type: 'sine', f0: 1100, f1: 180, dur: 0.07, gain: 0.12 });
        } else {
            this.noise(v, { freq: 1400, freq1: 200, dur: 0.4, gain: 0.2 });
            this.tone(v, { type: 'sawtooth', f0: 220, f1: 50, dur: 0.3, gain: 0.12, freq: 900 });
            this.tone(v, { type: 'sine', f0: 110, f1: 30, dur: 0.4, gain: 0.3 });
        }
    },

    impact(x, y, kind) {
        const v = this.voice(x, y, 600);
        if (kind === 'flesh') this.noise(v, { freq: 500, dur: 0.07, gain: 0.1 });
        else if (kind === 'metal') {
            this.tone(v, { type: 'square', f0: 700, f1: 500, dur: 0.06, gain: 0.05, freq: 3000 });
            this.noise(v, { ftype: 'bandpass', freq: 2500, dur: 0.04, gain: 0.08 });
        } else {
            this.tone(v, { type: 'triangle', f0: 1800, f1: 900, dur: 0.05, gain: 0.04 });
            this.noise(v, { ftype: 'bandpass', freq: 3000, dur: 0.04, gain: 0.07 });
        }
    },

    explosion(x, y, big = false) {
        const m = big ? 1.4 : 1;
        const v = this.voice(x, y, 1700, m);
        this.tone(v, { type: 'sine', f0: 110, f1: 22, dur: 1.0 * m, glide: 0.9 * m, gain: 0.55 });
        this.noise(v, { drive: true, freq: 500, freq1: 120, fdur: 1.1 * m, dur: 1.3 * m, gain: 0.45, attack: 0.01 });
        for (let i = 0; i < 6; i++) {
            this.noise(v, {
                ftype: 'highpass',
                freq: 4500,
                dur: 0.03,
                at: 0.1 + Math.random() * 0.6 * m,
                gain: 0.07 + Math.random() * 0.06
            });
        }
    },

    // Heavy retro splash: low thud, lowpass plunge, bandpassed spray, then rising bubble blips
    splash(x, y, heavy = true) {
        const m = heavy ? 1 : 0.55;
        const v = this.voice(x, y, 1200, m);
        this.tone(v, { type: 'sine', f0: 140, f1: 38, dur: 0.28 * (0.6 + m * 0.4), gain: 0.4 });
        this.noise(v, { ftype: 'lowpass', freq: 1600, freq1: 220, fdur: 0.5, dur: 0.55, gain: 0.34, attack: 0.012 });
        this.noise(v, { ftype: 'bandpass', freq: 3200, freq1: 1400, Q: 0.9, dur: 0.4, at: 0.04, gain: 0.16 });
        for (let i = 0; i < (heavy ? 5 : 3); i++) {
            const f = 380 + Math.random() * 260;
            this.tone(v, {
                type: 'sine',
                f0: f,
                f1: f * 2.1,
                dur: 0.07,
                at: 0.3 + i * 0.075 + Math.random() * 0.03,
                gain: 0.05,
                freq: 2400,
                Q: 6
            });
        }
    },

    // Suspension compression thud + brief tire chirp
    landing(x, y, force = 300) {
        const k = clamp((force - 120) / 360, 0.3, 1);
        const v = this.voice(x, y, 1100);
        this.tone(v, { type: 'sine', f0: 95, f1: 32, dur: 0.22, gain: 0.5 * k });
        this.noise(v, { ftype: 'bandpass', freq: 900, dur: 0.16, gain: 0.3 * k });
        this.tone(v, { type: 'square', f0: 70, f1: 40, dur: 0.12, gain: 0.12 * k, freq: 500 });
        this.noise(v, { ftype: 'bandpass', freq: 1700, Q: 7, dur: 0.12, at: 0.05, gain: 0.1 * k });
    },

    // Steel expansion joint under the tires: thud-thud
    jointThud(x, y) {
        const v = this.voice(x, y, 500);
        this.tone(v, { type: 'sine', f0: 62, f1: 40, dur: 0.1, gain: 0.16 });
        this.tone(v, { type: 'sine', f0: 56, f1: 36, dur: 0.1, at: 0.085, gain: 0.12 });
        this.noise(v, { ftype: 'lowpass', freq: 320, dur: 0.06, gain: 0.08 });
    },

    // 90s arcade stab: power chord, then a rising arpeggio
    stuntFanfare() {
        const v = this.voice();
        for (const f of [262, 330, 392]) {
            this.tone(v, { type: 'sawtooth', f0: f, dur: 0.34, hold: 0.18, gain: 0.05, freq: 2600 });
            this.tone(v, { type: 'square', f0: f * 2, dur: 0.3, hold: 0.14, gain: 0.025, freq: 3200 });
        }
        [523, 659, 784, 1047, 1319].forEach((f, i) =>
            this.tone(v, { type: 'square', f0: f, dur: 0.14, at: 0.3 + i * 0.075, gain: 0.05, freq: 3600 })
        );
        this.tone(v, { type: 'sawtooth', f0: 1568, dur: 0.5, at: 0.72, hold: 0.2, gain: 0.05, freq: 3600 });
        this.tone(v, { type: 'triangle', f0: 131, dur: 0.9, at: 0.3, hold: 0.4, gain: 0.12 });
    },

    bombBeep(x, y) {
        this.tone(this.voice(x, y, 900), { type: 'square', f0: 1200, dur: 0.07, gain: 0.07 });
    },

    shutter(x, y) {
        const v = this.voice(x, y, 800);
        this.noise(v, { freq: 900, dur: 0.9, hold: 0.6, gain: 0.14, am: { rate: 18, depth: 0.8 } });
        this.tone(v, { type: 'sawtooth', f0: 70, f1: 92, dur: 0.9, gain: 0.05, freq: 220 });
    },

    spray(x, y) {
        const v = this.voice(x, y, 800);
        for (const at of [0, 0.45, 0.9]) {
            this.noise(v, { ftype: 'highpass', freq: 6000, dur: 0.3, at, gain: 0.07, attack: 0.02 });
        }
    },

    ratchet(x, y) {
        const v = this.voice(x, y, 800);
        for (let i = 0; i < 7; i++)
            this.tone(v, { type: 'square', f0: 190, f1: 120, dur: 0.04, at: i * 0.08, gain: 0.05 });
    },

    // cheerful "all fixed" arpeggio
    chime() {
        const v = this.voice();
        [1047, 1319, 1568, 2093].forEach((f, i) =>
            this.tone(v, { type: 'triangle', f0: f, dur: 0.16, at: i * 0.07, gain: 0.07 })
        );
    },

    // noise "cha", bell, then a rising coin arpeggio
    cashRegister() {
        const v = this.voice();
        this.noise(v, { ftype: 'highpass', freq: 3000, dur: 0.07, gain: 0.1 });
        this.tone(v, { type: 'sine', f0: 1568, dur: 0.45, at: 0.05, gain: 0.08 });
        this.tone(v, { type: 'sine', f0: 2093, dur: 0.45, at: 0.05, gain: 0.05 });
        [1319, 1760, 2349].forEach((f, i) =>
            this.tone(v, { type: 'square', f0: f, dur: 0.12, at: 0.14 + i * 0.06, gain: 0.04 })
        );
    },

    cash() {
        this.cashRegister();
    },

    pickup() {
        const v = this.voice();
        this.tone(v, { type: 'square', f0: 880, f1: 1320, dur: 0.09, gain: 0.06 });
        this.tone(v, { type: 'square', f0: 1320, f1: 1760, dur: 0.12, at: 0.065, gain: 0.06 });
    },

    buzzer(x, y) {
        const v = this.voice(x, y, 800);
        this.tone(v, { type: 'square', f0: 130, dur: 0.22, gain: 0.08, freq: 900 });
        this.tone(v, { type: 'square', f0: 130, dur: 0.22, at: 0.3, gain: 0.08, freq: 900 });
    },

    pager() {
        const v = this.voice();
        this.tone(v, { type: 'square', f0: 2400, dur: 0.06, gain: 0.035 });
        this.tone(v, { type: 'square', f0: 2400, dur: 0.06, at: 0.12, gain: 0.035 });
    },

    // 20Hz mechanical bell trill
    phoneRing(x, y) {
        const v = this.voice(x, y, 700);
        const am = { rate: 20, depth: 1 };
        this.tone(v, { type: 'sine', f0: 950, dur: 1.2, hold: 1.1, gain: 0.06, am });
        this.tone(v, { type: 'sine', f0: 1180, dur: 1.2, hold: 1.1, gain: 0.05, am });
        this.tone(v, { type: 'sine', f0: 2560, dur: 1.2, hold: 1.1, gain: 0.015, am });
    }
};
