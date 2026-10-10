// ─────────────────────────────────────────────────────────────────────────
// electron-builder · afterPack: endurece el ejecutable con los "fuses" de
// Electron (interruptores grabados en el binario, no se cambian sin recompilar).
//
//  · RunAsNode / NODE_OPTIONS / --inspect desactivados → nadie puede usar
//    LivePads.exe como un Node.js cualquiera ni inyectarle código o depurarlo.
//  · OnlyLoadAppFromAsar + AsarIntegrityValidation → la app solo arranca desde
//    su app.asar y Windows comprueba su huella (electron-builder la graba antes
//    de este paso): si alguien modifica el código, la app no abre.
//  · Cookies cifradas con la clave del sistema.
// ─────────────────────────────────────────────────────────────────────────

const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

exports.default = async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const exe = electronPlatformName === 'darwin'
    ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`)
    : electronPlatformName === 'win32'
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.exe`)
      : path.join(appOutDir, packager.executableName);

  await flipFuses(exe, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
  console.log('  • fuses de seguridad aplicados a', path.basename(exe));
};
