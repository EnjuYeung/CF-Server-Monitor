const quotePosixShellArg = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`


const quotePosixDoubleShellArg = (value) => `"${String(value)
  .replaceAll('\\', '\\\\')
  .replaceAll('"', '\\"')
  .replaceAll('$', '\\$')
  .replaceAll('`', '\\`')}"`

const buildUninstallAsCfsmCommand = (command, trans) => {
  const runuserCommand = `runuser -u cfsm -- env HOME="\${CFSM_HOME}" XDG_RUNTIME_DIR="/run/user/\${CFSM_UID}" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/\${CFSM_UID}/bus" sh -c ${quotePosixDoubleShellArg(command)}`
  return [
    '(',
    'set -e',
    `if ! command -v runuser >/dev/null 2>&1; then echo ${quotePosixDoubleShellArg(trans.dedicatedUserUninstallUnsupported)} >&2; exit 1; fi`,
    `id cfsm >/dev/null 2>&1 || { echo ${quotePosixDoubleShellArg(trans.nonRootUninstallUserMissing)} >&2; exit 1; }`,
    'CFSM_UID=$(id -u cfsm)',
    'CFSM_HOME=$(getent passwd cfsm | cut -d: -f6); [ -n "${CFSM_HOME}" ] || CFSM_HOME=/home/cfsm',
    'if [ "$(id -u)" -eq 0 ]; then',
    `  ${runuserCommand}`,
    'elif command -v sudo >/dev/null 2>&1; then',
    `  sudo ${runuserCommand}`,
    'else',
    `  echo ${quotePosixDoubleShellArg(trans.nonRootInstallSudoRequired)} >&2; exit 1`,
    'fi',
    ')'
  ].join('\n')
}

const buildInstallAsCfsmCommand = (command, runStep, trans) => {
  const lines = [
    '(',
    'set -e',
    `if [ ! -d /run/systemd/system ] || ! command -v systemctl >/dev/null 2>&1 || ! command -v loginctl >/dev/null 2>&1 || ! command -v useradd >/dev/null 2>&1 || ! command -v runuser >/dev/null 2>&1; then echo ${quotePosixDoubleShellArg(trans.dedicatedUserSystemdRequired)} >&2; exit 1; fi`,
    'if [ "$(id -u)" -eq 0 ]; then',
    '  as_root() { "$@"; }',
    'elif command -v sudo >/dev/null 2>&1; then',
    '  as_root() { sudo "$@"; }',
    'else',
    `  echo ${quotePosixDoubleShellArg(trans.nonRootInstallSudoRequired)} >&2; exit 1`,
    'fi'
  ]

  lines.push(
    'id cfsm >/dev/null 2>&1 || as_root useradd -m -s /bin/sh cfsm',
    'as_root loginctl enable-linger cfsm'
  )

  lines.push(
    'CFSM_UID=$(id -u cfsm)',
    'as_root systemctl start user@${CFSM_UID}.service',
    'if command -v getent >/dev/null 2>&1; then CFSM_HOME=$(getent passwd cfsm | cut -d: -f6); else CFSM_HOME=/home/cfsm; fi; [ -n "${CFSM_HOME}" ] || CFSM_HOME=/home/cfsm',
    '',
    `# ${runStep}`,
    `as_root runuser -u cfsm -- env HOME="\${CFSM_HOME}" XDG_RUNTIME_DIR="/run/user/\${CFSM_UID}" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/\${CFSM_UID}/bus" sh -c ${quotePosixDoubleShellArg(command)}`,
    ')'
  )
  return lines.join('\n')
}

export const buildAgentInstallCommand = (options, trans = {}) => {
  const { selectedApiBase, targetOs, installMode, copyServerId, apiSecret, autoUpdate } = options
  const HOST = selectedApiBase
  const downloadBase = `${HOST}/agent`
  const isDedicatedUserInstall = targetOs === 'linux' && installMode === 'cfsm-user'
  // 采集间隔、连接模式、探测节点、网卡和流量校正都由主控在首次上报时下发，命令只保留连接主控所需的参数。
  const params = [
    'install',
    `--download-url=${downloadBase}`,
    `-id=${copyServerId}`,
    `-secret=${apiSecret}`,
    `-url=${HOST}/update`,
    `-auto_update=${autoUpdate ? 1 : 0}`
  ]
  const scriptUrl = `${HOST}/agent/install.sh`
  const installCommand = `curl -fsSL ${quotePosixShellArg(scriptUrl)} | sh -s -- ${params.map(quotePosixShellArg).join(' ')}`
  return isDedicatedUserInstall ? buildInstallAsCfsmCommand(installCommand, trans.nonRootInstallRunStep, trans) : installCommand
}

export const buildAgentUninstallCommand = (baseUrl, targetOs, installMode, trans = {}) => {
  const command = 'curl -fsSL ' + quotePosixShellArg(baseUrl + '/agent/install.sh') + ' | sh -s -- uninstall ' + quotePosixShellArg('--download-url=' + baseUrl + '/agent');
  return targetOs === 'linux' && installMode === 'cfsm-user' ? buildUninstallAsCfsmCommand(command, trans) : command;
};
