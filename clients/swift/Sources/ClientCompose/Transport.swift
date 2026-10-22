import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// How a `ComposeClient` reaches the composer. `URLSessionTransport` is the default; tests use
/// `FakeComposer` (ClientComposeTesting), and apps can send requests their own way.
public protocol Transport: Sendable {
    /// POST `body` (JSON) to `path`, relative to the composer's base URL (e.g. "screens/profile").
    func post(path: String, body: Data, headers: [String: String]) async throws -> TransportResponse
}

public struct TransportResponse: Sendable {
    public let status: Int
    public let body: Data

    public init(status: Int, body: Data) {
        self.status = status
        self.body = body
    }
}

/// Sends requests with `URLSession`.
public struct URLSessionTransport: Transport {
    public let baseURL: URL
    public let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func post(path: String, body: Data, headers: [String: String]) async throws -> TransportResponse {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        request.httpBody = body
        // A data task rather than `data(for:)`, which Foundation on Linux lacks.
        let (data, response): (Data, URLResponse) = try await withCheckedThrowingContinuation { continuation in
            session.dataTask(with: request) { data, response, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let data, let response {
                    continuation.resume(returning: (data, response))
                } else {
                    continuation.resume(throwing: URLError(.badServerResponse))
                }
            }.resume()
        }
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return TransportResponse(status: http.statusCode, body: data)
    }
}
