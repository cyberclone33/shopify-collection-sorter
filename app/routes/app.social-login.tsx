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
  Tabs
} from '@shopify/polaris';
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { PrismaClient, type LineUser } from "@prisma/client";

const prisma = new PrismaClient();

// Type for serialized LineUser (Date objects become strings when sent to the client)
type SerializedLineUser = Omit<LineUser, 'createdAt' | 'updatedAt' | 'tokenExpiresAt'> & {
  createdAt: string;
  updatedAt: string;
  tokenExpiresAt: string | null;
};

// Type for GoogleUser (similar to LineUser but with Google-specific fields)
type GoogleUser = {
  id: string;
  shop: string;
  googleId: string;
  googleAccessToken: string | null;
  googleRefreshToken: string | null;
  tokenExpiresAt: Date | null;
  displayName: string | null;
  pictureUrl: string | null;
  email: string | null;
  shopifyCustomerId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// Type for serialized GoogleUser
type SerializedGoogleUser = Omit<GoogleUser, 'createdAt' | 'updatedAt' | 'tokenExpiresAt'> & {
  createdAt: string;
  updatedAt: string;
  tokenExpiresAt: string | null;
};

// Type for FacebookUser
type FacebookUser = {
  id: string;
  shop: string;
  facebookId: string;
  facebookAccessToken: string | null;
  tokenExpiresAt: Date | null;
  displayName: string | null;
  pictureUrl: string | null;
  email: string | null;
  shopifyCustomerId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// Type for serialized FacebookUser
type SerializedFacebookUser = Omit<FacebookUser, 'createdAt' | 'updatedAt' | 'tokenExpiresAt'> & {
  createdAt: string;
  updatedAt: string;
  tokenExpiresAt: string | null;
};

interface LoaderData {
  lineUsers: SerializedLineUser[];
  googleUsers: SerializedGoogleUser[];
  facebookUsers: SerializedFacebookUser[];
  error?: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  
  try {
    // Fetch LINE users
    const lineUsers = await prisma.lineUser.findMany({
      where: {
        shop: session.shop
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    // Fetch Google users
    let googleUsers: any[] = [];
    try {
      // Try to fetch Google users if the table exists
      const rawGoogleUsers = await prisma.$queryRaw`SELECT * FROM GoogleUser WHERE shop = ${session.shop} ORDER BY createdAt DESC`;
      googleUsers = Array.isArray(rawGoogleUsers) ? rawGoogleUsers : [];
    } catch (googleError) {
      console.error("Error fetching Google users:", googleError);
      // Continue with empty Google users array
    }
    
    // Fetch Facebook users
    let facebookUsers: any[] = [];
    try {
      // Try to fetch Facebook users if the table exists
      const rawFacebookUsers = await prisma.$queryRaw`SELECT * FROM FacebookUser WHERE shop = ${session.shop} ORDER BY createdAt DESC`;
      facebookUsers = Array.isArray(rawFacebookUsers) ? rawFacebookUsers : [];
    } catch (facebookError) {
      console.error("Error fetching Facebook users:", facebookError);
      // Continue with empty Facebook users array
    }
    
    return json<LoaderData>({ 
      lineUsers: lineUsers.map((lineUser) => ({
        ...lineUser,
        createdAt: lineUser.createdAt.toISOString(),
        updatedAt: lineUser.updatedAt.toISOString(),
        tokenExpiresAt: lineUser.tokenExpiresAt ? lineUser.tokenExpiresAt.toISOString() : null,
      })),
      googleUsers: googleUsers.map((googleUser: any) => ({
        ...googleUser,
        createdAt: new Date(googleUser.createdAt).toISOString(),
        updatedAt: new Date(googleUser.updatedAt).toISOString(),
        tokenExpiresAt: googleUser.tokenExpiresAt ? new Date(googleUser.tokenExpiresAt).toISOString() : null,
      })),
      facebookUsers: facebookUsers.map((facebookUser: any) => ({
        ...facebookUser,
        createdAt: new Date(facebookUser.createdAt).toISOString(),
        updatedAt: new Date(facebookUser.updatedAt).toISOString(),
        tokenExpiresAt: facebookUser.tokenExpiresAt ? new Date(facebookUser.tokenExpiresAt).toISOString() : null,
      }))
    });
  } catch (error) {
    console.error("Error fetching social login users:", error);
    return json<LoaderData>({ lineUsers: [], googleUsers: [], facebookUsers: [], error: "Failed to fetch social login users" });
  }
}

export default function SocialLoginPage() {
  const { lineUsers, googleUsers, facebookUsers } = useLoaderData<LoaderData>();
  const [isLoading, setIsLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  
  const handleTabChange = useCallback(
    (selectedTabIndex: number) => setSelected(selectedTabIndex),
    [],
  );

  const tabs = [
    {
      id: 'line-users',
      content: `LINE Users (${lineUsers.length})`,
      accessibilityLabel: 'LINE Users',
      panelID: 'line-users-panel',
    },
    {
      id: 'google-users',
      content: `Google Users (${googleUsers.length})`,
      accessibilityLabel: 'Google Users',
      panelID: 'google-users-panel',
    },
    {
      id: 'facebook-users',
      content: `Facebook Users (${facebookUsers.length})`,
      accessibilityLabel: 'Facebook Users',
      panelID: 'facebook-users-panel',
    },
  ];
  
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

  // Handle empty state for LINE users
  const lineEmptyStateMarkup = (
    <EmptyState
      heading="No LINE users found"
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>
        No users have authenticated with LINE yet. Once they do, they'll appear here.
      </p>
    </EmptyState>
  );
  
  // Handle empty state for Google users
  const googleEmptyStateMarkup = (
    <EmptyState
      heading="No Google users found"
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>
        No users have authenticated with Google yet. Once they do, they'll appear here.
      </p>
    </EmptyState>
  );
  
  // Handle empty state for Facebook users
  const facebookEmptyStateMarkup = (
    <EmptyState
      heading="No Facebook users found"
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>
        No users have authenticated with Facebook yet. Once they do, they'll appear here.
      </p>
    </EmptyState>
  );

  // Create table rows for LINE users
  const lineRowMarkup = lineUsers?.map(
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
  
  // Create table rows for Google users
  const googleRowMarkup = googleUsers?.map(
    (
      {
        id,
        googleId,
        displayName,
        email,
        pictureUrl,
        shopifyCustomerId,
        createdAt,
        updatedAt
      }: SerializedGoogleUser,
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
        <IndexTable.Cell>{googleId}</IndexTable.Cell>
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
  
  // Create table rows for Facebook users
  const facebookRowMarkup = facebookUsers?.map(
    (
      {
        id,
        facebookId,
        displayName,
        email,
        pictureUrl,
        shopifyCustomerId,
        createdAt,
        updatedAt
      }: SerializedFacebookUser,
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
        <IndexTable.Cell>{facebookId}</IndexTable.Cell>
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
      title="Social Login" 
      subtitle="Manage users who have connected with your store using social login providers"
    >
      <Layout>
        <Layout.Section>
          <Card>
            <Tabs tabs={tabs} selected={selected} onSelect={handleTabChange} />
            <div>
              {selected === 0 ? (
                isLoading ? (
                  <div style={{ textAlign: 'center', padding: '40px' }}>
                    <Spinner accessibilityLabel="Loading LINE users" size="large" />
                  </div>
                ) : lineUsers?.length > 0 ? (
                  <IndexTable
                    resourceName={{ singular: 'LINE user', plural: 'LINE users' }}
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
                    {lineRowMarkup}
                  </IndexTable>
                ) : (
                  lineEmptyStateMarkup
                )
              ) : selected === 1 ? (
                isLoading ? (
                  <div style={{ textAlign: 'center', padding: '40px' }}>
                    <Spinner accessibilityLabel="Loading Google users" size="large" />
                  </div>
                ) : googleUsers?.length > 0 ? (
                  <IndexTable
                    resourceName={{ singular: 'Google user', plural: 'Google users' }}
                    itemCount={googleUsers.length}
                    headings={[
                      { title: 'Avatar' },
                      { title: 'Name' },
                      { title: 'Google ID' },
                      { title: 'Email' },
                      { title: 'Customer Status' },
                      { title: 'Customer ID' },
                      { title: 'Joined' },
                      { title: 'Last Logged In' },
                    ]}
                  >
                    {googleRowMarkup}
                  </IndexTable>
                ) : (
                  googleEmptyStateMarkup
                )
              ) : (
                isLoading ? (
                  <div style={{ textAlign: 'center', padding: '40px' }}>
                    <Spinner accessibilityLabel="Loading Facebook users" size="large" />
                  </div>
                ) : facebookUsers?.length > 0 ? (
                  <IndexTable
                    resourceName={{ singular: 'Facebook user', plural: 'Facebook users' }}
                    itemCount={facebookUsers.length}
                    headings={[
                      { title: 'Avatar' },
                      { title: 'Name' },
                      { title: 'Facebook ID' },
                      { title: 'Email' },
                      { title: 'Customer Status' },
                      { title: 'Customer ID' },
                      { title: 'Joined' },
                      { title: 'Last Logged In' },
                    ]}
                  >
                    {facebookRowMarkup}
                  </IndexTable>
                ) : (
                  facebookEmptyStateMarkup
                )
              )}
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
