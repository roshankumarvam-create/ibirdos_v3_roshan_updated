// Common setup for all tests
process.env.NODE_ENV = "test";
process.env.AUTH_SECRET ??= "test-secret-min-32-chars-for-jwt-signing!!";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379/1";
process.env.APP_URL ??= "http://localhost:3000";
process.env.API_URL ??= "http://localhost:3001";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.STORAGE_ENDPOINT ??= "http://localhost:9000";
process.env.STORAGE_ACCESS_KEY ??= "test";
process.env.STORAGE_SECRET_KEY ??= "test";
process.env.STORAGE_BUCKET ??= "test";
process.env.STORAGE_REGION ??= "us-east-1";
