import { createEraserTool } from './tier0/eraser';
import { createPlaceBallTool } from './tier0/placeBall';
import { createPlaceBoxTool } from './tier0/placeBox';
import { createPlaceCarTool } from './tier0/placeCar';
import { createPlaceNpcsTool } from './tier0/placeNpcs';
import { createPlaceWallTool } from './tier0/placeWall';
import { createFloodTool } from './tier1/flood';
import { createGravityTool } from './tier1/gravity';
import { createTimeOfDayTool } from './tier1/timeOfDay';
import { createWeatherTool } from './tier1/weather';
import { createForcePushTool } from './tier2/forcePush';
import { createMagnetTool } from './tier2/magnet';
import { createThrowTool } from './tier2/throw';
import { createWreckingBallTool } from './tier2/wreckingBall';
import { createAerialBombTool } from './tier3/aerialBomb';
import { createDemolitionChargeTool } from './tier3/demolitionCharge';
import { createGrenadeTool } from './tier3/grenade';
import { createRocketTool } from './tier3/rocket';
import { createEarthquakeTool } from './tier4/earthquake';
import { createMeteorTool } from './tier4/meteor';
import { createTornadoTool } from './tier4/tornado';
import { createTsunamiTool } from './tier4/tsunami';
import { createVolcanoTool } from './tier4/volcano';
import { createAsteroidTool, createMegaBombTool, createMoonDropTool } from './tier5';
import { ToolRegistry } from './Tool';

/** Alle Werkzeuge in Anzeigereihenfolge (M6: Stufe 0 bis 5). */
export function createDefaultRegistry(): ToolRegistry {
  const r = new ToolRegistry();
  for (const tool of [
    createPlaceBoxTool(),
    createPlaceBallTool(),
    createPlaceCarTool(),
    createPlaceNpcsTool(),
    createPlaceWallTool(),
    createEraserTool(),
    createTimeOfDayTool(),
    createWeatherTool(),
    createFloodTool(),
    createGravityTool(),
    createThrowTool(),
    createWreckingBallTool(),
    createForcePushTool(),
    createMagnetTool(),
    createGrenadeTool(),
    createAerialBombTool(),
    createDemolitionChargeTool(),
    createRocketTool(),
    createMeteorTool(),
    createTornadoTool(),
    createEarthquakeTool(),
    createVolcanoTool(),
    createTsunamiTool(),
    createMegaBombTool(),
    createAsteroidTool(),
    createMoonDropTool(),
  ]) {
    r.register(tool);
  }
  return r;
}
