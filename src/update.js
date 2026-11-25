import { updatePoliceCarAI, updateTrafficCarAI } from './ai.js';
import { audio } from './audio.js';
import {
    DIR_VECS,
    applyWallFeelers,
    normalizeAngle,
    LANDMARKS,
    hasLineOfSight,
    isRoadTileType,
    isSolidAt,
    pickRoadSpawnNear,
    policeFlowDist,
    tileAtWorld,
    updatePoliceFlowField
} from './city.js';
import { damagePed, damagePlayer, destroyCar, findAimTarget, fireWeapon, triggerExplosion } from './combat.js';
import { collideCarFoliage, steerAroundTrunks, trunkBlocks, updateFoliage } from './foliage.js';
import { MAP_SIZE, TILE, T_ROAD_X, WEAPONS, isSidewalkTile, isSolidTile } from './config.js';
import { getDistrictAt } from './districts.js';
import { addDecal, createCar, pickCarType, spawnRandomPed } from './entities.js';
import { buzz } from './haptics.js';
import { showPager, spawnFloatingText, updateDistrictName, updateHUD } from './hud.js';
import { updateMission } from './missions.js';
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

let stickReverse = false; // hysteresis for point-to-go reversing

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
            if (player.deadReason === 'BUSTED!') {
                player.ammo = [Infinity, 50, 0, 0];
                player.weaponIdx = 1;
            }
            showPager('BACK ON THE STREETS! GRAB A RIDE & MAKE SOME CASH!');
            updateHUD();
        }
    }

    // Wanted Level Decay & Police Spawning
    if (player.wanted > 0 && player.wanted < 2) {
        player.wantedDecay -= dt;
        if (player.wantedDecay <= 0) {
            player.wanted = Math.max(0, Math.floor(player.wanted) - 1);
            player.wantedDecay = 15;
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

    const activePoliceCars = cars.filter(
        (c) => c.spec.isPolice && c.hp > 0 && Math.hypot(c.x - player.x, c.y - player.y) < 1250
    );
    if (Math.floor(player.wanted) > activePoliceCars.length && Math.random() < dt * 1.1) {
        const spot = pickRoadSpawnNear(player.x, player.y, 580, 920);
        if (spot) {
            const copCar = createCar('police', spot.x, spot.y, spot.angle, 'police');
            copCar.sirenOn = true;
            cars.push(copCar);
        }
    }

    // --- PLAYER CONTROLS ---
    player.fireTimer = Math.max(0, player.fireTimer - dt);

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
            if (brake) {
                forwardSpeed *= 1 - 3.2 * dt;
                lateralSpeed *= 0.965;
                if (Math.hypot(car.vx, car.vy) > 130) {
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
                    if (Math.random() < 0.35) audio.screech();
                }
            } else {
                lateralSpeed *= spec.grip;
                if (Math.abs(lateralSpeed) > 75) {
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

            forwardSpeed = Math.max(-spec.maxSpeed * 0.42, Math.min(spec.maxSpeed, forwardSpeed));

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

            car.vx = Math.cos(car.angle) * forwardSpeed + -Math.sin(car.angle) * lateralSpeed;
            car.vy = Math.sin(car.angle) * forwardSpeed + Math.cos(car.angle) * lateralSpeed;
            car.speed = Math.hypot(car.vx, car.vy);

            // Tank main cannon!
            if (spec.isTank && (mouse.down || keys['ControlLeft'] || keys['Fire']) && player.fireTimer <= 0) {
                player.fireTimer = 0.9;
                fireWeapon(car.x + Math.cos(car.angle) * 36, car.y + Math.sin(car.angle) * 36, car.angle, 3, true);
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
                const walkSpeed = 165 * pace;
                const nx = player.x + mx * walkSpeed * dt;
                const ny = player.y + my * walkSpeed * dt;
                if (!isSolidAt(nx, player.y, 11) && !trunkBlocks(player.x, player.y, nx, player.y, 11)) player.x = nx;
                if (!isSolidAt(player.x, ny, 11) && !trunkBlocks(player.x, player.y, player.x, ny, 11)) player.y = ny;
                player.angle = Math.atan2(my, mx);
                player.walkCycle += dt * 12 * pace;
            }

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

    // --- UPDATE VEHICLES & COLLISIONS ---
    let anySirenNear = false;
    for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (c.hp <= 0) continue;

        // AI Traffic & Police Pursuit Logic
        if (c !== player.inCar && c.driver) {
            if (c.spec.isPolice && Math.floor(player.wanted) >= 1) {
                c.aiMode = 'police';
                c.sirenOn = true;
            } else if (c.aiMode === 'police' && Math.floor(player.wanted) === 0) {
                c.aiMode = 'traffic';
                c.sirenOn = false;
            }

            if (c.aiMode === 'police') {
                updatePoliceCarAI(c, dt);
            } else if (c.aiMode === 'traffic') {
                updateTrafficCarAI(c, dt);

                // Recycle far-away traffic cars onto nearby avenues so streets around player stay lively
                if (c !== mission.targetEntity && Math.hypot(c.x - player.x, c.y - player.y) > 1950) {
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
                        Object.assign(c, fresh);
                        c.vx = Math.cos(spot.angle) * c.cruiseSpeed;
                        c.vy = Math.sin(spot.angle) * c.cruiseSpeed;
                    }
                }
            }
        } else if (c !== player.inCar) {
            // Parked car friction
            c.vx *= 1 - 4 * dt;
            c.vy *= 1 - 4 * dt;
        }

        // Integrate position & wall bounce
        const nx = c.x + c.vx * dt;
        const ny = c.y + c.vy * dt;
        const rad = c.spec.w * 0.52;

        if (!isSolidAt(nx, c.y, rad)) {
            c.x = nx;
        } else {
            if (Math.abs(c.vx) > 190) {
                c.hp -= Math.abs(c.vx) * 0.06;
                if (c === player.inCar) {
                    camera.shake = Math.max(camera.shake, 5);
                    buzz(20);
                }
            }
            c.vx *= -0.35;
        }

        if (!isSolidAt(c.x, ny, rad)) {
            c.y = ny;
        } else {
            if (Math.abs(c.vy) > 190) {
                c.hp -= Math.abs(c.vy) * 0.06;
                if (c === player.inCar) {
                    camera.shake = Math.max(camera.shake, 5);
                    buzz(20);
                }
            }
            c.vy *= -0.35;
        }

        // Tree trunks (solid) & bushes (drive-through drag + leaf burst)
        collideCarFoliage(c, dt);

        // Car-to-Car Collisions
        for (let j = i + 1; j < cars.length; j++) {
            const o = cars[j];
            const dx = o.x - c.x;
            const dy = o.y - c.y;
            const dist = Math.hypot(dx, dy);
            const minDist = (c.spec.w + o.spec.w) * 0.78;
            if (dist > 0 && dist < minDist) {
                const nxCol = dx / dist;
                const nyCol = dy / dist;
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

        // Running over Pedestrians!
        const carSpd = Math.hypot(c.vx, c.vy);
        if (carSpd > 75) {
            for (const p of peds) {
                if (p.hp <= 0) continue;
                if (Math.hypot(p.x - c.x, p.y - c.y) < c.spec.w * 0.78) {
                    damagePed(p, 150, c === player.inCar);
                    if (c === player.inCar) {
                        audio.playTone(120, 55, 0.08, 'sawtooth', 0.08);
                    }
                }
            }
            // AI Car hitting Player on foot
            if (
                !player.inCar &&
                player.deadTimer <= 0 &&
                Math.hypot(player.x - c.x, player.y - c.y) < c.spec.w * 0.72
            ) {
                damagePlayer(carSpd * 0.12);
                player.x += (c.vx / carSpd) * 26;
                player.y += (c.vy / carSpd) * 26;
            }
        }

        // Smoke & Fire when vehicle is heavily damaged
        if (c.hp < c.maxHp * 0.38 && c.hp > 0) {
            c.burnTimer += dt;
            if (Math.random() < 0.35) {
                particles.push({
                    x: c.x + Math.cos(c.angle) * 18,
                    y: c.y + Math.sin(c.angle) * 18,
                    vx: (Math.random() - 0.5) * 25,
                    vy: -20 - Math.random() * 25,
                    size: 6 + Math.random() * 6,
                    color: c.hp < c.maxHp * 0.18 ? '#ff8a2a' : '#52525b',
                    life: 0.45,
                    maxLife: 0.45
                });
            }
            if (c.hp < c.maxHp * 0.15) {
                c.hp -= dt * 9; // Catching fire!
            }
        }

        if (c.hp <= 0) {
            destroyCar(c, c === player.inCar);
        }

        if (c.sirenOn && Math.hypot(c.x - player.x, c.y - player.y) < 700) {
            anySirenNear = true;
        }
    }

    updateFoliage(dt);

    if (player.inCar) {
        player.x = player.inCar.x;
        player.y = player.inCar.y;
    }

    // --- UPDATE PEDESTRIANS ---
    const parkLoop = LANDMARKS.parkLoop;

    for (let i = peds.length - 1; i >= 0; i--) {
        const p = peds[i];
        if (p.hp <= 0) {
            peds.splice(i, 1);
            continue;
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
                        const tA = tileAtWorld(p.x + Math.cos(perpA) * 28, p.y + Math.sin(perpA) * 28);
                        p.angle = isSidewalkTile(tA) ? perpA : perpB;
                        break;
                    }
                }
            }
        }

        const distP = Math.hypot(player.x - p.x, player.y - p.y);
        if (p.role === 'civilian' && distP > 2600 && Math.random() < dt * 0.4) {
            peds.splice(i, 1);
            continue;
        }
        const canSeePlayer = distP < 420 && hasLineOfSight(p.x, p.y, player.x, player.y);

        if (p.role === 'cop' && Math.floor(player.wanted) >= 1 && distP < 520 && player.deadTimer <= 0) {
            let moveAng = Math.atan2(player.y - p.y, player.x - p.x);
            if (!canSeePlayer) {
                // Follow flow-field around building corners!
                const ptx = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(p.x / TILE)));
                const pty = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(p.y / TILE)));
                let bestCost = policeFlowDist[pty][ptx];
                for (const dv of DIR_VECS) {
                    const ntx = ptx + dv.dx;
                    const nty = pty + dv.dy;
                    if (
                        ntx >= 0 &&
                        nty >= 0 &&
                        ntx < MAP_SIZE &&
                        nty < MAP_SIZE &&
                        policeFlowDist[nty][ntx] < bestCost
                    ) {
                        bestCost = policeFlowDist[nty][ntx];
                        moveAng = Math.atan2((nty + 0.5) * TILE - p.y, (ntx + 0.5) * TILE - p.x);
                    }
                }
            }
            p.angle = steerAroundTrunks(p.x, p.y, applyWallFeelers(p.x, p.y, moveAng, 28));
            p.shootTimer -= dt;
            if (distP > 135 || !canSeePlayer) {
                const nx = p.x + Math.cos(p.angle) * p.speed * dt;
                const ny = p.y + Math.sin(p.angle) * p.speed * dt;
                if (!isSolidAt(nx, ny, 8) && !trunkBlocks(p.x, p.y, nx, ny, 8)) {
                    p.x = nx;
                    p.y = ny;
                }
            }
            if (canSeePlayer && p.shootTimer <= 0 && distP < 340) {
                p.shootTimer = 0.85;
                p.angle = Math.atan2(player.y - p.y, player.x - p.x);
                fireWeapon(p.x, p.y, p.angle, 1, false);
            }
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
                if (isSidewalkTile(nt)) {
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
        spawnRandomPed(Math.floor(player.wanted) >= 2 && Math.random() < 0.25 ? 'cop' : 'civilian', true);
    }

    // --- UPDATE BULLETS ---
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;

        let hit = false;
        if (isSolidAt(b.x, b.y, 3)) {
            hit = true;
        }

        // Check Ped hits
        if (!hit) {
            for (const p of peds) {
                if (Math.hypot(p.x - b.x, p.y - b.y) < 14) {
                    if (!b.explosive) damagePed(p, b.damage, b.fromPlayer);
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
                        c.hp -= b.damage;
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
        if (pk.timer > 0) {
            pk.timer -= dt;
            continue;
        }
        if (Math.hypot(player.x - pk.x, player.y - pk.y) < 28) {
            pk.timer = 25; // Respawns after 25s
            audio.cash();
            if (pk.kind === 'health') {
                player.hp = 100;
                spawnFloatingText('MAX HEALTH!', pk.x, pk.y, '#d23a2a');
            } else if (pk.kind === 'armor') {
                player.armor = 100;
                spawnFloatingText('BODY ARMOR!', pk.x, pk.y, '#5a8fd6');
            } else if (pk.kind === 'uzi') {
                player.ammo[2] += 120;
                player.weaponIdx = 2;
                spawnFloatingText('UZI SMG +120!', pk.x, pk.y, '#ffd400');
            } else if (pk.kind === 'rocket') {
                player.ammo[3] += 6;
                player.weaponIdx = 3;
                spawnFloatingText('ROCKETS +6!', pk.x, pk.y, '#ff8a2a');
            } else if (pk.kind === 'bribe') {
                player.wanted = Math.max(0, player.wanted - 2);
                spawnFloatingText('COP BRIBE!', pk.x, pk.y, '#c084fc');
            }
            updateHUD();
        }
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

    // Update Missions & District Display
    if (game.state === 'play') {
        updateMission(dt);
        updateDistrictName(dt);
    }

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

    // Update Radio & Siren Audio
    audio.updateMusicAndSirens(
        dt,
        !!player.inCar,
        player.inCar ? player.inCar.typeKey : null,
        anySirenNear || (player.inCar && player.inCar.sirenOn)
    );
}
