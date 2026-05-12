#if os(iOS)
import AudioToolbox
@preconcurrency import AVFoundation
import SwiftUI
import UIKit

@available(iOS 17.0, *)
public struct CodexLinkPairingScannerView: UIViewControllerRepresentable {
    public let onPairingPayload: (CodexLinkPairingPayload) -> Void
    public let onError: (CodexLinkPairingScannerError) -> Void
    public let onCancel: () -> Void

    public init(
        onPairingPayload: @escaping (CodexLinkPairingPayload) -> Void,
        onError: @escaping (CodexLinkPairingScannerError) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.onPairingPayload = onPairingPayload
        self.onError = onError
        self.onCancel = onCancel
    }

    public func makeUIViewController(context: Context) -> CodexLinkPairingScannerViewController {
        CodexLinkPairingScannerViewController(
            onPairingPayload: onPairingPayload,
            onError: onError,
            onCancel: onCancel
        )
    }

    public func updateUIViewController(
        _ controller: CodexLinkPairingScannerViewController,
        context: Context
    ) {}
}

public enum CodexLinkPairingScannerError: Error, LocalizedError, Sendable {
    case cameraUnavailable
    case sessionConfigurationFailed
    case unsupportedQRPayload(String)

    public var errorDescription: String? {
        switch self {
        case .cameraUnavailable:
            return "iPhone camera is not available."
        case .sessionConfigurationFailed:
            return "Could not configure the camera for QR scanning."
        case .unsupportedQRPayload(let value):
            return "Scanned QR code is not a Codex Link pairing payload: \(value)"
        }
    }
}

@available(iOS 17.0, *)
@MainActor
public final class CodexLinkPairingScannerViewController: UIViewController, @preconcurrency AVCaptureMetadataOutputObjectsDelegate {
    private static let sharedCaptureSession = AVCaptureSession()
    private static let sessionQueue = DispatchQueue(label: "dev.codexlink.qr-scanner.session")

    private var previewLayer: AVCaptureVideoPreviewLayer?
    private let onPairingPayload: (CodexLinkPairingPayload) -> Void
    private let onError: (CodexLinkPairingScannerError) -> Void
    private let onCancel: () -> Void
    private var didReportPayload = false
    private var sessionConfigured = false

    private var captureSession: AVCaptureSession { Self.sharedCaptureSession }

    public init(
        onPairingPayload: @escaping (CodexLinkPairingPayload) -> Void,
        onError: @escaping (CodexLinkPairingScannerError) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.onPairingPayload = onPairingPayload
        self.onError = onError
        self.onCancel = onCancel
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    public override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let cancel = UIButton(type: .system)
        cancel.setTitle("Cancel", for: .normal)
        cancel.setTitleColor(.white, for: .normal)
        cancel.translatesAutoresizingMaskIntoConstraints = false
        cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        view.addSubview(cancel)
        NSLayoutConstraint.activate([
            cancel.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            cancel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
        ])
        ensureCameraAuthorization()
    }

    public override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.layer.bounds
    }

    public override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        startSessionIfReady()
    }

    private func ensureCameraAuthorization() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureSession()
            startSessionIfReady()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if granted {
                        self.configureSession()
                        self.startSessionIfReady()
                    } else {
                        self.reportError(.cameraUnavailable)
                    }
                }
            }
        case .denied, .restricted:
            reportError(.cameraUnavailable)
        @unknown default:
            reportError(.cameraUnavailable)
        }
    }

    private func startSessionIfReady() {
        guard sessionConfigured else { return }
        Self.sessionQueue.async { [captureSession] in
            if !captureSession.isRunning {
                captureSession.startRunning()
            }
        }
    }

    private func reportError(_ error: CodexLinkPairingScannerError) {
        DispatchQueue.main.async { [weak self] in
            self?.onError(error)
        }
    }

    public override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        Self.sessionQueue.async { [captureSession] in
            if captureSession.isRunning {
                captureSession.stopRunning()
            }
            captureSession.inputs.forEach { captureSession.removeInput($0) }
            captureSession.outputs.forEach { captureSession.removeOutput($0) }
        }
    }

    @objc private func cancelTapped() {
        onCancel()
    }

    private func configureSession() {
        guard !sessionConfigured else { return }
        guard let device = AVCaptureDevice.default(for: .video) else {
            reportError(.cameraUnavailable)
            return
        }
        Self.sessionQueue.async { [weak self, captureSession] in
            captureSession.beginConfiguration()
            defer { captureSession.commitConfiguration() }
            captureSession.inputs.forEach { captureSession.removeInput($0) }
            captureSession.outputs.forEach { captureSession.removeOutput($0) }
            do {
                let input = try AVCaptureDeviceInput(device: device)
                guard captureSession.canAddInput(input) else {
                    self?.reportError(.sessionConfigurationFailed)
                    return
                }
                captureSession.addInput(input)
                let metadataOutput = AVCaptureMetadataOutput()
                guard captureSession.canAddOutput(metadataOutput) else {
                    self?.reportError(.sessionConfigurationFailed)
                    return
                }
                captureSession.addOutput(metadataOutput)
                guard let strongSelf = self else { return }
                metadataOutput.setMetadataObjectsDelegate(strongSelf, queue: .main)
                guard metadataOutput.availableMetadataObjectTypes.contains(.qr) else {
                    strongSelf.reportError(.sessionConfigurationFailed)
                    return
                }
                metadataOutput.metadataObjectTypes = [.qr]
            } catch {
                self?.reportError(.sessionConfigurationFailed)
                return
            }
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                let preview = AVCaptureVideoPreviewLayer(session: self.captureSession)
                preview.videoGravity = .resizeAspectFill
                preview.frame = self.view.layer.bounds
                self.view.layer.insertSublayer(preview, at: 0)
                self.previewLayer = preview
                self.sessionConfigured = true
                self.startSessionIfReady()
            }
        }
    }

    public func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard !didReportPayload else { return }
        for object in metadataObjects {
            guard let readable = object as? AVMetadataMachineReadableCodeObject,
                  readable.type == .qr,
                  let raw = readable.stringValue,
                  let url = URL(string: raw)
            else { continue }
            if let payload = CodexLinkDeepLink.pairing(from: url) {
                didReportPayload = true
                AudioServicesPlaySystemSound(SystemSoundID(1057))
                onPairingPayload(payload)
                return
            } else {
                didReportPayload = true
                onError(.unsupportedQRPayload(raw))
                return
            }
        }
    }
}

#endif
