import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import Redis from 'ioredis';
import { RateLimiter } from '../src/rate-limiter';
import { ThrottleStatus } from '../src/types';

describe('RateLimiter', () => {
  let client: Redis;
  let limiter: RateLimiter;

  beforeEach(async () => {
    client = new Redis();
    limiter = new RateLimiter(client);
    await client.flushdb();
  });

  afterEach(async () => {
    await client.quit();
  });

  test('initial check allows with default cost', async () => {
    await limiter.updateThrottleStatus('store1', {
      maximumAvailable: 1000,
      restoreRate: 100,
      currentlyAvailable: 1000,
    });
    const result = await limiter.checkRateLimit('store1');
    expect(result).toEqual({
      allowed: true,
      remainingPoints: 990, // 1000 - default cost of 10
      maxCapacity: 1000,
      retryAfter: undefined,
      restoreTimeMs: expect.any(Number),
    });
  });

  test('initial check with custom cost', async () => {
    await limiter.updateThrottleStatus('store1', {
      maximumAvailable: 1000,
      restoreRate: 100,
      currentlyAvailable: 1000,
    });
    const result = await limiter.checkRateLimit('store1', 50);
    expect(result).toEqual({
      allowed: true,
      remainingPoints: 950, // 1000 - cost of 50
      maxCapacity: 1000,
      retryAfter: undefined,
      restoreTimeMs: expect.any(Number),
    });
  });

  test('updates and reflects new throttle status with different costs', async () => {
    const status: ThrottleStatus = {
      maximumAvailable: 500,
      restoreRate: 50,
      currentlyAvailable: 250,
    };

    await limiter.updateThrottleStatus('store1', status);

    const result1 = await limiter.checkRateLimit('store1', 20);
    expect(result1.remainingPoints).toBe(230); // 250 - 20
    expect(result1.maxCapacity).toBe(500);
    expect(result1.allowed).toBe(true);

    const result2 = await limiter.checkRateLimit('store1', 250);
    expect(result2.allowed).toBe(false);
    expect(result2.retryAfter).toBeGreaterThan(0);
  });

  test('handles multiple stores independently with different costs', async () => {
    const store1Status: ThrottleStatus = {
      maximumAvailable: 200,
      restoreRate: 10,
      currentlyAvailable: 150,
    };

    const store2Status: ThrottleStatus = {
      maximumAvailable: 300,
      restoreRate: 15,
      currentlyAvailable: 200,
    };

    await Promise.all([
      limiter.updateThrottleStatus('store1', store1Status),
      limiter.updateThrottleStatus('store2', store2Status),
    ]);

    const [result1, result2] = await Promise.all([
      limiter.checkRateLimit('store1', 30),
      limiter.checkRateLimit('store2', 50),
    ]);

    expect(result1.remainingPoints).toBe(120); // 150 - 30
    expect(result2.remainingPoints).toBe(150); // 200 - 50
  });

  test.concurrent('handles concurrent updates for different stores with varying costs', async () => {
    const stores = Array.from({ length: 10 }, (_, i) => `store${i}`);
    const statuses = stores.map((_, i) => ({
      maximumAvailable: 100 * (i + 1),
      restoreRate: 10 * (i + 1),
      currentlyAvailable: 50 * (i + 1),
    }));

    await Promise.all(stores.map((store, i) => limiter.updateThrottleStatus(store, statuses[i])));

    const results = await Promise.all(stores.map((store, i) => limiter.checkRateLimit(store, 10 * (i + 1))));

    results.forEach((result, i) => {
      const expectedRemaining = 50 * (i + 1) - 10 * (i + 1);
      expect(result.remainingPoints).toBe(expectedRemaining);
      expect(result.maxCapacity).toBe(100 * (i + 1));
    });
  });

  test('restores points correctly over time with varying costs', async () => {
    const now = Date.now();
    const initialStatus: ThrottleStatus = {
      maximumAvailable: 1000,
      restoreRate: 500, // 500 points per second
      currentlyAvailable: 200,
    };

    await limiter.updateThrottleStatus('store1', initialStatus, now);

    const firstCheck = await limiter.checkRateLimit('store1', 50, now);
    expect(firstCheck.remainingPoints).toBe(150); // 200 - 50

    // Simulate 2 seconds passing
    const futureTimestamp = now + 2000;
    const futureCheck = await limiter.checkRateLimit('store1', 100, futureTimestamp);

    // Initial: 150
    // Restored points: 150 + (500 * 2000 / 1000) = 150 + 1000 = 1150
    // Clamped to maximumAvailable: 1000
    // After cost of 100: 900
    expect(futureCheck.remainingPoints).toBe(900);
  });

  test.concurrent('handles burst of concurrent requests with different costs', async () => {
    const storeId = 'burst-store';
    const initialStatus: ThrottleStatus = {
      maximumAvailable: 1000,
      restoreRate: 10,
      currentlyAvailable: 1000,
    };

    await limiter.updateThrottleStatus(storeId, initialStatus);

    // Simulate 50 concurrent requests with increasing costs
    const requests = Array(50)
      .fill(0)
      .map(async (_, i) => {
        const cost = Math.min(50 + i, 100); // Costs from 50 to 100
        const result = await limiter.checkRateLimit(storeId, cost);
        return { result, cost };
      });

    const results = await Promise.all(requests);
    const allowedRequests = results.filter(r => r.result.allowed);

    // Verify that requests were throttled based on costs
    expect(allowedRequests.length).toBeGreaterThan(0);
    expect(allowedRequests.length).toBeLessThan(50);

    // Verify total consumed points doesn't exceed initial capacity
    const totalConsumed = allowedRequests.reduce((sum, { cost }) => sum + cost, 0);
    expect(totalConsumed).toBeLessThanOrEqual(initialStatus.maximumAvailable);
  });

  test('handles high cost requests correctly', async () => {
    const now = Date.now();
    const status: ThrottleStatus = {
      maximumAvailable: 1000,
      restoreRate: 100,
      currentlyAvailable: 500,
    };

    await limiter.updateThrottleStatus('store1', status, now);

    // Test with cost higher than current but lower than max
    const result1 = await limiter.checkRateLimit('store1', 600, now);
    expect(result1.allowed).toBe(false);
    expect(result1.retryAfter).toBeGreaterThan(0);

    // Test with cost higher than max
    const result2 = await limiter.checkRateLimit('store1', 1200, now);
    expect(result2.allowed).toBe(false);
    expect(result2.retryAfter).toBeGreaterThan(0);
  });
});
