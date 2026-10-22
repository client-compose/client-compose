package dev.clientcompose

import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * How a [ComposeClient] reaches the composer. [HttpUrlConnectionTransport] needs no dependencies;
 * plug in OkHttp or Ktor in a few lines, or `FakeComposer` (client-compose-testing) in tests.
 */
public fun interface Transport {
    /** POST [body] (JSON) to [path], relative to the composer's base URL (e.g. "screens/profile"). */
    public suspend fun post(path: String, body: String, headers: Map<String, String>): TransportResponse
}

public data class TransportResponse(val status: Int, val body: String)

/** Sends requests with `java.net.HttpURLConnection`, on Android and the JVM, on [Dispatchers.IO]. */
public class HttpUrlConnectionTransport(private val baseUrl: String) : Transport {
    override suspend fun post(path: String, body: String, headers: Map<String, String>): TransportResponse =
        withContext(Dispatchers.IO) {
            val connection = URL(baseUrl.trimEnd('/') + "/" + path).openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
                connection.outputStream.use { it.write(body.toByteArray()) }
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                TransportResponse(status, stream?.bufferedReader()?.use { it.readText() } ?: "")
            } finally {
                connection.disconnect()
            }
        }
}
