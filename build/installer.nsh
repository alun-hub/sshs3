; Custom NSIS script for sshs3 Windows installer
; Configures Windows Firewall for bundled or local X Server during installation

!macro customInstall
  DetailPrint "Configuring Windows Firewall for sshs3 X Server..."
  ${If} ${FileExists} "$INSTDIR\resources\vcxsrv\vcxsrv.exe"
    nsExec::Exec 'netsh advfirewall firewall add rule name="sshs3 X Server" dir=in action=allow program="$INSTDIR\resources\vcxsrv\vcxsrv.exe" enable=yes profile=any'
  ${EndIf}
!macroend

!macro customUnInstall
  DetailPrint "Removing Windows Firewall rule for sshs3 X Server..."
  nsExec::Exec 'netsh advfirewall firewall delete rule name="sshs3 X Server"'
!macroend
