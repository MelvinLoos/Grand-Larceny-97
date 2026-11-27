import { audio } from './audio.js';
import { hasLineOfSight, isSolidAt, normalizeAngle, walkBlockedAt } from './city.js';
import { surfaceAt } from './river.js';
import { SWIM_TIME, TILE, WEAPONS, isLaw } from './config.js';
import { addDecal } from './entities.js';
import { addScore, hideRadio, showBigBanner, showRadio, spawnFloatingText, updateHUD } from './hud.js';
import { buzz } from './haptics.js';
import { addCrime, clearHeat } from './heat.js';
import { pedLook } from './palette.js';
import { bullets, camera, cars, decals, emergency, game, mission, particles, peds, player } from './state.js';

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
        const mul = p.role === 'boss' ? 0.5 : isLaw(p) && player.wanted >= 1 ? 0.7 : 1;
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
        if (car.airborne) return; // no bailing out mid-jump
        if (car.sink > 0) return bailOutOfSinking(car);
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
        if (c.hp <= 0 || c.sink > 0 || c.airborne) continue;
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
            addCrime(bestCar.spec.isPolice ? 'copJack' : 'jack', { x: bestCar.x, y: bestCar.y });
            alertGangs(bestCar.x, bestCar.y);
            addScore(150, bestCar.x, bestCar.y - 20, 'JACKED');
        }

        // Hijacking an ambulance: one free +25 HP medkit per vehicle
        if (bestCar.typeKey === 'ambulance' && !bestCar.medkitUsed) {
            bestCar.medkitUsed = true;
            player.hp = Math.min(player.maxHp, player.hp + 25);
            spawnFloatingText('+25 HP MEDKIT', bestCar.x, bestCar.y - 30, '#f87171');
        }
        // Whatever it was doing (hunting you, blocking the road, rescuing) is over
        bestCar.pursuit = false;
        bestCar.roadblock = null;
        bestCar.lightsOnly = false;
        bestCar.rescue = null;
        bestCar.aiMode = 'player';
        bestCar.driver = true;
        bestCar.doorT = 0.5;
        player.inCar = bestCar;
        showRadio(bestCar.radioStation);
        audio.door(bestCar);
        updateHUD();
    }
}

// Door kicked open in a sinking car: onto the quay if it is within a tile, otherwise into the water
function bailOutOfSinking(car) {
    let best = null;
    let bestD = TILE + 20;
    for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        for (const r of [40, 70, 100, 130]) {
            const x = car.x + Math.cos(ang) * r;
            const y = car.y + Math.sin(ang) * r;
            if (r < bestD && !surfaceAt(x, y).water && !walkBlockedAt(x, y, 11)) {
                best = { x, y };
                bestD = r;
            }
        }
    }
    const sideAngle = car.angle - Math.PI * 0.5;
    player.x = best ? best.x : car.x + Math.cos(sideAngle) * (car.spec.w * 0.9 + 14);
    player.y = best ? best.y : car.y + Math.sin(sideAngle) * (car.spec.w * 0.9 + 14);
    player.swimming = !best;
    player.breath = SWIM_TIME;
    car.aiMode = 'parked';
    car.driver = false;
    car.doorT = 0.5;
    player.inCar = null;
    audio.door(car);
    hideRadio();
    updateHUD();
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
        addCrime('shots', { x, y });
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
        addCrime(car.spec.isPolice ? 'copWreck' : 'wreck', { x: car.x, y: car.y });
    }
    car.burnT = 20 + Math.random() * 10; // the wreck burns until a fire truck douses it
    setTimeout(() => {
        triggerExplosion(car.x, car.y, 130, byPlayer);
    }, 60);
}

export function damagePed(ped, amount, byPlayer = true) {
    ped.hp -= amount;
    if (ped.hp <= 0) {
        addDecal('corpse', ped.x, ped.y, Math.random() * 6.28, (Math.random() * 3) | 0, ped.color);
        const corpse = decals[decals.length - 1];
        corpse.head = ped.skin || '#fed7aa';
        // Casualties are logged for the paramedics (2+ nearby sends an ambulance)
        if (ped.role !== 'medic' && ped.role !== 'boss') {
            emergency.casualties.push({ x: ped.x, y: ped.y, age: 0, decal: corpse, claimed: false });
        }
    }
    addDecal('blood', ped.x, ped.y, 0, 7 + Math.random() * 5, 'rgba(185, 28, 28, 0.75)');
    if (ped.hp <= 0) {
        if (byPlayer) {
            const pts = ped.role === 'cop' ? 500 : isLaw(ped) ? 900 : ped.role === 'boss' ? 2500 : 100;
            addScore(pts, ped.x, ped.y);
            addCrime(isLaw(ped) ? 'copKill' : 'assault', { x: ped.x, y: ped.y });

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

export function triggerWastedOrBusted(reason, subOverride = null) {
    player.deadTimer = 3.2;
    player.deadReason = reason;
    buzz([60, 40, 120]);
    player.inCar = null;
    hideRadio();
    player.multiplier = 1;
    clearHeat();
    if (mission.active) {
        mission.active = false;
    }
    const sub =
        subOverride ??
        (reason === 'BUSTED!'
            ? 'Hauled to the Precinct — Weapons Confiscated!'
            : 'Patching you up at Neon Bay General Hospital...');
    showBigBanner(reason, sub, reason === 'BUSTED!' ? '#5a8fd6' : '#d23a2a');
    updateHUD();
}
