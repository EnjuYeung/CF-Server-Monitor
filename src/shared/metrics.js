export const SERVER_METADATA_FIELDS = Object.freeze([
  'id',
  'name',
  'region',
  'arch',
  'os',
  'kernel_version',
  'cpu_info',
  'cpu_cores',
  'expire_date',
  'server_group',
  'traffic_limit',
  'boot_time',
  'timestamp',
  'ip_v4',
  'ip_v6'
]);

export function isDisabledProbeMetric(value) {
  return value === false || value === 'false';
}
