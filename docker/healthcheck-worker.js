// Healthcheck do container "worker" (ver Dockerfile.worker e docker-compose.prod.yml).
// O worker não expõe HTTP; a única dependência externa dele em runtime é o Redis (BullMQ),
// então validamos a conexão com ele diretamente.
const Redis = require("ioredis");

const redis = new Redis(process.env.REDIS_URL || "redis://redis:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
});

redis
  .connect()
  .then(() => redis.ping())
  .then(() => {
    redis.disconnect();
    process.exit(0);
  })
  .catch(() => {
    redis.disconnect();
    process.exit(1);
  });
