plugins {
    kotlin("jvm")
    `java-library`
}

group = "dev.clientcompose"
version = "0.0.0"

dependencies {
    api(project(":core"))
}

kotlin {
    jvmToolchain(17)
    explicitApi()
}
