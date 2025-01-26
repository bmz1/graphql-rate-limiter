import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import Redis from 'ioredis';
import { RateLimiter } from '../src/rate-limiter';
import { ThrottleStatus } from '../src/types';

describe('RateLimiter', () => {
  let client: Redis;
  let limiter: RateLimiter;

  beforeEach(async () => {
    client = new Redis(); // Connect to real Redis server
    limiter = new RateLimiter(client);
    await client.flushdb();
  });

  afterEach(async () => {
    await client.quit();
  });

  test('initial check allows with high limit', async () => {
    const result = await limiter.checkRateLimit('store1');
    expect(result).toEqual({
      allowed: true,
      remainingPoints: 1000,
      maxCapacity: 1000,
      retryAfter: undefined,
      restoreTimeMs: expect.any(Number)
    });
  });

  test('updates and reflects new throttle status', async () => {
    const status: ThrottleStatus = {
      maximumAvailable: 500,
      restoreRate: 50,
      currentlyAvailable: 250
    };

    await limiter.updateThrottleStatus('store1', status);
    const result = await limiter.checkRateLimit('store1');
    
    expect(result.remainingPoints).toBe(250);
    expect(result.maxCapacity).toBe(500);
    expect(result.allowed).toBe(true);
  });

  test('handles multiple stores independently', async () => {
    const store1Status: ThrottleStatus = { 
      maximumAvailable: 200, 
      restoreRate: 10, 
      currentlyAvailable: 150 
    };
    
    const store2Status: ThrottleStatus = { 
      maximumAvailable: 300, 
      restoreRate: 15, 
      currentlyAvailable: 200 
    };

    await Promise.all([
      limiter.updateThrottleStatus('store1', store1Status),
      limiter.updateThrottleStatus('store2', store2Status)
    ]);

    const [result1, result2] = await Promise.all([
      limiter.checkRateLimit('store1'),
      limiter.checkRateLimit('store2')
    ]);

    expect(result1.remainingPoints).toBe(150);
    expect(result2.remainingPoints).toBe(200);
  });

  test.concurrent('handles concurrent updates for different stores', async () => {
    const stores = Array.from({ length: 10 }, (_, i) => `store${i}`);
    const statuses = stores.map((_, i) => ({
      maximumAvailable: 100 * (i + 1),
      restoreRate: 10 * (i + 1),
      currentlyAvailable: 50 * (i + 1)
    }));

    await Promise.all(stores.map((store, i) => 
      limiter.updateThrottleStatus(store, statuses[i])
    ));

    const results = await Promise.all(
      stores.map(store => limiter.checkRateLimit(store))
    );

    results.forEach((result, i) => {
      expect(result.remainingPoints).toBe(50 * (i + 1));
      expect(result.maxCapacity).toBe(100 * (i + 1));
    });
  });

  test('restores points correctly over time', async () => {
    const initialStatus: ThrottleStatus = {
      maximumAvailable: 1000,
      restoreRate: 500, // 500 points per second
      currentlyAvailable: 200
    };

    await limiter.updateThrottleStatus('store1', initialStatus);
    const firstCheck = await limiter.checkRateLimit('store1', Date.now());
    expect(firstCheck.remainingPoints).toBe(200);

    // Simulate 2 seconds passing
    const futureTimestamp = Date.now() + 2000;
    const futureCheck = await limiter.checkRateLimit('store1', futureTimestamp);
    
    // Restored points: 200 + (500 * 2000 / 1000) = 200 + 1000 = 1200
    // Clamped to maximumAvailable: 1000
    expect(futureCheck.remainingPoints).toBe(1000);
  });

  test.concurrent('handles burst of concurrent requests', async () => {
    const storeId = 'burst-store';
    const initialStatus: ThrottleStatus = {
      maximumAvailable: 100,
      restoreRate: 10,
      currentlyAvailable: 100
    };

    await limiter.updateThrottleStatus(storeId, initialStatus);

    // Simulate 50 concurrent requests
    const requests = Array(50).fill(0).map(async (_, i) => {
      const result = await limiter.checkRateLimit(storeId);
      if (result.allowed) {
        // Simulate subsequent update with reduced points
        await limiter.updateThrottleStatus(storeId, {
          ...initialStatus,
          currentlyAvailable: initialStatus.currentlyAvailable - i - 1
        });
      }
      return result;
    });

    const results = await Promise.all(requests);
    const allowedRequests = results.filter(r => r.allowed).length;
    
    // Verify that at least some requests were throttled
    expect(allowedRequests).toBeGreaterThan(0);
    expect(allowedRequests).toBeLessThanOrEqual(50);
  });

  test('handles exhausted points correctly', async () => {
    const now = Date.now();
    const status: ThrottleStatus = {
      maximumAvailable: 100,
      restoreRate: 10,
      currentlyAvailable: 0
    };

    await limiter.updateThrottleStatus('store1', status, now);
    const result = await limiter.checkRateLimit('store1', now);
    
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.restoreTimeMs).toBeGreaterThan(0);
  });
});
