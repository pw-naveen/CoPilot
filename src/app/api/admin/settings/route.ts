import { z } from "zod";
import { audit } from "@/server/audit";
import { listSettings, setSetting, SETTING_KEYS, type SettingKey } from "@/server/config";
import { body, route } from "@/server/http";
import { requireAdmin } from "@/server/scope";

export const GET = route(async ({ actor }) => {
  requireAdmin(actor);
  return { settings: await listSettings() };
});

const keys = Object.keys(SETTING_KEYS) as [SettingKey, ...SettingKey[]];

export const PUT = route(async ({ req, actor }) => {
  requireAdmin(actor);
  const input = await body(req, z.record(z.enum(keys), z.string().max(2000)));
  for (const [k, v] of Object.entries(input) as [SettingKey, string][]) {
    // Masked secrets come back unchanged from the form; skip them.
    if (SETTING_KEYS[k].secret && v.startsWith("••••")) continue;
    await setSetting(k, v.trim());
    await audit(actor, { action: "settings.update", entity: "settings", entityId: k, after: SETTING_KEYS[k].secret ? "(secret)" : v });
  }
  return { settings: await listSettings() };
});
