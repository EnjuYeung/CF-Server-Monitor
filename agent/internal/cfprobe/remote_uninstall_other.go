//go:build !linux

package cfprobe

import "fmt"

func scheduleRemoteUninstall(_ Paths, _ Config) error {
	return fmt.Errorf("remote uninstall is only supported on Linux")
}

func executeRemoteUninstall(_ string) error {
	return fmt.Errorf("remote uninstall is only supported on Linux")
}
