import { Color } from "./Color.js";
import { Ray } from "./Ray.js";
import { Vector } from "./Vector.js";
import {
  Intersected,
  Intersection,
  Primitive,
  SceneObject,
  Shape
} from "./types.js";
import { distance, subtract, dotProduct } from "./utils.js";
import { epsilon } from "./const.js";
import { Point } from "./Point.js";
import { Mesh } from "./Mesh.js";
import { Sphere } from "./Sphere.js";
import { Triangle } from "./Triangle.js";
import { Rectangle } from "./Rectangle.js";
import { intersectBVH } from "./BVH.js";

// Scene state — populated dynamically in onmessage before rendering begins.
/* eslint-disable prefer-const */
let sceneObjects: SceneObject[] = [];
let cameraStart!: Point;
let rotateCamera!: (dir: Vector) => Vector;
let skyFn: ((dir: Vector) => Color) | undefined;
let skyImageData: ImageData | undefined;
let lensRadius   = 0;
let focusDistance = 0;
let sigma_t = 0; // extinction coefficient (scattering + absorption)
let sigma_s = 0; // scattering coefficient
let phaseG  = 0; // Henyey-Greenstein anisotropy (-1…1)
let totalEmissiveMeshArea = 0; // precomputed per scene for MIS PDF
let totalEmissiveRectArea = 0;
/* eslint-enable prefer-const */

async function importScene(name: string): Promise<{
  cameraStart: Point;
  rotateCamera: (dir: Vector) => Vector;
  sceneObjects: SceneObject[];
  skyFn?: (dir: Vector) => Color;
  skyImageKey?: string;
  lensRadius?: number;
  focusDistance?: number;
  sigma_t?: number;
  sigma_s?: number;
  phaseG?: number;
}> {
  let mod: any;
  if (name === "cornellBox")         mod = await import("./scenes/cornellBox.js");
  else if (name === "globalIllumination") mod = await import("./scenes/globalIllumination.js");
  else if (name === "furnaceTest")   mod = await import("./scenes/furnaceTest.js");
  else if (name === "teapot")        mod = await import("./scenes/teapot.js");
  else if (name === "refraction")    mod = await import("./scenes/refraction.js");
  else if (name === "metalBunny")    mod = await import("./scenes/metalBunny.js");
  else if (name === "backrooms")     mod = await import("./scenes/backrooms.js");
  else if (name === "chess")         mod = await import("./scenes/chess.js");
  else if (name === "dragon")        mod = await import("./scenes/dragon.js");
  else if (name === "lab")           mod = await import("./scenes/lab.js");
  else if (name === "monkey")        mod = await import("./scenes/monkey.js");
  else if (name === "tumbler")       mod = await import("./scenes/tumbler.js");
  else                               mod = await import("./scenes/cornellBoxMeshes.js");

  if (typeof mod.init === "function") await mod.init();
  return mod;
}

export function findClosestIntersection({
  ray,
  tMin,
  tMax,
  findClosest = true,
  sceneObjects,
  i,
  j
}: {
  ray: Ray;
  tMin: number;
  tMax: number;
  findClosest?: boolean;
  i?: number;
  j?: number;
  sceneObjects: SceneObject[];
}): Intersected | null {
  let point: Point;
  let intersected: Intersected = null;
  let dist = Infinity;
  let closestIntersection = Infinity;
  let intersection: Intersection;
  let meshObjects = sceneObjects.filter((object) => object.type === "mesh");

  // BVH-accelerated mesh intersection: O(log n) per ray instead of O(n)
  for (let k = 0; k < meshObjects.length; k++) {
    const meshObject = meshObjects[k] as Mesh;

    if (meshObject.bvh) {
      const hit = intersectBVH(meshObject.bvh, ray, tMin, tMax, !findClosest);
      if (hit) {
        point = ray.getPoint(hit.t);
        if (!findClosest) return { point, object: hit.tri, mesh: meshObject };
        dist = distance(point, ray.start);
        if (dist < closestIntersection) {
          closestIntersection = dist;
          tMax = hit.t; // shrink window so later meshes get a tighter bound
          intersected = { point, object: hit.tri, intersection: { t: hit.t }, mesh: meshObject };
        }
      }
    } else {
      // Fallback for meshes with no triangles (e.g. quad-only meshes)
      for (let j = 0; j < meshObject.meshObjects.length; j++) {
        const object = meshObject.meshObjects[j];
        intersection = object.intersection(ray);
        if (intersection) {
          const { t } = intersection;
          point = ray.getPoint(t);
          if (t > tMin && t < tMax) {
            if (!findClosest) return { point, object };
            dist = distance(point, ray.start);
            if (dist < closestIntersection) {
              closestIntersection = dist;
              intersected = { point, object, intersection };
            }
          }
        }
      }
    }
  }

  let objects = sceneObjects.filter((object) => object.type !== "mesh");
  for (let k = 0; k < objects.length; k++) {
    const object = objects[k] as Primitive;

    intersection = object.intersection(ray);

    if (intersection) {
      const { t } = intersection;
      point = ray.getPoint(t);

      if (t > tMin && t < tMax) {
        if (!findClosest) {
          return { point, object };
        }

        dist = distance(point, ray.start);

        if (dist < closestIntersection) {
          closestIntersection = dist;
          intersected = {
            point,
            object: intersection.side || object,
            intersection
          };
        }
      }
    }
  }

  return intersected;
}

