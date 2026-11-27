import { audio } from './audio.js';
import { DIR_VECS, applyWallFeelers, isOnScreen, isSolidAt, policeFlowDist, tileAtWorld } from './city.js';
import { fireWeapon, triggerWastedOrBusted } from './combat.js';
import { CAR_H, MAP_SIZE, TILE, T_ROAD_H, T_ROAD_V, WANTED_TIERS } from './config.js';
import { addCar, addDecal, createCar, spawnLawPed } from './entities.js';
import { steerAroundTrunks, trunkBlocks } from './foliage.js';
import { buzz } from './haptics.js';
import { addCrime } from './heat.js';
import { showPager, spawnFloatingText, updateHUD } from './hud.js';
import { surfaceAt } from './river.js';
import { camera, cars, heat, particles, peds, player, roadblocks, spikeStrips } from './state.js';

// --- TIRES: spike strips and gunfire pop wheels (bits 0..3 = FL, FR, RL, RR) ---
function wheelPos(c, i) {
    const f = i < 2 ? 0.3 : -0.3;
    const side = i % 2 === 0 ? -0.42 : 0.42;
    const ca = Math.cos(c.angle);
    const sa = Math.sin(c.angle);
    return { x: c.x + ca * c.spec.l * f - sa * c.spec.w * side, y: c.y + sa * c.spec.l * f + ca * c.spec.w * side };
}

function spark(x, y, vx, vy) {
    particles.push({
        x,
        y,
        vx,
        vy,
        size: 2,
        square: true,
        color: Math.random() < 0.5 ? '#ff8a2a' : '#ffd400',
        life: 0.22 + Math.random() * 0.15,
        maxLife: 0.37
    });
}

export function popTires(car, n = 1) {
    const free = [0, 1, 2, 3].filter((i) => !(car.poppedTires & (1 << i)));
    let popped = 0;
    while (popped < n && free.length) {
        const i = free.splice(Math.floor(Math.random() * free.length), 1)[0];
        car.poppedTires |= 1 << i;
        popped++;
        const w = wheelPos(car, i);
        for (let k = 0; k < 10; k++) {
            const a = Math.random() * Math.PI * 2;
            spark(w.x, w.y, Math.cos(a) * (60 + Math.random() * 120), Math.sin(a) * (60 + Math.random() * 120));
        }
    }
    if (!popped) return;
    audio.tirePop(car.x, car.y);
    if (car === player.inCar) {
        camera.shake = Math.max(camera.shake, 6);
        buzz(40);
        spawnFloatingText('TIRE BLOWN!', car.x, car.y - 34, '#ff8a2a');
        updateHUD();
    }
}

// Bullets that land in a wheel well have a fair chance to blow that tire
export function maybePopByBullet(car, b) {
    if (b.damage < 22 || car.hp <= 0) return;
    const dx = b.x - car.x;
    const dy = b.y - car.y;
    const fwd = dx * Math.cos(car.angle) + dy * Math.sin(car.angle);
    const side = -dx * Math.sin(car.angle) + dy * Math.cos(car.angle);
    const atWheel =
        Math.abs(side) > car.spec.w * 0.28 && Math.abs(Math.abs(fwd) - car.spec.l * 0.3) < car.spec.l * 0.16;
    if (atWheel && Math.random() < 0.35) popTires(car, 1);
}

// Orange rim sparks + a scraped line on the asphalt instead of rubber skidmarks
export function updateRimSparks(c, dt) {
    if (!c.poppedTires || c.airborne || c.sink > 0 || Math.hypot(c.vx, c.vy) < 60) return;
    c.scrapeT = (c.scrapeT || 0) - dt;
    const mark = c.scrapeT <= 0;
    if (mark) c.scrapeT = 0.09;
    for (let i = 0; i < 4; i++) {
        if (!(c.poppedTires & (1 << i))) continue;
        const w = wheelPos(c, i);
        if (Math.random() < 0.7)
            spark(w.x, w.y, -c.vx * 0.15 + (Math.random() - 0.5) * 90, -c.vy * 0.15 + (Math.random() - 0.5) * 90);
        if (mark) addDecal('scrape', w.x, w.y, c.angle, 9);
    }
}

