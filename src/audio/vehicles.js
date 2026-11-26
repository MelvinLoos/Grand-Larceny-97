// --- PERSISTENT LOOPS: player engine, tire screech, doppler sirens, nearby traffic hum ---
// Nodes are built once at unlock; every frame only AudioParams are nudged with setTargetAtTime.
import { isRoadTileType, tileAtWorld } from '../city.js';
import { camera, cars, player } from '../state.js';
import { clamp } from './core.js';

const SOUND_SPEED = 1800; // px/s, for doppler
const SIREN_RANGE = 1100;
const HUM_RANGE = 500;
const SHIFT_BAND = 0.02; // speed-ratio hysteresis so cruising on a shift point never yo-yos the pitch
const EXIT_MUFFLE = 0.3; // seconds the radio stays muffled after bailing out
const RADIO_OPEN = 5500;

const SEDAN = {
    t1: 'sawtooth',
    t2: 'triangle',
    det: 5,
    r2: 1,
    g: [0.4, 0.5, 0.2],
    f0: 48,
    f1: 155,
    gears: 4,
    ft: 'lowpass',
    q: 1.5,
    fm: 6,
    lfo: 0,
    lfod: 0
};
const HEAVY = {
    t1: 'square',
    t2: 'sawtooth',
    det: 0,
    r2: 0.5,
    g: [0.35, 0.3, 0.6],
    f0: 28,
    f1: 85,
    gears: 3,
    ft: 'lowpass',
    q: 2,
    fm: 5,
    lfo: 6,
    lfod: 0.55
};
const PROFILES = {
    sports: {
        t1: 'sawtooth',
        t2: 'sawtooth',
        det: 7,
        r2: 1,
        g: [0.5, 0.5, 0],
        f0: 65,
        f1: 240,
        gears: 4,
        ft: 'bandpass',
        q: 3,
        fm: 5,
        lfo: 0,
        lfod: 0
    },
    muscle: {
        t1: 'triangle',
        t2: 'square',
        det: 0,
        r2: 0.5,
        g: [0.6, 0.25, 0.4],
        f0: 38,
        f1: 135,
        gears: 3,
        ft: 'lowpass',
        q: 8,
        fm: 7,
        lfo: 11,
        lfod: 0.45,
        wob: 3
    },
    sedan: SEDAN,
    taxi: SEDAN,
    police: SEDAN,
    truck: HEAVY,
    tank_hull: { ...HEAVY, lfo: 5, lfod: 0.6, tread: true }
};

