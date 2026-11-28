import { DIR_VECS, LANDMARKS, bayByTile, isOnScreen, isRoadCell } from './city.js';
import {
    MAP_SIZE,
    DANGER_MAX_COUNT,
    DANGER_MAX_ETA,
    DANGER_MAX_MISS,
    DANGER_MIN_SPEED,
    METERS_PER_PX,
    PHONE_RING_PERIOD,
    PHONE_RING_ON,
    TILE,
    T_ALLEY,
    T_BAY,
    T_BLDG,
    T_GRASS,
    T_PAVEMENT,
    T_ROAD_H,
    T_ROAD_V,
    T_RAMP,
    T_ROAD_X,
    T_WATER
} from './config.js';
import { DISTRICTS, districtAtTile } from './districts.js';
import { drawCanopy, drawFoliageGround } from './foliage.js';
import { GRIME } from './grime.js';
import { drawRadar } from './minimap.js';
import {
    applyAirScale,
    drawBridgeDeck,
    drawBridgeRails,
    drawRampTile,
    drawTileBarriers,
    drawWaterDecor,
    isRampCell,
    overlayTiles,
    tealOf
} from './render-river.js';
import { BAY_INFO } from './shops.js';
import { bodyOf, doorFor, skinOf } from './vehicles.js';
import { HAZARD, INK, PAPER, PARK, PHONE, ROUTE, STREETS_H, STREETS_V, WATER, shade } from './palette.js';
import {
    bays,
    bldgMeta,
    bullets,
    camera,
    cars,
    ctx,
    decals,
    exportBoard,
    floatingTexts,
    foliageGrid,
    game,
    mapGrid,
    mission,
    particles,
    payphones,
    peds,
    pickups,
    player,
    roadblocks,
    spikeStrips,
    view
} from './state.js';

// --- 2.5D PERSPECTIVE RENDERER ---
export function worldToScreen(wx, wy, shakeX, shakeY) {
    return {
        x: (wx - camera.x) * camera.zoom + view.w * 0.5 + shakeX,
        y: (wy - camera.y) * camera.zoom + view.h * 0.5 + shakeY
    };
}

// --- CACHED GROUND TILES ---
// World-space box a building is drawn on: its setback footprint, or the whole tile
function footprint(b) {
    return b.meta.fp || { x0: b.tx * TILE, y0: b.ty * TILE, x1: (b.tx + 1) * TILE, y1: (b.ty + 1) * TILE };
}

function tileCanvas(draw) {
    const c = document.createElement('canvas');
    c.width = c.height = 144;
    draw(c.getContext('2d'));
    return c;
}
let _brick = null;
function brickTile() {
    return (_brick ||= tileCanvas((g) => {
        g.fillStyle = '#8b5a45';
        g.fillRect(0, 0, 144, 144);
        g.strokeStyle = 'rgba(20, 19, 15, 0.35)';
        g.lineWidth = 2;
        for (let row = 0; row < 8; row++) {
            const yy = row * 18;
            g.beginPath();
            g.moveTo(0, yy);
            g.lineTo(144, yy);
            for (let xx = row % 2 ? 0 : 18; xx < 144; xx += 36) {
                g.moveTo(xx, yy);
                g.lineTo(xx, yy + 18);
            }
            g.stroke();
        }
        g.fillStyle = 'rgba(20, 19, 15, 0.16)'; // gutter down the middle
        g.fillRect(0, 66, 144, 12);
        g.drawImage(GRIME.walk[1], 0, 0, 144, 144);
    }));
}
// Yellow/black hazard stripes across the doorway, straddling the bay edge and the apron
function drawHazardThreshold(x, y, bay) {
    const v = DIR_VECS[bay.dir];
    const th = 20;
    const rx = v.dx > 0 ? x + TILE - th : x;
    const ry = v.dy > 0 ? y + TILE - th : y;
    const w = v.dx === 0 ? TILE : th;
    const h = v.dy === 0 ? TILE : th;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rx, ry, w, h);
    ctx.clip();
    ctx.fillStyle = HAZARD;
    ctx.fillRect(rx, ry, w, h);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 9;
    ctx.beginPath();
    for (let k = -h; k < w + h; k += 24) {
        ctx.moveTo(rx + k, ry + h);
        ctx.lineTo(rx + k + h, ry);
    }
    ctx.stroke();
    ctx.restore();
}

let _bayFloor = null;
function bayFloorTile() {
    return (_bayFloor ||= tileCanvas((g) => {
        g.fillStyle = '#2d2c2e';
        g.fillRect(0, 0, 144, 144);
        g.drawImage(GRIME.road[2], 0, 0, 144, 144);
        g.fillStyle = 'rgba(30, 22, 14, 0.4)';
        g.beginPath();
        g.ellipse(70, 80, 30, 18, 0.4, 0, Math.PI * 2);
        g.fill();
    }));
}

