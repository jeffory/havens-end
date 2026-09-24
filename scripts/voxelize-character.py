#!/usr/bin/env python3
"""
Turns a textured T-pose character model (e.g. from Tripo) into a game-ready voxel
character: a MagicaVoxel .vox with one object per body part, the same named-parts
convention the ships use:

    head, torso, arm_l, arm_r, leg_l, leg_r   (left/right are the character's own)

The game animates those parts about joints it works out from their bounds, so the
.vox can be restyled in MagicaVoxel as long as the parts keep their names.

Usage:
  .venv/bin/python scripts/voxelize-character.py art-source/characters/player.glb \\
      public/models/characters/player.vox [--height 32] [--colors 20] [--preview out.png]
"""
import argparse
import pathlib
import struct

import numpy as np
import trimesh
from PIL import Image
from scipy import ndimage
from scipy.cluster.vq import kmeans2

PARTS = ["head", "torso", "arm_l", "arm_r", "leg_l", "leg_r"]


def load(path: str) -> trimesh.Trimesh:
    loaded = trimesh.load(path)
    return loaded.to_geometry() if isinstance(loaded, trimesh.Scene) else loaded


def sample_colors(mesh: trimesh.Trimesh, count: int) -> tuple[np.ndarray, np.ndarray]:
    """Points spread over the surface, each with its texture colour."""
    points, faces = trimesh.sample.sample_surface_even(mesh, count, seed=1)
    visual = mesh.visual
    material = getattr(visual, "material", None)
    image = getattr(material, "baseColorTexture", None) or getattr(material, "image", None)
    if image is None or getattr(visual, "uv", None) is None:
        return points, np.full((len(points), 3), 180, dtype=np.uint8)
    triangles = mesh.triangles[faces]
    bary = trimesh.triangles.points_to_barycentric(triangles, points)
    uv = np.einsum("ij,ijk->ik", bary, visual.uv[mesh.faces[faces]])
    texture = np.asarray(image.convert("RGB"))
    h, w = texture.shape[:2]
    px = np.clip((uv[:, 0] % 1.0) * (w - 1), 0, w - 1).astype(int)
    py = np.clip((1 - (uv[:, 1] % 1.0)) * (h - 1), 0, h - 1).astype(int)
    return points, texture[py, px]


def canonical(points: np.ndarray, colors: np.ndarray) -> np.ndarray:
    """
    Rotates points into game axes: y up, facing +z, the character's right hand toward -x.
    The T-pose arm span picks the lateral axis. The face picks the front: skin-coloured
    points on the head sit on the side it faces. (Boot toes are the fallback, but a
    flared coat hem can fool them.)
    """
    p = points - points.mean(axis=0)
    extent = p.max(axis=0) - p.min(axis=0)
    lateral, depth = (0, 2) if extent[0] >= extent[2] else (2, 0)
    y = p[:, 1]
    head = y > y.max() - 0.25 * extent[1]
    r, g, b = (colors[:, i].astype(int) for i in range(3))
    skin = head & (r > 120) & (r > g + 8) & (g > b) & (r - b > 35)
    if skin.sum() > 40:
        front = 1.0 if p[skin, depth].mean() - p[head, depth].mean() >= 0 else -1.0
    else:
        feet = p[y < y.min() + 0.06 * extent[1]]
        torso = p[(y > y.min() + 0.45 * extent[1]) & (y < y.min() + 0.6 * extent[1])]
        front = 1.0 if feet[:, depth].mean() - torso[:, depth].mean() >= 0 else -1.0
    z = p[:, depth] * front
    # Right-handed: facing +z with y up, the character's left is +x.
    if lateral == 0:
        x = p[:, 0] * front
    else:
        x = -p[:, 2] * front if depth == 0 else p[:, 2]
    return np.stack([x, y, z], axis=1)


def voxelize(points: np.ndarray, colors: np.ndarray, height: int) -> tuple[np.ndarray, np.ndarray]:
    """Occupancy grid (x, y, z) and per-voxel RGB. Interiors are filled; they show where limbs turn."""
    pitch = (points[:, 1].max() - points[:, 1].min()) / (height - 0.5)
    lo = points.min(axis=0)
    cells = np.floor((points - lo) / pitch).astype(int)
    dims = cells.max(axis=0) + 1
    rgb_sum = np.zeros((*dims, 3))
    hits = np.zeros(dims)
    np.add.at(rgb_sum, tuple(cells.T), colors.astype(float))
    np.add.at(hits, tuple(cells.T), 1)
    shell = hits > 0
    solid = ndimage.binary_fill_holes(shell)
    rgb = np.zeros((*dims, 3))
    rgb[shell] = rgb_sum[shell] / hits[shell][:, None]
    # Interior voxels take the colour of the nearest surface voxel.
    _, nearest = ndimage.distance_transform_edt(~shell, return_indices=True)
    inner = solid & ~shell
    rgb[inner] = rgb[tuple(n[inner] for n in nearest)]
    return solid, rgb


