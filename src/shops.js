import { audio } from './audio.js';
import { DIR_VECS, isSolidAt, normalizeAngle } from './city.js';
import { TILE } from './config.js';
import { hideRadio, showBigBanner, spawnFloatingText, updateHUD } from './hud.js';
import { bays, cars, exportBoard, particles, player } from './state.js';

// --- DRIVE-IN GARAGE BAYS ---
// One prefab (a T_BAY tile recessed into a building, shutter on the open side) serves three shops.
export const BAY_INFO = {
    spray: { label: 'SPRAY', name: 'SPRAY-B-GONE', color: '#22e5ff' },
    bomb: { label: 'BOMB', name: 'FUSE BOX BOMBS', color: '#ff5a2a' },
    export: { label: 'EXPORT', name: 'HARBOR EXPORT', color: '#ffd400' }
};

export const SPRAY_COST = 1000;
export const BOMB_COST = 5000;
export const EXPORT_BONUS = 25000;
const NEAR = 1.8 * TILE; // shutter rolls up when an eligible car gets this close
const SERVICE_TIME = 1.5;
const ROLLOUT_TIME = 1.0;
const SHUTTER_SPEED = 1 / 0.35;
const PAINTS = ['#d23a2a', '#3f8f5e', '#2f6db5', '#e0a21b', '#e2559b', '#6b3fa0', '#3d8fb8', '#e2e8f0', '#14130f'];
const MIST = ['#22e5ff', '#ff2bd6', '#ffd400', '#a3e635', '#ffffff'];

// { ok } if the car may be served, otherwise { ok: false, msg }
function check(b, car) {
    const spec = car.spec;
    if (b.type === 'spray') {
        if (spec.isPolice || spec.isTank) return { ok: false, msg: 'TOO HOT TO TOUCH!' };
        if (player.score >= SPRAY_COST) return { ok: true };
        if (car.hp <= car.maxHp * 0.25) return { ok: true, free: true }; // critical: "on the tab"
        return { ok: false, msg: 'NEED $1,000 FOR RESPRAY!' };
    }
    if (b.type === 'bomb') {
        if (car.hasBomb) return { ok: false, msg: 'ALREADY RIGGED!' };
        if (player.score < BOMB_COST) return { ok: false, msg: 'NEED $5,000 FOR A BOMB!' };
        return { ok: true };
    }
    if (spec.isPolice || spec.isTank) return { ok: false, msg: 'NO COPS OR TANKS!' };
    if (!spec.exportValue || car.hp < car.maxHp * 0.25) return { ok: false, msg: 'TOO WRECKED TO EXPORT!' };
    return { ok: true };
}

// Drop the player on foot beside the shed's side door
function ejectBeside(b) {
    const v = DIR_VECS[b.dir];
    for (const side of [1, -1]) {
        const x = b.ex - v.dy * side * TILE * 0.8;
        const y = b.ey + v.dx * side * TILE * 0.8;
        if (!isSolidAt(x, y, 11)) return { x, y };
    }
    return { x: b.ex, y: b.ey };
}

// Runs once at the end of the service sequence; returns true if the car was consumed
function serve(b, car, chk) {
    if (b.type === 'spray') {
        if (!chk.free) {
            player.score -= SPRAY_COST;
            spawnFloatingText('-$1,000', car.x, car.y - 30, '#ffd400');
        }
        car.hp = car.maxHp;
        let c;
        do c = PAINTS[Math.floor(Math.random() * PAINTS.length)];
        while (c === car.color);
        car.color = c;
        // Wanted heads go on probation: lie low for 5s or they all come back
        if (player.wanted > 0) {
            player.probationWanted = player.wanted;
            player.probation = 5;
            player.wanted = 0;
        }
        audio.cash();
        showBigBanner(
            'RESPRAYED!',
            chk.free ? 'ON THE TAB — FULL REPAIR, NEW PAINT' : 'FRESH PAINT, FULL REPAIR, 5s PROBATION',
            '#7fb2f0'
        );
        updateHUD();
    }
    if (b.type === 'bomb') {
        player.score -= BOMB_COST;
        car.hasBomb = true;
        spawnFloatingText('-$5,000', car.x, car.y - 30, '#ffd400');
        audio.cash();
        showBigBanner('BOMB FITTED!', 'PRESS B TO ARM — 5s FUSE. BAIL OUT!', '#ff5a2a');
        updateHUD();
        return false;
    }
    if (b.type === 'export') {
        const payout = Math.round(car.spec.exportValue * (car.hp / car.maxHp));
        player.score += payout;
        const spot = ejectBeside(b);
        cars.splice(cars.indexOf(car), 1);
        player.inCar = null;
        player.x = spot.x;
        player.y = spot.y;
        hideRadio();
        audio.cash();
        spawnFloatingText(`EXPORT +$${payout.toLocaleString('en-US')}`, spot.x, spot.y - 24, '#ffd400');
        if (car.typeKey in exportBoard) exportBoard[car.typeKey] = true;
        if (Object.values(exportBoard).every(Boolean)) {
            player.score += EXPORT_BONUS;
            for (const k in exportBoard) exportBoard[k] = false;
            showBigBanner(
                'EXPORT BONUS!',
                `ORDER BOARD COMPLETE: +$${EXPORT_BONUS.toLocaleString('en-US')}`,
                '#ffd400'
            );
            audio.cash();
        } else {
            showBigBanner('EXPORTED!', `+$${payout.toLocaleString('en-US')} FOR THE ${car.spec.name}`, '#ffd400');
        }
        updateHUD();
        return true;
    }
    return false;
}

