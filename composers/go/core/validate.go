package clientcompose

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"slices"
	"strings"
)

// schema is the subset of JSON Schema that codegen accepts (codegen/README.md), which is all an
// action's input schema can use.
type schema struct {
	Type                 string             `json:"type"`
	Properties           map[string]*schema `json:"properties"`
	Required             []string           `json:"required"`
	AdditionalProperties *schema            `json:"additionalProperties"`
	Items                *schema            `json:"items"`
	Enum                 []string           `json:"enum"`
	Format               string             `json:"format"`
}

func parseSchema(src string) (*schema, error) {
	var s schema
	if err := json.Unmarshal([]byte(src), &s); err != nil {
		return nil, err
	}
	return &s, nil
}

// validateJSON checks a JSON document against s (spec §5.2): unknown properties are ignored and a
// null optional property counts as absent. The error names the first offending path.
func validateJSON(s *schema, data []byte) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return fmt.Errorf("input is not valid JSON")
	}
	return s.validate(v, "input")
}

func (s *schema) validate(v any, path string) error {
	switch s.Type {
	case "object":
		obj, ok := v.(map[string]any)
		if !ok {
			return fmt.Errorf("%s: expected an object", path)
		}
		if s.AdditionalProperties != nil {
			for k, item := range obj {
				if err := s.AdditionalProperties.validate(item, path+"."+k); err != nil {
					return err
				}
			}
			return nil
		}
		for _, name := range s.Required {
			if obj[name] == nil {
				return fmt.Errorf("%s.%s: required", path, name)
			}
		}
		for name, prop := range s.Properties {
			item, present := obj[name]
			if !present || item == nil {
				continue
			}
			if err := prop.validate(item, path+"."+name); err != nil {
				return err
			}
		}
		return nil
	case "array":
		arr, ok := v.([]any)
		if !ok {
			return fmt.Errorf("%s: expected an array", path)
		}
		for i, item := range arr {
			if err := s.Items.validate(item, fmt.Sprintf("%s[%d]", path, i)); err != nil {
				return err
			}
		}
		return nil
	case "string":
		str, ok := v.(string)
		if !ok {
			return fmt.Errorf("%s: expected a string", path)
		}
		if len(s.Enum) > 0 && !slices.Contains(s.Enum, str) {
			return fmt.Errorf("%s: expected one of %s", path, strings.Join(s.Enum, ", "))
		}
		if s.Format == "uri" {
			if u, err := url.Parse(str); err != nil || !u.IsAbs() {
				return fmt.Errorf("%s: expected an absolute URI", path)
			}
		}
		return nil
	case "integer":
		n, ok := v.(json.Number)
		if !ok {
			return fmt.Errorf("%s: expected an integer", path)
		}
		i, err := n.Int64()
		limit := int64(math.MaxInt32)
		if s.Format == "int64" {
			limit = math.MaxInt64
		}
		if err != nil || i > limit || i < -limit-1 {
			return fmt.Errorf("%s: expected an integer that fits %s", path, map[bool]string{true: "int64", false: "int32"}[s.Format == "int64"])
		}
		return nil
	case "number":
		if _, ok := v.(json.Number); !ok {
			return fmt.Errorf("%s: expected a number", path)
		}
		return nil
	case "boolean":
		if _, ok := v.(bool); !ok {
			return fmt.Errorf("%s: expected a boolean", path)
		}
		return nil
	}
	return fmt.Errorf("%s: unsupported schema type %q", path, s.Type)
}
