import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { ForgotPasswordForm } from "@/components/auth-forms";
import { clerkAuthJsRedirect } from "@/lib/auth/paths";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  const next = clerkAuthJsRedirect("/forgot-password");
  if (next) redirect(next);

  return (
    <AuthCard title="Reset password" subtitle="We will issue a reset link. In development it is shown on this page.">
      <ForgotPasswordForm />
    </AuthCard>
  );
}
