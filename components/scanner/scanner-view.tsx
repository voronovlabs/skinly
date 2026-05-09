"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, Search } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { useDemoStore } from "@/lib/demo-store";
import { findProductByBarcode } from "@/lib/mock";
import { getProductByBarcodeAction } from "@/app/actions/products";
import { AnalyzingOverlay } from "./analyzing-overlay";

/**
 * ScannerView — реальный barcode-сканер.
 *
 * Engines (по убыванию приоритета):
 *   1) native — `BarcodeDetector` (Chromium, Android Chrome, Edge).
 *      Быстрее и легче, бандл не растёт.
 *   2) zxing  — lazy `import("@zxing/browser")` для iOS Safari / WebKit-
 *      браузеров, где BarcodeDetector отсутствует. Чанк подтягивается
 *      только когда нужен — в bundle web-страниц не попадает.
 *   3) manual — поле «введите штрихкод вручную» — всегда видно как fallback.
 *
 * После decode:
 *   getProductByBarcodeAction → router.push("/product/<barcode>") при found,
 *   иначе баннер «не найден».
 *
 * Cleanup на unmount / успешный найденный товар:
 *   - native: clearInterval + stop tracks
 *   - zxing:  controls.stop() (он же останавливает stream)
 */

const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;
const NATIVE_DETECT_INTERVAL_MS = 350;

