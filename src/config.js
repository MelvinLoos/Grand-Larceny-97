// --- CONFIGURATION & CONSTANTS ---
export const TILE = 144; // Size of one city tile in world pixels
export const MAP_SIZE = 60; // 60x60 city grid (8640 x 8640 world)
export const DISTRICT_SPLIT = 30; // avenue that splits the city into 4 quadrant districts
export const WORLD_SIZE = TILE * MAP_SIZE;

// Tile Types
export const T_WATER = 0;
export const T_GRASS = 1;
export const T_PAVEMENT = 2;
export const T_ROAD_H = 3;
export const T_ROAD_V = 4;
export const T_ROAD_X = 5;
export const T_BLDG = 6;
export const T_ALLEY = 7; // Brick back-alley / courtyard apron: player + foot traffic only
export const T_BAY = 8; // Recessed drive-in garage bay floor (see shops.js)
export const T_RAMP = 9; // Broken drawbridge stunt ramp stub (see river.js): player + reckless cops only

// --- VERTICAL PHYSICS (world px; z is height above the water/ground plane) ---
export const GRAVITY = 620;
export const DECK_Z = 18; // intact bridge deck height
export const RAMP_Z = 26; // broken drawbridge ramp lip height
export const LAUNCH_K = 0.58; // vz = LAUNCH_K * forward speed off a ramp lip
export const MIN_LAUNCH_SPEED = 220;
export const STUNT_MIN_DIST = 180;
export const SINK_TIME = 1.8;
export const SWIM_TIME = 3.5;
export const CAR_HIT_SPEED = 45; // a car must be at least this fast (px/s) and driving INTO someone to hurt them
export const PICKUP_RESPAWN = 60; // seconds before a collected pickup returns
export const METERS_PER_PX = 1 / 12; // HUD distance readout: a 56px car is roughly 4.7m
export const CAR_H = 16; // cars further apart than this vertically don't touch

// Per-tile behaviour table. flowCost feeds the police flow-field (Infinity = impassable).
const SOLID = {
    solid: true,
    sidewalk: false,
    drivableByPlayer: false,
    allowCivilianTraffic: false,
    flowCost: Infinity
};
const WALK = { solid: false, sidewalk: true, drivableByPlayer: true, allowCivilianTraffic: false, flowCost: 4.5 };
const ROAD = { solid: false, sidewalk: false, drivableByPlayer: true, allowCivilianTraffic: true, flowCost: 1 };
export const TILE_PROPS = {
    [T_WATER]: { ...SOLID, hazard: 'water' },
    [T_BLDG]: SOLID,
    [T_GRASS]: WALK,
    [T_PAVEMENT]: WALK,
    [T_ROAD_H]: ROAD,
    [T_ROAD_V]: ROAD,
    [T_ROAD_X]: ROAD,
    [T_ALLEY]: { solid: false, sidewalk: false, drivableByPlayer: true, allowCivilianTraffic: false, flowCost: 2.5 },
    [T_BAY]: { solid: false, sidewalk: false, drivableByPlayer: true, allowCivilianTraffic: false, flowCost: 3 },
    [T_RAMP]: { solid: false, sidewalk: false, drivableByPlayer: true, allowCivilianTraffic: false, flowCost: 6 }
};
export const isSolidTile = (t) => TILE_PROPS[t].solid;
export const isSidewalkTile = (t) => TILE_PROPS[t].sidewalk;

// Weapon Definitions
export const WEAPONS = [
    { id: 0, name: 'FIST', icon: 'i-fist', cooldown: 0.28, range: 42, damage: 25, auto: false },
    { id: 1, name: 'PISTOL', icon: 'i-pistol', cooldown: 0.24, range: 460, damage: 34, auto: false, speed: 780 },
    { id: 2, name: 'UZI SMG', icon: 'i-smg', cooldown: 0.09, range: 480, damage: 22, auto: true, speed: 840 },
    {
        id: 3,
        name: 'ROCKET',
        icon: 'i-rocket',
        cooldown: 0.85,
        range: 640,
        damage: 250,
        auto: false,
        speed: 520,
        explosive: true
    }
];

// Law enforcement roles on foot (cop = beat officer, swat = SWAT trooper, fed = FBI agent)
export const isLaw = (p) => p.role === 'cop' || p.role === 'swat' || p.role === 'fed';

