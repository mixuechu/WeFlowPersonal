export function trayIconCandidateNames(platform: NodeJS.Platform): string[] {
  if (platform === 'darwin') return ['icon.png', 'icon.icns']
  if (platform === 'linux') return ['icon.png']
  return ['icon.ico']
}

export function trayIconTargetSize(platform: NodeJS.Platform): number | null {
  return platform === 'darwin' ? 18 : null
}
