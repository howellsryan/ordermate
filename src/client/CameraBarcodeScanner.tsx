import { useEffect, useRef, useState } from "react";
import { Camera, ScanBarcode } from "lucide-react";
import { Modal } from "./ui";

type ScannerControls = { stop: () => void };
type BrowserReaderModule = typeof import("@zxing/browser");

export default function CameraBarcodeScanner({ onScan, label = "Use camera" }: { onScan: (barcode: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<ScannerControls | null>(null);
  const moduleRef = useRef<BrowserReaderModule | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let consumed = false;
    setError(null);
    setStarting(true);

    const stop = () => {
      try { controlsRef.current?.stop(); } catch { /* scanner cleanup is best effort */ }
      controlsRef.current = null;
      try { moduleRef.current?.BrowserCodeReader.releaseAllStreams(); } catch { /* tracks may already be stopped */ }
      const stream = videoRef.current?.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Camera scanning is not supported by this browser. Use a Bluetooth/USB scanner or enter the barcode manually.");
        setStarting(false);
        return;
      }

      try {
        const scannerModule = await import("@zxing/browser");
        if (cancelled) return;
        moduleRef.current = scannerModule;
        const reader = new scannerModule.BrowserMultiFormatReader(undefined, {
          delayBetweenScanAttempts: 200,
          delayBetweenScanSuccess: 750,
          tryPlayVideoTimeout: 6_000,
        });
        const controls = await reader.decodeFromConstraints({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        }, videoRef.current || undefined, (result, _decodeError, callbackControls) => {
          if (!result || consumed || cancelled) return;
          const barcode = result.getText().trim();
          if (!barcode) return;
          consumed = true;
          try { callbackControls.stop(); } catch { /* cleanup below also stops all streams */ }
          stop();
          onScan(barcode);
          setOpen(false);
        });
        if (cancelled) {
          controls.stop();
          scannerModule.BrowserCodeReader.releaseAllStreams();
          return;
        }
        controlsRef.current = controls;
        setStarting(false);
      } catch (cause) {
        stop();
        setStarting(false);
        const name = cause instanceof DOMException ? cause.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setError("Camera permission was blocked. Allow camera access for OrderMate, or use a Bluetooth/USB scanner or manual entry.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setError("No usable camera was found on this device.");
        } else {
          setError(cause instanceof Error ? cause.message : "The camera scanner could not start.");
        }
      }
    };

    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, onScan]);

  return <>
    <button type="button" className="secondary camera-scan-button" onClick={() => setOpen(true)}><Camera size={15} /> {label}</button>
    {open && <Modal title="Scan one barcode" subtitle="Point the rear camera at the product barcode. OrderMate closes the camera after one successful read so a stationary label cannot be counted repeatedly." onClose={() => setOpen(false)}>
      <div className="camera-scanner">
        <div className="camera-preview">
          <video ref={videoRef} muted playsInline aria-label="Live camera barcode preview" />
          <span className="camera-target" aria-hidden="true"><ScanBarcode size={28} /></span>
          {starting && <span className="camera-loading"><span className="loader" /> Starting camera…</span>}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="camera-help"><strong>Supported workflow</strong><span>EAN/UPC, Code 128/39 and common 2D codes are decoded locally in your browser. The image is not uploaded to OrderMate or Cloudflare.</span></div>
        <div className="modal-actions"><button type="button" className="secondary" onClick={() => setOpen(false)}>Close camera</button></div>
      </div>
    </Modal>}
  </>;
}
