; Hooks of the NSIS installer Tauri makes (tauri.conf.json's bundle.windows.nsis.installerHooks).
;
; Settings → Agents → Command line copies smedcover.exe into a folder of its own, %LOCALAPPDATA%\<identifier>\bin, with
; an app-path file naming the app, and puts that folder on the user's PATH (src-tauri/src/install.rs). Uninstalling the
; app removes the copy and the folder, which the uninstaller would otherwise leave (it removes the app's local folder only
; when "Delete the application data" is ticked). Not on an update, which runs the old uninstaller with /UPDATE: the app
; makes the copy anew as it next starts. The PATH entry is left: a folder that is not there finds nothing, and the app
; installed again (or Install pressed again) uses the same one. The folder is the user's own, as the app's: the context
; set to the current user, as the uninstaller does for the application data.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    SetShellVarContext current
    Delete "$LOCALAPPDATA\${BUNDLEID}\bin\smedcover.exe"
    Delete "$LOCALAPPDATA\${BUNDLEID}\bin\app-path"
    RMDir "$LOCALAPPDATA\${BUNDLEID}\bin"
  ${EndIf}
!macroend
