import {
  Color,
  DataTexture,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  NearestFilter,
  RedFormat,
  RepeatWrapping,
  ClampToEdgeWrapping,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  UnsignedByteType,
  Vector3,
  type Camera,
  type Object3D,
} from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { WGS84 } from '../core/constants';
import { geodeticToEcef } from '../core/geo';
import { rasterizeCountries, type Country, type CountryIndex } from './countries';

/** Auflösung der Länder-ID-Karte: 4096 × 2048 ≈ 10 km je Pixel am Äquator. */
const ID_W = 4096;
const ID_H = 2048;
/** Längere Grenzstücke werden in lon/lat unterteilt, damit sie der Erdkrümmung folgen. */
const MAX_STEP_DEG = 0.25;
/**
 * Kachelgröße der Linien-Stücke (Grad): Positionen relativ zur Stückmitte (Float32-Genauigkeit);
 * Stücke hinter dem Horizont oder außerhalb des Bildes werden nicht gezeichnet. Zwei Stufen:
 * In Bodennähe kleine Stücke (wenig Linien außerhalb des Bildes), von weit oben große Stücke
 * (≈ 45 statt > 400 Draw-Calls aus dem All).
 */
const CHUNK_DEG = 5;
const COARSE_CHUNK_DEG = 30;
/** Ab dieser Kamerahöhe zeichnen die großen Stücke. */
const COARSE_ABOVE_M = 300_000;

/**
 * Farbklassen im Stil einer Strategiekarte (gedeckt, gut auf Satellitenbild). Natural Earth
 * vergibt sie so, dass Nachbarn verschiedene Klassen haben (MAPCOLOR9).
 */
export const REALM_COLORS = [
  0x9b4d3c, 0x3f6e9a, 0x6f8f3a, 0xb08a2e, 0x7a4f8c, 0x2f8a83, 0xb2603a, 0x5c6f8f, 0x8c3f5e,
].map((c) => new Color(c));

/**
 * Sichtbarkeit der Flächen nach Kamerahöhe: voll ab 600 km, unter 120 km aus.
 * SIMPLIFIED: Die Tönung kommt aus einer ID-Karte mit ≈ 10 km je Pixel; tiefer unten würde sie
 * sichtbar neben den Grenzlinien liegen, deshalb blendet sie vorher aus.
 */
export function fillFade(heightM: number): number {
  const t = Math.min(1, Math.max(0, (heightM - 120_000) / 480_000));
  return t * t * (3 - 2 * t);
}

/** Deckkraft der Grenzlinien nach Kamerahöhe: unter ≈ 20 km etwas zurückgenommen. */
export function borderFade(heightM: number): number {
  return 0.75 + 0.25 * Math.min(1, Math.max(0, (heightM - 2_000) / 18_000));
}

/**
 * Ausblenden direkt über dem Boden (Höhe über Grund): Die Linien zeichnen ohne Tiefentest und
 * würden sonst aus der Boden- oder Flugkamera quer durchs Gelände am Horizont scheinen.
 */
export function groundFade(aglM: number): number {
  const t = Math.min(1, Math.max(0, (aglM - 300) / 1_200));
  return t * t * (3 - 2 * t);
}

export interface LineChunk {
  /** Mittelpunkt (ECEF, m); Positionen relativ dazu. */
  center: Vector3;
  positions: Float32Array;
  /** Winkelradius des Stücks vom Erdmittelpunkt aus (rad). */
  angle: number;
}

/** Kann ein Stück von der Kamera (ECEF) aus über dem Horizont liegen? */
export function chunkAboveHorizon(chunk: LineChunk, cameraEcef: Vector3): boolean {
  const d = cameraEcef.length();
  const r = chunk.center.length();
  const horizon = d > r ? Math.acos(Math.min(1, r / d)) : 0;
  const cos = cameraEcef.dot(chunk.center) / (d * r);
  return Math.acos(Math.max(-1, Math.min(1, cos))) <= horizon + chunk.angle + 0.01;
}

const _p = { x: 0, y: 0, z: 0 };
const _geo = { lat: 0, lon: 0, height: 0 };

