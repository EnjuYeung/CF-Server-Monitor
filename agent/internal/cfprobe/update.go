package cfprobe

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	autoUpdateCheckInterval  = 6 * time.Hour
	autoUpdateLockTTL        = 30 * time.Minute
	snapshotVersionPrefix    = "Snapshot-"
	updateChecksumsAssetName = "checksums.txt"
)

type agentRelease struct {
	TagName     string              `json:"version"`
	Name        string              `json:"name"`
	Draft       bool                `json:"draft"`
	Prerelease  bool                `json:"prerelease"`
	PublishedAt time.Time           `json:"published_at"`
	Assets      []agentReleaseAsset `json:"assets"`
}

type agentReleaseAsset struct {
	Name string `json:"name"`
	Size int    `json:"size"`
}

type updateCandidate struct {
	TagName     string
	AssetName   string
	Snapshot    bool
	PublishedAt time.Time
}

type updateVersion struct {
	major int
	minor int
	patch int
	pre   []string
}

func (a *Agent) autoUpdateWorker(ctx context.Context) {
	a.checkAndScheduleAgentUpdate("startup")

	ticker := time.NewTicker(autoUpdateCheckInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.checkAndScheduleAgentUpdate("periodic")
		}
	}
}

func (a *Agent) checkAndScheduleAgentUpdate(reason string) {
	cfg := a.configSnapshot()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	candidate, ok, err := checkLatestUpdate(ctx, a.version, cfg)
	if err != nil {
		a.log.info("auto update check failed reason=%s: %v", reason, err)
		return
	}
	if !ok {
		a.log.info("auto update checked: current version is up to date reason=%s version=%s", reason, a.version)
		return
	}

	a.scheduleAgentUpdate(candidate, reason, cfg)
}

func checkLatestUpdate(ctx context.Context, currentVersion string, cfg Config) (updateCandidate, bool, error) {
	base, err := agentDownloadBase(cfg)
	if err != nil {
		return updateCandidate{}, false, err
	}
	assetName := expectedUpdateAssetName(runtime.GOOS, runtime.GOARCH)
	releases, err := listAgentReleases(ctx, base, usePublicDNSResolver(cfg))
	if err != nil {
		return updateCandidate{}, false, err
	}

	if strings.HasPrefix(currentVersion, snapshotVersionPrefix) {
		candidate, ok := selectLatestSnapshotRelease(releases, assetName)
		if !ok || candidate.TagName == currentVersion {
			return updateCandidate{}, false, nil
		}
		return candidate, true, nil
	}

	current, err := parseUpdateVersion(currentVersion)
	if err != nil {
		return updateCandidate{}, false, fmt.Errorf("parse current version %q: %w", currentVersion, err)
	}
	candidate, ok := selectLatestStableRelease(releases, assetName, current)
	if !ok {
		return updateCandidate{}, false, nil
	}
	return candidate, true, nil
}

// Version metadata comes from the controller (or an explicitly configured mirror).
func listAgentReleases(ctx context.Context, base string, usePublicDNS bool) ([]agentRelease, error) {
	client := newUpdateHTTPClient(30*time.Second, usePublicDNS)
	body, err := downloadToString(ctx, client, base+"/releases.json", 1<<20)
	if err != nil {
		return nil, err
	}
	var releases []agentRelease
	if err := json.Unmarshal([]byte(body), &releases); err != nil {
		return nil, err
	}
	return releases, nil
}

func selectLatestStableRelease(releases []agentRelease, assetName string, current updateVersion) (updateCandidate, bool) {
	var latest updateCandidate
	var latestVersion updateVersion
	found := false
	for _, release := range releases {
		if release.Draft || release.Prerelease {
			continue
		}
		if _, ok := findReleaseAsset(release, assetName); !ok {
			continue
		}
		version, err := parseUpdateVersion(release.TagName)
		if err != nil || compareUpdateVersion(version, current) <= 0 {
			continue
		}
		if !found || compareUpdateVersion(version, latestVersion) > 0 ||
			(compareUpdateVersion(version, latestVersion) == 0 && release.PublishedAt.After(latest.PublishedAt)) {
			latest = updateCandidate{
				TagName:     release.TagName,
				AssetName:   assetName,
				PublishedAt: release.PublishedAt,
			}
			latestVersion = version
			found = true
		}
	}
	return latest, found
}

