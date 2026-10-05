/** Lokale SVG-Icons der Werkzeuge (kein Icon-Font, keine externen Dateien). */
const PATHS: Record<string, string> = {
  box: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  ball: 'M12 3a9 9 0 100 18 9 9 0 000-18zM5 9c4 2 10 2 14 0M5 15c4-2 10-2 14 0',
  car: 'M3 15v-3l2-5h14l2 5v3zM6 15v2M18 15v2M7 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM5 11h14',
  people:
    'M8 7a2 2 0 100-4 2 2 0 000 4zM16 7a2 2 0 100-4 2 2 0 000 4zM5 21v-8l3-3 3 3v8M13 21v-8l3-3 3 3v8',
  wall: 'M3 5h18v14H3zM3 9.7h18M3 14.3h18M9 5v4.7M15 5v4.7M6 9.7v4.6M12 9.7v4.6M18 9.7v4.6M9 14.3V19M15 14.3V19',
  eraser: 'M14 4l6 6-9 9H6l-3-3zM9 9l6 6M11 19h10',
  throw: 'M4 20c3-8 8-13 16-16M14 4h6v6M6 14a2 2 0 100-4 2 2 0 000 4z',
  wrecking: 'M4 3h16M12 3v9M12 12a4 4 0 100 8 4 4 0 000-8z',
  push: 'M3 12h7M10 6l8 6-8 6M14 5l7 7-7 7',
  magnet: 'M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4zM6 8h4M14 8h4',
  grenade: 'M12 21a6 6 0 100-12 6 6 0 000 12zM10 9V6h4v3M14 6l3-2M9 13v4M12 12v6M15 13v4',
  bomb: 'M12 2v3M9 5h6l1 3v7a4 4 0 01-8 0V8zM9 21l3-2 3 2M10 2h4',
  charge: 'M4 9h12v8H4zM7 9V7M13 9V7M16 13h3l2-3M19 10l1-3M8 13h4',
  rocket: 'M14 4l6 0 0 6-8 8-4-4zM8 14l-4 1 3-5M10 16l-1 4 5-3M4 20l3-3',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  cloud: 'M7 18h10a4 4 0 00.5-8A6 6 0 006 9.5 4.3 4.3 0 007 18zM9 21l1-2M13 21l1-2',
  water:
    'M3 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0M12 3l3 5a3 3 0 11-6 0z',
  gravity: 'M12 3v12M8 11l4 4 4-4M5 20h14M8 17h8',
  meteor: 'M15 15a4 4 0 100-8 4 4 0 000 8zM12 9L4 3M11 13l-8-3M13 8L9 2',
  tornado: 'M3 4h18M5 8h14M7 12h10M9 16h6M11 20h2',
  quake: 'M2 12h4l2-5 3 10 3-12 3 9 2-2h3M4 20h16',
  volcano: 'M3 20l6-10h6l6 10zM9 10l1-2h4l1 2M12 6V3M9 5L7 3M15 5l2-2',
  tsunami: 'M2 18c3 0 4-9 10-11 3-1 6 1 6 4-2-1-4 0-4 2 0 3 3 5 8 5M2 21h20',
  nuke: 'M12 21v-7M9 21h6M7 9a5 4 0 0110 0c0 2-2 3-5 3S7 11 7 9zM6 14h12',
  asteroid: 'M14 14a5 5 0 100-10 5 5 0 000 10zM10 12l-7 9M12 14l-5 7M9 9L3 15M13 7l1 1M16 10l1-1',
  moon: 'M15 3a9 9 0 108 12A7 7 0 0115 3zM9 10a1 1 0 100-2 1 1 0 000 2zM12 16a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
};

export function ToolIcon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? PATHS.box} />
    </svg>
  );
}
