import { Attribution } from './Attribution';
import { Hud } from './Hud';
import { ModeBar } from './ModeBar';
import { Search } from './Search';
import { SettingsDialog } from './SettingsDialog';
import { Toasts } from './Toasts';
import { ToolParams } from './ToolParams';
import { Toolbar } from './Toolbar';

/** Wurzel des HTML-Overlays über dem WebGL-Canvas. */
export function App() {
  return (
    <>
      <Search />
      <Hud />
      <ModeBar />
      <Toolbar />
      <ToolParams />
      <SettingsDialog />
      <Toasts />
      <Attribution />
    </>
  );
}
