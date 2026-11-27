import { updatePoliceCarAI, updateTrafficCarAI } from './ai.js';
import { audio } from './audio.js';
import {
    applyWallFeelers,
    blockerAt,
    isWallAt,
    normalizeAngle,
    LANDMARKS,
    hasLineOfSight,
    isRoadTileType,
    isSidewalkAt,
    isOnScreen,
    isSolidAt,
    pickRoadSpawnNear,
    tileAtWorld,
    updatePoliceFlowField,
    walkBlockedAt
} from './city.js';
import { damagePed, damagePlayer, destroyCar, findAimTarget, fireWeapon, triggerExplosion } from './combat.js';
import { collideCarFoliage, steerAroundTrunks, trunkBlocks, updateFoliage } from './foliage.js';
import {
    CAR_H,
    CAR_HIT_SPEED,
    PICKUP_RESPAWN,
    T_ROAD_X,
    WEAPONS,
    flatCount,
    flatSpeedMul,
    isLaw,
    isSolidTile
} from './config.js';
import { getDistrictAt } from './districts.js';
import { PUNK_HAIR, pedLook } from './palette.js';
import { addDecal, createCar, pickCarType, spawnRandomPed } from './entities.js';
import { buzz } from './haptics.js';
import { showPager, spawnFloatingText, trackHpLoss, updateDistrictName, updateHUD } from './hud.js';
import { updateEmergency, updateMedic, updateRescueCarAI, sprayWater } from './emergency.js';
import { addCrime, footCopRoom, updateHeat } from './heat.js';
import {
    maybePopByBullet,
    returnToCruiser,
    updateLawPed,
    updateRimSparks,
    updateRoadblocks,
    updateSpikes,
    updateStrandedCruiser
} from './lawforce.js';
import { updateMission } from './missions.js';
import { updateBays } from './shops.js';
import { updateRiver } from './river.js';
import { breakBarrier, drownPeds, reapSunk, resetSwim, sameLevel, updateCarVertical, updateSwim } from './stunts.js';
import { tankGeom } from './vehicles.js';
import {
    bullets,
    camera,
    cars,
    floatingTexts,
    game,
    keys,
    mission,
    mouse,
    particles,
    peds,
    pickups,
    player,
    stick,
    view
} from './state.js';

// One crash sound per car per quarter second, whatever the number of contacts
function bump(c, force) {
    const now = performance.now();
    if (now - (c.crashAt || 0) < 250) return;
    c.crashAt = now;
    audio.crash(c.x, c.y, force);
}

let stickReverse = false; // hysteresis for point-to-go reversing
let bombKeyHeld = false;

// --- CAR BOMBS: B arms a fitted bomb, 5s of beeping, then a huge blast ---
function updateCarBombs(dt) {
    const pc = player.inCar;
    if (keys['KeyB'] && !bombKeyHeld) {
        bombKeyHeld = true;
        if (pc && pc.hasBomb && !pc.bombArmed) {
            pc.bombArmed = true;
            pc.bombTimer = 5;
            pc.bombBeep = 0;
            showPager('BOMB ARMED! 5 SECONDS - BAIL OUT [F] OR RAM SOMETHING AND DIVE CLEAR!');
            updateHUD();
        }
    } else if (!keys['KeyB']) bombKeyHeld = false;

    for (const c of cars) {
        if (!c.bombArmed) continue;
        c.bombTimer -= dt;
        c.bombBeep -= dt;
        if (c.bombBeep <= 0) {
            audio.bombBeep(c.x, c.y);
            // once a second, then accelerating through the final second
            c.bombBeep = c.bombTimer > 1 ? 1 : Math.max(0.09, c.bombTimer * 0.2);
        }
        if (c.bombTimer <= 0) {
            c.bombArmed = false;
            c.hasBomb = false;
            triggerExplosion(c.x, c.y, 300, true, 2.5);
            if (c.hp > 0) destroyCar(c, true);
            updateHUD();
        }
    }
}

// --- MIDTOWN TURF GANGSTERS: keep a couple patrolling each courtyard near the player ---
function updateGangs(dt) {
    game.gangTimer -= dt;
    if (game.gangTimer > 0) return;
    game.gangTimer = 1;
    LANDMARKS.gangTurfs.forEach((t, idx) => {
        const cx = (t.x0 + t.x1) / 2;
        const cy = (t.y0 + t.y1) / 2;
        if (Math.hypot(cx - player.x, cy - player.y) > 1500) return;
        let n = 0;
        for (const p of peds) if (p.role === 'gangster' && p.turf === idx) n++;
        if (n >= 2) return;
        const x = t.x0 + 30 + Math.random() * (t.x1 - t.x0 - 60);
        const y = t.y0 + 30 + Math.random() * (t.y1 - t.y0 - 60);
        if (isSolidAt(x, y, 10) || Math.hypot(x - player.x, y - player.y) < 200) return;
        peds.push({
            x,
            y,
            angle: Math.random() * Math.PI * 2,
            speed: 42,
            color: t.jacket,
            role: 'gangster',
            turf: idx,
            hostileTimer: 0,
            ...pedLook('civilian', PUNK_HAIR),
            hp: 55,
            panicTimer: 0,
            shootTimer: 0.6
        });
    });
}

