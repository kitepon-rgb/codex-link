import Foundation

public struct CodexLinkDeviceSession: Codable, Equatable, Sendable {
    public let relayUrl: String
    public let userId: String
    public let deviceId: String
    public let displayName: String
    public let deviceName: String

    public init(
        relayUrl: String,
        userId: String,
        deviceId: String,
        displayName: String,
        deviceName: String
    ) {
        self.relayUrl = relayUrl
        self.userId = userId
        self.deviceId = deviceId
        self.displayName = displayName
        self.deviceName = deviceName
    }
}

public struct CodexLinkDeviceSessionRequest: Encodable, Equatable, Sendable {
    public let displayName: String
    public let deviceName: String

    public init(displayName: String, deviceName: String) {
        self.displayName = displayName
        self.deviceName = deviceName
    }
}

public struct CodexLinkDevicePairingRequest: Encodable, Equatable, Sendable {
    public let userId: String
    public let deviceId: String
    public let pairingCode: String

    public init(userId: String, deviceId: String, pairingCode: String) {
        self.userId = userId
        self.deviceId = deviceId
        self.pairingCode = pairingCode
    }
}

public struct CodexLinkDeviceRevocationRequest: Encodable, Equatable, Sendable {
    public let userId: String
    public let deviceId: String

    public init(userId: String, deviceId: String) {
        self.userId = userId
        self.deviceId = deviceId
    }
}

public struct CodexLinkDevicePairingResult: Codable, Equatable, Sendable {
    public let relayUrl: String
    public let userId: String
    public let deviceId: String
    public let hostId: String
    public let hostName: String
    public let role: String

    public init(
        relayUrl: String,
        userId: String,
        deviceId: String,
        hostId: String,
        hostName: String,
        role: String
    ) {
        self.relayUrl = relayUrl
        self.userId = userId
        self.deviceId = deviceId
        self.hostId = hostId
        self.hostName = hostName
        self.role = role
    }
}

public struct CodexLinkDeviceRevocationResult: Codable, Equatable, Sendable {
    public let relayUrl: String
    public let userId: String
    public let deviceId: String
    public let revokedAt: String

    public init(
        relayUrl: String,
        userId: String,
        deviceId: String,
        revokedAt: String
    ) {
        self.relayUrl = relayUrl
        self.userId = userId
        self.deviceId = deviceId
        self.revokedAt = revokedAt
    }
}

public enum CodexLinkDeviceSessionClientError: Error, Equatable, Sendable {
    case invalidRelayURL
    case invalidHTTPStatus(Int)
}

public protocol CodexLinkDeviceSessionRegistering: Sendable {
    func registerPlaceholderDevice(
        displayName: String,
        deviceName: String
    ) async throws -> CodexLinkDeviceSession
}

public protocol CodexLinkDeviceSessionPairing: Sendable {
    func pairHost(
        pairingCode: String,
        userId: String,
        deviceId: String
    ) async throws -> CodexLinkDevicePairingResult
}

public protocol CodexLinkDeviceSessionRevoking: Sendable {
    func revokeDevice(
        userId: String,
        deviceId: String
    ) async throws -> CodexLinkDeviceRevocationResult
}

public typealias CodexLinkDeviceSessionManaging =
    CodexLinkDeviceSessionRegistering & CodexLinkDeviceSessionPairing & CodexLinkDeviceSessionRevoking

public protocol CodexLinkDeviceSessionStoring: Sendable {
    func loadDeviceSession() throws -> CodexLinkDeviceSession?
    func saveDeviceSession(_ deviceSession: CodexLinkDeviceSession) throws
    func clearDeviceSession() throws
}

public enum CodexLinkDeviceSessionStoreError: Error, Equatable, Sendable {
    case unreadableData
}

public final class CodexLinkUserDefaultsDeviceSessionStore: CodexLinkDeviceSessionStoring, @unchecked Sendable {
    private let defaults: UserDefaults
    private let key: String
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(
        defaults: UserDefaults = .standard,
        key: String = "codex-link.device-session",
        encoder: JSONEncoder = JSONEncoder(),
        decoder: JSONDecoder = JSONDecoder()
    ) {
        self.defaults = defaults
        self.key = key
        self.encoder = encoder
        self.decoder = decoder
    }

