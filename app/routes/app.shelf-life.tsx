import { useState, useCallback, useEffect, useRef } from "react";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useSubmit, useLoaderData, useFetcher } from "@remix-run/react";
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
  List,
  Popover,
  ActionList,
  Loading,
  Icon,
  ContextualSaveBar
} from "@shopify/polaris";
import { NoteIcon, RefreshIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { processCSVFile, getAllShelfLifeItems, syncWithShopify } from "../utils/shelf-life.server";
import prisma from "../db.server";
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
  variantPrice: number | null;
  variantCost: number | null;
  currencyCode: string | null;
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
  deletedCount?: number;
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
  
  // Handle updating sale price (and setting current price as compare-at price)
  if (action === "updateCompareAtPrice") {
    try {
      const variantId = formData.get("variantId");
      const compareAtPrice = formData.get("compareAtPrice");
      
      if (!variantId) {
        return json<ActionData>({ 
          status: "error", 
          message: "Variant ID is required for updating sale price" 
        });
      }
      
      if (!compareAtPrice) {
        return json<ActionData>({ 
          status: "error", 
          message: "Sale price is required" 
        });
      }
      
      // Parse sale price as float
      const compareAtPriceFloat = parseFloat(compareAtPrice.toString());
      
      if (isNaN(compareAtPriceFloat)) {
        return json<ActionData>({ 
          status: "error", 
          message: "Sale price must be a valid number" 
        });
      }
      
      console.log(`Using GraphQL productVariantsBulkUpdate to update variant ${variantId} regular price to ${compareAtPriceFloat}, setting original price as compare-at price`);
      
      try {
        // First, we need to look up the product ID and current price from the database
        // Get all shelf life items from the database for this shop
        const shelfLifeItemsFromDb = await prisma.shelfLifeItem.findMany({
          where: { shop: session.shop }
        });
        
        console.log(`Found ${shelfLifeItemsFromDb.length} shelf life items in database`);
        
        // Find the item with matching variant ID
        const item = shelfLifeItemsFromDb.find(item => item.shopifyVariantId === variantId);
        const productId = item?.shopifyProductId;
        const currentPrice = item?.variantPrice;
        
        if (!productId) {
          console.error(`Cannot find product ID for variant ${variantId}`);
          return json<ActionData>({
            status: "error",
            message: "Cannot find product ID for this variant"
          });
        }
        
        if (!currentPrice) {
          console.error(`Cannot find current price for variant ${variantId}`);
          return json<ActionData>({
            status: "error",
            message: "Cannot find current price for this variant"
          });
        }
        
        console.log(`Found corresponding product ID: ${productId} for variant: ${variantId}`);
        console.log(`Current price: ${currentPrice}, setting as compare-at price`);
        
        // Use the productVariantsBulkUpdate with the correct productId parameter
        // Setting the sale price as the new price, and current price as compare-at price
        const response = await admin.graphql(
          `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              productVariants {
                id
                title
                price
                compareAtPrice
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              productId: productId,
              variants: [
                {
                  id: variantId,
                  price: compareAtPriceFloat.toFixed(2),
                  compareAtPrice: currentPrice.toString()
                }
              ]
            }
          }
        );
        
        const responseJson = await response.json();
        
        if (responseJson.errors) {
          console.error("GraphQL errors:", responseJson.errors);
          return json<ActionData>({
            status: "error",
            message: `Error updating compare at price: ${responseJson.errors[0]?.message || "Unknown GraphQL error"}`
          });
        }
        
        const result = responseJson.data?.productVariantsBulkUpdate;
        
        if (result?.userErrors?.length > 0) {
          console.error("GraphQL user errors:", result.userErrors);
          return json<ActionData>({
            status: "error",
            message: `Error updating compare at price: ${result.userErrors[0].message}`
          });
        }
        
        console.log("Successfully updated variant sale price with GraphQL");
        return json<ActionData>({
          status: "success",
          message: `Sale price updated successfully to ${compareAtPriceFloat}`
        });
      } catch (error) {
        console.error("GraphQL exception:", error);
        return json<ActionData>({
          status: "error",
          message: `Error updating compare at price: ${error instanceof Error ? error.message : String(error)}`
        });
      }
      
    } catch (error) {
      console.error("Error updating compare at price:", error);
      return json<ActionData>({
        status: "error",
        message: `Error updating compare at price: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }
  
  // Handle item deletion
  if (action === "delete") {
    try {
      const id = formData.get("id");
      
      if (!id) {
        return json<ActionData>({ 
          status: "error", 
          message: "Item ID is required for deletion" 
        });
      }
      
      await prisma.shelfLifeItem.delete({
        where: { id: id.toString() }
      });
      
      return json<ActionData>({
        status: "success",
        message: "Item deleted successfully"
      });
    } catch (error) {
      console.error("Error deleting item:", error);
      return json<ActionData>({
        status: "error",
        message: `Error deleting item: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }
  
  // Handle bulk deletion
  if (action === "bulkDelete") {
    try {
      const idsString = formData.get("ids");
      
      if (!idsString) {
        return json<ActionData>({ 
          status: "error", 
          message: "Item IDs are required for bulk deletion" 
        });
      }
      
      const ids = idsString.toString().split(",");
      
      await prisma.shelfLifeItem.deleteMany({
        where: {
          id: {
            in: ids
          },
          shop // Ensure we only delete items for this shop
        }
      });
      
      return json<ActionData>({
        status: "success",
        message: `${ids.length} items deleted successfully`
      });
    } catch (error) {
      console.error("Error deleting items:", error);
      return json<ActionData>({
        status: "error",
        message: `Error deleting items: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }
  
  // Handle delete all items
  if (action === "deleteAll") {
    try {
      const result = await prisma.shelfLifeItem.deleteMany({
        where: { shop }
      });
      
      return json<ActionData>({
        status: "success",
        message: `${result.count} items deleted successfully`
      });
    } catch (error) {
      console.error("Error deleting all items:", error);
      return json<ActionData>({
        status: "error",
        message: `Error deleting all items: ${error instanceof Error ? error.message : String(error)}`
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
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDeleteModalActive, setConfirmDeleteModalActive] = useState(false);
  const [confirmDeleteAllModalActive, setConfirmDeleteAllModalActive] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [actionsPopoverActive, setActionsPopoverActive] = useState(false);
  const [compareAtPrices, setCompareAtPrices] = useState<Record<string, string>>({});
  const [updatingVariantId, setUpdatingVariantId] = useState<string | null>(null);
  
  const actionData = useActionData<ActionData>();
  const { shelfLifeItems } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const deleteFormRef = useRef<HTMLFormElement>(null);

  // Handle toast and modal when action data changes
  useEffect(() => {
    if (actionData) {
      setToastActive(true);
      setToastContent({
        message: actionData.message,
        tone: actionData.status === "success" ? "success" : "critical"
      });
      
      // Handle sync results
      if (actionData.syncResult) {
        setIsSyncing(false);
        
        // If there are unmatched items, show the modal
        if (actionData.syncResult.unmatchedItems && actionData.syncResult.unmatchedItems.length > 0) {
          setSyncResultModalActive(true);
        }
      }
      
      // Reset states if action succeeded
      if (actionData.status === "success") {
        if (isDeleting) {
          setIsDeleting(false);
          setSelectedItems([]);
          setItemToDelete(null);
        }
        
        if (updatingVariantId) {
          setUpdatingVariantId(null);
        }
      }
    }
  }, [actionData, isDeleting, updatingVariantId]);

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
  
  // Handle deleting a single item
  const handleDeleteItem = (id: string) => {
    setItemToDelete(id);
    setConfirmDeleteModalActive(true);
  };
  
  // Handle confirming the deletion of a single item
  const confirmDeleteItem = () => {
    if (!itemToDelete) return;
    
    setIsDeleting(true);
    setConfirmDeleteModalActive(false);
    
    const formData = new FormData();
    formData.append("action", "delete");
    formData.append("id", itemToDelete);
    
    submit(formData, { method: "post" });
  };
  
  // Handle updating sale price
  const handleUpdateCompareAtPrice = (variantId: string, value: string) => {
    setCompareAtPrices(prev => ({
      ...prev,
      [variantId]: value
    }));
  };
  
  // Handle submitting sale price update
  const submitCompareAtPrice = (variantId: string, compareAtPrice: string) => {
    if (!variantId || !compareAtPrice) return;
    
    setUpdatingVariantId(variantId);
    
    const formData = new FormData();
    formData.append("action", "updateCompareAtPrice");
    formData.append("variantId", variantId);
    formData.append("compareAtPrice", compareAtPrice);
    
    submit(formData, { method: "post" });
    
    // Clear the input after submission
    setCompareAtPrices(prev => {
      const newState = { ...prev };
      delete newState[variantId];
      return newState;
    });
  };
  
  // Handle deleting selected items
  const handleDeleteSelected = () => {
    if (selectedItems.length === 0) return;
    
    setConfirmDeleteModalActive(true);
  };
  
  // Handle confirming the deletion of selected items
  const confirmDeleteSelected = () => {
    if (selectedItems.length === 0) return;
    
    setIsDeleting(true);
    setConfirmDeleteModalActive(false);
    
    const formData = new FormData();
    formData.append("action", "bulkDelete");
    formData.append("ids", selectedItems.join(","));
    
    submit(formData, { method: "post" });
  };
  
  // Handle deleting all items
  const handleDeleteAll = () => {
    if (shelfLifeItems.length === 0) return;
    
    setConfirmDeleteAllModalActive(true);
  };
  
  // Handle confirming the deletion of all items
  const confirmDeleteAll = () => {
    setIsDeleting(true);
    setConfirmDeleteAllModalActive(false);
    
    const formData = new FormData();
    formData.append("action", "deleteAll");
    
    submit(formData, { method: "post" });
  };
  
  // Handle toggling item selection for bulk actions
  const handleSelectItem = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedItems(prev => [...prev, id]);
    } else {
      setSelectedItems(prev => prev.filter(itemId => itemId !== id));
    }
  };
  
  // Handle selecting all items
  const handleSelectAll = (checked: boolean) => {
    const currentItems = getFilteredItems(shelfLifeItems, getCurrentTabId());
    
    if (checked) {
      // Add current filtered items to selection
      const newSelectedItems = [...selectedItems];
      currentItems.forEach(item => {
        if (!selectedItems.includes(item.id)) {
          newSelectedItems.push(item.id);
        }
      });
      setSelectedItems(newSelectedItems);
    } else {
      // Remove current filtered items from selection
      const currentItemIds = currentItems.map(item => item.id);
      setSelectedItems(selectedItems.filter(id => !currentItemIds.includes(id)));
    }
  };
  
  // Toggle actions popover
  const toggleActionsPopover = useCallback(() => 
    setActionsPopoverActive(active => !active), []);

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
  
  // Format currency for display
  const formatCurrency = (amount: number | null, currencyCode: string | null) => {
    if (amount === null) return 'N/A';
    
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode || 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(amount);
    } catch (error) {
      // Fall back to basic formatting if currency code is invalid
      return `${currencyCode || '$'}${amount.toFixed(2)}`;
    }
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
  
  // Filter items based on their sync status and expiration status
  const getFilteredItems = (items: ShelfLifeItem[], tabId: string) => {
    if (tabId === 'view') {
      return items; // Return all items for the "All Inventory" tab
    }
    
    // Special case for "Not Synced" tab
    if (tabId === 'not-synced') {
      return items.filter(item => !item.syncStatus || item.syncStatus === "UNMATCHED");
    }
    
    return items.filter(item => {
      const daysUntilExpiration = getDaysUntilExpiration(item.batchId);
      
      if (daysUntilExpiration === null) {
        return false; // Filter out items with invalid expiration dates for category tabs
      }
      
      switch (tabId) {
        case 'expired':
          return daysUntilExpiration < 0;
        case 'expiring-soon':
          return daysUntilExpiration >= 0 && daysUntilExpiration <= 30;
        case 'expiring-60':
          return daysUntilExpiration > 30 && daysUntilExpiration <= 60;
        case 'expiring-90':
          return daysUntilExpiration > 60 && daysUntilExpiration <= 90;
        case 'good':
          return daysUntilExpiration > 90;
        default:
          return true;
      }
    });
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
    } else if (daysUntilExpiration <= 90) {
      return <Text as="span" tone="info">90 days ({daysUntilExpiration} days left)</Text>;
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

  // Get filtered items based on the selected tab
  const getFilteredRows = (tabId: string) => {
    // For upload tab, return empty rows
    if (tabId === 'upload') {
      return [];
    }
    
    // Get filtered items for the selected tab
    const filteredItems = getFilteredItems(shelfLifeItems, tabId);
    
    // Map filtered items to rows for the data table
    return filteredItems.map((item: ShelfLifeItem) => {
      const daysUntilExpiration = getDaysUntilExpiration(item.batchId);
      const isExpired = daysUntilExpiration !== null && daysUntilExpiration < 0;
      const isExpiringSoon = daysUntilExpiration !== null && daysUntilExpiration >= 0 && daysUntilExpiration <= 30;
      
      // Determine row styling based on expiration status
      const textTone = isExpired ? "critical" : isExpiringSoon ? "caution" : undefined;
      const fontWeight = isExpired || isExpiringSoon ? "bold" : "regular";
      
      return [
        <input 
          type="checkbox" 
          checked={selectedItems.includes(item.id)} 
          onChange={(e) => handleSelectItem(item.id, e.target.checked)}
          disabled={isDeleting}
        />,
        <Text as="span" tone={textTone} fontWeight={fontWeight}>{item.productId}</Text>,
        <Text as="span" tone={textTone} fontWeight={fontWeight}>{item.batchId}</Text>,
        getExpirationStatus(item.batchId),
        <Text as="span" tone={textTone} fontWeight={fontWeight}>{item.quantity.toString()}</Text>,
        <Text as="span" tone={textTone} fontWeight={fontWeight}>
          {item.batchQuantity !== undefined && item.batchQuantity !== null ? item.batchQuantity.toString() : "N/A"}
        </Text>,
        <Text as="span" tone={textTone} fontWeight={fontWeight}>{item.location || "N/A"}</Text>,
        <Text as="span" tone={textTone} fontWeight={fontWeight}>{item.shopifyProductTitle || "Not synced"}</Text>,
        <Text as="span" tone={textTone} fontWeight={fontWeight}>{formatCurrency(item.variantPrice, item.currencyCode)}</Text>,
        <InlineStack gap="100" align="center">
          <input
            type="number"
            style={{ 
              width: '80px', 
              padding: '6px', 
              border: '1px solid #c9cccf', 
              borderRadius: '4px',
              fontSize: '0.8125rem'
            }}
            placeholder="Set sale price"
            value={compareAtPrices[item.shopifyVariantId || ''] || ''}
            onChange={(e) => handleUpdateCompareAtPrice(item.shopifyVariantId || '', e.target.value)}
            disabled={!item.shopifyVariantId || updatingVariantId === item.shopifyVariantId}
          />
          <Button
            size="micro"
            onClick={() => submitCompareAtPrice(item.shopifyVariantId || '', compareAtPrices[item.shopifyVariantId || ''])}
            disabled={!item.shopifyVariantId || !compareAtPrices[item.shopifyVariantId || ''] || updatingVariantId === item.shopifyVariantId}
            loading={updatingVariantId === item.shopifyVariantId}
          >
            Set
          </Button>
        </InlineStack>,
        <Text as="span" tone={textTone} fontWeight={fontWeight}>{formatCurrency(item.variantCost, item.currencyCode)}</Text>,
        getSyncStatusText(item),
        <Text as="span" tone={textTone}>{item.syncMessage || "Not synced yet"}</Text>,
        <Text as="span" tone={textTone}>{formatDate(item.updatedAt)}</Text>,
        <ButtonGroup>
          <Button 
            onClick={() => handleDeleteItem(item.id)} 
            variant="tertiary" 
            tone="critical"
            disabled={isDeleting}
            accessibilityLabel={`Delete ${item.productId}`}
          >
            Delete
          </Button>
        </ButtonGroup>
      ];
    });
  };
  
  // Get counts of items in each category for tab badges
  const getExpirationCounts = () => {
    const counts = {
      expired: 0,
      expiringSoon: 0,
      expiring60: 0,
      expiring90: 0,
      good: 0,
      notSynced: 0
    };
    
    shelfLifeItems.forEach(item => {
      // Count not synced items first
      if (!item.syncStatus || item.syncStatus === "UNMATCHED") {
        counts.notSynced++;
      }
      
      const daysUntilExpiration = getDaysUntilExpiration(item.batchId);
      
      if (daysUntilExpiration === null) return;
      
      if (daysUntilExpiration < 0) {
        counts.expired++;
      } else if (daysUntilExpiration <= 30) {
        counts.expiringSoon++;
      } else if (daysUntilExpiration <= 60) {
        counts.expiring60++;
      } else if (daysUntilExpiration <= 90) {
        counts.expiring90++;
      } else {
        counts.good++;
      }
    });
    
    return counts;
  };
  
  // Get expiration counts
  const expirationCounts = getExpirationCounts();
  
  // Define tabs with counts
  const tabs = [
    {
      id: 'upload',
      content: 'Upload CSV',
      panelID: 'upload-panel',
    },
    {
      id: 'view',
      content: `All Inventory (${shelfLifeItems.length})`,
      panelID: 'view-panel',
    },
    {
      id: 'not-synced',
      content: `Not Synced (${expirationCounts.notSynced})`,
      panelID: 'not-synced-panel',
    },
    {
      id: 'expired',
      content: `Expired (${expirationCounts.expired})`,
      panelID: 'expired-panel',
    },
    {
      id: 'expiring-soon',
      content: `Expiring Soon (${expirationCounts.expiringSoon})`,
      panelID: 'expiring-soon-panel',
    },
    {
      id: 'expiring-60',
      content: `60 Days (${expirationCounts.expiring60})`,
      panelID: 'expiring-60-panel',
    },
    {
      id: 'expiring-90',
      content: `90 Days (${expirationCounts.expiring90})`,
      panelID: 'expiring-90-panel',
    },
    {
      id: 'good',
      content: `Good Inventory (${expirationCounts.good})`,
      panelID: 'good-panel',
    },
  ];
  
  // Get the current filtered rows based on the selected tab ID
  const getCurrentTabId = () => {
    return tabs[selectedTab]?.id || 'view';
  };
  
  const rows = getFilteredRows(getCurrentTabId());

  // Prepare actions popover
  const actionsPopoverButton = (
    <Button
      onClick={toggleActionsPopover}
      variant="tertiary"
      disabled={isDeleting}
    >
      • • • Actions
    </Button>
  );
  
  const handlePopoverActionSelect = (action: string) => {
    setActionsPopoverActive(false);
    
    if (action === 'delete_selected') {
      handleDeleteSelected();
    } else if (action === 'delete_all') {
      handleDeleteAll();
    }
  };

  const toggleActive = useCallback(() => setToastActive((active) => !active), []);
  const handleModalClose = useCallback(() => setSyncResultModalActive(false), []);
  const handleDeleteModalClose = useCallback(() => {
    setConfirmDeleteModalActive(false);
    setItemToDelete(null);
  }, []);
  const handleDeleteAllModalClose = useCallback(() => {
    setConfirmDeleteAllModalActive(false);
  }, []);

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
                        {selectedItems.length > 0 && (
                          <Button 
                            tone="critical"
                            onClick={handleDeleteSelected} 
                            disabled={isDeleting}
                          >
                            Delete Selected ({selectedItems.length})
                          </Button>
                        )}
                        <Button 
                          icon={RefreshIcon} 
                          onClick={handleSync} 
                          loading={isSyncing}
                          disabled={isSyncing || isDeleting}
                        >
                          Sync with Shopify
                        </Button>
                        
                        <Popover
                          active={actionsPopoverActive}
                          activator={actionsPopoverButton}
                          onClose={toggleActionsPopover}
                          preferredAlignment="right"
                        >
                          <ActionList
                            actionRole="menuitem"
                            items={[
                              {
                                content: 'Delete Selected',
                                onAction: () => handlePopoverActionSelect('delete_selected'),
                                disabled: selectedItems.length === 0 || isDeleting
                              },
                              {
                                content: 'Delete All Items',
                                onAction: () => handlePopoverActionSelect('delete_all'),
                                disabled: shelfLifeItems.length === 0 || isDeleting
                              }
                            ]}
                          />
                        </Popover>
                      </ButtonGroup>
                    </InlineStack>
                    
                    {/* Display category-specific banner */}
                    {getCurrentTabId() !== 'upload' && getCurrentTabId() !== 'view' && (
                      <Box paddingBlockEnd="300">
                        <Banner tone={
                          getCurrentTabId() === 'expired' ? 'critical' :
                          getCurrentTabId() === 'expiring-soon' ? 'warning' :
                          getCurrentTabId() === 'expiring-60' ? 'info' :
                          getCurrentTabId() === 'expiring-90' ? 'info' :
                          getCurrentTabId() === 'not-synced' ? 'warning' : 'success'
                        }>
                          <Text as="p">
                            {getCurrentTabId() === 'expired' && `Showing ${rows.length} expired items. These products have passed their expiration date.`}
                            {getCurrentTabId() === 'expiring-soon' && `Showing ${rows.length} items expiring within 30 days. These products need immediate attention.`}
                            {getCurrentTabId() === 'expiring-60' && `Showing ${rows.length} items expiring within 31-60 days. Consider planning for these items.`}
                            {getCurrentTabId() === 'expiring-90' && `Showing ${rows.length} items expiring within 61-90 days.`}
                            {getCurrentTabId() === 'good' && `Showing ${rows.length} items with more than 90 days until expiration.`}
                            {getCurrentTabId() === 'not-synced' && `Showing ${rows.length} items that have not been synced with Shopify. Click "Sync with Shopify" to match these items with your products.`}
                          </Text>
                        </Banner>
                      </Box>
                    )}
                    
                    {/* Hidden form for delete operations */}
                    <form method="post" ref={deleteFormRef} style={{ display: 'none' }}>
                      <input type="hidden" name="action" value="delete" />
                      <input type="hidden" name="id" id="deleteItemId" />
                    </form>
                    
                    {getCurrentTabId() === 'upload' ? (
                      <></>
                    ) : rows.length === 0 ? (
                      <EmptyState
                        heading={shelfLifeItems.length === 0 
                          ? "No shelf life data found" 
                          : `No items found in this category`}
                        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                      >
                        <p>{shelfLifeItems.length === 0 
                          ? "Upload a CSV file to add shelf life data." 
                          : "Try selecting a different category or upload more items."}
                        </p>
                      </EmptyState>
                    ) : (
                      <DataTable
                        columnContentTypes={[
                          'text',
                          'text',
                          'text',
                          'text',
                          'numeric',
                          'numeric',
                          'text',
                          'text',
                          'numeric',
                          'numeric',
                          'numeric',
                          'text',
                          'text',
                          'text',
                          'text'
                        ]}
                        headings={[
                          <input 
                            type="checkbox" 
                            checked={rows.length > 0 && 
                              getFilteredItems(shelfLifeItems, getCurrentTabId())
                                .every(item => selectedItems.includes(item.id))} 
                            onChange={(e) => {
                              const currentItems = getFilteredItems(shelfLifeItems, getCurrentTabId());
                              if (e.target.checked) {
                                // Select all visible items in the current tab
                                const newSelectedItems = [...selectedItems];
                                currentItems.forEach(item => {
                                  if (!selectedItems.includes(item.id)) {
                                    newSelectedItems.push(item.id);
                                  }
                                });
                                setSelectedItems(newSelectedItems);
                              } else {
                                // Deselect all visible items in the current tab
                                const currentItemIds = currentItems.map(item => item.id);
                                setSelectedItems(selectedItems.filter(id => !currentItemIds.includes(id)));
                              }
                            }}
                            disabled={isDeleting || rows.length === 0}
                          />,
                          'Product ID',
                          'Batch ID',
                          'Expiration Status',
                          'Quantity',
                          'Batch Quantity (批號存量)',
                          'Location',
                          'Shopify Product',
                          'Price',
                          'Sale Price',
                          'Cost',
                          'Sync Status',
                          'Sync Message',
                          'Updated At',
                          'Actions'
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
      
      {isDeleting && <Loading />}
      
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
      
      {/* Confirm Delete Modal for single or selected items */}
      <Modal
        open={confirmDeleteModalActive}
        onClose={handleDeleteModalClose}
        title={itemToDelete ? "Delete Item" : "Delete Selected Items"}
        primaryAction={{
          content: "Delete",
          onAction: itemToDelete ? confirmDeleteItem : confirmDeleteSelected,
          destructive: true,
          loading: isDeleting
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: handleDeleteModalClose,
            disabled: isDeleting
          }
        ]}
      >
        <Modal.Section>
          <Text as="p">
            {itemToDelete 
              ? "Are you sure you want to delete this item? This action cannot be undone."
              : `Are you sure you want to delete ${selectedItems.length} items? This action cannot be undone.`
            }
          </Text>
        </Modal.Section>
      </Modal>
      
      {/* Confirm Delete All Modal */}
      <Modal
        open={confirmDeleteAllModalActive}
        onClose={handleDeleteAllModalClose}
        title="Delete All Items"
        primaryAction={{
          content: "Delete All",
          onAction: confirmDeleteAll,
          destructive: true,
          loading: isDeleting
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: handleDeleteAllModalClose,
            disabled: isDeleting
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" tone="critical" fontWeight="bold">
              Warning: This action will delete all {shelfLifeItems.length} items in your shelf life inventory.
            </Text>
            <Text as="p">
              This is a permanent action and cannot be undone. Are you sure you want to proceed?
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Frame>
  );
}
