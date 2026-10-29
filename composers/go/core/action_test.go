package clientcompose

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	ca "github.com/client-compose/client-compose/composers/go/core/internal/conformanceaction"
)

func perform(t *testing.T, c *Composer, input string) (int, map[string]any) {
	t.Helper()
	body := `{"protocol":0,"action":"conformance","version":1,"client":{"platform":"web","appVersion":"1"},"islands":{},"input":` + input + `}`
	rec := httptest.NewRecorder()
	c.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/actions/conformance", strings.NewReader(body)))
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return rec.Code, out
}

func errorCode(body map[string]any) string {
	e, _ := body["error"].(map[string]any)
	code, _ := e["code"].(string)
	return code
}

type handler func(context.Context, Call, ca.ConformanceV1Input) (ca.ConformanceV1Result, Effects, error)

func composerWith(h handler, plugins ...Plugin) *Composer {
	return New(Config{Actions: []Action{DefineAction(h)}, Use: plugins})
}

func TestActionPanicIsAFailureAndIsReported(t *testing.T) {
	var reported error
	c := composerWith(
		func(context.Context, Call, ca.ConformanceV1Input) (ca.ConformanceV1Result, Effects, error) {
			panic("boom")
		},
		ReportErrors(func(_ context.Context, f Failure) {
			reported = fmt.Errorf("%s v%d: %w", f.Action, f.Version, f.Err)
		}),
	)
	status, body := perform(t, c, `{"outcome":"ok","echo":"x"}`)
	if status != 500 || errorCode(body) != "action_failed" {
		t.Fatalf("status %d, body %v", status, body)
	}
	if reported == nil || !strings.Contains(reported.Error(), "conformance v1: action panicked: boom") {
		t.Fatalf("reported %v", reported)
	}
}

func TestDeclaredErrorsMayBeWrapped(t *testing.T) {
	c := composerWith(func(context.Context, Call, ca.ConformanceV1Input) (ca.ConformanceV1Result, Effects, error) {
		return ca.ConformanceV1Result{}, Effects{}, fmt.Errorf("checking name: %w", ca.ConformanceV1Rejected{Echo: "taken"})
	})
	status, body := perform(t, c, `{"outcome":"ok","echo":"x"}`)
	details, _ := body["error"].(map[string]any)["details"].(map[string]any)
	if status != 200 || body["status"] != "error" || errorCode(body) != "rejected" || details["echo"] != "taken" {
		t.Fatalf("status %d, body %v", status, body)
	}
}

func TestDeclaredErrorsOfAnotherVersionAreFailures(t *testing.T) {
	// Same code, but v2's details could differ from what v1 clients expect.
	c := composerWith(func(context.Context, Call, ca.ConformanceV1Input) (ca.ConformanceV1Result, Effects, error) {
		return ca.ConformanceV1Result{}, Effects{}, ca.ConformanceV2Rejected{Echo: "x"}
	})
	if status, body := perform(t, c, `{"outcome":"ok","echo":"x"}`); status != 500 || errorCode(body) != "action_failed" {
		t.Fatalf("status %d, body %v", status, body)
	}
}

func TestActionsShareRequestScopedLoads(t *testing.T) {
	runs := 0
	c := composerWith(func(ctx context.Context, _ Call, in ca.ConformanceV1Input) (ca.ConformanceV1Result, Effects, error) {
		for range 3 {
			if _, err := Load(ctx, "k", func(context.Context) (int, error) { runs++; return runs, nil }); err != nil {
				return ca.ConformanceV1Result{}, Effects{}, err
			}
		}
		return ca.ConformanceV1Result{Echo: in.Echo, Version: 1}, Effects{}, nil
	})
	if status, _ := perform(t, c, `{"outcome":"ok","echo":"x"}`); status != 200 || runs != 1 {
		t.Fatalf("status %d, runs %d", status, runs)
	}
}

func TestEmptyResultIsAnObject(t *testing.T) {
	c := New(Config{Actions: ConformanceActions()})
	res := c.Perform(context.Background(), ActionRequest{
		Protocol: new(int), Action: "conformance", Version: 1, Input: json.RawMessage(`{"outcome":"ok","echo":""}`),
	})
	out, _ := json.Marshal(res.Body)
	if res.Status != 200 || !strings.Contains(string(out), `"result":{"echo":"","version":1}`) {
		t.Fatalf("status %d, body %s", res.Status, out)
	}
}

func TestRegisteringAnActionVersionTwicePanics(t *testing.T) {
	defer func() {
		if rec := recover(); rec == nil || !strings.Contains(fmt.Sprint(rec), "conformance v1 registered twice") {
			t.Fatalf("recovered %v", rec)
		}
	}()
	actions := ConformanceActions()
	New(Config{Actions: []Action{actions[0], actions[0]}})
}

func TestLayoutAuthErrors(t *testing.T) {
	for want, err := range map[int]error{401: ErrUnauthenticated, 403: ErrForbidden} {
		c := New(Config{Screens: []Screen{{ID: "s", Layout: func(context.Context, Request) ([]Placement, error) {
			return nil, fmt.Errorf("checking session: %w", err)
		}}}})
		res := c.Compose(context.Background(), ScreenRequest{Protocol: new(int), Screen: "s", Client: &ClientContext{}})
		if res.Status != want {
			t.Errorf("%v: status %d, want %d", err, res.Status, want)
		}
	}
}

func TestAnActionReadsScreenStringsInTheClientsLanguage(t *testing.T) {
	catalog := Catalog{
		"en": {Screens: map[string]Strings{"search": {"creators": {Text: "Creators"}}}},
		"pl": {Screens: map[string]Strings{"search": {"creators": {Text: "Twórcy"}}}},
	}
	c := New(Config{
		Actions: []Action{DefineAction(func(_ context.Context, call Call, _ ca.ConformanceV1Input) (ca.ConformanceV1Result, Effects, error) {
			return ca.ConformanceV1Result{Echo: call.ScreenStrings("search").Text("creators")}, Effects{}, nil
		})},
		Strings: &StringsConfig{Catalog: catalog},
	})
	body := `{"protocol":0,"action":"conformance","version":1,"client":{"platform":"web","appVersion":"1","locale":"pl-PL"},"islands":{},"input":{"outcome":"ok","echo":"x"}}`
	rec := httptest.NewRecorder()
	c.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/actions/conformance", strings.NewReader(body)))
	if !strings.Contains(rec.Body.String(), `"echo":"Twórcy"`) {
		t.Fatalf("got %s", rec.Body.String())
	}
	if got := (Call{}).ScreenStrings("search").Text("creators"); got != "" {
		t.Fatalf("without a catalog: %q", got)
	}
}
