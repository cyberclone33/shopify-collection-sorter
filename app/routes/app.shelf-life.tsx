import { useState, useCallback } from "react";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useSubmit } from "@remix-run/react";
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
  Box
} from "@shopify/polaris";
import { NoteIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { processCSVFile } from "../utils/shelf-life.server";
import iconv from "iconv-lite";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
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
  const actionData = useActionData<ActionData>();
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

  return (
    <Page
      title="Shelf Life Management"
      primaryAction={{
        content: "Upload CSV",
        onAction: handleSubmit,
        disabled: !file,
      }}
    >
      <BlockStack gap="500">
        {successMessage}
        {warningMessage}
        {errorUploadMessage}
        {errorMessage}
        
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Upload Shelf Life Data</Text>
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
                <Text variant="bodySm" as="p" tone="subdued">
                  Files must be in CSV format. Big5 encoding is supported. Product IDs starting with "=" will have the "=" removed.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Shelf Life Management Help</Text>
                <Text as="h3" variant="headingSm">
                  About this feature
                </Text>
                <Text as="p">
                  The Shelf Life Management feature allows you to track inventory by expiration date. Upload your CSV data daily to keep inventory information up to date.
                </Text>
                <Text as="h3" variant="headingSm">
                  CSV Format
                </Text>
                <Text as="p">
                  Your CSV file should include the following columns:
                </Text>
                <ul>
                  <li>Product ID (SKU or ERP ID) - Leading "=" will be removed</li>
                  <li>Batch ID</li>
                  <li>Expiration Date (YYYY-MM-DD)</li>
                  <li>Quantity</li>
                  <li>Location (optional)</li>
                </ul>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
        
        <PageActions
          primaryAction={{
            content: "Upload CSV",
            onAction: handleSubmit,
            disabled: !file,
          }}
        />
      </BlockStack>
    </Page>
  );
}
