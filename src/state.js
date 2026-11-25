import { WORLD_SIZE } from './config.js';

export const canvas = document.getElementById('gameCanvas');
export const ctx = canvas.getContext('2d');

// Input state
export const keys = {};
export const mouse = { x: 0, y: 0, down: false, worldX: 0, worldY: 0 };
// Analog touch stick: x/y = unit direction, mag = 0..1 after deadzone
export const stick = { active: false, x: 0, y: 0, mag: 0 };

// World Map & Building metadata
export const mapGrid = [];
export const bldgMeta = []; // Height, color palette, roof detail per tile
export const bays = []; // drive-in garage bays (see shops.js)
export const payphones = [];

// Entities
export const decals = []; // Tire marks, blood splats, scorch craters
export const cars = [];
export const peds = [];
export const bullets = [];
export const particles = [];
export const pickups = [];
export const floatingTexts = [];
export const foliage = []; // trees, groves, bushes (see foliage.js)
export const foliageGrid = new Map(); // tile index (ty * MAP_SIZE + tx) -> foliage on that tile

// Camera
export const camera = {
    x: WORLD_SIZE * 0.5,
    y: WORLD_SIZE * 0.5,
    zoom: 1.0,
    targetZoom: 1.0,
    shake: 0
};

// Player Object
export const player = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    hp: 100,
    maxHp: 100,
    armor: 25,
    score: 0,
    multiplier: 1,
    wanted: 0,
    wantedDecay: 0,
    inCar: null,
    weaponIdx: 1,
    ammo: [Infinity, 99, 150, 8],
    fireTimer: 0,
    deadTimer: 0,
    deadReason: '',
    walkCycle: 0,
    currentDistrict: -1,
    probation: 0, // seconds of flashing probation left after a respray
    probationWanted: 0
};

// Harbor Export orders: which models are still wanted (reset after the $25,000 bonus)
export const exportBoard = { hellcrab: false, blitz: false, cabbie: false, bumbler: false };

// Active Payphone Mission State
export const mission = {
    active: false,
    stage: 0,
    type: '',
    title: '',
    targetX: 0,
    targetY: 0,
    targetEntity: null,
    timer: 0,
    completedCount: 0
};
// Scalar view size (was viewW / viewH)
export const view = { w: 800, h: 600, dpr: 1, fit: 1 };

// Misc mutable game flags that used to be loose top-level `let`s
export const game = {
    state: 'title', // 'title' | 'play' | 'paused'
    manualFrom: 'play',
    lastFrameTime: 0,
    attractWindow: null,
    lastWantedLevel: -1,
    districtTimer: null,
    districtCooldown: 0,
    gangTimer: 0,
    mapOpen: false,
    mapFrom: 'play',
    pagerTimeout: null,
    radioTimer: null,
    policeFlowTimer: 0,
    dprCap: 2,
    frameEma: 16,
    slowTime: 0
};
