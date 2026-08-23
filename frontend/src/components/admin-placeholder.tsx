import { PageHeader } from "@/components/page-header";

export function AdminPlaceholder({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <PageHeader title={title} description="Internal operations. This section is not implemented yet." />
      <p className="type-small text-muted-foreground max-w-xl">{body}</p>
    </div>
  );
}
