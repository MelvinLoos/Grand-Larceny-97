import { audio } from './audio.js';
import {
    DIR_VECS,
    applyWallFeelers,
    getLaneCoord,
    hasDriveLine,
    isRoadCell,
    isRoadTileType,
    normalizeAngle,
    policeFlowDist,
    tileAtWorld
} from './city.js';
import { MAP_SIZE, TILE, T_ROAD_H, T_ROAD_V, T_ROAD_X, WANTED_TIERS, flatCount, flatSpeedMul } from './config.js';
import { deployCrew } from './lawforce.js';
import { cars, heat, mapGrid, peds, player } from './state.js';

// --- SMART TRAFFIC & POLICE DRIVING AI ---
export function driveAICarToward(c, targetX, targetY, desiredSpeed, dt) {
    // Unstick reversing maneuver if wedged against an obstacle
    if (c.reverseTimer > 0) {
        c.reverseTimer -= dt;
        c.angle += 1.9 * dt;
        const revSpd = -115;
        c.vx += (Math.cos(c.angle) * revSpd - c.vx) * 6 * dt;
        c.vy += (Math.sin(c.angle) * revSpd - c.vy) * 6 * dt;
        c.speed = Math.hypot(c.vx, c.vy);
        return;
    }

    let desiredAng = Math.atan2(targetY - c.y, targetX - c.x);
    if (c.aiMode === 'police' || !isRoadTileType(tileAtWorld(c.x, c.y))) {
        desiredAng = applyWallFeelers(c.x, c.y, desiredAng, 68, true);
    }

    const diff = normalizeAngle(desiredAng - c.angle);
    const maxTurn = (c.aiMode === 'police' ? 4.2 : 3.8) * dt;
    c.angle += Math.max(-maxTurn, Math.min(maxTurn, diff * 4.5));

    // Slow down proportionally on sharp turns so vehicles don't swing wide onto sidewalks
    const cornerFactor = Math.max(0.45, 1 - Math.abs(diff) * 0.55);
    const flats = flatCount(c);
    const finalTargetSpd = desiredSpeed * cornerFactor * (flats ? flatSpeedMul(c) : 1);

    const fx = Math.cos(c.angle);
    const fy = Math.sin(c.angle);
    const rx = -fy;
    const ry = fx;

    let fwd = c.vx * fx + c.vy * fy;
    let lat = c.vx * rx + c.vy * ry;

    const accelRate = finalTargetSpd < fwd ? 6.5 : 3.8;
    fwd += (finalTargetSpd - fwd) * accelRate * dt;
    lat *= flats ? 0.94 : 0.78; // High lateral tire grip keeps AI cleanly inside lanes (blown tires slide)!

    c.vx = fx * fwd + rx * lat;
    c.vy = fy * fwd + ry * lat;
    c.speed = Math.hypot(c.vx, c.vy);

    // Detect if stuck trying to move forward against a wall or pileup
    if (desiredSpeed > 60 && c.speed < 18) {
        c.stuckTimer += dt;
        if (c.stuckTimer > (c.aiMode === 'police' ? 0.95 : 2.2)) {
            c.stuckTimer = 0;
            c.reverseTimer = 0.65;
        }
    } else {
        c.stuckTimer = Math.max(0, c.stuckTimer - dt * 2);
    }
}