type CameraState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "live"; engine: "native" | "zxing" }
  | { kind: "denied" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

type LookupState =
  | { kind: "idle" }
  | { kind: "processing"; barcode: string }
  | { kind: "not_found"; barcode: string }
  | { kind: "invalid" }
  | { kind: "error" };

export interface ScannerViewProps {
  /** Demo каталог — для кнопки «Симуляция скана». Опционально. */
  demoBarcodes?: string[];
}

export function ScannerView({ demoBarcodes = [] }: ScannerViewProps) {
  const router = useRouter();
  const t = useTranslations("scanner");
  const { addScan } = useDemoStore();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Экземпляр {@link IScannerControls} от ZXing — есть только в режиме zxing. */
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null);
  /** Lock против гонок detect-loop и manual-submit. */
  const lockRef = useRef(false);

  const [camera, setCamera] = useState<CameraState>({ kind: "idle" });
  const [lookup, setLookup] = useState<LookupState>({ kind: "idle" });
  const [manualValue, setManualValue] = useState("");

  /* ───────── cleanup (унифицированно для обоих движков) ───────── */

  const stopCamera = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (zxingControlsRef.current) {
      try {
        zxingControlsRef.current.stop();
      } catch {
        /* noop */
      }
      zxingControlsRef.current = null;
    }
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  /* ───────── lookup → redirect / banner ───────── */

  const handleBarcode = useCallback(
    async (raw: string) => {
      if (lockRef.current) return;
      lockRef.current = true;
      const barcode = raw.trim();
      setLookup({ kind: "processing", barcode });

      try {
        const result = await getProductByBarcodeAction(barcode);
        if (result.found) {
          stopCamera();
          addScan(result.productId);
          router.push(`/product/${result.barcode}`);
          return;
        }
        if (result.reason === "invalid") {
          setLookup({ kind: "invalid" });
        } else if (result.reason === "not_found") {
          // Phase 5 demo fallback
          const mock = findProductByBarcode(barcode);
          if (mock) {
            stopCamera();
            addScan(mock.id);
            router.push(`/product/${barcode}`);
            return;
          }
          setLookup({ kind: "not_found", barcode });
        } else {
          setLookup({ kind: "error" });
        }
      } catch (e) {
        console.error("[scanner] lookup failed:", e);
        setLookup({ kind: "error" });
      } finally {
        setTimeout(() => {
          lockRef.current = false;
        }, 800);
      }
    },
    [addScan, router, stopCamera],
  );

  /* ───────── engine setup ───────── */

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera({ kind: "unsupported" });
        return;
      }

      // Engine 1: native BarcodeDetector
      const BD =
        (typeof globalThis !== "undefined" &&
          (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
            .BarcodeDetector) ||
        null;

      if (BD) {
        await startNative(BD);
        return;
      }

      // Engine 2: ZXing fallback (iOS WebKit и пр.)
      await startZxing();
    }

    /* ── Native ── */
    async function startNative(BD: BarcodeDetectorCtor) {
      setCamera({ kind: "starting" });
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => undefined);
        }

        let detector: { detect: (s: HTMLVideoElement) => Promise<DetectedCode[]> };
        try {
          detector = new BD({ formats: NATIVE_FORMATS as unknown as string[] });
        } catch {
          detector = new BD();
        }

        setCamera({ kind: "live", engine: "native" });

        intervalRef.current = setInterval(async () => {
          const video = videoRef.current;
          if (!video || video.readyState < 2 || lockRef.current) return;
          try {
            const results = await detector.detect(video);
            if (results && results.length > 0) {
              const code = results[0]?.rawValue;
              if (code) await handleBarcode(code);
            }
          } catch {
            /* транзиентные ошибки detect() */
          }
        }, NATIVE_DETECT_INTERVAL_MS);
      } catch (e) {
        handleCameraError(e);
      }
    }

    /* ── ZXing ── */
    async function startZxing() {
      setCamera({ kind: "starting" });
      try {
        // Lazy: чанк ZXing подтянется только если до сюда дошли.
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;

        const video = videoRef.current;
        if (!video) {
          setCamera({ kind: "error", message: "no video element" });
          return;
        }

        const reader = new BrowserMultiFormatReader();

        const controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          },
          video,
          (result) => {
            if (!result || lockRef.current) return;
            const text = result.getText();
            if (text) void handleBarcode(text);
          },
        );

        if (cancelled) {
          controls.stop();
          return;
        }

        zxingControlsRef.current = controls;
        // ZXing присвоил поток сам — заберём ref на cleanup parity.
        const attached = video.srcObject as MediaStream | null;
        if (attached) streamRef.current = attached;

        setCamera({ kind: "live", engine: "zxing" });
      } catch (e) {
        // Может быть: NotAllowedError (permission denied), failed import,
        // unsupported by ZXing (очень старый браузер).
        handleCameraError(e);
      }
    }

    function handleCameraError(e: unknown) {
      const err = e as { name?: string; message?: string };
      if (
        err?.name === "NotAllowedError" ||
        err?.name === "PermissionDeniedError"
      ) {
        setCamera({ kind: "denied" });
      } else if (err?.name === "NotFoundError") {
        setCamera({ kind: "error", message: "no camera" });
      } else {
        setCamera({ kind: "error", message: err?.message ?? "unknown" });
      }
    }

    void start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [handleBarcode, stopCamera]);

  /* ───────── manual input ───────── */

  const handleManualSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (lookup.kind === "processing") return;
    void handleBarcode(manualValue);
  };

  /* ───────── demo simulate ───────── */

  const handleSimulate = () => {
    if (demoBarcodes.length === 0) return;
    const next =
      demoBarcodes[Math.floor(Math.random() * demoBarcodes.length)];
    void handleBarcode(next);
  };

  const dismissLookupBanner = () => setLookup({ kind: "idle" });

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Camera surface */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 h-full w-full object-cover"
        aria-hidden
      />
      {/* Camera fallback bg + dimmer */}
      <div
        className="absolute inset-0 bg-gradient-to-br from-[#1a1a2e] to-[#16213e]"
        aria-hidden
        style={{
          opacity: camera.kind === "live" ? 0 : 1,
          transition: "opacity 0.3s",
        }}
      />
      <div className="absolute inset-0 bg-black/50" aria-hidden />

      {/* Top bar */}
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-6 text-pure-white">
        <button
          type="button"
          onClick={() => {
            stopCamera();
            router.back();
          }}
          aria-label={t("back")}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-pure-white backdrop-blur-md"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2} />
        </button>
        <span className="text-h3 text-pure-white">{t("title")}</span>
        <span aria-hidden className="h-10 w-10" />
      </header>

      {/* Frame с уголками — показываем когда камера живая */}
      {camera.kind === "live" && (
        <div
          className="absolute left-1/2 top-1/2 h-[180px] w-[280px] -translate-x-1/2 -translate-y-[60%] rounded-xl"
          aria-hidden
        >
          <Corner pos="tl" />
          <Corner pos="tr" />
          <Corner pos="bl" />
          <Corner pos="br" />
          <div className="absolute left-0 top-0 h-[2px] w-full bg-pure-white/80 shadow-[0_0_4px_rgba(255,255,255,0.8)] animate-scanner-laser" />
        </div>
      )}

      {/* Camera status banner */}
      {camera.kind !== "live" && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[180px] z-10 max-w-[320px] px-6 text-center">
          {camera.kind === "starting" && (
            <p className="text-body-sm text-pure-white/90">{t("starting")}</p>
          )}
          {camera.kind === "denied" && (
            <>
              <p className="text-h3 text-pure-white">{t("permissionDenied")}</p>
              <p className="text-body-sm text-pure-white/80 mt-1">
                {t("permissionDeniedHint")}
              </p>
            </>
          )}
          {camera.kind === "unsupported" && (
            <>
              <p className="text-h3 text-pure-white">{t("unsupported")}</p>
              <p className="text-body-sm text-pure-white/80 mt-1">
                {t("unsupportedHint")}
              </p>
            </>
          )}
          {camera.kind === "error" && (
            <>
              <p className="text-h3 text-pure-white">{t("lookupError")}</p>
              <p className="text-body-sm text-pure-white/60 mt-1 font-mono">
                {camera.message}
              </p>
            </>
          )}
        </div>
      )}

      {/* Lookup result banner */}
      {(lookup.kind === "not_found" ||
        lookup.kind === "invalid" ||
        lookup.kind === "error") && (
        <div className="absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2 z-20 max-w-[320px] rounded-xl bg-pure-white/95 px-5 py-4 text-center shadow-soft-lg backdrop-blur">
          <p className="text-body text-graphite">
            {lookup.kind === "not_found" && t("notFound")}
            {lookup.kind === "invalid" && t("invalidBarcode")}
            {lookup.kind === "error" && t("lookupError")}
          </p>
          {lookup.kind === "not_found" && (
            <p className="text-caption text-muted-graphite font-mono mt-1">
              {lookup.barcode}
            </p>
          )}
          <button
            type="button"
            onClick={dismissLookupBanner}
            className="mt-3 text-body-sm font-medium text-lavender-deep hover:underline"
          >
            {t("tryAgain")}
          </button>
        </div>
      )}

      {/* Bottom panel: hint + manual input + simulate */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-3 bg-gradient-to-t from-black/80 to-transparent px-6 pb-8 pt-12">
        {camera.kind === "live" && (
          <p className="text-body-sm text-pure-white/90 text-center">
            {t("alignBarcode")}
          </p>
        )}

        <form onSubmit={handleManualSubmit} className="flex w-full gap-2">
          <Input
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
            inputMode="numeric"
            pattern="\d{8,14}"
            maxLength={14}
            placeholder={t("manualPlaceholder")}
            aria-label={t("manualLabel")}
            disabled={lookup.kind === "processing"}
            className="!bg-pure-white/95 !text-graphite"
          />
          <Button
            type="submit"
            variant="primary"
            fullWidth={false}
            disabled={lookup.kind === "processing" || !manualValue.trim()}
            aria-label={t("findButton")}
            className="flex-shrink-0 !w-12 !p-0"
          >
            <Search className="h-5 w-5" strokeWidth={2} />
          </Button>
        </form>

        {demoBarcodes.length > 0 &&
          (camera.kind === "denied" ||
            camera.kind === "unsupported" ||
            camera.kind === "error") && (
            <Button
              variant="secondary"
              fullWidth={false}
              onClick={handleSimulate}
              disabled={lookup.kind === "processing"}
              className="bg-white/15 text-pure-white border-white/30 backdrop-blur-md hover:bg-white/25"
            >
              {t("simulateScan")}
            </Button>
          )}
      </div>

      <AnalyzingOverlay visible={lookup.kind === "processing"} />
    </div>
  );
}

/* ───────── tiny types for native BarcodeDetector ───────── */

interface DetectedCode {
  rawValue: string;
  format?: string;
}

interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): {
    detect: (source: HTMLVideoElement) => Promise<DetectedCode[]>;
  };
}

/* ───────── corner UI ───────── */

function Corner({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const base = "absolute h-6 w-6 border-2 border-pure-white";
  const variants: Record<typeof pos, string> = {
    tl: "left-[-2px] top-[-2px] border-r-0 border-b-0",
    tr: "right-[-2px] top-[-2px] border-l-0 border-b-0",
    bl: "left-[-2px] bottom-[-2px] border-r-0 border-t-0",
    br: "right-[-2px] bottom-[-2px] border-l-0 border-t-0",
  };
  return <div className={`${base} ${variants[pos]}`} />;
}
