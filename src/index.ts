import { Color } from "./Color.js";

// ─── Scene registry ──────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL;

// ─── Per-scene controls ───────────────────────────────────────────────────────

type ControlDef = { key: string; label: string; min: number; max: number; step: number; value: number; fmt?: (v: number) => string };

const SCENE_CONTROLS: Record<string, ControlDef[]> = {
  lab: [
    { key: 'sigma_t', label: 'Density',    min: 0,     max: 0.15, step: 0.005, value: 0.030, fmt: v => v.toFixed(3) },
    { key: 'sigma_s', label: 'Scatter',    min: 0,     max: 0.15, step: 0.005, value: 0.025, fmt: v => v.toFixed(3) },
    { key: 'phaseG',  label: 'Anisotropy', min: -0.99, max: 0.99, step: 0.01,  value: 0.50,  fmt: v => (v >= 0 ? '+' : '') + v.toFixed(2) },
  ],
};

let activeWorkers: Worker[] = [];

const SCENES = [
  {
    id: "cornellBoxMeshes",
    title: "Cornell Box (Mesh Scene)",
    tag: "Path Tracing",
    description:
      "The classic Cornell box test scene. Red and green walls, two white boxes, and a Utah teapot on the floor under a ceiling light.",
    thumb: `${BASE}thumbnails/cornellBoxMeshes.jpg` as string | null,
  },
  {
    id: "globalIllumination",
    title: "Global Illumination",
    tag: "Path Tracing",
    description:
      "A green sphere in a white room. The green light bleeds onto the surrounding walls, showing off indirect colour bouncing.",
    thumb: `${BASE}thumbnails/globalIllumination.jpg` as string | null,
  },
  {
    id: "refraction",
    title: "Refraction",
    tag: "Dielectrics",
    description:
      "A large glass sphere in a colourful room. The two spheres behind it appear inverted and distorted, with reflections and transmission varying by angle.",
    thumb: `${BASE}thumbnails/refraction.jpg` as string | null,
  },
  {
    id: "metalBunny",
    title: "Metal Bunny",
    tag: "Metallic BRDF",
    description:
      "The Stanford Bunny in polished gold. The red and green walls reflect across its surface.",
    thumb: `${BASE}thumbnails/metalBunny.jpg` as string | null,
  },
  {
    id: "backrooms",
    title: "The Backrooms",
    tag: "Environment",
    description:
      "A long corridor with yellow chevron walls and warm fluorescent lights fading into the dark. A teapot silhouette stands mid-hallway next to a door.",
    thumb: `${BASE}thumbnails/backrooms.jpg` as string | null,
  },
  {
    id: "dragon",
    title: "Stanford Dragon",
    tag: "Subsurface Scattering",
    description:
      "The Stanford Dragon in translucent jade. Light passes through the thin fins and claws, making them glow from behind.",
    thumb: `${BASE}thumbnails/dragon.jpg` as string | null,
  },
  {
    id: "chess",
    title: "Chess Board",
    tag: "Reflections",
    description:
      "A checkmate position with polished silver and gunmetal pieces. The Milky Way sky reflects faintly in the lacquered board.",
    thumb: `${BASE}thumbnails/chess.jpg` as string | null,
  },
  {
    id: "lab",
    title: "Laboratory",
    tag: "Volumetrics",
    description:
      "A lab bench with eight glowing test tubes. Dust in the air scatters a warm shaft of sunlight coming through the window.",
    thumb: `${BASE}thumbnails/lab.jpg` as string | null,
  },
  {
    id: "monkey",
    title: "Suzanne",
    tag: "Subsurface Scattering",
    description:
      "Blender's Suzanne in translucent orange wax. A backlight shines through the ears, making the thin parts glow.",
    thumb: `${BASE}thumbnails/monkey.jpg` as string | null,
  },
  {
    id: "tumbler",
    title: "Crystal Tumbler",
    tag: "Dielectrics",
    description:
      "A glass tumbler with a 45° twist and a candy-striped straw. Red and blue walls bleed colour through the refracting facets.",
    thumb: `${BASE}thumbnails/tumbler.jpg` as string | null,
  },
];

// ─── Gallery view ─────────────────────────────────────────────────────────────

