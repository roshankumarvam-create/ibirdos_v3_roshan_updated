import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function POST() {
  const c = await cookies();
  await fetch(`${API_URL}/api/v1/auth/logout`, {
    method: "POST",
    headers: { Cookie: c.toString() },
  }).catch(() => null);
  // Clear cookie locally too as a belt-and-braces
  const res = NextResponse.redirect(new URL("/login", process.env.WEB_URL ?? "http://localhost:3000"));
  res.cookies.delete(process.env.AUTH_COOKIE_NAME ?? "ibirdos.sid");
  return res;
}
