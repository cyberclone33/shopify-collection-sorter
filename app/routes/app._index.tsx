import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
  Box,
  InlineGrid,
  Icon,
  Badge,
  Banner,
  CalloutCard,
} from "@shopify/polaris";
import {
  TitleBar,
  useAppBridge,
} from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  ProductIcon,
  OrderIcon,
  HomeIcon,
  CollectionIcon,
  PersonIcon,
  SearchIcon
} from "@shopify/polaris-icons";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  const navigate = useNavigate();
  const appBridge = useAppBridge();

  return (
    <Page>
      <TitleBar title="Alpha Dog" />
      
      <BlockStack gap="500">
        {/* Hero Banner */}
        <Card>
          <BlockStack gap="400">
            <Box paddingBlock="600" paddingInline="600" background="bg-surface-secondary" borderRadius="300">
              <BlockStack gap="500">
                <Text as="h1" variant="heading2xl">
                  Welcome to Alpha Dog
                </Text>
                <Text as="p" variant="bodyLg">
                  Enhance your Shopify store with powerful collection sorting and seamless social logins.
                  Designed to optimize your store's performance and improve customer experience.
                </Text>
                <InlineStack gap="300" wrap={false}>
                  <Button
                    variant="primary"
                    size="large"
                    onClick={() => navigate("/app/collections")}
                  >
                    Get Started
                  </Button>
                  <Button
                    size="large"
                    onClick={() => {
                      window.open("https://alphapetstw.com", "_blank");
                    }}
                  >
                    View Demo Store
                  </Button>
                </InlineStack>
              </BlockStack>
            </Box>
          </BlockStack>
        </Card>

        {/* Feature Cards */}
        <InlineGrid columns={["oneThird", "oneThird", "oneThird"]} gap="400">
          {/* Dashboard Card */}
          <Card>
            <BlockStack gap="300">
              <Box paddingBlock="400" paddingInline="400">
                <BlockStack gap="300">
                  <Icon source={HomeIcon} />
                  <Text as="h2" variant="headingMd">Dashboard</Text>
                  <Text as="p" variant="bodyMd">
                    Get a comprehensive overview of your store's performance and app features.
                  </Text>
                  <Button
                    variant="plain"
                    textAlign="left"
                    accessibilityLabel="Go to Dashboard"
                  >
                    You're here →
                  </Button>
                </BlockStack>
              </Box>
            </BlockStack>
          </Card>

          {/* Collection Sorter Card */}
          <Card>
            <BlockStack gap="300">
              <Box paddingBlock="400" paddingInline="400">
                <BlockStack gap="300">
                  <Icon source={CollectionIcon} />
                  <InlineStack gap="200" align="start">
                    <Text as="h2" variant="headingMd">Collection Sorter</Text>
                    <Badge tone="success">Popular</Badge>
                  </InlineStack>
                  <Text as="p" variant="bodyMd">
                    Automatically sort products in collections based on inventory status, putting in-stock items first.
                  </Text>
                  <Button
                    variant="plain"
                    textAlign="left"
                    onClick={() => navigate("/app/collections")}
                    accessibilityLabel="Go to Collection Sorter"
                  >
                    Manage collections →
                  </Button>
                </BlockStack>
              </Box>
            </BlockStack>
          </Card>

          {/* Social Login Card */}
          <Card>
            <BlockStack gap="300">
              <Box paddingBlock="400" paddingInline="400">
                <BlockStack gap="300">
                  <Icon source={PersonIcon} />
                  <InlineStack gap="200" align="start">
                    <Text as="h2" variant="headingMd">Social Login</Text>
                    <Badge tone="new">New</Badge>
                  </InlineStack>
                  <Text as="p" variant="bodyMd">
                    Enable customers to sign in with Facebook, Google, and LINE accounts for a seamless login experience.
                  </Text>
                  <Button
                    variant="plain"
                    textAlign="left"
                    onClick={() => navigate("/app/social-login")}
                    accessibilityLabel="Go to Social Login"
                  >
                    Manage social logins →
                  </Button>
                </BlockStack>
              </Box>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Featured Sections */}
        <Layout>
          <Layout.Section>
            <CalloutCard
              title="Collection Sorter"
              illustration="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              primaryAction={{
                content: 'Sort Collections',
                onAction: () => navigate("/app/collections"),
              }}
              secondaryAction={{
                content: 'Learn more',
                url: '#',
              }}
            >
              <BlockStack gap="200">
                <Text as="p">
                  Our powerful collection sorter improves your customers' shopping experience by prioritizing in-stock items. Key features include:
                </Text>
                <BlockStack gap="200">
                  <InlineStack gap="200" align="start">
                    <Icon source={SearchIcon} />
                    <Text as="span">In-stock products appear first in collections</Text>
                  </InlineStack>
                  <InlineStack gap="200" align="start">
                    <Icon source={ProductIcon} />
                    <Text as="span">Bulk sort all collections with one click</Text>
                  </InlineStack>
                  <InlineStack gap="200" align="start">
                    <Icon source={CollectionIcon} />
                    <Text as="span">Track sorting history and performance</Text>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </CalloutCard>
          </Layout.Section>

          <Layout.Section>
            <CalloutCard
              title="Social Login Integration"
              illustration="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              primaryAction={{
                content: 'Manage Social Login',
                onAction: () => navigate("/app/social-login"),
              }}
              secondaryAction={{
                content: 'View connected users',
                onAction: () => navigate("/app/social-login"),
              }}
            >
              <BlockStack gap="200">
                <Text as="p">
                  Increase conversions by offering a seamless login experience with popular social platforms:
                </Text>
                <BlockStack gap="200">
                  <InlineStack gap="200" align="start">
                    <Icon source={PersonIcon} />
                    <Text as="span">Support for Facebook, Google, and LINE login</Text>
                  </InlineStack>
                  <InlineStack gap="200" align="start">
                    <Icon source={PersonIcon} />
                    <Text as="span">Automatic account linking with Shopify customers</Text>
                  </InlineStack>
                  <InlineStack gap="200" align="start">
                    <Icon source={PersonIcon} />
                    <Text as="span">Enhanced security with JWT authentication</Text>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </CalloutCard>
          </Layout.Section>
        </Layout>

        {/* Getting Started Section */}
        <Card>
          <BlockStack gap="400">
            <Box paddingBlock="500" paddingInline="500">
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">
                  Getting Started
                </Text>
                <Layout>
                  <Layout.Section variant="oneThird">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">1. Configure Collection Sorter</Text>
                      <Text as="p" variant="bodyMd">
                        Set up automatic sorting preferences for your product collections to prioritize in-stock items.
                      </Text>
                      <Button
                        onClick={() => navigate("/app/collections")}
                      >
                        Configure Sorter
                      </Button>
                    </BlockStack>
                  </Layout.Section>
                  <Layout.Section variant="oneThird">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">2. Set Up Social Login</Text>
                      <Text as="p" variant="bodyMd">
                        Install social login buttons on your store to enable customers to sign in with their preferred social accounts.
                      </Text>
                      <Button
                        onClick={() => navigate("/app/social-login")}
                      >
                        Set Up Login
                      </Button>
                    </BlockStack>
                  </Layout.Section>
                  <Layout.Section variant="oneThird">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">3. Monitor Performance</Text>
                      <Text as="p" variant="bodyMd">
                        Track the impact of collection sorting and social login on your store's performance and customer engagement.
                      </Text>
                      <Button>
                        View Analytics
                      </Button>
                    </BlockStack>
                  </Layout.Section>
                </Layout>
              </BlockStack>
            </Box>
          </BlockStack>
        </Card>

        {/* Help & Support */}
        <Banner title="Need help with setup?" tone="info">
          <BlockStack gap="200">
            <Text as="p">
              Our documentation provides detailed instructions on setting up and optimizing both the Collection Sorter and Social Login features.
            </Text>
            <InlineStack gap="300">
              <Button>View Documentation</Button>
              <Button variant="plain">Contact Support</Button>
            </InlineStack>
          </BlockStack>
        </Banner>
      </BlockStack>
    </Page>
  );
}
