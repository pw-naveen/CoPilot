import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "prompts");
const cache = new Map<string, { version: string; text: string }>();

/** Loads the highest-numbered `<name>.v<N>.md` and returns it with its version string. */
export function loadPrompt(name: string): { version: string; text: string } {
  const hit = cache.get(name);
  if (hit && process.env.NODE_ENV === "production") return hit;
  const files = readdirSync(DIR)
    .map((f) => f.match(new RegExp(`^${name}\\.v(\\d+)\\.md$`)))
    .filter((m): m is RegExpMatchArray => !!m)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  if (!files.length) throw new Error(`prompt not found: ${name}`);
  const file = files[0][0];
  const p = { version: file.replace(/\.md$/, ""), text: readFileSync(join(DIR, file), "utf8") };
  cache.set(name, p);
  return p;
}

export function fill(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "").trim();
}
