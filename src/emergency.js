import { driveAICarToward, flowTarget } from './ai.js';
import { audio } from './audio.js';
import { angleToRoadDir, buildFlowField, hasDriveLine, isSolidAt, normalizeAngle, pickRoadSpawnNear } from './city.js';
import { MAP_SIZE } from './config.js';
import { createCar, spawnLawPed } from './entities.js';
import { PUNK_HAIR, SHIRT_COLORS, pedLook } from './palette.js';
import { camera, cars, decals, emergency, particles, peds, player } from './state.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const newField = () => Array.from({ length: MAP_SIZE }, () => new Float32Array(MAP_SIZE));
const AMBULANCE_SPEED = 260 * 1.15; // reckless: 1.15x traffic pace
const FIRETRUCK_SPEED = 260 * 1.1;
const SPRAY_RANGE = 260;

function puff(x, y, color, n = 1, rise = 40) {
    for (let i = 0; i < n; i++) {
        particles.push({
            x: x + (Math.random() - 0.5) * 8,
            y: y + (Math.random() - 0.5) * 8,
            vx: (Math.random() - 0.5) * 24,
            vy: -rise * (0.4 + Math.random() * 0.8),
            size: 2 + ((Math.random() * 3) | 0),
            square: true,
            color,
            life: 0.5,
            maxLife: 0.5
        });
    }
}

function drive(c, r, tx, ty, speed, dt) {
    r.flowT -= dt;
    if (r.flowT <= 0) {
        r.flowT = 0.5;
        buildFlowField(r.flow, tx, ty);
    }
    let gx = tx;
    let gy = ty;
    if (!(Math.hypot(tx - c.x, ty - c.y) < 320 && hasDriveLine(c.x, c.y, tx, ty))) {
        const t = flowTarget(c, r.flow);
        gx = t.x;
        gy = t.y;
    }
    driveAICarToward(c, gx, gy, speed, dt);
}

function finishRescue(c) {
    c.aiMode = 'traffic';
    c.sirenOn = false;
    c.rescue = null;
    c.roadDir = c.nextRoadDir = angleToRoadDir(c.angle);
    c.intersectKey = -1;
}

// --- DISPATCH ---
function dispatchAmbulance() {
    const live = emergency.casualties.filter((q) => !q.claimed);
    for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
            const a = live[i];
            const b = live[j];
            if (Math.hypot(a.x - b.x, a.y - b.y) > 400 || Math.hypot(a.x - player.x, a.y - player.y) > 2000) continue;
            const spot = pickRoadSpawnNear(a.x, a.y, 700, 1100);
            if (!spot) return;
            const c = createCar('ambulance', spot.x, spot.y, spot.angle, 'rescue');
            c.rescue = {
                kind: 'ambulance',
                state: 'drive',
                targets: [a, b],
                flow: newField(),
                flowT: 0,
                age: 0,
                t: 0,
                medics: []
            };
            cars.push(c);
            a.claimed = b.claimed = true;
            emergency.ambulanceCd = 35;
            return;
        }
    }
}

function dispatchFireTruck() {
    let best = null;
    let bestD = 1500;
    for (const w of cars) {
        if (w.hp > 0 || w.sunk || w.burnT < 5) continue;
        const d = Math.hypot(w.x - player.x, w.y - player.y);
        if (d < bestD) {
            bestD = d;
            best = w;
        }
    }
    if (!best) return;
    const spot = pickRoadSpawnNear(best.x, best.y, 800, 1300);
    if (!spot) return;
    const c = createCar('firetruck', spot.x, spot.y, spot.angle, 'rescue');
    c.rescue = { kind: 'fire', state: 'drive', target: best, flow: newField(), flowT: 0, age: 0, hornT: 0 };
    cars.push(c);
    emergency.fireCd = 40;
    audio.airHorn(c.x, c.y);
}

// Burning wrecks: flames + smoke near the camera, and they eventually burn out
function updateWrecks(dt) {
    for (const w of cars) {
        if (w.hp > 0 || w.burnT <= 0 || w.sunk) continue;
        w.burnT -= dt;
        if (Math.abs(w.x - camera.x) > 900 || Math.abs(w.y - camera.y) > 700) continue;
        if (Math.random() < 0.6) puff(w.x, w.y, Math.random() < 0.5 ? '#ff8a2a' : '#ffd400', 1, 50);
        if (Math.random() < 0.3) puff(w.x, w.y - 6, '#52525b', 1, 30);
    }
}

