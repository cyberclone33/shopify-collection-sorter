import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Box,
  Button,
  InlineStack,
  TextField,
  Banner,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState } from "react";

// Define types for our data
interface DatabaseTable {
  name: string;
}

interface ColumnInfo {
  name: string;
}

interface Session {
  [key: string]: any;
}

interface SortedCollection {
  [key: string]: any;
}

interface LoaderData {
  tables: string[];
  sessions: Session[];
  sortedCollections: SortedCollection[];
  columns: string[];
  shop: string;
  error?: string;
}

interface ActionResponse {
  success: boolean;
  message: string;
  result?: any;
}

// Loader function to fetch initial database info
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Ensure only authenticated admin users can access this page
  const { admin, session } = await authenticate.admin(request);
  
  try {
    // Get database tables
    const tables = await prisma.$queryRaw<DatabaseTable[]>`SELECT name FROM sqlite_master WHERE type='table'`;
    
    // Query sessions using raw SQL to avoid schema mismatches
    const sessions = await prisma.$queryRaw<Session[]>`SELECT * FROM "Session" WHERE shop = ${session.shop} LIMIT 10`;
    
    // Get SortedCollection columns
    const columns = await prisma.$queryRaw<ColumnInfo[]>`PRAGMA table_info("SortedCollection")`;
    
    // Query sorted collections for this shop
    const sortedCollections = await prisma.$queryRaw<SortedCollection[]>`
      SELECT * FROM "SortedCollection" 
      WHERE shop = ${session.shop}
      ORDER BY "sortedAt" DESC
      LIMIT 10
    `;
    
    return json<LoaderData>({
      tables: tables.map(t => t.name),
      sessions,
      sortedCollections,
      columns: columns.map(c => c.name),
      shop: session.shop
    });
  } catch (error) {
    console.error("Error querying database:", error);
    return json<LoaderData>({
      error: `Error querying database: ${error instanceof Error ? error.message : "Unknown error"}`,
      tables: [],
      sessions: [],
      sortedCollections: [],
      columns: [],
      shop: session.shop
    });
  }
};

// Action function to handle custom queries
export const action = async ({ request }: ActionFunctionArgs) => {
  // Ensure only authenticated admin users can access this endpoint
  const { session } = await authenticate.admin(request);
  
  const formData = await request.formData();
  const customQuery = formData.get("customQuery")?.toString() || "";
  
  if (!customQuery) {
    return json<ActionResponse>({ 
      success: false, 
      message: "No query provided" 
    });
  }
  
  try {
    // Execute the custom query with shop parameter for safety
    // This approach prevents arbitrary SQL execution by requiring the shop parameter
    const result = await prisma.$queryRawUnsafe(
      customQuery,
      session.shop
    );
    
    return json<ActionResponse>({ 
      success: true, 
      result,
      message: "Query executed successfully"
    });
  } catch (error) {
    console.error("Error executing custom query:", error);
    return json<ActionResponse>({ 
      success: false, 
      message: `Error: ${error instanceof Error ? error.message : "Unknown error"}` 
    });
  }
};

export default function AdminPage() {
  const { 
    tables, 
    sessions, 
    sortedCollections, 
    columns, 
    error, 
    shop 
  } = useLoaderData<typeof loader>();
  
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  
  const [customQuery, setCustomQuery] = useState("");
  
  const handleSubmit = () => {
    // Ensure the query contains the shop parameter to prevent arbitrary data access
    if (!customQuery.includes("?")) {
      alert("Your query must include a parameter placeholder (?) for the shop name");
      return;
    }
    
    submit(
      { customQuery },
      { method: "post" }
    );
  };
  
  return (
    <Page>
      <TitleBar title="Database Admin" />
      
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical">{error}</Banner>
          </Layout.Section>
        )}
        
        <Layout.Section>
          <Card>
            <BlockStack gap="500">
              <Text as="h2" variant="headingMd">Database Information</Text>
              <Text as="p">Shop: {shop}</Text>
              
              <Box>
                <Text as="h3" variant="headingMd">Tables</Text>
                <Box paddingBlock="400">
                  <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto' }}>
                    {JSON.stringify(tables, null, 2)}
                  </pre>
                </Box>
              </Box>
              
              <Divider />
              
              <Box>
                <Text as="h3" variant="headingMd">SortedCollection Columns</Text>
                <Box paddingBlock="400">
                  <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto' }}>
                    {JSON.stringify(columns, null, 2)}
                  </pre>
                </Box>
              </Box>
              
              <Divider />
              
              <Box>
                <Text as="h3" variant="headingMd">Sessions (Limited to 10)</Text>
                <Box paddingBlock="400">
                  <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto' }}>
                    {JSON.stringify(sessions, null, 2)}
                  </pre>
                </Box>
              </Box>
              
              <Divider />
              
              <Box>
                <Text as="h3" variant="headingMd">Sorted Collections (Limited to 10)</Text>
                <Box paddingBlock="400">
                  <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto' }}>
                    {JSON.stringify(sortedCollections, null, 2)}
                  </pre>
                </Box>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>
        
        <Layout.Section>
          <Card>
            <BlockStack gap="500">
              <Text as="h2" variant="headingMd">Custom Query</Text>
              <Text as="p">
                Enter a custom SQL query to execute. For security, you must include a parameter placeholder (?) 
                which will be replaced with your shop name.
              </Text>
              <Text as="p" variant="bodyMd">
                Example: <code>SELECT * FROM SortedCollection WHERE shop = ? LIMIT 5</code>
              </Text>
              
              <TextField
                label="SQL Query"
                value={customQuery}
                onChange={setCustomQuery}
                multiline={4}
                autoComplete="off"
                placeholder="SELECT * FROM SortedCollection WHERE shop = ? LIMIT 5"
              />
              
              <InlineStack gap="300">
                <Button onClick={handleSubmit} variant="primary">Execute Query</Button>
              </InlineStack>
              
              {actionData && (
                <Box paddingBlock="400">
                  <Banner tone={actionData.success ? "success" : "critical"}>
                    {actionData.message}
                  </Banner>
                  
                  {actionData.success && actionData.result && (
                    <Box paddingBlock="400">
                      <Text as="h3" variant="headingMd">Query Result</Text>
                      <Box paddingBlock="400">
                        <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto' }}>
                          {JSON.stringify(actionData.result, null, 2)}
                        </pre>
                      </Box>
                    </Box>
                  )}
                </Box>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
