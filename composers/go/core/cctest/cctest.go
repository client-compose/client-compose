// Package cctest tests a composer the way apps use it, in-process (CMP-13). Requests go through the
// composer's HTTP handler, so context functions, requirements and plugins all run, and outcomes come
// back as typed values.
//
//	app := cctest.New(t, composer)
//	profile := app.Screen("profile", cctest.Params{"userId": "u1"}, cctest.Header("Authorization", "Bearer "+token))
//	header := cctest.Props[ProfileHeaderV2](t, profile, "header")
//
//	more := app.NextPage(profile, "posts") // the next page of a paged island (spec §4.5)
//	posts := cctest.IslandProps[PostListV1](t, more)
//
//	followed := cctest.Perform(app, FollowUserV1Input{UserID: "u1"})
//	if followed.Status != "ok" || followed.Result.Followers != 8 { … }
//
//	words := app.Strings("pl") // the app strings (spec §4.7)
package cctest

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	cc "github.com/client-compose/client-compose/composers/go/core"
)

// App calls one composer.
type App struct {
	t       testing.TB
	handler http.Handler
	// composer is the handler, when it's one: CheckEffects needs its islands' entities.
	composer *cc.Composer
	islands  map[string][]int
	client   cc.ClientContext
}

// Option configures an App.
type Option func(*App)

// Declare sets the islands the app declares it can render, replacing the default. Pass zero values
// of generated props types: cctest.Declare(ProfileHeaderV2{}, FollowButtonV1{}).
func Declare(islands ...cc.Props) Option {
	return func(a *App) {
		a.islands = map[string][]int{}
		for _, p := range islands {
			a.islands[p.IslandType()] = append(a.islands[p.IslandType()], p.IslandVersion())
		}
		for _, versions := range a.islands {
			slices.Sort(versions)
		}
	}
}

// Client sets the client context sent with every request. Default: platform "test", app version
// "1".
func Client(client cc.ClientContext) Option {
	return func(a *App) { a.client = client }
}

// New returns an App calling handler: a *cc.Composer, or your HTTP handler with the composer in it.
// When handler is a *cc.Composer, the app declares every island its declared screens place; for
// screens with a Layout, use Declare.
func New(t testing.TB, handler http.Handler, opts ...Option) *App {
	a := &App{t: t, handler: handler, islands: map[string][]int{}, client: cc.ClientContext{Platform: "test", AppVersion: "1"}}
	if c, ok := handler.(*cc.Composer); ok {
		a.islands = c.Islands()
		a.composer = c
	}
	for _, o := range opts {
		o(a)
	}
	return a
}

// Params are a screen's params.
type Params map[string]string

// RequestOption changes one request.
type RequestOption func(*request)

type request struct {
	header         http.Header
	idempotencyKey string
}

// Header sets a request header, e.g. Authorization.
func Header(name, value string) RequestOption {
	return func(r *request) { r.header.Set(name, value) }
}

// IdempotencyKey sends an action's idempotency key.
func IdempotencyKey(key string) RequestOption {
	return func(r *request) { r.idempotencyKey = key }
}

// Screen is a composed screen, or the error the composer answered with.
type Screen struct {
	// Params are the params it was requested with.
	Params Params
	// Status is the HTTP status.
	Status int
	// Response is the screen, when Status is 200, with every island in place.
	Response cc.ScreenResponse
	// Head is the stream's head (spec §4.6): the screen as it was first sent, its islands resolved
	// or pending.
	Head cc.ScreenResponse
	// Error is the protocol error code otherwise, e.g. "not_found".
	Error string
}

// Keys lists the screen's island keys, in order.
func (s Screen) Keys() []string {
	keys := make([]string, len(s.Response.Islands))
	for i, e := range s.Response.Islands {
		keys[i] = e.Key
	}
	return keys
}

// Island returns the island with key, if the screen has it.
func (s Screen) Island(key string) (cc.IslandEntry, bool) {
	for _, e := range s.Response.Islands {
		if e.Key == key {
			return e, true
		}
	}
	return cc.IslandEntry{}, false
}

