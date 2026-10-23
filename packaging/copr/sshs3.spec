# Repackages the prebuilt sshs3 RPM from GitHub Releases for Fedora COPR.
#
# The release workflow already builds the app (electron-builder), so nothing is compiled
# here: %prep unpacks the released RPM and %install copies its payload into the buildroot.
# COPR build chroots have no network access, which is why a from-source build is not an option.
#
# Bumping a release: change Version and source_sha256 (taken from the release's SHA256SUMS).

%global source_sha256 8130be50689ac86ee12c14fd961fcdced432b7ea57658247565bebfa24c2efbf

# Prebuilt Electron payload: no debuginfo, no stripping/brp rewriting, no auto-generated
# requires/provides for the bundled libraries (the real Requires are listed below).
%global debug_package %{nil}
%global _build_id_links none
%global __os_install_post %{nil}
AutoReqProv: no

Name:           sshs3
Version:        0.96.58
Release:        1%{?dist}
Summary:        Modern SSH, SFTP, and S3 client with smartcard and drag-and-drop support

# sshs3 itself is MIT; the bundled Electron/Chromium components carry their own licenses
# (see /opt/sshs3/LICENSE.electron.txt and /opt/sshs3/LICENSES.chromium.html).
License:        MIT
URL:            https://github.com/alun-hub/sshs3
Source0:        %{url}/releases/download/v%{version}/sshs3-%{version}.x86_64.rpm

ExclusiveArch:  x86_64

BuildRequires:  rpm
BuildRequires:  cpio

# Same runtime dependencies as the upstream RPM.
Requires:       at-spi2-core
Requires:       gtk3
Requires:       libXScrnSaver
Requires:       libXtst
Requires:       libnotify
Requires:       libuuid
Requires:       nss
Requires:       xdg-utils

%description
sshs3 is a modern, security-focused SSH, SFTP, S3, and Kubernetes client with
hardware security key and smartcard support (FIDO2, YubiKey, PKCS#11), split
terminals, and a dual-pane file manager.

This package repackages the official binary release from GitHub.

%prep
%setup -q -c -T
echo "%{source_sha256}  %{SOURCE0}" | sha256sum -c -
rpm2cpio %{SOURCE0} | cpio -idm --quiet

%build
# Nothing to build: the payload is prebuilt.

%install
mkdir -p %{buildroot}/opt %{buildroot}%{_datadir} %{buildroot}%{_bindir}
cp -a opt/sshs3 %{buildroot}/opt/
cp -a usr/share/applications usr/share/icons %{buildroot}%{_datadir}/
# The upstream package creates this link in a scriptlet that its own after-remove script deletes
# again on every upgrade; shipping it as a package file survives upgrades.
ln -s /opt/sshs3/sshs3 %{buildroot}%{_bindir}/sshs3

# File list for the app tree. chrome-sandbox is listed on its own below because its mode is
# decided in %%post.
(
  cd %{buildroot}
  find opt/sshs3 -type d -printf '%%%%dir /%%p\n'
  find opt/sshs3 ! -type d ! -name chrome-sandbox -printf '/%%p\n'
) > %{_builddir}/%{name}-%{version}/app.files

%files -f app.files
%verify(not mode) %attr(0755,root,root) /opt/sshs3/chrome-sandbox
%{_bindir}/sshs3
%{_datadir}/applications/sshs3.desktop
%{_datadir}/icons/hicolor/*/apps/sshs3.png

%post -p /bin/bash
# Same rule as the upstream package: use the SUID sandbox only where user namespaces do not work.
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    chmod 4755 /opt/sshs3/chrome-sandbox || true
fi

%changelog
* Fri Oct 23 2026 Andreas Lundqvist <info@sshs3.com> - 0.96.58-1
- Initial COPR packaging of the prebuilt release
