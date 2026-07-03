import { Color } from "../Color.js";
import { Point } from "../Point.js";
import { Vector } from "../Vector.js";
import { Rectangle } from "../Rectangle.js";
import { SceneObject } from "../types.js";
import { Material } from "../Material.js";
import { Mesh } from "../Mesh.js";
import { Triangle } from "../Triangle.js";
import { Cylinder } from "../Cylinder.js";
import { Sphere } from "../Sphere.js";
import { getRotationXMatrix } from "../matrix.js";
import { parseMesh } from "../meshUtils.js";
import { icosahedron } from "../meshes/icosahedron.js";

export const cameraStart = new Point(0, 2.2, -1.5);
export const rotateCamera = (dir: Vector) =>
  new Vector(dir.x, dir.y, dir.z)
    .multiplyWith3x3Matrix(getRotationXMatrix(10));

export const sigma_t = 0.03;
export const sigma_s = 0.025;
export const phaseG  = 0.50;
export const skyFn = (_dir: Vector) => new Color(0, 0, 0);

// ─── Wood grain ───────────────────────────────────────────────────────────────
function woodGrain(point: Point): Color {
  const grain = point.x * 2.0
    + Math.sin(point.z * 6.0) * 0.30
    + Math.sin(point.z * 14.0 + point.x * 4.0) * 0.10
    + Math.sin(point.x * 11.0 - point.z * 3.8) * 0.07;
  const t = Math.pow((Math.sin(grain * 9.0) + 1) * 0.5, 2);
  const light = new Color(0.68, 0.48, 0.26);
  const dark  = new Color(0.35, 0.22, 0.09);
  return new Color(light.r*(1-t)+dark.r*t, light.g*(1-t)+dark.g*t, light.b*(1-t)+dark.b*t);
}

// ─── Materials ────────────────────────────────────────────────────────────────
const benchTop    = new Material({ albedo: new Color(0.5, 0.35, 0.15), texture: (p) => woodGrain(p), roughness: 0.12, reflectivity: 0.18 });
const benchSide   = new Material({ albedo: new Color(0.28, 0.18, 0.07) });
const legMat      = new Material({ albedo: new Color(0.22, 0.14, 0.06) });
const wallMat     = new Material({ albedo: new Color(0.22, 0.21, 0.20) });
const floorMat    = new Material({ albedo: new Color(0.12, 0.11, 0.10) });
const glassMat    = new Material({ albedo: new Color(0, 0, 0), refractionIndex: 1.5 });
const capMat      = new Material({ albedo: new Color(0.95, 0.95, 0.95) });
const flaskMat    = new Material({ albedo: new Color(0.58, 0.80, 0.65), roughness: 0.80, subsurface: 1.0, subsurfaceSigma: 3.5 });
const backFlaskMat= new Material({ albedo: new Color(0.72, 0.48, 0.28), roughness: 0.75, subsurface: 1.0, subsurfaceSigma: 4.0 });
const paperMat    = new Material({ albedo: new Color(0.93, 0.91, 0.86) });
const clearLiquid = new Material({ albedo: new Color(0, 0, 0), refractionIndex: 1.33 });
const candleWax   = new Material({ albedo: new Color(0.94, 0.91, 0.84), subsurface: 1.0, subsurfaceSigma: 5 });
const candleFlame = new Material({ albedo: new Color(1.0, 0.6, 0.1), emissive: new Color(6, 3, 0.5) });
const frostedWhite= new Material({ albedo: new Color(0.88, 0.88, 0.86), roughness: 0.35, subsurface: 0.20 });
const frostedGreen= new Material({ albedo: new Color(0.65, 0.88, 0.72), roughness: 0.40, subsurface: 0.15 });
const alcoveMat   = new Material({ albedo: new Color(0.55, 0.45, 0.32) });
const shelfMat    = new Material({ albedo: new Color(0.50, 0.38, 0.18) });
const slatMat     = new Material({ albedo: new Color(0.10, 0.07, 0.04) });
const rackMat     = new Material({ albedo: new Color(0.62, 0.44, 0.22), roughness: 0.50 });

