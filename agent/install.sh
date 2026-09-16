#!/bin/sh
set -eu

DOWNLOAD_URL=""
REPORT_URL=""
INSTALL_VERSION="latest"

log() { printf '%s\n' "$*"; }
die() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

need_value_for=""
for arg in "$@"; do
    if [ -n "$need_value_for" ]; then
        case "$need_value_for" in
            download) DOWNLOAD_URL="$arg" ;;
            report) REPORT_URL="$arg" ;;
            version) INSTALL_VERSION="$arg" ;;
        esac
        need_value_for=""
        continue
    fi
    case "$arg" in
        --download-url=*|-download-url=*) DOWNLOAD_URL="${arg#*=}" ;;
        --download-url|-download-url) need_value_for="download" ;;
        -url=*|--url=*) REPORT_URL="${arg#*=}" ;;
        -url|--url) need_value_for="report" ;;
        --install-version=*) INSTALL_VERSION="${arg#*=}" ;;
        --install-version) need_value_for="version" ;;
    esac
done
[ -z "$need_value_for" ] || die "missing value for $need_value_for"
if [ -z "$DOWNLOAD_URL" ]; then
    [ -n "$REPORT_URL" ] || die "provide -url=CONTROLLER_URL or --download-url=CONTROLLER_BASE/agent"
    controller="${REPORT_URL%%\?*}"
    controller="${controller%%\#*}"
    controller="${controller%/}"
    DOWNLOAD_URL="${controller%/update}/agent"
fi
DOWNLOAD_URL="${DOWNLOAD_URL%/}"
case "$DOWNLOAD_URL" in http://*|https://*) ;; *) die "download URL must use HTTP(S)" ;; esac
case "$DOWNLOAD_URL" in *\?*|*\#*|*' '*|*'@'*) die "download URL cannot contain credentials, whitespace, query or fragment" ;; esac

detect_os() {
    os="$(uname -s 2>/dev/null || printf unknown)"
    case "$os" in
        Linux) printf linux ;;
        FreeBSD) printf freebsd ;;
        *) die "unsupported OS: $os (supported: Linux and FreeBSD)" ;;
    esac
}

detect_arch() {
    arch="$(uname -m 2>/dev/null || printf unknown)"
    case "$arch" in
        x86_64|amd64) printf amd64 ;;
        aarch64|arm64) printf arm64 ;;
        *) die "unsupported architecture: $arch (supported: amd64 and arm64)" ;;
    esac
}

download() {
    if command -v curl >/dev/null 2>&1; then
        curl -fL --connect-timeout 10 -m 120 -o "$2" "$1"
    elif command -v wget >/dev/null 2>&1; then
        wget -O "$2" "$1"
    else
        die "curl or wget is required for bootstrap download"
    fi
}

run_payload() {
    bin="$1"
    shift
    case "${cmd:-${1:-install}}" in
        uninstall|remove|delete|purge)
            "$bin" "$cmd"
            return
            ;;
    esac
    if [ "$#" -eq 0 ]; then
        "$bin" install
        return
    fi
    "$bin" "$@"
}

run_payload_checked() {
    err_file="$1"
    shift
    if run_payload "$@" 2>"$err_file"; then
        return 0
    else
        rc=$?
        return "$rc"
    fi
}

dir_has_noexec() {
    dir="$1"
    if command -v findmnt >/dev/null 2>&1; then
        opts="$(findmnt -no OPTIONS -T "$dir" 2>/dev/null || true)"
        case ",$opts," in
            *,noexec,*) return 0 ;;
        esac
    fi
    return 1
}

stage_and_run_payload() {
    dir="$1"
    shift
    [ -n "$dir" ] || return 125
    if dir_has_noexec "$dir"; then
        return 126
    fi
    mkdir -p "$dir" 2>/dev/null || return 125
    stage="$dir/.cf-probe-bootstrap.$$"
    stage_err="$stage.err"
    cp "$tmp" "$stage" 2>/dev/null || return 125
    chmod +x "$stage" 2>/dev/null || {
        rm -f "$stage"
        return 125
    }
    if run_payload_checked "$stage_err" "$stage" "$@"; then
        rc=0
    else
        rc=$?
        if [ "$rc" -ne 126 ]; then
            cat "$stage_err" >&2 2>/dev/null || true
        fi
    fi
    rm -f "$stage" "$stage_err"
    return "$rc"
}

cmd="${1:-install}"
case "$cmd" in
    uninstall|remove|delete|purge)
        log "[INFO] downloading temporary uninstaller"
        ;;
esac

os_name="$(detect_os)"
arch_name="$(detect_arch)"
asset="cf-probe-${os_name}-${arch_name}"

tmp_dir="${TMPDIR:-/tmp}"
work_dir="$(mktemp -d "${tmp_dir%/}/cf-probe-bootstrap.XXXXXXXX")" || die "cannot create temporary directory"
tmp="$work_dir/$asset"
tmp_err="$work_dir/error.log"
trap 'rm -rf "$work_dir"' EXIT INT TERM

if [ "$INSTALL_VERSION" = "latest" ]; then
    download "$DOWNLOAD_URL/latest" "$work_dir/version"
    INSTALL_VERSION="$(tr -d '\r\n' < "$work_dir/version")"
fi
case "$INSTALL_VERSION" in ''|.*|*[!A-Za-z0-9._-]*) die "invalid Agent version" ;; esac
url="$DOWNLOAD_URL/$INSTALL_VERSION/$asset"
log "Server Monitor native Agent bootstrap"
log "  version : $INSTALL_VERSION"
log "  target  : $os_name/$arch_name"
log "  source  : $DOWNLOAD_URL"
download "$DOWNLOAD_URL/$INSTALL_VERSION/checksums.txt" "$work_dir/checksums.txt"
expected="$(awk -v name="$asset" '$2 == name { print $1 }' "$work_dir/checksums.txt")"
[ "${#expected}" -eq 64 ] || die "missing checksum for $asset"
case "$expected" in *[!a-f0-9]*) die "invalid checksum" ;; esac
download "$url" "$tmp"
if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$tmp" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$tmp" | awk '{print $1}')"
elif command -v sha256 >/dev/null 2>&1; then
    actual="$(sha256 -q "$tmp")"
else
    die "SHA-256 verification requires sha256sum, shasum, or sha256"
fi
[ "$actual" = "$expected" ] || die "SHA-256 mismatch for $asset"
chmod +x "$tmp"

status=126
if ! dir_has_noexec "$tmp_dir"; then
    if run_payload_checked "$tmp_err" "$tmp" "$@"; then
        exit 0
    else
        status=$?
    fi
    if [ "$status" -ne 126 ]; then
        cat "$tmp_err" >&2 2>/dev/null || true
        exit "$status"
    fi
fi

log "[WARN] cannot execute bootstrap binary from $tmp; trying executable staging directories"
if [ -n "${HOME:-}" ]; then
    if stage_and_run_payload "$HOME/.cf-probe/tmp" "$@"; then
        exit 0
    else
        status=$?
    fi
    if [ "$status" -ne 125 ] && [ "$status" -ne 126 ]; then
        exit "$status"
    fi
fi
fallback_dirs="/usr/local/bin /usr/bin /root ."
for dir in $fallback_dirs; do
    if stage_and_run_payload "$dir" "$@"; then
        exit 0
    else
        status=$?
    fi
    if [ "$status" -ne 125 ] && [ "$status" -ne 126 ]; then
        exit "$status"
    fi
done

die "downloaded binary could not be executed. /tmp may be mounted noexec."
