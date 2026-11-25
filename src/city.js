import {
    MAP_SIZE,
    TILE,
    TILE_PROPS,
    T_ALLEY,
    T_BAY,
    T_BLDG,
    T_GRASS,
    T_PAVEMENT,
    T_ROAD_H,
    T_ROAD_V,
    T_ROAD_X,
    T_WATER,
    isSolidTile
} from './config.js';
import { D_MIDTOWN, DISTRICTS, buildingMeta, containerMeta, districtAtTile, pickWeighted } from './districts.js';
import { bays, bldgMeta, cars, mapGrid, payphones, player } from './state.js';

// --- CITY GENERATION ---
// 60x60 tiles. Avenues every 4 tiles (x or y % 4 === 2) incl. a full perimeter loop (2 and 58),
// so every road tile has at least two road neighbours: zero dead-end stubs for the traffic AI.
// Blocks are 3x3 tiles at 3 + 4n. Three superblocks swallow their interior avenues (T-junctions).
const BLOCKS = 14;
const blockOrigin = (n) => 3 + 4 * n;

// 3x3 block templates. B building  . pavement  A alley/courtyard apron  Y drive-in bay  (rotated cw k*90deg)
const TEMPLATES = {
    standard: ['.B.', 'BBB', '.B.'],
    towers: ['BB.', 'BBB', '.BB'],
    L: ['BBB', 'BAA', 'BAA'],
    U: ['BBB', 'BAB', 'BAB'], // open to the south at rot 0
    split: ['BBB', 'AAA', 'BBB'], // brick back-alley cutting through two buildings
    whRow: ['BBB', '...', 'BBB'],
    whSingle: ['BBB', '...', '...'],
    plaza: ['...', '...', '...'],
    bayAlley: ['BBB', 'BYB', 'AAA'], // bay recessed into the north building, alley links both avenues
    bayStub: ['BBB', 'BYB', 'BAB'] // 1-tile driveway from the south avenue straight into the bay
};

// Superblocks (block coords, inclusive) and fixed landmark blocks
const PARK = { bx0: 9, by0: 3, bx1: 10, by1: 4 }; // 2x2 Central Park, Parkside
const PLAZA = { bx0: 2, by0: 3, bx1: 3, by1: 3 }; // 2x1 Financial Plaza, Downtown
const YARD = { bx0: 11, by0: 12, bx1: 12, by1: 12 }; // 2x1 container yard, Harbor
const FIXED = {
    '12,1': { tpl: 'bayStub', rot: 0, bay: 'spray' }, // Parkside Spray-B-Gone
    '3,9': { tpl: 'bayAlley', rot: 0, bay: 'spray' }, // Midtown alley Spray-B-Gone
    '9,9': { tpl: 'bayAlley', rot: 0, bay: 'bomb' }, // Harbor warehouse alley bomb shop
    '1,8': { tpl: 'U', rot: 0, turf: '#7c2d92' }, // Midtown gang courtyards (purple)
    '5,11': { tpl: 'U', rot: 2, turf: '#be123c' } // (crimson)
};

// Container yard (7x3 tiles): C container  B export shed  Y export bay  T battle tank  . concrete
const YARD_MASK = ['CCBBBCC', 'C.BYBTC', 'C.....C'];

// Exported world anchors: everything that used to be a hardcoded coordinate
export const LANDMARKS = {
    playerSpawn: { x: 0, y: 0 },
    parkRect: { x0: 0, y0: 0, x1: 0, y1: 0 }, // tile bounds, inclusive
    plazaRect: { x0: 0, y0: 0, x1: 0, y1: 0 },
    yardRect: { x0: 0, y0: 0, x1: 0, y1: 0 },
    parkCenter: { x: 0, y: 0 },
    parkLoop: [],
    parkedCars: [],
    tank: { x: 0, y: 0, angle: 0 },
    pickups: [],
    gangTurfs: [],
    missions: {
        hotCar: { x: 0, y: 0 },
        boss: { x: 0, y: 0 },
        vanSpawn: { x: 0, y: 0 },
        drop: { x: 0, y: 0 }
    },
    keepClear: []
};

