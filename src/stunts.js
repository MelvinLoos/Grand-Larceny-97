import { audio } from './audio.js';
import { triggerWastedOrBusted } from './combat.js';
import { CAR_H, GRAVITY, LAUNCH_K, MIN_LAUNCH_SPEED, SINK_TIME, STUNT_MIN_DIST, SWIM_TIME, TILE } from './config.js';
import { pickRoadSpawnNear } from './city.js';
import { getDistrictAt } from './districts.js';
import { addCar, createCar, pickCarType } from './entities.js';
import { buzz } from './haptics.js';
import { addScore, showBigBanner } from './hud.js';
import { HAZARD } from './palette.js';
import { RIVER, surfaceAt } from './river.js';
import { camera, cars, particles, peds, player } from './state.js';

const FISHES = 'SLEEPING WITH THE FISHES';

// --- SPLASH: expanding foam rings + droplets + the synthesized plunge ---
export function splashAt(x, y, heavy = true) {
    audio.splash(x, y, heavy);
    const n = heavy ? 2 : 1;
    for (let i = 0; i < n; i++) {
        particles.push({
            x,
            y,
            vx: 0,
            vy: 0,
            size: 4 + i * 3,
            grow: (heavy ? 78 : 40) - i * 14,
            ring: true,
            color: i ? '#7fd6e6' : '#f2f8f6',
            life: 0.75 + i * 0.2,
            maxLife: 0.75 + i * 0.2
        });
    }
    for (let i = 0, k = heavy ? 20 : 9; i < k; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 50 + Math.random() * (heavy ? 190 : 110);
        particles.push({
            x,
            y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 24,
            size: 2 + ((Math.random() * 3) | 0),
            square: true,
            drag: 2.4,
            amp: 0,
            phase: 0,
            color: Math.random() < 0.55 ? '#f2f8f6' : '#7fd6e6',
            life: 0.45 + Math.random() * 0.35,
            maxLife: 0.8
        });
    }
}

// A breakable bollard / sawhorse goes down: splinters and a snap
export function breakBarrier(b) {
    b.broken = true;
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    audio.snap(cx, cy);
    const cols = b.kind === 'sawhorse' ? ['#e8731f', '#f4efe0'] : ['#8b5a45', '#c89a6a'];
    for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 70 + Math.random() * 190;
        particles.push({
            x: cx + (Math.random() - 0.5) * (b.x1 - b.x0),
            y: cy + (Math.random() - 0.5) * (b.y1 - b.y0),
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            size: 3 + ((Math.random() * 3) | 0),
            square: true,
            color: cols[i & 1],
            life: 0.5,
            maxLife: 0.5
        });
    }
}

function startSink(c) {
    c.airborne = false;
    c.vz = 0;
    c.z = 0;
    c.jump = null;
    c.sink = 0.001;
    c.sirenOn = false;
    c.onBridge = false;
    c.throttle = 0;
    c.slip = 0;
    c.handbrake = false;
    splashAt(c.x, c.y, true);
}

function updateSink(c, dt) {
    const k = Math.max(0, 1 - 4.5 * dt);
    c.vx *= k;
    c.vy *= k;
    c.speed = Math.hypot(c.vx, c.vy);
    c.sink += dt / SINK_TIME;
    // The driver holds their breath for the whole plunge: the bar empties exactly as the car goes under
    if (player.inCar === c) showBreath(Math.max(0, 1 - c.sink));
    if (Math.random() < dt * 14) {
        particles.push({
            x: c.x + (Math.random() - 0.5) * c.spec.w,
            y: c.y + (Math.random() - 0.5) * c.spec.l * 0.6,
            vx: (Math.random() - 0.5) * 14,
            vy: -26 - Math.random() * 22,
            size: 2 + ((Math.random() * 2) | 0),
            square: true,
            color: Math.random() < 0.5 ? '#f2f8f6' : '#9fe2ee',
            life: 0.7,
            maxLife: 0.7
        });
    }
    if (c.sink >= 1) {
        c.sunk = true;
        c.hp = 0;
        c.driver = false;
        if (player.inCar === c) triggerWastedOrBusted('WASTED!', FISHES);
    }
}

// Per car, after XY integration: surface following, ramp launch, flight, landing, plunging
export function updateCarVertical(c, dt) {
    if (c.sink > 0) return updateSink(c, dt);
    const s = surfaceAt(c.x, c.y);

    if (c.airborne) {
        // Ran into the face of the far ramp: bounce off and drop into the river
        if (!s.water && s.z > c.z + 10) {
            c.x -= c.vx * dt;
            c.y -= c.vy * dt;
            c.vx *= 0.25;
            c.vy *= 0.25;
            audio.crash(c.x, c.y, 420);
            c.hp -= 12;
            if (c === player.inCar) camera.shake = Math.max(camera.shake, 10);
        }
        c.vz -= GRAVITY * dt;
        c.z += c.vz * dt;
        const drag = Math.max(0, 1 - 0.18 * dt);
        c.vx *= drag;
        c.vy *= drag;
        c.angle += c.spin * dt;
        c.speed = Math.hypot(c.vx, c.vy);
        const j = c.jump;
        if (j) {
            j.maxH = Math.max(j.maxH, c.z);
            j.rot += Math.abs(c.spin) * dt;
        }
        const here = surfaceAt(c.x, c.y);
        if (c.z <= here.z) land(c, here);
        return;
    }

    // Grounded
    if (c.z - s.z > 8) {
        // Rolled off a lip: a real launch when coming off a ramp at speed
        const fwd = c.vx * Math.cos(c.angle) + c.vy * Math.sin(c.angle);
        const lat = -c.vx * Math.sin(c.angle) + c.vy * Math.cos(c.angle);
        c.airborne = true;
        c.vz = c.onRamp && fwd > MIN_LAUNCH_SPEED ? LAUNCH_K * fwd : 0;
        c.spin = Math.max(-1.2, Math.min(1.2, lat / 400));
        c.jump = { sx: c.x, sy: c.y, maxH: c.z, rot: 0, fromRamp: !!c.onRamp, west: c.x < (RIVER.x0 + 1.5) * TILE };
        c.onRamp = false;
        c.onBridge = false;
        return;
    }
    if (s.water) {
        startSink(c);
        return;
    }
    c.z = s.z;
    c.onBridge = s.deck;
    c.onRamp = s.ramp;
}