const getFresnelReflectance = ({
  normal,
  incidentRay,
  refractionIndex
}: {
  normal: Vector;
  incidentRay: Vector;
  refractionIndex: number;
}) => {
  const cosTheta = Math.abs(normal.dotProduct(incidentRay));
  const r0 = Math.pow((1 - refractionIndex) / (1 + refractionIndex), 2);
  return r0 + (1 - r0) * Math.pow(1 - cosTheta, 5);
};

const getReflectedRay = function ({
  normal,
  point,
  incidentRay
}: {
  normal: Vector;
  point: Point;
  incidentRay: Vector;
}) {
  const a = 2 * dotProduct(incidentRay, normal);

  const b = normal.multiply(a);

  return new Ray(point, subtract(incidentRay, b));
};

const getRefractedRay = ({
  normal,
  point,
  incidentRay,
  refractionIndex
}: {
  normal: Vector;
  point: Point;
  incidentRay: Vector;
  refractionIndex: number;
}) => {
  const cosThetaI = normal.dotProduct(incidentRay);
  const entering = cosThetaI < 0;
  // n = n_incident / n_transmitted
  const n = entering ? (1 / refractionIndex) : refractionIndex;
  // Orient normal toward the incident medium so the formula is uniform
  const orientedNormal = entering ? normal : normal.multiply(-1);
  const cosTheta = Math.abs(cosThetaI);

  const sin2ThetaT = n * n * (1 - cosTheta * cosTheta);
  if (sin2ThetaT >= 1) return null; // total internal reflection

  const cosThetaT = Math.sqrt(1 - sin2ThetaT);
  // ωt = n·ωi + (n·cosθi − cosθt)·n̂  (n̂ points into incident medium)
  const refractedDir = incidentRay.multiply(n)
    .add(orientedNormal.multiply(n * cosTheta - cosThetaT));

  return new Ray(point, refractedDir);
};

// Proper sphere-light NEE: uniform cone sampling with solid-angle estimator.
// MC estimator for one sample:  (albedo/π) × L_e × cos(θ) × solidAngle
// Expected value = true direct-lighting integral (unbiased).
const sampleSphereLight = (
  lightCenter: Point,
  lightRadius: number,
  surfacePoint: Point
): { dir: Vector; solidAngle: number } | null => {
  const toLight = lightCenter.subtract(surfacePoint).toVector();
  const dist = toLight.length();
  if (dist <= lightRadius) return null;

  const sinMax = lightRadius / dist;
  const cosMax = Math.sqrt(1 - sinMax * sinMax);
  const solidAngle = 2 * Math.PI * (1 - cosMax);

  const u = Math.random(), v = Math.random();
  const cosT = 1 - u * (1 - cosMax);
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  const phi = 2 * Math.PI * v;

  const z = toLight.normalize();
  const up = Math.abs(z.y) < 0.999 ? new Vector(0, 1, 0) : new Vector(1, 0, 0);
  const x = up.crossProduct(z).normalize();
  const y = z.crossProduct(x);

  const dir = x.multiply(sinT * Math.cos(phi))
    .add(y.multiply(sinT * Math.sin(phi)))
    .add(z.multiply(cosT))
    .normalize();

  return { dir, solidAngle };
};

// ─── Disney-style metallic BRDF (Cook-Torrance GGX) ─────────────────────────

// GGX NDF: D(h) = α² / (π * ((n·h)²(α²-1)+1)²)
const ggxD = (nDotH: number, alpha2: number): number => {
  const d = nDotH * nDotH * (alpha2 - 1) + 1;
  return alpha2 / (Math.PI * d * d);
};

// Smith G1 masking term for GGX
const smithG1 = (nDotV: number, alpha2: number): number => {
  return 2 * nDotV / (nDotV + Math.sqrt(alpha2 + (1 - alpha2) * nDotV * nDotV));
};

// Sample a microfacet half-vector from the GGX distribution.
// Returns h in world space.
const sampleGGX = (normal: Vector, alpha2: number): Vector => {
  const u1 = Math.random();
  const u2 = Math.random();
  // Spherical coords of h in local frame (n is up)
  const cosTheta = Math.sqrt((1 - u1) / (1 + (alpha2 - 1) * u1));
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const phi = 2 * Math.PI * u2;
  // Build ONB around normal
  const up = Math.abs(normal.y) < 0.999 ? new Vector(0, 1, 0) : new Vector(1, 0, 0);
  const tangent = up.crossProduct(normal).normalize();
  const bitangent = normal.crossProduct(tangent);
  return tangent.multiply(sinTheta * Math.cos(phi))
    .add(bitangent.multiply(sinTheta * Math.sin(phi)))
    .add(normal.multiply(cosTheta))
    .normalize();
};

// Evaluate HG phase function (solid-angle PDF).  Used for volumetric NEE weight.
const hgPhase = (cosTheta: number, g: number): number => {
  if (Math.abs(g) < 1e-3) return 1 / (4 * Math.PI);
  const g2 = g * g;
  return (1 - g2) / (4 * Math.PI * Math.pow(Math.max(0, 1 + g2 - 2 * g * cosTheta), 1.5));
};


