import { MeshLambertMaterial } from 'three';

/** Geschosshöhe und Fensterraster der Fassaden in m. */
export const FACADE_FLOOR_M = 3.2;
export const FACADE_BAY_M = 3;

/**
 * Material der extrudierten Gebäude: Lambert mit Vertexfarben (Fassade/Dach) und einem
 * prozeduralen Fensterraster aus den Fassadenkoordinaten (Attribut `facade`: u entlang der
 * Wand, v Höhe in m; Dächer haben v < 0). Spart einen Textur-Atlas (Spec 5.4 „optional“).
 * Das Raster blendet mit der Entfernung aus (fwidth), damit es nicht flimmert.
 */
export function createBuildingMaterial(): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 facade;\nvarying vec2 vFacade;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = facade;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFacade;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (vFacade.y > 0.6) {
          vec2 cell = vec2(vFacade.x / ${FACADE_BAY_M.toFixed(1)}, vFacade.y / ${FACADE_FLOOR_M.toFixed(1)});
          vec2 f = fract(cell);
          float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.32, f.y) * step(f.y, 0.82);
          vec2 w = fwidth(cell);
          float fade = clamp(1.0 - max(w.x, w.y) * 1.6, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.32 + vec3(0.02, 0.03, 0.05), win * fade * 0.8);
          diffuseColor.rgb *= mix(1.0, 0.9, (1.0 - fade) * 0.5);
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'globebox-buildings-v1';
  return mat;
}
