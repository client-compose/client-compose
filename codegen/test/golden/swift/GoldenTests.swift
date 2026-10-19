import ClientCompose
import Foundation
import XCTest

/// Compiles the generated Swift and checks it decodes the shared sample.
final class GoldenTests: XCTestCase {
    func testKitchenSinkDecodes() throws {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<3 { root.deleteLastPathComponent() }  // golden/swift/<file> -> test/
        let data = try Data(contentsOf: root.appendingPathComponent("fixtures/kitchen-sink.sample.json"))
        let props = try JSONDecoder().decode(KitchenSinkV1.self, from: data)

        XCTAssertEqual(props.size, .extraLarge)
        XCTAssertEqual(props.author.avatarUrl, URL(string: "https://example.com/ada.png"))
        XCTAssertEqual(props.author.role, .admin)
        XCTAssertEqual(props.items?.last?.label, "Two")
        XCTAssertEqual(props.bigNumber, 5_000_000_000)
        XCTAssertEqual(props.class, "x")
        XCTAssertEqual(props.metadata, ["k": "v"])
    }

    func testRegisterUsesGeneratedTypeAndVersion() throws {
        let registry = IslandRegistry<String>()
            .register(KitchenSinkV1.self) { props, _ in props.title }
            .register(DividerV1.self) { _, _ in "divider" }
        XCTAssertEqual(registry.capabilities, ["kitchen-sink": [1], "divider": [1]])
    }
}
