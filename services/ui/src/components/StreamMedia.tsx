import React, { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

type StreamMediaKind = "hls" | "video" | "audio";

interface StreamMediaProps {
  kind: StreamMediaKind;
  src: string;
  title: string;
  autoPlay?: boolean;
  muted?: boolean;
  controls?: boolean;
  poster?: string;
  style?: React.CSSProperties;
  showStatus?: boolean;
}

export function StreamMedia({
  kind,
  src,
  title,
  autoPlay = true,
  muted = true,
  controls = true,
  poster,
  style,
  showStatus = false,
}: StreamMediaProps) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const [status, setStatus] = useState<string>("connecting");

  useEffect(() => {
    const element = mediaRef.current;
    if (!element || !src) {
      return;
    }

    let hls: Hls | null = null;
    setStatus("connecting");

    const onLoaded = () => {
      setStatus("playing");
      if (autoPlay) {
        element.play().catch(() => undefined);
      }
    };
    const onWaiting = () => setStatus("buffering");
    const onError = () => setStatus("error");

    element.addEventListener("loadeddata", onLoaded);
    element.addEventListener("canplay", onLoaded);
    element.addEventListener("waiting", onWaiting);
    element.addEventListener("error", onError);

    if (kind === "hls") {
      if (element instanceof HTMLVideoElement && element.canPlayType("application/vnd.apple.mpegurl")) {
        element.src = src;
      } else if (Hls.isSupported() && element instanceof HTMLVideoElement) {
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 30,
        });
        hls.attachMedia(element);
        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          hls?.loadSource(src);
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
          setStatus(data.fatal ? "error" : "buffering");
          if (data.fatal) {
            hls?.destroy();
            hls = null;
          }
        });
      } else {
        setStatus("unsupported");
      }
    } else {
      element.src = src;
    }

    return () => {
      element.pause();
      element.removeEventListener("loadeddata", onLoaded);
      element.removeEventListener("canplay", onLoaded);
      element.removeEventListener("waiting", onWaiting);
      element.removeEventListener("error", onError);
      if (hls) {
        hls.destroy();
      }
      element.removeAttribute("src");
      element.load();
    };
  }, [autoPlay, kind, src]);

  if (kind === "audio") {
    return (
      <audio
        ref={mediaRef as React.RefObject<HTMLAudioElement>}
        title={title}
        muted={muted}
        controls={controls}
        autoPlay={autoPlay}
        preload="auto"
        style={style}
      />
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <video
        ref={mediaRef as React.RefObject<HTMLVideoElement>}
        title={title}
        muted={muted}
        controls={controls}
        autoPlay={autoPlay}
        playsInline
        preload="auto"
        poster={poster}
        crossOrigin="anonymous"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
          background: "#000",
          ...style,
        }}
      />
      {showStatus && (
        <div
          style={{
            position: "absolute",
            right: 8,
            bottom: 8,
            background: "rgba(0,0,0,0.7)",
            color: "#e5e7eb",
            fontSize: 11,
            borderRadius: 999,
            padding: "4px 8px",
            textTransform: "capitalize",
          }}
        >
          {status}
        </div>
      )}
    </div>
  );
}
