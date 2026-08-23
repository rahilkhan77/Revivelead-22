export const IMPORT_MAX_BYTES = 2_000_000;
export const IMPORT_ACCEPT = ".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const ALLOWED_EXTENSION = /\.(csv|xlsx|xls)$/i;

export function importFileExtension(name: string) {
  const match = name.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

export function importFileTypeLabel(name: string) {
  const ext = importFileExtension(name);
  if (ext === "csv") return "CSV";
  if (ext === "xlsx") return "XLSX";
  if (ext === "xls") return "XLS";
  return ext.toUpperCase() || "Unknown";
}

export function formatImportFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function validateImportFile(file: { name: string; size: number }) {
  const rawName = file.name.replace(/\\/g, "/");
  const filename = rawName.split("/").pop() ?? "";
  if (!filename || rawName.includes("..") || !ALLOWED_EXTENSION.test(filename)) {
    return { ok: false as const, error: "Use a CSV or Excel file (.csv or .xlsx)." };
  }
  if (file.size > IMPORT_MAX_BYTES) {
    return { ok: false as const, error: "File is too large. Keep it under 2MB." };
  }
  return { ok: true as const, filename };
}
