import {
    MAP_SIZE,
    TILE,
    T_BLDG,
    T_GRASS,
    T_PAVEMENT,
    T_ROAD_H,
    T_ROAD_V,
    T_ROAD_X,
    T_SPRAY,
    T_WATER
} from './config.js';
import { buildingPalette } from './palette.js';
import { bldgMeta, cars, mapGrid, payphones, player, sprayShops } from './state.js';

// --- CITY GENERATION ---
export function buildCity() {
    sprayShops.length = 0;
    payphones.length = 0;

    for (let y = 0; y < MAP_SIZE; y++) {
        mapGrid[y] = [];
        bldgMeta[y] = [];
        for (let x = 0; x < MAP_SIZE; x++) {
            bldgMeta[y][x] = null;

            // Outer island ocean border
            if (x === 0 || y === 0 || x === MAP_SIZE - 1 || y === MAP_SIZE - 1) {
                mapGrid[y][x] = T_WATER;
                continue;
            }
            // North & West Beach/Promenade edge (x=30 & y=30 complete the outer ring road so no dead ends exist!)
            if (x === 1 || y === 1) {
                mapGrid[y][x] = T_PAVEMENT;
                continue;
            }

            // Major avenues every 4 tiles
            const isRoadX = x % 4 === 2;
            const isRoadY = y % 4 === 2;

            if (isRoadX && isRoadY) {
                mapGrid[y][x] = T_ROAD_X;
            } else if (isRoadY) {
                mapGrid[y][x] = T_ROAD_H;
            } else if (isRoadX) {
                mapGrid[y][x] = T_ROAD_V;
            } else {
                // Central Park block (tiles 11..17, 11..17 excluding roads)
                if (x >= 11 && x <= 17 && y >= 11 && y <= 17) {
                    mapGrid[y][x] = x === 11 || x === 17 || y === 11 || y === 17 ? T_PAVEMENT : T_GRASS;
                }
                // SE Dockyard openconcrete yard (for hidden Tank!)
                else if (x >= 23 && x <= 29 && y >= 23 && y <= 29 && !(x === 25 && y === 25)) {
                    mapGrid[y][x] = T_PAVEMENT;
                } else {
                    // Sidewalk margins vs Building cores
                    // Inside each 3x3 block between roads (offsets 3, 0, 1 mod 4 -> i.e. 3,4,5; 7,8,9; etc.)
                    const bx = (x - 3) % 4; // 0, 1, 2 inside a city block
                    const by = (y - 3) % 4;

                    // Keep corners or random plazas walkable, make core buildings
                    if ((bx === 1 && by === 1) || ((x + y * 3) % 5 !== 0 && (bx === 1 || by === 1))) {
                        mapGrid[y][x] = T_BLDG;
                        const pal = buildingPalette(x, y);
                        // Taller skyscrapers downtown (near top-left/center), warehouses near docks
                        const distCenter = Math.hypot(x - 10, y - 10);
                        const heightFactor = distCenter < 7 ? 0.58 : 0.34;
                        bldgMeta[y][x] = {
                            h: heightFactor + ((x * 17 + y * 31) % 5) * 0.08,
                            ...pal,
                            style: (x * 3 + y * 7) % 4
                        };
                    } else {
                        mapGrid[y][x] = T_PAVEMENT;
                    }
                }
            }
        }
    }

    // Place 3 Spray-B-Gone Garages right next to avenues
    const sprayCoords = [
        { tx: 7, ty: 6 },
        { tx: 21, ty: 10 },
        { tx: 11, ty: 23 }
    ];
    for (const sc of sprayCoords) {
        mapGrid[sc.ty][sc.tx] = T_SPRAY;
        bldgMeta[sc.ty][sc.tx] = null;
        sprayShops.push({
            tx: sc.tx,
            ty: sc.ty,
            x: (sc.tx + 0.5) * TILE,
            y: (sc.ty + 0.5) * TILE,
            cooldown: 0
        });
    }

    // Place Ringing Payphones around Central Park Plaza & Downtown
    const phoneTiles = [
        { tx: 13, ty: 11, label: 'CENTRAL PARK NORTH PHONE' },
        { tx: 11, ty: 15, label: 'WEST PLAZA PAYPHONE' },
        { tx: 19, ty: 9, label: 'MIDTOWN PAYPHONE' }
    ];
    for (const pt of phoneTiles) {
        mapGrid[pt.ty][pt.tx] = T_PAVEMENT;
        bldgMeta[pt.ty][pt.tx] = null;
        payphones.push({
            x: (pt.tx + 0.5) * TILE,
            y: (pt.ty + 0.5) * TILE,
            ringPhase: Math.random() * 6,
            label: pt.label
        });
    }
}

