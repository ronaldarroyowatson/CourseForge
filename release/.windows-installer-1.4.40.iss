#define CourseForgeVersion "1.4.40"
#define PackageDir "C:\Users\ronal\Documents\CourseForge\release\CourseForge-1.4.40-windows"
#define ReleaseRoot "C:\Users\ronal\Documents\CourseForge\release"

[Setup]
AppId={{5F0CBCEA-1A2E-4A58-91F9-9A45D5B7A8C4}
AppName=CourseForge
AppVersion={#CourseForgeVersion}
AppPublisher=CourseForge
DefaultDirName={localappdata}\Programs\CourseForge
DefaultGroupName=CourseForge
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
OutputDir={#ReleaseRoot}
OutputBaseFilename=CourseForge-{#CourseForgeVersion}-installer
SetupIconFile={#PackageDir}\CourseForge.ico
Uninstallable=no
CreateUninstallRegKey=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Types]
Name: "full"; Description: "Typical installation"
Name: "custom"; Description: "Custom installation"; Flags: iscustom

[Components]
Name: "webapp"; Description: "CourseForge Web App"; Types: full custom
Name: "extension"; Description: "Browser Extension Files"; Types: full custom

[Tasks]
Name: "desktopicon"; Description: "Create a Desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce
Name: "startmenuicon"; Description: "Create a Start Menu shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce

[Files]
Source: "{#PackageDir}\*"; DestDir: "{tmp}\CourseForgePayload"; Flags: ignoreversion recursesubdirs createallsubdirs

[Code]
function BuildInstallArguments(): string;
begin
  Result := '-Silent -InstallPath "' + ExpandConstant('{app}') + '"';

  if WizardIsComponentSelected('webapp') and WizardIsComponentSelected('extension') then
    Result := Result + ' -Install_Both'
  else if WizardIsComponentSelected('webapp') then
    Result := Result + ' -Install_Webapp'
  else if WizardIsComponentSelected('extension') then
    Result := Result + ' -Install_Extension';

  if not WizardIsTaskSelected('desktopicon') then
    Result := Result + ' -No_Desktop_Icon';

  if not WizardIsTaskSelected('startmenuicon') then
    Result := Result + ' -No_StartMenu_Icon';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;

  if CurPageID = wpSelectComponents then
  begin
    if not WizardIsComponentSelected('webapp') and not WizardIsComponentSelected('extension') then
    begin
      MsgBox('Select at least one component to install.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Args: string;
  InstallerPath: string;
  PayloadDir: string;
  LogDir: string;
  LaunchLogPath: string;
  LaunchCommand: string;
  WaitSeconds: Integer;
  MaxWaitSeconds: Integer;
  ResultCode: Integer;
begin
  if CurStep <> ssPostInstall then
    Exit;

  PayloadDir := ExpandConstant('{tmp}\CourseForgePayload');
  InstallerPath := ExpandConstant('{tmp}\CourseForgePayload\Install-CourseForge-Windows.ps1');
  LogDir := ExpandConstant('{localappdata}\CourseForge\logs');
  ForceDirectories(LogDir);
  LaunchLogPath := LogDir + '\inno-launch.log';

  SaveStringToFile(LaunchLogPath,
    '[' + GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':') + '] Starting installer launch from Inno Setup.' + #13#10 +
    'PayloadDir=' + PayloadDir + #13#10 +
    'InstallerPath=' + InstallerPath + #13#10,
    True);

  MaxWaitSeconds := 20;
  WaitSeconds := 0;
  while (not FileExists(InstallerPath)) and (WaitSeconds < MaxWaitSeconds) do
  begin
    if WaitSeconds = 0 then
      SaveStringToFile(LaunchLogPath,
        '[' + GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':') + '] Waiting for payload script to become available...' + #13#10,
        True);

    Sleep(1000);
    WaitSeconds := WaitSeconds + 1;
  end;

  if not FileExists(InstallerPath) then
  begin
    SaveStringToFile(LaunchLogPath,
      '[' + GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':') + '] ERROR: Install script not found after waiting ' + IntToStr(MaxWaitSeconds) + ' seconds.' + #13#10,
      True);
    MsgBox('Failed to launch CourseForge installer. Missing script:' + #13#10 + InstallerPath + #13#10 + #13#10 +
      'See logs at ' + LogDir + '.', mbError, MB_OK);
    Abort;
  end;

  Args := BuildInstallArguments();
  LaunchCommand := '/c powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + InstallerPath + '" ' + Args +
    ' >> "' + LaunchLogPath + '" 2>&1';

  WizardForm.StatusLabel.Caption := 'Installing CourseForge...';
  if not Exec('cmd.exe', LaunchCommand, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    SaveStringToFile(LaunchLogPath,
      '[' + GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':') + '] ERROR: Exec launch failed.' + #13#10,
      True);
    MsgBox('Failed to launch CourseForge installer script.' + #13#10 + #13#10 +
      'See logs at ' + LogDir + '.', mbError, MB_OK);
    Abort;
  end;

  if ResultCode <> 0 then
  begin
    SaveStringToFile(LaunchLogPath,
      '[' + GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':') + '] Installer exited with code ' + IntToStr(ResultCode) + '.' + #13#10,
      True);
    MsgBox('CourseForge installation failed (exit code ' + IntToStr(ResultCode) + ').' + #13#10 + #13#10 +
      'See logs at ' + LogDir + '.', mbError, MB_OK);
    Abort;
  end;
end;