func selectLatestSnapshotRelease(releases []agentRelease, assetName string) (updateCandidate, bool) {
	var latest updateCandidate
	found := false
	for _, release := range releases {
		if release.Draft || !release.Prerelease || !strings.HasPrefix(release.TagName, snapshotVersionPrefix) {
			continue
		}
		if _, ok := findReleaseAsset(release, assetName); !ok {
			continue
		}
		if !found || release.PublishedAt.After(latest.PublishedAt) ||
			(release.PublishedAt.Equal(latest.PublishedAt) && release.TagName > latest.TagName) {
			latest = updateCandidate{
				TagName:     release.TagName,
				AssetName:   assetName,
				Snapshot:    true,
				PublishedAt: release.PublishedAt,
			}
			found = true
		}
	}
	return latest, found
}

func findReleaseAsset(release agentRelease, assetName string) (agentReleaseAsset, bool) {
	for _, asset := range release.Assets {
		if asset.Name == assetName {
			return asset, true
		}
	}
	return agentReleaseAsset{}, false
}

var buildARM = "7" // Set by the cross-platform builder for ARMv5/v6/v7.

func expectedUpdateAssetName(goos, goarch string) string {
	if goos == "linux" && goarch == "arm" {
		goarch = "armv" + firstNonEmpty(buildARM, "7")
	}
	name := fmt.Sprintf("cf-probe-%s-%s", goos, goarch)
	if goos == "windows" {
		name += ".exe"
	}
	return name
}

func (a *Agent) scheduleAgentUpdate(candidate updateCandidate, reason string, cfg Config) {
	a.updateMu.Lock()
	defer a.updateMu.Unlock()

	lockFile := filepath.Join(a.paths.ConfigDir, "auto_update.lock")
	now := time.Now().Unix()
	if data, err := os.ReadFile(lockFile); err == nil {
		last := atoi64Default(string(data), 0)
		if time.Duration(now-last)*time.Second < autoUpdateLockTTL {
			a.log.info("auto update already scheduled recently")
			return
		}
	}

	base, err := agentDownloadBase(cfg)
	if err != nil {
		a.log.info("auto update source invalid: %v", err)
		return
	}
	binPath, err := fetchUpdateBinary(a.paths.ConfigDir, candidate, base, usePublicDNSResolver(cfg))
	if err != nil {
		a.log.info("auto update download failed target=%s: %v", candidate.TagName, err)
		return
	}

	method, err := scheduleUpdateInstall(a.paths, binPath, now)
	if err != nil {
		_ = os.Remove(binPath)
		a.log.info("schedule update failed: %v", err)
		return
	}
	_ = os.MkdirAll(a.paths.ConfigDir, 0o755)
	_ = os.WriteFile(lockFile, []byte(strconv.FormatInt(now, 10)), 0o600)
	a.log.info("auto update scheduled target=%s asset=%s method=%s reason=%s delay=%s",
		candidate.TagName, candidate.AssetName, method, reason, autoUpdateDelay)
}

func scheduleUpdateInstall(paths Paths, binPath string, now int64) (string, error) {
	if runtime.GOOS == "windows" {
		return scheduleWindowsUpdateInstall(paths, binPath)
	}
	if paths.UserMode {
		return scheduleUserModeUpdateInstall(paths, binPath)
	}
	return scheduleUnixUpdateInstall(paths.ServiceName, paths.LogFile, binPath, now)
}

