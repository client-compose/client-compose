plugins {
    kotlin("jvm") version "2.1.0"
    kotlin("plugin.serialization") version "2.1.0"
    `java-library`
}

group = "dev.clientcompose"
version = "0.0.0"

dependencies {
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    testImplementation(kotlin("test"))
}

kotlin {
    jvmToolchain(17)
    explicitApi()
}

// Compile and exercise codegen's golden Kotlin output as part of the tests.
sourceSets.test {
    kotlin.srcDir(rootProject.file("../../codegen/test/golden/kotlin"))
}

tasks.test {
    useJUnitPlatform()
    systemProperty("conformanceDir", rootProject.file("../../conformance").absolutePath)
    systemProperty("codegenFixturesDir", rootProject.file("../../codegen/test/fixtures").absolutePath)
}
