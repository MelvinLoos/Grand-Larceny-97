import { audio } from './audio.js';
import { hasLineOfSight, isSolidAt, normalizeAngle } from './city.js';
import { WEAPONS } from './config.js';
import { addDecal } from './entities.js';
import { addScore, hideRadio, showBigBanner, showRadio, updateHUD } from './hud.js';
import { buzz } from './haptics.js';
import { addCrime } from './missions.js';
import { pedLook } from './palette.js';
import { bullets, camera, cars, decals, game, mission, particles, peds, player } from './state.js';

// --- AIM ASSIST (touch) ---
export function findAimTarget(x, y, facing) {
    let best = null;
    let bestScore = Infinity;
    const consider = (e, mul) => {
        const dx = e.x - x;
        const dy = e.y - y;
        const dist = Math.hypot(dx, dy);
        if (dist > 380 || dist < 1) return;
        const da = Math.abs(normalizeAngle(Math.atan2(dy, dx) - facing));
        if (da > 0.7) return;
        const score = dist * (1 + da) * mul;
        if (score < bestScore) {
            bestScore = score;
            best = e;
        }
    };
    for (const p of peds) {
        if (p.hp <= 0) continue;
        const mul = p.role === 'boss' ? 0.5 : p.role === 'cop' && player.wanted >= 1 ? 0.7 : 1;
        consider(p, mul);
    }
    const t = mission.targetEntity;
    if (t && t.hp > 0 && !peds.includes(t)) consider(t, 0.5);
    return best;
}

// --- MIDTOWN TURF GANGS ---
// Gangsters that can see a player gunshot or carjack nearby go hostile for a while
export function alertGangs(x, y) {
    for (const p of peds) {
        if (p.role !== 'gangster' || p.hp <= 0) continue;
        if (Math.hypot(p.x - x, p.y - y) < 520 && hasLineOfSight(p.x, p.y, x, y)) p.hostileTimer = 25;
    }
}

// --- ENTER / EXIT VEHICLE ---
export function toggleEnterExitVehicle() {
    if (player.deadTimer > 0 || player.inCar?.serviceLock) return;
    audio.init();

    if (player.inCar) {
        // Exit current vehicle
        const car = player.inCar;
        const sideAngle = car.angle - Math.PI * 0.5;
        const exitX = car.x + Math.cos(sideAngle) * (car.spec.w * 0.9 + 14);
        const exitY = car.y + Math.sin(sideAngle) * (car.spec.w * 0.9 + 14);

        if (!isSolidAt(exitX, exitY, 10)) {
            player.x = exitX;
            player.y = exitY;
        } else {
            player.x = car.x;
            player.y = car.y;
        }
        car.aiMode = 'parked';
        car.driver = false;
        car.doorT = 0.5;
        player.inCar = null;
        audio.door(car);
        hideRadio();
        updateHUD();
        return;
    }

    // Look for closest car within hijack range
    let bestCar = null;
    let bestDist = 72;
    for (const c of cars) {
        if (c.hp <= 0) continue;
        const d = Math.hypot(c.x - player.x, c.y - player.y);
        if (d < bestDist) {
            bestDist = d;
            bestCar = c;
        }
    }

    if (bestCar) {
        // Pull out existing AI driver!
        if (bestCar.driver && bestCar.aiMode !== 'parked') {
            const ejectAng = bestCar.angle - Math.PI * 0.5;
            peds.push({
                x: bestCar.x + Math.cos(ejectAng) * 32,
                y: bestCar.y + Math.sin(ejectAng) * 32,
                angle: ejectAng,
                speed: 90,
                color: bestCar.spec.isPolice ? '#1d4ed8' : '#f87171',
                role: bestCar.spec.isPolice ? 'cop' : 'civilian',
                ...pedLook(bestCar.spec.isPolice ? 'cop' : 'civilian'),
                hp: 30,
                panicTimer: 4,
                shootTimer: 0.8
            });
            audio.yelp(bestCar.x, bestCar.y);
            addCrime(bestCar.spec.isPolice ? 1.2 : 0.45);
            alertGangs(bestCar.x, bestCar.y);
            addScore(150, bestCar.x, bestCar.y - 20, 'JACKED');
        }

        bestCar.aiMode = 'player';
        bestCar.driver = true;
        bestCar.doorT = 0.5;
        player.inCar = bestCar;
        showRadio(bestCar.radioStation);
        audio.door(bestCar);
        updateHUD();
    }
}

// --- WEAPONS & EXPLOSIONS ---
export function fireWeapon(x, y, angle, weaponIdx, fromPlayer = true) {
    const w = WEAPONS[weaponIdx];
    audio.shoot(weaponIdx, x, y);
    if (fromPlayer) buzz(weaponIdx === 3 ? 30 : 10);

    if (weaponIdx === 0) {
        // Melee Punch
        const hitX = x + Math.cos(angle) * 28;
        const hitY = y + Math.sin(angle) * 28;
        for (const p of peds) {
            if (Math.hypot(p.x - hitX, p.y - hitY) < 26) {
                damagePed(p, w.damage, fromPlayer);
            }
        }
        return;
    }

    const spread = weaponIdx === 2 ? (Math.random() - 0.5) * 0.14 : 0.02 * (Math.random() - 0.5);
    const finalAng = angle + spread;
    bullets.push({
        x: x + Math.cos(finalAng) * 20,
        y: y + Math.sin(finalAng) * 20,
        vx: Math.cos(finalAng) * w.speed,
        vy: Math.sin(finalAng) * w.speed,
        damage: w.damage,
        explosive: !!w.explosive,
        fromPlayer,
        life: w.range / w.speed
    });

    // Muzzle flash particle
    particles.push({
        x: x + Math.cos(finalAng) * 22,
        y: y + Math.sin(finalAng) * 22,
        vx: 0,
        vy: 0,
        size: weaponIdx === 3 ? 12 : 7,
        color: '#fef08a',
        life: 0.07,
        maxLife: 0.07
    });

    if (fromPlayer) {
        alertGangs(x, y);
        // Alert nearby pedestrians
        for (const p of peds) {
            if (Math.hypot(p.x - x, p.y - y) < 340 && p.role === 'civilian') {
                p.panicTimer = 5;
                p.angle = Math.atan2(p.y - y, p.x - x);
            }
        }
    }
}

