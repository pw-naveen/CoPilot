import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { decrypt, encrypt } from "./crypto";

/**
 * Global settings: admin-editable values stored in `settings` (secrets encrypted),
 * falling back to environment variables. Model names come from env only, so they
 * can be changed without a deploy but never from the UI.
 */
export const SETTING_KEYS = {
  "openai.api_key": { env: "OPENAI_API_KEY", secret: true },
  "evolution.url": { env: "EVOLUTION_API_URL", secret: false },
  "evolution.api_key": { env: "EVOLUTION_API_KEY", secret: true },
  "evolution.instance": { env: "EVOLUTION_INSTANCE", secret: false },
  "evolution.webhook_secret": { env: "EVOLUTION_WEBHOOK_SECRET", secret: true },
  "limits.debounce_seconds": { env: "DEBOUNCE_SECONDS", secret: false },
  "limits.monthly_cap": { env: "", secret: false, fallback: "20" },
  "limits.input_prompt_days": { env: "", secret: false, fallback: "7" },
  "defaults.timezone": { env: "DEFAULT_TIMEZONE", secret: false, fallback: "Asia/Kuala_Lumpur" },
  "subadmin.can_invite_default": { env: "", secret: false, fallback: "false" },
} as const satisfies Record<string, { env: string; secret: boolean; fallback?: string }>;

export type SettingKey = keyof typeof SETTING_KEYS;

export async function getSetting(key: SettingKey): Promise<string | undefined> {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, key) });
  if (row && row.value !== "") return row.encrypted ? decrypt(row.value) : row.value;
  const def = SETTING_KEYS[key] as { env: string; fallback?: string };
  return (def.env && process.env[def.env]) || def.fallback || undefined;
}

export async function getNumberSetting(key: SettingKey, fallback: number): Promise<number> {
  const v = Number(await getSetting(key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export async function setSetting(key: SettingKey, value: string) {
  const secret = SETTING_KEYS[key].secret;
  const stored = secret && value ? encrypt(value) : value;
  await db
    .insert(schema.settings)
    .values({ key, value: stored, encrypted: secret })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: stored, encrypted: secret } });
}

/** For the admin settings form: secrets come back masked. */
export async function listSettings() {
  const out: Record<string, { value: string; secret: boolean; set: boolean }> = {};
  for (const key of Object.keys(SETTING_KEYS) as SettingKey[]) {
    const v = (await getSetting(key)) ?? "";
    const secret = SETTING_KEYS[key].secret;
    out[key] = { value: secret ? (v ? `••••${v.slice(-4)}` : "") : v, secret, set: !!v };
  }
  return out;
}

export const models = () => ({
  draft: process.env.OPENAI_MODEL_DRAFT || "gpt-4.1",
  classify: process.env.OPENAI_MODEL_CLASSIFY || "gpt-4.1-mini",
  transcribe: process.env.OPENAI_MODEL_TRANSCRIBE || "gpt-4o-mini-transcribe",
  vision: process.env.OPENAI_MODEL_VISION || "gpt-4.1-mini",
});

export const appBaseUrl = () => (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
