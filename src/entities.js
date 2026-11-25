import { DIR_VECS, angleToRoadDir, getLaneCoord, tileAtWorld } from './city.js';
import { CAR_TYPES, MAP_SIZE, TILE, T_GRASS, T_PAVEMENT } from './config.js';
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

export function populateWorld() {
    cars.length = 0;
    peds.length = 0;
    bullets.length = 0;
    particles.length = 0;
    pickups.length = 0;
    decals.length = 0;
    floatingTexts.length = 0;

    // Spawn Player in Central Park Plaza
    player.x = 13.5 * TILE;
    player.y = 11.7 * TILE;
    player.vx = 0;
    player.vy = 0;
    player.hp = 100;
    player.armor = 50;
    player.wanted = 0;
    player.inCar = null;
    player.deadTimer = 0;
    player.weaponIdx = 1;
    player.ammo = [Infinity, 99, 150, 8];

    // Parked Hellcrab GTS & Blitz V8 neatly on Central Park North Plaza (off active traffic lanes!)
    cars.push(createCar('hellcrab', 14.35 * TILE, 11.32 * TILE, 0, 'parked'));
    cars.push(createCar('blitz', 11.35 * TILE, 11.35 * TILE, Math.PI * 0.5, 'parked'));

    // Secret Battle Tank in SE Dockyard!
    cars.push(createCar('tank', 27.5 * TILE, 27.5 * TILE, -Math.PI * 0.5, 'parked'));

    // Populate Traffic Cars cleanly aligned inside right-hand lanes
    const trafficKeys = ['bumbler', 'cabbie', 'blitz', 'hellcrab', 'van', 'bumbler', 'cabbie'];
    const roadIndices = [2, 6, 10, 14, 18, 22, 26, 30];
    for (let i = 0; i < 40; i++) {
        const roadIdx = roadIndices[Math.floor(Math.random() * roadIndices.length)];
        const horiz = Math.random() < 0.5;
        // Spawn mid-block (avoid spawning directly inside intersections)
        const segBase = roadIndices[Math.floor(Math.random() * (roadIndices.length - 1))];
        const posAlong = (segBase + 1.2 + Math.random() * 1.6) * TILE;
        const forward = Math.random() < 0.5;

        let dir, cx, cy;
        if (horiz) {
            dir = forward ? 0 : 2;
            cx = posAlong;
            cy = getLaneCoord(roadIdx, dir);
        } else {
            dir = forward ? 1 : 3;
            cx = getLaneCoord(roadIdx, dir);
            cy = posAlong;
        }

        if (Math.hypot(cx - player.x, cy - player.y) > 240) {
            // Ensure cars don't spawn overlapping each other
            let overlap = false;
            for (const existing of cars) {
                if (Math.hypot(existing.x - cx, existing.y - cy) < 85) {
                    overlap = true;
                    break;
                }
            }
            if (!overlap) {
                const tk = Math.random() < 0.12 ? 'police' : trafficKeys[i % trafficKeys.length];
                cars.push(createCar(tk, cx, cy, DIR_VECS[dir].ang, 'traffic'));
            }
        }
    }

    // Spawn Regular Pedestrians
    for (let i = 0; i < 65; i++) {
        spawnRandomPed();
    }

    // Spawn "HALLELUJAH!" Orange Joggers in a synchronized conga line in Central Park!
    const jogStartX = 12.6 * TILE;
    const jogStartY = 12.4 * TILE;
    for (let j = 0; j < 7; j++) {
        peds.push({
            x: jogStartX - j * 22,
            y: jogStartY,
            angle: 0,
            speed: 56,
            color: '#fb923c', // Bright Hallelujah orange!
            role: 'hallelujah',
            leaderIdx: j === 0 ? -1 : j - 1,
            waypointIdx: 0,
            hp: 20,
            panicTimer: 0,
            shootTimer: 0
        });
    }

    // Spawn Weapon, Health, Armor & Bribe Pickups across alleys and parks
    const pickupSpots = [
        { x: 14.5 * TILE, y: 14.5 * TILE, kind: 'uzi', color: '#ffd400' },
        { x: 9.5 * TILE, y: 9.5 * TILE, kind: 'armor', color: '#5a8fd6' },
        { x: 19.5 * TILE, y: 15.5 * TILE, kind: 'rocket', color: '#ff8a2a' },
        { x: 7.5 * TILE, y: 19.5 * TILE, kind: 'health', color: '#d23a2a' },
        { x: 24.5 * TILE, y: 24.5 * TILE, kind: 'rocket', color: '#ff8a2a' },
        { x: 15.5 * TILE, y: 7.5 * TILE, kind: 'bribe', color: '#a855f7' },
        { x: 21.5 * TILE, y: 21.5 * TILE, kind: 'health', color: '#d23a2a' }
    ];
    for (const p of pickupSpots) {
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
        const t = tileAtWorld(wx, wy);
        if (t === T_PAVEMENT || t === T_GRASS) {
            const shirtColors = ['#60a5fa', '#f472b6', '#34d399', '#c084fc', '#ffd400', '#e2e8f0'];
            peds.push({
                x: wx,
                y: wy,
                angle: Math.floor(Math.random() * 4) * (Math.PI * 0.5),
                speed: role === 'cop' ? 115 : 46,
                color: role === 'cop' ? '#1d4ed8' : shirtColors[Math.floor(Math.random() * shirtColors.length)],
                role,
                hp: role === 'cop' ? 60 : role === 'boss' ? 120 : 25,
                panicTimer: 0,
                shootTimer: 0.6
            });
            return peds[peds.length - 1];
        }
    }
    return null;
}