// --- SPIKE STRIPS ---
export function updateSpikes() {
    for (const s of spikeStrips) {
        const ca = Math.cos(s.angle);
        const sa = Math.sin(s.angle);
        for (const c of cars) {
            if (c.hp <= 0 || c.airborne || c.sink > 0 || s.hit.has(c)) continue;
            if (c.aiMode === 'parked' && c !== player.inCar) continue;
            if (Math.hypot(c.vx, c.vy) < 30 || Math.abs(c.z - s.z) > CAR_H) continue;
            const dx = c.x - s.x;
            const dy = c.y - s.y;
            if (Math.abs(dx * ca + dy * sa) < s.len / 2 + 8 && Math.abs(-dx * sa + dy * ca) < 18) {
                s.hit.add(c);
                popTires(c, 1 + (Math.random() < 0.5 ? 1 : 0));
            }
        }
    }
}

// --- CREWS ---
// A cruiser unloads its officers onto the pavement beside its doors (driver side first):
// beat cops from a patrol car, 3 troopers from a SWAT van, 2 agents from an FBI interceptor
export function deployCrew(c) {
    c.deployed = true;
    const role = c.spec.isSwat ? 'swat' : c.spec.isFed ? 'fed' : 'cop';
    const n = Math.max(1, c.crewCount);
    const reach = c.spec.w * 0.9 + 12;
    for (let i = 0; i < n; i++) {
        const side = i % 2 === 0 ? -1 : 1; // -1 = driver (left) door
        const back = c.angle + Math.PI;
        let x = c.x + Math.cos(c.angle + (Math.PI / 2) * side) * reach + Math.cos(back) * Math.floor(i / 2) * 14;
        let y = c.y + Math.sin(c.angle + (Math.PI / 2) * side) * reach + Math.sin(back) * Math.floor(i / 2) * 14;
        if (isSolidAt(x, y, 8)) {
            // that side is walled in: try the other door, else climb out where the car stands
            x = c.x + Math.cos(c.angle - (Math.PI / 2) * side) * reach;
            y = c.y + Math.sin(c.angle - (Math.PI / 2) * side) * reach;
            if (isSolidAt(x, y, 8)) {
                x = c.x;
                y = c.y;
            }
        }
        spawnLawPed(role, x, y, Math.atan2(player.y - y, player.x - x), { cruiser: c });
    }
    audio.door(c);
}

// Where a cop stands to work a car door: just outside the driver's (left) side
export function driverDoorPoint(car) {
    const a = car.angle - Math.PI / 2;
    const d = car.spec.w / 2 + 12;
    return { x: car.x + Math.cos(a) * d, y: car.y + Math.sin(a) * d };
}

// Dismounted officers with the player far away (or the heat gone) walk back to their ride.
// Returns true once the officer has climbed back in and should be removed.
export function returnToCruiser(p, dt) {
    const c = p.cruiser;
    const door = driverDoorPoint(c);
    const dd = Math.hypot(door.x - p.x, door.y - p.y);
    if (dd < 20) {
        c.crewCount++;
        c.doorT = 0.5;
        return true;
    }
    const ang = steerAroundTrunks(p.x, p.y, applyWallFeelers(p.x, p.y, Math.atan2(door.y - p.y, door.x - p.x), 28));
    p.angle = ang;
    const nx = p.x + Math.cos(ang) * p.speed * dt;
    const ny = p.y + Math.sin(ang) * p.speed * dt;
    if (!isSolidAt(nx, ny, 8) && !trunkBlocks(p.x, p.y, nx, ny, 8)) {
        p.x = nx;
        p.y = ny;
    }
    return false;
}

// A parked cruiser whose crew is out: re-manned once they are all back aboard, tidied up when abandoned
export function updateStrandedCruiser(c) {
    let out = 0;
    for (const p of peds) if (p.cruiser === c && p.hp > 0) out++;
    if (out > 0) return;
    if (c.crewCount > 0) {
        c.stranded = false;
        c.deployed = false;
        c.driver = true;
        c.aiMode = 'traffic';
        c.lightsOnly = false;
        c.sirenOn = false;
        c.handbrake = false;
    } else if (Math.hypot(c.x - player.x, c.y - player.y) > 1800 && !isOnScreen(c.x, c.y, 300)) {
        c.despawn = true; // crew gone for good and nobody is looking: reaped after the vehicle loop
    }
}

