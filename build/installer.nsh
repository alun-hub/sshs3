; Custom NSIS script for sshs3 Windows installer
; Configures Windows Firewall for bundled X Server during installation

!macro customInstall
  DetailPrint "Configuring Windows Firewall for sshs3 X Server..."
  nsExec::Exec 'netsh advfirewall firewall add rule name="sshs3 X Server" dir=in action=allow program="$INSTDIR\resources\vcxsrv\vcxsrv.exe" enable=yes profile=any'
!macroend

!macro customUnInstall
  DetailPrint "Removing Windows Firewall rule for sshs3 X Server..."
  nsExec::Exec 'netsh advfirewall firewall delete rule name="sshs3 X Server"'
!macroend
