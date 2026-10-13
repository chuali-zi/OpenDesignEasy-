import type { LaunchOptions } from 'playwright';

/** Reuse an installed browser without downloading or changing the host setup. */
export function browserLaunchOptions(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): LaunchOptions {
  if (env.OEY_BROWSER_EXECUTABLE) return { headless: true, executablePath: env.OEY_BROWSER_EXECUTABLE };
  return { headless: true, channel: env.OEY_BROWSER_CHANNEL ?? (platform === 'win32' ? 'chrome' : undefined) };
}
