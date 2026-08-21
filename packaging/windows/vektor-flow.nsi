Unicode True

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "StrFunc.nsh"
!include "WinMessages.nsh"

${StrStr}
${UnStrRep}

!ifndef APP_VERSION
  !define APP_VERSION "0.1.0"
!endif
!ifndef BUNDLE_ROOT
  !define BUNDLE_ROOT "..\..\dist\releases\vektor-flow-windows-x64"
!endif
!ifndef OUTPUT_FILE
  !define OUTPUT_FILE "..\..\dist\releases\vektor-flow-windows-x64-setup.exe"
!endif

!define PRODUCT_KEY "Software\VektorFlow"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\VektorFlow"

Name "Vektor Flow ${APP_VERSION}"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\VektorFlow"
InstallDirRegKey HKCU "${PRODUCT_KEY}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Vektor Flow"

Var AddToPathCheckbox
Var AddToPath

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom PathPageCreate PathPageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  StrCpy $AddToPath "1"
FunctionEnd

Function PathPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 24u "Choose command-line integration. A new terminal is required after installation."
  Pop $0
  ${NSD_CreateCheckbox} 0 36u 100% 12u "Add VKF to my PATH"
  Pop $AddToPathCheckbox
  ${If} $AddToPath == "1"
    ${NSD_Check} $AddToPathCheckbox
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function PathPageLeave
  ${NSD_GetState} $AddToPathCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $AddToPath "1"
  ${Else}
    StrCpy $AddToPath "0"
  ${EndIf}
FunctionEnd

Function AddInstallPath
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCpy $1 "$INSTDIR\bin"
  ${StrStr} $2 ";$0;" ";$1;"
  StrCmp $2 "" 0 path_done
  StrCmp $0 "" 0 path_append
  StrCpy $0 "$1"
  Goto path_write
path_append:
  StrCpy $0 "$0;$1"
path_write:
  WriteRegExpandStr HKCU "Environment" "Path" "$0"
  WriteRegDWORD HKCU "${PRODUCT_KEY}" "PathAdded" 1
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
path_done:
FunctionEnd

Function un.RemoveInstallPath
  ReadRegDWORD $3 HKCU "${PRODUCT_KEY}" "PathAdded"
  StrCmp $3 1 0 remove_done
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCpy $1 "$INSTDIR\bin"
  StrCpy $0 ";$0;"
  ${UnStrRep} $0 $0 ";$1;" ";"
  StrCmp $0 ";" remove_empty
  StrCpy $0 $0 "" 1
  StrLen $2 $0
  IntOp $2 $2 - 1
  StrCpy $0 $0 $2
  Goto remove_write
remove_empty:
  StrCpy $0 ""
remove_write:
  WriteRegExpandStr HKCU "Environment" "Path" "$0"
  DeleteRegValue HKCU "${PRODUCT_KEY}" "PathAdded"
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
remove_done:
FunctionEnd

Section "Vektor Flow" MainSection
  SectionIn RO
  SetOutPath "$INSTDIR"
  File /r "${BUNDLE_ROOT}\*"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "${PRODUCT_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Vektor Flow"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Vektor Flow"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  CreateDirectory "$SMPROGRAMS\Vektor Flow"
  CreateShortcut "$SMPROGRAMS\Vektor Flow\Examples.lnk" "$INSTDIR\samples"
  CreateShortcut "$SMPROGRAMS\Vektor Flow\Uninstall.lnk" "$INSTDIR\uninstall.exe"
  ${If} $AddToPath == "1"
    Call AddInstallPath
  ${EndIf}
SectionEnd

Section "Uninstall"
  Call un.RemoveInstallPath
  Delete "$SMPROGRAMS\Vektor Flow\Examples.lnk"
  Delete "$SMPROGRAMS\Vektor Flow\Uninstall.lnk"
  RMDir "$SMPROGRAMS\Vektor Flow"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "${PRODUCT_KEY}"
  RMDir /r "$INSTDIR"
SectionEnd
