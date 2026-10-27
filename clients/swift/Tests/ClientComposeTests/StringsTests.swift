import ClientCompose
import ClientComposeTesting
import Foundation
import XCTest

/// Strings (spec §4.7): plural rules and templates against the shared fixtures, islands' `t`, and the
/// app strings.
final class StringsTests: XCTestCase {
    private static var root: URL {
        // clients/swift/Tests/ClientComposeTests/<file> -> repo root
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        return root
    }

    private struct Rules: Decodable { let rules: [String: PluralRules] }
    private struct PluralCases: Decodable { let cases: [String: [String: [Int]]] }
    private struct StringCases: Decodable { let cases: [StringCase] }
    private struct StringCase: Decodable {
        let name: String
        let language: String
        let template: StringTemplate
        let values: [String: JSONValue]
        let expect: String
    }

    private func load<T: Decodable>(_ path: String, as type: T.Type) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(contentsOf: Self.root.appendingPathComponent(path)))
    }

    func testPluralCategoriesAgreeWithCLDR() throws {
        let rules = try load("spec/plurals.json", as: Rules.self).rules
        let cases = try load("conformance/client/plural-cases.json", as: PluralCases.self).cases
        XCTAssertGreaterThan(cases.count, 200)
        for (language, categories) in cases {
            for (category, counts) in categories {
                for count in counts {
                    XCTAssertEqual(Plurals.category(rules[language] ?? [:], count), category, "\(language) \(count)")
                }
            }
        }
    }

    func testTemplatesAreFilledInAsTheFixturesSay() throws {
        let rules = try load("spec/plurals.json", as: Rules.self).rules
        for c in try load("conformance/client/string-cases.json", as: StringCases.self).cases {
            let values = c.values.mapValues { value -> String in
                switch value {
                case .int(let n): String(n)
                case .string(let s): s
                default: ""
                }
            }
            XCTAssertEqual(formatString(c.template, values, plurals: rules[c.language] ?? [:]), c.expect, c.name)
        }
    }

    private struct RecipesV1: IslandPropsWithStrings, Codable {
        static let islandType = "recipes"
        static let islandVersion = 1
        let total: Int

        struct Strings: IslandStrings {
            private let table: StringsTable
            init(_ table: StringsTable) { self.table = table }
            var heading: String { table.text("heading") }
            func count(count: Int) -> String { table.format("count", ["count": String(count)]) }
        }
    }

    private struct AppStrings: AppStringsProtocol {
        private let table: StringsTable
        init(_ table: StringsTable) { self.table = table }
        var retry: String { table.text("retry") }
    }

    private static let polish: PluralRules = [
        "one": "i = 1 and v = 0",
        "few": "v = 0 and i % 10 = 2..4 and i % 100 != 12..14",
        "many": "v = 0 and i != 1 and i % 10 = 0..1 or v = 0 and i % 10 = 5..9 or v = 0 and i % 100 = 12..14",
    ]

    func testAnIslandGetsItsStringsAsT() async throws {
        let composer = FakeComposer().screen("home") { _ in
            .screen("home", [
                .island("recipes", RecipesV1(total: 22), strings: [
                    "heading": .text("Przepisy"),
                    "count": .variants(["#1": "{count} przepis", "#few": "{count} przepisy", "#*": "{count} przepisów"]),
                ]),
            ], locale: "pl", plurals: Self.polish)
        }
        let registry = IslandRegistry<String>()
            .register(RecipesV1.self) { props, t, _ in "\(t.heading): \(t.count(count: props.total))" }
        let client = ComposeClient(transport: composer, context: ClientContext(appVersion: "1", locale: "pl"))
        let response = try await client.screen("home", islands: registry.capabilities)
        XCTAssertEqual(response.locale, "pl")
        XCTAssertEqual(registry.plan(response).map(\.output), ["Przepisy: 22 przepisy"])
    }

    func testFetchesTheAppStrings() async throws {
        let composer = FakeComposer().strings { client in
            .strings(client.locale ?? "en", ["retry": .text("Spróbuj ponownie")])
        }
        let client = ComposeClient(transport: composer, context: ClientContext(appVersion: "1", locale: "pl-PL"))
        let words = try await client.strings()
        XCTAssertEqual(words.locale, "pl-PL")
        XCTAssertEqual(words.app(AppStrings.self).retry, "Spróbuj ponownie")
        XCTAssertEqual(composer.stringsRequests.map(\.locale), ["pl-PL"])
    }

    func testAFailedStringsRequestThrows() async throws {
        let composer = FakeComposer().strings { _ in .failure(404, "no_strings") }
        let client = ComposeClient(transport: composer, context: ClientContext(appVersion: "1"))
        do {
            _ = try await client.strings()
            XCTFail("expected an error")
        } catch let error as ScreenError {
            XCTAssertEqual(error.code, "no_strings")
        }
    }
}
