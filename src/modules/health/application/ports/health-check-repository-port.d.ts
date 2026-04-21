export interface HealthCheckRepositoryPort {
  ping(): Promise<void>;
}

