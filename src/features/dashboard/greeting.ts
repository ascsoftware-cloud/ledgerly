/** Time-of-day greeting in South African time, wherever the server runs. */
export function greeting(now: Date = new Date()): string {
  const hour = (now.getUTCHours() + 2) % 24;
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}