// fetchUpdateBinary downloads from the controller and requires a valid SHA-256 checksum.
func fetchUpdateBinary(configDir string, candidate updateCandidate, base string, usePublicDNS bool) (string, error) {
	rawURL, err := updateAssetDownloadURL(candidate.TagName, candidate.AssetName, base)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		return "", err
	}
	dest := filepath.Join(configDir, "cf-probe-update.bin")
	if runtime.GOOS == "windows" {
		dest = filepath.Join(configDir, "cf-probe-update.exe")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	client := newUpdateHTTPClient(5*time.Minute, usePublicDNS)
	checksums, checksumErr := downloadUpdateChecksums(ctx, client, candidate.TagName, base)
	if checksumErr != nil {
		return "", fmt.Errorf("download required checksums: %w", checksumErr)
	}
	if err := downloadToFile(ctx, client, rawURL, dest); err != nil {
		return "", err
	}
	if checksumErr == nil {
		expected, ok := checksumForAsset(checksums, candidate.AssetName)
		if !ok {
			_ = os.Remove(dest)
			return "", fmt.Errorf("checksum missing for %s", candidate.AssetName)
		}
		if err := verifyFileSHA256(dest, expected); err != nil {
			_ = os.Remove(dest)
			return "", err
		}
	}
	return dest, nil
}

func downloadToFile(ctx context.Context, client *http.Client, rawURL, dest string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "cfsm-agent")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("download %s returned http %d", rawURL, resp.StatusCode)
	}
	tmp := dest + ".download"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, io.LimitReader(resp.Body, 512<<20))
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(tmp)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tmp)
		return closeErr
	}
	if err := os.Chmod(tmp, 0o755); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dest)
}

func downloadUpdateChecksums(ctx context.Context, client *http.Client, tag, base string) (string, error) {
	rawURL, err := updateAssetDownloadURL(tag, updateChecksumsAssetName, base)
	if err != nil {
		return "", err
	}
	return downloadToString(ctx, client, rawURL, 1<<20)
}

func downloadToString(ctx context.Context, client *http.Client, rawURL string, maxBytes int64) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "cfsm-agent")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("download %s returned http %d", rawURL, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return "", err
	}
	if int64(len(body)) > maxBytes {
		return "", fmt.Errorf("download %s exceeded %d bytes", rawURL, maxBytes)
	}
	return string(body), nil
}

func checksumForAsset(checksums, assetName string) (string, bool) {
	for _, line := range strings.Split(checksums, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 2 {
			continue
		}
		sum := strings.ToLower(fields[0])
		name := filepath.Base(fields[len(fields)-1])
		if name == assetName && validSHA256Hex(sum) {
			return sum, true
		}
	}
	return "", false
}

