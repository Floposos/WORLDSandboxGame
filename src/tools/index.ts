import { createEraserTool } from './tier0/eraser';
import { createPlaceBallTool } from './tier0/placeBall';
import { createPlaceBoxTool } from './tier0/placeBox';
import { createPlaceCarTool } from './tier0/placeCar';
import { createPlaceNpcsTool } from './tier0/placeNpcs';
import { createPlaceWallTool } from './tier0/placeWall';
import { createForcePushTool } from './tier2/forcePush';
import { createMagnetTool } from './tier2/magnet';
import { createThrowTool } from './tier2/throw';
import { createWreckingBallTool } from './tier2/wreckingBall';
import { ToolRegistry } from './Tool';

/** Alle Werkzeuge in Anzeigereihenfolge (M3: Stufe 0 und 2). */
export function createDefaultRegistry(): ToolRegistry {
  const r = new ToolRegistry();
  for (const tool of [
    createPlaceBoxTool(),
    createPlaceBallTool(),
    createPlaceCarTool(),
    createPlaceNpcsTool(),
    createPlaceWallTool(),
    createEraserTool(),
    createThrowTool(),
    createWreckingBallTool(),
    createForcePushTool(),
    createMagnetTool(),
  ]) {
    r.register(tool);
  }
  return r;
}