// Number of blown tires (poppedTires is a 4-bit mask: FL, FR, RL, RR)
export const flatCount = (c) => {
    let n = 0;
    for (let m = c.poppedTires || 0; m; m &= m - 1) n++;
    return n;
};
// Top-speed multiplier for blown tires: ~65% with 1-2 flats, ~45% with 3-4
export const flatSpeedMul = (c) => {
    const n = flatCount(c);
    return n === 0 ? 1 : n <= 2 ? 0.65 : 0.45;
};

// Wanted-level tiers: active pursuit cap, speed multiplier, and seconds before a lost unit is replaced
export const WANTED_TIERS = [
    { cap: 0, speed: 0, replace: 0, foot: 0, fire: 2 },
    { cap: 1, speed: 0.88, replace: 12, foot: 0, fire: 1.6 },
    { cap: 2, speed: 1.0, replace: 8, foot: 3, fire: 1.1 },
    { cap: 3, speed: 1.06, replace: 8, foot: 5, fire: 0.85 },
    { cap: 4, speed: 1.12, replace: 6, foot: 6, fire: 0.85 }
];

// Radio stations (style picks the procedural generator in audio/radio.js)
export const STATIONS = {
    rush: { freq: '104.5', band: 'FM', name: 'RUSH 104', tag: 'Jungle at illegal speeds.', style: 'jungle' },
    meter: { freq: '88.3', band: 'FM', name: 'THE METER', tag: 'Electro-funk by the mile.', style: 'acid' },
    crash: { freq: '98.7', band: 'FM', name: 'CRASH FM', tag: 'All guitars. No brakes.', style: 'rock' },
    beige: { freq: '101.1', band: 'FM', name: 'BEIGE 101', tag: 'Soft hits for sitting in traffic.', style: 'soft' },
    talk: { freq: '640', band: 'AM', name: 'TALK BACK 640', tag: 'Callers who should not be calling.', style: 'talk' },
    harbor: {
        freq: '1010',
        band: 'AM',
        name: 'HARBOR HAUL AM',
        tag: 'Shipping forecasts and swearing.',
        style: 'talk'
    },
    nbpd: {
        freq: '155.4',
        band: 'MHz',
        name: 'NBPD DISPATCH',
        tag: "Suspect vehicle is... wait, that's you.",
        style: 'scanner'
    },
    army: {
        freq: '27.1',
        band: 'CB',
        name: 'ARMY SURPLUS RADIO',
        tag: 'Requests by artillery only.',
        style: 'scanner'
    },
    off: { freq: '--', band: '', name: 'RADIO OFF', tag: 'Just the engine. Bliss.', style: null }
};
// R cycles these in a civilian car; cop cars and the tank only toggle their own channel
export const CIVIL_STATIONS = ['rush', 'meter', 'crash', 'beige', 'talk', 'harbor', 'off'];
export const pickStation = (spec) => {
    let total = 0;
    for (const k in spec.stations) total += spec.stations[k];
    let r = Math.random() * total;
    for (const k in spec.stations) {
        r -= spec.stations[k];
        if (r <= 0) return k;
    }
    return 'off';
};

