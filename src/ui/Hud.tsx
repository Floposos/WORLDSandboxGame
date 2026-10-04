import { Stats } from './Stats';

/** HUD oben rechts. Ortsname, Koordinaten und Zähler folgen ab M1/M2. */
export function Hud() {
  return (
    <div class="hud">
      <Stats />
    </div>
  );
}