def quantize(solid: np.ndarray, rgb: np.ndarray, count: int) -> tuple[np.ndarray, np.ndarray]:
    """Palette indices (1..count) per voxel and the palette, via k-means: clean, flat voxel colours."""
    colors = rgb[solid]
    np.random.seed(1)
    centroids, labels = kmeans2(colors, count, minit="++", seed=1)
    index = np.zeros(solid.shape, dtype=np.uint8)
    index[solid] = labels + 1
    return index, np.clip(centroids, 0, 255).astype(np.uint8)


def segment(solid: np.ndarray) -> dict[str, np.ndarray]:
    """Splits a T-pose figure into head, torso, arms and legs by where things are."""
    xs, ys, zs = solid.shape
    occupied_x = solid.any(axis=2)  # (x, y)
    widths = np.array([(np.ptp(np.nonzero(occupied_x[:, y])[0]) + 1) if occupied_x[:, y].any() else 0 for y in range(ys)])
    arm_rows = np.nonzero(widths >= 0.7 * widths.max())[0]
    arm_lo, arm_hi = arm_rows.min(), arm_rows.max()
    cx = xs // 2

    # Torso width: the run of occupied columns through the middle, just under the arms.
    row = occupied_x[:, max(0, arm_lo - 2)]
    t0 = t1 = cx
    while t0 > 0 and row[t0 - 1]:
        t0 -= 1
    while t1 < xs - 1 and row[t1 + 1]:
        t1 += 1

    # Crotch: the highest low row with daylight down the middle between the legs. Long
    # coats hide it, so never put the hips below ~42% of the height: the coat skirt then
    # splits and swings with the legs.
    hip = int(0.42 * ys)
    for y in range(int(0.6 * ys), -1, -1):
        middle = solid[max(0, cx - 1) : cx + 1, y, :]
        if not middle.any() and solid[:cx, y, :].any() and solid[cx:, y, :].any():
            hip = max(hip, y + 1)
            break

    x = np.arange(xs)[:, None, None]
    y = np.arange(ys)[None, :, None]
    labels = {}
    in_arm_band = (y >= arm_lo - 1) & (y <= arm_hi + 1)
    labels["arm_r"] = solid & in_arm_band & (x < t0)
    labels["arm_l"] = solid & in_arm_band & (x > t1)
    # Neck: above the shoulders, ignoring the arms, the lowest of the narrowest rows of
    # the body's central column. Works whether the arms sit low or up by the ears.
    arm_mid = (arm_lo + arm_hi) // 2
    def central_width(row: int) -> int:
        column = occupied_x[t0 : t1 + 1, row]
        if not column[cx - t0]:
            return 0
        a = b = cx - t0
        while a > 0 and column[a - 1]:
            a -= 1
        while b < len(column) - 1 and column[b + 1]:
            b += 1
        return b - a + 1
    rows = range(arm_mid, max(arm_mid + 1, ys - 4))
    widths_up = {row: central_width(row) for row in rows if central_width(row) > 0}
    narrowest = min(widths_up.values())
    neck = min(row for row, w in widths_up.items() if w <= narrowest + 1)
    labels["head"] = solid & (y > neck) & ~labels["arm_r"] & ~labels["arm_l"]
    legs = solid & (y < hip)
    labels["leg_r"] = legs & (x < cx)
    labels["leg_l"] = legs & (x >= cx)
    taken = np.zeros_like(solid)
    for mask in labels.values():
        taken |= mask
    labels["torso"] = solid & ~taken
    return labels


