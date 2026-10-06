import { store } from '../core/store';
import { ApocalypseHint } from './ApocalypseHint';
import { CountryLabels, CountryPanel, MapToggle } from './GameUi';
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
  // Während einer filmischen Sequenz ruhen Suche, Kameramodi und Werkzeuge
  const cinematic = store.cinematic.value !== null;
  return (
    <>
      {!cinematic && <CountryLabels />}
      {!cinematic && <Search />}
      <Hud />
      {!cinematic && <ModeBar />}
      {!cinematic && <Toolbar />}
      {!cinematic && <ToolParams />}
      <SettingsDialog />
      {!cinematic && <ResetButton />}
      {!cinematic && <MapToggle />}
      {!cinematic && <CountryPanel />}
      <Cinematic />
      <ApocalypseHint />
      <Toasts />
      <Attribution />
    </>
  );
}