export function updateEmergency(dt) {
    emergency.ambulanceCd -= dt;
    emergency.fireCd -= dt;
    for (let i = emergency.casualties.length - 1; i >= 0; i--) {
        const q = emergency.casualties[i];
        q.age += dt;
        if (q.age > 30 || q.claimed) emergency.casualties.splice(i, 1);
    }
    updateWrecks(dt);

    emergency.scanT = (emergency.scanT || 0) - dt;
    if (emergency.scanT > 0) return;
    emergency.scanT = 0.5;
    if (emergency.ambulanceCd <= 0 && !cars.some((c) => c.typeKey === 'ambulance' && c.aiMode === 'rescue')) {
        dispatchAmbulance();
    }
    if (emergency.fireCd <= 0 && !cars.some((c) => c.typeKey === 'firetruck' && c.aiMode === 'rescue')) {
        dispatchFireTruck();
    }
}

// --- AI-DRIVEN EMERGENCY VEHICLES ---
export function updateRescueCarAI(c, dt) {
    const r = c.rescue;
    if (!r) return finishRescue(c);
    r.age += dt;
    if (r.age > 90) {
        for (const p of r.medics || []) p.hp = 0;
        return finishRescue(c);
    }
    if (r.kind === 'ambulance') ambulanceAI(c, r, dt);
    else fireAI(c, r, dt);
}

function ambulanceAI(c, r, dt) {
    const t = r.targets[0];
    const d = Math.hypot(t.x - c.x, t.y - c.y);
    if (r.state === 'drive') {
        // Reckless: it does not brake for crowds, so it sometimes flattens an unlucky jaywalker
        drive(c, r, t.x, t.y, AMBULANCE_SPEED, dt);
        if (d < 95) r.state = 'stop';
    } else if (r.state === 'stop') {
        driveAICarToward(c, c.x + Math.cos(c.angle) * 50, c.y + Math.sin(c.angle) * 50, 0, dt);
        if (c.speed < 25) {
            r.state = 'work';
            r.t = 0;
            r.targets.forEach((tg, i) => {
                const side = i % 2 === 0 ? 1 : -1;
                const a = c.angle + (Math.PI / 2) * side;
                let x = c.x + Math.cos(a) * (c.spec.w * 0.9 + 12);
                let y = c.y + Math.sin(a) * (c.spec.w * 0.9 + 12);
                if (isSolidAt(x, y, 8)) {
                    x = c.x;
                    y = c.y;
                }
                r.medics.push(
                    spawnLawPed('medic', x, y, a, { job: { target: tg, state: 'walk', t: 0, ttl: 40, car: c } })
                );
            });
            audio.door(c);
        }
    } else {
        driveAICarToward(c, c.x, c.y, 0, dt);
        r.t += dt;
        if (r.medics.every((p) => p.hp <= 0 || p.job?.done) || r.t > 25) {
            for (const p of r.medics) p.hp = 0;
            finishRescue(c);
        }
    }
}

function fireAI(c, r, dt) {
    const w = r.target;
    if (!w || w.burnT <= 0 || w.sunk) {
        // Fire is out: roll on to a neighbouring blaze, otherwise head home
        const next = cars.find((o) => o.hp <= 0 && !o.sunk && o.burnT > 2 && Math.hypot(o.x - c.x, o.y - c.y) < 600);
        if (!next) return finishRescue(c);
        r.target = next;
        r.state = 'drive';
        return;
    }
    const d = Math.hypot(w.x - c.x, w.y - c.y);
    if (r.state === 'drive') {
        r.hornT -= dt;
        if (r.hornT <= 0) {
            r.hornT = 5;
            audio.airHorn(c.x, c.y);
        }
        drive(c, r, w.x, w.y, FIRETRUCK_SPEED, dt);
        if (d < 180 && hasDriveLine(c.x, c.y, w.x, w.y)) r.state = 'spray';
    } else {
        driveAICarToward(c, c.x, c.y, 0, dt);
        if (d > 240) r.state = 'drive';
        else if (Math.abs(normalizeAngle(c.targetAngle - c.turretAngle)) < 0.2) sprayWater(c, dt);
    }
}

