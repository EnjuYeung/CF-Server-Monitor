export function toPublicIpReachability(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized && normalized !== '0' && normalized !== 'false' ? '1' : '0';
}

export function maskPublicIpFields(data) {
  if (!data || typeof data !== 'object') return data;
  let masked = data;
  const ensureMaskedCopy = () => {
    if (masked === data) masked = { ...data };
  };

  if (Object.prototype.hasOwnProperty.call(data, 'ip_v4')) {
    ensureMaskedCopy();
    masked.ip_v4 = toPublicIpReachability(data.ip_v4);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'ip_v6')) {
    ensureMaskedCopy();
    masked.ip_v6 = toPublicIpReachability(data.ip_v6);
  }
  for (const field of ['data', 'payload', 'metrics']) {
    if (data[field] && typeof data[field] === 'object' && !Array.isArray(data[field])) {
      const nested = maskPublicIpFields(data[field]);
      if (nested !== data[field]) {
        ensureMaskedCopy();
        masked[field] = nested;
      }
    }
  }
  return masked;
}

export function maskPublicIpSample(sample) {
  if (!sample || typeof sample !== 'object') return sample;
  if (sample.data && typeof sample.data === 'object') {
    return { ...sample, data: maskPublicIpFields(sample.data) };
  }
  if (sample.payload && typeof sample.payload === 'object') {
    return { ...sample, payload: maskPublicIpFields(sample.payload) };
  }
  if (sample.metrics && typeof sample.metrics === 'object') {
    return { ...sample, metrics: maskPublicIpFields(sample.metrics) };
  }
  return sample;
}

export function maskPublicIpUpdate(update) {
  if (!update || !Array.isArray(update.samples)) return update;
  return {
    ...update,
    samples: update.samples.map(maskPublicIpSample)
  };
}
