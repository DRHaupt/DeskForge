import "dotenv/config";

(process.env as Record<string, string>).NODE_ENV ??= "test";
process.env.LOG_LEVEL ??= "silent";
// Integration tests use a separate database.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("_test")) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(/\/(\w+)(\?|$)/, "/$1_test$2");
}
