// Strings (spec §4.7): the words a client shows, from the composer. Templates are filled in here,
// and counted strings pick their variant by the language's plural rules.
package dev.clientcompose

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** CLDR plural rules, for whole numbers: category ("one", "few"…) -> condition. */
public object Plurals {
    /** The categories in the order CLDR lists them: a count is in the first whose condition holds. */
    private val order = listOf("zero", "one", "two", "few", "many")

    /** A count's plural category in a language: the first whose condition holds, or "other". */
    public fun category(rules: Map<String, String>, count: Long): String =
        order.firstOrNull { category -> rules[category]?.let { holds(it, count) } == true } ?: "other"

    /**
     * `or` of `and`s of relations like `i % 10 = 2..4`. For a whole number, `n` and `i` are the
     * number, and `v`, `w`, `f`, `t`, `c` and `e` are zero.
     */
    private fun holds(condition: String, count: Long): Boolean =
        condition.split(" or ").any { all -> all.split(" and ").all { relates(it, count) } }

    private fun relates(relation: String, count: Long): Boolean {
        val negated = "!=" in relation
        val sides = relation.split(if (negated) "!=" else "=")
        if (sides.size != 2) return false
        val left = sides[0].split("%").map { it.trim() }
        val operand = left[0]
        if (operand.length != 1 || operand[0] !in "nivwftce") return false
        var value = if (operand == "n" || operand == "i") Math.abs(count) else 0L
        if (left.size == 2) {
            val modulus = left[1].toLongOrNull() ?: return false
            if (modulus == 0L) return false
            value %= modulus
        }
        val inRanges = sides[1].split(",").any { range ->
            val bounds = range.trim().split("..")
            val from = bounds[0].toLongOrNull() ?: return@any false
            val to = bounds.getOrNull(1)?.toLongOrNull()
            if (to == null) value == from else value in from..to
        }
        return if (negated) !inRanges else inRanges
    }
}

private val slot = Regex("""\{([A-Za-z0-9]+)\}""")

/**
 * A string's words with its params filled in. A template is text, or a counted string's variants
 * (`#1`, `#few`, `#*`): chosen by the exact count, then its plural category, then `#*`. A missing
 * string is empty.
 */
public fun formatString(template: JsonElement?, values: Map<String, String> = emptyMap(), plurals: Map<String, String> = emptyMap()): String {
    val text = when (template) {
        is JsonPrimitive -> template.contentOrNull ?: ""
        is JsonObject -> {
            val variant = { key: String -> (template[key] as? JsonPrimitive)?.contentOrNull }
            val count = values["count"]?.toLongOrNull()
            (count?.let { variant("#$it") ?: variant("#${Plurals.category(plurals, it)}") } ?: variant("#*")) ?: ""
        }
        else -> return ""
    }
    return slot.replace(text) { match -> values[match.groupValues[1]] ?: match.value }
}

/** Strings in one language, as generated strings classes read them. */
public class StringsTable(
    public val strings: Map<String, JsonElement> = emptyMap(),
    public val plurals: Map<String, String> = emptyMap(),
) {
    /** A string with no params. */
    public fun text(key: String): String = formatString(strings[key], plurals = plurals)

    /** A string with its params filled in. */
    public fun format(key: String, values: Map<String, String>): String = formatString(strings[key], values, plurals)
}

/**
 * Implemented by the companion of generated props types whose island declares strings: it builds
 * the strings its renderer receives as `t`.
 */
public interface IslandDescriptorWithStrings<P, S> : IslandDescriptor<P> {
    public fun strings(table: StringsTable): S
}

/** The app strings (spec §4.7), the language they're in, and its plural rules. */
@Serializable
public data class StringsResponse(
    @SerialName("protocol") val protocolVersion: Int = PROTOCOL_VERSION,
    val locale: String,
    val plurals: Map<String, String> = emptyMap(),
    val strings: Map<String, JsonElement> = emptyMap(),
) {
    /** The strings, typed by the generated `AppStrings`: `response.app(::AppStrings).retry`. */
    public fun <S> app(build: (StringsTable) -> S): S = build(StringsTable(strings, plurals))
}
