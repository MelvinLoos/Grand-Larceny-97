import { DECK_Z, MAP_SIZE, RAMP_Z, TILE, T_RAMP, T_ROAD_H, T_WATER } from './config.js';
import { bldgMeta, mapGrid, player } from './state.js';

// --- THE NEON BAY RIVER ---
// A 3-tile channel (x 27..29) running north-south through the sea at both ends. Three intact steel bridges keep the
// avenues connected (they stay T_ROAD_H, so traffic and the police flow-field treat them as ordinary roads); the
// fourth crossing at y 42 is a broken drawbridge: two stunt ramps with a 2-tile gap between the lips.
export const RIVER = {
    x0: 27,
    x1: 29,
    bridges: [14, 30, 50],
    broken: 42,
    slips: [42, 50], // south seawall gaps (tile x) where cars and swimmers can enter / leave the sea
    star: { x: 0, y: 0 }, // drawbridge centre, for the map icon
    gap: { x0: 0, x1: 0, y0: 0, y1: 0 } // world rect of open water between the two lips
};
const BANK_W = 16; // seawall parapet thickness (inside the water tile)
const WALL_TOP = 14;
const RAIL_TOP = 38;
const LIP = TILE / 2; // ramp stub length inside its tile

// Low barriers by tile index: seawalls, bollards, ladders, bridge rails, sawhorses
export const lowBarriers = new Map();
const breakables = [];
let healTimer = 0;

const isBridgeRow = (ty) => RIVER.bridges.includes(ty);
export const isBridgeTile = (tx, ty) => bldgMeta[ty]?.[tx]?.kind === 'bridge';

function addBarrier(tx, ty, x0, y0, x1, y1, kind, top, extra) {
    const b = { x0, y0, x1, y1, kind, top, tx, ty, ...extra };
    const k = ty * MAP_SIZE + tx;
    const list = lowBarriers.get(k);
    if (list) list.push(b);
    else lowBarriers.set(k, [b]);
    if (b.breakable) breakables.push(b);
    return b;
}

export function carveRiver() {
    lowBarriers.clear();
    breakables.length = 0;
    const T = TILE;

    // 1. Terrain
    for (let y = 1; y < MAP_SIZE - 1; y++) {
        for (let x = RIVER.x0; x <= RIVER.x1; x++) {
            if (isBridgeRow(y)) {
                mapGrid[y][x] = T_ROAD_H;
                bldgMeta[y][x] = { kind: 'bridge' };
            } else if (y === RIVER.broken && x !== 28) {
                mapGrid[y][x] = T_RAMP;
                bldgMeta[y][x] = { kind: 'ramp', west: x === RIVER.x0 };
            } else {
                mapGrid[y][x] = T_WATER;
                bldgMeta[y][x] = y === RIVER.broken ? { kind: 'gap' } : null;
            }
        }
    }
    RIVER.star = { x: 28.5 * T, y: (RIVER.broken + 0.5) * T };
    RIVER.gap = {
        x0: (RIVER.x0 + 0.5) * T,
        x1: (RIVER.x1 + 0.5) * T,
        y0: RIVER.broken * T,
        y1: (RIVER.broken + 1) * T
    };

    // 2. Seawalls on every water edge that faces land (the perimeter sea included), with ladders and bollards
    const ladderRow = (ty) => ty % 4 === 0 || [...RIVER.bridges, RIVER.broken].some((b) => Math.abs(ty - b) === 1);
    const DIRS = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1]
    ];
    for (let ty = 0; ty < MAP_SIZE; ty++)
        for (let tx = 0; tx < MAP_SIZE; tx++) {
            if (mapGrid[ty][tx] !== T_WATER) continue;
            const x = tx * T;
            const y = ty * T;
            for (let d = 0; d < 4; d++) {
                const nx = tx + DIRS[d][0];
                const ny = ty + DIRS[d][1];
                if (nx < 0 || ny < 0 || nx >= MAP_SIZE || ny >= MAP_SIZE) continue;
                const nt = mapGrid[ny][nx];
                if (nt === T_WATER || nt === T_RAMP || isBridgeTile(nx, ny)) continue;
                if (d === 3 && ty === MAP_SIZE - 1 && RIVER.slips.includes(tx)) continue; // open slipway
                const horiz = d === 0 || d === 2; // east / west edge of a river tile
                let r;
                if (d === 0) r = [x + T - BANK_W, y, x + T, y + T];
                else if (d === 2) r = [x, y, x + BANK_W, y + T];
                else if (d === 1) r = [x, y + T - BANK_W, x + T, y + T];
                else r = [x, y, x + T, y + BANK_W];
                // Midtown / Harbor avenues end in breakable bollards: knocked cars can still go for a swim
                if (horiz && ty % 4 === 2 && ty >= 30) {
                    addBarrier(tx, ty, r[0], y + 8, r[2], y + T - 8, 'bollard', WALL_TOP, { breakable: true, d });
                } else if (horiz && ladderRow(ty)) {
                    const m = y + T / 2;
                    addBarrier(tx, ty, r[0], y, r[2], m - 22, 'wall', WALL_TOP, { d });
                    addBarrier(tx, ty, r[0], m - 22, r[2], m + 22, 'ladder', WALL_TOP, { climb: true, d });
                    addBarrier(tx, ty, r[0], m + 22, r[2], y + T, 'wall', WALL_TOP, { d });
                } else {
                    addBarrier(tx, ty, r[0], r[1], r[2], r[3], 'wall', WALL_TOP, { d });
                }
            }
        }

    // 3. Bridge guardrails (steel, car-height clear only when airborne) and the drawbridge stubs
    for (const row of RIVER.bridges)
        for (let tx = RIVER.x0; tx <= RIVER.x1; tx++) {
            const x = tx * T;
            const y = row * T;
            addBarrier(tx, row, x, y, x + T, y + 8, 'rail', RAIL_TOP);
            addBarrier(tx, row, x, y + T - 8, x + T, y + T, 'rail', RAIL_TOP);
        }
    const br = RIVER.broken;
    for (const tx of [RIVER.x0, RIVER.x1]) {
        const west = tx === RIVER.x0;
        const sx0 = west ? tx * T : tx * T + LIP;
        const sx1 = west ? tx * T + LIP : (tx + 1) * T;
        addBarrier(tx, br, sx0, br * T, sx1, br * T + 8, 'rail', RAIL_TOP);
        addBarrier(tx, br, sx0, (br + 1) * T - 8, sx1, (br + 1) * T, 'rail', RAIL_TOP);
        // orange-and-white detour sawhorses across the outer edge: smash through them to reach the jump
        const ox = west ? tx * T : (tx + 1) * T - 10;
        addBarrier(tx, br, ox, br * T + 10, ox + 10, (br + 1) * T - 10, 'sawhorse', WALL_TOP, { breakable: true });
    }
}

