import Redis from 'ioredis';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

let redisClient: Redis;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      retryStrategy: times => Math.min(times * 100, 3000),
    });

    redisClient.on('error', error => {
      console.error('Redis error:', error);
    });

    redisClient.on('connect', () => {
      console.debug('Connected to Redis');
    });
  }
  return redisClient;
}

export async function disconnectRedis(): Promise<void> {
  await redisClient?.quit();
}