// --- MEDICS ---
function walkToward(p, tx, ty, dt) {
    const a = Math.atan2(ty - p.y, tx - p.x);
    p.angle = a;
    const nx = p.x + Math.cos(a) * p.speed * dt;
    const ny = p.y + Math.sin(a) * p.speed * dt;
    if (!isSolidAt(nx, p.y, 8)) p.x = nx;
    if (!isSolidAt(p.x, ny, 8)) p.y = ny;
}

export function updateMedic(p, dt) {
    const j = p.job;
    if (!j || (j.ttl -= dt) <= 0) {
        p.hp = 0;
        if (j) j.done = true;
        return;
    }
    const t = j.target;
    if (j.state === 'walk') {
        walkToward(p, t.x, t.y, dt);
        if (Math.hypot(t.x - p.x, t.y - p.y) < 16) {
            j.state = 'work';
            j.t = 0;
        }
    } else if (j.state === 'work') {
        // Crouch over the victim: defibrillator zap, then they get back up
        j.t += dt;
        p.angle = Math.atan2(t.y - p.y, t.x - p.x);
        if (j.t > 1.3 && !j.zapped) {
            j.zapped = true;
            audio.defib(t.x, t.y);
            puff(t.x, t.y, '#7dd3fc', 8, 60);
            puff(t.x, t.y, '#ffffff', 4, 80);
        }
        if (j.t > 2) {
            const i = decals.indexOf(t.decal);
            if (i >= 0) decals.splice(i, 1);
            peds.push({
                x: t.x,
                y: t.y,
                angle: Math.random() * Math.PI * 2,
                speed: 46,
                color: pick(SHIRT_COLORS),
                role: 'civilian',
                ...pedLook('civilian', Math.random() < 0.1 ? PUNK_HAIR : null),
                hp: 25,
                panicTimer: 2,
                shootTimer: 0.6
            });
            j.state = 'return';
        }
    } else {
        walkToward(p, j.car.x, j.car.y, dt);
        if (Math.hypot(j.car.x - p.x, j.car.y - p.y) < 44) {
            p.hp = 0;
            j.done = true;
        }
    }
}

// --- FIRE TRUCK WATER CANNON ---
// A pressurised jet along the turret: extinguishes wrecks, flings pedestrians and light cars, never adds heat
export function sprayWater(c, dt) {
    const a = c.turretAngle;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const tx = c.x + ca * 16;
    const ty = c.y + sa * 16;
    audio.hoseAt(tx, ty);
    for (let i = 0; i < 4; i++) {
        const sp = 360 + Math.random() * 120;
        const jit = a + (Math.random() - 0.5) * 0.12;
        particles.push({
            x: tx,
            y: ty,
            vx: Math.cos(jit) * sp + c.vx * 0.3,
            vy: Math.sin(jit) * sp + c.vy * 0.3,
            size: 2 + ((Math.random() * 2) | 0),
            square: true,
            color: pick(['#ffffff', '#bfeaff', '#7dd3fc', '#e0f7ff']),
            life: 0.6,
            maxLife: 0.6
        });
    }
    const along = (x, y) => (x - tx) * ca + (y - ty) * sa;
    const across = (x, y) => Math.abs(-(x - tx) * sa + (y - ty) * ca);
    for (const p of peds) {
        const al = along(p.x, p.y);
        if (al > 0 && al < SPRAY_RANGE && across(p.x, p.y) < 20 + al * 0.06) {
            p.kbx = ca * 240;
            p.kby = sa * 240;
            p.panicTimer = Math.max(p.panicTimer || 0, 3);
        }
    }
    for (const o of cars) {
        if (o === c) continue;
        const al = along(o.x, o.y);
        if (al < 0 || al > SPRAY_RANGE || across(o.x, o.y) > o.spec.w * 0.7 + al * 0.05) continue;
        if (o.hp <= 0) {
            if (o.burnT > 0) {
                o.burnT -= 3 * dt;
                puff(o.x, o.y, '#d4d4d8', 1, 40);
                if (o.burnT <= 0) puff(o.x, o.y, '#f4f4f5', 10, 60);
            }
        } else if (o.spec.mass <= 1.2) {
            o.vx += ca * 520 * dt;
            o.vy += sa * 520 * dt;
            o.angle += Math.sign(-(o.x - tx) * sa + (o.y - ty) * ca) * 2.2 * dt;
        }
    }
}
