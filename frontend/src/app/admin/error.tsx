"use client";

export default function AdminError() {
  return (
    <div className="space-y-2">
      <h1 className="type-h1">Unable to load this admin page</h1>
      <p className="type-small text-muted-foreground">Try again. No tenant data is shown in this error state.</p>
    </div>
  );
}
