package clientcompose_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	cc "github.com/client-compose/client-compose/composers/go/core"
	"github.com/client-compose/client-compose/composers/go/core/cctest"
)

func catalog(t *testing.T) cc.Catalog {
	t.Helper()
	catalog, err := cc.LoadCatalog(os.DirFS("testdata/strings"))
	if err != nil {
		t.Fatal(err)
	}
	return catalog
}

func wordsComposer(t *testing.T, signedIn bool) *cc.Composer {
	return cc.New(cc.Config{
		Screens: []cc.Screen{{
			ID: "numbers",
			Islands: []cc.Placement{
				{Key: "header", Versions: cc.Versions(cc.Define(func(context.Context, cc.Request) (headerV1, error) {
					return headerV1{Name: "Numbers"}, nil
				}))},
				{Key: "list", Versions: cc.Versions(numbers(5, 2))},
			},
		}},
		Context: func(ctx context.Context, _ *http.Request) (context.Context, error) {
			if !signedIn {
				return ctx, cc.ErrUnauthenticated
			}
			return ctx, nil
		},
		Strings: &cc.StringsConfig{Catalog: catalog(t)},
	})
}

func TestEachIslandCarriesItsStrings(t *testing.T) {
	app := cctest.New(t, wordsComposer(t, true), cctest.Client(cc.ClientContext{Platform: "test", AppVersion: "1", Locale: "pl-PL"}))
	screen := app.Screen("numbers", nil)
	if screen.Head.Locale != "pl" || screen.Head.Plurals == nil || (*screen.Head.Plurals)["few"] != "v = 0 and i % 10 = 2..4 and i % 100 != 12..14" {
		t.Fatalf("head: locale %q, plurals %v", screen.Head.Locale, screen.Head.Plurals)
	}
	list, _ := screen.Island("list")
	want := cc.Strings{
		"heading": {Text: "Liczby"},
		"count":   {Variants: map[string]string{"#1": "Jedna liczba", "#few": "{count} liczby", "#*": "{count} liczb"}},
	}
	if !reflect.DeepEqual(list.Strings, want) {
		t.Fatalf("list strings: %+v", list.Strings)
	}
	if header, _ := screen.Island("header"); header.Strings != nil {
		t.Fatalf("an island with no strings in the catalog has none: %+v", header.Strings)
	}

	// A page has no strings; the island resolved again without a cursor has them.
	page := app.NextPage(screen, "list")
	if page.Status != http.StatusOK || page.Entry.Strings != nil {
		t.Fatalf("page: %d %+v", page.Status, page.Entry.Strings)
	}
	again := app.Island("numbers", nil, "list", 1, "")
	if again.Entry.Strings["heading"].Text != "Liczby" {
		t.Fatalf("again: %+v", again.Entry.Strings)
	}
}

func TestStringsFallBackStringByString(t *testing.T) {
	cfg := cc.StringsConfig{Catalog: catalog(t)}
	brazil := cfg.For("pt-BR")
	if brazil.Locale != "pt-BR" || brazil.Plurals["one"] != "i = 0..1" {
		t.Fatalf("pt-BR: %q %v", brazil.Locale, brazil.Plurals)
	}
	if got := brazil.App(); got["loading"].Text != "Carregando" || got["retry"].Text != "Try again" {
		t.Fatalf("pt-BR app: %+v", got)
	}
	if brazil.Island("list", 1)["heading"].Text != "Numbers" {
		t.Fatal("pt-BR has no island strings: they're the default's")
	}
	if polish := cfg.For("pl_PL"); polish.Locale != "pl" || polish.App()["retry"].Text != "Try again" {
		t.Fatalf("pl_PL: %q %+v", polish.Locale, polish.App())
	}
	if got := (cc.StringsConfig{Catalog: cc.Catalog{"pt-PT": {}}}).For("pt-PT").Plurals["one"]; got != "i = 1 and v = 0" {
		t.Fatalf("pt-PT has its own plural rules: %q", got)
	}
	if unknown := cfg.For("xx"); unknown.Locale != "en" || !reflect.DeepEqual(unknown.Plurals, cc.PluralRules{"one": "i = 1 and v = 0"}) {
		t.Fatalf("xx: %q %v", unknown.Locale, unknown.Plurals)
	}
	if got := (cc.StringsConfig{Catalog: catalog(t), DefaultLocale: "pl"}).For("").Locale; got != "pl" {
		t.Fatalf("default pl: %q", got)
	}
}

func TestAppStringsAnswerWithoutASession(t *testing.T) {
	app := cctest.New(t, wordsComposer(t, false))
	if screen := app.Screen("numbers", nil); screen.Status != http.StatusUnauthorized {
		t.Fatalf("screen: %d", screen.Status)
	}
	words := app.Strings("pl")
	want := cc.StringsResponse{
		Protocol: 0,
		Locale:   "pl",
		Plurals:  (cc.StringsConfig{Catalog: catalog(t)}).For("pl").Plurals,
		Strings:  cc.Strings{"loading": {Text: "Ładowanie"}, "retry": {Text: "Try again"}},
	}
	if words.Status != http.StatusOK || !reflect.DeepEqual(words.Response, want) {
		t.Fatalf("strings: %d %+v", words.Status, words.Response)
	}
}