/**
 * Linienzüge (lon/lat) → Segment-Paare in ECEF, gruppiert nach Kacheln. Je Kachel ein Ursprung
 * und die Positionen relativ dazu (Float32 bleibt so auf Zentimeter genau).
 */
export function buildChunks(
  lines: readonly Float64Array[],
  heightM = 0,
  chunkDeg = CHUNK_DEG,
): LineChunk[] {
  const groups = new Map<string, number[]>();
  for (const line of lines) {
    const n = line.length / 2;
    if (n < 2) continue;
    const key = `${Math.floor((line[0]! + 180) / chunkDeg)},${Math.floor((line[1]! + 90) / chunkDeg)}`;
    let arr = groups.get(key);
    if (!arr) groups.set(key, (arr = []));
    let prev: [number, number, number] | null = null;
    for (let i = 0; i < n - 1; i++) {
      const lon0 = line[2 * i]!;
      const lat0 = line[2 * i + 1]!;
      const lon1 = line[2 * i + 2]!;
      const lat1 = line[2 * i + 3]!;
      const steps = Math.max(
        1,
        Math.ceil(Math.max(Math.abs(lon1 - lon0), Math.abs(lat1 - lat0)) / MAX_STEP_DEG),
      );
      for (let k = 1; k <= steps; k++) {
        _geo.lon = lon0 + ((lon1 - lon0) * k) / steps;
        _geo.lat = lat0 + ((lat1 - lat0) * k) / steps;
        _geo.height = heightM;
        if (!prev) {
          geodeticToEcef({ lat: lat0, lon: lon0, height: heightM }, _p);
          prev = [_p.x, _p.y, _p.z];
        }
        geodeticToEcef(_geo, _p);
        arr.push(prev[0], prev[1], prev[2], _p.x, _p.y, _p.z);
        prev = [_p.x, _p.y, _p.z];
      }
    }
  }
  const out: LineChunk[] = [];
  for (const arr of groups.values()) {
    const center = new Vector3();
    const m = arr.length / 3;
    for (let i = 0; i < arr.length; i += 3) center.x += arr[i]!;
    for (let i = 1; i < arr.length; i += 3) center.y += arr[i]!;
    for (let i = 2; i < arr.length; i += 3) center.z += arr[i]!;
    center.divideScalar(m);
    const positions = new Float32Array(arr.length);
    let reach = 0;
    for (let i = 0; i < arr.length; i += 3) {
      positions[i] = arr[i]! - center.x;
      positions[i + 1] = arr[i + 1]! - center.y;
      positions[i + 2] = arr[i + 2]! - center.z;
      reach = Math.max(reach, Math.hypot(positions[i]!, positions[i + 1]!, positions[i + 2]!));
    }
    out.push({ center, positions, angle: reach / Math.max(1, center.length()) });
  }
  return out;
}

/**
 * Linien hinter dem Erdrand ausblenden: Die Linien zeichnen ohne Tiefentest (sie liegen auf dem
 * Ellipsoid und sonst im Gebirge unter dem Gelände), der Horizonttest im Shader ersetzt ihn.
 * SIMPLIFIED: Kugelnormale vom Erdmittelpunkt, Gelände verdeckt Linien nicht.
 */
