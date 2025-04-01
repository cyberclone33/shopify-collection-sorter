import { useState, useCallback, useEffect } from "react";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useSubmit, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DropZone,
  BlockStack,
  Thumbnail,
  Text,
  Banner,
  Button,
  PageActions,
  InlineStack,
  Box,
  DataTable,
  EmptyState,
  Spinner,
  Tabs,
  ButtonGroup,
  Toast,
  Frame,
  Modal,
  List
} from "@shopify/polaris";
import { NoteIcon, RefreshIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { processCSVFile, getAllShelfLifeItems, syncWithShopify } from "../utils/shelf-life.server";
import iconv from "iconv-lite";

// Define the ShelfLifeItem interface
interface ShelfLifeItem {
  id: string;
  shop: string;
  productId: string;
  batchId: string;
  expirationDate: Date | string;
  quantity: number;
  batchQuantity?: number | null;
  location: string | null;
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
  shopifyProductTitle: string | null;
  shopifyVariantTitle: string | null;
  syncStatus: string | null;
  syncMessage: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  
  // Fetch all shelf life items
  const shelfLifeItems: ShelfLifeItem[] = await getAllShelfLifeItems(shop);
  
  return json({
    shelfLifeItems
  });
};

interface ActionData {
  status: string;
  message: string;
  filename?: string;
  size?: number;
  savedCount?: number;
  errors?: string[];
  syncResult?: {
    success: boolean;
    matchedCount: number;
    message: string;
    unmatchedItems?: Array<{
      productId: string;
      reason: string;
    }>;
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  
  const formData = await request.formData();
  const action = formData.get("action");
  
  if (action === "sync") {
    try {
      const syncResult = await syncWithShopify(shop, admin);
      
      return json<ActionData>({
        status: syncResult.success ? "success" : "error",
        message: syncResult.message,
        syncResult
      });
    } catch (error) {
      console.error("Error syncing with Shopify:", error);
      return json<ActionData>({
        status: "error",
        message: `Error syncing with Shopify: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }
  
  // Handle CSV upload
  const file = formData.get("file");
  
  if (!file || !(file instanceof File)) {
    return json<ActionData>({ status: "error", message: "No file uploaded" });
  }
  
  try {
    // Read the file content as ArrayBuffer to handle different encodings
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Try to convert from Big5 to UTF-8 using iconv-lite
    // This will handle Traditional Chinese characters properly
    let fileContent;
    try {
      fileContent = iconv.decode(buffer, 'big5');
    } catch (encodingError) {
      console.warn("Failed to decode as Big5, falling back to UTF-8:", encodingError);
      fileContent = iconv.decode(buffer, 'utf8');
    }
    
    // Process the CSV file
    const result = await processCSVFile(fileContent, shop);
    
    if (result.errors.length > 0) {
      return json<ActionData>({
        status: "warning",
        message: `File processed with ${result.errors.length} errors`,
        filename: file.name,
        size: file.size,
        savedCount: result.savedCount,
        errors: result.errors
      });
    }
    
    return json<ActionData>({
      status: "success",
      message: `File processed successfully. ${result.savedCount} items saved.`,
      filename: file.name,
      size: file.size,
      savedCount: result.savedCount
    });
  } catch (error) {
    console.error("Error processing file:", error);
    return json<ActionData>({
      status: "error",
      message: `Error processing file: ${error instanceof Error ? error.message : String(error)}`
    });
  }
};

export default function ShelfLifeManagement() {
  const [file, setFile] = useState<File | null>(null);
  const [rejectedFiles, setRejectedFiles] = useState<File[]>([]);
  const [selectedTab, setSelectedTab] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [toastActive, setToastActive] = useState(false);
  const [toastContent, setToastContent] = useState({ message: "", tone: "success" });
  const [syncResultModalActive, setSyncResultModalActive] = useState(false);
  
  const actionData = useActionData<ActionData>();
  const { shelfLifeItems } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  // Handle toast and modal when action data changes
  useEffect(() => {
    if (actionData?.syncResult) {
      setToastActive(true);
      setToastContent({
        message: actionData.message,
        tone: actionData.status === "success" ? "success" : "critical"
      });
      setIsSyncing(false);
      
      // If there are unmatched items, show the modal
      if (actionData.syncResult.unmatchedItems && actionData.syncResult.unmatchedItems.length > 0) {
        setSyncResultModalActive(true);
      }
    }
  }, [actionData]);

  const handleDropZoneDrop = useCallback(
    (_dropFiles: File[], acceptedFiles: File[], rejectedFiles: File[]) => {
      setFile(acceptedFiles[0]);
      setRejectedFiles(rejectedFiles);
    },
    []
  );

  const handleSubmit = () => {
    if (!file) return;
    
    const formData = new FormData();
    formData.append("file", file);
    
    submit(formData, { method: "post", encType: "multipart/form-data" });
  };
  
  const handleSync = () => {
    setIsSyncing(true);
    
    const formData = new FormData();
    formData.append("action", "sync");
    
    submit(formData, { method: "post" });
  };

  const validImageTypes = ["text/csv"];
  
  const fileUpload = !file && (
    <DropZone.FileUpload actionHint="Accepts .csv files" />
  );
  
  const uploadedFile = file && (
    <InlineStack gap="400">
      <Thumbnail
        size="small"
        alt={file.name}
        source={NoteIcon}
      />
      <div>
        <Text variant="bodyMd" fontWeight="bold" as="p">
          {file.name}
        </Text>
        <Text variant="bodySm" as="p">
          {file.size} bytes
        </Text>
      </div>
    </InlineStack>
  );

  const errorMessage = rejectedFiles.length > 0 && (
    <Banner
      title="The following files couldn't be uploaded:"
      tone="critical"
    >
      <ul>
        {rejectedFiles.map((file, index) => (
          <li key={index}>
            {file.name} is not supported. File type must be .csv
          </li>
        ))}
      </ul>
    </Banner>
  );

  const successMessage = actionData?.status === "success" && !actionData?.syncResult && (
    <Banner title="Success" tone="success">
      {actionData.message}
    </Banner>
  );

  const warningMessage = actionData?.status === "warning" && (
    <Banner title="Warning" tone="warning">
      <BlockStack gap="200">
        <Text as="p">{actionData.message}</Text>
        {actionData.errors && actionData.errors.length > 0 && (
          <BlockStack gap="100">
            <Text as="p">Errors:</Text>
            <ul>
              {actionData.errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </BlockStack>
        )}
      </BlockStack>
    </Banner>
  );

  const errorUploadMessage = actionData?.status === "error" && !actionData?.syncResult && (
    <Banner title="Error" tone="critical">
      {actionData.message}
    </Banner>
  );

  // Format date for display
  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleString();
  };

  // Calculate days until expiration based on batch ID
  const getDaysUntilExpiration = (batchId: string) => {
    if (!batchId || batchId.length !== 8) return null;
    
    try {
      const year = parseInt(batchId.substring(0, 4));
      const month = parseInt(batchId.substring(4, 6)) - 1; // JS months are 0-indexed
      const day = parseInt(batchId.substring(6, 8));
      
      const expirationDate = new Date(year, month, day);
      const today = new Date();
      
      // Reset time part to compare just the dates
      today.setHours(0, 0, 0, 0);
      expirationDate.setHours(0, 0, 0, 0);
      
      const diffTime = expirationDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      return diffDays;
    } catch (error) {
      return null;
    }
  };
  
  // Get expiration status text and color
  const getExpirationStatus = (batchId: string) => {
    const daysUntilExpiration = getDaysUntilExpiration(batchId);
    
    if (daysUntilExpiration === null) {
      return <Text as="span" tone="subdued">Unknown</Text>;
    } else if (daysUntilExpiration < 0) {
      return <Text as="span" tone="critical">Expired ({Math.abs(daysUntilExpiration)} days ago)</Text>;
    } else if (daysUntilExpiration <= 30) {
      return <Text as="span" tone="critical">Expiring soon ({daysUntilExpiration} days)</Text>;
    } else if (daysUntilExpiration <= 60) {
      return <Text as="span" tone="caution">60 days ({daysUntilExpiration} days left)</Text>;
    } else if (daysUntilExpiration <= 180) {
      return <Text as="span" tone="success">180 days ({daysUntilExpiration} days left)</Text>;
    } else {
      return <Text as="span" tone="success">Good ({daysUntilExpiration} days left)</Text>;
    }
  };

  // Get sync status text and color
  const getSyncStatusText = (item: ShelfLifeItem) => {
    if (item.syncStatus === "MATCHED") {
      return <Text as="span" tone="success">Matched</Text>;
    } else if (item.syncStatus === "UNMATCHED") {
      return <Text as="span" tone="critical">Not Matched</Text>;
    } else {
      return <Text as="span" tone="subdued">Not Synced</Text>;
    }
  };

  // Prepare data for the DataTable - remove ID and expiration date columns
  const rows = shelfLifeItems.map((item: ShelfLifeItem) => [
    item.productId,
    <Text as="span" fontWeight={getDaysUntilExpiration(item.batchId) !== null && getDaysUntilExpiration(item.batchId)! <= 30 ? "bold" : "regular"}>
      {item.batchId}
    </Text>,
    getExpirationStatus(item.batchId),
    item.quantity.toString(),
    item.batchQuantity !== undefined && item.batchQuantity !== null ? item.batchQuantity.toString() : "N/A",
    item.location || "N/A",
    item.shopifyProductTitle || "Not synced",
    getSyncStatusText(item),
    item.syncMessage || "Not synced yet",
    formatDate(item.updatedAt)
  ]);

  const tabs = [
    {
      id: 'upload',
      content: 'Upload CSV',
      panelID: 'upload-panel',
    },
    {
      id: 'view',
      content: 'View Inventory',
      panelID: 'view-panel',
    },
  ];

  const toggleActive = useCallback(() => setToastActive((active) => !active), []);
  const handleModalClose = useCallback(() => setSyncResultModalActive(false), []);

  return (
    <Frame>
      <Page
        title="Shelf Life Management"
        primaryAction={selectedTab === 0 ? {
          content: "Upload CSV",
          onAction: handleSubmit,
          disabled: !file,
        } : undefined}
        secondaryActions={selectedTab === 1 ? [
          {
            content: "Sync with Shopify",
            icon: RefreshIcon,
            onAction: handleSync,
            loading: isSyncing,
            disabled: isSyncing,
          }
        ] : undefined}
      >
        <BlockStack gap="500">
          {successMessage}
          {warningMessage}
          {errorUploadMessage}
          {errorMessage}
          
          <Tabs
            tabs={tabs}
            selected={selectedTab}
            onSelect={(index) => setSelectedTab(index)}
          />
          
          {selectedTab === 0 ? (
            <Layout>
              <Layout.Section>
                <Card>
                  <BlockStack gap="500">
                    <Text as="h2" variant="headingMd">Upload shelf life data</Text>
                    <Text as="p">
                      Upload a CSV file containing product shelf life information. The file should include columns for product ID, batch ID, expiration date, and quantity.
                    </Text>
                    <DropZone
                      accept="text/csv"
                      type="file"
                      onDrop={handleDropZoneDrop}
                      allowMultiple={false}
                    >
                      {uploadedFile}
                      {fileUpload}
                    </DropZone>
                    <Box paddingBlockStart="200">
                      <Text as="h3" variant="headingMd">Notes:</Text>
                      <ul>
                        <li>
                          <Text as="p">
                            The CSV file should contain columns for product ID (SKU), batch ID, expiration date, and quantity.
                          </Text>
                        </li>
                        <li>
                          <Text as="p">
                            Leading equals signs (=) in product IDs will be automatically removed.
                          </Text>
                        </li>
                        <li>
                          <Text as="p">
                            The file can be encoded in Big5 (Traditional Chinese) or UTF-8.
                          </Text>
                        </li>
                      </ul>
                    </Box>
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>
          ) : (
            <Layout>
              <Layout.Section>
                <Card>
                  <BlockStack gap="500">
                    <InlineStack align="space-between">
                      <Text as="h2" variant="headingMd">Shelf Life Inventory</Text>
                      <ButtonGroup>
                        <Button 
                          icon={RefreshIcon} 
                          onClick={handleSync} 
                          loading={isSyncing}
                          disabled={isSyncing}
                        >
                          Sync with Shopify
                        </Button>
                      </ButtonGroup>
                    </InlineStack>
                    {shelfLifeItems.length === 0 ? (
                      <EmptyState
                        heading="No shelf life data found"
                        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                      >
                        <p>Upload a CSV file to add shelf life data.</p>
                      </EmptyState>
                    ) : (
                      <DataTable
                        columnContentTypes={[
                          'text',
                          'text',
                          'text',
                          'numeric',
                          'numeric',
                          'text',
                          'text',
                          'text',
                          'text',
                          'text'
                        ]}
                        headings={[
                          'Product ID',
                          'Batch ID',
                          'Expiration Status',
                          'Quantity',
                          'Batch Quantity (批號存量)',
                          'Location',
                          'Shopify Product',
                          'Sync Status',
                          'Sync Message',
                          'Updated At'
                        ]}
                        rows={rows}
                        hoverable
                        verticalAlign="top"
                      />
                    )}
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>
          )}
        </BlockStack>
      </Page>
      
      {toastActive && (
        <Toast
          content={toastContent.message}
          tone={toastContent.tone as any}
          onDismiss={toggleActive}
        />
      )}
      
      {/* Modal to display unmatched items with reasons */}
      <Modal
        open={syncResultModalActive}
        onClose={handleModalClose}
        title="Sync Results"
        primaryAction={{
          content: "Close",
          onAction: handleModalClose,
        }}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">
              {actionData?.syncResult?.message}
            </Text>
            
            {actionData?.syncResult?.unmatchedItems && actionData.syncResult.unmatchedItems.length > 0 && (
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">Products that couldn't be matched:</Text>
                <List type="bullet">
                  {actionData.syncResult.unmatchedItems.map((item, index) => (
                    <List.Item key={index}>
                      <Text as="span" tone="critical">
                        {item.productId}: {item.reason}
                      </Text>
                    </List.Item>
                  ))}
                </List>
                <Text as="p">
                  To fix these issues, make sure the Product IDs in your CSV match the SKUs in your Shopify store.
                </Text>
              </BlockStack>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Frame>
  );
}
