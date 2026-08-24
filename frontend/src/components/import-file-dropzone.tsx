"use client";

import { useId, useRef, useState } from "react";
import { FileSpreadsheet, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  IMPORT_ACCEPT,
  formatImportFileSize,
  importFileTypeLabel,
  validateImportFile,
} from "@/lib/import/file";
import { cn } from "@/lib/utils";

export function ImportFileDropzone({
  error,
  onError,
  onFileChange,
}: {
  error: string | null;
  onError: (message: string | null) => void;
  onFileChange: (file: File | null) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCount = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function assignFile(next: File | null) {
    const input = inputRef.current;
    // Reset the native input when clearing so re-selecting the same file re-fires onChange.
    if (input && !next) input.value = "";
    setFile(next);
    onFileChange(next);
  }

  function applyFile(next: File | null) {
    if (!next) {
      onError(null);
      assignFile(null);
      return;
    }
    const result = validateImportFile(next);
    if (!result.ok) {
      onError(result.error);
      assignFile(null);
      return;
    }
    onError(null);
    assignFile(next);
  }

  function openPicker() {
    inputRef.current?.click();
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        id={inputId}
        name="file"
        type="file"
        accept={IMPORT_ACCEPT}
        className="sr-only"
        onChange={(event) => applyFile(event.target.files?.[0] ?? null)}
      />

      {file ? (
        <div
          className="border-border flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          data-testid="import-file-selected"
        >
          <div className="flex min-w-0 items-start gap-3">
            <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-md border border-border">
              <FileSpreadsheet className="text-muted-foreground size-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium">{file.name}</p>
              <p className="text-muted-foreground text-xs">
                {formatImportFileSize(file.size)} · {importFileTypeLabel(file.name)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={openPicker}>
              Replace
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => applyFile(null)}
              aria-label="Remove selected file"
            >
              <X className="size-3.5" />
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          aria-describedby={error ? `${inputId}-error` : `${inputId}-hint`}
          aria-label="Drop your CSV or Excel file here, or browse files"
          className={cn(
            "rounded-lg border border-dashed px-4 py-10 text-center outline-none transition-colors",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            dragOver ? "border-foreground bg-muted/60" : "border-border bg-muted/20 hover:bg-muted/40",
            error ? "border-destructive/50" : null,
          )}
          onClick={openPicker}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openPicker();
            }
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            dragCount.current += 1;
            setDragOver(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            dragCount.current = Math.max(0, dragCount.current - 1);
            if (dragCount.current === 0) setDragOver(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            dragCount.current = 0;
            setDragOver(false);
            applyFile(event.dataTransfer.files?.[0] ?? null);
          }}
        >
          <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-md border border-border bg-background">
            <Upload className="text-muted-foreground size-5" />
          </div>
          <p className="font-medium">Drop your CSV or Excel file here</p>
          <p className="text-muted-foreground mt-1 text-sm">
            or{" "}
            <span className="text-foreground underline-offset-4 hover:underline">Browse files</span>
          </p>
          <p id={`${inputId}-hint`} className="text-muted-foreground mt-3 text-xs">
            CSV • XLSX
          </p>
        </div>
      )}

      {error ? (
        <p id={`${inputId}-error`} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