function horizonLineMaterial(color: number, widthPx: number, center: Vector3): LineMaterial {
  const mat = new LineMaterial({
    color,
    linewidth: widthPx,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCenterView = { value: center };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform vec3 uCenterView;\nvarying float vHz;\nvoid main() {')
      .replace(
        'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );',
        `vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );
        vec3 hzP = position.y < 0.5 ? start.xyz : end.xyz;
        vHz = dot(normalize(hzP - uCenterView), normalize(-hzP));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying float vHz;\nvoid main() {')
      .replace(
        'float alpha = opacity;',
        'float alpha = opacity * smoothstep(-0.004, 0.02, vHz);\nif (alpha < 0.004) discard;',
      );
  };
  return mat;
}

/**
 * Politische Karte (Spielschicht Etappe 1): Länderflächen als getönte Hülle, Landgrenzen als
 * breite Linien mit dunklem Saum, das gewählte Land hervorgehoben.
 */
export class PoliticalMap {
  readonly root = new Group();
  /** Erdmittelpunkt im Kamera-Frame (für den Horizonttest der Linien). */
  private readonly centerView = new Vector3();
  private readonly fill: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly palette: DataTexture;
  private readonly idTexture: DataTexture;
  private readonly borderGlow: LineMaterial;
  private readonly borderLine: LineMaterial;
  private readonly selectLine: LineMaterial;
  private selection: Group | null = null;
  /** Grenz- und Umriss-Stücke mit ihren Linienobjekten (für die Horizont-Auslese). */
  private readonly chunks: { chunk: LineChunk; lines: LineSegments2[]; coarse: boolean }[] = [];
  private selectionChunks: { chunk: LineChunk; lines: LineSegments2[] }[] = [];
  private readonly camEcef = new Vector3();
  private selected = 0;
  private hovered = 0;
  private readonly _m = new Matrix4();

  constructor(
    private readonly parent: Object3D,
    private readonly index: CountryIndex,
  ) {
    this.root.name = 'political-map';
    // Länder-ID-Karte und Farbtabelle (256 Einträge: Index → RGBA, Alpha = Deckkraft)
    const ids = rasterizeCountries(index.countries, ID_W, ID_H);
    this.idTexture = new DataTexture(ids, ID_W, ID_H, RedFormat, UnsignedByteType);
    this.idTexture.magFilter = NearestFilter;
    this.idTexture.minFilter = NearestFilter;
    this.idTexture.wrapS = RepeatWrapping;
    this.idTexture.wrapT = ClampToEdgeWrapping;
    this.idTexture.needsUpdate = true;
    this.palette = new DataTexture(new Uint8Array(256 * 4), 256, 1, RGBAFormat, UnsignedByteType);
    this.palette.magFilter = NearestFilter;
    this.palette.minFilter = NearestFilter;
    this.refreshPalette();

    const geometry = new SphereGeometry(WGS84.a, 192, 96);
    geometry.rotateX(Math.PI / 2);
    geometry.scale(1, 1, WGS84.b / WGS84.a);
    this.fill = new Mesh(
      geometry,
      new ShaderMaterial({
        uniforms: {
          uIds: { value: this.idTexture },
          uPalette: { value: this.palette },
          uFade: { value: 1 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vN;
          void main() {
            vN = normalize(vec3(position.xy / ${(WGS84.a * WGS84.a).toExponential(6)},
                                position.z / ${(WGS84.b * WGS84.b).toExponential(6)}));
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uIds;
          uniform sampler2D uPalette;
          uniform float uFade;
          varying vec3 vN;
          void main() {
            vec3 n = normalize(vN);
            float lat = asin(clamp(n.z, -1.0, 1.0));
            float lon = atan(n.y, n.x);
            vec2 uv = vec2(lon / 6.2831853 + 0.5, lat / 3.1415927 + 0.5);
            float id = texture2D(uIds, uv).r * 255.0;
            if (id < 0.5) discard;
            vec4 c = texture2D(uPalette, vec2((id + 0.5) / 256.0, 0.5));
            float a = c.a * uFade;
            if (a < 0.004) discard;
            gl_FragColor = vec4(c.rgb, a);
          }
        `,
        side: FrontSide,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.fill.name = 'political-fill';
    this.fill.renderOrder = 8;
    this.fill.raycast = () => undefined;
    this.root.add(this.fill);

    // Landgrenzen: dunkler Saum unten, helle Linie oben
    this.borderGlow = horizonLineMaterial(0x1a1410, 4.5, this.centerView);
    this.borderGlow.opacity = 0.7;
    this.borderLine = horizonLineMaterial(0xf4e6c0, 2, this.centerView);
    this.selectLine = horizonLineMaterial(0xffd34d, 3.5, this.centerView);
    for (const coarse of [false, true]) {
      const deg = coarse ? COARSE_CHUNK_DEG : CHUNK_DEG;
      for (const chunk of buildChunks(index.borders, 0, deg)) {
        const geo = new LineSegmentsGeometry().setPositions(chunk.positions);
        const lines = [
          this.lineObject(geo, this.borderGlow, chunk, 9),
          this.lineObject(geo, this.borderLine, chunk, 10),
        ];
        this.root.add(...lines);
        this.chunks.push({ chunk, lines, coarse });
      }
    }
    parent.add(this.root);
  }

  private lineObject(
    geo: LineSegmentsGeometry,
    mat: LineMaterial,
    chunk: LineChunk,
    order: number,
  ): LineSegments2 {
    const line = new LineSegments2(geo, mat);
    line.position.copy(chunk.center);
    line.renderOrder = order;
    line.raycast = () => undefined;
    return line;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }

  /** Farbtabelle neu schreiben (Auswahl, Hover; später Besitzwechsel im Krieg). */
  private refreshPalette(): void {
    const data = this.palette.image.data as Uint8Array;
    for (const c of this.index.countries) {
      const col = REALM_COLORS[(c.colorClass - 1 + REALM_COLORS.length) % REALM_COLORS.length]!;
      const k = c.index * 4;
      const sel = c.index === this.selected;
      const hov = c.index === this.hovered;
      const boost = sel ? 1.35 : hov ? 1.18 : 1;
      data[k] = Math.min(255, col.r * 255 * boost);
      data[k + 1] = Math.min(255, col.g * 255 * boost);
      data[k + 2] = Math.min(255, col.b * 255 * boost);
      data[k + 3] = Math.round(255 * (sel ? 0.55 : hov ? 0.45 : 0.32));
    }
    this.palette.needsUpdate = true;
  }

  /** Land hervorheben (null = keins); baut den Umriss neu. */
  select(country: Country | null): void {
    const index = country?.index ?? 0;
    if (index === this.selected) return;
    this.selected = index;
    this.refreshPalette();
    if (this.selection) {
      for (const child of this.selection.children) {
        (child as LineSegments2).geometry.dispose();
      }
      this.selection.removeFromParent();
      this.selection = null;
    }
    this.selectionChunks = [];
    if (!country) return;
    this.selection = new Group();
    for (const chunk of buildChunks(country.rings)) {
      const geo = new LineSegmentsGeometry().setPositions(chunk.positions);
      const line = this.lineObject(geo, this.selectLine, chunk, 12);
      this.selection.add(line);
      this.selectionChunks.push({ chunk, lines: [line] });
    }
    this.root.add(this.selection);
  }

  hover(country: Country | null): void {
    const index = country?.index ?? 0;
    if (index === this.hovered) return;
    this.hovered = index;
    this.refreshPalette();
  }

  /** Je Frame: Horizonttest und Einblenden nach Kamerahöhe (über Ellipsoid und über Grund). */
  update(camera: Camera, heightM: number, aglM = heightM): void {
    if (!this.root.visible) return;
    this._m.multiplyMatrices(camera.matrixWorldInverse, this.parent.matrixWorld);
    this.centerView.setFromMatrixPosition(this._m);
    // Kamera im Globus-Frame (ECEF): Stücke hinter dem Horizont gar nicht erst zeichnen
    this._m.copy(this.parent.matrixWorld).invert();
    camera.getWorldPosition(this.camEcef).applyMatrix4(this._m);
    const ground = groundFade(aglM);
    const linesOn = ground > 0.004;
    const coarse = heightM > COARSE_ABOVE_M;
    for (const c of this.chunks) {
      const show = linesOn && c.coarse === coarse && chunkAboveHorizon(c.chunk, this.camEcef);
      for (const l of c.lines) l.visible = show;
    }
    for (const { chunk, lines } of this.selectionChunks) {
      const show = linesOn && chunkAboveHorizon(chunk, this.camEcef);
      for (const l of lines) l.visible = show;
    }
    const fade = fillFade(heightM);
    this.fill.material.uniforms.uFade!.value = fade;
    this.fill.visible = fade > 0.001;
    const lines = borderFade(heightM) * ground;
    this.borderLine.opacity = lines;
    this.borderGlow.opacity = 0.7 * lines;
    this.selectLine.opacity = ground;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      if (o instanceof LineSegments2) o.geometry.dispose();
    });
    this.fill.geometry.dispose();
    this.fill.material.dispose();
    this.idTexture.dispose();
    this.palette.dispose();
    this.borderGlow.dispose();
    this.borderLine.dispose();
    this.selectLine.dispose();
  }
}
