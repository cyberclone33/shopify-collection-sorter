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
  SearchIcon,
  ImageIcon,
} from "@shopify/polaris-icons";

// CSS for Dizzy Dizzo effects
const dizzyDizzoStyles = `
@keyframes pulse {
  0% {
    transform: scale(1);
    opacity: 0.3;
  }
  50% {
    transform: scale(1.05);
    opacity: 0.7;
  }
  100% {
    transform: scale(1);
    opacity: 0.3;
  }
}

@keyframes sparkle {
  0% {
    background-position: 0% 0%;
  }
  100% {
    background-position: 100% 100%;
  }
}

.dizzy-dizzo-pulse {
  animation: pulse 2s ease-in-out;
  animation-iteration-count: 1;
}

.dizzy-dizzo-sparkle {
  position: relative;
}

.dizzy-dizzo-sparkle::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: radial-gradient(circle at center, transparent 30%, rgba(255,255,255,0.3) 70%, transparent 100%);
  animation: pulse 2s;
  animation-iteration-count: 1;
  pointer-events: none;
}
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  const navigate = useNavigate();
  const appBridge = useAppBridge();
  
  // Add the styles to the document
  useEffect(() => {
    const styleElement = document.createElement('style');
    styleElement.textContent = dizzyDizzoStyles;
    document.head.appendChild(styleElement);
    
    return () => {
      document.head.removeChild(styleElement);
    };
  }, []);

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

        {/* Dizzy Dizzo Feature Card */}
        <Card>
          <BlockStack gap="400">
            <Box paddingBlock="500" paddingInline="500" background="bg-surface-secondary-selected" borderRadius="300">
              <BlockStack gap="400">
                <InlineStack gap="400" align="center">
                  <div style={{ 
                    background: "linear-gradient(135deg, #FF6B6B 0%, #FFD166 50%, #06D6A0 100%)", 
                    width: 50, 
                    height: 50, 
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)"
                  }}>
                    <Text as="span" variant="heading2xl" fontWeight="bold" color="text-inverse">D</Text>
                  </div>
                  <InlineStack gap="200" align="center">
                    <Text as="h2" variant="headingXl">Dizzy Dizzo</Text>
                    <Badge tone="attention">NEW</Badge>
                  </InlineStack>
                </InlineStack>
                
                <Text as="p" variant="bodyLg">
                  Create eye-catching visual effects for your product images. The Dizzy Dizzo feature allows you to add
                  animations, sparkles, and attention-grabbing effects to make your products stand out in your store and
                  on social media.
                </Text>
                
                <InlineGrid columns={["oneHalf", "oneHalf"]} gap="400">
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">Key Benefits:</Text>
                    <ul style={{ paddingLeft: "20px", margin: 0 }}>
                      <li>
                        <Text as="p" variant="bodyMd">Increase engagement with animated product images</Text>
                      </li>
                      <li>
                        <Text as="p" variant="bodyMd">Choose from multiple effect styles</Text>
                      </li>
                      <li>
                        <Text as="p" variant="bodyMd">Customize animation intensity to match your brand</Text>
                      </li>
                      <li>
                        <Text as="p" variant="bodyMd">Apply effects to any product photo with one click</Text>
                      </li>
                    </ul>
                  </BlockStack>
                  <Box background="bg-surface" padding="400" borderRadius="200" borderWidth="025" borderColor="border">
                    <div id="dizzyDizzoDemo" className="dizzy-dizzo-demo" 
                      style={{ 
                        position: "relative", 
                        height: "160px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                        borderRadius: "8px",
                        backgroundColor: "#f5f5f5"
                      }}>
                      <img 
                        id="dizzoDizzoImage"
                        src="https://cdn.shopify.com/s/assets/no-image-2048-5e88c1b20e087fb7bbe9a3771824e743c244f437e4f8ba93bbf7b11b53f7824c.gif" 
                        alt="Dizzy Dizzo effect preview"
                        className="dizzy-dizzo-sparkle"
                        style={{ 
                          maxWidth: "100%", 
                          maxHeight: "160px", 
                          objectFit: "contain",
                          filter: "drop-shadow(0 0 8px rgba(255,255,255,0.8))"
                        }} 
                      />
                      <div id="dizzyDizzoOverlay1" style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: "radial-gradient(circle at center, transparent 30%, rgba(255,255,255,0.3) 70%, transparent 100%)",
                        pointerEvents: "none",
                        opacity: 0
                      }}></div>
                      <div id="dizzyDizzoOverlay2" style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: "100%",
                        background: "linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 50%, rgba(255,255,255,0.4) 100%)",
                        transform: "rotate(45deg)",
                        pointerEvents: "none",
                        opacity: 0
                      }}></div>
                    </div>
                    <BlockStack gap="200" alignment="center">
                      <Button
                        onClick={() => {
                          // Get elements
                          const img = document.getElementById('dizzoDizzoImage');
                          const overlay1 = document.getElementById('dizzyDizzoOverlay1');
                          const overlay2 = document.getElementById('dizzyDizzoOverlay2');
                          
                          // Reset styles
                          img.style.transform = 'scale(1)';
                          overlay1.style.opacity = '0';
                          overlay2.style.opacity = '0';
                          overlay2.style.backgroundPosition = '0% 0%';
                          
                          // Trigger animations
                          setTimeout(() => {
                            // Pulse animation
                            img.style.transition = 'transform 2s ease-in-out';
                            img.style.transform = 'scale(1.05)';
                            
                            // Fade in overlays
                            overlay1.style.transition = 'opacity 0.5s ease-in-out';
                            overlay1.style.opacity = '1';
                            
                            overlay2.style.transition = 'opacity 0.5s ease-in-out, background-position 5s linear';
                            overlay2.style.opacity = '1';
                            overlay2.style.backgroundPosition = '100% 100%';
                            
                            // Reset after animation completes
                            setTimeout(() => {
                              img.style.transform = 'scale(1)';
                              
                              setTimeout(() => {
                                overlay1.style.opacity = '0';
                                overlay2.style.opacity = '0';
                              }, 1000);
                            }, 2000);
                          }, 100);
                        }}
                        size="slim"
                      >
                        Preview Effect
                      </Button>
                      <Text as="p" variant="bodySm" alignment="center" tone="subdued">
                        (Click to see the effect)
                      </Text>
                    </BlockStack>
                  </Box>
                </InlineGrid>
                
                <BlockStack gap="300">
                  <Banner tone="success">
                    <Text as="p">
                      <Text as="span" fontWeight="bold">Dizzy Dizzo</Text> has been successfully added to your Alpha Dog app! Click "Preview Effect" above to see it in action.
                    </Text>
                  </Banner>
                  
                  <InlineStack gap="300" wrap={false}>
                    <Button
                      variant="primary"
                      onClick={() => {
                        // Get elements
                        const img = document.getElementById('dizzoDizzoImage');
                        const overlay1 = document.getElementById('dizzyDizzoOverlay1');
                        const overlay2 = document.getElementById('dizzyDizzoOverlay2');
                        
                        // Reset styles
                        img.style.transform = 'scale(1)';
                        overlay1.style.opacity = '0';
                        overlay2.style.opacity = '0';
                        overlay2.style.backgroundPosition = '0% 0%';
                        
                        // Trigger animations
                        setTimeout(() => {
                          // Pulse animation
                          img.style.transition = 'transform 2s ease-in-out';
                          img.style.transform = 'scale(1.05)';
                          
                          // Fade in overlays
                          overlay1.style.transition = 'opacity 0.5s ease-in-out';
                          overlay1.style.opacity = '1';
                          
                          overlay2.style.transition = 'opacity 0.5s ease-in-out, background-position 5s linear';
                          overlay2.style.opacity = '1';
                          overlay2.style.backgroundPosition = '100% 100%';
                          
                          // Reset after animation completes
                          setTimeout(() => {
                            img.style.transform = 'scale(1)';
                            
                            setTimeout(() => {
                              overlay1.style.opacity = '0';
                              overlay2.style.opacity = '0';
                            }, 1000);
                          }, 2000);
                        }, 100);
                      }}
                    >
                      Try Dizzy Dizzo
                    </Button>
                    <Button
                      variant="plain"
                      onClick={() => {
                        window.open("https://shopify.dev/apps", "_blank");
                      }}
                    >
                      Learn More
                    </Button>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Box>
          </BlockStack>
        </Card>

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
