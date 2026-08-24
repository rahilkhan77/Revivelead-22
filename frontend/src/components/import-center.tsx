"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { confirmImportAction, previewImportAction } from "@/actions/import";
import { ImportFileDropzone } from "@/components/import-file-dropzone";
import { Button } from "@/components/ui/button";
import { CANONICAL_FIELDS, type ColumnMapping } from "@/lib/import/mapping";
import type { ImportRow } from "@/lib/import/parse";
import { toast } from "sonner";

type ImportSummary = {
  imported: number;
  updated: number;
  duplicates: number;
  failed: number;
  errors: string[];
};

const REQUIRED_FIELDS: (keyof ColumnMapping)[] = ["name"];

export function ImportCenter() {
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [filename, setFilename] = useState("upload.csv");
  const [mode, setMode] = useState<"skip" | "update" | "create">("skip");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);

  const valid = useMemo(() => rows.filter((row) => row.valid).length, [rows]);
  const invalid = rows.length - valid;
  const mappedCount = useMemo(
    () => CANONICAL_FIELDS.filter((field) => mapping[field]).length,
    [mapping],
  );
  const missingRequired = REQUIRED_FIELDS.filter((field) => !mapping[field]);
  const previewRows = useMemo(() => rows.slice(0, 8), [rows]);

  function resetPreview() {
    setHeaders([]);
    setMapping({});
    setRows([]);
    setFilename("upload.csv");
    setResult(null);
  }

  async function handlePreview() {
    if (!file) {
      setFileError("Choose a CSV or Excel file first.");
      return;
    }
    setPreviewing(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await previewImportAction(formData);
      if (!response.ok) {
        toast.error(response.error);
        return;
      }
      setFilename(response.data?.filename ?? file.name);
      setHeaders(response.data?.headers ?? []);
      setMapping(response.data?.mapping ?? {});
      setRows(response.data?.rows ?? []);
      const detected = response.data?.rows?.length ?? 0;
      toast.success(`Parsed ${detected} row${detected === 1 ? "" : "s"} from ${response.data?.filename ?? file.name}`);
    } catch {
      toast.error("Could not read that file. Try re-exporting it as CSV.");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleConfirm() {
    if (missingRequired.length > 0) {
      toast.error(`Map a column to "${missingRequired.join(", ")}" before importing.`);
      return;
    }
    if (valid === 0) {
      toast.error("No valid rows to import. Fix the mapping or the file.");
      return;
    }
    setImporting(true);
    try {
      const response = await confirmImportAction({ filename, mapping, rows, mode });
      if (!response.ok || !response.data) {
        toast.error(response.error ?? "Import failed.");
        return;
      }
      setResult(response.data);
      toast.success(
        `Imported ${response.data.imported}, updated ${response.data.updated}, skipped ${response.data.duplicates}`,
      );
    } catch {
      toast.error("Import failed. No partial data was left behind for failed rows.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-border p-4">
        <ImportFileDropzone
          error={fileError}
          onError={setFileError}
          onFileChange={(next) => {
            setFile(next);
            if (!next) resetPreview();
          }}
        />
        <Button type="button" onClick={handlePreview} disabled={previewing || !file}>
          {previewing ? "Analyzing…" : "Preview and auto-map"}
        </Button>
      </div>

      {headers.length > 0 ? (
        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              <span className="font-medium">{filename}</span> · {rows.length} rows · {valid} valid · {invalid} invalid
            </p>
            <p className="text-muted-foreground text-xs">
              Auto-mapped {mappedCount} of {CANONICAL_FIELDS.length} fields
            </p>
          </div>

          {missingRequired.length > 0 ? (
            <p className="text-destructive text-sm" role="alert">
              Map a column to <span className="font-medium">{missingRequired.join(", ")}</span> to continue. Name is required.
            </p>
          ) : null}

          <div className="grid gap-2 md:grid-cols-2">
            {CANONICAL_FIELDS.map((field) => {
              const isRequired = REQUIRED_FIELDS.includes(field);
              const unmapped = isRequired && !mapping[field];
              return (
                <label key={field} className="text-sm">
                  <span className="mb-1 block text-muted-foreground">
                    {field}
                    {isRequired ? <span className="text-destructive"> *</span> : null}
                  </span>
                  <select
                    className={`bg-background h-8 w-full rounded-lg border px-2 ${unmapped ? "border-destructive" : "border-input"}`}
                    value={mapping[field] ?? ""}
                    onChange={(event) =>
                      setMapping((current) => ({ ...current, [field]: event.target.value || undefined }))
                    }
                  >
                    <option value="">Ignore</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Line</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Phone</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr key={row.line} className="border-t border-border">
                    <td className="px-3 py-2 text-muted-foreground">{row.line}</td>
                    <td className="px-3 py-2">{row.name}</td>
                    <td className="px-3 py-2">{row.phone ?? "—"}</td>
                    <td className="px-3 py-2">{row.email ?? "—"}</td>
                    <td className="px-3 py-2">
                      {row.valid ? (
                        <span className="text-emerald-600 dark:text-emerald-400">Valid</span>
                      ) : (
                        <span className="text-destructive">{row.error ?? "Invalid"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > previewRows.length ? (
              <p className="text-muted-foreground border-t border-border px-3 py-2 text-xs">
                Showing first {previewRows.length} of {rows.length} rows.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="text-muted-foreground text-sm">
              Duplicates:
              <select
                className="border-input bg-background ml-2 h-8 rounded-lg border px-2 text-sm"
                value={mode}
                onChange={(event) => setMode(event.target.value as typeof mode)}
              >
                <option value="skip">Skip duplicates</option>
                <option value="update">Update existing</option>
                <option value="create">Create new anyway</option>
              </select>
            </label>
            <Button disabled={importing || missingRequired.length > 0 || valid === 0} onClick={handleConfirm}>
              {importing ? "Importing…" : `Confirm import (${valid})`}
            </Button>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <p className="font-medium">Import complete</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Imported" value={result.imported} tone="good" />
            <Stat label="Updated" value={result.updated} />
            <Stat label="Skipped" value={result.duplicates} />
            <Stat label="Failed" value={result.failed} tone={result.failed > 0 ? "bad" : undefined} />
          </div>
          {result.errors.length > 0 ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-destructive mb-1 text-sm font-medium">
                {result.errors.length} row{result.errors.length === 1 ? "" : "s"} could not be imported
              </p>
              <ul className="text-muted-foreground space-y-1 text-xs">
                {result.errors.slice(0, 10).map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
                {result.errors.length > 10 ? <li>…and {result.errors.length - 10} more</li> : null}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { setFile(null); setFileError(null); resetPreview(); }}>
              Import another file
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/leads">View leads</Link>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  const color =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "bad"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`text-lg font-semibold ${color}`}>{value}</p>
    </div>
  );
}
