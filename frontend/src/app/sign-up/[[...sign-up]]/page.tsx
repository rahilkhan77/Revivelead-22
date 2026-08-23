export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { ClerkSsoCallback } from "@/components/auth/sso-callback";
import { ClerkSignUpForm } from "@/components/auth/clerk-sign-up-form";
import { isClerkEnabled } from "@/lib/auth/clerk";
import { getSessionUser } from "@/lib/authz";

export default async function ClerkSignUpPage({
  params,
}: {
  params: Promise<{ "sign-up"?: string[] }>;
}) {
  if (!isClerkEnabled()) redirect("/signup");

  const segments = (await params)["sign-up"] ?? [];
  if (segments.includes("sso-callback")) {
    return <ClerkSsoCallback title="Creating your agency" subtitle="Finishing Google sign-up." />;
  }

  if (segments.length === 0) {
    const user = await getSessionUser();
    if (user) redirect("/dashboard");
  }

  return (
    <AuthCard
      kicker="Start ReviveLead"
      title="Create your agency"
      subtitle="Set up a workspace. Every lead stays isolated to your team."
    >
      <ClerkSignUpForm />
    </AuthCard>
  );
}
