import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { 
  Page, 
  Layout, 
  Card, 
  EmptyState,
  Spinner,
  IndexTable,
  Text,
  Avatar,
  Badge,
  Link
} from '@shopify/polaris';
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { PrismaClient, type LineUser } from "@prisma/client";

const prisma = new PrismaClient();

// Type for serialized LineUser (Date objects become strings when sent to the client)
type SerializedLineUser = Omit<LineUser, 'createdAt' | 'updatedAt' | 'tokenExpiresAt'> & {
  createdAt: string;
  updatedAt: string;
  tokenExpiresAt: string | null;
};

interface LoaderData {
  lineUsers: SerializedLineUser[];
  error?: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  
  try {
    const lineUsers = await prisma.lineUser.findMany({
      where: {
        shop: session.shop
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    return json<LoaderData>({ lineUsers: lineUsers.map((lineUser) => ({
      ...lineUser,
      createdAt: lineUser.createdAt.toISOString(),
      updatedAt: lineUser.updatedAt.toISOString(),
      tokenExpiresAt: lineUser.tokenExpiresAt ? lineUser.tokenExpiresAt.toISOString() : null,
    })) });
  } catch (error) {
    console.error("Error fetching LINE users:", error);
    return json<LoaderData>({ lineUsers: [], error: "Failed to fetch LINE users" });
  }
}

export default function LineUsersPage() {
  const { lineUsers } = useLoaderData<LoaderData>();
  const [isLoading, setIsLoading] = useState(false);
  
  const resourceName = {
    singular: 'LINE user',
    plural: 'LINE users',
  };

  // Format customer ID for display
  const formatCustomerId = (customerId: string | null) => {
    if (!customerId) return "Not linked";
    
    // If it's a gid, extract the ID number
    if (customerId.startsWith('gid://')) {
      const parts = customerId.split('/');
      return parts[parts.length - 1];
    }
    
    return customerId;
  };

  // Determine if the user has a Shopify customer linked
  const getCustomerBadge = (shopifyCustomerId: string | null) => {
    if (shopifyCustomerId) {
      return <Badge tone="success">Linked to customer</Badge>;
    }
    return <Badge tone="attention">No customer link</Badge>;
  };

  // Handle empty state
  const emptyStateMarkup = (
    <EmptyState
      heading="No LINE users found"
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>
        No users have authenticated with LINE yet. Once they do, they'll appear here.
      </p>
    </EmptyState>
  );

  // Create table rows
  const rowMarkup = lineUsers?.map(
    (
      {
        id,
        lineId,
        displayName,
        email,
        pictureUrl,
        shopifyCustomerId,
        createdAt,
        updatedAt
      }: SerializedLineUser,
      index: number,
    ) => (
      <IndexTable.Row id={id} key={id} position={index}>
        <IndexTable.Cell>
          <Avatar source={pictureUrl || undefined} customer name={displayName || "Unknown"} />
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {displayName || "N/A"}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{lineId}</IndexTable.Cell>
        <IndexTable.Cell>{email || "N/A"}</IndexTable.Cell>
        <IndexTable.Cell>
          {getCustomerBadge(shopifyCustomerId)}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {formatCustomerId(shopifyCustomerId)}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {new Date(createdAt).toLocaleDateString()}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {new Date(updatedAt).toLocaleDateString()} {new Date(updatedAt).toLocaleTimeString()}
        </IndexTable.Cell>
      </IndexTable.Row>
    ),
  );

  return (
    <Page 
      title="LINE Users" 
      subtitle="Manage users who have connected with your store using LINE"
    >
      <Layout>
        <Layout.Section>
          <Card>
            {isLoading ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <Spinner accessibilityLabel="Loading LINE users" size="large" />
              </div>
            ) : lineUsers?.length > 0 ? (
              <IndexTable
                resourceName={resourceName}
                itemCount={lineUsers.length}
                headings={[
                  { title: 'Avatar' },
                  { title: 'Name' },
                  { title: 'LINE ID' },
                  { title: 'Email' },
                  { title: 'Customer Status' },
                  { title: 'Customer ID' },
                  { title: 'Joined' },
                  { title: 'Last Logged In' },
                ]}
              >
                {rowMarkup}
              </IndexTable>
            ) : (
              emptyStateMarkup
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