// --- LAW PEDS ON FOOT (cop / swat / fed): approach, hold cover at roadblocks, shoot, arrest ---
// ONLY an officer on foot ever arrests: reach you on foot, or wrench open the door of your stopped car
const GRAB_RANGE = 28;
const ARREST_TIME = 0.45;
const PULL_TIME = 0.6;
const STOPPED = 35; // a car slower than this can be grabbed through its door

export function updateLawPed(p, dt, distP, canSee) {
    const level = Math.max(1, Math.min(4, Math.floor(player.wanted)));
    const pc = player.inCar;
    const isCop = p.role === 'cop';
    const aim = Math.atan2(player.y - p.y, player.x - p.x);
    const range = p.role === 'swat' ? 380 : p.role === 'fed' ? 360 : 340;
    // Beat cops head for the driver's door of a halted car; everyone else (and any moving car) is just chased
    const door = isCop && pc && !pc.airborne && pc.sink <= 0 && pc.speed < STOPPED ? driverDoorPoint(pc) : null;
    const tx = door ? door.x : player.x;
    const ty = door ? door.y : player.y;
    const distT = Math.hypot(tx - p.x, ty - p.y);
    const closeIn = isCop && level <= 2; // levels 1-2: arrest, don't stand off and shoot

    if (p.cover) {
        // Roadblock officers hold their post behind the cruisers
        p.angle = aim;
        if (Math.hypot(p.cover.x - p.x, p.cover.y - p.y) > 14) {
            const a = Math.atan2(p.cover.y - p.y, p.cover.x - p.x);
            p.x += Math.cos(a) * p.speed * dt;
            p.y += Math.sin(a) * p.speed * dt;
        }
    } else {
        let moveAng = Math.atan2(ty - p.y, tx - p.x);
        if (!canSee) {
            // Follow flow-field around building corners!
            const ptx = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(p.x / TILE)));
            const pty = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(p.y / TILE)));
            let bestCost = policeFlowDist[pty][ptx];
            for (const dv of DIR_VECS) {
                const ntx = ptx + dv.dx;
                const nty = pty + dv.dy;
                if (ntx >= 0 && nty >= 0 && ntx < MAP_SIZE && nty < MAP_SIZE && policeFlowDist[nty][ntx] < bestCost) {
                    bestCost = policeFlowDist[nty][ntx];
                    moveAng = Math.atan2((nty + 0.5) * TILE - p.y, (ntx + 0.5) * TILE - p.x);
                }
            }
        }
        p.angle = steerAroundTrunks(p.x, p.y, applyWallFeelers(p.x, p.y, moveAng, 28));
        const holdOff = p.role === 'swat' ? 150 : 135;
        if (closeIn ? distT > 12 || !canSee : distP > holdOff || !canSee) {
            const nx = p.x + Math.cos(p.angle) * p.speed * dt;
            const ny = p.y + Math.sin(p.angle) * p.speed * dt;
            if (!isSolidAt(nx, ny, 8) && !trunkBlocks(p.x, p.y, nx, ny, 8)) {
                p.x = nx;
                p.y = ny;
            }
        }
    }

    if (isCop && !p.cover) {
        if (distP < 60) p.closeSeen = true;
        else if (p.closeSeen && distP > 140) p.provoked = true; // bolted from the grab: they open up
        if (distP < 70 && !pc && (p.freezeT || 0) <= 0) {
            p.freezeT = 5;
            spawnFloatingText('FREEZE!', p.x, p.y - 30, '#5a8fd6', 1.2);
            audio.yelp(p.x, p.y);
        }
        p.freezeT = Math.max(0, (p.freezeT || 0) - dt);

        if (!pc) {
            // On foot: close enough to grab, for a beat, once the exit grace is over
            p.pullT = 0;
            if (distP <= GRAB_RANGE && player.exitGrace <= 0) {
                p.arrestT = (p.arrestT || 0) + dt;
                if (p.arrestT >= ARREST_TIME) {
                    p.arrestT = 0;
                    triggerWastedOrBusted('BUSTED!');
                    return;
                }
            } else p.arrestT = 0;
        } else if (door && distT <= 16) {
            // At the door of a halted car: yank it open and drag the driver out
            p.arrestT = 0;
            if (!p.pullT) {
                pc.doorT = 0.5;
                audio.door(pc);
                spawnFloatingText('FREEZE!', p.x, p.y - 30, '#5a8fd6', 1.2);
            }
            p.pullT = (p.pullT || 0) + dt;
            p.angle = Math.atan2(pc.y - p.y, pc.x - p.x);
            if (p.pullT >= PULL_TIME) {
                p.pullT = 0;
                triggerWastedOrBusted('BUSTED!');
                return;
            }
        } else {
            p.arrestT = 0;
            p.pullT = 0;
        }
    }

    p.shootTimer -= dt;
    // Beat cops on a low heat hold fire unless you shot first or ran from them
    const mayFire = !isCop || level >= 3 || p.provoked;
    if (mayFire && canSee && p.shootTimer <= 0 && distP < range) {
        p.angle = aim;
        if (p.role === 'swat') {
            // Uzi burst: 3 rounds, then a breather
            fireWeapon(p.x, p.y, aim, 2, false);
            p.burst = (p.burst || 0) + 1;
            if (p.burst >= 3) {
                p.burst = 0;
                p.shootTimer = 1.4;
            } else p.shootTimer = 0.09;
        } else {
            p.shootTimer = p.role === 'fed' ? 0.55 : WANTED_TIERS[level].fire;
            fireWeapon(p.x, p.y, aim, 1, false);
        }
    }
}

