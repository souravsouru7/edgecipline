"use client";

import { getTradesPage } from "@/services/tradeApi";
import { tradesToCsv } from "./tradesCsv.mjs";

// "Download my trades": every trade in a market as a CSV that opens cleanly in
// Excel, Google Sheets and Numbers. Used from Settings, and promised by the
// public account-deletion page ("export anything you want to keep").

const MAX_PAGES = 500; // a safety stop, far above any real journal

export { csvCell, tradesToCsv } from "./tradesCsv.mjs";

/** Every trade in a market, oldest pages included. onProgress(count). */
export async function fetchAllTrades(market, { onProgress, signal } = {}) {
  const limit = market === "Indian_Market" ? 200 : 100;
  const all = [];
  let after = null;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const page = await getTradesPage(market, { period: "all", after, limit, signal, forExport: true });
    all.push(...(page.items || []));
    onProgress?.(all.length);
    if (!page.pagination?.hasNextPage || !page.pagination?.next) break;
    after = page.pagination.next;
  }
  return all.filter((t) => !t.deletedAt);
}

function isNativeApp() {
  return typeof window !== "undefined" && Boolean(window.Capacitor?.isNativePlatform?.());
}

/** Hands the file to the user: a download on the web, the share sheet in the app. */
export async function saveCsv(csv, filename) {
  if (isNativeApp()) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/share"),
    ]);
    // cache/images/ is the folder Android's FileProvider exposes
    // (res/xml/file_paths.xml), so the share target can read it.
    const written = await Filesystem.writeFile({
      path: `images/${filename}`,
      data: csv,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    await Share.share({ title: filename, files: [written.uri], dialogTitle: "Save or send your trades" });
    return;
  }
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportFilename(market) {
  const day = new Date().toISOString().slice(0, 10);
  return `edgecipline-${market === "Indian_Market" ? "indian" : "forex"}-trades-${day}.csv`;
}
