import ClientCompose
import Foundation
import XCTest

/// Runs the shared client fixtures for actions and effects (spec §5, §8.2).
final class ActionConformanceTests: XCTestCase {
    private struct Suite: Decodable {
        struct Request: Decodable {
            let name: String
            let input: JSONValue
            let idempotencyKey: String
            let expectPath: String
            let expectBody: JSONValue
        }

        struct Response: Decodable {
            let status: Int
            let body: JSONValue?
            let rawBody: String?

            var data: Data { rawBody.map { Data($0.utf8) } ?? (try? JSONEncoder().encode(body)) ?? Data() }
        }

        struct Outcome: Decodable {
            let name: String
            let response: Response
            let expect: JSONValue
        }

        struct Ref: Decodable {
            let name: String
            let ref: ScreenRef
            let screen: String
            let params: [String: String]
            let matches: Bool
        }

        struct ScreenErrorCase: Decodable {
            let name: String
            let status: Int
            let body: JSONValue?
            let rawBody: String?
            let expectCode: String?
        }

        let requests: [Request]
        let outcomes: [Outcome]
        let screenRefs: [Ref]
        let screenErrors: [ScreenErrorCase]
    }

    /// The fixtures' action: rename-thing v2, declaring "taken" and "locked".
    private enum Fixture: ActionDescriptor {
        static let action = "rename-thing"
        static let version = 2
        typealias Input = JSONValue
        typealias Result = JSONValue

        enum DeclaredError: DeclaredActionError {
            case declared(code: String, details: JSONValue?)

            static let codes = ["taken", "locked"]

            init(code: String, details: JSONValue?) throws {
                self = .declared(code: code, details: details)
            }

            var code: String {
                if case .declared(let code, _) = self { return code }
                return ""
            }

            var details: JSONValue? {
                if case .declared(_, let details) = self { return details }
                return nil
            }
        }
    }

    /// Answers every request with one response, and records the last request.
    private final class Recorder: Transport, @unchecked Sendable {
        let status: Int
        let body: Data
        var path: String?
        var sent: Data?

        init(status: Int = 200, body: Data = Data(#"{"protocol":0,"status":"ok","result":{}}"#.utf8)) {
            self.status = status
            self.body = body
        }

        func post(path: String, body: Data, headers: [String: String]) async throws -> TransportResponse {
            self.path = path
            sent = body
            return TransportResponse(status: status, body: self.body)
        }
    }

    private let context = ClientContext(platform: "conformance", appVersion: "0.0.0")

    private func suite() throws -> Suite {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        let data = try Data(contentsOf: root.appendingPathComponent("conformance/client/action-cases.json"))
        return try JSONDecoder().decode(Suite.self, from: data)
    }

    func testRequests() async throws {
        for c in try suite().requests {
            let transport = Recorder()
            let client = ComposeClient(transport: transport, context: context)
            _ = try await client.perform(Fixture.self, c.input, idempotencyKey: c.idempotencyKey)
            XCTAssertEqual(transport.path, c.expectPath, c.name)
            let body = try JSONDecoder().decode(JSONValue.self, from: XCTUnwrap(transport.sent))
            XCTAssertEqual(body, c.expectBody, c.name)
        }
    }

    func testOutcomes() async throws {
        for c in try suite().outcomes {
            let client = ComposeClient(transport: Recorder(status: c.response.status, body: c.response.data), context: context)
            let outcome: JSONValue
            do {
                switch try await client.perform(Fixture.self, .object([:])) {
                case .ok(let result, let effects):
                    outcome = .object(["outcome": .string("ok"), "result": result, "effects": try json(effects)])
                case .error(let error):
                    outcome = .object(["outcome": .string("error"), "code": .string(error.code), "details": error.details ?? .null])
                }
            } catch let failure as ActionFailure {
                outcome = .object([
                    "outcome": .string("failed"),
                    "status": .int(failure.status),
                    "code": failure.code.map(JSONValue.string) ?? .null,
                ])
            }
            XCTAssertEqual(outcome, c.expect, c.name)
        }
    }

    func testScreenRefs() throws {
        for c in try suite().screenRefs {
            XCTAssertEqual(c.ref.matches(screen: c.screen, params: c.params), c.matches, c.name)
        }
    }

    func testScreenErrors() async throws {
        for c in try suite().screenErrors {
            let body = try c.rawBody.map { Data($0.utf8) } ?? JSONEncoder().encode(c.body)
            let client = ComposeClient(transport: Recorder(status: c.status, body: body), context: context)
            do {
                _ = try await client.screen("s", islands: [:])
                XCTFail("\(c.name): expected a ScreenError")
            } catch let error as ScreenError {
                XCTAssertEqual(error.code, c.expectCode, c.name)
                XCTAssertEqual(error.status, c.status, c.name)
            }
        }
    }

    /// Effects as the fixtures write them: only the ones present.
    private func json(_ effects: ActionEffects) throws -> JSONValue {
        var out: [String: JSONValue] = [:]
        if !effects.invalidate.isEmpty { out["invalidate"] = try JSONValue(encoding: effects.invalidate) }
        if let navigate = effects.navigate { out["navigate"] = try JSONValue(encoding: navigate) }
        return .object(out)
    }
}