// Oriented-box test of a walker (circle radius r) against a car hull.
// Returns { nx, ny, depth }: the unit push-out direction (car -> walker) and how far inside they are, or null.
function carHullContact(c, x, y, r) {
    const fx = Math.cos(c.angle);
    const fy = Math.sin(c.angle);
    const dx = x - c.x;
    const dy = y - c.y;
    const lx = dx * fx + dy * fy;
    const ly = -dx * fy + dy * fx;
    const hl = c.spec.l / 2;
    const hw = c.spec.w / 2;
    const qx = Math.max(-hl, Math.min(hl, lx));
    const qy = Math.max(-hw, Math.min(hw, ly));
    let ex = lx - qx;
    let ey = ly - qy;
    const d = Math.hypot(ex, ey);
    let depth;
    if (d > 0) {
        if (d >= r) return null;
        depth = r - d;
        ex /= d;
        ey /= d;
    } else {
        // Centre inside the hull: leave through the nearest side
        const px = hl - Math.abs(lx);
        const py = hw - Math.abs(ly);
        if (py <= px) {
            ex = 0;
            ey = ly >= 0 ? 1 : -1;
            depth = py + r;
        } else {
            ex = lx >= 0 ? 1 : -1;
            ey = 0;
            depth = px + r;
        }
    }
    return { nx: ex * fx - ey * fy, ny: ex * fy + ey * fx, depth };
}

// Fast enough, and heading into the walker rather than past or away from them
function carStrikes(c, spd, ct) {
    return spd >= CAR_HIT_SPEED && c.vx * ct.nx + c.vy * ct.ny > 0.35 * spd;
}

