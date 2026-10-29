package clientcompose

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"path"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

// The composer's words (spec §4.7): a catalog of one file per language, from which each island
// gets its strings, and the app its app strings, in the client's language.

// Template is a string's words: Text, with {name} for each param, or for a counted string,
// Variants by count ("#1", "#few", "#*").
type Template struct {
	Text     string
	Variants map[string]string
}

// MarshalJSON writes a template as its text, or its variants.
func (t Template) MarshalJSON() ([]byte, error) {
	if t.Variants != nil {
		return json.Marshal(t.Variants)
	}
	return json.Marshal(t.Text)
}

// UnmarshalJSON reads a template's text, or its variants.
func (t *Template) UnmarshalJSON(data []byte) error {
	if bytes.HasPrefix(bytes.TrimSpace(data), []byte(`"`)) {
		t.Variants = nil
		return json.Unmarshal(data, &t.Text)
	}
	t.Text = ""
	return json.Unmarshal(data, &t.Variants)
}

// Strings are templates by key, as an island entry or a strings response carries them.
type Strings map[string]Template

// PluralRules are a language's plural rules: category ("one", "few"…) -> condition, in CLDR's
// syntax, for whole numbers.
type PluralRules map[string]string

// CatalogFile is one language's words: its app strings, each island version's (by
// "type@version"), and each screen's own (by screen id).
type CatalogFile struct {
	App     Strings            `json:"app,omitempty"`
	Islands map[string]Strings `json:"islands,omitempty"`
	Screens map[string]Strings `json:"screens,omitempty"`
}

// Catalog is the words in every language, by language tag ("en", "pl", "pt-BR").
type Catalog map[string]CatalogFile

// LoadCatalog reads a catalog from a directory of <locale>.json files:
//
//	catalog, err := cc.LoadCatalog(os.DirFS("strings"))
//
// or, built into the binary, from an embed.FS with fs.Sub.
func LoadCatalog(fsys fs.FS) (Catalog, error) {
	files, err := fs.Glob(fsys, "*.json")
	if err != nil {
		return nil, err
	}
	catalog := Catalog{}
	for _, name := range files {
		raw, err := fs.ReadFile(fsys, name)
		if err != nil {
			return nil, err
		}
		var file CatalogFile
		if err := json.Unmarshal(raw, &file); err != nil {
			return nil, fmt.Errorf("clientcompose: catalog file %s: %w", name, err)
		}
		catalog[strings.TrimSuffix(path.Base(name), ".json")] = file
	}
	return catalog, nil
}

// StringsConfig is where a composer's words come from.
type StringsConfig struct {
	Catalog Catalog
	// DefaultLocale has every string, and is used when the client's language isn't in the
	// catalog. Default "en".
	DefaultLocale string
}

// LocaleStrings are the catalog's words in one language, as the composer answers a request with.
type LocaleStrings struct {
	// Locale is the language answered in: the client's, the nearest the catalog has, or the
	// default.
	Locale  string
	Plurals PluralRules
	// files are the languages to look in, nearest first.
	files []CatalogFile
}

// For returns the catalog's words in the language nearest the client's locale: "pl-PL", then "pl",
// then the default.
func (s StringsConfig) For(locale string) LocaleStrings {
	fallback := s.DefaultLocale
	if fallback == "" {
		fallback = "en"
	}
	out := LocaleStrings{Locale: fallback}
	seen := map[string]bool{}
	for _, tag := range append(tagAndParents(locale), fallback) {
		file, ok := s.Catalog[tag]
		if !ok || seen[tag] {
			continue
		}
		if len(out.files) == 0 {
			out.Locale = tag
		}
		seen[tag] = true
		out.files = append(out.files, file)
	}
	out.Plurals = rulesFor(out.Locale)
	return out
}

// Island returns an island version's strings, each from the nearest language that has it, or nil
// if no language has any.
func (l LocaleStrings) Island(typ string, version int) Strings {
	id := fmt.Sprintf("%s@%d", typ, version)
	return l.merge(func(f CatalogFile) Strings { return f.Islands[id] })
}