// Reused result: copy fields out immediately
const S = { z: 0, water: false, deck: false, ramp: false, gap: false };
export function surfaceAt(wx, wy) {
    S.z = 0;
    S.water = false;
    S.deck = false;
    S.ramp = false;
    S.gap = false;
    const tx = Math.floor(wx / TILE);
    const ty = Math.floor(wy / TILE);
    if (tx < 0 || ty < 0 || tx >= MAP_SIZE || ty >= MAP_SIZE) {
        S.water = true;
        return S;
    }
    const t = mapGrid[ty][tx];
    if (t === T_WATER) {
        S.water = true;
        S.gap = bldgMeta[ty][tx]?.kind === 'gap';
    } else if (t === T_RAMP) {
        const lx = wx - tx * TILE;
        const west = tx === RIVER.x0;
        if (west ? lx < LIP : lx >= LIP) {
            S.ramp = true;
            S.z = RAMP_Z * (west ? lx / LIP : (TILE - lx) / LIP);
        } else {
            S.water = true;
            S.gap = true;
        }
    } else if (bldgMeta[ty][tx]?.kind === 'bridge') {
        const d = Math.min(wx - RIVER.x0 * TILE, (RIVER.x1 + 1) * TILE - wx);
        const k = Math.max(0, Math.min(1, d / LIP));
        S.deck = true;
        S.z = DECK_Z * k * k * (3 - 2 * k);
    }
    return S;
}

// True over the drawbridge's open water, where a cop at speed can still make the jump
export function isGapWater(wx, wy) {
    return surfaceAt(wx, wy).gap;
}

// The intact low barrier covering a point that stops something at height z, or null.
// mode 'walk' lets climbable ladders through.
export function lowBarrierAt(px, py, z, walk = false) {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    const list = lowBarriers.get(ty * MAP_SIZE + tx);
    if (!list) return null;
    for (const b of list) {
        if (b.broken || z >= b.top || (walk && b.climb)) continue;
        if (px >= b.x0 && px < b.x1 && py >= b.y0 && py < b.y1) return b;
    }
    return null;
}

// Broken barriers are rebuilt once the player has wandered off
export function updateRiver(dt) {
    healTimer -= dt;
    if (healTimer > 0) return;
    healTimer = 1;
    for (const b of breakables) {
        if (!b.broken) continue;
        const cx = (b.x0 + b.x1) / 2;
        const cy = (b.y0 + b.y1) / 2;
        if (Math.hypot(cx - player.x, cy - player.y) > 1800) b.broken = false;
    }
}
