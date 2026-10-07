const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function monthKey(value: string): string {
  if (!MONTH_PATTERN.test(value)) throw new Error('月份必须使用 YYYY-MM 格式');
  return value;
}

export function monthKeyAt(at = new Date()): string {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).formatToParts(at);
  return `${parts.find(part=>part.type==='year')?.value}-${parts.find(part=>part.type==='month')?.value}`;
}

export function monthDeadline(month: string): string {
  monthKey(month);
  const [year, value] = month.split('-').map(Number);
  // First instant of the next Shanghai month, minus one millisecond.
  const nextMonthUtc = Date.UTC(value === 12 ? year + 1 : year, value === 12 ? 0 : value, 1) - SHANGHAI_OFFSET_MS;
  return new Date(nextMonthUtc - 1).toISOString();
}

export function monthStart(month: string): string {
  monthKey(month);
  const [year, value] = month.split('-').map(Number);
  return new Date(Date.UTC(year, value - 1, 1) - SHANGHAI_OFFSET_MS).toISOString();
}
