; Custom NSIS script for sshs3 Windows installer
; Configures Windows Firewall for bundled X Server during installation

!macro customInstall
  DetailPrint "Configuring Windows Firewall for sshs3 X Server..."
  nsExec::Exec 'netsh advfirewall firewall add rule name="sshs3 X Server" dir=in action=allow program="$INSTDIR\resources\vcxsrv\vcxsrv.exe" enable=yes profile=any'

  ; Enables the built-in Windows OpenSSH Authentication Agent service, which is
  ; disabled by default on Windows. Only needed for smartcard "Once Per Terminal
  ; Connection" / "Global" PIN caching modes (Win32-OpenSSH's ssh-agent.exe can
  ; only run as this single system service, never as a per-app private agent —
  ; see the README's "Smartcard PIN Caching" section). Everything else,
  ; including "Always Prompt" mode, works without it, so this is best-effort:
  ; failure (missing admin rights, OpenSSH Client feature not installed, locked
  ; -down group policy, ...) is silently ignored rather than blocking install.
  DetailPrint "Enabling Windows OpenSSH Authentication Agent service..."
  nsExec::Exec 'sc config ssh-agent start= demand'
  nsExec::Exec 'sc start ssh-agent'
!macroend

!macro customUnInstall
  DetailPrint "Removing Windows Firewall rule for sshs3 X Server..."
  nsExec::Exec 'netsh advfirewall firewall delete rule name="sshs3 X Server"'
!macroend
