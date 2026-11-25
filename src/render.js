import { isRoadCell } from './city.js';
import {
    MAP_SIZE,
    TILE,
    T_ALLEY,
    T_BAY,
    T_BLDG,
    T_GRASS,
    T_PAVEMENT,
    T_ROAD_H,
    T_ROAD_V,
    T_ROAD_X,
    T_WATER
} from './config.js';
import { DISTRICTS, districtAtTile } from './districts.js';
import { drawCanopy, drawFoliageGround } from './foliage.js';
import { GRIME } from './grime.js';
import { HAZARD, INK, PAPER, PARK, ROUTE, STREETS_H, STREETS_V, WATER, shade } from './palette.js';
import {
    bays,
    bldgMeta,
    bullets,
    camera,
    cars,
    ctx,
    decals,
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
                        rW = isRoadCell(tx - 1, ty),
                        rE = isRoadCell(tx + 1, ty);
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

    // 3. DRAW RINGING PAYPHONES & PICKUPS
    const nowSec = performance.now() * 0.001;
    for (const ph of payphones) {
        if (!mission.active) {
            const pulse = (nowSec * 38) % 34;
            ctx.strokeStyle = `rgba(210, 58, 42, ${1 - pulse / 34})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(ph.x, ph.y, 12 + pulse, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.fillStyle = 'rgba(20, 19, 15, 0.3)';
        ctx.fillRect(ph.x - 8, ph.y - 7, 20, 20);
        ctx.fillStyle = HAZARD;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(ph.x - 10, ph.y - 10, 20, 20, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = INK;
        ctx.fillRect(ph.x - 6, ph.y - 5, 12, 3);
        ctx.fillRect(ph.x - 6, ph.y - 5, 3, 8);
        ctx.fillRect(ph.x + 3, ph.y - 5, 3, 8);
    }

    if (mission.active && mission.type === 'steal_deliver' && mission.stage === 2) {
        const r = 40 + Math.sin(nowSec * 6) * 5;
        ctx.fillStyle = 'rgba(210, 58, 42, 0.14)';
        ctx.beginPath();
        ctx.arc(mission.targetX, mission.targetY, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = ROUTE;
        ctx.lineWidth = 5;
        ctx.setLineDash([14, 10]);
        ctx.lineDashOffset = -nowSec * 30;
        ctx.stroke();
        ctx.setLineDash([]);
    }

    const PICKUP_LABEL = { uzi: 'SMG', rocket: 'RKT', armor: 'ARM', health: 'HP', bribe: '$' };
    for (const pk of pickups) {
        if (pk.timer > 0) continue;
        const bounce = Math.sin(nowSec * 5 + pk.x) * 3;
        ctx.fillStyle = 'rgba(20, 19, 15, 0.3)';
        ctx.beginPath();
        ctx.arc(pk.x + 2, pk.y + 5, 16, 0, Math.PI * 2);
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
    }

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
        if (p.role === 'boss') {
            // Red boss arrow highlight
            ctx.strokeStyle = ROUTE;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 18 + Math.sin(nowSec * 8) * 3, 0, Math.PI * 2);
            ctx.stroke();
        }
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
    }

    // 6. DRAW VEHICLES (With Drop Shadows, Headlights, Sirens, Turrets)
    for (const c of cars) {
        if (Math.abs(c.x - camera.x) > halfW || Math.abs(c.y - camera.y) > halfH) continue;
        drawVehicle(c, nowSec);
    }

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
        b.d = ((b.tx + 0.5) * TILE - vpX) ** 2 + ((b.ty + 0.5) * TILE - vpY) ** 2;
    }
    // Tree canopies join the same far-to-near painter's order (cars and peds pass underneath)
    const props = visibleBuildings.concat(visibleFoliage.map((f) => ({ f, d: (f.x - vpX) ** 2 + (f.y - vpY) ** 2 })));
    props.sort((a, b) => b.d - a.d);

    // Ground shadows first, so no shadow is ever stamped over a neighbouring building's wall or roof
    ctx.fillStyle = 'rgba(20, 19, 15, 0.22)';
    for (const b of visibleBuildings) {
        const s = worldToScreen(b.tx * TILE, b.ty * TILE, shakeX, shakeY);
        ctx.fillRect(s.x + 8, s.y + 10, TILE * camera.zoom, TILE * camera.zoom);
    }

    for (const b of props) {
        if (b.f) {
            ctx.imageSmoothingEnabled = false;
            drawCanopy(ctx, b.f, vpSx, vpSy, hMul, shakeX, shakeY, nowSec);
            ctx.imageSmoothingEnabled = true;
            continue;
        }
        const wx0 = b.tx * TILE;
        const wy0 = b.ty * TILE;
        const wx1 = wx0 + TILE;
        const wy1 = wy0 + TILE;

        const s00 = worldToScreen(wx0, wy0, shakeX, shakeY);
        const s10 = worldToScreen(wx1, wy0, shakeX, shakeY);
        const s11 = worldToScreen(wx1, wy1, shakeX, shakeY);
        const s01 = worldToScreen(wx0, wy1, shakeX, shakeY);

        const h = b.meta.h * hMul;
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
        ctx.font = '700 24px "Barlow Condensed", sans-serif';
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
    ctx.fillStyle = winColor;
    ctx.globalAlpha = winAlpha;
    for (let row = 0.25; row <= 0.78; row += 0.26) {
        for (let col = 0.18; col <= 0.82; col += 0.22) {
            const wxA = (b1.x * (1 - col) + b2.x * col) * (1 - row) + (t1.x * (1 - col) + t2.x * col) * row;
            const wyA = (b1.y * (1 - col) + b2.y * col) * (1 - row) + (t1.y * (1 - col) + t2.y * col) * row;
            ctx.fillRect(wxA - 2.5, wyA - 2, 5, 4);
        }
    }
    ctx.globalAlpha = 1;
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
    const R = 2,
        w = c.spec.w,
        l = c.spec.l,
        cv = document.createElement('canvas');
    cv.width = Math.ceil(l * R);
    cv.height = Math.ceil(w * R);
    const g = cv.getContext('2d');
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
    return (c._grime = cv);
}

export function drawVehicle(c, nowSec) {
    const w = c.spec.w;
    const l = c.spec.l;

    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);

    // Drop shadow
    ctx.fillStyle = 'rgba(20, 19, 15, 0.32)';
    ctx.beginPath();
    ctx.roundRect(-l * 0.5 + 4, -w * 0.5 + 5, l, w, 6);
    ctx.fill();

    // Headlight beams when occupied
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
            ctx.fillStyle = c.sirenOn ? (flash ? '#d23a2a' : '#3b82f6') : '#64748b';
            ctx.fillRect(-4, -w * 0.32, 7, w * 0.3);
            ctx.fillStyle = c.sirenOn ? (flash ? '#3b82f6' : '#d23a2a') : '#64748b';
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

    ctx.restore();
}

// Orbiting Navigation Arrows around Player!
export function drawNavigationArrows(shakeX, shakeY) {
    const pScreen = worldToScreen(player.x, player.y, shakeX, shakeY);

    // 1. Yellow Arrow -> Active Mission Target OR Nearest Ringing Payphone
    let targetX = null;
    let targetY = null;
    let arrowColor;

    if (mission.active) {
        targetX = mission.targetX;
        targetY = mission.targetY;
        arrowColor = ROUTE;
    } else {
        // Point to nearest payphone
        let bestD = Infinity;
        for (const ph of payphones) {
            const d = Math.hypot(ph.x - player.x, ph.y - player.y);
            if (d < bestD) {
                bestD = d;
                targetX = ph.x;
                targetY = ph.y;
            }
        }
        arrowColor = HAZARD;
    }

    if (targetX !== null && Math.hypot(targetX - player.x, targetY - player.y) > 95) {
        drawSingleArrow(pScreen.x, pScreen.y, Math.atan2(targetY - player.y, targetX - player.x), 68, arrowColor);
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

export function drawSingleArrow(cx, cy, angle, orbitRadius, color) {
    ctx.save();
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