function renderGallery() {
  // Prefer user-rendered localStorage thumbnail over the static one.
  for (const s of SCENES) {
    const stored = localStorage.getItem('thumb_' + s.id);
    if (stored) s.thumb = stored;
  }

  const app = document.getElementById("app")!;
  // Clone the inline prism SVG from the <template> element
  const prismTemplate = document.getElementById("prism-svg") as HTMLTemplateElement | null;
  const prismHTML = prismTemplate ? prismTemplate.innerHTML.trim() : "";

  app.innerHTML = `
    <div class="gallery">
      <div class="gallery-header">
        ${prismHTML}
        <div class="gallery-header-text">
          <h1>JS Raytracer</h1>
          <p>Monte Carlo path tracer — click a scene to render it in your browser</p>
        </div>
      </div>
      <div class="scene-grid">
        ${SCENES.map(
          (s) => `
          <a class="scene-card" href="?scene=${s.id}">
            <div class="scene-thumb">
              ${s.thumb ? `<img src="${s.thumb}" alt="${s.title}" onerror="this.replaceWith(document.createTextNode('◈'))" />` : "◈"}
            </div>
            <div class="scene-info">
              <span class="scene-tag">${s.tag}</span>
              <h2>${s.title}</h2>
              <p>${s.description}</p>
              <span class="render-link">Render →</span>
            </div>
          </a>`
        ).join("")}
      </div>
    </div>
  `;
}

// ─── Renderer view ────────────────────────────────────────────────────────────

function renderScene(sceneId: string, sceneTitle: string) {
  const controls = SCENE_CONTROLS[sceneId] ?? [];
  const app = document.getElementById("app")!;

  const controlsHtml = controls.length ? `
    <div class="scene-controls">
      ${controls.map(c => `
        <div class="control-row">
          <div class="control-header">
            <span class="control-name">${c.label}</span>
            <span class="control-value" id="val-${c.key}">${(c.fmt ?? (v => v.toFixed(3)))(c.value)}</span>
          </div>
          <input type="range" id="ctrl-${c.key}"
            min="${c.min}" max="${c.max}" step="${c.step}" value="${c.value}" />
        </div>
      `).join('')}
      <p class="controls-hint">Release to restart render</p>
    </div>
  ` : '';

  app.innerHTML = `
    <div class="renderer-page">
      <div class="renderer-nav">
        <a class="back-link" href="${window.location.pathname}">← All scenes</a>
        <h1>${sceneTitle}</h1>
        <span class="render-status" id="render-status">Starting…</span>
      </div>
      <div class="canvas-wrap">
        <div class="canvas-placeholder" id="placeholder">
          <div class="spinner"></div>
          <p>Starting render…</p>
        </div>
      </div>
      ${controlsHtml}
    </div>
  `;

  const getOverrides = () => Object.fromEntries(controls.map(c => [c.key, c.value]));
  startRender(sceneId, getOverrides());

  for (const c of controls) {
    const slider   = document.getElementById(`ctrl-${c.key}`) as HTMLInputElement;
    const valueEl  = document.getElementById(`val-${c.key}`)!;
    const fmt      = c.fmt ?? ((v: number) => v.toFixed(3));
    slider.addEventListener('input', () => {
      c.value = parseFloat(slider.value);
      valueEl.textContent = fmt(c.value);
    });
    slider.addEventListener('change', () => {
      const statusEl = document.getElementById("render-status");
      if (statusEl) statusEl.textContent = "Restarting…";
      startRender(sceneId, getOverrides());
    });
  }
}

async function loadImageData(url: string): Promise<ImageData | null> {
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload  = () => resolve();
      img.onerror = () => reject(new Error("image load failed"));
      img.src = url;
    });
    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width  = img.naturalWidth;
    tmpCanvas.height = img.naturalHeight;
    tmpCanvas.getContext("2d")!.drawImage(img, 0, 0);
    return tmpCanvas.getContext("2d")!.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
  } catch {
    return null;
  }
}

