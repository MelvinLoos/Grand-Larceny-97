import { LANDMARKS, angleToRoadDir, pickRoadSpawnAnywhere, tileAtWorld } from './city.js';
import { CAR_TYPES, MAP_SIZE, TILE, isSidewalkTile } from './config.js';
import { DISTRICTS, getDistrictAt, pickWeighted } from './districts.js';
import { PUNK_HAIR, pedLook, SHIRT_COLORS } from './palette.js';
import { showPager, updateHUD } from './hud.js';
import { bullets, camera, cars, decals, floatingTexts, particles, peds, pickups, player } from './state.js';

export function addDecal(type, x, y, angle = 0, size = 10, color = 'rgba(0,0,0,0.45)') {
    decals.push({ type, x, y, angle, size, color });
    if (decals.length > 420) decals.shift();
}

// --- SPAWNING VEHICLES, PEDESTRIANS, PICKUPS ---
export function createCar(typeKey, x, y, angle = 0, aiMode = 'traffic') {
    const spec = CAR_TYPES[typeKey];
    const color = spec.colors[Math.floor(Math.random() * spec.colors.length)];
    const initDir = angleToRoadDir(angle);
    return {
        typeKey,
        spec,
        x,
        y,
        vx: 0,
        vy: 0,
        speed: 0,
        angle,
        color,
        hp: spec.hp,
        maxHp: spec.hp,
        aiMode, // 'traffic', 'parked', 'police', 'player', 'target'
        sirenOn: !!spec.isPolice && aiMode === 'police',
        driver: aiMode !== 'parked',
        burnTimer: 0,
        turnCooldown: 0,
        roadDir: initDir,
        nextRoadDir: initDir,
        intersectKey: -1,
        cruiseSpeed: Math.min(245, spec.maxSpeed * (0.44 + Math.random() * 0.08)),
        honkCooldown: 0,
        stuckTimer: 0,
        reverseTimer: 0,
        deployedCop: false
    };
}

// Traffic mix follows the district the car spawns in
export function pickCarType(districtIdx) {
    return pickWeighted(DISTRICTS[districtIdx].traffic);
}

export function populateWorld() {
    cars.length = 0;
    peds.length = 0;
    bullets.length = 0;
    particles.length = 0;
    pickups.length = 0;
    decals.length = 0;
    floatingTexts.length = 0;

    // Spawn Player on Central Park's north plaza
    player.x = LANDMARKS.playerSpawn.x;
    player.y = LANDMARKS.playerSpawn.y;
    player.vx = 0;
    player.vy = 0;
    player.hp = 100;
    player.armor = 50;
    player.wanted = 0;
    player.inCar = null;
    player.deadTimer = 0;
    player.weaponIdx = 1;
    player.ammo = [Infinity, 99, 150, 8];
    player.currentDistrict = -1;
    player.probation = 0;
    player.probationWanted = 0;

    // Parked cars on the Central Park north plaza (off active traffic lanes!)
    for (const pc of LANDMARKS.parkedCars) cars.push(createCar(pc.type, pc.x, pc.y, pc.angle, 'parked'));

    // Secret Battle Tank behind the container stacks in the Harbor yard!
    cars.push(createCar('tank', LANDMARKS.tank.x, LANDMARKS.tank.y, LANDMARKS.tank.angle, 'parked'));

    // Populate Traffic Cars cleanly aligned inside right-hand lanes, mix by district
    for (let i = 0; i < 55; i++) {
        const spot = pickRoadSpawnAnywhere();
        if (!spot || Math.hypot(spot.x - player.x, spot.y - player.y) < 240) continue;
        cars.push(createCar(pickCarType(getDistrictAt(spot.x, spot.y)), spot.x, spot.y, spot.angle, 'traffic'));
    }

    // Spawn Regular Pedestrians
    for (let i = 0; i < 80; i++) {
        spawnRandomPed();
    }

    // Spawn "HALLELUJAH!" Orange Joggers in a synchronized conga line in Central Park!
    const jogStart = LANDMARKS.parkLoop[3];
    for (let j = 0; j < 7; j++) {
        peds.push({
            x: jogStart.x - j * 22,
            y: jogStart.y,
            angle: 0,
            speed: 56,
            color: '#fb923c', // Bright Hallelujah orange!
            role: 'hallelujah',
            ...pedLook('hallelujah'),
            leaderIdx: j === 0 ? -1 : j - 1,
            waypointIdx: 0,
            hp: 20,
            panicTimer: 0,
            shootTimer: 0
        });
    }

    // Weapon, Health, Armor & Bribe Pickups spread over the districts
    for (const p of LANDMARKS.pickups) {
        pickups.push({ ...p, timer: 0 });
    }

    camera.x = player.x;
    camera.y = player.y;
    updateHUD();
    showPager('RINGING PAYPHONES HAVE JOBS! PRESS [ENTER] NEAR A CAR TO STEAL IT!');
}

export function spawnRandomPed(role = 'civilian', nearPlayer = false) {
    for (let tries = 0; tries < 20; tries++) {
        let wx, wy;
        if (nearPlayer) {
            const ang = Math.random() * Math.PI * 2;
            const dist = 520 + Math.random() * 380;
            wx = player.x + Math.cos(ang) * dist;
            wy = player.y + Math.sin(ang) * dist;
        } else {
            wx = (2 + Math.random() * (MAP_SIZE - 4)) * TILE;
            wy = (2 + Math.random() * (MAP_SIZE - 4)) * TILE;
        }
        if (isSidewalkTile(tileAtWorld(wx, wy))) {
            const dp = DISTRICTS[getDistrictAt(wx, wy)].peds;
            const shirts = role === 'civilian' && dp.shirts ? dp.shirts : SHIRT_COLORS;
            peds.push({
                x: wx,
                y: wy,
                angle: Math.floor(Math.random() * 4) * (Math.PI * 0.5),
                speed: role === 'cop' ? 115 : 46,
                color: role === 'cop' ? '#1d4ed8' : shirts[Math.floor(Math.random() * shirts.length)],
                role,
                ...pedLook(role, role === 'civilian' && dp.punk ? PUNK_HAIR : null),
                hp: role === 'cop' ? 60 : role === 'boss' ? 120 : 25,
                panicTimer: 0,
                shootTimer: 0.6
            });
            return peds[peds.length - 1];
        }
    }
    return null;
}
