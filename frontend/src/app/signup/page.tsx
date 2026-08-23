import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { SignupForm } from "@/components/auth-forms";
import { clerkAuthJsRedirect } from "@/lib/auth/paths";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  const next = clerkAuthJsRedirect("/signup");
  if (next) redirect(next);

  return (
    <AuthCard title="Create your agency" subtitle="Owner account, isolated organization, 14-day Starter trial.">
      <SignupForm />
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Already registered?{" "}
        <Link href="/login" className="text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