// App returns the app strings, each from the nearest language that has it.
func (l LocaleStrings) App() Strings {
	if s := l.merge(func(f CatalogFile) Strings { return f.App }); s != nil {
		return s
	}
	return Strings{}
}

func (l LocaleStrings) merge(pick func(CatalogFile) Strings) Strings {
	var out Strings
	// Furthest first, so the nearest language's words win.
	for i := len(l.files) - 1; i >= 0; i-- {
		found := pick(l.files[i])
		if found == nil {
			continue
		}
		if out == nil {
			out = Strings{}
		}
		for k, v := range found {
			out[k] = v
		}
	}
	return out
}

// tagAndParents returns a language tag, then each shorter one: "zh-Hant-TW", "zh-Hant", "zh".
func tagAndParents(locale string) []string {
	var parts []string
	for _, p := range strings.Split(strings.ReplaceAll(locale, "_", "-"), "-") {
		if p != "" {
			parts = append(parts, p)
		}
	}
	out := make([]string, len(parts))
	for i := range parts {
		out[i] = strings.Join(parts[:len(parts)-i], "-")
	}
	return out
}

// plurals.json is CLDR's cardinal plural rules, generated by scripts/plurals.ts.
//
//go:embed plurals.json
var pluralsJSON []byte

var pluralRules = sync.OnceValue(func() map[string]PluralRules {
	var rules map[string]PluralRules
	if err := json.Unmarshal(pluralsJSON, &rules); err != nil {
		panic("clientcompose: plurals.json: " + err.Error())
	}
	return rules
})

// rulesFor returns a language's plural rules: its own ("pt-PT"), or its nearest parent's ("pt").
func rulesFor(locale string) PluralRules {
	for _, tag := range tagAndParents(locale) {
		if rules, ok := pluralRules()[tag]; ok {
			return rules
		}
	}
	return PluralRules{}
}

// StringsRequest is the body a client POSTs to /strings: the app strings, in its language.
type StringsRequest struct {
	Protocol *int           `json:"protocol"`
	Client   *ClientContext `json:"client"`
}

// StringsResponse is the app strings, the language they're in, and its plural rules.
type StringsResponse struct {
	Protocol int         `json:"protocol"`
	Locale   string      `json:"locale"`
	Plurals  PluralRules `json:"plurals"`
	Strings  Strings     `json:"strings"`
}

// words returns the catalog's words in the language nearest locale, or nil without a catalog.
func (c *Composer) words(locale string) *LocaleStrings {
	if c.strings == nil {
		return nil
	}
	words := c.strings.For(locale)
	return &words
}

// AppStrings answers a strings request in-process (spec §4.7). It needs no context: an app
// fetches its words before anything else, signed in or not.
func (c *Composer) AppStrings(req StringsRequest) Result {
	if req.Protocol == nil || *req.Protocol != ProtocolVersion {
		return fail(http.StatusBadRequest, "unsupported_protocol", fmt.Sprintf("composer speaks protocol %d", ProtocolVersion))
	}
	locale := ""
	if req.Client != nil {
		locale = req.Client.Locale
	}
	words := c.words(locale)
	if words == nil {
		return fail(http.StatusNotFound, "no_strings", "this composer has no strings catalog")
	}
	return Result{http.StatusOK, StringsResponse{Protocol: ProtocolVersion, Locale: words.Locale, Plurals: words.Plurals, Strings: words.App()}}
}

// StringsTable is a set of strings in one language, with its plural rules, as generated screen
// strings types read it.
type StringsTable struct {
	Strings Strings
	Plurals PluralRules
}

// Text returns a string with no params. A missing string is empty.
func (t StringsTable) Text(key string) string { return FormatString(t.Strings[key], nil, t.Plurals) }

// Format returns a string with its params filled in.
func (t StringsTable) Format(key string, values map[string]string) string {
	return FormatString(t.Strings[key], values, t.Plurals)
}

// ScreenStrings returns a screen's own strings (spec §4.7) in the request's language: the words
// the composer uses itself, such as its meta's title. Generated screen strings types read them:
// AuthorScreenStringsFor(r).Title(name). Without a catalog, every string is empty.
func (r Request) ScreenStrings(screen string) StringsTable { return r.words.table(screen) }

