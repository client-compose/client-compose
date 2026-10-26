package clientcompose

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"
)

// after is an island that resolves to {"after": ms} once ms have passed.
func after(ms int) Island {
	return NewIsland("x", 1, func(ctx context.Context, _ Request) (map[string]int, error) {
		select {
		case <-time.After(time.Duration(ms) * time.Millisecond):
			return map[string]int{"after": ms}, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	})
}

func TestAScreenStreamsWhatIsntReady(t *testing.T) {
	c := New(Config{Screens: []Screen{{
		ID: "s",
		Islands: []Placement{
			{Key: "quick", Versions: Versions(after(0))},
			{Key: "slow", Versions: Versions(after(150))},
			{Key: "main", Versions: Versions(after(50)), Required: true},
		},
		Meta: func(context.Context, Request) (ScreenMeta, error) { return ScreenMeta{Title: "S"}, nil },
	}}})
	srv := httptest.NewServer(c)
	defer srv.Close()

	res, err := http.Post(srv.URL+"/screens/s", "application/json", strings.NewReader(
		`{"protocol":0,"screen":"s","client":{"platform":"ios","appVersion":"1"},"islands":{"x":[1]}}`))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK || res.Header.Get("Content-Type") != "application/jsonl" {
		t.Fatalf("%d %s", res.StatusCode, res.Header.Get("Content-Type"))
	}

	type line struct {
		Kind    string        `json:"kind"`
		Islands []IslandEntry `json:"islands"`
		Meta    *ScreenMeta   `json:"meta"`
		Island  *IslandEntry  `json:"island"`
	}
	var lines []line
	scanner := bufio.NewScanner(res.Body)
	for scanner.Scan() {
		var l line
		if err := json.Unmarshal(scanner.Bytes(), &l); err != nil {
			t.Fatal(err)
		}
		lines = append(lines, l)
	}

	// The head waits for the required island and the meta, and takes what's ready by then.
	if len(lines) != 3 || lines[0].Kind != "head" || lines[0].Meta == nil || lines[0].Meta.Title != "S" {
		t.Fatalf("lines: %+v", lines)
	}
	var statuses []string
	for _, e := range lines[0].Islands {
		statuses = append(statuses, e.Key+":"+e.Status)
	}
	if !slices.Equal(statuses, []string{"quick:ok", "slow:pending", "main:ok"}) {
		t.Fatalf("head: %v", statuses)
	}
	if lines[0].Islands[1].Props != nil {
		t.Fatalf("a pending island has no props: %+v", lines[0].Islands[1])
	}
	// The rest follow, then the end.
	if lines[1].Kind != "island" || lines[1].Island.Key != "slow" || lines[1].Island.Status != "ok" || lines[2].Kind != "end" {
		t.Fatalf("after the head: %+v %+v", lines[1], lines[2])
	}
}

func TestAScreenWhoseRequiredIslandFailsFailsBeforeItsHead(t *testing.T) {
	failing := NewIsland("x", 1, func(context.Context, Request) (int, error) { return 0, errors.New("down") })
	c := New(Config{Screens: []Screen{{ID: "s", Islands: []Placement{
		{Key: "slow", Versions: Versions(after(500))},
		{Key: "main", Versions: Versions(failing), Required: true},
	}}}})
	started := time.Now()
	res := c.Compose(context.Background(), ScreenRequest{Protocol: new(int), Screen: "s", Client: &ClientContext{}, Islands: map[string][]int{"x": {1}}})
	if res.Status != http.StatusBadGateway || res.Body.(ErrorResponse).Error.Code != "required_island_failed" {
		t.Fatalf("got %+v", res)
	}
	if time.Since(started) > 400*time.Millisecond {
		t.Fatal("a failed screen doesn't wait for its other islands")
	}
}

func TestReadScreenPutsAStreamTogether(t *testing.T) {
	stream := strings.Join([]string{
		`{"kind":"head","protocol":0,"screen":"s","islands":[{"key":"a","type":"x","version":1,"status":"pending"},{"key":"b","type":"x","version":1,"status":"pending"}]}`,
		`{"kind":"later","note":"a kind it doesn't know"}`,
		`{"kind":"island","island":{"key":"b","type":"x","version":1,"status":"ok","props":{"v":1}}}`,
		`{"kind":"island","island":{"key":"z","type":"x","version":1,"status":"ok","props":{}}}`,
		`{"kind":"end"}`,
	}, "\n")
	head, screen, err := ReadScreen(strings.NewReader(stream))
	if err != nil || head.Islands[1].Status != "pending" || screen.Islands[1].Status != "ok" || screen.Islands[0].Status != "pending" || len(screen.Islands) != 2 {
		t.Fatalf("%v %+v %+v", err, head, screen)
	}

	// Without its end, what's still pending is incomplete.
	cut := strings.Join(strings.Split(stream, "\n")[:3], "\n")
	_, screen, err = ReadScreen(strings.NewReader(cut))
	if !errors.Is(err, ErrIncomplete) || screen.Islands[0].Status != "error" || screen.Islands[0].Error.Code != "incomplete" || !screen.Islands[0].Error.Retryable {
		t.Fatalf("cut short: %v %+v", err, screen.Islands[0])
	}
}
