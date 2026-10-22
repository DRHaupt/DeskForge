import "dotenv/config";

(process.env as Record<string, string>).NODE_ENV ??= "test";
if (process.env.DEBUG_TEST_LOGS) process.env.LOG_LEVEL = "error";
process.env.LOG_LEVEL ??= process.env.DEBUG_TEST_LOGS ? "error" : "silent";
// Integration tests use a separate database.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("_test")) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(/\/(\w+)(\?|$)/, "/$1_test$2");
}
