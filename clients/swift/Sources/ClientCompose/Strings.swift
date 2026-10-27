import Foundation

// Strings (spec §4.7): the words a client shows, from the composer. Templates are filled in here,
// and counted strings pick their variant by the language's plural rules.

/// A string's words: text with `{name}` for each param, or a counted string's variants by count
/// (`#1`, `#few`, `#*`).
public enum StringTemplate: Codable, Sendable, Equatable {
    case text(String)
    case variants([String: String])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let text = try? c.decode(String.self) {
            self = .text(text)
        } else {
            self = .variants(try c.decode([String: String].self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .text(let text): try c.encode(text)
        case .variants(let variants): try c.encode(variants)
        }
    }
}

/// A language's plural rules: category ("one", "few"…) -> condition, in CLDR's syntax.
public typealias PluralRules = [String: String]

/// CLDR plural rules, for whole numbers.
public enum Plurals {
    /// The categories in the order CLDR lists them: a count is in the first whose condition holds.
    private static let order = ["zero", "one", "two", "few", "many"]

    /// A count's plural category in a language: the first whose condition holds, or "other".
    public static func category(_ rules: PluralRules, _ count: Int) -> String {
        for category in order {
            if let condition = rules[category], holds(condition, count) { return category }
        }
        return "other"
    }

    /// `or` of `and`s of relations like `i % 10 = 2..4`. For a whole number, `n` and `i` are the
    /// number, and `v`, `w`, `f`, `t`, `c` and `e` are zero.
    private static func holds(_ condition: String, _ count: Int) -> Bool {
        condition.components(separatedBy: " or ").contains { all in
            all.components(separatedBy: " and ").allSatisfy { relates($0, count) }
        }
    }

    private static func relates(_ relation: String, _ count: Int) -> Bool {
        let negated = relation.contains("!=")
        let sides = relation.components(separatedBy: negated ? "!=" : "=")
        guard sides.count == 2 else { return false }
        let left = sides[0].components(separatedBy: "%").map { $0.trimmingCharacters(in: .whitespaces) }
        guard let operand = left.first, operand.count == 1, "nivwftce".contains(operand) else { return false }
        var value = operand == "n" || operand == "i" ? abs(count) : 0
        if left.count == 2 {
            guard let modulus = Int(left[1]), modulus != 0 else { return false }
            value %= modulus
        }
        let inRanges = sides[1].components(separatedBy: ",").contains { range in
            let bounds = range.trimmingCharacters(in: .whitespaces).components(separatedBy: "..")
            guard let from = Int(bounds[0]) else { return false }
            guard bounds.count == 2, let to = Int(bounds[1]) else { return value == from }
            return value >= from && value <= to
        }
        return negated ? !inRanges : inRanges
    }
}

/// A string's words with its params filled in. Variants are chosen by the exact count, then its
/// plural category, then `#*`. A missing string is empty.
public func formatString(_ template: StringTemplate?, _ values: [String: String] = [:], plurals: PluralRules = [:]) -> String {
    let text: String
    switch template {
    case nil: return ""
    case .text(let t): text = t
    case .variants(let variants):
        if let count = values["count"].flatMap({ Int($0) }) {
            text = variants["#\(count)"] ?? variants["#\(Plurals.category(plurals, count))"] ?? variants["#*"] ?? ""
        } else {
            text = variants["#*"] ?? ""
        }
    }
    var out = ""
    var rest = Substring(text)
    while let open = rest.firstIndex(of: "{") {
        out += rest[..<open]
        let after = rest[rest.index(after: open)...]
        guard let close = after.firstIndex(of: "}"),
              case let name = after[..<close],
              !name.isEmpty, name.allSatisfy({ $0.isLetter || $0.isNumber }) else {
            out.append("{")
            rest = after
            continue
        }
        out += values[String(name)] ?? "{\(name)}"
        rest = after[after.index(after: close)...]
    }
    return out + rest
}

/// Strings in one language, as generated strings types read them.
public struct StringsTable: Sendable {
    public let strings: [String: StringTemplate]
    public let plurals: PluralRules

    public init(strings: [String: StringTemplate] = [:], plurals: PluralRules = [:]) {
        self.strings = strings
        self.plurals = plurals
    }

    /// A string with no params.
    public func text(_ key: String) -> String { formatString(strings[key], plurals: plurals) }

    /// A string with its params filled in.
    public func format(_ key: String, _ values: [String: String]) -> String {
        formatString(strings[key], values, plurals: plurals)
    }
}

/// An island's strings, generated by codegen: what its renderer receives as `t`.
public protocol IslandStrings: Sendable {
    init(_ table: StringsTable)
}

/// A generated props type whose island declares strings.
public protocol IslandPropsWithStrings: IslandProps {
    associatedtype Strings: IslandStrings
}

/// The app strings, generated by codegen.
public protocol AppStringsProtocol: Sendable {
    init(_ table: StringsTable)
}

/// The app strings (spec §4.7), the language they're in, and its plural rules.
public struct StringsResponse: Codable, Sendable, Equatable {
    public let `protocol`: Int
    public let locale: String
    public let plurals: PluralRules
    public let strings: [String: StringTemplate]

    public init(protocol: Int = ClientCompose.protocolVersion, locale: String, plurals: PluralRules = [:], strings: [String: StringTemplate]) {
        self.protocol = `protocol`
        self.locale = locale
        self.plurals = plurals
        self.strings = strings
    }

    /// The strings, typed by the generated `AppStrings`: `response.app(AppStrings.self).retry`.
    public func app<S: AppStringsProtocol>(_ type: S.Type) -> S {
        S(StringsTable(strings: strings, plurals: plurals))
    }
}

struct StringsRequest: Encodable {
    let `protocol`: Int
    let client: ClientContext
}
