#if os(iOS)
import AudioToolbox
import AVFoundation
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
    private let captureSession = AVCaptureSession()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private let onPairingPayload: (CodexLinkPairingPayload) -> Void
    private let onError: (CodexLinkPairingScannerError) -> Void
    private let onCancel: () -> Void
    private var didReportPayload = false

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
        configureSession()
    }

    public override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.layer.bounds
    }

    public override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        if !captureSession.isRunning {
            DispatchQueue.global(qos: .userInitiated).async { [captureSession] in
                captureSession.startRunning()
            }
        }
    }

    public override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if captureSession.isRunning {
            captureSession.stopRunning()
        }
    }

    @objc private func cancelTapped() {
        onCancel()
    }

    private func configureSession() {
        guard let device = AVCaptureDevice.default(for: .video) else {
            onError(.cameraUnavailable)
            return
        }
        do {
            let input = try AVCaptureDeviceInput(device: device)
            guard captureSession.canAddInput(input) else {
                onError(.sessionConfigurationFailed)
                return
            }
            captureSession.addInput(input)
            let metadataOutput = AVCaptureMetadataOutput()
            guard captureSession.canAddOutput(metadataOutput) else {
                onError(.sessionConfigurationFailed)
                return
            }
            captureSession.addOutput(metadataOutput)
            metadataOutput.setMetadataObjectsDelegate(self, queue: .main)
            guard metadataOutput.availableMetadataObjectTypes.contains(.qr) else {
                onError(.sessionConfigurationFailed)
                return
            }
            metadataOutput.metadataObjectTypes = [.qr]
        } catch {
            onError(.sessionConfigurationFailed)
            return
        }
        let preview = AVCaptureVideoPreviewLayer(session: captureSession)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.layer.bounds
        view.layer.insertSublayer(preview, at: 0)
        previewLayer = preview
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
