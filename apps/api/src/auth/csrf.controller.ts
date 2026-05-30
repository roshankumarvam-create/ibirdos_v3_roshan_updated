import { Controller, Get, Res } from "@nestjs/common";
import { Response } from "express";
import { randomBytes } from "crypto";
import { ok } from "@ibirdos/types";
import { env } from "@ibirdos/config";

const CSRF_COOKIE = "ibirdos.csrf";

@Controller("auth")
export class CsrfController {
  @Get("csrf")
  issue(@Res({ passthrough: true }) res: Response) {
    const token = randomBytes(32).toString("hex");
    // CSRF cookie is intentionally NOT HttpOnly — JS reads it to put
    // in the X-Csrf-Token header. The defense is: an attacker on
    // another origin cannot read the cookie value, so they cannot
    // forge the header.
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      domain: env.AUTH_COOKIE_DOMAIN ?? undefined,
    });
    return ok({ token });
  }
}
