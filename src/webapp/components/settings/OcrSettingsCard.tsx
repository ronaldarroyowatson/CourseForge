import React from "react";

import {
  type OcrDebugLevel,
  type OcrFallbackBehavior,
  type OcrSettings,
  type OcrSettingsUpdateInput,
  getBrowserOcrSettingsManager,
} from "../../../core/services/ocrSettingsService";
import { executeGuiCliBoundCommand } from "../../../core/services/guiCliParityService";
import { resetCloudOcrCircuitState } from "../../../core/services/autoOcrService";

interface OcrSettingsCardProps {
  onSettingsChanged?: () => Promise<void> | void;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function OcrSettingsCard({ onSettingsChanged }: OcrSettingsCardProps): React.JSX.Element {
  const [expanded, setExpanded] = React.useState(false);
  const [settings, setSettings] = React.useState<OcrSettings | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [busyField, setBusyField] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;

    void (async () => {
      const manager = await getBrowserOcrSettingsManager();
      const current = await manager.getSettings();
      if (!mounted) {
        return;
      }
      setSettings(current);
      const unsubscribe = manager.subscribe((value) => {
        setSettings(value);
      });
      if (!mounted) {
        unsubscribe();
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  async function applySetting(commandId: string, fieldName: string, patch: OcrSettingsUpdateInput): Promise<void> {
    await executeGuiCliBoundCommand(commandId, async () => {
      setBusyField(fieldName);
      setStatus(null);
      try {
        const manager = await getBrowserOcrSettingsManager();
        const next = await manager.updateSettings(patch);
        setSettings(next);
        await onSettingsChanged?.();
        setStatus("OCR settings updated.");
      } catch (error) {
        setStatus(`Unable to update OCR setting: ${formatError(error)}`);
      } finally {
        setBusyField(null);
      }
    }, patch as Record<string, unknown>);
  }

  if (!settings) {
    return (
      <article className="settings-card settings-card--expandable settings-card--compact">
        <div className="settings-card__head">
          <h3>OCR Settings</h3>
        </div>
        <p className="settings-meta">Loading OCR settings...</p>
      </article>
    );
  }

  return (
    <article className={`settings-card settings-card--expandable settings-card--compact ${expanded ? "settings-card--expanded" : ""}`}>
      <div className="settings-card__head">
        <h3>OCR Settings</h3>
        <button type="button" className="btn-secondary settings-card__toggle" onClick={() => setExpanded((previous) => !previous)}>
          {expanded ? "Hide" : "Show"}
        </button>
      </div>
      {expanded ? (
        <>
          <p className="settings-meta">Unified OCR runtime policy shared by GUI, CLI, and OCR execution services.</p>
          <div className="settings-grid">
            <label>
              Auto-Retries Enabled
              <input
                type="checkbox"
                title="Automatically retry OCR attempts before failing over."
                checked={settings.autoRetriesEnabled}
                disabled={busyField === "autoRetriesEnabled"}
                onChange={(event) => {
                  void applySetting(
                    `courseforge ocr settings set --auto-retries ${String(event.target.checked)}`,
                    "autoRetriesEnabled",
                    { autoRetriesEnabled: event.target.checked },
                  );
                }}
              />
            </label>

            <label>
              Max Retry Attempts
              <input
                type="number"
                min={0}
                max={10}
                title="Maximum additional OCR retry attempts before fallback."
                value={settings.maxRetryAttempts}
                disabled={busyField === "maxRetryAttempts"}
                onChange={(event) => {
                  const next = Math.max(0, Math.min(10, Number(event.target.value) || 0));
                  void applySetting(
                    `courseforge ocr settings set --max-retries ${String(next)}`,
                    "maxRetryAttempts",
                    { maxRetryAttempts: next },
                  );
                }}
              />
            </label>

            <label>
              Number of Shots / Captures
              <select
                title="How many TOC OCR sampling captures to evaluate."
                value={settings.shots}
                disabled={busyField === "shots"}
                onChange={(event) => {
                  const next = Number(event.target.value) as 1 | 2 | 3;
                  void applySetting(
                    `courseforge ocr settings set --shots ${String(next)}`,
                    "shots",
                    { shots: next },
                  );
                }}
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </label>

            <label>
              Crop Strategy
              <select
                title="Select whether OCR uses color crops, black-and-white crops, or both."
                value={settings.cropStrategy}
                disabled={busyField === "cropStrategy"}
                onChange={(event) => {
                  const next = event.target.value as OcrSettings["cropStrategy"];
                  void applySetting(
                    `courseforge ocr settings set --crop-strategy ${next}`,
                    "cropStrategy",
                    { cropStrategy: next },
                  );
                }}
              >
                <option value="color">Color only</option>
                <option value="bw">Black &amp; white only</option>
                <option value="both">Color + B&amp;W</option>
              </select>
            </label>

            <label>
              Dynamic Rate-Limit Adaptation
              <input
                type="checkbox"
                title="Use provider cooldown metadata to adapt wait timing before fallback."
                checked={settings.dynamicRateLimitAdaptation}
                disabled={busyField === "dynamicRateLimitAdaptation"}
                onChange={(event) => {
                  void applySetting(
                    `courseforge ocr settings set --dynamic-limits ${String(event.target.checked)}`,
                    "dynamicRateLimitAdaptation",
                    { dynamicRateLimitAdaptation: event.target.checked },
                  );
                }}
              />
            </label>

            <label>
              Dynamic Limit Buffer (seconds)
              <input
                type="number"
                min={0}
                max={30}
                title="Additional seconds added to cooldown waits for safety."
                value={settings.dynamicLimitBufferSeconds}
                disabled={busyField === "dynamicLimitBufferSeconds"}
                onChange={(event) => {
                  const next = Math.max(0, Math.min(30, Number(event.target.value) || 0));
                  void applySetting(
                    `courseforge ocr settings set --limit-buffer ${String(next)}`,
                    "dynamicLimitBufferSeconds",
                    { dynamicLimitBufferSeconds: next },
                  );
                }}
              />
            </label>

            <label>
              Primary OCR Provider
              <select
                title="Preferred primary OCR cloud provider."
                value={settings.primaryProvider}
                disabled={busyField === "primaryProvider"}
                onChange={(event) => {
                  const value = event.target.value;
                  const provider = value === "cloud_github_models_vision" ? "cloud_github_models_vision" : "cloud_openai_vision";
                  const cliProvider = provider === "cloud_openai_vision" ? "openai" : "github";
                  void applySetting(
                    `courseforge ocr settings set --primary-provider ${cliProvider}`,
                    "primaryProvider",
                    { primaryProvider: provider },
                  );
                }}
              >
                <option value="cloud_openai_vision">OpenAI</option>
                <option value="cloud_github_models_vision">GitHub</option>
              </select>
            </label>

            <label>
              Fallback Behavior
              <select
                title="Choose fallback behavior when primary OCR is unavailable."
                value={settings.fallbackBehavior}
                disabled={busyField === "fallbackBehavior"}
                onChange={(event) => {
                  const next = event.target.value as OcrFallbackBehavior;
                  void applySetting(
                    `courseforge ocr settings set --fallback ${next}`,
                    "fallbackBehavior",
                    { fallbackBehavior: next },
                  );
                }}
              >
                <option value="wait">Wait for primary</option>
                <option value="backup">Use backup cloud</option>
                <option value="tesseract-last">Use Tesseract only if all else fails</option>
              </select>
            </label>

            <label>
              Debug Logging Level
              <select
                title="Control OCR diagnostics verbosity."
                value={settings.debugLevel}
                disabled={busyField === "debugLevel"}
                onChange={(event) => {
                  const next = event.target.value as OcrDebugLevel;
                  void applySetting(
                    `courseforge ocr settings set --debug-level ${next}`,
                    "debugLevel",
                    { debugLevel: next },
                  );
                }}
              >
                <option value="off">Off</option>
                <option value="errors">Errors only</option>
                <option value="verbose">Verbose</option>
                <option value="trace">Full trace</option>
              </select>
            </label>
          </div>
          {status ? <p className="settings-meta">{status}</p> : null}
          <div className="form-actions">
            <button
              type="button"
              className="btn-secondary"
              title="Reset stuck cloud OCR circuit breakers and rate-limit pacing state. Use this if cloud OCR is falling back to Tesseract unexpectedly."
              onClick={() => {
                void executeGuiCliBoundCommand("courseforge ocr settings reset-circuit", () => {
                  resetCloudOcrCircuitState();
                  setStatus("Cloud OCR circuit breakers and pacing state cleared. Next OCR capture will retry cloud providers.");
                }, {});
              }}
            >
              Reset Cloud OCR Circuit Breakers
            </button>
          </div>
        </>
      ) : null}
    </article>
  );
}
