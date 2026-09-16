import QRCode from 'qrcode';
import { validatePasswordCredentials, checkAuth, generateToken, buildAuthCookie } from '../middleware/auth.js';
import { consumeFactor, startSetup, enableTwoFactor, securityStatus } from '../services/twoFactor.js';

const failure = (error, status = 400) => Response.json({ error }, { status });

export async function handleTwoFactorAction({ request, env, sys, data }) {
  if (data.action === 'two_factor_status') return Response.json(securityStatus(env.DB));
  if (!['two_factor_setup', 'two_factor_enable', 'two_factor_disable'].includes(data.action)) return failure('invalidAction');
  const username = sys.username || env.API_USER_NAME || 'admin';
  const credentials = await validatePasswordCredentials(username, data.password, env, sys);
  if (!credentials.valid) return failure('invalidCredentials');
  // Recheck after asynchronous password verification, in case another session changed 2FA.
  if (!await checkAuth(request, env, sys)) return failure('Unauthorized', 401);
  const owner = request.headers.get('Authorization');
  if (data.action === 'two_factor_setup') {
    const setup = startSetup(env, owner, username, request.url);
    if (!setup) return failure('twoFactorAlreadyEnabled');
    const qrCode = await QRCode.toDataURL(setup.uri, { width: 256, margin: 2, errorCorrectionLevel: 'M' });
    return Response.json({ ...setup, qrCode });
  }
  let recoveryCodes;
  if (data.action === 'two_factor_enable') {
    recoveryCodes = enableTwoFactor(env, owner, data.otp);
    if (!recoveryCodes) return failure('twoFactorSetupInvalid');
  } else if (!consumeFactor(env, data.otp, data.recoveryCode, true)) {
    return failure('invalidTwoFactorCode');
  }
  // Changing 2FA invalidates every existing session; only this verified session is renewed.
  env.REALTIME_HUB?.revokeFrontendSessions();
  const token = await generateToken(env, sys);
  return Response.json({ ...securityStatus(env.DB), token, recoveryCodes }, {
    headers: { 'Set-Cookie': buildAuthCookie(request, token) }
  });
}