// --- ROADBLOCKS (level 3+): V of cruisers with a narrow gap, sawhorses, cops in cover, spike strip ---
const BRIDGE_TX = 28; // flat middle tile of every bridge deck

function removeRoadblock(rb) {
    for (let i = cars.length - 1; i >= 0; i--)
        if (cars[i].roadblock === rb && cars[i] !== player.inCar) cars.splice(i, 1);
    for (let i = peds.length - 1; i >= 0; i--) if (peds[i].rb === rb) peds.splice(i, 1);
    for (let i = spikeStrips.length - 1; i >= 0; i--) if (spikeStrips[i].rb === rb) spikeStrips.splice(i, 1);
    roadblocks.splice(roadblocks.indexOf(rb), 1);
}

// Candidate block centre ahead of the player along `h`: bridge decks first, then straight avenue tiles
function findBlockSpot(h, minD, maxD) {
    const spots = { deck: null, road: null };
    for (let d = minD; d <= maxD; d += 40) {
        const x = player.x + Math.cos(h) * d;
        const y = player.y + Math.sin(h) * d;
        const tx = Math.floor(x / TILE);
        const ty = Math.floor(y / TILE);
        const onDeck = surfaceAt(x, y).deck && tx === BRIDGE_TX;
        const t = tileAtWorld(x, y);
        const axis = onDeck || t === T_ROAD_H ? 0 : t === T_ROAD_V ? Math.PI / 2 : null;
        if (axis === null || Math.abs(Math.cos(h - axis)) < 0.6) continue;
        const theta = axis === 0 ? (Math.cos(h) >= 0 ? 0 : Math.PI) : Math.sin(h) >= 0 ? Math.PI / 2 : -Math.PI / 2;
        const spot = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, theta, deck: onDeck };
        if (cars.some((c) => Math.hypot(c.x - spot.x, c.y - spot.y) < 90)) continue;
        if (onDeck) spots.deck ||= spot;
        else spots.road ||= spot;
    }
    return spots.deck || spots.road;
}

