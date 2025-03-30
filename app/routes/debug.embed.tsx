import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

/**
 * Minimal test page for embedding
 */
export function loader() {
  return json({
    success: true,
    message: "This is a minimal test page for embedding",
    timestamp: new Date().toISOString()
  });
}

export default function DebugEmbed() {
  const data = useLoaderData<typeof loader>();
  
  return (
    <div style={{ padding: "20px", fontFamily: "system-ui, sans-serif" }}>
      <h1>Embedding Test Page</h1>
      <p>If you can see this page, embedding is working correctly!</p>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
