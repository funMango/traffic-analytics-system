export interface TrafficStatusProviderPort {
  getCurrent5MinTarget(): Date | null;
  getCurrent15MinTarget(): Date | null;
  getCurrentHourlyTarget(): Date | null;
  getCurrentDailyTarget(): Date | null;
  getDailyNullSlots(dateStr: string): string[];
  getWeeklyNullSlots(dateStr: string): string[];
  getMonthlyNullSlots(month: string): Record<string, string[]>;
  getYearlyNullSlots(year: string): string[];
}

