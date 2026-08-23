import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { auth as authJs } from "@/auth";
import { isClerkEnabled } from "@/lib/auth/clerk";
import { safeCallbackPath, tooManyRequests } from "@/lib/http";
import { clientKey, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/leads(.*)",
  "/follow-ups(.*)",
  "/reactivation(.*)",
  "/team(.*)",
  "/revenue(.*)",
  "/automations(.*)",
  "/settings(.*)",
  "/billing(.*)",
  "/inbox(.*)",
  "/onboarding(.*)",
  "/intelligence(.*)",
  "/import(.*)",
  "/properties(.*)",
  "/admin(.*)",
]);

const isPublicApi = createRouteMatcher([
  "/api/webhooks(.*)",
  "/api/cron(.*)",
  "/api/chat(.*)",
  "/api/ingest(.*)",
  "/api/auth(.*)",
]);

const clerkProxy = clerkMiddleware(
  async (auth, request) => {
    const pathname = request.nextUrl.pathname;
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      (pathname.startsWith("/sign-in") ||
        pathname.startsWith("/sign-up") ||
        pathname.startsWith("/login") ||
        pathname.startsWith("/signup") ||
        pathname.startsWith("/forgot-password") ||
        pathname.startsWith("/reset-password") ||
        pathname.startsWith("/api/auth"))
    ) {
      const limited = await rateLimit(clientKey(request, "auth-edge"), "auth");
      if (!limited.ok) return tooManyRequests(retryAfterSeconds(limited));
    }
    if (isPublicApi(request)) return;

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-revivelead-path", pathname);

    if (!isProtectedRoute(request)) {
      return NextResponse.next({ request: { headers: requestHeaders } });
    }

    if (isClerkEnabled()) {
      const { userId } = await auth();
      if (!userId) {
        await auth.protect();
      }
      return NextResponse.next({ request: { headers: requestHeaders } });
    }

    const session = await authJs();
    if (!session?.user?.id) {
      const login = new URL("/login", request.url);
      login.searchParams.set("callbackUrl", safeCallbackPath(pathname));
      return NextResponse.redirect(login);
    }

    return NextResponse.next({ request: { headers: requestHeaders } });
  },
  {
    frontendApiProxy: {
      enabled: () => Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_live_")),
    },
  },
);

export default clerkProxy;
export const proxy = clerkProxy;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