function lockCar(b, car) {
    car.serviceLock = true;
    b.car = car;
}
function unlockCar(b) {
    if (b.car) b.car.serviceLock = false;
    b.car = null;
}

export function updateBays(dt) {
    const car = player.inCar && player.inCar.hp > 0 ? player.inCar : null;
    for (const b of bays) {
        b.cooldown = Math.max(0, b.cooldown - dt);
        const d = car ? Math.hypot(car.x - b.x, car.y - b.y) : Infinity;
        const near = d < NEAR;
        let openTarget = 0;

        // Abort cleanly if the car vanished mid-service (wrecked, etc.)
        if ((b.state === 'service' || b.state === 'rollout') && (!car || car !== b.car)) {
            unlockCar(b);
            b.state = 'idle';
            b.cooldown = 3;
        }

        if (b.state === 'idle') {
            if (near) {
                const chk = check(b, car);
                if (chk.ok) {
                    openTarget = 1;
                    const v = DIR_VECS[b.dir];
                    const inside = d < 52 && b.shutter > 0.9; // captured as soon as it is nosed in
                    // must be nosed in: facing away from the door
                    const facingIn = Math.cos(car.angle) * -v.dx + Math.sin(car.angle) * -v.dy > 0.5;
                    if (inside && facingIn && b.cooldown <= 0) {
                        b.state = 'service';
                        b.timer = SERVICE_TIME;
                        b.chk = chk;
                        lockCar(b, car);
                        audio.shutter();
                        if (b.type === 'spray') {
                            audio.spray();
                            audio.ratchet();
                        }
                    }
                } else if (b.cooldown <= 0) {
                    b.state = 'reject';
                    b.timer = 2;
                    b.cooldown = 6;
                    showBigBanner(chk.msg, BAY_INFO[b.type].name, '#d23a2a');
                    audio.buzzer();
                }
            }
        } else if (b.state === 'reject') {
            openTarget = 1;
            b.timer -= dt;
            if (b.timer <= 0) b.state = 'idle';
        } else if (b.state === 'service') {
            const v = DIR_VECS[b.dir];
            // glide to the bay centre, nose to the back wall; the shutter shuts behind
            const k = Math.min(1, 8 * dt);
            car.x += (b.x - car.x) * k;
            car.y += (b.y - car.y) * k;
            const want = DIR_VECS[(b.dir + 2) % 4].ang;
            car.angle += normalizeAngle(want - car.angle) * k;
            car.vx = car.vy = car.speed = 0;
            b.timer -= dt;
            if (b.type === 'spray' && b.timer < SERVICE_TIME - 0.3) {
                // multicolour paint mist puffs out from under the shutter
                for (let i = 0; i < 3; i++) {
                    const side = (Math.random() - 0.5) * TILE * 0.7;
                    const out = 50 + Math.random() * 70;
                    particles.push({
                        x: b.x + v.dx * TILE * 0.5 - v.dy * side,
                        y: b.y + v.dy * TILE * 0.5 + v.dx * side,
                        vx: v.dx * out + (Math.random() - 0.5) * 40,
                        vy: v.dy * out + (Math.random() - 0.5) * 40,
                        size: 4 + Math.floor(Math.random() * 3) * 2,
                        color: MIST[Math.floor(Math.random() * MIST.length)],
                        life: 0.6,
                        maxLife: 0.6,
                        square: true
                    });
                }
            }
            if (b.timer <= 0) {
                if (serve(b, car, b.chk)) {
                    unlockCar(b);
                    b.state = 'idle';
                    b.cooldown = 1;
                } else {
                    b.state = 'rollout';
                    b.timer = ROLLOUT_TIME;
                    audio.shutter();
                }
            }
        } else if (b.state === 'rollout') {
            openTarget = 1;
            const v = DIR_VECS[b.dir];
            car.angle = DIR_VECS[(b.dir + 2) % 4].ang;
            if (b.shutter > 0.6) {
                car.vx = v.dx * 95; // gently reversed out onto the apron
                car.vy = v.dy * 95;
                b.timer -= dt;
            } else car.vx = car.vy = 0;
            if (b.timer <= 0) {
                unlockCar(b);
                b.state = 'idle';
                b.cooldown = 3;
            }
        }

        // Shutter + roof easing
        const dir = Math.sign(openTarget - b.shutter);
        b.shutter = Math.max(0, Math.min(1, b.shutter + dir * SHUTTER_SPEED * dt));
        if (Math.abs(b.shutter - openTarget) < SHUTTER_SPEED * dt) b.shutter = openTarget;
        const roofTarget = near || b.state === 'service' || b.state === 'rollout' ? 0.22 : 1;
        b.roofAlpha += (roofTarget - b.roofAlpha) * Math.min(1, 6 * dt);
    }
}
