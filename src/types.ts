export enum Plan {
  STANDARD = 'STANDARD',
  ADVANCED = 'ADVANCED',
  PLUS = 'PLUS',
  ENTERPRISE = 'ENTERPRISE',
}

export interface ThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remainingPoints: number;
  maxCapacity: number;
  retryAfter?: number; // Milliseconds until next allowed request
  restoreTimeMs: number; // Milliseconds until full restoration
}

export interface RateLimitConfig {
  maximumAvailable: number;
  restoreRate: number;
}
