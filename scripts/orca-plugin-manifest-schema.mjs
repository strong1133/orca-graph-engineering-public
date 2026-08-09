import { z } from "zod";

// Panel-only snapshot of Orca's official v1 pluginManifestSchema. This repository
// contributes panels only; tests separately freeze that public-surface boundary.
// Source: stablyai/orca@6da7b8e9cfe62e5b4d34bb52e8c570036c1935fc
// src/shared/plugins/{plugin-manifest,plugin-manifest-fields,plugin-path-safety,plugin-capabilities}.ts
export const ORCA_MANIFEST_SCHEMA_REVISION = "6da7b8e9cfe62e5b4d34bb52e8c570036c1935fc";

const windowsDeviceName = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/iu;
const windowsForbiddenCharacter = /[<>:"|?*]/u;
const pluginId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const semver = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const reservedPluginIds = new Set(["__proto__", "prototype", "constructor"]);

function isSafePluginId(value) {
  return typeof value === "string" &&
    value.length <= 64 &&
    pluginId.test(value) &&
    !reservedPluginIds.has(value);
}

function isSafePluginRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("/") || value.startsWith("\\")) {
    return false;
  }
  return value.split(/[\\/]/u).every((segment) =>
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !segment.endsWith(".") &&
    !segment.endsWith(" ") &&
    !windowsForbiddenCharacter.test(segment) &&
    ![...segment].some((character) => character.charCodeAt(0) <= 31) &&
    !windowsDeviceName.test(segment));
}

const pluginIdSchema = z.string().refine(
  isSafePluginId,
  "must be kebab-case (a-z, 0-9, dashes) and not a reserved name",
);
const pluginRelativePathSchema = z.string()
  .min(1)
  .max(1024)
  .refine(isSafePluginRelativePath, "must be a portable relative path inside the plugin directory");
const panelContributionSchema = z.object({
  id: pluginIdSchema,
  title: z.string().min(1).max(256),
  icon: z.string().min(1).max(64).optional(),
  entry: pluginRelativePathSchema,
});
const capabilitySchema = z.object({
  kind: z.enum([
    "workspace:read",
    "terminal:send",
    "notifications:show",
    "storage",
    "secrets",
    "events:subscribe",
    "settings:own",
  ]),
}).strict();

export const officialOrcaPanelManifestSchema = z.object({
  manifestVersion: z.literal(1),
  id: pluginIdSchema,
  publisher: pluginIdSchema,
  name: z.string().min(1).max(256),
  version: z.string().regex(semver, "must be semver"),
  description: z.string().max(4096).optional(),
  author: z.object({
    name: z.string().min(1).max(256),
    url: z.string().max(2048).optional(),
  }).optional(),
  repository: z.string().max(2048).optional(),
  icon: pluginRelativePathSchema.optional(),
  engines: z.object({
    orca: z.string().max(64).regex(/^>=\d+\.\d+\.\d+$/u, "must be a >=x.y.z version range"),
  }),
  pluginApi: z.literal(1),
  main: pluginRelativePathSchema.optional(),
  contributes: z.object({
    panels: z.array(panelContributionSchema).max(64).default([]),
  }).strict(),
  capabilities: z.array(capabilitySchema).max(32).default([]),
});

export function parseOfficialOrcaPanelManifest(raw) {
  const parsed = officialOrcaPanelManifestSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const location = issue?.path.join(".") || "(root)";
  throw new Error(`official Orca manifest schema rejected ${location}: ${issue?.message ?? "invalid manifest"}`);
}
