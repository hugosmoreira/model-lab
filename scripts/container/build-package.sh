#!/bin/sh
set -eu
version=2.8.4
archive=expat-${version}.tar.xz
source_url=https://github.com/libexpat/libexpat/releases/download/R_2_8_4/${archive}
source_sha256=656ae1cc8da3b4ea513bb4e254f33e6243938084c0ec6239da873376b09985a7
printf '%s  %s\n' "$source_sha256" "$archive" | sha256sum -c -
tar -xJf "$archive"
arch=$(dpkg-architecture -qDEB_HOST_ARCH)
multiarch=$(dpkg-architecture -qDEB_HOST_MULTIARCH)
export DEB_BUILD_MAINT_OPTIONS=hardening=+all
export CFLAGS="$(dpkg-buildflags --get CFLAGS) $(dpkg-buildflags --get CPPFLAGS)"
export LDFLAGS="$(dpkg-buildflags --get LDFLAGS)"
cmake -S expat-${version} -B compiled \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr \
  -DCMAKE_INSTALL_LIBDIR=lib/${multiarch} \
  -DEXPAT_SHARED_LIBS=ON -DEXPAT_BUILD_TESTS=ON \
  -DEXPAT_BUILD_TOOLS=ON -DEXPAT_BUILD_EXAMPLES=OFF \
  -DEXPAT_BUILD_DOCS=OFF -DEXPAT_BUILD_FUZZERS=OFF
cmake --build compiled --parallel 2
ctest --test-dir compiled --output-on-failure
mkdir -p /out /package/DEBIAN /package/usr/lib/${multiarch} /package/usr/share/doc/libexpat1
cp -a compiled/libexpat.so.1* /package/usr/lib/${multiarch}/
strip --strip-unneeded /package/usr/lib/${multiarch}/libexpat.so.1.12.4
cp expat-${version}/COPYING /package/usr/share/doc/libexpat1/copyright
cp expat-${version}/Changes /package/usr/share/doc/libexpat1/changelog
cp build-package.sh /package/usr/share/doc/libexpat1/build-recipe.sh
printf 'Upstream: %s\nSource-SHA256: %s\nUpstream source is unmodified. Built on Debian 13 using upstream CMake and Debian hardening flags.\n' "$source_url" "$source_sha256" > /package/usr/share/doc/libexpat1/source-provenance.txt
# Let dpkg-shlibdeps derive minimum runtime dependencies from the produced ELF.
mkdir -p debian
printf 'Source: expat\nSection: libs\nPriority: optional\nMaintainer: Model Lab local build <noreply@example.invalid>\n\nPackage: libexpat1\nArchitecture: any\nDescription: local upstream Expat runtime build\n' > debian/control
depends=$(dpkg-shlibdeps -O /package/usr/lib/${multiarch}/libexpat.so.1.12.4 | sed 's/^shlibs:Depends=//')
cat > /package/DEBIAN/control <<EOF
Package: libexpat1
Source: expat
Version: ${version}-0modellab1
Section: libs
Priority: optional
Architecture: ${arch}
Multi-Arch: same
Maintainer: Model Lab local build <noreply@example.invalid>
Depends: ${depends}
Homepage: https://libexpat.github.io/
Description: Expat XML parser runtime, unmodified upstream local security build
 Source and SHA-256 are retained with the build recipe and MIT license.
EOF
printf 'activate-noawait ldconfig\n' > /package/DEBIAN/triggers
printf 'libexpat 1 libexpat1 (>= 2.8.4)\n' > /package/DEBIAN/shlibs
find /package/usr -type f -exec chmod 0644 {} +
chmod 0755 /package/usr/lib/${multiarch}/libexpat.so.1.12.4
dpkg-deb --root-owner-group --build /package /out/libexpat1_${version}-0modellab1_${arch}.deb
cc verify-expat.c -Iexpat-${version}/lib -Lcompiled -lexpat -ldl -o /out/verify-expat
readelf -d /package/usr/lib/${multiarch}/libexpat.so.1.12.4
sha256sum /out/*.deb /package/usr/lib/${multiarch}/libexpat.so.1.12.4