function rngFor(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function rotateTemplate(rows, k) {
    let g = rows.map((r) => r.split(''));
    for (let i = 0; i < ((k % 4) + 4) % 4; i++) {
        g = g[0].map((_, c) => g.map((row) => row[c]).reverse());
    }
    return g.map((r) => r.join(''));
}

const setTile = (x, y, t, meta = null) => {
    mapGrid[y][x] = t;
    bldgMeta[y][x] = meta;
};

function stampChar(x, y, ch, rand) {
    if (ch === 'B') setTile(x, y, T_BLDG, buildingMeta(x, y, rand));
    else if (ch === 'C') setTile(x, y, T_BLDG, containerMeta(x, y));
    else if (ch === 'A') setTile(x, y, T_ALLEY);
    else if (ch === 'Y') setTile(x, y, T_BAY);
    else setTile(x, y, T_PAVEMENT);
}

function findBayEntrance(tx, ty) {
    for (let d = 0; d < 4; d++) {
        const nx = tx + DIR_VECS[d].dx;
        const ny = ty + DIR_VECS[d].dy;
        if (mapGrid[ny][nx] === T_ALLEY || mapGrid[ny][nx] === T_PAVEMENT) return d;
    }
    return 1;
}

// Tile -> bay lookup; a shut shutter makes the bay tile solid for cars, peds, bullets and line of sight
export const bayByTile = new Map();
export function isBayShut(tx, ty) {
    const b = bayByTile.get(ty * MAP_SIZE + tx);
    return !!b && b.shutter < 0.55;
}

function neighbourMeta(tx, ty) {
    for (const dv of DIR_VECS) {
        const m = bldgMeta[ty + dv.dy][tx + dv.dx];
        if (m && m.kind === 'building') return m;
    }
    return buildingMeta(tx, ty, () => 0.5);
}

function registerBay(type, tx, ty) {
    const dir = findBayEntrance(tx, ty);
    const v = DIR_VECS[dir];
    const bay = {
        type,
        tx,
        ty,
        dir,
        x: (tx + 0.5) * TILE,
        y: (ty + 0.5) * TILE,
        ex: (tx + 0.5 + v.dx) * TILE, // apron tile centre in front of the shutter
        ey: (ty + 0.5 + v.dy) * TILE,
        shutter: 0, // 1 = fully open, 0 = shut
        roofAlpha: 1,
        state: 'idle', // idle | reject | service | rollout
        timer: 0,
        cooldown: 0,
        meta: { ...neighbourMeta(tx, ty), style: -1, neon: null }
    };
    bays.push(bay);
    bayByTile.set(ty * MAP_SIZE + tx, bay);
}

// Nearest plain pavement tile to (tx, ty) that no landmark has claimed
function pavementNear(tx, ty, taken) {
    for (let r = 0; r < 12; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const x = tx + dx;
                const y = ty + dy;
                if (x < 2 || y < 2 || x >= MAP_SIZE - 2 || y >= MAP_SIZE - 2) continue;
                if (mapGrid[y][x] !== T_PAVEMENT || taken.has(y * MAP_SIZE + x)) continue;
                taken.add(y * MAP_SIZE + x);
                return { tx: x, ty: y };
            }
        }
    }
    return { tx, ty };
}

