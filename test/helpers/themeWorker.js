import { createThemeFixture } from './themeFixture.js';

let fixture;
try {
  fixture = await createThemeFixture({ twoFactor: process.argv[2] === 'private' });
  const { root, built, config, owner, visible, hidden, empty, metrics, base, token, factorSecret, recoveryCodes } = fixture;
  process.send({ ready: { root, built, config: { API_SECRET: config.API_SECRET, ADMIN_PATH: config.ADMIN_PATH }, owner,
    visible, hidden, empty, metrics, base, token, factorSecret, recoveryCodes } });
  process.on('message', async ({ id, action, value }) => {
    try {
      let result = true;
      if (action === 'setCors') fixture.controller.env.CORS_ALLOWED_ORIGINS = value;
      else if (action === 'stats') result = { viewers: fixture.controller.env.REALTIME_HUB.frontendSockets.size };
      else if (action === 'disconnectViewers') for (const ws of fixture.controller.env.REALTIME_HUB.frontendSockets) ws.close(1012, 'isolated network fixture');
      else if (action === 'close') await fixture.close();
      else throw new Error('Unknown fixture action');
      process.send({ id, result }, () => { if (action === 'close') process.disconnect(); });
    } catch (error) { process.send({ id, error: error.message }); }
  });
} catch (error) { process.send({ startError: error.message }, () => process.disconnect()); }