export function render() {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = WATER;
    ctx.fillRect(0, 0, view.w, view.h);

    const shakeX = camera.shake > 0 ? (Math.random() - 0.5) * camera.shake : 0;
    const shakeY = camera.shake > 0 ? (Math.random() - 0.5) * camera.shake : 0;

    ctx.save();
    ctx.translate(view.w * 0.5 + shakeX, view.h * 0.5 + shakeY);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    // Compute visible tile bounds
    const halfW = (view.w * 0.5) / camera.zoom + TILE * 2;
    const halfH = (view.h * 0.5) / camera.zoom + TILE * 2;
    const minTX = Math.max(0, Math.floor((camera.x - halfW) / TILE));
    const maxTX = Math.min(MAP_SIZE - 1, Math.floor((camera.x + halfW) / TILE));
    const minTY = Math.max(0, Math.floor((camera.y - halfH) / TILE));
    const maxTY = Math.min(MAP_SIZE - 1, Math.floor((camera.y + halfH) / TILE));

    // 1. DRAW GROUND TILES: the foldout street map, printed flat with ink casings
    const visibleBuildings = [];
    const visibleFoliage = [];
    const nowMs = performance.now();
    const nowSec0 = nowMs * 0.001;
    overlayTiles.length = 0;
    for (let ty = minTY; ty <= maxTY; ty++) {
        for (let tx = minTX; tx <= maxTX; tx++) {
            const t = mapGrid[ty][tx];
            const fl = foliageGrid.get(ty * MAP_SIZE + tx);
            if (fl) visibleFoliage.push(...fl);
            const x = tx * TILE;
            const y = ty * TILE;

            if (t === T_WATER) {
                ctx.fillStyle = WATER;
                ctx.fillRect(x, y, TILE + 1, TILE + 1);
                ctx.drawImage(GRIME.water[(tx + ty) & 1], x, y, TILE + 1, TILE + 1);
                ctx.strokeStyle = 'rgba(236, 230, 210, 0.30)';
                ctx.lineWidth = 3;
                ctx.lineCap = 'round';
                ctx.beginPath();
                for (let k = 0; k < 3; k++) {
                    const wx =
                        x + 16 + ((k * 47 + tx * 31 + ty * 17) % 78) + Math.sin(nowMs * 0.0012 + tx * 1.3 + ty + k) * 6;
                    const wy = y + 30 + k * 42;
                    ctx.moveTo(wx, wy);
                    ctx.lineTo(wx + 26, wy);
                }
                ctx.stroke();
                ctx.lineCap = 'butt';
                drawWaterDecor(ctx, tx, ty, x, y, nowMs);
                drawTileBarriers(ctx, tx, ty);
                const edgeH = ty === 0 || ty === MAP_SIZE - 1,
                    edgeV = tx === 0 || tx === MAP_SIZE - 1;
                if ((edgeH && tx % 4 === 2 && !edgeV) || (edgeV && ty % 4 === 2 && !edgeH)) {
                    ctx.fillStyle = 'rgba(236, 230, 210, 0.85)';
                    ctx.font = 'italic 900 46px "Archivo", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(
                        edgeH ? String.fromCharCode(65 + (tx - 2) / 4) : String((ty - 2) / 4 + 1),
                        x + TILE * 0.5,
                        y + TILE * 0.5
                    );
                }
            } else if (t === T_GRASS) {
                ctx.fillStyle = PARK;
                ctx.fillRect(x, y, TILE + 1, TILE + 1);
                ctx.drawImage(GRIME.grass[(tx * 3 + ty * 5) % 3], x, y, TILE + 1, TILE + 1);
            } else if (t === T_PAVEMENT || t === T_BLDG) {
                const gd = DISTRICTS[districtAtTile(tx, ty)].ground;
                ctx.fillStyle = gd.walk;
                ctx.fillRect(x, y, TILE + 1, TILE + 1);
                ctx.drawImage(GRIME.walk[(tx * 7 + ty * 3) & 3], x, y, TILE + 1, TILE + 1);
                ctx.strokeStyle = 'rgba(20, 19, 15, 0.12)';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4);
                if (gd.tiled) {
                    // Crisp tiled plaza: 3x3 slabs
                    ctx.strokeStyle = 'rgba(20, 19, 15, 0.14)';
                    ctx.beginPath();
                    for (let k = 1; k < 3; k++) {
                        ctx.moveTo(x + (TILE * k) / 3, y);
                        ctx.lineTo(x + (TILE * k) / 3, y + TILE);
                        ctx.moveTo(x, y + (TILE * k) / 3);
                        ctx.lineTo(x + TILE, y + (TILE * k) / 3);
                    }
                    ctx.stroke();
                }
                if (t === T_BLDG) visibleBuildings.push({ tx, ty, meta: bldgMeta[ty][tx] });
            } else if (t === T_ALLEY) {
                ctx.drawImage(brickTile(), x, y, TILE + 1, TILE + 1);
            } else if (t === T_BAY) {
                ctx.drawImage(bayFloorTile(), x, y, TILE + 1, TILE + 1);
                const bay = bayByTile.get(ty * MAP_SIZE + tx);
                if (bay) {
                    drawHazardThreshold(x, y, bay);
                    visibleBuildings.push({ tx, ty, meta: bay.meta, bay });
                }
            } else if (t === T_RAMP) {
                drawRampTile(ctx, tx, ty, x, y, nowSec0);
                drawTileBarriers(ctx, tx, ty);
            } else if (t === T_ROAD_H && bldgMeta[ty][tx]?.kind === 'bridge') {
                drawBridgeDeck(ctx, tx, ty, x, y);
            } else if (t === T_ROAD_H || t === T_ROAD_V || t === T_ROAD_X) {
                const gd = DISTRICTS[districtAtTile(tx, ty)].ground;
                const curb = gd.walk;
                ctx.fillStyle = gd.road;
                ctx.fillRect(x, y, TILE + 1, TILE + 1);
                ctx.drawImage(
                    GRIME[gd.concrete ? 'concrete' : 'road'][(tx * 5 + ty * 11) & 3],
                    x,
                    y,
                    TILE + 1,
                    TILE + 1
                );
                ctx.fillStyle = '#c9c6b4';
                if (t === T_ROAD_H) {
                    for (let d = 12; d < TILE; d += 36) ctx.fillRect(x + d, y + TILE * 0.5 - 2, 20, 4);
                    ctx.fillStyle = curb;
                    ctx.fillRect(x, y, TILE + 1, 10);
                    ctx.fillRect(x, y + TILE - 10, TILE + 1, 10);
                    ctx.fillStyle = INK;
                    ctx.fillRect(x, y + 9, TILE + 1, 2.5);
                    ctx.fillRect(x, y + TILE - 11.5, TILE + 1, 2.5);
                    if (tx % 4 === 0 && STREETS_H[(ty - 2) / 4 + 1]) {
                        ctx.fillStyle = 'rgba(236, 230, 210, 0.45)';
                        ctx.font = '700 17px "Barlow Condensed", sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(STREETS_H[(ty - 2) / 4 + 1], x + TILE * 0.5, y + 26);
                    }
                } else if (t === T_ROAD_V) {
                    for (let d = 12; d < TILE; d += 36) ctx.fillRect(x + TILE * 0.5 - 2, y + d, 4, 20);
                    ctx.fillStyle = curb;
                    ctx.fillRect(x, y, 10, TILE + 1);
                    ctx.fillRect(x + TILE - 10, y, 10, TILE + 1);
                    ctx.fillStyle = INK;
                    ctx.fillRect(x + 9, y, 2.5, TILE + 1);
                    ctx.fillRect(x + TILE - 11.5, y, 2.5, TILE + 1);
                    if (ty % 4 === 0 && STREETS_V[(tx - 2) / 4 + 1]) {
                        ctx.save();
                        ctx.translate(x + 26, y + TILE * 0.5);
                        ctx.rotate(-Math.PI / 2);
                        ctx.fillStyle = 'rgba(236, 230, 210, 0.45)';
                        ctx.font = '700 17px "Barlow Condensed", sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(STREETS_V[(tx - 2) / 4 + 1], 0, 0);
                        ctx.restore();
                    }
                } else {
                    // Junction: zebra crossings only where a road arrives, kerb where the side is closed (T / corner)
                    const rN = isRoadCell(tx, ty - 1),
                        rS = isRoadCell(tx, ty + 1),
                        rW = isRoadCell(tx - 1, ty) || isRampCell(tx - 1, ty),
                        rE = isRoadCell(tx + 1, ty) || isRampCell(tx + 1, ty);
                    ctx.fillStyle = 'rgba(236, 230, 210, 0.35)';
                    for (let z = 20; z < TILE - 20; z += 18) {
                        if (rN) ctx.fillRect(x + z, y + 4, 10, 14);
                        if (rS) ctx.fillRect(x + z, y + TILE - 18, 10, 14);
                        if (rW) ctx.fillRect(x + 4, y + z, 14, 10);
                        if (rE) ctx.fillRect(x + TILE - 18, y + z, 14, 10);
                    }
                    if (!rN || !rS || !rW || !rE) {
                        ctx.fillStyle = curb;
                        if (!rN) ctx.fillRect(x, y, TILE + 1, 10);
                        if (!rS) ctx.fillRect(x, y + TILE - 10, TILE + 1, 10);
                        if (!rW) ctx.fillRect(x, y, 10, TILE + 1);
                        if (!rE) ctx.fillRect(x + TILE - 10, y, 10, TILE + 1);
                        ctx.fillStyle = INK;
                        if (!rN) ctx.fillRect(x, y + 9, TILE + 1, 2.5);
                        if (!rS) ctx.fillRect(x, y + TILE - 11.5, TILE + 1, 2.5);
                        if (!rW) ctx.fillRect(x + 9, y, 2.5, TILE + 1);
                        if (!rE) ctx.fillRect(x + TILE - 11.5, y, 2.5, TILE + 1);
                    }
                }
            }
        }
    }

    // 2. DRAW PERSISTENT DECALS (Tire Skidmarks, Blood Splats, Craters)
    for (const d of decals) {
        if (Math.abs(d.x - camera.x) > halfW || Math.abs(d.y - camera.y) > halfH) continue;
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(d.angle);
        if (d.type === 'corpse') {
            GRIME.drawCorpse(ctx, d.size | 0, d.color, d.head);
        } else if (d.type === 'scrape') {
            // Rim scrape from a blown tire: a thin bright gouge, not rubber
            ctx.fillStyle = 'rgba(226, 218, 196, 0.3)';
            ctx.fillRect(-d.size, -0.8, d.size * 2, 1.6);
        } else if (d.type === 'skid') {
            ctx.fillStyle = 'rgba(20, 19, 15, 0.30)';
            ctx.fillRect(-d.size, -2.5, d.size * 2, 5);
        } else {
            ctx.fillStyle = d.color;
            ctx.beginPath();
            ctx.arc(0, 0, d.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    // 2b. FOLIAGE GROUND PASS: drop shadows + trunks (canopies are drawn with the buildings)
    drawFoliageGround(ctx, visibleFoliage);

    drawLawProps(nowSec0, halfW, halfH);

    // 3. DRAW PAYPHONE BOOTHS, MISSION TARGET RING & PICKUPS
    const nowSec = performance.now() * 0.001;
    for (const ph of payphones) drawPayphone(ph, nowSec);

    drawExportBoard();

    if (mission.active) {
        const col = mission.kind === 'kill' ? ROUTE : HAZARD;
        const drop = mission.type === 'steal_deliver' && mission.stage === 2;
        const r = (drop ? 95 : 34) + Math.sin(nowSec * 6) * 4;
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(mission.targetX, mission.targetY, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 8;
        ctx.stroke();
        ctx.strokeStyle = col;
        ctx.lineWidth = 5;
        ctx.setLineDash([14, 10]);
        ctx.lineDashOffset = -nowSec * 30;
        ctx.stroke();
        ctx.restore();
    }

    for (const pk of pickups) drawPickup(pk, nowSec);

    // 4. DRAW PEDESTRIANS
    for (const p of peds) {
        if (Math.abs(p.x - camera.x) > halfW || Math.abs(p.y - camera.y) > halfH) continue;
        const mv = Math.hypot(p.x - (p._px ?? p.x), p.y - (p._py ?? p.y));
        p._px = p.x;
        p._py = p.y;
        p._ph = (p._ph || 0) + mv * 0.075;
        drawCharacter(
            p.x,
            p.y,
            p.angle,
            p.color,
            p.skin || '#fed7aa',
            p._ph,
            false,
            mv > 0.05,
            ((p.x * 7) | 0) & 3,
            p.hair
        );
    }

    // 5. DRAW PLAYER (When On Foot)
    if (!player.inCar && player.deadTimer <= 0) {
        drawCharacter(
            player.x,
            player.y,
            player.angle,
            HAZARD,
            '#f1c9a0',
            player.walkCycle,
            true,
            player.walkCycle !== player._lastWC
        );
        player._lastWC = player.walkCycle;
        if (player.swimming) {
            // Head and shoulders above the surface: foam rings, a water-line over the body
            const ph = performance.now() * 0.006;
            ctx.fillStyle = 'rgba(47, 109, 181, 0.62)';
            ctx.beginPath();
            ctx.ellipse(player.x, player.y + 5, 14, 9, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(242, 248, 246, 0.85)';
            ctx.lineWidth = 2.5;
            for (let k = 0; k < 2; k++) {
                ctx.beginPath();
                ctx.arc(player.x, player.y + 3, 15 + ((ph + k * 3) % 6) * 2.2, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    }

    // 6. DRAW VEHICLES (With Drop Shadows, Headlights, Sirens, Turrets)
    const seen = cars.filter((c) => Math.abs(c.x - camera.x) <= halfW && Math.abs(c.y - camera.y) <= halfH);
    ctx.imageSmoothingEnabled = false; // chunky sprite pixels at every zoom
    for (const c of seen) drawVehicleShadow(c);
    for (const c of seen) if (!c.airborne) drawVehicle(c, nowSec);
    // Guardrails stand taller than a deck car: drawn over it
    for (let i = 0; i < overlayTiles.length; i += 2) drawBridgeRails(ctx, overlayTiles[i], overlayTiles[i + 1]);
    ctx.imageSmoothingEnabled = true;

    // 7. DRAW BULLETS & PARTICLES
    for (const b of bullets) {
        ctx.fillStyle = b.explosive ? ROUTE : INK;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.explosive ? 5.5 : 3, 0, Math.PI * 2);
        ctx.fill();
        if (b.explosive) {
            ctx.strokeStyle = INK;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    for (const pt of particles) {
        ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
        if (pt.ring) {
            // splash foam: an expanding ring
            ctx.strokeStyle = pt.color;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, pt.size + (1 - pt.life / pt.maxLife) * pt.grow, 0, Math.PI * 2);
            ctx.stroke();
            continue;
        }
        ctx.fillStyle = pt.color;
        if (pt.square) {
            ctx.fillRect(Math.round(pt.x - pt.size / 2), Math.round(pt.y - pt.size / 2), pt.size, pt.size);
            continue;
        }
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 7b. AIRBORNE CARS: their own pass above traffic, rails, foam and spray
    ctx.imageSmoothingEnabled = false;
    for (const c of seen) if (c.airborne) drawVehicle(c, nowSec);
    ctx.imageSmoothingEnabled = true;

    ctx.restore();

    // 8. DRAW TRUE 2.5D PERSPECTIVE-EXTRUDED BUILDINGS (Screen-Space Painter's Order!)
    // On the box front the city is seen through the die-cut window: lean buildings from the window's centre, flatter
    let cxScreen = view.w * 0.5;
    let cyScreen = view.h * 0.5;
    let hMul = Math.min(1, camera.zoom / 0.75);
    if (game.state === 'title' && game.attractWindow) {
        cxScreen = game.attractWindow.x;
        cyScreen = game.attractWindow.y;
        hMul *= 0.35;
    }
    // Shake moves the whole scene rigidly, so the vanishing point shakes with the footprints
    const vpSx = cxScreen + shakeX;
    const vpSy = cyScreen + shakeY;

    // Painter's order must be taken around the point the walls lean away from (the vanishing point),
    // otherwise a nearer box can be drawn underneath a farther one.
    const vpX = camera.x + (cxScreen - view.w * 0.5) / camera.zoom;
    const vpY = camera.y + (cyScreen - view.h * 0.5) / camera.zoom;
    for (const b of visibleBuildings) {
        const fp = footprint(b);
        b.d = ((fp.x0 + fp.x1) / 2 - vpX) ** 2 + ((fp.y0 + fp.y1) / 2 - vpY) ** 2;
    }
    // Tree canopies join the same far-to-near painter's order (cars and peds pass underneath)
    const props = visibleBuildings.concat(visibleFoliage.map((f) => ({ f, d: (f.x - vpX) ** 2 + (f.y - vpY) ** 2 })));
    props.sort((a, b) => b.d - a.d);

    // Ground shadows first, so no shadow is ever stamped over a neighbouring building's wall or roof
    ctx.fillStyle = 'rgba(20, 19, 15, 0.22)';
    for (const b of visibleBuildings) {
        const fp = footprint(b);
        const s = worldToScreen(fp.x0, fp.y0, shakeX, shakeY);
        ctx.fillRect(s.x + 8, s.y + 10, (fp.x1 - fp.x0) * camera.zoom, (fp.y1 - fp.y0) * camera.zoom);
    }

    for (const b of props) {
        if (b.f) {
            ctx.imageSmoothingEnabled = false;
            drawCanopy(ctx, b.f, vpSx, vpSy, hMul, shakeX, shakeY, nowSec);
            ctx.imageSmoothingEnabled = true;
            continue;
        }
        const fp = footprint(b);
        const wx0 = fp.x0;
        const wy0 = fp.y0;
        const wx1 = fp.x1;
        const wy1 = fp.y1;

        const s00 = worldToScreen(wx0, wy0, shakeX, shakeY);
        const s10 = worldToScreen(wx1, wy0, shakeX, shakeY);
        const s11 = worldToScreen(wx1, wy1, shakeX, shakeY);
        const s01 = worldToScreen(wx0, wy1, shakeX, shakeY);

        const h = b.meta.h * hMul;
        ctx.globalAlpha = b.bay ? b.bay.roofAlpha : 1; // the bay's roof fades so you can watch the car pull in
        const r00 = { x: s00.x + (s00.x - vpSx) * h, y: s00.y + (s00.y - vpSy) * h };
        const r10 = { x: s10.x + (s10.x - vpSx) * h, y: s10.y + (s10.y - vpSy) * h };
        const r11 = { x: s11.x + (s11.x - vpSx) * h, y: s11.y + (s11.y - vpSy) * h };
        const r01 = { x: s01.x + (s01.x - vpSx) * h, y: s01.y + (s01.y - vpSy) * h };

        if (s00.y > vpSy) drawWallQuad(s00, s10, r10, r00, b.meta.wall, b.meta.win, b.meta.winAlpha);
        if (s11.y < vpSy) drawWallQuad(s11, s01, r01, r11, b.meta.dark, b.meta.win, b.meta.winAlpha);
        if (s00.x > vpSx) drawWallQuad(s01, s00, r00, r01, b.meta.wall, b.meta.win, b.meta.winAlpha);
        if (s10.x < vpSx) drawWallQuad(s10, s11, r11, r10, b.meta.dark, b.meta.win, b.meta.winAlpha);

        const rw = r10.x - r00.x;
        const rh = r01.y - r00.y;
        ctx.fillStyle = b.meta.roof;
        ctx.fillRect(r00.x - 1.5, r00.y - 1, rw, rh); // colour plate printed slightly off the ink plate
        ctx.drawImage(GRIME.roof[(b.tx * 7 + b.ty * 13) & 3], r00.x, r00.y, rw, rh);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.strokeRect(r00.x, r00.y, rw, rh);

        if (b.meta.kind === 'container') {
            ctx.strokeStyle = 'rgba(20, 19, 15, 0.38)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let k = 1; k < 6; k++) {
                ctx.moveTo(r00.x + (rw * k) / 6, r00.y);
                ctx.lineTo(r00.x + (rw * k) / 6, r00.y + rh);
            }
            ctx.stroke();
            continue;
        }

        const pad = Math.max(4, rw * 0.09);
        ctx.strokeStyle = 'rgba(20, 19, 15, 0.28)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(r00.x + pad, r00.y + pad, rw - pad * 2, rh - pad * 2);
        if (b.meta.neon) {
            // Neon roof trim: wide soft halo + hot core
            ctx.strokeStyle = b.meta.neon;
            ctx.globalAlpha = 0.3;
            ctx.lineWidth = 7;
            ctx.strokeRect(r00.x + pad, r00.y + pad, rw - pad * 2, rh - pad * 2);
            ctx.globalAlpha = 1;
            ctx.lineWidth = 2.5;
            ctx.strokeRect(r00.x + pad, r00.y + pad, rw - pad * 2, rh - pad * 2);
        }

        ctx.globalAlpha = 1;
        if (b.bay) drawBayFront(b, s00, s10, s11, s01, vpSx, vpSy, h);

        if (b.meta.style === 0) {
            ctx.strokeStyle = 'rgba(20, 19, 15, 0.55)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(r00.x + rw * 0.5, r00.y + rh * 0.5, rw * 0.28, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(20, 19, 15, 0.55)';
            ctx.font = `italic 900 ${Math.max(10, Math.floor(rw * 0.3))}px "Archivo", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('H', r00.x + rw * 0.5, r00.y + rh * 0.5);
        } else if (b.meta.style === 1) {
            ctx.fillStyle = shade(b.meta.roof, 0.72);
            ctx.strokeStyle = INK;
            ctx.lineWidth = 1.5;
            ctx.fillRect(r00.x + rw * 0.2, r00.y + rh * 0.22, rw * 0.22, rh * 0.22);
            ctx.strokeRect(r00.x + rw * 0.2, r00.y + rh * 0.22, rw * 0.22, rh * 0.22);
            ctx.fillRect(r00.x + rw * 0.55, r00.y + rh * 0.55, rw * 0.25, rh * 0.22);
            ctx.strokeRect(r00.x + rw * 0.55, r00.y + rh * 0.55, rw * 0.25, rh * 0.22);
        } else if (b.meta.style === 2) {
            ctx.fillStyle = WATER;
            ctx.strokeStyle = INK;
            ctx.lineWidth = 1.5;
            ctx.fillRect(r00.x + rw * 0.25, r00.y + rh * 0.25, rw * 0.5, rh * 0.5);
            ctx.strokeRect(r00.x + rw * 0.25, r00.y + rh * 0.25, rw * 0.5, rh * 0.5);
        }
    }

    // Paper grain printed over the whole map (screen-space, fixed to the sheet not the camera)
    if (!render._paper) render._paper = ctx.createPattern(GRIME.paper, 'repeat');
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = render._paper;
    ctx.translate(-(camera.x * camera.zoom) % 256, -(camera.y * camera.zoom) % 256);
    ctx.fillRect(0, 0, view.w + 256, view.h + 256);
    ctx.restore();

    // 9. DRAW FLOATING ARCADE POP-UPS & DIRECTIONAL ARROWS!
    for (const ft of floatingTexts) {
        const sp = worldToScreen(ft.x, ft.y, shakeX, shakeY);
        ctx.globalAlpha = Math.min(1, Math.max(0, ft.life / ft.maxLife) * 3);
        ctx.font = `700 ${Math.round(24 * (ft.scale || 1))}px "Barlow Condensed", sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 5;
        ctx.strokeStyle = INK;
        ctx.strokeText(ft.text, sp.x, sp.y);
        ctx.fillStyle = ft.color;
        ctx.fillText(ft.text, sp.x, sp.y);
    }
    ctx.globalAlpha = 1;

    drawNavigationArrows(shakeX, shakeY);
    drawDangerChevrons(shakeX, shakeY, nowSec);
    drawRadar(nowSec);
}

// Fixed sidewalk booth: grounded, never bobs. Ringing/available phones are cyan with sound waves;
// while a job is running (or you're in a car) the booth goes quiet and grey.
function drawPayphone(ph, nowSec) {
    const live = !mission.active;
    const ringPhase = ph.ringPhase % PHONE_RING_PERIOD;
    const ringing = live && ringPhase < PHONE_RING_ON + 0.35; // arcs linger a beat past the last bell
    ctx.save();
    if (!live) ctx.globalAlpha = 0.5;
    ctx.translate(ph.x, ph.y);
    ctx.scale(1.3, 1.3);
    ctx.translate(-ph.x, -ph.y);
    ctx.fillStyle = 'rgba(20, 19, 15, 0.3)';
    ctx.fillRect(ph.x - 7, ph.y - 6, 22, 24);
    if (live) {
        const g = ctx.createRadialGradient(ph.x, ph.y, 4, ph.x, ph.y, 30);
        g.addColorStop(0, 'rgba(53, 200, 224, 0.28)');
        g.addColorStop(1, 'rgba(53, 200, 224, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(ph.x, ph.y, 30, 0, Math.PI * 2);
        ctx.fill();
    }
    // frame
    ctx.fillStyle = '#2a2d33';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(ph.x - 9, ph.y - 14, 18, 26, 3);
    ctx.fill();
    ctx.stroke();
    // header strip
    ctx.fillStyle = live ? PHONE : '#7b7f86';
    ctx.fillRect(ph.x - 8, ph.y - 13, 16, 7);
    ctx.fillStyle = INK;
    ctx.font = '700 6px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PHONE', ph.x, ph.y - 9.5);
    // glass + handset
    ctx.fillStyle = '#14161a';
    ctx.fillRect(ph.x - 6, ph.y - 4, 12, 12);
    ctx.fillStyle = live ? HAZARD : '#8a8d93';
    ctx.fillRect(ph.x - 4, ph.y - 2, 3, 8);
    ctx.fillRect(ph.x + 1, ph.y - 2, 3, 8);
    ctx.fillRect(ph.x - 4, ph.y - 2, 8, 2);
    ctx.restore();
    if (!live) return;

    if (ringing) {
        ctx.save();
        ctx.strokeStyle = PHONE;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
            const t = (((ringPhase * 1.8 + i / 3) % 1) + 1) % 1;
            ctx.globalAlpha = (1 - t) * 0.9;
            const r = 18 + t * 28;
            for (const side of [0, Math.PI]) {
                ctx.beginPath();
                ctx.arc(ph.x, ph.y - 2, r, side - 0.6, side + 0.6);
                ctx.stroke();
            }
        }
        ctx.restore();
    }
    if (Math.hypot(player.x - ph.x, player.y - ph.y) < 170) {
        const bob = Math.sin(nowSec * 6) * 2;
        const label = player.inCar ? 'ON FOOT' : 'CALL';
        const by = ph.y - 44 + bob;
        ctx.save();
        ctx.font = '700 13px "Barlow Condensed", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(label).width + 14;
        ctx.fillStyle = PAPER;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(ph.x - w / 2, by - 9, w, 18, 6);
        ctx.moveTo(ph.x - 4, by + 9);
        ctx.lineTo(ph.x, by + 14);
        ctx.lineTo(ph.x + 4, by + 9);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = INK;
        ctx.fillText(label, ph.x, by + 1);
        ctx.restore();
    }
}

// Floating arcade pickup: color-coded pulsing ground ring, hover bob and an occasional glint
function drawPickup(pk, nowSec) {
    const seed = pk.seed || 0;
    if (pk.timer > 0) {
        // collected: only a faint dashed mark shows the spot will come back
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.arc(pk.x, pk.y + 3, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        return;
    }
    const bounce = Math.sin(nowSec * 5 + seed) * 3;
    const ringR = 22 + Math.sin(nowSec * 4 + seed) * 3;
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = pk.color;
    ctx.beginPath();
    ctx.arc(pk.x, pk.y + 3, ringR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = pk.color;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = 'rgba(20, 19, 15, 0.3)';
    ctx.beginPath();
    ctx.arc(pk.x + 2, pk.y + 5, 16 - bounce * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(pk.x, pk.y + bounce, 16, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(pk.x, pk.y + bounce, 13.5, 0, Math.PI * 2);
    ctx.fillStyle = PAPER;
    ctx.fill();
    ctx.strokeStyle = pk.color;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = '700 13px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(PICKUP_LABEL[pk.kind] || '?', pk.x, pk.y + bounce + 1);

    // glint: a 4-point sparkle for ~0.25s every 2.4s
    const gp = (nowSec + seed) % 2.4;
    if (gp < 0.25) {
        const sz = 7 * Math.sin((gp / 0.25) * Math.PI);
        const gx = pk.x + 10;
        const gy = pk.y + bounce - 11;
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(gx, gy - sz);
        ctx.lineTo(gx + sz * 0.25, gy - sz * 0.25);
        ctx.lineTo(gx + sz, gy);
        ctx.lineTo(gx + sz * 0.25, gy + sz * 0.25);
        ctx.lineTo(gx, gy + sz);
        ctx.lineTo(gx - sz * 0.25, gy + sz * 0.25);
        ctx.lineTo(gx - sz, gy);
        ctx.lineTo(gx - sz * 0.25, gy - sz * 0.25);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }
}

const PICKUP_LABEL = { uzi: 'SMG', rocket: 'RKT', armor: 'ARM', health: 'HP', bribe: '$' };

// Persistent wanted-car checklist beside the export bay
const BOARD_ROWS = [
    ['hellcrab', 'HELLCRAB GTS'],
    ['blitz', 'BLITZ V8'],
    ['cabbie', 'CABBIE'],
    ['bumbler', 'BUMBLER']
];
function drawExportBoard() {
    const { x, y } = LANDMARKS.exportBoard;
    if (Math.abs(x - camera.x) > view.w / camera.zoom || Math.abs(y - camera.y) > view.h / camera.zoom) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(20, 19, 15, 0.3)';
    ctx.fillRect(-52, -50, 112, 108);
    ctx.fillStyle = INK;
    ctx.fillRect(-56, -54, 112, 108);
    ctx.fillStyle = HAZARD;
    ctx.fillRect(-56, -54, 112, 20);
    ctx.fillStyle = INK;
    ctx.font = 'italic 900 14px "Archivo", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EXPORT ORDERS', 0, -43);
    ctx.textAlign = 'left';
    ctx.font = '700 13px "Barlow Condensed", sans-serif';
    BOARD_ROWS.forEach(([key, label], i) => {
        const ry = -20 + i * 20;
        ctx.strokeStyle = HAZARD;
        ctx.lineWidth = 2;
        ctx.strokeRect(-48, ry - 6, 12, 12);
        if (exportBoard[key]) {
            ctx.strokeStyle = '#6ee787';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(-46, ry);
            ctx.lineTo(-42, ry + 4);
            ctx.lineTo(-37, ry - 6);
            ctx.stroke();
        }
        ctx.fillStyle = exportBoard[key] ? '#6ee787' : PAPER;
        ctx.fillText(label, -30, ry + 1);
    });
    ctx.restore();
}

const lerpPt = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const leanPt = (p, vpSx, vpSy, h) => ({ x: p.x + (p.x - vpSx) * h, y: p.y + (p.y - vpSy) * h });

// Roller shutter (slides up as it opens), door housing and the neon shop sign, always at full alpha
function drawBayFront(b, s00, s10, s11, s01, vpSx, vpSy, h) {
    const bay = b.bay;
    const info = BAY_INFO[bay.type];
    // entrance edge corners in screen space (dir 0 E, 1 S, 2 W, 3 N)
    const [e0, e1] = [
        [s10, s11],
        [s11, s01],
        [s01, s00],
        [s00, s10]
    ][bay.dir];
    const door = Math.min(0.12, h * 0.8);
    const top0 = leanPt(e0, vpSx, vpSy, door);
    const top1 = leanPt(e1, vpSx, vpSy, door);
    // shutter panel: lower edge rises as it opens
    const lo = bay.shutter * door;
    if (bay.shutter < 0.98) {
        const a0 = leanPt(e0, vpSx, vpSy, lo);
        const a1 = leanPt(e1, vpSx, vpSy, lo);
        ctx.fillStyle = '#9aa1a8';
        ctx.beginPath();
        ctx.moveTo(a0.x, a0.y);
        ctx.lineTo(a1.x, a1.y);
        ctx.lineTo(top1.x, top1.y);
        ctx.lineTo(top0.x, top0.y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(20, 19, 15, 0.55)';
        ctx.lineWidth = 1.5;
        for (let k = 1; k < 7; k++) {
            const t = k / 7;
            const p = lerpPt(a0, top0, t);
            const q = lerpPt(a1, top1, t);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
        }
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    // door housing
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(top0.x, top0.y);
    ctx.lineTo(top1.x, top1.y);
    ctx.stroke();
    // red buzzer flash on a rejection
    if (bay.state === 'reject' && Math.floor(performance.now() / 150) % 2 === 0) {
        const m = lerpPt(top0, top1, 0.5);
        ctx.fillStyle = '#ff2a2a';
        ctx.beginPath();
        ctx.arc(m.x, m.y, 9 * Math.max(0.6, camera.zoom), 0, Math.PI * 2);
        ctx.fill();
    }
    // neon awning sign on the roof lip above the door
    const r0 = leanPt(e0, vpSx, vpSy, h);
    const r1 = leanPt(e1, vpSx, vpSy, h);
    const m = lerpPt(r0, r1, 0.5);
    const fs = Math.max(9, 17 * camera.zoom);
    ctx.font = `italic 900 ${fs}px "Archivo", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(info.label).width + 14;
    const pulse = 0.8 + Math.sin(performance.now() * 0.008 + bay.tx) * 0.2;
    ctx.fillStyle = INK;
    ctx.fillRect(Math.round(m.x - tw / 2), Math.round(m.y - fs * 0.7), Math.round(tw), Math.round(fs * 1.4));
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = info.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(
        Math.round(m.x - tw / 2) + 1,
        Math.round(m.y - fs * 0.7) + 1,
        Math.round(tw) - 2,
        Math.round(fs * 1.4) - 2
    );
    ctx.fillStyle = info.color;
    ctx.fillText(info.label, m.x, m.y + 1);
    ctx.globalAlpha = 1;
}

export function drawWallQuad(b1, b2, t2, t1, wallColor, winColor, winAlpha = 0.5) {
    ctx.fillStyle = wallColor;
    ctx.beginPath();
    ctx.moveTo(b1.x, b1.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.lineTo(t2.x, t2.y);
    ctx.lineTo(t1.x, t1.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (winAlpha <= 0) return;
    const a0 = ctx.globalAlpha;
    ctx.fillStyle = winColor;
    ctx.globalAlpha = a0 * winAlpha;
    for (let row = 0.25; row <= 0.78; row += 0.26) {
        for (let col = 0.18; col <= 0.82; col += 0.22) {
            const wxA = (b1.x * (1 - col) + b2.x * col) * (1 - row) + (t1.x * (1 - col) + t2.x * col) * row;
            const wyA = (b1.y * (1 - col) + b2.y * col) * (1 - row) + (t1.y * (1 - col) + t2.y * col) * row;
            ctx.fillRect(wxA - 2.5, wyA - 2, 5, 4);
        }
    }
    ctx.globalAlpha = a0;
}

export function drawCharacter(
    x,
    y,
    angle,
    shirtColor,
    headColor,
    cycle = 0,
    isPlayer = false,
    moving = true,
    salt = 0,
    hair = null
) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const armed = isPlayer && player.weaponIdx > 0;
    if (isPlayer && GRIME.drawPlayer(ctx, cycle, moving, armed)) {
        // gun drawn in the sprite's hand
    } else if (hair && GRIME.drawNpc(ctx, cycle, moving, shirtColor, hair, headColor)) {
        // recoloured NPC sprite
    } else {
        GRIME.drawPed(ctx, cycle, performance.now() * 0.001, salt, shirtColor, headColor, moving);
        if (armed) {
            ctx.fillStyle = '#27272a';
            ctx.fillRect(4, 2, 11, 3.5);
        }
    }
    ctx.restore();
}
export function drawCharacterVector(x, y, angle, shirtColor, headColor, cycle = 0, isPlayer = false) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Shadow
    ctx.fillStyle = 'rgba(20,19,15,0.3)';
    ctx.beginPath();
    ctx.arc(2, 3, 9, 0, Math.PI * 2);
    ctx.fill();

    // Swinging arms/feet when walking
    const swing = Math.sin(cycle) * 4;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-3 + swing, -9, 6, 4);
    ctx.fillRect(-3 - swing, 5, 6, 4);

    // Shoulders / Shirt
    ctx.fillStyle = shirtColor;
    ctx.beginPath();
    ctx.roundRect(-6, -8, 12, 16, 4);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Weapon held forward
    if (isPlayer && player.weaponIdx > 0) {
        ctx.fillStyle = '#27272a';
        ctx.fillRect(4, 2, 11, 3.5);
    }

    // Head
    ctx.fillStyle = headColor;
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

export function carGrime(c) {
    if (c._grime) return c._grime;
    c._gs = c._gs || ((Math.random() * 1e9) | 0) + 1;
    const skin = skinOf(c);
    const R = 2,
        w = skin ? skin.dw : c.spec.w,
        l = c.spec.l,
        cv = document.createElement('canvas');
    cv.width = Math.ceil(l * R);
    cv.height = Math.ceil(w * R);
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    let a = c._gs;
    const r = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    g.scale(R, R);
    g.save();
    g.beginPath();
    g.roundRect(0, 0, l, w, c.spec.isTank ? 3 : 7);
    g.clip();
    for (let i = 0; i < 90; i++) {
        g.fillStyle = `rgba(20,19,15,${(r() * 0.22).toFixed(2)})`;
        g.fillRect(r() * l, r() * w, 0.8 + r() * 1.2, 0.8 + r());
    }
    for (let i = 0; i < 2; i++) {
        // oil stains, heavier toward the engine end
        const x = l * (0.65 + r() * 0.3),
            y = r() * w,
            k = 5 + r() * 6;
        const gr = g.createRadialGradient(x, y, 0, x, y, k);
        gr.addColorStop(0, 'rgba(30,22,14,0.35)');
        gr.addColorStop(1, 'rgba(30,22,14,0)');
        g.fillStyle = gr;
        g.fillRect(x - k, y - k, k * 2, k * 2);
    }
    const rusty = r() < 0.7;
    if (rusty)
        for (let i = 0; i < 4; i++) {
            // rust creeping in from the edges
            const x = r() < 0.5 ? r() * l : r() < 0.5 ? 1 : l - 1,
                y = x <= 1 || x >= l - 1 ? r() * w : r() < 0.5 ? 1 : w - 1,
                k = 3 + r() * 5;
            const gr = g.createRadialGradient(x, y, 0, x, y, k);
            gr.addColorStop(0, 'rgba(140,70,25,0.55)');
            gr.addColorStop(1, 'rgba(140,70,25,0)');
            g.fillStyle = gr;
            g.fillRect(x - k, y - k, k * 2, k * 2);
        }
    g.strokeStyle = 'rgba(20,19,15,0.25)';
    g.lineWidth = 0.8; // scratches
    for (let i = 0; i < 3; i++) {
        const x = r() * l,
            y = r() * w;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (r() - 0.5) * 14, y + (r() - 0.5) * 6);
        g.stroke();
    }
    g.restore();
    if (skin) {
        // Keep the grime inside the sprite's silhouette (sprite art is nose-up, the grime canvas nose-right)
        g.save();
        g.globalCompositeOperation = 'destination-in';
        g.translate(l / 2, w / 2);
        g.rotate(Math.PI / 2);
        g.drawImage(skin.mask, -skin.dw / 2, -skin.dh / 2, skin.dw, skin.dh);
        g.restore();
    }
    return (c._grime = cv);
}

function drawBeams(c, l, w) {
    if (c.driver && c.hp > 0 && !c.spec.isTank) {
        const grad = ctx.createLinearGradient(l * 0.5, 0, l * 0.5 + 85, 0);
        grad.addColorStop(0, 'rgba(254, 240, 138, 0.28)');
        grad.addColorStop(1, 'rgba(254, 240, 138, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(l * 0.48, -w * 0.35);
        ctx.lineTo(l * 0.5 + 85, -w * 0.9);
        ctx.lineTo(l * 0.5 + 85, w * 0.9);
        ctx.lineTo(l * 0.48, w * 0.35);
        ctx.closePath();
        ctx.fill();
    }
}

// Car bomb: satchel on the roof; once armed it blinks red/orange, faster as the fuse runs down
function drawCarBomb(c, nowSec, l) {
    if (!c.hasBomb || c.hp <= 0) return;
    const x = -l * 0.1;
    ctx.fillStyle = INK;
    ctx.fillRect(x, -5, 10, 10);
    let col = '#5a1a1a';
    let glow = false;
    if (c.bombArmed) {
        const s = Math.sin(nowSec * (16 + (5 - Math.min(5, c.bombTimer)) * 8));
        col = s > 0 ? '#ff2a2a' : '#ff8a2a';
        glow = s > 0;
    }
    ctx.fillStyle = col;
    ctx.fillRect(x + 3, -2, 4, 4);
    if (c.bombArmed) {
        ctx.fillRect(x, -5, 2, 2);
        ctx.fillRect(x + 8, 3, 2, 2);
    }
    if (glow) {
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(x + 5, 0, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

// Roof bomb, grime and dents, in the car frame (nose = +x)
function drawCarTop(c, nowSec, l, w) {
    drawCarBomb(c, nowSec, l);

    // Grime: oil, rust and dents (static layer cached per car, dents grow with damage)
    const gm = carGrime(c);
    ctx.drawImage(gm, -l * 0.5, -w * 0.5, l, w);
    const dents = Math.min(7, Math.floor((1 - Math.max(0, c.hp) / c.maxHp) * 8));
    for (let i = 0; i < dents; i++) {
        const h = (c._gs * (i + 3) * 2654435761) >>> 0;
        const dx = ((h & 255) / 255 - 0.5) * l * 0.8,
            dy = (((h >> 8) & 255) / 255 - 0.5) * w * 0.8,
            dr = 3 + ((h >> 16) & 3);
        ctx.fillStyle = 'rgba(20,19,15,0.28)';
        ctx.beginPath();
        ctx.ellipse(dx, dy, dr * 1.4, dr, (h & 7) * 0.4, 0, 6.283);
        ctx.fill();
        ctx.strokeStyle = 'rgba(236,230,210,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(dx, dy, dr * 1.1, 3.6, 5.3);
        ctx.stroke();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(dx - dr, dy + dr * 0.3);
        ctx.lineTo(dx, dy - dr * 0.2);
        ctx.lineTo(dx + dr, dy + dr * 0.4);
        ctx.stroke();
    }
}

// Spike strips (glittering steel) and wooden police sawhorses laid out by roadblocks
function drawLawProps(nowSec, halfW, halfH) {
    for (const s of spikeStrips) {
        if (Math.abs(s.x - camera.x) > halfW + 60 || Math.abs(s.y - camera.y) > halfH + 60) continue;
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.angle);
        const L = s.len;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(-L / 2 + 2, -2.5, L, 7);
        ctx.fillStyle = '#4b5563';
        ctx.fillRect(-L / 2, -3.5, L, 7);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1;
        ctx.strokeRect(-L / 2, -3.5, L, 7);
        let i = 0;
        for (let x = -L / 2 + 3; x < L / 2 - 2; x += 5, i++) {
            ctx.fillStyle = '#e5e7eb';
            ctx.beginPath();
            ctx.moveTo(x, -3.5);
            ctx.lineTo(x + 2, -7.5);
            ctx.lineTo(x + 4, -3.5);
            ctx.moveTo(x, 3.5);
            ctx.lineTo(x + 2, 7.5);
            ctx.lineTo(x + 4, 3.5);
            ctx.fill();
            if (Math.sin(nowSec * 6 + i * 1.7) > 0.85) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(x + 1, -1, 2, 2); // glint
            }
        }
        ctx.restore();
    }
    for (const rb of roadblocks) {
        for (const pr of rb.props) {
            if (pr.hit && pr.life <= 0) continue;
            if (Math.abs(pr.x - camera.x) > halfW + 40 || Math.abs(pr.y - camera.y) > halfH + 40) continue;
            ctx.save();
            ctx.translate(pr.x, pr.y);
            ctx.rotate(pr.angle);
            if (pr.hit) ctx.globalAlpha = Math.max(0, pr.life / 0.8);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
            ctx.fillRect(-14, -2, 30, 9);
            ctx.fillStyle = '#f5f1e6';
            ctx.fillRect(-15, -4, 30, 8);
            ctx.fillStyle = '#e8731a';
            for (let k = 0; k < 4; k++) ctx.fillRect(-15 + k * 8, -4, 4, 8);
            ctx.strokeStyle = INK;
            ctx.lineWidth = 1;
            ctx.strokeRect(-15, -4, 30, 8);
            ctx.fillStyle = INK;
            ctx.fillRect(-12, -6, 2, 3);
            ctx.fillRect(10, -6, 2, 3);
            ctx.restore();
        }
    }
}

function drawVehicleVector(c, nowSec) {
    const w = c.spec.w;
    const l = c.spec.l;

    ctx.save();
    ctx.translate(c.x, c.y);
    applyAirScale(ctx, c);
    ctx.rotate(c.angle);

    // Drop shadow
    ctx.fillStyle = 'rgba(20, 19, 15, 0.32)';
    ctx.beginPath();
    ctx.roundRect(-l * 0.5 + 4, -w * 0.5 + 5, l, w, 6);
    ctx.fill();

    drawBeams(c, l, w);

    // Tires / Tank Treads
    ctx.fillStyle = INK;
    if (c.spec.isTank) {
        ctx.fillRect(-l * 0.48, -w * 0.54, l * 0.96, 7);
        ctx.fillRect(-l * 0.48, w * 0.54 - 7, l * 0.96, 7);
    } else {
        ctx.fillRect(l * 0.22, -w * 0.55, 11, 4);
        ctx.fillRect(l * 0.22, w * 0.55 - 4, 11, 4);
        ctx.fillRect(-l * 0.36, -w * 0.55, 11, 4);
        ctx.fillRect(-l * 0.36, w * 0.55 - 4, 11, 4);
    }

    // Main Chassis Body
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.roundRect(-l * 0.5, -w * 0.5, l, w, c.spec.isTank ? 3 : 7);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Police White Doors
    if (c.spec.isPolice && c.hp > 0) {
        ctx.fillStyle = PAPER;
        ctx.fillRect(-l * 0.18, -w * 0.46, l * 0.38, w * 0.92);
    }

    // Racing Stripes (Hellcrab GTS / Blitz / Taxi Checker)
    if (c.spec.stripe && c.hp > 0) {
        ctx.fillStyle = c.spec.stripe;
        ctx.fillRect(-l * 0.48, -3, l * 0.96, 6);
    }

    if (c.spec.isTank) {
        // Tank Turret & Cannon Barrel
        ctx.fillStyle = '#6a8a3a';
        ctx.beginPath();
        ctx.arc(-4, 0, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#27272a';
        ctx.fillRect(4, -3.5, 34, 7);
    } else {
        // Windshield & Rear Window
        ctx.fillStyle = c.hp > 0 ? '#23303f' : '#3a3a36';
        ctx.fillRect(l * 0.06, -w * 0.38, l * 0.2, w * 0.76);
        ctx.fillRect(-l * 0.32, -w * 0.36, l * 0.14, w * 0.72);

        // Roof
        ctx.fillStyle = c.spec.isPolice && c.hp > 0 ? PAPER : c.color;
        ctx.fillRect(-l * 0.18, -w * 0.38, l * 0.24, w * 0.76);

        // Taxi Yellow Roof Sign
        if (c.spec.taxiSign && c.hp > 0) {
            ctx.fillStyle = '#fef08a';
            ctx.fillRect(-4, -6, 7, 12);
        }

        // Flashing Red & Blue Police Lightbar!
        if (c.spec.isPolice && c.hp > 0) {
            const flash = Math.floor(nowSec * 10) % 2 === 0;
            ctx.fillStyle = c.sirenOn || c.lightsOnly ? (flash ? '#d23a2a' : '#3b82f6') : '#64748b';
            ctx.fillRect(-4, -w * 0.32, 7, w * 0.3);
            ctx.fillStyle = c.sirenOn || c.lightsOnly ? (flash ? '#3b82f6' : '#d23a2a') : '#64748b';
            ctx.fillRect(-4, 1, 7, w * 0.3);
        }

        // Headlights & Taillights
        if (c.hp > 0) {
            ctx.fillStyle = '#fef08a';
            ctx.fillRect(l * 0.46, -w * 0.4, 3, 6);
            ctx.fillRect(l * 0.46, w * 0.4 - 6, 3, 6);
            ctx.fillStyle = '#d23a2a';
            ctx.fillRect(-l * 0.49, -w * 0.4, 3, 6);
            ctx.fillRect(-l * 0.49, w * 0.4 - 6, 3, 6);
        }
    }

    drawCarTop(c, nowSec, l, w);

    ctx.restore();
}

// Pass 1 (ground): every car's shadow before any body, so a shadow never lands on a neighbouring car
export function drawVehicleShadow(c) {
    const skin = skinOf(c);
    if (!skin || c.sink > 0.7) return;
    // Sun in the north-west, like the trees and peds. The higher the car, the further south-east its shadow falls
    // on the surface below (even across the water), smaller and fainter.
    const off = 6 + Math.max(0, c.z) * 0.6;
    const k = 1 - Math.min(0.18, Math.max(0, c.z) / 300);
    ctx.save();
    ctx.globalAlpha = Math.max(0.4, 1 - Math.max(0, c.z) / 190) * (1 - (c.sink || 0));
    ctx.translate(c.x + off, c.y + off);
    ctx.rotate(c.angle + Math.PI / 2);
    ctx.drawImage(skin.shadow, (-skin.dw / 2) * k, (-skin.dh / 2) * k, skin.dw * k, skin.dh * k);
    ctx.restore();
    const t = skin.turret;
    if (t) {
        ctx.save();
        ctx.globalAlpha = 1 - (c.sink || 0);
        ctx.translate(c.x + off + Math.cos(c.angle) * t.ring, c.y + off + Math.sin(c.angle) * t.ring);
        ctx.rotate(c.turretAngle + Math.PI / 2);
        ctx.drawImage(t.shadow, -t.ox, -t.oy, skin.dw, skin.dh);
        ctx.restore();
    }
}

// Pass 2 (cars): chassis, siren, grime, bomb, door flap, then the independently aimed turret
export function drawVehicle(c, nowSec) {
    const skin = skinOf(c);
    if (!skin) return drawVehicleVector(c, nowSec);
    const l = skin.dh;
    const w = skin.dw;

    ctx.save();
    ctx.translate(c.x, c.y);
    applyAirScale(ctx, c);
    ctx.rotate(c.angle);
    if (c.sink > 0) ctx.globalAlpha = 1 - 0.45 * Math.min(1, c.sink);
    if (c.driver && c.hp > 0 && !c.spec.isTank && !(c.sink > 0)) drawBeams(c, l, w);

    // Sprites are drawn nose-up, the car frame is nose-right
    ctx.save();
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(bodyOf(c, skin), -w / 2, -l / 2, w, l);
    if (c.sink > 0) {
        ctx.globalAlpha = Math.min(0.78, c.sink * 0.95) * (1 - 0.45 * Math.min(1, c.sink));
        ctx.drawImage(tealOf(skin), -w / 2, -l / 2, w, l);
        ctx.globalAlpha = 1 - 0.45 * Math.min(1, c.sink);
    }
    if (skin.lights && c.hp > 0 && (c.sirenOn || c.lightsOnly)) {
        const flash = Math.floor(nowSec * 10) % 2 === 0;
        const k = skin.k;
        for (const { x0, x1, y, h, c: cols } of skin.lights) {
            const mid = (x0 + x1) / 2;
            for (const [a, b, left] of [
                [x0, mid, true],
                [mid, x1, false]
            ]) {
                ctx.fillStyle = flash === left ? cols[0] : cols[1];
                ctx.fillRect((a - skin.rw / 2) * k, (y - skin.rh / 2) * k, (b - a) * k, h * k);
                ctx.globalAlpha = 0.3;
                ctx.fillRect((a - skin.rw / 2) * k - 2, (y - skin.rh / 2) * k - 2, (b - a) * k + 4, h * k + 4);
                ctx.globalAlpha = 1;
            }
        }
    }
    ctx.restore();

    drawCarTop(c, nowSec, l, w);

    // Door flap swings open and shut at the driver's (left) hinge while jacking / entering / exiting
    if (c.doorT > 0 && !c.spec.isTank) {
        ctx.save();
        ctx.translate(l * 0.12, -w / 2);
        ctx.rotate(Math.sin(Math.PI * (1 - c.doorT / 0.5)) * 1.1);
        ctx.drawImage(doorFor(skin.def.door || c.color), -12, -2.5);
        ctx.restore();
    }

    const t = skin.turret;
    if (t) {
        ctx.save();
        ctx.translate(t.ring, 0);
        ctx.rotate(c.turretAngle - c.angle + Math.PI / 2);
        ctx.drawImage(c.hp > 0 ? t.plain : t.wreck, -t.ox, -t.oy, w, l);
        ctx.restore();
    }
    ctx.restore();
}

// Orbiting Navigation Arrows around Player!
// Gold = go there, red = kill/destroy it, cyan = a ringing payphone. The arrow reads out live meters and
// hands off to a bouncing chevron over the target once it is on screen.
let navBlend = 0;
let navLastT = 0;
export function drawNavigationArrows(shakeX, shakeY) {
    const pScreen = worldToScreen(player.x, player.y, shakeX, shakeY);
    const now = performance.now() * 0.001;
    const dt = Math.min(0.1, now - navLastT);
    navLastT = now;

    // 1. Main arrow -> active mission target OR nearest payphone
    let targetX = null;
    let targetY = null;
    let arrowColor;

    if (mission.active) {
        targetX = mission.targetX;
        targetY = mission.targetY;
        arrowColor = mission.kind === 'kill' ? ROUTE : HAZARD;
    } else {
        let bestD = Infinity;
        for (const ph of payphones) {
            const d = Math.hypot(ph.x - player.x, ph.y - player.y);
            if (d < bestD) {
                bestD = d;
                targetX = ph.x;
                targetY = ph.y;
            }
        }
        arrowColor = PHONE;
    }

    if (targetX === null) {
        navBlend = 0;
    } else {
        const dist = Math.hypot(targetX - player.x, targetY - player.y);
        const label = `${Math.round(dist * METERS_PER_PX)}m`;
        // only job targets hand off to a chevron; a booth already has its own waves + CALL bubble
        const handoff = mission.active && isOnScreen(targetX, targetY, -60);
        navBlend += ((handoff ? 1 : 0) - navBlend) * Math.min(1, dt * 8);
        if (dist > 95 && navBlend < 0.99) {
            drawSingleArrow(
                pScreen.x,
                pScreen.y,
                Math.atan2(targetY - player.y, targetX - player.x),
                68,
                arrowColor,
                label,
                1 - navBlend
            );
        }
        if (navBlend > 0.01) {
            const sp = worldToScreen(targetX, targetY, shakeX, shakeY);
            drawTargetChevron(sp.x, sp.y - 46 - Math.abs(Math.sin(now * 6)) * 8, arrowColor, label, navBlend);
        }
    }

    // 2. Blue Arrow -> Nearest Spray-B-Gone bay when Wanted!
    if (Math.floor(player.wanted) >= 1) {
        let bestSp = null;
        let bestD = Infinity;
        for (const sp of bays) {
            if (sp.type !== 'spray') continue;
            const d = Math.hypot(sp.ex - player.x, sp.ey - player.y);
            if (d < bestD) {
                bestD = d;
                bestSp = sp;
            }
        }
        if (bestSp && bestD > 95) {
            drawSingleArrow(pScreen.x, pScreen.y, Math.atan2(bestSp.ey - player.y, bestSp.ex - player.x), 86, WATER);
        }
    }
}

// On foot, a fast car that will run you down and is still off screen gets a red edge chevron pointing at it
function drawDangerChevrons(shakeX, shakeY, nowSec) {
    if (player.inCar || player.deadTimer > 0) return;
    const threats = [];
    for (const c of cars) {
        if (c.hp <= 0 || c.airborne || c.sink > 0) continue;
        const speed = Math.hypot(c.vx, c.vy);
        if (speed < DANGER_MIN_SPEED) continue;
        const ux = c.vx / speed;
        const uy = c.vy / speed;
        const rx = player.x - c.x;
        const ry = player.y - c.y;
        const along = rx * ux + ry * uy;
        if (along <= 0) continue; // driving away
        const eta = along / speed;
        if (eta >= DANGER_MAX_ETA || Math.abs(rx * uy - ry * ux) >= DANGER_MAX_MISS) continue;
        if (isOnScreen(c.x, c.y, 0)) continue; // already visible: the player can see it coming
        threats.push({ c, eta });
    }
    if (!threats.length) return;
    threats.sort((a, b) => a.eta - b.eta);
    const cx = view.w * 0.5;
    const cy = view.h * 0.5;
    const mx = 30;
    const myTop = Math.max(30, view.insetTop + 24);
    for (const { c, eta } of threats.slice(0, DANGER_MAX_COUNT)) {
        const sp = worldToScreen(c.x, c.y, shakeX, shakeY);
        const dx = sp.x - cx;
        const dy = sp.y - cy;
        // Where the ray from the screen centre to the car leaves the (HUD-inset) view rectangle
        const t = Math.min(
            (cx - mx) / Math.max(1e-3, Math.abs(dx)),
            (dy < 0 ? cy - myTop : cy - 30) / Math.max(1e-3, Math.abs(dy))
        );
        const blink = 0.65 + 0.35 * Math.sin(nowSec * 22);
        drawSingleArrow(cx + dx * t, cy + dy * t, Math.atan2(dy, dx), 0, '#ff3b30', null, eta < 0.6 ? 1 : blink);
    }
}

// Bouncing downward chevron above the target, with the distance readout over it
function drawTargetChevron(x, y, color, label, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 14);
    ctx.lineTo(-13, -4);
    ctx.lineTo(-5, -4);
    ctx.lineTo(-5, -10);
    ctx.lineTo(5, -10);
    ctx.lineTo(5, -4);
    ctx.lineTo(13, -4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    drawDistancePill(0, -24, label);
    ctx.restore();
}

function drawDistancePill(x, y, label) {
    ctx.font = '700 15px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width + 12;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 9, w, 18, 6);
    ctx.fill();
    ctx.fillStyle = PAPER;
    ctx.fillText(label, x, y + 1);
}

export function drawSingleArrow(cx, cy, angle, orbitRadius, color, label = null, alpha = 1) {
    if (label) {
        ctx.save();
        ctx.globalAlpha = alpha;
        drawDistancePill(cx + Math.cos(angle) * (orbitRadius + 34), cy + Math.sin(angle) * (orbitRadius + 34), label);
        ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx + Math.cos(angle) * orbitRadius, cy + Math.sin(angle) * orbitRadius);
    ctx.rotate(angle);
    ctx.scale(1.25, 1.25);
    ctx.shadowColor = 'rgba(20, 19, 15, 0.35)';
    ctx.shadowOffsetY = 3;
    ctx.shadowBlur = 4;
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.lineTo(-8, -9);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.stroke();
    ctx.restore();
}