export function buildCity() {
    bays.length = 0;
    bayByTile.clear();
    payphones.length = 0;
    LANDMARKS.gangTurfs.length = 0;
    LANDMARKS.parkedCars.length = 0;
    LANDMARKS.pickups.length = 0;
    LANDMARKS.keepClear.length = 0;

    // 1. Base grid: sea, promenade strip, avenues, bare block interiors
    for (let y = 0; y < MAP_SIZE; y++) {
        mapGrid[y] = [];
        bldgMeta[y] = [];
        for (let x = 0; x < MAP_SIZE; x++) {
            bldgMeta[y][x] = null;
            if (x === 0 || y === 0 || x === MAP_SIZE - 1 || y === MAP_SIZE - 1) mapGrid[y][x] = T_WATER;
            else if (x === 1 || y === 1) mapGrid[y][x] = T_PAVEMENT;
            else {
                const isRoadX = x % 4 === 2;
                const isRoadY = y % 4 === 2;
                if (isRoadX && isRoadY) mapGrid[y][x] = T_ROAD_X;
                else if (isRoadY) mapGrid[y][x] = T_ROAD_H;
                else if (isRoadX) mapGrid[y][x] = T_ROAD_V;
                else mapGrid[y][x] = T_PAVEMENT;
            }
        }
    }

    const inSuper = (bx, by, S) => bx >= S.bx0 && bx <= S.bx1 && by >= S.by0 && by <= S.by1;

    // 2. Regular blocks
    for (let by = 0; by < BLOCKS; by++) {
        for (let bx = 0; bx < BLOCKS; bx++) {
            if (inSuper(bx, by, PARK) || inSuper(bx, by, PLAZA) || inSuper(bx, by, YARD)) continue;
            const x0 = blockOrigin(bx);
            const y0 = blockOrigin(by);
            const d = districtAtTile(x0 + 1, y0 + 1);
            const r = rngFor(bx * 7919 + by * 104729 + 17);
            const fixed = FIXED[`${bx},${by}`];
            const tplName = fixed ? fixed.tpl : pickWeighted(DISTRICTS[d].blocks, r);
            const rot = fixed ? fixed.rot : Math.floor(r() * 4);
            const rows = rotateTemplate(TEMPLATES[tplName], rot);

            let turfMin = null;
            let turfMax = null;
            const pendingBays = [];
            for (let j = 0; j < 3; j++) {
                for (let i = 0; i < 3; i++) {
                    const x = x0 + i;
                    const y = y0 + j;
                    let ch = rows[j][i];
                    // Standard blocks get the old irregular pavement gaps
                    if (tplName === 'standard' && ch === 'B' && !(i === 1 && j === 1) && (x + y * 3) % 5 === 0)
                        ch = '.';
                    stampChar(x, y, ch, r);
                    if (ch === 'A' && (tplName === 'U' || tplName === 'L')) {
                        turfMin = turfMin ? { x: Math.min(turfMin.x, x), y: Math.min(turfMin.y, y) } : { x, y };
                        turfMax = turfMax ? { x: Math.max(turfMax.x, x), y: Math.max(turfMax.y, y) } : { x, y };
                    }
                    if (ch === 'Y') pendingBays.push([x, y]);
                }
            }
            for (const [bxx, byy] of pendingBays) registerBay(fixed.bay, bxx, byy);
            if (turfMin && d === D_MIDTOWN && tplName === 'U') {
                LANDMARKS.gangTurfs.push({
                    x0: turfMin.x * TILE,
                    y0: turfMin.y * TILE,
                    x1: (turfMax.x + 1) * TILE,
                    y1: (turfMax.y + 1) * TILE,
                    jacket: fixed?.turf || (LANDMARKS.gangTurfs.length % 2 ? '#be123c' : '#7c2d92')
                });
            }
        }
    }

    // 3a. Central Park superblock: pavement ring, grass heart, interior avenues removed
    const px0 = blockOrigin(PARK.bx0);
    const py0 = blockOrigin(PARK.by0);
    const px1 = blockOrigin(PARK.bx1) + 2;
    const py1 = blockOrigin(PARK.by1) + 2;
    for (let y = py0; y <= py1; y++)
        for (let x = px0; x <= px1; x++) {
            const ring = x === px0 || x === px1 || y === py0 || y === py1;
            setTile(x, y, ring ? T_PAVEMENT : T_GRASS);
        }
    Object.assign(LANDMARKS.parkRect, { x0: px0, y0: py0, x1: px1, y1: py1 });
    const pcx = (px0 + px1 + 1) / 2;
    const pcy = (py0 + py1 + 1) / 2;
    LANDMARKS.parkCenter = { x: pcx * TILE, y: pcy * TILE };
    LANDMARKS.parkLoop = [
        { x: (px1 - 0.5) * TILE, y: (py0 + 1.4) * TILE },
        { x: (px1 - 0.5) * TILE, y: (py1 - 0.5) * TILE },
        { x: (px0 + 1.4) * TILE, y: (py1 - 0.5) * TILE },
        { x: (px0 + 1.4) * TILE, y: (py0 + 1.4) * TILE }
    ];

    // 3b. Downtown Financial Plaza: tiled pavement, avenue between the blocks removed
    const qx0 = blockOrigin(PLAZA.bx0);
    const qy0 = blockOrigin(PLAZA.by0);
    const qx1 = blockOrigin(PLAZA.bx1) + 2;
    const qy1 = blockOrigin(PLAZA.by1) + 2;
    for (let y = qy0; y <= qy1; y++) for (let x = qx0; x <= qx1; x++) setTile(x, y, T_PAVEMENT);
    Object.assign(LANDMARKS.plazaRect, { x0: qx0, y0: qy0, x1: qx1, y1: qy1 });

    // 3c. Harbor container yard with the export shed, bay and the hidden tank
    const yx0 = blockOrigin(YARD.bx0);
    const yy0 = blockOrigin(YARD.by0);
    const yr = rngFor(4242);
    for (let j = 0; j < 3; j++)
        for (let i = 0; i < 7; i++) {
            const ch = YARD_MASK[j][i];
            const x = yx0 + i;
            const y = yy0 + j;
            if (ch === 'B')
                setTile(x, y, T_BLDG, { ...buildingMeta(x, y, yr), roof: '#7b7c76', wall: '#6a6b66', dark: '#52524e' });
            else if (ch === 'Y') setTile(x, y, T_BAY);
            else if (ch === 'T') {
                setTile(x, y, T_PAVEMENT);
                LANDMARKS.tank = { x: (x + 0.5) * TILE, y: (y + 0.5) * TILE, angle: -Math.PI * 0.5 };
            } else stampChar(x, y, ch, yr);
        }
    Object.assign(LANDMARKS.yardRect, { x0: yx0, y0: yy0, x1: yx0 + 6, y1: yy0 + 2 });
    registerBay('export', yx0 + 3, yy0 + 1);

    // 4. Anchors resolved against the finished map
    const taken = new Set();
    const spawnTx = Math.floor(pcx);
    LANDMARKS.playerSpawn = { x: (spawnTx + 0.5) * TILE, y: (py0 + 0.7) * TILE };
    taken.add(py0 * MAP_SIZE + spawnTx);
    LANDMARKS.parkedCars.push(
        { type: 'hellcrab', x: (spawnTx + 1.35) * TILE, y: (py0 + 0.32) * TILE, angle: 0 },
        { type: 'blitz', x: (px0 + 0.35) * TILE, y: (py0 + 0.35) * TILE, angle: Math.PI * 0.5 }
    );

    const phones = [
        { at: [spawnTx, py0], label: 'CENTRAL PARK NORTH PHONE' },
        { at: [px0, Math.floor(pcy)], label: 'PARKSIDE WEST PAYPHONE' },
        { at: [Math.floor((qx0 + qx1) / 2), qy1], label: 'FINANCIAL PLAZA PAYPHONE' },
        { at: [yx0 + 1, yy0 + 2], label: 'HARBOR YARD PAYPHONE' },
        { at: [22, 36], label: 'MIDTOWN PAYPHONE' }
    ];
    for (const ph of phones) {
        const pt = pavementNear(ph.at[0], ph.at[1], taken);
        payphones.push({
            x: (pt.tx + 0.5) * TILE,
            y: (pt.ty + 0.5) * TILE,
            ringPhase: Math.random() * 6,
            label: ph.label
        });
    }

    const pk = (kind, color, tx, ty) => {
        const pt = pavementNear(tx, ty, taken);
        LANDMARKS.pickups.push({ kind, color, x: (pt.tx + 0.5) * TILE, y: (pt.ty + 0.5) * TILE });
    };
    LANDMARKS.pickups.push({ kind: 'uzi', color: '#ffd400', x: LANDMARKS.parkCenter.x, y: LANDMARKS.parkCenter.y });
    pk('armor', '#5a8fd6', qx0 + 3, qy0 + 1);
    pk('rocket', '#ff8a2a', yx0 + 3, yy0 + 2);
    pk('health', '#d23a2a', 10, 44);
    pk('rocket', '#ff8a2a', 50, 18);
    pk('bribe', '#a855f7', 20, 10);
    pk('health', '#d23a2a', 40, 36);

    const turf0 = LANDMARKS.gangTurfs[0];
    LANDMARKS.missions.hotCar = turf0
        ? { x: (turf0.x0 + turf0.x1) / 2, y: (turf0.y0 + turf0.y1) / 2 }
        : { x: 8.5 * TILE, y: 44.5 * TILE };
    LANDMARKS.missions.boss = { x: ((qx0 + qx1 + 1) / 2) * TILE, y: ((qy0 + qy1 + 1) / 2) * TILE };
    LANDMARKS.missions.vanSpawn = { x: 21.5 * TILE, y: getLaneCoord(30, 0) };
    LANDMARKS.missions.drop = { x: (yx0 + 3.5) * TILE, y: (yy0 + 2.5) * TILE };

    LANDMARKS.keepClear.push(
        LANDMARKS.playerSpawn,
        LANDMARKS.tank,
        LANDMARKS.missions.hotCar,
        LANDMARKS.missions.boss,
        LANDMARKS.missions.drop,
        ...LANDMARKS.parkedCars,
        ...bays.map((b) => ({ x: b.ex, y: b.ey })),
        ...bays
    );

    if (import.meta.env?.DEV) {
        const v = validateRoadNetwork();
        if (!v.ok) console.error('Road network invalid', v);
    }
}

