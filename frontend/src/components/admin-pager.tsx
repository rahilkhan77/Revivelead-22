import Link from "next/link";

export function AdminPager({
  page,
  pageCount,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;

  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <p className="text-muted-foreground">
        Page {page} of {pageCount}
      </p>
      <div className="flex gap-3">
        {page > 1 ? (
          <Link prefetch={false} href={hrefFor(page - 1)} className="underline-offset-4 hover:underline">
            Previous
          </Link>
        ) : null}
        {page < pageCount ? (
          <Link prefetch={false} href={hrefFor(page + 1)} className="underline-offset-4 hover:underline">
            Next
          </Link>
        ) : null}
      </div>
    </div>
  );
}