export function updateTrafficCarAI(c, dt) {
    c.honkCooldown = Math.max(0, c.honkCooldown - dt);
    const tx = Math.floor(c.x / TILE);
    const ty = Math.floor(c.y / TILE);
    const curTile = tileAtWorld(c.x, c.y);

    let targetX, targetY;
    let desiredSpeed = c.cruiseSpeed;

    if (!isRoadTileType(curTile)) {
        // Knocked off-road onto sidewalk/grass -> smoothly recover to closest road tile!
        let bestDist = Infinity;
        let bestRX = c.x + Math.cos(c.angle) * 60;
        let bestRY = c.y + Math.sin(c.angle) * 60;
        let foundDir = c.roadDir;

        for (let dy = -3; dy <= 3; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
                const rtx = tx + dx;
                const rty = ty + dy;
                if (!isRoadCell(rtx, rty)) continue;
                const rcx = (rtx + 0.5) * TILE;
                const rcy = (rty + 0.5) * TILE;
                const d = Math.hypot(rcx - c.x, rcy - c.y);
                if (d < bestDist) {
                    bestDist = d;
                    bestRX = rcx;
                    bestRY = rcy;
                    const rt = mapGrid[rty][rtx];
                    if (rt === T_ROAD_H) foundDir = Math.cos(c.angle) >= 0 ? 0 : 2;
                    else if (rt === T_ROAD_V) foundDir = Math.sin(c.angle) >= 0 ? 1 : 3;
                }
            }
        }
        c.roadDir = foundDir;
        c.nextRoadDir = foundDir;
        c.intersectKey = -1;
        targetX = bestRX;
        targetY = bestRY;
        desiredSpeed = 115; // Cautious recovery speed back onto asphalt
    } else {
        // Ensure direction matches straight avenue orientation
        if (curTile === T_ROAD_H && (c.roadDir === 1 || c.roadDir === 3)) {
            c.roadDir = Math.cos(c.angle) >= 0 ? 0 : 2;
            c.nextRoadDir = c.roadDir;
        } else if (curTile === T_ROAD_V && (c.roadDir === 0 || c.roadDir === 2)) {
            c.roadDir = Math.sin(c.angle) >= 0 ? 1 : 3;
            c.nextRoadDir = c.roadDir;
        }

        if (curTile === T_ROAD_X) {
            const iKey = tx * 100 + ty;
            if (c.intersectKey !== iKey) {
                c.intersectKey = iKey;
                const reverseDir = (c.roadDir + 2) % 4;
                const validDirs = [0, 1, 2, 3].filter(
                    (d) => d !== reverseDir && isRoadCell(tx + DIR_VECS[d].dx, ty + DIR_VECS[d].dy)
                );
                if (validDirs.length === 0) {
                    c.nextRoadDir = reverseDir;
                } else if (validDirs.includes(c.roadDir) && Math.random() < 0.58) {
                    // 58% chance to continue straight down the avenue if open
                    c.nextRoadDir = c.roadDir;
                } else {
                    c.nextRoadDir = validDirs[Math.floor(Math.random() * validDirs.length)];
                }
            }

            // Wait until reaching the proper outgoing right-hand lane alignment before turning!
            if (c.nextRoadDir !== c.roadDir) {
                desiredSpeed *= 0.74;
                const isRightTurn = (c.roadDir + 1) % 4 === c.nextRoadDir;
                const leadDist = isRightTurn ? 26 : 18;

                if (c.roadDir === 0 || c.roadDir === 2) {
                    const outLaneX = getLaneCoord(tx, c.nextRoadDir);
                    const distToTurn = c.roadDir === 0 ? outLaneX - c.x : c.x - outLaneX;
                    if (distToTurn <= leadDist) {
                        c.roadDir = c.nextRoadDir;
                    }
                } else {
                    const outLaneY = getLaneCoord(ty, c.nextRoadDir);
                    const distToTurn = c.roadDir === 1 ? outLaneY - c.y : c.y - outLaneY;
                    if (distToTurn <= leadDist) {
                        c.roadDir = c.nextRoadDir;
                    }
                }
            }
        } else {
            c.intersectKey = -1;
            // Look ahead to next tile: if approaching an intersection, pre-slow slightly if congested
            const nextTX = tx + DIR_VECS[c.roadDir].dx;
            const nextTY = ty + DIR_VECS[c.roadDir].dy;
            if (isRoadCell(nextTX, nextTY) && mapGrid[nextTY][nextTX] === T_ROAD_X) {
                const interX = (nextTX + 0.5) * TILE;
                const interY = (nextTY + 0.5) * TILE;
                if (Math.hypot(interX - c.x, interY - c.y) < 115) {
                    // Yield to cross-traffic already inside the intersection!
                    for (const other of cars) {
                        if (other === c || other.hp <= 0) continue;
                        if (Math.hypot(other.x - interX, other.y - interY) < 62 && other.speed > 45) {
                            const dot =
                                Math.cos(c.angle) * Math.cos(other.angle) + Math.sin(c.angle) * Math.sin(other.angle);
                            if (dot < 0.5) {
                                desiredSpeed = 0;
                                break;
                            }
                        }
                    }
                }
            }
        }

        // Compute smooth lane-center lookahead waypoint 62px ahead along roadDir
        const lookAhead = 62;
        if (c.roadDir === 0) {
            targetX = c.x + lookAhead;
            targetY = getLaneCoord(ty, 0);
        } else if (c.roadDir === 2) {
            targetX = c.x - lookAhead;
            targetY = getLaneCoord(ty, 2);
        } else if (c.roadDir === 1) {
            targetX = getLaneCoord(tx, 1);
            targetY = c.y + lookAhead;
        } else {
            targetX = getLaneCoord(tx, 3);
            targetY = c.y - lookAhead;
        }
    }

    // Forward Traffic & Pedestrian Spacing Sensor
    const fx = Math.cos(c.angle);
    const fy = Math.sin(c.angle);

    for (const other of cars) {
        if (other === c) continue;
        const dx = other.x - c.x;
        const dy = other.y - c.y;
        const fwdDist = dx * fx + dy * fy;
        const latDist = Math.abs(-dx * fy + dy * fx);

        if (fwdDist > 0 && fwdDist < 130 && latDist < 26) {
            if (fwdDist < 62) {
                desiredSpeed = 0;
                if (other === player.inCar && c.honkCooldown <= 0 && Math.hypot(c.x - player.x, c.y - player.y) < 420) {
                    c.honkCooldown = 4 + Math.random() * 3;
                    audio.horn(c);
                }
            } else {
                const otherFwd = Math.max(0, other.vx * fx + other.vy * fy);
                desiredSpeed = Math.min(desiredSpeed, otherFwd * 0.88);
            }
        }
    }

    // Brake for pedestrians & on-foot player in crosswalks
    if (!player.inCar && player.deadTimer <= 0) {
        const dx = player.x - c.x;
        const dy = player.y - c.y;
        const fwdDist = dx * fx + dy * fy;
        const latDist = Math.abs(-dx * fy + dy * fx);
        if (fwdDist > 0 && fwdDist < 85 && latDist < 24) {
            desiredSpeed = 0;
            if (c.honkCooldown <= 0) {
                c.honkCooldown = 3.5;
                audio.horn(c);
            }
        }
    }

    for (const p of peds) {
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        const fwdDist = dx * fx + dy * fy;
        const latDist = Math.abs(-dx * fy + dy * fx);
        if (fwdDist > 0 && fwdDist < 78 && latDist < 22) {
            desiredSpeed = 0;
            break;
        }
    }

    driveAICarToward(c, targetX, targetY, desiredSpeed, dt);
}