const liquids = {
  red:   new Material({ albedo: new Color(0.80, 0.04, 0.04) }),
  blue:  new Material({ albedo: new Color(0.04, 0.08, 0.90) }),
  amber: new Material({ albedo: new Color(0.90, 0.55, 0.04) }),
  teal:  new Material({ albedo: new Color(0.04, 0.70, 0.60) }),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function tubeRack(cx: number, cz: number, n: number, spacing: number, angleDeg = 0, yBase = 0, scale = 1): SceneObject[] {
  const θ = angleDeg * Math.PI / 180;
  const cosT = Math.cos(θ), sinT = Math.sin(θ);
  const p = (lx: number, ly: number, lz: number) =>
    new Vector(cx + lx * cosT - lz * sinT, yBase + ly, cz + lx * sinT + lz * cosT);

  const hw = (n - 1) * spacing / 2 + 0.14 * scale;
  const d = 0.20 * scale;
  const m = rackMat;
  const tris: Triangle[] = [];

  const bar = (ly0: number, ly1: number) => {
    tris.push(new Triangle({ v1: p(-hw, ly1, -d/2), v2: p( hw, ly1,  d/2), v3: p(-hw, ly1,  d/2), material: m }));
    tris.push(new Triangle({ v1: p(-hw, ly1, -d/2), v2: p( hw, ly1, -d/2), v3: p( hw, ly1,  d/2), material: m }));
    tris.push(new Triangle({ v1: p(-hw, ly0, -d/2), v2: p( hw, ly1, -d/2), v3: p(-hw, ly1, -d/2), material: m }));
    tris.push(new Triangle({ v1: p(-hw, ly0, -d/2), v2: p( hw, ly0, -d/2), v3: p( hw, ly1, -d/2), material: m }));
  };

  bar(-0.05*scale, 0.10*scale);
  bar(0.50*scale,  0.57*scale);

  const lp = p(-hw + 0.07*scale, -0.05*scale, 0);
  const rp = p( hw - 0.07*scale, -0.05*scale, 0);
  return [
    new Mesh({ name: "rackBars", material: m, meshObjects: tris }),
    new Cylinder({ center: new Point(lp.x, lp.y, lp.z), radius: 0.07*scale, height: 0.62*scale, material: m }),
    new Cylinder({ center: new Point(rp.x, rp.y, rp.z), radius: 0.07*scale, height: 0.62*scale, material: m }),
  ];
}

function alcoveRack(cx: number, cy: number, cz: number, n: number, spacing: number, angleDeg = 0): SceneObject[] {
  const θ = angleDeg * Math.PI / 180;
  const cosT = Math.cos(θ), sinT = Math.sin(θ);
  const p = (lx: number, ly: number, lz: number) =>
    new Vector(cx + lx * cosT - lz * sinT, cy + ly, cz + lx * sinT + lz * cosT);

  const hw = (n - 1) * spacing / 2 + 0.08;
  const d = 0.13;
  const m = rackMat;
  const tris: Triangle[] = [];

  const bar = (ly0: number, ly1: number) => {
    tris.push(new Triangle({ v1: p(-hw, ly1, -d/2), v2: p( hw, ly1,  d/2), v3: p(-hw, ly1,  d/2), material: m }));
    tris.push(new Triangle({ v1: p(-hw, ly1, -d/2), v2: p( hw, ly1, -d/2), v3: p( hw, ly1,  d/2), material: m }));
    tris.push(new Triangle({ v1: p(-hw, ly0, -d/2), v2: p( hw, ly1, -d/2), v3: p(-hw, ly1, -d/2), material: m }));
    tris.push(new Triangle({ v1: p(-hw, ly0, -d/2), v2: p( hw, ly0, -d/2), v3: p( hw, ly1, -d/2), material: m }));
  };
  bar(0, 0.07);
  bar(0.42, 0.48);

  const lp = p(-hw + 0.045, 0, 0);
  const rp = p( hw - 0.045, 0, 0);
  return [
    new Mesh({ name: "alcoveRackBars", material: m, meshObjects: tris }),
    new Cylinder({ center: new Point(lp.x, lp.y, lp.z), radius: 0.035, height: 0.50, material: m }),
    new Cylinder({ center: new Point(rp.x, rp.y, rp.z), radius: 0.035, height: 0.50, material: m }),
  ];
}

function alcoveRackWithTubes(cx: number, cy: number, cz: number, n: number, spacing: number, angleDeg: number, colors: Material[]): SceneObject[] {
  const θ = angleDeg * Math.PI / 180;
  const cosT = Math.cos(θ), sinT = Math.sin(θ);
  const objs = alcoveRack(cx, cy, cz, n, spacing, angleDeg);
  for (let i = 0; i < n; i++) {
    const lx = (i - (n - 1) / 2) * spacing;
    const tx = cx + lx * cosT;
    const tz = cz + lx * sinT;
    for (const o of alcoveTube(tx, cy, tz, colors[i % colors.length])) objs.push(o);
  }
  return objs;
}

function testTube(x: number, z: number, liquid: Material, yBase = 0, scale = 1): SceneObject[] {
  return [
    new Cylinder({ center: new Point(x, yBase, z), radius: 0.09*scale,  height: 1.00*scale, material: glassMat }),
    new Cylinder({ center: new Point(x, yBase, z), radius: 0.062*scale, height: 0.65*scale, material: liquid  }),
  ];
}

function alcoveTube(x: number, y: number, z: number, liquid: Material): SceneObject[] {
  return [
    new Cylinder({ center: new Point(x, y,      z), radius: 0.055, height: 0.60, material: glassMat }),
    new Cylinder({ center: new Point(x, y,      z), radius: 0.038, height: 0.38, material: liquid  }),
    new Cylinder({ center: new Point(x, y+0.53, z), radius: 0.060, height: 0.08, material: capMat  }),
  ];
}

function candle(x: number, y: number, z: number, scale = 1): SceneObject[] {
  const hw   = 0.018 * scale;          // half-width of pyramid base
  const by   = y + 0.28 * scale;       // base Y (top of wax)
  const ay   = by + 0.13 * scale;      // apex Y (tall flame)
  const v0 = new Vector(x - hw, by, z - hw);
  const v1 = new Vector(x + hw, by, z - hw);
  const v2 = new Vector(x + hw, by, z + hw);
  const v3 = new Vector(x - hw, by, z + hw);
  const ap = new Vector(x,      ay, z);
  return [
    new Cylinder({ center: new Point(x, y, z), radius: 0.045*scale, height: 0.28*scale, material: candleWax }),
    new Mesh({
      name: "flame", material: candleFlame,
      meshObjects: [
        new Triangle({ v1: v0, v2: v1, v3: ap, material: candleFlame }),
        new Triangle({ v1: v1, v2: v2, v3: ap, material: candleFlame }),
        new Triangle({ v1: v2, v2: v3, v3: ap, material: candleFlame }),
        new Triangle({ v1: v3, v2: v0, v3: ap, material: candleFlame }),
      ],
    }),
  ];
}

function makeErlenmeyer(
  cx: number, cz: number, scale: number,
  flaskM: Material, liquidM: Material,
  yBase = 0
): SceneObject[] {
  const SEGS = 18;
  const profile: [number, number][] = [
    [0.00, 0.000], [0.30, 0.000], [0.32, 0.060], [0.32, 0.340],
    [0.22, 0.480], [0.07, 0.600], [0.07, 0.880],
  ];
  const tris: Triangle[] = [];
  const PI2 = Math.PI * 2;
  for (let pi = 0; pi < profile.length - 1; pi++) {
    const [r0, y0] = profile[pi];
    const [r1, y1] = profile[pi + 1];
    for (let s = 0; s < SEGS; s++) {
      const a0 = (s / SEGS) * PI2, a1 = ((s + 1) / SEGS) * PI2;
      const p00 = new Vector(cx + scale*r0*Math.cos(a0), scale*y0+yBase, cz + scale*r0*Math.sin(a0));
      const p01 = new Vector(cx + scale*r0*Math.cos(a1), scale*y0+yBase, cz + scale*r0*Math.sin(a1));
      const p10 = new Vector(cx + scale*r1*Math.cos(a0), scale*y1+yBase, cz + scale*r1*Math.sin(a0));
      const p11 = new Vector(cx + scale*r1*Math.cos(a1), scale*y1+yBase, cz + scale*r1*Math.sin(a1));
      if (r0 < 0.001) {
        tris.push(new Triangle({ v1: p00, v2: p10, v3: p11, material: flaskM }));
      } else {
        tris.push(new Triangle({ v1: p00, v2: p10, v3: p11, material: flaskM }));
        tris.push(new Triangle({ v1: p00, v2: p11, v3: p01, material: flaskM }));
      }
    }
  }
  const baseR = profile[1][0] * scale;
  for (let s = 0; s < SEGS; s++) {
    const a0 = (s / SEGS) * PI2, a1 = ((s + 1) / SEGS) * PI2;
    tris.push(new Triangle({
      v1: new Vector(cx, yBase, cz),
      v2: new Vector(cx + baseR*Math.cos(a1), yBase, cz + baseR*Math.sin(a1)),
      v3: new Vector(cx + baseR*Math.cos(a0), yBase, cz + baseR*Math.sin(a0)),
      material: flaskM,
    }));
  }
  return [
    new Mesh({ name: "erlenmeyer", material: flaskM, meshObjects: tris }),
    new Cylinder({ center: new Point(cx, 0.005+yBase, cz), radius: 0.26*scale, height: 0.22*scale, material: liquidM }),
  ];
}

export const sceneObjects: SceneObject[] = [];

// ─── Table — lab bench, top at y=1.0 ─────────────────────────────────────────
// Footprint: x −1.5…2.5, z 1.3…3.3; pulled closer to camera
sceneObjects.push(new Rectangle({
  corner: new Point(-1.5, 1.0, 1.3),
  v1: new Vector(1, 0, 0), v2: new Vector(0, 0, 1),
  width: 4.0, height: 2.0,
  normal: new Vector(0, 1, 0), orientation: "xzAxis",
  material: benchTop,
}));
sceneObjects.push(new Rectangle({
  corner: new Point(-1.5, 0.88, 1.3),
  v1: new Vector(1, 0, 0), v2: new Vector(0, 1, 0),
  width: 4.0, height: 0.12,
  normal: new Vector(0, 0, -1), orientation: "xyAxis",
  material: benchSide,
}));
for (const [lx, lz] of [[-1.38, 3.18], [-1.38, 1.42], [2.38, 3.18], [2.38, 1.42]] as [number,number][]) {
  const N = 3, h = 1.48 / N;
  for (let i = 0; i < N; i++) {
    const r = 0.06 + 0.04 * (i + 0.5) / N;
    sceneObjects.push(new Cylinder({ center: new Point(lx, -0.6 + i*h, lz), radius: r, height: h, material: legMat }));
  }
}

// ─── Room ─────────────────────────────────────────────────────────────────────
const CEILING_Y = 4.5;
const baseboardMat = new Material({ albedo: new Color(0.88, 0.87, 0.84) });

sceneObjects.push(new Rectangle({
  corner: new Point(-4, -0.6, -3),
  v1: new Vector(1, 0, 0), v2: new Vector(0, 0, 1),
  width: 8, height: 13,
  normal: new Vector(0, 1, 0), orientation: "xzAxis",
  material: floorMat,
}));
// Left wall (x = -4)
sceneObjects.push(new Rectangle({
  corner: new Point(-4, -0.6, -3),
  v1: new Vector(0, 1, 0), v2: new Vector(0, 0, 1),
  width: 13, height: CEILING_Y + 0.6,
  normal: new Vector(1, 0, 0), orientation: "yzAxis",
  material: wallMat,
}));
// Room ceiling — split into 3 pieces with a skylight hole at x=[2,4], z=[1,3] (upper right)
sceneObjects.push(new Rectangle({ corner: new Point(-4, CEILING_Y, -3), v1: new Vector(1, 0, 0), v2: new Vector(0, 0, 1), width: 6,  height: 13, normal: new Vector(0, -1, 0), orientation: "xzAxis", material: wallMat }));
sceneObjects.push(new Rectangle({ corner: new Point(2,  CEILING_Y, -3), v1: new Vector(1, 0, 0), v2: new Vector(0, 0, 1), width: 2,  height: 4,  normal: new Vector(0, -1, 0), orientation: "xzAxis", material: wallMat }));
sceneObjects.push(new Rectangle({ corner: new Point(2,  CEILING_Y,  3), v1: new Vector(1, 0, 0), v2: new Vector(0, 0, 1), width: 2,  height: 7,  normal: new Vector(0, -1, 0), orientation: "xzAxis", material: wallMat }));
// Baseboards — left wall, back face, right wall
sceneObjects.push(new Rectangle({   // left wall baseboard
  corner: new Point(-4, -0.6, -3),
  v1: new Vector(0, 1, 0), v2: new Vector(0, 0, 1),
  width: 13, height: 0.12,
  normal: new Vector(1, 0, 0), orientation: "yzAxis",
  material: baseboardMat,
}));
sceneObjects.push(new Rectangle({   // back wall baseboard
  corner: new Point(-4, -0.6, 5.0),
  v1: new Vector(1, 0, 0), v2: new Vector(0, 1, 0),
  width: 8, height: 0.12,
  normal: new Vector(0, 0, -1), orientation: "xyAxis",
  material: baseboardMat,
}));
sceneObjects.push(new Rectangle({   // right wall baseboard
  corner: new Point(4, -0.6, -3),
  v1: new Vector(0, 1, 0), v2: new Vector(0, 0, 1),
  width: 13, height: 0.12,
  normal: new Vector(-1, 0, 0), orientation: "yzAxis",
  material: baseboardMat,
}));

// ─── Three alcoves across the back wall ───────────────────────────────────────
const AY0 = 0.5,  AY1 = 4.0;
const AZ0 = 5.0,  AZ1 = 6.0;
const AHW = 0.9;                        // each alcove half-width
const ALCOVE_CX = [-2.5, 0.0, 2.5];    // alcove x-centres
const arch_r  = AHW;                    // 0.9
const arch_cy = AY1 - arch_r;          // 3.1 (spring line)
const ARCH_N  = 20;

// ── Back wall face at z=AZ0 ──────────────────────────────────────────────────
// Bottom strip (below all openings)
sceneObjects.push(new Rectangle({
  corner: new Point(-4, -0.6, AZ0),
  v1: new Vector(1, 0, 0), v2: new Vector(0, 1, 0),
  width: 8, height: AY0 + 0.6,
  normal: new Vector(0, 0, -1), orientation: "xyAxis",
  material: wallMat,
}));
// Top strip (above all openings, up to ceiling)
sceneObjects.push(new Rectangle({
  corner: new Point(-4, AY1, AZ0),
  v1: new Vector(1, 0, 0), v2: new Vector(0, 1, 0),
  width: 8, height: CEILING_Y - AY1,
  normal: new Vector(0, 0, -1), orientation: "xyAxis",
  material: wallMat,
}));
// Vertical panels: left flank, between alcoves, right flank
{
  const xBreaks = [
    -4,
    ALCOVE_CX[0] - AHW, ALCOVE_CX[0] + AHW,
    ALCOVE_CX[1] - AHW, ALCOVE_CX[1] + AHW,
    ALCOVE_CX[2] - AHW, ALCOVE_CX[2] + AHW,
    4,
  ];
  for (let i = 0; i < xBreaks.length - 1; i += 2) {
    const x0 = xBreaks[i], x1 = xBreaks[i + 1];
    sceneObjects.push(new Rectangle({
      corner: new Point(x0, AY0, AZ0),
      v1: new Vector(1, 0, 0), v2: new Vector(0, 1, 0),
      width: x1 - x0, height: AY1 - AY0,
      normal: new Vector(0, 0, -1), orientation: "xyAxis",
      material: wallMat,
    }));
  }
}
// Arch spandrels — one per alcove
for (const cx of ALCOVE_CX) {
  const archPt = (a: number) => new Vector(cx + arch_r * Math.cos(a), arch_cy + arch_r * Math.sin(a), AZ0);
  const archTris: Triangle[] = [];
  for (let i = 0; i < ARCH_N; i++) {
    const a0 = Math.PI * i / ARCH_N;
    const a1 = Math.PI * (i + 1) / ARCH_N;
    const P0 = archPt(a0), P1 = archPt(a1);
    if (i < ARCH_N / 2) {
      archTris.push(new Triangle({ v1: P1, v2: P0, v3: new Vector(cx + AHW, AY1, AZ0), material: wallMat }));
    } else {
      archTris.push(new Triangle({ v1: new Vector(cx - AHW, AY1, AZ0), v2: P1, v3: P0, material: wallMat }));
    }
  }
  sceneObjects.push(new Mesh({ name: `archSpandrel_${cx}`, material: wallMat, meshObjects: archTris }));
}

// ── Alcove interiors — floor, walls, back, ceiling ───────────────────────────
for (const cx of ALCOVE_CX) {
  const ax0 = cx - AHW, ax1 = cx + AHW;
  sceneObjects.push(new Rectangle({  // floor
    corner: new Point(ax0, AY0, AZ0),
    v1: new Vector(1, 0, 0), v2: new Vector(0, 0, 1),
    width: AHW * 2, height: AZ1 - AZ0,
    normal: new Vector(0, 1, 0), orientation: "xzAxis",
    material: alcoveMat,
  }));
  sceneObjects.push(new Rectangle({  // left wall
    corner: new Point(ax0, AY0, AZ0),
    v1: new Vector(0, 1, 0), v2: new Vector(0, 0, 1),
    width: AZ1 - AZ0, height: AY1 - AY0,
    normal: new Vector(1, 0, 0), orientation: "yzAxis",
    material: alcoveMat,
  }));
  sceneObjects.push(new Rectangle({  // right wall
    corner: new Point(ax1, AY0, AZ0),
    v1: new Vector(0, 1, 0), v2: new Vector(0, 0, 1),
    width: AZ1 - AZ0, height: AY1 - AY0,
    normal: new Vector(-1, 0, 0), orientation: "yzAxis",
    material: alcoveMat,
  }));
  sceneObjects.push(new Rectangle({  // back wall
    corner: new Point(ax0, AY0, AZ1),
    v1: new Vector(1, 0, 0), v2: new Vector(0, 1, 0),
    width: AHW * 2, height: AY1 - AY0,
    normal: new Vector(0, 0, -1), orientation: "xyAxis",
    material: alcoveMat,
  }));
  sceneObjects.push(new Rectangle({  // ceiling
    corner: new Point(ax0, AY1, AZ0),
    v1: new Vector(1, 0, 0), v2: new Vector(0, 0, 1),
    width: AHW * 2, height: AZ1 - AZ0,
    normal: new Vector(0, -1, 0), orientation: "xzAxis",
    material: alcoveMat,
  }));
}

// ── Alcove shelves — two per alcove ──────────────────────────────────────────
const SY1 = 1.5, SY2 = 2.6;

for (const cx of ALCOVE_CX) {
  const ax0 = cx - AHW;
  for (const sy of [SY1, SY2]) {
    sceneObjects.push(new Rectangle({
      corner: new Point(ax0 + 0.05, sy, AZ0 + 0.05),
      v1: new Vector(1, 0, 0), v2: new Vector(0, 0, 1),
      width: AHW * 2 - 0.10, height: AZ1 - AZ0 - 0.10,
      normal: new Vector(0, 1, 0), orientation: "xzAxis",
      material: shelfMat,
    }));
  }
}

// ── Alcove shelf items ────────────────────────────────────────────────────────
const facetedCrystal = new Material({ albedo: new Color(0, 0, 0), refractionIndex: 1.9 });
const facetedAmber   = new Material({ albedo: new Color(0.85, 0.52, 0.08), roughness: 0.12 });
const facetedTeal    = new Material({ albedo: new Color(0.08, 0.62, 0.52), roughness: 0.12 });
const facetedRose    = new Material({ albedo: new Color(0.80, 0.18, 0.22), roughness: 0.14 });

const shelfSphere = (name: string, mat: Material, x: number, z: number, sy: number, r = 0.13) =>
  sceneObjects.push(parseMesh({ mesh: icosahedron, material: mat, name, scale: r, translate: { x, y: sy + r, z } }));

// Left alcove (cx = −2.5)
shelfSphere("ls1", facetedCrystal, -2.80, 5.30, SY1);
shelfSphere("ls2", facetedAmber,   -2.22, 5.72, SY1, 0.11);
for (const o of candle(-2.50, SY1, 5.85)) sceneObjects.push(o);
shelfSphere("lu1", facetedTeal,    -2.72, 5.40, SY2, 0.12);
shelfSphere("lu2", facetedRose,    -2.25, 5.68, SY2, 0.11);

// Center alcove (cx = 0.0) — Stanford dragon on lower shelf (loaded in init())
shelfSphere("cu1", facetedAmber,   -0.30, 5.55, SY2, 0.11);
shelfSphere("cu2", facetedCrystal,  0.32, 5.42, SY2, 0.10);

// Right alcove (cx = 2.5)
for (const o of makeErlenmeyer(2.18, 5.42, 0.40, backFlaskMat, liquids.red, SY1)) sceneObjects.push(o);
shelfSphere("rs1", facetedTeal,     2.80, 5.72, SY1, 0.11);
for (const o of candle(2.50, SY1, 5.85)) sceneObjects.push(o);
shelfSphere("ru1", facetedRose,     2.28, 5.40, SY2, 0.12);
shelfSphere("ru2", facetedCrystal,  2.78, 5.68, SY2, 0.10);

// ─── Right wall — plain, no window ───────────────────────────────────────────
sceneObjects.push(new Rectangle({
  corner: new Point(4, -0.6, -3),
  v1: new Vector(0, 1, 0), v2: new Vector(0, 0, 1),
  width: 13, height: CEILING_Y + 0.6,
  normal: new Vector(-1, 0, 0), orientation: "yzAxis",
  material: wallMat,
}));

// ─── Skylight — ceiling panel above the hole, aimed down into the room ────────
// Panel sits just above the ceiling gap (x=[2,4], z=[1,3]) at y=CEILING_Y+0.1.
// Warm sunlight colour; high emissive value drives the volumetric god rays.
const sunMat = new Material({ albedo: new Color(1, 0.95, 0.80), emissive: new Color(90, 80, 55) });
const LY = CEILING_Y + 0.1;
sceneObjects.push(new Mesh({
  name: "skylightPanel",
  material: sunMat,
  meshObjects: [
    new Triangle({ v1: new Vector(2, LY, 1), v2: new Vector(4, LY, 3), v3: new Vector(4, LY, 1), material: sunMat }),
    new Triangle({ v1: new Vector(2, LY, 1), v2: new Vector(2, LY, 3), v3: new Vector(4, LY, 3), material: sunMat }),
  ],
}));

// ─── Stools ───────────────────────────────────────────────────────────────────
sceneObjects.push(new Cylinder({ center: new Point(-0.8, 0.58, 0.65), radius: 0.28, height: 0.05, material: benchTop }));
for (const [sx, sz] of [[-0.98, 0.83], [-0.98, 0.47], [-0.62, 0.83], [-0.62, 0.47]] as [number,number][]) {
  const N = 3, h = 1.18 / N;
  for (let i = 0; i < N; i++) {
    const r = 0.03 + 0.02 * (i + 0.5) / N;
    sceneObjects.push(new Cylinder({ center: new Point(sx, -0.6 + i*h, sz), radius: r, height: h, material: legMat }));
  }
}
sceneObjects.push(new Cylinder({ center: new Point(1.2, 0.58, 0.80), radius: 0.28, height: 0.05, material: benchTop }));
for (const [sx, sz] of [[1.02, 0.98], [1.02, 0.62], [1.38, 0.98], [1.38, 0.62]] as [number,number][]) {
  const N = 3, h = 1.18 / N;
  for (let i = 0; i < N; i++) {
    const r = 0.03 + 0.02 * (i + 0.5) / N;
    sceneObjects.push(new Cylinder({ center: new Point(sx, -0.6 + i*h, sz), radius: r, height: h, material: legMat }));
  }
}

// ─── Table items ──────────────────────────────────────────────────────────────
const TABLE_Y = 1.0;

// Test tube rack — right of centre, angled slightly toward camera
const RACK_CX = 0.9, RACK_CZ = 1.8, RACK_N = 4, RACK_SP = 0.18, RACK_ANG = 18;
const rack_θ = RACK_ANG * Math.PI / 180;
for (const o of tubeRack(RACK_CX, RACK_CZ, RACK_N, RACK_SP, RACK_ANG, TABLE_Y, 0.60)) sceneObjects.push(o);
const rackLiquids = [liquids.red, liquids.teal, liquids.amber, liquids.blue];
for (let i = 0; i < RACK_N; i++) {
  const lx = (i - (RACK_N - 1) / 2) * RACK_SP;
  const tx = RACK_CX + lx * Math.cos(rack_θ);
  const tz = RACK_CZ + lx * Math.sin(rack_θ);
  for (const o of testTube(tx, tz, rackLiquids[i], TABLE_Y, 0.60)) sceneObjects.push(o);
}

// Erlenmeyers — left 1/3 (dominant) and back-right (shorter accent)
for (const o of makeErlenmeyer(-1.1, 2.8, 0.72, flaskMat,     clearLiquid, TABLE_Y)) sceneObjects.push(o);
for (const o of makeErlenmeyer( 1.9, 2.9, 0.75, backFlaskMat, clearLiquid, TABLE_Y)) sceneObjects.push(o);

// Faceted crystal ball — centre-left, catches window light from right
sceneObjects.push(parseMesh({
  mesh: icosahedron,
  material: new Material({ albedo: new Color(0, 0, 0), refractionIndex: 1.9 }),
  name: "crystalBall",
  scale: 0.22,
  translate: { x: -0.4, y: TABLE_Y + 0.22, z: 2.35 },
}));

// Frosted sphere — background-right accent
sceneObjects.push(new Sphere({
  center: new Point(1.6, TABLE_Y + 0.15, 3.0),
  radius: 0.15,
  material: frostedWhite,
}));

// Paper sheet — centre of table
sceneObjects.push(new Rectangle({
  corner: new Point(-0.15, TABLE_Y + 0.002, 1.90),
  v1: new Vector(1, 0, 0), v2: new Vector(0, 0, 1),
  width: 0.52, height: 0.72,
  normal: new Vector(0, 1, 0), orientation: "xzAxis",
  material: paperMat,
}));

// ─── Table candles ────────────────────────────────────────────────────────────
for (const [cx, cz] of [[-0.7, 2.3], [0.2, 3.35], [0.95, 2.4]] as [number, number][]) {
  for (const o of candle(cx, TABLE_Y, cz)) sceneObjects.push(o);
}

// Floating sphere — placed directly in the window beam to cast a god-ray shadow
sceneObjects.push(new Sphere({
  center: new Point(1.2, 3.0, 2.0),
  radius: 0.40,
  name: "floatingSphere",
  material: new Material({ albedo: new Color(0.08, 0.08, 0.10) }),
}));

// Pencil — yellow, lying diagonally on paper
{
  const py = TABLE_Y + 0.006;
  const pcx = 0.04, pcz = 2.25, pLen = 0.42, pW = 0.022;
  const ca = Math.cos(22 * Math.PI / 180), sa = Math.sin(22 * Math.PI / 180);
  const pencilMat = new Material({ albedo: new Color(0.95, 0.80, 0.08) });
  const A = new Vector(pcx + ca*pLen/2 - sa*pW/2, py, pcz + sa*pLen/2 + ca*pW/2);
  const B = new Vector(pcx + ca*pLen/2 + sa*pW/2, py, pcz + sa*pLen/2 - ca*pW/2);
  const C = new Vector(pcx - ca*pLen/2 + sa*pW/2, py, pcz - sa*pLen/2 - ca*pW/2);
  const D = new Vector(pcx - ca*pLen/2 - sa*pW/2, py, pcz - sa*pLen/2 + ca*pW/2);
  sceneObjects.push(new Mesh({
    name: "pencil", material: pencilMat,
    meshObjects: [
      new Triangle({ v1: B, v2: D, v3: C, material: pencilMat }),
      new Triangle({ v1: B, v2: A, v3: D, material: pencilMat }),
    ],
  }));
}

