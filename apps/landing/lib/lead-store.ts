import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LeadInput } from "./lead-schema";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultLeadFilePath = path.resolve(here, "../.data/landing-leads.jsonl");

function resolveLeadFilePath(): string {
  const configuredPath = process.env.LANDING_LEADS_FILE;

  if (configuredPath && configuredPath.trim().length > 0) {
    return path.resolve(configuredPath);
  }

  return defaultLeadFilePath;
}

export async function persistLead(input: LeadInput): Promise<void> {
  const filePath = resolveLeadFilePath();

  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(
    filePath,
    `${JSON.stringify({
      ...input,
      createdAt: new Date().toISOString(),
    })}\n`,
    "utf8",
  );
}
