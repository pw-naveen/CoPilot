export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const badRequest = (m = "Bad request") => new HttpError(400, m);
export const unauthorized = (m = "Not signed in") => new HttpError(401, m);
export const forbidden = (m = "Not allowed") => new HttpError(403, m);
// Out-of-scope records are reported as missing so their existence does not leak.
export const notFound = (m = "Not found") => new HttpError(404, m);
export const conflict = (m = "Conflict") => new HttpError(409, m);
