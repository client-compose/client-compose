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

// Handler serves POST /screens/{screen} using net/http. Mount it at your root or
// strip a prefix with http.StripPrefix.
func (c *Composer) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /screens/{screen}", func(w http.ResponseWriter, r *http.Request) {
		WriteResult(w, c.ComposeHTTP(r.Context(), r.PathValue("screen"), r.Body))
	})
	return mux
}

// WriteResult writes a Result as a JSON response.
func WriteResult(w http.ResponseWriter, res Result) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(res.Status)
	_ = json.NewEncoder(w).Encode(res.Body)
}