// Next waypoint along the road-weighted flow field `field` (police pursuit, ambulances, fire trucks)
export function flowTarget(c, field) {
    const tx = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(c.x / TILE)));
    const ty = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(c.y / TILE)));
    let bestCost = field[ty][tx];
    let bestDir = c.roadDir;

    for (let d = 0; d < 4; d++) {
        const ntx = tx + DIR_VECS[d].dx;
        const nty = ty + DIR_VECS[d].dy;
        if (ntx < 0 || nty < 0 || ntx >= MAP_SIZE || nty >= MAP_SIZE) continue;
        const cost = field[nty][ntx];
        if (cost < bestCost) {
            bestCost = cost;
            bestDir = d;
        }
    }

    c.roadDir = bestDir;
    const ntx = tx + DIR_VECS[bestDir].dx;
    const nty = ty + DIR_VECS[bestDir].dy;
    if (isRoadCell(ntx, nty)) {
        // Stay in fast right-hand lane while en route down avenues
        return {
            x: bestDir === 1 || bestDir === 3 ? getLaneCoord(ntx, bestDir) : (ntx + 0.5) * TILE,
            y: bestDir === 0 || bestDir === 2 ? getLaneCoord(nty, bestDir) : (nty + 0.5) * TILE
        };
    }
    return { x: (ntx + 0.5) * TILE, y: (nty + 0.5) * TILE };
}

