/**
 * Resolve a path the API returned against the client's API URL.
 *
 * Self-hosted deployments return attachment `presigned_url`s as paths such as
 * `/api/v1/public/download?jwt=...`. Mirrors Python's `_construct_url`, including
 * the de-duplication of an `/api` or `/api/v1` suffix already present on apiUrl.
 */
export function constructUrl(apiUrl: string, pathname: string): string {
  if (pathname.startsWith("http")) return pathname;
  const match = apiUrl.match(/^(https?:\/\/)(.*)$/);
  if (!match) {
    throw new Error(
      `api_url must start with 'http://' or 'https://'. Received ${apiUrl}`,
    );
  }
  const [, scheme, host] = match;
  let apiParts = host.replace(/\/+$/, "").split("/");
  const pathParts = pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  if (pathParts.length === 0) return apiUrl;
  if (pathParts[0] === "api") {
    if (apiParts[apiParts.length - 1] === "api") {
      apiParts = apiParts.slice(0, -1);
    } else if (apiParts.slice(-2).join("/") === "api/v1") {
      apiParts = apiParts.slice(0, -2);
    }
  }
  return scheme + [...apiParts, ...pathParts].filter(Boolean).join("/");
}