export function triggerExplosion(x, y, radius = 125, fromPlayer = true, dmgMul = 1) {
    audio.explosion(x, y, dmgMul > 1);
    camera.shake = Math.max(camera.shake, 18);
    addDecal('crater', x, y, Math.random() * 6.28, radius * 0.42, 'rgba(15, 15, 15, 0.72)');

    // Fireball particles
    for (let i = 0; i < 32; i++) {
        const a = Math.random() * Math.PI * 2;
        const spd = 40 + Math.random() * 260;
        particles.push({
            x,
            y,
            vx: Math.cos(a) * spd,
            vy: Math.sin(a) * spd,
            size: 10 + Math.random() * 18,
            color: i % 3 === 0 ? '#fef08a' : i % 2 === 0 ? '#ff8a2a' : '#b8322a',
            life: 0.35 + Math.random() * 0.45,
            maxLife: 0.8
        });
    }

    // Damage nearby peds
    for (const p of peds) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < radius) {
            damagePed(p, (1 - d / radius) * 220 * dmgMul, fromPlayer);
        }
    }

    // Chain-react nearby cars!
    for (const c of cars) {
        if (c.hp <= 0) continue;
        const d = Math.hypot(c.x - x, c.y - y);
        if (d < radius * 1.1) {
            c.hp -= (1 - d / (radius * 1.15)) * 210 * dmgMul;
            if (c.hp <= 0) destroyCar(c, fromPlayer);
        }
    }

    // Damage player if on foot nearby
    if (!player.inCar && player.deadTimer <= 0) {
        const dp = Math.hypot(player.x - x, player.y - y);
        if (dp < radius) {
            damagePlayer((1 - dp / radius) * 95 * dmgMul);
        }
    }
}

export function destroyCar(car, byPlayer = true) {
    car.hp = 0;
    car.color = '#27272a';
    if (player.inCar === car) {
        player.inCar = null;
        damagePlayer(85);
    }
    if (byPlayer) {
        addScore(car.spec.value, car.x, car.y, 'BOOM!');
        addCrime(car.spec.isPolice ? 1.5 : 0.7);
    }
    setTimeout(() => {
        triggerExplosion(car.x, car.y, 130, byPlayer);
    }, 60);
}

export function damagePed(ped, amount, byPlayer = true) {
    ped.hp -= amount;
    if (ped.hp <= 0) {
        addDecal('corpse', ped.x, ped.y, Math.random() * 6.28, (Math.random() * 3) | 0, ped.color);
        decals[decals.length - 1].head = ped.skin || '#fed7aa';
    }
    addDecal('blood', ped.x, ped.y, 0, 7 + Math.random() * 5, 'rgba(185, 28, 28, 0.75)');
    if (ped.hp <= 0) {
        if (byPlayer) {
            const pts = ped.role === 'cop' ? 500 : ped.role === 'boss' ? 2500 : 100;
            addScore(pts, ped.x, ped.y);
            addCrime(ped.role === 'cop' ? 1.1 : 0.35);

            // Check HALLELUJAH! (Did player wipe out all orange joggers?)
            if (ped.role === 'hallelujah') {
                const remaining = peds.filter((other) => other !== ped && other.role === 'hallelujah' && other.hp > 0);
                if (remaining.length === 0) {
                    addScore(5000, ped.x, ped.y - 25, 'HALLELUJAH!');
                    showBigBanner('HALLELUJAH!', 'ALL JOGGERS SPLATTERED! +$5,000 BONUS', '#ff8a2a');
                    audio.cash();
                }
            }
        }
    } else {
        ped.panicTimer = 6;
    }
}

export function damagePlayer(amount) {
    if (player.deadTimer > 0 || game.state !== 'play') return;
    if (player.armor > 0) {
        const absorbed = Math.min(player.armor, amount * 0.75);
        player.armor -= absorbed;
        amount -= absorbed;
    }
    player.hp = Math.max(0, player.hp - amount);
    camera.shake = Math.max(camera.shake, 7);
    buzz(25);
    updateHUD();

    if (player.hp <= 0) {
        triggerWastedOrBusted('WASTED!');
    }
}

export function triggerWastedOrBusted(reason) {
    player.deadTimer = 3.2;
    player.deadReason = reason;
    buzz([60, 40, 120]);
    player.inCar = null;
    hideRadio();
    player.multiplier = 1;
    player.wanted = 0;
    player.probation = 0;
    player.probationWanted = 0;
    if (mission.active) {
        mission.active = false;
    }
    const sub =
        reason === 'BUSTED!'
            ? 'Hauled to the Precinct — Weapons Confiscated!'
            : 'Patching you up at Neon Bay General Hospital...';
    showBigBanner(reason, sub, reason === 'BUSTED!' ? '#5a8fd6' : '#d23a2a');
    updateHUD();
}
