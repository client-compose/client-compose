import ClientCompose
import Foundation
import XCTest

/// Runs the shared client conformance fixtures (spec §8.2).
final class ConformanceTests: XCTestCase {
    private struct Fixture: Decodable {
        let cases: [Case]
    }

    private struct Case: Decodable {
        let name: String
        let registered: [String: [Int]]
        let expectCapabilities: [String: [Int]]
        let renderErrors: Bool?
        let response: JSONValue
        let expectRendered: [String]
        let expectSkipped: [String]
    }

    private struct TestProps: Decodable {
        let v: Int
    }

    func testClientConformanceCases() throws {
        // clients/swift/Tests/ClientComposeTests/<file> -> repo root
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        let data = try Data(contentsOf: root.appendingPathComponent("conformance/client/cases.json"))
        let fixture = try JSONDecoder().decode(Fixture.self, from: data)
        XCTAssertFalse(fixture.cases.isEmpty)

        for c in fixture.cases {
            let registry = IslandRegistry<String>()
            for (type, versions) in c.registered {
                for version in versions {
                    registry.register(type, version: version) { (props: TestProps, _) in "\(type)@\(version):\(props.v)" }
                }
            }
            XCTAssertEqual(registry.capabilities, c.expectCapabilities, c.name)

            let response = try c.response.decode(ScreenResponse.self)
            var skipped: [String] = []
            let planned = registry.plan(
                response,
                onError: c.renderErrors == true ? { entry, error in "error:\(entry.key):\(error.code)" } : nil,
                onSkipped: { entry, _ in skipped.append(entry.key) }
            )
            XCTAssertEqual(planned.map(\.output), c.expectRendered, c.name)
            XCTAssertEqual(skipped, c.expectSkipped, c.name)
        }
    }

    func testClientContextEncodesExtraFieldsFlat() throws {
        let context = ClientContext(appVersion: "4.2.0", extra: ["osVersion": "18.1"])
        let json = try JSONDecoder().decode([String: String].self, from: JSONEncoder().encode(context))
        XCTAssertEqual(json, ["platform": "ios", "appVersion": "4.2.0", "osVersion": "18.1"])
    }
}
