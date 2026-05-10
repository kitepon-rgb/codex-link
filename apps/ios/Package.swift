// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "CodexLinkIOS",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "CodexLinkIOS", targets: ["CodexLinkIOS"]),
    ],
    targets: [
        .target(name: "CodexLinkIOS"),
        .testTarget(name: "CodexLinkIOSTests", dependencies: ["CodexLinkIOS"]),
    ]
)
