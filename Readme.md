# Shopify Rate Limiter

[![npm version](https://img.shields.io/npm/v/shopify-rate-limiter)](https://www.npmjs.com/package/shopify-rate-limiter)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A distributed rate limiter for Shopify Admin GraphQL API with Redis backend, supporting multi-store and plan-based rate limits.

## Features

- 🚦 Handle Shopify's calculated query costs
- 🛑 Distributed rate limiting using Redis
- ⏱️ Accurate restore time calculations
- 🏪 Multi-store support
- 📊 Plan-based rate limits (Standard, Advanced, Plus, Enterprise)
- 🚀 Atomic operations with Lua scripts

# Shopify Rate Limiter

🔖 _A distributed rate limiter for Shopify Admin GraphQL API with Redis backend_

---

## 📦 Installation

```bash
npm install shopify-rate-limiter ioredis
```

---

## 🚀 Quick Start

```typescript
import Redis from 'ioredis';
import { RateLimiter, Plan } from 'shopify-rate-limiter';

// Initialize
const redis = new Redis();
const limiter = new RateLimiter(redis);

// Usage pattern
async function makeShopifyRequest(storeId: string) {
  const limit = await limiter.checkRateLimit(storeId, Plan.STANDARD);

  if (!limit.allowed) {
    throw new Error(`Rate limited. Retry in ${limit.retryAfter}ms`);
  }

  try {
    const response = await fetchShopifyData();

    // Update with actual API cost
    await limiter.updateThrottleStatus(storeId, response.extensions.cost.throttleStatus, Plan.STANDARD);

    return response;
  } catch (error) {
    // Handle failed request costs
    await limiter.updateThrottleStatus(
      storeId,
      {
        maximumAvailable: 1000,
        currentlyAvailable: limit.remainingPoints,
        restoreRate: 100,
      },
      Plan.STANDARD,
    );
    throw error;
  }
}
```

---

## ⚙️ Configuration

```plain
| Plan        | Max Points | Restore Rate |
|-------------|------------|--------------|
| Standard    | 1000       | 100/s        |
| Advanced    | 2000       | 200/s        |
| Plus        | 5000       | 1000/s       |
| Enterprise  | 10000      | 2000/s       |
```

---

## 🧪 Testing Setup

```bash
# Start Redis
docker-compose up -d

# Run tests
npm test
```

---

## 🛠️ Development Commands

```bash
# Build project
npm run build

# Watch mode
npm run dev

# Test coverage
npm test
```

---

## 📜 License

MIT © BMZ
