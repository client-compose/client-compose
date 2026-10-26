package dev.clientcompose

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** A screen's stream (spec §4.6): JSON lines, a head first, then each pending island, then an end. */
public object ScreenStream {
    /** The stream's body didn't start with a head. */
    public class NotAStream : IllegalArgumentException("not a screen's stream")

    /**
     * Reads a stream to its end and returns the screen with every island in place. Islands still
     * pending when it ends without its end line are errors with code `incomplete`, retryable.
     * Lines of a kind it doesn't know, and islands that aren't pending, are skipped.
     */
    public fun read(body: String): ScreenResponse {
        val lines = body.lineSequence().filter { it.isNotBlank() }.map { parse(it) }.toList()
        val first = lines.firstOrNull()
        if (first == null || kindOf(first) != "head") throw NotAStream()
        val head = ClientComposeJson.decodeFromJsonElement(ScreenResponse.serializer(), first)
        val islands = head.islands.toMutableList()
        for (line in lines.drop(1)) {
            when (kindOf(line)) {
                "end" -> return head.copy(islands = islands)
                "island" -> {
                    val entry = line?.get("island")
                        ?.let { runCatching { ClientComposeJson.decodeFromJsonElement(IslandEntry.serializer(), it) }.getOrNull() }
                        ?: continue
                    if (entry.status == "pending") continue
                    val i = islands.indexOfFirst { it.key == entry.key && it.status == "pending" }
                    if (i != -1) islands[i] = entry
                }
            }
        }
        return head.copy(islands = islands.map {
            if (it.status == "pending") it.copy(status = "error", error = IslandError("incomplete", retryable = true)) else it
        })
    }

    private fun parse(line: String): JsonObject? =
        runCatching { ClientComposeJson.parseToJsonElement(line).jsonObject }.getOrNull()

    private fun kindOf(line: JsonObject?): String? = line?.get("kind")?.jsonPrimitive?.contentOrNull
}