// Screen composes a screen.
func (a *App) Screen(screen string, params Params, opts ...RequestOption) Screen {
	a.t.Helper()
	protocol := cc.ProtocolVersion
	client := a.client
	body := cc.ScreenRequest{Protocol: &protocol, Screen: screen, Params: params, Client: &client, Islands: a.islands}
	status, raw := a.post("/screens/"+screen, body, opts)
	out := Screen{Params: params, Status: status}
	if status != http.StatusOK {
		out.Error = errorCode(a.t, raw)
		return out
	}
	head, composed, err := cc.ReadScreen(bytes.NewReader(raw))
	if err != nil {
		a.t.Fatalf("cctest: screen %q: %v", screen, err)
	}
	out.Head, out.Response = head, composed
	return out
}

// Props returns an island's props as P, failing the test if the screen doesn't have the island or
// it errored.
func Props[P cc.Props](t testing.TB, s Screen, key string) P {
	t.Helper()
	var props P
	entry, ok := s.Island(key)
	switch {
	case !ok:
		t.Fatalf("cctest: screen %q has no island %q (it has %v, status %d %s)", s.Response.Screen, key, s.Keys(), s.Status, s.Error)
	case entry.Status != "ok":
		t.Fatalf("cctest: island %q is %s: %+v", key, entry.Status, entry.Error)
	}
	raw, err := json.Marshal(entry.Props)
	if err != nil {
		t.Fatal(err)
	}
	decode(t, raw, &props)
	return props
}

// Island is one island resolved by an island request (spec §4.5), or the error the composer
// answered with.
type Island struct {
	// Screen and Params are the screen it's on, and its params.
	Screen string
	Params Params
	// Status is the HTTP status.
	Status int
	// Entry is the island, when Status is 200: its props, or its error, and its Next.
	Entry cc.IslandEntry
	// Error is the protocol error code otherwise, e.g. "invalid_cursor".
	Error string
}

// Island resolves one island of a screen again: the page cursor asks for, or its first page when
// cursor is "".
func (a *App) Island(screen string, params Params, key string, version int, cursor string, opts ...RequestOption) Island {
	a.t.Helper()
	protocol := cc.ProtocolVersion
	client := a.client
	body := cc.IslandRequest{Protocol: &protocol, Screen: screen, Key: key, Version: version, Params: params, Client: &client, Cursor: cursor}
	status, raw := a.post(fmt.Sprintf("/screens/%s/islands/%s", screen, key), body, opts)
	out := Island{Screen: screen, Params: params, Status: status}
	if status == http.StatusOK {
		var res cc.IslandResponse
		decode(a.t, raw, &res)
		out.Entry = res.Island
	} else {
		out.Error = errorCode(a.t, raw)
	}
	return out
}

// NextPage fetches the page after a screen's island, as a client scrolling to its end would. It
// fails the test if the island has no more pages.
func (a *App) NextPage(s Screen, key string, opts ...RequestOption) Island {
	a.t.Helper()
	entry, ok := s.Island(key)
	if !ok || entry.Next == "" {
		a.t.Fatalf("cctest: island %q on %q has no next page (it has %v)", key, s.Response.Screen, s.Keys())
	}
	return a.Island(s.Response.Screen, s.Params, key, entry.Version, entry.Next, opts...)
}

// Next fetches the page after one an island request returned. It fails the test if there isn't one.
func (a *App) Next(i Island, opts ...RequestOption) Island {
	a.t.Helper()
	if i.Entry.Next == "" {
		a.t.Fatalf("cctest: island %q has no next page", i.Entry.Key)
	}
	return a.Island(i.Screen, i.Params, i.Entry.Key, i.Entry.Version, i.Entry.Next, opts...)
}

// IslandProps returns an island request's props as P, failing the test if it didn't resolve.
func IslandProps[P cc.Props](t testing.TB, i Island) P {
	t.Helper()
	var props P
	switch {
	case i.Status != http.StatusOK:
		t.Fatalf("cctest: island request answered %d %s", i.Status, i.Error)
	case i.Entry.Status != "ok":
		t.Fatalf("cctest: island %q is %s: %+v", i.Entry.Key, i.Entry.Status, i.Entry.Error)
	}
	raw, err := json.Marshal(i.Entry.Props)
	if err != nil {
		t.Fatal(err)
	}
	decode(t, raw, &props)
	return props
}

