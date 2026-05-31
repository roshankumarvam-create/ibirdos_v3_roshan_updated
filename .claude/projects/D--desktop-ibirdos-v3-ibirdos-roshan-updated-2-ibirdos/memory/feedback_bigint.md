---
name: bigint-serialization
description: Prisma BigInt fields need explicit serialization before returning from NestJS controllers
metadata:
  type: feedback
---

Prisma returns BigInt for fields like `currentCostMicrocents` and `pricePerCanonicalMicrocents`. JSON.stringify fails on BigInt. 

**Why:** Node.js JSON.stringify throws "Do not know how to serialize a BigInt" — this is not caught by TypeScript types since BigInt implements JSON-incompatible serialization.

**How to apply:** Add `(BigInt.prototype as any).toJSON = function() { return Number(this); }` to the API's `main.ts` entry point. Also ensure service `toDTO` methods convert BigInt to Number. Check for early-return paths that bypass the DTO conversion.
