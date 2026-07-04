import { promises as fs } from "node:fs";
import path from "node:path";

import { behaviorRules } from "./behaviors/index.js";
import { commandService } from "./command-service.js";
import { RULESET_VERSION } from "./core/types.js";
import { debugRules } from "./debug/index.js";
import { layoutRules } from "./layout/index.js";
import { motionRules } from "./motion/index.js";
import { stateMachines } from "./state/index.js";
import { designTokens } from "./tokens/index.js";

export type RescanTrigger = "manual" | "automatic";
export type RescanSource = "user" | "OttoUpdateAgent";

export interface DesignRuleDescriptor {
  id: string;
  version: string;
  domain: "tokens" | "components" | "behaviors" | "state" | "layout" | "motion" | "debug";
}

export interface DesignSystemRescanResult {
  extensionVersion: string;
  rulesetVersion: string;
  generatedAt: string;
  warnings: string[];
  rules: DesignRuleDescriptor[];
}

export interface DesignSystemRescanOptions {
  repoRoot?: string;
  extensionVersion?: string;
  memPalaceRoot?: string;
  trigger: RescanTrigger;
  source: RescanSource;
}

export interface DesignSystemRescanCommandInput extends Omit<DesignSystemRescanOptions, "trigger" | "source"> {
  trigger?: RescanTrigger;
  source?: RescanSource;
}

const DESIGN_SYSTEM_RESCAN_COMMAND_ID = "otto.design-system.rescan";

function resolveMemPalacePath(repoRoot = process.cwd(), explicitPath?: string): string {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  if (process.env.OTTO_MEMPALACE_PATH) {
    return path.resolve(process.env.OTTO_MEMPALACE_PATH);
  }

  return path.resolve(repoRoot, "../otto-extensions/mempalace");
}

function normalizeExtensionVersion(version?: string): string {
  return version ?? "0.1.0";
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(targetPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonArray(targetPath: string): Promise<unknown[]> {
  if (!(await pathExists(targetPath))) {
    return [];
  }

  const content = await fs.readFile(targetPath, "utf8");
  const parsed = JSON.parse(content) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}

function collectRuleDescriptors(): DesignRuleDescriptor[] {
  return [
    { id: designTokens.color.id, version: designTokens.color.version, domain: "tokens" },
    { id: designTokens.spacing.id, version: designTokens.spacing.version, domain: "tokens" },
    { id: designTokens.typography.id, version: designTokens.typography.version, domain: "tokens" },
    { id: designTokens.motion.id, version: designTokens.motion.version, domain: "tokens" },
    { id: designTokens.elevation.id, version: designTokens.elevation.version, domain: "tokens" },
    { id: designTokens.radii.id, version: designTokens.radii.version, domain: "tokens" },
    { id: behaviorRules.interaction.id, version: behaviorRules.interaction.version, domain: "behaviors" },
    { id: behaviorRules.async.id, version: behaviorRules.async.version, domain: "behaviors" },
    { id: behaviorRules.error.id, version: behaviorRules.error.version, domain: "behaviors" },
    { id: stateMachines.lifecycle.id, version: stateMachines.lifecycle.version, domain: "state" },
    { id: stateMachines.validation.id, version: stateMachines.validation.version, domain: "state" },
    { id: stateMachines.save.id, version: stateMachines.save.version, domain: "state" },
    { id: layoutRules.primitives.id, version: layoutRules.primitives.version, domain: "layout" },
    { id: layoutRules.directional.id, version: layoutRules.directional.version, domain: "layout" },
    { id: layoutRules.gravity.id, version: layoutRules.gravity.version, domain: "layout" },
    { id: motionRules.choreography.id, version: motionRules.choreography.version, domain: "motion" },
    { id: motionRules.transitions.id, version: motionRules.transitions.version, domain: "motion" },
    { id: debugRules.traceOverlay.id, version: debugRules.traceOverlay.version, domain: "debug" }
  ];
}

export async function rescanDesignSystem(
  options: DesignSystemRescanOptions
): Promise<DesignSystemRescanResult> {
  const rules = collectRuleDescriptors();
  const warnings: string[] = [];
  if (rules.length === 0) {
    warnings.push("No design rules were discovered in the authority layer.");
  }

  return {
    extensionVersion: normalizeExtensionVersion(options.extensionVersion),
    rulesetVersion: RULESET_VERSION,
    generatedAt: new Date().toISOString(),
    warnings,
    rules
  };
}

export async function persistDesignSystemMetadata(
  result: DesignSystemRescanResult,
  options: DesignSystemRescanOptions
): Promise<void> {
  const memPalaceRoot = resolveMemPalacePath(process.cwd(), options.memPalaceRoot);
  const snapshot = {
    updatedAt: result.generatedAt,
    extensionVersion: result.extensionVersion,
    rulesetVersion: result.rulesetVersion,
    ruleCount: result.rules.length,
    rules: result.rules,
    warnings: result.warnings
  };
  const event = {
    at: result.generatedAt,
    trigger: options.trigger,
    source: options.source,
    ruleCount: result.rules.length,
    warnings: result.warnings
  };

  await writeJson(path.join(memPalaceRoot, "design-system-index.json"), snapshot);

  const generationHistoryPath = path.join(memPalaceRoot, "design-system-generation-history.json");
  const generationHistory = await readJsonArray(generationHistoryPath);
  generationHistory.push({ ...event, snapshot });
  await writeJson(generationHistoryPath, generationHistory);

  const rescanEventsPath = path.join(memPalaceRoot, "design-system-rescan-events.json");
  const rescanEvents = await readJsonArray(rescanEventsPath);
  rescanEvents.push(event);
  await writeJson(rescanEventsPath, rescanEvents);
}

export async function executeDesignSystemRescan(
  options: DesignSystemRescanOptions
): Promise<DesignSystemRescanResult> {
  const result = await rescanDesignSystem(options);
  await persistDesignSystemMetadata(result, options);
  return result;
}

commandService.register<DesignSystemRescanCommandInput, DesignSystemRescanResult>(
  DESIGN_SYSTEM_RESCAN_COMMAND_ID,
  async (input) =>
    executeDesignSystemRescan({
      ...input,
      trigger: input.trigger ?? "manual",
      source: input.source ?? "user"
    })
);

export async function executeDesignSystemRescanCommand(
  input: DesignSystemRescanCommandInput
): Promise<DesignSystemRescanResult> {
  return commandService.run<DesignSystemRescanCommandInput, DesignSystemRescanResult>(
    DESIGN_SYSTEM_RESCAN_COMMAND_ID,
    input
  );
}
