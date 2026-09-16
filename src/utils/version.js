// Version advertised by this controller's bundled or archived Agent artifacts.
export async function getRemoteVersion(env) {
  const latest = await env?.AGENT_DISTRIBUTION?.latest();
  return { agent: latest?.version || '' };
}
