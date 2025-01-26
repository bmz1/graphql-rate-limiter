import { Redis } from "ioredis";
import { RateLimitResult, ThrottleStatus } from "./types";

const LUA_CHECK_SCRIPT = `
local key = KEYS[1]
local currentTimestamp = tonumber(ARGV[1])

local exists = redis.call("EXISTS", key)
if exists == 0 then
    return {1, 1000, 1000, 0, 0} -- Allowed, remaining, max, retryAfter, restoreTime
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

local elapsed = math.max(currentTimestamp - lastUpdated, 0)
local restored = (elapsed * storedRate) / 1000
local newAvailable = math.min(storedCurrent + restored, storedMax)

local deficit = storedMax - newAvailable
local restoreTimeMs = (deficit / storedRate) * 1000

if newAvailable > 0 then
    local optimisticCost = newAvailable - 10
    redis.call("HMSET", key,          
        "currentlyAvailable", optimisticCost,
        "lastUpdated", currentTimestamp)
    return {1, newAvailable, storedMax, 0, restoreTimeMs}
else
    return {0, 0, storedMax, restoreTimeMs, restoreTimeMs}
end
`;

const LUA_UPDATE_SCRIPT = `
local key = KEYS[1]
local currentTimestamp = tonumber(ARGV[1])
local throttleMax = tonumber(ARGV[2])
local throttleRate = tonumber(ARGV[3])
local throttleCurrent = tonumber(ARGV[4])

redis.call("HMSET", key,
    "maximumAvailable", throttleMax,
    "currentlyAvailable", math.min(throttleCurrent, throttleMax),
    "restoreRate", throttleRate,
    "lastUpdated", currentTimestamp)

redis.call("EXPIRE", key, 86400)
`;

export class RateLimiter {
  private client: Redis;

  constructor(client: Redis) {
    this.client = client;
  }

  async checkRateLimit(
    storeId: string,
    now: number = Date.now(),
  ): Promise<RateLimitResult> {
    const key = `shopify:rateLimit:${storeId}`;

    const result = (await this.client.eval(
      LUA_CHECK_SCRIPT,
      1,
      key,
      now.toString(),
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
    now: number = Date.now(),
  ): Promise<void> {
    const key = `shopify:rateLimit:${storeId}`;

    await this.client.eval(
      LUA_UPDATE_SCRIPT,
      1,
      key,
      now.toString(),
      throttleStatus.maximumAvailable.toString(),
      throttleStatus.restoreRate.toString(),
      throttleStatus.currentlyAvailable.toString(),
    );
  }
}