function land(c, s) {
    const impact = -c.vz;
    const j = c.jump;
    c.airborne = false;
    c.vz = 0;
    c.spin = 0;
    c.z = s.z;
    c.jump = null;
    if (s.water) {
        startSink(c);
        return;
    }
    c.onBridge = s.deck;
    c.onRamp = s.ramp;
    audio.landing(c.x, c.y, impact);
    for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 60 + Math.random() * 180;
        particles.push({
            x: c.x + Math.cos(a) * c.spec.w * 0.4,
            y: c.y + Math.sin(a) * c.spec.l * 0.3,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            size: 2 + ((Math.random() * 2) | 0),
            square: true,
            color: i % 3 === 0 ? '#ffd400' : i % 2 ? '#ff8a2a' : '#f4efe0',
            life: 0.3,
            maxLife: 0.3
        });
    }
    if (impact > 420) c.hp -= (impact - 420) * 0.12;
    if (c !== player.inCar || !j) return;

    camera.shake = Math.max(camera.shake, 12);
    buzz([40, 30, 60]);
    const dist = Math.hypot(c.x - j.sx, c.y - j.sy);
    if (dist < STUNT_MIN_DIST) return;
    const farLip = j.west ? (RIVER.x1 + 0.5) * TILE : (RIVER.x0 + 0.5) * TILE;
    const crossed = j.fromRamp && (j.west ? c.x >= farLip : c.x <= farLip);
    if (crossed) {
        const total = Math.round(5000 * player.multiplier);
        addScore(5000, c.x, c.y - 30, 'INSANE STUNT BONUS!');
        showBigBanner('INSANE STUNT BONUS!', `+$${total.toLocaleString('en-US')}`, HAZARD);
        audio.stuntFanfare();
    } else {
        const raw = 500 + (dist - STUNT_MIN_DIST) * 6 + j.maxH * 8 + j.rot * 500;
        const amount = Math.min(4000, Math.max(500, Math.round(raw / 100) * 100));
        const total = Math.round(amount * player.multiplier);
        addScore(amount, c.x, c.y - 30, 'STUNT JUMP!');
        showBigBanner('STUNT JUMP!', `+$${total.toLocaleString('en-US')}`, HAZARD);
        audio.cash();
    }
}

// Two cars only touch when their heights overlap; a sinking car is out of play
export const sameLevel = (a, b) => a.sink === 0 && b.sink === 0 && Math.abs(a.z - b.z) <= CAR_H;

// Sunk cars leave the world; traffic is topped back up out of sight
export function reapSunk() {
    for (let i = cars.length - 1; i >= 0; i--) {
        const c = cars[i];
        if (!c.sunk && !c.despawn) continue;
        if (c === player.inCar) continue;
        cars.splice(i, 1);
        if (c.sunk && c.aiMode === 'traffic') {
            const spot = pickRoadSpawnNear(player.x, player.y, 820, 1350);
            if (spot)
                addCar(createCar(pickCarType(getDistrictAt(spot.x, spot.y)), spot.x, spot.y, spot.angle, 'traffic'));
        }
    }
}

// --- ON FOOT IN THE WATER ---
let breathEl = null;
export function showBreath(frac) {
    breathEl ||= document.getElementById('hud-breath');
    if (!breathEl) return;
    const row = breathEl.closest('.breath-row');
    row.hidden = frac === null;
    if (frac !== null) breathEl.style.width = `${Math.max(0, frac) * 100}%`;
}

export function resetSwim() {
    player.swimming = false;
    player.breath = SWIM_TIME;
    showBreath(null);
}

export function updateSwim(dt) {
    const s = surfaceAt(player.x, player.y);
    if (s.water && !s.deck) {
        if (!player.swimming) {
            player.swimming = true;
            player.breath = SWIM_TIME;
            splashAt(player.x, player.y, false);
        }
        // Breath is the ONLY thing water takes: the bar maps 1:1 onto the drowning timer, no HP is drained
        player.breath = Math.max(0, player.breath - dt);
        showBreath(player.breath / SWIM_TIME);
        if (player.breath <= 0) triggerWastedOrBusted('WASTED!', FISHES); // the empty bar stays up under the banner
    } else if (player.swimming) resetSwim();
}

// Pedestrians that end up in the river splash and sink
export function drownPeds() {
    for (const p of peds) {
        if (p.hp <= 0) continue;
        if (surfaceAt(p.x, p.y).water) {
            splashAt(p.x, p.y, false);
            p.hp = 0;
            p.drowned = true;
        }
    }
}
