// Package clientcompose is the Go composer for the Client Compose protocol.
// See spec/PROTOCOL.md in the repository root.
package clientcompose

import "encoding/json"

// ProtocolVersion is the protocol major version this package speaks.
const ProtocolVersion = 0

// ScreenRequest is the body a client POSTs to /screens/{screen}.
type ScreenRequest struct {
	Protocol *int              `json:"protocol"`
	Screen   string            `json:"screen"`
	Params   map[string]string `json:"params,omitempty"`
	Client   *ClientContext    `json:"client"`
	// Islands is the client's capabilities: island type -> supported versions.
	Islands map[string][]int `json:"islands"`
}

// ClientContext describes the calling client. Fields beyond the known ones are kept in Extra.
type ClientContext struct {
	Platform   string         `json:"platform"`
	AppVersion string         `json:"appVersion"`
	Locale     string         `json:"locale,omitempty"`
	Extra      map[string]any `json:"-"`
}

func (c *ClientContext) UnmarshalJSON(data []byte) error {
	type known ClientContext
	if err := json.Unmarshal(data, (*known)(c)); err != nil {
		return err
	}
	if err := json.Unmarshal(data, &c.Extra); err != nil {
		return err
	}
	delete(c.Extra, "platform")
	delete(c.Extra, "appVersion")
	delete(c.Extra, "locale")
	return nil
}

// IslandError describes why an island could not be resolved.
type IslandError struct {
	Code      string `json:"code"`
	Message   string `json:"message,omitempty"`
	Retryable bool   `json:"retryable,omitempty"`
}

// IslandEntry is one island in a screen response.
type IslandEntry struct {
	Key     string       `json:"key"`
	Type    string       `json:"type"`
	Version int          `json:"version"`
	Status  string       `json:"status"`
	Props   any          `json:"props,omitempty"`
	Error   *IslandError `json:"error,omitempty"`
}

// CacheHint tells clients how long the screen may be cached.
type CacheHint struct {
	MaxAge int `json:"maxAge"`
}

// ScreenMeta describes the screen as a whole: page title, description, sharing image (spec §4).
type ScreenMeta struct {
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	// Image is an absolute URL.
	Image string `json:"image,omitempty"`
}

// ScreenResponse is the successful response body.
type ScreenResponse struct {
	Protocol int           `json:"protocol"`
	Screen   string        `json:"screen"`
	Islands  []IslandEntry `json:"islands"`
	Meta     *ScreenMeta   `json:"meta,omitempty"`
	Cache    *CacheHint    `json:"cache,omitempty"`
}

// ErrorResponse is the body of a non-2xx response.
type ErrorResponse struct {
	Protocol int         `json:"protocol"`
	Error    IslandError `json:"error"`
}
