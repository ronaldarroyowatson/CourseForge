import type {
  InstallerDetectionAction,
  IconOptions,
  InstallerLogFileName,
  InstallComponentSelection,
  InstallerCliOptions,
  InstallerDetection,
  InstallerLifecyclePlan,
  InstallerMode,
  UninstallSelection,
  VerificationIssue,
  VerificationResult,
} from "./types";

export function getDefaultComponentSelection(): InstallComponentSelection {
  return { webapp: true, extension: true };
}

export function getDefaultIconOptions(): IconOptions {
  return { desktop: true, startMenu: true };
}

export function resolveComponentSelection(
  options: InstallerCliOptions,
  fallback: InstallComponentSelection = getDefaultComponentSelection()
): InstallComponentSelection {
  if (options.installBoth) {
    return { webapp: true, extension: true };
  }

  const hasExplicitComponentFlag = Boolean(options.installWebapp || options.installExtension);
  if (!hasExplicitComponentFlag) {
    return { ...fallback };
  }

  return {
    webapp: Boolean(options.installWebapp),
    extension: Boolean(options.installExtension),
  };
}

export function resolveIconOptions(options: InstallerCliOptions): IconOptions {
  const defaults = getDefaultIconOptions();
  return {
    desktop: options.noDesktopIcon ? false : defaults.desktop,
    startMenu: options.noStartMenuIcon ? false : defaults.startMenu,
  };
}

export function validateComponentSelection(selection: InstallComponentSelection): string | null {
  if (!selection.webapp && !selection.extension) {
    return "At least one component must be selected.";
  }

  return null;
}

export function resolveUninstallSelection(
  installedSelection: InstallComponentSelection,
  options: Pick<InstallerCliOptions, "removeUserData">
): UninstallSelection {
  return {
    webapp: Boolean(installedSelection.webapp),
    extension: Boolean(installedSelection.extension),
    removeUserData: Boolean(options.removeUserData),
  };
}

export function resolveRequestedInstallPath(options: InstallerCliOptions, fallbackPath: string): string {
  const requestedPath = options.installPath?.trim();
  return requestedPath && requestedPath.length > 0 ? requestedPath : fallbackPath;
}

export function resolveMode(options: InstallerCliOptions, detection: InstallerDetection): InstallerMode {
  if (options.fullAuto) {
    return "install";
  }

  if (options.uninstall) {
    return "uninstall";
  }

  if (options.repair) {
    return "repair";
  }

  if (options.mode) {
    return options.mode;
  }

  if (detection.isInstalled) {
    return "detect";
  }

  return "install";
}

export function getDetectionActions(detection: InstallerDetection): InstallerDetectionAction[] {
  if (!detection.isInstalled) {
    return ["install", "full-auto-install"];
  }

  return ["modify", "repair", "uninstall", "exit"];
}

export function getLogFileNameForPlan(input: {
  mode: Exclude<InstallerMode, "detect">;
  silent: boolean;
  fullAuto: boolean;
}): InstallerLogFileName {
  if (input.mode === "repair") {
    return "repair.log";
  }

  if (input.mode === "uninstall") {
    return "uninstaller.log";
  }

  if (input.fullAuto) {
    return "auto-install.log";
  }

  if (input.silent) {
    return "silent-install.log";
  }

  return "installer.log";
}

export function createLifecyclePlan(
  options: InstallerCliOptions,
  detection: InstallerDetection,
  existingSelection: InstallComponentSelection = getDefaultComponentSelection(),
  existingIcons: IconOptions = getDefaultIconOptions(),
  defaultInstallPath: string = detection.installPath
): InstallerLifecyclePlan {
  const mode = resolveMode(options, detection);
  const fullAuto = Boolean(options.fullAuto);
  const silent = Boolean(options.silent || fullAuto);

  if (mode === "detect") {
    const resolvedMode = detection.isInstalled ? "modify" : "install";
    const planSilent = !detection.isInstalled && fullAuto ? true : silent;

    return {
      mode: resolvedMode,
      selection: detection.isInstalled ? { ...existingSelection } : getDefaultComponentSelection(),
      icons: detection.isInstalled ? { ...existingIcons } : resolveIconOptions(options),
      installPath: detection.isInstalled
        ? detection.installPath
        : resolveRequestedInstallPath(options, defaultInstallPath),
      silent: planSilent,
      fullAuto,
      shouldPrompt: !planSilent,
      logFileName: getLogFileNameForPlan({
        mode: resolvedMode,
        silent: planSilent,
        fullAuto,
      }),
    };
  }

  let selection = resolveComponentSelection(
    options,
    mode === "modify" ? existingSelection : getDefaultComponentSelection()
  );

  if (fullAuto) {
    selection = { webapp: true, extension: true };
  }

  const lifecyclePlan: InstallerLifecyclePlan = {
    mode,
    selection,
    icons: fullAuto ? getDefaultIconOptions() : resolveIconOptions(options),
    installPath:
      mode === "modify"
        ? detection.installPath
        : resolveRequestedInstallPath(options, defaultInstallPath),
    silent,
    fullAuto,
    shouldPrompt: !silent,
    logFileName: getLogFileNameForPlan({ mode, silent, fullAuto }),
  };

  return lifecyclePlan;
}

export function buildVerificationResult(input: {
  selection: InstallComponentSelection;
  icons: IconOptions;
  hasWebapp: boolean;
  hasExtension: boolean;
  hasPackageManifest: boolean;
  hasInstallerMetadata: boolean;
  hasDesktopShortcut: boolean;
  hasStartMenuShortcut: boolean;
}): VerificationResult {
  const issues: VerificationIssue[] = [];

  if (input.selection.webapp && !input.hasWebapp) {
    issues.push({
      code: "missing-webapp",
      message: "Webapp component is missing after install.",
    });
  }

  if (input.selection.extension && !input.hasExtension) {
    issues.push({
      code: "missing-extension",
      message: "Browser extension component is missing after install.",
    });
  }

  if (!input.hasPackageManifest) {
    issues.push({
      code: "missing-package-manifest",
      message: "package-manifest.json is missing.",
    });
  }

  if (!input.hasInstallerMetadata) {
    issues.push({
      code: "missing-installer-metadata",
      message: "installer-metadata.json is missing.",
    });
  }

  if (input.icons.desktop && !input.hasDesktopShortcut) {
    issues.push({
      code: "missing-desktop-shortcut",
      message: "Desktop shortcut is missing.",
    });
  }

  if (input.icons.startMenu && !input.hasStartMenuShortcut) {
    issues.push({
      code: "missing-startmenu-shortcut",
      message: "Start menu shortcut is missing.",
    });
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function getInstallerLogPathForPlatform(input: {
  isWindows: boolean;
  localAppData?: string;
  homeDir?: string;
  logFileName?: InstallerLogFileName;
}): string {
  const logFileName = input.logFileName ?? "installer.log";

  if (input.isWindows && input.localAppData) {
    return `${input.localAppData.replace(/[\\/]+$/, "")}\\CourseForge\\logs\\${logFileName}`;
  }

  const homeDir = (input.homeDir ?? "~").replace(/[\\/]+$/, "");
  return `${homeDir}/.courseforge/logs/${logFileName}`;
}
