package cfprobe

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"
	"time"
)

func TestCommandOutputHelperProcess(t *testing.T) {
	if len(os.Args) < 3 || os.Args[len(os.Args)-2] != "cf-probe-command-test" {
		return
	}
	switch os.Args[len(os.Args)-1] {
	case "wait":
		time.Sleep(time.Minute)
	case "success":
		_, _ = os.Stdout.WriteString("  counter output\n")
	case "failure":
		_, _ = os.Stdout.WriteString("incomplete counters")
		os.Exit(1)
	case "inherited-pipe":
		cmd := exec.Command(os.Args[0], "-test.run=^TestCommandOutputHelperProcess$", "--", "cf-probe-command-test", "wait")
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		if err := cmd.Start(); err != nil {
			os.Exit(2)
		}
		if err := os.WriteFile(os.Getenv("CFPROBE_TEST_PIPE_PID"), []byte(strconv.Itoa(cmd.Process.Pid)), 0o600); err != nil {
			_ = cmd.Process.Kill()
			os.Exit(2)
		}
		_, _ = os.Stdout.WriteString("child started\n")
		// The grandchild outlives its parent and holds the pipe open.
	}
	os.Exit(0)
}

func TestCommandOutputBoundsInheritedPipeWait(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX inherited pipe lifecycle")
	}
	pidFile := filepath.Join(t.TempDir(), "child.pid")
	t.Setenv("CFPROBE_TEST_PIPE_PID", pidFile)
	t.Cleanup(func() {
		if raw, err := os.ReadFile(pidFile); err == nil {
			pid, _ := strconv.Atoi(string(raw))
			if process, err := os.FindProcess(pid); err == nil {
				_ = process.Kill()
			}
		}
	})
	started := time.Now()
	_, err := commandOutputWithTimeout(200*time.Millisecond, os.Args[0], "-test.run=^TestCommandOutputHelperProcess$", "--", "cf-probe-command-test", "inherited-pipe")
	if err == nil || time.Since(started) > 5*time.Second {
		t.Fatalf("pipe wait not bounded: %v", err)
	}
}

func TestCommandOutputTimeout(t *testing.T) {
	started := time.Now()
	_, err := commandOutputWithTimeout(200*time.Millisecond, os.Args[0], "-test.run=^TestCommandOutputHelperProcess$", "--", "cf-probe-command-test", "wait")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("got %v, want deadline exceeded", err)
	}
	if time.Since(started) > 5*time.Second {
		t.Fatal("timed out command did not stop promptly")
	}
}

func TestCommandOutputSuccessAndFailure(t *testing.T) {
	for _, mode := range []string{"success", "failure"} {
		t.Run(mode, func(t *testing.T) {
			out, err := commandOutputWithTimeout(5*time.Second, os.Args[0], "-test.run=^TestCommandOutputHelperProcess$", "--", "cf-probe-command-test", mode)
			if mode == "success" {
				if err != nil || out != "counter output" {
					t.Fatalf("output=%q error=%v", out, err)
				}
			} else if err == nil || out != "" {
				t.Fatalf("failed command returned usable output: %q, %v", out, err)
			}
		})
	}
}