func validSHA256Hex(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func verifyFileSHA256(path, expected string) error {
	expected = strings.ToLower(strings.TrimSpace(expected))
	if !validSHA256Hex(expected) {
		return fmt.Errorf("invalid sha256 checksum for %s", filepath.Base(path))
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	actual := hex.EncodeToString(h.Sum(nil))
	if actual != expected {
		return fmt.Errorf("sha256 mismatch for %s", filepath.Base(path))
	}
	return nil
}
func scheduleUnixUpdateInstall(serviceName, logFile, binPath string, now int64) (string, error) {
	cmdLine := fmt.Sprintf("sleep %d; %s install; rm -f %s",
		int(autoUpdateDelay.Seconds()), quoteShell(binPath), quoteShell(binPath))
	if runtime.GOOS == "linux" && !isSynology() && fileExists("/run/systemd/system") {
		unit := fmt.Sprintf("%s-auto-update-%d", serviceName, now)
		if commandExists("systemd-run") {
			out, err := exec.Command("systemd-run", "--unit="+unit, "/bin/sh", "-c", cmdLine).CombinedOutput()
			if err == nil {
				return "systemd-run:" + unit, nil
			}
			if !commandExists("systemctl") {
				return "", fmt.Errorf("systemd-run failed: %w: %s", err, strings.TrimSpace(string(out)))
			}
		}
		return scheduleSystemdUnit(unit, cmdLine)
	}

	nohupCmd := "nohup /bin/sh -c " + quoteShell(cmdLine) + " >/dev/null 2>&1 &"
	if logFile != "" {
		nohupCmd = "nohup /bin/sh -c " + quoteShell(cmdLine) + " >>" + quoteShell(logFile) + " 2>&1 &"
	}
	cmd := exec.Command("sh", "-c", nohupCmd)
	if err := cmd.Run(); err != nil {
		return "", err
	}
	return "nohup", nil
}

func scheduleWindowsUpdateInstall(paths Paths, binPath string) (string, error) {
	script := strings.Join([]string{
		"$ErrorActionPreference = 'Continue'",
		fmt.Sprintf("Start-Sleep -Seconds %d", int(autoUpdateDelay.Seconds())),
		"& " + powerShellLiteral(binPath) + " upgrade-apply >> " + powerShellLiteral(paths.LogFile) + " 2>&1",
		"if ($LASTEXITCODE -eq 0) { Remove-Item -LiteralPath " + powerShellLiteral(binPath) + " -Force -ErrorAction SilentlyContinue }",
	}, "; ")
	cmd := exec.Command("powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", script)
	if err := cmd.Start(); err != nil {
		return "", err
	}
	_ = cmd.Process.Release()
	return "powershell", nil
}

func ApplyScheduledUpdate(buildVersion string) error {
	if runtime.GOOS != "windows" {
		return errors.New("scheduled upgrade apply is only supported on Windows")
	}
	paths := defaultPaths()
	fmt.Printf("[INFO] applying scheduled update version=%s target=%s\n", buildVersion, paths.BinaryFile)
	return applyWindowsScheduledUpdate(paths)
}

func scheduleUserModeUpdateInstall(paths Paths, binPath string) (string, error) {
	if paths.BinaryFile == "" {
		return "", errors.New("installed binary path is empty")
	}
	if err := os.MkdirAll(filepath.Dir(paths.BinaryFile), 0o755); err != nil {
		return "", err
	}
	if err := os.Chmod(binPath, 0o755); err != nil {
		return "", err
	}
	staged := paths.BinaryFile + ".update"
	_ = os.Remove(staged)
	if err := os.Rename(binPath, staged); err != nil {
		return "", err
	}
	if err := os.Rename(staged, paths.BinaryFile); err != nil {
		_ = os.Remove(staged)
		return "", err
	}
	time.AfterFunc(autoUpdateDelay, func() {
		os.Exit(42)
	})
	return "self-replace", nil
}

// agentDownloadBase never forwards report query parameters or credentials.
func agentDownloadBase(cfg Config) (string, error) {
	raw := strings.TrimSpace(cfg.DownloadURL)
	if raw == "" {
		u, err := url.Parse(cfg.ControllerURL)
		if err != nil {
			return "", err
		}
		switch u.Scheme {
		case "ws":
			u.Scheme = "http"
		case "wss":
			u.Scheme = "https"
		}
		u.Path = strings.TrimSuffix(strings.TrimRight(u.Path, "/"), "/update") + "/agent"
		u.RawPath, u.RawQuery, u.Fragment = "", "", ""
		raw = u.String()
	}
	return validateDownloadBase(raw)
}

func validateDownloadBase(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", err
	}
	if (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("invalid Agent download URL: HTTP(S) base URL without credentials, query or fragment required")
	}
	return strings.TrimRight(u.String(), "/"), nil
}

func updateAssetDownloadURL(tag, assetName, base string) (string, error) {
	base, err := validateDownloadBase(base)
	if err != nil {
		return "", err
	}
	if tag == "" || strings.ContainsAny(tag, "/\\") || tag == "." || tag == ".." || filepath.Base(assetName) != assetName || strings.ContainsAny(assetName, "/\\") || assetName == "" || assetName == "." || assetName == ".." {
		return "", errors.New("invalid Agent artifact name")
	}
	return base + "/" + url.PathEscape(tag) + "/" + url.PathEscape(assetName), nil
}

func powerShellLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func scheduleSystemdUnit(unit, cmdLine string) (string, error) {
	if !commandExists("systemctl") {
		return "", errors.New("systemctl unavailable under systemd")
	}
	serviceFile := filepath.Join("/run/systemd/system", unit+".service")
	content := fmt.Sprintf(`[Unit]
Description=CF Probe auto update

[Service]
Type=oneshot
ExecStart=/bin/sh -c %s

[Install]
WantedBy=multi-user.target
`, quoteSystemdExecArg(cmdLine))
	if err := os.WriteFile(serviceFile, []byte(content), 0o644); err != nil {
		return "", err
	}
	_ = runCommandQuiet("systemctl", "daemon-reload")
	out, err := exec.Command("systemctl", "start", unit+".service").CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("systemctl start failed: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return "systemd-unit:" + unit, nil
}

func quoteSystemdExecArg(s string) string {
	replacer := strings.NewReplacer(
		"\\", "\\\\",
		"\"", "\\\"",
		"%", "%%",
		"\n", " ",
	)
	return "\"" + replacer.Replace(s) + "\""
}

func parseUpdateVersion(raw string) (updateVersion, error) {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, "v")
	raw = strings.TrimPrefix(raw, "V")
	if raw == "" {
		return updateVersion{}, errors.New("empty version")
	}
	if i := strings.Index(raw, "+"); i >= 0 {
		raw = raw[:i]
	}
	core := raw
	var pre []string
	if i := strings.Index(core, "-"); i >= 0 {
		preRaw := core[i+1:]
		core = core[:i]
		if preRaw == "" {
			return updateVersion{}, errors.New("empty prerelease")
		}
		pre = strings.Split(preRaw, ".")
		for _, part := range pre {
			if part == "" {
				return updateVersion{}, errors.New("empty prerelease identifier")
			}
		}
	}
	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return updateVersion{}, fmt.Errorf("invalid semver core %q", core)
	}
	nums := [3]int{}
	for i, part := range parts {
		if part == "" {
			return updateVersion{}, fmt.Errorf("empty semver component in %q", core)
		}
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 {
			return updateVersion{}, fmt.Errorf("invalid semver component %q", part)
		}
		nums[i] = n
	}
	return updateVersion{major: nums[0], minor: nums[1], patch: nums[2], pre: pre}, nil
}