    public func loadDeviceSession() throws -> CodexLinkDeviceSession? {
        guard let data = defaults.data(forKey: key) else {
            return nil
        }
        do {
            return try decoder.decode(CodexLinkDeviceSession.self, from: data)
        } catch {
            throw CodexLinkDeviceSessionStoreError.unreadableData
        }
    }

    public func saveDeviceSession(_ deviceSession: CodexLinkDeviceSession) throws {
        let data = try encoder.encode(deviceSession)
        defaults.set(data, forKey: key)
    }

    public func clearDeviceSession() throws {
        defaults.removeObject(forKey: key)
    }
}

public final class CodexLinkDeviceSessionClient: @unchecked Sendable {
    private let relayURL: URL
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(
        relayURL: URL,
        session: URLSession = .shared,
        encoder: JSONEncoder = JSONEncoder(),
        decoder: JSONDecoder = JSONDecoder()
    ) {
        self.relayURL = relayURL
        self.session = session
        self.encoder = encoder
        self.decoder = decoder
    }

    public func registerPlaceholderDevice(
        displayName: String,
        deviceName: String
    ) async throws -> CodexLinkDeviceSession {
        let requestBody = CodexLinkDeviceSessionRequest(
            displayName: displayName,
            deviceName: deviceName
        )
        var request = URLRequest(url: try deviceSessionURL())
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try encoder.encode(requestBody)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw CodexLinkDeviceSessionClientError.invalidHTTPStatus(-1)
        }
        guard http.statusCode == 201 else {
            throw CodexLinkDeviceSessionClientError.invalidHTTPStatus(http.statusCode)
        }
        return try decoder.decode(CodexLinkDeviceSession.self, from: data)
    }

    public func pairHost(
        pairingCode: String,
        userId: String,
        deviceId: String
    ) async throws -> CodexLinkDevicePairingResult {
        let requestBody = CodexLinkDevicePairingRequest(
            userId: userId,
            deviceId: deviceId,
            pairingCode: pairingCode
        )
        var request = URLRequest(url: try devicePairingURL())
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try encoder.encode(requestBody)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw CodexLinkDeviceSessionClientError.invalidHTTPStatus(-1)
        }
        guard http.statusCode == 201 else {
            throw CodexLinkDeviceSessionClientError.invalidHTTPStatus(http.statusCode)
        }
        return try decoder.decode(CodexLinkDevicePairingResult.self, from: data)
    }

    public func revokeDevice(
        userId: String,
        deviceId: String
    ) async throws -> CodexLinkDeviceRevocationResult {
        let requestBody = CodexLinkDeviceRevocationRequest(
            userId: userId,
            deviceId: deviceId
        )
        var request = URLRequest(url: try deviceRevocationURL())
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try encoder.encode(requestBody)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw CodexLinkDeviceSessionClientError.invalidHTTPStatus(-1)
        }
        guard http.statusCode == 200 else {
            throw CodexLinkDeviceSessionClientError.invalidHTTPStatus(http.statusCode)
        }
        return try decoder.decode(CodexLinkDeviceRevocationResult.self, from: data)
    }

    private func deviceSessionURL() throws -> URL {
        try apiURL(path: "/api/device-session")
    }

    private func devicePairingURL() throws -> URL {
        try apiURL(path: "/api/device-session/pair")
    }

    private func deviceRevocationURL() throws -> URL {
        try apiURL(path: "/api/device-session/revoke")
    }

    private func apiURL(path: String) throws -> URL {
        guard var components = URLComponents(url: relayURL, resolvingAgainstBaseURL: false) else {
            throw CodexLinkDeviceSessionClientError.invalidRelayURL
        }
        switch components.scheme {
        case "http", "https":
            break
        case "ws":
            components.scheme = "http"
        case "wss":
            components.scheme = "https"
        default:
            throw CodexLinkDeviceSessionClientError.invalidRelayURL
        }
        components.path = path
        components.queryItems = nil
        guard let url = components.url else {
            throw CodexLinkDeviceSessionClientError.invalidRelayURL
        }
        return url
    }
}

extension CodexLinkDeviceSessionClient: CodexLinkDeviceSessionRegistering {}
extension CodexLinkDeviceSessionClient: CodexLinkDeviceSessionPairing {}
extension CodexLinkDeviceSessionClient: CodexLinkDeviceSessionRevoking {}
