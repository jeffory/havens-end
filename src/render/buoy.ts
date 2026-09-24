import { BoxGeometry, Group, Mesh, MeshLambertMaterial } from 'three';

/**
 * Placeholder for whatever the camera follows (the ship in Phase 2). It bobs on the
 * CPU copy of the wave function, which shows the CPU and GPU waves agree.
 */
export function createBuoy(): Group {
  const buoy = new Group();
  const red = new MeshLambertMaterial({ color: 0xc8372d });
  const white = new MeshLambertMaterial({ color: 0xf3efe6 });
  const parts: Array<[w: number, h: number, d: number, y: number, material: MeshLambertMaterial]> = [
    [1.6, 0.8, 1.6, 0.0, red],
    [1.0, 0.6, 1.0, 0.7, white],
    [0.7, 0.6, 0.7, 1.3, red],
    [0.16, 1.4, 0.16, 2.3, white],
  ];
  for (const [w, h, d, y, material] of parts) {
    const mesh = new Mesh(new BoxGeometry(w, h, d), material);
    mesh.position.y = y;
    mesh.castShadow = true;
    buoy.add(mesh);
  }
  buoy.name = 'focus-buoy';
  return buoy;
}
