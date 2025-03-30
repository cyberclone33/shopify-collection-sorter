// Environment variable check for debugging startup issues
console.log("Starting server with environment variables check:");
console.log("JWT_SECRET set:", Boolean(process.env.JWT_SECRET));
console.log("AUTO_RESORT_SECRET set:", Boolean(process.env.AUTO_RESORT_SECRET));
console.log("SHOPIFY_API_KEY set:", Boolean(process.env.SHOPIFY_API_KEY));
console.log("SHOPIFY_API_SECRET set:", Boolean(process.env.SHOPIFY_API_SECRET));
console.log("SHOPIFY_APP_URL set:", process.env.SHOPIFY_APP_URL);
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("PORT:", process.env.PORT);

import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { RemixServer } from "@remix-run/react";
import {
  createReadableStreamFromReadable,
  type EntryContext,
} from "@remix-run/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { getSecurityHeaders } from "./utils/security-headers.server";

export const streamTimeout = 5000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  // Add Shopify-specific headers
  addDocumentResponseHeaders(request, responseHeaders);
  
  // Add security headers
  const securityHeaders = getSecurityHeaders();
  for (const [key, value] of Object.entries(securityHeaders)) {
    responseHeaders.set(key, value);
  }
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? '')
    ? "onAllReady"
    : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <RemixServer
        context={remixContext}
        url={request.url}
      />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      }
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
