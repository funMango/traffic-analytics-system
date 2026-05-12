export interface TrafficRepositoryPort {
  findDailyTraffic(nodeId: string, dateStr: string, rangeEnd: Date): Promise<unknown[]>;
  findWeeklyTraffic(nodeId: string, rangeStart: Date, rangeEnd: Date): Promise<unknown[]>;
  findLatestTraffic(nodeId: string): Promise<unknown[]>;
  findMonthlyTraffic(nodeId: string, rangeStart: Date, rangeEnd: Date): Promise<unknown[]>;
  findYearlyTraffic(nodeId: string, rangeStart: Date, rangeEnd: Date): Promise<unknown[]>;
  findApproaches(nodeId: string): Promise<unknown[]>;
  findApproachDailyTraffic(nodeId: string, dateStr: string, rangeEnd: Date): Promise<unknown[]>;
  findApproachWeeklyTraffic(nodeId: string, rangeStart: Date, rangeEnd: Date): Promise<unknown[]>;
  findApproachMonthlyTraffic(nodeId: string, rangeStart: Date, rangeEnd: Date): Promise<unknown[]>;
  findApproachYearlyTraffic(nodeId: string, rangeStart: Date, rangeEnd: Date): Promise<unknown[]>;
  findDirectionDailyTraffic(nodeId: string, acsrId: string, dateStr: string, rangeEnd: Date): Promise<unknown[]>;
  findDirectionWeeklyTraffic(nodeId: string, acsrId: string, rangeStart: Date, rangeEnd: Date): Promise<unknown[]>;
  findDirectionMonthlyTraffic(nodeId: string, acsrId: string, rangeStart: Date, rangeEnd: Date): Promise<unknown[]>;
  findDirectionYearlyTraffic(nodeId: string, acsrId: string, rangeStart: Date, rangeEnd: Date): Promise<unknown[]>;
}
