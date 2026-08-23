import { describe, expect, it } from "vitest";
import { IMPORT_MAX_BYTES, formatImportFileSize, importFileTypeLabel, validateImportFile } from "@/lib/import/file";

describe("Import file selection", () => {
  it("accepts CSV and Excel files under the backend size limit", () => {
    expect(validateImportFile({ name: "leads.csv", size: 1200 }).ok).toBe(true);
    expect(validateImportFile({ name: "pipeline.xlsx", size: IMPORT_MAX_BYTES }).ok).toBe(true);
    expect(validateImportFile({ name: "legacy.xls", size: 800 }).ok).toBe(true);
  });

  it("rejects unsupported types and oversized files with inline-safe messages", () => {
    expect(validateImportFile({ name: "photo.png", size: 100 })).toMatchObject({
      ok: false,
      error: "Use a CSV or Excel file (.csv or .xlsx).",
    });
    expect(validateImportFile({ name: "notes.txt", size: 100 }).ok).toBe(false);
    expect(validateImportFile({ name: "../secret.csv", size: 100 }).ok).toBe(false);
    expect(validateImportFile({ name: "huge.xlsx", size: IMPORT_MAX_BYTES + 1 })).toMatchObject({
      ok: false,
      error: "File is too large. Keep it under 2MB.",
    });
  });

  it("formats selected-file metadata without inventing import results", () => {
    expect(importFileTypeLabel("buyers.CSV")).toBe("CSV");
    expect(importFileTypeLabel("stock.xlsx")).toBe("XLSX");
    expect(formatImportFileSize(512)).toBe("512 B");
    expect(formatImportFileSize(2048)).toBe("2.0 KB");
    expect(formatImportFileSize(1_572_864)).toBe("1.5 MB");
  });
});