def write_vox(path: pathlib.Path, index: np.ndarray, labels: dict[str, np.ndarray], palette: np.ndarray) -> None:
    """MagicaVoxel .vox (v200): one named object per part, in MagicaVoxel axes (Z up, facing +Y)."""

    def chunk(tag: bytes, content: bytes) -> bytes:
        return tag + struct.pack("<ii", len(content), 0) + content

    def string(s: str) -> bytes:
        b = s.encode()
        return struct.pack("<i", len(b)) + b

    def dictionary(d: dict[str, str]) -> bytes:
        return struct.pack("<i", len(d)) + b"".join(string(k) + string(v) for k, v in d.items())

    models, scene = [], []
    names = [n for n in PARTS if labels[n].any()]
    children = [2 + 2 * i for i in range(len(names))]
    scene.append(chunk(b"nTRN", struct.pack("<i", 0) + dictionary({}) + struct.pack("<iiii", 1, -1, -1, 1) + dictionary({})))
    scene.append(chunk(b"nGRP", struct.pack("<i", 1) + dictionary({}) + struct.pack("<i", len(children)) + b"".join(struct.pack("<i", c) for c in children)))
    for i, name in enumerate(names):
        gx, gy, gz = np.nonzero(labels[name])
        # Game (x, y, z) -> MagicaVoxel (x, y, z) = (-x - 1, z, y); the inverse of the game's mvToGame().
        mx, my, mz = -gx - 1, gz, gy
        lo = np.array([mx.min(), my.min(), mz.min()])
        size = np.array([mx.max(), my.max(), mz.max()]) - lo + 1
        voxels = b"".join(struct.pack("<BBBB", a - lo[0], b - lo[1], c - lo[2], index[x, y, z]) for a, b, c, x, y, z in zip(mx, my, mz, gx, gy, gz))
        models.append(chunk(b"SIZE", struct.pack("<iii", *size)))
        models.append(chunk(b"XYZI", struct.pack("<i", len(gx)) + voxels))
        t = lo + size // 2  # MagicaVoxel places a model by the corner at floor(size / 2)
        node = children[i]
        scene.append(chunk(b"nTRN", struct.pack("<i", node) + dictionary({"_name": name}) + struct.pack("<iiii", node + 1, -1, 0, 1) + dictionary({"_t": " ".join(map(str, t))})))
        scene.append(chunk(b"nSHP", struct.pack("<i", node + 1) + dictionary({}) + struct.pack("<ii", 1, i) + dictionary({})))
    scene.append(chunk(b"LAYR", struct.pack("<i", 0) + dictionary({}) + struct.pack("<i", -1)))
    rgba = bytearray(256 * 4)
    for i, (r, g, b) in enumerate(palette):
        rgba[i * 4 : i * 4 + 4] = bytes((int(r), int(g), int(b), 255))  # file entry i = colour index i + 1
    body = b"".join(models + scene) + chunk(b"RGBA", bytes(rgba))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"VOX " + struct.pack("<i", 200) + b"MAIN" + struct.pack("<ii", 0, len(body)) + body)


def preview(path: pathlib.Path, index: np.ndarray, labels: dict[str, np.ndarray], palette: np.ndarray, scale: int = 10) -> None:
    """Front and side views, plus the same views coloured by part: for checking the segmentation."""
    tints = {"head": (230, 80, 80), "torso": (80, 160, 230), "arm_l": (240, 200, 60), "arm_r": (240, 140, 40), "leg_l": (90, 200, 110), "leg_r": (40, 140, 90)}
    part = np.zeros(index.shape, dtype=np.uint8)
    for i, name in enumerate(PARTS):
        part[labels[name]] = i + 1

    def view(values: np.ndarray, axis: int, colors) -> Image.Image:
        """Looks from +z (front, axis 2) or +x (side, axis 0) and draws the nearest voxel in each column."""
        grid = values if axis == 2 else values.transpose(2, 1, 0)  # (across, up, depth)
        occupied = grid > 0
        nearest = grid.shape[2] - 1 - np.argmax(occupied[:, :, ::-1], axis=2)
        img = np.full((grid.shape[0], grid.shape[1], 3), 245, dtype=np.uint8)
        for a, b in zip(*np.nonzero(occupied.any(axis=2))):
            img[a, b] = colors(grid[a, b, nearest[a, b]])
        img = np.flip(img.transpose(1, 0, 2), axis=0)  # rows top-down, y up
        return Image.fromarray(np.ascontiguousarray(img)).resize((img.shape[1] * scale, img.shape[0] * scale), Image.NEAREST)

    color = lambda v: palette[v - 1]
    tint = lambda v: tints[PARTS[v - 1]]
    views = [view(index, 2, color), view(index, 0, color), view(part, 2, tint), view(part, 0, tint)]
    width = sum(v.width for v in views) + 10 * (len(views) - 1)
    sheet = Image.new("RGB", (width, max(v.height for v in views)), (255, 255, 255))
    x = 0
    for v in views:
        sheet.paste(v, (x, 0))
        x += v.width + 10
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("model")
    parser.add_argument("out")
    parser.add_argument("--height", type=int, default=32, help="voxels from boot to hat")
    parser.add_argument("--colors", type=int, default=20)
    parser.add_argument("--preview")
    args = parser.parse_args()

    mesh = load(args.model)
    points, colors = sample_colors(mesh, 400_000)
    solid, rgb = voxelize(canonical(points, colors), colors, args.height)
    index, palette = quantize(solid, rgb, args.colors)
    labels = segment(solid)
    write_vox(pathlib.Path(args.out), index, labels, palette)
    counts = {n: int(labels[n].sum()) for n in PARTS}
    print(f"{args.out}: {solid.shape} grid, {int(solid.sum())} voxels, parts {counts}")
    if args.preview:
        preview(pathlib.Path(args.preview), index, labels, palette)


if __name__ == "__main__":
    main()
