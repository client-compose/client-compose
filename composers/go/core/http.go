package clientcompose

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
)

const maxBodyBytes = 1 << 20

// ComposeHTTP parses and validates a raw request body, then composes (spec §8.1 error
// codes). Framework adapters (chi, gin, echo...) only need to call this.
func (c *Composer) ComposeHTTP(ctx context.Context, pathScreen string, body io.Reader) Result {
	var req ScreenRequest
	if err := json.NewDecoder(io.LimitReader(body, maxBodyBytes)).Decode(&req); err != nil {
		return fail(http.StatusBadRequest, "bad_request", "body is not valid JSON")
	}
	if req.Protocol == nil || req.Screen == "" || req.Client == nil || req.Islands == nil {
		return fail(http.StatusBadRequest, "bad_request", "body is not a screen request")
	}
	if *req.Protocol != ProtocolVersion {
		return fail(http.StatusBadRequest, "unsupported_protocol", "")
	}
	if req.Screen != pathScreen {
		return fail(http.StatusBadRequest, "screen_mismatch", req.Screen+" != "+pathScreen)
	}
	return c.Compose(ctx, req)
}

// PerformHTTP parses and validates a raw action request body, then performs the action (spec §8.1
// error codes).
func (c *Composer) PerformHTTP(ctx context.Context, pathAction string, body io.Reader) Result {
	var req ActionRequest
	if err := json.NewDecoder(io.LimitReader(body, maxBodyBytes)).Decode(&req); err != nil {
		return fail(http.StatusBadRequest, "bad_request", "body is not valid JSON")
	}
	if req.Protocol == nil || req.Action == "" || req.Version == 0 || req.Client == nil || len(req.Input) == 0 || string(req.Input) == "null" {
		return fail(http.StatusBadRequest, "bad_request", "body is not an action request")
	}
	if *req.Protocol != ProtocolVersion {
		return fail(http.StatusBadRequest, "unsupported_protocol", "")
	}
	if req.Action != pathAction {
		return fail(http.StatusBadRequest, "action_mismatch", req.Action+" != "+pathAction)
	}
	return c.Perform(ctx, req)
}

// Handler serves POST /screens/{screen} and POST /actions/{action} using net/http. Mount it at
// your root or strip a prefix with http.StripPrefix.
func (c *Composer) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /screens/{screen}", func(w http.ResponseWriter, r *http.Request) {
		WriteResult(w, c.ComposeHTTP(r.Context(), r.PathValue("screen"), r.Body))
	})
	mux.HandleFunc("POST /actions/{action}", func(w http.ResponseWriter, r *http.Request) {
		WriteResult(w, c.PerformHTTP(r.Context(), r.PathValue("action"), r.Body))
	})
	return mux
}

// WriteResult writes a Result as a JSON response.
func WriteResult(w http.ResponseWriter, res Result) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(res.Status)
	_ = json.NewEncoder(w).Encode(res.Body)
}