async function startRender(sceneName: string, overrides: Record<string, number> = {}) {
  // Terminate any in-flight workers from a previous render.
  for (const w of activeWorkers) w.terminate();
  activeWorkers = [];

  // Preload scene-specific sky images before spawning workers.
  const imageMaps: Record<string, ImageData> = {};
  if (sceneName === "chess") {
    const skyUrl = new URL("./assets/milkyway.jpg", import.meta.url).href;
    const skyData = await loadImageData(skyUrl);
    if (skyData) imageMaps["sky"] = skyData;
  }
  if (sceneName === "lab") {
    const paperUrl = `${BASE}textures/paper.png`;
    const paperData = await loadImageData(paperUrl);
    if (paperData) imageMaps["paper"] = paperData;
  }

  const width       = 600;
  const height      = 600;
  // Heavy-mesh scenes (dragon, metalBunny) parse large OBJs in every worker.
  // Use fewer tiles on memory-constrained devices to avoid tab crashes.
  const heavyMesh = sceneName === "dragon" || sceneName === "metalBunny";
  const mobile    = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const tiles       = heavyMesh && mobile ? 1 : heavyMesh ? 2 : 4;
  const totalPasses = 192;

  const canvas = document.getElementById("render-canvas") as HTMLCanvasElement;
  const ctx    = canvas.getContext("2d")!;
  canvas.width  = width;
  canvas.height = height;
  // Clear to background so a restarted render doesn't flash old pixels.
  ctx.fillStyle = "#05050c";
  ctx.fillRect(0, 0, width, height);

  // Raw linear-light accumulation buffers — gamma is applied at draw time.
  const accumR     = new Float32Array(width * height);
  const accumG     = new Float32Array(width * height);
  const accumB     = new Float32Array(width * height);
  const sampleCounts = new Uint32Array(width * height);
  const imageData  = ctx.createImageData(width, height);

  let swapped        = false;
  let redrawPending  = false;
  let msgsReceived   = 0;
  let thumbSaved     = false;
  const totalMsgs    = tiles * tiles * totalPasses;

  const updateStatus = (text: string) => {
    const el = document.getElementById("render-status");
    if (el) el.textContent = text;
  };

  function swapInCanvas() {
    const placeholder = document.getElementById("placeholder");
    if (placeholder) placeholder.replaceWith(canvas);
    canvas.style.display = "block";
  }

  // ACES filmic tone mapping (Hill/Unreal approximation).
  // Maps unbounded linear HDR values to [0,1] before gamma correction,
  // preserving colour relationships in highlights instead of hard-clamping.
  const aces = (x: number) => {
    x = Math.max(0, x);
    return Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
  };

  function redraw() {
    redrawPending = false;
    const inv = 1 / 2.2;
    for (let pi = 0; pi < height; pi++) {
      for (let pj = 0; pj < width; pj++) {
        const idx = pi * width + pj;
        const n = sampleCounts[idx];
        if (n === 0) continue;
        const r = Math.pow(aces(accumR[idx] / n), inv);
        const g = Math.pow(aces(accumG[idx] / n), inv);
        const b = Math.pow(aces(accumB[idx] / n), inv);
        const p = idx * 4;
        imageData.data[p]     = r * 255;
        imageData.data[p + 1] = g * 255;
        imageData.data[p + 2] = b * 255;
        imageData.data[p + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  for (let ti = 0; ti < tiles; ti++) {
    const iStart = (ti * height) / tiles;
    const iEnd   = ((ti + 1) * height) / tiles;

    for (let tj = 0; tj < tiles; tj++) {
      const jStart = (tj * width) / tiles;
      const jEnd   = ((tj + 1) * width) / tiles;

      const worker = new Worker(
        new URL("./tracePaths.ts", import.meta.url),
        { type: "module" }
      );
      activeWorkers.push(worker);

      worker.postMessage({ iStart, iEnd, jStart, jEnd, width, imageMaps, sceneName, totalPasses, overrides });

      worker.onmessage = (e: MessageEvent) => {
        const { pass, pixelColors } = e.data as {
          pass: number;
          totalPasses: number;
          pixelColors: { i: number; j: number; r: number; g: number; b: number }[];
        };

        for (const { i: pi, j: pj, r, g, b } of pixelColors) {
          const idx = pi * width + pj;
          accumR[idx] += r;
          accumG[idx] += g;
          accumB[idx] += b;
          sampleCounts[idx]++;
        }

        msgsReceived++;
        const spp = Math.round(msgsReceived / (tiles * tiles));
        const done = msgsReceived >= totalMsgs;
        updateStatus(done ? `Done — ${totalPasses} spp` : `Rendering… ${spp} spp`);

        if (!swapped) { swapInCanvas(); swapped = true; }

        if (!redrawPending) {
          redrawPending = true;
          requestAnimationFrame(redraw);
        }

        // Auto-save thumbnail once at 32 accumulated spp.
        if (!thumbSaved && msgsReceived === 32 * tiles * tiles) {
          thumbSaved = true;
          requestAnimationFrame(() => {
            try {
              const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
              localStorage.setItem('thumb_' + sceneName, dataUrl);
            } catch {
              // Silently ignore quota or security errors.
            }
          });
        }

        if (pass === totalPasses - 1) worker.terminate();
      };

      worker.onerror = (err) => {
        console.error("Worker error:", err);
        updateStatus("Error — see console");
        worker.terminate();
      };
    }
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

const params  = new URLSearchParams(window.location.search);
const sceneId = params.get("scene");
const scene   = SCENES.find((s) => s.id === sceneId);

if (scene) {
  renderScene(scene.id, scene.title);
} else {
  renderGallery();
}
