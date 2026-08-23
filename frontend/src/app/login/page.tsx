import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { LoginForm } from "@/components/auth-forms";
import { clerkAuthJsRedirect } from "@/lib/auth/paths";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const next = clerkAuthJsRedirect("/login");
  if (next) redirect(next);

  return (
    <AuthCard title="Sign in" subtitle="Use the Al Noor demo or your agency account.">
      <LoginForm />
      <p className="mt-4 text-center text-sm text-muted-foreground">
        New agency?{" "}
        <Link href="/signup" className="text-foreground underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}