func TestWithoutACatalog(t *testing.T) {
	app := cctest.New(t, cc.New(cc.Config{Screens: []cc.Screen{{ID: "one", Islands: []cc.Placement{cc.Static("header", headerV1{})}}}}))
	if screen := app.Screen("one", nil); screen.Head.Locale != "" || screen.Head.Plurals != nil {
		t.Fatalf("head: %+v", screen.Head)
	}
	if words := app.Strings(""); words.Status != http.StatusNotFound || words.Error != "no_strings" {
		t.Fatalf("strings: %d %s", words.Status, words.Error)
	}
}

func TestBadStringsRequests(t *testing.T) {
	composer := wordsComposer(t, true)
	for body, code := range map[string]string{
		`nope`: "bad_request",
		`{}`:   "bad_request",
		`{"protocol":99,"client":{"platform":"test","appVersion":"1"}}`: "unsupported_protocol",
	} {
		rec := httptest.NewRecorder()
		composer.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/strings", strings.NewReader(body)))
		var res cc.ErrorResponse
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if rec.Code != http.StatusBadRequest || res.Error.Code != code {
			t.Errorf("%s: %d %s", body, rec.Code, res.Error.Code)
		}
	}
}

func TestATemplateIsTextOrVariants(t *testing.T) {
	raw := `{"a":"Hi {name}","b":{"#*":"{count}","#1":"One"}}` // maps marshal in key order
	var s cc.Strings
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		t.Fatal(err)
	}
	out, err := json.Marshal(s)
	if err != nil || string(out) != raw {
		t.Fatalf("round trip: %s %v", out, err)
	}
}

// A language with no plural categories (Japanese) still says so: plurals is {}.
func TestPluralsAreSentWhenEmpty(t *testing.T) {
	app := cctest.New(t, cc.New(cc.Config{
		Screens: []cc.Screen{{ID: "one", Islands: []cc.Placement{cc.Static("header", headerV1{})}}},
		Strings: &cc.StringsConfig{Catalog: cc.Catalog{"ja": {}}, DefaultLocale: "ja"},
	}))
	if screen := app.Screen("one", nil); screen.Head.Plurals == nil || len(*screen.Head.Plurals) != 0 {
		t.Fatalf("plurals: %v", screen.Head.Plurals)
	}
}

func TestPluralCategoriesAgreeWithCLDR(t *testing.T) {
	var rules struct {
		Rules map[string]cc.PluralRules `json:"rules"`
	}
	var cases struct {
		Cases map[string]map[string][]int64 `json:"cases"`
	}
	readJSON(t, "../../../spec/plurals.json", &rules)
	readJSON(t, "../../../conformance/client/plural-cases.json", &cases)
	if len(cases.Cases) < 200 {
		t.Fatalf("only %d languages", len(cases.Cases))
	}
	for language, categories := range cases.Cases {
		for category, counts := range categories {
			for _, n := range counts {
				if got := cc.PluralCategory(rules.Rules[language], n); got != category {
					t.Errorf("%s %d: %s, want %s", language, n, got, category)
				}
			}
		}
	}
}

func TestTemplatesAreFilledInAsTheFixturesSay(t *testing.T) {
	var rules struct {
		Rules map[string]cc.PluralRules `json:"rules"`
	}
	var cases struct {
		Cases []struct {
			Name     string         `json:"name"`
			Language string         `json:"language"`
			Template cc.Template    `json:"template"`
			Values   map[string]any `json:"values"`
			Expect   string         `json:"expect"`
		} `json:"cases"`
	}
	readJSON(t, "../../../spec/plurals.json", &rules)
	readJSON(t, "../../../conformance/client/string-cases.json", &cases)
	for _, c := range cases.Cases {
		values := map[string]string{}
		for k, v := range c.Values {
			values[k] = fmt.Sprint(v)
		}
		if got := cc.FormatString(c.Template, values, rules.Rules[c.Language]); got != c.Expect {
			t.Errorf("%s: %q, want %q", c.Name, got, c.Expect)
		}
	}
}

func TestAScreenReadsItsOwnStrings(t *testing.T) {
	composer := cc.New(cc.Config{
		Screens: []cc.Screen{{
			ID:      "numbers",
			Islands: []cc.Placement{cc.Static("header", headerV1{})},
			Meta: func(_ context.Context, r cc.Request) (cc.ScreenMeta, error) {
				words := r.ScreenStrings("numbers")
				return cc.ScreenMeta{
					Title:       words.Format("title", map[string]string{"name": "Ada"}),
					Description: words.Format("description", map[string]string{"count": "3"}),
				}, nil
			},
		}},
		Strings: &cc.StringsConfig{Catalog: catalog(t)},
	})
	polish := cctest.New(t, composer, cctest.Client(cc.ClientContext{Platform: "test", AppVersion: "1", Locale: "pl"}))
	// Polish has the title; its description falls back to English's.
	if meta := polish.Screen("numbers", nil).Head.Meta; meta == nil || meta.Title != "Liczby o Ada" || meta.Description != "3 numbers" {
		t.Fatalf("meta: %+v", meta)
	}
	without := cctest.New(t, cc.New(cc.Config{Screens: []cc.Screen{{
		ID:      "numbers",
		Islands: []cc.Placement{cc.Static("header", headerV1{})},
		Meta: func(_ context.Context, r cc.Request) (cc.ScreenMeta, error) {
			return cc.ScreenMeta{Title: r.ScreenStrings("numbers").Text("title")}, nil
		},
	}}}))
	if meta := without.Screen("numbers", nil).Head.Meta; meta != nil {
		t.Fatalf("without a catalog the title is empty: %+v", meta)
	}
}

func readJSON(t *testing.T, path string, into any) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, into); err != nil {
		t.Fatal(err)
	}
}