// Vehicle Archetypes
export const CAR_TYPES = {
    hellcrab: {
        name: 'HELLCRAB GTS',
        sprite: 'sports',
        tint: true,
        w: 30,
        l: 56,
        maxSpeed: 540,
        accel: 380,
        grip: 0.91,
        hp: 140,
        colors: ['#d23a2a', '#e0a21b', '#2f6db5', '#e2672a'],
        stripe: '#f4efe0',
        value: 1200,
        mass: 1,
        exportValue: 8000,
        stations: { rush: 4, meter: 2, crash: 1, off: 0.3 }
    },
    bumbler: {
        name: 'BUMBLER',
        sprite: 'sedan',
        tint: true,
        w: 29,
        l: 54,
        maxSpeed: 410,
        accel: 260,
        grip: 0.93,
        hp: 130,
        colors: ['#7c8794', '#3d8fb8', '#3f8f5e', '#8a5aa8', '#b9772f'],
        stripe: null,
        value: 600,
        mass: 1,
        exportValue: 2500,
        stations: { rush: 1, meter: 1, crash: 1, beige: 2, talk: 1, off: 0.3 }
    },
    cabbie: {
        name: 'CABBIE TAXI',
        sprite: 'taxi',
        w: 30,
        l: 55,
        maxSpeed: 430,
        accel: 290,
        grip: 0.92,
        hp: 145,
        colors: ['#f2c21b'],
        stripe: '#14130f',
        taxiSign: true,
        value: 800,
        mass: 1,
        exportValue: 2500,
        stations: { meter: 3, beige: 1, rush: 1, crash: 1, talk: 2, harbor: 1, off: 0.3 }
    },
    blitz: {
        name: 'BLITZ V8',
        sprite: 'muscle',
        tint: true,
        w: 31,
        l: 58,
        maxSpeed: 500,
        accel: 350,
        grip: 0.87,
        hp: 150,
        colors: ['#b8322a', '#2f7d4a', '#6b3fa0', '#d98b1f'],
        stripe: '#14130f',
        value: 1000,
        mass: 1,
        exportValue: 5000,
        stations: { crash: 4, meter: 3, rush: 1, off: 0.3 }
    },
    van: {
        name: 'BOX VAN',
        sprite: 'truck',
        w: 33,
        l: 62,
        maxSpeed: 360,
        accel: 220,
        grip: 0.94,
        hp: 210,
        colors: ['#e9e4d6', '#2b4a8a', '#4a4a46'],
        stripe: null,
        value: 750,
        mass: 1.9,
        exportValue: 2500,
        stations: { talk: 3, harbor: 1, crash: 1, off: 0.3 }
    },
    hauler: {
        name: 'DOCK HAULER',
        sprite: 'truck',
        w: 36,
        l: 72,
        maxSpeed: 330,
        accel: 190,
        grip: 0.95,
        hp: 300,
        colors: ['#a8431f', '#d98b1f', '#4a4a46', '#2b4a8a'],
        stripe: null,
        value: 900,
        mass: 2.8,
        exportValue: 2500,
        stations: { harbor: 3, talk: 1, crash: 1, off: 0.3 }
    },
    police: {
        name: 'COP CRUISER',
        sprite: 'police',
        w: 30,
        l: 56,
        maxSpeed: 525,
        accel: 390,
        grip: 0.92,
        hp: 175,
        colors: ['#1d2a44'],
        isPolice: true,
        value: 1500,
        mass: 1.1,
        stations: { nbpd: 1 }
    },
    // --- LEVEL 4 LAW: liveries are baked onto the truck / sports sprites at startup (vehicles.js) ---
    swat_van: {
        name: 'SWAT ENFORCER',
        sprite: 'truck',
        livery: 'swat',
        w: 34,
        l: 66,
        maxSpeed: 400,
        accel: 230,
        grip: 0.95,
        hp: 420,
        colors: ['#141a2b'],
        isPolice: true,
        isSwat: true,
        pursuitSpeed: 0.82,
        siren: 'wail',
        value: 2500,
        mass: 2.6,
        stations: { nbpd: 1 }
    },
    fbi_car: {
        name: 'FBI INTERCEPTOR',
        sprite: 'sports',
        livery: 'fbi',
        w: 30,
        l: 56,
        maxSpeed: 560,
        accel: 420,
        grip: 0.9,
        hp: 190,
        colors: ['#26282c'],
        isPolice: true,
        isFed: true,
        pursuitSpeed: 1.12,
        siren: 'yelp',
        value: 2200,
        mass: 1.1,
        stations: { nbpd: 1 }
    },
    // --- EMERGENCY SERVICES ---
    ambulance: {
        name: 'PARAMEDIC AMBULANCE',
        sprite: 'truck',
        livery: 'ambulance',
        w: 33,
        l: 64,
        maxSpeed: 380,
        accel: 240,
        grip: 0.94,
        hp: 230,
        colors: ['#f4f1ea'],
        isEmergency: true,
        siren: 'hilo',
        value: 900,
        mass: 2.0,
        stations: { talk: 1, off: 1 }
    },
    firetruck: {
        name: 'CITY FIRE ENGINE',
        sprite: 'truck',
        livery: 'firetruck',
        w: 36,
        l: 74,
        maxSpeed: 340,
        accel: 200,
        grip: 0.95,
        hp: 340,
        colors: ['#c0281f'],
        isEmergency: true,
        turret: true,
        siren: 'fire',
        value: 1200,
        mass: 3.0,
        stations: { talk: 1, off: 1 }
    },
    tank: {
        name: 'BATTLE TANK',
        sprite: 'tank_hull',
        w: 42,
        l: 68,
        maxSpeed: 260,
        accel: 260,
        grip: 0.97,
        hp: 900,
        colors: ['#56702f'],
        isTank: true,
        value: 5000,
        mass: 4,
        stations: { army: 1 }
    }
};
