// UUID identifies the configured node; instance_id identifies one creation lifetime.
export function isSameServerInstance(first, second) {
  return (first?.instance_id || '') === (second?.instance_id || '');
}

export function serverInstanceKey(server) {
  return [String(server.id), server.instance_id || ''];
}
