package clientcompose

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
)

// ScreenStream is a screen as it's answered (spec §4.6): its head, ready, then each of its pending
// islands as it's resolved. It's a successful screen Result's Body.
type ScreenStream struct {
	// Head is the screen, with each island resolved or pending.
	Head ScreenResponse
	// Islands delivers each pending island's entry once it's resolved, and is closed after the
	// last. Read it to the end, or use Collect.
	Islands <-chan IslandEntry
}

// Collect reads the rest of the stream, and returns the screen with every island in place.
func (s *ScreenStream) Collect() ScreenResponse {
	resp := s.Head
	resp.Islands = slices.Clone(s.Head.Islands)
	for entry := range s.Islands {
		for i := range resp.Islands {
			if resp.Islands[i].Key == entry.Key && resp.Islands[i].Status == statusPending {
				resp.Islands[i] = entry
			}
		}
	}
	return resp
}

// statusPending is an island in a stream's head that's still being resolved.
const statusPending = "pending"

// The kinds of line in a stream.
const (
	lineHead   = "head"
	lineIsland = "island"
	lineEnd    = "end"
)

type headLine struct {
	Kind string `json:"kind"`
	ScreenResponse
}

type islandLine struct {
	Kind   string      `json:"kind"`
	Island IslandEntry `json:"island"`
}

type endLine struct {
	Kind string `json:"kind"`
}

// writeStream writes a screen as a stream, a line at a time, sending each as soon as it's written.
func writeStream(w http.ResponseWriter, s *ScreenStream) {
	w.Header().Set("Content-Type", "application/jsonl")
	w.WriteHeader(http.StatusOK)
	flusher := http.NewResponseController(w)
	enc := json.NewEncoder(w) // Encode ends each value with a newline
	send := func(line any) bool {
		if err := enc.Encode(line); err != nil {
			return false // the client has gone: its request's context ends the islands
		}
		_ = flusher.Flush() // not every ResponseWriter can flush; it's sent at the end then
		return true
	}
	if !send(headLine{Kind: lineHead, ScreenResponse: s.Head}) {
		return
	}
	for entry := range s.Islands {
		if !send(islandLine{Kind: lineIsland, Island: entry}) {
			return
		}
	}
	send(endLine{Kind: lineEnd})
}

// ErrIncomplete means a stream ended before its end line.
var ErrIncomplete = errors.New("clientcompose: stream ended early")

// ReadScreen reads a screen's stream (spec §4.6) to its end: its head, and the screen with every
// island in place. If the stream ends early, the islands still pending are errors with code
// "incomplete", and the error is ErrIncomplete.
func ReadScreen(body io.Reader) (head, screen ScreenResponse, err error) {
	lines := bufio.NewScanner(body)
	lines.Buffer(make([]byte, 64*1024), maxBodyBytes*16)
	sawHead := false
	for lines.Scan() {
		if len(lines.Bytes()) == 0 {
			continue
		}
		var line struct {
			Kind   string       `json:"kind"`
			Island *IslandEntry `json:"island"`
		}
		if err := json.Unmarshal(lines.Bytes(), &line); err != nil {
			return head, screen, fmt.Errorf("clientcompose: a stream line: %w", err)
		}
		switch {
		case line.Kind == lineHead && !sawHead:
			if err := json.Unmarshal(lines.Bytes(), &head); err != nil {
				return head, screen, fmt.Errorf("clientcompose: a stream's head: %w", err)
			}
			sawHead = true
			screen = head
			screen.Islands = slices.Clone(head.Islands)
		case line.Kind == lineIsland && sawHead && line.Island != nil:
			for i := range screen.Islands {
				if screen.Islands[i].Key == line.Island.Key && screen.Islands[i].Status == statusPending {
					screen.Islands[i] = *line.Island
				}
			}
		case line.Kind == lineEnd && sawHead:
			return head, screen, nil
		}
	}
	if err := lines.Err(); err != nil {
		return head, screen, fmt.Errorf("clientcompose: reading a stream: %w", err)
	}
	if !sawHead {
		return head, screen, fmt.Errorf("%w: no head", ErrIncomplete)
	}
	for i, e := range screen.Islands {
		if e.Status == statusPending {
			screen.Islands[i] = IslandEntry{Key: e.Key, Type: e.Type, Version: e.Version, Status: "error", Error: &IslandError{Code: "incomplete", Retryable: true}}
		}
	}
	return head, screen, ErrIncomplete
}
