rootProject.name = "client-compose-kotlin"

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
    plugins {
        kotlin("jvm") version "2.1.0"
        kotlin("plugin.serialization") version "2.1.0"
        kotlin("android") version "2.1.0"
        kotlin("plugin.compose") version "2.1.0"
        id("com.android.library") version "8.9.0"
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

include("core", "testing", "compose")