export const loops = {
    buildLoops(ctx) {
        // Engine: 3 oscillators -> filter -> AM -> out
        const E = (this.eng = {});
        const osc = (type) => {
            const o = ctx.createOscillator();
            o.type = type;
            o.start();
            return o;
        };
        E.o = [osc('sawtooth'), osc('sawtooth'), osc('sine')];
        E.g = E.o.map((o) => {
            const g = ctx.createGain();
            g.gain.value = 0;
            o.connect(g);
            return g;
        });
        E.filter = ctx.createBiquadFilter();
        E.am = ctx.createGain();
        E.out = ctx.createGain();
        E.out.gain.value = 0;
        E.g.forEach((g) => g.connect(E.filter));
        E.filter.connect(E.am);
        E.am.connect(E.out);
        E.out.connect(this.engineGain);
        E.lfo = osc('triangle');
        E.lfoDepth = ctx.createGain();
        E.lfo.connect(E.lfoDepth);
        E.lfoDepth.connect(E.am.gain);
        // uneven pulse: a second LFO wobbles the first one's rate
        E.wob = osc('sine');
        E.wob.frequency.value = 7.3;
        E.wobDepth = ctx.createGain();
        E.wobDepth.gain.value = 0;
        E.wob.connect(E.wobDepth);
        E.wobDepth.connect(E.lfo.frequency);
        // Tank tread clatter
        E.tn = this.noiseSource();
        E.tn.start();
        const tf = ctx.createBiquadFilter();
        tf.type = 'bandpass';
        tf.frequency.value = 2400;
        tf.Q.value = 2;
        E.tAm = ctx.createGain();
        E.tAm.gain.value = 0.5;
        E.tLfo = osc('square');
        E.tLfo.frequency.value = 4;
        const td = ctx.createGain();
        td.gain.value = 0.5;
        E.tLfo.connect(td);
        td.connect(E.tAm.gain);
        E.tg = ctx.createGain();
        E.tg.gain.value = 0;
        E.tn.connect(tf);
        tf.connect(E.tAm);
        E.tAm.connect(E.tg);
        E.tg.connect(this.engineGain);

        // Tire screech: resonant band-passed noise with a pitch wobble
        const S = (this.screech = {});
        S.src = this.noiseSource();
        S.src.start();
        S.bp = ctx.createBiquadFilter();
        S.bp.type = 'bandpass';
        S.bp.frequency.value = 1350;
        S.bp.Q.value = 9;
        S.lfo = osc('sine');
        S.lfo.frequency.value = 3.5;
        const sd = ctx.createGain();
        sd.gain.value = 120;
        S.lfo.connect(sd);
        sd.connect(S.bp.frequency);
        S.gain = ctx.createGain();
        S.gain.gain.value = 0;
        S.src.connect(S.bp);
        S.bp.connect(S.gain);
        S.gain.connect(this.engineGain);

        // Sirens (2 voices) and traffic hum (3 voices), each with its own panner
        const voice = (build) => {
            const g = ctx.createGain();
            g.gain.value = 0;
            const p = ctx.createStereoPanner();
            g.connect(p);
            p.connect(this.sfxGain);
            return { g, p, ...build(g) };
        };
        this.sirens = [0, 1].map(() =>
            voice((g) => {
                const o = osc('square');
                o.frequency.value = 950;
                const lp = ctx.createBiquadFilter();
                lp.frequency.value = 3000;
                o.connect(lp);
                lp.connect(g);
                const lfo = osc('triangle');
                lfo.frequency.value = 0.33;
                const d = ctx.createGain();
                d.gain.value = 300;
                lfo.connect(d);
                d.connect(o.frequency);
                return { o, lfo };
            })
        );
        this.hums = [0, 1, 2].map(() =>
            voice((g) => {
                const o = osc('triangle');
                o.frequency.value = 50;
                const lp = ctx.createBiquadFilter();
                lp.frequency.value = 500;
                o.connect(lp);
                lp.connect(g);
                return { o };
            })
        );

        this.car = null;
        this.gear = 0;
        this.prof = SEDAN;
        this.exitAt = null;
        this._cands = [];
    },

    // Re-voice the engine for a vehicle class
    voiceEngine(car) {
        const P = (this.prof = PROFILES[car.spec.sprite] || SEDAN);
        const E = this.eng;
        E.o[0].type = P.t1;
        E.o[1].type = P.t2;
        E.o[1].detune.value = P.det;
        E.g.forEach((g, i) => (g.gain.value = P.g[i]));
        E.filter.type = P.ft;
        E.filter.Q.value = P.q;
        E.lfo.frequency.value = P.lfo || 1;
        E.lfoDepth.gain.value = (P.lfod || 0) / 2;
        E.am.gain.value = 1 - (P.lfod || 0) / 2;
        E.wobDepth.gain.value = P.wob || 0;
        this.gear = 0;
    },

    updateWorld() {
        const ctx = this.ctx;
        if (!ctx) return;
        const p = player.inCar && player.inCar.hp > 0 && player.deadTimer <= 0 ? player.inCar : null;
        this.setListener(camera.x, camera.y, p ? p.vx : 0, p ? p.vy : 0);
        if (!this.gameActive) return;
        if (p !== this.car) this.carChanged(p);
        if (this.exitAt !== null && ctx.currentTime - this.exitAt >= EXIT_MUFFLE) {
            this.exitAt = null;
            this.setStation(null);
        }
        this.updateEngine(p);
        this.updateScreech(p);
        this.updateSirens();
        this.updateHums();
    },

    carChanged(next) {
        const ctx = this.ctx;
        const now = ctx.currentTime;
        const prev = this.car;
        this.car = next;
        if (prev && !next) {
            this.eng.out.gain.setTargetAtTime(0, now, 0.08);
            this.eng.tg.gain.setTargetAtTime(0, now, 0.08);
            this.screech.gain.gain.setTargetAtTime(0, now, 0.05);
            if (prev.hp <= 0 || player.deadTimer > 0) this.setStation(null);
            else {
                // door still open: radio muffled for 0.3s of context time, then cut
                this.exitAt = now;
                this.radioFilter.frequency.setTargetAtTime(350, now, 0.05);
                this.radioCar.gain.setTargetAtTime(0.25, now, 0.05);
            }
        }
        if (next) {
            // new ride inside the muffle window: cancel the cut, open the radio back up
            this.exitAt = null;
            this.radioFilter.frequency.cancelScheduledValues(now);
            this.radioFilter.frequency.setValueAtTime(RADIO_OPEN, now);
            this.radioCar.gain.cancelScheduledValues(now);
            this.radioCar.gain.setValueAtTime(1, now);
            this.voiceEngine(next);
            this.tuneTo(next.radioStation);
        }
    },

    updateEngine(car) {
        if (!car) return;
        const E = this.eng;
        const P = this.prof;
        const now = this.ctx.currentTime;
        const spd = Math.abs(car.speed || 0);
        const s = clamp(spd / car.spec.maxSpeed, 0, 1.05);
        const G = P.gears;
        // gear with hysteresis band
        let g = this.gear;
        if (s > (g + 1) / G + SHIFT_BAND && g < G - 1) g++;
        else if (s < g / G - SHIFT_BAND && g > 0) g--;
        this.gear = g;
        const thr = clamp(car.throttle || 0, 0, 1);
        const rpm = clamp((s - g / G) * G, 0, 1);
        const r = (0.1 + 0.9 * (0.5 * (g / G) + 0.5 * rpm)) * (0.88 + 0.12 * thr);
        const f = P.f0 + (P.f1 - P.f0) * clamp(r, 0, 1);
        E.o[0].frequency.setTargetAtTime(f, now, 0.04);
        E.o[1].frequency.setTargetAtTime(f * P.r2, now, 0.04);
        E.o[2].frequency.setTargetAtTime(f * 0.5, now, 0.04);
        E.filter.frequency.setTargetAtTime(clamp(f * P.fm * (0.6 + 0.8 * thr), 80, 6000), now, 0.05);
        E.out.gain.setTargetAtTime(0.12 + 0.14 * thr, now, 0.06);
        E.tg.gain.setTargetAtTime(P.tread ? clamp(spd / 160, 0, 1) * 0.14 : 0, now, 0.08);
        if (P.tread) E.tLfo.frequency.setTargetAtTime(3 + spd / 12, now, 0.1);
    },

    updateScreech(car) {
        const S = this.screech;
        const now = this.ctx.currentTime;
        let target = 0;
        if (car && isRoadTileType(tileAtWorld(car.x, car.y))) {
            const spd = car.speed || 0;
            if (car.handbrake && spd > 130) target = 0.7;
            else target = clamp(((car.slip || 0) - 70) / 220, 0, 1);
            S.bp.frequency.setTargetAtTime(1100 + 550 * clamp(spd / 400, 0, 1), now, 0.06);
        }
        S.gain.gain.setTargetAtTime(target * 0.14, now, 0.05);
    },

    updateSirens() {
        const now = this.ctx.currentTime;
        const L = this.listener;
        const c = this._cands;
        c.length = 0;
        for (const car of cars) {
            if (!car.sirenOn || car.hp <= 0) continue;
            const d = Math.hypot(car.x - L.x, car.y - L.y);
            if (d < SIREN_RANGE) c.push({ car, d });
        }
        c.sort((a, b) => a.d - b.d);
        this.sirens.forEach((v, i) => {
            const e = c[i];
            if (!e) return v.g.gain.setTargetAtTime(0, now, 0.08);
            const own = e.car === this.car;
            const s = this.spatialParams(e.car.x, e.car.y, SIREN_RANGE);
            // wail normally, yelp once the cruiser is on top of you
            v.lfo.frequency.setTargetAtTime(!own && e.d < 350 ? 3.2 : 0.33, now, 0.1);
            let det = 0;
            if (!own && e.d > 1) {
                const ux = (L.x - e.car.x) / e.d;
                const uy = (L.y - e.car.y) / e.d;
                const closing = (e.car.vx - L.vx) * ux + (e.car.vy - L.vy) * uy;
                det = 1200 * Math.log2(clamp(SOUND_SPEED / (SOUND_SPEED - closing), 0.8, 1.25));
            }
            v.o.detune.setTargetAtTime(det, now, 0.05);
            v.p.pan.setTargetAtTime(own ? 0 : s.pan, now, 0.05);
            v.g.gain.setTargetAtTime(own ? 0.05 : 0.09 * s.gain, now, 0.05);
        });
    },

    updateHums() {
        const now = this.ctx.currentTime;
        const L = this.listener;
        const c = this._cands;
        c.length = 0;
        for (const car of cars) {
            if (car === this.car || car.hp <= 0 || (car.speed || 0) < 30) continue;
            const d = Math.hypot(car.x - L.x, car.y - L.y);
            if (d < HUM_RANGE) c.push({ car, d });
        }
        c.sort((a, b) => a.d - b.d);
        this.hums.forEach((v, i) => {
            const e = c[i];
            if (!e) return v.g.gain.setTargetAtTime(0, now, 0.1);
            const P = PROFILES[e.car.spec.sprite] || SEDAN;
            const s = this.spatialParams(e.car.x, e.car.y, HUM_RANGE);
            v.o.frequency.setTargetAtTime(
                P.f0 + (P.f1 - P.f0) * clamp(e.car.speed / e.car.spec.maxSpeed, 0, 1),
                now,
                0.1
            );
            v.p.pan.setTargetAtTime(s.pan, now, 0.08);
            v.g.gain.setTargetAtTime(0.07 * s.gain, now, 0.08);
        });
    }
};
