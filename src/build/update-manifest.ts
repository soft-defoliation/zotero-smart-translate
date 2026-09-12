/**
 * Release build helper — update.json generation.
 */

export interface UpdateManifest {
  version: string;
  xpiDownloadLink: string;
  updateLink: string;
}

export function buildUpdateManifest(manifest: UpdateManifest): string {
  return JSON.stringify(
    {
      addons: {
        "smart-translate-for-zotero@fengqiu": {
          version: manifest.version,
          xpiDownloadLink: manifest.xpiDownloadLink,
          updateLink: manifest.updateLink,
          applied: new Date().toISOString(),
        },
      },
    },
    null,
    2,
  );
}
