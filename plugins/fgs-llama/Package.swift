// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FgsLlama",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "FgsLlama", targets: ["FgsLlamaPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        // llama.cpp, built by the llama.cpp project itself (Metal included). Pinned to one release.
        .binaryTarget(
            name: "llama",
            url: "https://github.com/ggml-org/llama.cpp/releases/download/b10000/llama-b10000-xcframework.zip",
            checksum: "325b862774bfbb19d3002449d895b174f6f4c9a681bbd689d2c74c0c0b73d0bb"
        ),
        .target(
            name: "FgsLlamaPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                "llama"
            ],
            path: "ios/Sources/FgsLlamaPlugin")
    ]
)
