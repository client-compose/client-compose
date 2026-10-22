plugins {
    id("com.android.library")
    kotlin("android")
    kotlin("plugin.compose")
    kotlin("plugin.serialization")
}

group = "dev.clientcompose"
version = "0.0.0"

android {
    namespace = "dev.clientcompose.compose"
    compileSdk = 36
    defaultConfig { minSdk = 24 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
    testOptions { unitTests.isIncludeAndroidResources = true }
}

// Unit tests run once, in the debug variant, where the Compose test manifest is.
androidComponents {
    beforeVariants(selector().withBuildType("release")) { it.enableUnitTest = false }
}

kotlin {
    jvmToolchain(17)
    explicitApi()
}

dependencies {
    api(project(":core"))
    val bom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(bom)
    api("androidx.compose.runtime:runtime")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")

    testImplementation(bom)
    testImplementation(project(":testing"))
    testImplementation(kotlin("test"))
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