// --- HELPER UTILITIES ---
export function tileAtWorld(wx, wy) {
    const tx = Math.floor(wx / TILE);
    const ty = Math.floor(wy / TILE);
    if (tx < 0 || ty < 0 || tx >= MAP_SIZE || ty >= MAP_SIZE) return T_WATER;
    return mapGrid[ty][tx];
}

export function isSolidAt(wx, wy, radius = 12) {
    const pts = [
        [wx - radius, wy - radius],
        [wx + radius, wy - radius],
        [wx - radius, wy + radius],
        [wx + radius, wy + radius]
    ];
    for (const [px, py] of pts) {
        const t = tileAtWorld(px, py);
        if (t === T_BLDG || t === T_WATER) return true;
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
        const tile = tileAtWorld(sx, sy);
        if (tile === T_BLDG || tile === T_WATER) return false;
    }
    return true;
}

// Weighted Grid Flow-Field for Police Pursuit (strongly prefers roads over sidewalks!)
export const policeFlowDist = Array.from({ length: MAP_SIZE }, () => new Float32Array(MAP_SIZE).fill(9999));

export function updatePoliceFlowField() {
    for (let y = 0; y < MAP_SIZE; y++) {
        policeFlowDist[y].fill(9999);
    }
    const ptx = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(player.x / TILE)));
    const pty = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(player.y / TILE)));
    if (mapGrid[pty][ptx] === T_BLDG || mapGrid[pty][ptx] === T_WATER) return;

    const queue = [{ tx: ptx, ty: pty, cost: 0 }];
    policeFlowDist[pty][ptx] = 0;

    while (queue.length > 0) {
        // Pop lowest-cost node (tiny 32x32 grid)
        let bestIdx = 0;
        for (let i = 1; i < queue.length; i++) {
            if (queue[i].cost < queue[bestIdx].cost) bestIdx = i;
        }
        const cur = queue[bestIdx];
        queue[bestIdx] = queue[queue.length - 1];
        queue.pop();

        if (cur.cost > policeFlowDist[cur.ty][cur.tx]) continue;

        for (const dv of DIR_VECS) {
            const ntx = cur.tx + dv.dx;
            const nty = cur.ty + dv.dy;
            if (ntx < 1 || nty < 1 || ntx >= MAP_SIZE - 1 || nty >= MAP_SIZE - 1) continue;
            const nt = mapGrid[nty][ntx];
            if (nt === T_BLDG || nt === T_WATER) continue;

            // Roads cost 1; pavement/grass cost 4.5 so police cruisers stick to avenues until final approach!
            const stepCost = isRoadTileType(nt) ? 1.0 : 4.5;
            const nextCost = cur.cost + stepCost;
            if (nextCost < policeFlowDist[nty][ntx]) {
                policeFlowDist[nty][ntx] = nextCost;
                queue.push({ tx: ntx, ty: nty, cost: nextCost });
            }
        }
    }
}

// Picks a clean right-hand lane spawn point at a desired distance band from (cx, cy)
export function pickRoadSpawnNear(cx, cy, minDist, maxDist) {
    for (let tries = 0; tries < 28; tries++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = minDist + Math.random() * (maxDist - minDist);
        const tx = Math.floor((cx + Math.cos(ang) * dist) / TILE);
        const ty = Math.floor((cy + Math.sin(ang) * dist) / TILE);
        if (!isRoadCell(tx, ty)) continue;

        const t = mapGrid[ty][tx];
        let dir;
        if (t === T_ROAD_H) {
            dir = Math.random() < 0.5 ? 0 : 2;
        } else if (t === T_ROAD_V) {
            dir = Math.random() < 0.5 ? 1 : 3;
        } else {
            const validDirs = [0, 1, 2, 3].filter((d) => isRoadCell(tx + DIR_VECS[d].dx, ty + DIR_VECS[d].dy));
            if (validDirs.length === 0) continue;
            dir = validDirs[Math.floor(Math.random() * validDirs.length)];
        }

        const sx = dir === 1 || dir === 3 ? getLaneCoord(tx, dir) : (tx + 0.5) * TILE;
        const sy = dir === 0 || dir === 2 ? getLaneCoord(ty, dir) : (ty + 0.5) * TILE;

        // Ensure no immediate overlap with existing cars
        let clear = true;
        for (const other of cars) {
            if (Math.hypot(other.x - sx, other.y - sy) < 85) {
                clear = false;
                break;
            }
        }
        if (clear) {
            return { x: sx, y: sy, dir, angle: DIR_VECS[dir].ang };
        }
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
