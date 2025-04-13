import { json, type LoaderFunctionArgs } from "@remix-run/node";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Box,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({});
};

export default function DailyDiscounts() {
  return (
    <Page>
      <TitleBar title="Daily Discounts" />
      
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Daily Discounts Management
              </Text>
              
              <Text as="p">
                This tool allows you to create and manage daily discounts for your products.
                Set up automatic price reductions based on custom schedules or product attributes.
              </Text>
              
              <Banner tone="info">
                <p>
                  Configure your discount rules below. Discounts can be applied automatically 
                  based on your settings or manually triggered when needed.
                </p>
              </Banner>
            </BlockStack>
          </Card>
        </Layout.Section>
        
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Getting Started
              </Text>
              
              <Box paddingBlock="400">
                <BlockStack gap="200">
                  <Text as="p">
                    To create your first daily discount:
                  </Text>
                  
                  <ol style={{ marginLeft: "1.5rem" }}>
                    <li>Configure your discount rules and schedule</li>
                    <li>Select which products or collections to include</li>
                    <li>Set discount amounts or percentages</li>
                    <li>Preview the changes before applying</li>
                    <li>Activate your discount</li>
                  </ol>
                </BlockStack>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