// Dev check: every road tile needs 2+ road neighbours and all roads form one connected network
export function validateRoadNetwork() {
    const deadEnds = [];
    let first = null;
    let total = 0;
    for (let y = 0; y < MAP_SIZE; y++)
        for (let x = 0; x < MAP_SIZE; x++) {
            if (!isRoadTileType(mapGrid[y][x])) continue;
            total++;
            first = first || [x, y];
            let n = 0;
            for (const dv of DIR_VECS) if (isRoadCell(x + dv.dx, y + dv.dy)) n++;
            if (n < 2) deadEnds.push([x, y]);
        }
    const seen = new Set([first[1] * MAP_SIZE + first[0]]);
    const stack = [first];
    while (stack.length) {
        const [x, y] = stack.pop();
        for (const dv of DIR_VECS) {
            const nx = x + dv.dx;
            const ny = y + dv.dy;
            if (!isRoadCell(nx, ny) || seen.has(ny * MAP_SIZE + nx)) continue;
            seen.add(ny * MAP_SIZE + nx);
            stack.push([nx, ny]);
        }
    }
    return { ok: deadEnds.length === 0 && seen.size === total, deadEnds, connected: seen.size, total };
}

// --- HELPER UTILITIES ---
export function tileAtWorld(wx, wy) {
    const tx = Math.floor(wx / TILE);
    const ty = Math.floor(wy / TILE);
    if (tx < 0 || ty < 0 || tx >= MAP_SIZE || ty >= MAP_SIZE) return T_WATER;
    return mapGrid[ty][tx];
}

