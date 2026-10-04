import { Attribution } from './Attribution';
import { Hud } from './Hud';
import { Toasts } from './Toasts';

/** Wurzel des HTML-Overlays über dem WebGL-Canvas. */
export function App() {
  return (
    <>
      <Hud />
      <Toasts />
      <Attribution />
    </>
  );
}
