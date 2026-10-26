import Foundation

/// A screen's stream (spec §4.6): JSON lines, a head first, then each pending island, then an end.
public enum ScreenStream {
    /// The stream's body didn't start with a head.
    public struct NotAStream: Error {}

    private struct Line: Decodable {
        let kind: String
        let island: IslandEntry?
    }

    /// Reads a stream to its end and returns the screen with every island in place. Islands still
    /// pending when it ends without its end line are errors with code `incomplete`, retryable.
    /// Lines of a kind it doesn't know, and islands that aren't pending, are skipped.
    public static func read(_ body: Data) throws -> ScreenResponse {
        let decoder = JSONDecoder()
        let lines = body.split(separator: UInt8(ascii: "\n")).filter { !$0.isEmpty }
        guard let first = lines.first,
              (try? decoder.decode(Line.self, from: Data(first)))?.kind == "head" else {
            throw NotAStream()
        }
        let head = try decoder.decode(ScreenResponse.self, from: Data(first))
        var islands = head.islands
        for raw in lines.dropFirst() {
            guard let line = try? decoder.decode(Line.self, from: Data(raw)) else { continue }
            if line.kind == "end" {
                return ScreenResponse(protocol: head.protocol, screen: head.screen, islands: islands, meta: head.meta, cache: head.cache)
            }
            guard line.kind == "island", let entry = line.island, entry.status != "pending",
                  let i = islands.firstIndex(where: { $0.key == entry.key && $0.status == "pending" }) else { continue }
            islands[i] = entry
        }
        let completed = islands.map { entry in
            entry.status == "pending"
                ? IslandEntry(key: entry.key, type: entry.type, version: entry.version, status: "error", props: nil,
                              error: IslandError(code: "incomplete", message: nil, retryable: true))
                : entry
        }
        return ScreenResponse(protocol: head.protocol, screen: head.screen, islands: completed, meta: head.meta, cache: head.cache)
    }
}
