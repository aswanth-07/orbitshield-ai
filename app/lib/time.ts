export const IST_TIME_ZONE = 'Asia/Kolkata';

export function advanceSimulationTime(currentTime: number, elapsedRealMs: number, speed: number) {
  if (!Number.isFinite(currentTime) || !Number.isFinite(elapsedRealMs) || !Number.isFinite(speed)) return currentTime;
  return currentTime + Math.max(0, elapsedRealMs) * Math.max(0, speed);
}

export function formatIst(
  value: string | number | Date | null | undefined,
  options: { seconds?: boolean; year?: boolean } = {},
) {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);

  const formatted = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: options.year ? 'numeric' : undefined,
    hour: '2-digit',
    minute: '2-digit',
    second: options.seconds ? '2-digit' : undefined,
    hour12: false,
    timeZone: IST_TIME_ZONE,
  }).format(date);

  return `${formatted} IST`;
}
