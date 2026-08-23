import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { ResetPasswordForm } from "@/components/auth-forms";
import { clerkAuthJsRedirect } from "@/lib/auth/paths";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const next = clerkAuthJsRedirect("/reset-password");
  if (next) redirect(next);

  const params = await searchParams;
  return (
    <AuthCard title="Choose a new password" subtitle="This link expires after one hour.">
      <ResetPasswordForm email={params.email ?? ""} token={params.token ?? ""} />
    </AuthCard>
  );
}
