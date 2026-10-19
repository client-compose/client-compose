// swift-tools-version:5.10
// Lives at the repo root because SwiftPM resolves packages from a git repo's root.
// Only the Swift client is exposed here; see clients/swift/README.md.

import PackageDescription

let package = Package(
    name: "ClientCompose",
    platforms: [.iOS(.v15), .macOS(.v12), .tvOS(.v15), .watchOS(.v8)],
    products: [
        .library(name: "ClientCompose", targets: ["ClientCompose"]),
        .library(name: "ClientComposeSwiftUI", targets: ["ClientComposeSwiftUI"]),
    ],
    targets: [
        .target(name: "ClientCompose", path: "clients/swift/Sources/ClientCompose"),
        .target(
            name: "ClientComposeSwiftUI",
            dependencies: ["ClientCompose"],
            path: "clients/swift/Sources/ClientComposeSwiftUI"
        ),
        .testTarget(
            name: "ClientComposeTests",
            dependencies: ["ClientCompose"],
            path: "clients/swift/Tests/ClientComposeTests"
        ),
        // Compiles and exercises codegen's golden Swift output.
        .testTarget(
            name: "CodegenGoldenTests",
            dependencies: ["ClientCompose"],
            path: "codegen/test/golden/swift"
        ),
    ]
)
