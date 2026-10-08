package cfprobe

import (
	"context"
	"reflect"
	"sync"
	"testing"
	"testing/synctest"
	"time"
)

func TestAutoUpdateChecksAtStartupAndEveryDay(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		var reasons []string
		var reasonsMu sync.Mutex
		go runAutoUpdateChecks(ctx, true, func(reason string) {
			reasonsMu.Lock()
			defer reasonsMu.Unlock()
			reasons = append(reasons, reason)
		})
		snapshot := func() []string {
			reasonsMu.Lock()
			defer reasonsMu.Unlock()
			return append([]string(nil), reasons...)
		}
		synctest.Wait()
		if got := snapshot(); !reflect.DeepEqual(got, []string{"startup"}) {
			t.Fatal(got)
		}
		time.Sleep(24*time.Hour - time.Second)
		synctest.Wait()
		if got := snapshot(); len(got) != 1 {
			t.Fatalf("checked before daily deadline: %v", got)
		}
		time.Sleep(time.Second)
		synctest.Wait()
		time.Sleep(24 * time.Hour)
		synctest.Wait()
		if got := snapshot(); !reflect.DeepEqual(got, []string{"startup", "daily", "daily"}) {
			t.Fatal(got)
		}
		cancel()
		synctest.Wait()
		time.Sleep(48 * time.Hour)
		synctest.Wait()
		if got := snapshot(); len(got) != 3 {
			t.Fatal("checks continued after shutdown", got)
		}
	})
}

func TestAutoUpdateDisabledDoesNotCheck(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		calls := 0
		go runAutoUpdateChecks(context.Background(), false, func(string) { calls++ })
		synctest.Wait()
		time.Sleep(72 * time.Hour)
		synctest.Wait()
		if calls != 0 {
			t.Fatal("installation without AUTO_UPDATE checked for updates")
		}
	})
}

func TestAutoUpdateCancelledBeforeStartupDoesNotCheck(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	runAutoUpdateChecks(ctx, true, func(string) { t.Fatal("checked after cancellation") })
}
