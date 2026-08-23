"use client";

import { useState } from "react";
import { confirmImportAction, previewImportAction } from "@/actions/import";
import { ImportFileDropzone } from "@/components/import-file-dropzone";
import { Button } from "@/components/ui/button";
import { CANONICAL_FIELDS, type ColumnMapping } from "@/lib/import/mapping";
import type { ImportRow } from "@/lib/import/parse";
import { toast } from "sonner";

export function ImportCenter() {
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [filename, setFilename] = useState("upload.csv");
  const [mode, setMode] = useState<"skip" | "update" | "create">("skip");
  const [pending, setPending] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [hasFile, setHasFile] = useState(false);

  const valid = rows.filter((row) => row.valid).length;
  const invalid = rows.length - valid;

  function resetPreview() {
    setHeaders([]);
    setMapping({});
    setRows([]);
    setFilename("upload.csv");
  }

  return (
    <div className="space-y-4">
      <form
        className="space-y-3 rounded-lg border border-border p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!hasFile) {
            setFileError("Choose a CSV or Excel file first.");
            return;
          }
          const result = await previewImportAction(new FormData(event.currentTarget));
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          setFilename(result.data?.filename ?? "upload.csv");
          setHeaders(result.data?.headers ?? []);
          setMapping(result.data?.mapping ?? {});
          setRows(result.data?.rows ?? []);
        }}
      >
        <ImportFileDropzone
          error={fileError}
          onError={setFileError}
          onFileChange={(file) => {
            setHasFile(Boolean(file));
            if (!file) resetPreview();
          }}
        />
        <Button type="submit">Preview and auto-map</Button>
      </form>

      {headers.length > 0 ? (
        <div className="rounded-lg border border-border p-4">
          <p className="mb-3 text-sm">
            {rows.length} rows · {valid} valid · {invalid} invalid
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            {CANONICAL_FIELDS.map((field) => (
              <label key={field} className="text-sm">
                <span className="mb-1 block text-muted-foreground">{field}</span>
                <select
                  className="border-input bg-background h-8 w-full rounded-lg border px-2"
                  value={mapping[field] ?? ""}
                  onChange={(event) => setMapping((current) => ({ ...current, [field]: event.target.value || undefined }))}
                >
                  <option value="">Ignore</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <select
              className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
              value={mode}
              onChange={(event) => setMode(event.target.value as typeof mode)}
            >
              <option value="skip">Skip duplicates</option>
              <option value="update">Update existing</option>
              <option value="create">Create new anyway</option>
            </select>
            <Button
              disabled={pending}
              onClick={async () => {
                setPending(true);
                const result = await confirmImportAction({ filename, mapping, rows, mode });
                setPending(false);
                if (!result.ok) toast.error(result.error);
                else toast.success(`Imported ${result.data?.imported ?? 0}, updated ${result.data?.updated ?? 0}, skipped ${result.data?.duplicates ?? 0}`);
              }}
            >
              {pending ? "Importing..." : "Confirm import"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
