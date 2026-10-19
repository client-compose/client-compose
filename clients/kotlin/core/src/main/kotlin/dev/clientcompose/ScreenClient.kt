package dev.clientcompose

/** Minimal HTTP abstraction so the core doesn't pick an HTTP library for you. */
public fun interface ScreenTransport {
    /** POST `body` (JSON) to `path`, relative to your composer's base URL. */
    public suspend fun post(path: String, body: String): TransportResponse
}

public data class TransportResponse(val status: Int, val body: String)

public class ScreenClientException(public val status: Int, public val body: String) :
    RuntimeException("Screen request failed with status $status")

/** Fetches screens from a composer. Plug in OkHttp, Ktor, etc. via [ScreenTransport]. */
public class ScreenClient(private val transport: ScreenTransport) {
    public suspend fun fetch(request: ScreenRequest): ScreenResponse {
        val path = "screens/" + java.net.URLEncoder.encode(request.screen, "UTF-8").replace("+", "%20")
        val response = transport.post(path, ClientComposeJson.encodeToString(ScreenRequest.serializer(), request))
        if (response.status !in 200..299) throw ScreenClientException(response.status, response.body)
        return ClientComposeJson.decodeFromString(ScreenResponse.serializer(), response.body)
    }
}
