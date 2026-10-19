// Android side of the profile example: island props, Compose UI, registry and screen.
// Dependencies: dev.clientcompose:core, OkHttp, Coil (coil-compose), kotlinx.serialization,
// androidx.lifecycle:lifecycle-viewmodel-compose.

package com.example.profile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import coil.compose.AsyncImage
import dev.clientcompose.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

// --- Registry: what this app version can render ----------------------------------------
// ProfileHeaderV1, ProfileHeaderV2, FollowButtonV1 and PostGridV1 come from
// Islands.generated.kt, generated from ../islands (see ../client-compose.codegen.json).

typealias IslandContent = @Composable () -> Unit

val islandRegistry = IslandRegistry<IslandContent>()
    .register(ProfileHeaderV1) { p, _ -> { ProfileHeader(p.displayName, p.avatarUrl, badge = null) } }
    .register(ProfileHeaderV2) { p, _ -> { ProfileHeader(p.displayName, p.avatarUrl, p.badge) } }
    .register(FollowButtonV1) { p, _ -> { FollowButton(p.userId, p.isFollowing) } }
    .register(PostGridV1) { p, _ -> { PostGrid(p.posts) } }

// --- Transport: the core doesn't pick an HTTP library ----------------------------------

class OkHttpTransport(private val http: OkHttpClient, private val baseUrl: HttpUrl) : ScreenTransport {
    override suspend fun post(path: String, body: String): TransportResponse = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(baseUrl.resolve(path)!!)
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        http.newCall(request).execute().use { TransportResponse(it.code, it.body?.string().orEmpty()) }
    }
}

// --- Screen ----------------------------------------------------------------------------

class ProfileViewModel(private val client: ScreenClient, private val userId: String) : ViewModel() {
    sealed interface State {
        data object Loading : State
        data class Loaded(val islands: List<PlannedIsland<IslandContent>>) : State
        data class Failed(val error: Throwable) : State
    }

    var state by mutableStateOf<State>(State.Loading)
        private set

    init { load() }

    fun load() {
        state = State.Loading
        viewModelScope.launch {
            state = try {
                val request = islandRegistry.request(
                    screen = "profile",
                    client = ClientContext(appVersion = BuildConfig.VERSION_NAME),
                    params = mapOf("userId" to userId),
                )
                val response = client.fetch(request)
                State.Loaded(islandRegistry.plan(response, onSkipped = { entry, reason ->
                    android.util.Log.w("ClientCompose", "skipped ${entry.key}: $reason")
                }))
            } catch (e: Exception) {
                State.Failed(e)
            }
        }
    }
}

@Composable
fun ProfileScreen(viewModel: ProfileViewModel) {
    when (val state = viewModel.state) {
        ProfileViewModel.State.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
        is ProfileViewModel.State.Failed -> Column(Modifier.fillMaxSize(), Arrangement.Center, Alignment.CenterHorizontally) {
            Text("Couldn't load this profile")
            Button(onClick = viewModel::load) { Text("Try again") }
        }
        is ProfileViewModel.State.Loaded -> LazyColumn(Modifier.fillMaxSize()) {
            items(state.islands, key = { it.key }) { island -> island.output() }
        }
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
fun FollowButton(userId: String, initiallyFollowing: Boolean) {
    var following by remember(userId) { mutableStateOf(initiallyFollowing) }
    // Interactivity stays on the client: call your follow API directly here.
    Button(onClick = { following = !following }, modifier = Modifier.padding(horizontal = 16.dp)) {
        Text(if (following) "Following" else "Follow")
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
