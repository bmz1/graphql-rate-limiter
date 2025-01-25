// test/rateLimiter.test.ts
import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import Redis from 'ioredis';
import { RateLimiter } from '../src/rate-limiter';
import { disconnectRedis } from '../src/redis-client';
import { Plan } from '../src/types';

const redis = new Redis();
const limiter = new RateLimiter(redis);

// Helper for precise delays
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

beforeEach(async () => {
  await redis.flushall();
});

afterAll(async () => {
  await disconnectRedis();
});

describe('RateLimiter', () => {
  test('should handle rate limit depletion and restoration', async () => {
    const startTime = Date.now();

    // Initial depleted state
    await limiter.updateThrottleStatus(
      'store1',
      {
        maximumAvailable: 1000,
        currentlyAvailable: 0,
        restoreRate: 100,
      },
      Plan.STANDARD,
      startTime,
    );

    // Immediate check
    const initialCheck = await limiter.checkRateLimit('store1', Plan.STANDARD, startTime);
    expect(initialCheck).toEqual({
      allowed: false,
      remainingPoints: 0,
      maxCapacity: 1000,
      retryAfter: 10000,
      restoreTimeMs: 10000,
    });

    // Wait 5 seconds
    await delay(5000);
    const after5s = startTime + 5000;

    const checkAfter5s = await limiter.checkRateLimit('store1', Plan.STANDARD, after5s);
    expect(checkAfter5s).toMatchObject({
      allowed: true,
      retryAfter: undefined,
      restoreTimeMs: 5000,
    });

    // Wait another 5 seconds (total 10s)
    await delay(5000);
    const after10s = startTime + 10000;

    const checkAfter10s = await limiter.checkRateLimit('store1', Plan.STANDARD, after10s);
    expect(checkAfter10s).toEqual({
      allowed: true,
      remainingPoints: 1000,
      maxCapacity: 1000,
      restoreTimeMs: 0,
    });
  });

  test('should handle partial restoration', async () => {
    const startTime = Date.now();

    await limiter.updateThrottleStatus(
      'store1',
      {
        maximumAvailable: 1000,
        currentlyAvailable: 300,
        restoreRate: 100,
      },
      Plan.STANDARD,
      startTime,
    );

    // Check initial state
    const initialCheck = await limiter.checkRateLimit('store1', Plan.STANDARD, startTime);
    expect(initialCheck.restoreTimeMs).toBe(7000);

    // Wait 2 seconds
    await delay(2000);
    const after2s = startTime + 2000;

    const checkAfter2s = await limiter.checkRateLimit('store1', Plan.STANDARD, after2s);
    expect(checkAfter2s).toMatchObject({
      remainingPoints: 500, // 300 + (100 * 2)
      restoreTimeMs: 5000, // 7000 - 2000
    });
  });

  test('should handle multiple stores independently', async () => {
    const time = Date.now();

    // Store 1 setup
    await limiter.updateThrottleStatus(
      'store1',
      {
        maximumAvailable: 1000,
        currentlyAvailable: 0,
        restoreRate: 100,
      },
      Plan.STANDARD,
      time,
    );

    // Store 2 setup
    await limiter.updateThrottleStatus(
      'store2',
      {
        maximumAvailable: 2000,
        currentlyAvailable: 2000,
        restoreRate: 200,
      },
      Plan.ADVANCED,
      time,
    );

    const checkStore1 = await limiter.checkRateLimit('store1', Plan.STANDARD, time);
    const checkStore2 = await limiter.checkRateLimit('store2', Plan.ADVANCED, time);

    expect(checkStore1.allowed).toBe(false);
    expect(checkStore2.allowed).toBe(true);
  });

  test('should handle concurrent access', async () => {
    const initialTimestamp = Date.now();

    await limiter.updateThrottleStatus(
      'concurrent-store',
      {
        maximumAvailable: 1000,
        currentlyAvailable: 1000,
        restoreRate: 100,
      },
      Plan.STANDARD,
    );

    // Simulate 5 concurrent requests
    const checks = await Promise.all(
      Array(5)
        .fill(0)
        .map(() => limiter.checkRateLimit('concurrent-store', Plan.STANDARD, initialTimestamp)),
    );

    // All should be allowed initially
    checks.forEach(check => {
      expect(check.allowed).toBe(true);
    });

    // Verify final state
    const finalCheck = await limiter.checkRateLimit('concurrent-store', Plan.STANDARD);
    expect(finalCheck.remainingPoints).toBeCloseTo(1000, 0);
  });
});