// AppStrings are the app strings (spec §4.7), or the error the composer answered with.
type AppStrings struct {
	// Status is the HTTP status.
	Status int
	// Response is the strings, the language they're in and its plural rules, when Status is 200.
	Response cc.StringsResponse
	// Error is the protocol error code otherwise, e.g. "no_strings".
	Error string
}

// Strings fetches the app strings in locale, or in the client's language when locale is "".
func (a *App) Strings(locale string) AppStrings {
	a.t.Helper()
	protocol := cc.ProtocolVersion
	client := a.client
	if locale != "" {
		client.Locale = locale
	}
	status, raw := a.post("/strings", cc.StringsRequest{Protocol: &protocol, Client: &client}, nil)
	out := AppStrings{Status: status}
	if status == http.StatusOK {
		decode(a.t, raw, &out.Response)
	} else {
		out.Error = errorCode(a.t, raw)
	}
	return out
}

// Outcome is what performing an action came to.
type Outcome[R any] struct {
	// Status is "ok" or "error" when the action ran (HTTP 200), and "" otherwise.
	Status string
	// HTTPStatus is the HTTP status.
	HTTPStatus int
	Result     R
	Effects    cc.Effects
	// Error is the declared error's code when Status is "error", or the protocol error code (e.g.
	// "unauthenticated", "invalid_input") when the action didn't run.
	Error string
	// Details is the declared error's details, as JSON.
	Details json.RawMessage
}

// Perform performs the action that input belongs to.
func Perform[I cc.ActionInput[R], R any](a *App, input I, opts ...RequestOption) Outcome[R] {
	a.t.Helper()
	raw, err := json.Marshal(input)
	if err != nil {
		a.t.Fatal(err)
	}
	protocol := cc.ProtocolVersion
	client := a.client
	islands := a.islands
	if islands == nil {
		islands = map[string][]int{}
	}
	body := cc.ActionRequest{Protocol: &protocol, Action: input.ActionName(), Version: input.ActionVersion(), Input: raw, Client: &client, Islands: islands}
	r := &request{header: http.Header{}}
	for _, o := range opts {
		o(r)
	}
	body.IdempotencyKey = r.idempotencyKey
	status, resp := a.post("/actions/"+input.ActionName(), body, opts)
	out := Outcome[R]{HTTPStatus: status}
	if status != http.StatusOK {
		out.Error = errorCode(a.t, resp)
		return out
	}
	var decoded struct {
		Status  string          `json:"status"`
		Result  json.RawMessage `json:"result"`
		Effects *cc.Effects     `json:"effects"`
		Error   *struct {
			Code    string          `json:"code"`
			Details json.RawMessage `json:"details"`
		} `json:"error"`
	}
	decode(a.t, resp, &decoded)
	out.Status = decoded.Status
	if decoded.Result != nil {
		decode(a.t, decoded.Result, &out.Result)
	}
	if decoded.Effects != nil {
		out.Effects = *decoded.Effects
	}
	if decoded.Error != nil {
		out.Error, out.Details = decoded.Error.Code, decoded.Error.Details
	}
	return out
}

func (a *App) post(path string, body any, opts []RequestOption) (int, []byte) {
	a.t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		a.t.Fatal(err)
	}
	r := &request{header: http.Header{}}
	for _, o := range opts {
		o(r)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
	req.Header = r.header
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	a.handler.ServeHTTP(rec, req)
	return rec.Code, rec.Body.Bytes()
}

func decode(t testing.TB, raw []byte, into any) {
	t.Helper()
	if err := json.Unmarshal(raw, into); err != nil {
		t.Fatalf("cctest: decoding %s: %v", raw, err)
	}
}

func errorCode(t testing.TB, raw []byte) string {
	t.Helper()
	var body cc.ErrorResponse
	if err := json.Unmarshal(raw, &body); err != nil {
		return fmt.Sprintf("(not a protocol error: %s)", raw)
	}
	return body.Error.Code
}
