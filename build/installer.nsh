; Custom NSIS script for sshs3 Windows installer
; Configures Windows Firewall for bundled X Server during installation

!macro customInstall
  ; SECURITY: scoped to Private/Domain networks only (never "any", which
  ; includes Public networks such as open/hotel/coffee-shop Wi-Fi). SSH X11
  ; forwarding never needs this X server to be reachable from another
  ; machine at all -- ssh itself talks to it over loopback -- so this rule
  ; is defense-in-depth only, in case a locally-installed firewall product
  ; treats the loopback interface as covered by the active network profile.
  ; It must never be widened back to profile=any.
  DetailPrint "Configuring Windows Firewall for sshs3 X Server..."
  nsExec::Exec 'netsh advfirewall firewall add rule name="sshs3 X Server" dir=in action=allow program="$INSTDIR\resources\vcxsrv\vcxsrv.exe" enable=yes profile=private,domain'

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
