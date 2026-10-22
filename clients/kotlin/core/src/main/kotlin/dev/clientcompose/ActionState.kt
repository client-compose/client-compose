package dev.clientcompose

import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** How an action call ended (UI-3): its result, one of its declared errors, or a failure. */
public sealed interface ActionResult<out R, out E> {
    public data class Ok<out R>(val result: R, val effects: ActionEffects) : ActionResult<R, Nothing>

    public data class Error<out E>(val error: E) : ActionResult<Nothing, E>

    /** No connection, `unauthenticated`, or an error code this app version doesn't know: show a generic message. */
    public data class Failed(val cause: Throwable) : ActionResult<Nothing, Nothing>
}

/** The declared error the call ended with, if it did. */
public val <E> ActionResult<*, E>?.declaredError: E? get() = (this as? ActionResult.Error<E>)?.error

/** Whether the call failed. */
public val ActionResult<*, *>?.failed: Boolean get() = this is ActionResult.Failed

/**
 * Runs one action with its pending state and last result, as [StateFlow]s. In Compose, get one with
 * `rememberAction(FollowUserV1)`.
 */
public class ActionState<I, R, E : DeclaredError>(
    private val client: ComposeClient,
    private val action: ActionDescriptor<I, R, E>,
) {
    private val _pending = MutableStateFlow(0)
    private val _last = MutableStateFlow<ActionResult<R, E>?>(null)

    /** Calls in flight. */
    public val inFlight: StateFlow<Int> = _pending.asStateFlow()

    /** How the last call ended. */
    public val last: StateFlow<ActionResult<R, E>?> = _last.asStateFlow()

    /** Performs the action. It never throws (except to cancel): failures are a result too. */
    public suspend fun run(input: I, idempotencyKey: String = UUID.randomUUID().toString()): ActionResult<R, E> {
        _pending.update { it + 1 }
        val result = try {
            when (val outcome = client.perform(action, input, idempotencyKey)) {
                is ActionOutcome.Ok -> ActionResult.Ok(outcome.result, outcome.effects)
                is ActionOutcome.Error -> ActionResult.Error(outcome.error)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            ActionResult.Failed(e)
        } finally {
            _pending.update { it - 1 }
        }
        _last.value = result
        return result
    }

    /** Forget the last result, e.g. when the form changes. */
    public fun reset() {
        _last.value = null
    }
}