function isBayShutAt(wx, wy) {
    if (tileAtWorld(wx, wy) !== T_BAY) return false;
    return isBayShut(Math.floor(wx / TILE), Math.floor(wy / TILE));
}

export function isSolidAt(wx, wy, radius = 12) {
    const pts = [
        [wx - radius, wy - radius],
        [wx + radius, wy - radius],
        [wx - radius, wy + radius],
        [wx + radius, wy + radius]
    ];
    for (const [px, py] of pts) {
        if (isSolidTile(tileAtWorld(px, py)) || isBayShutAt(px, py)) return true;
    }
    return false;
}

// --- ROAD LANE & AI NAVIGATION HELPERS ---
export const LANE_OFFSET = 31; // Centers vehicles inside each 62px asphalt lane (between 10px curb and 72px divider)
// Cardinal directions: 0 = East (+X), 1 = South (+Y), 2 = West (-X), 3 = North (-Y)
export const DIR_VECS = [
    { dx: 1, dy: 0, ang: 0 },
    { dx: 0, dy: 1, ang: Math.PI * 0.5 },
    { dx: -1, dy: 0, ang: Math.PI },
    { dx: 0, dy: -1, ang: -Math.PI * 0.5 }
];

export function isRoadTileType(t) {
    return t === T_ROAD_H || t === T_ROAD_V || t === T_ROAD_X;
}

