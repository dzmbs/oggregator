import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LeadInput } from "./lead-schema";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(here, "../.data");
const defaultDataFile = path.join(defaultDataDir, "landing-leads.jsonl");

function resolveLeadFilePath() {
  return process.env.LANDING_LEADS_FILE ?? defaultDataFile;
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