export function updatePoliceCarAI(c, dt) {
    const level = Math.max(1, Math.min(4, Math.floor(player.wanted)));
    const mul = c.spec.pursuitSpeed ?? WANTED_TIERS[level].speed;
    const distToPlayer = Math.hypot(player.x - c.x, player.y - c.y);
    const clearSight = distToPlayer < 420 && hasDriveLine(c.x, c.y, player.x, player.y);
    const pc = player.inCar;

    let targetX = player.x;
    let targetY = player.y;
    let pursuitSpeed;
    let pullOver = false;

    if (!clearSight) {
        // Navigate city avenues via the road-weighted flow-field!
        const t = flowTarget(c, policeFlowDist);
        targetX = t.x;
        targetY = t.y;
        pursuitSpeed = 335 * mul;
    } else if (pc && distToPlayer > 120) {
        pursuitSpeed = (distToPlayer > 110 ? 370 : 240) * mul;
        const pa = pc.angle;
        if (level === 1 && !c.spec.isFed && !c.spec.isSwat) {
            // Level 1: tail at a polite distance and try to pull the player over, no head-on rams
            if (pc.speed < 40) {
                pullOver = true;
                targetX = player.x + Math.cos(pa) * 90;
                targetY = player.y + Math.sin(pa) * 90;
            } else if (distToPlayer < 170) {
                targetX = player.x - Math.cos(pa) * 70;
                targetY = player.y - Math.sin(pa) * 70;
                pursuitSpeed = Math.max(60, pc.speed * 0.95);
            }
        } else if (level === 2 && !c.spec.isFed) {
            // Level 2: box-in. One unit hugs the rear quarter, the other cuts the player off
            if (c.pursuitRole === 'cutoff') {
                targetX = player.x + pc.vx * 0.6;
                targetY = player.y + pc.vy * 0.6;
            } else {
                const side = Math.sign((c.y - player.y) * Math.cos(pa) - (c.x - player.x) * Math.sin(pa)) || 1;
                targetX = player.x - Math.cos(pa) * 42 + -Math.sin(pa) * 34 * side;
                targetY = player.y - Math.sin(pa) * 42 + Math.cos(pa) * 34 * side;
            }
        } else {
            // Level 3-4: lead fast getaway cars to intercept, full ram
            targetX = player.x + pc.vx * 0.45;
            targetY = player.y + pc.vy * 0.45;
        }
    } else {
        pursuitSpeed = (distToPlayer > 110 ? 370 : 240) * mul;
    }

    // Cruisers never arrest. A pinned, stopped or stranded-on-foot target makes the crew pile out instead
    if (!c.dismount && c.crewCount > 0 && !c.stranded && wantsDismount(c, pc, distToPlayer, clearSight, dt)) {
        const wedged = pc && distToPlayer < (c.spec.l + pc.spec.l) * 0.75;
        c.dismount = { state: wedged ? 'backoff' : 'park', t: wedged ? 0.45 : 0 };
    }
    if (c.dismount) {
        runDismount(c, dt, level);
        return;
    }

    if (pullOver && Math.hypot(targetX - c.x, targetY - c.y) < 40) pursuitSpeed = 0;
    driveAICarToward(c, targetX, targetY, pursuitSpeed, dt);
}

// When does a pursuit vehicle stop and unload its crew?
function wantsDismount(c, pc, dist, clearSight, dt) {
    // Wedged against / stopped beside the player's halted car: 0.5s of mutual standstill
    if (pc && clearSight && pc.speed < 35 && c.speed < 35 && dist < 165) {
        c.pinT += dt;
        if (c.pinT >= 0.5) return true;
    } else c.pinT = Math.max(0, c.pinT - dt * 2);
    if (!pc && clearSight && dist < (c.spec.isFed ? 200 : c.spec.isSwat ? 280 : 220)) return true;
    if (c.spec.isSwat && clearSight && dist < 280) return true;
    return !!c.spec.isFed && c.hp < c.maxHp * 0.3;
}

// backoff: ease the nose off the player's car; park: brake to a halt. Then the doors open.
function runDismount(c, dt, level) {
    const d = c.dismount;
    const fx = Math.cos(c.angle);
    const fy = Math.sin(c.angle);
    if (d.state === 'backoff') {
        d.t -= dt;
        c.vx += (-fx * 85 - c.vx) * Math.min(1, 9 * dt); // reverse ~35px, no throttle
        c.vy += (-fy * 85 - c.vy) * Math.min(1, 9 * dt);
        if (d.t <= 0) c.dismount = { state: 'park', t: 0 };
    } else {
        d.t += dt;
        const k = Math.max(0, 1 - 7 * dt);
        c.vx *= k;
        c.vy *= k;
        if (Math.hypot(c.vx, c.vy) < 30 || d.t > 1.2) {
            unloadCruiser(c, level);
            return;
        }
    }
    c.handbrake = d.state === 'park';
    c.speed = Math.hypot(c.vx, c.vy);
}

// Park it, open the doors, officers out. The empty cruiser sits there flashing (and can be stolen)
function unloadCruiser(c, level) {
    c.vx = c.vy = c.speed = 0;
    c.handbrake = true;
    c.dismount = null;
    c.doorT = 0.5;
    deployCrew(c);
    c.crewCount = 0;
    c.driver = false;
    c.aiMode = 'parked';
    c.lightsOnly = true;
    c.sirenOn = false;
    c.stranded = true;
    c.pursuit = false; // frees the pursuit slot; dispatch tops it up after the usual replacement delay
    heat.dispatchCd = Math.max(heat.dispatchCd, WANTED_TIERS[level].replace);
}