export function isRoadCell(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= MAP_SIZE || ty >= MAP_SIZE) return false;
    return isRoadTileType(mapGrid[ty][tx]);
}

export function normalizeAngle(a) {
    return Math.atan2(Math.sin(a), Math.cos(a));
}

export function angleToRoadDir(angle) {
    const norm = ((Math.round(angle / (Math.PI * 0.5)) % 4) + 4) % 4;
    return norm; // 0: East, 1: South, 2: West, 3: North
}

// Returns the right-hand traffic lane coordinate for a given tile & cardinal direction
export function getLaneCoord(tileIdx, dir) {
    const center = (tileIdx + 0.5) * TILE;
    if (dir === 0) return center + LANE_OFFSET; // Eastbound -> South half of road
    if (dir === 2) return center - LANE_OFFSET; // Westbound -> North half of road
    if (dir === 1) return center - LANE_OFFSET; // Southbound -> West half of road
    return center + LANE_OFFSET; // Northbound -> East half of road
}

// Line-of-sight raycast so cops/enemies don't shoot into brick walls or drive blindly into blocks
export function hasLineOfSight(x1, y1, x2, y2) {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(2, Math.ceil(dist / 36));
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const sx = x1 + (x2 - x1) * t;
        const sy = y1 + (y2 - y1) * t;
        if (isSolidTile(tileAtWorld(sx, sy)) || isBayShutAt(sx, sy)) return false;
    }
    return true;
}

// Weighted Grid Flow-Field for Police Pursuit (strongly prefers roads over sidewalks, alleys sit in between!)
export const policeFlowDist = Array.from({ length: MAP_SIZE }, () => new Float32Array(MAP_SIZE).fill(9999));
const flowHeap = []; // binary min-heap of [cost, cellIndex]

function heapPush(cost, idx) {
    flowHeap.push([cost, idx]);
    let i = flowHeap.length - 1;
    while (i > 0) {
        const p = (i - 1) >> 1;
        if (flowHeap[p][0] <= flowHeap[i][0]) break;
        [flowHeap[p], flowHeap[i]] = [flowHeap[i], flowHeap[p]];
        i = p;
    }
}
function heapPop() {
    const top = flowHeap[0];
    const last = flowHeap.pop();
    if (flowHeap.length) {
        flowHeap[0] = last;
        let i = 0;
        for (;;) {
            const l = i * 2 + 1;
            const r = l + 1;
            let m = i;
            if (l < flowHeap.length && flowHeap[l][0] < flowHeap[m][0]) m = l;
            if (r < flowHeap.length && flowHeap[r][0] < flowHeap[m][0]) m = r;
            if (m === i) break;
            [flowHeap[m], flowHeap[i]] = [flowHeap[i], flowHeap[m]];
            i = m;
        }
    }
    return top;
}