// g=0 → isotropic, g>0 → forward scatter (dust), g<0 → back scatter.
const sampleHenyeyGreenstein = (inDir: Vector, g: number): Vector => {
  const u = Math.random();
  const v = Math.random();
  let cosTheta: number;
  if (Math.abs(g) < 1e-3) {
    cosTheta = 1 - 2 * u;
  } else {
    const s = (1 - g * g) / (1 - g + 2 * g * u);
    cosTheta = (1 + g * g - s * s) / (2 * g);
  }
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const phi = 2 * Math.PI * v;
  const w = inDir; // caller must normalize
  const up = Math.abs(w.y) < 0.999 ? new Vector(0, 1, 0) : new Vector(1, 0, 0);
  const tu = up.crossProduct(w).normalize();
  const tv = w.crossProduct(tu);
  return tu.multiply(sinTheta * Math.cos(phi))
    .add(tv.multiply(sinTheta * Math.sin(phi)))
    .add(w.multiply(cosTheta))
    .normalize();
};

const getCosineWeightedSample = (normal: Vector) => {
  const u = Math.random();
  const v = Math.random();
  const theta = 2 * Math.PI * u;

  // Malley's method: project a uniform disk sample onto the hemisphere.
  // PDF = cos(θ)/π, giving efficient cosine-weighted sampling.
  const r = Math.sqrt(v);
  const localX = r * Math.cos(theta);
  const localY = r * Math.sin(theta);
  const localZ = Math.sqrt(1 - v); // z ≥ 0 → upper hemisphere only

  // Build an orthonormal basis (tangent, bitangent, normal) via Gram-Schmidt.
  const up = Math.abs(normal.y) < 0.999 ? new Vector(0, 1, 0) : new Vector(1, 0, 0);
  const tangent = up.crossProduct(normal).normalize();
  const bitangent = normal.crossProduct(tangent);

  return tangent.multiply(localX)
    .add(bitangent.multiply(localY))
    .add(normal.multiply(localZ));
};

const castRay = ({
  ray,
  sceneObjects,
  i,
  j
}: {
  ray: Ray;
  sceneObjects: SceneObject[];
  i?: number;
  j?: number;
}) => {
  const closestIntersection = findClosestIntersection({
    ray,
    tMin: epsilon,
    tMax: Infinity,
    sceneObjects,
    i,
    j
  });
  return closestIntersection;
};

const getColorFromImageMap = ({
  object,
  imageMap,
  point
}: {
  object: Shape;
  imageMap: ImageData;
  point: Point;
}) => {
  if (object?.type !== "sphere") {
    return new Color(0, 0, 0);
  }
  // center of sphere as a vector
  const center = new Vector(object.center.x, object.center.y, object.center.z);

  // point on sphere as a vector
  const pointOnSphere = new Vector(point.x, point.y, point.z);

  // vector from center of sphere to point on sphere
  const pointAroundCenter = subtract(pointOnSphere, center);

  // scale the point to the unit sphere
  const scaledPointAroundCenter = new Point(
    Math.min(1, pointAroundCenter.x / object.radius),
    Math.min(1, pointAroundCenter.y / object.radius),
    Math.min(1, pointAroundCenter.z / object.radius)
  );

  // find the latitude and longitude of the point
  const theta = Math.acos(scaledPointAroundCenter.y);
  const phi =
    Math.atan2(scaledPointAroundCenter.z, scaledPointAroundCenter.x) + Math.PI;

  // find the pixel coordinates of the texture map
  const u = Math.floor((phi / (2 * Math.PI)) * imageMap.width);
  const v = Math.floor((theta / Math.PI) * imageMap.height);

  // get the pixel color from the texture map
  const index = (u + v * imageMap.width) * 4;
  const r = imageMap.data[index] / 255;
  const g = imageMap.data[index + 1] / 255;
  const b = imageMap.data[index + 2] / 255;

  return new Color(r, g, b);
};

