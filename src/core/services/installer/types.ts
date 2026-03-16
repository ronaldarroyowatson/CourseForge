export type InstallerMode = "install" | "modify" | "repair" | "uninstall" | "detect";

export type InstallComponent = "webapp" | "extension";

export type InstallerDetectionAction =
  | "install"
  | "full-auto-install"
  | "modify"
  | "repair"
  | "uninstall"
  | "exit";

export type InstallerLogFileName =
  | "installer.log"
  | "auto-install.log"
  | "silent-install.log"
  | "repair.log"
  | "uninstaller.log"
  | "rollback.log";

export interface InstallComponentSelection {
  webapp: boolean;
  extension: boolean;
}

export interface IconOptions {
  desktop: boolean;
  startMenu: boolean;
}

export interface InstallerCliOptions {
  mode?: InstallerMode;
  silent?: boolean;
  fullAuto?: boolean;
  repair?: boolean;
  uninstall?: boolean;
  installPath?: string;
  installWebapp?: boolean;
  installExtension?: boolean;
  installBoth?: boolean;
  noDesktopIcon?: boolean;
  noStartMenuIcon?: boolean;
  removeUserData?: boolean;
}

export interface InstallerRegistryMap {
  installPath: string;
  webappInstalled: boolean;
  extensionInstalled: boolean;
  desktopIconInstalled: boolean;
  startMenuIconInstalled: boolean;
  version: string;
  lastRepairTimestamp?: string;
  silentInstallAllowed: boolean;
}

export interface InstallerShortcutState {
  desktop: boolean;
  startMenu: boolean;
}

export interface InstallerRollbackSnapshot {
  capturedAtUtc: string;
  components: InstallComponentSelection;
  icons: IconOptions;
  registry: InstallerRegistryMap | null;
  shortcuts: InstallerShortcutState;
}

export interface UninstallSelection {
  webapp: boolean;
  extension: boolean;
  removeUserData: boolean;
}

export interface InstallerMetadata {
  productName: "CourseForge";
  version: string;
  installPath: string;
  installPathSource?: "default" | "cli-argument" | "user-selected";
  installedAtUtc: string;
  updatedAtUtc: string;
  components: InstallComponentSelection;
  icons: IconOptions;
  localDataPath: string;
  packageManifestPath?: string;
  integrityManifestPath?: string;
  registryMap?: InstallerRegistryMap;
  rollbackSnapshotPath?: string;
  shortcutState?: InstallerShortcutState;
}

export interface InstallerDetection {
  isInstalled: boolean;
  metadataExists: boolean;
  installPath: string;
}

export interface VerificationIssue {
  code:
    | "missing-webapp"
    | "missing-extension"
    | "missing-package-manifest"
    | "missing-installer-metadata"
    | "missing-desktop-shortcut"
    | "missing-startmenu-shortcut";
  message: string;
}

export interface VerificationResult {
  ok: boolean;
  issues: VerificationIssue[];
}

export interface InstallerLifecyclePlan {
  mode: Exclude<InstallerMode, "detect">;
  selection: InstallComponentSelection;
  icons: IconOptions;
  installPath: string;
  silent: boolean;
  fullAuto: boolean;
  shouldPrompt: boolean;
  logFileName: InstallerLogFileName;
}
