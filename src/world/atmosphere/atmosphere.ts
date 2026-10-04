import {
  AdditiveBlending,
  BackSide,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { WGS84 } from '../../core/constants';

/**
 * Atmosphären-Schimmer am Globusrand: Fresnel-Glühen auf einer leicht größeren
 * Ellipsoid-Hülle, auf der Nachtseite abgedunkelt.
 * SIMPLIFIED: kein physikalisches Rayleigh-Scattering, nur ein Rayleigh-ähnlicher Farbverlauf.
 */
export class Atmosphere {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  /** Richtung zur Sonne im Welt-Frame (normiert). */
  readonly sunDirection = new Vector3(1, 0, 0);

  constructor(parent: Object3D) {
    const thickness = 1.025;
    const geometry = new SphereGeometry(WGS84.a * thickness, 96, 48);
    // Ellipsoid: Z-Achse (Pol) im ECEF-Frame stauchen. SphereGeometry ist Y-up, daher erst drehen.
    geometry.rotateX(Math.PI / 2);
    geometry.scale(1, 1, WGS84.b / WGS84.a);

    const material = new ShaderMaterial({
      uniforms: {
        uSunDir: { value: this.sunDirection },
        uColorDay: { value: new Vector3(0.35, 0.6, 1.0) },
        uColorSunset: { value: new Vector3(1.0, 0.55, 0.3) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormalW;
        varying vec3 vPosW;
        void main() {
          vec4 posW = modelMatrix * vec4(position, 1.0);
          vPosW = posW.xyz;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * posW;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform vec3 uColorDay;
        uniform vec3 uColorSunset;
        varying vec3 vNormalW;
        varying vec3 vPosW;
        void main() {
          vec3 viewDir = normalize(cameraPosition - vPosW);
          // Rückseite: Normale zeigt vom Betrachter weg
          float rim = 1.0 - abs(dot(viewDir, -vNormalW));
          float glow = pow(clamp(rim, 0.0, 1.0), 3.0);
          float sun = dot(normalize(vNormalW), uSunDir);
          float day = smoothstep(-0.25, 0.35, sun);
          float sunset = smoothstep(-0.25, 0.05, sun) * (1.0 - smoothstep(0.05, 0.4, sun));
          vec3 color = mix(uColorDay, uColorSunset, sunset * 0.7);
          gl_FragColor = vec4(color, glow * (0.08 + 0.92 * day));
        }
      `,
      side: BackSide,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });

    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'atmosphere';
    // Kein Ziel für Raycasts (Kamera-Steuerung, Werkzeuge).
    this.mesh.raycast = () => undefined;
    this.mesh.renderOrder = 10;
    parent.add(this.mesh);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
