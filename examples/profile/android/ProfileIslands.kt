// Android side of the profile example: island props, Compose UI, registry and screen.
// Dependencies: dev.clientcompose:compose, OkHttp, Coil (coil-compose), kotlinx.serialization.

package com.example.profile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import dev.clientcompose.*
import dev.clientcompose.compose.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

// --- Registry: what this app version can render ----------------------------------------
// ProfileHeaderV1, ProfileHeaderV2, FollowButtonV1, PostGridV1 and FollowUserV1 come from
// Islands.generated.kt, generated from ../islands and ../actions (see ../client-compose.codegen.json).

val islandRegistry = IslandRegistry<IslandContent>()
    .register(ProfileHeaderV1) { p, _ -> { ProfileHeader(p.displayName, p.avatarUrl, badge = null) } }
    .register(ProfileHeaderV2) { p, _ -> { ProfileHeader(p.displayName, p.avatarUrl, p.badge) } }
    .register(FollowButtonV1) { p, _ -> { FollowButton(p.userId, p.isFollowing) } }
    .register(PostGridV1) { p, _ -> { PostGrid(p.posts) } }

// --- Client: one for the app ------------------------------------------------------------
// HttpUrlConnectionTransport needs no dependencies; here's OkHttp instead, in a few lines.

class OkHttpTransport(private val http: OkHttpClient, private val baseUrl: HttpUrl) : Transport {
    override suspend fun post(path: String, body: String, headers: Map<String, String>): TransportResponse =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url(baseUrl.resolve(path)!!)
                .apply { headers.forEach { (name, value) -> header(name, value) } }
                .post(body.toRequestBody("application/json".toMediaType()))
                .build()
            http.newCall(request).execute().use { TransportResponse(it.code, it.body?.string().orEmpty()) }
        }
}

fun composeClient(http: OkHttpClient, session: Session, navigate: (ScreenRef) -> Unit) = ComposeClient(
    transport = OkHttpTransport(http, HttpUrl.Builder().scheme("https").host("api.example.com").addPathSegment("compose").addPathSegment("").build()),
    context = ClientContext(appVersion = BuildConfig.VERSION_NAME),
    headers = { mapOf("Authorization" to "Bearer ${session.token()}") },
    onNavigate = navigate,
)

// In your Activity: setContent { ProvideCompose(client, islandRegistry) { AppNavHost() } }

// --- Screen ----------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(userId: String) {
    var title by remember { mutableStateOf("") }
    Scaffold(topBar = { TopAppBar(title = { Text(title) }) }) { padding ->
        // The screen's title comes from the composer; following someone reloads it by itself.
        ComposedScreen(
            "profile",
            mapOf("userId" to userId),
            modifier = Modifier.padding(padding),
            onMeta = { title = it?.title.orEmpty() },
            failure = { error, retry ->
                Column(Modifier.fillMaxSize(), Arrangement.Center, Alignment.CenterHorizontally) {
                    if ((error as? ScreenException)?.isNotFound == true) {
                        Text("This profile doesn't exist")
                    } else {
                        Text("Couldn't load this profile")
                        Button(onClick = retry) { Text("Try again") }
                    }
                }
            },
        )
    }
}

// --- Island UI: entirely the app's business --------------------------------------------

@Composable
fun ProfileHeader(name: String, avatarUrl: String, badge: String?) {
    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
        AsyncImage(
            model = avatarUrl,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(64.dp).clip(CircleShape),
        )
        Spacer(Modifier.width(12.dp))
        Text(name, style = MaterialTheme.typography.titleLarge)
        if (badge != null) {
            Spacer(Modifier.width(8.dp))
            AssistChip(onClick = {}, label = { Text(badge) })
        }
    }
}

@Composable
fun FollowButton(userId: String, isFollowing: Boolean) {
    val follow = rememberAction(FollowUserV1)
    Column(Modifier.padding(horizontal = 16.dp)) {
        // The composer says the profile changed, so it reloads with the new state.
        Button(onClick = { follow.run(FollowUserV1.Input(userId = userId, follow = !isFollowing)) }, enabled = !follow.pending) {
            Text(if (isFollowing) "Following" else "Follow")
        }
        if (follow.last.declaredError == FollowUserV1.Error.Blocked) Text("You can't follow this person")
        else if (follow.last.failed) Text("Something went wrong")
    }
}

@Composable
fun PostGrid(posts: List<PostGridV1.Post>) {
    // Inside a LazyColumn, so lay out rows manually rather than nesting a lazy grid.
    Column(Modifier.padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        posts.chunked(3).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                row.forEach { post ->
                    AsyncImage(
                        model = post.thumbnailUrl,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.weight(1f).aspectRatio(1f),
                    )
                }
                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

// --- Stand-in for your app's own session --------------------------------------------------

interface Session {
    suspend fun token(): String
}
