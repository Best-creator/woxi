export function requestJson(
  url: string,
  body: unknown,
  method: "POST" | "PATCH" = "POST"
) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

