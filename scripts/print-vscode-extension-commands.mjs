const extensionIds = [
  "GitHub.copilot-chat",
  "GitHub.vscode-pull-request-github",
  "Continue.continue",
  "toba.vsfire",
  "dbaeumer.vscode-eslint",
  "esbenp.prettier-vscode",
  "ZixuanChen.vitest-explorer",
  "ms-vscode.powershell",
  "redhat.vscode-yaml",
  "DavidAnson.vscode-markdownlint",
];

for (const id of extensionIds) {
  console.log(`code --install-extension ${id}`);
}