export function updatePoliceFlowField() {
    for (let y = 0; y < MAP_SIZE; y++) {
        policeFlowDist[y].fill(9999);
    }
    const ptx = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(player.x / TILE)));
    const pty = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(player.y / TILE)));
    if (isSolidTile(mapGrid[pty][ptx])) return;

    flowHeap.length = 0;
    policeFlowDist[pty][ptx] = 0;
    heapPush(0, pty * MAP_SIZE + ptx);

    while (flowHeap.length > 0) {
        const [cost, idx] = heapPop();
        const cx = idx % MAP_SIZE;
        const cy = (idx / MAP_SIZE) | 0;
        if (cost > policeFlowDist[cy][cx]) continue;

        for (const dv of DIR_VECS) {
            const ntx = cx + dv.dx;
            const nty = cy + dv.dy;
            if (ntx < 1 || nty < 1 || ntx >= MAP_SIZE - 1 || nty >= MAP_SIZE - 1) continue;
            // Roads cost 1, alleys/bays 2.5-3, pavement/grass 4.5 so cruisers stick to avenues until the final approach
            const stepCost = TILE_PROPS[mapGrid[nty][ntx]].flowCost;
            if (stepCost === Infinity || (mapGrid[nty][ntx] === T_BAY && isBayShut(ntx, nty))) continue;
            const nextCost = cost + stepCost;
            if (nextCost < policeFlowDist[nty][ntx]) {
                policeFlowDist[nty][ntx] = nextCost;
                heapPush(nextCost, nty * MAP_SIZE + ntx);
            }
        }
    }
}

// Right-hand lane spawn on a given road tile, or null if blocked by another car
function laneSpawnAt(tx, ty) {
    if (!isRoadCell(tx, ty)) return null;
    const t = mapGrid[ty][tx];
    let dir;
    if (t === T_ROAD_H) {
        dir = Math.random() < 0.5 ? 0 : 2;
    } else if (t === T_ROAD_V) {
        dir = Math.random() < 0.5 ? 1 : 3;
    } else {
        const validDirs = [0, 1, 2, 3].filter((d) => isRoadCell(tx + DIR_VECS[d].dx, ty + DIR_VECS[d].dy));
        if (validDirs.length === 0) return null;
        dir = validDirs[Math.floor(Math.random() * validDirs.length)];
    }

    const sx = dir === 1 || dir === 3 ? getLaneCoord(tx, dir) : (tx + 0.5) * TILE;
    const sy = dir === 0 || dir === 2 ? getLaneCoord(ty, dir) : (ty + 0.5) * TILE;

    // Ensure no immediate overlap with existing cars
    for (const other of cars) {
        if (Math.hypot(other.x - sx, other.y - sy) < 85) return null;
    }
    return { x: sx, y: sy, dir, angle: DIR_VECS[dir].ang };
}

// Picks a clean right-hand lane spawn point at a desired distance band from (cx, cy)
export function pickRoadSpawnNear(cx, cy, minDist, maxDist) {
    for (let tries = 0; tries < 28; tries++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = minDist + Math.random() * (maxDist - minDist);
        const spot = laneSpawnAt(
            Math.floor((cx + Math.cos(ang) * dist) / TILE),
            Math.floor((cy + Math.sin(ang) * dist) / TILE)
        );
        if (spot) return spot;
    }
    return null;
}

// Any lane on the map (initial population)
export function pickRoadSpawnAnywhere() {
    for (let tries = 0; tries < 40; tries++) {
        const spot = laneSpawnAt(
            2 + Math.floor(Math.random() * (MAP_SIZE - 4)),
            2 + Math.floor(Math.random() * (MAP_SIZE - 4))
        );
        if (spot) return spot;
    }
    return null;
}

// Adjusts a steering angle using left/right feeler whiskers to avoid walls & water
export function applyWallFeelers(x, y, desiredAngle, lookDist = 64) {
    if (!isSolidAt(x + Math.cos(desiredAngle) * lookDist, y + Math.sin(desiredAngle) * lookDist, 14)) {
        return desiredAngle;
    }
    const offsets = [0.42, -0.42, 0.85, -0.85, 1.3, -1.3];
    for (const off of offsets) {
        const testAng = desiredAngle + off;
        if (!isSolidAt(x + Math.cos(testAng) * lookDist, y + Math.sin(testAng) * lookDist, 14)) {
            return testAng;
        }
    }
    return desiredAngle + Math.PI * 0.5;
}
