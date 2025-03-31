import { useState, useCallback } from "react";
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
  Tabs
} from "@shopify/polaris";
import { NoteIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { processCSVFile, getAllShelfLifeItems } from "../utils/shelf-life.server";
import iconv from "iconv-lite";

// Define the ShelfLifeItem interface
interface ShelfLifeItem {
  id: string;
  shop: string;
  productId: string;
  batchId: string;
  expirationDate: string;
  quantity: number;
  location: string | null;
  createdAt: string;
  updatedAt: string;
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
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  
  const formData = await request.formData();
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
  const actionData = useActionData<ActionData>();
  const { shelfLifeItems } = useLoaderData<typeof loader>();
  const submit = useSubmit();

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

  const successMessage = actionData?.status === "success" && (
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

  const errorUploadMessage = actionData?.status === "error" && (
    <Banner title="Error" tone="critical">
      {actionData.message}
    </Banner>
  );

  // Format date for display
  const formatDate = (date: string) => {
    return new Date(date).toLocaleString();
  };

  // Prepare data for the DataTable - remove ID and expiration date columns
  const rows = shelfLifeItems.map((item: ShelfLifeItem) => [
    item.productId,
    item.batchId,
    item.quantity.toString(),
    item.location || "N/A",
    formatDate(item.createdAt),
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

  return (
    <Page
      title="Shelf Life Management"
      primaryAction={selectedTab === 0 ? {
        content: "Upload CSV",
        onAction: handleSubmit,
        disabled: !file,
      } : undefined}
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
                  <Text as="h2" variant="headingMd">Shelf Life Inventory</Text>
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
                        'numeric',
                        'text',
                        'text',
                        'text'
                      ]}
                      headings={[
                        'Product ID',
                        'Batch ID',
                        'Quantity',
                        'Location',
                        'Created At',
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
  );
}
