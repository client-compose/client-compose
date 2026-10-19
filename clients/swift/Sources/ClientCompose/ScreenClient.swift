import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum ScreenClientError: Error {
    case http(status: Int, body: String)
    case invalidResponse
}

/// Fetches screens from a composer over HTTP.
public struct ScreenClient {
    public var baseURL: URL
    public var session: URLSession
    /// Extra headers for every request, e.g. `Authorization`.
    public var headers: [String: String]

    public init(baseURL: URL, session: URLSession = .shared, headers: [String: String] = [:]) {
        self.baseURL = baseURL
        self.session = session
        self.headers = headers
    }

    public func fetch(_ request: ScreenRequest) async throws -> ScreenResponse {
        var urlRequest = URLRequest(url: baseURL.appendingPathComponent("screens").appendingPathComponent(request.screen))
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        for (name, value) in headers { urlRequest.setValue(value, forHTTPHeaderField: name) }
        urlRequest.httpBody = try JSONEncoder().encode(request)

        let (data, response) = try await send(urlRequest)
        guard let http = response as? HTTPURLResponse else { throw ScreenClientError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw ScreenClientError.http(status: http.statusCode, body: String(decoding: data, as: UTF8.self))
        }
        return try JSONDecoder().decode(ScreenResponse.self, from: data)
    }

    private func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
        try await withCheckedThrowingContinuation { continuation in
            session.dataTask(with: request) { data, response, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let data, let response {
                    continuation.resume(returning: (data, response))
                } else {
                    continuation.resume(throwing: ScreenClientError.invalidResponse)
                }
            }.resume()
        }
    }
}
