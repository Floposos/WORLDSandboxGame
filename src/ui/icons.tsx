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
