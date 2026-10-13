import { KIMI_SMOKE_LIMITS, kimiSmokeModel, runKimiSmoke } from './kimi-smoke.ts';

// Offline by default. --live requires prior user authorization AND network permission.
// Only the already injected key is used; never load .env or a credential store.
try {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--live') || args.length > 1) throw new Error('Use no arguments for offline preflight, or --live for one authorized request.');
  const model = kimiSmokeModel();
  const keyPresent = Boolean(process.env.KIMI_API_KEY);
  if (!args.includes('--live')) {
    console.log(JSON.stringify({ mode: 'offline', provider: model.provider, model: model.id, protocol: model.api,
      endpointVerified: true, keyPresent, limits: KIMI_SMOKE_LIMITS, requests: 0 }));
  } else {
    if (!keyPresent) throw new Error('KIMI_API_KEY is missing.');
    const result = await runKimiSmoke(process.env.KIMI_API_KEY!);
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  }
} catch {
  console.error('Kimi smoke preflight failed: check arguments, injected KIMI_API_KEY presence, and installed native model metadata.');
  process.exitCode = 1;
}