// ScreenStrings returns a screen's own strings in this language, for words the composer sends
// outside any request, such as an email or a notification:
// AuthorScreenStringsFor(config.For(locale)).Title(name).
func (l LocaleStrings) ScreenStrings(screen string) StringsTable { return l.table(screen) }

// ScreenStringsSource is what generated screen strings types read from: a Request, an action's
// Call, or a language's strings (StringsConfig.For) outside any request.
type ScreenStringsSource interface {
	ScreenStrings(screen string) StringsTable
}

func (l *LocaleStrings) table(screen string) StringsTable {
	if l == nil {
		return StringsTable{}
	}
	return StringsTable{Strings: l.Screen(screen), Plurals: l.Plurals}
}

// Screen returns a screen's own strings, each from the nearest language that has it, or nil if no
// language has any.
func (l LocaleStrings) Screen(id string) Strings {
	return l.merge(func(f CatalogFile) Strings { return f.Screens[id] })
}

// FormatString fills in a template's {name} slots from values. A counted string's variant is
// chosen by values["count"]: the exact number, then its plural category, then "#*".
func FormatString(t Template, values map[string]string, plurals PluralRules) string {
	text := t.Text
	if t.Variants != nil {
		text = t.Variants["#*"]
		if n, err := strconv.ParseInt(values["count"], 10, 64); err == nil {
			if v, ok := t.Variants[fmt.Sprintf("#%d", n)]; ok {
				text = v
			} else if v, ok := t.Variants["#"+PluralCategory(plurals, n)]; ok {
				text = v
			}
		}
	}
	return slot.ReplaceAllStringFunc(text, func(s string) string {
		if v, ok := values[s[1:len(s)-1]]; ok {
			return v
		}
		return s
	})
}

var slot = regexp.MustCompile(`\{[A-Za-z0-9]+\}`)

// pluralOrder is the categories in the order CLDR lists them: a count is in the first whose
// condition holds.
var pluralOrder = []string{"zero", "one", "two", "few", "many"}

// PluralCategory returns a count's plural category in a language: the first whose condition
// holds, or "other".
func PluralCategory(rules PluralRules, count int64) string {
	for _, category := range pluralOrder {
		if condition, ok := rules[category]; ok && holds(condition, count) {
			return category
		}
	}
	return "other"
}

// holds reports whether a CLDR condition, an "or" of "and"s of relations like "i % 10 = 2..4",
// holds for a whole number: n and i are the number, and v, w, f, t, c and e are zero.
func holds(condition string, count int64) bool {
	for _, all := range strings.Split(condition, " or ") {
		ok := true
		for _, relation := range strings.Split(all, " and ") {
			if !relates(relation, count) {
				ok = false
				break
			}
		}
		if ok {
			return true
		}
	}
	return false
}

func relates(relation string, count int64) bool {
	op := "="
	if strings.Contains(relation, "!=") {
		op = "!="
	}
	left, right, found := strings.Cut(relation, op)
	if !found {
		return false
	}
	operand, mod, hasMod := strings.Cut(left, "%")
	operand = strings.TrimSpace(operand)
	if len(operand) != 1 || strings.IndexByte("nivwftce", operand[0]) < 0 {
		return false
	}
	var value int64
	if operand == "n" || operand == "i" {
		value = count
		if value < 0 {
			value = -value
		}
	}
	if hasMod {
		m, err := strconv.ParseInt(strings.TrimSpace(mod), 10, 64)
		if err != nil || m == 0 {
			return false
		}
		value %= m
	}
	in := false
	for _, r := range strings.Split(right, ",") {
		from, to, isRange := strings.Cut(strings.TrimSpace(r), "..")
		lo, err := strconv.ParseInt(from, 10, 64)
		if err != nil {
			continue
		}
		hi := lo
		if isRange {
			if hi, err = strconv.ParseInt(to, 10, 64); err != nil {
				continue
			}
		}
		if value >= lo && value <= hi {
			in = true
			break
		}
	}
	return in == (op == "=")
}