// --- MAIN SIMULATION LOOP ---
export function update(dt) {
    // Respawn handling after WASTED / BUSTED
    if (player.deadTimer > 0) {
        player.deadTimer -= dt;
        if (player.deadTimer <= 0) {
            player.hp = 100;
            player.armor = 25;
            player.x = LANDMARKS.playerSpawn.x;
            player.y = LANDMARKS.playerSpawn.y;
            resetSwim();
            if (player.deadReason === 'BUSTED!') {
                player.ammo = [Infinity, 50, 0, 0];
                player.weaponIdx = 1;
            }
            showPager('BACK ON THE STREETS! GRAB A RIDE & MAKE SOME CASH!');
            updateHUD();
        }
    }

    // Probation after a respray: lie low or the heat comes back
    if (player.probation > 0) {
        player.probation -= dt;
        if (player.probation <= 0) {
            player.probation = 0;
            player.probationWanted = 0;
            updateHUD();
        }
    }

    if (Math.floor(player.wanted) >= 1) {
        game.policeFlowTimer -= dt;
        if (game.policeFlowTimer <= 0) {
            game.policeFlowTimer = 0.25;
            updatePoliceFlowField();
        }
    }

    // Heat: line-of-sight cooldown, capped pursuit dispatch, roadblocks, spike strips, ambulances & fire trucks
    updateHeat(dt);
    updateRoadblocks(dt);
    updateSpikes();
    updateEmergency(dt);

    // --- PLAYER CONTROLS ---
    player.fireTimer = Math.max(0, player.fireTimer - dt);
    player.carHitT = Math.max(0, player.carHitT - dt);
    player.exitGrace = Math.max(0, player.exitGrace - dt);

    const up = keys['KeyW'] || keys['ArrowUp'];
    const down = keys['KeyS'] || keys['ArrowDown'];
    const left = keys['KeyA'] || keys['ArrowLeft'];
    const right = keys['KeyD'] || keys['ArrowRight'];
    const brake = keys['Space'];
    const stickOn = stick.active && stick.mag > 0;
    const fireInput =
        mouse.down || keys['ControlLeft'] || keys['ControlRight'] || keys['Fire'] || (!player.inCar && brake);

    if (player.deadTimer <= 0) {
        if (player.inCar) {
            // Driving Physics
            const car = player.inCar;
            const spec = car.spec;
            const flats = flatCount(car);
            const hbrake = brake && !spec.turret; // Space is the fire key in a fire engine

            if (car.airborne || car.sink > 0) {
                // Wheels off the ground (or going under): no steering, no braking, no screech
                car.slip = 0;
                car.handbrake = false;
                car.throttle = 0;
            } else {
                const forwardX = Math.cos(car.angle);
                const forwardY = Math.sin(car.angle);
                const rightX = -forwardY;
                const rightY = forwardX;

                let forwardSpeed = car.vx * forwardX + car.vy * forwardY;
                let lateralSpeed = car.vx * rightX + car.vy * rightY;

                // Analog throttle (-1..1) and heading error for point-to-go steering
                let throttle = up ? 1 : down ? -1 : 0;
                let headingErr = 0;
                if (stickOn) {
                    const diff = normalizeAngle(Math.atan2(stick.y, stick.x) - car.angle);
                    const adiff = Math.abs(diff);
                    if (!spec.isTank) stickReverse = stickReverse ? adiff > 2.0 : adiff > 2.4;
                    else stickReverse = false;
                    if (stickReverse) {
                        throttle = -stick.mag;
                        headingErr = normalizeAngle(diff + Math.PI);
                    } else {
                        throttle = stick.mag * (1 - (0.5 * adiff) / Math.PI);
                        headingErr = diff;
                    }
                } else {
                    stickReverse = false;
                }

                if (throttle > 0) {
                    forwardSpeed += spec.accel * throttle * dt;
                } else if (throttle < 0) {
                    forwardSpeed += spec.accel * 0.8 * throttle * dt;
                } else {
                    forwardSpeed *= 1 - 1.6 * dt;
                }

                // Handbrake drift!
                if (hbrake) {
                    forwardSpeed *= 1 - 3.2 * dt;
                    lateralSpeed *= 0.965;
                    if (!flats && Math.hypot(car.vx, car.vy) > 130) {
                        addDecal(
                            'skid',
                            car.x - forwardX * 18 + rightX * 10,
                            car.y - forwardY * 18 + rightY * 10,
                            car.angle,
                            6
                        );
                        addDecal(
                            'skid',
                            car.x - forwardX * 18 - rightX * 10,
                            car.y - forwardY * 18 - rightY * 10,
                            car.angle,
                            6
                        );
                    }
                } else {
                    // Blown tires: permanently loose tail-slide
                    lateralSpeed *= flats ? 1 - (1 - spec.grip) * (flats >= 3 ? 0.25 : 0.45) : spec.grip;
                    if (!flats && Math.abs(lateralSpeed) > 75) {
                        addDecal(
                            'skid',
                            car.x - forwardX * 18 + rightX * 10,
                            car.y - forwardY * 18 + rightY * 10,
                            car.angle,
                            5
                        );
                        addDecal(
                            'skid',
                            car.x - forwardX * 18 - rightX * 10,
                            car.y - forwardY * 18 - rightY * 10,
                            car.angle,
                            5
                        );
                    }
                }

                const topSpeed = spec.maxSpeed * flatSpeedMul(car);
                if (forwardSpeed > topSpeed) forwardSpeed += (topSpeed - forwardSpeed) * Math.min(1, 5 * dt);
                forwardSpeed = Math.max(-topSpeed * 0.42, Math.min(topSpeed, forwardSpeed));

                // Steering scales smoothly with vehicle movement (Tank can pivot in place!)
                const steerFactor = spec.isTank
                    ? 2.2
                    : Math.min(1, Math.abs(forwardSpeed) / 95) * (forwardSpeed >= -5 ? 1 : -1) * 3.1;
                if (stickOn) {
                    const turn = Math.max(-1, Math.min(1, headingErr / 0.5)) * Math.abs(steerFactor) * dt;
                    car.angle += Math.abs(turn) > Math.abs(headingErr) ? headingErr : turn;
                } else {
                    if (left) car.angle -= steerFactor * dt;
                    if (right) car.angle += steerFactor * dt;
                }

                if (flats) {
                    // Pulls toward the blown side (right wheels are bits 1 and 3)
                    const pc = car.poppedTires;
                    const pull = ((pc >> 1) & 1) + ((pc >> 3) & 1) - (pc & 1) - ((pc >> 2) & 1);
                    car.angle += pull * 0.2 * Math.min(1, Math.abs(forwardSpeed) / 200) * dt;
                    updateRimSparks(car, dt);
                }

                car.vx = Math.cos(car.angle) * forwardSpeed + -Math.sin(car.angle) * lateralSpeed;
                car.vy = Math.sin(car.angle) * forwardSpeed + Math.cos(car.angle) * lateralSpeed;
                car.speed = Math.hypot(car.vx, car.vy);
                car.slip = Math.abs(lateralSpeed); // read by the screech loop
                car.handbrake = !!hbrake;
                car.throttle = Math.abs(throttle);

                // Fire engine roof cannon: Fire / Space blasts a pressurised jet
                if (
                    spec.turret &&
                    (mouse.down || keys['ControlLeft'] || keys['ControlRight'] || keys['Fire'] || brake)
                ) {
                    sprayWater(car, dt);
                }

                // Tank main cannon!
                if (spec.isTank && (mouse.down || keys['ControlLeft'] || keys['Fire']) && player.fireTimer <= 0) {
                    player.fireTimer = 0.9;
                    const tg = tankGeom(car);
                    const tipX = car.x + Math.cos(car.angle) * tg.ring + Math.cos(car.turretAngle) * tg.barrel;
                    const tipY = car.y + Math.sin(car.angle) * tg.ring + Math.sin(car.turretAngle) * tg.barrel;
                    fireWeapon(tipX, tipY, car.turretAngle, 3, true);
                    // Muzzle flare: a few orange-yellow pixels off the barrel tip
                    for (let i = 0, n = 3 + ((Math.random() * 3) | 0); i < n; i++) {
                        const a = car.turretAngle + (Math.random() - 0.5) * 0.7;
                        const sp = 70 + Math.random() * 110;
                        particles.push({
                            x: tipX,
                            y: tipY,
                            vx: Math.cos(a) * sp + car.vx,
                            vy: Math.sin(a) * sp + car.vy,
                            size: 2 + ((Math.random() * 2) | 0),
                            square: true,
                            color: Math.random() < 0.5 ? '#ffd400' : '#ff8a2a',
                            life: 0.14,
                            maxLife: 0.14
                        });
                    }
                }
            }

            player.x = car.x;
            player.y = car.y;
            player.angle = car.angle;
        } else {
            // On-Foot Movement
            let mx = (right ? 1 : 0) - (left ? 1 : 0);
            let my = (down ? 1 : 0) - (up ? 1 : 0);
            let pace = 1;
            const len = Math.hypot(mx, my);
            if (stickOn) {
                mx = stick.x;
                my = stick.y;
                pace = stick.mag;
            } else if (len > 0) {
                mx /= len;
                my /= len;
            }
            if (stickOn || len > 0) {
                const walkSpeed = (player.swimming ? 95 : 165) * pace;
                const nx = player.x + mx * walkSpeed * dt;
                const ny = player.y + my * walkSpeed * dt;
                if (!walkBlockedAt(nx, player.y, 11) && !trunkBlocks(player.x, player.y, nx, player.y, 11))
                    player.x = nx;
                if (!walkBlockedAt(player.x, ny, 11) && !trunkBlocks(player.x, player.y, player.x, ny, 11))
                    player.y = ny;
                player.angle = Math.atan2(my, mx);
                player.walkCycle += dt * 12 * pace;
            }

            updateSwim(dt);

            // Aim toward mouse when firing with mouse
            if (mouse.down) {
                player.angle = Math.atan2(mouse.worldY - player.y, mouse.worldX - player.x);
            }

            // Shooting on foot
            if (fireInput && player.fireTimer <= 0) {
                const w = WEAPONS[player.weaponIdx];
                if (player.ammo[player.weaponIdx] > 0) {
                    // Touch FIRE: nudge aim onto the best nearby target
                    if (keys['Fire'] && !mouse.down) {
                        const t = findAimTarget(player.x, player.y, player.angle);
                        if (t) player.angle = Math.atan2(t.y - player.y, t.x - player.x);
                    }
                    if (player.ammo[player.weaponIdx] !== Infinity) {
                        player.ammo[player.weaponIdx]--;
                    }
                    player.fireTimer = w.cooldown;
                    fireWeapon(player.x, player.y, player.angle, player.weaponIdx, true);
                    if (player.ammo[player.weaponIdx] === 0) {
                        player.weaponIdx = 0;
                    }
                    updateHUD();
                }
            }
        }
    }

    updateBays(dt);
    updateCarBombs(dt);
    updateGangs(dt);

    // --- UPDATE VEHICLES & COLLISIONS ---
    for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (c.hp <= 0) continue;
        if (c.doorT > 0) c.doorT -= dt;

        // Tank turret: slews toward the cursor (recent mouse) else back onto the hull heading
        if (c.spec.isTank || c.spec.turret) {
            const aim = c.rescue?.kind === 'fire' && c.rescue.target ? c.rescue.target : null;
            c.targetAngle = aim
                ? Math.atan2(aim.y - c.y, aim.x - c.x)
                : c === player.inCar && performance.now() - mouse.movedAt < 3000
                  ? Math.atan2(mouse.worldY - c.y, mouse.worldX - c.x)
                  : c.angle;
            const dA = normalizeAngle(c.targetAngle - c.turretAngle);
            const step = 2.5 * dt;
            c.turretAngle = normalizeAngle(c.turretAngle + (Math.abs(dA) <= step ? dA : Math.sign(dA) * step));
        }

        // AI Traffic & Police Pursuit Logic
        const free = !c.airborne && !(c.sink > 0); // wheels on the ground and above water
        if (c !== player.inCar && c.driver && free) {
            // Only dispatched pursuers hunt the player (capped per wanted level, see heat.js)
            if (c.aiMode === 'police' && !c.pursuit) {
                c.aiMode = 'traffic';
                c.sirenOn = false;
            }

            if (c.aiMode === 'police') {
                updatePoliceCarAI(c, dt);
            } else if (c.aiMode === 'rescue') {
                updateRescueCarAI(c, dt);
            } else if (c.aiMode === 'traffic') {
                updateTrafficCarAI(c, dt);

                // Recycle far-away traffic cars onto nearby avenues so streets around player stay lively
                if (
                    c !== mission.targetEntity &&
                    Math.hypot(c.x - player.x, c.y - player.y) > 1950 &&
                    !isOnScreen(c.x, c.y, 200)
                ) {
                    const spot = pickRoadSpawnNear(player.x, player.y, 820, 1350);
                    if (spot) {
                        // Re-roll the model for the district it lands in, so traffic shifts as you cross town
                        const fresh = createCar(
                            pickCarType(getDistrictAt(spot.x, spot.y)),
                            spot.x,
                            spot.y,
                            spot.angle,
                            'traffic'
                        );
                        delete c._grime;
                        delete c._gs;
                        fresh.id = c.id; // same car object, same identity
                        Object.assign(c, fresh);
                        c.vx = Math.cos(spot.angle) * c.cruiseSpeed;
                        c.vy = Math.sin(spot.angle) * c.cruiseSpeed;
                    }
                }
            }
        } else if (c !== player.inCar && free) {
            // Parked car friction
            c.vx *= 1 - 4 * dt;
            c.vy *= 1 - 4 * dt;
            if (c.stranded) updateStrandedCruiser(c);
        }

        // Integrate position & wall bounce, in sub-steps so a fast car can't skip a thin parapet
        const rad = c.spec.w * 0.52;
        const safeX = c.x;
        const safeY = c.y;
        const steps = Math.min(6, Math.max(1, Math.ceil((Math.hypot(c.vx, c.vy) * dt) / 10)));
        const sdt = dt / steps;
        for (let k = 0; k < steps; k++) {
            const nx = c.x + c.vx * sdt;
            const hx = blockerAt(nx, c.y, rad, c.z);
            if (!hx) {
                c.x = nx;
            } else if (hx !== true && hx.breakable && Math.hypot(c.vx, c.vy) > 140) {
                breakBarrier(hx);
                if (c === player.inCar) addCrime('prop', { x: c.x, y: c.y });
                c.vx *= 0.82;
                c.vy *= 0.82;
                c.x = nx;
            } else {
                if (Math.abs(c.vx) > 190) {
                    c.hp -= Math.abs(c.vx) * 0.06;
                    bump(c, Math.abs(c.vx));
                    if (c === player.inCar) {
                        camera.shake = Math.max(camera.shake, 5);
                        buzz(20);
                    }
                }
                c.vx *= -0.35;
            }

            const ny = c.y + c.vy * sdt;
            const hy = blockerAt(c.x, ny, rad, c.z);
            if (!hy) {
                c.y = ny;
            } else if (hy !== true && hy.breakable && Math.hypot(c.vx, c.vy) > 140) {
                breakBarrier(hy);
                if (c === player.inCar) addCrime('prop', { x: c.x, y: c.y });
                c.vx *= 0.82;
                c.vy *= 0.82;
                c.y = ny;
            } else {
                if (Math.abs(c.vy) > 190) {
                    c.hp -= Math.abs(c.vy) * 0.06;
                    bump(c, Math.abs(c.vy));
                    if (c === player.inCar) {
                        camera.shake = Math.max(camera.shake, 5);
                        buzz(20);
                    }
                }
                c.vy *= -0.35;
            }
        }

        // A NaN / Infinity position or velocity must never spread: roll back to the last good spot
        if (!Number.isFinite(c.x + c.y + c.vx + c.vy)) {
            c.x = Number.isFinite(safeX) ? safeX : player.x;
            c.y = Number.isFinite(safeY) ? safeY : player.y;
            c.vx = c.vy = c.speed = 0;
        }

        // Ramps, flight, landing, plunging into the river
        updateCarVertical(c, dt);

        // Tree trunks (solid) & bushes (drive-through drag + leaf burst)
        if (free) collideCarFoliage(c, dt);

        // Car-to-Car Collisions
        for (let j = i + 1; j < cars.length; j++) {
            const o = cars[j];
            let dx = o.x - c.x;
            let dy = o.y - c.y;
            let dist = Math.hypot(dx, dy);
            const minDist = (c.spec.w + o.spec.w) * 0.78;
            if (dist < minDist && sameLevel(c, o)) {
                if (dist < 0.001) {
                    // Exactly stacked: push apart along a fixed axis instead of dividing by zero
                    dx = -Math.sin(c.angle);
                    dy = Math.cos(c.angle);
                    dist = 0;
                }
                const len = dist || 1;
                const nxCol = dx / len;
                const nyCol = dy / len;
                const overlap = minDist - dist;
                const cm = c.spec.mass || 1;
                const om = o.spec.mass || 1;
                const cShare = om / (cm + om); // the lighter car gets shoved more
                c.x -= nxCol * overlap * cShare;
                c.y -= nyCol * overlap * cShare;
                o.x += nxCol * overlap * (1 - cShare);
                o.y += nyCol * overlap * (1 - cShare);

                const relV = Math.hypot(c.vx - o.vx, c.vy - o.vy);
                if (relV > 140) {
                    bump(c, relV);
                    if (c === player.inCar || o === player.inCar) {
                        const other = c === player.inCar ? o : c;
                        addCrime(other.spec.isPolice ? 'copBump' : 'bump', { x: other.x, y: other.y });
                    }
                    // Battle Tank crushes cars instantly!
                    if (c.spec.isTank && c === player.inCar && o.hp > 0) {
                        destroyCar(o, true);
                    } else if (o.spec.isTank && o === player.inCar && c.hp > 0) {
                        destroyCar(c, true);
                    } else {
                        c.hp -= relV * 0.08 * cShare;
                        o.hp -= relV * 0.08 * (1 - cShare);
                    }
                }
                const avgVx = (c.vx * cm + o.vx * om) / (cm + om);
                const avgVy = (c.vy * cm + o.vy * om) / (cm + om);
                c.vx = avgVx - nxCol * 90 * cShare;
                c.vy = avgVy - nyCol * 90 * cShare;
                o.vx = avgVx + nxCol * 90 * (1 - cShare);
                o.vy = avgVy + nyCol * 90 * (1 - cShare);
            }
        }

        // Cars vs people on foot. A fast car driving INTO someone hurts and bowls them over;
        // a parked, stopped or creeping car (or one driving away) is just a solid hull that shoves you clear.
        if (free && c.z <= CAR_H) {
            const carSpd = Math.hypot(c.vx, c.vy);
            const reach = c.spec.l / 2 + 16;
            for (const p of peds) {
                if (p.hp <= 0 || p.role === 'medic') continue;
                if (Math.abs(p.x - c.x) > reach || Math.abs(p.y - c.y) > reach) continue;
                const ct = carHullContact(c, p.x, p.y, 7);
                if (!ct) continue;
                if (carStrikes(c, carSpd, ct)) {
                    damagePed(p, Math.min(150, carSpd * 2), c === player.inCar);
                    if (c === player.inCar) audio.thump(p.x, p.y);
                } else if (!isSolidAt(p.x + ct.nx * ct.depth, p.y + ct.ny * ct.depth, 8)) {
                    p.x += ct.nx * ct.depth;
                    p.y += ct.ny * ct.depth;
                }
            }
            if (!player.inCar && player.deadTimer <= 0 && Math.abs(player.x - c.x) < reach + 6) {
                const ct = carHullContact(c, player.x, player.y, 11);
                if (ct && carStrikes(c, carSpd, ct) && player.carHitT <= 0) {
                    player.carHitT = 0.35;
                    audio.thump(player.x, player.y);
                    damagePlayer(carSpd * 0.12);
                    const kx = player.x + (c.vx / carSpd) * 26;
                    const ky = player.y + (c.vy / carSpd) * 26;
                    if (!walkBlockedAt(kx, player.y, 11)) player.x = kx;
                    if (!walkBlockedAt(player.x, ky, 11)) player.y = ky;
                } else if (ct) {
                    const px = player.x + ct.nx * ct.depth;
                    const py = player.y + ct.ny * ct.depth;
                    if (!walkBlockedAt(px, py, 11)) {
                        player.x = px;
                        player.y = py;
                    }
                }
            }
        }

        // Smoke & Fire when vehicle is heavily damaged
        if (c.hp < c.maxHp * 0.38 && c.hp > 0) {
            c.burnTimer += dt;
            if (Math.random() < 0.35) {
                particles.push({
                    x: c.x + Math.cos(c.angle) * c.spec.l * 0.32 + (Math.random() - 0.5) * 6,
                    y: c.y + Math.sin(c.angle) * c.spec.l * 0.32 + (Math.random() - 0.5) * 6,
                    vx: (Math.random() - 0.5) * 25,
                    vy: -20 - Math.random() * 25,
                    size: 2 + ((Math.random() * 2) | 0),
                    square: true,
                    color: c.hp < c.maxHp * 0.18 ? '#ff8a2a' : '#52525b',
                    life: 0.45,
                    maxLife: 0.45
                });
            }
            if (c.hp < c.maxHp * 0.15) {
                c.hp -= dt * 9; // Catching fire!
            }
        }

        if (c.hp <= 0 && !c.sunk) {
            destroyCar(c, c === player.inCar);
        }
    }
    reapSunk();

    updateFoliage(dt);

    if (player.inCar) {
        player.x = player.inCar.x;
        player.y = player.inCar.y;
    }

    // --- UPDATE PEDESTRIANS ---
    drownPeds();
    const parkLoop = LANDMARKS.parkLoop;

    for (let i = peds.length - 1; i >= 0; i--) {
        const p = peds[i];
        if (p.hp <= 0) {
            peds.splice(i, 1);
            continue;
        }

        // Knocked back by a water cannon blast
        if (p.kbx || p.kby) {
            const kx = p.x + p.kbx * dt;
            const ky = p.y + p.kby * dt;
            if (!isSolidAt(kx, p.y, 8)) p.x = kx;
            if (!isSolidAt(p.x, ky, 8)) p.y = ky;
            const k = Math.max(0, 1 - 4 * dt);
            p.kbx *= k;
            p.kby *= k;
            if (Math.abs(p.kbx) + Math.abs(p.kby) < 12) p.kbx = p.kby = 0;
        }

        // Reflexively dodge fast oncoming cars!
        if (p.role === 'civilian' || p.role === 'hallelujah') {
            for (const c of cars) {
                if (c.hp <= 0) continue;
                const cSpd = Math.hypot(c.vx, c.vy);
                if (cSpd < 135) continue;
                const dx = p.x - c.x;
                const dy = p.y - c.y;
                const d = Math.hypot(dx, dy);
                if (d < 120) {
                    const approachDot = (dx * c.vx + dy * c.vy) / (d * cSpd);
                    if (approachDot > 0.78) {
                        p.panicTimer = 2.8;
                        // Dive perpendicular to oncoming vehicle toward nearest sidewalk
                        const perpA = Math.atan2(c.vy, c.vx) + Math.PI * 0.5;
                        const perpB = perpA + Math.PI;
                        p.angle = isSidewalkAt(p.x + Math.cos(perpA) * 28, p.y + Math.sin(perpA) * 28) ? perpA : perpB;
                        break;
                    }
                }
            }
        }

        const distP = Math.hypot(player.x - p.x, player.y - p.y);
        if (
            ((p.role === 'civilian' && distP > 2600) ||
                (p.role === 'gangster' && distP > 2200) ||
                (isLaw(p) && !p.cover && distP > 1800)) &&
            Math.random() < dt * 0.4
        ) {
            peds.splice(i, 1);
            continue;
        }
        const canSeePlayer = distP < 420 && hasLineOfSight(p.x, p.y, player.x, player.y);

        // Dismounted crew: go back to the cruiser when you are far away (or the heat is off), unless it is gone
        if (p.cruiser && (p.cruiser.hp <= 0 || p.cruiser.aiMode === 'player' || !cars.includes(p.cruiser))) {
            p.cruiser = null;
        }
        if (p.cruiser) {
            if (distP > 420 || Math.floor(player.wanted) < 1 || player.deadTimer > 0) p.retreat = true;
            else if (distP < 300) p.retreat = false;
        }

        if (p.cruiser && p.retreat) {
            if (returnToCruiser(p, dt)) {
                peds.splice(i, 1);
                continue;
            }
        } else if (p.role === 'medic') {
            updateMedic(p, dt);
        } else if (isLaw(p) && Math.floor(player.wanted) >= 1 && distP < 520 && player.deadTimer <= 0) {
            updateLawPed(p, dt, distP, canSeePlayer);
        } else if (p.cover) {
            p.angle = Math.atan2(player.y - p.y, player.x - p.x); // roadblock officer holding the line
        } else if ((p.role === 'boss' || p.role === 'guard') && distP < 400 && player.deadTimer <= 0) {
            const aimAng = Math.atan2(player.y - p.y, player.x - p.x);
            p.angle = steerAroundTrunks(p.x, p.y, canSeePlayer ? aimAng : applyWallFeelers(p.x, p.y, aimAng, 30));
            if (!canSeePlayer || distP > 190) {
                const nx = p.x + Math.cos(p.angle) * p.speed * dt;
                const ny = p.y + Math.sin(p.angle) * p.speed * dt;
                if (!isSolidAt(nx, ny, 8) && !trunkBlocks(p.x, p.y, nx, ny, 8)) {
                    p.x = nx;
                    p.y = ny;
                }
            }
            p.shootTimer -= dt;
            if (canSeePlayer && p.shootTimer <= 0) {
                p.shootTimer = 0.55;
                fireWeapon(p.x, p.y, aimAng, 2, false);
            }
        } else if (p.role === 'gangster' && player.deadTimer <= 0) {
            p.hostileTimer = Math.max(0, (p.hostileTimer || 0) - dt);
            if (p.hostileTimer > 0 && distP < 420) {
                // Provoked: pull a pistol and chase
                const aimAng = Math.atan2(player.y - p.y, player.x - p.x);
                p.angle = steerAroundTrunks(p.x, p.y, canSeePlayer ? aimAng : applyWallFeelers(p.x, p.y, aimAng, 30));
                if (!canSeePlayer || distP > 170) {
                    const nx = p.x + Math.cos(p.angle) * 85 * dt;
                    const ny = p.y + Math.sin(p.angle) * 85 * dt;
                    if (!isSolidAt(nx, ny, 8) && !trunkBlocks(p.x, p.y, nx, ny, 8)) {
                        p.x = nx;
                        p.y = ny;
                    }
                }
                p.shootTimer -= dt;
                if (canSeePlayer && p.shootTimer <= 0) {
                    p.shootTimer = 0.75;
                    p.angle = aimAng;
                    fireWeapon(p.x, p.y, aimAng, 1, false);
                }
            } else {
                // Idle: shuffle around the home courtyard
                const t = LANDMARKS.gangTurfs[p.turf];
                p.wpT = (p.wpT || 0) - dt;
                if (!p.wp || p.wpT <= 0 || Math.hypot(p.wp.x - p.x, p.wp.y - p.y) < 20) {
                    p.wp = {
                        x: t.x0 + 30 + Math.random() * (t.x1 - t.x0 - 60),
                        y: t.y0 + 30 + Math.random() * (t.y1 - t.y0 - 60)
                    };
                    p.wpT = 4 + Math.random() * 4;
                }
                p.angle = steerAroundTrunks(p.x, p.y, Math.atan2(p.wp.y - p.y, p.wp.x - p.x));
                const nx = p.x + Math.cos(p.angle) * p.speed * dt;
                const ny = p.y + Math.sin(p.angle) * p.speed * dt;
                if (!isSolidAt(nx, ny, 8) && !trunkBlocks(p.x, p.y, nx, ny, 8)) {
                    p.x = nx;
                    p.y = ny;
                } else p.wpT = 0;
            }
        } else if (p.role === 'hallelujah' && p.panicTimer <= 0) {
            // Synchronized Central Park jogger conga patrol!
            const wp = parkLoop[p.waypointIdx || 0];
            if (Math.hypot(wp.x - p.x, wp.y - p.y) < 20) {
                p.waypointIdx = ((p.waypointIdx || 0) + 1) % parkLoop.length;
            }
            const nextWp = parkLoop[p.waypointIdx || 0];
            p.angle = steerAroundTrunks(p.x, p.y, Math.atan2(nextWp.y - p.y, nextWp.x - p.x));
            p.x += Math.cos(p.angle) * p.speed * dt;
            p.y += Math.sin(p.angle) * p.speed * dt;
        } else {
            // Normal sidewalk stroll, safe zebra-crosswalk crossing, or panic sprint
            if (p.panicTimer > 0) p.panicTimer -= dt;
            const spd = p.panicTimer > 0 ? 118 : p.speed;
            p.angle = steerAroundTrunks(p.x, p.y, p.angle);
            const nx = p.x + Math.cos(p.angle) * spd * dt;
            const ny = p.y + Math.sin(p.angle) * spd * dt;
            const curT = tileAtWorld(p.x, p.y);
            const nt = tileAtWorld(nx, ny);

            // Pedestrians stay on sidewalks/parks, only entering roads at T_ROAD_X crosswalks when clear of cars!
            let canStep = false;
            if (!isSolidAt(nx, ny, 8) && !trunkBlocks(p.x, p.y, nx, ny, 8)) {
                if (isSidewalkAt(nx, ny)) {
                    canStep = true;
                } else if (p.panicTimer > 0 && !isSolidTile(nt)) {
                    canStep = true;
                } else if (nt === T_ROAD_X) {
                    // If already crossing, finish crossing; if stepping off curb, check oncoming traffic first
                    if (curT === T_ROAD_X) {
                        canStep = true;
                    } else {
                        let roadClear = true;
                        for (const c of cars) {
                            if (c.hp > 0 && c.speed > 40 && Math.hypot(c.x - nx, c.y - ny) < 135) {
                                roadClear = false;
                                break;
                            }
                        }
                        canStep = roadClear && Math.random() < 0.35;
                    }
                } else if (isRoadTileType(curT) && isRoadTileType(nt)) {
                    // If somehow mid-road, walk shortest way off road
                    canStep = true;
                }
            }

            if (canStep) {
                p.x = nx;
                p.y = ny;
            } else {
                p.angle += Math.PI * (0.5 + Math.floor(Math.random() * 2) * 0.5);
            }
        }
    }

    // Keep city lively with ambient pedestrians
    if (peds.length < 75 && Math.random() < dt * 2) {
        const lvl = Math.floor(player.wanted);
        spawnRandomPed(lvl >= 2 && Math.random() < 0.25 && footCopRoom(lvl) ? 'cop' : 'civilian', true);
    }

    // --- UPDATE BULLETS ---
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;

        let hit = false;
        if (isWallAt(b.x, b.y, 3)) {
            hit = true;
            audio.impact(b.x, b.y, 'wall');
        }

        // Check Ped hits
        if (!hit) {
            for (const p of peds) {
                if (Math.hypot(p.x - b.x, p.y - b.y) < 14) {
                    if (!b.explosive) {
                        damagePed(p, b.damage, b.fromPlayer);
                        audio.impact(p.x, p.y, 'flesh');
                    }
                    hit = true;
                    break;
                }
            }
        }

        // Check Car hits
        if (!hit) {
            for (const c of cars) {
                if (c.hp <= 0 || (b.fromPlayer && c === player.inCar)) continue;
                if (Math.hypot(c.x - b.x, c.y - b.y) < c.spec.w * 0.75) {
                    if (!b.explosive) {
                        audio.impact(c.x, c.y, 'metal');
                        c.hp -= b.damage;
                        maybePopByBullet(c, b);
                        if (c.hp <= 0) destroyCar(c, b.fromPlayer);
                    }
                    hit = true;
                    break;
                }
            }
        }

        // Check Player hit from enemy bullets
        if (!hit && !b.fromPlayer && player.deadTimer <= 0) {
            if (player.inCar) {
                if (Math.hypot(player.inCar.x - b.x, player.inCar.y - b.y) < 26) {
                    player.inCar.hp -= b.damage * 0.5;
                    hit = true;
                }
            } else if (Math.hypot(player.x - b.x, player.y - b.y) < 13) {
                damagePlayer(b.damage * 0.45);
                hit = true;
            }
        }

        if (b.explosive) {
            particles.push({
                x: b.x,
                y: b.y,
                vx: 0,
                vy: 0,
                size: 5,
                color: '#cbd5e1',
                life: 0.2,
                maxLife: 0.2
            });
        }

        if (hit || b.life <= 0) {
            if (b.explosive) {
                triggerExplosion(b.x, b.y, 135, b.fromPlayer);
            }
            bullets.splice(i, 1);
        }
    }

    // --- PICKUPS ---
    for (const pk of pickups) {
        pk.hintT = Math.max(0, (pk.hintT || 0) - dt);
        if (pk.timer > 0) {
            pk.timer -= dt;
            continue;
        }
        if (player.deadTimer > 0 || Math.hypot(player.x - pk.x, player.y - pk.y) >= 28) continue;
        const px = player.x;
        const py = player.y - 34;
        let text = null;
        let color = pk.color;
        let full = null; // set when the pickup would be wasted: it stays put and says why
        if (pk.kind === 'health') {
            if (player.hp >= player.maxHp) full = 'HEALTH FULL';
            else {
                text = `+${Math.round(player.maxHp - player.hp)} HEALTH`;
                player.hp = player.maxHp;
            }
        } else if (pk.kind === 'armor') {
            if (player.armor >= 100) full = 'ARMOR FULL';
            else {
                text = `+${Math.round(100 - player.armor)} ARMOR`;
                player.armor = 100;
            }
        } else if (pk.kind === 'uzi') {
            player.ammo[2] += 120;
            player.weaponIdx = 2;
            text = 'UZI +120';
        } else if (pk.kind === 'rocket') {
            player.ammo[3] += 6;
            player.weaponIdx = 3;
            text = 'ROCKETS +6';
        } else if (pk.kind === 'bribe') {
            if (player.wanted <= 0) full = 'NO HEAT';
            else {
                player.wanted = Math.max(0, player.wanted - 2);
                text = 'COP BRIBE!';
            }
        }
        if (full) {
            if (pk.hintT <= 0) {
                pk.hintT = 1.5;
                spawnFloatingText(full, px, py, '#ece6d2', 0.85);
            }
            continue;
        }
        pk.timer = PICKUP_RESPAWN;
        audio.pickup();
        spawnFloatingText(text, px, py, color, 1.1);
        updateHUD();
    }

    // --- PARTICLES & FLOATING TEXTS ---
    for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i];
        if (pt.drag) {
            // Leaves: air drag + sideways flutter while settling
            const k = Math.max(0, 1 - pt.drag * dt);
            pt.vx *= k;
            pt.vy *= k;
            pt.x += Math.sin(pt.life * 9 + pt.phase) * pt.amp * dt;
        }
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.life -= dt;
        if (pt.life <= 0) particles.splice(i, 1);
    }

    for (let i = floatingTexts.length - 1; i >= 0; i--) {
        const ft = floatingTexts[i];
        ft.y += ft.vy * dt;
        ft.life -= dt;
        if (ft.life <= 0) floatingTexts.splice(i, 1);
    }

    updateRiver(dt);

    // Update Missions & District Display
    if (game.state === 'play') {
        updateMission(dt);
        updateDistrictName(dt);
    }

    trackHpLoss();

    // --- DYNAMIC SPEED-ZOOM CAMERA ---
    const currentSpeed = player.inCar ? player.inCar.speed : 0;
    // Zooms out smoothly when driving fast so you can spot intersections ahead!
    camera.targetZoom = (player.inCar ? Math.max(0.6, 0.94 - (currentSpeed / 560) * 0.34) : 1.06) * view.fit;
    camera.zoom += (camera.targetZoom - camera.zoom) * 3.5 * dt;

    // Camera looks slightly ahead of fast vehicles
    const leadX = player.inCar ? player.inCar.vx * 0.28 : 0;
    const leadY = player.inCar ? player.inCar.vy * 0.28 : 0;
    camera.x += (player.x + leadX - camera.x) * 6.5 * dt;
    camera.y += (player.y + leadY - camera.y) * 6.5 * dt;
    camera.shake = Math.max(0, camera.shake - dt * 32);

    // Update mouse world position
    mouse.worldX = camera.x + (mouse.x - view.w * 0.5) / camera.zoom;
    mouse.worldY = camera.y + (mouse.y - view.h * 0.5) / camera.zoom;

    // Engine, tires, sirens and radio follow the world from here
    audio.updateWorld();
}
