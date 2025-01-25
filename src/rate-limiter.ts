import { Redis } from 'ioredis';
import { Plan, RateLimitConfig, RateLimitResult, ThrottleStatus } from './types';

const PLAN_LIMITS: Record<Plan, RateLimitConfig> = {
  [Plan.STANDARD]: { maximumAvailable: 1000, restoreRate: 100 },
  [Plan.ADVANCED]: { maximumAvailable: 2000, restoreRate: 200 },
  [Plan.PLUS]: { maximumAvailable: 5000, restoreRate: 1000 },
  [Plan.ENTERPRISE]: { maximumAvailable: 10000, restoreRate: 2000 },
};

const LUA_CHECK_SCRIPT = `
local key = KEYS[1]
local currentTimestamp = tonumber(ARGV[1])
local planMax = tonumber(ARGV[2])
local planRate = tonumber(ARGV[3])

local exists = redis.call("EXISTS", key)
if exists == 0 then
    return {1, planMax, planMax, 0, 0} -- allowed, remaining, max, retryAfter, restoreTime
end

local data = redis.call("HMGET", key,
    "maximumAvailable",
    "currentlyAvailable",
    "restoreRate",
    "lastUpdated")

local storedMax = tonumber(data[1])
local storedCurrent = tonumber(data[2])
local storedRate = tonumber(data[3])
local lastUpdated = tonumber(data[4])

local effectiveMax = math.min(storedMax, planMax)
local effectiveRate = math.min(storedRate, planRate)

local elapsed = math.max(currentTimestamp - lastUpdated, 0)
local restored = (elapsed * effectiveRate) / 1000
local newAvailable = math.min(storedCurrent + restored, effectiveMax)

local deficit = effectiveMax - newAvailable
local restoreTimeMs = (deficit / effectiveRate) * 1000

if newAvailable > 0 then
    return {1, newAvailable, effectiveMax, 0, restoreTimeMs}
else
    return {0, 0, effectiveMax, restoreTimeMs, restoreTimeMs}
end
`;

const LUA_UPDATE_SCRIPT = `
local key = KEYS[1]
local currentTimestamp = tonumber(ARGV[1])
local throttleMax = tonumber(ARGV[2])
local throttleRate = tonumber(ARGV[3])
local planMax = tonumber(ARGV[4])
local planRate = tonumber(ARGV[5])
local throttleCurrent = tonumber(ARGV[6])

-- Calculate effective limits
local effectiveMax = math.min(throttleMax, planMax)
local effectiveRate = math.min(throttleRate, planRate)

-- Update with Shopify's actual state
redis.call("HMSET", key,
    "maximumAvailable", effectiveMax,
    "currentlyAvailable", math.min(throttleCurrent, effectiveMax),
    "restoreRate", effectiveRate,
    "lastUpdated", currentTimestamp)
`;

export class RateLimiter {
  private client: Redis;

  constructor(client: Redis) {
    this.client = client;
  }

  async checkRateLimit(storeId: string, plan: Plan, now: number = Date.now()): Promise<RateLimitResult> {
    const key = `shopify:rateLimit:${storeId}`;
    const planConfig = PLAN_LIMITS[plan];

    const result = (await this.client.eval(
      LUA_CHECK_SCRIPT,
      1,
      key,
      now.toString(),
      planConfig.maximumAvailable.toString(),
      planConfig.restoreRate.toString(),
    )) as [number, number, number, number, number];

    return {
      allowed: result[0] === 1,
      remainingPoints: result[1],
      maxCapacity: result[2],
      retryAfter: result[3] > 0 ? Math.ceil(result[3]) : undefined,
      restoreTimeMs: Math.ceil(result[4]),
    };
  }

  async updateThrottleStatus(
    storeId: string,
    throttleStatus: ThrottleStatus,
    plan: Plan,
    now: number = Date.now(),
  ): Promise<void> {
    const key = `shopify:rateLimit:${storeId}`;
    const planConfig = PLAN_LIMITS[plan];

    await this.client.eval(
      LUA_UPDATE_SCRIPT,
      1,
      key,
      now.toString(),
      throttleStatus.maximumAvailable.toString(),
      throttleStatus.restoreRate.toString(),
      planConfig.maximumAvailable.toString(),
      planConfig.restoreRate.toString(),
      throttleStatus.currentlyAvailable.toString(),
    );
  }
}
