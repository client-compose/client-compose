package clientcompose

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

const maxBodyBytes = 1 << 20

// ServeHTTP serves POST /screens/{screen}, POST /screens/{screen}/islands/{key} and
// POST /actions/{action}. Mount the composer at your
// root, or under a prefix with http.StripPrefix. Other routers take an http.Handler too: chi's
// Mount, gin.WrapH, echo.WrapHandler.
func (c *Composer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	c.mux.ServeHTTP(w, r)
}

func (c *Composer) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /screens/{screen}", func(w http.ResponseWriter, r *http.Request) {
		ctx, res, ok := c.context(r, LayoutFailed)
		if ok {
			res = c.composeHTTP(ctx, r.PathValue("screen"), r.Body)
		}
		writeResult(w, res)
	})
	mux.HandleFunc("POST /screens/{screen}/islands/{key}", func(w http.ResponseWriter, r *http.Request) {
		ctx, res, ok := c.context(r, LayoutFailed)
		if ok {
			res = c.composeIslandHTTP(ctx, r.PathValue("screen"), r.PathValue("key"), r.Body)
		}
		writeResult(w, res)
	})
	mux.HandleFunc("POST /actions/{action}", func(w http.ResponseWriter, r *http.Request) {
		ctx, res, ok := c.context(r, ActionFailed)
		if ok {
			res = c.performHTTP(ctx, r.PathValue("action"), r.Body)
		}
		writeResult(w, res)
	})
	return mux
}

// context runs the context hooks, in order. If one fails, it returns the response to send instead.
func (c *Composer) context(r *http.Request, kind FailureKind) (context.Context, Result, bool) {
	ctx := r.Context()
	for _, p := range c.plugins {
		if p.Context == nil {
			continue
		}
		next, err := p.Context(ctx, r)
		if err != nil {
			if res, ok := protocolError(err); ok {
				return ctx, res, false
			}
			c.report(ctx, Failure{Kind: ContextFailed, Err: err})
			code := "layout_failed"
			if kind == ActionFailed {
				code = "action_failed"
			}
			return ctx, fail(http.StatusInternalServerError, code, ""), false
		}
		ctx = next
	}
	return ctx, Result{}, true
}

// composeHTTP parses and checks a raw request body, then composes (spec §8.1 error codes).
func (c *Composer) composeHTTP(ctx context.Context, pathScreen string, body io.Reader) Result {
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

// composeIslandHTTP parses and checks a raw island request body, then resolves the island (spec
// §4.5 error codes).
func (c *Composer) composeIslandHTTP(ctx context.Context, pathScreen, pathKey string, body io.Reader) Result {
	var req IslandRequest
	if err := json.NewDecoder(io.LimitReader(body, maxBodyBytes)).Decode(&req); err != nil {
		return fail(http.StatusBadRequest, "bad_request", "body is not valid JSON")
	}
	if req.Protocol == nil || req.Screen == "" || req.Key == "" || req.Version < 1 || req.Client == nil {
		return fail(http.StatusBadRequest, "bad_request", "body is not an island request")
	}
	if *req.Protocol != ProtocolVersion {
		return fail(http.StatusBadRequest, "unsupported_protocol", "")
	}
	if req.Screen != pathScreen || req.Key != pathKey {
		return fail(http.StatusBadRequest, "island_mismatch", fmt.Sprintf("%s/%s != %s/%s", req.Screen, req.Key, pathScreen, pathKey))
	}
	return c.ComposeIsland(ctx, req)
}

// performHTTP parses and checks a raw action request body, then performs the action (spec §8.1
// error codes).
func (c *Composer) performHTTP(ctx context.Context, pathAction string, body io.Reader) Result {
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

func writeResult(w http.ResponseWriter, res Result) {
	if stream, ok := res.Body.(*ScreenStream); ok {
		writeStream(w, stream)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(res.Status)
	_ = json.NewEncoder(w).Encode(res.Body)
}
