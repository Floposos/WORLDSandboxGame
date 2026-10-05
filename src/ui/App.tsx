import { ApocalypseHint } from './ApocalypseHint';
import { Attribution } from './Attribution';
import { Cinematic, ResetButton } from './Cinematic';
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
      <ResetButton />
      <Cinematic />
      <ApocalypseHint />
      <Toasts />
      <Attribution />
    </>
  );
}
