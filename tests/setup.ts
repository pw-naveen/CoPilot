import { config } from "dotenv";

config({ path: ".env" });
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://app:app@localhost:5432/persona_test";
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1";
process.env.APP_SECRET ||= "test-secret-0123456789abcdef0123456789abcdef";
process.env.OPENAI_API_KEY = "";
process.env.WHATSAPP_GATEWAY = "mock";
process.env.STORAGE_DRIVER = "local";
process.env.EMAIL_SMTP_URL = "";
process.env.DEV_TOOLS = "1";
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.JOBS_INLINE = "1";
