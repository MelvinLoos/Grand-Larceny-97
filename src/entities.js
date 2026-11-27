import { LANDMARKS, angleToRoadDir, isSidewalkAt, isSolidAt, pickRoadSpawnAnywhere } from './city.js';
import { CAR_TYPES, MAP_SIZE, SWIM_TIME, TILE, pickStation } from './config.js';
import { DISTRICTS, getDistrictAt, pickWeighted } from './districts.js';
import { surfaceAt } from './river.js';
import { PUNK_HAIR, ROLE_COLORS, pedLook, SHIRT_COLORS, VEHICLE_PALETTE } from './palette.js';
import { showPager, updateHUD } from './hud.js';
import { bullets, camera, cars, decals, floatingTexts, particles, peds, pickups, player } from './state.js';

export function addDecal(type, x, y, angle = 0, size = 10, color = 'rgba(0,0,0,0.45)') {
    decals.push({ type, x, y, angle, size, color });
    if (decals.length > 420) decals.shift();
}

// --- SPAWNING VEHICLES, PEDESTRIANS, PICKUPS ---
let nextCarId = 1;

// The only way a car enters the world: a car object is never inserted twice
export function addCar(c) {
    if (!cars.includes(c)) cars.push(c);
    return c;
}

// Foot crew a cruiser carries: they climb out when it is pinned or the player is on foot nearby
const CREW = { police: () => 1 + Math.floor(Math.random() * 2), fbi_car: () => 2, swat_van: () => 3 };

export function createCar(typeKey, x, y, angle = 0, aiMode = 'traffic') {
    const spec = CAR_TYPES[typeKey];
    // Grey-mask civilians get a district paint (paletteID indexes VEHICLE_PALETTE); liveried cars keep their own
    let paletteID = null;
    let color;
    if (spec.tint) {
        const pal = DISTRICTS[getDistrictAt(x, y)].carPalette;
        paletteID = pal[Math.floor(Math.random() * pal.length)];
        color = VEHICLE_PALETTE[paletteID];
    } else color = spec.colors[Math.floor(Math.random() * spec.colors.length)];
    const initDir = angleToRoadDir(angle);
    const surf = surfaceAt(x, y);
    return {
        id: nextCarId++, // unique identity, survives traffic recycling
        typeKey,
        spec,
        x,
        y,
        vx: 0,
        vy: 0,
        speed: 0,
        angle,
        z: surf.z, // height above the ground plane (bridge decks and ramps lift it)
        vz: 0,
        spin: 0, // airborne yaw rate
        airborne: false,
        onBridge: surf.deck,
        onRamp: surf.ramp,
        sink: 0, // 0 -> 1 while going down in the river
        sunk: false,
        jump: null,
        color,
        paletteID,
        turretAngle: angle, // tank only: where the cannon points, independent of the hull
        targetAngle: angle,
        doorT: 0, // seconds left on the door-flap animation
        hp: spec.hp,
        maxHp: spec.hp,
        aiMode, // 'traffic', 'parked', 'police', 'player', 'target'
        sirenOn: (!!spec.isPolice && aiMode === 'police') || aiMode === 'rescue',
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
        crewCount: CREW[typeKey]?.() ?? 0, // officers still aboard; 0 once they are out on foot
        dismount: null, // { state: 'backoff' | 'park', t } while a cruiser unloads
        pinT: 0, // seconds spent wedged against the player's stopped car
        stranded: false, // crew out on foot, cruiser parked with lights flashing
        pursuit: false, // actively hunting the player (capped per wanted level, see heat.js)
        pursuitRole: 'chase', // level 2 box-in: 'chase' hugs the rear quarter, 'cutoff' leads the target
        deployed: false, // SWAT / FBI crew already out of the vehicle
        deployT: 0,
        poppedTires: 0, // bitmask 0..15 of blown tires (see lawforce.js)
        burnT: 0, // seconds of wreck fire left (fire trucks douse it)
        medkitUsed: false,
        lightsOnly: false, // roadblock cruiser: strobing but silent
        roadblock: null,
        rescue: null, // ambulance / fire-truck job (see emergency.js)
        radioStation: pickStation(spec) // sticks with the car: jack it and you hear what they were playing
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
    player.swimming = false;
    player.breath = SWIM_TIME;

    // Parked cars on the Central Park north plaza (off active traffic lanes!)
    for (const pc of LANDMARKS.parkedCars) addCar(createCar(pc.type, pc.x, pc.y, pc.angle, 'parked'));

    // Secret Battle Tank behind the container stacks in the Harbor yard!
    addCar(createCar('tank', LANDMARKS.tank.x, LANDMARKS.tank.y, LANDMARKS.tank.angle, 'parked'));

    // Populate Traffic Cars cleanly aligned inside right-hand lanes, mix by district
    for (let i = 0; i < 55; i++) {
        const spot = pickRoadSpawnAnywhere();
        if (!spot || Math.hypot(spot.x - player.x, spot.y - player.y) < 240) continue;
        addCar(createCar(pickCarType(getDistrictAt(spot.x, spot.y)), spot.x, spot.y, spot.angle, 'traffic'));
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
        if (isSidewalkAt(wx, wy) && !isSolidAt(wx, wy, 8)) {
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

// On-foot law enforcement / medic: one factory so every role gets the same stats everywhere
const LAW_HP = { cop: 65, swat: 110, fed: 70, medic: 40 };
export function spawnLawPed(role, x, y, angle = 0, extra = {}) {
    const p = {
        x,
        y,
        angle,
        speed: role === 'swat' ? 125 : role === 'medic' ? 96 : 118,
        color: ROLE_COLORS[role],
        role,
        ...pedLook(role),
        hp: LAW_HP[role],
        panicTimer: 0,
        shootTimer: 0.6 + Math.random() * 0.5,
        burst: 0,
        ...extra
    };
    peds.push(p);
    return p;
}