const traceRay = ({
  ray,
  imageMaps,
  bounceDepth = 0,
  throughput = new Color(1, 1, 1),
  misPBrdf,
  includeEmission = true,
  i,
  j,
  k
}: {
  ray: Ray;
  imageMaps: { [key: string]: ImageData };
  bounceDepth?: number;
  throughput?: Color;
  misPBrdf?: number;
  includeEmission?: boolean;
  i?: number;
  j?: number;
  k?: number;
}): Color => {
  let radiance = new Color(0, 0, 0);
  const MIN_BOUNCES = 3;
  const MAX_BOUNCES = 24;

  if (bounceDepth > MAX_BOUNCES) {
    return new Color(0, 0, 0);
  }

  let intersected = castRay({ ray, sceneObjects, i, j });

  // ─── Participating media (dust / fog) ────────────────────────────────────────
  // Sample a free-flight distance from Exp(σ_t). If it falls before the nearest
  // surface the ray scatters in the volume; otherwise proceed to surface shading.
  // With exponential sampling the transmittance cancels, so no explicit Beer's
  // law weight is needed here — only in the NEE shadow-ray contributions below.
  if (sigma_t > 0) {
    const tScatter = -Math.log(1 - Math.random()) / sigma_t;
    const tSurface = intersected ? distance(intersected.point, ray.start) : Infinity;
    if (tScatter < tSurface) {
      const scatterPt = ray.getPoint(tScatter);
      const inDir = ray.dir.normalize();
      const sa = sigma_s / sigma_t;

      // ── Volumetric NEE: direct-sample the area light from the scatter point ──
      // This is what makes god rays converge — without it we rely on the
      // scattered ray randomly finding the tiny window, which takes thousands of passes.
      let nee = new Color(0, 0, 0);
      for (const obj of sceneObjects) {
        if (obj.type !== "mesh") continue;
        const mesh = obj as Mesh;
        const emissive = mesh.material?.emissive;
        if (!emissive || (emissive.r === 0 && emissive.g === 0 && emissive.b === 0)) continue;
        type ETri = { tri: Triangle; area: number };
        const tris: ETri[] = [];
        for (const prim of mesh.meshObjects) {
          if (prim.type !== "triangle") continue;
          const tri = prim as Triangle;
          const e1 = tri.v2.subtract(tri.v1);
          const e2 = tri.v3.subtract(tri.v1);
          tris.push({ tri, area: 0.5 * e1.crossProduct(e2).length() });
        }
        if (tris.length === 0) continue;
        const totalArea = tris.reduce((s, t) => s + t.area, 0);
        let rnd = Math.random() * totalArea;
        let chosen = tris[tris.length - 1];
        for (const t of tris) { rnd -= t.area; if (rnd <= 0) { chosen = t; break; } }
        const sq = Math.sqrt(Math.random()), r2 = Math.random();
        const b0 = 1 - sq, b1 = sq * (1 - r2), b2 = sq * r2;
        const { tri } = chosen;
        const lp = new Point(
          b0 * tri.v1.x + b1 * tri.v2.x + b2 * tri.v3.x,
          b0 * tri.v1.y + b1 * tri.v2.y + b2 * tri.v3.y,
          b0 * tri.v1.z + b1 * tri.v2.z + b2 * tri.v3.z
        );
        const toLv = new Vector(lp.x - scatterPt.x, lp.y - scatterPt.y, lp.z - scatterPt.z);
        const dist = toLv.length();
        const lDir = toLv.normalize();
        const cosTL = Math.abs(tri.normal.dotProduct(lDir));
        const phase = hgPhase(inDir.dotProduct(lDir), phaseG);
        const shadow = findClosestIntersection({ ray: new Ray(scatterPt, lDir), tMin: epsilon, tMax: dist - epsilon, sceneObjects });
        if (!shadow) {
          const T = Math.exp(-sigma_t * dist);
          nee = nee.addWithColor(emissive.multiply(sa * phase * cosTL * totalArea * T / (dist * dist)));
        }
      }
      // ─────────────────────────────────────────────────────────────────────────

      // Indirect scattered ray — suppress emission so NEE doesn't double-count direct hits.
      const newDir = sampleHenyeyGreenstein(inDir, phaseG);
      const indirect = new Color(sa, sa, sa).multiplyWithColor(
        traceRay({ ray: new Ray(scatterPt, newDir), imageMaps, bounceDepth: bounceDepth + 1, throughput: throughput.multiply(sa), includeEmission: false, i, j, k })
      );
      return nee.addWithColor(indirect);
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  let normal: Vector;
  if (intersected?.object) {
    if (intersected.object.type === "triangle") {
      // get barycentric coordinates
      const UVW = intersected.object.getUVW(intersected.point);
      const { u, v, w } = UVW;
      // get the normal at the point of intersection
      normal = intersected.object.normalAtPoint({ u, v, w });
    } else if (typeof intersected?.object.normal === "function") {
      normal = intersected?.object.normal(intersected?.point);
    } else {
      normal = intersected?.object?.normal;
    }

    if (!normal) {
      throw new Error("No normal found");
    }

    const emission = intersected?.object?.material?.emissive;

    if (emission) {
      if (!includeEmission) return new Color(0, 0, 0);

      // BRDF-sampled ray hit an emissive surface. Apply MIS balance weight so
      // this and the NEE contribution together equal the full direct lighting integral.
      if (misPBrdf !== undefined) {
        const d = distance(intersected.point, ray.start);
        const cosTL = Math.abs(normal.dotProduct(ray.dir.normalize().multiply(-1)));
        let pLightSa = 0;
        if (d > 0 && cosTL > 0) {
          if (intersected.mesh && totalEmissiveMeshArea > 0) {
            pLightSa = (d * d) / (cosTL * totalEmissiveMeshArea);
          } else if (intersected.object?.type === 'rectangle' && totalEmissiveRectArea > 0) {
            pLightSa = (d * d) / (cosTL * totalEmissiveRectArea);
          } else if (intersected.object?.name === 'lightBall') {
            const sphere = intersected.object as Sphere;
            const toCenter = new Vector(
              sphere.center.x - ray.start.x,
              sphere.center.y - ray.start.y,
              sphere.center.z - ray.start.z
            );
            const d2c = toCenter.length();
            if (d2c > sphere.radius) {
              const sinMax = sphere.radius / d2c;
              const cosMax = Math.sqrt(Math.max(0, 1 - sinMax * sinMax));
              pLightSa = 1 / (2 * Math.PI * (1 - cosMax));
            }
          }
        }
        if (pLightSa > 0) return emission.multiply(misPBrdf / (misPBrdf + pLightSa));
      }

      return emission;
    }

    // Russian roulette: after MIN_BOUNCES, terminate low-throughput paths probabilistically.
    // Surviving paths are boosted by 1/p so the estimator stays unbiased.
    let rrScale = 1;
    if (bounceDepth >= MIN_BOUNCES) {
      const p = Math.max(0.05, Math.min(1, Math.max(throughput.r, throughput.g, throughput.b)));
      if (Math.random() > p) return new Color(0, 0, 0);
      rrScale = 1 / p;
    }

    const material = (intersected.object as Primitive).material;

    // Metallic: Cook-Torrance GGX specular BRDF with importance sampling.
    // F0 = albedo (metals reflect their own colour), no diffuse component.
    if ((material.metallic ?? 0) > 0) {
      const roughness = Math.max(0.01, material.roughness ?? 0.3);
      const alpha2 = roughness * roughness * roughness * roughness; // α = roughness², α² = roughness⁴
      const ωo = ray.dir.multiply(-1).normalize();          // view direction (outgoing)
      const nDotO = Math.max(0, normal.dotProduct(ωo));
      if (nDotO <= 0) return new Color(0, 0, 0);

      const h = sampleGGX(normal, alpha2);
      const oDotH = Math.max(0, ωo.dotProduct(h));

      // Reflect ωo about h to get the incoming light direction ωi
      const ωi = h.multiply(2 * ωo.dotProduct(h)).subtract(ωo).normalize();
      const nDotI = Math.max(0, normal.dotProduct(ωi));
      if (nDotI <= 0) return new Color(0, 0, 0); // below surface

      const nDotH = Math.max(0, normal.dotProduct(h));

      // Schlick Fresnel: F0 = albedo for metals
      const f0 = material.albedo;
      const fresnel = f0.addWithColor(
        new Color(1, 1, 1).subtract(f0).multiply(Math.pow(1 - oDotH, 5))
      );

      // Smith G2 (separable form)
      const G = smithG1(nDotO, alpha2) * smithG1(nDotI, alpha2);

      // GGX importance-sampled weight: F * G * (ωo·h) / ((n·ωo) * (n·h))
      // (D cancels with the PDF D*(n·h)/(4*(ωo·h)))
      const weight = (G * oDotH) / (nDotO * nDotH);
      const brdfColor = fresnel.multiply(weight);
      const Li = traceRay({
        ray: new Ray(intersected.point.add(normal.multiply(epsilon).toPoint()), ωi),
        imageMaps, bounceDepth: bounceDepth + 1,
        throughput: throughput.multiply(rrScale).multiplyWithColor(brdfColor),
        includeEmission: true, i, j, k
      });
      return brdfColor.multiply(rrScale).multiplyWithColor(Li);
    }

    // Dielectric (glass): Fresnel-weighted Russian roulette between reflection and refraction.
    // Skip diffuse bounce and NEE — this is a purely specular path.
    if ((material.refractionIndex ?? 0) > 0) {
      const fresnel = getFresnelReflectance({
        normal,
        incidentRay: ray.dir,
        refractionIndex: material.refractionIndex!
      });
      const reflected = getReflectedRay({ normal, point: intersected.point, incidentRay: ray.dir });
      const dielectricThroughput = throughput.multiply(rrScale);
      if (Math.random() < fresnel) {
        return traceRay({ ray: reflected, imageMaps, bounceDepth: bounceDepth + 1, throughput: dielectricThroughput, includeEmission: true, i, j, k }).multiply(rrScale);
      }
      const refracted = getRefractedRay({ normal, point: intersected.point, incidentRay: ray.dir, refractionIndex: material.refractionIndex! });
      // TIR fallback: reflect if refraction is geometrically impossible
      return traceRay({ ray: refracted ?? reflected, imageMaps, bounceDepth: bounceDepth + 1, throughput: dielectricThroughput, includeEmission: true, i, j, k }).multiply(rrScale);
    }

    // Glossy dielectric: polished non-metal (lacquered wood, stone, plastic).
    // Schlick Fresnel F0=0.04; Russian roulette picks specular vs diffuse.
    // Diffuse arm falls through to the NEE path below (texture preserved).
    if (material.roughness !== undefined && !material.metallic && !material.refractionIndex) {
      const roughness = Math.max(0.01, material.roughness);
      const alpha2 = roughness ** 4;
      const ωo = ray.dir.multiply(-1).normalize();
      const nDotO = Math.max(0, normal.dotProduct(ωo));
      const fresnelP = 0.04 + 0.96 * Math.pow(1 - nDotO, 5);

      if (Math.random() < fresnelP) {
        const h = sampleGGX(normal, alpha2);
        const oDotH = Math.max(0, ωo.dotProduct(h));
        const ωi = h.multiply(2 * ωo.dotProduct(h)).subtract(ωo).normalize();
        const nDotI = normal.dotProduct(ωi);
        const nDotH = Math.max(0, normal.dotProduct(h));
        if (nDotI > 0 && nDotH > 0 && nDotO > 0) {
          const G = smithG1(nDotO, alpha2) * smithG1(nDotI, alpha2);
          const weight = (G * oDotH) / (nDotO * nDotH);
          const Li = traceRay({
            ray: new Ray(intersected.point.add(normal.multiply(epsilon).toPoint()), ωi),
            imageMaps, bounceDepth: bounceDepth + 1,
            throughput: throughput.multiply(rrScale * weight),
            includeEmission: true, i, j, k,
          });
          return new Color(1, 1, 1).multiply(weight * rrScale).multiplyWithColor(Li);
        }
      }
      // Diffuse arm: fall through to texture + NEE below.
    }

    // Subsurface scattering: use Beer-Lambert T as branching probability.
    // Thin sections (high T) mostly scatter through; thick sections (low T) mostly
    // fall through to normal diffuse. No arbitrary subsurface parameter needed.
    if ((material.subsurface ?? 0) > 0 && material.subsurfaceSigma) {
      let thickness = 0.5;
      if (intersected.mesh?.bvh) {
        const hit = intersectBVH(intersected.mesh.bvh, new Ray(intersected.point, ray.dir), epsilon * 10, Infinity, false);
        thickness = hit ? hit.t : 0.5;
      } else {
        const exitPt = intersected.point.add(ray.dir.normalize().multiply(epsilon * 10).toPoint());
        const exitHit = (intersected.object as any).intersection?.(new Ray(exitPt, ray.dir));
        thickness = exitHit?.t ?? 0.5;
      }
      const T = Math.exp(-material.subsurfaceSigma * thickness);
      if (Math.random() < T) {
        const albedo = material.texture ? material.texture(intersected.point, normal) : material.albedo;
        const scatterDir = getCosineWeightedSample(normal.multiply(-1));
        const exitPt = intersected.point.add(normal.multiply(-epsilon).toPoint());
        return albedo.multiply(rrScale).multiplyWithColor(
          traceRay({ ray: new Ray(exitPt, scatterDir), imageMaps, bounceDepth: bounceDepth + 1, throughput: throughput.multiply(rrScale).multiplyWithColor(albedo), includeEmission: true, i, j, k })
        );
      }
    }

    let color = material.texture ? material.texture(intersected.point, normal) : material.albedo;
    if (material.imageMap && material.imageMapUV) {
      const img = imageMaps[material.imageMap] as ImageData | undefined;
      if (img) {
        const [u, v] = material.imageMapUV(intersected.point);
        const px = Math.max(0, Math.min(img.width  - 1, Math.floor(u * img.width)));
        const py = Math.max(0, Math.min(img.height - 1, Math.floor(v * img.height)));
        const idx = (py * img.width + px) * 4;
        const lin = (c: number) => Math.pow(c / 255, 2.2);
        color = new Color(lin(img.data[idx]), lin(img.data[idx + 1]), lin(img.data[idx + 2]));
      }
    }

    color = color.multiply(rrScale);

    // Single path sample per bounce (proper Monte Carlo path tracing).
    // With cosine-weighted sampling, PDF = cos(θ)/π and BRDF = albedo/π,
    // so the weight simplifies to just albedo.
    const randomDirection = getCosineWeightedSample(normal);
    const throughputWeight = color;
    const shiftedPoint = intersected.point.add(
      normal.multiply(epsilon).toPoint()
    );

    // BRDF sample: pass misPBrdf so emissive hits use MIS balance weight instead of being suppressed.
    const pBrdf = Math.max(0, normal.dotProduct(randomDirection)) / Math.PI;
    radiance = radiance.addWithColor(
      throughputWeight.multiplyWithColor(
        traceRay({
          ray: new Ray(shiftedPoint, randomDirection),
          imageMaps,
          bounceDepth: bounceDepth + 1,
          throughput: throughput.multiplyWithColor(color),
          misPBrdf: pBrdf,
          i,
          j,
          k
        })
      )
    );

    // Next-event estimation: run all applicable light types simultaneously.
    // Each uses a MIS balance weight vs the cosine-weighted BRDF sample (p_brdf = cosθ/π).
    const lightSphere = sceneObjects.find((o) => o.name === "lightBall") as Sphere | undefined;

    if (lightSphere) {
      // Sphere-light NEE: uniform cone sampling, solid-angle estimator.
      const sample = sampleSphereLight(lightSphere.center, lightSphere.radius, intersected.point);
      if (sample) {
        const { dir: lightDir, solidAngle } = sample;
        const cosTheta = Math.max(0, normal.dotProduct(lightDir));
        if (cosTheta > 0) {
          const shadowHit = castRay({ ray: new Ray(intersected.point, lightDir), sceneObjects, i, j });
          if (shadowHit?.object?.name === "lightBall") {
            const neeEmission = lightSphere.material.emissive ?? new Color(0, 0, 0);
            const pLightSa = 1 / solidAngle;
            const pBrdfSa = cosTheta / Math.PI;
            const wNee = pLightSa / (pLightSa + pBrdfSa);
            const weight = cosTheta * solidAngle / Math.PI;
            const lightDist = lightSphere.center.subtract(intersected.point).toVector().length();
            const T = sigma_t > 0 ? Math.exp(-sigma_t * lightDist) : 1;
            radiance = radiance.addWithColor(color.multiply(weight * T * wNee).multiplyWithColor(neeEmission));
          }
        }
      }
    }

    // Area-light NEE: always runs regardless of sphere lights.
    // Estimator: albedo/π × L_e × cosTheta_surface × cosTheta_light × totalArea / dist²
    {
      const emissiveTris: { tri: Triangle; emission: Color; area: number }[] = [];
      for (const obj of sceneObjects) {
        if (obj.type === "mesh") {
          const mesh = obj as Mesh;
          const emissive = mesh.material?.emissive;
          if (emissive && (emissive.r > 0 || emissive.g > 0 || emissive.b > 0)) {
            for (const prim of mesh.meshObjects) {
              if (prim.type === "triangle") {
                const tri = prim as Triangle;
                const edge1 = tri.v2.subtract(tri.v1);
                const edge2 = tri.v3.subtract(tri.v1);
                const area = 0.5 * edge1.crossProduct(edge2).length();
                emissiveTris.push({ tri, emission: emissive, area });
              }
            }
          }
        }
      }

      if (emissiveTris.length > 0) {
        const totalArea = emissiveTris.reduce((s, e) => s + e.area, 0);

        // Pick triangle proportional to area
        let rnd = Math.random() * totalArea;
        let chosen = emissiveTris[emissiveTris.length - 1];
        for (const e of emissiveTris) { rnd -= e.area; if (rnd <= 0) { chosen = e; break; } }

        // Uniform point on triangle via barycentric coordinates
        const sqr1 = Math.sqrt(Math.random());
        const r2 = Math.random();
        const b0 = 1 - sqr1, b1 = sqr1 * (1 - r2), b2 = sqr1 * r2;
        const { tri, emission: meshEmission } = chosen;
        const lightPoint = new Point(
          b0 * tri.v1.x + b1 * tri.v2.x + b2 * tri.v3.x,
          b0 * tri.v1.y + b1 * tri.v2.y + b2 * tri.v3.y,
          b0 * tri.v1.z + b1 * tri.v2.z + b2 * tri.v3.z
        );

        const toLightVec = new Vector(
          lightPoint.x - intersected.point.x,
          lightPoint.y - intersected.point.y,
          lightPoint.z - intersected.point.z
        );
        const dist = toLightVec.length();
        const lightDir = toLightVec.normalize();
        const cosTheta = Math.max(0, normal.dotProduct(lightDir));
        const cosThetaLight = Math.abs(tri.normal.dotProduct(lightDir));

        if (cosTheta > 0 && cosThetaLight > 0) {
          const shadowHit = findClosestIntersection({
            ray: new Ray(intersected.point, lightDir),
            tMin: epsilon,
            tMax: dist - epsilon,
            sceneObjects,
            i,
            j
          });
          if (!shadowHit) {
            const pLightSa = (dist * dist) / (cosThetaLight * totalArea);
            const pBrdfSa = cosTheta / Math.PI;
            const wNee = pLightSa / (pLightSa + pBrdfSa);
            const weight = cosTheta * cosThetaLight * totalArea / (dist * dist * Math.PI);
            const T = sigma_t > 0 ? Math.exp(-sigma_t * dist) : 1;
            radiance = radiance.addWithColor(color.multiply(weight * T * wNee).multiplyWithColor(meshEmission));
          }
        }
      }
    }

    // Emissive rectangle NEE (e.g. skylight, area panel)
    for (const obj of sceneObjects) {
      if (obj.type !== 'rectangle') continue;
      const rect = obj as Rectangle;
      const em = rect.material?.emissive;
      if (!em || (em.r === 0 && em.g === 0 && em.b === 0)) continue;
      const u = Math.random(), v = Math.random();
      const lx = rect.corner.x + u * rect.v1.x * rect.width + v * rect.v2.x * rect.height;
      const ly = rect.corner.y + u * rect.v1.y * rect.width + v * rect.v2.y * rect.height;
      const lz = rect.corner.z + u * rect.v1.z * rect.width + v * rect.v2.z * rect.height;
      const dx = lx - intersected.point.x, dy = ly - intersected.point.y, dz = lz - intersected.point.z;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      const lightDir = new Vector(dx/dist, dy/dist, dz/dist);
      const cosTheta = Math.max(0, normal.dotProduct(lightDir));
      const cosThetaLight = Math.abs(rect.normal.dotProduct(lightDir));
      if (cosTheta === 0 || cosThetaLight === 0) continue;
      const shadowHit = findClosestIntersection({ ray: new Ray(intersected.point, lightDir), tMin: epsilon, tMax: dist - epsilon, sceneObjects, i, j });
      if (!shadowHit) {
        const area = rect.width * rect.height;
        const pLightSa = (dist * dist) / (cosThetaLight * area);
        const pBrdfSa = cosTheta / Math.PI;
        const wNee = pLightSa / (pLightSa + pBrdfSa);
        const T = sigma_t > 0 ? Math.exp(-sigma_t * dist) : 1;
        radiance = radiance.addWithColor(color.multiply(cosTheta * cosThetaLight * area * T * wNee / (dist * dist * Math.PI)).multiplyWithColor(em));
      }
    }
  } else {
    let skyColor: Color;
    if (skyImageData) {
      const d = ray.dir;
      const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
      const ny = d.y / len, nx = d.x / len, nz = d.z / len;
      const theta = Math.acos(Math.max(-1, Math.min(1, ny)));
      const phi   = Math.atan2(nz, nx);
      const u = Math.floor(((phi + Math.PI) / (2 * Math.PI)) * skyImageData.width * 2) % skyImageData.width;
      const v = Math.floor((theta / Math.PI)                  * skyImageData.height) % skyImageData.height;
      const idx = (v * skyImageData.width + u) * 4;
      const fromSrgb = (v: number) => Math.pow(v / 255, 2.2);
      skyColor = new Color(
        fromSrgb(skyImageData.data[idx]),
        fromSrgb(skyImageData.data[idx + 1]),
        fromSrgb(skyImageData.data[idx + 2])
      );
    } else {
      skyColor = skyFn ? skyFn(ray.dir) : new Color(0.2, 0.2, 0.2);
    }
    radiance = radiance.addWithColor(skyColor);
  }

  return radiance;
};

onmessage = async (e: MessageEvent) => {
  const {
    iStart, iEnd, jStart, jEnd, width, imageMaps,
    sceneName = "cornellBoxMeshes",
    totalPasses = 128,
    overrides = {} as Record<string, number>
  } = e.data;

  const scene = await importScene(sceneName);
  sceneObjects = scene.sceneObjects;
  cameraStart  = scene.cameraStart;
  rotateCamera = scene.rotateCamera;
  skyFn        = scene.skyFn;
  skyImageData = scene.skyImageKey ? (imageMaps[scene.skyImageKey] as ImageData | undefined) : undefined;
  lensRadius    = scene.lensRadius   ?? 0;
  focusDistance = scene.focusDistance ?? 0;
  sigma_t = overrides.sigma_t !== undefined ? overrides.sigma_t : (scene.sigma_t ?? 0);
  sigma_s = overrides.sigma_s !== undefined ? overrides.sigma_s : (scene.sigma_s ?? 0);
  phaseG  = overrides.phaseG  !== undefined ? overrides.phaseG  : (scene.phaseG  ?? 0);

  // Precompute total emissive areas for MIS PDF calculations.
  totalEmissiveMeshArea = 0;
  totalEmissiveRectArea = 0;
  for (const obj of sceneObjects) {
    if (obj.type === 'mesh') {
      const mesh = obj as Mesh;
      const em = mesh.material?.emissive;
      if (em && (em.r > 0 || em.g > 0 || em.b > 0)) {
        for (const prim of mesh.meshObjects) {
          if (prim.type === 'triangle') {
            const tri = prim as Triangle;
            const e1 = tri.v2.subtract(tri.v1);
            const e2 = tri.v3.subtract(tri.v1);
            totalEmissiveMeshArea += 0.5 * e1.crossProduct(e2).length();
          }
        }
      }
    } else if (obj.type === 'rectangle') {
      const rect = obj as Rectangle;
      const em = rect.material?.emissive;
      if (em && (em.r > 0 || em.g > 0 || em.b > 0)) {
        totalEmissiveRectArea += rect.width * rect.height;
      }
    }
  }

  // Camera basis vectors for DOF lens-disk sampling.
  const cameraRight = rotateCamera(new Vector(1, 0, 0));
  const cameraUp    = rotateCamera(new Vector(0, 1, 0));

  // Precompute base ray directions for the tile — same for every pass.
  type PixelDir = { i: number; j: number; rotatedDir: Vector };
  const pixelDirs: PixelDir[] = [];
  for (let i = iStart; i < iEnd; i++) {
    for (let j = jStart; j < jEnd; j++) {
      const xStart = (j - width / 2) / width;
      const yStart = (width / 2 - i) / width;
      pixelDirs.push({ i, j, rotatedDir: rotateCamera(new Vector(xStart, yStart, 1)) });
    }
  }

  // Progressive: send one raw sample per pixel per message.
  // The main thread accumulates and gamma-corrects for display.
  for (let pass = 0; pass < totalPasses; pass++) {
    const pixelColors: { i: number; j: number; r: number; g: number; b: number }[] = [];

    for (const { i, j, rotatedDir } of pixelDirs) {
      const xJitter = Math.random() / width;
      const yJitter = Math.random() / width;
      const jitteredDir = new Vector(
        rotatedDir.x + xJitter,
        rotatedDir.y + yJitter,
        rotatedDir.z
      );

      let rayOrigin: Point = cameraStart;
      let rayDir: Vector = jitteredDir;

      if (lensRadius > 0 && focusDistance > 0) {
        // Thin-lens DOF: sample a point on the aperture disk, then aim at
        // the focal point (where the pinhole ray hits the focus plane).
        const r = Math.sqrt(Math.random()) * lensRadius;
        const phi = Math.random() * 2 * Math.PI;
        const dx = r * Math.cos(phi);
        const dy = r * Math.sin(phi);
        rayOrigin = new Point(
          cameraStart.x + cameraRight.x * dx + cameraUp.x * dy,
          cameraStart.y + cameraRight.y * dx + cameraUp.y * dy,
          cameraStart.z + cameraRight.z * dx + cameraUp.z * dy
        );
        const dn = jitteredDir.normalize();
        const fp = new Point(
          cameraStart.x + dn.x * focusDistance,
          cameraStart.y + dn.y * focusDistance,
          cameraStart.z + dn.z * focusDistance
        );
        rayDir = new Vector(fp.x - rayOrigin.x, fp.y - rayOrigin.y, fp.z - rayOrigin.z);
      }

      const color = traceRay({ ray: new Ray(rayOrigin, rayDir), imageMaps, i, j });
      const lum = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
      const clampScale = lum > 20 ? 20 / lum : 1;
      pixelColors.push({ i, j, r: color.r * clampScale, g: color.g * clampScale, b: color.b * clampScale });
    }

    postMessage({ pass, totalPasses, pixelColors });
  }
};
