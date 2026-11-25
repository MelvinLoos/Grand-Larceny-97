#!/usr/bin/env python3
"""Build src/assets/sprites/npc_walk.png (128x32, 4 frames facing +X) from art/npc-walk.png.

Source: 2x2 cells of 1024px on a ~32px pixel grid. Colour-keyed: blue=clothes, green=hair,
white=skin, transparent=bg. Output keeps exactly those keys (+ ink outline) so the game can
recolour them at runtime. Grid phase / shift per frame matches the one used for player_walk.png.
"""
import numpy as np
from PIL import Image

SRC, OUT = 'art/npc-walk.png', 'src/assets/sprites/npc_walk.png'
# (grid phase, dy, dx) per frame, derived by matching art/player-walk.png -> player_walk.png
PARAMS = [(14, 1, -3), (9, 0, -3), (30, 0, -1), (29, 0, -1)]
CELLS = [(0, 0), (0, 1), (1, 0), (1, 1)]
KEYS = np.array([[0, 0, 255], [0, 255, 0], [255, 255, 255]])  # clothes, hair, skin
INK = (20, 19, 15, 255)
CLOTH, HAIR, SKIN = 1, 2, 3  # label ids (0 = empty)

img = np.array(Image.open(SRC).convert('RGBA')).astype(int)
sheet = np.zeros((32, 128, 4), np.uint8)
for f, ((r, c), (ph, dy, dx)) in enumerate(zip(CELLS, PARAMS)):
    cell = img[r * 1024:(r + 1) * 1024, c * 1024:(c + 1) * 1024]
    lab = np.zeros((32, 32), int)
    for y in range(32):
        for x in range(32):
            blk = cell[y * 32 + ph - 3:y * 32 + ph + 4, x * 32 + ph - 3:x * 32 + ph + 4]
            if blk.shape[0] < 7 or blk.shape[1] < 7:
                continue
            blk = blk.reshape(-1, 4)
            if (blk[:, 3] > 128).mean() < 0.5:
                continue
            rgb = np.median(blk[blk[:, 3] > 128][:, :3], axis=0)
            lab[y, x] = 1 + int(np.argmin(((KEYS - rgb) ** 2).sum(1)))
    lab = np.roll(np.roll(np.rot90(lab, 1), dy, 0), dx, 1)
    pad = np.pad(lab, 1)
    nb = np.stack([pad[:-2, 1:-1], pad[2:, 1:-1], pad[1:-1, :-2], pad[1:-1, 2:]])
    edge = (lab > 0) & (nb == 0).any(0)
    hair_edge = (lab == HAIR) & (nb == CLOTH).any(0)
    out = np.zeros((32, 32, 4), np.uint8)
    for i, k in enumerate(KEYS):
        out[lab == i + 1] = (*k, 255)
    out[edge | hair_edge] = INK
    sheet[:, f * 32:(f + 1) * 32] = out
Image.fromarray(sheet).save(OUT, optimize=True)
cols = {tuple(p) for p in sheet.reshape(-1, 4)}
print(OUT, sheet.shape, sorted(cols))