func compareUpdateVersion(a, b updateVersion) int {
	switch {
	case a.major != b.major:
		return compareInt(a.major, b.major)
	case a.minor != b.minor:
		return compareInt(a.minor, b.minor)
	case a.patch != b.patch:
		return compareInt(a.patch, b.patch)
	default:
		return comparePrerelease(a.pre, b.pre)
	}
}

func comparePrerelease(a, b []string) int {
	if len(a) == 0 && len(b) == 0 {
		return 0
	}
	if len(a) == 0 {
		return 1
	}
	if len(b) == 0 {
		return -1
	}
	for i := 0; i < len(a) && i < len(b); i++ {
		aNum, aOK := numericIdentifier(a[i])
		bNum, bOK := numericIdentifier(b[i])
		switch {
		case aOK && bOK && aNum != bNum:
			return compareInt(aNum, bNum)
		case aOK && !bOK:
			return -1
		case !aOK && bOK:
			return 1
		case !aOK && !bOK && a[i] != b[i]:
			if a[i] < b[i] {
				return -1
			}
			return 1
		}
	}
	return compareInt(len(a), len(b))
}

func numericIdentifier(raw string) (int, bool) {
	for _, r := range raw {
		if r < '0' || r > '9' {
			return 0, false
		}
	}
	n, err := strconv.Atoi(raw)
	return n, err == nil
}

func compareInt(a, b int) int {
	if a < b {
		return -1
	}
	if a > b {
		return 1
	}
	return 0
}