export function spawnRoadblock(force = false) {
    const pc = player.inCar;
    const h = pc && pc.speed > 40 ? Math.atan2(pc.vy, pc.vx) : (pc?.angle ?? player.angle);
    const spot = findBlockSpot(h, 750, 1100) || (force ? findBlockSpot(h, 350, 1500) : null);
    if (!spot) return null;

    const { theta, deck } = spot;
    const ax = Math.cos(theta);
    const ay = Math.sin(theta);
    const nx = -ay;
    const ny = ax;
    const at = (a, n) => ({ x: spot.x + ax * a + nx * n, y: spot.y + ay * a + ny * n });
    const g = deck ? 20 : 26; // half-width of the gap you have to squeeze through
    const off = g + 25;
    const swat = Math.floor(player.wanted) >= 4;
    const rb = { x: spot.x, y: spot.y, theta, expire: false, props: [] };

    // Two cruisers angled nose-to-nose around the gap
    [-1, 1].forEach((side) => {
        const p = at(0, side * off);
        const ang = side < 0 ? theta + Math.PI / 2 - 0.45 : theta - Math.PI / 2 + 0.45;
        const c = createCar('police', p.x, p.y, ang, 'parked');
        c.lightsOnly = true;
        c.roadblock = rb;
        addCar(c);

        // Standing officer taking cover behind the cruiser
        const cv = at(34, side * (off - 4));
        spawnLawPed(swat ? 'swat' : 'cop', cv.x, cv.y, theta + Math.PI, { cover: { x: cv.x, y: cv.y }, rb });
        // Sawhorse just outside the gap in front of the cruiser
        const sh = at(-34, side * (g + 16));
        rb.props.push({ x: sh.x, y: sh.y, angle: theta + Math.PI / 2 + side * 0.15, hit: false, life: 0 });
    });
    if (swat) {
        const p = at(92, -(g + 24));
        const van = createCar('swat_van', p.x, p.y, theta, 'parked');
        van.lightsOnly = true;
        van.deployed = true;
        van.roadblock = rb;
        addCar(van);
    }

    // The spike strip lies across the gap, where you will drive over it
    const sp = at(-54, 0);
    spikeStrips.push({
        x: sp.x,
        y: sp.y,
        angle: theta + Math.PI / 2,
        len: 58,
        z: surfaceAt(sp.x, sp.y).z,
        hit: new Set(),
        rb
    });
    roadblocks.push(rb);
    heat.roadblockCd = 25;
    return rb;
}

export function updateRoadblocks(dt) {
    const level = Math.floor(player.wanted);
    for (let i = roadblocks.length - 1; i >= 0; i--) {
        const rb = roadblocks[i];
        const d = Math.hypot(rb.x - player.x, rb.y - player.y);
        if (level < 3) rb.expire = true;
        if (d > 2400 || (rb.expire && d > 1000)) {
            removeRoadblock(rb);
            continue;
        }
        // Sawhorses fly when a car clips them
        for (const pr of rb.props) {
            if (pr.hit) {
                pr.life -= dt;
                pr.x += pr.vx * dt;
                pr.y += pr.vy * dt;
                pr.angle += pr.spin * dt;
                continue;
            }
            for (const c of cars) {
                if (c.hp <= 0 || c.aiMode === 'parked' || c.airborne) continue;
                const spd = Math.hypot(c.vx, c.vy);
                if (spd > 60 && Math.hypot(c.x - pr.x, c.y - pr.y) < 24) {
                    pr.hit = true;
                    pr.life = 0.8;
                    pr.vx = c.vx * 1.1 + (Math.random() - 0.5) * 60;
                    pr.vy = c.vy * 1.1 + (Math.random() - 0.5) * 60;
                    pr.spin = (Math.random() - 0.5) * 18;
                    audio.impact(pr.x, pr.y, 'metal');
                    if (c === player.inCar) addCrime('prop', { x: pr.x, y: pr.y });
                    break;
                }
            }
        }
    }

    if (
        level >= 3 &&
        player.inCar &&
        player.inCar.speed > 150 &&
        heat.roadblockCd <= 0 &&
        !roadblocks.some((r) => !r.expire)
    ) {
        if (spawnRoadblock()) showPager('ROADBLOCK AHEAD! WATCH FOR SPIKE STRIPS!');
        else heat.roadblockCd = 3; // nothing suitable yet: look again shortly
    }
}
