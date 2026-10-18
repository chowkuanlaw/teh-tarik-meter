; Teh Tarik Meter uninstaller: ask before deleting your data (same as Lapis 1.11.0).
; Never asks during an update (the old version is removed silently then), and a silent
; uninstall keeps the data (/SD IDNO). Everything lives in %APPDATA%\Teh Tarik Meter,
; including the encrypted claude.ai sign-in.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also remove your Teh Tarik Meter data from this PC?$\r$\n(your claude.ai sign-in for the meter, usage history and settings)$\r$\n$\r$\nPadam juga data Teh Tarik Meter anda dari PC ini?$\r$\n(log masuk claude.ai untuk meter ini, sejarah penggunaan dan tetapan)$\r$\n$\r$\nChoose No to keep it in case you install Teh Tarik Meter again." /SD IDNO IDNO ttm_keep_data
      SetShellVarContext current
      ${if} "$APPDATA" != ""            ; never remove a bare "\Teh Tarik Meter" if the folder can't be resolved
        RMDir /r "$APPDATA\Teh Tarik Meter"
      ${endIf}
    ttm_keep_data:
  ${endIf}
!macroend
