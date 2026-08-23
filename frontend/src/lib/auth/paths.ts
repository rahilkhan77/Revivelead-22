import { isClerkEnabled } from "@/lib/auth/clerk";

export function signInPath() {
  return isClerkEnabled() ? "/sign-in" : "/login";
}

export function signUpPath() {
  return isClerkEnabled() ? "/sign-up" : "/signup";
}

export function clerkAuthJsRedirect(pathname: string) {
  if (!isClerkEnabled()) return null;
  if (pathname === "/login") return "/sign-in";
  if (pathname === "/signup") return "/sign-up";
  if (pathname === "/forgot-password" || pathname.startsWith("/reset-password")) {
    return "/sign-in?reset=1";
  }
  return null;
}
