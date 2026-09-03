// FilePreview.tsx — renderers for file types beyond images/PDFs: plain
// text/code, Word documents, and Excel spreadsheets. Each fetches the raw
// bytes from the backend's /files/preview endpoint (already permissioned
// and size-capped there) and renders client-side.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n/context";

const SHARED_BOX_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  overflow: "auto",
  borderRadius: "var(--radius)",
  background: "var(--bg-base)",
};

function PreviewLoading() {
  const { t } = useTranslation();
  return (
    <div
      style={{
        ...SHARED_BOX_STYLE,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-tertiary)",
        fontSize: 12,
      }}
    >
      {t("filePreview.loadingPreview")}
    </div>
  );
}

function PreviewError({ label }: { label: string }) {
  return (
    <div
      style={{
        ...SHARED_BOX_STYLE,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: 1,
          color: "var(--text-tertiary)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "10px 18px",
        }}
      >
        {label}
      </span>
    </div>
  );
}

export function TextPreview({ url, extension }: { url: string; extension: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(false);
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.text();
      })
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) return <PreviewError label={(extension || "txt").replace(".", "").toUpperCase()} />;
  if (text === null) return <PreviewLoading />;

  return (
    <pre
      className="mono"
      style={{
        ...SHARED_BOX_STYLE,
        margin: 0,
        padding: 12,
        fontSize: 12,
        lineHeight: 1.5,
        color: "var(--text-primary)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {text}
    </pre>
  );
}

export function DocxPreview({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    setLoading(true);

    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const blob = await res.blob();
        // docx-preview renders directly into the DOM node it's given --
        // that's the library's own mechanism, not something we're doing
        // via dangerouslySetInnerHTML ourselves. Dynamically imported so
        // it's only pulled into the bundle when a .docx is actually
        // being previewed.
        const { renderAsync } = await import("docx-preview");
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = "";
        await renderAsync(blob, containerRef.current, undefined, {
          className: "docx-preview",
          inWrapper: false,
        });
        if (!cancelled) setLoading(false);
      } catch {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) return <PreviewError label="DOCX" />;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {loading && (
        <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
          <PreviewLoading />
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          ...SHARED_BOX_STYLE,
          padding: 12,
          background: "white",
          color: "#111",
          fontSize: 12,
        }}
      />
    </div>
  );
}

export function XlsxPreview({ url }: { url: string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(false);
    setTruncated(false);

    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const buf = await res.arrayBuffer();
        // Dynamically imported for the same bundle-size reason as
        // docx-preview above. Uses @e965/xlsx rather than the "xlsx"
        // package on npm: the npm registry's xlsx has an unpatched
        // high-severity prototype-pollution/ReDoS vulnerability (the
        // real fix was only ever published to SheetJS's own CDN, not
        // npm); @e965/xlsx mirrors SheetJS's actual patched releases
        // onto npm's registry instead.
        const XLSX = await import("@e965/xlsx");
        const workbook = XLSX.read(buf, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as unknown[][];
        if (cancelled) return;
        const kMaxRows = 200; // keep the preview snappy on large sheets
        setRows(data.slice(0, kMaxRows));
        setTruncated(data.length > kMaxRows);
      } catch {
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) return <PreviewError label="XLSX" />;
  if (rows === null) return <PreviewLoading />;

  return (
    <div
      style={{
        ...SHARED_BOX_STYLE,
        background: "white",
        padding: 8,
      }}
    >
      <table className="mono" style={{ borderCollapse: "collapse", fontSize: 12, color: "#111" }}>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  style={{
                    border: "1px solid #ddd",
                    padding: "3px 8px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {cell === null || cell === undefined ? "" : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && (
        <div style={{ padding: "6px 4px", fontSize: 12, color: "#666" }}>
          {t("filePreview.showingFirstRows")}
        </div>
      )}
    </div>
  );
}
