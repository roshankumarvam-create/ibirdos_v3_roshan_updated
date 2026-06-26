import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ibirdos/logger", () => ({
  moduleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@ibirdos/db", () => ({
  Prisma: { PrismaClientKnownRequestError: class {} },
}));

import { HttpExceptionFilter } from "./http-exception.filter";
import { HttpException, HttpStatus, NotFoundException } from "@nestjs/common";

function makeHost(statusFn = vi.fn(), jsonFn = vi.fn()) {
  const res = { status: vi.fn().mockReturnValue({ json: jsonFn }), json: jsonFn };
  res.status.mockReturnValue(res);
  const req = { method: "GET", url: "/api/v1/test" };
  return {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
    _res: res,
    _json: jsonFn,
  } as any;
}

describe("HttpExceptionFilter", () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  it("GET /api/v1/this-does-not-exist returns friendly 404", () => {
    const host = makeHost();
    // NestJS emits a NotFoundException with "Cannot GET /api/v1/this-does-not-exist"
    const exception = new NotFoundException("Cannot GET /api/v1/this-does-not-exist");

    filter.catch(exception, host);

    expect(host._res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    const body = host._json.mock.calls[0][0];
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toBe("Requested resource not available.");
    expect(JSON.stringify(body)).not.toContain("Cannot GET");
    expect(JSON.stringify(body)).not.toContain("this-does-not-exist");
  });

  it("scrubs Cannot GET / (root path, no api prefix) — never leaks path", () => {
    const host = makeHost();
    const exception = new NotFoundException("Cannot GET /");

    filter.catch(exception, host);

    const body = host._json.mock.calls[0][0];
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toBe("Requested resource not available.");
    expect(JSON.stringify(body)).not.toContain("Cannot GET");
    expect(JSON.stringify(body)).not.toContain('"/');
  });

  it("scrubs Cannot HEAD / (preflight path) — never leaks method or path", () => {
    const host = makeHost();
    const exception = new NotFoundException("Cannot HEAD /api/v1/health");

    filter.catch(exception, host);

    const body = host._json.mock.calls[0][0];
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toBe("Requested resource not available.");
    expect(JSON.stringify(body)).not.toContain("Cannot HEAD");
  });

  it("scrubs Cannot PATCH /path from NotFoundException string body", () => {
    const host = makeHost();
    const exception = new NotFoundException("Cannot PATCH /api/v1/users/cmqh3fvtj000mr62k3nlx3mge");

    filter.catch(exception, host);

    const body = host._json.mock.calls[0][0];
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toBe("Requested resource not available.");
    expect(JSON.stringify(body)).not.toContain("cmqh3fvtj000mr62k3nlx3mge");
  });

  it("passes through legitimate HttpException messages unchanged", () => {
    const host = makeHost();
    const exception = new HttpException("Workspace not found", HttpStatus.NOT_FOUND);

    filter.catch(exception, host);

    const body = host._json.mock.calls[0][0];
    expect(body.error.message).toBe("Workspace not found");
  });

  it("returns 500 friendly message for unknown exceptions", () => {
    const host = makeHost();
    filter.catch(new Error("some internal error"), host);

    expect(host._res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = host._json.mock.calls[0][0];
    expect(body.error.code).toBe("internal_error");
  });
});
