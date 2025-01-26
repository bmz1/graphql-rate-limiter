# Shopify Rate Limiter

[![npm version](https://img.shields.io/npm/v/@bmz_1/graphql-rate-limiter)](https://www.npmjs.com/package/@bmz_1/graphql-rate-limiter)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A distributed rate limiter for Shopify Admin GraphQL API with Redis backend, supporting multi-store and plan-based rate limits.

## Features

- 🛑 Distributed rate limiting using Redis
- ⏱️ Accurate restore time calculations
- 🏪 Multi-store support
- 📊 Plan-based rate limits (Standard, Advanced, Plus, Enterprise)
- 🚀 Atomic operations with Lua scripts

## 📦 Installation

```bash
npm install @bmz_1/graphql-rate-limiter ioredis
```

---

## Usage

First, import the necessary classes and create an instance of the `RateLimiter` class with a Redis client.

```javascript
import { Redis } from 'ioredis';
import { RateLimiter, ThrottleStatus } from './rateLimiter';

const redisClient = new Redis();
const rateLimiter = new RateLimiter(redisClient);
```

### Checking Rate Limits

To check if a request is allowed within the rate limit, use the `checkRateLimit` method.

```javascript
const storeId = 'your-store-id';
const cost = 10; // The cost of the request
const now = Date.now(); // Current timestamp

const result = await rateLimiter.checkRateLimit(storeId, cost, now);

if (result.allowed) {
  console.log('Request allowed. Remaining points:', result.remainingPoints);
} else {
  console.log('Request denied. Retry after:', result.retryAfter, 'ms');
}
```

### Updating Throttle Status

To update the throttle status, use the `updateThrottleStatus` method.

```javascript
const throttleStatus: ThrottleStatus = {
  maximumAvailable: 1000,
  restoreRate: 10,
  currentlyAvailable: 500,
};

await rateLimiter.updateThrottleStatus(storeId, throttleStatus, now);
```

### Example: Using Shopify GraphQL API

Here’s an example of how you can use this rate limiter with Shopify's GraphQL API:

```javascript
import axios from 'axios';

async function makeShopifyGraphQLRequest(storeId, query, variables = {}) {
  const cost = 10; // Assume each request costs 10 points
  const now = Date.now();

  // Check rate limit before making the request
  const rateLimitResult = await rateLimiter.checkRateLimit(storeId, cost, now);

  if (!rateLimitResult.allowed) {
    throw new Error(`Rate limit exceeded. Retry after ${rateLimitResult.retryAfter} ms.`);
  }

  try {
    const response = await axios({
      method: 'POST',
      url: `https://${storeId}.myshopify.com/admin/api/2023-10/graphql.json`,
      headers: {
        'X-Shopify-Access-Token': 'your-access-token',
        'Content-Type': 'application/json',
      },
      data: {
        query,
        variables,
      },
    });

    console.log('Shopify GraphQL API Response:', response.data);
    await rateLimiter.updateThrottleStatus(storeId, response.data.extensions.cost)
    return response.data;
  } catch (error) {
    console.error('Shopify GraphQL API Error:', error.response?.data || error.message);
    throw error;
  }
}

// Example usage
(async () => {
  const storeId = 'your-store-id';
  const query = `
    query {
      products(first: 5) {
        edges {
          node {
            id
            title
            description
          }
        }
      }
    }
  `;

  try {
    const result = await makeShopifyGraphQLRequest(storeId, query);
    console.log('Products:', result.data.products.edges);
  } catch (error) {
    console.error('Failed to fetch products:', error.message);
  }
})();
```

## Lua Scripts

The package uses two Lua scripts to interact with Redis:

1. **LUA_CHECK_SCRIPT**: This script checks if a request is allowed based on the current rate limit status.
2. **LUA_UPDATE_SCRIPT**: This script updates the rate limit status in Redis.

## Types

The package defines the following types:

- **RateLimitResult**: Represents the result of a rate limit check.
- **ThrottleStatus**: Represents the current status of the rate limit.

```typescript
type RateLimitResult = {
  allowed: boolean;
  remainingPoints: number;
  maxCapacity: number;
  retryAfter?: number;
  restoreTimeMs: number;
};

type ThrottleStatus = {
  maximumAvailable: number;
  restoreRate: number;
  currentlyAvailable: number;
};
```

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

# test
npm test
```

---

## License

This package is open-source and available under the MIT License.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on GitHub.

## Support

If you have any questions or need support, please open an issue on the GitHub repository.
